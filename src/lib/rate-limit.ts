import "server-only";

import { headers } from "next/headers";

type Bucket = {
  count: number;
  resetAt: number;
};

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
