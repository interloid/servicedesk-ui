"use server";

import { revalidatePath } from "next/cache";
import {
  createSlaPolicy,
  updateBusinessHoursHolidays,
  updateBusinessHoursSchedule,
  updateSlaPolicy,
} from "../service/sla.service";
import {
  BusinessHoursSchedule,
  CreateSlaPolicyDto,
  ESCALATION_ROLES,
  HOLIDAY_DESCRIPTION_MAX,
  POLICY_STATUS_LABELS,
  PRIORITY_SCOPES,
  SLA_CUSTOMER_PICKER_LIMIT,
  SLA_DESCRIPTION_MAX,
  SLA_NAME_MAX,
  SlaHoliday,
  SlaPolicyEditorTarget,
  UpdateSlaPolicyDto,
  WEEK_DAYS,
} from "../types/types";
import { isValidDurationMins } from "../duration";
import { DUPLICATE_HOLIDAY_MESSAGE, findHolidayOnDate } from "../holiday-rules";

const failure = (error: unknown) => ({
  success: false as const,
  error: error instanceof Error ? error.message : "An error occurred",
});

const invalid = (error: string) => ({ success: false as const, error });

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const optional = <T>(value: unknown, check: (v: unknown) => v is T) =>
  value === undefined || check(value);
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

/**
 * Normalises "Applies to" in place: only the two editor values reach the
 * database, and the customer list is deduped and dropped for 'All customers'.
 * Returns an error message, or null when the scope is fine. RLS still checks
 * that every customer belongs to the tenant.
 */
function checkScope(
  dto: CreateSlaPolicyDto | UpdateSlaPolicyDto,
): string | null {
  // Only a real boolean reaches the service; anything else means "unchanged".
  if (typeof dto.is_default !== "boolean") delete dto.is_default;
  if (dto.is_default && dto.applies_to === "Selected customers") {
    return "The default SLA applies to all customers.";
  }
  if (dto.applies_to !== "Selected customers") {
    dto.applies_to = "All customers";
    dto.customer_ids = [];
    return null;
  }

  const ids = [...new Set(dto.customer_ids ?? [])];
  if (ids.length === 0) return "Pick at least one customer.";
  if (ids.length > SLA_CUSTOMER_PICKER_LIMIT) {
    return `Pick at most ${SLA_CUSTOMER_PICKER_LIMIT} customers.`;
  }
  if (!ids.every((id) => typeof id === "string" && UUID.test(id))) {
    return "One of the selected customers is invalid.";
  }
  dto.customer_ids = ids;
  return null;
}

/**
 * Normalises the targets in place to one clean row per priority. A server
 * action takes whatever JSON the browser sends, so this repeats the editor's
 * checks before anything is written.
 */
function checkTargets(
  dto: CreateSlaPolicyDto | UpdateSlaPolicyDto,
): string | null {
  if (!Array.isArray(dto.targets) || dto.targets.length === 0) {
    return "At least one SLA target is required.";
  }

  const seen = new Set<string>();
  const targets: SlaPolicyEditorTarget[] = [];
  for (const raw of dto.targets as unknown[]) {
    const t = (raw ?? {}) as Partial<SlaPolicyEditorTarget>;
    if (!t.priority || !PRIORITY_SCOPES.includes(t.priority)) {
      return "One of the SLA targets has an unknown priority.";
    }
    if (seen.has(t.priority)) {
      return "Each priority can only have one SLA target.";
    }
    seen.add(t.priority);
    if (
      !isValidDurationMins(t.firstResponseMins) ||
      !isValidDurationMins(t.resolutionMins)
    ) {
      return "Enter SLA targets as whole numbers greater than zero, up to a year.";
    }
    if (t.resolutionMins < t.firstResponseMins) {
      return "Resolution must be at least the first response time.";
    }
    targets.push({
      priority: t.priority,
      firstResponseMins: t.firstResponseMins,
      firstResponseBusiness: t.firstResponseBusiness === true,
      resolutionMins: t.resolutionMins,
      resolutionBusiness: t.resolutionBusiness === true,
    });
  }
  dto.targets = targets;
  return null;
}

/** Checks and normalises a policy from the editor; returns an error or null. */
function checkPolicy(
  dto: CreateSlaPolicyDto | UpdateSlaPolicyDto,
): string | null {
  if (!dto || typeof dto !== "object") return "Invalid request.";

  const name = typeof dto.name === "string" ? dto.name.trim() : "";
  if (!name) return "Policy name is required.";
  if (name.length > SLA_NAME_MAX) {
    return `Keep the name under ${SLA_NAME_MAX} characters.`;
  }
  dto.name = name;

  if (!optional(dto.description, (v): v is string => typeof v === "string")) {
    return "Invalid description.";
  }
  if ((dto.description ?? "").length > SLA_DESCRIPTION_MAX) {
    return `Keep the description under ${SLA_DESCRIPTION_MAX} characters.`;
  }
  if (
    dto.status !== undefined &&
    !Object.hasOwn(POLICY_STATUS_LABELS, dto.status)
  ) {
    return "Pick a valid status.";
  }
  if (
    dto.business_hours_id != null &&
    !(
      typeof dto.business_hours_id === "string" &&
      UUID.test(dto.business_hours_id)
    )
  ) {
    return "Pick a valid business hours calendar.";
  }
  if (
    !optional(dto.notify_before_breach, isBoolean) ||
    !optional(dto.escalate_on_breach, isBoolean)
  ) {
    return "Invalid notification settings.";
  }
  if (
    dto.notify_before_mins !== undefined &&
    !(
      Number.isInteger(dto.notify_before_mins) &&
      dto.notify_before_mins >= 1 &&
      dto.notify_before_mins <= 1440
    )
  ) {
    // Matches chk_sla_notify_before_mins.
    return "Warn the assignee between 1 minute and 24 hours before the target.";
  }
  if (
    dto.escalate_to_role !== undefined &&
    !ESCALATION_ROLES.some((r) => r.value === dto.escalate_to_role)
  ) {
    return "Pick who a breach escalates to.";
  }

  return checkTargets(dto) ?? checkScope(dto);
}

export async function createSlaPolicyAction(
  tenant: string,
  dto: CreateSlaPolicyDto,
) {
  const error = checkPolicy(dto);
  if (error) return invalid(error);

  try {
    const policy = await createSlaPolicy(tenant, dto);
    revalidatePath(`/${tenant}/sla`);
    return { success: true as const, policy };
  } catch (error) {
    return failure(error);
  }
}

export async function updateSlaPolicyAction(
  tenant: string,
  policyId: string,
  dto: UpdateSlaPolicyDto,
) {
  if (typeof policyId !== "string" || !UUID.test(policyId)) {
    return invalid("Policy not found.");
  }
  const error = checkPolicy(dto);
  if (error) return invalid(error);

  try {
    const policy = await updateSlaPolicy(tenant, policyId, dto);
    revalidatePath(`/${tenant}/sla`);
    revalidatePath(`/${tenant}/sla/${policyId}`);
    return { success: true as const, policy };
  } catch (error) {
    return failure(error);
  }
}

export async function updateBusinessHoursScheduleAction(
  tenant: string,
  businessHoursId: string,
  schedule: BusinessHoursSchedule,
) {
  const workingDays = WEEK_DAYS.filter((d) =>
    schedule?.workingDays?.includes(d),
  );
  if (workingDays.length === 0) {
    return invalid("Pick at least one working day.");
  }
  if (!TIME.test(schedule.dayStart) || !TIME.test(schedule.dayEnd)) {
    return invalid("Enter times as HH:MM.");
  }
  if (schedule.dayEnd <= schedule.dayStart) {
    return invalid("The day has to end after it starts.");
  }

  // Break times removed - not supported

  try {
    const businessHours = await updateBusinessHoursSchedule(
      tenant,
      businessHoursId,
      {
        workingDays,
        dayStart: schedule.dayStart,
        dayEnd: schedule.dayEnd,
        breakStart: null,
        breakEnd: null,
      },
    );
    revalidatePath(`/${tenant}/sla`, "layout");
    return { success: true as const, businessHours };
  } catch (error) {
    return failure(error);
  }
}

/** Checks and normalises a holiday from the dialog; a string is the error. */
function parseHoliday(
  input: Omit<SlaHoliday, "id">,
): Omit<SlaHoliday, "id"> | string {
  const name = input?.name?.trim() ?? "";
  const description = input?.description?.trim() ?? "";

  if (!name) return "Give the holiday a name.";
  if (name.length > 100) return "Keep the name under 100 characters.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "")) return "Pick a date.";
  if (description.length > HOLIDAY_DESCRIPTION_MAX) {
    return `Keep the description under ${HOLIDAY_DESCRIPTION_MAX} characters.`;
  }
  if (!input.allDay) {
    if (!TIME.test(input.startTime ?? "") || !TIME.test(input.endTime ?? "")) {
      return "Enter start and end times as HH:MM.";
    }
    if (input.endTime! <= input.startTime!) {
      return "The end time has to be after the start.";
    }
  }

  return {
    name,
    date: input.date,
    allDay: input.allDay,
    startTime: input.allDay ? undefined : input.startTime,
    endTime: input.allDay ? undefined : input.endTime,
    repeatsYearly: Boolean(input.repeatsYearly),
    description: description || undefined,
  };
}

export async function addHolidayAction(
  tenant: string,
  businessHoursId: string,
  input: Omit<SlaHoliday, "id">,
) {
  const parsed = parseHoliday(input);
  if (typeof parsed === "string") return invalid(parsed);

  const holiday: SlaHoliday = { id: crypto.randomUUID(), ...parsed };

  try {
    const businessHours = await updateBusinessHoursHolidays(
      tenant,
      businessHoursId,
      (current) => {
        if (findHolidayOnDate(current, holiday)) {
          throw new Error(DUPLICATE_HOLIDAY_MESSAGE);
        }
        return [...current, holiday];
      },
    );
    revalidatePath(`/${tenant}/sla`, "layout");
    return { success: true as const, businessHours };
  } catch (error) {
    return failure(error);
  }
}

export async function updateHolidayAction(
  tenant: string,
  businessHoursId: string,
  holidayId: string,
  input: Omit<SlaHoliday, "id">,
) {
  const parsed = parseHoliday(input);
  if (typeof parsed === "string") return invalid(parsed);

  try {
    const businessHours = await updateBusinessHoursHolidays(
      tenant,
      businessHoursId,
      (current) => {
        if (!current.some((h) => h.id === holidayId)) {
          throw new Error("That holiday no longer exists.");
        }
        if (findHolidayOnDate(current, parsed, holidayId)) {
          throw new Error(DUPLICATE_HOLIDAY_MESSAGE);
        }
        return current.map((h) =>
          h.id === holidayId ? { id: holidayId, ...parsed } : h,
        );
      },
    );
    revalidatePath(`/${tenant}/sla`, "layout");
    return { success: true as const, businessHours };
  } catch (error) {
    return failure(error);
  }
}

export async function removeHolidayAction(
  tenant: string,
  businessHoursId: string,
  holidayId: string,
) {
  try {
    const businessHours = await updateBusinessHoursHolidays(
      tenant,
      businessHoursId,
      (current) => current.filter((h) => h.id !== holidayId),
    );
    revalidatePath(`/${tenant}/sla`, "layout");
    return { success: true as const, businessHours };
  } catch (error) {
    return failure(error);
  }
}
