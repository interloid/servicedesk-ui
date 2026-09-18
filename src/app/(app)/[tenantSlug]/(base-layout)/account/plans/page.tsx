import React from "react";
import {
  getPlans,
  getTenantPlan,
} from "@/features/billing/services/billing.service";
import { PricingCards } from "@/features/billing/components/pricing-cards";
import { fetchTenantBillingData } from "@/features/billing/services/billing-dashboard.service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { Metadata } from "next";

import {
  canManageTenantBilling,
  getTenantIdBySlug,
} from "@/features/tenancy/services/tenant-resolver";

export const metadata: Metadata = {
  title: "Plans & pricing",
};

export default async function TenantBillingPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const tenantId = user ? await getTenantIdBySlug(tenantSlug) : null;

  const canManageBilling =
    user && tenantId ? await canManageTenantBilling(user.id, tenantId) : false;

  const [plans, currentPlanId] = await Promise.all([
    getPlans(),
    getTenantPlan(tenantSlug),
  ]);

  let billingData = null;

  if (canManageBilling && tenantSlug) {
    try {
      billingData = await fetchTenantBillingData(tenantSlug);
    } catch (error) {
      console.error("Failed to load billing data for plans page:", error);
    }
  }

  return (
    <div className="min-h-full w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="mx-auto max-w-7xl space-y-8 sm:space-y-10">
        {/* Header */}
        <header className="mx-auto max-w-2xl space-y-2 text-center">
          <h1 className="text-xl font-bold tracking-tight text-foreground text-balance sm:text-2xl lg:text-3xl">
            Plans & pricing
          </h1>

          <p className="text-xs text-muted-foreground text-pretty sm:text-sm">
            One flat monthly price per plan, with agent seats included. Change
            or cancel anytime.
          </p>
        </header>

        {/* No permission */}
        {!canManageBilling ? (
          <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-5 text-center shadow-sm sm:p-6 md:p-8">
            <p className="text-sm font-semibold text-card-foreground">
              You don&apos;t have permission to change plans.
            </p>

            <p className="mt-1 text-xs text-muted-foreground">
              Ask a tenant admin or billing admin to manage subscriptions for
              this workspace.
            </p>
          </div>
        ) : plans.length === 0 ? (
          /* No plans */
          <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-5 text-center shadow-sm sm:p-6 md:p-8">
            <p className="text-sm font-semibold text-card-foreground">
              Plans aren&apos;t available right now.
            </p>

            <p className="mt-1 text-xs text-muted-foreground">
              Please try again shortly. If the problem persists, contact
              support.
            </p>
          </div>
        ) : (
          /* Pricing cards */
          <div className="flex flex-wrap items-stretch justify-center gap-5 xl:gap-6">
            <PricingCards
              tenantSlug={tenantSlug}
              currentPlanCode={currentPlanId}
              plans={plans}
              billingData={billingData}
            />
          </div>
        )}
      </div>
    </div>
  );
}
