import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/config/env";
import type { LoginValues } from "@/features/auth/schemas/login";
import type {
  AuthFailureCode,
  MembershipRole,
  SessionUser,
} from "@/features/auth/types";
import {
  getTenantContext,
  getTenantSlugById,
} from "@/features/tenancy/services/tenant-resolver";
import { landingUrlForSlug, tenantLabelFromHost } from "@/lib/tenancy";
import { createSupabaseAnonClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { ForgotPasswordValues } from "../schemas/forgot-password";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { updatePasswordSchema, UpdatePasswordValues } from "../schemas/reset-password";

/**
 * Auth service — the only place that talks to the Supabase auth/data SDK.
 *
 * No REST layer, no Express controller: callers are Server Actions (`../actions.ts`), and
 * this module runs server-side only. It never imports React and never returns a Response;
 * it returns domain values or throws `AuthError`, and the action shapes the envelope.
 *
 * Every call uses the anon key plus the caller's own access token, so RLS is in force. See
 * `@/lib/supabase/server` for why there is no service-role client.
 */

/** A failure the user is allowed to see — bad credentials, unconfirmed email, rate limit. */
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

/**
 * Narrow Supabase's `error.code` to our own set. Anything unrecognised becomes `unknown`
 * rather than leaking through, so a new vendor code can't reach the UI unhandled.
 */
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

type ActiveMembership = { tenant_id: string; role: MembershipRole };

/**
 * Sign in with a password, resolve the caller's active membership, and append a `login`
 * row to the audit trail.
 *
 * Sets the session cookies as a side effect: `createServerClient` writes them through the
 * `cookies()` store, which is why this must be called from a Server Action or Route
 * Handler and not during a Server Component render.
 */
export async function login({
  email,
  password,
}: LoginValues): Promise<SessionUser> {
  const supabase = await createSupabaseServerClient();

  /*
   * Supabase creates the authenticated session.
   *
   * @supabase/ssr writes the session into cookies through
   * the server client cookie adapter.
   */
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  /*
   * `AuthError`, not a bare `Error`. `loginAction` branches on `instanceof AuthError` to
   * decide whether the user may see the message; a plain Error falls through to its
   * catch-all and every bad password reads "We couldn't sign you in right now" instead of
   * "invalid credentials" — which is also what makes `toFailureCode` worth having.
   */
  if (error || !data.user) {
    throw new AuthError(error?.message ?? "Invalid login credentials", {
      status: error?.status ?? 400,
      code: toFailureCode(error?.code),
    });
  }

  /*
   * Check the newly issued JWT claims.
   *
   * Your custom_access_token_hook should add:
   *
   * tenant_id
   * tenant_role
   */
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError) {
    console.error("JWT claims error:", claimsError);

    throw new Error("Unable to verify authentication session");
  }

  const tenantId =
    (claimsData?.claims?.tenant_id as string | undefined) ?? null;

  await verifyHostTenancy(supabase, tenantId);


  return {
    id: data.user.id,
    email: data.user.email ?? email,
    tenantId,
    role:
      (claimsData?.claims?.tenant_role as MembershipRole | undefined) ?? null,
  };
}


export async function googleLogin({
  next = "/tickets",
}: { next?: string } = {}) {
  const supabase = await createSupabaseServerClient();
  const origin = await requestOrigin(); 
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", safeNext(next));

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callback.toString(),
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
    throw new AuthError("That sign-in link has expired. Try again.", {
      status: error?.status ?? 400,
      code: toFailureCode(error?.code),
    });
  }

  const { data: claimsData } = await supabase.auth.getClaims();

  const tenantId =
    (claimsData?.claims?.tenant_id as string | undefined) ?? null;

  await verifyHostTenancy(supabase, tenantId);

  return {
    id: data.user.id,
    email: data.user.email ?? "",
    tenantId,
    role:
      (claimsData?.claims?.tenant_role as MembershipRole | undefined) ?? null,
  };
}


export async function resolvePostAuthUrl(
  tenantId: string | null,
  next?: string | null,
): Promise<string | null> {
  if (!tenantId) {
    return null;
  }

  const slug = await getTenantSlugById(tenantId);

  if (!slug) {
    return null;
  }

  const requestHeaders = await headers();
  const origin = await requestOrigin();

  const target = safeNext(next).replace(
    new RegExp(`^/tenant/${slug}(?=/|$)`),
    "",
  );

  return landingUrlForSlug(slug, target || "/tickets", {
    currentSlug: tenantLabelFromHost(requestHeaders.get("host")),
    protocol: new URL(origin).protocol.replace(":", ""),
  });
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


async function requestOrigin(): Promise<string> {
  const requestHeaders = await headers();

  const host = requestHeaders.get("host");
  const forwardedProto = requestHeaders.get("x-forwarded-proto");

  const scheme =
    forwardedProto?.split(",")[0]?.trim() ??
    (process.env.NODE_ENV === "production" ? "https" : "http");

  if (host) {
    return `${scheme}://${host}`;
  }

  return new URL(env.NEXT_PUBLIC_SITE_URL).origin;
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

  // Before the token is revoked, not after: this is the last moment the caller is still
  // authenticated, and the audit insert runs under their own JWT.
  await recordLogoutAttempt(supabase);

  const { error } = await supabase.auth.signOut();

  if (error) {
    // supabase-js already treats 401/403/404 from the revoke endpoint as success and clears
    // the session anyway, so reaching here means the session may genuinely still be live.
    // Say so rather than redirect to /login and imply an ending that didn't happen.
    throw new AuthError("We couldn't sign you out. Try again in a moment.", {
      status: error.status ?? 500,
      code: toFailureCode(error.code),
    });
  }
}

export async function sendPasswordResetLink(payload: ForgotPasswordValues){
    const { email } = payload;
    console.log("🚀 ~ sendPasswordResetLink ~ email:", email)

    try {
    const supabase = await createSupabaseServerClient();
      // Define redirect URL where user lands to enter their new password
     const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/auth/callback?next=/reset-password`;

     const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
     });

      if (error) {
        // Handle Supabase Rate Limits (HTTP status 429)
        if (error.status === 429 || error.message.toLowerCase().includes("rate limit")) {
          return {
            success: false,
            error: "Too many attempts from this address — try again in 60 seconds, or contact your admin.",
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
  tenant: string = "tenant",
  slug: string = "converse"
) {
  const { email } = payload;

  try {
    const supabase = await createSupabaseServerClient();

    const headerList = await headers();
    const host = headerList.get("host") || "localhost:3000";
    const protocol = process.env.NODE_ENV === "development" ? "http" : "https";

    const origin = `${protocol}://${host}`;

 
    const callbackPath = `/auth/callback`;
    const destinationPath = `/reset-password`;

    const redirectTo = `${origin}${callbackPath}?next=${encodeURIComponent(destinationPath)}`;
    console.log("🚀 ~ sendTenantPasswordResetLink ~ redirectTo:", redirectTo)

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      if (error.status === 429 || error.message.toLowerCase().includes("rate limit")) {
        return {
          success: false,
          error: "Too many attempts from this address — try again in 60 seconds.",
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


export async function updatePasswordForTenant(
  payload: UpdatePasswordValues,
  tenantId: string
) {
  const { password } = payload;

  try {
    const supabase = await createSupabaseServerClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        success: false,
        error: "Your session has expired. Please request a new password reset link.",
      };
    }

    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .select("id")
      .eq("user_id", user.id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (membershipError || !membership) {
      return {
        success: false,
        error: "Unauthorized: You do not belong to this organization workspace.",
      };
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      return {
        success: false,
        error: updateError.message,
      };
    }

    return { success: true };
  } catch (err) {
    console.error("[SUPABASE_UPDATE_PASSWORD_ERROR]:", err);
    return {
      success: false,
      error: "An unexpected error occurred while updating your password.",
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


async function findActiveMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActiveMembership | null> {
  const { data, error } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle<ActiveMembership>();

  // A failed probe must not fail an otherwise valid sign-in — the credentials were good.
  if (error) {
    warn(`membership lookup skipped: ${error.message}`);
    return null;
  }

  return data;
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


