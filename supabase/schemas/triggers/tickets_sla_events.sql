-- ==========================================================
-- File: tickets_sla_events.sql
-- Description: Automatically create SLA events when a ticket is created,
--              and recalculate them when ticket priority changes.
-- ==========================================================

-- ============================================================
-- TRIGGER 1: Create SLA events on ticket INSERT
-- ============================================================
-- WHY A TRIGGER:
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

    INSERT INTO public.sla_events (
        tenant_id, ticket_id, type, status, due_at
    ) VALUES (
        NEW.tenant_id, NEW.id, 'first_response', 'pending',
        NEW.created_at + make_interval(mins => v_target.first_response_mins)
    );

    INSERT INTO public.sla_events (
        tenant_id, ticket_id, type, status, due_at
    ) VALUES (
        NEW.tenant_id, NEW.id, 'resolution', 'pending',
        NEW.created_at + make_interval(mins => v_target.resolution_mins)
    );

    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_create_ticket_sla_events
AFTER INSERT ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.create_ticket_sla_events();

-- ============================================================
-- TRIGGER 2: Recalculate SLA events on priority change
-- ============================================================
-- WHEN: Admin, agent, or manager updates ticket priority
-- WHAT: Delete pending SLA events, create new ones for the new priority
-- WHY:  Different priorities have different SLA targets (e.g. Urgent = 15min,
--       Normal = 4h). The SLA clock must reset to reflect the new targets.

CREATE OR REPLACE FUNCTION public.recalculate_sla_on_priority_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target record;
BEGIN
    -- Only act when priority actually changes
    IF NEW.priority = OLD.priority THEN
        RETURN NEW;
    END IF;

    -- No policy assigned — nothing to recalculate
    IF NEW.sla_policy_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Look up the SLA target for the NEW priority
    SELECT
        first_response_mins,
        resolution_mins
    INTO v_target
    FROM public.sla_policy_targets
    WHERE policy_id = NEW.sla_policy_id
      AND priority_scope = NEW.priority;

    -- No target defined for this priority — nothing to do
    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    -- Delete all pending SLA events (reset the clock)
    DELETE FROM public.sla_events
    WHERE ticket_id = NEW.id
      AND status = 'pending';

    -- Create new first_response event (if not already completed/breached)
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

    -- Create new resolution event (if not already completed/breached)
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
