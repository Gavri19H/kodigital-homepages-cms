// LeadGen component PRESETS — server-render functions (contract 05 §14.3).
// One function per preset in the §14.3 list; each consumes a Section
// component node (its authorable props) + the ACTIVE funnel design tokens and
// emits inline-styled HTML plus hydration data-attributes (data-question-key,
// data-internal-field, data-analytics-id, data-answer-type, per-choice
// data-value). Styling comes ONLY from design tokens + the curated
// design_overrides (§14.8) — never arbitrary CSS. Interaction STATES
// (hover/selected/focus/disabled/loading) come from the scoped chrome CSS
// (designs/default-funnel/styles.ts); no preset emits a `<style>` block that
// reads instance data (§14.3 / §14.10).
//
// Fix-contract v2.4 03 §3.3 HYDRATION HOOKS (contract-normative — preview and
// runtime emit them identically by construction, 09 §9.1/§9.3): every
// interactive element additionally carries its `data-lg-*` attribute —
//   data-lg-question="{question_id}"   on answer-producing (question) nodes
//   data-lg-field="{internal_field}"   alongside data-lg-question
//   data-lg-choice="{value}"           on each selectable choice
//   data-lg-input                      on text/date/email/phone/zip inputs
//   data-lg-continue / data-lg-back    on nav controls
//   data-lg-progress (+ data-mode)     on the progress bar
//   data-lg-error-for="{internal_field}" on error slots
//   data-lg-maps="{configJSON}"        on Maps-enabled address/ZIP components
//   data-lg-other-trigger / data-lg-other-panel  §6.5 authored-Other markup
// The Rework §6.5 "Other" affordance renders when a single-select choice node
// carries `props.other = {enabled, label, choices}`: the base choices UNCHANGED
// + ONE trailing "Other" trigger (NOT a choice — it never stores a value) that
// reveals a hidden native <select> of the AUTHORED other values. Selecting one
// stores its REAL value (which also joins valid_values). Absent/disabled/empty
// `props.other` ⇒ byte-identical render (attributes only, no visual change).
// (The §10-retired choiceDisplay/Other-group mechanism is fully removed.)
//
// Every interpolated author value is escaped (editor/sanitize.escapeHtml).
// Author content NEVER flows into a `style` attribute — only token values do.
// Hit targets are ≥44px on mobile (§13.1) via the min-height tokens.

import { escapeHtml } from "../../../editor/sanitize";
import { COMPONENT_CATALOG } from "./registry";
import type { ComponentType } from "./registry";
import {
  defaultFunnelDesign,
  defaultFunnelIconCardDepthSlots,
} from "../designs/default-funnel/tokens";
import type {
  DefaultFunnelDesign,
  LeadgenIconCardDepthSlots,
} from "../designs/default-funnel/tokens";
import {
  autoAdvanceEligibility,
  flattenComponents,
  isIsoDate,
  isLayoutContainerType,
  isQuestionGridType,
  LEADGEN_MAX_CONTAINER_DEPTH,
  LEADGEN_NODE_BORDER_COLOR_ROLES,
  LEADGEN_NODE_CORNERS,
  parsePhoneMaskPattern,
  resolveFieldSize,
} from "./content-schema";
import type {
  LeadgenAddressFieldKind,
  LeadgenAddressFieldMode,
  LeadgenChoice,
  LeadgenChoiceSizePreset,
  LeadgenChoiceStyle,
  LeadgenComponentNode,
  LeadgenDesignOverrides,
  LeadgenNodeBorderColorRole,
  LeadgenNodeCorners,
  LeadgenPlacementAlign,
  LeadgenPlacementLayout,
  LeadgenResolvedSizeAxis,
  LeadgenSelectedMarker,
} from "./content-schema";
// P1b (register PC-11): the §8.1 leading-icon / card-icon SVGs are the
// build-time-vendored Tabler (MIT) subset (scripts/build-icons.mjs output) —
// see fieldLeadingIcon / the renderCardGrid iconSlot below.
import { LEADGEN_ICONS, leadgenIconSvg } from "./icons.generated";
import {
  baseTokenForRole,
  isFunnelTokenRole,
  readButtonStyle,
  THEME_RECORD_FIELD_HEIGHT_TO_MIN_HEIGHT,
  fieldPaddingBlockForPx,
} from "../designs/theme";
// R2 P1 §① (owner A.1 #4 / probe 4a): the ONE definition of the §6.6 mark
// rules lives in the design sheet; this module emits it demand-driven for the
// author-opted case ONLY (selectedMarkStyleBlock below). Import direction is
// presets → designs (the same direction as the tokens/theme imports above);
// styles.ts imports nothing from this module, so no cycle is introduced.
import { selectedMarkRules } from "../designs/default-funnel/styles";
import type { FunnelTokenRole, ThemeRecordControls } from "../designs/theme";
import type { LeadgenContinueMode } from "../../../admin/leadgen/db-types";

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function esc(value: unknown): string {
  return escapeHtml(value === undefined || value === null ? "" : String(value));
}

// One attribute ` name="escaped"`, omitted when the value is empty/absent.
function attr(name: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  return ` ${name}="${esc(value)}"`;
}

// A `style="…"` string built from token values only (no author content).
// Belt-and-suspenders §14.10: every value is HTML-escaped (esc) so a value
// carrying a `"` can never terminate this double-quoted attribute and inject
// sibling attributes — even if a hostile design_overrides token slipped past
// the CSS_ESCAPE_RE validator. Curated token values are colors/px/rem/shadows/
// gradients (no escapable chars) EXCEPT the font-family tokens, whose single
// quotes render as `&#39;` — a browser-equivalent entity (identical computed
// style); it is the only legitimate token value this escape rewrites.
function style(pairs: Record<string, string | undefined>): string {
  const body = Object.entries(pairs)
    .filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")
    .map(([k, v]) => `${k}:${esc(v)}`)
    .join(";");
  return body === "" ? "" : ` style="${body}"`;
}

function propStr(node: LeadgenComponentNode, key: string): string | undefined {
  const v = node.props?.[key];
  return typeof v === "string" ? v : undefined;
}
function propNum(node: LeadgenComponentNode, key: string): number | undefined {
  const v = node.props?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function propBool(node: LeadgenComponentNode, key: string): boolean {
  return node.props?.[key] === true;
}

// Curated design-override reads (§14.8). Only string overrides feed inline
// mobileBehavior: schema-legal LEGACY key — zero renderer consumers; the Design-tab control was removed in Phase C (DEV-64/FIX-4b). Kept valid so stored content keeps validating.
function ov(node: LeadgenComponentNode, key: keyof LeadgenDesignOverrides): string | undefined {
  const v = node.design_overrides?.[key];
  return typeof v === "string" ? v : undefined;
}
function ovNum(node: LeadgenComponentNode, key: keyof LeadgenDesignOverrides): number | undefined {
  const v = node.design_overrides?.[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

// The hydration data-attributes shared by every interactive node. The answer
// type falls back to the catalog `produces` when the author left it implicit.
// 03 §3.3: answer-PRODUCING nodes (catalog produces !== null) additionally get
// `data-lg-question` (+ `data-lg-field` when they carry an internal_field) so
// the engine — and the 11 §11.6 anti-false-PASS probe counting
// [data-lg-question] — see QUESTION components only, never chrome/affordances.
function hydration(node: LeadgenComponentNode): string {
  const catalog = COMPONENT_CATALOG[node.type];
  const produces = catalog.produces;
  const answerType = node.answer_type ?? (produces === null ? undefined : produces);
  return (
    attr("data-component-type", node.type) +
    attr("data-question-id", node.question_id) +
    attr("data-question-key", node.question_key) +
    attr("data-internal-field", node.internal_field) +
    attr("data-answer-type", answerType) +
    (produces === null
      ? // PC-A13 (P4a): a NON-producing node carrying a `conditional` gets a
        // dedicated hideable hook so the runtime's applyComponentVisibility can
        // toggle it live — it IS in the flattened dependency config (config-dto
        // keeps leaf conditionals) but has no [data-lg-question], so today it
        // never hid live while the SSR dependency-preview did (divergence). A
        // separate attr keeps the §11.6 [data-lg-question] question count pure
        // (that probe must see answer-PRODUCING nodes only, never chrome).
        (node.conditional !== undefined ? attr("data-lg-node", node.question_id) : "")
      : attr("data-lg-question", node.question_id) + attr("data-lg-field", node.internal_field)) +
    (node.required === true ? ` data-required="true"` : "")
  );
}

// ---------------------------------------------------------------------------
// v2.5 Section render context (03 §3.4 headline binding · 13 §13.1 bullet 4 ·
// 11 §11.5 Continue single-control rule)
// ---------------------------------------------------------------------------

// 11 §11.5 frame-owned default Continue placement (section_slot vocabulary,
// 03 §3.3): inside_unit = the authored node position (today's behavior);
// below_unit = suppress the in-node visual, emit ONE control at the END of
// the section subtree in a frame-styled slot.
export type LeadgenContinuePlacement = "inside_unit" | "below_unit";

// 09 §9.5 Section-level design overrides — the parsed
// `leadgen_sections.design_overrides_json` (sparse; priority LAYER 4 in the
// §9.2 pipeline, applied between the themed design (layers 1–3) and per-node
// `design_overrides` (layer 5)). `palette` re-points semantic ROLES for this
// Section's rendering: keyed by a §9.1 role name, each value is
// role-name-or-#hex (§9.5 "role-or-hex"). columnsDefault/gapDefault supply
// Section-local answer-grid defaults, consumed only where the grid
// columns/gap would otherwise fall back to the design tokens.
export interface LeadgenSectionDesignOverrides {
  palette?: Record<string, string>;
  columnsDefault?: number;
  gapDefault?: string;
}

// The per-Section context the composition layer (serve.ts, both preview
// handlers, content_html persist, studio canvas) passes as the OPTIONAL third
// renderSectionComponents argument (03 §3.4). A legacy call site that omits
// it renders byte-identically to the pre-v2.5 output.
export interface LeadgenSectionRenderCtx {
  // §3.4 canonical text — the Section row's headline/subheadline columns. A
  // BOUND QuestionHeadline/Subheadline node renders THIS text (escaped exactly
  // like props.text is), never its own props.
  headline_text: string;
  subheadline_text: string | null;
  // 11 §11.5 Section-owned "is a Continue needed": auto_advance renders ZERO
  // continue controls in either placement.
  continue_mode?: LeadgenContinueMode;
  // 13 §13.1 bullet 4: frame-owned default placement (single-control rule C3).
  continue_placement?: LeadgenContinuePlacement;
  // 03 §3.3 section_slot.continue_style_role ("button_primary") — stamped on
  // the below_unit slot wrapper so frame/theme CSS can key on it; label /
  // loading copy still comes from the Section's ContinueButton node when
  // present, else the preset's theme defaults (§11.5).
  continue_style_role?: string;
  // 09 §9.5 / §9.2 LAYER 4: the Section row's parsed design_overrides_json.
  // Absent or null ⇒ this Section renders byte-identically to a no-overrides
  // call (the compat invariant the pin/parity suites hold).
  design_overrides?: LeadgenSectionDesignOverrides | null;
  // v3.1 §7/§12 (ADDITIVE) — the resolved theme's `controls` (field_height/
  // button_size/corners), threaded straight from resolveTokens()'s
  // EffectiveTokens.theme_controls (a parallel slice, designs/theme.ts — the
  // caller/composition layer supplies it; this module never fetches a theme
  // itself). Consumed ONLY by the §7 field-size resolver (fieldSizeStyle
  // below) as the "funnel theme default" layer for a field's HEIGHT axis.
  // Undefined ⇒ fieldSizeStyle falls back to a documented default controls
  // constant — legacy call sites that omit ctx entirely, or omit this one
  // field, still render byte-identically for every node WITHOUT an authored
  // design_overrides.size (the compat invariant every other ctx field holds).
  theme_controls?: ThemeRecordControls;
}

// Mutable per-render state threading the §11.5 single-control rule through
// the container recursion of ONE renderSectionComponents call: the FIRST
// ContinueButton provides props (later ones render NOTHING — the C3 dedupe is
// a contracted rendering change that applies to pathological legacy content
// too), below_unit captures the winning node for the end-of-subtree slot, and
// auto_advance suppresses every [data-lg-continue] emitter. Created ONCE per
// top-level renderSectionComponents call. renderComponent invoked WITHOUT
// state (single-node paths: parity/per-node tests, the studio per-node
// canvas, the §12.3 Visible filter's leaves) keeps today's per-node behavior
// byte-identically.
interface SectionRenderState {
  ctx: LeadgenSectionRenderCtx | undefined;
  suppressContinue: boolean;
  deferContinue: boolean;
  continueSeen: boolean;
  deferredContinue: LeadgenComponentNode | undefined;
  // PC-A2/PC-6 (P4b): the internal_fields a hand-authored ValidationError node
  // ALREADY reports on (its data-lg-error-for binding). An answer-producing
  // leaf whose field is in this set does NOT get an auto error slot — the
  // authored component is the deliberate override, so there is never a double
  // slot for one field. Computed ONCE per section render from the whole tree.
  errorBoundFields: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// PC-A2 / PC-6 (P4b) — error visibility by DEFAULT (zero extra authoring)
// ---------------------------------------------------------------------------
// Before P4b a validation failure painted only an invisible red border unless
// the author hand-placed a ValidationError node bound to the field
// (data-lg-error-for) — the operator's "was it tested?" gap. Now every
// answer-PRODUCING leaf emits its own empty, hidden error slot in the SSR
// markup, adjacent to the field; the runtime's setFieldError/clearFieldErrors
// (render.ts) fill/clear it exactly as they already did for authored slots, so
// error_text ("If it's wrong, say …") and every format/required message now
// render VISIBLY with no authoring. SSR-only (zero runtime bundle bytes). An
// authored ValidationError for the same field stays the deliberate override
// (collectErrorBoundFields → no auto slot for that field ⇒ never a double).

// The single answer-field an auto error slot would report on, or undefined:
// answer-PRODUCING (catalog.produces !== null) leaves carrying a non-empty
// internal_field. Excludes chrome/controls/affordances/containers (produces
// null), ValidationError (produces null), and the multi-subfield groups
// (NameFieldsGroup / AddressAutocomplete carry no single internal_field).
function autoErrorFieldFor(node: LeadgenComponentNode): string | undefined {
  if (node === null || typeof node !== "object") return undefined;
  const catalog = COMPONENT_CATALOG[node.type];
  if (catalog === undefined || catalog.produces === null) return undefined;
  const field = node.internal_field;
  if (typeof field === "string" && field !== "") return field;
  // PC-A2 (P4b): the multi-subfield groups carry no single internal_field —
  // key their error slot on the question_id so the runtime's group-level
  // required failure (validation.ts groupSubfields) has somewhere to paint.
  if (node.type === "NameFieldsGroup" || node.type === "AddressAutocompleteQuestion") {
    return typeof node.question_id === "string" && node.question_id !== "" ? node.question_id : undefined;
  }
  return undefined;
}

// The internal_fields already owned by a hand-authored ValidationError node
// anywhere in the section tree (its data-lg-error-for binding). Those fields
// suppress their auto slot so an authored override is honored 1:1.
function collectErrorBoundFields(nodes: readonly LeadgenComponentNode[]): ReadonlySet<string> {
  const set = new Set<string>();
  for (const leaf of flattenComponents(nodes)) {
    if (leaf.type === "ValidationError") {
      const field = leaf.internal_field;
      if (typeof field === "string" && field !== "") set.add(field);
    }
  }
  return set;
}

// The auto error slot HTML for ONE node (or "" when it needs none): a hidden,
// empty, theme-styled [data-lg-error-for] element the runtime fills on failure.
// Emitted ONLY inside a section render (state present) and ONLY when no
// authored ValidationError already binds the field.
function autoErrorSlot(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  state: SectionRenderState | undefined,
): string {
  if (state === undefined) return "";
  const field = autoErrorFieldFor(node);
  if (field === undefined) return "";
  if (state.errorBoundFields.has(field)) return "";
  return (
    `<p class="lg-error lg-error-auto" role="alert" aria-live="polite" hidden` +
    attr("data-lg-error-for", field) +
    style({ color: design.validation.errorTextColor }) +
    `></p>`
  );
}

// ---------------------------------------------------------------------------
// v2.5 token-priority LAYERS 4–5 (09 §9.2/§9.4/§9.5) — per-node color/grid
// resolution. Layers 1–3 arrive BAKED INTO `design` (resolveTokens feeds the
// effective design object); layer 6 (runtime state) stays CSS-class-driven.
//
//   LAYER 4 — Section design_overrides (ctx.design_overrides): `palette`
//   re-points ROLES for this Section's rendering; columnsDefault/gapDefault
//   fill the answer-grid slots that would otherwise fall back to design
//   tokens. Defaults consult the Section palette ONLY where the design
//   default IS a role's base token (primaryButton.background/color =
//   button_primary_bg/button_primary_text per ROLE_TO_BASE_TOKEN); the other
//   color-typed defaults (iconCard.iconColor, categoryLabel.color,
//   rangeQuestion.filledTrackColor) are role-less design tokens — a Section
//   palette entry reaches them only through a role-VALUED per-node override.
//
//   LAYER 5 — per-node design_overrides VALUES (§9.4, the 5 color-typed keys
//   in COLOR_TYPED_OVERRIDE_KEYS): a value is looked up as a role FIRST —
//   resolved against the design via baseTokenForRole, AFTER applying any
//   Section palette re-pointing; a value starting `#` is a LEGACY LITERAL
//   rendered as-is (existing stored hex keeps rendering byte-identically);
//   any other string renders as-is (defensive — validation rejects it
//   upstream via `invalid_override_value`).
// ---------------------------------------------------------------------------

// §9.4 value semantics: role → the design's value for that role; `#…` legacy
// literal — and any other string (defensive) — pass through as-is.
function roleOrLiteral(design: DefaultFunnelDesign, value: string): string {
  if (value.startsWith("#")) return value;
  if (isFunnelTokenRole(value)) return baseTokenForRole(design, value);
  return value;
}

// LAYER 4 palette re-point: the Section's value for `role` — resolved to a
// CSS color via the §9.4 role-or-hex semantics — or undefined when this
// Section re-points nothing for that role (entries read defensively; the
// palette is parsed JSON).
function sectionRoleValue(
  design: DefaultFunnelDesign,
  ctx: LeadgenSectionRenderCtx | undefined,
  role: FunnelTokenRole,
): string | undefined {
  const entry = ctx?.design_overrides?.palette?.[role];
  if (typeof entry !== "string" || entry === "") return undefined;
  return roleOrLiteral(design, entry);
}

// LAYER 5: resolve a per-node COLOR-TYPED override value (§9.4). The node
// picks a ROLE (or a legacy `#hex` literal); a role consults the Section
// re-pointing FIRST (layer 4 may re-point where the role resolves for this
// Section), then the effective design (layers 1–3).
function ovColor(
  node: LeadgenComponentNode,
  key: keyof LeadgenDesignOverrides,
  design: DefaultFunnelDesign,
  ctx: LeadgenSectionRenderCtx | undefined,
): string | undefined {
  const raw = ov(node, key);
  if (raw === undefined) return undefined;
  if (raw.startsWith("#")) return raw; // legacy literal — byte-preserved compat path
  if (isFunnelTokenRole(raw)) {
    return sectionRoleValue(design, ctx, raw) ?? baseTokenForRole(design, raw);
  }
  return raw; // defensive as-is (validation rejects upstream)
}

// LAYER 4 grid defaults (§9.5) — consumed only where the node left the slot
// unset (per-node design_overrides/props win over Section wins over design).
function sectionColumnsDefault(ctx: LeadgenSectionRenderCtx | undefined): number | undefined {
  // Round-4 A-7 (P1b): a Section-level default of 1 (the "stack" preset — one
  // card per row) is a first-class value now that renderCardGrid clamps 1..5.
  // This reader passes ANY finite number straight through; the consuming clamp
  // is the single bound, so a columnsDefault of 1 renders a full-width stack.
  const v = ctx?.design_overrides?.columnsDefault;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function sectionGapDefault(ctx: LeadgenSectionRenderCtx | undefined): string | undefined {
  const v = ctx?.design_overrides?.gapDefault;
  return typeof v === "string" && v !== "" ? v : undefined;
}

// ---------------------------------------------------------------------------
// Rework §6.5 — authored "Other" affordance (the §10-retired choiceDisplay /
// splitChoicesForOtherGroup / renderOtherGroupTail mechanism is fully removed).
// ---------------------------------------------------------------------------
// props.other = {enabled?, label?, choices} (content-schema.ts validateOtherEditor,
// single-select choice groups only — the §6.2 matrix `other_editor` flag).
// Base choices render UNCHANGED; ONE trailing affordance (styled as a choice of
// the SAME family, with a chevron) reveals a hidden native <select> of the
// authored values (first option placeholder "Choose…"). Absent/disabled/empty
// `props.other` ⇒ "" ⇒ byte-identical (R4 A-6a).
interface LeadgenOtherConfig {
  label: string;
  choices: LeadgenChoice[];
}

function readOtherConfig(node: LeadgenComponentNode): LeadgenOtherConfig | undefined {
  const raw = node.props?.["other"];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (r["enabled"] !== true) return undefined;
  const choices = Array.isArray(r["choices"]) ? (r["choices"] as LeadgenChoice[]) : [];
  if (choices.length === 0) return undefined;
  const label = r["label"];
  return { label: typeof label === "string" && label.trim() !== "" ? label : "Other", choices };
}

// The chevron affordance (tokens.dropdown.chevronSvgFill — reused, no new
// color invented) marking the trailing choice as an opener, never a stored
// value itself (deliberately NO data-lg-choice/data-value, §6.5's "Other"
// affordance never records on its own click — activating it reveals the
// <select> below, which IS the real answer control).
function otherChevronSvg(design: DefaultFunnelDesign): string {
  return (
    `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">` +
    `<path d="M6 9l6 6 6-6" stroke="${esc(design.dropdown.chevronSvgFill)}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

// The hidden native <select> revealed by the trigger — a REAL answer control
// (data-lg-input, so the EXISTING generic dropdown-change recording mechanism
// records an Other pick with ZERO new engine code; nests inside the group so
// its `closest("[data-lg-field]")` resolves via the group root's hydration()).
// Base-hidden via the native `hidden` attribute (S2.3 removes it on activation
// — no new CSS needed, unlike the ✓-marker's selection-state visibility).
function otherSelectMarkup(other: LeadgenOtherConfig): string {
  const options = other.choices
    .map(
      (c) =>
        `<option value="${esc(c.value)}"${attr("data-lg-choice", c.value)}${attr("data-analytics-id", c.analytics_id)}>${esc(c.label)}</option>`,
    )
    .join("");
  return (
    // "lg-other-panel" is kept as a class alongside "lg-other-select"
    // (continuity with the pre-§6.5 B9 naming vocabulary — the hidden-
    // visibility surface matrix test keys on it by class); the generic
    // `[hidden]{display:none}` terminal CSS guard matches the ATTRIBUTE, not
    // this class, so no dedicated stylesheet rule is required either way.
    `<select class="lg-input lg-other-select lg-other-panel" data-lg-input data-lg-other-panel hidden` +
    ` aria-label="${esc(other.label)} — choose one">` +
    `<option value="" selected disabled>Choose…</option>` +
    options +
    `</select>`
  );
}

// §6.6 ✓-in-selected marker resolution (per-choice style override > node
// override > theme Selected axis). Returns 'mark' only when SOME layer
// explicitly resolves to it; 'wash' (no marker span emitted) otherwise — so a
// node/choice with none of the three layers set renders byte-identically to
// pre-§6.6 (the theme's existing card-only markCheck ternary is the base case
// this generalizes to buttons/YesNo too).
function resolveSelectedMarker(
  node: LeadgenComponentNode,
  choiceStyle: LeadgenChoiceStyle | undefined,
  design: DefaultFunnelDesign,
): LeadgenSelectedMarker {
  const choiceMarker = choiceStyle?.selected_marker;
  if (choiceMarker !== undefined) return choiceMarker;
  const nodeMarker = propStr(node, "selected_marker");
  if (nodeMarker === "mark" || nodeMarker === "wash") return nodeMarker;
  return readButtonStyle(design)?.selected === "mark" ? "mark" : "wash";
}

// The §6.6 mark-mode markup: a leading hollow circle on a RESTING item, a
// filled ✓ badge revealed on a SELECTED item (mirrors the EXISTING card
// markCheck ternary — presets.ts renderCardGrid — which relies on styles.ts
// CSS keyed on the selection classes the runtime already toggles to show/hide
// it; class names match the P0 golden pack pins 6.6-visitor-selected verbatim
// so a sibling CSS pass has an exact, unambiguous target). "" when the
// resolved marker is 'wash' (byte-identical to pre-§6.6 for every button/YesNo
// choice — cards already had their own independent markCheck ternary, kept
// as-is above).
function selectedMarkerMarkup(marker: LeadgenSelectedMarker): string {
  if (marker !== "mark") return "";
  return (
    `<span class="lg-check-hollow" aria-hidden="true"></span>` +
    `<span class="lg-check-badge" aria-hidden="true">` +
    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4 10-11" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
    `</span>`
  );
}

// ---------------------------------------------------------------------------
// R2 P1 §① — the AUTHOR-OPTED ✓ marker's styling (owner A.1 #4 "here is
// another buttons structure we need to support for the 'Question grid'
// buttons (the √ inside the button for the chosen answer)"; probe 4a: PERFECT
// anatomy, "contrast subtle").
// ---------------------------------------------------------------------------
//
// ROOT CAUSE: resolveSelectedMarker (above) resolves the marker per CHOICE >
// per NODE > theme, so selectedMarkerMarkup emits the hollow+badge spans
// whenever an AUTHOR opts one question in — with no theme involved. But the
// CSS that turns those spans into a hollow circle (resting) and a filled ✓
// disc (selected) is emitted by styles.ts ONLY inside the theme branch
// (funnelChromeCss → pushButtonStyleRules, itself reached only when the design
// carries a theme button-style stash, and then only under selected==="mark").
// With no mark theme the badge therefore rendered with NO rules at all: an
// unhidden, uncircled 11px WHITE ✓ on the light selected wash (#E8EEF4) —
// "faint white on light wash" — and visible on the RESTING button too.
//
// WHY THIS IS A STYLE BLOCK AND NOT A PER-INSTANCE `style` ATTRIBUTE
// (conductor ruling: use the per-node scoped-CSS mechanism, else say so with
// evidence). The per-node mechanism is `style="…"` + custom properties
// consumed by EXISTING sheet rules (appearanceStyleEntries → --lg-answer-bg /
// --lg-field-border / --lg-sel-bg). It cannot carry this one, for two
// checkable reasons:
//   1. the marker is a RESTING↔SELECTED SWAP — `.lg-btn-answer.lg-selected
//      .lg-check-badge{display:inline-flex}` — a descendant-state selector. A
//      `style` attribute can only declare the element's OWN properties, and an
//      inline `display:none` on the badge would additionally BEAT any later
//      rule, so the swap could never fire; and
//   2. nothing in the runtime could flip it either: render.ts
//      applySelectionClasses toggles SELECTED_CLASS + aria-checked (P5 S5c
//      ADJ-R8) on `[data-lg-choice]` BUTTONS only — it never touches the
//      marker spans.
// There is also no existing base rule to feed with a var: the base sheet has
// no `.lg-check-*` rule at all (that is the bug).
//
// So the fallback the ruling authorizes: a MINIMAL, DEMAND-DRIVEN block —
// emitted once per section render, ONLY when that section's own content
// actually resolves a 'mark' marker on the button/YesNo family AND the design
// sheet does not already carry the rules (mark theme). A funnel that never
// opts in gets ZERO extra bytes anywhere, so the byte-safe-additive contract
// (a wash/absent theme adds nothing) holds unchanged. The rule bodies are
// imported from styles.ts (selectedMarkRules) — one definition, no drift —
// and are self-scoping: they match only elements this renderer stamped with
// `[data-card-select="mark"]`.
function nodeResolvesMark(node: LeadgenComponentNode, design: DefaultFunnelDesign): boolean {
  // Mirrors each renderer's OWN `anyMark` computation 1:1 (renderButtonAnswerGroup
  // / renderTwoButtonYesNo) — the two families that stamp data-card-select on a
  // `.lg-answer-group` root, which is what these rules key on. (The card family
  // stamps it on `.lg-card-grid` and paints a different marker element,
  // `.lg-card-check`; it is untouched here.)
  if (node.type === "ButtonAnswerGroup") {
    return choiceList(node).some((c) => resolveSelectedMarker(node, c.style, design) === "mark");
  }
  if (node.type === "TwoButtonYesNo") {
    const yesStyle = node.props?.["yesStyle"] as LeadgenChoiceStyle | undefined;
    const noStyle = node.props?.["noStyle"] as LeadgenChoiceStyle | undefined;
    return (
      resolveSelectedMarker(node, yesStyle, design) === "mark" ||
      resolveSelectedMarker(node, noStyle, design) === "mark"
    );
  }
  return false;
}

function selectedMarkStyleBlock(
  nodes: readonly LeadgenComponentNode[],
  design: DefaultFunnelDesign,
): string {
  // A mark THEME already ships these rules in its own sheet — never duplicate.
  if (readButtonStyle(design)?.selected === "mark") return "";
  // flattenComponents descends into layout containers AND question grids, so a
  // grid child that opts in is found exactly like a top-level node.
  const opted = flattenComponents(nodes).some(
    (n) => typeof n === "object" && n !== null && nodeResolvesMark(n, design),
  );
  if (!opted) return "";
  // Self-scoping (no design-scope prefix): these selectors only ever match the
  // marker spans this renderer emits inside a stamped answer group.
  return `<style>${selectedMarkRules("", design).join("")}</style>`;
}

// LeadGen Rework §8.4 gap round (2026-07-23): the theme "Answer layout:
// Card" NEW enum value (Image23, P0 pack data-pin 8.4-title-subtitle-card-*)
// — a full-width title+subtitle card replaces the plain grid/list button.
// choice.title (bold) / choice.subtitle (muted) are ALREADY additive
// LeadgenChoice fields (the P2 card-grid title/subtitle depth work,
// content-schema.ts) — this is a NEW RENDERING TREATMENT for the SAME data,
// not new content. A choice without title falls back to its label (so a
// Card-themed group with only label-only choices — incl. TwoButtonYesNo,
// which has no title/subtitle fields on its fixed Yes/No pair at all —
// still renders title-only, never blank); a choice without subtitle omits
// the subtitle span entirely (byte-minimal, no empty span). The §6.6 marker
// rides the EXACT SAME selectedMarkerMarkup() call every other layout uses —
// "the marker interplay" is exactly this: ONE marker mechanism, repositioned
// for the card context by a dedicated styles.ts rule (gridItemColumnEntries-
// style separation of concerns), never a second, parallel marker system.
function buttonInnerContent(
  isCard: boolean,
  marker: LeadgenSelectedMarker,
  label: string,
  title: string | undefined,
  subtitle: string | undefined,
): string {
  const markerHtml = selectedMarkerMarkup(marker);
  if (!isCard) return `${markerHtml}${esc(label)}`;
  const t = typeof title === "string" && title !== "" ? title : label;
  const s = typeof subtitle === "string" && subtitle !== "" ? subtitle : undefined;
  return (
    `${markerHtml}<span class="lg-tscard-title">${esc(t)}</span>` +
    (s !== undefined ? `<span class="lg-tscard-subtitle">${esc(s)}</span>` : "")
  );
}

// ---------------------------------------------------------------------------
// Rework §6.7 — effective columns = min(authored, choiceCount); wrapped last
// row centered (L-195: explicit track/justify rules, never margin:auto).
// ---------------------------------------------------------------------------

// `emitOverride` mirrors today's exact semantics for WHEN an override is
// worth emitting: an AUTHORED value always was (and still is, now additionally
// clamped to choiceCount); an UNAUTHORED value newly emits ONLY when the
// choiceCount actually pulls the effective count below the design default (the
// #9 under-filled-grid fix) — so a node with enough choices to already fill
// the default column count renders BYTE-IDENTICAL --lg-cols output to pre-§6.7
// (R4 A-6a: this fix changes bytes only where the OLD output was the actual bug).
// `hasPartialRow` is true only when the choices do NOT divide evenly into
// `cols` — an exact-fit grid (incl. every P2a/P3a-backcompat frozen fixture)
// gets neither a new --lg-cols nor a new justify-content, byte-identical.
interface GridColumnsPlan {
  cols: number;
  emitOverride: boolean;
  hasPartialRow: boolean;
}
function planGridColumns(authoredCols: number | undefined, defaultCols: number, choiceCount: number): GridColumnsPlan {
  const base = authoredCols ?? defaultCols;
  const clamped = choiceCount > 0 ? Math.min(base, choiceCount) : base;
  const cols = clampInt(clamped, 1, 5);
  const emitOverride = authoredCols !== undefined || cols !== defaultCols;
  const hasPartialRow = choiceCount > 0 && cols > 1 && choiceCount % cols !== 0;
  return { cols, emitOverride, hasPartialRow };
}

// R2 P2 FIX-FIRST (MAJOR-2, adversarial review) — the theme's card layout OWNS
// the column axis. Contract §4 end-state 5: "the two-line layout + styling is
// owned by the THEME (a `card`/full-width layout axis)"; the control's own
// label is "Full-width cards (Image23)", and Image23's anatomy is a vertical
// stack of full-width rows (incl. the trailing "Other" row) — never a 2-up.
//
// BEFORE: the plan was computed from the SECTION's columns only, so a themed
// group inherited the design's multi-column default. styles.ts's shipped
// `.lg-answer-group[data-btn-layout="card"]{grid-template-columns:1fr}` rule
// (§8.4 gap round) already forced ONE EXPLICIT track — but a partial trailing
// row ALSO emitted the §6.7 centering machinery (--lg-tracks + per-item
// --lg-gc-start/--lg-gc-end "span 2"), and a 2-track span against a 1-track
// explicit template makes the grid FABRICATE an implicit second column: the
// live 2-up half-width rows the review measured. The container CSS and the
// item geometry disagreed about the axis; this makes the RENDER coherent with
// the axis the theme already owns in CSS.
//
// CHOICE (stated for the record): the theme wins UNCONDITIONALLY here — an
// explicit section-level `columns` does NOT re-open the axis — because the
// already-shipped container rule above is itself unconditional (an authored
// --lg-cols has only ever been a var() FALLBACK that rule never consults), so
// honoring a section override would need that CSS rule relaxed too and would
// contradict "owned by the theme". Per-element freedom INSIDE the card (size,
// colors, title/subtitle) is untouched. Non-card themes: identical plan as
// before, byte-for-byte.
function planAnswerGridColumns(
  authoredCols: number | undefined,
  defaultCols: number,
  choiceCount: number,
  isCard: boolean,
): GridColumnsPlan {
  if (!isCard) return planGridColumns(authoredCols, defaultCols, choiceCount);
  return { cols: 1, emitOverride: defaultCols !== 1, hasPartialRow: false };
}

// Rework §6.7 FIX-FIRST (adversarial review F1, 2026-07-22): the PRIOR
// trailingRowCenterOffset used a SINGLE-track grid-column-start offset
// (Math.floor((cols-remainder)/2)) which can only express WHOLE-track
// shifts. For an EVEN remainder (5-in-3: cols=3, remainder=2) the empty
// space is ONE track, and floor(1/2)=0 — the wrapped row rendered
// LEFT-ALIGNED (columns 1-2 filled, column 3 empty), reproducing the exact
// #9 complaint AC #9 names verbatim ("a 5-card 3-column component centers
// its last row"). An ODD remainder (4-in-3, 7-in-3: a single leftover) only
// happened to land dead-center because splitting exactly 2 empty tracks in
// half gives a whole number either way — the old formula was never actually
// centering, it was coincidentally correct for exactly one remainder parity.
//
// FIX: when (and ONLY when) a partial trailing row exists, the WHOLE grid's
// track count doubles for THAT ONE INSTANCE. --lg-cols itself (the real
// logical column count) stays COMPLETELY UNTOUCHED; the doubled value rides
// a SEPARATE inline custom property, --lg-tracks (see answerGroupRootStyle /
// renderCardGrid / renderMultiChoiceCardGroup's
// `hasPartialRow ? \`repeat(${"${cols*2}"}, ...)\` : undefined` emission),
// which styles.ts's shared class rule consumes via a var() fallback:
// `grid-template-columns:var(--lg-tracks, repeat(var(--lg-cols, N),
// minmax(0,1fr)))`.
//
// FIX-FIRST F2 (adversarial review, 2026-07-22): F1 originally emitted the
// doubled value as a literal INLINE `grid-template-columns` override
// instead of a custom property. That out-ranked the mobile media-query
// collapse rule (`.lg-card-grid{grid-template-columns:1fr}` at ≤480px) by
// CSS cascade specificity — inline ALWAYS beats a class selector, media
// query or not — so a partial-row card grid stayed doubled (3 cramped
// columns) at 375px instead of collapsing to 1, while an exact-fit control
// correctly collapsed (reviewer-proved live in Chromium). Emitting the
// value as a custom property instead fixes this: declaring a variable is
// NOT declaring grid-template-columns, so it cannot out-rank anything — the
// REAL property is still set by the class rule, which the mobile class rule
// (same specificity, later source order, its own literal `1fr` never
// references the variable) still beats exactly as it always could. --lg-cols
// (and every OTHER consumer of it) is untouched either way. EVERY item
// spans 2 of these half-tracks (`grid-column-end:"span 2"`) so a full row's
// rendered width stays PIXEL-EQUIVALENT
// to the un-doubled grid for a FULL row: with N real 1fr tracks of computed
// width W and N-1 gaps of size G, W = (100% - (N-1)*G) / N; doubling to 2N
// half-tracks of width w with 2N-1 gaps of the SAME G gives
// w = (100% - (2N-1)*G) / (2N), and a 2-track span's rendered width (2w+G,
// since an item spanning multiple tracks includes the internal gap in its own
// box per the CSS Grid spec — no visible seam) reduces ALGEBRAICALLY to the
// SAME W (both equal 100%/N - (N-1)*G/N) — full rows are byte-for-byte pixel
// identical to today. The trailing (partial) row's items ADDITIONALLY get an
// EXPLICIT grid-column-start at HALF-TRACK granularity — the granularity a
// single-track grid could never offer for an EVEN remainder (there is no
// whole single-track offset that splits an ODD number of empty half-slots
// symmetrically, e.g. 3-2=1 empty slot). Empty half-tracks to distribute =
// 2*(cols-remainder); split evenly (cols-remainder) on each side (always a
// whole half-track count, whatever the parity of cols-remainder) — verified
// centered by direct pixel-position algebra (both margins reduce to the
// identical expression; see the phase report for the worked 5-in-3 example).
//
// A GRID-based fix (not the P0 pack's flexbox `display:flex;flex-wrap:wrap;
// justify-content:center`) was deliberately chosen: BOTH `.lg-answer-group`
// and `.lg-card-grid` are measured via `getComputedStyle(...).
// gridTemplateColumns` by the PRE-EXISTING pinned test-ui/leadgen-p1-
// geometry.gesture.spec.ts (btnTracks/multiTracks/cardTracks assertions, on
// both the studio canvas AND the live /lg funnel, desktop AND mobile —
// e.g. "MultiChoiceCardGroup with columns:3 authored -> 3 grid tracks",
// "mobile: card grid collapses to 1 track") — switching either class to
// flexbox would report gridTemplateColumns:"none" and break that gate
// outright. The doubled-track technique keeps display:grid throughout, so
// that pinned gate (which only ever exercises EXACT-FIT fixtures — 2-in-2
// buttons, 2-in-2 yes/no, 3-in-3 cards — never a partial row) is untouched.
//
// Returns {} for every item NOT in a partial-row grid (an exact-fit grid,
// incl. every P2a/P3a backcompat frozen fixture, always takes this branch —
// {} — so its output stays byte-identical to pre-fix).
//
// FIX-FIRST F2 FOLLOW-UP (same review pass, 2026-07-22): a SECOND inline-vs-
// mobile-collapse conflict, same root cause as the container-level one — a
// per-item literal `grid-column-start`/`grid-column-end` is INLINE, so it
// keeps demanding a 2-track span even once the CONTAINER'S mobile rule
// collapses to a single explicit `1fr` column; a span that exceeds the
// explicit template forces the grid to fabricate IMPLICIT extra columns to
// satisfy it (live-measured: 5 tracks, "133px 38px 38px 38px 38px" — NOT the
// intended single full-width column). FIX: the SAME custom-property
// indirection as the container fix — emit `--lg-gc-start`/`--lg-gc-end`
// (inline custom properties, cannot themselves out-rank anything) instead of
// the literal properties; a shared class rule (styles.ts) consumes them via
// var(), and `.lg-card-grid`'s mobile rule resets them to `auto` for its
// children specifically (buttons never collapse, so their items keep
// consuming the variables on mobile too, unchanged).
export function gridItemColumnEntries(index: number, total: number, cols: number): Record<string, string | undefined> {
  if (cols <= 1 || total <= 0) return {};
  const remainder = total % cols;
  if (remainder === 0) return {};
  const rowStart = total - remainder;
  if (index < rowStart) return { "--lg-gc-end": "span 2" };
  const start = 1 + (cols - remainder) + (index - rowStart) * 2;
  return { "--lg-gc-start": String(start), "--lg-gc-end": "span 2" };
}

// ---------------------------------------------------------------------------
// chrome
// ---------------------------------------------------------------------------

export function renderProgressBar(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const mode = propStr(node, "mode") === "step" ? "step" : "percent";
  let pct = propNum(node, "percent") ?? 0;
  const step = propNum(node, "step");
  const total = propNum(node, "totalSteps");
  let label = propStr(node, "label");
  // ARIA progressbar values (accessibility.md: role=progressbar + aria-valuenow;
  // valuemin 0, valuemax 100 or the step count, valuenow from the mode/props).
  let ariaNow = clampInt(pct, 0, 100);
  let ariaMax = 100;
  if (mode === "step" && step !== undefined && total !== undefined && total > 0) {
    pct = (step / total) * 100;
    label = label ?? `Step ${step} of ${total}`;
    ariaMax = Math.round(total);
    ariaNow = clampInt(step, 0, ariaMax);
  }
  const width = `${clampInt(pct, 0, 100)}%`;
  return (
    // 03 §3.3: data-lg-progress marks the engine's progress mount; data-mode
    // tells it step vs percent semantics.
    `<div class="lg-progress"${hydration(node)} data-lg-progress data-mode="${mode}"` +
    ` role="progressbar" aria-valuemin="0" aria-valuemax="${ariaMax}" aria-valuenow="${ariaNow}"` +
    (label !== undefined ? ` aria-valuetext="${esc(label)}"` : "") +
    `>` +
    // data-lg-progress-bar / data-lg-progress-label (09 §9.1 "no visual
    // change"): the engine's updateProgress targets these hooks — width on
    // the fill, text on the label — so hydration NEVER wipes the
    // .lg-progress-track/.lg-progress-fill markup (render.ts keeps the
    // textContent fallback for legacy hook-less markup only).
    `<div class="lg-progress-track">` +
    `<div class="lg-progress-fill" data-lg-progress-bar${style({ width, background: design.progress.fillColor })}></div>` +
    `</div>` +
    (label !== undefined ? `<div class="lg-progress-text" data-lg-progress-label>${esc(label)}</div>` : "") +
    `</div>`
  );
}

export function renderHeaderLogo(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const logoMediaId = propStr(node, "logoMediaId");
  const logoUrl = propStr(node, "logoUrl");
  const siteName = propStr(node, "siteName") ?? "";
  const accent = propStr(node, "accent");
  const inner =
    logoUrl !== undefined && logoUrl !== ""
      ? `<img class="lg-logo-img" src="${esc(logoUrl)}" alt="${esc(siteName)}" decoding="async"${style({ "max-height": design.header.logoFontSize })}>`
      : `<span class="lg-logo"${style({ color: design.header.logoColor, "font-family": design.header.logoFontFamily })}>${esc(siteName)}` +
        (accent !== undefined
          ? `<span class="lg-logo-accent"${style({ color: design.header.logoAccentColor })}>${esc(accent)}</span>`
          : "") +
        `</span>`;
  return (
    `<header class="lg-header"${hydration(node)}${attr("data-logo-media-id", logoMediaId)}>` +
    `<div class="lg-header-inner">${inner}</div>` +
    `</header>`
  );
}

export function renderBackButton(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const label = propStr(node, "label") ?? "Back";
  return (
    // 03 §3.3: data-lg-back is the engine's back-navigation hook.
    `<button type="button" class="lg-back"${hydration(node)} data-lg-back${style({ color: design.backButton.color })} aria-label="${esc(label)}">` +
    `<span aria-hidden="true">&#8592;</span> ${esc(label)}` +
    `</button>`
  );
}

export function renderDisclosureLink(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const label = propStr(node, "label") ?? "Disclosure";
  // panelHtml is author-authored rich text — it flows through escapeHtml so no
  // markup is injected (the runtime renders it into a text panel).
  const panelHtml = propStr(node, "panelHtml") ?? "";
  return (
    `<div class="lg-disclosure-wrap"${hydration(node)}>` +
    `<button type="button" class="lg-disclosure"${style({ color: design.disclosure.color })} aria-expanded="false">${esc(label)}</button>` +
    `<div class="lg-disclosure-panel" hidden>${esc(panelHtml)}</div>` +
    `</div>`
  );
}

// 08 §8.3 StepIndicator: dots/steps chrome. Defensive props (steps>=1;
// current clamped into 1..steps). a11y (accessibility.md): role="progressbar"
// + aria-valuemin/max/now (+ the derived "Step X of Y" as aria-valuetext, the
// renderProgressBar step-mode idiom). Dots are fully class-driven (.lg-step /
// [data-active] state in the scoped chrome CSS) — no inline style.
export function renderStepIndicator(node: LeadgenComponentNode, _design: DefaultFunnelDesign): string {
  const steps = Math.max(1, Math.round(propNum(node, "steps") ?? 1));
  const current = clampInt(propNum(node, "current") ?? 1, 1, steps);
  let dots = "";
  for (let i = 1; i <= steps; i++) {
    dots += `<span class="lg-step"${i === current ? ` data-active="true"` : ""} aria-hidden="true"></span>`;
  }
  return (
    `<div class="lg-steps"${hydration(node)} role="progressbar"` +
    ` aria-valuemin="1" aria-valuemax="${steps}" aria-valuenow="${current}"` +
    ` aria-valuetext="${esc(`Step ${current} of ${steps}`)}">` +
    dots +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// affordances (copy)
// ---------------------------------------------------------------------------

export function renderCategoryLabel(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
): string {
  // §9.4 layer 5: a role-valued featureColor resolves via the (possibly
  // Section-re-pointed) role; legacy `#hex` renders as-is.
  const color = ovColor(node, "featureColor", design, ctx) ?? design.categoryLabel.color;
  return (
    `<div class="lg-category"${hydration(node)}${style({ color, "letter-spacing": design.categoryLabel.letterSpacing })}>` +
    `${esc(propStr(node, "text"))}</div>`
  );
}

export function renderQuestionHeadline(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
): string {
  // 03 §3.4: a BOUND node's text IS the Section headline column (sectionCtx),
  // escaped exactly like props.text — bound vs unbound differ ONLY in the text
  // source. ctx absent + bound node → empty text (never a throw). An UNBOUND
  // legacy node with props.text renders byte-identically to v2.4.
  const text = node.bind === "section_headline" ? ctx?.headline_text : propStr(node, "text");
  // v3.1 R3b E2-C1: the Style tab's "Text color role" control (data-style-
  // text-block) has always covered this type — the RENDERER never consumed
  // it. Same §9.4 layer-5 role-or-hex resolution the choice/button families
  // use; absent override falls to the SAME design.headline.color already
  // unconditionally emitted here (byte-identical when unauthored).
  const color = ovColor(node, "featureColor", design, ctx) ?? design.headline.color;
  return (
    `<h1 class="lg-headline"${hydration(node)}` +
    style({ "font-family": design.headline.fontFamily, color }) +
    `>${esc(text)}</h1>`
  );
}

export function renderSubheadline(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
): string {
  // 03 §3.4 — same rule as renderQuestionHeadline for the subheadline column
  // (a NULL column renders as empty text, exactly like an absent props.text).
  const text = node.bind === "section_subheadline" ? ctx?.subheadline_text : propStr(node, "text");
  // v3.1 R3b E2-C1: wire the pre-existing Style-tab "Text color role" control.
  const color = ovColor(node, "featureColor", design, ctx) ?? design.subheadline.color;
  return (
    `<p class="lg-subheadline"${hydration(node)}${style({ color })}>` +
    `${esc(text)}</p>`
  );
}

// ---------------------------------------------------------------------------
// range family (§14.5)
// ---------------------------------------------------------------------------

function formatRangeValue(n: number, format: string | undefined, currency: string): string {
  if (format === "currency") return `${currency}${n.toLocaleString("en-US")}`;
  return n.toLocaleString("en-US");
}

// R2 P4 §6.8 (design-pack studio-panels.html §6.8 "Rendered visitor examples")
// — the ONE handle element every slider type paints ON the track. It is a CHILD
// OF `.lg-range-fill`, pinned by CSS to the fill's edge (left:100% for the
// single/max handle, left:0 for the min handle): the runtime ALREADY writes the
// fill's width live (render.updateRangeDisplay), so the handle follows the value
// with zero engine bytes. The probe's "handle renders detached ~20px BELOW the
// track" was the native <input type=range> sitting in NORMAL FLOW under the
// track div and painting its own thumb there; the input now overlays the track
// (styles.ts .lg-range-input) with a transparent thumb, so the handle a visitor
// grabs is exactly the handle they see. Decorative (the real control is the
// input) ⇒ aria-hidden.
function rangeHandle(
  rq: DefaultFunnelDesign["rangeQuestion"],
  design: DefaultFunnelDesign,
  variant: "" | "min" | "max",
  readout?: string,
  filled?: string,
): string {
  return (
    `<div class="lg-range-handle${variant === "" ? "" : ` lg-range-handle-${variant}`}" aria-hidden="true"` +
    style({
      background: rq.thumbBackground,
      border: rq.thumbBorder,
      "box-shadow": rq.thumbShadow,
    }) +
    `>` +
    // Image12/Image13: each handle of a two-handle slider carries its own value
    // readout pill riding the handle (so it tracks the value for free).
    (readout === undefined
      ? ""
      : `<span class="lg-range-handle-value"${style({ background: filled, color: design.color.card })}>${esc(readout)}</span>`) +
    `</div>`
  );
}

// The min/max caption line (§6.8 `.slider-minmax`; Image10 "$5,000"/"$500,000",
// Image11 "0"/"100", Image13 "$0"/"$100 000") — the probe found it MISSING on
// stepper/from_to/dual_range.
function rangeMinMax(node: LeadgenComponentNode, min: number, max: number, format: "number" | "currency", currency: string): string {
  const minLabel = propStr(node, "minLabel") ?? formatRangeValue(min, format, currency);
  const maxLabel = propStr(node, "maxLabel") ?? formatRangeValue(max, format, currency);
  return `<div class="lg-range-minmax"><span>${esc(minLabel)}</span><span>${esc(maxLabel)}</span></div>`;
}

function renderRange(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  format: "number" | "currency",
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  const rq = design.rangeQuestion;
  const min = propNum(node, "min") ?? 0;
  const max = propNum(node, "max") ?? 100;
  const step = propNum(node, "step") ?? 1;
  const value = propNum(node, "default") ?? min;
  const span = max - min;
  const pct = span > 0 ? clampInt(((value - min) / span) * 100, 0, 100) : 0;
  const currency = propStr(node, "currency") ?? "$";
  // §9.4 layer 5: role-valued rangeColor resolves via the (possibly Section-
  // re-pointed) role; legacy `#hex` renders as-is.
  const filled = ovColor(node, "rangeColor", design, ctx) ?? rq.filledTrackColor;
  const displayValue = formatRangeValue(value, format, currency);
  return (
    labelLine(node) +
    // S2-3 (register §C): data-currency rides the wrapper so the runtime's
    // updateRangeDisplay can rebuild the live value text (`{currency}{grouped}`)
    // byte-identically to this server paint (formatRangeValue) as the slider
    // moves. Emitted only for the currency format; number format leaves it off
    // (empty prefix).
    `<div class="lg-range"${hydration(node)} data-format="${format}"${attr("data-currency", format === "currency" ? currency : undefined)}>` +
    `<div class="lg-range-value"${style({ color: rq.valueColor, "font-family": rq.valueFontFamily })}>${esc(displayValue)}</div>` +
    // §6.8 single: readout ABOVE a track carrying fill + ONE handle, captions
    // below. The input is INSIDE the track (CSS overlays it edge-to-edge,
    // inflated by one thumb width so the invisible native thumb's travel is
    // exactly the visible handle's 0–100%) — that is the detached-handle fix.
    `<div class="lg-range-track"${style({ "background-color": rq.unfilledTrackColor })}>` +
    `<div class="lg-range-fill"${style({ width: `${pct}%`, "background-color": filled })}>` +
    rangeHandle(rq, design, "") +
    `</div>` +
    // S2-3: data-lg-input marks the range so the engine's delegated input
    // listener records the dragged value AND drives updateRangeDisplay live.
    // min/max/step/value are the native slider semantics (unchanged); the
    // runtime reads min/max off these attributes to recompute the fill.
    `<input class="lg-range-input" type="range" role="slider" data-lg-input` +
    ` min="${min}" max="${max}" step="${step}" value="${value}"` +
    ` aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}"` +
    attr("aria-label", propStr(node, "ariaLabel") ?? node.internal_field) +
    attr("data-internal-field", node.internal_field) +
    `>` +
    `</div>` +
    rangeMinMax(node, min, max, format, currency) +
    // CONDUCTOR FIX (P4b regression): the auto error slot is the LAST CHILD of
    // the field box (`.lg-range`), never a card-level sibling — "" (no slot)
    // is a no-op concatenation, byte-identical to pre-fix.
    slot +
    `</div>` +
    // PC-A10 (drift honesty): CONTENT_PROP_FIELDS advertises a Helper text
    // control for the Slider (NumberRangeQuestion) — wire it here (the ONE
    // shared bespoke range renderer), the same fieldHelperLine pattern the
    // wired button/dropdown/text-input types already use ("" when unauthored
    // — byte-additive).
    fieldHelperLine(node)
  );
}

// ---------------------------------------------------------------------------
// Rework §6.8 — Slider types (M7 collapse: ONE catalog entry, NumberRangeQuestion,
// picked via props.slider_type). `single` is the pre-§6.8 shape (renderRange,
// above) — byte-identical for the migrated-M7 fixture (slider_type absent or
// 'single'). currency_affix is display-only (never touches node.type/
// answer_type — the Image9 failure class dies at the generation side, §6.8).
// The four NEW shapes each still emit a REAL native <input type="range">
// per handle (data-lg-input, role=slider, aria-value*) so recording +
// keyboard operability work via BROWSER-NATIVE semantics with zero required
// engine code; S2.3 owns the interactive polish (drag visuals, stepper
// click-to-increment, dual-handle track sync) — this SSR guarantees a
// working, accessible baseline for all five types.
// ---------------------------------------------------------------------------

// dual_range / from_to share the M7 sub-field naming convention: {base}_min /
// {base}_max (base = internal_field, else question_id — the SAME convention
// content-schema.isDualRangeSlider / answers.ts fieldsOf expand). Each input
// self-declares `data-lg-field` so the EXISTING generic handleInputEvent
// mechanism (`closest("[data-lg-field]")` — engine.ts, resolves to the
// element itself) records it with ZERO new engine code, the same technique
// this slice's §6.10 address per-field inputs use.
function rangeMinMaxFieldNames(node: LeadgenComponentNode): { min: string; max: string } {
  const base =
    typeof node.internal_field === "string" && node.internal_field.trim() !== ""
      ? node.internal_field.trim()
      : typeof node.question_id === "string" && node.question_id !== ""
        ? node.question_id
        : "range";
  return { min: `${base}_min`, max: `${base}_max` };
}

// stepper = single + −/＋ buttons (step REQUIRED — content-schema save gate).
function renderStepperRange(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  format: "number" | "currency",
  ctx: LeadgenSectionRenderCtx | undefined,
  slot: string,
): string {
  const rq = design.rangeQuestion;
  const min = propNum(node, "min") ?? 0;
  const max = propNum(node, "max") ?? 100;
  const step = propNum(node, "step") ?? 1;
  const value = propNum(node, "default") ?? min;
  const span = max - min;
  const pct = span > 0 ? clampInt(((value - min) / span) * 100, 0, 100) : 0;
  const currency = propStr(node, "currency") ?? "$";
  const filled = ovColor(node, "rangeColor", design, ctx) ?? rq.filledTrackColor;
  return (
    labelLine(node) +
    `<div class="lg-range lg-range-stepper"${hydration(node)} data-format="${format}"${attr("data-currency", format === "currency" ? currency : undefined)} data-slider-type="stepper">` +
    // §6.8 / Image10: the −/＋ buttons FLANK the big value readout (they were
    // tiny, unstyled and stacked far-left before this slice — styles.ts now
    // paints the .lg-range-stepper-row as a centered, 48px-target row).
    `<div class="lg-range-stepper-row">` +
    `<button type="button" class="lg-range-stepper-btn lg-range-stepper-dec" data-lg-step="dec" aria-label="Decrease">&minus;</button>` +
    `<div class="lg-range-value"${style({ color: rq.valueColor, "font-family": rq.valueFontFamily })}>${esc(formatRangeValue(value, format, currency))}</div>` +
    `<button type="button" class="lg-range-stepper-btn lg-range-stepper-inc" data-lg-step="inc" aria-label="Increase">&#65291;</button>` +
    `</div>` +
    `<div class="lg-range-track"${style({ "background-color": rq.unfilledTrackColor, "margin-top": design.spacing.md })}>` +
    `<div class="lg-range-fill"${style({ width: `${pct}%`, "background-color": filled })}>` +
    rangeHandle(rq, design, "") +
    `</div>` +
    `<input class="lg-range-input" type="range" role="slider" data-lg-input` +
    ` min="${min}" max="${max}" step="${step}" value="${value}"` +
    ` aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}"` +
    attr("aria-label", propStr(node, "ariaLabel") ?? node.internal_field) +
    attr("data-internal-field", node.internal_field) +
    `>` +
    `</div>` +
    // Image10's captions ("$5,000" / "$500,000") — MISSING before this slice.
    rangeMinMax(node, min, max, format, currency) +
    slot +
    `</div>` +
    fieldHelperLine(node)
  );
}

// §6.8 from_to + dual_range share ONE track carrying TWO handles (the probe's
// "two stacked separate tracks" / "no visible handles" defects). Each handle is
// a REAL native <input type="range"> laid over the SAME track (styles.ts
// .lg-range-input-dual: pointer-events only on the thumbs, so either handle is
// grabbable even where they overlap) inside its own [data-lg-field] wrapper —
// so dragging or arrow-keying EITHER handle records its {base}_min/{base}_max
// sub-field through the existing engine path, with zero engine bytes. The
// visible handles ride the fill's two edges (left:0 / left:100%) and carry the
// Image12/13 value pills.
function renderDualTrackRange(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  format: "number" | "currency",
  ctx: LeadgenSectionRenderCtx | undefined,
  slot: string,
  kind: "from_to" | "dual_range",
): string {
  const rq = design.rangeQuestion;
  const min = propNum(node, "min") ?? 0;
  const max = propNum(node, "max") ?? 100;
  const step = propNum(node, "step") ?? 1;
  const currency = propStr(node, "currency") ?? "$";
  const filled = ovColor(node, "rangeColor", design, ctx) ?? rq.filledTrackColor;
  const fields = rangeMinMaxFieldNames(node);
  // No authored default for either type (the §6.8 rails carry no Default
  // control) — the initial handles sit on the full [min,max] span.
  const fromLabel = kind === "from_to" ? "From" : "Minimum";
  const toLabel = kind === "from_to" ? "To" : "Maximum";
  // Image13's inputs are LABELLED "From ($)" / "To ($)" — the currency rides
  // the label (a number input cannot hold "$20,000"), so the same affix the
  // readouts/captions use is visible on both fields.
  const affix = format === "currency" ? ` (${currency})` : "";
  const idBase = `lg-ft-${fields.min}`;
  const handleInput = (label: string, field: string, value: number): string =>
    `<span${attr("data-lg-field", field)}><input class="lg-range-input lg-range-input-dual" type="range" role="slider" data-lg-input` +
    ` min="${min}" max="${max}" step="${step}" value="${value}"` +
    ` aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}" aria-label="${esc(label)}"></span>`;
  return (
    labelLine(node) +
    `<div class="lg-range ${kind === "from_to" ? "lg-range-from-to" : "lg-range-dual"}"${hydration(node)} data-format="${format}"${attr("data-currency", format === "currency" ? currency : undefined)} data-slider-type="${kind}">` +
    `<div class="lg-range-track"${style({ "background-color": rq.unfilledTrackColor })}>` +
    `<div class="lg-range-fill"${style({ left: "0%", width: "100%", "background-color": filled })}>` +
    rangeHandle(rq, design, "min", formatRangeValue(min, format, currency), filled) +
    rangeHandle(rq, design, "max", formatRangeValue(max, format, currency), filled) +
    `</div>` +
    handleInput(fromLabel, fields.min, min) +
    handleInput(toLabel, fields.max, max) +
    `</div>` +
    rangeMinMax(node, min, max, format, currency) +
    // from_to ONLY: the two labelled number inputs (dual_range is handles-only,
    // §6.8 "dual_range (= from_to, handles not inputs)"). Each is the SAME
    // WRAPPING [data-lg-field] + [data-lg-input] shape §6.10's address
    // per-field inputs use, so it records with zero engine bytes.
    (kind === "from_to"
      ? `<div class="lg-range-from-to-inputs">` +
        `<div class="lg-range-ft-field"><label class="lg-range-ft-label" for="${esc(`${idBase}-from`)}">${esc(`${fromLabel}${affix}`)}</label>` +
        `<span${attr("data-lg-field", fields.min)}><input id="${esc(`${idBase}-from`)}" class="lg-input lg-range-from" type="number" data-lg-input` +
        ` min="${min}" max="${max}" step="${step}" value="${min}" aria-label="${esc(`${fromLabel}${affix}`)}"></span></div>` +
        `<div class="lg-range-ft-field"><label class="lg-range-ft-label" for="${esc(`${idBase}-to`)}">${esc(`${toLabel}${affix}`)}</label>` +
        `<span${attr("data-lg-field", fields.max)}><input id="${esc(`${idBase}-to`)}" class="lg-input lg-range-to" type="number" data-lg-input` +
        ` min="${min}" max="${max}" step="${step}" value="${max}" aria-label="${esc(`${toLabel}${affix}`)}"></span></div>` +
        `</div>`
      : "") +
    slot +
    `</div>` +
    fieldHelperLine(node)
  );
}

// radial = single, circular rendering (min,max,step; defaultValue optional).
// S2.3 engine contract: radial is the "single" SUBSTRATE — ONE real native
// <input type="range"> carries role=slider + static aria-valuemin/valuemax
// (the engine syncs aria-valuenow) and remains the keyboard control (§6.8
// "Keyboard: ↑/↓ or ←/→ adjust by one step (role=slider)"); styles.ts lays it
// invisibly over the dial. The dial itself (arc + ring handle + centre value)
// is the VISUAL widget and stays aria-hidden with NO role/aria-value* of its
// own — never two competing slider landmarks. R2 P4 S4b owns the ring POINTER
// drag; it needs exactly one write per move: `--lg-deg` on
// [class~="lg-range-radial-outer"] (arc + handle both follow it).
function renderRadialRange(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  format: "number" | "currency",
  ctx: LeadgenSectionRenderCtx | undefined,
  slot: string,
): string {
  const rq = design.rangeQuestion;
  const min = propNum(node, "min") ?? 0;
  const max = propNum(node, "max") ?? 100;
  const step = propNum(node, "step") ?? 1;
  const value = propNum(node, "default") ?? min;
  const span = max - min;
  const pct = span > 0 ? clampInt(((value - min) / span) * 100, 0, 100) : 0;
  const deg = (pct / 100) * 360;
  const currency = propStr(node, "currency") ?? "$";
  const filled = ovColor(node, "rangeColor", design, ctx) ?? rq.filledTrackColor;
  return (
    labelLine(node) +
    `<div class="lg-range lg-range-radial"${hydration(node)} data-format="${format}"${attr("data-currency", format === "currency" ? currency : undefined)} data-slider-type="radial">` +
    // Image14: a REAL circular dial — a conic-gradient ring (the LIVE arc), a
    // draggable handle sitting ON the ring, and the big centre value. `--lg-deg`
    // is the ONE property that drives both the arc sweep and the handle's
    // rotation, so the runtime moves the whole dial by writing a single custom
    // property. The centre also carries `lg-range-value`: that class is what
    // render.updateRangeDisplay rewrites on every input event, which is the
    // root-cause fix for the probe's "centre value FROZEN while the real value
    // changes" (the old markup used a class the runtime never looked for).
    `<div class="lg-range-radial-outer" aria-hidden="true"${style({ "--lg-deg": `${deg}deg`, background: `conic-gradient(${filled} 0deg var(--lg-deg), ${rq.unfilledTrackColor} var(--lg-deg) 360deg)` })}>` +
    `<div class="lg-range-radial-handle"${style({ background: rq.thumbBackground, border: rq.thumbBorder, "box-shadow": rq.thumbShadow })}></div>` +
    `<div class="lg-range-value lg-range-radial-inner"${style({ color: rq.valueColor, "font-family": rq.valueFontFamily })}>${esc(formatRangeValue(value, format, currency))}</div>` +
    `</div>` +
    `<input class="lg-range-input lg-range-radial-input" type="range" role="slider" data-lg-input` +
    ` min="${min}" max="${max}" step="${step}" value="${value}"` +
    ` aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}"` +
    attr("aria-label", propStr(node, "ariaLabel") ?? node.internal_field) +
    attr("data-internal-field", node.internal_field) +
    `>` +
    slot +
    `</div>` +
    fieldHelperLine(node)
  );
}

export function renderNumberRangeQuestion(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  // M7 (§6.8): currency_affix is DISPLAY-ONLY and never touches node.type/
  // answer_type (the Image9 failure class eliminated at the generation side).
  // Absent ⇒ false ⇒ format 'number', byte-identical to pre-§6.8.
  const format: "number" | "currency" = propBool(node, "currency_affix") ? "currency" : "number";
  const sliderType = propStr(node, "slider_type");
  switch (sliderType) {
    case "stepper":
      return renderStepperRange(node, design, format, ctx, slot);
    case "from_to":
      return renderDualTrackRange(node, design, format, ctx, slot, "from_to");
    case "dual_range":
      return renderDualTrackRange(node, design, format, ctx, slot, "dual_range");
    case "radial":
      return renderRadialRange(node, design, format, ctx, slot);
    case "single":
    default:
      // Absent/unrecognized slider_type ⇒ 'single' — M7's own normalization
      // target, byte-identical to pre-§6.8 NumberRangeQuestion output.
      return renderRange(node, design, format, ctx, slot);
  }
}

// ---------------------------------------------------------------------------
// choice questions
// ---------------------------------------------------------------------------

function choiceList(node: LeadgenComponentNode): LeadgenChoice[] {
  return Array.isArray(node.choices) ? node.choices : [];
}

// v2.5 08 §8.4 — per-design iconCard depth slots (`iconCard.subtitle*` +
// `iconCard.badge*`), resolved by design id with the default-design fallback
// (the getFunnelDesign rule). A sibling lookup rather than design.iconCard
// keys because the design object serializes byte-exactly into the pinned
// public config (see the tokens.ts export note). Resolution by `design.id`
// also survives the §9.2 resolveTokens JSON deep-clone (the effective design
// keeps its id).
const ICON_CARD_DEPTH_SLOTS: Record<string, LeadgenIconCardDepthSlots> = {
  [defaultFunnelDesign.id]: defaultFunnelIconCardDepthSlots,
};

function iconCardDepthSlots(design: DefaultFunnelDesign): LeadgenIconCardDepthSlots {
  return ICON_CARD_DEPTH_SLOTS[design.id] ?? defaultFunnelIconCardDepthSlots;
}

// Answer buttons are a "pick-one" affordance (like the icon card), NOT the navy
// primary. Their base white/2px-border chrome + §14.6 hover/selected/focus state
// rules live in the scoped chrome CSS (.lg-btn.lg-btn-answer, styles.ts) — never
// inline — so the "selected animation" state wins by cascade (no !important; the
// compound .lg-btn.lg-btn-answer outranks the .lg-btn primary base/hover). Only
// class + role/aria + hydration data attrs are emitted per BUTTON.
//
// FIX 4a (§14.8 render-back): a curated `buttonBackground` override on the
// GROUP node resolves through the SAME §9.4 ovColor path (role-or-hex, layer-4
// Section re-pointing honored) and rides the group ROOT as the --lg-sel-bg
// custom property; the base sheet's selected rule consumes it with the token
// fallback. ADDITIVE: no override ⇒ style() emits nothing ⇒ byte-identical.
//
// v3.1 R3 §7 (register S2-1/E1-C3): the group ROOT additionally carries the
// node's design_overrides.size.width ("the group/control width") MERGED into
// this ONE style() call — two `style="…"` attributes on one tag is invalid HTML,
// so the selected-var and the width must resolve together (the fieldStyleAttr
// merge discipline). Width absent (or a non-grounded s/m/l preset) ⇒ omitted;
// both concerns absent ⇒ "" (byte-identical to pre-R3). Per-BUTTON
// height/corners/border ride choiceItemStyle (below).
// Rework §6.7: `gridCols` is pre-computed by the caller (planGridColumns) from
// the SAME choiceCount the per-button gridItemColumnEntries loop uses, so the
// --lg-cols value and the per-item centering offsets can never disagree.
function answerGroupRootStyle(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx: LeadgenSectionRenderCtx | undefined,
  gridCols: GridColumnsPlan,
): string {
  const width = sizeStyleEntries(node, ctx).width;
  // P1a (register PC-1): the group is a CSS grid now (.lg-answer-group,
  // styles.ts). `columns` (per-node, authorable 1..5 via the studio Card-layout
  // control) rides the SAME --lg-cols custom property the card grid uses; the
  // grid's own default (answerGrid.columns) applies when unauthored, so an
  // un-authored group emits NO --lg-cols. `gridGap` (curated token) overrides
  // the grid gap inline. Both ADDITIVE: style() drops undefined and preserves
  // the surviving keys' order, so no-override groups (incl. the legacy-pin
  // yes/no) emit byte-identically to pre-P1a.
  // Round-4 A-7 (P1b): the clamp is now 1..5 — UNIFIED with the card grid's
  // (renderCardGrid) so a single-column (Image26 stack) or 5-across button
  // group renders exactly what the studio offers; content-schema validates
  // `columns` 1..5 at save (design_overrides + props), so an out-of-range
  // authored value is rejected before it can reach this clamp.
  // Rework §6.7: --lg-cols now reflects gridCols.cols (min(authored,
  // choiceCount)), emitted only when gridCols.emitOverride (byte-identical for
  // an unauthored, already-full grid). `justify-content:center` (L-195 "track
  // list centered") rides ONLY alongside a wrapped partial last row — an
  // exact-fit grid emits neither, so this is a no-op for every P2a/P3a
  // backcompat fixture.
  // FIX-FIRST (F1): --lg-cols itself is COMPLETELY UNCHANGED (still the
  // LOGICAL column count, same emitOverride gate) — every existing consumer
  // that reads this property's VALUE (tests, and any future one) keeps
  // seeing the real column count.
  // FIX-FIRST (F2, adversarial review 2026-07-22): F1 originally emitted a
  // literal INLINE `grid-template-columns` override here — inline style
  // ALWAYS wins by cascade specificity over ANY class rule, including the
  // mobile media-query collapse rule, so a partial-row grid stayed doubled
  // even at 375px (buttons have no mobile collapse rule, so this specific
  // bug didn't hit them — but the SAME mechanism would break one if ever
  // added). FIX: emit the doubled value as an inline CUSTOM PROPERTY
  // (--lg-tracks) instead of the real property — an inline custom-property
  // declaration does NOT itself set grid-template-columns, so it cannot
  // out-rank anything; the actual property is still set by the CLASS rule
  // (styles.ts: `grid-template-columns:var(--lg-tracks, repeat(var(--lg-cols,
  // N), minmax(0,1fr)))`), which the mobile media-query class rule can still
  // beat normally (same specificity, later source order, its own literal
  // `1fr` ignores the variable entirely). See gridItemColumnEntries's own
  // comment for the pixel-equivalence proof of why doubling the track count
  // is required at all. An exact-fit grid (hasPartialRow false) never emits
  // --lg-tracks — byte-identical to pre-F1 in every respect.
  return style({
    "--lg-sel-bg": ovColor(node, "buttonBackground", design, ctx),
    "--lg-cols": gridCols.emitOverride ? String(gridCols.cols) : undefined,
    "--lg-tracks": gridCols.hasPartialRow
      ? `repeat(${gridCols.cols * 2}, minmax(0, 1fr))`
      : undefined,
    "justify-content": gridCols.hasPartialRow ? "center" : undefined,
    gap: ov(node, "gridGap"),
    width: width,
    // R7 U11b: a fixed-width block-level grid centers via auto side-margins (no
    // display:block needed). {} for full/unauthored → byte-identical. P3a: a
    // node's authored layout.align overrides the default centering (start/end).
    ...widthCenteringEntries(width, { align: node.layout?.align }),
  });
}

// P6 (deliverable 3): the button-style data attributes styles.ts's theme
// button-style rules key on. Read off the design stash (readButtonStyle) —
// undefined for a legacy/un-themed design ⇒ "" ⇒ byte-identical to pre-P6.
// Each renderer requests only the axes its element responds to (answer groups:
// fill + layout; card grids: fill + selected; continue: fill). Only NON-default
// axis values emit an attribute, so a theme that set only one axis emits only
// that one attribute.
function buttonStyleAttrs(
  design: DefaultFunnelDesign,
  axes: { fill?: boolean; layout?: boolean; selected?: boolean },
): string {
  const bs = readButtonStyle(design);
  if (bs === undefined) return "";
  let out = "";
  if (axes.fill === true && bs.fill !== "fill") out += ` data-btn-fill="${bs.fill}"`;
  if (axes.layout === true && bs.layout === "list") out += ` data-btn-layout="list"`;
  // §8.4 gap round: "card" (Image23) is a THIRD, mutually-exclusive layout
  // value alongside "list" above — never both attributes at once.
  if (axes.layout === true && bs.layout === "card") out += ` data-btn-layout="card"`;
  if (axes.selected === true && bs.selected === "mark") out += ` data-card-select="mark"`;
  return out;
}

export function renderButtonAnswerGroup(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  const autoAdvance = propBool(node, "auto_advance");
  const choices = choiceList(node);
  // §8.4 gap round: the theme's Answer-layout:'card' value (Image23) — see
  // buttonInnerContent's own comment. Resolved ONCE per group (a theme axis,
  // not per-choice), matching how every other button-style axis resolves.
  // R2 P2 FIX-FIRST (MAJOR-2): resolved BEFORE the column plan, because the
  // card layout OWNS the column axis (planAnswerGridColumns).
  const isCard = readButtonStyle(design)?.layout === "card";
  // Rework §6.7: min(authored, choiceCount) — see planGridColumns.
  const gridCols = planAnswerGridColumns(ovNum(node, "columns") ?? propNum(node, "columns"), design.answerGrid.columns, choices.length, isCard);
  // Rework §6.6: resolve choice > node > theme PER BUTTON (extends the
  // pre-§6.6 theme-only ternary the exact same way renderCardGrid's
  // markerResolutions/anyMark do) — a group with no per-choice/per-node
  // override and a non-mark theme resolves every button to 'wash', byte-
  // identical to before; a mark theme with no overrides resolves every
  // button to 'mark', ALSO byte-identical.
  const markerResolutions = choices.map((c) => resolveSelectedMarker(node, c.style, design));
  const anyMark = markerResolutions.some((m) => m === "mark");
  // v3.1 R3 §7/§8.5b + P2a §R-A: each answer button carries the node's per-item
  // design_overrides (height→min-height, corners→radius, border_color→role
  // border) MERGED with the choice's OWN diff-only `style` overlay (per-element
  // height / resting bg / text color / emphasis). "" when neither the node nor
  // the choice authors any (byte-identical to pre-R3/pre-P2a).
  // Rework §6.7: `index` feeds gridItemColumnEntries (L-195 wrapped-last-row
  // centering) — {} (no override) for every item outside a partial-row grid.
  const btn = (c: LeadgenChoice, index: number): string =>
    `<button type="button" class="lg-btn lg-btn-answer${isCard ? " lg-tscard" : ""}" role="radio" aria-checked="false"${choiceItemStyle(node, design, ctx, c.style, gridItemColumnEntries(index, choices.length, gridCols.cols))}` +
    attr("data-value", c.value) +
    // 03 §3.3: data-lg-choice mirrors the choice's REAL stored value.
    attr("data-lg-choice", c.value) +
    attr("data-analytics-id", c.analytics_id) +
    `>${buttonInnerContent(isCard, markerResolutions[index]!, c.label, c.title, c.subtitle)}</button>`;
  // Rework §6.5: base choices UNCHANGED + ONE trailing "Other" affordance
  // (same family, chevron) revealing a hidden <select> of the authored values.
  // Absent/disabled props.other ⇒ "" ⇒ byte-identical (replaces the retired
  // choiceDisplay/splitChoicesForOtherGroup/renderOtherGroupTail mechanism).
  // §8.4 gap round: under card layout the trigger is ALSO a full-width
  // tscard (the pack's "Other" row anatomy — title span + chevron, no
  // subtitle span at all, matching the pack's own trailing-affordance shape).
  const other = readOtherConfig(node);
  const otherHtml =
    other === undefined
      ? ""
      : `<button type="button" class="lg-btn lg-btn-answer${isCard ? " lg-tscard" : ""} lg-other-trigger" data-lg-other-trigger` +
        ` aria-expanded="false" aria-haspopup="listbox">${isCard ? `<span class="lg-tscard-title">${esc(other.label)}</span>` : esc(other.label)}${otherChevronSvg(design)}</button>` +
        otherSelectMarkup(other);
  const body = choices.map(btn).join("") + otherHtml;
  return (
    labelLine(node) +
    // Rework §6.6: data-card-select is "mark" whenever ANY button resolves to
    // mark (theme OR a per-choice/per-node override) — mirrors renderCardGrid;
    // buttonStyleAttrs' theme-only `selected` axis stays unused here.
    `<div class="lg-answer-group" role="radiogroup"${hydration(node)}${choiceHeightsAttr(anyChoiceHasHeight(choices))}${answerGroupRootStyle(node, design, ctx, gridCols)}${buttonStyleAttrs(design, { fill: true, layout: true })}${attr("data-card-select", anyMark ? "mark" : undefined)} data-auto-advance="${autoAdvance ? "true" : "false"}">` +
    body +
    // CONDUCTOR FIX (P4b regression): the auto error slot nests as the LAST
    // CHILD of the group box, never a card-level sibling — "" is a no-op.
    slot +
    `</div>` +
    // v3.1 R3 E1-NEW-8: helper line below the group ("" when no props.helper).
    fieldHelperLine(node)
  );
}

export function renderTwoButtonYesNo(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  const yes = propStr(node, "yesLabel") ?? "Yes";
  const no = propStr(node, "noLabel") ?? "No";
  const autoAdvance = propBool(node, "auto_advance");
  // §8.4 gap round: TwoButtonYesNo is a FIXED boolean pair with NO title/
  // subtitle fields at all (unlike LeadgenChoice) — buttonInnerContent's
  // fallback-to-label rule means this always degrades to title-only (yes/no
  // label as the tscard title, no subtitle span), a natural, non-special-
  // cased consequence of the SAME shared helper every layout uses.
  // R2 P2 FIX-FIRST (MAJOR-2): resolved BEFORE the column plan — under a card
  // theme this fixed pair stacks full-width too (Image23 anatomy), exactly
  // like every other answer group; a non-card theme is byte-identical.
  const isCard = readButtonStyle(design)?.layout === "card";
  // YesNo is a fixed 2-choice pair; planGridColumns(2 choices, default 2) is a
  // permanent no-op (min(2,2)=2, remainder 0) — included for uniformity with
  // the other choice families, never emits an override or partial-row centering.
  const gridCols = planAnswerGridColumns(ovNum(node, "columns") ?? propNum(node, "columns"), design.answerGrid.columns, 2, isCard);
  // Same discipline as renderButtonAnswerGroup: base + state chrome is fully
  // class-driven (.lg-btn.lg-btn-answer) so the §14.6 selected/hover states apply.
  // FIX 4a: the curated buttonBackground override rides the group root as
  // --lg-sel-bg. v3.1 R3: per-item height/corners/border ride choiceItemStyle,
  // group width rides answerGroupRootStyle (both "" when unauthored).
  // P2a §R-A: TwoButtonYesNo is a FIXED boolean pair (no `choices` array), so
  // its two buttons take per-element freedom from OPTIONAL props.yesStyle /
  // props.noStyle (each a LeadgenChoiceStyle, save-validated) — passed as the
  // per-item overlay. Absent ⇒ node-level-only ⇒ byte-identical to pre-P2a.
  const yesStyle = node.props?.["yesStyle"] as LeadgenChoiceStyle | undefined;
  const noStyle = node.props?.["noStyle"] as LeadgenChoiceStyle | undefined;
  // Rework §6.6: same choice > node > theme marker resolution as
  // ButtonAnswerGroup, incl. the anyMark group-level gate.
  const yesMarker = resolveSelectedMarker(node, yesStyle, design);
  const noMarker = resolveSelectedMarker(node, noStyle, design);
  const anyMark = yesMarker === "mark" || noMarker === "mark";
  const btn = (label: string, value: boolean, cs: LeadgenChoiceStyle | undefined, marker: LeadgenSelectedMarker): string =>
    `<button type="button" class="lg-btn lg-btn-answer${isCard ? " lg-tscard" : ""}" role="radio" aria-checked="false"${choiceItemStyle(node, design, ctx, cs)}` +
    // 03 §3.3: data-lg-choice mirrors data-value (the stored boolean).
    ` data-value="${value ? "true" : "false"}" data-lg-choice="${value ? "true" : "false"}">${buttonInnerContent(isCard, marker, label, undefined, undefined)}</button>`;
  return (
    labelLine(node) +
    `<div class="lg-answer-group lg-yesno" role="radiogroup"${hydration(node)}${choiceHeightsAttr(yesStyle?.size !== undefined || noStyle?.size !== undefined)}${answerGroupRootStyle(node, design, ctx, gridCols)}${buttonStyleAttrs(design, { fill: true, layout: true })}${attr("data-card-select", anyMark ? "mark" : undefined)} data-auto-advance="${autoAdvance ? "true" : "false"}">` +
    btn(yes, true, yesStyle, yesMarker) +
    btn(no, false, noStyle, noMarker) +
    // CONDUCTOR FIX (P4b regression): the auto error slot nests as the LAST
    // CHILD of the group box, never a card-level sibling — "" is a no-op.
    slot +
    `</div>` +
    // v3.1 R3 E1-NEW-8: helper line below the group ("" when no props.helper).
    fieldHelperLine(node)
  );
}

function renderCardGrid(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  kind: "icon" | "image",
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  const choices = choiceList(node);
  // §9.5 layer 4: Section columnsDefault/gapDefault fill the slots the node
  // left unset — per-node (design_overrides/props) wins over Section wins
  // over the design tokens.
  // Round-4 A-7 (P1b): the clamp is now 1..5 (was 2..5) — UNIFIED with the
  // button group (answerGroupRootStyle). A 1-column card grid is the Image26
  // full-width stacked-card reference, now offerable + renderable; a
  // Section-level columnsDefault of 1 (a "stack" preset) flows straight
  // through. content-schema validates `columns` 1..5 at save, so an
  // out-of-range value never reaches this clamp from authored content.
  // Rework §6.7: min(authored, choiceCount) — see planGridColumns. Cards
  // ALREADY always emitted --lg-cols (unlike the button group), so the value
  // now reflects the clamp but the emission itself stays unconditional —
  // byte-identical whenever choiceCount already meets/exceeds the resolved
  // default (every P2a/P3a backcompat fixture authors columns:2 with exactly
  // 2 choices, so min(2,2)=2 — same value as today).
  const gridCols = planGridColumns(
    ovNum(node, "columns") ?? propNum(node, "columns") ?? sectionColumnsDefault(ctx),
    design.iconCardGrid.columnsDesktop,
    choices.length,
  );
  const gap = ov(node, "gridGap") ?? sectionGapDefault(ctx) ?? design.iconCardGrid.gap;
  // Rework §6.6: resolve choice > node > theme PER CARD (extends the pre-§6.6
  // theme-only ternary — a group with no per-choice/per-node override and a
  // non-mark theme resolves every card to 'wash', byte-identical to before;
  // a mark theme with no overrides resolves every card to 'mark', ALSO
  // byte-identical — the override layers only change output for genuinely
  // NEW per-choice/per-node authored content).
  const markerResolutions = choices.map((c) => resolveSelectedMarker(node, c.style, design));
  const anyMark = markerResolutions.some((m) => m === "mark");
  // §9.4 layer 5: role-valued iconColor resolves via the (possibly Section-
  // re-pointed) role; legacy `#hex` renders as-is.
  const iconColor = ovColor(node, "iconColor", design, ctx) ?? design.iconCard.iconColor;
  const ic = iconCardDepthSlots(design);
  // v3.1 R3 §7/§8.5b + P2a §R-A: each card carries the node's per-item
  // design_overrides (height/corners/border) MERGED with the choice's OWN
  // diff-only `style` overlay (per-card height / resting bg / text color /
  // emphasis) — computed per-card in the closure below. "" when neither
  // authors any (byte-identical to pre-R3/pre-P2a).
  // A6 (05 §5.5): `image_fit` is a COMPONENT prop on the image grid — the
  // canonical authoring surface (content-schema optional enum + the studio
  // Design-tab control). Resolved once for the whole grid; the per-choice
  // defensive read below stays as the legacy FALLBACK only (§8.4's per-choice
  // list omits image_fit).
  const nodeFitRaw = propStr(node, "image_fit");
  const nodeFit = nodeFitRaw === "cover" || nodeFitRaw === "contain" ? nodeFitRaw : undefined;
  const card = (c: LeadgenChoice, index: number): string => {
    // P6 (deliverable 3, Image 40) + Rework §6.6: a corner check badge, hidden
    // by the base .lg-card-check rule, revealed by styles.ts's
    // `[data-card-select="mark"] …selected…` rule — now resolved PER CARD
    // (markerResolutions[index]) instead of theme-only, so a per-choice/
    // per-node override can turn it on/off independent of the theme axis.
    const markCheck = markerResolutions[index] === "mark" ? `<span class="lg-card-check" aria-hidden="true">✓</span>` : "";
    // v2.5 08 §8.4 choice depth — every new field is ADDITIVE: a choice
    // carrying none of them renders byte-identically to the v2.4 markup
    // (attribute/class order unchanged; empty style()/attr() emit nothing).
    // §8.4: emoji renders where the icon would (emoji ⊕ icon per validator);
    // an image card falls to the emoji slot only when it has no image.
    const emoji = typeof c.emoji === "string" && c.emoji !== "" ? c.emoji : undefined;
    // v3.1 R3 S2-5/6c: a choice `icon` may now be one of the §8.1 SEMANTIC ids
    // (the curated Tabler picker shared with leading icons, P1b register
    // PC-11) → render it as the shared LEADGEN_ICONS SVG (48px card scale) so
    // the editor picker is HONEST. A raw glyph/emoji (every pre-R3 stored
    // icon, and the emoji slot) is NOT a map key, so it still renders
    // esc(glyph) byte-identically. The id "none"/"" maps to "".
    const iconSlot = (glyph: string | undefined): string => {
      const known = glyph !== undefined && Object.prototype.hasOwnProperty.call(LEADGEN_ICONS, glyph);
      const inner = known ? leadgenIconSvg(glyph as string, 48) : esc(glyph);
      return `<span class="lg-card-icon"${style({ color: iconColor })} aria-hidden="true">${inner}</span>`;
    };
    const hasImage = typeof c.imageMediaId === "string" && c.imageMediaId !== "";
    // §8.4/A6 image fit (cover|contain — the 05 §5.5 grid control): the
    // COMPONENT prop (nodeFit above) is canonical; a legacy PER-CHOICE
    // image_fit read DEFENSIVELY off the raw choice (the defensive raw-node
    // read idiom) applies only when no component prop is authored. A curated enum,
    // not author CSS; both absent → today's attribute-free <img>
    // byte-identically.
    const fitRaw = (c as unknown as Record<string, unknown>)["image_fit"];
    const choiceFit = fitRaw === "cover" || fitRaw === "contain" ? fitRaw : undefined;
    const fit = nodeFit ?? choiceFit;
    const media =
      kind === "image"
        ? !hasImage && emoji !== undefined
          ? iconSlot(emoji)
          : `<img class="lg-card-img" src="${esc(c.imageMediaId)}"` +
            ` alt="${esc(typeof c.image_alt === "string" && c.image_alt !== "" ? c.image_alt : c.label)}"` +
            style({ "object-fit": fit }) +
            ` loading="lazy">`
        : iconSlot(emoji ?? c.icon);
    // §8.4: title renders in the card-title slot when present (label stays the
    // stored/a11y base); subtitle SUPERSEDES description and renders the NEW
    // iconCard.subtitle* token slots inline (the lg-card-icon idiom — chrome
    // CSS may later add a .lg-card-subtitle rule); a description-only legacy
    // choice renders today's markup byte-identically (read alias).
    const titleText = typeof c.title === "string" && c.title !== "" ? c.title : c.label;
    const desc =
      typeof c.subtitle === "string" && c.subtitle !== ""
        ? `<span class="lg-card-desc lg-card-subtitle"${style({
            "font-size": ic.subtitleFontSize,
            color: ic.subtitleColor,
          })}>${esc(c.subtitle)}</span>`
        : c.description !== undefined && c.description !== ""
          ? `<span class="lg-card-desc">${esc(c.description)}</span>`
          : "";
    // §8.4 badge — the NEW iconCard.badge* token slots, token-driven inline.
    const badge =
      typeof c.badge === "string" && c.badge !== ""
        ? `<span class="lg-card-badge"${style({
            background: ic.badgeBackground,
            color: ic.badgeColor,
            "font-size": ic.badgeFontSize,
            "font-weight": ic.badgeFontWeight,
            "border-radius": ic.badgeRadius,
            padding: ic.badgePadding,
          })}>${esc(c.badge)}</span>`
        : "";
    // Base border/background live in the scoped chrome CSS (.lg-card) — NOT
    // inline — so the §14.4 selected/hover/focus/error state rules win by
    // cascade (no !important). Only class + hydration attrs are emitted here.
    // §8.4 disabled rides the native attribute + aria-disabled (the §14.4
    // .lg-card:disabled/[aria-disabled] chrome rules style it).
    return (
      `<button type="button" class="lg-card" role="radio" aria-checked="false"${choiceItemStyle(node, design, ctx, c.style, gridItemColumnEntries(index, choices.length, gridCols.cols))}` +
      (c.disabled === true ? ` disabled aria-disabled="true"` : "") +
      attr("data-value", c.value) +
      // 03 §3.3: data-lg-choice mirrors the choice's REAL stored value.
      attr("data-lg-choice", c.value) +
      attr("data-analytics-id", c.analytics_id) +
      // §8.4 aria_label — explicit accessible-name override when authored.
      attr("aria-label", c.aria_label) +
      `>${markCheck}${badge}${media}<span class="lg-card-title">${esc(titleText)}</span>${desc}</button>`
    );
  };
  // Rework §6.5: base cards UNCHANGED + one trailing "Other" card-styled
  // affordance (replaces the retired choiceDisplay/splitChoicesForOtherGroup/
  // renderOtherGroupTail mechanism, §10). Absent/disabled props.other ⇒ ""
  // (byte-identical).
  const other = readOtherConfig(node);
  const otherHtml =
    other === undefined
      ? ""
      : `<button type="button" class="lg-card lg-other-trigger" data-lg-other-trigger` +
        ` aria-expanded="false" aria-haspopup="listbox"><span class="lg-card-title">${esc(other.label)}</span>${otherChevronSvg(design)}</button>` +
        otherSelectMarkup(other);
  const cards = choices.map(card).join("") + otherHtml;
  return (
    labelLine(node) +
    // Rework §6.6: data-card-select is now "mark" whenever ANY card resolves to
    // mark (theme OR a per-choice/per-node override) — the CSS gate must be
    // OPEN for any card that wants to show its badge, not just when the theme
    // itself is "mark" (buttonStyleAttrs' theme-only `selected` axis stays
    // unused here; anyMark supersedes it for this one attribute).
    `<div class="lg-card-grid" role="radiogroup"${hydration(node)}${choiceHeightsAttr(anyChoiceHasHeight(choices))}${buttonStyleAttrs(design, { fill: true, layout: true })}${attr("data-card-select", anyMark ? "mark" : undefined)}` +
    // v3.1 R3 §7: width → the grid container's max-width (per the register's
    // "grid/container max-width for card grids"); "" when unauthored.
    ((): string => {
      const w = sizeStyleEntries(node, ctx).width;
      // R7 U11b: a fixed max-width grid centers via auto side-margins (the
      // grid is already block-level display:grid); {} for full/unauthored.
      // Rework §6.7: justify-content:center (L-195 "track list centered")
      // rides ONLY alongside a wrapped partial last row — byte-identical
      // otherwise (every exact-fit fixture, incl. P2a/P3a backcompat).
      // FIX-FIRST (F1): --lg-cols itself stays the LOGICAL, undoubled value
      // (unconditionally emitted, exactly as pre-fix).
      // FIX-FIRST (F2, adversarial review 2026-07-22): F1 originally emitted
      // a literal INLINE grid-template-columns override here, which — being
      // inline — out-ranked the mobile media-query collapse rule
      // (`.lg-card-grid{grid-template-columns:1fr}` at ≤480px), so a
      // partial-row card grid stayed doubled (cramped) on mobile instead of
      // collapsing to 1 column. FIX: emit the doubled value as an inline
      // CUSTOM PROPERTY (--lg-tracks) instead — it cannot out-rank anything,
      // since setting a variable isn't setting grid-template-columns itself;
      // the actual property is set by the CLASS rule (styles.ts:
      // `grid-template-columns:var(--lg-tracks, repeat(var(--lg-cols, 3),
      // minmax(0,1fr)))`), which the mobile rule still beats normally (same
      // specificity, later source order, its own literal `1fr` ignores the
      // variable). See gridItemColumnEntries's own comment for the
      // pixel-equivalence proof of why doubling the track count is required
      // at all. Exact-fit emits no --lg-tracks at all — byte-identical to
      // pre-F1.
      return style({
        "--lg-cols": String(gridCols.cols),
        "--lg-tracks": gridCols.hasPartialRow
          ? `repeat(${gridCols.cols * 2}, minmax(0, 1fr))`
          : undefined,
        gap,
        "justify-content": gridCols.hasPartialRow ? "center" : undefined,
        "max-width": w,
        ...widthCenteringEntries(w, { align: node.layout?.align }),
      });
    })() +
    // CONDUCTOR FIX (P4b regression): the auto error slot nests as the LAST
    // CHILD of the grid box, never a card-level sibling — "" is a no-op.
    `>${cards}${slot}</div>` +
    // v3.1 R3 E1-NEW-8: helper line below the grid ("" when no props.helper).
    fieldHelperLine(node)
  );
}

export function renderIconCardAnswerGrid(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  return renderCardGrid(node, design, "icon", ctx, slot);
}
export function renderImageCardAnswerGrid(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  return renderCardGrid(node, design, "image", ctx, slot);
}

export function renderMultiChoiceCardGroup(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  const min = propNum(node, "min");
  const max = propNum(node, "max");
  // v2.5 05 §5.5 / 08 §8.7 patterns D/F (A6 flag d): title/subtitle choice
  // depth PARITY with renderCardGrid — ADDITIVE: title renders in the
  // card-title slot when present (label stays the stored/a11y base), subtitle
  // renders the same iconCard.subtitle* token slots. A choice carrying
  // neither renders byte-identically to the pre-depth markup.
  const ic = iconCardDepthSlots(design);
  // v3.1 R3 §7/§8.5b + P2a §R-A: per-card node design_overrides (height/corners/
  // border) MERGED with the choice's OWN diff-only `style` overlay — computed
  // per-card in the closure below. "" when neither authors any (byte-identical
  // to pre-R3/pre-P2a).
  const choices = choiceList(node);
  // Rework §6.7: min(authored, choiceCount) — see planGridColumns. This
  // type's OWN unauthored default has always been 2 (NOT renderCardGrid's 3),
  // preserved here so an un-authored multi with ≥2 choices stays byte-identical.
  const gridCols = planGridColumns(
    ovNum(node, "columns") ?? propNum(node, "columns") ?? sectionColumnsDefault(ctx),
    2,
    choices.length,
  );
  const card = (c: LeadgenChoice, index: number): string => {
    const titleText = typeof c.title === "string" && c.title !== "" ? c.title : c.label;
    const desc =
      typeof c.subtitle === "string" && c.subtitle !== ""
        ? `<span class="lg-card-desc lg-card-subtitle"${style({
            "font-size": ic.subtitleFontSize,
            color: ic.subtitleColor,
          })}>${esc(c.subtitle)}</span>`
        : "";
    // Base border/background live in the scoped chrome CSS (.lg-card) — not
    // inline — so the §14.4 selected/hover/focus state rules apply.
    return (
      `<button type="button" class="lg-card lg-card-multi" role="checkbox" aria-checked="false"${choiceItemStyle(node, design, ctx, c.style, gridItemColumnEntries(index, choices.length, gridCols.cols))}` +
      attr("data-value", c.value) +
      // 03 §3.3: data-lg-choice mirrors the choice's REAL stored value.
      attr("data-lg-choice", c.value) +
      attr("data-analytics-id", c.analytics_id) +
      `><span class="lg-card-title">${esc(titleText)}</span>${desc}</button>`
    );
  };
  // §6.5 matrix: MultiChoiceCardGroup (multi-select) has NO Other editor — the
  // choiceDisplay/Other-group mechanism never applied here beyond the shared
  // helper; base cards render flat (retired mechanism removed, §10).
  const cards = choices.map(card).join("");
  return (
    labelLine(node) +
    `<div class="lg-card-grid lg-multi" role="group"${hydration(node)}${choiceHeightsAttr(anyChoiceHasHeight(choices))}` +
    // P1a (register PC-1): honor the authored `columns` (killing the pre-P1a
    // hardcoded "2" that IGNORED the key) + `gridGap`, mirroring renderCardGrid's
    // §9.5 layer-4 resolution — per-node override wins over Section
    // columnsDefault/gapDefault wins over the design token; the default stays 2,
    // so an un-authored multi renders --lg-cols:2 byte-identically to pre-P1a.
    // P7fix-mcg: the clamp is now 1..5 (was 2..5) — UNIFIED with renderCardGrid
    // and answerGroupRootStyle (both re-clamped 1..5 in P1b), matching the
    // Columns picker (offers "1" for every answer-layout type since
    // P7fix-columns/61a6f35) and content-schema's `columns` 1..5 validation.
    // Previously an operator-authored 1 SAVED (schema allowed it) but this
    // renderer silently forced it back to 2 — a stored-vs-rendered drift where
    // the operator's setting was silently ignored. A 1-column
    // MultiChoiceCardGroup now renders single-column, honoring the saved
    // value. The un-authored fallback stays 2 (unchanged, byte-identical).
    ((): string => {
      const w = sizeStyleEntries(node, ctx).width;
      const gap = ov(node, "gridGap") ?? sectionGapDefault(ctx) ?? design.iconCardGrid.gap;
      // R7 U11b: fixed max-width grid centers via auto side-margins. Rework
      // §6.7: justify-content:center only alongside a wrapped partial row.
      // FIX-FIRST (F1): --lg-cols itself stays the LOGICAL, undoubled value
      // (unconditionally emitted, exactly as pre-fix).
      // FIX-FIRST (F2, adversarial review 2026-07-22): F1 originally emitted
      // a literal INLINE grid-template-columns override here, which — being
      // inline — out-ranked the mobile media-query collapse rule
      // (`.lg-card-grid{grid-template-columns:1fr}` at ≤480px), so a
      // partial-row card grid stayed doubled (cramped) on mobile instead of
      // collapsing to 1 column. FIX: emit the doubled value as an inline
      // CUSTOM PROPERTY (--lg-tracks) instead — it cannot out-rank anything,
      // since setting a variable isn't setting grid-template-columns itself;
      // the actual property is set by the CLASS rule (styles.ts:
      // `grid-template-columns:var(--lg-tracks, repeat(var(--lg-cols, 3),
      // minmax(0,1fr)))`), which the mobile rule still beats normally (same
      // specificity, later source order, its own literal `1fr` ignores the
      // variable). See gridItemColumnEntries's own comment for the
      // pixel-equivalence proof of why doubling the track count is required
      // at all. Exact-fit emits no --lg-tracks at all — byte-identical to
      // pre-F1.
      return style({
        "--lg-cols": String(gridCols.cols),
        "--lg-tracks": gridCols.hasPartialRow
          ? `repeat(${gridCols.cols * 2}, minmax(0, 1fr))`
          : undefined,
        gap,
        "justify-content": gridCols.hasPartialRow ? "center" : undefined,
        "max-width": w,
        ...widthCenteringEntries(w, { align: node.layout?.align }),
      });
    })() +
    attr("data-min", min) +
    attr("data-max", max) +
    // CONDUCTOR FIX (P4b regression): the auto error slot nests as the LAST
    // CHILD of the grid box, never a card-level sibling — "" is a no-op.
    `>${cards}${slot}</div>` +
    // v3.1 R3 E1-NEW-8: helper line below the grid ("" when no props.helper).
    fieldHelperLine(node)
  );
}

// §5.5 (FIX 8b): the authored dropdown default — `props.default` names a
// choice VALUE; the matching <option> gets the `selected` marker and the
// placeholder loses it. Unmatched/absent default → undefined → the legacy
// placeholder-selected markup renders byte-identically.
// R2 P1 §① SRC-1b (owner A.1 #1: "independent answers, inefendent
// **defaults!!**"; design pin 18.30.25 shows "Geico" already chosen in the
// dependent dropdown). CANONICAL KEY = `props.defaultValue`: it is what the
// Studio inspector writes for every question family (ui-section-studio.ts
// `props.defaultValue = …` / `delete props.defaultValue`) and the ONLY key
// config-dto.ts projects into the public config's `default_answer`
// (`node.props?.["defaultValue"]` → answer_source "default_applied").
// `props.default` is the older render-only key this preselect has always read
// — kept as the fallback so pre-existing stored content renders byte-
// identically — but it is written by nothing today, so an operator-authored
// dropdown default never reached the SSR <option selected> at all: the visitor
// saw the "Select…" placeholder until the runtime applied the default. Reading
// defaultValue FIRST closes that seam server-side, in the one helper both
// dropdown renderers share.
function dropdownDefaultValue(node: LeadgenComponentNode): string | undefined {
  const raw = node.props?.["defaultValue"] ?? node.props?.["default"];
  const def = typeof raw === "string" || typeof raw === "number" ? String(raw) : undefined;
  if (def === undefined) return undefined;
  return choiceList(node).some((c) => String(c.value) === def) ? def : undefined;
}

export function renderDropdownQuestion(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  const placeholder = propStr(node, "placeholder") ?? "Select…";
  const def = dropdownDefaultValue(node);
  // 03 §3.3: each <option> is a selectable choice → data-lg-choice. A dropdown
  // renders every authored choice as a plain option (real values only). §6.5's
  // "Other" affordance is single-select choice-group / card only, not dropdowns.
  const options = choiceList(node)
    .map(
      (c) =>
        `<option value="${esc(c.value)}"${attr("data-lg-choice", c.value)}${attr("data-analytics-id", c.analytics_id)}${def !== undefined && String(c.value) === def ? " selected" : ""}>${esc(c.label)}</option>`,
    )
    .join("");
  // Base border lives in the scoped chrome CSS (.lg-input) — not inline — so
  // the :focus / [aria-invalid] state rules win by cascade (no !important).
  // E1-NEW-1 (register §E.2): data-lg-input marks the <select> so the engine's
  // delegated change listener (engine.ts) routes its value into
  // recordUserAnswer — a native <select> emits `change` (not a bubbling option
  // click the [data-lg-choice] delegate could see), so WITHOUT this hook the
  // dropdown was mute in live funnels. The per-option data-lg-choice attrs stay
  // (they feed applySelectionClasses on restore for choice-projecting nodes);
  // they are inert for the click delegate because native option selection never
  // reaches the root click listener as an option-targeted event.
  // v3.1 R3 §7/§8.5b: the <select> IS a `.lg-input`, so it consumes
  // design_overrides.size/.corners/.border_color through the SAME fieldStyleAttr
  // merge (width/height + border-radius + the --lg-field-border custom property)
  // the text-input family uses — fully state-safe (:focus/[aria-invalid] retain
  // precedence). "" when the node authors none (byte-identical to pre-R3).
  const select =
    `<select class="lg-input lg-dropdown"${hydration(node)} data-lg-input${fieldStyleAttr(node, design, ctx)}` +
    `>` +
    `<option value="" disabled${def === undefined ? " selected" : ""}>${esc(placeholder)}</option>` +
    options +
    `</select>`;
  // CONDUCTOR FIX (P4b regression): a `<select>` cannot validly CONTAIN a `<p>`
  // error slot (option/optgroup only) — unlike every other field renderer,
  // this one has NO wrapping element to nest the slot inside. No slot (every
  // non-section-render call site, and a ValidationError-bound field) → the
  // bare `<select>` renders byte-identically to pre-fix (no new wrapper). A
  // slot present → wrap in the SAME `.lg-field-boxed` box renderTextInput
  // already uses for its own icon/helper cases (one established "field box"
  // class, not a new one) so the slot has a valid, semantically-correct home.
  if (slot === "") return labelLine(node) + select + fieldHelperLine(node);
  return labelLine(node) + `<span class="lg-field-boxed" style="display:block">${select}${slot}</span>` + fieldHelperLine(node);
}

// 08 §8.3/§8.10 SearchableDropdownQuestion: DropdownQuestion + a search input
// above the option list. HYDRATION ATTRS ONLY — the runtime filters the
// options client-side (data-lg-searchable / data-lg-dropdown-search hooks); no
// client render here. The options are a REAL <select> in the exact
// DropdownQuestion option shape (data-lg-choice + data-analytics-id per
// option) so answer semantics are identical. Base chrome is fully class-driven
// (.lg-input / .lg-dropdown) — no inline style.
export function renderSearchableDropdownQuestion(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  const placeholder = propStr(node, "placeholder") ?? "Select…";
  // §5.5 (FIX 8b): the SAME props.default semantics as DropdownQuestion — the
  // two dropdown shapes may never disagree on what a default means.
  const def = dropdownDefaultValue(node);
  const options = choiceList(node)
    .map(
      (c) =>
        `<option value="${esc(c.value)}"${attr("data-lg-choice", c.value)}${attr("data-analytics-id", c.analytics_id)}${def !== undefined && String(c.value) === def ? " selected" : ""}>${esc(c.label)}</option>`,
    )
    .join("");
  return (
    labelLine(node) +
    `<div class="lg-searchable-dropdown"${hydration(node)} data-lg-searchable>` +
    `<input class="lg-input lg-dropdown-search" type="text" data-lg-dropdown-search` +
    ` placeholder="Search…" aria-label="Search options">` +
    // E1-NEW-1: data-lg-input on the real <select> (same rationale as
    // renderDropdownQuestion) so a searchable dropdown records its answer via
    // the engine change listener. The search input above is a filter only
    // (data-lg-dropdown-search) and deliberately carries NO data-lg-input.
    // v3.1 R3 §7/§8.5b: the control <select> (a `.lg-input`) consumes
    // size/corners/border_color through fieldStyleAttr, exactly like
    // renderDropdownQuestion — "" when unauthored (byte-identical to pre-R3).
    `<select class="lg-input lg-dropdown" data-lg-input${fieldStyleAttr(node, design, ctx)}>` +
    `<option value="" disabled${def === undefined ? " selected" : ""}>${esc(placeholder)}</option>` +
    options +
    `</select>` +
    // CONDUCTOR FIX (P4b regression): the auto error slot nests as the LAST
    // CHILD of the `.lg-searchable-dropdown` box, never a card-level sibling
    // — "" is a no-op.
    slot +
    `</div>` +
    // PC-A10 (drift honesty): CONTENT_PROP_FIELDS has always advertised a
    // Helper text control for this type (it shares DropdownQuestion's own
    // ["placeholder","helper"] row set), but this renderer never called
    // fieldHelperLine — an arbitrary exclusion (the r3a-consumption drift
    // pin used to assert it explicitly; now it asserts the opposite). Wired
    // to match DropdownQuestion exactly ("" when unauthored — byte-additive).
    fieldHelperLine(node)
  );
}

// ---------------------------------------------------------------------------
// free-form + PII inputs
// ---------------------------------------------------------------------------

// v3.1 §9.2/§9.3 — the two `props.maps` shapes this module must translate to
// the ONE wire format `runtime/maps.ts`'s parseMapsConfig already understands
// (flat keys: enable_autocomplete/validate/normalize_address_line, or their
// pre-existing synonyms). NEVER changes runtime/maps.ts (unowned this phase);
// this module is the translation layer between the NEW authoring shape and
// the EXISTING wire contract.
// Exported so serve.ts's funnelNeedsMapsKey (the funnel-wide "does the
// browser key need injecting" gate) mirrors the SAME per-field enabled/jobs
// interpretation as this module's renderers — one source of truth for the
// shape check, never duplicated/drifted logic.
export interface LeadgenNewMapsShape {
  enabled?: unknown;
  jobs?: { validate?: unknown; auction?: unknown; autocomplete?: unknown };
  // v3.1 §9.3 (S3-7) sibling-fill targets: each slot is the internal_field the
  // Places autofill writes into (runtime/maps.ts parseMapsConfig's nested
  // `fills` object). Authored by the Maps-tab fills picker; mapsConfigJson
  // serializes it into the data-lg-maps wire config the runtime consumes.
  fills?: { street?: unknown; city?: unknown; state?: unknown; zip?: unknown };
}

export function isNewMapsShape(raw: unknown): raw is LeadgenNewMapsShape {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) && typeof (raw as Record<string, unknown>)["jobs"] === "object";
}

// §9.3 "the Validate job wins over the legacy global toggle... per-field
// precedence": when the NEW {enabled,jobs} shape is authored on the node,
// jobs.validate/jobs.autocomplete are AUTHORITATIVE for THIS field — the
// legacy bare `props.validate` flag (no live writer in the current admin;
// kept readable for old stored content, §12 no-regression) is consulted only
// when the node carries NO new-shape config at all.
// Exported (v3.1 fix-round MINOR-1) so sections-handlers.ts's admin
// section-preview zipValidation leg applies the SAME per-field precedence
// the runtime (renderZIPInputQuestion/renderAddressAutocompleteQuestion
// below) and serve.ts's funnelNeedsMapsKey already apply — one source of
// truth for the jobs decision, never duplicated/drifted logic.
export function mapsJobsFor(node: LeadgenComponentNode): { validate: boolean; auction: boolean; autocomplete: boolean } {
  const raw = node.props?.["maps"];
  if (isNewMapsShape(raw)) {
    if (raw.enabled !== true) return { validate: false, auction: false, autocomplete: false };
    return {
      validate: raw.jobs?.validate === true,
      auction: raw.jobs?.auction === true,
      autocomplete: raw.jobs?.autocomplete === true,
    };
  }
  // Legacy flat shape (props.maps already an object, pre-§9.2 authoring) —
  // pass its OWN flags through unchanged (byte-identical to pre-v3.1). The
  // legacy vocabulary has no `auction` concept, so the auction job is always
  // false for pre-§9.2 content (S3-6 — only the NEW {enabled,jobs} shape can
  // opt a field into the auction location facet).
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const flat = raw as Record<string, unknown>;
    return {
      validate: flat["validate_full_address"] === true || flat["validate_zip"] === true || flat["validate"] === true,
      auction: false,
      autocomplete: flat["enable_autocomplete"] === true || flat["autocomplete"] === true,
    };
  }
  // No props.maps object at all — the bare legacy per-node flag (the
  // "global address_validation_enabled era", §9.3).
  const legacyValidate = propBool(node, "validate") === true;
  return { validate: legacyValidate, auction: false, autocomplete: false };
}

// Whether a node carries ANY props.maps object at all (the NEW {enabled,
// jobs} shape OR the pre-§9.2 legacy flat shape) — the per-field precedence
// GATE itself (§9.3): present ⇒ mapsJobsFor(node) is THIS field's own
// authoritative answer; absent ⇒ the field has no per-field opinion at all,
// so a caller falls through to ITS OWN legacy default (mapsJobsFor's own
// fallback is the bare props.validate prop; sections-handlers.ts's admin
// zipValidation leg falls through to the Section's address_validation_
// enabled column instead — a DIFFERENT legacy default per caller, hence a
// separate exported predicate rather than baking one fallback into
// mapsJobsFor itself).
export function hasFieldMapsConfig(node: LeadgenComponentNode): boolean {
  const raw = node.props?.["maps"];
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

// The §9 field-level Maps config → the 03 §3.3 `data-lg-maps` attribute
// value. A NEW-shape `props.maps` TRANSLATES to the flat wire keys
// (mapsJobsFor's per-field-precedence result); a pre-existing flat-shape
// `props.maps` serializes VERBATIM (byte-identical, §12 no-regression); the
// compat fallback for pre-§8.8 content — where Maps-enablement rode the
// component itself (any AddressAutocompleteQuestion; a ZIP with
// props.validate=true) — is the empty config "{}" (runtime defaults).
// The §9.3 (S3-7) sibling-fill targets a NEW-shape props.maps may carry: each
// slot (street/city/state/zip) is the internal_field the Places autofill writes
// into — the SAME nested `fills` shape runtime/maps.ts parseMapsConfig consumes.
// Only non-empty string slots are kept; an absent/empty fills object yields
// undefined so mapsConfigJson stays BYTE-IDENTICAL for fills-less content.
function newShapeFills(raw: LeadgenNewMapsShape): Record<string, string> | undefined {
  const f = raw.fills;
  if (typeof f !== "object" || f === null || Array.isArray(f)) return undefined;
  const out: Record<string, string> = {};
  for (const slot of ["street", "city", "state", "zip"] as const) {
    const v = (f as Record<string, unknown>)[slot];
    if (typeof v === "string" && v !== "") out[slot] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function mapsConfigJson(node: LeadgenComponentNode): string {
  const raw = node.props?.["maps"];
  if (isNewMapsShape(raw)) {
    const jobs = mapsJobsFor(node);
    // enable_autocomplete/validate ONLY (the runtime's browser-leg keys); the
    // `auction` job is server-side (the §9 facet) and never rides the wire.
    const config: Record<string, unknown> = { enable_autocomplete: jobs.autocomplete, validate: jobs.validate };
    // S3-7: stop DISCARDING the fills — emit the nested object parseMapsConfig
    // reads (only when authored, so fills-less content is unchanged).
    const fills = newShapeFills(raw);
    if (fills !== undefined) config["fills"] = fills;
    return JSON.stringify(config);
  }
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return JSON.stringify(raw);
  }
  return "{}";
}

// ---------------------------------------------------------------------------
// v3.1 §7/§12 — field size APPLICATION (the resolveFieldSize WIRING point).
//
// R3 BLOCKER-1 grounding: the preset->px table below is now SOURCED (see
// sizeAxisCssValue), not a recorded gap. HEIGHT small/medium/large ride the
// §10.4 "Buttons & inputs — the shared size language" control-height scale
// (44/52/60px = base .lg-input min-height + theme Button-size M/L min-heights);
// WIDTH m/full are grounded to §7.1's own "384 (= 64% of the 600 column)" +
// the golden's verbatim non-custom fieldWrapStyle 100%; WIDTH s/l are the two
// proposed-errata brackets (300/480 = 50%/80% of the 600 unit column) recorded
// for operator sign-off. custom_px stays the literal stored/clamped/snapped
// NUMBER (grounded — the value comes from the node itself, §7.2 "custom_px =
// manual override"). Every value is within the axis clamp and on the 4px grid.
// ---------------------------------------------------------------------------

// Fallback theme controls for when a render call site has no resolved
// theme_controls at all (ctx absent, or ctx.theme_controls absent) — the
// funnel-theme-default tier of resolveFieldSize's per-axis chain (§7.1). Its
// field_height="medium" is what an absent HEIGHT axis inherits (§7.2 line 357
// "absent key = inherit theme default"), now resolving to the grounded 52px.
const DEFAULT_SIZE_THEME_CONTROLS: ThemeRecordControls = {
  field_height: "medium",
  button_size: "m",
  corners: "rounded",
};

// v3.1 §7.1/§7.2/§10.4/§12 — the preset-name -> px resolver. The contract
// routes a preset name through "the theme's resolved px" (§12 line 606
// "preset name -> theme.controls resolved px"; §7.2 line 358 "still inherits
// the preset's resolved px from the theme"), and designs/theme.ts DELEGATES
// that px math to HERE by design ("never interprets e.g. field_height into
// pixels itself — that math belongs to the size resolver", theme.ts:346-348).
// This is that math. Sourced below; the s/l WIDTH values are the ONLY
// proposed-errata entries (operator sign-off) — everything else is grounded.
//
// HEIGHT (small/medium/large) — the §10.4 "Buttons & inputs — the shared size
// language" scale (contract line 503), i.e. the design's own control heights:
//   small  = 44px — the base `.lg-input` min-height (styles.ts:716), the
//                   design-default field height (an unset field renders here).
//   medium = 52px — the theme Button-size M min-height (theme.ts:210); this IS
//                   the theme default field_height="medium" (§10.4 line 514),
//                   and ~= the intrinsic rendered height (44px floor + padding),
//                   so it is the low-surprise default the absent-axis inherits.
//   large  = 60px — the theme Button-size L min-height (theme.ts:211).
// Applied as `min-height` on the item/text idioms (choiceItemStyle,
// renderTextInput) so a preset only ever FLOORS the box — it never clips.
//
// WIDTH (s/m/l) — §7.1 gives width NO theme knob (only field_height/
// button_size/corners; DEFAULT_WIDTH_PRESET falls to "full"), so these resolve
// against the §13 Gate-3 "unit column 600":
//   m    = 384px — GROUNDED: §7.1 line 345 states the demo width verbatim as
//                  "384 (= 64% of the 600 column)"; = §7.2's custom_px:384
//                  worked example. The canonical middle (theme button_size="m").
//   s    = 300px — PROPOSED errata (50% of the 600 column) — brackets below m.
//   l    = 480px — PROPOSED errata (80% of the 600 column) — brackets above m.
//   full = 100%  — GROUNDED (golden's verbatim non-custom fieldWrapStyle) —
//                  UNCHANGED, byte-identical to the pre-R3 fix output.
// s/m/l/full are within the [200,600] width clamp and on the 4px grid, so a
// preset and a hand drag (custom_px, also [200,600] snap-4) live on one scale.
// `custom` stays the literal stored/clamped/snapped number (grounded, never a
// lookup) — byte-identical to before.
const WIDTH_PRESET_CSS: Record<string, string> = { s: "300px", m: "384px", l: "480px", full: "100%" };
// R2 F-2: the HEIGHT ladder is no longer hand-typed here. It IS
// designs/theme.ts's THEME_RECORD_FIELD_HEIGHT_TO_MIN_HEIGHT — the same table
// the theme tier writes into the `.lg-input` base token — so the per-node
// override tier and the funnel-theme tier can never drift onto two ladders
// (the failure mode the F-1 corners rationale calls out). Same 44/52/60.
const HEIGHT_PRESET_CSS: Record<string, string> = { ...THEME_RECORD_FIELD_HEIGHT_TO_MIN_HEIGHT };
function sizeAxisCssValue(axis: LeadgenResolvedSizeAxis, axisKind: "width" | "height"): string | undefined {
  if (axis.mode === "custom") return `${axis.px}px`;
  // A stale/corrupt stored preset name (design_overrides is a loose map) falls
  // through the lookup to undefined -> nothing rendered for that axis (the same
  // defensive posture the rest of this module uses for legacy stored values).
  return axisKind === "width" ? WIDTH_PRESET_CSS[axis.preset] : HEIGHT_PRESET_CSS[axis.preset];
}

// PURE-per-call style ENTRIES (not yet wrapped) for a node's
// design_overrides.size (§7.1/§7.2/§12): absent `size` -> {} (BYTE-IDENTICAL
// to pre-v3.1 output — the base .lg-input/.lg-currency/.lg-address CSS class
// sizing applies, untouched); present -> both axes resolve (each
// independently inheriting the theme default when its OWN key is absent,
// exactly like resolveFieldSize's own per-axis contract), and ONLY the two
// grounded cases above ride as inline style — never raw author CSS, only
// computed/verbatim values. Split out from fieldSizeStyle (below) so the
// combined text-input style attribute (fieldStyleAttr) can merge these WITH
// the appearance entries below into ONE `style()` call — two separate
// `style="…"` attributes on one tag is invalid HTML (the second is silently
// dropped by the parser), so every element that carries BOTH concerns must
// resolve them through a single style() call.
function sizeStyleEntries(
  node: LeadgenComponentNode,
  ctx: LeadgenSectionRenderCtx | undefined,
): { width?: string; height?: string; paddingBlock?: string } {
  const sizeOverride = node.design_overrides?.size;
  if (sizeOverride === undefined) return {};
  const controls = ctx?.theme_controls ?? DEFAULT_SIZE_THEME_CONTROLS;
  const resolved = resolveFieldSize(sizeOverride, controls);
  const height = sizeAxisCssValue(resolved.height, "height");
  return {
    width: sizeAxisCssValue(resolved.width, "width"),
    height,
    // R2 F-3 (gap 2): the height's PAIRED vertical padding, from designs/
    // theme.ts's ONE derivation (fieldPaddingBlockForPx) — the same subtraction
    // the theme tier uses on the base `.lg-input` rule. Without it a floor
    // under the field's intrinsic 54px box paints nothing (measured 54/54/60
    // for small/medium/large); with it the floor IS the painted box. A
    // hand-dragged custom_px rides the identical formula, so the preset rungs
    // and a drag stay one scale.
    paddingBlock: height === undefined ? undefined : fieldPaddingBlockForPx(Number.parseFloat(height)),
  };
}

// v3.1 R7 U11b (register U11b — operator retest: "sized elements sit LEFT-
// aligned; no way to center"). A field/group whose width resolves to a FIXED
// (non-full) value must CENTER within its unit column, matching the golden's
// centered field (golden :912-914 fieldWrapStyle — width:64% inside a
// center-aligned column). margin-left/right:auto centers a BLOCK-level box on
// a fixed width; the inline-level <input>/<select> additionally needs
// display:block (a replaced inline element ignores auto side-margins — this is
// the "inline-block <input> case" the fix calls out). Absent width, OR
// width:"100%" (the `full` preset / the un-authored default), returns {} —
// BYTE-IDENTICAL to pre-R7 output, so the A0 legacy pins and every no-size
// node (100+ live zones) are untouched. Appended LAST at each emission site so
// the width/height/appearance key order in the merged style() is unchanged for
// the unaffected cases.
// P3a (register PC-2 / D1 / R-B) GENERALIZATION: the same fixed-width block
// that pre-P3a ALWAYS centered now honors an authored placement `align` —
// start hugs the left, end hugs the right, center/undefined keep the
// pre-P3a symmetric auto-centering. `align === undefined` (every legacy /
// no-layout node) returns the EXACT pre-P3a entries in the EXACT key order, so
// design_overrides.size centering stays byte-identical (leadgen-p3a-backcompat
// freezes one sized node per call site). A corrupt stored align falls to the
// center default (defensive).
function widthCenteringEntries(
  width: string | undefined,
  opts?: { block?: boolean; align?: LeadgenPlacementAlign },
): Record<string, string | undefined> {
  if (width === undefined || width === "100%") return {};
  const align = opts?.align;
  return {
    display: opts?.block === true ? "block" : undefined,
    "margin-left": align === "start" ? "0" : "auto",
    "margin-right": align === "end" ? "0" : "auto",
  };
}

// PURE-per-call inline style for a node's design_overrides.size — unchanged
// public shape/behavior (still node,ctx -> "" | ` style="…"`), now a thin
// wrapper over sizeStyleEntries so the ONE resolution rule lives in ONE
// place. Still used verbatim on the `.lg-currency`/`.lg-address` OUTER
// wrapper (the size axis is a whole-control/box concern there), never
// author CSS, only computed/verbatim values through the SAME `style()`
// helper every other preset uses (so a hostile value can never escape the
// attribute either).
function fieldSizeStyle(node: LeadgenComponentNode, ctx: LeadgenSectionRenderCtx | undefined): string {
  const sz = sizeStyleEntries(node, ctx);
  // R7 U11b: the .lg-currency/.lg-address OUTER wrapper is a block <div> →
  // auto side-margins center it on a fixed width; {} for full/unauthored keeps
  // this byte-identical (the pre-R7 currency/address size pins hold).
  // R2 F-3 (gap 2): the height rides as a FLOOR here too — an exact `height:`
  // on a composite control's wrapper clips its own children. The paired padding
  // is NOT applied to a wrapper: the padding ladder sizes the FIELD BOX, and a
  // wrapper's padding would inset the control instead of resizing it.
  return style({
    width: sz.width,
    "min-height": sz.height,
    ...widthCenteringEntries(sz.width, { align: node.layout?.align }),
  });
}

// v3.1 §8.5b/§11.5 Style tab "Corners" (Sharp/Rounded/Pill) -> §3.3 radii
// tokens, verbatim: "controls/inputs 8px … pills/chips 20px" (Appendix B
// restates "controls 8 … pills 20"). A field IS a control/input, so
// rounded=8px and pill=20px cite §3.3 directly, byte for byte. "Sharp" has
// NO explicit px value anywhere in the contract (only the enum NAME) — 0 is
// the only reading consistent with "no rounding at all", but it is an
// INFERRED value, NOT an explicit contract number (the same class of gap as
// SIZE_HEIGHT_CUSTOM_PX_MIN's flagged inference above) — flagged for
// conductor/adversarial-review confirmation against the golden master.
const NODE_CORNERS_RADIUS_PX: Record<LeadgenNodeCorners, string> = {
  sharp: "0",
  rounded: "8px",
  pill: "20px",
};

// Defensive re-validation at RENDER time (belt-and-suspenders over
// content-schema.ts's save-time enum enforcement — mirrors the
// clampInt-at-render idiom used throughout this module for legacy/corrupt
// stored values): node.design_overrides is typed as a generic
// string|number|boolean map (LeadgenDesignOverrides), so a stale/corrupt
// stored value must be re-checked against the real enum before it drives a
// lookup or a role switch.
function isNodeCorners(value: unknown): value is LeadgenNodeCorners {
  return typeof value === "string" && (LEADGEN_NODE_CORNERS as readonly string[]).includes(value);
}
function isNodeBorderColorRole(value: unknown): value is LeadgenNodeBorderColorRole {
  return typeof value === "string" && (LEADGEN_NODE_BORDER_COLOR_ROLES as readonly string[]).includes(value);
}

// v3.1 §8.5b border_color role -> the ACTIVE design's OWN resolved color —
// read off the SAME `design` object every renderer already threads for
// every other themed color value (identical precedent: design.header.
// logoColor above), so a themed/composed `design` (resolveTokens' mutated
// EffectiveFunnelDesign, role colors baked in via theme.ts's setRoleToken)
// yields the CURRENT theme's brand/accent/border, and the plain
// defaultFunnelDesign yields the base palette — never a fabricated hex,
// always the design's own token. Bridge grounded in designs/theme.ts's
// ROLE_TO_BASE_TOKEN (border -> color.border, brand_primary -> color.primary,
// accent -> color.accent); border_color's OWN 3-value vocabulary
// (content-schema.ts's LEADGEN_NODE_BORDER_COLOR_ROLES) is deliberately
// smaller than the 14-role set ("border_color is its OWN small 3-value role
// vocabulary, never the general color-role set" — content-schema.ts) so
// "neutral" maps onto the 14-role system's OWN neutral-border-line concept
// (the literal "border" role, base token color.border) rather than a
// fabricated new token.
function nodeBorderColorValue(role: LeadgenNodeBorderColorRole, design: DefaultFunnelDesign): string {
  switch (role) {
    case "brand":
      return design.color.primary;
    case "accent":
      return design.color.accent;
    case "neutral":
    default:
      return design.color.border;
  }
}

// PURE-per-call style ENTRIES for a node's design_overrides.corners/
// .border_color (§8.5b/§11.5/§12) — absent key -> undefined for that key
// (BYTE-IDENTICAL to pre-fix output when neither is authored); each key
// resolves independently. NEVER raw hex/CSS from the node — only the
// grounded lookup/bridge above, through the closed enum guards.
//
// v3.1 fix-round (adversarial review, CSS-cascade regression close-out):
// border_color rides the CUSTOM PROPERTY `--lg-field-border`, NEVER the
// `border-color` property directly. A DIRECT inline border-color would beat
// designs/default-funnel/styles.ts's `.lg-input:focus` / `.lg-input[aria-
// invalid="true"]` rules by specificity (inline always wins over a class/
// attribute selector without !important) — an overridden field would then
// show its role color EVEN when focused or invalid, silently losing that
// state feedback. The base `.lg-input` rule instead reads `border-color:
// var(--lg-field-border, <default>)`: setting the CUSTOM PROPERTY inline
// only supplies the value the base rule's OWN (lower-specificity)
// declaration consults, so :focus/[aria-invalid]'s DIRECT, higher-
// specificity border-color declarations still win exactly as before this
// whole feature existed. `border-radius` has no such collision (nothing
// else sets it via a class/attribute rule) so it stays a direct property.
function appearanceStyleEntries(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
): { "border-radius"?: string; "--lg-field-border"?: string } {
  const cornersRaw = node.design_overrides?.corners;
  const borderColorRaw = node.design_overrides?.border_color;
  return {
    "border-radius": isNodeCorners(cornersRaw) ? NODE_CORNERS_RADIUS_PX[cornersRaw] : undefined,
    "--lg-field-border": isNodeBorderColorRole(borderColorRaw)
      ? nodeBorderColorValue(borderColorRaw, design)
      : undefined,
  };
}

// Standalone wrapped appearance style — used on the CURRENCY/ADDRESS INNER
// `<input class="lg-input …">` (the element the visible .lg-input border/
// radius CSS actually renders on; their OUTER `.lg-currency`/`.lg-address`
// wrapper carries no border of its own — verified against
// designs/default-funnel/styles.ts, which has no `.lg-currency`/`.lg-address`
// border rule at all, only `.lg-input`/`.lg-input:focus`/
// `.lg-input[aria-invalid]`). Absent both keys -> "" (byte-identical).
function fieldAppearanceStyle(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  return style(appearanceStyleEntries(node, design));
}

// Combined size+appearance style for the SINGLE-ELEMENT text-input family
// (free text/number/currency-less text/email/phone/date/zip — the `.lg-input`
// element IS both the sizing box and the visual border/radius target, unlike
// currency/address where they're different elements) — merged into ONE
// `style()` call so the element never carries two `style="…"` attributes.
function fieldStyleAttr(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx: LeadgenSectionRenderCtx | undefined,
): string {
  const sz = sizeStyleEntries(node, ctx);
  // R7 U11b: the .lg-input <input>/<select> is inline-level → display:block +
  // auto side-margins center it on a fixed width. {} for full/unauthored →
  // byte-identical (order: width,height,border-radius,--lg-field-border first,
  // then the centering keys only when a fixed width is present).
  // R2 F-3 (gap 2): `height` -> `min-height` + the paired vertical padding.
  // This element IS the field box, so it is where the ladder has to land. The
  // FLOOR is the semantic this codebase standardises on (designs/theme.ts
  // FIELD_BOX_CHROME_PX rationale) and the one this module's own doc comment
  // above already claimed for the text idiom — `height:44px` on a 16px-padded
  // 16px-font input leaves 8px of content area and CLIPS the text.
  return style({
    width: sz.width,
    "min-height": sz.height,
    "padding-top": sz.paddingBlock,
    "padding-bottom": sz.paddingBlock,
    ...appearanceStyleEntries(node, design),
    ...widthCenteringEntries(sz.width, { block: true, align: node.layout?.align }),
  });
}

// ---------------------------------------------------------------------------
// v3.1 R3 §7/§8.5b — the CHOICE/BUTTON/CARD families (register S2-1/E1-C3/
// E2-NEW-7). The text-input family and the dropdown <select> ARE `.lg-input`
// elements, so they consume design_overrides through fieldStyleAttr (size +
// appearanceStyleEntries' --lg-field-border custom property — state-safe).
// Buttons (.lg-btn-answer) and cards (.lg-card) corners ride a direct
// `border-radius` (no state rule collides — it has no :hover/selected
// declaration). border_color ALSO now rides the `--lg-field-border` custom
// property (R5 state-safe-border grant, register R3a ROUTING NOTES) — the
// SAME state-safe idiom as the text-input family, via choiceItemStyle below;
// designs/default-funnel/styles.ts's `.lg-btn.lg-btn-answer`/`.lg-card` base
// rules read `border-color: var(--lg-field-border, <default>)` so an
// authored border_color no longer beats the :hover/[aria-checked="true"]/
// [data-selected="true"] state rules by inline-style specificity (the R3a-era
// bug this R5 change closes). All three values flow through the SAME
// grounded resolvers the text family uses (never invented CSS); a node
// WITHOUT design_overrides.size/.corners/.border_color emits "" (byte-
// identical to pre-R3 for the un-authored case).
// ---------------------------------------------------------------------------

// The grounded corner radius for a node's design_overrides.corners
// (sharp/rounded/pill → 0/8px/20px per §8.5b + Appendix B), or undefined when
// unauthored/invalid (the same closed-enum guard the .lg-input path uses).
function nodeCornersRadius(node: LeadgenComponentNode): string | undefined {
  const raw = node.design_overrides?.corners;
  return isNodeCorners(raw) ? NODE_CORNERS_RADIUS_PX[raw] : undefined;
}
// The node's design_overrides.border_color role resolved to the active design's
// OWN themed color (neutral→border / brand→primary / accent→accent) via the
// SAME nodeBorderColorValue bridge the .lg-input path resolves — or undefined.
function nodeBorderColorCss(node: LeadgenComponentNode, design: DefaultFunnelDesign): string | undefined {
  const raw = node.design_overrides?.border_color;
  return isNodeBorderColorRole(raw) ? nodeBorderColorValue(raw, design) : undefined;
}
// Per-ITEM style for a choice button/card node: height→min-height (the group's
// height axis is a per-item concern, unlike the text box), corners→border-radius,
// border_color→the `--lg-field-border` CUSTOM PROPERTY (R5 state-safe-border
// grant, mirroring appearanceStyleEntries above — NEVER a direct border-color).
// A direct inline border-color would beat designs/default-funnel/styles.ts's
// `.lg-btn.lg-btn-answer:hover`/`[aria-checked="true"]`/`.lg-card:hover`/
// `[data-selected="true"]` rules by specificity (inline always wins over a
// class/attribute selector without !important), silently losing hover/
// selected feedback on any item with an authored border_color — exactly the
// cascade bug the register's R3a routing note flagged (forensic-defect-
// register.md R3a ROUTING NOTES). The base `.lg-btn.lg-btn-answer`/`.lg-card`
// rules read `border-color: var(--lg-field-border, <default>)`: setting the
// CUSTOM PROPERTY inline only supplies the value that base (lower-
// specificity) declaration consults — :hover/[aria-checked]/[data-selected]'s
// own higher-specificity declarations still win over it. "" when the node
// authors none of the three (byte-identical to pre-R5 for those).
// P2a §R-A — per-CHOICE HEIGHT scale (button-size scale, §10.4): s/m/l →
// 44/52/60px, the SAME grounded values as HEIGHT_PRESET_CSS small/medium/large
// (base .lg-input min-height / theme Button-size M / L). Applied as the item's
// min-height (a choice varies HEIGHT only — grid cells stay equal-width).
const CHOICE_SIZE_MIN_HEIGHT: Record<LeadgenChoiceSizePreset, string> = {
  s: "44px",
  m: "52px",
  l: "60px",
};
// custom_px clamp/grid — MIRRORS content-schema.ts's SIZE_HEIGHT_CUSTOM_PX_MIN/
// MAX + SIZE_GRID_PX (the node-level HEIGHT axis), applied here as a defensive
// re-snap/re-clamp over the save-time gate (the clampInt-at-render idiom).
const CHOICE_SIZE_GRID_PX = 4;
const CHOICE_HEIGHT_PX_MIN = 4;
const CHOICE_HEIGHT_PX_MAX = 600;

function choiceSizeMinHeight(size: LeadgenChoiceStyle["size"]): string | undefined {
  if (size === undefined) return undefined;
  if (typeof size === "string") return CHOICE_SIZE_MIN_HEIGHT[size];
  const px = size.custom_px;
  if (typeof px !== "number" || !Number.isFinite(px)) return undefined;
  return `${clampInt(Math.round(px / CHOICE_SIZE_GRID_PX) * CHOICE_SIZE_GRID_PX, CHOICE_HEIGHT_PX_MIN, CHOICE_HEIGHT_PX_MAX)}px`;
}

// P2a §R-A — resolve a per-choice color (role OR off-theme #hex) through the
// SAME §9.4 pipeline node-level ovColor uses: a #hex is a literal (the
// deliberate off-theme escape); a role consults the Section palette re-point
// (layer 4) then the effective design's base token (layers 1-3). undefined
// when neither authored (diff-only). Defensive precedence: #hex first
// (validation rejects role+hex both-set upstream, invalid_choice_style).
function choiceColorValue(
  role: string | undefined,
  hex: string | undefined,
  design: DefaultFunnelDesign,
  ctx: LeadgenSectionRenderCtx | undefined,
): string | undefined {
  if (typeof hex === "string" && hex.startsWith("#")) return hex;
  if (typeof role === "string" && isFunnelTokenRole(role)) {
    return sectionRoleValue(design, ctx, role) ?? baseTokenForRole(design, role);
  }
  return undefined;
}

// The node-level "all elements" default entries (UNCHANGED from pre-P2a): the
// node's own design_overrides.size.height / .corners / .border_color, applied
// to EVERY item. Split out so the per-choice overlay merges on top in ONE
// style() call (two style="…" attributes on one tag is invalid HTML).
function nodeItemStyleEntries(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx: LeadgenSectionRenderCtx | undefined,
): Record<string, string | undefined> {
  return {
    "min-height": sizeStyleEntries(node, ctx).height,
    "border-radius": nodeCornersRadius(node),
    "--lg-field-border": nodeBorderColorCss(node, design),
  };
}

// P2a §R-A — the per-choice DIFF-ONLY overlay: ONLY the keys the choice's
// `style` explicitly set. Background rides the `--lg-answer-bg` CUSTOM
// PROPERTY, read by EVERY state rule in designs/default-funnel/styles.ts
// (resting, :hover, AND [aria-checked]/[data-selected]/.lg-selected — the P2b
// FIX-ROUND R1 correction): a styled choice keeps its AUTHORED background in
// every state; state feedback rides the border/ring/font-weight channels
// instead. This is what makes the per-choice TEXT COLOR safe: `color` is a
// DIRECT inline value (no CSS rule ever overrides it, in any state) chosen to
// pair with the choice's OWN authored background — and since R1 makes that
// SAME background the one that paints in every state, the pairing never
// breaks. (Pre-R1 this was NOT a safe invariant despite "no rule overrides
// color" being equally true then: hover/selected repainted the background to
// the theme's generic wash while the text stayed the author's fixed color —
// the adversarial review's MAJOR finding measured exactly that gap, a white-
// on-near-white ~1.09:1 contrast on hover, before R1 landed.) emphasis strong
// → font-weight 700 (== the selected-state weight, so a strong item is
// state-consistent). A choice height OVERRIDES the node min-height (same key →
// later spread wins; the key's POSITION is preserved so unaffected keys keep
// their byte order). Undefined contributions are dropped by style().
function choiceStyleOverlayEntries(
  choiceStyle: LeadgenChoiceStyle | undefined,
  design: DefaultFunnelDesign,
  ctx: LeadgenSectionRenderCtx | undefined,
): Record<string, string | undefined> {
  if (choiceStyle === undefined || choiceStyle === null || typeof choiceStyle !== "object") return {};
  const out: Record<string, string | undefined> = {};
  const h = choiceSizeMinHeight(choiceStyle.size);
  if (h !== undefined) out["min-height"] = h;
  const bg = choiceColorValue(choiceStyle.color_role, choiceStyle.color_hex, design, ctx);
  if (bg !== undefined) out["--lg-answer-bg"] = bg;
  const tc = choiceColorValue(choiceStyle.text_color_role, choiceStyle.text_color_hex, design, ctx);
  if (tc !== undefined) out["color"] = tc;
  if (choiceStyle.emphasis === "strong") out["font-weight"] = "700";
  return out;
}

// Per-ITEM style: the node-level default layer with the OPTIONAL per-choice
// overlay merged on top (diff-only). `choiceStyle` omitted (the pre-P2a call
// shape) AND a node WITHOUT per-item design_overrides → "" — byte-identical to
// pre-P2a for every un-styled item.
// Rework §6.7: `extraEntries` merges in caller-computed one-off CSS (currently
// only gridItemColumnEntries's per-item grid-column-start/-end) — LAST so it
// wins over the node/choice layers on a shared key (none collide today).
// Omitted by every pre-§6.7 call site ⇒ byte-identical.
function choiceItemStyle(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx: LeadgenSectionRenderCtx | undefined,
  choiceStyle?: LeadgenChoiceStyle,
  extraEntries?: Record<string, string | undefined>,
): string {
  return style({
    ...nodeItemStyleEntries(node, design, ctx),
    ...choiceStyleOverlayEntries(choiceStyle, design, ctx),
    ...extraEntries,
  });
}

// P2b FIX-ROUND (adversarial review MINOR-3): `.lg-answer-group`/`.lg-card-
// grid` only need align-items:start (designs/default-funnel/styles.ts) when a
// per-choice HEIGHT is actually authored — an unstyled group must keep
// today's grid-default stretch-to-equal-height look (the R-A "additive"
// invariant, now enforced at the CSS layer instead of assumed). One boolean
// ATTRIBUTE (not the whole style bag) so styles.ts has a single, unambiguous
// selector to key the override on; "1" when true, omitted (never "0") when
// false — attr() drops falsy/empty values, so an unstyled group's markup
// stays byte-identical to pre-MINOR-3.
function anyChoiceHasHeight(choices: readonly LeadgenChoice[]): boolean {
  return choices.some((c) => c.style?.size !== undefined);
}
function choiceHeightsAttr(hasHeight: boolean): string {
  return attr("data-choice-heights", hasHeight ? "1" : undefined);
}

// P1b (register PC-11) — §8.1 leading icons, Tabler pipeline. Pre-P1b, this
// file hand-drew 11 field-box glyphs at a hardcoded 19×19/#8DA0B6 (R3 S2-8/
// E1-NEW-9/U9 history) — a hardcoded size+color is a no-op against the
// design's iconColor override / card-icon size token, and the operator's own
// references use 48-64px icons the old 11-glyph library didn't have. P1b
// replaces the hand-drawn map with icons.generated.ts's curated Tabler (MIT)
// subset: every name in the §8.5b enum (content-schema
// LEADGEN_FIELD_LEADING_ICONS) resolves via leadgenIconSvg(name, sizePx) —
// currentColor + no baked-in size means the SAME source now actually responds
// to both. Leading field icons render at 20px (§8.1 field-box scale, close to
// the pre-P1b 19px). "none"/absent/unknown → "" (byte-identical to before).
// PC-A8: `key` defaults to "icon" (every pre-existing call site passes none,
// so behavior/output is byte-identical) — renderNameFieldsGroup is the ONE
// caller that passes "firstIcon"/"lastIcon" for its own per-field pickers.
function fieldLeadingIcon(node: LeadgenComponentNode, key: string = "icon"): string {
  const id = propStr(node, key);
  if (id === undefined || !Object.prototype.hasOwnProperty.call(LEADGEN_ICONS, id)) return "";
  return leadgenIconSvg(id, 20);
}
// v3.1 audit-round G FIX 3a: §8.1 helper line below the field box. props.helper
// is canonical (contract §8.1/§11.3); props.helper_text is the accepted legacy
// v2.5 alias (erratum 8) read as a fallback so a v2.5 section still renders its
// helper. Golden :326 verbatim inline style. Shared by the whole text-input
// family + the currency/address wrappers, so the helper renders identically on
// runtime + both previews (§12 parity).
// PC-A8: `key` defaults to "helper" (every pre-existing call site passes none,
// so behavior/output is byte-identical, INCLUDING the props.helper_text legacy
// fallback, which only ever applied to the canonical "helper" key) —
// renderNameFieldsGroup is the ONE caller that passes "firstHelper"/
// "lastHelper" for its own per-field lines (brand-new keys, no legacy alias).
function fieldHelperLine(node: LeadgenComponentNode, key: string = "helper"): string {
  const helper = key === "helper" ? (propStr(node, "helper") ?? propStr(node, "helper_text")) : propStr(node, key);
  // audit-round G MINOR-3: propStr returns "" (not undefined) for an
  // authored empty-string prop, so a legacy node migrated to helper:"" must
  // still gate out here — trimmed-non-empty, not merely !== undefined —
  // else it would emit an empty <div class="lg-field-help"></div>.
  return helper === undefined || helper.trim() === ""
    ? ""
    : `<div class="lg-field-help" style="font-size:12.5px;color:#96A0AF;margin-top:7px;padding-left:2px">${esc(helper)}</div>`;
}
// Round-4 A-6a (P1b): the field label line for text-like inputs — the SAME
// `.lg-label` block-above chrome renderNameFieldsGroup
// already uses, so a Contact stack reads consistently. Sourced from props.label
// (an ADDITIVE prop: absent/empty/whitespace ⇒ "" ⇒ NO <span> node at all, so
// a component WITHOUT a label renders byte-identically to pre-P1b — never an
// empty label element).
function labelLine(node: LeadgenComponentNode): string {
  const label = propStr(node, "label");
  return label === undefined || label.trim() === "" ? "" : `<span class="lg-label">${esc(label)}</span>`;
}
// Rework §6.9: `fallbackPlaceholder` is consumed ONLY by renderPhoneInputQuestion
// (the mask scaffold, e.g. "(___) ___-____") — used ONLY when the author left
// props.placeholder unset, so an authored placeholder always still wins.
// Every other call site omits it (undefined) ⇒ byte-identical to pre-§6.9.
function renderTextInput(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  type: string,
  extra: string,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
  fallbackPlaceholder?: string,
): string {
  const placeholder = propStr(node, "placeholder") ?? fallbackPlaceholder;
  const maxLen = propNum(node, "maxLen");
  const icon = fieldLeadingIcon(node);
  const helper = fieldHelperLine(node);
  // Round-4 A-6a (P1b): a UNIFIED field label ABOVE the input for every
  // text-like input (FreeText/Number/Email/Phone/Date/ZIP share this renderer),
  // so a Contact stack no longer mixes labeled NameFields with label-less
  // inputs — the label reuses the SAME `.lg-label` block-above chrome
  // renderNameFieldsGroup uses. Sourced from props.label.
  // ADDITIVE: absent/empty ⇒ "" ⇒ no <label> node at all, so every field
  // WITHOUT an authored label renders byte-identically to pre-P1b (the fast
  // path below still returns the bare input; the boxed path concatenates "").
  const fieldLabel = labelLine(node);
  // Base border lives in the scoped chrome CSS (.lg-input) — not inline — so
  // the :focus / [aria-invalid] state rules win by cascade (no !important).
  // An authored design_overrides.border_color rides the `--lg-field-border`
  // CUSTOM PROPERTY (appearanceStyleEntries), never `border-color` directly,
  // so it only supplies the value the base .lg-input rule's OWN var()
  // fallback consults — :focus/[aria-invalid]'s direct, higher-specificity
  // border-color declarations still win over it exactly as before this
  // feature existed (adversarial-review cascade-regression close-out).
  // 03 §3.3: data-lg-input marks every text/date/email/phone/zip input.
  // v3.1 §7/§12: fieldStyleAttr (size + corners/border_color merged into ONE
  // style() call) is the ONLY inline style this element ever carries — ""
  // (no attribute at all) when the node authors none of design_overrides.
  // size/.corners/.border_color, so pre-v3.1 output is untouched byte for
  // byte. FIX 3a: a leading icon adds a left inset so the input text clears
  // the pin (the box wrapper positions the pin over that inset).
  const sz = sizeStyleEntries(node, ctx);
  // R7 U11b: with an icon AND a fixed (non-full) width, the WRAPPER
  // (.lg-field-box, below) carries the width + centering so the absolutely-
  // positioned leading icon tracks the narrowed field; the input then fills it
  // at .lg-input's own width:100%. Absent/full width → width rides the input
  // exactly as before (byte-identical). The bare (icon-less) path centers the
  // input directly via fieldStyleAttr.
  const iconWidthFixed = icon !== "" && sz.width !== undefined && sz.width !== "100%";
  const styleAttr =
    icon === ""
      ? fieldStyleAttr(node, design, ctx)
      : iconWidthFixed
        ? style({ height: sz.height, ...appearanceStyleEntries(node, design), "padding-left": "42px" })
        : style({ ...sz, ...appearanceStyleEntries(node, design), "padding-left": "42px" });
  const input =
    `<input class="lg-input" type="${type}"${hydration(node)} data-lg-input` +
    styleAttr +
    attr("placeholder", placeholder) +
    attr("maxlength", maxLen) +
    (node.required === true ? " required" : "") +
    extra +
    `>`;
  // §12 no-regression: absent icon AND helper AND slot AND label -> the bare
  // input, byte-for-byte with pre-FIX-3a output (fieldStyleAttr unchanged in
  // that branch). CONDUCTOR FIX (P4b regression): an <input> is a void element
  // — it cannot CONTAIN a slot, so a slot's presence now ALSO forces the
  // wrapping box (below), exactly like an authored icon/helper already did; the
  // slot becomes the box's LAST CHILD instead of a card-level sibling. Round-4
  // A-6a (P1b): an authored field label likewise forces the wrapper so the
  // `.lg-label` sits ABOVE the input — absent label keeps this fast path.
  if (icon === "" && helper === "" && slot === "" && fieldLabel === "") return input;
  const boxed =
    icon === ""
      ? input
      : '<span class="lg-field-box" style="position:relative;display:block' +
        (iconWidthFixed ? ";width:" + sz.width + ";margin-left:auto;margin-right:auto" : "") +
        '">' +
        // audit-round G MINOR-1 (surfaced by adding real baseline-pin
        // coverage): the Studio's own selection decoration wraps the field's
        // <input> in its OWN `position:relative` span (`[data-selection-
        // wrap]`) once a node is selectable/selected. That wrap and this icon
        // span are BOTH position:absolute/relative siblings with an implicit
        // z-index:auto, so paint order falls back to DOM order — the LATER
        // wrap (holding the input's own opaque background) paints OVER this
        // EARLIER icon span, hiding it completely even though it's still a
        // real, present, correctly-positioned DOM node (confirmed via a
        // direct Playwright boundingBox()/count() probe against the live
        // canvas — the element exists with a valid box; only the PAINT was
        // occluded). An explicit z-index wins over z-index:auto regardless of
        // DOM order, so this is a one-line fix scoped to this render function
        // (no change needed in the Studio's own decoration script).
        '<span class="lg-field-icon" aria-hidden="true" style="position:absolute;left:14px;top:0;bottom:0;display:flex;align-items:center;pointer-events:none;z-index:1">' +
        icon +
        "</span>" +
        input +
        "</span>";
  // CONDUCTOR FIX (P4b regression): the auto error slot is the LAST CHILD of
  // the field box (`.lg-field-boxed`) — nested INSIDE, after the helper line,
  // never a card-level sibling. "" (no slot) is a no-op concatenation. Round-4
  // A-6a (P1b): the field label (fieldLabel, "" when unauthored) leads the box,
  // ABOVE the input — helper stays below, the error slot stays last.
  return '<span class="lg-field-boxed" style="display:block">' + fieldLabel + boxed + helper + slot + "</span>";
}

export function renderFreeTextQuestion(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  return renderTextInput(node, design, "text", "", ctx, slot);
}
// 08 §8.3/§8.10 NumberInputQuestion: a PLAIN numeric text input (NOT a
// slider/range) — the renderTextInput discipline (class-driven .lg-input base
// so :focus/[aria-invalid] cascade) + inputmode numeric; min/max/step ride as
// data attributes for the runtime's client-side validation leg.
export function renderNumberInputQuestion(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  return renderTextInput(
    node,
    design,
    "text",
    ` inputmode="numeric"` +
      attr("data-min", propNum(node, "min")) +
      attr("data-max", propNum(node, "max")) +
      attr("data-step", propNum(node, "step")) +
      attr("aria-label", propStr(node, "ariaLabel") ?? node.internal_field),
    ctx,
    slot,
  );
}
// 08 §8.10 CurrencyInputQuestion: currency-prefixed plain numeric input (NOT a
// Range variant). The prefix symbol (props.currency ?? "$") is a decorative
// aria-hidden span aligned by the scoped chrome CSS (.lg-currency-prefix /
// .lg-currency-input padding); the input itself follows the renderTextInput
// discipline (class-driven base, data-lg-input, inputmode numeric). v3.1
// §7/§12: fieldSizeStyle rides the OUTER `.lg-currency` wrapper (the whole
// control's visible box), same absent-is-empty discipline as renderTextInput.
export function renderCurrencyInputQuestion(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  const currency = propStr(node, "currency") ?? "$";
  return (
    // Round-4 A-6a (P1b): the shared field label ABOVE the currency box (this
    // renderer bypasses renderTextInput but is text-like). "" when unauthored ⇒
    // byte-identical to pre-P1b.
    labelLine(node) +
    `<div class="lg-currency"${hydration(node)}${fieldSizeStyle(node, ctx)}>` +
    `<span class="lg-currency-prefix" aria-hidden="true">${esc(currency)}</span>` +
    // v3.1 §8.5b/§11.5/§12: corners/border_color ride the INNER `.lg-input`
    // element (fieldAppearanceStyle), not the `.lg-currency` wrapper above —
    // the wrapper carries no border/radius of its own (designs/default-
    // funnel/styles.ts has no `.lg-currency` border rule), only `.lg-input`
    // does, so this is where the visible box actually renders.
    `<input class="lg-input lg-currency-input" type="text" inputmode="numeric" data-lg-input${fieldAppearanceStyle(node, design)}` +
    attr("placeholder", propStr(node, "placeholder")) +
    attr("data-min", propNum(node, "min")) +
    attr("data-max", propNum(node, "max")) +
    attr("data-currency", currency) +
    attr("aria-label", propStr(node, "ariaLabel") ?? node.internal_field) +
    (node.required === true ? " required" : "") +
    `>` +
    // CONDUCTOR FIX (P4b regression): the auto error slot nests as the LAST
    // CHILD of the currency box, never a card-level sibling — "" is a no-op.
    slot +
    `</div>` +
    // v3.1 audit-round G FIX 3a: helper line below the currency box (this
    // wrapper bypasses renderTextInput). "" when no props.helper/helper_text.
    fieldHelperLine(node)
  );
}
export function renderEmailInputQuestion(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  return renderTextInput(node, design, "email", ` inputmode="email" autocomplete="email"`, ctx, slot);
}
// Rework §6.9/M8: the compiled mask scaffold (e.g. "(___) ___-____") + digit
// count off props.phone_format.mask.pattern — parsed through the SAME
// parsePhoneMaskPattern grammar the save gate uses (content-schema.ts), so a
// stale/corrupt mask (already rejected at save; tolerated on read like
// config-dto's buildPhoneContract) yields undefined here too, never throws.
// The legacy custom raw-regex path and the nanp/e164_intl/il presets carry NO
// mask — undefined, so the renderer stays the plain pre-§6.9 <input> (byte-
// identical) for every pre-M8 phone field.
function phoneMaskScaffold(node: LeadgenComponentNode): { scaffold: string; digitCount: number } | undefined {
  const pf = node.props?.["phone_format"];
  if (pf === null || typeof pf !== "object" || Array.isArray(pf)) return undefined;
  const mask = (pf as { mask?: unknown }).mask;
  if (mask === null || typeof mask !== "object") return undefined;
  const parsed = parsePhoneMaskPattern((mask as { pattern?: unknown }).pattern);
  if (parsed === null) return undefined;
  return { scaffold: parsed.scaffold, digitCount: parsed.digit_count };
}

export function renderPhoneInputQuestion(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  const mask = phoneMaskScaffold(node);
  // Rework §6.9: the compiled scaffold rides as a fallback placeholder (an
  // authored props.placeholder always wins — additive) + two data hooks
  // (scaffold + digit count) S2.3's fill behavior reads directly off the DOM,
  // mirroring the data-lg-maps convention of embedding what the runtime needs
  // as attributes rather than re-deriving it. undefined mask ⇒ every `extra`/
  // fallback argument below is "" / undefined ⇒ byte-identical to pre-§6.9.
  const extra =
    ` inputmode="tel" autocomplete="tel"` +
    (mask !== undefined ? attr("data-lg-mask-scaffold", mask.scaffold) + attr("data-lg-mask-digits", mask.digitCount) : "");
  return renderTextInput(node, design, "tel", extra, ctx, slot, mask?.scaffold);
}
export function renderDateQuestion(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  // PC-5/PC-A5 (P4b): the native <input type=date> min/max attrs get ONLY a
  // literal ISO bound (a "Custom date" pick). A DYNAMIC TOKEN (+7d/today/…) is
  // NOT emitted natively — it would be an invalid attr the browser silently
  // ignores (the old bug: garbage disabled the constraint), and this renderer
  // must stay pure/deterministic (no request-time clock → no golden drift). The
  // resolved bound is enforced by the client validate (validation.ts) via the
  // config's RESOLVED client_validation.min/max — which is also the documented
  // iOS-gap compensation, so a date input is gated on every platform.
  const min = propStr(node, "min");
  const max = propStr(node, "max");
  const nativeMin = isIsoDate(min) ? min : undefined;
  const nativeMax = isIsoDate(max) ? max : undefined;
  return renderTextInput(node, design, "date", attr("min", nativeMin) + attr("max", nativeMax), ctx, slot);
}
export function renderZIPInputQuestion(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
): string {
  const mapsRaw = node.props?.["maps"];
  // v3.1 §9.3 per-field precedence: a NEW-shape config's jobs.validate is
  // authoritative for THIS field (mapsJobsFor) — it wins over the legacy
  // bare props.validate flag wherever the new shape is present, including
  // deciding it OFF when maps.enabled is false. Only a node with NO
  // props.maps object at all falls back to the legacy flag.
  const googleValidate = mapsJobsFor(node).validate;
  // 03 §3.3 / 08 §8.8 / v3.1 §9.3: a ZIP component is Maps-enabled when it
  // carries a NEW-shape config with enabled:true, a pre-existing flat-shape
  // props.maps object (legacy, unconditional per §12 no-regression), or the
  // legacy per-node validate flag (the global address_validation_enabled
  // era) — then it emits data-lg-maps.
  const mapsEnabled = isNewMapsShape(mapsRaw)
    ? mapsRaw.enabled === true
    : typeof mapsRaw === "object" && mapsRaw !== null
      ? true
      : googleValidate;
  return renderTextInput(
    node,
    design,
    "text",
    ` inputmode="numeric" pattern="\\d{5}" maxlength="5"` +
      (googleValidate ? ` data-validate="google"` : "") +
      (mapsEnabled ? attr("data-lg-maps", mapsConfigJson(node)) : ""),
    ctx,
    slot,
  );
}

// PC-A8 (register): First/Last each get their own placeholder/helper/leading-
// icon now (previously hardcoded bare inputs — the operator's Contact
// scenario: typing into a per-field control did nothing because there was no
// per-field prop for it to write). Byte-identical to pre-PC-A8 output when
// none of the 6 new props (firstPlaceholder/lastPlaceholder/firstHelper/
// lastHelper/firstIcon/lastIcon) are authored — every addition below is an
// attr()/style() no-op against an absent value, the SAME "absent is empty"
// discipline renderTextInput/renderAddressAutocompleteQuestion already use
// for their own leading-icon box + helper line.
export function renderNameFieldsGroup(node: LeadgenComponentNode, design: DefaultFunnelDesign, slot = ""): string {
  const first = propStr(node, "firstLabel") ?? "First name";
  const last = propStr(node, "lastLabel") ?? "Surname";
  const firstHelper = fieldHelperLine(node, "firstHelper");
  const lastHelper = fieldHelperLine(node, "lastHelper");
  // Base border lives in the scoped chrome CSS (.lg-input) — not inline — so
  // the :focus / [aria-invalid] state rules win by cascade (no !important).
  const field = (
    label: string,
    name: string,
    autocomplete: string,
    placeholder: string | undefined,
    icon: string,
    helper: string,
  ): string => {
    // 03 §3.3: both name text inputs carry data-lg-input. Same left-inset
    // idiom as renderTextInput/renderAddressAutocompleteQuestion: a leading
    // icon adds padding-left so the input text clears the pin.
    const input =
      `<input class="lg-input" type="text" data-lg-input` +
      ` data-name-field="${name}" autocomplete="${autocomplete}"` +
      attr("placeholder", placeholder) +
      (icon !== "" ? style({ "padding-left": "42px" }) : "") +
      (node.required === true ? " required" : "") +
      `>`;
    const boxedInput =
      icon === ""
        ? input
        : '<span class="lg-field-box" style="position:relative;display:block">' +
          '<span class="lg-field-icon" aria-hidden="true" style="position:absolute;left:14px;top:0;bottom:0;display:flex;align-items:center;pointer-events:none;z-index:1">' +
          icon +
          "</span>" +
          input +
          "</span>";
    return `<label class="lg-field"><span class="lg-label">${esc(label)}</span>${boxedInput}${helper}</label>`;
  };
  return (
    `<div class="lg-name-group"${hydration(node)}>` +
    field(first, "first", "given-name", propStr(node, "firstPlaceholder"), fieldLeadingIcon(node, "firstIcon"), firstHelper) +
    field(last, "last", "family-name", propStr(node, "lastPlaceholder"), fieldLeadingIcon(node, "lastIcon"), lastHelper) +
    // CONDUCTOR FIX (P4b regression): the auto error slot (keyed on the
    // group's question_id, PC-A2) nests as the LAST CHILD of the group box,
    // never a card-level sibling — "" is a no-op.
    slot +
    `</div>` +
    // v3.1 R3b E1-NEW-7 / PC-A8: the group-level `helper` is now a DEPRECATED
    // fallback — CONTENT_PROP_FIELDS no longer advertises it (the Studio's
    // dedicated NameFieldsGroup block authors per-field helpers instead), but
    // it still renders — exactly as before, once, below both fields — for
    // legacy content that carries it, and ONLY when neither field has its own
    // per-field helper authored (adopting either per-field helper drops the
    // shared line — no doubled helper copy).
    (firstHelper === "" && lastHelper === "" ? fieldHelperLine(node) : "")
  );
}

// Rework §6.10/M9 — the per-field address renderer's own field-spec reading.
// Returns undefined for ANY corrupt/legacy shape (absent props.fields, a
// non-array, or a malformed entry) so the caller falls back to the EXACT
// pre-M9 composite renderer — L-192 "absent fields[] ⇒ render exactly as
// today". content-schema.validateAddressFields is the save-time gate; this
// read is defensive (clampInt-at-render idiom), never throws.
interface LeadgenAddressFieldSpec {
  field: LeadgenAddressFieldKind;
  label?: string;
  mode: LeadgenAddressFieldMode;
  required: boolean;
  zip5: boolean;
}

const ADDRESS_FIELD_KINDS: readonly LeadgenAddressFieldKind[] = ["street", "city", "state", "zip", "full_address"];

function readAddressFieldSpecs(node: LeadgenComponentNode): LeadgenAddressFieldSpec[] | undefined {
  const raw = node.props?.["fields"];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: LeadgenAddressFieldSpec[] = [];
  for (const f of raw) {
    if (f === null || typeof f !== "object" || Array.isArray(f)) return undefined;
    const r = f as Record<string, unknown>;
    const kind = r["field"];
    if (typeof kind !== "string" || !ADDRESS_FIELD_KINDS.includes(kind as LeadgenAddressFieldKind)) return undefined;
    out.push({
      field: kind as LeadgenAddressFieldKind,
      label: typeof r["label"] === "string" && r["label"].trim() !== "" ? r["label"] : undefined,
      mode: r["mode"] === "manual" ? "manual" : "autofill",
      required: r["required"] === true,
      zip5: r["validation"] === "zip5",
    });
  }
  return out;
}

const ADDRESS_FIELD_DEFAULT_LABEL: Record<Exclude<LeadgenAddressFieldKind, "full_address">, string> = {
  street: "Street address",
  city: "City",
  state: "State",
  zip: "ZIP code",
};

// Owner D3 (R2 P5 S5a): "The address... this is one of your worst
// executions... if I want it as a free text without validations or auto
// fill? if I want only street address? if I want to auto fill only for
// street address and city and I want the user will insert the Zip by
// himself but to validate the Zip in a 5 digits zip validation?... the
// mapping of what is auto-filled per field should definately be an option"
// — an UNCONFIGURED/legacy address (no props.fields[] authored at all, or a
// corrupt/malformed shape) no longer renders the pre-D3 single bare input +
// a decorative studio-only preview of what WOULD auto-fill (the owner's
// "worst execution" — the visitor never saw the 4 fields the studio
// decorated). It now renders the REAL, functional 4-field composite —
// byte-identical in SHAPE to what an author who explicitly configured
// street/city/state/zip (all autofill, zip carrying zip5) would get, because
// it's literally the SAME renderAddressFieldSet call with this as the
// default spec array. This is the exact default ui-section-studio.ts's own
// inspector already shows (its ADDRESS_DEFAULT_FIELDS constant) — so the
// inspector and the visitor now agree (ADJ-A8) instead of the inspector
// showing 4 fields while the visitor got 1. An author who saves ANY
// props.fields[] (even a single non-default entry) fully overrides this;
// nothing here reads authored state, so "existing explicitly-authored field
// sets keep their configuration" holds by construction.
const ADDRESS_DEFAULT_FIELD_SPECS: readonly LeadgenAddressFieldSpec[] = [
  { field: "street", mode: "autofill", required: false, zip5: false },
  { field: "city", mode: "autofill", required: false, zip5: false },
  { field: "state", mode: "autofill", required: false, zip5: false },
  { field: "zip", mode: "autofill", required: false, zip5: true },
];

// ADJ-A2 fix (R2 P5 S5a): validateSection (runtime/validation.ts) keys a
// fields[]-authored (or now-default) Address's required/zip5/custom-format
// failure to THIS field's OWN resolved name (addressFieldKey there —
// `{base}_{kind}`, mirroring m9AddressFieldName below), never to the whole-
// component autoErrorSlot's node-level key above (that one only ever fires
// for the pre-M9 whole-group required check). Today only that ONE outer
// slot exists, so setFieldError(sectionEl, "{base}_zip", …)'s slot lookup
// always misses — render.ts's aria-invalid/ERROR_CLASS red border still
// paints (data-lg-field DOES match) but the message text never does (a bad
// ZIP "blocks silently"). Same idiom as autoErrorSlot (a hidden, empty
// [data-lg-error-for] <p> the runtime fills/clears exactly like every other
// field's slot) — just parameterized on the resolved per-field name instead
// of a whole-node lookup, so EVERY sub-field (not only zip) now has
// somewhere to speak.
//
// P6 D1 UNIQUENESS FIX: emitting this slot unconditionally shipped DUPLICATE
// [data-lg-error-for] keys on one page — proven live (chromium, /lg funnel):
// an Address authored with per-field required + explicit ValidationError nodes
// on the SAME `{base}_{kind}` keys resolved
// `[data-lg-error-for="mailing_address_street"]` to 2 elements (this auto slot
// AND the authored <p data-component-type="ValidationError">). render.ts's
// setFieldError/clearFieldErrors use querySelector — FIRST match in document
// order only — so which slot speaks depended on where the author happened to
// place their ValidationError node: painting was ambiguous, and half the time
// the author's own slot stayed empty. The caller therefore skips this slot for
// (a) any field an authored ValidationError already binds (state
// .errorBoundFields — the SAME "authored override wins, never a double"
// precedence autoErrorSlot has applied since P4b) and (b) a resolved field
// name already emitted earlier in this same field set (two specs can collide
// via props.maps.fills overrides pointing at one key).
function addressFieldErrorSlot(design: DefaultFunnelDesign, fieldName: string): string {
  return (
    `<p class="lg-error lg-error-auto" role="alert" aria-live="polite" hidden` +
    attr("data-lg-error-for", fieldName) +
    style({ color: design.validation.errorTextColor }) +
    `></p>`
  );
}

// Field-name resolution mirrors the pre-M9 addrRoleField convention below
// (maps.fills.<slot> override, else {base}_{slot}) so a per-field input's
// data-lg-field always agrees with what maps.ts's autofill fill-target
// already expects — one derivation, never duplicated/drifted.
function m9AddressFieldName(
  base: string,
  fillsObj: Record<string, unknown>,
  kind: Exclude<LeadgenAddressFieldKind, "full_address">,
): string {
  const f = fillsObj[kind];
  return typeof f === "string" && f.trim() !== "" ? f.trim() : `${base}_${kind}`;
}

// The node-namespacing base every Address answer key hangs off:
// internal_field, else question_id, else the literal "address". The SAME
// precedence content-schema.ts collectKnownAnswerFields and runtime/
// validation.ts addressBase already use.
function m9AddressBase(node: LeadgenComponentNode): string {
  if (typeof node.internal_field === "string" && node.internal_field.trim() !== "") {
    return node.internal_field.trim();
  }
  if (typeof node.question_id === "string" && node.question_id !== "") return node.question_id;
  return "address";
}

function m9AddressFills(node: LeadgenComponentNode): Record<string, unknown> {
  const maps = node.props?.["maps"];
  const mapsObj = maps !== null && typeof maps === "object" ? (maps as Record<string, unknown>) : {};
  const fills = mapsObj["fills"];
  return fills !== null && typeof fills === "object" ? (fills as Record<string, unknown>) : {};
}

// R2 P5 (SRC-6 field-name SEAM): the answer keys an AddressAutocompleteQuestion
// ACTUALLY records, in render order — THE derivation, exported so the answer
// space cannot drift from the markup.
//
// This is renderAddressAutocompleteQuestion's own resolution, read out instead
// of re-implemented: props.fields[] (else the D3 default 4-field spec) → each
// spec's `data-lg-field` (m9AddressFieldName: maps.fills.<slot> override,
// else `{base}_{slot}` — the naming owner Image8 pins), and a lone
// `full_address` composite → the BARE base, because that branch's only
// [data-lg-field] is the wrapper's own hydration() attribute.
//
// Before this export, answers.ts fieldsOf claimed the BARE `props
// .internal_fields` names (street/city/state/zip) that NO renderer has emitted
// since M9 — so a driven visitor's `address_zip` matched no field spec and the
// whole address was dropped from normalizeAnswers, and therefore from every
// Offer payload built off it. content-schema.ts collectKnownAnswerFields (the
// save gate / activation preflight / studio rule-picker universe) already
// spoke `{base}_{slot}`; fieldsOf was the last holdout of the dead vocabulary.
export function leadgenAddressAnswerFields(node: LeadgenComponentNode): string[] {
  const specs = readAddressFieldSpecs(node) ?? ADDRESS_DEFAULT_FIELD_SPECS;
  const base = m9AddressBase(node);
  const fills = m9AddressFills(node);
  const out: string[] = [];
  for (const spec of specs) {
    const name =
      spec.field === "full_address"
        ? base
        : m9AddressFieldName(base, fills, spec.field as Exclude<LeadgenAddressFieldKind, "full_address">);
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

// The ZIP-family answer key an Address contributes (v3.1 §9 Maps auction/
// validate jobs), from the SAME resolution as leadgenAddressAnswerFields: the
// rendered `zip` field's own key, or — for a lone `full_address` composite —
// the base key, whose one string holds the whole address (deriveLocationFacet
// still parses a ZIP out of it). An Address rendering NO zip field contributes
// no ZIP-family answer at all: null. (The pre-seam code returned the literal
// "zip", or the last bare internal_fields entry — neither of which any visitor
// has recorded since M9, so the §9 facet silently read an absent answer.)
export function leadgenAddressZipAnswerField(node: LeadgenComponentNode): string | null {
  const specs = readAddressFieldSpecs(node) ?? ADDRESS_DEFAULT_FIELD_SPECS;
  if (specs.some((s) => s.field === "zip")) {
    return m9AddressFieldName(m9AddressBase(node), m9AddressFills(node), "zip");
  }
  if (specs.length === 1 && specs[0]?.field === "full_address") return m9AddressBase(node);
  return null;
}

// Rework §6.10/M9: N separate labeled inputs, ORDER/LABELS/MODE per
// props.fields[]. Each self-declares data-lg-field (so the EXISTING generic
// handleInputEvent `closest("[data-lg-field]")` records it — the SAME
// technique the §6.8 from_to/dual_range sub-fields use, zero new engine code).
// The first Maps-eligible (mode:'autofill', non-full_address) field carries
// data-lg-maps + becomes the Places "own field" (maps.ts initMapsFields);
// sibling autofill fields are its fill targets. Maps OFF/keyless degrades
// gracefully with ZERO renderer branching — initMapsFields itself no-ops
// silently (existing graceful path); every field is a plain, functional,
// typeable input regardless.
function renderAddressFieldSet(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx: LeadgenSectionRenderCtx | undefined,
  slot: string,
  specs: readonly LeadgenAddressFieldSpec[],
  // P6 D1: the internal_fields an authored ValidationError already reports on
  // (SectionRenderState.errorBoundFields). Undefined on every non-section
  // path (single-node previews/tests) ⇒ nothing suppressed, byte-identical.
  errorBoundFields?: ReadonlySet<string>,
): string {
  const provider = propStr(node, "provider") ?? "google";
  const addressMapsRaw = node.props?.["maps"];
  const addressMapsEnabled = isNewMapsShape(addressMapsRaw) ? addressMapsRaw.enabled === true : true;
  // R2 P5: the base + fills reads are the SHARED m9AddressBase/m9AddressFills
  // helpers (identical precedence to the inline reads they replace), so this
  // renderer and the exported leadgenAddressAnswerFields the answer space now
  // consumes are literally the same derivation.
  const addrBase = m9AddressBase(node);
  const addrFillsObj = m9AddressFills(node);
  // P5 tail (owner A.1 #6 "the mapping of what is auto-filled per field
  // should definatly be an option"): jobs.validate is the SAME authored
  // per-field toggle mapsJobsFor already resolves for the single-field
  // renderers below (renderZIPInputQuestion/renderAddressAutocompleteQuestion)
  // — reused here so the field-set's autocomplete field honours it too
  // instead of hardcoding it off, falling back to today's default (false)
  // when unauthored.
  const addrJobs = mapsJobsFor(node);
  // full_address may only appear alone (content-schema save gate) — a single
  // composite input, same semantics as the legacy renderer's one field.
  if (specs.length === 1 && specs[0]!.field === "full_address") {
    const f = specs[0]!;
    const placeholder = f.label ?? "Start typing your address…";
    return (
      `<div class="lg-address"${hydration(node)}${fieldSizeStyle(node, ctx)} data-provider="${esc(provider)}"${addressMapsEnabled ? attr("data-lg-maps", mapsConfigJson(node)) : ""}>` +
      `<input class="lg-input lg-address-input" type="text" data-lg-input` +
      ` autocomplete="street-address"${attr("placeholder", placeholder)}` +
      (node.required === true || f.required ? " required" : "") +
      ` data-address-autocomplete="true">` +
      slot +
      `</div>` +
      fieldHelperLine(node)
    );
  }
  // Which field drives the Places autocomplete: the FIRST autofill-mode,
  // non-full_address field, only when the master Maps toggle allows it.
  const autocompleteIndex = addressMapsEnabled ? specs.findIndex((f) => f.mode === "autofill") : -1;
  // R2 P5 S5a: the §8.1 leading icon + the §11.5/§12 Style-tab corners/
  // border-color overrides (MAJOR-1) were only ever wired on the single-
  // input legacy renderer this function's caller now also replaces for the
  // unconfigured default (D3) — carry both here too so neither authoring
  // surface silently regresses just because the address is a field-SET.
  // Icon anchors the FIRST rendered field (the same visual "entry point" it
  // marked on the single input); appearance (radius/border) applies to
  // EVERY field uniformly, matching the "inner .lg-input carries appearance,
  // never the outer wrapper" idiom this file uses everywhere else. Both are
  // additive: absent props.icon / design_overrides ⇒ "", byte-identical to a
  // field-set authored with neither.
  const icon = fieldLeadingIcon(node);
  // P5-F3 (owner A.1 #6 "poorly designed with poor logic" — Image8): a
  // placeholder alone vanishes the instant a visitor types, so a 4-field
  // composite left every sub-field unlabeled once filled (sighted visitors
  // got no persistent label; only aria-label kept screen readers informed).
  // Scope guard: a GENUINE multi-field composite ONLY (specs.length > 1) —
  // a single-field address (full_address already returns above; a lone
  // street-only field set falls through this same map with specs.length
  // === 1) keeps the question's own labelLine as its only label, exactly as
  // today, so neither owner-graded-PERFECT single-field scenario changes a
  // byte.
  const isMultiField = specs.length > 1;
  // P6 D1: every [data-lg-error-for] key this field set emits, so a resolved
  // name can never be slotted twice (see addressFieldErrorSlot's comment).
  const emittedErrorKeys = new Set<string>();
  const fieldHtml = specs
    .map((f, i) => {
      const kind = f.field as Exclude<LeadgenAddressFieldKind, "full_address">;
      const fieldName = m9AddressFieldName(addrBase, addrFillsObj, kind);
      const label = f.label ?? ADDRESS_FIELD_DEFAULT_LABEL[kind];
      // Same lg-ft-* idiom renderRangeQuestion's from_to sub-fields already
      // use (idBase + explicit for/id) — fieldName is already the unique-
      // per-node-per-field key (m9AddressFieldName), so prefixing it is
      // enough to make a valid, collision-safe DOM id.
      const fieldId = `lg-addr-${fieldName}`;
      // A DEDICATED class, not the general question-level .lg-label (labelLine)
      // — this is a per-SUB-FIELD label inside ONE composite, an orthogonal
      // §6.3 concern; reusing .lg-label collided with the pre-existing "ONE
      // label above the whole field-set" / byte-identity fixture assertions
      // that key on that exact class/string (leadgen-rework-render.test.ts,
      // out of this slice's ownership) — a dedicated class avoids that
      // collision entirely while rendering identical typography (mirrored
      // rule, styles.ts).
      const fieldLabelHtml = isMultiField
        ? `<label class="lg-address-field-label"${attr("for", fieldId)}>${esc(label)}</label>`
        : "";
      const isAutocompleteField = i === autocompleteIndex;
      // Fill targets: every OTHER autofill-mode field's resolved name (M9
      // Google-Maps fill mapping — the SAME 4-key {street,city,state,zip}
      // shape maps.ts's LeadgenNewMapsShape.fills already understands).
      const fillsForMapsConfig: Record<string, string> = {};
      if (isAutocompleteField) {
        for (const other of specs) {
          if (other === f || other.mode !== "autofill" || other.field === "full_address") continue;
          fillsForMapsConfig[other.field] = m9AddressFieldName(addrBase, addrFillsObj, other.field as Exclude<LeadgenAddressFieldKind, "full_address">);
        }
      }
      const mapsAttr = isAutocompleteField
        ? attr(
            "data-lg-maps",
            JSON.stringify({ enabled: true, jobs: { validate: addrJobs.validate, auction: false, autocomplete: true }, fills: fillsForMapsConfig }),
          )
        : "";
      const zip5Attrs = kind === "zip" && f.zip5 ? ` inputmode="numeric" pattern="\\d{5}" maxlength="5"` : "";
      const hasIcon = i === 0 && icon !== "";
      const inputStyleAttr = hasIcon
        ? style({ ...appearanceStyleEntries(node, design), "padding-left": "42px" })
        : fieldAppearanceStyle(node, design);
      const input =
        `<input class="lg-input" type="text" data-lg-input${inputStyleAttr}` +
        `${isMultiField ? attr("id", fieldId) : ""}${attr("placeholder", label)}${attr("aria-label", label)}` +
        (isAutocompleteField ? ` autocomplete="street-address" data-address-autocomplete="true"` : "") +
        zip5Attrs +
        (f.required ? " required" : "") +
        `>`;
      const boxedInput = hasIcon
        ? '<span class="lg-field-box" style="position:relative;display:block">' +
          '<span class="lg-field-icon" aria-hidden="true" style="position:absolute;left:14px;top:0;bottom:0;display:flex;align-items:center;pointer-events:none;z-index:1">' +
          icon +
          "</span>" +
          input +
          "</span>"
        : input;
      // ADJ-A2: a per-field slot so a required/zip5/custom-format failure on
      // THIS field (validateSection keys it to fieldName) has somewhere to
      // paint — see addressFieldErrorSlot's own comment for the mechanism.
      // P6 D1: unless that key already speaks (authored ValidationError, or an
      // earlier spec in this set resolving to the same name) — one key, one
      // slot, so setFieldError's querySelector is never ambiguous.
      const keyAlreadySlotted = errorBoundFields?.has(fieldName) === true || emittedErrorKeys.has(fieldName);
      if (!keyAlreadySlotted) emittedErrorKeys.add(fieldName);
      return (
        `<span class="lg-address-field-wrap"${attr("data-lg-field", fieldName)}${mapsAttr}>` +
        fieldLabelHtml +
        boxedInput +
        (keyAlreadySlotted ? "" : addressFieldErrorSlot(design, fieldName)) +
        `</span>`
      );
    })
    .join("");
  return (
    `<div class="lg-address lg-address-fieldset"${hydration(node)}${fieldSizeStyle(node, ctx)} data-provider="${esc(provider)}">` +
    `<div class="lg-address-fields"${style({ display: "flex", "flex-direction": "column", gap: design.spacing.sm })}>` +
    fieldHtml +
    `</div>` +
    slot +
    `</div>` +
    fieldHelperLine(node)
  );
}

export function renderAddressAutocompleteQuestion(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
  slot = "",
  // P6 D1: authored-ValidationError-bound fields (see renderAddressFieldSet).
  // Omitted ⇒ nothing suppressed, byte-identical to every pre-P6 call.
  errorBoundFields?: ReadonlySet<string>,
): string {
  // Rework §6.10/M9 + owner D3 (R2 P5 S5a): props.fields[] present ⇒ the
  // per-field renderer using the AUTHOR's own order/labels/mode (full_address
  // single-input included) — untouched, "existing explicitly-authored field
  // sets keep their configuration". Absent/corrupt ⇒ the SAME per-field
  // renderer using the DEFAULT 4-field spec (owner D3 ruling: "when
  // unconfigured, the visitor renders the FULL 4-FIELD COMPOSITE — not the
  // legacy single input"). This retires the pre-D3 L-192 bare-input fallback
  // (+ its studio-only decorative preview of what WOULD auto-fill) the owner
  // called "one of your worst executions" — the visitor now sees the SAME
  // real fields the studio inspector already showed as a preview.
  const fieldSpecs = readAddressFieldSpecs(node) ?? ADDRESS_DEFAULT_FIELD_SPECS;
  // Rework §6.3: labelLine extends to Address (additive — "" when no
  // props.label).
  return labelLine(node) + renderAddressFieldSet(node, design, ctx, slot, fieldSpecs, errorBoundFields);
}

// ---------------------------------------------------------------------------
// controls
// ---------------------------------------------------------------------------

export function renderContinueButton(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
): string {
  const label = propStr(node, "label") ?? "Continue";
  const loadingLabel = propStr(node, "loadingLabel") ?? label;
  // §14.6: navy primary (NOT blue), full-width pill. The base navy background
  // lives in the scoped chrome CSS (.lg-btn) so the :hover/:active/disabled
  // state rules win by cascade (no !important). A curated §14.8 buttonBackground
  // override rides the --lg-btn-bg custom property (the .lg-continue chrome rule
  // reads it) — NOT an inline background that would defeat :hover. buttonText
  // has no state variant, so it stays a per-instance inline value.
  // §9.2 layers 4–5: per-node value (role-resolved, §9.4) wins over the
  // Section palette re-point of the button roles (these defaults ARE the
  // button_primary_bg/button_primary_text base tokens) wins over the themed
  // design. No Section entry + no per-node bg ⇒ no --lg-btn-bg (today's bytes).
  const bgOverride =
    ovColor(node, "buttonBackground", design, ctx) ??
    sectionRoleValue(design, ctx, "button_primary_bg");
  const fg =
    ovColor(node, "buttonText", design, ctx) ??
    sectionRoleValue(design, ctx, "button_primary_text") ??
    design.primaryButton.color;
  return (
    // 03 §3.3: data-lg-continue is the engine's advance hook.
    `<button type="submit" class="lg-btn lg-continue"${hydration(node)} data-lg-continue${buttonStyleAttrs(design, { fill: true })}` +
    style({ "--lg-btn-bg": bgOverride, color: fg }) +
    attr("data-loading-label", loadingLabel) +
    ` data-loading="false">` +
    `<span class="lg-btn-spinner" aria-hidden="true"></span>` +
    `<span class="lg-btn-label">${esc(label)}</span>` +
    `</button>`
  );
}

export function renderAutoAdvanceButton(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
): string {
  const label = propStr(node, "label") ?? "Continue";
  // Same discipline as renderContinueButton: the navy base lives in the chrome
  // CSS (.lg-btn) so :hover applies; the §14.8 buttonBackground override rides
  // the --lg-btn-bg custom property (read by the .lg-auto-advance chrome rule).
  // §9.2 layers 4–5 resolve exactly like renderContinueButton.
  const bgOverride =
    ovColor(node, "buttonBackground", design, ctx) ??
    sectionRoleValue(design, ctx, "button_primary_bg");
  const fg =
    ovColor(node, "buttonText", design, ctx) ??
    sectionRoleValue(design, ctx, "button_primary_text") ??
    design.primaryButton.color;
  return (
    // 03 §3.3: an AutoAdvanceButton is a manual advance control too → it
    // carries the same data-lg-continue hook (auto-advance sections advance on
    // answer_click; this button is the explicit fallback, §3.5 step 4).
    `<button type="button" class="lg-btn lg-auto-advance"${hydration(node)} data-lg-continue${buttonStyleAttrs(design, { fill: true })}` +
    style({ "--lg-btn-bg": bgOverride, color: fg }) +
    ` data-auto-advance="true">${esc(label)}</button>`
  );
}

// R7 U12 FIX 3b (golden :308, conductor-ruled 2026-07-15): the white question
// card — the section-unit's DEFAULT composition. Wraps the top-level
// (depth===1) rendered content ONLY (renderSectionComponents/Visible call
// this once, after their own recursion, before the below_unit slot append).
// `.lg-question-card` styling lives in the BASE (non-frameRegions-gated)
// sheet in designs/default-funnel/styles.ts, so it reaches EVERY caller of
// the shared renderer identically: the studio Build canvas (always
// frameless), the admin dependency-preview simulator, AND the live funnel
// (legacy-frameless OR frame-composed) — one mechanism, "§12 parity by
// construction," never gated on frame presence. NO data-lg-* attribute (pure
// visual chrome, not an engine hook) — mirrors renderContinueSlot's own
// "no data-lg-* on the wrapper" discipline below.
//
// Frame coherence ("no double card", both directions proven in
// leadgen-u12-rhythm.test.ts): a framed funnel's OWN `section_slot.card`
// config ("card" is the FRAME_TEMPLATES default) used to ALSO paint a white
// box via `.lg-frame-slot--card` (designs/default-funnel/styles.ts) — since
// this unit-level card is now the SINGLE SOURCE for that look,
// `.lg-frame-slot--card` (+ its 3 `--pad-{s,m,l}` companions) had their
// background/border/radius/shadow/padding declarations REMOVED (styles.ts) —
// the frame's card-mode CLASS still renders (frame.ts's own markup/config
// plumbing is untouched — out of this file's ownership), it simply no longer
// PAINTS a second box. Exactly one visual card exists, in "card" mode, "bare"
// mode, and frameless, alike.
function renderQuestionCard(inner: string): string {
  return `<div class="lg-question-card">${inner}</div>`;
}

// 11 §11.5 below_unit — the frame-styled slot carrying the ONE continue
// control at the END of the section subtree (DOM-wise still inside the
// section element, so the engine's per-section [data-lg-continue] show/hide +
// validation binding is untouched). `node` is the Section's FIRST
// ContinueButton (it provides label/loading props + curated overrides); a
// Section without one renders the preset's theme copy ("Continue") on a
// default node. The slot wrapper stamps the §3.3 continue_style_role so
// frame/theme chrome CSS can key on it; it deliberately carries NO
// data-lg-* attribute (the control inside is the engine hook).
function renderContinueSlot(
  node: LeadgenComponentNode | undefined,
  design: DefaultFunnelDesign,
  ctx: LeadgenSectionRenderCtx | undefined,
): string {
  // ctx threads through so the slot control honours the §9.5 Section palette.
  const control = renderContinueButton(node ?? { type: "ContinueButton", question_id: "" }, design, ctx);
  return (
    `<div class="lg-continue-slot"` +
    attr("data-continue-style-role", ctx?.continue_style_role) +
    `>${control}</div>`
  );
}

// ---------------------------------------------------------------------------
// remaining affordances
// ---------------------------------------------------------------------------

export function renderReassuranceBadge(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const rb = design.reassuranceBadge;
  const icon = propStr(node, "icon") ?? "✓"; // ✓
  const text = propStr(node, "text") ?? rb.exampleCopy;
  return (
    `<div class="lg-badge"${hydration(node)}` +
    style({ border: rb.border, background: rb.background, color: rb.textColor }) +
    `>` +
    `<span class="lg-badge-icon"${style({ color: rb.iconColor })} aria-hidden="true">${esc(icon)}</span>` +
    `<span class="lg-badge-text">${esc(text)}</span>` +
    `</div>`
  );
}

// 08 §8.10 SuccessState: completion/success affordance (role="status" so AT
// announces it when the runtime reveals it). Token-styled like the
// reassurance badge (success-green outline family); heading/message/icon all
// optional and read defensively.
export function renderSuccessState(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const ss = design.successState;
  const icon = propStr(node, "icon") ?? "✓";
  const heading = propStr(node, "heading");
  const message = propStr(node, "message");
  return (
    `<div class="lg-success"${hydration(node)} role="status"` +
    style({ border: ss.border, background: ss.background, "border-radius": ss.borderRadius }) +
    `>` +
    `<span class="lg-success-icon"${style({ color: ss.iconColor })} aria-hidden="true">${esc(icon)}</span>` +
    (heading !== undefined && heading !== ""
      ? `<div class="lg-success-heading"${style({ "font-family": ss.headingFontFamily, color: ss.headingColor })}>${esc(heading)}</div>`
      : "") +
    (message !== undefined && message !== ""
      ? `<p class="lg-success-message"${style({ color: ss.messageColor })}>${esc(message)}</p>`
      : "") +
    `</div>`
  );
}

// 08 §8.3 SecureFormBadge: secure-form trust messaging — the ReassuranceBadge
// pattern (inline token colours with no state) in the muted navy family.
export function renderSecureFormBadge(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const sb = design.secureFormBadge;
  const icon = propStr(node, "icon") ?? "🔒";
  const text = propStr(node, "text") ?? sb.exampleCopy;
  return (
    `<div class="lg-secure-badge"${hydration(node)}` +
    style({ border: sb.border, background: sb.background, color: sb.textColor }) +
    `>` +
    `<span class="lg-secure-badge-icon"${style({ color: sb.iconColor })} aria-hidden="true">${esc(icon)}</span>` +
    `<span class="lg-secure-badge-text">${esc(text)}</span>` +
    `</div>`
  );
}

// 08 §8.3/§8.10 TrustBar: icon/text trust pairs from STRUCTURED props
// (props.items — never child nodes), laid out horizontal (default) or stacked
// via a modifier class. Fully class-driven (no inline style); items read
// defensively (non-object rows and empty rows are skipped).
function trustBarItems(node: LeadgenComponentNode): Array<{ icon: string; text: string }> {
  const raw = node.props?.["items"];
  if (!Array.isArray(raw)) return [];
  const out: Array<{ icon: string; text: string }> = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    const icon = typeof r["icon"] === "string" ? r["icon"] : "";
    const text = typeof r["text"] === "string" ? r["text"] : "";
    if (icon === "" && text === "") continue;
    out.push({ icon, text });
  }
  return out;
}

export function renderTrustBar(node: LeadgenComponentNode, _design: DefaultFunnelDesign): string {
  const stacked = propStr(node, "layout") === "stacked";
  const items = trustBarItems(node)
    .map(
      (item) =>
        `<span class="lg-trustbar-item">` +
        (item.icon !== "" ? `<span class="lg-trustbar-icon" aria-hidden="true">${esc(item.icon)}</span>` : "") +
        `<span class="lg-trustbar-text">${esc(item.text)}</span>` +
        `</span>`,
    )
    .join("");
  return (
    `<div class="lg-trustbar${stacked ? " lg-trustbar-stacked" : ""}"${hydration(node)}>` +
    items +
    `</div>`
  );
}

// 08 §8.3/§8.10 LogoStrip: carrier/partner logo row from STRUCTURED props
// (props.logos — never child nodes). Media reference flows to src exactly like
// ImageCardAnswerGrid's imageMediaId; rows without a mediaId are skipped.
// Fully class-driven (no inline style).
// R2 F-2 — the PER-LOGO size (element F "Size", FrameBrandLogoItem.size).
// The admin has always written it (templates.ts data-bl-item-size) and the
// editor has always hydrated it back (funnel.ts), but renderBrandLogos mapped
// each item to {mediaId, alt} and DROPPED it here, and no CSS class for it
// existed: the operator picked Small/Medium/Large per logo and the strip never
// moved. A size that survives the map rides as a MODIFIER CLASS (never inline
// CSS — this renderer is "fully class-driven"); styles.ts turns the class into
// the `--lg-logo-max-h` custom property the strip's max-height already reads.
// Absent/unrecognised size emits NO extra class ⇒ byte-identical for every
// section-level LogoStrip node and every pre-F-2 stored strip.
const LOGO_STRIP_SIZES: ReadonlySet<string> = new Set(["s", "m", "l"]);
function logoStripLogos(node: LeadgenComponentNode): Array<{ mediaId: string; alt: string; size?: string }> {
  const raw = node.props?.["logos"];
  if (!Array.isArray(raw)) return [];
  const out: Array<{ mediaId: string; alt: string; size?: string }> = [];
  for (const logo of raw) {
    if (typeof logo !== "object" || logo === null || Array.isArray(logo)) continue;
    const r = logo as Record<string, unknown>;
    const mediaId = typeof r["mediaId"] === "string" ? r["mediaId"] : "";
    if (mediaId === "") continue;
    const size = typeof r["size"] === "string" && LOGO_STRIP_SIZES.has(r["size"]) ? r["size"] : undefined;
    out.push({ mediaId, alt: typeof r["alt"] === "string" ? r["alt"] : "", size });
  }
  return out;
}

export function renderLogoStrip(node: LeadgenComponentNode, _design: DefaultFunnelDesign): string {
  const logos = logoStripLogos(node)
    .map(
      (logo) =>
        `<img class="lg-logo-strip-img${logo.size === undefined ? "" : ` lg-logo-strip-img--${logo.size}`}"` +
        ` src="${esc(logo.mediaId)}" alt="${esc(logo.alt)}" loading="lazy">`,
    )
    .join("");
  return `<div class="lg-logo-strip"${hydration(node)}>${logos}</div>`;
}

export function renderHelperText(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
): string {
  // v3.1 R3b E2-C1: wire the pre-existing Style-tab "Text color role" control.
  const color = ovColor(node, "featureColor", design, ctx) ?? design.validation.helperColor;
  return (
    `<p class="lg-helper"${hydration(node)}${style({ color })}>` +
    `${esc(propStr(node, "text"))}</p>`
  );
}

export function renderValidationError(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const text = propStr(node, "text");
  return (
    // 03 §3.3: data-lg-error-for names the internal_field this slot reports on
    // (when the author bound one — attr() omits the hook for a generic slot).
    `<p class="lg-error" role="alert" aria-live="polite"${hydration(node)}${attr("data-lg-error-for", node.internal_field)}` +
    style({ color: design.validation.errorTextColor }) +
    `>${esc(text)}</p>`
  );
}

export function renderLegalNote(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
): string {
  // html is author rich text → escaped (the runtime renders it into the note).
  // v3.1 R3b E2-C1: wire the pre-existing Style-tab "Text color role" control.
  const color = ovColor(node, "featureColor", design, ctx) ?? design.validation.helperColor;
  return (
    `<div class="lg-legal"${hydration(node)}${style({ color })}>` +
    `${esc(propStr(node, "html"))}</div>`
  );
}

// ---------------------------------------------------------------------------
// v3.1 05 §5.3 Text/Image primitives — the Section-palette consolidation of
// CategoryLabel/HelperText/LegalNote/ReassuranceBadge/SecureFormBadge (Text,
// role-typed) and HeaderLogo/LogoStrip in-unit usage (Image/Logo,
// source=auto_logo). Each per-role/per-source function below is a NEW,
// STANDALONE function that deliberately DUPLICATES the exact markup shape of
// its retired counterpart (same wrapper tag/class, same style() token pairs,
// same escaped content) rather than refactoring/calling into the retired
// renderers above — those stay byte-for-byte UNTOUCHED (§5.3 "existing
// sections... render byte-identically until edited; on load they map to the
// equivalent primitive + role (the renderer keeps the old preset)" — i.e. a
// STORED legacy CategoryLabel/HelperText/etc. node keeps dispatching to its
// OWN retired renderer forever; only a NEWLY-authored/rewritten TextBlock
// node reaches the functions below). The only intentional difference from
// the retired preset's own output is hydration()'s `data-component-type`
// value ("TextBlock"/"ImageBlock" vs the retired type name) — a CORRECT
// reflection of the node's real type, not a fidelity gap (data-component-type
// has zero CSS/JS consumers today, grep-verified).
// ---------------------------------------------------------------------------

function renderTextBlockHeading(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
): string {
  // No retired one-off precedent (Heading/Body are NEW roles, §5.3) — reuses
  // the QuestionHeadline token family (design.headline) as the closest
  // "heading-styled text" treatment already in this design.
  // v3.1 R3b E2-C1: wire the Style tab's "Text color role" control (already
  // unconditionally shown for every TextBlock role — the renderer never
  // consumed it for 6/7 roles until now).
  const color = ovColor(node, "featureColor", design, ctx) ?? design.headline.color;
  return (
    `<h2 class="lg-text-heading"${hydration(node)}` +
    style({ "font-family": design.headline.fontFamily, color }) +
    `>${esc(propStr(node, "text"))}</h2>`
  );
}

function renderTextBlockBody(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
): string {
  // No retired one-off precedent and no existing "generic body paragraph"
  // token group (headline/subheadline/categoryLabel/validation/reassurance/
  // secureFormBadge are all narrower-purpose) — plain escaped text, no inline
  // style by default (the same no-exotic-styling choice FooterBar's legal
  // slot makes elsewhere). v3.1 R3b E2-C1: UNLIKE the other roles, Body never
  // had an unconditional color before — an authored featureColor override is
  // the ONLY thing that emits a color here, so absent override stays
  // byte-identical (no forced default color would be honest for a role that
  // never rendered one).
  return `<p class="lg-text-body"${hydration(node)}${style({ color: ovColor(node, "featureColor", design, ctx) })}>${esc(propStr(node, "text"))}</p>`;
}

// Byte-identical markup shape to renderCategoryLabel (role="category_label").
function renderTextBlockCategoryLabel(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
): string {
  const color = ovColor(node, "featureColor", design, ctx) ?? design.categoryLabel.color;
  return (
    `<div class="lg-category"${hydration(node)}${style({ color, "letter-spacing": design.categoryLabel.letterSpacing })}>` +
    `${esc(propStr(node, "text"))}</div>`
  );
}

// Byte-identical markup shape to renderHelperText (role="helper").
function renderTextBlockHelper(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
): string {
  // v3.1 R3b E2-C1: wire the Style tab's "Text color role" control.
  const color = ovColor(node, "featureColor", design, ctx) ?? design.validation.helperColor;
  return (
    `<p class="lg-helper"${hydration(node)}${style({ color })}>` +
    `${esc(propStr(node, "text"))}</p>`
  );
}

// Byte-identical markup shape to renderLegalNote (role="legal") — reads
// props.text (the new unified TextBlock convention) rather than the legacy
// props.html key; both flow through the identical esc() call.
function renderTextBlockLegal(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
): string {
  // v3.1 R3b E2-C1: wire the Style tab's "Text color role" control.
  const color = ovColor(node, "featureColor", design, ctx) ?? design.validation.helperColor;
  return (
    `<div class="lg-legal"${hydration(node)}${style({ color })}>` +
    `${esc(propStr(node, "text"))}</div>`
  );
}

// Byte-identical markup shape to renderReassuranceBadge (role="reassurance").
// icon stays a free-form glyph (content-schema.ts's badge-role carve-out).
function renderTextBlockReassurance(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
): string {
  const rb = design.reassuranceBadge;
  const icon = propStr(node, "icon") ?? "✓";
  const text = propStr(node, "text") ?? rb.exampleCopy;
  // v3.1 R3b E2-C1: wire the Style tab's "Text color role" control (the
  // badge's TEXT color specifically — border/background/icon stay token-fixed,
  // matching the reassurance family's own visual language).
  const color = ovColor(node, "featureColor", design, ctx) ?? rb.textColor;
  return (
    `<div class="lg-badge"${hydration(node)}` +
    style({ border: rb.border, background: rb.background, color }) +
    `>` +
    `<span class="lg-badge-icon"${style({ color: rb.iconColor })} aria-hidden="true">${esc(icon)}</span>` +
    `<span class="lg-badge-text">${esc(text)}</span>` +
    `</div>`
  );
}

// Byte-identical markup shape to renderSecureFormBadge (role="secure_badge").
function renderTextBlockSecureBadge(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
): string {
  const sb = design.secureFormBadge;
  const icon = propStr(node, "icon") ?? "🔒";
  const text = propStr(node, "text") ?? sb.exampleCopy;
  // v3.1 R3b E2-C1: wire the Style tab's "Text color role" control.
  const color = ovColor(node, "featureColor", design, ctx) ?? sb.textColor;
  return (
    `<div class="lg-secure-badge"${hydration(node)}` +
    style({ border: sb.border, background: sb.background, color }) +
    `>` +
    `<span class="lg-secure-badge-icon"${style({ color: sb.iconColor })} aria-hidden="true">${esc(icon)}</span>` +
    `<span class="lg-secure-badge-text">${esc(text)}</span>` +
    `</div>`
  );
}

// TextBlock dispatch by role (§8.5b Style-tab role list); absent/unknown role
// defaults to "heading" (every prop is optional per REQUIRED_FIELDS.TextBlock).
export function renderTextBlock(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  ctx?: LeadgenSectionRenderCtx,
): string {
  switch (propStr(node, "role")) {
    case "body":
      return renderTextBlockBody(node, design, ctx);
    case "category_label":
      return renderTextBlockCategoryLabel(node, design, ctx);
    case "helper":
      return renderTextBlockHelper(node, design, ctx);
    case "legal":
      return renderTextBlockLegal(node, design, ctx);
    case "reassurance":
      return renderTextBlockReassurance(node, design, ctx);
    case "secure_badge":
      return renderTextBlockSecureBadge(node, design, ctx);
    case "heading":
    default:
      return renderTextBlockHeading(node, design, ctx);
  }
}

// ImageBlock source="auto_logo": the logo RESOLUTION fragment is
// byte-identical to renderHeaderLogo's own `inner` branch (same props —
// logoUrl/siteName/accent; same design.header.* token slots), per §5.3
// "HeaderLogo/LogoStrip (in-unit) -> Image/Logo -> Source = Auto site logo".
// The OUTER wrapper deliberately does NOT reproduce renderHeaderLogo's
// `<header>` landmark tag: HeaderLogo is a frame-scope, one-per-page chrome
// element; ImageBlock is a unit-scope primitive that can appear anywhere/any
// number of times in a Section, so repeating the `<header>` landmark would be
// an accessibility regression (duplicate landmarks), not a fidelity win —
// only the logo RESOLUTION markup (img vs text+accent span) matches byte for
// byte.
// v3.1 R3b deliverable 4: neither this module nor ANY caller (grep-verified —
// zero non-schema/non-studio hits for "auto_logo" repo-wide) ever injects real
// site branding (logoUrl/siteName) onto an in-Section ImageBlock node the way
// frame.ts's logoNodeProps() does for the frame-scope HeaderLogo — a Section is
// authored independent of any one funnel/site, so this primitive's "auto
// site logo" resolution genuinely has NO branding context to read, in the
// Studio canvas preview AND in a hypothetical future runtime path alike. A
// bare, un-styled empty <span> (the pre-R3b behavior) is an invisible box,
// not an honest placeholder. Absent BOTH identifying props, render a labeled
// placeholder using ONLY existing design tokens (input.border/
// page.textLightColor — no new visual language invented) — the moment a real
// caller populates logoUrl/siteName (this function's own existing, unchanged
// contract), the placeholder branch is bypassed and real branding renders,
// byte-identical to today.
function renderImageBlockAutoLogo(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const logoUrl = propStr(node, "logoUrl");
  const siteNameRaw = propStr(node, "siteName");
  const siteName = siteNameRaw !== undefined && siteNameRaw !== "" ? siteNameRaw : undefined;
  const accent = propStr(node, "accent");
  if (logoUrl === undefined && siteName === undefined) {
    return (
      `<div class="lg-image-block lg-image-block-logo lg-image-block-placeholder"${hydration(node)} data-source="auto_logo" data-placeholder="true"` +
      style({ border: design.input.border, color: design.page.textLightColor, "font-family": design.header.logoFontFamily }) +
      `>Site logo</div>`
    );
  }
  const inner =
    logoUrl !== undefined && logoUrl !== ""
      ? `<img class="lg-logo-img" src="${esc(logoUrl)}" alt="${esc(siteName ?? "")}" decoding="async"${style({ "max-height": design.header.logoFontSize })}>`
      : `<span class="lg-logo"${style({ color: design.header.logoColor, "font-family": design.header.logoFontFamily })}>${esc(siteName ?? "")}` +
        (accent !== undefined
          ? `<span class="lg-logo-accent"${style({ color: design.header.logoAccentColor })}>${esc(accent)}</span>`
          : "") +
        `</span>`;
  return `<div class="lg-image-block lg-image-block-logo"${hydration(node)} data-source="auto_logo">${inner}</div>`;
}

// ImageBlock source="media" (default/explicit image — no retired-type
// precedent to match; LogoStrip is a MULTI-logo strip and ImageCardAnswerGrid
// is choice cards, neither is "one plain authored image"). Reuses the
// logoMediaId->src convention already used by HeaderLogo/HeaderBar.
function renderImageBlockMedia(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const mediaId = propStr(node, "logoMediaId");
  const alt = propStr(node, "alt") ?? "";
  if (mediaId === undefined || mediaId === "") {
    // v3.1 R3b deliverable 4: an honest labeled placeholder (same token-only
    // treatment as the auto_logo branch above) instead of an invisible box —
    // the operator sees exactly where a chosen image will render.
    return (
      `<div class="lg-image-block lg-image-block-placeholder"${hydration(node)} data-source="media" data-placeholder="true"` +
      style({ border: design.input.border, color: design.page.textLightColor }) +
      `>Image</div>`
    );
  }
  return (
    `<div class="lg-image-block"${hydration(node)} data-source="media">` +
    `<img class="lg-image-block-img" src="${esc(mediaId)}" alt="${esc(alt)}" loading="lazy">` +
    `</div>`
  );
}

export function renderImageBlock(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  return propStr(node, "source") === "auto_logo"
    ? renderImageBlockAutoLogo(node, design)
    : renderImageBlockMedia(node, design);
}

// ---------------------------------------------------------------------------
// §8.5 layout containers (fix-contract v2.4 08, E4) — SERVER-side rendering.
// The 5 children-bearing containers recurse via renderNodes(node.children ??
// [], design, depth + 1, state) inside their wrapper markup (threading the ONE
// §3.4/§11.5 SectionRenderState across the whole tree); the 3 layout leaves
// (Spacer / HeaderBar / FooterBar) render structured props only.
// House rules hold throughout: esc() every author value, style({…}) carries
// token values ONLY (the §8.5 enum → design-token lookup below), hydration(
// node) rides the container WRAPPER, and no preset emits <style>/<script>.
// DEPTH GUARD (defensive): the validator is the gate (max depth 4); render
// additionally refuses to recurse past LEADGEN_MAX_CONTAINER_DEPTH so corrupt
// / cyclic data can never stack-overflow the renderer.
// ---------------------------------------------------------------------------

function containerChildren(node: LeadgenComponentNode): LeadgenComponentNode[] {
  return Array.isArray(node.children) ? node.children : [];
}

// §8.5 enum → design-token lookups. Explicit switches (not computed keys) so
// the `as const` token records stay statically typed; unknown/absent enum
// values fall to the documented default (validator rejects unknowns at save —
// these fallbacks are render-defensive only).
function stackGapValue(design: DefaultFunnelDesign, token: string | undefined): string {
  const s = design.stack;
  switch (token) {
    case "xs": return s.gapXs;
    case "s": return s.gapS;
    case "l": return s.gapL;
    case "xl": return s.gapXl;
    default: return s.gapM;
  }
}
function gridGapValue(design: DefaultFunnelDesign, token: string | undefined): string {
  const g = design.gridContainer;
  switch (token) {
    case "xs": return g.gapXs;
    case "s": return g.gapS;
    case "l": return g.gapL;
    case "xl": return g.gapXl;
    default: return g.gapM;
  }
}
function spacerSizeValue(design: DefaultFunnelDesign, token: string | undefined): string {
  const s = design.spacer;
  switch (token) {
    case "xs": return s.sizeXs;
    case "s": return s.sizeS;
    case "l": return s.sizeL;
    case "xl": return s.sizeXl;
    default: return s.sizeM;
  }
}
function cardPanelWidthValue(design: DefaultFunnelDesign, token: string | undefined): string {
  const p = design.cardPanel;
  switch (token) {
    case "s": return p.widthS;
    case "m": return p.widthM;
    case "l": return p.widthL;
    default: return p.widthFull;
  }
}
function cardPanelBackgroundValue(design: DefaultFunnelDesign, token: string | undefined): string {
  const p = design.cardPanel;
  switch (token) {
    case "wash": return p.backgroundWash;
    case "ghost": return p.backgroundGhost;
    case "transparent": return p.backgroundTransparent;
    default: return p.backgroundCard;
  }
}
function cardPanelShadowValue(design: DefaultFunnelDesign, token: string | undefined): string {
  const p = design.cardPanel;
  switch (token) {
    case "none": return p.shadowNone;
    case "sm": return p.shadowSm;
    case "lg": return p.shadowLg;
    case "xl": return p.shadowXl;
    default: return p.shadowMd;
  }
}
function cardPanelRadiusValue(design: DefaultFunnelDesign, token: string | undefined): string {
  const p = design.cardPanel;
  switch (token) {
    case "sm": return p.radiusSm;
    case "md": return p.radiusMd;
    case "xl": return p.radiusXl;
    default: return p.radiusLg;
  }
}
function cardPanelPaddingValue(design: DefaultFunnelDesign, token: string | undefined): string {
  const p = design.cardPanel;
  switch (token) {
    case "s": return p.paddingS;
    case "l": return p.paddingL;
    default: return p.paddingM;
  }
}
function bgPanelBackgroundValue(design: DefaultFunnelDesign, token: string | undefined): string {
  const b = design.backgroundPanel;
  switch (token) {
    case "card": return b.backgroundCard;
    case "wash": return b.backgroundWash;
    case "ghost": return b.backgroundGhost;
    case "primary": return b.backgroundPrimary;
    default: return b.backgroundPage;
  }
}
function bgPanelGradientValue(design: DefaultFunnelDesign, token: string | undefined): string | undefined {
  const b = design.backgroundPanel;
  switch (token) {
    case "primary": return b.gradientPrimary;
    case "accent": return b.gradientAccent;
    case "wash": return b.gradientWash;
    default: return undefined;
  }
}

// Stack (§8.5): vertical|horizontal token-gap grouping. Direction/align ride
// data attributes (class-driven layout in the scoped chrome CSS); the
// per-instance gap token value is inline (the --lg-cols idiom).
export function renderStack(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  depth = 1,
  state?: SectionRenderState,
): string {
  if (depth > LEADGEN_MAX_CONTAINER_DEPTH) return "";
  const direction = propStr(node, "direction") === "horizontal" ? "horizontal" : "vertical";
  const alignProp = propStr(node, "align");
  const align =
    alignProp === "start" || alignProp === "center" || alignProp === "end" ? alignProp : "stretch";
  return (
    `<div class="lg-stack"${hydration(node)} data-direction="${direction}" data-align="${align}"` +
    style({ gap: stackGapValue(design, propStr(node, "gap")) }) +
    `>` +
    renderNodes(containerChildren(node), design, depth + 1, state) +
    `</div>`
  );
}

// GridContainer (§8.5): per-breakpoint column counts ride --lg-gc-cols-* custom
// properties (the iconCardGrid --lg-cols idiom); the scoped chrome CSS consumes
// desktop at base and mobile inside the mobile media query. Sizing auto|equal
// is a data attribute (two class-driven grid-template variants).
export function renderGridContainer(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  depth = 1,
  state?: SectionRenderState,
): string {
  if (depth > LEADGEN_MAX_CONTAINER_DEPTH) return "";
  const cols = (key: string, fallback: number, lo: number, hi: number): number =>
    clampInt(propNum(node, key) ?? fallback, lo, hi);
  const sizing = propStr(node, "sizing") === "auto" ? "auto" : "equal";
  return (
    `<div class="lg-grid-container"${hydration(node)} data-sizing="${sizing}"` +
    style({
      "--lg-gc-cols-d": String(cols("columnsDesktop", 3, 2, 5)),
      "--lg-gc-cols-t": String(cols("columnsTablet", 2, 1, 4)),
      "--lg-gc-cols-m": String(cols("columnsMobile", 1, 1, 2)),
      gap: gridGapValue(design, propStr(node, "gap")),
    }) +
    `>` +
    renderNodes(containerChildren(node), design, depth + 1, state) +
    `</div>`
  );
}

// Columns (§8.5): ratio preset + mobile stacking — both data attributes; the
// grid-template per ratio and the mobile stack collapse live entirely in the
// scoped chrome CSS (no inline style at all).
export function renderColumns(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  depth = 1,
  state?: SectionRenderState,
): string {
  if (depth > LEADGEN_MAX_CONTAINER_DEPTH) return "";
  const ratioProp = propStr(node, "ratio");
  const ratio =
    ratioProp === "60/40" || ratioProp === "40/60" || ratioProp === "70/30" ? ratioProp : "50/50";
  const mobile = propStr(node, "mobile") === "keep" ? "keep" : "stack";
  return (
    `<div class="lg-columns"${hydration(node)} data-ratio="${ratio}" data-mobile="${mobile}">` +
    renderNodes(containerChildren(node), design, depth + 1, state) +
    `</div>`
  );
}

// CardPanel (§8.5): the centered question card. Width/background/shadow/
// radius/padding are §8.5 token enums resolved to design.cardPanel values —
// per-instance inline token values (the ReassuranceBadge idiom; no state
// rules on panels). data-width names the preset for the Studio canvas.
export function renderCardPanel(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  depth = 1,
  state?: SectionRenderState,
): string {
  if (depth > LEADGEN_MAX_CONTAINER_DEPTH) return "";
  const width = propStr(node, "width") ?? "full";
  return (
    `<div class="lg-card-panel"${hydration(node)} data-width="${esc(width)}"` +
    style({
      "max-width": cardPanelWidthValue(design, propStr(node, "width")),
      background: cardPanelBackgroundValue(design, propStr(node, "background")),
      "box-shadow": cardPanelShadowValue(design, propStr(node, "shadow")),
      "border-radius": cardPanelRadiusValue(design, propStr(node, "radius")),
      padding: cardPanelPaddingValue(design, propStr(node, "padding")),
    }) +
    `>` +
    renderNodes(containerChildren(node), design, depth + 1, state) +
    `</div>`
  );
}

// BackgroundPanel (§8.5): background token | image mediaId | gradient token —
// approved design tokens ONLY. A gradient token outranks the flat background
// token; an image renders as a decorative cover <img> behind the content (the
// ImageCardAnswerGrid mediaId→src idiom — author content NEVER enters a style
// attribute).
export function renderBackgroundPanel(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  depth = 1,
  state?: SectionRenderState,
): string {
  if (depth > LEADGEN_MAX_CONTAINER_DEPTH) return "";
  const gradient = bgPanelGradientValue(design, propStr(node, "gradient"));
  const background = gradient ?? bgPanelBackgroundValue(design, propStr(node, "background"));
  const imageMediaId = propStr(node, "imageMediaId");
  const image =
    imageMediaId !== undefined && imageMediaId !== ""
      ? `<img class="lg-bg-panel-img" src="${esc(imageMediaId)}" alt="" aria-hidden="true" loading="lazy">`
      : "";
  return (
    `<div class="lg-bg-panel"${hydration(node)}${style({ background })}>` +
    image +
    `<div class="lg-bg-panel-inner">` +
    renderNodes(containerChildren(node), design, depth + 1, state) +
    `</div>` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// R2 P1 §① — the QUESTION GRID container (owner A.1 #1/#2; design pin
// "Screenshot 2026-07-27 at 18.30.25.png")
// ---------------------------------------------------------------------------
//
// ANATOMY (the pin, read top-to-bottom): the section title, then a STACK of
// LABELED question blocks — each block is one question's own label ABOVE its
// own control (Yes/No pair, dropdown, buttons …) — and ONE Continue for the
// whole screen. So this container renders:
//
//   <div class="lg-qgrid" data-component-type="QuestionGrid" style="gap:…">
//     <div class="lg-qgrid-q">              ← ONE labeled block per child
//       <span class="lg-label">…</span>     ← the CHILD's own labelLine
//       <div class="lg-answer-group" data-lg-question="…">…</div>
//     </div>
//     … N blocks …
//   </div>
//
// Three rules this renderer obeys, all of them owner-verbatim consequences:
//
//  1. EVERY child renders through its OWN existing renderer (renderComponent —
//     the same per-type dispatch every other container uses). Nothing about a
//     question changes because it sits in a group: its label, choices,
//     default, required flag, per-question `design_overrides` (D4) and its
//     hydration attrs are produced by the SAME code path as a standalone
//     instance. "Each question in the component is independent field, with
//     independent answers, inefendent **defaults!!** … independent style".
//  2. The CONTAINER carries NO [data-lg-question] (hydration emits it only for
//     an answer-PRODUCING catalog type, and the grid's `produces` is null) —
//     the children carry it. The container answers no field, is labeled by no
//     label, and adds NO Continue of its own: the section's single §11.5
//     control still owns that.
//  3. Each child's LABEL + CONTROL share ONE wrapper (`.lg-qgrid-q`), and for
//     a child with a dependency rule that wrapper — not the bare control — is
//     the runtime's hide target: it carries `data-lg-node="<child qid>"`, the
//     hook render.applyComponentVisibility already selects on
//     (`[data-lg-question="q"],[data-lg-node="q"]`, first match in DOCUMENT
//     order ⇒ the ancestor wrapper). Hiding it hides the label WITH the
//     control, so a dependency-hidden question can never leave an orphaned
//     label behind ("if the user clicked 'no' and the dependency rule wasn't
//     met, we need to ignore this question- it isn't relevant, so it doesn't
//     exist"). `data-lg-node` (never a second [data-lg-question]) keeps the
//     §11.6 question count pure — exactly the reason hydration() introduced
//     that attribute for conditional non-producing nodes.
function questionGridGapStyle(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  // The container's ONE authorable knob (CONTAINER_PROP_SPECS.QuestionGrid):
  // the spacing between its stacked questions, on the SAME xs..xl token scale
  // (and the SAME resolver) the Stack container uses — registry tokenSlots
  // ["stack"]. Always emitted, so the grid owns its internal rhythm and needs
  // no `> * + *` margin floor (the styles.ts scoping rule for containers with
  // explicit gap semantics).
  return style({ gap: stackGapValue(design, propStr(node, "gap")) });
}

// ONE child question → its labeled, independently-hideable block.
function wrapGridQuestion(node: LeadgenComponentNode, html: string): string {
  if (html === "") return "";
  const conditional =
    typeof node === "object" && node !== null ? node.conditional : undefined;
  return (
    `<div class="lg-qgrid-q"` +
    // Only a child that actually carries a dependency rule needs the hide
    // hook; an unconditional question is never toggled, so it stays a plain
    // block (no attribute invented where nothing consumes it).
    (conditional !== undefined ? attr("data-lg-node", node.question_id) : "") +
    `>${html}</div>`
  );
}

// The child walk — routed through the SAME renderPlacedSiblings every other
// sibling list uses, so a grid's children can sit side by side via `layout`
// (validateRowGrouping already gates that list) exactly like top-level
// siblings; the per-child block wrapper is applied INSIDE each slot.
function renderQuestionGridChildren(
  children: readonly LeadgenComponentNode[],
  design: DefaultFunnelDesign,
  depth: number,
  state: SectionRenderState | undefined,
): string {
  return renderPlacedSiblings(children, state?.ctx, (child) =>
    wrapGridQuestion(child, renderComponent(child, design, depth, state)),
  );
}

export function renderQuestionGrid(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  depth = 1,
  state?: SectionRenderState,
): string {
  if (depth > LEADGEN_MAX_CONTAINER_DEPTH) return "";
  return (
    `<div class="lg-qgrid"${hydration(node)}` +
    questionGridGapStyle(node, design) +
    `>` +
    renderQuestionGridChildren(containerChildren(node), design, depth + 1, state) +
    `</div>`
  );
}

// Spacer (§8.5 layout leaf): a token-sized vertical gap by default. v3.1
// §5.6 (adversarial review m2): an OPTIONAL "line" variant (the Divider
// tile) renders the SAME token-sized block with a visible center rule,
// instead of an empty gap — additive; an absent/"gap" variant is
// BYTE-IDENTICAL to this renderer before the variant prop existed.
export function renderSpacer(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const height = spacerSizeValue(design, propStr(node, "size"));
  if (propStr(node, "variant") === "line") {
    return (
      `<div class="lg-spacer lg-spacer-line"${hydration(node)}` +
      style({ height, display: "flex", "align-items": "center" }) +
      ` aria-hidden="true"><span style="width:100%;border-top:${esc(design.cardPanel.border)}"></span></div>`
    );
  }
  return (
    `<div class="lg-spacer"${hydration(node)}` +
    style({ height }) +
    ` aria-hidden="true"></div>`
  );
}

// HeaderBar (§8.5 layout leaf): logo slot (mediaId) · back toggle · secure
// slot · optional CTA {label, href|tel}. Fully class-driven (headerBar token
// group in the scoped chrome CSS); the back toggle carries the engine's
// data-lg-back hook (03 §3.3) exactly like the BackButton chrome component.
export function renderHeaderBar(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const logoMediaId = propStr(node, "logoMediaId");
  const logo =
    logoMediaId !== undefined && logoMediaId !== ""
      ? `<img class="lg-headerbar-logo" src="${esc(logoMediaId)}" alt="${esc(propStr(node, "logoAlt") ?? "")}" decoding="async">`
      : "";
  const backLabel = propStr(node, "backLabel") ?? "Back";
  const back = propBool(node, "back")
    ? `<button type="button" class="lg-back lg-headerbar-back" data-lg-back aria-label="${esc(backLabel)}">` +
      `<span aria-hidden="true">&#8592;</span> ${esc(backLabel)}</button>`
    : "";
  const secure = propBool(node, "secure")
    ? `<span class="lg-headerbar-secure">` +
      `<span class="lg-headerbar-secure-icon" aria-hidden="true">🔒</span>` +
      `<span>${esc(propStr(node, "secureText") ?? design.headerBar.exampleSecureCopy)}</span>` +
      `</span>`
    : "";
  const rawCta = node.props?.["cta"];
  let cta = "";
  if (typeof rawCta === "object" && rawCta !== null && !Array.isArray(rawCta)) {
    const c = rawCta as Record<string, unknown>;
    const label = typeof c["label"] === "string" ? c["label"] : "";
    const tel = typeof c["tel"] === "string" && c["tel"].trim() !== "" ? c["tel"].trim() : undefined;
    const href =
      typeof c["href"] === "string" && c["href"].trim() !== ""
        ? c["href"].trim()
        : tel !== undefined
          ? tel.toLowerCase().startsWith("tel:")
            ? tel
            : `tel:${tel}`
          : undefined;
    if (label !== "" && href !== undefined) {
      cta = `<a class="lg-headerbar-cta" href="${esc(href)}">${esc(label)}</a>`;
    }
  }
  return (
    `<div class="lg-headerbar"${hydration(node)}>` +
    `<div class="lg-headerbar-left">${back}${logo}</div>` +
    `<div class="lg-headerbar-right">${secure}${cta}</div>` +
    `</div>`
  );
}

// FooterBar (§8.5 layout leaf): legal slot (escaped author rich text, the
// LegalNote idiom) · trust messages · links. Fully class-driven (footerBar
// token group in the scoped chrome CSS).
export function renderFooterBar(node: LeadgenComponentNode, _design: DefaultFunnelDesign): string {
  const rawTrust = node.props?.["trustMessages"];
  const trust = Array.isArray(rawTrust)
    ? rawTrust
        .filter((m): m is string => typeof m === "string" && m.trim() !== "")
        .map((m) => `<span class="lg-footerbar-trust-item">${esc(m)}</span>`)
        .join("")
    : "";
  const rawLinks = node.props?.["links"];
  const links = Array.isArray(rawLinks)
    ? rawLinks
        .map((link) => {
          if (typeof link !== "object" || link === null || Array.isArray(link)) return "";
          const r = link as Record<string, unknown>;
          const label = typeof r["label"] === "string" ? r["label"] : "";
          const href = typeof r["href"] === "string" ? r["href"] : "";
          if (label === "" || href === "") return "";
          return `<a class="lg-footerbar-link" href="${esc(href)}">${esc(label)}</a>`;
        })
        .join("")
    : "";
  const legalHtml = propStr(node, "legalHtml");
  const legal =
    legalHtml !== undefined && legalHtml !== ""
      ? `<div class="lg-footerbar-legal">${esc(legalHtml)}</div>`
      : "";
  return (
    `<footer class="lg-footerbar"${hydration(node)}>` +
    (trust !== "" ? `<div class="lg-footerbar-trust">${trust}</div>` : "") +
    (links !== "" ? `<nav class="lg-footerbar-links">${links}</nav>` : "") +
    legal +
    `</footer>`
  );
}

// ---------------------------------------------------------------------------
// dispatcher
// ---------------------------------------------------------------------------

// Map a component node → its preset markup under the active design. The switch
// is exhaustive over ComponentType (a new catalog type without a preset fails
// typecheck at the `never` guard); unknown types are unreachable given
// validateSectionContent, but are handled defensively with an empty render.
// `depth` is the §8.5 container-nesting level (root = 1) — only the container
// cases consume it (their recursion + the defensive depth guard). `state` is
// the per-renderSectionComponents §3.4/§11.5 context thread — absent (the
// single-node/Visible paths), every case renders exactly as before v2.5.
export function renderComponent(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  depth = 1,
  state?: SectionRenderState,
): string {
  // CONDUCTOR FIX (P4b regression — leadgen-p1-geometry RHYTHM / gate1c /
  // leadgen-visual): the auto error slot was appended AFTER renderComponent's
  // own return value as a NEW CARD-LEVEL SIBLING (renderNodes/renderVisibleNodes
  // used to do `renderComponent(...) + autoErrorSlot(...)`). A sibling-combinator
  // CSS selector (`.lg-card-grid + *`, the followerSelectors() collapse-emulation
  // table) matches on LITERAL DOM ADJACENCY regardless of the interposed
  // element's `hidden`/display:none state, so the auto slot silently broke the
  // TRUE next sibling's targeted match, falling through to the wrong margin-top
  // (confirmed live: MultiChoiceCardGroup->ContinueButton measured 26px instead
  // of the intended 24px). FIX: compute the slot ONCE here and thread it INTO
  // each answer-producing renderer as its OWN LAST CHILD (the field/group box
  // the message semantically belongs to) — every renderer accepts it as an
  // OPTIONAL trailing `slot: string = ""` param, so a call site that omits it
  // (every non-section-render path: tests, single-node previews, the empty-
  // clone container trick) renders BYTE-IDENTICALLY to before this fix. Card-
  // level sibling adjacency is restored to EXACTLY the pre-P4b shape (the
  // slot never appears as a NEW top-level child again).
  const slot = autoErrorSlot(node, design, state);
  switch (node.type) {
    case "ProgressBar":
      return renderProgressBar(node, design);
    case "HeaderLogo":
      return renderHeaderLogo(node, design);
    case "BackButton":
      return renderBackButton(node, design);
    case "DisclosureLink":
      return renderDisclosureLink(node, design);
    case "StepIndicator":
      return renderStepIndicator(node, design);
    case "CategoryLabel":
      // §9.2 layers 4–5: state.ctx carries the Section design_overrides —
      // absent (single-node paths) every consumer renders exactly as before.
      return renderCategoryLabel(node, design, state?.ctx);
    case "QuestionHeadline":
      return renderQuestionHeadline(node, design, state?.ctx);
    case "Subheadline":
      return renderSubheadline(node, design, state?.ctx);
    case "NumberRangeQuestion":
      return renderNumberRangeQuestion(node, design, state?.ctx, slot);
    case "ButtonAnswerGroup":
      return renderButtonAnswerGroup(node, design, state?.ctx, slot);
    case "IconCardAnswerGrid":
      return renderIconCardAnswerGrid(node, design, state?.ctx, slot);
    case "ImageCardAnswerGrid":
      return renderImageCardAnswerGrid(node, design, state?.ctx, slot);
    case "TwoButtonYesNo":
      return renderTwoButtonYesNo(node, design, state?.ctx, slot);
    case "MultiChoiceCardGroup":
      return renderMultiChoiceCardGroup(node, design, state?.ctx, slot);
    case "DropdownQuestion":
      return renderDropdownQuestion(node, design, state?.ctx, slot);
    case "SearchableDropdownQuestion":
      return renderSearchableDropdownQuestion(node, design, state?.ctx, slot);
    case "FreeTextQuestion":
      return renderFreeTextQuestion(node, design, state?.ctx, slot);
    case "NumberInputQuestion":
      return renderNumberInputQuestion(node, design, state?.ctx, slot);
    case "CurrencyInputQuestion":
      return renderCurrencyInputQuestion(node, design, state?.ctx, slot);
    case "EmailInputQuestion":
      return renderEmailInputQuestion(node, design, state?.ctx, slot);
    case "PhoneInputQuestion":
      return renderPhoneInputQuestion(node, design, state?.ctx, slot);
    case "AddressAutocompleteQuestion":
      return renderAddressAutocompleteQuestion(node, design, state?.ctx, slot, state?.errorBoundFields);
    case "ZIPInputQuestion":
      return renderZIPInputQuestion(node, design, state?.ctx, slot);
    case "NameFieldsGroup":
      // NameFieldsGroup has no internal_field / single input box — §7 field
      // sizing is not wired here (two labeled sub-inputs, not one field box).
      return renderNameFieldsGroup(node, design, slot);
    case "DateQuestion":
      return renderDateQuestion(node, design, state?.ctx, slot);
    case "ContinueButton": {
      // 11 §11.5 single-control rule (C3) — active only inside a
      // renderSectionComponents call (state present):
      if (state === undefined) return renderContinueButton(node, design);
      // auto_advance → ZERO continue controls in either placement.
      if (state.suppressContinue) return "";
      // Duplicate ContinueButton nodes: the FIRST provides props; later ones
      // render NOTHING (save emits the duplicate_continue warning upstream).
      if (state.continueSeen) return "";
      state.continueSeen = true;
      if (state.deferContinue) {
        // below_unit: suppress the in-node visual; the captured node feeds the
        // single end-of-subtree slot control (renderSectionComponents emits it).
        state.deferredContinue = node;
        return "";
      }
      return renderContinueButton(node, design, state.ctx);
    }
    case "AutoAdvanceButton":
      // 11 §11.5: an auto_advance Section renders NO [data-lg-continue]
      // control in either placement — the manual-fallback button included.
      // PC-A1 (P4a): under deferContinue (below_unit OR the ineligible-
      // auto_advance forced slot) the ONE control renders at the end slot, so
      // this inline node is suppressed to avoid a double Continue.
      return state !== undefined && (state.suppressContinue || state.deferContinue)
        ? ""
        : renderAutoAdvanceButton(node, design, state?.ctx);
    case "ReassuranceBadge":
      return renderReassuranceBadge(node, design);
    case "SuccessState":
      return renderSuccessState(node, design);
    case "SecureFormBadge":
      return renderSecureFormBadge(node, design);
    case "TrustBar":
      return renderTrustBar(node, design);
    case "LogoStrip":
      return renderLogoStrip(node, design);
    case "HelperText":
      return renderHelperText(node, design, state?.ctx);
    case "ValidationError":
      return renderValidationError(node, design);
    case "LegalNote":
      return renderLegalNote(node, design, state?.ctx);
    case "TextBlock":
      return renderTextBlock(node, design, state?.ctx);
    case "ImageBlock":
      return renderImageBlock(node, design);
    // §8.5 layout containers (recursive) + layout leaves — `state` threads
    // through so the §11.5 single-control rule spans the WHOLE section tree.
    case "Stack":
      return renderStack(node, design, depth, state);
    case "GridContainer":
      return renderGridContainer(node, design, depth, state);
    case "Columns":
      return renderColumns(node, design, depth, state);
    case "CardPanel":
      return renderCardPanel(node, design, depth, state);
    case "BackgroundPanel":
      return renderBackgroundPanel(node, design, depth, state);
    // R2 P1 §① the QUESTION grid container (recursive, like the §8.5 layout
    // containers above — but its children are QUESTIONS, each rendered by its
    // own per-type renderer through this same dispatch).
    case "QuestionGrid":
      return renderQuestionGrid(node, design, depth, state);
    case "Spacer":
      return renderSpacer(node, design);
    case "HeaderBar":
      return renderHeaderBar(node, design);
    case "FooterBar":
      return renderFooterBar(node, design);
    default: {
      // Compile-time exhaustiveness guard: a NEW catalog type without a case
      // above trips this `never` assignment. At RUNTIME this branch also catches
      // a stored node of a §10-RETIRED type (MultiQuestionGrid / OtherGroupSelector
      // / RangeQuestion / CurrencyRangeQuestion) or any otherwise-unknown type —
      // validateSectionContent already flags it with a clear unknown_component_type
      // error, and here it renders the fail-safe box, NEVER a 500 (L-192 seam).
      // The `.lg-mqg-empty` box is scoped by styles.ts to `.lg-preview` (studio
      // canvas / admin preview) and display:none on the live `#lg-funnel-root`,
      // so a live session that somehow still carries a retired type renders
      // nothing (silent) while the studio gets an honest notice.
      const _exhaustive: never = node.type;
      void _exhaustive;
      const retiredNode = node as unknown as LeadgenComponentNode;
      return (
        `<div class="lg-mqg-empty"${attr("data-component-type", retiredNode.type)}${attr("data-question-id", retiredNode.question_id)}>` +
        `This question type is retired or unknown — re-create it from the palette.` +
        `</div>`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// P3a (register PC-2 / D1 / R-B) — STRUCTURED PLACEMENT render layer.
// ---------------------------------------------------------------------------
// A node's OPTIONAL `layout` groups contiguous same-`row` siblings into a flex
// `.lg-el-row` (2-3 slots) and gives each element an `align`, a slot/box
// `width` (the SAME size-width resolver), and a bounded `nudge`. A node
// carrying NO placement renders byte-identically to pre-P3a (the fast path
// below is the EXACT pre-P3a `nodes.map(...).join("")`).

// The node's placement bag IFF it carries at least one meaningful key — an
// absent / empty `{}` layout is `undefined` (byte-identical). Null-safe (the
// walk may see corrupt non-object entries).
function placementOf(node: LeadgenComponentNode): LeadgenPlacementLayout | undefined {
  if (node === null || typeof node !== "object") return undefined;
  const l = node.layout;
  if (l === undefined || typeof l !== "object") return undefined;
  if (
    l.row === undefined &&
    l.align === undefined &&
    l.width === undefined &&
    l.nudge_x === undefined &&
    l.nudge_y === undefined
  ) {
    return undefined;
  }
  return l;
}

function hasPlacement(node: LeadgenComponentNode): boolean {
  return placementOf(node) !== undefined;
}

// The grouping key: a non-empty string row-id (render-defensive — validation is
// the save-time gate; the id is used only for grouping, never emitted, so no
// escape concern).
function placementRowId(node: LeadgenComponentNode): string | undefined {
  const row = placementOf(node)?.row;
  return typeof row === "string" && row !== "" ? row : undefined;
}

// Defensive re-clamp of a nudge axis (validate-time enforces [-48,48]; a
// corrupt/legacy value is clamped here, mirroring the module's clampInt idiom).
function placementNudge(n: number | undefined): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return clampInt(n, -48, 48);
}

// The translate() for the two nudge axes, or undefined when both are zero.
// Emitted as the `--lg-el-nudge` custom property (styles.ts reads it into
// `transform`) so the ≤480px stack can neutralize it — nudges are a desktop
// refinement.
function placementNudgeVar(layout: LeadgenPlacementLayout): string | undefined {
  const x = placementNudge(layout.nudge_x);
  const y = placementNudge(layout.nudge_y);
  if (x === 0 && y === 0) return undefined;
  return `translate(${x}px, ${y}px)`;
}

// Resolve layout.width through the EXACT design_overrides.size WIDTH resolver
// (resolveFieldSize + sizeAxisCssValue) → a concrete CSS width ("384px",
// "100%", "320px", …) or undefined (absent / stale preset). One width
// vocabulary, one resolver (§R-B).
function placementWidthCss(
  layout: LeadgenPlacementLayout,
  ctx: LeadgenSectionRenderCtx | undefined,
): string | undefined {
  if (layout.width === undefined) return undefined;
  const controls = ctx?.theme_controls ?? DEFAULT_SIZE_THEME_CONTROLS;
  return sizeAxisCssValue(resolveFieldSize({ width: layout.width }, controls).width, "width");
}

// Finish a LONE (not-in-a-row) node: a no-placement node renders raw
// (byte-identical); a placed node is wrapped in `.lg-el` ONLY when it needs a
// fixed-width box (+ align margins) or a nudge — align-only stays raw (its
// align threads into the node's OWN size-centering via widthCenteringEntries).
function finishLonePlacement(
  node: LeadgenComponentNode,
  html: string,
  ctx: LeadgenSectionRenderCtx | undefined,
): string {
  if (html === "") return "";
  const layout = placementOf(node);
  if (layout === undefined) return html;
  const wCss = placementWidthCss(layout, ctx);
  const fixedW = wCss !== undefined && wCss !== "100%" ? wCss : undefined;
  const nudge = placementNudgeVar(layout);
  if (fixedW === undefined && nudge === undefined) return html;
  const styleAttr = style({
    width: fixedW,
    ...widthCenteringEntries(fixedW, { align: layout.align }),
    "--lg-el-nudge": nudge,
  });
  return `<div class="lg-el"${styleAttr}>${html}</div>`;
}

// Wrap ONE row member in its `.lg-el` slot: the slot basis rides `--lg-el-basis`
// (a fixed width member; unauthored/full members keep the CSS equal-basis
// default), `data-align` positions its content, `--lg-el-nudge` carries the
// bounded offset.
//
// CONDUCTOR FIX (P3 re-review, fresh regression from the MINOR-2 fix): the
// live hidden-slot-collapse CSS rule (styles.ts) must ONLY ever collapse a
// LEAF member's slot — a CONTAINER row member (e.g. CardPanel) can carry its
// OWN mix of always-visible + conditionally-hidden CHILDREN; collapsing the
// whole slot because ONE descendant happens to be hidden would also hide the
// container's OTHER, still-visible content (a live-proven regression: a
// [leaf + CardPanel{visible TextBlock, conditional FreeTextQuestion}] row —
// hiding the inner FreeTextQuestion collapsed the ENTIRE CardPanel slot,
// including its always-visible TextBlock, to 0×0). `data-el-leaf` marks a
// slot as a single answer-producing/content LEAF (never a container) — the
// CSS selector below can then require it, so a container's slot NEVER
// collapses from an inner descendant's `hidden`, only a leaf's OWN single
// `[data-lg-question]` doing so (a leaf has exactly one, and its own
// visibility state IS the slot's — there is no "partially visible" leaf).
function wrapRowMember(
  node: LeadgenComponentNode,
  html: string,
  ctx: LeadgenSectionRenderCtx | undefined,
): string {
  const layout = placementOf(node) ?? {};
  const wCss = placementWidthCss(layout, ctx);
  const fixedW = wCss !== undefined && wCss !== "100%" ? wCss : undefined;
  const styleAttr = style({
    "--lg-el-basis": fixedW,
    "--lg-el-nudge": placementNudgeVar(layout),
  });
  return (
    `<div class="lg-el"` +
    attr("data-align", isPlacementAlign(layout.align) ? layout.align : undefined) +
    attr("data-el-basis", fixedW !== undefined ? "1" : undefined) +
    attr("data-el-leaf", isLayoutContainerType(node.type) ? undefined : "1") +
    styleAttr +
    `>${html}</div>`
  );
}

function isPlacementAlign(v: unknown): v is LeadgenPlacementAlign {
  return v === "start" || v === "center" || v === "end";
}

// Render a contiguous run of same-row members → one `.lg-el-row`. Members that
// render empty (a hidden/suppressed node) drop out; a run left with a single
// real member renders as a lone element (no `.lg-el-row` for one slot).
function renderElementRow(
  members: readonly LeadgenComponentNode[],
  ctx: LeadgenSectionRenderCtx | undefined,
  renderOne: (node: LeadgenComponentNode) => string,
): string {
  const rendered: Array<{ node: LeadgenComponentNode; html: string }> = [];
  for (const m of members) {
    const html = renderOne(m);
    if (html !== "") rendered.push({ node: m, html });
  }
  if (rendered.length === 0) return "";
  if (rendered.length === 1) {
    const only = rendered[0] as { node: LeadgenComponentNode; html: string };
    return finishLonePlacement(only.node, only.html, ctx);
  }
  const slots = rendered.map((r) => wrapRowMember(r.node, r.html, ctx)).join("");
  return `<div class="lg-el-row" data-row-cols="${rendered.length}">${slots}</div>`;
}

// The shared sibling walk both renderNodes and renderVisibleNodes drive.
// `renderOne` turns ONE node into its markup ("" when suppressed/hidden). When
// no sibling carries placement this is the EXACT pre-P3a `map(...).join("")`
// (byte-identical); otherwise it groups contiguous same-row runs into
// `.lg-el-row` and wraps lone placed elements in `.lg-el`.
function renderPlacedSiblings(
  nodes: readonly LeadgenComponentNode[],
  ctx: LeadgenSectionRenderCtx | undefined,
  renderOne: (node: LeadgenComponentNode) => string,
): string {
  if (!nodes.some(hasPlacement)) return nodes.map(renderOne).join("");
  let out = "";
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i] as LeadgenComponentNode;
    const rowId = placementRowId(node);
    if (rowId !== undefined) {
      let j = i + 1;
      while (j < nodes.length && placementRowId(nodes[j] as LeadgenComponentNode) === rowId) j++;
      out += renderElementRow(nodes.slice(i, j), ctx, renderOne);
      i = j;
      continue;
    }
    out += finishLonePlacement(node, renderOne(node), ctx);
    i++;
  }
  return out;
}

// Internal ordered walk — threads the ONE per-call SectionRenderState through
// the container recursion so the §11.5 single-control rule and the §3.4 bound
// text resolve over the WHOLE section tree, not per nesting level. P3a: routed
// through renderPlacedSiblings (the no-placement fast path is byte-identical to
// the pre-P3a `map(...).join("")`).
function renderNodes(
  nodes: readonly LeadgenComponentNode[],
  design: DefaultFunnelDesign,
  depth: number,
  state: SectionRenderState | undefined,
): string {
  // CONDUCTOR FIX (P4b regression): the auto error slot is now threaded INSIDE
  // renderComponent's own producer-renderer calls (its own last child) —
  // renderComponent(...) alone is byte-complete; no external append.
  return renderPlacedSiblings(nodes, state?.ctx, (n) => renderComponent(n, design, depth, state));
}

// Ordered render of a full Section: each component's preset markup, in order.
// §8.5: pass the FULL tree — container presets recurse into their children at
// depth + 1 (renderComponent threads depth + state; the container renderers
// stop past LEADGEN_MAX_CONTAINER_DEPTH). A flat legacy array (zero
// containers) renders byte-identically to the pre-§8.5 output.
//
// v2.5 03 §3.4 / 13 §13.1: the OPTIONAL third arg is the Section render
// context — bound QuestionHeadline/Subheadline text + the §11.5 Continue
// ownership fields. Call sites that omit it (legacy) render byte-identically
// to today for content without duplicate ContinueButton nodes (the C3 dedupe
// is the ONE contracted change for pathological legacy duplicates). With
// ctx.continue_placement="below_unit" the single control renders at the END
// of the subtree in the frame-styled slot; ctx.continue_mode="auto_advance"
// renders ZERO continue controls.
interface ContinueRenderPlan {
  // Suppress EVERY [data-lg-continue] control (the auto_advance default).
  suppressContinue: boolean;
  // Force the single end-of-subtree Continue slot even under an inside_unit
  // frame — the ineligible-auto_advance un-stick.
  forceSlot: boolean;
}

// 11 §11.5 / PC-A1 (P4a): how continue_mode drives Continue rendering for THIS
// section body. auto_advance suppresses the Continue ONLY when the section is
// auto-advance-ELIGIBLE (autoAdvanceEligibility) — a composition the engine can
// actually advance (handleChoiceActivation fires on a single visible click).
// For a legacy/ineligible auto_advance section (2+ producers, an input-only
// answer, multi-select, a conditional sole producer) suppressing the Continue
// would STRAND the visitor (PC-A1); instead we force the single end-of-subtree
// Continue slot (a default "Continue" when the section authored no continue
// node, else its captured ContinueButton) so the stored content un-sticks at
// RENDER time — no migration — while the engine's own guard (exactly ONE visible
// interactive) already declines to auto-advance it, so the two halves agree. A
// NEW save of such a section is blocked upstream (auto_advance_conflict), so
// this fallback only ever fires for pre-existing rows.
function planContinueRender(
  continueMode: LeadgenContinueMode | undefined,
  nodes: readonly LeadgenComponentNode[],
): ContinueRenderPlan {
  if (continueMode !== "auto_advance") return { suppressContinue: false, forceSlot: false };
  return autoAdvanceEligibility(nodes).eligible
    ? { suppressContinue: true, forceSlot: false }
    : { suppressContinue: false, forceSlot: true };
}

export function renderSectionComponents(
  nodes: readonly LeadgenComponentNode[],
  design: DefaultFunnelDesign,
  sectionCtx?: LeadgenSectionRenderCtx,
  depth = 1,
): string {
  const plan = planContinueRender(sectionCtx?.continue_mode, nodes);
  const suppressContinue = plan.suppressContinue;
  const state: SectionRenderState = {
    ctx: sectionCtx,
    suppressContinue,
    deferContinue:
      !suppressContinue && (sectionCtx?.continue_placement === "below_unit" || plan.forceSlot),
    continueSeen: false,
    deferredContinue: undefined,
    errorBoundFields: collectErrorBoundFields(nodes),
  };
  let out = renderNodes(nodes, design, depth, state);
  // R7 U12 FIX 3b (conductor ruling, 2026-07-15): the golden's white question
  // card (golden :308) is the SECTION's own composition, not frame furniture —
  // it wraps the top-level (depth===1) unit ONLY, in the ONE SHARED renderer,
  // so the studio canvas, the /sections/preview re-render, and the live
  // funnel (framed or frameless) all get it identically ("§12 parity by
  // construction"). The below_unit Continue slot (below) stays OUTSIDE the
  // card by name/design — "below_unit" is below the unit's own card, in the
  // frame-styled slot, not part of the question's own box.
  if (depth === 1) {
    out = renderQuestionCard(out);
  }
  // 11 §11.5 below_unit: emit the ONE end-of-subtree control (top-level call
  // only) — the Section's first ContinueButton provides props when present,
  // else the theme-default copy renders (a below_unit Section always shows
  // exactly one control unless it is auto_advance).
  if (depth === 1 && state.deferContinue) {
    out += renderContinueSlot(state.deferredContinue, design, sectionCtx);
  }
  // R2 P1 §① (owner A.1 #4 / probe 4a): "" for every section that never opts a
  // question into the ✓ marker — see selectedMarkStyleBlock.
  return depth === 1 ? selectedMarkStyleBlock(nodes, design) + out : out;
}

// Dependency-filtered render (the admin preview's §12.3/§14.9 simulator): keep
// every container WRAPPER, render only the LEAF nodes whose question_id is in
// `visibleIds`. Leaf semantics mirror the pre-§8.5 preview filter exactly — a
// leaf renders iff it is an object carrying a string question_id that is in
// the visible set (so for flat content the output equals filtering the list
// first, byte for byte). Containers are layout chrome: they are not part of
// the dependency state and always keep their wrapper (an emptied container
// renders as an empty wrapper, exactly how the live runtime keeps the nested
// DOM and toggles [data-question-id] leaves in place).
//
// v2.5 Phase C (DEV-57): the OPTIONAL `sectionCtx` threads the §3.4/§11.5/§9.5
// context EXACTLY like renderSectionComponents — one per-call state (bound
// text, single-control dedupe, auto_advance suppression, below_unit deferral,
// Section design_overrides), threaded through the visible-leaf walk and the
// depth-1 end-of-subtree slot. LEGACY IDENTITY: a call WITHOUT sectionCtx
// creates NO state, so every no-ctx call renders byte-identically to the
// pre-thread output (the components-render/parity suites hold the pin).
export function renderSectionComponentsVisible(
  nodes: readonly LeadgenComponentNode[],
  design: DefaultFunnelDesign,
  visibleIds: ReadonlySet<string>,
  sectionCtx?: LeadgenSectionRenderCtx,
  depth = 1,
): string {
  let state: SectionRenderState | undefined;
  if (sectionCtx !== undefined) {
    // Mirror renderSectionComponents' per-call state construction 1:1.
    const plan = planContinueRender(sectionCtx.continue_mode, nodes);
    const suppressContinue = plan.suppressContinue;
    state = {
      ctx: sectionCtx,
      suppressContinue,
      deferContinue:
        !suppressContinue && (sectionCtx.continue_placement === "below_unit" || plan.forceSlot),
      continueSeen: false,
      deferredContinue: undefined,
      errorBoundFields: collectErrorBoundFields(nodes),
    };
  }
  let out = renderVisibleNodes(nodes, design, visibleIds, depth, state);
  // R7 U12 FIX 3b: the SAME unit-level question card as renderSectionComponents
  // (the admin dependency-preview simulator must show the identical default
  // composition the Build canvas and live funnel show — same discipline as
  // the below_unit slot two lines down).
  if (depth === 1) {
    out = renderQuestionCard(out);
  }
  // 11 §11.5 below_unit (top-level call only): the ONE end-of-subtree control
  // — the Section's first VISIBLE ContinueButton provides props when present,
  // else the theme-default copy renders (same rule as renderSectionComponents).
  if (depth === 1 && state !== undefined && state.deferContinue) {
    out += renderContinueSlot(state.deferredContinue, design, sectionCtx);
  }
  // Same demand-driven ✓ block as renderSectionComponents (§12 parity: the two
  // surfaces must never disagree on the marker's styling).
  return depth === 1 ? selectedMarkStyleBlock(nodes, design) + out : out;
}

// The visible-leaf walk renderSectionComponentsVisible drives — extracted so
// the recursion threads the SAME per-call state object across every nesting
// level (never re-created per container). With `state === undefined` this is
// byte-for-byte the pre-v2.5-C walk.
function renderVisibleNodes(
  nodes: readonly LeadgenComponentNode[],
  design: DefaultFunnelDesign,
  visibleIds: ReadonlySet<string>,
  depth: number,
  state: SectionRenderState | undefined,
): string {
  if (depth > LEADGEN_MAX_CONTAINER_DEPTH + 1) return "";
  // P3a: route the visible-leaf walk through the SAME renderPlacedSiblings the
  // live render uses — a row of visible members groups identically in the
  // dependency preview; a member hidden by a conditional renders "" and drops
  // out of its row. With NO placement this is byte-for-byte the pre-P3a loop
  // (renderPlacedSiblings' fast path === map(renderOne).join("")).
  const renderOne = (node: LeadgenComponentNode): string => {
    if (typeof node !== "object" || node === null) return "";
    // R2 P1 §① the QUESTION grid: a real component (unlike a §8.5 layout
    // container it IS projected into /lg/config), but for THIS walk it behaves
    // like one — flattenComponents never yields the container itself, so its
    // question_id is not in `visibleIds` and the leaf test below would delete
    // the whole group. Keep the wrapper, filter the CHILDREN: a
    // dependency-hidden question's labeled block drops out entirely (label
    // WITH control — the same "it doesn't exist" semantics the live runtime
    // gets by hiding `.lg-qgrid-q`), the visible ones keep their blocks.
    if (isQuestionGridType(node.type)) {
      if (depth > LEADGEN_MAX_CONTAINER_DEPTH) return ""; // defensive (validator is the gate)
      const inner = renderPlacedSiblings(containerChildren(node), state?.ctx, (child) =>
        typeof child === "object" &&
        child !== null &&
        typeof child.question_id === "string" &&
        visibleIds.has(child.question_id)
          ? wrapGridQuestion(child, renderComponent(child, design, depth + 1, state))
          : "",
      );
      return renderContainerWrapper(node, design, depth, inner);
    }
    if (isLayoutContainerType(node.type)) {
      if (depth > LEADGEN_MAX_CONTAINER_DEPTH) return ""; // defensive (validator is the gate)
      const inner = renderVisibleNodes(containerChildren(node), design, visibleIds, depth + 1, state);
      // Re-render the container wrapper with the FILTERED children: emit the
      // container via its own preset around the filtered inner markup by
      // rendering a children-less clone and splicing the inner HTML into the
      // wrapper. The wrapper close tag is always the last `</…>` emitted by
      // the container preset, and every container preset nests children as
      // the LAST element before its closing tag(s), so the splice point is
      // the recursion output of the empty clone. (Wrapper markup never reads
      // the render state — state feeds only the children walk above.)
      return renderContainerWrapper(node, design, depth, inner);
    }
    if (typeof node.question_id === "string" && visibleIds.has(node.question_id)) {
      // CONDUCTOR FIX (P4b regression): same as renderNodes above — the slot
      // is now INSIDE renderComponent's own return, no external append.
      return renderComponent(node, design, depth, state);
    }
    return "";
  };
  return renderPlacedSiblings(nodes, state?.ctx, renderOne);
}

// Render a container node's WRAPPER with pre-rendered inner HTML. Implemented
// by rendering the container with an empty children list (yields exactly the
// wrapper markup) and inserting `inner` at the recursion point — which for
// every container preset is immediately before the final closing tag(s):
// Stack/GridContainer/Columns/CardPanel close with `</div>`;
// BackgroundPanel nests children inside `<div class="lg-bg-panel-inner">…`
// closing with `</div></div>`.
function renderContainerWrapper(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  depth: number,
  inner: string,
): string {
  const empty = renderComponent({ ...node, children: [] }, design, depth);
  if (empty === "") return "";
  const closer = node.type === "BackgroundPanel" ? "</div></div>" : "</div>";
  if (!empty.endsWith(closer)) return empty; // defensive: unexpected shape
  return empty.slice(0, empty.length - closer.length) + inner + closer;
}

export type { ComponentType };
