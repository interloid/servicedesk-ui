import {
  CircleAlert,
  Download,
  LogIn,
  LogOut,
  MailPlus,
  SquarePen,
  SquarePlus,
  Trash2,
  UserCheck,
  UserCog,
  type LucideIcon,
} from "lucide-react";

import type { AuditAction } from "@/features/audit/types/audit";

export const AUDIT_ACTION_ICONS: Record<AuditAction, LucideIcon> = {
  create: SquarePlus,
  update: SquarePen,
  delete: Trash2,
  invite: MailPlus,
  role_change: UserCog,
  assign: UserCheck,
  login: LogIn,
  logout: LogOut,
  login_failed: CircleAlert,
  export: Download,
};
