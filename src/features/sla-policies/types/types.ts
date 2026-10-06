export type PolicyStatus = "active" | "paused" | "draft";

/** "paused" is shown as Inactive, as the design labels it. */
export const POLICY_STATUS_LABELS: Record<PolicyStatus, string> = {
  active: "Active",
  paused: "Inactive",
  draft: "Draft",
};

export type PriorityScope = "urgent" | "high" | "normal" | "low";

export interface SlaPolicyTarget {
  id: string;
  policy_id: string;
  tenant_id: string;
  priority_scope: string;
  first_response_mins: number;
  first_response_business: boolean;
  resolution_mins: number;
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
  firstResponseMins: number;
  firstResponseBusiness: boolean;
  resolutionMins: number;
  resolutionBusiness: boolean;
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

export function hasPolicyRoom(quota: SlaPolicyQuota, used: number): boolean {
  return quota.limit === null || used < quota.limit;
}

/** Matches chk_sla_description_length. */
export const SLA_DESCRIPTION_MAX = 500;

/** What the Add holiday dialog allows for its description. */
export const HOLIDAY_DESCRIPTION_MAX = 200;

export const formatMinutes = (mins: number): string => {
  if (!Number.isFinite(mins)) return "—";
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = mins / 60;
  return Number.isInteger(h) ? `${h} hr` : `${h.toFixed(1)} hr`;
};
