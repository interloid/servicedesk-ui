import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while the page's queries run, so a click on "Audit log" answers at
 * once. Mirrors the real layout (header, four stat cards, the filter bar, tabs
 * and table) so nothing jumps when the data lands.
 */

const ROW_COUNT = 8;
const DETAIL_WIDTHS = [
  "w-56",
  "w-64",
  "w-48",
  "w-60",
  "w-52",
  "w-44",
  "w-60",
  "w-56",
];

export default function Loading() {
  return (
    <div className="h-full overflow-y-auto p-4 font-sans sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-5 w-24 rounded-md" />
            </div>
            <Skeleton className="h-5 w-96 max-w-full" />
          </div>
          <div className="flex w-full flex-wrap gap-3 sm:w-auto">
            <Skeleton className="h-10 w-full rounded-lg sm:w-60" />
            <Skeleton className="h-10 flex-1 rounded-lg sm:w-24 sm:flex-none" />
            <Skeleton className="h-10 flex-1 rounded-lg sm:w-44 sm:flex-none" />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-4 rounded-[14px] border border-border bg-card p-4 sm:p-5"
            >
              <Skeleton className="size-12 rounded-xl" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-7 w-14" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col rounded-[14px] border border-border bg-card">
          <div className="flex flex-wrap gap-3 p-4">
            <Skeleton className="h-10 w-full rounded-lg xl:w-72" />
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton
                key={index}
                className="h-10 w-full rounded-lg sm:w-40"
              />
            ))}
          </div>
          <div className="flex gap-5 border-b border-border px-4 pb-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-6 w-28" />
            ))}
          </div>
          <div className="overflow-hidden">
            <div className="h-11 min-w-[1080px] bg-muted/50" />
            {Array.from({ length: ROW_COUNT }).map((_, index) => (
              <div
                key={index}
                className="flex min-w-[1080px] items-center gap-6 border-b border-border px-4 py-3.5 last:border-b-0"
              >
                <div className="flex w-36 flex-col gap-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <div className="flex w-44 items-center gap-2.5">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
                <Skeleton className="h-5 w-20 rounded-md" />
                <Skeleton className="h-5 w-24 rounded-md" />
                <Skeleton className={`h-4 ${DETAIL_WIDTHS[index]}`} />
                <Skeleton className="ml-auto h-5 w-16 rounded-md" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="size-8 rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
