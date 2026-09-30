import { Skeleton } from "@/components/ui/skeleton";
import {
  PortalContentSkeleton,
  PortalHeadingSkeleton,
  PortalStateBadgeSkeleton,
} from "@/features/portal/components/portal-skeletons";

/**
 * Without this file Next.js has no fallback for the async page beside it, so a
 * click leaves the previous screen up until every query has finished — which
 * reads as a dead link and gets clicked again.
 *
 * Mirrors PortalRequestsList at every breakpoint: the max-w-5xl column, the
 * wrapping header and its button, the search box and status select (stacked
 * on a phone), the count-and-sort line, and the request cards with their icon,
 * preview line and chevron. The cards are real bordered boxes, so the list does
 * not change colour when the data lands.
 */

const ROW_COUNT = 4;

/** Varied so the four rows do not read as one grey slab. */
const SUBJECT_WIDTHS = ["w-56", "w-44", "w-64", "w-40"];
const PREVIEW_WIDTHS = ["w-4/5", "w-3/5", "w-2/3", "w-1/2"];
const TIME_WIDTHS = ["w-48", "w-40", "w-52", "w-44"];

export default function Loading() {
  return (
    <PortalContentSkeleton width="max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PortalHeadingSkeleton titleWidth="w-48" lines={["w-full sm:w-120"]} />

        <Skeleton className="h-11 w-36 rounded-lg bg-slate-300/70" />
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <div className="h-12 min-w-0 flex-1 rounded-xl border bg-card shadow-xs" />
        <div className="h-12 w-full rounded-xl border bg-card shadow-xs sm:w-52" />
      </div>

      <div className="mt-6 flex items-center justify-between gap-3">
        <Skeleton className="h-4 w-20 bg-slate-200/80" />
        <Skeleton className="h-4 w-32 bg-slate-200/80" />
      </div>

      <div className="mt-3 flex flex-col gap-3">
        {Array.from({ length: ROW_COUNT }).map((_, index) => (
          <div
            key={index}
            className="flex items-start gap-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5"
          >
            <Skeleton className="hidden size-12 shrink-0 rounded-xl bg-slate-200/80 sm:block" />

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Skeleton className="h-3 w-8 bg-slate-200/80" />
                  <Skeleton
                    className={`h-5 max-w-full bg-slate-300/70 ${SUBJECT_WIDTHS[index]}`}
                  />
                </div>
                <PortalStateBadgeSkeleton />
              </div>

              <Skeleton
                className={`mt-2 h-4 bg-slate-200/80 ${PREVIEW_WIDTHS[index]}`}
              />
              <Skeleton
                className={`mt-2.5 h-3 max-w-full bg-slate-200/80 ${TIME_WIDTHS[index]}`}
              />
            </div>

            <Skeleton className="mt-9 hidden size-5 shrink-0 rounded bg-slate-200/80 sm:block" />
          </div>
        ))}
      </div>
    </PortalContentSkeleton>
  );
}
