import "server-only";

import { headers } from "next/headers";

export type RequestClientInfo = {
  ip: string | null;
  userAgent: string | null;
};

/**
 * The browser's address and user agent for the request being handled, as the
 * audit log records them. The one place the client IP is read: the rate
 * limiter keys on the same address.
 *
 * Null outside a request (a build-time render), where there is no browser.
 */
export async function requestClientInfo(): Promise<RequestClientInfo> {
  try {
    const requestHeaders = await headers();
    const ip =
      requestHeaders.get("x-real-ip")?.trim() ||
      // The last hop is the one our own proxy appended; anything before it
      // is whatever the caller chose to send.
      requestHeaders.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
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
