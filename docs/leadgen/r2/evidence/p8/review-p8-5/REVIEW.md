# P8-5 adversarial review — **FIX-FIRST**

Fresh-context Opus 5 reviewer, driving the already-running instance on :8901 as a client (started/stopped
nothing, never bound 8787). Authored probe Section `p8n_rev5 Canvas Parity Probe`
(`lgs_01KZ6TKD6AF69MA7X63D3GC1Z7`), drove every journey, then hard-deleted it and restored funnel A's
5 pages / `frame_config {}` / `frame_template_id null`, verified by re-read. **58 PNGs** at 1280 + 375 in
this directory. Transcribed here by the conductor — the reviewer's own instructions barred it from
authoring report files, so this verdict existed only in its return message.

## Gate-log audit
`gate-logs/p8-phase-5-run2.log` — sha `67f8798…` == the product-code sha (branch HEAD `473b9f7` adds only
this log, checked with `git show --stat`), `[status-empty=yes]`, and every recomputed count closes:
`8304 + 30 = 8334`, `497 + 2 = 499` files, typecheck 0, `verify:all` 0 with `UNCLASSIFIED 0`, bundle
52,930/53,248, register 86 rows / 0 violations. Zero-drift holds: `removed pre-existing: 0`; the single
changed file `leadgen-r2-dead-controls-guard.test.ts` 26→69 accounts for the entire pre-existing delta
7692→7735; `7735 + 599 = 8334`. **No arithmetic problem in the gate log.**

## Per-clause verdict table

| Clause | Owner anchor | Drove | Measured | Verdict |
|---|---|---|---|---|
| **M5** | *"the rules you build are using jargon, have no actions, and just poor poor execution"* | Real save failure (colliding Internal field) + real warning save (Maps on, 0 jobs) at 1280 and 375; `§`/ULID sweep of 7 admin routes; live board drop-refusal | Error: *"Save failed — 1 field **needs** attention: p8n_rev5 Phone: Another question in this Section already uses the Internal field 'p8n_rev5_ins' — each question needs its own. Rename one of them."* 0 `(§` anywhere. **But** the board still paints a raw ULID; 2 NEW messages this phase added are jargon; **no banner can be produced at 375 at all** | **DEVIATES** |
| **M6** | *"the canvas should include one section in the middle so the user could see a real reference of how is design is gonna look like in real life"* | Canvas vs live for the same section; re-authored default Yes→No→none | Canvas `lg-btn lg-btn-answer lg-selected`, `aria-checked=true`, `rgb(232,238,244)`; live identical. Dependency-hidden question unpainted in canvas, 0×0 live. Flipping the authored default flips selection and swaps which dependent shows — **the canvas really recomputes the resting state**. `fills:` chip = 0. **But** ADJ-P8-21 and ADJ-P8-22 reproduce verbatim; `render.ts` and `preview-sim.ts` byte-untouched | **DEVIATES** |
| **M7** | (same) | Canvas DOM of Dropdown + SearchableDropdown + ButtonAnswerGroup with an Other-select | `.studio-choice-x` on a native `<option>` = **0**; canvas option text identical to live; `+ Add choice` ghost for the button group only, absent for both dropdowns | **PERFECT** |
| **M4 + R6-2/3/4** | *"the mapping of what is auto-filled per field should definatly be an option"* | Unconfigured Address; ticked City Required only; fills picker; custom pattern; renamed a machine-derived choice → visitor → `POST /lg/auction` | Studio shows **Mode = Autofill ×4** (the renderer default). Ticking City Required persisted `mode:"autofill"` ×4 — **no manual materialisation**. Custom pattern stores `{regex}` and the runtime enforces it (`^[0-9]{4}$` blocked Continue, `aria-invalid=true`). Rename → buyer payload `"p8n_rev5_btns":{"value":"p8n_rev5_silver_carrier"}`. **But `fills` collides onto a sibling's answer key and destroys the visitor's City answer** | **DEVIATES** |
| **N14** | *"You must give the user the option to pick his desired slider from sliders list!!!"* | Independent 45° first tap at 1280 and 375 | Dial 176×176 / 140×140; tap → **value 13, expected 13** both viewports. **Does not reproduce — the phase's refutation holds** | **PERFECT (refuted, not re-filed)** |
| **N15** | `Image11.png` (opened) | dual_range + from_to at rest / mid / clamped, both viewports | Rest: pill top 423 vs handle bottom 418 → **under**. Mid: pill centre 537.9 vs handle 535.7; 730.7 vs 731.3 → travels with the handle. Clamped: staggers to a second row, still below. Grey `.lg-range-minmax` **present in all 12 states**, never deleted | **PERFECT** on the pinned placement (one styling observation, m-5) |
| **N16** | *"Each one of this questions is answering **another field** for the offers payload"* | All five symptoms; console + pageerror captured | (2) **0 pageerrors** across an 11-step grid session — fixed. (3) `Editing: Phone` / `Editing: Address` — fixed. (4) *"1 field **needs** attention"* — fixed. (5) `aria-label="Radial — age"` — fixed. **(1) selection badge still occludes the grid label at both viewports** | **DEVIATES** |
| *(re-drive)* **P8-4 apply-template** | *"use them as presets"* | dry run → apply → re-apply → different template → restore | Dry run `changes=0` and the text *"nothing on the page changes"* — **true**, visitor byte-equivalent. Different template `changes=5`, *"The question unit changes from a card to a bare layout"* — **true**: slot `--card`→`--bare`, card bg `rgb(255,255,255)`→`rgba(0,0,0,0)`, radius `16px`→`0px`. 0 pageerrors; fixture restored | **still tells the truth** |

## Ranked findings

### BLOCKER

**B-1 — `fills` collides onto a sibling's answer key and silently deletes the visitor's answer from the buyer payload.** *(INSIDE M4 — the register requires "fills cannot collide"; contract R6-2)*
`ui-section-studio.ts:8880-8895` (`takenBy`) dedupes only **across the four fill slots**; nothing checks the
sibling question that already owns the key. Driven: Address → Maps → enable → tick *Auto-complete the
address* → set **City → `p8n_rev5_note`** (a sibling FreeTextQuestion). Save → **HTTP 200, banner hidden,
zero problems.** Stored `props.maps.fills = {"city":"p8n_rev5_note"}`; the live page then carries
`data-lg-field="p8n_rev5_note"` on **two visible inputs**. Money path, from the real `POST /lg/auction`:
```
"answers":{ … "p8n_rev5_note":{"value":"p8n_rev5 typed","answer_source":"user_selected"} … }
```
The visitor typed **"Mountain View"** into the box labelled *City*; there is **no `…_addr_city` key at all**.
One answer key, two sources, last writer wins, no warning at authoring, save, or runtime. The picker's new
"— already filled by City" suffix proves the phase knew the class; it bounded the universe at four slots.

### MAJOR

**M-1 — N16 symptom 1 is not fixed: the selection badge occludes the grid label.** *(INSIDE N16)*
`ui-section-studio.ts:7478` places the type badge at `top:(oy-28)px; left:ox` with opaque `#1B3A5C`.
Measured identically at **1280 and 375**: label box `x 387→893, y 122.6→138.6`; badge `x 387→449.2,
y 114.6→135.6`. Overlap **62px × 13px of a 16px-tall label**. The operator authored `p8n_rev5 Are you
insured?` and reads `Are you insured?`. The phase's fix (`:1245`, `.studio-container-chip` `top:0`→`-18px`)
moved the *container* chip clear and left the *type* badge — the enumeration closed one of two badges.

**M-2 — M5's own register-named site is untouched: a raw ULID is the operator's reason.** *(INSIDE M5)*
`quotes-handlers.ts:2841` and `:3151` build the operator error from `section.public_id` and
`section.vertical`. `git diff 45053dfe..67f8798 -- src/admin/leadgen/quotes-handlers.ts` is **empty** — P8-5
never opened the file, although the register's M5 cell names exactly these two lines and allocates M5 to
P8-5. Driven from the quote editor at 1280, the drop returns
`400 {"fields":{"pages.0.slots.0.section_id":"section lgs_01KZ27D1Z55HWZ8F7WD5H9396T vertical 'finance' is not one of the quote verticals"}}`.

**M-3 — ADJ-P8-21 unfixed: the canvas paints an error state the live page cannot.** *(INSIDE M6)*
`runtime/render.ts:246` — `fieldEl.querySelector("[data-lg-input]")` searches descendants only, so where the
field block **is** the input (FreeTextQuestion) `aria-invalid` is never set live and the
`.lg-input[aria-invalid="true"]` border never fires. `render.ts` byte-untouched by P8-5. Driven on the real
preview route with `sim:{state:"error"}`, the canvas emits `aria-invalid="true"` for that same shape.

**M-4 — ADJ-P8-22 unfixed: the required message is written into a hidden element, and its test cannot fail.** *(INSIDE M6/M5)*
Real preview output: `<p class="lg-error lg-error-auto" role="alert" aria-live="polite" hidden …>This field
is required.</p>`. `preview-sim.ts:277-299` (`upsertErrorMessage`) fills the text and never clears `hidden`;
byte-untouched by P8-5. The live page **does** unhide it (`render.ts:243 toggleHidden`), so the canvas is the
one lying. `test/leadgen-sections-api.test.ts:1098` asserts a *"visible required message"* with a substring
check **a hidden element satisfies** — a false green.

**M-5 — The Section Studio cannot be saved at 375, silently.** *(pre-existing, but it makes two in-scope clauses unverifiable at a mandated viewport)*
`ui-section-studio.ts:~880` — `.studio-topbar` is `display:flex; height:56px; flex-wrap:wrap`. At 375 the
bar wraps below its fixed height and the opaque `.studio-settings` (`#F7F9FB`) paints over it. Measured:
`#lg-section-save` box `(199,135,70×33)`, `disabled:false`, `pointer-events:auto`, but
`elementFromPoint(centre)` returns the settings row; a **real mouse click issues 0 PATCH requests**, a
programmatic `.click()` issues one. At 1280 the same click saves. Consequence: the M5 error banner, the M5
warning banner and the N16-4 grammar **could not be surfaced at 375** — three saves, three no-ops, no error.
Introduced at `e460ab63`, not by P8-5.

### MINOR

- **m-1 — Two NEW operator messages this phase added are jargon fragments with no action.** *(INSIDE M5)*
  `content-schema.ts:3024` *"the custom address pattern isn't a valid regular expression"*; `:3013` *"the
  custom pattern must be at most 200 characters"*. Lowercase fragments; "regular expression" is developer
  vocabulary for a control the operator reads as *"Pattern the answer must match"*; neither names an action.
  The operator-language version **already exists in this phase's own code** at `ui-section-studio.ts:6194`/
  `:6198`. Contract R5: *"Reuse that register of language; do not invent new copy."*
- **m-2 — The save warning keeps the internal job triple, and the phase's R5 check pins it.** *(INSIDE M5)*
  *"…no job is selected (validate/auction/autocomplete)…"* — the operator's checkboxes read *Validate the
  answer* / *Use in auction rules* / *Auto-complete the address*. `test/leadgen-p8-r5-copy.test.ts:201`
  asserts that string with `toBe`, so the copy check now **certifies the residue**.
- **m-3 — REQ-R5's check universe is the save path, not "a user-visible surface".** *(INSIDE REQ-R5, scope)*
  `leadgen-p8-r5-copy.test.ts:305-380` walks the static import closure of `src/leadgen/sections.ts`.
  `quotes-handlers.ts`, `quotes-tabs/funnel.ts`, `activation.ts`, `ui-rules-builder.ts`, `ab.ts`, `themes.ts`
  are all outside it — and m-2 is exactly a message that surface would have caught. Live outcome today is
  clean: 0 `§` and 0 raw ULIDs at rest across 7 admin routes.
- **m-4 — The new custom address rule is a reduced model of the zip5 rule beside it.** *(INSIDE M4/R7)*
  `presets.ts:3095` narrows `validation` to `zip5: r["validation"] === "zip5"`, and `:3399` gives only that
  case `inputmode="numeric" pattern="\d{5}" maxlength="5"`. A `{regex}` rule emits none — and
  `runtime/validation.ts:413` **silently skips the rule when `text.length > 200`**, so with no `maxlength` a
  201-character entry passes an operator's format rule with no error and reaches the buyer.
- **m-5 — N15: the value is a filled navy chip; Image11 shows bold dark text on the page.** *(owner)*
  Placement, travel and the grey scale row all match the pin across 12 driven states. The pin has no chip
  behind `$37` / `18%` / `78%`. Human side-by-side is owner-owned; no pixel match was automated.
- **m-6 — dual_range/from_to handle aria-labels are bare role words.** *(owner)* `presets.ts:1196/:1217/:1220`
  emit `Minimum`/`Maximum`/`From`/`To` with no caption and no `aria-labelledby`; with two range questions a
  screen-reader user hears four indistinguishable labels. Not a raw id, so N16-5's letter is met.
- **m-7 — Canvas chrome the R4 table lists is still injected, by owner design.** *(observation)* R4 lists
  "2× `+ Add choice`" among things live lacks, while owner A.1 #1 requires *"the '+Add a question' button,
  for all the components, should be small, out of the component"*. The phase's reading is defensible; it
  should be **stated**, not assumed.

## Scans
- **Reduced-model / deferral:** diff-scoped scan of added lines → **0** `TODO|FIXME|HACK|XXX`, 0 deferral
  markers. One prose hit (*"…visitors type every field themselves for now."*) is an operator sentence about
  runtime state, not a deferral. Marker-free reduced models found: m-4, m-3, m-6.
- **No test weakened** — every test edit is a re-pin to new operator copy; the one renamed leg
  (`FAIL-BEFORE:` → `CHARACTERISATION:`, `leadgen-p8-m3-apply-template.test.ts:438`) has byte-identical
  assertions.
- **Security:** no new SQL and no dynamic-code-construction or markup-injection sinks in the added lines.
  The one added regex compile is a client-side validity probe inside try/catch; the server length-caps at
  200, screens with `isCatastrophicRegexShape`, and compile-checks before storing; runtime matching is
  try/catch'd and length-bounded. No new routes, no authz surface, no secrets. Clean.

## Bottom line
M7 and N14 are clean, M6's core mechanism is genuinely right — the canvas recomputes the engine's resting
state, the strongest thing this phase built — N15 matches the pin, and four of N16's five symptoms are
closed. But one owner clause carries a **money-path data-loss bug reachable in one click with no warning**
(B-1), the fifth N16 symptom is measurably still on screen at both viewports (M-1), three register rows the
plan allocated to this phase were never opened at all (M-2, M-3, M-4), and the operator journey the M5 clause
lives on is **dead at 375** (M-5). Not shippable.
