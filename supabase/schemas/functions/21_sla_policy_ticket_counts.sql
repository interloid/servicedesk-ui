-- =====================================================
-- File: 21_sla_policy_ticket_counts.sql
-- Description: Tickets per SLA policy, in one grouped query
-- =====================================================
--
-- The SLA list and the policy lock need how many tickets each policy is
-- applied to. One count query per policy made the list slower with every
-- policy, and reading the rows hits PostgREST's 1000-row cap. Service role
-- only: it is called with the admin client, already scoped to the tenant,
-- so tickets RLS can't hide some tickets and unlock a policy.

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
