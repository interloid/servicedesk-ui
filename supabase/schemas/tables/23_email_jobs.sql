-- ==========================================================
-- File: 23_email_jobs.sql
-- Description: Outgoing mail queue, drained by the app (server-only)
-- ==========================================================

CREATE TABLE IF NOT EXISTS public.email_jobs
(
    id uuid primary key
        default gen_random_uuid(),

    -- What to send; the app maps each kind to a handler.
    kind text
        not null,

    payload jsonb
        not null
        default '{}'::jsonb,

    status text
        not null
        default 'pending'
        check (status in ('pending', 'sending', 'sent', 'failed')),

    attempts integer
        not null
        default 0,

    max_attempts integer
        not null
        default 5,

    run_after timestamptz
        not null
        default now(),

    -- When the current attempt was claimed. A `sending` row older than the
    -- lease is treated as abandoned and claimed again.
    locked_at timestamptz,

    last_error text,

    tenant_id uuid
        references public.tenants(id)
        on delete cascade,

    created_at timestamptz
        not null
        default now(),

    updated_at timestamptz
        not null
        default now(),

    sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_email_jobs_due
    ON public.email_jobs (run_after)
    WHERE status IN ('pending', 'sending');

-- Server-only: no policies, so only the service role reads or writes it.
ALTER TABLE public.email_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.email_jobs FROM anon, authenticated;
