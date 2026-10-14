-- =====================================================
-- File: 22_seed_system_saved_views.sql
-- Description: The four built-in saved views (All tickets, New, Open,
-- Resolved) for a tenant. Idempotent; run by a trigger on tenants insert.
-- =====================================================

CREATE OR REPLACE FUNCTION public.seed_system_saved_views(p_tenant_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.saved_views
    (tenant_id, owner_user_id, name, filter_json, is_shared, is_system, system_key, visibility_roles)
  SELECT p_tenant_id, NULL, v.name, v.filter_json, true, true, v.system_key,
         ARRAY['tenant_admin', 'manager', 'agent', 'billing_admin']::text[]
  FROM (VALUES
    ('all',      'All tickets', '{}'::jsonb),
    ('new',      'New',         '{"statuses":["new"]}'::jsonb),
    ('open',     'Open',        '{"statuses":["open"]}'::jsonb),
    ('resolved', 'Resolved',    '{"statuses":["resolved"]}'::jsonb)
  ) AS v(system_key, name, filter_json)
  ON CONFLICT (tenant_id, system_key) WHERE is_system DO NOTHING;
$$;

REVOKE ALL ON FUNCTION public.seed_system_saved_views(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.seed_system_saved_views_for_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_system_saved_views(NEW.id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_system_saved_views_for_tenant() FROM PUBLIC, anon, authenticated;
