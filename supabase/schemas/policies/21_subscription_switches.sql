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
-- No INSERT / UPDATE / DELETE for clients
-- =====================================================
-- Switches are written only by the edge functions, with the service role.
-- A client UPDATE policy would let a billing admin retarget their own pending
-- upgrade (plan_id) to a pricier plan before capture-order reads it.
