import type { TeamSeats, TeamStatusCounts } from "@/features/team/types/team";

/**
 * Warning colours for the badge and the note under the bar, so "nearly out of
 * seats" reads from across the room instead of only from the number.
 */
function seatTone(seats: TeamSeats) {
  const ratio = seats.limit > 0 ? seats.used / seats.limit : 0;

  if (seats.limit > 0 && ratio >= 1) {
    return {
      badge: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
      text: "text-red-600 dark:text-red-400",
    };
  }

  if (seats.limit > 0 && ratio >= 0.8) {
    return {
      badge:
        "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
      text: "text-amber-700 dark:text-amber-400",
    };
  }

  return {
    badge: "bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300",
    text: "text-muted-foreground",
  };
}

interface Segment {
  key: string;
  label: string;
  count: number;
  /** Colour of the bar segment and the matching legend dot. */
  fill: string;
}

interface SeatUsageProps {
  seats: TeamSeats;
  counts: TeamStatusCounts;
}

export function SeatUsage({ seats, counts }: SeatUsageProps) {
  const hasLimit = seats.limit > 0;
  const isFull = hasLimit && seats.seatsLeft === 0;
  const tone = seatTone(seats);

  // Without a limit there is no "free" part, so the bar is split across the
  // seats in use instead of across the plan.
  const scale = hasLimit ? Math.max(seats.limit, seats.used) : seats.used;

  // One bar split by what fills it: invites use a seat too, which a single
  // "7 of 100" fill never said. Disabled members don't, so they sit in the
  // legend only.
  const segments: Segment[] = [
    {
      key: "active",
      label: "Active",
      count: counts.Active,
      fill: isFull ? "bg-red-500" : "bg-teal-700 dark:bg-emerald-400",
    },
    {
      key: "invited",
      label: "Invited",
      count: counts.Invited,
      fill: "bg-amber-500 dark:bg-amber-400",
    },
  ];

  if (hasLimit) {
    segments.push({
      key: "free",
      label: "Free",
      count: seats.seatsLeft,
      fill: "bg-slate-200 dark:bg-slate-700",
    });
  }

  const summary = [
    `${counts.Active} active`,
    `${counts.Invited} invited`,
    hasLimit ? `${seats.seatsLeft} free` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-4 shadow-xs sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-bold">Team seats</span>
          <span className="text-sm text-muted-foreground tabular-nums">
            {hasLimit
              ? `${seats.used} of ${seats.limit} used`
              : `${seats.used} used`}
          </span>
        </div>
        {hasLimit && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap ${tone.badge}`}
          >
            {isFull ? "Full" : `${seats.seatsLeft} left`}
          </span>
        )}
      </div>

      <div
        role="img"
        aria-label={`Seats: ${summary}.`}
        className="flex h-3 gap-0.5 overflow-hidden rounded-full"
      >
        {scale > 0 &&
          segments
            .filter((segment) => segment.count > 0)
            .map((segment) => (
              <span
                key={segment.key}
                // A floor of 4px keeps one invite on a 100-seat plan visible.
                className={`h-full min-w-1 ${segment.fill}`}
                style={{ width: `${(segment.count / scale) * 100}%` }}
              />
            ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        {/* Two by two on a phone, one row from sm. */}
        <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:flex sm:flex-wrap sm:gap-x-5">
          {segments.map((segment) => (
            <li key={segment.key} className="flex items-center gap-2">
              <span
                className={`size-2.5 shrink-0 rounded-full ${segment.fill}`}
                aria-hidden
              />
              <span className="text-muted-foreground">{segment.label}</span>
              <span className="ml-auto font-semibold tabular-nums sm:ml-0">
                {segment.count}
              </span>
            </li>
          ))}
          <li
            className="flex items-center gap-2"
            title="Disabled members don't use a seat."
          >
            <span
              className="size-2.5 shrink-0 rounded-full border-[1.5px] border-slate-400 dark:border-slate-500"
              aria-hidden
            />
            <span className="text-muted-foreground">Disabled</span>
            <span className="ml-auto font-semibold tabular-nums sm:ml-0">
              {counts.Disabled}
            </span>
          </li>
        </ul>

        {(isFull || !hasLimit) && (
          <p className={`text-xs font-medium ${tone.text}`}>
            {isFull
              ? "No seats left - upgrade your plan or remove someone to invite more."
              : "Seat limits follow your plan."}
          </p>
        )}
      </div>
    </div>
  );
}
