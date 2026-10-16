import type { SlaHoliday } from "@/features/sla-policies/types/types";

/** A business-hours calendar, resolved to what the minute counting needs. */
export interface WorkCalendar {
  timeZone: string;
  /** "Mon".."Sun". */
  workingDays: string[];
  /** HH:MM, local to the calendar's timezone. */
  dayStart: string;
  dayEnd: string;
  holidays: SlaHoliday[];
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 24 * 60 * 60 * 1000;
/** Stops a bad calendar (no working days) from walking forever. */
const MAX_DAYS = 400;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock fields of `ms` in `timeZone`. */
function zonedParts(ms: number, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(ms)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return parts as Record<
    "year" | "month" | "day" | "hour" | "minute" | "second",
    number
  >;
}

/**
 * The calendar date `ms` falls on in `timeZone`, as UTC midnight of that date.
 * Day arithmetic and labels on the result can then use plain UTC methods.
 */
export function zonedDay(ms: number, timeZone: string): Date {
  const p = zonedParts(ms, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day));
}

function offsetMs(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant a local date (UTC midnight from zonedDay) + "HH:MM" names. */
export function zonedInstant(
  day: Date,
  time: string,
  timeZone: string,
): number {
  const [h, m] = time.split(":").map(Number);
  const guess = day.getTime() + (h * 60 + m) * 60000;
  const first = guess - offsetMs(guess, timeZone);
  // Second pass settles days where the offset changes (DST).
  return guess - offsetMs(first, timeZone);
}

function isoDate(day: Date): string {
  return day.toISOString().slice(0, 10);
}

/** Working windows of one local day, as [start, end) instants. */
function dayWindows(day: Date, cal: WorkCalendar): [number, number][] {
  if (!cal.workingDays.includes(WEEKDAY[day.getUTCDay()])) return [];

  const date = isoDate(day);
  const holidays = cal.holidays.filter((h) =>
    h.repeatsYearly ? h.date.slice(5) === date.slice(5) : h.date === date,
  );
  if (holidays.some((h) => h.allDay)) return [];

  let windows: [number, number][] = [
    [
      zonedInstant(day, cal.dayStart, cal.timeZone),
      zonedInstant(day, cal.dayEnd, cal.timeZone),
    ],
  ];

  // Part-day holidays cut a hole out of the working window.
  for (const h of holidays) {
    if (!h.startTime || !h.endTime) continue;
    const cutStart = zonedInstant(day, h.startTime, cal.timeZone);
    const cutEnd = zonedInstant(day, h.endTime, cal.timeZone);
    windows = windows.flatMap(([s, e]) => {
      const kept: [number, number][] = [];
      if (cutStart > s) kept.push([s, Math.min(e, cutStart)]);
      if (cutEnd < e) kept.push([Math.max(s, cutEnd), e]);
      return kept.filter(([a, b]) => b > a);
    });
  }

  return windows;
}

/** Minutes between two instants that fall inside the calendar's hours. */
export function businessMinutesBetween(
  fromIso: string,
  toIso: string,
  cal: WorkCalendar,
): number {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!(to > from)) return 0;

  let total = 0;
  let day = zonedDay(from, cal.timeZone);
  const lastDay = zonedDay(to, cal.timeZone).getTime();

  for (let i = 0; i < MAX_DAYS && day.getTime() <= lastDay; i++) {
    for (const [s, e] of dayWindows(day, cal)) {
      const overlap = Math.min(e, to) - Math.max(s, from);
      if (overlap > 0) total += overlap;
    }
    day = new Date(day.getTime() + DAY_MS);
  }

  return total / 60000;
}
