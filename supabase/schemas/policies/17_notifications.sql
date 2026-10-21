-- =====================================================
-- File: 17_notifications.sql
-- =====================================================
--
-- A notification is its recipient's alone: it can carry ticket subjects and
-- message previews. Rows are inserted by the service role (createNotification)
-- and the SECURITY DEFINER sla_tick(), so there is no INSERT policy.
-- Migrations: 20260903090000_enable_realtime.sql (SELECT) and
-- 20261012120000_ticket_review_hardening.sql (the rest).

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- SELECT
CREATE POLICY "Members can view own Notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
);

-- UPDATE (mark read)
CREATE POLICY "Members can update own Notifications"
ON public.notifications
FOR UPDATE
TO authenticated
USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
)
WITH CHECK (
    user_id = (SELECT auth.uid())
    AND tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
);

-- DELETE
CREATE POLICY "Members can delete own Notifications"
ON public.notifications
FOR DELETE
TO authenticated
USING (
    user_id = (SELECT auth.uid())
    AND tenant_id = public.current_tenant_id()
    AND public.is_active_membership()
);
