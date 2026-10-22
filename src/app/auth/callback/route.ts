import { NextResponse, type NextRequest } from "next/server";
import {
  AuthError,
  exchangeOAuthCode,
  logout,
  safeNext,
} from "@/features/auth/services/auth.service";
import {
  defaultTenantLanding,
  isTenantRouteAllowed,
  isValidTenantSlug,
  stripTenantPrefix,
  tenantLoginPath,
  tenantPath,
  TENANT_ROUTES,
} from "@/lib/tenancy";
import { APP_ROUTES } from "@/lib/routes";
import type { LoginErrorCode } from "@/features/auth/login-errors";

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

  // The code, never the message: the login page maps it back to fixed copy,
  // so a crafted link cannot put arbitrary text in the sign-in alert.
  function failure(code: LoginErrorCode) {
    const loginUrl = new URL(loginPath, origin);
    loginUrl.searchParams.set("error", code);

    return NextResponse.redirect(loginUrl);
  }

  async function rejectSession(code: LoginErrorCode) {
    try {
      await logout();
    } catch (error) {
      console.error("[app-auth] failed to revoke rejected session:", error);
    }

    return failure(code);
  }

  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");

  if (providerError) {
    console.error("[app-auth] provider returned an error:", providerError);

    return failure("provider_error");
  }

  const code = searchParams.get("code");

  if (!code) {
    return failure("incomplete");
  }

  try {
    const { tenantSlug, role } = await exchangeOAuthCode(code);
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
      return rejectSession("no_workspace");
    }

    if (requestedSlug && requestedSlug !== tenantSlug) {
      return rejectSession("not_member");
    }

    const landing = isTenantRouteAllowed(role, destination)
      ? destination
      : defaultTenantLanding(role);

    return NextResponse.redirect(
      new URL(tenantPath(tenantSlug, landing), origin),
    );
  } catch (error) {
    console.error("[app-auth] Callback failed:", error);

    if (error instanceof AuthError) {
      return failure(
        error.code === "no_workspace_access"
          ? "no_workspace_access"
          : "expired",
      );
    }

    return failure("unknown");
  }
}
