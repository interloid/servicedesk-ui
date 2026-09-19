-- =====================================================
-- File: 01_plans.sql
-- Description: RLS Policies for Plans
-- =====================================================

ALTER TABLE public.plans
ENABLE ROW LEVEL SECURITY;


-- =====================================================
-- SELECT
-- Plans are public reference data.
-- Required for pricing/signup before authentication.
-- =====================================================

CREATE POLICY "plans_select"
ON public.plans
FOR SELECT
TO anon, authenticated
USING (true);