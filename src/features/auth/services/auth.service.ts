import "server-only";

import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/config/env";
import type { LoginValues } from "@/features/auth/schemas/login";
import type { AuthFailureCode, SessionUser } from "@/features/auth/types";
import {
  getTenantContext,
  getTenantSlugById,
  getTenantIdBySlug,
} from "@/features/tenancy/services/tenant-resolver";
import {
  defaultTenantLanding,
  isTrustedHost,
  isTenantRouteAllowed,
  isValidTenantSlug,
  landingUrlForSlug,
  stripTenantPrefix,
  TENANT_ROUTES,
  tenantPath,
} from "@/lib/tenancy";
import { APP_ROUTES } from "@/lib/routes";
import { EMPTY_TENANT_CLAIMS, getTenantClaims } from "../claims";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ForgotPasswordValues } from "../schemas/forgot-password";
import {
  LINK_ACTION_PARAM,
  LINK_ACTIONS,
  updatePasswordSchema,
  type UpdatePasswordValues,
} from "../schemas/reset-password";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requestClientInfo } from "@/lib/request-context";
import { enqueueEmail } from "@/lib/email/email-queue";

export class AuthError extends Error {
  readonly status: number;
  readonly code: AuthFailureCode;

  constructor(
    message: string,
    { status = 400, code = "unknown" as AuthFailureCode } = {},
  ) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

function toFailureCode(code: string | undefined): AuthFailureCode {
  switch (code) {
    case "invalid_credentials":
      return "invalid_credentials";
    case "email_not_confirmed":
      return "email_not_confirmed";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "rate_limited";
    default:
      return "unknown";
  }
}

export async function login({
  email,
  password,
  remember,
}: LoginValues): Promise<SessionUser> {
  const supabase = await createSupabaseServerClient({
    remember,
  });

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    if (error?.code === "invalid_credentials") {
      await recordFailedLogin(email);
    }

    throw new AuthError(error?.message ?? "Invalid login credentials", {
      status: error?.status ?? 400,
      code: toFailureCode(error?.code),
    });
  }

  const claims = await getTenantClaims(supabase);

  if (!claims) {
    throw new Error("Unable to verify authentication session");
  }

  const { tenantId, tenantSlug } = claims;

  await verifyHostTenancy(supabase, tenantId);
  if (tenantId) {
    await recordAuthEvent(supabase, {
      action: "login",
      tenantId,
      userId: data.user.id,
      email: data.user.email ?? email,
    });
  }
  return {
    id: data.user.id,
    email: data.user.email ?? email,
    tenantId,
    tenantSlug,
    role: claims.tenantRole,
  };
}

export async function googleLogin({
  next = TENANT_ROUTES.TICKETS,
  tenantSlug,
}: { next?: string; tenantSlug?: string | null } = {}) {
  const supabase = await createSupabaseServerClient();
  const origin = await requestOrigin();

  const slug = isValidTenantSlug(tenantSlug) ? tenantSlug : null;

  const safePath = safeNext(next);
  const parsed = stripTenantPrefix(safePath);
  const destination = slug
    ? tenantPath(slug, parsed ? parsed.rest : safePath)
    : safePath;

  const redirectTo = new URL(
    `${APP_ROUTES.AUTH_CALLBACK}?next=${encodeURIComponent(destination)}`,
    origin,
  ).toString();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error || !data.url) {
    throw new AuthError("We couldn't reach Google. Try again in a moment.", {
      status: error?.status ?? 502,
      code: toFailureCode(error?.code),
    });
  }

  return { url: data.url };
}

export async function exchangeOAuthCode(code: string): Promise<SessionUser> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    console.error(`[auth] code exchange failed: ${error?.message}`);

    throw new AuthError("That sign-in link has expired. Try again.", {
      status: error?.status ?? 400,
      code: toFailureCode(error?.code),
    });
  }

  const claims = (await getTenantClaims(supabase)) ?? EMPTY_TENANT_CLAIMS;

  const tenantId = claims.tenantId;

  const tenantSlug =
    claims.tenantSlug ?? (tenantId ? await getTenantSlugById(tenantId) : null);

  await verifyHostTenancy(supabase, tenantId);
  if (tenantId) {
    await recordAuthEvent(supabase, {
      action: "login",
      tenantId,
      userId: data.user.id,
      email: data.user.email ?? "",
    });
  }
  return {
    id: data.user.id,
    email: data.user.email ?? "",
    tenantSlug,
    tenantId,
    role: claims.tenantRole,
  };
}

export async function resolvePostAuthUrl(
  tenantId: string | null,
  role: string | null,
  next?: string | null,
): Promise<string | null> {
  if (!tenantId) {
    return null;
  }

  const slug = await getTenantSlugById(tenantId);
  if (!slug) {
    return null;
  }

  const rawNext = safeNext(next);
  const parsed = stripTenantPrefix(rawNext);
  let target = parsed ? parsed.rest : rawNext;

  if (!isTenantRouteAllowed(role, target)) {
    target = defaultTenantLanding(role);
  }

  if (target === "/") {
    target = defaultTenantLanding(role);
  }

  return landingUrlForSlug(slug, target);
}

export function safeNext(
  next: string | null | undefined,
  fallback = "/tickets",
): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return fallback;
  }
  return next;
}

function isLoopbackHost(host: string | null): host is string {
  return Boolean(host && /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host));
}

export async function requestOrigin(): Promise<string> {
  const configured = new URL(env.NEXT_PUBLIC_SITE_URL);
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");

  // `next dev` with a production NEXT_PUBLIC_SITE_URL would otherwise mint
  // links to production -- and the PKCE verifier cookie lives on localhost, so
  // the code could never be exchanged there. Dev only: in production a
  // localhost Host header is exactly the spoof the allow-list exists to stop.
  if (process.env.NODE_ENV === "development" && isLoopbackHost(host)) {
    return `http://${host}`;
  }

  if (!isTrustedHost(host, env.NEXT_PUBLIC_SITE_URL)) {
    if (host) {
      console.warn(`[auth] ignoring untrusted host header: ${host}`);
    }
    return configured.origin;
  }

  const forwardedProto = requestHeaders.get("x-forwarded-proto");
  const scheme =
    forwardedProto?.split(",")[0]?.trim() ??
    configured.protocol.replace(":", "");

  return `${scheme}://${host}`;
}

async function verifyHostTenancy(
  supabase: SupabaseClient,
  tenantId: string | null,
): Promise<void> {
  const context = await getTenantContext();

  if (!context) {
    return;
  }

  if (tenantId !== context.id) {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error(
        `[auth] failed to revoke cross-tenant session: ${error.message}`,
      );
    }

    throw new AuthError(
      `You don't have access to the ${context.name} workspace.`,
      {
        status: 403,
        code: "no_workspace_access",
      },
    );
  }
}

export async function logout(): Promise<void> {
  const supabase = await createSupabaseServerClient();

  await recordLogoutAttempt(supabase);

  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new AuthError("We couldn't sign you out. Try again in a moment.", {
      status: error.status ?? 500,
      code: toFailureCode(error.code),
    });
  }
}

type PasswordResetResult = {
  success: boolean;
  error?: string;
  /** Never set now: sending is queued, and the queue retries a Supabase 429. */
  isRateLimited?: boolean;
};

export async function sendPasswordResetLink(
  payload: ForgotPasswordValues,
): Promise<PasswordResetResult> {
  const { email } = payload;

  try {
    const supabase = createSupabaseAdminClient();
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (!user) {
      return { success: true };
    }

    // Same rule as the tenant flow below: a revoked invitee or removed member
    // keeps their login, so without this they could still mail themselves a
    // link and set a password. Same silent success as an unknown address.
    if (!(await hasUsableMembership(user.id))) {
      return { success: true };
    }

    const redirectTo = `${
      process.env.NEXT_PUBLIC_SITE_URL || ""
    }/reset-password`;

    // Queued: the form answers without waiting on Supabase's auth API. A
    // Supabase rate limit (429) is retried by the queue with a backoff; the
    // per-IP limit in resetPasswordAction still turns away repeat requests.
    await enqueueEmail(
      "password_reset",
      { email, redirectTo },
      { dedupeKey: `reset:${email.trim().toLowerCase()}` },
    );

    return { success: true };
  } catch (err) {
    console.error("[SUPABASE_RESET_PASSWORD_ERROR]:", err);
    return {
      success: false,
      error: "An unexpected error occurred. Please try again later.",
    };
  }
}

export async function sendTenantPasswordResetLink(
  payload: ForgotPasswordValues,
  slug: string,
): Promise<PasswordResetResult> {
  const { email } = payload;

  try {
    const supabase = createSupabaseAdminClient();
    const origin = await requestOrigin();
    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();

    if (!user) {
      return { success: true };
    }

    // Revoking an invite or removing a member deletes the membership but not
    // the login, so without this a revoked invitee could still mail themselves
    // a link and set a password. Same silent success as an unknown address,
    // so the form never reveals who was removed.
    const tenantId = await getTenantIdBySlug(slug);
    const access = tenantId
      ? await getTenantMembershipAccess(user.id, tenantId)
      : "no-membership";

    if (access !== "allowed") {
      return { success: true };
    }

    const redirectTo = `${origin}${tenantPath(
      slug,
      TENANT_ROUTES.RESET_PASSWORD,
    )}?${LINK_ACTION_PARAM}=${LINK_ACTIONS.RESET}`;

    // Queued, like sendPasswordResetLink above.
    await enqueueEmail(
      "password_reset",
      { email, redirectTo },
      {
        tenantId: tenantId ?? undefined,
        dedupeKey: `reset:${email.trim().toLowerCase()}`,
      },
    );

    return { success: true };
  } catch (err) {
    console.error("[SUPABASE_RESET_PASSWORD_ERROR]:", err);
    return {
      success: false,
      error: "An unexpected error occurred. Please try again later.",
    };
  }
}

export async function updatePassword(values: UpdatePasswordValues) {
  const validatedFields = updatePasswordSchema.safeParse(values);

  if (!validatedFields.success) {
    return {
      success: false,
      error: "Invalid password fields.",
    };
  }

  const access = await checkPasswordAccess().catch((error) => {
    console.error("[auth] checkPasswordAccess failed", error);
    return {
      success: false as const,
      error: "We couldn't update your password. Try again in a moment.",
    };
  });

  if (!access.success) {
    return { success: false, error: access.error };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.auth.updateUser({
    password: validatedFields.data.password,
  });

  if (error) {
    return {
      success: false,
      error: error.message,
    };
  }

  return { success: true };
}

type TenantMembershipAccess = "allowed" | "no-membership" | "disabled";

/**
 * Whether this user may still set a password for this workspace. An invited
 * or active membership may; a disabled one, or none at all (a revoked invite
 * or a removed member), may not.
 *
 * Read with the admin client: the user may have no readable membership left,
 * and "no row" has to mean revoked, not "RLS hid it".
 */
async function getTenantMembershipAccess(
  userId: string,
  tenantId: string,
): Promise<TenantMembershipAccess> {
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin
    .from("memberships")
    .select("status")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle<{ status: string }>();

  if (error) {
    // Fail closed: a password must not be set on a lookup we couldn't make.
    console.error("[auth] membership lookup failed:", error.message);
    throw error;
  }

  if (!data) {
    return "no-membership";
  }

  return data.status === "disabled" ? "disabled" : "allowed";
}

/**
 * Whether this user still belongs to any workspace (invited or active). The
 * central reset page has no workspace in its URL, so this is its version of
 * getTenantMembershipAccess. Fails closed, like that one.
 */
async function hasUsableMembership(userId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();

  const { count, error } = await admin
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("status", "disabled");

  if (error) {
    console.error("[auth] membership lookup failed:", error.message);
    throw error;
  }

  return Boolean(count);
}

const EXPIRED_LINK_MESSAGE =
  "Email links work once and expire after an hour, so this one has either been used or run out. Request a new link and open it from the newest email.";

const TENANT_ACCESS_MESSAGES: Record<
  Exclude<TenantMembershipAccess, "allowed">,
  string
> = {
  "no-membership":
    "You no longer have access to this workspace. If you were invited, the invitation was revoked. Ask your workspace admin to invite you again.",
  disabled:
    "Your access to this workspace has been turned off. Contact your workspace admin to have it turned back on.",
};

export type TenantPasswordAccessResult =
  | { success: true }
  | {
      success: false;
      error: string;
      /** expired / no-access end the page; retry keeps the form open. */
      reason: "expired" | "no-access" | "retry";
    };

/**
 * Run before the reset page shows its form and again before the password is
 * saved. The link's session is valid on its own -- it's Supabase's, not ours
 * -- so without this a revoked invitee's old link still set a password.
 *
 * A denied session is signed out on the way, so the leftover login can't be
 * used anywhere else either.
 */
export async function checkTenantPasswordAccess(
  tenantSlug: string,
): Promise<TenantPasswordAccessResult> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { success: false, error: EXPIRED_LINK_MESSAGE, reason: "expired" };
  }

  const tenantId = await getTenantIdBySlug(tenantSlug);
  const access = tenantId
    ? await getTenantMembershipAccess(user.id, tenantId)
    : "no-membership";

  if (access !== "allowed") {
    await supabase.auth.signOut();
    return {
      success: false,
      error: TENANT_ACCESS_MESSAGES[access],
      reason: "no-access",
    };
  }

  return { success: true };
}

/**
 * The central reset page's version of checkTenantPasswordAccess: the link's
 * session must belong to someone who still has a workspace. A denied session
 * is signed out on the way.
 */
export async function checkPasswordAccess(): Promise<TenantPasswordAccessResult> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { success: false, error: EXPIRED_LINK_MESSAGE, reason: "expired" };
  }

  if (!(await hasUsableMembership(user.id))) {
    await supabase.auth.signOut();
    return {
      success: false,
      error: TENANT_ACCESS_MESSAGES["no-membership"],
      reason: "no-access",
    };
  }

  return { success: true };
}

/** Supabase's own wording is written for developers; these are for people. */
function passwordUpdateMessage(error: { code?: string; message: string }) {
  switch (error.code) {
    case "same_password":
      return "That's your current password. Choose a different one.";
    case "weak_password":
      return "That password is too easy to guess. Try a longer one with a mix of letters, numbers, and symbols.";
    case "session_not_found":
    case "session_expired":
      return EXPIRED_LINK_MESSAGE;
    default:
      return "We couldn't update your password. Try again in a moment.";
  }
}

export async function updatePasswordForTenant(
  payload: UpdatePasswordValues,
  tenantSlug: string,
): Promise<TenantPasswordAccessResult> {
  try {
    const access = await checkTenantPasswordAccess(tenantSlug);

    if (!access.success) {
      return access;
    }

    const supabase = await createSupabaseServerClient();

    const { error: updateError } = await supabase.auth.updateUser({
      password: payload.password,
    });

    if (updateError) {
      console.error(
        "[auth] tenant password update failed:",
        updateError.code,
        updateError.message,
      );
      const error = passwordUpdateMessage(updateError);
      return {
        success: false,
        error,
        reason: error === EXPIRED_LINK_MESSAGE ? "expired" : "retry",
      };
    }

    // Done with the link's session: the person signs in with the new
    // password, which also runs the invite-to-active step on a fresh token.
    await supabase.auth.signOut();

    return { success: true };
  } catch (err) {
    console.error("[SUPABASE_UPDATE_PASSWORD_ERROR]:", err);
    return {
      success: false,
      error: "We couldn't update your password. Try again in a moment.",
      reason: "retry",
    };
  }
}

async function recordLogoutAttempt(supabase: SupabaseClient) {
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return;
  }

  // The workspace this session is signed in to, as login records it. The
  // insert policy only accepts current_tenant_id(), so any other membership
  // would be refused.
  const claims = await getTenantClaims(supabase);

  if (!claims?.tenantId) {
    return;
  }

  await recordAuthEvent(supabase, {
    action: "logout",
    tenantId: claims.tenantId,
    userId: data.user.id,
    email: data.user.email ?? "",
  });
}

async function recordAuthEvent(
  supabase: SupabaseClient,
  {
    action,
    tenantId,
    userId,
    email,
  }: {
    action: "login" | "logout";
    tenantId: string;
    userId: string;
    email: string;
  },
) {
  const { error } = await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: userId,
    action,
    entity: "user",
    entity_id: userId,
    meta_json: { email },
    ip: await clientIp(),
  });

  if (error) {
    warn(`${action} audit not written: ${error.message}`);
  }
}

/**
 * A wrong password for a real team member, written to the workspace the
 * sign-in was for (the host's, else the member's first active one) so the
 * audit log's Security tab shows it.
 *
 * Only for an account that exists and is an active member there: an unknown
 * address writes nothing, so the log cannot be filled by guessing emails, and
 * no tenant ever sees attempts against somebody else's address. Customers sign
 * in through the portal and are not recorded here. Best effort -- a failure is
 * logged and the sign-in error is still returned as normal.
 */
async function recordFailedLogin(email: string) {
  try {
    const admin = createSupabaseAdminClient();

    const { data: user } = await admin
      .from("users")
      .select("id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle<{ id: string }>();

    if (!user) {
      return;
    }

    const host = await getTenantContext();
    let membershipQuery = admin
      .from("memberships")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .eq("status", "active")
      .neq("role", "customer");

    if (host) {
      membershipQuery = membershipQuery.eq("tenant_id", host.id);
    }

    const { data: membership } = await membershipQuery
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle<{ tenant_id: string; role: string }>();

    if (!membership) {
      return;
    }

    const requestHeaders = await headers();
    const { error } = await admin.from("audit_logs").insert({
      tenant_id: membership.tenant_id,
      actor_id: user.id,
      action: "login_failed",
      entity: "user",
      entity_id: user.id,
      meta_json: {
        email,
        summary: "Failed login attempt (invalid password)",
        user_agent: requestHeaders.get("user-agent")?.slice(0, 512) ?? null,
      },
      ip: await clientIp(),
    });

    if (error) {
      warn(`failed-login audit not written: ${error.message}`);
    }
  } catch (err) {
    warn(`failed-login audit not written: ${String(err)}`);
  }
}

async function clientIp(): Promise<string | null> {
  return (await requestClientInfo()).ip;
}

function warn(message: string) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[auth] ${message}`);
  }
}
