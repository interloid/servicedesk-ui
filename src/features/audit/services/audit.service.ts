import "server-only";

import { cache } from "react";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ilikeOrValue } from "@/lib/postgrest";
import { requestClientInfo } from "@/lib/request-context";
import {
  getActorOrNull,
  getTenantPlanRecord,
} from "@/features/team/services/team.service";

import {
  AUDIT_ACTION_FILTER_LABELS,
  AUDIT_ACTION_LABELS,
  AUDIT_EXPORT_LIMIT,
  AUDIT_MODULE_LABELS,
  AUDIT_RESULT_LABELS,
  AUDIT_SYSTEM_ACTOR,
  AUDIT_TAB_MODULES,
  addDays,
  formatAuditTimestamp,
  isAuditAction,
  isAuditModule,
  startOfDayIn,
  type AuditAction,
  type AuditActor,
  type AuditChange,
  type AuditEvent,
  type AuditExportResult,
  type AuditFilters,
  type AuditModule,
  type AuditPageData,
  type AuditSummary,
  type AuditUserOption,
} from "@/features/audit/types/audit";

export class AuditError extends Error {}

/* ── Access ─────────────────────────────────────────────────────────────── */

export type AuditAccess =
  | { status: "forbidden" }
  | { status: "locked"; canUpgrade: boolean }
  | { status: "ok"; tenantId: string; userId: string };

function planHasAuditLogs(featuresJson: unknown): boolean {
  let features = featuresJson;

  if (typeof features === "string") {
    try {
      features = JSON.parse(features);
    } catch {
      return false;
    }
  }

  return (
    typeof features === "object" &&
    features !== null &&
    (features as Record<string, unknown>).audit_logs === true
  );
}

/**
 * Who may open the page, checked on the server before anything is read.
 *
 * Tenant Admins and Managers, the same roles the select policy allows. The
 * plan check here only decides which screen to draw: the policy enforces it
 * as well, so a Free workspace reading the table directly still gets nothing.
 */
export const getAuditAccess = cache(
  async function getAuditAccess(): Promise<AuditAccess> {
    const actor = await getActorOrNull();

    if (!actor || (actor.role !== "Tenant Admin" && actor.role !== "Manager")) {
      return { status: "forbidden" };
    }

    const plan = await getTenantPlanRecord(actor.tenantId);

    if (!plan || !planHasAuditLogs(plan.featuresJson)) {
      // The plans page is for Tenant Admins (and Billing Admins, who cannot
      // see this page), so a Manager is told who to ask instead.
      return { status: "locked", canUpgrade: actor.role === "Tenant Admin" };
    }

    return { status: "ok", tenantId: actor.tenantId, userId: actor.userId };
  },
);

async function requireAccess() {
  const access = await getAuditAccess();

  if (access.status === "forbidden") {
    throw new AuditError("You don't have access to the audit log.");
  }

  if (access.status === "locked") {
    throw new AuditError("The audit log is available on the Business plan.");
  }

  return access;
}

/**
 * The workspace's time zone: that of its first business-hours calendar, the
 * one the SLA clock also runs on. Dates on the page and the range picker's
 * days are read in it, so "today" means the same thing to everybody.
 */
export const getAuditTimeZone = cache(async function getAuditTimeZone(
  tenantId: string,
): Promise<string> {
  const { data } = await createSupabaseAdminClient()
    .from("business_hours")
    .select(
      "created_at, timezone:timezones!business_hours_timezone_id_fkey(code)",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const zone = data?.timezone as { code?: string } | { code?: string }[] | null;
  const code = Array.isArray(zone) ? zone[0]?.code : zone?.code;

  if (code) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: code });
      return code;
    } catch {
      // An unknown zone name falls through to UTC.
    }
  }

  return "UTC";
});

/* ── Reading ────────────────────────────────────────────────────────────── */

type AuditRow = {
  id: string;
  created_at: string;
  action: string;
  module: string | null;
  result: string | null;
  entity: string;
  entity_id: string | null;
  actor_id: string | null;
  meta_json: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
};

const ROW_SELECT =
  "id, created_at, action, module, result, entity, entity_id, actor_id, meta_json, ip, user_agent";

const ROLE_LABELS: Record<string, string> = {
  tenant_admin: "Tenant Admin",
  manager: "Manager",
  agent: "Agent",
  billing_admin: "Billing Admin",
  customer: "Customer",
  platform_admin: "Platform Admin",
};

type Member = AuditUserOption & {
  avatarUrl: string | null;
  role: string | null;
};

type MemberRow = {
  user_id: string;
  role: string;
  user:
    | {
        full_name: string | null;
        email: string | null;
        avatar_url: string | null;
      }
    | {
        full_name: string | null;
        email: string | null;
        avatar_url: string | null;
      }[]
    | null;
};

/**
 * Everybody who has, or had, a membership in the workspace, team and
 * customers alike. Admin client: memberships are read for names only, and the
 * tenant filter is the scope.
 */
const listMembers = cache(async function listMembers(
  tenantId: string,
): Promise<Member[]> {
  const { data, error } = await createSupabaseAdminClient()
    .from("memberships")
    .select(
      "user_id, role, user:users!memberships_user_id_fkey(full_name, email, avatar_url)",
    )
    .eq("tenant_id", tenantId);

  if (error) {
    throw new AuditError(`Couldn't load workspace members: ${error.message}`);
  }

  return ((data ?? []) as MemberRow[]).map((row) => {
    const user = Array.isArray(row.user) ? row.user[0] : row.user;
    const email = user?.email ?? "";
    return {
      id: row.user_id,
      name: user?.full_name?.trim() || email,
      email,
      avatarUrl: user?.avatar_url ?? null,
      role: ROLE_LABELS[row.role] ?? null,
    };
  });
});

/** People a removed member's old rows still point at, looked up by id. */
async function loadActors(
  ids: string[],
  members: Member[],
): Promise<Map<string, AuditActor>> {
  const actors = new Map<string, AuditActor>();

  for (const member of members) {
    actors.set(member.id, {
      id: member.id,
      name: member.name,
      email: member.email,
      avatarUrl: member.avatarUrl,
      role: member.role,
    });
  }

  const missing = [...new Set(ids)].filter((id) => !actors.has(id));

  if (missing.length > 0) {
    const { data } = await createSupabaseAdminClient()
      .from("users")
      .select("id, full_name, email, avatar_url")
      .in("id", missing);

    for (const user of data ?? []) {
      actors.set(user.id, {
        id: user.id,
        name: user.full_name?.trim() || user.email,
        email: user.email,
        avatarUrl: user.avatar_url ?? null,
        role: null,
      });
    }
  }

  return actors;
}

type Range = { fromIso: string; toIso: string };

function rangeOf(filters: AuditFilters, timeZone: string): Range {
  return {
    fromIso: startOfDayIn(filters.from, timeZone),
    toIso: startOfDayIn(addDays(filters.to, 1), timeZone),
  };
}

/** The search box as one PostgREST or-filter, or null when it is empty. */
function searchFilter(q: string, members: Member[]): string | null {
  if (!q) return null;

  const needle = q.toLowerCase();
  const value = ilikeOrValue(q);
  const clauses = [
    `meta_json->>summary.ilike.${value}`,
    `meta_json->>target_email.ilike.${value}`,
    `meta_json->>email.ilike.${value}`,
    `meta_json->>name.ilike.${value}`,
    `entity.ilike.${value}`,
  ];

  const actorIds = members
    .filter(
      (member) =>
        member.name.toLowerCase().includes(needle) ||
        member.email.toLowerCase().includes(needle),
    )
    .map((member) => member.id);

  if (actorIds.length > 0) {
    clauses.push(`actor_id.in.(${actorIds.join(",")})`);
  }

  const actions = Object.entries(AUDIT_ACTION_FILTER_LABELS)
    .filter(([, label]) => label.toLowerCase().includes(needle))
    .map(([action]) => action);

  if (actions.length > 0) {
    clauses.push(`action.in.(${actions.join(",")})`);
  }

  const modules = Object.entries(AUDIT_MODULE_LABELS)
    .filter(([, label]) => label.toLowerCase().includes(needle))
    .map(([module]) => module);

  if (modules.length > 0) {
    clauses.push(`module.in.(${modules.join(",")})`);
  }

  return clauses.join(",");
}

type FilterOptions = {
  tenantId: string;
  range: Range;
  members: Member[];
  /** Overrides filters.module: a tab count asks for its own module. */
  module?: AuditModule | null;
};

// The builder's generic type is not worth spelling out; every caller passes a
// fresh `.from("audit_logs").select(…)` and chains on the result.
function applyFilters<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST builder generics
  Q extends { eq: any; gte: any; lt: any; is: any; or: any },
>(
  query: Q,
  filters: AuditFilters,
  { tenantId, range, members, module }: FilterOptions,
): Q {
  let q = query
    .eq("tenant_id", tenantId)
    .gte("created_at", range.fromIso)
    .lt("created_at", range.toIso);

  const moduleFilter = module === undefined ? filters.module : module;

  if (moduleFilter) q = q.eq("module", moduleFilter);
  if (filters.action) q = q.eq("action", filters.action);
  if (filters.result) q = q.eq("result", filters.result);
  if (filters.user === AUDIT_SYSTEM_ACTOR) q = q.is("actor_id", null);
  else if (filters.user) q = q.eq("actor_id", filters.user);

  const search = searchFilter(filters.q, members);
  if (search) q = q.or(search);

  return q;
}

/* ── Rows to events ─────────────────────────────────────────────────────── */

const CHANGE_LABELS: Record<string, string> = {
  plan: "Plan",
  seat_limit: "Agent seats",
  price_month: "Price / month",
  seats: "Seats",
  role: "Role",
  status: "Status",
  name: "Name",
  description: "Description",
  applies_to: "Applies to",
  is_default: "Default policy",
  notify_before_breach: "Warn before breach",
  notify_before_mins: "Warning lead time",
  escalate_on_breach: "Escalate on breach",
  escalate_to_role: "Escalate to",
  timezone: "Time zone",
  schedule: "Working hours",
  holidays: "Holidays",
  slug: "Workspace address",
};

function humanize(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function formatChangeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (typeof value === "number") {
    if (field === "seat_limit" && value >= 999_999) return "Unlimited";
    if (field === "price_month") return `$${value.toFixed(2)}`;
    if (field === "notify_before_mins") return `${value} min`;
    if (field === "holidays") return `${value} ${value === 1 ? "day" : "days"}`;
    return value.toLocaleString("en-US");
  }

  if (typeof value === "string") {
    if (field === "escalate_to_role") return ROLE_LABELS[value] ?? value;
    if (field === "status")
      return value.charAt(0).toUpperCase() + value.slice(1);
    return value;
  }

  if (field === "schedule") return "Edited";

  const json = JSON.stringify(value);
  return json.length > 60 ? `${json.slice(0, 57)}…` : json;
}

function toChanges(meta: Record<string, unknown>): AuditChange[] {
  const raw = meta.changes;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];

  return Object.entries(raw as Record<string, unknown>).flatMap(
    ([field, change]) => {
      if (!change || typeof change !== "object") return [];
      const { from, to } = change as { from?: unknown; to?: unknown };
      const fromText = formatChangeValue(field, from);
      const toText =
        field === "schedule" ? "Updated" : formatChangeValue(field, to);
      if (field !== "schedule" && fromText === toText) return [];
      return [
        {
          field,
          label: CHANGE_LABELS[field] ?? humanize(field),
          from: field === "schedule" ? "Previous hours" : fromText,
          to: toText,
        },
      ];
    },
  );
}

const ENTITY_LABELS: Record<string, string> = {
  user: "User",
  membership: "Membership",
  sla_policy: "SLA policy",
  business_hours: "Business hours",
  subscription: "Subscription",
  tenant: "Workspace",
  tenant_ownership: "Membership",
  audit_log: "Audit log",
};

function toRelated(row: AuditRow, meta: Record<string, unknown>) {
  const related = meta.related as Record<string, unknown> | undefined;
  const paypal = related?.paypal_subscription_id;

  if (row.entity === "subscription" && typeof paypal === "string" && paypal) {
    return { label: "Subscription", value: paypal };
  }

  if (!row.entity_id) return null;

  return {
    label: ENTITY_LABELS[row.entity] ?? humanize(row.entity),
    value: row.entity_id,
  };
}

function fallbackSummary(
  row: AuditRow,
  action: AuditAction,
  meta: Record<string, unknown>,
  actors: Map<string, AuditActor>,
): string {
  if (action === "login") return "User logged in";
  if (action === "logout") return "User logged out";
  if (action === "login_failed") return "Failed login attempt";

  if (row.entity === "tenant_ownership") {
    const to =
      typeof meta.to_user_id === "string" ? actors.get(meta.to_user_id) : null;
    return to
      ? `Transferred workspace ownership to ${to.name}`
      : "Transferred workspace ownership";
  }

  const entity = (
    ENTITY_LABELS[row.entity] ?? humanize(row.entity)
  ).toLowerCase();
  return `${AUDIT_ACTION_LABELS[action]} ${entity}`;
}

function toEvent(row: AuditRow, actors: Map<string, AuditActor>): AuditEvent {
  const meta = row.meta_json ?? {};
  const action: AuditAction = isAuditAction(row.action) ? row.action : "update";
  const summary =
    typeof meta.summary === "string" && meta.summary.trim()
      ? meta.summary
      : fallbackSummary(row, action, meta, actors);

  return {
    id: row.id,
    createdAt: row.created_at,
    action,
    module: isAuditModule(row.module) ? row.module : "general",
    result: row.result === "failure" ? "failure" : "success",
    entity: row.entity,
    entityId: row.entity_id,
    actor: row.actor_id
      ? (actors.get(row.actor_id) ?? {
          id: row.actor_id,
          name: "Deleted user",
          email: "",
          avatarUrl: null,
          role: null,
        })
      : null,
    summary,
    changes: toChanges(meta),
    related: toRelated(row, meta),
    ip: row.ip ? String(row.ip) : null,
    userAgent: row.user_agent,
    meta,
  };
}

async function toEvents(rows: AuditRow[], members: Member[]) {
  const ids = rows.flatMap((row) => {
    const meta = row.meta_json ?? {};
    const extra = typeof meta.to_user_id === "string" ? [meta.to_user_id] : [];
    return row.actor_id ? [row.actor_id, ...extra] : extra;
  });
  const actors = await loadActors(ids, members);
  return rows.map((row) => toEvent(row, actors));
}

/* ── Summary ────────────────────────────────────────────────────────────── */

async function loadSummary(range: Range): Promise<AuditSummary> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("audit_log_summary", {
    p_from: range.fromIso,
    p_to: range.toIso,
  });

  if (error) {
    throw new AuditError(`Couldn't load the audit summary: ${error.message}`);
  }

  // The RPC also returns prev_* counts for the previous period; the cards no
  // longer show a change, so they are not read.
  const s = (data ?? {}) as Record<string, unknown>;

  return {
    total: Number(s.total) || 0,
    users: Number(s.users) || 0,
    modules: Number(s.modules) || 0,
    security: Number(s.security) || 0,
  };
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export async function loadAuditPage(
  filters: AuditFilters,
  timeZone: string,
): Promise<AuditPageData> {
  const { tenantId } = await requireAccess();
  const supabase = await createSupabaseServerClient();
  const members = await listMembers(tenantId);
  const range = rangeOf(filters, timeZone);
  const options = { tenantId, range, members };

  const offset = (filters.page - 1) * filters.pageSize;

  const countFor = async (module: AuditModule | null) => {
    const { count, error } = await applyFilters(
      supabase.from("audit_logs").select("id", { count: "exact", head: true }),
      filters,
      { ...options, module },
    );
    if (error)
      throw new AuditError(`Couldn't count audit events: ${error.message}`);
    return count ?? 0;
  };

  const [list, summary, ...counts] = await Promise.all([
    applyFilters(
      supabase.from("audit_logs").select(ROW_SELECT, { count: "exact" }),
      filters,
      options,
    )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + filters.pageSize - 1),
    loadSummary(range),
    countFor(null),
    ...AUDIT_TAB_MODULES.map((module) => countFor(module)),
  ]);

  // A page past the end (after a filter shrank the list) is a range error
  // from PostgREST, not an empty page; it reads as "no rows" here.
  if (list.error && list.error.code !== "PGRST103") {
    throw new AuditError(`Couldn't load audit events: ${list.error.message}`);
  }

  const rows = (list.data ?? []) as unknown as AuditRow[];
  const [all, ...perTab] = counts;

  return {
    events: await toEvents(rows, members),
    total: list.count ?? 0,
    tabCounts: {
      all,
      ...(Object.fromEntries(
        AUDIT_TAB_MODULES.map((module, index) => [module, perTab[index]]),
      ) as Record<(typeof AUDIT_TAB_MODULES)[number], number>),
    },
    summary,
    users: members
      .filter((member) => member.role && member.role !== "Customer")
      .map(({ id, name, email }) => ({ id, name, email }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/* ── Export ─────────────────────────────────────────────────────────────── */

const EXPORT_BATCH = 1000;

/** One CSV field, quoted, with spreadsheet formulas defused. */
function csvField(value: string | null | undefined): string {
  let text = value ?? "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function exportAuditLog(
  filters: AuditFilters,
): Promise<AuditExportResult> {
  const { tenantId, userId } = await requireAccess();
  const timeZone = await getAuditTimeZone(tenantId);
  const supabase = await createSupabaseServerClient();
  const members = await listMembers(tenantId);
  const range = rangeOf(filters, timeZone);

  const rows: AuditRow[] = [];
  let truncated = false;

  for (let offset = 0; offset < AUDIT_EXPORT_LIMIT; offset += EXPORT_BATCH) {
    const { data, error } = await applyFilters(
      supabase.from("audit_logs").select(ROW_SELECT),
      filters,
      { tenantId, range, members },
    )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + EXPORT_BATCH - 1);

    if (error) {
      throw new AuditError(`Couldn't export audit events: ${error.message}`);
    }

    const batch = (data ?? []) as unknown as AuditRow[];
    rows.push(...batch);

    if (batch.length < EXPORT_BATCH) break;
    if (offset + EXPORT_BATCH >= AUDIT_EXPORT_LIMIT) truncated = true;
  }

  const events = await toEvents(rows, members);
  const header = [
    `Date and time (${timeZone})`,
    "User",
    "Email",
    "Role",
    "Action",
    "Module",
    "Details",
    "Result",
    "IP address",
    "User agent",
    "Event ID",
  ];
  const lines = [
    header.map(csvField).join(","),
    ...events.map((event) =>
      [
        formatAuditTimestamp(event.createdAt, timeZone),
        event.actor?.name ?? "System",
        event.actor?.email ?? "",
        event.actor?.role ?? "",
        AUDIT_ACTION_FILTER_LABELS[event.action],
        AUDIT_MODULE_LABELS[event.module],
        event.summary,
        AUDIT_RESULT_LABELS[event.result],
        event.ip,
        event.userAgent,
        event.id,
      ]
        .map(csvField)
        .join(","),
    ),
  ];

  // The export is itself an audited action. Best effort: a failed write is
  // logged, and the file the admin asked for is still returned.
  const { ip } = await requestClientInfo();
  const { error: auditError } = await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: userId,
    action: "export",
    entity: "audit_log",
    ip,
    meta_json: {
      summary: `Exported ${events.length.toLocaleString("en-US")} audit ${events.length === 1 ? "event" : "events"} to CSV`,
      count: events.length,
      from: filters.from,
      to: filters.to,
      filters: {
        q: filters.q || null,
        module: filters.module,
        action: filters.action,
        user: filters.user,
        result: filters.result,
      },
    },
  });

  if (auditError) {
    console.error("[audit] export event not written:", auditError.message);
  }

  return {
    ok: true,
    filename: `audit-log_${filters.from}_${filters.to}.csv`,
    // A BOM so Excel reads the file as UTF-8.
    csv: `﻿${lines.join("\r\n")}\r\n`,
    count: events.length,
    truncated,
  };
}
