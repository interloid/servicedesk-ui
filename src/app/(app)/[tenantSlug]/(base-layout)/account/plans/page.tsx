import React from "react";
import {
  getPlans,
  getTenantPlan,
} from "@/features/billing/services/billing-service";
import { PricingCards } from "@/features/billing/components/pricing-cards";
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

  return (
    <div className="min-h-full w-full bg-background font-sans text-foreground  sm:px-6 sm:py-8 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6 sm:space-y-8">
        <div className="text-center max-w-2xl mx-auto">
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
            Plans & pricing
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Billed monthly per active agent. Change or cancel at any time.
          </p>
        </div>

        {canManageBilling ? (
          <PricingCards
            tenantSlug={tenantSlug}
            currentPlanCode={currentPlanId}
            plans={plans}
          />
        ) : (
          <div className="rounded-xl border border-border bg-card p-6 sm:p-8 text-center shadow-none">
            <p className="text-sm font-semibold text-card-foreground">
              You don&apos;t have permission to change plans.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Ask a tenant admin or billing admin to manage subscriptions for
              this workspace.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
