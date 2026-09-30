import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Without this file Next.js has no fallback for the async page beside it, so a
 * click leaves the previous screen up until every query has finished — which
 * reads as a dead link and gets clicked again.
 *
 * Mirrors CustomersTable: the heading block, the search field, and the
 * bordered table -- header row, customer rows, and the footer with its
 * pagination. The frame is the real bordered box, so it does not change colour
 * when the data lands.
 *
 * The row widths are the real table's column ladder, all four steps of it. The
 * table stays a table at every width and drops a column at a time as space runs
 * out, so the skeleton has to drop them at the same steps: showing the Added
 * column before the last step, or Company before the second, would overflow and
 * resize the frame when the data landed. The steps are container queries
 * against the scroll region, exactly as in the table, and the frame's width
 * floor is the same 448px.
 *
 * The Customer cell is two lines -- name over address -- so it is drawn as two
 * stacked bars for the same reason.
 */

/**
 * One entry per column of the real table, and the only place they are written
 * down: `width` has to match the table's, or the frame reshapes when the data
 * lands. Kept in step by the same arithmetic the table is -- see the width
 * assertion at the foot of customers-table.tsx.
 *
 * `width` carries width and visibility only. The cells' `px-4` and the one
 * right-aligned column are applied where they are rendered, in one place each:
 * a flex row lays its children out with `gap`, and a gap here would be added on
 * top of percentages that already total 100%, so the skeleton would be 80px
 * wider than the table and every column after the first would sit where the
 * table's does not.
 */
const COLUMNS = [
  {
    id: "customer",
    width: "w-[58%] @lg:w-[42%] @2xl:w-[31%] @4xl:w-[26%]",
    head: "w-14",
    bars: ["w-24", "w-20", "w-28", "w-16", "w-24"],
  },
  {
    id: "company",
    width: "hidden @lg:block @lg:w-[19%] @2xl:w-[14%] @4xl:w-[14%]",
    head: "w-16",
    bars: ["w-16", "w-16", "w-12", "w-14", "w-16"],
  },
  {
    id: "tickets",
    width: "w-[25%] @lg:w-[22%] @2xl:w-[19%] @4xl:w-[16%]",
    head: "w-14",
    bars: ["w-5", "w-5", "w-5", "w-5", "w-4"],
    right: true,
  },
  {
    id: "lastActivity",
    width: "hidden @2xl:block @2xl:w-[22%] @4xl:w-[20%]",
    head: "w-20",
    bars: ["w-20", "w-20", "w-20", "w-20", "w-20"],
  },
  {
    id: "added",
    width: "hidden @4xl:block @4xl:w-[13%]",
    head: "w-10",
    bars: ["w-20", "w-20", "w-20"],
  },
  {
    id: "csat",
    width: "w-[17%] @lg:w-[17%] @2xl:w-[14%] @4xl:w-[11%]",
    head: "w-10",
    bars: ["w-8", "w-8", "w-8", "w-8", "w-8"],
  },
];

/**
 * The address line under the name. Only the Customer cell has a second line,
 * and keeping it out of the column array stops the other six columns being
 * typed as though they might.
 */
const CUSTOMER_SUB_BARS = ["w-32", "w-28", "w-32", "w-24", "w-28"];

const ROWS = [0, 1, 2, 3, 4];

export default function Loading() {
  return (
    <div className="h-full overflow-y-auto p-4 sm:p-6 lg:p-8">
      <div className="mx-auto flex w-full flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-5 w-80 max-w-full" />
            <Skeleton className="h-3 w-44" />
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-md sm:flex-1">
            <Skeleton className="absolute top-1/2 left-3 size-4 -translate-y-1/2 rounded bg-slate-200/80" />
            <div className="h-10 w-full rounded-lg border bg-card" />
          </div>
        </div>

        <div className="overflow-hidden rounded-[14px] border bg-card">
          <div className="@container overflow-x-auto">
            <div className="flex min-w-md flex-col">
              {/* The real header is 44px tall and every cell carries px-4, so
                  the padding goes on the columns here rather than as a gap:
                  a gap is added on top of the percentages, and the frame would
                  be 80px wider than the table it stands in for. */}
              <div className="flex h-11 items-center border-b">
                {COLUMNS.map((column) => (
                  <div
                    key={column.id}
                    className={cn(
                      column.width,
                      "px-4",
                      column.right && "text-right",
                    )}
                  >
                    <Skeleton
                      className={cn(
                        "h-3",
                        column.head,
                        column.right && "ml-auto",
                      )}
                    />
                  </div>
                ))}
              </div>

              {ROWS.map((row) => (
                /* The real row is the height of its 36px avatar between two
                   12px cell paddings, which is 60px, not 64. */
                <div
                  key={row}
                  className="flex h-15 items-center border-b border-muted last:border-0"
                >
                  {COLUMNS.map((column, index) => (
                    <div
                      key={column.id}
                      className={cn(
                        column.width,
                        "px-4",
                        column.right && "text-right",
                      )}
                    >
                      {index === 0 ? (
                        <div className="flex items-center gap-3">
                          <Skeleton className="size-9 shrink-0 rounded-full" />
                          {/* Name over address, as in the real cell. The
                              address is shorter and lighter, like a caption. */}
                          <div className="flex min-w-0 flex-col gap-1.5">
                            <Skeleton
                              className={`h-4 ${column.bars[row % column.bars.length]}`}
                            />
                            <Skeleton
                              className={`h-3 ${CUSTOMER_SUB_BARS[row % CUSTOMER_SUB_BARS.length]} bg-slate-200/80`}
                            />
                          </div>
                        </div>
                      ) : (
                        <Skeleton
                          className={cn(
                            "h-4",
                            column.bars[row % column.bars.length],
                            column.right && "ml-auto",
                          )}
                        />
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 sm:flex-row">
            <Skeleton className="h-4 w-40" />
            <div className="flex gap-1.5">
              <Skeleton className="size-9 rounded-lg" />
              <Skeleton className="size-9 rounded-lg" />
              <Skeleton className="size-9 rounded-lg" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
