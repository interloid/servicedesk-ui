import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/config/env";
import { AUTH_COOKIE_DOMAIN } from "@/lib/tenancy";

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
  remember?: boolean;
};

export async function createSupabaseServerClient(
  options: SupabaseServerClientOptions = {},
) {
  const { url, key } = getSupabaseCredentials();
  const cookieStore = await cookies();
  const remember = options.remember ?? true;

  const isProduction = process.env.NODE_ENV === "production";

  const isHttps =
    isProduction &&
    !env.NEXT_PUBLIC_SITE_URL.startsWith("http://localhost") &&
    !env.NEXT_PUBLIC_SITE_URL.startsWith("http://127.0.0.1");

  const REMEMBER_ME_MAX_AGE = 60 * 60 * 24 * 30;

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },

      setAll(cookiesToSet) {
        for (const { name, value, options: cookieOptions } of cookiesToSet) {
          cookieStore.set(name, value, {
            ...cookieOptions,

            ...(isProduction && AUTH_COOKIE_DOMAIN
              ? { domain: AUTH_COOKIE_DOMAIN }
              : {}),

            path: "/",
            sameSite: cookieOptions?.sameSite ?? "lax",
            secure: cookieOptions?.secure ?? isHttps,

            ...(remember
              ? {
                  maxAge: REMEMBER_ME_MAX_AGE,
                  expires: new Date(Date.now() + REMEMBER_ME_MAX_AGE * 1000),
                }
              : {
                  maxAge: cookieOptions?.maxAge,
                  expires: cookieOptions?.expires,
                }),
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
