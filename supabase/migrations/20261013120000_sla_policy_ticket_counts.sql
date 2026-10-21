-- =====================================================
-- SLA policy ticket counts (code review 2026-10-13, RISK-013)
-- =====================================================
--
-- One grouped count for the SLA list instead of a count query per policy.
-- The app falls back to the per-policy counts until this is applied.
--
-- Mirrors supabase/schemas/functions/21_sla_policy_ticket_counts.sql.

create or replace function public.sla_policy_ticket_counts(
    p_tenant_id uuid,
    p_policy_ids uuid[]
)
returns table (policy_id uuid, ticket_count bigint)
language sql
stable
set search_path = public
as $$
    select t.sla_policy_id, count(*)
    from public.tickets t
    where t.tenant_id = p_tenant_id
      and t.sla_policy_id = any(p_policy_ids)
    group by t.sla_policy_id;
$$;

revoke execute on function public.sla_policy_ticket_counts(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.sla_policy_ticket_counts(uuid, uuid[]) to service_role;
