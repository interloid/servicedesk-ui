-- ==========================================================
-- File: tickets_resolution_stamps.sql
-- Description: Maintain tickets.resolved_at / closed_at from status
-- ==========================================================
--
-- CSAT keys on `tickets.resolved_at` (csat_ratings is unique per
-- (ticket_id, resolved_at), so a re-resolution after a reopen is a new slot). If
-- resolved_at were only ever set by whatever handler happens to remember to set
-- it, that uniqueness would key on null: every rating for a never-stamped ticket
-- would collide, or worse, not collide, depending on the row's history.
--
-- So the timestamps are derived from status in a trigger rather than trusted from
-- the caller. Two deliberate exceptions, both commented in the body:
--
--   * a caller-supplied timestamp is kept, because a backfill or an import
--     restoring history has a better value than now();
--   * closing straight from an open state leaves resolved_at null, so a ticket
--     nobody resolved never earns a CSAT prompt.
--
-- Lives in the triggers directory with its function for the same reason
-- touch_ticket_from_message does (tickets_updated_at.sql): it is a trigger
-- implementation, not part of the callable API.

CREATE OR REPLACE FUNCTION public.sync_ticket_resolution_stamps()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    --------------------------------------------------------
    -- Entering a terminal state stamps it, unless the caller
    -- already supplied a timestamp.
    --------------------------------------------------------

    IF NEW.status = 'resolved'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'resolved')
    THEN
        NEW.resolved_at := COALESCE(NEW.resolved_at, NOW());
    END IF;

    IF NEW.status = 'closed'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'closed')
    THEN
        NEW.closed_at := COALESCE(NEW.closed_at, NOW());

        -- A ticket closed straight from an open state was never "resolved",
        -- so resolved_at is deliberately left alone. It stays null and earns
        -- no CSAT prompt.
    END IF;

    --------------------------------------------------------
    -- Leaving a terminal state clears both, which is what
    -- makes the next resolution a NEW csat slot.
    --------------------------------------------------------

    IF TG_OP = 'UPDATE'
       AND NEW.status NOT IN ('resolved', 'closed')
       AND OLD.status IN ('resolved', 'closed')
    THEN
        NEW.resolved_at := NULL;
        NEW.closed_at := NULL;
    END IF;

    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_ticket_resolution_stamps() IS
'Maintains tickets.resolved_at / closed_at from status, so reporting and CSAT do not depend on every caller remembering to set them.';

CREATE OR REPLACE TRIGGER sync_tickets_resolution_stamps
BEFORE INSERT OR UPDATE OF status ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.sync_ticket_resolution_stamps();
