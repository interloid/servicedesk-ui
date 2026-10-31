export const NOTIFICATION_EVENT_KEYS = [
  "assigned",
  "replies",
  "sla",
  "mention",
  "created",
  "reopened",
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENT_KEYS)[number];

export const NOTIFICATION_CHANNEL_KEYS = ["email", "in_app"] as const;

export type NotificationChannelKey = (typeof NOTIFICATION_CHANNEL_KEYS)[number];

export interface NotificationPrefs {
  email: Record<NotificationEventKey, boolean>;
  in_app: Record<NotificationEventKey, boolean>;
}

export function defaultNotificationPrefs(): NotificationPrefs {
  return {
    // "New tickets" reaches admins and managers on every ticket, so its email
    // is opt-in. queue_notification_email applies the same defaults.
    email: {
      assigned: true,
      replies: true,
      sla: true,
      mention: true,
      created: false,
      reopened: true,
    },
    in_app: {
      assigned: true,
      replies: true,
      sla: true,
      mention: true,
      created: true,
      reopened: true,
    },
  };
}

export type NotificationFeedType =
  "ticket" | "sla" | "reply" | "payment" | "system";

export interface NotificationFeedItem {
  id: string;
  type: NotificationFeedType;
  /** The raw `notification_type`, e.g. `sla_breach` vs `sla_warning`. */
  kind: string;
  /** `first_response` or `resolution` on SLA notices, otherwise null. */
  slaType: string | null;
  ticketId: string | null;
  title: string;
  subtitle: string;
  time: string;
  createdAt: string;
  unread: boolean;
}

/** One saved change to the preferences, read back from audit_logs. */
export interface NotificationPrefsChange {
  id: string;
  channel: NotificationChannelKey;
  event: NotificationEventKey;
  enabled: boolean;
  time: string;
  createdAt: string;
}

export const NOTIFICATION_FAILURE_CODE_VALUES = [
  "validation",
  "action-not-allowed",
  "not-found",
  "unknown",
] as const;

export type NotificationFailureCode =
  (typeof NOTIFICATION_FAILURE_CODE_VALUES)[number];

export interface NotificationActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  failureCode?: NotificationFailureCode;
  message?: string;
}

export interface NotificationsData {
  prefs: NotificationPrefs;
  notifications: NotificationFeedItem[];
  history: NotificationPrefsChange[];
}
