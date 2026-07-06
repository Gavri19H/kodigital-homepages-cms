# LeadGen — Traceability Register (living; maintained by the implementation agent)

Mirrors `docs/listicles/traceability.md`. The contract (**v2.3.7 — READY TO BUILD**) is vendored verbatim at `docs/leadgen/contract/` (per-file SHA-256: `docs/leadgen/contract/MANIFEST.sha256`; source: Claude Design project `159eadec-6141-4457-a2df-3cc02f035659`). The contract is the single source of truth; this register records execution state against it.

**Delivery model:** 15 sequential PRs, one per contract phase (`10`§33), one branch open at a time; squash-merge; operator owns merges, deploys, and secrets. Every row below flips only with runnable evidence (command + result) recorded in the phase section that flips it.

**Status legend:** `PENDING` (not built) · `PASS` (code + tests green, evidence cited) · `FAIL` (built, not validating) · `BLOCKED(<named blocker>)` (cannot validate 1:1; blocker named; never reported as PASS).

---

## Migration numbering (OQ-9)

Head verified `0035` at program start (2026-07-06, main@6ff0102); contract numbers hold. Re-checked at every session start until PR2 merges.

| Contract file | Shipped as | Applied (local) | Applied (remote) |
|---|---|---|---|
| `0036_leadgen_core.sql` | `0036` (unchanged) | ☑ 2026-07-06 | ☑ 2026-07-06 (run 28794699290) |
| `0037_leadgen_analytics_mirror.sql` | `0037` (unchanged) | ☑ 2026-07-06 | ☑ 2026-07-06 (run 28794699290) |
| `0038_leadgen_revenue_infra.sql` | `0038` (unchanged) | ☑ 2026-07-06 | ☑ 2026-07-06 (run 28794699290) |
| `0039_leadgen_conversion_dedupe.sql` | `0039` (unchanged) | ☑ 2026-07-06 | ☑ 2026-07-06 (run 28794699290) |

Local apply evidence: `npm run db:migrate:local` → all four ✅; local D1 `sqlite_master` count of `leadgen_%` tables = **40** (24 core + 9 mirrors + 6 revenue + 1 dedupe — the physical count per the normative DDL; matrix row 8's "26 tables" is a loose entity-group count).

Each shipped migration MUST be anchored in `.github/workflows/deploy.yml` in the same commit that adds it.

## DEV register (deviations from contract text, with rationale)

| # | Deviation | Rationale |
|---|---|---|
| DEV-1 | Contract docs land under scanner **allowlist** entries (`GROUP_A_ALLOWED_FILES`), not a docs-wide exclusion. Contract `00`/`01`§2.5 says docs are in the scanner's "EXCLUDED_FILES" — the actual mechanism is a per-file allowlist. | Verified in `api/scripts/verify/assert-no-legacy-prod-refs.ts`; precedent: `docs/listicles/design-contract-v1.2.2.md`. SSOT prose is never sanitized. |
| DEV-2 | All deploys + `wrangler secret put` are **operator-owned**; the agent never deploys. | Repo guardrail + workspace deploy-safety rule. |
| DEV-3 | Program acceptance suites live at `api/scripts/acceptance/leadgen-phaseN/`, not `acceptance-tests/`. | `acceptance-tests/` is reserved by an a2z pre-commit guard (Listicles precedent). |
| DEV-4 | Contract errata (cosmetic): `revenue-recon.ts` lives at `api/src/listicles/` (contract `00` groups it under `analytics/`); LeadGen's copy goes to `api/src/leadgen/revenue-recon.ts` per `01`§4.2 (unaffected). | Verified on main@6ff0102. |
| DEV-5 | Where older §-prose conflicts with v2.3.7 status (e.g. `10`§34 OQ-2 "provisional tokens"), the README/`12`-matrix v2 status governs: measured tokens are shipped; screenshots are capability examples only. | Contract's own versioning. |
| DEV-6 | `docs/MISSION-CMS-RESCUE-4.md` (foreign untracked local mission doc) added to `GROUP_A_ALLOWED_FILES`. | It made every LOCAL scanner run + 3 verify-green vitest files fail pre-program (2 prose lines naming the reference product); CI unaffected (untracked). Precedent: `docs/MISSION-CMS-RESCUE-2.md` already allowlisted. Baseline evidence in P1 section. |
| DEV-7 | Contract source seeds (`components/registry.ts`, `designs/default-funnel/tokens.ts`) verified **token-clean** at vendoring — no comment-stripping needed at P5; vendor verbatim. | Token pre-scan at P1 (grep over all 26 files): only 8 prose/audit docs carry banned tokens; both seeds + all migrations/infra DDL are clean. |
| DEV-8 | **Delivery-model change (operator instruction 2026-07-06):** per-PR review + contract-alignment validation + merge + deploy delegated to the agent ("do it independently for each pr"); CP0–CP5 are agent-executed verification stations, not user stops. `ENABLE_STAGING_DEPLOY` is unset and setting it was permission-denied → staging CI deploys skip; each PR deploys via `gh workflow run deploy.yml -f target_env=production` (which also applies migrations). **Ratified 2026-07-06 (post-P2): the operator ruled staging is skipped entirely for this program** — new-product routes are dark-by-construction, the full regression suite runs pre-merge, and staging shares production's D1 so it isolates nothing; production dispatch is the standing deploy path for every PR. | Operator messages (delegation + staging ruling) + permission-classifier denial, this session. |
| DEV-9 | §7.8's "Seed 5 disabled `leadgen_media_platforms`" is implemented **app-level at P13** (media-platforms admin CRUD + optional `seed-local`), NOT as migration INSERTs. | The normative vendored `0038` contains no INSERTs; the Listicles precedent (`0034`) is likewise INSERT-free (platforms created via admin CRUD); repo D2 deploy-safety forbids unconditional seed-INSERTs into admin-managed tables. |
| DEV-10 | **Prefix-set resolution (`01`§3 vs `02`§6.1/§6.3):** the `01`§3 summary lists `lgv_` quote-version / `lgc_` carrier / generic `lgr_` rule; the normative `02` entity table has none of these (v2.3.7 replaced quote-version with Quote→Funnel(`lgf_`)→Variant(`lgn_`)+A/B(`lgx_`); carriers key on `carrier_key`, no public_id; rules are the concrete `lgrr_`/`lgfr_`/`lgar_`) and adds `lgpl_` offer-placement. `leadgen/ids.ts` implements the `02` set — exactly 14 prefixes. | DEV-5 principle (normative v2.3.7 section governs older summary prose); adversarial review verified against all 40 `CREATE TABLE`s — no quote-version/carrier table exists. |

## OQ resolutions (contract `10`§34)

| OQ | Resolution | When |
|---|---|---|
| OQ-1 (operator screenshot) | **Mirror live Listicles admin conventions** (operator-confirmed 2026-07-06). Screenshot may still be attached before P3 sign-off to upgrade toolbar fidelity. | P1 (resolved) |
| OQ-2 (reference funnel tokens) | Superseded by v2.3.7: measured reference-funnel tokens shipped (`contract/src/.../default-funnel/tokens.ts` + design audit + reference JSONs). Vendored **verbatim** into `api/src/public/leadgen/designs/default-funnel/` at P5 — seeds are already token-clean (DEV-7). | P5 |
| OQ-3 (Athena→CH feed) | Ops-owned; mirror-sync built + tested vs seeded D1 + mocked CH; `infra/leadgen/` DDL handed to ops at P12 merge. Affected rows stay `BLOCKED(ops CH feed)` until live. | P12 |
| OQ-4 (serif license) | Ship licensed/available serif fallback stack per token file; token swappable. | P5 |
| OQ-5 (bespoke providers) | Generic `schema_json` builder is the common case; per-provider adapter hook `api/src/public/leadgen/adapters/` is the escape hatch, `leadgen_`-named. | P10 |
| OQ-6 (Maps quota/keys) | Referrer-restricted browser key + server-side key secret + KV ZIP cache; absent key ⇒ leg no-ops. Keys are operator deploy-time inputs. | P6 |
| OQ-7 (A/B % vs bp) | Store `%` (Σ==100 validated); convert to bp (×100) at assignment. | P8 |
| OQ-8 (cap race) | Synchronous read-then-increment per `(offer_id, cap_date)`; small over-delivery tolerated (Listicles tolerance); DO counter only if a provider demands hard caps. | P4/P11 |
| OQ-9 (migration numbering) | Head `0035` verified; contract numbers hold (table above). | P1 (resolved) |
| OQ-10 (preview/simulate isolation) | `is_preview` flag + `no-store`; simulate writes nothing; analytics default filter `clean`. | P10 |

## Operator-owned inputs (never silently dropped; tracked as BLOCKED until done)

| Input | Needed by | Status |
|---|---|---|
| Google Maps browser + server keys (wrangler secrets) | P6 live autofill leg | PENDING (code no-ops until set) |
| Athena `leadgen` DDL + Athena→ClickHouse ingest job (ops) | P12–P13 live analytics/revenue legs | PENDING (DDL delivered at P12) |
| Per-provider example payloads (captured via Test tool) | provider onboarding (post-P4) | PENDING |
| Staging-deploy repo variable state + CP1 watched deploy | P2 merge | RESOLVED — staging skipped by operator ruling (DEV-8); CP1 executed against the production dispatch (run 28794699290) + live D1 probe (P2 addendum) |
| Production `workflow_dispatch` + post-deploy behavioral verification | every PR (agent-executed per DEV-8); final sign-off dispatch at CP5 | IN FORCE — P1 run 28793161710 ✅, P2 run 28794699290 ✅; CP5 final PENDING |

---

## Deliverable traceability — the 52-row contract matrix (`12-traceability-matrix.md`) mapped to planned artifacts (`01`§4.2) + planned tests (`10`§31)

All paths relative to `api/` unless noted. `admin/leadgen/` = `src/admin/leadgen/`, `leadgen/` = `src/leadgen/`, `public/leadgen/` = `src/public/leadgen/`.

| # | Deliverable | Phase | Implementation file(s) (planned) | Test(s) (planned) | Status |
|---|---|---|---|---|---|
| 1 | Repository findings evidence | P1 | `docs/leadgen/contract/00-…` (vendored, SHA in MANIFEST) + this register | (evidence — P1 section) | PASS |
| 2 | Existing patterns to reuse | P1 | contract `01`§3 (vendored, SHA in MANIFEST) | — (ratified at CP0) | PASS |
| 3 | Anti-patterns / guardrails | P1 | scanner allowlist additions (`assert-no-legacy-prod-refs.ts`); token-clean source discipline | scanner exit 0 + bite-proof + second live bite (P1 evidence) | PASS |
| 4 | Product architecture | P2–P3 | module skeleton per `01`§4.2 | `typecheck` | PENDING — P3 partial: `src/leadgen/` + `src/admin/leadgen/` live; `src/public/leadgen/` from P5+ |
| 5 | Namespace plan | P2 | `leadgen_*` DDL, `lg_*` DDL, routes, ULID prefixes (`leadgen/ids.ts`) | `verify:infra`; grep-proof zero `listicle_` reuse | PENDING — P2 DDL + P3 `ids.ts` 14 prefixes (02-governed, DEV-10); `lg_*` DDL at P12 |
| 6 | CMS navigation | P3 | `src/admin/templates/layout.ts` nav (after Listicles) + `admin/leadgen/ui.ts` (302→offers, 4 tabs, singular `auction`) | `test-ui/leadgen-nav.spec.ts` 2/2 ✅; NAV count-test 10→11 same commit ✅ (P3 header) | PASS |
| 7 | Ownership + site activation | P7 | `leadgen_site_quotes` (0036) + `admin/leadgen/quotes-handlers.ts` + `public/leadgen/resolver.ts` | `test/leadgen-activation.test.ts` | PENDING |
| 8 | Data model (40 physical tables) | P2 | `migrations/0036–0039` + `admin/leadgen/db-types.ts` (40 Row/API pairs) | `test/leadgen-migrations.test.ts` + `tsc` (P2 header) | PASS |
| 9 | Full D1 migration DDL | P2 | `migrations/0036_leadgen_core.sql` … `0039_…` (cmp-identical to contract) + deploy.yml anchors | apply local ✅ + constraint tests 8/8 (P2 header); remote applied ✅ run 28794699290 (P2 addendum) | PASS |
| 10 | Full API route contract | P3+ | `admin/leadgen/router.ts` (static-before-param) + `public/leadgen/*` routes | `test/leadgen-admin-shell.test.ts` (404 off ADMIN_HOST; 401 parity; headers-TOTAL; dual `:id`; envelopes) | PENDING — P3 partial: skeleton proven (P3 header); full §8.2 surface ships P4–P9, `/lg/*` P7+ |
| 11 | Admin UI contract | P3+ | `admin/leadgen/ui.ts` + `ui-*.ts` (apiJson in-process SSR) | `test-ui/leadgen-admin.spec.ts` flows | PENDING — P3 partial: shell live (adminLayout, 4-tab bar, apiJson SSR, disabled Create scaffolds) |
| 12 | Offers tab | P4 | `admin/leadgen/offers-handlers.ts`, `ui-offers.ts`, `leadgen/validation.ts` | `test/leadgen-offers-api.test.ts` + UI spec | PENDING |
| 13 | Dynamic payload builder | P4 | `leadgen/payload.ts`, `admin/leadgen/payload-builder-handlers.ts`, `ui-payload-builder.ts` | `test/leadgen-payload.test.ts` (build, value_map, cleanObject, conditional drop, token placement, auto-from-example) | PENDING |
| 14 | Offer Test tool | P4 | `admin/leadgen/payload-builder-handlers.ts` (proxy) + `leadgen_provider_request_log` | `test/leadgen-test-tool.test.ts` (mask, persist, log) | PENDING |
| 15 | Provider response parser | P4/P10 | `public/leadgen/auction/parse.ts` | `test/leadgen-parse.test.ts` (+ malformed) | PENDING |
| 16 | Static banner URL + response macro | P11 | `leadgen/macros.ts` (`{response:<path>}`) + `public/leadgen/click.ts` | `test/leadgen-macros.test.ts` | PENDING |
| 17 | Offer rules + cap | P4 | `leadgen/rules.ts` + `leadgen_offer_region_rules`/`_cap_counters` | `test/leadgen-rules.test.ts` + cap unit | PENDING |
| 18 | Sections / quote slides | P5 | `admin/leadgen/sections-handlers.ts`, `ui-sections.ts`, derived-index rebuild | `test/leadgen-sections-api.test.ts` (+ rebuild) | PENDING |
| 19 | Rich question builder | P5 | `ui-question-builder.ts` + `public/leadgen/components/registry.ts` (vendored seed) | UI spec: each preset buildable | PENDING |
| 20 | Rich styling / design tokens | P5 | `public/leadgen/designs/{registry,default-funnel/*}.ts` | visual + computed-style spec | PENDING |
| 21 | Reference design audit | P5 | vendored `docs/leadgen/contract/docs/default-funnel-design-audit.md` + reference JSONs | visual regression vs reference JSONs | PENDING |
| 22 | Default design token file | P5 | `public/leadgen/designs/default-funnel/tokens.ts` (vendored, comments token-clean) | computed-style spec | PENDING |
| 23 | Question component presets | P5 | `public/leadgen/components/registry.ts` | per-preset render tests | PENDING |
| 24 | Dependencies / conditional logic | P6 | `content_json.conditional` + builder UI + `public/leadgen/runtime.ts` | dependency preview spec | PENDING |
| 25 | Answer normalization + value mapping | P6 | `public/leadgen/answers.ts` + `section_answer_maps` | `test/leadgen-answers.test.ts` | PENDING |
| 26 | Answer→Offer payload mapping | P6 | `leadgen_section_answer_maps` + `/sections/:id/validate-payload` | mapping + preview tests | PENDING |
| 27 | Google Maps address/ZIP validation | P6 | address/ZIP presets + server key handling + KV ZIP cache | ZIP + autofill tests (Maps live leg BLOCKED until key) | PENDING |
| 28 | Quote/funnel builder | P7 | `admin/leadgen/quotes-handlers.ts`, `ui-quotes.ts`, `leadgen_quotes/_quote_variants/_variant_sections` | funnel builder + validate tests | PENDING |
| 29 | Opening lander | P7 | `quote_variants.lander_*` + editor + shell render | lander render test | PENDING |
| 30 | Funnel rules | P7 | `leadgen_funnel_rules` + `leadgen/rules.ts` | rules unit tests | PENDING |
| 31 | Funnel A/B | P8 | `leadgen_funnel_ab_tests` + `public/leadgen/ab-hash.ts` | golden vectors + 100k ±1% + stickiness | PENDING |
| 32 | Site activation | P7 | `leadgen_site_quotes` + activation panel + resolver | activation resolution tests | PENDING |
| 33 | Auction config | P9 | `admin/leadgen/auctions-handlers.ts`, `ui-auctions.ts`, `leadgen_auctions/_auction_offers` | Auction CRUD tests | PENDING |
| 34 | Auction runtime | P10 | `public/leadgen/auction/{engine,fetch,parse,winner,explain}.ts` + `/lg/auction` + simulate | branch-complete mocked-provider tests + simulate trace | PENDING |
| 35 | Banner builder / design registry | P9 | `designs/banner-default/*`, `ui-banner-builder.ts`, `leadgen_auction_banners` | banner manual/auto tests | PENDING |
| 36 | Carrier identity + carrier rules | P9/P10 | `leadgen/rules.ts` (carrier level, `strictly_override`) + `leadgen_auction_rules` | carrier identity + rules tests | PENDING |
| 37 | Multi-offer / backfill / remove-clicked | P10 | `public/leadgen/auction/winner.ts` + `session_clicked_offers` | 3 modes + backfill + remove tests | PENDING |
| 38 | Tracking event schema (31 events) | P11 | `public/leadgen/*` emitters + `/lg/track` | event-schema tests (all dims) | PENDING |
| 39 | Athena tables | P12 | `infra/leadgen/athena-ddl.sql` (ops applies) | recon tests; live leg BLOCKED(ops) | PENDING |
| 40 | ClickHouse tables + MVs | P12 | `infra/leadgen/clickhouse-ddl.sql` (ops applies) | mirror tests vs mocked CH; live leg BLOCKED(ops) | PENDING |
| 41 | D1 analytics mirrors (9) | P12 | `leadgen/mirror-sync.ts` + `0037` tables + rebuild-range route | `test/leadgen-mirror-sync.test.ts` | PENDING |
| 42 | Revenue ingestion / reconciliation | P13 | `leadgen/revenue-ingest.ts`, `revenue-recon.ts`, `fx.ts`, `public/leadgen/postback.ts` (`/lg/pb`,`/lg/px`) | dedupe/attribution/FX/re-match tests | PENDING |
| 43 | S2S media platform reporting | P13 | `leadgen/s2s-dispatch.ts` + `leadgen_media_platforms` + admin | S2S fire/dedupe tests | PENDING |
| 44 | GA4 validation | P14 | shell GA4 pass-through | GA4 UI tests | PENDING |
| 45 | Performance / caching | P14 | `leadgen/invalidate.ts` + `lg-shell:`/`lg-config:` keys + `LEADGEN_TEMPLATE_VERSION` | perf regression spec | PENDING |
| 46 | Data accuracy / dedupe / reconciliation | P13 | dedupe UNIQUEs + `leadgen_event_dead_letter` + idempotency dims | recon + dedupe tests | PENDING |
| 47 | Security / PII / secrets | P4/P13 | `readEnvSecret` per-Offer tokens; masking; PII hashing; redaction | auth + secret-mask + PII tests | PENDING |
| 48 | Testing plan | P2–P15 | `test/leadgen-*.test.ts` + `test-ui/leadgen-*.spec.ts` + acceptance suites | all green | PENDING |
| 49 | Manual QA checklist | P15 | `manualQA.md` LeadGen section | operator run | PENDING |
| 50 | Implementation phases | P1–P15 | this register per-phase sections | per-phase gates | PENDING |
| 51 | Risks / open questions | P1+ | OQ table above | resolved/acknowledged | PENDING |
| 52 | Final traceability matrix | P15 | this register (final read-out) | all rows ticked | PENDING |

## §35.3 contract checklist (ticked when code + tests are green; cross-references matrix rows above)

| # | Deliverable | Tick |
|---|---|---|
| 1 | Executive summary (contract vendored) | ☑ P1 |
| 2 | Repository findings | ☑ P1 |
| 3 | Patterns to reuse | ☑ P1 |
| 4 | Product architecture | ☐ |
| 5 | CMS navigation | ☑ P3 |
| 6 | Data model | ☑ P2 |
| 7 | D1 schema/migrations | ☑ P2 |
| 8 | API/route design | ☐ |
| 9 | Admin UI | ☐ |
| 10 | Offers tab | ☐ |
| 11 | Payload builder | ☐ |
| 12 | Sections | ☐ |
| 13 | Question builder | ☐ |
| 14 | Styling/design tokens | ☐ |
| 15 | Quote/funnel builder | ☐ |
| 16 | Funnel A/B | ☐ |
| 17 | Site activation | ☐ |
| 18 | Auction tab | ☐ |
| 19 | Auction runtime | ☐ |
| 20 | Banner builder | ☐ |
| 21 | Offer/carrier/rule system | ☐ |
| 22 | Tracking events/sessions | ☐ |
| 23 | ClickHouse aggregation | ☐ |
| 24 | D1 mirroring | ☐ |
| 25 | Provider revenue | ☐ |
| 26 | S2S/media | ☐ |
| 27 | GA4 validation | ☐ |
| 28 | Performance/caching | ☐ |
| 29 | Reconciliation | ☐ |
| 30 | Security/secrets | ☐ |
| 31 | Testing plan | ☐ |
| 32 | Manual QA | ☐ |
| 33 | Phases | ☐ |
| 34 | Risks/open questions | ☐ |
| 35 | Final checklist | ☐ |

## §35.1 validation rules + §35.2 acceptance groups

Implemented in `api/src/leadgen/validation.ts` (server-side, per entity) and asserted by `test/leadgen-validation.test.ts` + integration tests; the §35.2 groups are covered by the phase acceptance criteria (see plan + per-phase sections below). Status tracked via the matrix rows.

---

## Phase sections (verification headers + evidence appended at each phase exit)

### P1 — Findings + contract landing + traceability seed

**Verification header — 2026-07-06, commit `a56f51f`, branch `leadgen/p01-contract-traceability` (base main@`6ff0102`):**
`npm run typecheck` exit 0 · `npm test` **245/245 files, 2071/2071 tests** (54.73s) · `verify:no-legacy-prod-refs` + `verify:infra` + `verify:worker-config` (`verify:all`) exit 0 · `npx playwright test` **63/63** (50.2s, after `db:migrate:local`). Matrix rows flipped this phase: **1, 2, 3 → PASS**.

Evidence collected so far (2026-07-06, branch `leadgen/p01-contract-traceability` off main@`6ff0102` — which equals the contract's cited baseline tree exactly):

- **Baseline on virgin main@6ff0102** (pre-any-edit): `typecheck` exit 0 · vitest **2068/2071** (3 fails: `legacy-ref-allowlist`, `verify-script`, `verify-scripts-green` — single cause: foreign untracked `docs/MISSION-CMS-RESCUE-4.md:26,29` banned-token prose → scanner exit 1; see DEV-6) · `verify:infra` OK (8 checks) · `verify:worker-config` OK (3 blocks).
- **Playwright harness proof on virgin main**: `db:migrate:local` + `seed:local` + `npx playwright test` → **63/63 passed (50.2s)** — matches the Listicles-close count.
- **Post-allowlist (commit 1)**: scanner exit 0; the 3 previously-failing vitest files now **21/21**.
- **Contract vendored (commit 2)**: 26 files / 287,097 bytes; `cd docs/leadgen && shasum -c MANIFEST.sha256` → **26/26 OK**; scanner exit 0 with the contract in-tree.
- **Scanner bite-proof**: planted `docs/leadgen/tmp-bite-probe.md` containing a banned token → scanner exit 1 naming `docs/leadgen/tmp-bite-probe.md:1`; removed → exit 0. The gate demonstrably still bites after the allowlist additions.
- **OQ-9**: migration head `0035` (`0035_listicles_conversion_dedupe.sql`); `0036–0039` free; deploy.yml anchor comments end at `0035` → contract numbers hold (table above).
- **Second live bite (unplanned, kept as evidence):** the first draft of this register quoted the reference-product token literally in the DEV-6 rationale — the phase-exit scanner run failed on `docs/leadgen/traceability.md:33` and the 3 verify-green vitest files failed with it. Reworded (this register stays token-free by policy, like the Listicles register); gates re-run green. This is the "token leakage into new prose" risk observed live; per-commit scanner runs are the mitigation.

**P1 addendum — merge + contract-alignment validation + deploy (2026-07-06, post-delegation, recorded in P2's PR):**
- PR #72 squash-merged as `0e625b2` (MERGED 2026-07-06T12:56Z); PR CI run green.
- **Contract alignment 100% VERIFIED post-land:** every committed `docs/leadgen/contract/` file byte-compared against an INDEPENDENT fresh fetch + second transcription from the design project — `cmp` IDENTICAL for 25/26; `README.md` verified via the two-transcription calibration chain (fresh-fetch write ≡ from-context write ≡ committed copy). Result: **26 verified, 0 failed**; `shasum -c MANIFEST.sha256` re-check 26/26 OK. (Method note: a first attempt to reuse the original download as the comparison copy was caught and discarded as circular — comparisons only count against a second independent transcription.)
- **Production deploy:** run `28793161710` success — `typecheck + test + verify` green, `Deploy to production` green, `Deploy to staging` skipped (`ENABLE_STAGING_DEPLOY` unset; see DEV-8). Live verification: tenant `/health` → 200 `{"ok":true,"app":"kodigital-homepages-cms"}`; public tenant page 200; `/admin/leadgen` off-`ADMIN_HOST` → 404; admin host fronted by CF Access (302 to login) — posture intact.

### P2 — D1 migrations / core data model

**Verification header — 2026-07-06, commit `97ced4b`, branch `leadgen/p02-d1-migrations` (base main@`0e625b2`):**
`npm run typecheck` exit 0 · `npm test` **246/246 files, 2079/2079 tests** (54.36s; +1 file/+8 tests = `leadgen-migrations.test.ts` in-suite) · `verify:all` exit 0 · `npx playwright test` **63/63** (52.0s) with `0036–0039` applied to local D1 — Listicles/homepage suites unaffected. Matrix rows flipped this phase: **8, 9 → PASS**.

Evidence:
- **Contract alignment (P2 scope):** `api/migrations/0036–0039` are `cmp`-IDENTICAL to `docs/leadgen/contract/migrations/` (which is itself 26/26 byte-verified against the design project — see P1 addendum) → the shipped DDL is transitively verified against the SSOT.
- **deploy.yml anchors:** all four filenames grep-anchored (same commit as the migration files, per the D1-file rule).
- **Local apply:** `db:migrate:local` all four ✅; local D1 `leadgen_%` table count = **40**.
- **Constraints proven** (`api/test/leadgen-migrations.test.ts`, 8 tests): 40-table existence + key names; idempotent re-run; `offer_type` CHECK rejects `cpm`; UNIQUE `(provider,external_txn_id)`, `(click_id,dedupe_key)`, `(variant_id,position)`; partial uniques `uq_leadgen_sitequote_root` (one enabled NULL-slug root per site, disabled/slugged/other-site all accepted) + `uq_leadgen_offerplacement_default` (one default placement per offer).
- **Row/API types:** `api/src/admin/leadgen/db-types.ts` (1193 lines) — 40 Row + 40 Api pairs, 38 CHECK-derived unions, typed `conditions_json` (07§21.4) + canonical Carrier (07§20); mechanical set-equality vs DDL 40/40; compiles under `tsc --noEmit`.
- Remote apply happens at this PR's production deploy (workflow migration step); post-deploy probe recorded in the P2 addendum below.

**P2 deploy addendum — 2026-07-06, squash-merge `6e48207` (PR #73), production dispatch run `28794699290` (success):**
- Workflow migration step applied `0036–0039` to the LIVE shared D1 (`kodigital-homepages-cms-db`) before the Worker deploy — remote ticks recorded in the numbering table above.
- Post-deploy D1 probe (cf-bindings `d1_database_query` on the live DB): `leadgen_%` tables **0→40**, `listicle_%` **23→23** (untouched), total 49→89; all 3 partial-unique indexes present (`uq_leadgen_sitequote_root`, `uq_leadgen_offerplacement_default`, `uq_leadgen_abtest_running`).
- Live worker checks: tenant `/health` 200 `{"ok":true}`; public tenant page 200; `/admin/leadgen` off-`ADMIN_HOST` → 404; admin host fronted by CF Access (302) — posture unchanged.
- **CP1 discharged** (agent-executed per DEV-8): watched deploy + live `sqlite_master` probe. Staging permanently skipped — operator ratified (DEV-8).

### P3 — Admin nav + shell

**Verification header — 2026-07-06, commit `a92fcc6`, branch `leadgen/p03-admin-shell` (base main@`6e48207`):**
`npm run typecheck` exit 0 · `npm test` **247/247 files, 2110/2110 tests** (+1 file/+31 tests = `leadgen-admin-shell.test.ts`) · `verify:all` exit 0 (scanner + infra 8 + worker-config 3 checks) · `npx playwright test` **65/65** (+2 = `test-ui/leadgen-nav.spec.ts`) — Listicles/homepage suites unaffected by the sidebar change. Matrix rows flipped this phase: **6 → PASS**; §35.3 row 5 ☑; rows 4/5/10/11 carry P3-partial notes.

Evidence:
- **Shipped:** `src/leadgen/ids.ts` (14 `public_id` prefixes per normative `02`§6.1/§6.3 — DEV-10; listicles-identical ULID core), `src/admin/leadgen/{router,ui}.ts` mounted beside the listicles pair in `src/admin/router.ts`, LeadGen nav item immediately after Listicles in `layout.ts` + NAV count-test 10→11 (same commit), `test/leadgen-admin-shell.test.ts` (31 tests), `test-ui/leadgen-nav.spec.ts` (2 tests).
- **Contract fidelity — fresh-context adversarial review (12 mandated checks): verdict SHIP, zero BLOCKER/MAJOR.** Prefixes character-exact vs `02`§6.1 (full-object equality); tab paths singular-`auction` / API plural-`auctions` proven from both sides (01 §5.2 + 03 §8.2); paging shape byte-identical to listicles (`03`§8.4); Row→API mappers enumerated column-by-column vs `0036` DDL (offers 2 bools; sections 3 JSON + 1 bool; quotes 1 JSON; auctions 3 bools + 1 JSON — exact sets, no misses); SQL: fixed-literal tables + `.bind()`-only + `??` numeric defaults; XSS sweep clean (escapeHtml everywhere; hostile-name runtime probe).
- **Headers-TOTAL (03 §8.1/§9.1):** `private, no-store` + `nosniff` asserted on redirect / 4 tab pages / API-200 / API-404 / HTML-404 / bare API root / method-miss / thrown-500 (review's one MINOR — the last four classes untested — closed in-phase with a poisoned-DB 500 probe through the real router + onError).
- **Dual `:id` (03 §8.1):** numeric and `public_id` resolve the SAME seeded entity; malformed / foreign-kind / nonexistent → 404 `{error}` with no DB read on malformed; shared-stem prefixes (`lga_`/`lgar_`, `lgp_`/`lgpl_`) cannot cross-accept.
- **Auth/host wall:** off-`ADMIN_HOST` flat 404 (shell + API); unauthenticated requests rejected with exact status parity vs the listicles equivalents — no new auth code, inherited gate (03 §8.1).
- **Live leg:** the admin shell sits behind CF Access in production — live behavioral verification is local-Playwright-proven (65/65) + posture-checked at deploy; recorded in the P3 deploy addendum below.

**P3 deploy addendum — 2026-07-06, squash-merge `680790f` (PR #74), production dispatch run `28799408632` (success: CI green, Deploy to production green, staging skipped per DEV-8):**
- No migrations this phase — the deploy's migration step was an idempotent no-op; live D1 unchanged.
- Live posture: tenant `/health` 200 `{"ok":true,"app":"kodigital-homepages-cms"}` (thecontentandcareer.com); `/admin/leadgen` off-`ADMIN_HOST` → 404 (the NEW route is host-walled — new-code behavioral evidence); admin host `/admin/leadgen` unauthenticated → CF Access 302 carrying `redirect_url=/admin/leadgen` (the new path is live behind the gate).
- Shell behavior itself is local-proven (Playwright 65/65 incl. `leadgen-nav.spec.ts`); production admin UI sits behind CF Access — operator can eyeball `/admin/leadgen` at any CP station.

### P4 — Offers + payload builder + Test tool
_(pending)_

### P5 — Sections + design system
_(pending)_

### P6 — Mapping + dependencies + Google Maps
_(pending)_

### P7 — Quotes + funnel builder + activation
_(pending)_

### P8 — Funnel A/B
_(pending)_

### P9 — Auction config + banner builder
_(pending)_

### P10 — Auction runtime
_(pending)_

### P11 — Tracking + macros + click resolver
_(pending)_

### P12 — ClickHouse + D1 mirrors
_(pending)_

### P13 — Revenue + S2S
_(pending)_

### P14 — GA4 + performance
_(pending)_

### P15 — QA + visual + sign-off
_(pending)_
