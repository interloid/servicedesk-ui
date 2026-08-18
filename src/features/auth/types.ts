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
  tenantSlug: string | null;
  role: MembershipRole | null;
};

export type LoginSuccess = SessionUser & { redirectTo: string };

export type RegisteredOrg = {
  user: { id: string; email: string; fullName: string };
  tenant: { id: string; name: string; slug: string };
  businessHoursId: string;
  plan: string;
  invitesSkipped: number;
  requiresEmailConfirmation: boolean;
};

export type AuthFailureCode =
  | "validation"
  | "invalid_credentials"
  | "email_not_confirmed"
  | "rate_limited"
  | "no_workspace_access"
  | "unknown";

export type ActionResult<TData> =
  | { success: true; data: TData }
  | {
      success: false;
      message: string;
      code: AuthFailureCode;
      fieldErrors?: Record<string, string[]>;
    };
