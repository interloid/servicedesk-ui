-- ==========================================================
-- File: 20260925130000_email_jobs_queue.sql
-- Description: A queue for the mail the app sends, so a request no longer
--              waits on Supabase's invite API and Resend before it answers.
--
-- The request writes a row here and returns. Sending lives in the
-- `email-jobs` Edge Function, which the cron below calls every minute while a
-- job is due. A failed send goes back to `pending` with a backoff, so the cron
-- is also the retry.
--
-- Canonical copies: schemas/tables/23_email_jobs.sql and
-- schemas/functions/14_claim_email_jobs.sql.
--
-- Before the cron is useful, store two Vault secrets (once, per environment).
-- If reconcile-subscriptions' cron already reads the service role key from a
-- secret under another name, use that name below instead.
--
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/email-jobs',
--     'email_jobs_url'
--   );
--   select vault.create_secret('<service role key>', 'service_role_key');
-- ==========================================================

BEGIN;

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

-- ----------------------------------------------------------
-- claim_email_jobs: hand out up to p_limit due jobs, marking them `sending`.
-- SKIP LOCKED lets the after() drain and the cron run at the same time
-- without sending anything twice.
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_email_jobs(
    p_limit integer DEFAULT 10,
    p_lease interval DEFAULT interval '5 minutes'
)
RETURNS SETOF public.email_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.email_jobs j
    SET status = 'sending',
        attempts = j.attempts + 1,
        locked_at = now(),
        updated_at = now()
    WHERE j.id IN (
        SELECT id
        FROM public.email_jobs
        WHERE (
                (status = 'pending' AND run_after <= now())
             OR (status = 'sending' AND locked_at < now() - p_lease)
              )
          AND attempts < max_attempts
        ORDER BY run_after
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING j.*;
$$;

REVOKE EXECUTE
ON FUNCTION public.claim_email_jobs(integer, interval)
FROM authenticated, anon, public;

-- ----------------------------------------------------------
-- Retry sweep, every minute. Cheap when the queue is empty: nothing is
-- called unless a job is due.
-- ----------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-jobs-every-minute') THEN
        PERFORM cron.unschedule('email-jobs-every-minute');
    END IF;
END
$$;

-- Calls the email-jobs Edge Function with the service role key as a bearer
-- token -- the same auth reconcile-subscriptions moved to after its
-- x-cron-secret header failed. That failure was silent: the Vault lookup came
-- back null, pg_net dropped the null header, and every run 401'd. Here a
-- missing secret RAISEs instead, so it shows in cron.job_run_details.
SELECT cron.schedule(
    'email-jobs-every-minute',
    '* * * * *',
    $$
    DO $sweep$
    DECLARE
        v_url text;
        v_key text;
    BEGIN
        -- Only when a job is actually due; nothing to do during a backoff.
        IF NOT EXISTS (
            SELECT 1 FROM public.email_jobs
            WHERE attempts < max_attempts
              AND (
                    (status = 'pending' AND run_after <= now())
                 OR (status = 'sending' AND locked_at < now() - interval '5 minutes')
                  )
        ) THEN
            RETURN;
        END IF;

        SELECT decrypted_secret INTO v_url
        FROM vault.decrypted_secrets
        WHERE name = 'email_jobs_url';

        SELECT decrypted_secret INTO v_key
        FROM vault.decrypted_secrets
        WHERE name = 'service_role_key';

        IF v_url IS NULL OR v_url = '' THEN
            RAISE EXCEPTION 'email-jobs cron: Vault secret "email_jobs_url" is missing';
        END IF;

        IF v_key IS NULL OR v_key = '' THEN
            RAISE EXCEPTION 'email-jobs cron: Vault secret "service_role_key" is missing';
        END IF;

        PERFORM net.http_post(
            url := v_url,
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || v_key
            ),
            body := '{}'::jsonb
        );
    END
    $sweep$;
    $$
);

COMMIT;
