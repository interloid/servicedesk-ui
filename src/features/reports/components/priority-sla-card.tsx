"use client";

import React from "react";
import {
  CircleCheck,
  FileX2,
  Flame,
  Info,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PrioritySlaMetric } from "../types/types";
import { REPORT_CARD } from "./styles";

interface PriorityStyle {
  icon: LucideIcon;
  /** Soft icon chip. */
  chip: string;
  bar: string;
}

const PRIORITY_STYLE: Record<string, PriorityStyle> = {
  Urgent: {
    icon: TriangleAlert,
    chip: "bg-destructive-soft text-destructive-strong ring-destructive/15",
    bar: "bg-destructive",
  },
  High: {
    icon: Flame,
    chip: "bg-warning-soft text-warning-strong ring-warning/20",
    bar: "bg-warning",
  },
  Normal: {
    icon: Zap,
    chip: "bg-sky-50 text-sky-700 ring-sky-500/15 dark:bg-sky-950 dark:text-sky-300",
    bar: "bg-sky-500",
  },
  Low: {
    icon: CircleCheck,
    chip: "bg-success-soft text-success-strong ring-success/15",
    bar: "bg-success",
  },
};

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * A priority with nothing to judge yet: an empty-state row in place of a "—",
 * so it reads as "nothing happened" rather than as a missing figure.
 */
function EmptyPriorityTile({ item }: { item: PrioritySlaMetric }) {
  const noTickets = item.ticketsCount === 0;

  // Stacked rather than side by side: four tiles share one row, which leaves
  // no room for the icon beside the text.
  return (
    <div className="flex min-w-0 flex-col rounded-xl border bg-card p-3 sm:p-4">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        >
          <FileX2 className="size-3.5" />
        </span>
        <p className="truncate text-sm font-medium text-foreground">
          {item.level}
        </p>
      </div>

      <p className="mt-3 text-sm font-semibold text-foreground">
        {noTickets ? "No tickets yet" : "Awaiting reply"}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {noTickets
          ? `No ${item.level.toLowerCase()} priority tickets in this period`
          : `${plural(item.ticketsCount, "ticket")} still within target`}
      </p>

      <div className="mt-auto pt-3">
        <div
          role="progressbar"
          aria-label={`${item.level} SLA met`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={0}
          className="h-2.5 w-full rounded-full bg-muted"
        />
      </div>
    </div>
  );
}

function PriorityTile({ item }: { item: PrioritySlaMetric }) {
  const style = PRIORITY_STYLE[item.level] ?? PRIORITY_STYLE.Low;
  const Icon = style.icon;
  const pct = item.metPercentage;

  if (item.eligible === 0) return <EmptyPriorityTile item={item} />;

  return (
    <div className="flex min-w-0 flex-col rounded-xl border bg-card p-3 transition-colors hover:border-foreground/15 sm:p-4">
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
            style.chip,
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <p className="truncate text-sm font-medium text-foreground">
          {item.level}
        </p>
      </div>

      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
        {pct}
        <span className="ml-0.5 text-sm font-medium text-muted-foreground">
          %
        </span>
      </p>
      <p className="truncate text-xs text-muted-foreground">
        {`${item.met} of ${plural(item.eligible, "ticket")}`}
      </p>

      <div className="mt-auto pt-3">
        <div
          role="progressbar"
          aria-label={`${item.level} SLA met`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct ?? 0}
          className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn("h-full rounded-full", style.bar)}
            style={{ width: `${pct ?? 0}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export function PrioritySlaCard({ items }: { items: PrioritySlaMetric[] }) {
  // Radix tooltips open on hover and focus only, and close on every click of
  // the trigger, so a tap on a phone never shows one. Drive it ourselves: a
  // tap toggles it, and tapping anywhere else still dismisses it.
  const [infoOpen, setInfoOpen] = React.useState(false);

  return (
    <Card className={REPORT_CARD}>
      <div className="flex items-center gap-1.5">
        <h2 className="text-base font-semibold text-foreground">
          SLA Attainment by Priority
        </h2>
        <Tooltip open={infoOpen} onOpenChange={setInfoOpen}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="About SLA attainment by priority"
              onClick={(event) => {
                // Skips Radix's own close-on-click.
                event.preventDefault();
                setInfoOpen((open) => !open);
              }}
              className="-m-1 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Info className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">
            Share of tickets raised in this period whose first public reply
            landed within their SLA target.
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="text-sm text-muted-foreground">
        First responses within each ticket&apos;s SLA target
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map((item) => (
          <PriorityTile key={item.level} item={item} />
        ))}
      </div>
    </Card>
  );
}
