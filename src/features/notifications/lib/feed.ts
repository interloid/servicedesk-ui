import type {
  NotificationEventKey,
  NotificationFeedItem,
  NotificationFeedType,
  NotificationPrefs,
} from "@/features/notifications/types/notifications";

/** A `notifications` row as PostgREST and realtime both deliver it. */
export type NotificationRow = {
  id: string;
  type: string;
  payload_json: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

const TYPE_TO_FEED: Record<string, NotificationFeedType> = {
  ticket_assigned: "ticket",
  ticket_created: "ticket",
  ticket_updated: "ticket",
  ticket_closed: "ticket",
  ticket_reopened: "ticket",
  mention: "reply",
  sla_breach: "sla",
  sla_warning: "sla",
  billing: "payment",
  system: "system",
};

/**
 * Which preference row governs a notification type. Types without a row
 * (closures, billing, system notices) are always delivered.
 */
const TYPE_TO_PREF: Record<string, NotificationEventKey> = {
  ticket_assigned: "assigned",
  ticket_updated: "replies",
  sla_breach: "sla",
  sla_warning: "sla",
  mention: "mention",
  ticket_created: "created",
  ticket_reopened: "reopened",
};

const FALLBACK_TITLES: Record<string, string> = {
  ticket_assigned: "Ticket assigned to you",
  ticket_created: "New ticket",
  ticket_updated: "New reply",
  ticket_closed: "Ticket closed",
  ticket_reopened: "Ticket reopened",
  mention: "You were mentioned",
};

export function notificationPrefEvent(
  kind: string,
): NotificationEventKey | null {
  return TYPE_TO_PREF[kind] ?? null;
}

/** False when the user switched off in-app alerts for this kind of event. */
export function isShownInApp(
  item: NotificationFeedItem,
  prefs: NotificationPrefs | null,
): boolean {
  const event = notificationPrefEvent(item.kind);
  return !prefs || !event || prefs.in_app[event];
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const minutes = Math.max(0, Math.floor(diffMs / 60000));

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function toFeedItem(row: NotificationRow): NotificationFeedItem {
  const payload = row.payload_json ?? {};
  const number =
    typeof payload.ticket_number === "number" ? payload.ticket_number : null;
  const fallback = FALLBACK_TITLES[row.type];
  const title =
    (typeof payload.title === "string" && payload.title) ||
    (fallback && number !== null ? `${fallback} · #${number}` : fallback) ||
    row.type.replaceAll("_", " ");
  const subtitle =
    (typeof payload.body === "string" && payload.body) ||
    (typeof payload.subject === "string" ? payload.subject : "");

  return {
    id: row.id,
    type: TYPE_TO_FEED[row.type] ?? "system",
    kind: row.type,
    slaType: typeof payload.sla_type === "string" ? payload.sla_type : null,
    ticketId: typeof payload.ticket_id === "string" ? payload.ticket_id : null,
    title,
    subtitle,
    time: formatRelative(row.created_at),
    createdAt: row.created_at,
    unread: !row.read_at,
  };
}
