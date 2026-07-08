# 03 · Runtime Engine Contract (Phase 1 · R1, R7, plus runtime legs of B9/E4/E6)

**Problem:** `/lg/:slug` serves an empty shell (`serve.ts:308–346`); nothing consumes `lg:bootstrap`; the answers → auction → banner → click → revenue chain has no production caller (R1). This section defines the runtime leg exactly. Context/macros are in `04`; gates in `05`; parity duties in `09`; events/IDs in `10`.

## 3.1 Architecture decision (Q1 — resolved)

**Server-rendered Sections + hydration.** The Worker renders every Section of the resolved variant into the shell using the EXISTING preset renderer (`components/presets.ts` → `renderSectionComponents` — the same code path that powers admin preview, quote preview, and the persisted `content_html`). A single vanilla-TS hydration bundle (≤40KB minified, no framework) adds behavior. Rationale: one renderer ⇒ preview↔runtime parity by construction (§14.3 “presets are server-render functions … minimal hydration hooks”); §28 contracted KV keys `lg-section:{public_id}:{content_version}:{template_version}` exist for exactly this; smallest new-code surface on the money path. A client-side renderer from `/lg/config` JSON is **rejected**.

## 3.2 Files to create / modify

| File | Status | Responsibility |
|---|---|---|
| `api/src/public/leadgen/serve.ts` | modify | `renderFunnelShell` embeds: (a) all Sections server-rendered in order, each in `<section data-lg-section data-lg-section-id="{public_id}" data-lg-index="{i}" data-screen-label="{i+1:02d} · {headline}" hidden>` (first section not hidden); (b) `<script type="application/json" id="lg-config">` = the SAME `LeadgenPublicConfig` JSON `/lg/config` serves (already resolved in-request; variant-scoped so the §28 shell cache key stays valid); (c) `<script src="/lg/runtime/{LEADGEN_TEMPLATE_VERSION}.js" defer>`; (d) Google Maps browser key `<script>` only when configured AND an address/ZIP component with Maps enabled exists. Replace `LEADGEN_BOOTSTRAP_JS` with a minimal inline stub that only queues pre-hydration clicks. Keep `data-lg-mount`, `data-lg-ready` semantics (`data-lg-ready="1"` now set by the ENGINE after hydration). |
| `api/src/public/leadgen/runtime/engine.ts` | new | Orchestrator: read inline config, fetch `/lg/attempt` (no-store), build client context, bind section navigation, own the lifecycle (§3.5), expose `window.__LG_ENGINE__` (version, state getters) for tests. |
| `api/src/public/leadgen/runtime/render.ts` | new | DOM behavior over server HTML: show/hide sections, selection classes, progress update, error/success states, dependency-driven reveal, banner `banners_html` injection into `[data-lg-banners]`, Other-group expansion (B9), container-aware focus. NEVER re-renders components from JSON. |
| `api/src/public/leadgen/runtime/state.ts` | new | Answer store + serialization (§3.4); back-stack; section pointer; persistence to `sessionStorage["lg:{funnel_attempt_id}"]` (restore on reload, cleared on quote_complete). |
| `api/src/public/leadgen/runtime/events.ts` | new | Beacon client for `POST /lg/track`: batches ≤20 (`MAX_LEADGEN_EVENTS_PER_REQUEST`), client-minted `event_id` (ULID-shape), `navigator.sendBeacon` with `fetch(keepalive)` fallback, retry queue with backoff < the 10-min KV seen-TTL, stamps the common envelope (§3.7). |
| `api/src/public/leadgen/runtime/validation.ts` | new | Client mirror of `client_validation` rules from the config DTO (required, valid_values, min/max/step, minLength/maxLength, pattern, email/phone/ZIP formats). Blocks Continue; fires `validation_error`. |
| `api/src/public/leadgen/runtime/dependencies.ts` | new | Evaluates component `conditional` rules over the answer store. MUST implement the same op set as `leadgen/dependencies.ts` (`eq/neq/gt/lt/gte/lte/range/in/not_in`); parity enforced by a generated table test (`09` §9.3). |
| `api/src/public/leadgen/runtime/maps.ts` | new | Places Autocomplete wiring per field-level config (`08` §8.8); no-op with console-free graceful fallback when key missing; emits `address_autofill` / `address_validation_success` / `address_validation_error`. |
| `api/src/public/leadgen/runtime/auction-client.ts` | new | Final-section submit: POST `/lg/auction` (§3.6), render banners, impressions via IntersectionObserver, click-through delegation (links are already governed `/lg/lc` hrefs — no client URL construction). |
| `api/src/public/leadgen/components/presets.ts` | modify | Hydration hooks: every interactive element gets `data-lg-*` attributes (§3.3). No visual change under the default design. |
| `api/src/public/leadgen/config-dto.ts` | modify | Populate `answer_mapping_version` per section (from `leadgen_section_answer_maps` max version — R6); add `sections[].continue_mode` already present; add `choiceDisplay` passthrough (B9). DENY-list unchanged. |
| `api/scripts/build-leadgen-runtime.ts` | new | esbuild the `runtime/*` entry (`engine.ts`) → IIFE, target es2019, minified → emits `api/src/public/leadgen/runtime/engine-bundle.generated.ts` (`export const LEADGEN_RUNTIME_JS`, `LEADGEN_RUNTIME_JS_BYTES`). Committed; CI gate `verify:leadgen-runtime` rebuilds + diffs (stale = fail) + asserts bytes ≤ 40960. |
| `api/src/public/leadgen/runtime-routes.ts` | modify | Add `GET /lg/runtime/:version.js` serving the generated bundle: `content-type: text/javascript`, `cache-control: public, max-age=31536000, immutable` when `:version === LEADGEN_TEMPLATE_VERSION`, else 404. Mount stays before the `/:slug` catch-all. |

## 3.3 Hydration hook attributes (presets emit; engine consumes)

`data-lg-question="{question_id}"` · `data-lg-field="{internal_field}"` · `data-lg-choice="{value}"` (each selectable choice) · `data-lg-input` (text/number/date/email/phone/zip inputs) · `data-lg-continue` · `data-lg-back` · `data-lg-progress` (+`data-mode`) · `data-lg-error-for="{internal_field}"` · `data-lg-other-trigger` / `data-lg-other-panel` (B9) · `data-lg-banners` (auction mount) · `data-lg-maps="{configJSON}"` (E6). These attributes are part of THIS contract: preview and runtime must emit identical hooks (`09` §9.3 asserts it).

## 3.4 Runtime state shape (normative)

```ts
type LgAnswerSource = "default_applied" | "user_selected" | "user_confirmed_default"; // matches leadgen-events.ts:445–447
interface LgAnswerEntry { value: unknown; answer_source: LgAnswerSource; question_id: string; section_public_id: string; answered_at: number; }
interface LgRuntimeState {
  session_id: string;            // ko_sid cookie (existing session convention)
  page_view_id: string;          // minted per page load
  funnel_attempt_id: string;     // from /lg/attempt
  signed_config_token: string;   // from /lg/attempt — held in memory, sent ONLY to /lg/auction
  section_index: number;
  back_stack: number[];
  answers: Record<string /*internal_field*/, LgAnswerEntry>;
  auction: { status: "idle"|"pending"|"filled"|"unfilled"|"error"; auction_result_id?: string; banner_render_id?: string; };
}
```

Default answers: on section entry, any `default_answer` from the config is applied once as `default_applied`. A user clicking the SAME value converts it to `user_confirmed_default`; a different value → `user_selected`. `answer_default_applied` fires when a default is applied; `answer_change` on subsequent edits; `answer_click` on choice selection.

## 3.5 Engine lifecycle (normative sequence)

1. **Init:** parse `#lg-config`; fetch `GET /lg/attempt` (no-store) → `{funnel_attempt_id, signed_config_token}`; restore sessionStorage state if same attempt-binding tuple; mark `data-lg-ready="1"`; fire `quote_view` (+ engine emits `section_view` for the visible section). GA4 untouched (existing injection).
2. **Section render:** exactly one `[data-lg-section]` visible; progress = `mode(step|percent)` over VISIBLE (dependency-satisfied) sections; Back shown when `back_stack` non-empty; `section_view` on every entry (incl. back, with `nav="back"` prop).
3. **Answer:** choice click → state write + selection class + `answer_click`; inputs → debounced `answer_change`; dependency re-evaluation may reveal/hide components (hidden components’ answers are EXCLUDED from serialization but retained in memory for back-nav).
4. **Validate:** Continue mode: `continue_click` → validation of required visible components; failure → inline errors + `validation_error` per failing field, no advance. Auto-advance mode: single-question sections advance on `answer_click` after validation; multi-question sections require Continue regardless of mode flag.
5. **Advance:** push to back_stack; `section_continue` (with `section_id`, `answer_mapping_version`); next section per order; skipped (dependency-hidden) sections are bypassed and excluded from progress.
6. **Final section:** advancing past the last visible section triggers the auction call (§3.6) — never before; `quote_complete` fires when the auction response is received (filled or unfilled).
7. **Banners:** inject `banners_html` into `[data-lg-banners]`; impressions per §3.6; clicks navigate the governed `/lg/lc` href (no JS rewriting).
8. **Errors:** `/lg/attempt` or `/lg/auction` network failure → retry ×2 with backoff, then a non-technical inline notice inside the funnel card; never a blank page; beacons continue.

## 3.6 `/lg/auction` request/response (additions are additive)

Request (client → server): `{ funnel_attempt_id, signed_config_token, funnel_variant_id, content_version, section_order_hash, answers: Record<internal_field, {value, answer_source}>, answer_mapping_versions: Record<section_public_id, string>, session_id, page_view_id }`. Server re-validates the binding (existing `verifyConfigToken` path, `requireSigned` in production) → 422 + `tampered` on mismatch (unchanged; extended tuple per `05` §5.3).

Response additions (serve-auction.ts): `{ banners_html, auction_result_id, banner_render_id, impressions: Array<{ event_type: "carrier_impression"|"offer_impression", offer_id, placement_id, carrier_key?, slot_index, auction_result_id, banner_render_id }>, unfilled?: true }`. Server-side the engine ALSO emits the auction telemetry itself (auction_start, per-offer request/response/timeout/error, carrier_eligible/filtered, filled/unfilled) with version stamps — clients never own auction truth (`10` §10.2).

**Impression discipline (R7):** engine attaches one IntersectionObserver per impression target (≥50% visible for ≥1s); on trigger, beacon the corresponding impression event EXACTLY ONCE per `(page_view_id, banner_render_id, slot_index)` — enforced client-side by a fired-set and server-side by the existing `event_id` KV seen-set + ClickHouse ReplacingMergeTree. Re-render (back/forward) re-uses the same `banner_render_id` and therefore cannot double-count.

## 3.7 Event envelope (every runtime beacon)

Every event carries: `event_id`, `event_type`, `session_id`, `page_view_id`, `funnel_attempt_id`, `quote_id`, `funnel_id`, `funnel_variant_id`, `funnel_ab_test_id`, `funnel_ab_test_revision`, `variant_label`, `url`, `referer`, `ts` — plus when relevant: `section_id`, `question_id`, `internal_field`, `answer_source`, `answer_mapping_version`, `section_mapping_version`, `payload_schema_version`, `auction_config_version`, `auction_instance_id`, `auction_request_id`, `provider_request_id`, `auction_result_id`, `banner_render_id`, `click_id`. Server enrichment continues to OVERRIDE ip/ua/device/os/browser/geo/quality flags (`leadgen-track.ts` unchanged). Full producer table: `10` §10.2.

## 3.8 `/lg/config` and `/lg/attempt` (preserved model — restated as binding)

`GET /lg/config/:funnel_variant_id` — cacheable, public static config ONLY. **Returns:** quote_id, funnel_id, funnel_variant_id, funnel_name, content_version, funnel_design_id, resolved design tokens, `section_order_hash`, ordered public Sections (headline/subheadline, continue_mode, address_validation_enabled, section_mapping_version, **answer_mapping_version — now populated (R6)**, components with public props/choices/`choiceDisplay`/client_validation/client-safe conditionals/question_key/internal_field/default-answer metadata), A/B metadata (funnel_ab_test_id, revision, variant_label, traffic_allocation_bp, assignment_reason), `ga4_measurement_id`, public copy. **Must NOT return** (existing DENY list, test-asserted in `leadgen-config-dto.test.ts` — extend the test for new fields): signed_config_token, funnel_attempt_id, provider endpoints, token refs, bid strategy/floor/winner logic, raw payload schemas, `carrier_parse_json`, auction rules, region rules, secrets.

`GET /lg/attempt` — `no-store`. Returns `{funnel_attempt_id ("att_"+ULID), signed_config_token, expires_at?}` (session_id stays cookie-derived client-side). Binds (post-R9 tuple, `05` §5.3): session_id, funnel_variant_id, section_order_hash, content_version, funnel_attempt_id, answer_mapping_version (aggregate hash), auction_config_version.

## 3.9 Out of scope for the engine

No client-side renderer from config JSON; no framework; no arbitrary-CSS injection; no GA4 changes; no localStorage (sessionStorage only, keyed by attempt); no non-`/lg` network calls; no reading or writing Listicles state.

## 3.10 Tests (exact — definitions in `11` §11.2)

Vitest: state transitions (default_applied→user_confirmed_default/user_selected); serialization excludes dependency-hidden answers; validation matrix per component type; dependency-evaluator parity table vs `leadgen/dependencies.ts`; beacon batching/caps/envelope; bundle-size gate. Playwright (Group 1): `/lg/:quote_slug` renders first question; answer click advances (auto-advance) and Continue mode works; Back restores state; dependency reveal/hide; required-block; final section POSTs `/lg/auction` with binding + answers + versions; banners render; both impression types beacon once; `/lg/lc` 302 resolves macros; CLS budget met WITH content; **anti-false-PASS:** fail if `[data-lg-mount]` is empty after `data-lg-ready`, if zero `[data-lg-question]` exist, if no `answer_click` beacon is observed, or if `/lg/auction` is never called after the final Section.

## 3.11 Acceptance (R1/R7 close only when ALL hold)

A live `/lg/:quote_slug` page renders the first question server-side (visible without JS), hydration enables answering; slides advance (both modes); Back/progress work; dependencies apply; defaults distinguish the three answer_sources; the final Section calls `/lg/auction`; returned banners render; `carrier_impression` + `offer_impression` fire once per slot; clicks resolve through `/lg/lc`; `/lg/config` remains cacheable-public-only; `/lg/attempt` remains no-store; bundle ≤40KB; Group-1 suite green in CI.
