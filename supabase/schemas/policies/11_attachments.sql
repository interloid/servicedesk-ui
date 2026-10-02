ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- SELECT
-- ------------------------------------------------------------
--
-- Two changes from the tenant-wide policy this replaces, both because customers
-- are now members:
--
--   * staff keep the whole tenant, customers get only their own tickets;
--   * and owning the ticket is not on its own enough. An attachment hangs off
--     `message_id`, and a message can be internal -- agents attach screenshots,
--     logs and other customers' data to notes the requester must never see. So
--     the customer branch also requires the file to sit on a public message, or
--     on no message at all, which is where a request's opening files live (that
--     post is `tickets.description`, not a ticket_messages row).
--
-- policies/storage/ticket_attachments.sql carries the same clause, so the row
-- being readable and the object being downloadable agree.

CREATE POLICY "Members can view tenant Attachments"
ON public.attachments
FOR SELECT
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND (
        (
            public.is_active_membership()
            AND public.current_tenant_role() IN (
                'tenant_admin',
                'manager',
                'agent',
                'billing_admin'
            )
        )

        OR

        (
            public.current_tenant_role() = 'customer'
            AND EXISTS (
                SELECT 1
                FROM public.tickets t
                JOIN public.customers c
                    ON c.id = t.requester_customer_id
                WHERE t.id = public.attachments.ticket_id
                  AND t.tenant_id = public.current_tenant_id()
                  AND c.portal_user_id = auth.uid()
            )
            AND (
                public.attachments.message_id IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM public.ticket_messages m
                    WHERE m.id = public.attachments.message_id
                      AND m.visibility = 'public'
                )
            )
        )
    )
);

-- INSERT
CREATE POLICY "Members can create tenant Attachments"
ON public.attachments
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (
        (
            public.is_active_membership()
            AND public.current_tenant_role() IN (
                'tenant_admin',
                'manager',
                'agent',
                'billing_admin'
            )
        )

        OR

        (
            public.current_tenant_role() = 'customer'
            AND EXISTS (
                SELECT 1
                FROM public.tickets t
                JOIN public.customers c
                    ON c.id = t.requester_customer_id
                WHERE t.id = public.attachments.ticket_id
                  AND t.tenant_id = public.current_tenant_id()
                  AND c.portal_user_id = auth.uid()
            )
            AND (
                public.attachments.message_id IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM public.ticket_messages m
                    WHERE m.id = public.attachments.message_id
                      AND m.visibility = 'public'
                )
            )
            -- Their own upload, not one attributed to somebody else: without
            -- this a customer can claim an agent's file as theirs.
            AND public.attachments.uploaded_by = auth.uid()
        )
    )
);

-- UPDATE
--
-- Staff only: the four roles that, before customers held memberships, made up
-- "every active member" -- so staff rights are unchanged. A customer branch
-- would let them PATCH storage_path on their own ticket's attachment to point at
-- another customer's file, which the portal then signs with the admin client.
-- The portal never edits these rows with a customer session.

CREATE POLICY "Members can update tenant Attachments"
ON public.attachments
FOR UPDATE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager',
        'agent',
        'billing_admin'
    )
)
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager',
        'agent',
        'billing_admin'
    )
);

-- DELETE
--
-- Staff only, same four roles as before (an agent can still remove a
-- mis-uploaded screenshot of their own). Customers never delete these rows.

CREATE POLICY "Members can delete tenant Attachments"
ON public.attachments
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager',
        'agent',
        'billing_admin'
    )
);
