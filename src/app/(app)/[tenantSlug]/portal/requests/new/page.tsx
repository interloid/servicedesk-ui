import type { Metadata } from "next";

import { PortalNewRequestForm } from "@/features/portal/components/portal-new-request-form";
import {
  getFirstResponseTarget,
  getPortalIdentity,
  getPortalSupportClosed,
  getPortalTenant,
} from "@/features/portal/services/portal.service";

export const metadata: Metadata = {
  title: "Create a ticket",
};

export default async function PortalNewRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ tenantSlug }, query] = await Promise.all([params, searchParams]);

  // Set by the help centre's topic cards and search box. Trimmed and capped
  // at the schema's subject limit; the customer can still edit it.
  const rawSubject = Array.isArray(query.subject)
    ? query.subject[0]
    : query.subject;
  const initialSubject = rawSubject?.trim().slice(0, 200) ?? "";

  // Reachable signed out: a first-time customer files the ticket here and is
  // emailed a link to set a password. See PortalNewRequestForm.
  const identity = await getPortalIdentity(tenantSlug);
  const tenant = identity?.tenant ?? (await getPortalTenant(tenantSlug));

  // The signed-in customer's own policy, as their ticket will get.
  const customerId = identity?.customer.id ?? null;
  const [firstResponseTarget, supportClosed] = tenant
    ? await Promise.all([
        getFirstResponseTarget(tenant.id, customerId),
        getPortalSupportClosed(tenant.id, customerId),
      ])
    : ["one business day", null];

  return (
    <PortalNewRequestForm
      tenantSlug={tenantSlug}
      isSignedIn={Boolean(identity)}
      firstResponseTarget={firstResponseTarget}
      supportClosed={supportClosed}
      initialSubject={initialSubject}
    />
  );
}
