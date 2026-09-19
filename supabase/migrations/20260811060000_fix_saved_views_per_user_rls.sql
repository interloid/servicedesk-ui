-- =====================================================
-- Fix P2-9: saved_views has no per-user scoping
-- =====================================================
--
-- Mirrors supabase/schemas/policies/15_saved_views.sql exactly.
--
-- The four policies created in 20260810045832_initial_schema.sql gate only on
-- `tenant_id` + `is_active_membership()`. They never reference `owner_user_id` or
-- `is_shared`, so any tenant member can read, update and DELETE any colleague's private
-- saved view. This replaces them with owner-aware equivalents.
--
-- Scoped to `saved_views` only. `notification_prefs` and `notifications` carry the same
-- defect and are intentionally left alone here.

DROP POLICY IF EXISTS "Members can view tenant Saved View"   ON public.saved_views;
DROP POLICY IF EXISTS "Members can create tenant Saved View" ON public.saved_views;
DROP POLICY IF EXISTS "Members can update tenant Saved View" ON public.saved_views;
DROP POLICY IF EXISTS "Members can delete tenant Saved View" ON public.saved_views;

-- SELECT — own views (private or shared) + the tenant's shared views
CREATE POLICY "saved_views_select"
ON public.saved_views
FOR SELECT
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
    AND (
        owner_user_id = auth.uid()
        OR is_shared
    )
);

-- INSERT — you may only create views you own
CREATE POLICY "saved_views_insert"
ON public.saved_views
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
    AND owner_user_id = auth.uid()
);

-- UPDATE — owner only; sharing does not hand over write access
CREATE POLICY "saved_views_update"
ON public.saved_views
FOR UPDATE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
    AND owner_user_id = auth.uid()
)
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
    AND owner_user_id = auth.uid()
);

-- DELETE — owner only
CREATE POLICY "saved_views_delete"
ON public.saved_views
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
    AND owner_user_id = auth.uid()
);
