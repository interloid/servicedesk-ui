-- =====================================================
-- File: 20_timezones.sql
-- Description: RLS Policies for Timezones
-- =====================================================

ALTER TABLE public.timezones
ENABLE ROW LEVEL SECURITY;


-- Public read access
-- Required for signup/onboarding before authentication
CREATE POLICY "timezones_select"
ON public.timezones
FOR SELECT
TO anon, authenticated
USING (true);