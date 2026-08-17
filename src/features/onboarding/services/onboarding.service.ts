import slugify from "slugify";
import { createSupabaseAnonClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { registerSchema, RegisterInput } from "../schemas/onboarding.schema";

export interface Timezone {
  id: string;
  label?: string;
  name?: string;
  utc_offset?: string;
}

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

  const { data: existingUser } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingUser) {
    throw new Error("Email address is already registered.");
  }

  const targetSlug =
    portal_slug ||
    slugify(organization_name, {
      lower: true,
      strict: true,
    });

  const { data: existingTenant } = await adminSupabase
    .from("tenants")
    .select("id")
    .eq("slug", targetSlug)
    .maybeSingle();

  if (existingTenant) {
    throw new Error("Portal address is already taken.");
  }

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

  const { data: tenant, error: tenantError } = await adminSupabase
    .from("tenants")
    .insert({
      name: organization_name,
      slug: targetSlug,
      status: "active",
      plan_id: freePlan.id,
    })
    .select()
    .single();

  if (tenantError || !tenant) {
    throw new Error(
      tenantError?.message || "Failed to create organization record.",
    );
  }

  const { error: subscriptionError } = await adminSupabase
    .from("subscriptions")
    .insert({
      tenant_id: tenant.id,
      plan_id: freePlan.id,
      paypal_subscription_id: `FREE-${tenant.id}`,
      status: "active",
      current_period_end: "9999-12-31T23:59:59Z",
      seats: 2,
    });

  if (subscriptionError) {
    throw new Error(`Subscription setup failed: ${subscriptionError.message}`);
  }

  const { error: userError } = await adminSupabase.from("users").insert({
    id: userId,
    email,
    full_name,
    avatar_url: null,
  });

  if (userError) {
    throw new Error(`User profile creation failed: ${userError.message}`);
  }

  const { error: membershipError } = await adminSupabase
    .from("memberships")
    .insert({
      tenant_id: tenant.id,
      user_id: userId,
      role: "tenant_admin",
      status: "active",
    });

  if (membershipError) {
    throw new Error(
      `Membership provisioning failed: ${membershipError.message}`,
    );
  }

  const { data: businessHours, error: businessError } = await adminSupabase
    .from("business_hours")
    .insert({
      tenant_id: tenant.id,
      name: "Default Business Hours",
      timezone_id,
      schedule_json: {
        working_days,
        day_start,
        day_end,
      },
    })
    .select()
    .single();

  if (businessError || !businessHours) {
    throw new Error(
      businessError?.message || "Business hours configuration failed.",
    );
  }

 
  const { data: slaPolicy, error: slaPolicyError } = await adminSupabase
    .from("sla_policies")
    .insert({
      tenant_id: tenant.id,
      business_hours_id: businessHours.id,
      name: "Default SLA",
      is_default: true,
      status: "active",
      applies_to: "All customers",
      notify_before_breach: true,
      escalate_on_breach: false,
    })
    .select()
    .single();

  if (slaPolicyError || !slaPolicy) {
    throw new Error(`SLA Policy creation failed: ${slaPolicyError?.message}`);
  }

  const slaTargets = sla.map((rule: any) => ({
    tenant_id: tenant.id,
    policy_id: slaPolicy.id, // Correct foreign key column
    priority_scope: rule.priority.toLowerCase(), // e.g. 'urgent', 'high', 'normal', 'low'
    first_response_mins: rule.first_response_mins,
    resolution_mins: rule.resolution_mins,
    first_response_business: false,
    resolution_business: false,
  }));

  // 3. Insert into sla_policy_targets table
  const { error: slaTargetsError } = await adminSupabase
    .from("sla_policy_targets")
    .insert(slaTargets);

  if (slaTargetsError) {
    throw new Error(`SLA Targets setup failed: ${slaTargetsError.message}`);
  }

  // 13. Process Team Invites (Safe loop with error resilience)
  if (invite_users && invite_users.length > 0) {
    for (const invite of invite_users) {
      if (!invite.email?.trim()) continue;

      const { data: inviteData, error: inviteError } =
        await adminSupabase.auth.admin.inviteUserByEmail(invite.email, {
          data: {
            tenant_id: tenant.id,
            role: invite.role,
          },
        });

      if (inviteError || !inviteData.user) {
        console.error(
          `[Onboarding] Failed to invite ${invite.email}:`,
          inviteError?.message,
        );
        continue;
      }

      const invitedUser = inviteData.user;

      // Upsert user entry
      await adminSupabase.from("users").upsert({
        id: invitedUser.id,
        email: invite.email,
        full_name: "",
        avatar_url: null,
      });

      // Create membership record as 'invited'
      await adminSupabase.from("memberships").insert({
        tenant_id: tenant.id,
        user_id: invitedUser.id,
        role: invite.role,
        status: "invited",
        invited_by: userId,
      });
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
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
      },
      business_hours: {
        id: businessHours.id,
      },
      plan: "Free",
    },
  };
}


export async function getTimezones(): Promise<Timezone[]> {
  try {
    const supabase = createSupabaseAnonClient();
    // Querying all columns prevents 'column does not exist' errors
    const { data, error } = await supabase.from("timezones").select("*");

    if (error) {
      console.error("Error fetching timezones:", error.message);
      return []; // Return empty array on error to prevent client crashes
    }

    return data || [];
  } catch (err) {
    console.error("Unexpected error fetching timezones:", err);
    return [];
  }
}

export async function checkEmailTenant(
  email: string,
): Promise<{ exists: boolean; tenant?: any }> {
  const cleanEmail = email.trim().toLowerCase();
  const supabase = await createSupabaseAdminClient();

  if (!cleanEmail) {
    return { exists: false };
  }

  // Exact email check on the tenants table
  const { data, error } = await supabase
    .from("users")
    .select("email")
    .eq("email", cleanEmail)
    .maybeSingle();

  if (error || !data) {
    return { exists: false };
  }

  return {
    exists: true,
    tenant: data,
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
