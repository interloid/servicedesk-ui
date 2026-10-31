import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors PricingCards. The card's content sits in one inner column, as in the
 * real card: Card puts a gap between its direct children, so drawing the parts
 * straight into it made every skeleton card taller than the real one.
 *
 * Free lists its own features; Pro and Business open with "Everything in …,
 * plus:" before theirs. Rows per plan follow the real lists (4, 5, 3), so the
 * tallest card -- which sets the row's height -- is the same one.
 */
const PLANS = [
  { title: "w-16", features: 4, inherits: false },
  { title: "w-20", features: 5, inherits: true },
  { title: "w-28", features: 3, inherits: true },
];

export default function PlansLoading() {
  return (
    <div className="min-h-full w-full  px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10 ">
      <div className="mx-auto max-w-7xl space-y-8 sm:space-y-10">
        <header className="mx-auto max-w-2xl space-y-2 text-center">
          <Skeleton className="mx-auto h-8 w-48 sm:h-9 sm:w-52 bg-slate-200 " />
          <Skeleton className="mx-auto h-4 w-80 max-w-full sm:h-5 bg-slate-200" />
        </header>

        <div className="flex flex-wrap items-stretch justify-center gap-5 xl:gap-6">
          {PLANS.map((plan, index) => (
            <Card
              key={index}
              className="flex min-h-136 w-full flex-col rounded-2xl border! border-border! bg-card p-6 shadow-sm sm:w-[calc(50%-0.625rem)] xl:w-[calc(33.333%-1rem)]"
            >
              <div className="flex h-full flex-1 flex-col">
                <div className="min-h-25">
                  <Skeleton className={`h-7 ${plan.title}`} />

                  <div className="mt-2 min-h-10 space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-4/5" />
                  </div>
                </div>

                <div className="mt-4 flex items-baseline gap-1.5">
                  <Skeleton className="h-10 w-24" />
                  <Skeleton className="h-4 w-14" />
                </div>

                <div className="mt-5 flex h-11.5 items-center gap-2.5 rounded-xl border border-border/80 px-3.5">
                  <Skeleton className="size-4 shrink-0" />
                  <Skeleton className="h-4 w-40" />
                </div>

                <div className="mt-6 flex-1 border-t border-border/80 pt-5">
                  {plan.inherits && (
                    <div className="flex items-start gap-2.5 px-1 py-2">
                      <Skeleton className="mt-0.5 size-4 shrink-0" />
                      <Skeleton className="h-4 w-36" />
                    </div>
                  )}

                  <div
                    className={plan.inherits ? "mt-3.5 space-y-3" : "space-y-3"}
                  >
                    {Array.from({ length: plan.features }).map(
                      (_, featureIndex) => (
                        <div
                          key={featureIndex}
                          className="flex items-start gap-2.5"
                        >
                          <Skeleton className="mt-0.5 size-4 shrink-0" />

                          <Skeleton
                            className={`h-4 ${
                              featureIndex % 2 === 0 ? "w-40" : "w-32"
                            }`}
                          />
                        </div>
                      ),
                    )}
                  </div>
                </div>

                <div className="mt-6">
                  <Skeleton className="h-11 w-full rounded-xl" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
