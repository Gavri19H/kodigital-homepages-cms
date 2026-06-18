// T44 [BCL-020]: admin cache hit/miss monitoring view.
//
//   GET  /api/admin/cache/stats        -> live counters + derived hit_rate
//   POST /api/admin/cache/stats/reset  -> zero the counters (the "Reset"
//                                         action on the admin stats view)
//
// Both handlers touch ONLY env.CACHE (KV) — no D1, no outbound HTTP — so the
// dry-run zero-outbound contract holds. The response wraps the stats under
// `resource` to match the existing admin JSON envelope (mirrors
// purge-cache-handler).

import type { Context } from "hono";
import type { Env } from "../env";
import { readCacheStats, resetCacheStats } from "../cache/cache-stats";

export async function cacheStatsHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const stats = await readCacheStats(c.env);
  return c.json({ resource: stats });
}

export async function cacheStatsResetHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  await resetCacheStats(c.env);
  // Echo the zeroed counters back so the UI can render the cleared state
  // without a second round-trip.
  const stats = await readCacheStats(c.env);
  return c.json({ reset: true, resource: stats });
}
