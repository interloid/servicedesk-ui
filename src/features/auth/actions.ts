"use server";

import { loginSchema } from "@/features/auth/schemas/login";
import {
  AuthError,
  googleLogin,
  login,
  logout,
  resolvePostAuthUrl,
  safeNext,
  sendPasswordResetLink,
  sendTenantPasswordResetLink,
  updatePassword,
  updatePasswordForTenant,
} from "@/features/auth/services/auth.service";
import type { ActionResult, LoginSuccess } from "@/features/auth/types";
import {
  forgotPasswordSchema,
  ForgotPasswordValues,
} from "./schemas/forgot-password";
import {
  updatePasswordSchema,
  UpdatePasswordValues,
} from "./schemas/reset-password";

/**
 * Server Actions for the auth feature. This is the boundary the client is allowed to call;
 * `./services/auth.service` stays server-only behind it.
 */

/**
 * Sign in.
 *
 * Re-validates with `loginSchema` even though `login-form.tsx` already resolves against it.
 * That isn't belt-and-braces: a Server Action is a public POST endpoint reachable without
 * the UI (see node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md),
 * so client-side validation is a convenience and this is the real check.
 *
 * Takes `unknown` for the same reason — the argument is untrusted input off the wire, and
 * typing it `LoginValues` would be a claim about the caller we can't enforce.
 */
export async function loginAction(
  values: unknown,
  next?: unknown,
): Promise<ActionResult<LoginSuccess>> {
  const parsed = loginSchema.safeParse(values);

  if (!parsed.success) {
    return {
      success: false,
      code: "validation",
      message: "Check the highlighted fields and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<
        string,
        string[]
      >,
    };
  }

  try {
    const sessionUser = await login(parsed.data);

    if (!sessionUser.tenantId) {
      return {
        success: false,
        code: "no_workspace_access",
        message: "No workspace assigned to this account.",
      };
    }

    /*
     * 2. Work out where they land. Returned to the caller rather than handed to
     *    `redirect()`: the destination is frequently a DIFFERENT origin (the
     *    workspace's own subdomain), and a Server Action's `redirect` is resolved
     *    by the client router, which cannot make that navigation — the same
     *    reason `googleLoginAction` hands back a URL. `useLogin` performs it, and
     *    picking between a router push and a document navigation is its call.
     */
    const redirectTo = await resolvePostAuthUrl(
      sessionUser.tenantId,
      typeof next === "string" ? next : null,
    );

    if (!redirectTo) {
      return {
        success: false,
        code: "no_workspace_access",
        message: "We couldn't resolve your workspace. Contact support.",
      };
    }

    return { success: true, data: { ...sessionUser, redirectTo } };
  } catch (error) {
    if (error instanceof AuthError) {
      return { success: false, code: error.code, message: error.message };
    }

    console.error("[auth] loginAction failed", error);

    return {
      success: false,
      code: "unknown",
      message: "We couldn't sign you in right now. Try again in a moment.",
    };
  }
}

/**
 * Start Google sign-in and hand back the URL to send the browser to.
 *
 * It returns a URL instead of calling `redirect()` because the destination is a third-party
 * origin: a Server Action's `redirect` is resolved by the client router, and pointing that
 * at accounts.google.com is not a navigation it can make. The caller does
 * `window.location.assign(url)` — see `useGoogleLogin`.
 *
 * Nothing is signed in at this point. The session is created on the way back, in
 * `src/app/auth/callback/route.ts`.
 *
 * `next` is untrusted (it comes off the query string) and is reduced to a same-origin path
 * by `safeNext` before it is ever put on a redirect URL.
 */
export async function googleLoginAction(
  next?: unknown,
): Promise<ActionResult<{ url: string }>> {
  try {
    const url = await googleLogin({
      next: safeNext(typeof next === "string" ? next : null),
    });

    return { success: true, data: url };
  } catch (error) {
    if (error instanceof AuthError) {
      return { success: false, code: error.code, message: error.message };
    }

    console.error("[auth] googleLoginAction failed", error);

    return {
      success: false,
      code: "unknown",
      message: "We couldn't start Google sign-in. Try again in a moment.",
    };
  }
}

/**
 * Sign out.
 *
 * No argument and so no schema: the only input is the session cookie the browser already
 * sends, and the identity comes from the token, never from the caller. That also makes the
 * action safe as a public POST — the worst an unauthenticated hit can do is clear cookies
 * that carry no session.
 *
 * Deliberately does NOT call `redirect()`. The design's Sign out sits in a dropdown that has
 * to survive a failed attempt and show why (see `profile-menu.tsx`); a redirect throws past
 * the caller and would leave a user with a live session looking at the login screen.
 */
export async function logoutAction(): Promise<ActionResult<null>> {
  try {
    await logout();

    return { success: true, data: null };
  } catch (error) {
    if (error instanceof AuthError) {
      return { success: false, code: error.code, message: error.message };
    }

    console.error("[auth] logoutAction failed", error);

    return {
      success: false,
      code: "unknown",
      message: "We couldn't sign you out right now. Try again in a moment.",
    };
  }
}

export async function resetPasswordAction(values: ForgotPasswordValues) {
  const validatedFields = forgotPasswordSchema.safeParse(values);

  if (!validatedFields.success) {
    return {
      success: false,
      error: "Invalid email format provided.",
    };
  }

  const result = await sendPasswordResetLink(validatedFields.data);

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      isRateLimited: result.isRateLimited,
    };
  }

  return { success: true };
}

export async function resetTenantPasswordAction(
  values: ForgotPasswordValues,
  tenant: string,
  slug: string,
) {
  const validatedFields = forgotPasswordSchema.safeParse(values);

  if (!validatedFields.success) {
    return {
      success: false,
      error: "Invalid email format provided.",
    };
  }

  const result = await sendTenantPasswordResetLink(validatedFields.data);

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      isRateLimited: result.isRateLimited,
    };
  }

  return { success: true };
}

export async function updatePasswordAction(values: UpdatePasswordValues) {
  const validatedFields = updatePasswordSchema.safeParse(values);

  if (!validatedFields.success) {
    return {
      success: false,
      error: "Invalid fields provided.",
    };
  }

  return await updatePassword(validatedFields.data);
}

export async function updateTenantPasswordAction(
  values: UpdatePasswordValues,
  tenantId: string,
) {
  const validatedFields = updatePasswordSchema.safeParse(values);

  if (!validatedFields.success) {
    return {
      success: false,
      error: "Invalid password fields.",
    };
  }

  if (!tenantId) {
    return {
      success: false,
      error: "Tenant context is missing.",
    };
  }

  return await updatePasswordForTenant(validatedFields.data, tenantId);
}
