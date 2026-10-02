import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  CustomerOverview,
  CustomerTicketsTab,
} from "@/features/customers/components/customer-details";
import {
  CustomerOverviewSkeleton,
  CustomerTicketsSkeleton,
} from "@/features/customers/components/customer-skeletons";
import {
  fetchCustomerById,
  fetchCustomerTickets,
  serverNow,
} from "@/features/customers/services/customers.service";
import {
  isCustomerId,
  isCustomerTab,
  parsePageParam,
  type CustomerTab,
} from "@/features/customers/types/customers";
import { requestOrigin } from "@/features/auth/services/auth.service";
import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";

type Props = {
  params: Promise<{ tenantSlug: string; customerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const first = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

/**
 * The tab body only; the header and tabs are in the layout.
 *
 * The Suspense key changes with the tab and the page, so each switch shows the
 * skeleton for the tab being opened -- a ticket table for Tickets, the cards
 * for Overview -- under a header that never moves.
 */
export default async function CustomerDetailRoute({
  params,
  searchParams,
}: Props) {
  const [{ tenantSlug, customerId }, query] = await Promise.all([
    params,
    searchParams,
  ]);

  if (!isCustomerId(customerId)) {
    notFound();
  }

  const rawTab = first(query.tab);
  const tab: CustomerTab = isCustomerTab(rawTab) ? rawTab : "overview";
  // The Overview only ever shows the newest few tickets, so a `page` there is
  // ignored rather than read and thrown away.
  const page = tab === "tickets" ? parsePageParam(first(query.page)) : 1;

  return (
    <Suspense
      key={`${tab}-${page}`}
      fallback={
        tab === "tickets" ? (
          <CustomerTicketsSkeleton />
        ) : (
          <CustomerOverviewSkeleton />
        )
      }
    >
      {tab === "tickets" ? (
        <TicketsBody
          tenantSlug={tenantSlug}
          customerId={customerId}
          page={page}
        />
      ) : (
        <OverviewBody tenantSlug={tenantSlug} customerId={customerId} />
      )}
    </Suspense>
  );
}

async function OverviewBody({
  tenantSlug,
  customerId,
}: {
  tenantSlug: string;
  customerId: string;
}) {
  const [customer, now, origin, tickets] = await Promise.all([
    fetchCustomerById(tenantSlug, customerId),
    serverNow(),
    requestOrigin(),
    fetchCustomerTickets(tenantSlug, customerId, 1),
  ]);

  if (!customer) {
    notFound();
  }

  // The address an agent would paste into an email. requestOrigin, not
  // NEXT_PUBLIC_SITE_URL: on a tenant subdomain the configured site URL is
  // the bare apex, and pasting that would hand the customer a link to the
  // sign-in page rather than to this workspace's portal.
  const portalUrl = new URL(
    portalPath(tenantSlug, PORTAL_ROUTES.ROOT),
    origin,
  ).toString();

  return (
    <CustomerOverview
      customer={customer}
      ticketPage={tickets}
      tenant={tenantSlug}
      now={now}
      portalUrl={portalUrl}
    />
  );
}

async function TicketsBody({
  tenantSlug,
  customerId,
  page,
}: {
  tenantSlug: string;
  customerId: string;
  page: number;
}) {
  const [tickets, now] = await Promise.all([
    fetchCustomerTickets(tenantSlug, customerId, page),
    serverNow(),
  ]);

  return (
    <CustomerTicketsTab
      customerId={customerId}
      tickets={tickets}
      tenant={tenantSlug}
      now={now}
    />
  );
}
