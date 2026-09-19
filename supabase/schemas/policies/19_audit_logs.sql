ALTER TABLE public.audit_logs
ENABLE ROW LEVEL SECURITY;

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

CREATE POLICY "audit_logs_insert"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (
    actor_id = auth.uid()
    AND tenant_id = public.current_tenant_id()
);