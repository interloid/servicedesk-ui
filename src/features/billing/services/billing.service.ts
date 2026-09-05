import "server-only";

import { DbPlan, FormattedFeature, FormattedPlan } from "../types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  canManageTenantBilling,
  getTenantIdBySlug,
} from "@/features/tenancy/services/tenant-resolver";

function formatFeatureLabel(key: string): string {
  let label = key.replace(/_/g, " ");
  label = label
    .replace(/\bsla\b/gi, "SLA")
    .replace(/\bai\b/gi, "AI")
    .replace(/\bapi\b/gi, "API")
    .replace(/\bdb\b/gi, "DB");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function unlimitedOr(value: number | null | undefined): string {
  return value == null || value >= 999999 ? "Unlimited" : `${value}`;
}

export function formatPlan(plan: DbPlan): FormattedPlan {
  const rawFeatures =
    typeof plan.features_json === "string"
      ? JSON.parse(plan.features_json)
      : plan.features_json || {};

  const features: FormattedFeature[] = [];

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
  const seatLimit = plan.seat_limit;
  const storageMb = plan.storage_limit_mb ?? 0;

  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    price: `$${priceNum === 0 ? "0" : priceNum.toFixed(0)}`,
    priceValue: Number.isFinite(priceNum) ? priceNum : 0,
    priceSuffix: "/month",
    description:
      plan.description ||
      (plan.name === "Free"
        ? "For small teams getting started with help desk essentials."
        : plan.name === "Pro"
          ? "For growing teams that need SLA policies, shared views, and reporting."
          : "Advanced governance, AI automation, and scale for larger teams."),
    seatLimit,
    seatLimitText: unlimitedOr(seatLimit),
    ticketLimitText: unlimitedOr(plan.ticket_limit),
    storageLimitText: `${(storageMb / 1024).toFixed(storageMb > 0 && storageMb % 1024 !== 0 ? 1 : 0)} GB`,
    features,
  };
}

export async function getPlans(): Promise<FormattedPlan[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("plans")
    .select("*")
    .eq("is_active", true)
    .order("price_month", { ascending: true })
    .order("sort_order", { ascending: true });

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

  const payload: Record<string, string> = {
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

export type PlanChangeResult = {
  success: boolean;
  error?: string;
  subscriptionId?: string | null;
  approvalUrl?: string | null;
  // Set when the change was recorded but does not take effect until the paid
  // period ends, so the UI can say so instead of implying it already applied.
  scheduled?: boolean;
  effectiveAt?: string | null;
};

export async function changeTenantPlan(
  tenantSlug: string,
  newPlanCode: string,
  newPlanId?: string,
): Promise<PlanChangeResult> {
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

    const tenantId = await getTenantIdBySlug(tenantSlug);

    if (!tenantId) {
      return { success: false, error: "Tenant not found" };
    }

    const canManage = await canManageTenantBilling(user.id, tenantId);

    if (!canManage) {
      return {
        success: false,
        error:
          "Forbidden: you do not have billing permissions for this tenant.",
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

      let errorBody: { message?: string; error?: string } | null = null;

      try {
        errorBody = (await error.context?.json()) as {
          message?: string;
          error?: string;
        } | null;
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
      subscriptionId: data.subscriptionId ?? null,
      approvalUrl: data.approvalUrl ?? null,
      scheduled: data.scheduled ?? false,
      effectiveAt: data.effectiveAt ?? null,
    };
  } catch (error) {
    console.error("changeTenantPlan error:", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : "Something went wrong.",
    };
  }
}

export async function abortPlanSwitch(tenantSlug: string): Promise<{
  success: boolean;
  restored?: boolean;
  planName?: string;
  error?: string;
}> {
  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { success: false, error: "Unauthorized" };
    }

    const tenantId = await getTenantIdBySlug(tenantSlug);

    if (!tenantId) {
      return { success: false, error: "Tenant not found" };
    }

    const canManage = await canManageTenantBilling(user.id, tenantId);

    if (!canManage) {
      return {
        success: false,
        error:
          "Forbidden: you do not have billing permissions for this tenant.",
      };
    }

    const { data, error } = await supabase.functions.invoke("subscription", {
      body: {
        action: "abort",
        tenantSlug,
      },
    });

    if (error) {
      console.error("Abort subscription error:", error);

      let errorBody: { message?: string; error?: string } | null = null;

      try {
        errorBody = (await error.context?.json()) as {
          message?: string;
          error?: string;
        } | null;
      } catch {
        // Ignore response parsing error
      }

      return {
        success: false,
        error:
          errorBody?.message ??
          errorBody?.error ??
          error.message ??
          "Failed to restore your plan.",
      };
    }

    if (!data?.success) {
      return {
        success: false,
        error: data?.message ?? "Failed to restore your plan.",
      };
    }

    return {
      success: true,
      restored: data?.restored ?? false,
      planName: data?.planName ?? undefined,
    };
  } catch (error) {
    console.error("abortPlanSwitch error:", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : "Something went wrong.",
    };
  }
}

export async function activateTenantSubscription(
  tenantSlug: string,
  subscriptionId: string,
): Promise<{
  success: boolean;
  error?: string;
  planName?: string;
  scheduled?: boolean;
  effectiveAt?: string | null;
}> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized" };
  }

  if (!subscriptionId) {
    return { success: false, error: "Subscription ID is required." };
  }

  try {
    const { data, error } = await supabase.functions.invoke("subscription", {
      body: {
        action: "activate",
        tenantSlug,
        subscriptionId,
      },
    });

    if (error) {
      console.error("Subscription activation error:", error);

      let errorBody: { message?: string; error?: string } | null = null;

      try {
        errorBody = (await error.context?.json()) as {
          message?: string;
          error?: string;
        } | null;
      } catch {
        // Ignore response parsing error
      }

      return {
        success: false,
        error:
          errorBody?.message ??
          errorBody?.error ??
          error.message ??
          "Failed to activate subscription.",
      };
    }

    if (!data?.success) {
      return {
        success: false,
        error: data?.message ?? "Failed to activate subscription.",
      };
    }

    return {
      success: true,
      planName: data?.planName ?? undefined,
      scheduled: data?.scheduled ?? false,
      effectiveAt: data?.effectiveAt ?? null,
    };
  } catch (error) {
    console.error("activateTenantSubscription error:", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : "Something went wrong.",
    };
  }
}
