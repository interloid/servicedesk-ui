export const MEMBERSHIP_ROLES = [
  "platform_admin",
  "tenant_admin",
  "manager",
  "agent",
  "billing_admin",
  "customer",
] as const;

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export function isMembershipRole(value: unknown): value is MembershipRole {
  return (
    typeof value === "string" &&
    (MEMBERSHIP_ROLES as readonly string[]).includes(value)
  );
}
