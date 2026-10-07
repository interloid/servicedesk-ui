import { Skeleton } from "@/components/ui/skeleton";
import {
  PortalContentSkeleton,
  PortalHeadingSkeleton,
  PortalStateBadgeSkeleton,
} from "@/features/portal/components/portal-skeletons";

/**
 * The list skeleton, and it lives inside the (overview) route group on purpose.
 *
 * A loading.tsx is the Suspense fallback for its whole segment INCLUDING every
 * child below it. At requests/loading.tsx -- one level up, which is where this
 * file used to sit -- that made the list skeleton the registered fallback for
 * requests/[requestId] and requests/new as well, so opening a request could
 * flash four request cards, a search box and a sort dropdown on the way to a
 * single request. The group is what stops that: (overview), new/ and [requestId]/
 * are siblings, so each one's loading.tsx now wraps only its own page and the
 * detail route's only fallback is the detail skeleton.
 *
 * Moving this file back up to requests/ puts the bug straight back, and the URL
 * is unaffected either way -- route groups do not appear in the path, so the
 * list is still at /portal/requests.
 *
 * Without this file Next.js has no fallback for the async page beside it, so a
 * click leaves the previous screen up until every query has finished — which
 * reads as a dead link and gets clicked again.
 *
 * Mirrors PortalRequestsList at every breakpoint: the max-w-5xl column, the
 * wrapping header and its button, the search box and status select (stacked
 * on a phone), the count-and-sort line, and the request cards with their icon,
 * preview line, corner badge and chevron. The cards are real bordered boxes, so
 * the list does not change colour when the data lands.
 *
 * The pager is deliberately absent, for the same reason the CSAT card is on the
 * detail page: a skeleton does not know how many requests there are. Drawing
 * one would flash a pair of page buttons on every list of six -- one row past
 * PORTAL_REQUESTS_PER_PAGE -- and then take them away, which is worse than the
 * short wait it covers. A row that has not arrived does not need a control to
 * page past it.
 */

const ROW_COUNT = 4;

/** Varied so the four rows do not read as one grey slab. */
const SUBJECT_WIDTHS = ["w-56", "w-44", "w-64", "w-40"];
const PREVIEW_WIDTHS = ["w-4/5", "w-3/5", "w-2/3", "w-1/2"];
const TIME_WIDTHS = ["w-48", "w-40", "w-52", "w-44"];
/**
 * The real pills measure 52/110/74px for Open/Waiting on you/Resolved -- a 16px
 * text-xs line in px-2.5 py-1, so the width is the label and nothing else. The
 * earlier 48/98/66 were this skeleton's own numbers written down as if they had
 * been measured, which is how a pill came out 12px narrower than the pill that
 * replaced it and nobody could say why.
 */
const BADGE_WIDTHS = ["w-[52px]", "w-[110px]", "w-[74px]", "w-[52px]"];

export default function Loading() {
  return (
    <PortalContentSkeleton width="max-w-7xl">
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
            className="relative flex items-start gap-4 rounded-2xl border bg-card p-4 shadow-xs sm:p-5"
          >
            <Skeleton className="hidden size-12 shrink-0 rounded-xl bg-slate-200/80 sm:block" />

            <div className="min-w-0 flex-1">
              {/* The badge is pinned to the corner and the number keeps the
                  eyebrow line to itself, as on the real row. h-6 keeps the
                  number's line as tall as the pill so the two stay on one
                  centre; pe-28 reserves the corner, which is what stops a long
                  number sliding under the pill. */}
              <PortalStateBadgeSkeleton
                className={`absolute right-5 top-5 ${BADGE_WIDTHS[index]}`}
              />
              <div className="flex h-6 items-center pe-28">
                <Skeleton className="h-3 w-8 bg-slate-200/80" />
              </div>

              {/* Heights are the real line boxes, not round numbers: the title
                  is text-base (24px) and the preview is line-clamp-1 text-sm
                  (20px). At h-5/h-4 the card came out 4px short of the real
                  one, because the skeleton's mt-2 on the preview was cancelling
                  the title's missing 4px by coincidence and the time line then
                  inherited the shortfall. */}
              <Skeleton
                className={`mt-1 h-6 max-w-full bg-slate-300/70 ${SUBJECT_WIDTHS[index]}`}
              />
              <Skeleton
                className={`mt-1 h-5 bg-slate-200/80 ${PREVIEW_WIDTHS[index]}`}
              />
              <Skeleton
                className={`mt-2 h-4 max-w-full bg-slate-200/80 ${TIME_WIDTHS[index]}`}
              />
            </div>

            {/* mt-[30px] is the real offset, from the measured row: the title's
                centre is 60px below the card's top and this block is 20 tall. */}
            <Skeleton className="mt-7.5 hidden size-5 shrink-0 rounded bg-slate-200/80 sm:block" />
          </div>
        ))}
      </div>
    </PortalContentSkeleton>
  );
}
