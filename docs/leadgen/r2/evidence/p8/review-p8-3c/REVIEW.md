# P8-3 adversarial re-review #3 (fix rounds F10–F12) — FIX-FIRST

Reviewer: fresh-context adversarial review #3 for P8-3, SCOPED to F10–F12.
Branch `leadgen-r2-p8-3`. Gate sha **d804201**; branch HEAD **c3becc4** (verified: the only
diff is `docs/leadgen/r2/gate-logs/p8-phase-3-run7.log`, 2,923 insertions, no code).
Server: the already-running `wrangler dev` on 127.0.0.1:8901 — client only; nothing started,
stopped or bound. Nothing deployed, no secret read or written, no `--remote` D1.
Evidence: this directory (50 artifacts; `d*.png` screenshots at 1280 AND 375, `d*.json` raw
drive logs).

## Verdict: FIX-FIRST — 2 BLOCKER, 4 MAJOR, 6 MINOR (+3 informational)

**Round 3 changed the mechanism, and the mechanism is broken in use.** The clip reveal
withdraws its own tooltip on the operator's first hover, because applying
`text-overflow: ellipsis` collapses a `<select>`'s `scrollWidth` to its `clientWidth`, so the
very next `change`/`focusin`/`mouseover` reads "no longer clipping" and strips the title and
the ellipsis while the text is still clipped. And the N7 defect itself is still on screen on
the **Themes manager**, at 1280 and 375, in a string this phase's own F2 round wrote.

## Per-clause verdict table

| Owner clause (verbatim anchor) / register row | Drive evidence | Verdict |
|---|---|---|
| **N7** "theme is only design language!!!! colors, fonts, sizes" — the Themes **rail**'s selects don't truncate their own value | `d1-select-sweep.json`: EVERY option of all 16 rail scalars + `#lg-theme-hex-role` + `#lg-theme-preset-select` measured at 1280 and 375 — worst overflow **+0px** (content 312px, 90 options). `d1-rail-1280.png` shows the rail fully painted | **PERFECT** |
| **N7** second surface — the Themes **manager**'s font selects | `d3-mgr-typography-zoom-1280.png` / `-375.png` show `Roboto Mono (shows as default font⌄` with the closing paren cut and the chevron over the glyphs; measured `scrollWidth 294 > clientWidth 282`, `text-overflow: clip`, `title = null` | **DEVIATES** — BLOCKER-2 |
| **N7** unbounded case — the clip reveal on operator data | `d9-preset-A-after-change-1280.png` (revealed, real ellipsis) → `d9-preset-B-after-hover1-1280.png` (one hover later: hard-clipped `…Probe Theme With A⌄`, `title=null`) → `d9-preset-C-after-hover2-*.png` (revealed again). Same on `#lg-theme-site-select` (+31px) and `#lg-theme-target-select` (+281px), 1280 and 375 | **DEVIATES** — BLOCKER-1 |
| **N11** "to use them as presets in different 'Quotes'" — MAJOR-3 re-scope: the zero-preset panel gives ONE coherent instruction naming a place that exists | `d7-zero-preset-panel-1280.png` / `-375.png`: help "No presets saved yet — save one from the Themes manager, then it can be applied here." (312/312, painted as a blocked amber state), select "No presets yet" (0 overflow), both buttons greyed with a destination-naming title, `Manage all presets →` → `/admin/leadgen/themes` **200** with `id="tm-new-theme"` (`d7-destination-*.png`) | **PERFECT** |
| **N11 / MINOR-2+MINOR-5 (F10)** — a late catalog must recover; a settled island must keep no timer | Driven with the catalog GET held 13s: at 12.5s "Could not check for saved presets — reload the page to try again." + both disabled (`d8-latched-failed-1280.png`); at 18.5s the observer fires, both buttons **enable**, help reverts (`d8-after-late-catalog-1280.png`); `pendingTimers === 0` at 18.5s and 24.5s | **PERFECT** |
| **N20** "theme is only design language" — one font vocabulary | Rail and manager offer the identical 8 vendored families in the identical order; a stored non-vendored family stays selected and visible (driven on a theme I authored storing Roboto Mono + Newsreader) | **PERFECT** |
| **N1** "the rules you build are using jargon" — `funnelDesignLabel` may not hand back an engineering identifier | `quotes-handlers.ts:6992` is own-property guarded; no `throw` on the render path; completeness kept in `assertFunnelDesignLabelsComplete`. 14 driven editor loads all 200 | **PERFECT** |
| **M2 / REQ-R3** "theme is only design language" — a role's `used_by` must not describe less than the control does | Sentinel sweep through the real PUT route on the real served sheet: `brand_primary #FF00AA` → **15** declarations, only `.lg-range-stepper-btn` button-shaped ✓, progress fill ✓, focus rings ✓ — **but also** `.lg-frame-trustrow-icon`, `.lg-frame-freetext-list--check li::before`, `.lg-frame-footer2-list--check li::before`, unnamed. `border #00FF66` → **12**, `.lg-question-card` correctly absent ✓ — but `.lg-frame-progress--numbered .lg-step` and `.lg-frame-progress--percent .lg-progress-track` unnamed | **DEVIATES-partial** — MINOR-4, MINOR-5 |
| **Cross-product blast radius** (mission invariant) | Whole-phase `git diff 6649879..d804201 -- api/src/admin/templates/` = **0 bytes**; `conversions-admin-shell.test.ts` has no commit and no diff since the phase base and passes **11/11** (re-run by me); driven, `/admin` and `/admin/pages` carry **0** copies of the reveal and render clean (`d5-conversions-admin-*.png`, `d5-conversions-pages-*.png`) | **PERFECT** |
| **Visitor journey** (owner-facing runtime) | 7-step walk at 1280 and 375, advancing by the first VISIBLE `[data-lg-continue]` (matched=10 / visible=1 at every step), `scrollWidth == innerWidth`, 0 pageerrors, only the known expired-owner-Maps-key console line (`d6-visitor-sentinel-p0-*.png`, `d6-visitor-sentinel-last-*.png`) | **PERFECT** |
| **ADJ-P8-26** conductor ruling — "the reveal is NOT extended to three other leadgen pages … none clips (126/126 at 1280, 107/107 at 375)" | Measured: **eleven select-bearing** leadgen page routes lack the reveal, not three; and clipping exists on them — `/admin/leadgen/quotes` `activity` +2px at 375, `/admin/leadgen/sections` 4/4 selects clip at 375 (to +31px), `/admin/leadgen/offers` 7/7 at 375 (to +79px), Section Studio `#lg-preview-theme` +35px at **both** widths on an operator-authored theme name (`d5-uncovered-pages.json`, `d5-section-editor-*.png`) | **DEVIATES** — MAJOR-2 |

## Every deviation found — listed before ranking

1. `#tm-headline-font` / `#tm-body-font` clip `Roboto Mono (shows as default font)` by +12px at 1280 AND 375.
2. The reveal oscillates: every `change`/`focusin`/`mouseover` toggles it on/off, because its own ellipsis collapses `scrollWidth`.
3. The reveal never fires at load on the Themes manager (boot sweep measures before the previewed web font applies; nothing re-measures).
4. The reveal ignores an option's text changing in place after boot (`#lg-theme-hex-role` 290→531px, no title).
5. The reveal ignores a viewport resize that starts a clip (`#lg-theme-site-select` 253/222, `title=null`).
6. The shipped box invariant is GREEN while the browser clips: `textWidthPx` is font-family-blind (model 255.08px vs browser 294px).
7. ADJ-P8-26 names 3 uncovered leadgen pages; there are ≥11, and three of them really clip.
8. The retirement ledger's `(R) 86 + (M) 2` decomposition is wrong (really 87 + 1).
9. `expect(decl(formSelect,"width")).toBe("100%")` retired and re-asserted nowhere.
10. The test file still states the reveal "lives in templates/layout.ts's ADMIN_SCRIPTS … EVERY admin page" — false at this HEAD, and load-bearing for 70 un-boxed selects.
11. `brand_primary`'s `used_by` omits 3 unconditional painted surfaces.
12. `border`'s `used_by` omits 2 unconditional painted surfaces.
13. A theme with a long name can never be renamed or deleted — PATCH-with-change and DELETE both 500; the manager shows "Internal Server Error" (pre-existing, `themes-handlers.ts` untouched by P8-3).
14. Residual from this drive: one orphan theme record left in local dev KV because of (13).
15. The Themes rail intro still reads "affects every **slide** …" (already ADJ-P8-16, allocated P8-4).
16. At 375 the manager header clips ("+ New them", theme title cut) — pre-existing, not F10–F12.

## Ranked

### BLOCKER-1 — the clip reveal destroys its own tooltip on the first hover
- **Violates:** register **N7**, anchor *"theme is only design language!!!! colors, fonts, sizes"*. This is the mechanism F12 shipped as the whole answer to N7's unbounded (operator-data) case.
- **Where:** `api/src/admin/leadgen/clip-reveal.ts:67-75` — the reveal applies `sel.style.textOverflow = 'ellipsis'`, and Chromium then reports `scrollWidth == clientWidth` for that select. The withdrawal branch's predicate is the same `sel.scrollWidth > sel.clientWidth`, so it is FALSE on the next event and the title + ellipsis are stripped while the text is still clipped.
- **Measured, driven on a theme I authored this session** (`RV3C Reveal Oscillation Probe Theme With A Deliberately Long Operator Name 8f21`, chosen in `#lg-theme-preset-select`), identical at 1280 and 375:
  | event | scrollWidth/clientWidth | title | data-lg-clipped | text-overflow |
  |---|---|---|---|---|
  | change (pick it) | 312/312 | full name | 1 | ellipsis |
  | mouseover #1 | **545/312** | **null** | **null** | **clip** |
  | mouseover #2 | 312/312 | full name | 1 | ellipsis |
  | mouseover #3 | **545/312** | **null** | **null** | **clip** |
  Reproduced on `#lg-theme-site-select` (+31px at 1280, +14px at 375) and `#lg-theme-target-select` (+281px) — and on the target select the reveal is **already absent immediately after the operator picks the long funnel**, because the island's repopulation fires the observer sweep in the ellipsis-applied state.
- **Failure scenario:** an operator picks a long preset/funnel/site, moves the mouse onto the control to read the rest, and the hover itself removes the tooltip and returns the control to hard-clip. Every second hover works. The affordance N7's (B) branch depends on is unstable by construction.
- **Why the suite cannot see it:** `test/leadgen-p8-n-theme-ui.test.ts:1535-1580`'s `runReveal` builds a plain object with `scrollWidth` as a fixed number and a `style` bag; setting `style.textOverflow` on that object cannot change `scrollWidth`, so the interference is invisible to all four "EXECUTED" reveal legs (E11: both sides of the boundary are hand-built).
- **Screenshots:** `d9-preset-A-after-change-1280.png` (ellipsis + tooltip) vs `d9-preset-B-after-hover1-1280.png` (`…Probe Theme With A⌄`, hard clip, no tooltip); same pair at 375.

### BLOCKER-2 — the Themes manager still truncates its own value, in a string this phase wrote
- **Violates:** register **N7** (second surface), same anchor. Fourth consecutive round in which a copy fix lengthens a label past a box nobody re-measured.
- **Where:** the label `"(shows as default font)"` (F2) applied to the non-vendored families in `api/src/admin/leadgen/ui-theme-manager.ts`'s font rows, rendered into `#tm-headline-font` / `#tm-body-font` (`ui-theme-manager.ts:1037-1039`, `[data-pin="8.4-typography-grid"]`).
- **Measured, driven on a theme I authored** (`RV3C Clip Audit Theme 8f21`, headline `Roboto Mono`): `scrollWidth 294 > clientWidth 282` (**+12px**) at 1280 AND 375; `text-overflow: clip`; `title = null` at load and still null after `document.fonts.ready`. Also reproduces on the seeded `P8 Repro` theme, which is the manager's default selection — this is the first thing an operator sees on `/admin/leadgen/themes`.
- **Why the reveal does not save it:** the select paints in the family it names (`font-family:'Roboto Mono',monospace` inline), which is not applied when the boot sweep runs; the reveal has no font-load leg and no resize leg, so it never re-measures. A manual `window.lgRevealClippedSelects(document)` from the console DOES set the title — the mechanism works, the timing does not.
- **Failure scenario:** the operator reads `Roboto Mono (shows as default font` with the `)` cut off and the chevron over the glyphs, with no tooltip — N7's own sentence, one surface over.
- **Screenshots:** `d3-mgr-typography-zoom-1280.png`, `d3-mgr-typography-zoom-375.png`, `d2-mgr-typography-1280.png`.

### MAJOR-1 — the invariant that exists to stop recurrence #5 is green while the product clips
- **Violates:** register **N7** + DoD §8 ("no assertion weakened"): the replacement for the 88 retired legs does not catch the live defect on a select it explicitly claims.
- **Where:** `api/test/leadgen-p8-n-theme-ui.test.ts:333-344` `textWidthPx(text, fontPx)` models ONE proportional font. The manager's two font selects are the only controls in the product that paint in the family they name. Model for `"Roboto Mono (shows as default font)"` at 14px = **255.08px**; the browser reports **294px** — a 38.9px under-statement, on a string the retirement ledger's Leg 1 pins as inside the checked universe.
- The file's own guarantee — *"the model must never UNDER-state a width the browser really produced"* (`:346-349`) — is falsified. All 29 calibration samples were measured in the admin UI font; none in a serif or monospace family.
- **Verified by re-running only the diff-touched files** (never the suite): `test/leadgen-p3a-split-parity.test.ts` 12, `test/leadgen-p8-n-theme-ui.test.ts` 70, `test/conversions-admin-shell.test.ts` 11 = 93 passed at HEAD, while the browser clips.
- **Screenshot:** `d3-mgr-typography-zoom-1280.png` (the clip the green test says cannot exist).

### MAJOR-2 — ADJ-P8-26's ruling rests on two false measurements
- **Violates:** the register's own truth standard (an owner ruling must be made on data) and mission-loop's "surfaced, never mis-stated".
- (a) *"That leaves three leadgen pages (quotes list, /quotes/new, quote-not-found) without it."* Measured by HTTP: the reveal is absent from **`/admin/leadgen/quotes` (3 selects), `/quotes/new` (2), `/sections` (4), `/sections/new` (92), `/sections/:id/edit` (92), `/offers` (10), `/offers/new` (10), `/offers/:id/edit` (39), `/auction` (3), `/auction/new` (2), `/auction/:id/edit` (20)** plus the quote-not-found shell (0) — **eleven select-bearing leadgen routes, not three**. Under F10 (shared shell) all of them had it; F12 removed it from all of them and the row disclosed 3.
- (b) *"F12 drove all three filter selects and none clips (126/126 at 1280, 107/107 at 375)."* Measured at 375, `/admin/leadgen/quotes`'s `activity` select clips (`scrollWidth − clientWidth = +2`, "auto-insurance"). And on the routes the row does not name: `/admin/leadgen/sections` **4 of 4** selects clip at 375 (to +31px), `/admin/leadgen/offers` **7 of 7** clip at 375 (to +79px), and the Section Studio's `#lg-preview-theme` clips an **operator-authored theme name** by **+35px at 1280 AND 375** with `title=null` — precisely the (B) case the reveal exists for, on a page that no longer has it.
- **My judgment on the ruling:** the *decision* (do not extend under N7) is defensible on clause scope; the *evidence* is not, and the owner cannot rule on it as written. Either restate the row with these numbers, or apply the 2-line `leadgenPageShell` include the row itself identifies.
- **Evidence:** `d5-uncovered-pages.json`, `d5-section-editor-1280.png`, `d5-section-editor-375.png`.

### MAJOR-3 — the reveal's "no list, no gate, covered on the same terms" claim is narrower than the code
- **Violates:** `clip-reveal.ts:14-22`'s own coverage sentence (*"a select added tomorrow, on any surface that includes this script, in any container, is covered on the same terms"*).
- **Measured, driven:** (i) an option whose **text changes in place** after boot is not seen — `#lg-theme-hex-role` went `290/290 → 531/290` after `option.textContent = <long>` and stayed `title=null, data-lg-clipped=null` 400ms later. `lgTouchesASelect` (`clip-reveal.ts:109-122`) matches only `rec.target.nodeName === 'SELECT'` or added/removed `SELECT`/`OPTION` nodes; a replaced text node inside an `OPTION` matches none. (ii) a **resize** that starts a clip is not seen — after 375→1280, `#lg-theme-site-select` measured `253/222` with `title=null`. (iii) a **web-font load** that widens the text is not seen (BLOCKER-2).
- Today's product path that repopulates the preset picker uses `createElement('option') + appendChild` (`funnel.ts:4004-4011`), so it IS caught — the gap is the stated generality, and (ii)+(iii) are reachable now.

### MAJOR-4 — a theme the product lets you create can never be renamed or deleted (pre-existing, outside every clause)
- **Found by driving** the Themes manager this session; `api/src/admin/leadgen/themes-handlers.ts` is untouched by P8-3, so this is NOT an F10–F12 regression — it is surfaced per mission-loop rather than silently deferred.
- **Measured, isolated:** with an 83-character theme id (from a 79-character operator name), `PATCH /api/admin/leadgen/themes/:id` with a real change → **500** (and the write lands anyway), `DELETE` → **500**, twice; `GET` and `POST` → 200. A freshly created 25-character id → PATCH 200, DELETE 200. The only code shared by the two failing paths is `findFunnelsReferencingTheme` (`themes-handlers.ts:419-433`), whose bound `LIKE` pattern is 98 characters for the long id and 40 for the short one. Root cause beyond that isolation: UNVERIFIED.
- **Operator-facing:** clicking **Delete theme** paints `#tm-error` = **"Internal Server Error"** at 1280 and 375 (`d10-delete-500-1280.png`, `d10-delete-500-375.png`) — an unreachable operation plus a raw status as the reason (contract R5's class, ADJ-P8-12's shape). No name-length validation exists on create.

### MINOR-1 — the retirement ledger's decomposition of the 88 is wrong
`api/test/leadgen-p8-n-theme-ui.test.ts:1695-1702` states "(R) 86 legs — one per `<option>`" and "(M) 2 legs — one per Themes-manager font select". At `8f57f27` the rail block was **87** legs (1 structural — *"the rail really is the container this arithmetic describes"* — plus 86 per-option) and the manager block was **1** leg that looped both selects internally. Total 88 is right; the attribution is not, and the ledger's entire purpose is to account for each retired claim.

### MINOR-2 — one claim the 141 made is now unenforced
The retired rail leg asserted `expect(decl(formSelect, "width")).toBe("100%")` against the SHARED `.form-select` rule (`api/src/admin/templates/layout.ts:469`). Nothing asserts it now (grep over `api/test`: zero hits). The replacement machinery short-circuits `claimsFullLine` on the class name (`:791-793`), so if that cross-product rule ever became `width:auto` the invariant would keep assuming a full-line box and silently over-state every measurement instead of failing.

### MINOR-3 — the test file's coverage argument still describes a mechanism F12 deleted
`api/test/leadgen-p8-n-theme-ui.test.ts:535` and `:560-564` still read *"the clip-reveal in templates/layout.ts's ADMIN_SCRIPTS"* and *"it lives in templates/layout.ts's ADMIN_SCRIPTS, which adminLayout and adminStandalonePage interpolate into EVERY admin page — so it covers … every other admin surface"*. The same file's F12 block (`:1626-1636`) asserts ADMIN_SCRIPTS must contain none of it. This is load-bearing: it is the stated reason 70 board selects and all five `OUT_OF_COVERAGE` rows are left un-boxed. (The board is in fact still covered, via the Themes panel include — the reason given is what is false.) Same class as review #2's MINOR-4.

### MINOR-4 — `brand_primary`'s `used_by` still describes LESS than the control does
Sentinel `#FF00AA` through the real `PUT /funnels/:id/theme`, read off the real served sheet: **15** declarations move. The three nouns are true (`.lg-range-stepper-btn` is the only button-shaped one; `.lg-progress-fill`; `:focus-visible` outlines on `.lg-btn-answer` and `.lg-card`). Unnamed and unconditional: `.lg-frame-trustrow-icon{color}`, `.lg-frame-freetext-list--check li::before{color}`, `.lg-frame-footer2-list--check li::before{color}`. F8's own rule ("must not describe LESS than the control does") is not met. None of the three renders on the driven funnel, so nothing on screen is falsified today.

### MINOR-5 — `border`'s `used_by` likewise describes less
Sentinel `#00FF66`: **12** declarations. `.lg-btn.lg-btn-answer`, `.lg-card`, `.lg-input` are named and correct, and `.lg-question-card` is correctly NOT among them (F11's claim holds — driven, it stayed `rgb(233,237,243)`). Unnamed and unconditional: `.lg-frame-progress--numbered .lg-step{border:2px solid}` and `.lg-frame-progress--percent .lg-progress-track{box-shadow:inset …}`.

### MINOR-6 — the Themes manager header clips at 375 (pre-existing, not F10–F12)
`d3-mgr-mytheme-375.png`: the "+ New theme" button renders as "+ New them", the truncated intro reads "feel per funnel · A/B-testable" cut mid-word, and the selected theme title is cut. `document.scrollWidth == innerWidth == 375`, so nothing on screen says so. `.tm-shell`'s header is outside the `.tm-body` row F10 changed; review #2's MAJOR-1 (the 56px centre pane) IS fixed — the centre pane is now 341px at x=17 with both font selects on screen.

### Informational
- **My drive left one residual, disclosed:** theme record `thm_rv3c-reveal-oscillation-probe-theme-with-a-deliberately-long-operator-name-8f21` (renamed "RV3C short") remains in the LOCAL dev KV because MAJOR-4 makes it undeletable through the product. No funnel references it (the 409 in-use guard never fired and I never applied it). The other two themes I authored were deleted 200/200. Funnel A's `theme_json` is restored to `{"theme_id":"thm_p8-repro"}`, verified by GET. `git status` shows only this evidence directory.
- **The rail's intro copy** still reads *"affects every **slide** and every component default of this funnel"* (`d1-rail-1280.png`) — already inventoried as ADJ-P8-16 / contract M9, allocated to P8-4. Re-confirmed live on the P8-3 surface, not re-raised.
- **`/admin/pages`** (a conversions/CMS page) has a clipping `site_id` select (+15px at 1280, +53px at 375). Correctly outside leadgen scope — recorded because it is the page the blast-radius fix protects.

## Audits that PASSED

**Gate log** (`docs/leadgen/r2/gate-logs/p8-phase-3-run7.log`): stamped `HEAD: d804201…` == the branch HEAD at gate time (`git diff d804201..c3becc4` = the log file only, no code). `[status-empty=yes]`. All five exit markers present and zero: `TYPECHECK_EXIT=0`, `VITEST_EXIT=0`, `VERIFY_ALL_EXIT=0`, `RUNTIME_EXIT=0`, `REGISTER_EXIT=0`. **Counts recomputed by hand** by summing every `✓/↓ test/… (N tests | M skipped)` line in the raw text: **487 files, 8,137 tests, 30 skipped, 8,107 passed, 0 `×` markers** — identical to the stamped summary (the 561 "failed" strings in the log are all the `site_settings read failed` fallback log line). `verify:all` 0 with `jargon TOTAL: 0 hit(s)`; `verify:leadgen-runtime` `52938 bytes, 99.4% of budget` ≤ 53,248; `check_register` `rows checked: 70 / TOTAL violations: 0` — I counted 70 data rows in `P8-REGISTER.md` independently.

**Zero-drift, recomputed independently:** `git diff --name-status f240788..d804201 -- api/test` = 17 additions, **0 deletions**; 16 of the 17 are `.test.ts` and their per-file counts in run 7 sum to **exactly 413** (the 17th is `test/helpers/leadgen-visible-paint.ts`). The only pre-existing file whose count moved is `leadgen-r2-dead-controls-guard.test.ts` 26 → 58. `7724 + 413 = 8137` ✓. Per-file diff run5 → run7 is exactly three files: `f5-major3-minor5` 5→8, `m2-role-usedby` 81→82, `n-theme-ui` **141→70**; −67 net, and 8204 − 67 = 8137 ✓. The `141 → 63 → 70` chain is checkable in the raw logs (run4/5 = 141, run6 = 63, run7 = 70), and `141 − 88 + 10 = 63`, `+7 = 70` reconciles.

**Cross-product blast radius genuinely removed.** `git diff 6649879..d804201 -- api/src/admin/templates/` is empty; the whole phase's `api/src` diff touches only `admin/leadgen/**` plus three leadgen-runtime design files. `test/conversions-admin-shell.test.ts` has **no commit and no diff** since the phase base and passes **11/11** (re-run by me, unedited). Driven: `/admin` and `/admin/pages` carry zero copies of the reveal, render with no console errors, and `window.lgRevealClippedSelect` is `undefined` there; the two leadgen theme surfaces carry exactly **one** copy each.

**MAJOR-3 (re-scoped) is genuinely coherent on screen**, not only in the assertion — see the per-clause table. The assertion itself is not weaker: both zero-state literals are sliced out of the real served island bytes, both are checked against `IN_PAGE_LOCATOR`, their concatenation must still name the destination, and the panel's own link is followed through the real router (200 + the destination page names itself "Themes").

**`funnelDesignLabel`** is own-property guarded at `quotes-handlers.ts:6992`; no `throw` is reinstated on the render path; `assertFunnelDesignLabelsComplete` keeps the completeness guarantee and is exercised both ways.

**p3a recapture #6** is legitimate: `leadgen-p3a-split-parity.test.ts` re-renders each page through the live code and byte-compares (12/12 at HEAD, re-run by me), so a hand-edited fixture cannot pass. The deltas are exactly what the F12 move predicts — the reveal's 118 lines leaving `quotes-list-empty`, `quotes-new`, `quotes-not-found` and `quotes-list-seeded`, 79 lines arriving in `editor-panel-themes`, `editor-full` net −39 — plus a ULID rollover in `quotes-list-seeded` (whose `data-entity-name` XSS fixture is correctly escaped: `&lt;img src=x onerror=alert(1)&gt;`).

**No test weakened across F10–F12.** Every removed `expect(` is either one of the two retired box blocks (accounted above; the one genuine loss is MINOR-2) or a same-line strengthening: the two `used_by` strings, and MAJOR-3's single `toMatch(/Themes manager/)` on the placeholder replaced by five panel-level assertions including a live 200 on the destination. No `it.skip`/`.only`/`it.todo` added.

**Reduced-model hunt.** Diff-scoped deferral scan over every added line in `api/`: `\b(TODO|FIXME|HACK|XXX)\b`, "polish later", "for now", `defer(red)? to (v2|later|a follow-up)`, `simplified for (now|v1)`, `will be (done|added) later` → **0 hits**. Marker-free: the reveal is not a stub (it works when invoked), the preset states are real and confirmed, the zero-preset arm was reached by fulfilling the real catalog route, and every state I judged was authored this session. The reduced models I did find are the ranked ones: the reveal's coverage is narrower than its own sentence (MAJOR-3), and the box model is narrower than the fonts the product paints (MAJOR-1).

**Every-consumer proof.** `ADMIN_SCRIPTS` (shrunk back): 2 consumers, `adminLayout` (`layout.ts:380`) and `adminStandalonePage` (`:416`) — both proven byte-identical by the untouched conversions test and driven clean. `LG_CLIP_REVEAL_SCRIPT` (new): 2 consumers, `quotes-tabs/themes.ts:1594` and `ui-theme-manager.ts:1510` — both verified served, once each. `ROLE_META` (both tables): rail + manager, both verified in the live markup. `funnelDesignLabel`: `listFunnelDesignOptions` on the editor render path, driven 200. `.tm-body` / centre-pane changes: manager only, driven at both widths.

**Security.** No SQL, `innerHTML`, `document.write`, `eval`, `new Function` or `process.env` in the F10–F12 `api/src` diff. The reveal writes only `setAttribute('title', …)` and `style.textOverflow` — operator data reaches the DOM through attribute APIs, never markup. No new route, no authz change. `api/.dev.vars` untouched (both `GOOGLE_MAPS_*` slots left empty, as required). Nothing deployed, no `wrangler secret`, no `--remote` D1.

**Silent failures.** The late-catalog fallback no longer masks recovery (driven). The reveal's failure mode is the opposite of silent-but-wrong: it is *visibly* unstable (BLOCKER-1). The one genuinely silent path found is MAJOR-4's 500, which the manager surfaces as a raw status string.
