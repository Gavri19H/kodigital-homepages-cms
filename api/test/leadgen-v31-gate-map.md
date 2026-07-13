# LeadGen v3.1 §13 Fidelity Harness — Gate → Traceability Map

Phase E (E1 golden parser + Gates 1a/1b/3; E2 Gates 2/4 + Gate 1c). This
document maps every one of contract Appendix C's 25 traceability rows to the
test(s) that prove it, per the instruction: "for each of Appendix C's 25
rows, name the gate test(s) that prove it (so the conductor marks it
PASS-with-evidence)." **This file names tests; it does not itself mark any
row PASS — that stays the conductor's hand-verified act**, per mission-loop
separation (implementers never self-certify).

Legend:
- **PROVEN** = a real, executed assertion lives in one of this phase's 6 new
  files, verified green during this phase (counts below).
- **REFERENCED** = an EXISTING test (pre-dating this phase, A–D) already
  proves this claim; verified present by direct read during this phase's
  grounding (file + test title cited). Not re-implemented, per the
  CONSOLIDATE-don't-duplicate instruction.
- **FINDING** = a real, confirmed product↔golden (or product↔contract)
  divergence this phase's gates surfaced. Not fixed here (out of a
  test-harness phase's scope, per the dispatch's explicit instruction) —
  flagged for the conductor.
- **GAP** = no executable gate (new or existing) proves this today.

## New files (this phase)

| File | Kind | Tests | Status |
|---|---|---|---|
| `api/test/util/golden-master-v31.ts` | util | — (parser, no assertions) | typechecks, consumed by all 5 below |
| `api/test/leadgen-v31-gate1-parity.test.ts` | vitest | 23 | green |
| `api/test/leadgen-v31-gate1-tokens.test.ts` | vitest | 11 | green |
| `api/test/leadgen-v31-gate3-geometry.test.ts` | vitest | 12 | green |
| `api/test/leadgen-v31-gate2-strings.test.ts` | vitest | 32 | green |
| `api/test/leadgen-v31-gate4-behavior.test.ts` | vitest | 26 | green |
| `api/test-ui/leadgen-v31-gate1c-baselines.spec.ts` | Playwright | 7 | green (stable across 6 consecutive local runs post-fix; see the Gate 1c methodology note below — an earlier capture-mechanism bug was caught and fixed mid-phase) |

vitest total added: **104 tests** (5 files). Combined with baseline (350
files / 4791 tests) → **355 files / 4895 tests, all green by count**
(`npm test`, cwd `api/`).

## Appendix C — 25 rows

| # | Design element | § | Gate(s) | Proof |
|---|---|---|---|---|
| 1 | Four-region shell & geometry | 2 | 1,3 | **PROVEN**: gate3-geometry ("region heights render...", "unit column width 600 renders...", "tile grid geometry renders...") + gate1-parity (top bar / question strip / canvas toolbar / bottom drawer parity blocks) + REFERENCED `leadgen-studio-tokens.test.ts` (module-level Appendix B). **FINDING**: rail widths — see Findings §1. |
| 2 | Token set (color/type/space) | 3 | 1,3 | **PROVEN**: gate1-tokens (studio + themes hex audits) + gate3-geometry (radii/type at render time) + REFERENCED `leadgen-studio-tokens.test.ts` (module↔golden). **FINDING**: Bootstrap-hardcoded hex in several UI states — see Findings §2. |
| 3 | Canonical headline (strip ↔ canvas) | 4 | 2,4 | **PROVEN**: gate2-strings ("question strip row 2 strings render") + gate4-behavior (probe 6, structural no-second-tile proof + one-store proof) + REFERENCED `leadgen-section-builder.spec.ts` test ① (full live strip↔canvas↔dblclick round-trip). |
| 4 | Icon-tile library, merged Answer fields | 5 | 1,2,4 | **PROVEN**: gate1-parity (byte-identical tile SVGs via `goldenTileSvgs`, group order/open-state, 12-tile Answer-fields count) + gate2-strings (tile labels, library chrome) + gate4-behavior (probe 7, one merged group / no legacy `choices`+`inputs` split) + REFERENCED `leadgen-section-studio-ui.test.ts` describe 3 (SSR-string-level SVG byte-parity, a complementary proof at a different layer). **FINDING**: "how visitors answer" subcopy + Content-group callout both absent — see Findings §3/§4. |
| 5 | Primitive collapse (Text/Image) | 5.3 | 4 | **PROVEN**: gate4-behavior probe 8 (TextBlock/ImageBlock defaultType + `role`/`source` prop proof; retired-one-off-type absence proof — the genuinely-new deeper layer) + REFERENCED `leadgen-studio-patterns.spec.ts` (ReassuranceBadge-copy-collapses-into-Text, narrower). |
| 6 | No disabled / no headline tiles | 5.4 | 4 | **PROVEN**: gate4-behavior probe 7 (structural: no `StudioTile.disabled` field exists at all; no `data-tile...disabled`/`aria-disabled="true"` in SSR; no headline/subheadline dataName or defaultType in the palette). |
| 7 | Direct-manipulation selection + handles | 6 | 1,4 | **PROVEN**: gate1-parity ("buildHandle is invoked exactly 8 times with the golden's exact (row,side,interactive) tuples", handle box geometry) + gate3-geometry (STUDIO_GEOMETRY.selection render-time proof) + REFERENCED `leadgen-section-studio.spec.ts` "§6.2 default selection..." test (live 8-handle chrome in a real browser). |
| 8 | Frame hint | 6.3 | 1 | **PROVEN**: gate1-parity ("Frame hint toggle label renders and the skeleton ships VISIBLE by default") + gate2-strings (frame-hint copy). Mechanism note (not a divergence): default-ON is SSR-always-visible + client `hidden`-on-toggle-off, not a client-state-default like the golden's demo — documented in-file. |
| 9 | Presets vs manual custom + Reset (C1) | 7 | 1,4 | **PROVEN**: gate4-behavior probe 2 (resolveFieldSize custom_px resolution + clamp[200,600]) + probe 3 (Reset's exact contract claim: custom_px removal re-inherits the theme preset — the genuinely-new piece, no existing test covers this) + REFERENCED `leadgen-section-studio.spec.ts` "§7.1.3 dragging a width handle..." (live measured px). **GAP/FINDING**: no browser test clicks the real Reset button — see Findings §8. "presets deselect" also unassessed in any browser test — see Findings §9. |
| 10 | Scope header, pills, affects lines | 8.1 | 2 | **PROVEN**: gate1-parity (scope pills) + gate2-strings (scope header eyebrow "Editing" + 3 pills). |
| 11 | Dynamic tab matrix | 8.2 | 4 | **PROVEN**: gate4-behavior probe 1 (SSR tab-strip structural proof, 5 tabs in order) + REFERENCED `leadgen-section-studio.spec.ts` "§8.2 tab visibility is DYNAMIC per selection..." (FULL live matrix: field=all 5, choice=no Maps, headline/continue=2 only). |
| 12 | Field Content controls | 8.3 | 2,4 | **PROVEN**: gate2-strings (Basics/Behavior/Answer-format labels, verbatim incl. curly-apostrophe entity) + REFERENCED `leadgen-section-studio-ui.test.ts` (live populate/collect vm-probes for the same controls). |
| 13 | Inheritance tags (continue/style) | 8.4-8.5 | 2 | **PROVEN**: gate2-strings ("Continue's inherited tags render verbatim... Color=Brand primary, Position=Bottom, full width, both tagged 'inherited'"). |
| 14 | Role-based color, no hex | 8.5 | 2,4 | **PROVEN**: gate1-tokens (no off-palette/raw hex on the Style tab's role surfaces, only the documented Bootstrap findings elsewhere) + gate2-strings (Corners/Border-color role-name enums, no hex text) + REFERENCED `leadgen-section-builder.spec.ts` test ⑤ (color control stores the ROLE via API read-back) + `leadgen-section-studio.spec.ts` "§8.5b Style-tab Corners + Border color actually render..." (live). |
| 15 | Offers per-Offer mapping | 8.7 | 4 | **REFERENCED ONLY** (not proven in this phase's new files — the Offers-tab content is 100% client-populated from a live `GET /sections/:id/offers` fetch; SSR ships an empty `data-studio-inspector-mapping` div, confirmed by direct read): `leadgen-section-studio-ui.test.ts` describes "§8.7 GET offers answer_fields" + "§8.7 mapping model E2" (extensive, live-D1, vm-probe-verified). |
| 16 | Advanced (ids/JSON only here) | 8.8 | 2 | **PROVEN**: gate2-strings (Advanced-disclosure labels: "Internal field", "Analytics label", "Component id") + REFERENCED `leadgen-glossary-lint.test.ts` (the Advanced-allowlist exemption logic for ids/JSON on the Studio side). |
| 17 | Google Maps jobs + warning (C3) | 9 | 2,4 | **PROVEN**: gate2-strings (Maps-tab strings, verbatim incl. entity-encoded apostrophes) + gate4-behavior probe 4 (`validateSectionContent` emits `maps_no_job` warning iff enabled+zero-jobs — the direct data-layer proof of the exact contract claim) + REFERENCED `leadgen-section-studio.spec.ts` test ⑦ (live banner) + `leadgen-activation-preflight-v25.test.ts` (activation-preflight mechanism, general). **FINDING**: no test asserts activation blocks SPECIFICALLY for `maps_no_job` (the general preflight-blocks mechanism is proven for a different cause) — see Findings §10. |
| 18 | Themes manager + roles + size language (C2) | 10 | 1,2,4 | **PROVEN**: gate1-parity (top bar, swatch colors byte-matched to the golden's `pal()`, LIVE·A badge) + gate1-tokens (`.tm-shell`-scoped hex audit) + gate2-strings (CENTER editor + role-sublabels + A/B panel strings, + Themes-page forbidden-vocabulary extension — the confirmed gap this phase fills) + gate3-geometry (300/320 rail widths, swatch radius) + REFERENCED `leadgen-theme-manager-ui.test.ts` (extensive, pre-existing). |
| 19 | A/B theme per variant | 10.1, 10.5 | 4 | **PROVEN** (indirectly, via live funnel/variant wiring in gate1-parity's "LIVE · A" badge test) + **REFERENCED** `leadgen-theme-manager-ui.test.ts` describes "scanVariantThemeUsage over real D1" + "pure usage classification" (the authoritative, exhaustive proof). |
| 20 | Preview-theme switcher | 10.6 | 1,4 | **PROVEN**: gate1-parity (drawer "Preview theme:" string present) + REFERENCED `leadgen-section-studio.spec.ts` "§10.6 drawer 'Preview theme' switcher..." (live: populates from real KV, POSTs `theme_id`). |
| 21 | Runtime = preview parity | 12 | 4 | **REFERENCED ONLY / OUT OF THIS PHASE'S UI SCOPE**: this row is a runtime-composition claim (the shared `renderSectionComponents` path serving `/lg`, the Quote preview, and the Section-in-frame preview byte-identically) — orthogonal to the Section-Studio/Themes-manager admin UI this harness targets. Proven by `leadgen-visual.spec.ts` (real `/lg` runtime screenshots + computed-style table) and the `presets.ts`/`content-schema.ts` unit suites. No new gate test added; flagged rather than silently assumed. |
| 22 | Search synonyms (data-name) | 5.5 | 2,4 | **PROVEN**: gate1-parity (`GOLDEN_TILE_DATA_NAMES` cross-check — every one of the 20 unique synonym strings present, each tile's svg byte-matched) + REFERENCED `leadgen-section-studio-ui.test.ts` "§5.5 the EXACT 20 data-name synonym tiles..." (live search-filter behavior). |
| 23 | Insert semantics / Accept-swap | 5.6 | 4 | **PROVEN** (partial, via gate1-parity's/gate4's `tile.defaultType` checks) + **REFERENCED** `leadgen-section-studio.spec.ts` "§5.6 Accept-swap via the Content-tab dropdown SWAPS the node type..." (the authoritative live proof: 8-value enum in order, internal_field/required preserved across the swap). |
| 24 | Style tab per selection + enumerations | 8.5b | 2,4 | **PROVEN**: gate2-strings (Width/Height/Corners/Border-color enum strings, theme note) + REFERENCED `leadgen-section-studio.spec.ts` "§8.5 Style-tab Width preset buttons..." + "§8.5b Style-tab Corners + Border color..." (live writes). |
| 25 | Markup parity vs Artifact D | 13 Gate 1a | 1 | **PROVEN**: `leadgen-v31-gate1-parity.test.ts` in full (23 tests spanning top bar, question strip, library/tiles, canvas toolbar, selection chrome, bottom drawer, inspector scope header, themes manager) + `leadgen-v31-gate3-geometry.test.ts` (Appendix B render-time proof) + `leadgen-v31-gate1c-baselines.spec.ts` (the 7 frozen visual baselines, Gate 1c). |

**Coverage summary**: 23 of 25 rows have at least one **PROVEN** (this-phase)
assertion; all 25 have either PROVEN or REFERENCED coverage. Row 15 (Offers
mapping) and row 21 (runtime=preview parity) are REFERENCED-only — both are
live-D1/vm-probe or runtime-composition claims outside a pure-function-first
harness's natural reach, and both already have deep, existing coverage cited
above. No row is a bare GAP.

## Findings (confirmed product↔golden / product↔contract divergences — not fixed, per this phase's explicit scope)

1. **Rail widths (Gate 1/3, Appendix B).** Contract + `STUDIO_GEOMETRY`
   token module say 292px (library) / 344px (inspector), byte-identical to
   the golden. The actual rendered CSS grid —
   `.lg-editor-grid{grid-template-columns:280px 1fr 380px}`
   (`ui-section-studio.ts:2371`) — uses 280px/380px instead. Confirmed by
   direct grep: zero references to `STUDIO_GEOMETRY.leftLibraryWidth` /
   `.rightInspectorWidth` anywhere in the file's CSS. `leadgen-v31-gate3-geometry.test.ts` asserts both numbers side by side (test: "token module says rail widths 292/344 (Appendix B) — CONFIRMED DIVERGENCE...").

2. **Bootstrap-palette hardcoded hex (Gate 1b).** Several UI mechanisms use
   literal Bootstrap alert/badge colors that trace to neither `STUDIO_COLOR`
   nor the golden master: the mapping-overlay chips (mapped/required-missing
   states), a Maps-linked-field chip, the "Hidden in this question unit"
   bound-node chip, the orphaned-mapping status chip, the payload-preview
   `<pre>` dark theme, and the invalid-control red outline. Enumerated with
   file:line-cited hex values in `leadgen-v31-gate1-tokens.test.ts`'s
   `KNOWN_OFF_PALETTE_HEXES` list (12 hex values across 6 mechanisms); these
   pre-date v3.1 and are not modeled in the golden mockup at all.

3. **"how visitors answer" subcopy absent (Gate 2, §5.2/golden:145).** The
   contract requires this subcopy next to the "Answer fields" group label;
   `renderStudioLibrary`'s group-header template never emits ANY subcopy for
   any group (confirmed: zero grep hits for the phrase anywhere in
   `ui-section-studio.ts`). `leadgen-v31-gate2-strings.test.ts` asserts the
   confirmed absence directly.

4. **Content-group explanatory callout absent (Gate 2, §5.2/golden:220).**
   The dashed-border callout "Legal notes, reassurance lines & secure badges
   are just Text — pick a style in its settings. No separate blocks." never
   renders — `renderStudioLibrary` only renders the Layout-group's
   Quote-Builder frame callout, never one for the Content group. Confirmed
   by direct grep (zero hits for "Legal notes"/"No separate blocks").

5. **Frame callout wording is a rephrase, not byte-identical (Gate 2, cosmetic).**
   Golden: "Header, footer, progress & background belong to the whole
   funnel — set them once in the Quote Builder. Open →". Built
   (`renderFrameCallout`): "Looking for the page header, footer, progress
   bar or background? Those live in the Quote Builder → Open". Same
   meaning, different wording — low severity, flagged per Appendix A's
   completeness rule rather than silently matched.

6. **"Search components" placeholder carries a trailing ellipsis not in the
   golden/contract (Gate 2, very low severity).** Golden/Appendix A:
   `"Search components"` exact. Built: `placeholder="Search components…"`
   (the `aria-label` is exact, no ellipsis). Does not break any
   substring-based Gate 2 assertion (the contract string is a prefix of the
   rendered one) — noted for completeness, not asserted as a failure.

7. **(Structural, not a defect) "20 tiles" counts unique identities, not
   palette slots.** Appendix D's "All 20 tile SVGs" refers to 20 unique
   `data-name` values; the palette renders 22 tile SLOTS total (2 of the 4
   "Suggested" tiles reuse an Answer-fields tile's identical asset — an
   explicit, contract-intended shortcut, §5.2). Documented in
   `golden-master-v31.ts`'s own comments so this doesn't read as an
   ambiguity to a future maintainer.

8. **No browser test exercises the real Reset button (Gate 4, probe 3 /
   Appendix C row 9).** `data-reset-width` exists and is wired
   (`ui-section-studio.ts:1923` + its handler), but zero existing tests
   (vitest or Playwright) click it. The one Playwright test whose TITLE
   mentions Reset (`leadgen-section-studio.spec.ts` "§8.5 Style-tab Width
   preset buttons write design_overrides.size.width; Reset removes a
   custom_px...") never drags to create a `custom_px` nor clicks
   `[data-reset-width]` in its body — confirmed by direct read, a
   title/body mismatch pre-dating this phase. This phase's
   `leadgen-v31-gate4-behavior.test.ts` proves the RESOLUTION contract
   (custom→preset via `resolveFieldSize`) at the data layer; the UI-click
   wiring itself has no live-browser proof. Adding one is out of this
   phase's file-ownership scope (only `leadgen-v31-gate1c-baselines.spec.ts`
   is an owned Playwright file) — flagged for the conductor to authorize a
   follow-up.

9. **"Presets deselect" on drag is unasserted (Gate 4, probe 2).** The
   existing live-drag test proves the custom_px WRITE; no test asserts a
   preset button's `active` class is removed once a drag commits a custom
   width (grep of the test body, lines 619-695, confirms no such
   assertion).

10. **Activation-blocks-for-`maps_no_job`-specifically is unasserted (Gate 4,
    probe 4).** The general activation-preflight-blocks mechanism is proven
    live (`leadgen-section-studio.spec.ts` test ⑤), but for a DIFFERENT
    blocking cause (a missing required mapping), not `maps_no_job`
    specifically. `leadgen-activation-preflight-v25.test.ts` /
    `leadgen-v31-schema.test.ts` confirm the `maps_no_job` CODE exists and
    is wired into the same escalation pattern as `frame_scope_component`,
    but no test drives an actual blocked-activation assertion keyed to it.

## Playwright / Gate-4-spec scope note

The E2 deliverable prose says "where a probe is jsdom-able put it in vitest
(CI), where it needs a browser put it in the Gate-4 Playwright spec" — but
this phase's **exclusive file list contains no separate Gate-4 Playwright
spec** (only `leadgen-v31-gate1c-baselines.spec.ts`, scoped to the 7 visual
baselines). This map treats "the Gate-4 Playwright spec" as the AGGREGATE of
the existing per-phase specs (`leadgen-section-builder.spec.ts`,
`leadgen-section-studio.spec.ts`, `leadgen-studio-patterns.spec.ts`,
`leadgen-theme-manager.spec.ts`) — consolidated via the REFERENCED citations
above — rather than authoring a new file outside this phase's ownership.
Findings 8-10 above are the browser-level gaps that interpretation leaves
open; each is called out by name for a future slice/conductor decision
rather than silently left uncovered.

## Gate 1c methodology note (a real bug caught during this phase, not a product defect)

An early pass of `leadgen-v31-gate1c-baselines.spec.ts` used
`page.screenshot({fullPage:true})` and reported 4 consecutive stable
(changed-pixel ratio 0) runs — but a later run flagged an unexpected diff,
and visually inspecting the evidence PNG (not just the ratio number) showed
a garbled, wrongly-proportioned capture with real content compressed into a
small fraction of the frame. Root cause, confirmed via a live diagnostic:
this admin app's scrolling container is `<body>` itself (`html,body{
height:100%}` + a computed `body{overflow-y:auto}`), which
`document.documentElement.scrollHeight` never reflects — `fullPage:true`
sizes its capture off `documentElement`, so it cannot correctly capture this
page's true content height. The earlier "stable" runs had been comparing
two equally-broken captures to each other, not verifying correctness.
**Fix**: a tall (2600px) fixed viewport sized to comfortably fit the entire
editor with no scrolling needed anywhere, plus a PLAIN (non-fullPage)
screenshot. A second, narrower issue affected the two Themes states
specifically: the theme LEFT LIST shows every theme record in the system
(no per-fixture scoping), and this phase's own repeated debugging runs had
already accumulated dozens of records with no bound forcing internal
scroll — fixed by giving those two tests their own small, fixed 900px-tall
viewport, so accumulated growth falls outside the captured frame by
construction. All 7 states were re-verified stable (changed-pixel ratio 0)
across 6 consecutive runs after both fixes, with 3 states additionally
confirmed correct by direct visual inspection (properly-styled top bar/
library/canvas/inspector/drawer, the "≈ 384 px" custom-resize badge, the
Maps tab's toggle/scope-header/tabs). Recorded here because it is exactly
the class of "ratio=0 across N runs" evidence this whole harness exists to
demand — a passing pixel-diff count is not sufficient evidence on its own
if nobody ever looked at what the pixels show.

## CI wiring

All 5 new vitest files run under the existing `npm test` (vitest) — CI
enforced (`.github/workflows/deploy.yml` line 65 already runs `npm test`
with no changes needed). `leadgen-v31-gate1c-baselines.spec.ts` is
Playwright-only, run locally per the dispatch's explicit instruction ("Do
NOT add Playwright to CI"); its 7 baseline PNGs are committed under
`api/test-ui/__screenshots__/leadgen-v31-gate1c/` and become the frozen
reference for Gate 1c. The operator's visual sign-off (docs/leadgen/
redesign-contract-v3/traceability.md "OPERATOR-OWNED" section, "Frozen-
baseline design sign-off") remains a separate, later, Phase-F act — these
baselines are the ARTIFACT that sign-off reviews, not a replacement for it.
