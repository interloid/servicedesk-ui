import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/config/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isValidTenantSlug } from "@/lib/tenancy";

import type { UpdateBrandingValues } from "@/features/branding/schemas/branding";
import { trustedTenantLogoUrl } from "@/features/portal/avatar-url";

import type {
  BrandingFailureCode,
  BrandingField,
  BrandingJson,
  LogoUploadTarget,
  SlugAvailability,
  TenantBranding,
} from "@/features/branding/branding";
import {
  DEFAULT_SHOW_LOGO_ON_PORTAL,
  LOGO_BUCKET,
  LOGO_MIME_TYPES,
  MAX_LOGO_BYTES,
  PORTAL_DOMAIN,
} from "@/features/branding/branding";

export class BrandingError extends Error {
  readonly status: number;
  readonly code: BrandingFailureCode;
  readonly field?: BrandingField;

  constructor(
    message: string,
    {
      status = 400,
      code = "unknown",
      field,
    }: {
      status?: number;
      code?: BrandingFailureCode;
      field?: BrandingField;
    } = {},
  ) {
    super(message);
    this.name = "BrandingError";
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

type PostgrestFailure = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

function toFailureCode(pgCode: string | undefined): BrandingFailureCode {
  switch (pgCode) {
    case "42501":
      return "action-not-allowed";
    case "23505":
      return "slug-taken";
    case "23503":
    case "P0001":
      return "not-found";
    default:
      return "unknown";
  }
}

function fail(
  userMessage: string,
  error: PostgrestFailure | null | undefined,
  status = 500,
) {
  if (error) {
    console.error(
      `[branding] ${userMessage} — ${error.code ?? "?"} ${error.message ?? ""}`.trim(),
      error.details ? `\n  details: ${error.details}` : "",
      error.hint ? `\n  hint: ${error.hint}` : "",
    );
  }

  return new BrandingError(userMessage, {
    status,
    code: toFailureCode(error?.code),
  });
}

type BrandingActor = {
  userId: string;
  tenantId: string;
  role: string | null;
};

async function requireActor(supabase: SupabaseClient): Promise<BrandingActor> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new BrandingError("Sign in to do that.", {
      status: 401,
      code: "action-not-allowed",
    });
  }

  const { data: claims } = await supabase.auth.getClaims();
  const tenantId = claims?.claims?.tenant_id as string | undefined;

  if (!tenantId) {
    throw new BrandingError(
      "Your account isn't attached to an organization yet.",
      {
        status: 403,
        code: "action-not-allowed",
      },
    );
  }

  const tenantRole = claims?.claims?.tenant_role as string | undefined;

  return { userId: user.id, tenantId, role: tenantRole ?? null };
}

type TenantRow = {
  name: string;
  slug: string;
  branding_json: unknown;
};

function text(value: unknown): string | null {
  return typeof value === "string" ? value.trim() || null : null;
}

/**
 * branding_json is free-form jsonb, so each field is checked rather than cast:
 * one stray non-string would otherwise throw on `.trim()` and take the whole
 * settings page down with it. Anything of the wrong type reads as unset.
 */
function readBrandingJson(value: unknown): BrandingJson {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const json = value as Record<string, unknown>;

  return {
    ...json,
    logo_url: text(json.logo_url),
    primary_color: text(json.primary_color),
    secondary_color: text(json.secondary_color),
    text_color: text(json.text_color),
    background_color: text(json.background_color),
    support_email: text(json.support_email),
    show_logo_on_portal:
      typeof json.show_logo_on_portal === "boolean"
        ? json.show_logo_on_portal
        : undefined,
  };
}

function toBranding(row: TenantRow): TenantBranding {
  const json = readBrandingJson(row.branding_json);

  return {
    name: row.name,
    slug: row.slug,
    portalUrl: `${row.slug}.${PORTAL_DOMAIN}`,
    // Filtered the way the portal filters it, so the preview never shows a
    // logo that customers would not see.
    logoUrl: trustedTenantLogoUrl(json.logo_url ?? null),
    primaryColor: json.primary_color ?? null,
    secondaryColor: json.secondary_color ?? null,
    textColor: json.text_color ?? null,
    backgroundColor: json.background_color ?? null,
    supportEmail: json.support_email ?? null,
    showLogoOnPortal: json.show_logo_on_portal ?? DEFAULT_SHOW_LOGO_ON_PORTAL,
  };
}

export async function getBranding(): Promise<TenantBranding | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return null;
  }

  const { data: row, error: rowError } = await supabase
    .from("tenants")
    .select("name, slug, branding_json")
    .maybeSingle();

  if (rowError) {
    throw fail("Couldn't load your branding.", rowError);
  }

  return row ? toBranding(row as TenantRow) : null;
}

export async function canEditBranding(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return false;
  }

  const { data: claims } = await supabase.auth.getClaims();
  const tenantRole = claims?.claims?.tenant_role as string | undefined;

  return tenantRole === "tenant_admin";
}

export async function updateBranding(
  values: UpdateBrandingValues,
): Promise<TenantBranding> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireAdmin(supabase);

  const { data: row, error: rowError } = await supabase
    .from("tenants")
    .select("id, name, slug, branding_json")
    .maybeSingle();

  if (rowError) {
    throw fail("Couldn't load your branding.", rowError);
  }

  const tenant = row as (TenantRow & { id: string }) | null;

  if (!tenant) {
    throw new BrandingError("Your workspace wasn't found.", {
      status: 404,
      code: "not-found",
    });
  }

  const slugChanged = tenant.slug !== values.slug;

  // Only a new address is checked: a workspace created before the reserved
  // list (tenants_slug_not_reserved is NOT VALID) keeps its slug and can
  // still save the rest of its branding.
  if (slugChanged && !isValidTenantSlug(values.slug)) {
    throw new BrandingError("That address is reserved. Try another.", {
      code: "validation",
      field: "slug",
    });
  }

  // A plain select on tenants only ever sees this tenant's row (RLS), so it
  // could never find a clash; the RPC can.
  if (
    slugChanged &&
    (await lookupSlug(supabase, values.slug, actor.tenantId)) === "taken"
  ) {
    throw slugTakenError(values.slug);
  }

  const logoUrl = values.logoUrl?.trim() || null;

  // Logos come from the upload flow, which only writes under this folder. A
  // URL from anywhere else would be loaded by every admin who opens this page.
  if (logoUrl && !logoUrl.startsWith(ownLogoPrefix(actor.tenantId))) {
    throw new BrandingError("Upload the logo instead of linking to it.", {
      code: "validation",
      field: "logoUrl",
    });
  }

  const current = readBrandingJson(tenant.branding_json);

  // show_logo_on_email was this toggle's old key, from when it was meant for
  // email. Nothing reads it now, so it is dropped rather than left to mislead.
  const kept: BrandingJson & { show_logo_on_email?: boolean } = { ...current };
  delete kept.show_logo_on_email;

  const nextJson: BrandingJson = {
    ...kept,
    logo_url: logoUrl,
    primary_color: values.primaryColor,
    // Empty string means "clear it" — stored as null so brandCssVars omits the
    // token entirely and the app default applies again.
    secondary_color: values.secondaryColor?.trim() || null,
    text_color: values.textColor?.trim() || null,
    background_color: values.backgroundColor?.trim() || null,
    support_email: values.supportEmail.trim() || null,
    show_logo_on_portal: values.showLogoOnPortal,
  };

  const patch: {
    name: string;
    branding_json: BrandingJson;
    slug?: string;
    updated_at: string;
  } = {
    name: values.name,
    branding_json: nextJson,
    updated_at: new Date().toISOString(),
  };

  if (slugChanged) {
    patch.slug = values.slug;
  }

  const { data: updated, error: updateError } = await supabase
    .from("tenants")
    .update(patch)
    .eq("id", tenant.id)
    .select("name, slug, branding_json")
    .maybeSingle();

  if (updateError) {
    // Another workspace took the address between the check and the save.
    if (updateError.code === "23505") {
      throw slugTakenError(values.slug);
    }

    throw fail("We couldn't save your branding.", updateError);
  }

  if (!updated) {
    throw new BrandingError("Your workspace wasn't found.", {
      status: 404,
      code: "not-found",
    });
  }

  if (slugChanged) {
    // The token's tenant_slug is still the old address, and the proxy sends
    // every request back to it -- where no workspace exists any more. A
    // refresh runs the access token hook again, which reads the new slug.
    const { error: refreshError } = await supabase.auth.refreshSession();

    if (refreshError) {
      console.error(
        "[branding] session refresh after a slug change failed:",
        refreshError.message,
      );
    }
  }

  await removeUnusedLogos(actor.tenantId, logoUrl);

  return toBranding(updated as TenantRow);
}

function slugTakenError(slug: string) {
  return new BrandingError(
    `That portal address is taken. Try ${slug}-support.`,
    { status: 409, code: "slug-taken", field: "slug" },
  );
}

function logoFolder(tenantId: string): string {
  return `${tenantId}/branding`;
}

function ownLogoPrefix(tenantId: string): string {
  const base = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${LOGO_BUCKET}/${logoFolder(tenantId)}/`;
}

/**
 * Every upload writes a new file, so replaced, removed and abandoned logos pile
 * up in a public bucket -- and a "removed" logo stays reachable at its URL.
 * After a save, older files in the folder other than the logo in use go.
 * Best effort: a failed sweep is logged and retried on the next save.
 */
async function removeUnusedLogos(tenantId: string, keepUrl: string | null) {
  const admin = createSupabaseAdminClient();
  const folder = logoFolder(tenantId);
  const keep = keepUrl?.slice(ownLogoPrefix(tenantId).length) ?? null;

  const { data: files, error } = await admin.storage
    .from(LOGO_BUCKET)
    .list(folder, { limit: 100 });

  if (error) {
    console.error("[branding] listing old logos failed:", error.message);
    return;
  }

  // Files from the last day are left alone: another admin may have just
  // uploaded one and not saved yet.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const stale = (files ?? [])
    .filter(
      (file) =>
        file.id &&
        file.name !== keep &&
        file.created_at !== null &&
        new Date(file.created_at).getTime() < cutoff,
    )
    .map((file) => `${folder}/${file.name}`);

  if (stale.length === 0) return;

  const { error: removeError } = await admin.storage
    .from(LOGO_BUCKET)
    .remove(stale);

  if (removeError) {
    console.error("[branding] removing old logos failed:", removeError.message);
  }
}

async function requireAdmin(supabase: SupabaseClient): Promise<BrandingActor> {
  const actor = await requireActor(supabase);

  if (actor.role !== "tenant_admin") {
    throw new BrandingError("Only a Tenant Admin can change branding.", {
      status: 403,
      code: "action-not-allowed",
    });
  }

  return actor;
}

/**
 * Authorise one logo upload. The browser sends the bytes straight to Storage
 * with the token -- a Server Action body is capped at 1 MB. Nothing is saved
 * here: the public URL only becomes the logo when the admin saves the form.
 */
export async function prepareLogoUpload(file: {
  size: number;
  type: string;
}): Promise<LogoUploadTarget> {
  const supabase = await createSupabaseServerClient();
  const actor = await requireAdmin(supabase);

  if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new BrandingError("Use a PNG, JPG or WebP image.", {
      code: "validation",
    });
  }

  if (file.size <= 0 || file.size > MAX_LOGO_BYTES) {
    throw new BrandingError("Logos can be up to 2 MB.", {
      code: "validation",
    });
  }

  const extension = file.type.split("/")[1].replace("jpeg", "jpg");
  const path = `${actor.tenantId}/branding/logo-${Date.now()}.${extension}`;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage
    .from(LOGO_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error(
      "[branding] could not authorise a logo upload:",
      error?.message ?? "no token returned",
    );
    throw new BrandingError(
      "We couldn't start that upload. Try again in a moment.",
    );
  }

  const {
    data: { publicUrl },
  } = admin.storage.from(LOGO_BUCKET).getPublicUrl(path);

  return { path, token: data.token, publicUrl };
}

/**
 * Whether `slug` could become this workspace's portal address.
 *
 * Goes through get_tenant_by_slug because tenants_select only shows the
 * caller's own row -- a plain select would call every address free. Advisory
 * only: the unique constraint still decides at save time.
 */
export async function checkSlugAvailability(
  slug: string,
): Promise<SlugAvailability> {
  const value = slug.trim().toLowerCase();

  if (!isValidTenantSlug(value)) {
    return "invalid";
  }

  const supabase = await createSupabaseServerClient();
  const actor = await requireAdmin(supabase);

  return lookupSlug(supabase, value, actor.tenantId);
}

async function lookupSlug(
  supabase: SupabaseClient,
  slug: string,
  tenantId: string,
): Promise<Exclude<SlugAvailability, "invalid">> {
  const { data, error } = await supabase.rpc("get_tenant_by_slug", {
    p_slug: slug,
  });

  if (error) {
    throw fail("Couldn't check that portal address.", error);
  }

  const match = data as { id?: string } | null;

  if (!match?.id) return "available";
  return match.id === tenantId ? "current" : "taken";
}
