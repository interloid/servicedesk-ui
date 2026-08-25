import { LucideIcon } from "lucide-react";

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
