import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import {
  AUTH_COOKIE_DOMAIN,
  PORTAL_BASE_DOMAIN,
  SUBDOMAIN_ROUTING_AVAILABLE,
  portalOriginForSlug,
  stripTenantPrefix,
  tenantLabelFromHost,
  tenantPath,
} from "@/lib/tenancy";

/** Where a signed-in user goes when they ask for nothing in particular. */
const DEFAULT_AUTHED_PATH = "/tickets";

/** Reachable without a session, in tenant-path (post-rewrite) terms. */
const PUBLIC_PATHS = new Set(["/login", "/forgot-password", "/reset-password"]);

/** Central, non-tenant routes: they belong to the product, not to a workspace. */
const CENTRAL_PATHS = new Set(["/setup"]);

/**
 * Paths the tenant rewrite must never touch: the OAuth callback is a real route at
 * `/auth/callback` on every host, and API/static requests carry no tenant chrome.
 */
function isInfrastructurePath(pathname: string): boolean {
  return (
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

/**
 * Safely extracts the tenant slug from host header, handling both production
 * subdomains and local development (e.g. `converse.localhost:3000`).
 */
function resolveTenantSlug(host: string | null): string | null {
  if (!host) return null;

  const slugFromHelper = tenantLabelFromHost(host);
  if (slugFromHelper) return slugFromHelper;

  const hostname = host.split(":")[0];
  if (hostname.endsWith(".localhost")) {
    const parts = hostname.split(".");
    if (parts.length > 1 && parts[0] !== "www") {
      return parts[0];
    }
  }

  return null;
}

/**
 * The session guard, written once in terms of the CLEAN path (`/tickets`) and a
 * prefix that puts it back into whichever URL shape this host uses.
 */
function sessionGuard({
  authenticated,
  prefix,
  loginPrefix = prefix,
  path,
  search,
  requestUrl,
}: {
  authenticated: boolean;
  prefix: string;
  loginPrefix?: string;
  path: string;
  search: string;
  requestUrl: string;
}): NextResponse | null {
  const isPublic = isPublicPath(path);

  if (!authenticated) {
    if (isPublic && loginPrefix === prefix) {
      return null;
    }

    if (isPublic) {
      return NextResponse.redirect(
        new URL(`${loginPrefix}${path}${search}`, requestUrl),
      );
    }

    const loginUrl = new URL(`${loginPrefix}/login`, requestUrl);

    if (path !== "/") {
      loginUrl.searchParams.set("next", `${path}${search}`);
    }

    return NextResponse.redirect(loginUrl);
  }

  if (isPublic || path === "/") {
    return NextResponse.redirect(
      new URL(`${prefix}${DEFAULT_AUTHED_PATH}`, requestUrl),
    );
  }

  return null;
}

/**
 * Carry the refreshed session cookies onto a redirect/rewrite built independently.
 */
function withSessionCookies(
  target: NextResponse,
  source: NextResponse,
): NextResponse {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }

  return target;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

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
            response.cookies.set(name, value, {
              ...options,
              ...(AUTH_COOKIE_DOMAIN ? { domain: AUTH_COOKIE_DOMAIN } : {}),
              path: "/",
              sameSite: "lax",
              secure: process.env.NODE_ENV === "production",
            }),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const url = request.nextUrl;
  const pathname = url.pathname;

  if (isInfrastructurePath(pathname)) {
    return response;
  }

  const hostHeader = request.headers.get("host");
  const slug = resolveTenantSlug(hostHeader);

  if (!slug) {
    const pathTenant = stripTenantPrefix(pathname);

    if (pathTenant) {
      const scheme = url.protocol.replace(":", "");

      
      if (SUBDOMAIN_ROUTING_AVAILABLE) {
        const port = hostHeader?.includes(":") ? `:${hostHeader.split(":")[1]}` : "";
        const baseDomain = PORTAL_BASE_DOMAIN || "localhost";
        const targetOrigin = `${scheme}://${pathTenant.slug}.${baseDomain}`;

        return withSessionCookies(
          NextResponse.redirect(
            new URL(`${pathTenant.rest}${url.search}`, targetOrigin),
            308,
          ),
          response,
        );
      }

      const guarded = sessionGuard({
        authenticated: Boolean(user),
        prefix: `/tenant/${pathTenant.slug}`,
        loginPrefix: SUBDOMAIN_ROUTING_AVAILABLE
          ? portalOriginForSlug(pathTenant.slug, scheme)
          : undefined,
        path: pathTenant.rest,
        search: url.search,
        requestUrl: request.url,
      });

      if (guarded) {
        return withSessionCookies(guarded, response);
      }
    }

    return response;
  }

  const explicitTenant = stripTenantPrefix(pathname);

  if (explicitTenant) {
    return withSessionCookies(
      NextResponse.redirect(
        new URL(`${explicitTenant.rest}${url.search}`, request.url),
        308,
      ),
      response,
    );
  }

  if (CENTRAL_PATHS.has(pathname)) {
    const scheme = url.protocol.replace(":", "");

    return withSessionCookies(
      NextResponse.redirect(
        new URL(
          `${pathname}${url.search}`,
          `${scheme}://${PORTAL_BASE_DOMAIN}`,
        ),
      ),
      response,
    );
  }

  if (!user && !isPublicPath(pathname)) {
    const loginUrl = new URL("/login", request.url);

    if (pathname !== "/") {
      loginUrl.searchParams.set("next", `${pathname}${url.search}`);
    }

    return withSessionCookies(NextResponse.redirect(loginUrl), response);
  }

  if (user && (isPublicPath(pathname) || pathname === "/")) {
    return withSessionCookies(
      NextResponse.redirect(new URL(DEFAULT_AUTHED_PATH, request.url)),
      response,
    );
  }

  return NextResponse.rewrite(
    new URL(`${tenantPath(slug, pathname)}${url.search}`, request.url),
    { headers: response.headers },
  );
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};