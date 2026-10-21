import Link from "next/link";
import { ArrowRight, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { tenantPath } from "@/lib/tenancy";
import {
  AgentLoadMetric,
  DEFAULT_REPORT_RANGE,
  ReportsData,
  TrendPoint,
} from "../types/types";
import ReportsDashboard from "./reports-dashboard";

/**
 * Made-up figures for the blurred backdrop. A Free tenant's real numbers are
 * never fetched: the blur is decoration, and anything under it can still be
 * read from the page source.
 */
const SAMPLE_TREND: TrendPoint[] = Array.from({ length: 30 }, (_, i) => {
  const day = i + 1;
  return {
    label: `Day ${day}`,
    title: `Day ${day}`,
    opened: [3, 5, 2, 6, 4, 7, 3][i % 7],
    resolved: [2, 4, 3, 5, 4, 6, 2][i % 7],
  };
});

const sampleAgent = (
  id: string,
  name: string,
  open: number,
  solved: number,
  slaMet: number,
): AgentLoadMetric => ({
  id,
  name,
  email: `${id}@example.com`,
  initials: name
    .split(" ")
    .map((part) => part[0])
    .join(""),
  open,
  solved,
  medianFirstReply: "1h 12m",
  medianFirstReplyMinutes: 72,
  slaMet,
  slaMetCount: Math.round((solved * slaMet) / 100),
  slaEligible: solved,
  csatAverage: 4.6,
  csatResponses: 12,
  inactive: false,
});

const SAMPLE_DATA: ReportsData = {
  range: DEFAULT_REPORT_RANGE,
  summary: {
    slaAttainment: 92,
    slaMetCount: 110,
    slaEligible: 120,
    medianFirstResponse: "48m",
    firstResponseCount: 120,
    ticketsSolved: 112,
    ticketsCreated: 130,
    openBacklog: 18,
    csatAverage: 4.6,
    csatPositiveRate: 91,
    csatResponses: 64,
  },
  trend: SAMPLE_TREND,
  prioritySla: [
    {
      level: "Urgent",
      metPercentage: 84,
      met: 21,
      eligible: 25,
      ticketsCount: 25,
    },
    {
      level: "High",
      metPercentage: 90,
      met: 27,
      eligible: 30,
      ticketsCount: 30,
    },
    {
      level: "Normal",
      metPercentage: 95,
      met: 38,
      eligible: 40,
      ticketsCount: 40,
    },
    {
      level: "Low",
      metPercentage: 96,
      met: 24,
      eligible: 25,
      ticketsCount: 25,
    },
  ],
  agents: [
    sampleAgent("sample-1", "Alex Morgan", 6, 38, 94),
    sampleAgent("sample-2", "Sam Lee", 4, 31, 90),
    sampleAgent("sample-3", "Jordan Ray", 8, 27, 88),
  ],
  truncated: false,
};

interface ReportsLockedProps {
  tenantSlug: string;
  /** Only a Tenant Admin can open Plans & pricing; a Manager is told who can. */
  canUpgrade: boolean;
}

/** What a Free tenant sees at /reports: the dashboard's shape, blurred, under a lock. */
export function ReportsLocked({ tenantSlug, canUpgrade }: ReportsLockedProps) {
  return (
    <div className="relative h-full min-h-[calc(100svh-4rem)] overflow-hidden">
      <div
        aria-hidden
        inert
        className="pointer-events-none select-none opacity-60 blur-[6px]"
      >
        <ReportsDashboard data={SAMPLE_DATA} />
      </div>

      <div className="absolute inset-0 flex items-center justify-center bg-background/30 px-4">
        {/* Frosted card over the blur: tinted lock badge, headline, and the
            upgrade as a filled button. */}
        <div className="flex w-full max-w-lg flex-col items-center rounded-2xl bg-white/80 px-6 py-10 text-center shadow-lg ring-1 ring-black/5 backdrop-blur-md sm:px-10">
          <span
            aria-hidden
            className="flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <Lock className="size-9" />
          </span>
          <h1 className="mt-6 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Reports are locked on the Free plan
          </h1>
          <p className="mt-2 text-base text-muted-foreground">
            {canUpgrade
              ? "Upgrade to Pro to view support analytics."
              : "Ask a Tenant Admin to upgrade to Pro to view support analytics."}
          </p>
          {canUpgrade && (
            <Button
              asChild
              className="mt-6 h-12 gap-2 rounded-xl px-10 text-base font-semibold"
            >
              <Link href={tenantPath(tenantSlug, "/account/plans")}>
                View plans
                <ArrowRight aria-hidden className="size-5" />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
