"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import type { LoginValues } from "@/features/auth/schemas/login";
import type { ActionResult, LoginSuccess } from "@/features/auth/types";
import { stripTenantPrefix } from "@/lib/tenancy";
import { broadcastLogout, subscribeToLogout } from "@/lib/auth-broadcast";
import {
  loginAction,
  googleLoginAction,
  logoutAction,
} from "../actions/actions";

type UseLoginOptions = {
  redirectTo?: string | null;
  next?: string | null;
  tenantSlug?: string | null;
};

function isAbsoluteUrl(target: string): boolean {
  return /^https?:\/\//i.test(target);
}

function currentTenantSlug(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return stripTenantPrefix(window.location.pathname)?.slug ?? null;
}

function currentTenantPrefix(): string {
  const slug = currentTenantSlug();

  return slug ? `/tenant/${slug}` : "";
}

function withCurrentTenantPrefix(path: string): string {
  const prefix = currentTenantPrefix();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (normalizedPath.startsWith("/tenant/")) {
    return normalizedPath;
  }

  return prefix ? `${prefix}${normalizedPath}` : normalizedPath;
}

export function useLogin({ redirectTo, next }: UseLoginOptions = {}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState<boolean>(false);

  const login = useCallback(
    async (values: LoginValues): Promise<ActionResult<LoginSuccess>> => {
      setIsPending(true);

      let result: ActionResult<LoginSuccess>;

      try {
        result = await loginAction(values, next);
      } catch (error) {
        setIsPending(false);
        console.error("[auth] login request failed", error);

        toast.error("Network error. Check your connection and retry.");

        return {
          success: false,
          code: "unknown",
          message: "Network error. Check your connection and retry.",
        };
      }

      if (!result.success) {
        setIsPending(false);
        toast.error(result.message);

        return result;
      }

      toast.success("Logged in successfully");

      const rawTarget =
        redirectTo === undefined ? result.data.redirectTo : redirectTo;

      if (rawTarget) {
        if (isAbsoluteUrl(rawTarget)) {
          const targetUrl = new URL(rawTarget);

          if (targetUrl.origin === window.location.origin) {
            router.replace(`${targetUrl.pathname}${targetUrl.search}`);
          } else {
            window.location.assign(rawTarget);
          }
        } else {
          router.replace(withCurrentTenantPrefix(rawTarget));
        }
      }

      return result;
    },
    [next, redirectTo, router],
  );

  return { login, isPending };
}

export function useGoogleLogin({
  redirectTo,
  next,
  tenantSlug,
}: UseLoginOptions = {}) {
  const [isPending, setIsPending] = useState<boolean>(false);
  const signInWithGoogle = useCallback(async (): Promise<
    ActionResult<{ url: string }>
  > => {
    setIsPending(true);

    let result: ActionResult<{ url: string }>;

    try {
      const destinationPath = redirectTo ?? next ?? "/tickets";
      const slug = tenantSlug ?? currentTenantSlug();

      result = await googleLoginAction(destinationPath, slug);
    } catch (error) {
      setIsPending(false);
      console.error("[auth] google login request failed", error);
      toast.error("Network error. Check your connection and retry.");

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
    toast.error(result.message);

    return result;
  }, [next, redirectTo, tenantSlug]);

  return { signInWithGoogle, isPending };
}

type UseLogoutOptions = {
  redirectTo?: string | null;
};

export function useLogout({ redirectTo }: UseLogoutOptions = {}) {
  const [isPending, setIsPending] = useState<boolean>(false);

  const handleRedirect = useCallback(() => {
    const target =
      redirectTo === undefined ? withCurrentTenantPrefix("/login") : redirectTo;

    if (target) {
      window.location.assign(target);
    } else {
      window.location.reload();
    }
  }, [redirectTo]);

  useEffect(() => {
    const unsubscribe = subscribeToLogout(() => {
      toast.info("You were logged out in another tab");
      handleRedirect();
    });

    return unsubscribe;
  }, [handleRedirect]);

  const logout = useCallback(async (): Promise<ActionResult<null>> => {
    setIsPending(true);

    let result: ActionResult<null>;

    try {
      result = await logoutAction();
    } catch (error) {
      setIsPending(false);
      console.error("[auth] logout request failed", error);
      toast.error("Network error. Check your connection and retry.");

      return {
        success: false,
        code: "unknown",
        message: "Network error. Check your connection and retry.",
      };
    }

    if (result.success) {
      broadcastLogout();

      toast.success("Logged out successfully");
      handleRedirect();

      return result;
    }

    setIsPending(false);
    return result;
  }, [handleRedirect]);

  return { logout, isPending };
}
