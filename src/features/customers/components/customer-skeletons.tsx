import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Skeletons for a customer's profile, split the way the route renders:
 *
 * - CustomerHeaderSkeleton stands in for the header and tab strip, which live
 *   in the route's layout and stay on screen across tab and page changes;
 * - CustomerOverviewSkeleton and CustomerTicketsSkeleton stand in for the tab
 *   body, so switching to Tickets shows a ticket table loading rather than the
 *   Overview's cards.
 *
 * They mirror CustomerDetail piece for piece, with the same container queries,
 * so the layout lands in place at every width. Every bar is sized to the line
 * box of the text it stands for (h-5 for text-sm, h-4 for text-xs, and so on),
 * so nothing moves when the data lands.
 */

const CARD = "rounded-2xl border bg-card shadow-xs";

const HEAD =
  "h-11 px-4 text-xs font-semibold text-muted-foreground last:border-r-0";
const CELL = "px-4 py-4 text-sm last:border-r-0";

const SUBJECT_WIDTHS = ["w-[85%]", "w-[70%]", "w-[78%]", "w-[62%]", "w-[74%]"];

function SectionHeading({ width }: { width: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-4 sm:px-6">
      <Skeleton className="size-9 shrink-0 rounded-lg" />
      <Skeleton className={cn("h-6", width)} />
    </div>
  );
}

function StatCard({ value }: { value: string }) {
  return (
    <div className={cn(CARD, "@container min-w-0 p-3.5 @2xl:p-5")}>
      <div className="flex flex-col gap-3 @[15rem]:flex-row @[15rem]:items-start @[15rem]:gap-4">
        <Skeleton className="size-10 shrink-0 rounded-xl @[15rem]:size-12" />
        <div className="min-w-0 flex-1">
          {/* label, value, hint */}
          <Skeleton className="h-5 w-24 max-w-full" />
          <Skeleton className={cn("mt-1 h-6 @[15rem]:h-7.5", value)} />
          <Skeleton className="mt-1 h-5 w-16" />
        </div>
      </div>
    </div>
  );
}

/** The primary contact: avatar, name, email, "Primary contact". */
function ContactRow() {
  return (
    <div className="flex items-start gap-3 rounded-xl border p-3.5">
      <Skeleton className="size-12 shrink-0 rounded-full @md:size-14" />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2 self-center @md:flex-row @md:justify-between">
        <div className="w-full min-w-0 @md:w-auto @md:flex-1">
          <Skeleton className="h-6 w-36 max-w-full" />
          <Skeleton className="mt-0.5 h-5 w-48 max-w-full" />
          <Skeleton className="mt-1 h-5 w-28" />
        </div>
      </div>
    </div>
  );
}

/** A copyable detail row: icon, label, value, and the square copy button. */
function DetailRow({
  value,
  description = false,
}: {
  value: string;
  /** The portal row carries a line of explanation under the URL. */
  description?: boolean;
}) {
  return (
    <div className="flex items-start gap-3.5 py-3.5">
      <Skeleton className="mt-0.5 size-5 shrink-0 rounded" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-5 w-20" />
        <Skeleton className={cn("mt-0.5 h-5 max-w-full", value)} />
        {description ? (
          <>
            <Skeleton className="mt-2 h-4 w-full" />
            <Skeleton className="mt-1 h-4 w-2/3" />
          </>
        ) : null}
      </div>
      <Skeleton className="size-9 shrink-0 rounded-md" />
    </div>
  );
}

function TicketTable({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Table className="min-w-190 table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={cn(HEAD, "w-24")}>
              <Skeleton className="h-4 w-3" />
            </TableHead>
            <TableHead className={HEAD}>
              <Skeleton className="h-4 w-14" />
            </TableHead>
            <TableHead className={cn(HEAD, "w-28")}>
              <Skeleton className="h-4 w-12" />
            </TableHead>
            <TableHead className={cn(HEAD, "w-36")}>
              <Skeleton className="h-4 w-14" />
            </TableHead>
            <TableHead className={cn(HEAD, "w-36")}>
              <Skeleton className="h-4 w-14" />
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SUBJECT_WIDTHS.map((width) => (
            <TableRow key={width} className="hover:bg-transparent">
              <TableCell className={CELL}>
                <Skeleton className="h-5 w-7" />
              </TableCell>
              <TableCell className={CELL}>
                <Skeleton className={cn("h-5", width)} />
              </TableCell>
              <TableCell className={CELL}>
                <Skeleton className="h-5.5 w-14 rounded-full" />
              </TableCell>
              <TableCell className={CELL}>
                <Skeleton className="h-5 w-24" />
              </TableCell>
              <TableCell className={CELL}>
                <Skeleton className="h-5 w-24" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function CustomerHeaderSkeleton() {
  return (
    <>
      <div>
        <Skeleton className="h-5 w-24" />

        <div className="mt-4 flex min-w-0 items-center gap-3.5 sm:gap-5">
          {/* Carries the same white edge and green hairline as the real
              avatar, so the photo does not appear to grow a ring when it
              lands. The ring is toned down here because the Skeleton's own
              fill is already flat: a full-strength emerald ring on a grey
              circle is darker than the ring on a photo it stands in for. */}
          <Skeleton className="size-14 shrink-0 rounded-full border-2 border-white ring-1 ring-emerald-200/70 sm:size-20 dark:ring-emerald-800/70" />
          <div className="min-w-0 flex-1">
            {/* Name: text-xl, then text-3xl from sm. */}
            <Skeleton className="h-7 w-48 max-w-full sm:h-9 sm:w-64" />
            {/* Email and company: stacked on a phone, one line from sm. */}
            <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2.5">
              <Skeleton className="h-5 w-52 max-w-full sm:h-6" />
              <Skeleton className="h-5 w-20 sm:h-6" />
            </div>
            <Skeleton className="mt-1 h-5 w-44" />
          </div>
        </div>
      </div>

      <nav aria-hidden className="-mb-2 border-b">
        <ul className="-mb-px flex gap-6">
          <li className="border-b-2 border-brand-strong pb-3">
            <Skeleton className="h-5 w-16" />
          </li>
          <li className="flex items-center gap-1.5 border-b-2 border-transparent pb-3">
            <Skeleton className="h-5 w-12" />
            <Skeleton className="h-4 w-5 rounded-md" />
          </li>
        </ul>
      </nav>
    </>
  );
}

export function CustomerOverviewSkeleton() {
  return (
    <>
      {/* Open tickets, Total tickets, Company, CSAT. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 @2xl:gap-4 @5xl:grid-cols-4">
        <StatCard value="w-8" />
        <StatCard value="w-8" />
        <StatCard value="w-24 max-w-full" />
        <StatCard value="w-20" />
      </div>

      <div className="grid grid-cols-1 gap-4 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.65fr)]">
        <section className={cn(CARD, "@container flex min-w-0 flex-col")}>
          <SectionHeading width="w-48 max-w-[60%]" />
          <div className="flex flex-1 flex-col px-5 pb-5 sm:px-6 sm:pb-6">
            <ContactRow />
            <div className="mt-2 divide-y">
              <DetailRow value="w-52" />
              <DetailRow value="w-16" />
              <DetailRow value="w-64" description />
            </div>
          </div>
        </section>

        <section className={cn(CARD, "min-w-0 overflow-hidden")}>
          <SectionHeading width="w-36" />
          <TicketTable className="border-t" />
        </section>
      </div>
    </>
  );
}

/** The Tickets tab: the card is the table, as on the real tab. */
export function CustomerTicketsSkeleton() {
  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <TicketTable />
    </section>
  );
}
