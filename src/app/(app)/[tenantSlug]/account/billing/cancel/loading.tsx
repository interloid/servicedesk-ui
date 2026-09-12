import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the first step of the cancel page so the layout does not shift when
 * the real content arrives: same Shell widths, the same three blocks, and the
 * same button row.
 */
export default function Loading() {
  return (
    <div className="min-h-dvh w-full bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        {/* Back to billing */}
        <Skeleton className="h-8 w-36 rounded-lg" />

        {/* Heading + subtitle */}
        <div>
          <Skeleton className="h-8 w-60 max-w-full" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full" />
        </div>

        {/* Current plan card */}
        <Card className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-52 max-w-full" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </Card>

        {/* What happens after you cancel */}
        <Card className="border-red-200 bg-red-50/50 p-5">
          <div className="flex items-start gap-3">
            <Skeleton className="mt-0.5 size-5 shrink-0 rounded-full bg-red-200/60" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-52 bg-red-200/60" />

              {/* Plan → Free chips */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Skeleton className="h-7 w-24 rounded-md bg-red-200/60" />
                <Skeleton className="size-4 rounded bg-red-200/60" />
                <Skeleton className="h-7 w-20 rounded-md bg-red-200/60" />
              </div>

              {/* Three consequence rows */}
              <div className="mt-4 space-y-3">
                {[
                  ["w-full", "w-3/4"],
                  ["w-11/12", "w-2/3"],
                  ["w-full", "w-1/2"],
                ].map(([first, second], index) => (
                  <div key={index} className="flex items-start gap-2">
                    <Skeleton className="mt-0.5 size-4 shrink-0 rounded bg-red-200/60" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <Skeleton className={`h-3.5 ${first} bg-red-200/60`} />
                      <Skeleton className={`h-3.5 ${second} bg-red-200/60`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Keep my plan / Continue to cancel */}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-10 w-full rounded-lg sm:w-32" />
          <Skeleton className="h-10 w-full rounded-lg sm:w-44" />
        </div>
      </div>
    </div>
  );
}
