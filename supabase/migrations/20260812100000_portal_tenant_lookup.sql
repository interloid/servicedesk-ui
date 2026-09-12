-- =====================================================
-- Portal tenancy: public tenant-by-slug lookup
--
-- Subdomain routing (`{slug}.{base}`) needs to resolve a Host-header slug to a
-- tenant BEFORE the visitor signs in. `tenants_select` is authenticated-only and
-- scoped to the caller's own tenant, so an anonymous portal visitor can never
-- match — this security-definer function is the narrow, anon-granted exception
-- that returns only public branding fields (id, name, slug, primary color, logo).
--
-- Mirrors the declarative source:
--   schemas/functions/09_get_tenant_by_slug.sql
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_tenant_by_slug(p_slug text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        jsonb_build_object(
            'id',           t.id,
            'name',         t.name,
            'slug',         t.slug,
            'primary_color', t.branding_json ->> 'primary_color',
            'logo_url',      t.branding_json ->> 'logo_url'
        )
    FROM public.tenants t
    WHERE t.slug = lower(p_slug)
      AND p_slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
    LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_tenant_by_slug(text) IS
'Resolve a portal subdomain slug to its public branding fields. Granted to anon so the login/portal can render before sign-in. Never exposes non-public tenant data.';

GRANT EXECUTE
ON FUNCTION public.get_tenant_by_slug(text)
TO anon, authenticated;

REVOKE EXECUTE
ON FUNCTION public.get_tenant_by_slug(text)
FROM public;
