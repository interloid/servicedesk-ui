-- =====================================================
-- File: ticket_attachments.sql
-- Description: Storage RLS for Ticket Attachments
-- =====================================================


-- =====================================================
-- SELECT
-- =====================================================

CREATE POLICY "ticket_attachments_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'ticket-attachments'
    AND (
        -- Tenant staff
        (
            public.is_active_membership()
            AND public.current_tenant_role() IN (
                'tenant_admin',
                'manager',
                'agent'
            )
            AND (storage.foldername(name))[1] =
                (auth.jwt() ->> 'tenant_id')
        )

        OR

        -- Customer: only attachments from own tickets
        (
            public.current_tenant_role() = 'customer'
            AND (storage.foldername(name))[1] =
                (auth.jwt() ->> 'tenant_id')
            AND EXISTS (
                SELECT 1
                FROM public.tickets t
                JOIN public.customers c
                    ON c.id = t.requester_customer_id
                WHERE t.id = (storage.foldername(name))[2]::uuid
                  AND t.tenant_id = public.current_tenant_id()
                  AND c.portal_user_id = auth.uid()
            )
        )
    )
);


-- =====================================================
-- INSERT
-- =====================================================

CREATE POLICY "ticket_attachments_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'ticket-attachments'
    AND (
        -- Tenant staff
        (
            public.is_active_membership()
            AND public.current_tenant_role() IN (
                'tenant_admin',
                'manager',
                'agent'
            )
            AND (storage.foldername(name))[1] =
                (auth.jwt() ->> 'tenant_id')
        )

        OR

        -- Customer: upload only to own ticket
        (
            public.current_tenant_role() = 'customer'
            AND (storage.foldername(name))[1] =
                (auth.jwt() ->> 'tenant_id')
            AND EXISTS (
                SELECT 1
                FROM public.tickets t
                JOIN public.customers c
                    ON c.id = t.requester_customer_id
                WHERE t.id = (storage.foldername(name))[2]::uuid
                  AND t.tenant_id = public.current_tenant_id()
                  AND c.portal_user_id = auth.uid()
            )
        )
    )
);


-- =====================================================
-- UPDATE
-- =====================================================

CREATE POLICY "ticket_attachments_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'ticket-attachments'
    AND (
        (
            public.is_active_membership()
            AND public.current_tenant_role() IN (
                'tenant_admin',
                'manager',
                'agent'
            )
            AND (storage.foldername(name))[1] =
                (auth.jwt() ->> 'tenant_id')
        )

        OR

        (
            public.current_tenant_role() = 'customer'
            AND (storage.foldername(name))[1] =
                (auth.jwt() ->> 'tenant_id')
            AND EXISTS (
                SELECT 1
                FROM public.tickets t
                JOIN public.customers c
                    ON c.id = t.requester_customer_id
                WHERE t.id = (storage.foldername(name))[2]::uuid
                  AND t.tenant_id = public.current_tenant_id()
                  AND c.portal_user_id = auth.uid()
            )
        )
    )
)
WITH CHECK (
    bucket_id = 'ticket-attachments'
    AND (storage.foldername(name))[1] =
        (auth.jwt() ->> 'tenant_id')
);


-- =====================================================
-- DELETE
-- =====================================================

CREATE POLICY "ticket_attachments_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'ticket-attachments'
    AND (
        -- Staff
        (
            public.is_active_membership()
            AND public.current_tenant_role() IN (
                'tenant_admin',
                'manager'
            )
            AND (storage.foldername(name))[1] =
                (auth.jwt() ->> 'tenant_id')
        )

        OR

        -- Customer: own ticket attachments
        (
            public.current_tenant_role() = 'customer'
            AND (storage.foldername(name))[1] =
                (auth.jwt() ->> 'tenant_id')
            AND EXISTS (
                SELECT 1
                FROM public.tickets t
                JOIN public.customers c
                    ON c.id = t.requester_customer_id
                WHERE t.id = (storage.foldername(name))[2]::uuid
                  AND t.tenant_id = public.current_tenant_id()
                  AND c.portal_user_id = auth.uid()
            )
        )
    )
);