import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  PortalCard,
  PortalCentered,
} from "@/features/portal/components/portal-shell";
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

  // PortalCentered, because this is a sign-in-shaped screen and the other two
  // -- login and check-email -- sit in the middle of the space between the
  // header and the footer. PortalCard alone only centres horizontally, so the
  // card used to hang under the header while everything else on the way to the
  // portal was centred.
  return (
    <PortalCentered width="max-w-120">
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
    </PortalCentered>
  );
}
