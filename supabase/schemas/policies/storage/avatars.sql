-- =====================================================
-- Avatars
-- =====================================================

CREATE POLICY "avatars_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] =
        (auth.jwt() ->> 'tenant_id')
);


CREATE POLICY "avatars_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] =
        (auth.jwt() ->> 'tenant_id')
)
WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] =
        (auth.jwt() ->> 'tenant_id')
);


CREATE POLICY "avatars_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] =
        (auth.jwt() ->> 'tenant_id')
);