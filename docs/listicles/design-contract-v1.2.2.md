# Listicles CMS — Engineering Design Contract

**Version:** v1.2.2 · **Status:** Not yet implemented · **Target repo:** `Gavri19H/kodigital-homepages-cms` · **Worker:** `kodigital-homepages-cms-worker`
**Stack:** Hono · Cloudflare D1 · R2 · KV/Cache-API · Kinesis Firehose → S3 → Athena · ClickHouse
**Audience:** LLM development agent. This Markdown is the authoritative, copy-safe source of truth (no PDF/OCR artifacts). The HTML edition is for human review only.

> **Enforced hierarchy (v1.1):**
> `Article (site-specific, stable URL) → Experiment (0..1 active) → Versions (whole-article A/B) → Pages (ordered; mode: single · A/B · rule-based) → Section candidates → Sections (global) → Offers (global)`
>
> Operator wording: **Offer** = monetization unit · **Section** = reusable content unit · **Article** = stable per-site URL · **Article Version** = a tested variant of the Article · **Page** = ordered position in a Version · **Page Candidate** = a Section option for that Page · **Selection Mode** = single / A/B / rule-based.

### Changelog
- **v1.0** — base contract (Offers, Sections, Articles→Pages, page-level A/B, tracking, ClickHouse→D1 mirror, revenue, pixels, GA4, caching).
- **v1.1** — added **article-level A/B** (Experiments + Versions; Pages belong to a Version; `lander_v` = rendered Version id) and **page selection modes** (single / ab_test / rule_based, with rule engine + conflict guard). Added a dedicated `offer_impression` event, real-time Offer cap counters + fallback, and per-version cached shells (hybrid caching).
- **v1.1.1 (this doc — consistency pass, no new scope):**
  1. `section_variant_id` / `listicle_page_variants` are gone from the live model; `section_variant_id` remains **only** as a documented backward-compat alias of `page_candidate_id`. Live tables use `listicle_page_section_candidates`.
  2. Fixed the ClickHouse Offer aggregate: non-empty `offer_id` filter, valid `FROM … JOIN … WHERE … GROUP BY` order, impressions counted from `offer_impression`.
  3. Article Version identity: running/published Versions are **immutable**; meaningful edits fork a new Version (new `article_version_id`/`lander_v`); `article_version_revision` (= `content_version`) is carried through Athena, ClickHouse, D1 mirrors, and drilldowns.
  4. Section fan-out invalidation path: `listicle_page_section_candidates → listicle_pages → listicle_article_versions → listicle_articles`.
  5. Governed click URLs + resolver context carry `article_public_id, article_version_id/lander_v, page_index, section_public_id, page_candidate_id, page_selection_mode, page_rule_id`.
  6. Full original attribution dims live in a ClickHouse session dimension table `lst_sessions` (`os_version, browser, browser_version, city, ip, ua, sub1–sub5, url, referer, language, cpc, fbc, fbclid`).
  7. `selection_reason`, `matched_rule_json_hash`, `page_rule_set_id` added to the D1 drilldown mirror.
  8. Rule condition types are typed (sets vs numeric ranges); conflict detection uses interval intersection for `hour`/`daypart`.
  9. Cache-safe rule context: `__LST_CTX` injected via post-cache `HTMLRewriter`; geo/device never in the cache key.
  10. Over-budget lazy hydration: above-the-fold candidates never post-paint hydrate; below-the-fold reserve dimensions (no CLS).
  11. Real cap fallback (fallback offer → fallback URL → `/`) with a one-hop loop guard.
  12. At most one running Article experiment per Article (partial unique index).
  13. Removed the circular `candidate.rule_id ↔ rule.candidate_id`: rules FK to candidates, one direction only.
- **v1.2 (default-layout parity + link-instance analytics — see §30 Addendum, which supersedes §14.2's illustrative tokens):** the default layout becomes a **measured** Senior-Saving baseline shipped as a token package (§30.1: ~968px body — not ~680px, 64px `#ce2e35` header, 226×36 logo slot, top-right Disclosure, byline row, 2:1 hero, measured type/spacing); logo is the only per-host brand swap and the host theme cannot override default tokens. Adds a byline data model, locked reference block presets + `ChoiceButtonGroup`/`FinalTextCta`/`LinkedImage`, CTA/Link Inventory + Page CTA Density, per-placement `listicle_section_link_instances` + link-instance analytics through Athena/ClickHouse/D1/resolver, preview requirements, and visual-regression acceptance. Lower-page + mobile + Disclosure-interaction tokens are explicit `BLOCKER`s that must be measured before Phase 6 acceptance.
- **v1.2.1 (consistency pass, no new scope):** wired `link_instance_id` (+ `section_block_id`, `link_role`, `link_position_index`, `button_style_id`, `button_group_id`, `anchor_text_hash`, `analytics_label`, `article_version_revision`) through the ClickHouse **revenue-attribution MV** and expanded `listicle_analytics_link_instance` (revision in the PK) so conversions/revenue attribute to the exact CTA; offer aggregate uses `notEmpty(offer_id)`; added `byline_json` to `listicle_article_versions`; defined **headline** link instances (`block_id = "__headline__"`, `link_role='headline'`, `position_index=0`) + validation; corrected “four”→**five** D1 mirrors (four entity + one link-instance CH target); clarified `lander_v` vs `content_version`/`article_version_revision`; refreshed `content_json` examples to the v1.2 block shapes; all pseudo-code uses `||` / `&&` / `===`.
- **v1.2.2 (final validation hardening, no new scope — see §31):** measurement protocol + provisional defaults for the §14.5/§30.4 layout blockers (contract does **not** claim 1:1 parity until the real captures land); exact visual-regression thresholds; a single canonical A/B hash (FNV-1a → basis points) for edge+client with test vectors; edge-injected `window._LST_SID`; `page_view_id` impression dedupe; strict section/offer impression semantics; durable event delivery (beacon→keepalive→retry queue, `event_id` idempotency, dead-letter, daily reconciliation); provider-revenue reconciliation (txn-id dedupe, unmatched-click queue, currency/timezone normalization, late-arrival backfill); bot/internal/preview filtering excluded from default A/B + revenue analytics; `lst_events_raw` carries `offer_id`/`click_id`/`analytics_label` + `page_view_id` + quality flags.

---

## 1. Executive summary

Build a new **Listicles** domain inside the existing `kodigital-homepages-cms` Worker that lets operators assemble advertorial listicles from globally-shared, reusable content, monetize every link through a governed Offer catalogue, experiment at the **article and page level** (A/B **and** rule-based targeting), and read back exact per-Offer / per-Section / per-Article / per-Version performance — while preserving the repo's caching, multi-tenant, and legacy-isolation contracts.

**Five pillars**
1. **Additive, non-destructive.** New `listicle_`-namespaced tables, new routes under `/api/admin/listicles/*` + `/lc` + `/api/lst/track` + `/api/pb/:provider`, and one new nav entry. No existing table/route/cache/GA4 behavior changes.
2. **Governed monetization.** Content links can only reference Offers (store `offer_id`, never a free-text URL). Live redirects run through a first-party click resolver that mints `click_id` and resolves macros server-side.
3. **Hybrid cache-aware experimentation.** Article-level A/B renders one fully-cacheable shell **per Version** (`lander_v`), chosen sticky at the edge; page-level A/B + rule candidates ride inside that shell and are selected before first paint (with edge-injected geo context for rules), under a strict payload budget.
4. **Attribution never lost.** Every event carries `session_id · click_id · lander_v · article_version_id · article_variant_id · page_index · page_selection_mode · page_candidate_id · page_rule_id · selection_reason · section_id · offer_id` + full traffic/geo/device dims.
5. **Mirror, don't query.** The CMS reads analytics only from D1 mirror tables; client events → Athena, provider revenue → ingestion, both → ClickHouse aggregation → D1 mirror → CMS.

> **Top guardrail:** In this repo, `insureprimo`, `theiwise.com`, `psychic-quiz`, `quotesRoutes`, `rental-booking`, and legacy CF-Access/D1/KV ids are **build-failing banned tokens** (CI: `verify:no-legacy-prod-refs`). Reuse the *pattern* of the legacy tracking/revenue logic but write fresh, neutrally-named code with **zero** banned identifiers. The only shared identifier allowed is the account id `a05d7505b71c6cd931e436defe670509`.

---

## 2. Repository findings

Mature multi-tenant Cloudflare Worker CMS. Server-rendered admin (Hono HTML template literals — **not React**), a block content editor, an AI authoring layer, a live Athena beacon, and a KV+Cache-API edge cache.

| Concern | Location | Finding |
|---|---|---|
| Worker entry | `api/src/index.ts` | Hono app; mount order preview → media → admin → newsletter → analytics (`/api/track`) → public (`/:slug`). Exports `scheduled` (cron every minute) + `queue` consumer. |
| Config | `api/wrangler.toml` | Bindings `DB` (D1), `CACHE` (KV), `MEDIA` (R2), `PROVISION_QUEUE`. Vars incl. `AWS_REGION`, `EVENTS_FIREHOSE_STREAM=homepage-events`, `HTML_CACHE_TTL_SECONDS`, OpenAI models. Account shared with dashboard. |
| Typed env | `api/src/env.ts` | `Env` interface + `parseBoolean/parseNumber`. AWS creds + OpenAI key optional (secrets) so tracking/AI no-op locally. |
| Admin router | `api/src/admin/router.ts` | HTML shell via `./ui`; JSON CRUD under `/api/admin/*`. All gated by `accessAuth`. |
| Public render | `api/src/public/` | router + templates (home, article, components, layout), view-models, `render-pages.ts`, `responsive-img.ts` (CF Images), `ads.ts`, seo-head + JSON-LD; host→site middleware. |
| Cache | `api/src/cache/` | cache-keys, cache-control, edge-cache (KV⇄Cache-API), invalidate, purge, warm. |
| Analytics | `api/src/analytics/` | `events.ts`, `firehose.ts` (aws4fetch → PutRecordBatch), `router.ts` (`POST /api/track`), `tracking-script.ts` (inline ES5 beacon). |
| Content editor | `api/src/editor/` | `content_json` (`{version, blocks:[]}`) → `content_html`; 11 block types incl. `affiliate` (already `rel="sponsored nofollow noopener"`); tag-whitelist `sanitize.ts` + `isSafeUrl`; images default `loading="lazy"`. |

**Admin conventions (must match):** left sidebar `NAV_ENTRIES` array (9 entries); tokens `--c-primary:#2563eb`, `.btn/.btn-primary/.btn-danger`, `.table`, `.badge-*`, `.card`, `.toolbar`, `.form-*`, `.empty-state`, `.stats-grid`, `.pagination`; globals `window.api/showToast/confirmDelete/generateSlug`. **Every inline admin `<script>` must be ES5** (asserted by `test/admin-layout-shell.test.ts`).

**Sibling `kodigital-dashboard`:** provides the ClickHouse conventions (raw → `REFRESH EVERY N MINUTE` MV → `ReplacingMergeTree(ver)`, `PARTITION BY toYYYYMM`, `LowCardinality`, `nullIf` ratio guards, `entity_snapshot`/`revenue_attributed` shapes) and the D1-mirror pattern (CH → D1 the app reads).

---

## 3. Existing patterns to reuse

| Need | Reuse / extend | Verdict |
|---|---|---|
| Admin shell/nav/styling | `admin/templates/layout.ts` (+1 NAV entry + sub-tab bar) | extend |
| List tables/filters/pager/delete | `renderListPager`, `listFilterScript`, `.toolbar`, `confirmDelete→api()→showToast` | reuse |
| Rich editing | `editor/` block model, `renderBlockEditorField`, `blockEditorMountScript`, `blocks.ts`, `sanitize.ts` | extend |
| AI text/image + presets | `ai-panel.ts`, `ai-api.ts`, `prompt_presets` | reuse |
| Image upload / AI image / lazy | `media-crud-handlers.ts`, R2 `MEDIA`, `responsive-img.ts`, `ai-image.ts` | reuse |
| Hero image | `hero-image.ts` card + script | reuse |
| Per-site scoping | `sites` table, `site_id`, site-required form pattern | reuse |
| Publish workflow + scheduling | `workflow/`, `workflow-panel.ts`, cron in `index.ts` | reuse |
| Edge cache + invalidation + versioning | `cache/`; `content_version`/`settings_version`/`TEMPLATE_VERSION` | reuse |
| Client beacon + Firehose | `analytics/` — `koTrack`, `emitEvents`, `sendToFirehose`, `parseDeviceOs` | extend |
| ClickHouse aggregation | dashboard `schema-clickhouse.sql` conventions | copy pattern |
| D1 mirror of CH + sync | dashboard mirror pattern | copy pattern |
| Provider revenue (S2S/API/script) | dashboard `revenue_*_raw` + attribution MV pattern (fresh, neutral names) | pattern only |
| Offer catalogue + governed links; Sections; Article→Version→Pages→Candidates builder; click resolver + macro engine; outbound S2S dispatcher | — | **new** |

---

## 4. New CMS navigation

One new primary nav entry **Listicles** (insert into `NAV_ENTRIES` after *Pages*; add `ICON_LISTICLES`). Three sub-tabs via a shared `renderListiclesTabs(active)` helper: **Offers · Sections · Articles**.

HTML shell routes (register on `adminUi`, inherit `accessAuth` + `ADMIN_HOST`):
```
GET /admin/listicles                      → 302 /admin/listicles/offers
GET /admin/listicles/offers               → Offers list + analytics + "Create an Offer"
GET /admin/listicles/sections             → Sections list + analytics + "Create Section"
GET /admin/listicles/sections/new|/:id/edit → Section rich editor
GET /admin/listicles/articles             → Articles list (site-scoped) + analytics
GET /admin/listicles/articles/new|/:id/edit → Article builder (Versions + Pages + A/B/rules)
```
Offers & Sections are **global** (no site filter). Articles are **per-site** (require the site select, reusing the "Site is required" gate).

---

## 5. Data model

Nine core entities + a derived attribution index + a real-time cap counter + four analytics mirrors. Ownership is structural: Offers & Sections have **no** `site_id`; Articles do. Article content lives on **Versions**; Pages carry a `selection_mode` and hold **Section candidates** (A/B variants or rule targets).

**ID strategy.** Every entity keeps `INTEGER PRIMARY KEY AUTOINCREMENT` for internal FKs and a stable `public_id TEXT UNIQUE` (`off_/sec_/art_/exp_/ver_/pg_/cand_/rule_` + ULID). `public_id` is the value exposed in macros (`{offer_id}`, `{lander_v}`), in every tracked event, and as the analytics join key. **`lander_v` ≡ the rendered Article Version's `public_id`** (`ver_…`).

### 5.1 Relationships
```
listicle_offers 1 —< listicle_section_offers >— N listicle_sections            (M:N governed link graph)
sites 1 —< listicle_articles 1 —< listicle_article_experiments                 (0..1 running per article)
listicle_articles 1 —< listicle_article_versions   (headline·intro·hero·layout·alloc·lander_v; page order per version)
listicle_article_versions 1 —< listicle_pages (page_index, selection_mode) 1 —< listicle_page_section_candidates >— listicle_sections
listicle_page_section_candidates 1 —< listicle_page_rules  (priority, conditions_json; rules FK to candidates, ONE direction; rule_based only)
listicle_offers 1 —< listicle_offer_cap_counters (per offer per cap-day)
```

### 5.2 Canonical shapes (TypeScript; D1 columns in §6)
```ts
interface Offer {              // GLOBAL — no site_id
  id: number; public_id: string;          // "off_…"
  offer_name: string; provider: string; activity: string; vertical: string; tag?: string;
  conversion_tracking_method: 's2s_postback' | 'browser_side_pixel' | 'script';
  offer_url_template: string;             // provider URL incl. {macros}
  payout_method: 'in_site' | 'offsite';
  payout_currency?: string; payout_value?: number;      // required iff in_site
  cap_enabled: boolean;
  cap_amount?: number; cap_timezone?: string; cap_count_by?: 'clicks' | 'conversions';
  cap_fallback_offer_id?: number; cap_fallback_url?: string;   // where to send when capped
  status: 'active' | 'paused' | 'archived'; created_at: number; updated_at: number;
}

interface Section {            // GLOBAL — no site_id
  id: number; public_id: string;          // "sec_…"
  section_name: string;
  headline: { text: string; offer_id?: number };        // clickable ⇒ offer_id, never a URL
  image?: { type: 'image'|'gif'|'ai_generated'; media_id?: number; url?: string; ai_prompt?: string };
  ai_settings?: { preset_id?: number; prompt?: string };
  content_json: string; content_html?: string;
  content_version: number; status: 'active' | 'archived';
}

// Article splits into a stable base + Experiment + Versions
interface Article {            // PER-SITE — identity & URL only
  id: number; public_id: string;          // "art_…"
  site_id: string; slug: string;          // UNIQUE(site_id, slug) — the public URL
  article_name: string;                   // internal
  status: 'draft' | 'published' | 'scheduled' | 'archived';
  active_experiment_id?: number;          // 0..1 running article-level A/B
  versions: ArticleVersion[];             // ≥ 1 (control when no experiment)
}
interface ArticleExperiment {  // article-level A/B test
  id: number; public_id: string;          // "exp_…" == article_experiment_id
  article_id: number; name: string;
  status: 'draft' | 'running' | 'stopped'; created_at: number;
}
interface ArticleVersion {     // a tested whole-article variant
  id: number; public_id: string;          // "ver_…" == lander_v == article_version_id
  article_id: number; experiment_id?: number;
  variant_label: string;                  // 'A','B',… == article_variant_label
  is_control: boolean; traffic_allocation: number;   // 0-100; per-experiment Σ == 100
  headline: string; intro_paragraph: string;
  hero_media_id?: number; hero_media_url?: string;
  layout_style_id: string;
  ai_settings?: { preset_id?: number; prompt?: string };
  content_version: number;                // == article_version_revision in analytics; running versions immutable (§15.6)
  pages: Page[];
}

interface Page {               // belongs to an ArticleVersion
  id: number; public_id: string; article_version_id: number;
  page_index: number;                     // 0-based order within the Version
  selection_mode: 'single' | 'ab_test' | 'rule_based';
  ab_test_id?: string;                    // set when ab_test
  rule_set_id?: string;                   // set when rule_based == page_rule_set_id
  candidates: PageSectionCandidate[];     // ≥ 1
}
interface PageSectionCandidate {   // generalises the old PageVariant
  id: number; public_id: string;          // "cand_…" == page_candidate_id
                                          //   (section_variant_id = backward-compat ALIAS of page_candidate_id)
  page_id: number; section_id: number; label: string;   // 'A','B',…
  traffic_allocation?: number;            // ab_test only; per-page Σ == 100
  is_fallback: boolean;                   // rule_based only: exactly one catch-all per page
  // NB: candidates hold NO rule_id — rules point AT candidates (one direction)
}
interface PageRule {           // rule_based targeting — OWNS the candidate↔rule link (one direction)
  id: number; public_id: string; page_id: number;
  candidate_id: number;                   // FK → the candidate this rule serves (UNIQUE: 1 rule per candidate)
  priority: number;                       // lower = evaluated first (the ONLY priority)
  conditions_json: string;                // typed: { sets:{…}, ranges:{hour|daypart} } (§15.4)
  conditions_hash: string;                // == matched_rule_json_hash in analytics
  // fallback is a candidate flag, NOT a rule row
}
// OfferCapCounter (real-time cap store, §9): { offer_id, cap_date, timezone, click_count, conversion_count }
```

### 5.3 Lifecycle & deletion
| Entity | Create | Delete |
|---|---|---|
| Offer | modal → validate → insert; mint `public_id` | refuse hard delete when used by any `listicle_section_offers` row (409 + usage); prefer `status='archived'` |
| Section | editor → validate → render `content_html` → rebuild `listicle_section_offers` | refuse delete when referenced by any `listicle_page_section_candidates`; else soft-archive; edits fan-out invalidate (§22.2) |
| Article | create base (site+slug) → auto-create one control Version → build its Pages/candidates in a txn | hard delete cascades experiments → versions → pages → candidates → rules; mirror rows retained (keyed by `public_id`) |
| Experiment / Version | add a Version; set allocations; start experiment (→running) | stopping keeps versions + history; a version referenced by analytics is archived, not purged; promote-winner clones winner to control |
| Page / Candidate / Rule | nested writes inside the Version save; conflict guard on rule_based pages | cascade with the Version |

### 5.4 Usage / attribution lookups
```sql
-- Offer → Sections (attribution to Sections)
SELECT s.* FROM listicle_section_offers so JOIN listicle_sections s ON s.id=so.section_id WHERE so.offer_id=?;
-- Section → Offers
SELECT o.* FROM listicle_section_offers so JOIN listicle_offers o ON o.id=so.offer_id WHERE so.section_id=?;
-- Section → Articles/Versions/Pages (usage)
SELECT DISTINCT a.*, ver.public_id, p.page_index
FROM listicle_page_section_candidates c
JOIN listicle_pages p ON p.id=c.page_id
JOIN listicle_article_versions ver ON ver.id=p.article_version_id
JOIN listicle_articles a ON a.id=ver.article_id
WHERE c.section_id=?;
```
`listicle_section_offers` is **derived state**: deleted-and-rebuilt inside the Section-save transaction by scanning the headline `offer_id` + every `button`/`offerlink` in `content_json`.

---

## 6. D1 schema & migrations

Additive only, continuing repo numbering (last applied `0030`). Conventions: `INTEGER PRIMARY KEY AUTOINCREMENT`, `unixepoch()`, `CHECK` enums, `ON DELETE CASCADE`, `idx_<table>_<cols>`. `wrangler d1 migrations apply` auto-discovers new files.

| File | Contents |
|---|---|
| `0031_listicles_core.sql` | offers (+cap fallback), sections, section_offers, articles (base), article_experiments, article_versions, pages (+selection_mode), page_section_candidates, page_rules, offer_cap_counters + indexes |
| `0032_listicles_analytics_mirror.sql` | 4 read-only D1 mirror tables (offer / section / article-by-version / drilldown w/ version+rule dims) |
| `0033_listicles_revenue_infra.sql` | media_platforms, postback_log, revenue_raw staging (Phase 9) |

```sql
-- 0031_listicles_core.sql

-- GLOBAL: Offers (no site_id)
CREATE TABLE IF NOT EXISTS listicle_offers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,                 -- {offer_id} macro + analytics key
  offer_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  activity TEXT NOT NULL,
  vertical TEXT NOT NULL,
  tag TEXT,
  conversion_tracking_method TEXT NOT NULL
    CHECK (conversion_tracking_method IN ('s2s_postback','browser_side_pixel','script')),
  offer_url_template TEXT NOT NULL,
  payout_method TEXT NOT NULL CHECK (payout_method IN ('in_site','offsite')),
  payout_currency TEXT,                            -- required iff in_site (app-validated)
  payout_value REAL,                               -- required iff in_site
  cap_enabled INTEGER NOT NULL DEFAULT 0,
  cap_amount INTEGER, cap_timezone TEXT,
  cap_count_by TEXT CHECK (cap_count_by IN ('clicks','conversions')),
  cap_fallback_offer_id INTEGER REFERENCES listicle_offers(id),  -- redirect target when capped
  cap_fallback_url TEXT,                           -- or a static fallback URL
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_listicle_offers_status   ON listicle_offers(status);
CREATE INDEX IF NOT EXISTS idx_listicle_offers_vertical ON listicle_offers(vertical, activity);

-- GLOBAL: Sections
CREATE TABLE IF NOT EXISTS listicle_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  section_name TEXT NOT NULL,
  headline_text TEXT NOT NULL,
  headline_offer_id INTEGER REFERENCES listicle_offers(id),   -- nullable; clickable headline
  image_json TEXT,                                 -- {type,media_id?,url?,ai_prompt?}
  content_json TEXT NOT NULL,                      -- block document
  content_html TEXT,
  ai_settings_json TEXT,
  content_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Derived attribution index (rebuilt on every Section save)
CREATE TABLE IF NOT EXISTS listicle_section_offers (
  section_id INTEGER NOT NULL REFERENCES listicle_sections(id) ON DELETE CASCADE,
  offer_id   INTEGER NOT NULL REFERENCES listicle_offers(id),
  link_role  TEXT NOT NULL CHECK (link_role IN ('headline','inline','button')),
  occurrences INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (section_id, offer_id, link_role)
);
CREATE INDEX IF NOT EXISTS idx_listicle_secoffers_offer ON listicle_section_offers(offer_id);

-- PER-SITE: Articles — STABLE BASE ONLY (identity + URL). Content lives on versions.
CREATE TABLE IF NOT EXISTS listicle_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  site_id TEXT NOT NULL,                            -- FK to sites(id); confirm type (§28 Q2)
  slug TEXT NOT NULL,                               -- the public URL
  article_name TEXT NOT NULL,                       -- internal
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','published','scheduled','archived')),
  active_experiment_id INTEGER,                     -- 0..1 running article-level A/B
  published_at INTEGER, scheduled_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (site_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_listicle_articles_site ON listicle_articles(site_id, status, published_at);

-- Article-level A/B experiment (0..1 active per Article)
CREATE TABLE IF NOT EXISTS listicle_article_experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,             -- == article_experiment_id
  article_id INTEGER NOT NULL REFERENCES listicle_articles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','stopped')),
  started_at INTEGER, stopped_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Enforce at most ONE running experiment per Article (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS uq_listicle_experiment_running
  ON listicle_article_experiments(article_id) WHERE status = 'running';

-- Article VERSIONS — the A/B'd whole-article content. public_id == lander_v.
CREATE TABLE IF NOT EXISTS listicle_article_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,             -- "ver_…" == lander_v == article_version_id
  article_id INTEGER NOT NULL REFERENCES listicle_articles(id) ON DELETE CASCADE,
  experiment_id INTEGER REFERENCES listicle_article_experiments(id) ON DELETE SET NULL,
  variant_label TEXT NOT NULL DEFAULT 'A',    -- article_variant_label
  is_control INTEGER NOT NULL DEFAULT 1,
  traffic_allocation INTEGER NOT NULL DEFAULT 100,  -- per-experiment Σ == 100
  headline TEXT NOT NULL,                     -- per-version public content
  intro_paragraph TEXT NOT NULL,
  hero_media_id INTEGER REFERENCES media(id), hero_media_url TEXT,
  layout_style_id TEXT NOT NULL DEFAULT 'default',
  byline_json TEXT,                            -- v1.2 ArticleVersionByline (§30.2): author/avatar/label/updated
  ai_settings_json TEXT,
  content_version INTEGER NOT NULL DEFAULT 1,  -- == article_version_revision; running versions IMMUTABLE →
                                               -- meaningful edits FORK a new version (new lander_v); part of cache key (§15.6)
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_listicle_versions_article ON listicle_article_versions(article_id, status);

-- Pages (ordered positions inside a VERSION) + selection mode
CREATE TABLE IF NOT EXISTS listicle_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  article_version_id INTEGER NOT NULL REFERENCES listicle_article_versions(id) ON DELETE CASCADE,
  page_index INTEGER NOT NULL,
  selection_mode TEXT NOT NULL DEFAULT 'single'
    CHECK (selection_mode IN ('single','ab_test','rule_based')),
  ab_test_id TEXT,                                 -- set when ab_test
  rule_set_id TEXT,                                -- set when rule_based (== page_rule_set_id)
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (article_version_id, page_index)
);

-- Section CANDIDATES per Page (A/B variant OR rule target)
CREATE TABLE IF NOT EXISTS listicle_page_section_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,             -- == page_candidate_id (section_variant_id = backward-compat alias)
  page_id INTEGER NOT NULL REFERENCES listicle_pages(id) ON DELETE CASCADE,
  section_id INTEGER NOT NULL REFERENCES listicle_sections(id),
  label TEXT NOT NULL DEFAULT 'A',
  traffic_allocation INTEGER,                      -- ab_test only; per-page Σ == 100 (NULL otherwise)
  is_fallback INTEGER NOT NULL DEFAULT 0,          -- rule_based only: exactly one catch-all per page
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (page_id, section_id)
);                                                 -- NB: no rule_id here — rules FK to candidates (one direction)
CREATE INDEX IF NOT EXISTS idx_listicle_cand_section ON listicle_page_section_candidates(section_id);

-- Rules for rule_based candidates (audience targeting + conflict guard source)
CREATE TABLE IF NOT EXISTS listicle_page_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,             -- == page_rule_id
  page_id INTEGER NOT NULL REFERENCES listicle_pages(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL UNIQUE REFERENCES listicle_page_section_candidates(id) ON DELETE CASCADE,  -- 1 rule per candidate; ONLY link direction
  priority INTEGER NOT NULL DEFAULT 100,       -- the only priority (rule-level)
  conditions_json TEXT NOT NULL,               -- typed: {"sets":{country,state,city,device,os,browser,traffic_source,placement,utm_*,language,sub1..5},"ranges":{"hour":[s,e]}|"daypart":[…]}
  conditions_hash TEXT NOT NULL,               -- == matched_rule_json_hash in analytics
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);                                             -- fallback candidates have NO rule row (is_fallback on candidate)
CREATE INDEX IF NOT EXISTS idx_listicle_rules_page ON listicle_page_rules(page_id, priority);

-- Real-time Offer cap counters (§9) — resolver reads/increments synchronously
CREATE TABLE IF NOT EXISTS listicle_offer_cap_counters (
  offer_id INTEGER NOT NULL REFERENCES listicle_offers(id) ON DELETE CASCADE,
  cap_date TEXT NOT NULL,                          -- 'YYYY-MM-DD' in the offer's cap_timezone
  timezone TEXT NOT NULL,
  click_count INTEGER NOT NULL DEFAULT 0,
  conversion_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (offer_id, cap_date)
);
```

```sql
-- 0032_listicles_analytics_mirror.sql  (read-only in CMS; written only by the mirror sync, §18)
CREATE TABLE IF NOT EXISTS listicle_analytics_offer (
  offer_public_id TEXT NOT NULL, date TEXT NOT NULL,        -- 'YYYY-MM-DD'
  impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0,
  unique_clicks INTEGER NOT NULL DEFAULT 0, conversions INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0, synced_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (offer_public_id, date)
);
CREATE TABLE IF NOT EXISTS listicle_analytics_section (
  section_public_id TEXT NOT NULL, date TEXT NOT NULL,
  impressions INTEGER, clicks INTEGER, unique_clicks INTEGER, conversions INTEGER,
  revenue REAL, synced_at INTEGER, PRIMARY KEY (section_public_id, date));
CREATE TABLE IF NOT EXISTS listicle_analytics_article (
  article_public_id TEXT NOT NULL, article_version_id TEXT NOT NULL DEFAULT '',   -- per-version rows (== lander_v)
  article_version_revision INTEGER NOT NULL DEFAULT 1,     -- == version content_version
  article_experiment_id TEXT DEFAULT '', article_variant_label TEXT DEFAULT '',
  article_split_percentage INTEGER, date TEXT NOT NULL,
  total_visits INTEGER, unique_visits INTEGER, impressions INTEGER,
  clicks INTEGER, unique_clicks INTEGER, conversions INTEGER, revenue REAL,
  synced_at INTEGER,
  PRIMARY KEY (article_public_id, article_version_id, article_version_revision, date));  -- pps = impressions/total_visits (read-time)
CREATE TABLE IF NOT EXISTS listicle_analytics_drilldown (
  article_public_id TEXT NOT NULL, article_version_id TEXT NOT NULL DEFAULT '',
  article_version_revision INTEGER NOT NULL DEFAULT 1,
  article_experiment_id TEXT DEFAULT '', article_split_percentage INTEGER,
  page_index INTEGER NOT NULL, page_selection_mode TEXT DEFAULT 'single',
  section_public_id TEXT NOT NULL, page_candidate_id TEXT NOT NULL,   -- section_variant_id = backward-compat alias
  ab_test_id TEXT, page_rule_set_id TEXT DEFAULT '', page_rule_id TEXT DEFAULT '', page_rule_priority INTEGER,
  selection_reason TEXT DEFAULT '', matched_rule_json_hash TEXT DEFAULT '',   -- read straight from events
  traffic_allocation INTEGER, date TEXT NOT NULL,
  impressions INTEGER, clicks INTEGER, unique_clicks INTEGER, conversions INTEGER,
  revenue REAL, visits INTEGER, matched_sessions INTEGER, fallback_sessions INTEGER, synced_at INTEGER,
  PRIMARY KEY (article_public_id, article_version_id, article_version_revision, page_index, page_candidate_id, date));
CREATE INDEX IF NOT EXISTS idx_lst_drill_article ON listicle_analytics_drilldown(article_public_id, article_version_id, date);
```

Migration `0033` (Phase 9) adds `listicle_media_platforms`, `listicle_postback_log`, `listicle_revenue_raw` (§19–20). Acceptance tests follow the repo's `acceptance-tests/…phase*` shell pattern (one `Txx_*.sh` per column/index assertion).

---

## 7. API / route design

New Hono sub-router `listicleApi` under `/api/admin/listicles/*` (inside Access). JSON envelope: success → resource; failure → `{ error, fields? }` (4xx).

### 7.1 Admin CRUD (gated by `accessAuth`, `ADMIN_HOST` only)
```
GET    /offers                    list + filters + pager   (?search,provider,vertical,activity,status,page)
POST   /offers                    create (validation §23; mints public_id)
GET    /offers/:id                detail (+ usage count)
PATCH  /offers/:id                update (allow-list of columns)
DELETE /offers/:id                delete → 409 {error, usage:[…]} if in use
GET    /offers/:id/usage          attribution to Sections
GET    /offers/search?q=          picker feed (active only; ≤50)
GET    /offers/:id/analytics      offer metrics (D1 mirror)

Sections — same verbs; extra: GET /:id/usage, GET /:id/offers, GET /:id/analytics.
POST/PATCH re-render content_html + rebuild section_offers; DELETE 409 if used in a candidate.

GET    /articles?site_id=                 list (site-scoped)
POST   /articles                          create base + control Version (txn)
PATCH  /articles/:id                      update base (site/slug/name/status)
POST   /articles/:id/experiments          start article-level A/B (Version allocations Σ=100)
PUT    /versions/:id                      save a Version (txn: version+pages+candidates+rules); A/B + rule-conflict validation
POST   /pages/:id/validate                rule conflict check (pre-save) → conflict matrix / 400 report
GET    /articles/:id/structure            versions + pages + candidates + section names
GET    /articles/:id/analytics            summary row (D1 mirror)
GET    /articles/:id/drilldown            version→page→candidate breakdown (§11.6)
POST   /articles/:id/publish              publish via existing workflow → invalidate + warm
```

### 7.2 Public surface
```
GET  /:slug                render published listicle (host→site)   cache: public, max-age=300, SWR=86400 + ETag
GET  /lc/:offer_public_id  click resolver: mint click_id → macros → fire event → 302   cache: private, no-store
POST /api/lst/track        listicle beacon (richer schema §16)     204, fire-and-forget
POST /api/pb/:provider     inbound S2S postback (token-guarded §19) 200/idempotent
```
Governed content links render as first-party URLs carrying full context (never the provider URL):
```
/lc/{offer_public_id}?a={article_public_id}&lv={lander_v}&p={page_index}&s={section_public_id}&c={page_candidate_id}&m={page_selection_mode}&r={page_rule_id}
```

### 7.3 Click resolver + cap fallback (pseudo-code)
```js
listicle.get("/lc/:oid", async (c) => {
  const dest = await resolveDestination(c, c.req.param("oid"), 0);  // depth 0
  return c.redirect(dest.url, 302);
});

// mints click, resolves macros, applies cap fallback with a HARD loop guard
async function resolveDestination(c, offer_pid, depth) {
  if (depth > 1) return { url: "/" };                       // loop guard: at most ONE fallback hop
  const offer = await getActiveOfferByPublicId(c.env, offer_pid);
  if (!offer) return { url: "/" };                          // fail safe, never 500 a click
  if (await isCapReached(c.env, offer)) {                   // reads listicle_offer_cap_counters (§9.3)
    if (offer.cap_fallback_public_id)                       // → fallback OFFER, re-resolved once
      return resolveDestination(c, offer.cap_fallback_public_id, depth + 1);
    return { url: offer.cap_fallback_url || "/" };          // → fallback URL → safe "/"
  }
  const ctx = readCtx(c);                                   // ko_sid + ko_ctx cookie + CF geo/ua
  const q = c.req.query();                                  // a, lv, p, s, c(=candidate), m(=mode), r(=rule)
  const click_id = uuid();
  if (offer.cap_enabled && offer.cap_count_by === "clicks")
    await bumpCapClicks(c.env, offer);                      // synchronous increment BEFORE redirect
  const url = resolveMacros(offer.offer_url_template, { ...ctx,
     click_id, offer_id: offer.public_id, offer_name: offer.offer_name,
     article_id: q.a, lander_v: q.lv, page: q.p, section_id: q.s,
     page_candidate_id: q.c, page_selection_mode: q.m, page_rule_id: q.r });
  emitListicleEvent(c.env, c.executionCtx, buildClickEvent(ctx, offer, click_id, q));  // offer_click carries full context
  return { url };
}
```

---

## 8. Frontend / admin UI

Built from existing admin primitives (indistinguishable from Articles/Pages). Shared anatomy: `adminLayout` → page-title "Listicles" → `renderListiclesTabs(active)` → `.toolbar` (**+ Create…** top-left, then search, filters, timeframe) → `.card > .table` (mgmt + analytics columns + row actions) → `renderListPager()`.

- **Analytics loading:** mgmt columns render server-side (D1 core); analytics columns hydrate via async `window.api('GET', …/analytics?from&to)` after paint (skeleton shimmer per cell).
- **States:** Empty (`.empty-state` + CTA) · Loading (skeleton) · Save (`Saving…` → toast + redirect) · Validation (inline `.form-error` + top `.alert-error` + `aria-live` focus) · Error (`showToast('error')`, inline "—" + retry) · Blocked delete (409 "in use" dialog + "Archive instead") · Unsaved changes (`beforeunload` guard).
- **Ratios (read-time, `nullIf` guarded):** `ctr=clicks/impressions`, `cvr=conversions/clicks`, `rpc=revenue/clicks`, `rpm=revenue/impressions*1000`, `pps=impressions/total_visits`.

---

## 9. Offer management

Offers tab = create / manage / analyze. Toolbar top-left: **+ Create an Offer** (opens modal, does not navigate), then search, filters (provider·vertical·activity·status), timeframe.

**Management table:** Offer name · Provider · Vertical · Activity · Tracking method · Payout · Cap · Status + analytics (impressions · clicks · unique_clicks · conversions · ctr · cvr · revenue · rpc · rpm). Row actions: Edit · Delete (409-guarded) · **View attribution to Sections** · Analytics.

**Create/Edit modal fields:** offer_name*, provider*, activity*, vertical*, tag, conversion_tracking_method* (`S2S postback`/`Browser-side pixel`/`Script`), offer_url_template* (+ macro chips), payout_method* (`In-site`→currency+value / `Offsite`), offer cap* (toggle → amount + timezone + count_by + **fallback offer/URL**).

Tracking-method semantics: **S2S postback** = offline provider conversions matched on `{click_id}` via `POST /api/pb/:provider`; **Browser-side pixel** = CPC/CPL converting on our page; **Script** = API/email/report/scheduled import (neutral re-implementation, no banned identifier).

### 9.3 Offer-impression semantics & cap enforcement
- **Offer impressions ≠ Section impressions.** A Section can carry several Offers, so CTR breaks if Offer impressions derive from Section impressions. Fire a dedicated **`offer_impression`** event when a *specific governed link/button/headline becomes visible* (IntersectionObserver per governed anchor). Offer analytics count `offer_impression`; Section analytics count `section_impression`. Offer impressions are **not** back-derived through the Section→Offer index.
- **Real-time cap counters + fallback.** Mirrors lag, so caps read `listicle_offer_cap_counters` keyed `(offer_id, cap_date-in-tz)`:
  - `cap_count_by='clicks'` → `/lc` increments `click_count` and checks it **before** redirecting.
  - `cap_count_by='conversions'` → postback/API/script ingestion increments `conversion_count`.
  - When capped: redirect to `cap_fallback_offer_id` (re-resolved **once** — hard loop guard, no chains) → else `cap_fallback_url` → else `/`.
  - D1 atomic `UPDATE … SET click_count=click_count+1` is the baseline; hot Offers can use a Durable Object single-writer (§28 Q5).

### 9.4 Macro registry (33 tokens)
`{click_id} {utm_medium} {utm_content} {utm_source} {traffic_source} {placement} {lander_v} {offer_id} {offer_name} {page} {device} {os} {os_version} {browser} {browser_version} {country} {state} {city} {ip} {ua} {sub1}-{sub5} {url} {referer} {language} {cpc} {session_id} {fbc} {fbclid}`
- Clickable macro chips insert tokens at the caret. Canonical is `{click_id}`; on save, normalize alias `{clickid}→{click_id}` and **reject/warn** unknown macros. Resolver also accepts the alias at runtime.
- Landing-time macros (utm_*, traffic_source, placement, cpc, fbclid, fbc, lander_v, sub1–5, language) are captured on load into the first-party `ko_ctx` cookie; request-time macros (geo, device/os, ip, ua) come from CF `cf` + `parseDeviceOs`.

---

## 10. Section management

A Section is a reusable rich-content unit shared globally (≈ one "sub-headline page"). Tab = create / manage / analyze.

Create structure: section_name, image/GIF/AI image, headline* (optionally clickable → Offer modal → `headline_offer_id`), AI section (presets), rich content wizard (§12), Offer attribution for every link.

Management table: name · #offers · #articles using · updated · status + analytics. Actions: Edit · Delete (409 if used) · View usage in Articles · View Offers used · Analytics.

**Section analytics track by `section_id`** (not Offer/Article): a Section rolls up across every Article/Version/Page it appears in. Event schema carries `section_id` on every impression/click.

---

## 11. Article management

Article = stable URL; content lives on **Versions** that can be A/B tested. Tab = create / manage / analyze; drilldown by **Version → Page → Section candidate**.

**Fields — base vs Version:**
- Article (base): Site*, Article name, Slug (`UNIQUE(site_id,slug)`).
- Each Version: Headline*, Intro*, Hero image*, Layout style*, Page order/composition; AI presets.
- Creating an Article auto-creates one **control Version** (label A, 100%, `is_control`). Versioning stays invisible until a second Version is added.

**Experiment & Versions:** "A/B this Article" creates a `listicle_article_experiment` + Versions (each with a traffic %; live Σ must = 100). Each Version's `public_id` is its `lander_v` (§15.2).

**Pages builder + selection mode:** each Page is `single` / `ab_test` (candidates + traffic %) / `rule_based` (candidates + rules + one fallback). Save rules in §23.

**Actions:** Edit · Delete · View structure (read-only) · View Versions · View A/B split · Analytics.

**Summary row:** article_id · article_name · total_visits · unique_visits · impressions · impressions_per_session (pps) · clicks · unique_clicks · conversions · ctr · cvr · revenue · rpc · rpm. The URL total sums across Versions; group by `article_variant_id`/`lander_v` to compare Versions.

**Drilldown (`+`):** Version → Page (selection_mode) → candidate (A/B variant or matched rule / fallback). Metrics per row: impressions · clicks · unique_clicks · conversions · ctr · cvr · revenue · rpc · rpm; rule rows add matched_sessions · fallback_sessions · rule_match_rate. Rows key on `article_version_id + page_candidate_id + ab_test_id`/`page_rule_id`, so article-A/B, page-A/B, and rules are all cleanly comparable.

---

## 12. Rich content editor

Extends the existing block editor (`editor/`); keeps `content_json → content_html`, per-block inline `data.html`, the tag-whitelist sanitizer, and the mount/scripts contract.

**Block additions:** `list` gains `marker: 'disc'|'dash'|'ordered'|'check'|'emoji'` (+`emoji`); new `button` (`{text, style, align, offer_id}`); `affiliate` free-text URL removed → `offer_id` binding; new inline `offerlink` mark (`<a data-offer="off_…">`, no `href` stored).

**Links store the Offer, not the URL.** Buttons and inline links store `offer_id` as `data-offer`. The live Article renderer (which alone knows page_index/section/candidate) rewrites each governed anchor into the `/lc/{offer}?…` URL (§7.2) at render time.

**Toolbar:** Bold · Italic · Text colour · Background/highlight (curated tokens) · Convert selection → link (Offer modal) · list markers (disc/dash/ordered/check/emoji) · Button (Offer modal) · Image in block · Emoji library · inline AI.

On save: validate every `data-offer` + `button.offer_id` references an active Offer, then rebuild `listicle_section_offers`. Governed anchors render `rel="sponsored nofollow noopener"`. Media default `loading="lazy"` (except the lead image), via `responsive-img.ts`. Editor script stays ES5.

---

## 13. Offer-selection modal

The single reusable component enforcing "no free-text URL". Triggers: clickable headline toggle, inline-link toolbar action (no URL input exists), button's Offer field.

Anatomy: debounced search over name/provider/vertical/activity → `GET /offers/search?q=` (active, ≤50); quick filters + recently-used pinned; compact result rows (name · provider · vertical · payout · Select); "＋ New Offer" opens Create-Offer inline and returns pre-selected. Keyboard: search focus → ↑/↓ → Enter selects → Esc closes.

**Invariant:** the modal returns only an Offer reference; a link/button without an Offer cannot be saved (blocks Section save) — the structural guarantee behind rules 7–9.

---

## 14. Layout / style system

Articles render through a pluggable layout registry; the `default` layout reproduces the reference advertorial 1:1 (type, spacing, gaps, button style, content width, hierarchy) as scoped tokens, not hardcode.
```ts
export interface ListicleLayout {
  id: string; name: string; cssVars: Record<string,string>;
  renderShell(vm): string;                 // headline / intro / hero wrapper (per Version)
  renderPage(page, chosenCandidateHtml): string;
  renderSection(sectionHtml): string;
}
export const LAYOUTS = { default: defaultLayout /* … */ };
export function getLayout(id) { return LAYOUTS[id] ?? LAYOUTS.default; }  // unknown id → default
```
`layout_style_id` is per-Version. Tokens live on `[data-layout="default"]` and are the **measured** package in **§30.1** (`defaultListicleLayoutTokens` — ~968px body, not ~680px) so they never leak into admin or existing pages. Original tokenized layout — no third-party brand assets reproduced.

---

## 15. Experimentation & rules

Two layers, both sticky/deterministic/cache-aware/measurable.

| Layer | Tests | Selection | Render/cache |
|---|---|---|---|
| **Article-level A/B** | whole Versions (headline, intro, hero, layout, page order/composition) | edge, sticky per `session_id` | one cached shell **per Version** (cache key includes `lander_v`) |
| **Page A/B** | Section candidates on one Page | client, deterministic hash | candidates inside the Version shell (budgeted) |
| **Page rule-based** | which Section a Page serves to which audience | client, rule match (edge-injected geo/ctx) | candidates inside the shell; media not loaded until revealed |

### 15.2 Article-level A/B — per-Version cached shells
Linear arm count (2–3 Versions) ⇒ pre-render each Version to its own cached shell keyed by `lander_v`. The Worker reads `ko_sid`, computes a sticky assignment over the running experiment's allocations, sets/echoes `ko_ver`, serves that Version's cached shell.
```js
const sid = readCookie(req, 'ko_sid') || genId();
const exp = article.active_experiment;              // null ⇒ serve the single control Version
const ver = exp ? stickyPick(sid + '|' + exp.public_id, exp.versions) : article.control;
const key = listicleKey(site_id, slug, ver.public_id, ver.content_version, TEMPLATE_VERSION);
return serveFromCacheOrRender(key, ver);            // lander_v = ver.public_id, stamped into the shell
```

### 15.3 Page-level A/B + rule selection (single shell, pre-paint)
```js
(function(){
  var sid = readCookie('ko_sid') || genId(); setCookie('ko_sid', sid, 1800);
  var ctx = window.__LST_CTX || {};                 // edge-injected: {country,state,device,os,browser,traffic_source,hour,…}
  var pages = window.__LST_PAGES, css = '', i, p, chosen, reason;
  for (i=0; i<pages.length; i++){
    p = pages[i];
    if (p.mode === 'single')      { chosen = p.candidates[0]; reason = 'single_default'; }
    else if (p.mode === 'ab_test'){ chosen = abHash(sid + '|' + p.ab_test_id, p.candidates); reason = 'ab_hash'; }
    else /* rule_based */         { chosen = matchRule(ctx, p.candidates); reason = chosen.viaRule ? 'rule_match' : 'fallback'; }
    css += '[data-cand="'+chosen.id+'"]{display:block}';
    window.__LST_CHOSEN[p.page_index] = { id: chosen.id, rule_id: chosen.rule_id, reason: reason };
  }
  document.write('<style>.lst-cand{display:none}' + css + '</style>');
})();
```
Hidden candidates use non-loading media (`<template>`/`data-src`), hydrated only when revealed. `__LST_CHOSEN` feeds the impression beacon (shown `page_candidate_id`, `selection_reason`, `page_rule_id`).

### 15.4 Rule-based selection
Ordered rules; lowest `priority` first; first match wins; a required **fallback** catches the rest. Dimensions: `country · state · city · device · os · browser · traffic_source/platform · placement · utm_source · utm_medium · utm_content · language · hour/daypart · sub1–sub5`. Conditions are **typed**: *set-membership* dims (value ∈ set) and *numeric ranges* (`hour`/`daypart`, interval containment). The rule JSON keeps `sets` and `ranges` separate so evaluation and conflict detection treat each correctly.

**Cache-safe context.** The cached shell is byte-identical for everyone; the Worker injects a compact `window.__LST_CTX` via **`HTMLRewriter` on the response stream, *after* the shell is read from KV/Cache-API** — so geo/device is **never part of the cache key**. The client reads `__LST_CTX` (request-time geo/device from CF) + the `ko_ctx` cookie (acquisition dims) to evaluate rules before first paint. No per-audience HTML variants.

### 15.5 Rule conflict guard
On every `rule_based` Page save:
- Rules evaluated by `priority`; first match wins.
- **Equal-priority overlapping rules block the save** (ambiguous).
- Cross-priority overlaps allowed but surfaced as "Rule B can override Rule A for these audiences".
- Exactly one fallback Section is required.
- Overlap is computed per dimension: **set dims** by value-set intersection; **range dims (hour/daypart)** by **interval intersection** (e.g. 06:00–12:00 vs 10:00–18:00 overlap at 10:00–12:00). A missing dimension = "any".
```json
{ "error": "Rule conflict",
  "fields": { "page_2.rules": [ {
    "candidate_a": "Section A", "candidate_b": "Section B",
    "overlap": { "state": ["CA"], "device": ["mobile"], "traffic_source": ["facebook"] },
    "reason": "Both rules can match the same user at the same priority."
  } ] } }
```
The builder renders this as a **conflict matrix** (candidates × dimensions, overlapping cells highlighted).

### 15.6 `lander_v` — strict definition
`lander_v` is the exact rendered Article Version, i.e. `article_version.public_id` (`ver_…`), used in URLs, events, macros, analytics. `article_id` = stable URL identity; `article_version_id` = exact config (== `lander_v`); `article_variant_id` = the experiment arm (equals `article_version_id` while a Version belongs to one experiment). **Running/published Versions are immutable**: a meaningful content change while running **forks a new Version** (new `ver_` ⇒ new `lander_v`), so a live arm's data never mixes across edits. Non-behavioral tweaks bump `content_version` — surfaced as `article_version_revision` in Athena/ClickHouse/D1 mirrors and part of the cache key — so even minor revisions stay separable.

### 15.7 What gets tracked
Article layer: `lander_v (== article_version_id) · article_version_revision · article_experiment_id · article_variant_id · article_variant_label · article_split_percentage`.
Page layer: `page_index · page_selection_mode · page_ab_test_id · page_rule_set_id · page_candidate_id (≡ section_variant_id alias) · page_rule_id · page_rule_priority · selection_reason (single_default·ab_hash·rule_match·fallback) · matched_rule_json_hash`.

### 15.8 Validity rules
- Article experiment: each Version has an allocation; **Σ across Versions == 100%**; exactly one control; **at most one running experiment per Article** (partial unique index, §6); sticky per `session_id`.
- Page `ab_test`: per-Page candidate allocations total 100%; sticky; independent per page.
- Page `rule_based`: exactly one fallback; conflict guard passes; every candidate references a valid `section_id`.
- Editing a running Version forks a new Version (new `lander_v`); minor edits bump `content_version`/`article_version_revision` ⇒ separable analytics.

---

## 16. Tracking event / session

Extends the existing beacon; emits to a **new** Firehose stream `listicle-events` → S3 → Athena DB `listicles` (`events` + `sessions`). Keep `firehose.ts` + `parseDeviceOs`; the existing `homepage.events` + `/api/track` are untouched.

- **session_id** = existing `ko_sid` cookie (30-min, `crypto.randomUUID` fallback).
- **ko_ctx** = first-party cookie set on landing (utm_*, traffic_source, placement, cpc, fbclid, fbc, lander_v, sub1–5, language) so the resolver can substitute those macros.
- **click_id** = minted server-side by `/lc` (UUID); passed to the provider as `{click_id}` so the postback matches.
- **event_id** = per-event UUID (idempotent dedup).

**Event types:** `page_view` · `page_reach` · `section_impression` · **`offer_impression`** (specific governed link visible) · `offer_click` (via `/lc`) · `conversion` (in-site/pixel, optional). Server enrichment on ingest: ip/ua/device/os, geo country/state/city, received_at.

**Athena `listicles.events` columns** (lowercase, 1:1 with JSON keys):
```
identity/context : session_id, event_id, event_type, timestamp, received_at, site_id,
                   article_id, article_name, article_url, lander_v
placement        : article_version_id, article_version_revision, article_experiment_id, article_variant_id,
                   article_variant_label, article_split_percentage, page, page_index, page_selection_mode,
                   section_id, section_name, page_candidate_id, ab_test_id, ab_split_percentage,
                   page_rule_set_id, page_rule_id, page_rule_priority, selection_reason, matched_rule_json_hash,
                   offer_id, offer_name, click_id
acquisition      : utm_source, utm_medium, utm_content, traffic_source, placement, cpc, fbc, fbclid, sub1..sub5
client/geo       : device, os, os_version, browser, browser_version, country, state, city, ip, ua, url, referer, language
```
**`listicles.sessions`** (one row per session, written on `page_view`): `session_id, first_seen, last_seen, site_id, landing_url, article_id, lander_v, article_version_id, traffic_source, utm_source, utm_medium, utm_content, placement, cpc, fbclid, fbc, device, os, os_version, browser, browser_version, country, state, city, ip, ua, url, referer, language`.

**Data-accuracy guarantee:** every event answers which Article (`article_id`), version (`lander_v`/`article_version_id`/`article_version_revision`), experiment/arm, Page (`page_index`), how the Section was chosen (`page_selection_mode`/`selection_reason`), which candidate (`page_candidate_id`), which rule (`page_rule_id`/`matched_rule_json_hash`), Section (`section_id`), Offer (`offer_id`), click (`click_id`), session (`session_id`), acquisition (`traffic_source/utm/placement`), and later revenue matched (`click_id`).

---

## 17. ClickHouse aggregation

New CH tables copy the dashboard conventions: raw ingest → `REFRESH EVERY N MINUTE` MV → `ReplacingMergeTree(ver)` target, `PARTITION BY toYYYYMM(dt)`, `LowCardinality`, `nullIf` ratios (computed at read, never stored). Applied manually to CH Cloud; all `IF NOT EXISTS`.

### 17.1 Raw ingest + session dimension table
```sql
-- one row per tracked event (from Athena listicles.events) — kept lean
CREATE TABLE IF NOT EXISTS lst_events_raw (
  event_id String, session_id String,
  event_type LowCardinality(String),           -- page_view/page_reach/section_impression/offer_impression/offer_click/conversion
  dt Date, ts DateTime,
  site_id String, article_id String, lander_v String,
  article_version_id String DEFAULT '', article_version_revision UInt32 DEFAULT 1, article_experiment_id String DEFAULT '',
  article_variant_id String DEFAULT '', article_split UInt8 DEFAULT 0,
  page_index UInt16 DEFAULT 0,
  page_selection_mode LowCardinality(String) DEFAULT 'single',
  section_id String DEFAULT '', page_candidate_id String DEFAULT '',   -- section_variant_id = backward-compat alias
  ab_test_id String DEFAULT '', ab_split UInt8 DEFAULT 0,
  page_rule_set_id String DEFAULT '', page_rule_id String DEFAULT '', selection_reason LowCardinality(String) DEFAULT '',
  matched_rule_json_hash String DEFAULT '',
  link_instance_id String DEFAULT '', section_block_id String DEFAULT '', link_role LowCardinality(String) DEFAULT '',   -- v1.2 per-CTA
  link_position_index UInt16 DEFAULT 0, button_style_id String DEFAULT '', button_group_id String DEFAULT '', anchor_text_hash String DEFAULT '', analytics_label String DEFAULT '',
  page_view_id String DEFAULT '',                       -- v1.2.2 impression dedupe key
  is_bot UInt8 DEFAULT 0, is_internal UInt8 DEFAULT 0, is_preview UInt8 DEFAULT 0, traffic_quality_flag LowCardinality(String) DEFAULT 'clean',   -- v1.2.2
  offer_id String DEFAULT '', click_id String DEFAULT '',
  traffic_source LowCardinality(String) DEFAULT '', placement String DEFAULT '',
  utm_source String DEFAULT '', utm_medium String DEFAULT '', utm_content String DEFAULT '',
  device LowCardinality(String) DEFAULT '', os LowCardinality(String) DEFAULT '',
  country LowCardinality(String) DEFAULT '', state LowCardinality(String) DEFAULT '',
  value Float64 DEFAULT 0, ver UInt64 DEFAULT toUnixTimestamp(now())
) ENGINE = ReplacingMergeTree(ver) PARTITION BY toYYYYMM(dt)
ORDER BY (dt, event_type, article_id, article_version_id, page_index, page_candidate_id, offer_id, event_id);

-- full acquisition/client dimensions live ONCE per session (events join by session_id — keeps event rows lean)
CREATE TABLE IF NOT EXISTS lst_sessions (
  session_id String, dt Date, site_id String, article_id String, lander_v String, landing_url String,
  traffic_source LowCardinality(String) DEFAULT '', placement String DEFAULT '',
  utm_source String DEFAULT '', utm_medium String DEFAULT '', utm_content String DEFAULT '',
  cpc Float64 DEFAULT 0, fbc String DEFAULT '', fbclid String DEFAULT '',
  sub1 String DEFAULT '', sub2 String DEFAULT '', sub3 String DEFAULT '', sub4 String DEFAULT '', sub5 String DEFAULT '',
  device LowCardinality(String) DEFAULT '', os LowCardinality(String) DEFAULT '', os_version String DEFAULT '',
  browser LowCardinality(String) DEFAULT '', browser_version String DEFAULT '',
  country LowCardinality(String) DEFAULT '', state LowCardinality(String) DEFAULT '', city String DEFAULT '',
  ip String DEFAULT '', ua String DEFAULT '', referer String DEFAULT '', url String DEFAULT '',
  language LowCardinality(String) DEFAULT '', ver UInt64 DEFAULT toUnixTimestamp(now())
) ENGINE = ReplacingMergeTree(ver) PARTITION BY toYYYYMM(dt) ORDER BY (session_id);

-- provider revenue / conversions (from postback/API/script — §19), matched by click_id
CREATE TABLE IF NOT EXISTS lst_revenue_raw (
  dt Date, click_id String, offer_id String DEFAULT '',
  source LowCardinality(String),               -- 's2s_postback' | 'api' | 'script' | 'in_site'
  conversions UInt64 DEFAULT 0, revenue Float64 DEFAULT 0,
  currency LowCardinality(String) DEFAULT 'USD', synced_at DateTime DEFAULT now(),
  ver UInt64 DEFAULT toUnixTimestamp(now())
) ENGINE = ReplacingMergeTree(ver) PARTITION BY toYYYYMM(dt) ORDER BY (dt, click_id, offer_id, source);
```
`lst_sessions` carries the dims that would bloat every event row (`os_version, browser, browser_version, city, ip, ua, sub1–sub5, url, referer, language, cpc, fbc, fbclid`), fed from Athena `listicles.sessions`. Breakdown queries join `lst_events_raw` to `lst_sessions` on `session_id`.

### 17.2 Revenue attribution (inherits full click context)
```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS lst_revenue_attributed_mv
REFRESH EVERY 2 MINUTE TO lst_revenue_attributed AS
SELECT c.dt AS dt, c.article_id, c.article_version_id, c.article_version_revision, c.page_index, c.section_id, c.page_candidate_id,
       c.ab_test_id, c.page_rule_id, c.offer_id,
       c.link_instance_id, c.section_block_id, c.link_role, c.link_position_index,
       c.button_style_id, c.button_group_id, c.anchor_text_hash, c.analytics_label, r.source,
       SUM(r.conversions) AS conversions, SUM(r.revenue) AS revenue, now() AS synced_at
FROM lst_revenue_raw AS r FINAL
JOIN (SELECT click_id, dt, article_id, article_version_id, article_version_revision, page_index, section_id, page_candidate_id,
              ab_test_id, page_rule_id, offer_id,
              link_instance_id, section_block_id, link_role, link_position_index,
              button_style_id, button_group_id, anchor_text_hash, analytics_label
       FROM lst_events_raw FINAL WHERE event_type = 'offer_click') AS c
  ON r.click_id = c.click_id
GROUP BY c.dt, c.article_id, c.article_version_id, c.article_version_revision, c.page_index, c.section_id, c.page_candidate_id,
         c.ab_test_id, c.page_rule_id, c.offer_id,
         c.link_instance_id, c.section_block_id, c.link_role, c.link_position_index,
         c.button_style_id, c.button_group_id, c.anchor_text_hash, c.analytics_label, r.source;
```

### 17.3 Offer daily target (section/article/drilldown analogous)
> **Offer impressions come from `offer_impression`, and only non-empty `offer_id`.** The `WHERE notEmpty(e.offer_id)` clause **follows the JOIN** (valid ClickHouse SQL order) and must never be `= ''`.
```sql
CREATE TABLE IF NOT EXISTS lst_offer_daily (
  offer_id String, dt Date,
  impressions UInt64, clicks UInt64, unique_clicks UInt64, conversions UInt64,
  revenue Float64, synced_at DateTime DEFAULT now()
) ENGINE = ReplacingMergeTree(synced_at) PARTITION BY toYYYYMM(dt) ORDER BY (offer_id, dt);

CREATE MATERIALIZED VIEW IF NOT EXISTS lst_offer_daily_mv
REFRESH EVERY 2 MINUTE TO lst_offer_daily AS
SELECT e.offer_id, e.dt,
  sumIf(1, e.event_type='offer_impression') AS impressions,   -- per-Offer visibility, NOT section_impression
  sumIf(1, e.event_type='offer_click')      AS clicks,
  uniqExactIf(e.session_id, e.event_type='offer_click') AS unique_clicks,
  COALESCE(r.conversions,0) AS conversions, COALESCE(r.revenue,0) AS revenue, now()
FROM lst_events_raw AS e FINAL
LEFT JOIN (SELECT offer_id, dt, SUM(conversions) conversions, SUM(revenue) revenue
            FROM lst_revenue_attributed FINAL GROUP BY offer_id, dt) AS r
  ON e.offer_id = r.offer_id AND e.dt = r.dt
WHERE notEmpty(e.offer_id)                                   -- non-empty ids only (never = '') — WHERE follows the JOIN
GROUP BY e.offer_id, e.dt, r.conversions, r.revenue;
```

| Target | Grain (ORDER BY) | Feeds mirror |
|---|---|---|
| `lst_offer_daily` | `(offer_id, dt)` | `listicle_analytics_offer` |
| `lst_section_daily` | `(section_id, dt)` | `listicle_analytics_section` |
| `lst_article_daily` | `(article_id, article_version_id, article_version_revision, dt)` + total_visits/unique_visits | `listicle_analytics_article` |
| `lst_drilldown_daily` | `(article_id, article_version_id, article_version_revision, page_index, page_candidate_id, dt)` + selection_mode, ab_test_id, page_rule_set_id, page_rule_id, matched_sessions, fallback_sessions | `listicle_analytics_drilldown` |
| `lst_link_instance_daily` | `(link_instance_id, article_id, article_version_id, article_version_revision, page_index, page_candidate_id, dt)` + link_role, button_style_id, button_group_id, section_block_id, link_position_index, anchor_text_hash, analytics_label | `listicle_analytics_link_instance` |

**Counting rules:** offer `impressions`=count(`offer_impression`); section/article/drilldown `impressions`=count(`section_impression`); `clicks`=count(`offer_click`); `unique_clicks`=`uniqExact(session_id)` among clicks; `total_visits`=count(`page_view`); `unique_visits`=`uniqExact(session_id)` among page_views; `pps`=impressions/total_visits. Rule drilldown: `matched_sessions`=`uniqExactIf(session_id, selection_reason='rule_match')`, `fallback_sessions`=`uniqExactIf(session_id, selection_reason='fallback')`, `rule_match_rate`=matched/(matched+fallback) at read. Section metrics roll up across every Article/Version (keyed on `section_id`).

---

## 18. D1 analytics mirroring

The CMS reads only the **five** `listicle_analytics_*` D1 tables (`listicle_analytics_offer`, `_section`, `_article`, `_drilldown`, `_link_instance`). A scheduled sync pulls recent CH aggregates over HTTP and upserts into D1 (mirrors the dashboard's D1-mirror pattern).

- **Trigger:** extend the every-minute cron in `index.ts` with an isolated `syncListicleAnalytics(env)` (own try/catch).
- **Read:** query CH target tables over the CH Cloud HTTP interface (secrets `CH_URL`, `CH_USER`, `CH_PASSWORD`) for a bounded rolling window (today+yesterday default).
- **Write:** idempotent upsert per `(entity, …, date)`:
```sql
INSERT INTO listicle_analytics_offer
  (offer_public_id, date, impressions, clicks, unique_clicks, conversions, revenue, synced_at)
VALUES (?,?,?,?,?,?,?, unixepoch())
ON CONFLICT(offer_public_id, date) DO UPDATE SET
  impressions=excluded.impressions, clicks=excluded.clicks,
  unique_clicks=excluded.unique_clicks, conversions=excluded.conversions,
  revenue=excluded.revenue, synced_at=excluded.synced_at;
```
- **CMS reads** run ranged sums with read-time ratios:
```sql
SELECT SUM(impressions) imp, SUM(clicks) clk, SUM(unique_clicks) uclk,
       SUM(conversions) cv, SUM(revenue) rev,
       CAST(SUM(clicks) AS REAL)/NULLIF(SUM(impressions),0) ctr,
       CAST(SUM(conversions) AS REAL)/NULLIF(SUM(clicks),0) cvr,
       SUM(revenue)/NULLIF(SUM(clicks),0) rpc,
       SUM(revenue)/NULLIF(SUM(impressions),0)*1000 rpm
FROM listicle_analytics_offer WHERE offer_public_id=? AND date BETWEEN ? AND ?;
```
Article reads group by `article_version_id` (compare Versions, or sum for the URL total); drilldown reads expand Version → Page → candidate and add `rule_match_rate` for rule-based pages.

**Dashboard compatibility:** listicle events carry `traffic_source`, `utm_*`, `placement`, `click_id`, so the campaign dashboard joins listicle revenue/clicks to its media-buying spend on the same keys. Keep `public_id` stable; never rename CH columns. Default sync touches only the 2-day window (cost control per `docs/storage-cost-model.md`); a manual "rebuild range" backfills wider.

---

## 19. Provider revenue ingestion

Four channels map 1:1 to `conversion_tracking_method`; all reconcile via `click_id` into `lst_revenue_raw`.

| Method | Intake | Match |
|---|---|---|
| `s2s_postback` | `POST /api/pb/:provider` (provider fires our `{click_id}`) | on `click_id` |
| `script` / API | scheduled cron pulls provider API or ingests report → normalized rows | on `click_id` (or sub mapping) |
| `browser_side_pixel` | client `conversion` event → beacon | on `click_id` from session |
| in-site payout | resolver/conversion records Offer `payout_value`+`payout_currency` | direct |

**Postback endpoint** (`POST /api/pb/:provider`): (1) `verifyToken(provider, token)` (per-provider secret); (2) dedupe via `listicle_postback_log` (unique on `(provider, external_txn_id)` or `(provider, click_id, event_ts)`); (3) insert `listicle_revenue_raw {dt, click_id, offer_id?, source:'s2s_postback', conversions:1, revenue:payout, currency}`; (4) fast `200 OK`. The analytics sync ships new `revenue_raw` rows to CH `lst_revenue_raw`.

Migration `0033` adds `listicle_media_platforms`, `listicle_postback_log`, `listicle_revenue_raw`. **Pattern only** — fresh, neutrally-named code; no banned identifier; the "Script" method is the generic re-implementation of the legacy report/API import.

Flow: `postback/API/script/in-site → listicle_revenue_raw (D1) → CH lst_revenue_raw → lst_revenue_attributed_mv (join offer_click on click_id) → target aggregates → D1 mirror → CMS`.

---

## 20. Pixel / S2S / media platforms

On a matched conversion, fire **outbound** S2S pixels back to the media platform that sent the traffic. Config-driven dispatcher (`0033`):
```sql
CREATE TABLE IF NOT EXISTS listicle_media_platforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL UNIQUE,             -- 'facebook','newsbreak','taboola','outbrain','google'
  enabled INTEGER NOT NULL DEFAULT 0,
  postback_url_template TEXT NOT NULL,       -- with {macros}: {fbc},{fbclid},{click_id},{value},{currency}
  auth_secret_ref TEXT,                      -- name of the wrangler secret holding the token
  event_name TEXT DEFAULT 'Purchase',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```
On a matched conversion, look up the enabled platform for the click's `traffic_source`, resolve its `postback_url_template` from click/session context (FB needs `fbc`/`fbclid` captured to `ko_ctx` on landing), fire S2S on `ctx.waitUntil` (failures logged, never block ingestion). Prefer S2S over browser pixels. New platforms = a config row + macro mapping, no code change.

---

## 21. GA4 validation

Sites already carry a GA4 measurement id via CMS Settings; listicle pages compose the same public `layout.ts` head, so GA4 loads automatically. Do **not** re-implement or touch the Settings GA4 write path / settings cache key.
- Confirm the existing CSP already allows `googletagmanager.com` / `google-analytics.com` for the tenant host (listicle pages share the host).
- Playwright validation on a published listicle URL: `window.dataLayer` exists, `gtag` defined, a `config` call carries the site's measurement id; regression test guards that adding the listicle path did not strip GA4.
- Optional: push a `dataLayer` event on `offer_click` (additive, guarded so absence of GA never breaks the resolver).

---

## 22. Performance & caching

Reuse the two-layer KV + Cache-API edge cache. Target ~99.99% cacheable.

| Aspect | Value |
|---|---|
| Key | `html:{site_id}:/{slug}:{lander_v}:{content_version}:{template_version}` — `listicleKey()` includes `lander_v` so each article-A/B Version is a distinct cached artifact |
| Header | `public, max-age=300, stale-while-revalidate=86400` + ETag + nosniff |
| Store | KV `env.CACHE` (durable) + optional `caches.default` when `CACHE_API_ENABLED` |
| lander_v | = the rendered Version `public_id` (§15.6); its `content_version` bump changes cache identity |

**22.2 Section fan-out invalidation.** On Section save: look up affected Versions via `listicle_page_section_candidates → listicle_pages → listicle_article_versions → listicle_articles`, bump each affected **Version's** `content_version` (a new `lander_v` cache identity), then run per-site `invalidate` + `warm`.

**22.3 Speed budget.** HTML server-rendered once per Version, edge-served; CSS scoped to `[data-layout]`; JS = a few KB inline ES5 (edge Version pick is server-side; page A/B + rule selector pre-paint; `IntersectionObserver` for `section_impression` + `offer_impression`); hero eager, else `loading="lazy"` via `responsive-img.ts`; tracking `navigator.sendBeacon`; `/lc` redirect keeps provider JS off the page.

**22.4 Hybrid rendering + payload guard.**
- **Article-level A/B** → always separate pre-rendered cached shells per `lander_v`; edge picks the Version (linear count).
- **Page-level A/B / rule candidates** → ride inside the Version shell only while hidden-candidate HTML stays under a strict budget (**~40 KB or ~50%** whichever first; config constant).
- **Geo/state rules** → edge-injected `__LST_CTX` (post-cache `HTMLRewriter`) keeps the shell cacheable.
- Hidden candidate images/GIFs are not loaded (`<template>`/`data-src`); selection is pre-paint.
- Over budget → **lazy-hydrate** the chosen candidate from a cached per-candidate endpoint. **Above-the-fold candidates are never post-paint lazy-hydrated** (they stay inlined even if over budget); only **below-the-fold** candidates lazy-hydrate, and their containers **reserve dimensions** (min-height / aspect-ratio) so the swap causes zero CLS.

---

## 23. Validation rules

Client (fast feedback, blocked submit) + server (authoritative `{error, fields}`).

**Offer** — required: offer_name, provider, activity, vertical, conversion_tracking_method, offer_url_template, payout_method. Conditional: `in_site` ⇒ payout_currency + payout_value; `cap_enabled` ⇒ cap_amount + cap_timezone + cap_count_by (+ optional fallback). URL: valid absolute URL; macros preserved; unknown macros rejected/warned; `{clickid}→{click_id}` normalized.

**Section** — required: section_name, headline_text, ≥1 content block. Hyperlinks: every headline/inline/button link carries a valid `offer_id`; **no free-text URL**; a link/button without an Offer blocks the save.

**Article & Version** — Article base: site, article_name, slug (unique per site). Each Version: headline, intro_paragraph, hero image, layout_style, ≥1 Page; each Page has ≥1 Section candidate.

**Experimentation** —
- Article A/B: when running, every Version has a traffic_allocation and **Σ across Versions == 100%**; exactly one control; **at most one running experiment per Article** (partial unique index, §6).
- Page `ab_test`: each candidate has a traffic_allocation; **per-Page Σ == 100%**; stable `ab_test_id`.
- Page `rule_based`: each non-fallback candidate has a rule + priority; **exactly one fallback**; equal-priority overlapping rules **block the save** with a conflict report (§15.5); cross-priority overlaps allowed but surfaced; every candidate references a valid `section_id`.

Server functions: `validateOffer/Section/Article/Version/Page` returning field-keyed errors + macro-registry check + "Offer exists & active" check for every link + rule-overlap conflict guard — all before write.

---

## 24. Security / auth / permissions

| Surface | Control |
|---|---|
| `/admin/listicles*` + `/api/admin/listicles/*` | Cloudflare Access (JWKS-in-KV) + `ADMIN_HOST`-only (404 elsewhere) + `private, no-store` |
| `/lc/:offer` | resolves only **known active** Offer public_ids (no open redirect); cap-checked; fail-safe 302 to `/`; `no-store` |
| `/api/lst/track` | fire-and-forget, capped events/request, always 204, no reflected data |
| `/api/pb/:provider` | per-provider shared-secret token (wrangler secret); idempotent via `listicle_postback_log`; strict payload; rate-limited |
| Secrets | CH creds, postback tokens, platform tokens in `wrangler secret` only |
| Content safety | tag-whitelist sanitizer; governed anchors `rel="sponsored nofollow noopener"`; no `javascript:`/`data:` can enter (macros only, resolved server-side) |
| SQL | parameterized `.bind()` |
| Privacy / PII | reuse `privacy_opt_outs` + existing consent; honour opt-out before emitting events |
| Isolation | `verify:no-legacy-prod-refs` green — zero banned identifiers |

Permissions: edge Access is all-or-nothing today; `created_by` is captured to enable finer RBAC later (§28 Q9).

---

## 25. Testing plan

- **Unit (Vitest):** validators (offer/section/article/version/page/AB/rule); macro registry + `{clickid}` normalization; `resolveMacros`; deterministic A/B `abHash` (same sid ⇒ same candidate; distribution); rule matcher incl. interval overlap for hour/daypart; conflict guard (equal-priority overlap blocks; range overlap); cap counter increment + fallback loop guard; `button`/`offerlink` renderers + sanitizer allow-list; `section_offers` rebuild; read-time ratio math (nullIf).
- **Integration:** CRUD round-trips (all entities); 409 blocked-delete when in use; Article+Version+pages+candidates+rules txn atomicity; one-running-experiment partial-unique enforcement; mirror upsert idempotency; postback dedup; `/lc` resolution + full-context event + cap fallback; `ADMIN_HOST` gate.
- **Acceptance (shell):** per-column/index assertions for `0031`–`0033` (incl. partial unique index, `lst_sessions` presence, no `rule_id` on candidates); nav entry present; sub-tab routes 200; "no free-text URL field in the Section editor" DOM assertion; ES5-only inline scripts.
- **e2e (Playwright):** article A/B → sticky Version per session (edge, `ko_sid`), correct per-`lander_v` cache key; page A/B + rule page → exactly one candidate visible, zero layout shift, sticky; conflict-matrix blocks an equal-priority overlap; GA4 loads; `/lc` 302 + `offer_click` beacon with full context; `section_impression` + `offer_impression` fire on scroll.
- **Guardrail:** `verify:no-legacy-prod-refs` green on every new file; `verify:infra`/`verify:worker-config` unaffected.

---

## 26. Manual QA checklist

**Offers:** create with all fields (required-field block); `{clickid}`→`{click_id}` normalize + unknown-macro warn; In-site ⇒ currency+value required; cap ⇒ amount/tz/count_by + fallback; macro chip inserts at caret; delete of an in-use Offer → 409 dialog + "Archive instead"; "View attribution to Sections" correct.
**Sections:** create (name, image upload + AI, headline); make headline clickable → Offer modal → chip; add check/emoji lists + colour spans; add Button + inline link (both force Offer modal; **no URL field anywhere**); "View Offers used" / "View usage in Articles" correct.
**Articles + experimentation:** create (site required); edit control Version; "A/B this Article" → add Version B, set 60/40 (Σ indicator green only at 100); on a Page set `ab_test` 70/30; on another set `rule_based` (state=CA&mobile→C, source=NewsBreak→D, fallback→E) and confirm an equal-priority overlap is blocked with a conflict matrix; publish; live URL renders default layout; reload → sticky Version + sticky candidates; fresh session → distribution matches; no flicker/CLS (incl. below-the-fold lazy-hydrated candidates).
**Tracking & analytics:** land with UTM + fbclid → `ko_sid` + `ko_ctx` set, `page_view` fires; scroll → `section_impression` + `offer_impression` fire for shown candidate only; click → `/lc` mints click_id, 302 with resolved macros + full context, `offer_click` fires; hit cap → fallback offer/URL (one hop); test postback with that click_id → `listicle_revenue_raw` → after sync shows in Offer/Section/Article analytics; drilldown Version→Page→candidate (rule matched/fallback/rule_match_rate); GA4 still loads; homepage `/api/track` + `homepage.events` unaffected.

---

## 27. Implementation phases

| Phase | Scope | Acceptance |
|---|---|---|
| 1 · schema | `0031` core (offers +cap fallback, sections, section_offers, articles base, experiments, versions, pages +selection_mode, candidates, rules, cap counters), `0032` mirrors (version+rule dims), `0033` revenue/media infra | migrations apply local+remote; indexes/columns per acceptance scripts; Offers/Sections no `site_id`; `UNIQUE(site_id,slug)`; Pages FK to `article_version_id`; candidates carry no `rule_id`; partial unique index on running experiment |
| 2 · API | `listicleApi` CRUD (offers/sections/articles/versions) + usage/search/analytics + `/pages/:id/validate` | CRUD round-trips; `{error,fields}`; 409 blocked-delete with usage; all behind `accessAuth`+`ADMIN_HOST` |
| 3 · UI | NAV entry + sub-tabs; list pages + Create-Offer modal | active-state works; three tabs render; offer create/edit/delete/attribution end-to-end; inline scripts ES5 |
| 4 · editor | block editor: button + offerlink, list markers, colour, emoji, AI; Offer modal; `section_offers` rebuild + `content_html` | every link/button via Offer modal; no URL field; save blocked without an Offer; content_json round-trips |
| 5 · builder | base + control Version; article-A/B version rail (Σ=100); Pages builder + selection mode; rule editor + conflict matrix | Article+Version save atomic; per-Page(ab) + per-experiment Σ=100; rule_based needs one fallback + passes conflict guard; "View structure" renders Versions→Pages→candidates |
| 6 · render | layout registry + default (1:1 reference); per-Version cached shell + edge Version pick; candidates in shell under payload guard; `listicleKey()` (incl. `lander_v`) + invalidate/warm + Section fan-out | each Version caches under its own `lander_v`; edge assignment sticky; Section edit invalidates every Version using it; over-budget pages lazy-hydrate (below-fold only) |
| 7 · tracking | listicle beacon (ES5) + `/api/lst/track` → `listicle-events` + Athena; `ko_ctx` + edge `__LST_CTX`; `/lc` resolver + macro engine + cap counter; A/B + rule selector; `section_impression` + `offer_impression` | events land with all v1.1.1 dims; A/B + rule sticky + zero-shift (e2e); `/lc` mints click_id, resolves macros, checks cap (fallback), fires `offer_click`, fail-safe |
| 8 · mirrors | CH raw/`lst_sessions`/MV/targets (offer counts `offer_impression`; version+rule dims); cron CH→D1 mirror; wire analytics endpoints + drilldown expander | offer/section/article(-by-version)/drilldown render from D1 with nullIf ratios; Section rolls up across Versions; drilldown compares article-A/B, page-A/B, rules |
| 9 · integrations | postback endpoint + dedup; revenue attribution MV; outbound S2S dispatcher + `media_platforms` (FB → NewsBreak/Taboola/Outbrain/Google) | postback with our click_id attributes revenue to offer/version/candidate; conversion caps increment; matched conversion fires the platform S2S |
| 10 · hardening | full manual QA; CWV; cache-hit at target; abuse bounds; GA4 regression guard | manual QA green on staging; no regression to homepage analytics/cache/GA4; all `verify:*` + unit/integration/acceptance/e2e green |

---

## 28. Risks / open questions

| # | Question / risk | Impact · recommendation |
|---|---|---|
| Q1 · blocker | PRD says "reuse Insureprimo tracking" — CI-banned in this repo | Confirm agreed reading: reuse *pattern*, fresh neutral code, zero banned tokens (assumed). |
| Q2 · confirm | Exact type of `sites.id` (TEXT vs INTEGER) for `listicle_articles.site_id` | Contract uses `TEXT`; confirm vs migration 0002 and adjust. |
| Q3 · blocker | AWS ops: create Firehose `listicle-events`, S3 prefix, Athena DB `listicles` + `events`/`sessions` external tables + partitions | Owner: data/ops before Phase 7. Worker no-ops until creds/stream exist. |
| Q4 · blocker | ClickHouse: who applies `lst_*` DDL + MVs; CH HTTP creds for the mirror sync | Owner: data/ops (manual). Provision `CH_URL/CH_USER/CH_PASSWORD` before Phase 8. |
| Q5 · confirm | Offer cap strictness (D1 atomic vs Durable Object) | D1 atomic increment baseline; confirm whether hot Offers need a DO single-writer to prevent overshoot. |
| Q6 · confirm | Per-provider postback auth + payload schemes vary | Need a small per-provider adapter map; confirm initial providers + specs. |
| Q7 · confirm | `unique_clicks`/`unique_visits` definition | Contract uses `uniqExact(session_id)`; confirm vs `uniq(click_id)`. |
| Q8 · confirm | `{language}` macro source (Articles have no language field) | Add `language` to the Version (or derive from site); confirm. |
| Q9 · later | Finer RBAC (per-site editors, offer approvers) | Edge Access all-or-nothing today; `created_by` captured to enable roles later. |
| Q10 · later | Emoji library + GIF optimization pipeline | Lightweight emoji dataset; confirm CF Images handles animated GIF (else transcode to muted looping video). |
| Q11 · later | Consent posture for new dims under GDPR/CCPA | Reuse `privacy_opt_outs`; confirm US-only traffic relaxes some requirements. |
| Q12 · later | Section multi-language reuse across sites | Out of scope v1; Sections are language-neutral today. |
| Q13 · confirm | Rule dimension set + **daypart timezone** | Confirm initial dims + daypart tz basis (recommend site tz). |
| Q14 · confirm | Max concurrent Article **Versions** per experiment | Recommend soft cap 3–4 (per-Version shell warm/KV cost is linear); confirm ceiling. |
| Q15 · confirm | `offer_impression` visibility threshold | Recommend IntersectionObserver ≥50% + small dwell; confirm so CTR/RPM match dashboard. |
| Q16 · later | Payload-budget threshold for the hybrid guard | Starts ~40 KB / 50% config constant; tune from real weights in Phase 10. |

---

## 29. Final implementation checklist

**Guardrails (every PR)**
- [ ] `verify:no-legacy-prod-refs` green — no banned identifiers in any new file.
- [ ] All inline admin/public scripts ES5.
- [ ] No existing table altered destructively; no existing route/cache/GA4 behavior changed.
- [ ] Secrets via `wrangler secret` only; account id is the sole shared identifier.

**Schema (Phase 1)**
- [ ] `0031`–`0033` apply local+remote; acceptance shell tests pass.
- [ ] Offers/Sections global (no `site_id`); `UNIQUE(site_id,slug)`; Pages FK `article_version_id`; candidates have **no** `rule_id` (rules FK to candidates); partial unique index on running experiment; `public_id` minted on create.

**API (Phase 2)**
- [ ] CRUD + usage + search + analytics + `/versions/:id` + `/pages/:id/validate`; field-keyed errors; 409 blocked-delete.
- [ ] `/lc`, `/api/lst/track`, `/api/pb/:provider` with correct cache/no-store headers.

**Admin UI (Phases 3–5)**
- [ ] Listicles nav + sub-tabs; lists reuse toolbar/table/pager/empty-state.
- [ ] Create-Offer modal: all fields, conditional reveals, macro chips, `{clickid}` normalization, cap fallback.
- [ ] Section editor: buttons + inline links + clickable headline via Offer modal; **no URL field**; list markers/colour/emoji/AI; `section_offers` rebuilt.
- [ ] Article builder: base + Versions (article-A/B rail Σ=100); per-Version fields; Pages builder + selection mode; page-A/B Σ=100 guard; rule editor + conflict matrix (equal-priority overlap blocks; one fallback); "view structure".

**Rendering & cache (Phase 6)**
- [ ] Layout registry + `default` (tokens, not hardcoded); unknown id → default.
- [ ] Per-Version cached shell (`listicleKey()` incl. `lander_v`) + edge sticky Version pick; page candidates in shell under payload guard (below-fold lazy-hydrate, reserve dims); publish/edit invalidation incl. Section fan-out (candidates→pages→versions→articles) + warm.

**Tracking & experimentation (Phase 7)**
- [ ] Synchronous selectors: article Version sticky at edge; page A/B (hash) + rule-based (edge `__LST_CTX` via post-cache HTMLRewriter) pre-paint, zero CLS.
- [ ] `ko_ctx` captures acquisition macros; resolver mints `click_id`, resolves all 33 macros, checks cap (fallback, one-hop loop guard), fires `offer_click` with full context, fail-safe.
- [ ] Events carry every v1.1.1 dimension + first-class `offer_impression` → Athena `listicles.events`/`sessions`.

**Analytics (Phases 8–9)**
- [ ] CH raw + `lst_sessions` + MV + targets per conventions (offer counts `offer_impression`, WHERE after JOIN, non-empty `offer_id`); CH→D1 mirror cron (idempotent, bounded window).
- [ ] Offer/Section/Article(-by-version) + "+" drilldown (Version→Page→candidate incl. rule matched/fallback/rule_match_rate) from D1 with nullIf ratios.
- [ ] Revenue: postback dedup → attribution MV by click_id (inherits version/candidate/rule); outbound S2S dispatcher.

**Hardening (Phase 10)**
- [ ] Manual QA green on staging; CWV pass; cache-hit at target; GA4 loads + regression guard.
- [ ] Homepage analytics/cache untouched; all `verify:*` + unit/integration/acceptance/e2e green.

---

## 30. v1.2 Addendum — Default-layout parity &amp; link-instance analytics

> This addendum is **authoritative** and supersedes §14.2's illustrative tokens. It extends §5 (byline + link instances), §6 (DDL + mirror), §7 (resolver URL), §12 (presets/CTA/preview), §16–§18 (link-instance dims), §25 (visual regression), §27 (phases 4/6/8), and §29 (acceptance).

### 30.1 Default layout — measured token package
Ships as a real package (not scoped CSS placeholders); tokens apply on `[data-layout="default"]`:
```
api/src/public/listicle/layouts/default/tokens.ts        // defaultListicleLayoutTokens (below)
api/src/public/listicle/layouts/default/styles.ts        // tokens → scoped CSS on [data-layout="default"]
api/src/public/listicle/layouts/default/components.ts     // component tree (§30.2)
docs/listicles/reference-layout-audit.md                  // audit + blocker register
docs/listicles/reference-layout-desktop.json              // measured desktop values
docs/listicles/reference-layout-mobile.json               // BLOCKER: capture required
docs/listicles/reference-desktop.png                      // captured reference (desktop)
docs/listicles/reference-mobile.png                       // BLOCKER: capture required
```
Measured article body is **~968px** (16px side padding) at the captured desktop viewport — **not** the earlier ~680px. Every `status: "BLOCKER…"` must be resolved from a scrolled screenshot / computed CSS before acceptance.
```ts
export const defaultListicleLayoutTokens = {
  id: "default",
  source: "senior-saving-reference",
  status: "measured-visible-page-plus-blockers",
  viewports: {
    capturedDesktop: { viewportWidth: "1014px", viewportHeight: "857px",
                       renderedPageWidth: "1000px", scrollbarWidth: "14px" },
    mobile: { width: "390px", status: "BLOCKER: capture required before final acceptance" }
  },
  page: { backgroundColor: "#ffffff", textColor: "#2a2a2a",
          fontFamily: "Arial, Helvetica, sans-serif", shellWidth: "100%", shellMinHeight: "100vh" },
  articleContainer: { maxWidth: "968px", paddingXDesktop: "16px", paddingXMobile: "16px",
                      marginLeft: "auto", marginRight: "auto" },
  header: { height: "64px", backgroundColor: "#ce2e35", borderBottomColor: "#f4d1d3",
            borderBottomWidth: "1px", paddingX: "20px", paddingY: "0px", display: "flex",
            alignItems: "center", justifyContent: "space-between", boxSizing: "border-box" },
  logoSlot: { widthDesktop: "226px", heightDesktop: "36px", objectFit: "contain",
              objectPosition: "left center", display: "block", measuredLeft: "20px",
              measuredTop: "15px", measuredVisualHeight: "35px", measuredVisualWidth: "226px" },
  disclosureTrigger: { position: "top-right-header", color: "#ffffff",
              fontFamily: "Arial, Helvetica, sans-serif", fontSize: "13px", fontWeight: "400",
              lineHeight: "16px", textDecoration: "none", cursor: "pointer", rightOffset: "20px",
              measuredRightEdge: "~981px", measuredLeftEdge: "~924px",
              measuredTop: "~27px", measuredHeight: "~13px" },
  disclosureInteraction: { status: "BLOCKER",
    instruction: "Open the reference Disclosure and measure whether it is anchor navigation, modal, dropdown, accordion, or scroll-to-disclosure. Do not implement from assumptions." },
  articleTopSpacing: { headerBottomY: "64px", h1FirstGlyphTopY: "94px", visualGap: "30px",
                       paddingTopDesktop: "23px", paddingTopMobile: "22px" },
  articleHeadline: { fontFamily: "Arial, Helvetica, sans-serif", color: "#2c2c2c",
    fontSizeDesktop: "38px", fontSizeMobile: "32px", fontWeight: "700",
    lineHeightDesktop: "48px", lineHeightMobile: "39px", letterSpacing: "-0.4px",
    textAlign: "center", maxWidth: "820px", marginTop: "0px", marginBottom: "19px",
    measuredLine1GlyphBox: "y=94-128", measuredLine2GlyphBox: "y=142-168", measuredLineTopToTop: "48px" },
  byline: { display: "flex", alignItems: "center", justifyContent: "center", gap: "16px",
    marginBottom: "16px", fontFamily: "Arial, Helvetica, sans-serif", fontSize: "12px",
    lineHeight: "15px", fontWeight: "700", color: "#4b5360", avatarSize: "31px",
    avatarRadius: "999px", measuredAvatarX: "327-357px", measuredAvatarY: "196-226px",
    measuredTextX: "374-670px", measuredTextY: "203-217px" },
  heroImage: { width: "100%", measuredWidth: "967px", measuredHeight: "484px", measuredX: "16px",
    measuredY: "242px", aspectRatio: "2 / 1", objectFit: "cover", objectPosition: "center center",
    borderRadius: "5px", marginTop: "0px", marginBottom: "22px", display: "block" },
  bodyParagraph: { fontFamily: "Arial, Helvetica, sans-serif", fontSizeDesktop: "20px",
    fontSizeMobile: "18px", lineHeightDesktop: "30px", lineHeightMobile: "27px", fontWeight: "400",
    color: "#2a2a2a", letterSpacing: "0px", marginTop: "0px", marginBottom: "15px",
    measuredX: "16px", measuredParagraphGap: "14-16px" },
  strongText: { fontWeight: "700", color: "#2a2a2a" },
  sectionWrapper: { marginTop: "32px", marginBottom: "28px",
    status: "BLOCKER: confirm exact lower-page spacing from scrolled screenshot/computed CSS" },
  sectionHeading: { fontFamily: "Arial, Helvetica, sans-serif", fontSizeDesktop: "28px",
    fontSizeMobile: "24px", lineHeight: "34px", fontWeight: "700", color: "#2a2a2a",
    marginTop: "28px", marginBottom: "16px", textDecoration: "none",
    status: "BLOCKER: exact lower-page value must be measured from Section 1" },
  sectionImage: { width: "100%", aspectRatio: "2 / 1", objectFit: "cover",
    objectPosition: "center center", borderRadius: "5px", marginTop: "12px", marginBottom: "20px",
    display: "block", status: "BLOCKER: confirm whether lower section images share hero aspect ratio and radius" },
  inlineLink: { color: "#ce2e35", fontWeight: "700", textDecoration: "none",
    hoverColor: "#b9272e", hoverTextDecoration: "underline",
    status: "BLOCKER: confirm from visible inline links such as provider links" },
  choiceButton: { backgroundColor: "#ce2e35", color: "#ffffff", borderColor: "#ce2e35",
    hoverBackgroundColor: "#b9272e", activeBackgroundColor: "#a8232a",
    fontFamily: "Arial, Helvetica, sans-serif", fontSize: "18px", fontWeight: "700",
    lineHeight: "24px", borderWidth: "0px", borderRadius: "6px", paddingY: "14px", paddingX: "18px",
    width: "100%", maxWidth: "720px", minHeight: "52px", marginTop: "8px", marginBottom: "8px",
    cursor: "pointer",
    status: "BLOCKER: exact lower-page CTA button visual styling must be measured from scrolled screenshot/computed CSS before implementation acceptance" },
  choiceButtonGroup: { display: "flex", flexDirection: "column", alignItems: "center",
    gap: "8px", marginTop: "16px", marginBottom: "20px" },
  textCta: { display: "block", color: "#ce2e35", fontSize: "20px", fontWeight: "700",
    lineHeight: "30px", textAlign: "left", textDecoration: "none", marginTop: "16px",
    marginBottom: "22px", status: "BLOCKER: exact text CTA style not visible in first screenshot" },
  listBlock: { fontFamily: "Arial, Helvetica, sans-serif", fontSize: "20px", lineHeight: "30px",
    color: "#2a2a2a", marginTop: "10px", marginBottom: "16px", itemMarginBottom: "8px",
    paddingLeft: "0px", listStyle: "none", checkmarkMarker: "\u2714\ufe0f ",
    checkmarkMarkerSize: "20px", bulletMarker: "\u2022 ", bulletMarkerColor: "#2a2a2a" },
  legalDisclosureBlock: { fontSize: "14px", lineHeight: "21px", color: "#4b4b4b",
    marginTop: "32px", marginBottom: "24px", fontWeight: "400",
    status: "BLOCKER: exact lower-page legal block style not visible in first screenshot" },
  footer: { backgroundColor: "#ffffff", borderTopColor: "transparent", borderTopWidth: "0px",
    paddingTop: "24px", paddingBottom: "32px", paddingX: "16px", footerLogoWidth: "180px",
    footerLogoHeight: "auto", footerLogoMarginBottom: "16px", linkColor: "#2a2a2a",
    linkFontSize: "14px", linkLineHeight: "22px", linkTextDecoration: "none",
    linkHoverTextDecoration: "underline", legalFontSize: "12px", legalLineHeight: "18px",
    legalColor: "#555555", legalMarginTop: "16px", copyrightFontSize: "12px",
    copyrightLineHeight: "18px", copyrightColor: "#555555", copyrightMarginTop: "16px",
    status: "BLOCKER: exact footer styling must be measured from page bottom before acceptance" }
};
```

### 30.2 Component tree &amp; byline model
```
DefaultListicleLayout
├── ListicleHeader (HostLogo — the ONLY per-host brand swap · DisclosureTrigger)
├── DisclosurePanel / DisclosureModal / DisclosureAnchorBehavior   // BLOCKER
├── ArticleShell
│   ├── ArticleTitle
│   ├── ArticleByline (AuthorAvatar + BylineText)
│   ├── ArticleHero · IntroParagraphs
│   └── OfferSections[]
│       ├── LinkedSectionHeading · LinkedSectionImage · RichParagraphBlock · InlineOfferLink
│       ├── QualificationHeading · StepTextBlock · QuestionPrompt
│       ├── ChoiceButtonGroup · ChoiceButton · CheckmarkList · BulletList
│       ├── DisclaimerParagraph · FinalTextCta
├── LegalDisclosureBlock
└── Footer (FooterLogo · FooterNavLinks · FooterLegalText · Copyright)
```
```ts
type ArticleVersionByline = {
  enabled: boolean;
  author_name: string;
  author_avatar_media_id?: number;
  author_avatar_url?: string;
  label: string;          // default "Advertorial"
  updated_label: string;  // e.g. "Updated:"
  updated_date: string;
};
```
Stored on the Version as `byline_json`. Default rendering: centered row · 31px circular avatar · 16px gap · 12px bold `#4b5360`.

### 30.3 Locked default-layout editing
Operators **can** edit: text · rich-text emphasis · offer attribution · image · button labels · button count · button order · block order · section enable/disable.
Operators **cannot** edit (token-owned): font family · font size · line height · colours · button radius/padding · content width · hero/image radius · footer style · header style · Disclosure placement. The host **site theme cannot override** default tokens; only the logo is swapped from site settings.

### 30.4 Blocker register → measurement protocol (see §31.0; resolve before Phase 6 acceptance)
1. **Mobile capture (390px)** — fill `reference-layout-mobile.json` + `reference-mobile.png`.
2. **Disclosure interaction** — measure anchor/modal/dropdown/accordion/scroll-to; implement the real behaviour, never assume.
3. **Lower-page** — sectionWrapper spacing, sectionHeading, sectionImage, inlineLink, choiceButton, textCta, legalDisclosureBlock, footer — measure from scrolled screenshots / computed CSS of Sections 1–5.
Acceptance rule: any unresolved BLOCKER ⇒ default-layout parity incomplete ⇒ Phase 6 cannot be accepted.

### 30.5 Reference block presets &amp; models
Locked default-layout presets (each carries a `layout_binding` to §30.1 tokens):
```
Reference Section Heading · Reference Linked Section Heading · Reference Linked Image
Reference Paragraph · Reference Strong Text · Reference Inline Offer Link
Reference Qualification Heading · Reference Step Text · Reference Question Prompt
Reference Choice Button Group · Reference Choice Button · Reference Checkmark List
Reference Bullet List · Reference Disclaimer Paragraph · Reference Final Text CTA
Reference Legal Disclosure · Reference Spacer / Gap
```
```ts
type ChoiceButtonGroupBlock = {
  id: string; type: "choice_button_group";
  data: { layout_binding: "default.choiceButtonGroup"; prompt?: string; items: ChoiceButtonItem[]; };
};
type ChoiceButtonItem = {
  id: string; link_instance_id: string; text: string; offer_id: string;
  style_id: "reference-choice-button"; layout_binding: "default.choiceButton"; analytics_label?: string;
};
type FinalTextCtaBlock = {
  id: string; type: "final_text_cta";
  data: { link_instance_id: string; text: string; offer_id: string;
          layout_binding: "default.textCta"; analytics_label?: string; };
};
type LinkedImageBlock = {
  id: string; type: "linked_image";
  data: { media_id?: number; image_url?: string; alt: string; offer_id: string;
          link_instance_id: string; layout_binding: "default.sectionImage"; };
};
```
**Button requirement:** reference Sections use 6/2/4/4/3 choice buttons. Unlimited buttons per group; multiple groups per Section; reorder + duplicate; bulk-assign one Offer to a group or per-button Offers; reuse previous binding. Buttons are answer choices, not only a primary CTA.

### 30.6 CTA / Link Inventory, preview &amp; Page CTA density
Section-editor **CTA/Link Inventory** lists every governed link/button/image/text-CTA in order, keyed by `link_instance_id` (order · block position · role · text · Offer · style · id · missing/invalid state). Actions: edit/replace Offer · **bulk-replace across Section** · duplicate button · move up/down · jump to block.
**Section preview** renders inside the real default `SectionWrapper` (desktop/mobile toggle, CTA inventory alongside). **Article Version preview** renders the full page (red 64px header, logo slot, top-right Disclosure, title, byline, hero, intro, all Sections + button groups + final CTAs, legal block, footer); can force Version A/B + Page candidate, simulate rule audience dims, and show **Page CTA Density** per page. No raw CSS required to recreate the reference.

### 30.7 Link-instance analytics
```sql
CREATE TABLE IF NOT EXISTS listicle_section_link_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,             -- == link_instance_id ("lnk_…")
  section_id INTEGER NOT NULL REFERENCES listicle_sections(id) ON DELETE CASCADE,
  offer_id INTEGER NOT NULL REFERENCES listicle_offers(id),
  block_id TEXT NOT NULL,                     -- content_json block id
  link_role TEXT NOT NULL CHECK (link_role IN
    ('headline','inline','linked_image','button','choice_button','final_text_cta')),
  position_index INTEGER NOT NULL DEFAULT 0,
  anchor_text TEXT, anchor_text_hash TEXT,
  button_style_id TEXT, button_group_id TEXT, analytics_label TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_listicle_linkinst_section ON listicle_section_link_instances(section_id);
CREATE INDEX IF NOT EXISTS idx_listicle_linkinst_offer   ON listicle_section_link_instances(offer_id);
```
`listicle_section_offers` remains a **derived summary rebuilt from `listicle_section_link_instances`** on Section save (link_role CHECK widened to the six roles above).
**Optional D1 mirror:**
```sql
CREATE TABLE IF NOT EXISTS listicle_analytics_link_instance (
  link_instance_id TEXT NOT NULL, section_public_id TEXT NOT NULL, offer_public_id TEXT NOT NULL,
  article_public_id TEXT NOT NULL, article_version_id TEXT NOT NULL, article_version_revision INTEGER NOT NULL DEFAULT 1,
  page_index INTEGER NOT NULL, page_candidate_id TEXT NOT NULL,
  page_selection_mode TEXT DEFAULT '', page_rule_id TEXT DEFAULT '', selection_reason TEXT DEFAULT '',
  section_block_id TEXT DEFAULT '', link_role TEXT NOT NULL, link_position_index INTEGER DEFAULT 0,
  button_style_id TEXT, button_group_id TEXT, anchor_text_hash TEXT DEFAULT '', analytics_label TEXT DEFAULT '', date TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0,
  unique_clicks INTEGER NOT NULL DEFAULT 0, conversions INTEGER NOT NULL DEFAULT 0,
  revenue REAL NOT NULL DEFAULT 0, synced_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (link_instance_id, article_public_id, article_version_id, article_version_revision, page_index, page_candidate_id, date));
```
**Headline link instances.** A clickable Section headline is governed too: when `headline_offer_id` is set, the Section save creates a `listicle_section_link_instances` row with `block_id = "__headline__"`, `link_role = 'headline'`, `position_index = 0` (reserved id `"__article_title__"` is held for a future Article-title link). Validation blocks the save if the row is missing.

**`lander_v` vs `content_version`.** `lander_v = article_version.public_id`. A `content_version` bump does **not** create a new `lander_v` — it creates a new cache key (`site_id + slug + lander_v + content_version + template_version`) and a new `article_version_revision` in analytics. Cases: (a) **draft** version edit → bump `content_version`; (b) **published/running non-behavioral** tweak → bump `content_version`, keep the same `lander_v`, analytics separated by `article_version_revision`; (c) **published/running meaningful** content/layout/page/section change → **fork a new Version** (new `public_id`/`lander_v`) unless the operator explicitly starts a new revision period.

**Carry these fields through** Athena `listicles.events`, ClickHouse `lst_events_raw`, revenue attribution MV, D1 drilldown, and the click resolver: `link_instance_id · section_block_id · link_role · link_position_index · button_style_id · button_group_id · anchor_text_hash · analytics_label`.
Governed anchor + full click URL:
```html
<a data-offer="off_..." data-link-instance="lnk_..." data-link-role="choice_button" data-block-id="blk_..."
   href="/lc/off_...?a=art_...&lv=ver_...&p=2&s=sec_...&c=cand_...&m=single&r=&lnk=lnk_...&blk=blk_...&role=choice_button">
```

### 30.8 Visual-regression acceptance (extends §25)
Playwright screenshot + computed-style diff vs reference: header 64px `#ce2e35` + 1px `#f4d1d3`, logo left @20px, Disclosure right @20px white 13px/16px; H1 centered 38px/48px max-width ~820px (two-line break at captured desktop); byline 31px avatar + 16px gap + 12px bold `#4b5360`; hero x=16px ~967px 2:1 radius 5px mb 22px; body 20px/30px `#2a2a2a` mb 15px. Lower-page + Disclosure-interaction diffs run once measured. **Any unresolved BLOCKER ⇒ Phase 6 fails.**

### 30.9 Phase &amp; acceptance deltas
- **Phase 4 → "Default-layout-aware Rich Section Editor":** recreate every reference OfferSection with no custom CSS; ≥6-button ChoiceButtonGroup; buttons duplicate/reorder/bulk-offer/per-button; every governed link/button/image/text-CTA has a `link_instance_id`; CTA Inventory present + accurate.
- **Phase 6 → "Layout registry + measured default layout":** uses `defaultListicleLayoutTokens`; no placeholder tokens; header/Disclosure/logo/H1/byline/hero/paragraphs match measured values; lower-page BLOCKERs resolved; host logo the only brand swap; host theme cannot override.
- **Phase 8 → include link-instance analytics:** CMS compares performance by exact CTA/link placement; drilldown answers which button/link drove clicks/conversions/revenue; revenue attribution preserves `link_instance_id` through the `click_id` join.

---

## 31. v1.2.2 Addendum — measurement, tracking integrity &amp; data quality

> No new product scope. Closes the final validation blockers. Where a value cannot be honestly measured here it is marked **REQUIRED CAPTURE** (not fabricated); the contract does **not** claim 1:1 parity until those land.

### 31.0 Layout blocker resolution — measurement protocol + provisional defaults
**Honesty note.** The desktop reference was measured (§30.1). The mobile (390px), Disclosure interaction, and exact lower-page values **must be captured from the live reference** (same pass Atlas ran for desktop). They are engineering measurements, not authoring choices, so they are **REQUIRED CAPTURE** rather than invented. Until captured, the tokens below are **PROVISIONAL** (derived from already-measured desktop tokens); parity acceptance (§14.5) stays gated.

Capture protocol per blocker (record into `reference-layout-mobile.json` / update `tokens.ts`, replacing `status`):

| Blocker | Capture | Provisional default (derived; confirm on capture) |
|---|---|---|
| Mobile 390px | Screenshot at 390×844 + computed CSS for header/H1/byline/hero/body/buttons/footer | header 64px; container padding-x 16px; H1 32px/39px; body 18px/27px; hero full-width 2:1 radius 5px; buttons full-width stacked |
| Disclosure interaction | Click the trigger; record type (anchor/modal/dropdown/accordion/scroll-to), animation, focus trap, dismiss | **REQUIRED CAPTURE** — implement measured behaviour; interim: in-page anchor scroll to a `#disclosure` legal block |
| Section heading (lower) | computed CSS of Section 1 heading | 28px/34px, weight 700, `#2a2a2a`, mt 28px mb 16px |
| Linked image (lower) | computed CSS of a Section image | full-width, 2:1, radius 5px, mt 12px mb 20px (matches hero) |
| Inline link | computed CSS of a provider inline link | `#ce2e35`, weight 700, no underline; hover `#b9272e` underline |
| Choice button | computed CSS of a CTA button | bg `#ce2e35`, `#fff`, 18px/24px weight 700, radius 6px, pad 14/18, min-h 52px, max-w 720px, full-width |
| Final text CTA | computed CSS of the final text link | `#ce2e35`, 20px/30px weight 700, mt 16px mb 22px |
| Legal disclosure | computed CSS of the legal block | 14px/21px, `#4b4b4b`, mt 32px mb 24px |
| Footer | computed CSS of the page footer | bg `#fff`, pad-top 24px pad-bottom 32px, logo 180px, links `#2a2a2a` 14px/22px, legal/copyright 12px/18px `#555` |

Each PROVISIONAL token in `tokens.ts` keeps `status: "PROVISIONAL: confirm on capture"` until replaced with `status: "measured"` + the real value.

### 31.1 Visual-regression thresholds (extends §25/§30.8)
- **Screenshot diff:** desktop **≤ 0.10%** changed pixels (misMatchThreshold 0.001) after `document.fonts.ready` + a 200ms settle; mobile (390px) **≤ 0.15%**. Full-page + per-region shots.
- **No masking** of header, Disclosure, logo, H1, byline, hero, buttons, typography, spacing, or footer. Masking is allowed **only** for third-party ad slots and user-supplied images.
- **Computed-style assertions** (exact, per region): header `height:64px` `background:#ce2e35` `border-bottom:1px #f4d1d3`; H1 `font-size:38px` `line-height:48px` `text-align:center` `max-width:820px`; byline avatar `31px` `gap:16px` text `12px/700 #4b5360`; hero `aspect-ratio:2/1` `border-radius:5px` `margin-bottom:22px`; paragraph `20px/30px #2a2a2a` `margin-bottom:15px`; choice button `#ce2e35 #fff 18px/700 radius6 min-height52`; footer per §31.0; Disclosure trigger `#fff 13px/16px` right-aligned. **Tolerances:** colours exact (hex/rgb), px `±1`, font-size/line-height exact. Any diff over threshold or any failed computed-style check = Phase 6 fail.

### 31.2 Canonical A/B hash (edge + client identical)
```js
// FNV-1a 32-bit over UTF-8 bytes of `${sid}|${test_id}`; bucket in basis points 0..9999.
function lstBucket(sid, testId) {
  var s = sid + '|' + testId, bytes = new TextEncoder().encode(s); // UTF-8
  var h = 0x811c9dc5;
  for (var i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; // *16777619 mod 2^32
  }
  return h % 10000; // 0..9999 bps
}
// assignment: first arm whose cumulative allocation (in bps) > bucket.
```
- One implementation shared by the edge Version picker and the client page selector (same UTF-8 input, same modulus).
- **Test vectors** (freeze in unit tests): `lstBucket("s1","exp_A")`, `lstBucket("s1","pg_2")`, `lstBucket("abc","t")` — record the exact integers on first implementation and assert them forever (regression guard against algorithm drift).
- **Distribution acceptance:** 1,000,000 random sids → each arm within **±50 bps** (±0.5%) of target; chi-square goodness-of-fit `p > 0.01`.

### 31.3 Canonical session id injection
- Worker sets the `ko_sid` cookie (30-min) **and** injects `<script>window._LST_SID="<sid>"</script>` via post-cache `HTMLRewriter` (not part of the cache key).
- The page selector uses `window._LST_SID`. It generates a client sid **only if `_LST_SID` is absent** (edge miss); it never overrides an edge-assigned sid. This keeps edge Version assignment and client page/rule selection on the **same** sid.

### 31.4 `page_view_id`
- Mint a UUID per page view (`window._LST_PVID`); stamp it on every event.
- Dedupe `section_impression` / `offer_impression` on `(page_view_id, entity_id, event_type)` so a re-render or SPA-less reload cannot double-count within one view.

### 31.5 Impression semantics
- **section_impression:** ≥ 50% of the Section box visible for ≥ **1000ms** continuous (IntersectionObserver `threshold:0.5` + dwell timer).
- **offer_impression:** ≥ 50% of the governed anchor/button visible for ≥ **500ms**.
- Fire **once per `(page_view_id, entity)`**; do **not** count while `document.hidden` (pause dwell on `visibilitychange`); repeated scrolling in/out does not re-fire.

### 31.6 Durable event delivery
- Send order: `navigator.sendBeacon` → on failure `fetch(url,{keepalive:true})` → on failure enqueue in a `localStorage` retry queue (flush on `load`, `visibilitychange→visible`, and `online`; cap + exponential backoff).
- **`event_id`** UUID on every event = idempotency key. Server dedup: ClickHouse `ReplacingMergeTree` already collapses by `event_id` in `ORDER BY` (+ `FINAL`); the ingest path also keeps a short-TTL KV seen-set to drop immediate replays before Firehose.
- Failed/oversized events → **dead-letter** (S3 prefix `listicles/dead-letter/` + `listicle_event_dead_letter` D1 row).
- **Daily reconciliation report:** beacon-accepted (204) count vs Athena-landed count vs CH-ingested count per site/day; variance over threshold alerts.

### 31.7 Provider revenue reconciliation (extends §19)
- **Dedupe** on `(provider, external_txn_id)` (unique in `listicle_postback_log`); replays are no-ops.
- **Unmatched `click_id`** → `listicle_revenue_unmatched` queue with a 72h re-match window (late clicks); after the window → reported as unattributed.
- **Currency normalization:** store native `currency` + normalized `revenue_usd` via a daily FX table (`listicle_fx_rates`).
- **Timezone normalization:** all revenue timestamps to **UTC**; cap accounting uses the Offer's `cap_timezone`.
- **Late-arriving revenue backfill:** re-run `lst_revenue_attributed_mv` over a trailing window (default 7 days) so late postbacks reattach to their click context.
- **Daily provider-total reconciliation:** provider report total vs ingested total per provider/day; variance flag + alert.

### 31.8 Bot / internal / preview filtering
- Stamp every event + session: `is_bot` (CF bot-management score below threshold or known-bot UA), `is_internal` (office IP allowlist or internal cookie), `is_preview` (preview host or `?preview=1`), and a rollup `traffic_quality_flag` (`clean` / `bot` / `internal` / `preview`).
- **Default A/B and revenue analytics EXCLUDE** `bot`/`internal`/`preview`; a raw unfiltered view is retained for audit. Cap counters and provider postbacks also ignore non-clean clicks.

### 31.9 New/changed schema for v1.2.2
- `lst_events_raw` + Athena `listicles.events` + `lst_sessions`: add `page_view_id, is_bot, is_internal, is_preview, traffic_quality_flag` (and confirm `offer_id`, `click_id`, `analytics_label` are present — they are, §17.1).
- New D1: `listicle_revenue_unmatched` (click_id, provider, external_txn_id, revenue, currency, revenue_usd, received_at, status), `listicle_event_dead_letter` (event_id, payload_json, reason, received_at), `listicle_fx_rates` (date, currency, usd_rate).
- Governed anchor / `/lc` gain `&pv={page_view_id}`; the resolver passes it onto the `offer_click` event.

---

*Listicles CMS — Design Contract · v1.2.2 · target `kodigital-homepages-cms-worker`. v1.1 article + page experimentation; v1.1.1 consistency pass; v1.2 measured default-layout parity + link-instance analytics (§30); v1.2.1 wires link-instance revenue attribution; v1.2.2 measurement/tracking-integrity/data-quality hardening (§31). Layout parity stays gated on the §31.0 REQUIRED CAPTURE items; resolve §14.5/§30.4/§31.0 + §28 blockers before their dependent phase.*

