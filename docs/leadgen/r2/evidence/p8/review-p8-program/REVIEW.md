# P8 FULL-PROGRAM adversarial review (CLOSE gate) — fresh context, drive-first

Reviewer: Opus 5, fresh context. Branch `leadgen-r2-p8-close` @ `1dbf1783`.
Server ritual executed by my own hand: strays killed -> `npm run db:reset:local` ->
`wrangler dev --port 8901` (200 on /admin/leadgen/quotes) -> `LG_BASE=... npm run seed:leadgen-fixture`
(ACTIVATED). Live ids resolved fresh from `/quotes` + `/structure`, never from docs.

Fixture (mine, this session): quote `lgq_01KZA7YXK1EXNAFNEZ17EZ2FFT` · funnel A
`lgf_01KZA7YXK10NK813Q32P1Q9WQ6` · variant `lgn_01KZA7YXK1YP1YZGR5FRMEHEEE` ·
site `st_be8d9a331fa54b0c` / `r2fix.e2e.test` · slug `r2fix`.

---

## DEVIATIONS — listed as found (ranked at the end, never before)

### D-1 The register does not record acceptance for 22 of the contract's 33 §5-§7 items
`docs/leadgen/r2/P8-REGISTER.md`. The file's own header: *"Every row starts as
`DEVIATES(<the contract's measured finding>)` — the defect is the current truth — and flips
only on driven proof."* At HEAD, these rows still carry the **seed** text and evidence `—`:

M1, M3, M4, M6, M7, M10 (`DEVIATES(contract measured: …)`, evidence `—`);
M5 (only an ADDITIONAL finding, seed text kept, evidence `—`); M9 (`STILL OPEN, allocated to
P8-4`, five cited sites listed as open);
N2, N3, N4, N5, N6, N8, N9, N10, N12, N13, N14, N16, N17, N19 (`DEVIATES(contract …)`, evidence `—`);
REQ-R1, REQ-R3, REQ-R5 (`DEVIATES(… at seed)`, evidence `—`).

Verified by git: `git diff cddb77a0~1 cddb77a0 -- P8-REGISTER.md` changes **exactly one**
M/N status cell (M8, and that one to a refutation). The P8-4/5/6 merge added 42 lines, all
ADJ rows and prose — **no M/N/REQ row was flipped**. The last commit to touch M1's cell is
`0f54aeba` (P8-1, the seed).
Meanwhile `P8-FINAL-REPORT.md:40` asserts *"Every item in §4–§7 is fixed-and-driven or
reported-with-evidence"* and `:28`/`:154` cite `check_register.py` **107 rows / 0 violations**
as the acceptance proof. I re-ran the validator myself: exit 0, 107 rows, 0 violations — and
inspected its rules: R1 vocabulary, R2 anchor, R3 screenshot-for-behavioural-PASS,
R4 INCONCLUSIVE-step, R5 no-back-reference-only. **It never asks whether a DEVIATES row was
resolved.** So "0 violations" is compatible with 22 unresolved seed rows, and it is.
Consequence for the owner: for 6 of 10 majors and 14 of 20 minors the single artifact the
contract calls the acceptance truth says the ORIGINAL DEFECT IS STILL THE CURRENT TRUTH,
with no evidence cell to check. The per-clause verdicts exist only inside review markdown
under `evidence/p8/review-p8-*/` and the PR body — not in the register, and not summarised
anywhere the owner is pointed at (`CUTOVER-PACK.md` / final report both point at the register).

### D-2 The §8.4 pinned anatomy is NOT delivered at 1280 — the live canvas is ~1958px below the editor
Owner pin: `docs/leadgen/rework/design-pack/themes.html` (rendered:
`PIN-designpack-themes-1280.png`), verbatim from the pin header — *"Pins the Themes tab
replacing its swatch-only preview with a live real-section canvas **beside the editor**"* —
and the pin's own legend row `8.4-live-canvas | §8.4 | "Replaces the swatch-only preview —
'beside' the editor controls"`. The pin's mock is authored and rendered **at 1280** and shows
four columns: YOUR THEMES | editor controls | LIVE PREVIEW — THIS THEME | IN THIS QUOTE.

Driven by me on the real page (`/admin/leadgen/themes`, theme opened, measured
`getBoundingClientRect` on the two `data-pin` children of `8.4-center-pane`):

| viewport | centre-inner | editor | canvas | beside? |
|---|---|---|---|---|
| 1600 | 624 | x603 y165 w258 | x887 **y165** w340 | **YES** |
| 1280 | 304 | x603 y165 w304 | x603 **y2123** w304 | **NO — 1958px below** |
| 375 | 285 | x45 y419 | x45 y2441 | NO |

`themes-anatomy-1280.png` shows the pixels: at 1280 the operator sees YOUR THEMES / colour
roles / IN THIS QUOTE and **no live canvas anywhere in the viewport** — they must scroll
~2,000px to see the preview of the colour they are picking. `themes-anatomy-1600.png` shows
the pin honoured at 1600. The CLOSE fix's own comment states the limit in-code
(`ui-theme-manager.ts:1119` — *"Below ~1600 viewport the canvas wraps UNDER the controls"*),
so this is a KNOWN, DELIBERATE limitation of the CLOSE product fix — and it is recorded in
**no register row at all**: the fix appears only in the tracker's cost table and
`P8-FINAL-REPORT.md:130`, phrased as *"the themes-manager §8.4 side-by-side anatomy, which
never engaged at ANY width 1280–1600"* — which reads as fixed for 1280–1600 and is not.
Owner clause it violates: *"the canvas should include one section in the middle so the user
could see a real reference of how is design is gonna look like in real life"* + the §8.4 pin.

### D-3 A false in-code arithmetic claim survives at HEAD in the same function CLOSE corrected
`api/src/admin/leadgen/ui-theme-manager.ts:1025-1028` still reads *"1280 IS UNCHANGED:
hypothetical sizes 300 + 26 (gap) + 340 … = 666 still fit the 670px row the reviewer measured
(304 + 26 + 340)"*. Driven: the centre-inner row at 1280 is **304px**, not 670 — the 304 in
that sentence is the editor column AFTER the wrap, so the sentence adds the wrapped width to
the widths it wrapped out of. CLOSE rewrote the sibling comment 80 lines below for exactly
this error class and left this one. (`themes-anatomy.txt`.)

### D-4 `P8-FINAL-REPORT.md:32` is FALSE at branch HEAD
Verbatim: *"**Nothing was rebaselined, retired, weakened or skipped to make a gate pass.** … `api/test-ui/__screenshots__/**` is untouched."*
Measured by me: `git diff --stat cddb77a0 1dbf1783 -- api/test-ui/__screenshots__/` →
`leadgen-v25/pattern-a-desktop.png (34628→36180)`, `pattern-a-mobile.png (25760→27448)`.
§7 of the SAME report (`:135`) says *"pattern-A baselines regenerated on a conductor ruling"*.
So the report contradicts itself, and the false half is the reassurance sentence the owner
reads first. (`pattern-a-diffbox.txt`.)

### D-5 The pattern-A baseline was re-blessed on a CONDUCTOR ruling while its sibling in the same directory is owner-only
`ADJ-P8-36` states, for `__screenshots__/leadgen-v25/pattern-b-{desktop,mobile}.png`:
*"This is manual visual QA, which is an owner-authority stop"* and the ruling text is
*"re-blessing the frozen baseline is yours alone"*. At CLOSE the conductor re-blessed
`pattern-a-{desktop,mobile}.png` — **the same `__screenshots__/leadgen-v25/` directory and the
same spec file `leadgen-patterns-v25.spec.ts`** — on its own ruling, with no register row at
all (grep: `pattern-a` appears in ZERO register rows; only the tracker cost table and report
§7 mention it). `CLAUDE.md` lists manual visual QA among the user-authority stops.
The diff itself is honest — I measured it: the changed pixels are confined to ONE band
(desktop bbox y 555..676 of 916, 4.05% of pixels; mobile y 473..594 of 816, 5.17%), the
footer/trust region, exactly as claimed. The **authority**, not the classification, is the finding.

### D-6 `cache_refresh_warning` has ZERO consumers — the "surfaced" half of the B2/CLOSE fix cannot reach the operator
`themes-handlers.ts:746` adds `cache_refresh_warning` to the 200 body, and its own comment
(`:732-734`) claims *"surfaced instead — logged AND named in the 200 body … so a propagation
failure is visible by design rather than by accident"*. The register's B2 CLOSE addendum
repeats it: *"invalidation failures now logged and surfaced as cache_refresh_warning"*.
Grep-enumerated ALL consumers of `PATCH /themes/:id` — three call sites
(`ui-theme-manager.ts:1377`, `:1494`, `quotes-tabs/theme-preset-resolve.ts:278`) — and the
manager's handler is:
```
}).then(function (res) {
  if (res.ok) { window.location.reload(); return null; }
```
It never reads the body on success. `grep -rn cache_refresh_warning src/` returns the handler
only; the sole other hit in the repo is a NEGATIVE unit assertion
(`test/leadgen-p8-b2-invalidate.test.ts:399` asserts the string is ABSENT on success).
So on a real propagation failure the page silently reloads and the operator is told nothing —
the exact silent-failure shape the fix was written to end. The `console.error` remains, and
local dev logs are not an operator surface.

### D-7 N18's PASS rests on a claim I refuted by driving: a live page CAN render `.lg-logo`, and it can be VISIBLE
Register N18 (now PASS) says: *"`.lg-logo` has NO producer on any live page at HEAD"* and
*"the display_size bleed's visible target is EXTINCT … no element can ever match those rules"*.
Its reasoning enumerates only `renderHeaderLogo` + the frame ladder. It missed a **second
emitter**: `renderImageBlockAutoLogo` (`public/leadgen/components/presets.ts:4211-4231`) emits
`<span class="lg-logo">` whenever an `ImageBlock` node carries `source:"auto_logo"` + `siteName`
and no `logoUrl`. `siteName` is not an enumerated ImageBlock prop and the schema has **no
unknown-prop rejection**, so it round-trips.
Driven by me through the REAL routes on my own fixture: `PATCH /sections/<id>` with
`{"type":"ImageBlock","props":{"source":"auto_logo","siteName":"KO-REVIEW-LOGO-MARK","accent":"XZ"}}`
→ **HTTP 200**; the live visitor page `/lg/r2fix?_cb=…` then serves
`<span class="lg-logo" …>KO-REVIEW-LOGO-MARK<span class="lg-logo-accent">XZ</span></span>`
(count **1**, six consecutive fresh-`?_cb` polls). Walking the funnel to that step makes it
**VISIBLE: 271×20 at 1280 AND at 375** (`n18-visible-logo-m-1280.png`, `…-375.png`).
**I then executed N18's owner-named step on it** — the step the row calls unsatisfiable:
computed `.lg-logo` font-size is **17.6px at `display_size:"m"` AND at `"xxl"`, at 1280 and 375**,
while the headline ramps 31→71.3px (1280) and 22→50.6px (375).
**Verdict split:** the clause's OUTCOME is PERFECT and now has the E10 visible-element proof the
row was downgraded for lacking. The row's *justification* is false, and it is the sentence the
INCONCLUSIVE→PASS flip was made on. ADJ-P8-62(a)'s narrower claim (the three
`.lg-frame-header--logo-{s,m,l} .lg-logo` **header-scoped** rules match nothing) survives —
my element is not under the header — but its stated reason ("never the `.lg-logo` span") does not.
(`n18-logo-hunt.txt`.)

### D-8 ADJ-P8-27 is STALE — the "data-loss-adjacent trap" it asks the owner to rule on is already fixed
Register ADJ-P8-27, `BLOCKED(owner ruling: fix-or-defer — this is a data-loss-adjacent trap …)`:
*"A theme whose name is long can never be renamed or deleted — the product 500s… an 83-character
theme id returns HTTP 500 on a PATCH-that-changes-anything and 500 on DELETE"*.
Driven at HEAD: a **77-char** id (the maximum the 80-char name cap allows) →
`POST 201 · PATCH(change) 200 · DELETE(unused) 200`; the in-use case returns a plain-language
**409** naming the funnel, not a 500. The CLOSE `themeIdCandidatePattern` fix closed it as a side
effect and nobody updated the row. Same class as the mission's own ADJ-P8-3
(*"a row asking you to rule on a hazard closed three weeks earlier"*), which §5 already counts
among its six false claims. (`adj56-list-search.txt`.)

### D-9 The register's M/N cells are not merely unflipped — several are FACTUALLY FALSE at HEAD
Driven counter-examples to rows still asserting the seed defect:
- **N9** — `DEVIATES(contract: letters skip G)`. Driven census of the live Templates tab:
  `["A","B","C","D","E","F","G","I","J"]` — G exists; **H** is the gap. Source confirms it is
  deliberate (`quotes-tabs/templates.ts` letter map). The cell describes a state that no longer exists.
- **N2** — `DEVIATES(contract confirmed live at ui-rules-builder.ts:2206)`. Driven in the New
  routing rule dialog: *"Operators: is (=) · is not (≠) · greater than (>) · less than (<) ·
  at least (≥) · at most (≤) · between · in list · not in list · is empty · is not empty."*
  The `eq · neq · gt · lt · gte · lte` string is gone. (`rules-rail-new-1280.png`.)
- **N6** — `DEVIATES(contract confirmed live in columns + rule Target-funnel select)`. Driven: the
  rule's Target-funnel select reads `New funnel 1`, `New funnel 2` — distinguishable. (`rules-rail.txt`.)
- **M3's dialog leg** — `DEVIATES(… all four dialog claims false)`. Driven: the confirm list is
  derived from the real diff and every promise is true (see the clause table).
So the register understates the delivered work AND misstates the product. Both directions are wrong.

### D-10 No gate run covers branch HEAD `1dbf1783`
- `gate-logs/p8-CLOSE-fixround.log:3` stamps `HEAD: 5bdb8975` with an explicitly DIRTY tree
  (46 modified paths, labelled "gated pre-commit") — that run became `92ccbf32`.
- `gate-logs/p8-TERMINAL-battery.log` §(3) stamps `HEAD: 92ccbf32` **"+ uncommitted W2c spec
  re-mints + register widening"** and carries only `TYPECHECK_EXIT=0` plus 7 per-spec confirmations.
- Nothing in either log is stamped `1dbf1783`. So at the sha the owner would merge there is no
  authoritative `npm test` / `verify:all` / bundle / register run — the counts in
  `P8-FINAL-REPORT.md:153-155` are from the `5bdb8975`-stamped run.
Recomputed by hand from the raw text where a run does exist: `p8-CLOSE-fixround.log:253-254`
= `Test Files 497 passed | 2 skipped (499)` and `Tests 8411 passed | 30 skipped (8441)` →
8411+30 = 8441 ✓ and the report's "(8441, 499 files)" ✓. Register I re-ran myself at HEAD:
**107 rows / 0 violations, exit 0** ✓.

### D-11 The FLAKY-BASE bucket for 2 of 30 specs rests on a run whose raw output no longer exists
Recomputed every count from the committed TSVs by my own hand (`classification-recompute.txt`):
`comparable BASE30 = 254 passed / 12 failed`, `HEAD30 = 208 passed / 51 failed` — both match
`battery-classification.md:25` exactly. But by base-vs-head alone the INTRODUCED set is **20
specs / 35 failures**, not 18: `leadgen-operator-acceptance.gesture` (base 0 → head 2) and
`leadgen-quote-builder` (base 0 → head 1) are bucketed FLAKY-BASE purely on the `yday(h=2,b=2)` /
`yday(h=1,b=1)` column in `classification.txt`, and `battery-classification.md:8-11` states that
those raw logs were destroyed by the machine restart. So 2 of 30 bucket assignments are not
reproducible from committed evidence, and report §7 restates "2 flaky-at-baseline, and 18
genuinely introduced" as measured fact.
Separately, `leadgen-rework-acceptance-builder.gesture` is bucketed **PRE-EXISTING** on
`base(f=1)` while head carried **6** — five head-only failures inside a bucket named for
pre-existing ones. (Those five WERE fixed by the theme-500 fix; the label, not the work, is wrong.)

### D-12 Two of the four "conductor-confirmed one by one" in-sequence artifacts were confirmed under the polluted protocol
Report §7: *"4 in-sequence artifacts that each pass under the clean isolated protocol,
conductor-confirmed one by one"*. `p8-TERMINAL-battery.log` §(3) shows the first CONFIRM batch
**seeded once and ran 7 specs sequentially** (the conductor's own disclosed error, §5 item 2), and
`CONFIRM-2 (fresh D1+seed each)` re-ran only **2** of them (`leadgen-r2p1-fixround-smoke`,
`__r2-logo-progress-drive`). `leadgen-rework-p3b-board.gesture` and
`leadgen-rework-acceptance-builder.gesture` were never re-confirmed per-spec.
**I closed this gap myself** (2 of my ≤6 allowed scoped re-runs, each with fresh
`db:reset:local` → wrangler → seed → server killed → one `npx playwright test`):
`p3b-board 32 passed (17.2s)`, `acceptance-builder 24 passed (16.0s)`
(`rerun-p3b-board.txt`, `rerun-acceptance-builder.txt`). The claim is TRUE; its evidence chain was not.

### D-13 A false arithmetic claim survives in the very function CLOSE corrected
`ui-theme-manager.ts:1025-1028`: *"1280 IS UNCHANGED: hypothetical sizes 300 + 26 (gap) + 340 …
= 666 still fit the 670px row the reviewer measured (304 + 26 + 340)"*. Driven: the centre-inner
row at 1280 measures **304px**, not 670 — the 304 in that sentence is the editor column AFTER the
wrap, added to the widths it wrapped out of. CLOSE rewrote the sibling comment 80 lines below
for exactly this error and left this one. (`themes-anatomy.txt`.)

### D-14 ADJ-P8-60's spec is GREEN in the re-measured battery it is cited against
ADJ-P8-60: `leadgen-rework-p4-themes.gesture.spec.ts:279` *"fails at BOTH shas on BOTH engines
under the clean protocol"*. It does not appear among the 15 specs with failures in
`full-battery-summary.tsv` (I enumerated all 20 failures — see below). Under the conductor's own
rule ("the per-spec clean protocol is the truth instrument for any red") the spec is red, so
report §7's *"every one of the 20 is attributed"* is true only of the battery's 20 and silently
omits a 21st spec that the truth instrument calls red.

### D-15 The 20 full-battery failures DO reconcile exactly (audited, no finding)
Recomputed from `full-battery-summary.tsv` by my own hand: 101 specs, **784 passed / 20 failed /
24 skipped**, 15 specs with ≥1 failure — matching report §7's headline. Attribution recomputed:
frozen `leadgen-visual` 2 + `leadgen-v31-gate1c-baselines` 1 = **3**; ADJ-P8-36 `r2p6-f1` 2 +
`f1b` 2 = **4**; ADJ-P8-58 `__r2-dead-controls-drive` **2**; ADJ-P8-59 `forensic-live-probe` 1 +
`leadgen-canvas-interactions` 2 = **3**; ADJ-P8-61 `leadgen-quote-builder` **1**; slider trio
`r2p4-fixfirst`+`fixround2`+`slider` = **3**; in-sequence `__r2-logo-progress` + `r2p1-smoke` +
`acceptance-builder` + `p3b-board` = **4**. Total **20** ✓. Every failure is attributed.

### D-16 Residual jargon on the rules rail the register does not inventory (minor)
Driven in the New routing rule dialog at 1280 and 375: *"FB multiplier — **Replaces the base S2S
multiplier** for this conversion."* `S2S` is an internal acronym on the surface the owner named
(*"the rules you build are using jargon"*), and it is not among ADJ-P8-52's 6 inventoried residual
sentences. Zero `(§` strings and zero raw operator tokens were found anywhere in the dialog
(116 visible text nodes at 1280, 123 at 375, jargon hits **0** by my scan).
(`rules-rail-new-1280.png`, `rules-rail.txt`.)

### D-17 Deferral/reduced-model scan — results
Diff-scoped marker scan over ALL added lines in both CLOSE commits
(`\b(TODO|FIXME|HACK|XXX)\b`, "polish later", "for now", `defer(red)? to (v2|later|a follow-up)`,
`simplified for (now|v1)`, `will be (done|added) later`): **exactly one hit**, and it is not a
deferral — `+ await expect(note).toContainText("visitors type every field themselves for now")`
pins a PRE-EXISTING product sentence (`ui-section-studio.ts:13087`) that explains the no-Maps-key
state to the operator.
Marker-free reduced-model hunt over the CLOSE source change (2 source files): **two found**, both
already listed — D-6 (`cache_refresh_warning` is a dead output: a control with no surface) and
D-2 (the §8.4 anatomy fix delivers the pin only at ≥1600).
Assertion-strength scan across the whole CLOSE diff: **25 expects removed / 43 added**, and
**zero** `.skip(`, `.only(`, `test.fixme`, `maxDiffPixels`, `threshold`, `toBeTruthy()`,
`expect.soft` added. I audited every removal; all are semantic re-mints, and the two that
mattered are strictly correct:
`expect(applyRequestFired,"Cancel must never call apply-template").toBe(false)` became a
`postDataJSON().dry_run !== true` discriminator that still forbids a REAL apply on Cancel; and
the patterns-v25 trust/footer counts became `toHaveCount(0)` + `toHaveCount(branding.legal_links.length)`
(positive assertions of the new truth, the second now derived from the same source the product
reads — slightly self-referential, noted).

### D-18 Security pass — clean
`themeIdCandidatePattern` (`themes-handlers.ts:567-575`) is bounded ≤50 bytes **by construction**
and every LIKE is `.bind()`-parameterized (`:589`, `:597`); the CLOSE diff adds **zero**
template-literal SQL (`grep -E "prepare\(\s*\`|WHERE .*\$\{"` on added `api/src` lines → 0).
An attacker-supplied `%`/`_` in the URL id can only widen the candidate set and is then decided
exactly by `referencesThemeId`, and an unknown id 404s at `existing[id] === undefined` before the
scan. No secrets in the diff. No new unauthenticated route.
Live authz spot-check: the four ADJ-P8-56 routes and the theme routes all sit behind the same
admin router as before; no new route was added.

### D-19 ADJ-P8-56 is real, reproduces exactly, and is correctly owner-scoped (audited, no finding)
Driven by curl at HEAD: `GET /api/admin/leadgen/offers?search=<47 a's>` → **200**;
`<49 a's>` → **500 `{"error":"Internal Server Error"}"`**; `<60>` → 500; and 49 chars → **500 on
all four** of `/offers`, `/auctions`, `/sections`, `/quotes`. Matches the row verbatim.
(`adj56-list-search.txt`.)

### D-20 ADJ-P8-57's class reproduced by my own hand (audited, confirms the row)
Three scoped spec runs (not a full battery) re-captured **19 committed evidence PNGs** under
`docs/leadgen/r2/evidence/p4/**`. `api/test-ui/__screenshots__/**` stayed untouched.
I restored all 19 with `git checkout --` and left the tree clean apart from this review dir.

> **Note:** D-13 and D-3 are the SAME finding (the `ui-theme-manager.ts:1025-1028` false
> arithmetic). Counted once in the ranking below.

---

## RANKING

### BLOCKER (1)
**BL-1 = D-1 — the register does not record acceptance for 22 of the contract's 33 §5–§7 items,
and several of its cells are factually false at HEAD (D-9).**
Owner clause / register row it violates: the register's own governing sentence
(*"Every row starts as `DEVIATES(<the contract's measured finding>)` … and flips only on driven
proof"*) plus `P8-FINAL-REPORT.md:40` (*"Every item in §4–§7 is fixed-and-driven or
reported-with-evidence"*) and `:28`/`:154` (`check_register.py` 107/0 offered as the acceptance
proof). File:line — `docs/leadgen/r2/P8-REGISTER.md` rows M1, M3, M4, M5, M6, M7, M9, M10, N2,
N3, N4, N5, N6, N8, N9, N10, N12, N13, N14, N16, N17, N19, REQ-R1, REQ-R3, REQ-R5.
Failure scenario: the owner opens the artifact `CUTOVER-PACK.md` and the final report both point
at as the acceptance truth and reads that 6 of 10 majors and 14 of 20 minors are still DEVIATES
with the seed defect and an empty evidence cell — while the report says everything is fixed. They
cannot tell which majors shipped, and four of the cells they WOULD believe (N9, N2, N6, M3's
dialog) describe a product that no longer exists. The validator cannot catch it: I read its rules
and re-ran it (exit 0) — it never asks whether a DEVIATES row was resolved.
Evidence: `git diff cddb77a0~1 cddb77a0 -- P8-REGISTER.md` (one M/N cell changed, M8 only);
`rules-rail-new-1280.png` (N2 fixed); `tpl-drive4.txt` (M3 dialog true); `rules-rail.txt` (N6
fixed, N9 letters A–G,I,J).
Cheapest correct fix: one conductor pass writing the per-clause verdicts that already exist in
`evidence/p8/review-p8-{4..ship}/REVIEW.md` into the 22 rows, with their screenshots — plus a
validator rule that a terminal register may not carry an unresolved `DEVIATES` with an empty
evidence cell.

### MAJOR (6)
**MJ-1 = D-2 — the §8.4 pinned anatomy is not delivered at 1280; the live canvas sits 1958px below
the editor, and the CLOSE product fix has no register row.**
Clause: the pin `docs/leadgen/rework/design-pack/themes.html` (*"a live real-section canvas
**beside the editor**"*, legend `8.4-live-canvas`) + owner *"the canvas should include one section
in the middle so the user could see a real reference of how is design is gonna look like in real
life"*. File:line `api/src/admin/leadgen/ui-theme-manager.ts:1119-1131`.
Scenario: an operator on a 1280 laptop picks Brand primary and cannot see the live preview at all
without scrolling ~2,000px. Report §7 phrases the fix as curing "1280–1600", which it does not.
Screenshots: `themes-anatomy-1280.png` (no canvas in viewport), `themes-anatomy-1600.png`
(pin honoured), `PIN-designpack-themes-1280.png` (the owner's pin, at 1280).

**MJ-2 = D-6 — `cache_refresh_warning` has no consumer, so the B2 CLOSE addendum's "surfaced" is false.**
Row: B2 CLOSE addendum. File:line `themes-handlers.ts:741,:746` vs `ui-theme-manager.ts:1382`
(`if (res.ok) { window.location.reload(); return null; }`).
Scenario: the content-version bump throws (the exact case CLOSE found had been silently swallowed
for the life of the feature); the operator's page reloads with no message and their live funnels
keep serving stale values. Screenshot: `b2-drive-curl.txt` (the success path proves the field is
absent on success; the failure path has no surface to screenshot — that IS the finding).

**MJ-3 = D-4 — `P8-FINAL-REPORT.md:32` states `api/test-ui/__screenshots__/** is untouched` and
`Nothing was rebaselined`, both false at HEAD.** Evidence `pattern-a-diffbox.txt`.

**MJ-4 = D-5 — pattern-A's baseline was re-blessed on a conductor ruling although ADJ-P8-36 rules
the identical act on the sibling file in the same directory to be owner-authority, and no register
row records it.** Rows: ADJ-P8-36 + `CLAUDE.md` (manual visual QA = user-authority stop).
Evidence `pattern-a-diffbox.txt`, `close/pattern-a/pattern-a-desktop-diff.png`.

**MJ-5 = D-7 — N18 flipped INCONCLUSIVE→PASS on the sentence "`.lg-logo` has NO producer on any
live page at HEAD", which I refuted by driving a visible `.lg-logo` onto a live page.**
Row: N18 (+ ADJ-P8-62(a)'s stated reason). File:line `presets.ts:4211-4231` (the missed emitter);
schema has no unknown-prop rejection so `siteName` round-trips.
The clause's OUTCOME is PERFECT — I executed the owner's named step on the live element and the
font-size is identical at `m` and `xxl` — so the fix is required to be the row's *reasoning*, not
the product. Screenshots `n18-visible-logo-m-1280.png`, `n18-visible-logo-xxl-1280.png`,
`n18-visible-logo-m-375.png`, log `n18-logo-hunt.txt`.

**MJ-6 = D-10 — no authoritative gate run is stamped at branch HEAD `1dbf1783`.**
Rule: `.claude/rules/mission-loop.md` ("the conductor runs the phase gate ritual ONCE … tee'd raw
to a sha-stamped gate log"). Latest stamps are `5bdb8975` (dirty tree) and `92ccbf32` (+
uncommitted). Cheapest fix: one gate ritual at HEAD (typecheck · npm test by count · verify:all ·
bundle · check_register), tee'd to a `1dbf1783`-stamped log.

### MINOR (6)
- **MN-1 = D-3/D-13** false arithmetic surviving at `ui-theme-manager.ts:1025-1028` (row 670px vs
  driven 304px), in the function CLOSE corrected for the same class.
- **MN-2 = D-8** ADJ-P8-27 is stale: long-id theme PATCH/DELETE now 200/200 (driven), yet the row
  still asks the owner to rule on a 500.
- **MN-3 = D-11** the FLAKY-BASE bucket for `leadgen-operator-acceptance` and
  `leadgen-quote-builder` rests on a `yday` column whose raw logs the doc itself says were
  destroyed; and `acceptance-builder` is labelled PRE-EXISTING with 6 head failures vs 1 at base.
- **MN-4 = D-12** 2 of the 4 "conductor-confirmed one by one" artifacts were confirmed under the
  seeded-once batch; I closed the gap myself (32 passed / 24 passed).
- **MN-5 = D-14** ADJ-P8-60's spec is green in the re-measured battery it is cited against, so
  report §7's "every one of the 20 is attributed" omits a 21st red-under-the-truth-instrument spec.
- **MN-6 = D-16** `"Replaces the base S2S multiplier"` — an internal acronym on the rules surface
  the owner named for jargon, not inventoried in ADJ-P8-52.

### AUDITED CLEAN (no finding)
D-15 (the 20 battery failures reconcile exactly, 784/20/24 recomputed), D-17 (deferral scan: one
hit, not a deferral; assertion strength: −25/+43, zero weakening tokens, both load-bearing removals
strictly correct), D-18 (security: bounded+parameterized LIKE, no template-literal SQL, no new
route, no secrets), D-19 (ADJ-P8-56 reproduces verbatim), D-20 (ADJ-P8-57's class reproduced;
baselines untouched by my runs; 19 re-captured evidence files restored).

---

## VERDICT: **FIX-FIRST** — 1 BLOCKER · 6 MAJOR · 6 MINOR

## PER-CLAUSE VERDICT TABLE

Legend: **DROVE** = I operated the real product this session · **AUDITED** = register row + its
cited artifacts + source verified by my hand, not re-driven.

| Clause | What I DROVE / AUDITED | What I measured | Verdict |
|---|---|---|---|
| **B1** address autocomplete alive on the multi-field default | AUDITED (needs a URL-whitelisted Maps key; CLOSE's own sweep lists the B1 re-drive as a NAMED SKIP) | Register B1 PASS cites review #3's intercepted `Autocomplete` ctor 0→1 + `.pac-container=1`; B1-FILL PASS with 1280+375 shots; all cited screenshots exist on disk (`check_register` R3, re-run by me: 0 violations). B1-GOOGLE correctly stays INCONCLUSIVE with a named cutover step | PERFECT (audited) · B1-GOOGLE BLOCKED(owner, correctly) |
| **B2** theme PATCH reaches the live page with no activation save | **DROVE** | Authored theme id **63 chars** (the CLOSE fix's exact ≥36 class) → `PATCH 200`, **no** `cache_refresh_warning`; `content_version 4→5`; ONE fresh `?_cb` visitor fetch: `--lg-primary #AB1234 → #3D9970`, old-colour occurrences 18→0, new 0→18, **no activation save, no funnel-theme PUT, no restart** | **PERFECT** — `b2-visitor-theme-3D9970-1280.png` / `-375.png` show the progress rail repainted in the new brand colour; `b2-drive-curl.txt` |
| **B2** CLOSE addendum: "invalidation failures … surfaced as `cache_refresh_warning`" | **DROVE** + grep-enumerated all 3 consumers | Field set at `themes-handlers.ts:746`; `ui-theme-manager.ts:1382` reloads without reading the body; zero renderers repo-wide | **DEVIATES (MJ-2)** |
| **B3** theme edit from funnel C's chip hits only C | AUDITED | Register PASS certified by review #5 across storage + 4 rendered pages (C×8, A/B/D×0) with 1280+375 shots on disk; residual ADJ-P8-10 disclosed | PERFECT (audited) |
| **B4** Themes canvas matches Templates; site picker re-renders | AUDITED + **DROVE the canvas anatomy** | Register PASS cites byte-equal CSS on A/C/E at both viewports + a 375-reachable picker. My own drive of the same surface found the §8.4 pin unmet at 1280 (canvas y2123 vs editor y165) | **DEVIATES (MJ-1)** on the pinned anatomy; parity legs PERFECT (audited); ADJ-P8-15 carve-out correctly BLOCKED(owner) |
| **B5** ≥2 funnel columns at 1280; drag reaches every column | AUDITED | Register PASS after 6 review rounds: 2 of 5 columns fully visible at 1280, pointer drag auto-scrolled 0→880 into the furthest funnel proven in storage, 5 silent-drop paths given legible reasons, keyboard + touch positions stated; 6 shots on disk | PERFECT (audited) |
| **M1** progress as one coherent element | **DROVE (partial)** + AUDITED | Live Templates tab paints `I · Progress` with 5 style tiles and the honest note *"5 real styles (Bar/Dots/Numbered/Percent/Icon on track) — 'Hidden' is the toggle below, not a 6th style"*; the `custom` icon enum is pinned by a CLOSE re-mint | Product PERFECT on what I drove; **register row DEVIATES-unflipped → BL-1** |
| **M2** all ~80 theme keys honoured or removed; guard re-predicated | AUDITED | Register PASS: 34/34 inline keys ALIVE over 3 identical runs, guard enumerates 129 keys with a visible-computed-value predicate + label→target invariant, empty allowlist; CLOSE sweep re-reports 0 DEAD / 0 MIS-TARGETED | PERFECT (audited) |
| **M3** template apply changes the page; dialog promises true; A/B arms differ | **DROVE** | `Apply to funnel…` → picker (6 templates) → choosing *White + trust bar* fires exactly `POST /apply-template {"template_id":5,"dry_run":true}` → 200 `applied:false` with diff-derived `confirmations`. Dialog paints 4 lines; each promise verified on the served page: `section_slot.card card→bare` ⇒ `.lg-frame-slot--bare .lg-question-card{background:transparent}`; `header.sticky true→false` ⇒ `lg-frame-header--static`; `background.role page_background→card_background` ⇒ `.lg-frame-background` computes **rgb(245,245,245)** = my theme's `card` role, class `lg-frame-bg-role-card_background`. **Cancel:** `frame_config` and `frame_template_id` byte-identical before/after (verified by GET). **Confirm:** frame became `lg-frame--white-trust`, header region appeared | Product **PERFECT** — `tpl-11-confirm-1280.png`, `tpl-12-after-cancel-1280.png`, `tpl-13-after-confirm-1280.png`, `bg-role-probe.txt`; **register row DEVIATES-unflipped → BL-1** |
| **M4** address whole feature | AUDITED | Register M4 unflipped; the substantive work is recorded across ADJ-P8-9/46/47/47b/50, all BLOCKED(owner) with driven measurements | **register DEVIATES-unflipped → BL-1**; owner rows correctly BLOCKED |
| **M5** no `(§` on operator surfaces; humanizer honest; copy check | **DROVE** | Authored 3 sections through the real `POST/PATCH /sections`: every rejection came back in operator words — *"'Address Field Set' isn't a component this build recognizes. Remove it, or replace it with one from the library."*, *"'Answer type' must be 'string' for a Text — you set 'text'."*, *"'Currency symbol ($) prefix' must be on or off. Toggle it."*, *"The theme name must be 80 characters or fewer. Shorten it."* — **zero `(§`**, zero invented field names. Rules dialog: 116/123 visible text nodes at 1280/375, **0 jargon hits** | Product **PERFECT** (one minor residue, MN-6); **register row DEVIATES-unflipped → BL-1** |
| **M6 / M7** canvas parity; no chrome in `<option>` | **DROVE the state sims** | `data-qa-tools-only` drawer → sims fire one `POST /sections/preview` each. `error`: exactly 1 `aria-invalid` (the required-empty FreeText) with a **SHOWN** (not `hidden`) *"This field is required."* — closing ADJ-P8-22's shape. `validation_error`: **per-subfield** — only `data-lg-error-for="rvw_addr_zip"` is shown, carrying the field's OWN message *"Enter a valid 5-digit ZIP code."*, street/city/state/base/note slots stay hidden, exactly 1 `aria-invalid` (the ZIP) — **G3c honoured**. `validation_success`: `lg-valid` on `div[q=rvw_addr]` + `input[q=rvw_note]`, i.e. the canvas/live divergence **exactly as ADJ-P8-49 registers it** | Product **PERFECT**; ADJ-P8-49 description still matches reality → **not flagged**; `g3c-persubfield-probe.txt`, `studio-sim-validation_error-1280.png`; **register rows DEVIATES-unflipped → BL-1** |
| **M8** emptying a shared page stops serving it | AUDITED | Register records a conductor-driven REFUTATION with the code path (`quotes-handlers.ts:2573` unconditional DELETE; `grep 'slot_id IS NULL'` → 0) and names one untraced path | PERFECT (refutation, correctly evidenced) |
| **M9** stale copy at 5 sites | AUDITED | Register still lists 4 of 5 as OPEN and allocated to P8-4; the CLOSE commit says `"slides"→"sections"` was re-minted | **register DEVIATES-unflipped/contradictory → BL-1** |
| **M10** saved-template thumbnails; board Template chip | **DROVE (partial)** | Live Templates tab renders 6 saved-template chips each with a thumbnail glyph, not a raw-enum pill (`tpl-01-tab-1280.png`) | Product PERFECT on what I drove; **register DEVIATES-unflipped → BL-1** |
| **N-family: N1, N7, N11, N18, N20** (P8-3, PASS rows) | AUDITED + **DROVE N18** | N18's outcome re-proven by me on a live VISIBLE `.lg-logo` (17.6px at `m` and `xxl`, 1280+375) — the row's justification is refuted (MJ-5). N1/N7/N11/N20 PASS with on-disk 1280+375 shots | N18 outcome PERFECT / reasoning **DEVIATES (MJ-5)**; N1/N7/N11/N20 PERFECT (audited) |
| **N-family: N2, N4, N5, N13** (rules/AB copy) | **DROVE N2** | Rules dialog reads *"Operators: is (=) · is not (≠) · greater than (>) · less than (<) · at least (≥) · at most (≤) · between · in list · not in list · is empty · is not empty."* — the `eq · neq · gt · lt · gte · lte` string is gone | N2 product **PERFECT**; **register cells false/unflipped → BL-1** |
| **N-family: N6, N9, N12, N17** (naming/letters) | **DROVE N6, N9** | Target-funnel select: `New funnel 1`, `New funnel 2`; element letters `A B C D E F G I J` (G present, H the deliberate gap, owner's Progress=I / Footer=J honoured) | Product PERFECT; **register cells false → BL-1** |
| **N-family: N3, N8, N10, N14, N15, N16, N19** | AUDITED | Unflipped seed cells; N14/N15's substance is recorded in ADJ-P8-40/43/44 (BLOCKED-owner) and report §3 records N14 as refuted by driving | **register DEVIATES-unflipped → BL-1** |
| **Money path** — typed out-of-order `from_to` value lands exactly (ADJ-P8-51) | **DROVE** + 1 scoped spec re-run | Authored a `from_to` slider (min 0 / max 100000 / **step 5000**) through the real routes and walked the funnel: per-character `40` into "To ($)" → box reads **40** before AND after blur, pill reads **$40** — **not** rewritten to 5000. The rails snap to 0, exactly the invisible-thumb consequence ADJ-P8-51 self-discloses. `leadgen-r2p4-slider-drive.spec.ts` **6 passed** under my clean per-spec protocol; the W2c re-mints change out-of-order expectations from `neighbour+STEP` to the neighbour's EXACT value, which is the shipped J1 semantics the register states | **PERFECT** — `money-slider-typed40-1280.png` shows box `40` / pill `$40`; `money-path.txt`, `rerun-slider-drive.txt` |
| **Rules rail language** — *"the rules you build are using jargon, have no actions, and just poor poor execution"* | **DROVE** | `+ New rule` → dialog with `Rule name · up to 80 characters`, `Checkpoint · read-only: Entry — Derived from the conditions`, `Conditions: Always matches — no conditions`, operator-word Sources and Operators, and an explicit **`Actions · pick at least one`** block (Target funnel / Feed name / FB multiplier / Redirect %), each with a plain-English one-liner. 0 `(§`, 0 raw tokens | **PERFECT** apart from MN-6 (`S2S`) — `rules-rail-new-1280.png` |
| **§9 OWNER-1** shared-page publish gate | AUDITED | `BLOCKED(owner ruling: relax or keep)`, cites contract §9.1, gate untouched | BLOCKED(owner) — correct |
| **§9 OWNER-2** Image29/30/31 unbuilt | AUDITED | `BLOCKED(owner ruling: build remaining three or defer)`; cross-checked against `p7-owner/CONTRACT-CONFORMANCE.md` SRC-J which independently marks them ABSENT | BLOCKED(owner) — correct |
| **§9 OWNER-3** footer colours are role references | AUDITED | `BLOCKED(owner ruling: literal colours vs role references)` | BLOCKED(owner) — correct |
| **§9 OWNER-4** `percent` label gating | AUDITED | `BLOCKED(owner ruling)`, and the P8-4 ruling deliberately did not touch `advanceFrameProgress` (ADJ-P8-31 records the consequence) | BLOCKED(owner) — correct |
| **CLOSE artifact — battery classification** | AUDITED, recomputed | base30 `254p/12f`, head30 `208p/51f` both match `battery-classification.md:25`; full battery `784p/20f/24s` over 101 specs matches report §7; all 20 failures attributed and the arithmetic closes (3+4+2+3+1+3+4=20) | PERFECT on totals · **DEVIATES (MN-3, MN-5)** on 2 bucket labels + the 21st spec |
| **CLOSE artifact — N18 resolution** | **DROVE the refutation of the refutation** | A visible `.lg-logo` exists on a live page; the bleed still does not repaint it | outcome PERFECT · **DEVIATES (MJ-5)** on the stated reason |
| **CLOSE artifact — ADJ-P8-56..62 (new rows)** | AUDITED + **DROVE 56** | ADJ-P8-56 reproduces verbatim (47→200, 49→500 on all four routes). 57's class reproduced by my own 3 spec runs (19 committed evidence files re-captured, restored). 58/59/61 consistent with the TSVs. 60 contradicted by the battery (MN-5). 62(a) narrow claim survives, reason refuted (MJ-5). ADJ-P8-36 CLOSE addendum's mechanism independently corroborated: my pre-apply visitor measurement shows a themed frameless funnel served as `lg-frame--minimal` with `.lg-question-card` radius 0 / transparent — the exact `NARROW_DEFAULT_THEMED_FRAME_CONFIG_JSON` synthesis (`serve.ts:474,:587`) the row names | Rows real and owner-scoped · **DEVIATES (MN-2 stale ADJ-P8-27, MN-5, MJ-5)** |
| **CLOSE artifact — the 4 slice re-mints vs the diff** | AUDITED line by line | −25/+43 expects, zero `.skip/.only/fixme/maxDiffPixels/threshold/soft` added; every removal is a semantic re-mint citing shipped behaviour; the two load-bearing ones are strictly correct (Cancel now discriminates `dry_run !== true`; trust/footer become `toHaveCount(0)` + `toHaveCount(branding.legal_links.length)`). Nothing outside the granted paths: the whole two-commit source delta is **2 files** (`themes-handlers.ts`, `ui-theme-manager.ts`) | PERFECT |
| **CLOSE artifact — frozen-suite integrity** | AUDITED by diff, both commits | `git diff cddb77a0 1dbf1783 -- leadgen-visual.spec.ts leadgen-v31-gate1c-baselines.spec.ts` → **empty**. `__screenshots__` delta = **only** `pattern-a-{desktop,mobile}.png`; `pattern-b-*` untouched. Diff confined to one band (desktop y555..676, 4.05%; mobile y473..594, 5.17%) | Suites PERFECT · **DEVIATES (MJ-3, MJ-4)** on the report's "untouched" claim and the self-blessed re-mint |
| **CLOSE artifact — gate logs** | AUDITED, counts recomputed | `8411 + 30 = 8441` over 499 files ✓ matches report; register 107/0 re-run by me ✓; **but no log is stamped at HEAD `1dbf1783`** and the newest one has an explicitly dirty tree | **DEVIATES (MJ-6)** |

### Tree state on exit
`git status --porcelain` = only `docs/leadgen/r2/evidence/p8/review-p8-program/` (untracked, mine).
The 19 committed `evidence/p4/**` PNGs my three spec runs re-captured were restored with
`git checkout --`. `api/test-ui/__screenshots__/**` untouched by my session. Nothing committed.
