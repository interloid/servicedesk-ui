import {
  Bell,
  BookOpen,
  Bookmark,
  Building2,
  ChartColumn,
  Clock,
  CreditCard,
  Database,
  Droplet,
  FileText,
  Mail,
  MessageSquare,
  Shield,
  Sparkles,
  Ticket,
  Users,
  type LucideIcon,
  Zap,
} from "lucide-react";
import { stripTenantPrefix } from "./tenancy";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavGroup = {
  title: string | null;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    title: null,
    items: [
      { label: "Ticket queue", href: "/tickets", icon: Ticket },
      { label: "Saved views", href: "/views", icon: Bookmark },
      { label: "Customers", href: "/customers", icon: Building2 },
      { label: "Knowledge base", href: "/kb", icon: BookOpen },
      { label: "Macros & templates", href: "/macros", icon: MessageSquare },
      { label: "SLA policies", href: "/settings/sla", icon: Clock },
      { label: "Reports", href: "/reports", icon: ChartColumn },
    ],
  },
  {
    title: "Settings",
    items: [
      { label: "Team & roles", href: "/settings/team", icon: Users },
      { label: "Branding", href: "/settings/branding", icon: Droplet },
      { label: "Channels & email", href: "/settings/channels", icon: Mail },
      {
        label: "Integrations & API",
        href: "/settings/integrations",
        icon: Zap,
      },

      { label: "Security & SSO", href: "/settings/security", icon: Shield },
      { label: "Data & privacy", href: "/settings/data", icon: Database },
      { label: "Notification center", href: "/notifications", icon: Bell },
      { label: "Audit log", href: "/settings/audit", icon: FileText },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "Billing overview", href: "/billing", icon: CreditCard },
      { label: "Plans & pricing", href: "/billing/plans", icon: Sparkles },
    ],
  },
];

export function findActiveNavItem(
  pathname: string,
): { group: NavGroup; item: NavItem } | null {
  const normalizedPathname = stripTenantPrefix(pathname)?.rest ?? pathname;

  let best: { group: NavGroup; item: NavItem } | null = null;

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const matches =
        normalizedPathname === item.href ||
        normalizedPathname.startsWith(`${item.href}/`);

      if (matches && (!best || item.href.length > best.item.href.length)) {
        best = { group, item };
      }
    }
  }

  return best;
}
