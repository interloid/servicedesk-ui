-- =====================================================
-- File: 08b_sla_policy_customers.sql
-- Description: RLS Policies for SLA Policy Customers
-- =====================================================

ALTER TABLE public.sla_policy_customers ENABLE ROW LEVEL SECURITY;

-- Mirrors sla_policy_targets: anyone in the tenant can read; admins/managers
-- write. Rows are only ever inserted or deleted, never updated.

CREATE POLICY "sla_policy_customers_select"
ON public.sla_policy_customers
FOR SELECT
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
);

-- Both ends must be in the caller's tenant, not just the tenant_id column:
-- otherwise a known foreign customer or policy id could be linked in.
CREATE POLICY "sla_policy_customers_insert"
ON public.sla_policy_customers
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
    AND EXISTS (
        SELECT 1 FROM public.sla_policies p
        WHERE p.id = policy_id AND p.tenant_id = public.current_tenant_id()
    )
    AND EXISTS (
        SELECT 1 FROM public.customers c
        WHERE c.id = customer_id AND c.tenant_id = public.current_tenant_id()
    )
);

CREATE POLICY "sla_policy_customers_delete"
ON public.sla_policy_customers
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
);
