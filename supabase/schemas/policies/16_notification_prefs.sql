ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;

-- SELECT
CREATE POLICY "Members can view tenant Notification preference"
ON public.notification_prefs
FOR SELECT
TO authenticated
USING (
    tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND public.is_active_membership()
);

-- INSERT
CREATE POLICY "Members can create tenant Notification preference"
ON public.notification_prefs
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND public.is_active_membership()
);

-- UPDATE
CREATE POLICY "Members can update tenant Notification preference"
ON public.notification_prefs
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
CREATE POLICY "Members can delete tenant Notification preference"
ON public.notification_prefs
FOR DELETE
TO authenticated
USING (
    tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND public.is_active_membership()
);