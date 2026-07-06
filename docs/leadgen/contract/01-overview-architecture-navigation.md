# LeadGen CMS — Implementation Contract

**Product:** LeadGen · **Namespace:** `leadgen_` · **Target repo:** `Gavri19H/kodigital-homepages-cms` · **Target Worker:** `kodigital-homepages-cms-worker`
**Admin routes:** `/admin/leadgen`, `/api/admin/leadgen` · **Public/runtime routes:** `/lg/...`
**Status:** design contract v2.3 (pre-implementation) — V2.3 DRAFT, READY TO BUILD. This document is the authoritative build spec for a downstream implementation agent. It is grounded in the actual code of the target repo, the Listicles subsystem inside it, the `a2z-agent-demo` quote-funnel reference, and the `kodigital-dashboard` media-buying/analytics stack.

> **How to read this contract.** Each of the 35 required deliverable sections is present and numbered. Where the contract says **MUST**, it is a hard acceptance criterion. Where it says **SHOULD**, it is a strong default an implementer may vary with written justification. Schema/DDL/route blocks are normative — column names, types, PKs, and route shapes are part of the contract. Files: `01`–`10` are the contract body; `infra/` holds the Athena + ClickHouse DDL; `migrations/` holds the proposed D1 migration SQL.

---

## 1. Executive summary

LeadGen is a **new, independently-namespaced CMS product** for building and monetizing **advertorial lead-generation quote funnels**. A user (operator) assembles reusable **Offers**, **Sections** (quote slides), and **Quotes** (funnels), wires an end-of-funnel **Auction**, and activates a Quote per-site. Traffic flows: ad platform → funnel shell → question slides collect normalized answers → auction sends per-Offer payloads to providers → bids/carriers evaluated → banners rendered → click → provider revenue attributed by `click_id` → conversions reported back to media platforms via S2S.

LeadGen is a **sibling** of the existing **Listicles** subsystem, not an extension of it. It reuses Listicles' proven architecture wholesale — the CMS admin shell, global-asset + per-site-activation ownership model, ULID `public_id` strategy, macro registry, Firehose → S3 → Athena event pipeline, ClickHouse aggregation → D1 mirror analytics, config-driven S2S dispatcher, and cache/version strategy — but with **its own tables (`leadgen_*`), its own Athena database (`leadgen`), its own ClickHouse tables (`lg_*`), its own routes (`/admin/leadgen`, `/api/admin/leadgen`, `/lg/*`), and its own design registry.** It additionally absorbs the **real-time auction engine, provider payload adapters, carrier parsing, banner rendering, and funnel-rule model** proven in the `a2z-agent-demo` quote-funnel reference — re-implemented as fresh, safely-named code (the reference product name is a **banned token** in this repo; see §2.3).

The core hierarchy:

```
Quote (reusable funnel, global)
  └─ Sections / Quote Slides (reusable, global)      ← collect + normalize user answers
       └─ User Answers / Collected Data
            └─ Auction (end-of-funnel, global)
                 └─ Offers (monetization units, global)  ← static OR dynamic-bid
                      └─ Carriers / Banners (provider results)
Site Activation (per-site): which sites a Quote is live on
```

What ships (functional surface):
- **Offers tab** — global monetization units; static or auctionable; per-Offer dynamic JSON payload builder (manual + auto-from-example), request headers/endpoints/token placement, live Test tool, response parsing + carrier extraction, provider region-block rules (answer-based participation is in the Auction tab), banner URL templates with macros (incl. response-derived), caps, per-Offer analytics.
- **Sections tab** — reusable quote slides; a rich, **token-driven** question/answer builder (range sliders, icon/image card grids, dropdowns, multi-choice, PII inputs, Google-Maps address/ZIP autofill), dependencies/conditional logic, per-Offer answer→payload field mapping with value normalization, desktop/mobile previews, section analytics.
- **Quotes tab** — reusable funnels: ordered Section selection (per-Quote, not fixed), optional opening lander, funnel rules (redirect/skip/eligibility), a deterministic funnel A/B test, a pluggable funnel design registry, per-site activation, funnel analytics.
- **Auction tab** — static or dynamic-bid auctions: participating Offers, winner logic, multi-offer/backfill/remove-clicked, Offer-level + carrier-level rules, timeout/floor, manual + automatic banner builder, full request/response explainability, auction analytics.
- **Analytics** — a dedicated LeadGen event/session tracking domain (Athena `leadgen`), ClickHouse aggregation (`lg_*`), D1 mirrors (`leadgen_analytics_*`), provider revenue ingestion (postback/API/script/in-site), config-driven S2S to media platforms, GA4 pass-through validation.

Non-functional pillars: **static funnel shells cached to ~99.99%**; The auction is the only required monetization-time synchronous dynamic call after the cached funnel shell loads. Other dynamic calls are isolated: /lg/attempt, Google Maps only on address sections, client-mode provider requests only when explicitly configured, click resolver after click, and tracking/pixels async or no-store.; secrets are wrangler-secret-only and masked; nothing existing (CMS/Listicles/GA4) is broken; all repo guardrails respected.

---

## 2. Repository findings

### 2.1 Target platform (verified from `kodigital-homepages-cms@main`)

| Concern | Finding | Source of truth |
|---|---|---|
| Runtime | Cloudflare Worker, **Hono v4**, TypeScript. Single Worker `kodigital-homepages-cms-worker`. | `api/wrangler.toml`, `api/src/index.ts` |
| Storage | **D1** (`DB`, SQL), **R2** (`MEDIA`), **KV** (`CACHE`). One D1 DB `kodigital-homepages-cms-db`. | `wrangler.toml` bindings; `env.ts` `Env` |
| Auth | `/admin*` + `/api/admin*` gated by **Cloudflare Access** (`accessAuth`, JWT via JWKS-in-KV; identity OR service-token mode; `DEV_BYPASS_AUTH` only when `APP_ENV!=production`). | `src/auth/access-auth.ts`, `src/index.ts` |
| Host gate | `/admin*` + `/api/admin*` **only** served on `ADMIN_HOST` (`cms.kodigital.app`); any other host → flat 404 (`no-store`, `noindex`). Public content served on tenant hosts. | `src/index.ts` hostname gate |
| Analytics pipeline | `POST /api/track` → **Kinesis Firehose** → **S3** → **Athena** (`homepage.events`). Listicles adds its own stream `listicle-events` → Athena `listicles.*`. | `wrangler.toml [vars]`, `env.ts` |
| Aggregation | External **Athena → ClickHouse** job; the Worker only **reads** CH over HTTP to fill **D1 mirror** tables; **CMS reads analytics from D1**. | `src/listicles/mirror-sync.ts`, `infra/listicles/*` |
| Scheduled work | Cron `* * * * *` (every minute): publish scheduled content, drive provisioning, `syncListicleAnalytics`, daily reconciliation, revenue maintenance. Each task isolated in its own try/catch (fail-open). | `src/index.ts` `scheduled` |
| Queues | `PROVISION_QUEUE` fan-out consumer (parallel, `max_batch_size=1`). Pattern available for heavy parallel work. | `wrangler.toml [[queues]]` |
| Cache | Two-layer: **KV** (`env.CACHE`) + optional **Cache API** bridge. Key shape `ns:{site_id}:{path}:{content_version}:{template_version}`; `site_id` first, versions as suffixes; per-site `list+delete` invalidation; ETag = SHA-256 of key components. Public HTML `public, max-age=300, stale-while-revalidate=86400`; admin `private, no-store`. | `docs/cache-strategy.md`, `src/cache/*` |
| Secrets | Plaintext non-sensitive vars in `wrangler.toml [vars]`; **all credentials are encrypted secrets via `wrangler secret put`** (Dashboard/CI only), typed optional in `env.ts`, resolved dynamically by `readEnvSecret(env, name)`. Absent secret ⇒ that leg **no-ops** (never a hard failure). | `env.ts`, `wrangler.toml` comments |
| Admin shell | Server-rendered HTML via `adminUi` (Hono). Sub-tab products (Listicles) mount their own UI router + JSON API router next to the main admin. All under the same Access gate + `no-store`. | `src/admin/router.ts`, `src/admin/listicles/ui.ts` |

### 2.2 Listicles subsystem — the primary fork template (verified)

Listicles is the closest analog and the pattern LeadGen mirrors. Verified surfaces:

- **Migrations** `0032_listicles_core.sql` → `0035_listicles_conversion_dedupe.sql`: global `listicle_offers`/`listicle_sections` (no `site_id`), per-site `listicle_articles` (`site_id`), version/experiment/page/candidate/rule tree, real-time `listicle_offer_cap_counters`, five read-only `listicle_analytics_*` mirrors, revenue infra (`listicle_media_platforms`, `listicle_postback_log`, `listicle_revenue_raw`, `listicle_revenue_unmatched`, `listicle_event_dead_letter`, `listicle_fx_rates`), durable `listicle_conversion_log` dedupe.
- **`src/listicles/`**: `ids.ts` (ULID `public_id`, prefix per entity), `macros.ts` (32 canonical macros + alias + validation with host-authority guard + control-char reject), `mirror-sync.ts` (CH→D1 upsert, bounded rolling window, per-table isolation, fail-open), `s2s-dispatch.ts` (config-driven outbound pixel, macro resolve, `fbc` derive, KV dedupe), `clickhouse.ts` (HTTP read client), `rules.ts`, `validation.ts` (40 KB), `revenue-ingest.ts`, `revenue-recon.ts`, `fx.ts`, `invalidate.ts`, `link-instances.ts`.
- **`src/admin/listicles/`**: `router.ts` (JSON API under `/api/admin/listicles`), `ui.ts` (HTML shell under `/admin/listicles`, `→ /offers` default, tabs Offers/Sections/Articles), plus per-tab handlers + UI builders (offers, sections, articles, versions, analytics, media-platforms), all driving the JSON API **in-process** for SSR.
- **`src/public/listicle/`**: `serve.ts`, `resolver.ts`, `runtime.ts`, `render.ts`, `ctx-inject.ts`, `ab-hash.ts`, `experiment-pick.ts`, `governed-url.ts` (click resolver), `postback.ts`, and a **layout registry** (`layouts/registry.ts` + `layouts/default/{tokens,components,styles,tokens-to-css,measured-values}.ts`) — the exact design-registry pattern LeadGen's funnel design system mirrors.
- **`infra/listicles/`**: `athena-ddl.sql` (events/sessions/dead_letter, `record_kind` discriminator, partition projection), `clickhouse-ddl.sql` (raw ingest + revenue attribution MV + 5 daily target MVs, `ReplacingMergeTree`, `REFRESH EVERY 2 MINUTE`, `clean`-only filter, ratios computed at read), plus `aws-provision.md`, `clickhouse-apply.md`, `revenue-secrets.md`.

### 2.3 Quote-funnel reference — `a2z-agent-demo` (verified; naming banned in this repo)

The auction engine, provider adapters, payload builders, funnel rules, and banner/carrier model that LeadGen needs beyond Listicles are proven in `a2z-agent-demo/api/src/<reference>/`. Key mechanics extracted (to be **re-implemented fresh** under `leadgen_`):

- **Auction (`handlers/listings.ts`)**: parallel provider fetch with `Promise.race([fetch, timeout(ms)])` + `Promise.allSettled`; per-provider adapter = `{ fetch, normalize }`; `filterPartnersByPlacement` (only providers with a non-empty placement id participate); `calculateAuctionMetrics` (floor = `maxBid × floorPct`, qualified ≥ floor, fallbacks < floor, score = maxBid); `selectWinner` (sort candidates by score desc → winner); CPL-merge (lower fixed bids merged into winner set, re-sorted by bid desc); `dedupeCarrierConflicts` (same-carrier duplicate → keep higher bid); backfill (brands not shown, from a configured source); pre-auction **exclude** vs post-auction **include** carrier overrides; `evaluateOverrideConditions` (AND across fields, OR within a field; ops `eq/gt/lt/neq/range`); non-blocking DB writes on `ctx.waitUntil` (`insertAuctionBid` per listing, `insertAuctionWin`, session update); XOR-obfuscated fallback/backfill blobs in HTML.
- **Payload builder (`adapters/*-payload.ts`)**: per-provider **nested envelope** mapping; `cleanObject` recursively drops undefined/null/empty (the single "no fabrication" mechanism); multi-source field fallbacks; transforms (`formatDate`, `formatPhone`, `mapBoolean`, `mapMaritalStatus`); array collection (drivers/vehicles) from array or flat fields.
- **Response-derived URL**: winner response fields substituted into the click URL (`sub5={response:slug}`, nested paths supported) — the pattern LeadGen generalizes as the `{response:<path>}` macro family.
- **Config (`handlers/config.ts`)**: D1 + KV cache (5-min TTL) + hardcoded default fallback; client config strips server-only fields; ETag + `Cache-Control: public, max-age=300, s-maxage=1800, swr`.
- **Admin model (`admin/db-types.ts`)**: Row (DB, snake_case, INTEGER bools) vs API (camelCase, boolean, parsed arrays) shape split; funnel rules, placements, **auction overrides v1** (force_winner / include-exclude aggregators) + **v2** (carrier-level: aggregators, conditions, include/exclude carriers, `strictly_override`), CPL rules (fixed bid), auction settings (`timeout_ms`, `floor_percentage`, defaults).

### 2.4 Dashboard / media-buying — `kodigital-dashboard` (verified)

- Consumes the same analytics substrate: `api/src/lib/{clickhouse,ch-d1-mirror,revenue-ingestion,auction-ingestion}.ts`, routes `auction/campaigns/ingest/revenue`, `schema-clickhouse.sql`. The CH conventions in `infra/listicles/clickhouse-ddl.sql` are explicitly **ported from `kodigital-dashboard/schema-clickhouse.sql`** and `lib/ch-d1-mirror.ts`.
- **Integration contract (MUST preserve):** LeadGen events MUST carry `traffic_source`, `utm_*`, `placement`, `click_id`, `fbclid/fbc` and keep these CH column names **stable** — the campaign dashboard joins LeadGen revenue/clicks to its media-buying spend on those keys. Alerting infra (`alert_rules_config`) already has `ingestion_failed` / `revenue_gap` rules that will observe LeadGen once its CH tables land.

### 2.5 Guardrails (MUST respect — verified in `GUARDRAILS.md` + `docs/source-architecture.md`)

- **Banned tokens in active source** (enforced by `npm run verify:no-legacy-prod-refs`, `scripts/verify/assert-no-legacy-prod-refs.ts`, on every PR/push): the reference quote-funnel product name, `quotesRoutes`, `psychic-quiz`, `rental-booking`. **LeadGen implementation code MUST NOT contain any of these identifiers.** This contract may name the reference in prose (docs are in the scanner's `EXCLUDED_FILES`); **generated source must be fresh and `leadgen_`-namespaced.**
- **No-touch red line** (`docs/no-touch-red-line.md`): must not bind to or mutate any TheIWise / legacy production resource. LeadGen adds only `leadgen_*` D1 tables, a new Athena DB `leadgen`, new CH `lg_*` tables, new routes, new wrangler vars/secrets — **additive only**.
- **Deploy safety**: the agent MUST NOT run `wrangler deploy` / `wrangler secret put` / any production mutation. Migrations are forward-only. All five gates (`typecheck`, `test`, `verify:no-legacy-prod-refs`, `verify:infra`, `verify:worker-config`) MUST pass.
- **Additive migrations only**: new `leadgen_`-namespaced tables; **zero** changes to existing tables/routes/caches. Do **not** reuse `listicle_` table names. Do **not** create a Listicles Athena DB for this product.

---

## 3. Existing patterns to reuse (and how LeadGen maps them)

| Pattern (source) | Reuse verbatim? | LeadGen mapping |
|---|---|---|
| ULID `public_id` = prefix + Crockford ULID (`listicles/ids.ts`) | **Yes**, re-implement identically | New `leadgen_` prefixes: `lgo_` offer, `lgs_` section, `lgq_` quote, `lgv_` quote-version, `lgn_` funnel-variant, `lga_` auction, `lgc_` carrier, `lgm_` answer-field-map, `lgr_` rule, `lgp_` payload-schema-version, `lgl_` link/click. |
| Global-asset + per-site-activation ownership (`listicle_offers`/`sections` global; `articles` per-site) | **Yes** | Offers/Sections/Quotes/Auctions **global** (no `site_id`); **Quote activation is per-site** via `leadgen_site_quotes`. |
| Admin sub-product mount (`admin/listicles/{router,ui}.ts` under one Access gate + `no-store`) | **Yes** | `admin/leadgen/{router,ui}.ts` mounted from `admin/router.ts`; 4 tabs. |
| SSR-drives-JSON-API-in-process (`listicleApi.request(...)`) | **Yes** | Same `apiJson()` helper; one query path for XHR + SSR. |
| Row-vs-API shape split (`db-types.ts`) | **Yes** | Every `leadgen_*` table gets a `Row` type + an `API` type; INTEGER bools ↔ boolean; JSON columns parsed. |
| Macro registry + validation (`listicles/macros.ts`) | **Yes**, extend | Same 32 macros + host-authority guard + control-char reject, **plus** `{response:<path>}` family and `{session_id}` already present. |
| Firehose→S3→Athena, `record_kind` discriminator, partition projection (`infra/listicles/athena-ddl.sql`) | **Yes**, new DB | Athena DB `leadgen`; stream `leadgen-events`; record kinds `event`/`session`/`dead_letter`. |
| ClickHouse `ReplacingMergeTree` + `REFRESH EVERY N MINUTE` MV + ratios-at-read + `clean`-only filter (`infra/listicles/clickhouse-ddl.sql`) | **Yes**, new tables | `lg_*` raw + revenue-attributed + daily target MVs. |
| CH→D1 mirror sync (bounded window, per-table isolation, fail-open, `ON CONFLICT` upsert) (`listicles/mirror-sync.ts`) | **Yes** | `syncLeadgenAnalytics(env)` on the same cron; new `leadgen_analytics_*` mirrors. |
| Config-driven S2S dispatcher (`listicles/s2s-dispatch.ts`) | **Yes** | `leadgen_media_platforms` + `dispatchMatchedConversionS2S` (LeadGen copy). |
| Revenue dedupe (`postback_log` UNIQUE, `conversion_log` UNIQUE, `revenue_unmatched` 72h re-match, `fx_rates`) | **Yes** | `leadgen_postback_log`, `leadgen_conversion_log`, `leadgen_revenue_raw/unmatched`, `leadgen_fx_rates`. |
| Layout/design registry (`public/listicle/layouts/registry.ts` + `default/tokens.ts`) | **Yes**, extend | `public/leadgen/designs/registry.ts` + `default/{tokens,components,styles}.ts`; a **banner** design registry alongside. |
| Real-time cap counters (`listicle_offer_cap_counters`, synchronous read/increment) | **Yes** | `leadgen_offer_cap_counters` (same shape). |
| Cache key/version strategy (`site_id` first, version suffixes, ETag) | **Yes** | New namespaces for funnel shells keyed by `funnel_variant_id`/`funnel_variant_id`. |
| Auction engine + adapters + carrier model (`a2z-agent-demo`) | **Re-implement fresh** (banned name) | `public/leadgen/auction/*` + `public/leadgen/adapters/*`, `leadgen_`-named. |

**Anti-patterns to avoid** (all called out in the source): storing ratios (compute at read with `NULLIF`), macros in the host/authority position, secrets in `[vars]` or returned to the frontend, per-site duplication of global assets, blocking the response on provider calls (use `waitUntil` for writes, `Promise.race` timeout for reads), `||` for numeric defaults where `0` is valid (use `??`).

---

## 4. Product architecture

### 4.1 System context

```
┌──────────────┐   ad click      ┌─────────────────────────────────────────────┐
│ Media buying │───────────────▶ │  Cloudflare Worker  kodigital-homepages-cms │
│ (FB/NewsBreak│                  │                                             │
│ /Taboola/... )│◀── S2S conv ────│  /lg/*  public runtime (funnel + auction)   │
└──────────────┘                  │  /admin/leadgen  admin shell (Access-gated) │
                                  │  /api/admin/leadgen  JSON CRUD              │
                                  └───────┬───────────────┬───────────┬─────────┘
      provider bid/lead APIs ◀────────────┘               │           │
      (dynamic Offers)                                     │           │
                                        D1 (leadgen_*)  ◀──┘           │  KV CACHE (shells, config, caps-adjacent)
                                        R2 MEDIA (logos/images)        │  R2 (banner/section media)
                                                                       ▼
   POST /lg/track ──▶ Firehose `leadgen-events` ──▶ S3 ──▶ Athena `leadgen.*`
                                                              │
                              (external ops job) Athena ──▶ ClickHouse `lg_*`
                                                              │
                              every-minute cron: CH ──read──▶ D1 `leadgen_analytics_*`
                                                              │
                              CMS admin reads analytics ◀─────┘   Dashboard reads CH+D1 (media buying)
```

### 4.2 Module layout (proposed, all new)

```
api/migrations/00NN_leadgen_core.sql                     (§7 — all leadgen_ tables)
api/migrations/00NN_leadgen_analytics_mirror.sql
api/migrations/00NN_leadgen_revenue_infra.sql
api/migrations/00NN_leadgen_conversion_dedupe.sql

api/src/leadgen/                       (shared logic — sibling of src/listicles/)
  ids.ts            public_id minting (lgo_/lgs_/lgq_/…)
  macros.ts         URL macro registry + {response:<path>} + validation
  payload.ts        dynamic payload schema types + builder + cleanObject + transforms
  auction-core.ts   floor/score/winner/backfill/dedupe (pure, unit-tested)
  rules.ts          region + answer + carrier rule evaluation (typed conditions)
  clickhouse.ts     CH HTTP read client (LeadGen copy)
  mirror-sync.ts    CH→D1 sync (syncLeadgenAnalytics)
  s2s-dispatch.ts   outbound S2S pixel (LeadGen copy)
  revenue-ingest.ts provider revenue → D1 raw + dedupe
  revenue-recon.ts  FX, unmatched re-match, provider reconciliation
  fx.ts             currency normalization
  validation.ts     Offer/Section/Quote/Auction validators
  invalidate.ts     cache invalidation per workflow

api/src/admin/leadgen/                 (admin — sibling of src/admin/listicles/)
  router.ts         JSON API  /api/admin/leadgen/*
  ui.ts             HTML shell /admin/leadgen/* (4 tabs)
  offers-handlers.ts / sections-handlers.ts / quotes-handlers.ts / auctions-handlers.ts
  media-platforms-handlers.ts / analytics-admin-handlers.ts
  payload-builder-handlers.ts (auto-from-example, test-request proxy)
  ui-offers.ts / ui-sections.ts / ui-quotes.ts / ui-auctions.ts / ui-shared.ts
  ui-payload-builder.ts / ui-question-builder.ts / ui-banner-builder.ts
  shared.ts / structure.ts / db-types.ts

api/src/public/leadgen/                (runtime — sibling of src/public/listicle/)
  serve.ts          funnel shell renderer (cacheable)
  resolver.ts       quote/version/variant resolution + activation lookup
  runtime.ts        client funnel engine (answers, transitions, A/B, tracking)
  ctx-inject.ts     request-context dims (device/os/geo/utm/click)
  ab-hash.ts        deterministic funnel-variant assignment
  answers.ts        answer normalization + value mapping
  auction/
    engine.ts       orchestration (gather → rules → payloads → fetch → evaluate → render)
    fetch.ts        per-Offer request (headers/token/endpoint/timeout)
    parse.ts        response parsing + carrier extraction
    winner.ts       winner logic (highest/avg/sum) + multi-offer/backfill/remove-clicked
    banner.ts       banner rendering (design registry)
    explain.ts      auction explainability log
  adapters/         (optional per-provider normalizers if a provider needs bespoke shape)
  click.ts          click resolver /lg/lc (macro + {response:*} + click_id mint)
  postback.ts       inbound provider postback /lg/pb/:provider
  designs/
    registry.ts     funnel + banner design registries
    default/{tokens,components,styles,tokens-to-css}.ts   (reference funnel design)
    banner-default/{tokens,components,styles}.ts

infra/leadgen/athena-ddl.sql / clickhouse-ddl.sql / aws-provision.md / clickhouse-apply.md / revenue-secrets.md
docs/leadgen/default-funnel-design-audit.md / traceability.md
```

### 4.3 Runtime route map (public `/lg/*`)

| Route | Method | Purpose | Cache |
|---|---|---|---|
| `/lg/:quote_slug` (and site-root activations) | GET | Render funnel shell for the activated Quote on this site; assign funnel variant; inject context. | KV-cached per `funnel_variant_id`+`content_version`+`template_version`; `public, max-age=300, swr=86400`. |
| `/lg/attempt` | GET | Mint/return `funnel_attempt_id` + session-bound `signed_config_token`. **no-store** (session-specific). | `no-store`. |
| `/lg/config/:funnel_variant_id` | GET | Client funnel config (sections, order, rules, design tokens, A/B) — server-only fields stripped. | `public, max-age=300, s-maxage=1800, swr`; ETag. |
| `/lg/track` | POST | Fire-and-forget event beacon → Firehose. Public, unauthenticated, `keepalive`/`sendBeacon`. | `no-store`. |
| `/lg/auction` | POST | Run the end-of-funnel auction for collected answers; return banners (+ obfuscated backfill). Dynamic. | `no-store`. |
| `/lg/lc` | GET | Click resolver: resolve macros (+ `{response:*}`), mint `click_id`, 302 to destination, emit `carrier_click`. | `no-store`. |
| `/lg/pb/:provider` | POST/GET | Inbound provider postback (revenue), token-gated per provider. | `no-store`. |
| `/lg/px/:token` | GET | Optional browser pixel/script conversion endpoint. | `no-store`. |

All `/lg/*` runtime is served on **tenant hosts** (never gated); admin is `ADMIN_HOST`-only. The `/lg` head is reserved so it never collides with the `publicRouter` `/:slug` catch-all (register before it, mirroring how `analyticsRouter` mounts before `publicRouter`).

---

## 5. CMS navigation design

### 5.1 Main nav

Add a new top-level CMS nav item **LeadGen** in the admin shell (`src/admin/templates/layout.ts` nav), positioned adjacent to the existing **Listicles** item, using the identical nav-item markup/active-state styling. It links to `/admin/leadgen`.

### 5.2 LeadGen sub-tabs (four — follows the Listicles three-tab pattern)

```
/admin/leadgen                → 302 /admin/leadgen/offers
/admin/leadgen/offers         Offers   — list + analytics + "Create an Offer"
/admin/leadgen/sections       Sections — list + analytics + "Create a Section"
/admin/leadgen/quotes         Quotes   — list + analytics + "Create a Quote" + site activation
/admin/leadgen/auction        Auction  — list + analytics + "Create an Auction"
```

Editor/detail shells (registered as they ship, static-before-param order):
```
/admin/leadgen/offers/new            /admin/leadgen/offers/:id/edit
/admin/leadgen/sections/new          /admin/leadgen/sections/:id/edit
/admin/leadgen/quotes/new            /admin/leadgen/quotes/:id/edit
/admin/leadgen/auction/new           /admin/leadgen/auction/:id/edit
```

### 5.3 UI conventions (MUST match existing CMS/Listicles)

- Same admin shell (`adminLayout`), same sidebar/nav style, same tab bar, same table/card/toolbar patterns, same modal behavior, same validation/error display, same analytics timeframe controls (`resolveTimeframe(range)`), same paging.
- Each tab: a **Create** button **top-left**, above analytics filters + timeframe controls (mirrors Listicles Offers exactly).
- HTML shells are **server-rendered** and drive the JSON API in-process (`apiJson(env, path)`), so XHR and SSR share one query path.
- Every response on `/admin/leadgen*` + `/api/admin/leadgen/*` is `private, no-store` + `X-Content-Type-Options: nosniff`, gated by `accessAuth`, and 404s off `ADMIN_HOST` — all inherited by mounting under the existing gate (no new auth code).
- **Reference screenshot** (`Screenshot 2026-07-05 at 20.04.58`) was not attached to this environment; nav/table/modal conventions are therefore specified by mirroring the live Listicles admin. If the operator supplies the screenshot, reconcile the toolbar layout to it before Phase 3 sign-off (open question OQ-1, §34).

### 5.4 Tab responsibilities (each tab does three jobs: Create / Manage / Analyze)

| Tab | Create | Manage | Analyze |
|---|---|---|---|
| **Offers** | Create-Offer modal (§10) | edit/archive, view Section attribution + Auction participation | Offer-level analytics (§10.6) |
| **Sections** | Section editor (§12–14) | edit/archive, view Quote usage | Section-level analytics (§20) |
| **Quotes** | Quote editor + funnel builder (§15) | edit/archive, funnel A/B, **site activation** (§17) | Funnel analytics (§24-quote) |
| **Auction** | Auction editor + banner builder (§18/§20) | edit/archive, participating Offers, rules | Auction analytics (§27) |
