import type { Metadata } from "next";

import { PortalHelpSearch } from "@/features/portal/components/portal-help-search";
import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";
import { getPortalTenant } from "@/features/portal/services/portal.service";

export const metadata: Metadata = {
  title: "Help centre",
};

/**
 * There is no knowledge-base table yet, so nothing here opens an article. The
 * page itself only supplies the tenant's name -- which one topic is named
 * after -- and the request form's path; the search box and the topic list live
 * in PortalHelpSearch. When articles exist, the client component is where they
 * get filtered and the cards get pointed at them.
 */
export default async function PortalHelpPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const tenant = await getPortalTenant(tenantSlug);

  return (
    <div className="mx-auto w-full max-w-7xl md:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          Help centre
        </h1>

        <p className="mt-2 text-sm leading-[1.6] text-muted-foreground">
          Search the topics below. If none of them fit, we&apos;ll turn it into
          a request.
        </p>
      </div>

      <PortalHelpSearch
        productName={tenant?.name ?? "the product"}
        newRequest={portalPath(tenantSlug, PORTAL_ROUTES.NEW_REQUEST)}
      />
    </div>
  );
}
