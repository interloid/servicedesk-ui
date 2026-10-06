"use server";

import { revalidatePath } from "next/cache";
import {
  createSlaPolicy,
  deleteSlaPolicy,
  duplicateSlaPolicy,
  fetchTenantSlaPolicies,
  toggleSlaPolicyStatus,
  updateBusinessHoursHolidays,
  updateBusinessHoursSchedule,
  updateSlaPolicy,
} from "../service/sla.service";
import {
  BusinessHoursSchedule,
  CreateSlaPolicyDto,
  HOLIDAY_DESCRIPTION_MAX,
  SLA_CUSTOMER_PICKER_LIMIT,
  SLA_DESCRIPTION_MAX,
  SlaHoliday,
  UpdateSlaPolicyDto,
  WEEK_DAYS,
} from "../types/types";

const failure = (error: unknown) => ({
  success: false as const,
  error: error instanceof Error ? error.message : "An error occurred",
});

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export async function getSlaPoliciesAction(tenant: string) {
  try {
    const policies = await fetchTenantSlaPolicies(tenant);
    return { success: true, policies };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}

export async function createSlaPolicyAction(
  tenant: string,
  dto: CreateSlaPolicyDto,
) {
  try {
    if (!dto?.name?.trim()) {
      return { success: false, error: "Policy name is required." };
    }
    if ((dto.description ?? "").length > SLA_DESCRIPTION_MAX) {
      return {
        success: false,
        error: `Keep the description under ${SLA_DESCRIPTION_MAX} characters.`,
      };
    }
    if (!dto?.targets?.length) {
      return {
        success: false,
        error: "At least one SLA target is required.",
      };
    }
    const scopeError = checkScope(dto);
    if (scopeError) return { success: false, error: scopeError };

    const policy = await createSlaPolicy(tenant, dto);
    revalidatePath(`/${tenant}/sla`);
    return { success: true, policy };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}

export async function updateSlaPolicyAction(
  tenant: string,
  policyId: string,
  dto: UpdateSlaPolicyDto,
) {
  try {
    if (!dto?.name?.trim()) {
      return { success: false, error: "Policy name is required." };
    }
    if ((dto.description ?? "").length > SLA_DESCRIPTION_MAX) {
      return {
        success: false,
        error: `Keep the description under ${SLA_DESCRIPTION_MAX} characters.`,
      };
    }
    if (!dto?.targets?.length) {
      return {
        success: false,
        error: "At least one SLA target is required.",
      };
    }
    const scopeError = checkScope(dto);
    if (scopeError) return { success: false, error: scopeError };

    const policy = await updateSlaPolicy(tenant, policyId, dto);
    revalidatePath(`/${tenant}/sla`);
    revalidatePath(`/${tenant}/sla/${policyId}`);
    return { success: true, policy };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}

export async function deleteSlaPolicyAction(tenant: string, policyId: string) {
  try {
    await deleteSlaPolicy(tenant, policyId);
    revalidatePath(`/${tenant}/sla`);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
  }
}

export async function duplicateSlaPolicyAction(tenant: string, id: string) {
  try {
    const policy = await duplicateSlaPolicy(tenant, id);
    revalidatePath(`/${tenant}/sla`);
    return { success: true as const, policyId: policy.id };
  } catch (error) {
    return failure(error);
  }
}

export async function toggleSlaPolicyAction(tenant: string, id: string) {
  try {
    await toggleSlaPolicyStatus(tenant, id);
    revalidatePath(`/${tenant}/sla`);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "An error occurred",
    };
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
    return { success: false, error: "Pick at least one working day." };
  }
  if (!TIME.test(schedule.dayStart) || !TIME.test(schedule.dayEnd)) {
    return { success: false, error: "Enter times as HH:MM." };
  }
  if (schedule.dayEnd <= schedule.dayStart) {
    return { success: false, error: "The day has to end after it starts." };
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
  if (typeof parsed === "string") return { success: false, error: parsed };

  const holiday: SlaHoliday = { id: crypto.randomUUID(), ...parsed };

  try {
    const businessHours = await updateBusinessHoursHolidays(
      tenant,
      businessHoursId,
      (current) => [...current, holiday],
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
  if (typeof parsed === "string") return { success: false, error: parsed };

  try {
    const businessHours = await updateBusinessHoursHolidays(
      tenant,
      businessHoursId,
      (current) => {
        if (!current.some((h) => h.id === holidayId)) {
          throw new Error("That holiday no longer exists.");
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
