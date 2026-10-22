-- ==========================================================
-- File: notifications_email.sql
-- Description: Email a notification when the recipient asked for it
-- ==========================================================

-- See functions/24_notification_emails.sql.
CREATE OR REPLACE TRIGGER queue_notification_email
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.queue_notification_email();
