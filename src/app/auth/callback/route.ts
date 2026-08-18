import { NextResponse, type NextRequest } from "next/server";
import {
  AuthError,
  exchangeOAuthCode,
  safeNext,
} from "@/features/auth/services/auth.service";
import { getTenantSlugById } from "@/features/tenancy/services/tenant-resolver";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");
  const next = safeNext(rawNext);

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=Missing+code", origin));
  }

  try {
    const sessionUser = await exchangeOAuthCode(code);

    if (rawNext === "/reset-password") {
      const userTenantSlug = await getTenantSlugById(
        sessionUser.tenantId || "",
      );

      if (userTenantSlug) {
        return NextResponse.redirect(
          new URL(`/tenant/${userTenantSlug}/reset-password`, origin),
        );
      }

      return NextResponse.redirect(new URL("/reset-password", origin));
    }

    return NextResponse.redirect(new URL(next, origin));
  } catch (error) {
    console.error("[auth] Callback failed:", error);
    return NextResponse.redirect(
      new URL("/login?error=Authentication+failed", origin),
    );
  }
}
