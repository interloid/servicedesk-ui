-- RISK-003 (code review 2026-10-17): one row per (ticket, agent) for Reports
-- instead of one per reply. Mirrors supabase/schemas/functions/19_report_first_replies.sql.

create or replace function public.report_first_replies(
    p_tenant_id uuid,
    p_since timestamptz
)
returns table (
    ticket_id uuid,
    author_id uuid,
    created_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
    select distinct on (m.ticket_id, m.author_id)
        m.ticket_id,
        m.author_id,
        m.created_at
    from public.ticket_messages m
    where m.tenant_id = p_tenant_id
      and m.author_type = 'agent'
      and m.visibility = 'public'
      and m.body !~ '^[[:space:]]*$'
      and m.created_at >= p_since
    order by m.ticket_id, m.author_id, m.created_at, m.id;
$$;

revoke execute on function public.report_first_replies(uuid, timestamptz) from public, anon;
grant execute on function public.report_first_replies(uuid, timestamptz) to authenticated;
