# Listicles CMS v1.2.2 — Contract Traceability Register

**Contract:** `docs/listicles/design-contract-v1.2.2.md` (single source of truth; §1–§31).
**Delivery:** one PR per contract phase (§27), sequential: PR1=Phase 1 … PR10=Phase 10.
**Status legend:** `PENDING` (not yet implemented) · `PASS` (implemented + evidence) · `FAIL` (implemented, evidence failed) · `BLOCKED` (named blocker, honest — never narrated away).
Every status flip must cite runnable evidence (command + result) in the PR that flips it.

## Program-level deviations & resolutions (verified against the repo)

| # | Contract says | Reality / resolution |
|---|---|---|
| DEV-1 | Migrations `0031/0032/0033` (§6, last applied 0030) | `0031_restore_subtitle_contract.sql` landed on main (PR #61) after the contract was written → listicle migrations ship as **`0032_listicles_core.sql` / `0033_listicles_analytics_mirror.sql` / `0034_listicles_revenue_infra.sql`**. Contract§→file mapping is 1:1 otherwise. |
| DEV-2 | `sites.id` type to confirm (§28 Q2) | `sites.id` is `TEXT PRIMARY KEY` (migration 0002) → `listicle_articles.site_id TEXT` as the contract wrote. RESOLVED. |
| DEV-3 | CI guard `verify:no-legacy-prod-refs` (§1) | Already exists (`api/scripts/verify/assert-no-legacy-prod-refs.ts`); its banned set covers the contract's §1 list plus legacy account/KV/AUD ids. The vendored contract file is allowlisted as an approved reference doc (its §1 quotes the banned tokens as red lines). |
| DEV-4 | — | Production deploy is **not** on merge: deploy.yml deploys **staging** on main push; production requires explicit `workflow_dispatch` (`target_env=production`). Merge = staging consent; production dispatch = user-triggered. |
| DEV-5 | GA4 "via CMS Settings" (§21) | Confirmed mechanism: per-site `analytics_script` setting → `renderCustomHead()` in the public layout. No hardcoded gtag exists. Listicle pages must compose the same head path (PR6). |
| DEV-6 | Column lists without full DDL (postback_log, revenue_raw, revenue_unmatched, event_dead_letter, fx_rates) | Authored details in `0034` (documented here, minimal): surrogate `id` PKs; `UNIQUE (provider, external_txn_id)` per §31.7; `listicle_revenue_raw.synced_to_ch_at` NULL-until-shipped marker (required by §19 "sync ships **new** rows"); `revenue_unmatched.status ∈ pending/matched/unattributed` (§31.7 lifecycle); `fx_rates` PK `(date, currency)`. |
| DEV-7 | Acceptance shell tests under `acceptance-tests/…` (§6 pattern reference) | `acceptance-tests/` is reserved by an installed a2z git pre-commit guard for pipeline-generated mission suites (immutability contract). The listicles phase suites keep the same `Txx_*.sh` per-assertion pattern but live at **`api/scripts/acceptance/listicles-phase<N>/`** alongside the repo's other `scripts/*` checks. No guard bypass used. |

## Phase 1 — D1 schema (PR1)

**Verification run (2026-07-03, worktree @ origin/main `8f949af` + PR1):** `api/scripts/acceptance/listicles-phase1/run_all.sh` → **8/8 pass, 0 needs-runtime, 0 failed** (T01 behavioral: `wrangler d1 migrations apply --local` clean + **22** `listicle_` tables counted in local D1) · `npx tsc --noEmit` green · `npm test` → **198 files / 1524 tests passed** · `npm run verify:no-legacy-prod-refs` green + bite-proven (a fixture planted with a Group-A banned token was detected as `api/src/tmp-bite-fixture.ts:1` → offender, then removed; the register itself stays free of the banned literals by design).

| Requirement (contract §) | Files | Evidence | Status |
|---|---|---|---|
| `listicle_offers` incl. cap fallback cols + CHECK enums (§6) | `api/migrations/0032_listicles_core.sql` | acceptance `T02`,`T03`; local apply | PASS |
| `listicle_sections` (§6) | `0032` | `T02` | PASS |
| `listicle_section_offers` derived index, **6-role CHECK** (§6+§30.7) | `0032` | `T04` | PASS |
| `listicle_section_link_instances` + 2 indexes (§30.7) | `0032` | `T04` | PASS |
| `listicle_articles` base, `UNIQUE(site_id, slug)`, `site_id TEXT` (§6, Q2) | `0032` | `T03` | PASS |
| `listicle_article_experiments` + partial unique running (§6) | `0032` | `T03` | PASS |
| `listicle_article_versions` (`public_id`≡`lander_v`, `byline_json`, `content_version`) (§6+§30.2) | `0032` | `T02`,`T04` | PASS |
| `listicle_pages` (selection_mode CHECK, `UNIQUE(article_version_id, page_index)`) (§6) | `0032` | `T03` | PASS |
| `listicle_page_section_candidates` — **no `rule_id`**, `UNIQUE(page_id, section_id)` (§6, v1.1.1 #13) | `0032` | `T03` negative assertion | PASS |
| `listicle_page_rules` — `candidate_id UNIQUE` FK, one direction (§6) | `0032` | `T03` | PASS |
| `listicle_offer_cap_counters` PK `(offer_id, cap_date)` (§6/§9.3) | `0032` | `T03` | PASS |
| 5 mirrors incl. `article_version_revision` in PKs + drilldown rule dims (§6+§30.7, v1.2.1 "five") | `api/migrations/0033_listicles_analytics_mirror.sql` | `T05` | PASS |
| Revenue/platform/quality tables ×6 (§19/§20/§31.9) | `api/migrations/0034_listicles_revenue_infra.sql` | `T06` | PASS |
| Migrations apply **local** (§6) | `npm run db:migrate:local` | `T01` behavioral: clean apply + 22 tables | PASS |
| Migrations apply **remote** (staging at merge; production at dispatch) (§6/§27) | CI deploy.yml steps | post-merge CI logs + remote table probe (D3/D4 rule) | PENDING |
| deploy.yml grep-anchors for all 3 files (repo D1-file rule) | `.github/workflows/deploy.yml` | `T07` | PASS |
| Guard green incl. vendored docs (§1) | `api/scripts/verify/assert-no-legacy-prod-refs.ts` allowlist | `T08` + bite-proof above | PASS |
| Contract + layout package vendored (§30.1 package list) | `docs/listicles/{design-contract-v1.2.2.md, reference-layout-audit.md, reference-layout-desktop.json, reference-layout-mobile.json}` + `api/src/public/listicle/layouts/default/tokens.ts` | `T08`; tokens preserve 11 BLOCKER statuses verbatim | PASS |

## Phase 2 — Admin API (PR2)

| Requirement | Files | Evidence | Status |
|---|---|---|---|
| Domain core: ULID public_ids ×9 prefixes (§5 ID strategy, §30.7 `lnk_`) | `api/src/listicles/ids.ts` | unit | PENDING |
| Macro registry 33 tokens + `{clickid}` normalization + unknown-macro reject (§9.4) | `api/src/listicles/macros.ts` | unit incl. count==33 | PENDING |
| Validators offer/section/article/version/page, field-keyed errors (§23) | `api/src/listicles/validation.ts` | unit | PENDING |
| Rule engine: typed sets/ranges, interval intersection, equal-priority overlap → §15.5 payload (§15.4/§15.5) | `api/src/listicles/rules.ts` | unit (06–12 × 10–18 ⇒ 10–12) | PENDING |
| Offers CRUD + search(≤50 active) + usage + analytics + 409-with-usage (§7.1/§9) | `api/src/admin/listicles/{router,offers-handlers}.ts` | integration | PENDING |
| Sections CRUD + content_html re-render + link-instance extraction + `section_offers` rebuild + `__headline__` row + 409 (§7.1/§10/§30.7) | `sections-handlers.ts`, `api/src/listicles/link-instances.ts` | integration | PENDING |
| Articles base+control txn, experiments Σ=100, PUT /versions/:id atomic, /pages/:id/validate, structure/analytics/drilldown (§7.1/§11) | `articles-handlers.ts`, `versions-handlers.ts` | integration incl. induced mid-txn failure | PENDING |
| All under `accessAuth` + `ADMIN_HOST` + `private, no-store` (§7.1/§24) | `router.ts` mount | integration 404/401 | PENDING |

## Phase 3 — Admin UI (PR3)

| Requirement | Files | Evidence | Status |
|---|---|---|---|
| NAV entry after Pages + `ICON_LISTICLES` (§4) | `api/src/admin/templates/layout.ts` | grep + render test | PENDING |
| `renderListiclesTabs`; `/admin/listicles` → 302 offers; 3 tab pages 200 (§4) | `api/src/admin/listicles/templates/*.ts` + ui routes | integration | PENDING |
| Lists: toolbar/table/pager/empty-state; Articles site-scoped; async analytics skeletons (§8) | list templates | render tests + Playwright | PENDING |
| Create/Edit Offer modal: all §9 fields, conditional reveals, 33 macro chips, cap fallback | `offer-modal.ts` | Playwright + ES5 check | PENDING |
| 409 usage dialog + "Archive instead"; attribution view (§5.3/§9) | offers page | Playwright | PENDING |
| All inline scripts ES5 (repo invariant) | all new templates | extended `admin-layout-shell` assertion | PENDING |

## Phase 4 — Editor (PR4)

| Requirement | Files | Evidence | Status |
|---|---|---|---|
| Governed grammar: `button`, `offerlink` mark, list markers, colour tokens, emoji; free-text URL impossible (§12) | editor listicle config + section editor template | DOM: no URL input; save blocked w/o Offer | PENDING |
| v1.2 blocks `choice_button_group`/`final_text_cta`/`linked_image` + presets w/ `layout_binding` (§30.5) | editor types + renderers | round-trip + rendered `data-*` attrs + rel | PENDING |
| Offer-selection modal as the single link mechanism (§13) | `offer-modal.ts` reuse | e2e | PENDING |
| Link instances minted per governed element; `__headline__`; validation blocks missing row (§30.7) | save pipeline | unit + integration | PENDING |
| ≥6-button groups, reorder/duplicate/bulk-assign (§30.5) | editor UI | e2e | PENDING |
| CTA/Link Inventory accurate + bulk replace + jump (§30.6) | section editor | e2e vs content_json | PENDING |

## Phase 5 — Builder (PR5)

| Requirement | Files | Evidence | Status |
|---|---|---|---|
| Base + auto control Version; versioning invisible until Version 2 (§11) | article-builder template | e2e | PENDING |
| A/B rail: Σ=100 indicator, one control, ≤1 running experiment (§15.8/§23) | builder + API guards | e2e + integration | PENDING |
| Pages builder 3 modes; per-page ab Σ=100; rule editor + conflict matrix render; one fallback (§11/§15.5/§23) | builder | e2e: equal-priority overlap blocked w/ matrix | PENDING |
| Section preview in real wrapper; Version preview (force arm/candidate, simulate rules, CTA density) (§30.6) | preview templates | e2e | PENDING |
| Unsaved-changes guard; UI states (§8) | builder | e2e | PENDING |

## Phase 6 — Render/layout/cache (PR6)

| Requirement | Files | Evidence | Status |
|---|---|---|---|
| REQUIRED CAPTUREs: mobile 390, Disclosure interaction, 8 lower-page groups → statuses `measured` (§30.4/§31.0) | tokens.ts, `reference-layout-mobile.json`, `reference-{desktop,mobile}.png` | Playwright capture artifacts; zero BLOCKER/PROVISIONAL | PENDING |
| Layout registry; unknown id → default (§14) | `api/src/public/listicle/layouts/registry.ts` | unit | PENDING |
| Default layout from tokens; scoped `[data-layout="default"]`; no leak (§14/§30.1) | `…/default/{styles,components}.ts` | leak test + visual | PENDING |
| Component tree + byline render (§30.2) | components | visual regression | PENDING |
| Locked editing: tokens host-immune; logo only brand swap (§30.3) | components + site settings read | override test | PENDING |
| Public `/:slug` listicle render; homepage untouched (§7.2) | `api/src/public/router.ts` + `…/listicle/render.ts` | e2e + homepage regression | PENDING |
| `listicleKey()` incl. `lander_v`+`content_version`; header + ETag (§22) | `api/src/cache/cache-keys.ts` + pipeline reuse | unit + header test | PENDING |
| Per-Version shells; edge sticky pick; `ko_ver` (§15.2) | render + experiment-pick | e2e sticky | PENDING |
| Section fan-out invalidation → bump Version `content_version` → invalidate + warm (§22.2) | `api/src/listicles/invalidate.ts` | integration | PENDING |
| Payload guard ~40KB/50%; above-fold never lazy; below-fold reserved dims, zero CLS (§22.4, v1.1.1 #10) | render + selector | e2e CLS==0 | PENDING |
| Visual regression: desktop ≤0.10%, mobile ≤0.15%, computed-style exact (§30.8/§31.1) | `api/test-ui/listicle-visual.spec.ts` | Playwright diff report | PENDING |
| GA4 loads via `analytics_script` head path (§21, DEV-5) | render head + fixture | Playwright dataLayer/gtag | PENDING |

## Phase 7 — Tracking/experimentation runtime (PR7)

| Requirement | Files | Evidence | Status |
|---|---|---|---|
| Firehose `listicle-events` stream + Athena `listicles.events`/`sessions`; homepage stream untouched (§16) | `api/src/analytics/listicle-events.ts` + `infra/listicles/{aws-provision.md,athena-ddl.sql}` | provision via aws-mcp; test event lands in S3/Athena | PENDING |
| 6 event types, full §16 column set + v1.2 link dims + `page_view_id` + quality flags (§16/§30.7/§31.9) | beacon + track router + resolver | schema tests per type | PENDING |
| `ko_sid` reuse; `ko_ctx` acquisition cookie (§16) | beacon + render | e2e | PENDING |
| Canonical FNV-1a bps hash, ONE impl edge+client, frozen vectors, ±50bps/1M + chi-square (§31.2) | `ab-hash.ts` + ES5 twin | unit + distribution test | PENDING |
| `_LST_SID` injection; client fallback only if absent (§31.3) | ctx-inject | e2e | PENDING |
| `__LST_CTX` post-cache HTMLRewriter; geo never in key (§15.4, v1.1.1 #9) | ctx-inject | byte-identical shell test | PENDING |
| Pre-paint page A/B + rule selection; `__LST_CHOSEN`; selection_reason set (§15.3) | selector-script (ES5) | e2e sticky, one visible | PENDING |
| `page_view_id` mint + impression dedupe (§31.4) | beacon | e2e no double-count | PENDING |
| Impression semantics 50%/1000ms & 50%/500ms; hidden-tab pause; once per (pv, entity) (§31.5) | beacon IO/dwell | e2e | PENDING |
| `/lc` resolver: active-only, click_id, 33 macros, cap-before-redirect, fallback one hop, fail-safe `/`, `offer_click` full context (§7.3/§9.3) | `resolver.ts` | unit + integration | PENDING |
| Durable delivery: beacon→keepalive→retry queue; `event_id` idempotency; KV seen-set; dead-letter; daily reconciliation (§31.6) | beacon + track router + cron | unit + integration | PENDING |
| Bot/internal/preview flags; excluded from A/B+revenue+caps (§31.8) | track enrich + resolver + CH queries | unit | PENDING |
| Privacy: `privacy_opt_outs` honored before emit (§24) | track router | integration | PENDING |

## Phase 8 — ClickHouse + D1 mirrors (PR8)

| Requirement | Files | Evidence | Status |
|---|---|---|---|
| `lst_events_raw`/`lst_sessions`/`lst_revenue_raw` DDL per §17.1 (+v1.2.2 cols) | `infra/listicles/clickhouse-ddl.sql` | applied over CH HTTP; SHOW CREATE checks | PENDING |
| `lst_revenue_attributed_mv` + 5 daily targets/MVs; offer impressions from `offer_impression`; `WHERE notEmpty(offer_id)` after JOIN (§17.2/§17.3) | same | DDL review + sanity SELECTs | PENDING |
| Counting rules §17.3 (uniqExact, matched/fallback, read-time rates) | DDL + mirror sync | fixture test | PENDING |
| `syncListicleAnalytics` in every-minute cron, isolated try/catch, 2-day window, idempotent upsert, rebuild-range (§18) | `api/src/listicles/mirror-sync.ts` + `api/src/index.ts` | run-twice test | PENDING |
| CMS reads only the 5 mirrors; NULLIF ratios (§8/§18) | admin handlers | zero-denominator fixtures | PENDING |
| Dashboard compat: shared join keys stable (§18) | DDL | review row | PENDING |
| CH secrets `CH_URL/CH_USER/CH_PASSWORD` (wrangler secrets via CI) (§18/§24) | GH secrets + deploy.yml step | CI logs; no secret in code | PENDING |

## Phase 9 — Revenue + platforms (PR9)

| Requirement | Files | Evidence | Status |
|---|---|---|---|
| `/api/pb/:provider`: verifyToken, dedupe `(provider, external_txn_id)`, insert revenue_raw, fast 200 (§19/§31.7) | `postback-router.ts`, `api/src/listicles/revenue.ts` | replay no-op; 401 | PENDING |
| Unmatched 72h queue → matched/unattributed; FX `revenue_usd`; UTC; 7-day MV backfill; provider-total reconciliation (§31.7) | revenue.ts + cron | unit + fixture | PENDING |
| script/API channel scheduled pulls (§19) | revenue.ts cron | integration | PENDING |
| Browser pixel channel: client `conversion` event (§19) | beacon | e2e | PENDING |
| in-site payout + conversion cap increment (§9.3/§19) | revenue.ts + caps | unit | PENDING |
| Outbound S2S dispatcher: config-driven, `ctx.waitUntil`, FB first (fbc/fbclid from ko_ctx), failures logged (§20) | `s2s-dispatch.ts` + platform seed | unit + integration | PENDING |

## Phase 10 — Hardening (PR10)

| Requirement | Evidence | Status |
|---|---|---|
| Full §26 manual QA (offers/sections/articles+experiments/tracking+analytics) | Playwright evidence pack (screenshots + network) | PENDING |
| End-to-end attribution: real click's `click_id` traced Athena→CH→`lst_revenue_attributed`→D1 mirror→drilldown with `link_instance_id` intact (§30.7) | trace transcript | PENDING |
| CWV + cache-hit target + `/lc` latency (§22) | measurements | PENDING |
| GA4 + homepage analytics/cache regression green (§21/§25) | test runs | PENDING |
| §29 final checklist — every box | checklist with evidence | PENDING |
| A/B validity: frozen vectors, distribution, stickiness, conflict guard (§15.8/§31.2) | test runs | PENDING |

## §28 items not requiring build work
Q5 (D1 atomic baseline — DO deferred), Q9 (RBAC later; `created_by` captured), Q10 (emoji/GIF later), Q11 (reuse `privacy_opt_outs`), Q12 (multi-language out of scope v1), Q14 (soft cap 4 — UI warning). Q6 providers: FB first, adapter map extensible. Q8 `{language}`: resolve at PR7 from site settings if available, else empty + documented. Q13 daypart tz = site tz.
