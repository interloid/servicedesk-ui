import SavedViewsList from "@/features/saved-view/components/saved-views-list";
import { SavedViewsUpsell } from "@/features/saved-view/components/saved-views-upsell";
import {
  fetchTenantSavedViews,
  getTenantEntitlements,
} from "@/features/saved-view/services/saved-views.service";
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

  const entitlements = await getTenantEntitlements(tenantSlug);

  // Not a 404: the page is the only place that explains the feature, so a free
  // tenant gets the pitch rather than a dead end. The actions are gated
  // separately — this branch is presentation, not the boundary.
  if (!entitlements.savedViews) {
    return <SavedViewsUpsell tenantSlug={tenantSlug} />;
  }

  const [views, now] = await Promise.all([
    fetchTenantSavedViews(tenantSlug),
    serverNow(),
  ]);

  return <SavedViewsList initialViews={views} tenant={tenantSlug} now={now} />;
}
