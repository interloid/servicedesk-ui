import { NextResponse, type NextRequest } from "next/server";
import {
  exchangeOAuthCode,
  logout,
  safeNext,
} from "@/features/auth/services/auth.service";
import {
  isValidTenantSlug,
  stripTenantPrefix,
  tenantLoginPath,
  tenantPath,
  TENANT_ROUTES,
} from "@/lib/tenancy";
import { APP_ROUTES } from "@/lib/routes";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const next = safeNext(searchParams.get("next"));
  const parsedNext = stripTenantPrefix(next);

  const requestedSlug = isValidTenantSlug(parsedNext?.slug)
    ? parsedNext.slug
    : null;
  const destination = parsedNext ? parsedNext.rest : next;

  const loginPath = requestedSlug
    ? tenantLoginPath(requestedSlug)
    : APP_ROUTES.LOGIN;

  function failure(message: string) {
    const loginUrl = new URL(loginPath, origin);
    loginUrl.searchParams.set("error", message);

    return NextResponse.redirect(loginUrl);
  }

  async function rejectSession(message: string) {
    try {
      await logout();
    } catch (error) {
      console.error("[app-auth] failed to revoke rejected session:", error);
    }

    return failure(message);
  }

  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");

  if (providerError) {
    console.error("[app-auth] provider returned an error:", providerError);

    return failure(providerError);
  }

  const code = searchParams.get("code");

  if (!code) {
    return failure("That sign-in link is incomplete. Start again.");
  }

  try {
    const { tenantSlug } = await exchangeOAuthCode(code);
    if (destination === TENANT_ROUTES.RESET_PASSWORD) {
      return NextResponse.redirect(
        new URL(
          tenantSlug
            ? tenantPath(tenantSlug, TENANT_ROUTES.RESET_PASSWORD)
            : APP_ROUTES.RESET_PASSWORD,
          origin,
        ),
      );
    }

    if (!tenantSlug) {
      return rejectSession(
        "That Google account isn't a member of any workspace yet. Ask your admin for an invite.",
      );
    }

    if (requestedSlug && requestedSlug !== tenantSlug) {
      return rejectSession(
        "You are not registered as a member of this workspace. Contact your admin.",
      );
    }

    return NextResponse.redirect(
      new URL(tenantPath(tenantSlug, destination), origin),
    );
  } catch (error) {
    console.error("[app-auth] Callback failed:", error);

    return failure(
      error instanceof Error ? error.message : "Authentication failed",
    );
  }
}
