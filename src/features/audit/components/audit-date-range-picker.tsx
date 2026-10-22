"use client";

import * as React from "react";
import { ArrowRight, CalendarDays, Check } from "lucide-react";
import { getDefaultClassNames, type DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { addDays, formatAuditDay } from "@/features/audit/types/audit";

/** A YYYY-MM-DD day as a local Date at midnight, which is what DayPicker draws. */
function toDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Inclusive day count between two YYYY-MM-DD days. */
function daySpan(from: string, to: string): number {
  return (
    Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000) + 1
  );
}

const PRESETS = [
  { label: "Today", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 12 months", days: 365 },
] as const;

/**
 * Two months sit side by side from md up (the Calendar stacks them below
 * that), so smaller screens get one month instead of a tall stack.
 */
const TWO_MONTHS_QUERY = "(min-width: 768px)";

function useTwoMonths(): boolean {
  return React.useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(TWO_MONTHS_QUERY);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(TWO_MONTHS_QUERY).matches,
    () => true,
  );
}

const defaultClassNames = getDefaultClassNames();

/**
 * Range colours in the brand accent: solid ends, a light tint between, the
 * same pairing the rest of the app uses for a selected span.
 */
const RANGE_CLASS_NAMES = {
  range_start: cn(
    "relative isolate z-0 rounded-l-(--cell-radius) bg-brand-accent/10 after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-brand-accent/10",
    defaultClassNames.range_start,
  ),
  range_middle: cn("rounded-none", defaultClassNames.range_middle),
  range_end: cn(
    "relative isolate z-0 rounded-r-(--cell-radius) bg-brand-accent/10 after:absolute after:inset-y-0 after:left-0 after:w-4 after:bg-brand-accent/10",
    defaultClassNames.range_end,
  ),
  today: cn(
    "rounded-(--cell-radius) font-semibold text-brand-accent data-[selected=true]:rounded-none",
    defaultClassNames.today,
  ),
};

const RANGE_BUTTONS = cn(
  "**:data-[range-start=true]:bg-brand-accent! **:data-[range-start=true]:text-brand-accent-foreground!",
  "**:data-[range-end=true]:bg-brand-accent! **:data-[range-end=true]:text-brand-accent-foreground!",
  "**:data-[range-middle=true]:bg-brand-accent/10! **:data-[range-middle=true]:text-brand-accent!",
  "**:data-[selected-single=true]:bg-brand-accent! **:data-[selected-single=true]:text-brand-accent-foreground!",
);

/**
 * The page's date range: presets, or two days picked on the calendar.
 *
 * Days are calendar days in the workspace time zone, passed in as
 * YYYY-MM-DD. `today` and `earliest` (the retention window) come from the
 * server, so the picker never offers a day the page would clamp away.
 */
export function AuditDateRangePicker({
  from,
  to,
  today,
  earliest,
  onChange,
  disabled,
  className,
}: {
  from: string;
  to: string;
  today: string;
  earliest: string;
  onChange: (from: string, to: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DateRange | undefined>();
  const twoMonths = useTwoMonths();

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setDraft({ from: toDate(from), to: toDate(to) });
  };

  const commit = (start: string, end: string) => {
    setOpen(false);
    if (start !== from || end !== to) onChange(start, end);
  };

  const presetFrom = (days: number) => {
    const start = addDays(today, -(days - 1));
    return start < earliest ? earliest : start;
  };

  const draftFrom = draft?.from ? toDay(draft.from) : null;
  const draftTo = draft?.to ? toDay(draft.to) : draftFrom;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-10 justify-start gap-2 rounded-lg bg-card px-3.5 text-sm font-medium shadow-none",
            className,
          )}
          aria-label={`Date range: ${formatAuditDay(from)} to ${formatAuditDay(to)}`}
        >
          <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
          <span>{formatAuditDay(from)}</span>
          <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
          <span>{formatAuditDay(to)}</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-auto max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-0"
      >
        <div className="flex flex-col sm:flex-row">
          <div className="border-b border-border sm:w-44 sm:border-r sm:border-b-0">
            <p className="hidden px-4 pt-4 pb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase sm:block">
              Quick select
            </p>
            <div className="flex gap-1 overflow-x-auto p-2 scrollbar-none sm:flex-col sm:px-2 sm:pt-0">
              {PRESETS.map((preset) => {
                const start = presetFrom(preset.days);
                const active = start === from && to === today;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => commit(start, today)}
                    className={cn(
                      "flex h-9 shrink-0 items-center justify-between gap-3 rounded-lg px-3 text-sm whitespace-nowrap transition-colors",
                      active
                        ? "bg-brand-accent/10 font-semibold text-brand-accent"
                        : "text-foreground hover:bg-muted",
                    )}
                  >
                    {preset.label}
                    {active && (
                      <Check className="hidden size-4 sm:block" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <RangeField
                label="Start"
                value={draftFrom ? formatAuditDay(draftFrom) : "—"}
              />
              <ArrowRight
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <RangeField
                label="End"
                value={draftTo ? formatAuditDay(draftTo) : "—"}
              />
            </div>

            <Calendar
              mode="range"
              numberOfMonths={twoMonths ? 2 : 1}
              selected={draft}
              onSelect={setDraft}
              defaultMonth={toDate(addDays(to, twoMonths ? -31 : 0))}
              startMonth={toDate(earliest)}
              endMonth={toDate(today)}
              disabled={[
                { before: toDate(earliest) },
                { after: toDate(today) },
              ]}
              classNames={RANGE_CLASS_NAMES}
              className={cn(
                "mx-auto p-4 [--cell-size:--spacing(9)] sm:mx-0",
                RANGE_BUTTONS,
              )}
            />

            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
              <p className="text-sm text-muted-foreground tabular-nums">
                {draftFrom && draftTo
                  ? `${daySpan(draftFrom, draftTo)} ${daySpan(draftFrom, draftTo) === 1 ? "day" : "days"} selected`
                  : "Pick a start day"}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="h-9 rounded-lg px-4 font-semibold shadow-none"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="h-9 rounded-lg bg-brand-accent px-4 font-semibold text-brand-accent-foreground shadow-none hover:bg-brand-accent/90"
                  disabled={!draftFrom || !draftTo}
                  onClick={() => {
                    if (draftFrom && draftTo) commit(draftFrom, draftTo);
                  }}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function RangeField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-lg border border-border bg-muted/40 px-3 py-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
}
