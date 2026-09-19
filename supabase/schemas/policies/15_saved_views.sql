-- =====================================================
-- Saved Views RLS Policies
-- =====================================================
--
-- `saved_views` is a PER-USER table, not merely a per-tenant one. Audit finding P2-9:
-- the original four policies gated on `tenant_id` + `is_active_membership()` and never
-- referenced `owner_user_id` or `is_shared`, so every tenant member could read, update
-- and DELETE any colleague's private view. `is_shared` existed as a column that no
-- policy consulted.
--
-- The rule these encode:
--   · a user sees their OWN views (private or shared) plus the tenant's SHARED views;
--   · a user may only create views they own;
--   · a user may only modify or delete their OWN views — a colleague's private view is
--     off-limits even to a tenant_admin.
--
-- `owner_user_id` references `public.users(id)`, which is 1:1 with `auth.users(id)`, so
-- `owner_user_id = auth.uid()` is the correct ownership test.
--
-- ⚠ `notification_prefs` (policies/16) and `notifications` (policies/17) carry the
-- IDENTICAL P2-9 defect and are deliberately NOT fixed here — this change is scoped to
-- `saved_views`. See docs/WIRING-SAVEDVIEWS-REPORTS.md § Backend gaps.

ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- SELECT
-- Own views (shared or private) + the tenant's shared views
-- =====================================================

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

-- =====================================================
-- INSERT
-- You may only create views you own
-- =====================================================

CREATE POLICY "saved_views_insert"
ON public.saved_views
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
    AND owner_user_id = auth.uid()
);

-- =====================================================
-- UPDATE
-- Owner only. Sharing a view does NOT hand over write access.
-- =====================================================

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

-- =====================================================
-- DELETE
-- Owner only.
-- =====================================================

CREATE POLICY "saved_views_delete"
ON public.saved_views
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
    AND owner_user_id = auth.uid()
);
