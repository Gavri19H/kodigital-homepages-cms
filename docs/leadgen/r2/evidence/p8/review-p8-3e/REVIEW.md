# P8-3 fix round F14 — fresh-context adversarial review (review #5, "3e")

Branch `leadgen-r2-p8-3`. Gate sha `e17f49e`; HEAD `d293ff3` (gate-log-only commit — `git show --stat d293ff3`
= 1 file, `docs/leadgen/r2/gate-logs/p8-phase-3-run9.log`). Tree porcelain-clean apart from this evidence
directory. Server: the already-running `wrangler dev` on `127.0.0.1:8901` (client only — never started,
stopped or bound). Nothing deployed, no secret read or written, no `--remote` D1; `api/.dev.vars`'s two
`GOOGLE_MAPS_*` slots measured EMPTY (value length 0 on both lines).

**VERDICT: SHIP — 0 BLOCKER, 0 MAJOR, 4 MINOR.** Every F14 claim in the dispatch verifies on the driven
product, and the one claim I could break (byte-identity) breaks only in the exact place the source comment
already discloses, with zero declaration loss.

---

## What I authored (restored)

One REAL payload-schema version through the real route `POST /api/admin/leadgen/offers/1/payload-schemas`
(v2, `lgp_01KZ5HJ5FPPJG5CGQ0SMPDHN4M`), giving the offer's single answer field the unique label
**"Rv3e probe primary insured mailing street address line two"** — so the mapping drawer's `pathSel`
genuinely clips on operator data at BOTH widths (394px box at 1280, 178px at 375) instead of being forced.
Every matched row below provably belongs to this session (`Rv3e`).
**Restored**: v3 posted with the original schema bytes; `answer_fields` compared field-by-field to the
pre-capture — **identical** (`label: null`, `field_label: "R2fix carrier"`).
**Declared residue**: the API exposes no payload-schema DELETE, so the offer's active version now reads
**v3** (two extra rows in local dev D1). Operator-visible projection is byte-identical to the pre-state.
No theme, section, quote or funnel was created or changed. ADJ-P8-27's orphan
(`thm_rv3c-…-8f21`) untouched, theme list still 3.

---

## 1. Gate-log audit (run 9 — read, not re-run)

`docs/leadgen/r2/gate-logs/p8-phase-3-run9.log`, recomputed from the raw text by my own parser:

| Check | Log | Recomputed by hand | Match |
|---|---|---|---|
| stamped sha | `HEAD: e17f49eba06f…` (L3) | == the recapture commit; HEAD is one docs-only commit ahead | yes |
| clean tree | `[status-empty=yes]` (L4) | consistent — d293ff3 adds only the log | yes |
| typecheck | `TYPECHECK_EXIT=0` (L10) | present | yes |
| unit suite | L2726-2727 `485 passed \| 2 skipped (487)` / `8156 passed \| 30 skipped (8186)` | parsed all 487 per-file lines: **487 files, 8186 tests, 30 skipped, 8156 passed**, marks {✓:485, ↓:2}; `VITEST_EXIT=0` (L2732); zero `failed` in any summary | yes |
| the 30 skips | L2723-2724 + L2780-2798 | all `conversions-*` (env-gated); zero leadgen skips | yes |
| verify:all | `VERIFY_ALL_EXIT=0` (L2892) | present, 8 sub-verifiers all OK | yes |
| jargon | `TOTAL: 0 hit(s) across 5 categories` (L2833) | 0 | yes |
| bundle | `size: OK (52938 bytes, 99.4%)` (L2810/2899) | `src/public/leadgen/runtime/engine-bundle.generated.ts:11` declares `LEADGEN_RUNTIME_JS_BYTES = 52938`; 52938/53248 = 99.42% | yes |
| register | `rows checked: 73 … TOTAL violations: 0` (L2905-2911), `REGISTER_EXIT=0` | present | yes |
| zero-drift | `removed 0 \| changed 1 {dead-controls-guard: (26,58)} \| new 16 (+462)`; `7724 + 462 = 8186` | `git diff --name-status f240788..HEAD -- api/test` → **16 added `.test.ts`**, 0 deleted, 31 modified; those 16 files sum to **exactly 462** tests in the log; dead-controls-guard reads 58 | yes |

Zero-drift arithmetic, stated precisely because the label is terser than the number: `7724` is **not** the
f240788 baseline total, it is baseline **plus the intended +32** from the one changed pre-existing file.
The implied true baseline is 7692, and run 3 of this same phase (`7713 + 309 = 8022`, same file at 26→47)
implies the same 7692 independently. The arithmetic closes; only the label is ambiguous.

Re-ran ONLY the diff-touched file plus the two pins it could break —
`leadgen-p8-n-theme-ui`, `leadgen-p3a-split-parity`, `conversions-admin-shell`: **3 files / 133 passed**.
`api/src/admin/templates/` is byte-unchanged since the phase base f240788 (empty diff) and
`test/conversions-admin-shell.test.ts` is UNEDITED over the same range.

**p3a recapture #8 is honest.** Normalising ULIDs, the recapture's true delta across the 8 fixtures is
**101 added / 21 removed** lines; every one of them is a line of the emitted island body that exists
verbatim in `api/src/admin/leadgen/clip-reveal.ts`, plus one `lg-quote-data` JSON line whose only
difference is the `computed_at` epoch-millis. `data-lg-title-own` never appears as MARKUP in any fixture
(4 hits per file, all inside the script text) — the stash cannot leak into a server-rendered artifact.

**No test weakened across F1–F14**: zero `.skip/.only/.todo/xit/xdescribe` added anywhere in
`git diff f240788..HEAD -- api/test`; F14 removes zero `it(` legs and zero `expect(` lines; the node lane
went 102 (run 8) → **110** (run 9) = the 8 new legs.

**"Re-injecting the old body fails exactly the 6 new destruction legs"** — audited by reading, not re-run
(re-running would require editing source). All six fail under the old body by construction:
`:2173` composed title, `:2178`/`:2245` `data-lg-title-own`, `:2204` destroyed==0, `:2225`/`:2239`
snapshot-back-to-rendered (the old body left `style: ""`), `:2279-2284` the real-route leg. None is a
tautology and the last one takes its author title from the REAL served route (E11 satisfied).

---

## 2. The drive — F14's six attack surfaces

Real Chrome (chromium), admin on `127.0.0.1:8901`, screenshots at 1280 and 375 in this directory.

### A. Byte-identity of restoration — **HOLDS on both classes; one disclosed exception found**
`e1-mapgrid.json`, `e2-attacks.json`, `e5-rail2.json`.
* **Author-titled real select**, real long operator label, at **1280 and 375**: pre-reveal capture taken
  synchronously inside the same task as the "Map fields" click, so it precedes the first sweep.
  `pathIdentical: true` at both widths — `<select class="form-input" data-map-path="lead.r2fix_carrier"
  aria-label="Offer payload field" title="lead.r2fix_carrier">…` byte-for-byte after withdrawal. No
  `style=""`, no leftover `data-lg-clipped`, no leftover `data-lg-title-own`.
* **Un-titled real select** in the same row (`[data-map-question]`): `questionIdentical: true` at both widths.
* **Exception (MINOR-3)**: a real select that already carries a product-authored inline `style` comes back
  re-serialised — see findings.

### B. The composition — **CORRECT at both widths**
Clipped state, driven, identical at 1280 and 375:
`title = "lead.r2fix_carrier\nRv3e probe primary insured mailing street address line two — text (required)"`,
`data-lg-title-own = "lead.r2fix_carrier"`, `style="text-overflow: ellipsis;"`.
Author sentence first and verbatim; the clipped text added, never substituted. Survives
clip → unclip → clip (`reclipped` == `clipped` at both widths) and a REAL mouse hover.
Pixels: `e2-clipped-zoom-1280.png` shows `Rv3e probe primary insured mailing street address line two — tex…`
and `e2-clipped-zoom-375.png` shows `Rv3e probe primary insu…` — genuinely ellipsised boxes, so the tooltip
is the only place the full text and the raw path exist.
*Stated limit of this evidence*: a native `title` tooltip is an OS-drawn window that no page screenshot can
capture; the two-line rendering of `\n` is asserted from the exact attribute value, not from pixels.
Duplicate suppression when author == text: written **once** (`dupWritten: true`), stash still set, restore
byte-identical — at both widths.

### C. The stash as product state — **no strand, no wrong restore, one latent hole**
* **Re-render while a stash is live** (the REAL path: Close → re-open the map grid): grid cleared to 0 rows,
  the fresh element arrives with `title="lead.r2fix_carrier"`, `own=null`, `clipped=null`, then re-composes.
  No orphan, no stale stash. Both widths.
* **Hide/show while a stash is live** (`display:none` → sweep → restore): withdrawal restores the author
  title and drops the stash; re-showing re-composes. No strand.
* **Option text changes while clipped**: at 375 the stash is preserved and the composition updates to the new
  text; at 1280 the new text fits the 394px box, so the reveal correctly WITHDRAWS and restores
  `title="lead.r2fix_carrier"`. Both correct.
* **Two reveals racing**: one script tag per page (install guard), and 4 re-entrant sweeps fired from inside
  the handler path converge to one state (below).
* **`data-lg-title-own` already present** and **`title=""`**: the two holes in findings MINOR-1/MINOR-2.

### D. Idempotence on the author-titled control — **HOLDS**
`e1-mapgrid.json.idem`, at 1280 AND 375: load + 6 sweeps + 6 synthetic `focusin`/`mouseover` + 4 re-entrant
sweeps = **17 readings → 1 distinct state**; **30 consecutive `requestAnimationFrame` samples re-sweeping
every frame → 1 distinct state**; **0 readings with the stash lost**; plus a real `page.hover()` that leaves
the same state. The forced-clip read never reaches a painted frame.

### E. N7 — **NOT regressed on either theme surface**
`e3-coverage-n7.json`, `e5-rail2.json`, `e3-manager-{1280,375}.png`, `e5-rail-themes-{1280,375}.png`.
* **Manager** (`/admin/leadgen/themes`), both widths: 2 selects, 22 options, **over = 0**,
  `tm-headline-font`/`tm-body-font` 282/282, `clippedNoTitle = 0`.
* **Rail** (Themes tab inside the quote editor), both widths: 21 visible selects, 115 options,
  **exactly 2 overflows**, the same two F14 reports, both DATA-BEARING:
  `lg-theme-site-select` "Seed Local Living — Not activated yet" (+31 at 1280 / +14 at 375) and
  `lg-theme-target-select` "R2C3 Bravo Extremely Long Funnel Column Name For The Truncation Audit Delta Echo"
  (+281 at both). Selecting each one through a real `change`: the reveal titles it with the **full option
  text** (`titleIsFullOption: true`, 4/4), `clippedNoTitle = 0`.

### F. Nothing else moved — **HOLDS**
* Exactly **1** `<script>` carrying `function lgRevealClippedSelects` on every leadgen route driven
  (offers, offers/new, offers/:id/edit, sections, sections/new, sections/:id/edit, themes, themes?embed=1,
  quotes, quotes/new, quotes/:id/edit, auction), at 1280 and 375.
* `/admin`, `/admin/pages`, `/admin/articles`: **0 copies**, `window.lgRevealClippedSelects === undefined`,
  at both widths.
* `api/src/admin/templates/` byte-unchanged; `conversions-admin-shell.test.ts` unedited and passing;
  runtime bundle 52,938.
* **Visitor** (`http://r2fix.e2e.test:8901/lg/r2fix`, real Chrome UA, host-resolver mapping), 1280 and 375:
  HTTP 200, island **absent** (0 occurrences, `undefined`), 0 pageerrors, 0 console errors,
  `documentElement.scrollWidth == innerWidth` at every step, advances through the funnel via the visible
  `[data-lg-continue]`, and a required question that blocks Continue says so on screen
  ("This field is required.") — no silent block. `e8-visitor-step*-{1280,375}.png`; step 0 at 1280 is
  pixel-equivalent to review #4's `d7-visitor-step0-1280.png` apart from the progress colour (their sentinel
  theme vs the restored `#1D9BF0`).

---

## 3. Reduced-model hunt

Diff-scoped deferral scan over `git diff b647d43..e17f49e` added lines (excluding evidence):
`\b(TODO|FIXME|HACK|XXX)\b`, "polish later", "for now", `defer(red)? to (v2|later|a follow-up)`,
`simplified for (now|v1)`, `will be (done|added) later` — **0 hits**.
Marker-free: **none found**. No dead control, no locked option, no placeholder, no seeded-only path; the
change adds behaviour to an existing island and is reachable from the ordinary Mapping-drawer flow.

## 4. Every-consumer proofs

`LG_CLIP_REVEAL_SCRIPT` has exactly two src consumers (`ui.ts:207` `leadgenPageShell`, `ui.ts:232`
`leadgenStandalonePageShell`) — signatures unchanged, both driven live at both widths with one copy each.
Byte consumers: the 8 p3a fixtures (recaptured, parity test green) and 6 pins in
`leadgen-p8-n-theme-ui.test.ts` (green). `ADMIN_SCRIPTS` untouched; the conversions pin passes unedited.
No route, schema or DB interface changed.

## 5. Security pass

No new route, no authz surface, no secret, no query. The composition is built with string concatenation and
written through `setAttribute('title', …)` — an attribute sink, never an HTML sink; values originate from
`option.textContent` and an existing attribute, so no injection vector (XSS/SQL both N/A). No regex added →
no ReDoS. The stash stores text that is already on the element. Nothing is logged.

## 6. Silent failures

No try/catch, nothing swallowed. The withdrawal branch is entered only when `clipped` was computed through
the `sel.getAttribute` guard, so a host object without `getAttribute` short-circuits rather than throwing.
The one silence in the design is the stated limit (2) — a foreign re-title during a live reveal would be
restored over — and it is written down in the source rather than implied.

---

## Findings, ranked

### MINOR-1 — a pre-existing `data-lg-title-own` is adopted, then converted into a title the product never wrote
`api/src/admin/leadgen/clip-reveal.ts:209-213` (no `else` clearing a stale stash) and `:218-224`.
Owner clause: ADJ-P8-26's leadgen-wide coverage ruling, and the module's own rule "This script never destroys
or alters what the product itself put on an element" (`clip-reveal.ts:79-81`).
Evidence: `e2-attacks.json → attackPrestash`, both widths.
An element rendered as `<select … data-lg-title-own="STALE-OR-FOREIGN-VALUE">` with **no** `title` comes out
of one clip/unclip cycle as `<select … title="STALE-OR-FOREIGN-VALUE">` — the stash is read as if it were the
author's sentence (composed as `STALE…\n— not mapped —` while clipped), then written into `title` on
withdrawal and removed. `outerHTML` is not identical, and the element gains an attribute it never had.
**Not reachable in the product today** and that is measured, not assumed: `data-lg-title-own` appears
nowhere in `api/src` except `clip-reveal.ts`; the only author titles on a leadgen `<select>` are
`ui-section-studio.ts:15594` (set before insertion, on a freshly created element) and the SSR
`:2601`; neither element is ever `cloneNode`d (the 5 clone sites clone untitled rule/payload protos); no
product code reads `outerHTML`/`innerHTML` back into a save, and the attribute never appears as markup in the
p3a captures. Closing it is one line on the not-clipped branch
(`else { sel.removeAttribute('data-lg-title-own'); }`).

### MINOR-2 — an empty-string author title composes a leading blank line
`api/src/admin/leadgen/clip-reveal.ts:215` — the duplicate rule is `own === null || own === text`, so
`own === ""` falls through to `own + '\n' + text`.
Evidence: `e2-attacks.json → attackEmpty`, both widths: `title=""` → clipped
`title = "\n— not mapped —"`, i.e. the tooltip opens with an empty line. Restoration IS byte-identical
(`identical: true`), so this is presentation only.
Not reachable today: `f.path` is guaranteed non-empty by `schemaAnswerSourceFields`
(`sections-handlers.ts:2408` rejects `path === ""`), and the SSR title is a literal.

### MINOR-3 — "outerHTML identical" is true for the author-titled selects only; a real inline-styled select comes back re-serialised
`api/src/admin/leadgen/clip-reveal.ts:226-229`.
Evidence: `e5-rail2.json`, both widths — `#lg-theme-target-select`, a REAL rail control carrying a
product-authored `style="margin-left:8px;max-width:200px;vertical-align:middle"`, clips on REAL operator data
(the funnel name "R2C3 Bravo Extremely Long Funnel Column Name For The Truncation Audit Delta Echo", +281px)
and comes back as `style="margin-left: 8px; max-width: 200px; vertical-align: middle;"` —
`identical: false`. The delta is 5 spaces and one `;`; **all three declarations are preserved** and nothing is
lost. This is exactly limit (1) in `clip-reveal.ts:102-106`, so it is disclosed rather than hidden — but the
disclosure's phrasing ("neither author-titled select carries one") reads narrower than the class: 12+ real
leadgen selects carry inline styles (`tm-headline-font`, `tm-body-font`, `lg-section-activity`,
`lg-section-vertical`, `lg-preview-theme`, `lg-tpl-*`, `lg-theme-target-select`), and one of them provably
clips today. The round's headline claim should be scoped the same way the source comment is.

### MINOR-4 — the second author-titled select is asserted, not driven-visible
`api/src/admin/leadgen/ui-section-studio.ts:2601` (`#lg-content-type-swap`).
Evidence: `e4-rail-ssr.json → typeswap-*`, `e6-typeswap.json`, both widths: the element is served with its
author title on every studio page, but `vis:false`, `clientWidth 0` — its wrapper
`[data-content-typeswap-wrap]` is gated to a copy node, the library exposes no copy-node tile, and adding a
TextBlock then cycling all five inspector tabs never unhides it. F14's own evidence set contains no driven
capture of it either (`f14-*-major1.json` is the map-grid select only); its "reproduced at BOTH widths" line
comes from the F13 fail-before, produced by forcing a width on a hidden element. The code path is identical
and is fully driven on the real map-grid select, so this is a claim-scope finding, not a behaviour defect.

### Observations (no action requested)
* `/admin/leadgen/sections/:id/edit` at **375** is heavily overlapped: drawer chrome ("QA tools", "Preview",
  theme picker, "Manage", "Map fields") overprints the mapping summary and the mapping table's right column
  is cut off (`e2-clipped-select-375.png`, `e1-mapgrid-clipped-375.png`). Pre-existing, unrelated to F14,
  same family as the already-surfaced ADJ-P8-29.
* Gate-log legibility: the zero-drift line's left operand `7724` is baseline+32, not the baseline.
* ADJ-P8-27 / ADJ-P8-28 / ADJ-P8-29 confirmed unchanged: theme list still 3 with the orphan
  `thm_rv3c-…-8f21` present; `/admin/leadgen/themes` `document.fonts.size === 0`, `status "loaded"`,
  0 `@font-face` rules (`e9-fonts.json`); the reveal's affordance is still pointer-only.

---

## Per-clause verdict table

| Owner clause / anchor | Drive evidence | Verdict |
|---|---|---|
| N7 — "theme is only design language!!!! colors, fonts, sizes" → no select truncates its own value, manager surface | `e3-manager-1280.png`, `e3-manager-375.png` (`e3-coverage-n7.json`): 2 selects / 22 options, over=0, 282/282 — both font selects show their full name and note | **PERFECT** |
| N7, rail surface (theme picker inside the quote editor) | `e5-rail-themes-1280.png`, `e5-rail-themes-375.png` (`e5-rail2.json`): 21 selects / 115 options, exactly 2 overflows, both operator data, both titled with the FULL option text when selected | **PERFECT** |
| ADJ-P8-26 — leadgen-wide coverage without touching the shared shell | `e3-coverage-n7.json` + `e4-rail-ssr.json.copies`: 1 island script tag on each of 12 leadgen routes at both widths; 0 on `/admin`, `/admin/pages`, `/admin/articles` with `window.lgRevealClippedSelects === undefined` | **PERFECT** |
| The product's promise the reveal must not destroy — `ui-section-studio.ts:3263` "the raw path also rides each Field cell's tooltip" | `e2-clipped-zoom-1280.png` / `e2-clipped-zoom-375.png` show the box cutting the real label to `…— tex…` / `…insu…`; `e1-mapgrid.json` shows `title="lead.r2fix_carrier\nRv3e probe primary insured mailing street address line two — text (required)"` at both widths, surviving clip→unclip→clip | **PERFECT** |
| F14 claim: withdrawn element byte-identical to the pre-reveal capture | `e1-mapgrid.json.identity` — `pathIdentical: true`, `questionIdentical: true` at 1280 and 375; screenshot `e2-clipped-select-1280.png` | **PERFECT** for author-titled and untitled selects; **DEVIATES** (MINOR-3) for a real inline-styled select — CSSOM re-serialisation only, declarations preserved, disclosed in-source |
| F14 claim: 0/10 destroyed, idempotent | `e1-mapgrid.json.idem`: 17 readings → 1 state, 30 rAF → 1 state, 0 stash losses, at both widths, plus a real hover | **PERFECT** |
| F14 claim: nothing else moved (templates, conversions pin, bundle, visitor) | 3 files/133 tests green; `templates/` empty diff; `e8-visitor-step*-{1280,375}.png` — island absent, 0 errors, 0 overflow, required-field block surfaced | **PERFECT** |
| Stash cannot become product state | `e2-attacks.json` (re-render, hide/show, text-change) + greps (no `outerHTML` read, no clone of a titled select, never markup in the p3a captures) | **PERFECT** (two latent holes ranked MINOR-1/MINOR-2, neither reachable) |
