import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getTenantIdBySlug } from "@/features/tenancy/services/tenant-resolver";
import {
  CUSTOM_VIEWS_PER_USER_MAX,
  filterToPostgrest,
  normalizeFilter,
  normalizeViewRoles,
  SYSTEM_VIEW_KEYS,
  type SavedViewTab,
  type SystemViewKey,
  type TicketFilterJson,
  type ViewFilter,
  type ViewRole,
} from "@/features/saved-view/filters";
export type { TicketFilterJson };

/**
 * A message written for the user, safe to show as is. Anything else thrown
 * from here (Postgres, PostgREST) is logged and replaced with a generic one,
 * so table and policy names never reach the browser.
 */
export class SavedViewError extends Error {}

/**
 * Raised by the enforce_saved_view_limit trigger. The action counts first for
 * the friendly path; only the trigger holds a lock, so it is what stops two
 * quick submits from both taking the last slot.
 */
const VIEW_LIMIT_SQLSTATE = "SV409";

/**
 * A view as the Views page and its popups get it. No owner or tenant ids: the
 * page sends this to the browser, and `isOwn` is all the client needs.
 */
export interface SavedView {
  id: string;
  name: string;
  filter_json: TicketFilterJson;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
  ticketCount: number;
  /** filter_json read through normalizeFilter, so legacy rows still work. */
  filter: ViewFilter;
  isOwn: boolean;
  /** One of the four built-in views every plan gets. */
  isSystem: boolean;
  systemKey: SystemViewKey | null;
  visibilityRoles: ViewRole[];
  /** The viewer's own order; null until they first reorder. */
  position: number | null;
}

type SavedViewRow = {
  id: string;
  tenant_id: string;
  owner_user_id: string | null;
  name: string;
  filter_json: TicketFilterJson | null;
  is_shared: boolean;
  is_system?: boolean | null;
  system_key?: string | null;
  visibility_roles?: string[] | null;
  created_at: string;
  updated_at: string | null;
};

type PreferenceRow = {
  saved_view_id: string;
  order_position: number;
};

/**
 * The per-request cached lookup. It only maps slug to id: every query below
 * runs on the RLS client, so membership is still checked on saved_views.
 */
async function tenantIdFor(tenantSlug: string): Promise<string> {
  const tenantId = await getTenantIdBySlug(tenantSlug);

  if (!tenantId) throw new SavedViewError("That workspace couldn't be found.");

  return tenantId;
}

function systemKeyOf(row: SavedViewRow): SystemViewKey | null {
  if (!row.is_system) return null;
  return (SYSTEM_VIEW_KEYS as readonly string[]).includes(row.system_key ?? "")
    ? (row.system_key as SystemViewKey)
    : null;
}

/**
 * Built-in views in their fixed order, then custom views oldest first; each
 * view the viewer has dragged then takes its saved position. Views they have
 * never placed (new, or newly shared with them) keep that default order after
 * the placed ones, so a colleague sharing a view never reshuffles your list.
 */
function sortViews(views: SavedView[]): SavedView[] {
  const fallback = (view: SavedView) =>
    view.systemKey
      ? SYSTEM_VIEW_KEYS.indexOf(view.systemKey)
      : SYSTEM_VIEW_KEYS.length;

  return [...views].sort((a, b) => {
    const pa = a.position ?? Number.MAX_SAFE_INTEGER;
    const pb = b.position ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;

    const fa = fallback(a);
    const fb = fallback(b);
    if (fa !== fb) return fa - fb;

    return a.created_at.localeCompare(b.created_at);
  });
}

export async function fetchTenantSavedViews(
  tenantSlug: string,
): Promise<SavedView[]> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const tenantId = await tenantIdFor(tenantSlug);

  // RLS decides what is visible: own views, built-in views, and shared views
  // whose visibility_roles include the viewer's role.
  const [{ data: views, error }, { data: prefs, error: prefsError }] =
    await Promise.all([
      supabase
        .from("saved_views")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: true }),
      supabase
        .from("saved_view_user_preferences")
        .select("saved_view_id, order_position")
        .eq("tenant_id", tenantId)
        .eq("user_id", user.id),
    ]);

  // Thrown, not swallowed: an empty list here reads as "your views are gone",
  // and the route's error.tsx (and Sentry) never hear about the outage.
  if (error || !views) {
    throw new Error(
      `Couldn't load saved views: ${error?.message ?? "no data"}`,
    );
  }

  if (prefsError) {
    // The list still renders in default order without them.
    console.error("Error fetching saved view order:", prefsError.message);
  }

  const prefByView = new Map(
    ((prefs ?? []) as PreferenceRow[]).map((pref) => [
      pref.saved_view_id,
      pref,
    ]),
  );

  // One head-count per view. Filters differ per row so these cannot be folded
  // into a single query; they run in parallel and fetch no rows.
  const viewsWithCounts = await Promise.all(
    (views as SavedViewRow[]).map(async (view): Promise<SavedView> => {
      const filter = normalizeFilter(view.filter_json);

      let query = supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);

      // The AND / OR rules as one logic tree; the queue applies the same one.
      const logic = filterToPostgrest(filter, user.id);
      if (logic) query = query.or(logic);

      const { count } = await query;
      const pref = prefByView.get(view.id);
      const systemKey = systemKeyOf(view);

      return {
        id: view.id,
        name: view.name,
        filter_json: view.filter_json ?? {},
        is_shared: view.is_shared,
        created_at: view.created_at,
        updated_at: view.updated_at ?? view.created_at,
        filter,
        isOwn: !systemKey && view.owner_user_id === user.id,
        isSystem: Boolean(systemKey),
        systemKey,
        visibilityRoles: normalizeViewRoles(view.visibility_roles),
        position: pref?.order_position ?? null,
        ticketCount: count ?? 0,
      };
    }),
  );

  return sortViews(viewsWithCounts);
}

/**
 * Every view the viewer can see (built-in and custom), in their order from
 * the Views page, as the tickets page tabs.
 */
export async function fetchSavedViewTabs(
  tenantSlug: string,
): Promise<SavedViewTab[]> {
  // The queue still works without its tabs, so a failure here doesn't take
  // the tickets page down with it.
  let views: SavedView[];
  try {
    views = await fetchTenantSavedViews(tenantSlug);
  } catch (error) {
    console.error(error);
    return [];
  }

  return views.map((view) => ({
    id: view.id,
    name: view.name,
    count: view.ticketCount,
    isAll: view.systemKey === "all",
  }));
}

/**
 * The filter of one view the viewer can see, for ?view= on the tickets page;
 * null when the id is unknown or out of reach (RLS).
 */
export async function fetchSavedViewFilter(
  tenantSlug: string,
  viewId: string,
): Promise<ViewFilter | null> {
  const supabase = await createSupabaseServerClient();
  const tenantId = await tenantIdFor(tenantSlug);

  const { data } = await supabase
    .from("saved_views")
    .select("filter_json")
    .eq("tenant_id", tenantId)
    .eq("id", viewId)
    .maybeSingle();

  return data
    ? normalizeFilter(data.filter_json as TicketFilterJson | null)
    : null;
}

/** What a create or update checks against, loaded once per save. */
export type SaveContext = {
  tenantId: string;
  userId: string;
  /**
   * Every view the viewer can see (their own, built-in, or shared with them).
   * Teammates' private views are outside RLS, so two people can each keep
   * the same personal view.
   */
  views: {
    id: string;
    name: string;
    filter: ViewFilter;
    isOwnCustom: boolean;
  }[];
};

export async function loadSaveContext(
  tenantSlug: string,
): Promise<SaveContext> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    throw new SavedViewError("Your session has expired. Sign in again.");

  const tenantId = await tenantIdFor(tenantSlug);

  const { data, error } = await supabase
    .from("saved_views")
    .select("id, name, filter_json, owner_user_id, is_system")
    .eq("tenant_id", tenantId);

  if (error) throw new Error(error.message);

  return {
    tenantId,
    userId: user.id,
    views: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      filter: normalizeFilter(row.filter_json as TicketFilterJson | null),
      isOwnCustom: !row.is_system && row.owner_user_id === user.id,
    })),
  };
}

export type SavedViewInput = {
  name: string;
  filterJson: TicketFilterJson;
  isShared: boolean;
  visibilityRoles: ViewRole[];
};

export async function createTenantSavedView(
  context: Pick<SaveContext, "tenantId" | "userId">,
  input: SavedViewInput,
): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("saved_views").insert({
    tenant_id: context.tenantId,
    owner_user_id: context.userId,
    name: input.name,
    filter_json: input.filterJson,
    is_shared: input.isShared,
    visibility_roles: input.visibilityRoles,
  });

  if (error?.code === VIEW_LIMIT_SQLSTATE) {
    throw new SavedViewError(
      `You can have up to ${CUSTOM_VIEWS_PER_USER_MAX} custom saved views. Delete one to add another.`,
    );
  }
  if (error) throw new Error(error.message);
}

export async function deleteTenantSavedView(
  tenantSlug: string,
  viewId: string,
): Promise<void> {
  const supabase = await createSupabaseServerClient();

  // RLS already restricts this to the owner and keeps built-in views out of
  // reach; the tenant filter is defence in depth so a stale id from another
  // workspace cannot be aimed at this one.
  const tenantId = await tenantIdFor(tenantSlug);

  const { data, error } = await supabase
    .from("saved_views")
    .delete()
    .eq("id", viewId)
    .eq("tenant_id", tenantId)
    .eq("is_system", false)
    .select("id");

  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new SavedViewError(
      "That view no longer exists, or isn't yours to delete.",
    );
  }
}

export async function updateTenantSavedView(
  context: Pick<SaveContext, "tenantId">,
  viewId: string,
  input: SavedViewInput,
): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { tenantId } = context;

  // updated_at is stamped by the set_saved_views_updated_at trigger.
  const { data, error } = await supabase
    .from("saved_views")
    .update({
      name: input.name,
      filter_json: input.filterJson,
      is_shared: input.isShared,
      visibility_roles: input.visibilityRoles,
    })
    .eq("id", viewId)
    .eq("tenant_id", tenantId)
    .eq("is_system", false)
    .select("id");

  if (error) throw new Error(error.message);
  if (!data?.length) {
    throw new SavedViewError(
      "That view no longer exists, or isn't yours to edit.",
    );
  }
}

/**
 * Store the viewer's order. Writes only their own preference rows; RLS
 * rejects the whole batch if any id is a view they cannot see.
 */
export async function saveSavedViewOrder(
  tenantSlug: string,
  orderedIds: string[],
): Promise<void> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    throw new SavedViewError("Your session has expired. Sign in again.");

  const tenantId = await tenantIdFor(tenantSlug);

  const { error } = await supabase.from("saved_view_user_preferences").upsert(
    orderedIds.map((id, index) => ({
      tenant_id: tenantId,
      user_id: user.id,
      saved_view_id: id,
      order_position: index,
    })),
    { onConflict: "user_id,saved_view_id" },
  );

  if (error) throw new Error(error.message);
}
