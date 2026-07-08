# 00 · Executive Summary — LeadGen CMS · Operational Fix Contract v2.4

**Contract name:** LeadGen CMS — Operational Fix Contract v2.4
**Type:** strict, implementation-ready **fixing contract** for the already-implemented LeadGen CMS. It does **not** redesign the approved v2.3.7 architecture; it makes the shipped implementation operational end-to-end and operable by non-technical operators/designers.
**Final status:** **READY FOR IMPLEMENTATION after user approval.** Nothing in this package is "fixed" — every row is *Specified* (this is a design contract, not implementation).

## Identity & sources of truth

| Item | Value |
|---|---|
| Target repo | `Gavri19H/kodigital-homepages-cms` · Worker `kodigital-homepages-cms-worker` |
| Implementation baseline | `main @ 52905b2` (`52905b2bb42b4e54ff581ba3afb77e836eccef85`) — re-verify HEAD at kickoff; newer main must be explicitly confirmed by inspection before use |
| Implemented by | PRs **#72–#87** (original LeadGen CMS v2.3.7 contract build) |
| Approved contract | v2.3.7 — in-repo `docs/leadgen/contract/*` (byte-identical to the design-MCP source), `docs/leadgen/traceability.md`, `docs/leadgen/manualQA.md`. Citations `NN §x` = `docs/leadgen/contract/NN-*.md` |
| Operational-readiness source of truth | `LEADGEN-CMS-INVESTIGATION-REPORT.md` (investigation of `main @ 52905b2`; issue IDs R1–R9, A1–A3, B1–B12, C1, D1–D3, E1–E9, T1–T2, S1, M1–M2) |
| Evidence basis | Written issue descriptions + investigation report + existing code + v2.3.7 contract. Product-owner screenshots were **descriptive aids only** — they are NOT design references. Component screenshots remain *capability examples only*; the default visual design remains the measured reference funnel (`designs/default-funnel/tokens.ts`) |

## Verdict (from the investigation, adopted verbatim as the fix baseline)

The **admin/configuration plane is largely contract-complete and well-built**. The **end-user runtime plane is not operational**:

1. **R1** — `/lg/:slug` serves an empty shell. `renderFunnelShell` (`api/src/public/leadgen/serve.ts:308–346`) emits no section content; the bootstrap (`serve.ts:289–301`) fetches `/lg/config` + `/lg/attempt`, stashes `window.__LG_BOOTSTRAP__`, dispatches `lg:bootstrap` — and **nothing in the repo consumes it**. The client engine that renders questions, collects answers, emits tracking, and calls the auction **does not exist**.
2. **R2** — the auction engine builds provider requests with an empty macro context (`auction/engine.ts:767–778`, `auction/fetch.ts:173`); `source=macro` fields (ip, ua, country, state, city, referer, utm, subs…) resolve to nothing and are dropped. Choosing macro=ip does not send the IP — it sends nothing.
3. **R3** — `source=computed` is dead end-to-end: no registry, free-text key UI, any key validates, `ctx.computed` never populated.
4. **R4** — `dynamicAuctionEligibility()` (`leadgen/validation.ts:570–590`) is dead code; invalid schemas degrade to an EMPTY payload and the Offer still participates; untested Offers are not blocked (§11.8 / §35.1 MUST).
5. **R5** — Quote publish/activation never reads `mapping_state`/`validation_status`; Sections with error rows can be activated live (§35.1 MUST).

Plus: version stamping empty (R6), impressions computed then discarded (R7), click-time macros empty (R8), anti-tamper tuple deviations (R9); Offer/Section admin surfaces are engineer-grade — raw JSON, free-text keys, hand-typed ids — where the contract promised non-developer UX (B1–B12, E1–E9); Offers lack duplicate/delete/usage completeness (A1–A3); region rules are cryptic (D1–D3); simulate lacks payload explainability (S1); the test suites assert the wrong boundary and traceability over-claims (T1–T2).

**Issue counts: 5 × P0 · 13 × P1 · 18 × P2 · 5 × P3** (41 findings + C1 umbrella row = 42 matrix rows).

## End-to-end target (the definition of "operational")

Create Offer → build provider payload **without raw JSON** → test provider request → parse provider response into canonical carriers → create rich Section / Quote Slide **visually** → map Section answers to Offer payload fields → create Quote / Funnel / Variant → activate on a site → render live `/lg` funnel → collect answers → run auction → render banners → click through `/lg/lc` resolver → attribute revenue and analytics.

## Phase plan (details: `12-implementation-phases.md`)

| Phase | Name | Issues | Exit criterion |
|---|---|---|---|
| 1 | Runtime engine + P0 gates | R1 R2 R3 R4 R5 R6 R7 R8 R9 (+T1 live E2E suite bootstrap) | A live `/lg/:quote_slug` renders the first question, answers advance through slides, final Section triggers `/lg/auction`, banners render, `carrier_impression`/`offer_impression` fire, clicks resolve through `/lg/lc` with macros — proven by the Group-1 Playwright suite |
| 2 | Payload Builder UX + data correctness | B1–B12, C1, M1, M2 | A non-technical operator authors a nested provider schema (value maps, Other groups, dates, booleans, arrays, conditions, defaults) and runs Test **with zero raw JSON typed** — proven by Group-2/5 suites |
| 3 | Offer management + rules polish | A1 A2 A3 D1 D2 D3 S1 | Duplicate/Delete/Usage ship guarded; region rules readable; simulate shows redacted per-offer payload |
| 4 | Section Studio rebuild | E1–E9 | The 4 §8.11 slide patterns are authored in the Studio without custom CSS; mapping completed via pickers only; desktop/mobile preview reversible |
| 5 | Parity, analytics proof, QA honesty | T1 T2 (+ analytics producer proof) | Preview↔runtime parity tests green; every §22 event has a producer; false-PASS tests replaced; traceability re-audited; operator manual QA signed |

Phases 2–4 are independently shippable after Phase 1. No phase requires a destructive migration; the only DDL in this contract is additive (see `03` §3.8 and `05`).

## Resolved design decisions (open-questions policy: none newly invented)

| # | Decision |
|---|---|
| Q1 | **Server-rendered Sections + small hydration engine.** The existing preset renderer (`components/presets.ts` → `renderSectionComponents`) becomes authoritative for the live funnel; a ≤40KB hydration bundle adds behavior. One renderer ⇒ preview↔runtime parity by construction (§14.3/§28-aligned). Client-only render from `/lg/config` JSON is rejected: larger, diverges from §14.3, duplicates the renderer. |
| Q2 | **Hard delete only at zero references** across the full usage inventory (children, placements, schemas, section availability, answer maps, auctions, rules, caps, provider logs, click/revenue attribution, analytics mirrors, postbacks). Anything referenced ⇒ 409 + usage report + offer Archive. Contract erratum to v2.3.7 §9.6 (which said status-flips only). |
| Q3 | **Duplicate blanks placement IDs** (new default placement ID is required input in the modal — never two Offers serving the same provider feed id verbatim); **only the ACTIVE payload schema is copied, as new v1**; endpoints/headers/token refs copy only when the operator checks the box; caps copied disabled unless explicitly checked; Test status resets to untested; no counters/logs/analytics/revenue copied. |
| Q4 | **Layout containers are IN scope for Phase 4** (Stack, Grid, Columns, CardPanel, HeaderBar, FooterBar, BackgroundPanel, TrustBar) — tokenized only, no arbitrary CSS (`08` §8.5). |
| Q5 | **Google Maps v1 = browser-key Places Autocomplete + field-level config only.** The dead server geocode leg (`leadgen/maps.ts` `validateAddress`/`geocode`, `GOOGLE_MAPS_SERVER_KEY`) stays out of scope; manual entry must keep working when the key is missing. |

## Preserve (unchanged by this contract)

`leadgen_` namespace · Athena `leadgen` domain · ClickHouse `lg_*` tables · `/admin/leadgen` + `/api/admin/leadgen` · `/lg` runtime routes · Quote → Funnel → Funnel Variant model (`funnel_id lgf_` ≠ `funnel_variant_id lgn_`, brand-typed) · the 9 D1 analytics mirrors ↔ 9 ClickHouse daily targets · default visual design = measured reference funnel · screenshots = component capability examples only · admin UI conventions = existing CMS/Listicles admin shell · no banned reference-product tokens in active source · additive-only, forward-only migrations · agent performs **no deploys, no secret writes**.

## Do NOT (scope boundaries — binding)

**Do not change:** Quote→Funnel→Variant architecture; auction architecture (no hard runtime blocker requires it); the 9 analytics mirrors; the approved D1 taxonomy except the additive columns this contract names; the default design source; Listicles behavior; CMS behavior outside LeadGen; GA4 behavior; cache keys outside LeadGen; no-touch/banned-token guardrails.
**Do not add:** arbitrary CSS authoring; a new framework (the repo is framework-less Hono + server-rendered admin; the hydration bundle is vanilla TS); new analytics mirrors; unrelated RBAC/security architecture; unrelated provider integrations; unrelated visual design systems.
**Do not allow:** JSON typing in normal UI (schemas, conditions, value_maps — Advanced-drawer only); free-text Activity/Vertical where dropdowns are required; live Quotes with invalid required Offer mappings; dynamic Offers with invalid/untested schemas entering auction; `/lg/:slug` rendering an empty mount; "PASS" based on shell/bootstrap tests.

## Package manifest

`00` this summary · `01` current state & root causes · `02` issue coverage matrix (42 rows) · `03` runtime engine · `04` runtime context / macros / computed · `05` gating & validation · `06` payload builder UX · `07` offer management · `08` Section Studio · `09` preview↔runtime parity · `10` analytics & attribution · `11` testing & manual QA · `12` implementation phases · `13` traceability matrix · `14` final acceptance checklist. Compiled document: **“LeadGen CMS — Operational Fix Contract v2.4 Full.html”**. On adoption, copy this package into the repo at `docs/leadgen/fix-contract-v2.4/` and track progress in `13` + the updated `docs/leadgen/traceability.md`.
