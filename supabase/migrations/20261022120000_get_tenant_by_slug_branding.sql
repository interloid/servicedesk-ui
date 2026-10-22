-- =====================================================
-- Portal branding: the rest of the branding fields from get_tenant_by_slug
--
-- The branding editor saves secondary, text and background colours and a
-- "show logo on portal" switch, but the anon-safe tenant lookup only returned
-- primary_color and logo_url, so customers never saw those settings. This adds
-- them; all four are public-facing branding, the same class as what was
-- already returned. show_logo_on_portal is true unless it is stored as a JSON
-- false.
--
-- Mirrors the declarative source:
--   schemas/functions/09_get_tenant_by_slug.sql
-- =====================================================

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
            'secondary_color', t.branding_json ->> 'secondary_color',
            'text_color',      t.branding_json ->> 'text_color',
            'background_color', t.branding_json ->> 'background_color',
            'logo_url',      t.branding_json ->> 'logo_url',
            -- Read only when it is a real JSON boolean, so a hand-edited value
            -- can't make the cast fail and take the whole lookup down with it.
            -- Missing means shown, the branding editor's default.
            'show_logo_on_portal',
                case
                    when jsonb_typeof(t.branding_json -> 'show_logo_on_portal') = 'boolean'
                        then (t.branding_json -> 'show_logo_on_portal')::boolean
                    else true
                end
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
