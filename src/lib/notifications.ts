import { Notification, NotificationTone } from "@/types/notification";

/**
 * Empty until notifications are backed by real data.
 *
 * This previously held five invented notifications, including a fabricated
 * "Payment failed — Visa ···4412 was declined" line that real customers saw and
 * reasonably read as a genuine billing failure.
 */
export const NOTIFICATIONS: Notification[] = [];

export const TONE_TILE: Record<NotificationTone, string> = {
  brand: "bg-accent text-accent-foreground",
  info: "bg-accent text-accent-foreground",
  error: "bg-destructive-soft text-destructive-strong",
  warning: "bg-warning-soft text-warning-strong",
};
