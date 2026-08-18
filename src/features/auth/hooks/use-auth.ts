"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

import {
  googleLoginAction,
  loginAction,
  logoutAction,
} from "@/features/auth/actions";
import type { LoginValues } from "@/features/auth/schemas/login";
import type { ActionResult, LoginSuccess } from "@/features/auth/types";
import { stripTenantPrefix } from "@/lib/tenancy";

type UseLoginOptions = {
  redirectTo?: string | null;
  next?: string | null;
};

function isAbsoluteUrl(target: string): boolean {
  return /^https?:\/\//i.test(target);
}

function currentTenantPrefix(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const parsed = stripTenantPrefix(window.location.pathname);

  return parsed ? `/tenant/${parsed.slug}` : "";
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
        result = await loginAction(values, next ?? null);
      } catch (error) {
        setIsPending(false);
        console.error("[auth] login request failed", error);

        return {
          success: false,
          code: "unknown",
          message: "Network error. Check your connection and retry.",
        };
      }

      if (!result.success) {
        setIsPending(false);

        return result;
      }

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

export function useGoogleLogin({ redirectTo, next }: UseLoginOptions = {}) {
  const [isPending, setIsPending] = useState<boolean>(false);
  const signInWithGoogle = useCallback(async (): Promise<
    ActionResult<{ url: string }>
  > => {
    setIsPending(true);

    let result: ActionResult<{ url: string }>;

    try {
      const destinationPath = redirectTo ?? next ?? "/tickets";
      result = await googleLoginAction(destinationPath);
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
  }, [next, redirectTo]);

  return { signInWithGoogle, isPending };
}

type UseLogoutOptions = {
  redirectTo?: string | null;
};

export function useLogout({ redirectTo }: UseLogoutOptions = {}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState<boolean>(false);
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

    if (result.success) {
      const target =
        redirectTo === undefined
          ? withCurrentTenantPrefix("/login")
          : redirectTo;
      if (target) {
        if (isAbsoluteUrl(target)) {
          window.location.assign(target);
        } else {
          router.replace(target);
        }
      } else {
        router.refresh();
      }

      return result;
    }

    setIsPending(false);

    return result;
  }, [redirectTo, router]);

  return { logout, isPending };
}
