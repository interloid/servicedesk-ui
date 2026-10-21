import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ROW_GRID } from "./row-grid";

/*
 * Route-level loading state for the saved views page. It mirrors the list —
 * same wrappers, section cards, column grid and row heights — so nothing jumps
 * when the real content streams in. Each bar sits in a box of the text's line
 * height, so a row is exactly as tall as the row that replaces it.
 */

/** Widths for the name and summary lines, varied so rows don't look stamped. */
const NAME_WIDTHS = ["w-28", "w-36", "w-24", "w-32"];
const SUMMARY_WIDTHS = ["w-48", "w-40", "w-56", "w-44"];

/** A bar vertically centred in a box of the given line height. */
function Line({ box, bar }: { box: string; bar: string }) {
  return (
    <div className={cn("flex items-center", box)}>
      <Skeleton className={cn("max-w-full", bar)} />
    </div>
  );
}

function RowSkeleton({ index, hasMenu }: { index: number; hasMenu: boolean }) {
  return (
    <li className={cn(ROW_GRID, "px-3 py-3.5 sm:px-6 sm:py-4")}>
      {/* Drag handle — desktop only, like the real grip. */}
      <div className="hidden size-8 items-center justify-center justify-self-center md:flex">
        <Skeleton className="h-4 w-2.5 rounded-sm" />
      </div>

      {/* Order badge. */}
      <Skeleton className="h-8 w-full rounded-md" />

      {/* Bookmark icon. */}
      <div className="flex justify-center">
        <Skeleton className="size-5 rounded" />
      </div>

      {/* Name, summary, and the phone-only count line. */}
      <div className="min-w-0">
        <Line box="h-5" bar={cn("h-3.5", NAME_WIDTHS[index % 4])} />
        <Line box="mt-0.5 h-4" bar={cn("h-3", SUMMARY_WIDTHS[index % 4])} />
        <Line box="mt-1 h-4 md:hidden" bar="h-2.5 w-24" />
      </div>

      {/* Tickets pill. */}
      <div className="hidden md:block">
        <Skeleton className="h-7 w-20 rounded-full" />
      </div>

      {/* Last updated. */}
      <div className="hidden md:block">
        <Line box="h-5" bar="h-3.5 w-20" />
      </div>

      {/* Open + menu. Phones always show the menu; desktop only for views
          the user can manage. */}
      <div className="flex items-center justify-end gap-1.5 sm:gap-2">
        <Skeleton className="h-8 w-13 rounded-lg" />
        <Skeleton
          className={cn("size-8 rounded-lg", !hasMenu && "md:hidden")}
        />
      </div>
    </li>
  );
}

function SectionSkeleton({
  tone,
  titleWidth,
  descriptionWidth,
  rows,
  hasMenu,
}: {
  tone: "teal" | "blue";
  titleWidth: string;
  descriptionWidth: string;
  rows: number;
  hasMenu: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <header className="flex items-center gap-3 px-4 py-4 sm:px-6">
        {/* The icon tile keeps its tint so the two sections read apart. */}
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            tone === "teal" ? "bg-teal-50" : "bg-blue-50",
          )}
        >
          <Skeleton
            className={cn(
              "size-5 rounded",
              tone === "teal" ? "bg-teal-100" : "bg-blue-100",
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <Line box="h-6" bar={cn("h-4", titleWidth)} />
          <Line box="h-4" bar={cn("h-3", descriptionWidth)} />
        </div>
      </header>

      <div
        aria-hidden
        className={cn(
          ROW_GRID,
          "hidden h-10 border-y border-slate-100 bg-slate-50 px-4 sm:px-6 md:grid",
        )}
      >
        <span />
        <Skeleton className="h-2.5 w-9 justify-self-center" />
        <span />
        <Skeleton className="h-2.5 w-16" />
        <Skeleton className="h-2.5 w-12" />
        <Skeleton className="h-2.5 w-20" />
        <Skeleton className="h-2.5 w-12 justify-self-end" />
      </div>

      <ul className="divide-y divide-slate-100 border-t border-slate-100 md:border-t-0">
        {Array.from({ length: rows }, (_, i) => (
          <RowSkeleton key={i} index={i} hasMenu={hasMenu} />
        ))}
      </ul>
    </section>
  );
}

export function SavedViewsSkeleton() {
  return (
    <div
      className="h-full bg-slate-50/50 px-4 py-5 sm:p-6 lg:p-8"
      aria-busy
      aria-label="Loading saved views"
    >
      <div className="mx-auto flex flex-col gap-5 sm:gap-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <Line box="h-7 sm:h-8" bar="h-6 w-36 sm:h-7" />
            <Line box="mt-1 h-5" bar="h-3.5 w-72 max-w-full" />
          </div>
          <Skeleton className="h-10 w-full shrink-0 rounded-lg sm:w-30" />
        </header>

        {/* The four built-in views: no menu on desktop. */}
        <SectionSkeleton
          tone="teal"
          titleWidth="w-28"
          descriptionWidth="w-72"
          rows={4}
          hasMenu={false}
        />

        <SectionSkeleton
          tone="blue"
          titleWidth="w-40"
          descriptionWidth="w-80"
          rows={2}
          hasMenu
        />
      </div>
    </div>
  );
}
