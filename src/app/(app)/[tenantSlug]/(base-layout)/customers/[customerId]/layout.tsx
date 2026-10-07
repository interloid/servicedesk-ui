import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { CustomerHeader } from "@/features/customers/components/customer-details";
import { CustomerHeaderSkeleton } from "@/features/customers/components/customer-skeletons";
import {
  fetchCustomerById,
  fetchCustomerTickets,
} from "@/features/customers/services/customers.service";
import { isCustomerId } from "@/features/customers/types/customers";

type Params = Promise<{ tenantSlug: string; customerId: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { tenantSlug, customerId } = await params;

  if (!isCustomerId(customerId)) {
    return { title: "Customer" };
  }

  // Cached per request, so this and the header share one set of queries.
  const customer = await fetchCustomerById(tenantSlug, customerId);

  return { title: customer ? customer.fullName : "Customer" };
}

/**
 * The header and tab strip live here rather than in the page because a layout
 * is not re-rendered when only the search params change. Switching tab or
 * ticket page re-renders the page alone, so the profile stays on screen and
 * only the tab body shows a skeleton.
 */
export default async function CustomerLayout({
  params,
  children,
}: {
  params: Params;
  children: ReactNode;
}) {
  const { tenantSlug, customerId } = await params;

  // A hand-typed or truncated id would otherwise reach Postgres, fail as
  // 22P02 and be logged as an error on every hit.
  if (!isCustomerId(customerId)) {
    notFound();
  }

  return (
    <div className="h-full overflow-y-auto p-4 font-sans sm:p-6 lg:p-8">
      <div className="@container mx-auto flex w-full flex-col gap-6">
        <Suspense fallback={<CustomerHeaderSkeleton />}>
          <Header tenantSlug={tenantSlug} customerId={customerId} />
        </Suspense>

        {children}
      </div>
    </div>
  );
}

async function Header({
  tenantSlug,
  customerId,
}: {
  tenantSlug: string;
  customerId: string;
}) {
  // Page 1 is the same read the Overview makes, and both are cached per
  // request, so on a first load this costs nothing extra.
  const [customer, tickets] = await Promise.all([
    fetchCustomerById(tenantSlug, customerId),
    fetchCustomerTickets(tenantSlug, customerId, 1),
  ]);

  if (!customer) {
    notFound();
  }

  return (
    <CustomerHeader
      customer={customer}
      tenant={tenantSlug}
      ticketTotal={tickets.total}
    />
  );
}
