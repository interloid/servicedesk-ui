export type NotificationType =
  | "ticket_assigned"
  | "ticket_created"
  | "ticket_updated"
  | "ticket_closed"
  | "mention"
  | "sla_breach"
  | "billing"
  | "system";

export type NotificationPayload = {
  title?: string;
  body?: string;
  ticket_id?: string;
  ticket_number?: number;
  subject?: string;
  sender_name?: string;
  [key: string]: unknown;
};

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

const TYPE_META: Record<
  NotificationType,
  { tone: UiNotification["tone"]; icon: string; fallbackTitle: string }
> = {
  ticket_assigned: {
    tone: "info",
    icon: "user-plus",
    fallbackTitle: "Ticket assigned to you",
  },
  ticket_created: {
    tone: "brand",
    icon: "file-plus",
    fallbackTitle: "New ticket",
  },
  ticket_updated: {
    tone: "info",
    icon: "message-square",
    fallbackTitle: "Ticket updated",
  },
  ticket_closed: {
    tone: "info",
    icon: "check-circle-2",
    fallbackTitle: "Ticket closed",
  },
  mention: {
    tone: "brand",
    icon: "at-sign",
    fallbackTitle: "You were mentioned",
  },
  sla_breach: {
    tone: "error",
    icon: "alert-triangle",
    fallbackTitle: "SLA breached",
  },
  billing: {
    tone: "warning",
    icon: "credit-card",
    fallbackTitle: "Billing update",
  },
  system: {
    tone: "info",
    icon: "settings",
    fallbackTitle: "System update",
  },
};

function resolveTitle(type: NotificationType, payload: NotificationPayload) {
  if (payload.title) return payload.title;
  if (type === "sla_breach" && payload.subject)
    return `SLA breached: ${payload.subject}`;
  if (
    (type === "ticket_updated" || type === "mention") &&
    payload.sender_name
  )
    return `New message from ${payload.sender_name}`;
  return TYPE_META[type].fallbackTitle;
}

function resolveBody(payload: NotificationPayload) {
  if (payload.body) return payload.body;
  if (payload.subject) return `Re: ${payload.subject}`;
  return "";
}

/**
 * Convert a raw notifications table row into a UiNotification. Safe to use on
 * both the server and the client (e.g. when a realtime INSERT arrives).
 */
export function toUiNotification(row: {
  id: string;
  type: NotificationType;
  payload_json: unknown;
  read_at: string | null;
  created_at: string;
}): UiNotification {
  const payload = (row.payload_json || {}) as NotificationPayload;
  const meta = TYPE_META[row.type] || TYPE_META.system;
  return {
    id: row.id,
    type: row.type,
    title: resolveTitle(row.type, payload),
    body: resolveBody(payload),
    time: row.created_at,
    unread: !row.read_at,
    tone: meta.tone,
    icon: meta.icon,
    payload,
  };
}
