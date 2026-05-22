// T11: shared HTML cache + ETag + 304 pipeline for public-content handlers
// (article / page / category / homepage). Centralizes the conditional-GET +
// KV/Cache-API lookup + write-through pattern so the router can wire SEO head
// + JSON-LD into each handler without re-implementing the cache discipline
// per route.
//
// Wire shapes (proposal.md §"ETag composition recipe" + §"Cache-Control
// policy"):
//   ETag             : strong sha256(site_id:path:content_version:tv) prefix
//   Cache-Control    : public, max-age=300, stale-while-revalidate=86400
//   304 Not Modified : empty body + ETag header echoed back to the caller
//
// servePublicHtml is intentionally render-agnostic: callers pass a `render`
// thunk that returns the FULL HTML body to cache. The pipeline never
// inspects the body — it just writes it through KV (+ caches.default when
// CACHE_API_ENABLED) and serves the matching publicHtmlCacheHeaders().

import { type Env, parseNumber } from "../env";
import {
  computeEtag,
  getCachedHtml,
  putCachedHtml,
  matchesIfNoneMatch,
} from "../cache/edge-cache";
import type { PublicSiteContext } from "./middleware";

export interface ServePublicHtmlOptions {
  // KV / Cache-API key (e.g. htmlKey/articleKey/categoryKey/pageKey).
  key: string;
  // Logical path used in the ETag composition (e.g. "/article/foo"). MUST
  // match the path component baked into `key` so an ETag computed here
  // collides with the cached entry's ETag.
  path: string;
  // Caller-supplied If-None-Match request header (or null when absent).
  ifNoneMatch: string | null | undefined;
  // Render thunk: returns the full HTML body to cache and serve. Invoked
  // ONLY on a cold cache (or when the cached body's ETag is missing).
  render: () => string | Promise<string>;
  // Per-handler headers factory. Receives the computed ETag so each handler
  // can decide whether to forward it on Headers. The router supplies
  // `(etag) => publicHtmlCacheHeaders({ etag })` so the Cache-Control policy
  // stays in one place (cache-control.ts) while each handler still controls
  // its own Content-Type / nosniff via that helper.
  headersFactory: (etag: string) => Headers;
}

// Default KV TTL for public HTML when env.HTML_CACHE_TTL_SECONDS is unset.
// Matches the proposal's public,max-age=300 wire value so KV expiry and
// downstream client max-age stay aligned.
const DEFAULT_HTML_CACHE_TTL_SECONDS = 300;

export async function servePublicHtml(
  env: Env,
  siteContext: PublicSiteContext,
  opts: ServePublicHtmlOptions,
): Promise<Response> {
  const etag = await computeEtag({
    site_id: siteContext.siteId,
    path: opts.path,
    content_version: siteContext.content_version,
  });

  // RFC 7232 §3.2: respond 304 Not Modified when the request's
  // If-None-Match matches the resource's current strong ETag. We echo the
  // ETag on the 304 response so intermediaries observe the same value.
  if (matchesIfNoneMatch(opts.ifNoneMatch ?? null, etag)) {
    const headers = opts.headersFactory(etag);
    return new Response(null, { status: 304, headers });
  }

  // Warm-cache fast path: KV or caches.default. The cached body's stored
  // ETag is preferred (it's the one that was on the wire when the body
  // was written) but falls back to the just-computed etag if absent.
  const cached = await getCachedHtml(env, opts.key);
  if (cached !== null) {
    const headers = opts.headersFactory(cached.etag || etag);
    return new Response(cached.body, { status: 200, headers });
  }

  // Cold cache: render, write-through, serve.
  const body = await opts.render();
  const ttl = parseNumber(
    env.HTML_CACHE_TTL_SECONDS,
    DEFAULT_HTML_CACHE_TTL_SECONDS,
  );
  await putCachedHtml(env, opts.key, body, {
    expirationTtl: ttl,
    etag,
  });
  const headers = opts.headersFactory(etag);
  return new Response(body, { status: 200, headers });
}
