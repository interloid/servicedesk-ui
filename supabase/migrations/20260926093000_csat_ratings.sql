-- ==========================================================
-- File: 20260926093000_csat_ratings.sql
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
--
-- set_tickets_updated_at is switched off across both statements. It fires on
-- every UPDATE and stamps `updated_at = now()`, so without this every historical
-- resolved ticket would come out of the migration looking as though it had just
-- been touched -- which is what the portal's "recently updated" sort and the
-- customers list's "last activity" both read. The backfill is a correction to
-- history, not activity, and must not look like any.
alter table public.tickets disable trigger set_tickets_updated_at;

update public.tickets
set resolved_at = updated_at
where status = 'resolved'
  and resolved_at is null;

update public.tickets
set closed_at = updated_at
where status = 'closed'
  and closed_at is null;

alter table public.tickets enable trigger set_tickets_updated_at;

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

-- The mean score per customer, computed by the database.
--
-- The customers list needs one average per customer and used to read every
-- rating in the tenant to work it out in the browser. PostgREST caps a response
-- at `max_rows` (1000 in supabase/config.toml) and truncates silently, so past
-- that point the average is computed from an arbitrary prefix and nobody is
-- told. Aggregating here makes the answer independent of how many ratings exist.
--
-- security_invoker, so the view reads csat_ratings as the caller rather than as
-- its owner. Without it a view is a security definer function, and this one
-- would hand every customer of a tenant the mean score of all of them.
create or replace view public.customer_csat
with (security_invoker = true)
as
select
    tenant_id,
    customer_id,
    avg(score)::numeric(3, 2) as avg_score,
    count(*) as ratings
from public.csat_ratings
group by tenant_id, customer_id;

comment on view public.customer_csat is
'Mean CSAT score and rating count per customer. Aggregated in SQL so the answer does not depend on how many rows the API is willing to return in one response.';

-- One row per customer with the facts the Customers list shows and sorts by.
-- Ticket count, last activity and CSAT are aggregates, so the list cannot sort
-- or page by them on the base table; doing it here keeps every column sortable
-- in SQL rather than in the browser over a capped result.
--
-- security_invoker for the same reason as customer_csat: the caller's RLS on
-- customers, tickets and csat_ratings applies, not the view owner's.
-- greatest() ignores nulls, so last_activity_at is the newer of the latest
-- ticket update and the last portal sign-in, or null when there is neither.
create or replace view public.customer_list
with (security_invoker = true)
as
select
    c.id,
    c.tenant_id,
    c.full_name,
    c.email,
    c.company,
    c.created_at,
    c.portal_user_id,
    c.portal_last_login_at,
    coalesce(t.ticket_count, 0)::integer as ticket_count,
    greatest(t.latest_updated_at, c.portal_last_login_at) as last_activity_at,
    s.avg_score as csat_score,
    coalesce(s.ratings, 0)::integer as csat_count
from public.customers c
left join lateral (
    select
        count(*) as ticket_count,
        max(tk.updated_at) as latest_updated_at
    from public.tickets tk
    where tk.requester_customer_id = c.id
      and tk.tenant_id = c.tenant_id
) t on true
left join public.customer_csat s
    on s.customer_id = c.id
   and s.tenant_id = c.tenant_id;

comment on view public.customer_list is
'Customers with ticket count, last activity and CSAT, so the agent-side Customers list can search, sort and page every column in SQL.';

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
-- 2b. What a customer may change
------------------------------------------------------------
--
-- The policies below already restrict a rating to its own ticket and its own
-- resolution, which is enough for "you may only rate what you were shown". It
-- is not enough for "a rating is a record of one moment": the UPDATE policy
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

drop trigger if exists csat_ratings_guard on public.csat_ratings;

create trigger csat_ratings_guard
before insert or update on public.csat_ratings
for each row
execute function public.csat_ratings_guard();

------------------------------------------------------------
-- 3. RLS
------------------------------------------------------------

alter table public.csat_ratings enable row level security;

-- SELECT: staff read everything in their tenant for reporting; a customer
-- reads only their own scores.
drop policy if exists "csat_ratings_select"
on public.csat_ratings;

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
        or exists (
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
-- here because the trigger above overwrites it from the ticket.
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
-- Which columns may move at all is decided by csat_ratings_guard above, not
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

commit;
