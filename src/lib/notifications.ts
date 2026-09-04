import { NotificationTone } from "@/types/notification";

export const TONE_TILE: Record<NotificationTone, string> = {
  brand: "bg-accent text-accent-foreground",
  info: "bg-accent text-accent-foreground",
  error: "bg-destructive-soft text-destructive-strong",
  warning: "bg-warning-soft text-warning-strong",
};
