-- ==========================================================
-- Migration: Avatars Storage RLS, Custom Access Token Hook,
--            and Active Membership Function
-- ==========================================================

BEGIN;

------------------------------------------------------------
-- 1. Create Public Storage Bucket for Avatars
------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public) 
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO UPDATE SET public = true;


------------------------------------------------------------
-- 2. Storage RLS Policies for 'avatars' Bucket
------------------------------------------------------------

DROP POLICY IF EXISTS "avatars_select" ON storage.objects;
CREATE POLICY "avatars_select"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_insert" ON storage.objects;
CREATE POLICY "avatars_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'avatars'
    AND (
        (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
        OR (storage.foldername(name))[1] = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')
    )
);

DROP POLICY IF EXISTS "avatars_update" ON storage.objects;
CREATE POLICY "avatars_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'avatars'
    AND (
        (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
        OR (storage.foldername(name))[1] = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')
    )
)
WITH CHECK (
    bucket_id = 'avatars'
    AND (
        (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
        OR (storage.foldername(name))[1] = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')
    )
);

DROP POLICY IF EXISTS "avatars_delete" ON storage.objects;
CREATE POLICY "avatars_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'avatars'
    AND (
        (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
        OR (storage.foldername(name))[1] = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')
    )
);


------------------------------------------------------------
-- 3. Custom Access Token Hook Function
------------------------------------------------------------

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

    event := jsonb_set(event, '{claims}', claims, true);

    RETURN event;
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM authenticated, anon, public;
GRANT SELECT, UPDATE ON TABLE public.memberships TO supabase_auth_admin;


------------------------------------------------------------
-- 4. Helper Function: Check Active Membership Status
------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_active_membership()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND m.tenant_id = NULLIF(auth.jwt() ->> 'tenant_id', '')::uuid
      AND m.role::text = (auth.jwt() ->> 'tenant_role')
      AND m.status = 'active'
);
$$;

GRANT EXECUTE ON FUNCTION public.is_active_membership() TO authenticated;

COMMIT;