-- =====================================================
-- File: 14_claim_email_jobs.sql
-- Description: Claim due email jobs for sending (SKIP LOCKED)
-- =====================================================

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
