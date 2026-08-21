import { NextResponse, type NextRequest } from "next/server";
import {
  exchangeOAuthCode,
  logout,
  safeNext,
} from "@/features/auth/services/auth.service";
import { TENANT_ROUTES, tenantPath, withTenantPrefix } from "@/lib/tenancy";
import { APP_ROUTES } from "@/lib/routes";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string }> },
) {
  const { searchParams, origin } = request.nextUrl;

  const { tenantSlug: targetTenantSlug } = await params;

  const next = safeNext(searchParams.get("next"));

  const tenantLoginUrl = new URL(`/tenant/${targetTenantSlug}/login`, origin);

  function failure(message: string) {
    tenantLoginUrl.searchParams.set("error", message);

    return NextResponse.redirect(tenantLoginUrl);
  }

  async function rejectSession(message: string) {
    try {
      await logout();
    } catch (error) {
      console.error("[tenant-auth] failed to revoke rejected session:", error);
    }

    return failure(message);
  }

  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");

  if (providerError) {
    console.error("[tenant-auth] provider returned an error:", providerError);

    return failure(providerError);
  }

  const code = searchParams.get("code");

  if (!code) {
    return failure("That sign-in link is incomplete. Start again.");
  }

  try {
    const { tenantId, tenantSlug } = await exchangeOAuthCode(code);

    if (!tenantId || !tenantSlug || tenantSlug !== targetTenantSlug) {
      return rejectSession(
        "You are not registered as a member of this workspace. Contact your admin.",
      );
    }

    if (next === TENANT_ROUTES.RESET_PASSWORD) {
      return NextResponse.redirect(
        new URL(tenantPath(tenantSlug, APP_ROUTES.RESET_PASSWORD), origin),
      );
    }

    return NextResponse.redirect(
      new URL(withTenantPrefix(tenantSlug, next), origin),
    );
  } catch (error) {
    console.error("[tenant-auth] Callback failed:", error);

    return failure(
      error instanceof Error ? error.message : "Authentication failed",
    );
  }
}
