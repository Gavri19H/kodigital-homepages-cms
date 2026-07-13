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
| `api/test/leadgen-v31-gate1-parity.test.ts` | vitest | 25 | green (E2 part 2: +2 — the "No issues" chip NEUTRAL assertion + the sibling top-bar/drawer Mapping-badge regression guard) |
| `api/test/leadgen-v31-gate1-tokens.test.ts` | vitest | 15 | green (E2 part 1: +1 for the F2 §3-danger resolution of `.studio-control-invalid`; E2 part 2: +3 — the fixture-surface "No issues"/"N issues" chip conversions + a calibration test) |
| `api/test/leadgen-v31-gate3-geometry.test.ts` | vitest | 13 | green (E2: the rail-width test now ENFORCES 292/344; E2 part 3: +1 the product select max-width regression guard) |
| `api/test/leadgen-v31-gate2-strings.test.ts` | vitest | 33 | green (E2: F3/F4/F5 flipped to ENFORCE the golden; +1 for the F6 exact-placeholder test) |
| `api/test/leadgen-v31-gate4-behavior.test.ts` | vitest | 26 | green |
| `api/test-ui/leadgen-v31-gate1c-baselines.spec.ts` | Playwright | 7 | green — RE-MINTED TWICE in E2 (part 1: rail/copy fixes; part 2: the fixture-surface chip recolor, which affects states 1-5 since they all share the top-bar chip); ratio=0 across re-mints + 2 stability runs each time, delta visually confirmed = ONLY the intended change (see the E2 re-mint notes below) |
| `api/test-ui/leadgen-v31-gate4-behavior.spec.ts` | Playwright | 3 | green (NEW, E2) — the browser probes for Findings 8/9/10 (real Reset, presets-deselect, maps_no_job activation block); visually confirmed |

vitest total (this harness): **112 tests** across the 5 gate files
(gate1-parity 25 · gate1-tokens 15 · gate3-geometry 13 · gate2-strings 33 ·
gate4-behavior 26 = 112; E1 104 → E2 part 1 106 → E2 part 2 111 → E2 part 3
112: +1 gate3 for the product select max-width regression guard). Full
suite: **355 files / 4903 tests, all green by count** (`npm test`, cwd
`api/` — E1 was 4895, E2 part 1 4897, E2 part 2 4902).

### CI-enforcement caveat (adversarial-review M2 — recorded, pre-existing)

The pure `describe` blocks of all 5 gate files (studio SSR parity / tokens /
geometry / strings / behavior — where every F1–F6 fixture-surface
reconciliation assertion lives) run under CI's `npm test`. The `describeDb`
blocks (themes-manager row-18 parity/geometry/strings, ~17 tests) use
`node:sqlite`, which requires Node ≥ 22.5; `.github/workflows/deploy.yml`
pins Node 20, so those `describe.skip` in CI (verified 0-skip locally on Node
25). This is a **pre-existing repo-wide pattern** (71 test files use the same
guard, incl. the pre-v3.1 `leadgen-theme-manager-ui.test.ts`), NOT introduced
by this phase, and it does not affect the reconciliation's critical path
(studio-SSR gates are CI-enforced). OPERATOR/FOLLOW-UP: bumping CI Node to ≥22
would enable the DB-backed gate rows in CI, but must first be verified against
the full suite on Node 22 (all 71 files' DB blocks would newly execute in CI).

## E2 (part 2 — reconciliation) summary

E1 SURFACED 10 product↔golden divergences (Findings 1–10 below); some gates
DOCUMENTED the wrong-but-current value. E2 FIXES the product to the golden and
FLIPS those gates to ENFORCE it (fail-before-fix / pass-after-fix), closing the
3 Gate-4 browser gaps. Product edits are confined to
`api/src/admin/leadgen/ui-section-studio.ts` (the specific divergent elements
only). Per-finding resolution is recorded inline below (**RESOLVED** = product
fixed + gate now enforces the golden; **RECORDED GAP** = a residual needing
out-of-slice work, kept honestly scoped, never asserted as "expected").

## Appendix C — 25 rows

| # | Design element | § | Gate(s) | Proof |
|---|---|---|---|---|
| 1 | Four-region shell & geometry | 2 | 1,3 | **PROVEN**: gate3-geometry ("region heights render...", "unit column width 600 renders...", "tile grid geometry renders...") + gate1-parity (top bar / question strip / canvas toolbar / bottom drawer parity blocks) + REFERENCED `leadgen-studio-tokens.test.ts` (module-level Appendix B). **RESOLVED (E2, F1)**: rail widths now render 292/344 and gate3 ENFORCES it — see Findings §1. |
| 2 | Token set (color/type/space) | 3 | 1,3 | **PROVEN**: gate1-tokens (studio + themes hex audits) + gate3-geometry (radii/type at render time) + REFERENCED `leadgen-studio-tokens.test.ts` (module↔golden). **PARTIALLY RESOLVED (E2, F2)**: `.studio-control-invalid` → §3 danger (gate1-tokens enforces); remaining status families are a RECORDED GAP needing out-of-slice `studio-tokens.ts` status tokens — see Findings §2. |
| 3 | Canonical headline (strip ↔ canvas) | 4 | 2,4 | **PROVEN**: gate2-strings ("question strip row 2 strings render") + gate4-behavior (probe 6, structural no-second-tile proof + one-store proof) + REFERENCED `leadgen-section-builder.spec.ts` test ① (full live strip↔canvas↔dblclick round-trip). |
| 4 | Icon-tile library, merged Answer fields | 5 | 1,2,4 | **PROVEN**: gate1-parity (byte-identical tile SVGs via `goldenTileSvgs`, group order/open-state, 12-tile Answer-fields count) + gate2-strings (tile labels, library chrome) + gate4-behavior (probe 7, one merged group / no legacy `choices`+`inputs` split) + REFERENCED `leadgen-section-studio-ui.test.ts` describe 3 (SSR-string-level SVG byte-parity, a complementary proof at a different layer). **RESOLVED (E2, F3/F4)**: "how visitors answer" subcopy + the Content-group callout now render and gate2 ENFORCES both — see Findings §3/§4. |
| 5 | Primitive collapse (Text/Image) | 5.3 | 4 | **PROVEN**: gate4-behavior probe 8 (TextBlock/ImageBlock defaultType + `role`/`source` prop proof; retired-one-off-type absence proof — the genuinely-new deeper layer) + REFERENCED `leadgen-studio-patterns.spec.ts` (ReassuranceBadge-copy-collapses-into-Text, narrower). |
| 6 | No disabled / no headline tiles | 5.4 | 4 | **PROVEN**: gate4-behavior probe 7 (structural: no `StudioTile.disabled` field exists at all; no `data-tile...disabled`/`aria-disabled="true"` in SSR; no headline/subheadline dataName or defaultType in the palette). |
| 7 | Direct-manipulation selection + handles | 6 | 1,4 | **PROVEN**: gate1-parity ("buildHandle is invoked exactly 8 times with the golden's exact (row,side,interactive) tuples", handle box geometry) + gate3-geometry (STUDIO_GEOMETRY.selection render-time proof) + REFERENCED `leadgen-section-studio.spec.ts` "§6.2 default selection..." test (live 8-handle chrome in a real browser). |
| 8 | Frame hint | 6.3 | 1 | **PROVEN**: gate1-parity ("Frame hint toggle label renders and the skeleton ships VISIBLE by default") + gate2-strings (frame-hint copy). Mechanism note (not a divergence): default-ON is SSR-always-visible + client `hidden`-on-toggle-off, not a client-state-default like the golden's demo — documented in-file. |
| 9 | Presets vs manual custom + Reset (C1) | 7 | 1,4 | **PROVEN**: gate4-behavior probe 2 (resolveFieldSize custom_px resolution + clamp[200,600]) + probe 3 (Reset's exact contract claim: custom_px removal re-inherits the theme preset — the genuinely-new piece, no existing test covers this) + REFERENCED `leadgen-section-studio.spec.ts` "§7.1.3 dragging a width handle..." (live measured px). **RESOLVED (E2)**: `leadgen-v31-gate4-behavior.spec.ts` now clicks the real Reset button (Finding 8) and asserts presets-deselect-on-drag (Finding 9) in a real browser — see Findings §8/§9. |
| 10 | Scope header, pills, affects lines | 8.1 | 2 | **PROVEN**: gate1-parity (scope pills) + gate2-strings (scope header eyebrow "Editing" + 3 pills). |
| 11 | Dynamic tab matrix | 8.2 | 4 | **PROVEN**: gate4-behavior probe 1 (SSR tab-strip structural proof, 5 tabs in order) + REFERENCED `leadgen-section-studio.spec.ts` "§8.2 tab visibility is DYNAMIC per selection..." (FULL live matrix: field=all 5, choice=no Maps, headline/continue=2 only). |
| 12 | Field Content controls | 8.3 | 2,4 | **PROVEN**: gate2-strings (Basics/Behavior/Answer-format labels, verbatim incl. curly-apostrophe entity) + REFERENCED `leadgen-section-studio-ui.test.ts` (live populate/collect vm-probes for the same controls). |
| 13 | Inheritance tags (continue/style) | 8.4-8.5 | 2 | **PROVEN**: gate2-strings ("Continue's inherited tags render verbatim... Color=Brand primary, Position=Bottom, full width, both tagged 'inherited'"). |
| 14 | Role-based color, no hex | 8.5 | 2,4 | **PROVEN**: gate1-tokens (no off-palette/raw hex on the Style tab's role surfaces, only the documented Bootstrap findings elsewhere) + gate2-strings (Corners/Border-color role-name enums, no hex text) + REFERENCED `leadgen-section-builder.spec.ts` test ⑤ (color control stores the ROLE via API read-back) + `leadgen-section-studio.spec.ts` "§8.5b Style-tab Corners + Border color actually render..." (live). |
| 15 | Offers per-Offer mapping | 8.7 | 4 | **REFERENCED ONLY** (not proven in this phase's new files — the Offers-tab content is 100% client-populated from a live `GET /sections/:id/offers` fetch; SSR ships an empty `data-studio-inspector-mapping` div, confirmed by direct read): `leadgen-section-studio-ui.test.ts` describes "§8.7 GET offers answer_fields" + "§8.7 mapping model E2" (extensive, live-D1, vm-probe-verified). |
| 16 | Advanced (ids/JSON only here) | 8.8 | 2 | **PROVEN**: gate2-strings (Advanced-disclosure labels: "Internal field", "Analytics label", "Component id") + REFERENCED `leadgen-glossary-lint.test.ts` (the Advanced-allowlist exemption logic for ids/JSON on the Studio side). |
| 17 | Google Maps jobs + warning (C3) | 9 | 2,4 | **PROVEN**: gate2-strings (Maps-tab strings, verbatim incl. entity-encoded apostrophes) + gate4-behavior probe 4 (`validateSectionContent` emits `maps_no_job` warning iff enabled+zero-jobs — the direct data-layer proof of the exact contract claim) + REFERENCED `leadgen-section-studio.spec.ts` test ⑦ (live banner) + `leadgen-activation-preflight-v25.test.ts` (activation-preflight mechanism, general). **RESOLVED (E2)**: `leadgen-v31-gate4-behavior.spec.ts` (Finding 10) drives a real blocked activation keyed to `maps_no_job` specifically — see Findings §10. |
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

## Findings (product↔golden / product↔contract divergences E1 surfaced — E2 resolution recorded per-finding)

1. **RESOLVED (F1) — Rail widths (Gate 1/3, Appendix B).** E1: the rendered
   grid `.lg-editor-grid{grid-template-columns:280px 1fr 380px}` used 280/380
   while `STUDIO_GEOMETRY`/Appendix B/golden :103 say 292 (library) / 344
   (inspector). E2 FIX: the grid rule now interpolates
   `${STUDIO_GEOMETRY.leftLibraryWidth}px 1fr ${STUDIO_GEOMETRY.rightInspectorWidth}px`
   → renders `292px 1fr 344px`. `leadgen-v31-gate3-geometry.test.ts` now
   ENFORCES the golden (asserts the rendered `292px 1fr 344px` present AND the
   old `280px 1fr 380px` absent). Fail-before/pass-after demonstrated.

2. **PARTIALLY RESOLVED (F2) + RECORDED GAP — Bootstrap-palette hardcoded hex
   (Gate 1b).** E2 FIX (the one cleanly-completable mechanism): the
   `.studio-control-invalid` 2px outline `#dc3545` → `${STUDIO_COLOR.danger}`
   (§3 `#B23A2C`). `#dc3545` was used in EXACTLY ONE rule and maps to a single
   §3 token with no missing bg/border shade, so it was fully converted and
   removed from `KNOWN_OFF_PALETTE_HEXES`; `leadgen-v31-gate1-tokens.test.ts`
   now asserts the §3-danger resolution + `#dc3545`'s total absence.
   **RECORDED GAP** for the remaining families (success `#0f5132`/`#d1e7dd`/
   `#badbcc`; danger `#842029`/`#f8d7da`/`#f5c2c7`; info `#055160`/`#cff4fc`/
   `#b6effb`; warn `#664d03`/`#fff3cd`/`#ffecb5`; secondary `#41464b`/`#e2e3e5`
   on the orphaned chip; dark `#0b1021`/`#d8e0f0` on the payload-preview
   `<pre>`): they stay in `KNOWN_OFF_PALETTE_HEXES` because (a) each hex is
   SHARED across ~4-6 rules (chip-validation/item-maps/map-status/offer-state/
   row-status/banners), so removing a value requires converting EVERY usage,
   not just the named mechanism; (b) a faithful §3 conversion needs status
   BACKGROUND + BORDER tokens (a danger tint/border, info/warn/success
   borders) and a neutral SECONDARY token — **none exist in `studio-tokens.ts`,
   which is OUT of this slice's file ownership** (adding them there is the
   required next step, flagged for the conductor); (c) §14 non-fixture:
   the fixture-visible "No issues" chip's GOLDEN target is NEUTRAL gray
   (`#5A6470` on `#F1F3F7`, golden :49), NOT a §3 status token — a
   golden-specific fix orthogonal to bootstrap→§3, and itself a newly-surfaced
   divergence; the dark payload-preview `<pre>` is an intentional dark code
   viewer, never §3 chrome. Kept honestly scoped, never asserted as
   "expected."

3. **RESOLVED (F3) — "how visitors answer" subcopy (Gate 2, §5.2/Appendix A/
   golden:145).** E2 FIX: `StudioGroup` gained a `subcopy?` field; the
   Answer-fields group carries `subcopy:"how visitors answer"` and
   `renderStudioLibrary`'s header emits a right-aligned `#BAC2CF`
   (`STUDIO_COLOR.answerFieldsSubcopy`) span for it. `leadgen-v31-gate2-strings.test.ts`
   now ENFORCES it PRESENT (and adjacent to the Answer-fields label).
   Fail-before/pass-after demonstrated.

4. **RESOLVED (F4) — Content-group explanatory callout (Gate 2, §5.2/Appendix
   A/golden:220).** E2 FIX: new `renderContentCallout()` renders the
   dashed-border callout "Legal notes, reassurance lines &amp; secure badges
   are just <b>Text</b> &#8212; pick a style in its settings. No separate
   blocks." below the Content group (border/text/bold trace to §3 tokens
   `contentDashedBorder`/`contentDashedText`/`text2Strong`; bg `#F6F8FB` is a
   golden-sourced literal, Gate 1b tier-3). `leadgen-v31-gate2-strings.test.ts`
   now ENFORCES it PRESENT. Fail-before/pass-after demonstrated.

5. **RESOLVED (F5) — Frame callout wording (Gate 2).** E2 FIX:
   `renderFrameCallout` reworded to the Appendix-A verbatim "Header, footer,
   progress &amp; background belong to the whole funnel &#8212; set them once
   in the Quote Builder. Open →" (was "Looking for the page header ...").
   `leadgen-v31-gate2-strings.test.ts` now ENFORCES the verbatim string.
   **CONTRACT ERRATUM (recorded, ratified by the conductor):** the golden
   MOCKUP (docs/leadgen/redesign-contract-v3/golden/golden-master-source.dc.html
   line 253) reads "Header, **logo**, progress, **footer** & background belong
   to the whole funnel ..." — a DIFFERENT word order/set than Appendix A (line
   653) and the §5.2 body prose (line 269), both of which read "Header,
   footer, progress & background belong to the whole funnel ...". This is an
   internal inconsistency WITHIN the contract package itself (the golden
   artifact vs. the two prose citations of the same string), not a
   product↔contract divergence. Converged to **Appendix A + §5.2** (which
   agree with each other) because §13 Gate 2 is explicitly defined as "assert
   every Appendix A string renders" — Appendix A is the gate's own named
   source of truth for string assertions — and `gate1-parity` (the gate that
   DOES treat the golden mockup as binding, per Appendix D "copy these
   strings, never reinterpret them") never asserts this callout's copy, so
   Gate 1a's markup-parity contract is unaffected by this choice. Recorded
   here as a contract erratum for a future contract-maintenance pass, not
   silently resolved as if no inconsistency existed.
   Two EXISTING tests OUTSIDE this slice's owned-file list asserted the pre-fix
   copy and were updated to the golden copy as a direct mechanical consequence
   (see "E2 out-of-slice touches" below).

6. **RESOLVED (F6) — "Search components" placeholder (Gate 2).** E2 FIX:
   dropped the trailing horizontal-ellipsis (`placeholder="Search components…"`
   → `placeholder="Search components"`, matching Appendix A/golden :108; the
   `aria-label` was already exact). `leadgen-v31-gate2-strings.test.ts` now
   ENFORCES the exact placeholder + the ellipsis form absent.

7. **(Structural, not a defect) "20 tiles" counts unique identities, not
   palette slots.** Appendix D's "All 20 tile SVGs" refers to 20 unique
   `data-name` values; the palette renders 22 tile SLOTS total (2 of the 4
   "Suggested" tiles reuse an Answer-fields tile's identical asset — an
   explicit, contract-intended shortcut, §5.2). Documented in
   `golden-master-v31.ts`'s own comments so this doesn't read as an
   ambiguity to a future maintainer.

8. **RESOLVED (E2) — the real Reset button (Gate 4, probe 3 / Appendix C row
   9).** `api/test-ui/leadgen-v31-gate4-behavior.spec.ts` "Finding 8" drives
   it in a real browser: drag the right width handle to commit a `custom_px`
   (confirmed by the canvas "≈ {n} px · custom" badge + a persisted-storage
   read), CLICK `[data-reset-width]`, then assert the custom chip hides, NO
   width preset is active (the field re-inherits the theme preset), and the
   saved node's `design_overrides.size.width` is DELETED (§7.2). Visually
   confirmed via the evidence PNG.

9. **RESOLVED (E2) — presets deselect on drag (Gate 4, probe 2).**
   `leadgen-v31-gate4-behavior.spec.ts` "Finding 9": click the "Full" preset
   (asserted `active`), drag a width handle to commit a `custom_px`, then
   assert the previously-active "Full" button LOST its `active` class and no
   preset is active while the custom chip shows (populateSizeControls: a
   preset is active only when `!isCustomWidth`). Visually confirmed.

10. **RESOLVED (E2) — activation blocks specifically for `maps_no_job` (Gate
    4, probe 4).** `leadgen-v31-gate4-behavior.spec.ts` "Finding 10": a
    section with a Maps-enabled field and ZERO jobs, wired to a quote variant
    with no offers, makes the activation preflight panel `blocked` SOLELY via
    the path-precise maps_no_job error problem
    (`.lg-problem-row[data-problem-severity="error"][data-problem-path*="props.maps"]`
    with the "Maps-enabled field with no job selected" message —
    `computeMapsNoJobProblems`, §9.3 "escalates ... same pattern as
    frame_scope_component"). The evidence PNG shows "Blocked (1 error)" with
    exactly that one ERROR row and NO coded offer/auction block — proving it
    is keyed to `maps_no_job` and NOT another cause.

11. **RESOLVED (E2 part 2) — fixture-surface status chips were Bootstrap hex,
    not §3/golden (Gate 1b/1a).** A NEWLY-SURFACED finding (caught by the
    conductor after the F1-F6 close, not one of the original 10): the top-bar
    "No issues" chip (`.studio-chip-validation[data-issue-count="0"]`) — which
    renders on EVERY Section-Studio page load, incl. Gate-1c states 1-5 —
    used Bootstrap success `#0f5132/#d1e7dd/#badbcc` while golden :49 is a
    plain NEUTRAL chip (`color:#5A6470;background:#F1F3F7`, no border). E2 FIX:
    the rule now uses `STUDIO_COLOR.muted`/`STUDIO_COLOR.issuesChipBg` (byte-
    identical to golden), with `border-color` set to the same bg value so the
    shared `.studio-chip` base class's 1px border visually disappears, matching
    golden's borderless look. The sibling "N issues" rule
    (`:not([data-issue-count="0"])`, §14 non-fixture in THIS 0-error fixture)
    was ALSO converted, from Bootstrap danger to the §3 warn family
    (`warnStrong`/`warnTint`/`warn` — a clean, already-complete
    {base,strong,tint} triple, no invented pairing) — cheap to ground since
    it's the identical CSS rule. `leadgen-v31-gate1-parity.test.ts` gained a
    NEUTRAL-chip enforcement test (fail-before/pass-after) + a regression
    guard confirming the TOP-BAR "Mapping 2 / 2 complete" badge and the
    BOTTOM-DRAWER "2/2" badge were ALREADY §3-correct (golden :45 / :374,
    byte-exact via `STUDIO_COLOR.success`/`successTintAlt`/`mappingBadgeBg`) —
    no fix needed for either, confirmed by direct read before touching
    anything. `leadgen-v31-gate1-tokens.test.ts` gained a rule-scoped
    regression proof + a calibration test.
    **Precision note on `KNOWN_OFF_PALETTE_HEXES`:** `#0f5132`/`#d1e7dd`
    (success color+bg) and `#842029`/`#f8d7da` (danger color+bg) REMAIN in the
    list — verified programmatically (not assumed) that they are still
    genuinely present inside the `SECTION_STUDIO_STYLES` string via OTHER,
    correctly out-of-scope non-fixture rules (`.studio-item-maps`,
    `.studio-map-status`, `.studio-offer-state`, `.studio-row-status`,
    `.studio-toolbar-problems`, `.lg-dependency-status`, `.studio-issue-list`).
    `#badbcc`/`#f5c2c7` (the two BORDER values) WERE removed — verified
    programmatically that their only other consumers
    (`.studio-mapoverlay-chip`, `.studio-choice-x`) live in a DIFFERENT
    exported constant (`SECTION_STUDIO_CANVAS_FRAME_CSS`, the canvas-iframe's
    own stylesheet) that this gate never scans, so within
    `SECTION_STUDIO_STYLES` specifically those two values are now genuinely
    absent. This is why the array edit is a precise, hex-by-hex removal, not
    a blanket "remove the 6 fixture hexes" — a blanket removal would have
    made the gate falsely flag still-legitimate non-fixture rules.
    **Remaining §14 non-fixture gaps** (mapping-overlay mapped/required-
    missing, maps-linked-field chip, hidden-node chip, orphaned-mapping chip,
    payload-preview dark `<pre>`) are UNCHANGED and STAY recorded — converting
    them needs status background/border tokens (a danger tint/border, an info
    border, a neutral SECONDARY token) that do not exist in `studio-tokens.ts`,
    which is outside this slice's file ownership; flagged for the conductor.

## Playwright / Gate-4-spec scope note (E2 update)

E1 treated "the Gate-4 Playwright spec" as the AGGREGATE of the existing
per-phase specs and flagged Findings 8-10 as the browser-level gaps that left
open. **E2 CLOSES them** with a dedicated, now-owned file
`api/test-ui/leadgen-v31-gate4-behavior.spec.ts` (3 tests) — the real Reset
click, presets-deselect-on-drag, and the maps_no_job activation block. It runs
per-file locally (never `npm run test:ui`, which parks the harness) alongside
the re-minted `leadgen-v31-gate1c-baselines.spec.ts` and the 4 existing
studio/theme specs (`leadgen-section-studio` 20, `leadgen-section-builder` 9,
`leadgen-studio-patterns` 17, `leadgen-theme-manager` 11) — all green.

## E2 re-mint note (Gate 1c) — part 1 (F1/F3/F4/F5/F6)

The F1 rail widths + F3/F4/F5/F6 library-copy fixes change the frozen studio
baselines (states 1-5); the themes states (6-7) are re-minted from a freshly
seeded local D1. Process: (1) ran the fixed product against the E1 baselines —
state 01-build-default diffed 6.46% (a large, expected layout shift from the
rail change cascading through the whole column + the new library copy); (2)
visually compared the E1 baseline vs the new capture and confirmed the delta
is ONLY the intended F1/F3/F4/F5/F6 change (wider library rail, "how visitors
answer" subcopy, Content callout, reworded frame callout, no-ellipsis search
placeholder) with no regression to any other element; (3) RE-MINTED all 7 from
the fixed product + fresh D1; (4) a stability run reported changed-pixel
ratio=0 for all 7. Per the methodology note below, a ratio=0 is not sufficient
on its own — the intended-delta confirmation was done by direct visual
inspection of the evidence PNGs (studio 01/09/08 states + the maps block).

## E2 re-mint note (Gate 1c) — part 2 (fixture-surface chip, Finding 11)

The chip-recolor fix changes states 1-5 (all share `renderStudioTopBar`'s
"No issues" chip); states 6-7 (Themes manager, no `.studio-chip-validation`
element) are unaffected — confirmed: both compared ratio=0 against their
part-1 baseline with NO re-mint needed. Process: (1) ran the fixed product
against the part-1 baselines for states 1-5 individually (`.serial` stops at
the first failure, so each state was run in isolation via `--grep` to get a
result for all five) — ratios 0.42%-1.26%, all small; (2) VISUALLY confirmed
state 1 (build default): direct side-by-side read of the full baseline vs. the
new capture shows the "No issues" chip changed from a green-tinted pill to a
neutral gray one, with every other element (rails, library tiles, canvas
field, drawer, callouts) pixel-identical; (3) for state 5 (Maps tab) the
same-eye visual comparison found NO visible difference at full-page scale —
since the deterministic, reproducible ratio (identical to many decimal places
across 2 separate runs against the SAME baseline) proved a real difference
existed somewhere, a diff-HIGHLIGHT image was generated (the same canvas
per-pixel technique the spec's own `pixelDiffRatio` uses, run standalone via
`playwright-core`) to make the changed pixels directly visible rather than
guessing — it showed the diff confined to an unrelated small dev-notes text
block in the Advanced/Maps documentation area (a text-antialiasing artifact),
NOT the chip (which had actually scrolled out of the fixed 2600px viewport for
this tab-focused state) and NOT any layout/content change; (4) RE-MINTED
states 1-5 (states 6-7 kept, already confirmed unaffected); (5) TWO
consecutive stability runs both reported changed-pixel ratio=0 for all 7
states, including state 5 — proving the apparent state-5 "diff" against the
OLD baseline was pre-existing capture noise unrelated to this fix (not
reproducible against the fresh baseline), not a product regression. The
scratch diff-highlight script was a throwaway investigation aid, not committed
to the repo.

## E2 out-of-slice touches (flagged for conductor ratification)

The F5 fix (an explicitly-mandated product change) reworded the frame callout
and thereby broke TWO EXISTING tests that asserted the pre-fix copy — both
OUTSIDE this slice's owned-file list:
- `api/test/leadgen-section-studio-ui.test.ts` (the `npm test` failure) — its
  §5.2 callout test asserted "Looking for the page header ..." + `>Open<`.
- `api/test-ui/leadgen-section-builder.spec.ts` (one of the 4 specs required
  green) — its ⑧ palette-callout test asserted "Looking for the page ...".
Both were updated to the golden/Appendix-A copy (the identical correction as
the owned gate2 flip) — a direct, mechanical consequence of the mandated F5
fix, required for the "green checkpoint" deliverable and for zero-deviation
(a test asserting the pre-fix divergent copy is itself a divergence-encoding).
These are the ONLY files touched beyond the explicit owned-file list; flagged
here for the conductor to verify/ratify. No PRODUCT file other than
`ui-section-studio.ts` was modified.

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
