import { Skeleton } from "@/components/ui/skeleton";
import {
  PORTAL_CARD_SHADOW,
  PortalBackLinkSkeleton,
  PortalButtonPairSkeleton,
  PortalContentSkeleton,
  PortalFieldSkeleton,
  PortalHeadingSkeleton,
  PortalRoundIconSkeleton,
} from "@/features/portal/components/portal-skeletons";
import { cn } from "@/lib/utils";

/**
 * This file is not optional. Without it, "New request" has no fallback of its
 * own and the nearest one up the tree is the list's — four request rows, a
 * search box and a status filter — before swapping to a form. The list's
 * fallback sits in `requests/(overview)/loading.tsx`, beside the list page
 * rather than above it, so this page is no longer covered by it; moving
 * loading.tsx out of that group puts the flash back.
 *
 * Mirrors PortalNewRequestForm: the max-w-7xl column, the heading, and the form
 * card (subject, description with its hint and counter, the dashed dropzone,
 * the button row).
 *
 * The guest email and name fields are absent: this page is deliberately
 * reachable signed out, so the skeleton cannot know whether the two-column
 * guest block is coming. Drawing them for a signed-in customer would push the
 * real form down by one row, and they are the first thing a guest sees land.
 */

export default function Loading() {
  return (
    <PortalContentSkeleton width="max-w-7xl">
      <PortalBackLinkSkeleton />

      <div className="mt-4 mb-6 sm:mb-8">
        <PortalHeadingSkeleton
          titleWidth="w-52"
          lines={["w-full sm:w-136", "w-2/3 sm:hidden"]}
        />
      </div>

      <div
        className={cn(
          "rounded-2xl border bg-card p-5 sm:p-7",
          PORTAL_CARD_SHADOW,
        )}
      >
        <div className="flex flex-col gap-5">
          <PortalFieldSkeleton labelWidth="w-16" description="w-48" />

          {/* The two labels below are drawn by hand rather than through
              PortalFieldSkeleton, because each wraps a block of its own. They
              are still h-5 for PortalFieldSkeleton's reason: the real labels
              are text-sm, a 20px line box, and an h-4 bar put the box under
              them 4px high. */}
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-24 bg-slate-200/80" />
            <div className="min-h-36 rounded-lg border bg-background/60" />
            <div className="flex items-start justify-between gap-4">
              <Skeleton className="h-3 w-72 max-w-full bg-slate-200/80" />
              <Skeleton className="h-3 w-14 shrink-0 bg-slate-200/80" />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-24 bg-slate-200/80" />
            <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed bg-muted/20 px-4 py-7">
              <PortalRoundIconSkeleton />
              <Skeleton className="mt-1 h-4 w-60 max-w-full bg-slate-200/80" />
              <Skeleton className="h-3 w-40 bg-slate-200/80" />
            </div>
          </div>

          <div className="mt-1 flex flex-col gap-4 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
            <Skeleton className="h-3 w-44 bg-slate-200/80 lg:invisible" />
            <PortalButtonPairSkeleton widths={["sm:w-28", "sm:w-40"]} />
          </div>
        </div>
      </div>
    </PortalContentSkeleton>
  );
}
