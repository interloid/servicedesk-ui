import React from "react";
import {
  getPlans,
  getTenantPlan,
} from "@/features/billing/services/billing-service";
import { PricingCards } from "@/features/billing/components/pricing-cards";

export default async function TenantBillingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const [plans, currentPlanId] = await Promise.all([
    getPlans(),
    getTenantPlan(tenantSlug),
  ]);

  return (
    <div className="h-full bg-slate-50/50  font-sans text-slate-800">
      <div className="max-w mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Plans & pricing
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Billed monthly per active agent. Change or cancel at any time.
          </p>
        </div>

        <PricingCards
          tenantSlug={tenantSlug}
          currentPlanCode={currentPlanId}
          plans={plans}
        />
      </div>
    </div>
  );
}
