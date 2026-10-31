// Headers that make a service-role write attributable in the audit log.
//
// A function that acts for a signed-in person (a Tenant Admin or Billing Admin
// changing the plan) writes with the service key, so the database has no user
// to record and the event reads "System". x-audit-actor names them; the
// database trusts it on service-role requests only (public.audit_trusted_actor)
// and also stamps subscriptions.billing_actor_id from it, which is how a later
// webhook write -- the plan applied, a renewal charged -- is attributed too.
//
// The browser's address and user agent come along when the app's server sent
// them (its Supabase client forwards x-audit-ip / x-audit-user-agent on every
// call, functions.invoke included), so the row doesn't carry this function's.
export function auditHeaders(
  req: Request,
  actorId: string,
): Record<string, string> {
  const headers: Record<string, string> = { "x-audit-actor": actorId };

  for (const name of ["x-audit-ip", "x-audit-user-agent"]) {
    const value = req.headers.get(name)?.trim();
    if (value) headers[name] = value.slice(0, 512);
  }

  return headers;
}
