import CancelSubscription from "@/features/billing/components/cancel-subscription";
import { fetchTenantBillingData } from "@/features/billing/services/billing-dashboard.service";
import { notFound } from "next/navigation";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cancel subscription",
};

interface PageProps {
  params: Promise<{ tenantSlug: string }>;
}

export default async function Page({ params }: PageProps) {
  const { tenantSlug } = await params;
  const billingData = await fetchTenantBillingData(tenantSlug);
  if (!billingData) return notFound();

  return (
    <CancelSubscription tenantSlug={tenantSlug} billingData={billingData} />
  );
}
