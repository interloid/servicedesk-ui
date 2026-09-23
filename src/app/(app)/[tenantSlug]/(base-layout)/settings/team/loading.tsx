import { Skeleton } from "@/components/ui/skeleton";

/**
 * Without this file Next.js has no fallback for the async page beside it, so a
 * click leaves the previous screen up until every query has finished — which
 * reads as a dead link and gets clicked again.
 *
 * The shapes below mirror the real page at every breakpoint (same padding,
 * same column widths, cards below xl and a table above it), so the list does
 * not jump when the data lands.
 */

const ROW_COUNT = 4;

/** Varied widths stop the placeholder rows reading as one grey block. */
const NAME_WIDTHS = ["w-36", "w-28", "w-32", "w-24"];
const EMAIL_WIDTHS = ["w-48", "w-44", "w-52", "w-40"];

function Identity({ index }: { index: number }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Skeleton className="size-9 shrink-0 rounded-full" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <Skeleton className={`h-4 ${NAME_WIDTHS[index]}`} />
        <Skeleton className={`h-3 ${EMAIL_WIDTHS[index]}`} />
      </div>
    </div>
  );
}

function StatusBlock() {
  return (
    <div className="flex flex-col gap-1.5">
      <Skeleton className="h-6 w-16 rounded-full" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

function RoleBlock() {
  return <Skeleton className="h-10 w-full max-w-52.5 rounded-lg" />;
}

export default function Loading() {
  return (
    <div className="h-full overflow-y-auto p-4 font-sans text-slate-900 sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full flex-col gap-6 sm:gap-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>

          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
            <Skeleton className="h-10 flex-1 rounded-lg sm:w-36 sm:flex-none" />
            <Skeleton className="h-10 flex-1 rounded-lg sm:w-40 sm:flex-none" />
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-4 sm:px-5">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-full rounded-full" />
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:flex sm:gap-x-5">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-4 w-20" />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-start xl:justify-between">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Skeleton className="h-11 w-full rounded-lg sm:h-10 sm:w-65 xl:w-70" />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Skeleton className="h-11 w-full rounded-lg sm:h-10 sm:w-37.5" />
                <Skeleton className="h-11 w-full rounded-lg sm:h-10 sm:w-40" />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto overflow-y-hidden rounded-[14px] border border-border bg-card">
            <div className="flex h-9 min-w-227.5 items-center gap-4 border-b border-border bg-muted/40 px-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-37.5" />
              <Skeleton className="h-3 w-57.5" />
              <Skeleton className="h-3 w-37.5" />
              <Skeleton className="ml-auto h-3 w-14" />
            </div>

            {Array.from({ length: ROW_COUNT }).map((_, index) => (
              <div
                key={index}
                className="flex min-w-227.5 items-center gap-4 border-b border-muted px-4 py-3.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <Identity index={index} />
                </div>
                <div className="w-37.5 shrink-0">
                  <StatusBlock />
                </div>
                <div className="w-57.5 shrink-0">
                  <RoleBlock />
                </div>
                <div className="flex w-37.5 shrink-0 flex-col gap-1.5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <div className="flex w-20 shrink-0 justify-center">
                  <Skeleton className="size-9 rounded-lg" />
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col items-center justify-between gap-3 px-1 sm:flex-row">
            <Skeleton className="h-4 w-44" />
          </div>
        </div>
      </div>
    </div>
  );
}
