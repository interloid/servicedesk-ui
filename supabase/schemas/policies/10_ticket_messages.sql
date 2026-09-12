-- =====================================================
-- File: ticket_messages.sql
-- Description: RLS Policies for Ticket Messages
-- =====================================================


-- =====================================================
-- ENABLE RLS
-- =====================================================

ALTER TABLE public.ticket_messages
ENABLE ROW LEVEL SECURITY;


-- =====================================================
-- SELECT
--
-- Tenant staff:
--   tenant_admin
--   manager
--   agent
--
-- can read public + internal messages.
--
-- Customers:
--   Can only read public messages
--   from their own tickets.
--
-- Platform Admin:
--   No ticket-message access based on the
--   current capability matrix.
--
-- Billing Admin:
--   No ticket-message access.
-- =====================================================

CREATE POLICY "ticket_messages_select"
ON public.ticket_messages
FOR SELECT
TO authenticated
USING (
    tenant_id = public.current_tenant_id()

    AND (
        -- ---------------------------------------------
        -- Tenant staff
        -- ---------------------------------------------
        public.current_tenant_role() IN (
            'tenant_admin',
            'manager',
            'agent'
        )

        OR

        -- ---------------------------------------------
        -- Customer portal
        -- ---------------------------------------------
        (
            public.current_tenant_role() = 'customer'
            AND visibility = 'public'

            AND EXISTS (
                SELECT 1
                FROM public.tickets AS t
                INNER JOIN public.customers AS c
                    ON c.id = t.requester_customer_id
                WHERE t.id = ticket_messages.ticket_id
                  AND t.tenant_id = public.current_tenant_id()
                  AND c.portal_user_id = auth.uid()
                  AND c.tenant_id = public.current_tenant_id()
            )
        )
    )
);


-- =====================================================
-- INSERT
--
-- Tenant staff can create agent messages.
--
-- Customer can create only:
--   - messages on their own ticket
--   - author_type = customer
--   - author_id = their customer record
--   - visibility = public
--
-- Customers cannot create internal messages.
-- =====================================================

CREATE POLICY "ticket_messages_insert"
ON public.ticket_messages
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = public.current_tenant_id()

    AND (
        -- ---------------------------------------------
        -- Staff
        -- ---------------------------------------------
        (
            public.current_tenant_role() IN (
                'tenant_admin',
                'manager',
                'agent'
            )

            AND author_type = 'agent'
            AND author_id = auth.uid()
        )

        OR

        -- ---------------------------------------------
        -- Customer
        -- ---------------------------------------------
        (
            public.current_tenant_role() = 'customer'

            AND author_type = 'customer'
            AND visibility = 'public'

            AND EXISTS (
                SELECT 1
                FROM public.customers AS c
                INNER JOIN public.tickets AS t
                    ON t.requester_customer_id = c.id
                WHERE c.id = ticket_messages.author_id
                  AND c.portal_user_id = auth.uid()
                  AND c.tenant_id = public.current_tenant_id()

                  AND t.id = ticket_messages.ticket_id
                  AND t.tenant_id = public.current_tenant_id()
            )
        )
    )
);


-- =====================================================
-- UPDATE
--
-- Tenant Admin / Manager:
--   Can update messages within their tenant.
--
-- Agent:
--   Can update their own messages.
--
-- Customer:
--   Can update their own public messages.
--
-- Platform Admin / Billing Admin:
--   No access.
-- =====================================================

CREATE POLICY "ticket_messages_update"
ON public.ticket_messages
FOR UPDATE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()

    AND (
        -- ---------------------------------------------
        -- Tenant Admin / Manager
        -- ---------------------------------------------
        public.current_tenant_role() IN (
            'tenant_admin',
            'manager'
        )

        OR

        -- ---------------------------------------------
        -- Agent can update own message
        -- ---------------------------------------------
        (
            public.current_tenant_role() = 'agent'
            AND author_type = 'agent'
            AND author_id = auth.uid()
        )

        OR

        -- ---------------------------------------------
        -- Customer can update own public message
        -- ---------------------------------------------
        (
            public.current_tenant_role() = 'customer'
            AND author_type = 'customer'
            AND visibility = 'public'

            AND EXISTS (
                SELECT 1
                FROM public.customers AS c
                WHERE c.id = ticket_messages.author_id
                  AND c.portal_user_id = auth.uid()
                  AND c.tenant_id = public.current_tenant_id()
            )
        )
    )
)
WITH CHECK (
    tenant_id = public.current_tenant_id()

    AND (
        -- ---------------------------------------------
        -- Tenant Admin / Manager
        -- ---------------------------------------------
        public.current_tenant_role() IN (
            'tenant_admin',
            'manager'
        )

        OR

        -- ---------------------------------------------
        -- Agent
        -- ---------------------------------------------
        (
            public.current_tenant_role() = 'agent'
            AND author_type = 'agent'
            AND author_id = auth.uid()
        )

        OR

        -- ---------------------------------------------
        -- Customer
        -- ---------------------------------------------
        (
            public.current_tenant_role() = 'customer'
            AND author_type = 'customer'
            AND visibility = 'public'

            AND EXISTS (
                SELECT 1
                FROM public.customers AS c
                WHERE c.id = ticket_messages.author_id
                  AND c.portal_user_id = auth.uid()
                  AND c.tenant_id = public.current_tenant_id()
            )
        )
    )
);


-- =====================================================
-- DELETE
--
-- Tenant Admin / Manager can delete messages.
--
-- Agent / Customer cannot delete messages.
-- =====================================================

CREATE POLICY "ticket_messages_delete"
ON public.ticket_messages
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()

    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager'
    )
);