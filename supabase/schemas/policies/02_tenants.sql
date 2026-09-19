-- =====================================================
-- File: rls_tenants.sql
-- Description: RLS Policies for Tenants
-- =====================================================

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- SELECT
-- Users can only view their own tenant
-- =====================================================

CREATE POLICY "tenants_select"
ON public.tenants
FOR SELECT
TO authenticated
USING (
    id = public.current_tenant_id()
);

-- =====================================================
-- INSERT
-- Only tenant_admin can create a tenant (after sign-up/onboarding)
-- =====================================================

CREATE POLICY "tenants_insert"
ON public.tenants
FOR INSERT
TO authenticated
WITH CHECK (
    public.current_tenant_role() = 'tenant_admin'
);

-- =====================================================
-- UPDATE
-- Only tenant_admin can update tenant details
-- =====================================================

CREATE POLICY "tenants_update"
ON public.tenants
FOR UPDATE
TO authenticated
USING (
    id = public.current_tenant_id()
    AND public.current_tenant_role() = 'tenant_admin'
)
WITH CHECK (
    id = public.current_tenant_id()
    AND public.current_tenant_role() = 'tenant_admin'
);

-- =====================================================
-- DELETE
-- Only tenant_admin can delete their tenant
-- =====================================================

CREATE POLICY "tenants_delete"
ON public.tenants
FOR DELETE
TO authenticated
USING (
    id = public.current_tenant_id()
    AND public.current_tenant_role() = 'tenant_admin'
);