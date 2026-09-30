import type { Metadata } from "next";
import { notFound } from "next/navigation";

import CustomerDetailPage from "@/features/customers/components/customer-details";
import {
  fetchCustomerById,
  fetchCustomerTickets,
  serverNow,
} from "@/features/customers/services/customers.service";
import {
  isCustomerTab,
  parseCustomerTicketPage,
} from "@/features/customers/types/customers";
import { requestOrigin } from "@/features/auth/services/auth.service";
import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";

type Props = {
  params: Promise<{ tenantSlug: string; customerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tenantSlug, customerId } = await params;
  // fetchCustomerById is cached per request, so this and the page share one
  // set of queries.
  const customer = await fetchCustomerById(tenantSlug, customerId);

  return { title: customer ? customer.fullName : "Customer" };
}

export default async function CustomerDetailRoute({
  params,
  searchParams,
}: Props) {
  const [{ tenantSlug, customerId }, query] = await Promise.all([
    params,
    searchParams,
  ]);

  const rawTab = Array.isArray(query.tab) ? query.tab[0] : query.tab;
  const tab = isCustomerTab(rawTab) ? rawTab : "overview";
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page;

  // Which page of tickets to read depends on the tab, so it is decided before
  // the fetch rather than after: the Overview only ever shows the newest few,
  // and asking for page 7 of those would be a query thrown away.
  const [customer, now, origin, tickets] = await Promise.all([
    fetchCustomerById(tenantSlug, customerId),
    serverNow(),
    requestOrigin(),
    fetchCustomerTickets(
      tenantSlug,
      customerId,
      tab === "tickets" ? parseCustomerTicketPage(rawPage) : 1,
    ),
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
    <CustomerDetailPage
      customer={customer}
      tickets={tickets}
      tenant={tenantSlug}
      tab={tab}
      now={now}
      portalUrl={portalUrl}
    />
  );
}
