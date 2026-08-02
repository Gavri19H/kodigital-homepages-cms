# LeadGen R2 — P8 Defect Contract

**For an external agent with no prior context. Read this whole file before touching anything.**

Repo: `kodigital-homepages-cms` (TypeScript Cloudflare Worker + D1).
Worktree: `/Users/guyhaikov/a2z-workspaces/kodigital-cms-leadgen-r2-wt`
Branch: `reconcile/conversions-x-leadgen-r2`, HEAD at authoring time **`63089a5`**.
Baseline: `npm test` → **7662 passed / 0 failed / 30 skipped (471 files)**; `npm run typecheck` → 0; `npm run verify:all` → 0; `LEADGEN_RUNTIME_JS_BYTES` = **52,762** of a **53,248** cap.

---

## 0. What this product is, and who the owner is

A CMS for building lead-generation funnels. An **operator** authors funnels in an admin UI; a **visitor** walks the funnel; answers are posted to an auction that sends a payload to **buyers**. Money moves, so the visitor and payload paths are the highest-risk surfaces.

The owner is the product's owner. A previous build shipped with 6,900 passing tests and clean reviews, and **they rejected it in use**. Their verbatim words are committed at `docs/leadgen/source-of-truth/SOURCE-OF-TRUTH.md` and are the **only** acceptance authority. Quote them; never paraphrase. Design pins are in `docs/leadgen/source-of-truth/images/` — open the images, do not infer them.

Every issue below was found by **operating the product in a browser and measuring**, not by reading code. Reproduce before you fix.

---

## 1. Scope boundary — read this twice

**This contract is a defect list. It is NOT a licence to harden.**

The owner's standing ruling: *fix the source of a defect; do not add gates, guards, validators or blockers that no clause asks for.* A previous round proposed a new activation blocker ("it must be impossible to publish a funnel a visitor cannot advance through") and the owner rejected it as unnecessary hardening. It is **excluded** and must not be re-introduced.

Specifically **DO NOT**:
- add new preflight/activation blockers, save-time validation, or "safety" gates,
- auto-insert content the operator did not author,
- broaden a fix into a refactor,
- "improve" anything not listed here.

**Explicitly out of scope (do not fix, do not report as a defect):**
- A question-grid section set to `continue_mode='button'` with no authored `ContinueButton` renders no advance control (`presets.ts` `planContinueRender` ~:4831 returns `{suppressContinue:false, forceSlot:false}` for `button`). The owner's position: an unfinished funnel is unfinished. **Leave exactly as found.**
- The known stale-edge-cache lag after a save (up to ~300s; see §7). It is registered and owner-referred.

If you believe something here requires hardening to fix properly, **STOP and report** rather than adding it.

---

## 2. Environment — get this right or every result is false

```bash
cd /Users/guyhaikov/a2z-workspaces/kodigital-cms-leadgen-r2-wt/api
npm ci                      # must succeed; lockfile is healthy at this HEAD
npm run db:reset:local
npx wrangler dev --port 8901 --ip 127.0.0.1 --var DEV_BYPASS_AUTH:true --var ADMIN_HOST:127.0.0.1
npm run seed:leadgen-fixture      # honours LG_BASE, default http://127.0.0.1:8901
```

**Non-negotiables:**
- `api/.dev.vars` **must exist** (gitignored). Without `LEADGEN_CONFIG_SIGNING_KEY` every `POST /lg/auction` returns `422 {"traffic_quality_flag":"tampered"}` and you will misdiagnose the whole product. If you create a new worktree, **copy `.dev.vars` into it.** This exact mistake produced a false "every visitor is broken" blocker.
- The admin gate answers on **`127.0.0.1`**, not `localhost` (`playwright.config.ts:281` overrides the toml).
- **Never bind port 8787** — a different project owns it. Playwright's own config may try to; run standalone browser scripts if needed.
- Restart wrangler after **any** `db:reset:local` (a stale D1 handle makes `/api/admin/sites` 500 and looks like a product bug).
- **Never run `wrangler d1 execute --local` against a live `wrangler dev`** — it corrupts local D1 and forces a full reset.
- The served visitor shell is browser-cached `max-age=300`. Always append `?_cb=<timestamp>` when measuring, and re-save the **activation** to force a fresh shell.
- Never run `wrangler deploy`, `wrangler secret put|delete`, or any `--remote` D1 command. Deployment is owner-only.

**Evidence discipline:** screenshots at **1280 and 375** for anything visual; for a "this now works" claim, measure the painted value (computed style, bounding box, or the actual DB/provider row) — a differing CSS class is not proof. Put artifacts under `docs/leadgen/r2/evidence/p8/<issue-id>/`.

---

## 3. Test-suite hazards you will hit

| Hazard | What happens | What to do |
|---|---|---|
| `leadgen-p3a-split-parity.test.ts` | Byte-pins the whole admin editor page. **Any** admin markup change trips it. | Recapture via `src/scripts/capture-p3a-presplit.ts`. Snapshot first, classify **every** differing line, prove untouched fixtures byte-identical by sha256. One unexplained line → stop. |
| `leadgen-p2-tail.test.ts`, `leadgen-p2-fixfirst-r2.test.ts` | Rebuild an admin island from a **hand-listed** `sliceIslandVar` manifest. Adding or removing an island variable fails with a bare `ReferenceError`. | Update the manifest; do not revert your change. |
| `LEADGEN_PIN_UPDATE=1` in `leadgen-section-preview-frame.test.ts` | Broken: mints the raw response but compares a normalised one, so a minted pin can never verify. Minting two files in one run cross-contaminates them. | Mint one file at a time and verify by hand. |
| `leadgen-visual`, `leadgen-v31-gate1c-baselines` | Frozen screenshot suites, currently red for owner-ruled reasons. | **Do not rebaseline.** Report any delta and leave red. |

---

## 4. BLOCKING issues

### P8-B1 — The Themes canvas never shows the site's logo
**Owner, verbatim (A.1 #11.A):** *"Image18 - I chose a site - why I don't see its logo???? I clearly defined this as an issue!!!!!!"*

**Symptom.** On the **Themes** tab, with a site chosen in the top "Preview site" picker, the canvas always renders the placeholder `"No logo — set it in Site settings."` — for every site, including sites that definitely have a logo. At the same moment the **Templates** tab canvas renders that same site's logo correctly.

**Measured.** Driven across three site states (activated + logo, not-activated + logo, no logo): Themes canvas = placeholder in all three; Templates canvas = correct logo in the first two and the correct "no logo" chip in the third.

**Cause.** `api/src/admin/leadgen/quotes-tabs/themes.ts` builds its preview `frame_context` **without a `site_id`** — the string `site_id` appears **zero** times in that file (verify: `grep -c site_id src/admin/leadgen/quotes-tabs/themes.ts` → `0`). Compare `quotes-tabs/templates.ts:1176`, which does `if (mySiteId) { body.site_id = mySiteId; }`.

**End state.** Choosing a preview site on the Themes tab renders that site's logo in the Themes canvas, matching what the Templates canvas renders for the same site at the same moment. A site with no logo shows the existing honest placeholder.

**Acceptance.** For each of the three site states, capture the Themes canvas and the Templates canvas side by side and report the measured logo bounding box in both. They must agree. 1280 + 375.

---

### P8-B2 — Funnels cannot be seen side by side
**Owner, verbatim (A.1 #11.C):** *"in the middle create different funnels side by side and drag sections boxes to the page of the wanted funnle"* — and directly: *"how he can see them side by side?"*

**Symptom.** The funnel board sits between two fixed rails and gets whatever is left. At a normal laptop width the operator sees essentially one column.

**Measured** with 4 funnel columns (each 288px), rails 292px + 344px, board `flex:1` (`quotes-tabs/shared.ts:682-684`):

| Viewport | Board content width | Fully visible columns |
|---|---|---|
| 1280 | 344px | **1 — and it is the *Shared* card, so zero funnels** |
| 1440 | — | 1 |
| 1600 | — | 2 |
| 1920 | — | 3 |

**End state.** At **1280** the operator can see at least two funnel columns side by side, and the board remains usable at 1440/1600/1920. The owner's phrase is "side by side" — one column is a failure of the clause regardless of scrolling being possible.

**Constraints.** Do not delete the rails; the left section library and the right rules rail are both owner-required (*"add in the left side all the available sections in draggable boxes"*, *"show them in the right side where we define rules"*). Options include narrowing/collapsing rails, letting the board reclaim space, a horizontal-scroll affordance that still shows two columns, or narrower funnel columns. Choose deliberately and justify.

**Acceptance.** Report the measured count of fully visible funnel columns at 1280 / 1440 / 1600 / 1920, before and after, with 4 funnels present. Screenshots at each width. No horizontal overflow of the page body at 375.

---

## 5. MAJOR issues

### P8-M1 — There is no theme picker per funnel
**Owner, verbatim (A.1 #11.C-D):** *"Theme picker per funnel name."*

**Symptom.** Every funnel column has a "Theme" chip, but it calls `gotoTab('themes')` (`quotes-tabs/funnel.ts:4920`) with **no funnel identity**. The Themes tab has zero funnel selectors, and its header says "affects…this funnel" while naming no funnel.

**Measured.** The Themes panel's `innerText` hash is identical whether opened from funnel 0 or funnel 1 (`4e44d22cbb94`).

**Note.** The *capability* exists — themes can be stored per funnel and two funnels do serve two different themes on the live page. It is the **control** that does not carry the funnel. Do not rebuild the capability; wire the control.

**End state.** Clicking a funnel's Theme chip opens theme editing scoped to **that** funnel, the screen names the funnel, and saving changes that funnel's theme only.

**Acceptance.** Two funnels, two different themes chosen through the chips. Prove the stored theme differs per funnel and that the live visitor page for each funnel paints its own theme (measure a font family and a colour). Prove the panel names the funnel you came from.

---

### P8-M2 — Four theme/card controls change nothing
Owner's ruling on themes: *"theme is only design language!!!! colors, fonts, sizes"*. A control that saves and paints nothing is the class the owner has already rejected four times.

| Control | Set to | Measured result |
|---|---|---|
| **Button casing** | `UPPERCASE` | Emitted stylesheet **byte-identical** (63,963 chars both); every answer keeps `text-transform:none` |
| **Card corners** | `full` | `.lg-question-card` `border-radius` stays `16px`; the only changed rule is an unrelated disclosure modal |
| **Card shadow** | `xl` | `.lg-question-card` `box-shadow` unchanged |
| **Shadows (scale)** | `high` | Only rewrites `--lg-shadow-*` custom properties — **zero rules in the 64KB stylesheet read `var(--lg-shadow`** (verify: `grep -c 'var(--lg-shadow' src/public/leadgen/designs/default-funnel/styles.ts` → `0`) |

`text_transform` is computed at `designs/theme.ts:1285`. **Careful:** grepping for the identifier finds files, but the *painted stylesheet* is unchanged — so **measure the emitted CSS and the painted element**, do not trust a grep.

**End state.** Each of the four either governs a measurable painted value, or is removed from the UI. **A control that cannot be honoured must not be offered.** State per control which you chose and why.

**Reference implementation** (already done, follow this shape): theme `corners`, `button_size`, `field_height` and the per-logo `size` were dead and were wired to one shared derivation, pinned by a structural guard at `api/test/leadgen-r2-dead-controls-guard.test.ts`. **Extend that guard** to cover whatever you wire here — it enumerates control keys from their types and asserts each reaches a painted output. Its allowlist requires a written reason per exemption.

**Acceptance.** Per control: the measured painted value before and after for every option value, on the **live visitor page**, 1280 + 375. Plus the guard failing on the old code and passing on the new.

---

### P8-M3 — Applying a saved template silently drops its logo settings
**Owner, verbatim (A.1 #11.D):** *"I should be able to create as many templates I want, to save them, and to use them as presets in different 'Quotes'"*. The apply dialog promises *"Layout comes from the template."*

**Measured.** Authored element B as **Large / Left** (canvas logo `176×44` at `x=32`); the saved template stored `header:{logo_size:"l", logo_align:"left"}`. Applying that template to a funnel produced `header.logo_size="m"`, `logo_align="center"`, canvas `128×32` at `x=136`.

**Cause.** `apply-template` (`frame-handlers.ts`) writes only a `frame_template_id` pointer, so any per-funnel value shadows the template permanently.

**End state.** Applying a template makes the funnel render the template's layout, including logo size and alignment. Either the apply clears the shadowing per-funnel overrides, or the resolver lets template values win where the funnel has not deliberately overridden them — pick one, justify it, and make the dialog's promise true.

**Acceptance.** Author a template with a non-default logo size and alignment, apply it to a funnel that currently differs, and measure the canvas **and live page** logo box before and after. Prove a funnel with a *deliberate* override still keeps it (or state clearly that apply overwrites, and make the dialog say so).

---

### P8-M4 — Progress "Show label" does nothing on the `numbered` style, and the label wording differs in three places
**Symptom.** With style `numbered`, toggling "Show label" ON vs OFF produces **byte-identical** live screenshots (SHA `b44f6019…`).

**Separately:** the operator help says `e.g. "Step 2 of 5"`; the server-rendered page emits `Step 1 of 2`; the hydrated visitor page shows `1 / 2`. Three formats for one thing.

**End state.** "Show label" visibly changes the `numbered` render. The label format is consistent between the help text, the server render and the hydrated render.

**Acceptance.** Screenshots ON vs OFF for `numbered` with the measured difference; and the three surfaces quoted showing the same format.

---

### P8-M5 — Address per-field "Autofill" cannot be selected without saving and reloading
**Owner, verbatim (A.1 #6):** *"the mapping of what is auto-filled per field should definatly be an option, I clearly defined it, but not in this poor way!!!!"*

**Measured.** With `GOOGLE_MAPS_BROWSER_KEY` present (panel reads "Google Maps: connected", `data-maps-key-configured="true"`), the node's Maps toggle ON and all three jobs ticked, the per-field **Mode** select still offers only `Manual`, and the help still says "turn it on in the Maps tab". Only after **save + reload** does it offer `Manual, Autofill`.

**Cause.** `collectMapsToggle()` at `api/src/admin/leadgen/ui-section-studio.ts:8697-8718` calls `populateMapsTab` but never `populateAddressFieldSet`; the field rows and their `autofillAllowed` flag are built only at `:8182` / `:12225`.

**End state.** Turning Maps on makes Autofill selectable **in the same session**, with no save or reload.

**Acceptance.** Drive it in one session: toggle Maps on, tick the jobs, open the Mode select, and show `Autofill` present. Then choose it, save, and prove the live page honours it.

---

### P8-M6 — The section studio prints spec text in its save messages
**Owner, verbatim:** *"why you left comments to yourself on the UI????"*

**Measured.** The save banner shows strings such as `"a stepper slider requires a numeric props.Step (§6.8)"` and `"choice.Analytics Id is required (§22 tracking)"`. There are **119** `(§…)` clause references in `api/src/public/leadgen/components/content-schema.ts` (verify: `grep -oE '\(§[0-9]' src/public/leadgen/components/content-schema.ts | wc -l`), plus raw `props.x` paths, and one at `:2207` that literally says *"this is a contract erratum, see content-schema.ts comment"*. All of these reach the operator verbatim.

**Note.** A previous sweep fixed **63** operator-visible strings across the *admin* files. This file was not in that sweep. The remaining admin hits are code comments and must be left alone.

**End state.** Every validation message an operator can see is written for an operator: says what is wrong, which field, and how to fix it. No `§` clause refs, no `props.` paths, no internal ids, no notes to ourselves.

**Acceptance.** Trigger a representative set of validation failures in the UI (at minimum: the stepper-step case, the analytics-id case, and three others) and quote the before/after banner text. Then prove **zero** `(§` strings can reach a user-visible message.

---

### P8-M7 — The studio canvas does not paint an authored default answer
**Owner, verbatim (A.1 #1):** *"independent **defaults!!** (right now only the first question has option for default)"*

**Measured.** With `defaultValue:true` saved on a grid question, the studio canvas renders Yes as `class="lg-btn lg-btn-answer"`, background `rgb(255,255,255)`, `aria-checked="false"` — unselected. The live visitor page renders the same question with `lg-selected` and a blue fill. The operator's preview disagrees with reality.

**End state.** The studio canvas shows the authored default as selected, matching the live page.

**Acceptance.** Same question, canvas and live page side by side, with the measured class/background/`aria-checked` on both. 1280 + 375.

---

### P8-M8 — The studio canvas shows text a visitor never sees, and a control that does nothing
**Measured.** In the studio canvas a dropdown's options render as `Geico×`, `Allstate×`, `AUDITC Mutual×` — the `×` delete affordance is being drawn *inside* native `<option>` elements. Selecting `Geico×` changes nothing (options identical before and after), and an `<option>` cannot host a clickable control. The live page correctly shows `Geico`.

**End state.** The canvas shows what the visitor will see. Any delete affordance lives somewhere it can actually be clicked, or is removed from the canvas and left to the inspector.

**Acceptance.** Canvas vs live option text for the same dropdown, before and after; and proof the delete affordance either works where it now lives or is gone.

---

### P8-M9 — Help text points at a screen the owner had removed
**Measured.** `quotes-tabs/templates.ts:144` tells the operator to *"open the Header region on the canvas (Funnel builder tab) → Advanced."* The Funnel builder has **no canvas** — the owner ordered it removed (*"kick out all the stupid and unusable components from the 'Funnel builder' - the canvas, the canvas controllers on the top, the varient"*), and "Advanced" there contains only a Reference id.

**End state.** The instruction names a control that exists and takes the operator somewhere real.

**Acceptance.** Quote the old and new copy, and drive the path the new copy describes.

---

### P8-M10 — Emptying a shared page leaves it live for visitors
**Measured.** `PUT /quotes/:id/shared-page {slots:[]}` removes the slot but leaves an orphan row in `leadgen_funnel_variant_sections` (`quote_id=1, page_id=2, slot_id=NULL`). The admin then reports `sections: []` while the resolver's by-`page_id` fallback **still serves that section**. Proven: the serve path returned 2 sections after the "emptying" PUT, and 1 after the orphan row was deleted by hand.

**Why it matters.** The operator believes they removed a section; visitors still see it. This is the admin-vs-visitor disagreement class the owner has already rejected.

**End state.** Emptying a shared page removes it for visitors too. Admin state and served state agree.

**Acceptance.** Empty a shared page through the UI, then fetch the live page with a cache-bust and show the section is gone. Include the DB state before and after.

---

## 6. MINOR issues

Fix these; they are small, and several are the owner's own words.

| ID | Issue | Evidence / location |
|---|---|---|
| **P8-N1** | Progress **Alignment** has three values (Left/Center/Right) and **one** render (hash `f6a154c23c0b`) — `--align-*` sets `text-align` on a full-width block | live canvas |
| **P8-N2** | Progress **Position** "Under the header" and "Above the question unit" render identically (`b5800cd2c4ba`) | live canvas |
| **P8-N3** | Raw internal tokens shown as option labels: Button corners `sm/md/lg/xl/full`; Card corners/shadow the same; Base visual design `default` / `default-funnel` | Themes rail, funnel settings |
| **P8-N4** | Rules help exposes operator ids: *"Operators map to eq · neq · gt · lt · gte · lte."* | `ui-rules-builder.ts:2206` |
| **P8-N5** | Rule summary shows the raw DB field id: *"Answer: R2Fix Fixture Carrier Buttons · **r2fix_carrier** is …"*. The owner already rejected this shape as `is excellent_rvw7q3`; the *value* side was fixed, the **field id** side was not | `ui-rules-builder.ts` |
| **P8-N6** | Rule Checkpoint shows zero-based *"— page 0"* while the board labels the same page "PAGE 1" | `ui-rules-builder.ts:1966` |
| **P8-N7** | A/B copy exposes storage internals: *"stored as basis points, per-test Σ == 10000"* | `ab.ts:157` |
| **P8-N8** | Every added funnel is named **"New funnel"**, producing identical rows in the blocker banner and identical options in the rule target select | `funnel.ts:4124` |
| **P8-N9** | Themes selects truncate their own default label to *"Inherit from base de⌄"* | Themes rail |
| **P8-N10** | "Create A/B test" reloads to the Funnel builder with no confirmation (the test *is* created) | A/B tab |
| **P8-N11** | The funnel-layout element letters skip **G**: `A B C D E F H I J`. Caused by moving the footer to J per the owner's A.2 while `I` is pinned to Progress by A.1 #11.D. Nine tiles cannot fill ten letters, so one is vacant. **Decide with care and explain the result on screen** — the owner noticed the gap | `templates.ts:765-771` |
| **P8-N12** | New Quote page says *"A funnel + **control** variant are created automatically"* while the A/B tab says *"Equal arms; no control"* and the owner wrote *"there is no 'control' funnel!!!"* | new-quote page |
| **P8-N13** | Themes preset select says *"No presets yet — create one below"*; creation is only in the Themes manager, nothing is below | Themes tab |
| **P8-N14** | "Apply to this funnel" / "A/B this theme" are enabled when there are zero presets | Themes tab |
| **P8-N15** | Logo Alignment offers Left/Center only, while progress Alignment offers Left/Center/Right | element B panel |
| **P8-N16** | Renaming the seeded first "Other" choice leaves its stored value as `other_option`, so the buyer receives the placeholder. The second row derived its value correctly | Other editor → provider payload |
| **P8-N17** | The radial slider's first tap mis-registers (`input.focus()` runs before `dialTo()`, `engine.ts:1170-1173`; page scrolls 164→180; a 45° press records 15 instead of 13). Subsequent presses are exact | live visitor |
| **P8-N18** | The payload builder's **sample preview** shows the same value for 3 of 4 output formats (`170000` → `170000`, `$170,000`, `170000`, `170000`). The JSON preview does distinguish them, and the real payload is correct — only the sample chip misleads | payload builder |
| **P8-N19** | `dual_range` renders as a `from_to` clone minus the two boxes, with value pills **above** the track; the owner's Image11 puts values **under** the handles | compare against `images/Image11.png` |
| **P8-N20** | Studio polish: selection badges overlap and occlude grid question 1's label; a `pageerror: Failed to execute 'removeChild'` fires during grid authoring; the inspector titles Phone and Address as *"Editing: Short text field"*; banner grammar *"1 field need attention"*; a slider's `aria-label` reads the raw field id `field_msc2ulic_jwzg` to screen readers | section studio |
| **P8-N21** | The owner's A.2 lists *"free text (rich toolbar)"* and *"company details"* as separate things; the product merges them into one block | element J panel |

---

## 7. NOT defects — do not "fix" these

- **The `continue_mode='button'` dead end** (§1). Owner-excluded as hardening.
- **The stale edge cache after a save.** `invalidateOnVariantPublish` deletes the KV key but never `caches.default`, while the read path checks `caches.default` first, so an edited page can serve stale for up to 300s in production. Registered as ADJ-N39, measured, owner-referred. Work around it with an activation re-PUT plus `?_cb=`; **do not fix it here.**
- **Frozen visual baseline suites** — red for owner-ruled reasons; do not rebaseline.
- **`leadgen-p2-tail` / `leadgen-p2-fixfirst-r2` hand-listed island manifests** — fragile by construction, registered; update the manifest, do not redesign.
- **Already fixed at this HEAD** (do not re-report): the dead funnel Preview button; the footer font/size that emptied the footer; the site logo collapsing to alt text on the Templates canvas; `icon_on_track` rendering as a plain bar; `percent` identical to `bar`; the five identical picker thumbnails; 63 clause-reference strings in the admin files; the rules rail printing raw choice values; the dead-control class for theme corners, button size, field height and per-logo size; publish-blocker reasons not naming themselves or their target control; the dead canvas island firing wasted requests.

---

## 8. Owner decisions — surface, do not act

Report these in your final summary; the owner rules, not you.

1. **The shared-page publish gate.** `quotes-handlers.ts:5934` blocks activation when the shared first page has no sections. Driven on the real serve path, the runtime **skips** an empty shared page — the visitor sees the funnel's first real section, no blank screen (measured: `sections=1`, first slide rendered normally). No R2 clause requires a non-empty shared page; the rule traces to a pre-R2 ruling. **Recommend relaxing it; do not relax it without the owner's word** — it is a live money path.
2. **Image29 / Image30 / Image31.** The owner named five footer examples; only Image28 and Image45 were ever built.
3. **Footer colours** are references into the main palette, so re-theming the funnel moves them. The owner's A.2 says the footer *"could use different color … then the main template"*.
4. **`percent` shows its number only when "Show label" is on.** Making it always-on touches `advanceFrameProgress`, whose `from`/`to` swap is gated on `show_label`; a naive change would silently break the preview's per-step advance.

---

## 9. Definition of done

1. Every issue in §4, §5 and §6 is either **fixed and driven**, or **reported with evidence explaining why it should not be fixed**. No silent omissions.
2. Per issue: reproduction before the fix, the measured value after, screenshots at 1280 and 375 for anything visual.
3. `npm test` green **by count** from an explicit `cd .../api` — at or above **7662 passed / 0 failed**, and state the arithmetic for any test you deliberately retired (a retired test must name in-file what now covers its claim).
4. `npm run typecheck` → 0. `npm run verify:all` → 0.
5. `LEADGEN_RUNTIME_JS_BYTES` ≤ **53,248**. If a fix would exceed it, **stop and report** — never simplify below what the owner asked for.
6. **No assertion weakened.** For every test you touch, state what it asserted before and after.
7. No new gates, guards or validators beyond what an issue explicitly requires (§1).
8. Nothing deployed. No secrets touched. No `--remote` D1 writes.
