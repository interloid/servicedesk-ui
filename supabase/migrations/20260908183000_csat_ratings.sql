-- ==========================================================
-- File: 20260908183000_csat_ratings.sql
-- Description: Customer satisfaction ratings, one per resolution
-- ==========================================================
--
-- Two things, because the second is what makes the first correct.
--
-- 1. `csat_ratings`. A rating belongs to a RESOLUTION, not to a ticket: the
--    rule is "requested once per resolution, and a re-resolution after a reopen
--    re-enables the prompt". So the row carries the `resolved_at` it is about,
--    and uniqueness is (ticket_id, resolved_at). Reopening clears
--    tickets.resolved_at, the next resolve stamps a new one, and that is a new
--    slot -- no window arithmetic, no "has this been rated lately" guesswork.
--
-- 2. A trigger that maintains resolved_at / closed_at from `status`.
--    Today only ONE code path sets resolved_at (the bulk resolve action);
--    resolving a single ticket from the agent detail view leaves it null. That
--    is already wrong -- reports_overview counts resolutions off resolved_at,
--    so the resolved figure undercounts -- and CSAT cannot be keyed on a column
--    that is only sometimes populated. The trigger makes the timestamp a
--    property of the status rather than something every caller must remember.
--
-- Additive apart from the trigger, which creates a stamp where there was none.
-- It never overwrites a timestamp a caller supplied.

begin;

------------------------------------------------------------
-- 1. Keep resolution timestamps honest
------------------------------------------------------------

create or replace function public.sync_ticket_resolution_stamps()
returns trigger
language plpgsql
as $$
begin
    --------------------------------------------------------
    -- Entering a terminal state stamps it, unless the caller
    -- already supplied a timestamp (a backfill or an import
    -- restoring history keeps its own).
    --------------------------------------------------------

    if new.status = 'resolved'
       and (tg_op = 'INSERT' or old.status is distinct from 'resolved')
    then
        new.resolved_at := coalesce(new.resolved_at, now());
    end if;

    if new.status = 'closed'
       and (tg_op = 'INSERT' or old.status is distinct from 'closed')
    then
        new.closed_at := coalesce(new.closed_at, now());

        -- A ticket closed straight from an open state was never "resolved",
        -- so resolved_at is deliberately left alone. It stays null and earns
        -- no CSAT prompt.
    end if;

    --------------------------------------------------------
    -- Leaving a terminal state clears both, which is what
    -- makes the next resolution a NEW csat slot.
    --------------------------------------------------------

    if tg_op = 'UPDATE'
       and new.status not in ('resolved', 'closed')
       and old.status in ('resolved', 'closed')
    then
        new.resolved_at := null;
        new.closed_at := null;
    end if;

    return new;
end;
$$;

comment on function public.sync_ticket_resolution_stamps() is
'Maintains tickets.resolved_at / closed_at from status, so reporting and CSAT do not depend on every caller remembering to set them.';

drop trigger if exists sync_tickets_resolution_stamps on public.tickets;

create trigger sync_tickets_resolution_stamps
before insert or update of status on public.tickets
for each row
execute function public.sync_ticket_resolution_stamps();

-- Backfill: tickets already sitting in a terminal state with no stamp. updated_at
-- is the closest honest approximation of when they got there.
update public.tickets
set resolved_at = updated_at
where status = 'resolved'
  and resolved_at is null;

update public.tickets
set closed_at = updated_at
where status = 'closed'
  and closed_at is null;

------------------------------------------------------------
-- 2. Ratings
------------------------------------------------------------

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

drop trigger if exists csat_ratings_updated_at on public.csat_ratings;

create trigger csat_ratings_updated_at
before update on public.csat_ratings
for each row
execute function public.update_updated_at_column();

------------------------------------------------------------
-- 3. RLS
------------------------------------------------------------

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
-- the once-per-resolution rule means nothing.
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

commit;
