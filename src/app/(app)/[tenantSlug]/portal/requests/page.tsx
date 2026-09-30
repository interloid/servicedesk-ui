import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PortalRequestsList } from "@/features/portal/components/portal-requests-list";
import {
  isPortalRequestSort,
  PORTAL_ROUTES,
  portalPath,
} from "@/features/portal/portal";
import {
  getPortalIdentity,
  listPortalRequests,
} from "@/features/portal/services/portal.service";

export const metadata: Metadata = {
  title: "Your requests",
};

type PageProps = {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

const STATES = new Set(["open", "waiting_on_you", "resolved"]);

export default async function PortalRequestsPage({
  params,
  searchParams,
}: PageProps) {
  const [{ tenantSlug }, query] = await Promise.all([params, searchParams]);

  const identity = await getPortalIdentity(tenantSlug);

  if (!identity) {
    redirect(portalPath(tenantSlug, PORTAL_ROUTES.LOGIN));
  }

  if (!identity.customer.onboarded) {
    redirect(portalPath(tenantSlug, PORTAL_ROUTES.WELCOME));
  }

  const search = first(query.q).trim();
  const rawState = first(query.state);
  const state = STATES.has(rawState) ? rawState : "all";
  const rawSort = first(query.sort);
  const sort = isPortalRequestSort(rawSort) ? rawSort : "updated";

  const requests = await listPortalRequests(identity, {
    search: search || undefined,
    state: state === "all" ? undefined : state,
    sort,
  });

  return (
    <PortalRequestsList
      tenantSlug={tenantSlug}
      tenantName={identity.tenant.name}
      requests={requests}
      search={search}
      state={state}
      sort={sort}
    />
  );
}
