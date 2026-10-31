"use client";

import { useEffect, useState } from "react";
import { Clock, PauseCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useMounted } from "@/hooks/use-mounted";
import {
  SlaClockState,
  computeSlaClock,
  formatOpening,
  formatOpeningLong,
  formatSlaDuration,
  headlineSlaEvent,
} from "@/features/tickets/lib/sla";
import {
  SlaEvent,
  TicketPriority,
  TicketSlaPolicy,
} from "@/features/tickets/types/tickets.types";
import { toDurationInput } from "@/features/sla-policies/duration";
import {
  SlaCalendar,
  nextWorkingStart,
  usableCalendar,
} from "@/features/tickets/lib/sla-calendar";

const LABELS: Record<SlaEvent["type"], string> = {
  first_response: "First response",
  resolution: "Resolution",
};

const BADGE: Record<
  SlaClockState,
  { badge: string; dot: string; bar: string }
> = {
  running: {
    badge: "bg-[#0e7adf]/10 text-[#0e7adf]",
    dot: "bg-[#0e7adf]",
    bar: "bg-[#0e7adf]",
  },
  warning: {
    badge: "bg-amber-100 text-amber-900",
    dot: "bg-amber-600",
    bar: "bg-amber-400",
  },
  waiting: {
    badge: "bg-slate-100 text-slate-600",
    dot: "bg-slate-400",
    bar: "bg-[#0e7adf]",
  },
  paused: {
    badge: "bg-slate-100 text-slate-600",
    dot: "bg-slate-400",
    bar: "bg-slate-300",
  },
  breached: {
    badge: "bg-rose-100 text-rose-800",
    dot: "bg-rose-500",
    bar: "bg-red-400",
  },
  met: {
    badge: "bg-emerald-100 text-emerald-800",
    dot: "bg-emerald-600",
    bar: "bg-emerald-400",
  },
};

function formatClock(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The target as the policy editor shows it: "1 day", "4 hours", "15 minutes".
 * A day on a business-hours policy is one working day of its calendar.
 */
function formatTarget(
  ev: SlaEvent,
  policy: TicketSlaPolicy | null,
  priority: TicketPriority | undefined,
): string | null {
  if (!ev.target_mins) return null;
  const unit = priority ? policy?.target_units[priority]?.[ev.type] : undefined;
  const dayMins = policy?.calendar ? policy.day_mins : 1440;
  const { amount, unit: shown } = toDurationInput(
    ev.target_mins,
    unit,
    dayMins,
  );
  const label = amount === "1" ? shown.slice(0, -1) : shown;
  const working = policy?.calendar && shown === "days" ? "working " : "";
  return `${amount} ${working}${label}`;
}

/**
 * The time the clocks are drawn at. Ticks every second while a clock is
 * counting. While every running clock is waiting for business hours nothing
 * visibly changes, so it wakes at the opening instead (checking at least
 * once a minute), not every second through a night or a weekend.
 */
function useSlaNow(
  events: SlaEvent[],
  calendar: SlaCalendar | null | undefined,
): number {
  const [now, setNow] = useState(() => Date.now());
  const running = events.filter((e) => e.status === "pending" && !e.paused_at);
  const cal = usableCalendar(calendar);
  const opensAt = cal ? nextWorkingStart(now, cal) : null;
  const waiting =
    running.length > 0 &&
    opensAt !== null &&
    opensAt > now &&
    running.every((e) => e.business_hours_id);
  const delay = waiting
    ? Math.max(1000, Math.min(60_000, opensAt - now))
    : 1000;

  useEffect(() => {
    if (running.length === 0) return;
    const id = setTimeout(() => setNow(Date.now()), delay);
    return () => clearTimeout(id);
  }, [now, running.length, delay]);

  return now;
}

/** The badge for a clock waiting on business hours, worded one way. */
const WAITING_TEXT = "Paused - Outside business hours";

function ClockBadge({
  state,
  text,
  className,
}: {
  state: SlaClockState;
  text: string;
  className?: string;
}) {
  const style = BADGE[state];
  // The countdown and times are read from the clock and the local time zone,
  // which differ between the server render and the browser.
  return (
    <span
      suppressHydrationWarning
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap tabular-nums",
        style.badge,
        className,
      )}
    >
      {state === "paused" ? (
        <PauseCircle className="size-3 shrink-0" aria-hidden />
      ) : state === "waiting" ? (
        <Clock className="size-3 shrink-0" aria-hidden />
      ) : (
        <span className={cn("size-1.5 shrink-0 rounded-full", style.dot)} />
      )}
      {text}
    </span>
  );
}

/** The clock that matters most, for the line above the ticket title. */
export function SlaHeadlineBadge({
  events,
  policy,
}: {
  events: SlaEvent[];
  policy?: TicketSlaPolicy | null;
}) {
  const now = useSlaNow(events, policy?.calendar);
  const mounted = useMounted();
  const ev = headlineSlaEvent(events);
  if (!ev) return null;
  const clock = computeSlaClock(
    ev,
    now,
    policy?.warn_before_mins,
    policy?.calendar,
    policy?.day_mins,
  );
  return (
    <ClockBadge
      state={clock.state === "waiting" ? "paused" : clock.state}
      text={`${LABELS[ev.type]} · ${
        clock.state === "waiting"
          ? // The opening is in the viewer's time zone: browser only.
            mounted && clock.startsAt !== null
            ? `Paused - resumes ${formatOpening(clock.startsAt, now)}`
            : WAITING_TEXT
          : clock.text
      }`}
      className="text-xs"
    />
  );
}

interface TicketSlaCardProps {
  events: SlaEvent[];
  /**
   * The policy the database attached when the ticket was created: the
   * customer's own policy, otherwise the tenant default. Not editable here.
   */
  policy: TicketSlaPolicy | null;
  /** A change that moves the clocks (priority, status) is in flight. */
  updating?: boolean;
  /** The ticket's priority, whose targets the clocks run against. */
  priority?: TicketPriority;
}

export function TicketSlaCard({
  events,
  policy,
  updating,
  priority,
}: TicketSlaCardProps) {
  const now = useSlaNow(events, policy?.calendar);
  const mounted = useMounted();

  const paused = events.some((e) => e.status === "pending" && e.paused_at);

  return (
    <Card className="gap-0 py-0 shadow-sm border-slate-200 bg-white ring-0">
      <CardContent className="p-4 space-y-3 text-xs">
        <h4 className="font-bold uppercase tracking-wider text-[11px] text-slate-400">
          SLA
        </h4>

        <div className="grid gap-1">
          <p className="flex min-w-0 items-baseline gap-1.5 text-xs">
            <span className="shrink-0 font-semibold text-slate-700">
              Policy:
            </span>
            <span
              className="min-w-0 truncate font-medium text-slate-900"
              title={policy?.name}
            >
              {policy?.name ?? "No SLA"}
            </span>
          </p>
          {policy && (
            <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Clock className="size-3 shrink-0" aria-hidden />
              {policy.business_hours_name
                ? `Counts business hours (${policy.business_hours_name})`
                : "Counts 24/7"}
            </p>
          )}
        </div>

        {paused && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            Clocks are paused while the ticket is waiting on the customer
            (Pending or On hold).
          </p>
        )}

        {events.length === 0 ? (
          <p className="text-[11px] text-slate-400">
            {policy
              ? "This policy has no target for the ticket's priority."
              : "No SLA policy is measuring this ticket."}
          </p>
        ) : (
          events.map((ev) => {
            const clock = computeSlaClock(
              ev,
              now,
              policy?.warn_before_mins,
              policy?.calendar,
              policy?.day_mins,
            );
            const style = BADGE[clock.state];
            const target = formatTarget(ev, policy, priority);
            const footnote =
              clock.state === "met" && ev.completed_at
                ? `Met ${formatClock(ev.completed_at)} · Due ${formatClock(ev.due_at)}`
                : clock.state === "breached"
                  ? `Was due ${formatClock(ev.breached_at ?? ev.due_at)}`
                  : clock.state === "paused"
                    ? `Paused ${formatClock(ev.paused_at!)}`
                    : clock.state === "waiting"
                      ? `${formatSlaDuration(clock.remainingMs, policy?.calendar ? policy.day_mins : 1440)} left · Due ${formatClock(ev.due_at)}`
                      : `Due ${formatClock(ev.due_at)}`;

            return (
              <div
                key={ev.id}
                className={cn(
                  "space-y-2 rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2.5 transition-opacity",
                  updating && "opacity-50",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 text-xs font-medium text-slate-600">
                    {LABELS[ev.type]}
                    {target && (
                      <span className="font-normal text-slate-400">
                        {" "}
                        · {target}
                      </span>
                    )}
                  </span>
                  <ClockBadge
                    state={clock.state === "waiting" ? "paused" : clock.state}
                    text={clock.state === "waiting" ? WAITING_TEXT : clock.text}
                  />
                </div>
                {mounted &&
                  clock.state === "waiting" &&
                  clock.startsAt !== null && (
                    <p
                      className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600"
                      suppressHydrationWarning
                    >
                      <Clock className="size-3 shrink-0" aria-hidden />
                      Resumes {formatOpeningLong(clock.startsAt, now)}
                    </p>
                  )}
                <div className="w-full h-1.5 bg-slate-200/70 rounded-full overflow-hidden">
                  <div
                    className={cn("h-full transition-all", style.bar)}
                    style={{ width: `${clock.usedPct}%` }}
                  />
                </div>
                <p
                  className="text-[11px] text-slate-400"
                  suppressHydrationWarning
                >
                  {/* Dates are in the viewer's time zone: browser only. */}
                  {mounted ? footnote : "\u00a0"}
                </p>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
