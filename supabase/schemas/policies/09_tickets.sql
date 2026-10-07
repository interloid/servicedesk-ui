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
--
-- Staff only, for the same reason as UPDATE below. Customers raise requests
-- through portal_create_request (service role), which sets status, priority,
-- assignee and SLA itself. A customer branch here let a signed-in customer POST a
-- ticket with any status, assignee_user_id or first_response_at -- e.g. born
-- 'resolved' against an agent of their choosing, which earns a CSAT slot they
-- can then score, with no agent involved.

CREATE POLICY "tickets_insert"
ON public.tickets
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager',
        'agent'
    )
);


-- =====================================================
-- UPDATE
-- =====================================================
--
-- Staff only. A customer has no legitimate write to a ticket row: they raise
-- requests through portal_create_request, they post messages, and the two
-- status transitions they can cause -- a reply putting the ball back in the
-- team's court, and reopening -- go through portal_reply_bumps_status and
-- portal_reopen_ticket (functions/15_portal.sql), which write exactly the
-- columns those transitions need.
--
-- The customer branch that used to be here tested only `tenant_id` in WITH
-- CHECK, so PATCH /rest/v1/tickets could set priority, assignee_user_id,
-- status, sla_policy_id or first_response_at, or move requester_customer_id to
-- another customer and read their portal. A policy can narrow the rows a
-- caller reaches; it cannot narrow the columns it reaches inside them, so
-- nothing short of removing the branch would do.

CREATE POLICY "tickets_update"
ON public.tickets
FOR UPDATE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager',
        'agent'
    )
)
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager',
        'agent'
    )
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