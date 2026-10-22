/**
 * What a refused staff sign-in tells the person, keyed by an opaque code the
 * auth callback puts in `/login?error=`.
 *
 * The login URL is public and its query string is attacker-controlled, so the
 * page never renders `?error=` as text: it looks the code up here and drops
 * anything it does not recognise. Same rule as PORTAL_LOGIN_ERRORS.
 */
export const LOGIN_ERRORS = {
  provider_error: "Google sign-in didn't finish. Try again.",
  incomplete: "That sign-in link is incomplete. Start again.",
  expired: "That sign-in link has expired. Try again.",
  no_workspace:
    "That Google account isn't a member of any workspace yet. Ask your admin for an invite.",
  not_member:
    "You are not registered as a member of this workspace. Contact your admin.",
  no_workspace_access: "You don't have access to this workspace.",
  unknown: "Authentication failed. Try again.",
} as const;

export type LoginErrorCode = keyof typeof LOGIN_ERRORS;

export function loginErrorMessage(
  code: string | undefined,
): string | undefined {
  // Own keys only: `?error=constructor` must not resolve to Object's function.
  return code && Object.hasOwn(LOGIN_ERRORS, code)
    ? LOGIN_ERRORS[code as LoginErrorCode]
    : undefined;
}
