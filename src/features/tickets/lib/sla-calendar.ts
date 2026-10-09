/**
 * Business-time arithmetic for the SLA card's live countdown. Mirrors
 * sla_calendar / sla_day_windows / sla_seconds_between in
 * supabase/schemas/functions/17_sla_engine.sql, which own the real clock: this
 * only lets the card count the working time left between ticks, so "1 day"
 * on a business-hours policy reads as one working day rather than as the
 * weekend and nights in between.
 */

export interface SlaCalendarHoliday {
  /** YYYY-MM-DD in the calendar's timezone. */
  date: string;
  allDay: boolean;
  startTime?: string;
  endTime?: string;
  repeatsYearly: boolean;
}

export interface SlaCalendar {
  /** IANA zone, e.g. "Asia/Kolkata". */
  tz: string;
  /** English three-letter days, as schedule_json holds them. */
  workingDays: string[];
  /** HH:MM */
  dayStart: string;
  dayEnd: string;
  holidays: SlaCalendarHoliday[];
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The wall clock in `tz` at instant `at`, as if it were UTC. */
function zonedAsUtc(at: number, tz: string): number {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(tz).formatToParts(at)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}

/** The instant at local `day` + `time` in `tz`. */
function zonedInstant(day: string, time: string, tz: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes settle the offset either side of a DST change.
  let at = wall - (zonedAsUtc(wall, tz) - wall);
  at = wall - (zonedAsUtc(at, tz) - at);
  return at;
}

function localDay(at: number, tz: string): string {
  return new Date(zonedAsUtc(at, tz)).toISOString().slice(0, 10);
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** The working windows of one local date, as [start, end) instants. */
function dayWindows(cal: SlaCalendar, day: string): [number, number][] {
  const weekday = DAY_NAMES[new Date(`${day}T00:00:00Z`).getUTCDay()];
  if (!cal.workingDays.includes(weekday)) return [];

  let windows: [number, number][] = [
    [
      zonedInstant(day, cal.dayStart, cal.tz),
      zonedInstant(day, cal.dayEnd, cal.tz),
    ],
  ];

  for (const h of cal.holidays) {
    const hits =
      h.date === day || (h.repeatsYearly && h.date.slice(5) === day.slice(5));
    if (!hits) continue;
    if (h.allDay) return [];
    if (!h.startTime || !h.endTime) continue;
    const hs = zonedInstant(day, h.startTime, cal.tz);
    const he = zonedInstant(day, h.endTime, cal.tz);
    windows = windows.flatMap(([s, e]): [number, number][] => {
      if (he <= s || hs >= e) return [[s, e]];
      const out: [number, number][] = [];
      if (hs > s) out.push([s, hs]);
      if (he < e) out.push([he, e]);
      return out;
    });
  }
  return windows;
}

/** A usable calendar, or null to count wall-clock time (as sla_calendar). */
export function usableCalendar(
  cal: SlaCalendar | null | undefined,
): SlaCalendar | null {
  if (!cal || cal.workingDays.length === 0) return null;
  if (!/^\d{2}:\d{2}/.test(cal.dayStart) || !/^\d{2}:\d{2}/.test(cal.dayEnd))
    return null;
  if (cal.dayEnd.slice(0, 5) <= cal.dayStart.slice(0, 5)) return null;
  try {
    formatterFor(cal.tz);
  } catch {
    return null;
  }
  return cal;
}

/** SLA milliseconds in [from, to); wall-clock without a calendar. */
export function slaMsBetween(
  from: number,
  to: number,
  cal: SlaCalendar | null,
): number {
  if (to <= from) return 0;
  if (!cal) return to - from;

  const last = localDay(to, cal.tz);
  let total = 0;
  // Capped like the SQL guard: past it the calendar has next to no time.
  for (
    let day = localDay(from, cal.tz), guard = 0;
    day <= last && guard < 4000;
    day = nextDay(day), guard++
  ) {
    for (const [s, e] of dayWindows(cal, day)) {
      const lo = Math.max(s, from);
      const hi = Math.min(e, to);
      if (hi > lo) total += hi - lo;
    }
  }
  return total;
}

/** True when `at` falls inside a working window. */
export function isWorkingTime(at: number, cal: SlaCalendar | null): boolean {
  if (!cal) return true;
  return dayWindows(cal, localDay(at, cal.tz)).some(
    ([s, e]) => at >= s && at < e,
  );
}

/**
 * The first working instant at or after `at`: `at` itself inside a window,
 * otherwise the start of the next one. Null without a calendar (24/7 never
 * waits) or when none is found within the guard.
 */
export function nextWorkingStart(
  at: number,
  cal: SlaCalendar | null,
): number | null {
  if (!cal) return null;
  for (
    let day = localDay(at, cal.tz), guard = 0;
    guard < 4000;
    day = nextDay(day), guard++
  ) {
    for (const [s, e] of dayWindows(cal, day)) {
      if (e > at) return Math.max(s, at);
    }
  }
  return null;
}
