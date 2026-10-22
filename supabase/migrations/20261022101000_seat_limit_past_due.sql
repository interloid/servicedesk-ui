-- RISK-008 / RISK-045 (code review 2026-10-22): the app now treats a past_due
-- subscription as current (PayPal is still retrying; the dunning grace period
-- keeps the plan), and falls back to tenants.plan_id when a tenant has no
-- subscription row at all. The seat trigger mirrors getTeamSeats(), so it
-- follows the same rules -- otherwise the database would refuse the invite the
-- Team page just allowed.
--
-- Mirrors supabase/schemas/functions/11_enforce_team_seat_limit.sql.

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
      AND s.status IN ('active', 'trialing', 'past_due')
    ORDER BY s.current_period_start DESC
    LIMIT 1;

    IF NOT FOUND AND NOT EXISTS (
        SELECT 1 FROM public.subscriptions s WHERE s.tenant_id = NEW.tenant_id
    ) THEN
        SELECT p.seat_limit
        INTO v_limit
        FROM public.tenants t
        JOIN public.plans p ON p.id = t.plan_id
        WHERE t.id = NEW.tenant_id;
    END IF;

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
