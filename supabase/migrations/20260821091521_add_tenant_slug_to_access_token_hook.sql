-- ==========================================================
-- File: 20260821160000_add_tenant_slug_to_access_token_hook.sql
-- Description: Add tenant_slug to JWT claims
-- ==========================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
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
    -- Existing JWT claims
    --------------------------------------------------------

    claims := COALESCE(event->'claims', '{}'::jsonb);

    --------------------------------------------------------
    -- Get user's active membership and tenant
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
    -- Add tenant_id claim
    --------------------------------------------------------

    IF v_tenant_id IS NOT NULL THEN
        claims := jsonb_set(
            claims,
            '{tenant_id}',
            to_jsonb(v_tenant_id),
            true
        );
    END IF;

    --------------------------------------------------------
    -- Add tenant_role claim
    --------------------------------------------------------

    IF v_tenant_role IS NOT NULL THEN
        claims := jsonb_set(
            claims,
            '{tenant_role}',
            to_jsonb(v_tenant_role),
            true
        );
    END IF;

    --------------------------------------------------------
    -- Add tenant_slug claim
    --------------------------------------------------------

    IF v_tenant_slug IS NOT NULL THEN
        claims := jsonb_set(
            claims,
            '{tenant_slug}',
            to_jsonb(v_tenant_slug),
            true
        );
    END IF;

    --------------------------------------------------------
    -- Update event claims
    --------------------------------------------------------

    event := jsonb_set(
        event,
        '{claims}',
        claims,
        true
    );

    RETURN event;
END;
$$;

------------------------------------------------------------
-- Permissions
------------------------------------------------------------

GRANT EXECUTE
ON FUNCTION public.custom_access_token_hook(jsonb)
TO supabase_auth_admin;

REVOKE EXECUTE
ON FUNCTION public.custom_access_token_hook(jsonb)
FROM authenticated, anon, public;

COMMIT;