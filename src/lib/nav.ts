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

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavGroup = {
  /** `null` renders the group with no SidebarGroupLabel, as the design does. */
  title: string | null;
  items: NavItem[];
};

/**
 * Transcribed from `Update design.dc.html` → `ROUTES` (every entry with `nav:true`),
 * in source order, split by its `section` field exactly as `navGroups` does there:
 * untitled group first, then "Settings", then "Account".
 *
 * Icons come from that file's `I` map, whose every entry carries a trailing comment
 * naming the lucide-react component the port should use — so these are the design's
 * own choices, not guesses. Hrefs match `react/lib/nav.ts` in the same project.
 *
 * The design gates each route on a role (`roles:` in ROUTES). There is no session
 * yet, so the shell renders every item; role filtering belongs with auth.
 */
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
      { label: "Integrations & API", href: "/settings/integrations", icon: Zap },
      // TODO: confirm icon — `I.shield` is commented "// Shield" in the .dc.html and its
      // path is lucide's plain Shield, but the design's own React port (react/lib/nav.ts)
      // imports ShieldCheck for this row. Following the .dc.html, which is canonical.
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

/**
 * Longest-prefix match, so `/billing/plans` resolves to "Plans & pricing" rather than
 * to "Billing overview", which is also a prefix of it.
 */
export function findActiveNavItem(pathname: string): { group: NavGroup; item: NavItem } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;

  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const matches = pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (matches && (!best || item.href.length > best.item.href.length)) {
        best = { group, item };
      }
    }
  }

  return best;
}
