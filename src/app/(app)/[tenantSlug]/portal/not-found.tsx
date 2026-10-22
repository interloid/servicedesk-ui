"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";

/**
 * The portal's own not-found page, for notFound() from a portal page -- a stale
 * or mistyped request link, most often. It sits under portal/layout.tsx, so the
 * tenant's branded header stays on screen and the way back is the customer's
 * own requests, not the root 404's "Return home" to our marketing site.
 *
 * A client component for useParams: not-found files take no props, and the
 * link needs the tenant slug. An unknown tenant is the layout's own notFound(),
 * which this boundary doesn't catch -- that one still ends at the root page.
 */
export default function PortalNotFound() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h2 className="text-lg font-semibold text-foreground">
        We couldn&apos;t find that page
      </h2>

      <p className="max-w-sm text-sm text-muted-foreground">
        The link may be out of date, or the request may belong to another
        account. Your requests are all still in one place.
      </p>

      <Button asChild variant="outline" className="mt-2 h-9 font-semibold">
        <Link href={portalPath(tenantSlug, PORTAL_ROUTES.REQUESTS)}>
          Back to your requests
        </Link>
      </Button>
    </div>
  );
}
