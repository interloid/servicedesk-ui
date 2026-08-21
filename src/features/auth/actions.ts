"use server";

import { loginSchema, LoginValues } from "@/features/auth/schemas/login";
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

export async function loginAction(
  values: LoginValues,
  next?: string | null,
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

export async function googleLoginAction(
  next?: string,
  tenantSlug?: string | null,
): Promise<ActionResult<{ url: string }>> {
  try {
    const url = await googleLogin({
      next: safeNext(typeof next === "string" ? next : null),
      tenantSlug: typeof tenantSlug === "string" ? tenantSlug : null,
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

  const result = await sendTenantPasswordResetLink(
    validatedFields.data,
    tenant,
    slug,
  );

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
