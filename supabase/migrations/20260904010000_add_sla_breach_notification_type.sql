-- Add the `sla_breach` notification type so the app can notify a ticket's
-- assignee the moment one of its SLA events is marked as breached.
--
-- Postgres ALTER TABLE ... ADD VALUE cannot run inside a transaction block and
-- cannot be added twice, so we guard with a DO block that only adds it if the
-- value is not already present.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'sla_breach'
      AND enumtypid = (
        SELECT oid FROM pg_type
        WHERE typname = 'notification_type'
      )
  ) THEN
    ALTER TYPE public.notification_type ADD VALUE 'sla_breach';
  END IF;
END $$;
