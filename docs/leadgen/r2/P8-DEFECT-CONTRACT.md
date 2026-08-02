# LeadGen R2 — P8 Defect Contract (v2, root-cause)

**For an external agent with no prior context. Read §0–§3 before touching anything.**

Repo `kodigital-homepages-cms` (TypeScript Cloudflare Worker + D1).
Worktree `/Users/guyhaikov/a2z-workspaces/kodigital-cms-leadgen-r2-wt`, branch `reconcile/conversions-x-leadgen-r2`, HEAD **`3ebb15e`**.
Baseline: `npm test` **7662 passed / 0 failed / 30 skipped (471 files)** · `npm run typecheck` 0 · `npm run verify:all` 0 · `LEADGEN_RUNTIME_JS_BYTES` **52,762** of a **53,248** cap.

> **v2 note.** v1 of this contract listed 33 symptoms. It was rejected: several entries were the visible end of a shared root cause, and one "already fixed" item was fixed only skin-deep. v2 is organised **root cause first**. Fixing the six systemic causes in §4 resolves most of §5 and §6 as a consequence. Do not patch a symptom whose cause is listed in §4.

---

## 0. The product, and who decides

A CMS for lead-generation funnels. An **operator** authors funnels in an admin UI; a **visitor** walks the funnel; answers post to an auction that sends a payload to **buyers**. Money moves on the visitor and payload paths.

The owner's verbatim words at `docs/leadgen/source-of-truth/SOURCE-OF-TRUTH.md` are the **only** acceptance authority. Quote them, never paraphrase. Design pins live in `docs/leadgen/source-of-truth/images/` — **open the image**, do not infer it.

A previous build shipped with 6,900 green tests and was rejected in use. Everything here was found by **operating the product and measuring**. Reproduce before you fix.

---

## 1. Scope boundary — no hardening

**This is a defect list, not a licence to harden.** The owner's standing ruling: *fix the source; do not add gates, guards, validators or blockers no clause asks for.* A proposed activation blocker was already rejected as unnecessary hardening.

**DO NOT:** add preflight/activation blockers or save-time validation; auto-insert content the operator did not author; broaden a fix into a refactor; "improve" anything not listed.

**Explicitly out of scope — leave exactly as found:**
- A grid section with `continue_mode='button'` and no authored `ContinueButton` renders no advance control (`presets.ts` `planContinueRender` ~:4831). **Owner: an unfinished funnel is unfinished.**
- The stale edge cache after a save (~300s; `invalidateOnVariantPublish` clears KV but not `caches.default`, which the read path checks first). Registered, owner-referred. Work around it; do not fix it.
- Frozen visual suites `leadgen-visual`, `leadgen-v31-gate1c-baselines` — red for owner-ruled reasons. **Do not rebaseline.**
- The hand-listed `sliceIslandVar` manifests in `leadgen-p2-tail` / `leadgen-p2-fixfirst-r2` — fragile by design, registered. Update the manifest; do not redesign.

If a fix seems to need hardening, **STOP and report**.

---

## 2. Environment — get this right or every result is false

```bash
cd /Users/guyhaikov/a2z-workspaces/kodigital-cms-leadgen-r2-wt/api
npm ci
npm run db:reset:local
npx wrangler dev --port 8901 --ip 127.0.0.1 --var DEV_BYPASS_AUTH:true --var ADMIN_HOST:127.0.0.1
npm run seed:leadgen-fixture       # honours LG_BASE, default http://127.0.0.1:8901
```

- **`api/.dev.vars` must exist** (gitignored). Without `LEADGEN_CONFIG_SIGNING_KEY` every `POST /lg/auction` returns `422 "tampered"` and you will misdiagnose the entire product. **Copy it into any new worktree.** This exact mistake produced a false "every visitor is broken" blocker.
- Admin answers on **`127.0.0.1`**, not `localhost` (`playwright.config.ts:281` overrides the toml).
- **Never bind 8787** (another project). Playwright's config may try — run standalone browser scripts if needed.
- Restart wrangler after **any** `db:reset:local` (stale D1 handle → `/api/admin/sites` 500s, looks like a product bug).
- **Never** `wrangler d1 execute --local` against a live `wrangler dev` — corrupts local D1.
- Visitor shell is cached `max-age=300`: always `?_cb=<ts>`, and re-save the **activation** to force a fresh shell.
- Never `wrangler deploy`, `wrangler secret put|delete`, or any `--remote` D1 command.

**Evidence:** screenshots at **1280 and 375**; every "works now" claim is a **measured painted value** (computed style, bounding box, DB row, or provider-log row). A differing CSS class is not proof. Artifacts → `docs/leadgen/r2/evidence/p8/<id>/`.

---

## 3. Test-suite hazards

| Hazard | Behaviour | Handling |
|---|---|---|
| `leadgen-p3a-split-parity.test.ts` | Byte-pins the whole admin editor page; **any** admin markup change trips it | Recapture via `src/scripts/capture-p3a-presplit.ts`: snapshot, classify **every** differing line, sha256-prove untouched fixtures. One unexplained line → stop |
| `leadgen-p2-tail`, `leadgen-p2-fixfirst-r2` | Rebuild an island from a hand-listed var manifest; a new/removed island var → bare `ReferenceError` | Update the manifest |
| `LEADGEN_PIN_UPDATE=1` in `leadgen-section-preview-frame.test.ts` | Broken — mints raw, compares normalised, so a minted pin never verifies; two mints in one run cross-contaminate | Mint one at a time, verify by hand |
| `leadgen-r2-dead-controls-guard.test.ts` | The existing structural guard. **Has a coverage hole — see S2** | Extend it, do not weaken it |

---

## 4. ROOT CAUSES — fix these; most symptoms fall out

### S1 — A design control is "done" only when it reaches **all five** of its surfaces
The recurring failure in this product is a control wired to *one* surface and declared finished. Every authorable design value has up to five destinations:

1. the **admin control** itself (present, labelled in operator language, shown only when relevant),
2. the **studio/templates canvas** preview,
3. the **live visitor page**,
4. the **picker thumbnail** that advertises the option,
5. the **saved-template thumbnail** (`frame-handlers.ts` ~:326).

**Worked example — the one the owner caught.** `icon_on_track` was "fixed" by adding an icon. Measured at HEAD, it satisfies 3 of 5:
- Icon set is a hardcoded enum of six — `FRAME_PROGRESS_ICONS = ["dot","car","shield","check","star","site_logo"]` (`frames.ts:63`) — with **no way to supply your own**, even though `mediaPickerControl` / `mediaFieldMarkup` already exist **in the same file** and are used five times (background image `templates.ts:143`, header logo `:354`, footer logo `:519`, element H `:598`).
- The "Marker icon" select (`templates.ts:728`) is rendered **unconditionally** — visible for all five styles, with help text apologising that it only applies to one.
- `progress.icon` appears **exactly once** in `templates.ts` (the select). It does **not** reach the picker thumbnail.
- `frame-handlers.ts:326-327` builds the saved-template thumbnail from `d.progress.style` **only** — the icon is invisible there too.

**Rule for every control you touch in §5/§6:** state the five surfaces, say which apply, and prove each with a measurement. If an option set is hardcoded while the product already offers a picker for that kind of value, **wire the picker** — do not extend the enum.

### S2 — The dead-control guard has a coverage hole
`test/leadgen-r2-dead-controls-guard.test.ts` enumerates keys from `ThemeRecordControls` and `FrameBrandLogoItem` only. That is why four more dead controls (S-list below) survived it. **Extend the guard to enumerate every authorable design key** — `theme_json.scales.*`, `theme_json.*_defaults.*`, and the frame config keys the panels write — and assert each reaches a painted output. Empty allowlist; any exemption needs an in-code reason string. **This guard is the regression barrier for S1** — without it, the next control will die the same way.

### S3 — Applying a saved template only writes a pointer, so every per-funnel value shadows it forever
`apply-template` (`frame-handlers.ts`) stores a `frame_template_id` and nothing else. Any value already on the funnel wins permanently, while the apply dialog promises *"Layout comes from the template."*

**Measured (logo, but it is not logo-specific):** template authored Large/Left, stored `header:{logo_size:"l",logo_align:"left"}`; after apply the funnel read `logo_size:"m"`, `align:"center"`; canvas `128×32 @x=136` instead of `176×44 @x=32`.

**Do not fix this for the logo alone.** Establish the general rule — either apply clears shadowing per-funnel frame values, or the resolver lets template values win where the funnel has not *deliberately* overridden — then prove it across **at least three different element groups** (logo, progress, background). Make the dialog's wording true.

### S4 — Option sets that are hardcoded where the product already has an authoring path
The icon enum is the proven case (S1). Before fixing any "the options are wrong/missing" item in §5/§6, check whether the product already has a picker, media library, or enum-with-authoring for that value type and wire it, rather than adding another fixed list. Report every hardcoded set you find in the controls you touch, even if you leave it.

### S5 — Internal prose reaching operator-visible copy
Two rounds have now leaked spec text into the UI. A previous sweep fixed **63** strings in `src/admin/leadgen/**`; the section-studio path was missed and still has **119** `(§…)` references in `src/public/leadgen/components/content-schema.ts` that reach the save banner verbatim (e.g. `"a stepper slider requires a numeric props.Step (§6.8)"`, `"choice.Analytics Id is required (§22 tracking)"`, and `:2207` which literally says *"this is a contract erratum, see content-schema.ts comment"*).

**Rule:** every string a user can see is written for that user — what is wrong, which field, how to fix it. No `§`, no clause or register ids, no `props.` paths, no image filenames, no notes to ourselves. Code comments are untouched. **After your work, prove zero such strings can reach a user-visible surface**, and add that as a check so it cannot regress.

### S6 — Admin state and served state are allowed to disagree
`PUT /quotes/:id/shared-page {slots:[]}` removes the slot but leaves an orphan `leadgen_funnel_variant_sections` row (`quote_id, page_id, slot_id=NULL`); the admin then reports `sections: []` while the resolver's by-`page_id` fallback **still serves the section**. Measured: serve returned 2 sections after the "emptying" PUT, 1 after the orphan row was deleted by hand. The operator believes they removed something; visitors still see it.

Fix the write path so admin and served state agree, and check the same fallback for sibling delete paths (page delete, funnel delete) — report what you find.

---

## 5. BLOCKING

### B1 — The Themes canvas never shows the site's logo
**Owner (A.1 #11.A):** *"Image18 - I chose a site - why I don't see its logo???? I clearly defined this as an issue!!!!!!"*

Themes canvas returns `"No logo — set it in Site settings."` for **every** site — including sites with a logo — while the Templates canvas paints that same site's logo at the same moment. Driven across activated+logo / not-activated+logo / no-logo: Themes placeholder in all three.

**Cause.** `quotes-tabs/themes.ts` builds `frame_context` with **no `site_id`** (`grep -c site_id` → **0**), versus `templates.ts:1176` `if (mySiteId) { body.site_id = mySiteId; }`.

**End state.** Choosing a preview site on Themes renders that site's logo, agreeing with Templates for the same site. No-logo sites keep the honest placeholder.
**Acceptance.** Three site states × both canvases, measured logo bounding boxes, 1280 + 375.

### B2 — Funnels cannot be seen side by side
**Owner (A.1 #11.C):** *"in the middle create different funnels side by side…"* and *"how he can see them side by side?"*

Board is `flex:1` between fixed 292px + 344px rails (`quotes-tabs/shared.ts:682-684`); columns are 288px. With 4 funnels: **1280 → board 344px, 1 column visible, and it is the *Shared* card, so zero funnels**; 1440 → 1; 1600 → 2; 1920 → 3.

**Constraint.** Both rails are owner-required (*"add in the left side all the available sections in draggable boxes"*; *"show them in the right side where we define rules"*). Narrow/collapse rails, reclaim board space, or narrow columns — choose and justify.
**End state.** At **1280**, at least two funnel columns fully visible; usable at 1440/1600/1920; no page-body overflow at 375.
**Acceptance.** Measured count of fully visible funnel columns at all four widths, before and after, with 4 funnels.

---

## 6. MAJOR — each stated as a full feature chain, not a symptom

### M1 — Progress: finish the element, not the five labels
The owner's complaint was *"three of the five options are identical … I chose 'icon on track' - where is the icon on track??? how do I define it????"*. Five styles now render distinctly, but the element is not coherent. Deliver it as one piece:

| Sub-issue | Measured now | Required |
|---|---|---|
| **Icon source** | 6 hardcoded glyphs, no custom option, while a Media library picker exists in the same file | The operator can pick a supplied icon **or** their own image via the existing media picker (S4) |
| **Icon control visibility** | Always rendered, for all five styles | Shown only when the chosen style uses it (S1 surface 1) |
| **Icon in the style picker thumbnail** | Not represented — `progress.icon` occurs once in `templates.ts` | The thumbnail reflects the chosen icon (S1 surface 4) |
| **Icon in the saved-template thumbnail** | `frame-handlers.ts:326` uses `style` only | Represented (S1 surface 5) |
| **Alignment** | Left/Center/Right → **one** render (`f6a154c23c0b`); `--align-*` sets `text-align` on a full-width block | Three visibly distinct results, or the control is removed |
| **Position** | "Under the header" == "Above the question unit" (`b5800cd2c4ba`) | Distinct, or one removed |
| **Show label on `numbered`** | ON vs OFF byte-identical (`b44f6019…`) | Visibly changes the render |
| **Label wording** | Help says `"Step 2 of 5"`, SSR emits `Step 1 of 2`, hydrated shows `1 / 2` | One consistent format across all three |

**Acceptance.** A five-style × per-option matrix with the measured painted value for every cell, live page and canvas, 1280 + 375, plus both thumbnail surfaces.

### M2 — Four more dead theme controls, and the guard that missed them
Owner's ruling: *"theme is only design language!!!! colors, fonts, sizes"*.

| Control | Set to | Measured |
|---|---|---|
| Button casing | `UPPERCASE` | Stylesheet **byte-identical** (63,963 both); answers keep `text-transform:none` |
| Card corners | `full` | `.lg-question-card` `border-radius` stays `16px`; only an unrelated disclosure modal changes |
| Card shadow | `xl` | `.lg-question-card` `box-shadow` unchanged |
| Shadows (scale) | `high` | Rewrites `--lg-shadow-*` only — **zero rules read `var(--lg-shadow`** |

**Careful:** grepping finds the identifiers (`text_transform` is computed at `designs/theme.ts:1285`; `card_defaults` appears outside `theme.ts`), but the **emitted stylesheet is unchanged**. Measure the painted output, never the grep.

**End state.** Each control governs a measurable painted value **or is removed from the UI**. A control that cannot be honoured must not be offered. **And extend the guard per S2** so the next one cannot ship dead.
**Acceptance.** Per control, per option value: painted value before and after on the live page; plus the extended guard failing on old code and passing on new.

### M3 — Template apply drops template values (see S3)
Fix generally, prove across logo, progress and background.

### M4 — There is no theme picker per funnel
**Owner (A.1 #11.C-D):** *"Theme picker per funnel name."* Every funnel's Theme chip calls `gotoTab('themes')` (`funnel.ts:4920`) with **no funnel identity**; the Themes panel `innerText` hash is identical from funnel 0 and funnel 1 (`4e44d22cbb94`); the tab has zero funnel selectors and its header names no funnel.

The **capability** exists (two funnels can serve two themes). Wire the **control**; do not rebuild the capability.
**Acceptance.** Two funnels themed via their own chips; prove stored themes differ and each live funnel paints its own (measure a font family and a colour); prove the panel names the funnel you arrived from.

### M5 — Address per-field "Autofill" needs a save+reload to become selectable
**Owner (A.1 #6):** *"the mapping of what is auto-filled per field should definatly be an option, I clearly defined it, but not in this poor way!!!!"*

With the Maps key present, the node toggle ON and all three jobs ticked, the per-field **Mode** select still offers only `Manual` and the help still says "turn it on in the Maps tab"; `Manual, Autofill` appears only after save + reload. Cause: `collectMapsToggle()` (`ui-section-studio.ts:8697-8718`) calls `populateMapsTab` but never `populateAddressFieldSet`; rows and `autofillAllowed` are built only at `:8182` / `:12225`.
**Acceptance.** One session, no reload: toggle Maps on, tick jobs, show `Autofill` selectable, choose it, save, prove the live page honours it.

### M6 — Section-studio save messages print spec text (see S5)
Fix per S5 and add the anti-regression check.
**Acceptance.** At least five real validation failures triggered through the UI with before/after banner text, plus proof no `(§` string can reach a user-visible surface.

### M7 — The studio canvas does not paint an authored default answer
**Owner (A.1 #1):** *"independent **defaults!!**"*. With `defaultValue:true` saved, the canvas renders Yes as `lg-btn lg-btn-answer`, background `rgb(255,255,255)`, `aria-checked="false"`; the live page renders it selected and blue.
**Acceptance.** Canvas and live side by side, measured class/background/`aria-checked` on both.

### M8 — The studio canvas shows text the visitor never sees, and a control that cannot work
Canvas dropdown options render as `Geico×`, `Allstate×`, `AUDITC Mutual×` — a delete affordance drawn **inside native `<option>` elements**, where it can never be clicked; selecting it changes nothing. Live correctly shows `Geico`.
**Acceptance.** Canvas vs live option text before/after; the delete affordance either works where it now lives or is gone from the canvas.

### M9 — Help text points at a screen the owner had deleted
`templates.ts:144` says *"open the Header region on the canvas (Funnel builder tab) → Advanced."* The Funnel builder has **no canvas** — the owner ordered it removed (*"kick out all the stupid and unusable components from the 'Funnel builder' - the canvas…"*) and "Advanced" there holds only a Reference id.
**Acceptance.** Old and new copy quoted; drive the path the new copy describes.

### M10 — Emptying a shared page leaves it live for visitors (see S6)

---

## 7. MINOR

Several of these are consequences of §4 — fix the cause, then confirm the symptom is gone.

| ID | Issue | Location / evidence |
|---|---|---|
| N1 | Raw internal tokens as visible labels: Button corners `sm/md/lg/xl/full`; Card corners/shadow the same; Base visual design `default` / `default-funnel` | Themes rail, funnel settings |
| N2 | Rules help exposes operator ids: *"Operators map to eq · neq · gt · lt · gte · lte."* | `ui-rules-builder.ts:2206` |
| N3 | Rule summary shows the raw DB field id: *"Answer: … · **r2fix_carrier** is …"*. The owner rejected this shape as `is excellent_rvw7q3`; the **value** side was fixed, the **field id** side was not | `ui-rules-builder.ts` |
| N4 | Rule Checkpoint shows zero-based *"— page 0"* while the board says "PAGE 1" | `ui-rules-builder.ts:1966` |
| N5 | A/B copy exposes storage internals: *"stored as basis points, per-test Σ == 10000"* | `ab.ts:157` |
| N6 | Every added funnel is named **"New funnel"** → identical rows in the blocker banner and identical options in the rule target select | `funnel.ts:4124` |
| N7 | Themes selects truncate their own default label to *"Inherit from base de⌄"* | Themes rail |
| N8 | "Create A/B test" reloads to the Funnel builder with no confirmation (the test *is* created) | A/B tab |
| N9 | Element letters skip **G**: `A B C D E F H I J`. The footer moved to J per A.2 while `I` is pinned to Progress by A.1 #11.D; nine tiles cannot fill ten letters. **Decide deliberately and make the result read sensibly on screen** — the owner noticed the gap | `templates.ts:765-771` |
| N10 | New Quote page says *"A funnel + **control** variant are created automatically"* while A/B says *"Equal arms; no control"* and the owner wrote *"there is no 'control' funnel!!!"* | new-quote page |
| N11 | Themes preset select says *"No presets yet — create one below"*; creation is only in the Themes manager, nothing is below | Themes tab |
| N12 | "Apply to this funnel" / "A/B this theme" enabled with zero presets | Themes tab |
| N13 | Logo Alignment offers Left/Center only; progress Alignment offers Left/Center/Right | element B |
| N14 | Renaming the seeded first "Other" choice leaves its stored value `other_option`, so the buyer receives the placeholder; the second row derives correctly | Other editor → provider payload |
| N15 | Radial slider's first tap mis-registers (`input.focus()` before `dialTo()`, `engine.ts:1170-1173`; scroll 164→180; 45° press records 15, expected 13); later presses exact | live visitor |
| N16 | Payload-builder **sample chip** shows the same value for 3 of 4 output formats (`170000` → `170000`, `$170,000`, `170000`, `170000`). The JSON preview and the real payload are correct — only the chip misleads | payload builder |
| N17 | `dual_range` renders as a `from_to` clone minus the boxes, value pills **above** the track; the owner's **Image11** puts values **under** the handles — open the image | compare `images/Image11.png` |
| N18 | Studio polish: selection badges occlude grid question 1's label; `pageerror: Failed to execute 'removeChild'` during grid authoring; inspector titles Phone and Address as *"Editing: Short text field"*; banner grammar *"1 field need attention"*; a slider's `aria-label` reads the raw field id `field_msc2ulic_jwzg` to screen readers | section studio |
| N19 | The owner's A.2 lists *"free text (rich toolbar)"* and *"company details"* as separate things; the product merges them into one block | element J |

---

## 8. Already fixed at this HEAD — do not re-report or re-break

Dead funnel Preview button · footer font/size emptying the footer · site logo collapsing to alt text on the **Templates** canvas (Themes is still B1) · `icon_on_track` rendering as a plain bar · `percent` identical to `bar` · five identical picker thumbnails · 63 clause-reference strings in `src/admin/leadgen/**` · rules rail printing raw choice **values** (field **ids** remain, N3) · dead controls for theme corners, button size, field height, per-logo size · publish-blocker reasons naming themselves and targeting the fixing control · the dead canvas island firing wasted requests.

---

## 9. Owner decides — surface, do not act

1. **The shared-page publish gate** (`quotes-handlers.ts:5934`). Driven proof: the runtime **skips** an empty shared page — the visitor sees the funnel's first real section, no blank screen (`sections=1`). No R2 clause requires it non-empty; the rule predates R2. **Recommend relaxing; do not relax without the owner's word** — it gates a money path.
2. **Image29 / Image30 / Image31** — the owner named five footer examples; only Image28 and Image45 were built.
3. **Footer colours** are references into the main palette, so re-theming moves them, against A.2's *"different color … then the main template"*.
4. **`percent` shows its number only when "Show label" is on.** Always-on touches `advanceFrameProgress`, whose `from`/`to` swap is gated on `show_label` — a naive change silently breaks the preview's per-step advance.

---

## 10. Definition of done

1. Every item in §4, §5, §6 and §7 is **fixed and driven**, or **reported with evidence for why not**. No silent omissions.
2. For every control touched: the **five-surface table** from S1, each surface measured.
3. Reproduction before, measurement after, screenshots 1280 + 375 for anything visual.
4. `npm test` green **by count** from an explicit `cd .../api`, at or above **7662 passed / 0 failed**; state the arithmetic for any retired test, and a retired test must name in-file what now covers its claim.
5. `npm run typecheck` 0 · `npm run verify:all` 0.
6. `LEADGEN_RUNTIME_JS_BYTES` ≤ **53,248**. If a fix would exceed it, **stop and report** — never simplify below what the owner asked for.
7. **No assertion weakened.** State before/after for every test touched.
8. The S2 guard extended and passing; the S5 copy check in place.
9. No new gates or validators beyond what an item explicitly requires (§1).
10. Nothing deployed, no secrets touched, no `--remote` D1 writes.
