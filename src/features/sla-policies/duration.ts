/**
 * Durations for SLA targets. The editor takes a whole number and a unit
 * ("4" + "hours"); the database stores the unit and the minutes the clock
 * counts. On a business-hours policy a day is one working day of its calendar
 * (10:00–19:00 → 540 minutes), on a 24/7 policy 1440. Every minutes ↔ text
 * conversion in the feature lives here.
 */

export type DurationUnit = "minutes" | "hours" | "days";

export const UNIT_MINS: Record<DurationUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
};

export const MAX_DURATION_MINS = 365 * UNIT_MINS.days;

export const DURATION_UNITS: DurationUnit[] = ["minutes", "hours", "days"];

export type DurationInput = { amount: string; unit: DurationUnit };

const HH_MM = /^(\d{2}):(\d{2})/;

function clockMins(time: string | null | undefined): number | null {
  const match = time ? HH_MM.exec(time) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Minutes in one SLA day: the calendar's working day (dayEnd − dayStart) for
 * a business-hours policy, 1440 for 24/7 or a calendar without usable hours
 * (the clock then runs on wall time). Same as sla_schedule_day_mins() in SQL.
 */
export function slaDayMins(
  calendar: { dayStart: string | null; dayEnd: string | null } | null,
): number {
  const start = clockMins(calendar?.dayStart);
  const end = clockMins(calendar?.dayEnd);
  return start !== null && end !== null && end > start
    ? end - start
    : UNIT_MINS.days;
}

/** Minutes in one `unit`, with a day `dayMins` long. */
export function unitMins(unit: DurationUnit, dayMins = UNIT_MINS.days): number {
  return unit === "days" ? dayMins : UNIT_MINS[unit];
}

/**
 * `mins` as the editor shows it: in `unit` when it divides evenly, otherwise
 * (or with no stored unit) the largest unit that represents it exactly:
 * 240 → 4 hours.
 */
export function toDurationInput(
  mins: number,
  unit?: DurationUnit | null,
  dayMins = UNIT_MINS.days,
): DurationInput {
  if (unit && mins > 0 && mins % unitMins(unit, dayMins) === 0) {
    return { amount: String(mins / unitMins(unit, dayMins)), unit };
  }
  if (mins > 0 && mins % dayMins === 0) {
    return { amount: String(mins / dayMins), unit: "days" };
  }
  if (mins > 0 && mins % UNIT_MINS.hours === 0) {
    return { amount: String(mins / UNIT_MINS.hours), unit: "hours" };
  }
  return { amount: String(mins), unit: "minutes" };
}

/**
 * The minutes the clock counts, with a day `dayMins` long. Null for anything
 * that isn't a positive whole number within a year.
 */
export function toMinutes(
  { amount, unit }: DurationInput,
  dayMins = UNIT_MINS.days,
): number | null {
  if (!/^\d+$/.test(amount.trim())) return null;
  const mins = Number(amount) * unitMins(unit, dayMins);
  return mins > 0 && mins <= MAX_DURATION_MINS ? mins : null;
}

/** True for a whole number of minutes the editor could have produced. */
export function isValidDurationMins(mins: unknown): mins is number {
  return (
    typeof mins === "number" &&
    Number.isInteger(mins) &&
    mins > 0 &&
    mins <= MAX_DURATION_MINS
  );
}

export function isDurationUnit(unit: unknown): unit is DurationUnit {
  return DURATION_UNITS.includes(unit as DurationUnit);
}

/**
 * Compact form for the list and descriptions: "20m", "4h", "2d". A stored
 * "days" unit counts days of `dayMins`, so 1080 on a 9-hour calendar is "2d".
 */
export function formatDurationShort(
  mins: number,
  unit?: DurationUnit | null,
  dayMins = UNIT_MINS.days,
): string {
  if (!Number.isFinite(mins) || mins <= 0) {
    return "—";
  }

  if (unit === "days" && mins % dayMins === 0) return `${mins / dayMins}d`;
  if (!unit && mins % UNIT_MINS.days === 0) return `${mins / UNIT_MINS.days}d`;
  if (mins % UNIT_MINS.hours === 0) return `${mins / UNIT_MINS.hours}h`;
  if (mins >= UNIT_MINS.hours) {
    return `${Math.round((mins / UNIT_MINS.hours) * 10) / 10}h`;
  }

  return `${mins}m`;
}
