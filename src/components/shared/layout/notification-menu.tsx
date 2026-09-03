"use client";

import { Bell } from "lucide-react";
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
import { TONE_TILE } from "@/lib/notifications";
import { UiNotification } from "@/lib/notifications-shared";
import { NotificationIcon } from "@/components/shared/layout/notification-icon";
import { cn } from "@/lib/utils";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/lib/notifications.actions";
import { useRealtimeNotifications } from "@/hooks/use-realtime-notifications";
import { useRouter } from "next/navigation";

interface NotificationMenuProps {
  notifications: UiNotification[];
  tenantSlug: string;
}

export function NotificationMenu({
  notifications = [],
  tenantSlug,
}: NotificationMenuProps) {
  const { items, setItems, unread } = useRealtimeNotifications(
    tenantSlug,
    notifications,
  );
  const router = useRouter();

  const handleMarkAllRead = async () => {
    await markAllNotificationsReadAction(tenantSlug);
    setItems((prev) => prev.map((n) => ({ ...n, unread: false })));
  };

  const handleOpen = async (n: UiNotification) => {
    if (n.unread) {
      await markNotificationReadAction(n.id);
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, unread: false } : x)),
      );
    }
    if (n.payload.ticket_id) {
      router.push(`/${tenantSlug}/tickets/${n.payload.ticket_id}`);
    } else if (n.payload.ticket_number || n.payload.subject) {
      router.push(`/${tenantSlug}/tickets`);
    }
  };

  return (
    <Popover>
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
                    {unread}
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
              onClick={handleMarkAllRead}
              className="rounded-sm p-1 text-xs font-semibold text-brand-accent hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              Mark all read
            </button>
          )}
        </div>

        {items.length === 0 && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm font-medium text-foreground">
              You&apos;re all caught up
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ticket assignments and SLA alerts will show up here.
            </p>
          </div>
        )}

        <div className="max-h-[60vh] sm:max-h-80 overflow-y-auto">
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => handleOpen(n)}
              className={cn(
                "flex w-full items-start gap-3 border-t border-muted px-4 py-3.5 first:border-t-0 text-left transition-colors hover:bg-muted/50",
                n.unread ? "bg-accent/50" : "bg-popover",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md",
                  TONE_TILE[n.tone],
                )}
              >
                <NotificationIcon
                  name={n.icon}
                  className="size-4"
                  aria-hidden
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-semibold text-foreground truncate">
                  {n.title}
                </span>
                {n.body && (
                  <span className="text-xs leading-relaxed text-muted-foreground wrap-break-word">
                    {n.body}
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground/80 mt-0.5">
                  {n.time
                    ? new Date(n.time).toLocaleString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : ""}
                </span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  n.unread ? "bg-brand-accent" : "bg-transparent",
                )}
              />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
