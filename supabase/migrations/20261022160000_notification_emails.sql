-- =====================================================
-- Notification emails
-- =====================================================
--
-- The notification center's "Email" switches were saved but nothing sent
-- mail. Each notification insert now queues an email_jobs row (kind
-- 'notification') when the recipient has email on for that event; the
-- email-jobs Edge Function sends it.
--
-- Needs the email-jobs function redeployed with the 'notification' handler,
-- or the queued jobs fail with 'No handler for email kind'. The "View ticket"
-- button uses the FRONTEND_URL function secret (shared with
-- update-payment-method); without it the email has no button.
--
-- Mirrors supabase/schemas/functions/24_notification_emails.sql and
-- supabase/schemas/triggers/notifications_email.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.queue_notification_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event text;
    v_email jsonb;
BEGIN
    v_event := CASE NEW.type
        WHEN 'ticket_assigned' THEN 'assigned'
        WHEN 'ticket_updated' THEN 'replies'
        WHEN 'sla_breach' THEN 'sla'
        WHEN 'sla_warning' THEN 'sla'
        WHEN 'mention' THEN 'mention'
    END;

    IF v_event IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT p.channel_json -> 'email'
    INTO v_email
    FROM public.notification_prefs p
    WHERE p.tenant_id = NEW.tenant_id
      AND p.user_id = NEW.user_id;

    IF jsonb_typeof(v_email) = 'object'
       AND jsonb_typeof(v_email -> v_event) = 'boolean'
       AND NOT (v_email ->> v_event)::boolean
    THEN
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

CREATE OR REPLACE TRIGGER queue_notification_email
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.queue_notification_email();

COMMIT;
