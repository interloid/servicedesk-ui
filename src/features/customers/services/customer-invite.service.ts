import "server-only";

import { requestOrigin } from "@/features/auth/services/auth.service";
import type { InviteCustomerValues } from "@/features/customers/schemas/customers";
import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";
import { getActorOrNull } from "@/features/team/services/team.service";
import { enqueueEmail } from "@/lib/email/email-queue";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type CustomerInviteFailure =
  "action-not-allowed" | "conflict" | "unknown";

export class CustomerInviteError extends Error {
  readonly code: CustomerInviteFailure;

  constructor(message: string, code: CustomerInviteFailure) {
    super(message);
    this.name = "CustomerInviteError";
    this.code = code;
  }
}

/**
 * A starting name from the address when none was given: "jane.cooper@x.com"
 * becomes "Jane Cooper". The same rule portal_link_user uses for a customer
 * who signs themselves up, so both kinds of new customer look alike; the
 * customer can change it in the portal.
 */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local.replace(/[._-]+/g, " ").trim();

  if (!words) {
    return "Customer";
  }

  return words.replace(
    /\S+/g,
    (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
  );
}

function fail(message: string, error: { message?: string } | null) {
  if (error) {
    console.error(`[customers] ${message}`, error.message ?? error);
  }

  return new CustomerInviteError(message, "unknown");
}

/**
 * Invite someone to the workspace's support portal, the same way a team member
 * is invited: an account, a `memberships` row (role `customer`, status
 * `invited`) and an email. They also get a customer record, so they show on
 * the Customers list straight away.
 *
 * The email is the portal's own sign-in link, marked as an invitation. Clicking
 * it runs the normal portal sign-in: portal_link_user claims the customer
 * record by email and turns the invited membership active. Customers never
 * hold a seat, so the seat limit does not apply.
 *
 * Inviting someone whose invitation is still pending sends it again, so this
 * doubles as "Resend invite".
 */
export async function inviteCustomer(
  values: InviteCustomerValues,
): Promise<void> {
  const actor = await getActorOrNull();

  if (!actor || actor.role !== "Tenant Admin") {
    throw new CustomerInviteError(
      "Only a Tenant Admin can invite customers.",
      "action-not-allowed",
    );
  }

  const email = values.email.trim().toLowerCase();
  const givenName = values.fullName?.trim() || null;
  const fullName = givenName ?? nameFromEmail(email);
  const company = values.company?.trim() || null;
  const admin = createSupabaseAdminClient();

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, name, slug")
    .eq("id", actor.tenantId)
    .single();

  if (tenantError || !tenant) {
    throw fail("We couldn't load your workspace.", tenantError);
  }

  // 1. Who this address already is. Checked before anything is written, so a
  // refused invite leaves no trace.
  const { data: existingUser, error: userError } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (userError) {
    throw fail("We couldn't check that email address.", userError);
  }

  let membership: { id: string; status: string } | null = null;

  if (existingUser) {
    const { data: memberships, error: membershipError } = await admin
      .from("memberships")
      .select("id, tenant_id, role, status")
      .eq("user_id", existingUser.id);

    if (membershipError) {
      throw fail("We couldn't check that person's access.", membershipError);
    }

    // The portal turns team accounts away at sign-in, so the invite would
    // be a dead link.
    const isStaff = (memberships ?? []).some(
      (row) => row.role !== "customer" && row.status !== "disabled",
    );

    if (isStaff) {
      throw new CustomerInviteError(
        "That email belongs to a team account, so it can't be invited as a customer.",
        "conflict",
      );
    }

    membership =
      (memberships ?? []).find((row) => row.tenant_id === tenant.id) ?? null;

    if (membership?.status === "active") {
      throw new CustomerInviteError(
        `${email} already has access to your support portal.`,
        "conflict",
      );
    }

    if (membership?.status === "disabled") {
      throw new CustomerInviteError(
        `Portal access for ${email} has been disabled.`,
        "conflict",
      );
    }
  }

  // 2. The customer record: created, or brought up to date if the admin is
  // inviting someone who already raised a ticket as a guest.
  const { data: existingCustomer, error: customerError } = await admin
    .from("customers")
    .select("id, company, portal_user_id")
    .eq("tenant_id", tenant.id)
    .eq("email", email)
    .maybeSingle();

  if (customerError) {
    throw fail("We couldn't check your customers.", customerError);
  }

  if (existingCustomer?.portal_user_id) {
    throw new CustomerInviteError(
      `${email} already has access to your support portal.`,
      "conflict",
    );
  }

  if (existingCustomer) {
    const { error } = await admin
      .from("customers")
      .update({
        // Only what was actually given: sharing the portal by address alone
        // must not rename a customer who is already on record.
        ...(givenName ? { full_name: givenName } : {}),
        company: company ?? existingCustomer.company,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingCustomer.id);

    if (error) {
      throw fail("We couldn't update that customer.", error);
    }
  } else {
    const { error } = await admin.from("customers").insert({
      tenant_id: tenant.id,
      email,
      full_name: fullName,
      company,
    });

    if (error) {
      throw fail("We couldn't add that customer.", error);
    }
  }

  // 3. The account. Created confirmed, the same way the portal's own sign-in
  // email creates one: it has no session and no password, so it is inert
  // until the link in the invitation is clicked.
  let userId = existingUser?.id ?? null;
  let createdUserId: string | null = null;

  if (!userId) {
    userId = await createCustomerAccount(email, fullName);
    createdUserId = userId;
  }

  // 4. The membership, exactly like a team invite but with role `customer`.
  // A pending one is reused: this is then a resend.
  if (!membership) {
    const { error: insertError } = await admin.from("memberships").insert({
      tenant_id: tenant.id,
      user_id: userId,
      role: "customer",
      status: "invited",
      invited_by: actor.userId,
    });

    if (insertError) {
      if (createdUserId) {
        await admin.auth.admin.deleteUser(createdUserId);
      }

      throw fail("We couldn't add them to your portal.", insertError);
    }
  }

  // 5. Mail last, so nobody gets a link to access that was never granted.
  const redirectTo = new URL(
    portalPath(tenant.slug, PORTAL_ROUTES.AUTH_CALLBACK),
    await requestOrigin(),
  ).toString();

  try {
    await enqueueEmail(
      "portal_sign_in",
      { email, redirectTo, tenantName: tenant.name, invited: true },
      {
        tenantId: tenant.id,
        // Same key as the portal's own sign-in email: only the newest link
        // works, so a queued one is replaced rather than doubled.
        dedupeKey: `portal:${tenant.id}:${email}`,
      },
    );
  } catch (error) {
    console.error("[customers] queueing the invitation failed:", error);
    throw new CustomerInviteError(
      "They were added, but we couldn't email the invite. Invite them again to resend it.",
      "unknown",
    );
  }
}

/**
 * A new account for a customer, with its `users` profile. Created confirmed,
 * the same way the portal's own sign-in email creates one: it has no session
 * and no password, so it is inert until a link we send is clicked.
 */
async function createCustomerAccount(
  email: string,
  fullName: string,
): Promise<string> {
  const admin = createSupabaseAdminClient();

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

  if (createError || !created?.user?.id) {
    throw fail(
      "We couldn't create an account for that email. Try again.",
      createError,
    );
  }

  const userId = created.user.id;

  // Only for a brand-new account: an existing person's profile is theirs.
  const { error: profileError } = await admin
    .from("users")
    .upsert({ id: userId, email, full_name: fullName }, { onConflict: "id" });

  if (profileError) {
    await admin.auth.admin.deleteUser(userId);
    throw fail("We couldn't create that person's profile.", profileError);
  }

  return userId;
}

/** The customer, and the account behind them if they have one. */
async function resolveCustomerAccount(tenantId: string, customerId: string) {
  const admin = createSupabaseAdminClient();

  const { data: customer, error } = await admin
    .from("customers")
    .select("id, email, full_name, company, portal_user_id")
    .eq("tenant_id", tenantId)
    .eq("id", customerId)
    .maybeSingle();

  if (error) {
    throw fail("We couldn't load that customer.", error);
  }

  if (!customer) {
    throw new CustomerInviteError(
      "That customer no longer exists.",
      "conflict",
    );
  }

  let userId = customer.portal_user_id;

  // Invited but not signed in yet: the customer row has no link, so the
  // account is found by the address the invite went to.
  if (!userId) {
    const { data: user, error: userError } = await admin
      .from("users")
      .select("id")
      .eq("email", customer.email.trim().toLowerCase())
      .maybeSingle();

    if (userError) {
      throw fail("We couldn't load that customer's account.", userError);
    }

    userId = user?.id ?? null;
  }

  return { customer, userId };
}

async function requireTenantAdmin() {
  const actor = await getActorOrNull();

  if (!actor || actor.role !== "Tenant Admin") {
    throw new CustomerInviteError(
      "Only a Tenant Admin can change a customer's portal access.",
      "action-not-allowed",
    );
  }

  return actor;
}

/**
 * Turn a customer's portal access off or back on.
 *
 * Disabling takes effect on their next portal page: getPortalIdentity reads
 * this row live, sign-in refuses a disabled membership with its own message,
 * and the access-token hook never picks a disabled membership. Enabling puts
 * them back where they were -- active if they had ever signed in, otherwise
 * still invited.
 */
export async function setCustomerPortalAccess(
  customerId: string,
  enabled: boolean,
): Promise<void> {
  const actor = await requireTenantAdmin();
  const { customer, userId } = await resolveCustomerAccount(
    actor.tenantId,
    customerId,
  );

  const admin = createSupabaseAdminClient();

  const { data: membership, error } = userId
    ? await admin
        .from("memberships")
        .select("id, role, status, joined_at, invited_by")
        .eq("tenant_id", actor.tenantId)
        .eq("user_id", userId)
        .maybeSingle()
    : { data: null, error: null };

  if (error) {
    throw fail("We couldn't load their portal access.", error);
  }

  if (membership && membership.role !== "customer") {
    throw new CustomerInviteError(
      `${customer.email} belongs to your team, so their access is managed on the Team page.`,
      "conflict",
    );
  }

  if (!membership) {
    if (enabled) {
      // Never invited and never blocked: nothing to turn back on.
      return;
    }

    // Not invited yet, but the portal lets anyone with an address on record
    // sign themselves in. Blocking that needs a membership to say so: an
    // inert account if there is none, and a row marked disabled.
    // `invited_by` stays null, which is how Enable knows to put them back to
    // "Not invited" rather than pretend an invite went out.
    let accountId = userId;
    let createdAccount = false;

    if (!accountId) {
      accountId = await createCustomerAccount(
        customer.email.trim().toLowerCase(),
        customer.full_name,
      );
      createdAccount = true;
    }

    const { error: insertError } = await admin.from("memberships").insert({
      tenant_id: actor.tenantId,
      user_id: accountId,
      role: "customer",
      status: "disabled",
      disabled_at: new Date().toISOString(),
    });

    if (insertError) {
      if (createdAccount) {
        await admin.auth.admin.deleteUser(accountId);
      }

      throw fail("We couldn't change their portal access.", insertError);
    }

    return;
  }

  // Back to where they were: active if they had ever signed in, invited if an
  // invite went out, and no membership at all if they were blocked before
  // either -- so the badge goes back to "Not invited".
  if (enabled && !membership.joined_at && !membership.invited_by) {
    if (membership.status !== "disabled") {
      return;
    }

    const { error: deleteError } = await admin
      .from("memberships")
      .delete()
      .eq("id", membership.id)
      .eq("status", "disabled");

    if (deleteError) {
      throw fail("We couldn't change their portal access.", deleteError);
    }

    return;
  }

  const nextStatus = enabled
    ? membership.joined_at
      ? "active"
      : "invited"
    : "disabled";

  if (membership.status === nextStatus) {
    return;
  }

  const { error: updateError } = await admin
    .from("memberships")
    .update({
      status: nextStatus,
      disabled_at: enabled ? null : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", membership.id);

  if (updateError) {
    throw fail("We couldn't change their portal access.", updateError);
  }
}

/**
 * "Invite to portal" for a customer already on the list, and "Resend invite"
 * for one whose invitation is pending: the same invite as the popup, with the
 * details already on record.
 */
export async function inviteExistingCustomer(
  customerId: string,
): Promise<void> {
  const actor = await requireTenantAdmin();
  const { customer } = await resolveCustomerAccount(actor.tenantId, customerId);

  await inviteCustomer({
    email: customer.email,
    fullName: customer.full_name,
    company: customer.company ?? undefined,
  });
}
