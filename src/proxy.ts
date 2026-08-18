import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import {
  AUTH_COOKIE_DOMAIN,
  DEFAULT_TENANT_PATH,
  SUBDOMAIN_ROUTING_AVAILABLE,
  TENANT_HINT_COOKIE,
  TENANT_HINT_MAX_AGE,
  allowsExistingSession,
  isCentralPath,
  isInfrastructurePath,
  isTenantPublicPath,
  isValidTenantSlug,
  stripTenantPrefix,
  tenantLabelFromHost,
  tenantLoginPath,
  tenantPath,
  withTenantPrefix,
} from "@/lib/tenancy";
import { env } from "./config/env";

const ROOT_PATH = "/";

function withSessionCookies(
  target: NextResponse,
  source: NextResponse,
): NextResponse {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  return target;
}

function rememberTenant(response: NextResponse, slug: string): NextResponse {
  response.cookies.set(TENANT_HINT_COOKIE, slug, {
    path: "/",
    sameSite: "lax",
    maxAge: TENANT_HINT_MAX_AGE,
    secure: process.env.NODE_ENV === "production",
    ...(AUTH_COOKIE_DOMAIN ? { domain: AUTH_COOKIE_DOMAIN } : {}),
  });
  return response;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const hostHeader = request.headers.get("host") || "";
  if (!SUBDOMAIN_ROUTING_AVAILABLE && hostHeader.includes(".localhost")) {
    const cleanUrl = new URL(request.url);
    cleanUrl.host = hostHeader.split(":")[1]
      ? `localhost:${hostHeader.split(":")[1]}`
      : "localhost:3000";
    return NextResponse.redirect(cleanUrl);
  }

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
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

  const pathTenant = stripTenantPrefix(pathname);

  if (pathTenant) {
    const { slug, rest } = pathTenant;

    if (isInfrastructurePath(rest)) {
      return rememberTenant(response, slug);
    }

    if (isCentralPath(rest)) {
      return withSessionCookies(
        NextResponse.redirect(new URL(`${rest}${url.search}`, request.url)),
        response,
      );
    }

    const isPublic = isTenantPublicPath(rest);

    if (!user && !isPublic) {
      const loginUrl = new URL(
        tenantLoginPath(slug, rest === "/" ? null : `${rest}${url.search}`),
        request.url,
      );
      return rememberTenant(
        withSessionCookies(NextResponse.redirect(loginUrl), response),
        slug,
      );
    }

    const bounceAuthedVisitor =
      user && (rest === "/" || (isPublic && !allowsExistingSession(rest)));

    if (bounceAuthedVisitor) {
      return rememberTenant(
        withSessionCookies(
          NextResponse.redirect(
            new URL(tenantPath(slug, DEFAULT_TENANT_PATH), request.url),
          ),
          response,
        ),
        slug,
      );
    }

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-tenant-slug", slug);

    return rememberTenant(
      withSessionCookies(
        NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        }),
        response,
      ),
      slug,
    );
  }

  if (SUBDOMAIN_ROUTING_AVAILABLE) {
    const slugFromSubdomain = tenantLabelFromHost(hostHeader);

    if (slugFromSubdomain) {
      if (isCentralPath(pathname)) {
        const scheme = url.protocol.replace(":", "");
        return withSessionCookies(
          NextResponse.redirect(
            new URL(
              `${pathname}${url.search}`,
              `${scheme}://${process.env.NEXT_PUBLIC_APP_DOMAIN}`,
            ),
          ),
          response,
        );
      }

      if (!user && !isTenantPublicPath(pathname)) {
        const loginUrl = new URL("/login", request.url);
        if (pathname !== ROOT_PATH) {
          loginUrl.searchParams.set("next", `${pathname}${url.search}`);
        }
        return withSessionCookies(NextResponse.redirect(loginUrl), response);
      }

      if (
        user &&
        (pathname === ROOT_PATH ||
          (isTenantPublicPath(pathname) && !allowsExistingSession(pathname)))
      ) {
        return withSessionCookies(
          NextResponse.redirect(new URL(DEFAULT_TENANT_PATH, request.url)),
          response,
        );
      }

      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-tenant-slug", slugFromSubdomain);

      return withSessionCookies(
        NextResponse.rewrite(
          new URL(
            tenantPath(slugFromSubdomain, `${pathname}${url.search}`),
            request.url,
          ),
          {
            request: { headers: requestHeaders },
            headers: response.headers,
          },
        ),
        response,
      );
    }
  }

  if (pathname === ROOT_PATH || isCentralPath(pathname)) {
    return response;
  }

  if (user) {
    const { data: claimsData } = await supabase.auth.getClaims();
    const claimSlug = claimsData?.claims?.tenant_slug as string | undefined;

    if (isValidTenantSlug(claimSlug)) {
      const target = withTenantPrefix(claimSlug, pathname);
      return rememberTenant(
        withSessionCookies(
          NextResponse.redirect(new URL(`${target}${url.search}`, request.url)),
          response,
        ),
        claimSlug,
      );
    }

    return response;
  }

  const hintedSlug = request.cookies.get(TENANT_HINT_COOKIE)?.value;

  if (isValidTenantSlug(hintedSlug)) {
    const target = isTenantPublicPath(pathname)
      ? withTenantPrefix(hintedSlug, pathname)
      : tenantLoginPath(hintedSlug, `${pathname}${url.search}`);

    return withSessionCookies(
      NextResponse.redirect(new URL(target, request.url)),
      response,
    );
  }

  if (isTenantPublicPath(pathname)) {
    return response;
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${url.search}`);

  return withSessionCookies(NextResponse.redirect(loginUrl), response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
