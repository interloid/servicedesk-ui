-- Breach overdue SLA clocks in the caller's tenant, for a tenant without a
-- working pg_cron; sla_tick() does the same for every tenant every 15 minutes and
-- queues the alerts. SECURITY DEFINER because sla_events has no write
-- policy, so the tenant and staff checks are made here. Paused clocks are
-- skipped, and breached_at is the deadline itself.
-- Migration: 20261012120000_ticket_review_hardening.sql.
CREATE OR REPLACE FUNCTION public.process_sla_breaches()
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
