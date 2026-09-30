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
  markPortalWelcomeShown,
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

  // Stamped before the wizard renders, so this is the only time it shows:
  // a refresh, a second sign-in link, or the back button all land on the
  // requests from here on. Skip / Next / Go still call the same action, which
  // is harmless the second time.
  const [firstResponseTarget] = await Promise.all([
    getFirstResponseTarget(identity.tenant.id),
    markPortalWelcomeShown(tenantSlug, identity.userId),
  ]);

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
