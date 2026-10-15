import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isValidTenantSlug } from "@/lib/tenancy";

import type { UpdateBrandingValues } from "@/features/branding/schemas/branding";
import type {
  BrandingFailureCode,
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

  constructor(
    message: string,
    { status = 400, code = "unknown" as BrandingFailureCode } = {},
  ) {
    super(message);
    this.name = "BrandingError";
    this.status = status;
    this.code = code;
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
  branding_json: BrandingJson | null;
};

function toBranding(row: TenantRow): TenantBranding {
  const json = row.branding_json ?? {};

  return {
    name: row.name,
    slug: row.slug,
    portalUrl: `${row.slug}.${PORTAL_DOMAIN}`,
    logoUrl: json.logo_url?.trim() || null,
    primaryColor: json.primary_color?.trim() || null,
    secondaryColor: json.secondary_color?.trim() || null,
    textColor: json.text_color?.trim() || null,
    backgroundColor: json.background_color?.trim() || null,
    supportEmail: json.support_email?.trim() || null,
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

  return row ? toBranding(row as unknown as TenantRow) : null;
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
  const actor = await requireActor(supabase);

  if (actor.role !== "tenant_admin") {
    throw new BrandingError("Only a Tenant Admin can change branding.", {
      status: 403,
      code: "action-not-allowed",
    });
  }

  const { data: row, error: rowError } = await supabase
    .from("tenants")
    .select("id, name, slug, branding_json")
    .maybeSingle();

  if (rowError) {
    throw fail("Couldn't load your branding.", rowError);
  }

  const tenant = row as unknown as (TenantRow & { id: string }) | null;

  if (!tenant) {
    throw new BrandingError("Your workspace wasn't found.", {
      status: 404,
      code: "not-found",
    });
  }

  const slugChanged = tenant.slug !== values.slug;

  if (slugChanged) {
    const { data: clash, error: clashError } = await supabase
      .from("tenants")
      .select("id")
      .eq("slug", values.slug)
      .neq("id", tenant.id)
      .maybeSingle();

    if (clashError) {
      throw fail("Couldn't check that portal address.", clashError);
    }

    if (clash) {
      throw new BrandingError(
        `That portal address is taken. Try ${values.slug}-support.`,
        { status: 409, code: "slug-taken" },
      );
    }
  }

  const current = tenant.branding_json ?? {};

  // show_logo_on_email was this toggle's old key, from when it was meant for
  // email. Nothing reads it now, so it is dropped rather than left to mislead.
  const kept: BrandingJson & { show_logo_on_email?: boolean } = { ...current };
  delete kept.show_logo_on_email;

  const nextJson: BrandingJson = {
    ...kept,
    logo_url: values.logoUrl?.trim() || null,
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
    throw fail("We couldn't save your branding.", updateError);
  }

  if (!updated) {
    throw new BrandingError("Your workspace wasn't found.", {
      status: 404,
      code: "not-found",
    });
  }

  return toBranding(updated as unknown as TenantRow);
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

  const { data, error } = await supabase.rpc("get_tenant_by_slug", {
    p_slug: value,
  });

  if (error) {
    throw fail("Couldn't check that portal address.", error);
  }

  const match = data as { id?: string } | null;

  if (!match?.id) return "available";
  return match.id === actor.tenantId ? "current" : "taken";
}
