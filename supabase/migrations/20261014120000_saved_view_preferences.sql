-- =====================================================
-- Saved views: built-in defaults, role visibility, per-user order
-- =====================================================
--
-- 1. saved_views gains `is_system` / `system_key` (the four built-in views, one row
--    each per tenant, no owner) and `visibility_roles` (which staff roles see a
--    shared view).
-- 2. saved_view_user_preferences holds each user's own order and pin for every view
--    they can see, so dragging a shared view never moves it for anyone else.
-- 3. RLS: a preference row can only point at a view its user can already SELECT,
--    so nobody can store (or probe) an order for a colleague's private view.
--
-- Mirrors supabase/schemas/tables/16_saved_views.sql and
-- supabase/schemas/policies/15_saved_views.sql.

BEGIN;

-- ── 1. saved_views columns ───────────────────────────────────────────────────

ALTER TABLE public.saved_views
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS system_key text,
  ADD COLUMN IF NOT EXISTS visibility_roles text[] NOT NULL
    DEFAULT ARRAY['tenant_admin', 'manager', 'agent']::text[];

-- System views have no owner; every custom view still must.
ALTER TABLE public.saved_views
  ALTER COLUMN owner_user_id DROP NOT NULL;

UPDATE public.saved_views SET created_at = now() WHERE created_at IS NULL;
UPDATE public.saved_views SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE public.saved_views
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.saved_views
  DROP CONSTRAINT IF EXISTS saved_views_system_shape,
  ADD CONSTRAINT saved_views_system_shape CHECK (
    CASE
      WHEN is_system THEN owner_user_id IS NULL
        AND system_key IN ('all', 'new', 'open', 'resolved')
      ELSE owner_user_id IS NOT NULL AND system_key IS NULL
    END
  ),
  DROP CONSTRAINT IF EXISTS saved_views_visibility_roles_valid,
  ADD CONSTRAINT saved_views_visibility_roles_valid CHECK (
    cardinality(visibility_roles) > 0
    AND visibility_roles <@ ARRAY['tenant_admin', 'manager', 'agent', 'billing_admin']::text[]
  ),
  DROP CONSTRAINT IF EXISTS saved_views_name_length,
  ADD CONSTRAINT saved_views_name_length CHECK (
    char_length(btrim(name)) BETWEEN 1 AND 80
  ) NOT VALID;

-- Target of the preference table's tenant-consistent foreign key.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'saved_views_id_tenant_key'
      AND conrelid = 'public.saved_views'::regclass
  ) THEN
    ALTER TABLE public.saved_views
      ADD CONSTRAINT saved_views_id_tenant_key UNIQUE (id, tenant_id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS saved_views_system_key_idx
  ON public.saved_views (tenant_id, system_key)
  WHERE is_system;

CREATE INDEX IF NOT EXISTS saved_views_tenant_idx
  ON public.saved_views (tenant_id, created_at);

DROP TRIGGER IF EXISTS set_saved_views_updated_at ON public.saved_views;
CREATE TRIGGER set_saved_views_updated_at
BEFORE UPDATE ON public.saved_views
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ── 2. The four built-in views ───────────────────────────────────────────────

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

DROP TRIGGER IF EXISTS tenants_seed_system_saved_views ON public.tenants;
CREATE TRIGGER tenants_seed_system_saved_views
AFTER INSERT ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.seed_system_saved_views_for_tenant();

SELECT public.seed_system_saved_views(t.id) FROM public.tenants t;

-- ── 3. Per-user preferences ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.saved_view_user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  tenant_id uuid NOT NULL
    REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,
  saved_view_id uuid NOT NULL,

  order_position integer NOT NULL DEFAULT 0
    CHECK (order_position >= 0),
  is_pinned boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT saved_view_user_preferences_unique
    UNIQUE (user_id, saved_view_id),

  -- Composite so a preference can never point at another tenant's view.
  CONSTRAINT saved_view_user_preferences_view_fk
    FOREIGN KEY (saved_view_id, tenant_id)
    REFERENCES public.saved_views (id, tenant_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS saved_view_preferences_order_idx
  ON public.saved_view_user_preferences (tenant_id, user_id, order_position);

CREATE INDEX IF NOT EXISTS saved_view_preferences_view_idx
  ON public.saved_view_user_preferences (saved_view_id);

DROP TRIGGER IF EXISTS set_saved_view_user_preferences_updated_at
  ON public.saved_view_user_preferences;
CREATE TRIGGER set_saved_view_user_preferences_updated_at
BEFORE UPDATE ON public.saved_view_user_preferences
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ── 4. saved_views RLS ───────────────────────────────────────────────────────
--
-- SELECT: your own views, plus built-in and shared views whose visibility_roles
-- include your role. Portal customers see none.
-- INSERT/UPDATE/DELETE: owner only, and never a built-in view.

DROP POLICY IF EXISTS "saved_views_select" ON public.saved_views;
DROP POLICY IF EXISTS "saved_views_insert" ON public.saved_views;
DROP POLICY IF EXISTS "saved_views_update" ON public.saved_views;
DROP POLICY IF EXISTS "saved_views_delete" ON public.saved_views;

CREATE POLICY "saved_views_select"
ON public.saved_views
FOR SELECT
TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND public.is_active_membership()
  AND public.current_tenant_role() <> 'customer'
  AND (
    owner_user_id = auth.uid()
    OR (
      (is_system OR is_shared)
      AND public.current_tenant_role() = ANY (visibility_roles)
    )
  )
);

CREATE POLICY "saved_views_insert"
ON public.saved_views
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.is_active_membership()
  AND public.current_tenant_role() <> 'customer'
  AND owner_user_id = auth.uid()
  AND NOT is_system
);

CREATE POLICY "saved_views_update"
ON public.saved_views
FOR UPDATE
TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND public.is_active_membership()
  AND owner_user_id = auth.uid()
  AND NOT is_system
)
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.is_active_membership()
  AND owner_user_id = auth.uid()
  AND NOT is_system
);

CREATE POLICY "saved_views_delete"
ON public.saved_views
FOR DELETE
TO authenticated
USING (
  tenant_id = public.current_tenant_id()
  AND public.is_active_membership()
  AND owner_user_id = auth.uid()
  AND NOT is_system
);

-- ── 5. saved_view_user_preferences RLS ───────────────────────────────────────
--
-- Your own rows only. The EXISTS runs under saved_views' SELECT policy, so a
-- row can only be written for a view you can see.

ALTER TABLE public.saved_view_user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_view_prefs_select" ON public.saved_view_user_preferences;
DROP POLICY IF EXISTS "saved_view_prefs_insert" ON public.saved_view_user_preferences;
DROP POLICY IF EXISTS "saved_view_prefs_update" ON public.saved_view_user_preferences;
DROP POLICY IF EXISTS "saved_view_prefs_delete" ON public.saved_view_user_preferences;

CREATE POLICY "saved_view_prefs_select"
ON public.saved_view_user_preferences
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  AND tenant_id = public.current_tenant_id()
  AND public.is_active_membership()
);

CREATE POLICY "saved_view_prefs_insert"
ON public.saved_view_user_preferences
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND tenant_id = public.current_tenant_id()
  AND public.is_active_membership()
  AND EXISTS (
    SELECT 1 FROM public.saved_views v
    WHERE v.id = saved_view_user_preferences.saved_view_id
      AND v.tenant_id = saved_view_user_preferences.tenant_id
  )
);

CREATE POLICY "saved_view_prefs_update"
ON public.saved_view_user_preferences
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND tenant_id = public.current_tenant_id()
  AND public.is_active_membership()
)
WITH CHECK (
  user_id = auth.uid()
  AND tenant_id = public.current_tenant_id()
  AND public.is_active_membership()
  AND EXISTS (
    SELECT 1 FROM public.saved_views v
    WHERE v.id = saved_view_user_preferences.saved_view_id
      AND v.tenant_id = saved_view_user_preferences.tenant_id
  )
);

CREATE POLICY "saved_view_prefs_delete"
ON public.saved_view_user_preferences
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  AND tenant_id = public.current_tenant_id()
  AND public.is_active_membership()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_view_user_preferences TO authenticated;

COMMIT;
