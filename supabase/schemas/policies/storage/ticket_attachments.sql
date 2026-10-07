-- =====================================================
-- File: ticket_attachments.sql
-- Description: Storage RLS for Ticket Attachments
-- =====================================================
--
-- Staff: their tenant's folder. Read, upload and update for tenant_admin,
-- manager and agent; delete for tenant_admin and manager -- as before customers
-- existed (20260810053816).
--
-- Customer: read a file only when they may read the attachments row that points
-- at it (their own ticket; a public message or the opening post), decided by
-- joining public.attachments on storage_path rather than by the shape of the
-- path. Upload only into a ticket they own. Never update or delete -- the portal
-- moves and removes files with the admin client. Kept in step with
-- migration 20260926120000.

CREATE POLICY "ticket_attachments_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'ticket-attachments'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
    AND (
        (
            public.is_active_membership()
            AND public.current_tenant_role() IN (
                'tenant_admin',
                'manager',
                'agent'
            )
        )
        OR
        (
            public.current_tenant_role() = 'customer'
            AND EXISTS (
                SELECT 1
                FROM public.attachments a
                JOIN public.tickets t
                    ON t.id = a.ticket_id
                JOIN public.customers c
                    ON c.id = t.requester_customer_id
                WHERE a.storage_path = storage.objects.name
                  AND a.tenant_id = public.current_tenant_id()
                  AND t.tenant_id = public.current_tenant_id()
                  AND c.portal_user_id = auth.uid()
                  AND (
                      a.message_id IS NULL
                      OR EXISTS (
                          SELECT 1
                          FROM public.ticket_messages m
                          WHERE m.id = a.message_id
                            AND m.ticket_id = a.ticket_id
                            AND m.visibility = 'public'
                      )
                  )
            )
        )
    )
);

CREATE POLICY "ticket_attachments_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'ticket-attachments'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
    AND (
        (
            public.is_active_membership()
            AND public.current_tenant_role() IN (
                'tenant_admin',
                'manager',
                'agent'
            )
        )
        OR
        (
            -- Into a ticket the customer owns. Segment two is a ticket id,
            -- except under the staging prefix where it is the literal
            -- 'staging'; public.uuid_or_null returns null for that rather than
            -- raising, so a staged path is refused instead of erroring.
            public.current_tenant_role() = 'customer'
            AND EXISTS (
                SELECT 1
                FROM public.tickets t
                JOIN public.customers c
                    ON c.id = t.requester_customer_id
                WHERE t.id = public.uuid_or_null((storage.foldername(name))[2])
                  AND t.tenant_id = public.current_tenant_id()
                  AND c.portal_user_id = auth.uid()
            )
        )
    )
);

CREATE POLICY "ticket_attachments_update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
    bucket_id = 'ticket-attachments'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager',
        'agent'
    )
)
WITH CHECK (
    bucket_id = 'ticket-attachments'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager',
        'agent'
    )
);

CREATE POLICY "ticket_attachments_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
    bucket_id = 'ticket-attachments'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager'
    )
);
