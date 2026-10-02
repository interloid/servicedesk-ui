import "server-only";

import { cache } from "react";

import type { EmailOtpType } from "@supabase/supabase-js";

import {
  ATTACHMENT_BUCKET,
  AVATAR_BUCKET,
  avatarError,
  attachmentError,
  PORTAL_REQUEST_PRIORITY,
  describeBusinessHours,
  initialsFrom,
  MAX_ATTACHMENTS_PER_MESSAGE,
  PORTAL_REQUESTS_PER_PAGE,
  PORTAL_ACCESS_DISABLED_MESSAGE,
  PORTAL_ROUTES,
  portalPath,
  toPortalState,
  type PortalAttachment,
  type PortalCustomer,
  type CsatScore,
  type PortalCsat,
  type PortalFailureCode,
  type PortalIdentity,
  type PortalMessage,
  type PortalMessageAuthor,
  type PortalNextStep,
  type PortalPriority,
  type PortalRequestDetail,
  type PortalRequestPage,
  type PortalRequestSort,
  type PortalSupportHours,
  type PortalTenant,
  type PortalTicketStatus,
  type PortalUploadedFile,
  type PortalUploadTarget,
} from "@/features/portal/portal";
import {
  customerAvatarFolder,
  trustedCustomerAvatarUrl,
  trustedTenantLogoUrl,
} from "@/features/portal/avatar-url";
import { enqueueEmail } from "@/lib/email/email-queue";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requestOrigin } from "@/features/auth/services/auth.service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The `type` a portal sign-in link may legitimately carry. Anything else is
 * treated as a plain magic link rather than trusted from the query string.
 */
const LINK_OTP_TYPES = new Set<string>([
  "magiclink",
  "email",
  "signup",
  "invite",
]);

export class PortalError extends Error {
  // Sourced from PORTAL_FAILURE_CODES rather than restated: the actions map
  // this straight onto PortalResult, so a code that exists here and not there
  // would fail to compile at the boundary instead of at the throw site.
  readonly code: PortalFailureCode;

  constructor(message: string, code: PortalFailureCode = "unknown") {
    super(message);
    this.name = "PortalError";
    this.code = code;
  }
}

/**
 * PostgREST errors carry the useful part in `code`, not `message`: PGRST205 is
 * "no such table in the schema cache" (an unpushed migration), 42501 is an RLS
 * refusal, 23xxx a constraint. Logging the message alone leaves those three
 * indistinguishable in the server output, which is what made the CSAT failure
 * hard to place.
 */
function dbError(error: {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}): string {
  return [
    error.code ? `[${error.code}]` : null,
    error.message,
    error.details || null,
    error.hint || null,
  ]
    .filter(Boolean)
    .join(" | ");
}

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  primary_color: string | null;
  // Optional: get_tenant_by_slug only returns these once the migration that
  // added the extra branding colours has been applied. Until then they are
  // absent and the portal falls back to the app defaults.
  secondary_color?: string | null;
  text_color?: string | null;
  background_color?: string | null;
  logo_url: string | null;
};

type LinkResult = {
  customer_id: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_name: string;
  email: string;
  full_name: string;
  company: string | null;
  role: string;
  onboarded: boolean;
  has_password: boolean;
  password_prompted: boolean;
};

/**
 * Supabase reports "too many requests" through a couple of different shapes
 * depending on whether the limit was hit on the email sender or the endpoint.
 */
function isRateLimit(error: {
  status?: number;
  code?: string;
  message?: string;
}) {
  return (
    error.status === 429 ||
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_request_rate_limit" ||
    Boolean(error.message?.toLowerCase().includes("rate limit"))
  );
}

/**
 * Supabase refuses a password change on a session that is not recent when
 * `secure_password_change` is on. The GoTrue code has moved around between
 * versions, so the message is the reliable half; both are tested.
 */
function needsReauthentication(error: {
  code?: string;
  message?: string;
}): boolean {
  if (
    error.code === "reauth_needed" ||
    error.code === "reauthentication_needed"
  ) {
    return true;
  }

  return Boolean(error.message?.toLowerCase().includes("recent login"));
}

// ---------------------------------------------------------------------------
// Tenant
// ---------------------------------------------------------------------------

/**
 * Branding for the portal header, resolvable before sign-in.
 *
 * Goes through get_tenant_by_slug rather than selecting from `tenants`: that
 * SECURITY DEFINER function is the one anon-safe door onto the table, and it
 * returns only the public-facing branding fields. See
 * supabase/schemas/functions/09_get_tenant_by_slug.sql.
 *
 * Wrapped in React's cache(): the portal layout renders the branded header and
 * the page beneath it guards on the same tenant, so an uncached version costs
 * two identical round trips on every single request.
 */
export const getPortalTenant = cache(async function getPortalTenant(
  slug: string,
): Promise<PortalTenant | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("get_tenant_by_slug", {
    p_slug: slug,
  });

  if (error) {
    console.error(
      `[portal] tenant lookup for "${slug}" failed:`,
      error.message,
    );
    return null;
  }

  const row = data as TenantRow | null;

  if (!row?.id) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    initial: row.name.charAt(0).toUpperCase(),
    primaryColor: row.primary_color?.trim() || null,
    // Optional chaining on purpose: get_tenant_by_slug only started returning
    // these keys in the migration that added the fields, so a deployment where
    // the app is ahead of the database simply falls back to the defaults rather
    // than breaking the portal.
    secondaryColor: row.secondary_color?.trim() || null,
    textColor: row.text_color?.trim() || null,
    backgroundColor: row.background_color?.trim() || null,
    logoUrl: trustedTenantLogoUrl(row.logo_url?.trim() || null),
  };
});

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Whether this auth user is on a team -- agent, manager, admin -- in ANY
 * workspace. Such a user can never use the portal.
 *
 * Not just a policy choice: custom_access_token_hook stamps a session with the
 * user's first active membership, so a team member signed in here would carry
 * `tenant_role: agent` (possibly for another workspace) and RLS would treat the
 * "customer" as staff. The portal is for customer-only accounts.
 *
 * Disabled memberships do not count: the hook skips them too, so a former
 * agent's session resolves to their customer membership alone.
 *
 * Admin client: memberships are staff-scoped under RLS, and at the point this
 * runs the session may not carry tenant claims yet. Only a yes/no leaves here.
 */
async function hasTeamMembership(userId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("memberships")
    .select("id")
    .eq("user_id", userId)
    .neq("role", "customer")
    .neq("status", "disabled")
    .limit(1);

  if (error) {
    // Fail closed: letting a possible staff session through is the worse
    // mistake, and the customer can simply try again.
    console.error("[portal] team membership check failed:", error.message);
    return true;
  }

  return data.length > 0;
}

/**
 * The same rule keyed on an email, for the steps that run BEFORE anyone is
 * authenticated: requesting a link and a guest request. A team email never gets
 * a link and never gets a customer record -- only new or customer-only emails
 * get as far as onboarding.
 *
 * The sign-in link path answers a team address exactly as it answers any other
 * (and sends nothing), so the form cannot be used to test which addresses are
 * staff. The password path does not call this at all: it checks the password
 * first, and linkPortalSession turns the team account away after that.
 */
export async function isTeamEmail(email: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();

  // ilike for a case-insensitive exact match; the wildcards are escaped so an
  // address containing `_` or `%` cannot match anyone else's.
  const { data, error } = await admin
    .from("users")
    .select("id")
    .ilike("email", email.trim().replace(/[\\%_]/g, "\\$&"))
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[portal] team email lookup failed:", error.message);
    return true;
  }

  // No account at all: a brand-new customer, which is exactly who may onboard.
  return data ? hasTeamMembership(data.id) : false;
}

export const TEAM_ACCOUNT_MESSAGE =
  "This email belongs to a team account, which can't use the support " +
  "portal. Sign in to the help desk instead, or use a different email.";

function toPortalCustomer(
  row: {
    id: string;
    full_name: string;
    email: string;
    company: string | null;
    portal_onboarded_at: string | null;
  },
  avatarUrl: string | null = null,
): PortalCustomer {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    company: row.company,
    initials: initialsFrom(row.full_name, row.email),
    onboarded: Boolean(row.portal_onboarded_at),
    avatarUrl,
  };
}

/**
 * The signed-in customer for this tenant, or null.
 *
 * Deliberately matched on `portal_user_id` instead of the JWT's tenant claims:
 * the customers_select policy admits `portal_user_id = auth.uid()` on its own,
 * so this still resolves during the window between verifying a code and the
 * refreshed token carrying tenant_id. Ticket queries do need the claims, which
 * is why linkPortalSession refreshes the session before anything reads them.
 *
 * Cached per request for the same reason as getPortalTenant — the layout needs
 * it for the header, the page needs it for its guard.
 */
/**
 * This person's live membership status in the workspace ("active", "invited",
 * "disabled"), or null with none. Admin client: a disabled member's own token
 * no longer reaches the row, and "hidden" must never read as "allowed".
 */
async function portalMembershipStatus(
  tenantId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from("memberships")
    .select("status")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[portal] membership status failed:", error.message);
    return null;
  }

  return data?.status ?? null;
}

/**
 * True when the signed-in browser belongs to a customer whose access to this
 * portal a Tenant Admin disabled. The login page uses it to say so, rather
 * than showing a blank sign-in form to someone who is in fact signed in.
 */
export const isPortalAccessDisabled = cache(
  async function isPortalAccessDisabled(slug: string): Promise<boolean> {
    const tenant = await getPortalTenant(slug);

    if (!tenant) {
      return false;
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return false;
    }

    return (await portalMembershipStatus(tenant.id, user.id)) === "disabled";
  },
);

export const getPortalIdentity = cache(async function getPortalIdentity(
  slug: string,
): Promise<PortalIdentity | null> {
  const tenant = await getPortalTenant(slug);

  if (!tenant) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from("customers")
    .select("id, full_name, email, company, portal_onboarded_at")
    .eq("tenant_id", tenant.id)
    .eq("portal_user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[portal] identity lookup failed:", error.message);
    return null;
  }

  if (!data) {
    return null;
  }

  // Also catches team members linked as customers before sign-in checked
  // this: they are simply not signed in as far as the portal is concerned.
  if (await hasTeamMembership(user.id)) {
    return null;
  }

  // Checked live on every request: a customer disabled by a Tenant Admin is
  // out on their next page, not when their token happens to expire.
  if ((await portalMembershipStatus(tenant.id, user.id)) === "disabled") {
    return null;
  }

  // users_select admits `id = auth.uid()`, so this needs no tenant claim and
  // resolves just as early as the customer row above.
  const { data: profile } = await supabase
    .from("users")
    .select("avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  return {
    tenant,
    customer: toPortalCustomer(
      data,
      trustedCustomerAvatarUrl(tenant.id, user.id, profile?.avatar_url ?? null),
    ),
    userId: user.id,
  };
});

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------

/**
 * Queue the sign-in email. The link in it lands on the portal callback, which
 * is where the session is actually created -- the check-email screen the
 * customer is left on has nothing to submit.
 *
 * Only the job is written here; the `email-jobs` Edge Function generates the
 * link and sends it (see sendPortalSignIn there), with retries. It cannot use
 * signInWithOtp the way this function used to: that leaves a PKCE verifier
 * cookie in the browser that asked, and a background job has no browser. The
 * function mints a `token_hash` link instead, which the callback verifies
 * server-side -- so the link now also works on a different device.
 *
 * No separate sign-up, by design: the email you contact support from is the
 * email you sign in with. The job creates the auth user if there is none; it
 * stays inert until portal_link_user gives it a membership.
 */
export async function sendPortalSignInLink(
  slug: string,
  email: string,
): Promise<void> {
  const tenant = await getPortalTenant(slug);

  if (!tenant) {
    throw new PortalError(
      "That support portal doesn't exist.",
      "tenant_not_found",
    );
  }

  // A team address gets the same "check your inbox" as anyone else, and simply
  // no email. Refusing it out loud told anyone with the portal URL which
  // addresses are staff somewhere on the platform.
  if (await isTeamEmail(email)) {
    return;
  }

  // A disabled customer is told so, rather than sent a link that would only
  // fail at the callback.
  const { data: account } = await createSupabaseAdminClient()
    .from("users")
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();

  if (
    account &&
    (await portalMembershipStatus(tenant.id, account.id)) === "disabled"
  ) {
    throw new PortalError(PORTAL_ACCESS_DISABLED_MESSAGE, "access_disabled");
  }

  const origin = await requestOrigin();

  const redirectTo = new URL(
    portalPath(tenant.slug, PORTAL_ROUTES.AUTH_CALLBACK),
    origin,
  ).toString();

  try {
    await enqueueEmail(
      "portal_sign_in",
      { email, redirectTo, tenantName: tenant.name },
      {
        tenantId: tenant.id,
        // Asking twice while the first is still queued sends one email, not
        // two -- and only the newest link would work anyway.
        dedupeKey: `portal:${tenant.id}:${email.trim().toLowerCase()}`,
      },
    );
  } catch {
    throw new PortalError(
      "We couldn't send that email. Try again in a moment.",
      "unknown",
    );
  }
}

export async function portalPasswordSignIn(
  slug: string,
  email: string,
  password: string,
): Promise<PortalNextStep> {
  const supabase = await createSupabaseServerClient();

  // Credentials first, team check second: checking the address before the
  // password let anyone learn whether an email is staff without knowing its
  // password. Only someone who has just proved the password hears that it is a
  // team account.
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    if (error && isRateLimit(error)) {
      throw new PortalError(
        "Too many attempts. Try again in a minute.",
        "rate_limited",
      );
    }

    throw new PortalError(
      "That email and password don't match.",
      "invalid_credentials",
    );
  }

  try {
    return await linkPortalSession(slug, data.user.id);
  } catch (linkError) {
    // The password was right, so a session now exists. When the account may
    // not use the portal it must not be left standing.
    if (
      linkError instanceof PortalError &&
      (linkError.code === "no_portal_access" ||
        linkError.code === "access_disabled")
    ) {
      await portalSignOut("local");
    }

    throw linkError;
  }
}

/**
 * Complete a magic-link sign-in. The callback route hands us whatever the email
 * link carried, and the two shapes need different calls:
 *
 * - `token_hash` — the link points straight at us, and verifyOtp exchanges it
 *   server-side. Nothing browser-local is involved, so the email can be opened
 *   on ANY device. This is the same call /auth/confirm already makes.
 * - `code` — the link went through Supabase's /auth/v1/verify first, which
 *   redirected back with a PKCE code. Exchanging it needs the code_verifier
 *   cookie written when the link was requested, so it only works in the same
 *   browser.
 *
 * Both are accepted so the flow works on the stock email template today
 * (which produces `code`) and gets cross-device sign-in for free the moment the
 * template is switched to a token_hash link. See docs/customer-portal-onboarding.md.
 */
export async function completePortalEmailSignIn(
  slug: string,
  link: {
    tokenHash?: string | null;
    code?: string | null;
    type?: string | null;
  },
): Promise<PortalNextStep> {
  const supabase = await createSupabaseServerClient();

  if (link.tokenHash) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: link.tokenHash,
      type: LINK_OTP_TYPES.has(link.type ?? "")
        ? (link.type as EmailOtpType)
        : "magiclink",
    });

    if (error || !data.user) {
      console.error("[portal] token_hash verification failed:", error?.message);

      throw new PortalError(
        "That sign-in link has expired. Request a new one.",
        "expired_link",
      );
    }

    return completeLink(slug, data.user.id);
  }

  if (!link.code) {
    throw new PortalError(
      "That sign-in link is incomplete. Start again.",
      "expired_link",
    );
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(link.code);

  if (error || !data.user) {
    console.error("[portal] code exchange failed:", error?.message);

    throw new PortalError(
      "That sign-in link has expired, or was opened on a different device. " +
        "Request a new one and open it on this device.",
      "expired_link",
    );
  }

  return completeLink(slug, data.user.id);
}

/**
 * Link the session and, if the link is refused, take the session back down.
 *
 * verifyOtp and exchangeCodeForSession both leave a real session in the browser
 * before linkPortalSession runs. If the link then fails -- no portal access, a
 * failed refresh, anything -- that session must not be left standing, or the
 * customer walks around the portal with an identity that was never accepted.
 * Local scope only: global would sign the same person out of the help desk on
 * every device.
 */
async function completeLink(
  slug: string,
  userId: string,
): Promise<PortalNextStep> {
  try {
    return await linkPortalSession(slug, userId);
  } catch (error) {
    await portalSignOut("local");

    throw error;
  }
}

/**
 * Finish a sign-in whose membership was already written for it.
 *
 * portal_link_user does two jobs: it claims the customer record for this
 * workspace (the guest-request flow depends on that, so the record is created
 * before anyone signs in) and it writes the membership. When a Tenant Admin
 * has invited this customer, the second job is already done -- the invite IS
 * the membership row -- so the insert inside the RPC collides with
 * uq_membership and the whole call rolls back, customer record included.
 *
 * 23505 is that collision and nothing else, and the state it left behind is
 * the state we wanted, so this finishes the one job that is still outstanding.
 * Every other RPC failure keeps its existing path above.
 */
async function claimInvitedCustomer(
  userId: string,
  tenantId: string,
): Promise<LinkResult | null> {
  const admin = createSupabaseAdminClient();
  const portalSupabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await portalSupabase.auth.getUser();

  if (!user?.email) {
    console.error("[portal] invited-customer claim: no email on the session");
    return null;
  }

  // `.is("portal_user_id", null)` so a record already claimed by someone else
  // is never taken over. `eq`, not `ilike`: `customers.email` is citext, so
  // equality is already case-insensitive, while ilike would treat `_` and `%`
  // -- both legal in an address -- as wildcards and let j_hn@ claim john@.
  const { data: candidate, error: findError } = await admin
    .from("customers")
    .select("id")
    .eq("tenant_id", tenantId)
    .is("portal_user_id", null)
    .eq("email", user.email)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (findError || !candidate) {
    console.error(
      "[portal] invited-customer claim failed:",
      findError ? dbError(findError) : "no unclaimed customer for this email",
    );
    return null;
  }

  // One row, by id: an exact email match can still name more than one record.
  const { error } = await admin
    .from("customers")
    .update({ portal_user_id: userId, updated_at: new Date().toISOString() })
    .eq("id", candidate.id)
    .is("portal_user_id", null);

  if (error) {
    console.error("[portal] invited-customer claim failed:", dbError(error));
    return null;
  }

  const { data, error: readError } = await admin
    .from("customers")
    .select("id, full_name, email, company, portal_onboarded_at")
    .eq("tenant_id", tenantId)
    .eq("portal_user_id", userId)
    .maybeSingle();

  if (readError || !data) {
    console.error(
      "[portal] invited-customer read-back failed:",
      readError ? dbError(readError) : "no customer row for this session",
    );
    return null;
  }

  return {
    customer_id: data.id,
    tenant_id: tenantId,
    tenant_slug: "",
    tenant_name: "",
    email: data.email,
    full_name: data.full_name,
    company: data.company,
    role: "customer",
    onboarded: Boolean(data.portal_onboarded_at),
    has_password: false,
    password_prompted: false,
  };
}

/**
 * Give the freshly authenticated user a customer record and a membership, then
 * mint a new token so the tenant_id / tenant_role claims exist.
 *
 * The refresh is the part that is easy to drop and hard to debug: the access
 * token was issued before the membership existed, so until it is replaced
 * `current_tenant_id()` is null and every ticket query returns an empty list
 * rather than an error.
 */
export async function linkPortalSession(
  slug: string,
  userId: string,
  fullName?: string,
): Promise<PortalNextStep> {
  // Before the link RPC, not after: it would otherwise give a team member a
  // customer record and membership in this workspace.
  if (await hasTeamMembership(userId)) {
    throw new PortalError(TEAM_ACCOUNT_MESSAGE, "no_portal_access");
  }

  const admin = createSupabaseAdminClient();
  const tenant = await getPortalTenant(slug);

  const { data, error } = await admin.rpc("portal_link_user", {
    p_user_id: userId,
    p_tenant_slug: slug,
    p_full_name: fullName ?? null,
  });

  let link: LinkResult | null = null;

  if (error) {
    // An invited customer already holds the membership this call would write.
    if (error.code === "23505" && tenant) {
      console.warn(
        "[portal] link hit an existing membership; claiming the customer record directly",
      );
      link = await claimInvitedCustomer(userId, tenant.id);
    }

    if (!link) {
      console.error("[portal] link failed:", error.message);

      // portal_link_user raises 42501 for a disabled membership too; that
      // one gets its own, plainer message.
      if (error.code === "42501" && error.message.includes("disabled")) {
        throw new PortalError(
          PORTAL_ACCESS_DISABLED_MESSAGE,
          "access_disabled",
        );
      }

      if (error.code === "42501") {
        throw new PortalError(
          "This email can't be used to sign in to this portal. Contact support.",
          "no_portal_access",
        );
      }

      throw new PortalError(
        "We couldn't finish signing you in. Try again in a moment.",
        "unknown",
      );
    }
  } else {
    link = data as LinkResult;
  }

  // Signing in is activity in its own right, and on the Customers list it is
  // the only signal there is for a customer who has never raised a ticket, so
  // it is stamped here rather than left to whatever portal_link_user happens to
  // do. `updated_at` moves with it, matching how the claim and profile paths
  // treat the pair. Best effort: the session is already good by this point, and
  // a customer whose row will not take the stamp can still sign in.
  const { error: loginStampError } = await admin
    .from("customers")
    .update({
      portal_last_login_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", link.customer_id)
    .eq("tenant_id", link.tenant_id);

  if (loginStampError) {
    console.error("[portal] last-login stamp failed:", loginStampError.message);
  }

  // The access token names one tenant, and the hook picks it from the user's
  // memberships. Someone who is a customer of more than one workspace has to
  // land in the one whose portal they just signed in to, or every RLS read
  // below runs against the other tenant and comes back empty. The trigger on
  // users mirrors this into app_metadata, which is what the hook reads; it is
  // advisory, so the hook still only picks among real memberships. Best effort:
  // a single-workspace customer lands correctly without it.
  const { error: preferError } = await admin
    .from("users")
    .update({ preferred_tenant_id: link.tenant_id })
    .eq("id", userId);

  if (preferError) {
    console.error(
      "[portal] preferred tenant write failed:",
      preferError.message,
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error: refreshError } = await supabase.auth.refreshSession();

  if (refreshError) {
    console.error(
      "[portal] claim refresh failed after linking:",
      refreshError.message,
    );

    throw new PortalError(
      "We signed you in but couldn't load your requests. Try again.",
      "unknown",
    );
  }

  // First sign-in: offer a password, then the welcome wizard (the password
  // page's Skip and Save both lead there). Keyed on `onboarded` so the offer
  // ends the moment the wizard has been shown -- after that, every sign-in
  // goes straight to the requests.
  if (!link.onboarded) return "password";

  return "requests";
}

export async function setPortalPassword(password: string): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new PortalError("Your session has expired.", "not_signed_in");
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    if (isRateLimit(error)) {
      throw new PortalError(
        "Too many attempts. Try again shortly.",
        "rate_limited",
      );
    }

    // secure_password_change is on, so a stale session is sent back through
    // sign-in rather than silently rejected with GoTrue's own wording.
    if (needsReauthentication(error)) {
      throw new PortalError(
        "For your security, sign in again before changing your password.",
        "not_signed_in",
      );
    }

    throw new PortalError(
      error.message || "We couldn't save that password.",
      "validation",
    );
  }
}

export async function completePortalOnboarding(
  slug: string,
  userId: string,
): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { error } = await admin.rpc("portal_complete_onboarding", {
    p_user_id: userId,
    p_tenant_slug: slug,
  });

  if (error) {
    console.error("[portal] complete onboarding failed:", error.message);

    throw new PortalError(
      "We couldn't save that. Try again in a moment.",
      "unknown",
    );
  }
}

/**
 * Spend the welcome wizard as it is handed out, not when it is answered.
 *
 * Without this, a customer who closes the tab mid-wizard -- or simply signs in
 * with a second link -- is shown it again, and the wizard is meant to appear
 * once per customer, ever. Stamping when the wizard mounts (markWelcomeShownAction)
 * means the next visit through any route (magic link, password, /portal, a
 * bookmark to /welcome) finds `onboarded` set and goes straight to the requests.
 *
 * Does not throw: failing to remember costs the customer one more viewing,
 * which is better than failing the page they came for.
 */
export async function markPortalWelcomeShown(
  slug: string,
  userId: string,
): Promise<void> {
  try {
    await completePortalOnboarding(slug, userId);
  } catch {
    // Already logged by completePortalOnboarding.
  }
}

/**
 * `local` ends only this browser's session. Used when a sign-in is refused:
 * the account may be a team member's, and a global sign-out would also end
 * their help-desk sessions on every other device.
 */
export async function portalSignOut(
  scope: "global" | "local" = "global",
): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.auth.signOut({ scope });

  if (error) {
    console.error("[portal] sign-out failed:", error.message);
  }
}

/**
 * Where a customer belongs immediately after signing in.
 * Used by the callback route and by every guarded portal page.
 */
export function stepPath(slug: string, step: PortalNextStep): string {
  switch (step) {
    case "password":
      return portalPath(slug, PORTAL_ROUTES.PASSWORD);
    case "welcome":
      return portalPath(slug, PORTAL_ROUTES.WELCOME);
    default:
      return portalPath(slug, PORTAL_ROUTES.REQUESTS);
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/**
 * Authorise one profile-photo upload. The browser sends the bytes straight to
 * Storage with the token -- a Server Action body is capped at 1 MB, well under
 * the 5 MB photos the bucket accepts. Same pattern as attachments.
 */
export async function preparePortalAvatarUpload(
  identity: PortalIdentity,
  file: { size: number; type: string },
): Promise<{ path: string; token: string }> {
  const problem = avatarError(file);

  if (problem) {
    throw new PortalError(problem, "validation");
  }

  const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "img";
  const path = `${customerAvatarFolder(identity.tenant.id, identity.userId)}/${Date.now()}.${extension}`;

  const admin = createSupabaseAdminClient();

  const { data, error } = await admin.storage
    .from(AVATAR_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error(
      "[portal] could not authorise an avatar upload:",
      error?.message ?? "no token returned",
    );

    throw new PortalError(
      "We couldn't start that upload. Try again in a moment.",
      "unknown",
    );
  }

  return { path, token: data.token };
}

/**
 * Save Profile settings: the name on this workspace's customer record, and
 * optionally a photo that has already been uploaded to `avatarPath`.
 *
 * The name goes on `customers` because that is what the team sees on the
 * ticket and what the thread shows. The photo goes on `users.avatar_url`:
 * `customers` has no column for it, and the agent app already reads a
 * customer's photo from there, so both sides see the same picture. It follows
 * the person, not the workspace.
 */
export async function updatePortalProfile(
  identity: PortalIdentity,
  {
    fullName,
    company,
    avatarPath,
  }: { fullName: string; company: string; avatarPath?: string | null },
): Promise<void> {
  const admin = createSupabaseAdminClient();
  const folder = customerAvatarFolder(identity.tenant.id, identity.userId);

  // The path came back from the browser: only accept one in this customer's
  // own folder, which is the only kind preparePortalAvatarUpload hands out.
  // Checked before anything is written, so a bad path cannot leave the name
  // saved and the request reported as failed.
  if (
    avatarPath &&
    (!avatarPath.startsWith(`${folder}/`) || avatarPath.includes(".."))
  ) {
    throw new PortalError("That photo upload wasn't valid.", "validation");
  }

  // Company is free text on the customer row. Only the requester filter
  // decides what a customer can see, so changing it exposes nothing; it is
  // what the team's customer page groups colleagues by.
  const { data: renamed, error: nameError } = await admin
    .from("customers")
    .update({
      full_name: fullName,
      company: company || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", identity.customer.id)
    .eq("tenant_id", identity.tenant.id)
    .select("id");

  if (nameError || !renamed?.length) {
    console.error(
      "[portal] profile name update failed:",
      nameError?.message ?? "no customer row updated",
    );

    throw new PortalError(
      "We couldn't save your profile. Try again in a moment.",
      "unknown",
    );
  }

  if (!avatarPath) {
    return;
  }

  const {
    data: { publicUrl },
  } = admin.storage.from(AVATAR_BUCKET).getPublicUrl(avatarPath);

  // Only the photo column is touched; the rest of the row is left alone. The
  // row is guaranteed to exist (memberships.user_id references users(id), and a
  // signed-in customer has a membership), but `select` makes a 0-row update an
  // error rather than a silently dropped photo.
  const { data: updated, error: photoError } = await admin
    .from("users")
    .update({
      avatar_url: publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", identity.userId)
    .select("id");

  if (photoError || !updated || updated.length === 0) {
    console.error(
      "[portal] profile photo update failed:",
      photoError?.message ?? "no users row for this customer",
    );

    throw new PortalError(
      "Your name was saved, but we couldn't save the photo. Try again.",
      "unknown",
    );
  }

  // Best effort: earlier photos are no longer referenced by anything.
  const { data: previous } = await admin.storage
    .from(AVATAR_BUCKET)
    .list(folder);
  const stale = (previous ?? [])
    .map((object) => `${folder}/${object.name}`)
    .filter((path) => path !== avatarPath);

  if (stale.length > 0) {
    await admin.storage.from(AVATAR_BUCKET).remove(stale);
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

type RequestFilters = {
  search?: string;
  state?: string;
  sort?: PortalRequestSort;
  page?: number;
};

/** Long enough for two lines on a wide row; the UI truncates the rest. */
const PREVIEW_LENGTH = 160;

/** Ordered on the server so the sort applies before the 100-row limit. */
const SORT_ORDER: Record<
  PortalRequestSort,
  { column: "updated_at" | "created_at"; ascending: boolean }
> = {
  updated: { column: "updated_at", ascending: false },
  newest: { column: "created_at", ascending: false },
  oldest: { column: "created_at", ascending: true },
};

const STATE_TO_STATUSES: Record<string, PortalTicketStatus[]> = {
  open: ["new", "open"],
  waiting_on_you: ["pending", "on_hold"],
  resolved: ["resolved", "closed"],
};

/**
 * Reads through RLS as the customer: tickets_select already restricts rows to
 * `requester_customer_id = <the caller's customer row>`, so no ownership filter
 * is repeated here. The tenant_id filter is belt-and-braces for the case where
 * one person is a customer of several tenants on the same auth user.
 *
 * One page, plus the total behind the filters. The total comes from
 * `count: "exact"` rather than from the rows returned, because the length of
 * the page cannot tell "ten requests, and that is all of them" from "ten of
 * eighty-seven", and a pager built on that guess invents a second page for
 * everyone whose first page happens to come back short.
 *
 * The page is clamped to the last one that exists. A hand-edited or stale
 * `?page=9` is not an error worth rendering as one -- the reader gets the last
 * page of real results, and the page component redirects so the URL agrees with
 * what was shown.
 */
export async function listPortalRequests(
  identity: PortalIdentity,
  filters: RequestFilters = {},
): Promise<PortalRequestPage> {
  const supabase = await createSupabaseServerClient();
  const order = SORT_ORDER[filters.sort ?? "updated"];

  /**
   * The filtered set, with no order and no window.
   *
   * A closure rather than a value because the count and the page are two
   * different requests -- `head` is a property of the select, not something
   * that can be added afterwards -- and the filters are written once here so
   * they cannot be applied to one and forgotten on the other. That is how a
   * total ends up counting rows the page does not show.
   */
  function filtered(head: boolean) {
    let query = supabase
      .from("tickets")
      // The count is asked for only by the call that reads it. Asking PostgREST
      // for an exact count on the page as well makes it count the same set a
      // second time on every page load, for a number this already has.
      .select(TICKET_LIST_COLUMNS, head ? { count: "exact", head } : undefined)
      .eq("tenant_id", identity.tenant.id)
      .eq("requester_customer_id", identity.customer.id);

    const statuses = filters.state
      ? STATE_TO_STATUSES[filters.state]
      : undefined;

    if (statuses) {
      query = query.in("status", statuses);
    }

    const term = filters.search?.trim();

    if (term) {
      const pattern = likePatternValue(term);

      query = query.or(`subject.ilike.${pattern},description.ilike.${pattern}`);
    }

    return query;
  }

  // The total comes from `count: "exact"` rather than from the rows returned,
  // because the length of a page cannot tell "ten requests, and that is all of
  // them" from "ten of eighty-seven", and a pager built on that guess invents a
  // second page for everyone whose first page happens to come back short.
  //
  // head: true, so PostgREST answers with the number in a header and an empty
  // body. Without it this query would download a full row -- subject,
  // description and all -- for every request the customer has ever raised, on
  // every page load, to read one integer. No order and no range on it, since
  // neither can change how many rows match.
  const { count, error: countError } = await filtered(true);

  if (countError) {
    console.error("[portal] request count failed:", countError.message);
    return {
      requests: [],
      total: 0,
      page: 1,
      perPage: PORTAL_REQUESTS_PER_PAGE,
    };
  }

  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PORTAL_REQUESTS_PER_PAGE));

  // A hand-edited or stale `?page=9` is not an error worth rendering as one: the
  // reader gets the last page that exists, and the page component redirects so
  // the URL ends up agreeing with what was shown. Number.isFinite rather than
  // `> 0` is the test, because `?page=abc` reaches here as NaN and NaN > 0 is
  // false, which would quietly send a typo to page 1 with no correction.
  const requested = Math.trunc(filters.page ?? 1);
  const page = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), lastPage)
    : 1;

  const from = (page - 1) * PORTAL_REQUESTS_PER_PAGE;

  // `id` breaks ties: rows that share a timestamp (a bulk update, a backfill)
  // otherwise come back in any order, and a row can land on two pages or none.
  const { data, error } = await filtered(false)
    .order(order.column, { ascending: order.ascending })
    .order("id", { ascending: order.ascending })
    .range(from, from + PORTAL_REQUESTS_PER_PAGE - 1);

  if (error) {
    console.error("[portal] request page failed:", error.message);
    // total 0, not the real count: a pager reading "1-5 of 12" over an empty
    // list contradicts itself. Same shape as the count failure above.
    return {
      requests: [],
      total: 0,
      page: 1,
      perPage: PORTAL_REQUESTS_PER_PAGE,
    };
  }

  return {
    requests: (data ?? []).map((row) => {
      const status = row.status as PortalTicketStatus;

      return {
        id: row.id,
        number: row.number,
        subject: row.subject,
        status,
        priority: row.priority as PortalPriority,
        state: toPortalState(status),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        resolvedAt: row.resolved_at,
        // Trimmed here so a 10,000-character description is not shipped to
        // the browser to show one line of it.
        preview: (row.description ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, PREVIEW_LENGTH),
      };
    }),
    total,
    page,
    perPage: PORTAL_REQUESTS_PER_PAGE,
  };
}

/** The columns a list row needs. One string so the count and the page agree. */
const TICKET_LIST_COLUMNS =
  "id, number, subject, description, status, priority, created_at, updated_at, resolved_at";

type CreateRequestInput = {
  slug: string;
  subject: string;
  description: string;
  email: string;
  fullName?: string;
  userId?: string;
  /** Already in the bucket, under the staging prefix. See attachStagedUploads. */
  uploads?: PortalUploadedFile[];
};

export async function createPortalRequest({
  slug,
  subject,
  description,
  email,
  fullName,
  userId,
  uploads = [],
}: CreateRequestInput): Promise<{ id: string; number: number | null }> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin.rpc("portal_create_request", {
    p_tenant_slug: slug,
    p_email: email,
    p_subject: subject,
    p_description: description,
    p_full_name: fullName ?? null,
    p_user_id: userId ?? null,
    // Never the customer's choice -- see PORTAL_REQUEST_PRIORITY.
    p_priority: PORTAL_REQUEST_PRIORITY,
  });

  if (error) {
    console.error("[portal] create request failed:", error.message);

    if (error.code === "22023") {
      throw new PortalError(
        "Check the highlighted fields and try again.",
        "validation",
      );
    }

    if (error.code === "42501") {
      throw new PortalError(
        "That email is already registered here. Sign in first.",
        "no_portal_access",
      );
    }

    if (error.code === "P0002") {
      throw new PortalError(
        "That support portal doesn't exist.",
        "tenant_not_found",
      );
    }

    throw new PortalError(
      "We couldn't submit your request. Try again in a moment.",
      "unknown",
    );
  }

  const ticket = data as { ticket_id: string; number: number | null };

  // No status write here. portal_create_request inserts 'new' itself, so the
  // update this used to issue (`.neq("status", "new")`, to leave an already-new
  // ticket alone) matched no rows on every call -- a write with no effect that
  // still fired triggers and cost a round trip. The function owns the initial
  // status, and a portal request has no other way to enter the queue.

  if (uploads.length > 0) {
    const tenant = await getPortalTenant(slug);

    try {
      if (!tenant) {
        throw new PortalError(
          "That support portal doesn't exist.",
          "tenant_not_found",
        );
      }

      await attachStagedUploads({
        tenantId: tenant.id,
        ticketId: ticket.ticket_id,
        uploadedBy: userId ?? null,
        uploads,
      });
    } catch (attachFailure) {
      // Nobody has seen this ticket yet, so withdrawing it costs nothing and
      // keeps the customer's retry from filing the same thing twice.
      const { error: cleanupError } = await admin
        .from("tickets")
        .delete()
        .eq("id", ticket.ticket_id);

      if (cleanupError) {
        console.error(
          "[portal] could not roll back a request whose files failed:",
          cleanupError.message,
        );
      }

      throw attachFailure;
    }
  }

  return { id: ticket.ticket_id, number: ticket.number };
}

// ---------------------------------------------------------------------------
// SLA promise
// ---------------------------------------------------------------------------

function formatTarget(mins: number, business: boolean): string {
  const qualifier = business ? "business " : "";

  if (mins < 60) {
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }

  const hours = Math.round(mins / 60);

  if (hours < 24) {
    return `${hours} ${qualifier}hour${hours === 1 ? "" : "s"}`;
  }

  const days = Math.round(hours / 24);

  return `${days} ${qualifier}day${days === 1 ? "" : "s"}`;
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * The tenant's active default SLA policy -- the one whose promises the portal
 * quotes. `is_default` first, then the oldest, so a tenant that never flagged
 * a default still gets a stable answer.
 */
async function getDefaultPolicy(admin: AdminClient, tenantId: string) {
  const { data, error } = await admin
    .from("sla_policies")
    .select("id, business_hours_id")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .order("is_default", { ascending: false })
    .order("created_at")
    .limit(1)
    .maybeSingle();

  return error ? null : data;
}

async function getPolicyFirstResponse(
  admin: AdminClient,
  policyId: string,
  priority: PortalPriority,
): Promise<string | null> {
  const { data: target } = await admin
    .from("sla_policy_targets")
    .select("first_response_mins, first_response_business")
    .eq("policy_id", policyId)
    .eq("priority_scope", priority)
    .maybeSingle();

  return target
    ? formatTarget(target.first_response_mins, target.first_response_business)
    : null;
}

/**
 * The plain-language first-response promise the portal prints ("First reply
 * within 4 business hours on your plan").
 *
 * Read with the admin client on purpose: sla_policy_targets is staff-scoped
 * under RLS, but this one number is already a customer-facing commitment, and
 * only the default policy's target for PORTAL_REQUEST_PRIORITY is exposed --
 * the priority every portal request is created with, so the promise printed
 * is the one the ticket is actually held to. Every other column stays behind
 * the policies.
 */
export async function getFirstResponseTarget(
  tenantId: string,
): Promise<string> {
  const fallback = "one business day";

  const admin = createSupabaseAdminClient();
  const policy = await getDefaultPolicy(admin, tenantId);

  if (!policy) {
    return fallback;
  }

  return (
    (await getPolicyFirstResponse(admin, policy.id, PORTAL_REQUEST_PRIORITY)) ??
    fallback
  );
}

/**
 * What the portal footer says about when the team is around: the default
 * policy's business hours as one line ("Mon–Fri, 09:00–18:30 IST"), and the
 * urgent first-response promise when there is one.
 *
 * Admin client for the same reason as getFirstResponseTarget -- business_hours
 * is staff-scoped under RLS, and the footer also renders for signed-out
 * visitors. Only the formatted summary leaves this function, never the row.
 *
 * Cached per request: the layout renders it on every portal screen.
 */
export const getPortalSupportHours = cache(async function getPortalSupportHours(
  tenantId: string,
): Promise<PortalSupportHours> {
  const admin = createSupabaseAdminClient();
  const policy = await getDefaultPolicy(admin, tenantId);

  // The policy's own calendar when it names one; otherwise the tenant's
  // oldest, which is the "Default Business Hours" row onboarding creates.
  let hoursQuery = admin
    .from("business_hours")
    .select("schedule_json, timezones(code, display_name)")
    .eq("tenant_id", tenantId);

  hoursQuery = policy?.business_hours_id
    ? hoursQuery.eq("id", policy.business_hours_id)
    : hoursQuery.order("created_at").limit(1);

  const [{ data: hours }, urgentTarget] = await Promise.all([
    hoursQuery.maybeSingle(),
    policy ? getPolicyFirstResponse(admin, policy.id, "urgent") : null,
  ]);

  // The embed is to-one, but the generated types cannot tell once the query
  // is reassigned above, so accept either shape.
  const timezone = Array.isArray(hours?.timezones)
    ? (hours.timezones[0] ?? null)
    : (hours?.timezones ?? null);

  return {
    hours: hours ? describeBusinessHours(hours.schedule_json, timezone) : null,
    urgentTarget,
  };
});

// ---------------------------------------------------------------------------
// One request
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A typed search term as a quoted `ilike` value for PostgREST's `or()`.
 *
 * Two grammars, escaped in order:
 *
 *   1. LIKE: `%` and `_` are wildcards, `\` is the escape, and PostgREST also
 *      reads `*` as `%`. Each is backslash-escaped so "50%" or "a_b" match
 *      literally instead of matching everything.
 *   2. PostgREST: `,` `(` `)` end or nest a filter, and backslash escapes are
 *      honoured only inside double quotes -- outside them "login, again" splits
 *      the filter in two. So the whole value, wildcards included, is wrapped in
 *      quotes, and the `"` and `\` inside it are escaped for that quoting.
 */
function likePatternValue(term: string): string {
  const literal = term.replace(/[\\%_*]/g, "\\$&");

  return `"%${literal.replace(/["\\]/g, "\\$&")}%"`;
}

type MessageRow = {
  id: string;
  author_type: PortalMessageAuthor;
  author_id: string;
  body: string;
  created_at: string;
};

/**
 * Resolve display names for the people in a thread.
 *
 * Read with the admin client, but only ever `full_name` for ids that already
 * appear in messages this customer is allowed to see. Going through RLS instead
 * would mean relying on `users_select`, which currently lets any tenant member
 * enumerate every other member — the leak that wants closing. Keeping name
 * lookup narrow here means tightening that policy will not break the thread.
 */
async function resolveAuthors(
  tenantId: string,
  rows: MessageRow[],
): Promise<Map<string, string>> {
  const agentIds = [
    ...new Set(
      rows.filter((r) => r.author_type === "agent").map((r) => r.author_id),
    ),
  ];
  const customerIds = [
    ...new Set(
      rows.filter((r) => r.author_type === "customer").map((r) => r.author_id),
    ),
  ];

  const names = new Map<string, string>();

  if (!agentIds.length && !customerIds.length) {
    return names;
  }

  const admin = createSupabaseAdminClient();

  const [agents, customers] = await Promise.all([
    // No email for agents: an agent with a blank name would otherwise have
    // their address shown to the customer. They are "Support" instead.
    agentIds.length
      ? admin.from("users").select("id, full_name").in("id", agentIds)
      : Promise.resolve({ data: [] }),
    customerIds.length
      ? admin
          .from("customers")
          .select("id, full_name, email")
          .eq("tenant_id", tenantId)
          .in("id", customerIds)
      : Promise.resolve({ data: [] }),
  ]);

  for (const row of agents.data ?? []) {
    names.set(row.id, row.full_name || "Support");
  }

  for (const row of customers.data ?? []) {
    names.set(row.id, row.full_name || row.email || "Support");
  }

  return names;
}

/** How long a download link stays good for. Long enough to click, not to share. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

type AttachmentRow = {
  id: string;
  message_id: string | null;
  storage_path: string;
  original_filename: string;
  mime: string;
  size: number;
};

/**
 * Reject a bad attachment set before it costs a signed URL or a written row.
 * Takes descriptors rather than File objects so the same rules apply on the
 * server, where the bytes never arrive.
 */
export function assertPortalAttachments(
  files: { name: string; size: number }[],
): void {
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new PortalError(
      `Attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files at a time.`,
      "validation",
    );
  }

  for (const file of files) {
    const problem = attachmentError(file);

    if (problem) {
      throw new PortalError(problem, "validation");
    }
  }
}

/**
 * Where files uploaded for a request that does not exist yet are parked.
 *
 * The storage path a ticket attachment must end up on is `<tenant>/<ticket>/…`,
 * and on the new-request form there is no ticket id to build it with. Uploading
 * after creating the ticket would mean a filed request whose evidence can still
 * fail, so the bytes go here first and are moved onto the ticket once it exists.
 * Nothing reads from this prefix; it is server-managed and write-once.
 */
const STAGING_SEGMENT = "staging";

/**
 * What the bucket says about a stored object, or null if it is not there.
 * The stored object -- not the client -- is the source of truth for size and
 * type, so a caller that lies about a 4 KB file cannot make a 4 GB one appear
 * in the thread as something small.
 */
async function statStoredObject(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  directory: string,
  filename: string,
): Promise<{ size: number; mime: string } | null> {
  const { data, error } = await admin.storage
    .from(ATTACHMENT_BUCKET)
    .list(directory, { search: filename, limit: 1 });

  const object = data?.find((entry) => entry.name === filename);

  if (error || !object) {
    if (error) {
      console.error("[portal] could not stat an upload:", error.message);
    }

    return null;
  }

  return {
    size: Number(object.metadata?.size ?? 0),
    mime:
      (object.metadata?.mimetype as string | undefined) ||
      "application/octet-stream",
  };
}

/**
 * Split a reported path into the directory and file the caller claims, refusing
 * anything that does not sit directly under `expectedPrefix`.
 */
function splitUploadPath(path: string, expectedPrefix: string): string {
  if (!path.startsWith(expectedPrefix) || path.includes("..")) {
    throw new PortalError("That file could not be attached.", "validation");
  }

  const filename = path.slice(expectedPrefix.length);

  if (!filename || filename.includes("/")) {
    throw new PortalError("That file could not be attached.", "validation");
  }

  return filename;
}

function extensionOf(filename: string): string | null {
  return filename.match(/\.([A-Za-z0-9]{1,12})$/)?.[1]?.toLowerCase() ?? null;
}

/** A randomised basename. Filenames arrive from an untrusted machine, and
 *  `uq_storage_path` makes a collision a hard failure; the name the customer
 *  used is kept in original_filename for display. */
function storedNameFor(originalName: string): string {
  const extension = extensionOf(originalName);

  return `${crypto.randomUUID()}${extension ? `.${extension}` : ""}`;
}

/** Confirm a ticket is this customer's before authorising anything against it. */
async function assertOwnsRequest(
  identity: PortalIdentity,
  requestId: string,
): Promise<void> {
  if (!UUID.test(requestId)) {
    throw new PortalError("We couldn't find that request.", "not_found");
  }

  const supabase = await createSupabaseServerClient();

  const { data: ticket } = await supabase
    .from("tickets")
    .select("id")
    .eq("id", requestId)
    .eq("tenant_id", identity.tenant.id)
    .eq("requester_customer_id", identity.customer.id)
    .maybeSingle();

  if (!ticket) {
    throw new PortalError("We couldn't find that request.", "not_found");
  }
}

/**
 * Mint one signed upload URL per file, under paths the caller decides.
 *
 * Shared by the reply flow (paths under the ticket) and the new-request flow
 * (paths under a staging batch): the two differ only in how a path is built, so
 * the error handling and the response shape live here once. Targets come back
 * in the same order as the files, which is what lets the browser pair a token
 * with the bytes it holds.
 */
async function mintUploadTargets(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  files: { name: string; size: number; type?: string }[],
  pathFor: (file: { name: string; size: number; type?: string }) => string,
): Promise<PortalUploadTarget[]> {
  const targets: PortalUploadTarget[] = [];

  for (const file of files) {
    const path = pathFor(file);

    const { data, error } = await admin.storage
      .from(ATTACHMENT_BUCKET)
      .createSignedUploadUrl(path);

    if (error || !data) {
      console.error(
        "[portal] could not authorise an upload:",
        error?.message ?? "no token returned",
      );

      throw new PortalError(
        "We couldn't start that upload. Try again in a moment.",
        "unknown",
      );
    }

    targets.push({
      path,
      token: data.token,
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
    });
  }

  return targets;
}

export async function createPortalUploadTargets(
  identity: PortalIdentity,
  requestId: string,
  files: { name: string; size: number; type?: string }[],
): Promise<PortalUploadTarget[]> {
  if (files.length === 0) {
    return [];
  }

  assertPortalAttachments(files);
  await assertOwnsRequest(identity, requestId);

  return mintUploadTargets(
    createSupabaseAdminClient(),
    files,
    (file) => `${identity.tenant.id}/${requestId}/${storedNameFor(file.name)}`,
  );
}

/**
 * Record files the browser has already put in the bucket.
 *
 * Every field the client sends is re-derived or re-checked here: the path must
 * sit under this tenant and ticket, and the size and mime are read back off the
 * stored object rather than trusted, so a client that lies about a 4 KB file
 * cannot make a 4 GB one appear in the thread as something small.
 */
export async function recordPortalAttachments(params: {
  identity: PortalIdentity;
  ticketId: string;
  messageId: string | null;
  uploads: PortalUploadedFile[];
}): Promise<void> {
  const { identity, ticketId, messageId, uploads } = params;

  if (uploads.length === 0) {
    return;
  }

  if (uploads.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new PortalError(
      `Attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files at a time.`,
      "validation",
    );
  }

  const directory = `${identity.tenant.id}/${ticketId}`;
  const admin = createSupabaseAdminClient();

  // Both failure paths below delete what the client named, with the admin
  // client. So before anything else, every path must be one nobody has filed
  // yet: a path already on an attachments row is somebody's real file (an
  // agent's, say), and naming it here used to collide on uq_storage_path and
  // then delete the original in the cleanup. The same path twice in one call
  // does the same to itself.
  const paths = uploads.map((upload) => upload.path);

  if (new Set(paths).size !== paths.length) {
    throw new PortalError("That file could not be attached.", "validation");
  }

  const { data: taken, error: takenError } = await admin
    .from("attachments")
    .select("storage_path")
    .in("storage_path", paths)
    .limit(1);

  if (takenError) {
    console.error(
      "[portal] attachment path check failed:",
      dbError(takenError),
    );

    throw new PortalError(
      "We couldn't attach those files. Try again in a moment.",
      "unknown",
    );
  }

  if (taken && taken.length > 0) {
    throw new PortalError("That file could not be attached.", "validation");
  }

  const rows = [];

  for (const upload of uploads) {
    const filename = splitUploadPath(upload.path, `${directory}/`);
    const stored = await statStoredObject(admin, directory, filename);

    if (!stored) {
      throw new PortalError(
        `We couldn't attach ${upload.name}. Try again in a moment.`,
        "unknown",
      );
    }

    const problem = attachmentError({ name: upload.name, size: stored.size });

    if (problem) {
      await admin.storage.from(ATTACHMENT_BUCKET).remove([upload.path]);

      throw new PortalError(problem, "validation");
    }

    rows.push({
      tenant_id: identity.tenant.id,
      ticket_id: ticketId,
      message_id: messageId,
      storage_path: upload.path,
      filename,
      original_filename: upload.name,
      mime: stored.mime,
      extension: extensionOf(filename),
      size: stored.size,
      uploaded_by: identity.userId,
    });
  }

  const { error } = await admin.from("attachments").insert(rows);

  if (error) {
    console.error("[portal] attachment rows insert failed:", dbError(error));

    // The objects are in the bucket and nothing will reference them. Only
    // unclaimed paths reach here (checked above), so this removes the caller's
    // own fresh uploads and nothing that belongs to a filed attachment -- unless
    // the insert lost a race for the same path, which is why 23505 is excluded.
    const { error: cleanupError } =
      error.code === "23505"
        ? { error: null }
        : await admin.storage.from(ATTACHMENT_BUCKET).remove(paths);

    if (cleanupError) {
      console.error(
        "[portal] could not clean up unreferenced uploads:",
        cleanupError.message,
      );
    }

    throw new PortalError(
      "We couldn't attach those files. Try again in a moment.",
      "unknown",
    );
  }
}

/**
 * Authorise uploads for a request that has not been created yet.
 *
 * Reachable without a session, because "you don't need an account to reach us"
 * is a supported way in. There is nothing to check ownership against at this
 * point, so the paths are server-minted under a random batch id and are
 * useless to anyone who cannot guess it: nothing reads from the staging prefix,
 * and only attachStagedUploads can move a file out of it.
 */
export async function createPortalStagingTargets(
  slug: string,
  files: { name: string; size: number; type?: string }[],
): Promise<PortalUploadTarget[]> {
  if (files.length === 0) {
    return [];
  }

  assertPortalAttachments(files);

  const tenant = await getPortalTenant(slug);

  if (!tenant) {
    throw new PortalError(
      "That support portal doesn't exist.",
      "tenant_not_found",
    );
  }

  const admin = createSupabaseAdminClient();
  const batch = crypto.randomUUID();

  return mintUploadTargets(
    admin,
    files,
    (file) =>
      `${tenant.id}/${STAGING_SEGMENT}/${batch}/${storedNameFor(file.name)}`,
  );
}

/**
 * Delete uploads the browser put in the bucket but never got to file.
 *
 * The browser uploads first and files second, so a failure in between -- one
 * of several uploads failing, or the request or reply then being refused --
 * leaves objects nothing references. The browser cannot delete them itself
 * (guests have no session, and the storage policies keep delete to staff), so
 * it reports the paths here.
 *
 * Only paths that could be the caller's own fresh uploads are touched: under
 * this tenant's staging prefix (random batch ids, so only whoever was handed
 * one can name it), or directly under a ticket the signed-in customer owns.
 * Anything already on an attachments row is a filed file and is skipped, so
 * this can never remove something that is in a thread. Best effort, and
 * silent: the daily sweep is the backstop for staging.
 */
export async function discardPortalUploads(params: {
  slug: string;
  paths: string[];
  identity: PortalIdentity | null;
  requestId?: string;
}): Promise<void> {
  const { slug, paths, identity, requestId } = params;

  if (paths.length === 0) {
    return;
  }

  const tenant = await getPortalTenant(slug);

  if (!tenant) {
    return;
  }

  const stagingPrefix = `${tenant.id}/${STAGING_SEGMENT}/`;
  let ticketPrefix: string | null = null;

  if (requestId && identity && identity.tenant.id === tenant.id) {
    try {
      await assertOwnsRequest(identity, requestId);
      ticketPrefix = `${tenant.id}/${requestId}/`;
    } catch {
      ticketPrefix = null;
    }
  }

  const candidates = paths.filter((path) => {
    if (path.includes("..")) return false;

    if (path.startsWith(stagingPrefix)) {
      return path.slice(stagingPrefix.length).split("/").length === 2;
    }

    if (ticketPrefix && path.startsWith(ticketPrefix)) {
      const rest = path.slice(ticketPrefix.length);
      return rest.length > 0 && !rest.includes("/");
    }

    return false;
  });

  if (candidates.length === 0) {
    return;
  }

  const admin = createSupabaseAdminClient();

  const { data: filed, error: filedError } = await admin
    .from("attachments")
    .select("storage_path")
    .in("storage_path", candidates);

  if (filedError) {
    console.error("[portal] discard check failed:", dbError(filedError));
    return;
  }

  const keep = new Set((filed ?? []).map((row) => row.storage_path as string));
  const orphans = candidates.filter((path) => !keep.has(path));

  if (orphans.length === 0) {
    return;
  }

  const { error } = await admin.storage.from(ATTACHMENT_BUCKET).remove(orphans);

  if (error) {
    console.error("[portal] could not discard unfiled uploads:", error.message);
  }
}

/**
 * Move staged uploads onto a ticket and record them.
 *
 * Throws if anything goes wrong, leaving the caller to withdraw the ticket --
 * a request whose evidence never arrived is worse than no request, because the
 * customer resends it and support gets it twice.
 */
async function attachStagedUploads(params: {
  tenantId: string;
  ticketId: string;
  uploadedBy: string | null;
  uploads: PortalUploadedFile[];
}): Promise<void> {
  const { tenantId, ticketId, uploadedBy, uploads } = params;

  if (uploads.length === 0) {
    return;
  }

  if (uploads.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new PortalError(
      `Attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files at a time.`,
      "validation",
    );
  }

  const admin = createSupabaseAdminClient();
  const stagingPrefix = `${tenantId}/${STAGING_SEGMENT}/`;
  const destination = `${tenantId}/${ticketId}`;

  const rows = [];
  const moved: string[] = [];

  async function unwind() {
    if (moved.length === 0) return;

    const { error } = await admin.storage.from(ATTACHMENT_BUCKET).remove(moved);

    if (error) {
      console.error(
        "[portal] could not clean up moved uploads:",
        error.message,
      );
    }
  }

  for (const upload of uploads) {
    // `<batch>/<file>` -- one level deeper than a ticket path, so the filename
    // is taken off the end rather than through splitUploadPath.
    const relative = upload.path.slice(stagingPrefix.length);

    if (
      !upload.path.startsWith(stagingPrefix) ||
      upload.path.includes("..") ||
      relative.split("/").length !== 2
    ) {
      await unwind();

      throw new PortalError("That file could not be attached.", "validation");
    }

    const [batch, stagedName] = relative.split("/");
    const stored = await statStoredObject(
      admin,
      `${tenantId}/${STAGING_SEGMENT}/${batch}`,
      stagedName,
    );

    if (!stored) {
      await unwind();

      throw new PortalError(
        `We couldn't attach ${upload.name}. Try again in a moment.`,
        "unknown",
      );
    }

    const problem = attachmentError({ name: upload.name, size: stored.size });

    if (problem) {
      await unwind();

      throw new PortalError(problem, "validation");
    }

    const finalPath = `${destination}/${stagedName}`;

    const { error: moveError } = await admin.storage
      .from(ATTACHMENT_BUCKET)
      .move(upload.path, finalPath);

    if (moveError) {
      console.error(
        "[portal] could not move a staged upload:",
        moveError.message,
      );
      await unwind();

      throw new PortalError(
        `We couldn't attach ${upload.name}. Try again in a moment.`,
        "unknown",
      );
    }

    moved.push(finalPath);

    rows.push({
      tenant_id: tenantId,
      ticket_id: ticketId,
      // The opening post is tickets.description, not a ticket_messages row, so
      // these hang off the ticket. getPortalRequest reunites them with the
      // synthesised opening message.
      message_id: null,
      storage_path: finalPath,
      filename: stagedName,
      original_filename: upload.name,
      mime: stored.mime,
      extension: extensionOf(stagedName),
      size: stored.size,
      uploaded_by: uploadedBy,
    });
  }

  const { error } = await admin.from("attachments").insert(rows);

  if (error) {
    console.error("[portal] attachment rows insert failed:", dbError(error));
    await unwind();

    throw new PortalError(
      "We couldn't attach those files. Try again in a moment.",
      "unknown",
    );
  }
}

/**
 * Every attachment on a ticket, grouped by the message it belongs to. The
 * empty-string key holds the ones stored against the ticket itself, which is
 * where the opening post's files live -- portal_create_request writes no
 * ticket_messages row, so there is no id to hang them off.
 */
async function readPortalAttachments(
  ticketId: string,
  visible: { publicMessageIds: Set<string>; userId: string },
): Promise<Map<string, PortalAttachment[]>> {
  const grouped = new Map<string, PortalAttachment[]>();
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("attachments")
    .select(
      "id, message_id, storage_path, original_filename, mime, size, uploaded_by",
    )
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[portal] attachment lookup failed:", dbError(error));
    return grouped;
  }

  // The admin client sees every file on the ticket, internal notes included,
  // and anything that reaches the signing step below becomes a working link. So
  // only two kinds get that far: files on a public message the customer can
  // already read, and the opening post's files (no message) that this customer
  // uploaded -- or a guest did, before the account existed (uploaded_by null).
  // A file a team member hangs off the ticket itself is not the customer's.
  const rows = (
    (data ?? []) as (AttachmentRow & {
      uploaded_by: string | null;
    })[]
  ).filter((row) =>
    row.message_id
      ? visible.publicMessageIds.has(row.message_id)
      : row.uploaded_by === null || row.uploaded_by === visible.userId,
  );

  if (rows.length === 0) {
    return grouped;
  }

  // Signed one at a time, not as a batch, so each link can carry its own
  // `download` name: a batch takes a single download option and would rename
  // every file in the thread to the same thing (or to the random storage
  // basename). `download` is what sets Content-Disposition: attachment, so the
  // browser saves an uploaded .html or .svg instead of rendering it -- the click
  // is a download button, and it should behave like one on every file type.
  const urls = new Map<string, string>();

  await Promise.all(
    rows.map(async (row) => {
      const { data: signed, error: signError } = await admin.storage
        .from(ATTACHMENT_BUCKET)
        .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS, {
          download: row.original_filename,
        });

      if (signError || !signed?.signedUrl) {
        console.error(
          "[portal] could not sign attachment:",
          signError?.message,
        );
        return;
      }

      urls.set(row.storage_path, signed.signedUrl);
    }),
  );

  for (const row of rows) {
    const key = row.message_id ?? "";
    const list = grouped.get(key) ?? [];

    list.push({
      id: row.id,
      name: row.original_filename,
      size: row.size,
      mime: row.mime,
      url: urls.get(row.storage_path) ?? null,
    });

    grouped.set(key, list);
  }

  return grouped;
}

/**
 * Cached per request: the detail page's generateMetadata and the page itself
 * both need it, and each load is several round trips plus a signed URL per
 * attachment. Keyed on the identity object, which getPortalIdentity's own
 * cache() hands back unchanged within the request.
 */
export const getPortalRequest = cache(async function getPortalRequest(
  identity: PortalIdentity,
  requestId: string,
): Promise<PortalRequestDetail | null> {
  if (!UUID.test(requestId)) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  // Ownership is enforced by tickets_select, but naming it here keeps the
  // query honest and turns a wrong id into a 404 rather than an empty page.
  const { data: ticket, error } = await supabase
    .from("tickets")
    .select(
      "id, number, subject, description, status, priority, created_at, updated_at, resolved_at",
    )
    .eq("id", requestId)
    .eq("tenant_id", identity.tenant.id)
    .eq("requester_customer_id", identity.customer.id)
    .maybeSingle();

  if (error) {
    console.error("[portal] request lookup failed:", error.message);
    return null;
  }

  if (!ticket) {
    return null;
  }

  const { data: rows, error: messagesError } = await supabase
    .from("ticket_messages")
    .select("id, author_type, author_id, body, created_at")
    .eq("ticket_id", requestId)
    .eq("visibility", "public")
    .order("created_at", { ascending: true });

  if (messagesError) {
    console.error("[portal] thread lookup failed:", messagesError.message);
  }

  const messageRows = (rows ?? []) as MessageRow[];

  const [names, attachments] = await Promise.all([
    resolveAuthors(identity.tenant.id, messageRows),
    readPortalAttachments(ticket.id, {
      publicMessageIds: new Set(messageRows.map((row) => row.id)),
      userId: identity.userId,
    }),
  ]);

  // The rating is looked up for THIS resolution, not for the ticket. A request
  // that was rated, reopened and resolved again has a new resolved_at and so
  // no rating yet — which is exactly when the prompt should come back.
  const csat = await readCsat(
    supabase,
    ticket.id,
    ticket.resolved_at,
    ticket.status as PortalTicketStatus,
  );

  // The opening post is `tickets.description`, not a ticket_messages row --
  // that is the convention the agent side already uses, and portal_create_request
  // writes no message. Synthesising it here keeps both sides reading the same
  // ticket rather than backfilling rows nobody else expects.
  const opening: PortalMessage = {
    id: `${ticket.id}:description`,
    authorType: "customer",
    authorName: identity.customer.fullName,
    initials: identity.customer.initials,
    body: ticket.description,
    createdAt: ticket.created_at,
    isMine: true,
    // Files sent with the request itself: stored against the ticket with no
    // message_id, because the opening post is not a ticket_messages row.
    attachments: attachments.get("") ?? [],
  };

  const messages: PortalMessage[] = [
    opening,
    ...messageRows.map((row) => {
      const authorName =
        row.author_type === "system"
          ? "System"
          : (names.get(row.author_id) ?? "Support");

      return {
        id: row.id,
        authorType: row.author_type,
        authorName,
        initials: initialsFrom(authorName, ""),
        body: row.body,
        createdAt: row.created_at,
        isMine:
          row.author_type === "customer" &&
          row.author_id === identity.customer.id,
        attachments: attachments.get(row.id) ?? [],
      };
    }),
  ];

  const status = ticket.status as PortalTicketStatus;

  return {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    description: ticket.description,
    status,
    priority: ticket.priority as PortalPriority,
    state: toPortalState(status),
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    resolvedAt: ticket.resolved_at,
    messages,
    csat,
  };
});

type RlsClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function readCsat(
  supabase: RlsClient,
  ticketId: string,
  resolvedAt: string | null,
  status: PortalTicketStatus,
): Promise<PortalCsat> {
  const ratable = status === "resolved" && Boolean(resolvedAt);

  if (!ratable) {
    return { score: null, comment: null, isOwed: false, resolvedAt: null };
  }

  const { data, error } = await supabase
    .from("csat_ratings")
    .select("score, comment")
    .eq("ticket_id", ticketId)
    .eq("resolved_at", resolvedAt)
    .maybeSingle();

  if (error) {
    // A lookup that failed is not the same as "not rated yet". Falling through
    // to isOwed here raises the star prompt on top of a table we could not
    // read, so the customer only discovers the problem after picking a score --
    // which is exactly how an unpushed csat_ratings migration presented.
    console.error("[portal] csat lookup failed:", dbError(error));

    return { score: null, comment: null, isOwed: false, resolvedAt };
  }

  return {
    score: (data?.score as CsatScore | undefined) ?? null,
    comment: data?.comment ?? null,
    isOwed: !data,
    resolvedAt,
  };
}

/**
 * Record a rating for the resolution the request is currently in.
 *
 * Through the RLS client: csat_ratings_insert is what ties the row to a real
 * resolution (`t.resolved_at = csat_ratings.resolved_at`) and to the requester.
 * The unique constraint on (ticket_id, resolved_at) is what enforces
 * "once per resolution" even against a double submit.
 */
export async function submitPortalCsat(
  identity: PortalIdentity,
  requestId: string,
  score: number,
  comment?: string,
): Promise<void> {
  if (!UUID.test(requestId)) {
    throw new PortalError("We couldn't find that request.", "not_found");
  }

  const supabase = await createSupabaseServerClient();

  const { data: ticket } = await supabase
    .from("tickets")
    .select("id, status, resolved_at")
    .eq("id", requestId)
    .eq("tenant_id", identity.tenant.id)
    .eq("requester_customer_id", identity.customer.id)
    .maybeSingle();

  if (!ticket || ticket.status !== "resolved" || !ticket.resolved_at) {
    throw new PortalError(
      "That request isn't resolved, so there's nothing to rate yet.",
      "not_found",
    );
  }

  const { error } = await supabase.from("csat_ratings").insert({
    tenant_id: identity.tenant.id,
    ticket_id: requestId,
    customer_id: identity.customer.id,
    // agent_user_id deliberately absent: csat_ratings_guard snapshots it from the
    // ticket in the database. Sending the assignee from here made it a claim
    // rather than a snapshot -- a customer could have named any engineer -- and
    // it would have been overwritten anyway.
    score,
    comment: comment?.trim() || null,
    resolved_at: ticket.resolved_at,
  });

  if (error) {
    // 23505 is uq_csat_per_resolution: this resolution is already rated.
    if (error.code === "23505") {
      throw new PortalError(
        "You've already rated this one. Thank you.",
        "validation",
      );
    }

    console.error("[portal] csat insert failed:", dbError(error));

    // PGRST205: csat_ratings is not in the schema cache, i.e. the migration has
    // not been pushed to this project. 42501: the insert policy refused the
    // row. Neither improves by waiting, so do not tell the customer to retry.
    if (error.code === "PGRST205" || error.code === "42501") {
      throw new PortalError(
        "Ratings aren't available on this workspace yet. Nothing you did - the team has been notified.",
        "unknown",
      );
    }

    throw new PortalError(
      "We couldn't save that rating. Try again in a moment.",
      "unknown",
    );
  }
}

/**
 * Post a customer reply.
 *
 * Written through the RLS client on purpose: ticket_messages_insert is what
 * guarantees author_type, visibility and ownership, and routing this through
 * the admin client would quietly discard that guarantee.
 */
export async function postPortalReply(
  identity: PortalIdentity,
  requestId: string,
  body: string,
  uploads: PortalUploadedFile[] = [],
): Promise<void> {
  if (!UUID.test(requestId)) {
    throw new PortalError("We couldn't find that request.", "not_found");
  }

  const supabase = await createSupabaseServerClient();

  // Existence only: the message insert below is what RLS actually authorises,
  // and a customer cannot see a ticket that is not theirs, so this cannot be
  // bypassed by asking for somebody else's id.
  const { data: ticket } = await supabase
    .from("tickets")
    .select("id")
    .eq("id", requestId)
    .eq("tenant_id", identity.tenant.id)
    .eq("requester_customer_id", identity.customer.id)
    .maybeSingle();

  if (!ticket) {
    throw new PortalError("We couldn't find that request.", "not_found");
  }

  const { data: message, error } = await supabase
    .from("ticket_messages")
    .insert({
      tenant_id: identity.tenant.id,
      ticket_id: requestId,
      author_type: "customer",
      author_id: identity.customer.id,
      body: body.trim(),
      visibility: "public",
    })
    .select("id")
    .single();

  if (error || !message) {
    console.error(
      "[portal] reply insert failed:",
      error ? error.message : "insert returned no row",
    );

    throw new PortalError(
      "We couldn't post that reply. Try again in a moment.",
      "unknown",
    );
  }

  if (uploads.length > 0) {
    try {
      await recordPortalAttachments({
        identity,
        ticketId: requestId,
        messageId: message.id,
        uploads,
      });
    } catch (uploadFailure) {
      // Take the reply back down with the files. A message that posted without
      // the screenshot it refers to reads as sent to the agent and reads as
      // failed to the customer, who then sends it again -- so the thread ends
      // up with the duplicate rather than the truth.
      const { error: cleanupError } = await createSupabaseAdminClient()
        .from("ticket_messages")
        .delete()
        .eq("id", message.id);

      if (cleanupError) {
        console.error(
          "[portal] could not roll back a reply whose files failed:",
          cleanupError.message,
        );
      }

      throw uploadFailure;
    }
  }

  // A reply from the requester puts the ball back in the team's court, but only
  // from the statuses that mean the team was waiting on them. Which those are is
  // the function's decision, not this file's: a resolved request stays resolved
  // when it is replied to, because reopening one is a separate, explicit action.
  //
  // Through the RPC rather than an update on `tickets` because the customer
  // cannot write that table: tickets_update is staff-only, and it has to be --
  // the policy could scope the rows a customer reached but not the columns, so
  // the alternative was a customer setting their own priority and assignee. This
  // is the write that branch used to stand in for.
  const { error: statusError } = await createSupabaseAdminClient().rpc(
    "portal_reply_bumps_status",
    { p_ticket: requestId, p_user_id: identity.userId },
  );

  if (statusError) {
    // The reply is posted and visible to both sides; only the queue placement is
    // stale. Failing the whole action here would show the customer an error for
    // something that did happen.
    console.error("[portal] status bump failed:", statusError.message);
  }
}

export async function reopenPortalRequest(
  identity: PortalIdentity,
  requestId: string,
): Promise<void> {
  if (!UUID.test(requestId)) {
    throw new PortalError("We couldn't find that request.", "not_found");
  }

  // SECURITY DEFINER for the same reason as the reply bump: the customer cannot
  // write tickets.resolved_at or closed_at through RLS, and no policy could let
  // them without also letting them set status and priority.
  const { data: reopened, error } = await createSupabaseAdminClient().rpc(
    "portal_reopen_ticket",
    {
      p_ticket: requestId,
      p_user_id: identity.userId,
    },
  );

  if (error) {
    console.error("[portal] reopen failed:", error.message);

    throw new PortalError(
      "We couldn't reopen that request. Try again in a moment.",
      "unknown",
    );
  }

  // The function returns how many tickets it reopened. Zero means the request is
  // not this customer's, or is no longer resolved/closed (a stale page, or the
  // team already reopened it) -- not a success to report.
  if (Number(reopened ?? 0) === 0) {
    throw new PortalError(
      "That request isn't resolved any more, so there's nothing to reopen. Refresh to see where it stands.",
      "not_found",
    );
  }
}
