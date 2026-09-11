import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/features/tenancy/services/tenant-resolver";
import { ShellIdentity } from "@/types/shell-identity";
import { getTenantClaims } from "@/features/auth/claims";

export async function getShellIdentity(
  tenantSlug: string,
): Promise<ShellIdentity | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  const claims = await getTenantClaims(supabase);

  if (!claims) {
    return null;
  }

  const { tenantId, tenantRole, tenantSlug: sessionTenantSlug } = claims;

  if (!tenantId || !sessionTenantSlug) {
    return null;
  }

  if (sessionTenantSlug !== tenantSlug) {
    return null;
  }

  const tenant = await getTenantContext();

  if (tenant && tenant.id !== tenantId) {
    return null;
  }

  const { data: tenantData, error: tenantError } = await supabase
    .from("tenants")
    .select("id, name, plan_id")
    .eq("id", tenantId)
    .single();

  if (tenantError || !tenantData) {
    console.error(
      `[identity] tenant ${tenantId} lookup failed:`,
      tenantError?.message ?? "not found",
    );
    return null;
  }

  const { data: subscription, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select(
      `
        id,
        status,
        plan_id,
        seats
      `,
    )
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .maybeSingle();

  if (subscriptionError) {
    console.error(
      "[identity] subscription lookup failed:",
      subscriptionError.message,
    );
    return null;
  }

  let plan = null;

  if (subscription?.plan_id) {
    const { data: planData, error: planError } = await supabase
      .from("plans")
      .select("id, name, seat_limit")
      .eq("id", subscription.plan_id)
      .single();

    if (planError) {
      console.error("[identity] plan lookup failed:", planError.message);
    }

    plan = planData ?? null;
  }

  // No active subscription row yet (upgrade awaiting approval, agreement
  // between cancel and replacement, trialing tenant): fall back to the plan
  // assigned on the tenant row so the shell never advertises "Free plan" for
  // a tenant that actually owns a paid plan.
  if (!plan && tenantData?.plan_id) {
    const { data: tenantPlan, error: tenantPlanError } = await supabase
      .from("plans")
      .select("id, name, seat_limit")
      .eq("id", tenantData.plan_id)
      .single();

    if (tenantPlanError) {
      console.error(
        "[identity] tenant plan lookup failed:",
        tenantPlanError.message,
      );
    } else if (tenantPlan) {
      plan = tenantPlan;
    }
  }

  const { count: memberCount, error: memberError } = await supabase
    .from("memberships")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("tenant_id", tenantId)
    .eq("status", "active");

  if (memberError) {
    console.error("[identity] member count failed:", memberError.message);
  }

  const planName = plan?.name ?? "Free";
  const seatLimit = subscription?.seats ?? plan?.seat_limit ?? 0;
  const seatsUsed = memberCount ?? 0;

  const planSummary =
    seatLimit > 0
      ? `${planName} plan · ${seatsUsed} of ${seatLimit} agent seats`
      : `${planName} plan · ${seatsUsed} agent seats`;

  const { data: profile } = await supabase
    .from("users")
    .select("full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  const name =
    profile?.full_name ?? user.user_metadata?.full_name ?? user.email ?? "User";

  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part.charAt(0).toUpperCase())
    .join("");

  return {
    org: {
      id: tenantData.id,
      name: tenantData.name,
      initial: tenantData.name.charAt(0).toUpperCase(),
      planSummary,
    },

    user: {
      id: user.id,
      name,
      email: user.email ?? "",
      initials,
      avatarUrl: profile?.avatar_url ?? "",
      role: tenantRole ?? "customer",
    },
  };
}
