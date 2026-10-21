/**
 * `buckets` is how many trend buckets (see RANGE_GRANULARITY) the range spans,
 * counting the current one: "Last 7 days" is today and the six days before it.
 */
export const REPORT_RANGES = {
  "7d": { label: "Last 7 days", buckets: 7 },
  "30d": { label: "Last 30 days", buckets: 30 },
  "12m": { label: "Last 12 months", buckets: 12 },
} as const;

export type ReportRange = keyof typeof REPORT_RANGES;

export const DEFAULT_REPORT_RANGE: ReportRange = "30d";

export function parseReportRange(value: string | undefined): ReportRange {
  // Own keys only: `in` also matches inherited ones (toString, __proto__),
  // whose missing `buckets` turned the date maths into an Invalid Date.
  return value && Object.hasOwn(REPORT_RANGES, value)
    ? (value as ReportRange)
    : DEFAULT_REPORT_RANGE;
}

export type TrendGranularity = "day" | "month";

/**
 * Bucket size per range. Daily bars across a year are unreadable, and a single
 * monthly bar for a week says nothing, so each range gets the one granularity
 * that produces a useful number of bars.
 */
export const RANGE_GRANULARITY: Record<ReportRange, TrendGranularity> = {
  "7d": "day",
  "30d": "day",
  "12m": "month",
};

export interface TrendPoint {
  /** Short axis label, e.g. "Oct 3" or "Oct". */
  label: string;
  /** Longer label for the tooltip, e.g. "Oct 3, 2026". */
  title: string;
  opened: number;
  resolved: number;
}

export interface PrioritySlaMetric {
  level: string;
  metPercentage: number | null;
  met: number;
  /** Tickets that could be judged: answered, or closed without an answer. */
  eligible: number;
  ticketsCount: number;
}

export interface AgentLoadMetric {
  id: string;
  name: string;
  email: string;
  initials: string;
  open: number;
  solved: number;
  medianFirstReply: string | null;
  /** Raw minutes behind medianFirstReply, so the column can sort. */
  medianFirstReplyMinutes: number | null;
  slaMet: number | null;
  slaMetCount: number;
  slaEligible: number;
  /** Mean CSAT score out of 5, or null when nobody has rated their work. */
  csatAverage: number | null;
  csatResponses: number;
  /** No longer an active member: disabled or removed after doing the work. */
  inactive: boolean;
}

export interface ReportsSummary {
  slaAttainment: number | null;
  slaMetCount: number;
  slaEligible: number;
  medianFirstResponse: string | null;
  /** Tickets in the range that have a first response to take a median of. */
  firstResponseCount: number;
  ticketsSolved: number;
  ticketsCreated: number;
  /** Tickets open right now, whenever they were raised. */
  openBacklog: number;
  /** Mean score out of 5 across every rated resolution. */
  csatAverage: number | null;
  /**
   * Share of ratings that were 4 or 5, as a percentage. The headline average is
   * easier to read, but this is the number that actually moves when service
   * degrades — a wave of 1s barely dents a mean built on hundreds of 5s.
   */
  csatPositiveRate: number | null;
  csatResponses: number;
}

export interface ReportsData {
  range: ReportRange;
  summary: ReportsSummary;
  trend: TrendPoint[];
  prioritySla: PrioritySlaMetric[];
  agents: AgentLoadMetric[];
  /**
   * A list hit the row cap, so every figure is built from a partial set. The
   * dashboard says so rather than printing confident numbers from it.
   */
  truncated: boolean;
}

/**
 * Reports are a paid feature: the Free plan's features_json has no reporting
 * entry, and the plans page sells reporting from Pro up. Matched on the plan
 * name because that is the one field the sidebar's identity and the page's
 * server gate both have.
 */
export function planIncludesReports(planName: string | null | undefined) {
  return (planName ?? "Free").trim().toLowerCase() !== "free";
}
