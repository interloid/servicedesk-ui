import { headers } from "next/headers";
import { PORTAL_BASE_DOMAIN, tenantLabelFromHost } from "@/lib/tenancy";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type TenantContext = {
  id: string;
  name: string;
  slug: string;
  portalUrl: string;
};

type TenantLookupRow = {
  id: string;
  name: string;
  slug: string;
  logo_url?: string | null;
};

export async function getTenantContext(
  slugParam?: string,
): Promise<TenantContext | null> {
  let label = slugParam;

  if (!label) {
    const requestHeaders = await headers();
    const hostLabel = tenantLabelFromHost(requestHeaders.get("host"));
    if (!hostLabel) return null;
    label = hostLabel;
  }

  const supabase = createSupabaseAdminClient();

  try {
    const { data: tableData, error: tableError } = await supabase
      .from("tenants")
      .select("id, name, slug")
      .eq("slug", label)
      .maybeSingle();

    if (tableError) {
      console.error(
        `[tenancy] resolve "${label}" failed: ${tableError.message}`,
      );
      return null;
    }

    if (!tableData) {
      console.warn(`[tenancy] workspace "${label}" not found in database.`);
      return null;
    }

    return mapTenantContext(tableData as TenantLookupRow);
  } catch (err) {
    console.error(
      `[tenancy] Unexpected error resolving workspace "${label}":`,
      err,
    );
    return null;
  }
}

export async function verifyUserTenantMembership(
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const supabase = createSupabaseAdminClient();

  const { data: membership, error } = await supabase
    .from("memberships")
    .select("id")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    console.error(
      `[tenancy] Membership check failed for user ${userId} in tenant ${tenantId}: ${error.message}`,
    );
    return false;
  }

  return Boolean(membership);
}

export async function getTenantSlugById(
  tenantId: string,
): Promise<string | null> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("tenants")
    .select("slug")
    .eq("id", tenantId)
    .maybeSingle<{ slug: string }>();

  if (error) {
    console.error(
      `[tenancy] slug lookup for tenant ${tenantId} failed: ${error.message}`,
    );

    return null;
  }

  return data?.slug ?? null;
}

export async function getTenantIdBySlug(
  tenantSlug: string,
): Promise<string | null> {
  const supabase = createSupabaseAdminClient();

  const { data, error } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug)
    .maybeSingle<{ id: string }>();

  if (error) {
    console.error(
      `[tenancy] tenant ID lookup for slug ${tenantSlug} failed: ${error.message}`,
    );

    return null;
  }

  return data?.id ?? null;
}
function mapTenantContext(row: TenantLookupRow): TenantContext {
  const baseDomain = PORTAL_BASE_DOMAIN || "";

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    portalUrl: `${row.slug}.${baseDomain}`,
  };
}
