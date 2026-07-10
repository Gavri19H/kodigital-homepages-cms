# 15 · Testing and QA Contract

Suites extend the existing vitest + Playwright infrastructure (`api/test/*`, `api/test-ui/*`). Naming: `leadgen-frame-*`, `leadgen-theme-*`, `leadgen-studio-v25-*`, `leadgen-quote-builder-*`. Every test below is REQUIRED for phase exit (`16`).

## 15.1 Vitest (unit/integration — pure functions + handlers)

| Test | Asserts |
|---|---|
| `frame-config-serialization` | `frame_config_json` schema round-trip; unknown keys rejected; enum violations produce path-precise `problems` |
| `frame-template-merge` | `effectiveFrame` template ⊕ funnel ⊕ variant precedence; arrays replaced whole; sparse overrides |
| `theme-inheritance` | `resolveTokens` priority 1→3; absent theme = base design identity; role→base mapping exhaustive for every registered design |
| `token-priority-order` | full 6-layer resolution incl. Section roles + component overrides + legacy `#hex` literal passthrough (flagged) |
| `canonical-headline-binding` | bound node renders column text; strip↔canvas single store (handler level: PATCH with bind + changed `headline_text` re-renders `content_html` with new text); `bind_type_mismatch`/`duplicate_bind`/`bound_node_carries_text` codes fire |
| `no-duplicate-headline-storage` | saving a bound node never writes `props.text`; `previewVariantHandler` output contains NO `lg-section-headline` h2 |
| `section-local-override-application` | `design_overrides_json` roles resolve between theme and component layers |
| `frame-plus-unit-composition` | `renderQuoteFrame` region presence per template; hooks emitted once (exactly one `data-lg-progress`, one back mount); `frame=null` → byte-identical legacy shell (pinned fixture) |
| `site-logo-inheritance` | `resolveSiteBranding` ladder (media → url → name → CMS); serve bakes per-site logo; branding edit bumps activation version |
| `progress-from-variant-order` | frame progress totals = variant section count; engine `updateProgress` values across simulated advance |
| `back-behavior` | hidden on first section; frame-level mount driven by engine |
| `mapping-compatibility` | unchanged mapping suites still green (regression umbrella) |
| `component-schema-validation` | new choice fields validate; `image_alt` required w/ image; emoji×icon exclusivity; `frame_scope_component` warning emitted, `ok` unaffected |
| `image-card-choice-data` | choice carries image/alt/title/subtitle/value through save → config projection → preset render |
| `preview-runtime-parity` | `13 §13.5` items 1–3 (string-level fixtures) |
| `activation-preflight-v25` | every `14 §14.1` row fires on a crafted fixture; legacy Quote yields zero new problems |
| `per-offer-provider-values` (C1) | one `internal_field` mapped to TWO Offers with different `output_value_map`s; each Offer’s `validate-payload` preview emits its own provider value; the Choices-tab projection carries NO universal provider-value field |
| `continue-single-dom` (C3) | exactly one `[data-lg-continue]` per rendered section element in `inside_unit` AND `below_unit`; in `below_unit` the control sits at the end of the section subtree and the node-position visual is suppressed; duplicate `ContinueButton` nodes → first wins + `duplicate_continue` warning; `auto_advance` → zero controls |
| `template-switch-merge` (C5) | operator content preserved / layout replaced per the `04 §4.3` class table; unsupported-enabled-region and `section_slot.card`-change cases return the confirmation-trigger list; `draft_frame_config` preview persists nothing; switch-back revives inert groups |
| `activation-chrome-block` (C2) | configured frame + chrome-bearing Section → activation 409 error; `compat.allow_section_chrome:true` → warning; NULL frame → save-time warning only |
| `no-raw-json-normal-mode` | studio/inspector SSR HTML for normal mode contains no `<textarea` with JSON content and no `#hex` text outside Advanced-marked containers |

## 15.2 Copy/lint assertions

`glossary-lint` (vitest over `ui-*.ts` string literals): forbidden terms outside Advanced contexts (`12 §12.4`, `07 §7.4` lists) — including (C6) “slide” anywhere in Section-Builder normal-mode strings (allowed in Quote-Builder strings), and (C1) “provider value” in any string not adjacent to an Offer-name placeholder. `hex-lint`: no hex literals in normal-mode option labels.

## 15.3 Playwright (test-ui; each maps to a mission §16 row)

Quote Builder: choose `centered` template → site logo auto-appears (site fixture with logo) · change progress style dots→bar and step through all-slides preview (values advance) · footer/disclosure/trust configured → appear around EVERY slide in all-slides mode · switch preview site → logo swaps · site selector lists ALL sites with Active / Activation off / Not activated badges and previews an unactivated site’s branding (C4) · template switch shows preview-before-apply + a confirmation naming affected regions; cancel leaves config untouched (C5) · publishing with chrome-in-section blocks with a fix link; enabling the Advanced legacy override downgrades it to a warning (C2) · variant override badge appears when a non-control arm overrides progress.
Section Builder: edit canonical headline in strip → canvas updates without a second field; edit inline on canvas → strip updates (no duplicate entry anywhere) · select component → inspector shows scope header + correct tabs; select choice → choice scope · Choices tab shows NO universal provider-value control; the per-choice chip lists one row per selected Offer and deep-links to that Offer’s value map (C1) · image card grid: add image per card via picker, set alt/title/subtitle/value; save; re-open intact · color control shows palette swatches; no hex text; role stored · map an answer to an Offer field from the Mapping tab via pickers only · desktop/mobile round-trip at real widths · palette contains no header/footer/progress/background items; callout links to Quote Builder · legacy Section with HeaderBar shows amber badge + Move-to-frame flow.
Runtime (live `/lg` fixtures): frame identical across 3 Sections while units differ (DOM diff of frame regions = empty) · logo from activated site (two sites, two logos, one Quote) · progress advances by section order · footer/disclosure persist across slides · a `below_unit` funnel renders exactly one Continue per visible slide, below the unit card (C3) · `frame=null` funnel renders exactly as before (snapshot).
Patterns: build A–E through the UI per `08 §8.7` (fixtures, not seeded JSON), then screenshot desktop+mobile.

## 15.4 Visual regression

Five composed screenshots (desktop+mobile): reference-style frame with Section card (A) · simple branded frame (B) · header-CTA frame (C) · full-background card frame (D) · ZIP-input frame (C-unit variant). Masks: dynamic ids. Stored under `test-ui/__screenshots__/leadgen-v25/`.

## 15.5 Manual QA additions (`docs/leadgen/manualQA.md`)

1. A designer builds a complete 4-slide Quote (frame + theme + Sections + mapping + activation) touching zero raw JSON and zero code labels — sign-off checklist enumerates every step.
2. The designer answers, unprompted: “what belongs to the Quote vs the Section?” — answer sheet in the doc; a wrong answer fails the UX, not the designer.
3. Preview all slides in one funnel; confirm consistent frame; switch site branding; confirm logo swap.
4. Break-it pass: attempt to place page chrome in a Section, type hex, enter duplicate headlines — all impossible or clearly redirected.
