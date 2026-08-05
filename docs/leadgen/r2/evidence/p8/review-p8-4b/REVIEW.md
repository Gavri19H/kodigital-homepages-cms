# P8-4 fix-round re-review (F4–F8) — FIX-FIRST

Scope: the fix rounds only (gate sha **ba9c61e**, HEAD `4ecb47b9` = the run-4 gate-log commit;
`git diff ba9c61e 4ecb47b9 --stat` touches only `docs/leadgen/r2/gate-logs/p8-phase-4-run4.log`).
Reviewer drove the running instance on :8901 as a client (never started/stopped/bound it).
Evidence: `docs/leadgen/r2/evidence/p8/review-p8-4b/` (37 artifacts, 1280 + 375).

Everything authored during this review was restored and verified byte-identical:
`leadgen_funnels` for quote 1 diffs **IDENTICAL** against the pre-review snapshot
(funnel A back to `frame_config_json = {}`, `frame_template_id = NULL`, `theme_json` untouched);
the 5 funnels I created through the UI are deleted; the forked arm is deleted, its experiment
stopped and its `leadgen_funnel_ab_tests` row removed; variant A's `traffic_allocation_bp` is
back to 10000. `git status --porcelain` shows only the new evidence directory.

## Per-clause verdict table (the fix rounds' own claims)

| Fix claim (owner clause / register row) | Drive evidence | Verdict |
|---|---|---|
| **F-1** — the apply dialog no longer counts a previous apply's writes as operator customisations (M3, *"I should be able to create as many templates I want, to save them, and to use them as presets in different 'Quotes'"*) | `j1a-apply1-confirm-1280/375.png`, `j1b-apply2-confirm-1280/375.png`, `j2b-apply3-after-operator-edit-1280/375.png` — apply #2 on a pristine funnel shows 8 true sentences and **no** customisation line; after one real UI edit the dialog shows *"1 setting you had customised is replaced by this template."* | **DEVIATES** — the claimed scenario is fixed exactly (`[]`, `[]`, `["progress.style"]`), but the same prune now **deletes operator-authored leaves and under-reports them**: see **F-B** below (`j12` log). |
| **F-2** — applying a template no longer disables A/B templating (M3, A/B leg) | `j3a-ab-dialog-1280/375.png` (5 non-current templates report 3–7 changed settings on an APPLIED funnel), `j3b-visitor-armA-1280/375.png` vs `j3b-visitor-armB-1280/375.png` | **PERFECT** — a real fork through the product's own A/B dialog, rendered as a visitor: arm B (Full background) paints a brand-blue page + white card + footer; arm A (the funnel's Minimal) paints a light page, **no card surface**, no footer. The operator's own `progress.style:numbered` correctly survives on both arms. |
| **F-3** — "slides" gone from every operator-facing surface (M9 / ADJ-P8-16, *"I clearly defined the difference between pages and sections"*) | `j7a-activation-1280/375.png` — the publish blocker reads **"Section 1 shows no question headline. [Edit Section]"** | **PERFECT** — a DOM text+attribute walk over all six tabs (builder/templates/themes/ab/activation/analytics) finds exactly one `slide` hit on each: `"Used by: range-slider focus ring"` (the component word "slider"). Source: the only survivors are the `slide` local, `slideList`, the dead `.lg-slide-current` hook and Conversions' `toastSlideIn` — no operator copy. |
| **F-4** — consecutive funnels get distinct names (N6, *"add button of 'add funnel', user should be able to add as many funnel he wants"*) | `j8a-three-new-funnels-1280/375.png`, `j8b-after-rename-add-1280.png` | **PERFECT** — driven through `[data-add-funnel]`, read back from storage: `New funnel 1/2/3` (POST bodies `{"funnel_name":"New funnel N"}` — wire key and regex both live); delete "New funnel 2" then add → **New funnel 4**; manual rename to "New funnel 9" then add → **New funnel 10**; rename every match away then add → **New funnel 1**. No collision in any of the four attacks. |
| **F-5** — thumbnail bands no longer show what the template disables (M10) | `j7b-templates-chips-1280.png`, `j7b-saved-chips-zoom.png`, `j9c-visitor-white-trust-1280/375.png` | **PERFECT (bands)** — record 5 "White + trust bar" now emits `logo/progress/slot--bare/footer` and **no** `lg-tpl-trust`; the live page for that template really renders no trust region (`trustRegion:false`, regions = header/progress/slot/back/footer). Residual: the template's **name** still promises the bar — **F-E** below. |
| **F-6 / ADJ-P8-32** — dead media blob paints a bare disc | not re-driven (owner ruling pending) | **UNCHANGED** — confirmed still owner-owned, not re-filed. |
| **F-7/F-8 — `section_slot.card`** paints (§4 R3 *"a control that cannot be honoured must not be offered"* / M2 sweep) | `j3b-visitor-armA/armB`, `j10-header-footer-AFTER-F8-1280/375.png` | **DEVIATES** — the paint is real and visible (bare: background `rgba(0,0,0,0)`, border transparent, radius 0, shadow none; card: white + 16px + shadow), **but** it silently changes 3 of the 6 shipped templates and invalidates a committed frozen baseline — **F-A (BLOCKER)**. |
| **F-7/F-8 — `section_slot.padding`** paints | `j5-pad-s-1280/375.png`, `j5-pad-l-1280/375.png`, `j5-default-1280/375.png` | **PERFECT (paint + default)** — measured `.lg-content` block padding s/m/l = **16/24/32 px** at 1280 and **8/16/24 px** at 375, inline axis untouched, card top moves 145→153→161. `m` computes byte-identically to no-key (24/24/24/24 at 1280; 16 all round at 375). Residual: the key has no operator control at all — **F-D**. |
| **F-7/F-8 — `section_slot.transition`** paints | `j5-transition-fade-1280.png` vs `j5-transition-none-1280.png`, `j6-fade-step1/step2-1280.png` | **DEVIATES** — the animation is real on first paint (opacity 0.376 @80 ms, 0.684 @160 ms, 1 @900 ms; `none` → `animationName:none`, opacity 1 throughout), but it never fires on a section change and cannot be switched off from any operator surface — **F-C (MAJOR)**. |
| **F-8 — four extra confirmation sentences** (M3 confirm dialog) | `j1b-apply2-confirm-1280.png`, `j2b-apply3-…-1280.png` | **PERFECT** — driven and true: *"Progress moves under the header."*, *"The back link moves under the header."*, *"The header stays on screen as the visitor scrolls."*, *"The page background colour becomes page background."*, each matching the served frame. |
| **F-9 — the apply dialog has a rejection handler** (M3) | `j9a-apply-fetch-rejected-1280/375.png`, `j9b-apply-http500-1280.png` | **PERFECT** — with the dry-run request aborted at the network layer the dialog stays in the choose state and paints a visible 600×47 alert **"Could not preview this template."**; the HTTP-500 branch still shows the server's own message. |
| **ADJ-P8-33** (unlink keeps the look) | `j11` log | **UNCHANGED** — `{template_id:null}` returns `changes: 0`, the served frame keeps `background.style=brand` / `section_slot.card=card`, column keeps `template:"full-background"`. |
| **ADJ-P8-34** (`mobile.trust_strip_mobile` out-ranks `trust_strip.mobile`) | source | **UNCHANGED** — and the sweep's `omit` for it is honest: `FrameMobileConfig.trust_strip_mobile` is optional and unset by default, so the sibling really is absent on an untouched funnel. |

## Gate-log audit (recomputed, nothing re-run)

`docs/leadgen/r2/gate-logs/p8-phase-4-run4.log`
* `HEAD: ba9c61e3c6d613c2b9c0d3bbfd654fe7896431a4` == the gate sha; `[status-empty=yes]`.
* All five exit codes present: `TYPECHECK_EXIT=0`, `VITEST_EXIT=0`, `VERIFY_ALL_EXIT=0`, `RUNTIME_EXIT=0`, `REGISTER_EXIT=0`.
* Recomputed from the raw text: `Test Files 491 passed | 2 skipped (493)`, `Tests 8235 passed | 30 skipped (8265)`; 8235+30 = 8265 ✓; no `failed` token in the summary.
* bundle `52930 bytes, 99.4% of budget` (cap 53,248) ✓ · jargon `TOTAL: 0` ✓ · golden `UNCLASSIFIED 0` / stale 0 ✓ · register `rows checked: 79 / TOTAL violations: 0` — independently recounted the register's data rows → **79** ✓.
* Zero-drift, recomputed my own way (per-file `✓ test/… (N tests)` lines, run2 vs run4): **nothing removed**; exactly three files moved — `leadgen-r2-dead-controls-guard 58→63`, `leadgen-p8-s4-3-board-chip 11→12`, `leadgen-p8-m3-apply-template 12→17` — plus one new file `leadgen-p8-f4-apply-dialog-reject (2)`; +13 = 8252 → 8265 ✓. Against the phase baseline: 22 new `*.test.ts` files whose run-4 counts sum to **exactly 536** ✓, 0 deleted, and only `leadgen-r2-dead-controls-guard` changed among pre-existing files ✓.
* `[R3 sweep] … TOTAL=130` recomputed: 34+25+67+4 = 130 ✓; `SWEEP_EXEMPTIONS` gained no entry (diff touches it only in new assertions) ✓.
* `api/src/admin/templates/**` byte-unchanged against the phase baseline `f240788` (empty diff) and `api/test/conversions-admin-shell.test.ts` unedited ✓.
* No `wrangler deploy|secret`, no `--remote`, no `npm update|upgrade` in the diff; `api/.dev.vars` `GOOGLE_MAPS_BROWSER_KEY` and `GOOGLE_MAPS_SERVER_KEY` both length 0 ✓.
* p3a recapture: 61 candidate visible strings extracted from the fixture diff; 59 exist verbatim in `api/src`; the 2 that do not are the capture run's own quote id (`lgq_01KZ665HHSVTKN6NYV179AA86W`) and an HTML-escaped composition (`&lt;b&gt;Quote&lt;/b&gt; — Funnel A (Default)`). No sign of a hand-edited fixture ✓.
* One gate-log weakness, stated: the zero-drift **arithmetic line is tautological**. `baseline := total − new_file_tests` (run2 printed 7724, run4 printed 7729 for the *same* baseline commit `f240788`, differing by exactly the dead-controls-guard delta), so `baseline + new = total` can never fail and a changed pre-existing file's delta is absorbed into "baseline". The real f240788 total implied by the run-4 numbers is 7692, not 7729. The per-file removal/change list above it is the part that actually has teeth.

## Test-pin audit (F4–F8 re-mints)

| Pin | Old | New | Weaker? |
|---|---|---|---|
| `m3-apply-template` — column contents after apply | asserts the template's values were COPIED into `frame_config_json` | asserts the column carries **no echo** (`storedFlat.has(...) === false` ×3) while the SERVED frame and the builder's hydration source carry them | No — the same requirement, asserted where it is true |
| `m3-apply-template` — customisation sentence | `toContain(\`${replaced.length} settings …\`)` (self-referential) | `expect(replaced).toEqual(["back.label"])` + the singular sentence + `not.toContain("settings you had customised")` | No — strictly stronger (the old form could not fail) |
| `m3-apply-template` — 3 new legs (three applies, pre-apply edit, fork→render) | none | real routes + real renderer, `htmlA ≠ htmlB`, per-leaf class assertions | New, stronger |
| `m3-apply-template` — thumbnail bands | none | bands == the regions the real renderer emits, both directions | New, stronger |
| `s4-3-board-chip` — addFunnel ordinal | `BOARD: { funnels: new Array(n).fill(0) }` (hand-built, no names) | the REAL `#lg-board-data` blob from the REAL admin page for REAL API-created funnels; the old distinctness assertion kept verbatim | No — removes an E10/E11 hand-built-both-sides shape |
| `f1-progress-letters-thumbs` — icon paint | `diff.some(c => c.classes.includes("lg-frame-progress"))` (class only) | the `::before` layer itself: `background-image === url("/media/brand-mark.png")`, selector contains `.lg-progress-fill::before`, and absent when no image | No — strictly stronger |
| `dead-controls-guard` — probe contexts | 6 entries, `patch` only | 8 entries incl. 2 `omit`s, each with a reason >120 (>400 for an omit), pinned key list, `template`'s omit asserted to cover every group, `compat` proven template-invariant | No — new floor |
| `dead-controls-guard` — class-change invariant | one direction (class alone ≠ paint) | both directions incl. a sabotage leg that deletes the rules a live class flip selects and requires the runner to NAME the key | No — stronger |
| `glossary-lint` C6 calibration | anchored on real operator COPY (`"…affects every slide…"`, `"Progress counts the slides…"`) | anchored on residual non-copy plumbing + two positive `toContain`s on the new wording | **Weaker in kind** — see F-F |

No assertion was deleted in F4–F8.

## FINDINGS — all listed, then ranked

### BLOCKER

**F-A — F8's `--bare` CSS changes 3 of the 6 shipped frame templates and invalidates a committed
frozen visual baseline; it shipped with a "no-op at the shipped defaults" rationale, no Playwright
run and no pixel evidence.**
Register rows: §4 R3 / M2 sweep (the clause F8 was serving) and §10.4 (screenshots for anything visual).
`api/src/public/leadgen/designs/default-funnel/styles.ts:2649-2654` adds
`.lg-frame-slot--bare .lg-question-card { background:transparent; border-color:transparent; border-radius:0; box-shadow:none }`.
`section_slot.card:"bare"` is shipped by **three** of the six built-ins —
`header-footer`, `white-trust`, `minimal` (`api/src/public/leadgen/designs/frames.ts:735-793`) — so
this is not a no-op for them, it is a full removal of the question unit's surface.
Driven at HEAD with the `Site header + footer` record applied to funnel A
(`j10-header-footer-AFTER-F8-1280.png`, `…-375.png`): `.lg-question-card` computes
`background rgba(0,0,0,0)`, `border-color rgba(0,0,0,0)`, `border-radius 0px`, `box-shadow none`
at BOTH widths — the unit is invisible chrome-wise.
The committed frozen baseline for exactly that template —
`api/test-ui/__screenshots__/leadgen-v25/pattern-b-desktop.png` and `-mobile.png`, the §15.4
regression pair for the fixture seeded `frame: { version: 1, template: "header-footer", … }`
(`api/test-ui/leadgen-patterns-v25.spec.ts:909-911`, shot via `toHaveScreenshot` with
`maxDiffPixels: 200`) — shows that same unit as an **opaque white card with a 16 px radius and a
drop shadow, ~420×320 px**. The changed region is >100,000 px against a 200-px tolerance.
The phase gate runs no Playwright, so nothing caught it, and the fix round produced no screenshot
of a bare-slot template at all. Two things must happen before this can ship: the visual change to
three shipped templates needs the owner's sign-off (it is a design change nobody asked for, made to
turn a sweep predicate green), and the frozen pair must be resolved by decision — never
re-baselined silently.
(`leadgen-visual.spec.ts`'s own `leadgen-runtime-*.png` pair is *not* at risk: its funnel resolves
to `centered` → `card`, `--pad-m` computes to today's values, and it captures with
`animations: "disabled"`. That half of the dispatch's question is answered PASS by measurement.)

### MAJOR

**F-B — the F4 prune silently DELETES operator-authored design values and the customisation
sentence no longer warns about them; for a non-narrated leaf the operator gets no signal at all.**
Register row **M3** ("confirm dialog's enumerated promises true or removed"); the honesty line
exists to warn about destruction.
`pruneEchoedLeaves` (`api/src/public/leadgen/designs/frames.ts:2329-2344`) deletes **any** leaf whose
value equals the newly-applied template's base — it cannot distinguish "a previous apply echoed
this" from "the operator deliberately chose this value". Driven, API-only, three steps
(`j12` log, reproduced verbatim):
```
2 operator sets header.logo_align = "left"  -> column {"version":1,"template":"centered","header":{"logo_align":"left"}}
3 apply "Site header + footer" (base = left) DRY: replaced=[]  header.logo_align in changes? false
4 after apply                              -> column {"version":1,"template":"header-footer"}   <- the operator's leaf is GONE
5 apply "Centered card" DRY: replaced=[]   changes=[{path:"header.logo_align",from:"left",to:"center"}]
                                            sentences mentioning the logo: []
6 FINAL logo_align = center                (the operator chose left)
```
The same shape with `progress.style` is in the same log. Before F4 the column kept the leaf, so the
old predicate *did* count it — this is a false-positive machine converted into a false-negative
machine, i.e. a fix-round-introduced regression on the clause the fix rounds own.
The code's own mitigation claim (`frames.ts:2237-2243`: *"the change itself is still announced by
name in `changes` and in the sentences below"*) is **false**: `changes` is not shown to the
operator, and `confirmations` narrates only ~8 leaf shapes — measured, the logo revert produced
one sentence, about the question unit, and nothing about the logo.

**F-C — `section_slot.transition` is "honoured" by an animation that never fires on a section
change, is the shipped default on every funnel, and cannot be switched off from any operator
surface.**
Register row §4 R3 / M2 sweep. `styles.ts:2721-2724` adds
`@keyframes lg-slot-fade` + `.lg-frame-slot--t-fade .lg-content{animation:lg-slot-fade 300ms ease-out}`.
Driven (`j6-fade-step1-1280.png` → `j6-fade-step2-1280.png`): the page really fades on first paint
(opacity 0.376 @80 ms → 1 @900 ms), then advancing through the visible `[data-lg-continue]`
("Step 1 of 6" → "Step 2 of 6") gives `contentOpacity: 1` and `getAnimations().length === 0` at
+30/60/120/250/400 ms — the mount element is never re-created, so the token literally named
`stepFadeInMs` ("step fade in") animates only the initial mount. The key's name, its value set
(`fade|none`) and its token all promise the section transition the product does not perform.
And it is now the default everywhere: `baseFrameDefaults.transition:"fade"` (`frames.ts:705`), no
built-in overrides it, and `grep -rn 'data-frame-key="section_slot' api/src` returns **0 hits** —
there is no admin control for this key, so every framed funnel page gained a 300 ms opacity
animation on load that no operator can turn off, with no `prefers-reduced-motion` guard (waived in
the source because a test pins the sheet to exactly one `@media` block — a test constraining the
product). Either honour the key where its name points (fade the section swap) and give it a
control, or exempt it; shipping motion to every live page to satisfy a predicate is neither.

### MINOR

**F-D — `section_slot.padding` has no operator surface either, so F8 wrote product CSS for a key
nobody can author.** No `data-frame-key="section_slot.padding"` anywhere in `api/src/admin`; no
built-in template sets it; the saved-template editor captures the funnel frame, which can only be
changed through controls. The paint itself is correct and the default is byte-identical (measured),
but the honest alternatives for a non-authorable key were a declared `SWEEP_EXEMPTIONS` entry or
removal, and the round chose to invent 6 visitor CSS rules instead. Worth one register line so the
next phase does not read "the sweep is empty" as "every enumerated key is an operator control".

**F-E — the built-in template named "White + trust bar" renders no trust bar, and the F-5 fix made
the picture honest while leaving the name lying.** `frames.ts:772-782` sets
`trust_strip: { placement: "footer" }` and never `enabled: true`; `frame.ts` renders the region only
when `enabled`. Driven (`j9c-visitor-white-trust-1280/375.png`): with record 5 applied the served
regions are header/progress/slot/back/footer — `trustRegion: false`. The operator meets that name in
the saved-template chips, in the apply dialog card (whose own summary reads "Bare layout · Bar
progress" — no trust mention) and in the A/B select. The fix round's comment names this built-in as
one of "three lies" and then repairs only the thumbnail; no ADJ row was filed. Per §10.1 this must
be a named fix-or-defer row, not a silent omission.

**F-F — the C6 glossary calibration now rests on residue the same test calls invalid evidence.**
`api/test/leadgen-glossary-lint.test.ts:757-792`: the "the scanner really fires" canary used to be
anchored on two live operator sentences; it is now anchored on `hits.length > 0` where the hits are
the `slideList` local and the dead `.lg-slide-current` CSS hook — the exact two categories the leg's
own comment excludes ("an identifier and a stylesheet name … invalid calibration evidence"). It
passes today only because of the two positive `toContain`s on the new wording; the canary itself
will false-red the day anyone renames that local, and it no longer proves the scanner can find
*copy*.

### Withdrawn during review

* I opened a finding on the stale root-cause comment ("the Quote Builder re-PUTs its whole
  hydrated frame on every Save … a COMPLETE frame_config_json") and then measured that F4 itself
  removed that phrasing: `grep -rn "COMPLETE frame_config_json|whole hydrated frame" api/src` is
  empty at HEAD, and the surviving sentence (`frame-handlers.ts:668-673`) is accurate. Driven
  corroboration: a real Templates-tab edit + `#lg-variant-save` writes a sparse 3-leaf column
  (`{"version":1,"template":"minimal","progress":{"style":"numbered"}}`), which is what the
  corrected comment describes. No finding.

### Observations (not findings)

* The `omit` probe contexts are honest. `template`: with every group pinned, all five sibling
  templates fingerprint-identically — a property of the probe, and the omit list is asserted to
  cover every `EffectiveFrameConfig` group except `compat`, which is proven template-invariant.
  `trust_strip.mobile`: `FrameMobileConfig.trust_strip_mobile` is optional and undefined by default,
  so on an untouched funnel the key really does paint; the shadow is ADJ-P8-34, already filed.
* Security pass on the diff: no `innerHTML` added; every new DOM write goes through
  `document.createTextNode` (`paintConfirmList`, `showError`); the new server sentences come from
  schema-validated enums through lookup maps that skip unknown values; all D1 writes stay
  `.bind()`-parameterised; the new regexes (`^New funnel (\d+)$`, `:not\(([^()]*)\)`, `"[^"]*"`) are
  anchored/linear — no ReDoS; the only new `catch` is F-9's, which surfaces a message.
* Silent-failure pass: no swallowed error added; the one new `.catch` reports. `applyFrameTemplate`
  writes config + pointer in one statement and awaits it before the read.
* Every consumer of a changed interface is updated: `frameThumbnailData` (4 call sites, all in
  `frame-handlers.ts`), `computedStyle`/`specIfMatches`/`PaintedEl.pseudos` (4 test consumers), 
  `computeTemplateApply` (1 caller). Both `--pad-*` blocks live inside the `frameRegions` gate
  (lines 2682 and 3420, block 2440-3542), so the frameless base sheet keeps its byte-stable prefix.
* No deferral marker (`TODO|FIXME|HACK|XXX`, "for now", "defer to v2", …) on any added line.

## Verdict

**FIX-FIRST** — F-A is a BLOCKER (a shipped visual change to three templates plus an invalidated
frozen baseline, with the opposite claim on record); F-B and F-C are MAJOR and both sit inside the
clauses this fix round owns.
