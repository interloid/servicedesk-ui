// src/proxy.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  // 1. Setup Supabase client in Middleware to refresh expired auth tokens
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh auth session
  await supabase.auth.getUser();

  const url = request.nextUrl;
  const hostname = request.headers.get("host") || "";
  const baseDomain = process.env.NEXT_PUBLIC_APP_DOMAIN || "localhost:3000";

  // 2. Extract subdomain
  const isSubdomain = hostname.endsWith(`.${baseDomain}`);
  const subdomain = isSubdomain ? hostname.replace(`.${baseDomain}`, "") : null;

  // 3. Subdomain Rewriting
  if (subdomain && subdomain !== "www" && subdomain !== "app") {
    if (!url.pathname.startsWith(`/tenant/${subdomain}`)) {
      const rewriteUrl = new URL(
        `/tenant/${subdomain}${url.pathname}${url.search}`,
        request.url,
      );
      return NextResponse.rewrite(rewriteUrl, { headers: response.headers });
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
