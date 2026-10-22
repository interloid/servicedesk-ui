import { toBusinessHoursOption } from "@/features/sla-policies/service/sla.service";
import { getTenantPlanRecord } from "@/features/team/services/team.service";
import type { Enums, Tables } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  AgentLoadMetric,
  PrioritySlaMetric,
  RANGE_GRANULARITY,
  REPORT_RANGES,
  ReportRange,
  ReportsData,
  planIncludesReports,
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

// Typed from the enum, so a misspelt status fails the build instead of quietly
// dropping tickets from a set.
type TicketStatus = Enums<"ticket_status">;
const RESOLVED_STATUSES: TicketStatus[] = ["resolved", "closed"];
const OPEN_STATUSES: TicketStatus[] = ["new", "open", "pending", "on_hold"];

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
>;

type CsatRow = Pick<Tables<"csat_ratings">, "score" | "agent_user_id">;

/**
 * An agent's first public, non-blank reply on a ticket: one row per (ticket,
 * agent), from the report_first_replies function.
 */
type MessageRow = Pick<
  Tables<"ticket_messages">,
  "ticket_id" | "author_id" | "created_at"
>;

/**
 * A ticket's first-response clock, as the SLA engine keeps it. The engine is
 * the source of truth for met or missed: it pauses while the ticket waits,
 * keeps the target the clock started with, and only runs one when a policy
 * covered the ticket. Reports read its verdict instead of re-deriving it.
 */
type FirstResponseEvent = Pick<
  Tables<"sla_events">,
  "ticket_id" | "status" | "due_at" | "paused_at" | "business_hours_id"
>;

interface SlaSetup {
  /** Each ticket's first-response clock; a ticket without one has no SLA. */
  eventByTicket: Map<string, FirstResponseEvent>;
  /** Business-hours calendars by id, for timing replies on a clock's hours. */
  calendars: Map<string, WorkCalendar>;
}

interface Calendars {
  calendars: Map<string, WorkCalendar>;
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
 * bounds a runaway tenant, and reaching it is reported to the page.
 */
const REPORT_ROW_CAP = 20_000;
const PAGE_SIZE = 1000;

type PageResult<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string; code?: string } | null;
}>;

/** A failed list read, carrying PostgREST's code so a caller can react to it. */
class ReportsQueryError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
  ) {
    super(message);
  }
}

interface FetchedRows<T> {
  rows: T[];
  /** More rows exist past the cap: everything built from `rows` is partial. */
  truncated: boolean;
}

/**
 * Reads every row `page` can return, one .range() at a time, and stops on a
 * short page. That is safe because PAGE_SIZE equals PostgREST's max_rows
 * (supabase/config.toml); raising one means raising the other. `page` must
 * apply a stable order.
 */
async function fetchAll<T>(
  label: string,
  page: (from: number, to: number) => PageResult<T>,
): Promise<FetchedRows<T>> {
  const read = async (from: number, to: number) => {
    const { data, error } = await page(from, to);
    // Thrown, not logged: an empty result here would render as a quiet week.
    if (error) {
      throw new ReportsQueryError(
        `[reports] ${label} lookup failed: ${error.message}`,
        error.code,
      );
    }
    return data ?? [];
  };

  const rows: T[] = [];
  while (rows.length < REPORT_ROW_CAP) {
    const data = await read(rows.length, rows.length + PAGE_SIZE - 1);
    rows.push(...data);
    if (data.length < PAGE_SIZE) return { rows, truncated: false };
  }

  // Exactly at the cap is not truncation: only flag it when one more exists.
  const truncated = (await read(rows.length, rows.length)).length > 0;
  if (truncated) {
    console.warn(
      `[reports] ${label} hit the ${REPORT_ROW_CAP}-row cap; figures are partial.`,
    );
  }
  return { rows, truncated };
}

/**
 * Whether the tenant's plan includes Reports. Read through getTenantPlanRecord
 * (service role, cached per request) for the same reason getSlaPolicyQuota is:
 * RLS on `subscriptions` hides the row from a manager, who would otherwise be
 * locked out on a paid workspace. No readable plan counts as Free.
 */
export async function hasReportsAccess(tenantId: string): Promise<boolean> {
  const plan = await getTenantPlanRecord(tenantId);
  return planIncludesReports(plan?.planName);
}

/**
 * Each agent's first response on each ticket since `since`. Only what counts
 * as a response: a public reply from an agent with some text in it. An
 * internal note is not one — the customer never sees it.
 *
 * Read through report_first_replies, which returns one row per (ticket,
 * agent) rather than one per reply, so a busy team stays far below the row
 * cap. Until that migration is on a database, PostgREST answers PGRST202 and
 * the old per-reply read is used instead, so the page keeps working.
 */
async function fetchFirstReplies(
  supabase: SupabaseClient,
  tenantId: string,
  since: string,
): Promise<FetchedRows<MessageRow>> {
  try {
    return await fetchAll<MessageRow>("first replies", (from, to) =>
      supabase
        .rpc("report_first_replies", { p_tenant_id: tenantId, p_since: since })
        .order("ticket_id", { ascending: true })
        .order("author_id", { ascending: true })
        .range(from, to),
    );
  } catch (error) {
    if (!(error instanceof ReportsQueryError) || error.code !== "PGRST202") {
      throw error;
    }
    console.warn(
      "[reports] report_first_replies is missing; apply migration 20261017120000. Reading every reply instead.",
    );
    return fetchAll<MessageRow>("messages", (from, to) =>
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
    );
  }
}

/**
 * `tenantId` is the caller's, from the same actor the page's role gate read, so
 * the gate and the data always name one tenant and a failed slug lookup can't
 * render as an empty period.
 */
export async function fetchReportsData(
  tenantId: string,
  range: ReportRange,
): Promise<ReportsData> {
  const supabase = await createSupabaseServerClient();

  const now = new Date();
  // First, because the range starts on a bucket boundary in the tenant's
  // timezone, and that timezone comes from the SLA calendars.
  const { calendars, timeZone } = await loadCalendars(supabase, tenantId);
  const sinceDate = rangeStart(range, now, timeZone);
  const since = sinceDate.toISOString();

  // Independent queries, so they go together rather than one after another.
  const [ticketsRes, messagesRes, ratingsRes, eventsRes] = await Promise.all([
    // Three overlapping sets in one read: raised in the range (volume, SLA,
    // first response), resolved in the range (throughput, even when raised
    // before it) and open right now (backlog, however old).
    fetchAll<TicketRow>("tickets", (from, to) =>
      supabase
        .from("tickets")
        .select(
          "id, status, priority, assignee_user_id, sla_policy_id, created_at, resolved_at",
        )
        .eq("tenant_id", tenantId)
        .or(
          `created_at.gte."${since}",resolved_at.gte."${since}",status.in.(${OPEN_STATUSES.join(",")})`,
        )
        // Oldest first, so a ticket raised while the pages load lands at the
        // end instead of shifting every later row by one (read twice or
        // skipped). Duplicates are still dropped below.
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    ),
    fetchFirstReplies(supabase, tenantId, since),
    // Tolerates only the table not existing yet, so the page still renders
    // for anyone who has not pushed the csat migration. Any other failure
    // throws: "No ratings yet" would hide it.
    fetchAll<CsatRow>("csat", (from, to) =>
      supabase
        .from("csat_ratings")
        .select("score, agent_user_id")
        .eq("tenant_id", tenantId)
        .gte("created_at", since)
        .order("id", { ascending: true })
        .range(from, to),
    ).catch((error: unknown): FetchedRows<CsatRow> => {
      if (
        error instanceof ReportsQueryError &&
        (error.code === "42P01" || error.code === "PGRST205")
      ) {
        console.error(error.message);
        return { rows: [], truncated: false };
      }
      throw error;
    }),
    // First-response clocks of the tickets raised in the range.
    fetchAll<FirstResponseEvent>("sla events", (from, to) =>
      supabase
        .from("sla_events")
        .select(
          "ticket_id, status, due_at, paused_at, business_hours_id, tickets!inner(created_at)",
        )
        .eq("tenant_id", tenantId)
        .eq("type", "first_response")
        .gte("tickets.created_at", since)
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const allTickets = [
    ...new Map(ticketsRes.rows.map((t) => [t.id, t])).values(),
  ];
  const messageRows = messagesRes.rows;
  const ratingRows = ratingsRes.rows;
  const truncated =
    ticketsRes.truncated ||
    messagesRes.truncated ||
    ratingsRes.truncated ||
    eventsRes.truncated;
  const slaSetup: SlaSetup = {
    // One first_response clock per ticket (uq_ticket_sla_type).
    eventByTicket: new Map(eventsRes.rows.map((e) => [e.ticket_id, e])),
    calendars,
  };

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
      // Same clock as the SLA card and the agent table, so the headline and
      // the per-agent medians agree on the same tickets.
      return frt === null ? null : responseMinutes(t, frt, slaSetup);
    })
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  const sla = tallySla(created, slaSetup, now);

  const prioritySla: PrioritySlaMetric[] = PRIORITY_KEYS.map((key, index) => {
    const rows = created.filter((t) => t.priority === key);
    const tally = tallySla(rows, slaSetup, now);
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
    timeZone,
  );

  const agents = await computeAgentLoad(supabase, tenantId, {
    created,
    resolved,
    backlog,
    firstReplyByAgentAndTicket,
    ratings: ratingRows,
    slaSetup,
    now,
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
    truncated,
  };
}

/** Mean to one decimal place, or null for no values. */
function average(values: number[]): number | null {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
}

function summariseCsat(rows: CsatRow[]): {
  average: number | null;
  positiveRate: number | null;
  responses: number;
} {
  if (rows.length === 0) {
    return { average: null, positiveRate: null, responses: 0 };
  }

  const positive = rows.filter((row) => row.score >= 4).length;

  return {
    average: average(rows.map((row) => row.score)),
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
  if (granularity === "month") d.setUTCDate(1);
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

  return {
    label: fmt({ month: "short", day: "numeric" }),
    title: fmt({ month: "short", day: "numeric", year: "numeric" }),
  };
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

/**
 * The first public, non-blank agent reply, read from the messages only.
 * tickets.first_response_at is deliberately not used: the SLA engine on
 * feature/tickets will write it, and until its rule is agreed to be the same
 * one, preferring it would let internal notes count again with no change here.
 * Times are parsed, not compared as strings ("+00:00" vs "Z").
 */
function getFirstResponseAt(
  t: TicketRow,
  map: Map<string, string>,
): string | null {
  const reply = map.get(t.id);
  return reply && Date.parse(reply) > Date.parse(t.created_at) ? reply : null;
}

function buildFirstResponseByTicket(
  tickets: TicketRow[],
  messages: MessageRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  const ticketIds = new Set(tickets.map((t) => t.id));
  for (const m of messages) {
    if (ticketIds.has(m.ticket_id))
      keepEarliest(map, m.ticket_id, m.created_at);
  }
  return map;
}

function buildFirstReplyByAgentAndTicket(
  messages: MessageRow[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of messages) {
    keepEarliest(map, `${m.author_id}:${m.ticket_id}`, m.created_at);
  }
  return map;
}

/**
 * Rows come one per (ticket, agent), ordered by id rather than time, so the
 * first one seen is not necessarily the earliest. Parsed, not compared as
 * strings ("+00:00" vs "Z").
 */
function keepEarliest(map: Map<string, string>, key: string, at: string) {
  const current = map.get(key);
  if (current === undefined || Date.parse(at) < Date.parse(current)) {
    map.set(key, at);
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 !== 0
    ? values[mid]
    : (values[mid - 1] + values[mid]) / 2;
}

/**
 * Met or missed, as the SLA engine recorded it: a clock that finished in time
 * is met, a breached one missed, and a running clock already past its
 * deadline is missed too (sla_tick marks it on its next 15-minute run). A clock still
 * running in time, or paused while the ticket waits on the customer, can still
 * make it and is left out, so ignoring tickets can never raise the figure.
 */
function firstResponseOutcome(
  event: FirstResponseEvent | undefined,
  nowMs: number,
): "met" | "missed" | null {
  if (!event) return null;
  if (event.status === "completed") return "met";
  if (event.status === "breached") return "missed";
  return event.paused_at === null && Date.parse(event.due_at) < nowMs
    ? "missed"
    : null;
}

/** Tickets with no first-response clock had no policy, so no target to miss. */
function tallySla(
  tickets: TicketRow[],
  slaSetup: SlaSetup,
  now: Date,
): SlaTally {
  const nowMs = now.getTime();
  let met = 0;
  let eligible = 0;
  for (const t of tickets) {
    const outcome = firstResponseOutcome(
      slaSetup.eventByTicket.get(t.id),
      nowMs,
    );
    if (outcome === null) continue;
    eligible += 1;
    if (outcome === "met") met += 1;
  }

  return {
    met,
    eligible,
    percentage:
      eligible === 0 ? null : Math.round((met / eligible) * 1000) / 10,
  };
}

/**
 * Minutes from the ticket being raised to `at`, on the clock its SLA runs on:
 * the business hours of the ticket's first-response clock when it has some,
 * wall-clock otherwise. A Friday-evening ticket answered first thing Monday is
 * minutes, not days, on a business-hours policy.
 */
function responseMinutes(t: TicketRow, at: string, slaSetup: SlaSetup): number {
  const hoursId = slaSetup.eventByTicket.get(t.id)?.business_hours_id;
  const calendar = hoursId ? slaSetup.calendars.get(hoursId) : undefined;
  return calendar
    ? businessMinutesBetween(t.created_at, at, calendar)
    : minutesBetween(t.created_at, at);
}

/**
 * The tenant's business-hours calendars, and the timezone the trend buckets
 * follow: the default policy's calendar, else the oldest one, else UTC.
 */
async function loadCalendars(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<Calendars> {
  const [policiesRes, hoursRes] = await Promise.all([
    supabase
      .from("sla_policies")
      .select("business_hours_id, is_default, status")
      .eq("tenant_id", tenantId),
    supabase
      .from("business_hours")
      .select(
        "id, name, schedule_json, holidays_json, timezone_id, timezones(code)",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: true }),
  ]);

  // Thrown, not logged: a failed read would quietly time every reply on the
  // wrong clock and bucket the trend in the wrong timezone.
  for (const res of [policiesRes, hoursRes]) {
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
    // A calendar with no working window counts 0 minutes for every gap, so
    // every reply would read as instant. The settings form blocks this, but
    // provisioning and direct edits do not. Skipped, its replies are timed on
    // wall-clock time. (HH:MM is zero-padded, so string order is time order.)
    if (option.workingDays.length === 0 || option.dayEnd <= option.dayStart) {
      console.warn(
        `[reports] business hours ${row.id} has no working window; using 24/7`,
      );
      continue;
    }
    calendars.set(row.id, {
      timeZone: code,
      workingDays: option.workingDays,
      dayStart: option.dayStart,
      dayEnd: option.dayEnd,
      holidays: option.holidays,
    });
  }

  const defaultPolicy = (policiesRes.data || []).find(
    (p) => p.is_default && p.status === "active",
  );

  const timeZone =
    (defaultPolicy?.business_hours_id &&
      calendars.get(defaultPolicy.business_hours_id)?.timeZone) ||
    calendars.values().next().value?.timeZone ||
    "UTC";

  return { calendars, timeZone };
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
    ratings: CsatRow[];
    slaSetup: SlaSetup;
    now: Date;
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

  // Active staff, plus anyone who did work in the range and has since been
  // disabled or removed: dropping them made the per-agent Solved column stop
  // adding up to Tickets Solved, and lost a leaver's record for the period.
  const activeIds = new Set((memberships || []).map((m) => m.user_id));
  const workedIds = [
    ...[...sets.created, ...sets.resolved, ...sets.backlog].map(
      (t) => t.assignee_user_id,
    ),
    ...sets.ratings.map((r) => r.agent_user_id),
  ].filter((id): id is string => !!id);
  const agentIds = [...new Set([...activeIds, ...workedIds])];
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
    const sla = tallySla(assigned, sets.slaSetup, sets.now);

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
      // A removed member's profile is hidden by RLS, so there is no name.
      name: user?.full_name || (user ? "Unnamed" : "Former member"),
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
      csatAverage: average(scores),
      csatResponses: scores.length,
      inactive: !activeIds.has(id),
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
