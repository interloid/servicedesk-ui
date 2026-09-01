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
    revalidatePath(`/tenant/${tenantSlug}/account/billing`);
    return {
      success: true,
      error: null,
      subscriptionId: result.subscriptionId,
      approvalUrl: result.approvalUrl,
    };
  } catch (error: any) {
    return { success: false, error: error.message || "Failed to change plan" };
  }
}

export async function getBillingDashboardAction(tenantSlug: string) {
  try {
    const data = await fetchTenantBillingData(tenantSlug);
    if (!data) return { error: "Tenant billing data not found" };
    return { success: true, data };
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function confirmSubscriptionActivationAction(
  tenantSlug: string,
): Promise<{ success: boolean; error?: string; planName?: string }> {
  try {
    const { activateTenantSubscription } =
      await import("./services/billing-service");
    const result = await activateTenantSubscription(tenantSlug);
    revalidatePath(`/tenant/${tenantSlug}/account/billing`);
    revalidatePath(`/tenant/${tenantSlug}/account/plans`);
    return result;
  } catch (error: any) {
    return {
      success: false,
      error: error.message || "Failed to activate plan",
    };
  }
}
