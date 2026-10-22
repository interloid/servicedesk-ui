-- ==========================================================
-- File: tickets_notify.sql
-- Description: Ticket lifecycle notifications and customer emails
-- ==========================================================

-- See functions/25_ticket_notifications.sql. AFTER triggers, so NEW.number
-- (set_tickets_number) and the final assignee/status are what's announced.
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
