import { headers } from "next/headers";
import { PORTAL_BASE_DOMAIN, tenantLabelFromHost } from "@/lib/tenancy";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type TenantContext = {
  id: string;
  name: string;
  slug: string;
  portalUrl: string;
  /** Null when the tenant has no logo set — the chrome renders initials instead. */
  logoUrl: string | null;
  primaryColor: string | null;
};

/** The raw shape returned by PostgreSQL queries or RPC */
type TenantLookupRow = {
  id: string;
  name: string;
  slug: string;
  primary_color?: string | null;
  logo_url?: string | null;
};

/**
 * Resolves the active tenant context.
 * 
 * @param slugParam - Optional slug explicitly passed from route params.
 *                    If omitted, resolves the tenant from the Request Host header.
 */
export async function getTenantContext(slugParam?: string): Promise<TenantContext | null> {
  let label = slugParam;

  // 1. If no explicit slug passed, extract it automatically from the host header
  if (!label) {
    const requestHeaders = await headers();
    const hostLabel = tenantLabelFromHost(requestHeaders.get("host"));
    if (!hostLabel) return null; // Central / main domain context
    label = hostLabel;
  }

  const supabase = await createSupabaseAdminClient();

  try {

    // 3. Fallback attempt: Direct table query if RPC is missing in PostgreSQL
    const { data: tableData, error: tableError } = await supabase
      .from("tenants")
      .select("id, name, slug")
      .eq("slug", label)
      .maybeSingle();

    if (tableError) {
      console.error(`[tenancy] resolve "${label}" failed: ${tableError.message}`);
      return null;
    }

    if (!tableData) {
      console.warn(`[tenancy] workspace "${label}" not found in database.`);
      return null;
    }

    return mapTenantContext(tableData as TenantLookupRow);

  } catch (err) {
    console.error(`[tenancy] Unexpected error resolving workspace "${label}":`, err);
    return null;
  }
}

/** Helper to format raw database rows into strongly-typed `TenantContext` */
function mapTenantContext(row: TenantLookupRow): TenantContext {
  const baseDomain = PORTAL_BASE_DOMAIN || "localhost:3000";
  
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    portalUrl: `${row.slug}.${baseDomain}`,
    logoUrl: row.logo_url?.trim() || null,
    primaryColor: row.primary_color?.trim() || null,
  };
}