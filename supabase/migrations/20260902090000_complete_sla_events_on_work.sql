-- Migration: Complete SLA events when work happens on a ticket
-- Closes the loop started by the create-ticket trigger: nothing was marking
-- sla_events as `completed`, so first_response_at / resolved_at / completed_at
-- stayed null and every clock showed `pending` until it breached.

-- 1. Complete first_response on the first agent message
CREATE OR REPLACE FUNCTION public.complete_first_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.author_type <> 'agent' OR NEW.visibility <> 'public' THEN
        RETURN NEW;
    END IF;

    UPDATE public.tickets
       SET first_response_at = coalesce(first_response_at, now())
     WHERE id = NEW.ticket_id
       AND first_response_at IS NULL;

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

-- 2. Complete resolution when the ticket is resolved/closed
CREATE OR REPLACE FUNCTION public.complete_ticket_resolution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status IN ('resolved', 'closed') THEN
        NEW.resolved_at := coalesce(NEW.resolved_at, now());

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

GRANT EXECUTE ON FUNCTION public.complete_first_response() TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_ticket_resolution() TO authenticated;
