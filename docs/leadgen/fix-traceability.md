# LeadGen CMS — Operational Fix Contract v2.4 · Traceability (living doc)

**Mission:** implement the Operational Fix Contract v2.4 exactly, phase by phase (5 phases, 5 PRs, one branch at a time, squash merges). Vehicle: direct branch+PR (program precedent). Delegated loop (operator-confirmed 2026-07-08): implement → full gates → fresh-context adversarial review (SHIP required) → PR → self-squash-merge → next phase. **The agent performs no deploys and no secret writes** (contract-binding). Production deploy + post-deploy verification + manual-QA execution are operator-owned and tracked BLOCKED, never PASS.

**Contract SSOT:** `docs/leadgen/fix-contract-v2.4/` (15 files, `00`–`14`) + `MANIFEST.sha256` — vendored verbatim from Claude Design project `159eadec-6141-4457-a2df-3cc02f035659` `fix-contract-v2.4/`. **Byte-fidelity: 15/15 files re-fetched and `cmp`-verified BYTE-IDENTICAL on 2026-07-08** (per-file log in session records; every fetch asserted `truncated:false`). Citations `NN §x` = `docs/leadgen/fix-contract-v2.4/NN-*.md`. Issue evidence base: `LEADGEN-CMS-INVESTIGATION-REPORT.md` (workspace root, outside this repo).

**Baseline (virgin `main @ 52905b2` = origin/main, clean tree, 2026-07-08):** `tsc --noEmit` 0 errors · vitest **3257/3257 (299 files)** · `verify:all` OK (no-legacy-prod-refs + infra 8 checks + worker-config 3 blocks) · Playwright **91/91** (after wipe `api/.wrangler/state/v3/d1` → `db:migrate:local` → `seed:local`). Zero pre-existing failures — every later failure/count-change is attributable to this mission. Migration head at baseline: `0039` → contract migration numbering `0040` HOLDS. Scanner over the vendored v2.4 package: **GREEN with zero allowlist additions** (the package is token-clean).

**Evidence standard (binding, `11` §11.5):** a row flips `Specified → PASS` only with runtime-grade evidence — named test file + test name that EXECUTES the claimed behavior (a unit test cannot satisfy an E2E claim); `FAIL` carries the failing evidence; `BLOCKED(<named blocker>)` for operator-owned legs. No row may cite a test that does not execute the claimed behavior. Statuses in this file are the mission's single progress truth.

## The 42-row matrix (requirement → implementation files → tests → status)

Requirement + acceptance per row are governed by the vendored contract (`02` full matrix, `13` per-row acceptance) — this table tracks EXECUTION. "Files" and "Tests" columns are updated to ACTUAL paths/names as each row lands.

| Issue | Sev | Phase | Requirement (v2.4 §) | Implementation file(s) (planned → actual) | Test(s) (evidence) | Status |
|---|---|---|---|---|---|---|
| R1 | P0 | 1 | `03` engine: server-render + hydration, full lifecycle; acceptance `03` §3.11 | `serve.ts`, new `public/leadgen/runtime/*`, `components/presets.ts`, `config-dto.ts`, `scripts/build-leadgen-runtime.ts`, `runtime-routes.ts` | G1 `leadgen-live-funnel.spec.ts` + G2 units + §11.6 anti-false-PASS | Specified |
| R2 | P0 | 1 | `04` §§4.1–4.3, 4.7 canonical context into payloads; acceptance `04` §4.9 | new `leadgen/runtime-context.ts`; `auction/engine.ts`, `auction/fetch.ts`, `serve-auction.ts`, `payload-builder-handlers.ts`, `click.ts` | G2 32-macro table + G1 payload assert | Specified |
| R3 | P0 | 1 (+2 UI) | `04` §4.4 computed registry + `computed_unknown_key` + runtime population | new `leadgen/computed.ts`; `leadgen/payload.ts`; (P2: `ui-payload-builder.ts`) | G2 registry + rejection tests | Specified |
| R4 | P0 | 1 | `05` §5.1 eligibility gate wired ×4; EMPTY_SCHEMA removed | `leadgen/validation.ts`, `auction/engine.ts`, `auctions-handlers.ts`, `ui-offers.ts`, `ui-auctions.ts` | G3 gates suite | Specified |
| R5 | P0 | 1 | `05` §5.2 activation/variant gate + 409 report + preflight UI | `quotes-handlers.ts`, `leadgen/sections.ts`, `sections-handlers.ts`, `ui-quotes.ts` | G3 activation 409 tests | Specified |
| R6 | P1 | 1 | `05` §5.4 version stamping server+engine; config DTO mapping version | `analytics/leadgen-events.ts`, `serve-auction.ts`, `config-dto.ts`, `runtime/events.ts` | G2 event-shape tests | Specified |
| R7 | P1 | 1 | `03` §3.6 impressions returned + IntersectionObserver beacons + dedupe | `auction/banner.ts`, `auction/engine.ts`, `serve-auction.ts`, `runtime/auction-client.ts` | G1 impression E2E | Specified |
| R8 | P1 | 1 | `04` §4.6 persisted snapshot (mig 0040) + fresh request macros at `/lg/lc` | `runtime-routes.ts`, `click.ts`, `serve-auction.ts`, `migrations/0040_leadgen_runtime_context.sql` | G2 unit + G1 redirect E2E | Specified |
| R9 | P2 | 1 | `05` §5.3 tuple v2 (+session_id, answer_mapping_hash, auction_config_version) | `attempt.ts`, `serve-auction.ts`, `runtime/auction-client.ts` | G3 tamper matrix | Specified |
| A1 | P2 | 3 | `07` §7.2 usage-guarded hard delete + erratum §9.6 | `offers-handlers.ts`, `router.ts`, `ui-offers.ts` | G4 delete tests | Specified |
| A2 | P2 | 3 | `07` §7.3 duplicate (Q3 copy-set, new ids, placement required, draft+untested) | `offers-handlers.ts`, `ui-offers.ts`, `leadgen/ids.ts` | G4 duplicate tests | Specified |
| A3 | P2 | 3 | `07` §7.4 full usage inventory (12 kinds) | `offers-handlers.ts` | G4 usage completeness | Specified |
| B1 | P1 | 2 | `06` §§6.3/6.9/6.10 visual value-map/condition/default builders; JSON→Advanced | `ui-payload-builder.ts` | G5 zero-JSON authoring | Specified |
| B2 | P1 | 2 | `06` §§6.1/6.8 field tree + nested object/array builders | `ui-payload-builder.ts` | G5 nested-schema test | Specified |
| B3 | P1 | 1 (+2 UI) | `04` §4.5 placement source/macro threading; Test picker | `leadgen/payload.ts`, `auction/engine.ts`, `auction/fetch.ts`; (P2: Test tab) | G2 placement resolution matrix | Specified |
| B4 | P1 | 2 | `06` §6.12.1 generated sample-answer form | `payload-builder-handlers.ts`, `ui-payload-builder.ts` | G4+G5 test-tool tests | Specified |
| B5 | P2 | 2 | `06` §6.12.2 simulated context (shared builder overrides) | `payload-builder-handlers.ts` | G4 sim parity test | Specified |
| B6 | P1 | 2 | `06` §6.11 count + click-to-focus + inline errors | `ui-payload-builder.ts` | G5 focus test | Specified |
| B7 | P2 | 2 | `05` §5.5 pre-test validation, typed 400 | `payload-builder-handlers.ts` | G4 invalid-schema 400 | Specified |
| B8 | P2 | 2 | `04` §4.4 computed dropdown from registry (UI half of R3) | `ui-payload-builder.ts` | with R3 | Specified |
| B9 | P2 | 2 (+1 rt) | `06` §6.4 choiceDisplay + Other renderer; never literal "Other" | `leadgen/payload.ts`, `components/content-schema.ts`, `runtime/render.ts`, presets; (P2: editor) | G2 runtime + G5 authoring | Specified |
| B10 | P2 | 2 | `06` §6.7 six boolean presets | `ui-payload-builder.ts`, `leadgen/payload.ts` | G2 per-preset shapes | Specified |
| B11 | P2 | 2 | `06` §6.6 date mode + format picker → formatDate | `ui-payload-builder.ts`, `leadgen/payload.ts` | G2 format matrix + G5 UI | Specified |
| B12 | P2 | 2 | `06` §6.5 explicit free-text toggle | `ui-payload-builder.ts`, `leadgen/payload.ts`, `leadgen/answers.ts` | G5 toggle test | Specified |
| C1 | P1 | 2 | `06` §6.12 Test tab operable with zero JSON (B4+B5+B7+pickers+env) | `ui-payload-builder.ts`, `payload-builder-handlers.ts` | G4+G5 test-tool suite | Specified |
| D1 | P2 | 3 | `07` §7.5 two labeled behaviors; enum frozen; erratum recorded | `leadgen/rules.ts` labels, `ui-offers.ts` | G4 semantics regression + G5 labels | Specified |
| D2 | P3 | 3 | `07` §7.5 "Evaluation order" label + help | `ui-offers.ts` | G5 snapshot | Specified |
| D3 | P2 | 3 | `07` §7.5 per-dimension region validators + chips + paste-multiple | `leadgen/validation.ts`, `ui-offers.ts` | G4 validator units | Specified |
| E1 | P1 | 4 | `08` §8.2 Activity/Vertical comboboxes + pair warning | `ui-sections.ts`/studio, `leadgen/sections.ts` | G5 combobox tests | Specified |
| E2 | P1 | 4 | `08` §8.7 mapping via pickers + value-map modal + per-row test | studio, `sections-handlers.ts` | G5 mapping flow | Specified |
| E3 | P2 | 4 | `08` §§8.3–8.6 thumbnail library / drag-drop canvas / tabbed inspector | new `ui-section-studio.ts` | G5 authoring flows (§8.12) | Specified |
| E4 | P2 | 4 | `08` §8.5 tokenized layout containers (9) | `components/content-schema.ts`, `components/presets.ts`, `components/registry.ts`, `runtime/render.ts`, designs | G2 serialization + G5 render | Specified |
| E5 | P1 | 4 | `09` §9.2 parameterized server-rendered sims; design honored; reversible viewports | `sections-handlers.ts`, studio preview | G5 sim-difference tests + round-trip | Specified |
| E6 | P2 | 4 (+1 rt) | `08` §8.8 field-level Maps config + engine wiring + key-missing fallback | presets, `runtime/maps.ts`, studio, `leadgen/maps.ts` | G6 Maps suite | Specified |
| E7 | P2 | 4 | `08` §8.10 NumberInputQuestion + CurrencyInputQuestion presets | `components/registry.ts`, presets, content-schema | G2 render tests | Specified |
| E8 | P3 | 4 | `08` §8.10 SuccessState + success styling | `components/registry.ts`, presets, designs | G2 render test | Specified |
| E9 | P3 | 4 | `08` §8.2 explicit no-Offers empty state | studio mapping panel | G5 copy test | Specified |
| S1 | P2 | 3 | `07` §7.6 simulate: redacted per-offer payload + parser + exclusions, stays dry | `auctions-handlers.ts`, `auction/explain.ts`, `leadgen/redact.ts` | G4 simulate test | Specified |
| T1 | P1 | 1+5 | `11` §§11.2/11.6 live-funnel suites + permanent anti-false-PASS | `test-ui/leadgen-live-funnel.spec.ts` (new), `leadgen-visual.spec.ts`, `leadgen-perf.spec.ts`, `leadgen-runtime.spec.ts` | the suites ARE the work | Specified |
| T2 | P1 | 5 | `11` §§11.5/11.7 52-row re-audit + executed signed manual QA | `docs/leadgen/traceability.md`, `docs/leadgen/manualQA.md` | re-verification checklist | Specified |
| M1 | P3 | 1 | `04` §4.3 `referrer` → `referer` alias | `leadgen/macros.ts` | G2 unit | Specified |
| M2 | P3 | 2 | `06` §6.2 grouped macro source picker | `ui-payload-builder.ts` | G5 UI test | Specified |

Row count: 42 (R×9, A×3, B×12, C×1, D×3, E×9, S×1, T×2, M×2) — 1:1 with contract `13`.

## Phase verification headers (filled at each phase exit — gate outputs with counts, rows flipped, PR#, adversarial-review verdict)

### Fix-P1 — Runtime engine + P0 gates — IN PROGRESS (branch `leadgen/fix-p1-runtime-engine`)
- Started 2026-07-08. Gates: pending.

### Fix-P2 — Payload Builder UX — NOT STARTED
### Fix-P3 — Offer management + rules — NOT STARTED
### Fix-P4 — Section Studio rebuild — NOT STARTED
### Fix-P5 — Parity + analytics proof + QA honesty — NOT STARTED

## DEV register (continues v2.3.7's DEV-1…26 in `docs/leadgen/traceability.md`)

| # | Decision / evidence |
|---|---|
| DEV-27 | **Fix-mission bootstrap evidence (2026-07-08):** baseline on virgin `main @ 52905b2` ALL GREEN (tsc 0 · vitest 3257/3257 across 299 files · verify:all OK · Playwright 91/91 after the local-D1 wipe+migrate+seed ritual) — zero pre-existing failures, so every subsequent count-change is mission-attributable. v2.4 contract vendored to `docs/leadgen/fix-contract-v2.4/` (15 files + MANIFEST.sha256); byte-fidelity proven by per-file re-fetch + `cmp`: 15/15 BYTE-IDENTICAL; scanner green with ZERO allowlist additions (package is token-clean by authorship). Migration head confirmed `0039` → contract's `0040_leadgen_runtime_context.sql` numbering holds; deploy.yml anchor due in the same commit that adds it. |
| DEV-28 | **Phase-1 cache-coherence design (verified against code pre-implementation):** inlining the `/lg/config` JSON into the KV-cached shell is visitor-safe (`buildPublicConfig` is a pure `(resolved, design)` projection with zero per-visitor fields; `assignment_bucket` deliberately excluded and stays splice-only) BUT requires adding the **`ab_rev` axis** to `leadgenShellKey` + `leadgenShellEtag` (the one axis `lg-config:` has and `lg-shell:` lacks; without it an A/B start/stop/re-bump serves stale baked test dims until TTL — the exact failure mode the config key's own comment documents). Sentinel discipline unchanged (`MAPS_KEY_SENTINEL`, `ASSIGN_SENTINEL` keep splicing the pristine cached body). `renderSectionComponents` verified pure (content_json + design tokens; pinned `en-US` locale) → server-rendered sections keep the cached body variant-invariant under existing axes. Dev harness facts: `/lg/attempt` mints an explicit `unsigned.` token without `LEADGEN_CONFIG_SIGNING_KEY`, but the money path is hard-coded `requireSigned:true` → local G1 needs a dev-only signing key in gitignored `api/.dev.vars` (never a CF secret write; `requireSigned` never weakened). Mock provider: server-mode Offer endpoints have no host/IP validation (`isAbsoluteHttpUrl` only) and the auction fetch fires `endpoint_production` verbatim → G1 seeds a server-mode Offer PATCHed to a Playwright-launched `http://127.0.0.1:<port>/mock`; drive with a non-headless UA (dev bot-arm UA heuristics). |

## Manual QA hand-off (operator-owned — `11` §11.7; blank sign-off = FAIL state for Fix-P5)

| Scenario | Prepared (docs/leadgen/manualQA.md §) | Operator run | Result |
|---|---|---|---|
| MQA-R1 live `/lg` full completion (desktop+mobile) | pending (Fix-P5) | BLOCKED(operator) | |
| MQA-R2 banners render; impressions in analytics | pending (Fix-P5) | BLOCKED(operator) | |
| MQA-R3 banner click → resolved provider URL | pending (Fix-P5) | BLOCKED(operator) | |
| MQA-R4 payload carries real geo/ip/traffic/computed/placement | pending (Fix-P5) | BLOCKED(operator) | |
| MQA-R5 ineligible Offer blocked from auction | pending (Fix-P5) | BLOCKED(operator) | |
| MQA-R6 invalid Quote activation blocked w/ report | pending (Fix-P5) | BLOCKED(operator) | |
| MQA-R7 zero-JSON payload authoring + Test | pending (Fix-P5) | BLOCKED(operator) | |
| MQA-R8 Studio pattern §8.11-(4) start-to-finish | pending (Fix-P5) | BLOCKED(operator) | |
| MQA-R9 Maps field-level config + missing-key fallback | pending (Fix-P5) | BLOCKED(operator) | |
| MQA-R10 desktop/mobile preview round-trip | pending (Fix-P5) | BLOCKED(operator) | |

## Operator-owned residuals (carried from v2.3.7 — unchanged by this mission; BLOCKED, never PASS)

Production deploy + post-deploy behavioral verification (per-phase or at mission end — operator's call) · manual-QA execution + sign-off (above) · CH secrets (`CH_URL`/`CH_USER`/`CH_PASSWORD`) + `infra/leadgen/{clickhouse,athena}-ddl.sql` apply + Athena→CH ingest · `GOOGLE_MAPS_BROWSER_KEY`/`_SERVER_KEY` · `LEADGEN_CONFIG_SIGNING_KEY` (mandatory before live auction — fails closed) · per-provider `LEADGEN_PB_TOKEN_*`/`LEADGEN_S2S_TOKEN_*` · live-tenant Quote activation · DEV-24 contract erratum (`lg_events_raw.continued_to_next_section`) in the v2.3.7 contract SSOT.
