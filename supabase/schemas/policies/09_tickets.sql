-- =====================================================
-- File: 09_tickets_rls.sql
-- Description: Row Level Security Policies for Tickets
-- =====================================================

ALTER TABLE public.tickets
ENABLE ROW LEVEL SECURITY;


-- =====================================================
-- SELECT
-- =====================================================

CREATE POLICY "tickets_select"
ON public.tickets
FOR SELECT
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND (
        public.current_tenant_role() IN (
            'tenant_admin',
            'manager',
            'agent'
        )

        OR

        requester_customer_id = (
            SELECT c.id
            FROM public.customers c
            WHERE c.portal_user_id = auth.uid()
              AND c.tenant_id = public.tickets.tenant_id
        )
    )
);


-- =====================================================
-- INSERT
-- =====================================================

CREATE POLICY "tickets_insert"
ON public.tickets
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (
        public.current_tenant_role() IN (
            'tenant_admin',
            'manager',
            'agent'
        )

        OR

        requester_customer_id = (
            SELECT c.id
            FROM public.customers c
            WHERE c.portal_user_id = auth.uid()
              AND c.tenant_id = public.tickets.tenant_id
        )
    )
);


-- =====================================================
-- UPDATE
-- =====================================================

CREATE POLICY "tickets_update"
ON public.tickets
FOR UPDATE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND (
        public.current_tenant_role() IN (
            'tenant_admin',
            'manager',
            'agent'
        )

        OR

        requester_customer_id = (
            SELECT c.id
            FROM public.customers c
            WHERE c.portal_user_id = auth.uid()
              AND c.tenant_id = public.tickets.tenant_id
        )
    )
)
WITH CHECK (
    tenant_id = public.current_tenant_id()
);


-- =====================================================
-- DELETE
-- =====================================================

CREATE POLICY "tickets_delete"
ON public.tickets
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() = 'tenant_admin'
);