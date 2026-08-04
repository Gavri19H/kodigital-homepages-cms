# P8-3 adversarial re-review (fix round F3-F9) — FIX-FIRST

Reviewer: fresh-context adversarial review #2 for P8-3 (scoped re-drive of the fixed journeys).
Branch `leadgen-r2-p8-3`. Gate sha `c03d71e`; branch HEAD `8f57f27` (verified: the only diff is
`docs/leadgen/r2/gate-logs/p8-phase-3-run4.log` + `-run5.log`, no code).
Server: the already-running `wrangler dev` on 127.0.0.1:8901 — client only; nothing started,
stopped or bound. Nothing deployed, no secret touched, no `--remote` D1.
Evidence: this directory (84 artifacts; `s*.png` screenshots, `r2-d*.json` raw drive logs).

## Verdict: FIX-FIRST — 1 BLOCKER, 2 MAJOR, 7 MINOR (+3 informational)

The predicted third recurrence happened. Fix round **F5 (MAJOR-3)** replaced a string that FIT
("No presets yet — create one below", 218.67px in a 288.00px box) with one that OVERFLOWS by
**+59.05px**, inside the same Themes panel BLOCKER-1's own round was repairing.

## Per-clause verdict table

| Owner clause (verbatim anchor) / register row | Drive evidence | Verdict |
|---|---|---|
| **N7** "theme is only design language!!!! colors, fonts, sizes" — Themes selects don't truncate their own value | `s3-zero-preset-select-zoom-1280.png` shows `No presets yet — create one from the Theme⌄`; `s3-site-select-long-1280.png` shows `Seed Local Living — Not activa⌄`; `s14-rail-visibility-*.png` shows all 16 rail selects 100% visible and fitting | **DEVIATES** — BLOCKER-1(new), MAJOR-2, MAJOR-3. The 16 rail scalars ARE fixed (content 288.00px vs worst option 191.43px, single-column 314px grid at 1280 AND 375, 100% visible); two other Themes-tab selects still clip, one of them created by this fix round |
| **N7** second surface — Themes manager font selects | `s11-mgr-typography-1280.png` (fits, `Inter (shows as default font)` fully painted in a 282.00px box); `s11-mgr-scrolled-375.png` + `s12-mgr-geometry-375.png` (the whole editor column hangs 300px wide out of a **56px** pane; the select is **5.3% visible**) | **DEVIATES at 375** (MAJOR-1); PERFECT at 1280 |
| **M2/R3** "theme is only design language" — a component control must not re-point a global role | `s5-A1-error-*.png` vs `s5-A2-success-*.png` + `r2-d5-major1-arms.json`: error→success moves `.lg-question-card` only; `input.lg-input` 4/4 and `.lg-frame-background` stay `rgb(255,255,255)` in BOTH arms; `s4-PALETTE-swatch-1280.png`: `palette.card_background=#123456` still paints `.lg-frame-background` `rgb(18,52,86)` | **PERFECT** — 3 visible coordinates → 1; the operator's own palette swatch is no longer overridden |
| **N11** "to use them as presets in different 'Quotes'" — disabled state must be visible + reasoned | `s2-preset-ZERO-crop-1280.png` / `-375.png` (amber dashed box + greyed buttons) vs `s2-preset-READY-crop-1280.png`; 6 computed properties differ (background `#F9FAFB` vs `#FFF`, color `#6B7280` vs `#111827`, opacity `.55` vs `1`, cursor `not-allowed` vs `pointer`) | **PERFECT** on the disabled affordance; the panel's own select **DEVIATES** (BLOCKER-1) |
| **N11** — the zero-preset select must agree with the help line | `s2-preset-ZERO-crop-1280.png`: select `No presets yet — create one from the Themes manager`, help `No presets saved yet — save one from the Themes manager, then it can be applied here.` | **PERFECT on wording** (same destination), **DEVIATES on rendering** — the destination is the part that gets clipped (BLOCKER-1) |
| **N20** "one font vocabulary" | `r2-d6-roles-fonts.json`: rail offers `Poppins · Space Grotesk · Fraunces · Playfair Display · Manrope · DM Sans · Work Sans · Lexend`; manager SSR offers the identical 8 in the identical order (+ the stored legacy, un-hidden, labelled "(shows as default font)") | **PERFECT** |
| **N20 / MINOR-1 regression risk** — a STORED non-vendored family must still display | `s6-rail-display-font-1280.png` reads `Literata (shows as default font)` with the option `hidden=true` and 191.43px in a 288.00px box | **PERFECT** — the hidden-option mechanism does not blank the closed select |
| **N1** "the rules you build are using jargon" — no raw ids as visible labels (board Theme chip) | `s2-board-chips-1280.png` chip reads **`P8 Repro`**; SSR pre-hydration reads `Theme`; total `/api/admin/leadgen/themes` GETs = 3 (2 on load, +1 on the Themes-tab click) | **PERFECT** — no raw id at any moment, no new request |
| **MINOR-4 / F8** — `used_by` says exactly what it does | `r2-d6-roles-fonts.json`: `brand_primary=#FF00AA` → `.lg-progress-fill` `rgb(255,0,170)` ✓; `card_background=#123456` → `.lg-question-card` + all 4 `input.lg-input` `rgb(18,52,86)` ✓; answer cards `#FFFFFF` == card_background ✓; **but** the Continue button stayed `rgb(27,58,92)` under `brand_primary=#FF00AA` | **DEVIATES-partial** — "progress fill" and "input fields" are true; the pre-existing noun "buttons" is not true of any button this funnel renders (MINOR-3) |
| **MINOR-7** — an unlabelled design id must not 500 the editor | Render path carries no `throw` (`quotes-handlers.ts:6970`); the editor returned 200 on all 14 driven loads; completeness moved to `assertFunnelDesignLabelsComplete`, tested both ways (`leadgen-p8-n1-design-label.test.ts:229/243/250`) | **PERFECT** |
| **MINOR-9** — the duplicate catalog GET is gone | 3 GETs per editor session (was 4) — `r2-d1-select-sweep.json` `1280:_reqs` / `375:_reqs` | **PERFECT** |
| **MINOR-2 / MINOR-3** — the guard fails a MIS-TARGET; each role proves itself on its own surface | `leadgen-r2-dead-controls-guard.test.ts:2240-2317` injects REAL rules on REAL rendered elements (`.lg-frame-background`, `.lg-headline`) and requires the guilty key to be NAMED; accent's consumer deleted from BOTH real artifacts makes ON-TARGET go silent; progress bar off on every role page; `LABEL_TARGET_RESIDUALS = []` with a leg that fails on a stale residual | **PERFECT** — see "coverage split" below |
| **Visitor journey** (owner-facing runtime, restored theme) | `s10-visitor-p0-1280.png` / `-375.png`, `s10-visitor-last-*.png`: 7-step walk advancing by the first VISIBLE `[data-lg-continue]` (matched=10 / visible=1 at every step), 0 pageerrors, 0 console errors, `scrollWidth == innerWidth` at both widths | **PERFECT** |

## Every deviation found — listed before ranking

1. `#lg-theme-preset-select`'s zero-preset placeholder overflows its box by +59.05px at 1280 AND 375.
2. Themes manager at 375: the editor column is 300px inside a 56px pane; both font selects are 5.3% visible.
3. `#lg-theme-site-select` truncates its own selected value (+38.70px at 1280, +21.70px at 375) — product-composed label.
4. `#lg-tpl-target-select` / `#lg-theme-target-select` +283.77px, `#lg-tpl-section-select` +305.80px, `#lg-site-select` +2.47px at 375 — operator-authored names.
5. `ROLE_META.brand_primary.used_by`'s "buttons" is not true of any button the driven funnel renders.
6. `refreshPresetAvailability`'s `failed` state is terminal and unrecoverable (stops rescheduling).
7. `refreshPresetAvailability` self-reschedules every 400ms for the life of the page with no stop condition.
8. `shared.ts`'s F3 comment claims `.lg-scalars` has one consumer; it has at least three files' worth.
9. ADJ-P8-25's auctions-page concern was grep-only; now measured (no truncation).
10. The manager's dropdown carries one family the rail never offers whenever a legacy family is stored.
11. `funnelDesignLabel` indexes a plain object un-guarded (`constructor`/`toString` would return a function).
12. `assertFunnelDesignLabelsComplete` has exactly one caller — the test file; no independent CI leg.
13. `border`'s "card/input borders" is true of ANSWER cards and inputs, not of the question card.

## Ranked

### BLOCKER-1 (NEW, created by this fix round) — F5's MAJOR-3 string re-created the truncation N7 exists to remove
- **Violates:** register **N7** (owner anchor: *"theme is only design language!!!! colors, fonts, sizes"*), the same clause BLOCKER-1 of review #1 raised, in the same panel F3 was repairing.
- **Where:** `api/src/admin/leadgen/quotes-tabs/funnel.ts:3986` — `placeholder.textContent = items.length === 0 ? 'No presets yet — create one from the Themes manager' : …`, rendered into `#lg-theme-preset-select` (`api/src/admin/leadgen/quotes-tabs/themes.ts:389`, inside `.lg-preset-apply-row` — `flex:1 1 220px;min-width:160px`, NOT `.lg-scalars`, so F3's container fix does not reach it).
- **Measured, driven (zero-preset arm via a `{items:[]}` route fulfil against the real page):** content box **288.00px**; option text **347.05px** → **+59.05px** at 1280 AND 375; `scrollWidth 363 > clientWidth 312`; `text-overflow: clip`; no `title`. The string F5 REPLACED — `"No presets yet — create one below"` — measures **218.67px**, i.e. **−69.33px, it fit**.
- **Failure scenario:** an operator with no saved presets is told where to go, and the destination is the part that is clipped: the control reads **“No presets yet — create one from the Theme⌄”**. The fix's entire purpose (name the Themes manager) is the text that does not survive.
- **Screenshots:** `s3-zero-preset-select-zoom-1280.png`, `s3-zero-preset-select-zoom-375.png`, `s2-preset-ZERO-crop-1280.png`, `s2-preset-ZERO-crop-375.png`.
- **Pattern note for the conductor:** this is the third consecutive round in which a copy fix lengthened a label past a box nobody re-measured (F2 `(legacy)` → jargon; F2 font labels → BLOCKER-1; F5 preset placeholder → this). The `.lg-scalars` container fix is real but partial: it covers 16 of the ~21 selects on the Themes tab. The class is only closed when EVERY select the Themes surface renders is measured against EVERY string the product can put in it.

### MAJOR-1 — the Themes manager at 375 is still unusable, and F3's stated 375 arithmetic is false
- **Violates:** register **N7** (second surface) and the E6 375 leg; directly contradicts the fix's own comment at `api/src/admin/leadgen/ui-theme-manager.ts:893-901` (*"At 375 the row is ~343px, 666 > 343, so the two columns stack and this one takes the full 343px"*).
- **Measured, driven at 375:** the center editor pane (`div[style*="overflow-y:auto"]`) is **56.0px** wide (`clientWidth 56`, `scrollWidth 348`, `overflow-x: auto`). `[data-pin="8.4-editor-controls"]` is now **300.0px** (F3's `min-width:0 → 300px`) at `x=345`, right edge **645** — 270px past the pane and the viewport. `#tm-headline-font` and `#tm-body-font` are 282.0px at `x=358`: **5.3% visible inside their clipper, 6.0% inside the viewport**. Document scrollWidth == innerWidth, so nothing surfaces the problem — the content hides behind a nested horizontal scrollbar in a 56px pane.
- Overriding the shipped `min-width` back to `0px` in the live page reproduces the same 5.3% (the `minmax(320px,1fr)` typography-grid floor pins the track at 320px either way), so the 375 leg of F3 changes the failure mode without removing it: review #1's MINOR-11 (`#tm-headline-font` = 14.03px, fully visible) becomes a 282px select that is 94.7% off-screen.
- **Failure scenario:** an operator on a phone/narrow window opens `/admin/leadgen/themes`, sees a ~15px sliver of each font control, and has no visible affordance telling them to scroll a 56px pane sideways.
- **Screenshots:** `s11-mgr-scrolled-375.png`, `s13-mgr375-AFTER-fix.png`, `s13-mgr375-SIMULATED-prefix.png`, `s12-mgr-geometry-375.png`. 1280 is clean: `s11-mgr-typography-1280.png`, 100% visible.

### MAJOR-2 — a Themes-tab select truncates its own value with a PRODUCT-composed label
- **Violates:** register **N7** under the standard this phase itself adopted ("no select shows a truncated version of its own value" — review #1's BLOCKER-1, restated in this dispatch). Not covered by the narrow contract wording ("their own *default*"), so the conductor may need an owner ruling if it reads N7 narrowly — but mission-loop's fix-now rule applies: the Themes tab is exactly this phase's journey.
- **Where:** `#lg-theme-site-select` (Themes tab) / `#lg-site-select` (page header). The overflowing text is product-written: the site name plus the product's own `" — Not activated yet"` suffix.
- **Measured, driven** (real `selectOption` of the long entry, then restored): content **197.88px** vs **236.58px** → **+38.70px** at 1280; **214.88px** vs 236.58px → **+21.70px** at 375. `scrollWidth 253 > clientWidth 222`. No `title`.
- **Screenshots:** `s3-site-select-long-1280.png` (reads `Seed Local Living — Not activa⌄`), `s3-site-select-long-375.png`.

### MINOR-1 — funnel/section pickers clip operator-authored names with no title affordance
`#lg-tpl-target-select` and `#lg-theme-target-select` (content 186.00px) vs a 469.77px funnel name → **+283.77px**; `#lg-tpl-section-select` (226.00px) vs 531.80px → **+305.80px**; `#lg-site-select` at 375 → **+2.47px**. Pre-existing, unrelated to `.lg-scalars`, and unbounded by nature (operator names). The honest close is a `title` + ellipsis affordance, not a wider box. `r2-d1-select-sweep.json`, `r2-d9-templates-auctions.json`.

### MINOR-2 — `refreshPresetAvailability`'s failed state is terminal and cannot recover
`api/src/admin/leadgen/quotes-tabs/themes.ts` — after `PRESET_UNKNOWN_LIMIT (25) × PRESET_TICK_MS (400ms) = 10s` of `unknown`, the function calls `applyPresetState('failed')` and `return`s **without rescheduling**. If `funnel.ts`'s catalog GET resolves after 10 s (slow link, cold worker), the picker fills with presets while the two buttons beside it stay disabled and the help reads *"Could not check for saved presets — reload the page to try again."* forever. Fallback masks a recovery that already happened. (Copy is honest, so MINOR, not MAJOR.)

### MINOR-3 — `brand_primary`'s `used_by` still says "buttons", which no button on the driven funnel honours
`api/src/admin/leadgen/quotes-tabs/shared.ts:519` and `api/src/admin/leadgen/ui-theme-manager.ts:704`. Driven: `palette.brand_primary=#FF00AA` moved `.lg-progress-fill` to `rgb(255,0,170)` (F3's restoration is correct) while the Continue button stayed `rgb(27,58,92)` — buttons follow `button_primary_bg`, a different role with its own row. The guard's own `ROLE_PAGES` comment concedes the intended referent is the range-stepper's `+`/`−` buttons, a component this funnel never renders. F8's own rule ("must not describe LESS than the control does") has a converse this row breaks. `r2-d6-roles-fonts.json`.

### MINOR-4 — `shared.ts`'s F3 comment states a false fact about the rule it changed
`api/src/admin/leadgen/quotes-tabs/shared.ts:610` — *"the only consumer of this rule (quotes-tabs/themes.ts's rail)"*. `.lg-scalars` is also emitted by `ui-quotes.ts:630`, `quotes-tabs/templates.ts:324/371/546/607`, and `ui-auctions.ts:475/624/634/642/650/655/659/667/677/685/823/827` (under that file's own duplicate rule). **Driven, no regression resulted:** `/admin/leadgen/quotes/new` collapses the empty tracks (`460px 460px 0px 0px` at 1280, `293px` at 375); the Templates inspector's 3-cell grids render single-column at 318px/317px; the auctions editor keeps `460px 460px`. The change is safe; the justification is wrong, and a wrong "only consumer" claim is exactly what lets the next edit skip a re-measure.

### MINOR-5 — an unbounded 400 ms poll for the life of the editor page
`refreshPresetAvailability` reschedules itself unconditionally in every non-failed state, including the terminal `ready` / `zero` states. It is a cheap DOM read (deliberate, per the comment), but it never stops.

### MINOR-6 — `funnelDesignLabel` indexes a plain object without an own-property guard
`api/src/admin/leadgen/quotes-handlers.ts:6970` — `FUNNEL_DESIGN_LABELS[id]` returns an inherited member for `id === "constructor"` / `"toString"`, so `label !== undefined` would render a function as the operator label. Not reachable today (ids come from the `FUNNEL_DESIGNS` registry, never from a request), so hardening only: `Object.prototype.hasOwnProperty.call(...)`, as the sibling `applyThemeChipNames` already does correctly.

### MINOR-7 — `border`'s "card/input borders" is true of the ANSWER card, not the question card
Driven with only `palette.border` changed `#D2D9E5 → #00FF00`: 3 of 4 `input.lg-input` borders moved to `rgb(0,255,0)` (the 4th is the focused address field on its own border), answer-card borders read `rgb(238,119,51)` == the border role; `.lg-question-card` stayed `rgb(233,237,243)` in both arms. Pre-existing wording, untouched by this phase; noted so the next `used_by` pass does not "fix" it in the wrong direction. `s7-border-base-p1-1280.png` vs `s7-border-lime-p1-1280.png`.

### Informational (no action required)
- **ADJ-P8-25 upgraded from grep to measured:** the auctions editor at 1280 and 375 renders 9 `.lg-scalars` grids and 10 visible selects with **zero** overflowing options (`460px 460px` at 932px, `293px` single-column at 375). The owner's fix-or-defer ruling can now be made on data. `s9-auctions-1280.png`, `s9-auctions-375.png`.
- **Manager offers 9 families, rail 8, when a legacy family is stored** — the extra entry is the stored value itself, un-hidden and labelled "(shows as default font)". Required to display the current value; the fresh-choice vocabulary is byte-identical on both surfaces.
- **`assertFunnelDesignLabelsComplete` has exactly one caller (the test).** The completeness guarantee lives in the suite, which is the gate — disclosed, not hidden.

## Audits that PASSED

**Gate log** (`docs/leadgen/r2/gate-logs/p8-phase-3-run5.log`): stamped `HEAD c03d71e208764b…` == the branch HEAD at gate time (`git diff c03d71e..8f57f27` = the two log files only). `--- git status --porcelain --- [status-empty=yes]`. All five exit markers present and zero: `TYPECHECK_EXIT=0`, `VITEST_EXIT=0`, `VERIFY_ALL_EXIT=0`, `RUNTIME_EXIT=0`, `REGISTER_EXIT=0`. **Counts recomputed by hand** by summing every `✓/↓ test/… (N tests | M skipped)` line in the raw text: **487 files, 8204 tests, 30 skipped, 8174 passed, 0 failure markers** — identical to the stamped summary. `verify:all` 0 with `jargon TOTAL: 0`; bundle `52938/53248`; `check_register` `rows checked: 69 / TOTAL violations: 0` (independently recounted: 69 data rows in `P8-REGISTER.md`).

**Zero-drift, recomputed independently:** `git diff --name-status f240788..c03d71e -- api/test` yields **16 added `.test.ts` files and zero deletions**; summing their per-file counts from run 5's raw text gives **exactly 480**. Cross-checking every per-file count against the P8-1 run-4 census, the only file pre-dating P8 whose count moved is `leadgen-r2-dead-controls-guard.test.ts` **26 → 58**. `7692 (f240788) + 32 (guard) + 480 (new) = 8204`. ✓

**p3a recapture #4:** 9 fixtures changed; exactly **three** were untouched by the previous three P8-3 recaptures (`quotes-list-empty`, `quotes-new`, `quotes-not-found`) — they are the full-page fixtures that embed `LG_QUOTES_STYLES`, so the `.lg-scalars` + `.lg-preset-*` rules reaching them is the expected consequence, not drift. No hand-edit is possible undetected: `leadgen-p3a-split-parity.test.ts` (12/12 in run 5) re-renders each page through the live code and compares byte-for-byte. Every distinctive new string was found in `api/src` by grep (`lg-preset-help-blocked` ×2 files, `repeat(auto-fit,minmax(220px,1fr))`, `Used by: buttons, progress fill, focus ring`, `question card, answer cards, input fields`, `data-lg-preset-ssr`, `data-theme-preset-id`, `min-width:300px`, `8.4-typography-grid`).

**No test weakened across F1–F9.** Per-file removed-vs-added `expect(` counts: every removal is a same-line replacement that is equal or stricter (`color.card` "is NOT re-pointed" plus a new positive on `questionCard.background`; the two `used_by` strings widened). **F9 specifically:** the retired P8-1 assertion (`{theme_id} → the raw id`, an accepted "named gap") is replaced by a **positive plus an explicit negative** — `toMatch(/…>Theme<\/span>/)` **and** `not.toMatch(new RegExp(…${fx.presetId}</span>))`. Strictly stronger.

**The guard's coverage split is honest.** `covered=28 / out-of-coverage=4 / unreachable-roles=2 of 34`, and the pinned-set test asserts the three sets *exhaustively* account for all 34 inline keys. The 4 out-of-coverage are `typography.body`, `scales.spacing`, `scales.radius`, `scales.shadow` — global scales whose labels ("Body font", "Spacing", "Corners", "Shadows") name no element, so a label→target invariant has nothing to bind to; each carries a written reason. The 2 unreachable roles are `error` (`.lg-input[aria-invalid="true"]`, a runtime state) and `surface_wash` (`:focus-within`, a pseudo the helper treats as non-matching) — genuinely unreachable to a static resolver, each with a >200-char reason, a named stylesheet-level fallback proof, and the exact driven step that would close it. Not a parking lot. **The red proofs are genuine:** they inject a real declaration onto a real, visible, rendered element and require the guilty key to be NAMED, plus a "silent on its own labelled surface" leg that deletes accent's consumer from BOTH real artifacts, plus a leg proving the progress bar is off on every role page. `LABEL_TARGET_RESIDUALS` is empty and a leg fails on any stale residual. The shipped MAJOR-1 mechanism is separately pinned by `leadgen-p8-m2-theme-keys.test.ts` / `leadgen-theme-tokens.test.ts` (`design.color.card` must NOT be re-pointed).

**Security.** No SQL added anywhere in the diff. Every new interpolation is escaped (`escapeHtml(id)`, `escapeHtml(label)`, `escapeHtml(themePresetIdOf(funnel))`); the new client code writes `textContent`, never `innerHTML`; `applyThemeChipNames` reads its lookup through `Object.prototype.hasOwnProperty.call`. No new route, no authz change, no `process.env`, no `wrangler deploy`/`secret put`/`--remote`. `api/.dev.vars`'s two `GOOGLE_MAPS_*` slots are **empty and untouched** (unmodified in `git status`). **No deferral markers** in any added line: `\b(TODO|FIXME|HACK|XXX)\b`, "polish later", "for now", `defer(red)? to (v2|later|a follow-up)`, `simplified for (now|v1)`, `will be (done|added) later` → 0 hits across `api/src` + `api/test`.

**Silent failures.** "Apply to this funnel" with the placeholder still selected surfaces **"Pick a preset first."** on screen (no dialog, no mutating request) — not a silent no-op. The visitor walk produced 0 pageerrors and 0 console errors at both widths.

**Reduced-model hunt.** Beyond the ranked findings above: none found. The rail's 3 hidden legacy fonts are not a locked control (a stored value still selects and paints); the preset buttons are gated by a real, confirmed state, not a stub; no placeholder content, no seeded-only path — the MAJOR-1 scenario, the zero-preset arm and the stored-legacy-font arm were all authored from scratch this session against unique values and restored afterwards.

**Restoration.** Every write this review made was to `lgf_01KZ271383F5X1SQ3DXTXKNJE5.theme_json` and every arm ended with `PUT {"theme_id":"thm_p8-repro"}` (200) plus a GET verification. Final DB state confirmed: funnel A `{"theme_id":"thm_p8-repro"}`, funnels C/E untouched, both KV theme records byte-unchanged (`thm_p8-repro` `#1D9BF0`/`Inter`, `thm_rv1b-arm-theme` `#00E5FF`/`Inter`). The `lg-theme-site-select` drive was display-only and restored in-page.
