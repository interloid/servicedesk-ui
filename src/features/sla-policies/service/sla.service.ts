import { getTenantPlanRecord } from "@/features/team/services/team.service";
import { getTenantIdBySlug } from "@/features/tenancy/services/tenant-resolver";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  BusinessHoursOption,
  BusinessHoursSchedule,
  CreateSlaPolicyDto,
  EscalationRole,
  FREE_SLA_POLICY_LIMIT,
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
  formatMinutes,
  readPolicyLimit,
  toAppliesTo,
} from "../types/types";

import {
  PolicyScope,
  ScopeCandidate,
  describeScopeConflict,
  findScopeConflict,
} from "../scope-rules";

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function currentUserId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * Columns added by migration 20261002120000. Until it is applied to a
 * database, PostgREST rejects any write that names them (PGRST204), so writes
 * retry without them rather than failing the whole save.
 */
const EDITOR_FIELD_COLUMNS = ["description", "updated_by"];

function isMissingEditorColumn(
  error: { code?: string; message: string } | null,
): boolean {
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

/* ── Selected customers (migration 20261005120000) ───────────────────── */

const SELECTED_CUSTOMERS_MIGRATION =
  "20261005120000_sla_policy_selected_customers.sql";

/** The table, or the 'Selected customers' value, isn't on this database yet. */
function isMissingCustomerScope(
  error: { code?: string; message: string } | null,
): boolean {
  if (!error) return false;
  return (
    // undefined_table / PostgREST "not in the schema cache"
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.message.includes("sla_policy_customers") ||
    error.message.includes("sla_policies_applies_to_check")
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

/** Customer ids per policy; empty when the table isn't there yet. */
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
    if (!isMissingCustomerScope(error)) {
      console.error("Error loading SLA policy customers:", error.message);
    }
    return byPolicy;
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
    throw new Error(deleteError.message);
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
    throw new Error(error.message);
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

  if (error) throw new Error(error.message);

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
 * with two defaults; if the second write fails the tenant briefly has none,
 * and the error reaches the caller.
 */
async function makeDefaultPolicy(
  supabase: SupabaseClient,
  tenantId: string,
  policyId: string,
): Promise<void> {
  const { error: clearError } = await supabase
    .from("sla_policies")
    .update({ is_default: false, status: "paused" })
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .neq("id", policyId);
  if (clearError) throw new Error(clearError.message);

  const { error } = await supabase
    .from("sla_policies")
    .update({ is_default: true })
    .eq("id", policyId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
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

  if (error) {
    console.error("Error loading customers:", error.message);
    return [];
  }

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

export const PRIORITY_SCOPES: PriorityScope[] = [
  "urgent",
  "high",
  "normal",
  "low",
];

export function emptyEditorTarget(priority: PriorityScope = "normal") {
  return {
    priority,
    firstResponseMins: 60,
    firstResponseBusiness: false,
    resolutionMins: 480,
    resolutionBusiness: false,
  };
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

  if (error) return [];
  return (data as SlaPolicyTarget[]) || [];
}

async function loadAppliedTicketCounts(
  policyIds: string[],
): Promise<Record<string, number>> {
  if (policyIds.length === 0) return {};

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("tickets")
    .select("sla_policy_id")
    .not("sla_policy_id", "is", null)
    .in("sla_policy_id", policyIds);

  if (error) return {};

  return (data || []).reduce<Record<string, number>>((acc, row) => {
    if (row.sla_policy_id) {
      acc[row.sla_policy_id] = (acc[row.sla_policy_id] || 0) + 1;
    }
    return acc;
  }, {});
}

function describeTargets(targets: SlaPolicyTarget[]): string {
  if (targets.length === 0) return "All tickets";
  const urgent =
    targets.find((t) => t.priority_scope === "urgent") || targets[0];
  return `First response in ${formatMinutes(
    urgent.first_response_mins,
  )} · Resolution in ${formatMinutes(urgent.resolution_mins)}`;
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

  if (error) {
    console.error("Error fetching business hours:", error.message);
    return [];
  }

  return (data || []).map(toBusinessHoursOption);
}

async function loadBusinessHoursRow(
  supabase: SupabaseClient,
  tenantId: string,
  id: string,
) {
  const { data, error } = await supabase
    .from("business_hours")
    .select("id, name, schedule_json, holidays_json")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Business hours not found.");
  return data;
}

export async function updateBusinessHoursSchedule(
  tenant: string,
  id: string,
  schedule: BusinessHoursSchedule,
): Promise<BusinessHoursOption> {
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

  const { data, error } = await supabase
    .from("business_hours")
    .update({
      schedule_json: nextSchedule,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select(BUSINESS_HOURS_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return toBusinessHoursOption(data);
}

/** Read-modify-write of holidays_json; `change` receives the current list. */
export async function updateBusinessHoursHolidays(
  tenant: string,
  id: string,
  change: (current: SlaHoliday[]) => SlaHoliday[],
): Promise<BusinessHoursOption> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);
  if (!tenantId) throw new Error("Tenant not found.");

  const row = await loadBusinessHoursRow(supabase, tenantId, id);
  const next = change(parseHolidays(row.holidays_json)).map(holidayToJson);

  const { data, error } = await supabase
    .from("business_hours")
    .update({ holidays_json: next, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select(BUSINESS_HOURS_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return toBusinessHoursOption(data);
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
    status: "active",
    notifyBeforeBreach: true,
    notifyBeforeMins: 15,
    escalateOnBreach: false,
    escalateToRole: "manager",
    targets: PRIORITY_SCOPES.map((scope) => emptyEditorTarget(scope)),
  };
}

export async function getSlaEditorData(
  tenant: string,
  policyId?: string,
): Promise<{
  value: SlaPolicyEditorValue;
  businessHours: BusinessHoursOption[];
  customers: SlaCustomerOption[];
  /** The tenant's other policies, so the editor can warn before saving. */
  otherPolicies: PolicyScope[];
}> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);

  const [businessHours, customers, scopes] = await Promise.all([
    fetchTenantBusinessHours(tenant),
    tenantId ? fetchTenantCustomers(supabase, tenantId) : [],
    tenantId
      ? loadPolicyScopes(supabase, tenantId).catch(() => [] as PolicyScope[])
      : [],
  ]);
  const otherPolicies = scopes.filter((p) => p.id !== policyId);

  if (!policyId || !tenantId) {
    return {
      businessHours,
      customers,
      otherPolicies,
      value: emptyEditorValue(businessHours, otherPolicies),
    };
  }

  const { data: policy, error } = await supabase
    .from("sla_policies")
    .select("*")
    .eq("id", policyId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !policy) {
    return {
      businessHours,
      customers,
      otherPolicies,
      value: emptyEditorValue(businessHours, otherPolicies),
    };
  }

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
            firstResponseBusiness: existing.first_response_business,
            resolutionMins: existing.resolution_mins,
            resolutionBusiness: existing.resolution_business,
          }
        : emptyEditorTarget(scope);
    },
  );

  return {
    businessHours,
    customers,
    otherPolicies,
    value: {
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
 * The plan's cap on SLA policies, for gating the create button.
 *
 * The cap is read through getTenantPlanRecord rather than off `subscriptions`
 * here: RLS on that table admits only tenant_admin and billing_admin, so a
 * manager opening this page would get no row and be measured against Free's
 * cap on a paid workspace. getTenantPlanRecord uses the service-role client for
 * that reason and caches per request, so this costs nothing extra when both
 * pages read it in one render. Same fallback as getTeamSeats.
 *
 * This is a display gate only — the write is not restricted server-side yet.
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

  if (error) {
    console.error("Error fetching SLA policies:", error.message);
    return [];
  }

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
      description: p.description || describeTargets(policyTargets),
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

async function replacePolicyTargets(
  supabase: SupabaseClient,
  tenantId: string,
  policyId: string,
  targets: CreateSlaPolicyDto["targets"],
  existing?: SlaPolicyTarget[],
): Promise<void> {
  const existingById = new Map((existing || []).map((t) => [t.id, t]));

  for (const target of targets) {
    const scope = target.priority as PriorityScope;
    const current = existing?.find((t) => t.priority_scope === scope);
    const payload = {
      tenant_id: tenantId,
      policy_id: policyId,
      priority_scope: scope,
      first_response_mins: target.firstResponseMins,
      first_response_business: target.firstResponseBusiness,
      resolution_mins: target.resolutionMins,
      resolution_business: target.resolutionBusiness,
    };

    if (current) {
      const { error } = await supabase
        .from("sla_policy_targets")
        .update(payload)
        .eq("id", current.id)
        .eq("tenant_id", tenantId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("sla_policy_targets")
        .insert(payload);
      if (error) throw new Error(error.message);
    }
  }

  const keptScopes = targets.map((t) => t.priority as PriorityScope);
  for (const existingTarget of existing || []) {
    if (!keptScopes.includes(existingTarget.priority_scope as PriorityScope)) {
      const { error } = await supabase
        .from("sla_policy_targets")
        .delete()
        .eq("id", existingTarget.id)
        .eq("tenant_id", tenantId);
      if (error) throw new Error(error.message);
    }
  }

  existingById.clear();
}

export async function createSlaPolicy(tenant: string, dto: CreateSlaPolicyDto) {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);

  if (!tenantId) throw new Error("Tenant not found.");

  if (dto.is_default) {
    assertDefaultShape(
      dto.status || "active",
      dto.applies_to ?? "All customers",
    );
  }
  await assertScopeAllowed(supabase, tenantId, {
    isDefault: dto.is_default,
    status: dto.status || "active",
    appliesTo: dto.applies_to ?? "All customers",
    customerIds: dto.customer_ids ?? [],
  });

  const row = {
    tenant_id: tenantId,
    name: dto.name,
    description: dto.description ?? "",
    updated_by: await currentUserId(supabase),
    status: dto.status || ("active" as const),
    applies_to: dto.applies_to ?? "All customers",
    business_hours_id: dto.business_hours_id || null,
    is_default: false,
    notify_before_breach: dto.notify_before_breach ?? true,
    notify_before_mins: dto.notify_before_mins ?? 15,
    escalate_on_breach: dto.escalate_on_breach ?? false,
    escalate_to_role: dto.escalate_to_role ?? "manager",
  };
  const insert = (values: typeof row) =>
    supabase.from("sla_policies").insert(values).select().single();

  let { data: policy, error } = await insert(row);
  if (isMissingEditorColumn(error)) {
    warnMissingEditorColumns();
    ({ data: policy, error } = await insert(withoutEditorColumns(row)));
  }

  if (isMissingCustomerScope(error)) throw missingCustomerScopeError();
  if (error || !policy) throw new Error(error?.message ?? "Couldn't create.");

  await replacePolicyTargets(supabase, tenantId, policy.id, dto.targets);
  await replacePolicyCustomers(
    supabase,
    tenantId,
    policy.id,
    dto.customer_ids ?? [],
  );
  if (dto.is_default) {
    await makeDefaultPolicy(supabase, tenantId, policy.id);
  }

  return policy;
}

export async function updateSlaPolicy(
  tenant: string,
  policyId: string,
  dto: UpdateSlaPolicyDto,
) {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);

  if (!tenantId) throw new Error("Tenant not found.");

  const { data: current, error: readError } = await supabase
    .from("sla_policies")
    .select("status, is_default")
    .eq("id", policyId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (readError || !current) throw new Error("Policy not found.");

  const status = dto.status ?? (current.status as PolicyStatus);
  const willBeDefault = dto.is_default ?? current.is_default;

  if (current.is_default && dto.is_default === false) {
    throw new Error(
      "There must always be a default SLA. Make another policy the default instead.",
    );
  }
  if (willBeDefault) {
    assertDefaultShape(status, dto.applies_to ?? "All customers");
  }

  await assertScopeAllowed(supabase, tenantId, {
    id: policyId,
    isDefault: willBeDefault,
    status,
    appliesTo: dto.applies_to ?? "All customers",
    customerIds: dto.customer_ids ?? [],
  });

  const updates: Record<string, unknown> = {
    ...dto,
    updated_at: new Date().toISOString(),
    updated_by: await currentUserId(supabase),
  };
  delete updates.targets;
  delete updates.customer_ids;
  // Moved by makeDefaultPolicy below, never written directly.
  delete updates.is_default;

  const update = (values: Record<string, unknown>) =>
    supabase
      .from("sla_policies")
      .update(values)
      .eq("id", policyId)
      .eq("tenant_id", tenantId)
      .select()
      .single();

  let { data: policy, error } = await update(updates);
  if (isMissingEditorColumn(error)) {
    warnMissingEditorColumns();
    ({ data: policy, error } = await update(withoutEditorColumns(updates)));
  }

  if (isMissingCustomerScope(error)) throw missingCustomerScopeError();
  if (error) throw new Error(error.message);

  const existing = await loadPolicyTargets([policyId]);
  await replacePolicyTargets(
    supabase,
    tenantId,
    policyId,
    dto.targets,
    existing,
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

  return policy;
}

/**
 * Copies a policy and its targets. The copy starts inactive so two policies
 * with the same scope are never both live until someone edits the copy.
 */
export async function duplicateSlaPolicy(tenant: string, id: string) {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);

  if (!tenantId) throw new Error("Tenant not found.");

  const { data: source, error: readError } = await supabase
    .from("sla_policies")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (readError || !source) throw new Error("Policy not found.");

  const copyRow = {
    tenant_id: tenantId,
    name: `Copy of ${source.name}`.slice(0, 120),
    description: source.description ?? "",
    updated_by: await currentUserId(supabase),
    status: "paused" as const,
    applies_to: source.applies_to,
    business_hours_id: source.business_hours_id,
    is_default: false,
    notify_before_breach: source.notify_before_breach,
    notify_before_mins: source.notify_before_mins ?? 15,
    escalate_on_breach: source.escalate_on_breach,
    escalate_to_role: source.escalate_to_role ?? "manager",
  };
  const insertCopy = (values: typeof copyRow) =>
    supabase.from("sla_policies").insert(values).select("id").single();

  let { data: policy, error } = await insertCopy(copyRow);
  if (isMissingEditorColumn(error)) {
    warnMissingEditorColumns();
    ({ data: policy, error } = await insertCopy(withoutEditorColumns(copyRow)));
  }

  if (error || !policy) throw new Error(error?.message ?? "Couldn't copy.");

  const [targets, customerIds] = await Promise.all([
    loadPolicyTargets([id]),
    loadPolicyCustomerIds(supabase, [id]),
  ]);
  await replacePolicyCustomers(
    supabase,
    tenantId,
    policy.id,
    customerIds.get(id) ?? [],
  );
  await replacePolicyTargets(
    supabase,
    tenantId,
    policy.id,
    targets.map((t) => ({
      priority: t.priority_scope as PriorityScope,
      firstResponseMins: t.first_response_mins,
      firstResponseBusiness: t.first_response_business,
      resolutionMins: t.resolution_mins,
      resolutionBusiness: t.resolution_business,
    })),
  );

  return policy;
}

export async function toggleSlaPolicyStatus(tenant: string, id: string) {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);

  if (!tenantId) throw new Error("Tenant not found.");

  const { data: current, error: readError } = await supabase
    .from("sla_policies")
    .select("status, applies_to, is_default")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (readError || !current) throw new Error("Policy not found.");

  const next: PolicyStatus = current.status === "active" ? "paused" : "active";

  if (current.is_default && next !== "active") {
    throw new Error(
      "The default SLA must stay active. Make another policy the default first.",
    );
  }

  if (next === "active") {
    const customerIds = await loadPolicyCustomerIds(supabase, [id]);
    await assertScopeAllowed(supabase, tenantId, {
      id,
      status: "active",
      appliesTo: toAppliesTo(current.applies_to),
      customerIds: customerIds.get(id) ?? [],
    });
  }

  const { error } = await supabase
    .from("sla_policies")
    .update({ status: next })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(error.message);
}

export async function deleteSlaPolicy(tenant: string, id: string) {
  const supabase = await createSupabaseServerClient();
  const tenantId = await getTenantIdBySlug(tenant);

  if (!tenantId) throw new Error("Tenant not found.");

  const { data: policy, error: readError } = await supabase
    .from("sla_policies")
    .select("is_default")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (readError || !policy) throw new Error("Policy not found.");
  if (policy.is_default) {
    throw new Error("The default SLA policy cannot be deleted.");
  }

  const { error: targetError } = await supabase
    .from("sla_policy_targets")
    .delete()
    .eq("policy_id", id)
    .eq("tenant_id", tenantId);
  if (targetError) throw new Error(targetError.message);

  const { error } = await supabase
    .from("sla_policies")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(error.message);
}
