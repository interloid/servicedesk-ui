import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PortalSignInForm } from "@/features/portal/components/portal-sign-in-form";
import {
  PORTAL_ACCESS_DISABLED_MESSAGE,
  portalLoginError,
  PORTAL_ROUTES,
  portalPath,
} from "@/features/portal/portal";
import {
  getPortalIdentity,
  isPortalAccessDisabled,
} from "@/features/portal/services/portal.service";

export const metadata: Metadata = {
  title: "Track your requests",
};

type PageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PortalLoginPage({
  params,
  searchParams,
}: PageProps) {
  const [{ tenantSlug }, query] = await Promise.all([params, searchParams]);

  // Already signed in: the login screen has nothing to offer them.
  const [identity, accessDisabled] = await Promise.all([
    getPortalIdentity(tenantSlug),
    isPortalAccessDisabled(tenantSlug),
  ]);

  if (identity) {
    redirect(
      portalPath(
        tenantSlug,
        identity.customer.onboarded
          ? PORTAL_ROUTES.REQUESTS
          : PORTAL_ROUTES.WELCOME,
      ),
    );
  }

  // No PortalCard here: the form draws its own card, because the panel
  // beside it changes with the sign-in mode the form is in.
  return (
    <PortalSignInForm
      tenantSlug={tenantSlug}
      initialMode={first(query.mode) === "password" ? "password" : "link"}
      // A disabled customer who is still signed in lands here from every
      // portal page; say why instead of showing an empty form.
      initialError={
        accessDisabled
          ? PORTAL_ACCESS_DISABLED_MESSAGE
          : portalLoginError(first(query.error))
      }
    />
  );
}
