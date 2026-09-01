import { createSupabaseClient } from "@/lib/supabase/client";
import { DbPlan, FormattedFeature, FormattedPlan } from "../types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  getTenantIdBySlug,
  getTenantSlugById,
} from "@/features/tenancy/services/tenant-resolver";

function formatFeatureLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatPlan(plan: DbPlan): FormattedPlan {
  const rawFeatures =
    typeof plan.features_json === "string"
      ? JSON.parse(plan.features_json)
      : plan.features_json || {};

  const features: FormattedFeature[] = [];

  features.push({
    label: "Agent seats",
    value: plan.seat_limit === 999999 ? "Unlimited" : `${plan.seat_limit}`,
  });

  features.push({
    label: "Ticket limit",
    value: plan.ticket_limit === 999999 ? "Unlimited" : `${plan.ticket_limit}`,
  });

  features.push({
    label: "Storage limit",
    value: `${plan.storage_limit_mb / 1024} GB`,
  });

  Object.entries(rawFeatures).forEach(([key, val]) => {
    if (typeof val === "boolean") {
      if (val) {
        features.push({
          label: formatFeatureLabel(key),
          value: true,
        });
      }
    } else if (typeof val === "number") {
      features.push({
        label: formatFeatureLabel(key),
        value: val === -1 ? "Unlimited" : `${val}`,
      });
    } else if (typeof val === "string") {
      features.push({
        label: formatFeatureLabel(key),
        value: val,
      });
    }
  });

  const priceNum = parseFloat(plan.price_month);

  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    price: `$${priceNum === 0 ? "0" : priceNum.toFixed(0)}`,
    priceSuffix: priceNum === 0 ? "forever" : "/ month",
    description:
      plan.description ||
      (plan.name === "Free"
        ? "For small teams testing the waters."
        : plan.name === "Pro"
          ? "SLA targets, saved views, and reporting."
          : "Governance, audit, and priority response."),
    features,
  };
}

export async function getPlans(): Promise<FormattedPlan[]> {
  const supabase = await createSupabaseClient();

  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("price_month", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data.map((plan) => formatPlan(plan as DbPlan));
}

export async function getTenantPlan(tenantSlug: string): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const sanitizedSlug = (tenantSlug || "").trim();
  const tenantId = await getTenantIdBySlug(sanitizedSlug);
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("plan_id")
    .eq("id", tenantId)
    .single();
  if (tenantError || !tenant?.plan_id) return "";

  const { data: plan } = await supabase
    .from("plans")
    .select("code, id,name")
    .eq("id", tenant.plan_id)
    .single();
  return plan?.code || tenant.plan_id;
}

export async function updateTenantPlan(
  tenantSlug: string,
  newPlanCode: string,
  newPlanId?: string,
) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    throw new Error("Unauthorized");
  }

  const payload: Record<string, any> = {
    plan_id: newPlanCode,
    updated_at: new Date().toISOString(),
  };

  if (newPlanId) {
    payload.plan_id = newPlanId;
  }

  const { data, error } = await supabase
    .from("tenants")
    .update(payload)
    .eq("slug", tenantSlug)
    .select()
    .single();

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  return data;
}

export async function changeTenantPlan(
  tenantSlug: string,
  newPlanCode: string,
  newPlanId?: string,
) {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        error: "Unauthorized",
      };
    }

    const { data, error } = await supabase.functions.invoke("subscription", {
      body: {
        tenantSlug,
        planId: newPlanId ?? newPlanCode,
      },
    });

    if (error) {
      console.error("Create subscription error:", error);

      let errorBody: any = null;

      try {
        errorBody = await error.context?.json();
      } catch {
        // Ignore response parsing error
      }

      console.error("Edge Function response:", errorBody);

      return {
        success: false,
        error:
          errorBody?.message ??
          errorBody?.error ??
          error.message ??
          "Failed to create subscription.",
      };
    }

    if (!data?.success) {
      return {
        success: false,
        error: data?.message ?? "Failed to create subscription.",
      };
    }

    return {
      success: true,
      subscriptionId: data.subscriptionId,
      approvalUrl: data.approvalUrl,
    };
  } catch (error) {
    console.error("changeTenantPlan error:", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : "Something went wrong.",
    };
  }
}

export async function activateTenantSubscription(tenantSlug: string): Promise<{
  success: boolean;
  error?: string;
  planName?: string;
}> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized" };
  }

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id, plan_id")
    .eq("slug", tenantSlug)
    .single();

  if (tenantError || !tenant) {
    return { success: false, error: "Tenant not found" };
  }

  const { data: sub, error: subError } = await supabase
    .from("subscriptions")
    .select("id, plan_id, status, plans(name)")
    .eq("tenant_id", tenant.id)
    .in("status", ["trialing", "active"])
    .order("created_at", { ascending: false })
    .maybeSingle();

  if (subError || !sub) {
    return { success: false, error: "No active subscription found" };
  }

  if (!sub.plan_id) {
    return { success: false, error: "Subscription has no plan assigned" };
  }

  if (sub.plan_id !== tenant.plan_id) {
    const { error: updateError } = await supabase
      .from("tenants")
      .update({ plan_id: sub.plan_id, updated_at: new Date().toISOString() })
      .eq("id", tenant.id);

    if (updateError) {
      return {
        success: false,
        error: `Failed to update plan: ${updateError.message}`,
      };
    }
  }

  return {
    success: true,
    planName: (sub.plans as any)?.name ?? undefined,
  };
}
