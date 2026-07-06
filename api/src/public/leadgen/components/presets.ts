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
// Every interpolated author value is escaped (editor/sanitize.escapeHtml).
// Author content NEVER flows into a `style` attribute — only token values do.
// Hit targets are ≥44px on mobile (§13.1) via the min-height tokens.

import { escapeHtml } from "../../../editor/sanitize";
import { COMPONENT_CATALOG } from "./registry";
import type { ComponentType } from "./registry";
import type { DefaultFunnelDesign } from "../designs/default-funnel/tokens";
import type {
  LeadgenChoice,
  LeadgenComponentNode,
  LeadgenDesignOverrides,
} from "./content-schema";

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
function style(pairs: Record<string, string | undefined>): string {
  const body = Object.entries(pairs)
    .filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== "")
    .map(([k, v]) => `${k}:${v}`)
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
// style; the rest (columns, mobileBehavior) are consumed structurally.
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
    (node.required === true ? ` data-required="true"` : "")
  );
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
    `<div class="lg-progress"${hydration(node)} data-mode="${mode}"` +
    ` role="progressbar" aria-valuemin="0" aria-valuemax="${ariaMax}" aria-valuenow="${ariaNow}"` +
    (label !== undefined ? ` aria-valuetext="${esc(label)}"` : "") +
    `>` +
    `<div class="lg-progress-track">` +
    `<div class="lg-progress-fill"${style({ width, background: design.progress.fillColor })}></div>` +
    `</div>` +
    (label !== undefined ? `<div class="lg-progress-text">${esc(label)}</div>` : "") +
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
    `<button type="button" class="lg-back"${hydration(node)}${style({ color: design.backButton.color })} aria-label="${esc(label)}">` +
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

// ---------------------------------------------------------------------------
// affordances (copy)
// ---------------------------------------------------------------------------

export function renderCategoryLabel(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const color = ov(node, "featureColor") ?? design.categoryLabel.color;
  return (
    `<div class="lg-category"${hydration(node)}${style({ color, "letter-spacing": design.categoryLabel.letterSpacing })}>` +
    `${esc(propStr(node, "text"))}</div>`
  );
}

export function renderQuestionHeadline(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  return (
    `<h1 class="lg-headline"${hydration(node)}` +
    style({ "font-family": design.headline.fontFamily, color: design.headline.color }) +
    `>${esc(propStr(node, "text"))}</h1>`
  );
}

export function renderSubheadline(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  return (
    `<p class="lg-subheadline"${hydration(node)}${style({ color: design.subheadline.color })}>` +
    `${esc(propStr(node, "text"))}</p>`
  );
}

// ---------------------------------------------------------------------------
// range family (§14.5)
// ---------------------------------------------------------------------------

function formatRangeValue(n: number, format: string | undefined, currency: string): string {
  if (format === "currency") return `${currency}${n.toLocaleString("en-US")}`;
  return n.toLocaleString("en-US");
}

function renderRange(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  format: "number" | "currency",
): string {
  const rq = design.rangeQuestion;
  const min = propNum(node, "min") ?? 0;
  const max = propNum(node, "max") ?? 100;
  const step = propNum(node, "step") ?? 1;
  const value = propNum(node, "default") ?? min;
  const span = max - min;
  const pct = span > 0 ? clampInt(((value - min) / span) * 100, 0, 100) : 0;
  const currency = propStr(node, "currency") ?? "$";
  const filled = ov(node, "rangeColor") ?? rq.filledTrackColor;
  const displayValue = formatRangeValue(value, format, currency);
  const minLabel = propStr(node, "minLabel") ?? formatRangeValue(min, format, currency);
  const maxLabel = propStr(node, "maxLabel") ?? formatRangeValue(max, format, currency);
  return (
    `<div class="lg-range"${hydration(node)} data-format="${format}">` +
    `<div class="lg-range-value"${style({ color: rq.valueColor, "font-family": rq.valueFontFamily })}>${esc(displayValue)}</div>` +
    `<div class="lg-range-track"${style({ "background-color": rq.unfilledTrackColor })}>` +
    `<div class="lg-range-fill"${style({ width: `${pct}%`, "background-color": filled })}></div>` +
    `</div>` +
    `<input class="lg-range-input" type="range" role="slider"` +
    ` min="${min}" max="${max}" step="${step}" value="${value}"` +
    ` aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${value}"` +
    attr("aria-label", propStr(node, "ariaLabel") ?? node.internal_field) +
    attr("data-internal-field", node.internal_field) +
    `>` +
    `<div class="lg-range-minmax"><span>${esc(minLabel)}</span><span>${esc(maxLabel)}</span></div>` +
    `</div>`
  );
}

export function renderRangeQuestion(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  return renderRange(node, design, propStr(node, "format") === "currency" ? "currency" : "number");
}
export function renderCurrencyRangeQuestion(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  return renderRange(node, design, "currency");
}
export function renderNumberRangeQuestion(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  return renderRange(node, design, "number");
}

// ---------------------------------------------------------------------------
// choice questions
// ---------------------------------------------------------------------------

function choiceList(node: LeadgenComponentNode): LeadgenChoice[] {
  return Array.isArray(node.choices) ? node.choices : [];
}

// Answer buttons are a "pick-one" affordance (like the icon card), NOT the navy
// primary. Their base white/2px-border chrome + §14.6 hover/selected/focus state
// rules live in the scoped chrome CSS (.lg-btn.lg-btn-answer, styles.ts) — never
// inline — so the "selected animation" state wins by cascade (no !important; the
// compound .lg-btn.lg-btn-answer outranks the .lg-btn primary base/hover). Only
// class + role/aria + hydration data attrs are emitted here (no per-instance
// style at all), so `design` is unused (kept for the uniform dispatcher shape).
export function renderButtonAnswerGroup(node: LeadgenComponentNode, _design: DefaultFunnelDesign): string {
  const autoAdvance = propBool(node, "auto_advance");
  const buttons = choiceList(node)
    .map(
      (c) =>
        `<button type="button" class="lg-btn lg-btn-answer" role="radio" aria-checked="false"` +
        attr("data-value", c.value) +
        attr("data-analytics-id", c.analytics_id) +
        `>${esc(c.label)}</button>`,
    )
    .join("");
  return (
    `<div class="lg-answer-group" role="radiogroup"${hydration(node)} data-auto-advance="${autoAdvance ? "true" : "false"}">` +
    buttons +
    `</div>`
  );
}

export function renderTwoButtonYesNo(node: LeadgenComponentNode, _design: DefaultFunnelDesign): string {
  const yes = propStr(node, "yesLabel") ?? "Yes";
  const no = propStr(node, "noLabel") ?? "No";
  const autoAdvance = propBool(node, "auto_advance");
  // Same discipline as renderButtonAnswerGroup: base + state chrome is fully
  // class-driven (.lg-btn.lg-btn-answer) so the §14.6 selected/hover states apply;
  // no inline background/color/border to defeat them.
  const btn = (label: string, value: boolean): string =>
    `<button type="button" class="lg-btn lg-btn-answer" role="radio" aria-checked="false"` +
    ` data-value="${value ? "true" : "false"}">${esc(label)}</button>`;
  return (
    `<div class="lg-answer-group lg-yesno" role="radiogroup"${hydration(node)} data-auto-advance="${autoAdvance ? "true" : "false"}">` +
    btn(yes, true) +
    btn(no, false) +
    `</div>`
  );
}

function renderCardGrid(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  kind: "icon" | "image",
): string {
  const cols = clampInt(
    ovNum(node, "columns") ?? propNum(node, "columns") ?? design.iconCardGrid.columnsDesktop,
    2,
    5,
  );
  const gap = ov(node, "gridGap") ?? design.iconCardGrid.gap;
  const iconColor = ov(node, "iconColor") ?? design.iconCard.iconColor;
  const cards = choiceList(node)
    .map((c) => {
      const media =
        kind === "image"
          ? `<img class="lg-card-img" src="${esc(c.imageMediaId)}" alt="${esc(c.label)}" loading="lazy">`
          : `<span class="lg-card-icon"${style({ color: iconColor })} aria-hidden="true">${esc(c.icon)}</span>`;
      const desc =
        c.description !== undefined && c.description !== ""
          ? `<span class="lg-card-desc">${esc(c.description)}</span>`
          : "";
      // Base border/background live in the scoped chrome CSS (.lg-card) — NOT
      // inline — so the §14.4 selected/hover/focus/error state rules win by
      // cascade (no !important). Only class + hydration attrs are emitted here.
      return (
        `<button type="button" class="lg-card" role="radio" aria-checked="false"` +
        attr("data-value", c.value) +
        attr("data-analytics-id", c.analytics_id) +
        `>${media}<span class="lg-card-title">${esc(c.label)}</span>${desc}</button>`
      );
    })
    .join("");
  return (
    `<div class="lg-card-grid" role="radiogroup"${hydration(node)}` +
    style({ "--lg-cols": String(cols), gap }) +
    `>${cards}</div>`
  );
}

export function renderIconCardAnswerGrid(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  return renderCardGrid(node, design, "icon");
}
export function renderImageCardAnswerGrid(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  return renderCardGrid(node, design, "image");
}

export function renderMultiChoiceCardGroup(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const min = propNum(node, "min");
  const max = propNum(node, "max");
  const cards = choiceList(node)
    .map(
      (c) =>
        // Base border/background live in the scoped chrome CSS (.lg-card) — not
        // inline — so the §14.4 selected/hover/focus state rules apply.
        `<button type="button" class="lg-card lg-card-multi" role="checkbox" aria-checked="false"` +
        attr("data-value", c.value) +
        attr("data-analytics-id", c.analytics_id) +
        `><span class="lg-card-title">${esc(c.label)}</span></button>`,
    )
    .join("");
  return (
    `<div class="lg-card-grid lg-multi" role="group"${hydration(node)}` +
    style({ "--lg-cols": "2", gap: design.iconCardGrid.gap }) +
    attr("data-min", min) +
    attr("data-max", max) +
    `>${cards}</div>`
  );
}

export function renderDropdownQuestion(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const placeholder = propStr(node, "placeholder") ?? "Select…";
  const options = choiceList(node)
    .map((c) => `<option value="${esc(c.value)}"${attr("data-analytics-id", c.analytics_id)}>${esc(c.label)}</option>`)
    .join("");
  // Base border lives in the scoped chrome CSS (.lg-input) — not inline — so
  // the :focus / [aria-invalid] state rules win by cascade (no !important).
  return (
    `<select class="lg-input lg-dropdown"${hydration(node)}` +
    `>` +
    `<option value="" disabled selected>${esc(placeholder)}</option>` +
    options +
    `</select>`
  );
}

// ---------------------------------------------------------------------------
// free-form + PII inputs
// ---------------------------------------------------------------------------

function renderTextInput(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  type: string,
  extra: string,
): string {
  const placeholder = propStr(node, "placeholder");
  const maxLen = propNum(node, "maxLen");
  // Base border lives in the scoped chrome CSS (.lg-input) — not inline — so
  // the :focus / [aria-invalid] state rules win by cascade (no !important).
  return (
    `<input class="lg-input" type="${type}"${hydration(node)}` +
    attr("placeholder", placeholder) +
    attr("maxlength", maxLen) +
    (node.required === true ? " required" : "") +
    extra +
    `>`
  );
}

export function renderFreeTextQuestion(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  return renderTextInput(node, design, "text", "");
}
export function renderEmailInputQuestion(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  return renderTextInput(node, design, "email", ` inputmode="email" autocomplete="email"`);
}
export function renderPhoneInputQuestion(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  return renderTextInput(node, design, "tel", ` inputmode="tel" autocomplete="tel"`);
}
export function renderDateQuestion(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const min = propStr(node, "min");
  const max = propStr(node, "max");
  return renderTextInput(node, design, "date", attr("min", min) + attr("max", max));
}
export function renderZIPInputQuestion(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const googleValidate = propBool(node, "validate");
  return renderTextInput(
    node,
    design,
    "text",
    ` inputmode="numeric" pattern="\\d{5}" maxlength="5"` +
      (googleValidate ? ` data-validate="google"` : ""),
  );
}

export function renderNameFieldsGroup(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const first = propStr(node, "firstLabel") ?? "First name";
  const last = propStr(node, "lastLabel") ?? "Surname";
  // Base border lives in the scoped chrome CSS (.lg-input) — not inline — so
  // the :focus / [aria-invalid] state rules win by cascade (no !important).
  const field = (label: string, name: string, autocomplete: string): string =>
    `<label class="lg-field"><span class="lg-label">${esc(label)}</span>` +
    `<input class="lg-input" type="text"` +
    ` data-name-field="${name}" autocomplete="${autocomplete}"` +
    (node.required === true ? " required" : "") +
    `></label>`;
  return (
    `<div class="lg-name-group"${hydration(node)}>` +
    field(first, "first", "given-name") +
    field(last, "last", "family-name") +
    `</div>`
  );
}

export function renderAddressAutocompleteQuestion(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const provider = propStr(node, "provider") ?? "google";
  const placeholder = propStr(node, "placeholder") ?? "Start typing your address…";
  return (
    `<div class="lg-address"${hydration(node)} data-provider="${esc(provider)}">` +
    // Base border lives in the scoped chrome CSS (.lg-input) — not inline — so
    // the :focus / [aria-invalid] state rules win by cascade (no !important).
    `<input class="lg-input lg-address-input" type="text"` +
    ` autocomplete="street-address"${attr("placeholder", placeholder)}` +
    (node.required === true ? " required" : "") +
    ` data-address-autocomplete="true">` +
    // Distinct normalized sub-fields for payload mapping (§12.8).
    `<input type="hidden" data-address-part="street"><input type="hidden" data-address-part="city">` +
    `<input type="hidden" data-address-part="state"><input type="hidden" data-address-part="zip">` +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// controls
// ---------------------------------------------------------------------------

export function renderContinueButton(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const label = propStr(node, "label") ?? "Continue";
  const loadingLabel = propStr(node, "loadingLabel") ?? label;
  // §14.6: navy primary (NOT blue), full-width pill. The base navy background
  // lives in the scoped chrome CSS (.lg-btn) so the :hover/:active/disabled
  // state rules win by cascade (no !important). A curated §14.8 buttonBackground
  // override rides the --lg-btn-bg custom property (the .lg-continue chrome rule
  // reads it) — NOT an inline background that would defeat :hover. buttonText
  // has no state variant, so it stays a per-instance inline value.
  const bgOverride = ov(node, "buttonBackground");
  const fg = ov(node, "buttonText") ?? design.primaryButton.color;
  return (
    `<button type="submit" class="lg-btn lg-continue"${hydration(node)}` +
    style({ "--lg-btn-bg": bgOverride, color: fg }) +
    attr("data-loading-label", loadingLabel) +
    ` data-loading="false">` +
    `<span class="lg-btn-spinner" aria-hidden="true"></span>` +
    `<span class="lg-btn-label">${esc(label)}</span>` +
    `</button>`
  );
}

export function renderAutoAdvanceButton(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const label = propStr(node, "label") ?? "Continue";
  // Same discipline as renderContinueButton: the navy base lives in the chrome
  // CSS (.lg-btn) so :hover applies; the §14.8 buttonBackground override rides
  // the --lg-btn-bg custom property (read by the .lg-auto-advance chrome rule).
  const bgOverride = ov(node, "buttonBackground");
  const fg = ov(node, "buttonText") ?? design.primaryButton.color;
  return (
    `<button type="button" class="lg-btn lg-auto-advance"${hydration(node)}` +
    style({ "--lg-btn-bg": bgOverride, color: fg }) +
    ` data-auto-advance="true">${esc(label)}</button>`
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

export function renderHelperText(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  return (
    `<p class="lg-helper"${hydration(node)}${style({ color: design.validation.helperColor })}>` +
    `${esc(propStr(node, "text"))}</p>`
  );
}

export function renderValidationError(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const text = propStr(node, "text");
  return (
    `<p class="lg-error" role="alert" aria-live="polite"${hydration(node)}` +
    style({ color: design.validation.errorTextColor }) +
    `>${esc(text)}</p>`
  );
}

export function renderLegalNote(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  // html is author rich text → escaped (the runtime renders it into the note).
  return (
    `<div class="lg-legal"${hydration(node)}${style({ color: design.validation.helperColor })}>` +
    `${esc(propStr(node, "html"))}</div>`
  );
}

// ---------------------------------------------------------------------------
// dispatcher
// ---------------------------------------------------------------------------

// Map a component node → its preset markup under the active design. The switch
// is exhaustive over ComponentType (a new catalog type without a preset fails
// typecheck at the `never` guard); unknown types are unreachable given
// validateSectionContent, but are handled defensively with an empty render.
export function renderComponent(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  switch (node.type) {
    case "ProgressBar":
      return renderProgressBar(node, design);
    case "HeaderLogo":
      return renderHeaderLogo(node, design);
    case "BackButton":
      return renderBackButton(node, design);
    case "DisclosureLink":
      return renderDisclosureLink(node, design);
    case "CategoryLabel":
      return renderCategoryLabel(node, design);
    case "QuestionHeadline":
      return renderQuestionHeadline(node, design);
    case "Subheadline":
      return renderSubheadline(node, design);
    case "RangeQuestion":
      return renderRangeQuestion(node, design);
    case "CurrencyRangeQuestion":
      return renderCurrencyRangeQuestion(node, design);
    case "NumberRangeQuestion":
      return renderNumberRangeQuestion(node, design);
    case "ButtonAnswerGroup":
      return renderButtonAnswerGroup(node, design);
    case "IconCardAnswerGrid":
      return renderIconCardAnswerGrid(node, design);
    case "ImageCardAnswerGrid":
      return renderImageCardAnswerGrid(node, design);
    case "TwoButtonYesNo":
      return renderTwoButtonYesNo(node, design);
    case "MultiChoiceCardGroup":
      return renderMultiChoiceCardGroup(node, design);
    case "DropdownQuestion":
      return renderDropdownQuestion(node, design);
    case "FreeTextQuestion":
      return renderFreeTextQuestion(node, design);
    case "EmailInputQuestion":
      return renderEmailInputQuestion(node, design);
    case "PhoneInputQuestion":
      return renderPhoneInputQuestion(node, design);
    case "AddressAutocompleteQuestion":
      return renderAddressAutocompleteQuestion(node, design);
    case "ZIPInputQuestion":
      return renderZIPInputQuestion(node, design);
    case "NameFieldsGroup":
      return renderNameFieldsGroup(node, design);
    case "DateQuestion":
      return renderDateQuestion(node, design);
    case "ContinueButton":
      return renderContinueButton(node, design);
    case "AutoAdvanceButton":
      return renderAutoAdvanceButton(node, design);
    case "ReassuranceBadge":
      return renderReassuranceBadge(node, design);
    case "HelperText":
      return renderHelperText(node, design);
    case "ValidationError":
      return renderValidationError(node, design);
    case "LegalNote":
      return renderLegalNote(node, design);
    default: {
      // Exhaustiveness guard + defensive empty render for a corrupt node.
      const _exhaustive: never = node.type;
      void _exhaustive;
      return "";
    }
  }
}

// Ordered render of a full Section: each component's preset markup, in order.
export function renderSectionComponents(
  nodes: readonly LeadgenComponentNode[],
  design: DefaultFunnelDesign,
): string {
  return nodes.map((n) => renderComponent(n, design)).join("");
}

export type { ComponentType };
