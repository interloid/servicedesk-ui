import type { Metadata } from "next";

import CustomersTable from "@/features/customers/components/customers-table";
import {
  fetchTenantCustomers,
  serverNow,
} from "@/features/customers/services/customers.service";
import { getTenantContext } from "@/features/tenancy/services/tenant-resolver";

export const metadata: Metadata = {
  title: "Customers",
  description: "Companies and the people who raise tickets from them.",
};

export default async function CustomersPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  // Independent reads, so they go out together rather than one after another.
  const [customers, now, tenant] = await Promise.all([
    fetchTenantCustomers(tenantSlug),
    serverNow(),
    getTenantContext(tenantSlug),
  ]);

  return (
    <CustomersTable
      tenant={tenantSlug}
      tenantName={tenant?.name ?? null}
      initialCustomers={customers}
      now={now}
    />
  );
}
