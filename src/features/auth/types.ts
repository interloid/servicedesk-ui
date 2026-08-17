/**
 * Shared auth types. Hand-written rather than generated: `supabase gen types` isn't wired
 * up yet, and these three shapes are all the login path needs. Swap for generated types
 * when that lands.
 */

/** Mirrors `public.membership_role` in supabase/schemas/types/00_types.sql. */
export type MembershipRole =
  | "platform_admin"
  | "tenant_admin"
  | "manager"
  | "agent"
  | "billing_admin"
  | "customer";

/**
 * A signed-in caller, flattened from `auth.users` plus their one active membership.
 *
 * `tenantId`/`role` are nullable because a Supabase account can exist before it belongs to
 * anything — that's the state between /signup and /create-org. A null `tenantId` means
 * "authenticated but not yet provisioned", not "error".
 */
export type SessionUser = {
  id: string;
  email: string;
  tenantId: string | null;
  role: MembershipRole | null;
};

/**
 * A successful sign-in: the session plus where to send the browser next.
 *
 * `redirectTo` is resolved server-side (`resolvePostAuthUrl`) because only the
 * server knows which workspace the new session claims. It is either a path on the
 * current origin — the clean `/tickets` a tenant subdomain shows — or an absolute
 * URL on that workspace's subdomain. The caller checks which before navigating.
 */
export type LoginSuccess = SessionUser & { redirectTo: string };

/** What a completed registration provisioned, for the confirmation the wizard shows. */
export type RegisteredOrg = {
  user: { id: string; email: string; fullName: string };
  tenant: { id: string; name: string; slug: string };
  businessHoursId: string;
  plan: string;
  /** How many invites were accepted and validated but not sent — see registerSchema. */
  invitesSkipped: number;
  /**
   * True when `signUp` returned no session because the project requires email confirmation.
   * The organization is fully provisioned either way; this only decides where the user goes
   * next — the app (already signed in) or a "confirm your email" prompt.
   */
  requiresEmailConfirmation: boolean;
};

/**
 * Why an auth action failed, in terms the UI can branch on.
 *
 * A closed set rather than the raw Supabase string, so a form picks its copy by matching a
 * code we own instead of pattern-matching vendor messages that change between releases.
 */
export type AuthFailureCode =
  | "validation"
  | "invalid_credentials"
  | "email_not_confirmed"
  | "rate_limited"
  | "no_workspace_access"
  | "unknown";

/**
 * What every auth action resolves to.
 *
 * Deliberately a returned value, not a thrown error: a Server Action that throws surfaces
 * as an opaque digest in production, which would lose the message the form needs to show.
 * `fieldErrors` is keyed by form field so the caller can hand it straight to
 * react-hook-form's `setError`.
 */
export type ActionResult<TData> =
  | { success: true; data: TData }
  | {
      success: false;
      message: string;
      code: AuthFailureCode;
      fieldErrors?: Record<string, string[]>;
    };
