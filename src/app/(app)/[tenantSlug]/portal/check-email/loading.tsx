import { Skeleton } from "@/components/ui/skeleton";
import {
  PortalIconBadgeSkeleton,
  PortalSplitSkeleton,
} from "@/features/portal/components/portal-skeletons";

/**
 * Without this file Next.js has no fallback for the async page beside it, so a
 * visitor who follows a stale /portal/check-email link gets the previous
 * screen up until the query resolves and bounces them to sign in.
 *
 * Mirrors PortalCheckEmail: the icon badge, the heading and its lead, the
 * "we sent it to" chip, the three-line body, then the resend and
 * change-address buttons.
 *
 * The bar heights are the real line boxes and the counts are the real wrap,
 * because this card is centred: a skeleton 20px shorter moves it by 10px in
 * both directions when the email arrives. Measured at the 382px content
 * column: the heading is one 32px line (h-8), the short lead is one 22.4px
 * line (h-5.5), the chip's text-sm is 20px (h-5) inside the same py-3, and the
 * body wraps to two leading-5 lines, drawn as two h-4 bars on a gap-2 for a 24px
 * pitch against the real 20.
 */
export default function Loading() {
  return (
    <PortalSplitSkeleton>
      <PortalIconBadgeSkeleton />

      <Skeleton className="mt-4 h-8 w-48 bg-slate-300/70" />

      <Skeleton className="mt-1.5 h-5.5 w-44 bg-slate-200/80" />

      <div className="mt-2 flex items-center gap-2.5 rounded-xl border bg-muted/40 px-3.5 py-3">
        <Skeleton className="size-4 shrink-0 rounded bg-slate-200/80" />
        <Skeleton className="h-5 w-52 bg-slate-300/70" />
      </div>

      <div className="mt-4 flex gap-2.5">
        <Skeleton className="mt-px size-4 shrink-0 rounded bg-slate-200/80" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-full bg-slate-200/80" />
          <Skeleton className="h-4 w-3/4 bg-slate-200/80" />
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-2.5">
        <Skeleton className="h-11 w-full rounded-lg bg-slate-300/70" />
        <div className="h-11 w-full rounded-lg border bg-card" />
      </div>
    </PortalSplitSkeleton>
  );
}
