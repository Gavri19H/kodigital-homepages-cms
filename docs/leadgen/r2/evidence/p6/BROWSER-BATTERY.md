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

---

# SECTION 2 — P6 second pass: one product fix + battery clearance (re-measured)

Everything above is the ORIGINAL measurement run and is left byte-intact. This
section reports (a) a product layout defect fixed in `src/`, and (b) the
continued clearance, all re-measured by hand on port 8901 with the same ritual
(`npm run db:reset:local` → `npx wrangler dev --port 8901 --ip 127.0.0.1
--var DEV_BYPASS_AUTH:true --var ADMIN_HOST:127.0.0.1` → `npm run
seed:leadgen-fixture` → `PW_PORT=8901 npx playwright test <file> --workers=1`),
one full reset/restart/reseed cycle per `*.gesture.spec.ts` file.

## A. The §8.4 themes-manager layout defect (owner clause ③) — FIXED in src

`src/admin/leadgen/ui-theme-manager.ts` packed the editor controls
(`data-pin="8.4-editor-controls"`) beside the live canvas
(`data-pin="8.4-live-canvas"`) in ONE flex row with **no `flex-wrap`** and an
**unshrinkable** `flex:0 0 340px` canvas. The flexible editor child absorbed the
whole deficit whenever the centre column's inner width fell below
`<editor> + 26 + 340`, computing to width **0** and hiding every §10.3/§10.4
control it holds.

Measured on the real page, both ways (`test-ui/leadgen-r2p6-themefix-drive.spec.ts`,
6 tests; screenshots in `docs/leadgen/r2/evidence/p6/themefix/`):

| viewport | `.tm-body` | editor col BEFORE | editor col AFTER | canvas AFTER | anatomy AFTER |
|---|---|---|---|---|---|
| 1280 | 980 | **0px** | **304px** | 304px | stacked (canvas under controls) |
| 1366 | 1066 | **24px** | **390px** | 340px | stacked |
| 1440 | 1140 | **98px** | **464px** | 340px | stacked |
| 1600 | 1300 | 258px | **258px** | **340px** | side-by-side — UNCHANGED |
| 375 | — | scrollWidth 375 = innerWidth 375 | 375 = 375 | — | no horizontal overflow |

Drive spec: **0/6 → 6/6** (before: 1280/1366/1440 failed `editor width > 240`,
received 0 / 24 / 98).

Treatment (deliberate): `flex-wrap:wrap` on the row, editor basis `1 1 240px`,
canvas `0 1 340px;min-width:0`. Flex line-breaking uses the items' *hypothetical*
sizes, so the editor's basis is the explicit "how much room does BESIDE require"
knob: `240 + 26 + 340 = 606px` of centre-inner. At 1600 the centre's inner width
is 624px ⇒ still ONE line at exactly today's 258/340 split; below ~1582 viewport
the canvas wraps under the controls (DOM order kept) and the editor takes the
full line instead of collapsing. The canvas may now shrink (grow still 0), so on
its own line it fits a narrow column instead of overflowing it. No media query —
the trigger is the column's OWN width, so the `?embed=1` standalone shell (no
admin nav) degrades on the same rule.

`test-ui/leadgen-theme-manager.spec.ts` (NOT edited): **1/11 → 11/11**. (The
Section-1 table records 0/11 for it; the sibling fixture re-point committed at
`8354ddb` had already taken it to 1/11 before this layout fix.)

## B. Per-file re-measurement (Section-1 baseline → now)

| File | §1 baseline | now | Δ pass | what did it |
|---|---|---|---|---|
| `leadgen-theme-manager.spec.ts` | 0/11 (10 dnr) | **11/11** | +11 | `8354ddb` fixture + the §8.4 layout fix above |
| `leadgen-round4-quotes-acceptance.gesture.spec.ts` | 2/18 | **12/18** | +10 | stale `openEditor` wait re-pointed |
| `leadgen-p3a-placement.gesture.spec.ts` | 18/28 (5 skip) | **23/28** (5 skip, 0 fail) | +5 | 2 remaining activation sites given the mandatory shared page |
| `__p6b-theme-mgr.spec.ts` | 3/8 | **7/8** | +4 | stale `openEditor` wait re-pointed |
| `__p6a-theme.spec.ts` | 0/3 (2 dnr) | **3/3** | +3 | `8354ddb` (verified in use here) |
| `leadgen-runtime.spec.ts` | 0/3 (2 dnr) | **3/3** | +3 | `8354ddb` (verified) |
| `leadgen-p4a-behavior.spec.ts` | 0/3 (1 dnr) | **3/3** | +3 | `8354ddb` (verified) |
| `leadgen-p1-geometry.gesture.spec.ts` | 10/16 (3 skip) | **13/16** (3 skip, 0 fail) | +3 | `8354ddb` (verified) — the `:8899` hardcode is gone |
| `__p5b-quotes-ia.spec.ts` | 1/7 | **3/7** | +2 | stale `openEditor` wait re-pointed |
| `leadgen-rework-acceptance-routing.gesture.spec.ts` | 27/34 | **29/34** | +2 | `8354ddb` (verified) |
| `leadgen-p4c-rules.gesture.spec.ts` | 4/8 (2 dnr) | **6/8** (2 skip, 0 fail) | +2 | `8354ddb` (verified) |
| `leadgen-rework-p3b-board.gesture.spec.ts` | 30/32 | **32/32** | +2 | `8354ddb` (verified) |
| `leadgen-p2a-element-freedom.gesture.spec.ts` | 20/22 (1 skip) | **21/22** (1 skip, 0 fail) | +1 | `8354ddb` (verified) |
| `leadgen-runtime-v25.spec.ts` | 0/6 (5 dnr) | **1/6** | +1 | shared-page seed added — file no longer dies in `beforeAll` |
| `leadgen-rework-p4-templates.gesture.spec.ts` | 6/8 | 6/8 | 0 | unchanged (2 open, below) |
| `leadgen-visual.spec.ts` | 8/10 | 8/10 | 0 | frozen baselines — ruling needed |
| `leadgen-v31-gate1c-baselines.spec.ts` | 0/7 (6 dnr) | 0/7 | 0 | frozen baselines — ruling needed |
| `leadgen-r2p6-themefix-drive.spec.ts` (NEW) | — | **6/6** | +6 | new §8.4 layout drive |

## C. NEW grand totals

Section-1 numbers with the re-measured files substituted (no double counting —
these figures SUBSUME the `8354ddb` slice's "+55" claim, whose edits live in the
files re-measured above):

- **Tests: 678 passed / 803 discovered. Failed: 77. Skipped-or-did-not-run: 48.**
  (678 + 77 + 48 = 803 ✓ — was 626 / 108 / 69.) **+52 passing.**
- **Files fully clean: 59/90** (was 50). Files with ≥1 failure: **31** (was 40).
- Including the new `leadgen-r2p6-themefix-drive.spec.ts`: **684 passed / 809
  discovered in 91 files, 60 clean.**

## D. Root cause corrected: "P1b" is DELETED DOM, not fixture completeness

Section 1's P1b attributed `openEditor()`'s canvas timeout to bare fixtures.
That is wrong, and the diagnostic is direct: `grep -rn "lg-preview-iframe" src/`
returns **exactly one hit** — `var canvas = byId('lg-preview-iframe')` inside
`quotes-tabs/funnel.ts`'s island — and **zero renders**. The failure screenshot
(`test-artifacts/__p6b-theme-mgr-…-chromium/test-failed-1.png`) shows the editor
loading perfectly onto the P3b **board** (Section library / Shared first page /
Routing rules); `ui-quotes.ts:4` names that tab "Funnel builder (04 §4.1 FRAME
STUDIO)". The P3b board rewrite replaced the §4.1 frame-studio canvas, exactly
as it deleted `#lg-structure-panel`. `POST /variants/:id/preview` (what the
Templates canvas renders) returns **0** `data-frame-region` stamps, so no admin
surface renders them today.

Consequence: three files' `openEditor()` gate waited on deleted DOM, killing
tests that never touch a canvas. The gate — and ONLY the gate — was re-pointed
at the editor's real landing surface (`[data-board]`). Every canvas-region
assertion INSIDE the individual tests was left exactly as written, so the tests
that genuinely drive the retired canvas still fail at their own assertion and
appear in the ruling list below.

## E. Still red — with causes (nothing papered over)

**Retired-DOM class (needs a rewrite-or-retire ruling; no test deleted):**
- `__p3b-structure.spec.ts` 0/2 (`#lg-structure-panel`) — **recommend RETIRE.**
  Every behaviour it asserts is covered on the current board:
  `leadgen-rework-p3b-board.gesture.spec.ts` S5.3 items 1–4b (add page, "+
  section" popover, A/B slot on the shared page, cross-page move — now 32/32)
  and `leadgen-r2p6-d11c-drive.spec.ts` (`[data-shared-ruled-dialog]` /
  `[data-ruled-case]` / `[data-ruled-field]` = the ruled-slot editor, 11C-A page
  order). Nothing it asserts would go uncovered.
- `__p4b-rules.spec.ts` 0/3 (`#lg-routing-rules-root`) — **recommend RETIRE
  tests 2–3, REWRITE test 1's selector.** Tests 2–3 (author/save/reload/toggle/
  duplicate; offer-NAME picker persists `target_offer_id`+`redirect_pct`) are
  re-covered by `leadgen-rework-p3b-rules.gesture.spec.ts` (16/16). Test 1
  ("standalone Rules tab is gone; the panel is embedded in the Funnel builder
  tab's right column") is still a TRUE and load-bearing structural claim — only
  its mount id moved (`#lg-routing-rules-root` → `.lg-board-right[data-rules-rail]`,
  `funnel.ts:708`).
- `__p5b-quotes-ia.spec.ts` 3/7 — the 4 fails all drive the retired §4.1 canvas
  (`[data-frame-region='logo'] img.lg-logo-img`, `.lg-frame-brand-logos img`,
  `.lg-frame-image img`, and a `[data-frame-region='progress']` click).
- `leadgen-round4-quotes-acceptance.gesture.spec.ts` 12/18 — Item 10B (canvas
  logo) and Item 10D (canvas progress click) are the same class, ×2 engines.
- `__p6b-theme-mgr.spec.ts` 7/8 — the one fail asserts `[data-fork-variant]`
  inside the A/B panel; that attribute renders NOWHERE (`funnel.ts:3855` only
  READS it). "Fork this variant" was superseded by `#lg-add-variant` under the
  Rework M1 single-active-variant gate (`ab.ts:68-99,162`).

**Frozen baselines that predate the rework (rebaselining is an owner-visible
decision — NOT taken here):**
- `leadgen-visual.spec.ts` 8/10 — `leadgen-runtime-{desktop,mobile}.png` height
  1940 vs the current 1899 ⇒ `pixelDiffRatio` returns its literal sentinel `1`.
- `leadgen-v31-gate1c-baselines.spec.ts` 0/7 — `01-build-default` ratio
  **0.03394831730769231** vs budget 0.001 (1 fail + 6 same-describe dnr).

**Open causes:**
- `leadgen-runtime-v25.spec.ts` 1/6 — the shared-page seed added to
  `seedLegacyPinLiveFunnel` (`leadgen-e-seed.ts`; it 409'd
  `activation.shared_page` and killed the whole `beforeAll`) unblocks the file,
  and the 5 remaining failures are now MEASURED instead of dnr: the mandatory
  shared first page renders as step 1, so the file's `TRAVERSAL` indices and its
  `aria-valuenow 1→2→3` expectation are off by one, and the committed byte-pin
  fixture (`test/fixtures/leadgen-legacy-pin/legacy-shell.html`) predates the
  shared page. Net +1 pass, +4 measured failures, −5 dnr.
- `leadgen-rework-p4-templates.gesture.spec.ts` 6/8 — (a) "set default is a
  single atomic swap": the UI swap PASSES (chip1 loses `is-default`, chip2 gains
  it); the last line still asserts the **global** `frame-template-records`
  default, which R2 ruling D5 deliberately made **per-quote**. Re-pointing it at
  the quote-scoped default is a ruling-grounded rewrite, not a relaxation — left
  for the ruling. (b) "section picker + theme switcher": `#lg-tpl-theme-select`
  option is rendered **disabled** (61 retries / 30s) — same shape as the
  builder spec's `#11D` fail; not root-caused.
- `leadgen-rework-acceptance-routing.gesture.spec.ts` 29/34 — 2× a template
  picker menu item `"ACC6C Picker {uniq}"` never becoming visible (both
  engines), 1× a firefox shared-page A/B slot, plus harness noise. The P11
  `.lg-board-left` strict-mode cause named in Section 1 is GONE (the spec now
  scopes to `.lg-board-left[data-pin="8.2-left-library"]`, line 137).
- `leadgen-round4-quotes-acceptance.gesture.spec.ts` Item 10G — `[data-tplbox-
  panel="images"] [data-img-item-row] [data-img-item-gen-error]` never surfaces.
  That element DOES exist (`templates.ts:611`), so this is a live-surface failure,
  not retired DOM. Cause open.

**Harness (EADDRNOTAVAIL) — reconfirmed, and it is now the dominant noise source
on repeat runs.** `leadgen-p4c-rules.gesture.spec.ts` measured 0/8 (6 fails, ALL
`connect EADDRNOTAVAIL 127.0.0.1:8901`) inside the sequential cycle, then **6/8
with zero failures** on an isolated re-run. A second isolated re-run of
`leadgen-rework-acceptance-routing.gesture.spec.ts` late in the session returned
9/34 with 23 of the 25 failures EADDRNOTAVAIL — the 29/34 above is the valid
measurement. Any single-file number in this section that looks worse than
Section 1 should be re-run in isolation before it is believed.

## F. Specs touched in this pass — before/after assertions

| Spec | assertion BEFORE | assertion AFTER | stronger/same/weaker |
|---|---|---|---|
| `test-ui/leadgen-theme-manager.spec.ts` | — | **NOT TOUCHED** (it asserted the correct thing; the product was fixed) | same |
| `test-ui/__p6b-theme-mgr.spec.ts` | gate: `#lg-preview-iframe` → `[data-frame-region='section_slot']` visible | gate: `[data-board]` visible | same claim ("the editor is loaded"), on DOM that exists; no test in the file uses `canvas()` afterwards |
| `test-ui/__p5b-quotes-ia.spec.ts` | same stale gate | `[data-board]` visible; every in-test canvas assertion LEFT AS IS | same; the 4 canvas tests still fail honestly |
| `test-ui/leadgen-round4-quotes-acceptance.gesture.spec.ts` | same stale gate | `[data-board]` visible; both canvas tests LEFT AS IS | same; 10B/10D still fail honestly |
| `test-ui/leadgen-e-seed.ts` (`seedLegacyPinLiveFunnel`) | activated a quote with NO shared page ⇒ 409, `beforeAll` died | calls the file's own `seedTrivialSharedPage` first (same precedent `seedPatternQuote` already uses) | same assertions; a precondition satisfied, none relaxed |
| `test-ui/leadgen-p3a-placement.gesture.spec.ts` (2 MINOR-2 tests) | variant-only sections ⇒ activation 409 | pass-through section on the variant + section-under-test on the shared page — the file's OWN documented pattern from its "P3a live" test | same; composed order and every geometry assertion unchanged |
| `test-ui/leadgen-r2p6-themefix-drive.spec.ts` (NEW) | — | editor width > 240 + 5 leaf controls visible + Advanced really opens + canvas visible, at 1280/1366/1440/1600; 1600 side-by-side with canvas exactly 340; 375 `scrollWidth <= innerWidth` | new coverage |

No spec's assertion was weakened. `docs/leadgen/r2/evidence/{p3,p4,p5}` and
`test-ui/__screenshots__` are untouched (`git status` clean outside `p6/`).
`npx tsc --noEmit` exit **0**. `LEADGEN_RUNTIME_JS_BYTES = 52762` (≤ 53248,
unchanged — the fix is admin-side).

---

# SECTION 3 — P6 terminal close-out

Sections 1 and 2 above are left byte-intact. This section (a) root-causes the two
remaining chromium failures in `leadgen-rework-acceptance-routing.gesture.spec.ts`,
(b) measures by hand everything that was still unverified or carried forward on
someone else's claim, and (c) states the final counts and the residuals.

Ritual, every measurement below, from `api/`:
`pkill -f "wrangler dev --port 8901"` → `npm run db:reset:local` → `npx wrangler dev
--port 8901 --ip 127.0.0.1 --var DEV_BYPASS_AUTH:true --var ADMIN_HOST:127.0.0.1`
(background; `/health` polled to 200) → `npm run seed:leadgen-fixture` →
`PW_PORT=8901 npx playwright test test-ui/<file> --workers=1 --reporter=list`.
One full reset/restart/reseed cycle per `*.gesture.spec.ts` file. Port 8901 has a
single owner: the manually started wrangler. `playwright.config.ts` sets
`reuseExistingServer: !process.env.CI`, so Playwright's own `webServer` entry
attaches to that process instead of trying to bind 8901 again — no
"Address already in use" occurred in this pass. 8787 was never bound.

## A. The EADDRNOTAVAIL caveat — read this before believing ANY red number

This is harness noise, not product failure, and on repeat runs it is the dominant
noise source. It is a local-resource limit, measured not guessed:
`sysctl` reports `net.inet.ip.portrange.first: 49152` / `.last: 65535`
(16,384 ephemeral ports) and `net.inet.tcp.msl: 15000` ⇒ a 30 s TIME_WAIT per
closed socket. Sustained Playwright API traffic against `127.0.0.1:8901` exhausts
that pool, and the kernel then refuses the local bind:
`connect EADDRNOTAVAIL 127.0.0.1:8901 - Local (0.0.0.0:0)`.

Measured instances in THIS pass (isolated numbers are the truth):

| run | in-cycle result | EADDRNOTAVAIL in log | isolated re-run |
|---|---|---|---|
| `leadgen-rework-acceptance-routing.gesture` both engines | 23/34 (11 fail) | 8 + 1 cascade `Request context disposed` = 9 of the 11 | chromium **17/17**, firefox **17/17** |
| `leadgen-round4-quotes-acceptance.gesture` both engines | 11/18 (7 fail) | 6 + 1 cascade = **7 of 7** | firefox **9/9** (chromium was already 9/9) |
| `__p5a-frame` + `leadgen-patterns-v25` + `leadgen-quote-builder` (3-file batch) | 10/30 | first test of files 2 and 3 killed, 18 cascade-skips | **10/10**, **10/10**, **10/10** |
| `__p6b-theme-mgr` immediately after a routing run | 2/8 | 5 | **5/8** after a drain (then 8/8, see §B/§D) |

A second local-transport shape appears under the same pressure:
`apiRequestContext.post: read ECONNRESET` on `POST /api/admin/leadgen/sections`
(one chromium routing run, otherwise 16/17). Same class, same treatment.

Method used from here on: between measurements, poll
`netstat -an -p tcp | grep -c TIME_WAIT` and wait until it is under ~60.
**Every count in §C/§E below comes from a run whose log contains 0
`EADDRNOTAVAIL`** (checked per run with `grep -c EADDRNOTAVAIL`).

## B. TASK 1 — the two remaining chromium failures, classified

### B1 · routing test #4 (template picker) — **STALE SPEC against owner ruling R2 SRC-11B**

Symptom: `expect(locator('[data-template-menu]').locator('.lg-menu-item')
.filter({ hasText: 'ACC6C Picker …' })).toBeVisible()` → `element(s) not found`,
10 s.

Diagnostic, four independent legs:

1. **The dispatch code carries the owner's own words.**
   `src/admin/leadgen/quotes-tabs/funnel.ts:5120-5124`:
   `// SRC-11B (owner: "the themes and the templates are moving to the top` /
   `// bar, why you kept the old and wrong option in the funnel builder??").` /
   `// NAVIGATES to the top-bar Templates tab — exactly like its Theme sibling` /
   `// just above — never opens an embedded apply-popover in the builder.` /
   `if (t.closest('[data-template-picker]')) { ev.stopPropagation(); gotoTab('templates'); return; }`
2. **The popover the spec drove is REMOVED by that ruling.** `funnel.ts:3735-3739`:
   "R2 SRC-11B: the per-funnel-column Template chip's OWN embedded apply-popover
   (openTemplatePicker/applyTemplate/frameTemplateRecordItems) was ALSO removed".
   `grep -rn "frameTemplateRecordItems" src/` = **1 hit**, and it is that comment.
3. **The failure screenshot proves the product did the ruled thing.**
   `test-artifacts/…-plate-id-the-rendered-frame-chromium/test-failed-1.png` shows
   the editor already switched to the **Templates** tab, and the SAVED TEMPLATES
   row contains the chip `ACC6C Picker acc6-pickers-tpl-1785446384431712` — the
   DB-record template WAS listed, on the ruled surface. Nothing was missing.
4. **`[data-template-menu]` still exists but is a different thing now** — the
   shared generic popover container filled by `openPopoverList`
   (`funnel.ts:4456`, the "＋ section" picker). That is why the old locator
   resolved to a real element that never lists templates.

Not a product defect; no `src/` change needed or made. A sibling spec already
asserts the ruled behaviour and passes:
`leadgen-rework-p3b-board.gesture.spec.ts` → "template pickchip navigates to the
top-bar Templates tab (no embedded popover)" (that file: 32/32).
Treatment = ruling-grounded re-point, both halves preserved (§D row 8).
**Fail-before 0/1** (element(s) not found, 10 s) → **pass-after 1/1** (635 ms);
then 17/17 chromium and 17/17 firefox on full-file isolated runs.

### B2 · routing test #17 (all-actions, pct=100 leg 302s) — **HARNESS**

A redirect leg that genuinely failed to 302 would be a real routing defect on
owner clause SRC-11C-R, so this was established rather than waved off.

1. **The 30.7 s duration is itself the diagnostic.** `playwright.config.ts`
   declares no `timeout` (only `webServer` timeouts, 120 s / 30 s) and the spec
   declares no `test.setTimeout` / `test.slow` — so the test timeout is
   Playwright's default 30 000 ms. `expect(res1.status()).toBe(302)` is a
   NON-retrying assertion on an already-resolved response; if it had failed it
   would have failed in milliseconds with an "Expected 302 / Received …" diff.
   A 30.7 s result therefore means the test never reached a failing expect —
   it was killed by the harness timeout **inside a network call**. The only
   network work before that assertion is `playwrightRequest.newContext()` +
   `hostCtx.get(pathA, { headers: { Host }, maxRedirects: 0 })` — precisely the
   surface that yields EADDRNOTAVAIL under §A pressure.
2. **What the request actually does now, measured 4×** (solo `-g "all-actions"`
   ×3 and in the full isolated file): **4 passes**, 1.1 s / 1.4 s / 1.4 s / 1.6 s.
   Its first assertions after seeding are the raw `maxRedirects: 0` HTTP checks:
   `res1.status() === 302` and
   `res1.headers()['location'] === '/lg/lc/<offerA.public_id>'`, followed by the
   sticky repeat `res2.status() === 302` with an identical `Location`. The
   request fires and returns the governed offer URL. The pct=0 leg's D1 outcome
   row (`routed_to_funnel` / `feed_name` = "premium" / `value_multiplier` = 3 /
   `plane` = "entry") is asserted in the same passing test.

No product defect; no `src/` change needed or made.

## C. TASK 2 — everything unverified, re-measured first-hand

Every file that was RED in Section 1 was re-run in this pass, plus the 4 new
`leadgen-r2p6-*-drive` files and the three §1 "isolation" rows. `§1` = Section 1's
table, `§2` = Section 2's table B.

| File | §1 | §2 | **measured now** | 0 EADDR? |
|---|---|---|---|---|
| `__p6b-theme-mgr.spec.ts` | 3/8 | 7/8 (claimed; never re-run) | **8/8** | yes |
| `leadgen-round4-quotes-acceptance.gesture.spec.ts` | 2/18 | 12/18 | **18/18** (chromium 9/9 + firefox 9/9) | yes |
| `leadgen-rework-acceptance-routing.gesture.spec.ts` | 27/34 | 29/34 | **34/34** (chromium 17/17 + firefox 17/17) | yes |
| `__p3b-structure.spec.ts` | 0/2 | — | **0/2** (2 retired-skip, **0 fail**) | yes |
| `__p4b-rules.spec.ts` | 0/3 | — | **1/3** (2 retired-skip, **0 fail**) | yes |
| `__p5b-quotes-ia.spec.ts` | 1/7 | 3/7 | **6/7** (1 retired-skip, **0 fail**) | yes |
| `leadgen-runtime-v25.spec.ts` | 0/6 | 1/6 | **6/6** | yes |
| `leadgen-rework-p4-templates.gesture.spec.ts` | 6/8 | 6/8 | **8/8** | yes |
| `__p5a-frame.spec.ts` | 0/10 (batch) | — | **10/10** | yes |
| `leadgen-patterns-v25.spec.ts` | 10/10 | — | **10/10** (0/10 inside a 3-file batch) | yes |
| `leadgen-quote-builder.spec.ts` | 10/10 | — | **10/10** (0/10 inside the same batch) | yes |
| `__p5c-assets.spec.ts` | 0/4 (iso 3/4) | — | **4/4** | yes |
| `listicles-manual-qa.spec.ts` | 0/11 (iso 11/11) | — | **11/11** | yes |
| `__p1d-lists.spec.ts` | 13/15 | — | **15/15** | yes |
| `__p2b-phone.spec.ts` | 0/4 | — | **4/4** | yes |
| `__p3a-pages.spec.ts` | 0/5 | — | **5/5** | yes |
| `leadgen-ga4.spec.ts` | 0/4 | — | **4/4** | yes |
| `leadgen-perf.spec.ts` | 0/3 | — | **3/3** | yes |
| `leadgen-p4b-validation.spec.ts` | 1/14 | — | **8/14** (6 deliberate skip, **0 fail**) | yes |
| `leadgen-offers.spec.ts` | 5/6 | — | **6/6** | yes |
| `leadgen-p1c-editor-chrome.spec.ts` | 4/5 | — | **5/5** | yes |
| `leadgen-r2p4-fixfirst-drive.spec.ts` | 0/3 | — | **3/3** | yes |
| `leadgen-r4a-pipeline.spec.ts` | 7/9 | — | **9/9** | yes |
| `leadgen-r4b-maps-tab.spec.ts` | 0/1 | — | **1/1** | yes |
| `leadgen-u11u12-move-chromium-attempt.spec.ts` | 0/1 | — | **1/1** | yes |
| `leadgen-u11u12-move.gesture.spec.ts` | 10/12 | — | **12/12** | yes |
| `leadgen-rework-acceptance-inputs.gesture.spec.ts` | 21/22 | — | **22/22** | yes |
| `leadgen-rework-acceptance-builder.gesture.spec.ts` | 21/24 | — | **24/24** | yes |
| `leadgen-rework-p2-studio.gesture.spec.ts` | 8/10 | — | **10/10** | yes |
| `leadgen-round4-acceptance.gesture.spec.ts` | 17/18 | — | **18/18** | yes |
| `leadgen-round4-funnel-acceptance.gesture.spec.ts` | 7/8 | — | **8/8** | yes |
| `leadgen-r2p6-d11c-drive.spec.ts` (new) | — | — | **10/10** | yes |
| `leadgen-r2p6-d11d-drive.spec.ts` (new) | — | — | **4/4** | yes |
| `leadgen-r2p6-fixes3-drive.spec.ts` (new) | — | — | **2/2** | yes |
| `leadgen-r2p6-themefix-drive.spec.ts` (new) | — | 6/6 | **6/6** | yes |
| `leadgen-visual.spec.ts` | 8/10 | 8/10 | **8/10 — STILL RED (ruled)** | yes |
| `leadgen-v31-gate1c-baselines.spec.ts` | 0/7 | 0/7 | **0/7 — STILL RED (ruled)** | yes |

**Every one of Section 1's "REAL REGRESSION candidates" now measures green** on a
fresh reset/restart/reseed cycle at HEAD `c5c2037` (+ the two spec re-points in
§D): `leadgen-r2p4-fixfirst-drive` F-1 (slider box vs payload) 3/3;
`leadgen-u11u12-move` + its chromium-attempt sibling 12/12 and 1/1;
`leadgen-rework-p2-studio` (d) 10/10; `leadgen-rework-acceptance-inputs` #6
22/22; `leadgen-round4-acceptance` Item 2 (firefox) 18/18;
`leadgen-round4-funnel-acceptance` Item 10I 8/8;
`leadgen-rework-acceptance-builder` "#11D layout" 24/24;
`leadgen-round4-quotes-acceptance` Item 10G 18/18. Stated precisely: these are
current measurements at HEAD, each on its own clean cycle; this pass did **not**
bisect which intervening commit fixed which, and Section 1's runs carried both
batch pressure and an accreted DB, either of which can also explain a red row.

## D. Retire / re-point table for the whole of P6

Every retirement names in-file the spec that now covers its claim. No assertion
was weakened anywhere in P6; the two rows added by this pass are marked ★.

| # | Spec · what changed | BEFORE | AFTER | covering spec for anything retired | strength |
|---|---|---|---|---|---|
| 1 | `__p6b-theme-mgr.spec.ts` editor gate | `#lg-preview-iframe` → `[data-frame-region='section_slot']` visible | `[data-board]` visible | n/a (gate re-point) | same |
| 2 | `__p5b-quotes-ia.spec.ts` editor gate | same stale gate | `[data-board]`; in-test canvas assertions left as written | n/a | same |
| 3 | `leadgen-round4-quotes-acceptance.gesture.spec.ts` editor gate | same stale gate | `[data-board]` | n/a | same |
| 4 | `leadgen-e-seed.ts` `seedLegacyPinLiveFunnel` | activated a quote with no shared page ⇒ 409 | calls the file's own `seedTrivialSharedPage` first | n/a (precondition) | same |
| 5 | `leadgen-p3a-placement.gesture.spec.ts` (2 MINOR-2 tests) | variant-only sections ⇒ activation 409 | pass-through section on the variant + section under test on the shared page | n/a | same |
| 6 | `leadgen-r2p6-themefix-drive.spec.ts` (NEW, §2) | — | editor width > 240 + 5 leaf controls + canvas at 1280/1366/1440/1600, 375 no overflow | n/a | new coverage |
| 7 | `__p3b-structure.spec.ts` — **2 describes RETIRED** (`test.describe.skip`, file header carries a claim→covering-spec map) | drove `#lg-structure-panel` | retired-skip, 0 fail | `leadgen-rework-p3b-board.gesture.spec.ts` (32/32) + `leadgen-r2p6-d11c-drive.spec.ts` (10/10; `[data-shared-ruled-dialog]` 11C-B) | same claims, live DOM |
| 8 ★ | `leadgen-rework-acceptance-routing.gesture.spec.ts` test #4 — **re-pointed to ruling SRC-11B** | click `[data-template-picker]` → expect a `[data-template-menu] .lg-menu-item` matching the template NAME → click it → `/apply-template` → `frame_template_id` + `effective_frame.footer.enabled===false` | click `[data-template-picker]` → `[data-panel="templates"]` visible **and `[data-template-menu]` NOT visible** → `[data-tpl-chip="<record public_id>"]` visible + contains the name → real Apply-to-funnel dialog (`#lg-tpl-apply-btn` → `[data-apply-choice="<public_id>"]` → `[data-apply-state="confirm"]` → `#lg-tpl-apply-confirm-btn`) → **same** `/apply-template` ok + **same** `frame_template_id` + **same** `footer.enabled===false` | the navigation half is independently covered by `leadgen-rework-p3b-board.gesture.spec.ts` "template pickchip navigates to the top-bar Templates tab (no embedded popover)"; the apply half by `leadgen-rework-acceptance-builder.gesture.spec.ts` "#11D Apply to funnel" | **stronger** — the record is now located by its own public id instead of a `hasText` match on a generic menu row, and the removed popover is asserted absent |
| 9 | `__p4b-rules.spec.ts` — **2 tests RETIRED** (`test.skip`, retirement reason + covering spec written into the test title), test 1 re-pointed | `#lg-routing-rules-root` | tests 2–3 retired-skip; test 1 re-pointed to `.lg-board-right[data-rules-rail]` + 3 added structural assertions | `leadgen-rework-p3b-rules.gesture.spec.ts` (16/16) | stronger for test 1 |
| 10 | `__p5b-quotes-ia.spec.ts` — 1 test RETIRED (`test.skip`, reason in the title) + canvas re-points | drove the 6-row `.lg-progress-style-opt` editor | retired-skip; the rest re-pointed at the Templates-tab canvas | `leadgen-rework-p4-templates.gesture.spec.ts` Progress leg | same |
| 11 | `leadgen-rework-p4-templates.gesture.spec.ts` "set default" | 1 assertion on the **global** `frame-template-records` default | 3 **per-quote** assertions matching ruling D5 | n/a | stronger |
| 12 | `leadgen-round4-quotes-acceptance.gesture.spec.ts` 10B/10D/10G | canvas assertions on the retired §4.1 surface | re-pointed to the Templates-tab canvas; 10D from a row-alignment check to an exact six-value set | n/a | stronger for 10D |
| 13 | `leadgen-runtime-v25.spec.ts` | `beforeAll` 409'd on `activation.shared_page` | cause fixed in the e2e mirror seed; the committed byte-pin fixture proven byte-identical (same sha256 before/after a classified recapture) | n/a | same |
| 14 ★ | `__p6b-theme-mgr.spec.ts` lines 448 + 494 — **re-pointed off a forbidden label** | `[data-arm-variance="<id>"]` toHaveText **"Control"**; `[data-variant=…] [data-arm-variance]` toHaveText **"Same as control (no differences yet)"** | `[data-arm-varies="<id>"]` toHaveText **"Base variant"**; `[data-arm-varies]` toHaveText **"No layout or template changes yet"** | the retired "Control" wording is not merely uncovered, it is CONTRADICTED by a passing sibling: `leadgen-rework-acceptance-routing.gesture.spec.ts` "#11C funnel A/B = equal arms, no control label anywhere, delete-variant exists" | same — still exact-text, on the string the product ships |

Row 14's evidence: `grep -rn "data-arm-variance" src/` = **0 hits** (the old
locator could never resolve); the render is `data-arm-varies`
(`quotes-tabs/ab.ts:109`, the only emitter) and its text comes from
`variantVariesLine` (`ab.ts:41-50`) — "Base variant" for the primary arm,
"No layout or template changes yet" for a fork with no overrides and the
primary's `frame_template_id`. The label ban is the owner ruling stated verbatim
at `ab.ts:56`: *"No control label anywhere; the funnel's single active variant
with no running test is just its one arm."*
Fail-before/pass-after for row 14: **5/8 → 7/8** (line 448 fixed) **→ 8/8**
(line 494 fixed).

## E. Final per-file counts and grand totals

Authoritative discovery, run from `api/`:
`PW_PORT=8901 npx playwright test --list` → **`Total: 825 tests in 94 files`**
(94 `test-ui/*.spec.ts`; `*-seed.ts` / `*-helpers.ts` are helpers, not specs).
Section 1's 803-in-90 plus the four `leadgen-r2p6-*-drive` files
(10 + 4 + 2 + 6 = 22) = 825 exactly.

- **Tests: 792 passed / 825 discovered. Failed: 3. Skipped: 30.**
  792 + 3 + 30 = **825** ✓
- **Files with ≥1 failure: 2 of 94. Files fully clean: 92 of 94.**
- Basis, stated so it can be audited rather than trusted: **every file that was
  red in Section 1 (40 files) was re-run first-hand in this pass**, as were the
  4 new drive files and 3 §1-green files (`__p5a-frame`, `leadgen-patterns-v25`,
  `leadgen-quote-builder`) — 37 files re-measured here in total (§C). The
  remaining Section-1-green files are carried forward at their Section-1
  measured numbers; nothing in this pass touched their code paths.

The 30 skips, itemised (all deliberate or retirement skips — the only cascade
group is the last row, behind the single ruled visual failure):

| file | skips | kind |
|---|---|---|
| `leadgen-p3a-placement.gesture.spec.ts` | 5 | deliberate |
| `leadgen-p1-geometry.gesture.spec.ts` | 3 | deliberate (firefox can't resolve a dynamic `*.e2e.test` host) |
| `leadgen-p2a-element-freedom.gesture.spec.ts` | 1 | deliberate, same reason |
| `leadgen-rework-p4-themes.gesture.spec.ts` | 2 | deliberate ("covered at the unit level") |
| `leadgen-p4c-rules.gesture.spec.ts` | 2 | deliberate |
| `leadgen-p4b-validation.spec.ts` | 6 | deliberate (that run reported **0 failed**, so none is a cascade) |
| `__p3b-structure.spec.ts` | 2 | retirement (`test.describe.skip`, covering spec named in-title) |
| `__p4b-rules.spec.ts` | 2 | retirement (`test.skip`, covering spec named in-title) |
| `__p5b-quotes-ia.spec.ts` | 1 | retirement (`test.skip`, covering spec named in-title) |
| `leadgen-v31-gate1c-baselines.spec.ts` | 6 | cascade — same serial describe, behind the 1 ruled failure |

## F. Residuals — every still-failing test, and why it ships red

**Both residual failures are in the two frozen VISUAL baseline suites, which are
ruled owner-visible and STAY RED. Neither was rebaselined.**

### F1 · `leadgen-visual.spec.ts` — 8/10, 2 failing
`leadgen-runtime-desktop` and `leadgen-runtime-mobile`, both logging
`[visual-baseline] …: changed-pixel ratio=1`.
That `1` is **the literal sentinel, not "100% of pixels differ"**:
`pixelDiffRatio` returns `1` unconditionally on any dimension mismatch
(`if (ia.width!==ib.width || ia.height!==ib.height) return 1`). Measured with
`sips`: committed baselines are **1280×1940** and **375×2618**
(`test-ui/__screenshots__/leadgen-runtime-{desktop,mobile}.png`, committed Jul 24
`fc6e84c5`); this pass's captures are **1280×1899** and **375×2577** — exactly
**−41 px on both**.
Ruled layout change that explains it, named by comparing the committed baseline
against this pass's capture side by side: the **R2 P4 currency-slider alignment
fix**. In the baseline the round thumb is knocked onto its own line below the
rail (rail ≈ y770, thumb centre ≈ y796, `$10,000`/`$1M+` labels ≈ y838); at HEAD
the thumb is centred **on** the rail (rail+thumb ≈ y770, labels ≈ y797) and
everything below shifts up by that same 41 px. That is exactly the geometry
`leadgen-r2p4-slider-drive.spec.ts` (6/6) and
`leadgen-r2p4-s4b-slider-drive.spec.ts` (7/7) assert as correct.
**It is NOT the theme-editor wrap fix** — that fix lives in
`src/admin/leadgen/ui-theme-manager.ts` and cannot affect the composed `/lg`
runtime page these two baselines capture.
Ship red: rebaselining is an owner-visible decision.

### F2 · `leadgen-v31-gate1c-baselines.spec.ts` — 0/7, 1 failing + 6 cascade
`01-build-default` logs `changed-pixel ratio=0.033947716346153844` against a
budget of `0.001`. Both images are **1280×2600**, so unlike F1 this is a **real
3.39% pixel diff**, not the sentinel.
Ruled change, named by comparing `test-ui/__screenshots__/leadgen-v31-gate1c/
01-build-default.png` (committed at `b8c302e`, Jul 21) with this pass's capture:
the **section-studio component library** changed. The ANSWER FIELDS group gained
a **"Phone"** tile (13 → 14 tiles) and **"Question grid" was renamed "Questions
on one screen"**. Every tile below the rename moves down one row (~70 px), and
the LAYOUT hint block plus the whole "Preview in a quote" bar below it shift
~15 px — which is where the 3.39% lives.
**Also NOT the theme-editor wrap fix**: that could only move states 6 ("Themes —
Navy") and 7 ("Themes — Bold Yellow"), and those never execute — state 1 fails
first and the remaining 6 states are cascade-skipped in the same serial describe.
Ship red: not rebaselined.

### F3 · Claims covered NOWHERE at browser level — stated plainly, not buried
1. **The browser-visible auction marker.** The ordering RULE is covered:
   `test/leadgen-funnel.test.ts` "auctionEntryPosition — the auction runs after
   the MAX position (no 'final' flag)" and `test/leadgen-quotes-api.test.ts`
   (`auction_entry_position` on the real variant + structure endpoints, ~lines
   490/514/757). What is uncovered is the **marker's DOM presence on a
   variant-PREVIEW render** — `quotes-handlers.ts` renders
   `data-auction-after-position` / "Auction runs after this section (§15.3 max
   position)" and **no `test-ui` spec drives it today**. Stated in-file at
   `test-ui/__p3b-structure.spec.ts:58-69`.
2. **The literal "Icon on track" label.** The only assertion of that exact
   string anywhere in `test-ui/` is inside the RETIRED `test.skip(...)` at
   `test-ui/__p5b-quotes-ia.spec.ts:425` (the 6-row `.lg-progress-style-opt`
   editor it drove was replaced by the §8.3 `.lg-tpl2-ptype` thumbnail grid).
   `PROGRESS_TYPE_OPTIONS` is the single render source and its option set is
   exercised by `leadgen-rework-p4-templates.gesture.spec.ts`'s Progress leg,
   but **no executing spec asserts the literal string**. Stated in-file at
   `test-ui/__p5b-quotes-ia.spec.ts:414-420`. For the record: the string IS
   rendered — it is legible in this pass's own captured admin screenshot
   (`test-artifacts/leadgen-v31-gate1c/01-build-default.png`, Progress panel,
   "Icon on track" style tile) — but a screenshot is not an assertion, so the
   claim stays listed as uncovered.

## G. Hygiene for this pass

- **`src/` untouched.** No product change was needed for either TASK 1 failure.
- Specs touched: `test-ui/leadgen-rework-acceptance-routing.gesture.spec.ts`
  (§D row 8) and `test-ui/__p6b-theme-mgr.spec.ts` (§D row 14). Nothing weakened;
  both re-points are ruling-grounded and carry the evidence in-file.
- `npx tsc --noEmit` exit **0**.
- `LEADGEN_RUNTIME_JS_BYTES = 52762` (≤ 53248) — unchanged, as expected with no
  `src/` change.
- Screenshot hazard handled: `leadgen-r2p4-fixfirst-drive.spec.ts` overwrote four
  committed captures under `docs/leadgen/r2/evidence/p4/fixfirst/`; those were
  restored with `git checkout -- docs/leadgen/r2/evidence/p4/`. After that,
  `git status --short` outside `docs/leadgen/r2/evidence/p6/` lists exactly the
  two spec files above. `test-ui/__screenshots__/` is untouched — no baseline was
  rewritten (both visual suites only write a baseline when one does not already
  exist; their per-run evidence copies go to `test-artifacts/`).
