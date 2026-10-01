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

/**
 * The request list, at /portal/requests.
 *
 * This page sits in the (overview) route group rather than directly in
 * requests/ so that its loading.tsx is a fallback for this page alone. A
 * loading.tsx one level up would also be the fallback for requests/[requestId]
 * and requests/new, and the list skeleton would then appear on the way to a
 * single request. See the comment at the top of ./loading.tsx.
 */

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

  // parseInt rather than Number: "?page=2abc" is a typo, not page 2.5, and
  // Number would read the whole string and hand back NaN for a page that reads
  // perfectly well to a person.
  const rawPage = first(query.page);
  const asked = Number.parseInt(rawPage, 10);
  const page = Number.isFinite(asked) ? asked : 1;

  const result = await listPortalRequests(identity, {
    search: search || undefined,
    state: state === "all" ? undefined : state,
    sort,
    page,
  });

  // The service clamps the page to one that exists. When the URL asked for
  // another, the URL is corrected and redirected to, so a shared link, a
  // back-button entry or a stale bookmark lands on real results and the address
  // bar agrees with them. Without this the pager would render "Page 1 of 3" on
  // a URL that says page 9, which reads as a broken page rather than a fix.
  if (result.page !== page) {
    const params = new URLSearchParams();

    if (search) params.set("q", search);
    if (state !== "all") params.set("state", state);
    if (sort !== "updated") params.set("sort", sort);
    if (result.page > 1) params.set("page", String(result.page));

    const qs = params.toString();
    redirect(
      `${portalPath(tenantSlug, PORTAL_ROUTES.REQUESTS)}${qs ? `?${qs}` : ""}`,
    );
  }

  return (
    <PortalRequestsList
      tenantSlug={tenantSlug}
      tenantName={identity.tenant.name}
      result={result}
      search={search}
      state={state}
      sort={sort}
    />
  );
}
