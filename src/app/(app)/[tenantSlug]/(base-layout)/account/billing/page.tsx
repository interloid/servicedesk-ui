import BillingDashboard from "@/features/billing/components/billing-dashboard";
import { fetchTenantBillingData } from "@/features/billing/services/billing-dashboard.service";
import { notFound } from "next/navigation";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Billing",
};

interface PageProps {
  params: Promise<{ tenantSlug: string }>;
}

export default async function Page({ params }: PageProps) {
  const { tenantSlug } = await params;
  const billingData = await fetchTenantBillingData(tenantSlug);
  if (!billingData) return notFound();

  return <BillingDashboard params={params} initialData={billingData} />;
}
