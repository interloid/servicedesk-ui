-- =====================================================
-- File: 21_subscription_switches.sql
-- Description: RLS Policies for Subscription Switches
-- =====================================================

ALTER TABLE public.subscription_switches
ENABLE ROW LEVEL SECURITY;


-- =====================================================
-- SELECT
-- Tenant Admin + Billing Admin
-- =====================================================

CREATE POLICY "subscription_switches_select"
ON public.subscription_switches
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
-- UPDATE
-- Tenant Admin + Billing Admin
-- =====================================================

CREATE POLICY "subscription_switches_update"
ON public.subscription_switches
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