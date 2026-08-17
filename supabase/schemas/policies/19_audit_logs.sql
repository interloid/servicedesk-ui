-- =====================================================
-- File: 19_audit_logs.sql
-- Description: RLS Policies for Audit Logs
-- =====================================================

ALTER TABLE public.audit_logs
ENABLE ROW LEVEL SECURITY;


-- =====================================================
-- SELECT
--
-- Tenant Admin and Manager can view audit logs
-- belonging to their tenant.
-- =====================================================

CREATE POLICY "audit_logs_select"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager'
    )
);

