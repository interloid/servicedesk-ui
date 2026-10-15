import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { REPORT_CARD } from "./styles";

/**
 * Skeletons for the Reports page, mirroring ReportsDashboard piece for piece:
 * the same cards, paddings and breakpoints, and every bar sized to the line box
 * of the text it stands for (h-4 for text-xs, h-5 for text-sm, h-6 for
 * text-base, h-9 for text-3xl), so nothing moves when the data lands.
 *
 * ReportsSkeletonBody is everything under the page heading. The dashboard
 * shows it on its own while a new period loads, so the heading and the period
 * picker stay put; ReportsSkeleton adds the heading for the route's
 * loading.tsx.
 */

/** Chart bar heights in %, opened then resolved per period. */
const BARS = [
  [42, 30],
  [58, 46],
  [36, 52],
  [70, 48],
  [50, 62],
  [64, 40],
  [44, 56],
  [76, 60],
];

const AGENT_COLUMNS = [
  { head: "w-12", cell: "agent" },
  { head: "w-9", cell: "w-5" },
  { head: "w-11", cell: "w-5" },
  { head: "w-28", cell: "w-10" },
  { head: "w-24", cell: "sla" },
  { head: "w-9", cell: "w-14" },
] as const;

const AGENT_NAME_WIDTHS = ["w-28", "w-24", "w-32", "w-20", "w-28"];
const AGENT_EMAIL_WIDTHS = ["w-40", "w-36", "w-44", "w-32", "w-40"];

function StatCardSkeleton() {
  return (
    <Card className={cn(REPORT_CARD, "min-w-0")}>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 shrink-0 rounded-lg" />
        <Skeleton className="h-4 w-28 max-w-full" />
      </div>
      <Skeleton className="mt-3 h-8 w-20 sm:mt-4 sm:h-9" />
      <Skeleton className="mt-1 h-5 w-36 max-w-full" />
    </Card>
  );
}

function TicketPerformanceSkeleton() {
  return (
    <Card className={REPORT_CARD}>
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between">
        <div>
          <Skeleton className="h-6 w-52 max-w-full" />
          <Skeleton className="mt-0.5 h-5 w-64 max-w-full" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* legend, bar/line switch, grouping menu */}
          <Skeleton className="h-8 w-40 rounded-lg" />
          <Skeleton className="h-8 w-17.5 rounded-lg" />
          <Skeleton className="h-8 w-28 rounded-lg" />
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-5 md:flex-row md:items-stretch">
        <div className="flex shrink-0 gap-4 border-b pb-4 md:w-40 md:flex-col md:justify-center md:border-r md:border-b-0 md:pb-0 md:pr-5">
          {[0, 1].map((i) => (
            <div key={i} className="flex-1 md:flex-none">
              <Skeleton className="size-5 rounded" />
              <Skeleton className="mt-2 h-5 w-24" />
              <Skeleton className="mt-0.5 h-8 w-12" />
              <Skeleton className="mt-1 h-4 w-20" />
            </div>
          ))}
        </div>

        {/* Same height ramp as the real chart box. */}
        <div className="flex h-56 w-full min-w-0 gap-3 sm:h-64 md:w-auto md:flex-1">
          <div className="flex flex-col justify-between pb-7">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-3 w-5" />
            ))}
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-1 items-end justify-around border-b pb-px">
              {BARS.map(([opened, resolved], i) => (
                <div
                  key={i}
                  className={cn(
                    "flex h-full items-end gap-0.5",
                    // Fewer bars fit a phone, as on the real axis.
                    i >= 5 && "hidden sm:flex",
                  )}
                >
                  <Skeleton
                    className="w-3 rounded-b-none sm:w-4"
                    style={{ height: `${opened}%` }}
                  />
                  <Skeleton
                    className="w-3 rounded-b-none opacity-60 sm:w-4"
                    style={{ height: `${resolved}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="flex h-7 items-center justify-around">
              {BARS.map((_, i) => (
                <Skeleton
                  key={i}
                  className={cn("h-3 w-8", i >= 5 && "hidden sm:block")}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function PrioritySkeleton() {
  return (
    <Card className={REPORT_CARD}>
      <Skeleton className="h-6 w-52 max-w-full" />
      <Skeleton className="mt-0.5 h-5 w-64 max-w-full" />
      <div className="mt-6 flex flex-1 flex-col justify-around gap-5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-8 w-20 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-4 w-14" />
              </div>
              <Skeleton className="h-2 w-full rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AgentTableSkeleton() {
  return (
    <Card className="min-w-0 gap-0 overflow-hidden rounded-xl bg-card p-0 shadow-sm ring-1">
      <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-lg" />
          <div>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="mt-0.5 h-4 w-16" />
          </div>
        </div>
        <Skeleton className="h-9 w-full rounded-md sm:w-64" />
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-170">
          <div className="flex h-10 items-center border-b border-slate-100 bg-slate-50 dark:border-border dark:bg-muted">
            {AGENT_COLUMNS.map((column, i) => (
              <div
                key={i}
                className={cn("px-4 sm:px-6", i === 0 ? "flex-2" : "flex-1")}
              >
                <Skeleton className={cn("h-3 bg-slate-200/80", column.head)} />
              </div>
            ))}
          </div>

          {[0, 1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="flex h-15 items-center border-b border-slate-100 last:border-0 dark:border-border"
            >
              {AGENT_COLUMNS.map((column, i) => (
                <div
                  key={i}
                  className={cn("px-4 sm:px-6", i === 0 ? "flex-2" : "flex-1")}
                >
                  {column.cell === "agent" ? (
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-9 shrink-0 rounded-full" />
                      <div className="flex min-w-0 flex-col gap-1">
                        <Skeleton
                          className={cn("h-4", AGENT_NAME_WIDTHS[row])}
                        />
                        <Skeleton
                          className={cn("h-3", AGENT_EMAIL_WIDTHS[row])}
                        />
                      </div>
                    </div>
                  ) : column.cell === "sla" ? (
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-1.5 w-full max-w-48 rounded-full" />
                    </div>
                  ) : (
                    <Skeleton className={cn("h-4", column.cell)} />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function ReportsSkeletonBody() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TicketPerformanceSkeleton />
        <PrioritySkeleton />
      </div>

      <AgentTableSkeleton />
    </div>
  );
}

export function ReportsSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading reports"
      className="h-full overflow-x-hidden overflow-y-auto p-4 sm:p-6 lg:p-8"
    >
      <div className="mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Skeleton className="h-8 w-28" />
            <Skeleton className="mt-0.5 h-5 w-80 max-w-full" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="h-9 w-40 rounded-md" />
          </div>
        </div>

        <ReportsSkeletonBody />
      </div>
    </div>
  );
}
