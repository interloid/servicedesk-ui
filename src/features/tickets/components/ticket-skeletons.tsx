import { Card, CardContent } from "@/components/ui/card";
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

/*
 * Route-level loading states for the ticket queue and a single ticket. Each
 * mirrors the component it stands in for -- TicketsTable and TicketDetailView
 * -- with the same wrappers, cards, column widths and control heights, so
 * nothing jumps when the real content streams in. Every bar is sized to the
 * line box of the text it stands for (h-5 for text-sm, h-4 for text-xs).
 */

/* ───────────────────────── Ticket queue ───────────────────────── */

/** Subject widths, varied so the rows don't read as a striped pattern. */
const SUBJECT_WIDTHS = ["w-[70%]", "w-[55%]", "w-[80%]", "w-[62%]", "w-[48%]"];
const REQUESTER_WIDTHS = ["w-24", "w-28", "w-20", "w-32", "w-24"];
const COMPANY_WIDTHS = ["w-16", "w-20", "", "w-24", "w-14"];
const ASSIGNEE_WIDTHS = ["w-20", "w-24", "w-16", "w-24", "w-20"];

const ROWS = [0, 1, 2, 3, 4, 5, 6, 7];

/** The real table's head: same widths, so the columns land in place. */
const HEADS = [
  { id: "id", width: "w-24", bar: "w-12" },
  { id: "subject", width: "", bar: "w-16" },
  { id: "requester", width: "w-48", bar: "w-20" },
  { id: "priority", width: "w-28", bar: "w-16" },
  { id: "assignee", width: "w-44", bar: "w-16" },
  { id: "status", width: "w-28", bar: "w-12" },
  { id: "sla", width: "w-36", bar: "w-8", right: true },
];

/** A filter's label over its 40px field. */
function FilterField({ className }: { className: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Skeleton className="h-4 w-14" />
      <div className="h-10 w-full rounded-md border border-slate-200 bg-white" />
    </div>
  );
}

export function TicketsTableSkeleton() {
  return (
    <div
      className="h-full overflow-y-auto p-4 font-sans sm:p-6 lg:p-8"
      aria-busy
      aria-label="Loading tickets"
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            {/* "Tickets" (text-2xl) over the count line. */}
            <Skeleton className="h-8 w-28" />
            <Skeleton className="mt-0.5 h-4 w-52 sm:h-5" />
          </div>

          {/* Columns, New ticket, Import from CSV. */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Skeleton className="h-10 w-26 rounded-md" />
            <Skeleton className="h-10 w-28 rounded-md" />
            <Skeleton className="h-10 w-56 rounded-md" />
          </div>
        </div>

        {/* All, New, Open, Resolved. */}
        <div className="flex items-center gap-1 border-b border-slate-200 pb-3">
          <Skeleton className="h-8 w-16 rounded-md" />
          <Skeleton className="h-8 w-18 rounded-md" />
          <Skeleton className="h-8 w-18 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>

        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:gap-4">
          <FilterField className="w-full sm:w-64 md:w-80" />
          <div className="grid grid-cols-2 gap-3 sm:flex sm:space-x-4">
            <FilterField className="w-full sm:w-36" />
            <FilterField className="w-full sm:w-36" />
          </div>
        </div>

        <Card className="overflow-hidden border-slate-200/80 p-0 shadow-sm ring-0">
          <CardContent className="p-0">
            <div className="overflow-x-auto rounded-lg border border-slate-200/80 bg-white">
              <Table>
                <TableHeader className="border-b border-slate-200/80 bg-slate-50/50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-12 px-4">
                      <Skeleton className="mx-auto size-4 rounded-md" />
                    </TableHead>
                    {HEADS.map((head) => (
                      <TableHead
                        key={head.id}
                        className={cn("px-4", head.width)}
                      >
                        <Skeleton
                          className={cn(
                            "h-3",
                            head.bar,
                            head.right && "ml-auto",
                          )}
                        />
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>

                <TableBody className="divide-y divide-slate-100">
                  {ROWS.map((row) => {
                    const company = COMPANY_WIDTHS[row % COMPANY_WIDTHS.length];
                    return (
                      <TableRow key={row} className="hover:bg-transparent">
                        <TableCell className="px-4">
                          <Skeleton className="mx-auto size-4 rounded-md" />
                        </TableCell>
                        <TableCell className="px-4">
                          <Skeleton className="my-1 h-5 w-10" />
                        </TableCell>
                        <TableCell className="px-4">
                          <Skeleton
                            className={cn(
                              "my-1 h-5",
                              SUBJECT_WIDTHS[row % SUBJECT_WIDTHS.length],
                            )}
                          />
                        </TableCell>
                        {/* Name over company; the real cell drops the
                            company line when there is none. */}
                        <TableCell className="px-4">
                          <div className="flex flex-col gap-1 py-1">
                            <Skeleton
                              className={cn(
                                "h-4.5",
                                REQUESTER_WIDTHS[row % REQUESTER_WIDTHS.length],
                              )}
                            />
                            {company && (
                              <Skeleton
                                className={cn("h-3.5 bg-slate-200/70", company)}
                              />
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="px-4">
                          <Skeleton className="my-1 h-6 w-18 rounded-full" />
                        </TableCell>
                        <TableCell className="px-4">
                          <div className="flex items-center gap-2 py-1">
                            <Skeleton className="size-5 shrink-0 rounded-full" />
                            <Skeleton
                              className={cn(
                                "h-5",
                                ASSIGNEE_WIDTHS[row % ASSIGNEE_WIDTHS.length],
                              )}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="px-4">
                          <Skeleton className="my-1 h-6 w-16 rounded-full" />
                        </TableCell>
                        <TableCell className="px-4">
                          <Skeleton className="my-1 ml-auto h-5.5 w-24 rounded-full" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* "Showing x of y", rows per page, and the pager. */}
        <div className="flex flex-col items-center justify-between gap-3 px-4 py-3 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="ml-4 hidden h-4 w-20 sm:block" />
            <Skeleton className="h-8 w-18 rounded-md" />
          </div>
          <div className="flex items-center gap-1">
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
            <Skeleton className="size-8 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Ticket view ───────────────────────── */

const CARD = "border-slate-200 bg-white shadow-sm ring-0";

/**
 * The thread as it usually opens: the customer's message on the left, a
 * reply on the right, and a follow-up. Lines are the bubble's text lines.
 */
const THREAD: { customer: boolean; name: string; lines: string[] }[] = [
  { customer: true, name: "w-28", lines: ["w-72", "w-64", "w-40"] },
  { customer: false, name: "w-24", lines: ["w-64", "w-48"] },
  { customer: true, name: "w-28", lines: ["w-56"] },
];

function ThreadMessage({
  customer,
  name,
  lines,
}: {
  customer: boolean;
  name: string;
  lines: string[];
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2",
        customer ? "items-start" : "items-end",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2.5",
          !customer && "flex-row-reverse",
        )}
      >
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <div
          className={cn(
            "flex flex-col gap-1",
            customer ? "items-start" : "items-end",
          )}
        >
          <Skeleton className={cn("h-4", name)} />
          <Skeleton className="h-3 w-20 bg-slate-200/70" />
        </div>
      </div>
      {/* The bubble, with the real one's corner cut on the speaker's side. */}
      <div
        className={cn(
          "flex w-full max-w-[85%] flex-col gap-2 rounded-2xl px-3.5 py-3 sm:max-w-[75%]",
          customer
            ? "items-start rounded-tl-sm bg-slate-100"
            : "items-end rounded-tr-sm bg-brand-accent/10",
        )}
      >
        {lines.map((width, i) => (
          <Skeleton
            key={i}
            className={cn("h-3.5 max-w-full bg-slate-200/80", width)}
          />
        ))}
      </div>
    </div>
  );
}

/** A sidebar field: label over a 40px select. */
function SidebarField({ label }: { label: string }) {
  return (
    <div className="grid gap-2">
      <Skeleton className={cn("h-4", label)} />
      <div className="h-10 w-full rounded-md border border-slate-200 bg-white" />
    </div>
  );
}

/** One SLA clock: label and badge, the progress bar, the footnote. */
function SlaClock() {
  return (
    <div className="space-y-2 rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
      <Skeleton className="h-3.5 w-36 bg-slate-200/70" />
    </div>
  );
}

export function TicketDetailSkeleton() {
  return (
    <div
      className="flex h-full flex-col overflow-y-auto p-4 font-sans sm:p-6 lg:p-8"
      aria-busy
      aria-label="Loading ticket"
    >
      <div className="mx-auto flex w-full flex-1 flex-col gap-6 lg:min-h-0">
        {/* Back to queue. */}
        <Skeleton className="h-5 w-28" />

        <div className="space-y-2">
          {/* Number and SLA headline badge. */}
          <div className="flex items-center gap-3">
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
          {/* Subject: text-2xl. */}
          <Skeleton className="h-8 w-96 max-w-full" />
          {/* Created by … · last activity. */}
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:min-h-112 lg:flex-1 lg:grid-cols-3">
          <section className="flex h-[75dvh] min-h-112 flex-col overflow-hidden rounded-xl bg-white shadow-sm lg:col-span-2 lg:h-auto lg:min-h-0">
            <div className="min-h-0 flex-1 space-y-4 overflow-hidden px-3 py-4 sm:px-5 sm:py-5">
              {THREAD.map((message, i) => (
                <ThreadMessage key={i} {...message} />
              ))}
            </div>

            {/* The composer: reply type, the text box, Attach and Send. */}
            <div className="shrink-0 border-t border-slate-200 bg-slate-50/60">
              <div className="flex items-center gap-2 px-3 pt-3 sm:px-4">
                <Skeleton className="h-9 w-24 rounded-lg" />
                <Skeleton className="h-9 w-24 rounded-lg" />
              </div>
              <div className="px-3 pt-2 sm:px-4">
                <div className="h-16 w-full rounded-lg border border-slate-200 bg-white" />
              </div>
              <div className="flex flex-col items-stretch justify-between gap-2 px-3 pt-2 pb-3 sm:flex-row sm:items-center sm:px-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-22 rounded-md" />
                  <Skeleton className="hidden h-4 w-52 sm:block" />
                </div>
                <Skeleton className="h-10 w-full rounded-lg sm:w-40" />
              </div>
            </div>
          </section>

          <div className="space-y-4 lg:min-h-0 lg:overflow-y-auto">
            {/* Requester, status, priority, assignee, tags. */}
            <Card className={CARD}>
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                  <Skeleton className="size-9 shrink-0 rounded-full" />
                  <div className="flex flex-col gap-1">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3.5 w-20 bg-slate-200/70" />
                  </div>
                </div>
                <SidebarField label="w-12" />
                <SidebarField label="w-14" />
                <SidebarField label="w-16" />
                <SidebarField label="w-10" />
              </CardContent>
            </Card>

            {/* SLA: policy, how it counts, and the two clocks. */}
            <Card className={CARD}>
              <CardContent className="space-y-4 p-5">
                <Skeleton className="h-3.5 w-8" />
                <div className="grid gap-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3.5 w-48 bg-slate-200/70" />
                </div>
                <SlaClock />
                <SlaClock />
              </CardContent>
            </Card>

            {/* Attachments. */}
            <Card className={CARD}>
              <CardContent className="space-y-3 p-5">
                <Skeleton className="h-3.5 w-24" />
                <div className="flex items-center gap-3 rounded-lg border border-slate-200 p-2.5">
                  <Skeleton className="size-8 shrink-0 rounded" />
                  <div className="flex flex-col gap-1">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-12 bg-slate-200/70" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
