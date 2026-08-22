import slugify from "slugify";
import {
  createSupabaseAnonClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { registerSchema, RegisterInput } from "../schemas/onboarding.schema";

export interface Timezone {
  id: string;
  label?: string;
  name?: string;
  utc_offset?: string;
}
const invitationResults: {
  email: string;
  status: "added" | "invited" | "already_exists" | "failed";
  message: string;
}[] = [];

export async function registerTenant(payload: RegisterInput) {
  const validated = registerSchema.parse(payload);

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
    .eq("code", "F-15e70eec-7094-403f-b70e-8126fd7c062a")
    .single();

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

  const { data: auth, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name,
      },
    },
  });

  if (authError || !auth.user) {
    throw new Error(
      authError?.message || "Failed to create authentication user.",
    );
  }

  const userId = auth.user.id;

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

    if (error || !data?.[0]) {
      throw new Error(error?.message || "Tenant provisioning failed.");
    }

    const provisioned = data[0];

    if (invite_users?.length) {
      for (const invite of invite_users) {
        const inviteEmail = invite.email?.trim().toLowerCase();

        if (!inviteEmail) continue;

        try {
          const { data: existingUser, error: userLookupError } =
            await adminSupabase
              .from("users")
              .select("id, email")
              .eq("email", inviteEmail)
              .maybeSingle();

          if (userLookupError) {
            console.error(
              `[Onboarding] Failed to find user ${inviteEmail}:`,
              userLookupError.message,
            );

            invitationResults.push({
              email: inviteEmail,
              status: "failed",
              message: "Unable to check the user.",
            });

            continue;
          }

          if (existingUser) {
            const { data: existingMembership, error: membershipLookupError } =
              await adminSupabase
                .from("memberships")
                .select("id")
                .eq("tenant_id", provisioned.tenant_id)
                .eq("user_id", existingUser.id)
                .maybeSingle();

            if (membershipLookupError) {
              console.error(
                `[Onboarding] Failed to check membership for ${inviteEmail}:`,
                membershipLookupError.message,
              );

              invitationResults.push({
                email: inviteEmail,
                status: "failed",
                message: "Unable to check organization membership.",
              });

              continue;
            }

            if (existingMembership) {
              invitationResults.push({
                email: inviteEmail,
                status: "already_exists",
                message: "User is already a member of this organization.",
              });

              continue;
            }

            const { error: membershipError } = await adminSupabase
              .from("memberships")
              .insert({
                tenant_id: provisioned.tenant_id,
                user_id: existingUser.id,
                role: invite.role,
                status: "active",
                invited_by: userId,
              });

            if (membershipError) {
              console.error(
                `[Onboarding] Failed to add ${inviteEmail} to tenant:`,
                membershipError.message,
              );

              invitationResults.push({
                email: inviteEmail,
                status: "failed",
                message: "Unable to add user to the organization.",
              });

              continue;
            }
            const { error: emailError } =
              await adminSupabase.auth.resetPasswordForEmail(inviteEmail, {
                redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/reset-password`,
              });

            if (emailError) {
              console.error(
                `[Onboarding] Failed to send notification email to ${inviteEmail}:`,
                emailError.message,
              );

              invitationResults.push({
                email: inviteEmail,
                status: "added",
                message:
                  "User was added to the organization, but the email could not be sent.",
              });

              continue;
            }

            invitationResults.push({
              email: inviteEmail,
              status: "added",
              message: "User was added successfully and an email was sent.",
            });

            continue;
          }

          const { data: inviteData, error: inviteError } =
            await adminSupabase.auth.admin.inviteUserByEmail(inviteEmail, {
              redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/reset-password`,
              data: {
                tenant_id: provisioned.tenant_id,
                role: invite.role,
              },
            });

          if (inviteError || !inviteData.user) {
            console.error(
              `[Onboarding] Failed to invite ${inviteEmail}:`,
              inviteError?.message,
            );

            invitationResults.push({
              email: inviteEmail,
              status: "failed",
              message: inviteError?.message || "Unable to send the invitation.",
            });

            continue;
          }

          const invitedUser = inviteData.user;

          const { error: userError } = await adminSupabase.from("users").upsert(
            {
              id: invitedUser.id,
              email: inviteEmail,
              full_name: "",
              avatar_url: null,
            },
            {
              onConflict: "id",
            },
          );

          if (userError) {
            console.error(
              `[Onboarding] Failed to create user ${inviteEmail}:`,
              userError.message,
            );

            await adminSupabase.auth.admin.deleteUser(invitedUser.id);

            invitationResults.push({
              email: inviteEmail,
              status: "failed",
              message: "Unable to create the invited user.",
            });

            continue;
          }

          const { error: membershipError } = await adminSupabase
            .from("memberships")
            .insert({
              tenant_id: provisioned.tenant_id,
              user_id: invitedUser.id,
              role: invite.role,
              status: "invited",
              invited_by: userId,
            });

          if (membershipError) {
            console.error(
              `[Onboarding] Failed to create membership for ${inviteEmail}:`,
              membershipError.message,
            );

            await adminSupabase.from("users").delete().eq("id", invitedUser.id);

            await adminSupabase.auth.admin.deleteUser(invitedUser.id);

            invitationResults.push({
              email: inviteEmail,
              status: "failed",
              message: "Unable to add the invited user to the organization.",
            });

            continue;
          }

          invitationResults.push({
            email: inviteEmail,
            status: "invited",
            message: "Invitation sent successfully.",
          });
        } catch (error) {
          console.error(
            `[Onboarding] Unexpected invitation error for ${inviteEmail}:`,
            error,
          );

          invitationResults.push({
            email: inviteEmail,
            status: "failed",
            message: "Unable to process this invitation.",
          });
        }
      }
    }

    return {
      success: true,
      message: "Registration completed successfully.",
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
    const { data, error } = await supabase.from("timezones").select("*");

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
