import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requestClientInfo } from "@/lib/request-context";

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitResult = { allowed: boolean; retryAfterMs: number };

// Fallback only: used while the rate_limit_hit migration is missing or the
// database can't be reached. Each server instance has its own copy.
const buckets = new Map<string, Bucket>();

const MAX_TRACKED_KEYS = 10_000;

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }

  if (buckets.size <= MAX_TRACKED_KEYS) {
    return;
  }

  const excess = buckets.size - MAX_TRACKED_KEYS;
  let dropped = 0;

  for (const key of buckets.keys()) {
    buckets.delete(key);
    if (++dropped >= excess) break;
  }
}

/** The caller's address, as the audit log records it. */
export async function clientKey(): Promise<string> {
  const { ip } = await requestClientInfo();

  return ip ?? "unknown";
}

function memoryHit(key: string, cost: number, windowMs: number) {
  const now = Date.now();

  sweep(now);

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    const fresh = { count: cost, resetAt: now + windowMs };
    buckets.set(key, fresh);

    return fresh;
  }

  bucket.count += cost;

  return bucket;
}

async function sharedHit(
  key: string,
  cost: number,
  windowMs: number,
): Promise<Bucket | null> {
  try {
    const { data, error } = await createSupabaseAdminClient()
      .rpc("rate_limit_hit", {
        p_key: key,
        p_cost: cost,
        p_window_ms: windowMs,
      })
      .single<{ hits: number; reset_at: string }>();

    if (error || !data) {
      // PGRST202: the migration isn't applied yet. Anything else is logged,
      // but a limiter outage shouldn't lock everyone out of signing in.
      if (error?.code !== "PGRST202") {
        console.error("[rate-limit] shared counter failed:", error?.message);
      }

      return null;
    }

    return { count: data.hits, resetAt: new Date(data.reset_at).getTime() };
  } catch (error) {
    console.error("[rate-limit] shared counter failed:", error);

    return null;
  }
}

/**
 * Counts `cost` hits (default one) against `key` and says whether the caller
 * is still within `limit` for the current window. Counts live in the
 * database so every server instance shares them.
 */
export async function rateLimit(
  key: string,
  {
    limit,
    windowMs,
    cost = 1,
  }: { limit: number; windowMs: number; cost?: number },
): Promise<RateLimitResult> {
  const spend = Math.max(1, cost);
  const bucket =
    (await sharedHit(key, spend, windowMs)) ?? memoryHit(key, spend, windowMs);

  if (bucket.count > limit) {
    return {
      allowed: false,
      retryAfterMs: Math.max(0, bucket.resetAt - Date.now()),
    };
  }

  return { allowed: true, retryAfterMs: 0 };
}
