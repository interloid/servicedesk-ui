import { slaDayMins } from "@/features/sla-policies/duration";
import { SlaCalendar, usableCalendar } from "./sla-calendar";

/**
 * Reading a policy's business-hours calendar out of a PostgREST embed. Shared
 * by the agent tickets service and the portal, so both parse it the same way.
 */

/** A policy's calendar, embedded from sla_policies. */
export const CALENDAR_SELECT =
  "business_hours(name, schedule_json, holidays_json, timezones(code))";

type CalendarRow = {
  name: string;
  schedule_json: unknown;
  holidays_json: unknown;
  timezones: { code: string } | { code: string }[] | null;
};
export type CalendarJoin = CalendarRow | CalendarRow[] | null;

/** A many-to-one embed, which PostgREST may hand back as one row or a list. */
export const one = <T>(v: T | T[] | null | undefined): T | null =>
  (Array.isArray(v) ? v[0] : v) ?? null;

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

const asTime = (v: unknown): string | null =>
  typeof v === "string" && /^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : null;

/**
 * The calendar the SLA engine counts (sla_calendar in SQL), parsed for the
 * client's countdown, and the minutes in one of its days. Null and 1440 for a
 * 24/7 policy or a calendar the engine would not use either.
 */
export function toSlaCalendar(join: CalendarJoin): {
  calendar: SlaCalendar | null;
  dayMins: number;
} {
  const row = one(join);
  if (!row) return { calendar: null, dayMins: 1440 };
  const schedule = asRecord(row.schedule_json);
  const dayStart = asTime(schedule.day_start);
  const dayEnd = asTime(schedule.day_end);
  const calendar = usableCalendar({
    tz: one(row.timezones)?.code ?? "",
    workingDays: Array.isArray(schedule.working_days)
      ? schedule.working_days.filter((d): d is string => typeof d === "string")
      : [],
    dayStart: dayStart ?? "",
    dayEnd: dayEnd ?? "",
    holidays: (Array.isArray(row.holidays_json) ? row.holidays_json : [])
      .map(asRecord)
      .filter(
        (h): h is Record<string, unknown> & { date: string } =>
          typeof h.date === "string",
      )
      .map((h) => ({
        date: h.date,
        allDay: h.all_day !== false,
        startTime: asTime(h.start_time) ?? undefined,
        endTime: asTime(h.end_time) ?? undefined,
        repeatsYearly: h.repeats_yearly === true,
      })),
  });
  return {
    calendar,
    dayMins: calendar ? slaDayMins({ dayStart, dayEnd }) : 1440,
  };
}
