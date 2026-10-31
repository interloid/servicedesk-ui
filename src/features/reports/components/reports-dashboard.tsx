"use client";

import React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays,
  ChartColumn,
  ChevronDown,
  Clock,
  Crown,
  Download,
  FilePlus2,
  ListChecks,
  Loader2,
  Star,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  DEFAULT_REPORT_RANGE,
  REPORT_RANGES,
  ReportRange,
  ReportsData,
} from "../types/types";
import { exportReportsPdf } from "../lib/export-pdf";
import { AgentPerformanceTable } from "./agent-performance-table";
import { PrioritySlaCard } from "./priority-sla-card";
import { ReportsSkeletonBody } from "./reports-skeleton";
import { REPORT_CARD } from "./styles";
import { TicketPerformanceCard } from "./ticket-performance-card";

interface ReportsDashboardProps {
  data: ReportsData;
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * A spreadsheet runs any cell starting with = + - @ (or a tab / CR) as a
 * formula, and agent names are typed by the agents themselves. A leading
 * apostrophe makes Excel and Sheets show the text as text.
 */
interface StatCardProps {
  icon: LucideIcon;
  iconClassName: string;
  title: string;
  value: React.ReactNode;
  caption: string;
}

function StatCard({
  icon: Icon,
  iconClassName,
  title,
  value,
  caption,
}: StatCardProps) {
  return (
    <Card className={cn(REPORT_CARD, "min-w-0")}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            iconClassName,
          )}
        >
          <Icon className="size-5" />
        </span>
        <p className="min-w-0 text-sm font-semibold leading-tight text-foreground">
          {title}
        </p>
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight tabular-nums text-foreground sm:mt-4 sm:text-3xl">
        {value}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{caption}</p>
    </Card>
  );
}

function RangePicker({
  range,
  onChange,
}: {
  range: ReportRange;
  onChange: (range: ReportRange) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-10 gap-2 bg-card px-3 text-sm">
          <CalendarDays className="size-4 text-muted-foreground" />
          {REPORT_RANGES[range].label}
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44 p-1">
        <DropdownMenuRadioGroup
          value={range}
          onValueChange={(value) => onChange(value as ReportRange)}
        >
          {(Object.keys(REPORT_RANGES) as ReportRange[]).map((key) => (
            <DropdownMenuRadioItem
              key={key}
              value={key}
              className="capitalize cursor-pointer"
            >
              {REPORT_RANGES[key].label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function ReportsDashboard({ data }: ReportsDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = React.useTransition();
  // The report body, captured by the PDF export.
  const reportRef = React.useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = React.useState(false);

  const exportPdf = async () => {
    if (!reportRef.current || exporting) return;
    setExporting(true);
    try {
      await exportReportsPdf(reportRef.current, data);
    } catch (error) {
      console.error("[reports] PDF export failed:", error);
      toast.error("Couldn't export the report. Try again.");
    } finally {
      setExporting(false);
    }
  };

  const { summary } = data;
  const rangeLabel = REPORT_RANGES[data.range].label;
  const hasData =
    summary.ticketsCreated + summary.ticketsSolved + summary.openBacklog > 0;

  const changeRange = (next: ReportRange) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === DEFAULT_REPORT_RANGE) params.delete("range");
    else params.set("range", next);
    const query = params.toString();
    startTransition(() => {
      router.push(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    });
  };

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto p-4 text-foreground sm:p-6 lg:p-8">
      <div className="mx-auto space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Reports
            </h1>
            <p className="text-sm text-muted-foreground">
              Analyze your support performance and team productivity.
            </p>
          </div>
          {/* The picker stays even when the period is empty: hiding it left a
              quiet "Last 7 days" with no way back short of editing the URL. */}
          <div className="flex flex-wrap items-center gap-2">
            {hasData && (
              <Button
                variant="outline"
                onClick={() => void exportPdf()}
                disabled={exporting || isPending}
                className="h-10 gap-2 bg-card px-3 text-sm"
              >
                {exporting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                {exporting ? "Exporting…" : "Export PDF"}
              </Button>
            )}
            <RangePicker range={data.range} onChange={changeRange} />
          </div>
        </div>

        <div ref={reportRef} aria-busy={isPending} className="space-y-6">
          {/* A new period swaps the body for its skeleton, so the old numbers
              never sit under the new period's label. The heading and picker
              stay put. */}
          {isPending ? (
            <ReportsSkeletonBody />
          ) : !hasData ? (
            <Card className="flex min-h-80 flex-col items-center justify-center gap-0 rounded-xl  bg-card px-6 py-16 text-center shadow-sm ring-1">
              <span
                aria-hidden
                className="flex size-16 items-center justify-center rounded-full bg-primary/10 ring-8 ring-primary/5"
              >
                <ChartColumn className="size-6 text-primary" />
              </span>
              <h2 className="mt-6 text-lg font-semibold text-foreground">
                No ticket activity yet
              </h2>
              <p className="mt-2 max-w-lg text-sm text-muted-foreground">
                We couldn&rsquo;t find any ticket data yet.{" "}
                <span className="sm:block">
                  Check back once tickets come in.
                </span>
              </p>
            </Card>
          ) : (
            <>
              {data.truncated && (
                <p
                  role="status"
                  className="rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning-strong"
                >
                  This period has too much activity to report on fully, so the
                  figures below are partial. Pick a shorter range.
                </p>
              )}
              <div
                data-pdf-block
                data-pdf-row
                className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5"
              >
                <StatCard
                  icon={Crown}
                  iconClassName="bg-success-soft text-success-strong"
                  title="SLA Attainment"
                  value={
                    summary.slaAttainment === null || data.truncated
                      ? "—"
                      : `${summary.slaAttainment}%`
                  }
                  caption={
                    data.truncated
                      ? "Partial data — pick a shorter range"
                      : summary.slaEligible === 0
                        ? "No tickets to judge yet"
                        : `${summary.slaMetCount} of ${plural(summary.slaEligible, "ticket")} met SLA`
                  }
                />
                <StatCard
                  icon={Clock}
                  iconClassName="bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-300"
                  title="Median First Response"
                  value={summary.medianFirstResponse ?? "—"}
                  caption={
                    summary.firstResponseCount === 0
                      ? "No replies yet"
                      : `Across ${plural(summary.firstResponseCount, "ticket")}`
                  }
                />
                <StatCard
                  icon={ListChecks}
                  iconClassName="bg-info-soft text-info-strong"
                  title="Tickets Solved"
                  value={summary.ticketsSolved}
                  caption={rangeLabel}
                />
                <StatCard
                  icon={FilePlus2}
                  iconClassName="bg-warning-soft text-warning-strong"
                  title="Tickets Created"
                  value={summary.ticketsCreated}
                  caption={rangeLabel}
                />
                <StatCard
                  icon={Star}
                  iconClassName="bg-destructive-soft text-destructive-strong"
                  title="CSAT"
                  value={
                    summary.csatAverage === null ? (
                      "—"
                    ) : (
                      <>
                        {summary.csatAverage}
                        <span className="text-xl font-semibold text-muted-foreground">
                          /5
                        </span>
                      </>
                    )
                  }
                  caption={
                    summary.csatResponses === 0
                      ? "No ratings yet"
                      : `${plural(summary.csatResponses, "rating")} · ${summary.csatPositiveRate}% positive`
                  }
                />
              </div>

              {/* Charts stacked on the left; on xl the agent table sits
                  beside them and is pinned to their height, so its rows
                  scroll inside instead of stretching the row. */}
              <div
                data-pdf-stack
                className="grid grid-cols-1 gap-6 xl:grid-cols-2"
              >
                <div className="flex min-w-0 flex-col gap-6">
                  <div data-pdf-block>
                    <TicketPerformanceCard data={data} />
                  </div>
                  <div data-pdf-block>
                    <PrioritySlaCard items={data.prioritySla} />
                  </div>
                </div>

                <div data-pdf-block className="min-w-0 xl:relative">
                  <AgentPerformanceTable
                    agents={data.agents}
                    className="xl:absolute xl:inset-0"
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
