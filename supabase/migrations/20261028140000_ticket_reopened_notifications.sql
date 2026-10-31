-- =====================================================
-- Ticket reopened notifications
-- =====================================================
--
-- A resolved or closed ticket moving back to a working status (the customer
-- replied or reopened it on the portal, or a teammate reopened it) alerts its
-- assignee, or admins and managers when nobody has it. Nobody hears about
-- their own reopen.
--
-- A new "A ticket is reopened" row in the notification center governs it
-- (event key `reopened`, email and in-app both on by default), so
-- queue_notification_email maps the new type to that key.
--
-- Mirrors supabase/schemas/functions/24_notification_emails.sql and
-- supabase/schemas/functions/25_ticket_notifications.sql.

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
        WHEN 'ticket_reopened' THEN 'reopened'
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

    -- Out of resolved or closed into a working status: the customer replied
    -- or reopened on the portal, or a teammate reopened it. The assignee
    -- picks it back up; with nobody on it, admins and managers hear instead.
    IF OLD.status IN ('resolved', 'closed')
       AND NEW.status NOT IN ('resolved', 'closed')
    THEN
        BEGIN
            INSERT INTO public.notifications (tenant_id, user_id, type, payload_json)
            SELECT
                NEW.tenant_id,
                r.user_id,
                'ticket_reopened',
                jsonb_build_object(
                    'ticket_id', NEW.id,
                    'ticket_number', NEW.number,
                    'subject', NEW.subject
                )
            FROM (
                SELECT NEW.assignee_user_id AS user_id
                WHERE NEW.assignee_user_id IS NOT NULL
                UNION
                SELECT m.user_id
                FROM public.memberships m
                WHERE NEW.assignee_user_id IS NULL
                  AND m.tenant_id = NEW.tenant_id
                  AND m.status = 'active'
                  AND m.role IN ('tenant_admin', 'manager')
            ) r
            WHERE r.user_id IS DISTINCT FROM v_actor;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'notify_ticket_changed(%) reopen: %', NEW.id, SQLERRM;
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

REVOKE EXECUTE ON FUNCTION public.queue_notification_email() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_ticket_changed() FROM public, anon, authenticated;
