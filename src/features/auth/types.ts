export type MembershipRole =
  | "platform_admin"
  | "tenant_admin"
  | "manager"
  | "agent"
  | "billing_admin"
  | "customer";

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

export type ActiveMembership = {
  tenant_id: string;
  role: string;
};
