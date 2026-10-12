-- ==========================================================
-- File: 19_sla_calendar_retime.sql
-- Description: re-time running SLA clocks when their business
-- hours calendar (hours, holidays, time zone) changes
-- ==========================================================

-- SLA seconds in [p_from, p_to) on explicitly given calendar rules, for when
-- the business_hours row no longer holds them (the OLD row in a trigger).
-- Same rules as sla_calendar + sla_seconds_between: wall-clock when the
-- schedule is unusable.
create or replace function public.sla_seconds_between_on(
    p_from timestamptz,
    p_to timestamptz,
    p_schedule jsonb,
    p_holidays jsonb,
    p_tz text
)
returns bigint
language plpgsql
stable
set search_path = public
as $$
declare
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

    begin
        v_start := (p_schedule->>'day_start')::time;
        v_end := (p_schedule->>'day_end')::time;
    exception when others then
        v_start := null;
    end;

    if p_tz is null
       or v_start is null
       or v_end is null
       or v_end <= v_start
       or jsonb_typeof(p_schedule->'working_days') is distinct from 'array'
       or jsonb_array_length(p_schedule->'working_days') = 0
    then
        return floor(extract(epoch from p_to) - extract(epoch from p_from));
    end if;

    v_holidays := case
        when jsonb_typeof(p_holidays) = 'array' then p_holidays
        else '[]'::jsonb
    end;

    v_day := (p_from at time zone p_tz)::date;
    v_last := (p_to at time zone p_tz)::date;

    while v_day <= v_last loop
        for v_window in
            select *
            from public.sla_day_windows(
                p_schedule->'working_days', v_start, v_end, v_holidays, p_tz, v_day
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

create or replace function public.business_hours_retime_sla_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now timestamptz := now();
    v_old_tz text;
    v_event public.sla_events;
    v_target bigint;
    v_used bigint;
    v_credit bigint;
    v_due timestamptz;
begin
    select z.code into v_old_tz
    from public.timezones z
    where z.id = old.timezone_id;

    for v_event in
        select *
        from public.sla_events e
        where e.business_hours_id = new.id
          and e.status = 'pending'
          and e.paused_at is null
          and e.target_mins is not null
        for update
    loop
        v_target := v_event.target_mins::bigint * 60;

        -- Time used so far, on the old rules.
        v_used := greatest(
            v_target - public.sla_seconds_between_on(
                v_now, v_event.due_at,
                old.schedule_json, old.holidays_json, v_old_tz
            ),
            0
        );
        -- Up to the deadline only: an overdue clock that the next tick
        -- has yet to breach paused for none of its overdue time.
        v_credit := greatest(
            public.sla_seconds_between_on(
                v_event.started_at, least(v_now, v_event.due_at),
                old.schedule_json, old.holidays_json, v_old_tz
            ) - v_used,
            0
        );

        v_due := public.sla_add_seconds(
            v_event.started_at, v_target + v_credit, new.id
        );

        update public.sla_events
        set due_at = v_due,
            -- A later deadline earns a fresh "due soon" warning.
            warned_at = case when v_due > v_event.due_at then null else warned_at end
        where id = v_event.id;
    end loop;

    return null;
end;
$$;

drop trigger if exists business_hours_retime_sla_events on public.business_hours;
create trigger business_hours_retime_sla_events
after update of schedule_json, holidays_json, timezone_id on public.business_hours
for each row
when (
    old.schedule_json is distinct from new.schedule_json
    or old.holidays_json is distinct from new.holidays_json
    or old.timezone_id is distinct from new.timezone_id
)
execute function public.business_hours_retime_sla_events();

-- Internal helpers: only the trigger calls these.
revoke execute on function public.sla_seconds_between_on(timestamptz, timestamptz, jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function public.business_hours_retime_sla_events() from public, anon, authenticated;
