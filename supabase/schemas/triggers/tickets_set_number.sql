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
