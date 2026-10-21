-- =====================================================
-- Audit log page
-- =====================================================
--
-- Until now audit_logs only held login/logout rows and ownership transfers,
-- and nothing read it. The Settings > Audit log page needs:
--
--   1. More actions: role changes, exports and failed sign-ins.
--   2. module / result / user_agent columns, so the page can filter and count
--      by them in SQL instead of re-deriving them from `entity` in every query.
--   3. Rows for the admin changes the page promises to track. They are written
--      by triggers rather than from each server action, so a change made from
--      any path (the app, an RPC, the SQL editor) is recorded the same way and
--      a new action cannot forget to log.
--   4. audit_log_summary(): the four stat cards, current period vs previous.
--   5. Reading gated on the plan: audit logs are a Business feature
--      (plans.features_json.audit_logs). Rows are still WRITTEN on every plan,
--      so a tenant that upgrades sees its history straight away.
--
-- Auditing never breaks the change it records: audit_record() swallows its
-- own errors and raises a WARNING instead.
--
-- Mirrors supabase/schemas/tables/20_audit_logs.sql,
-- supabase/schemas/policies/19_audit_logs.sql and
-- supabase/schemas/functions/19_audit_log.sql.

------------------------------------------------------------
-- 1. Actions
------------------------------------------------------------

-- ADD VALUE cannot be used in the same transaction that adds it, so nothing
-- below compares against these as enum literals: function bodies are only
-- planned when first called, and comparisons go through action::text.
alter type public.audit_action add value if not exists 'role_change';
alter type public.audit_action add value if not exists 'export';
alter type public.audit_action add value if not exists 'login_failed';

------------------------------------------------------------
-- 2. Columns
------------------------------------------------------------

alter table public.audit_logs
    add column if not exists module text not null default 'general',
    add column if not exists result text not null default 'success',
    add column if not exists user_agent text;

alter table public.audit_logs
    drop constraint if exists chk_audit_module,
    add constraint chk_audit_module check (
        module in (
            'authentication',
            'security',
            'team',
            'customers',
            'sla',
            'billing',
            'settings',
            'general'
        )
    ),
    drop constraint if exists chk_audit_result,
    add constraint chk_audit_result check (result in ('success', 'failure'));

-- The page always reads one tenant, newest first, often within one module.
create index if not exists idx_audit_tenant_created
    on public.audit_logs (tenant_id, created_at desc);

create index if not exists idx_audit_tenant_module_created
    on public.audit_logs (tenant_id, module, created_at desc);

------------------------------------------------------------
-- 3. Module + request context
------------------------------------------------------------

-- Which page section an event belongs to. One copy, used by the insert
-- trigger and the backfill, so the two never disagree.
create or replace function public.audit_module_for(
    p_entity text,
    p_action text,
    p_meta jsonb
)
returns text
language sql
immutable
as $$
    select case
        when p_action in ('login', 'logout') then 'authentication'
        when p_action = 'login_failed' then 'security'
        when p_entity in ('tenant_ownership', 'password', 'audit_log') then 'security'
        when p_entity = 'membership' and p_meta ->> 'role' = 'customer' then 'customers'
        when p_entity = 'membership' then 'team'
        when p_entity = 'customer' then 'customers'
        when p_entity in ('sla_policy', 'business_hours') then 'sla'
        when p_entity in ('subscription', 'invoice', 'payment_method') then 'billing'
        when p_entity = 'tenant' then 'settings'
        else 'general'
    end;
$$;

-- One header of the PostgREST request this statement runs in, or null.
--
-- The app's server-side Supabase client forwards the browser's address and
-- user agent as x-audit-ip / x-audit-user-agent (src/lib/supabase/server.ts):
-- without them every row would carry the Next.js server's address. A caller
-- talking to PostgREST directly can set those headers itself, but only on
-- rows about its own actions, so the worst it can do is blur its own trail.
create or replace function public.audit_request_header(p_name text)
returns text
language plpgsql
stable
as $$
declare
    v_raw text := current_setting('request.headers', true);
begin
    if v_raw is null or v_raw = '' then
        return null;
    end if;

    return nullif(btrim(v_raw::jsonb ->> p_name), '');
exception
    when others then
        return null;
end;
$$;

-- Fills what a writer left out: the module, the result, and the caller's
-- address and user agent. A writer outside a request (the admin client, a
-- cron) passes user_agent in meta_json; it is moved into the column here.
create or replace function public.audit_logs_fill()
returns trigger
language plpgsql
as $$
declare
    v_ip text;
begin
    new.meta_json := coalesce(new.meta_json, '{}'::jsonb);

    if new.module is null or new.module = 'general' then
        new.module := public.audit_module_for(
            new.entity,
            new.action::text,
            new.meta_json
        );
    end if;

    if new.action::text = 'login_failed' then
        new.result := 'failure';
    end if;

    if new.user_agent is null then
        new.user_agent := left(
            coalesce(
                nullif(new.meta_json ->> 'user_agent', ''),
                public.audit_request_header('x-audit-user-agent')
            ),
            512
        );
    end if;

    new.meta_json := new.meta_json - 'user_agent';

    if new.ip is null then
        v_ip := btrim(split_part(
            coalesce(
                public.audit_request_header('x-audit-ip'),
                public.audit_request_header('x-forwarded-for'),
                ''
            ),
            ',',
            1
        ));

        begin
            new.ip := nullif(v_ip, '')::inet;
        exception
            when others then
                new.ip := null;
        end;
    end if;

    return new;
end;
$$;

drop trigger if exists audit_logs_fill on public.audit_logs;

create trigger audit_logs_fill
before insert on public.audit_logs
for each row
execute function public.audit_logs_fill();

-- Existing rows: the module from their entity.
update public.audit_logs
set module = public.audit_module_for(entity, action::text, meta_json)
where module = 'general';

------------------------------------------------------------
-- 4. Writing from triggers
------------------------------------------------------------

-- The one insert every trigger goes through. SECURITY DEFINER because the
-- insert policy only lets a user write rows naming themselves, and a webhook
-- or cron has no user at all (actor_id null reads as "System").
create or replace function public.audit_record(
    p_tenant_id uuid,
    p_action public.audit_action,
    p_entity text,
    p_entity_id uuid,
    p_meta jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor uuid := auth.uid();
begin
    -- A token for somebody without a users row (a platform operator) would
    -- fail the foreign key; record the change as the system's instead.
    if v_actor is not null
       and not exists (select 1 from public.users where id = v_actor) then
        v_actor := null;
    end if;

    insert into public.audit_logs (
        tenant_id,
        actor_id,
        action,
        entity,
        entity_id,
        meta_json
    )
    values (
        p_tenant_id,
        v_actor,
        p_action,
        p_entity,
        p_entity_id,
        coalesce(p_meta, '{}'::jsonb)
    );
exception
    when others then
        raise warning 'audit_record(%, %) not written: %',
            p_entity, p_action, sqlerrm;
end;
$$;

revoke execute on function public.audit_record(uuid, public.audit_action, text, uuid, jsonb)
    from public, anon, authenticated;

create or replace function public.audit_role_label(p_role text)
returns text
language sql
immutable
as $$
    select case p_role
        when 'tenant_admin' then 'Tenant Admin'
        when 'manager' then 'Manager'
        when 'agent' then 'Agent'
        when 'billing_admin' then 'Billing Admin'
        when 'customer' then 'Customer'
        when 'platform_admin' then 'Platform Admin'
        else coalesce(p_role, 'Unknown')
    end;
$$;

-- { field: { from, to } } for each listed key whose value differs.
create or replace function public.audit_diff(
    p_old jsonb,
    p_new jsonb,
    p_keys text[]
)
returns jsonb
language sql
immutable
as $$
    select coalesce(
        jsonb_object_agg(
            k,
            jsonb_build_object('from', p_old -> k, 'to', p_new -> k)
        ),
        '{}'::jsonb
    )
    from unnest(p_keys) as k
    where (p_old -> k) is distinct from (p_new -> k);
$$;

-- Team and customer memberships ------------------------------------------

create or replace function public.audit_memberships()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row public.memberships := case when tg_op = 'DELETE' then old else new end;
    v_who text;
    v_role text;
    v_meta jsonb;
begin
    -- transfer_tenant_ownership() and provision_tenant() write their own row.
    if coalesce(current_setting('app.ownership_change', true), '') = 'on' then
        return null;
    end if;

    select coalesce(nullif(u.email::text, ''), u.full_name)
    into v_who
    from public.users u
    where u.id = v_row.user_id;

    v_who := coalesce(v_who, 'a member');
    v_role := v_row.role::text;
    v_meta := jsonb_build_object(
        'role', v_role,
        'target_user_id', v_row.user_id,
        'target_email', v_who
    );

    if tg_op = 'INSERT' then
        perform public.audit_record(
            new.tenant_id,
            case when new.status::text = 'invited' then 'invite' else 'create' end::public.audit_action,
            'membership',
            new.id,
            v_meta || jsonb_build_object(
                'summary',
                case when new.status::text = 'invited'
                    then format('Invited %s as %s', v_who, public.audit_role_label(v_role))
                    else format('Added %s as %s', v_who, public.audit_role_label(v_role))
                end
            )
        );
    elsif tg_op = 'DELETE' then
        perform public.audit_record(
            old.tenant_id,
            'delete',
            'membership',
            old.id,
            v_meta || jsonb_build_object(
                'summary',
                case when old.status::text = 'invited'
                    then format('Revoked the invitation for %s', v_who)
                    else format('Removed %s from the workspace', v_who)
                end
            )
        );
    else
        if new.role is distinct from old.role then
            perform public.audit_record(
                new.tenant_id,
                'role_change',
                'membership',
                new.id,
                v_meta || jsonb_build_object(
                    'summary',
                    format(
                        'Changed role of %s from %s to %s',
                        v_who,
                        public.audit_role_label(old.role::text),
                        public.audit_role_label(new.role::text)
                    ),
                    'changes',
                    jsonb_build_object('role', jsonb_build_object(
                        'from', public.audit_role_label(old.role::text),
                        'to', public.audit_role_label(new.role::text)
                    ))
                )
            );
        end if;

        if new.status is distinct from old.status then
            perform public.audit_record(
                new.tenant_id,
                'update',
                'membership',
                new.id,
                v_meta || jsonb_build_object(
                    'summary',
                    case
                        when old.status::text = 'invited' and new.status::text = 'active'
                            then format('%s accepted the invitation', v_who)
                        when new.status::text = 'disabled'
                            then format('Deactivated %s', v_who)
                        when old.status::text = 'disabled' and new.status::text = 'active'
                            then format('Reactivated %s', v_who)
                        else format('Changed status of %s to %s', v_who, new.status)
                    end,
                    'changes',
                    jsonb_build_object('status', jsonb_build_object(
                        'from', initcap(old.status::text),
                        'to', initcap(new.status::text)
                    ))
                )
            );
        end if;
    end if;

    return null;
end;
$$;

drop trigger if exists audit_memberships on public.memberships;

create trigger audit_memberships
after insert or update or delete on public.memberships
for each row
execute function public.audit_memberships();

-- SLA policies ------------------------------------------------------------

create or replace function public.audit_sla_policies()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_changes jsonb;
begin
    if tg_op = 'INSERT' then
        perform public.audit_record(
            new.tenant_id,
            'create',
            'sla_policy',
            new.id,
            jsonb_build_object(
                'summary', format('Created SLA policy "%s"', new.name),
                'name', new.name
            )
        );
    elsif tg_op = 'DELETE' then
        perform public.audit_record(
            old.tenant_id,
            'delete',
            'sla_policy',
            old.id,
            jsonb_build_object(
                'summary', format('Deleted SLA policy "%s"', old.name),
                'name', old.name
            )
        );
    else
        -- updated_at moves on every save, including one that only changed
        -- the policy's targets (a separate table), so a save with no field
        -- changes is still recorded -- just without a diff.
        if to_jsonb(new) - 'updated_at' - 'updated_by'
           = to_jsonb(old) - 'updated_at' - 'updated_by'
           and new.updated_at is not distinct from old.updated_at then
            return null;
        end if;

        v_changes := public.audit_diff(
            to_jsonb(old),
            to_jsonb(new),
            array[
                'name',
                'description',
                'status',
                'applies_to',
                'is_default',
                'notify_before_breach',
                'notify_before_mins',
                'escalate_on_breach',
                'escalate_to_role'
            ]
        );

        perform public.audit_record(
            new.tenant_id,
            'update',
            'sla_policy',
            new.id,
            jsonb_build_object(
                'summary',
                case
                    when v_changes ? 'status'
                        then format('Set SLA policy "%s" to %s', new.name, new.status)
                    when v_changes ? 'is_default' and new.is_default
                        then format('Made "%s" the default SLA policy', new.name)
                    else format('Updated SLA policy "%s"', new.name)
                end,
                'name', new.name,
                'changes', v_changes
            )
        );
    end if;

    return null;
end;
$$;

drop trigger if exists audit_sla_policies on public.sla_policies;

create trigger audit_sla_policies
after insert or update or delete on public.sla_policies
for each row
execute function public.audit_sla_policies();

-- Business hours ----------------------------------------------------------

create or replace function public.audit_business_hours()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_changes jsonb := '{}'::jsonb;
    v_old_tz text;
    v_new_tz text;
begin
    if tg_op = 'INSERT' then
        perform public.audit_record(
            new.tenant_id,
            'create',
            'business_hours',
            new.id,
            jsonb_build_object(
                'summary', format('Created business hours "%s"', new.name),
                'name', new.name
            )
        );
        return null;
    elsif tg_op = 'DELETE' then
        perform public.audit_record(
            old.tenant_id,
            'delete',
            'business_hours',
            old.id,
            jsonb_build_object(
                'summary', format('Deleted business hours "%s"', old.name),
                'name', old.name
            )
        );
        return null;
    end if;

    if new.name is distinct from old.name then
        v_changes := v_changes || jsonb_build_object(
            'name', jsonb_build_object('from', old.name, 'to', new.name)
        );
    end if;

    if new.timezone_id is distinct from old.timezone_id then
        select code into v_old_tz from public.timezones where id = old.timezone_id;
        select code into v_new_tz from public.timezones where id = new.timezone_id;
        v_changes := v_changes || jsonb_build_object(
            'timezone', jsonb_build_object('from', v_old_tz, 'to', v_new_tz)
        );
    end if;

    if new.schedule_json is distinct from old.schedule_json then
        v_changes := v_changes || jsonb_build_object(
            'schedule', jsonb_build_object('from', old.schedule_json, 'to', new.schedule_json)
        );
    end if;

    if new.holidays_json is distinct from old.holidays_json then
        v_changes := v_changes || jsonb_build_object(
            'holidays', jsonb_build_object(
                'from', jsonb_array_length(coalesce(old.holidays_json, '[]'::jsonb)),
                'to', jsonb_array_length(coalesce(new.holidays_json, '[]'::jsonb))
            )
        );
    end if;

    if v_changes = '{}'::jsonb then
        return null;
    end if;

    perform public.audit_record(
        new.tenant_id,
        'update',
        'business_hours',
        new.id,
        jsonb_build_object(
            'summary', format('Updated business hours "%s"', new.name),
            'name', new.name,
            'changes', v_changes
        )
    );

    return null;
end;
$$;

drop trigger if exists audit_business_hours on public.business_hours;

create trigger audit_business_hours
after insert or update or delete on public.business_hours
for each row
execute function public.audit_business_hours();

-- Subscriptions -----------------------------------------------------------

create or replace function public.audit_subscriptions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_old_plan public.plans;
    v_new_plan public.plans;
    v_next_plan public.plans;
    v_related jsonb;
begin
    v_related := jsonb_strip_nulls(jsonb_build_object(
        'paypal_subscription_id', new.paypal_subscription_id
    ));

    if tg_op = 'INSERT' then
        select * into v_new_plan from public.plans where id = new.plan_id;
        perform public.audit_record(
            new.tenant_id,
            'create',
            'subscription',
            new.id,
            jsonb_build_object(
                'summary', format('Started the %s plan', coalesce(v_new_plan.name, 'new')),
                'related', v_related
            )
        );
        return null;
    end if;

    if new.plan_id is distinct from old.plan_id then
        select * into v_old_plan from public.plans where id = old.plan_id;
        select * into v_new_plan from public.plans where id = new.plan_id;

        perform public.audit_record(
            new.tenant_id,
            'update',
            'subscription',
            new.id,
            jsonb_build_object(
                'summary', format(
                    'Changed plan from %s to %s',
                    coalesce(v_old_plan.name, 'unknown'),
                    coalesce(v_new_plan.name, 'unknown')
                ),
                'changes', jsonb_build_object(
                    'plan', jsonb_build_object('from', v_old_plan.name, 'to', v_new_plan.name),
                    'seat_limit', jsonb_build_object('from', v_old_plan.seat_limit, 'to', v_new_plan.seat_limit),
                    'price_month', jsonb_build_object('from', v_old_plan.price_month, 'to', v_new_plan.price_month)
                ),
                'related', v_related
            )
        );
    end if;

    if new.cancel_at_period_end is distinct from old.cancel_at_period_end then
        perform public.audit_record(
            new.tenant_id,
            'update',
            'subscription',
            new.id,
            jsonb_build_object(
                'summary',
                case when new.cancel_at_period_end
                    then 'Cancelled the subscription at the end of the billing period'
                    else 'Resumed the subscription'
                end,
                'related', v_related
            )
        );
    end if;

    if new.next_plan_id is distinct from old.next_plan_id
       and new.next_plan_id is not null
       and not new.cancel_at_period_end then
        select * into v_next_plan from public.plans where id = new.next_plan_id;
        perform public.audit_record(
            new.tenant_id,
            'update',
            'subscription',
            new.id,
            jsonb_build_object(
                'summary', format(
                    'Scheduled a change to the %s plan',
                    coalesce(v_next_plan.name, 'new')
                ),
                'effective_at', new.next_plan_effective_at,
                'related', v_related
            )
        );
    end if;

    if new.seats is distinct from old.seats then
        perform public.audit_record(
            new.tenant_id,
            'update',
            'subscription',
            new.id,
            jsonb_build_object(
                'summary', format('Changed seats from %s to %s', old.seats, new.seats),
                'changes', jsonb_build_object(
                    'seats', jsonb_build_object('from', old.seats, 'to', new.seats)
                ),
                'related', v_related
            )
        );
    end if;

    return null;
end;
$$;

drop trigger if exists audit_subscriptions on public.subscriptions;

create trigger audit_subscriptions
after insert or update on public.subscriptions
for each row
execute function public.audit_subscriptions();

-- Workspace settings ------------------------------------------------------

create or replace function public.audit_tenants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- plan_id is mirrored from the subscription, which records its own row.
    if new.name is distinct from old.name then
        perform public.audit_record(
            new.id,
            'update',
            'tenant',
            new.id,
            jsonb_build_object(
                'summary', format('Renamed the workspace from "%s" to "%s"', old.name, new.name),
                'changes', jsonb_build_object(
                    'name', jsonb_build_object('from', old.name, 'to', new.name)
                )
            )
        );
    end if;

    if new.slug is distinct from old.slug then
        perform public.audit_record(
            new.id,
            'update',
            'tenant',
            new.id,
            jsonb_build_object(
                'summary', format('Changed the workspace address from "%s" to "%s"', old.slug, new.slug),
                'changes', jsonb_build_object(
                    'slug', jsonb_build_object('from', old.slug, 'to', new.slug)
                )
            )
        );
    end if;

    if new.branding_json is distinct from old.branding_json then
        perform public.audit_record(
            new.id,
            'update',
            'tenant',
            new.id,
            jsonb_build_object(
                'summary', 'Updated portal branding',
                'changes', public.audit_diff(
                    coalesce(old.branding_json, '{}'::jsonb),
                    coalesce(new.branding_json, '{}'::jsonb),
                    array(
                        select jsonb_object_keys(coalesce(old.branding_json, '{}'::jsonb))
                        union
                        select jsonb_object_keys(coalesce(new.branding_json, '{}'::jsonb))
                    )
                )
            )
        );
    end if;

    if new.status is distinct from old.status then
        perform public.audit_record(
            new.id,
            'update',
            'tenant',
            new.id,
            jsonb_build_object(
                'summary', format('Workspace status changed to %s', new.status),
                'changes', jsonb_build_object(
                    'status', jsonb_build_object('from', old.status, 'to', new.status)
                )
            )
        );
    end if;

    return null;
end;
$$;

drop trigger if exists audit_tenants on public.tenants;

create trigger audit_tenants
after update on public.tenants
for each row
execute function public.audit_tenants();

------------------------------------------------------------
-- 5. Reading: Business plan only
------------------------------------------------------------

-- Whether the caller's workspace plan turns a feature on. tenants.plan_id is
-- kept in step with the subscription by apply_subscription_plan().
create or replace function public.current_tenant_has_feature(p_feature text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (
            select (p.features_json ->> p_feature) = 'true'
            from public.tenants t
            join public.plans p on p.id = t.plan_id
            where t.id = public.current_tenant_id()
        ),
        false
    );
$$;

revoke execute on function public.current_tenant_has_feature(text) from public, anon;
grant execute on function public.current_tenant_has_feature(text) to authenticated;

drop policy if exists "audit_logs_select" on public.audit_logs;

create policy "audit_logs_select"
on public.audit_logs
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('tenant_admin', 'manager')
    and public.current_tenant_has_feature('audit_logs')
);

------------------------------------------------------------
-- 6. Stat cards
------------------------------------------------------------

-- The four cards for [p_from, p_to), and the same figures for the period of
-- equal length just before it. SECURITY INVOKER: the select policy above does
-- the tenant, role and plan checks, so a caller without access gets zeros.
create or replace function public.audit_log_summary(
    p_from timestamptz,
    p_to timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
    with span as (
        select p_from - (p_to - p_from) as prev_from
    ),
    scoped as (
        select
            a.actor_id,
            a.module,
            a.result,
            a.created_at >= p_from as is_current
        from public.audit_logs a, span
        where a.tenant_id = public.current_tenant_id()
          and a.created_at >= span.prev_from
          and a.created_at < p_to
    )
    select jsonb_build_object(
        'total', count(*) filter (where is_current),
        'prev_total', count(*) filter (where not is_current),
        'users', count(distinct actor_id) filter (where is_current),
        'prev_users', count(distinct actor_id) filter (where not is_current),
        'modules', count(distinct module) filter (where is_current),
        'prev_modules', count(distinct module) filter (where not is_current),
        'security', count(*) filter (
            where is_current and (module = 'security' or result = 'failure')
        ),
        'prev_security', count(*) filter (
            where not is_current and (module = 'security' or result = 'failure')
        )
    )
    from scoped;
$$;

revoke execute on function public.audit_log_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.audit_log_summary(timestamptz, timestamptz) to authenticated;
