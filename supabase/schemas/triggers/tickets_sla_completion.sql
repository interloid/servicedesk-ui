-- ==========================================================
-- File: tickets_sla_completion.sql
-- Description: Complete SLA events & ticket SLA columns when work happens
-- ==========================================================

-- WHY TRIGGERS:
--
-- SLA events are created atomically on ticket insert (see tickets_sla_events.sql),
-- but nothing ever marked them `completed` — only `process_sla_breaches` flips them to
-- `breached`. So `first_response_at`, `resolved_at`, `completed_at` stayed null forever
-- and every clock reported `pending` until it breached.
--
-- These triggers close the loop:
--  * first agent message  -> tickets.first_response_at set  + `first_response` event completed
--  * ticket resolved      -> tickets.resolved_at set        + `resolution` event completed

-- ── 1. Complete first_response on the first agent message ──────────────────────

CREATE OR REPLACE FUNCTION public.complete_first_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Only agent-authored public replies count as a "first response".
    IF NEW.author_type <> 'agent' OR NEW.visibility <> 'public' THEN
        RETURN NEW;
    END IF;

    -- Stamp the ticket the first time an agent replies (idempotent).
    UPDATE public.tickets
       SET first_response_at = coalesce(first_response_at, now())
     WHERE id = NEW.ticket_id
       AND first_response_at IS NULL;

    -- Complete the matching SLA event, if it is still running.
    UPDATE public.sla_events
       SET status = 'completed',
           completed_at = now()
     WHERE ticket_id = NEW.ticket_id
       AND type = 'first_response'
       AND status = 'pending';

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER complete_first_response_on_message
AFTER INSERT ON public.ticket_messages
FOR EACH ROW
EXECUTE FUNCTION public.complete_first_response();

-- ── 2. Complete resolution when the ticket is resolved ─────────────────────────

CREATE OR REPLACE FUNCTION public.complete_ticket_resolution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status IN ('resolved', 'closed') THEN
        -- Stamp the resolution time (idempotent).
        NEW.resolved_at := coalesce(NEW.resolved_at, now());

        -- Complete the resolution SLA event, if it is still running.
        UPDATE public.sla_events
           SET status = 'completed',
               completed_at = coalesce(completed_at, now())
         WHERE ticket_id = NEW.id
           AND type = 'resolution'
           AND status = 'pending';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER complete_ticket_resolution
BEFORE UPDATE OF status ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.complete_ticket_resolution();
