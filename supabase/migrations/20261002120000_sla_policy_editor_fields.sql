-- =====================================================
-- SLA policy editor fields
-- =====================================================
--
-- The redesigned SLA screens show a description per policy and "Updated at …
-- by …" in the list. The editor also already reads and writes
-- notify_before_mins and escalate_to_role, which no migration in this repo
-- created. IF NOT EXISTS throughout, so this is safe on a database where
-- those two were added by hand.
--
-- Mirrors supabase/schemas/tables/09_sla_policies.sql.

ALTER TABLE public.sla_policies
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS notify_before_mins integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS escalate_to_role text NOT NULL DEFAULT 'manager',
  ADD COLUMN IF NOT EXISTS updated_by uuid
    REFERENCES public.users(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_sla_description_length'
  ) THEN
    ALTER TABLE public.sla_policies
      ADD CONSTRAINT chk_sla_description_length
      CHECK (char_length(description) <= 500);
  END IF;

  -- A warning more than a day ahead is not a warning.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_sla_notify_before_mins'
  ) THEN
    ALTER TABLE public.sla_policies
      ADD CONSTRAINT chk_sla_notify_before_mins
      CHECK (notify_before_mins BETWEEN 1 AND 1440);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_sla_escalate_to_role'
  ) THEN
    ALTER TABLE public.sla_policies
      ADD CONSTRAINT chk_sla_escalate_to_role
      CHECK (escalate_to_role IN ('manager', 'tenant_admin'));
  END IF;
END $$;
