# Cache Strategy

`kodigital-homepages-cms` runs a two-layer cache for every public route:
a durable Cloudflare KV namespace (`env.CACHE`) bound to the Worker, and
an optional Cache API (`caches.default`) bridge that the operator can
flip on per-environment via `env.CACHE_API_ENABLED`. The wire shapes of
keys + headers + versions are owned by the modules under
`api/src/cache/`; this doc is a human-readable index of the contract
those modules already encode.

The five source files under `api/src/cache/` are:

- `cache-keys.ts` (T1) — every cache key formatter + `TEMPLATE_VERSION`.
- `cache-control.ts` (T4) — every `Cache-Control` / `X-Robots-Tag` /
  `X-Content-Type-Options` header policy.
- `edge-cache.ts` (T2/T3) — the KV ⇄ Cache API bridge + `computeEtag`.
- `invalidate.ts` (T15) — per-site list+delete helpers per workflow.
- `purge.ts` (T16) — Cloudflare zone-purge bridge with dry-run default
  and protected-domain refusal (cross-referenced in
  `docs/cache-purge-safety.md`).
- `warm.ts` (T17) — opportunistic warm helpers used by the publish
  workflow after invalidate.

## Cache key format

Every public-content key flows through `api/src/cache/cache-keys.ts`
(11 exported formatters). The canonical HTML key shape is:

```
html:{site_id}:{path}:{content_version}:{template_version}
```

The full set of namespaces is:

| Namespace | Shape | Owner formatter |
|---|---|---|
| html | `html:{site_id}:{path}:{content_version}:{template_version}` | `htmlKey` |
| homepage-data | `homepage-data:{site_id}:{content_version}` | `homepageDataKey` |
| article | `article:{site_id}:{slug}:{content_version}:{template_version}` | `articleKey` |
| category | `category:{site_id}:{slug}:{page}:{content_version}:{template_version}` | `categoryKey` |
| page | `page:{site_id}:{slug}:{content_version}:{template_version}` | `pageKey` |
| sitemap | `sitemap:{site_id}:{content_version}` | `sitemapKey` |
| feed:rss | `feed:rss:{site_id}:{content_version}` | `feedRssKey` |
| feed:atom | `feed:atom:{site_id}:{content_version}` | `feedAtomKey` |
| settings | `settings:{site_id}:{settings_version}` | `settingsKey` |
| robots | `robots:{site_id}:{settings_version}` | `robotsKey` |
| ads | `ads:{site_id}:{settings_version}` | `adsKey` |

Two structural rules are non-negotiable:

1. **`site_id` is the FIRST component after the namespace prefix.**
   This makes per-tenant invalidation a single
   `env.CACHE.list({ prefix: "<ns>:<site_id>:" })` walk. Any future key
   that puts `site_id` later in the path breaks the cheap per-site
   list+delete contract.
2. **Versions are SUFFIXES.** Bumping `content_version` or
   `settings_version` orphans every old entry without any explicit
   `env.CACHE.delete()` — the next read forms a new key and misses
   into origin. The list+delete in `invalidate.ts` is a courtesy pass
   that tightens LRU pressure; it is NOT the correctness mechanism.

`site_id` is RED-LINE protected by `requireSiteId` in `cache-keys.ts`:
null, undefined, empty, and whitespace-only values throw rather than
emit a cross-site key like `html::/foo:1:1`. Path normalization
preserves the leading slash and strips trailing slashes (except root)
so `/article/foo` and `/article/foo/` share one entry.

## Version-bump strategy

There are two version axes — one global, one per-site — and each one
invalidates a different surface:

- `TEMPLATE_VERSION` (module-level `const` in `cache-keys.ts`, default
  `1`). Bumped only when the **rendered HTML shape** changes in a way
  that should invalidate every cached HTML page across every tenant
  (e.g. a head-template restructure, a new meta tag in `seo-head.ts`,
  a JSON-LD field reshape in `jsonld-article.ts`). Bumping
  `TEMPLATE_VERSION` changes the suffix on every `html|article|category|page`
  key and rolls all tenants forward in one deploy.
- `sites.content_version` (per-row in D1 `sites`). Bumped by the
  publish workflow on every article publish / unpublish / update + by
  the page/category admin write paths. Affects only that site's
  cached HTML + homepage-data + sitemap + feeds.
- `sites.settings_version` (per-row in D1 `sites`). Bumped by the
  settings admin write path. Affects only that site's robots.txt /
  ads.txt / cached settings JSON.

Two-axis design intent: `content_version` flips on a few hundred writes
per day per site; `TEMPLATE_VERSION` flips on a handful of deploys per
year. A template bump invalidates all sites without coordinating with
each tenant's edit calendar; a content bump invalidates one site
without paying the cross-tenant flush cost.

## Cache-Control header policy

Header policy is owned by `api/src/cache/cache-control.ts`. Every
public + admin response sets headers through one of the five exported
helpers (`publicHtmlCacheHeaders`, `adminCacheHeaders`,
`feedCacheHeaders`, `robotsAdsCacheHeaders`, `offAdminHostHeaders`);
callsites MUST NOT re-derive the wire values inline.

The canonical wire values are:

| Surface | `Cache-Control` | Other headers | Helper |
|---|---|---|---|
| Public HTML (home, article, category, page) | `public, max-age=300, stale-while-revalidate=86400` | `ETag`, `X-Content-Type-Options: nosniff` | `publicHtmlCacheHeaders` |
| Admin (every `/admin/*` route) | `private, no-store` | `X-Robots-Tag: noindex, nofollow`, `X-Content-Type-Options: nosniff` | `adminCacheHeaders` |
| Feeds (`/sitemap.xml`, `/feed.xml`, `/atom.xml`) | `public, max-age=300, stale-while-revalidate=86400` | `ETag`, `X-Content-Type-Options: nosniff` | `feedCacheHeaders` |
| Robots / Ads (`/robots.txt`, `/ads.txt`) | `public, max-age=3600` | `X-Content-Type-Options: nosniff` | `robotsAdsCacheHeaders` |
| 404 | `public, max-age=60` | `X-Content-Type-Options: nosniff` | `notFoundCacheHeaders` |
| Off-admin-host hit on `/admin/*` | `private, no-store` | `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff` | `offAdminHostHeaders` |

Two policy invariants:

1. **Admin is `private, no-store`. Always.** Any path the admin shell
   serves (`/admin`, `/admin/*`, every JSON endpoint under `/admin/`)
   passes through `adminCacheHeaders`. Intermediaries (browser cache,
   ISP cache, Cloudflare cache, corporate proxies) never retain admin
   payloads. `X-Robots-Tag: noindex, nofollow` keeps the admin URL
   space out of search indexes.
2. **Public HTML is `public, max-age=300, stale-while-revalidate=86400`.**
   The 5-minute fresh window is short enough that a published article
   appears on the homepage within 5 minutes even without invalidation;
   the 24-hour SWR window keeps origin pressure flat during a brief
   D1 outage. The invalidate pass + content_version bump remove the
   stale entry well before the SWR expires.

`X-Content-Type-Options: nosniff` is on every response (public, admin,
feed, robots, ads, 404, off-admin) so MIME sniffing can't promote a
text body into HTML on misbehaving clients. The helper-local
`applyNosniff` is the single emission point.

## KV usage (env.CACHE binding)

KV is bound as `[[kv_namespaces]] binding = "CACHE"` in `wrangler.toml`
across local, staging, and production. Read patterns:

- **Public HTML reads** hit `env.CACHE.get(htmlKey(...))` first. On
  miss, the route renders + writes back via
  `env.CACHE.put(htmlKey(...), body, { expirationTtl })` where
  `expirationTtl` defaults to `env.HTML_CACHE_TTL_SECONDS` (60s in
  local, 300s in production).
- **Cache API bridge.** When `env.CACHE_API_ENABLED === "true"` the
  edge-cache layer also writes `caches.default.put(...)` against a
  pseudo origin (`https://edge-cache.local/<key>`). The Cache API hit
  is colo-local + faster but volatile; the KV layer is the durable
  source.
- **ETag.** Computed by `computeEtag({ site_id, path, content_version,
  template_version })`: the SHA-256 of the same components as the
  cache key, sliced to 16 hex chars (64 bits) and wrapped in quotes.
  Same inputs as the key, so the ETag changes iff the key would
  change. The router uses `If-None-Match` to 304 on byte-identical
  responses without re-emitting the body.
- **Invalidation.** Per-workflow helpers in `invalidate.ts`
  (`invalidateOnArticlePublish`, `invalidateOnPageWrite`,
  `invalidateOnCategoryWrite`, `invalidateOnSettingsWrite`) list keys
  by `<ns>:<site_id>:` prefix and delete them. Defense-in-depth — the
  version bump is the correctness path.

## Cross-references

- **Header verbatim wire** lives in `api/src/cache/cache-control.ts`.
  If a future story changes a Cache-Control value here, BOTH the
  module AND this doc's table MUST update in the same change.
- **Purge safety + dry-run + protected-domain refusal** are documented
  separately in `docs/cache-purge-safety.md` (T31). The CMS NEVER
  emits an outbound fetch to `api.cloudflare.com` in `dry-run` mode.
- **Cost model.** The per-site KV read/write/list/delete counts under
  Phase-7 load are tracked in `docs/storage-cost-model.md` (T32).
- **SEO head + JSON-LD** that the cached HTML bodies emit are in
  `docs/seo-strategy.md` (T27). A SEO-head shape change requires a
  `TEMPLATE_VERSION` bump in `cache-keys.ts` so cached HTML rolls
  forward.
- **GEO checklist + per-page audit table** are in
  `docs/geo-checklist.md` (T28).
