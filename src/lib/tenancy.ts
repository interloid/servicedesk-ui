/**
 * Tenant path & domain resolution for path-based tenancy (/tenant/<slug>/...).
 *
 * Every tenant-scoped route — `tickets`, `login`, `forgot-password`,
 * `reset-password`, … — lives under the same prefix, e.g.
 * `http://localhost:3000/tenant/converse/tickets`. This module is the single
 * source of truth for building and parsing those paths; the proxy and the auth
 * flows should never hand-roll a `/tenant/...` string.
 */

function normalizeBaseDomain(raw: string | undefined): string | null {
  const trimmed = raw?.trim().toLowerCase();
  if (!trimmed) return null;

  return trimmed
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/^\./, "");
}

export const PORTAL_BASE_DOMAIN =
  normalizeBaseDomain(process.env.NEXT_PUBLIC_APP_DOMAIN) ?? "localhost:3000";

function stripPort(host: string): string {
  if (host.startsWith("[")) return host;
  return host.split(":")[0] ?? host;
}

export const PORTAL_BASE_HOSTNAME = stripPort(PORTAL_BASE_DOMAIN);

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;
const SUBDOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

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

export const IS_LOCAL_HOST = PORTAL_BASE_HOSTNAME === "localhost";
export const IS_VERCEL_APP_DOMAIN =
  PORTAL_BASE_HOSTNAME.endsWith(".vercel.app");

/**
 * Kept for optional custom-domain deployments. Defaulting to path-based routing on
 * localhost and vercel.app.
 */
export const SUBDOMAIN_ROUTING_AVAILABLE =
  !IS_LOCAL_HOST &&
  !IS_VERCEL_APP_DOMAIN &&
  !IPV4_LITERAL.test(PORTAL_BASE_HOSTNAME) &&
  !PORTAL_BASE_HOSTNAME.startsWith("[");

export const CAN_SHARE_SUBDOMAIN_COOKIES =
  SUBDOMAIN_ROUTING_AVAILABLE &&
  PORTAL_BASE_HOSTNAME.includes(".") &&
  !PORTAL_BASE_HOSTNAME.endsWith(".localhost");

export const AUTH_COOKIE_DOMAIN = CAN_SHARE_SUBDOMAIN_COOKIES
  ? `.${PORTAL_BASE_HOSTNAME}`
  : undefined;

function isValidTenantLabel(label: string): boolean {
  return !RESERVED_LABELS.has(label) && SUBDOMAIN_LABEL.test(label);
}

/**
 * Strips any stray subdomain prefix when constructing path-based URLs
 * (e.g., converts "converse.localhost:3000" back to "localhost:3000").
 */
function getRootBaseDomain(): string {
  if (IS_LOCAL_HOST || PORTAL_BASE_HOSTNAME.endsWith(".localhost")) {
    const parts = PORTAL_BASE_DOMAIN.split(":");
    const port = parts[1] ? `:${parts[1]}` : "";
    return `localhost${port}`;
  }
  return PORTAL_BASE_DOMAIN;
}

export function tenantLabelFromHost(
  host: string | null | undefined,
): string | null {
  if (!host || !SUBDOMAIN_ROUTING_AVAILABLE) {
    return null;
  }

  const trimmed = stripPort(host.trim().toLowerCase());
  if (!trimmed) return null;

  const base = PORTAL_BASE_HOSTNAME;
  if (trimmed === base || trimmed === `www.${base}`) return null;

  if (trimmed.endsWith(`.${base}`)) {
    const label = trimmed.slice(0, trimmed.length - base.length - 1);
    return isValidTenantLabel(label) ? label : null;
  }

  return null;
}

function normalizePath(path: string): string {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

/** URL segment that opens a tenant workspace: `/tenant/<slug>/...` */
export const TENANT_SEGMENT = "tenant";

/** Landing route for a signed-in member, relative to the tenant prefix. */
export const DEFAULT_TENANT_PATH = "/tickets";
export const TENANT_VIEWS_PATH = "/views";
export const TENANT_LOGIN_PATH = "/login";
export const TENANT_FORGOT_PASSWORD_PATH = "/forgot-password";
export const TENANT_RESET_PASSWORD_PATH = "/reset-password";

/**
 * Tenant-relative routes reachable without a session. They are still tenant
 * scoped, so `/tenant/converse/login` is the canonical login URL.
 */
export const TENANT_PUBLIC_PATHS = new Set<string>([
  TENANT_LOGIN_PATH,
  TENANT_FORGOT_PASSWORD_PATH,
  TENANT_RESET_PASSWORD_PATH,
]);

/**
 * Public routes that a signed-in member may still open. Password recovery links
 * sign the user in before landing on `reset-password`, so bouncing authed users
 * away from it would break the flow.
 */
const SESSION_TOLERANT_PATHS = new Set<string>([TENANT_RESET_PASSWORD_PATH]);

/** Routes that only exist on the root domain, never inside a tenant. */
export const CENTRAL_PATHS = new Set<string>(["/setup"]);

/**
 * Remembers the last workspace a visitor touched so bare `/login` and
 * `/forgot-password` can be sent back to `/tenant/<slug>/...` after the session
 * is gone. Purely a routing hint — never a trust boundary.
 */
export const TENANT_HINT_COOKIE = "sd_tenant";
export const TENANT_HINT_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Guards the hint cookie and session claims: only well-formed slugs are ever
 * echoed into a URL. Unlike subdomain labels, path slugs may use reserved words
 * (`/tenant/admin/tickets` is unambiguous), so only the shape is checked.
 */
export function isValidTenantSlug(
  slug: string | undefined | null,
): slug is string {
  return typeof slug === "string" && SUBDOMAIN_LABEL.test(slug.toLowerCase());
}

/** Framework/API routes the tenant guard must never redirect. */
export function isInfrastructurePath(pathname: string): boolean {
  return (
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico"
  );
}

export function isTenantPublicPath(tenantRelativePath: string): boolean {
  return TENANT_PUBLIC_PATHS.has(tenantRelativePath);
}

/** True when an authenticated visitor should be left on this public route. */
export function allowsExistingSession(tenantRelativePath: string): boolean {
  return SESSION_TOLERANT_PATHS.has(tenantRelativePath);
}

export function isCentralPath(pathname: string): boolean {
  return CENTRAL_PATHS.has(pathname);
}

/** Returns `/tenant/<slug>/<path>` matching `app/(app)/tenant/[tenantSlug]` */
export function tenantPath(slug: string, path = "/"): string {
  return `/${TENANT_SEGMENT}/${encodeURIComponent(slug)}${normalizePath(path)}`;
}

/** `/tenant/<slug>/login`, carrying the blocked destination as `?next=`. */
export function tenantLoginPath(slug: string, next?: string | null): string {
  const base = tenantPath(slug, TENANT_LOGIN_PATH);
  if (!next || next === "/") return base;

  return `${base}?next=${encodeURIComponent(next)}`;
}

export function tenantForgotPasswordPath(slug: string): string {
  return tenantPath(slug, TENANT_FORGOT_PASSWORD_PATH);
}

export function tenantResetPasswordPath(slug: string): string {
  return tenantPath(slug, TENANT_RESET_PASSWORD_PATH);
}

export function tenantAuthCallbackPath(
  slug: string,
  next?: string | null,
): string {
  const base = tenantPath(slug, "/auth/callback");
  if (!next) return base;

  return `${base}?next=${encodeURIComponent(next)}`;
}

const TENANT_PATH_PATTERN = new RegExp(`^/${TENANT_SEGMENT}/([^/]+)(/.*)?$`);

export function stripTenantPrefix(
  pathname: string,
): { slug: string; rest: string } | null {
  const match = TENANT_PATH_PATTERN.exec(pathname);
  if (!match || !match[1]) return null;

  return { slug: decodeURIComponent(match[1]), rest: match[2] || "/" };
}

/** `/tenant/<slug>` with no trailing slash — the prefix every tenant route shares. */
export function tenantPrefix(slug: string): string {
  return `/${TENANT_SEGMENT}/${encodeURIComponent(slug)}`;
}

export function portalUrlForSlug(slug: string): string {
  const rootDomain = getRootBaseDomain();
  if (!SUBDOMAIN_ROUTING_AVAILABLE) {
    return `${rootDomain}${tenantPrefix(slug)}`;
  }
  return `${slug}.${rootDomain}`;
}

export function portalOriginForSlug(slug: string, protocol?: string): string {
  const defaultScheme = IS_LOCAL_HOST ? "http" : "https";
  const scheme = protocol ? protocol.replace(":", "") : defaultScheme;
  const rootDomain = getRootBaseDomain();

  if (!SUBDOMAIN_ROUTING_AVAILABLE) {
    return `${scheme}://${rootDomain}${tenantPrefix(slug)}`;
  }
  return `${scheme}://${slug}.${rootDomain}`;
}

export function landingUrlForSlug(
  slug: string,
  path: string = DEFAULT_TENANT_PATH,
): string {
  return tenantPath(slug, normalizePath(path));
}

/**
 * Rewrites a bare path onto its tenant equivalent, leaving already-prefixed and
 * central paths untouched — `/login` -> `/tenant/converse/login`.
 */
export function withTenantPrefix(slug: string, pathname: string): string {
  if (stripTenantPrefix(pathname) || isCentralPath(pathname)) {
    return pathname;
  }

  return tenantPath(slug, pathname);
}
