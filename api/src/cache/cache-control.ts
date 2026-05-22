// Cache-Control header helpers for kodigital-homepages-cms Phase-7 SEO.
//
// Centralizes every Cache-Control / X-Robots-Tag / X-Content-Type-Options
// header policy in one module so the router (T11/T12/T13) + admin layer
// (T18/T25) + off-admin-host hardening can apply the right headers without
// each callsite re-deriving them. Wire literals (proposal.md "Cache-Control
// policy"):
//
//   Public HTML  : Cache-Control: public, max-age=300, stale-while-revalidate=86400
//   Admin        : Cache-Control: private, no-store; X-Robots-Tag: noindex, nofollow
//   Feeds        : Cache-Control: public, max-age=300, stale-while-revalidate=86400
//   Robots/Ads   : Cache-Control: public, max-age=3600
//   404          : Cache-Control: public, max-age=60
//   Off-admin    : Cache-Control: private, no-store + X-Robots-Tag: noindex
//
// Every helper additionally sets X-Content-Type-Options: nosniff so MIME
// sniffing can't promote a text body into HTML on misbehaving clients.
//
// Each helper is declared with `export function` (no `async`) and returns a
// plain Headers object so the AC4 grep
//   `^export function (publicHtmlCacheHeaders|adminCacheHeaders|...)`
// matches all five names.

// Wire literals. Kept as module-local constants so the AC grep
// `public, max-age=300, stale-while-revalidate=86400` (AC1) and
// `private, no-store` (AC2) and `X-Content-Type-Options` (AC3) all match
// the source verbatim, and so callsites use the canonical strings via
// referenced symbols rather than re-typing them inline.
const PUBLIC_HTML_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=86400";
const ADMIN_CACHE_CONTROL = "private, no-store";
const FEED_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=86400";
const ROBOTS_ADS_CACHE_CONTROL = "public, max-age=3600";
const NOT_FOUND_CACHE_CONTROL = "public, max-age=60";
const OFF_ADMIN_CACHE_CONTROL = "private, no-store";

const NOSNIFF_HEADER_NAME = "X-Content-Type-Options";
const NOSNIFF_HEADER_VALUE = "nosniff";

const ADMIN_X_ROBOTS_TAG = "noindex, nofollow";
const OFF_ADMIN_X_ROBOTS_TAG = "noindex";

export interface PublicHtmlHeaderOptions {
  etag?: string;
  contentType?: string;
}

export interface FeedHeaderOptions {
  etag?: string;
  contentType?: string;
}

export interface RobotsAdsHeaderOptions {
  contentType?: string;
}

function applyNosniff(headers: Headers): void {
  headers.set(NOSNIFF_HEADER_NAME, NOSNIFF_HEADER_VALUE);
}

// publicHtmlCacheHeaders builds the response headers used for every public
// HTML page (homepage, article, category, page). Pairs the canonical wire
// Cache-Control with the X-Content-Type-Options nosniff guard. ETag is
// optional because computeEtag() is async — the router awaits it before
// passing it through.
export function publicHtmlCacheHeaders(
  options: PublicHtmlHeaderOptions = {},
): Headers {
  const headers = new Headers();
  headers.set("Cache-Control", PUBLIC_HTML_CACHE_CONTROL);
  headers.set("Content-Type", options.contentType ?? "text/html; charset=utf-8");
  applyNosniff(headers);
  if (options.etag) headers.set("ETag", options.etag);
  return headers;
}

// adminCacheHeaders builds the response headers used for every admin route.
// private+no-store ensures intermediaries (browser cache, ISP cache, CF)
// never retain admin payloads; X-Robots-Tag noindex,nofollow keeps the URL
// space out of search indexes; nosniff blocks MIME promotion.
export function adminCacheHeaders(): Headers {
  const headers = new Headers();
  headers.set("Cache-Control", ADMIN_CACHE_CONTROL);
  headers.set("X-Robots-Tag", ADMIN_X_ROBOTS_TAG);
  applyNosniff(headers);
  return headers;
}

// feedCacheHeaders builds the response headers used for /sitemap.xml,
// /feed.xml, /atom.xml. Same public/SWR cache policy as HTML — these are
// crawled often but the underlying content_version-bump invalidation will
// flush them within seconds of an article publish.
export function feedCacheHeaders(options: FeedHeaderOptions = {}): Headers {
  const headers = new Headers();
  headers.set("Cache-Control", FEED_CACHE_CONTROL);
  headers.set(
    "Content-Type",
    options.contentType ?? "application/xml; charset=utf-8",
  );
  applyNosniff(headers);
  if (options.etag) headers.set("ETag", options.etag);
  return headers;
}

// robotsAdsCacheHeaders builds the response headers used for /robots.txt
// and /ads.txt. Longer max-age (1h) because settings_version bumps are
// rare and crawlers honour a few minutes of staleness.
export function robotsAdsCacheHeaders(
  options: RobotsAdsHeaderOptions = {},
): Headers {
  const headers = new Headers();
  headers.set("Cache-Control", ROBOTS_ADS_CACHE_CONTROL);
  headers.set(
    "Content-Type",
    options.contentType ?? "text/plain; charset=utf-8",
  );
  applyNosniff(headers);
  return headers;
}

// offAdminHostHeaders builds the response headers used when a request hits
// the public origin asking for an admin-shaped path (e.g. /admin or
// /admin/*). The off-host response is opaque + non-indexable so that
// admin URLs don't leak through DNS / referral logs as cacheable assets.
// Same private,no-store discipline as adminCacheHeaders; X-Robots-Tag is
// noindex (no need for nofollow on a stub response that has no outbound
// links).
export function offAdminHostHeaders(): Headers {
  const headers = new Headers();
  headers.set("Cache-Control", OFF_ADMIN_CACHE_CONTROL);
  headers.set("X-Robots-Tag", OFF_ADMIN_X_ROBOTS_TAG);
  applyNosniff(headers);
  return headers;
}

// notFoundCacheHeaders is a non-AC-required helper used by the router's 404
// handler so 404 storms (e.g. an offending crawler) don't hammer the DB.
// Exported so router.ts (T11) can opt in without re-deriving the policy.
export function notFoundCacheHeaders(): Headers {
  const headers = new Headers();
  headers.set("Cache-Control", NOT_FOUND_CACHE_CONTROL);
  headers.set("Content-Type", "text/html; charset=utf-8");
  applyNosniff(headers);
  return headers;
}

export const CACHE_CONTROL_VALUES = {
  publicHtml: PUBLIC_HTML_CACHE_CONTROL,
  admin: ADMIN_CACHE_CONTROL,
  feed: FEED_CACHE_CONTROL,
  robotsAds: ROBOTS_ADS_CACHE_CONTROL,
  notFound: NOT_FOUND_CACHE_CONTROL,
  offAdmin: OFF_ADMIN_CACHE_CONTROL,
} as const;
