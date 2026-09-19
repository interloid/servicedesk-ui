-- =====================================================
-- File: rls_business_hours.sql
-- Description: RLS Policies for Business Hours
-- =====================================================

ALTER TABLE public.business_hours ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- SELECT
-- Users can view business hours of their tenant
-- =====================================================

CREATE POLICY "business_hours_select"
ON public.business_hours
FOR SELECT
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
);

-- =====================================================
-- INSERT
-- tenant_admin and Manager can create business hours
-- =====================================================

CREATE POLICY "business_hours_insert"
ON public.business_hours
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
);

-- =====================================================
-- UPDATE
-- tenant_admin and Manager can update business hours
-- =====================================================

CREATE POLICY "business_hours_update"
ON public.business_hours
FOR UPDATE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
)
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
);

-- =====================================================
-- DELETE
-- Only tenant_admin can delete business hours
-- =====================================================

CREATE POLICY "business_hours_delete"
ON public.business_hours
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() = 'tenant_admin'
);