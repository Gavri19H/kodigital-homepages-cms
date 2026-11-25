// Cache hit/miss monitoring for kodigital-homepages-cms (T44 [BCL-020]).
//
// Gateway and live feed/HTML reads sample one in ten outcomes when a request
// context is available. Each sample adds ten to its global KV counter in the
// background. A gateway sample also increments the site's hourly D1 counter
// atomically for speed reports.
//
// Recording is BEST-EFFORT: a counter read/write failure NEVER breaks a
// cache read (wrapped in try/catch). The counter keys are read via the raw
// env.CACHE.get (NOT cacheGet) so reading/updating stats can never recurse
// into the recorder or count itself. Both counters use Worker bindings.

import type { Env } from "../env";
import type { WaitUntilContext } from "../wait-until-context";

// Distinct from the "feed:" prefix so invalidateFeeds() never wipes the
// monitoring counters.
const HITS_KEY = "cachestat:hits";
const MISSES_KEY = "cachestat:misses";
export const EDGE_SAMPLE_WEIGHT = 10;
type EdgeCacheOutcome = "HIT" | "MISS";

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
    const value = String((await readCounter(env, key)) + EDGE_SAMPLE_WEIGHT);
    await env.CACHE.put(key, value);
  } catch {
    // Monitoring is best-effort — a stats write failure must never break the
    // cache read that triggered it.
  }
}

async function bumpSite(env: Env, siteId: string, outcome: EdgeCacheOutcome): Promise<void> {
  try {
    const hour = Math.floor(Date.now() / 3_600_000) * 3600;
    await env.DB.prepare(`INSERT INTO edge_hit_counts (site_id, hour, outcome, n) VALUES (?, ?, ?, ?)
      ON CONFLICT (site_id, hour, outcome) DO UPDATE SET n = n + excluded.n`)
      .bind(siteId, hour, outcome, EDGE_SAMPLE_WEIGHT).run();
  } catch {
    console.error("[cache-stats] Site edge count write failed", siteId, outcome);
  }
}

function scheduleBump(env: Env, outcome: EdgeCacheOutcome, waitUntil?: WaitUntilContext, siteId?: string): void {
  if (typeof waitUntil?.waitUntil !== "function" || Math.random() >= 1 / EDGE_SAMPLE_WEIGHT) return;
  try {
    const writes = [bump(env, outcome === "HIT" ? HITS_KEY : MISSES_KEY)];
    if (siteId) writes.push(bumpSite(env, siteId, outcome));
    waitUntil.waitUntil(Promise.all(writes));
  } catch {
    // A context that can no longer accept work must still serve the cached response.
  }
}

export function recordCacheHit(env: Env, waitUntil?: WaitUntilContext): void {
  scheduleBump(env, "HIT", waitUntil);
}

export function recordCacheMiss(env: Env, waitUntil?: WaitUntilContext): void {
  scheduleBump(env, "MISS", waitUntil);
}

export function recordEdgeCacheStatus(env: Env, status: string | null, waitUntil?: WaitUntilContext, siteId?: string): void {
  const outcome = status?.toUpperCase();
  if (outcome === "HIT" || outcome === "MISS") scheduleBump(env, outcome, waitUntil, siteId);
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
