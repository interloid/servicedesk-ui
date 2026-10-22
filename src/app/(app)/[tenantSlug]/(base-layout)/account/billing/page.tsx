import BillingDashboard from "@/features/billing/components/billing-dashboard";
import { fetchTenantBillingData } from "@/features/billing/services/billing-dashboard.service";
import {
  canManageTenantBilling,
  getTenantIdBySlug,
} from "@/features/tenancy/services/tenant-resolver";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const tenantId = user ? await getTenantIdBySlug(tenantSlug) : null;

  if (!tenantId) return notFound();

  // "Not allowed" gets the same card the plans page shows; only a workspace
  // that does not exist is a 404. A failed load renders the dashboard's own
  // "couldn't load" state instead of a 404 as well.
  const canManageBilling = user
    ? await canManageTenantBilling(user.id, tenantId)
    : false;

  if (!canManageBilling) {
    return (
      <div className="min-h-full w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-5 text-center shadow-sm sm:p-6 md:p-8">
          <p className="text-sm font-semibold text-card-foreground">
            You don&apos;t have permission to view billing.
          </p>

          <p className="mt-1 text-xs text-muted-foreground">
            Ask a tenant admin or billing admin to manage billing for this
            workspace.
          </p>
        </div>
      </div>
    );
  }

  const billingData = await fetchTenantBillingData(tenantSlug).catch(
    (error: unknown) => {
      console.error("Failed to load billing data:", error);
      return null;
    },
  );

  return <BillingDashboard tenantSlug={tenantSlug} initialData={billingData} />;
}
