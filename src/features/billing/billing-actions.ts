"use server";

import { revalidatePath } from "next/cache";
import { changeTenantPlan } from "./services/billing.service";
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
): Promise<{ success: boolean; error?: string; planName?: string }> {
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

export async function updatePaymentMethodAction(tenantSlug: string) {
  console.log("🚀 ~ updatePaymentMethodAction ~ tenantSlug:", tenantSlug)
  try {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    const supabase = await createSupabaseServerClient();

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return { success: false, error: "Unauthorized" };
    }

    const { data: tenant, error: tenantError } = await supabase
      .from("tenants")
      .select("id, slug")
      .eq("slug", tenantSlug)
      .single();

    if (tenantError || !tenant) {
      return { success: false, error: "Tenant not found" };
    }

    const { data: billingMember, error: membershipError } = await supabase
      .from("memberships")
      .select("id")
      .eq("user_id", user.id)
      .eq("tenant_id", tenant.id)
      .in("role", ["tenant_admin", "billing_admin"])
      .eq("status", "active")
      .maybeSingle();

    if (membershipError || !billingMember) {
      return {
        success: false,
        error: "You do not have billing permissions for this tenant.",
      };
    }

    const { data: subscription, error: subError } = await supabase
      .from("subscriptions")
      .select("id, paypal_subscription_id, status")
      .eq("tenant_id", tenant.id)
      .in("status", ["active", "trialing", "past_due"])
      .maybeSingle();

    if (subError || !subscription) {
      return {
        success: false,
        error: "No active subscription found for this tenant.",
      };
    }

    const paypalSubscriptionId = subscription.paypal_subscription_id;
    if (!paypalSubscriptionId || paypalSubscriptionId.startsWith("FREE-")) {
      return {
        success: false,
        error: "This tenant does not have a PayPal subscription.",
      };
    }

    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const serviceClient = createSupabaseAdminClient();

    const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
    const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
    const PAYPAL_BASE_URL = process.env.PAYPAL_BASE_URL;

    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET || !PAYPAL_BASE_URL) {
      return {
        success: false,
        error: "PayPal configuration is missing.",
      };
    }

    const tokenResponse = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!tokenResponse.ok) {
      return {
        success: false,
        error: "Failed to authenticate with PayPal.",
      };
    }

    const { access_token } = await tokenResponse.json();

    const subscriptionResponse = await fetch(
      `${PAYPAL_BASE_URL}/v1/billing/subscriptions/${paypalSubscriptionId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!subscriptionResponse.ok) {
      return {
        success: false,
        error: "Failed to fetch subscription details from PayPal.",
      };
    }

    const paypalSubscription = await subscriptionResponse.json();

    const links = paypalSubscription.links as Array<{ rel: string; href: string }> | undefined;
    const approveLink = links?.find((link) => link.rel === "approve");
    const updateUrl = approveLink?.href || null;

    const subscriber = paypalSubscription.subscriber as Record<string, unknown> | undefined;
    const paymentSource = subscriber?.payment_source as Record<string, unknown> | undefined;
    const card = paymentSource?.card as Record<string, unknown> | undefined;

    const cardBrand = (card?.brand as string) || null;
    const cardLast4 = (card?.last_digits as string) || null;
    const cardExpiry = (card?.expiry as string) || null;
    const cardBin = (card?.bin_details as Record<string, unknown>)?.bin as string || null;
    const cardIssuer = (card?.bin_details as Record<string, unknown>)?.issuing_bank as string || null;
    const cardCountry = (card?.bin_details as Record<string, unknown>)?.bin_country_code as string || null;

    let expiryMonth: number | null = null;
    let expiryYear: number | null = null;
    if (cardExpiry) {
      const parts = cardExpiry.split("-");
      if (parts.length === 2) {
        expiryMonth = parseInt(parts[1], 10) || null;
        expiryYear = parseInt(parts[0], 10) || null;
      }
    }

    const paymentMethodData = {
      tenant_id: tenant.id,
      subscription_id: subscription.id,
      paypal_payment_token_id: paypalSubscriptionId,
      paypal_customer_id: (subscriber?.payer_id as string) || null,
      card_brand: cardBrand,
      card_last4: cardLast4,
      card_expiry_month: expiryMonth,
      card_expiry_year: expiryYear,
      card_bin: cardBin,
      card_issuer: cardIssuer,
      card_country: cardCountry,
      payment_source_type: paymentSource ? Object.keys(paymentSource)[0] : "paypal",
      is_default: true,
      status: "active",
    };

    const { data: existingPM } = await serviceClient
      .from("payment_methods")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("is_default", true)
      .maybeSingle();

    let upsertError;
    if (existingPM) {
      const { error } = await serviceClient
        .from("payment_methods")
        .update(paymentMethodData)
        .eq("id", existingPM.id);
      upsertError = error;
    } else {
      const { error } = await serviceClient
        .from("payment_methods")
        .insert(paymentMethodData);
      upsertError = error;
    }

    if (upsertError) {
      console.error("Failed to upsert payment method:", upsertError);
      return {
        success: false,
        error: "Failed to update payment method in database.",
      };
    }

    revalidatePath(`/${tenantSlug}/account/billing`);

    return {
      success: true,
      updateUrl,
      paymentMethod: {
        brand: cardBrand,
        last4: cardLast4,
        expiry: cardExpiry,
        type: paymentSource ? Object.keys(paymentSource)[0] : "paypal",
      },
    };
  } catch (error) {
    console.error("updatePaymentMethodAction error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update payment method",
    };
  }
}
