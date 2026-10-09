-- =====================================================
-- SLA policies scoped to selected customers
-- =====================================================
--
-- "Applies to" is now a choice between every customer and a hand-picked list.
-- applies_to gains 'Selected customers'; the picked customers live in
-- sla_policy_customers. The two older values stay allowed so existing rows
-- are untouched; the editor shows them as "All customers".
--
-- Mirrors supabase/schemas/tables/09_sla_policies.sql,
-- 09b_sla_policy_customers.sql and policies/08b_sla_policy_customers.sql.

ALTER TABLE public.sla_policies
  DROP CONSTRAINT IF EXISTS sla_policies_applies_to_check;

ALTER TABLE public.sla_policies
  ADD CONSTRAINT sla_policies_applies_to_check
  CHECK (
    applies_to IN (
      'All customers',
      'Selected customers',
      'Business & Enterprise customers',
      'Urgent tickets only'
    )
  );

CREATE TABLE IF NOT EXISTS public.sla_policy_customers
(
    -- Denormalised for RLS, like sla_policy_targets.
    tenant_id uuid NOT NULL
        REFERENCES public.tenants(id) ON DELETE CASCADE,
    policy_id uuid NOT NULL
        REFERENCES public.sla_policies(id) ON DELETE CASCADE,
    customer_id uuid NOT NULL
        REFERENCES public.customers(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),

    PRIMARY KEY (policy_id, customer_id)
);

COMMENT ON TABLE public.sla_policy_customers IS
'Customers an SLA policy is limited to when applies_to = ''Selected customers''.';

CREATE INDEX IF NOT EXISTS idx_sla_policy_customers_tenant
ON public.sla_policy_customers(tenant_id);

CREATE INDEX IF NOT EXISTS idx_sla_policy_customers_customer
ON public.sla_policy_customers(customer_id);

ALTER TABLE public.sla_policy_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sla_policy_customers_select" ON public.sla_policy_customers;
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
DROP POLICY IF EXISTS "sla_policy_customers_insert" ON public.sla_policy_customers;
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

DROP POLICY IF EXISTS "sla_policy_customers_delete" ON public.sla_policy_customers;
CREATE POLICY "sla_policy_customers_delete"
ON public.sla_policy_customers
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
);
