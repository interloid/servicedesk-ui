-- ==========================================================
-- File: tickets_sla.sql
-- Description: Keep a ticket's SLA clocks in step with it
-- ==========================================================
--
-- Attach the policy on insert, then start / pause / resume / finish / restart /
-- re-target the ticket's sla_events as it changes. The clock operations they
-- call are in functions/17_sla_engine.sql.

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
