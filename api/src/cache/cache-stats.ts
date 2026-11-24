// Cache hit/miss monitoring for kodigital-homepages-cms (T44 [BCL-020]).
//
// Gateway and live feed/HTML reads sample one in ten outcomes when a request
// context is available. Each sample adds ten to its KV counter in the background.
// The admin monitor reports these estimated totals and hit rate.
//
// Recording is BEST-EFFORT: a counter read/write failure NEVER breaks a
// cache read (wrapped in try/catch). The counter keys are read via the raw
// env.CACHE.get (NOT cacheGet) so reading/updating stats can never recurse
// into the recorder or count itself. Everything here touches ONLY env.CACHE
// (KV) — no outbound HTTP — so the dry-run zero-outbound contract holds.

import type { Env } from "../env";
import type { WaitUntilContext } from "../wait-until-context";

// Distinct from the "feed:" prefix so invalidateFeeds() never wipes the
// monitoring counters.
const HITS_KEY = "cachestat:hits";
const MISSES_KEY = "cachestat:misses";
const SAMPLE_WEIGHT = 10;

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
    const next = (await readCounter(env, key)) + SAMPLE_WEIGHT;
    await env.CACHE.put(key, String(next));
  } catch {
    // Monitoring is best-effort — a stats write failure must never break the
    // cache read that triggered it.
  }
}

function scheduleBump(env: Env, key: string, waitUntil?: WaitUntilContext): void {
  if (typeof waitUntil?.waitUntil !== "function" || Math.random() >= 1 / SAMPLE_WEIGHT) return;
  try {
    waitUntil.waitUntil(bump(env, key));
  } catch {
    // A context that can no longer accept work must still serve the cached response.
  }
}

export function recordCacheHit(env: Env, waitUntil?: WaitUntilContext): void {
  scheduleBump(env, HITS_KEY, waitUntil);
}

export function recordCacheMiss(env: Env, waitUntil?: WaitUntilContext): void {
  scheduleBump(env, MISSES_KEY, waitUntil);
}

export function recordEdgeCacheStatus(env: Env, status: string | null, waitUntil?: WaitUntilContext): void {
  const outcome = status?.toUpperCase();
  if (outcome === "HIT") recordCacheHit(env, waitUntil);
  else if (outcome === "MISS") recordCacheMiss(env, waitUntil);
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
