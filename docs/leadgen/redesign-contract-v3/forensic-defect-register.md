# Post-deploy forensic defect register — Section Builder v3.1

Opened 2026-07-13 after the operator's production acceptance test **FAILED** (production = worker
version 19dc8d21 = origin/main; deploy run 29262532491). Authority: operator screenshots
`~/Desktop/Image1.png … Image11.png`. The prior "1:1 aligned" verdict is **VOID**.

Rules for this register:
- Every row carries file:line evidence or a live real-input probe result. No narrative verdicts.
- No row closes without a **trusted-input** (real click/drag) pass proof — synthetic
  `dispatchEvent` proof is inadmissible (it bypasses hit-testing; see M1).
- Scope of the sweep: EVERY palette component × EVERY canvas interaction × EVERY inspector
  tab/control × rules × offers mapping × Maps jobs × themes screen × sections list. An element
  that is unwired, dead, misaligned, unclear to the user, legacy/spec-leaked, or divergent from
  the approved design is a defect.

## A. Why the green gates lied (false-green mechanisms — each gets a permanent countermeasure)

| ID | Mechanism |
|----|-----------|
| M1 | Behavior specs used synthetic `dispatchEvent` (bypasses hit-testing) → misaligned/occluded controls still "pass" while real mice fail. |
| M2 | Parity gates assert only golden-covered regions; legacy UI OUTSIDE the golden was never checked and never banned. |
| M3 | All fixtures were fresh-authored through the new UI; real/legacy-shaped production content was never exercised. |
| M4 | "Recorded CONTRACT GAP" was used to ship user-visible dead controls (e.g. 11/12 leading icons). |
| M5 | No effect-assertions: gates proved markup/attr existence, never "click ⇒ render changed". |
| M6 | No jargon gate: `§`-refs, "legacy", wrangler secret names render in product UI copy. |

## B. Operator-reported defects (U1–U10, from screenshots)

| ID | Surface | Operator report | Evidence so far | Status |
|----|---------|-----------------|-----------------|--------|
| U1 | Canvas selection/resize | Overlay box offset from the component; resize works E/W only, no N/S; overlay doesn't track | Image1; §7 implemented width-drag only; overlay geometry bug (S1 tracing) | OPEN |
| U2 | Continue button | Can't resize/drag on canvas; Style shows Color/Position/Size all "inherited", only label editable; no path to edit the frame | Image2 — dead-end by construction | OPEN |
| U3 | Canvas editing | NO component can be dragged/moved on the canvas at all | Image1/2/11; flow layout + toolbar ↑↓ only (S1 confirming) | OPEN |
| U4 | Offers → "Open full mapping →" | Click does nothing | Image3; button `ui-section-studio.ts:2066`, island queries `:7757`; handler behavior TBD (S3/L5) | OPEN |
| U5 | Choices editor UX | Unlabeled triple `Option 1 / option_1 / option_1`; `emoji` is a bare text input (no picker, no emojis); icon/Image without choosers; wall of unlabeled inputs | Image5 | OPEN |
| U6 | Style presets | Width S/M/L/Full, Height, Corners clicks change NOTHING on canvas | Image6 (Simple answer buttons) | OPEN |
| U7 | Rules tab | Cannot author any rule; IF-dropdown offers only "— always visible —"; raw operator code `eq` shown as UI copy | Image7 | OPEN |
| U8 | Golden fidelity + legacy junk | Tiny headline/subheadline inputs ("Wh"/"rates d"); "— pick —"/"+New…" Activity/Vertical; legacy element-toolbar row; top-right internal spec-text block ("Legacy… §8.8 … wrangler secret (GOOGLE_MAPS_BROWSER_KEY)"); extra "§8.5 tokenized layout props" rail section; empty Border-color swatches; canvas headline typography smaller than golden | Image8 (approved) vs Image9 (shipped); 525 `§` occurrences in `ui-section-studio.ts`, a subset user-visible | OPEN |
| U9 | Leading icon picker | Only "Location pin" works; the other 11 options do nothing | Image10; `presets.ts` `fieldLeadingIcon` renders only `"location"` (~:1338) — comment admits the other 11 "render no icon"; shipped anyway | OPEN |
| U10 | Slider | Poorly designed, looks bad; Step=5 affects nothing; many steps change nothing | Image11; renderer/runtime step consumption TBD (S2/L5) | OPEN |

Operator bottom line: the above is a SAMPLE — estimate 100+ defects. Full-matrix sweep required.

## C. Systematic sweep findings (S1 canvas · S2 inspector · S3 rules/mapping/maps · S4 golden census · L5 live real-input probe)

### S4 — golden-vs-shipped region census (COMPLETE)

File facts: golden = 963 lines; shipped `ui-section-studio.ts` = 9,828 lines. Structural verdict:
SSR templates ≈ half golden-faithful, but the divergent/invented regions sit exactly where the
operator's eye lands; >2/3 of the file's bulk serves surfaces the golden never asked for.

#### S4-A. LEGACY-NOT-IN-GOLDEN (shipped blocks with no golden counterpart)

| # | Region | Shipped evidence | Sev |
|---|--------|------------------|-----|
| A1 | Full admin shell (11-item sidebar + header) wraps the studio; golden (= Image8, approved) is a self-contained full-bleed editor with NO sidebar/header | `templates/layout.ts:164-177,181-212` via `ui.ts:169-184` ← `ui-sections.ts:444-451` | P0 |
| A2 | Legacy Maps/validation fieldset — "Legacy: address / ZIP validation (§8.8 supersedes…)", "(§12.8)" checkbox, "wrangler secret (GOOGLE_MAPS_BROWSER_KEY)" as product copy. Comment L880-883 ADMITS it's "NOT part of the golden strip… kept working… since no golden position exists" | `L940-947` (+ admission `L880-883`) | P0 |
| A3 | Canvas element-toolbar balloons on every selection: structure cluster (↑↓ +Before +After Duplicate Group→Stack/Card panel/Grid/Columns Ungroup Delete) + layout/text/component/choice/preset clusters ("ZIP code (5 digits)" Accept dropdown, Required, Placeholder, "Validation…") — golden toolbar (:264-292) is ONE 46px row, never grows | `L1337-1391` (renderCanvasToolbar `L1300-1393`; helpers `L1177-1268`) | P0 |
| A4 | "§8.5 tokenized layout props" Style-tab layer: literal jargon line + container-prop panel + design panel (Component style preset, Image fit, Icon/Feature color, Range fill, Button color/text) — golden Style tab ENDS at Border-color note (:554-555) | insertion `L1973-1976`; `renderDesignPanel L1496-1558`; `renderLayoutPanel L1560-1720` | P0 |
| A5 | Bottom-drawer "Preview" panel = a dev/QA console: pickers, mapping overlay, refresh, 6-button state simulator, dependency-JSON textarea, events-would-fire log, 2 iframes — golden drawer is a bar only (:371-387) | `renderPreviewPanel L2122-2170`, wired `L2305-2307` | P0 |
| A6 | Bottom-drawer 4th tab "Design overrides" (14 role swatches + columns/gap) — golden shows exactly 3 items + theme switcher + Expand; self-flagged non-golden `L2226-2230` | `L2172-2200`, wired `L2258,2302-2304` | P1 |
| A7 | Systemic §-jargon in visible copy beyond A2: `L887` (§30.2), `L1876` (§6.5), `L1896` (B9 §6.4), `L1909-1923` (§5.5×4), `L2009/2025` (rules legends §6.10/§7.3), `L2094` (§5.2), `L2143` (§14.9), `L2153`, `L2160` (§8.9/§9.1), `L2242` (§12.11) | cites listed | P1 |
| A8 | Activity/Vertical "+New…" buttons + literal "— pick —" empty option — golden (:64-67) shows populated pills, no +New | `L780-784`, `L899-908` | P1 |
| A9 | LeadGen sub-tabs row (Offers/Sections/Quotes/Auction) between header and studio | `ui.ts:141-156` via `ui-sections.ts:435` | P1 |
| A10 | "New Section" pub-id span + 2 alert placeholders above studio | `ui-sections.ts:436-439` | P2 |
| A11 | Themes manager = separate page/route vs golden's in-page overlay (:627-721) | `ui.ts:235`; `ui-theme-manager.ts:1-2` | P2 |
| A12 | Orphaned `.studio-activity/.studio-vertical` CSS (dead) | `L2406` | P2 |

#### S4-B. GOLDEN-DIVERGENT (both have it; shipped wrong)

| # | Region | Root cause | Sev |
|---|--------|-----------|-----|
| B1 | Headline/subheadline inputs collapse to ~90px ("Wh"/"rates d") | `.studio-settings{display:grid;grid-template-columns:repeat(2,1fr)}` (`L2410`) with exactly 2 children → the whole form auto-placed into a half-width column; golden :83-91 is a flex row. Input markup itself near-byte-identical — ONE-RULE CSS BUG | P0 |
| B2 | Canvas question-card typography: shipped Literata 28px/700/#1A1F36 vs golden Newsreader 31px/600/#16324f (subheadline 13.2px/#4A5568 vs 15px/#63707F) | canvas renders REAL funnel-design tokens (`default-funnel/tokens.ts:17-18`, `styles.ts:263-282`; renderers `presets.ts:506-521`), not golden's values. ⚠️ SCOPE DECISION: matching golden here changes LIVE funnel rendering on 100+ zones — needs explicit operator approval in the remediation plan | P0 |
| B3 | Border-color swatches render EMPTY circles | golden :550-552 bakes inline `background`; shipped markup `L1965-1970` has none and `.studio-role-swatch` CSS (`L2680,2537`) never sets background — depends on runtime JS paint that doesn't happen | P0 |
| B4 | "No issues" chip: no icon, wrong shape (pill vs golden rounded-rect+SVG :49-52) | `issueChip() L758-761` lacks inline overrides (unlike the byte-exact Mapping badge `L799-802`) | P1 |
| B5 | "Active" status pill: generic `.badge-published` colors, no dot, lowercase | `ui.ts:187-197` → `layout.ts:273-275` vs golden :40 | P1 |
| B6 | Canvas surface = independently-sized real iframe + 2 decorative skeletons vs golden's single 600px flex column (:295-296) | `L2451-2470` (DEV-66 iframe model) | P2 |
| B7 | Section-name flex slot `min-width:220px` vs golden's tight 132px grouping | `L2405` vs golden :39 | P2 |
| B8 | Activity/Vertical unsaved state shows "— pick —" (golden never depicts empty state) | `L780-784` | P2 |

### S2 — inspector controls end-to-end (COMPLETE)

Pipeline fact (matters for every fix): the re-render loop is SOUND — every mutation →
`afterModelChange()` (studio:4141) → 300ms debounce → real `POST …/sections/preview`
(studio:4273) → same server renderer as runtime → iframe replace. Defects are
write-without-consumer / missing-JS-wire / dead-link, NOT a broken render loop.

| # | Finding | Root cause (file:line) | Verdict | Sev |
|---|---------|------------------------|---------|-----|
| S2-1 | Width/Height/Corners/Border-color inert on EVERY choice/button/dropdown/container type (= U6). State writes + re-render fire; renderers never read the props | `styleVariantOf` (studio:5185-5190) shows the 'field' style block to all non-text types, but `sizeStyleEntries`/`appearanceStyleEntries` (presets:1182-1321) are consumed ONLY by text-input-family renderers (presets:1354,1456,1560); `renderButtonAnswerGroup` (presets:648) etc. never touch them | MISALIGNED | P0 |
| S2-2 | Continue button (= U2): Style tab = 3 hardcoded static "inherited" rows, ZERO inputs; the one escape hatch "Open Quote Builder →" is `href="#0"` with NO click handler anywhere | studio:1990-1995; dead anchor studio:1819 (`data-open-quote-builder` appears exactly once); working sibling pattern exists at studio:987 | DEAD | P0 |
| S2-3 | Slider is MUTE in live funnels: range input lacks `data-lg-input`, engine's delegated listener requires it → dragging never records an answer, never fires answer_change; only `props.default` ever submits. Step consumed NOWHERE visually (only native step attr) (= U10 + worse) | presets:546-581 (`renderRange`); contrast presets:1385 (`data-lg-input` on text inputs); engine bundle `handleInputEvent` gate | DEAD (runtime) | P0 |
| S2-4 | Choices grid (= U5): first three columns are label / value / analytics_id, rendered as bare inputs with NO label/aria-label; a new choice seeds all three to "Option N/option_N/option_N" | `CHOICE_FIELDS` studio:6273; render studio:6327-6337; seed `addChoiceToNode` studio:3766 | UX-BROKEN | P1 |
| S2-5 | No emoji/icon picker exists ANYWHERE (bare text inputs; canvas quick-action = `window.prompt`); Image IS wired to media picker but shows raw ID, no thumbnail | studio:6273,6331; prompt studio:7511-7516; media picker studio:6338-6342,6426-6436 | PARTIAL | P1 |
| S2-6 | Border-color swatches (= U8 part): `data-border-swatch` has ZERO JS references — nothing ever paints them, unconditionally (not a theme/data problem). Underlying border_color write+render DOES work for text-input types | studio:1967-1969; CSS studio:2680; wired sibling mechanisms studio:1512/6608 + 2183/6646 | DEAD (indicator) | P1 |
| S2-7 | "§8.5 tokenized layout props" rail = un-migrated v2.5 block (0 golden hits), gated on the WRONG axis: `buttonText` shown-inert for every type except its only consumer (ContinueButton — where it's hidden); `featureColor` consumed only by CategoryLabel (text variant — hidden there too); `iconColor` gated for exactly one type, dead elsewhere | studio:1974-1976,1496-1720; consumers presets:1620-1661,499; gate studio:2899-2903,5187-5188 | MISALIGNED | P1 |
| S2-8 | Leading icon (= U9) confirmed: `fieldLeadingIcon` special-cases only "location"; 11 options store-but-render-nothing, no visual feedback, canvas + runtime alike | presets:1330-1337; enum studio:1237-1250 | PARTIAL/DEAD | P1 |
| S2-9 | Jargon in RENDERED copy: 24 operator-visible §-strings (tooltips studio:1360-1368; labels 1876,1909-1923,2009,2025,2094; help 1884,1974,2153; checkbox 1896; summary 2098; badge 2242; aria 2138,2143) + the always-rendered "wrangler secret (GOOGLE_MAPS_BROWSER_KEY)" sentence studio:945 and "Legacy…§8.8/compat" studio:942,944. (525 total §: 453 code comments, 38 CSS comments, 10 HTML comments, 24 rendered) | cites listed | UX-BROKEN | P1 |
| S2-10 | "Provider values: 0/0 Offers" is wired but 0/0-by-construction until an Offer is selected AND its value map keys the literal choice value — reads as broken to operators | studio:3185-3207; handlers:848-883 | WIRED (UX gap) | P2 |
| S2-11 | setHeightPreset/setNodeCorners/setNodeBorderColor omit `applyCanvasDecoration()` (only width calls it) | studio:5615-5679 | PARTIAL | P2 |
| S2-12 | ADVANCED disclosure: fully wired incl. computed rename-consequence warning — the control-point that behaves correctly | studio:2069-2104,5373-5396,7940 | WIRED | — |

### S1 — canvas & selection/drag wiring (COMPLETE)

Structural facts: island = studio:2734-9827; canvas = `sandbox="allow-same-origin"` srcdoc iframe
(studio:1409); overlay is built INSIDE the iframe doc (no cross-frame offset math needed — ruled out,
as are zoom/scale/resize causes).

| # | Finding | Root cause (file:line) | Verdict | Sev |
|---|---------|------------------------|---------|-----|
| S1-1 | Overlay WIDTH wrong (= U1): selection wrap hardcoded `width:100%` of the field's original container, never the field's own (e.g. custom-px-narrowed) width; all overlay children position off the wrap's edges | `ensureSelectionWrap` studio:4459-4466; custom width rendered inline on the `<input>` by presets:1164-1206,1315-1320 | MISALIGNED | P0 |
| S1-2 | Overlay VERTICAL geometry wrong on EVERY selection: outline `top:-6px;height:66px`, handle rows at −11/19/49, tag at −30 — hardcoded px copied verbatim from the golden mockup's one demo field; real `.lg-input` (min-height 44px + 1rem padding) is far shorter. NO measurement exists: zero getBoundingClientRect/getComputedStyle feed the overlay — wrong by construction at first paint, every time | `buildHandle`/`decorateFieldSelection` studio:4582-4636; live CSS styles.ts:692-718 | MISALIGNED | P0 |
| S1-3 | 6 of 8 handles are DECORATION BY DESIGN (N, S, 4 corners): `pointer-events:none`, no listener — only the two mid E/W handles drag (in-code comment says "the other six are presentation"). Users see 8, expect 8 | studio:4586-4601,4628-4635 | DEAD (by design) | P1 |
| S1-4 | Height `{custom_px}`: schema-legal (content-schema:357), renderer-supported (presets:1164-1167), ZERO authoring path — no drag, no numeric input, no custom chip/reset (width has all three) | inspector height presets only: studio:1952-1954,5625-5633,7806-7809 | DEAD | P1 |
| S1-5 | Drag-to-move dead for the node users touch first (= U3): `applyCanvasDecoration` sets `draggable="false"` on the SELECTED field node (to protect width handles), and the studio AUTO-SELECTS the ZIP field on load → the focused node can never be canvas-dragged while selected | studio:4691; auto-select studio:9813,5025-5031 | MISALIGNED | P0 |
| S1-6 | Even unselected, text-input-family drag is unreliable with a REAL mouse: drag source is the bare `<input>` → native caret/text-selection arms instead of dragstart (synthetic dispatch bypasses this). Currency/Address (outer-div hosts) unaffected; containers/choice-cards drag fine; toolbar ↑↓ + keyboard arrows work | presets:132-147,1507-1537; onCanvasDragStart studio:7354-7367; working paths studio:1338-1339,7449-7450,7619-7620,3867-3906,4346 | PARTIAL | P1 |
| S1-7 | Inline editing DEAD for the entire input family incl. the default-selected ZIP field: their content_props are only placeholder/helper, `inlineEditKeyFor` checks text/label only; AND `onCanvasDblClick` calls `preventDefault()` BEFORE the support check → silent dead end (native dblclick suppressed, nothing offered). Works: headline/subheadline/category/helper, Continue label, choice labels | studio:7302-7322 (preventDefault :7308), 3493-3499, 469-509 | DEAD (input family) | P1 |
| S1-8 | Clicking (not dragging) a width handle SILENTLY DESELECTS the field: trailing native click bubbles; `closest('[data-question-id]')` from the handle (a SIBLING of the input inside the wrap) matches the parent container → `selectComponent(parentId)`. Exactly the occlusion class synthetic-dispatch tests never surface | finishUp no-op studio:4514,4526-4531; onCanvasClick studio:7251-7299 (:7298) | MISALIGNED | P1 |
| S1-9 | Inert duplicate listener set: full canvas listener map bound on the parent-doc `#lg-studio-canvas` (separate event root — can never see in-iframe events) in addition to the load-bearing iframe-doc set | studio:7463-7495,7242 | DEAD (inert) | P2 |
| S1-10 | All 145 canvas-decoration `createElement` calls use the PARENT document then insert into the iframe (implicit adoption) — works today, fragile | e.g. studio:4460,4587,4604,4622 vs canvasFrameDoc studio:4201-4214 | WIRED (fragile) | P2 |

### S3 — rules / offer mapping / Maps jobs (COMPLETE)

Tooling trap recorded: `api/src/public/leadgen/auction/engine.ts` contains a stray non-UTF8 byte —
plain `grep` misclassifies it as BINARY and silently returns zero matches (use `grep -a`). This
produced an initial false "answer-rule evaluator unwired" reading; corrected below. Any CI grep
gate over that file must use `-a`.

| # | Finding | Root cause (file:line) | Verdict | Sev |
|---|---------|------------------------|---------|-----|
| S3-1 | Rules source dropdown empty in the dominant case (= U7): `internalFieldsOf()` walks ONLY this section's components and excludes the selected node itself → new sections (seeded with only Headline/Subheadline) and single-question sections ALWAYS yield just "— always visible —", with no explanatory message. Server enforces the same section-only scope (`conditional_unknown_field`) — full-stack constraint, zero UX accommodation | studio:3688-3694,5995-6008,6117-6124; ui-sections.ts:735-742; content-schema:1925-1934 | PARTIAL (dead-end UX) | P0 |
| S3-2 | Operator dropdown shows raw codes eq/neq/gt/… — `options()` called with no labels; the human vocabulary ALREADY EXISTS in `conditionSentence` but isn't wired to the select | studio:1422-1425,1757; sentence :6159-6171 | UX-BROKEN | P1 |
| S3-3 | "Open full mapping →" (= U4): handler IS bound and fires — `setDrawerTab('mapping')` un-hides the BOTTOM DRAWER, a separate region below the fold, with NO scrollIntoView/focus → change is invisible from the Offers tab; unsaved sections additionally show only "Save the Section first…" | studio:7757-7758,7716-7734 | UX-BROKEN (perceptual no-op) | P0 |
| S3-4 | Rules round-trip (once a source exists) is FULLY WIRED: node.conditional → save → server validate → config-dto passthrough → runtime evaluateComponents → engine visibility/required. The chain can't START, but doesn't break | studio:9628; config-dto:230,238; runtime/dependencies.ts | WIRED | — |
| S3-5 | Maps "Validate the answer" job (= §9 row 1) is DECORATIVE: server leg `validateAddress` = ZERO callers (re-confirmed incl. attempt.ts, s2s-dispatch.ts, auction engine with -a); client 5-digit check runs UNCONDITIONALLY regardless of the checkbox; the flag only reaches the client at all when autocomplete is ALSO on (runtime/maps.ts:151), where it merely swaps an analytics beacon. The checkbox's own help copy describes behavior that happens anyway. Correct hook point: POST /lg/auction pre-payload, gated by `mapsJobsFor(node).validate` | maps.ts:114-153; sections-handlers:85,2189-2223; studio:5507-5510 | DEAD (server) / PARTIAL (client) | P0 |
| S3-6 | Maps "Use in auction rules" job fully DEAD: `deriveLocationFacet` zero callers AND `mapsJobsFor` doesn't even RETURN an `auction` field — nothing downstream can see the toggle. The answer-rule evaluator itself IS live (evaluateOfferRules/evaluateCarrierRules → runAuction engine.ts:1056) but consumes `{...request_context,...normalizedAnswers}` keyed by literal internal_field — never a facet | maps.ts:254-294; presets:1054-1073; studio:5501,5503; quotes-handlers:3120-3153; engine.ts:978-989,1056 | DEAD | P1 |
| S3-7 | Maps "Auto-complete": the autocomplete chain itself is FULLY WIRED (serve.ts:255-337 key splice → runtime/maps.ts:141-225 Places attach). But the promised sibling-fill ("fill city, state, street") is UNREACHABLE for all new content: the {enabled,jobs} shape never produces `fills`, `mapsConfigJson` (presets:1097-1107) DISCARDS a hand-authored fills object, and no fill-target picker exists — self-documented "FLAGGED contract gap" (studio:3723-3728,5490-5493) | cites listed | PARTIAL | P1 |
| S3-8 | Legacy global Maps toggle block: off-golden but NOT dead — `address_validation_enabled` still feeds serve.ts `funnelNeedsMapsKey` (:255-277) + sections-handlers `zipValidation` fallback (:2200-2213). Kept deliberately for the DB column (comment studio:880-883). Retire = migrate both readers to per-field precedence + drop column path | studio:942-946; serve.ts; sections-handlers | MISALIGNED (compat) | P2 |
| S3-9 | Drawer mapping pill hardcoded GREEN regardless of ratio (golden static "2/2" demo styling carried over) and never refreshed after edits. (Top-bar "Mapping k/n" chip is correctly guarded + live-updated — not a bug) | studio:2255 vs :793-802,8539-8562 | MISALIGNED | P2 |
| S3-10 | Offers list loads only at script init; post-save load works ONLY because save always hard-navigates. Fragile implicit dependency | studio:9161-9165,9819,9767-9771 | WIRED (fragile) | P2 |

### L5 — live real-input browser probe (COMPLETE)

Method: wrangler-dev + fresh D1, viewport 1800×1100, trusted input ONLY (`locator.click()`,
`page.mouse`) — zero `dispatchEvent`. Spec kept for reuse: `api/test-ui/forensic-live-probe.spec.ts`
(untracked). Raw verdicts: `api/test-results/forensic/verdicts.jsonl` + screenshots.

| Probe | Verdict | Evidence |
|-------|---------|----------|
| P1 select by real click | WORKS | 10 chrome els, 2 width handles, inspector follows |
| P2 overlay alignment | **MISALIGNED** | dx=−6 dy=−6 dw=+12 **dh=+16** px (field 452×54 vs outline 464×70) — confirms S1-1/S1-2 |
| P3 width-drag (E) | **HANG (harness)** | real `page.mouse` into the srcdoc iframe hangs at first move — CDP limitation; the OPERATOR's real mouse E/W drag works per their report. S/bottom handle: **DEAD** (0 interactive non-side handles — confirms S1-3) |
| P4 move field body | **HANG (harness)** + operator-confirmed broken (S1-5/S1-6 root causes stand) |
| P5 Continue inspector | **DEAD** | 0 Style controls; only `label` editable (label edit works) |
| P6 Buttons style presets | **DEAD (no-op)** | 6 clicks: height Small/Large + corners Sharp/Pill = ZERO effect; computed w/h/radius constant 452/148/4px — confirms S2-1 |
| P7 Open full mapping | WORKS at 1800×1100 | drawer panel opens (no network) — with S3-3: below-fold + no scroll cue = user-invisible on normal viewports |
| P8 rules author+persist | WORKS when another field exists | authored eq/true, persisted after reload; source list = self-excluded same-section fields — confirms S3-1 empty-case |
| P9 leading icon Calendar | **DEAD** | `props.icon:"calendar"` persists to D1; canvas render BYTE-IDENTICAL (0 svgs) — confirms S2-8 |
| P10 slider reflect | WORKS (canvas attrs min/max/step correct) | runtime binding still DEAD (S2-3); drag = HANG (harness) |
| P11 console | 1 unique benign message (srcdoc sandbox script-block during teardown only) |

**False-green pairings (proof of M1):** exactly 2 `dispatchEvent` clusters exist, both in
`test-ui/leadgen-section-studio.spec.ts`: :619 "§7.1.3 width handle" (synthetic MouseEvents at
:665-669; its own comment :643-657 ADMITS the CDP hang workaround) and :697 "§5.6 drag-insert"
(fabricated DataTransfer at :727/:734, comment :700-703). P2 is a count-existence gap (§6.2 test
:560 asserts 10 chrome els + 2 handles, never geometry). P9 has ZERO coverage.
**Harness fact:** real pointer streams cannot currently be driven into the srcdoc canvas at all —
the product must become real-input testable (e.g. src-URL canvas frame) before drag gates can exist.

## D. Remediation buckets (proposed — execution plan + operator approval required before any fix)

**W1 — Canvas interaction layer (P0):** measured overlay (getBoundingClientRect per decoration
pass; kill hardcoded 66px/−11/19/49 geometry) · wire height-drag on N/S handles + height custom
chip/reset (schema+renderer already support it) · un-break move (no blanket draggable=false on
selected; drag source off bare `<input>`) · fix handle-click deselection · inline-edit: no
preventDefault on unsupported types · cleanup (inert duplicate listeners, parent-doc createElement,
applyCanvasDecoration consistency).

**W2 — Inspector honesty (P0):** extend renderers so buttons/choices/cards CONSUME
size/corners/border (the operator's actual need: sizing buttons) + gate controls by consumption
elsewhere · real Continue-button controls or a real frame-edit path + fix dead "Open Quote Builder"
link · slider: `data-lg-input` runtime binding (answers actually record), step behavior, design pass
· ship the 11 missing leading-icon SVGs (or trim the enum) · paint border swatches · label the
choices grid columns + curated emoji/icon pickers + image thumbnail · remove/migrate the "§8.5
tokenized layout props" legacy rail.

**W3 — Perceptual dead-ends (P0/P1):** Open-full-mapping scrolls/highlights (or becomes a modal) ·
rules empty-state explanation + humanized operator labels (cross-section sources = explicit scope
decision) · drawer mapping pill guard · explicit loadOffers after save.

**W4 — Maps jobs made real (P0/P1):** validate job → `validateAddress` wired into POST /lg/auction
gated by `mapsJobsFor().validate` (needs operator-created GOOGLE_MAPS_SERVER_KEY; absent key stays
no-op) · auction job → `mapsJobsFor` returns `auction`, facet derived at answer-normalization,
merged into ruleContext · autocomplete sibling-fill authoring (or truthful copy) · retire the legacy
global toggle by migrating its two readers to per-field precedence.

**W5 — Golden fidelity + legacy purge (P0):** the `.studio-settings` grid→flex one-line fix ·
full-bleed studio route (drop admin sidebar/header/tabs on the editor — golden = Image8) [DECISION]
· remove legacy Maps fieldset, ballooning toolbar clusters (needed controls migrate into
inspector), Preview dev-console (remove or explicit QA toggle) [DECISION], Design-overrides 4th tab
· jargon purge (24 §-strings, wrangler-secret line, "legacy", raw op codes) · small chrome (No-issues
chip icon, Active pill, name width) · canvas typography to golden (Newsreader 31px/600) — CHANGES
LIVE FUNNELS [DECISION].

**W6 — Test harness overhaul (kills M1–M6):** make the canvas REAL-INPUT drivable (src-URL frame
instead of srcdoc, or equivalent) then replace both dispatchEvent clusters with real-gesture specs ·
effect-assertions (click ⇒ canvas HTML/computed-style changes) · overlay-geometry assertion (±4px) ·
CI jargon gate over rendered strings (grep -a; engine.ts non-UTF8 byte must be fixed) ·
golden-region allowlist gate (non-golden blocks fail) · legacy-shaped-content fixture axis ·
runtime answer-recording test per input component (slider class).

## E. REMEDIATION MISSION (approved 2026-07-13) — defect→phase map

**Phase status:** R0 **MERGED** (PR #109 → main @ 9cd252f, 2026-07-13; adversarial review SHIP
after 2 fix rounds). Rows closed by R0: S4-B1 (headline strip at golden proportions, two-rule fix)
+ the M1/M5/M6 gate primitives + engine.ts encoding + firefox gesture lane.
R1 (runtime answer integrity) **SHIP** (2026-07-14; adversarial review FIX-FIRST → both blockers
fixed in-phase → SHIP on independent re-verification). Rows closed: E1-NEW-1 (dropdowns record —
data-lg-input + engine chain), S2-3 (slider records + live value/fill; step honored), E1-NEW-4
(Yes/No default paints selected), E1-NEW-3 (count validation client AND server — server at the
normalizeAnswers seam after the reviewer refuted the conductor's deferral), E1-C1 (error_text
surfaces, XSS-safe: textContent client + <-escaped server config), E1-C2 (letters/digits
presets → anchored regex, client/server parity). Permanent gates added: catalog-enumerated
answer-recording matrix (70 tests), REAL POST /lg/auction round-trip with client-authentic string
answers (9 tests, F8-compliant), firefox real-input gesture spec (3 tests, E4 network-verified
beacon). Bundle 40,908/40,960 (52 B headroom — LIVE CONSTRAINT for R3/R4b). Suite: vitest
5,001/5,001 (358) · playwright 221 listed, 214 green + 7 gate-1c report-only (pixel ratio
byte-identical to R0's intended delta — zero drift from R1).

Plan: `~/.claude/plans/use-the-claude-design-mcp-elegant-alpaca.md` (post-roast v2 — adversarially
roasted; 4 blockers amended; wider-product seams verified). Phases:
R0 foundation → R1 runtime answers → R2 canvas → R3 inspector (48 types) → R4a pipeline UX →
R4b Maps e2e → R5 golden purge/shell/typography → R6 live matrix verify + close.

**Register corrections applied at step 0 (from the roast):**
- **S2-2 RECLASSIFIED:** the read-only Continue Style rows are CORRECT per contract §8.5b ("the
  frame owns them"; Quote Builder edit surface exists at ui-quotes.ts:1132-1133). The actual
  defects: the dead `href="#0"` "Open Quote Builder" link and the FAKE static values (should show
  real resolved role/placement). NO editable pickers will be added.
- **E2-NEW-6 AMENDED:** ContinueButton `loadingLabel` input is OUT-OF-CONTRACT (§8.4 lists only
  "Button label") — stays render-only; recorded as erratum, no new control.

### E.1 Wave-1 rows → phases
S1-1..S1-10 → R2 (S1-7: date fields excluded from placeholder inline-edit). S2-1 → R3 (WIRE
renderers + gate). S2-2 → R3 (as reclassified). S2-3 → R1. S2-4/S2-5/S2-6/S2-7/S2-8 → R3.
S2-9 → R5. S2-10 → R4a (explainer). S2-11 → R2. S2-12 control-point, no action. S3-1/S3-2/S3-3 →
R4a. S3-4 control-point. S3-5/S3-6/S3-7/S3-8 → R4b (S3-6 with facet precedence + collision tests;
S3-8 with per-field-wins e2e proof). S3-9/S3-10 → R4a. S4-A1/A2/A3 → R5. S4-A4 → R3.
S4-A5/A6 → R5 (QA toggle). S4-A7/A8/A9/A10/A11 (in-page overlay)/A12 → R5. S4-B1 → R0a.
S4-B2 → R5 (FULL deliverables: tokens+styles, A0 byte-pin fixtures `legacy-variant-preview.json`/
`legacy-shell.html`, `leadgen-frame-legacy-pin.test.ts`, Literata assertions
`leadgen-designs.test.ts:242-244`, 6 legacy-pin consumer files, 3-theme gate-1c re-pin
Navy/Bold Yellow/Minimal, staging screenshots). S4-B3 → R3. S4-B4/B5/B6 (visual alignment; iframe
kept, errata)/B7/B8 → R5. U1–U10 map onto the rows above; L5 P1–P11 = evidence baselines, re-run
in R6.

### E.2 E1 exhaustive answer-field matrix (20 types, ~205 controls, ~61 defects) → phases
| Row | Defect | Phase |
|---|---|---|
| E1-NEW-1 | Dropdown + SearchableDropdown never record answers (`<select>` lacks `data-lg-input`; engine gate engine.ts:630) | R1 |
| E1-NEW-2 | Choice editor: 9–12 dead fields/row for ButtonAnswerGroup/Dropdown/SearchableDropdown/OtherGroup; 7 for MultiChoice; 1–2 for card grids (shared ungated `buildChoiceRow`, studio:6273/6321-6409) | R3 |
| E1-NEW-3 | MultiChoice min/max selection count validated NOWHERE (array answers skip scalar branch, runtime/validation.ts:138-158; no server rule) | **R1 (client + server)** — the plan-assigned server file (`leadgen/validation.ts`) proved offer-config-only; real seam = `normalizeAnswers` (src/leadgen/answers.ts). Conductor initially deferred the server mirror to R4b; the R1 adversarial review REFUTED that deferral (scripted clients bypass min/max entirely; binding-plan violation) → delivered in R1's fix round with fail-before/pass-after through the real POST /lg/auction harness |
| E1-NEW-4 | TwoButtonYesNo default recorded (+beacon) but never shown — `component.choices!==undefined` guard, engine.ts:900-913 | R1 |
| E1-NEW-5 | Other-group enable/label/searchable dead for both dropdown types (renderers never call readChoiceDisplay) | R3 (hide) |
| E1-NEW-6 | Toolbar Placeholder quick-input dead for Range/CurrencyRange/NumberRange/TwoButtonYesNo/NameFieldsGroup | R3 (gate) |
| E1-NEW-7 | NameFieldsGroup inverted: only control (helper) dead; consumed firstLabel/lastLabel have no UI | R3 |
| E1-NEW-8 | Helper text advertised but never rendered for 7 choice/range types (fieldHelperLine only in text-input branch) | R3 (wire) |
| E1-NEW-9 | AddressAutocomplete leading icon fully dead (bespoke renderer never calls fieldLeadingIcon) | R3 |
| E1-NEW-10 | RangeQuestion unreachable from palette/toolbar (legacy-only authorable) | R3 (hygiene) |
| E1-C1 | error_text (custom "If it's wrong, say") never surfaces — validateValue hardcodes messages | R1 |
| E1-C2 | Pattern preset→regex translation unverified (letters/digits presets) | R1 (verify/fix) |
| E1-C3 | Style quad (size/height/corners/border) dead across ALL 20 answer types except 8 text-input family | R3 |
| E1-C4 | DateQuestion placeholder control is a browser no-op | R3 (hide) + R2 (inline-edit exclusion) |
| E1-C5 | ImageCardAnswerGrid reachable only via Cards→"Image" swap, no discoverability | R3 (hint) |
| E1-C6 | Phone `format` prop: registry-documented, zero readers/writers | R3 (catalog hygiene) |
| E1-C7 | OtherGroupSelector has full renderer + label but no tile/swap path (BAG's own Other-group branch supersedes) | R3 (hygiene note) |
| E1-C8 | Required/When-answered shown for AutoAdvanceButton (produces:null) | R3 (gate Behavior to produces!==null) |

### E.3 E2 exhaustive content/container/frame matrix (28 types, ~189 cells, ~74 defects) → phases
| Row | Defect | Phase |
|---|---|---|
| E2-NEW-1 | ImageBlock unusable: empty seed → invisible render (presets:2002-2019); logoMediaId bare text, no picker; `source`/`alt` have NO controls (self-documented, studio:337) | R3 |
| E2-NEW-2 | DisclosureLink writes `props.html`, renderer reads `panelHtml` (presets:458) and schema requires `panelHtml` (content-schema:665) — edits discarded + guaranteed save error | R3 |
| E2-NEW-3 | HeaderLogo's only control (logoMediaId) never used — `<img src>` = branding logoUrl (frame.ts:243,252) | R3 (strip w/ notice) |
| E2-NEW-4 | `rewriteRetiredNodeToPrimitive`/`primitiveViewOfNode` (content-schema:1302-1346) ZERO call sites — §5.3 migration never wired (scope: LogoStrip + 5 text roles) | R3 (wire at save seam) |
| E2-NEW-5 | Rules tab on TextBlock/CategoryLabel/HelperText/LegalNote violates contract §8.2 row "…Text → Content·Style" | R3 |
| E2-NEW-6 | loadingLabel consumed (presets:1615), no input | R3 — AMENDED: no input (out-of-contract); erratum |
| E2-NEW-7 | Style quad + 5 Design-panel rows dead-by-construction across 21 non-answer types | R3 |
| E2-NEW-8 | HeaderBar/FooterBar/TrustBar/LogoStrip/StepIndicator/ProgressBar/HeaderLogo/BackButton/DisclosureLink editing is production-inert (frame.ts synthesizes its own chrome, :16-19,224-483) | R3 (strip + deep link) + R6 (double-chrome fixture) |
| E2-NEW-9 | Spacer `variant` (gap/line) unreachable post-insert; Spacer's toolbar layout cluster renders EMPTY | R3 + R2 |
| E2-NEW-10 | Advanced internal_field enabled on the 5 containers → guaranteed `container_answer_field_forbidden` save error, zero client warning | R3 (disable) + R4a (computeIssues mirror) |
| E2-C1 | featureColor (text color role) dead on QuestionHeadline/Subheadline/HelperText/LegalNote + 6/7 TextBlock roles | R3 — WIRE per §8.5b (direction corrected by roast) |
| E2-C2 | TextBlock empty seed (no default role/text) | R3 |
| E2-C3 | HeaderBar/LogoStrip raw-id media inputs; content-shaped props living in Style tab | R3 (pickers for legacy fidelity; IA moot where stripped) |
| E2-C4 | BackgroundPanel unreachable (no tile; frame-scope) | R3 (strip) |
| E2-C5 | ValidationError static-fallback semantics unclear to operators | R3 (copy) |
| E2-C6 | 25 tab-set gaps where the contract's §8.2 matrix is silent | R3 consumption-gating + errata |

### E.4 E3 section-level surfaces (10 surfaces, 110 controls, 15 defects) → phases
| Row | Defect | Phase |
|---|---|---|
| E3-NEW-1 | New-section first save silently discards `problems[]` (studio:9762-9769 unconditional redirect) | R4a |
| E3-NEW-2 | Live validation (`computeIssues` studio:3964-4037) mirrors ~7 of 29 server codes — "No issues" false all-clear | R4a |
| E3-NEW-3 | Hard save failure: generic banner + bare outline, no `fields[key]` message text (studio:9748-9752,9705-9713) | R4a |
| E3-NEW-4 | Maps tab "Open auction rules →" → nonexistent `/admin/leadgen/rules` (studio:2054; real = `/admin/leadgen/auction`, ui.ts:244-249) | R4a (+ many-funnel disambiguation) |
| E3-NEW-5 | (= E2-NEW-4 migration dead code; contradicts old traceability row 5 "PASS") | R3 + R6 traceability correction |
| E3-NEW-6 | Themes cannot be renamed (server PATCH supports; no UI input; tm:457) | R4a |
| E3-NEW-7 | Canvas Delete: no confirm, sits under auto-selected node (studio:7625) | R4a |
| E3-NEW-8 | (= E3-NEW-2) | R4a |
| E3-NEW-9 | Archive (studio:9783-9788 + sec-ui:262-267) never checks `response.ok`; confirm promises Reactivate which doesn't exist | R4a (investigate server unarchive; else truthful copy) |
| E3-NEW-10 | Offer-mapping overlay toggle in Preview tab repaints the CANVAS (studio:2135 vs 7760-7768) | R4a (relocate) |
| E3-S1 | Row "Usage" = native `window.alert()` (sec-ui:269-277) | R4a (inline panel) |
| E3-S2 | "Google Maps: connected" chip = global browser-key presence only; label overclaims | R4b (accurate label) |
| E3-S3 | Preview dependency-JSON: invalid JSON silently swallowed to `{}` (studio:8049-8055) | R4a (surface error; applies behind QA toggle) |
| E3-S4 | `renderZeroOffersWarning` uses stale pre-save `offersData` (studio:9637-9647) | R4a |
| E3-S5 | "+New" activity/vertical skip `renderOffersStaleNote()` (studio:8281-8288) | R4a |
| E3-S6 | (= S3-9 drawer pill) | R4a |
| E3-S7 | FooterBar links rows silently dropped on bad format (no client href hint) | R4a |

### E.5 Seam scout (wider product) → phases
| Row | Defect | Phase |
|---|---|---|
| SEAM-1 | Theme `base_px`: validated (themes-handlers:109-129), threaded (theme.ts:645), ZERO consumers — dead theme feature | R5 (wire consumer) |
| SEAM-2 | Quote Builder `mobile.*` frame group (hide_footer/progress_position/logo_size/trust_strip_mobile) has NO UI anywhere | SURFACED — operator decision (pre-existing, outside v3.1) |
| SEAM-3 | `back.history_fallback`: validated/rendered/consumed, no toggle anywhere | SURFACED — operator decision |
| SEAM-4 | `continue_style_role` picker has a single legal value (`FRAME_CONTINUE_STYLE_ROLES=["button_primary"]`) — functionally inert control in the quotes UI | SURFACED — operator decision |
| SEAM-5 | Continue button SIZE key doesn't exist product-wide (`FrameSectionSlotConfig`) | R3 displays "Medium (fixed)"; new feature = operator decision |

### E.5b R0 evidence outcomes (decide-by-evidence results recorded per plan)
- **Src-URL canvas frame FALSIFIED (R0a):** serving the canvas frame from a same-origin `src` URL
  instead of `srcdoc` does NOT fix the real-drag hang — chromium/CDP hangs at the 2nd `mouse.move`
  identically (it is a CDP + nested-iframe limitation, not an srcdoc property). Product change
  reverted; `srcdoc` kept. **The proven enabler is a non-CDP engine: a REAL `page.mouse`
  down→move×3→up width-drag COMPLETES under Playwright Firefox against the unchanged srcdoc frame
  (r0a-drag-spike.spec.ts: 1 passed, 7.9s; snapped/clamped custom_px badge + width change
  asserted).** Consequence: all R2/R6 real-gesture gates run on a scoped `firefox` Playwright
  project; local envs need `npx playwright install firefox`; CI unaffected (runs no Playwright).
- **S4-B1 diagnosis AMENDED (was "one-rule bug"):** the headline collapse had TWO CSS causes —
  the `.studio-settings` 2-col grid AND `#lg-section-form` being a non-wrapping flex row (its
  `flex-basis:100%` spacer + legacy fieldset consumed the line, collapsing the `flex-basis:0`
  headline to 48px min-content). Fix = grid→flex-column + `flex-wrap:wrap` on the form; headline
  asserted >400px at 1760 viewport. Both CSS-only, markup untouched.
- **engine.ts stray byte (R0b):** was a raw NUL used as the `contextByOfferPlacement` composite-key
  separator (engine.ts:885) — NOT a comment. Fixed as the `\0` escape (runtime string
  byte-identical; source valid UTF-8; `cat -v` diff `^@` → `\0`). First conductor fix-round catch:
  the initial space substitution would have changed auction-engine runtime behavior.
- **Gate baselines measured (R0b):** jargon scan TOTAL=38 (§=24, legacy=11, wrangler=1,
  GOOGLE_MAPS=1, raw op codes=1) — report-only until R5. Golden-region blocks=31 (22 golden / 9
  legacy / 0 unclassified).
- **R0 adversarial review (fresh Opus): FIX-FIRST → fixes applied in-phase.** Blocking: (1)
  jargon-scan missed a rendered § written as `§` (studio:9162 renders "(§8.2)" via
  textContent) — decoder added, TOTAL 38→≥39; (2) `assertEffect` passed VACUOUSLY on an
  all-`undefined` expected map (Object.keys length ≥1 but every value skipped → zero expects) —
  defined-keys guard added. Verified SOLID by the reviewer's own hand: Firefox drags are genuinely
  hit-tested (occluded handle would fail; no force/elementHandle/dispatchEvent), P3 width-drag
  WORKS + P10 slider-drag WORKS + P4 move honestly DEAD in verdicts.jsonl, engine.ts runtime
  byte-identity, S4-B1 strip now matches golden proportions (flex 1.5/1.2 row; no mobile-behavior
  loss), 16.44% gate-1c delta attributable only to the intended reflow, boundaries clean.
- **⚠ R5-ARMING REQUIREMENT (review finding 3, MUST land when golden-allowlist goes --strict):**
  a `golden:false` block that VANISHES from detection (rename/inline) currently degrades to an
  informational STALE entry — `--strict` must also FAIL on a stale `golden:false` entry (a tracked
  non-golden block leaving detection without being purged), and the two MIXED blocks
  (`renderStudioSettings`, `sectionEditorHtml`) must be split for per-region classification.

### E.5c R0 conductor gate ritual (own hand, post-both-slices)
tsc 0 · vitest **4,927/4,927 (355)** · verify:all PASS (runtime bundle byte-identical, 40,044 =
97.8%) · jargon report-only **38** (= baseline) · golden-regions 30 blocks / 21 golden / 9
documented non-golden / 0 unclassified / 1 stale entry (leftover from the reverted spike route —
queued for the R0 fix round) · Playwright sharded 73+78+67 = 218: **211 green; gate-1c file
REPORT-ONLY per plan** (state 1 failed at 16.44% pixel delta = the INTENDED S4-B1 headline-strip
fix; states 2–7 serial-blocked behind it; file re-pins + ARMS in R5) · firefox project: 13 gesture
tests ran with ZERO hangs (drag probes now complete and record verdicts).

### E.6 Mission baselines (recorded at step 0, branch remediation/r0-foundation @ 475d514)
- typecheck: 0 errors · Playwright `--list`: **217 tests / 31 files** (205 prior + 12 forensic probes) · vitest: **4,927/4,927 (355 files, 93s)** · runtime bundle: verify gate cap 40,960 (last measured 40,044).

---

Operator decisions — RESOLVED 2026-07-13 (AskUserQuestion round):
1. Typography: **YES — match the approved design** (Newsreader 31px/600); live funnels change; staging screenshots before deploy.
2. Studio shell: **full-bleed per approved design** (admin sidebar/header/tabs hidden on the editor route).
3. Maps server key: **YES — wire the real server validation leg** (operator creates GOOGLE_MAPS_SERVER_KEY, restricted to Geocoding/Address Validation APIs; leg no-ops while absent).
4. Preview dev-console: **keep behind an explicit "QA tools" toggle** (hidden by default), NOT removed.
Still plan-scoped (my recommendation, no consent needed): cross-section rule sources deferred (same-section + clear empty-state hint now); "position" = flow-based (order + alignment + sizing), never freeform x/y — the approved design has no free positioning.
