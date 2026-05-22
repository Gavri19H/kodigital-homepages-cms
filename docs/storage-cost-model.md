# Storage Cost Model — D1 + R2 + KV at Target Scale

Target scale for `kodigital-homepages-cms`:

- **200 sites** in steady state, each with its own homepage and a small
  set of inner pages.
- **15 starter articles per site** at launch, growing to ~100 over time.
- **~10000 page renders / day** across all sites at steady state, served
  primarily from cache.

This document sizes the three Cloudflare storage primitives we use
(**D1**, **R2**, **KV**) against that scale and records the
cost-relevant assumptions we baked into the Phase 0 architecture.

## D1 (relational, structured content)

**Holds:** sites, pages, articles, blocks, translations, audit log.

- 200 sites × (1 homepage + ~10 inner pages + 15 articles) ≈ 5,200 rows
  in the page-like tables at launch. With media-block rows and
  translation rows, expect ≈ 25,000 rows total at launch.
- Steady-state growth: ~2,000–4,000 rows/month (new articles, content
  edits as new revisions).
- Read pattern: edge cache absorbs most reads; D1 sees write traffic
  (admin edits) and cache-miss reads. With 10000 daily renders and a
  90%+ cache hit rate, D1 sees on the order of 1,000 reads/day.
- Cost driver: rows-read and rows-written under the D1 pricing model.
  Phase 0 budget assumes the D1 free-tier read/write quotas comfortably
  cover this load.

## R2 (object storage, original media)

**Holds:** uploaded images and original video/audio assets, addressed by
content hash.

- 200 sites × ~30 media assets (logos, hero images, article images) ≈
  6,000 assets at launch.
- Average asset size: ~400 KB after server-side resize → ~2.4 GB total
  at launch; ~5 GB at year-1 steady state.
- Egress: served via Worker → KV-cached or via Cache API; R2 itself is
  the origin of truth. Egress from R2 is free under Cloudflare's pricing
  model, so the cost driver is **storage GB-month**, not bandwidth.

## KV (edge-cacheable rendered output and short-lived metadata)

**Holds:** pre-rendered HTML for hot pages, sitemap/robots payloads,
session-style admin tokens.

- 200 sites × ~25 hot pages each ≈ 5,000 cached HTML payloads at any
  time, average ~30 KB each → ~150 MB resident.
- Read traffic: ~10000 renders/day at >90% hit rate ≈ 9,000 KV reads/day.
- Write traffic: invalidations on edit + nightly warm-ups, on the order
  of 100–500 writes/day.

## Why this split

- **D1** is the system of record for structured content; relational
  queries are cheap and the dataset is small enough to live there
  comfortably.
- **R2** isolates large binary assets from the relational store and
  gives us free egress.
- **KV** is the hot-path edge cache — sub-10ms reads at the edge — and
  absorbs the bulk of the page-render traffic so D1 stays quiet.

## Phase 7 cost drivers

Phase 7 (`cms-new-phase7-seo-2026-05-21`) introduced edge-cache wiring,
SEO + JSON-LD head rendering, KV-backed sitemap/feed/robots/ads caches,
and a `cost:estimate` script + D1 query wrapper that surface per-route
storage cost. The Phase 7 cost drivers below are the load-bearing
inputs to `npm run cost:estimate` and to the per-driver invariants the
Phase 7 implementation enforces.

### D1 reads (cache-miss reads + admin writes)

- **Driver:** D1 reads / day at steady state. Computed by
  `cost:estimate` as `renders/day × (1 - edge_hit_ratio)` summed across
  homepage and article routes (`api/scripts/cost/estimate.ts` —
  defaults `homepage-hit-ratio=0.90`, `article-hit-ratio=0.90`).
- **Default budget:** ≤ 1,000 D1 reads / day at 10,000 daily renders
  and a 90 %+ edge-cache hit ratio (same envelope as the Phase 0
  number above, now backed by the captured-metrics wrapper).
- **Captured-metrics wrapper:** `api/src/db/query.ts` `runD1` /
  `runD1Batch` extract `rows_read`, `rows_written`, `duration_ms`, and
  `served_by_region` from `D1Response.meta`, so per-route cost can be
  logged or asserted without parsing raw D1 output. Phase 7 routes
  that wrap a cache-miss SELECT MUST go through this wrapper so the
  D1 reads driver stays observable.
- **Re-evaluation trigger:** if the captured `rows_read` for a single
  public render exceeds 50 sustained over a week, the hit-ratio
  assumption is wrong and `cost:estimate` should be re-run with the
  observed ratio. If the wrapper is bypassed (raw `prepare(...).all()`
  in a Phase-7 route), reviewers MUST block the change — `D1 reads`
  observability regresses silently.
- **EXPLAIN coverage:** `npm run db:explain-homepage` and
  `npm run db:explain-article` run `EXPLAIN QUERY PLAN` against the
  hot SELECTs feeding the homepage / article routes so an unindexed
  scan cannot regress the `D1 reads / cache-miss` budget unnoticed.

### KV cache (hot-payload reads + invalidation writes)

- **Driver:** KV cache reads / day (the hot path that absorbs the
  bulk of public renders) and KV cache writes / day (invalidations on
  edit + nightly warm-ups + occasional cold-start writes).
- **Default budget:** ~ 9,000 KV cache reads / day (10,000 renders ×
  90 % hit ratio) and ~ 100–500 KV cache writes / day at the Phase 7
  invalidation cadence (per-slug HTML invalidate + per-site
  `content_version` / `settings_version` bumps).
- **Key versioning policy:** Phase 7 cache keys carry the relevant
  version dimension as a SUFFIX — `html:{site_id}:{path}:{content_version}:{template_version}`,
  `settings:{site_id}:{settings_version}`, and friends (see
  `docs/cache-strategy.md`). A version bump orphans stale KV cache
  entries automatically, so the write driver does NOT scale with the
  number of stale entries — only with the bump rate.
- **Re-evaluation trigger:** if KV cache writes exceed 5,000 / day at
  steady state (already in the Re-evaluation triggers list below)
  the invalidation cadence is wrong; check whether the publish flow
  is double-bumping `content_version` per article (it should bump
  once per publish per site, not per affected key).
- **Off-admin-host neutralisation:** the Phase 7
  `offAdminHostHeaders` policy serves `/admin*` from the public host
  with `private, no-store`, so admin traffic never hits the KV cache
  on the public host. This protects the KV cache read driver from
  admin-traffic pollution.

### R2 media (storage GB-month, not bandwidth)

- **Driver:** R2 media storage GB at steady state — uploaded images
  and original video/audio assets, addressed by content hash. Egress
  from R2 is free under Cloudflare's pricing model, so the cost is
  `storage GB × month`, not request volume.
- **Default growth budget:** ~ 6,000 R2 media assets at launch (200
  sites × ~30 hero / logo / article images) at ~400 KB after
  server-side resize → ~ 2.4 GB. Year-1 projection: ~ 5 GB as the
  starter-15-articles-per-site assumption grows toward the ~100
  steady-state article count (R2 media growth tracks per-article
  hero/inline image uploads).
- **Re-evaluation trigger:** R2 storage > 25 GB (already in the
  Re-evaluation triggers list below) — a Phase 7 hero-image size
  regression (e.g. the public layout starts shipping the original
  upload instead of the resized variant) would push R2 media growth
  past this trigger before the per-asset cost is felt at the wallet.
- **No public CDN cache for R2:** R2 fetches go via the Worker; we
  do NOT proxy R2 through the public KV cache. R2 media growth is
  therefore independent of `content_version` / `settings_version`
  bumps — re-publishing an article does not re-upload the R2 hero
  image, so the R2 driver is set by *new* uploads, not by content
  edits.

### Cross-driver invariants (verifier hooks)

- `npm run cost:estimate` is the single source of truth for the
  Phase 7 D1 reads / KV hot payloads / R2 assets numbers at the
  current scale. Reviewers MUST re-run it after any change that
  moves SITES / DAILY_RENDERS / hit-ratio defaults; the printed
  table is the artifact reviewers compare against this document.
- `npm run verify:infra` + `npm run verify:worker-config` confirm
  the D1 / KV / R2 bindings declared in `wrangler.toml` match the
  Cloudflare resources the cost drivers above assume.

## Re-evaluation triggers

Re-run this model and revisit the Phase plan if any of the following
hold for two consecutive weeks at steady state:

- Daily renders exceed 50,000.
- D1 row count exceeds 250,000.
- R2 storage exceeds 25 GB.
- KV writes exceed 5,000/day.
