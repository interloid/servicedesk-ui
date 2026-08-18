import { APP_ROUTES } from "./routes";

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

  return null;
}

function normalizePath(path: string): string {
  if (!path) return "/";

  return path.startsWith("/") ? path : `/${path}`;
}

export const TENANT_ROUTES = {
  TICKETS: "/tickets",
  VIEWS: "/views",
  CUSTOMERS: "/customers",
  KNOWLEDGE_BASE: "/kb",
  MACROS: "/macros",
  SLA: "/sla",

  LOGIN: "/login",
  FORGOT_PASSWORD: "/forgot-password",
  RESET_PASSWORD: "/reset-password",

  SETTINGS: {
    TEAM: "/settings/team",
    BRANDING: "/settings/branding",
    CHANNELS: "/settings/channels",
    INTEGRATIONS: "/settings/integrations",
    SECURITY: "/settings/security",
    DATA: "/settings/data",
    NOTIFICATIONS: "/settings/notifications",
    AUDIT: "/settings/audit",
  },

  ACCOUNT: {
    BILLING: "/account/billing",
    PLANS: "/account/plans",
  },
} as const;

export const TENANT_SEGMENT = "tenant";

export const DEFAULT_TENANT_PATH = TENANT_ROUTES.TICKETS;

export const TENANT_PUBLIC_PATHS = new Set<string>([
  TENANT_ROUTES.LOGIN,
  TENANT_ROUTES.FORGOT_PASSWORD,
  TENANT_ROUTES.RESET_PASSWORD,
]);

const SESSION_TOLERANT_PATHS = new Set<string>([TENANT_ROUTES.RESET_PASSWORD]);

export const CENTRAL_PATHS = new Set<string>([APP_ROUTES.SETUP]);

export const TENANT_HINT_COOKIE = "sd_tenant";
export const TENANT_HINT_MAX_AGE = 60 * 60 * 24 * 30;

export function isValidTenantSlug(
  slug: string | undefined | null,
): slug is string {
  return typeof slug === "string" && SUBDOMAIN_LABEL.test(slug.toLowerCase());
}

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

export function allowsExistingSession(tenantRelativePath: string): boolean {
  return SESSION_TOLERANT_PATHS.has(tenantRelativePath);
}

export function isCentralPath(pathname: string): boolean {
  return CENTRAL_PATHS.has(pathname);
}

export function isSafeInternalPath(
  path: string | null | undefined,
): path is string {
  return Boolean(path && path.startsWith("/") && !path.startsWith("//"));
}

export function tenantPath(slug: string, path = "/"): string {
  return `/${TENANT_SEGMENT}/${encodeURIComponent(slug)}${normalizePath(path)}`;
}

export function tenantLoginPath(slug: string, next?: string | null): string {
  const base = tenantPath(slug, TENANT_ROUTES.LOGIN);

  if (!next || next === "/") {
    return base;
  }

  return `${base}?next=${encodeURIComponent(next)}`;
}

export function tenantForgotPasswordPath(slug: string): string {
  return tenantPath(slug, TENANT_ROUTES.FORGOT_PASSWORD);
}

export function tenantResetPasswordPath(slug: string): string {
  return tenantPath(slug, TENANT_ROUTES.RESET_PASSWORD);
}

export function tenantAuthCallbackPath(
  slug: string,
  next?: string | null,
): string {
  const base = tenantPath(slug, "/auth/callback");

  if (!next) {
    return base;
  }

  return `${base}?next=${encodeURIComponent(next)}`;
}

const TENANT_PATH_PATTERN = new RegExp(`^/${TENANT_SEGMENT}/([^/]+)(/.*)?$`);

export function stripTenantPrefix(
  pathname: string,
): { slug: string; rest: string } | null {
  const match = TENANT_PATH_PATTERN.exec(pathname);

  if (!match || !match[1]) {
    return null;
  }

  return {
    slug: decodeURIComponent(match[1]),
    rest: match[2] || "/",
  };
}

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

export function withTenantPrefix(slug: string, pathname: string): string {
  if (stripTenantPrefix(pathname) || isCentralPath(pathname)) {
    return pathname;
  }

  return tenantPath(slug, pathname);
}
