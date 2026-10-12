import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  escapeSearchTerm,
  normalizeFilter,
  type TicketFilterJson,
  type ViewFilter,
} from "@/features/saved-view/filters";
import { cache } from "react";
import {
  getSessionTenantSlug,
  getTenantIdBySlug,
} from "@/features/tenancy/services/tenant-resolver";
import { getTenantPlanRecord } from "@/features/team/services/team.service";
export type { TicketFilterJson };
export type Entitlements = {
  savedViews: boolean;
  branding: boolean;
  businessHours: boolean;
  auditLogs: boolean;
  advancedRoles: boolean;
  /** -1 means unlimited. */
  slaPolicies: number;
};
export interface SavedView {
  id: string;
  tenant_id: string;
  owner_user_id: string;
  name: string;
  filter_json: TicketFilterJson;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
  ticketCount: number;
  /** filter_json read through normalizeFilter, so legacy rows still work. */
  filter: ViewFilter;
  isOwn: boolean;
}

export async function fetchTenantSavedViews(
  tenantSlug: string,
): Promise<SavedView[]> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .single();

  if (!tenant) return [];

  const { data: views, error } = await supabase
    .from("saved_views")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: true });

  if (error || !views) {
    console.error("Error fetching saved views:", error?.message);
    return [];
  }

  // One head-count per view. Filters differ per row so these cannot be folded
  // into a single query; they run in parallel and fetch no rows.
  const viewsWithCounts = await Promise.all(
    (views as SavedView[]).map(async (view) => {
      const filter = normalizeFilter(view.filter_json);

      let query = supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id);

      if (filter.statuses.length) {
        query = query.in("status", filter.statuses);
      }

      if (filter.priorities.length) {
        query = query.in("priority", filter.priorities);
      }

      if (filter.assignee === "unassigned") {
        query = query.is("assignee_user_id", null);
      } else if (filter.assignee === "me" && user) {
        query = query.eq("assignee_user_id", user.id);
      }

      if (filter.search) {
        const term = escapeSearchTerm(filter.search);
        query = query.or(`subject.ilike.%${term}%,description.ilike.%${term}%`);
      }

      const { count } = await query;

      return {
        ...view,
        filter,
        isOwn: view.owner_user_id === user?.id,
        ticketCount: count ?? 0,
      };
    }),
  );

  return viewsWithCounts;
}

type RlsClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function tenantIdFor(
  supabase: RlsClient,
  tenantSlug: string,
): Promise<string> {
  const { data } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .single();

  if (!data) throw new Error("Tenant not found");

  return data.id as string;
}

export async function createTenantSavedView(
  tenantSlug: string,
  name: string,
  filterJson: TicketFilterJson,
  isShared: boolean = false,
): Promise<SavedView> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .single();

  if (!tenant) throw new Error("Tenant not found");

  const { data, error } = await supabase
    .from("saved_views")
    .insert([
      {
        tenant_id: tenant.id,
        owner_user_id: user.id,
        name,
        filter_json: filterJson,
        is_shared: isShared,
      },
    ])
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as SavedView;
}

export async function deleteTenantSavedView(
  tenantSlug: string,
  viewId: string,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();

  // RLS already restricts this to the owner; the tenant filter is defence in
  // depth so a stale id from another workspace cannot be aimed at this one.
  const tenantId = await tenantIdFor(supabase, tenantSlug);

  const { error } = await supabase
    .from("saved_views")
    .delete()
    .eq("id", viewId)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(error.message);
  return true;
}

export async function updateTenantSavedView(
  tenantSlug: string,
  viewId: string,
  updates: {
    name?: string;
    filter_json?: TicketFilterJson;
    is_shared?: boolean;
  },
): Promise<SavedView> {
  const supabase = await createSupabaseServerClient();

  const tenantId = await tenantIdFor(supabase, tenantSlug);

  const { data, error } = await supabase
    .from("saved_views")
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq("id", viewId)
    .eq("tenant_id", tenantId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as SavedView;
}

export const getTenantEntitlements = cache(async function getTenantEntitlements(
  tenantSlug: string,
): Promise<Entitlements> {
  // The slug arrives from the caller — a route param on a page, but a plain
  // argument in a Server Action, which is reachable by direct POST. Since the
  // lookup below bypasses RLS, the slug has to be the caller's own workspace or
  // this would answer "what plan is that other company on?" for anyone who
  // asked.
  const sessionSlug = await getSessionTenantSlug();

  if (!sessionSlug || sessionSlug !== tenantSlug) {
    return FREE_ENTITLEMENTS;
  }

  const tenantId = await getTenantIdBySlug(tenantSlug);

  if (!tenantId) {
    return FREE_ENTITLEMENTS;
  }

  const plan = await getTenantPlanRecord(tenantId);

  return readEntitlements(plan?.featuresJson);
});
export const FREE_SEAT_LIMIT = 2;

export const FREE_ENTITLEMENTS: Entitlements = {
  savedViews: false,
  branding: false,
  businessHours: false,
  auditLogs: false,
  advancedRoles: false,
  slaPolicies: 1,
};
type FeaturesJson = Record<string, unknown> | null | undefined;

export function readEntitlements(features: FeaturesJson): Entitlements {
  if (!features) {
    return FREE_ENTITLEMENTS;
  }

  const slaPolicies = features["sla_policies"];

  return {
    savedViews: flag(features, "saved_shared_views"),
    branding: flag(features, "branding"),
    businessHours: flag(features, "business_hours"),
    auditLogs: flag(features, "audit_logs"),
    advancedRoles: flag(features, "advanced_roles"),
    slaPolicies:
      typeof slaPolicies === "number"
        ? slaPolicies
        : FREE_ENTITLEMENTS.slaPolicies,
  };
}
function flag(features: FeaturesJson, key: string): boolean {
  return features?.[key] === true;
}
