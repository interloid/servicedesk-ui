"use server";

import { revalidatePath } from "next/cache";

import { getTenantEntitlements } from "../services/entitlements.service";
import {
  createTenantSavedView,
  updateTenantSavedView,
  deleteTenantSavedView,
  loadSaveContext,
  saveSavedViewOrder,
  SavedViewError,
  type SaveContext,
  type SavedViewInput,
} from "../services/saved-views.service";
import {
  canMatchAnything,
  filterKey,
  findSameFilterView,
  findSameNameView,
  normalizeFilter,
  normalizeViewRoles,
  repeatedRuleIndexes,
  SEARCH_MAX,
  conditionCount,
  CUSTOM_VIEWS_PER_USER_MAX,
  toFilterJson,
  VIEW_CONDITIONS_MAX,
  VIEW_CONDITIONS_MIN,
  VIEW_NAME_MAX,
  viewNameKey,
  type TicketFilterJson,
} from "../filters";

/**
 * Discriminated so callers can narrow on `success` rather than probing for
 * whichever key happens to be present.
 */
type ViewResult<TData = object> =
  ({ success: true } & TData) | { success: false; error: string };

/** What the form posts. Every field is re-checked here: it is a bare POST. */
export type SavedViewFormInput = {
  name: string;
  filterJson: TicketFilterJson;
  isShared: boolean;
  visibilityRoles: string[];
};

const REORDER_MAX = 500;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Only messages written for the user go back as is; a raw Postgres or
 * PostgREST error ("violates row-level security policy for table …") is
 * logged and replaced with the fallback.
 */
function failed(
  error: unknown,
  fallback: string,
): { success: false; error: string } {
  if (error instanceof SavedViewError) {
    return { success: false, error: error.message };
  }
  console.error(error);
  return { success: false, error: fallback };
}

/**
 * The real free/paid boundary.
 *
 * Every mutation below is reachable as a bare POST whatever the page
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
    error: "Custom saved views are available on the Pro plan.",
  };
}

/**
 * Normalise what the client sent into what may be stored: unknown statuses,
 * priorities and roles are dropped rather than trusted.
 */
function parseInput(
  raw: SavedViewFormInput,
): { ok: true; input: SavedViewInput } | { ok: false; error: string } {
  const name = typeof raw?.name === "string" ? raw.name.trim() : "";

  if (!name) {
    return { ok: false, error: "View name is required." };
  }

  if (name.length > VIEW_NAME_MAX) {
    return {
      ok: false,
      error: `View name must be ${VIEW_NAME_MAX} characters or fewer.`,
    };
  }

  const rawFilter =
    raw.filterJson && typeof raw.filterJson === "object"
      ? raw.filterJson
      : null;

  // Only the current shape is accepted from the form. Dropping a bad rule
  // would quietly change what the AND / ORs around it mean, so refuse it.
  if (!rawFilter || !Array.isArray(rawFilter.rules)) {
    return { ok: false, error: "Add at least one filter condition." };
  }

  const filter = normalizeFilter({ rules: rawFilter.rules });

  if (filter.rules.length !== rawFilter.rules.length) {
    return { ok: false, error: "One of the filter conditions isn't valid." };
  }

  const conditions = conditionCount(filter);
  if (conditions < VIEW_CONDITIONS_MIN || conditions > VIEW_CONDITIONS_MAX) {
    return {
      ok: false,
      error: `A view needs ${VIEW_CONDITIONS_MIN} to ${VIEW_CONDITIONS_MAX} filter conditions.`,
    };
  }

  if (
    filter.rules.some(
      (rule) => rule.field === "search" && rule.value.length > SEARCH_MAX,
    )
  ) {
    return {
      ok: false,
      error: `Search text must be ${SEARCH_MAX} characters or fewer.`,
    };
  }

  if (repeatedRuleIndexes(filter.rules).length) {
    return { ok: false, error: "The same condition is in the filter twice." };
  }

  if (!canMatchAnything(filter)) {
    return {
      ok: false,
      error: "These conditions can never match a ticket. Check the AND / OR.",
    };
  }

  return {
    ok: true,
    input: {
      name,
      filterJson: toFilterJson(filter),
      isShared: raw.isShared === true,
      visibilityRoles: normalizeViewRoles(
        Array.isArray(raw.visibilityRoles) ? raw.visibilityRoles : [],
      ),
    },
  };
}

/**
 * Same name or same filter as a view the user can already see. The popup
 * already blocks both; checked again because the action is a bare POST and
 * the list it compared against may be out of date.
 *
 * On an edit, each is checked only when it changed. A teammate who later
 * shares a view with the same name or filter must not lock the owner out of
 * editing the rest of theirs.
 */
function duplicateViewError(
  context: SaveContext,
  input: SavedViewInput,
  existing?: SaveContext["views"][number],
): { success: false; error: string } | null {
  const filter = normalizeFilter(input.filterJson);

  const nameChanged =
    !existing || viewNameKey(existing.name) !== viewNameKey(input.name);
  const sameName = nameChanged
    ? findSameNameView(context.views, input.name, existing?.id)
    : undefined;

  if (sameName) {
    return {
      success: false,
      error: `A saved view called “${sameName.name}” already exists. Choose a different name.`,
    };
  }

  const filterChanged =
    !existing || filterKey(existing.filter) !== filterKey(filter);
  const match = filterChanged
    ? findSameFilterView(context.views, filter, existing?.id)
    : undefined;

  if (!match) return null;

  return {
    success: false,
    error: `A saved view with these filter conditions already exists: “${match.name}”. Choose a different filter combination or open the existing view.`,
  };
}

function isViewId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id);
}

export async function createSavedViewAction(
  tenantSlug: string,
  raw: SavedViewFormInput,
): Promise<ViewResult> {
  const denied = await requireSavedViews(tenantSlug);
  if (denied) return denied;

  const parsed = parseInput(raw);
  if (!parsed.ok) return { success: false, error: parsed.error };

  try {
    // One read serves the limit and both duplicate checks.
    const context = await loadSaveContext(tenantSlug);

    // The enforce_saved_view_limit trigger is the real stop; this gives the
    // usual case its message without a failed insert.
    const owned = context.views.filter((view) => view.isOwnCustom).length;
    if (owned >= CUSTOM_VIEWS_PER_USER_MAX) {
      return {
        success: false,
        error: `You can have up to ${CUSTOM_VIEWS_PER_USER_MAX} custom saved views. Delete one to add another.`,
      };
    }

    const duplicate = duplicateViewError(context, parsed.input);
    if (duplicate) return duplicate;

    await createTenantSavedView(context, parsed.input);
    revalidatePath(`/${tenantSlug}/views`);
    return { success: true };
  } catch (error: unknown) {
    return failed(error, "Couldn't save that view.");
  }
}

export async function updateSavedViewAction(
  tenantSlug: string,
  viewId: string,
  raw: SavedViewFormInput,
): Promise<ViewResult> {
  const denied = await requireSavedViews(tenantSlug);
  if (denied) return denied;

  if (!isViewId(viewId)) {
    return { success: false, error: "That view no longer exists." };
  }

  const parsed = parseInput(raw);
  if (!parsed.ok) return { success: false, error: parsed.error };

  try {
    const context = await loadSaveContext(tenantSlug);
    const existing = context.views.find((view) => view.id === viewId);
    if (!existing?.isOwnCustom) {
      return {
        success: false,
        error: "That view no longer exists, or isn't yours to edit.",
      };
    }

    const duplicate = duplicateViewError(context, parsed.input, existing);
    if (duplicate) return duplicate;

    await updateTenantSavedView(context, viewId, parsed.input);
    revalidatePath(`/${tenantSlug}/views`);
    return { success: true };
  } catch (error: unknown) {
    return failed(error, "Couldn't save that view.");
  }
}

/**
 * Not plan-gated: a tenant that downgraded can still clear out the custom
 * views it kept. RLS limits it to the owner and never a built-in view.
 */
export async function deleteSavedViewAction(
  tenantSlug: string,
  viewId: string,
): Promise<ViewResult> {
  if (!isViewId(viewId)) {
    return { success: false, error: "That view no longer exists." };
  }

  try {
    await deleteTenantSavedView(tenantSlug, viewId);
    revalidatePath(`/${tenantSlug}/views`);
    return { success: true };
  } catch (error: unknown) {
    return failed(error, "Couldn't delete that view.");
  }
}

/**
 * The viewer's own order, on every plan: it only touches their preference
 * rows, and the built-in views are free.
 */
export async function reorderSavedViewsAction(
  tenantSlug: string,
  orderedIds: string[],
): Promise<ViewResult> {
  if (
    !Array.isArray(orderedIds) ||
    orderedIds.length === 0 ||
    orderedIds.length > REORDER_MAX ||
    !orderedIds.every(isViewId) ||
    new Set(orderedIds).size !== orderedIds.length
  ) {
    return { success: false, error: "Couldn't save that order." };
  }

  try {
    // No revalidatePath: the list already shows this order and keeps its own
    // on a refresh, so re-rendering the page would only re-run every count.
    // The tickets page is dynamic and reads the order on its next visit.
    await saveSavedViewOrder(tenantSlug, orderedIds);
    return { success: true };
  } catch (error: unknown) {
    return failed(error, "Couldn't save that order.");
  }
}
