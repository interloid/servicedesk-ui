/**
 * Display helpers shared by the agent-side tables (team, customers). One copy,
 * so a fix to how a name or a time reads lands everywhere it is drawn.
 */

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/**
 * "2 days ago", or null when there is no usable timestamp.
 *
 * Rounds to whole units and stops at minutes, so the server render and the
 * client hydration agree: anything finer would tick over between the two and
 * React would report a text mismatch. Pass the server's `now` for the same
 * reason.
 */
export function formatRelativeTime(
  iso: string | null,
  now: number = Date.now(),
): string | null {
  if (!iso) {
    return null;
  }

  const then = Date.parse(iso);

  if (Number.isNaN(then)) {
    return null;
  }

  const elapsed = now - then;

  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= size) {
      return RELATIVE.format(-Math.round(elapsed / size), unit);
    }
  }

  return "just now";
}

/** Up to two initials from the name, else the email's first letter, else "?". */
export function getInitials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length > 0) {
    return parts
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }

  return email.charAt(0).toUpperCase() || "?";
}
