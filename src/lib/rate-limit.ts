// Best-effort in-process rate limiter. Serverless deployments (Vercel) can
// spin up multiple isolated instances under concurrent load, so this does
// not give a hard global guarantee — but it stops the common abuse case (a
// script hammering one endpoint from one IP against a warm instance) without
// needing an external store. For a harder guarantee, back this with
// Upstash/Vercel KV instead of the in-memory Map.

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Bound memory even if many distinct keys show up.
const MAX_TRACKED_KEYS = 5_000;

/**
 * Returns true if `key` has exceeded `limit` requests within the trailing
 * `windowMs`. Call once per incoming request, before doing paid/expensive
 * work.
 */
export function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
    buckets.set(key, { count: 1, windowStart: now });
    return false;
  }

  bucket.count += 1;
  return bucket.count > limit;
}

/** Best-effort caller IP from standard proxy headers (Vercel sets these). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
