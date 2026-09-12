-- =====================================================
-- File: 05_subscriptions.sql
-- Description: RLS Policies for Subscriptions
-- =====================================================

ALTER TABLE public.subscriptions
ENABLE ROW LEVEL SECURITY;


-- =====================================================
-- SELECT
-- Tenant Admin + Billing Admin
-- =====================================================

CREATE POLICY "subscriptions_select"
ON public.subscriptions
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

CREATE POLICY "subscriptions_insert"
ON public.subscriptions
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

CREATE POLICY "subscriptions_update"
ON public.subscriptions
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

CREATE POLICY "subscriptions_delete"
ON public.subscriptions
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
    AND public.current_tenant_role() = 'tenant_admin'
);