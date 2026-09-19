-- ==========================================================
-- File: tickets_updated_at.sql
-- Description: Keep updated_at honest on the ticket tables
-- ==========================================================

-- `tickets.updated_at` defaults to now() on insert but nothing was moving it on UPDATE, so
-- it recorded creation time forever. The queue sorts on it and the detail page prints it as
-- "last activity" — both were quietly wrong. `public.update_updated_at_column` already
-- exists (functions/07) and is what `set_tenants_updated_at` uses.

CREATE OR REPLACE TRIGGER set_tickets_updated_at
BEFORE UPDATE ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER set_ticket_messages_updated_at
BEFORE UPDATE ON public.ticket_messages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER set_sla_events_updated_at
BEFORE UPDATE ON public.sla_events
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Posting a reply is activity on the ticket, but it writes to `ticket_messages` — the
-- ticket row itself is untouched, so without this a busy thread keeps sinking down a queue
-- sorted by `updated_at`.
CREATE OR REPLACE FUNCTION public.touch_ticket_from_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- SECURITY DEFINER because an agent's own UPDATE policy on `tickets` is narrower than
    -- their INSERT policy on `ticket_messages` for a customer-authored row; the touch must
    -- not be the thing that fails a legitimate reply. It writes one timestamp and nothing
    -- else, and the ticket is identified by the message's own FK, so it cannot be pointed
    -- at another tenant's row.
    UPDATE public.tickets
    SET updated_at = now()
    WHERE id = NEW.ticket_id;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER touch_ticket_on_message
AFTER INSERT ON public.ticket_messages
FOR EACH ROW
EXECUTE FUNCTION public.touch_ticket_from_message();
