import CancelSubscription from "@/features/billing/components/cancel-subscription";
import { fetchTenantBillingData } from "@/features/billing/services/billing-dashboard.service";
import { getPlans } from "@/features/billing/services/billing.service";
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

  const [billingData, plans] = await Promise.all([
    fetchTenantBillingData(tenantSlug),
    getPlans(),
  ]);

  if (!billingData) return notFound();

  // The page has to say what the Free plan actually allows, not "limited
  // seats". Cancelling moves the tenant to the cheapest active plan, so that
  // row is the one to describe.
  const freePlan = plans.find((plan) => plan.priceValue === 0) ?? null;

  return (
    <CancelSubscription
      tenantSlug={tenantSlug}
      billingData={billingData}
      freePlan={freePlan}
    />
  );
}
