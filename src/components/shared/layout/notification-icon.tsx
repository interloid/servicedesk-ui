"use client";

import { LucideProps } from "lucide-react";
import {
  MessageSquare,
  UserPlus,
  FilePlus,
  CheckCircle2,
  AtSign,
  CreditCard,
  Settings,
  Inbox,
} from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<LucideProps>> = {
  "message-square": MessageSquare,
  "user-plus": UserPlus,
  "file-plus": FilePlus,
  "check-circle-2": CheckCircle2,
  "at-sign": AtSign,
  "credit-card": CreditCard,
  settings: Settings,
  inbox: Inbox,
};

export function NotificationIcon({
  name,
  ...props
}: { name: string } & LucideProps) {
  const Icon = ICON_MAP[name] || Inbox;
  return <Icon {...props} />;
}
