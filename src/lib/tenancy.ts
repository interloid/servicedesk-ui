/**
 * Tenant subdomain resolution — the pure, client-safe half of tenancy.
 *
 * Every workspace is served on its own subdomain of the portal base domain:
 *   northwind.servicedesk.pro, jan.servicedesk.pro, …
 *
 * This module only does STRING work: it turns a `Host` header into a tenant slug
 * (or null) and derives portal URLs. It must stay dependency-free and side-effect
 * free so the branding page, the login card and the portal chrome can all import
 * it — nothing here touches `next/headers`, Supabase or the database. The
 * server-side half (resolving a slug to a tenant row) lives in
 * `features/tenancy/services/tenant-resolver.ts`.
 *
 * To serve workspaces on a different base (e.g. `service.com` instead of
 * `servicedesk.pro`) change `PORTAL_BASE_DOMAIN` here — one line, everywhere else
 * derives from it.
 */

/** The domain every tenant subdomain hangs off. `jan.service.com` = jan on `service.com`. */
export const PORTAL_BASE_DOMAIN = "servicedesk.pro";

/**
 * One DNS subdomain label: lowercase alphanumerics and inner hyphens, 1–63 chars,
 * and it may not start or end with a hyphen. `tenants.slug` is validated against
 * the same shape at registration, so any slug that exists satisfies this.
 */
const SUBDOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

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

function isValidTenantLabel(label: string): boolean {
  return label !== "www" && SUBDOMAIN_LABEL.test(label);
}

/**
 * The tenant slug implied by a `Host` header, or null when the host names no
 * tenant — the bare base domain, `www`, `localhost`, an IP, or an unknown shape.
 *
 * Matches `{label}.servicedesk.pro` in every environment. For local development
 * it also matches `{label}.localhost` (with or without a port) so a `/etc/hosts`
 * entry makes a subdomain reachable without a real DNS name.
 */
export function tenantLabelFromHost(host: string | null | undefined): string | null {
  if (!host) {
    return null;
  }

  const trimmed = stripPort(host.trim().toLowerCase());

  if (!trimmed) {
    return null;
  }

  const base = PORTAL_BASE_DOMAIN.toLowerCase();

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
