import { cookies, headers } from "next/headers";
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
import {
  landingUrlForSlug,
  stripTenantPrefix,
  TENANT_HINT_COOKIE,
  tenantAuthCallbackPath,
  withTenantPrefix,
} from "@/lib/tenancy";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ForgotPasswordValues } from "../schemas/forgot-password";
import {
  updatePasswordSchema,
  type UpdatePasswordValues,
} from "../schemas/reset-password";

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
}: LoginValues): Promise<SessionUser> {
  const supabase = await createSupabaseServerClient();

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

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError) {
    console.error("JWT claims error:", claimsError);
    throw new Error("Unable to verify authentication session");
  }

  const tenantId =
    (claimsData?.claims?.tenant_id as string | undefined) ?? null;
  const tenantSlug =
    (claimsData?.claims?.tenant_slug as string | undefined) ?? null;

  await verifyHostTenancy(supabase, tenantId);

  return {
    id: data.user.id,
    email: data.user.email ?? email,
    tenantId,
    tenantSlug,
    role:
      (claimsData?.claims?.tenant_role as MembershipRole | undefined) ?? null,
  };
}

export async function googleLogin({
  next = "/tickets",
}: { next?: string } = {}) {
  const supabase = await createSupabaseServerClient();
  const origin = await requestOrigin();

  const cookieStore = await cookies();
  const tenantSlug = cookieStore.get(TENANT_HINT_COOKIE)?.value;

  const safePath = safeNext(next);
  const targetNext = tenantSlug
    ? withTenantPrefix(tenantSlug, safePath)
    : safePath;

  const callbackPath = tenantSlug
    ? tenantAuthCallbackPath(tenantSlug, targetNext)
    : `/auth/callback?next=${encodeURIComponent(targetNext)}`;

  const redirectTo = new URL(callbackPath, origin).toString();

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
    throw new AuthError("That sign-in link has expired. Try again.", {
      status: error?.status ?? 400,
      code: toFailureCode(error?.code),
    });
  }

  const { data: claimsData } = await supabase.auth.getClaims();

  const tenantId =
    (claimsData?.claims?.tenant_id as string | undefined) ?? null;
  const tenantSlug = tenantId ? await getTenantSlugById(tenantId) : null;

  await verifyHostTenancy(supabase, tenantId);

  return {
    id: data.user.id,
    email: data.user.email ?? "",
    tenantSlug,
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

  const rawNext = safeNext(next);
  const parsed = stripTenantPrefix(rawNext);
  const target = parsed ? parsed.rest : rawNext;

  return landingUrlForSlug(
    slug,
    target === "/" ? "/tickets" : target || "/tickets",
  );
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
    const supabase = await createSupabaseServerClient();
    const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/auth/callback?next=/reset-password`;

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
            "Too many attempts from this address — try again in 60 seconds, or contact your admin.",
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
  slug: string = "converse",
) {
  const { email } = payload;

  try {
    const supabase = await createSupabaseServerClient();
    const origin = await requestOrigin();

    const destinationPath = `/tenant/${slug}/reset-password`;
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(destinationPath)}`;

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
            "Too many attempts from this address — try again in 60 seconds.",
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
  tenantId: string,
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
        error:
          "Your session has expired. Please request a new password reset link.",
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
        error:
          "Unauthorized: You do not belong to this organization workspace.",
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

// async function recordLogoutAttempt(supabase: SupabaseClient) {
//   const { data, error } = await supabase.auth.getUser();

//   if (error || !data.user) {
//     return;
//   }

//   const membership = await findActiveMembership(supabase, data.user.id);

//   if (!membership) {
//     return;
//   }

//   await recordAuthEvent(supabase, {
//     action: "logout",
//     tenantId: membership.tenant_id,
//     userId: data.user.id,
//     email: data.user.email ?? "",
//   });
// }

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
