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
 * The rule these hooks follow: the client never *invents* a tenant URL. On a
 * workspace subdomain the visible URL is already clean (`/tickets`) and
 * `proxy.ts` maps it onto `/tenant/<slug>` internally, so prefixing the slug here
 * — which is what this file used to do — produced
 * `acme.example.com/tenant/acme/tickets`, the slug twice over. Sign-in gets its
 * destination from the server (`resolvePostAuthUrl`), which is the only side that
 * knows which workspace the session claims; sign-out just mirrors the shape of
 * the URL it is standing on.
 */

type UseLoginOptions = {
  /** Override the server's destination. Pass `null` to stay put and navigate yourself. */
  redirectTo?: string | null;
  /** Where the user was headed before the guard bounced them here (`?next=`). */
  next?: string | null;
};

/** An absolute URL needs a document navigation; the client router can't cross origins. */
function isAbsoluteUrl(target: string): boolean {
  return /^https?:\/\//i.test(target);
}

/**
 * The `/tenant/<slug>` prefix of the CURRENT url, or "" when there isn't one.
 *
 * Empty on a workspace subdomain — the host carries the tenant there — and
 * `/tenant/acme` on the bare base host, where the path does. Reading it off the
 * live location rather than `useParams()` is deliberate: the route params report
 * the slug in both cases, since the rewrite puts it there either way, so they
 * cannot tell the two URL shapes apart.
 */
function currentTenantPrefix(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const parsed = stripTenantPrefix(window.location.pathname);

  return parsed ? `/tenant/${parsed.slug}` : "";
}

/** Resolve a bare path against the URL shape this host uses. */
function withCurrentTenantPrefix(path: string): string {
  return `${currentTenantPrefix()}${path.startsWith("/") ? path : `/${path}`}`;
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

      const target =
        redirectTo === undefined ? result.data.redirectTo : redirectTo;

      if (target) {
        if (isAbsoluteUrl(target)) {
          
          window.location.assign(target);
        } else {
          
          router.refresh();
          router.replace(target);
        }
      }
      return result;
    },
    [next, redirectTo, router],
  );

  return { login, isPending };
}

/**
 * Google sign-in.
 *
 * Only the desired path travels to the server. Where that path finally lands is
 * decided on the way back, in `/auth/callback` — see `resolvePostAuthUrl`.
 */
export function useGoogleLogin({ redirectTo, next }: UseLoginOptions = {}) {
  const [isPending, setIsPending] = useState(false);

  const signInWithGoogle = useCallback(async (): Promise<
    ActionResult<{ url: string }>
  > => {
    setIsPending(true);

    let result: ActionResult<{ url: string }>;

    try {
      result = await googleLoginAction(redirectTo ?? next ?? "/tickets");
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
       * Sign-out stays on the host it was invoked from — the workspace the user
       * was just in is where they'd sign back into. Only the path shape has to
       * match the host: `/login` on a subdomain, `/tenant/acme/login` on the
       * bare base host.
       */
      const target =
        redirectTo === undefined
          ? withCurrentTenantPrefix("/login")
          : redirectTo;

      router.refresh();

      if (target) {
        router.replace(target);
      }

      return result;
    }

    setIsPending(false);

    return result;
  }, [redirectTo, router]);

  return { logout, isPending };
}
