import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/config/env";
import { auditForwardHeaders } from "@/lib/request-context";
import {
  AUTH_COOKIE_SCOPE,
  REMEMBER_COOKIE,
  authCookieLifetime,
  isCookieDeletion,
  isRememberedSession,
} from "@/lib/supabase/remember";

function getSupabaseCredentials() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  return { url, key };
}

type SupabaseServerClientOptions = {
  /**
   * Set only by sign-in. Everywhere else the choice made then is read back
   * from the REMEMBER_COOKIE marker.
   */
  remember?: boolean;
};

export async function createSupabaseServerClient(
  options: SupabaseServerClientOptions = {},
) {
  const { url, key } = getSupabaseCredentials();
  const cookieStore = await cookies();
  const remember =
    options.remember ??
    isRememberedSession(cookieStore.get(REMEMBER_COOKIE)?.value);

  return createServerClient(url, key, {
    global: { headers: await auditForwardHeaders() },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },

      setAll(cookiesToSet) {
        for (const { name, value, options: cookieOptions } of cookiesToSet) {
          cookieStore.set(name, value, {
            ...cookieOptions,
            // Same scope as the proxy's writes (see remember.ts).
            ...AUTH_COOKIE_SCOPE,
            ...authCookieLifetime(cookieOptions, remember),
          });
        }

        // Sign-in records its choice for later writes (see remember.ts); a
        // sign-out, where every cookie is a deletion, clears it.
        const signedOut =
          cookiesToSet.length > 0 &&
          cookiesToSet.every(({ options: o }) => isCookieDeletion(o));

        if (signedOut || options.remember !== undefined) {
          const keepMarker = !signedOut && options.remember === false;

          cookieStore.set(REMEMBER_COOKIE, keepMarker ? "0" : "", {
            ...AUTH_COOKIE_SCOPE,
            httpOnly: true,
            ...(keepMarker ? {} : { maxAge: 0, expires: new Date(0) }),
          });
        }
      },
    },
  });
}

export function createSupabaseAnonClient() {
  const { url, key } = getSupabaseCredentials();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {},
    },
  });
}
