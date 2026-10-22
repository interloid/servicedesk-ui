-- ==========================================================
-- File: 17_sla_engine.sql
-- Description: SLA clocks -- business-time arithmetic, policy
-- resolution, clock operations and the 15-minute tick
-- ==========================================================
--
-- The triggers that drive these live in triggers/tickets_sla.sql. Migration:
-- 20261009140000_ticket_sla_engine.sql, whose header explains the design.

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

-- The policy target in the minutes the clock counts. Since
-- 20261009120000_sla_target_units.sql targets are stored as the minutes the
-- clock counts -- a business "day" is already one working day of the policy's
-- calendar -- so this is a pass-through. It used to turn whole multiples of
-- 1440 into working days; doing that on top of the stored working minutes
-- would shrink every "days" target (8 days of 09:00-18:00 = 4320 = 3 * 1440
-- would count as 3 working days). Same signature and body as 20261009120000,
-- so the clock operations below call it unchanged.
create or replace function public.sla_target_mins(
    p_mins integer,
    p_business_hours_id uuid
)
returns integer
language sql
immutable
set search_path = public
as $$
    select p_mins;
$$;

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

    v_mins := public.sla_target_mins(v_mins, v_calendar);

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

    v_mins := public.sla_target_mins(v_mins, v_calendar);

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

-- Turn queued SLA alerts into notifications. Each job is re-checked first, so
-- an alert whose clock has moved on since sla_tick() queued it (met, paused,
-- re-targeted, ticket resolved) is skipped rather than sent stale.
--
-- Recipients come from sla_recipients(); anyone who switched SLA alerts off
-- for both in-app and email in the notification center is left out. The rest
-- get a notification row: the bell hides it when their in-app switch is off,
-- and queue_notification_email() mails it when their email switch is on.
--
-- A job that errors stays pending for the next tick, up to max_attempts.
create or replace function public.process_sla_alert_jobs(p_limit integer default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_sent integer := 0;
    v_skipped integer := 0;
    v_failed integer := 0;
    v_recipients integer;
    j record;
    r record;
begin
    for j in
        select q.id, q.kind, q.sla_event_id
        from public.sla_alert_jobs q
        where q.status = 'pending'
          and q.attempts < q.max_attempts
        order by q.created_at
        limit p_limit
        for update skip locked
    loop
        begin
            select
                e.id, e.type, e.tenant_id, e.ticket_id, e.due_at,
                t.number, t.subject, t.assignee_user_id,
                p.escalate_on_breach, p.escalate_to_role
            into r
            from public.sla_events e
            join public.tickets t on t.id = e.ticket_id
            left join public.sla_policies p on p.id = t.sla_policy_id
            where e.id = j.sla_event_id
              and t.status not in ('resolved', 'closed')
              and (
                    (j.kind = 'sla_breach' and e.status = 'breached')
                 or (j.kind = 'sla_warning'
                     and e.status = 'pending'
                     and e.paused_at is null
                     and e.warned_at is not null
                     and e.due_at > now())
                  );

            if not found then
                update public.sla_alert_jobs
                set status = 'skipped',
                    attempts = attempts + 1,
                    processed_at = now()
                where id = j.id;
                v_skipped := v_skipped + 1;
                continue;
            end if;

            insert into public.notifications (tenant_id, user_id, type, payload_json)
            select
                r.tenant_id,
                rc.user_id,
                j.kind::public.notification_type,
                case j.kind
                    when 'sla_breach' then jsonb_build_object(
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
                    else jsonb_build_object(
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
                end
            from public.sla_recipients(
                r.tenant_id,
                r.assignee_user_id,
                case
                    when j.kind = 'sla_breach' and r.escalate_on_breach
                    then r.escalate_to_role::text
                end
            ) rc
            left join public.notification_prefs np
                on np.tenant_id = r.tenant_id
               and np.user_id = rc.user_id
            -- A missing, legacy or non-boolean switch counts as on, as in
            -- defaultNotificationPrefs().
            where coalesce(np.channel_json -> 'in_app' -> 'sla', 'true'::jsonb) <> 'false'::jsonb
               or coalesce(np.channel_json -> 'email' -> 'sla', 'true'::jsonb) <> 'false'::jsonb;

            get diagnostics v_recipients = row_count;

            update public.sla_alert_jobs
            set status = 'sent',
                attempts = attempts + 1,
                recipients = v_recipients,
                last_error = null,
                processed_at = now()
            where id = j.id;
            v_sent := v_sent + 1;
        exception when others then
            update public.sla_alert_jobs
            set attempts = attempts + 1,
                last_error = sqlerrm,
                status = case
                    when attempts + 1 >= max_attempts then 'failed'
                    else 'pending'
                end,
                processed_at = case
                    when attempts + 1 >= max_attempts then now()
                end
            where id = j.id;
            v_failed := v_failed + 1;
        end;
    end loop;

    return jsonb_build_object(
        'sent', v_sent,
        'skipped', v_skipped,
        'failed', v_failed
    );
end;
$$;

comment on function public.process_sla_alert_jobs(integer) is
'Drain sla_alert_jobs: re-check each queued SLA alert and notify its recipients, honouring their SLA in-app/email preferences.';

-- Every 15 minutes (pg_cron). Detection only: overdue clocks are marked
-- breached and their alerts queued in sla_alert_jobs, along with due-soon
-- warnings; the queue is then drained into notifications.
--
-- The app works out breaches from due_at itself (computeSlaClock), so the
-- tick only has to be on time for alerts. Warnings look one tick ahead -- a
-- warning due before the next run goes out now, slightly early, rather than
-- after the deadline it warns about.
create or replace function public.sla_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    -- Keep in step with the cron schedule below.
    v_lookahead constant interval := interval '15 minutes';
    v_breached integer;
    v_breach_alerts integer;
    v_warning_alerts integer;
    v_closed integer;
    v_alerts jsonb;
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

    -- Queue each breach once. A breach on a ticket that has since been
    -- resolved isn't news: it is stamped but not queued.
    with claimed as (
        update public.sla_events e
        set breach_notified_at = now()
        where e.status = 'breached'
          and e.breach_notified_at is null
        returning e.id, e.tenant_id, e.ticket_id
    )
    insert into public.sla_alert_jobs (tenant_id, sla_event_id, kind)
    select c.tenant_id, c.id, 'sla_breach'
    from claimed c
    join public.tickets t on t.id = c.ticket_id
    where t.status not in ('resolved', 'closed');

    get diagnostics v_breach_alerts = row_count;

    ----------------------------------------------------------
    -- Warnings: notify_before_mins ahead of the deadline, on
    -- policies that ask for it. Once per clock (re-armed when
    -- the clock is re-targeted or restarted).
    ----------------------------------------------------------
    with claimed as (
        update public.sla_events e
        set warned_at = now()
        from public.tickets t
        join public.sla_policies p on p.id = t.sla_policy_id
        where t.id = e.ticket_id
          and e.status = 'pending'
          and e.paused_at is null
          and e.warned_at is null
          and e.due_at > now()
          -- notify_before_mins is at most 1440 (chk_sla_notify_before_mins),
          -- so only the next day's deadlines can be due a warning; the bound
          -- keeps this an index range on idx_sla_events_warn.
          and e.due_at <= now() + interval '1440 minutes' + v_lookahead
          and p.notify_before_breach
          and e.due_at - make_interval(mins => p.notify_before_mins) <= now() + v_lookahead
          and t.status not in ('resolved', 'closed')
        returning e.id, e.tenant_id
    )
    insert into public.sla_alert_jobs (tenant_id, sla_event_id, kind)
    select c.tenant_id, c.id, 'sla_warning'
    from claimed c;

    get diagnostics v_warning_alerts = row_count;

    ----------------------------------------------------------
    -- Send what's queued, including retries from earlier runs.
    ----------------------------------------------------------
    v_alerts := public.process_sla_alert_jobs();

    delete from public.sla_alert_jobs
    where status <> 'pending'
      and processed_at < now() - interval '30 days';

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
        'breach_alerts_queued', v_breach_alerts,
        'warning_alerts_queued', v_warning_alerts,
        'alerts', v_alerts,
        'auto_closed', v_closed
    );
end;
$$;

comment on function public.sla_tick() is
'Every 15 minutes (pg_cron): breach overdue SLA clocks, queue breach and due-soon alerts in sla_alert_jobs and send them, auto-close tickets left resolved.';

revoke execute on function public.sla_tick() from public, anon, authenticated;
revoke execute on function public.process_sla_alert_jobs(integer) from public, anon, authenticated;
revoke execute on function public.sla_start_event(public.tickets, public.sla_event_type, timestamptz) from public, anon, authenticated;
revoke execute on function public.sla_retarget_event(public.tickets, public.sla_events) from public, anon, authenticated;
revoke execute on function public.sla_finish_events(uuid, public.sla_event_type, timestamptz) from public, anon, authenticated;
revoke execute on function public.sla_recipients(uuid, uuid, text) from public, anon, authenticated;
-- The arithmetic and resolver helpers are internal too: as SECURITY DEFINER
-- RPCs they read any tenant's calendar and policies, and sla_seconds_between
-- over a wide range ties up a connection. Only the definer functions above and
-- the triggers call them.
revoke execute on function public.sla_calendar(uuid) from public, anon, authenticated;
revoke execute on function public.sla_day_windows(jsonb, time, time, jsonb, text, date) from public, anon, authenticated;
revoke execute on function public.sla_add_seconds(timestamptz, bigint, uuid) from public, anon, authenticated;
revoke execute on function public.sla_seconds_between(timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.sla_target_mins(integer, uuid) from public, anon, authenticated;
revoke execute on function public.sla_resolve_policy(uuid, uuid) from public, anon, authenticated;

-- Every 15 minutes. Replaces the original every-minute job.
create extension if not exists pg_cron;

do $$
begin
    if exists (select 1 from cron.job where jobname = 'sla-tick-every-minute') then
        perform cron.unschedule('sla-tick-every-minute');
    end if;
    if exists (select 1 from cron.job where jobname = 'sla-tick-every-15-minutes') then
        perform cron.unschedule('sla-tick-every-15-minutes');
    end if;
end
$$;

select cron.schedule(
    'sla-tick-every-15-minutes',
    '*/15 * * * *',
    $$ select public.sla_tick(); $$
);
