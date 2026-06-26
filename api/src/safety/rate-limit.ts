// rescue-6 (agent-readiness M4.2): a best-effort fixed-window per-key rate
// limiter backed by Workers KV. COARSE BY DESIGN — KV is eventually consistent
// and rate-limits writes (~1/sec/key), so this throttles obvious abuse rather
// than enforcing a hard ceiling; pair it with a Cloudflare WAF rate-limit rule
// for hard enforcement. FAIL-OPEN: any KV error allows the request (a cache
// hiccup must never break an unauthenticated endpoint like a privacy opt-out).
//
// Window keying: the window index (floor(now / windowMs)) is appended to the
// base key so each window is a fresh KV entry that auto-expires via its TTL —
// no read-modify-delete reset needed. KV expirationTtl has a 60s floor, so
// windowSeconds MUST be >= 60.

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  // Injectable clock for deterministic tests; defaults to Date.now().
  now?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
}

export async function checkRateLimit(
  kv: KVNamespace,
  baseKey: string,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const limit = opts.limit;
  const windowMs = opts.windowSeconds * 1000;
  const now = opts.now ?? Date.now();
  const windowIndex = Math.floor(now / windowMs);
  const key = `${baseKey}:${windowIndex}`;
  const windowEndMs = (windowIndex + 1) * windowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowEndMs - now) / 1000));
  try {
    const raw = await kv.get(key);
    const count = raw === null ? 0 : Number.parseInt(raw, 10) || 0;
    if (count >= limit) {
      return { allowed: false, retryAfterSeconds, remaining: 0 };
    }
    await kv.put(key, String(count + 1), { expirationTtl: opts.windowSeconds });
    return {
      allowed: true,
      retryAfterSeconds,
      remaining: Math.max(0, limit - (count + 1)),
    };
  } catch {
    // FAIL-OPEN: never let a KV problem break the request.
    return { allowed: true, retryAfterSeconds: 0, remaining: limit };
  }
}
