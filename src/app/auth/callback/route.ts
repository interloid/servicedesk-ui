import { NextResponse, type NextRequest } from "next/server";

import {
  exchangeOAuthCode,
  safeNext,
} from "@/features/auth/services/auth.service";
import { getTenantSlugById } from "@/features/tenancy/services/tenant-resolver";
import { TENANT_ROUTES, tenantPath } from "@/lib/tenancy";
import { APP_ROUTES } from "@/lib/routes";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");
  const next = safeNext(rawNext);

  if (!code) {
    const loginUrl = new URL(APP_ROUTES.LOGIN, origin);
    loginUrl.searchParams.set("error", "Missing code");

    return NextResponse.redirect(loginUrl);
  }

  try {
    const sessionUser = await exchangeOAuthCode(code);

    if (next === TENANT_ROUTES.RESET_PASSWORD) {
      const userTenantSlug = await getTenantSlugById(
        sessionUser.tenantId ?? "",
      );

      if (userTenantSlug) {
        return NextResponse.redirect(
          new URL(
            tenantPath(userTenantSlug, TENANT_ROUTES.RESET_PASSWORD),
            origin,
          ),
        );
      }

      return NextResponse.redirect(new URL(APP_ROUTES.RESET_PASSWORD, origin));
    }

    return NextResponse.redirect(new URL(next, origin));
  } catch (error) {
    console.error("[auth] Callback failed:", error);

    const loginUrl = new URL(APP_ROUTES.LOGIN, origin);
    loginUrl.searchParams.set("error", "Authentication failed");

    return NextResponse.redirect(loginUrl);
  }
}
