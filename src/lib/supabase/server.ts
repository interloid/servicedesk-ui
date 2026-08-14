import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { env } from "@/config/env";

function getSupabaseCredentials() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
    );
  }

  return {
    url,
    key,
  };
}

export async function createSupabaseServerClient() {
  const { url, key } = getSupabaseCredentials();

  const cookieStore = await cookies();

  // Determine root cookie domain based on environment
  const rootDomain =
    process.env.NODE_ENV === "development"
      ? ".localhost"
      : process.env.NEXT_PUBLIC_ROOT_DOMAIN || ".yourdomain.com";

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
              // Scope auth cookies across all subdomains (.localhost / .yourdomain.com)
              domain: rootDomain,
              path: "/",
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
            });
          }
        } catch {
          /*
           * Server Components cannot always modify cookies.
           *
           * Session refresh is handled by proxy.ts.
           */
        }
      },
    },
  });
}