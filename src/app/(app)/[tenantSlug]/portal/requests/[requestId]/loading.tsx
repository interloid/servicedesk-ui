import { Skeleton } from "@/components/ui/skeleton";
import {
  PORTAL_CARD_SHADOW,
  PortalBackLinkSkeleton,
  PortalStateBadgeSkeleton,
} from "@/features/portal/components/portal-skeletons";
import { PortalThreadSkeleton } from "@/features/portal/components/portal-thread-skeleton";
import { cn } from "@/lib/utils";

/**
 * Without this file Next.js has no fallback for the async page beside it, so a
 * click leaves the previous screen up until every query has finished — which
 * reads as a dead link and gets clicked again.
 *
 * Mirrors PortalRequestDetailView: one chat window with the header pinned on
 * top, the composer pinned below and the thread between. The thread
 * (PortalThreadSkeleton) is the customer's opening message at the top, plus a
 * team reply only when the requests list said there is one. The textarea is a
 * real control, so it keeps its outline.
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
              {/* The "updated" stamp the page shows here below md. */}
              <Skeleton className="h-4 w-24 bg-slate-200/80 md:hidden" />
            </div>
          </div>

          <div className="hidden shrink-0 flex-col items-end gap-0.5 pt-0.5 md:flex">
            <Skeleton className="h-4 w-40 bg-slate-200/80" />
            <Skeleton className="h-4 w-42 bg-slate-200/80" />
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-5 sm:px-6 sm:py-6">
          <PortalThreadSkeleton />
        </div>

        <div className="shrink-0 border-t bg-muted/30 px-3 py-3 sm:px-6 sm:py-4">
          {/* A real outlined textarea, not a grey bar: it is a control. Same
              min heights as the page's: shorter on a phone. */}
          <div className="min-h-11 rounded-xl border bg-background sm:min-h-14" />

          {/* Same order as the composer: on a phone Send first, then Attach
              with its limits under it, all full width; one row from sm. */}
          <div className="mt-2.5 grid grid-cols-1 gap-2 sm:mt-3 sm:flex sm:items-center sm:justify-between">
            <div className="grid grid-cols-1 justify-items-center gap-1.5 sm:flex sm:items-center sm:gap-3">
              <div className="h-11 w-full rounded-lg border bg-card sm:w-32" />
              <Skeleton className="h-3 w-32 bg-slate-200/80" />
            </div>

            <Skeleton className="order-first h-11 w-full rounded-lg bg-slate-300/70 sm:order-none sm:w-36" />
          </div>

          {/* The privacy note, hidden on a phone as on the page. */}
          <div className="mt-2.5 hidden items-center gap-1.5 sm:flex">
            <Skeleton className="size-3.5 shrink-0 rounded-full bg-slate-200/80" />
            <Skeleton className="h-3 w-60 max-w-full bg-slate-200/80" />
          </div>
        </div>
      </section>
    </div>
  );
}
