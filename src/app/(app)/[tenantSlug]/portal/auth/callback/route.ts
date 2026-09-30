import { NextResponse, type NextRequest } from "next/server";

import { PORTAL_ROUTES, portalPath } from "@/features/portal/portal";
import {
  completePortalEmailSignIn,
  PortalError,
  portalSignOut,
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

  function failure(message: string) {
    loginUrl.searchParams.set("error", message);

    return NextResponse.redirect(loginUrl);
  }

  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");

  if (providerError) {
    console.error("[portal] callback returned an error:", providerError);

    return failure("That sign-in link is no longer valid. Request a new one.");
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
    return failure("That sign-in link is incomplete. Start again.");
  }

  console.info(
    `[portal] callback HIT for "${tenantSlug}"\n` +
      `  token_hash: ${tokenHash ? "present" : "absent"}\n` +
      `  code: ${code ? "present" : "absent"}\n` +
      `  verifier cookies in jar: ${
        request.cookies
          .getAll()
          .filter((cookie) => cookie.name.includes("code-verifier"))
          .map((cookie) => cookie.name)
          .join(", ") || "NONE"
      }`,
  );

  try {
    const step = await completePortalEmailSignIn(tenantSlug, {
      tokenHash,
      code,
      type,
    });

    return NextResponse.redirect(new URL(stepPath(tenantSlug, step), origin));
  } catch (error) {
    if (error instanceof PortalError && error.code === "no_portal_access") {
      // The session is real but must not be left standing: it belongs to
      // somebody who cannot use this portal.
      await portalSignOut("local");

      return failure(error.message);
    }

    console.error("[portal] callback failed:", error);

    return failure(
      error instanceof PortalError
        ? error.message
        : "We couldn't complete that sign-in. Try again.",
    );
  }
}
