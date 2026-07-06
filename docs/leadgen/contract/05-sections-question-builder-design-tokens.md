# LeadGen CMS — Contract 05 · Sections, Question Builder & Design-Token System

Covers **§12 Sections / Quote Slides**, **§13 Rich question/answer builder**, and **§14 Rich styling & design-token system**, plus the Section-scoped operational concerns (dependencies, answer→Offer mapping, value normalization, continue behavior, default booleans, Google-Maps validation, section analytics).

---

## 12. Sections / Quote Slides tab

A LeadGen **Section** is a reusable quote slide — one or more questions that collect structured user input and map it to Offer payload fields. It is richer than a Listicles Section because it collects normalized input and drives the auction payload. The tab does three jobs: **Create**, **Manage**, **Analyze**.

### 12.1 Create-Section fields (`leadgen_sections`)

- `section_name` (internal)
- `activity`, `vertical` — drive **Available Offers** filtering
- **Available Offers** — only Offers matching the selected activity **and** vertical are shown; a Section may map answers to multiple Offers, each with different field names/structures (§12.7)
- `image_json` — image insertion / AI image creation / GIF (`{type:'media'|'url'|'ai'|'gif', media_id?, url?, ai_prompt?}`)
- `headline_text` — usually the main question ("Are you insured?", "Are you a homeowner?", "How much do you need?", "Personal details")
- `subheadline_text` — context / why the question matters
- **Body** — the rich answer/question builder (§13), stored in `content_json`
- `continue_mode` — button | auto_advance (§12.5)
- default boolean answers (conditional, §12.6)
- Google-Maps address/ZIP validation+autofill toggle (`address_validation_enabled`, §12.8)
- answer→Offer field mapping (§12.7)

On save, the server rebuilds `leadgen_section_offers` + `leadgen_section_answer_maps` from `content_json` (§6.3).

### 12.2 Headline / subheadline

Headline is the main question, rendered with the `QuestionHeadline` preset (§14). Subheadline uses `Subheadline`. Both are per-Section copy; tokens (font/size/weight/color) come from the funnel design.

### 12.3 Dependencies & conditional logic

The builder supports IF/THEN dependencies:
- If answer X selected → show question Y.
- If answer X selected → hide question Z.
- If field A = B → require field C.
- If field A = B → map value C to Offer field D.
- If validation fails → block continue.
- If a default answer exists → mark `answer_source=default` until the user confirms.

UX: a visual IF/THEN rule builder; dependencies shown as rule rows (and optional flow lines); conflict warnings; preview mode; required-field validation. Server-side validation re-checks all dependencies + required fields on submit (client validation is never trusted). Dependencies are stored inline in `content_json` on each component (`conditional: {when, op, value}`) and evaluated by the runtime engine.

### 12.4 Mapping Section answers to Offer payload fields (§12.7 pivot)

Each question maps to the fields each selected Offer expects. The pivot is the **internal normalized field**:

```
question (question_key)  →  internal_field (normalized)  →  per-Offer payload_field_path (+ value_map + transform + required)
```

Supports: one question → one field per Offer; one question → multiple fields per Offer; multiple questions → multiple fields; bulk mapping for multi-question Sections; per-Offer field names, valid values, type conversion; provider required/optional; defaults/fallbacks; value transformations.

Mapping UI columns: Question · Internal normalized field · Mapped Offer · Offer payload field path · Expected type · Valid values · Value transformation · Required/optional · Mapping completeness · **Test generated payload**. Persisted to `leadgen_section_answer_maps` (one row per question×Offer target). The Offers picker only offers Offers matching activity+vertical; mapping into an archived/mismatched Offer is blocked at save (§35).

### 12.5 Continue button behavior

`continue_mode`:
- **button** (enabled): user selects answers → clicks Continue → funnel advances. Do not advance until required fields answered; show validation errors; track `answer_click` and `continue_click` / `section_continue` separately.
- **auto_advance** (disabled): funnel advances immediately when the user clicks an answer button. Prevent double navigation; track `answer_click` before navigation.

### 12.6 Default boolean answers

Multi-question boolean Sections may pre-set defaults (e.g. "Currently insured? → No"). The runtime marks `answer_source`:
- `default` (untouched pre-set) vs `user` (user-set), and distinguishes **user-confirmed default** vs **untouched default**. This is emitted on every answer event and mirrored to `leadgen_analytics_answer_distribution` for analytics quality.

### 12.7 Value mapping & normalization (§16)

The same answer may need different values per Offer. UI answer `Yes` → Offer A `true`, Offer B `"Y"`, Offer C `"yes"`, Offer D `1`. The mapping supports: UI value → internal normalized value → Offer-specific output value; type conversion; boolean conversion; enum mapping; number/string conversion; default; fallback; invalid/missing handling. Stored as `output_value_map_json` + `transform_json` on the answer-map row and applied by the payload builder (§11.5 runtime build).

### 12.8 Google-Maps validation / autofill

When `address_validation_enabled=1`, address/ZIP/city/state inputs use Google Maps (Places Autocomplete + geocode). Requirements:
- Autocomplete address; validate ZIP (5-digit US, per the reference's `/^\d{5}$/` guard); auto-fill city/state where possible; normalize address fields for payload mapping (street/city/state/zip as distinct internal fields); handle invalid addresses gracefully; track `address_autofill` / `address_validation_success` / `address_validation_error`; mobile-friendly.
- **API key** is a wrangler secret (`GOOGLE_MAPS_API_KEY`), never embedded in cached HTML. The Maps JS key is a **referrer-restricted browser key** injected per-request into the funnel shell (or proxied); the server-side geocode/validate key (if used) stays server-only. (Ground: this is the reference's ZIP-validation + KV-city/state pattern, upgraded to Places autocomplete.)

### 12.9 Section analytics (from `leadgen_analytics_section` + `_answer_distribution`)

Required: `views`, `clicks`, `users_continued_to_next_page`, `continue_rate`, `answer_distribution`. Definitions:
- `clicks` = answer/button/input interactions
- `users_continued_to_next_page` = users who advanced from this Section
- `continue_rate = users_continued_to_next_page / views` (NULLIF guard)
- `answer_distribution` = % per answer for **non-free-text** answers (value · count · percentage)

Free-text: do **not** expose raw sensitive values by default — use counts/completion/error metrics. Non-free-text: answer value · count · percentage. Also: `validation_error_rate`, `default_answer_rate`, `user_changed_default_rate`, `time_on_section`, `dropoff_rate`. Answer distribution is keyed by `(section, question_key, answer_value_normalized, answer_source)`.

---

## 13. Rich question / answer builder

The Section body is a rich, dynamic answer/question builder. It MUST support single-question slides, multi-question slides, answer-only slides tied to the headline question, conditional follow-ups, per-Offer field mapping, desktop + mobile rendering, and **design-token-controlled** styling (never arbitrary CSS in normal mode).

### 13.1 Component catalog (all MUST be buildable as presets)

Button · Icon button card · Image button card · Button group · Dropdown · Multi-choice boxes · Free-text input · Range picker · Number input · Currency input · Address input · ZIP input · Email input · Phone input · Name fields · Date picker · Boolean yes/no · Info badge / reassurance banner · Progress bar · Back button · Continue button · Disclosure link · Small helper text · Error state · Success/valid state.

Each interactive component carries: `question_key` (stable), `internal_field` (normalized), `answer_type`, `required`, `valid_values` (enum-like), per-choice `value`, per-choice `analytics_id`, optional `conditional`, and design-token preset selection (§14). Hit targets ≥ 44px on mobile.

### 13.2 Worked examples

**Simple** — Headline "Are you insured?", body `[Yes] [No]` (`TwoButtonYesNo`, `internal_field=currently_insured`, `auto_advance`).

**Personal details** — Headline "Personal details", body: First name, Surname, Email, Phone, Address (Google-Maps autocomplete), ZIP (validated) → `NameFieldsGroup` + `EmailInputQuestion` + `PhoneInputQuestion` + `AddressAutocompleteQuestion` + `ZIPInputQuestion`, `continue_mode=button`.

**Dependent** — Question "Are you insured?" (Yes/No). If Yes → show an Insurer `DropdownQuestion` with valid insurer choices (`conditional: {when:'currently_insured', op:'eq', value:true}`).

**Range** — Category label "BUSINESS LOAN", headline "How much do you need?", `CurrencyRangeQuestion` (value `$330,000`, min `$10,000`, max `$1M+`), Continue below, `ReassuranceBadge` "Get your offers in 2 minutes or less."

**Icon cards** — headline "What type of business do you own?", `IconCardAnswerGrid` with choices Sole Proprietor / Partnership / LLC / C Corporation / S Corporation.

---

## 14. Rich styling & design-token system

This section is deliberately exhaustive: the funnels must be **polished, highly-designed** quote slides, not plain forms. Styling is expressed **only** through a tokenized design registry and component presets — **no arbitrary CSS in normal editing mode**. This mirrors the Listicles layout registry (`public/listicle/layouts/registry.ts` + `default/tokens.ts`), which LeadGen clones as a **funnel** design registry (and a parallel **banner** design registry, §20).

### 14.0 Two registries: visual design vs component capability

LeadGen keeps **two separate registries**. The **visual design registry** (`designs/*`) owns how a funnel LOOKS — theme + per-component style tokens; its default is **insureprimo** (measured). The **component capability registry** (`components/registry.ts`) owns WHAT can be built — the catalog of question/answer component types + their data/validation/events — independent of look. A Section is authored from the capability registry and **skinned at render** by the active visual design. Screenshots are capability examples, never default styling. Adding a look ≠ adding a capability.

### 14.1 Registry files

```
api/src/public/leadgen/designs/registry.ts          // getFunnelDesign(id) → default; getBannerDesign(id)
api/src/public/leadgen/designs/default-funnel/tokens.ts     // the reference funnel design tokens (below)
api/src/public/leadgen/components/registry.ts // preset renderers (server) + client hydration hooks
api/src/public/leadgen/designs/default-funnel/styles.ts     // tokens → scoped CSS (tokens-to-css)
docs/leadgen/default-funnel-design-audit.md        // measured token audit (see infra doc)
```

- Multiple funnel designs supported over time; `funnel_design_id` per Quote variant. Unknown id → `default` (same fallback rule as Listicles `getLayout`).
- Tokens are scoped **per funnel design** and **per component**. Normal mode exposes only safe tokenized controls (§14.8); an advanced token-override path is allowed only where it cannot break layout/perf (bounded to a curated token set — never free CSS).
- The default visual design is **insureprimo** (measured — navy `#1B3A5C` + orange `#E85D26`, Literata/Sora; authoritative values in `designs/default-funnel/tokens.ts`, audit in `docs/leadgen/default-funnel-design-audit.md`). The operator’s LendingTree-style screenshots are **capability examples** — slides the *component capability registry* can build — NOT the default look and NOT a source of styling. A green/blue skin would be a separate visual design added to the registry.

### 14.2 Token groups a visual design defines (authoritative values: `designs/default-funnel/tokens.ts`)

> **Authoritative default tokens live in `designs/default-funnel/tokens.ts` (insureprimo — navy `#1B3A5C` + orange `#E85D26`, Literata/Sora).** The JSON below is a STRUCTURAL example only: it enumerates the token GROUPS a funnel visual design must define. **Ignore its specific colors** — the green/blue values were a discarded exploration, NOT the default. Under insureprimo the same groups take navy/orange values (progress fill navy, Continue navy, category-label accent-orange, badge success-green, icons navy) per the token file. A green/blue look is a separate registry design.

```jsonc
{
  "page":        { "background": "#f4f5f7", "textColor": "#1a1f36", "fontFamily": "Inter, system-ui, Arial, sans-serif", "contentMaxWidth": "760px", "slideTopSpacing": "40px" },
  "header":      { "background": "#0b1f3a", "height": "64px", "paddingX": "20px", "align": "center", "logoMaxWidth": "180px", "logoMaxHeight": "36px" },
  "backButton":  { "size": "40px", "position": "left", "color": "#ffffff", "iconSize": "20px" },
  "disclosure":  { "position": "top-right", "color": "#ffffff", "fontSize": "13px", "lineHeight": "16px", "textDecoration": "none" },
  "progressBar": { "width": "100%", "maxWidth": "760px", "height": "6px", "radius": "999px", "trackColor": "#e2e5ea", "fillColor": "#1f9d57" },
  "categoryLabel": { "fontSize": "13px", "fontWeight": "700", "letterSpacing": "2px", "textTransform": "uppercase", "color": "#1f9d57", "marginBottom": "12px" },
  "questionHeadline": { "fontFamily": "'Tiempos', Georgia, 'Times New Roman', serif", "fontSizeDesktop": "40px", "fontSizeMobile": "28px", "fontWeight": "600", "lineHeight": "1.15", "color": "#111827", "textAlign": "center", "maxWidth": "620px" },
  "subheadline": { "fontSize": "16px", "lineHeight": "24px", "color": "#5b6472", "textAlign": "center", "marginTop": "12px" },
  "rangeValue":  { "fontSize": "44px", "fontWeight": "700", "color": "#111827", "textAlign": "center", "marginY": "16px" },
  "rangeSlider": { "trackHeight": "8px", "trackRadius": "999px", "trackFilledColor": "#1f9d57", "trackRemainingColor": "#d7dbe2", "thumbSize": "28px", "thumbBorder": "3px solid #ffffff", "thumbBg": "#111827", "thumbShadow": "0 2px 8px rgba(0,0,0,.25)" },
  "rangeMinMaxLabel": { "fontSize": "13px", "color": "#6b7280", "fontWeight": "500" },
  "continueButton": { "widthDesktop": "360px", "widthMobile": "100%", "height": "56px", "radius": "999px", "background": "#2a6fdb", "color": "#ffffff", "fontSize": "18px", "fontWeight": "600", "hoverBackground": "#215bb5", "activeBackground": "#1c4f9e", "disabledBackground": "#a9c0e8", "disabledColor": "#ffffff", "loadingSpinner": true },
  "reassuranceBadge": { "borderColor": "#1f9d57", "borderWidth": "1px", "background": "#eaf7ef", "radius": "10px", "paddingY": "10px", "paddingX": "16px", "iconColor": "#1f9d57", "textColor": "#14663a", "fontSize": "14px", "gap": "8px" },
  "iconCard":    { "minHeightDesktop": "132px", "minHeightMobile": "96px", "gridGap": "12px", "borderColor": "#e2e5ea", "borderWidth": "1px", "radius": "12px", "background": "#ffffff", "shadow": "0 1px 3px rgba(16,24,40,.08)", "iconColor": "#1f9d57", "iconSize": "32px", "titleFontSize": "16px", "titleFontWeight": "700", "titleColor": "#1a1f36",
                   "hover":    { "borderColor": "#1f9d57", "shadow": "0 4px 12px rgba(16,24,40,.12)" },
                   "selected": { "borderColor": "#1f9d57", "borderWidth": "2px", "background": "#f2fbf6" },
                   "disabled": { "opacity": "0.5" },
                   "error":    { "borderColor": "#d92d20" } },
  "input":       { "height": "52px", "radius": "10px", "borderColor": "#cfd4dc", "borderWidth": "1px", "focusBorderColor": "#2a6fdb", "focusRing": "0 0 0 3px rgba(42,111,219,.2)", "fontSize": "16px", "color": "#1a1f36", "placeholderColor": "#98a1ad", "paddingX": "14px", "errorBorderColor": "#d92d20" },
  "dropdown":    { "inherits": "input", "chevronColor": "#6b7280" },
  "multiChoice": { "inherits": "iconCard", "checkColor": "#1f9d57" },
  "validationError": { "color": "#d92d20", "fontSize": "13px", "lineHeight": "18px", "marginTop": "6px", "iconColor": "#d92d20" },
  "helperText":  { "color": "#6b7280", "fontSize": "13px", "lineHeight": "18px" },
  "legalNote":   { "color": "#8a929e", "fontSize": "12px", "lineHeight": "18px" },
  "breakpoints": { "mobileMax": "639px", "desktopMin": "640px", "wideMin": "1024px" },
  "motion":      { "transitionMs": "180", "slideTransitionMs": "220", "focusRingMs": "120" }
}
```

### 14.3 Component presets (built from tokens — no raw CSS)

`ProgressBar`, `HeaderLogo`, `BackButton`, `DisclosureLink`, `CategoryLabel`, `QuestionHeadline`, `Subheadline`, `RangeQuestion`, `CurrencyRangeQuestion`, `NumberRangeQuestion`, `ButtonAnswerGroup`, `IconCardAnswerGrid`, `ImageCardAnswerGrid`, `TwoButtonYesNo`, `MultiChoiceCardGroup`, `DropdownQuestion`, `FreeTextQuestion`, `EmailInputQuestion`, `PhoneInputQuestion`, `AddressAutocompleteQuestion`, `ZIPInputQuestion`, `NameFieldsGroup`, `DateQuestion`, `ContinueButton`, `AutoAdvanceButton`, `ReassuranceBadge`, `HelperText`, `ValidationError`, `LegalNote`.

Each preset is a server-render function (in `components.ts`) that consumes tokens + component props and emits inline-styled markup + minimal hydration hooks (data attributes). No preset emits a `<style>` block that reads component-instance data; static chrome CSS comes from `tokens-to-css.ts`.

### 14.4 Icon card grid (MUST)

Per-choice custom icon (icon-library picker OR uploaded SVG/icon asset), icon color token, label, optional description, per-choice `value`, per-choice `analytics_id`. Desktop layouts: 2/3/4/5 columns; mobile: 1 or 2 columns. States: selected, hover, disabled, error, keyboard focus. MUST express the example choices: Sole Proprietor / Partnership / Limited Liability Company (LLC) / C Corporation / S Corporation.

### 14.5 Range picker (MUST)

Currency + number formatting; `min`, `max`, `step`, `default`; live value display; min/max labels; filled track + remaining track + large custom thumb (insureprimo skin: navy fill `#1B3A5C`, `#E8EEF4` remaining, navy thumb); keyboard accessible (`role=slider`, arrow keys, `aria-valuenow/min/max`); touch/mobile behavior; answer mapping to Offer payload fields; analytics on value change and on continue. MUST express: category "BUSINESS LOAN", headline "How much do you need?", value `$330,000`, min `$10,000`, max `$1M+`, Continue below.

### 14.6 Continue / button behavior styling (MUST)

Continue button: full-width centered pill; **primary background (insureprimo navy `#1B3A5C`, not blue)**; white text; hover/active/disabled/loading states; spinner/loading state; validation-error behavior; fixed or flexible width per design; distinct desktop/mobile dimensions. Auto-advance answer buttons: immediate navigation after click when Continue is disabled; selected animation; prevent double-submit; track `answer_click` before navigation.

### 14.7 Reassurance / info badge (MUST)

Icon; outline + pale background (insureprimo skin: success-green `#0E7C3A` outline, `#F2F6FA` bg); rounded rectangle; text; placement under Continue or under the card grid; optional per-design copy; shown/hidden per Section. Example copy: "Get your offers in 2 minutes or less."

### 14.8 CMS styling controls (safe, tokenized — no arbitrary CSS)

The Section editor inspector exposes: component style preset selector · icon selector · icon color token · card layout selector (columns) · card count per row · feature color token · range color token · button background token · button text token · answer-grid gap token · badge enabled/disabled + icon/text · helper text · per-component mobile behavior. All bind to fixed design tokens/classes so funnels stay consistent + fast. `design_overrides_json` stores only values from the curated token set; unknown keys are rejected at save.

### 14.9 Preview requirements (MUST)

Every Section provides: **Desktop preview**, **Mobile preview**, simulated **selected** state, **error** state, **conditional dependency** preview, **auto-advance** simulation, **Continue-button** simulation, **payload-mapping** preview (generated payload for sample answers), **analytics-event** preview (which events fire). Quote preview (§15) renders header + progress bar + slide sequence + transitions + validation + final auction entry, desktop and mobile.

### 14.10 Visual acceptance criteria (MUST — enforced in tests, §31)

- Screenshot comparison for the default design at **desktop** and **mobile** (Playwright + computed-style diff, masking dynamic content — same discipline as the Listicles visual suite).
- Computed-style tests for: header (bg/height), progress bar (track/fill/height/radius), headline (family/size/weight), icon cards (border/radius/shadow/selected), range (track colors/thumb size), continue (bg/radius/height/states), reassurance badge (border/bg/icon).
- **No arbitrary-CSS escapes** in the default builder (assert `design_overrides_json` only contains curated token keys; assert rendered markup carries no author-supplied `<style>`/`style` attribute beyond preset output).
- All operator-screenshot component patterns (icon cards, currency range, blue pill, green badge, progress bar, dropdowns, multi-choice, free-text, PII inputs) are expressible through CMS presets — a checklist test enumerates each.

---

## 12.11 Answer-to-Offer mapping model (expanded — normative)

Every `leadgen_section_answer_maps` row is one mapping edge. Full field set (Row/API):

| Field | Meaning |
|---|---|
| `question_id` | stable id of the source question component in `content_json` |
| `question_key` | human/analytics key (e.g. `homeowner_q`) |
| `internal_field` | normalized answer name (the pivot, e.g. `homeowner`) |
| `internal_value` | normalized answer value domain (e.g. `true`/`false`; enum set) |
| `offer_id` | target Offer |
| `payload_schema_version` | the Offer schema version this mapping targets (pins field existence) |
| `offer_payload_field_path` | dotted path into that Offer's payload (e.g. `data.home_own`) |
| `provider_expected_type` | `boolean|string|number|enum|array|object` per the schema node |
| `value_transform` | pipeline (`mapBoolean`, `mapEnum(map)`, `formatDate(fmt)`, `formatPhone`, `toNumber`, `toString`, `trim`) |
| `output_value_map` | UI/normalized → provider value (e.g. `{true:"Y",false:"N"}`) |
| `default_value` / `fallback_value` | when the answer is absent / invalid |
| `required_for_offer` | provider marks the field required |
| `mapping_completeness` | derived: `complete|missing_required|type_mismatch|orphaned` |
| `validation_status` | derived: `ok|error` (blocks Quote publish when any mapped Offer has `error`) |

**Cardinalities (all MUST):** one question → one field (per Offer); one question → many fields (per Offer); many questions → many fields; per-Offer field names; per-Offer valid values; per-Offer type conversion. A multi-question Section supports **bulk mapping** (map a set of questions to a set of Offer fields in one pass).

**Normalization pipeline order** (runtime, `src/leadgen/answers.ts` → `payload.ts`): raw UI answer → `internal_field`/`internal_value` (Section-level normalization) → per-Offer `output_value_map` → `value_transform` → `provider_expected_type` coercion → `default`/`fallback` if absent/invalid → `cleanObject` drop if still empty. Deterministic; the same normalized answer yields the correct per-provider shape (§16 example: `Yes` → `true` / `"Y"` / `"yes"` / `1`).

**Per-Offer preview** (`POST /api/admin/leadgen/sections/:id/validate-payload` with sample answers + selected Offers) returns, per Offer: the generated payload, a completeness score (mapped required / total required), and the list of missing/invalid fields.

**Field-level error UI states** (mapping grid): each cell shows `ok` (green check), `missing_required` (red "map required field"), `type_mismatch` (amber "answer type X not coercible to Y"), `orphaned` (gray "Offer field no longer exists in schema vN" — appears when the Offer schema version advances). A Section with any `error` row cannot be included in a **published** Quote (§35).
