"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import {
  Ticket,
  Bookmark,
  Building2,
  BookOpen,
  MessageSquareText,
  Clock,
  BarChart2,
  Users,
  Droplet,
  Mail,
  Zap,
  Shield,
  Database,
  Bell,
  FileText,
  CreditCard,
  Sparkles,
  ChevronDown,
  PanelLeft,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  SidebarFooter,
} from "@/components/ui/sidebar";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { stripTenantPrefix, tenantPath } from "@/lib/tenancy";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MembershipRole } from "@/types/team-members";
import { ShellIdentity } from "@/types/shell-identity";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  roles: MembershipRole[];
}

interface NavSection {
  title: string | null;
  items: NavItem[];
}

export function AppSidebar({ identity }: { identity: ShellIdentity | null }) {
  const pathname = usePathname();
  const params = useParams();

  const userRole = (identity?.user.role as MembershipRole) ?? "customer";

  const tenantSlug =
    (params?.tenantSlug as string | undefined) ??
    identity?.org.name ??
    stripTenantPrefix(pathname)?.slug ??
    "";

  const navSections: NavSection[] = [
    {
      title: null,
      items: [
        {
          label: "Ticket queue",
          href: "/tickets",
          icon: Ticket,
          roles: ["tenant_admin", "manager", "agent"],
        },
        {
          label: "Saved views",
          href: "/views",
          icon: Bookmark,
          roles: ["tenant_admin", "manager", "agent"],
        },
        {
          label: "Customers",
          href: "/customers",
          icon: Building2,
          roles: ["tenant_admin", "manager", "agent"],
        },
        {
          label: "Knowledge base",
          href: "/kb",
          icon: BookOpen,
          roles: ["tenant_admin", "manager", "agent"],
        },
        {
          label: "Macros & templates",
          href: "/macros",
          icon: MessageSquareText,
          roles: ["tenant_admin", "manager", "agent"],
        },
        {
          label: "SLA policies",
          href: "/sla",
          icon: Clock,
          roles: ["tenant_admin", "manager", "agent"],
        },
        {
          label: "Reports",
          href: "/reports",
          icon: BarChart2,
          roles: ["tenant_admin", "manager"],
        },
      ],
    },

    {
      title: "SETTINGS",
      items: [
        {
          label: "Team & roles",
          href: "/settings/team",
          icon: Users,
          roles: ["tenant_admin", "manager"],
        },
        {
          label: "Branding",
          href: "/settings/branding",
          icon: Droplet,
          roles: ["tenant_admin", "manager"],
        },
        {
          label: "Channels & email",
          href: "/settings/channels",
          icon: Mail,
          roles: ["tenant_admin"],
        },
        {
          label: "Integrations & API",
          href: "/settings/integrations",
          icon: Zap,
          roles: ["tenant_admin"],
        },
        {
          label: "Security & SSO",
          href: "/settings/security",
          icon: Shield,
          roles: ["tenant_admin"],
        },
        {
          label: "Data & privacy",
          href: "/settings/data",
          icon: Database,
          roles: ["tenant_admin"],
        },
        {
          label: "Notification center",
          href: "/settings/notifications",
          icon: Bell,
          roles: ["tenant_admin", "manager", "agent"],
        },
        {
          label: "Audit log",
          href: "/settings/audit",
          icon: FileText,
          roles: ["tenant_admin", "manager"],
        },
      ],
    },

    {
      title: "ACCOUNT",
      items: [
        {
          label: "Billing overview",
          href: "/account/billing",
          icon: CreditCard,
          roles: ["tenant_admin", "billing_admin"],
        },
        {
          label: "Plans & pricing",
          href: "/account/plans",
          icon: Sparkles,
          roles: ["tenant_admin", "billing_admin"],
        },
      ],
    },
  ];

  const hasAccess = (itemRoles: MembershipRole[]) =>
    itemRoles.includes(userRole);

  const visibleSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => hasAccess(item.roles)),
    }))
    .filter((section) => section.items.length > 0);

  return (
    <Sidebar
      collapsible="icon"
      className="
        select-none
        border-r
        border-slate-200/80
        bg-white
        text-slate-700
      "
    >
      <SidebarHeader
        className="
          border-b
          border-sidebar-border
          p-3.5
          group-data-[collapsible=icon]:px-2
          group-data-[collapsible=icon]:py-3
        "
      >
        <div
          className="
            flex
            items-center
            gap-2.5
            group-data-[collapsible=icon]:flex-col
            group-data-[collapsible=icon]:gap-2
          "
        >
          <div
            className="
              flex
              size-8
              shrink-0
              items-center
              justify-center
              rounded-md
              bg-sidebar-primary
              text-sm
              font-extrabold
              text-sidebar-primary-foreground
            "
          >
            {identity?.org.initial ?? "T"}
          </div>

          <TooltipProvider>
            <div
              className="
      flex
      min-w-0
      flex-1
      flex-col
      group-data-[collapsible=icon]:hidden
    "
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="
            block
            min-w-0
            truncate
            text-sm
            font-bold
            text-foreground
          "
                  >
                    {identity?.org.name ?? "Tenant Workspace"}
                  </span>
                </TooltipTrigger>

                <TooltipContent>
                  {identity?.org.name ?? "Tenant Workspace"}
                </TooltipContent>
              </Tooltip>

              <span
                className="
        truncate
        text-xs
        text-muted-foreground
      "
              >
                {identity?.org.planSummary ?? "Active Plan"}
              </span>
            </div>
          </TooltipProvider>

          <ChevronDown
            aria-hidden
            className="
              size-4
              shrink-0
              text-muted-foreground
              group-data-[collapsible=icon]:hidden
            "
          />

          <SidebarTrigger
            icon={<PanelLeft />}
            className="
          hidden
          size-8
          shrink-0
          border
          border-border
          bg-card
          text-muted-foreground
          hover:bg-muted
          md:flex
        "
          />
        </div>
      </SidebarHeader>

      <SidebarContent
        className="
          gap-3.5
          px-2.5
          py-3
          group-data-[collapsible=icon]:px-2
          group-data-[collapsible=icon]:py-3
        "
      >
        {visibleSections.map((group, index) => (
          <SidebarGroup
            key={group.title ?? `group-${index}`}
            className="gap-1 p-0"
          >
            {group.title && (
              <SidebarGroupLabel
                className="
                  h-auto
                  px-3
                  pt-1.5
                  pb-1
                  text-xs
                  font-bold
                  uppercase
                  tracking-widest
                  text-muted-foreground/80
                  group-data-[collapsible=icon]:hidden
                "
              >
                {group.title}
              </SidebarGroupLabel>
            )}

            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;

                  const targetPath = tenantSlug
                    ? tenantPath(tenantSlug, item.href)
                    : item.href;

                  const isActive =
                    pathname === targetPath ||
                    (item.href !== "/" &&
                      pathname.startsWith(`${targetPath}/`));

                  return (
                    <SidebarMenuItem
                      key={item.href}
                      className="
                        group-data-[collapsible=icon]:flex
                        group-data-[collapsible=icon]:justify-center
                      "
                    >
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.label}
                        className={cn(
                          "h-10 w-full rounded-md px-2.5 text-sm font-medium text-slate-600",
                          "transition-colors hover:bg-slate-100/80 hover:text-slate-900",
                          isActive &&
                            "bg-slate-100/80 font-semibold text-slate-900",
                          "group-data-[collapsible=icon]:h-10",
                          "group-data-[collapsible=icon]:w-10",
                          "group-data-[collapsible=icon]:justify-center",
                          "group-data-[collapsible=icon]:p-0",
                        )}
                      >
                        <Link
                          href={targetPath}
                          className="
                            flex
                            min-w-0
                            items-center
                            gap-2.5
                            group-data-[collapsible=icon]:justify-center
                          "
                        >
                          <Icon
                            className="
                              size-4
                              shrink-0
                              text-slate-600
                            "
                          />

                          <span
                            className="
                              truncate
                              group-data-[collapsible=icon]:hidden
                            "
                          >
                            {item.label}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter
        className="
          border-t
          border-sidebar-border
          p-3
          group-data-[collapsible=icon]:px-2
          group-data-[collapsible=icon]:py-3
        "
      >
        <div
          className="
            flex
            items-center
            gap-2.5
            group-data-[collapsible=icon]:justify-center
          "
        >
          <Avatar
            className="
              size-8
              shrink-0
            "
          >
            <AvatarImage
              src={identity?.user.avatarUrl}
              alt={identity?.user.name ?? "User"}
            />

            <AvatarFallback
              className="
                bg-foreground
                text-xs
                font-bold
                text-background
              "
            >
              {identity?.user.initials ?? "U"}
            </AvatarFallback>
          </Avatar>

          <div
            className="
              flex
              min-w-0
              flex-col
              group-data-[collapsible=icon]:hidden
            "
          >
            <span
              className="
                truncate
                text-sm
                font-semibold
                text-foreground
              "
            >
              {identity?.user.name ?? "User"}
            </span>

            <span
              className="
                truncate
                text-xs
                capitalize
                text-muted-foreground
              "
            >
              {userRole.replace("_", " ")}
            </span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
