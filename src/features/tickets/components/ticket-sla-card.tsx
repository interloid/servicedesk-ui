"use client";

import { Clock, PauseCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useNow } from "@/hooks/use-now";
import {
  SlaClockState,
  computeSlaClock,
  headlineSlaEvent,
} from "@/features/tickets/lib/sla";
import {
  SlaEvent,
  TicketSlaPolicy,
} from "@/features/tickets/types/tickets.types";

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

/** Ticks every second only while a clock is actually running. */
function useSlaNow(events: SlaEvent[]): number {
  const running = events.some((e) => e.status === "pending" && !e.paused_at);
  return useNow(1000, running);
}

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
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap tabular-nums",
        style.badge,
        className,
      )}
    >
      {state === "paused" ? (
        <PauseCircle className="size-3 shrink-0" aria-hidden />
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
  warnBeforeMins,
}: {
  events: SlaEvent[];
  warnBeforeMins?: number;
}) {
  const now = useSlaNow(events);
  const ev = headlineSlaEvent(events);
  if (!ev) return null;
  const clock = computeSlaClock(ev, now, warnBeforeMins);
  return (
    <ClockBadge
      state={clock.state}
      text={`${LABELS[ev.type]} · ${clock.text}`}
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
}

export function TicketSlaCard({
  events,
  policy,
  updating,
}: TicketSlaCardProps) {
  const now = useSlaNow(events);

  const paused = events.some((e) => e.status === "pending" && e.paused_at);

  return (
    <Card className="shadow-sm border-slate-200 bg-white ring-0">
      <CardContent className="p-5 space-y-4 text-xs">
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
            const clock = computeSlaClock(ev, now, policy?.warn_before_mins);
            const style = BADGE[clock.state];
            const footnote =
              clock.state === "met" && ev.completed_at
                ? `Met ${formatClock(ev.completed_at)} · due ${formatClock(ev.due_at)}`
                : clock.state === "breached"
                  ? `Was due ${formatClock(ev.breached_at ?? ev.due_at)}`
                  : clock.state === "paused"
                    ? `Paused ${formatClock(ev.paused_at!)}`
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
                  <span className="text-xs font-medium text-slate-600">
                    {LABELS[ev.type]}
                  </span>
                  <ClockBadge state={clock.state} text={clock.text} />
                </div>
                <div className="w-full h-1.5 bg-slate-200/70 rounded-full overflow-hidden">
                  <div
                    className={cn("h-full transition-all", style.bar)}
                    style={{ width: `${clock.usedPct}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-400">{footnote}</p>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
