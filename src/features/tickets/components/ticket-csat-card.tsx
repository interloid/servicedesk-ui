import { Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  TicketCsat,
  TicketStatus,
} from "@/features/tickets/types/tickets.types";

const SCORE_LABELS: Record<number, string> = {
  1: "Very poor",
  2: "Not great",
  3: "Okay",
  4: "Good",
  5: "Excellent",
};

function Stars({ score, size = "md" }: { score: number; size?: "sm" | "md" }) {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      role="img"
      aria-label={`${score} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn(
            size === "sm" ? "size-3" : "size-4",
            n <= score ? "fill-amber-400 text-amber-400" : "text-slate-300",
          )}
        />
      ))}
    </span>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface TicketCsatCardProps {
  ratings: TicketCsat[];
  status: TicketStatus;
  /** The current resolution; its rating is the headline one. */
  resolvedAt: string | null;
}

/**
 * The requester's rating. The portal asks once per resolution (csat_ratings
 * is unique per ticket + resolved_at), so a reopened and re-resolved ticket
 * can carry several; the current resolution's is shown first.
 */
export function TicketCsatCard({
  ratings,
  status,
  resolvedAt,
}: TicketCsatCardProps) {
  const current = resolvedAt
    ? ratings.find(
        (r) =>
          new Date(r.resolved_at).getTime() === new Date(resolvedAt).getTime(),
      )
    : undefined;
  const earlier = ratings.filter((r) => r !== current);

  return (
    <Card className="shadow-sm border-slate-200 bg-white ring-0">
      <CardContent className="p-5 space-y-3 text-xs">
        <h4 className="font-bold uppercase tracking-wider text-[11px] text-slate-400">
          Customer satisfaction
        </h4>

        {current ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Stars score={current.score} />
              <span className="font-semibold text-slate-800">
                {SCORE_LABELS[current.score]}
              </span>
            </div>
            {current.comment && (
              <p className="border-l-2 border-slate-200 pl-3 text-slate-600 whitespace-pre-line wrap-break-word">
                {current.comment}
              </p>
            )}
            <p className="text-[11px] text-slate-400">
              Rated {formatDay(current.created_at)}
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-slate-400">
            {status === "resolved"
              ? "Waiting for the customer to rate this resolution on the portal."
              : status === "closed" && resolvedAt
                ? "The customer didn't rate this resolution."
                : "The customer is asked for a rating when the ticket is resolved."}
          </p>
        )}

        {earlier.length > 0 && (
          <div className="space-y-1.5 border-t border-slate-100 pt-3">
            <p className="text-[11px] font-semibold text-slate-500">
              Earlier resolutions
            </p>
            {earlier.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2"
              >
                <Stars score={r.score} size="sm" />
                <span className="text-[11px] text-slate-400">
                  {formatDay(r.resolved_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
