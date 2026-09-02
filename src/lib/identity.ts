import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/features/tenancy/services/tenant-resolver";
import { ShellIdentity } from "@/types/shell-identity";

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

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError) {
    console.error("[identity] claims lookup failed:", claimsError.message);
    return null;
  }

  const tenantId = claimsData?.claims?.tenant_id as string | undefined;
  const tenantRole = claimsData?.claims?.tenant_role as string | undefined;
  const sessionTenantSlug = claimsData?.claims?.tenant_slug as
    string | undefined;

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
    .select("id, name")
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
  const seatLimit = subscription?.seats ?? 0;
  const seatsUsed = memberCount ?? 0;

  const planSummary =
    seatLimit > 0
      ? `${planName} plan · ${seatsUsed} of ${seatLimit} seats`
      : `${planName} plan · ${seatsUsed} seats`;

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
      role: tenantRole ?? "User",
    },
  };
}
