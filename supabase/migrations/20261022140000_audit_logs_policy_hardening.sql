-- =====================================================
-- Audit log policy hardening
-- =====================================================
--
-- 1. Insert (RISK-006). The old policy only checked actor and tenant, so any
--    member -- a portal customer included -- could write any action, entity,
--    module, result and summary from the browser, and the Business audit page
--    shows those rows as trusted. Direct inserts are now limited to staff and
--    to the four events the app writes with the user's own client:
--
--      ('login',  'user')               auth.service.ts recordAuthEvent
--      ('logout', 'user')               auth.service.ts recordAuthEvent
--      ('update', 'notification_prefs') notifications.service.ts recordPrefsChanges
--      ('export', 'audit_log')          audit.service.ts exportAuditLog (admins/managers)
--
--    Failed sign-ins are written with the admin client and every trigger goes
--    through SECURITY DEFINER audit_record(), so neither depends on this policy.
--
-- 2. audit_logs_fill() no longer keeps a module sent by a client: for a direct
--    insert it is always derived from entity/action.
--
-- 3. Select (RISK-028, RISK-029). The helpers are wrapped in (select ...) so
--    they run once per statement instead of once per row, and a user can read
--    their own notification-preference rows (the "Settings history" tab) on
--    any role and plan.
--
-- Mirrors supabase/schemas/policies/19_audit_logs.sql and
-- supabase/schemas/functions/19_audit_log.sql.

------------------------------------------------------------
-- 1. Module is derived, never trusted, on direct inserts
------------------------------------------------------------

create or replace function public.audit_logs_fill()
returns trigger
language plpgsql
as $$
declare
    v_ip text;
begin
    new.meta_json := coalesce(new.meta_json, '{}'::jsonb);

    -- current_user is the API role only for a direct PostgREST insert; inside
    -- audit_record() and the other SECURITY DEFINER writers it is the owner.
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

------------------------------------------------------------
-- 2. Policies
------------------------------------------------------------

drop policy if exists "audit_logs_select" on public.audit_logs;

create policy "audit_logs_select"
on public.audit_logs
for select
to authenticated
using (
    tenant_id = (select public.current_tenant_id())
    and (select public.current_tenant_role()) in ('tenant_admin', 'manager')
    and (select public.current_tenant_has_feature('audit_logs'))
);

drop policy if exists "audit_logs_select_own_prefs" on public.audit_logs;

create policy "audit_logs_select_own_prefs"
on public.audit_logs
for select
to authenticated
using (
    actor_id = (select auth.uid())
    and entity = 'notification_prefs'
    and tenant_id = (select public.current_tenant_id())
);

drop policy if exists "audit_logs_insert" on public.audit_logs;

-- WITH CHECK runs after the BEFORE trigger, so module and result are the
-- filled values. Only the export row may carry its own summary text.
create policy "audit_logs_insert"
on public.audit_logs
for insert
to authenticated
with check (
    actor_id = (select auth.uid())
    and tenant_id = (select public.current_tenant_id())
    and result = 'success'
    and (
        (
            (select public.current_tenant_role()) <> 'customer'
            and entity_id = actor_id
            and not (meta_json ? 'summary')
            and (action::text, entity) in (
                ('login', 'user'),
                ('logout', 'user'),
                ('update', 'notification_prefs')
            )
        )
        or (
            (select public.current_tenant_role()) in ('tenant_admin', 'manager')
            and action::text = 'export'
            and entity = 'audit_log'
        )
    )
);
