import CustomersTable from "@/features/customers/components/customers-table";
import { fetchTenantCustomers } from "@/features/customers/services/customers.service";

export const metadata = {
  title: "Customers | Support Center",
};

interface CustomersPageProps {
  params: Promise<{ tenantSlug: string }>;
}

export default async function CustomersPage({ params }: CustomersPageProps) {
  const { tenantSlug } = await params;
  const customers = await fetchTenantCustomers(tenantSlug);

  return <CustomersTable tenant={tenantSlug} initialCustomers={customers} />;
}
