# P8 CLOSE round-3 SCOPED adversarial re-review — fresh context, drive-first

Reviewer: Opus 5, fresh context. Branch `leadgen-r2-p8-close` @ `f176eb52`
(product sha `a007cf7d` + the docs-only gate-log commit; `git show f176eb52 --stat` = 1 file).
Scope: ONLY the round's six items. The full program was reviewed at
`../review-p8-program/REVIEW.md`; I do not re-review it and I re-ran no full suite.

Server ritual, my own hand: strays killed (`pkill -f wrangler/workerd`, `lsof -ti:8901` empty)
-> `npm run db:reset:local` -> `npx wrangler dev --port 8901 --ip 127.0.0.1 --var
DEV_BYPASS_AUTH:true --var ADMIN_HOST:127.0.0.1` -> 200 on `/admin/leadgen/quotes` (attempt 1)
-> `LG_BASE=http://127.0.0.1:8901 npm run seed:leadgen-fixture` -> `ACTIVATED`.
Fixture resolved live (mine, this session): quote `lgq_01KZADKYF2HA7WRDEM44Y25QQH` /
quote_id 1 · funnel A `lgf_01KZADKYF22444Q8AVT0000V4T` · site `st_c04357ac6ab44183` /
`r2fix.e2e.test` · slug `r2fix`. Content authored from scratch through the real routes:
theme **`thm_rr-audit-theme-qzx7`** ("RR Audit Theme QZX7", `POST /api/admin/leadgen/themes`
-> 201, brand_primary `#7A1FA2`) plus funnels "New funnel 1/2/3". No seed theme existed
(`GET /themes` -> `{"items":[]}`), so every themes-manager measurement below is of MY row.

Chromium drives via `playwright` from `api/node_modules`, real Chrome UA, and
`--host-resolver-rules=MAP r2fix.e2e.test 127.0.0.1` where a tenant host was needed.
Tree on exit: `git status --porcelain` = 1 entry, `?? docs/leadgen/r2/evidence/p8/review-p8-program-rr/`.
My drives re-captured NO committed evidence file; `api/test-ui/__screenshots__/**` untouched.

---

## DEVIATIONS — listed as found (ranked at the end, never before)

### RR-1 The §8.4 fix's register row cites a screenshot of a DIFFERENT SURFACE as its only pixel evidence
`P8-REGISTER.md:169` **ADJ-P8-64** is the round's headline product row. Its status is a
behavioural `PASS(driven at 8 widths + 375 …)` claiming *"1280 -> editor x603 y165 w258,
canvas x887 **y165** w340, same row"*. Its Evidence cell is
`review-p8-program/REVIEW.md, m2/n7-n11-themes-rail-1280.png`.

I read that PNG. It is the **quote builder's Themes TAB** (`/admin/leadgen/quotes/1/edit`
-> "Section library | Live preview | Funnel theme" rails, with the publish blocker banner) —
a completely different page from `/admin/leadgen/themes`. It contains no `8.4-editor-controls`
and no `8.4-live-canvas` at all, so the row's measured boxes cannot be seen in it. Provenance:
`git log --follow` -> committed in **`528f1610` (P8-3)**, two commits BEFORE the fix.
The other citation, `review-p8-program/REVIEW.md`, is the document whose D-2 says this anatomy
is **not delivered**. So an owner following ADJ-P8-64's evidence finds a review that calls it
broken and a picture of another page.

The fix's REAL pass-after screenshots exist **in the same commit** —
`docs/leadgen/r2/evidence/p6/themefix/themes-anatomy-1280-fresh.png` and
`…-1280-opened.png` (I read the latter: byte-for-byte the layout my own drive reproduced) —
and are cited by **no register row**: `grep -c "themes-anatomy-1280" P8-REGISTER.md` -> **0**.
`check_register.py` R3 passes because it only asserts the cited path EXISTS on disk (I read
its rules: `SCREENSHOT_RE.findall(joined)` then `(ev_root / s).exists()`).

### RR-2 This round's register rewrite DELETED N15's Phase cell, shifting its columns left — its rendered Evidence column is now `—`
Measured with a splitter that honours `\|` escapes:
- at `cddb77a0`: `| N15 | Image11 | <req> | P8-5 | DEVIATES(…) | — |` (6 columns, aligned)
- at HEAD: `| N15 | Image11 | <req> | PASS(driven in review-p8-5 row 27 …) | n15/p8n_dual-1280-rest.png, n15/p8n_dual-1280-separated.png, review-p8-5/REVIEW.md | — |`

`P8-5` is gone, so against the header `| ID | Anchor | Requirement | Phase | Status | Evidence |`
the row now renders **Phase = the PASS verdict**, **Status = a list of png paths**,
**Evidence = `—`**. The owner reading the table sees a dash where N15's proof should be.
The conductor's new terminal check ("DEVIATES-with-empty-evidence: 0") cannot see it: I
recomputed it — 7 DEVIATES rows, **0** with an empty evidence cell (the claim is true) — but
exactly **1 PASS row with an empty rendered Evidence column, and it is N15**, one of the rows
BL-1 named. `check_register.py` misses it too: it locates the status by scanning ANY cell for
the verdict vocabulary and searches the JOINED row for screenshots, so column position is
never checked.

### RR-3 N5's new Status text carries three UNESCAPED `|` characters — the row breaks to 9 columns and GFM drops its screenshot
`P8-REGISTER.md:46`, rewritten this round. Its status text ends
`… per-test Σ == 10000 | bp | control = null at both viewports)`. Properly split:
`[4]=PASS(… must sum to 10`, `[5]=10000`, `[6]=bp`, `[7]=control = null at both viewports)`,
`[8]=review-p8-combined/n5-n10-ab-1280.png`. GFM ignores cells beyond the header count, so in
the rendered table N5's **Evidence column reads `10000`** and its actual screenshot is
**invisible to the owner**. Of all 118 table lines in the register, **exactly one** has ≠6
columns, and it is one this round rewrote.

### RR-4 M9's DEVIATES is factually FALSE at HEAD — the "slides" survivors it points the owner at do not exist
`P8-REGISTER.md:35`, kept deliberately ("M9 stays an honest DEVIATES pointing at ADJ-P8-16's
live 'slides' survivors" — commit message). The cell asserts *"the P8-4 drive measured
surviving 'Slide 1 …' sentences at `quotes-handlers.ts:6487ff`, `templates.ts:826/984`,
`themes.ts:301` and no later wave re-drove them clean"*. At HEAD, by my own hand:

| cited site | what is actually there at HEAD |
|---|---|
| `templates.ts:826` | `Progress counts the **sections** of this funnel variant automatically.` |
| `templates.ts:984` | `… Funnel layout template · affects every **section** of this funnel` |
| `themes.ts:302` | `… Funnel theme · affects every **section** and every component default …` |
| `themes.ts:298` | the P8-4 F-3 comment recording the fix ("the sentence now says 'section'") |
| `quotes-handlers.ts:6700ff` | an internal `const slide = i + 1`; every operator message reads `Section ${slide} '…'` |
| `shared.ts:1184` | `// P8-4 F-3 (ADJ-P8-16 …): was "every slide of this funnel" —` |

`grep -in slide` across all three cited files, minus `slider`, returns **only comments**.
Driven confirmation on the surface the owner reads — live Templates tab at 1280, 109 visible
text nodes: **0** slide/slides hits, **0** `(§` hits (`rr-m9-n9-census.txt`,
`rr-templates-tab-1280.png`). ADJ-P8-16 (`:96`), the row M9 defers to, is stale the same way:
every one of the five sites in its "full site list" is fixed. This is exactly the D-9 class
("several cells are FACTUALLY FALSE at HEAD") that BL-1's fix was written to end — preserved,
in the direction that tells the owner to go fix something already fixed.

### RR-5 N18's evidence cites the refuted sweep's NO-LOGO screenshots, not the driven proof its PASS now rests on
`P8-REGISTER.md:59`. The PASS is correctly re-founded on the review's D-7 execution
(`ImageBlock{source:"auto_logo"}`, 17.6px at `m` AND `xxl`) and the conductor's false "no
producer" reasoning is corrected in place — both required by the dispatch and both present.
But the Evidence cell is `review-p8-3/REVIEW.md, review-p8-program/REVIEW.md,
close/sweep/n18/n18-header-state-1280.png, …-375.png, close/sweep/probe-n18-logo-rerun.txt`.
I read `n18-header-state-1280.png`: a funnel page whose header reads
**"No logo — set it in Site settings."** — the fixture state that made the row INCONCLUSIVE in
the first place, i.e. a picture of the ABSENCE the row was downgraded for.
The four screenshots that show the driven visible element —
`review-p8-program/n18-visible-logo-{m,xxl}-{1280,375}.png` — exist and are cited by no row
(`grep -c n18-visible-logo P8-REGISTER.md` -> **0**).

### RR-6 ADJ-P8-21's PASS rests on canvas-only evidence for a defect defined as a canvas-vs-LIVE divergence
`P8-REGISTER.md:104`. The registered defect is that `runtime/render.ts setFieldError` used a
descendant-only `querySelector("[data-lg-input]")`, so on the FreeTextQuestion shape **no
`aria-invalid` is set LIVE** while `preview-sim.ts` paints it on the canvas — *"the canvas
paints an error state the live page cannot."* The new PASS cites "review-p8-program row 398"
plus `review-p8-program/studio-sim-validation_error-1280.png` — a **Studio canvas** sim.
Row 398 drove only the canvas drawer's sims; its third clause explicitly records a persisting
canvas/live divergence (ADJ-P8-49). Nothing in it measured a live visitor page's `aria-invalid`
for a FreeText field, and the per-subfield G3c behaviour it does prove is a different defect.
The underlying defect IS fixed — `api/src/public/leadgen/runtime/render.ts:260-266`:
```
const input = fieldEl.hasAttribute("data-lg-input") ? fieldEl : fieldEl.querySelector("[data-lg-input]");
```
credited in-code to "R2 P8-5 M-3 (ADJ-P8-21)" with its own live-funnel drive. So the outcome
is right and the row points at the wrong artifact for it.

### RR-7 A false arithmetic claim labelled "measured" survives in the very function this round swept for that class
`api/src/admin/leadgen/ui-theme-manager.ts:1192-1193`: *"(measured: four columns would fit
only from a **1194px** .tm-body, i.e. **~1494 viewport**, and only by shrinking the editor to
the mock's 208 …)"*, and `:1162`: *"the mock's four columns need **1194** and only 980 exist."*

Driven at exactly that width (`rr-band-threshold.txt`):

| viewport | .tm-body | outer columns (y,x,w) | four columns beside? |
|---|---|---|---|
| **1494** | **1194** | 300@y141 · 894@y141 · **320@y1778** | **NO** |
| 1500 | 1200 | 300@y141 · 900@y141 · 320@y1778 | NO |
| 1550 | 1250 | 300@y141 · 950@y141 · 320@y1762 | NO |
| 1574 | 1274 | 300@y141 · 974@y141 · 320@y1727 | NO |
| 1600 | 1300 | 300@y141 · 680@y141 · **320@y141** | **YES** |

The threshold is `.tm-body` **1300** = viewport **1600**, not 1194/~1494. 1194 omits the centre
pane's own 56px padding that the same comment block's `680 = 258 + 26 + 340 + 56` derivation
insists on: with the mock's 208 editor the real cost is `300 + (208+26+340+56) + 320 = 1250`
(~1550 viewport). Two paragraphs above, the same block states its own rule: *"Never re-argue a
width in prose here: every number above and below is a driven measurement of this page."*
This is the D-3 class, and the commit message claims *"the rotted geometry comments swept;
every numeric claim now measured-true or deleted."*

### RR-8 The warning path suppresses the reload every control depends on to repaint — the operator is told "Theme saved" while every control still shows the pre-save value
`ui-theme-manager.ts:1499-1505`: on `cache_refresh_warning` the branch calls
`showError(warning)` and **returns without reloading** (deliberate, and reasoned in the comment
— a reload would destroy the message). But no control in this island repaints locally: I read
all four wirings — `wireSegments` (:1522), `wireFontSelect` (:1541), `wireHexInputs` (:1557),
`wireNameInput` (:1650) — every one ends at `patchTheme` and depends on
`window.location.reload()` to show the new value. My warning-free drive proves the dependency:
the Corners segment only flipped `rounded`->`pill` (background `rgba(0,0,0,0)`->`rgb(255,255,255)`)
**after** the reload navigation. So in the warning case the saved state and the displayed state
disagree, under a banner whose first two words are "Theme saved". The in-file comment states
the reload trade for the message; it never states this consequence.

### RR-9 The round wired a raw internal error string onto the operator's alert banner, and its own test pins that string as the expected operator text
`themes-handlers.ts:741` interpolates the caught error verbatim:
`` `Theme saved, but refreshing the live funnels that use it did not complete (${message}). …` ``.
`test/leadgen-p8-close-fa.test.ts:115-117` fixes the expected `#tm-error` text as
`"… did not complete (D1_ERROR: no such table: leadgen_funnel_variants). …"` and asserts
`toBe(HANDLER_WARNING)` with the message *"the warning text itself, not a paraphrase"*.
Against the owner clause M5 is anchored on — *"the rules you build are using jargon"* —
`D1_ERROR: no such table: leadgen_funnel_variants` is internal jargon on an operator surface,
now canonised by a unit assertion.

### RR-10 The island surfaces only `data.error` and discards `fields`, so a rejected save reports no reason
Driven through the real name input on my theme: `PATCH` -> **400**
`{"error":"Validation failed","fields":{"name":"The theme name must be 80 characters or fewer. Shorten it."}}`.
The `#tm-error` banner painted exactly **"Validation failed"** — `rr-d6-tm-error-surface-1280.png`
shows the banner text with the 400-character name still sitting in the box and no reason given.
`grep -n "\.fields" ui-theme-manager.ts` -> **0**: nothing reads it. The branch itself is
pre-existing (unchanged context lines in this round's diff), but it is the fourth branch the
round's lane canonises (`expect(d.errorEl.textContent).toBe("Validation failed")`), and register
M5's PASS cites operator-word rejections of exactly this class as its proof.

### RR-11 The gate log's typecheck section is EMPTY while the log header and commit message claim "typecheck 0"
`docs/leadgen/r2/gate-logs/p8-CLOSE-terminal-gate.log`, `--- (1) typecheck ---` is followed by
two blank lines: no command, no output, no exit code. `--- (3) verify:all ---` shows category
output but likewise no exit code. Re-run by me at HEAD (the one check the log leaves
ambiguous): `npx tsc --noEmit -p tsconfig.json` -> **TSC_EXIT=0**, 0 lines of output. So the
claim is true; the log does not evidence it, and an owner cannot recompute it.

### RR-12 Editor-column clipping/bleed at the fix's 258px width (recorded; identical at 1600, so not introduced there)
Census over `8.4-editor-controls` at 1280 and **byte-identically at 1600** (the editor is 258px
at both — `rr-editor-clip.txt`): **8** sub-boxes with `scrollWidth > clientWidth` (worst +62px,
the typography wrap the comment itself discloses; "Display size" +51px, "Corners" +15px) and
**38** boxes whose right edge exceeds the column's 861 by up to 19px. Nothing is occluded — the
worst right edge is 880 and the canvas starts at **887** — and the pixels are legible. The
80-char `#tm-theme-name` input shows ~17 characters: "RR Audit Theme QZX7" renders clipped
mid-glyph (`rr-editor-header-1280.png`). Because 1600 is identical and the round states 1600 is
byte-identical to pre-fix HEAD, this is pre-existing at 1600; at 1280 the editor narrowed
304->258 as the price of the anatomy. Recorded, not scored as a regression of this round.

### RR-13 At 375 the `+ New theme` button — the only control that creates a theme — is clipped 24px past its bar, and the E6 `scrollWidth == innerWidth` proof passes anyway because an ancestor is `overflow:hidden`
Driven at 375 (`rr-anatomy.txt` tail, `rr-375-topbar.png`): `#tm-new-theme` spans
**x291..right 382** while its bar ends at **358** and `.tm-shell` at **359** — 24px of overflow
(`bar.scrollWidth 365` vs `clientWidth 341`), and the button's right edge is **7px past the 375
viewport**. The pixels read **"+ New them"**, and the header subtitle is squeezed into a ~50px
column showing a vertically clipped *"feel per funnel · A/B-testable"*. Meanwhile
`document.documentElement.scrollWidth == innerWidth == 375`, so both the spec's 375 leg and
ADJ-P8-64's *"375 unchanged (stacked, scrollWidth==innerWidth)"* pass — the overflow is absorbed
by the shell's `overflow:hidden`, which is exactly what that check cannot see.
`renderTopBar` is **outside this round's diff**, so this is pre-existing, not introduced; it is
listed because item 1's 375 leg is the check that misses it.

---

## AUDITED CLEAN — no finding

**Item 1 product (D-2/D-3), driven by me** (`rr-anatomy.txt`, `rr-anatomy-{1280,1600,375}.png`):

| viewport | .tm-body | centre pane | editor | canvas | beside? | scrollWidth == innerWidth |
|---|---|---|---|---|---|---|
| **1280** | 980 | 680 (inner 624) | x603 **y165** w258 | x887 **y165** w340 | **YES, dy=0** | 1280 == 1280 |
| **1600** | 1300 | 680 (inner 624) | x603 **y165** w258 | x887 **y165** w340 | **YES, dy=0** | 1600 == 1600 |
| **375** | 341 | 341 | x45 y379 w285 | x45 y2381 w285 | stacked, dy 2002 | **375 == 375** |

Every number matches ADJ-P8-64's and the in-code comment's claims exactly, on a theme I
authored myself. 0 console errors. A/B rail at 1280: wrapped to x275 **y2243** w320 and
**reachable** — `.tm-body.scrollTop = 1470` brings it to y773, inside the 900px viewport
(`rr-anatomy-1280-scrolled-rail.png`). ADJ-P8-64 **states the trade verbatim**: *"between 1280
and 1599 the A/B panel wraps BELOW the editor row (reachable by scroll)"*. The mock's
four-columns-at-1280 really is impossible in the real shell (nav 250 + 24px gutters -> .tm-body
980 vs 1250 required). Empty state driven too: with no themes at 1280 the three columns stay
beside each other (300 / 360 / 320 across 980) — exactly as the new comment claims
(`rr-empty-state.txt`).

**N7 on this surface**: enumerated every `<select>` in the DOM (2 total, both visible) at
1280/1600/375. `#tm-headline-font` displays "Newsreader" 66.85px in a **282.00px** content box;
`#tm-body-font` "Inter" 29.48px in 282.00px. Widest offered option "Playfair Display"
(91.37 / 98.49px) also fits at all three widths. Displayed-value overflows: **0**. Widest-option
overflows: **0**.

**Item 2 (D-6)**: `patchTheme`'s ok-branch reads the body, surfaces `cache_refresh_warning`
through `showError` -> `#tm-error`, and reloads only when warning-free (`:1499-1505`). The lane
`test/leadgen-p8-close-fa.test.ts` drives the **real island** — `runInNewContext(THEME_MGR_SCRIPT, sandbox)`,
then the click handler the island's own `wireSegments` attached — and covers all four branches
(warning -> alert shown + `reloads()==0`; warning-free 200 -> `reloads()==1` + `#tm-error`
empty; non-JSON 200 -> reload; `!ok` -> `data.error`), plus the real PATCH url/body and an ES5
guard: **8 cases, all passed when I ran the file** (`vitest run test/leadgen-p8-close-fa.test.ts`
-> `Tests 8 passed (8)`). `HANDLER_WARNING` matches `themes-handlers.ts:741`'s template verbatim.
**Every-consumer proof**: `cache_refresh_warning` has exactly **one producer**
(`themes-handlers.ts:746`; `grep -n warning themes-handlers.ts` -> 4 hits, one assignment) and
now exactly **one consumer** (`ui-theme-manager.ts:1501`). The other two `/themes/:id` fetches
are **not** PATCHes — `ui-theme-manager.ts:1618` is the DELETE (whose handler emits no warning)
and `quotes-tabs/theme-preset-resolve.ts:278` is a GET.
**Driven warning-free save**: clicked Corners -> Pill on my theme; `PATCH {"controls":{"corners":"pill"}}`
-> **200 with no `cache_refresh_warning`**; **exactly one** navigation (the reload) fired; the
segment repainted; `GET /themes/thm_rr-audit-theme-qzx7` -> `corners:"pill"`; `#tm-error` stayed
`hidden=true`, `display:none`. Reload behaviour unchanged (`rr-d6-drive.txt`,
`rr-d6-after-warningfree-save-{1280,375}.png`). **The warning's target surface is real**: a live
400 painted `#tm-error` `role="alert"`, `hidden=false`, `display:block`, box 341x35, visible
(`rr-d6-tm-error-surface-1280.png`).

**Item 3 validator**: I ran it myself —
`check_register.py docs/leadgen/r2/P8-REGISTER.md --evidence-root docs/leadgen/r2/evidence/p8`
-> `rows checked: 109 · R1..R5 = 0 · TOTAL violations: 0 · exit 0`. Matches the gate log.
All 16 cited artifacts I touched exist on disk (16/16 OK).
Row-by-row: **N9** driven live — element letters `["A","B","C","D","E","F","G","I","J"]`, G
present, H the deliberate gap, matching the row exactly and the D-9 correction is stated in the
cell. **N15**'s numbers match `review-p8-5/REVIEW.md:27` verbatim (rest pill top 423 vs handle
bottom 418; mid 537.9/535.7 and 730.7/731.3). **ADJ-P8-22** matches row 398 verbatim (row 398
itself names ADJ-P8-22's shape as closed). **ADJ-P8-62** names the second emitter
`presets.ts:4211-4231 renderImageBlockAutoLogo` (a) AND the prop-validation gap (c), as required.
**N6** names its unverified leg — and **I closed that leg by driving it**: `+ Add funnel` twice
-> "New funnel 1", "New funnel 2", "New funnel 3"; `DELETE /funnels/lgf_01KZAEAK44JHRXZ1S75AFFQYX6`
("New funnel 3") -> 200; `+ Add funnel` -> "New funnel 3" **reused**, and **0 duplicate LIVE
names** (`rr-n6-drive.txt`, `rr-n6-delete-then-add-{1280,375}.png`). The algorithm is
max-ordinal+1 over the live board (`funnel.ts:5246-5257`), so a deleted name can be reused but
two live funnels can never share one — N6's PASS is correct.

**Item 4 (D-5)**: `git diff cddb77a0 HEAD -- api/test-ui/__screenshots__/leadgen-v25/` -> **0
bytes**; `git diff --stat cddb77a0 HEAD -- api/test-ui/__screenshots__/` -> **empty for the whole
directory** (not just leadgen-v25). Both frozen spec files
(`leadgen-visual.spec.ts`, `leadgen-v31-gate1c-baselines.spec.ts`) byte-identical to
`cddb77a0`. **ADJ-P8-63** exists at `:168`, `BLOCKED(owner visual-QA: bless or reject the
pattern-a footer diff)`, quantifying the diff (desktop y555..676 = 4.05%, mobile y473..594 =
5.17%) and naming ADJ-P8-36 as the sibling precedent. `__screenshots__` still clean after my
session.

**Item 5 (D-4/D-11)**: the false sentence is gone. HEAD reads *"Nothing was **retired,
weakened or skipped** to make a gate pass. … The two frozen owner suites' baselines are
byte-identical throughout … One baseline event happened at CLOSE and was corrected on review:
pattern-a {desktop,mobile} was regenerated on a conductor ruling … the regeneration was
REVERTED to your committed baselines and routed to you as ADJ-P8-63"* — the pattern-a story,
told. §7 carries *"18 genuinely introduced by the two-baseline-runs criterion — 20 specs / 35
failures by the committed evidence alone"* and *"5 pre-existing (one honestly MIXED …)"*;
`close/battery-classification.md:31-32` names it: *"`acceptance-builder` is honestly MIXED — 1
base failure vs 6 at head"*, plus the FLAKY-BASE correction naming the destroyed `yday` run.

**Item 6 (D-10)**: log stamped `HEAD: a007cf7d446e3eee3736485ef1f0a5c3fa5efa5b`,
`porcelain-dirty-paths: 0` with an honest note that the log itself lands in the following
docs-only commit (`f176eb52` = 1 file, verified). Counts recomputed by hand from the raw text:
`498 passed | 2 skipped (500)` -> 498+2 = **500** files; `8419 passed | 30 skipped (8449)` ->
8419+30 = **8449**, **0 failed**. Register `109 / 0` (reproduced). Runtime
`53181 bytes, byte-identical rebuild`. Delta vs round 2 (`8411/30/8441`, 499 files) = **+8
tests, +1 file**, and `grep -c "^\s*it(" test/leadgen-p8-close-fa.test.ts` = **8** — the F-A
lane exactly, which I ran: 8 passed.

**Security (round diff = 1 source file, `ui-theme-manager.ts`)**: the server-supplied warning
reaches the DOM only through `showError`, which writes `el.textContent` — `grep -n innerHTML
ui-theme-manager.ts` -> 0 on this path, so no XSS from the interpolated D1 message. No new
route, no SQL, no template-literal query, no secret, and the only external-input parsing is
`res.json().catch(-> null)`.

**Deferral / reduced-model scan** over ALL added lines of `a007cf7d~1..f176eb52`
(`\b(TODO|FIXME|HACK|XXX)\b`, "polish later", "for now", `defer(red)? to (v2|later|a
follow-up)`, `simplified for (now|v1)`, `will be (done|added) later`): **4 hits, all inside the
committed `review-p8-program/REVIEW.md` prose describing the prior review's own scan — 0
deferrals in code.** Marker-free reduced-model hunt over the source change: the §8.4 fix is not
a reduced model of the pin's "canvas beside the editor" clause (delivered at 1024-1600, driven);
the deliberate reduction is the 4th rail wrapping below at 1280-1599, and it IS stated in
ADJ-P8-64 and in-file. `cache_refresh_warning` is no longer a dead output. No locked options,
no dead controls, no placeholder content, no seed-only path found.

---

## RANKING

### BLOCKER (0)
None. Both product deliverables (items 1 and 2) are delivered and I drove them; every finding
below is in the truth artifacts or is a stated-trade consequence.

### MAJOR (4)
**MJ-1 = RR-1 — ADJ-P8-64's only pixel evidence is a screenshot of a different page, while the
fix's real pass-after screenshots sit uncited in the same commit.**
Row: `P8-REGISTER.md:169`. Files: `evidence/p8/m2/n7-n11-themes-rail-1280.png` (cited, from
`528f1610`, quote-builder Themes tab) vs `evidence/p6/themefix/themes-anatomy-1280-{fresh,opened}.png`
(uncited, this commit, the actual surface). Scenario: the owner audits the round's headline
product fix, opens its one screenshot, sees a page with no `8.4` panes, and cannot tell whether
the anatomy shipped; the other citation is the review that says it did not. Screenshots:
`rr-anatomy-1280.png` (what the row claims, driven by me) vs the cited PNG.

**MJ-2 = RR-2 + RR-3 — the register write-back that ANSWERED BL-1 introduced two structurally
broken rows, one of them a row BL-1 named.**
Rows: `P8-REGISTER.md:56` (N15, Phase cell deleted -> Evidence renders `—`) and `:46` (N5,
unescaped `|` -> 9 columns, Evidence renders `10000`, screenshot dropped by GFM). Scenario: the
owner opens the artifact `CUTOVER-PACK.md` and the final report call the acceptance truth and
finds N15's proof blank and N5's proof missing — the exact symptom BL-1 was raised for.
Neither `check_register.py` (column-agnostic by design: it scans any cell for the verdict and
the joined row for screenshots) nor the conductor's new DEVIATES-with-empty-evidence check
(scoped to DEVIATES; N15 is PASS) can see them.

**MJ-3 = RR-4 — M9's DEVIATES describes a product that no longer exists, and ADJ-P8-16 behind
it is stale the same way.**
Rows: `P8-REGISTER.md:35` and `:96`. Files: `templates.ts:826,984`, `themes.ts:298,302`,
`quotes-handlers.ts:6700ff`, `shared.ts:1184` — every cited site fixed. Scenario: the owner
reads that the "slides" vocabulary class is still open and allocates work to a defect P8-4
closed; the register understates the delivered work in the same breath the report says
everything is fixed. Evidence: `rr-m9-n9-census.txt` (0 slide hits across 109 visible nodes),
`rr-templates-tab-1280.png`.

**MJ-4 = RR-7 — false arithmetic labelled "measured" survives in the same function, and the
same error class, this round claimed to have swept.**
File:line `api/src/admin/leadgen/ui-theme-manager.ts:1162` and `:1192-1193`. Scenario: the next
engineer trusts "four columns fit from a 1194px .tm-body (~1494 viewport)" and either re-derives
the basis from it or tells the owner the four-column band starts ~100px lower than it does; the
driven threshold is .tm-body 1300 / viewport 1600. Evidence: `rr-band-threshold.txt` (rail below
at 1494/1500/1550/1574, beside only at 1600).

### MINOR (8)
- **MN-1 = RR-5** N18's evidence cell cites `close/sweep/n18/n18-header-state-1280.png`, a page
  reading "No logo — set it in Site settings.", for a PASS founded on a driven visible
  `.lg-logo`; `review-p8-program/n18-visible-logo-*.png` exist and are cited nowhere.
- **MN-2 = RR-6** ADJ-P8-21's PASS cites a Studio-canvas sim for a defect defined as the LIVE
  page's missing `aria-invalid`; the real fix and its live drive are at
  `runtime/render.ts:260-266` (P8-5 M-3) and go uncited.
- **MN-3 = RR-8** the warning branch suppresses the reload every control needs to repaint, so
  the operator sees "Theme saved" over stale controls; the consequence is unstated.
- **MN-4 = RR-9** the operator's alert banner carries a raw `D1_ERROR: no such table: …`
  string, pinned by `leadgen-p8-close-fa.test.ts:115-117` as the expected operator text.
- **MN-5 = RR-10** `#tm-error` shows only `data.error` ("Validation failed"); the operator
  sentence in `fields.name` is discarded (`grep "\.fields"` -> 0).
- **MN-6 = RR-11** the gate log's `(1) typecheck` and `(3) verify:all` sections carry no exit
  code; I re-ran typecheck at HEAD (exit 0), so the claim holds but the log cannot be recomputed.
- **MN-7 = RR-12** 8 clipped and 38 bleeding sub-boxes in the 258px editor column at 1280 and
  identically at 1600 (nothing occluded: worst right edge 880 vs canvas x887); the 80-char theme
  name input displays ~17 characters.
- **MN-8 = RR-13** at 375 `#tm-new-theme` overflows its bar by 24px and the viewport by 7px
  (renders "+ New them"), yet `scrollWidth == innerWidth == 375` still passes because
  `.tm-shell` is `overflow:hidden`. Pre-existing (`renderTopBar` is outside the round's diff).

---

## VERDICT: **FIX-FIRST** — 0 BLOCKER · 4 MAJOR · 8 MINOR

The two product deliverables are real and I drove both. Every MAJOR is in the acceptance
artifacts, and all four are mechanical: repoint 3 evidence cells at screenshots that already
exist in the same commit (ADJ-P8-64, N18, ADJ-P8-21), repair 2 malformed rows (restore N15's
`P8-5` Phase cell; escape N5's three `|`), correct 1 stale cell pair (M9 + ADJ-P8-16), and
correct 2 numbers in one comment (`ui-theme-manager.ts:1162,1192`). Recommended additionally:
widen the terminal empty-evidence check from DEVIATES-only to every status, and add a
column-count assertion, since `check_register.py` is column-agnostic by design.

## SCOPED VERDICT TABLE (one row per dispatch item)

| # | Item | What I drove / audited | What I measured | Verdict |
|---|---|---|---|---|
| **1** | **D-2** — the §8.4 anatomy at 1280/1600/375 + N7 on this surface | **DROVE** `/admin/leadgen/themes` on a theme I created via the real route (`thm_rr-audit-theme-qzx7`), opened through the real card link; measured `getBoundingClientRect` on both `8.4` pins, the outer columns, and every `<select>`; bracketed the 4-column threshold at 5 extra widths; drove the empty state | 1280: editor x603 **y165** w258 / canvas x887 **y165** w340, **dy=0**; 1600 identical; 375 stacked with **scrollWidth == innerWidth == 375**; N7 **0/0** overflows (2 selects, displayed AND widest option fit, 282.00px box); A/B rail at 1280 x275 y2243 w320, **reachable** (scrollTop 1470 -> y773); ADJ-P8-64 **states the trade verbatim** | **PERFECT on the owner clause** (`rr-anatomy-1280.png` shows LIVE PREVIEW — THIS THEME beside the colour-role editor, my purple `#7A1FA2` painting the progress rail) · **DEVIATES on the row's evidence (MJ-1)**, on `:1162/:1192` prose (MJ-4), and on the 375 top bar (MN-8, pre-existing) |
| **2** | **D-6** — the warning consumer | **READ** the ok-branch + all four wirings; **AUDITED** the node:vm lane's 4 branches and ran the file; **DROVE** a real warning-free save and a real 4xx | ok-branch reads the body and routes warning -> `showError` -> `#tm-error` (`:1499-1505`); lane drives the REAL island (`runInNewContext(THEME_MGR_SCRIPT)`) for all 4 branches, **8/8 passed**; `HANDLER_WARNING` verbatim-equal to `themes-handlers.ts:741`; **1 producer / 1 consumer** (other 2 call sites are DELETE + GET); warning-free save: PATCH 200, no warning, **exactly 1 reload**, segment repainted, `corners:"pill"` persisted, `#tm-error` hidden; `#tm-error` proven a real visible `role="alert"` banner (341x35) | **PERFECT** on the four branches and on the unchanged reload (`rr-d6-after-warningfree-save-1280.png`, `rr-d6-tm-error-surface-1280.png`) · **DEVIATES minor** on stale controls (MN-3), raw D1 jargon (MN-4), discarded `fields` (MN-5) |
| **3** | **BL-1** — 8-row register spot-audit + validator | **AUDITED** M9, N6, N9, N15, ADJ-P8-21, ADJ-P8-22, N18, ADJ-P8-62 against their cited sources; **DROVE** N9's letters, M9's live copy, N6's delete-then-add; ran `check_register.py` | Validator **109 rows / 0 violations, exit 0** (reproduced); **16/16** cited artifacts exist; N9 `A B C D E F G I J` ✓; N15 == `review-p8-5:27` verbatim ✓; ADJ-P8-22 == row 398 ✓; ADJ-P8-62 names the second emitter + prop gap ✓; N6's leg **closed by my drive** (reused name, **0 duplicate live names**); M9's five "slides" sites **all fixed**, **0** live hits in 109 nodes; N15 lost its Phase cell; N5 has 3 unescaped `\|` | **DEVIATES (MJ-2, MJ-3, MN-1, MN-2)** — 4 of 8 rows sound (N6, N9, N15-substance, ADJ-P8-22, ADJ-P8-62), M9 false, N15 + N5 malformed, N18 + ADJ-P8-21 mis-cited (`rr-m9-n9-census.txt`, `rr-n6-drive.txt`) |
| **4** | **D-5** — pattern-a authority | **AUDITED** by diff at three scopes + the register row | `git diff cddb77a0 HEAD -- api/test-ui/__screenshots__/leadgen-v25/` = **0 bytes**; the WHOLE `__screenshots__/` diff = **empty**; both frozen spec files byte-identical; **ADJ-P8-63** exists, `BLOCKED(owner visual-QA: bless or reject)`, quantified (4.05% / 5.17%), citing ADJ-P8-36 as precedent; `__screenshots__` clean after my drives | **PERFECT** |
| **5** | **D-4/D-11** — report truth | **AUDITED** `P8-FINAL-REPORT.md` + `close/battery-classification.md` and their diffs | the `"__screenshots__/** is untouched"` / `"Nothing was rebaselined"` sentence is **gone**, replaced by the pattern-a story (regenerated -> flagged -> REVERTED -> ADJ-P8-63, §15.4-A expected-fail until the owner rules); §7 and `battery-classification.md:28-40` both carry **18 by criterion / 20 by committed evidence**, with `acceptance-builder` named **MIXED (1 base vs 6 head)** and the FLAKY-BASE correction naming the destroyed `yday` run | **PERFECT** |
| **6** | **D-10** — gate at HEAD | **AUDITED** the raw log, recomputed every count by hand, re-ran only the ambiguous check and the diff-touched test file | stamped **`a007cf7d`** (= product sha; `f176eb52` is the 1-file docs commit), `porcelain-dirty-paths: 0` with an honest self-reference; **8419 + 30 = 8449**, **0 failed**, **498 + 2 = 500 files**; register **109/0**; runtime **53181 B byte-identical**; **+8 / +1 file** vs round 2 == `leadgen-p8-close-fa.test.ts`'s **8** `it()` cases, which I ran: **8 passed**; `(1) typecheck` section **empty** -> I re-ran it: **exit 0** | **PERFECT on the counts** · **DEVIATES minor (MN-6)** — typecheck and verify:all carry no exit code in the log |
