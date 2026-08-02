# LeadGen R2 — P8 Defect Contract (v3, measured)

**For an external agent with no prior context. Read §0–§3 before touching anything.**

Repo `kodigital-homepages-cms` (TypeScript Cloudflare Worker + D1).
Worktree `/Users/guyhaikov/a2z-workspaces/kodigital-cms-leadgen-r2-wt`, branch `reconcile/conversions-x-leadgen-r2`, HEAD **`e24bfae`**.
Baseline: `npm test` **7662 passed / 0 failed / 30 skipped (471 files)** · `typecheck` 0 · `verify:all` 0 · `LEADGEN_RUNTIME_JS_BYTES` **52,762** of a **53,248** cap.

> **Provenance.** v1 listed symptoms. v2 generalised from a single worked example. v3 is written from three independent driven roasts that operated the product and measured every claim. **Several v1/v2 statements were falsified and are corrected here** — where this file contradicts an earlier note, this file is right. Every number below was measured, not inferred.

---

## 0. The product, and who decides

A CMS for lead-generation funnels. An **operator** authors funnels in an admin UI; a **visitor** walks the funnel; answers post to an auction that pays **buyers**. Money moves on the visitor and payload paths.

The owner's verbatim words at `docs/leadgen/source-of-truth/SOURCE-OF-TRUTH.md` are the **only** acceptance authority. Quote them; never paraphrase. Design pins are in `docs/leadgen/source-of-truth/images/` — **open the image**, do not infer it.

> **On the owner's tone.** Their feedback is blunt and often emphatic (*"totally disaster"*, *"this is poorly designed"*, strings of exclamation marks). It is product criticism of a **software build**, never directed at any person, and it is preserved word-for-word because the exact wording is what each fix must satisfy. Read it as a precise specification written in frustration, not as hostility. Quoting it in your report is expected and correct.

A previous build shipped with 6,900 green tests and was rejected in use. **Assume a passing test proves nothing about what a human sees.**

---

## 1. Scope boundary — no hardening

**Fix the source of a defect. Do not add gates, guards, validators or blockers no clause asks for.** A proposed activation blocker was already rejected by the owner as unnecessary hardening.

**DO NOT:** add preflight/activation blockers or save-time validation; auto-insert content the operator did not author; broaden a fix into a refactor; "improve" anything unlisted.

**Out of scope — leave exactly as found:**
- A grid section with `continue_mode='button'` and no authored `ContinueButton` renders no advance control (`presets.ts` `planContinueRender` ~:4831). **Owner: an unfinished funnel is unfinished.**
- The `caches.default` 300s staleness (`invalidateOnVariantPublish` clears KV but not the Cache API, which the read path checks first). Registered, owner-referred. **Note R2-2 below is a *different* bug that unique cache-busting does not defeat — that one IS in scope.**
- Frozen visual suites `leadgen-visual`, `leadgen-v31-gate1c-baselines`. **Do not rebaseline.**
- The hand-listed `sliceIslandVar` manifests in `leadgen-p2-tail` / `leadgen-p2-fixfirst-r2`. Update the manifest; do not redesign.

If a fix seems to need hardening, **STOP and report**.

---

## 2. Environment — get this right or every result is false

```bash
cd /Users/guyhaikov/a2z-workspaces/kodigital-cms-leadgen-r2-wt/api
npm ci
npm run db:reset:local
npx wrangler dev --port 8901 --ip 127.0.0.1 --var DEV_BYPASS_AUTH:true --var ADMIN_HOST:127.0.0.1
npm run seed:leadgen-fixture      # honours LG_BASE, default http://127.0.0.1:8901
```

> **About the local dev values below.** `api/.dev.vars` holds **local-only development dummies** for a worker running on your own machine — it is gitignored so that placeholders never enter version control, and it contains **no production credential**. `DEV_BYPASS_AUTH` is a local development flag that stands in for the SSO layer that fronts the real admin; it exists only in this local harness. Production secrets live in the Cloudflare dashboard, are never readable from here, and are never touched by this work (see the prohibitions at the end of this section).

- **`api/.dev.vars` must exist.** Without the local `LEADGEN_CONFIG_SIGNING_KEY` placeholder, the worker cannot verify its own request signatures, so every `POST /lg/auction` fails closed with `422` and its quality flag set — and you will misdiagnose the whole product. **Copy the file into any new worktree** — omitting it produced a false "every visitor is broken" blocker in a previous round. It ships `GOOGLE_MAPS_BROWSER_KEY` **empty**; supply a Maps browser key of your own when driving R1-1, and do not commit it.
- Admin answers on **`127.0.0.1`**, not `localhost` (`playwright.config.ts:281` overrides the toml).
- **Never bind 8787** (another project). Playwright's config may try — use standalone browser scripts.
- Restart wrangler after **any** `db:reset:local`.
- **Never** `wrangler d1 execute --local` against a live `wrangler dev` — corrupts local D1.
- Visitor shell is cached `max-age=300`: always `?_cb=<ts>` **and** re-save the activation.

**Prohibited, without exception — these are the owner's alone:**
- **Never** `wrangler deploy` (any environment). Deployment is triggered only by the owner.
- **Never** `wrangler secret put` or `wrangler secret delete`, and never read, print, copy or commit a production secret.
- **Never** any `--remote` D1 command — no reads and no writes against the production database.
- Never mutate production data by any other route, and never change a DNS route, zone or binding.
All work in this contract is done against the **local** worker on your own machine. If a defect appears to need one of the above to diagnose, **stop and report it** rather than reaching for it.

**Evidence standard.** Screenshots at **1280 and 375**. Every "works now" claim is a **measured painted value** — computed style, bounding box, DB row, provider-log row, or an intercepted network call. **A changed CSS byte is not proof** (three controls below change bytes and paint nothing visible). Artifacts → `docs/leadgen/r2/evidence/p8/<id>/`.

---

## 3. Test-suite hazards

| Hazard | Behaviour | Handling |
|---|---|---|
| `leadgen-p3a-split-parity.test.ts` | Byte-pins the admin editor page; **any** admin markup change trips it | Recapture via `src/scripts/capture-p3a-presplit.ts`: snapshot, classify **every** differing line, sha256-prove untouched fixtures. One unexplained line → stop |
| `leadgen-p2-tail`, `leadgen-p2-fixfirst-r2` | Rebuild an island from a hand-listed var manifest; a new/removed var → bare `ReferenceError` | Update the manifest |
| `LEADGEN_PIN_UPDATE=1` in `leadgen-section-preview-frame.test.ts` | Broken — mints raw, compares normalised; two mints in one run cross-contaminate | Mint one at a time, verify by hand |
| `leadgen-r2-dead-controls-guard.test.ts` | Existing guard. **Covers 3 of 80 keys and uses the wrong predicate — see R3** | Extend and re-base it; never weaken |

---

## 4. ROOT CAUSES

### R1 — Producer and consumer disagree on a shape, so a whole feature is silently dead
Two sides of one feature are written to different contracts. Nothing errors; the feature simply never runs.

**R1-1 — Address autocomplete is dead on the default rendering (BLOCKER).**
`renderAddressFieldSet` (`presets.ts:3336`) emits nested `data-lg-maps='{"enabled":true,"jobs":{"autocomplete":true,…}}'`. `parseMapsConfig` (`runtime/maps.ts:60`) reads only **flat** `enable_autocomplete` / `autocomplete`, returns `autocomplete:false`, and `initMapsFields:151` `continue`s. Driven with a real key: the Google SDK request fires, `placesCtorPresent:true`, **`Autocomplete` constructor calls = 0**. Every address funnel also pays a wasted Maps JS load. A lone `full_address` field works, because that branch emits the flat keys.
This is the owner's *"if I want to auto fill only for street address and city"* — dead on the multi-field default (D3), alive only on the single-field case.

**R1-2 — The funnel Preview button (already fixed; the pattern is the lesson).** The client read `res.body.html || res.body.preview_html`; the endpoint returns `{preview:{…}}`. A 200 was rendered as *"Something went wrong."*

**Requirement.** For every producer→consumer pair you touch, prove the shapes agree **by driving the consumer**, not by reading the producer. Where a wire shape has two readers (nested vs flat), converge them on one and delete the other.

### R2 — An authored value never reaches the live page
**R2-1 — Applying a saved template changes nothing but an id.** `apply-template` writes only a `frame_template_id` pointer. Measured on a funnel that has ever been saved: **45 of 46 comparable leaves shadowed**, across all nine element groups (header 11, progress 6, back 4, disclosure 4, footer 7, trust_strip 2, benefit_bar 2, background 2, section_slot 7). The single honoured leaf is the identity string no CSS reads. A never-touched funnel: 53/53 honoured. A second roast independently measured **9 of 10 lost** across three groups.
Two further lies on the same screen: the confirm dialog **enumerates specific changes and all four were false** (verbatim: *"The question unit changes from a card to a bare layout." / "A trust strip will be added." / "A benefit bar will be added." / "Progress style changes from numbered to dots."* — `templates.ts:2157-2176`; measured after apply: card, trust off, benefit off, numbered). And **A/B templates renders byte-identical arms** (5,408 chars, every axis equal, `templates.ts:2250-2330`) — that test can never produce a result.

**R2-2 — A theme-record edit never invalidates the funnel's served config (BLOCKER).**
`PATCH /themes/<id>` changing `brand_primary` left the live sheet at sha `c76a651e289d` with a value **two edits stale**, across **unique `?_cb=` URLs**, until an unrelated activation PUT flushed it. `putFunnelThemeHandler` calls `bumpActiveVariantContentVersions`; the theme-record PATCH path does not. **This is not the out-of-scope Cache-API issue — unique cache-busted URLs do not defeat it.**
**Consequence for whoever works here: all 25 ThemeRecord keys are UNVERIFIED, not proven.** Direct re-verification confirmed `controls.field_height` (44→60px), `controls.corners` (card 10→20px, button 6→14px) and `controls.button_size` (52→60px) alive; a fourth key returned provably stale bytes. **Fix R2-2 first, then re-verify the rest** — otherwise every measurement in that area is unreliable.

### R3 — Dead and mis-targeted design controls, and a guard that cannot see them
**80 authorable keys inventoried** (34 inline `theme_json`, 25 `ThemeRecord`, 21 frame-config). Of the 34 fully measured: **28 complete, 4 dead, 2 partial**.

| Key | Measured |
|---|---|
| `button_defaults.casing` (`themes.ts:208`) | **DEAD** — none vs upper emit a byte-identical sheet (`21e27f24f4ae` both); `.lg-continue` and `.lg-btn-answer` stay `text-transform:none` |
| `card_defaults.shadow` (`:226`) | **DEAD** — all five values emit one identical sheet; `.lg-question-card` box-shadow fixed |
| `card_defaults.radius` (`:225`) | **MIS-TARGETED** — CSS changes, but the only selector is `.lg-frame-disclosure--modal .lg-disclosure-panel` (measured `_vis:false`, 0×0). `.lg-question-card` stays 16px at every value |
| `card_defaults.border_role` (`:223`) | **MIS-TARGETED** — only `.lg-card-panel`, which no driven page renders |
| `card_defaults.background_role` | **MIS-TARGETED** — the sole painted effect is `input.lg-input` background. "Card background" repaints the **text input** |
| `scales.shadow` (`:200`) | **PARTIAL** — zero painted diffs on default surfaces; reaches only the hidden modal panel and the `icon_on_track` fill `::after` |

**Correction to an earlier note:** the stated cause "nothing reads `var(--lg-shadow`" is wrong — that string occurs **0 times** in the emitted sheet; the resolver rewrites **literal** `box-shadow` declarations.

**The guard is the deeper defect.** `leadgen-r2-dead-controls-guard.test.ts` enumerates exactly two interfaces (`ThemeRecordControls`, 3 keys, and `FrameBrandLogoItem`) — **3 of 80 keys**, blind to all 34 inline `ThemeJson` keys, which is precisely where all four dead controls live. **And its predicate is wrong:** it asserts "flipping the key changes the stylesheet/markup bytes", so `card_defaults.radius`, `card_defaults.border_role` and `scales.shadow` would **pass** even after you extend the key list. The predicate must assert a **visible element's computed value changes**.

**Requirement.** Every one of the 80 keys either governs a measurable painted value on a **visible** element, or is **removed from the UI**. A control that cannot be honoured must not be offered. Extend the guard to enumerate `ThemeJson` + its 6 sub-interfaces, `ThemeRecord`'s other 5 members, and the FrameConfig groups — with the visible-computed-value predicate. Empty allowlist; any exemption needs an in-code reason.

**Surface note (corrects v2).** v2 demanded five surfaces for every control. Measured: `frameTemplateThumbnailHtml` (`frame-handlers.ts:318-340`) reads only `disclosure`, `header.logo_align`, `progress.style`, `section_slot.card`, `trust_strip`, `footer`, `background.style`, and the theme-preset picker is a bare `<select>` with no thumbnail — so **for all 59 theme keys the picker and saved-template thumbnails do not exist**. Demand them only for frame keys that already have them (progress style is the live case). Do not chase absent surfaces.

### R4 — The studio canvas is not a faithful preview
The owner's standard: *"the canvas should include one section in the middle so the user could see a real reference of how is design is gonna look like in real life"*. Measured on the same section at the same moment:

| Aspect | Canvas | Live |
|---|---|---|
| Authored default (`defaultValue:true`) | `lg-btn lg-btn-answer`, `rgb(255,255,255)`, `aria-checked=false` | `lg-selected`, `rgb(232,238,244)`, `aria-checked=true` |
| Dropdown option text | `ROASTC Geico×` | `ROASTC Geico` |
| "Other" hidden-select option | `Other×` | `Other` |
| Dependency-hidden question | always painted | painted only when the trigger is true |
| Injected editor chrome | `Yes / No` badge, 2× `+ Add choice`, `Searchable dropdown` badge, `Short text field` badge on an Address, `fills: city` chip | none |
| Address attrs, slider value/position, currency affix, phone/date/email | identical | identical — **these are correct, leave them** |

### R5 — Internal prose in operator copy, and a humanizer that invents field names
**Counts (corrects v1/v2's "119"):** **79** `(§` message literals in `content-schema.ts` (129 raw including comments) **plus 10 in `src/leadgen/sections.ts`** that no earlier note named — proven live on the real save route: `design_overrides.buttonBackground must be a fixed token value, not arbitrary CSS (§14.10)`. All 89 are `push()` message args, all reach `fields{}`, all reach the banner.

Driven examples: `choice.Analytics Id is required (§22 tracking)` (the operator's column reads "Analytics **ID**"); `maps.enabled is true but no job (validate/auction/autocomplete) is selected — it does nothing at runtime (§9.3)`; `duplicate Internal Field 'Ks Nm' (§8.5 unique across the Section)`; live grammar `1 field need attention`.

**Worse than leakage:** `humanizeFieldMessage` (`ui-section-studio.ts:16453`) **Title-Cases the quoted value** — the real field is `ks_nm`, the operator is told `'Ks Nm'`, **a field that does not exist**. And the warning path `renderSaveProblems:16386` applies **no** humanization at all. Messages also never name the question or the choice row, so two identical lines appear for two different rows.

**The operator-language version already exists.** For the identical Maps condition the publish blocker says *"'ROASTC Kitchen Sink' has a Maps-enabled field with no job selected … Pick a job or turn Maps off"*. **Reuse that register of language; do not invent new copy.**

### R6 — Identity loss and wrong-target writes
**R6-1 — A theme edit from one funnel's chip writes to a different funnel (BLOCKER).** Clicking **ROAST-Charlie's** Theme chip and editing Brand primary issued `PUT /funnels/lgf_…C3/theme` — **Funnel A**. After: A `#142c45`, Charlie `null`, no status message. The Themes island's only funnel source is `#lg-quote-editor[data-funnel-public-id]` (`themes.ts:366`, write target `:666`) — the editor's *selected* funnel. The **capability** is proven end to end (Funnel A paints `--lg-primary:#142c45` live while three siblings paint `#1B3A5C`; storage is `leadgen_funnels.theme_json`) — only the control is wrong. **The same identity loss is on the funnel column's Template chip** (`funnel.ts:5105`, `:5110`, both bare `gotoTab`), and the Theme chip is a static literal `"Theme"` (`funnel.ts:447`) that never names the funnel's current theme.

**R6-2 — The `fills` picker renames a sub-field's own key and can collide.** Picking `roastc_note` produced **two inputs on one page with `data-lg-field="roastc_note"`** — one answer key, two sources, no warning. The picker deliberately offers exactly the siblings that collide.

**R6-3 — Renaming any choice leaves its stored value and analytics id stale (product-wide).** `data-auto` is set from "value already populated" in **both** `buildChoiceRow` (`:11865`) and `buildOtherValueRow` (`:12007`). Driven: label → `ROASTC My own reason`, stored `value:"other_option"`, `analytics_id:"rc_other"`. The buyer receives the placeholder. **Not Other-specific.**

**R6-4 — An unconfigured address destroys its own defaults.** The renderer's default is 4× `mode:"autofill"`; the studio shows 4× **Manual** (the option is withheld with no `props.maps`). Ticking one unrelated *Required* box materialised `props.fields` with `mode:"manual"` on **all four** — measured in the stored row. Silent, irreversible.

### R7 — Hardcoded option sets where the product already has an authoring path
`FRAME_PROGRESS_ICONS` — 6 glyphs (`frames.ts:63`), no custom option, while `mediaPickerControl` / `mediaFieldMarkup` are used **four times in the same file** (`templates.ts:143`, `:354`, `:519`, `:598`). The owner asked *"how do I define it????"*.
Also enum-locked with no authoring path: `FRAME_TRUST_SOURCES`, `FRAME_BENEFIT_PLACEMENTS`, `FRAME_BACKGROUND_STYLES`, `FRAME_BRAND_LOGO_LAYOUTS`; `FrameBenefitItem.icon` is a free string with no picker. **Validation per address field** offers None / ZIP-5 only while `runtime/validation.ts:393` already supports `{regex,message}` — a reduced model of a capability that exists.

---

## 5. BLOCKING

**B1 — Address autocomplete dead on the default rendering.** R1-1. *Acceptance:* on a driven multi-field address page with a real Maps key, the `Autocomplete` constructor is invoked ≥1 (intercept it), typing produces suggestions, and choosing one fills the mapped fields. Plus: no Maps JS is loaded when no job is enabled.

**B2 — Theme edits never reach the live page.** R2-2. *Acceptance:* `PATCH` a theme record, then load the live page with a fresh `?_cb=` and see the new value **without** any activation save. Then re-verify the ThemeRecord keys that were unverifiable before, and report which were actually alive.

**B3 — A theme edit writes to the wrong funnel.** R6-1. *Acceptance:* from funnel C's chip, change a colour; prove funnel C changed and funnels A/B/D did not, in storage **and** on their live pages. Same for the Template chip.

**B4 — The Themes canvas renders no frame, and has no site picker.** Measured: on a funnel whose `frame_config_json` is NULL the Themes endpoint takes `renderLegacyShell` and emits **no frame at all** — regions `[]` vs Templates' `[background, logo, progress, section_slot, back, footer]`, CSS 31,891 vs 68,496 bytes. **Adding `site_id` alone changes the render by 0 bytes — the v1/v2 cause was wrong.** The two canvases call **different endpoints** (Templates `POST /variants/:id/preview` `templates.ts:1256-1271`; Themes `POST /sections/preview` `themes.ts:559-565`) and their bodies differ in **four** fields: `site_id`, `draft_frame_config`, section source, `sample_section`. There is **no site picker on the Themes tab** (`grep -c site themes.ts` → 0); the page-level `#lg-site-select` (`ui-quotes.ts:730`) has no Themes listener, so changing site fires **0** Themes re-renders. The Themes footer renders empty while Templates paints Contact / Privacy / Terms, and Themes has **no broken-logo watcher** (`watchCanvasLogo` 9 hits in templates.ts, 0 in themes.ts).
*Acceptance:* choosing a site on Themes re-renders that canvas with the site's logo, branding and footer, matching Templates for the same site and moment; a dead media row shows the honest chip there too.

**B5 — Funnels cannot be seen side by side, and drag cannot reach an off-screen column.** Owner: *"in the middle create different funnels side by side and drag sections boxes to the page of the wanted funnle"* / *"how he can see them side by side?"*
Measured with 4 funnels — **fully visible funnel columns: 1280 → 0, 1440 → 0, 1600 → 1, 1920 → 2, 375 → 0** (v1/v2's 1/1/2/3 were each off by one). `.lg-col-shared{position:sticky;left:0}` (`shared.ts:704`) is **dead** — x measured 583 → 407 → 7 → −393 → −825 as scroll rises, while `funnel.ts:4259` comments that it "is pinned and never scrolls". There is **no auto-scroll** during drag (`scrollLeft` unchanged after 1.5s at the edge; no `scrollBy`/`scrollLeft=` in funnel.ts) and `dropTargetUnder` is `document.elementFromPoint` (`funnel.ts:4889`), so an off-screen column cannot receive a drop; aiming at one is a **silent no-op** — no highlight, no message. No scrollbar (`offsetHeight−clientHeight = 0`), no arrows, no hint; rails are **not** collapsible (only a `max-width:1100px` stack, `shared.ts:786`). **Zero `touchstart`/`pointerdown` handlers → no touch drag at all.** Keyboard Enter/Space on a library card always targets the **default** funnel (`funnel.ts:5133-5139`).
*Acceptance:* at 1280 at least two funnel columns fully visible with 4 funnels; a section can be dragged into every column including ones requiring scroll (auto-scroll or an equivalent), or the attempt gives a visible reason; the shared column is genuinely pinned or the false comment is corrected; state the keyboard and touch position explicitly. Rails stay — both are owner-required.

---

## 6. MAJOR

**M1 — Progress, as one coherent element.** Icon source must accept a custom image via the existing media picker (R7), not six glyphs. The "Marker icon" select (`templates.ts:728`) renders for all five styles — show it only for `icon_on_track`. `progress.icon` occurs **once** in `templates.ts`, so it reaches neither the style-picker thumbnail nor the saved-template thumbnail (`frame-handlers.ts:326` uses `style` alone) — these two surfaces **do** exist for progress, so wire them. Alignment Left/Center/Right → **one** render (`f6a154c23c0b`). Position "Under the header" == "Above the question unit" (`b5800cd2c4ba`). "Show label" on `numbered` → byte-identical ON vs OFF (`b44f6019…`). Label wording differs three ways: help says `"Step 2 of 5"`, SSR emits `Step 1 of 2`, hydrated shows `1 / 2`.

**M2 — The 80-key sweep and the guard.** R3. Every dead/mis-targeted key honoured or removed; guard extended **and re-predicated**.

**M3 — Template apply.** R2-1. Fix generally; prove across three element groups; make the confirm dialog's enumerated promises true or stop making them; fix A/B templates so the arms differ.

**M4 — Address, whole feature.** Beyond B1: the studio shows Manual for an autofill default and any row edit persists `mode:manual` on all four fields (R6-4); `fills` collides keys (R6-2); validation is None/ZIP-5 while the runtime supports custom regex (R7); copy leaks `full_address, manual` and says "from the ZIP" on an Address node. The Maps **validate** and **auction** jobs are wired (`sections-handlers.ts:2836`; `deriveAuctionFacet` → `serve-auction.ts:305`) — leave them.

**M5 — Save messages.** R5. Fix `content-schema.ts` **and** `sections.ts`; fix `humanizeFieldMessage` so it never prints a field name that does not exist; humanize the warning path too; name the question/choice row; reuse the publish-blocker register of language; add a check so no `(§` string can reach a user-visible surface.

**M6 — Canvas parity.** R4. Remove injected chrome from the canvas, honour dependency visibility and authored defaults. Leave the aspects already at parity.

**M7 — Editor chrome inside `<option>` elements.** `decorateChoiceCards` (`ui-section-studio.ts:6647-6666`) appends `<span class="studio-choice-x">` to every `[data-lg-choice]`; **three** renderers put that attribute on a native `<option>`: `DropdownQuestion` (`presets.ts:1932`), `SearchableDropdownQuestion` (`:1988`) and — unlisted before — `otherSelectMarkup` (`:467`), inside a **hidden** select. Measured: all five option-borne × are `0×0`, `clickable:false`. `+ Add choice` ghosts also render for dropdowns.

**M8 — Emptying a shared page leaves it live for visitors.** `PUT /quotes/:id/shared-page {slots:[]}` removes the slot but leaves an orphan `leadgen_funnel_variant_sections` row (`slot_id=NULL`); the admin reports `sections: []` while the resolver's by-`page_id` fallback still serves it (measured: 2 sections after the "emptying" PUT, 1 after deleting the orphan). Check the sibling delete paths (page, funnel) for the same fallback.

**M9 — Stale copy naming things that no longer exist** (verbatim, corrected line numbers):
1. `templates.ts:156` (**not** :144) — *"For a manual logo override, open the Header region on the canvas (Funnel builder tab) → Advanced."* — that canvas was deleted at the owner's request.
2. `activation.ts:32` + `funnel.ts:1084` — *"Review slide"* on every `/sections/` fix link, **confirmed live** in the publish blocker. The product has no slides.
3. `shared.ts:423` — `PROBLEM_SCOPE_LABELS.section = "Slides"`.
4. `funnel.ts:3474` — *"No presets yet — create one below"*; nothing is below.
5. `templates.ts:1878` — *"No themes yet — create one in the Themes tab"*, **confirmed live**, contradicted by the Themes tab's own *"…from the Themes manager…"*.

**M10 — Saved templates have no thumbnail at all.** `frameTemplateThumbnailHtml` (`frame-handlers.ts:319`) accepts only built-in `FrameTemplateDef`s and its `thumbnail_html` has **no consumer** in the admin UI; saved templates get a 3-key text pill with raw enums (`"Bare layout · dots progress"`, `templates.ts:1938`). The board's Template chip is a dead label — `templateLabelFor` (`funnel.ts:409-417`) matches a numeric DB `frame_template_id` against string registry ids, so it reads `"Template"` forever.

---

## 7. MINOR

| ID | Issue (measured) |
|---|---|
| N1 | Raw tokens as visible labels: `Button corners [sm\|md\|lg\|xl\|full]`, `Card corners [same]`, `Card shadow [none\|sm\|md\|lg\|xl]`, Base visual design `default` / `default-funnel` |
| N2 | Live: *"…Operators map to eq · neq · gt · lt · gte · lte."* (`ui-rules-builder.ts:2206`) |
| N3 | `fieldLabel()` (`:2455`) falls back to the **raw id** whenever a field is absent from `entryFields`/`answerFields` — a generic fallback, not one label |
| N4 | Zero-based *"— page 0"* vs the board's "PAGE 1", at **two** sites: SSR `:1966` and island `:2450` — both must change or SSR and hydration disagree |
| N5 | Live: *"(must sum to 100%; stored as basis points, per-test Σ == 10000)"* (`ab.ts:157`) |
| N6 | Every funnel is named `New funnel` (`funnel.ts:4124`) — confirmed live in both the columns and the rule Target-funnel select |
| N7 | Themes selects truncate their own default to *"Inherit from base de⌄"* |
| N8 | "Create A/B test" reloads to the Funnel builder with no confirmation (the test *is* created) |
| N9 | Element letters skip **G**: `A B C D E F H I J`. A.2 pins the footer to J, A.1 #11.D pins Progress to I; nine tiles cannot fill ten letters. Decide deliberately and make it read sensibly — the owner noticed |
| N10 | New Quote says *"A funnel + **control** variant are created automatically"*; A/B says *"Equal arms; no control"*; the owner wrote *"there is no 'control' funnel!!!"* |
| N11 | "Apply to this funnel" / "A/B this theme" enabled with zero presets, while help says *"Presets are shared across every funnel."* |
| N12 | Logo Alignment offers Left/Center; progress Alignment offers Left/Center/Right |
| N13 | Payload-builder **sample chip** uses `String(out)` while the sibling chip 3 lines later uses `outputFormatJsonLiteral` — the misleading one is the chip labelled "Output preview". One-call fix |
| N14 | Radial slider's first tap mis-registers — `input.focus()` before `dialTo(ev)` (`engine.ts:1169-1171`); reported 45° press records 15, expected 13. **Source-confirmed, not driven — UNVERIFIED** |
| N15 | `dual_range` pills measured `y=1332 h=23`, track `y=1370` — **15px above** the track; the owner's **Image11** puts values **under** the handles. Values are also duplicated (pills `$0 \| $1,000`, end labels `$0 \| $1,000`). **Open the image** |
| N16 | Studio polish: selection badges occlude grid question 1's label; `pageerror: Failed to execute 'removeChild'` during grid authoring; inspector titles Phone and Address as *"Editing: Short text field"*; `1 field need attention`; a slider's `aria-label` reads the raw field id to screen readers |
| N17 | A.2 lists *"free text (rich toolbar)"* and *"company details"* as separate things; the product merges them |
| N18 | `typography.display_size` bleeds into the header logo — scales `.lg-frame-header--logo-m .lg-logo` 1.1rem→2.53rem while leaving `-s` and `-l` untouched |
| N19 | A-4 uniqueness rejects a shared-page section from an **empty** funnel with *"'X' is already in this funnel"* and field key `sections.1` (`quotes-handlers.ts:2327`) — the rule is sanctioned, the wording and index are not |
| N20 | Two disjoint font vocabularies: the rail offers Literata/Sora/System…, the manager offers Newsreader/Inter/Roboto Mono… |

---

## 8. Already fixed at this HEAD — do not re-report or re-break

Dead funnel Preview button · footer font/size emptying the footer · site logo collapsing to alt text on the **Templates** canvas (Themes is B4) · `icon_on_track` rendering as a plain bar · `percent` identical to `bar` · five identical picker thumbnails · 63 clause strings in `src/admin/leadgen/**` · rules rail printing raw choice **values** (field **ids** remain, N3) · dead controls for theme corners, button size, field height, per-logo size · publish-blocker reasons naming themselves and targeting the fixing control · the dead canvas island's wasted requests.

---

## 9. Owner decides — surface, do not act

1. **The shared-page publish gate** (`quotes-handlers.ts:5934`). Driven: the runtime **skips** an empty shared page — no blank screen (`sections=1`). No R2 clause requires it non-empty; the rule predates R2. **Recommend relaxing; do not touch it** — it gates a money path.
2. **Image29 / Image30 / Image31** — five footer examples named, two built.
3. **Footer colours** are palette role references, so re-theming moves them, against A.2's *"different color … then the main template"*.
4. **`percent` shows its number only with "Show label" on.** Always-on touches `advanceFrameProgress`, whose `from`/`to` swap is gated on `show_label`; a naive change silently breaks the preview's per-step advance.

---

## 10. Definition of done

1. Every item in §4–§7 **fixed and driven**, or **reported with evidence for why not**. No silent omissions.
2. **Fix R2-2 (B2) first.** Until theme edits reach the live page, measurements in that area are unreliable and the 25 ThemeRecord keys stay unverified.
3. Per control touched: which surfaces apply (see the R3 surface note — do not chase absent ones), each measured.
4. Reproduction before, measurement after, screenshots 1280 + 375 for anything visual.
5. `npm test` green **by count** from an explicit `cd .../api`, at or above **7662 passed / 0 failed**; state the arithmetic for any retired test, and a retired test must name in-file what now covers its claim.
6. `npm run typecheck` 0 · `npm run verify:all` 0.
7. `LEADGEN_RUNTIME_JS_BYTES` ≤ **53,248**. If a fix would exceed it, **stop and report** — never simplify below what the owner asked for.
8. **No assertion weakened.** State before/after for every test touched.
9. The R3 guard extended **and re-predicated** to a visible computed value; the R5 copy check in place.
10. No new gates or validators beyond what an item requires (§1). Nothing deployed, no secrets touched, no `--remote` D1 writes.
