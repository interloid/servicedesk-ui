// import type { SupabaseClient } from "@supabase/supabase-js";

// import { TIMEZONES } from "@/features/auth/lib/timezones";
// import type { RegisterValues } from "@/features/auth/schemas/register";
// import { AuthError } from "@/features/auth/services/auth.service";
// import type { RegisteredOrg } from "@/features/auth/types";
// import { SLA_TARGETS } from "@/features/onboarding/lib/onboarding-data";
// import { createSupabaseAdminClient } from "@/lib/supabase/admin";
// import { createSupabaseServerClient } from "@/lib/supabase/server";

// /**
//  * Registration: create the account and provision its organization.
//  *
//  * Two clients, on purpose, and the split is the whole design:
//  *
//  *  • `signUp` goes through the ANON cookie client, so the new user ends up genuinely signed
//  *    in — session cookies are written and they land on the app authenticated.
//  *  • Every table write goes through the ADMIN client, because RLS makes them impossible
//  *    otherwise. `tenants_insert`, `subscriptions_insert`, `business_hours_insert` and
//  *    `sla_insert` all require a `tenant_role` JWT claim, and the hook that sets that claim
//  *    reads `memberships` — which has no row yet. Nothing can satisfy them on the first write.
//  *
//  * NOT a transaction. Postgres can't span one across six REST calls, so a failure partway
//  * through is undone by hand in `rollback()` below rather than left as orphaned rows.
//  */

// /** `plans.code` is an opaque billing id, so the free plan is found by price, not by code. */
// type Plan = { id: string; seat_limit: number };

// export async function register(values: RegisterValues): Promise<RegisteredOrg> {
//   const admin = createSupabaseAdminClient();
//   const supabase = await createSupabaseServerClient();

//   const slug = values.portalSlug ? values.portalSlug : slugify(values.organizationName);

//   if (!slug) {
//     throw new AuthError("Enter a portal address for your organization.");
//   }

//   // ── Pre-flight: everything that can be known before an account exists ────────────────
//   //
//   // Ordered deliberately. Each check below is cheap and reversible; `signUp` is neither, so
//   // it happens only once nothing else can reject the request. This is what keeps the common
//   // failures — taken address, duplicate email — from stranding an auth user.
//   await assertEmailAvailable(admin, values.email);
//   await assertSlugAvailable(admin, slug);

//   const plan = await findFreePlan(admin);
//   const timezoneRowId = await resolveTimezone(admin, values.timezoneId);

//   // ── Create the account ──────────────────────────────────────────────────────────────
//   const { data: auth, error: signUpError } = await supabase.auth.signUp({
//     email: values.email,
//     password: values.password,
//     options: { data: { full_name: values.fullName } },
//   });

//   if (signUpError) {
//     throw new AuthError(signUpError.message, { status: signUpError.status ?? 400 });
//   }

//   if (!auth.user) {
//     throw new AuthError("Unable to create your account. Try again.");
//   }

//   const userId = auth.user.id;

//   // No session means the project has "Confirm email" enabled, so the account exists but is
//   // not signed in and no cookies were set. Note this is a REMOTE project setting: the
//   // `enable_confirmations = false` in supabase/config.toml applies to a local
//   // `supabase start` stack only, so the two environments genuinely differ here.
//   const requiresEmailConfirmation = !auth.session;

//   let tenantId: string | null = null;

//   try {
//     // ── Provision the organization ────────────────────────────────────────────────────
//     const tenant = await insertTenant(admin, {
//       name: values.organizationName,
//       slug,
//       planId: plan.id,
//     });

//     tenantId = tenant.id;

//     // Before the membership: `memberships.user_id` references `public.users`, not
//     // `auth.users`, so the profile row has to exist first or the FK rejects it.
//     await insertProfile(admin, { userId, email: values.email, fullName: values.fullName });

//     // `tenant_admin`, NOT `owner` — `public.membership_role` has no `owner` value, so that
//     // insert would fail on the enum.
//     await insertOwnerMembership(admin, { tenantId: tenant.id, userId });

//     await insertFreeSubscription(admin, { tenantId: tenant.id, plan });

//     const businessHoursId = await insertBusinessHours(admin, {
//       tenantId: tenant.id,
//       timezoneRowId,
//       workingDays: values.workingDays,
//       dayStart: values.dayStart,
//       dayEnd: values.dayEnd,
//     });

//     await insertDefaultSlaPolicies(admin, { tenantId: tenant.id, businessHoursId });

//     // Only worth doing when a session exists. The token `signUp` minted predates the
//     // membership row, so its `tenant_id` and `tenant_role` claims are both null and every RLS
//     // policy would reject this user; refreshing re-runs `custom_access_token_hook` and stamps
//     // the real claims in. With confirmations on there is no session to refresh — the claims
//     // get set when they confirm and sign in, which is after the membership exists anyway.
//     if (!requiresEmailConfirmation) {
//       const { error: refreshError } = await supabase.auth.refreshSession();

//       if (refreshError) {
//         // The org exists and is correct; only the token is stale. Signing in again fixes it,
//         // so this must not roll back a good registration.
//         console.warn("[auth] session refresh after register failed:", refreshError.message);
//       }
//     }

//     return {
//       user: { id: userId, email: values.email, fullName: values.fullName },
//       tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
//       businessHoursId,
//       plan: "Free",
//       // Collected and validated, but nothing was sent — see registerSchema.inviteUsers.
//       invitesSkipped: values.inviteUsers.length,
//       requiresEmailConfirmation,
//     };
//   } catch (error) {
//     // A half-provisioned org is worse than none: the user would own a tenant they can't
//     // access, and their email would be taken on retry. Undo it.
//     await rollback(admin, { userId, tenantId });
//     throw error;
//   }
// }

// /**
//  * Undo a partial provisioning.
//  *
//  * Deleting the tenant is enough for `memberships`, `subscriptions`, `business_hours`,
//  * `sla_policies` and `sla_policy_targets` — every one of them declares
//  * `tenant_id ... on delete cascade`. Deleting
//  * the auth user takes `public.users` with it, via that table's own cascade from
//  * `auth.users(id)`.
//  *
//  * Best-effort by necessity: this runs while something is already failing, so each step is
//  * isolated and logged rather than allowed to mask the original error.
//  */
// async function rollback(
//   admin: SupabaseClient,
//   { userId, tenantId }: { userId: string; tenantId: string | null },
// ) {
//   if (tenantId) {
//     const { error } = await admin.from("tenants").delete().eq("id", tenantId);
//     if (error) {
//       console.error(`[auth] rollback: tenant ${tenantId} not removed: ${error.message}`);
//     }
//   }

//   const { error } = await admin.auth.admin.deleteUser(userId);
//   if (error) {
//     console.error(`[auth] rollback: auth user ${userId} not removed: ${error.message}`);
//   }
// }

// /**
//  * Reject a duplicate email before `signUp` does.
//  *
//  * Runs on the admin client so it actually reads rows — the same query on the anon client
//  * returns nothing whatever the truth, because `users_select` is `TO authenticated` and this
//  * caller isn't. A check that always passes is worse than none, since it reads as one that
//  * works.
//  */
// async function assertEmailAvailable(admin: SupabaseClient, email: string) {
//   const { data, error } = await admin
//     .from("users")
//     .select("id")
//     .eq("email", email)
//     .maybeSingle<{ id: string }>();

//   if (error) {
//     throw new AuthError(`Couldn't verify that email: ${error.message}`, { status: 500 });
//   }

//   if (data) {
//     throw new AuthError("That email is already registered. Try signing in instead.");
//   }
// }

// async function assertSlugAvailable(admin: SupabaseClient, slug: string) {
//   const { data, error } = await admin
//     .from("tenants")
//     .select("id")
//     .eq("slug", slug)
//     .maybeSingle<{ id: string }>();

//   if (error) {
//     throw new AuthError(`Couldn't verify that portal address: ${error.message}`, { status: 500 });
//   }

//   if (data) {
//     throw new AuthError(`That portal address is taken. Try ${slug}-support.`);
//   }
// }

// /**
//  * The plan every new org starts on: the cheapest active one.
//  *
//  * Chosen by price rather than by `code`, because the seeded free plan's code is an opaque
//  * billing identifier (`F-15e70eec-…`) that would have to be duplicated here and would break
//  * silently the moment billing re-issues it.
//  */
// async function findFreePlan(admin: SupabaseClient): Promise<Plan> {
//   const { data, error } = await admin
//     .from("plans")
//     .select("id, seat_limit")
//     .eq("is_active", true)
//     .order("price_month", { ascending: true })
//     .order("sort_order", { ascending: true })
//     .limit(1)
//     .maybeSingle<Plan>();

//   if (error || !data) {
//     throw new AuthError("No plan is available to sign up on. Contact support.", { status: 500 });
//   }

//   return data;
// }

// /**
//  * Design timezone id ("ist") → `public.timezones.id`.
//  *
//  * Two hops, because the Select binds the design's own short ids while the database keys off
//  * IANA names. `TIMEZONES` carries the mapping between them.
//  */
// async function resolveTimezone(admin: SupabaseClient, timezoneId: string): Promise<string> {
//   const iana = TIMEZONES.find((zone) => zone.id === timezoneId)?.iana;

//   if (!iana) {
//     throw new AuthError("Pick a timezone from the list.");
//   }

//   const { data, error } = await admin
//     .from("timezones")
//     .select("id")
//     .eq("code", iana)
//     .maybeSingle<{ id: string }>();

//   if (error) {
//     throw new AuthError(`Couldn't resolve that timezone: ${error.message}`, { status: 500 });
//   }

//   if (!data) {
//     // Reachable when the `timezones` seed is missing a zone the Select offers.
//     throw new AuthError(`Timezone ${iana} isn't set up yet. Pick another, or seed it.`, {
//       status: 500,
//     });
//   }

//   return data.id;
// }

// type TenantRow = { id: string; name: string; slug: string };

// async function insertTenant(
//   admin: SupabaseClient,
//   { name, slug, planId }: { name: string; slug: string; planId: string },
// ): Promise<TenantRow> {
//   const { data, error } = await admin
//     .from("tenants")
//     .insert({ name, slug, status: "active", plan_id: planId })
//     .select("id, name, slug")
//     .single<TenantRow>();

//   if (error || !data) {
//     // 23505 is a unique violation — the slug was claimed between the pre-flight check and
//     // here, which is the one race the pre-check can't close.
//     if (error?.code === "23505") {
//       throw new AuthError(`That portal address is taken. Try ${slug}-support.`);
//     }

//     throw new AuthError(error?.message ?? "Unable to create the organization.", { status: 500 });
//   }

//   return data;
// }

// async function insertProfile(
//   admin: SupabaseClient,
//   { userId, email, fullName }: { userId: string; email: string; fullName: string },
// ) {
//   const { error } = await admin
//     .from("users")
//     // Upsert, not insert: `signUp` on an email that already has an unconfirmed auth user
//     // returns that same id, and a plain insert would then collide on the primary key.
//     .upsert({ id: userId, email, full_name: fullName, avatar_url: null }, { onConflict: "id" });

//   if (error) {
//     throw new AuthError(`Unable to save your profile: ${error.message}`, { status: 500 });
//   }
// }

// async function insertOwnerMembership(
//   admin: SupabaseClient,
//   { tenantId, userId }: { tenantId: string; userId: string },
// ) {
//   const { error } = await admin.from("memberships").insert({
//     tenant_id: tenantId,
//     user_id: userId,
//     role: "tenant_admin",
//     status: "active",
//     joined_at: new Date().toISOString(),
//   });

//   if (error) {
//     throw new AuthError(`Unable to add you to the organization: ${error.message}`, { status: 500 });
//   }
// }

// async function insertFreeSubscription(
//   admin: SupabaseClient,
//   { tenantId, plan }: { tenantId: string; plan: Plan },
// ) {
//   const { error } = await admin.from("subscriptions").insert({
//     tenant_id: tenantId,
//     plan_id: plan.id,
//     // `paypal_subscription_id` is NOT NULL and unique, but a free plan never reaches PayPal.
//     // A derived sentinel keeps the column honest and stays unique per tenant.
//     paypal_subscription_id: `FREE-${tenantId}`,
//     status: "active",
//     // Free doesn't renew, so there's no real period end. Far-future stands in for "never".
//     current_period_end: "9999-12-31T23:59:59Z",
//     // From the plan itself rather than a literal, so the two can't drift.
//     seats: plan.seat_limit,
//   });

//   if (error) {
//     throw new AuthError(`Unable to start your subscription: ${error.message}`, { status: 500 });
//   }
// }

// async function insertBusinessHours(
//   admin: SupabaseClient,
//   {
//     tenantId,
//     timezoneRowId,
//     workingDays,
//     dayStart,
//     dayEnd,
//   }: {
//     tenantId: string;
//     timezoneRowId: string;
//     workingDays: string[];
//     dayStart: string;
//     dayEnd: string;
//   },
// ): Promise<string> {
//   const { data, error } = await admin
//     .from("business_hours")
//     .insert({
//       tenant_id: tenantId,
//       name: "Default Business Hours",
//       timezone_id: timezoneRowId,
//       schedule_json: { working_days: workingDays, day_start: dayStart, day_end: dayEnd },
//     })
//     .select("id")
//     .single<{ id: string }>();

//   if (error || !data) {
//     throw new AuthError(`Unable to save your business hours: ${error?.message}`, { status: 500 });
//   }

//   return data.id;
// }

// /**
//  * One default policy with four priority targets — the designed grain.
//  *
//  * Derived from `SLA_TARGETS` server-side rather than accepted from the client: onboarding
//  * step 2 is read-only in the design, so there is nothing for the user to have changed and
//  * trusting a submitted copy would only add a way to write targets the UI never showed.
//  */
// async function insertDefaultSlaPolicies(
//   admin: SupabaseClient,
//   { tenantId, businessHoursId }: { tenantId: string; businessHoursId: string },
// ) {
//   const { data: policy, error: policyError } = await admin
//     .from("sla_policies")
//     .insert({
//       tenant_id: tenantId,
//       business_hours_id: businessHoursId,
//       name: "Default SLA",
//       status: "active",
//       applies_to: "All customers",
//       is_default: true,
//       notify_before_breach: true,
//       escalate_on_breach: false,
//     })
//     .select("id")
//     .single<{ id: string }>();

//   if (policyError || !policy) {
//     throw new AuthError(`Unable to save your SLA policy: ${policyError?.message}`, {
//       status: 500,
//     });
//   }

//   const targets = SLA_TARGETS.map((target) => ({
//     tenant_id: tenantId,
//     policy_id: policy.id,
//     priority_scope: target.scope,
//     first_response_mins: target.firstReplyMins,
//     resolution_mins: target.resolveMins,
//     // Match the prose onboarding shows ("8 business hours", "2 business days").
//     first_response_business: /business/i.test(target.firstReply),
//     resolution_business: /business/i.test(target.resolve),
//   }));

//   const { error: targetsError } = await admin.from("sla_policy_targets").insert(targets);

//   if (targetsError) {
//     throw new AuthError(`Unable to save your SLA targets: ${targetsError.message}`, {
//       status: 500,
//     });
//   }
// }

// /**
//  * Organization name → portal address, for when the user leaves the slug blank.
//  *
//  * Local rather than the `slugify` package: the rule here is narrower than a general
//  * slugifier's, because it has to match `SLUG_PATTERN` in registerSchema exactly — lowercase
//  * alphanumerics with single inner hyphens and no leading or trailing one.
//  */
// function slugify(input: string): string {
//   return (
//     input
//       .normalize("NFKD")
//       // Strip the combining marks NFKD just split off, so "Ångström" reduces to "angstrom"
//       // rather than losing those letters to the non-alphanumeric pass below.
//       .replace(/[̀-ͯ]/g, "")
//       .toLowerCase()
//       .replace(/[^a-z0-9]+/g, "-")
//       .replace(/^-+|-+$/g, "")
//   );
// }
