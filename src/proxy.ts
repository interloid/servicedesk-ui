import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AUTH_COOKIE_DOMAIN,
  SUBDOMAIN_ROUTING_AVAILABLE,
  TENANT_HINT_COOKIE,
  TENANT_HINT_MAX_AGE,
  allowsExistingSession,
  defaultTenantLanding,
  isCentralPath,
  isInfrastructurePath,
  isPortalPath,
  isTenantPublicPath,
  isTenantRouteAllowed,
  isValidTenantSlug,
  isStaffRole,
  sessionTenantDestination,
  stripTenantPrefix,
  tenantLabelFromHost,
  tenantLoginPath,
  tenantPath,
} from "@/lib/tenancy";

import { readTenantClaims } from "@/features/auth/claims";

import { APP_ROUTES } from "@/lib/routes";

import { env } from "./config/env";

const ROOT_PATH = "/";

const IS_HTTPS =
  process.env.NODE_ENV === "production" &&
  !env.NEXT_PUBLIC_SITE_URL.startsWith("http://localhost") &&
  !env.NEXT_PUBLIC_SITE_URL.startsWith("http://127.0.0.1");

function withSessionCookies(
  target: NextResponse,
  source: NextResponse,
): NextResponse {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }

  return target;
}

type SessionTenant = { slug: string | null; role: string | null };

// undefined means the claims could not be read at all.
async function resolveSessionTenant(
  supabase: SupabaseClient,
): Promise<SessionTenant | undefined> {
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError) {
    console.error("[proxy] claims lookup failed:", claimsError.message);
    return undefined;
  }

  const claims = readTenantClaims(claimsData?.claims);

  return {
    slug: claims.tenantSlug,
    role: claims.tenantRole,
  };
}

/**
 * A portal customer, identified by the role claim and never by a missing slug.
 *
 * The access token hook picks any non-disabled membership, and a customer has
 * one (portal_link_user gives them role = 'customer'), so their token carries a
 * real tenant_id and tenant_slug. Reading "no tenant" as "customer" therefore
 * never matches, and the customer fell through to the agent dashboard.
 */
function isCustomerSession(sessionTenant: SessionTenant | undefined): boolean {
  return sessionTenant !== undefined && sessionTenant.role === "customer";
}

/**
 * The mirror of isCustomerSession, for the portal branches below. Drawn from the
 * same STAFF_ROLES set the agent shell uses, so "who counts as staff" is decided
 * in exactly one place -- if the two drifted, a role could pass the shell and
 * fail the portal, or the reverse.
 *
 * A valid slug is part of the test, not a convenience: the only thing done with
 * a staff session here is send it to that tenant's dashboard, and a session with
 * no readable tenant has nowhere to go. Narrowing on it is what lets the callers
 * use the result without re-checking.
 */
function isStaffSession(
  sessionTenant: SessionTenant | undefined,
): sessionTenant is SessionTenant & { slug: string } {
  return (
    sessionTenant !== undefined &&
    isStaffRole(sessionTenant.role) &&
    isValidTenantSlug(sessionTenant.slug)
  );
}

function rememberTenant(response: NextResponse, slug: string): NextResponse {
  response.cookies.set(TENANT_HINT_COOKIE, slug, {
    path: "/",
    sameSite: "lax",
    maxAge: TENANT_HINT_MAX_AGE,
    secure: IS_HTTPS,
    ...(AUTH_COOKIE_DOMAIN ? { domain: AUTH_COOKIE_DOMAIN } : {}),
  });

  return response;
}

/**
 * Send a staff session to the landing page of the workspace its token names.
 *
 * One rule, one place: it is reached from both the path-prefix and the
 * subdomain routing modes, where the only thing that differed was which tenant
 * value was in hand -- and isStaffSession has already narrowed that.
 */
function redirectStaffHome(
  sessionTenant: SessionTenant & { slug: string },
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  return withSessionCookies(
    NextResponse.redirect(
      new URL(
        sessionTenantDestination(sessionTenant.slug, "/", sessionTenant.role),
        request.url,
      ),
    ),
    response,
  );
}

export async function proxy(request: NextRequest) {
  return routeRequest(request);
}

async function routeRequest(request: NextRequest): Promise<NextResponse> {
  // x-tenant-slug is trusted downstream (see tenant-resolver.getTenantContext),
  // so it may only ever come from this proxy. Dropping it up front means the
  // pass-through branches below cannot leak a caller-supplied value.
  request.headers.delete("x-tenant-slug");

  let response = NextResponse.next({
    request,
  });

  const hostHeader = request.headers.get("host") || "";

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },

        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          response = NextResponse.next({
            request,
          });

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, {
              ...options,
              ...(AUTH_COOKIE_DOMAIN
                ? {
                    domain: AUTH_COOKIE_DOMAIN,
                  }
                : {}),
              path: "/",
              sameSite: "lax",
              secure: IS_HTTPS,
            });
          });
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

  if (isCentralPath(pathname)) {
    if (user) {
      const sessionTenant = await resolveSessionTenant(supabase);

      if (isValidTenantSlug(sessionTenant?.slug)) {
        // A customer is sent to /unauthorized *because* they have no agent
        // dashboard, so they must be allowed to render it. Bouncing them would
        // resolve defaultTenantLanding("customer") to /tickets -- the very
        // route that turned them away -- and ping-pong between the two forever.
        // /setup is the one central page a customer session may not use: it
        // could start a workspace with a customer token. /login stays open --
        // signing in there replaces the customer session, and /unauthorized
        // has no sign-out, so blocking it would strand someone who also has a
        // team account.
        if (isCustomerSession(sessionTenant)) {
          if (pathname === APP_ROUTES.SETUP) {
            return withSessionCookies(
              NextResponse.redirect(
                new URL(APP_ROUTES.UNAUTHORIZED, request.url),
              ),
              response,
            );
          }
        } else {
          return withSessionCookies(
            NextResponse.redirect(
              new URL(
                sessionTenantDestination(
                  sessionTenant!.slug,
                  "/",
                  sessionTenant?.role,
                ),
                request.url,
              ),
            ),
            response,
          );
        }
      }
    }

    return response;
  }

  const pathTenant = stripTenantPrefix(pathname);

  if (pathTenant) {
    const { slug, rest } = pathTenant;

    if (isPortalPath(rest)) {
      // The portal runs its own sign-in, so an anonymous visitor is expected
      // here and is not turned away. A *staff* session is not: the portal
      // resolves identity through getPortalIdentity, which returns null for
      // anyone holding a team membership, and the page then redirects to the
      // customer magic-link form -- a customer sign-in surface shown to an
      // agent. Say no here instead.
      if (user) {
        const sessionTenant = await resolveSessionTenant(supabase);

        if (isStaffSession(sessionTenant)) {
          // Their own dashboard, not /unauthorized: that page explains that
          // "your account is a customer account" and links to a portal, which is
          // nonsense for an agent who mistyped a URL. Bouncing to the landing
          // page is also what every other staff guard in this file does, and it
          // cannot ping-pong, since the dashboard is a route they are allowed.
          return redirectStaffHome(sessionTenant, request, response);
        }
      }

      const requestHeaders = new Headers(request.headers);

      requestHeaders.set("x-tenant-slug", slug);

      return withSessionCookies(
        NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        }),
        response,
      );
    }

    let sessionTenant: SessionTenant | undefined;

    if (user) {
      sessionTenant = await resolveSessionTenant(supabase);

      if (
        isValidTenantSlug(sessionTenant?.slug) &&
        sessionTenant!.slug !== slug
      ) {
        const target = sessionTenantDestination(
          sessionTenant!.slug,
          rest,
          sessionTenant?.role,
        );

        return withSessionCookies(
          NextResponse.redirect(new URL(`${target}${url.search}`, request.url)),
          response,
        );
      }
    }

    const isPublic = isTenantPublicPath(rest);

    // A customer holds a real membership, so nothing above turns them away and
    // the agent app would happily render the dashboard on their session. Say no
    // here instead: the page is tenant-less, so no workspace chrome leaks. The
    // sign-in pages stay reachable (isPublic) so an agent can still sign in.
    if (user && isCustomerSession(sessionTenant) && !isPublic) {
      const denied = new URL(APP_ROUTES.UNAUTHORIZED, request.url);
      denied.searchParams.set("tenant", slug);

      return withSessionCookies(NextResponse.redirect(denied), response);
    }

    if (!user && !isPublic) {
      const nextPath = rest === "/" ? null : `${rest}${url.search}`;

      const loginUrl = new URL(tenantLoginPath(slug, nextPath), request.url);

      return rememberTenant(
        withSessionCookies(NextResponse.redirect(loginUrl), response),
        slug,
      );
    }

    const bounceAuthedVisitor =
      user &&
      !isCustomerSession(sessionTenant) &&
      (rest === "/" || (isPublic && !allowsExistingSession(rest)));

    if (bounceAuthedVisitor) {
      return rememberTenant(
        withSessionCookies(
          NextResponse.redirect(
            new URL(
              tenantPath(slug, defaultTenantLanding(sessionTenant?.role)),
              request.url,
            ),
          ),
          response,
        ),
        slug,
      );
    }

    if (
      user &&
      sessionTenant &&
      !isTenantRouteAllowed(sessionTenant.role, rest)
    ) {
      return rememberTenant(
        withSessionCookies(
          NextResponse.redirect(
            new URL(
              tenantPath(slug, defaultTenantLanding(sessionTenant.role)),
              request.url,
            ),
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
      if (isPortalPath(pathname)) {
        // The same staff check as the path-prefix branch above, and now the
        // same helper: without it this rewrite hands a staff session the
        // customer magic-link screen.
        if (user) {
          const sessionTenant = await resolveSessionTenant(supabase);

          if (isStaffSession(sessionTenant)) {
            return redirectStaffHome(sessionTenant, request, response);
          }
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
              request: {
                headers: requestHeaders,
              },
              headers: response.headers,
            },
          ),
          response,
        );
      }

      let sessionTenant: SessionTenant | undefined;

      if (user) {
        sessionTenant = await resolveSessionTenant(supabase);

        if (
          isValidTenantSlug(sessionTenant?.slug) &&
          sessionTenant!.slug !== slugFromSubdomain
        ) {
          return withSessionCookies(
            NextResponse.redirect(
              new URL(
                sessionTenantDestination(
                  sessionTenant!.slug,
                  pathname,
                  sessionTenant?.role,
                ),
                request.url,
              ),
            ),
            response,
          );
        }
      }

      if (
        user &&
        isCustomerSession(sessionTenant) &&
        !isTenantPublicPath(pathname)
      ) {
        const denied = new URL(APP_ROUTES.UNAUTHORIZED, request.url);
        denied.searchParams.set("tenant", slugFromSubdomain);

        return withSessionCookies(NextResponse.redirect(denied), response);
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
        !isCustomerSession(sessionTenant) &&
        (pathname === ROOT_PATH ||
          (isTenantPublicPath(pathname) && !allowsExistingSession(pathname)))
      ) {
        return withSessionCookies(
          NextResponse.redirect(
            new URL(defaultTenantLanding(sessionTenant?.role), request.url),
          ),
          response,
        );
      }

      if (
        user &&
        sessionTenant &&
        !isTenantRouteAllowed(sessionTenant.role, pathname)
      ) {
        return withSessionCookies(
          NextResponse.redirect(
            new URL(defaultTenantLanding(sessionTenant.role), request.url),
          ),
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
            request: {
              headers: requestHeaders,
            },
            headers: response.headers,
          },
        ),
        response,
      );
    }
  }

  if (pathname === ROOT_PATH) {
    return response;
  }

  const hintedSlug = request.cookies.get(TENANT_HINT_COOKIE)?.value;

  if (isValidTenantSlug(hintedSlug)) {
    if (isTenantPublicPath(pathname)) {
      return withSessionCookies(
        NextResponse.redirect(
          new URL(tenantPath(hintedSlug, pathname), request.url),
        ),
        response,
      );
    }
    const loginUrl = new URL(
      tenantLoginPath(hintedSlug, `${pathname}${url.search}`),
      request.url,
    );

    return withSessionCookies(NextResponse.redirect(loginUrl), response);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
