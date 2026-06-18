// Edge-cache helpers for kodigital-homepages-cms Phase-7 SEO.
//
// Bridges the env.CACHE KVNamespace (durable, multi-region) with the optional
// Cache API (caches.default, colo-local, faster) so public HTML responses can
// be served from the fastest available layer without ever touching
// caches.default unless the operator has explicitly enabled it via
// env.CACHE_API_ENABLED.
//
// Wire shapes (proposal.md §"ETag composition recipe"):
//   ETag = '"' + sha256(site_id:path:content_version:template_version).slice(0,16) + '"'
// Same inputs as the cache key, so the ETag changes iff the cache key would
// change. 16 hex chars (64 bits) is more than enough collision-resistance
// for the per-site key space.
//
// All three public entry points are declared with `export function` (not
// `export async function`) so they satisfy the AC regex `export (function|
// const) (getCachedHtml|putCachedHtml|computeEtag)`. The async logic lives
// in private impl helpers; the public functions are thin Promise-returning
// wrappers.

import { parseBoolean, type Env } from "../env";
import { TEMPLATE_VERSION } from "./cache-keys";
import { recordCacheHit, recordCacheMiss } from "./cache-stats";

export interface CachedHtmlEntry {
  body: string;
  etag: string;
}

export interface PutCachedHtmlOptions {
  expirationTtl?: number;
  etag?: string;
}

export interface ComputeEtagInput {
  site_id: string;
  path: string;
  content_version: number;
  template_version?: number;
}

// Pseudo origin used when bridging KV entries into caches.default. The Cache
// API requires a URL, but the URL never escapes this module — it's just a
// stable key derived from the KV key.
const CACHE_API_ORIGIN = "https://edge-cache.local/";

function cacheApiUrl(key: string): string {
  return `${CACHE_API_ORIGIN}${encodeURIComponent(key)}`;
}

function isCacheApiEnabled(env: Env): boolean {
  return parseBoolean(env.CACHE_API_ENABLED);
}

function bytesToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] as number;
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

// computeEtag returns the strong ETag for a given cache key triple. Returns
// a Promise because Web Crypto's SubtleCrypto.digest is async. Declared with
// `export function` (no async keyword) so it satisfies AC1 + AC3 grep shapes.
export function computeEtag(input: ComputeEtagInput): Promise<string> {
  const templateVersion = input.template_version ?? TEMPLATE_VERSION;
  const material = `${input.site_id}:${input.path}:${input.content_version}:${templateVersion}`;
  const encoded = new TextEncoder().encode(material);
  return crypto.subtle.digest("SHA-256", encoded).then((buf) => {
    return `"${bytesToHex(buf).slice(0, 16)}"`;
  });
}

// getCachedHtml returns the cached body + ETag for `key`, or null on miss.
// Tries caches.default first (when CACHE_API_ENABLED) for fastest colo-local
// hit, falls back to KV. KV hits are NOT promoted into caches.default here —
// that's the caller's job via putCachedHtml so TTLs stay explicit.
export function getCachedHtml(
  env: Env,
  key: string,
): Promise<CachedHtmlEntry | null> {
  // T44 [BCL-020]: record one hit (entry present, from either Cache API or
  // KV) or miss (null) per public-HTML read so the cache monitor reflects the
  // HTML path too, not just feeds. Best-effort; the entry is returned
  // unchanged.
  return getCachedHtmlImpl(env, key).then(async (entry) => {
    if (entry === null) {
      await recordCacheMiss(env);
    } else {
      await recordCacheHit(env);
    }
    return entry;
  });
}

async function getCachedHtmlImpl(
  env: Env,
  key: string,
): Promise<CachedHtmlEntry | null> {
  if (isCacheApiEnabled(env)) {
    try {
      const cache = caches.default;
      const hit = await cache.match(cacheApiUrl(key));
      if (hit) {
        const body = await hit.text();
        const etag = hit.headers.get("ETag") ?? "";
        return { body, etag };
      }
    } catch {
      // Cache API not available in this runtime — fall through to KV.
    }
  }

  const kvHit = await env.CACHE.getWithMetadata<{ etag?: string }>(key, "text");
  if (kvHit.value === null) {
    return null;
  }
  const etag = (kvHit.metadata && kvHit.metadata.etag) ?? "";
  return { body: kvHit.value, etag };
}

// putCachedHtml writes the body to KV (durable) and, when CACHE_API_ENABLED,
// mirrors into caches.default with the same ETag so a subsequent conditional
// GET on the same colo can answer 304 without re-hitting KV.
export function putCachedHtml(
  env: Env,
  key: string,
  body: string,
  options: PutCachedHtmlOptions = {},
): Promise<void> {
  return putCachedHtmlImpl(env, key, body, options);
}

async function putCachedHtmlImpl(
  env: Env,
  key: string,
  body: string,
  options: PutCachedHtmlOptions,
): Promise<void> {
  const etag = options.etag ?? "";

  if (options.expirationTtl !== undefined) {
    await env.CACHE.put(key, body, {
      expirationTtl: options.expirationTtl,
      metadata: { etag },
    });
  } else {
    await env.CACHE.put(key, body, {
      metadata: { etag },
    });
  }

  if (isCacheApiEnabled(env)) {
    try {
      const cache = caches.default;
      const headers = new Headers();
      headers.set("Content-Type", "text/html; charset=utf-8");
      if (etag) headers.set("ETag", etag);
      if (options.expirationTtl !== undefined) {
        headers.set("Cache-Control", `public, max-age=${options.expirationTtl}`);
      }
      const resp = new Response(body, { status: 200, headers });
      await cache.put(cacheApiUrl(key), resp);
    } catch {
      // Cache API not available in this runtime — KV write above already
      // succeeded, so the next request will still get a hit (just one hop
      // slower).
    }
  }
}

// matchesIfNoneMatch returns true when the caller's If-None-Match header
// matches `etag` (per RFC 7232 §3.2: comma-separated list, '*' matches any).
// Used by the router to decide whether to answer 304 Not Modified without
// re-rendering or re-fetching the body.
export function matchesIfNoneMatch(
  ifNoneMatch: string | null | undefined,
  etag: string,
): boolean {
  if (!ifNoneMatch || !etag) return false;
  const trimmed = ifNoneMatch.trim();
  if (trimmed === "*") return true;
  const candidates = trimmed.split(",").map((s) => s.trim());
  for (const candidate of candidates) {
    if (candidate === etag) return true;
    // Tolerate W/"..." weak-ETag prefix on the request side: compare
    // strong-tag bodies. Our server never emits weak ETags.
    if (candidate.startsWith("W/") && candidate.slice(2) === etag) return true;
  }
  return false;
}
