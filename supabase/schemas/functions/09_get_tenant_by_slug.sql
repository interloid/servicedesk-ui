-- =============================================================
-- File: 09_get_tenant_by_slug.sql
-- Description: Public (anon-safe) tenant lookup for subdomain routing
-- =============================================================

-- ------------------------------------------------------------
-- Why this exists
-- ------------------------------------------------------------
--
-- The branding login, the customer portal and the app-shell guard all need to
-- resolve the `Host` header's subdomain to a tenant BEFORE the visitor is signed
-- in. `tenants_select` cannot do that for an anonymous caller: it is scoped to
-- `authenticated` and filters on `current_tenant_id()`, which reads the JWT claim
-- a signed-out visitor doesn't have.
--
-- This SECURITY DEFINER function is the narrow exception. It is the ONLY way an
-- unauthenticated caller learns anything about a tenant, so it returns exactly the
-- public-facing branding fields and nothing else — no id is given out unless the
-- slug matches, and the caller never sees email addresses, subscription state,
-- seats or any other row.
--
-- The slug is validated with the same shape `memberships`-adjacent code uses, so
-- the function is not a slug oracle for arbitrary strings: a malformed slug simply
-- matches nothing.
-- ------------------------------------------------------------

create or replace function public.get_tenant_by_slug(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select
        jsonb_build_object(
            'id',          t.id,
            'name',        t.name,
            'slug',        t.slug,
            'primary_color', t.branding_json ->> 'primary_color',
            'logo_url',      t.branding_json ->> 'logo_url'
        )
    from public.tenants t
    where t.slug = lower(p_slug)
      and p_slug ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
    limit 1;
$$;

comment on function public.get_tenant_by_slug(text) is
'Resolve a portal subdomain slug to its public branding fields. Granted to anon so the login/portal can render before sign-in. Never exposes non-public tenant data.';

grant execute
on function public.get_tenant_by_slug(text)
to anon, authenticated;

revoke execute
on function public.get_tenant_by_slug(text)
from public;
