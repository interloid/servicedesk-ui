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

/**
 * Creates a cookie-aware Supabase client for Server Components, Actions, and Route Handlers.
 */
export async function createSupabaseServerClient() {
  const { url, key } = getSupabaseCredentials();
  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, {
              ...options,
              ...(AUTH_COOKIE_DOMAIN ? { domain: AUTH_COOKIE_DOMAIN } : {}),
              path: "/",
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
            });
          }
        } catch {
          // Server Components cannot modify cookies directly.
          // Handled via proxy / middleware.
        }
      },
    },
  });
}

/**
 * Creates a stateless Supabase client for public/unauthenticated data queries
 * without invoking `cookies()`, allowing routes to remain static.
 */
export function createSupabaseAnonClient() {
  const { url, key } = getSupabaseCredentials();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // No-op for static queries
      },
    },
  });
}
