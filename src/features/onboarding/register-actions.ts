// onboarding.actions.ts

"use server";

import type { RegisterInput } from "./schemas/onboarding.schema";
import {
  registerTenant,
  getTimezones,
  checkEmailTenant,
  checkSlugAvailability,
} from "./services/onboarding.service";

export async function registerOnboardingAction(
  payload: RegisterInput,
) {
  try {
    const result = await registerTenant(payload);

    return {
      success: true,
      data: result.data,
    };
  } catch (error: unknown) {
    console.error("[Onboarding Action Error]:", error);

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "An unexpected error occurred during setup.",
    };
  }
}

export async function getTimezonesAction() {
  try {
    const data = await getTimezones();

    return {
      success: true,
      data,
    };
  } catch (error: unknown) {
    console.error("[Timezone Action Error]:", error);

    return {
      success: false,
      data: [],
      error:
        error instanceof Error
          ? error.message
          : "Failed to load timezones.",
    };
  }
}

export async function checkEmailTenantAction(email: string) {
  try {
    return await checkEmailTenant(email);
  } catch (error: unknown) {
    console.error("[Email Check Action Error]:", error);

    return {
      exists: false,
    };
  }
}

export async function checkSlugAvailabilityAction(slug: string) {
  try {
    return await checkSlugAvailability(slug);
  } catch (error: unknown) {
    console.error("[Slug Check Action Error]:", error);

    return {
      available: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to check portal address.",
    };
  }
}