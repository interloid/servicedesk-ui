-- =====================================================
-- File: rls_sla_events.sql
-- =====================================================

ALTER TABLE public.sla_events
ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view tenant SLA events" ON public.sla_events;
DROP POLICY IF EXISTS "Members can create tenant SLA events" ON public.sla_events;
DROP POLICY IF EXISTS "Members can update tenant SLA events" ON public.sla_events;
DROP POLICY IF EXISTS "Members can delete tenant SLA events" ON public.sla_events;

-- SELECT
CREATE POLICY "Members can view tenant SLA events"
ON public.sla_events
FOR SELECT
TO authenticated
USING (
    tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND public.is_active_membership()
);

-- INSERT
CREATE POLICY "Members can create tenant SLA events"
ON public.sla_events
FOR INSERT
TO authenticated
WITH CHECK (
    tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND public.is_active_membership()
);

-- UPDATE
CREATE POLICY "Members can update tenant SLA events"
ON public.sla_events
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
CREATE POLICY "Members can delete tenant SLA events"
ON public.sla_events
FOR DELETE
TO authenticated
USING (
    tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND public.is_active_membership()
);