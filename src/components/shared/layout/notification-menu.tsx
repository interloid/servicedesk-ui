"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { NOTIFICATIONS, TONE_TILE } from "@/lib/notifications";
import { cn } from "@/lib/utils";

export function NotificationMenu() {
  const [readAll, setReadAll] = useState<boolean>(false);
  const unread = readAll ? 0 : NOTIFICATIONS.filter((n) => n.unread).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="relative size-10 sm:size-11 rounded-md"
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
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={13}
        className="w-[calc(100vw-2rem)] sm:w-96 max-w-sm overflow-hidden rounded-xl p-0 shadow-[0_24px_60px_rgba(15,23,42,0.18)]"
      >
        <div className="flex items-center justify-between gap-2.5 border-b px-4 py-3.5">
          <span className="text-sm font-bold text-foreground">
            Notifications
          </span>
          <button
            type="button"
            onClick={() => setReadAll(true)}
            className="rounded-sm p-1 text-xs font-semibold text-brand-accent hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Mark all read
          </button>
        </div>

        <div className="max-h-[60vh] sm:max-h-80 overflow-y-auto">
          {NOTIFICATIONS.map((n) => {
            const isUnread = n.unread && !readAll;
            return (
              <div
                key={n.id}
                className={cn(
                  "flex items-start gap-3 border-t border-muted px-4 py-3.5 first:border-t-0 transition-colors",
                  isUnread ? "bg-accent/50" : "bg-popover",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md",
                    TONE_TILE[n.tone],
                  )}
                >
                  <n.icon className="size-4" aria-hidden />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-semibold text-foreground truncate">
                    {n.title}
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground wrap-break-word">
                    {n.body}
                  </span>
                  <span className="text-[11px] text-muted-foreground/80 mt-0.5">
                    {n.time}
                  </span>
                </div>
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    isUnread ? "bg-brand-accent" : "bg-transparent",
                  )}
                />
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
