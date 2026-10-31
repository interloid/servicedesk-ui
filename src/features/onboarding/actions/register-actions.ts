"use server";

import { RegisterInput } from "../schemas/onboarding.schema";
import { clientKey, rateLimit } from "@/lib/rate-limit";
import {
  registerTenant,
  getTimezones,
  checkEmailTenant,
  checkSlugAvailability,
} from "../services/onboarding.service";

export async function registerOnboardingAction(payload: RegisterInput) {
  try {
    // Each sign-up creates an account and a workspace and mails every invitee.
    const { allowed } = await rateLimit(`signup:${await clientKey()}`, {
      limit: 3,
      windowMs: 60 * 60_000,
    });

    if (!allowed) {
      return {
        success: false,
        error: "Too many sign-ups from this network. Try again later.",
      };
    }

    const result = await registerTenant(payload);

    return {
      success: true,
      requiresEmailConfirmation: result.requiresEmailConfirmation,
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
        error instanceof Error ? error.message : "Failed to load timezones.",
    };
  }
}

export async function checkEmailTenantAction(
  email: string,
): Promise<{ exists: boolean; rateLimited?: boolean }> {
  try {
    const { allowed } = await rateLimit(`check-email:${await clientKey()}`, {
      limit: 10,
      windowMs: 60_000,
    });

    if (!allowed) {
      return { exists: false, rateLimited: true };
    }

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
    const { allowed } = await rateLimit(`check-slug:${await clientKey()}`, {
      limit: 20,
      windowMs: 60_000,
    });

    if (!allowed) {
      return {
        available: false,
        error: "Too many checks. Wait a moment and try again.",
      };
    }

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
