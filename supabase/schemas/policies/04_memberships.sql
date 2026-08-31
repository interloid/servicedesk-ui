-- =====================================================
-- File: rls_memberships.sql
-- Description: RLS Policies for Memberships
-- =====================================================

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- SELECT
-- Tenant members can view memberships
-- =====================================================

CREATE POLICY "memberships_select"
ON public.memberships
FOR SELECT
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
);

-- =====================================================
-- INSERT
-- Only tenant tenant_admin can invite/add members
-- =====================================================

CREATE POLICY "memberships_insert"
ON public.memberships
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager'
    )
);

-- =====================================================
-- UPDATE
-- Only tenant tenant_admins can change roles
-- =====================================================

CREATE POLICY "memberships_update"
ON public.memberships
FOR UPDATE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
)
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() = 'tenant_admin'
);

-- =====================================================
-- DELETE
-- Only tenant tenant_admins can remove members
-- =====================================================

CREATE POLICY "memberships_delete"
ON public.memberships
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() = 'tenant_admin'
);