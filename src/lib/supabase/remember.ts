/**
 * "Remember me" for the Supabase auth cookies.
 *
 * @supabase/ssr always asks for a 400-day cookie when it writes a session and
 * `maxAge: 0` when it deletes one. Neither suits us: a remembered sign-in lasts
 * REMEMBER_ME_MAX_AGE, an unremembered one must be a session cookie that dies
 * with the browser, and a deletion must always stay a deletion.
 *
 * The choice is made once, at sign-in, so it is kept in REMEMBER_COOKIE for
 * every later write -- the proxy's token refresh included. Only "0" is ever
 * stored, and as a session cookie itself; no marker means "remembered", which
 * is also what sessions from before the marker existed get.
 *
 * Kept free of "server-only" and next/headers so the proxy can import it.
 */

export const REMEMBER_COOKIE = "sd-remember";

export const REMEMBER_ME_MAX_AGE = 60 * 60 * 24 * 30;

type CookieLifetime = { maxAge?: number; expires?: Date };

export function isRememberedSession(marker: string | undefined): boolean {
  return marker !== "0";
}

export function isCookieDeletion(options: CookieLifetime | undefined): boolean {
  return options?.maxAge === 0;
}

/** The maxAge/expires pair an auth cookie should be written with. */
export function authCookieLifetime(
  options: CookieLifetime | undefined,
  remember: boolean,
): CookieLifetime {
  if (isCookieDeletion(options)) {
    return { maxAge: 0, expires: new Date(0) };
  }

  if (remember) {
    return {
      maxAge: REMEMBER_ME_MAX_AGE,
      expires: new Date(Date.now() + REMEMBER_ME_MAX_AGE * 1000),
    };
  }

  return { maxAge: undefined, expires: undefined };
}
