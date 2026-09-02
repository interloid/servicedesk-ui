import { Skeleton } from "@/components/ui/skeleton";

export default function PlansLoading() {
  return (
    <div className="min-h-full w-full bg-background font-sans text-foreground sm:px-6 sm:py-8 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
        <div className="text-center max-w-2xl mx-auto">
          <Skeleton className="h-7 w-48 mx-auto sm:h-8" />
          <Skeleton className="h-4 w-72 mx-auto mt-2" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6 items-stretch max-w-6xl mx-auto pt-6 pb-12 px-2 sm:px-4">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-border h-full flex flex-col p-4 sm:p-5 md:p-6"
            >
              <div className="space-y-3">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>

              <div className="flex-1 mt-6 space-y-3">
                {Array.from({ length: 6 }).map((_, fIdx) => (
                  <div key={fIdx} className="flex items-center gap-2.5">
                    <Skeleton className="h-4 w-4 rounded-full" />
                    <Skeleton
                      className={`h-3.5 ${fIdx % 2 === 0 ? "w-4/5" : "w-3/5"}`}
                    />
                  </div>
                ))}
              </div>

              <div className="py-6 mt-auto">
                <Skeleton className="h-10 w-full rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
