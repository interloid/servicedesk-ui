import { toBusinessHoursOption } from "@/features/sla-policies/service/sla.service";
import { getTenantIdBySlug } from "@/features/tenancy/services/tenant-resolver";
import type { Tables } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  AgentLoadMetric,
  PrioritySlaMetric,
  RANGE_GRANULARITY,
  REPORT_RANGES,
  ReportRange,
  ReportsData,
  TrendGranularity,
  TrendPoint,
} from "../types/types";
import {
  businessMinutesBetween,
  isValidTimeZone,
  WorkCalendar,
  zonedDay,
  zonedInstant,
} from "./business-time";

const RESOLVED_STATUSES = ["resolved", "closed"];
const OPEN_STATUSES = ["new", "open", "pending", "on_hold"];

const PRIORITY_LEVELS = ["Urgent", "High", "Normal", "Low"] as const;
const PRIORITY_KEYS = ["urgent", "high", "normal", "low"] as const;

// Picked from the generated schema, so a renamed or retyped column fails the
// build here instead of quietly zeroing a figure.
type TicketRow = Pick<
  Tables<"tickets">,
  | "id"
  | "status"
  | "priority"
  | "assignee_user_id"
  | "sla_policy_id"
  | "created_at"
  | "resolved_at"
  | "first_response_at"
>;

type CsatRow = Pick<Tables<"csat_ratings">, "score" | "agent_user_id">;

/** A public, non-blank agent reply; the query filters out everything else. */
type MessageRow = Pick<
  Tables<"ticket_messages">,
  "ticket_id" | "author_id" | "created_at"
>;

/** How a ticket's first response is judged: its target, and on what clock. */
interface FirstResponseTarget {
  mins: number;
  /** null counts wall-clock (24/7) minutes. */
  calendar: WorkCalendar | null;
}

interface SlaSetup {
  /** null when no policy covers the ticket, so it is left out of SLA. */
  targetFor: (t: TicketRow) => FirstResponseTarget | null;
  /** The tenant's calendar timezone, for day and month buckets. */
  timeZone: string;
}

interface SlaTally {
  met: number;
  eligible: number;
  percentage: number | null;
}

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * PostgREST answers with at most `max_rows` (1000) rows per request, whatever
 * .limit() asks for, and says nothing when it cuts. Any tenant past that got a
 * partial set and a dashboard that still printed confident medians and
 * percentages from it. So every list is read page by page; this ceiling only
 * bounds a runaway tenant, and reaching it is logged.
 */
const REPORT_ROW_CAP = 20_000;
const PAGE_SIZE = 1000;

type PageResult<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

/**
 * Reads every row `page` can return, one .range() at a time. It stops on an
 * empty page rather than a short one, so a server whose max_rows is below
 * PAGE_SIZE still gets read to the end. `page` must apply a stable order.
 */
async function fetchAll<T>(
  label: string,
  page: (from: number, to: number) => PageResult<T>,
): Promise<T[]> {
  const rows: T[] = [];
  while (rows.length < REPORT_ROW_CAP) {
    const { data, error } = await page(
      rows.length,
      rows.length + PAGE_SIZE - 1,
    );
    // Thrown, not logged: an empty result here would render as a quiet week.
    if (error) {
      throw new Error(`[reports] ${label} lookup failed: ${error.message}`);
    }
    if (!data || data.length === 0) return rows;
    rows.push(...data);
  }
  console.warn(
    `[reports] ${label} hit the ${REPORT_ROW_CAP}-row cap; figures are partial.`,
  );
  return rows;
}

export async function fetchReportsData(
  tenant: string,
  range: ReportRange,
): Promise<ReportsData> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);

  if (!tenantId) return emptyReportsData(range);

  const now = new Date();
  // First, because the range starts on a bucket boundary in the tenant's
  // timezone, and that timezone comes from the SLA calendars.
  const slaSetup = await loadSlaSetup(supabase, tenantId);
  const sinceDate = rangeStart(range, now, slaSetup.timeZone);
  const since = sinceDate.toISOString();

  // Independent queries, so they go together rather than one after another.
  const [allTickets, messageRows, ratingRows] = await Promise.all([
    // Three overlapping sets in one read: raised in the range (volume, SLA,
    // first response), resolved in the range (throughput, even when raised
    // before it) and open right now (backlog, however old).
    fetchAll<TicketRow>("tickets", (from, to) =>
      supabase
        .from("tickets")
        .select(
          "id, status, priority, assignee_user_id, sla_policy_id, created_at, resolved_at, first_response_at",
        )
        .eq("tenant_id", tenantId)
        .or(
          `created_at.gte."${since}",resolved_at.gte."${since}",status.in.(${OPEN_STATUSES.join(",")})`,
        )
        .order("id", { ascending: true })
        .range(from, to),
    ),
    // Only what counts as a response: a public reply from an agent with some
    // text in it. An internal note is not a response — the customer never
    // sees it. The body itself is never needed, so it is not fetched.
    fetchAll<MessageRow>("messages", (from, to) =>
      supabase
        .from("ticket_messages")
        .select("ticket_id, author_id, created_at")
        .eq("tenant_id", tenantId)
        .eq("author_type", "agent")
        .eq("visibility", "public")
        .not("body", "match", "^[[:space:]]*$")
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    // Tolerates the table not existing yet: the reports page must still render
    // for anyone who has not pushed the csat migration.
    fetchAll<CsatRow>("csat", (from, to) =>
      supabase
        .from("csat_ratings")
        .select("score, agent_user_id")
        .eq("tenant_id", tenantId)
        .gte("created_at", since)
        .order("id", { ascending: true })
        .range(from, to),
    ).catch((error: Error) => {
      console.error(error.message);
      return [] as CsatRow[];
    }),
  ]);

  const csat = summariseCsat(ratingRows);

  // Parsed rather than compared as strings: Postgres writes "+00:00" where
  // toISOString writes "Z", so string order is not time order at the edge.
  const sinceMs = sinceDate.getTime();
  const created = allTickets.filter((t) => Date.parse(t.created_at) >= sinceMs);
  const resolved = allTickets.filter(
    (t) =>
      RESOLVED_STATUSES.includes(t.status) &&
      t.resolved_at !== null &&
      Date.parse(t.resolved_at) >= sinceMs,
  );
  const backlog = allTickets.filter((t) => OPEN_STATUSES.includes(t.status));

  const firstResponseByTicket = buildFirstResponseByTicket(
    created,
    messageRows,
  );
  const firstReplyByAgentAndTicket =
    buildFirstReplyByAgentAndTicket(messageRows);

  const firstResponseMinutes = created
    .map((t) => {
      const frt = getFirstResponseAt(t, firstResponseByTicket);
      return frt === null ? null : minutesBetween(t.created_at, frt);
    })
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  const sla = tallySla(created, firstResponseByTicket, slaSetup);

  const prioritySla: PrioritySlaMetric[] = PRIORITY_KEYS.map((key, index) => {
    const rows = created.filter((t) => t.priority === key);
    const tally = tallySla(rows, firstResponseByTicket, slaSetup);
    return {
      level: PRIORITY_LEVELS[index],
      metPercentage: tally.percentage,
      met: tally.met,
      eligible: tally.eligible,
      ticketsCount: rows.length,
    };
  });

  const trend = buildTrend(
    created,
    resolved,
    sinceDate,
    now,
    RANGE_GRANULARITY[range],
    slaSetup.timeZone,
  );

  const agents = await computeAgentLoad(supabase, tenantId, {
    created,
    resolved,
    backlog,
    firstReplyByAgentAndTicket,
    firstResponseByTicket,
    ratings: ratingRows,
    slaSetup,
  });

  return {
    range,
    summary: {
      slaAttainment: sla.percentage,
      slaMetCount: sla.met,
      slaEligible: sla.eligible,
      medianFirstResponse:
        firstResponseMinutes.length === 0
          ? null
          : formatMinutes(median(firstResponseMinutes)),
      firstResponseCount: firstResponseMinutes.length,
      ticketsSolved: resolved.length,
      ticketsCreated: created.length,
      openBacklog: backlog.length,
      csatAverage: csat.average,
      csatPositiveRate: csat.positiveRate,
      csatResponses: csat.responses,
    },
    trend,
    prioritySla,
    agents,
  };
}

function emptyReportsData(range: ReportRange): ReportsData {
  return {
    range,
    summary: {
      slaAttainment: null,
      slaMetCount: 0,
      slaEligible: 0,
      medianFirstResponse: null,
      firstResponseCount: 0,
      ticketsSolved: 0,
      ticketsCreated: 0,
      openBacklog: 0,
      csatAverage: null,
      csatPositiveRate: null,
      csatResponses: 0,
    },
    trend: [],
    prioritySla: [],
    agents: [],
  };
}

function summariseCsat(rows: CsatRow[]): {
  average: number | null;
  positiveRate: number | null;
  responses: number;
} {
  if (rows.length === 0) {
    return { average: null, positiveRate: null, responses: 0 };
  }

  const total = rows.reduce((sum, row) => sum + row.score, 0);
  const positive = rows.filter((row) => row.score >= 4).length;

  return {
    average: Math.round((total / rows.length) * 10) / 10,
    positiveRate: Math.round((positive / rows.length) * 1000) / 10,
    responses: rows.length,
  };
}

/* ------------------------------------------------------------------ */
/* Trend buckets (tenant timezone)                                    */
/* ------------------------------------------------------------------ */

/**
 * The first instant of the range: the start of the oldest bucket, in the
 * tenant's timezone. Starting N*24h ago instead left the first bar holding
 * only the tail of its day or month, which read as a dip in volume.
 */
function rangeStart(range: ReportRange, now: Date, timeZone: string): Date {
  const granularity = RANGE_GRANULARITY[range];
  const current = floorToBucket(now, granularity, timeZone);
  const first = shiftBucket(
    current,
    granularity,
    1 - REPORT_RANGES[range].buckets,
  );
  return new Date(zonedInstant(first, "00:00", timeZone));
}

/**
 * Buckets follow the tenant's calendar day, not UTC: a ticket raised at 2am
 * IST belongs to that day, not the one before. Bucket keys are UTC midnight of
 * the local date, so the arithmetic and labels below stay in UTC.
 */
function floorToBucket(
  date: Date,
  granularity: TrendGranularity,
  timeZone: string,
): Date {
  const d = zonedDay(date.getTime(), timeZone);
  if (granularity === "week") {
    // Weeks start on Monday.
    const offset = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - offset);
  } else if (granularity === "month") {
    d.setUTCDate(1);
  }
  return d;
}

/** `date` moved by `steps` buckets; negative steps go back. */
function shiftBucket(
  date: Date,
  granularity: TrendGranularity,
  steps: number,
): Date {
  const d = new Date(date);
  if (granularity === "day") d.setUTCDate(d.getUTCDate() + steps);
  else if (granularity === "week") d.setUTCDate(d.getUTCDate() + 7 * steps);
  else d.setUTCMonth(d.getUTCMonth() + steps);
  return d;
}

function bucketLabels(
  start: Date,
  granularity: TrendGranularity,
  spansYears: boolean,
): { label: string; title: string } {
  const fmt = (options: Intl.DateTimeFormatOptions) =>
    start.toLocaleDateString("en-US", { timeZone: "UTC", ...options });

  if (granularity === "month") {
    return {
      label: spansYears
        ? fmt({ month: "short", year: "2-digit" })
        : fmt({ month: "short" }),
      title: fmt({ month: "long", year: "numeric" }),
    };
  }

  const dayLabel = fmt({ month: "short", day: "numeric" });
  const fullDay = fmt({ month: "short", day: "numeric", year: "numeric" });

  return granularity === "week"
    ? { label: dayLabel, title: `Week of ${fullDay}` }
    : { label: dayLabel, title: fullDay };
}

function buildTrend(
  created: TicketRow[],
  resolved: TicketRow[],
  since: Date,
  now: Date,
  granularity: TrendGranularity,
  timeZone: string,
): TrendPoint[] {
  const points = new Map<number, TrendPoint>();
  const first = floorToBucket(since, granularity, timeZone);
  const last = floorToBucket(now, granularity, timeZone);
  const spansYears = first.getUTCFullYear() !== last.getUTCFullYear();

  for (
    let cursor = first;
    cursor <= last;
    cursor = shiftBucket(cursor, granularity, 1)
  ) {
    points.set(cursor.getTime(), {
      ...bucketLabels(cursor, granularity, spansYears),
      opened: 0,
      resolved: 0,
    });
  }

  const bucketOf = (iso: string) =>
    points.get(floorToBucket(new Date(iso), granularity, timeZone).getTime());

  for (const t of created) {
    const point = bucketOf(t.created_at);
    if (point) point.opened += 1;
  }

  for (const t of resolved) {
    const point = bucketOf(t.resolved_at as string);
    if (point) point.resolved += 1;
  }

  return [...points.values()];
}

/* ------------------------------------------------------------------ */
/* First response + SLA                                                */
/* ------------------------------------------------------------------ */

function minutesBetween(a: string, b: string): number {
  return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

function getFirstResponseAt(
  t: TicketRow,
  map: Map<string, string>,
): string | null {
  if (t.first_response_at && t.created_at < t.first_response_at) {
    return t.first_response_at;
  }
  const fromMessages = map.get(t.id);
  if (fromMessages && t.created_at < fromMessages) return fromMessages;
  return null;
}

function buildFirstResponseByTicket(
  tickets: TicketRow[],
  messages: MessageRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  const ticketIds = new Set(tickets.map((t) => t.id));
  for (const m of messages) {
    if (ticketIds.has(m.ticket_id) && !map.has(m.ticket_id)) {
      map.set(m.ticket_id, m.created_at);
    }
  }
  return map;
}

function buildFirstReplyByAgentAndTicket(
  messages: MessageRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of messages) {
    const key = `${m.author_id}:${m.ticket_id}`;
    if (!map.has(key)) map.set(key, m.created_at);
  }
  return map;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 !== 0
    ? values[mid]
    : (values[mid - 1] + values[mid]) / 2;
}

/**
 * A ticket counts once it can be judged: it has been answered, or it was
 * closed without an answer (a miss). A still-open, unanswered ticket may yet
 * make its target, so it is left out rather than counted against the team.
 */
function tallySla(
  tickets: TicketRow[],
  firstResponseByTicket: Map<string, string>,
  slaSetup: SlaSetup,
): SlaTally {
  const eligible = tickets.filter(
    (t) =>
      slaSetup.targetFor(t) !== null &&
      (!OPEN_STATUSES.includes(t.status) ||
        getFirstResponseAt(t, firstResponseByTicket) !== null),
  );
  const met = eligible.filter((t) =>
    ticketMetFirstResponse(t, firstResponseByTicket, slaSetup),
  ).length;

  return {
    met,
    eligible: eligible.length,
    percentage:
      eligible.length === 0
        ? null
        : Math.round((met / eligible.length) * 1000) / 10,
  };
}

function ticketMetFirstResponse(
  t: TicketRow,
  firstResponseByTicket: Map<string, string>,
  slaSetup: SlaSetup,
): boolean {
  const target = slaSetup.targetFor(t);
  const frt = getFirstResponseAt(t, firstResponseByTicket);
  if (target === null || frt === null) return false;

  return responseMinutes(t, frt, slaSetup) <= target.mins;
}

/**
 * Minutes from the ticket being raised to `at`, on the clock its SLA target
 * runs on: business hours when the target is a business-hours one, wall-clock
 * otherwise. A Friday-evening ticket answered first thing Monday is minutes,
 * not days, against a business-hours target.
 */
function responseMinutes(t: TicketRow, at: string, slaSetup: SlaSetup): number {
  const calendar = slaSetup.targetFor(t)?.calendar;
  return calendar
    ? businessMinutesBetween(t.created_at, at, calendar)
    : minutesBetween(t.created_at, at);
}

/**
 * Judges each ticket by the SLA policy stamped on it, or the tenant's default
 * policy when it has none, with business-hours targets counted on that
 * policy's calendar. A ticket no policy covers has no target to miss.
 */
async function loadSlaSetup(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<SlaSetup> {
  const [policiesRes, targetsRes, hoursRes] = await Promise.all([
    supabase
      .from("sla_policies")
      .select("id, business_hours_id, is_default, status")
      .eq("tenant_id", tenantId),
    supabase
      .from("sla_policy_targets")
      .select(
        "policy_id, priority_scope, first_response_mins, first_response_business",
      )
      .eq("tenant_id", tenantId),
    supabase
      .from("business_hours")
      .select("id, name, schedule_json, holidays_json, timezones(code)")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true }),
  ]);

  // Thrown, not logged: without its policies every ticket would read as
  // "not covered", and the page would say there is nothing to judge.
  for (const res of [policiesRes, targetsRes, hoursRes]) {
    if (res.error) {
      throw new Error(
        `[reports] sla setup lookup failed: ${res.error.message}`,
      );
    }
  }

  const calendars = new Map<string, WorkCalendar>();
  for (const row of hoursRes.data || []) {
    const zone = row.timezones as
      { code?: string } | { code?: string }[] | null;
    const code = (Array.isArray(zone) ? zone[0] : zone)?.code;
    const option = toBusinessHoursOption(row);
    if (!code || !isValidTimeZone(code)) continue;
    if (!option.dayStart || !option.dayEnd) continue;
    calendars.set(row.id, {
      timeZone: code,
      workingDays: option.workingDays,
      dayStart: option.dayStart,
      dayEnd: option.dayEnd,
      holidays: option.holidays,
    });
  }

  const policies = new Map(
    (policiesRes.data || []).map((p) => [p.id as string, p]),
  );
  const defaultPolicy = (policiesRes.data || []).find(
    (p) => p.is_default && p.status === "active",
  );

  const targets = new Map<string, FirstResponseTarget>();
  for (const row of targetsRes.data || []) {
    const policy = policies.get(row.policy_id);
    const calendar =
      row.first_response_business && policy?.business_hours_id
        ? (calendars.get(policy.business_hours_id) ?? null)
        : null;
    targets.set(`${row.policy_id}:${row.priority_scope}`, {
      mins: row.first_response_mins,
      calendar,
    });
  }

  const timeZone =
    (defaultPolicy?.business_hours_id &&
      calendars.get(defaultPolicy.business_hours_id)?.timeZone) ||
    calendars.values().next().value?.timeZone ||
    "UTC";

  return {
    timeZone,
    targetFor: (t) => {
      const policyId = t.sla_policy_id ?? defaultPolicy?.id;
      if (!policyId) return null;
      return targets.get(`${policyId}:${t.priority}`) ?? null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

async function computeAgentLoad(
  supabase: SupabaseClient,
  tenantId: string,
  sets: {
    created: TicketRow[];
    resolved: TicketRow[];
    backlog: TicketRow[];
    firstReplyByAgentAndTicket: Map<string, string>;
    firstResponseByTicket: Map<string, string>;
    ratings: CsatRow[];
    slaSetup: SlaSetup;
  },
): Promise<AgentLoadMetric[]> {
  const { data: memberships, error: membershipsError } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .in("role", ["agent", "manager", "tenant_admin"]);

  if (membershipsError) {
    throw new Error(
      `[reports] memberships lookup failed: ${membershipsError.message}`,
    );
  }

  const agentIds: string[] = (memberships || []).map((m) => m.user_id);
  if (agentIds.length === 0) return [];

  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, full_name, email")
    .in("id", agentIds);

  if (usersError) {
    throw new Error(`[reports] users lookup failed: ${usersError.message}`);
  }

  const userMap = new Map((users || []).map((u) => [u.id, u]));

  // Grouped on the rating's own agent_user_id, which was snapshotted when the
  // customer rated. Reassigning a ticket afterwards does not move the score.
  const ratingsByAgent = new Map<string, number[]>();

  for (const rating of sets.ratings) {
    if (!rating.agent_user_id) continue;

    const scores = ratingsByAgent.get(rating.agent_user_id) ?? [];
    scores.push(rating.score);
    ratingsByAgent.set(rating.agent_user_id, scores);
  }

  const agents: AgentLoadMetric[] = agentIds.map((id) => {
    const user = userMap.get(id);
    const assigned = sets.created.filter((t) => t.assignee_user_id === id);
    const open = sets.backlog.filter((t) => t.assignee_user_id === id).length;
    const solved = sets.resolved.filter(
      (t) => t.assignee_user_id === id,
    ).length;
    const sla = tallySla(assigned, sets.firstResponseByTicket, sets.slaSetup);

    const replyMinutes = assigned
      .map((t) => {
        const reply = sets.firstReplyByAgentAndTicket.get(`${id}:${t.id}`);
        // Same clock as the SLA column beside it, so the two agree.
        return reply ? responseMinutes(t, reply, sets.slaSetup) : null;
      })
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b);

    const medianMinutes =
      replyMinutes.length === 0 ? null : median(replyMinutes);

    const scores = ratingsByAgent.get(id) ?? [];

    return {
      id,
      name: user?.full_name || "Unnamed",
      email: user?.email || "",
      initials: initials(user?.full_name || "?"),
      open,
      solved,
      medianFirstReply:
        medianMinutes === null ? null : formatMinutes(medianMinutes),
      medianFirstReplyMinutes: medianMinutes,
      slaMet: sla.percentage,
      slaMetCount: sla.met,
      slaEligible: sla.eligible,
      csatAverage:
        scores.length === 0
          ? null
          : Math.round(
              (scores.reduce((sum, value) => sum + value, 0) / scores.length) *
                10,
            ) / 10,
      csatResponses: scores.length,
    };
  });

  return agents
    .filter(
      (a) =>
        a.open > 0 ||
        a.solved > 0 ||
        a.medianFirstReply !== null ||
        a.csatResponses > 0,
    )
    .sort((a, b) => b.open - a.open);
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${Math.round(mins)}m`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`;
  const days = hours / 24;
  return `${Math.round(days * 10) / 10}d`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join("");
}
