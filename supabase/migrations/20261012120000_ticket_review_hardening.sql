-- =====================================================
-- Ticket review hardening (code review 2026-10-12)
-- =====================================================
--
-- Fixes to objects that are already live, so they can't go into the pending
-- SLA engine migrations:
--
--   1. sla_events (RISK-001). Every active member of a tenant -- portal
--      customers included, since they hold a customer membership -- could
--      INSERT, UPDATE and DELETE any SLA clock in the tenant, and read (and
--      stream over realtime) every ticket's deadlines. Only the engine writes
--      sla_events: the SECURITY DEFINER triggers and sla_tick(), which run as
--      the table owner and are not subject to these policies, and the service
--      role. Staff (tenant_admin / manager / agent) keep SELECT, which is what
--      the ticket list, the ticket page and their realtime hooks read.
--
--   2. process_sla_breaches() (RISK-001). It ran as the caller with RLS as the
--      only scope, which needed the member UPDATE policy dropped above. It is
--      now SECURITY DEFINER, limited to the caller's own tenant, and does
--      nothing for a caller who isn't active staff.
--
--   3. notifications (RISK-002 / RISK-029). 20260903090000 scoped SELECT to the
--      recipient, but UPDATE and DELETE still covered every notification in the
--      tenant, and any member could INSERT one (a fake "SLA breached" alert).
--      Every policy is now the recipient's own; nothing but the service role
--      (createNotification) and the SECURITY DEFINER sla_tick() inserts.
--
--   4. The target-units helpers from 20261009120000 are revoked from the API
--      roles like the engine's helpers (RISK-005): only triggers and the
--      engine call them, and sla_business_hours_day_mins is SECURITY DEFINER.
--
-- Mirrors supabase/schemas/policies/14_sla_events.sql,
-- policies/17_notifications.sql, functions/05_sla_breach_check.sql and
-- functions/18_sla_target_units.sql.

------------------------------------------------------------
-- 1. sla_events: staff read, nobody writes through the API
------------------------------------------------------------

drop policy if exists "Members can view tenant SLA events" on public.sla_events;
drop policy if exists "Members can create tenant SLA events" on public.sla_events;
drop policy if exists "Members can update tenant SLA events" on public.sla_events;
drop policy if exists "Members can delete tenant SLA events" on public.sla_events;
drop policy if exists "Staff can view tenant SLA events" on public.sla_events;

create policy "Staff can view tenant SLA events"
on public.sla_events
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('tenant_admin', 'manager', 'agent')
    and public.is_active_membership()
);

------------------------------------------------------------
-- 2. process_sla_breaches: the caller's tenant only
------------------------------------------------------------

-- Breach overdue SLA clocks in the caller's tenant, for a tenant without a
-- working pg_cron; sla_tick() does the same for every tenant every minute and
-- sends the notifications. Paused clocks are skipped, and breached_at is the
-- deadline itself.
create or replace function public.process_sla_breaches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tenant_id uuid := public.current_tenant_id();
    v_updated integer;
begin
    if v_tenant_id is null
       or coalesce(public.current_tenant_role(), '') not in ('tenant_admin', 'manager', 'agent')
       or not public.is_active_membership()
    then
        return 0;
    end if;

    update public.sla_events
    set status = 'breached',
        breached_at = due_at
    where tenant_id = v_tenant_id
      and status = 'pending'
      and paused_at is null
      and due_at <= now();

    get diagnostics v_updated = row_count;
    return v_updated;
end;
$$;

revoke execute on function public.process_sla_breaches() from public, anon;
grant execute on function public.process_sla_breaches() to authenticated;

------------------------------------------------------------
-- 3. notifications: the recipient's own, service role inserts
------------------------------------------------------------

drop policy if exists "Members can view tenant Notifications" on public.notifications;
drop policy if exists "Members can create tenant Notifications" on public.notifications;
drop policy if exists "Members can update tenant Notifications" on public.notifications;
drop policy if exists "Members can delete tenant Notifications" on public.notifications;
drop policy if exists "Members can view own Notifications" on public.notifications;
drop policy if exists "Members can update own Notifications" on public.notifications;
drop policy if exists "Members can delete own Notifications" on public.notifications;

create policy "Members can view own Notifications"
on public.notifications
for select
to authenticated
using (
    user_id = (select auth.uid())
    and tenant_id = public.current_tenant_id()
    and public.is_active_membership()
);

create policy "Members can update own Notifications"
on public.notifications
for update
to authenticated
using (
    user_id = (select auth.uid())
    and tenant_id = public.current_tenant_id()
    and public.is_active_membership()
)
with check (
    user_id = (select auth.uid())
    and tenant_id = public.current_tenant_id()
    and public.is_active_membership()
);

create policy "Members can delete own Notifications"
on public.notifications
for delete
to authenticated
using (
    user_id = (select auth.uid())
    and tenant_id = public.current_tenant_id()
    and public.is_active_membership()
);

------------------------------------------------------------
-- 4. Target-units helpers: internal
------------------------------------------------------------

revoke execute on function public.sla_schedule_day_mins(jsonb) from public, anon, authenticated;
revoke execute on function public.sla_business_hours_day_mins(uuid) from public, anon, authenticated;
revoke execute on function public.sla_unit_for_mins(integer) from public, anon, authenticated;
