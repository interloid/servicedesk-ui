-- =====================================================
-- Enforce the plan's seat limit on memberships
-- =====================================================
--
-- The Team page checks seats before it writes, but the check and the insert
-- are separate steps with an auth call and an email in between. Two invites
-- sent at the same moment both read "1 seat left" and both insert. This runs
-- inside the write, holding a lock on the tenant row, so the second one waits
-- for the first and then sees the real count.
--
-- Mirrors getTeamSeats() in src/features/team/services/team.service.ts:
--   * a seat is a staff membership that is not disabled (invites count);
--   * platform_admin is not a customer seat (see STAFF_ROLES);
--   * the limit is the seat_limit of the tenant's current (active/trialing)
--     subscription's plan, falling back to Free's 2; 0 means unlimited.
--
-- Raises SQLSTATE TS409, which the team service maps to seat-limit-reached.

CREATE OR REPLACE FUNCTION public.enforce_team_seat_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_seat_roles CONSTANT text[] :=
        ARRAY['tenant_admin', 'manager', 'agent', 'billing_admin'];
    v_limit integer;
    v_used  integer;
BEGIN
    -- Only a row that takes a seat can go over the limit.
    IF NOT (NEW.role::text = ANY (v_seat_roles))
       OR NEW.status = 'disabled' THEN
        RETURN NEW;
    END IF;

    -- Already held a seat in this tenant before the update (role change,
    -- invite accepted): nothing new is being taken.
    IF TG_OP = 'UPDATE'
       AND OLD.tenant_id = NEW.tenant_id
       AND OLD.role::text = ANY (v_seat_roles)
       AND OLD.status <> 'disabled' THEN
        RETURN NEW;
    END IF;

    -- Serialise seat-taking writes per tenant.
    PERFORM 1 FROM public.tenants WHERE id = NEW.tenant_id FOR UPDATE;

    SELECT p.seat_limit
    INTO v_limit
    FROM public.subscriptions s
    JOIN public.plans p ON p.id = s.plan_id
    WHERE s.tenant_id = NEW.tenant_id
      AND s.status IN ('active', 'trialing')
    ORDER BY s.current_period_start DESC
    LIMIT 1;

    v_limit := COALESCE(v_limit, 2);

    IF v_limit = 0 THEN
        RETURN NEW;
    END IF;

    SELECT count(*)
    INTO v_used
    FROM public.memberships m
    WHERE m.tenant_id = NEW.tenant_id
      AND m.role::text = ANY (v_seat_roles)
      AND m.status <> 'disabled'
      AND m.id IS DISTINCT FROM NEW.id;

    IF v_used >= v_limit THEN
        RAISE EXCEPTION 'seat-limit-reached: all % seats are in use', v_limit
            USING ERRCODE = 'TS409';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE EXECUTE
ON FUNCTION public.enforce_team_seat_limit()
FROM authenticated, anon, public;
