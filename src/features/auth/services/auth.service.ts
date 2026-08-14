import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/config/env";
import type { LoginValues } from "@/features/auth/schemas/login";
import type {
  AuthFailureCode,
  MembershipRole,
  SessionUser,
} from "@/features/auth/types";
import { getTenantContext } from "@/features/tenancy/services/tenant-resolver";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Auth service — the only place that talks to the Supabase auth/data SDK.
 *
 * No REST layer, no Express controller: callers are Server Actions (`../actions.ts`), and
 * this module runs server-side only. It never imports React and never returns a Response;
 * it returns domain values or throws `AuthError`, and the action shapes the envelope.
 *
 * Every call uses the anon key plus the caller's own access token, so RLS is in force. See
 * `@/lib/supabase/server` for why there is no service-role client.
 */

/** A failure the user is allowed to see — bad credentials, unconfirmed email, rate limit. */
export class AuthError extends Error {
  readonly status: number;
  readonly code: AuthFailureCode;

  constructor(
    message: string,
    { status = 400, code = "unknown" as AuthFailureCode } = {},
  ) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Narrow Supabase's `error.code` to our own set. Anything unrecognised becomes `unknown`
 * rather than leaking through, so a new vendor code can't reach the UI unhandled.
 */
function toFailureCode(code: string | undefined): AuthFailureCode {
  switch (code) {
    case "invalid_credentials":
      return "invalid_credentials";
    case "email_not_confirmed":
      return "email_not_confirmed";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "rate_limited";
    default:
      return "unknown";
  }
}

type ActiveMembership = { tenant_id: string; role: MembershipRole };

/**
 * Sign in with a password, resolve the caller's active membership, and append a `login`
 * row to the audit trail.
 *
 * Sets the session cookies as a side effect: `createServerClient` writes them through the
 * `cookies()` store, which is why this must be called from a Server Action or Route
 * Handler and not during a Server Component render.
 */
export async function login({
  email,
  password,
}: LoginValues): Promise<SessionUser> {
  const supabase = await createSupabaseServerClient();

  /*
   * Supabase creates the authenticated session.
   *
   * @supabase/ssr writes the session into cookies through
   * the server client cookie adapter.
   */
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  /*
   * `AuthError`, not a bare `Error`. `loginAction` branches on `instanceof AuthError` to
   * decide whether the user may see the message; a plain Error falls through to its
   * catch-all and every bad password reads "We couldn't sign you in right now" instead of
   * "invalid credentials" — which is also what makes `toFailureCode` worth having.
   */
  if (error || !data.user) {
    throw new AuthError(error?.message ?? "Invalid login credentials", {
      status: error?.status ?? 400,
      code: toFailureCode(error?.code),
    });
  }

  /*
   * Check the newly issued JWT claims.
   *
   * Your custom_access_token_hook should add:
   *
   * tenant_id
   * tenant_role
   */
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();

  if (claimsError) {
    console.error("JWT claims error:", claimsError);

    throw new Error("Unable to verify authentication session");
  }

  const tenantId =
    (claimsData?.claims?.tenant_id as string | undefined) ?? null;

  // The subdomain is the security boundary: a sign-in that ends up claiming a
  // DIFFERENT tenant than the one the visitor is stood on is a revoked session,
  // not a soft warning. See `verifyHostTenancy`.
  await verifyHostTenancy(supabase, tenantId);

  /*
   * Return only application-safe information.
   *
   * Do NOT return:
   * - access_token
   * - refresh_token
   */

  return {
    id: data.user.id,
    email: data.user.email ?? email,

    /*
     * These are application response fields.
     *
     * They are NOT the JWT claims.
     */
    tenantId,

    role:
      (claimsData?.claims?.tenant_role as MembershipRole | undefined) ?? null,
  };
}

/**
 * Begin Google sign-in.
 *
 * Server-side `signInWithOAuth` does NOT sign anyone in and does NOT redirect — there is no
 * browser here to send anywhere. It builds the provider's consent URL, and (because
 * `@supabase/ssr` runs the PKCE flow) writes the code verifier into a cookie through the
 * same adapter `login` uses. So this must be called from a Server Action or Route Handler:
 * during a Server Component render the cookie write is swallowed and the callback's
 * exchange then fails with "code verifier missing".
 *
 * The caller is responsible for actually navigating the browser to the returned URL.
 *
 * `next` is where the user lands once the callback has traded the code for a session. It is
 * carried on the callback URL rather than held server-side because the round trip through
 * Google is stateless from our side.
 */
export async function googleLogin({
  next = "/tickets",
}: { next?: string } = {}) {
  const supabase = await createSupabaseServerClient();
  const origin = await requestOrigin(); // e.g., "http://demo-rag.localhost:3000"

  // 1. Extract hostname to check for subdomains
  const urlObj = new URL(origin);
  const hostname = urlObj.host; // e.g., "demo-rag.localhost:3000"
  const baseDomain = process.env.NEXT_PUBLIC_APP_DOMAIN || "localhost:3000";

  const isSubdomain = hostname.endsWith(`.${baseDomain}`);
  const tenantSlug = isSubdomain
    ? hostname.replace(`.${baseDomain}`, "")
    : null;

  // 2. Resolve target path
  let targetNext = safeNext(next);
  if (tenantSlug && !targetNext.startsWith(`/tenant/`)) {
    const cleanPath = targetNext.startsWith("/")
      ? targetNext
      : `/${targetNext}`;
    targetNext = `/tenant/${tenantSlug}${cleanPath}`;
  }

  // 3. Construct OAuth callback URL on the SAME origin
  const callback = new URL("/auth/callback", origin);
  callback.searchParams.set("next", targetNext);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callback.toString(),
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error || !data.url) {
    throw new AuthError("We couldn't reach Google. Try again in a moment.", {
      status: error?.status ?? 502,
      code: toFailureCode(error?.code),
    });
  }

  return { url: data.url };
}

/**
 * Finish Google sign-in: trade the `?code=` the provider sent back for a session.
 *
 * Cookie side effect again — this is what actually signs the user in — so it belongs in the
 * callback Route Handler and nowhere else.
 */
export async function exchangeOAuthCode(code: string): Promise<SessionUser> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    throw new AuthError("That sign-in link has expired. Try again.", {
      status: error?.status ?? 400,
      code: toFailureCode(error?.code),
    });
  }

  const { data: claimsData } = await supabase.auth.getClaims();

  const tenantId =
    (claimsData?.claims?.tenant_id as string | undefined) ?? null;

  await verifyHostTenancy(supabase, tenantId);

  return {
    id: data.user.id,
    email: data.user.email ?? "",
    tenantId,
    role:
      (claimsData?.claims?.tenant_role as MembershipRole | undefined) ?? null,
  };
}

/**
 * Reduce an untrusted `next` to a path on this origin.
 *
 * Anything absolute, protocol-relative (`//evil.example`) or non-`/`-prefixed is discarded
 * rather than sanitised — an open redirect off the login flow is a phishing primitive, and
 * there is no legitimate case for sending a freshly authenticated user off-site.
 */
export function safeNext(
  next: string | null | undefined,
  fallback = "/tickets",
): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return fallback;
  }

  return next;
}

/**
 * The origin this request arrived on, derived from the Host header rather than the
 * baked-in `NEXT_PUBLIC_SITE_URL`.
 *
 * `NEXT_PUBLIC_SITE_URL` describes the product host (the bare base domain), but a
 * login flow started on `jan.servicedesk.pro` must come back to
 * `jan.servicedesk.pro` — the PKCE verifier lives in a host-scoped cookie and the
 * session must end up scoped to that subdomain. The scheme comes from the
 * `x-forwarded-proto` header when a proxy supplies one (always true in
 * production), falling back to https and http-for-local-dev.
 */
async function requestOrigin(): Promise<string> {
  const requestHeaders = await headers();

  const host = requestHeaders.get("host");
  const forwardedProto = requestHeaders.get("x-forwarded-proto");

  const scheme =
    forwardedProto?.split(",")[0]?.trim() ??
    (process.env.NODE_ENV === "production" ? "https" : "http");

  if (host) {
    return `${scheme}://${host}`;
  }

  return new URL(env.NEXT_PUBLIC_SITE_URL).origin;
}

/**
 * The subdomain is the tenant boundary, so a freshly issued session must claim the
 * tenant the visitor is stood on.
 *
 * The access-token hook stamps `tenant_id` from the caller's first active
 * membership; when that tenant is not the one this subdomain names, the session is
 * REVOKED on the spot and the sign-in fails with a clear message. Failing open
 * here (letting the session stand) would let one tenant's session be created on
 * another tenant's portal. Host-only cookies make the cross-tenant case rare, but
 * a shared cookie or a stale session is exactly what this check is for.
 *
 * On the bare base host there is no subdomain to verify against — nothing to do.
 */
async function verifyHostTenancy(
  supabase: SupabaseClient,
  tenantId: string | null,
): Promise<void> {
  const context = await getTenantContext();

  if (!context) {
    return;
  }

  if (tenantId !== context.id) {
    // Revoke BEFORE surfacing the failure: an access token that claims the wrong
    // tenant must not outlive this request even as a cookie.
    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error(
        `[auth] failed to revoke cross-tenant session: ${error.message}`,
      );
    }

    throw new AuthError(
      `You don't have access to the ${context.name} workspace.`,
      {
        status: 403,
        code: "no_workspace_access",
      },
    );
  }
}

/**
 * Sign out: revoke the session server-side and clear its cookies.
 *
 * Same cookie side effect as `login`, in reverse — `signOut` writes the expired cookies
 * through the `cookies()` store, so this too must run from a Server Action or Route Handler
 * and not during a Server Component render, or the browser keeps the old ones.
 *
 * Default `scope: "global"`, which revokes every refresh token the user holds rather than
 * just this browser's. That is the right default for a support desk: "sign out" on a shared
 * or lost machine should end the other sessions too, and the cost is only that a second tab
 * has to sign in again.
 */
export async function logout(): Promise<void> {
  const supabase = await createSupabaseServerClient();

  // Before the token is revoked, not after: this is the last moment the caller is still
  // authenticated, and the audit insert runs under their own JWT.
  await recordLogoutAttempt(supabase);

  const { error } = await supabase.auth.signOut();

  if (error) {
    // supabase-js already treats 401/403/404 from the revoke endpoint as success and clears
    // the session anyway, so reaching here means the session may genuinely still be live.
    // Say so rather than redirect to /login and imply an ending that didn't happen.
    throw new AuthError("We couldn't sign you out. Try again in a moment.", {
      status: error.status ?? 500,
      code: toFailureCode(error.code),
    });
  }
}

/**
 * Append the `logout` row, best-effort, for whoever is currently signed in.
 *
 * `getUser()` rather than `getSession()`: it revalidates against the auth server instead of
 * trusting the cookie, so a forged or stale one can't attribute a row to somebody else. No
 * user, or no membership, means there is nothing to attribute — signing out still proceeds,
 * since clearing a session that shouldn't exist is exactly what should happen.
 */
async function recordLogoutAttempt(supabase: SupabaseClient) {
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return;
  }

  const membership = await findActiveMembership(supabase, data.user.id);

  if (!membership) {
    return;
  }

  await recordAuthEvent(supabase, {
    action: "logout",
    tenantId: membership.tenant_id,
    userId: data.user.id,
    email: data.user.email ?? "",
  });
}

/**
 * The caller's single active membership, or null.
 *
 * Runs as the user, so `memberships_select` applies: it matches rows where
 * `tenant_id = public.current_tenant_id()`, and that helper reads the `tenant_id` claim
 * stamped in by `public.custom_access_token_hook` on the token `signInWithPassword` just
 * issued. A user with no membership has a null claim, so they match nothing and get null
 * back — hence `.maybeSingle()`, which returns null for zero rows where `.single()` would
 * raise. That state is legitimate (signed up, no org yet), not a failure.
 */
async function findActiveMembership(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActiveMembership | null> {
  const { data, error } = await supabase
    .from("memberships")
    .select("tenant_id, role")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle<ActiveMembership>();

  // A failed probe must not fail an otherwise valid sign-in — the credentials were good.
  if (error) {
    warn(`membership lookup skipped: ${error.message}`);
    return null;
  }

  return data;
}

/**
 * Append a `login` or `logout` row to `public.audit_logs`, best-effort.
 *
 * Written directly with the user's own token rather than through a `functions.invoke`
 * edge function — one less hop, and it lets the row carry the request IP, which an edge
 * function would only see as this server's address.
 *
 * NOTE: `audit_logs` currently has only an `audit_logs_select` policy
 * (supabase/schemas/policies/19_audit_logs.sql), so with RLS on and no INSERT policy this
 * write is rejected and logged as a warning in dev. Sign-in and sign-out still succeed.
 * Adding an INSERT policy — `tenant_id = public.current_tenant_id() AND actor_id =
 * auth.uid()` — is what turns the audit trail on.
 */
async function recordAuthEvent(
  supabase: SupabaseClient,
  {
    action,
    tenantId,
    userId,
    email,
  }: {
    action: "login" | "logout";
    tenantId: string;
    userId: string;
    email: string;
  },
) {
  const { error } = await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    actor_id: userId,
    // Both are values of `public.audit_action` (supabase/schemas/types/00_types.sql).
    action,
    entity: "user",
    entity_id: userId,
    meta_json: { email },
    ip: await clientIp(),
  });

  if (error) {
    warn(`${action} audit not written: ${error.message}`);
  }
}

/**
 * Best guess at the caller's address for the `inet` column. `x-forwarded-for` is a list
 * appended to by each hop, so the first entry is the client; null when there's no proxy
 * (local dev), which the column accepts.
 */
async function clientIp(): Promise<string | null> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || null;
  }

  return requestHeaders.get("x-real-ip");
}

/** Dev-only breadcrumb for the swallowed, non-fatal failures above. */
function warn(message: string) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[auth] ${message}`);
  }
}
