# LEADGEN R2 — Phase P6 Terminal Full Browser Battery

Measurement-only run of every `api/test-ui/*.spec.ts` file (90 files; `*-seed.ts` are
helpers, not specs). Port 8901 (never 8787). All 90 files were run; none were skipped at
the file level. Sequence used: `npm run db:reset:local` → `npx wrangler dev --port 8901
--ip 127.0.0.1 --var DEV_BYPASS_AUTH:true --var ADMIN_HOST:127.0.0.1` (background, waited
for `/health` 200) → `npm run seed:leadgen-fixture` → `PW_PORT=8901 npx playwright test
<files> --workers=1 --reporter=list`.

- The 66 non-`*.gesture.spec.ts` files ran in 11 batches of 6 (one `db:reset` + seed cycle
  covering all 66, per the dispatch's operational notes — gesture files mutate state,
  non-gesture files don't need per-file resets).
- Each of the 24 `*.gesture.spec.ts` files got its own full `db:reset:local` → wrangler
  restart → reseed → solo run, per the dispatch's mutation-isolation rule.
- **Counting method**: Playwright's own printed summary line under-counted by 1 in one
  run (batch `ae`: raw ✓/✘/`-` marks = 21/16/4 = 41, but the printed summary said "3 did
  not run" = 40). All counts in this report are from raw per-test ✓/✘/`-` marks, cross-
  verified against `npx playwright test --list`'s per-file/per-project discovered counts
  (zero mismatches across all 90 files after the fix).

## Grand totals

- **Files run: 90/90.** Files fully clean (0 failures): **50**. Files with ≥1 failure: **40**.
- **Tests: 626 passed / 803 discovered.** Failed: **108**. Skipped-or-did-not-run: **69**
  (mix of deliberate `test.skip()` — e.g. firefox can't drive a dynamic `*.e2e.test` host —
  and serial-mode cascade-skips after an earlier failure in the same file; both are broken
  out per-file below where material).
- 803/803 accounted for (626+108+69) — matches `playwright test --list`'s "Total: 803
  tests in 90 files" exactly. No file was HUNG; one gesture file
  (`leadgen-round4-quotes-acceptance.gesture.spec.ts`) ran long (5.6m, ~21s/test ×18) and
  was moved to background by the tool's 300s cap, then completed normally — not a hang.

## Per-file table

`tests passed/discovered` · duration · status. `(N skip/dnr)` marks files where some of
the discovered tests were skipped or didn't run (deliberate `test.skip()` or cascade).

| File | passed/discovered | duration | status |
|---|---|---|---|
| `__p1a-studio.spec.ts` | 8/8 | 4.2s | PASS |
| `__p1b-render.spec.ts` | 6/6 | 2.9s | PASS |
| `__p1d-lists.spec.ts` | 13/15 | 2.8s | FAIL |
| `__p2b-phone.spec.ts` | 0/4 | 0.0s | FAIL |
| `__p2c-studio.spec.ts` | 7/7 | 4.2s | PASS |
| `__p3a-pages.spec.ts` | 0/5 (4 skip/dnr) | 0.0s | FAIL |
| `__p3b-structure.spec.ts` | 0/2 | 41.7s | FAIL |
| `__p4a-routing.spec.ts` | 1/1 | 0.8s | PASS |
| `__p4b-rules.spec.ts` | 0/3 | 11.3s | FAIL |
| `__p5a-frame.spec.ts` | 0/10 (7 skip/dnr) | 0.0s | FAIL (isolation: 10/10 PASS — see Findings, HARNESS) |
| `__p5b-quotes-ia.spec.ts` | 1/7 (1 skip/dnr) | 1.4m | FAIL (isolation: 1/7, reproduces) |
| `__p5c-assets.spec.ts` | 0/4 | 0.1s | FAIL (isolation: 3/4 — 1 real, 3 were HARNESS) |
| `__p6a-theme.spec.ts` | 0/3 (2 skip/dnr) | 0.0s | FAIL |
| `__p6b-theme-mgr.spec.ts` | 3/8 | 2.6m | FAIL |
| `admin-routing-security.spec.ts` | 3/3 | 0.0s | PASS |
| `admin-ux-parity.spec.ts` | 10/10 | 6.2s | PASS |
| `domains-create-site.spec.ts` | 1/1 | 0.6s | PASS |
| `forensic-live-probe.spec.ts` | 26/26 | 45.6s | PASS |
| `leadgen-canvas-interactions.gesture.spec.ts` | 10/10 | 10.6s | PASS |
| `leadgen-canvas-script-inertness.spec.ts` | 1/1 | 0.7s | PASS |
| `leadgen-ga4.spec.ts` | 0/4 (3 skip/dnr) | 0.0s | FAIL |
| `leadgen-live-funnel.spec.ts` | 10/10 | 15.0s | PASS |
| `leadgen-nav.spec.ts` | 2/2 | 0.8s | PASS |
| `leadgen-offers-mgmt.spec.ts` | 6/6 | 4.3s | PASS |
| `leadgen-offers.spec.ts` | 5/6 | 36.5s | FAIL (isolation: 5/6, reproduces) |
| `leadgen-operator-acceptance.gesture.spec.ts` | 24/24 | 21.5s | PASS |
| `leadgen-p1-geometry.gesture.spec.ts` | 10/16 (3 deliberate skip) | 5.1s | FAIL |
| `leadgen-p1c-editor-chrome.spec.ts` | 4/5 | 1.8s | FAIL (isolation: 4/5, reproduces) |
| `leadgen-p2a-element-freedom.gesture.spec.ts` | 20/22 (1 deliberate skip) | 12.6s | FAIL |
| `leadgen-p3-fixround-footer.gesture.spec.ts` | 8/8 | 19.2s | PASS |
| `leadgen-p3a-placement.gesture.spec.ts` | 18/28 (5 deliberate skip) | 17.2s | FAIL |
| `leadgen-p4a-behavior.spec.ts` | 0/3 (1 dnr) | 0.0s | FAIL |
| `leadgen-p4b-validation.spec.ts` | 1/14 (1 deliberate skip) | 4.2s | FAIL |
| `leadgen-p4c-rules.gesture.spec.ts` | 4/8 (2 dnr) | 4.1s | FAIL |
| `leadgen-p4d-editor.gesture.spec.ts` | 12/12 | 11.2s | PASS |
| `leadgen-patterns-v25.spec.ts` | 10/10 | 20.0s | PASS |
| `leadgen-payload-builder.spec.ts` | 6/6 | 4.7s | PASS |
| `leadgen-perf.spec.ts` | 0/3 (2 dnr) | 0.0s | FAIL |
| `leadgen-quote-builder.spec.ts` | 10/10 | 9.2s | PASS |
| `leadgen-r2p1-fixround-smoke.spec.ts` | 2/2 | 7.4s | PASS |
| `leadgen-r2p4-drag-recordings.spec.ts` | 5/5 | 18.7s | PASS |
| `leadgen-r2p4-fixfirst-drive.spec.ts` | 0/3 (2 dnr) | 4.0s | FAIL (isolation: identical, reproduces) |
| `leadgen-r2p4-fixround2-drive.spec.ts` | 5/5 | 25.0s | PASS |
| `leadgen-r2p4-s4b-slider-drive.spec.ts` | 7/7 | 14.4s | PASS |
| `leadgen-r2p4-slider-drive.spec.ts` | 6/6 | 10.9s | PASS |
| `leadgen-r2p4-thumbnail-fix-drive.spec.ts` | 2/2 | 1.2s | PASS |
| `leadgen-r2p5-payload-seam-drive.spec.ts` | 5/5 | 15.2s | PASS |
| `leadgen-r2p5-s5c-drive.spec.ts` | 4/4 | 2.1s | PASS |
| `leadgen-r3a-effects.gesture.spec.ts` | 19/19 | 22.3s | PASS |
| `leadgen-r3b-effects.gesture.spec.ts` | 7/7 | 5.9s | PASS |
| `leadgen-r4a-pipeline.spec.ts` | 7/9 | 10.9s | FAIL |
| `leadgen-r4b-maps-tab.spec.ts` | 0/1 | 0.5s | FAIL |
| `leadgen-r5-fullbleed-nav.spec.ts` | 8/8 | 3.0s | PASS |
| `leadgen-r5-staging-signoff.spec.ts` | 2/2 | 1.7s | PASS |
| `leadgen-r6-activation-preflight.spec.ts` | 1/1 | 0.5s | PASS |
| `leadgen-r6-legacy-boot.spec.ts` | 1/1 | 0.3s | PASS |
| `leadgen-rework-acceptance-builder.gesture.spec.ts` | 21/24 | 1.7m | FAIL (rerun: identical 21/24) |
| `leadgen-rework-acceptance-components.gesture.spec.ts` | 28/28 | 15.3s | PASS |
| `leadgen-rework-acceptance-inputs.gesture.spec.ts` | 21/22 | 8.0s | FAIL |
| `leadgen-rework-acceptance-routing.gesture.spec.ts` | 27/34 | 1.5m | FAIL |
| `leadgen-rework-p2-studio.gesture.spec.ts` | 8/10 | 12.4s | FAIL |
| `leadgen-rework-p3b-board.gesture.spec.ts` | 30/32 | 15.7s | FAIL |
| `leadgen-rework-p3b-rules.gesture.spec.ts` | 16/16 | 8.6s | PASS |
| `leadgen-rework-p4-templates.gesture.spec.ts` | 6/8 | 35.3s | FAIL |
| `leadgen-rework-p4-themes.gesture.spec.ts` | 10/12 (2 deliberate skip, unit-covered) | 3.7s | PASS |
| `leadgen-round4-acceptance.gesture.spec.ts` | 17/18 | 18.9s | FAIL (rerun: identical 17/18) |
| `leadgen-round4-funnel-acceptance.gesture.spec.ts` | 7/8 | 34.3s | FAIL |
| `leadgen-round4-quotes-acceptance.gesture.spec.ts` | 2/18 | 5.6m | FAIL |
| `leadgen-runtime-inputs.gesture.spec.ts` | 3/3 | 2.5s | PASS |
| `leadgen-runtime-v25.spec.ts` | 0/6 (5 dnr) | 0.0s | FAIL |
| `leadgen-runtime.spec.ts` | 0/3 (2 dnr) | 0.0s | FAIL |
| `leadgen-section-builder.spec.ts` | 9/9 | 6.1s | PASS |
| `leadgen-section-studio.spec.ts` | 21/21 | 11.2s | PASS |
| `leadgen-studio-patterns.spec.ts` | 19/19 | 42.2s | PASS |
| `leadgen-theme-manager.spec.ts` | 0/11 (10 dnr) | 0.0s | FAIL |
| `leadgen-u11u12-move-chromium-attempt.spec.ts` | 0/1 | 1.0s | FAIL (isolation: identical) |
| `leadgen-u11u12-move.gesture.spec.ts` | 10/12 | 11.3s | FAIL |
| `leadgen-v31-gate1c-baselines.spec.ts` | 0/7 (6 dnr) | 1.2s | FAIL |
| `leadgen-v31-gate4-behavior.spec.ts` | 3/3 | 2.6s | PASS |
| `leadgen-visual.spec.ts` | 8/10 | 4.4s | FAIL |
| `listicles-analytics-mirror.spec.ts` | 2/2 | 0.2s | PASS |
| `listicles-articles.spec.ts` | 6/6 | 5.2s | PASS |
| `listicles-manual-qa.spec.ts` | 0/11 (10 dnr) | 0.0s | FAIL (isolation: 11/11 PASS — HARNESS) |
| `listicles-offers.spec.ts` | 4/4 | 4.2s | PASS |
| `listicles-perf-regression.spec.ts` | 4/4 | 2.3s | PASS |
| `listicles-render.spec.ts` | 7/7 | 5.9s | PASS |
| `listicles-sections.spec.ts` | 5/5 | 5.3s | PASS |
| `listicles-tracking.spec.ts` | 5/5 | 5.9s | PASS |
| `listicles-visual.spec.ts` | 5/5 | 3.9s | PASS |
| `r0a-drag-spike.spec.ts` | 1/1 | 2.3s | PASS |

## Findings

### Root-cause patterns (STALE SPEC) — explain the large majority of the 108 failures

**P1 — "mandatory shared page" activation gate (dominant cause, ~50+ of 108 failures).**
`quotes-handlers.ts` `computeReworkActivationProblems` (introduced by commit `80273cc`
"P1 wave 2: resolver re-axis (§4.3-1..15)... repo-wide test currency") hard-blocks `PUT
.../activation/:site_id` with 409 `activation.shared_page: "The shared first page needs
at least one section."` whenever a quote's shared page has 0 sections. Many legacy test
fixture helpers (`createQuote`, `seedFunnel`, `seedActivatedFunnel`, `seedPhoneFunnel`,
`seedP3aFunnel`, etc., across `__p1d-lists`, `__p2b-phone`, `__p3a-pages`, `__p6a-theme`,
`leadgen-ga4`, `leadgen-p4a-behavior`, `leadgen-p4b-validation`, `leadgen-perf`,
`leadgen-runtime`, `leadgen-runtime-v25`, `leadgen-p2a-element-freedom.gesture`,
`leadgen-p3a-placement.gesture`, `leadgen-p4c-rules.gesture`) create a bare quote/funnel
with no shared-page section, then call activation and expect 2xx — deterministic 409 every
time. Evidence: identical `quote_activation_blocked`/`activation.shared_page` JSON body in
every listed failure's stack trace.

**P1b — same concept, client-render symptom.** `openEditor()`'s canvas check
(`#lg-preview-iframe` → `[data-frame-region='section_slot']`) never renders for the same
bare-fixture quotes (`__p5b-quotes-ia.spec.ts` 5 fails, `__p6b-theme-mgr.spec.ts` 5 fails,
`leadgen-round4-quotes-acceptance.gesture.spec.ts` **16 of 18** fails — every test past
Item 10A calls `openEditor`). `data-frame-region="section_slot"` is a currently-valid,
documented region name (`frame.ts` header comment); the gap is fixture completeness, not a
removed selector.

**P2 — retired rule types (migration 0048, "Rework M3/D5 §5-M3").**
`FUNNEL_RULE_TYPES` in `quotes-handlers.ts` is now exactly
`[redirect_direct_offer, eligibility, disqualification, auction_entry]`; comment: "Routing
... moved to the quote-scoped `leadgen_quote_routing_rules` table; skip_section/show_section
are no longer persisted here." `__p1d-lists.spec.ts`'s rule-attach test PUTs
`rule_type:"skip_section"` → 400.

**P3 — P3b board rewrite deleted the old structure panel (§10/§8.9 S5.3).**
`quotes-tabs/funnel.ts` own comment: "REMOVED: the dead Round-4 'structure panel' island
... its DOM is SSR'd NOWHERE since the P3b board rewrite (0 id=lg-section-list /
id=lg-slot* renders)." `__p3b-structure.spec.ts` (`#lg-structure-panel`, 2 fails) and
`__p4b-rules.spec.ts` (`#lg-routing-rules-root`, 3 fails) target the removed DOM.

**P4 — kebab menu portals to `<body>` (S2.4 admin-UI fix, `ui-offers.ts`).**
`ui-offers.ts` comment: "kebabMenuScript fixes this by reparenting the open menu to
`<body>` + position:fixed". `leadgen-offers.spec.ts`'s archive test uses
`row.locator('[data-offer-archive]')` (row-scoped) — the button is reparented out of
`row` once the menu opens, so it never resolves. `__p1d-lists.spec.ts`'s own comment
already documents this exact gotcha for quotes and works around it; this offers test
predates the same fix landing there.

**P5 — `.studio-choice-ghost` renamed (Rework §6.1).** `ui-section-studio.ts`:
"Rework §6.1 (#1/#3/#9): the '+ Add choice' ghost is a SIBLING row... `ghost.className =
'studio-add-ghost-btn'`" — the class is no longer `studio-choice-ghost`.
`leadgen-p1c-editor-chrome.spec.ts` queries the retired class (1 fail).

**P6 — "No Offers exist yet" gate: native `confirm()` → custom modal (R2 P2 FIX-FIRST
MINOR-3).** `ui-section-studio.ts`: "the studio's OWN two-button modal instead of the raw
browser dialog it used to be." `leadgen-r4a-pipeline.spec.ts`'s `page.on('dialog',...)`
only answers native dialogs; the custom `#lg-no-offers-confirm-modal` sits open and blocks
the next click for the full 60s timeout (1 fail).

**P7 — Usage-panel copy gained a clause.** Same rework's shared-page concept: actual text
is `"Not used by any funnel variant, shared page, or rule."`; `leadgen-r4a-pipeline.spec.ts`
asserts the pre-rework `"...variant or rule."` (1 fail, exact diff captured in the raw log).

**P8 — Maps-fill picker "Create default field" option (Round-4 A-6/P1a deliverable 9c).**
`ui-section-studio.ts` line ~8666: when a fill slot is unset, an extra
`Create "{base}_{slot}"` option is injected. `leadgen-r4b-maps-tab.spec.ts` asserts the
picker has exactly `['', 'city', 'state']`; actual is `['', 'zip_city', 'city', 'state']`
(1 fail).

**P9 — single-active-variant gate (Rework M1, §4.3-10).** `quotes-handlers.ts`:
"'with no running test a funnel has exactly one active variant.' A second active variant
is legal ONLY as an arm of a running A/B test." `leadgen-theme-manager.spec.ts`'s
`ensureThemesFixture()` unconditionally POSTs a 2nd variant → 409, cascading 10 of 11 tests
to not-run (1 fail + 10 dnr).

**P10 — frozen visual baselines predate the rework.** `leadgen-v31-gate1c-baselines.spec.ts`
diffs against `test-ui/__screenshots__/leadgen-v31-gate1c/*.png`, committed at `b8c302e`
(Jul 21) — before `80273cc` (Jul 22) and the P2/P3b/§6.1 UI changes above; ratio 0.034 vs
budget 0.001 (1 fail + 6 dnr on subsequent states, same describe). `leadgen-visual.spec.ts`
diffs against `test-ui/__screenshots__/leadgen-runtime-{desktop,mobile}.png` (committed Jul
24, `fc6e84c5`, height 1940px); current full-page render is 1899px — `pixelDiffRatio`
returns the literal sentinel `1` on any width/height mismatch (`if (ia.width!==ib.width ||
ia.height!==ib.height) return 1`), not a real 100%-different pixel count (2 fails).

**P11 — `.lg-board-left` reused by two unrelated panels.** `quotes-tabs/funnel.ts:259`
(`data-pin="8.2-left-library"`) and `quotes-tabs/themes.ts:263`
(`data-pin="r2-theme-chooser"`) both stamp class `lg-board-left` on their own left rail.
Both tab panels co-exist in the DOM, so `page.locator(".lg-board-left")` is a strict-mode
violation (2 elements). Affects `leadgen-rework-acceptance-routing.gesture.spec.ts` (item 1
of 7 fails) and `leadgen-rework-p3b-board.gesture.spec.ts` (both its fails).

**P12 — "Set as default" renamed (R2 D5, contract §7 D5, owner ruling A.1
#11-D/ADJ-B2).** `quotes-tabs/templates.ts`: "'Set as default' is now PER-QUOTE... " —
actual button text is `"Set as this quote's default"`. `leadgen-rework-acceptance-
builder.gesture.spec.ts` and `leadgen-rework-p4-templates.gesture.spec.ts` both filter on
the old exact substring `"Set as default"` (1 fail each, 30s timeout).

**P13 — test-code bug duplicated across sibling files (not a product issue).**
`leadgen-rework-acceptance-builder.gesture.spec.ts`'s own header comment documents and
fixes `page.waitForRequest((r)=>...&&r.request().method()===...)` → `r.method()` ("Request
has NO `.request()` method... Fix: `r` IS the Request"). The identical buggy line
(`r.request().method()`) is still present, unfixed, in
`leadgen-rework-p4-templates.gesture.spec.ts:164` → `TypeError: r.request is not a
function` (1 of that file's 2 fails).

**P14 — port hardcoded to 8899 in one file (ENVIRONMENT, isolated).**
`leadgen-p1-geometry.gesture.spec.ts` lines 469/612/687 do
`page.goto(\`http://${host}:8899/...\`)` literally; its own header documents the
convention as `PW_PORT=8899 npx playwright test ...`. Under my assigned port 8901 these 3
`chromium` legs get `net::ERR_CONNECTION_REFUSED` regardless of server health (the other
7 tests in the file, and the studio-canvas legs of these same 3, pass normally).
`grep -rl ":8899" test-ui/` returns only this one file — not systemic.

### HARNESS/FLAKE (proven via isolation re-run, per the dispatch's required method)

- **`__p5a-frame.spec.ts`**: batch run 0/10 (3 failed `EADDRNOTAVAIL 127.0.0.1:8901` on
  `apiRequestContext.post`, 7 cascade-skipped). Isolation re-run: **10/10 passed, 15.9s**
  (`p6-isolation-p5a.log`). Local connection/port pressure under sustained batch load.
- **`__p5c-assets.spec.ts`**: batch run 0/4 (all 4 `EADDRNOTAVAIL`). Isolation re-run:
  **3/4 passed** (`p6-isolation-p5c.log`) — 3 were the same harness class; the 4th now
  fails on a *different*, real error: `activation HTTP 409: quote_activation_blocked
  ...activation.shared_page` (this one folds into P1 above, not a flake).
- **`listicles-manual-qa.spec.ts`**: batch run 0/11 (`Command failed:
  npx wrangler d1 execute ... ERROR database is locked: SQLITE_BUSY` — the test's own
  `d1Local()` helper spawns a **separate** `wrangler d1 execute --local` CLI process
  against the same sqlite file the running `wrangler dev` already holds open). Isolation
  re-run: **11/11 passed, 13.6s** (`p6-isolation-manualqa.log`).
- EADDRNOTAVAIL also recurred **within** a solo gesture-file run (not just across batched
  files) at tests #4/#5 of `leadgen-rework-acceptance-routing.gesture.spec.ts` (16-17
  requests deep into that file) — same local-resource-pressure class, triggered by
  in-file request volume rather than strictly cross-file batching.

### REAL REGRESSION candidates (no rework-ruling citation found; reproduced on a fresh
DB+wrangler+seed cycle where re-run — not batch artifacts)

- **`leadgen-r2p4-fixfirst-drive.spec.ts` F-1** (reproduced identically in isolation,
  `p6-isolation-fixfirst.log`): typing `90000` into the slider's "From" box (To=40000)
  correctly clamps the rail/pill/payload to `35000` (`TO_VALUE - STEP`, asserted and
  passing), but the visible **From input box still shows the raw typed `90000`** —
  `expect(boxFrom).toBe(payloadMin)` → Expected `"35000"`, Received `"90000"`. This test
  exists specifically to catch this class of box/payload disagreement.
- **`leadgen-u11u12-move.gesture.spec.ts`** ("R7 U11a THE GATE (both engines)") + its
  superseded/duplicate `leadgen-u11u12-move-chromium-attempt.spec.ts` (isolation-confirmed
  identical, `p6-isolation-u11u12attempt.log`): dragging a ButtonAnswerGroup to reorder it
  after the ZIP field does not persist — `persisted order: q_head,q_btn,q_zip,q_cont`
  (unchanged) on **both chromium and firefox**. The other 9 move/resize tests in the same
  file pass, so the drag mechanism works generally; this one component-move class does not.
- **`leadgen-rework-p2-studio.gesture.spec.ts` (d)**: the §4.1 "Questions on one screen"
  starter tile inserts 2 `TwoButtonYesNo` nodes that render correctly on canvas (both
  pre-save assertions pass, with correct "Question 1"/"Question 2" labels) but **0 of them
  persist** after Save + reload (`expect(starterNodes).toHaveLength(2)` → received `[]`).
- **`leadgen-rework-acceptance-inputs.gesture.spec.ts` #6**: `[data-lg-error-for=
  "mailing_address_street"]` resolves to **2 elements** — a visible auto-error
  (`class="lg-error-auto"`, has the text) and a hidden, empty, legacy `ValidationError`
  component (`data-question-id="q_addr_street_err"`) that coincidentally shares the same
  `data-lg-error-for` key — a strict-mode/DOM-uniqueness violation.
- **`leadgen-round4-acceptance.gesture.spec.ts` Item 2 (firefox only)**: reproduced
  identically on a 2nd fresh cycle (`p6-gest-run-g20-rerun.log`). An archived quote's
  "Reactivate" kebab menuitem resolves immediately (6 retries, element found every time)
  but stays `hidden` for the full 5s timeout. Chromium passes the same assertion.
- **`leadgen-round4-funnel-acceptance.gesture.spec.ts` Item 10I**: clicking `#lg-theme-ab-
  this` + accepting a "30" prompt never fires the expected `POST .../variants/.+/fork` or
  `PUT .../variants/:id` within 30s (both `page.waitForResponse` calls time out).
- **`leadgen-rework-acceptance-builder.gesture.spec.ts` "#11D layout..."** (reproduced
  identically on a 2nd fresh cycle, `p6-gest-run-g11-rerun.log`): `#lg-tpl-theme-select`
  option at index 1 exists but is **disabled** (`selectOption` retries 61× over 30s,
  "option being selected is not enabled"). The file's own comments document a known history
  of cross-test ordering fragility in this exact theme-options area; not fully root-caused
  beyond this evidence.
- **`leadgen-rework-acceptance-routing.gesture.spec.ts`** two not-fully-root-caused fails
  (evidence captured, no citation found): item 2 — a template picker menu item
  `"ACC6C Picker {uniq}"` never becomes visible (10s timeout); item 3 — after saving a
  shared-page A/B split, `.lg-col-shared [data-sec-chip] .lg-sc-name` containing `"A/B:"`
  never appears (20s timeout).

### Not run in full / caveats

- All 90 files were run to completion; nothing was skipped or left unrun.
- `leadgen-round4-quotes-acceptance.gesture.spec.ts` took 5.6m (~21s/test), which exceeded
  my 300s per-call tool timeout and was auto-moved to background; it completed normally
  (not a hang) and its 16/18-fail result is genuine, fully captured.
- Deliberate `test.skip()` vs cascade-skip was individually confirmed for:
  `leadgen-p1-geometry.gesture.spec.ts` (3, firefox host-resolver limitation, by design),
  `leadgen-p2a-element-freedom.gesture.spec.ts` (1, same reason),
  `leadgen-rework-p4-themes.gesture.spec.ts` (2, "covered at the unit level" placeholder,
  by design), `__p3a-pages.spec.ts` / `leadgen-perf.spec.ts` / `leadgen-p4b-validation
  .spec.ts` / `leadgen-theme-manager.spec.ts` (cascade-skips downstream of the P1/P9
  failures above, serial-mode). The remaining `dnr` counts were not individually re-audited
  for skip-vs-cascade given the volume; each traces to a listed failure in the same file.
