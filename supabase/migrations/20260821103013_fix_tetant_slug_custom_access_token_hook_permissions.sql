-- ==============================================================================
-- Migration: Fix Custom Access Token Hook Volatility & Admin Permissions
-- Description: Sets custom_access_token_hook to VOLATILE (allowing UPDATE statements)
--              and grants SELECT/UPDATE permissions to supabase_auth_admin.
-- ==============================================================================

BEGIN;

--------------------------------------------------------------------------------
-- 1. Redefine Function with VOLATILE Volatility
--------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE -- Replaced STABLE with VOLATILE to permit the UPDATE statement below
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    claims jsonb;
    v_tenant_id uuid;
    v_tenant_role text;
    v_tenant_slug text;
    v_membership_id uuid;
BEGIN
    --------------------------------------------------------
    -- Parse existing claims
    --------------------------------------------------------
    claims := COALESCE(event->'claims', '{}'::jsonb);

    --------------------------------------------------------
    -- Retrieve user's active membership and tenant details
    --------------------------------------------------------
    SELECT
        m.id,
        m.tenant_id,
        m.role::text,
        t.slug
    INTO
        v_membership_id,
        v_tenant_id,
        v_tenant_role,
        v_tenant_slug
    FROM public.memberships m
    JOIN public.tenants t
        ON t.id = m.tenant_id
    WHERE m.user_id = (event->>'user_id')::uuid
      AND m.status <> 'disabled'
    ORDER BY
        CASE
            WHEN m.status = 'active' THEN 0
            ELSE 1
        END,
        m.created_at
    LIMIT 1;

    --------------------------------------------------------
    -- Activate invited membership on first sign-in
    --------------------------------------------------------
    IF v_membership_id IS NOT NULL THEN
        UPDATE public.memberships
        SET
            status = 'active',
            joined_at = COALESCE(joined_at, now()),
            updated_at = now()
        WHERE id = v_membership_id
          AND status = 'invited';
    END IF;

    --------------------------------------------------------
    -- Inject custom JWT claims
    --------------------------------------------------------
    IF v_tenant_id IS NOT NULL THEN
        claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant_id), true);
    END IF;

    IF v_tenant_role IS NOT NULL THEN
        claims := jsonb_set(claims, '{tenant_role}', to_jsonb(v_tenant_role), true);
    END IF;

    IF v_tenant_slug IS NOT NULL THEN
        claims := jsonb_set(claims, '{tenant_slug}', to_jsonb(v_tenant_slug), true);
    END IF;

    --------------------------------------------------------
    -- Return updated event payload
    --------------------------------------------------------
    event := jsonb_set(event, '{claims}', claims, true);

    RETURN event;
END;
$$;

--------------------------------------------------------------------------------
-- 2. Update Role Permissions
--------------------------------------------------------------------------------

-- Grant schema access
GRANT USAGE
ON SCHEMA public
TO supabase_auth_admin;

-- Grant execution permissions
GRANT EXECUTE
ON FUNCTION public.custom_access_token_hook(jsonb)
TO supabase_auth_admin;

-- Grant table access required for SELECT and UPDATE queries in the hook
GRANT SELECT, UPDATE
ON TABLE public.memberships
TO supabase_auth_admin;

GRANT SELECT
ON TABLE public.tenants
TO supabase_auth_admin;

-- Revoke public execution for safety
REVOKE EXECUTE
ON FUNCTION public.custom_access_token_hook(jsonb)
FROM authenticated, anon, public;

COMMIT;