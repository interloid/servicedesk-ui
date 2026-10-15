"use server";

import { revalidatePath } from "next/cache";

import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";

import { updateBrandingSchema } from "@/features/branding/schemas/branding";
import type { TenantBranding } from "@/features/branding/branding";
import type {
  BrandingActionResult,
  LogoUploadTarget,
  SlugAvailability,
} from "@/features/branding/branding";
import {
  BrandingError,
  checkSlugAvailability,
  prepareLogoUpload,
  updateBranding,
} from "@/features/branding/services/branding.service";

function toFailure<T>(
  error: unknown,
  fallback: string,
  context: string,
): BrandingActionResult<T> {
  if (error instanceof BrandingError) {
    return { ok: false, failureCode: error.code, message: error.message };
  }

  console.error(`[branding] ${context} failed`, error);

  return { ok: false, failureCode: "unknown", message: fallback };
}

/**
 * Takes the slug from the saved record rather than the session, because saving
 * branding can change the slug itself -- the page to refresh is the one at the
 * new address. The bare "/settings/branding" this replaces matched no route.
 */
function revalidateBranding(slug: string) {
  revalidatePath(tenantPath(slug, TENANT_ROUTES.SETTINGS.BRANDING));
  revalidatePath(tenantPath(slug, "/"), "layout");
}

export async function updateBrandingAction(
  values: unknown,
): Promise<BrandingActionResult<TenantBranding>> {
  const parsed = updateBrandingSchema.safeParse(values);

  if (!parsed.success) {
    return {
      ok: false,
      failureCode: "validation",
      message: "Check the highlighted fields and try again.",
    };
  }

  try {
    const branding = await updateBranding(parsed.data);
    revalidateBranding(branding.slug);
    return { ok: true, data: branding };
  } catch (error) {
    return toFailure(
      error,
      "We couldn't save your branding. Try again in a moment.",
      "updateBrandingAction",
    );
  }
}

export async function prepareLogoUploadAction(file: {
  size: number;
  type: string;
}): Promise<BrandingActionResult<LogoUploadTarget>> {
  try {
    const target = await prepareLogoUpload({
      size: Number(file?.size) || 0,
      type: String(file?.type ?? ""),
    });
    return { ok: true, data: target };
  } catch (error) {
    return toFailure(
      error,
      "We couldn't start that upload. Try again in a moment.",
      "prepareLogoUploadAction",
    );
  }
}

export async function checkSlugAvailabilityAction(
  slug: string,
): Promise<BrandingActionResult<SlugAvailability>> {
  try {
    return { ok: true, data: await checkSlugAvailability(String(slug ?? "")) };
  } catch (error) {
    return toFailure(
      error,
      "Couldn't check that portal address.",
      "checkSlugAvailabilityAction",
    );
  }
}
