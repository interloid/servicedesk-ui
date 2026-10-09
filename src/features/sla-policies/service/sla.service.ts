import {
  getCallerRole,
  getTenantPlanRecord,
} from "@/features/team/services/team.service";
import { getTenantIdBySlug } from "@/features/tenancy/services/tenant-resolver";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  BusinessHoursOption,
  BusinessHoursSchedule,
  CreateSlaPolicyDto,
  EscalationRole,
  FREE_SLA_POLICY_LIMIT,
  PRIORITY_SCOPES,
  PolicyStatus,
  PriorityScope,
  SLA_CUSTOMER_PICKER_LIMIT,
  SlaCustomerOption,
  SlaHoliday,
  SlaPolicy,
  SlaPolicyEditorTarget,
  SlaPolicyEditorValue,
  SlaPolicyQuota,
  SlaPolicyTarget,
  UpdateSlaPolicyDto,
  describePolicyLimit,
  emptyEditorTarget,
  hasPolicyRoom,
  readPolicyLimit,
  toAppliesTo,
} from "../types/types";
import { formatDurationShort, slaDayMins, UNIT_MINS } from "../duration";

import {
  PolicyScope,
  ScopeCandidate,
  describeScopeConflict,
  findScopeConflict,
} from "../scope-rules";

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

type DbError = { code?: string; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function currentUserId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/* ── Errors ──────────────────────────────────────────────────────────── */

/** Plain-words messages for the database errors a save can hit. */
const DB_ERROR_MESSAGES: Record<string, string> = {
  "23503":
    "Something this policy refers to no longer exists. Reload and try again.",
  "23505": "That change clashes with an existing entry. Reload and try again.",
  "23514": "One of the values isn't allowed. Check the form and try again.",
  "42501": "You don't have permission to change SLA policies.",
  PGRST116: "That item no longer exists. Reload and try again.",
};

/**
 * The error a caller (and so the toast) gets for a failed query. Known codes
 * read as plain words; anything else is logged and replaced with `fallback`,
 * so table and constraint names never reach the browser.
 */
function dbError(
  error: DbError,
  fallback = "Couldn't save the SLA policy. Try again.",
): Error {
  const friendly = error.code ? DB_ERROR_MESSAGES[error.code] : undefined;
  if (!friendly) console.error("SLA query failed:", error.code, error.message);
  return new Error(friendly ?? fallback);
}

/* ── Who may change SLA settings ─────────────────────────────────────── */

/**
 * Tenant admins and managers, as RLS allows. Everyone else sees the editor
 * read-only; the write functions below refuse them with a clear message
 * instead of a raw RLS error.
 */
export async function canManageSla(): Promise<boolean> {
  const role = await getCallerRole();
  return role === "Tenant Admin" || role === "Manager";
}

async function assertCanManageSla(): Promise<void> {
  if (!(await canManageSla())) {
    throw new Error("Only tenant admins and managers can change SLA settings.");
  }
}

/**
 * Columns added by migration 20261002120000. Until it is applied to a
 * database, PostgREST rejects any write that names them (PGRST204), so writes
 * retry without them rather than failing the whole save.
 */
const EDITOR_FIELD_COLUMNS = ["description", "updated_by"];

function isMissingEditorColumn(error: DbError | null): boolean {
  return (
    error?.code === "PGRST204" &&
    EDITOR_FIELD_COLUMNS.some((c) => error.message.includes(`'${c}'`))
  );
}

function withoutEditorColumns<T extends Record<string, unknown>>(row: T): T {
  const copy: Record<string, unknown> = { ...row };
  for (const column of EDITOR_FIELD_COLUMNS) delete copy[column];
  return copy as T;
}

function warnMissingEditorColumns() {
  console.warn(
    "sla_policies has no description/updated_by columns; apply migration 20261002120000_sla_policy_editor_fields.sql. Saved without them.",
  );
}

/* ── Target units (migration 20261009120000) ─────────────────────────── */

/**
 * Columns added by migration 20261009120000. Before it, a target row stores a
 * day as 1440 minutes whatever the policy counts, so a write that PostgREST
 * rejects for naming them (PGRST204) is retried in that older form.
 */
const TARGET_UNIT_COLUMNS = ["first_response_unit", "resolution_unit"];

function isMissingTargetUnitColumn(error: DbError | null): boolean {
  return (
    error?.code === "PGRST204" &&
    TARGET_UNIT_COLUMNS.some((c) => error.message.includes(`'${c}'`))
  );
}

/** A target row as a database without the unit columns stores it. */
function toLegacyTargetRow(row: ReturnType<typeof targetRow>, dayMins: number) {
  const legacyMins = (mins: number, unit: string | undefined) =>
    unit === "days" ? (mins / dayMins) * UNIT_MINS.days : mins;
  const {
    first_response_unit: firstUnit,
    resolution_unit: resolutionUnit,
    ...rest
  } = row;
  return {
    ...rest,
    first_response_mins: legacyMins(row.first_response_mins, firstUnit),
    resolution_mins: legacyMins(row.resolution_mins, resolutionUnit),
  };
}

function warnMissingTargetUnitColumns() {
  console.warn(
    "sla_policy_targets has no unit columns; apply migration 20261009120000_sla_target_units.sql. Saved days as 24 hours.",
  );
}

/**
 * Minutes in one SLA day of the calendar a policy counts: its working day,
 * or 1440 for 24/7.
 */
async function loadPolicyDayMins(
  supabase: SupabaseClient,
  tenantId: string,
  businessHoursId: string | null | undefined,
): Promise<number> {
  if (!businessHoursId) return UNIT_MINS.days;
  const row = await loadBusinessHoursRow(supabase, tenantId, businessHoursId);
  return slaDayMins(toBusinessHoursOption(row));
}

/* ── Selected customers (migration 20261005120000) ───────────────────── */

const SELECTED_CUSTOMERS_MIGRATION =
  "20261005120000_sla_policy_selected_customers.sql";

/** The sla_policy_customers table isn't on this database yet. */
function isMissingCustomerTable(error: DbError | null): boolean {
  // undefined_table / PostgREST "not in the schema cache"
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/** The table, or the 'Selected customers' value, isn't on this database yet. */
function isMissingCustomerScope(error: DbError | null): boolean {
  return (
    isMissingCustomerTable(error) ||
    Boolean(error?.message.includes("sla_policies_applies_to_check"))
  );
}

function missingCustomerScopeError(): Error {
  console.warn(
    `Selected-customer SLA policies need migration ${SELECTED_CUSTOMERS_MIGRATION}.`,
  );
  return new Error(
    "Limiting a policy to selected customers isn't available yet. Use All customers for now.",
  );
}

/**
 * Customer ids per policy. Empty only when the table isn't there yet; any
 * other error throws, because the one-active rules rely on this list.
 */
async function loadPolicyCustomerIds(
  supabase: SupabaseClient,
  policyIds: string[],
): Promise<Map<string, string[]>> {
  const byPolicy = new Map<string, string[]>();
  if (policyIds.length === 0) return byPolicy;

  const { data, error } = await supabase
    .from("sla_policy_customers")
    .select("policy_id, customer_id")
    .in("policy_id", policyIds);

  if (error) {
    if (isMissingCustomerTable(error)) return byPolicy;
    throw dbError(error, "Couldn't load the policy's customers.");
  }

  for (const row of data || []) {
    const list = byPolicy.get(row.policy_id) ?? [];
    list.push(row.customer_id);
    byPolicy.set(row.policy_id, list);
  }
  return byPolicy;
}

/** Makes the policy's customer list exactly `customerIds`. */
async function replacePolicyCustomers(
  supabase: SupabaseClient,
  tenantId: string,
  policyId: string,
  customerIds: string[],
): Promise<void> {
  const { error: deleteError } = await supabase
    .from("sla_policy_customers")
    .delete()
    .eq("policy_id", policyId)
    .eq("tenant_id", tenantId);

  if (deleteError) {
    // Nothing to clear on a database without the table.
    if (isMissingCustomerScope(deleteError) && customerIds.length === 0) return;
    if (isMissingCustomerScope(deleteError)) throw missingCustomerScopeError();
    throw dbError(deleteError);
  }

  if (customerIds.length === 0) return;

  const { error } = await supabase.from("sla_policy_customers").insert(
    customerIds.map((customerId) => ({
      tenant_id: tenantId,
      policy_id: policyId,
      customer_id: customerId,
    })),
  );
  if (error) {
    // RLS rejects a customer from another tenant (or one deleted meanwhile).
    if (error.code === "42501" || error.code === "23503") {
      throw new Error(
        "One of the selected customers no longer exists. Reload and pick again.",
      );
    }
    throw dbError(error);
  }
}

/** Every policy's status and customer scope, for the one-active rules. */
async function loadPolicyScopes(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<PolicyScope[]> {
  const { data, error } = await supabase
    .from("sla_policies")
    .select("id, name, status, applies_to, is_default")
    .eq("tenant_id", tenantId);

  if (error) throw dbError(error, "Couldn't load SLA policies.");

  const rows = data || [];
  const customerIds = await loadPolicyCustomerIds(
    supabase,
    rows.map((r) => r.id),
  );
  return rows.map((r) => {
    const appliesTo = toAppliesTo(r.applies_to);
    return {
      id: r.id,
      name: r.name,
      isDefault: r.is_default,
      status: r.status as PolicyStatus,
      appliesTo,
      customerIds:
        appliesTo === "Selected customers" ? (customerIds.get(r.id) ?? []) : [],
    };
  });
}

/**
 * Throws when `candidate` would be a second active "All customers" policy,
 * or would put a customer in two active policies. See scope-rules.ts.
 */
async function assertScopeAllowed(
  supabase: SupabaseClient,
  tenantId: string,
  candidate: ScopeCandidate,
): Promise<void> {
  if (candidate.status !== "active") return;

  const conflict = findScopeConflict(
    candidate,
    await loadPolicyScopes(supabase, tenantId),
  );
  if (!conflict) return;

  let names = new Map<string, string>();
  if (conflict.kind === "customers") {
    const { data } = await supabase
      .from("customers")
      .select("id, full_name")
      .in("id", [...conflict.taken.keys()].slice(0, 1));
    names = new Map((data || []).map((c) => [c.id, c.full_name]));
  }
  throw new Error(describeScopeConflict(conflict, (id) => names.get(id)));
}

/**
 * Makes `policyId` the tenant's only default SLA. The previous default is set
 * inactive: it is an active all-customers policy, and two of those can't be
 * live at once (scope-rules.ts). The editor says so before the save.
 *
 * Clears the old flag before setting the new one so there is never a moment
 * with two defaults. If the second write fails, the old default is put back
 * before the error reaches the caller.
 */
async function makeDefaultPolicy(
  supabase: SupabaseClient,
  tenantId: string,
  policyId: string,
): Promise<void> {
  const { data: previous, error: clearError } = await supabase
    .from("sla_policies")
    .update({ is_default: false, status: "paused" })
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .neq("id", policyId)
    .select("id");
  if (clearError) throw dbError(clearError);

  const { error } = await supabase
    .from("sla_policies")
    .update({ is_default: true })
    .eq("id", policyId)
    .eq("tenant_id", tenantId);
  if (!error) return;

  // The default is always active, so that is the state to restore.
  const previousIds = (previous || []).map((p) => p.id);
  if (previousIds.length > 0) {
    const { error: restoreError } = await supabase
      .from("sla_policies")
      .update({ is_default: true, status: "active" })
      .in("id", previousIds)
      .eq("tenant_id", tenantId);
    if (restoreError) {
      console.error(
        "Couldn't restore the previous default SLA:",
        restoreError.message,
      );
    }
  }
  throw dbError(error);
}

/** The default SLA is the fallback, so it must stay live and cover everyone. */
function assertDefaultShape(status: PolicyStatus, appliesTo: string) {
  if (status !== "active") {
    throw new Error("The default SLA must be active.");
  }
  if (appliesTo !== "All customers") {
    throw new Error("The default SLA applies to all customers.");
  }
}

/** The tenant's customers for the "Selected customers" picker. */
async function fetchTenantCustomers(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<SlaCustomerOption[]> {
  const { data, error } = await supabase
    .from("customers")
    .select("id, full_name, email, company")
    .eq("tenant_id", tenantId)
    .order("full_name", { ascending: true })
    .limit(SLA_CUSTOMER_PICKER_LIMIT);

  if (error) throw dbError(error, "Couldn't load customers.");

  return (data || []).map((c) => ({
    id: c.id,
    name: c.full_name,
    email: c.email,
    company: c.company,
  }));
}

/** Names for "Updated … by …"; empty when users RLS hides them. */
async function loadEditorNames(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Record<string, string>> {
  if (userIds.length === 0) return {};

  const { data, error } = await supabase
    .from("users")
    .select("id, full_name")
    .in("id", userIds);

  if (error) return {};
  return Object.fromEntries(
    (data || [])
      .filter((u) => u.full_name)
      .map((u) => [u.id, u.full_name as string]),
  );
}

async function loadPolicyTargets(
  policyIds: string[],
): Promise<SlaPolicyTarget[]> {
  if (policyIds.length === 0) return [];

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("sla_policy_targets")
    .select("*")
    .in("policy_id", policyIds);

  // Never fall back to an empty list: the editor would show default targets
  // and a save would write them over the real ones.
  if (error) throw dbError(error, "Couldn't load SLA targets.");
  return (data as SlaPolicyTarget[]) || [];
}

/**
 * Tickets per policy, counted in the database. Reading the rows instead hit
 * PostgREST's 1000-row cap, so busy tenants saw wrong numbers.
 */
async function loadAppliedTicketCounts(
  policyIds: string[],
): Promise<Record<string, number>> {
  if (policyIds.length === 0) return {};

  const supabase = await createSupabaseServerClient();
  const counts = await Promise.all(
    policyIds.map(async (id) => {
      const { count, error } = await supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("sla_policy_id", id);
      if (error) throw dbError(error, "Couldn't count SLA tickets.");
      return [id, count ?? 0] as const;
    }),
  );

  return Object.fromEntries(counts);
}

function describeTargets(targets: SlaPolicyTarget[], dayMins: number): string {
  if (targets.length === 0) return "All tickets";
  const urgent =
    targets.find((t) => t.priority_scope === "urgent") || targets[0];
  return `First response in ${formatDurationShort(
    urgent.first_response_mins,
    urgent.first_response_unit,
    dayMins,
  )} · Resolution in ${formatDurationShort(
    urgent.resolution_mins,
    urgent.resolution_unit,
    dayMins,
  )}`;
}

const BUSINESS_HOURS_COLUMNS = "id, name, schedule_json, holidays_json";

type BusinessHoursRow = {
  id: string;
  name: string;
  schedule_json: unknown;
  holidays_json: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** "09:00:00" from Postgres `time` reads as "09:00". */
function asTime(value: unknown): string | null {
  return typeof value === "string" && /^\d{2}:\d{2}/.test(value)
    ? value.slice(0, 5)
    : null;
}

function parseHolidays(value: unknown): SlaHoliday[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((raw, index) => {
    const h = asRecord(raw);
    if (typeof h.name !== "string" || typeof h.date !== "string") return [];
    return [
      {
        id: typeof h.id === "string" ? h.id : `${h.date}-${index}`,
        name: h.name,
        date: h.date,
        allDay: h.all_day !== false,
        startTime: asTime(h.start_time) ?? undefined,
        endTime: asTime(h.end_time) ?? undefined,
        repeatsYearly: h.repeats_yearly === true,
        description:
          typeof h.description === "string" ? h.description : undefined,
      },
    ];
  });
}

export function toBusinessHoursOption(
  row: BusinessHoursRow,
): BusinessHoursOption {
  const schedule = asRecord(row.schedule_json);
  return {
    id: row.id,
    name: row.name,
    workingDays: Array.isArray(schedule.working_days)
      ? schedule.working_days.filter((d): d is string => typeof d === "string")
      : [],
    dayStart: asTime(schedule.day_start),
    dayEnd: asTime(schedule.day_end),
    breakStart: null,
    breakEnd: null,
    holidays: parseHolidays(row.holidays_json).sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
  };
}

function holidayToJson(h: SlaHoliday) {
  return {
    id: h.id,
    name: h.name,
    date: h.date,
    all_day: h.allDay,
    ...(h.allDay ? {} : { start_time: h.startTime, end_time: h.endTime }),
    repeats_yearly: h.repeatsYearly,
    ...(h.description ? { description: h.description } : {}),
  };
}

export async function fetchTenantBusinessHours(
  tenant: string,
): Promise<BusinessHoursOption[]> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);

  if (!tenantId) return [];

  const { data, error } = await supabase
    .from("business_hours")
    .select(BUSINESS_HOURS_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  if (error) throw dbError(error, "Couldn't load business hours.");

  return (data || []).map(toBusinessHoursOption);
}

async function loadBusinessHoursRow(
  supabase: SupabaseClient,
  tenantId: string,
  id: string,
) {
  const { data, error } = await supabase
    .from("business_hours")
    .select("id, name, schedule_json, holidays_json, updated_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw dbError(error, "Couldn't load business hours.");
  if (!data) throw new Error("Business hours not found.");
  return data;
}

/**
 * Writes a read-modify-write change to a business_hours row only if nobody
 * else saved it since `row` was read. Otherwise two people adding a holiday
 * at once would each overwrite the other's.
 */
async function writeBusinessHoursRow(
  supabase: SupabaseClient,
  tenantId: string,
  row: { id: string; updated_at: string | null },
  values: Record<string, unknown>,
): Promise<BusinessHoursOption> {
  const query = supabase
    .from("business_hours")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("tenant_id", tenantId);
  // Older rows can have no updated_at; `eq` never matches null.
  const { data, error } = await (
    row.updated_at === null
      ? query.is("updated_at", null)
      : query.eq("updated_at", row.updated_at)
  )
    .select(BUSINESS_HOURS_COLUMNS)
    .maybeSingle();

  if (error) throw dbError(error, "Couldn't save business hours.");
  if (!data) {
    throw new Error(
      "Someone else changed this calendar just now. Reload and try again.",
    );
  }
  return toBusinessHoursOption(data);
}

export async function updateBusinessHoursSchedule(
  tenant: string,
  id: string,
  schedule: BusinessHoursSchedule,
): Promise<BusinessHoursOption> {
  await assertCanManageSla();
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);
  if (!tenantId) throw new Error("Tenant not found.");

  const row = await loadBusinessHoursRow(supabase, tenantId, id);

  // Merge so keys this screen does not edit survive the write.
  const nextSchedule: Record<string, unknown> = {
    ...asRecord(row.schedule_json),
    working_days: schedule.workingDays,
    day_start: schedule.dayStart,
    day_end: schedule.dayEnd,
  };
  delete nextSchedule.break_start;
  delete nextSchedule.break_end;

  return writeBusinessHoursRow(supabase, tenantId, row, {
    schedule_json: nextSchedule,
  });
}

/** Read-modify-write of holidays_json; `change` receives the current list. */
export async function updateBusinessHoursHolidays(
  tenant: string,
  id: string,
  change: (current: SlaHoliday[]) => SlaHoliday[],
): Promise<BusinessHoursOption> {
  await assertCanManageSla();
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);
  if (!tenantId) throw new Error("Tenant not found.");

  const row = await loadBusinessHoursRow(supabase, tenantId, id);
  const next = change(parseHolidays(row.holidays_json)).map(holidayToJson);

  return writeBusinessHoursRow(supabase, tenantId, row, {
    holidays_json: next,
  });
}

function emptyEditorValue(
  businessHours: BusinessHoursOption[],
  otherPolicies: PolicyScope[] = [],
): SlaPolicyEditorValue {
  const businessHoursId = businessHours[0]?.id ?? null;
  // With an all-customers policy already live, a new one is most likely for
  // specific customers; starting there avoids an instant conflict.
  const hasFallback = otherPolicies.some(
    (p) => p.status === "active" && p.appliesTo === "All customers",
  );
  return {
    isDefault: false,
    name: "",
    description: "",
    appliesTo: hasFallback ? "Selected customers" : "All customers",
    customerIds: [],
    timeCalculation: businessHoursId ? "business" : "24/7",
    businessHoursId,
    status: "draft",
    notifyBeforeBreach: true,
    notifyBeforeMins: 15,
    escalateOnBreach: false,
    escalateToRole: "manager",
    targets: PRIORITY_SCOPES.map((scope) => emptyEditorTarget(scope)),
  };
}

/**
 * Everything the editor needs. `value` is null when `policyId` names a policy
 * that doesn't exist in this tenant; a failed query throws so the route's
 * error boundary shows instead of a misleading 404 or blank form.
 */
export async function getSlaEditorData(
  tenant: string,
  policyId?: string,
): Promise<{
  value: SlaPolicyEditorValue | null;
  businessHours: BusinessHoursOption[];
  customers: SlaCustomerOption[];
  /** The tenant's other policies, so the editor can warn before saving. */
  otherPolicies: PolicyScope[];
  /** False for roles that may only look (agents). */
  canManage: boolean;
}> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);

  const [businessHours, customers, scopes, canManage] = await Promise.all([
    fetchTenantBusinessHours(tenant),
    tenantId ? fetchTenantCustomers(supabase, tenantId) : [],
    tenantId ? loadPolicyScopes(supabase, tenantId) : [],
    canManageSla(),
  ]);
  const otherPolicies = scopes.filter((p) => p.id !== policyId);
  const base = { businessHours, customers, otherPolicies, canManage };

  if (!policyId) {
    return { ...base, value: emptyEditorValue(businessHours, otherPolicies) };
  }
  // A malformed id in the URL is a missing policy, not a query error.
  if (!tenantId || !UUID.test(policyId)) return { ...base, value: null };

  const { data: policy, error } = await supabase
    .from("sla_policies")
    .select("*")
    .eq("id", policyId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw dbError(error, "Couldn't load the SLA policy.");
  if (!policy) return { ...base, value: null };

  const [targets, customerIdsByPolicy] = await Promise.all([
    loadPolicyTargets([policyId]),
    loadPolicyCustomerIds(supabase, [policyId]),
  ]);
  const appliesTo = toAppliesTo(policy.applies_to);
  const existingByScope = new Map(
    targets
      .filter((t) => t.policy_id === policyId)
      .map((t) => [t.priority_scope as PriorityScope, t]),
  );

  const editorTargets: SlaPolicyEditorTarget[] = PRIORITY_SCOPES.map(
    (scope) => {
      const existing = existingByScope.get(scope);
      return existing
        ? {
            priority: existing.priority_scope as PriorityScope,
            firstResponseMins: existing.first_response_mins,
            firstResponseUnit: existing.first_response_unit,
            firstResponseBusiness: existing.first_response_business,
            resolutionMins: existing.resolution_mins,
            resolutionUnit: existing.resolution_unit,
            resolutionBusiness: existing.resolution_business,
          }
        : emptyEditorTarget(scope);
    },
  );

  return {
    ...base,
    value: {
      id: policyId,
      isDefault: policy.is_default,
      name: policy.name,
      description: policy.description ?? "",
      appliesTo,
      customerIds:
        appliesTo === "Selected customers"
          ? (customerIdsByPolicy.get(policyId) ?? [])
          : [],
      timeCalculation: policy.business_hours_id ? "business" : "24/7",
      businessHoursId: policy.business_hours_id,
      status: policy.status as PolicyStatus,
      notifyBeforeBreach: policy.notify_before_breach,
      notifyBeforeMins: policy.notify_before_mins ?? 15,
      escalateOnBreach: policy.escalate_on_breach,
      escalateToRole:
        (policy.escalate_to_role as EscalationRole | null) ?? "manager",
      targets: editorTargets,
    },
  };
}

/**
 * The plan's cap on SLA policies. Gates the create button and the /sla/new
 * page, and createSlaPolicy enforces it.
 *
 * The cap is read through getTenantPlanRecord rather than off `subscriptions`
 * here: RLS on that table admits only tenant_admin and billing_admin, so a
 * manager opening this page would get no row and be measured against Free's
 * cap on a paid workspace. getTenantPlanRecord uses the service-role client for
 * that reason and caches per request, so this costs nothing extra when both
 * pages read it in one render. Same fallback as getTeamSeats.
 */
export async function getSlaPolicyQuota(
  tenant: string,
): Promise<SlaPolicyQuota> {
  const tenantId = await getTenantIdBySlug(tenant);

  if (!tenantId) {
    return { planName: "Free", limit: FREE_SLA_POLICY_LIMIT };
  }

  const plan = await getTenantPlanRecord(tenantId);

  if (!plan) {
    return { planName: "Free", limit: FREE_SLA_POLICY_LIMIT };
  }

  return {
    planName: plan.planName,
    limit: readPolicyLimit(plan.featuresJson),
  };
}

/** How many policies the tenant has, every status included (as the list counts). */
export async function countTenantSlaPolicies(tenant: string): Promise<number> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);
  if (!tenantId) return 0;

  const { count, error } = await supabase
    .from("sla_policies")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if (error) throw dbError(error, "Couldn't count SLA policies.");
  return count ?? 0;
}

export async function fetchTenantSlaPolicies(
  tenant: string,
): Promise<SlaPolicy[]> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);

  if (!tenantId) return [];

  const { data, error } = await supabase
    .from("sla_policies")
    .select(
      // No embed on updated_by: on a database without migration
      // 20261002120000 the embed fails the whole query and the list is empty.
      `*, business_hours:business_hours_id(${BUSINESS_HOURS_COLUMNS})`,
    )
    .eq("tenant_id", tenantId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  // Throw rather than show "No SLA policies yet": an empty list also unlocks
  // the create button on a plan that is already full.
  if (error) throw dbError(error, "Couldn't load SLA policies.");

  const rows = data || [];
  const policyIds = rows.map((p) => p.id);
  const editorIds = [
    ...new Set(
      rows
        .map((p) => (p as { updated_by?: string | null }).updated_by)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [targets, counts, editorNames, customerIds] = await Promise.all([
    loadPolicyTargets(policyIds),
    loadAppliedTicketCounts(policyIds),
    loadEditorNames(supabase, editorIds),
    loadPolicyCustomerIds(supabase, policyIds),
  ]);

  return rows.map((p) => {
    const policyTargets = targets.filter((t) => t.policy_id === p.id);
    const calendar = p.business_hours
      ? toBusinessHoursOption(p.business_hours)
      : null;
    return {
      id: p.id,
      name: p.name,
      description:
        p.description || describeTargets(policyTargets, slaDayMins(calendar)),
      appliedTickets: counts[p.id] || 0,
      updated_at: p.updated_at,
      // Null when the editor is gone or users RLS hides them; the list then
      // shows the date alone.
      updated_by_name:
        editorNames[(p as { updated_by?: string | null }).updated_by ?? ""] ??
        null,
      business_hours: calendar,
      status: p.status as PolicyStatus,
      applies_to: toAppliesTo(p.applies_to),
      selected_customer_count: customerIds.get(p.id)?.length ?? 0,
      is_default: p.is_default,
      business_hours_id: p.business_hours_id,
      business_hours_name: calendar?.name ?? null,
      notify_before_breach: p.notify_before_breach,
      notify_before_mins: p.notify_before_mins ?? 15,
      escalate_on_breach: p.escalate_on_breach,
      escalate_to_role:
        (p.escalate_to_role as EscalationRole | null) ?? "manager",
      targets: policyTargets,
    };
  });
}

function targetRow(
  tenantId: string,
  policyId: string,
  target: SlaPolicyEditorTarget,
) {
  return {
    tenant_id: tenantId,
    policy_id: policyId,
    priority_scope: target.priority,
    first_response_mins: target.firstResponseMins,
    first_response_unit: target.firstResponseUnit,
    first_response_business: target.firstResponseBusiness,
    resolution_mins: target.resolutionMins,
    resolution_unit: target.resolutionUnit,
    resolution_business: target.resolutionBusiness,
  };
}

/**
 * Makes the policy's targets exactly `targets`, one row per priority.
 * `dayMins` is only asked for on a database without the unit columns, to
 * write "days" in the older 1440-a-day form.
 */
async function replacePolicyTargets(
  supabase: SupabaseClient,
  tenantId: string,
  policyId: string,
  targets: SlaPolicyEditorTarget[],
  existing: SlaPolicyTarget[] = [],
  dayMins: () => Promise<number> = async () => UNIT_MINS.days,
): Promise<void> {
  let legacyDayMins: number | null = null;

  for (const target of targets) {
    const current = existing.find((t) => t.priority_scope === target.priority);
    const row = targetRow(tenantId, policyId, target);
    const write = (payload: Record<string, unknown>) =>
      current
        ? supabase
            .from("sla_policy_targets")
            .update(payload)
            .eq("id", current.id)
            .eq("tenant_id", tenantId)
        : supabase.from("sla_policy_targets").insert(payload);

    let { error } =
      legacyDayMins === null
        ? await write(row)
        : await write(toLegacyTargetRow(row, legacyDayMins));
    if (legacyDayMins === null && isMissingTargetUnitColumn(error)) {
      warnMissingTargetUnitColumns();
      legacyDayMins = await dayMins();
      ({ error } = await write(toLegacyTargetRow(row, legacyDayMins)));
    }
    if (error) throw dbError(error);
  }

  const keptScopes = new Set(targets.map((t) => t.priority));
  for (const existingTarget of existing) {
    if (!keptScopes.has(existingTarget.priority_scope as PriorityScope)) {
      const { error } = await supabase
        .from("sla_policy_targets")
        .delete()
        .eq("id", existingTarget.id)
        .eq("tenant_id", tenantId);
      if (error) throw dbError(error);
    }
  }
}

function toEditorTargets(rows: SlaPolicyTarget[]): SlaPolicyEditorTarget[] {
  return rows.map((t) => ({
    priority: t.priority_scope as PriorityScope,
    firstResponseMins: t.first_response_mins,
    firstResponseUnit: t.first_response_unit,
    firstResponseBusiness: t.first_response_business,
    resolutionMins: t.resolution_mins,
    resolutionUnit: t.resolution_unit,
    resolutionBusiness: t.resolution_business,
  }));
}

/**
 * The sla_policies columns a save writes, named one by one so a field the
 * editor doesn't offer (id, tenant_id, created_at, …) can never be written
 * from the request.
 */
function policyColumns(dto: CreateSlaPolicyDto | UpdateSlaPolicyDto) {
  return {
    name: dto.name,
    description: dto.description,
    status: dto.status,
    applies_to: dto.applies_to,
    business_hours_id: dto.business_hours_id,
    notify_before_breach: dto.notify_before_breach,
    notify_before_mins: dto.notify_before_mins,
    escalate_on_breach: dto.escalate_on_breach,
    escalate_to_role: dto.escalate_to_role,
  };
}

/** Drops undefined keys so an omitted field keeps its stored value. */
function definedOnly<T extends Record<string, unknown>>(row: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/** Runs `undo`, logging (not throwing) if it fails, so the original error wins. */
async function rollBack(what: string, undo: () => Promise<unknown>) {
  try {
    await undo();
  } catch (error) {
    console.error(
      `Couldn't roll back ${what}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

export async function createSlaPolicy(tenant: string, dto: CreateSlaPolicyDto) {
  await assertCanManageSla();
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);

  if (!tenantId) throw new Error("Tenant not found.");

  // The plan's cap, enforced here and not only by the list's button.
  const [quota, used] = await Promise.all([
    getSlaPolicyQuota(tenant),
    countTenantSlaPolicies(tenant),
  ]);
  if (!hasPolicyRoom(quota, used)) {
    throw new Error(
      `${describePolicyLimit(quota)} Upgrade your plan to add more.`,
    );
  }

  const status = dto.status ?? "draft";
  const appliesTo = dto.applies_to ?? "All customers";

  if (dto.is_default) {
    assertDefaultShape(status, appliesTo);
  }
  await assertScopeAllowed(supabase, tenantId, {
    isDefault: dto.is_default,
    status,
    appliesTo,
    customerIds: dto.customer_ids ?? [],
  });

  const row = {
    ...policyColumns(dto),
    tenant_id: tenantId,
    name: dto.name,
    description: dto.description ?? "",
    status,
    applies_to: appliesTo,
    business_hours_id: dto.business_hours_id ?? null,
    notify_before_breach: dto.notify_before_breach ?? true,
    notify_before_mins: dto.notify_before_mins ?? 15,
    escalate_on_breach: dto.escalate_on_breach ?? false,
    escalate_to_role: dto.escalate_to_role ?? "manager",
    updated_by: await currentUserId(supabase),
    is_default: false,
  };
  const insert = (values: typeof row) =>
    supabase.from("sla_policies").insert(values).select().single();

  let { data: policy, error } = await insert(row);
  if (isMissingEditorColumn(error)) {
    warnMissingEditorColumns();
    ({ data: policy, error } = await insert(withoutEditorColumns(row)));
  }

  if (isMissingCustomerScope(error)) throw missingCustomerScopeError();
  if (error || !policy) {
    throw error ? dbError(error) : new Error("Couldn't create the policy.");
  }

  try {
    await replacePolicyTargets(
      supabase,
      tenantId,
      policy.id,
      dto.targets,
      [],
      () => loadPolicyDayMins(supabase, tenantId, policy.business_hours_id),
    );
    await replacePolicyCustomers(
      supabase,
      tenantId,
      policy.id,
      dto.customer_ids ?? [],
    );
    if (dto.is_default) {
      await makeDefaultPolicy(supabase, tenantId, policy.id);
    }
  } catch (stepError) {
    // Remove the half-made policy (targets and customers cascade), so a retry
    // doesn't leave a stray copy. Service role: managers can't delete
    // policies under RLS, and this row was created by this request.
    await rollBack("the new SLA policy", async () => {
      const { error: deleteError } = await createSupabaseAdminClient()
        .from("sla_policies")
        .delete()
        .eq("id", policy.id)
        .eq("tenant_id", tenantId);
      if (deleteError) throw new Error(deleteError.message);
    });
    throw stepError;
  }

  return policy;
}

export async function updateSlaPolicy(
  tenant: string,
  policyId: string,
  dto: UpdateSlaPolicyDto,
) {
  await assertCanManageSla();
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);

  if (!tenantId) throw new Error("Tenant not found.");

  // The whole row, kept so a failed later step can put it back.
  const { data: current, error: readError } = await supabase
    .from("sla_policies")
    .select("*")
    .eq("id", policyId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (readError) throw dbError(readError, "Couldn't load the SLA policy.");
  if (!current) throw new Error("Policy not found.");

  const status = dto.status ?? (current.status as PolicyStatus);
  const appliesTo = dto.applies_to ?? "All customers";
  const willBeDefault = dto.is_default ?? current.is_default;

  if (current.is_default && dto.is_default === false) {
    throw new Error(
      "There must always be a default SLA. Make another policy the default instead.",
    );
  }
  if (willBeDefault) {
    assertDefaultShape(status, appliesTo);
  }

  await assertScopeAllowed(supabase, tenantId, {
    id: policyId,
    isDefault: willBeDefault,
    status,
    appliesTo,
    customerIds: dto.customer_ids ?? [],
  });

  const [previousTargets, previousCustomers] = await Promise.all([
    loadPolicyTargets([policyId]),
    loadPolicyCustomerIds(supabase, [policyId]),
  ]);

  const updates: Record<string, unknown> = {
    ...definedOnly(policyColumns(dto)),
    status,
    applies_to: appliesTo,
    updated_at: new Date().toISOString(),
    updated_by: await currentUserId(supabase),
  };

  const update = (values: Record<string, unknown>) =>
    supabase
      .from("sla_policies")
      .update(values)
      .eq("id", policyId)
      .eq("tenant_id", tenantId)
      .select()
      .single();

  let { data: policy, error } = await update(updates);
  const missingEditorColumns = isMissingEditorColumn(error);
  if (missingEditorColumns) {
    warnMissingEditorColumns();
    ({ data: policy, error } = await update(withoutEditorColumns(updates)));
  }

  if (isMissingCustomerScope(error)) throw missingCustomerScopeError();
  if (error) throw dbError(error);

  try {
    await replacePolicyTargets(
      supabase,
      tenantId,
      policyId,
      dto.targets,
      previousTargets,
      () =>
        loadPolicyDayMins(
          supabase,
          tenantId,
          policy?.business_hours_id ?? current.business_hours_id,
        ),
    );
    await replacePolicyCustomers(
      supabase,
      tenantId,
      policyId,
      dto.customer_ids ?? [],
    );
    if (willBeDefault && !current.is_default) {
      await makeDefaultPolicy(supabase, tenantId, policyId);
    }
  } catch (stepError) {
    // Put the policy back exactly as it was before this save.
    await rollBack("the SLA policy row", async () => {
      const restore = Object.fromEntries(
        Object.keys(updates).map((key) => [
          key,
          (current as Record<string, unknown>)[key],
        ]),
      );
      const { error: restoreError } = await update(
        missingEditorColumns ? withoutEditorColumns(restore) : restore,
      );
      if (restoreError) throw new Error(restoreError.message);
    });
    await rollBack("the SLA targets", async () =>
      replacePolicyTargets(
        supabase,
        tenantId,
        policyId,
        toEditorTargets(previousTargets),
        await loadPolicyTargets([policyId]),
      ),
    );
    await rollBack("the policy's customers", () =>
      replacePolicyCustomers(
        supabase,
        tenantId,
        policyId,
        previousCustomers.get(policyId) ?? [],
      ),
    );
    throw stepError;
  }

  return policy;
}
