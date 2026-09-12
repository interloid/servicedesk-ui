-- =====================================================
-- File: 12_tags.sql
-- Description: RLS Policies for Tags
-- =====================================================


-- =====================================================
-- ENABLE RLS
-- =====================================================

ALTER TABLE public.tags
ENABLE ROW LEVEL SECURITY;


-- =====================================================
-- SELECT
--
-- Tenant Admin / Manager / Agent can view tags
-- belonging to their tenant.
-- =====================================================

CREATE POLICY "tags_select"
ON public.tags
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
-- Only Tenant Admin and Manager can create tags.
-- =====================================================

CREATE POLICY "tags_insert"
ON public.tags
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager'
    )
);


-- =====================================================
-- UPDATE
--
-- Only Tenant Admin and Manager can update tags.
-- =====================================================

CREATE POLICY "tags_update"
ON public.tags
FOR UPDATE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager'
    )
)
WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager'
    )
);


-- =====================================================
-- DELETE
--
-- Only Tenant Admin and Manager can delete tags.
-- =====================================================

CREATE POLICY "tags_delete"
ON public.tags
FOR DELETE
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN (
        'tenant_admin',
        'manager'
    )
);