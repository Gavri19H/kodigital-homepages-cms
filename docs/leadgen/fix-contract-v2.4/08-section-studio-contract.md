# 08 · Section Studio Contract (Phase 4 · E1–E9)

**Scope:** rebuild the Section authoring EDITOR LAYER around visual pickers, canvas, tailored inspectors, and mapping panels. **Preserve untouched:** `leadgen_sections`, `leadgen_section_available_offers`, `leadgen_section_answer_maps`, `content_json` model, derived-index rebuild-on-save (`sections-handlers.ts:537–558,686–734,852–906`), `POST /sections/:id/validate-payload`, preview endpoint architecture, component registry, server presets. **Rebuild:** `ui-question-builder.ts` → new `admin/leadgen/ui-section-studio.ts` (+ `ui-sections.ts` editor fields), component picker, canvas, inspector, mapping grid inputs, preview controls, Maps configuration UI. URL stays `/admin/leadgen/sections/:id/edit`.

## 8.1 Studio layout

- **Top bar:** Section name (inline edit) · status pill · Activity dropdown · Vertical dropdown · mapping-completeness badge (“Mapping 3/4 Offers complete”) · validation summary chip (“2 issues”) · Save · Archive.
- **Left rail:** component library (§8.3) with visual thumbnails, grouped by intent, searchable.
- **Center:** visual slide canvas (§8.4) rendering via the REAL preset renderer (same srcdoc pipeline as preview — parity by construction).
- **Right:** tabbed inspector (§8.6) for the selected component/container.
- **Bottom drawer (tabs):** Offer mapping (§8.7) · Validation (issue list, click-to-focus like `06` §6.11) · Preview & debug (§8.9 controls + “events that would fire” panel).

## 8.2 Activity / Vertical (E1, E9)

- **Activity:** dropdown fed by `GET /api/admin/leadgen/activities` (existing DISTINCT endpoint, `offers-handlers.ts:1513–1526`); no free text by default; “+ New activity…” affordance requires explicit confirm (“No Offers exist for ‘<x>’ yet”).
- **Vertical:** dropdown fed by `/verticals`, FILTERED by the selected Activity; same allow-create affordance; changing Activity resets Vertical.
- **Available Offers:** derived from Activity+Vertical (existing derivation, `sections.ts:305–308`); panel lists each Offer with mapping status per §8.7. **Empty state (E9):** “No active Offers match Activity ‘auto-insurance’ + Vertical ‘auto’. [Open Offers] [Change Activity/Vertical]” — never a silent empty list. Save-time warning when the pair matches zero active Offers.

## 8.3 Component library (E3, E7, E8 + containers E4)

Grouped by intent; every item shows: visual thumbnail (inline SVG, rendered from the component’s own preset with sample props — never hand-drawn drift), plain name, one-line description, example usage, supported answer type, and a “maps to Offer fields” badge. Mapping to the EXISTING catalog (`components/registry.ts`) — no renames; new types marked ★:

- **Questions:** Category label→`CategoryLabel` · Question headline→`QuestionHeadline` · Subheadline→`Subheadline` · Helper text→`HelperText`
- **Answer choices:** Button answer group→`ButtonAnswerGroup` · Two-button yes/no→`TwoButtonYesNo` · Icon card grid→`IconCardAnswerGrid` · Image card grid→`ImageCardAnswerGrid` · Multi-choice card group→`MultiChoiceCardGroup` · Dropdown→`DropdownQuestion` · ★Searchable dropdown→`SearchableDropdownQuestion` · ★Other-group selector→`OtherGroupSelector` (B9 renderer; also auto-applied when a mapped field has `choiceDisplay.otherGroupEnabled`)
- **Inputs:** Free text→`FreeTextQuestion` · ★Number input→`NumberInputQuestion` · ★Currency input→`CurrencyInputQuestion` · Range slider→`RangeQuestion`/`NumberRangeQuestion` · Currency range→`CurrencyRangeQuestion` · Date input→`DateQuestion` · Name fields→`NameFieldsGroup` · Email→`EmailInputQuestion` · Phone→`PhoneInputQuestion` · ZIP→`ZIPInputQuestion` · Address autocomplete→`AddressAutocompleteQuestion`
- **Layout (★ all new — §8.5):** Card panel→`CardPanel` · Stack→`Stack` · Grid→`GridContainer` · Columns→`Columns` · Spacer→`Spacer` · Header slot→`HeaderBar` · Footer slot→`FooterBar` · Trust bar→`TrustBar` · Logo strip→`LogoStrip` · Background panel→`BackgroundPanel`
- **Trust / affordance:** Reassurance badge→`ReassuranceBadge` · ★Secure form badge→`SecureFormBadge` · Carrier/logo strip→`LogoStrip` · Legal note→`LegalNote` · Validation error→`ValidationError` · ★Success state→`SuccessState`
- **Navigation:** Continue button→`ContinueButton` · Auto-advance→`AutoAdvanceButton` · ★Back/Previous→`BackButton` (promoted placeable) · Progress bar→`ProgressBar` · ★Step indicator→`StepIndicator`

Every ★ addition = catalog entry + content-schema `REQUIRED_FIELDS` + preset render + style-slot tokens in each design + render tests (E7/E8 close via `NumberInputQuestion`, `CurrencyInputQuestion`, `SuccessState`).

## 8.4 Canvas (E3)

Drag-drop from library into the slide (insertion indicators between nodes and into container regions); direct click select (selection outline + breadcrumb “CardPanel › Stack › ButtonAnswerGroup”); move handles (drag to reorder; keyboard ↑/↓ retained); duplicate / delete / add-before / add-after on the selection toolbar; group-into-container action (wrap selection in Stack/CardPanel); snap targets = container regions only (no freeform x/y — the model stays an ordered tree); responsive preview inline (the §8.9 viewport applies to the canvas). **No arbitrary CSS anywhere** — all appearance flows through design tokens + per-component Design presets.

## 8.5 Layout containers (E4 — Q4 resolved: in scope; tokenized only)

`content_json` gains container nodes: `{type, container_id, props, children: LeadgenComponentNode[]}` (schema extension in `components/content-schema.ts`; validation: max depth 4, containers cannot contain themselves circularly, question components must remain unique by `internal_field`). Props are TOKEN-VALUED only:

| Container | Props (all token enums, no raw CSS) |
|---|---|
| `Stack` | direction vertical/horizontal · gap token (xs/s/m/l/xl) · align token (start/center/end/stretch) |
| `GridContainer` | columns desktop 2–5 / tablet 1–4 / mobile 1–2 · gap token · card sizing (auto/equal) |
| `Columns` | ratio preset (50/50, 60/40, 40/60, 70/30) · mobile stacking (stack/keep) |
| `CardPanel` | width preset (s/m/l/full) · background token · shadow token · radius token · padding token |
| `HeaderBar` | logo slot (mediaId) · back toggle · secure/disclosure slot · optional CTA (label + tel/href) |
| `FooterBar` | legal slot (html via LegalNote) · trust messages · links |
| `BackgroundPanel` | background token / image mediaId / gradient — **from approved design tokens only** |
| `TrustBar` | icon/text pairs · layout horizontal/stacked |
| `Spacer` | size token |

Presets render containers server-side (runtime + preview + canvas identical); design registries gain the container style slots (default-funnel measured values first, others follow their token files).

## 8.6 Inspector (E3) — tabs per selection

- **Content:** question text, helper text, placeholder, required, display copy (labels per component family).
- **Choices** (choice-bearing components): rows = display label · internal value · provider value shortcut (read-through to the mapped Offer field’s value map — edits open the `06` §6.3 table scoped to that mapping) · icon/image picker · description · main/Other grouping (B9) · analytics label · bulk paste.
- **Mapping:** this component’s `internal_field` mapping status per selected Offer; quick-map dropdown (schema-path picker); jump to the §8.7 panel.
- **Design:** style preset picker · columns · card style · icon color token · button background token · range fill token · text color token · feature color token · spacing token · mobile behavior — token dropdowns only, sourced from the active design’s slots.
- **Validation:** required · min/max · regex (only where the component supports it) · email/phone/ZIP/address modes · error text override.
- **Dependencies:** visual IF/THEN builder (same builder spec as `06` §6.10, same evaluator, fields = this Section’s internal fields): show when / hide when / require when / autofill when.
- **Advanced:** `internal_field` (rename with mapping-impact warning), `question_key`, debug IDs (read-only), raw `content_json` node — Advanced mode only.

## 8.7 Offer mapping panel (E2)

Table (selected Offers from Available Offers): **Offer · Provider · Placement · Payload schema version · Required fields (n) · Mapped fields (n) · Mapping status · Action**. Status enum (existing decode): `not selected → selected/not started → incomplete → complete → invalid` (orphaned path/type-conflict = invalid, red). Row actions: select Offer · **Map fields** (grid: rows = the Offer’s ACTIVE-schema answer-source fields; per row: schema path picker WITH type + valid values shown, mapped question dropdown (this Section’s fields, type-compatible first + inline compatibility note), mapped output/value-map button opening the §6.3 table, status) · **Create question for field** (spawns the right component type pre-bound to a new internal_field named from the schema path) · preview generated payload (calls `validate-payload`, shows per-offer JSON with this Section’s sample answers) · open Offer payload schema (deep link) · **bulk-map compatible fields** (name+type heuristic, review list before apply). Raw numeric offer ids, free-text paths, and raw JSON maps are GONE from this surface (Advanced drawer only).

## 8.8 Google Maps field-level configuration (E6; Q5: browser Places leg only)

Replaces the global `address_validation_enabled` checkbox (column stays for compat; per-field config wins when present). Per-component `props.maps`:
- **Address fields** (`AddressAutocompleteQuestion`): enable autocomplete · validate full address · autofill state → field picker · autofill city → field picker · autofill ZIP → field picker · normalize address line (toggle).
- **ZIP fields** (`ZIPInputQuestion`): validate ZIP · autofill city → field picker · autofill state → field picker.
UI: linked-field chips on the component (canvas overlay “fills: city, state”); **key-missing warning banner** in the Studio when no browser key is configured (“Autocomplete/validation will no-op; manual entry still works”); runtime honors exactly that (graceful manual entry, no console errors). Events (runtime leg, Phase 1 `runtime/maps.ts`): `address_autofill`, `address_validation_success`, `address_validation_error`. Server geocode leg stays dead code — explicitly out of scope (Q5).

## 8.9 Preview (E5 — normative details in `09`)

Bottom-drawer + canvas viewport controls: **Desktop / Mobile** (real widths 1280 / 375, reversible round-trip — regression: toggling back restores desktop exactly) · Refresh · state sims: Default · Selected · Error · Dependency triggered · Validation success · Validation error · **Flow simulation** (answer sequence player) — every sim server-rendered via preview-endpoint params (never cosmetic attributes on the outer iframe); design follows the variant’s `funnel_design_id` (picker to preview under any design).

## 8.10 Component completeness (E7, E8 + B9 renderers)

Ship: `NumberInputQuestion`, `CurrencyInputQuestion` (plain inputs — not Range variants; number formatting, currency prefix, min/max), `SuccessState` (+ success styling on all inputs), `SearchableDropdownQuestion`, `OtherGroupSelector`, `TrustBar`/`LogoStrip`. Each: registry entry, content-schema, preset render, token slots per design, render + content-schema tests.

## 8.11 Pattern capability acceptance (capability examples ONLY — not default-design references)

The Studio must produce ALL FOUR without custom CSS: (1) centered question card — progress, headline, subheadline, answer grid/buttons, trust/logo area; (2) branded top header/footer, stacked buttons, Back, secure/trust messaging; (3) header with logo + call CTA, large question, answer buttons, bottom trust bar; (4) full-background design with centered card, multi-step progress, answer cards with title+subtext, Back control, legal footer. Each becomes a Playwright fixture built through the UI (not seeded JSON) and screenshot-tested desktop+mobile under the default design.

## 8.12 Tests (definitions in `11` §11.3/§11.4)

Playwright: Activity dropdown sourced from Offers; Vertical filtered by Activity; Available Offers + empty state; mapping completeness badge; create Yes/No slide; dependent dropdown (insured=yes → insurer dropdown); ZIP validation slide; personal-details slide (name/email/phone); icon card grid; range slider; main/Other values; map answers to TWO Offers via pickers only; desktop AND mobile preview render at real widths and round-trip; dependency + validation-state previews visibly differ; publish blocked when required mapping missing (R5 integration); all four §8.11 patterns. Vitest: content_json container validation (depth, uniqueness, circularity); component registry coverage (every palette item placeable + renders); layout container serialization round-trip; dependency evaluation; mapping completeness computation; Maps config serialization; runtime/preview renderer parity (`09` §9.3).

## 8.13 Acceptance

A non-technical operator builds each §8.11 pattern end-to-end: picks components from a thumbnail library, arranges them via drag-drop into tokenized containers, edits copy/choices/design/validation/dependencies in tabbed inspectors, maps answers to multiple Offers via pickers, configures field-level Maps behavior, and previews desktop/mobile + all states — with no raw JSON, no hand-typed ids/paths, no custom CSS. Existing Sections open and re-save without data loss (`content_json` backward-compatible; flat legacy arrays render as an implicit root Stack).
