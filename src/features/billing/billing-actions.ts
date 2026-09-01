"use server";

import { revalidatePath } from "next/cache";
import { changeTenantPlan } from "./services/billing-service";
import { fetchTenantBillingData } from "./services/billing-dashboard.service";

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
    const { abortPlanSwitch } = await import("./services/billing-service");
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
): Promise<{ success: boolean; error?: string; planName?: string }> {
  if (!subscriptionId) {
    return {
      success: false,
      error: "Subscription ID is required.",
    };
  }

  try {
    const { activateTenantSubscription } =
      await import("./services/billing-service");
    const result = await activateTenantSubscription(tenantSlug, subscriptionId);
    revalidatePath(`/tenant/${tenantSlug}/account/billing`);
    revalidatePath(`/tenant/${tenantSlug}/account/plans`);
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to activate plan",
    };
  }
}
