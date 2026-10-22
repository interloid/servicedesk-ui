-- ==========================================================
-- File: 25_sla_alert_jobs.sql
-- Description: SLA alert queue -- breaches and due-soon warnings found by
--              sla_tick(), turned into notifications by
--              process_sla_alert_jobs()
-- ==========================================================

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
