-- ==========================================================
-- File: 25_ticket_notifications.sql
-- Description: Who hears about a ticket's lifecycle, and how.
-- ==========================================================

--   Ticket created         customer         confirmation email (+ portal history)
--   Ticket created         assignee         in-app + email      (ticket_assigned)
--   Ticket created         admins/managers  in-app + opt-in email (ticket_created)
--   Agent replies (public) customer         email (+ portal thread)
--   Ticket assigned        new assignee     in-app + email per prefs
--   Ticket resolved        customer         email (+ portal status)
--
-- SLA warnings and breaches come from the SLA engine (17_sla_engine.sql).
--
-- On the tables rather than in the server actions, so every path is covered:
-- the agent form, the portal (portal_create_request runs as service_role),
-- bulk assignment and anything added later. Staff alerts are `notifications`
-- rows; their email goes through queue_notification_email
-- (24_notification_emails.sql) and the recipient's preferences. Customers have
-- no notification feed -- the portal is their in-app view -- so they get
-- email_jobs rows directly.
--
-- auth.uid() is the acting user on the app's own client and null on the
-- service role (portal, cron); nobody is alerted about their own action.
--
-- Every write here is guarded: a notification or email that can't be queued
-- is logged, never a reason to fail the ticket change itself.

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
