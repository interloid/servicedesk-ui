-- =====================================================
-- File: 03_users.sql
-- Description: RLS Policies for Users
-- =====================================================

ALTER TABLE public.users
ENABLE ROW LEVEL SECURITY;


-- =====================================================
-- SELECT
-- Users can view:
-- 1. Their own profile
-- 2. Users belonging to the current tenant
--    (any membership status — the team screen renders
--    invited and disabled members too, so their names
--    and emails must be visible to their tenant)
-- =====================================================

CREATE POLICY "users_select"
ON public.users
FOR SELECT
TO authenticated
USING (
    id = auth.uid()

    OR EXISTS (
        SELECT 1
        FROM public.memberships m
        WHERE m.user_id = public.users.id
          AND m.tenant_id = public.current_tenant_id()
    )
);


-- =====================================================
-- INSERT
-- Users can create their own profile
-- =====================================================

CREATE POLICY "users_insert"
ON public.users
FOR INSERT
TO authenticated
WITH CHECK (
    id = auth.uid()
);


-- =====================================================
-- UPDATE
-- Users can update their own profile
-- Tenant Admin can update users in current tenant
-- =====================================================

CREATE POLICY "users_update"
ON public.users
FOR UPDATE
TO authenticated
USING (
    id = auth.uid()

    OR (
        public.current_tenant_role() = 'tenant_admin'
        AND public.is_active_membership()
        AND EXISTS (
            SELECT 1
            FROM public.memberships m
            WHERE m.user_id = public.users.id
              AND m.tenant_id = public.current_tenant_id()
              AND m.status = 'active'
        )
    )
)
WITH CHECK (
    id = auth.uid()

    OR (
        public.current_tenant_role() = 'tenant_admin'
        AND public.is_active_membership()
        AND EXISTS (
            SELECT 1
            FROM public.memberships m
            WHERE m.user_id = public.users.id
              AND m.tenant_id = public.current_tenant_id()
              AND m.status = 'active'
        )
    )
);


-- =====================================================
-- DELETE
-- Only Tenant Admin can delete users
-- belonging to the current tenant
-- =====================================================

CREATE POLICY "users_delete"
ON public.users
FOR DELETE
TO authenticated
USING (
    public.current_tenant_role() = 'tenant_admin'
    AND public.is_active_membership()
    AND EXISTS (
        SELECT 1
        FROM public.memberships m
        WHERE m.user_id = public.users.id
          AND m.tenant_id = public.current_tenant_id()
          AND m.status = 'active'
    )
);