-- =====================================================
-- File: rls_sla_events.sql
-- =====================================================
--
-- Only the SLA engine writes sla_events: the SECURITY DEFINER triggers and
-- sla_tick() (functions/17_sla_engine.sql, triggers/tickets_sla.sql) and the
-- service role. Staff read them; portal customers get nothing, over REST or
-- realtime. Migration: 20261012120000_ticket_review_hardening.sql.

ALTER TABLE public.sla_events
ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view tenant SLA events" ON public.sla_events;
DROP POLICY IF EXISTS "Members can create tenant SLA events" ON public.sla_events;
DROP POLICY IF EXISTS "Members can update tenant SLA events" ON public.sla_events;
DROP POLICY IF EXISTS "Members can delete tenant SLA events" ON public.sla_events;
DROP POLICY IF EXISTS "Staff can view tenant SLA events" ON public.sla_events;

-- SELECT: staff of the tenant
CREATE POLICY "Staff can view tenant SLA events"
ON public.sla_events
FOR SELECT
TO authenticated
USING (
    tenant_id = public.current_tenant_id()
    AND public.current_tenant_role() IN ('tenant_admin', 'manager', 'agent')
    AND public.is_active_membership()
);

-- No INSERT / UPDATE / DELETE policies: nobody writes through the API.
