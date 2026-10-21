-- =====================================================
-- File: 19_report_first_replies.sql
-- Description: First public agent reply per (ticket, agent), for Reports.
-- =====================================================
--
-- Reports used to fetch every public agent reply in the range and keep the
-- first per ticket in TypeScript. That is one row per REPLY, so a small team
-- (about 55 replies a day over 12 months) hit the 20,000-row cap and got
-- partial figures. DISTINCT ON returns one row per (ticket, agent) instead:
-- the earliest per ticket is the ticket's first response, and the earliest per
-- (ticket, agent) is what the agent table's median reads.
--
-- What counts as a response is the same rule the page used: an agent author,
-- public visibility, a body with some non-space text.
--
-- SECURITY INVOKER: the caller's RLS on ticket_messages scopes the rows.
-- p_tenant_id narrows to the caller's tenant for the index; it is not the
-- security boundary.
--
-- Ordered by (ticket_id, author_id), which is unique in the result, so the
-- page's .range() paging is stable.

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
