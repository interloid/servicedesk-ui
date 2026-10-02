import { Skeleton } from "@/components/ui/skeleton";
import {
  PORTAL_CARD_SHADOW,
  PortalBackLinkSkeleton,
  PortalMessageSkeleton,
  PortalStateBadgeSkeleton,
} from "@/features/portal/components/portal-skeletons";
import { cn } from "@/lib/utils";

/**
 * Without this file Next.js has no fallback for the async page beside it, so a
 * click leaves the previous screen up until every query has finished — which
 * reads as a dead link and gets clicked again.
 *
 * Mirrors PortalRequestDetailView: one chat window with the header pinned on
 * top, the composer pinned below and the thread between. The thread is a
 * conversation -- the customer's messages on the right, the team's on the
 * left -- so the skeleton draws a bubble on each side, sat at the bottom where
 * the real thread opens scrolled to. The textarea is a real control, so it
 * keeps its outline.
 *
 * The CSAT prompt is deliberately absent: the real page only shows it once
 * request.csat.resolvedAt is set, and a skeleton cannot know that. Drawing one
 * would either flash a card that should not be there or, worse, hide the
 * surprise when a satisfied customer lands on the form to rate the fix.
 */

const CARD = cn(
  "overflow-hidden rounded-2xl border bg-card",
  PORTAL_CARD_SHADOW,
);

/**
 * Two messages, one from each side, so the thread arrives already reading as a
 * conversation. The bubble widths are the real ones' range -- a customer's note
 * tends to run longer than the reply -- and they are what give the bars inside
 * each bubble something to be a percentage of. Without one the bubble collapses
 * to its padding and the message body draws nothing.
 */
const MESSAGES = [
  {
    fromTeam: false,
    lines: ["w-full", "w-3/4"],
    author: "w-32",
    bubble: "w-[72%]",
  },
  {
    fromTeam: true,
    lines: ["w-full", "w-11/12", "w-2/3"],
    author: "w-28",
    bubble: "w-[58%]",
  },
];

export default function Loading() {
  return (
    // The same fixed-height chat window as the page: header pinned on top,
    // composer pinned below, thread between. Same calc as the real one, so the
    // card does not change height when the data arrives.
    <div className="mx-auto flex h-[calc(100dvh-10.125rem)] min-h-120 w-full max-w-7xl flex-col sm:h-[calc(100dvh-10.3125rem)] md:h-[calc(100dvh-12.3125rem)] md:px-6">
      <PortalBackLinkSkeleton />

      <section className={cn(CARD, "mt-4 flex min-h-0 flex-1 flex-col")}>
        <div className="flex shrink-0 items-start gap-3 border-b px-4 py-3.5 sm:gap-4 sm:px-6 sm:py-4">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-6 w-3/5 bg-slate-300/70 sm:h-7" />
            <div className="mt-1 flex items-center gap-2">
              <Skeleton className="h-5 w-10 rounded-md bg-slate-200/80" />
              <PortalStateBadgeSkeleton className="h-5 w-14" />
            </div>
          </div>

          <div className="hidden shrink-0 flex-col items-end gap-0.5 pt-0.5 md:flex">
            <Skeleton className="h-4 w-40 bg-slate-200/80" />
            <Skeleton className="h-4 w-42 bg-slate-200/80" />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-4 py-5 sm:px-6 sm:py-6">
          {MESSAGES.map((message, index) => (
            <PortalMessageSkeleton
              key={index}
              fromTeam={message.fromTeam}
              lineWidths={message.lines}
              authorWidth={message.author}
              bubbleWidth={message.bubble}
            />
          ))}
        </div>

        <div className="shrink-0 border-t bg-muted/30 px-4 py-3.5 sm:px-6 sm:py-4">
          {/* A real outlined textarea, not a grey bar: it is a control. */}
          <div className="min-h-14 rounded-xl border bg-background" />

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-2">
              <div className="h-11 w-32 rounded-lg border bg-card" />
              <Skeleton className="h-3 w-32 bg-slate-200/80" />
            </div>

            <Skeleton className="h-11 w-full rounded-lg bg-slate-300/70 sm:w-36" />
          </div>

          <div className="mt-2.5 flex items-center gap-1.5">
            <Skeleton className="size-3.5 shrink-0 rounded-full bg-slate-200/80" />
            <Skeleton className="h-3 w-60 max-w-full bg-slate-200/80" />
          </div>
        </div>
      </section>
    </div>
  );
}
