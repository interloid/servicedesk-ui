-- ==========================================================
-- File: 10_tickets.sql
-- Description: Tickets
-- ==========================================================

create table if not exists public.tickets
(
    id uuid
        primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    number bigint
        not null,

    subject text
        not null,

    description text
        not null,

    status ticket_status
        not null
        default 'new',

    priority ticket_priority
        not null
        default 'normal',

    requester_customer_id uuid
        not null
        references public.customers(id),

    assignee_user_id uuid
        references public.users(id),

    sla_policy_id uuid
        references public.sla_policies(id),

    first_response_at timestamptz,

    resolved_at timestamptz,

    closed_at timestamptz,

    -- Staff user who raised it; null when the customer did (portal).
    created_by uuid
        references public.users(id)
        on delete set null,

    -- First agent, manager or tenant admin to open the ticket.
    opened_by uuid
        references public.users(id)
        on delete set null,

    opened_at timestamptz,

    created_at timestamptz
        not null
        default now(),

    updated_at timestamptz
        not null
        default now(),

    constraint uq_ticket_number
        unique (tenant_id, number)
);

comment on table public.tickets is
'Support tickets';

comment on column tickets.number is
'Sequential ticket number per tenant';

------------------------------------------------------------
-- Indexes
------------------------------------------------------------

create index if not exists idx_ticket_tenant
on public.tickets(tenant_id);

create index if not exists idx_ticket_status
on public.tickets(status);

create index if not exists idx_ticket_priority
on public.tickets(priority);

create index if not exists idx_ticket_assignee
on public.tickets(assignee_user_id);

create index if not exists idx_ticket_requester
on public.tickets(requester_customer_id);

create index if not exists idx_ticket_created
on public.tickets(created_at desc);

-- sla_tick()'s auto-close: tickets left resolved.
create index if not exists idx_ticket_resolved_at
on public.tickets(resolved_at)
where status = 'resolved';

------------------------------------------------------------
-- Full Text Search
------------------------------------------------------------

create index if not exists idx_ticket_search
on public.tickets
using gin
(
    to_tsvector(
        'english',
        coalesce(subject,'') || ' ' ||
        coalesce(description,'')
    )
);


-- Realtime (20260903090000_enable_realtime.sql): full rows on UPDATE/DELETE
-- so realtime can apply RLS, and the table on the supabase_realtime publication.
ALTER TABLE public.tickets REPLICA IDENTITY FULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime'
             AND schemaname = 'public'
             AND tablename = 'tickets'
       )
    THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
    END IF;
END
$$;
