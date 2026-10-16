-- =====================================================
-- SLA notification types
-- =====================================================
--
-- `sla_warning` is the "notify before breach" heads-up the SLA engine sends.
-- `sla_breach` already exists: 20260904010000_add_sla_breach_notification_type.sql
-- added it, so it is not added a second time here.
--
-- In its own migration because a value added by ALTER TYPE ... ADD VALUE can't
-- be used until the transaction that added it commits, and the SLA engine
-- migration that follows (20261009140000_ticket_sla_engine.sql) writes both.
--
-- Dated after 20261009120000_sla_target_units.sql (it was 20261008110000) so
-- it runs after the live database's last applied migration, in the same
-- order on a fresh reset as on deploy.

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'sla_warning';
