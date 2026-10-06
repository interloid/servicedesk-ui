/**
 * Durations as prose: "20 minutes", "4 hours", "2 business days".
 *
 * The editor used to take raw minutes, which meant `first_response_business`
 * and `resolution_business` — columns that exist precisely so the editor can
 * round-trip the word "business" — were never written. The stored minutes are
 * the nominal value (a day is 1440), and the flag records that the target was
 * *expressed* in business time. Nothing yet honours business hours when the
 * clock runs; see the note on sla_policy_targets.
 */
export type Duration = {
  mins: number;
  business: boolean;
};

const MINUTE = 1;
const HOUR = 60;
const DAY = 1440;

const UNITS: { names: string[]; mins: number }[] = [
  { names: ["minute", "minutes", "min", "mins", "m"], mins: MINUTE },
  { names: ["hour", "hours", "hr", "hrs", "h"], mins: HOUR },
  { names: ["day", "days", "d"], mins: DAY },
];

export const MAX_DURATION_MINS = 365 * DAY;

/**
 * Parse what somebody typed. Returns null for anything unrecognised rather than
 * guessing — a silent fallback here would write a target nobody agreed to.
 */
export function parseDuration(input: string): Duration | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ");

  if (!text) {
    return null;
  }

  // "2 business days" | "2business days" | "4 hours"
  const match = /^(\d+(?:\.\d+)?)\s*(business\s+|working\s+)?([a-z]+)$/.exec(
    text,
  );

  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const business = Boolean(match[2]);
  const unitName = match[3];

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unit = UNITS.find((candidate) => candidate.names.includes(unitName));

  if (!unit) {
    return null;
  }

  // "business minutes" is not a thing anybody means.
  if (business && unit.mins === MINUTE) {
    return null;
  }

  const mins = Math.round(amount * unit.mins);

  if (mins <= 0 || mins > MAX_DURATION_MINS) {
    return null;
  }

  return { mins, business };
}

function plural(value: number, word: string): string {
  return `${value} ${word}${value === 1 ? "" : "s"}`;
}

/** The inverse of parseDuration, so the field reads back what was meant. */
export function formatDuration(mins: number, business = false): string {
  if (!Number.isFinite(mins) || mins <= 0) {
    return "";
  }

  const qualifier = business ? "business " : "";

  if (mins % DAY === 0 && mins >= DAY) {
    return `${mins / DAY} ${qualifier}day${mins / DAY === 1 ? "" : "s"}`;
  }

  if (mins % HOUR === 0 && mins >= HOUR) {
    return `${mins / HOUR} ${qualifier}hour${mins / HOUR === 1 ? "" : "s"}`;
  }

  // Business time is only meaningful in hours and days; a leftover value falls
  // back to plain minutes rather than inventing "business minutes".
  return plural(mins, "minute");
}

/** Compact form for the preview strip: "20m", "4h", "2d". */
export function formatDurationShort(mins: number): string {
  if (!Number.isFinite(mins) || mins <= 0) {
    return "—";
  }

  if (mins % DAY === 0 && mins >= DAY) return `${mins / DAY}d`;
  if (mins % HOUR === 0 && mins >= HOUR) return `${mins / HOUR}h`;
  if (mins >= HOUR) return `${Math.round((mins / HOUR) * 10) / 10}h`;

  return `${mins}m`;
}
