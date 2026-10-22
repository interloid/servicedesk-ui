/**
 * Audit log vocabulary shared by the server service and the page.
 *
 * The values mirror the database: `module` and `result` are the columns added
 * by migration 20261021120000_audit_log_page.sql, `action` is the audit_action
 * enum. Labels and badge colours live here so the table, the details panel and
 * the CSV export all name an event the same way.
 */

export const AUDIT_MODULES = [
  "authentication",
  "security",
  "team",
  "customers",
  "sla",
  "billing",
  "settings",
  "general",
] as const;

export type AuditModule = (typeof AUDIT_MODULES)[number];

export const AUDIT_MODULE_LABELS: Record<AuditModule, string> = {
  authentication: "Authentication",
  security: "Security",
  team: "Team & roles",
  customers: "Customers",
  sla: "SLA policies",
  billing: "Billing",
  settings: "Workspace settings",
  general: "Other",
};

/** The quick-filter tabs above the table, after "All events". */
export const AUDIT_TAB_MODULES = [
  "authentication",
  "team",
  "sla",
  "billing",
  "security",
] as const satisfies readonly AuditModule[];

export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "invite",
  "role_change",
  "assign",
  "login",
  "logout",
  "login_failed",
  "export",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  invite: "Invited",
  role_change: "Role changed",
  assign: "Assigned",
  login: "Login",
  logout: "Logout",
  login_failed: "Failed",
  export: "Exported",
};

/** The Actions filter says "Failed login" where a row badge only has room for "Failed". */
export const AUDIT_ACTION_FILTER_LABELS: Record<AuditAction, string> = {
  ...AUDIT_ACTION_LABELS,
  login_failed: "Failed login",
};

export const AUDIT_RESULTS = ["success", "failure"] as const;

export type AuditResult = (typeof AUDIT_RESULTS)[number];

export const AUDIT_RESULT_LABELS: Record<AuditResult, string> = {
  success: "Success",
  failure: "Failed",
};

const BADGE = "border-none";

export const AUDIT_ACTION_BADGE: Record<AuditAction, string> = {
  create: `${BADGE} bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300`,
  update: `${BADGE} bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300`,
  delete: `${BADGE} bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300`,
  invite: `${BADGE} bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300`,
  role_change: `${BADGE} bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300`,
  assign: `${BADGE} bg-cyan-50 text-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300`,
  login: `${BADGE} bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300`,
  logout: `${BADGE} bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300`,
  login_failed: `${BADGE} bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300`,
  export: `${BADGE} bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300`,
};

export const AUDIT_MODULE_BADGE: Record<AuditModule, string> = {
  authentication: `${BADGE} bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300`,
  security: `${BADGE} bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300`,
  team: `${BADGE} bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300`,
  customers: `${BADGE} bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300`,
  sla: `${BADGE} bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300`,
  billing: `${BADGE} bg-pink-50 text-pink-700 dark:bg-pink-950/60 dark:text-pink-300`,
  settings: `${BADGE} bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300`,
  general: `${BADGE} bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300`,
};

export const AUDIT_RESULT_BADGE: Record<AuditResult, string> = {
  success: `${BADGE} bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300`,
  failure: `${BADGE} bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300`,
};

export function isAuditModule(value: unknown): value is AuditModule {
  return (AUDIT_MODULES as readonly unknown[]).includes(value);
}

export function isAuditAction(value: unknown): value is AuditAction {
  return (AUDIT_ACTIONS as readonly unknown[]).includes(value);
}

export function isAuditResult(value: unknown): value is AuditResult {
  return (AUDIT_RESULTS as readonly unknown[]).includes(value);
}

/* ── Rows ──────────────────────────────────────────────────────────────── */

export type AuditChange = {
  field: string;
  label: string;
  from: string;
  to: string;
};

export type AuditActor = {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  /** The actor's role in this workspace, e.g. "Tenant Admin". */
  role: string | null;
};

export type AuditEvent = {
  id: string;
  createdAt: string;
  action: AuditAction;
  module: AuditModule;
  result: AuditResult;
  entity: string;
  entityId: string | null;
  /** Null when no user did it: a webhook, a cron, a platform operator. */
  actor: AuditActor | null;
  summary: string;
  changes: AuditChange[];
  related: { label: string; value: string } | null;
  ip: string | null;
  userAgent: string | null;
  meta: Record<string, unknown>;
};

/* ── Filters ───────────────────────────────────────────────────────────── */

export const AUDIT_PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_AUDIT_PAGE_SIZE = 10;

/** History the page reads, matching the "12 months of audit history" promise. */
export const AUDIT_RETENTION_DAYS = 365;

/** The default window: the last seven days, today included. */
export const DEFAULT_AUDIT_RANGE_DAYS = 7;

/** Rows a single CSV export carries. */
export const AUDIT_EXPORT_LIMIT = 10_000;

/** "system" picks events with no user behind them. */
export const AUDIT_SYSTEM_ACTOR = "system";

export type AuditFilters = {
  /** Calendar days (YYYY-MM-DD) in the workspace time zone, both inclusive. */
  from: string;
  to: string;
  q: string;
  module: AuditModule | null;
  action: AuditAction | null;
  /** A user id, AUDIT_SYSTEM_ACTOR, or null for everybody. */
  user: string | null;
  result: AuditResult | null;
  page: number;
  pageSize: number;
};

export type AuditSearchParams = Record<string, string | string[] | undefined>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Shifts a YYYY-MM-DD calendar day by whole days. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

/** Today's calendar day in a time zone. */
export function todayIn(timeZone: string, now: number): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Reads the filters out of the URL, falling back to the defaults for anything
 * missing or malformed, and clamps the dates to the retention window so a
 * hand-edited link can neither reach past it nor into the future.
 */
export function parseAuditFilters(
  params: AuditSearchParams,
  { timeZone, now }: { timeZone: string; now: number },
): AuditFilters {
  const today = todayIn(timeZone, now);
  const earliest = addDays(today, -(AUDIT_RETENTION_DAYS - 1));

  let to = first(params.to);
  let from = first(params.from);

  if (!to || !DAY.test(to) || to > today) to = today;
  if (!from || !DAY.test(from))
    from = addDays(to, -(DEFAULT_AUDIT_RANGE_DAYS - 1));
  if (from < earliest) from = earliest;
  if (to < earliest) to = earliest;
  if (from > to) [from, to] = [to, from];

  const moduleParam = first(params.module);
  const action = first(params.action);
  const result = first(params.result);
  const user = first(params.user);
  const pageSize = Number(first(params.size));
  const page = Number(first(params.page));

  return {
    from,
    to,
    q: (first(params.q) ?? "").trim().slice(0, 100),
    module: isAuditModule(moduleParam) ? moduleParam : null,
    action: isAuditAction(action) ? action : null,
    user:
      user === AUDIT_SYSTEM_ACTOR || (user && UUID.test(user)) ? user : null,
    result: isAuditResult(result) ? result : null,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: (AUDIT_PAGE_SIZES as readonly number[]).includes(pageSize)
      ? pageSize
      : DEFAULT_AUDIT_PAGE_SIZE,
  };
}

/**
 * The query string for a set of filters. Defaults are left out so a shared
 * link stays short, except the dates, which a link should pin down.
 */
export function auditFiltersToQuery(filters: Partial<AuditFilters>): string {
  const params = new URLSearchParams();

  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.q) params.set("q", filters.q);
  if (filters.module) params.set("module", filters.module);
  if (filters.action) params.set("action", filters.action);
  if (filters.user) params.set("user", filters.user);
  if (filters.result) params.set("result", filters.result);
  if (filters.page && filters.page > 1)
    params.set("page", String(filters.page));
  if (filters.pageSize && filters.pageSize !== DEFAULT_AUDIT_PAGE_SIZE) {
    params.set("size", String(filters.pageSize));
  }

  return params.toString();
}

/* ── Time zone helpers ─────────────────────────────────────────────────── */

/** How far a time zone's wall clock is ahead of UTC at an instant, in ms. */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return wall - (instant - (instant % 1000));
}

/** The instant a calendar day starts in a time zone, as an ISO string. */
export function startOfDayIn(day: string, timeZone: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // Two passes settle a guess that lands on the far side of a DST change.
  let instant = guess - zoneOffsetMs(guess, timeZone);
  instant = guess - zoneOffsetMs(instant, timeZone);
  return new Date(instant).toISOString();
}

/** "22 Jul 2026, 14:02" in the workspace time zone. */
export function formatAuditTimestamp(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(Date.parse(iso));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

/** "Jul 16, 2026" for the range button. */
export function formatAuditDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(Date.UTC(y, m - 1, d));
}

/* ── Page payload ──────────────────────────────────────────────────────── */

/** Counts for the stat cards, over the selected period. */
export type AuditSummary = {
  total: number;
  users: number;
  modules: number;
  security: number;
};

export type AuditUserOption = {
  id: string;
  name: string;
  email: string;
};

export type AuditPageData = {
  events: AuditEvent[];
  total: number;
  /** Counts for "All events" and each tab, under every filter but the module. */
  tabCounts: Record<"all" | (typeof AUDIT_TAB_MODULES)[number], number>;
  summary: AuditSummary;
  users: AuditUserOption[];
};

export type AuditExportResult =
  | {
      ok: true;
      filename: string;
      csv: string;
      count: number;
      truncated: boolean;
    }
  | { ok: false; message: string };
