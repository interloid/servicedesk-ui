ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- SELECT
DROP POLICY IF EXISTS "Members can view tenant Notifications" ON public.notifications;
CREATE POLICY "Members can view own Notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (
    user_id = (select auth.uid())
    AND tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND public.is_active_membership()
);

-- INSERT
CREATE POLICY "Members can create tenant Notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND public.is_active_membership()
);

-- UPDATE
CREATE POLICY "Members can update tenant Notifications"
ON public.notifications
FOR UPDATE
TO authenticated
USING (
    tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND public.is_active_membership()
)
WITH CHECK (
    tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND public.is_active_membership()
);

-- DELETE
CREATE POLICY "Members can delete tenant Notifications"
ON public.notifications
FOR DELETE
TO authenticated
USING (
    tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND public.is_active_membership()
);