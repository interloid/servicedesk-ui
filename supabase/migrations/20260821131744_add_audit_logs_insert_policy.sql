CREATE POLICY "audit_logs_insert"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (
    actor_id = auth.uid()
    AND tenant_id = public.current_tenant_id()
);