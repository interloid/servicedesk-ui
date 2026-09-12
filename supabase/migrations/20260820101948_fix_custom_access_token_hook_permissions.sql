BEGIN;

GRANT USAGE
ON SCHEMA public
TO supabase_auth_admin;

GRANT EXECUTE
ON FUNCTION public.custom_access_token_hook(jsonb)
TO supabase_auth_admin;

GRANT SELECT
ON TABLE public.memberships
TO supabase_auth_admin;

REVOKE UPDATE
ON TABLE public.memberships
FROM supabase_auth_admin;

COMMIT;