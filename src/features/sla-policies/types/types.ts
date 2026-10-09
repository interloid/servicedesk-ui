import {
  DurationUnit,
  formatDurationShort,
  toDurationInput,
} from "../duration";

export type PolicyStatus = "active" | "paused" | "draft";

/** "paused" is shown as Inactive, as the design labels it. */
export const POLICY_STATUS_LABELS: Record<PolicyStatus, string> = {
  active: "Active",
  paused: "Inactive",
  draft: "Draft",
};

export type PriorityScope = "urgent" | "high" | "normal" | "low";

export const PRIORITY_SCOPES: PriorityScope[] = [
  "urgent",
  "high",
  "normal",
  "low",
];

export const PRIORITY_LABELS: Record<PriorityScope, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

/**
 * Where each priority starts on a new policy: the ladder tightens as priority
 * rises (urgent tightest, low loosest), the same numbers onboarding seeds.
 */
export const DEFAULT_TARGET_MINS: Record<
  PriorityScope,
  { firstResponseMins: number; resolutionMins: number }
> = {
  urgent: { firstResponseMins: 15, resolutionMins: 240 },
  high: { firstResponseMins: 60, resolutionMins: 480 },
  normal: { firstResponseMins: 240, resolutionMins: 2880 },
  low: { firstResponseMins: 1440, resolutionMins: 7200 },
};

/** What the priority ladder rule looks at. */
export type OrderedTarget = Pick<
  SlaPolicyEditorTarget,
  "priority" | "firstResponseMins" | "resolutionMins"
>;

export interface PriorityOrderViolation {
  /** The priority whose time is too short. */
  scope: PriorityScope;
  /** The tighter priority it has to respect. */
  tighterScope: PriorityScope;
}

/**
 * Times may not shrink as priority drops: urgent is the tightest and low the
 * loosest, so within a policy urgent ≤ high ≤ normal ≤ low for both the first
 * response and the resolution clock. Priorities with no target are skipped.
 */
export function findPriorityOrderViolation(
  targets: readonly OrderedTarget[],
): PriorityOrderViolation | null {
  const byScope = new Map(targets.map((t) => [t.priority, t]));
  let tighter: OrderedTarget | undefined;

  for (const scope of PRIORITY_SCOPES) {
    const current = byScope.get(scope);
    if (!current) continue;
    if (
      tighter &&
      (current.firstResponseMins < tighter.firstResponseMins ||
        current.resolutionMins < tighter.resolutionMins)
    ) {
      return { scope, tighterScope: tighter.priority };
    }
    tighter = current;
  }
  return null;
}

/** The message shown on the offending row (editor) or returned by the action. */
export function describePriorityOrderViolation(
  violation: PriorityOrderViolation,
): string {
  return `${PRIORITY_LABELS[violation.scope]} must allow at least as much time as ${
    PRIORITY_LABELS[violation.tighterScope]
  } for both first response and resolution.`;
}

/** The SLA target a "notify before breach" lead time runs into. */
export interface NotifyLeadConflict {
  scope: PriorityScope;
  metric: "first response" | "resolution";
  targetMins: number;
}

/**
 * A warning must land before the deadline, so the lead time has to be shorter
 * than every priority's first response and resolution target. Returns the
 * tightest target it isn't shorter than, or null when it fits them all.
 */
export function findNotifyLeadConflict(
  leadMins: number,
  targets: readonly OrderedTarget[],
): NotifyLeadConflict | null {
  let conflict: NotifyLeadConflict | null = null;
  for (const t of targets) {
    for (const [metric, targetMins] of [
      ["first response", t.firstResponseMins],
      ["resolution", t.resolutionMins],
    ] as const) {
      if (
        leadMins >= targetMins &&
        (!conflict || targetMins < conflict.targetMins)
      ) {
        conflict = { scope: t.priority, metric, targetMins };
      }
    }
  }
  return conflict;
}

export function describeNotifyLeadConflict(
  conflict: NotifyLeadConflict,
): string {
  return `Must be less than the ${PRIORITY_LABELS[conflict.scope]} ${
    conflict.metric
  } target (${formatDurationShort(conflict.targetMins)}).`;
}

export interface SlaPolicyTarget {
  id: string;
  policy_id: string;
  tenant_id: string;
  priority_scope: string;
  first_response_mins: number;
  /** Missing until migration 20261009120000; the minutes are then 24-hour days. */
  first_response_unit?: DurationUnit;
  first_response_business: boolean;
  resolution_mins: number;
  resolution_unit?: DurationUnit;
  resolution_business: boolean;
}

export interface SlaHoliday {
  id: string;
  name: string;
  /** YYYY-MM-DD, in the calendar's own timezone. */
  date: string;
  allDay: boolean;
  /** HH:MM, only when allDay is false. */
  startTime?: string;
  endTime?: string;
  repeatsYearly: boolean;
  description?: string;
}

export interface BusinessHoursOption {
  id: string;
  name: string;
  /** "Mon".."Sun", as onboarding writes them into schedule_json. */
  workingDays: string[];
  dayStart: string | null;
  dayEnd: string | null;
  /** Break times removed. */
  breakStart: string | null;
  breakEnd: string | null;
  holidays: SlaHoliday[];
}

export interface BusinessHoursSchedule {
  workingDays: string[];
  dayStart: string;
  dayEnd: string;
  breakStart: string | null;
  breakEnd: string | null;
}

export const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * "24/7" is a policy with no calendar; "business" counts only the hours of the
 * calendar in business_hours_id. There is no column for this — the calendar
 * link is the setting.
 */
export type TimeCalculation = "24/7" | "business";

export interface SlaPolicy {
  id: string;
  name: string;
  description: string;
  appliedTickets: number;
  updated_at: string;
  updated_by_name: string | null;
  business_hours?: BusinessHoursOption | null;
  status: PolicyStatus;
  applies_to?: string | null;
  /** How many customers a 'Selected customers' policy is limited to. */
  selected_customer_count: number;
  is_default: boolean;
  business_hours_id?: string | null;
  business_hours_name?: string | null;
  notify_before_breach: boolean;
  notify_before_mins: number;
  escalate_on_breach: boolean;
  escalate_to_role: EscalationRole;
  targets: SlaPolicyTarget[];
}

/** Who a breach escalates to. Constrained in SQL too — see the migration. */
export type EscalationRole = "manager" | "tenant_admin";

export const ESCALATION_ROLES: { value: EscalationRole; label: string }[] = [
  { value: "manager", label: "Manager" },
  { value: "tenant_admin", label: "Tenant admin" },
];

export interface SlaPolicyEditorTarget {
  priority: PriorityScope;
  /** Minutes the clock counts: "days" are working days on business hours. */
  firstResponseMins: number;
  /**
   * Missing only for a row read before migration 20261009120000, whose
   * minutes count a day as 1440. The editor always sends one.
   */
  firstResponseUnit?: DurationUnit;
  firstResponseBusiness: boolean;
  resolutionMins: number;
  resolutionUnit?: DurationUnit;
  resolutionBusiness: boolean;
}

/** The target a new policy starts with for `priority`. */
export function emptyEditorTarget(
  priority: PriorityScope = "normal",
): SlaPolicyEditorTarget {
  const defaults = DEFAULT_TARGET_MINS[priority];
  return {
    priority,
    firstResponseMins: defaults.firstResponseMins,
    firstResponseUnit: toDurationInput(defaults.firstResponseMins).unit,
    firstResponseBusiness: false,
    resolutionMins: defaults.resolutionMins,
    resolutionUnit: toDurationInput(defaults.resolutionMins).unit,
    resolutionBusiness: false,
  };
}

export interface SlaPolicyEditorValue {
  id?: string;
  /**
   * The tenant's fallback ("Default SLA"): used for tickets no
   * customer-specific policy matches. Exactly one per tenant; always active
   * and for all customers; can't be deleted.
   */
  isDefault: boolean;
  name: string;
  description: string;
  appliesTo: SlaAppliesTo;
  /** Only meaningful when appliesTo is 'Selected customers'. */
  customerIds: string[];
  timeCalculation: TimeCalculation;
  businessHoursId: string | null;
  status: PolicyStatus;
  notifyBeforeBreach: boolean;
  notifyBeforeMins: number;
  escalateOnBreach: boolean;
  escalateToRole: EscalationRole;
  targets: SlaPolicyEditorTarget[];
}

/**
 * What the editor offers. The column also allows two legacy segment labels
 * ('Business & Enterprise customers', 'Urgent tickets only'); those read back
 * as 'All customers'.
 */
export type SlaAppliesTo = "All customers" | "Selected customers";

export const SLA_APPLIES_TO: SlaAppliesTo[] = [
  "All customers",
  "Selected customers",
];

export function toAppliesTo(raw: string | null | undefined): SlaAppliesTo {
  return raw === "Selected customers" ? raw : "All customers";
}

/** A tenant customer, as the "Selected customers" picker lists them. */
export interface SlaCustomerOption {
  id: string;
  name: string;
  email: string;
  company: string | null;
}

/** Cap on how many customers the picker loads; it filters them in the browser. */
export const SLA_CUSTOMER_PICKER_LIMIT = 1000;

export interface CreateSlaPolicyDto {
  name: string;
  description?: string;
  applies_to?: SlaAppliesTo;
  customer_ids?: string[];
  /** Make this the tenant's default SLA (moves it off the current one). */
  is_default?: boolean;
  status?: PolicyStatus;
  business_hours_id?: string | null;
  notify_before_breach?: boolean;
  notify_before_mins?: number;
  escalate_on_breach?: boolean;
  escalate_to_role?: EscalationRole;
  targets: SlaPolicyEditorTarget[];
}

export interface UpdateSlaPolicyDto {
  name?: string;
  description?: string;
  applies_to?: SlaAppliesTo | null;
  customer_ids?: string[];
  /** Make this the tenant's default SLA (moves it off the current one). */
  is_default?: boolean;
  status?: PolicyStatus;
  business_hours_id?: string | null;
  notify_before_breach?: boolean;
  notify_before_mins?: number;
  escalate_on_breach?: boolean;
  escalate_to_role?: EscalationRole;
  targets: SlaPolicyEditorTarget[];
}

/**
 * How many policies the tenant's plan allows. There is no column for this: the
 * cap lives in plans.features_json under `sla_policies`, where -1 means
 * unlimited (the convention the pricing page renders).
 */
export interface SlaPolicyQuota {
  planName: string;
  /** Policies allowed; null when the plan is unlimited. */
  limit: number | null;
}

/** Free's cap, used when no subscription row is readable. Matches the plans seed. */
export const FREE_SLA_POLICY_LIMIT = 1;

export function readPolicyLimit(
  featuresJson: Record<string, unknown> | undefined,
): number | null {
  const raw = featuresJson?.sla_policies;
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return FREE_SLA_POLICY_LIMIT;
  }
  return raw < 0 ? null : raw;
}

/** "Your Free plan includes 1 SLA policy." Empty for unlimited plans. */
export function describePolicyLimit(quota: SlaPolicyQuota): string {
  if (quota.limit === null) return "";
  return `Your ${quota.planName} plan includes ${quota.limit} SLA ${
    quota.limit === 1 ? "policy" : "policies"
  }.`;
}

export function hasPolicyRoom(quota: SlaPolicyQuota, used: number): boolean {
  return quota.limit === null || used < quota.limit;
}

/** What the editor's name field allows. */
export const SLA_NAME_MAX = 120;

/** Matches chk_sla_description_length. */
export const SLA_DESCRIPTION_MAX = 500;

/** What the Add holiday dialog allows for its description. */
export const HOLIDAY_DESCRIPTION_MAX = 200;
