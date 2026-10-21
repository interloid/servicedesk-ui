"use client";

import * as React from "react";
import { ArrowRight, CalendarDays } from "lucide-react";
import type { DateRange } from "react-day-picker";

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

const PRESETS = [
  { label: "Today", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 12 months", days: 365 },
] as const;

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
        className="w-auto max-w-[calc(100vw-2rem)] p-0"
      >
        <div className="flex flex-col sm:flex-row">
          <div className="flex gap-1 overflow-x-auto border-b border-border p-2 sm:w-40 sm:flex-col sm:border-r sm:border-b-0">
            {PRESETS.map((preset) => {
              const start = presetFrom(preset.days);
              const active = start === from && to === today;
              return (
                <Button
                  key={preset.label}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "shrink-0 justify-start font-normal",
                    active && "bg-muted font-medium",
                  )}
                  onClick={() => commit(start, today)}
                >
                  {preset.label}
                </Button>
              );
            })}
          </div>

          <div className="flex flex-col">
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={draft}
              onSelect={setDraft}
              defaultMonth={toDate(addDays(to, -31))}
              startMonth={toDate(earliest)}
              endMonth={toDate(today)}
              disabled={[
                { before: toDate(earliest) },
                { after: toDate(today) },
              ]}
              className="p-3 [--cell-size:--spacing(8)]"
            />
            <div className="flex items-center justify-end gap-2 border-t border-border p-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-brand-accent text-brand-accent-foreground hover:bg-brand-accent/90"
                disabled={!draft?.from}
                onClick={() => {
                  if (!draft?.from) return;
                  commit(toDay(draft.from), toDay(draft.to ?? draft.from));
                }}
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
