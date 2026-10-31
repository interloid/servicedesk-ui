"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  AtSign,
  Bell,
  CreditCard,
  Mail,
  MessageSquare,
  Ticket,
  TriangleAlert,
  X,
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
import { confirmNavigation } from "@/hooks/use-unsaved-changes-guard";
import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";
import type { NotificationTone } from "@/types/notification";
import { cn } from "@/lib/utils";

const MAX_ITEMS = 20;

/** Round, tinted icon badges: red breach, amber warning, green ticket news. */
const TONE_CIRCLE: Record<NotificationTone, string> = {
  brand: "bg-success-soft text-success-strong",
  info: "bg-info-soft text-info-strong",
  error: "bg-destructive-soft text-destructive-strong",
  warning: "bg-warning-soft text-warning-strong",
};

const FOOTER_BUTTON =
  "rounded-md px-2 py-1.5 text-xs font-bold tracking-[0.12em] text-brand-accent uppercase transition-colors";

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
  const { notifications, prefs, setRead, markAllRead, clear } =
    useNotifications();
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  // Only the event types switched on under "In-app" reach the bell.
  const visible = useMemo(
    () => (notifications ?? []).filter((n) => isShownInApp(n, prefs)),
    [notifications, prefs],
  );
  // The bell lists unread notifications only; read ones stay on the
  // Notifications page.
  const unreadItems = useMemo(() => visible.filter((n) => n.unread), [visible]);
  const unread = unreadItems.length;
  const items = unreadItems.slice(0, MAX_ITEMS);
  const badge = unread > 99 ? "99+" : String(unread);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setConfirmClear(false);
  };

  // Clears the unread notifications the bell shows; read ones and types
  // switched off in-app are left alone.
  const clearAll = () => {
    setConfirmClear(false);
    void clear(unreadItems.map((n) => n.id));
  };

  const openItem = (item: NotificationFeedItem) => {
    if (item.unread) void setRead(item.id, true);
    if (item.ticketId) {
      changeOpen(false);
      const href = tenantPath(
        tenantSlug,
        `${TENANT_ROUTES.TICKETS}/${item.ticketId}`,
      );
      if (confirmNavigation(href)) router.push(href);
    }
  };

  return (
    <Popover open={open} onOpenChange={changeOpen}>
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
        className="flex w-[calc(100vw-2rem)] max-w-md flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-[0_24px_60px_rgba(15,23,42,0.18)] sm:w-104"
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 py-5.5 pb-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-lg leading-tight font-bold tracking-tight text-foreground">
              Notifications
            </h2>
            <p className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
              {unread === 0
                ? "No unread updates"
                : `${badge} unread ${unread === 1 ? "update" : "updates"}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => changeOpen(false)}
            aria-label="Close notifications"
            className="-mt-3 -mr-3 flex size-10 shrink-0 items-center justify-center bg-card text-foreground transition-colors"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {notifications === null ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            Loading notifications…
          </div>
        ) : (
          items.length === 0 && (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-semibold text-foreground">
                You&apos;re all caught up
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                New ticket assignments and SLA alerts will show up here.
              </p>
            </div>
          )
        )}

        {items.length > 0 && (
          <div className="max-h-[60vh] overflow-y-auto sm:max-h-80">
            {items.map((n) => {
              const look = itemLook(n);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openItem(n)}
                  className="flex w-full items-start gap-4 border-t border-border/70 px-3 py-4 text-left transition-colors first:border-t-0 hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:outline-none"
                >
                  <span
                    className={cn(
                      "flex size-11 shrink-0 items-center justify-center rounded-full",
                      TONE_CIRCLE[look.tone],
                    )}
                  >
                    <look.icon className="size-5" aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span
                      className={cn(
                        "text-sm text-foreground wrap-break-word",
                        n.unread ? "font-bold" : "font-semibold",
                      )}
                    >
                      {n.title}
                    </span>
                    {n.subtitle && (
                      <span className="line-clamp-3 text-sm leading-relaxed text-muted-foreground wrap-break-word">
                        {n.subtitle}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-2.5 pt-0.5">
                    <span className="text-xs whitespace-nowrap text-muted-foreground">
                      {formatRelative(n.createdAt)}
                    </span>
                    {n.unread && (
                      <span
                        aria-label="Unread"
                        className="mr-1 size-2.5 rounded-full bg-brand-accent"
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {unread > 0 &&
          (confirmClear ? (
            <div className="relative z-10 flex items-center justify-between gap-3 border-t bg-destructive-soft/60 px-5 py-3 shadow-[0_-6px_16px_-4px_rgba(15,23,42,0.08)]">
              <span className="text-sm font-medium text-foreground">
                Clear all notifications?
              </span>
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className={FOOTER_BUTTON}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={clearAll}
                  className={cn(FOOTER_BUTTON, "text-destructive-strong")}
                >
                  Clear
                </button>
              </span>
            </div>
          ) : (
            <div className="relative z-10 flex items-center justify-between gap-3 border-t bg-popover px-3 py-2.5 shadow-[0_-6px_16px_-4px_rgba(15,23,42,0.08)]">
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className={FOOTER_BUTTON}
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={() => void markAllRead()}
                disabled={unread === 0}
                className={FOOTER_BUTTON}
              >
                Mark all read
              </button>
            </div>
          ))}
      </PopoverContent>
    </Popover>
  );
}
