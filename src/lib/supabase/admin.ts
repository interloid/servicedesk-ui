import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/config/env";

/**
 * Service-role Supabase client. BYPASSES ROW LEVEL SECURITY ENTIRELY.
 *
 * Everything in supabase/schemas/policies/ is inert for this client: it is not the
 * `authenticated` role, `auth.uid()` is null, and no policy is consulted. Treat every query
 * written against it as if the tenant boundary does not exist, because it doesn't.
 *
 * ONLY use it where RLS makes the operation impossible by construction. Today that is
 * exactly one place: provisioning a brand-new organization. The INSERT policies on
 * `tenants`, `subscriptions`, `business_hours`, `sla_policies` and
 * `sla_policy_targets` all require a
 * `tenant_role` claim, and the hook that stamps that claim reads `memberships` — which
 * doesn't have a row yet at signup. Nothing can satisfy them on the first write, so the
 * chicken-and-egg is broken here instead.
 *
 * For everything else use `@/lib/supabase/server`, which runs as the caller with RLS on.
 *
 * SERVER ONLY. `SUPABASE_SERVICE_ROLE_KEY` has no NEXT_PUBLIC_ prefix precisely so Next
 * cannot inline it into a client bundle. Never import this from a "use client" module.
 */

let cached: SupabaseClient | null = null;

export function createSupabaseAdminClient(): SupabaseClient {
  // The service-role key is a full-database credential, so a missing one must fail loudly
  // rather than silently degrade to an anon client that would then trip over RLS.
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase admin client is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY in .env.local (see .env.example).",
    );
  }

  // Safe to reuse: this client is stateless. It never holds a user session, so there is no
  // per-request state to leak between callers — which is the usual reason not to cache one.
  if (cached) {
    return cached;
  }

  cached = createClient(url, key, {
    auth: {
      // No session to persist and nothing to refresh — this client authenticates with the
      // key on every request. Leaving these on would have it write a phantom session.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return cached;
}
