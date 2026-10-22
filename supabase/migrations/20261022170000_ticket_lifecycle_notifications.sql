-- =====================================================
-- Ticket lifecycle notifications
-- =====================================================
--
-- Who hears about what (see the table at the top of
-- schemas/functions/25_ticket_notifications.sql):
--   * customers get a confirmation email on a new ticket, an email for each
--     public agent reply, and one when the ticket is resolved;
--   * the assignee of a new ticket, and a later assignee, get ticket_assigned;
--   * admins and managers get ticket_created -- now from the portal too, which
--     used to alert nobody. Email for it is opt-in ("New tickets" pref).
--
-- Replaces the ticket_created / ticket_assigned inserts in
-- src/features/tickets/actions/tickets.actions.ts (removed in the same change),
-- so this migration and that code must ship together.
--
-- Needs the email-jobs function redeployed with the customer_ticket_* and
-- notification handlers, or those jobs fail with 'No handler for email kind'.
--
-- Mirrors supabase/schemas/functions/24_notification_emails.sql,
-- supabase/schemas/functions/25_ticket_notifications.sql and
-- supabase/schemas/triggers/tickets_notify.sql.

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

CREATE OR REPLACE FUNCTION public.queue_customer_ticket_email(
    p_kind text,
    p_tenant uuid,
    p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.email_jobs (kind, payload, tenant_id)
    VALUES (p_kind, p_payload, p_tenant);
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'queue_customer_ticket_email(%): %', p_kind, SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_ticket_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_payload jsonb := jsonb_build_object(
        'ticket_id', NEW.id,
        'ticket_number', NEW.number,
        'subject', NEW.subject
    );
BEGIN
    PERFORM public.queue_customer_ticket_email(
        'customer_ticket_created',
        NEW.tenant_id,
        jsonb_build_object('ticketId', NEW.id)
    );

    BEGIN
        IF NEW.assignee_user_id IS NOT NULL
           AND NEW.assignee_user_id IS DISTINCT FROM v_actor
        THEN
            INSERT INTO public.notifications (tenant_id, user_id, type, payload_json)
            VALUES (
                NEW.tenant_id,
                NEW.assignee_user_id,
                'ticket_assigned',
                v_payload || jsonb_build_object(
                    'title', 'New ticket assigned to you · #' || NEW.number
                )
            );
        END IF;

        -- The assignee already has the more specific alert above.
        INSERT INTO public.notifications (tenant_id, user_id, type, payload_json)
        SELECT NEW.tenant_id, m.user_id, 'ticket_created', v_payload
        FROM public.memberships m
        WHERE m.tenant_id = NEW.tenant_id
          AND m.status = 'active'
          AND m.role IN ('tenant_admin', 'manager')
          AND m.user_id IS DISTINCT FROM v_actor
          AND m.user_id IS DISTINCT FROM NEW.assignee_user_id;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'notify_ticket_created(%): %', NEW.id, SQLERRM;
    END;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_ticket_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor uuid := auth.uid();
BEGIN
    IF NEW.assignee_user_id IS NOT NULL
       AND NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id
       AND NEW.assignee_user_id IS DISTINCT FROM v_actor
    THEN
        BEGIN
            INSERT INTO public.notifications (tenant_id, user_id, type, payload_json)
            VALUES (
                NEW.tenant_id,
                NEW.assignee_user_id,
                'ticket_assigned',
                jsonb_build_object(
                    'ticket_id', NEW.id,
                    'ticket_number', NEW.number,
                    'subject', NEW.subject
                )
            );
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'notify_ticket_changed(%): %', NEW.id, SQLERRM;
        END;
    END IF;

    -- Only the step into `resolved`: the later auto-close to `closed` is
    -- housekeeping the customer has already been told about.
    IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved' THEN
        PERFORM public.queue_customer_ticket_email(
            'customer_ticket_resolved',
            NEW.tenant_id,
            jsonb_build_object('ticketId', NEW.id)
        );
    END IF;

    RETURN NEW;
END;
$$;

-- A public agent reply goes to the customer. Internal notes never do, and a
-- customer's own message (or a system line) is not echoed back to them.
CREATE OR REPLACE FUNCTION public.notify_ticket_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.author_type = 'agent' AND NEW.visibility = 'public' THEN
        PERFORM public.queue_customer_ticket_email(
            'customer_ticket_reply',
            NEW.tenant_id,
            jsonb_build_object('ticketId', NEW.ticket_id, 'messageId', NEW.id)
        );
    END IF;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.queue_customer_ticket_email(text, uuid, jsonb) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_ticket_created() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_ticket_changed() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_ticket_message() FROM public, anon, authenticated;

CREATE OR REPLACE TRIGGER notify_ticket_created
AFTER INSERT ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.notify_ticket_created();

CREATE OR REPLACE TRIGGER notify_ticket_changed
AFTER UPDATE OF assignee_user_id, status ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.notify_ticket_changed();

CREATE OR REPLACE TRIGGER notify_ticket_message
AFTER INSERT ON public.ticket_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_ticket_message();

COMMIT;
