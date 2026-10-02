import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PortalCheckEmail } from "@/features/portal/components/portal-check-email";
import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";

export const metadata: Metadata = {
  title: "Check your inbox",
};

type PageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PortalCheckEmailPage({
  params,
  searchParams,
}: PageProps) {
  const [{ tenantSlug }, query] = await Promise.all([params, searchParams]);

  const raw = query.email;
  const email = (Array.isArray(raw) ? raw[0] : raw)?.trim();

  // The address rides in the URL rather than a cookie so a refresh, or a second
  // tab, still knows who the link was sent to. Without it there is nothing to
  // name on the screen and nothing for Resend to send to.
  if (!email) {
    redirect(portalPath(tenantSlug, PORTAL_ROUTES.LOGIN));
  }

  return <PortalCheckEmail tenantSlug={tenantSlug} email={email} />;
}
