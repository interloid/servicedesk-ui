import { BusinessHoursOption, SlaHoliday, WEEK_DAYS } from "./types/types";

/**
 * Display helpers shared by the list (a Server Component) and the editor (a
 * Client Component). A fixed locale and timezone, so the server-rendered HTML
 * and the browser's hydration produce the same text.
 */
const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

/** "Mon – Fri" for a contiguous run, otherwise "Mon, Wed, Fri". */
export function formatWorkingDays(days: string[]): string {
  const sorted = WEEK_DAYS.filter((d) => days.includes(d));
  if (sorted.length === 0) return "No working days";
  if (sorted.length === 7) return "Every day";

  const first = WEEK_DAYS.indexOf(sorted[0]);
  const contiguous = sorted.every((d, i) => WEEK_DAYS.indexOf(d) === first + i);

  return contiguous && sorted.length > 2
    ? `${sorted[0]} – ${sorted[sorted.length - 1]}`
    : sorted.join(", ");
}

/** "09:00 – 18:00". */
export function formatWorkingHours(hours: BusinessHoursOption): string {
  if (!hours.dayStart || !hours.dayEnd) return "Not set";
  return `${hours.dayStart} – ${hours.dayEnd}`;
}

/** "Jan 1, 2027". The date is a calendar day, so it is read as UTC. */
export function formatHolidayDate(h: SlaHoliday): string {
  const [y, m, d] = h.date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    ...DATE_FORMAT,
    timeZone: "UTC",
  });
}

/** "Oct 6, 2026" for a timestamp, or "—" when it can't be read. */
export function formatUpdatedDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-US", { ...DATE_FORMAT, timeZone: "UTC" });
}
