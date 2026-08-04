# P8-3 fix round F13 — fresh-context adversarial review (review #4, "3d")

Branch `leadgen-r2-p8-3`. Gate sha `33f4358`; HEAD `45b0079` (gate-log + ADJ-P8-28 docs commit only —
`git show --stat 45b0079` = 2 files, both under `docs/leadgen/r2/`). Tree porcelain-clean apart from this
evidence directory. Server: the already-running `wrangler dev` on `127.0.0.1:8901` from this worktree
(client only — never started, stopped or bound). Nothing deployed, no secret read or written, no `--remote`
D1. `api/.dev.vars`'s two `GOOGLE_MAPS_*` slots left EMPTY (measured: value length 0 on both lines).

**VERDICT: FIX-FIRST — 1 MAJOR, 4 MINOR.** All seven of F13's own claims verify. The MAJOR is a
*consequence* of claim 5 that none of F13's numbers is shaped to see: the reveal, now installed on 13
leadgen routes instead of 2, unconditionally overwrites and then DELETES a `title` the product itself put
on a select to carry information the option text does not show.

---

## What I authored (all restored)

Two themes created through the real `POST /api/admin/leadgen/themes` (`thm_rv3d-mono-probe` with
Roboto Mono/Newsreader, `thm_rv3d-sans-probe` with Playfair Display/Lexend), one of them renamed to a
76-character operator-style name and back, and a sentinel PATCH of `thm_p8-repro`
(`brand_primary #1D9BF0 → #123457`, `extra_roles.border #ee7733 → #654322`) so every painted value I judge
provably belongs to this session. **Restored**: both probes DELETEd (200/200), `thm_p8-repro` PATCHed back,
theme list back to the original 3, and `/lg/r2fix` back to 18×`#1D9BF0` / 62×`#ee7733` at the identical
98,503 bytes. The known ADJ-P8-27 orphan (`thm_rv3c-…-8f21`) is untouched and still present.

---

## 1. Gate-log audit (run 8, not re-run)

`docs/leadgen/r2/gate-logs/p8-phase-3-run8.log`, recomputed from the raw text by hand:

| Check | Log line | Recomputed | Match |
|---|---|---|---|
| stamped sha | `HEAD: 33f4358d078…` (L3) | == the F13+recapture commit; HEAD is one docs-only commit ahead | yes |
| clean tree | `[status-empty=yes]` (L4) | consistent — 45b0079 adds only docs | yes |
| typecheck | `TYPECHECK_EXIT=0` (L10) | present | yes |
| unit suite | L2727-2728 `Test Files 485 passed \| 2 skipped (487)` / `Tests 8148 passed \| 30 skipped (8178)` | 8148+30 = 8178 = discovered total; `VITEST_EXIT=0` (L2733); zero `FAIL`/`AssertionError`/`↓`-in-leadgen markers in 2,921 lines | yes |
| the 30 skips | L2724-2725, L2781-2792 | all `conversions-*` (env-gated `describeDb`); zero leadgen skips | yes |
| verify:all | `VERIFY_ALL_EXIT=0` (L2893) | present | yes |
| jargon | `TOTAL: 0 hit(s) across 5 categories` (L2836) | 0 | yes |
| bundle | `size: OK (52938 bytes, 99.4% of budget)` (L2811/2900) | 52938/53248 = 99.42% | yes |
| register | `rows checked: 71 … TOTAL violations: 0` (L2905-2911) | present, `REGISTER_EXIT=0` | yes |
| zero-drift | `removed pre-existing: 0 \| changed pre-existing: 1 {dead-controls-guard: (26,58)} \| new files: 16 (+454)`; `7724 + 454 = 8178` | `git diff --name-status f240788..HEAD -- api/test` = 17 added, of which 1 is `test/helpers/leadgen-visible-paint.ts` (not a test file) → **16 new test files**; 0 deleted; arithmetic closes | yes |

Re-ran ONLY the files the diff touches plus the two byte-pins they could break —
`leadgen-p8-n-theme-ui`, `leadgen-p8-m2-role-usedby`, `leadgen-theme-manager-ui`, `leadgen-quote-builder-ui`,
`leadgen-v31-gate2-strings`, `leadgen-p3a-split-parity`, `conversions-admin-shell`:
**7 files / 316 tests passed**. `api/src/admin/templates/` is byte-unchanged since the phase base 543a392
(`git diff --stat 543a392..HEAD -- api/src/admin/templates/` → empty) and
`test/conversions-admin-shell.test.ts` is UNEDITED over the same range.

p3a recapture #7: the parity test re-renders through the live renderers and passes, so no fixture is
hand-edited; every added fixture line is either the emitted `LG_CLIP_REVEAL_SCRIPT` bytes or one of the two
widened `used_by` lines, both of which exist verbatim in `api/src`.

No test weakened across the phase: no `.only`/`.todo` added, the only `describe.skip` is the pre-existing
`DatabaseSync === null` guard, and every F13 pin carries the FULL new literal (the substring trap is
called out in the test comments and honoured).

---

## 2. F13's seven claims, attacked

### Claim 1 — the reveal is no longer self-defeating. **HOLDS.**
`d4-oscillation.json`, `d11-edge.json`.
* `/admin/leadgen/offers` @375, 7 revealed selects, **22 readings → 1 distinct state**: load + 6 sweeps +
  6 synthetic `focusin`/`mouseover` + 4 re-entrant sweeps fired from inside a `mouseover` handler + 4 REAL
  mouse hovers over 4 different selects.
* **Flicker**: 30 consecutive `requestAnimationFrame` samples, re-sweeping every frame → **1 distinct
  computed state** (`ellipsis/All providers`). The forced-clip read never reaches a painted frame.
* **A select that STARTS clipping**: rail `#lg-theme-site-select`, 6 rounds of long↔short through the real
  control with a sweep and a real hover inside every round → deterministic every time
  (`title` == the option text while 253px sits in a 222px box; `null` when it fits).
* **A select that STOPS clipping**: 1280→375→1600→375→1280. At 1600 (542px box) the title, the
  `data-lg-clipped` attribute AND the inline `text-overflow` are all cleared; narrowing re-reveals. The
  "leftover inline ellipsis makes the predicate permanently blind" hazard is closed by the else-branch.
* **Mutation during the queued sweep**, **an 8-step rapid resize burst** (320→480→320), **emptying the
  selected option's text on a revealed select**: all converge to one state; the emptied case withdraws
  cleanly and restores.
* **MutationObserver mid-measure**: cannot happen — the observer takes `childList`+`characterData` only,
  while `lgOverflows` mutates `style` and the reveal mutates `title`/`data-lg-clipped`, i.e. attributes.
  No storm, no loop; an unrelated `<p>` text insertion produced no sweep.
* **Two selects clipping differently**: offers@375 holds 7 revealed and 3 untouched simultaneously, stable.
* The stated blind spot is real and correctly stated: I re-ran the grep — no served rule anywhere in
  `api/src` sets `text-overflow` on a `select` selector.

### Claim 2 — the test can now see the bug. **HOLDS.**
Reproduced the harness in isolation (`scratchpad/drives/h1-harness.mjs`) against the REAL
`LG_CLIP_REVEAL_SCRIPT` bytes, then string-replaced `lgOverflows`'s body with F12's
`return sel.scrollWidth > sel.clientWidth;`:
`REAL → 15 readings / 1 distinct state`, `MUTATED → 15 readings / 2 distinct states`. The harness's
`scrollWidth` getter is a genuine feedback loop and the broken predicate cannot pass it. The getter's rule
also matches the browser I drove (a revealed select reports 222/222 with ellipsis while its natural width
is 253).

### Claim 3 — N7 closed on the manager. **HOLDS.**
`d2-n7-manager.json`, `d2-mgr-typo-mono-1280.png`, `d2-mgr-typo-mono-375.png`.
Every option of every select, both surfaces, both widths, measured with `text-overflow:clip` forced:
* Manager, 2 selects × 11 options × 2 stored themes × 2 widths = **88 measurements, cw 282, over = 0**.
* Rail, 20 visible selects, **110 options at 1280 and 110 at 375; 3 overflow — all DATA-BEARING**
  (two operator site names +31/+14px, one funnel name +19px), and the clipped one that is SELECTED carries
  a full title. Every product-authored option (including all three
  `"… (shows as default font)"` strings at 312px) is +0px.
* Pixels: `d2-mgr-typo-mono-1280.png` shows `Roboto Mono` rendered in the monospace stack with the chevron
  clear of the glyphs and `Shows as default font` on its own line beneath; identical at 375.
* A STORED non-vendored family displays correctly: `Roboto Mono` / `Newsreader` stay selected, painted in
  the family they name, inside `<optgroup label="Shows as default font">` (the other two legacy names
  `hidden`), with the caption rendered per select. Stored values unchanged (API round-trip).
* Also drove a 76-character operator theme name: +229px over the rail's 312px preset box, revealed with the
  full name as `title` at 1280 and 375.

### Claim 4 — the width model is family-aware. **HOLDS in use; the comment's absolute is too strong (MINOR-1).**
`d6-allstrings.json`: **2,234 real option strings** harvested from all 14 leadgen routes, each laid out by
the browser in its own select's computed stack and compared against the test's `textWidthPx`:
**0 under-statements**; the tightest real ratio is 0.968 (mono). Details in MINOR-1.

### Claim 5 — coverage extended to 13 leadgen routes, never via `admin/templates/layout.ts`. **HOLDS (and see MAJOR-1).**
`d1-coverage.json`. Driven with a real browser at 1280 and 375:
* All 13 registered leadgen page routes **plus** the quote-not-found route: `copies = 1`,
  `typeof window.lgRevealClippedSelects === "function"`, **`clipped-without-title = 0`** at both widths.
* `/admin`, `/admin/pages`, `/admin/articles`: `copies = 0`, `window.lgRevealClippedSelects === undefined`.
  (`/admin/articles` clips 7 selects with no title at 375 — the known conversions/CMS item, unchanged.)
* Emitted script measures exactly **3,900 bytes**. `api/src/admin/templates/` byte-unchanged since 543a392;
  `conversions-admin-shell.test.ts` passes UNEDITED.

### Claim 6 — transitions handled. **HOLDS.**
`d8-transitions.json`: `option.textContent` (driven on offers@375, title updates in place);
`textNode.data` (driven on `#tm-headline-font` — a `characterData` record sets the title and shortening
withdraws it); `resize` (driven above); `document.fonts.ready` — the hook is wired and the leg is honest
that no admin page vendors a face today.

### Claim 7 — ledger, `.form-select`, the corrected statement, the widened phrases. **HOLDS.**
* Ledger reads `(R) 87 + (M) 1` with the recount cited to 8f57f27; total 88 unchanged.
* `decl(formSelect,"width") === "100%"` restored as Leg 3 (`leadgen-p8-n-theme-ui.test.ts:2218`) and the
  real sheet still declares it (`admin/templates/layout.ts:469`).
* The false "EVERY admin page" sentence is replaced by "EVERY leadgen admin route and no other product's",
  which my route drive confirms.
* The 4 new `used_by` phrases / 5 new SURFACES rows verified against **my own sentinel colours** on the live
  visitor route: with `brand_primary #123457` and `border #654322` PATCHed in,
  `.lg-frame-trustrow-icon{color:#123457}`, both `--check li::before{color:#123457}`,
  `.lg-frame-progress--numbered .lg-step{border:2px solid #654322}` and
  `.lg-frame-progress--percent .lg-progress-track{box-shadow:inset 0 0 0 1px #654322}`.
* And they satisfy the clip invariant: **14/14 `.lg-used-by` rail rows and 12/12 located manager `sub`
  rows wrap inside their own box (over = 0) at 1280 AND 375**; the two widened lines are the tallest
  (82.5px, three wrapped lines) and still `scrollWidth == clientWidth`.

### Visitor journey
`d7-visitor-*.png`: `/lg/r2fix` driven end-to-end at 1280 and 375 with a real Chrome UA through
`[data-lg-continue]` — 5 steps, **0 pageerrors, 0 console errors, `documentElement.scrollWidth == innerWidth`
at both widths**, and the sentinel theme visibly painting the progress bar and the Continue button.

---

## Findings, ranked

### MAJOR-1 — the reveal destroys a product-authored `title`, on routes F13 newly took responsibility for
`api/src/admin/leadgen/clip-reveal.ts:150` (`sel.setAttribute('title', text)`) and `:154`
(`sel.removeAttribute('title')`).
Owner clause: ADJ-P8-26's fix-or-defer ("leadgen-wide coverage vs theme-surface scope"), which F13 answered
by choosing leadgen-wide coverage. Evidence: `d16-titleloss.json`, `d16-titleloss-375.png`,
`d13-titleclobber.json`.

The reveal treats `title` as if it owns it. Two leadgen selects already carry an author `title`, both on
`/admin/leadgen/sections/:id/edit` — a route that had **no** reveal before F13 and has exactly one copy after it:
* `ui-section-studio.ts:15594` — `pathSel.title = f.path;` with the comment
  *"§12.1: options carry the field LABEL; the raw path rides the tooltip"*, and the product's own help copy
  at `:3263` promises the operator *"the raw path also rides each Field cell's tooltip."*
* `ui-section-studio.ts:2601` — `<select id="lg-content-type-swap" … title="Type — swaps the concrete stored type">`.

Driven on the real element, at 375, through the real drawer (Mapping tab → *Map fields*), changing only the
option LABEL to a realistic payload-field label (labels are built as
`fieldDisplayLabel — plainTypeWords (required)`, and the column is `minmax(180px,1.2fr)`, measured 178px at 375):

```
step 0  title = "lead.r2fix_carrier"                                    (the product's raw dotted path)
step 1  title = "Street address line one and two — text (required)"     (clipped → raw path OVERWRITTEN
                                                                         with text the closed control
                                                                         already shows)
step 2  title = null                                                    (stopped clipping → raw path
                                                                         PERMANENTLY DELETED until reload)
```

Failure scenario: an operator maps a payload field whose label is a few characters longer than this
fixture's single field. The tooltip that was the only place the raw dotted path appeared is first replaced
by the label they can already read, and then deleted outright the moment the grid reflows or the window
widens. Silent — no error, no log. F13's own coverage metric (`0 still-clipped-without-title`) cannot see
this class, because it counts missing titles, not destroyed ones.

Not reproduced at 1280 for this fixture (394px box, label fits) — that is precisely why a 1280-only pass
misses it. The mechanism is width-independent and was also reproduced on `#lg-content-type-swap`
(`d13-titleclobber.json`: `"Type — swaps the concrete stored type"` → `"Headline"` → `null`).

Shape of the fix (not applied): stash any pre-existing `title` on first reveal and restore it on
withdrawal, instead of an unconditional `removeAttribute('title')`; or refuse to touch a select that
already carries a `title` this script did not set.

### MINOR-1 — the width model's stated guarantee is broader than what it delivers
`api/test/leadgen-p8-n-theme-ui.test.ts:351-353` ("so the model still never UNDER-states a width the
browser really produced"). Evidence: `d5-widthmodel.json`, `d6-allstrings.json`.
`BUCKET_FACTOR` is calibrated over ~40 sample strings and the character classes those strings happen to
contain. Driven counter-examples at 14px: `%`×20 → model 182.28 vs real 256.08 (**1.40× under**, sans);
`ÄÖÜÑÇÆØÅÐÞ` → 91.14 vs 104.23 (1.14×, accented capitals miss the `A-Z` upper class);
`Q`×20 → 211.68 vs 217.80 (1.03×); CJK → 95.48 vs 154.98 (1.62×, mono).
Current impact is **zero** — 2,234 real leadgen option strings under-state 0 times — so the invariant is
sound today. The finding is that the comment states an absolute the model does not hold, and the
under-statement direction is exactly the one that produced the green-over-a-clipped-control failure F13 is
fixing. State the character-class limit next to the platform-metrics limit, or widen the classes.

### MINOR-2 — at 375 the reveal's only affordance is unreachable on the surface F13 uses as its headline evidence
`d4-offers-hammered-375.png`. `/admin/leadgen/offers` and `/offers/new` at 375 paint **seven filter selects
at 40px content width — a chevron and no characters at all**. The reveal correctly sets a `title` on all
seven (that is exactly F13's "13 consecutive readings on `/admin/leadgen/offers` at 375" proof), but a
`title` is a pointer-hover affordance; on a 375 viewport the operator gets nothing. Not a regression —
before F13 these selects clipped with no title at all — and outside every clause, so this is a
surface-for-owner item rather than a change request against F13. It is worth saying plainly because the
phase's own idempotency evidence is drawn from a control whose pixels show no readable text.

### MINOR-3 — `/admin/leadgen/themes` clips 24px of its own chrome at 375, with no way to scroll to it
`d2-mgr-mono-375.png`, `d10-mgr-375-fullpage.png`, `d10` probe. `.tm-shell` computes
`overflow-x: hidden` with `scrollWidth 365 / clientWidth 341`; `documentElement.scrollWidth == 375`, so there
is no page scrollbar either. The **"+ New theme"** button's right edge lands at 381.6px against a 375px
viewport and is visibly cut in the pixels. Pre-existing — F13 changed no layout on this page (the added
caption is a block under the select and measures 0 overflow) — and not one of the four items the dispatch
lists as already surfaced, so it needs a register row rather than silence.

### MINOR-4 — the two font surfaces now say the same words in two different registers
`quotes-tabs/themes.ts:165-167` keeps `"Literata (shows as default font)"` inline on the option text;
`ui-theme-manager.ts:816` uses the capitalised standalone `"Shows as default font"` as an `<optgroup>`
label plus a caption. N20's clause is about the offered SETS, and those do align (both surfaces offer the
same 8 self-hosted families; each keeps its own historical legacy trio, hidden unless stored), so this is
presentation drift rather than a vocabulary drift. It is listed because F3's own comment says "ONE FONT
VOCABULARY, FINISHED … do not let them drift apart again", and an operator moving between the rail and the
manager now meets two shapes of the same sentence.

### Noted, not findings
* The `<optgroup>` heading is DOM-verified (`label="Shows as default font"`, the stored legacy option
  visible inside it, the other two `hidden`); Chromium's native select popup cannot be screenshot by
  Playwright, so the pixel half of that specific affordance is unverifiable by any driver. The caption —
  which is what F13 relies on for the operator who never opens the dropdown — IS pixel-proven at both widths.
* A revealed select inside a hidden tab panel has its title stripped by the next sweep and restored when the
  panel returns (driven: `d8-transitions.json` tab round trip). A show/hide done purely by attribute would
  not re-sweep, since the observer takes `childList`+`characterData` only; no driven flow reaches that state.
* `cloneNode(true)` of prototype selects (`ui-section-studio.ts:9762/9766/10784/10934`,
  `ui-payload-builder.ts:3140`) can copy `data-lg-clipped`/`title`/inline ellipsis onto a clone; the
  insertion is itself a `childList`-with-SELECT record, so the coalesced sweep corrects it. 0
  clipped-without-title measured on those routes.

### Known items confirmed unchanged (not re-filed)
ADJ-P8-27 (`themes-handlers.ts` byte-unchanged since 543a392; the orphan
`thm_rv3c-…-8f21` still in local KV), ADJ-P8-28 (present in the register at line 118;
`document.fonts.size === 0` on the admin), `/admin/articles` selects clipping at 375 (7 measured, outside leadgen).

---

## Security / silent-failure pass (diff-scoped)

No `innerHTML`/`outerHTML`/`document.write`/`eval`/`new Function`/`process.env`/SQL literal anywhere in the
F13 `api/src` diff. Operator data reaches the DOM only through `setAttribute('title', …)` and
`style.textOverflow` — attribute APIs, never markup. Every new interpolation is `escapeHtml`'d and its input
is a fixed constant or a member of the closed `THEME_RECORD_FONT_NAMES` set. No new route, no authz change,
no new query. Regexes added are linear (no nested quantifiers). Deferral scan over added lines
(`TODO|FIXME|HACK|XXX`, "polish later", "for now", "defer to v2/later/a follow-up", "simplified for now/v1",
"will be done/added later"): **0 hits**. Reduced-model hunt: **one found — MAJOR-1** (the reveal models
`title` as a slot it owns, which is a reduced model of a `title` the product may already be using); no dead
controls, locked options, placeholder content, or seed-only paths in the F13 diff.

## Every-consumer proofs

`leadgenPageShell` / `leadgenStandalonePageShell` signatures unchanged; all 6 src callers
(`ui-sections`, `ui-offers`, `ui-theme-manager`, `ui-quotes`, `ui-auctions`, plus `ui.ts` itself) driven live
at both widths with exactly one reveal copy each. `renderThemesTabPanel` lost its own include — all 7 test
consumers pass, and the panel's LAST `<script>` is the tab island again (`refreshPresetAvailability`), which
is what the vm harnesses slice. `ROLE_META`/`EXTRA_ROLE_META` widened in lockstep across `shared.ts` and
`ui-theme-manager.ts`; all 13 consumers enumerated, the 4 that pin the words carry the FULL new literal.
`ADMIN_SCRIPTS` untouched — the conversions half is byte-identical and its pin passes unedited.
