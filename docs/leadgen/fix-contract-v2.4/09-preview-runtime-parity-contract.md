# 09 · Preview ↔ Runtime Parity Contract (Phases 1+4+5 · E5, T1-adjacent)

**Principle:** the admin preview and the live `/lg` runtime MUST use the same rendering code path. Q1’s server-render decision makes this structural — this section makes it contractual and test-enforced so it can never silently regress again.

## 9.1 Shared renderer requirement

- One renderer: `components/presets.ts` `renderSectionComponents` (+ container renders from `08` §8.5) produces Section HTML for (a) live `/lg` shell embedding, (b) `POST /api/admin/leadgen/sections/preview`, (c) quote preview, (d) persisted `content_html`. Any new component/container renders in ALL FOUR by construction — divergent “preview-only” markup is a contract violation.
- One hydration: the preview iframe loads the SAME generated runtime bundle (`/lg/runtime/{version}.js`) with `data-lg-preview="1"`, which (i) suppresses real beacons and routes would-fire events to `postMessage` (the Studio’s “events that would fire” panel), (ii) disables the auction call (stubbed response fixture optional), (iii) keeps validation/dependencies/state identical.

## 9.2 Preview endpoint parameterization (E5)

`POST /api/admin/leadgen/sections/preview` body gains: `{ design_id?: string /* default: variant’s funnel_design_id, NOT hardcoded default (fixes sections-handlers.ts:962) */, viewport?: "desktop"|"mobile", sim?: { state: "default"|"selected"|"error"|"dependency"|"validation_success"|"validation_error", answers?: Record<string,unknown>, auto_advance?: boolean, flow?: Array<{internal_field, value}> } }`. All sims are SERVER-rendered into the srcdoc (selected classes, error markup, dependency-satisfied reveals) — the outer-iframe attribute hacks (`ui-question-builder.ts:783–802`) are deleted. §14.9 score target: 9/9 functional sims (default, selected, error, dependency, validation success/error, continue, auto-advance, analytics-preview via the events panel).

## 9.3 Parity test matrix (Vitest + Playwright — Phase 5 locks it)

For a fixture matrix (every catalog component + every container × default design × desktop/mobile), compare preview output vs live `/lg` output for the SAME Section: component types present; DOM structure + CSS classes equal (normalized); design tokens applied (computed-style spot checks: button bg, radius, font); hydration hook attributes (`03` §3.3) identical; dependency show/hide behavior equal for the same answer set; validation error markup equal; selected-state markup equal; mobile layout equal at 375px. Plus the dependency-operator parity table: generated cases for `eq/neq/gt/lt/gte/lte/range/in/not_in` run through BOTH `leadgen/dependencies.ts` (server) and `runtime/dependencies.ts` (client) — outputs must match cell-for-cell.

## 9.4 Viewport toggle regression

The reported “mobile preview becomes tiny and cannot switch back” did not reproduce statically — close it with a live Playwright round-trip: desktop screenshot → mobile (375px real width, no transform:scale) → desktop again; assert pixel-dimensions + screenshot match of first and last states. If the live repro DOES surface a defect, fix within Phase 4 preview work.

## 9.5 Acceptance

Preview and runtime demonstrably share renderer + hydration (imports asserted by a static test — preview module may not define its own component markup); all §14.9 sims render server-side and visibly differ; preview honors `design_id`; parity matrix green desktop+mobile; dependency parity table green; viewport round-trip green.
