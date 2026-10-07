import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PortalRequestDetailView } from "@/features/portal/components/portal-request-detail";
import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";
import {
  getPortalIdentity,
  getPortalRequest,
} from "@/features/portal/services/portal.service";

type PageProps = {
  params: Promise<{ tenantSlug: string; requestId: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { tenantSlug, requestId } = await params;

  const identity = await getPortalIdentity(tenantSlug);
  const request = identity ? await getPortalRequest(identity, requestId) : null;

  return { title: request ? request.subject : "Request" };
}

export default async function PortalRequestPage({ params }: PageProps) {
  const { tenantSlug, requestId } = await params;

  const identity = await getPortalIdentity(tenantSlug);

  if (!identity) {
    redirect(portalPath(tenantSlug, PORTAL_ROUTES.LOGIN));
  }

  // getPortalRequest scopes to this customer, so somebody else's request id is
  // indistinguishable from one that does not exist -- which is what we want.
  const request = await getPortalRequest(identity, requestId);

  if (!request) {
    notFound();
  }

  return (
    <PortalRequestDetailView
      tenantSlug={tenantSlug}
      tenantName={identity.tenant.name}
      request={request}
    />
  );
}
