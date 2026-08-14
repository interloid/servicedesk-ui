"use client";

import { useCallback, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { googleLoginAction, loginAction, logoutAction } from "@/features/auth/actions";
import type { LoginValues } from "@/features/auth/schemas/login";
import type { ActionResult, SessionUser } from "@/features/auth/types";

type UseLoginOptions = {
  /** Where to land on success. Pass `null` to stay put and handle navigation yourself. */
  redirectTo?: string | null;
};

/**
 * Helper to compute tenant-aware redirect targets.
 * Resolves relative paths (e.g., "/tickets") to "/tenant/[tenantSlug]/tickets" if inside a tenant context.
 */
function useResolvedRedirect(defaultPath: string, customRedirect?: string | null) {
  const params = useParams();
  const tenantSlug = params?.tenantSlug as string | undefined;

  if (customRedirect !== undefined) {
    return customRedirect;
  }

  if (tenantSlug) {
    // Prevent double slashes when prefixing
    const cleanPath = defaultPath.startsWith("/") ? defaultPath : `/${defaultPath}`;
    return `/tenant/${tenantSlug}${cleanPath}`;
  }

  return defaultPath;
}

export function useLogin({ redirectTo }: UseLoginOptions = {}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const targetRedirect = useResolvedRedirect("/tickets", redirectTo);

  const login = useCallback(
    async (values: LoginValues): Promise<ActionResult<SessionUser>> => {
      setIsPending(true);

      let result: ActionResult<SessionUser>;

      try {
        result = await loginAction(values);
      } catch (error) {
        setIsPending(false);
        console.error("[auth] login request failed", error);

        return {
          success: false,
          code: "unknown",
          message: "Network error. Check your connection and retry.",
        };
      }

      if (result.success && targetRedirect) {
        // Refresh server components and replace URL with tenant-aware route
        router.refresh();
        router.replace(targetRedirect);

        return result;
      }

      setIsPending(false);

      return result;
    },
    [targetRedirect, router],
  );

  return { login, isPending };
}

/**
 * Google sign-in with tenant context support.
 */
export function useGoogleLogin({ redirectTo }: UseLoginOptions = {}) {
  const [isPending, setIsPending] = useState(false);
  const targetRedirect = useResolvedRedirect("/tickets", redirectTo);

  const signInWithGoogle = useCallback(async (): Promise<ActionResult<{ url: string }>> => {
    setIsPending(true);

    let result: ActionResult<{ url: string }>;

    try {
      result = await googleLoginAction(targetRedirect);
    } catch (error) {
      setIsPending(false);
      console.error("[auth] google login request failed", error);

      return {
        success: false,
        code: "unknown",
        message: "Network error. Check your connection and retry.",
      };
    }

    if (result.success) {
      window.location.assign(result.data.url);

      return result;
    }

    setIsPending(false);

    return result;
  }, [targetRedirect]);

  return { signInWithGoogle, isPending };
}

type UseLogoutOptions = {
  /** Where to land once the session is gone. Pass `null` to handle navigation yourself. */
  redirectTo?: string | null;
};

export function useLogout({ redirectTo }: UseLogoutOptions = {}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const targetRedirect = useResolvedRedirect("/login", redirectTo);

  const logout = useCallback(async (): Promise<ActionResult<null>> => {
    setIsPending(true);

    let result: ActionResult<null>;

    try {
      result = await logoutAction();
    } catch (error) {
      setIsPending(false);
      console.error("[auth] logout request failed", error);

      return {
        success: false,
        code: "unknown",
        message: "Network error. Check your connection and retry.",
      };
    }

    if (result.success && targetRedirect) {
      router.refresh();
      router.replace(targetRedirect);

      return result;
    }

    setIsPending(false);

    return result;
  }, [targetRedirect, router]);

  return { logout, isPending };
}