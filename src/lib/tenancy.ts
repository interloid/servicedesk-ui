/**
 * Tenant subdomain resolution — the pure, client-safe half of tenancy.
 *
 * Every workspace is served on its own subdomain of the portal base domain:
 *   northwind.servicedesk.pro, jan.servicedesk.pro, …
 *
 * This module only does STRING work: it turns a `Host` header into a tenant slug
 * (or null) and derives portal URLs. It must stay dependency-free and side-effect
 * free so the branding page, the login card, the proxy and the portal chrome can
 * all import it — nothing here touches `next/headers`, Supabase or the database.
 * The server-side half (resolving a slug to a tenant row) lives in
 * `features/tenancy/services/tenant-resolver.ts`.
 *
 * The base domain comes from ONE place, `NEXT_PUBLIC_APP_DOMAIN`
 * (`localhost:3000` in dev, `servicedesk.pro` in production). It is read as a
 * static `process.env.NEXT_PUBLIC_*` reference so Next inlines it into the client
 * bundle and the proxy alike; every other module derives from the exports here
 * rather than reading the variable again.
 */

/** Strip a scheme, a trailing slash and a leading dot off a configured domain. */
function normalizeBaseDomain(raw: string | undefined): string | null {
  const trimmed = raw?.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  return trimmed
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/^\./, "");
}

/**
 * The domain every tenant subdomain hangs off, WITH the port when there is one.
 * `jan.service.com` = jan on `service.com`.
 */
export const PORTAL_BASE_DOMAIN =
  normalizeBaseDomain(process.env.NEXT_PUBLIC_APP_DOMAIN) ?? "localhost:3000";

/**
 * One DNS subdomain label: lowercase alphanumerics and inner hyphens, 1–63 chars,
 * and it may not start or end with a hyphen. `tenants.slug` is validated against
 * the same shape at registration, so any slug that exists satisfies this.
 */
const SUBDOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Labels that name the product itself rather than a workspace. A tenant can never
 * claim one of these, so the proxy must not treat them as a tenant host.
 */
const RESERVED_LABELS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "auth",
  "static",
  "assets",
  "cdn",
  "mail",
]);

/**
 * Drop the port from a `Host` header (`jan.localhost:3000` → `jan.localhost`).
 * IPv6 literals start with `[` and carry `:port` after the closing bracket, so they
 * are passed through untouched.
 */
function stripPort(host: string): string {
  if (host.startsWith("[")) {
    return host;
  }

  return host.split(":")[0] ?? host;
}

/** The base domain without its port — what a cookie `Domain` attribute needs. */
export const PORTAL_BASE_HOSTNAME = stripPort(PORTAL_BASE_DOMAIN);

/** A bare IPv4 literal — `127.0.0.1` names no subdomain and takes no cookie domain. */
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Whether `<slug>.<base>` is a host a browser can actually REACH here.
 *
 * True for any real multi-label domain, and true for plain `localhost`: RFC 6761
 * reserves `*.localhost` for the loopback, and Chrome, Firefox and Safari all
 * resolve it without a `/etc/hosts` entry — so `acme.localhost:3000` hits the dev
 * server exactly like `localhost:3000` does. Only a bare IP has no subdomain space.
 *
 * Deliberately distinct from `CAN_SHARE_SUBDOMAIN_COOKIES` below: being able to
 * reach the subdomain and being able to carry a session there are two different
 * questions, and on `localhost` the answers differ.
 */
export const SUBDOMAIN_ROUTING_AVAILABLE =
  !IPV4_LITERAL.test(PORTAL_BASE_HOSTNAME) && !PORTAL_BASE_HOSTNAME.startsWith("[");

/**
 * Whether one cookie can cover the base domain AND every tenant subdomain.
 *
 * Only true for a real multi-label domain. Browsers reject a `Domain` attribute on
 * a single-label host (`localhost`) or a bare IP — verified in Chrome: setting
 * `domain=.localhost` from `acme.localhost:3000` stores nothing at all. So on the
 * default dev domain the session cookie is host-only and CANNOT follow the browser
 * from `localhost:3000` to `acme.localhost:3000`.
 *
 * That is why `landingUrlForSlug` keeps a sign-in that ALREADY HOLDS a session on
 * the same origin, under `/tenant/<slug>`. It is not a reason to serve the signed-
 * OUT screens there: a visitor with no session has no cookie to lose, so they are
 * sent to the workspace subdomain instead and sign in directly on the host that
 * will own their session. Point `NEXT_PUBLIC_APP_DOMAIN` at something like
 * `lvh.me:3000` (resolves to 127.0.0.1) to get production's cross-subdomain
 * behaviour locally for the signed-in hop too.
 */
export const CAN_SHARE_SUBDOMAIN_COOKIES =
  PORTAL_BASE_HOSTNAME.includes(".") &&
  !IPV4_LITERAL.test(PORTAL_BASE_HOSTNAME) &&
  !PORTAL_BASE_HOSTNAME.endsWith(".localhost");

/**
 * The `Domain` to scope auth cookies to, or undefined for host-only cookies.
 * Used by BOTH cookie writers — `lib/supabase/server.ts` and the refresh inside
 * `proxy.ts` — so a refreshed cookie never shadows the one sign-in wrote.
 */
export const AUTH_COOKIE_DOMAIN = CAN_SHARE_SUBDOMAIN_COOKIES
  ? `.${PORTAL_BASE_HOSTNAME}`
  : undefined;

function isValidTenantLabel(label: string): boolean {
  return !RESERVED_LABELS.has(label) && SUBDOMAIN_LABEL.test(label);
}

/**
 * The tenant slug implied by a `Host` header, or null when the host names no
 * tenant — the bare base domain, a reserved label, `localhost`, an IP, or an
 * unknown shape.
 *
 * Matches `{label}.{PORTAL_BASE_DOMAIN}` in every environment. For local
 * development it also matches `{label}.localhost` (with or without a port) so a
 * `/etc/hosts` entry makes a subdomain reachable without a real DNS name.
 */
export function tenantLabelFromHost(
  host: string | null | undefined,
): string | null {
  if (!host) {
    return null;
  }

  const trimmed = stripPort(host.trim().toLowerCase());

  if (!trimmed) {
    return null;
  }

  const base = PORTAL_BASE_HOSTNAME;

  if (trimmed === base || trimmed === `www.${base}`) {
    return null;
  }

  if (trimmed.endsWith(`.${base}`)) {
    const label = trimmed.slice(0, trimmed.length - base.length - 1);

    return isValidTenantLabel(label) ? label : null;
  }

  if (trimmed.endsWith(".localhost")) {
    const label = trimmed.slice(0, trimmed.length - ".localhost".length);

    return isValidTenantLabel(label) ? label : null;
  }

  return null;
}

/** Whether the host is a tenant subdomain at all (as opposed to the bare base host). */
export function isTenantHost(host: string | null | undefined): boolean {
  return tenantLabelFromHost(host) !== null;
}

/** The public portal address for a slug — what branding and the portal display. */
export function portalUrlForSlug(slug: string): string {
  return `${slug}.${PORTAL_BASE_DOMAIN}`;
}

/** Absolute origin for a workspace, e.g. `https://acme.servicedesk.pro`. */
export function portalOriginForSlug(slug: string, protocol?: string): string {
  const scheme =
    protocol ?? (PORTAL_BASE_HOSTNAME === "localhost" ? "http" : "https");

  return `${scheme}://${portalUrlForSlug(slug)}`;
}

/** A path with a leading slash, so callers can pass `tickets` or `/tickets`. */
function normalizePath(path: string): string {
  if (!path) {
    return "/";
  }

  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * The INTERNAL route a tenant page lives at: `/tenant/acme/tickets`.
 *
 * On a tenant subdomain this is never what the address bar shows — `proxy.ts`
 * rewrites `/tickets` onto it and redirects the explicit form away. It is the
 * real, visible URL only on the bare base host, where there is no subdomain to
 * carry the tenant.
 */
export function tenantPath(slug: string, path = "/"): string {
  return `/tenant/${slug}${normalizePath(path)}`;
}

/**
 * Split `/tenant/<slug>/rest` into its parts, or null when the path names no
 * tenant. `/tenant/acme` (no trailing path) yields a `rest` of `/`.
 */
export function stripTenantPrefix(
  pathname: string,
): { slug: string; rest: string } | null {
  const match = /^\/tenant\/([^/]+)(\/.*)?$/.exec(pathname);

  if (!match) {
    return null;
  }

  const slug = match[1];

  if (!slug) {
    return null;
  }

  return { slug: decodeURIComponent(slug), rest: match[2] || "/" };
}

/**
 * Where a user should land in a given workspace, expressed relative to the host
 * they are on right now.
 *
 * The only thing that can go wrong on a hop to the subdomain is losing a session
 * cookie that cannot follow — so that is the single question this branches on.
 * `carriesSession` says whether the caller is holding a live session that has to
 * survive the trip. Pass `false` for a destination that authenticates the visitor
 * on arrival (the sign-in screen): there is nothing to lose, so the workspace
 * subdomain is always the better host — the session gets created directly on the
 * origin that will own it.
 *
 * In order:
 *   - already on that workspace's subdomain → the clean path (`/tickets`);
 *   - subdomain reachable, and either the cookie travels or there is no cookie to
 *     lose → the absolute subdomain URL;
 *   - otherwise → the same-origin `/tenant/<slug>` route, which keeps a live
 *     host-only session intact at the cost of a longer URL.
 */
export function landingUrlForSlug(
  slug: string,
  path = "/tickets",
  {
    currentSlug,
    protocol,
    carriesSession = true,
  }: {
    currentSlug?: string | null;
    protocol?: string;
    carriesSession?: boolean;
  } = {},
): string {
  const target = normalizePath(path);

  if (currentSlug === slug) {
    return target;
  }

  if (
    SUBDOMAIN_ROUTING_AVAILABLE &&
    (CAN_SHARE_SUBDOMAIN_COOKIES || !carriesSession)
  ) {
    return `${portalOriginForSlug(slug, protocol)}${target}`;
  }

  return tenantPath(slug, target);
}
