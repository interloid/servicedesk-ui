import { Skeleton } from "@/components/ui/skeleton";
import {
  PortalIconBadgeSkeleton,
  PortalSplitSkeleton,
} from "@/features/portal/components/portal-skeletons";

/**
 * The page is quick -- it only reads the query string -- but it is the screen
 * a sign-in lands on, and without a fallback the sign-in form stays up after
 * "Email me a link" with no sign anything happened.
 *
 * Mirrors PortalCheckEmail top to bottom: the icon, the heading, the
 * "we sent a link to" line, the address chip, the device note, and the two
 * stacked full-width buttons. The email chip and the device note are drawn as
 * the real bordered box and the real icon-plus-text row, so the card does not
 * reflow when the content lands.
 */
export default function Loading() {
  return (
    <PortalSplitSkeleton>
      <PortalIconBadgeSkeleton />

      <Skeleton className="mt-4 h-6 w-48 bg-slate-300/70" />

      <Skeleton className="mt-1.5 h-4 w-44 bg-slate-200/80" />

      <div className="mt-2 flex items-center gap-2.5 rounded-xl border bg-muted/40 px-3.5 py-3">
        <Skeleton className="size-4 shrink-0 rounded bg-slate-200/80" />
        <Skeleton className="h-4 w-52 bg-slate-300/70" />
      </div>

      <div className="mt-4 flex gap-2.5">
        <Skeleton className="mt-px size-4 shrink-0 rounded bg-slate-200/80" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton className="h-3 w-full bg-slate-200/80" />
          <Skeleton className="h-3 w-full bg-slate-200/80" />
          <Skeleton className="h-3 w-2/3 bg-slate-200/80" />
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2.5">
        <Skeleton className="h-11 w-full rounded-lg bg-slate-300/70" />
        <div className="h-11 w-full rounded-lg border bg-card" />
      </div>
    </PortalSplitSkeleton>
  );
}
