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
| DEV-4 | — | Deploys are **not** on merge: main push runs CI only. Staging deploy is push-driven but gated on repo variable `ENABLE_STAGING_DEPLOY == 'true'` (currently unset — off by design, "a merge to main cannot accidentally deploy"); production is `workflow_dispatch`-only (`target_env=production`). Per the 2026-07-03 delegation, Claude dispatches production after each merged phase PR and verifies migrations + behavior post-deploy. |
| DEV-5 | GA4 "via CMS Settings" (§21) | Confirmed mechanism: per-site `analytics_script` setting → `renderCustomHead()` in the public layout. No hardcoded gtag exists. Listicle pages must compose the same head path (PR6). |
| DEV-6 | Column lists without full DDL (postback_log, revenue_raw, revenue_unmatched, event_dead_letter, fx_rates) | Authored details in `0034` (complete enumeration): surrogate `id` PKs; `UNIQUE (provider, external_txn_id)` per §31.7 with `external_txn_id NOT NULL`; `postback_log` working columns (`click_id`, `offer_public_id`, `event_ts`, `payload_json`, `received_at`); `listicle_revenue_raw.synced_to_ch_at` NULL-until-shipped marker (required by §19 "sync ships **new** rows"); `revenue_unmatched.status ∈ pending/matched/unattributed` (§31.7 lifecycle); `fx_rates` PK `(date, currency)`; five lookup indexes (`idx_listicle_pblog_click`, `idx_listicle_revraw_unsynced` partial, `idx_listicle_revraw_click`, `idx_listicle_revunmatched_status`, `idx_listicle_deadletter_event`); **naming**: the D1 staging column is `offer_public_id` (it stores the Offer public id) where contract §19 writes `offer_id?` and CH `lst_revenue_raw` keeps `offer_id` — the Phase-9 D1→CH shipper MUST map `offer_public_id → offer_id` explicitly. |
| DEV-7 | Acceptance shell tests under `acceptance-tests/…` (§6 pattern reference) | `acceptance-tests/` is reserved by an installed a2z git pre-commit guard for pipeline-generated mission suites (immutability contract). The listicles phase suites keep the same `Txx_*.sh` per-assertion pattern but live at **`api/scripts/acceptance/listicles-phase<N>/`** alongside the repo's other `scripts/*` checks. No guard bypass used. |
| DEV-8 | "Macro registry (**33 tokens**)" (§9.4) | §9.4 enumerates **32** tokens. Implemented as 32 canonical + `{clickid}` accepted strictly as a normalization **alias** of `{click_id}` (33 accepted spellings). Unit-tested: canonical count == 32, alias normalizes on save and resolves at runtime, unknown macros rejected. |
| DEV-9 | Phase-2 surfaces the contract left open | Authored (documented in code): `:id` route params accept internal id OR `public_id`; no `GET /articles/:id` (not in §7.1 — `/structure` is the detail read); **`DELETE /articles/:id` added** (§5.3 hard-delete cascade + §11 Delete action; cascade proven by test); `conditionsHash`/`matched_rule_json_hash` = SHA-256 hex over recursively key-sorted JSON (arrays order-preserved) — every future producer must reuse it; `hour`+`daypart` share one half-open `[start,end)` time axis; `content_version` bumps on **structural** change only (fingerprint over pages/candidates/rules + allocations; byte-identical re-save is a no-op); `lnk_` public ids are stable across saves while `(block_id, link_role, offer_id, position)` survives; archived Sections can't be candidates; non-active Offers can't be link targets; Offers referenced as cap-fallbacks are delete-protected via the same 409-usage payload; PR4 block types contribute no HTML yet but their offer bindings are already extracted/governed. **§15.6 interim posture (until the Phase-5 fork flow):** Version in a **running** experiment → ALL edits 409 `running_version_immutable` (strictest); Version of a **published** article → structural edits 409 `published_version_immutable` (case c), field-only edits allowed as case-b revision bumps — safe because `article_version_revision` is a PK dimension in every mirror, so revisions never mix; the Phase-5 builder MUST add the operator fork / "start a new revision period" flow (§30.7 case c). Phase-8 note: the drilldown endpoint currently collapses `article_version_revision` (the mirror keeps it; expose if revision-level drill is wanted). CI note: integration suites skip if `node:sqlite` is absent — CI runs Node 24 (has it); the CI test count (1630) is the tripwire. |
| DEV-10 | Phase-3 surfaces the contract left open | Authored/declared: **§4 `/new\|/:id/edit` shell routes deferred** to Phases 4/5 — Sections/Articles tabs ship list-only with visibly disabled Create buttons ("ships in Phase 4/5"), no dead routes registered; **Articles toolbar has no search box** (the Phase-2 list API takes only `site_id`+paging; search ships with the Phase-5 builder); **§11 `article_id`** rides `data-entity-id` (no visible id column) until the Phase-8 drilldown; **hydration helper**: analytics cells hydrate per-row after paint via a small `getJson` ES5 helper instead of `window.api` — `window.api` swallows HTTP status codes, which the 409-usage and field-error flows need; same per-row/after-paint/skeleton semantics as §8; **UI reads through the Phase-2 handlers in-process** (`listicleApi.request`) — zero duplicated SQL; only constant `SELECT DISTINCT` filter-option reads are direct (literal-only); **Playwright screenshots** land in `api/test-artifacts/` (the html reporter clears `test-results/` at report time); **edit modal adds a Status select** (hidden on create — §9's Status column/filter implies lifecycle control; server already allow-lists it); curated convenience lists (8 IANA cap timezones, 4 payout currencies — server accepts any); `admin-layout-shell.test.ts` NAV_CONTRACT updated 9→10 entries (the §4 nav insertion; the only test hardcoding the count). |
| DEV-11 | Phase-4 surfaces the contract left open | Authored (documented in code): **ES5 invariant with the shared editor** — the pre-existing `editorScripts` atom is ES6; the editor page's single script must embed that atom byte-identically exactly once, everything else strict ES5, whole tag `node --check`-parsed; a tripwire test asserts the DEFAULT (non-listicle) editor emits zero listicle markers. **Server-authoritative `lnk_` ids**: client sends empty ids; save enriches content_json with resolved `lnk_` + canonicalizes offer refs to `off_` public ids; placement-keyed reuse means reorders mint fresh ids (position-sensitive analytics, by design). **Preset→binding mapping** where §30.1 has no dedicated tokens: Qualification Heading→`default.sectionHeading`, Step Text/Question Prompt→`default.bodyParagraph`, Disclaimer/Legal→`default.legalDisclosureBlock`, Spacer→`default.sectionWrapper`. **Highlight palette**: `brandTint` (token-derived) + `sun`/`mint` authored (contract names no highlight palette); unknown tokens rejected at save AND dropped at render. **`POST /sections/preview`** added (lenient structural parse, same govern pass, `sandbox=""` iframe). **tokens-to-css structural numerics** (767px breakpoint, 1px outline, 1.4em ordered indent) have no backing token — structural, not divergent. Residuals: AI generation not e2e'd (no key in dev; surfaces asserted); GIF rides `image/*`; free emoji in text is unrestricted unicode (markers are curated). |
| DEV-12 | Phase-5 surfaces the contract left open | Authored: **fork semantics** (§15.6 case c) = pure clone — new `ver_`/lander_v, `content_version` reset, `is_control=0`, allocation 0, next-free letter; pages/candidates/rules deep-copied with NEW public ids; group ids `ab_test_id`/`rule_set_id` copied AS-IS (sticky continuity across a fork); **`join_experiment` requires the target experiment be `draft`** (running/stopped → 409; running arm-sets compose via stop→new draft→start — closes the review-proven Σ=140 hole); **new-revision** (§30.7 case c consent) = PUT's exact atomic pipeline + UNCONDITIONAL bump, bypassing ONLY the two immutability 409s (§23 validation + §15.5 guard still block); **`layout_style_id` promoted to case-c** on published versions (§30.7 literally names "layout change"; headline/intro/hero/byline stay case-b, revision-separable per DEV-9); **draft experiments**: `active_experiment_id` stays NULL until start (§5.2 running pointer); draft-rail allocations persist at `/start` (reload before start reverts — declared trade-off); **preview**: unforced ab_test labeled `ab_first_preview` (never fakes the Phase-7 sticky hash); legal/footer copy structural until Phase-6 site-settings wiring; **variant_label collisions** → 400; promote-winner deferred (analytics verdict, Phase 8+; fork is its clone primitive). |

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
| Migrations apply **remote** (§6/§27) | CI deploy.yml production job (dispatch run `28627556872`, 2026-07-03) | CI log: `0032/0033/0034_listicles_*` each ✅ applied to `kodigital-homepages-cms-db`; probe: production D1 `sqlite_master` counts **22** `listicle_` tables | PASS |
| deploy.yml grep-anchors for all 3 files (repo D1-file rule) | `.github/workflows/deploy.yml` | `T07` | PASS |
| Guard green incl. vendored docs (§1) | `api/scripts/verify/assert-no-legacy-prod-refs.ts` allowlist | `T08` + bite-proof above | PASS |
| Contract + layout package vendored (§30.1 package list) | `docs/listicles/{design-contract-v1.2.2.md, reference-layout-audit.md, reference-layout-desktop.json, reference-layout-mobile.json}` + `api/src/public/listicle/layouts/default/tokens.ts` | `T08`; tokens preserve all 10 BLOCKER `status:` fields verbatim (11th grep hit is the file-header comment) | PASS |

## Phase 2 — Admin API (PR2)

**Verification run (2026-07-03, branch rebased onto merged main):** `npx tsc --noEmit` green · `npm test` → **206 files / 1630 tests passed** (1524 pre-existing + 106 listicles) · `npm run verify:no-legacy-prod-refs` green · `api/scripts/acceptance/listicles-phase2/run_all.sh` → **3/3 pass** (T01 asserts all 27 registered routes; T03 runs the 8 listicle suites: 106/106). **Independent adversarial review: SHIP** — 0 BLOCKER / 0 MAJOR; all MINOR findings fixed in-branch (§15.6 published-immutability guard added, articles-list pagination added, register declarations below) — route-by-route §7.1 comparison, token-by-token §9.4 diff, §23 branch walk, §15.5 payload-shape match, atomicity via single `env.DB.batch` + induced-failure tests, all SQL `.bind()`-parameterized.

| Requirement | Files | Evidence | Status |
|---|---|---|---|
| Domain core: ULID public_ids ×9 prefixes (§5 ID strategy, §30.7 `lnk_`) | `api/src/listicles/ids.ts` | unit (prefix/shape/sortability) | PASS |
| Macro registry 32 canonical + `{clickid}` alias (=33 accepted, DEV-8) + unknown-macro reject (§9.4) | `api/src/listicles/macros.ts` | unit incl. exact token-set match vs §9.4 | PASS |
| Validators offer/section/article/version/page, field-keyed errors (§23) | `api/src/listicles/validation.ts` | unit — every §23 branch | PASS |
| Rule engine: typed sets/ranges, interval intersection, equal-priority overlap → §15.5 payload, cross-priority warnings (§15.4/§15.5) | `api/src/listicles/rules.ts` | unit (06–12 × 10–18 ⇒ 10:00–12:00 computed; payload shape ≡ contract example) | PASS |
| Offers CRUD + search(≤50 active) + usage + analytics + 409-with-usage (§7.1/§9) | `api/src/admin/listicles/{router,offers-handlers}.ts` | integration round-trips + 409 usage payload + empty-mirror zeros | PASS |
| Sections CRUD + content_html re-render + link-instance extraction + `section_offers` rebuild + `__headline__` row + free-URL rejection + 409/soft-archive (§7.1/§10/§30.7) | `sections-handlers.ts`, `api/src/listicles/link-instances.ts` | integration incl. `lnk_` id stability across saves | PASS |
| Articles base+control txn, experiments Σ=100 + one-running partial-unique, PUT /versions/:id atomic replace + §15.6 guards, /pages/:id/validate (no-write), structure/analytics/drilldown, publish (validate + status transition; invalidate+warm = Phase 6 TODO), DELETE cascade, paginated list (§7.1/§11/§5.3) | `articles-handlers.ts`, `versions-handlers.ts`, `structure.ts` | integration incl. induced mid-batch constraint failures → zero partial rows; published+behavioral → 409 | PASS |
| All under `accessAuth` + `ADMIN_HOST` + `private, no-store` (§7.1/§24) | `router.ts` mounted inside the gates in `api/src/admin/router.ts` | integration: foreign-host 404, no/invalid JWT 401, prod double-gate 401, authorized 200 + no-store | PASS |

## Phase 3 — Admin UI (PR3)

**Verification run (2026-07-03):** `npx tsc --noEmit` green · `npm test` → **208 files / 1659 tests** · guard green · `api/scripts/acceptance/listicles-phase3/run_all.sh` → **3/3** · Playwright **18/18** (4 listicles e2e incl. fallback-offer picker + post-hydration cell assertion; screenshots `api/test-artifacts/listicles-offers/01…06` @1280×800, visually confirmed). **Independent adversarial review: BLOCK → all findings fixed in-branch → effectively SHIP** — the two MAJORs (§24 `private, no-store` on the HTML shell; this register flip itself) plus `?range=__proto__` 500, dialog `.catch` error states, dirty-close confirm, e2e evidence gaps. Chips diffed one-by-one vs §9.4 (exact 32, contract order); ES5 verified by byte-parse across all 6 page variants; XSS probed with hostile payloads (all escaped).

| Requirement | Files | Evidence | Status |
|---|---|---|---|
| NAV entry after Pages + `ICON_LISTICLES` (§4) | `api/src/admin/templates/layout.ts` | nav-order test (+`admin-layout-shell` NAV_CONTRACT 9→10) | PASS |
| `renderListiclesTabs`; `/admin/listicles` → 302 offers; 3 tab pages 200; `private, no-store` on the shell (§4/§24) | `api/src/admin/listicles/{ui,ui-shared}.ts` | route tests incl. header assertions + hostile `?range=` 200s | PASS |
| Lists: toolbar/table/pager/empty-state; Articles site-scoped ("Site is required" gate); async per-row analytics skeletons + error/retry (§8) | `api/src/admin/listicles/{ui-offers,ui-lists}.ts` | render tests + Playwright post-hydration assertion | PASS |
| Create/Edit Offer modal: all §9 fields, conditional reveals, 32 §9.4 macro chips (DEV-8) at-caret, `{clickid}` normalization surfaced, cap fallback offer-picker + URL | `api/src/admin/listicles/ui-offers.ts` | Playwright e2e (create/edit/persist incl. picker) + chip-set ≡ `CANONICAL_MACROS` test | PASS |
| 409 usage dialog + "Archive instead"; attribution view; dirty-close confirm + beforeunload (§5.3/§8/§9) | `ui-offers.ts` | Playwright 409→archive e2e; beforeunload wiring unit-asserted (not e2e-triggerable — declared) | PASS |
| All inline scripts ES5 (repo invariant, §25) | all new pages | `listicles-ui-es5.test.ts`: regex + `node --check` byte-parse, 6 page variants | PASS |
| Sections/Articles create flows | — | deferred to Phases 4/5 (DEV-10; disabled buttons, no dead routes) | PENDING |

## Phase 4 — Editor (PR4)

**Verification run (2026-07-03):** `npx tsc --noEmit` green · `npm test` → **214 files / 1720 tests** (+61 Phase-4) · guard green · `api/scripts/acceptance/listicles-phase4/run_all.sh` → **3/3** · Playwright **23/23** (5 §26-Sections e2e; screenshots `api/test-artifacts/listicles-sections/01…07`, visually confirmed: 7-button choice group, inventory, token-styled preview w/ Desktop/Mobile toggle). **Independent adversarial review: SHIP** — 0 BLOCKER / 0 MAJOR; XSS attacked and HELD (allowlist-by-reconstruction govern pass over the untouched pillar-1 sanitizer; preview iframe `srcdoc` + `sandbox=""`; `safeBootJson`; inventory/picker via `createTextNode`); pillar-1 byte-stability audited across all 16 shared-editor hunks; §30.5 shapes field-for-field exact; 17/17 preset names verbatim; MINOR/NIT hardening findings fixed in-branch (listicle-flag gating on the two shared hunks, default-editor zero-listicle-marker tripwire test, preview image `isSafeUrl`, dead validation entries removed).

| Requirement | Files | Evidence | Status |
|---|---|---|---|
| Governed grammar: `button`, `offerlink` mark, list markers (disc/dash/ordered/check/emoji), curated colour tokens, emoji; free-text URL impossible; `html`/`affiliate` rejected in Sections (§12) | `api/src/editor/listicle-blocks.ts` + `editor-scripts.ts` (`options.listicle`-gated) + `api/src/listicles/validation.ts` | no-URL-field DOM test + e2e; save blocked w/o Offer; vocabulary-gate tests | PASS |
| v1.2 blocks `choice_button_group`/`final_text_cta`/`linked_image` + 17 presets w/ `layout_binding` (§30.5) | `listicle-blocks.ts` | shapes ≡ contract TS field-for-field (review-diffed); round-trip + `data-offer`/`data-link-instance`/`data-block-id`/`data-link-role` + `rel="sponsored nofollow noopener"`; NO href (resolver URLs = Phase 6/7) | PASS |
| Offer-selection modal as the single link mechanism — full §13 (search ≤50 active, filters, recently-used pinned, ＋New Offer inline preselected, keyboard) | `api/src/admin/listicles/ui-offer-picker.ts` (+ reused Phase-3 create modal) | e2e across headline/offerlink/button/choice/linked-image/final-CTA flows | PASS |
| Link instances minted per governed element; `__headline__`; server-authoritative `lnk_` enrichment idempotent (save→save no-op); ledger drives `section_offers` (§30.7) | `api/src/listicles/link-instances.ts` + `sections-handlers.ts` | extraction/enrichment/idempotency unit+integration (byte-identical re-save proven) | PASS |
| Section editor page (§10): name, image/GIF/AI, clickable headline→picker→chip, AI presets, states, dirty guards | `api/src/admin/listicles/{ui-section-editor,section-preview}.ts` + routes in `ui.ts` | route/anatomy tests + e2e + ES5 byte-parse (ES6 editor atom invariant: exactly-once byte-identical embed, DEV-11) | PASS |
| ≥6-button groups, reorder/duplicate/bulk-assign one Offer or per-button, reuse-previous-binding (§30.5) | editor UI (`editor-scripts.ts` listicle config) | e2e 6-button group incl. mutations | PASS |
| CTA/Link Inventory accurate + bulk replace (incl. headline) + duplicate + move + jump; token-derived Section preview desktop/mobile (§30.6) | `ui-section-editor.ts` + `tokens-to-css.ts` | e2e inventory ≡ content_json; preview content-accurate (pixel parity stays §31.0-gated — Phase 6) | PASS |

## Phase 5 — Builder (PR5)

**Verification run (2026-07-03):** `npx tsc --noEmit` green · full vitest green (final counts in the PR body) · guard green · `api/scripts/acceptance/listicles-phase5/run_all.sh` → **3/3** · Playwright green (6 §26-Articles e2e; screenshots `api/test-artifacts/listicles-articles/01…13`, visually confirmed incl. the §15.5 blocking matrix with highlighted CA/mobile/newsbreak cells). **Independent adversarial review: BLOCK → MAJOR fixed in-branch** — the MAJOR was real and empirically proven: fork's `join_experiment` had no status/Σ/one-control guard (a running experiment's Σ could reach 140 via API); closed with the join-requires-draft rule (DEV-12). Reviewer verified: fork/new-revision bypass-scope proofs, experiment-lifecycle atomicity + partial-unique race coverage, vm-executed §15.5 matrix fidelity, preview honesty, XSS held (zero HTML sinks in the builder).

| Requirement | Files | Evidence | Status |
|---|---|---|---|
| Base + auto control Version; versioning invisible until a 2nd Version (§11) | `api/src/admin/listicles/ui-article-builder.ts` + Phase-2 API | e2e + anatomy tests | PASS |
| A/B rail: Σ=100 indicator (green only at 100), one control, ≤1 running (partial-unique), draft→start(atomic Σ over merged)→stop (§15.8/§23) | builder + `articles-handlers.ts` start/stop | integration incl. direct index-refusal + e2e 60/40 | PASS |
| §15.6/§30.7 fork + new-revision: `POST /versions/:id/fork` (new lander_v, deep copy, source byte-untouched, **join requires draft**) + `POST /versions/:id/new-revision` (same lander_v, unconditional bump, bypasses ONLY the immutability 409s) — closes the DEV-9 obligation | `version-fork.ts`, `versions-handlers.ts` | fork/new-revision suites incl. hostile bypass-scope proofs + running/stopped join 409s | PASS |
| Pages builder 3 modes; per-page ab Σ=100; §15.4 rule editor (17 set dims + hour/daypart); §15.5 conflict matrix from the server payload (equal-priority red/blocking, cross-priority amber); one fallback (§11/§15.5/§23) | builder + `POST /pages/:id/validate` wiring | vm-executed ES5 matrix test vs the contract's verbatim payload + e2e CA+mobile→C / newsbreak→D / fallback→E blocked | PASS |
| §30.2 byline editor + `byline_json` validation (enabled⇒author_name, unknown keys rejected; edits = case-b bumps) | `validation.ts` + builder | unit + round-trip | PASS |
| Version preview: full §30.2 page order, force Version/candidate, REAL `rules.ts` simulation, ledger CTA density, token-generated chrome, `sandbox=""`, unforced-ab honestly labeled, Disclosure inert (§30.4/§30.6) | `version-preview.ts` + builder panel | marker-ORDER test + rule-sim tests + e2e | PASS |
| Articles list: Create live + `?search=` (LIKE-escaped; closes the DEV-10 deferral) + Edit action (public_id links) | `ui-lists.ts`, `articles-handlers.ts` | tests + e2e | PASS |
| Unsaved-changes guard; UI states (§8) | builder | anatomy-asserted (beforeunload not e2e-triggerable — declared Phases 3/4/5) | PASS |
| Promote-winner (§5.3) | — | DEFERRED to Phase 8+ (a winner is an analytics verdict; fork is the clone primitive it composes; declared in `stopExperimentHandler`) | PENDING |

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
