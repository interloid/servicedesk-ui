-- ==========================================================
-- File: 22_csat_ratings.sql
-- Description: Customer satisfaction ratings
-- ==========================================================
--
-- A rating belongs to a RESOLUTION, not to a ticket. The product rule is
-- "requested once per resolution, and a re-resolution after a reopen re-enables
-- the prompt", so the row carries the `resolved_at` it is about and uniqueness
-- is (ticket_id, resolved_at). Reopening clears tickets.resolved_at (see
-- triggers/tickets_resolution_stamps.sql), the next resolve stamps a new one,
-- and that is a new slot -- no window arithmetic.

create table if not exists public.csat_ratings
(
    id uuid primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    ticket_id uuid
        not null
        references public.tickets(id)
        on delete cascade,

    customer_id uuid
        not null
        references public.customers(id)
        on delete cascade,

    -- Who handled it at the moment of rating. Snapshotted rather than joined
    -- through tickets.assignee_user_id, because reassigning a ticket later must
    -- not silently move an old score onto a different engineer.
    agent_user_id uuid
        references public.users(id)
        on delete set null,

    score smallint
        not null
        check (score between 1 and 5),

    comment text,

    -- The resolution this rating is about; see the header. Written from
    -- tickets.resolved_at and checked against it by the insert policy, so a
    -- customer cannot invent a resolution to rate.
    resolved_at timestamptz
        not null,

    created_at timestamptz
        not null
        default now(),

    updated_at timestamptz
        not null
        default now(),

    constraint uq_csat_per_resolution
        unique (ticket_id, resolved_at)
);

comment on table public.csat_ratings is
'One customer satisfaction rating per ticket resolution. A reopened and re-resolved ticket earns a new row.';

create index if not exists idx_csat_tenant
on public.csat_ratings(tenant_id);

create index if not exists idx_csat_ticket
on public.csat_ratings(ticket_id);

create index if not exists idx_csat_agent
on public.csat_ratings(agent_user_id);

create index if not exists idx_csat_created
on public.csat_ratings(created_at desc);
