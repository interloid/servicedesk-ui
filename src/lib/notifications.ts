import { CreditCard, Inbox, Ticket, TriangleAlert, type LucideIcon } from "lucide-react";

/** Drives the icon tile's surface/ink pair, exactly as the design's `icoStyle` does. */
export type NotificationTone = "brand" | "error" | "warning" | "info";

export type Notification = {
  id: number;
  title: string;
  body: string;
  time: string;
  unread: boolean;
  tone: NotificationTone;
  icon: LucideIcon;
};

/**
 * Transcribed verbatim from `Update design.dc.html` → `const NOTIFS`, in source order.
 * Icons come from that file's `I` map, whose entries name the lucide component to use.
 *
 * Seed data, not a fixture: replace with the notifications API when it exists.
 */
export const NOTIFICATIONS: Notification[] = [
  {
    id: 1,
    title: "Ticket #4819 assigned to you",
    body: "Sam Okafor · Can't log in after SSO switch",
    time: "4 min ago",
    unread: true,
    tone: "brand",
    icon: Ticket,
  },
  {
    id: 2,
    title: "SLA breached — #4803",
    body: "First response target missed by 2h 05m",
    time: "26 min ago",
    unread: true,
    tone: "error",
    icon: TriangleAlert,
  },
  {
    id: 3,
    title: "Dana Whitfield replied",
    body: "Duplicate charge on invoice INV-2291",
    time: "1 hr ago",
    unread: true,
    tone: "info",
    icon: Inbox,
  },
  {
    id: 4,
    title: "Payment failed",
    body: "Visa ···4412 was declined for the July invoice",
    time: "Yesterday",
    unread: false,
    tone: "warning",
    icon: CreditCard,
  },
  {
    id: 5,
    title: "Tomás Rivera replied",
    body: "API returns 502 on /v2/exports",
    time: "Yesterday",
    unread: false,
    tone: "info",
    icon: Inbox,
  },
];

/**
 * The design's `icoStyle` special-cases only error and warning; brand and info share the
 * brand tint. Reproduced here so the mapping stays one lookup rather than nested ternaries.
 */
export const TONE_TILE: Record<NotificationTone, string> = {
  brand: "bg-accent text-accent-foreground",
  info: "bg-accent text-accent-foreground",
  error: "bg-destructive-soft text-destructive-strong",
  warning: "bg-warning-soft text-warning-strong",
};
