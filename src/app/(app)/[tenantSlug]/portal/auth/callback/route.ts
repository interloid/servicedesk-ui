import { NextResponse, type NextRequest } from "next/server";

import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";
import {
  completePortalEmailSignIn,
  PortalError,
  stepPath,
} from "@/features/portal/services/portal.service";

/**
 * Where the magic link in the sign-in email lands.
 *
 * Separate from the agent app's /{slug}/auth/callback on purpose: that route
 * rejects any session without an existing membership in the tenant, which is
 * precisely the state a first-time portal customer arrives in. Here the
 * membership is CREATED as part of the exchange, by completePortalEmailSignIn.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string }> },
) {
  const { searchParams, origin } = request.nextUrl;
  const { tenantSlug } = await params;

  const loginUrl = new URL(portalPath(tenantSlug, PORTAL_ROUTES.LOGIN), origin);

  // The code, never the message: the login page maps it back to safe copy, so a
  // crafted link cannot put arbitrary text in the sign-in card's alert.
  function failure(code: string) {
    loginUrl.searchParams.set("error", code);

    return NextResponse.redirect(loginUrl);
  }

  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");

  if (providerError) {
    console.error("[portal] callback returned an error:", providerError);

    return failure("expired_link");
  }

  // Two shapes reach here. `token_hash` when the email links straight at us
  // (works on any device); `code` when the link went via Supabase's verify
  // endpoint first (same browser only, because exchanging it needs the PKCE
  // verifier cookie). Both are read from the query and the hash-less fragment
  // Supabase uses, so neither template style needs a second route.
  const tokenHash = searchParams.get("token_hash");
  const code = searchParams.get("code");
  const type = searchParams.get("type");

  if (!tokenHash && !code) {
    return failure("incomplete");
  }

  try {
    const step = await completePortalEmailSignIn(tenantSlug, {
      tokenHash,
      code,
      type,
    });

    return NextResponse.redirect(new URL(stepPath(tenantSlug, step), origin));
  } catch (error) {
    // completePortalEmailSignIn takes its own session down when the link is
    // refused, so there is nothing to sign out here -- this only chooses what
    // the customer is told and where they land.
    console.error("[portal] callback failed:", error);

    return failure(error instanceof PortalError ? error.code : "unknown");
  }
}
