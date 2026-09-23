import { Info, Mail, UserRoundX, Users, type LucideIcon } from "lucide-react";

import { Progress } from "@/components/ui/progress";

import type {
  TeamSeats,
  TeamStatus,
  TeamStatusCounts,
} from "@/features/team/types/team";

const STATUS_CARDS: {
  status: TeamStatus;
  label: string;
  caption: string;
  icon: LucideIcon;
  tone: string;
  chipTone: string;
  iconTone: string;
}[] = [
  {
    status: "Active",
    label: "Active",
    caption: "Members with access",
    icon: Users,
    tone: "border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/30",
    chipTone: "bg-emerald-100 dark:bg-emerald-900/50",
    iconTone: "text-emerald-700 dark:text-emerald-300",
  },
  {
    status: "Invited",
    label: "Invited",
    caption: "Pending acceptance",
    icon: Mail,
    tone: "border-amber-200/80 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/30",
    chipTone: "bg-amber-100 dark:bg-amber-900/50",
    iconTone: "text-amber-700 dark:text-amber-300",
  },
  {
    status: "Disabled",
    label: "Disabled",
    caption: "No access",
    icon: UserRoundX,
    tone: "border-border bg-muted/40",
    chipTone: "bg-muted",
    iconTone: "text-muted-foreground",
  },
];

/**
 * The bar changes colour as the plan fills up, so "nearly out of seats" reads
 * from across the room instead of only from the number beside it.
 */
function seatTone(seats: TeamSeats) {
  if (seats.limit <= 0) {
    return {
      bar: "[&>div]:bg-teal-700",
      text: "text-muted-foreground",
      badge: "bg-muted text-muted-foreground",
    };
  }

  const ratio = seats.used / seats.limit;

  if (ratio >= 1) {
    return {
      bar: "[&>div]:bg-red-500",
      text: "text-red-600 dark:text-red-400",
      badge: "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300",
    };
  }

  if (ratio >= 0.8) {
    return {
      bar: "[&>div]:bg-amber-500",
      text: "text-amber-700 dark:text-amber-400",
      badge:
        "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
    };
  }

  return {
    bar: "[&>div]:bg-teal-700",
    text: "text-muted-foreground",
    badge: "bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300",
  };
}

interface SeatUsageProps {
  seats: TeamSeats;
  counts: TeamStatusCounts;
}

export function SeatUsage({ seats, counts }: SeatUsageProps) {
  const percentage =
    seats.limit > 0 ? Math.min((seats.used / seats.limit) * 100, 100) : 100;
  const tone = seatTone(seats);
  const isFull = seats.limit > 0 && seats.seatsLeft === 0;

  return (
    <div className="flex flex-col gap-5 xl:flex-row xl:items-stretch xl:gap-6">
      <div className="flex min-w-0 flex-1 items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
              Team seats
            </span>
          </div>

          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl leading-none font-bold tracking-tight">
              {seats.used}
            </span>
            <span className="text-sm font-medium text-muted-foreground">
              {seats.limit > 0 ? `of ${seats.limit} seats used` : "seats used"}
            </span>
          </div>

          <Progress
            value={percentage}
            aria-label="Seats used"
            className={`h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 [&>div]:rounded-full ${tone.bar}`}
          />

          <p className={`text-xs font-medium ${tone.text}`}>
            {seats.limit <= 0
              ? "Seat limits follow your plan."
              : isFull
                ? "No seats left — upgrade your plan to invite more."
                : `${seats.seatsLeft} seat${seats.seatsLeft === 1 ? "" : "s"} available`}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2.5 xl:max-w-2xl xl:flex-1 xl:border-l xl:border-border xl:pl-6">
        {/* Three across, except on a phone: at 425px each card got ~120px,
            which wrapped "5 Active" onto two lines. 480px is the first width
            where all three fit on one line. */}
        <div className="grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-3">
          {STATUS_CARDS.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.status}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${card.tone}`}
              >
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full ${card.chipTone}`}
                >
                  <Icon className={`size-4.5 ${card.iconTone}`} aria-hidden />
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-bold">
                    {counts[card.status]} {card.label}
                  </span>
                  <span className="text-xs leading-snug text-muted-foreground">
                    {card.caption}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0" aria-hidden />
          Pending invitations count toward your seat limit.
        </p>
      </div>
    </div>
  );
}
