import React from "react";
import {
  getPlans,
  getTenantPlan,
} from "@/features/billing/services/billing.service";
import { PricingCards } from "@/features/billing/components/pricing-cards";
import { fetchTenantBillingData } from "@/features/billing/services/billing-dashboard.service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  canManageTenantBilling,
  getTenantIdBySlug,
} from "@/features/tenancy/services/tenant-resolver";

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
    <div className="min-h-full w-full bg-background px-4 sm:px-6 lg:px-8 py-6 sm:py-8 md:py-10">
      <div className="mx-auto max-w-7xl space-y-8 sm:space-y-12">
        <header className="mx-auto max-w-2xl text-center">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
            Plans & pricing
          </h1>
          <p className="mt-2 text-xs sm:text-sm text-muted-foreground">
            One flat monthly price per plan, with agent seats included. Change
            or cancel anytime.
          </p>
        </header>

        {!canManageBilling ? (
          <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-6 sm:p-8 text-center shadow-sm">
            <p className="text-sm font-semibold text-card-foreground">
              You don&apos;t have permission to change plans.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Ask a tenant admin or billing admin to manage subscriptions for
              this workspace.
            </p>
          </div>
        ) : plans.length === 0 ? (
          <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-6 sm:p-8 text-center shadow-sm">
            <p className="text-sm font-semibold text-card-foreground">
              Plans aren&apos;t available right now.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Please try again shortly. If the problem persists, contact
              support.
            </p>
          </div>
        ) : (
          <PricingCards
            tenantSlug={tenantSlug}
            currentPlanCode={currentPlanId}
            plans={plans}
            billingData={billingData}
          />
        )}
      </div>
    </div>
  );
}