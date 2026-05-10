// KV-backed cache helpers for kodigital-homepages-cms.
//
// Primary backing store is the env.CACHE KVNamespace. The Cache API
// (caches.default) path is gated by env.CACHE_API_ENABLED so we never
// touch caches.default unless the operator has explicitly enabled it.
//
// Feed keys all share the prefix "feed:" so invalidateFeeds() can wipe
// every feed entry in one pass after a publish/unpublish event.

import { parseBoolean, type Env } from "../env";

const FEED_PREFIX = "feed:";

export interface CacheSetOptions {
  expirationTtl?: number;
}

export async function cacheGet(env: Env, key: string): Promise<string | null> {
  return env.CACHE.get(key);
}

export async function cacheSet(
  env: Env,
  key: string,
  body: string,
  options: CacheSetOptions = {},
): Promise<void> {
  if (options.expirationTtl !== undefined) {
    await env.CACHE.put(key, body, { expirationTtl: options.expirationTtl });
    return;
  }
  await env.CACHE.put(key, body);
}

export async function cacheDel(env: Env, key: string): Promise<void> {
  await env.CACHE.delete(key);
  // Cache API stub — gated by env.CACHE_API_ENABLED. We never reach
  // caches.default unless the operator has explicitly opted in.
  if (parseBoolean(env.CACHE_API_ENABLED)) {
    try {
      const cache = caches.default;
      await cache.delete(`https://cache.local/${encodeURIComponent(key)}`);
    } catch {
      // Cache API not available in this runtime — fail silently.
    }
  }
}

export async function invalidateFeeds(env: Env): Promise<void> {
  let cursor: string | undefined;
  while (true) {
    const result: KVNamespaceListResult<unknown, string> = await env.CACHE.list(
      { prefix: FEED_PREFIX, cursor },
    );
    for (const entry of result.keys) {
      await env.CACHE.delete(entry.name);
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }
}
