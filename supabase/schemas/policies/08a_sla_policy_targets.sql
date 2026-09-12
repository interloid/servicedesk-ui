-- =====================================================
-- File: 08a_sla_policy_targets.sql
-- Description: RLS Policies for SLA Policy Targets
-- =====================================================

ALTER TABLE public.sla_policy_targets ENABLE ROW LEVEL SECURITY;

-- Mirrors sla_policies: anyone in the tenant can read; admins/managers write;
-- only tenant_admin deletes.

CREATE POLICY "sla_policy_targets_select"
ON public.sla_policy_targets
FOR SELECT
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
);

CREATE POLICY "sla_policy_targets_insert"
ON public.sla_policy_targets
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
);

CREATE POLICY "sla_policy_targets_update"
ON public.sla_policy_targets
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

CREATE POLICY "sla_policy_targets_delete"
ON public.sla_policy_targets
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager')
);
