import { Skeleton } from "@/components/ui/skeleton";
import { PortalCentered } from "@/features/portal/components/portal-shell";
import {
  PortalButtonPairSkeleton,
  PortalCardSkeleton,
  PortalRoundIconSkeleton,
} from "@/features/portal/components/portal-skeletons";

/**
 * Without this file Next.js has no fallback for the async page beside it, and
 * this one is worth having: the page awaits getPortalIdentity and
 * getFirstResponseTarget. A blank frame during that is a reload-shaped dead end
 * on the very first screen a new customer sees. The wizard stamps itself as
 * shown from the browser once it mounts, so nothing here writes.
 *
 * Mirrors step 1 of PortalWelcomeWizard: the step dots, the
 * centred greeting, the three feature cards -- rows on a phone, centred tiles
 * from sm up -- and the button pair: stacked on a phone, right-aligned from sm.
 */

/** Same count as TOTAL_STEPS in the wizard. */
const STEP_COUNT = 2;

const CARD_TITLES = ["w-28", "w-32", "w-28"];

export default function Loading() {
  // PortalCentered, matching the wizard: a fallback card pinned under the header
  // that then jumps to the middle when the wizard lands is the shift a loading
  // state must never make.
  return (
    <PortalCentered width="max-w-180">
      <PortalCardSkeleton width="max-w-180" className="text-center md:p-10">
        <div className="flex items-center justify-center gap-2.5">
          <div className="flex items-center gap-1.5" aria-hidden>
            <Skeleton className="h-1.5 w-6 rounded-full bg-slate-300/70" />
            {Array.from({ length: STEP_COUNT - 1 }).map((_, index) => (
              <Skeleton
                key={index}
                className="size-1.5 rounded-full bg-slate-200/80"
              />
            ))}
          </div>
          <Skeleton className="h-3 w-16 bg-slate-200/80" />
        </div>

        <Skeleton className="mx-auto mt-3 h-8 w-64 max-w-full bg-slate-300/70" />
        <Skeleton className="mx-auto mt-2 h-4 w-80 max-w-full bg-slate-200/80" />

        <div className="mt-7 grid gap-3 sm:grid-cols-3 sm:gap-4">
          {CARD_TITLES.map((width, index) => (
            <div
              key={index}
              className="flex items-start gap-3.5 rounded-xl border bg-card p-4 sm:flex-col sm:items-center sm:p-5"
            >
              <PortalRoundIconSkeleton />
              <div className="w-full min-w-0 sm:flex sm:flex-col sm:items-center">
                <Skeleton className={`h-4 ${width} bg-slate-300/70`} />
                <Skeleton className="mt-1 h-3 w-full bg-slate-200/80" />
                <Skeleton className="h-3 w-3/4 bg-slate-200/80" />
              </div>
            </div>
          ))}
        </div>

        <PortalButtonPairSkeleton
          widths={["sm:w-32", "sm:w-28"]}
          className="mt-8 grid-cols-1 sm:justify-end sm:gap-3"
        />
      </PortalCardSkeleton>
    </PortalCentered>
  );
}
