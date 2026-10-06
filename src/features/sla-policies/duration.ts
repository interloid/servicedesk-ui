/**
 * Durations for SLA targets. The editor takes a whole number and a unit
 * ("4" + "hours"); the database stores minutes. Every minutes ↔ text
 * conversion in the feature lives here.
 */

export type DurationUnit = "minutes" | "hours" | "days";

export const UNIT_MINS: Record<DurationUnit, number> = {
  minutes: 1,
  hours: 60,
  days: 1440,
};

export const MAX_DURATION_MINS = 365 * UNIT_MINS.days;

export type DurationInput = { amount: string; unit: DurationUnit };

/** The largest unit that represents `mins` exactly: 240 → 4 hours. */
export function toDurationInput(mins: number): DurationInput {
  if (mins > 0 && mins % UNIT_MINS.days === 0) {
    return { amount: String(mins / UNIT_MINS.days), unit: "days" };
  }
  if (mins > 0 && mins % UNIT_MINS.hours === 0) {
    return { amount: String(mins / UNIT_MINS.hours), unit: "hours" };
  }
  return { amount: String(mins), unit: "minutes" };
}

/** Null for anything that isn't a positive whole number within a year. */
export function toMinutes({ amount, unit }: DurationInput): number | null {
  if (!/^\d+$/.test(amount.trim())) return null;
  const mins = Number(amount) * UNIT_MINS[unit];
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

/** Compact form for the list and descriptions: "20m", "4h", "2d". */
export function formatDurationShort(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) {
    return "—";
  }

  if (mins % UNIT_MINS.days === 0) return `${mins / UNIT_MINS.days}d`;
  if (mins % UNIT_MINS.hours === 0) return `${mins / UNIT_MINS.hours}h`;
  if (mins >= UNIT_MINS.hours) {
    return `${Math.round((mins / UNIT_MINS.hours) * 10) / 10}h`;
  }

  return `${mins}m`;
}
