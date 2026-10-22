import type { Database } from "@/lib/supabase/database.types";

export type NotificationType = Database["public"]["Enums"]["notification_type"];

export type NotificationPayload = {
  title?: string;
  body?: string;
  ticket_id?: string;
  ticket_number?: number;
  subject?: string;
  sender_name?: string;
  [key: string]: unknown;
};

// Kept only for the type re-export in src/lib/notifications.service.ts; the
// feed's real titles and icons live in src/features/notifications/lib/feed.ts.
export type UiNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  time: string;
  unread: boolean;
  tone: "brand" | "error" | "warning" | "info";
  icon: string;
  payload: NotificationPayload;
};
