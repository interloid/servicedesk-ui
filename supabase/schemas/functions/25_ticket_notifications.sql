-- ==========================================================
-- File: 25_ticket_notifications.sql
-- Description: Who hears about a ticket's lifecycle, and how.
-- ==========================================================

--   Ticket created         customer         confirmation email (+ portal history)
--   Ticket created         assignee         in-app + email      (ticket_assigned)
--   Ticket created         admins/managers  in-app + opt-in email (ticket_created)
--   Agent replies (public) customer         email (+ portal thread)
--   Customer replies       assignee         in-app + email per prefs (ticket_updated)
--   Ticket assigned        new assignee     in-app + email per prefs
--   Ticket resolved        customer         email (+ portal status)
--   Ticket reopened        assignee, else   in-app + email per prefs
--                          admins/managers  (ticket_reopened)
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

-- A public agent reply goes to the customer. Internal notes never do, and a
-- customer's own message (or a system line) is not echoed back to them.
--
-- A customer's reply goes the other way: the ticket's assignee gets a "New
-- reply" (ticket_updated, the `replies` preference) in the bell and, per their
-- prefs, by email. The agent side writes the same notification from
-- sendTicketMessageAction; the portal posts through the customer's own RLS
-- client, which cannot write notifications, so it is done here. An unassigned
-- ticket alerts nobody -- it is still in the queue.
CREATE OR REPLACE FUNCTION public.notify_ticket_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ticket   public.tickets%rowtype;
    v_customer text;
BEGIN
    IF NEW.author_type = 'agent' AND NEW.visibility = 'public' THEN
        PERFORM public.queue_customer_ticket_email(
            'customer_ticket_reply',
            NEW.tenant_id,
            jsonb_build_object('ticketId', NEW.ticket_id, 'messageId', NEW.id)
        );
    END IF;

    IF NEW.author_type = 'customer' THEN
        BEGIN
            SELECT * INTO v_ticket
            FROM public.tickets
            WHERE id = NEW.ticket_id;

            IF v_ticket.assignee_user_id IS NOT NULL THEN
                SELECT nullif(trim(c.full_name), '')
                INTO v_customer
                FROM public.customers c
                WHERE c.id = v_ticket.requester_customer_id;

                INSERT INTO public.notifications (tenant_id, user_id, type, payload_json)
                VALUES (
                    v_ticket.tenant_id,
                    v_ticket.assignee_user_id,
                    'ticket_updated',
                    jsonb_build_object(
                        'ticket_id', v_ticket.id,
                        'ticket_number', v_ticket.number,
                        'subject', v_ticket.subject,
                        'title', coalesce(v_customer, 'The customer')
                            || ' replied on #' || v_ticket.number,
                        'body', left(regexp_replace(NEW.body, '\s+', ' ', 'g'), 200)
                    )
                );
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'notify_ticket_message(%) customer reply: %', NEW.id, SQLERRM;
        END;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.queue_customer_ticket_email(text, uuid, jsonb) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_ticket_created() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_ticket_changed() FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_ticket_message() FROM public, anon, authenticated;
