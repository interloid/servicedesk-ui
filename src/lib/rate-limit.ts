import "server-only";

import { headers } from "next/headers";

type Bucket = {
  count: number;
  resetAt: number;
};

/**
 * Fixed-window, in-memory rate limiter for unauthenticated Server Actions.
 *
 * Scope and limits, stated plainly:
 * - The map is bounded by MAX_TRACKED_KEYS and every expired entry is evicted on
 *   read, so it cannot grow without limit.
 * - State is per server instance. On serverless this is best-effort: it stops
 *   bulk scraping from one warm instance, not a distributed attacker. Move to a
 *   shared store (Upstash, Redis) if that threat matters.
 */
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

  // Still oversized after sweeping: drop the oldest entries (Map keeps insertion order).
  const excess = buckets.size - MAX_TRACKED_KEYS;
  let dropped = 0;

  for (const key of buckets.keys()) {
    buckets.delete(key);
    if (++dropped >= excess) break;
  }
}

export async function clientKey(): Promise<string> {
  const requestHeaders = await headers();

  const forwarded = requestHeaders.get("x-forwarded-for");

  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }

  return requestHeaders.get("x-real-ip") ?? "unknown";
}

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();

  sweep(now);

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });

    return { allowed: true, retryAfterMs: 0 };
  }

  bucket.count += 1;

  if (bucket.count > limit) {
    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }

  return { allowed: true, retryAfterMs: 0 };
}
