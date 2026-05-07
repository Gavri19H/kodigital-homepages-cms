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

## Re-evaluation triggers

Re-run this model and revisit the Phase plan if any of the following
hold for two consecutive weeks at steady state:

- Daily renders exceed 50,000.
- D1 row count exceeds 250,000.
- R2 storage exceeds 25 GB.
- KV writes exceed 5,000/day.
