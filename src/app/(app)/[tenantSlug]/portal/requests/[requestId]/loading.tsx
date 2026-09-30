import { Skeleton } from "@/components/ui/skeleton";
import {
  PORTAL_CARD_SHADOW,
  PortalBackLinkSkeleton,
  PortalContentSkeleton,
  PortalMessageSkeleton,
  PortalStateBadgeSkeleton,
} from "@/features/portal/components/portal-skeletons";
import { cn } from "@/lib/utils";

/**
 * Without this file Next.js has no fallback for the async page beside it, so a
 * click leaves the previous screen up until every query has finished — which
 * reads as a dead link and gets clicked again.
 *
 * Mirrors PortalRequestDetailView: flat above, one card below. The thread is
 * bare page with hairlines, so no outlined boxes are drawn up there — a
 * skeleton box would flash chrome the real page never paints. The reply form
 * is the one card, and the textarea inside it is a real control, so both keep
 * their outlines. The number and state badges are filled chips, drawn as bars.
 *
 * The CSAT prompt is deliberately absent: the real page only shows it once
 * request.csat.resolvedAt is set, and a skeleton cannot know that. Drawing one
 * would either flash a card that should not be there or, worse, hide the
 * surprise when a satisfied customer lands on the form to rate the fix.
 */

const RULE = "h-px w-full bg-slate-200/80";

const CARD = cn("rounded-2xl border bg-card p-5 sm:p-6", PORTAL_CARD_SHADOW);

const MESSAGES = [
  { fromTeam: false, lines: ["w-full", "w-3/4"], author: "w-32" },
  {
    fromTeam: true,
    lines: ["w-full", "w-11/12", "w-2/3"],
    author: "w-28",
  },
];

export default function Loading() {
  return (
    <PortalContentSkeleton width="max-w-4xl">
      <PortalBackLinkSkeleton />

      <section className="mt-4">
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-6 w-9 rounded-md bg-slate-200/80" />
            <PortalStateBadgeSkeleton />
          </div>

          <div className="flex flex-wrap gap-x-3 gap-y-1.5 sm:flex-col sm:items-end">
            <Skeleton className="h-3 w-32 bg-slate-200/80" />
            <Skeleton className="h-3 w-36 bg-slate-200/80" />
          </div>
        </div>

        <Skeleton className="mt-3 h-8 w-3/5 bg-slate-300/70" />

        <div className={cn(RULE, "mt-6")} />

        <div className="mt-6 flex flex-col divide-y divide-slate-200/80">
          {MESSAGES.map((message, index) => (
            <PortalMessageSkeleton
              key={index}
              fromTeam={message.fromTeam}
              lineWidths={message.lines}
              authorWidth={message.author}
            />
          ))}
        </div>
      </section>

      <section className={cn(CARD, "mt-8")}>
        {/* gap-1.5 and the lock icon, to match the real row: the heading and the
            "only you and the team can see this" note are a tight pair. */}
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <Skeleton className="h-5 w-44 bg-slate-300/70" />
          <div className="flex items-center gap-1.5">
            <Skeleton className="size-3.5 shrink-0 rounded-full bg-slate-200/80" />
            <Skeleton className="h-3 w-60 max-w-full bg-slate-200/80" />
          </div>
        </div>

        {/* A real outlined textarea, not a grey bar: it is a control, and inside
            the card it reads as a field recessed into it. */}
        <div className="mt-3 min-h-28 rounded-xl border bg-background/60" />

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-28 rounded-lg border bg-card" />
            <Skeleton className="h-3 w-32 bg-slate-200/80" />
          </div>

          <Skeleton className="h-11 w-full rounded-lg bg-slate-300/70 sm:w-36" />
        </div>
      </section>
    </PortalContentSkeleton>
  );
}
