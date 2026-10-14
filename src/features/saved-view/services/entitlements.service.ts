import "server-only";

import { cache } from "react";

import {
  getSessionTenantSlug,
  getTenantIdBySlug,
} from "@/features/tenancy/services/tenant-resolver";
import { getTenantPlanRecord } from "@/features/team/services/team.service";

/**
 * What the tenant's plan unlocks. Read from the plan's features_json; any
 * feature a plan doesn't list is off.
 */
export type Entitlements = {
  savedViews: boolean;
  branding: boolean;
  businessHours: boolean;
  auditLogs: boolean;
  advancedRoles: boolean;
  /** -1 means unlimited. */
  slaPolicies: number;
};

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
