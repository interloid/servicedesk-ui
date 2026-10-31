import { Skeleton } from "@/components/ui/skeleton";

/**
 * Without this file Next.js has no fallback for the async page beside it, so a
 * click leaves the previous screen up until every query has finished — which
 * reads as a dead link and gets clicked again.
 *
 * The shapes below mirror NotificationsView at every breakpoint (same padding,
 * same preference grid columns, same feed row layout), so nothing jumps when
 * the data lands.
 */

/**
 * Varied widths stop the placeholder rows reading as one grey block. Eight feed
 * rows match PAGE_SIZE in the view, so a full first page lands in place.
 */
/** One per PREFERENCE_ROWS entry in the view (six since "reopened" was added). */
const PREF_LABEL_WIDTHS = ["w-44", "w-36", "w-48", "w-40", "w-44", "w-40"];
const PREF_DESC_WIDTHS = ["w-60", "w-64", "w-56", "w-72", "w-64", "w-56"];
const TITLE_WIDTHS = [
  "w-64",
  "w-52",
  "w-72",
  "w-48",
  "w-60",
  "w-56",
  "w-68",
  "w-44",
];
const SUBTITLE_WIDTHS = [
  "w-40",
  "w-48",
  "w-36",
  "w-44",
  "w-32",
  "w-52",
  "w-40",
  "w-36",
];

/** The real preference grid; header and rows share it. */
const PREF_GRID =
  "sm:grid-cols-[minmax(0,1fr)_112px_112px] lg:grid-cols-[minmax(0,1fr)_160px_160px]";

function SwitchShape() {
  return <Skeleton className="h-5 w-9 shrink-0 rounded-full" />;
}

function ChannelCell() {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 sm:justify-center sm:bg-transparent sm:p-0">
      <div className="flex items-center gap-1.5 sm:hidden">
        <Skeleton className="size-3.5 rounded bg-slate-200/80" />
        <Skeleton className="h-3 w-10" />
      </div>
      <SwitchShape />
    </div>
  );
}

function FilterButton() {
  return (
    <div className="flex h-10 flex-1 items-center justify-between gap-2 rounded-md border bg-card px-3 sm:w-32 sm:flex-none">
      <div className="flex items-center gap-2">
        <Skeleton className="size-4 rounded bg-slate-200/80" />
        <Skeleton className="h-4 w-14" />
      </div>
      <Skeleton className="size-4 rounded bg-slate-200/80" />
    </div>
  );
}

export default function Loading() {
  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 lg:overflow-hidden lg:p-8">
      <div className="mx-auto space-y-4 sm:space-y-6 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:space-y-0 lg:gap-6">
        <div className="flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-5 w-[min(36rem,100%)]" />
          </div>
          <div className="flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-md border bg-card px-4 sm:w-auto">
            <Skeleton className="size-4 rounded bg-slate-200/80" />
            <Skeleton className="h-4 w-28" />
          </div>
        </div>

        {/* Preferences card */}
        <div className="flex flex-col gap-4 overflow-hidden rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5 lg:shrink-0 lg:p-6">
          <div
            className={`grid grid-cols-1 items-end gap-x-3 gap-y-1 sm:pr-[13px] ${PREF_GRID}`}
          >
            <div className="min-w-0 space-y-0.5">
              <div className="flex h-6 items-center">
                <Skeleton className="h-5 w-52" />
              </div>
              <div className="flex h-4 items-center sm:h-5">
                <Skeleton className="h-4 w-[min(26rem,100%)]" />
              </div>
            </div>
            {Array.from({ length: 2 }).map((_, index) => (
              <div
                key={index}
                className="hidden items-center justify-center gap-1.5 pb-0.5 sm:flex"
              >
                <Skeleton className="size-4 rounded bg-slate-200/80" />
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            {PREF_LABEL_WIDTHS.map((labelWidth, index) => (
              <div
                key={index}
                className={`grid grid-cols-2 items-center gap-x-3 gap-y-3 rounded-lg border px-3 py-3 sm:gap-y-0 sm:py-2.5 ${PREF_GRID}`}
              >
                <div className="col-span-2 flex min-w-0 items-center gap-3 sm:col-span-1 sm:gap-4">
                  <Skeleton className="size-9 shrink-0 rounded-lg" />
                  <div className="flex min-w-0 flex-col gap-1.5 sm:pl-2">
                    <Skeleton className={`h-4 max-w-full ${labelWidth}`} />
                    <Skeleton
                      className={`h-3 max-w-full ${PREF_DESC_WIDTHS[index]}`}
                    />
                  </div>
                </div>
                <ChannelCell />
                <ChannelCell />
              </div>
            ))}
          </div>
        </div>

        {/* Feed card */}
        <div className="flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 lg:min-h-0">
          <div className="flex shrink-0 flex-col gap-3 border-b px-3 pt-2 sm:px-5 sm:pt-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="-mb-px flex gap-1 overflow-hidden">
              {["w-28", "w-20", "w-28"].map((width, index) => (
                <div
                  key={index}
                  className={`shrink-0 border-b-2 px-3 py-3 ${
                    index === 0 ? "border-primary/40" : "border-transparent"
                  }`}
                >
                  <Skeleton className={`my-0.5 h-4 ${width}`} />
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 pb-3 sm:flex-row sm:items-center">
              {/* The real search box has an icon inset 12px from its left
                    edge; without it the field reads as an empty panel. */}
              <div className="relative w-full sm:flex-1 xl:w-64 xl:flex-none">
                <Skeleton className="absolute top-1/2 left-3 size-4 -translate-y-1/2 rounded bg-slate-200/80" />
                <div className="h-10 w-full rounded-md border bg-card" />
              </div>
              <div className="flex gap-2 sm:shrink-0">
                <FilterButton />
                <FilterButton />
              </div>
            </div>
          </div>

          <ul className="divide-y lg:min-h-0 lg:overflow-hidden">
            {TITLE_WIDTHS.map((titleWidth, index) => (
              <li key={index} className="flex items-center gap-2 pr-2 sm:pr-3">
                <div className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 sm:pl-5">
                  <Skeleton className="size-9 shrink-0 rounded-full" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Skeleton className={`h-4 max-w-full ${titleWidth}`} />
                    <Skeleton
                      className={`h-3 max-w-full ${SUBTITLE_WIDTHS[index]}`}
                    />
                    <Skeleton className="h-3 w-20 md:hidden" />
                  </div>
                  <div className="hidden w-32 shrink-0 md:block">
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
                <span className="flex w-6 shrink-0 justify-center">
                  {index < 3 && (
                    <Skeleton className="size-2 rounded-full bg-primary/30" />
                  )}
                </span>
                <div className="flex size-8 shrink-0 items-center justify-center">
                  <Skeleton className="h-4 w-1 rounded-full bg-slate-200/80" />
                </div>
              </li>
            ))}
          </ul>

          {/* Pagination only appears past one page, which a skeleton cannot
                know, so only the count line is drawn. */}
          <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 sm:flex-row sm:px-5">
            <Skeleton className="h-5 w-52" />
          </div>
        </div>
      </div>
    </div>
  );
}
