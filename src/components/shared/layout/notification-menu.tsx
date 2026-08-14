"use client";

import * as React from "react";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { NOTIFICATIONS, TONE_TILE } from "@/lib/notifications";
import { cn } from "@/lib/utils";

/**
 * Notification tray, from `Update design.dc.html` → `notifPanel` and its `<sc-for>` rows.
 *
 * Popover, not DropdownMenu: the design's panel is a scrollable list of non-actionable
 * rows plus a "Mark all read" control in its own header. Menu semantics would make every
 * row a `menuitem` and leave the header action stranded outside the menu's roving focus.
 *
 * The bell and its unread badge live here because the bell *is* the trigger — keeping the
 * count next to the state that changes it is what makes "Mark all read" work.
 */
export function NotificationMenu() {
  // Local only. Marking read does not survive a reload until the API exists.
  const [readAll, setReadAll] = React.useState(false);
  const unread = readAll ? 0 : NOTIFICATIONS.filter((n) => n.unread).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* 44×44, 8px radius, transparent border, muted fill while open — `bellStyle`.
            The open fill comes from the ghost variant's own `aria-expanded` rule, which
            Radix sets on the trigger, and resolves to --muted (#F1F5F9) as the design does. */}
        <Button
          variant="ghost"
          className="relative size-11 rounded-md"
          aria-label={`Notifications, ${unread} unread`}
        >
          <Bell aria-hidden />
          {unread > 0 ? (
            <span
              aria-hidden
              // 16×17px pill, 12px/700, 5px from the button's outer edge. The inset is
              // 4px, not 5: Button carries a 1px transparent border, so absolute offsets
              // resolve against a padding box already inset by 1px.
              className="absolute top-1 right-1 flex h-[17px] min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-xs leading-none font-bold text-destructive-foreground ring-2 ring-background"
            >
              {unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        // 380px desktop / 300px mobile, 14px radius, the design's own drop shadow.
        className="w-[300px] overflow-hidden rounded-xl p-0 shadow-[0_24px_60px_rgba(15,23,42,0.18)] sm:w-[380px]"
      >
        <div className="flex items-center justify-between gap-2.5 border-b px-4 py-3.5">
          <span className="text-sm font-bold text-foreground">
            Notifications
          </span>
          <button
            type="button"
            onClick={() => setReadAll(true)}
            className="rounded-sm p-1.5 text-xs font-semibold text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Mark all read
          </button>
        </div>

        <div className="max-h-[340px] overflow-y-auto">
          {NOTIFICATIONS.map((n) => {
            const isUnread = n.unread && !readAll;
            return (
              <div
                key={n.id}
                className={cn(
                  "flex items-start gap-3 border-t border-muted px-4 py-3.5 first:border-t-0",
                  // The design tints unread rows with shade(accent, .965) — a step lighter
                  // than --accent, which has no token. Half-strength --accent is the
                  // closest token-only match; see docs/SHELL-DIFF.md.
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
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm font-semibold text-foreground">
                    {n.title}
                  </span>
                  <span className="text-xs leading-[1.45] text-muted-foreground">
                    {n.body}
                  </span>
                  <span className="text-xs text-muted-foreground/80">
                    {n.time}
                  </span>
                </div>
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    isUnread ? "bg-primary" : "bg-transparent",
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
