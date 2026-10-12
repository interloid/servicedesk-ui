"use server";

import { revalidatePath } from "next/cache";

import {
  fetchTenantSavedViews,
  createTenantSavedView,
  updateTenantSavedView,
  deleteTenantSavedView,
  type SavedView,
  getTenantEntitlements,
} from "../services/saved-views.service";
import type { TicketFilterJson } from "../filters";

/**
 * Discriminated so callers can narrow on `success` rather than probing for
 * whichever key happens to be present.
 */
type ViewResult<TData = object> =
  ({ success: true } & TData) | { success: false; error: string };

function failed(
  error: unknown,
  fallback: string,
): { success: false; error: string } {
  return {
    success: false,
    error: error instanceof Error ? error.message : fallback,
  };
}

/**
 * The real free/paid boundary.
 *
 * Every mutation below is reachable as a bare POST whatever the sidebar
 * renders, so the plan is checked here and not left to the page having
 * declined to show a button.
 */
async function requireSavedViews(
  tenantSlug: string,
): Promise<{ success: false; error: string } | null> {
  const entitlements = await getTenantEntitlements(tenantSlug);

  if (entitlements.savedViews) {
    return null;
  }

  return {
    success: false,
    error: "Saved views are available on the Pro plan.",
  };
}

/**
 * Reading is not gated: a tenant that downgrades keeps its rows, and the page
 * still has to be able to say what it is holding.
 */
export async function getSavedViewsAction(
  tenantSlug: string,
): Promise<
  | { success: true; views: SavedView[] }
  | { success: false; error: string; views: SavedView[] }
> {
  try {
    const views = await fetchTenantSavedViews(tenantSlug);
    return { success: true, views };
  } catch (error: unknown) {
    return { ...failed(error, "An error occurred"), views: [] };
  }
}

export async function createSavedViewAction(
  tenantSlug: string,
  name: string,
  filterJson: TicketFilterJson,
  isShared: boolean = false,
): Promise<ViewResult<{ view: SavedView }>> {
  const denied = await requireSavedViews(tenantSlug);
  if (denied) return denied;

  if (!name.trim()) {
    return { success: false, error: "View name is required" };
  }

  try {
    const newView = await createTenantSavedView(
      tenantSlug,
      name,
      filterJson,
      isShared,
    );

    revalidatePath(`/${tenantSlug}/views`);

    return { success: true, view: newView };
  } catch (error: unknown) {
    return failed(error, "An error occurred");
  }
}

export async function updateSavedViewAction(
  tenantSlug: string,
  viewId: string,
  updates: {
    name?: string;
    filter_json?: TicketFilterJson;
    is_shared?: boolean;
  },
): Promise<ViewResult<{ view: SavedView }>> {
  const denied = await requireSavedViews(tenantSlug);
  if (denied) return denied;

  try {
    const updatedView = await updateTenantSavedView(
      tenantSlug,
      viewId,
      updates,
    );

    revalidatePath(`/${tenantSlug}/views`);

    return { success: true, view: updatedView };
  } catch (error: unknown) {
    return failed(error, "An error occurred");
  }
}

export async function deleteSavedViewAction(
  tenantSlug: string,
  viewId: string,
): Promise<ViewResult> {
  const denied = await requireSavedViews(tenantSlug);
  if (denied) return denied;

  try {
    await deleteTenantSavedView(tenantSlug, viewId);

    revalidatePath(`/${tenantSlug}/views`);

    return { success: true };
  } catch (error: unknown) {
    return failed(error, "An error occurred");
  }
}
