-- =====================================================
-- Saved Views RLS Policies
-- =====================================================
--
-- `saved_views` is per-user, not merely per-tenant (audit finding P2-9): a
-- colleague's private view is off-limits even to a tenant_admin. Built-in
-- views (`is_system`) are read-only to everyone, and `visibility_roles`
-- narrows which staff roles see a shared or built-in view. Per-user order
-- lives in saved_view_user_preferences, whose rows may only point at a view
-- their user can already see.
--
-- `owner_user_id` references `public.users(id)`, which is 1:1 with
-- `auth.users(id)`, so `owner_user_id = auth.uid()` is the ownership test.

ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;

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
