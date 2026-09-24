import "server-only";

import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/config/env";
import type { LoginValues } from "@/features/auth/schemas/login";
import type {
  ActiveMembership,
  AuthFailureCode,
  SessionUser,
} from "@/features/auth/types";
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
  updatePasswordSchema,
  type UpdatePasswordValues,
} from "../schemas/reset-password";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

export async function requestOrigin(): Promise<string> {
  const configured = new URL(env.NEXT_PUBLIC_SITE_URL);
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");

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

export async function sendPasswordResetLink(payload: ForgotPasswordValues) {
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

    const redirectTo = `${
      process.env.NEXT_PUBLIC_SITE_URL || ""
    }/reset-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      if (
        error.status === 429 ||
        error.message.toLowerCase().includes("rate limit")
      ) {
        return {
          success: false,
          error:
            "Too many attempts from this address - try again in 60 seconds, or contact your admin.",
          isRateLimited: true,
        };
      }

      return {
        success: false,
        error: error.message,
      };
    }

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
) {
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
    )}`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      if (
        error.status === 429 ||
        error.message.toLowerCase().includes("rate limit")
      ) {
        return {
          success: false,
          error:
            "Too many attempts from this address - try again in 60 seconds.",
          isRateLimited: true,
        };
      }
      return { success: false, error: error.message };
    }

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

  const membership = await findActiveMembership(supabase, data.user.id);

  if (!membership) {
    return;
  }

  await recordAuthEvent(supabase, {
    action: "logout",
    tenantId: membership.tenant_id,
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

async function clientIp(): Promise<string | null> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || null;
  }

  return requestHeaders.get("x-real-ip");
}

function warn(message: string) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[auth] ${message}`);
  }
}

export async function findActiveMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActiveMembership | null> {
  const { data, error } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to find active membership:", error);
    return null;
  }

  return data;
}
