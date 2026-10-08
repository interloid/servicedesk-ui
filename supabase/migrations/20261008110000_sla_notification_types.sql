-- =====================================================
-- SLA notification types
-- =====================================================
--
-- `sla_breach` is already used by the app (notifications-shared.ts) and exists
-- on the live database, but no migration in this repo created it. `sla_warning`
-- is new: the "notify before breach" heads-up the SLA engine sends.
--
-- In its own migration because a value added by ALTER TYPE ... ADD VALUE can't
-- be used until the transaction that added it commits, and the SLA engine
-- migration that follows writes both.

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'sla_breach';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'sla_warning';
