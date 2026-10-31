-- =====================================================
-- Customer reply notifications
-- =====================================================
--
-- A customer's reply on the portal alerted nobody: the agent side writes the
-- assignee's "New reply" notification from sendTicketMessageAction, but the
-- portal posts through the customer's RLS client, which cannot write
-- notifications. notify_ticket_message now does it for customer messages.
-- The email follows from queue_notification_email (ticket_updated -> the
-- `replies` preference), so no other change is needed.
--
-- Mirrors supabase/schemas/functions/25_ticket_notifications.sql.

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

REVOKE EXECUTE ON FUNCTION public.notify_ticket_message() FROM public, anon, authenticated;
