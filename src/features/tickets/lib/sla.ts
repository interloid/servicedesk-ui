import { SlaEvent, Ticket } from "@/features/tickets/types/tickets.types";

/**
 * Amber lead when a policy's own warning lead isn't known. Matches the
 * notify_before_mins column default.
 */
export const DEFAULT_SLA_WARN_MINS = 15;

/** "2d 4h", "3h 12m", "8m"; seconds once under a minute. */
export function formatSlaDuration(ms: number): string {
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.max(0, Math.floor(abs / 1000))}s`;
}

export type SlaClockState =
  "running" | "warning" | "paused" | "breached" | "met";

export interface SlaClock {
  state: SlaClockState;
  /** ms to the deadline (negative once overdue); frozen while paused. */
  remainingMs: number;
  /** 0–100 of the target used, for the progress bar. */
  usedPct: number;
  /** Short text for the badge: "3h 12m left", "Overdue by 8m", "Met in 40m". */
  text: string;
}

/**
 * The live state of one SLA clock at `now`. The database owns transitions
 * (sla_tick marks breaches, the ticket triggers pause and finish); this only
 * animates between them, so an overdue clock reads as breached a few seconds
 * before the tick catches up.
 */
export function computeSlaClock(
  ev: SlaEvent,
  now: number,
  warnBeforeMins: number = DEFAULT_SLA_WARN_MINS,
): SlaClock {
  const start = new Date(ev.started_at || ev.created_at).getTime();
  const due = new Date(ev.due_at).getTime();
  const targetMs =
    (ev.target_mins ?? Math.max(1, (due - start) / 60000)) * 60000;

  if (ev.status === "completed") {
    const at = ev.completed_at ? new Date(ev.completed_at).getTime() : due;
    return {
      state: "met",
      remainingMs: due - at,
      usedPct: 100,
      text: ev.completed_at ? `Met in ${formatSlaDuration(at - start)}` : "Met",
    };
  }

  if (ev.status === "breached") {
    // Still running past the deadline if the ticket hasn't been finished yet.
    const finishedAt = ev.completed_at
      ? new Date(ev.completed_at).getTime()
      : now;
    return {
      state: "breached",
      remainingMs: due - finishedAt,
      usedPct: 100,
      text: `Overdue by ${formatSlaDuration(finishedAt - due)}`,
    };
  }

  if (ev.paused_at) {
    const leftMs = (ev.remaining_secs ?? 0) * 1000;
    return {
      state: "paused",
      remainingMs: leftMs,
      usedPct: pct(targetMs - leftMs, targetMs),
      text: `Paused · ${formatSlaDuration(leftMs)} left`,
    };
  }

  const remainingMs = due - now;
  if (remainingMs <= 0) {
    return {
      state: "breached",
      remainingMs,
      usedPct: 100,
      text: `Overdue by ${formatSlaDuration(remainingMs)}`,
    };
  }

  // Business-hours clocks have a due_at further out than their target, so the
  // bar is the share of wall time between start and deadline.
  const usedPct = pct(now - start, due - start);
  return {
    state: remainingMs <= warnBeforeMins * 60000 ? "warning" : "running",
    remainingMs,
    usedPct,
    text: `${formatSlaDuration(remainingMs)} left`,
  };
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

/** The clock that matters most right now: running first, then the latest. */
export function headlineSlaEvent(events: SlaEvent[]): SlaEvent | undefined {
  return (
    events.find((e) => e.status === "pending" && !e.paused_at) ||
    events.find((e) => e.status === "pending") ||
    events.find((e) => e.status === "breached") ||
    events[events.length - 1]
  );
}

export type LiveSla = {
  type: "warning" | "breached" | "normal" | "completed" | "paused";
  text: string;
};

/**
 * Recompute the list's SLA badge at `now` from the snapshot attachSlaInfo put
 * on the row, so the countdown ticks without a server round-trip.
 */
export function computeLiveSla(ticket: Ticket, now: number): LiveSla {
  const { sla_status, sla_due_at } = ticket;

  if (ticket.status === "resolved" || ticket.status === "closed") {
    return {
      type:
        sla_status === "completed"
          ? "completed"
          : ticket.sla_type === "paused"
            ? "normal"
            : ticket.sla_type,
      text: ticket.sla_text,
    };
  }

  if (sla_status === "completed") {
    return { type: "completed", text: ticket.sla_text };
  }

  if (ticket.sla_paused) {
    return {
      type: "paused",
      text: `Paused · ${formatSlaDuration((ticket.sla_remaining_secs ?? 0) * 1000)}`,
    };
  }

  if (!sla_due_at || (sla_status !== "pending" && sla_status !== "breached")) {
    return {
      type: ticket.sla_type === "paused" ? "normal" : ticket.sla_type,
      text: ticket.sla_text,
    };
  }

  const remaining = new Date(sla_due_at).getTime() - now;

  if (sla_status === "breached" || remaining <= 0) {
    return {
      type: "breached",
      text: `Overdue by ${formatSlaDuration(remaining)}`,
    };
  }

  const warnMs = (ticket.sla_warn_before_mins ?? DEFAULT_SLA_WARN_MINS) * 60000;
  return {
    type: remaining <= warnMs ? "warning" : "normal",
    text: `${formatSlaDuration(remaining)} left`,
  };
}
