import "server-only";

import slugify from "slugify";
import {
  createSupabaseAnonClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  EMAIL_ALREADY_REGISTERED_MESSAGE,
  signUpWithPkce,
} from "@/lib/supabase/pkce";
import {
  addInvitedStaffMember,
  TeamError,
} from "@/features/team/services/team.service";
import type { TeamRole } from "@/features/team/types/team";
import { registerSchema, RegisterInput } from "../schemas/onboarding.schema";

// The invite payload uses TeamRole labels; the signup form sends DB values.
const ONBOARDING_ROLE_LABEL: Record<
  "agent" | "manager" | "billing_admin",
  TeamRole
> = {
  agent: "Agent",
  manager: "Manager",
  billing_admin: "Billing Admin",
};

export interface Timezone {
  id: string;
  /** IANA identifier, e.g. "Asia/Kolkata". */
  code?: string;
  label?: string;
  name?: string;
  utc_offset?: string;
}

export type InvitationResult = {
  email: string;
  status: "invited" | "already_exists" | "failed";
  message: string;
};

function invitationFailure(email: string, error: unknown): InvitationResult {
  if (!(error instanceof TeamError)) {
    console.error(
      `[Onboarding] Unexpected invitation error for ${email}:`,
      error,
    );
    return {
      email,
      status: "failed",
      message: "Unable to process this invitation.",
    };
  }

  switch (error.code) {
    // The membership stands; Resend invite on the team page retries.
    case "invite-email-failed":
      return { email, status: "invited", message: error.message };
    // The same address twice in the signup list.
    case "invite-already-sent":
      return {
        email,
        status: "already_exists",
        message: "This email is listed more than once.",
      };
    default:
      return { email, status: "failed", message: error.message };
  }
}

export async function registerTenant(payload: RegisterInput) {
  const validated = registerSchema.parse(payload);
  const invitationResults: InvitationResult[] = [];

  const {
    email,
    password,
    full_name,
    organization_name,
    portal_slug,
    timezone_id,
    working_days,
    day_start,
    day_end,
    sla,
    invite_users,
  } = validated;

  const supabase = await createSupabaseServerClient();
  const adminSupabase = createSupabaseAdminClient();

  const targetSlug =
    portal_slug ||
    slugify(organization_name, {
      lower: true,
      strict: true,
    });

  const { data: freePlan, error: planError } = await supabase
    .from("plans")
    .select("id")
    .eq("price_month", 0)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (planError || !freePlan) {
    throw new Error("Free tier plan configuration not found.");
  }

  const { data: timezone } = await supabase
    .from("timezones")
    .select("id")
    .eq("id", timezone_id)
    .single();

  if (!timezone) {
    throw new Error("Invalid timezone selected.");
  }

  const { userId, requiresEmailConfirmation } = await signUpWithPkce({
    email,
    password,
    userData: {
      full_name,
    },
    emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm`,
  });

  try {
    const { data, error } = await adminSupabase.rpc("provision_tenant", {
      p_user_id: userId,
      p_email: email,
      p_full_name: full_name,
      p_organization_name: organization_name,
      p_portal_slug: targetSlug,
      p_plan_id: freePlan.id,
      p_timezone_id: timezone_id,
      p_working_days: working_days,
      p_day_start: day_start,
      p_day_end: day_end,
      p_sla: sla,
    });

    // 23503 on users_id_fkey: the user id has no auth account behind it.
    // The identities check in signUpWithPkce should stop that first; this
    // keeps the raw constraint text off the signup form if it ever doesn't.
    if (error?.code === "23503") {
      console.error(
        "[Onboarding] provision_tenant FK violation:",
        error.message,
      );
      throw new Error(EMAIL_ALREADY_REGISTERED_MESSAGE);
    }

    if (error || !data?.[0]) {
      throw new Error(error?.message || "Tenant provisioning failed.");
    }

    const provisioned = data[0];

    // Same rules as the Team page: an `invited` membership only, and anyone
    // who already belongs to another workspace is refused.
    for (const invite of invite_users ?? []) {
      const inviteEmail = invite.email?.trim().toLowerCase();

      if (!inviteEmail) continue;

      try {
        await addInvitedStaffMember({
          tenantId: provisioned.tenant_id,
          tenantSlug: provisioned.tenant_slug,
          inviterId: userId,
          email: inviteEmail,
          role: ONBOARDING_ROLE_LABEL[invite.role],
        });

        invitationResults.push({
          email: inviteEmail,
          status: "invited",
          message: "Invitation sent successfully.",
        });
      } catch (error) {
        invitationResults.push(invitationFailure(inviteEmail, error));
      }
    }

    return {
      success: true,
      requiresEmailConfirmation,
      message: requiresEmailConfirmation
        ? "Registration pending email confirmation."
        : "Registration completed successfully.",
      data: {
        user: {
          id: userId,
          email,
          full_name,
        },
        tenant: {
          id: provisioned.tenant_id,
          name: provisioned.tenant_name,
          slug: provisioned.tenant_slug,
        },
        business_hours: {
          id: provisioned.business_hours_id,
        },
        plan: "Free",
        invitations: invitationResults,
      },
    };
  } catch (error) {
    await adminSupabase.auth.admin.deleteUser(userId);
    throw error;
  }
}

export async function getTimezones(): Promise<Timezone[]> {
  try {
    const supabase = createSupabaseAnonClient();
    const { data, error } = await supabase
      .from("timezones")
      .select("*")
      .order("display_name");

    if (error) {
      console.error("Error fetching timezones:", error.message);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("Unexpected error fetching timezones:", err);
    return [];
  }
}

export async function checkEmailTenant(
  email: string,
): Promise<{ exists: boolean }> {
  const cleanEmail = email.trim().toLowerCase();

  if (!cleanEmail) {
    return { exists: false };
  }

  const adminSupabase = createSupabaseAdminClient();

  const { data, error } = await adminSupabase
    .from("users")
    .select("id")
    .eq("email", cleanEmail)
    .maybeSingle();

  if (error) {
    console.error("[Onboarding] Email check failed:", error.message);

    throw new Error("Unable to verify email. Please try again.");
  }

  return {
    exists: Boolean(data),
  };
}

export async function checkSlugAvailability(
  slug: string,
): Promise<{ available: boolean; error?: string }> {
  try {
    const supabase = createSupabaseAdminClient();

    const { data, error } = await supabase
      .from("tenants")
      .select("id")
      .eq("slug", slug.toLowerCase().trim())
      .maybeSingle();

    if (error) {
      console.error("Slug check error:", error.message);

      return {
        available: true,
        error: error.message,
      };
    }

    return {
      available: !data,
    };
  } catch (error: unknown) {
    console.error("Server slug check failed:", error);

    return {
      available: true,
      error: error instanceof Error ? error.message : "Slug check failed",
    };
  }
}
