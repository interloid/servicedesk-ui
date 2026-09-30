import { redirect } from "next/navigation";

import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";
import { getPortalIdentity } from "@/features/portal/services/portal.service";

/** /{slug}/portal is an alias, not a screen: send people where they belong. */
export default async function PortalIndexPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const identity = await getPortalIdentity(tenantSlug);

  if (!identity) {
    redirect(portalPath(tenantSlug, PORTAL_ROUTES.LOGIN));
  }

  redirect(
    portalPath(
      tenantSlug,
      identity.customer.onboarded
        ? PORTAL_ROUTES.REQUESTS
        : PORTAL_ROUTES.WELCOME,
    ),
  );
}
