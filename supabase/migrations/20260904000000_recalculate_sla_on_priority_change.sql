-- Migration: Recalculate SLA events when ticket priority changes
-- When an admin, agent, or manager updates a ticket's priority,
-- delete the old pending SLA events and create new ones based on the
-- new priority's SLA policy targets.

CREATE OR REPLACE FUNCTION public.recalculate_sla_on_priority_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target record;
BEGIN
    IF NEW.priority = OLD.priority THEN
        RETURN NEW;
    END IF;

    IF NEW.sla_policy_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT
        first_response_mins,
        resolution_mins
    INTO v_target
    FROM public.sla_policy_targets
    WHERE policy_id = NEW.sla_policy_id
      AND priority_scope = NEW.priority;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    DELETE FROM public.sla_events
    WHERE ticket_id = NEW.id
      AND status = 'pending';

    IF NOT EXISTS (
        SELECT 1 FROM public.sla_events
        WHERE ticket_id = NEW.id AND type = 'first_response'
    ) THEN
        INSERT INTO public.sla_events (
            tenant_id, ticket_id, type, status, due_at
        ) VALUES (
            NEW.tenant_id, NEW.id, 'first_response', 'pending',
            now() + make_interval(mins => v_target.first_response_mins)
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.sla_events
        WHERE ticket_id = NEW.id AND type = 'resolution'
    ) THEN
        INSERT INTO public.sla_events (
            tenant_id, ticket_id, type, status, due_at
        ) VALUES (
            NEW.tenant_id, NEW.id, 'resolution', 'pending',
            now() + make_interval(mins => v_target.resolution_mins)
        );
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_recalculate_sla_on_priority_change
AFTER UPDATE OF priority ON public.tickets
FOR EACH ROW
WHEN (NEW.priority IS DISTINCT FROM OLD.priority)
EXECUTE FUNCTION public.recalculate_sla_on_priority_change();

GRANT EXECUTE ON FUNCTION public.recalculate_sla_on_priority_change() TO authenticated;
