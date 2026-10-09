-- =====================================================
-- SLA targets: store the unit, and store business days as working minutes
-- =====================================================
--
-- Until now a "days" target was saved as days * 1440 whatever the policy
-- counted. On a business-hours policy that read as 24 working hours per day
-- (with 10:00-19:00, close to three working days). From here on:
--
--   * first_response_unit / resolution_unit hold what the editor showed
--     ('minutes' | 'hours' | 'days').
--   * *_mins is the real number of minutes the clock counts. On a
--     business-hours policy a day is one working day, day_end - day_start
--     (10:00-19:00 -> 540). On a 24/7 policy a day stays 1440.
--
-- The stored minutes follow the calendar: changing a calendar's hours, or
-- moving a policy to another calendar (or to 24/7), rescales its "days"
-- targets. Writers that don't send a unit (provision_tenant at onboarding)
-- get one from the minutes, and whole days are converted the same way.
-- Section 5 stops the ticket SLA engine converting days a second time.
--
-- Mirrors supabase/schemas/tables/09a_sla_policy_targets.sql and
-- supabase/schemas/functions/18_sla_target_units.sql.

------------------------------------------------------------
-- 1. Helpers
------------------------------------------------------------

-- Minutes in one working day of a schedule_json. 1440 when there is no
-- usable schedule: the clock then runs on wall time, where a day is 24 hours.
create or replace function public.sla_schedule_day_mins(p_schedule jsonb)
returns integer
language plpgsql
immutable
set search_path = public
as $$
declare
    v_start time;
    v_end time;
begin
    begin
        v_start := (p_schedule->>'day_start')::time;
        v_end := (p_schedule->>'day_end')::time;
    exception when others then
        return 1440;
    end;

    if v_start is null or v_end is null or v_end <= v_start then
        return 1440;
    end if;

    return (extract(epoch from (v_end - v_start)) / 60)::integer;
end;
$$;

-- Minutes in one SLA day of a calendar; 1440 for none (24/7).
create or replace function public.sla_business_hours_day_mins(
    p_business_hours_id uuid
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (
            select public.sla_schedule_day_mins(bh.schedule_json)
            from public.business_hours bh
            where bh.id = p_business_hours_id
        ),
        1440
    );
$$;

-- The unit a bare minute count reads as: the largest that divides it.
create or replace function public.sla_unit_for_mins(p_mins integer)
returns text
language sql
immutable
set search_path = public
as $$
    select case
        when p_mins % 1440 = 0 then 'days'
        when p_mins % 60 = 0 then 'hours'
        else 'minutes'
    end;
$$;

-- Rescales the "days" targets of p_policy_ids from p_old_day_mins to
-- p_new_day_mins per day. Resolution is kept at least the first response,
-- which chk_sla_resolution_ge_first_response requires: a shorter working day
-- can push a "1 day" resolution under a "10 hours" first response. It then
-- becomes the first response, unit and all, so it stays a whole amount.
create or replace function public.sla_rescale_day_targets(
    p_policy_ids uuid[],
    p_old_day_mins integer,
    p_new_day_mins integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_old_day_mins = p_new_day_mins
       or coalesce(array_length(p_policy_ids, 1), 0) = 0 then
        return;
    end if;

    update public.sla_policy_targets t
    set first_response_mins = s.first_mins,
        resolution_mins = greatest(s.resolution_mins, s.first_mins),
        resolution_unit = case
            when s.resolution_mins < s.first_mins then s.x_first_unit
            else t.resolution_unit
        end
    from (
        select
            x.id,
            x.first_response_unit as x_first_unit,
            case when x.first_response_unit = 'days'
                then greatest(round(x.first_response_mins::numeric / p_old_day_mins), 1)::integer
                     * p_new_day_mins
                else x.first_response_mins
            end as first_mins,
            case when x.resolution_unit = 'days'
                then greatest(round(x.resolution_mins::numeric / p_old_day_mins), 1)::integer
                     * p_new_day_mins
                else x.resolution_mins
            end as resolution_mins
        from public.sla_policy_targets x
        where x.policy_id = any(p_policy_ids)
          and (x.first_response_unit = 'days' or x.resolution_unit = 'days')
    ) s
    where t.id = s.id;
end;
$$;

------------------------------------------------------------
-- 2. Columns, with existing rows converted
------------------------------------------------------------

alter table public.sla_policy_targets
    add column if not exists first_response_unit text,
    add column if not exists resolution_unit text;

-- Existing minutes were all written as days * 1440, so the unit comes from
-- the minutes and only business-hours policies' days change.
update public.sla_policy_targets t
set first_response_unit = public.sla_unit_for_mins(t.first_response_mins),
    resolution_unit = public.sla_unit_for_mins(t.resolution_mins)
where t.first_response_unit is null or t.resolution_unit is null;

do $$
declare
    r record;
begin
    for r in
        select p.business_hours_id, array_agg(p.id) as policy_ids
        from public.sla_policies p
        where p.business_hours_id is not null
        group by p.business_hours_id
    loop
        perform public.sla_rescale_day_targets(
            r.policy_ids,
            1440,
            public.sla_business_hours_day_mins(r.business_hours_id)
        );
    end loop;
end;
$$;

alter table public.sla_policy_targets
    alter column first_response_unit set not null,
    alter column resolution_unit set not null;

alter table public.sla_policy_targets
    drop constraint if exists chk_sla_first_response_unit,
    drop constraint if exists chk_sla_resolution_unit;

alter table public.sla_policy_targets
    add constraint chk_sla_first_response_unit
        check (first_response_unit in ('minutes', 'hours', 'days')),
    add constraint chk_sla_resolution_unit
        check (resolution_unit in ('minutes', 'hours', 'days'));

comment on column public.sla_policy_targets.first_response_mins is
'Minutes the clock counts. A "days" target on a business-hours policy is days * the calendar''s working-day minutes; on a 24/7 policy days * 1440.';
comment on column public.sla_policy_targets.resolution_mins is
'Minutes the clock counts. A "days" target on a business-hours policy is days * the calendar''s working-day minutes; on a 24/7 policy days * 1440.';
comment on column public.sla_policy_targets.first_response_unit is
'The unit the editor shows first_response_mins in: minutes, hours or days.';
comment on column public.sla_policy_targets.resolution_unit is
'The unit the editor shows resolution_mins in: minutes, hours or days.';

------------------------------------------------------------
-- 3. Writers without a unit (onboarding's provision_tenant)
------------------------------------------------------------

-- A row inserted without a unit carries 24-hour minutes (days * 1440). Give it
-- the unit those minutes read as, and turn whole days into working days of
-- the policy's calendar.
create or replace function public.sla_policy_targets_fill_units()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_day_mins integer;
begin
    if new.first_response_unit is not null
       and new.resolution_unit is not null then
        return new;
    end if;

    select public.sla_business_hours_day_mins(p.business_hours_id)
    into v_day_mins
    from public.sla_policies p
    where p.id = new.policy_id;
    v_day_mins := coalesce(v_day_mins, 1440);

    if new.first_response_unit is null then
        new.first_response_unit := public.sla_unit_for_mins(new.first_response_mins);
        if new.first_response_unit = 'days' then
            new.first_response_mins := new.first_response_mins / 1440 * v_day_mins;
        end if;
    end if;

    if new.resolution_unit is null then
        new.resolution_unit := public.sla_unit_for_mins(new.resolution_mins);
        if new.resolution_unit = 'days' then
            new.resolution_mins := new.resolution_mins / 1440 * v_day_mins;
        end if;
    end if;

    if new.resolution_mins < new.first_response_mins then
        new.resolution_mins := new.first_response_mins;
        new.resolution_unit := new.first_response_unit;
    end if;
    return new;
end;
$$;

drop trigger if exists sla_policy_targets_fill_units on public.sla_policy_targets;
create trigger sla_policy_targets_fill_units
before insert on public.sla_policy_targets
for each row execute function public.sla_policy_targets_fill_units();

------------------------------------------------------------
-- 4. Keep "days" in step with the calendar
------------------------------------------------------------

create or replace function public.business_hours_rescale_sla_targets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.sla_rescale_day_targets(
        array(
            select p.id
            from public.sla_policies p
            where p.business_hours_id = new.id
        ),
        public.sla_schedule_day_mins(old.schedule_json),
        public.sla_schedule_day_mins(new.schedule_json)
    );
    return null;
end;
$$;

drop trigger if exists business_hours_rescale_sla_targets on public.business_hours;
create trigger business_hours_rescale_sla_targets
after update of schedule_json on public.business_hours
for each row
when (old.schedule_json is distinct from new.schedule_json)
execute function public.business_hours_rescale_sla_targets();

create or replace function public.sla_policies_rescale_targets()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.sla_rescale_day_targets(
        array[new.id],
        public.sla_business_hours_day_mins(old.business_hours_id),
        public.sla_business_hours_day_mins(new.business_hours_id)
    );
    return null;
end;
$$;

drop trigger if exists sla_policies_rescale_targets on public.sla_policies;
create trigger sla_policies_rescale_targets
after update of business_hours_id on public.sla_policies
for each row
when (old.business_hours_id is distinct from new.business_hours_id)
execute function public.sla_policies_rescale_targets();

------------------------------------------------------------
-- 5. The ticket SLA engine takes the stored minutes as written
------------------------------------------------------------

-- The engine (20261008120000_ticket_sla_engine.sql, feature/tickets) turned
-- whole multiples of 1440 into working days at clock start, because days used
-- to be stored as days * 1440. They are now stored as working minutes, so
-- converting again would shrink them (8 days of 9 hours = 4320 = 3 * 1440,
-- which would count as 3 working days). Same signature, so the engine's
-- callers pick this up; harmless where the engine isn't installed yet.
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

-- Internal helpers: only the triggers call these.
revoke execute on function public.sla_rescale_day_targets(uuid[], integer, integer) from public, anon, authenticated;
revoke execute on function public.sla_policy_targets_fill_units() from public, anon, authenticated;
revoke execute on function public.business_hours_rescale_sla_targets() from public, anon, authenticated;
revoke execute on function public.sla_policies_rescale_targets() from public, anon, authenticated;
