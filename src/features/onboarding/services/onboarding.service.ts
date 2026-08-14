import slugify from "slugify";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { registerSchema, RegisterInput } from "../schemas/onboarding.schema";

export interface Timezone {
  id: string;
  // Adjust these field names if your table uses 'label', 'timezone', or 'iana_name'
  label?: string; 
  name?: string;
  utc_offset?: string;
}

export async function registerTenant(payload: RegisterInput) {
  // 1. Validate Payload
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

  // 2. Check for existing user
  const { data: existingUser } = await supabase
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingUser) {
    throw new Error("Email address is already registered.");
  }

  // 3. Compute Slug and Check Availability
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

  // 4. Fetch Default Free Plan
  const { data: freePlan, error: planError } = await supabase
    .from("plans")
    .select("id")
    .eq("code", "F-15e70eec-7094-403f-b70e-8126fd7c062a")
    .single();

  if (planError || !freePlan) {
    throw new Error("Free tier plan configuration not found.");
  }

  // 5. Verify Timezone
  const { data: timezone } = await supabase
    .from("timezones")
    .select("id")
    .eq("id", timezone_id)
    .single();

  if (!timezone) {
    throw new Error("Invalid timezone selected.");
  }

  // 6. Create Supabase Auth User
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
    throw new Error(authError?.message || "Failed to create authentication user.");
  }

  const userId = auth.user.id;

  // 7. Insert Tenant
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
    throw new Error(tenantError?.message || "Failed to create organization record.");
  }

  // 8. Create Free Subscription
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

  // 9. Create User Profile
  const { error: userError } = await adminSupabase.from("users").insert({
    id: userId,
    email,
    full_name,
    avatar_url: null,
  });

  if (userError) {
    throw new Error(`User profile creation failed: ${userError.message}`);
  }

  // 10. Add Owner Membership
  const { error: membershipError } = await adminSupabase.from("memberships").insert({
    tenant_id: tenant.id,
    user_id: userId,
    role: "tenant_admin",
    status: "active",
  });

  if (membershipError) {
    throw new Error(`Membership provisioning failed: ${membershipError.message}`);
  }

  // 11. Configure Business Hours
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
    throw new Error(businessError?.message || "Business hours configuration failed.");
  }

  // 12. Create SLA Policies
 // 1. Create the parent SLA Policy
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

// 2. Map targets using the verified schema keys
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
        console.error(`[Onboarding] Failed to invite ${invite.email}:`, inviteError?.message);
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
    const supabase = await createSupabaseServerClient();

    // Querying all columns prevents 'column does not exist' errors
    const { data, error } = await supabase
      .from("timezones")
      .select("*");

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