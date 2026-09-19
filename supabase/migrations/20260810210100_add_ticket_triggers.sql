-- =====================================================
-- Ticket numbering and updated_at triggers
--
-- Mirrors supabase/schemas/triggers/tickets_set_number.sql and
-- supabase/schemas/triggers/tickets_updated_at.sql. See those files for the reasoning;
-- this is the applied form.
-- =====================================================

-- ==========================================================
-- File: tickets_set_number.sql
-- Description: Assign tickets.number on insert
-- ==========================================================

-- WHY A TRIGGER AND NOT AN RPC CALL FROM THE APP:
--
-- `generate_ticket_number` takes `pg_advisory_xact_lock`, which is released when its
-- transaction ends. Called as its own RPC the lock is gone before the app issues the
-- INSERT, so two agents creating a ticket at the same moment both read the same MAX and
-- one loses to `uq_ticket_number`. Running it inside a BEFORE INSERT trigger puts the
-- lock and the insert in one transaction, which is the whole point of taking it.
--
-- It also means the app never sends `number` — the CSV importer inserts thousands of rows
-- in one statement and each still gets its own number, in order.

CREATE OR REPLACE FUNCTION public.set_ticket_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    -- BEFORE INSERT runs ahead of the NOT NULL check, so filling it here satisfies the
    -- column. Left alone when the caller supplied one — a migration restoring historical
    -- tickets needs to keep their original numbers.
    IF NEW.number IS NULL THEN
        NEW.number := public.generate_ticket_number(NEW.tenant_id);
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER set_tickets_number
BEFORE INSERT ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.set_ticket_number();
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
