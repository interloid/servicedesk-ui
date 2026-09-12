-- =====================================================
-- File: 08_sla_policies.sql
-- Description: RLS Policies for SLA Policies
-- =====================================================

ALTER TABLE public.sla_policies ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- SELECT — every active member of the tenant
-- =====================================================

CREATE POLICY "sla_policies_select"
ON public.sla_policies
FOR SELECT
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
);

-- =====================================================
-- INSERT — tenant_admin and manager
-- =====================================================

CREATE POLICY "sla_policies_insert"
ON public.sla_policies
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
);

-- =====================================================
-- UPDATE — tenant_admin and manager
-- =====================================================

CREATE POLICY "sla_policies_update"
ON public.sla_policies
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
-- DELETE — tenant_admin only
-- =====================================================

CREATE POLICY "sla_policies_delete"
ON public.sla_policies
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() = 'tenant_admin'
);
