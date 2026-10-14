import SavedViewsList from "@/features/saved-view/components/saved-views-list";
import { fetchTenantSavedViews } from "@/features/saved-view/services/saved-views.service";
import { getTenantEntitlements } from "@/features/saved-view/services/entitlements.service";
import { serverNow } from "@/features/team/services/team.service";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Saved views",
};

interface ViewsPageProps {
  params: Promise<{ tenantSlug: string }>;
}

export default async function ViewsPage({ params }: ViewsPageProps) {
  const { tenantSlug } = await params;

  // Every plan gets the page: the four built-in views are free. Pro only
  // unlocks custom views, and the actions enforce that on their own — this
  // flag is presentation, not the boundary.
  const [entitlements, views, now] = await Promise.all([
    getTenantEntitlements(tenantSlug),
    fetchTenantSavedViews(tenantSlug),
    serverNow(),
  ]);

  return (
    <SavedViewsList
      initialViews={views}
      tenant={tenantSlug}
      now={now}
      isPro={entitlements.savedViews}
    />
  );
}
