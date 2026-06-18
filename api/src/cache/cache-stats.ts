// Cache hit/miss monitoring for kodigital-homepages-cms (T44 [BCL-020]).
//
// The brief requires cache monitoring that was previously absent. Every
// cache READ path (cacheGet for feeds, edge-cache getCachedHtml for public
// HTML) records exactly one hit OR one miss into two durable KV counters
// under the "cachestat:" prefix (env.CACHE). readCacheStats() reports the
// live totals plus a derived hit_rate; resetCacheStats() zeroes them so an
// operator can clear the window from the admin stats view.
//
// Recording is BEST-EFFORT: a counter read/write failure NEVER breaks a
// cache read (wrapped in try/catch). The counter keys are read via the raw
// env.CACHE.get (NOT cacheGet) so reading/updating stats can never recurse
// into the recorder or count itself. Everything here touches ONLY env.CACHE
// (KV) — no outbound HTTP — so the dry-run zero-outbound contract holds.

import type { Env } from "../env";

// Distinct from the "feed:" prefix so invalidateFeeds() never wipes the
// monitoring counters.
const HITS_KEY = "cachestat:hits";
const MISSES_KEY = "cachestat:misses";

export interface CacheStats {
  hits: number;
  misses: number;
  total: number;
  // Fraction in [0, 1], rounded to 4 decimal places. 0 when total === 0.
  hit_rate: number;
}

async function readCounter(env: Env, key: string): Promise<number> {
  const raw = await env.CACHE.get(key);
  if (raw === null) return 0;
  const n = Number.parseInt(raw, 10);
  // Treat a corrupt / negative counter value as 0 rather than propagating
  // NaN into the hit-rate arithmetic.
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function bump(env: Env, key: string): Promise<void> {
  try {
    const next = (await readCounter(env, key)) + 1;
    await env.CACHE.put(key, String(next));
  } catch {
    // Monitoring is best-effort — a stats write failure must never break the
    // cache read that triggered it.
  }
}

export async function recordCacheHit(env: Env): Promise<void> {
  await bump(env, HITS_KEY);
}

export async function recordCacheMiss(env: Env): Promise<void> {
  await bump(env, MISSES_KEY);
}

// Derives the hit-rate as hits / (hits + misses), rounded to 4 dp. Returns 0
// (not NaN) when there has been no activity yet.
export function computeHitRate(hits: number, misses: number): number {
  const total = hits + misses;
  if (total === 0) return 0;
  return Math.round((hits / total) * 10000) / 10000;
}

export async function readCacheStats(env: Env): Promise<CacheStats> {
  const hits = await readCounter(env, HITS_KEY);
  const misses = await readCounter(env, MISSES_KEY);
  return {
    hits,
    misses,
    total: hits + misses,
    hit_rate: computeHitRate(hits, misses),
  };
}

export async function resetCacheStats(env: Env): Promise<void> {
  await env.CACHE.delete(HITS_KEY);
  await env.CACHE.delete(MISSES_KEY);
}
