# Listicles CMS v1.2.2 — Phase 10 Manual-QA & Hardening Report (PR10)

**Scope:** §25 testing plan · §26 manual QA (the full funnel) · §29 final checklist · §11 drilldown expander (the real UI gap) · §30.6 CTA density · §21 GA4 · §22 CWV/cache. Worktree `feat/listicles-phase10-hardening` on `origin/main` (phases 1–9 merged). **This is the mission's QA-evidence report; the conductor folds its verdicts into `traceability.md` (untouched here).**

**No fake green.** A step that cannot be truly validated on the local instance is labelled BLOCKED-on-external-dependency or PROXY, never PASS. Live Athena/ClickHouse data and real provider postbacks are data/ops-owned (no CH secret in dev) — proven at the closest honest proxy (seeded D1 mirror / unit-integration) and labelled.

---

## 1. What was built (deliverables)

| # | Deliverable | Files | Status |
|---|---|---|---|
| 1 | **§11 drilldown EXPANDER UI** (the register's endpoint-only gap) — a `+` per article row that async-hydrates `GET /articles/:id/drilldown` into a nested Version→Page→candidate table with per-row impressions/clicks/unique_clicks/conversions/ctr/cvr/revenue/rpc/rpm; rule_based pages add matched_sessions/fallback_sessions/rule_match_rate. ES5, skeleton while loading, empty-state, per-row Retry. Reuses the Phase-3 `getJson`/`.skel` machinery. | `api/src/admin/listicles/ui-lists.ts` (leading expander col + `ARTICLES_DRILLDOWN_SCRIPT`), `api/src/admin/listicles/ui-shared.ts` (CSS) | DONE — driven live + screenshot `analytics-01-drilldown-expander.png` |
| 2 | **Rebuild-range UI affordance** (Phase-8 deferred) — a "Rebuild analytics range" control (from/to date + button) calling `POST /api/admin/listicles/analytics/rebuild-range`, ES5, inline status + toast on result. | `api/src/admin/listicles/ui-lists.ts` (`renderRebuildRangeControl` + `ARTICLES_REBUILD_SCRIPT`) | DONE — `analytics-02-rebuild-range.png` |
| 3 | **Full §26 manual-QA e2e funnel** (headline) — drives each §26 group on local `wrangler dev` with a seeded dataset; evidence pack in `api/test-artifacts/listicles-manual-qa/`. | `api/test-ui/listicles-manual-qa.spec.ts` (15 tests) | DONE — 15/15 green |
| 4 | **CWV + cache + GA4 + homepage regression** (§22/§21/§25) | `api/test-ui/listicles-perf-regression.spec.ts` | DONE — CLS 0, LCP 28 ms, cache HIT, GA4, homepage untouched |
| 5 | **§29 final-checklist acceptance** T01/T02/T03 + run_all.sh | `api/scripts/acceptance/listicles-phase10/**` | DONE — 2/3 PASS, T03 NEEDS_RUNTIME (green under gate #5) |
| 6 | **Residuals closed / honestly re-affirmed** (opt-out table, office-IP allowlist) | see §5 | DONE — both honestly re-affirmed with evidence (no schema invented) |
| 7 | This report | `docs/listicles/PHASE10-QA-REPORT.md` | DONE |
| — | Phase-10 render/structure test for the new UI (7 tests) | `api/test/listicles-phase10-ui.test.ts` | DONE |

**Touched files (write-boundary held — asserted by T01):** product code only in `api/src/admin/listicles/ui-lists.ts` + `api/src/admin/listicles/ui-shared.ts`; tests in `api/test/` + `api/test-ui/`; acceptance in `api/scripts/acceptance/listicles-phase10/`; this report. **No migration, no existing route/cache/GA4/homepage source changed** (T01 `git diff --quiet` over the pillar-1 files).

---

## 2. §26 Manual-QA results

Driven against the real worker under `wrangler dev` (DEV_BYPASS_AUTH + ADMIN_HOST:127.0.0.1). Admin drives hit 127.0.0.1; the public funnel hits the seeded tenant host via Chromium `--host-resolver-rules`. Where a §26 sub-behavior is exhaustively driven by an earlier-phase spec, it is cited — **those specs re-run under the same gate #5**, so the citation is live Phase-10 evidence, not a hand-wave.

| §26 group | Behavior | Result | Evidence |
|---|---|---|---|
| **Offers** | required-field block; In-site⇒currency+value reveal; cap⇒amount/tz/count_by + fallback picker; macro chip at caret; `{clickid}`→`{click_id}` note; unknown-macro warn | **PASS** | manual-qa `offers-01-create-modal-filled.png`, `offers-02-created-row.png` |
| **Offers** | delete-in-use → 409 dialog + "Archive instead"; "View attribution to Sections" | **PASS** | `offers-03-409-in-use.png`, `offers-04-attribution.png` |
| **Offers** | edit → `{clickid}` persisted as `{click_id}` | **PASS (cited)** | `listicles-offers.spec.ts` 04-edit-normalized (gate #5) |
| **Sections** | create (name, image, headline → Offer modal → chip); **NO url field anywhere**; CTA/Link Inventory shows the governed link, zero "Missing Offer" | **PASS** | `sections-01-headline-chip-no-url-inventory.png` |
| **Sections** | check/emoji lists + colour spans; Button + inline link (both force Offer modal); ≥6-button choice group (reorder/duplicate/bulk-offer/per-button); full CTA inventory accuracy; "Offers used"/"Usage in Articles" | **PASS (cited)** | `listicles-sections.spec.ts` 01–07 incl. `02-choice-group-7-buttons.png`, `03-inventory-preview.png` (gate #5) |
| **Articles + exp** | published article renders the default layout; exactly one candidate per page; rule page → `rule_match` (desktop), mobile-rule page → `fallback`; sticky candidates across reloads; **zero CLS** | **PASS** | `articles-01-live-render.png`; `[mqa-cls-evidence] total=0` |
| **Articles + exp** | "A/B this Article" running experiment splits fresh sessions across both Versions (edge sticky, §15.2) | **PASS** | manual-qa test 5 (both `lander_v` arms observed over fresh contexts) |
| **Articles + exp** | equal-priority overlapping rules **BLOCK the save** with a §15.5 conflict report | **PASS** | manual-qa test 6 (live `PUT /versions/:id` → non-OK + conflict/overlap/priority payload) |
| **Articles + exp** | builder UI: edit control Version; 60/40 rail (Σ green only at 100); page `ab_test` 70/30; `rule_based` (state=CA&mobile→C / source=NewsBreak→D / fallback→E); the conflict-matrix cells; fork + new-revision | **PASS (cited)** | `listicles-articles.spec.ts` 01–13 incl. the highlighted §15.5 blocking matrix (gate #5) |
| **Tracking** | land with UTM+fbclid → `ko_sid` + `ko_ctx` set, `page_view` fires with acquisition dims | **PASS** | `tracking-01-landing.png` |
| **Tracking** | scroll → `section_impression` + `offer_impression` fire for the shown candidate only | **PASS** | `tracking-02-impressions.png` |
| **Tracking** | click → `/lc` mints `click_id`, 302 with the full first-party context (a/lv/p/s/c/m/lnk/role/pv) + resolved `{click_id}` macro | **PASS** | manual-qa test 8 (302 Location `cid=<uuid>`) |
| **Tracking** | `offer_click` fires with full context | **PASS (server-side)** | Emitted by the resolver via `ctx.waitUntil` → Firehose (§16), NOT a client beacon — covered by `resolver.ts` unit/integration (Phase 7). Not observable in-browser by design. |
| **Tracking** | hit cap → fallback offer/URL (one hop) | **PASS (proxy)** | Resolver cap-before-redirect + one-hop loop guard — unit/integration `listicles-*resolver*`/Phase-7 suite (a live cap-exhaustion drive is stateful/fragile; declared). |
| **Analytics** | drilldown Version→Page→candidate (the **NEW expander**) shows rule matched/fallback/`rule_match_rate` | **PASS** | `analytics-01-drilldown-expander.png` — 170/(170+30)=**85.00%** rendered inline |
| **Analytics** | postback with that `click_id` → `revenue_raw` → after sync shows in analytics | **PROXY (declared)** | Needs a provider token + live CH — **BLOCKED-on-external-dependency** end-to-end; proven at `listicles-postback.test.ts` (dedup + atomic revenue write) + the seeded D1 mirror the drilldown reads. |
| **Analytics** | manual backfill operator-accessible (rebuild-range) | **PASS** | `analytics-02-rebuild-range.png` — dev has no CH ⇒ honest `configured:false` no-op surfaced |
| **Tracking** | GA4 still loads | **PASS** | manual-qa test 7 + perf-regression (gtag loader + dataLayer + config with the site's id) |
| **Tracking** | homepage `/api/track` + `homepage.events` unaffected | **PASS** | `/api/track` 204 (single + batch + unknown-type drop); homepage renders non-listicle (`[mqa-homepage] status=200 home-marker=true`) |

**Screenshot pack:** `api/test-artifacts/listicles-manual-qa/` (10) + `api/test-artifacts/listicles-perf/` (1).

---

## 3. §22 CWV + cache + §21 GA4 (perf/regression)

| Metric | Target (§22/§31.1) | Measured (local dev) | Result |
|---|---|---|---|
| CLS on a rendered listicle | 0 (structural) | `CLS=0` | **PASS** |
| LCP | reasonable | `LCP=28ms` (generous 4 s local ceiling; logged) | **PASS** — production edge is faster; local is the honest pre-deploy proxy |
| Cache HIT (2nd request) | byte-identical + 304 | `first=8ms second=7ms etag="3c08bf66107158f1"`; conditional GET → 304 empty body | **PASS** (Phase-6 KV/Cache-API mechanism) |
| Cache-Control / nosniff | `public, max-age=300, stale-while-revalidate=86400` + nosniff | exact match | **PASS** |
| GA4 via `analytics_script` | loader + dataLayer + config(id) | present on the fixture site | **PASS** |
| Homepage render + `/api/track` 204 + events schema | untouched | homepage non-listicle 200; `/api/track` 204 for single/batch/unknown-type; `HomepageEvent` shape byte-unchanged | **PASS** (pillar 1) |

---

## 4. Gates (verbatim tails, from `/private/tmp/listicles-p10/api`)

```
GATE 1  npx tsc --noEmit
  TSC_EXIT=0

GATE 2  npx vitest run  (full)
  Test Files  245 passed (245)
       Tests  2071 passed (2071)         # 2064 baseline + 7 new Phase-10 UI tests

GATE 3  npm run verify:no-legacy-prod-refs
  verify:no-legacy-prod-refs OK -- no banned legacy production identifiers found (Group A + Group B).

GATE 4  bash scripts/acceptance/listicles-phase10/run_all.sh
  PASS [T01] §29 guardrails: no-legacy green; pillar-1 files byte-unchanged; write-boundary held; ES5 gate present
  PASS [T02] every §29 area has implementation + tests present
  NEEDS_RUNTIME [T03] specs present + cover every §26/§22 drive; no dev server on :8787 (run gate #5)
  ----------------------------------------
  listicles-phase10: 2/3 pass, 1 needs-runtime, 0 failed        # exit 0

GATE 5  npm run seed:local && npx playwright test  (full)
  seed:local  → SEED_EXIT=0
  63 passed (1.0m)                     # every test-ui spec incl. the 2 new Phase-10 specs; 0 failed

  # Phase-10 specs in isolation (the §26 funnel + perf/regression), for the record:
  15 passed (16.6s)
  [mqa-cls-evidence] total=0   [p10-cwv] CLS=0 LCP=28ms   [p10-cache] first=9ms second=6ms etag="4c1443aaaca5edad"
  [mqa-homepage] status=200 home-marker=present   [p10-homepage] status=200 home-marker=present

GATE 6  git status --porcelain
   M api/src/admin/listicles/ui-lists.ts
   M api/src/admin/listicles/ui-shared.ts
   M docs/listicles/traceability.md          # ← CONDUCTOR's parallel register update (NOT this mission; conductor-owned, left untouched)
  ?? api/scripts/acceptance/listicles-phase10/
  ?? api/test-ui/listicles-manual-qa.spec.ts
  ?? api/test-ui/listicles-perf-regression.spec.ts
  ?? api/test/listicles-phase10-ui.test.ts
  ?? docs/listicles/PHASE10-QA-REPORT.md
  # no commit (per brief). This mission's product changes = the 2 admin-UI files only
  # (T01 write-boundary). traceability.md is the conductor's file — this mission never wrote it.
```

## Post-review MINOR tightenings (applied in-branch, working-tree)

Final adversarial review = SHIP (0 blocker/major); 3 MINOR fixes applied:
- **MINOR-1** — homepage-untouched checks (both specs) now assert a hard `status === 200` **and** a POSITIVE `home-(grid|section)` marker, so a blank/degraded non-5xx homepage fails (not just listicle-marker absence). `/api/track` 204 single/batch/unknown-drop kept.
- **MINOR-2** — the rebuild control's success branch no longer reports a clean "Rebuild complete: N rows" when `configured:true` with a non-empty `errors[]`: it surfaces "Rebuilt N rows, M table(s) failed" + an error toast (§18 per-table isolation honesty). The `configured:false` no-op path is unchanged.
- **MINOR-3** — the mislabeled `listicles-phase10-ui.test.ts` case (was a bare `lst-drill-box` grep under a hydrator-isolation title) is now a real column-count parity assertion: header `<th>` == article-row `<td>` == `ARTICLE_COLUMN_COUNT`, with the detail-row `colSpan` derived from the live cell count.

---

## 5. §-grounded decisions & honest residuals

### Decisions
- **Expander lives on the Articles analytics surface** (§11 "Drilldown (`+`)"): a leading expander column on the site-scoped Articles list; the detail row is DOM-built with **no** `data-entity-id`/`data-metric`, so the shared analytics hydrator never touches it. `ARTICLE_COLUMN_COUNT` bumped 1→ (1+4+analytics+1); detail-row `colSpan = row.cells.length`.
- **Reuse, not reinvention:** both new scripts consume `window.lstUi.getJson` + the `.skel` shimmer; strict ES5 (byte-parsed by `listicles-ui-es5.test.ts` — the Articles page carries both scripts, so the gate covers them). tsc strict green.
- **Rebuild-range is honest about dev:** no CH secret in dev ⇒ `rebuildRange` returns `configured:false`; the control surfaces "No ClickHouse configured — mirror rebuild is a no-op here." rather than faking a row count.
- **`offer_click` is server-side** (resolver `ctx.waitUntil` → Firehose): the observable client proof of a click is the `/lc` 302 + minted `click_id`; the event emission is unit/integration-covered. Not faked as a client beacon.
- **Analytics evidence is a seeded D1 mirror** (the standard local path, no live CH): rule_match_rate 170/200 = 85.00% is seeded and read back through the real endpoint + the real expander UI. Labelled PROXY for the Athena→CH→D1 pipeline.

### Residuals — honestly re-affirmed (no schema invented; DEV-14)
- **Opt-out `privacy_opt_outs` table path → re-affirmed Sec-GPC/cookie is the honest boundary.** There is **no identifier scheme anywhere in the repo** for a table-backed opt-out (the homepage never reads it either; CMP ownership per rescue-7). Wiring a table without an identifier would be inventing schema. The live opt-out path honors `Sec-GPC:1` and `ko_optout=1` before emit (§24) — unchanged and correct. **Boundary is intentional, not a code gap.**
- **Office-IP `is_internal` allowlist → re-affirmed cookie-only.** `computeTrafficQuality` is called at **two** sites: `src/analytics/listicle-track.ts` (in-scope) **and** `src/public/listicle/resolver.ts` (out-of-scope for this hardening pass). A correct allowlist must fire at **both** (an office IP must be internal for cap-exclusion in the resolver, not only for event flags) — wiring only the track side would be a **real correctness bug**, and IPv4/IPv6 CIDR matching is non-trivial. So this is the "else" branch of the brief: **cookie-only (`ko_internal=1`) remains the honest, uniform §31.8 boundary.** No dead/partial code, no `env.ts`/`listicle-quality.ts` change shipped. A future session can add `LST_INTERNAL_CIDRS` (typed-optional) + a CIDR helper wired atomically at BOTH quality-computation sites.

### Residuals BLOCKED-on-external-dependency (data/ops-owned, not code gaps)
- **Live Athena→ClickHouse→D1 attribution trace** (real `click_id` traced end-to-end): needs the external Athena→CH pipeline + a live CH secret (user-activated `wrangler secret put`). Proven at the seeded-mirror + CH DDL-applied-live (Phase 8) + resolver/postback units. **Not verifiable pre-deploy locally.**
- **Real provider postback → revenue**: needs a provider token (`wrangler secret`) + a real report source. Proven at `listicles-postback.test.ts` (dedup + atomic write + 401/404). **Ops/data-owned.**
- **Production-instance CWV / cache-age headers**: LCP/cache measured on local miniflare (no CDN tier). Production edge numbers are a ship/DEPLOY_AND_VERIFY concern (deploy is user-owned).
