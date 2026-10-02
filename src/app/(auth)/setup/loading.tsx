import { Skeleton } from "@/components/ui/skeleton";

/**
 * Without this file the wizard has no fallback while getTimezones runs, and
 * the centred spinner sits in the middle of a screen the real page fills top
 * to bottom — the page jumps when the card lands.
 *
 * Mirrors step 1 of the page: the AuthShell wordmark, the wizard card with its
 * step eyebrow, heading and lead, the three-step StepperHeader (stacked rows
 * on a phone, a row from sm), then step one's form — three labelled inputs,
 * the terms checkbox, the h-11 continue button, the "or" rule, and the
 * "Already have an account?" line.
 *
 * Steps 2 to 5 are not drawn. The skeleton cannot know which one the customer
 * is on, and step 1 is where a first-time visitor always starts.
 */
export default function Loading() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5.5 px-5 py-7 md:px-6 md:py-14">
      <div className="flex items-center gap-2.5">
        <Skeleton className="size-8.5 shrink-0 rounded-md bg-slate-300/70" />
        <Skeleton className="h-6 w-32" />
      </div>

      <div className="mx-auto flex max-h-[calc(100dvh-9rem)] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white p-6 text-left shadow-xl sm:p-8">
        <div className="shrink-0 border-b border-slate-100 pb-4">
          <Skeleton className="h-3 w-20 bg-slate-200/80" />
          <Skeleton className="mt-1 h-7 w-48 sm:h-8" />
          <Skeleton className="mt-1 h-4 w-80 max-w-full" />

          <div className="mt-4 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-3 sm:p-4">
            {/* Stacked on a phone, a row from sm, as the real header is. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              {["w-28", "w-32", "w-20"].map((width) => (
                <div key={width} className="flex shrink-0 items-center gap-2">
                  <Skeleton className="size-7 shrink-0 rounded-full bg-slate-200/80" />
                  <Skeleton className={`h-4 ${width}`} />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden px-1 pt-6">
          <div className="flex flex-col gap-5">
            {[
              { label: "w-20" },
              { label: "w-12", description: "w-52" },
              { label: "w-20" },
              // A fixed list that never reorders, and two entries share a
              // width, so the index is the only stable unique key.
            ].map((field, index) => (
              <div key={index} className="flex flex-col gap-1.5">
                <Skeleton className={`h-5 ${field.label}`} />
                <div className="h-11 w-full rounded-lg border bg-background" />
                {field.description ? (
                  <Skeleton className="h-3 max-w-full" />
                ) : null}
              </div>
            ))}

            <div className="flex items-center gap-2.5 pt-1">
              <Skeleton className="size-5 shrink-0 rounded border-slate-300" />
              <Skeleton className="h-5 w-72 max-w-full" />
            </div>

            <div className="h-11 w-full rounded-lg bg-slate-300/70" />
          </div>

          <div className="relative mt-6 flex items-center justify-center">
            <span className="w-full border-t border-slate-200" />
            <span className="relative bg-white px-3 text-xs text-slate-400">
              or
            </span>
          </div>

          <div className="mt-6 text-center text-sm text-slate-500">
            <Skeleton className="mx-auto h-5 w-56" />
          </div>
        </div>
      </div>
    </main>
  );
}
