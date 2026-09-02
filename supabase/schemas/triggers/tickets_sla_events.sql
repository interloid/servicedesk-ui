-- ==========================================================
-- File: tickets_sla_events.sql
-- Description: Automatically create SLA events when a ticket is created
-- ==========================================================

-- WHY A TRIGGER:
--
-- SLA events must be created atomically with the ticket. Moving this from the app
-- to a trigger ensures:
-- 1. SLA events are never missed (even with CSV imports or direct SQL inserts)
-- 2. The logic is centralized and can't be bypassed
-- 3. Business hours support can be added later in one place

CREATE OR REPLACE FUNCTION public.create_ticket_sla_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target record;
BEGIN
    -- Only create SLA events if a policy is assigned
    IF NEW.sla_policy_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Look up the SLA target for this policy and ticket priority
    SELECT
        first_response_mins,
        resolution_mins
    INTO v_target
    FROM public.sla_policy_targets
    WHERE policy_id = NEW.sla_policy_id
      AND priority_scope = NEW.priority;

    -- If no target exists for this priority, skip
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    -- Create first response SLA event
    INSERT INTO public.sla_events (
        tenant_id,
        ticket_id,
        type,
        status,
        due_at
    ) VALUES (
        NEW.tenant_id,
        NEW.id,
        'first_response',
        'pending',
        NEW.created_at + make_interval(mins => v_target.first_response_mins)
    );

    -- Create resolution SLA event
    INSERT INTO public.sla_events (
        tenant_id,
        ticket_id,
        type,
        status,
        due_at
    ) VALUES (
        NEW.tenant_id,
        NEW.id,
        'resolution',
        'pending',
        NEW.created_at + make_interval(mins => v_target.resolution_mins)
    );

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_create_ticket_sla_events
AFTER INSERT ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.create_ticket_sla_events();
