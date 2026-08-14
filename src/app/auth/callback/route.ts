import { NextResponse, type NextRequest } from "next/server";

import { AuthError, exchangeOAuthCode, safeNext } from "@/features/auth/services/auth.service";

/**
 * OAuth return leg. `googleLogin` names this route as its `redirectTo`, so it is the URL
 * Google sends the browser back to with `?code=`.
 *
 * A Route Handler rather than a page: the exchange writes the session cookies, which needs a
 * request Next is willing to let us mutate cookies on, and the user should never see this
 * URL render — they arrive and leave in one hop.
 *
 * Deliberately GET-only. Google performs a top-level browser navigation back here; there is
 * no POST leg to support.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  /*
   * The provider rejected or the user cancelled — Google returns `?error=access_denied`
   * rather than a code. Send them back to the form with something it can show, not to an
   * error page: cancelling a consent screen is a decision, not a fault.
   */
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");

  if (providerError) {
    return NextResponse.redirect(loginWithError(origin, providerError));
  }

  if (!code) {
    return NextResponse.redirect(loginWithError(origin, "Google didn't return a sign-in code."));
  }

  try {
    await exchangeOAuthCode(code);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.redirect(loginWithError(origin, error.message));
    }

    console.error("[auth] OAuth callback failed", error);

    return NextResponse.redirect(
      loginWithError(origin, "We couldn't complete Google sign-in. Try again."),
    );
  }

  /*
   * `next` has already been through `safeNext`, so it is a path on this origin and cannot
   * be turned into an off-site redirect by whatever came back on the query string.
   */
  return NextResponse.redirect(new URL(next, origin));
}

/** Back to the form, carrying a message it can render in its error banner. */
function loginWithError(origin: string, message: string): URL {
  const url = new URL("/login", origin);
  url.searchParams.set("error", message);

  return url;
}
