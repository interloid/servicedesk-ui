-- ==========================================================
-- File: 24_csat_ratings.sql
-- Description: Customer satisfaction ratings
-- ==========================================================
--
-- A rating belongs to a RESOLUTION, not to a ticket. The product rule is
-- "requested once per resolution, and a re-resolution after a reopen re-enables
-- the prompt", so the row carries the `resolved_at` it is about and uniqueness
-- is (ticket_id, resolved_at). Reopening clears tickets.resolved_at (see
-- triggers/tickets_resolution_stamps.sql), the next resolve stamps a new one,
-- and that is a new slot -- no window arithmetic.
--
-- The RLS and the guard trigger below are not optional decoration on this table.
-- A signed-in customer can reach PostgREST directly with their session token and
-- the public anon key, so every column here is one they can send.

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
    -- not silently move an old score onto a different engineer. Written by
    -- csat_ratings_guard, never by the caller.
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


-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------

alter table public.csat_ratings enable row level security;

-- SELECT: staff read everything in their tenant for reporting; a customer
-- reads only their own scores.
create policy "csat_ratings_select"
on public.csat_ratings
for select
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and (
        public.current_tenant_role() in (
            'tenant_admin',
            'manager',
            'agent'
        )

        or

        exists (
            select 1
            from public.customers c
            where c.id = public.csat_ratings.customer_id
              and c.portal_user_id = auth.uid()
              and c.tenant_id = public.current_tenant_id()
        )
    )
);

-- INSERT: the requester, on their own resolved ticket, for the resolution that
-- actually happened. `t.resolved_at = csat_ratings.resolved_at` is the load
-- bearing clause -- without it the row's resolution key is caller-supplied and
-- the once-per-resolution rule means nothing. `agent_user_id` is not checked
-- here because the trigger below overwrites it from the ticket.
create policy "csat_ratings_insert"
on public.csat_ratings
for insert
to authenticated
with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'customer'
    and exists (
        select 1
        from public.tickets t
        join public.customers c
            on c.id = t.requester_customer_id
        where t.id = public.csat_ratings.ticket_id
          and t.tenant_id = public.current_tenant_id()
          and c.id = public.csat_ratings.customer_id
          and c.portal_user_id = auth.uid()
          and t.status = 'resolved'
          and t.resolved_at is not null
          and t.resolved_at = public.csat_ratings.resolved_at
    )
);

-- UPDATE: only so the customer can attach a comment after tapping a star.
-- Which columns may move at all is decided by csat_ratings_guard below, not
-- here: a policy can narrow the rows a caller reaches, never the columns it
-- reaches inside them.
create policy "csat_ratings_update"
on public.csat_ratings
for update
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'customer'
    and exists (
        select 1
        from public.customers c
        where c.id = public.csat_ratings.customer_id
          and c.portal_user_id = auth.uid()
          and c.tenant_id = public.current_tenant_id()
    )
)
with check (
    tenant_id = public.current_tenant_id()
);

-- DELETE: staff only, and only the tenant admin. Scores are reporting data.
create policy "csat_ratings_delete"
on public.csat_ratings
for delete
to authenticated
using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'tenant_admin'
);

-- ------------------------------------------------------------
-- Which columns a customer may change
-- ------------------------------------------------------------
--
-- The policies above already restrict a rating to its own ticket and its own
-- resolution, which is enough for "you may only rate what you were shown". It is
-- not enough for "a rating is a record of one moment": the UPDATE policy
-- re-checks ownership, not which columns moved, so a customer could rewrite
-- their own score afterwards or re-point the row at another ticket, and could
-- name any agent as the handler at INSERT time.
--
-- Two consequences of leaving that open, both about the per-agent report:
--
--   * `agent_user_id` is a snapshot of who handled the ticket, taken so that
--     reassigning a ticket later cannot move an old score onto a different
--     engineer. Supplied by the client, it is a claim rather than a snapshot.
--   * The once-per-resolution rule is only as strong as `resolved_at`, and a
--     customer who can reopen and re-resolve opens a fresh slot each time. That
--     is legitimate on its own -- but combined with an editable score it means
--     unlimited ratings against any handler.
--
-- So: agent_user_id is filled from the ticket in the database, and only the
-- comment is editable afterwards. Everything else is refused with 42501, the
-- same code the policies use, so nothing downstream learns there was a
-- distinction here.

create or replace function public.csat_ratings_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if tg_op = 'INSERT' then
        select t.assignee_user_id into new.agent_user_id
        from public.tickets t
        where t.id = new.ticket_id;

    elsif (
        new.ticket_id,
        new.customer_id,
        new.resolved_at,
        new.agent_user_id,
        new.tenant_id,
        new.score
    ) is distinct from (
        old.ticket_id,
        old.customer_id,
        old.resolved_at,
        old.agent_user_id,
        old.tenant_id,
        old.score
    ) then
        raise exception 'only the comment is editable on a rating'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

comment on function public.csat_ratings_guard() is
'Fills agent_user_id from the ticket on insert and refuses any update that moves a rating off the score, resolution, customer, handler or tenant it was recorded against.';

create or replace trigger csat_ratings_updated_at
before update on public.csat_ratings
for each row
execute function public.update_updated_at_column();

create or replace trigger csat_ratings_guard
before insert or update on public.csat_ratings
for each row
execute function public.csat_ratings_guard();
