"use server";

import { revalidatePath } from "next/cache";
import { changeTenantPlan } from "./services/billing.service";

export async function changeTenantPlanAction(
  tenantSlug: string,
  newPlan: string,
) {
  try {
    const result = await changeTenantPlan(tenantSlug, newPlan);

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
      invoice: result.invoice ?? false,
      proratedCredit: result.proratedCredit ?? null,
      amountDue: result.amountDue ?? null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to change plan";
    return { success: false, error: message };
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

export async function cancelSubscriptionAction(
  tenantSlug: string,
  reason?: string,
) {
  try {
    const { cancelSubscription } = await import("./services/billing.service");
    const result = await cancelSubscription(tenantSlug, reason);
    revalidatePath(`/${tenantSlug}/account/billing`);
    revalidatePath(`/${tenantSlug}/account/plans`);
    return result;
  } catch (error) {
    console.error("cancelSubscriptionAction error:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to cancel subscription.",
    };
  }
}

export async function confirmOrderPaymentAction(
  tenantSlug: string,
  orderId: string,
): Promise<{
  success: boolean;
  error?: string;
  planName?: string;
  subscriptionId?: string | null;
  approvalUrl?: string | null;
  nextBilling?: number;
}> {
  if (!orderId) {
    return {
      success: false,
      error: "Order ID is required.",
    };
  }

  try {
    const { captureOrderPayment } = await import("./services/billing.service");
    const result = await captureOrderPayment(tenantSlug, orderId);
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
