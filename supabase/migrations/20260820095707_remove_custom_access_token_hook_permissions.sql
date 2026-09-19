-- ==========================================================
-- Migration: Remove Custom Access Token Hook Permissions
-- ==========================================================

BEGIN;

REVOKE EXECUTE
ON FUNCTION public.custom_access_token_hook(jsonb)
FROM supabase_auth_admin;

REVOKE SELECT, UPDATE
ON TABLE public.memberships
FROM supabase_auth_admin;

REVOKE USAGE
ON SCHEMA public
FROM supabase_auth_admin;

COMMIT;