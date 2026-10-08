-- Breach overdue SLA clocks in the caller's tenant (RLS). The list page calls
-- it so breaches show up even where pg_cron's sla_tick() isn't running;
-- notifications are sla_tick()'s job. Paused clocks are skipped, and
-- breached_at is the deadline itself.
CREATE OR REPLACE FUNCTION public.process_sla_breaches()
returns integer
language plpgsql
as $$
declare
    v_updated integer;
begin
    update public.sla_events
    set status = 'breached',
        breached_at = due_at
    where status = 'pending'
      and paused_at is null
      and due_at <= now();

    get diagnostics v_updated = row_count;
    return v_updated;
end;
$$;
