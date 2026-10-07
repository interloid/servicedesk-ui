import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PortalWelcomeWizard } from "@/features/portal/components/portal-welcome-wizard";
import {
  firstNameFrom,
  PORTAL_ROUTES,
  portalPath,
} from "@/features/portal/portal";
import {
  getFirstResponseTarget,
  getPortalIdentity,
} from "@/features/portal/services/portal.service";

export const metadata: Metadata = {
  title: "Welcome",
};

export default async function PortalWelcomePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const identity = await getPortalIdentity(tenantSlug);

  if (!identity) {
    redirect(portalPath(tenantSlug, PORTAL_ROUTES.LOGIN));
  }

  // Reachable directly from the URL, so the "already done it" case is handled
  // here and not only by the sign-in redirect that normally lands here.
  if (identity.customer.onboarded) {
    redirect(portalPath(tenantSlug, PORTAL_ROUTES.REQUESTS));
  }

  // Nothing is written here. The "shown once" stamp is a server action the
  // wizard calls once it has mounted in the browser, so a prefetch or a
  // replayed render of this page cannot spend the wizard before the customer
  // has seen it. See markWelcomeShownAction.

  const firstResponseTarget = await getFirstResponseTarget(identity.tenant.id);

  return (
    <PortalWelcomeWizard
      tenantSlug={tenantSlug}
      firstName={firstNameFrom(
        identity.customer.fullName,
        identity.customer.email,
      )}
      company={identity.customer.company}
      firstResponseTarget={firstResponseTarget}
    />
  );
}
