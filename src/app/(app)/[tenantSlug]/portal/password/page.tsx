import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PortalCard } from "@/features/portal/components/portal-shell";
import { PortalSetPasswordForm } from "@/features/portal/components/portal-set-password-form";
import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";
import { getPortalIdentity } from "@/features/portal/services/portal.service";

export const metadata: Metadata = {
  title: "Set a password",
};

export default async function PortalPasswordPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const identity = await getPortalIdentity(tenantSlug);

  if (!identity) {
    redirect(portalPath(tenantSlug, PORTAL_ROUTES.LOGIN));
  }

  return (
    <PortalCard>
      <PortalSetPasswordForm
        tenantSlug={tenantSlug}
        skipTo={portalPath(
          tenantSlug,
          identity.customer.onboarded
            ? PORTAL_ROUTES.REQUESTS
            : PORTAL_ROUTES.WELCOME,
        )}
        // First sign-in: this is an offer, and declining it moves on to the
        // welcome wizard. From the account menu afterwards it is a cancel.
        skipLabel={identity.customer.onboarded ? "Cancel" : "Skip for now"}
      />
    </PortalCard>
  );
}
