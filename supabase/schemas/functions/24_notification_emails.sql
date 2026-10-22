-- ==========================================================
-- File: 24_notification_emails.sql
-- Description: Queue an email for each notification whose event the
--              recipient has switched on under "Email" in the notification
--              center.
-- ==========================================================

-- Notifications are written from two places -- the ticket server actions
-- (service role) and the SLA engine (sla_tick) -- so the email side hangs off
-- the table instead of either writer. Only the events with a preference row
-- are emailed (same mapping as TYPE_TO_PREF in
-- src/features/notifications/lib/feed.ts); closures, billing and system
-- notices stay in-app.
--
-- The job carries only the notification id: the email-jobs Edge Function reads
-- the row, the recipient's address and the workspace when it sends, and skips
-- a notification that has since been read or deleted.
--
-- A missing or legacy prefs row ({"email": true}) falls back to the defaults
-- in defaultNotificationPrefs(): email on, except "New tickets", which is an
-- opt-in for admins and managers.

CREATE OR REPLACE FUNCTION public.queue_notification_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event text;
    v_email jsonb;
    v_enabled boolean;
BEGIN
    v_event := CASE NEW.type
        WHEN 'ticket_assigned' THEN 'assigned'
        WHEN 'ticket_updated' THEN 'replies'
        WHEN 'sla_breach' THEN 'sla'
        WHEN 'sla_warning' THEN 'sla'
        WHEN 'mention' THEN 'mention'
        WHEN 'ticket_created' THEN 'created'
    END;

    IF v_event IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT p.channel_json -> 'email'
    INTO v_email
    FROM public.notification_prefs p
    WHERE p.tenant_id = NEW.tenant_id
      AND p.user_id = NEW.user_id;

    v_enabled := CASE
        WHEN jsonb_typeof(v_email) = 'object'
         AND jsonb_typeof(v_email -> v_event) = 'boolean'
        THEN (v_email ->> v_event)::boolean
        ELSE v_event <> 'created'
    END;

    IF NOT v_enabled THEN
        RETURN NEW;
    END IF;

    -- SECURITY DEFINER: email_jobs has no policies, and a failed enqueue must
    -- not roll back the notification itself.
    BEGIN
        INSERT INTO public.email_jobs (kind, payload, tenant_id)
        VALUES (
            'notification',
            jsonb_build_object('notificationId', NEW.id),
            NEW.tenant_id
        );
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'queue_notification_email(%): %', NEW.id, SQLERRM;
    END;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE
ON FUNCTION public.queue_notification_email()
FROM public, anon, authenticated;
