# LeadGen CMS — Contract 10 · Testing, QA, Phases, Risks & Final Checklist

Covers **§31 Testing plan**, **§32 Manual QA checklist**, **§33 Implementation phases**, **§34 Risks / open questions**, **§35 Final implementation checklist** (incl. the contract traceability checklist for the implementation agent).

---

## 31. Testing plan

Mirrors the repo's existing test strategy (Vitest unit/integration under `api/test/`, Playwright UI under `api/test-ui/`, design-contract render specs). Every phase (§33) ships with green tests before it is "done".

### 31.1 Unit (Vitest)

- `leadgen/ids` — ULID mint/parse/`isPublicId` per prefix; time-ordering proof.
- `leadgen/macros` — 32 macros + alias + `{response:<path>}` (nested) resolution; validation guards (absolute http(s), no authority macro, control chars, unknown rejected).
- `leadgen/payload` — schema→payload build; `value_map` + transforms; `cleanObject` no-fabrication; conditional field drop; token placement (header/payload/query); auto-from-example inference.
- `leadgen/auction-core` — floor calc; winner logic (highest/average/sum) + tie-breakers; zero/invalid/missing bids; multi-offer (disabled/enabled/enabled_unique); backfill (3 modes); carrier uniqueness/dedupe; remove-clicked.
- `leadgen/rules` — typed conditions (AND across fields, OR within field; all ops); region + answer + carrier rules; include_only/exclude/allow/block; strictly_override; priority/conflict.
- `leadgen/ab-hash` — golden test vectors; distribution test (N=100k within ±1%); allocation-sum-≠-10000 rejected; stickiness.
- `leadgen/validation` — Offer/Section/Quote/Auction validators (§35 rules).
- `leadgen/mirror-sync` — CH→D1 upsert against a mocked CH client + seeded D1; per-table isolation; fail-open on absent secrets; coercion/skip-bad-rows; batch ≤ 80.
- `leadgen/s2s-dispatch` — platform lookup; macro resolve; `fbc` derive; KV dedupe; absent-secret no-op; non-2xx logged not thrown.
- `leadgen/revenue-ingest` — postback dedupe UNIQUE; unmatched queue; FX normalization; conversion-log dedupe.

### 31.2 Integration (Vitest, `admin.request`/`leadgenApi.request`)

- CRUD for Offers/Sections/Quotes/Auctions incl. Row↔API mapping + derived-index rebuild on Section save.
- Admin auth: `/api/admin/leadgen/*` returns 404 off `ADMIN_HOST`; 401/403 without CF Access JWT; `no-store` headers on every response.
- Site activation: activate/deactivate; per-site slug uniqueness; runtime resolution (enabled row → variant; disabled/missing → 404).
- Payload Test tool: server-side proxy masks secrets; persists sample response; writes provider log.
- Auction simulate: dry-run produces an explainability trace with no revenue writes.
- Migrations: `0036`–`0039` apply cleanly; UNIQUE/CHECK constraints enforced (dup `(provider,external_txn_id)` rejected; bad enum rejected).

### 31.3 UI (Playwright, `api/test-ui/`)

- Nav: LeadGen tab present; four sub-tabs; `/admin/leadgen` → `/offers`.
- Offers/Sections/Quotes/Auction list + create + edit flows; validation-error display.
- Payload builder: build nested object/array visually; live JSON preview; validation panel; auto-from-example.
- Question builder: add each component preset; desktop/mobile preview; selected/error/dependency/auto-advance simulation; payload-mapping preview.
- Funnel builder: add/remove/reorder Sections; mark final-before-auction; A/B allocation; activation + preview URL.
- Banner builder: manual + automatic (from sample response) field mapping.

### 31.4 Runtime + visual (Playwright)

- `/lg/*` funnel render (desktop + mobile) for the default design; slide transitions; validation; auction entry.
- **Visual regression** (§14.10): screenshot + computed-style diff vs the reference funnel design at desktop + mobile, masking dynamic content; assert header/progress/headline/cards/range/continue/badge computed styles; assert no arbitrary-CSS escape.
- Auction runtime: mocked provider adapters → floor/winner/multi-offer/backfill/unfilled paths render correctly; click resolver mints `click_id` + 302s + resolves `{response:*}`.
- GA4 (§27): `dataLayer` present + grows, `gtag config` fires with the site id, no GA4 console errors, LeadGen path doesn't reset GA4.

### 31.5 Perf regression (Playwright/Lighthouse)

Funnel shell cache-hit TTFB, LCP, CLS budgets (§28.4); JS payload size assertion; auction P95 bounded by timeout.

### 31.6 Gates (MUST all exit 0 before any deploy)

`npx tsc --noEmit` · `npm test` · `npm run verify:no-legacy-prod-refs` · `npm run verify:infra` · `npm run verify:worker-config` · `npx playwright test`.

---

## 32. Manual QA checklist

(Add `manualQA.md` LeadGen section, following the repo's `manualQA.md` format.)

- [ ] LeadGen nav item appears; four tabs load; bare `/admin/leadgen` redirects to Offers.
- [ ] Create an Offer (static): all required fields validated; static bid/order/banner URL saved; appears in list with analytics columns.
- [ ] Create an Offer (dynamic): payload builder builds a nested payload; headers + endpoints + token placement saved; **Test** (staging) shows payload/response/status/latency/masked headers/parsed carriers/available fields; sample response persisted; token never visible after save.
- [ ] Auto-from-example: paste a real provider payload → editable schema generated; mark enum/required; save.
- [ ] Offer rules: region block (state=CA excluded) + answer rule (homeowner=false excludes) behave in a simulate run.
- [ ] Offer cap: enable, set amount/tz/count-by; capped Offer excluded from auction / redirected.
- [ ] Create a Section: headline/subheadline; add each answer component; icon-card grid with the 5 business-type choices; currency range ($10k–$1M+, value $330k); reassurance badge; progress bar; dropdown; multi-choice; free-text; email/phone/name; address+ZIP with Google-Maps autofill.
- [ ] Desktop + mobile preview; selected/error/dependency/auto-advance simulation; payload-mapping preview shows generated payload.
- [ ] Dependency: "insured? Yes" reveals insurer dropdown.
- [ ] Answer→Offer mapping: same answer maps to different field names/values across two Offers; completeness badge; missing-required flagged.
- [ ] Continue behavior: button mode requires answers before advancing; auto-advance advances on click; no double-submit.
- [ ] Default boolean: default applied → `answer_source=default`; user change → `user`.
- [ ] Create a Quote: add/reorder Sections (filtered by activity/vertical); mark final-before-auction; select funnel design; attach auction; optional opening lander.
- [ ] Funnel rules: age<X redirect; state-blocked disqualify/static; homeowner=no skips a path.
- [ ] Funnel A/B: two variants; allocation sums to 100%; assignment sticky per session; variant shown in analytics.
- [ ] Site activation: activate a Quote on 2 sites; per-site slug; preview URL renders; deactivate hides it (404).
- [ ] Create an Auction (static): Offers ordered by static order/bid; banners shown.
- [ ] Create an Auction (dynamic): participating Offers listed with status/cap/last-test/schema-version; winner logic (highest/avg/sum); multi-offer (all 3 modes); backfill (all 3 modes); remove-clicked; timeout/floor.
- [ ] Carrier rules: mobile hides Carrier A; state=NY excludes Carrier C.
- [ ] Banner builder: manual copy + automatic mapping from sample response.
- [ ] Simulate: explainability shows considered/excluded/requests/responses/parsed/filtered/winner/final/unfilled.
- [ ] Click: banner click mints `click_id`, resolves destination (incl. `{response:slug}`), 302s.
- [ ] Analytics: Offer/Section/Quote/Auction/carrier tables populate from D1 mirrors after the cron; ratios render (— when denominator 0).
- [ ] Revenue: a test postback (valid token) books revenue matched by `click_id`; dup `(provider,txn_id)` is a no-op; unmatched click queued.
- [ ] S2S: enabling a platform + secret fires a pixel on a matched conversion; disabled fires nothing; no double-fire.
- [ ] GA4: funnel page keeps the site's GA4 (`dataLayer`/`gtag`) working; no console errors.
- [ ] Off-`ADMIN_HOST` request to `/admin/leadgen` → 404; unauth → 401/403.

---

## 33. Implementation phases

Each phase has acceptance criteria; a phase is "done" only when its tests + the five gates are green. Deploy/secret writes are operator-owned.

| Phase | Scope | Acceptance |
|---|---|---|
| **1 — Findings + design validation** | Confirm repo head migration number; reconcile toolbar layout to the operator screenshot (OQ-1); finalize this contract. | Contract signed off; migration numbering fixed; traceability.md seeded. |
| **2 — D1 migrations / core data model** | `0036`–`0039` (+ seed). | Migrations apply locally + remote-dry; constraints enforced; Row/API types compile. |
| **3 — Admin nav + shell** | LeadGen nav + 4 tabs + list scaffolds + JSON API skeleton; mount under existing gate. | Nav/tabs render; `no-store`; 404 off ADMIN_HOST; auth-gated. |
| **4 — Offers CRUD + payload builder + Test tool** | Offers full editor; manual + auto payload builder; headers/endpoints/token; Test proxy; rules; caps; offer analytics read. | §32 Offers items; unit tests for payload/rules; Test masks secrets. |
| **5 — Sections + rich styling system** | Section editor; design registry + default tokens + presets; question builder; previews. | §14.10 visual acceptance; all presets buildable; desktop/mobile previews. |
| **6 — Answer mapping + dependencies + Google Maps** | Answer→Offer mapping + normalization; IF/THEN dependencies; address/ZIP autofill. | Mapping completeness; dependency preview; ZIP validation; Maps key server-side. |
| **7 — Quotes + funnel builder + site activation** | Quote editor; per-Quote Section order; final-before-auction; funnel rules; activation. | §32 Quote items; activation resolution; quote analytics read. |
| **8 — Funnel A/B + design registry hardening** | A/B test lifecycle; deterministic assignment; multiple designs. | Golden vectors + distribution test; sticky assignment; variant analytics. |
| **9 — Auction config + banner builder** | Auction editor; participating Offers; offer/carrier rules; banner builder (manual/auto). | §32 Auction config items; rule evaluation unit tests. |
| **10 — Auction runtime + provider adapters** | `/lg/auction` engine; parallel fetch + timeout; parse/floor/winner/multi-offer/backfill/remove-clicked; unfilled; explainability; simulate. | Runtime tests (mocked providers) cover every branch; simulate trace complete. |
| **11 — Tracking + macros + click resolver** | `/lg/track` beacon; event schema; `/lg/lc` click resolver + `{response:*}`; `click_id` mint; caps increment. | Events emitted with all dims; click resolves + 302; caps enforced. |
| **12 — ClickHouse aggregation + D1 mirrors** | `lg_*` CH DDL; `syncLeadgenAnalytics` on cron; 9 D1 mirrors; rebuild-range. | Mirror sync tests (mocked CH); isolation; fail-open; ratios at read. |
| **13 — Provider revenue + S2S** | Postback ingest + dedupe + unmatched + FX; S2S dispatcher + platforms. | Revenue dedupe/attribution tests; S2S fire/dedupe tests. |
| **14 — GA4 validation + performance hardening** | GA4 pass-through; shell caching + versioning; lazy media; CLS=0. | GA4 tests; perf budgets; cache hit rate. |
| **15 — QA, visual tests, traceability report** | Full manual QA; visual regression; contract traceability sign-off. | §32 complete; §35 checklist all green; traceability.md complete. |

---

## 34. Risks / open questions

| # | Risk / question | Recommendation |
|---|---|---|
| **OQ-1** | Operator reference screenshot (`Screenshot 2026-07-05 at 20.04.58`) not attached to this environment. | Nav/table/modal conventions specified by mirroring live Listicles admin; reconcile toolbar to the screenshot in Phase 1 before Phase 3 sign-off. |
| **OQ-2** | The exact reference funnel design tokens (§14.2) are provisional defaults derived from the operator's described screenshots (dark navy header, green category label, serif headline, blue pill, green badge, icon cards). | Measure the real reference funnel into `docs/leadgen/default-funnel-design-audit.md` (Playwright computed CSS) and let measured values override provisional, same discipline as the Listicles audit. |
| **OQ-3** | External Athena→ClickHouse ingest job is data-ops-owned; no rows exist in `lg_*` until it runs. | CMS mirror-sync + tests run against seeded D1 + mocked CH (Listicles residual pattern). Coordinate the ops split of `record_kind` into `lg_events_raw`/`lg_sessions`. |
| **OQ-4** | Serif headline font (`Tiempos`) may not be licensed. | Ship a licensed/available serif fallback stack; the token is swappable in `default/tokens.ts`. |
| **OQ-5** | Provider payload contracts vary widely; some may need bespoke normalization beyond the generic schema builder. | The generic `schema_json` covers the common case; a per-provider adapter hook (`src/public/leadgen/adapters/`) is the escape hatch for a truly bespoke provider, kept `leadgen_`-named. |
| **OQ-6** | Google Maps quota/billing + key restriction strategy. | Referrer-restricted browser key for autocomplete; server-side key for validate/geocode; cache ZIP→city/state in KV (reference pattern) to bound calls. |
| **OQ-7** | Basis-point vs percent for A/B allocation (schema uses `%` with Σ==100; algorithm uses bp). | Store `%` in D1 for operator familiarity; convert to bp (×100) at assignment; validate Σ==100. Documented in §16.2. |
| **OQ-8** | Cap enforcement race under high concurrency (D1 counter increments). | Synchronous read-then-increment per `(offer_id, cap_date)`; accept small over-delivery at extreme concurrency (same tolerance Listicles accepts); revisit with a Durable Object counter if a provider demands hard caps. |
| **OQ-9** | Migration numbering may shift if other migrations land before LeadGen. | Implementer re-checks `ls api/migrations/` and renumbers to head+1..head+4; records mapping in traceability.md (Listicles precedent). |
| **OQ-10** | Preview/simulate traffic must never pollute analytics or book revenue. | `is_preview` flag + `no-store`; simulate writes nothing; default analytics filter `clean` only. |

---

## 35. Final implementation checklist (acceptance + traceability)

### 35.1 Validation rules (server-side; MUST)

**Offer:** required `offer_name`, `placement_id`, `activity`, `vertical`, `conversion_tracking_method`, `offer_type`, `calls_provider_api`, `bid_source`. If `calls_provider_api=1`: payload schema present + valid, `request_method`, `endpoint_production`, valid headers, valid token placement, response parsing valid; Test should pass or be explicitly `draft/untested` (untested Offers blocked from live auctions). If static: static bid/order required when used in a static auction; banner URL required if no dynamic click URL. If cap enabled: amount + timezone + count-by required.
**Section:** `section_name`, `activity`, `vertical`, `headline_text`, ≥1 answer component; each question has `question_key`, `internal_field`, `answer_type`, `required` flag, `valid_values` for enum/dropdown/multi-choice; dependencies valid; mapped Offer active + payload field exists + type conversion valid; provider-required fields mapped before Quote publish.
**Quote:** `quote_name`, `activity`, ≥1 vertical, `funnel_design_id`, ≥1 Section, exactly one final-before-auction, valid auction attribution.
**Funnel A/B:** each variant has an allocation; allocations total 100%; each variant has a valid Section order + a final-before-auction Section.
**Auction:** `auction_name`, quote attribution, `auction_type`, `banner_design_id`, `winner_logic`, ≥1 participating Offer, `timeout_ms`, `floor_percentage`; dynamic Offers have valid schema/endpoint/response parsing; static Offers have static order/bid/banner as needed; rules valid; no ambiguous conflicts unless priority is explicit.

### 35.2 Acceptance criteria (grouped)

**CMS:** LeadGen nav exists; Offers/Sections/Quotes/Auction tabs exist; global assets + per-site activation work; no per-site duplication.
**Offers:** modal includes all fields; payload builder works manually + automatically; Test tool shows payload/response; headers/endpoints/tokens secure + masked; response macros (`{response:*}`) work; offer rules + caps work; offer analytics work.
**Sections:** rich question builder supports all component types; styling reaches screenshot-level complexity via presets; icon cards, currency range, Continue pill, reassurance badge, progress bar, dropdowns, multi-choice, free text all work; desktop/mobile previews; dependencies; answer→Offer mapping; Google-Maps validation; section analytics.
**Quotes:** funnel builder flexible per-Quote; Section order configurable; final-before-auction defined; funnel A/B works; site activation works; quote analytics work.
**Auction:** static + dynamic work; requests/responses logged; winner logic works; multi-offer/backfill/remove-clicked work; carrier rules work; banner builder works; auction analytics work.
**Tracking/analytics:** Athena `leadgen` events/sessions exist; `lg_*` CH aggregations exist; `leadgen_analytics_*` D1 mirrors exist; all required IDs persist across funnel + auction; revenue reconciles by `click_id`; provider errors/timeouts/no-bid/below-floor tracked; A/B deterministic + auditable.
**Performance:** static funnel shells highly cacheable (~99.99%); auction dynamic only when needed; no layout shift; small JS payload; images/GIFs lazy-loaded; timeout protects UX; cache target met.
**Security:** tokens masked + secret-stored; no secrets to frontend; no existing CMS/Listicles/GA4 behavior broken; guardrails respected (no banned tokens, additive-only, forward-only migrations, no agent deploys).

### 35.3 Contract traceability checklist (for the implementation agent)

Each deliverable maps to code + tests. Tick when both exist and are green.

| # | Deliverable | Primary artifact(s) | Test(s) |
|---|---|---|---|
| 1 | Executive summary | `docs/leadgen/` contract | — |
| 2 | Repository findings | contract §2 | — |
| 3 | Patterns to reuse | contract §3 | — |
| 4 | Product architecture | `src/leadgen/*`, `src/public/leadgen/*` module layout | typecheck |
| 5 | CMS navigation | `admin/templates/layout.ts` nav, `admin/leadgen/ui.ts` | UI: nav+tabs |
| 6 | Data model | contract §6 | — |
| 7 | D1 schema/migrations | `migrations/0036–0039` | migrations tests |
| 8 | API/route design | `admin/leadgen/router.ts`, `public/leadgen/*` routes | integration: routes+auth |
| 9 | Admin UI | `admin/leadgen/ui-*.ts` | UI flows |
| 10 | Offers tab | `admin/leadgen/offers-handlers.ts`, `ui-offers.ts` | Offers CRUD + analytics |
| 11 | Payload builder | `leadgen/payload.ts`, `ui-payload-builder.ts`, Test proxy | payload + auto-from-example + Test |
| 12 | Sections | `admin/leadgen/sections-handlers.ts`, derived-index rebuild | Section CRUD + mapping rebuild |
| 13 | Question builder | `ui-question-builder.ts`, `components/registry.ts` | UI: each preset |
| 14 | Styling/design tokens | `public/leadgen/designs/*` | visual regression + computed-style |
| 15 | Quote/funnel builder | `admin/leadgen/quotes-handlers.ts`, `ui-quotes.ts` | funnel builder + validate |
| 16 | Funnel A/B | `public/leadgen/ab-hash.ts` | golden vectors + distribution |
| 17 | Site activation | `leadgen_site_quotes` handlers, `public/leadgen/resolver.ts` | activation resolution |
| 18 | Auction tab | `admin/leadgen/auctions-handlers.ts`, `ui-auctions.ts` | Auction CRUD + analytics |
| 19 | Auction runtime | `public/leadgen/auction/*` | runtime branches + simulate |
| 20 | Banner builder | `designs/banner-default/*`, `ui-banner-builder.ts` | banner manual/auto |
| 21 | Offer/carrier/rule system | `leadgen/rules.ts`, `leadgen_auction_rules` | rules unit tests |
| 22 | Tracking events/sessions | `public/leadgen/*` emitters, `infra/leadgen/athena-ddl.sql` | event-schema tests |
| 23 | ClickHouse aggregation | `infra/leadgen/clickhouse-ddl.sql` | (manual apply) + mirror tests |
| 24 | D1 mirroring | `leadgen/mirror-sync.ts` | mirror-sync tests |
| 25 | Provider revenue | `leadgen/revenue-ingest.ts`, `public/leadgen/postback.ts` | revenue dedupe/attribution |
| 26 | S2S/media | `leadgen/s2s-dispatch.ts`, `leadgen_media_platforms` | S2S fire/dedupe |
| 27 | GA4 validation | shell GA4 injection | GA4 UI tests |
| 28 | Performance/caching | `leadgen/invalidate.ts`, cache keys/versions | perf regression |
| 29 | Reconciliation | `leadgen/revenue-recon.ts`, reconciliation cron | recon tests |
| 30 | Security/secrets | `env.ts` secrets, token masking | auth + secret-masking tests |
| 31 | Testing plan | `api/test/leadgen-*`, `api/test-ui/leadgen-*` | all green |
| 32 | Manual QA | `manualQA.md` LeadGen section | operator run |
| 33 | Phases | this file §33 | per-phase gates |
| 34 | Risks/open questions | §34 | resolved/acknowledged |
| 35 | Final checklist | this table | all ticked |

**Definition of done:** every row above ticked; all five verify gates + Vitest + Playwright green; `manualQA.md` LeadGen section passed by the operator; zero banned tokens; zero changes to existing tables/routes/caches/GA4; `docs/leadgen/traceability.md` records the final migration numbering + any measured token overrides.
