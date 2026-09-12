-- =====================================================
-- File: 18_invoices.sql
-- Description: RLS Policies for Invoices
-- =====================================================

ALTER TABLE public.invoices
ENABLE ROW LEVEL SECURITY;


-- =====================================================
-- SELECT
-- Tenant Admin + Billing Admin
-- =====================================================

CREATE POLICY "invoices_select"
ON public.invoices
FOR SELECT
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'billing_admin'
    )
);


-- =====================================================
-- INSERT
-- Tenant Admin + Billing Admin
-- =====================================================

CREATE POLICY "invoices_insert"
ON public.invoices
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'billing_admin'
    )
);


-- =====================================================
-- UPDATE
-- Tenant Admin + Billing Admin
-- =====================================================

CREATE POLICY "invoices_update"
ON public.invoices
FOR UPDATE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'billing_admin'
    )
)
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'billing_admin'
    )
);


-- =====================================================
-- DELETE
-- Tenant Admin only
-- =====================================================

CREATE POLICY "invoices_delete"
ON public.invoices
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
    AND public.current_tenant_role() = 'tenant_admin'
);