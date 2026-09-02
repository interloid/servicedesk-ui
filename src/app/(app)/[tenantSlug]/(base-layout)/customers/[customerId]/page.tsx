import { notFound } from "next/navigation";
import CustomerDetailPage from "@/features/customers/components/customer-details";
import { fetchCustomerById } from "@/features/customers/services/customers.service";

export const metadata = {
  title: "Customer Details | Support Center",
};

interface CustomerDetailRouteProps {
  params: Promise<{ tenantSlug: string; customerId: string }>;
}

export default async function CustomerDetailRoute({
  params,
}: CustomerDetailRouteProps) {
  const { tenantSlug, customerId } = await params;
  const customer = await fetchCustomerById(tenantSlug, customerId);

  if (!customer) notFound();

  return <CustomerDetailPage customer={customer} tenant={tenantSlug} />;
}
