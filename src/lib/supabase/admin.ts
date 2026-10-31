import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/config/env";
import { serverEnv } from "@/config/server-env";
import { auditForwardHeaders } from "@/lib/request-context";

let cached: SupabaseClient | null = null;

function adminConfig() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = serverEnv.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase admin client is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY in .env.local (see .env.example).",
    );
  }

  return { url, key };
}

const AUTH_OPTIONS = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
};

export function createSupabaseAdminClient(): SupabaseClient {
  const { url, key } = adminConfig();

  if (cached) {
    return cached;
  }

  cached = createClient(url, key, { auth: AUTH_OPTIONS });

  return cached;
}

/**
 * The admin client for a write a signed-in person is making, when it has to
 * bypass RLS (a Manager changing a role, a Tenant Admin inviting a customer).
 *
 * Without a session the database can't tell who did it and the audit log says
 * "System". This names them in x-audit-actor -- trusted on service-role
 * requests only, see public.audit_trusted_actor -- and forwards the browser's
 * address like the server client does. Not cached: the headers are this
 * request's.
 */
export async function createAuditedAdminClient(
  actorId: string,
): Promise<SupabaseClient> {
  const { url, key } = adminConfig();

  return createClient(url, key, {
    auth: AUTH_OPTIONS,
    global: {
      headers: { ...(await auditForwardHeaders()), "x-audit-actor": actorId },
    },
  });
}
