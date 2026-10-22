import Link from "next/link";
import { headers } from "next/headers";
import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getShellIdentity } from "@/lib/identity";
import {
  defaultTenantLanding,
  isValidTenantSlug,
  TENANT_ROUTES,
  tenantPath,
} from "@/lib/tenancy";

/**
 * notFound() from a page in the agent app (a deleted ticket, a stale customer
 * link) lands here, inside the shell, instead of on the marketing 404.
 *
 * not-found.tsx gets no params, so the tenant comes from x-tenant-slug, which
 * only the proxy can set. getShellIdentity is cached, so asking it again for
 * the role costs nothing: the layout above already resolved it.
 */
export default async function TenantNotFound() {
  const slug = (await headers()).get("x-tenant-slug");
  const identity = isValidTenantSlug(slug)
    ? await getShellIdentity(slug)
    : null;

  const landing = defaultTenantLanding(identity?.user.role);
  const href = isValidTenantSlug(slug) ? tenantPath(slug, landing) : "/";
  const label =
    landing === TENANT_ROUTES.ACCOUNT.BILLING
      ? "Go to billing"
      : "Go to tickets";

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-brand-badge text-brand-accent">
        <SearchX className="h-6 w-6" />
      </span>

      <h2 className="text-lg font-semibold text-foreground">
        We couldn&apos;t find that page
      </h2>

      <p className="max-w-sm text-sm text-muted-foreground">
        It may have been deleted, or the link may be out of date.
      </p>

      <Button asChild variant="outline" className="mt-2 h-9 font-semibold">
        <Link href={href}>{label}</Link>
      </Button>
    </div>
  );
}
