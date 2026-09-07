"use server";

import { revalidatePath } from "next/cache";
import { changeTenantPlan } from "./services/billing.service";
import { fetchTenantBillingData } from "./services/billing-dashboard.service";

export async function changeTenantPlanAction(
  tenantSlug: string,
  newPlan: string,
  fundingPreference: "paypal" | "card" = "paypal",
) {
  try {
    const result = await changeTenantPlan(
      tenantSlug,
      newPlan,
      undefined,
      fundingPreference,
    );

    if (!result.success) {
      return {
        success: false,
        error: result.error ?? "Failed to change plan",
      };
    }

    revalidatePath(`/${tenantSlug}/account/billing`);
    return {
      success: true,
      error: null,
      subscriptionId: result.subscriptionId,
      approvalUrl: result.approvalUrl,
      scheduled: result.scheduled ?? false,
      effectiveAt: result.effectiveAt ?? null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to change plan";
    return { success: false, error: message };
  }
}

export async function getBillingDashboardAction(tenantSlug: string) {
  try {
    const data = await fetchTenantBillingData(tenantSlug);
    if (!data) return { error: "Tenant billing data not found" };
    return { success: true, data };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
}

export async function abortPlanSwitchAction(tenantSlug: string) {
  try {
    const { abortPlanSwitch } = await import("./services/billing.service");
    const result = await abortPlanSwitch(tenantSlug);
    revalidatePath(`/${tenantSlug}/account/plans`);
    revalidatePath(`/${tenantSlug}/account/billing`);
    return result;
  } catch (error) {
    console.error("abortPlanSwitchAction error:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to restore your plan.",
    };
  }
}

export async function confirmSubscriptionActivationAction(
  tenantSlug: string,
  subscriptionId: string,
): Promise<{
  success: boolean;
  error?: string;
  planName?: string;
  scheduled?: boolean;
  effectiveAt?: string | null;
}> {
  if (!subscriptionId) {
    return {
      success: false,
      error: "Subscription ID is required.",
    };
  }

  try {
    const { activateTenantSubscription } =
      await import("./services/billing.service");
    const result = await activateTenantSubscription(tenantSlug, subscriptionId);
    revalidatePath(`/${tenantSlug}/account/billing`);
    revalidatePath(`/${tenantSlug}/account/plans`);
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to activate plan",
    };
  }
}

/**
 * Mints the short-lived PayPal token that lets the browser render hosted card
 * fields for this tenant's checkout.
 *
 * The merchant secret stays inside the `subscription` Edge Function, which
 * only issues a token once it has re-checked that the caller may manage this
 * tenant's billing. The token is scoped to confirming a subscription and
 * expires in minutes, so it is fetched per checkout rather than cached.
 */
export async function getPayPalSdkTokenAction(tenantSlug: string): Promise<{
  success: boolean;
  error?: string;
  sdkToken?: string;
  environment?: "sandbox" | "live";
}> {
  try {
    const { createSupabaseServerClient } =
      await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { success: false, error: "Unauthorized" };
    }

    const { data, error } = await supabase.functions.invoke("subscription", {
      body: { action: "sdk-token", tenantSlug },
    });

    if (error) {
      let message: string | undefined;

      try {
        const body = (await error.context?.json()) as
          { message?: string } | undefined;
        message = body?.message;
      } catch {
        message = undefined;
      }

      console.error("[PayPal] client token action failed:", message ?? error);
      return {
        success: false,
        error: message ?? "Could not start card checkout.",
      };
    }

    if (!data?.success || !data?.sdkToken) {
      return {
        success: false,
        error: data?.message ?? "Could not start card checkout.",
      };
    }

    // The token itself is never logged -- only that one was issued.
    return {
      success: true,
      sdkToken: data.sdkToken as string,
      environment: (data.environment as "sandbox" | "live") ?? "live",
    };
  } catch (error) {
    console.error("[PayPal] client token action error:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not start card checkout.",
    };
  }
}

/**
 * Re-syncs the tenant's payment method from PayPal and returns where the
 * customer changes it.
 *
 * All PayPal work lives in the `update-payment-method` Edge Function so there
 * is one implementation of the payment-method mapping rather than a Node copy
 * drifting from the Deno one. Nothing here creates a subscription or a tenant.
 */
export async function updatePaymentMethodAction(tenantSlug: string): Promise<{
  success: boolean;
  error?: string;
  manageUrl?: string | null;
  paymentMethod?: {
    type: "card" | "paypal";
    brand: string | null;
    last4: string | null;
    expiryMonth: number | null;
    expiryYear: number | null;
    email: string | null;
  } | null;
}> {
  try {
    const { createSupabaseServerClient } =
      await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { success: false, error: "Unauthorized" };
    }

    const { data, error } = await supabase.functions.invoke(
      "update-payment-method",
      { body: { tenantSlug } },
    );

    if (error) {
      let message: string | undefined;

      try {
        const body = (await error.context?.json()) as
          { message?: string } | undefined;
        message = body?.message;
      } catch {
        message = undefined;
      }

      console.error("updatePaymentMethodAction failed:", message ?? error);
      return {
        success: false,
        error: message ?? "Failed to update payment method",
      };
    }

    if (!data?.success) {
      return {
        success: false,
        error: data?.message ?? "Failed to update payment method",
      };
    }

    revalidatePath(`/${tenantSlug}/account/billing`);

    return {
      success: true,
      manageUrl: data.manageUrl ?? null,
      paymentMethod: data.paymentMethod ?? null,
    };
  } catch (error) {
    console.error("updatePaymentMethodAction error:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to update payment method",
    };
  }
}
