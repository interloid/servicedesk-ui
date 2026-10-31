-- =====================================================
-- Audit: record who acted, and who paid
-- =====================================================
--
-- Changes a person made through the service key were recorded as "System":
-- role changes and customer invites (the app's admin client), and every
-- billing change (the subscription Edge Function). Payments were not audited
-- at all, and deleting an account turned all of its past events into
-- "System" (actor_id is set null).
--
-- * x-audit-actor: the app and the billing Edge Functions name the signed-in
--   person on service-role requests; audit_logs_fill takes it when there is no
--   session user. Trusted on service-role requests only.
-- * subscriptions.billing_actor_id: the last Tenant Admin or Billing Admin who
--   changed billing. Webhook/cron follow-ups and renewal charges are
--   attributed to them.
-- * audit_invoices: one "Paid ..." event per paid invoice.
-- * meta_json.actor: the actor's name, email and role at the time, so a
--   deleted account's events still say who it was.
--
-- Existing rows are left as they are. Mirrors
-- supabase/schemas/functions/19_audit_log.sql and
-- supabase/schemas/tables/07_subscriptions.sql.

alter table public.subscriptions
    add column if not exists billing_actor_id uuid
        references public.users(id)
        on delete set null;

create or replace function public.audit_trusted_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_claims text := current_setting('request.jwt.claims', true);
    v_id     uuid;
begin
    if v_claims is null or v_claims = ''
       or (v_claims::jsonb ->> 'role') is distinct from 'service_role' then
        return null;
    end if;

    v_id := nullif(public.audit_request_header('x-audit-actor'), '')::uuid;

    if v_id is null or not exists (select 1 from public.users where id = v_id) then
        return null;
    end if;

    return v_id;
exception
    when others then
        return null;
end;
$$;

create or replace function public.audit_fallback_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_id uuid;
begin
    v_id := nullif(current_setting('app.audit_fallback_actor', true), '')::uuid;

    if v_id is null or not exists (select 1 from public.users where id = v_id) then
        return null;
    end if;

    return v_id;
exception
    when others then
        return null;
end;
$$;

create or replace function public.audit_actor_snapshot(
    p_tenant_id uuid,
    p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_role text := coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
        ''
    );
begin
    -- Over the API a signed-in user may only snapshot themselves; triggers,
    -- the service role and cron (no request) may snapshot anyone.
    if v_role in ('authenticated', 'anon')
       and p_user_id is distinct from auth.uid() then
        return null;
    end if;

    return (
        select jsonb_strip_nulls(jsonb_build_object(
            'name', nullif(btrim(u.full_name), ''),
            'email', u.email,
            'role', (
                select public.audit_role_label(m.role::text)
                from public.memberships m
                where m.tenant_id = p_tenant_id
                  and m.user_id = p_user_id
                limit 1
            )
        ))
        from public.users u
        where u.id = p_user_id
    );
end;
$$;

-- audit_logs_fill runs as the writer, and staff insert a few events directly
-- (as authenticated), so it needs these. Each is safe to call: the first two
-- only answer for service-role / trigger context, and a signed-in caller can
-- only snapshot themselves.
revoke execute on function public.audit_trusted_actor() from public, anon;
revoke execute on function public.audit_fallback_actor() from public, anon;
revoke execute on function public.audit_actor_snapshot(uuid, uuid) from public, anon;
grant execute on function public.audit_trusted_actor() to authenticated, service_role;
grant execute on function public.audit_fallback_actor() to authenticated, service_role;
grant execute on function public.audit_actor_snapshot(uuid, uuid) to authenticated, service_role;

create or replace function public.audit_logs_fill()
returns trigger
language plpgsql
as $$
declare
    v_ip text;
begin
    new.meta_json := coalesce(new.meta_json, '{}'::jsonb);

    -- No session user: the person a service-role caller named, else the one
    -- a billing trigger attributes this to. Still null for true system work.
    if new.actor_id is null then
        new.actor_id := coalesce(
            public.audit_trusted_actor(),
            public.audit_fallback_actor()
        );
    end if;

    -- Who it was, as they were then. Never taken from the writer: a client
    -- could otherwise put any name on its own row.
    new.meta_json := new.meta_json - 'actor';
    if new.actor_id is not null then
        new.meta_json := new.meta_json || jsonb_build_object(
            'actor',
            public.audit_actor_snapshot(new.tenant_id, new.actor_id)
        );
    end if;

    -- current_user is the API role only for a direct PostgREST insert; inside
    -- audit_record() and the other SECURITY DEFINER writers it is the owner.
    -- A client-sent module is never kept.
    if new.module is null
       or new.module = 'general'
       or current_user in ('authenticated', 'anon') then
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

    -- A webhook or cron applying a change has no user: attribute it to the
    -- Tenant Admin or Billing Admin who last changed billing.
    perform set_config(
        'app.audit_fallback_actor',
        coalesce(new.billing_actor_id::text, ''),
        true
    );

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
        perform set_config('app.audit_fallback_actor', '', true);
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

    perform set_config('app.audit_fallback_actor', '', true);
    return null;
end;
$$;

create or replace function public.subscriptions_billing_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor uuid := auth.uid();
begin
    if v_actor is not null
       and not exists (select 1 from public.users where id = v_actor) then
        v_actor := null;
    end if;

    v_actor := coalesce(v_actor, public.audit_trusted_actor());

    if v_actor is not null then
        new.billing_actor_id := v_actor;
    end if;

    return new;
end;
$$;

drop trigger if exists subscriptions_billing_actor on public.subscriptions;

create trigger subscriptions_billing_actor
before insert or update on public.subscriptions
for each row
execute function public.subscriptions_billing_actor();

revoke execute on function public.subscriptions_billing_actor() from public, anon, authenticated;

-- Payments ---------------------------------------------------------------

-- One row per invoice the moment it is paid. The person is whoever is acting
-- (an upgrade paid in the app), else the subscription's billing_actor_id: the
-- Tenant Admin or Billing Admin whose agreement a renewal is charged to.
create or replace function public.audit_invoices()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_actor uuid;
begin
    if new.status is distinct from 'paid'
       or (tg_op = 'UPDATE' and old.status = 'paid') then
        return null;
    end if;

    select s.billing_actor_id into v_actor
    from public.subscriptions s
    where s.tenant_id = new.tenant_id
      and (new.subscription_id is null or s.id = new.subscription_id)
    limit 1;

    perform set_config(
        'app.audit_fallback_actor',
        coalesce(v_actor::text, ''),
        true
    );

    perform public.audit_record(
        new.tenant_id,
        'create',
        'invoice',
        new.id,
        jsonb_strip_nulls(jsonb_build_object(
            'summary', format(
                'Paid %s %s for the %s plan%s',
                new.currency,
                to_char(coalesce(new.amount_paid, new.amount), 'FM999999990.00'),
                coalesce(nullif(new.plan_name, ''), 'current'),
                case
                    when nullif(new.invoice_number, '') is not null
                    then format(' (%s)', new.invoice_number)
                    else ''
                end
            ),
            'amount', coalesce(new.amount_paid, new.amount),
            'currency', new.currency,
            'invoice_number', new.invoice_number,
            'invoice_type', new.invoice_type,
            'payment_method', new.payment_method,
            'related', jsonb_strip_nulls(jsonb_build_object(
                'paypal_subscription_id', new.paypal_subscription_id
            ))
        ))
    );

    perform set_config('app.audit_fallback_actor', '', true);
    return null;
end;
$$;

drop trigger if exists audit_invoices on public.invoices;

create trigger audit_invoices
after insert or update of status on public.invoices
for each row
execute function public.audit_invoices();

revoke execute on function public.audit_invoices() from public, anon, authenticated;
