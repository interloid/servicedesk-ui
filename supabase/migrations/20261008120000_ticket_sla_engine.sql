-- =====================================================
-- Ticket SLA engine, tags and auto-close
-- =====================================================
--
-- Until now a ticket carried an sla_policy_id and nothing measured it: no code
-- path created sla_events, so the SLA card on every ticket read "No SLA policy".
-- This migration makes the database own the whole clock, because tickets are
-- born in three places (the agent sheet, the CSV importer and the portal's
-- portal_create_request) and any rule kept in one of them would be missing from
-- the other two.
--
--   1. sla_events gains the bookkeeping a clock needs: when it started, the
--      target it is running against, the calendar it counts in, pause state, and
--      whether the warning / breach notifications have gone out.
--   2. Business-time arithmetic over business_hours.schedule_json and
--      holidays_json, in the calendar's own timezone. A policy with a calendar
--      counts business time; one without counts wall-clock time -- the same rule
--      the SLA editor uses to show "Business hours" vs "24/7".
--   3. Triggers that attach the right policy to a new ticket and keep its events
--      in step with the ticket: start, pause (Pending / On hold), resume,
--      complete (first public agent reply / resolve), restart on reopen, and
--      re-target when the priority or policy changes.
--   4. sla_tick(), run every minute by pg_cron: marks breaches, sends the
--      "due soon" warning and the breach notification (with escalation), and
--      auto-closes tickets left resolved for tenants.auto_close_after_days.
--   5. Agents may create tags, so tagging a ticket doesn't need a manager.
--
-- Needs 20261008110000_sla_notification_types.sql first.
-- Mirrors supabase/schemas/functions/17_sla_engine.sql,
-- triggers/tickets_sla.sql, tables/15_sla_events.sql, tables/03_tenants.sql
-- and policies/12_tags.sql.

------------------------------------------------------------
-- 0. Retire the September SLA triggers
------------------------------------------------------------
--
-- 20260902000000, 20260902090000 and 20260904000000 gave sla_events a first,
-- wall-clock-only set of triggers. Left in place they fight this engine:
-- trg_create_ticket_sla_events inserts a second row per clock on every new
-- ticket, which uq_ticket_sla_type rejects -- so every ticket insert fails --
-- and trg_recalculate_sla_on_priority_change deletes the clocks this engine
-- just re-targeted and restarts them from now() on the wall clock. The engine
-- below covers all three jobs (start, complete, re-target), and the
-- resolved_at / closed_at stamps live in the sync_tickets_resolution_stamps trigger
-- (20260926093000_csat_ratings.sql), so the old functions go too.

drop trigger if exists trg_create_ticket_sla_events on public.tickets;
drop trigger if exists complete_ticket_resolution on public.tickets;
drop trigger if exists trg_recalculate_sla_on_priority_change on public.tickets;
drop trigger if exists complete_first_response_on_message on public.ticket_messages;

drop function if exists public.create_ticket_sla_events();
drop function if exists public.complete_ticket_resolution();
drop function if exists public.recalculate_sla_on_priority_change();
drop function if exists public.complete_first_response();

------------------------------------------------------------
-- 1. Columns
------------------------------------------------------------

-- The warning lead time and escalation role. feature/sla-policy's
-- 20261002120000_sla_policy_editor_fields.sql adds the same two columns with the
-- same definitions (live already has them, added by hand), so whichever
-- migration runs first wins and the other is a no-op.
alter table public.sla_policies
    add column if not exists notify_before_mins integer not null default 15,
    add column if not exists escalate_to_role text not null default 'manager';

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'chk_sla_notify_before_mins'
    ) then
        alter table public.sla_policies
            add constraint chk_sla_notify_before_mins
            check (notify_before_mins between 1 and 1440);
    end if;
end
$$;

alter table public.sla_events
    add column if not exists started_at timestamptz,
    add column if not exists target_mins integer,
    add column if not exists business_hours_id uuid
        references public.business_hours(id) on delete set null,
    add column if not exists paused_at timestamptz,
    add column if not exists remaining_secs bigint,
    add column if not exists warned_at timestamptz,
    add column if not exists breach_notified_at timestamptz;

comment on column public.sla_events.started_at is
'When this clock started. The ticket''s created_at, or the reopen time for a restarted resolution clock.';
comment on column public.sla_events.target_mins is
'The target (minutes, business or wall-clock) the clock runs against; needed to re-target on a priority change.';
comment on column public.sla_events.business_hours_id is
'The calendar the clock counts in; null means wall-clock (24/7).';
comment on column public.sla_events.paused_at is
'Set while the ticket is Pending or On hold. due_at is then re-derived from remaining_secs on resume.';
comment on column public.sla_events.remaining_secs is
'SLA time left (business or wall-clock seconds) at the moment the clock was paused.';

-- Existing rows: their clock started when they were created, and their target
-- is whatever span they were given.
update public.sla_events
set started_at = created_at
where started_at is null;

update public.sla_events
set target_mins = greatest(
        1,
        round(extract(epoch from (due_at - started_at)) / 60)::integer
    )
where target_mins is null;

alter table public.sla_events
    alter column started_at set default now(),
    alter column started_at set not null;

create index if not exists idx_sla_events_tick
on public.sla_events(due_at)
where status = 'pending' and paused_at is null;

alter table public.tenants
    add column if not exists auto_close_after_days integer
        not null
        default 4;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'chk_tenants_auto_close_after_days'
    ) then
        alter table public.tenants
            add constraint chk_tenants_auto_close_after_days
            check (auto_close_after_days between 0 and 90);
    end if;
end
$$;

comment on column public.tenants.auto_close_after_days is
'Days a ticket may sit in Resolved before sla_tick() closes it. 0 turns auto-close off.';

------------------------------------------------------------
-- 2. Business-time arithmetic
------------------------------------------------------------
--
-- schedule_json is what onboarding and the SLA editor write:
--   { "working_days": ["Mon", ...], "day_start": "09:00", "day_end": "18:00" }
-- holidays_json is the editor's list:
--   [{ "date": "2026-12-25", "all_day": true, "repeats_yearly": true,
--      "start_time": "13:00", "end_time": "17:00", ... }]
--
-- All arithmetic is in epoch seconds rather than intervals: adding an interval
-- with a day part to a timestamptz adds a calendar day, which is 23 or 25 hours
-- across a DST change.

-- The calendar, parsed once per calculation. tz is null when the calendar is
-- missing or unusable (no working days, end not after start), and every caller
-- then falls back to wall-clock time rather than looping over empty days.
create or replace function public.sla_calendar(p_business_hours_id uuid)
returns table (
    tz text,
    working_days jsonb,
    day_start time,
    day_end time,
    holidays jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_schedule jsonb;
    v_holidays jsonb;
    v_tz text;
    v_start time;
    v_end time;
begin
    select bh.schedule_json, bh.holidays_json, z.code
    into v_schedule, v_holidays, v_tz
    from public.business_hours bh
    join public.timezones z on z.id = bh.timezone_id
    where bh.id = p_business_hours_id;

    if not found then
        return;
    end if;

    begin
        v_start := (v_schedule->>'day_start')::time;
        v_end := (v_schedule->>'day_end')::time;
    exception when others then
        return;
    end;

    if v_start is null
       or v_end is null
       or v_end <= v_start
       or jsonb_typeof(v_schedule->'working_days') is distinct from 'array'
       or jsonb_array_length(v_schedule->'working_days') = 0
    then
        return;
    end if;

    tz := v_tz;
    working_days := v_schedule->'working_days';
    day_start := v_start;
    day_end := v_end;
    holidays := case
        when jsonb_typeof(v_holidays) = 'array' then v_holidays
        else '[]'::jsonb
    end;
    return next;
end;
$$;

-- The working windows of one local date: the day's hours, minus an all-day
-- holiday (no windows) or a part-day one (a hole in the day).
create or replace function public.sla_day_windows(
    p_working_days jsonb,
    p_day_start time,
    p_day_end time,
    p_holidays jsonb,
    p_tz text,
    p_day date
)
returns setof tstzrange
language plpgsql
stable
set search_path = public
as $$
declare
    v_windows tstzmultirange;
    v_holiday jsonb;
    v_month_day text := to_char(p_day, 'MM-DD');
begin
    -- 'Dy' is the English three-letter day, which is what working_days holds.
    if not (p_working_days ? to_char(p_day, 'Dy')) then
        return;
    end if;

    v_windows := tstzmultirange(tstzrange(
        (p_day + p_day_start) at time zone p_tz,
        (p_day + p_day_end) at time zone p_tz,
        '[)'
    ));

    for v_holiday in
        select h
        from jsonb_array_elements(p_holidays) as h
        where h->>'date' = p_day::text
           or (
               h->'repeats_yearly' = 'true'::jsonb
               and substr(h->>'date', 6) = v_month_day
           )
    loop
        if v_holiday->'all_day' is distinct from 'false'::jsonb then
            return;
        end if;

        begin
            v_windows := v_windows - tstzmultirange(tstzrange(
                (p_day + (v_holiday->>'start_time')::time) at time zone p_tz,
                (p_day + (v_holiday->>'end_time')::time) at time zone p_tz,
                '[)'
            ));
        exception when others then
            -- A part-day holiday with unreadable times is ignored rather than
            -- taking the whole calculation down.
            null;
        end;
    end loop;

    return query
    select w
    from unnest(v_windows) as w
    order by lower(w);
end;
$$;

-- p_start plus p_secs of SLA time. Wall-clock when there is no usable calendar.
create or replace function public.sla_add_seconds(
    p_start timestamptz,
    p_secs bigint,
    p_business_hours_id uuid
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_tz text;
    v_days jsonb;
    v_start time;
    v_end time;
    v_holidays jsonb;
    v_remaining numeric := greatest(coalesce(p_secs, 0), 0);
    v_day date;
    v_window tstzrange;
    v_from timestamptz;
    v_avail numeric;
    v_guard integer := 0;
begin
    if p_business_hours_id is not null then
        select c.tz, c.working_days, c.day_start, c.day_end, c.holidays
        into v_tz, v_days, v_start, v_end, v_holidays
        from public.sla_calendar(p_business_hours_id) c;
    end if;

    if v_tz is null then
        return p_start + make_interval(secs => v_remaining);
    end if;

    v_day := (p_start at time zone v_tz)::date;

    -- Targets are capped at a year (MAX_DURATION_MINS); a year of 8-hour,
    -- 5-day weeks needs ~1,550 calendar days. Past the guard the calendar has
    -- next to no working time, and wall-clock is the honest answer.
    while v_guard < 4000 loop
        for v_window in
            select *
            from public.sla_day_windows(
                v_days, v_start, v_end, v_holidays, v_tz, v_day
            )
        loop
            v_from := greatest(lower(v_window), p_start);
            continue when v_from >= upper(v_window);

            -- Inside a window with nothing left: the deadline is right here.
            if v_remaining = 0 then
                return v_from;
            end if;

            v_avail := extract(epoch from upper(v_window))
                     - extract(epoch from v_from);

            if v_avail >= v_remaining then
                return v_from + make_interval(secs => v_remaining);
            end if;

            v_remaining := v_remaining - v_avail;
        end loop;

        v_day := v_day + 1;
        v_guard := v_guard + 1;
    end loop;

    return p_start + make_interval(secs => greatest(coalesce(p_secs, 0), 0));
end;
$$;

-- SLA seconds in [p_from, p_to). Zero when p_to is not after p_from.
create or replace function public.sla_seconds_between(
    p_from timestamptz,
    p_to timestamptz,
    p_business_hours_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_tz text;
    v_days jsonb;
    v_start time;
    v_end time;
    v_holidays jsonb;
    v_day date;
    v_last date;
    v_window tstzrange;
    v_total numeric := 0;
begin
    if p_to <= p_from then
        return 0;
    end if;

    if p_business_hours_id is not null then
        select c.tz, c.working_days, c.day_start, c.day_end, c.holidays
        into v_tz, v_days, v_start, v_end, v_holidays
        from public.sla_calendar(p_business_hours_id) c;
    end if;

    if v_tz is null then
        return floor(extract(epoch from p_to) - extract(epoch from p_from));
    end if;

    v_day := (p_from at time zone v_tz)::date;
    v_last := (p_to at time zone v_tz)::date;

    while v_day <= v_last loop
        for v_window in
            select *
            from public.sla_day_windows(
                v_days, v_start, v_end, v_holidays, v_tz, v_day
            )
        loop
            v_window := v_window * tstzrange(p_from, p_to, '[)');
            if not isempty(v_window) then
                v_total := v_total
                    + extract(epoch from upper(v_window))
                    - extract(epoch from lower(v_window));
            end if;
        end loop;

        v_day := v_day + 1;
    end loop;

    return floor(v_total);
end;
$$;

------------------------------------------------------------
-- 3. Which policy a ticket gets
------------------------------------------------------------
--
-- The rules the SLA editor enforces (scope-rules.ts): a customer is in at most
-- one active 'Selected customers' policy, which wins; otherwise the tenant's
-- active all-customers policy, the default first.

create or replace function public.sla_resolve_policy(
    p_tenant_id uuid,
    p_customer_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_policy uuid;
begin
    -- sla_policy_customers arrives with the SLA editor's "Selected customers"
    -- scope (20261005120000). Until that migration is applied every ticket
    -- takes the all-customers policy; dynamic SQL keeps this function valid
    -- either way.
    if p_customer_id is not null
       and to_regclass('public.sla_policy_customers') is not null then
        execute $q$
            select p.id
            from public.sla_policies p
            join public.sla_policy_customers pc on pc.policy_id = p.id
            where p.tenant_id = $1
              and p.status = 'active'
              and p.applies_to = 'Selected customers'
              and pc.customer_id = $2
            order by p.created_at
            limit 1
        $q$
        into v_policy
        using p_tenant_id, p_customer_id;
    end if;

    if v_policy is null then
        select p.id
        into v_policy
        from public.sla_policies p
        where p.tenant_id = p_tenant_id
          and p.status = 'active'
          and p.applies_to <> 'Selected customers'
        order by p.is_default desc, p.created_at
        limit 1;
    end if;

    return v_policy;
end;
$$;

------------------------------------------------------------
-- 4. Clock operations
------------------------------------------------------------

-- Start (or restart) one clock for a ticket from p_start, against the ticket's
-- policy and priority. No target for that priority means no clock: any pending
-- one is removed, since it no longer describes a promise.
create or replace function public.sla_start_event(
    p_ticket public.tickets,
    p_type public.sla_event_type,
    p_start timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_mins integer;
    v_calendar uuid;
begin
    select
        case p_type
            when 'first_response' then t.first_response_mins
            else t.resolution_mins
        end,
        p.business_hours_id
    into v_mins, v_calendar
    from public.sla_policy_targets t
    join public.sla_policies p on p.id = t.policy_id
    where t.policy_id = p_ticket.sla_policy_id
      and t.priority_scope = p_ticket.priority;

    if v_mins is null then
        delete from public.sla_events
        where ticket_id = p_ticket.id
          and type = p_type
          and status = 'pending';
        return;
    end if;

    insert into public.sla_events (
        tenant_id, ticket_id, type, status,
        started_at, target_mins, business_hours_id, due_at
    )
    values (
        p_ticket.tenant_id, p_ticket.id, p_type, 'pending',
        p_start, v_mins, v_calendar,
        public.sla_add_seconds(p_start, v_mins::bigint * 60, v_calendar)
    )
    on conflict (ticket_id, type) do update
    set status = 'pending',
        started_at = excluded.started_at,
        target_mins = excluded.target_mins,
        business_hours_id = excluded.business_hours_id,
        due_at = excluded.due_at,
        completed_at = null,
        breached_at = null,
        paused_at = null,
        remaining_secs = null,
        warned_at = null,
        breach_notified_at = null;
end;
$$;

-- Move a running (or paused) clock onto the ticket's current policy/priority,
-- keeping the SLA time already used. Lowering the priority gives the time back;
-- raising it can leave nothing, in which case the next tick breaches it.
create or replace function public.sla_retarget_event(
    p_ticket public.tickets,
    p_event public.sla_events
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_mins integer;
    v_calendar uuid;
    v_left bigint;
    v_used bigint;
    v_new_left bigint;
begin
    select
        case p_event.type
            when 'first_response' then t.first_response_mins
            else t.resolution_mins
        end,
        p.business_hours_id
    into v_mins, v_calendar
    from public.sla_policy_targets t
    join public.sla_policies p on p.id = t.policy_id
    where t.policy_id = p_ticket.sla_policy_id
      and t.priority_scope = p_ticket.priority;

    if v_mins is null then
        delete from public.sla_events where id = p_event.id;
        return;
    end if;

    v_left := case
        when p_event.paused_at is not null then coalesce(p_event.remaining_secs, 0)
        else public.sla_seconds_between(now(), p_event.due_at, p_event.business_hours_id)
    end;
    v_used := greatest(coalesce(p_event.target_mins, v_mins)::bigint * 60 - v_left, 0);
    v_new_left := greatest(v_mins::bigint * 60 - v_used, 0);

    update public.sla_events
    set target_mins = v_mins,
        business_hours_id = v_calendar,
        remaining_secs = case when paused_at is not null then v_new_left end,
        due_at = public.sla_add_seconds(now(), v_new_left, v_calendar),
        warned_at = null
    where id = p_event.id;
end;
$$;

-- Stop a clock: met when it finished in time (or while paused, which can only
-- have been in time), breached at its deadline otherwise. A late finish is
-- recorded as breached without a breach notification -- the work is done.
create or replace function public.sla_finish_events(
    p_ticket_id uuid,
    p_type public.sla_event_type,
    p_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.sla_events e
    set status = case
            when e.paused_at is not null or p_at <= e.due_at then 'completed'
            else 'breached'
        end::public.sla_event_status,
        completed_at = case
            when e.paused_at is not null or p_at <= e.due_at then p_at
        end,
        breached_at = case
            when e.paused_at is null and p_at > e.due_at then e.due_at
        end,
        breach_notified_at = case
            when e.paused_at is null and p_at > e.due_at then now()
        end,
        paused_at = null,
        remaining_secs = null
    where e.ticket_id = p_ticket_id
      and (p_type is null or e.type = p_type)
      and e.status = 'pending';
end;
$$;

------------------------------------------------------------
-- 5. Triggers on tickets and ticket_messages
------------------------------------------------------------

-- BEFORE INSERT: the database picks the policy. None of the three creation
-- paths can be trusted to apply the 'Selected customers' rule (the portal took
-- the default regardless), so the resolver wins whenever it finds one.
create or replace function public.tickets_assign_sla_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    new.sla_policy_id := coalesce(
        public.sla_resolve_policy(new.tenant_id, new.requester_customer_id),
        new.sla_policy_id
    );
    return new;
end;
$$;

create or replace trigger tickets_assign_sla_policy
before insert on public.tickets
for each row
execute function public.tickets_assign_sla_policy();

-- AFTER INSERT / UPDATE: keep the ticket's clocks in step with it.
create or replace function public.tickets_sync_sla()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_terminal constant public.ticket_status[] := array['resolved', 'closed']::public.ticket_status[];
    v_waiting constant public.ticket_status[] := array['pending', 'on_hold']::public.ticket_status[];
    v_event public.sla_events;
    v_type public.sla_event_type;
begin
    ----------------------------------------------------------
    -- New ticket: start both clocks from creation.
    ----------------------------------------------------------
    if tg_op = 'INSERT' then
        if new.sla_policy_id is null or new.status = any (v_terminal) then
            return null;
        end if;

        if new.first_response_at is null then
            perform public.sla_start_event(new, 'first_response', new.created_at);
        end if;
        perform public.sla_start_event(new, 'resolution', new.created_at);

        if new.status = any (v_waiting) then
            update public.sla_events
            set paused_at = now(),
                remaining_secs = public.sla_seconds_between(now(), due_at, business_hours_id)
            where ticket_id = new.id and status = 'pending' and due_at > now();
        end if;

        return null;
    end if;

    ----------------------------------------------------------
    -- First public agent reply stamps first_response_at.
    ----------------------------------------------------------
    if old.first_response_at is null and new.first_response_at is not null then
        perform public.sla_finish_events(new.id, 'first_response', new.first_response_at);
    end if;

    ----------------------------------------------------------
    -- Resolved / closed: every running clock stops. Resolving
    -- without a reply also answers the first response.
    ----------------------------------------------------------
    if new.status = any (v_terminal) then
        if not (old.status = any (v_terminal)) then
            perform public.sla_finish_events(new.id, null, now());
        end if;
        return null;
    end if;

    ----------------------------------------------------------
    -- Reopened: the resolution promise starts again. A clock
    -- that was breached stays breached -- that happened.
    ----------------------------------------------------------
    if old.status = any (v_terminal) and new.sla_policy_id is not null then
        if not exists (
            select 1 from public.sla_events
            where ticket_id = new.id and type = 'resolution' and status = 'breached'
        ) then
            perform public.sla_start_event(new, 'resolution', now());
        end if;
    end if;

    ----------------------------------------------------------
    -- Policy or priority changed: re-target what is running,
    -- start what is missing, drop what no longer applies.
    ----------------------------------------------------------
    if new.sla_policy_id is distinct from old.sla_policy_id
       or new.priority is distinct from old.priority
    then
        if new.sla_policy_id is null then
            delete from public.sla_events
            where ticket_id = new.id and status = 'pending';
        else
            foreach v_type in array array['first_response', 'resolution']::public.sla_event_type[] loop
                select * into v_event
                from public.sla_events
                where ticket_id = new.id and type = v_type;

                if not found then
                    if v_type = 'resolution' or new.first_response_at is null then
                        perform public.sla_start_event(new, v_type, new.created_at);
                    end if;
                elsif v_event.status = 'pending' then
                    perform public.sla_retarget_event(new, v_event);
                end if;
            end loop;
        end if;
    end if;

    ----------------------------------------------------------
    -- Waiting on the customer (Pending / On hold) pauses the
    -- clocks; leaving it resumes them with the time they had.
    -- A clock already past its deadline isn't paused -- the
    -- next tick breaches it.
    ----------------------------------------------------------
    if new.status = any (v_waiting)
       and (not (old.status = any (v_waiting)) or old.status = any (v_terminal))
    then
        update public.sla_events
        set paused_at = now(),
            remaining_secs = public.sla_seconds_between(now(), due_at, business_hours_id)
        where ticket_id = new.id
          and status = 'pending'
          and paused_at is null
          and due_at > now();
    elsif not (new.status = any (v_waiting)) and old.status = any (v_waiting) then
        update public.sla_events
        set due_at = public.sla_add_seconds(now(), coalesce(remaining_secs, 0), business_hours_id),
            paused_at = null,
            remaining_secs = null
        where ticket_id = new.id
          and status = 'pending'
          and paused_at is not null;
    end if;

    return null;
end;
$$;

create or replace trigger tickets_sync_sla
after insert or update of status, priority, sla_policy_id, first_response_at
on public.tickets
for each row
execute function public.tickets_sync_sla();

-- The first public reply from an agent is the first response. Internal notes
-- aren't -- the customer never sees them.
create or replace function public.stamp_ticket_first_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.author_type = 'agent' and new.visibility = 'public' then
        update public.tickets
        set first_response_at = new.created_at
        where id = new.ticket_id
          and first_response_at is null;
    end if;
    return new;
end;
$$;

create or replace trigger stamp_ticket_first_response
after insert on public.ticket_messages
for each row
execute function public.stamp_ticket_first_response();

------------------------------------------------------------
-- 6. The minute tick
------------------------------------------------------------

-- Who hears about a ticket's SLA: its assignee while they are still an active
-- staff member, otherwise the tenant's managers and admins; plus, for an
-- escalation, everyone in the escalation role.
create or replace function public.sla_recipients(
    p_tenant_id uuid,
    p_assignee uuid,
    p_escalate_to_role text
)
returns table (user_id uuid, escalated boolean)
language sql
stable
security definer
set search_path = public
as $$
    with assignee as (
        select m.user_id
        from public.memberships m
        where m.tenant_id = p_tenant_id
          and m.user_id = p_assignee
          and m.status = 'active'
          and m.role in ('tenant_admin', 'manager', 'agent')
    ),
    fallback as (
        select m.user_id
        from public.memberships m
        where m.tenant_id = p_tenant_id
          and m.status = 'active'
          and m.role in ('tenant_admin', 'manager')
          and not exists (select 1 from assignee)
    ),
    escalation as (
        select m.user_id
        from public.memberships m
        where m.tenant_id = p_tenant_id
          and m.status = 'active'
          and p_escalate_to_role is not null
          and m.role::text = p_escalate_to_role
    ),
    everyone as (
        select a.user_id, false as escalated from assignee a
        union all
        select f.user_id, false from fallback f
        union all
        select e.user_id, true from escalation e
    )
    select e.user_id, bool_and(e.escalated)
    from everyone e
    group by e.user_id;
$$;

create or replace function public.sla_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_breached integer;
    v_breach_notices integer := 0;
    v_warnings integer := 0;
    v_closed integer;
    r record;
begin
    ----------------------------------------------------------
    -- Breaches. breached_at is the deadline itself, so
    -- "Breached after 4h" reads the target, not tick latency.
    ----------------------------------------------------------
    update public.sla_events
    set status = 'breached',
        breached_at = due_at
    where status = 'pending'
      and paused_at is null
      and due_at <= now();

    get diagnostics v_breached = row_count;

    -- A breach on a ticket that has since been resolved isn't news.
    update public.sla_events e
    set breach_notified_at = now()
    from public.tickets t
    where t.id = e.ticket_id
      and e.status = 'breached'
      and e.breach_notified_at is null
      and t.status in ('resolved', 'closed');

    for r in
        select
            e.id, e.type, e.tenant_id, e.ticket_id,
            t.number, t.subject, t.assignee_user_id,
            p.escalate_on_breach, p.escalate_to_role
        from public.sla_events e
        join public.tickets t on t.id = e.ticket_id
        left join public.sla_policies p on p.id = t.sla_policy_id
        where e.status = 'breached'
          and e.breach_notified_at is null
        for update of e skip locked
    loop
        insert into public.notifications (tenant_id, user_id, type, payload_json)
        select
            r.tenant_id,
            rc.user_id,
            'sla_breach',
            jsonb_build_object(
                'ticket_id', r.ticket_id,
                'ticket_number', r.number,
                'subject', r.subject,
                'sla_event_id', r.id,
                'sla_type', r.type,
                'escalated', rc.escalated,
                'title', case
                    when rc.escalated then 'Escalated: SLA breached on #' || r.number
                    else 'SLA breached on #' || r.number
                end,
                'body', case r.type
                    when 'first_response' then 'First response is overdue for "'
                    else 'Resolution is overdue for "'
                end || r.subject || '".'
            )
        from public.sla_recipients(
            r.tenant_id,
            r.assignee_user_id,
            case when r.escalate_on_breach then r.escalate_to_role::text end
        ) rc;

        update public.sla_events set breach_notified_at = now() where id = r.id;
        v_breach_notices := v_breach_notices + 1;
    end loop;

    ----------------------------------------------------------
    -- Warnings: notify_before_mins ahead of the deadline, on
    -- policies that ask for it. Once per clock (re-armed when
    -- the clock is re-targeted or restarted).
    ----------------------------------------------------------
    for r in
        select
            e.id, e.type, e.tenant_id, e.ticket_id, e.due_at,
            t.number, t.subject, t.assignee_user_id
        from public.sla_events e
        join public.tickets t on t.id = e.ticket_id
        join public.sla_policies p on p.id = t.sla_policy_id
        where e.status = 'pending'
          and e.paused_at is null
          and e.warned_at is null
          and e.due_at > now()
          and p.notify_before_breach
          and e.due_at - make_interval(mins => p.notify_before_mins) <= now()
          and t.status not in ('resolved', 'closed')
        for update of e skip locked
    loop
        insert into public.notifications (tenant_id, user_id, type, payload_json)
        select
            r.tenant_id,
            rc.user_id,
            'sla_warning',
            jsonb_build_object(
                'ticket_id', r.ticket_id,
                'ticket_number', r.number,
                'subject', r.subject,
                'sla_event_id', r.id,
                'sla_type', r.type,
                'due_at', r.due_at,
                'title', 'SLA due soon on #' || r.number,
                'body', case r.type
                    when 'first_response' then 'First response'
                    else 'Resolution'
                end || ' is due in '
                    || greatest(1, ceil(extract(epoch from (r.due_at - now())) / 60))::integer
                    || ' min for "' || r.subject || '".'
            )
        from public.sla_recipients(r.tenant_id, r.assignee_user_id, null) rc;

        update public.sla_events set warned_at = now() where id = r.id;
        v_warnings := v_warnings + 1;
    end loop;

    ----------------------------------------------------------
    -- Auto-close tickets left resolved. Status only: the
    -- resolution stamps trigger fills closed_at.
    ----------------------------------------------------------
    update public.tickets t
    set status = 'closed'
    from public.tenants tn
    where tn.id = t.tenant_id
      and t.status = 'resolved'
      and tn.auto_close_after_days > 0
      and t.resolved_at <= now() - make_interval(days => tn.auto_close_after_days);

    get diagnostics v_closed = row_count;

    return jsonb_build_object(
        'breached', v_breached,
        'breach_notices', v_breach_notices,
        'warnings', v_warnings,
        'auto_closed', v_closed
    );
end;
$$;

comment on function public.sla_tick() is
'Every minute (pg_cron): breach overdue SLA clocks, send due-soon and breach notifications (with escalation), auto-close tickets left resolved.';

-- The list page still calls this as the signed-in user, so a tenant without a
-- working cron sees breaches the moment they open the queue. RLS scopes it to
-- their tenant; it now skips paused clocks and stamps the deadline.
create or replace function public.process_sla_breaches()
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

revoke execute on function public.sla_tick() from public, anon, authenticated;
revoke execute on function public.sla_start_event(public.tickets, public.sla_event_type, timestamptz) from public, anon, authenticated;
revoke execute on function public.sla_retarget_event(public.tickets, public.sla_events) from public, anon, authenticated;
revoke execute on function public.sla_finish_events(uuid, public.sla_event_type, timestamptz) from public, anon, authenticated;
revoke execute on function public.sla_recipients(uuid, uuid, text) from public, anon, authenticated;

------------------------------------------------------------
-- 7. Tags: agents may create them
------------------------------------------------------------
--
-- Agents could already attach tags (ticket_tags_insert) but not create one, so
-- tagging a ticket with anything new needed a manager. Renaming and deleting
-- stay with managers and admins.

drop policy if exists "tags_insert" on public.tags;

create policy "tags_insert"
on public.tags
for insert
to authenticated
with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in (
        'tenant_admin',
        'manager',
        'agent'
    )
);

------------------------------------------------------------
-- 8. Backfill open tickets
------------------------------------------------------------
--
-- Clocks are measured from each ticket's creation, so long-open tickets come
-- out breached. That is the truth, but not news: their breach and warning
-- notifications are marked sent so the first tick doesn't flood every inbox.

alter table public.tickets disable trigger set_tickets_updated_at;

update public.tickets t
set sla_policy_id = public.sla_resolve_policy(t.tenant_id, t.requester_customer_id)
where t.sla_policy_id is null
  and t.status not in ('resolved', 'closed');

alter table public.tickets enable trigger set_tickets_updated_at;

do $$
declare
    v_ticket public.tickets;
begin
    for v_ticket in
        select t.*
        from public.tickets t
        where t.sla_policy_id is not null
          and t.status not in ('resolved', 'closed')
    loop
        if v_ticket.first_response_at is null and not exists (
            select 1 from public.sla_events
            where ticket_id = v_ticket.id and type = 'first_response'
        ) then
            perform public.sla_start_event(v_ticket, 'first_response', v_ticket.created_at);
        end if;

        if not exists (
            select 1 from public.sla_events
            where ticket_id = v_ticket.id and type = 'resolution'
        ) then
            perform public.sla_start_event(v_ticket, 'resolution', v_ticket.created_at);
        end if;

        if v_ticket.status in ('pending', 'on_hold') then
            update public.sla_events
            set paused_at = now(),
                remaining_secs = public.sla_seconds_between(now(), due_at, business_hours_id)
            where ticket_id = v_ticket.id
              and status = 'pending'
              and paused_at is null
              and due_at > now();
        end if;
    end loop;
end
$$;

update public.sla_events
set status = 'breached',
    breached_at = coalesce(breached_at, due_at)
where status = 'pending'
  and paused_at is null
  and due_at <= now();

update public.sla_events
set breach_notified_at = now()
where status = 'breached'
  and breach_notified_at is null;

update public.sla_events e
set warned_at = now()
from public.tickets t
join public.sla_policies p on p.id = t.sla_policy_id
where t.id = e.ticket_id
  and e.status = 'pending'
  and e.warned_at is null
  and e.due_at - make_interval(mins => p.notify_before_mins) <= now();

------------------------------------------------------------
-- 9. Schedule
------------------------------------------------------------

create extension if not exists pg_cron;

do $$
begin
    if exists (select 1 from cron.job where jobname = 'sla-tick-every-minute') then
        perform cron.unschedule('sla-tick-every-minute');
    end if;
end
$$;

select cron.schedule(
    'sla-tick-every-minute',
    '* * * * *',
    $$ select public.sla_tick(); $$
);
