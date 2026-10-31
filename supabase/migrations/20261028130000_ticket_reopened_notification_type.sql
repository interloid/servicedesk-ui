-- =====================================================
-- ticket_reopened notification type
-- =====================================================
--
-- Sent when a resolved or closed ticket is reopened (see
-- 20261028140000_ticket_reopened_notifications.sql).
--
-- In its own migration because a value added by ALTER TYPE ... ADD VALUE can't
-- be used until the transaction that added it commits.
--
-- Mirrors supabase/schemas/types/00_types.sql.

ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'ticket_reopened';
