-- =====================================================
-- Team invites: member activation + directory visibility
-- =====================================================
--
-- Two changes that together make the /settings/team invite
-- flow work end to end:
--
--  1. custom_access_token_hook now PICKS the caller's membership
--     (active wins, disabled is excluded) and ACTIVATES an
--     invited membership on the member's first sign-in — a new
--     invitee has no session yet, so nothing else can flip it.
--  2. users_select now exposes profiles of every tenant member
--     regardless of membership status. The old policy hid
--     `invited`/`disabled` rows, which made the team table
--     render rows with no name or email.
--
-- Mirrors the declarative sources:
--   schemas/functions/03_custom_access_token_hook.sql
--   schemas/policies/03_users.sql

-- ── 1. Access token hook ──────────────────────────────────────────────────

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
    v_membership_id uuid;
BEGIN
    claims := event->'claims';

    SELECT
        m.id,
        m.tenant_id,
        m.role::text
    INTO
        v_membership_id,
        v_tenant_id,
        v_tenant_role
    FROM public.memberships m
    WHERE m.user_id = (event->>'user_id')::uuid
      AND m.status <> 'disabled'
    ORDER BY (CASE WHEN m.status = 'active' THEN 0 ELSE 1 END), m.created_at
    LIMIT 1;

    -- Activate the invite on first sign-in (idempotent).
    IF v_membership_id IS NOT NULL THEN
        UPDATE public.memberships
        SET status = 'active',
            joined_at = COALESCE(joined_at, now()),
            updated_at = now()
        WHERE id = v_membership_id
          AND status = 'invited';
    END IF;

    claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant_id), true);
    claims := jsonb_set(claims, '{tenant_role}', to_jsonb(v_tenant_role), true);

    RETURN jsonb_set(event, '{claims}', claims, true);
END;
$$;

GRANT EXECUTE
ON FUNCTION public.custom_access_token_hook(jsonb)
TO supabase_auth_admin;

REVOKE EXECUTE
ON FUNCTION public.custom_access_token_hook(jsonb)
FROM authenticated, anon, public;

-- ── 2. users_select policy ────────────────────────────────────────────────

DROP POLICY IF EXISTS "users_select" ON public.users;

CREATE POLICY "users_select"
ON public.users
FOR SELECT
TO authenticated
USING (
    id = auth.uid()
    OR EXISTS (
        SELECT 1
        FROM public.memberships m
        WHERE m.user_id = public.users.id
          AND m.tenant_id = public.current_tenant_id()
    )
);
