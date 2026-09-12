-- =====================================================
-- Customer Files
-- =====================================================

CREATE POLICY "customer_files_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'customer-files'
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager',
        'agent'
    )
    AND (storage.foldername(name))[1] =
        (auth.jwt() ->> 'tenant_id')
);


CREATE POLICY "customer_files_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'customer-files'
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager',
        'agent'
    )
    AND (storage.foldername(name))[1] =
        (auth.jwt() ->> 'tenant_id')
);


CREATE POLICY "customer_files_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'customer-files'
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager'
    )
    AND (storage.foldername(name))[1] =
        (auth.jwt() ->> 'tenant_id')
);