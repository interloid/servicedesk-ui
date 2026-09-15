import { Skeleton } from "@/components/ui/skeleton";

export default function PlansLoading() {
  return (
    <div className="min-h-full w-full bg-accent/40 px-4 sm:px-6 lg:px-8 py-6 sm:py-8 md:py-10">
      <div className="mx-auto max-w-7xl space-y-6 sm:space-y-10 lg:space-y-12">
        <header className="mx-auto max-w-2xl text-center">
          <Skeleton className="h-7 w-48 mx-auto sm:h-8" />
          <Skeleton className="h-4 w-72 mx-auto mt-2" />
        </header>

        <div className="flex flex-wrap items-stretch justify-center gap-5 xl:gap-6">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div
              key={idx}
              className="relative flex h-full w-full flex-col rounded-2xl border border-border p-6 shadow-sm sm:w-[calc(50%-0.625rem)] xl:w-[calc(33.333%-1rem)]"
            >
              <div className="space-y-1.5">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>

              <div className="mt-5">
                <Skeleton className="h-8 w-28" />
              </div>

              <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-border bg-muted/40 px-3.5 py-2.5">
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="h-3.5 w-40" />
              </div>

              <div className="mt-5 flex-1 space-y-3 border-t border-border pt-5">
                {Array.from({ length: 6 }).map((_, fIdx) => (
                  <div key={fIdx} className="flex items-center gap-2.5">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <Skeleton
                      className={`h-3.5 ${fIdx % 2 === 0 ? "w-4/5" : "w-3/5"}`}
                    />
                  </div>
                ))}
              </div>

              <div className="mt-6">
                <Skeleton className="h-11 w-full rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
