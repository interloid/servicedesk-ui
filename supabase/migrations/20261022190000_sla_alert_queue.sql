-- =====================================================
-- SLA alert queue
-- =====================================================
--
-- sla_tick() now runs every 15 minutes instead of every minute, and only
-- detects: it marks overdue clocks breached and queues each breach and
-- due-soon warning in sla_alert_jobs. process_sla_alert_jobs() (called at the
-- end of every tick) re-checks each alert and writes the notifications,
-- leaving out anyone who switched SLA alerts off for both in-app and email.
-- queue_notification_email() still mails the rest per their email switch.
--
-- Warnings look one tick (15 min) ahead so they never arrive after the
-- deadline. The app reads breaches from due_at, so the slower tick only
-- delays alerts, never the SLA state shown on screen.
--
-- Mirrors supabase/schemas/tables/25_sla_alert_jobs.sql and
-- supabase/schemas/functions/17_sla_engine.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS public.sla_alert_jobs
(
    id uuid primary key
        default gen_random_uuid(),

    tenant_id uuid
        not null
        references public.tenants(id)
        on delete cascade,

    sla_event_id uuid
        not null
        references public.sla_events(id)
        on delete cascade,

    kind text
        not null
        check (kind in ('sla_warning', 'sla_breach')),

    -- skipped: the clock moved on before the alert went out (met, paused,
    -- re-targeted, ticket resolved).
    status text
        not null
        default 'pending'
        check (status in ('pending', 'sent', 'skipped', 'failed')),

    attempts integer
        not null
        default 0,

    max_attempts integer
        not null
        default 5,

    last_error text,

    -- Notifications written for this alert.
    recipients integer,

    created_at timestamptz
        not null
        default now(),

    processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sla_alert_jobs_pending
    ON public.sla_alert_jobs (created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_sla_alert_jobs_event
    ON public.sla_alert_jobs (sla_event_id);

-- sla_tick()'s clean-up of old processed jobs.
CREATE INDEX IF NOT EXISTS idx_sla_alert_jobs_processed
    ON public.sla_alert_jobs (processed_at)
    WHERE status <> 'pending';

-- Engine-only: no policies, so only the SECURITY DEFINER engine reads or
-- writes it.
ALTER TABLE public.sla_alert_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sla_alert_jobs FROM anon, authenticated;

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

COMMIT;
