import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/features/tenancy/services/tenant-resolver";

export type ShellIdentity = {
  org: {
    id: string;
    name: string;
    initial: string;
    planSummary: string;
  };

  user: {
    id: string;
    name: string;
    email: string;
    initials: string;
    role: string;
  };
};

export async function getShellIdentity(): Promise<ShellIdentity | null> {
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
    throw claimsError;
  }

  const tenantId = claimsData?.claims?.tenant_id as string | undefined;
  const tenantRole = claimsData?.claims?.tenant_role as string | undefined;

  if (!tenantId) {
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

  if (tenantError) {
    throw tenantError;
  }

  const { data: subscription, error: subscriptionError } = await supabase
    .from("subscriptions")
    .select(
      `
      id,
      status,
      plan_id,
      plans (
        id,
        name,
        seat_limit
      )
    `,
    )
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .maybeSingle();

  if (subscriptionError) {
    throw subscriptionError;
  }

  // Count current members
  const { count: memberCount, error: memberError } = await supabase
    .from("memberships")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("tenant_id", tenantId);

  if (memberError) {
    throw memberError;
  }

  const plan =
    (
      subscription?.plans as unknown as {
        id: string;
        name: string;
        seat_limit: number;
      }[]
    )?.[0] ?? null;

  const planName = plan?.name ?? "Free";
  const seatLimit = plan?.seat_limit ?? 0;
  const seatsUsed = memberCount ?? 0;

  const planSummary =
    seatLimit > 0
      ? `${planName} plan · ${seatsUsed} of ${seatLimit} seats`
      : `${planName} plan · ${seatsUsed} seats`;

  const name = user.user_metadata?.full_name ?? user.email ?? "User";

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
      role: tenantRole ?? "User",
    },
  };
}
