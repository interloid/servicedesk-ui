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

/**
 * Navigation for the auth flow.
 *
 * Rules:
 * - Path-based URLs rely on `/tenant/<slug>/...`.
 * - `withCurrentTenantPrefix` extracts the active slug from the URL path to ensure
 *   relative navigations land in the correct workspace path context.
 */

type UseLoginOptions = {
  /** Override the server's destination. Pass `null` to stay put and navigate yourself. */
  redirectTo?: string | null;
  /** Where the user was headed before the guard bounced them here (`?next=`). */
  next?: string | null;
};

/** An absolute URL needs document navigation; the client router can't cross origins. */
function isAbsoluteUrl(target: string): boolean {
  return /^https?:\/\//i.test(target);
}

/**
 * Extracts `/tenant/<slug>` prefix from current `window.location.pathname`.
 */
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
  const [isPending, setIsPending] = useState(false);

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

/**
 * Google sign-in flow.
 */
export function useGoogleLogin({ redirectTo, next }: UseLoginOptions = {}) {
  const [isPending, setIsPending] = useState(false);

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
  /** Where to land once the session is gone. Pass `null` to handle navigation yourself. */
  redirectTo?: string | null;
};

export function useLogout({ redirectTo }: UseLogoutOptions = {}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

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
      /*
       * Sign-out keeps the user within the same tenant path space:
       * defaults to `/tenant/converse/login`
       */
      const target =
        redirectTo === undefined
          ? withCurrentTenantPrefix("/login")
          : redirectTo;

      /*
       * Same rule as `useLogin`: one navigation, no companion `refresh()`. Clearing the
       * session cookies in the action already invalidates the client cache, and racing a
       * refresh against the replace is what aborts the RSC request mid-flight.
       *
       * With `redirectTo: null` the caller navigates itself, so refresh the tree instead —
       * otherwise the shell keeps rendering the signed-in header.
       */
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
