import type { Metadata } from "next";

import { PortalNewRequestForm } from "@/features/portal/components/portal-new-request-form";
import {
  getFirstResponseTarget,
  getPortalIdentity,
  getPortalTenant,
} from "@/features/portal/services/portal.service";

export const metadata: Metadata = {
  title: "Submit a request",
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

  // Deliberately reachable signed out: this is the "First time here? You don't
  // need an account to reach us" path from the sign-in screen.
  const identity = await getPortalIdentity(tenantSlug);
  const tenant = identity?.tenant ?? (await getPortalTenant(tenantSlug));

  const firstResponseTarget = tenant
    ? await getFirstResponseTarget(tenant.id)
    : "one business day";

  return (
    <PortalNewRequestForm
      tenantSlug={tenantSlug}
      isSignedIn={Boolean(identity)}
      firstResponseTarget={firstResponseTarget}
      initialSubject={initialSubject}
    />
  );
}
