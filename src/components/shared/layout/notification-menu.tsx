"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  AtSign,
  Bell,
  CreditCard,
  Mail,
  MessageSquare,
  Ticket,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNotifications } from "@/features/notifications/components/notifications-provider";
import {
  formatRelative,
  isShownInApp,
} from "@/features/notifications/lib/feed";
import type { NotificationFeedItem } from "@/features/notifications/types/notifications";
import { TONE_TILE } from "@/lib/notifications";
import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";
import type { NotificationTone } from "@/types/notification";
import { cn } from "@/lib/utils";

const MAX_ITEMS = 20;

function itemLook(item: NotificationFeedItem): {
  icon: LucideIcon;
  tone: NotificationTone;
} {
  switch (item.type) {
    case "sla":
      if (item.slaType === "first_response")
        return { icon: Mail, tone: "info" };
      return {
        icon: TriangleAlert,
        tone: item.kind === "sla_warning" ? "warning" : "error",
      };
    case "ticket":
      return {
        icon: item.kind === "ticket_updated" ? MessageSquare : Ticket,
        tone: "brand",
      };
    case "reply":
      return { icon: AtSign, tone: "brand" };
    case "payment":
      return { icon: CreditCard, tone: "warning" };
    default:
      return { icon: Bell, tone: "info" };
  }
}

export function NotificationMenu() {
  const router = useRouter();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { notifications, prefs, setRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);

  // Only the event types switched on under "In-app" reach the bell.
  const visible = useMemo(
    () => (notifications ?? []).filter((n) => isShownInApp(n, prefs)),
    [notifications, prefs],
  );
  const unread = visible.filter((n) => n.unread).length;
  const items = visible.slice(0, MAX_ITEMS);
  const badge = unread > 99 ? "99+" : String(unread);

  const openItem = (item: NotificationFeedItem) => {
    if (item.unread) void setRead(item.id, true);
    if (item.ticketId) {
      setOpen(false);
      router.push(
        tenantPath(tenantSlug, `${TENANT_ROUTES.TICKETS}/${item.ticketId}`),
      );
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <PopoverTrigger asChild>
            <TooltipTrigger asChild>
              <div
                className="relative flex size-10 sm:size-11 cursor-pointer items-center justify-center rounded-md"
                role="button"
                tabIndex={0}
                aria-label={`Notifications, ${unread} unread`}
              >
                <Bell className="size-5" aria-hidden />

                {unread > 0 && (
                  <span
                    aria-hidden
                    className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-bold text-destructive-foreground ring-2 ring-background"
                  >
                    {badge}
                  </span>
                )}
              </div>
            </TooltipTrigger>
          </PopoverTrigger>
          <TooltipContent side="bottom">
            <p>Notifications</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent
        align="end"
        sideOffset={13}
        className="w-[calc(100vw-2rem)] sm:w-96 max-w-sm overflow-hidden rounded-xl p-0 shadow-[0_24px_60px_rgba(15,23,42,0.18)]"
      >
        <div className="flex items-center justify-between gap-2.5 border-b px-4 py-3.5">
          <span className="text-sm font-bold text-foreground">
            Notifications
          </span>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="rounded-sm p-1 text-xs font-semibold text-brand-accent hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Mark all read
            </button>
          )}
        </div>

        {notifications === null ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            Loading notifications…
          </div>
        ) : (
          items.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm font-medium text-foreground">
                You&apos;re all caught up
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ticket assignments and SLA alerts will show up here.
              </p>
            </div>
          )
        )}

        <div className="max-h-[60vh] sm:max-h-80 overflow-y-auto">
          {items.map((n) => {
            const look = itemLook(n);
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => openItem(n)}
                className={cn(
                  "flex w-full items-start gap-3 border-t border-muted px-4 py-3.5 text-left first:border-t-0 transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
                  n.unread ? "bg-accent/50" : "bg-popover",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md",
                    TONE_TILE[look.tone],
                  )}
                >
                  <look.icon className="size-4" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-semibold text-foreground truncate">
                    {n.title}
                  </span>
                  {n.subtitle && (
                    <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground wrap-break-word">
                      {n.subtitle}
                    </span>
                  )}
                  <span className="text-[11px] text-muted-foreground/80 mt-0.5">
                    {formatRelative(n.createdAt)}
                  </span>
                </span>
                <span
                  aria-label={n.unread ? "Unread" : undefined}
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    n.unread ? "bg-brand-accent" : "bg-transparent",
                  )}
                />
              </button>
            );
          })}
        </div>

        <div className="border-t px-4 py-2.5 text-center">
          <Link
            href={tenantPath(tenantSlug, TENANT_ROUTES.SETTINGS.NOTIFICATIONS)}
            onClick={() => setOpen(false)}
            className="rounded-sm p-1 text-xs font-semibold text-brand-accent hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            View all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
