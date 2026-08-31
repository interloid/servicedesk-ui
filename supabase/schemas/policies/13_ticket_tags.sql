-- =====================================================
-- File: 13_ticket_tags.sql
-- Description: RLS Policies for Ticket Tags
-- =====================================================


-- =====================================================
-- ENABLE RLS
-- =====================================================

ALTER TABLE public.ticket_tags
ENABLE ROW LEVEL SECURITY;


-- =====================================================
-- SELECT
--
-- Tenant Admin / Manager / Agent can view
-- ticket-tag relationships within their tenant.
-- =====================================================

CREATE POLICY "ticket_tags_select"
ON public.ticket_tags
FOR SELECT
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager',
        'agent'
    )
);


-- =====================================================
-- INSERT
--
-- Tenant Admin / Manager / Agent can assign
-- existing tags to tickets.
-- =====================================================

CREATE POLICY "ticket_tags_insert"
ON public.ticket_tags
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
-- DELETE
--
-- Tenant Admin / Manager / Agent can remove
-- tags from tickets.
-- =====================================================

CREATE POLICY "ticket_tags_delete"
ON public.ticket_tags
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager',
        'agent'
    )
);