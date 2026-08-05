# P8-4 adversarial review — FIX-FIRST

Branch `leadgen-r2-p8-4`, gate sha **f230f0b** (HEAD `c01a24a4` = gate-log commit only, verified
`git diff f230f0b c01a24a4` touches nothing but the two log files).
Reviewer drove the running instance on :8901 as a client. Evidence dir:
`docs/leadgen/r2/evidence/p8/review-p8-4/`.
Everything authored during this review was restored — verified byte-identical render at the end
(`funnel A frame_config = {}`, `frame_template_id = 5`, Charlie's `theme_json` restored, Echo's 7
board slots restored, `site_logo_url` back to `""`, the uploaded probe image deleted → `/media/... 404`).

## Per-clause verdict table

| Owner clause / register row | Drive evidence | Verdict |
|---|---|---|
| **M3 / R2-1** *"how do I define it????"* + M3 "applying a saved template changes what the page paints" | `c-visitor-before-1280.png` → `c-visitor-after-fullbg-1280.png` → `c-visitor-after-minimal-1280.png` (+ `-375`) | **DEVIATES** — the paint half is real (numbered+bare+white → dots+card+brand-blue → bar+bare+no footer), but the confirm dialog's customisation sentence is FALSE after the first apply (F-1), and the A/B leg of the same clause is now permanently dead on any applied funnel (F-2). |
| **M3** confirm dialog "every promise true" | `c-apply-confirm-fullbg-1280.png`, `c-apply-confirm-minimal-1280.png` (+`-375`) | **DEVIATES** — 4 enumerated sentences true; the 5th ("9 settings you had customised are replaced by this template.") false. |
| **M3** re-apply is a no-op | `c-apply-confirm-reapply-1280.png` | **PERFECT** — "This template matches what the funnel already shows — nothing on the page changes."; stored leaves 59 → 59, page unchanged. |
| **M3** A/B templates arms actually differ | `f2-ab-dialog-1280.png` (applied funnel), `f3-ab-dialog-echo-1280.png` (never-applied funnel) | **DEVIATES** — on the applied funnel all five other templates report "Nothing this template sets would change on the new arm". |
| **M1 / R7** *"Add a 'I' 'funnel layout element' - progress bar … design them with a dedicated box!"* — custom icon via the existing media picker | `d1-media-picker-open-1280.png`, `d2-marker-image-chosen-1280.png`, `d-visitor-icon-custom-zoom.png`, `d-visitor-icon-custom-1280/375.png` | **PERFECT** (paint) — the operator's own image rides the fill edge on the real visitor page; `/media/... 200`. |
| **M1** custom icon degrades safely | `d-visitor-icon-cleared-zoom.png` (dot, no url) vs `d3-marker-missing-image-zoom.png` (empty white disc) | **DEVIATES** — "no image chosen" degrades to the dot correctly; an image the library no longer serves paints a blank marker (F-6). |
| **M1** Marker icon offered only where it works; `show_label` removed for `numbered` | `b4-progress-numbered-1280.png`, `b5-progress-custom-icon-row-1280/375.png` | **PERFECT** — measured row visibility across 5 styles: icon row only `icon_on_track`; media row only `icon=custom`; Show-label hidden + explanatory note only on `numbered`. |
| **M1** alignment moves the unit (conductor ruling R3) | `h-progress-align-left/center/right-1280.png` | **PERFECT** — track x = 8 / 340 / 672 at 1280. |
| **M1** one step-label wording | `e-label-after-advance-1280.png` (+`-375`) | **PERFECT** — SSR "Step 1 of 6" → after advancing the visible `[data-lg-continue]` "Step 2 of 6"; `aria-valuetext` identical. |
| **M10** saved templates get a real thumbnail, mounted with `createElement` | `b6-saved-template-chips-1280.png`, `b7-saved-template-chips-zoom6x.png` | **DEVIATES (minor)** — real per-record band pictures, no `innerHTML`; but "White + trust bar" paints a trust band its own config disables (F-5). |
| **M10** board Template chip resolves the saved template's NAME | `a1-board-template-chips-1280.png`, `a3-chips-failed-catalog-1280.png` | **PERFECT** — chips read "White + trust bar" / "Centered card" / "Full background"; ONE catalog GET for the board (5 chips); on an aborted catalog fetch all chips keep the neutral "Template", never a db id. |
| **M9** items 1/2/5 — no copy naming deleted things | `f1-activation-fixlinks-1280.png`, `b2-logo-align-right-1280.png`, `b5-progress-custom-icon-row-1280.png` | **DEVIATES** — item 1 gone from the driven Logo box; item 2 driven live ("Edit Section" on 6 publish-blocker rows, both the SSR and island halves); item 5's sibling driven (the canvas toolbar now reads "Themes tab →"), the empty-catalog option string itself is state-gated and verified by source + p3a fixture only. BUT the sentence beside each new "Edit Section" link still reads "Slide 1 …" (F-3, register row ADJ-P8-16, phase P8-4). |
| **N6** *"add button of 'add funnel', user should be able to add as many funnel he wants"* | `a2-board-two-new-funnels-1280/375.png` | **DEVIATES (minor)** — consecutive adds give "New funnel 6"/"New funnel 7", but delete-then-add produces a second "New funnel 7" (F-4). |
| **N9** *"'The funnel layout elements (A)' should be aligned to the left…"* letters | `b1-templates-letters-1280.png` | **PERFECT** — A B C D E F G, then the owner-pinned I and J; the single unavoidable vacancy is H, after the contiguous run. |
| **N12** logo alignment offers Right and paints it | `e-logo-left/center/right-1280.png` (+`-375`) | **PERFECT** — on a site WITH a logo the mark sits at x 340 / 624 / 908; `justify-content` flex-start / center / flex-end. |
| **N17** free text vs company details | `b3-footer-box-1280.png` | **PERFECT** — one option, "Company details"; the help line names both words; the block really carries the Bold/Italic/Link toolbar the help promises. |
| **B3 regression** (P8-1) theme edit from funnel C's chip | `g4-b3-charlie-theme-1280/375.png` | **PERFECT** — header "P8-Charlie", the only write is `PUT /funnels/lgf_…G30E/theme`, and storage diff shows C changed / A, Bravo, Delta, Echo unchanged. |
| **B5 regression** (P8-2) side-by-side + drag | `g1-b5-board-geometry-1280.png`, `g2-b5-drag-midflight-1280.png`, `g3-b5-after-drop-1280.png` | **PERFECT** — 2 of 5 columns fully visible at 1280 with both rails (216/276px), 0 document overflow, shared column static at x 491; a real pointer drag auto-scrolled 0 → 880 and landed in the FURTHEST funnel (`PUT /variants/lgn_01KZ3ANG2WTWSKRXAV7BZPBFF6` 200, chip present in storage; removed again via the product's own kebab). |

## Gate-log audit (recomputed, not re-run)

`docs/leadgen/r2/gate-logs/p8-phase-4-run2.log`
* stamped `HEAD: f230f0b327ecafeeb3ed14582ffe0bbc95f2aaa7` == the gate sha; `[status-empty=yes]`.
* `TYPECHECK_EXIT=0`, `VITEST_EXIT=0`, `VERIFY_ALL_EXIT=0`, `RUNTIME_EXIT=0`, `REGISTER_EXIT=0` — all present.
* Recomputed from the raw text: `Test Files 490 passed | 2 skipped (492)`, `Tests 8222 passed | 30 skipped (8252)`; 8222+30 = 8252 ✓, no `failed` token anywhere in the summary.
* bundle `52930 bytes, 99.4% of budget` (cap 53,248) ✓ · jargon `TOTAL: 0` ✓ · golden `UNCLASSIFIED 0`, stale 0 ✓.
* register: log says 75 rows / 0 violations; I recomputed the register's data rows independently → **75** ✓.
* zero-drift: 0 removed; 1 changed pre-existing (`leadgen-r2-dead-controls-guard.test.ts` 26→58, from P8-3);
  new test files — I counted `git diff --name-status f240788 f230f0b -- api/test | grep ^A | *.test.ts` → **21**, 0 deleted ✓; arithmetic 7724+528 = 8252 ✓ (the 7724 baseline is the conductor's own recorded number and is not independently recomputable without a run).
* `api/src/admin/templates/**` byte-unchanged since the mission baseline; `api/test/conversions-admin-shell.test.ts` unedited and green in the main run (log line 2167, 11 tests).
* Nothing deployed, no `wrangler deploy|secret`, no `--remote` in the diff; `api/.dev.vars` gitignored with both `GOOGLE_MAPS_*` values length 0 (correct — untouched).

## p3a recapture audit

144 new visible strings extracted from the fixture diff; 132 found verbatim in `api/src`. The 12 that
are not are all data/derived — the capture run's own quote id, fixture funnel/site names, HTML-escaped
apostrophes, and the six `Used by: …` lines that the renderer composes by concatenation. No sign of a
hand-edited fixture.

## Test-pin audit (7 re-mints, P8-4 commits only)

| Pin | Old | New | Weaker? |
|---|---|---|---|
| `leadgen-element-j-r2` letters | exact ordered `toEqual` incl. `H:Images` | same `toEqual` with `G:Images` **plus** a new `not.toContain("H")` and two new heading assertions | No — stricter |
| `leadgen-element-j-r2` footer label | `toContain("About paragraph / company details")` | `toContain('<option value="about_paragraph">Company details</option>')` + `not.toContain(old)` + enum-value assertion | No — stricter |
| `leadgen-element-j-r2` publish badge ×2 | `"Review slide"` | `"Edit Section"` + `not.toContain(">Review slide<")` | No |
| `leadgen-quote-builder-seam` fix link | `toBe("Review slide")` | `toBe("Edit Section")` | No |
| `leadgen-quote-builder-ui` SSR link | `">Review slide</a>"` | `">Edit Section</a>"` | No |
| `leadgen-frame-engine-sim` / `leadgen-runtime-hydration` ×3 | `"2 / 3"`, `"2 / 4"`, `"3 / 5"` | `"Step 2 of 3"`, `"Step 2 of 4"`, `"Step 3 of 5"` | No — pins the unified wording I drove live |
| `leadgen-rework-templates-ui` letters | `["H","Images"]` | `["G","Images"]`, same loop | No |
| `leadgen-r2-dead-controls-guard` | `ENUMERATED_TOTAL 129` | `130` + a new probe-context entry | Count stricter; see F-7 for what the new key's probe actually proves |

No assertion was deleted in P8-4's commits.

## FINDINGS (all listed, then ranked)

### MAJOR

**F-1 — M3: the confirm dialog's customisation sentence is FALSE on every apply after the first, and
it is false *because* of the materialise fix.**
Register row M3 ("confirm dialog's enumerated promises true or removed"); owner anchor *"I should be
able to create as many templates I want, to save them, and to use them as presets in different
'Quotes'"*.
Repro from a **pristine** funnel A (`frame_config = {}`, zero operator edits, ever):
```
POST /funnels/<A>/apply-template {template_id:4}            -> replaced_customisations: []
POST /funnels/<A>/apply-template {template_id:6,dry_run:1}  -> replaced_customisations:
   ['template','header.sticky','progress.style','progress.position','back.position',
    'footer.enabled','background.role','background.style','section_slot.card']
   confirmations: … "9 settings you had customised are replaced by this template."
```
The operator customised nothing; all nine leaves were written by apply #1's own materialisation.
Cause: `computeTemplateApply` (`api/src/public/leadgen/designs/frames.ts:2330` (`replaced.push`) and `:2361-2365` (the sentence)) derives
`replaced` from `storedLeaves.has(path)`, and `applyFrameTemplateToFunnelHandler`
(`api/src/admin/leadgen/frame-handlers.ts:702-712`) now writes every template leaf into
`frame_config_json` — so from the second apply on, `replaced.length === changes.length` always, and
the one sentence that exists to warn about real destruction cries wolf permanently. The phase's own
test (`api/test/leadgen-p8-m3-apply-template.test.ts:494-497`) only covers the FIRST apply and asserts
the sentence against its own `replaced.length`, so it is structurally unable to fail on this.
Screenshot: `c-apply-confirm-minimal-1280.png` (the sentence, on screen).

**F-2 — M3: A/B templates still cannot produce two different arms on any funnel that has had a
template applied — and this phase's fix is what guarantees it.**
Register row M3 ("A/B templates arms actually differ"); contract R2-1/§6 M3 *"fix A/B templates so the
arms differ"*.
Driven on funnel A after one apply: every one of the five non-current templates reports *"Nothing this
template sets would change on the new arm — this funnel's own saved layout settings already decide
those."*, the sixth *"both arms would look the same"* (`f2-ab-dialog-1280.png`). On never-applied
`P8-Echo-themeless` the same dialog reports 3–5 changed settings (`f3-ab-dialog-echo-1280.png`), so
the capability exists only until the operator uses "Apply to funnel…". Materialisation writes 59
leaves into `frame_config_json`, which is the layer that shadows a variant's `frame_template_id`
base — so applying a template permanently disables A/B-templating that funnel. The code comment at
`api/src/admin/leadgen/quotes-tabs/templates.ts:2611-2626` says the shadowing "is reported, not patched
here", but **it is reported nowhere**: no ADJ row, no tracker line, and register M3's requirement text
still demands differing arms. Honest copy in place of a working feature is not the clause.

**F-3 — M9/ADJ-P8-16: the product still says "slides" on the very rows this phase re-labelled.**
Register row ADJ-P8-16 (Phase **P8-4**, status DEVIATES, text: *"recorded here as the full inventory so
P8-4 fixes the class rather than the cited lines"*); owner anchor *"I clearly defined the difference
between pages and sections"*.
Driven on the Activation tab (`f1-activation-fixlinks-1280.png`): six rows read
**"Slide 1 shows no question headline. [Edit Section]"** — this phase renamed the button and left the
sentence beside it naming a concept the product does not have. Live sites still carrying the word:
`quotes-handlers.ts:6487, :6504, :6516, :6525, :6537, :6557, :6569`,
`quotes-tabs/templates.ts:826` ("Progress counts the **slides** of this funnel variant automatically."
— rendered inside the Progress box this phase rewrote), `quotes-tabs/templates.ts:984` and
`quotes-tabs/themes.ts:301` ("affects every **slide** of this funnel" — the Templates/Themes scope
heads), `quotes-tabs/shared.ts:1185`. Not fixed and not re-ruled: the row is still `DEVIATES`, not
`BLOCKED(owner …)`, so it is a silent omission against contract §10.1 ("No silent omissions").

### MINOR

**F-4 — N6: delete one funnel, add one funnel, and two columns share a name.**
`addFunnel` uses `var ordinal = (BOARD.funnels || []).length + 1`
(`api/src/admin/leadgen/quotes-tabs/funnel.ts:5080` (`var ordinal = (BOARD.funnels || []).length + 1`)). Driven: added two funnels ("New funnel 6",
"New funnel 7"), deleted "New funnel 6", clicked **+ Add funnel** → the board rendered **two columns
both named "New funnel 7"**. The register's requirement is "distinguishable default names"; a
one-step-reachable flow defeats it. (A max-suffix or a timestamp/ordinal from the quote's own counter
would close it.) Evidence: `a2-board-two-new-funnels-1280.png` + the driven name list in this review's log.

**F-5 — M10: a saved template's thumbnail paints a trust strip the template has switched off.**
`frameThumbnailData` (`api/src/admin/leadgen/frame-handlers.ts:357`) triggers the trust band on
`d.trust_strip.enabled || d.trust_strip.placement === "footer" || arrangement.includes("trust strip")`.
For a SAVED row `arrangement` is always `""`, so `placement` alone can fire it. Measured on record 5
"White + trust bar": `trust_strip.enabled = false`, `placement = "footer"`, and its `thumbnail.bands`
contain `lg-tpl-band lg-tpl-trust`; the funnel that uses that template renders no trust region at all
(`frame.ts:586 `if (!t.enabled) return ""``). The picture lies about the arrangement — the same defect
class this phase's own `shared.ts` comment cites when it adds `.lg-tpl-logo--right`.
Evidence: `b7-saved-template-chips-zoom6x.png` + the API dump in this review's log.

**F-6 — M1: a custom marker whose image the library no longer serves paints an empty white disc, not
the dot fallback.** `renderProgressRegion` (`api/src/public/leadgen/designs/frame.ts:527-534`) falls
back to `--icon-dot` only when `mediaUrl()` is null or the URL fails `CSS_URL_SAFE_RE`. A well-formed
URL to a missing blob still emits `--lg-progress-icon-url`, and the `::before` (transparent background
+ broken image) leaves a blank hole inside the white `::after` disc. Driven with
`icon_media_id = "seed/local/card-a.webp"` (a real media row whose blob 404s): `/media/... 404` and the
mark is an empty white circle — `d3-marker-missing-image-zoom.png`. frame.ts's own comment promises
"falling back to the plain `dot` thumb whenever no usable image is authored". Same behaviour as
`site_logo` (pre-existing), but newly reachable through the control this phase added, and an operator
deleting a media item silently blanks a live funnel's marker.

**F-7 — the guard extension for `progress.icon_media_id` cannot fail if the paint is deleted.**
`visibleFingerprint` includes the element's class list
(`api/test/helpers/leadgen-visible-paint.ts:571`), and the probe's own reason text concedes the
mark itself is "outside this predicate's frame by declaration". So the new key passes on the
`--icon-dot` → `--icon-custom` class flip alone: removing the two `default-funnel/styles.ts` rules that
conductor ruling R2 made mandatory would leave `ENUMERATED_TOTAL 130` green. The live proof of the
paint is this review's drive, not the guard.

**F-8 — the apply dialog announces 4 of 9 changes by name and the rest only through the (false) count.**
In the driven apply of "Minimal", the served page also lost `header.sticky`, moved `back.position`
`in_card → under_header_left`, moved `progress.position` and changed `background.role` — none named.
`APPLY_REGION_WORDS` + the two special-cases in `frames.ts:2288 APPLY_REGION_WORDS` + `:2341-2360` cover only card, progress style,
five enabled flags and background style. Truth, not completeness, is the clause — but the line that is
supposed to cover the remainder is F-1's false one.

**F-9 — `openApplyConfirm` has no rejection handler.** `api/src/admin/leadgen/quotes-tabs/templates.ts:2466-2481`
chains `.then(...)` with no `.catch`; `fetchJson` (`:1298`) only swallows a JSON parse failure. A fetch
rejection (network drop) makes clicking a template card do nothing at all — no confirm state, no
message. HTTP errors are handled correctly (the error `<p>` is a sibling of both state panels and is
visible in the choose state).

**F-10 — P8-4 shipped no evidence artifacts.** Contract §2 requires artifacts under
`docs/leadgen/r2/evidence/p8/<id>/` and §10.4 requires screenshots at 1280+375 for anything visual; the
phase's three commits add none, and the register cells for M1/M3/M9/M10/N6/N9/N12/N17 are still `—`.
This review supplies the pixels; the conductor should cite them.

### Observations (not findings)

* Two catalog GETs per editor load (`funnel.ts` board island + `templates.ts` tab island), not one per
  chip — the dispatch's criterion is met; the duplicate is the two islands' own reads.
* `numbered` can now never hide its step label (the control is gone). Consistent with conductor ruling
  R1 and §4 R3's corollary; recorded because it is a capability an operator loses.
* "Silence never erases": a template that is blank at a leaf leaves the previous template's value in
  place after materialisation, so template B can inherit template A's authored copy. Deliberate and
  documented; it protects operator content, but it means an applied template is not a clean slate.
* At its rendered 24×18px the saved-template thumbnail's bands are ~2px; the arrangements are only
  clearly distinguishable when magnified (`b7-…-zoom6x.png`).
* ADJ-P8-27…31 confirmed unchanged at HEAD; not re-filed.

## Verdict

**FIX-FIRST** — F-1, F-2 and F-3 are MAJOR and all three sit inside clauses this phase owns.
