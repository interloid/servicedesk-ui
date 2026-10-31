-- ==========================================================
-- File: 20_ticket_priority_change.sql
-- Description: ticket priority changes -- confirmed to lower,
-- due-soon SLA deadlines kept, every change audited
-- ==========================================================

------------------------------------------------------------
-- 1. Lower a priority only through change_ticket_priority
------------------------------------------------------------

-- No reason is needed any more (the app asks for a confirmation instead), but
-- a lowered priority still has to come through change_ticket_priority, which
-- keeps due-soon deadlines. It marks its own update with
-- app.priority_change_rpc; a plain update has no such mark.
create or replace function public.tickets_guard_priority_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    -- ticket_priority is ordered low < normal < high < urgent.
    if new.priority < old.priority
       and coalesce(current_setting('app.priority_change_rpc', true), '') <> 'on'
    then
        raise exception 'Lower a ticket''s priority through change_ticket_priority.'
            using errcode = 'P0001',
                  hint = 'Use change_ticket_priority(ticket, priority).';
    end if;
    return new;
end;
$$;

drop trigger if exists tickets_guard_priority_change on public.tickets;
create trigger tickets_guard_priority_change
before update of priority on public.tickets
for each row
when (old.priority is distinct from new.priority)
execute function public.tickets_guard_priority_change();

------------------------------------------------------------
-- 2. Audit every change
------------------------------------------------------------

create or replace function public.tickets_audit_priority_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_reason text := nullif(btrim(current_setting('app.priority_change_reason', true)), '');
    v_kept text := nullif(current_setting('app.priority_sla_kept', true), '');
begin
    insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, meta_json)
    values (
        new.tenant_id,
        auth.uid(),
        'update',
        'ticket',
        new.id,
        jsonb_build_object(
            'field', 'priority',
            'ticket_number', new.number,
            'from', old.priority,
            'to', new.priority,
            'direction', case when new.priority > old.priority then 'raised' else 'lowered' end,
            'reason', v_reason,
            -- Clock types whose original deadline was kept (due soon).
            'sla_kept', coalesce(v_kept::jsonb, '[]'::jsonb)
        )
    );
    return null;
end;
$$;

drop trigger if exists tickets_audit_priority_change on public.tickets;
create trigger tickets_audit_priority_change
after update of priority on public.tickets
for each row
when (old.priority is distinct from new.priority)
execute function public.tickets_audit_priority_change();

------------------------------------------------------------
-- 3. The one way the app changes a priority
------------------------------------------------------------

-- Returns { changed, direction, sla_kept: [clock types], breached: [clock types] }.
create or replace function public.change_ticket_priority(
    p_ticket_id uuid,
    p_priority public.ticket_priority,
    p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_ticket public.tickets;
    v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
    v_notify_mins integer;
    v_lowering boolean;
    v_kept public.sla_events[] := '{}';
    v_kept_types text[] := '{}';
    v_breached text[];
    v_event public.sla_events;
    v_left bigint;
begin
    -- Security definer, so the checks RLS would make are made here: staff of
    -- the ticket's own tenant.
    select * into v_ticket
    from public.tickets
    where id = p_ticket_id
    for update;

    if not found
       or v_ticket.tenant_id is distinct from public.current_tenant_id()
       or coalesce(public.current_tenant_role(), '') not in ('tenant_admin', 'manager', 'agent')
    then
        raise exception 'Ticket not found.' using errcode = 'P0002';
    end if;

    if v_ticket.priority = p_priority then
        return jsonb_build_object('changed', false);
    end if;

    v_lowering := p_priority < v_ticket.priority;

    -- The reason is optional; when given it goes on the audit entry.
    if char_length(coalesce(v_reason, '')) > 500 then
        raise exception 'Keep the reason under 500 characters.' using errcode = 'P0001';
    end if;

    select coalesce(array_agg(e.type::text order by e.type), '{}')
    into v_breached
    from public.sla_events e
    where e.ticket_id = v_ticket.id and e.status = 'breached';

    -- Lowering: running clocks that are due soon keep their deadline.
    if v_lowering then
        select coalesce(p.notify_before_mins, 15) into v_notify_mins
        from public.sla_policies p
        where p.id = v_ticket.sla_policy_id;
        v_notify_mins := coalesce(v_notify_mins, 15);

        for v_event in
            select * from public.sla_events e
            where e.ticket_id = v_ticket.id and e.status = 'pending'
        loop
            v_left := case
                when v_event.paused_at is not null then coalesce(v_event.remaining_secs, 0)
                else public.sla_seconds_between(now(), v_event.due_at, v_event.business_hours_id)
            end;

            if v_event.warned_at is not null
               or v_event.due_at <= now()
               or v_left <= v_notify_mins::bigint * 60
            then
                v_kept := v_kept || v_event;
                v_kept_types := v_kept_types || v_event.type::text;
            end if;
        end loop;
    end if;

    perform set_config('app.priority_change_rpc', 'on', true);
    perform set_config('app.priority_change_reason', coalesce(v_reason, ''), true);
    perform set_config('app.priority_sla_kept', to_jsonb(v_kept_types)::text, true);

    -- tickets_sync_sla re-targets the pending clocks here.
    update public.tickets
    set priority = p_priority,
        updated_at = now()
    where id = v_ticket.id;

    -- Put the due-soon clocks back exactly as they were.
    foreach v_event in array v_kept loop
        update public.sla_events
        set target_mins = v_event.target_mins,
            due_at = v_event.due_at,
            remaining_secs = v_event.remaining_secs,
            warned_at = v_event.warned_at
        where id = v_event.id
          and status = 'pending';
    end loop;

    -- Settings are transaction-local; clear them so a later statement in the
    -- same transaction can't reuse this mark or reason.
    perform set_config('app.priority_change_rpc', '', true);
    perform set_config('app.priority_change_reason', '', true);
    perform set_config('app.priority_sla_kept', '', true);

    return jsonb_build_object(
        'changed', true,
        'direction', case when v_lowering then 'lowered' else 'raised' end,
        'sla_kept', to_jsonb(v_kept_types),
        'breached', to_jsonb(v_breached)
    );
end;
$$;

revoke execute on function public.change_ticket_priority(uuid, public.ticket_priority, text) from public, anon;
grant execute on function public.change_ticket_priority(uuid, public.ticket_priority, text) to authenticated;

-- Internal: only the triggers call these.
revoke execute on function public.tickets_guard_priority_change() from public, anon, authenticated;
revoke execute on function public.tickets_audit_priority_change() from public, anon, authenticated;
