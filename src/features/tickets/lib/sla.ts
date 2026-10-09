import { SlaEvent, Ticket } from "@/features/tickets/types/tickets.types";
import {
  SlaCalendar,
  nextWorkingStart,
  slaMsBetween,
  usableCalendar,
} from "@/features/tickets/lib/sla-calendar";

/**
 * Amber lead when a policy's own warning lead isn't known. Matches the
 * notify_before_mins column default.
 */
export const DEFAULT_SLA_WARN_MINS = 15;

/**
 * "2d 4h", "3h 12m", "8m"; seconds once under a minute. A day is `dayMins`
 * long: one working day on a business-hours policy, so 1440 working minutes
 * on a 08:00-16:00 calendar read as "3d", not "1d 0h".
 */
export function formatSlaDuration(ms: number, dayMins = 1440): string {
  const abs = Math.abs(ms);
  const minutes = Math.floor(abs / 60000);
  const days = Math.floor(minutes / dayMins);
  const hours = Math.floor((minutes % dayMins) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.max(0, Math.floor(abs / 1000))}s`;
}

export type SlaClockState =
  "running" | "warning" | "waiting" | "paused" | "breached" | "met";

export interface SlaClock {
  state: SlaClockState;
  /** ms to the deadline (negative once overdue); frozen while paused. */
  remainingMs: number;
  /** 0–100 of the target used, for the progress bar. */
  usedPct: number;
  /** Short text for the badge: "3h 12m left", "Breached", "Met in 40m". */
  text: string;
  /**
   * Set in the "waiting" state: the clock runs on business hours and it is
   * outside them, so nothing counts until this instant (the next opening).
   */
  startsAt: number | null;
}

/**
 * The live state of one SLA clock at `now`. The database owns transitions
 * (sla_tick marks breaches, the ticket triggers pause and finish); this only
 * animates between them, so an overdue clock reads as breached a few seconds
 * before the tick catches up.
 *
 * With the policy's calendar, a business-hours clock counts working time, as
 * the database does: time left, time used and "met in" leave out nights,
 * weekends and holidays, and a day is one working day (`dayMins`).
 */
export function computeSlaClock(
  ev: SlaEvent,
  now: number,
  warnBeforeMins: number = DEFAULT_SLA_WARN_MINS,
  calendar?: SlaCalendar | null,
  dayMins = 1440,
): SlaClock {
  const cal = ev.business_hours_id ? usableCalendar(calendar) : null;
  // Without the calendar a business clock can only be shown in wall time.
  const unitDay = cal ? dayMins : 1440;
  const fmt = (ms: number) => formatSlaDuration(ms, unitDay);
  const start = new Date(ev.started_at || ev.created_at).getTime();
  const due = new Date(ev.due_at).getTime();
  const targetMs =
    (ev.target_mins ?? Math.max(1, slaMsBetween(start, due, cal) / 60000)) *
    60000;

  if (ev.status === "completed") {
    const at = ev.completed_at ? new Date(ev.completed_at).getTime() : due;
    return {
      state: "met",
      remainingMs: due - at,
      usedPct: 100,
      text: ev.completed_at
        ? `Met in ${fmt(slaMsBetween(start, at, cal))}`
        : "Met",
      startsAt: null,
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
      text: "Breached",
      startsAt: null,
    };
  }

  if (ev.paused_at) {
    const leftMs = (ev.remaining_secs ?? 0) * 1000;
    return {
      state: "paused",
      remainingMs: leftMs,
      usedPct: pct(targetMs - leftMs, targetMs),
      text: `Paused · ${fmt(leftMs)} left`,
      startsAt: null,
    };
  }

  const wallLeftMs = due - now;
  if (wallLeftMs <= 0) {
    return {
      state: "breached",
      remainingMs: wallLeftMs,
      usedPct: 100,
      text: "Breached",
      startsAt: null,
    };
  }

  // Working time left, so the bar is the share of the target used -- which
  // stays right after a pause or a priority change moved due_at.
  const remainingMs = slaMsBetween(now, due, cal);
  const usedPct = pct(targetMs - remainingMs, targetMs);

  // Outside business hours nothing counts: a ticket opened at night waits for
  // the morning, and the card flips to a live countdown at opening on its own.
  const opensAt = nextWorkingStart(now, cal);
  if (opensAt !== null && opensAt > now) {
    const started = slaMsBetween(start, now, cal) > 0;
    return {
      state: "waiting",
      remainingMs,
      usedPct,
      text: `${started ? "Resumes" : "Starts"} ${formatOpening(opensAt, now)}`,
      startsAt: opensAt,
    };
  }

  return {
    // Amber on the wall-clock lead, as sla_tick sends its warning.
    state: wallLeftMs <= warnBeforeMins * 60000 ? "warning" : "running",
    remainingMs,
    usedPct,
    text: `${fmt(remainingMs)} left`,
    startsAt: null,
  };
}

/** "10:00 AM" today, "tomorrow 10:00 AM", otherwise "Mon 10:00 AM". */
export function formatOpening(at: number, now: number): string {
  const time = new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const day = (ms: number) => new Date(ms).toDateString();
  if (day(at) === day(now)) return time;
  if (day(at) === day(now + 86_400_000)) return `tomorrow ${time}`;
  return `${new Date(at).toLocaleDateString([], { weekday: "short" })} ${time}`;
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
  type: "warning" | "breached" | "normal" | "completed" | "paused" | "waiting";
  text: string;
};

/**
 * Recompute the list's SLA badge at `now` from the snapshot attachSlaInfo put
 * on the row, so the countdown ticks without a server round-trip.
 */
export function computeLiveSla(ticket: Ticket, now: number): LiveSla {
  const { sla_status, sla_due_at } = ticket;
  const cal = usableCalendar(ticket.sla_calendar);
  const dayMins = cal ? (ticket.sla_day_mins ?? 1440) : 1440;

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
      text: `Paused · ${formatSlaDuration((ticket.sla_remaining_secs ?? 0) * 1000, dayMins)}`,
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
      text: "Breached",
    };
  }

  const warnMs = (ticket.sla_warn_before_mins ?? DEFAULT_SLA_WARN_MINS) * 60000;
  const due = new Date(sla_due_at).getTime();

  // Outside business hours: the clock waits for the next opening.
  const opensAt = nextWorkingStart(now, cal);
  if (opensAt !== null && opensAt > now) {
    const start = ticket.sla_started_at
      ? new Date(ticket.sla_started_at).getTime()
      : now;
    const started = slaMsBetween(start, now, cal) > 0;
    return {
      type: "waiting",
      text: `${started ? "Resumes" : "Starts"} ${formatOpening(opensAt, now)}`,
    };
  }

  return {
    type: remaining <= warnMs ? "warning" : "normal",
    text: `${formatSlaDuration(slaMsBetween(now, due, cal), dayMins)} left`,
  };
}
