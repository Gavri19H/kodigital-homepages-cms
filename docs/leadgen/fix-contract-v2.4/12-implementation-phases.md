# 12 · Implementation Phases

Sequential; Phases 2–4 are independently shippable after Phase 1. Every phase ends with its verify gates green (`11` §11.1) and its PASS criteria met — do not advance otherwise. No deploys, no secret writes by the agent, additive-only migrations, banned-token guardrails enforced throughout.

## Phase 1 — Runtime engine + P0 gates

- **Issues:** R1 R2 R3 R4 R5 R6 R7 R8 R9 · runtime legs of B3/B9/E6 · T1 (live suite bootstrap) · M1.
- **Scope:** server-rendered Sections + hydration engine (`03`); canonical runtime context + computed registry + placement threading + click-time macros (`04`); eligibility + activation gates + token v2 + version stamping (`05`); impressions returned + beaconed; auction-path/server event producers (`10` §10.2); migration `0040_leadgen_runtime_context.sql` (additive: `leadgen_auction_result_log.macro_context_json`); `GET /lg/runtime/:version.js`; bundle build script + `verify:leadgen-runtime`.
- **Out of scope:** all admin editor UX (Phases 2–4) beyond the Offer-editor eligibility banner + activation preflight panel (thin, server-verdict-driven); layout containers authoring UI; Studio.
- **Files expected to change:** `serve.ts`, `runtime-routes.ts`, `serve-auction.ts`, `auction/engine.ts`, `auction/fetch.ts`, `auction/banner.ts`, `click.ts`, `attempt.ts`, `config-dto.ts`, `components/presets.ts`, `quotes-handlers.ts`, `auctions-handlers.ts`, `payload-builder-handlers.ts` (context builder swap), `analytics/leadgen-events.ts` (stamp helpers), `leadgen/validation.ts`, `leadgen/macros.ts` (M1), `ui-offers.ts` + `ui-quotes.ts` (thin gate surfaces); **new:** `leadgen/runtime-context.ts`, `leadgen/computed.ts`, `public/leadgen/runtime/{engine,render,state,events,validation,dependencies,maps,auction-client}.ts`, `runtime/engine-bundle.generated.ts`, `scripts/build-leadgen-runtime.ts`, `migrations/0040_*.sql` (renumber to head+1 at build time).
- **APIs/routes:** `/lg/:slug` (content-bearing), `/lg/runtime/:version.js` (new), `/lg/auction` (response additions + tuple v2), `/lg/attempt` (v2 token), activation PUT (409 gate), auction-offers PUT (warnings).
- **UI components:** activation preflight panel; Offer eligibility banner + list badge.
- **Tests to add:** G1 (all), G2 (context/computed/placement/versions/state/beacons), G3 (all), G6 runtime leg; anti-false-PASS set (`11` §11.6).
- **Manual QA:** MQA-R1…R6.
- **Blockers/dependencies:** `LEADGEN_CONFIG_SIGNING_KEY` present in staging (else unsigned dev mode); Google Maps browser key optional (G6 no-op path testable without); mock provider fixtures.
- **Acceptance / PASS:** `03` §3.11 + `04` §4.9 + `05` §5.7 all hold; Group 1–3 green in CI; anti-false-PASS green; bundle ≤40KB; no banned tokens; migrations additive-only.

## Phase 2 — Payload Builder UX + data correctness

- **Issues:** B1 B2 B4 B5 B6 B7 B8 B10 B11 B12 · B3/B9 UI halves · C1 · M2 · R3 UI half.
- **Scope:** `06` in full — three-pane shell, grouped sources, value-map table, Other grouping metadata + editor, free-text/date/boolean modes, object/array builders, default/fallback + condition builders, validation panel, Test tab (form generation, simulated context, placement + env pickers, validity gate), Advanced drawer.
- **Out of scope:** Section-side editors (Phase 4); any storage-format change (projections only; `choiceDisplay` is additive metadata).
- **Files:** `ui-payload-builder.ts` (rebuilt), `payload-builder-handlers.ts` (sample-answer generation endpoint + simulated-context overrides + pre-test validation), `offers-handlers.ts` (additive response fields), `payload.ts` (typed `computed_unknown_key` already Phase 1; `choiceDisplay` schema acceptance), `components/content-schema.ts` (choiceDisplay passthrough).
- **APIs/routes:** existing `/api/admin/leadgen/offers/:id/payload*` + Test endpoints — additive request/response fields only; `POST …/payload/sample-answers` (new, generation).
- **UI components:** payload tree, field editor panels, value-map modal, condition builder, error panel, Test form.
- **Tests:** G2 (formats/presets/mapping), G4 (test tool), G5 (zero-JSON authoring, focus, Test flow).
- **Manual QA:** MQA-R7.
- **Blockers/dependencies:** Phase 1’s `COMPUTED_REGISTRY` + context builder (Test parity), placement threading.
- **PASS:** `06` §6.14 acceptance; G5 zero-JSON suite green; no normal-mode JSON input reachable.

## Phase 3 — Offer management + rules polish

- **Issues:** A1 A2 A3 D1 D2 D3 S1.
- **Scope:** `07` in full — guarded hard delete + erratum, duplicate flow, full usage inventory, region-rule labels/validators/priority label, simulate payload explainability.
- **Out of scope:** auction architecture; rule semantics (aliases stay frozen); new rule types.
- **Files:** `offers-handlers.ts`, `router.ts`, `ui-offers.ts`, `leadgen/validation.ts` (region validators), `auctions-handlers.ts`, `auction/explain.ts`, `leadgen/redact.ts` (reuse).
- **APIs/routes:** `DELETE /offers/:id?mode=hard` (guarded), `POST /offers/:id/duplicate` (new), `GET /offers/:id/usage` (extended), simulate response additions.
- **UI components:** row-action kebab, duplicate modal, delete/usage modals, region-rule editor, simulate trace panel.
- **Tests:** G4 (delete/duplicate/usage/region/simulate), G5 (list/modals/labels).
- **Manual QA:** duplicate→test→activate walkthrough; delete blocked/allowed pair.
- **Blockers/dependencies:** none beyond Phase 1 merge (eligibility badge reuse).
- **PASS:** `07` §7.8 acceptance; alias-semantics regression green.

## Phase 4 — Section Studio rebuild

- **Issues:** E1–E9 (E6/B9 runtime legs landed Phase 1; this phase ships authoring + presets completeness).
- **Scope:** `08` in full — Studio shell, Activity/Vertical comboboxes, thumbnail library, drag-drop canvas, tokenized layout containers, tabbed inspector, mapping panel with pickers, field-level Maps config UI, preview parameterization (`09` §9.2), new components (NumberInput, CurrencyInput, SuccessState, SearchableDropdown, OtherGroupSelector, TrustBar/LogoStrip, StepIndicator, SecureFormBadge).
- **Out of scope:** data-model redesign; arbitrary CSS; page-level multi-Section composition beyond the container set.
- **Files:** **new** `ui-section-studio.ts` (replaces the `ui-question-builder.ts` editor layer), `ui-sections.ts`, `sections-handlers.ts` (preview params; thumbnail render endpoint), `components/{registry,content-schema,presets}.ts`, `designs/*` (container + new-component token slots), `runtime/render.ts` (container behaviors — shared bundle rebuild).
- **APIs/routes:** `POST /sections/preview` (parameterized), `GET /activities` `/verticals` (existing, now consumed), `validate-payload` (existing, now surfaced).
- **UI components:** per `08` §§8.1–8.10.
- **Tests:** G5 Studio suite incl. four §8.11 patterns; G2 container serialization; G6 Maps config; parity fixtures extended (`09` §9.3).
- **Manual QA:** MQA-R8, R9, R10.
- **Blockers/dependencies:** Phase 1 runtime bundle (preview hydration parity); Phase 2 value-map table (reused in mapping grid).
- **PASS:** `08` §8.13 acceptance; legacy Sections load/re-save without loss; publish-block integration (R5) green from the Studio side.

## Phase 5 — Parity lock, analytics proof, QA honesty

- **Issues:** T1 T2 (+ `10` §10.2 producer proof, §10.3 chain proof).
- **Scope:** parity matrix + static shared-renderer assertions (`09` §9.3/§9.5); producer-coverage + attribution-chain tests; delete/replace false-comfort tests; re-audit all 52 v2.3.7 traceability rows with runtime evidence; update `docs/leadgen/traceability.md`; execute + sign manual QA (all MQA-R scenarios + surviving v2.3.7 scenarios incl. MQA-16/22).
- **Out of scope:** new features.
- **Files:** `test/leadgen-parity.test.ts`, `test-ui/leadgen-live-funnel.spec.ts` (final form), `test-ui/leadgen-visual.spec.ts` (re-pointed at `/lg`), `test-ui/leadgen-perf.spec.ts` (with-content budgets), `docs/leadgen/traceability.md`, `docs/leadgen/manualQA.md`.
- **Tests:** the suites ARE the deliverable; plus mirror schema-diff test (9 mirrors unchanged).
- **Manual QA:** full signed run.
- **Blockers/dependencies:** Phases 1–4 merged; staging site with an activated Quote + mock/staging provider.
- **PASS:** `11` §11.8 in full — Vitest green · Playwright green · verify:all green · anti-false-PASS in place · traceability updated honestly · manual QA signed. This is the contract’s overall DONE gate (`14`).
