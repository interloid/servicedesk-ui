-- =====================================================
-- Invoices
-- =====================================================

CREATE POLICY "invoices_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'invoices'
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'billing_admin'
    )
    AND (storage.foldername(name))[1] =
        (auth.jwt() ->> 'tenant_id')
);


CREATE POLICY "invoices_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'invoices'
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'billing_admin'
    )
    AND (storage.foldername(name))[1] =
        (auth.jwt() ->> 'tenant_id')
);


CREATE POLICY "invoices_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'invoices'
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'billing_admin'
    )
    AND (storage.foldername(name))[1] =
        (auth.jwt() ->> 'tenant_id')
)
WITH CHECK (
    bucket_id = 'invoices'
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'billing_admin'
    )
    AND (storage.foldername(name))[1] =
        (auth.jwt() ->> 'tenant_id')
);


CREATE POLICY "invoices_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'invoices'
    AND public.is_active_membership()
    AND public.current_tenant_role() = 'tenant_admin'
    AND (storage.foldername(name))[1] =
        (auth.jwt() ->> 'tenant_id')
);