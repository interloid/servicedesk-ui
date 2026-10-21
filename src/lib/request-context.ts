import "server-only";

import { headers } from "next/headers";

export type RequestClientInfo = {
  ip: string | null;
  userAgent: string | null;
};

/**
 * The browser's address and user agent for the request being handled, as the
 * audit log records them.
 *
 * Null outside a request (a build-time render), where there is no browser.
 */
export async function requestClientInfo(): Promise<RequestClientInfo> {
  try {
    const requestHeaders = await headers();
    const forwarded = requestHeaders.get("x-forwarded-for");
    const ip =
      forwarded?.split(",")[0]?.trim() ||
      requestHeaders.get("x-real-ip")?.trim() ||
      null;
    const userAgent = requestHeaders.get("user-agent")?.slice(0, 512) || null;

    return { ip, userAgent };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/**
 * Headers the server-side Supabase client sends with every PostgREST call.
 *
 * The database's audit triggers read them (public.audit_request_header) so a
 * row written by a trigger carries the browser's address rather than this
 * server's. Only set headers that have a value: an empty one would be read as
 * a real, blank address.
 */
export async function auditForwardHeaders(): Promise<Record<string, string>> {
  const { ip, userAgent } = await requestClientInfo();
  const forwarded: Record<string, string> = {};

  if (ip) forwarded["x-audit-ip"] = ip;
  if (userAgent) forwarded["x-audit-user-agent"] = userAgent;

  return forwarded;
}
