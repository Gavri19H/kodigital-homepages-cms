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
//   data-lg-other-trigger / data-lg-other-panel  B9 Other-group markup
// The B9 Other grouping (06 §6.4) renders when a choice node carries
// `choiceDisplay.otherGroupEnabled`: main values as normal choices + ONE
// "Other" trigger (NOT a choice — it never stores a value) + a hidden panel of
// the secondary REAL-value choices (searchable per `searchableOther`). A
// secondary selection stores the REAL internal value — the literal string
// "Other" is never a stored value. Without choiceDisplay metadata the markup
// is byte-identical to the pre-v2.4 render (attributes only, no visual change
// under the default design).
//
// Every interpolated author value is escaped (editor/sanitize.escapeHtml).
// Author content NEVER flows into a `style` attribute — only token values do.
// Hit targets are ≥44px on mobile (§13.1) via the min-height tokens.

import { escapeHtml } from "../../../editor/sanitize";
import { COMPONENT_CATALOG } from "./registry";
import type { ComponentType } from "./registry";
import type { DefaultFunnelDesign } from "../designs/default-funnel/tokens";
import { isLayoutContainerType, LEADGEN_MAX_CONTAINER_DEPTH } from "./content-schema";
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
      ? ""
      : attr("data-lg-question", node.question_id) + attr("data-lg-field", node.internal_field)) +
    (node.required === true ? ` data-required="true"` : "")
  );
}

// ---------------------------------------------------------------------------
// B9 choiceDisplay (06 §6.4) — Other-group metadata on choice nodes
// ---------------------------------------------------------------------------

// The §6.4 choiceDisplay metadata shape. content-schema.ts gains the typed
// node field in the Phase-2 authoring leg; until then the runtime render leg
// reads it DEFENSIVELY off the raw node (content_json accepts the extra key
// today — validateSectionContent does not reject unknown node-level keys).
export interface LeadgenChoiceDisplay {
  mainValues: string[];
  otherGroupEnabled: boolean;
  otherGroupLabel: string;
  searchableOther: boolean;
}

// Defensive, normalizing extractor — the SINGLE reader both the renderer and
// the public config DTO (config-dto.ts) share, so runtime markup and
// /lg/config metadata can never disagree on what the node's choiceDisplay
// means. Returns undefined unless the node carries an object-shaped
// choiceDisplay; unknown keys are dropped (explicit projection).
export function readChoiceDisplay(node: LeadgenComponentNode): LeadgenChoiceDisplay | undefined {
  const raw = (node as { choiceDisplay?: unknown }).choiceDisplay;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const mainValues = Array.isArray(r["mainValues"])
    ? (r["mainValues"] as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  const label = r["otherGroupLabel"];
  return {
    mainValues,
    otherGroupEnabled: r["otherGroupEnabled"] === true,
    otherGroupLabel: typeof label === "string" && label.trim() !== "" ? label : "Other",
    searchableOther: r["searchableOther"] === true,
  };
}

// Split a node's choices into main + secondary (Other-panel) per §6.4:
// membership by String(choice.value) ∈ mainValues. Only meaningful when
// otherGroupEnabled — callers gate on that.
function splitChoicesForOtherGroup(
  choices: LeadgenChoice[],
  display: LeadgenChoiceDisplay,
): { main: LeadgenChoice[]; secondary: LeadgenChoice[] } {
  const mainSet = new Set(display.mainValues);
  const main: LeadgenChoice[] = [];
  const secondary: LeadgenChoice[] = [];
  for (const c of choices) {
    (mainSet.has(String(c.value)) ? main : secondary).push(c);
  }
  return { main, secondary };
}

// The shared §6.4 Other-group tail: ONE trigger (deliberately NO data-lg-choice
// / data-value — selecting "Other" itself never stores a value) + the hidden
// panel of secondary REAL-value choices (each rendered by the caller's own
// choice affordance so the family look is preserved), searchable when
// `searchableOther`. The runtime (runtime/render.ts, another slice) expands
// the panel; the literal "Other" is never a stored value (§6.4 RED LINE).
function renderOtherGroupTail(
  display: LeadgenChoiceDisplay,
  triggerClass: string,
  triggerInner: string,
  secondaryHtml: string,
): string {
  const search = display.searchableOther
    ? `<input class="lg-input lg-other-search" type="text" data-lg-other-search` +
      ` placeholder="Search…" aria-label="${esc(display.otherGroupLabel)} — search options">`
    : "";
  return (
    `<button type="button" class="${triggerClass}" data-lg-other-trigger` +
    ` aria-expanded="false" aria-haspopup="true">${triggerInner}</button>` +
    `<div class="lg-other-panel" data-lg-other-panel hidden>` +
    search +
    `<div class="lg-other-list">${secondaryHtml}</div>` +
    `</div>`
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
  const btn = (c: LeadgenChoice): string =>
    `<button type="button" class="lg-btn lg-btn-answer" role="radio" aria-checked="false"` +
    attr("data-value", c.value) +
    // 03 §3.3: data-lg-choice mirrors the choice's REAL stored value.
    attr("data-lg-choice", c.value) +
    attr("data-analytics-id", c.analytics_id) +
    `>${esc(c.label)}</button>`;
  const display = readChoiceDisplay(node);
  let body: string;
  if (display !== undefined && display.otherGroupEnabled) {
    // B9 (06 §6.4): main values as normal answer buttons + one Other trigger +
    // the hidden panel of secondary REAL-value buttons.
    const { main, secondary } = splitChoicesForOtherGroup(choiceList(node), display);
    body =
      main.map(btn).join("") +
      renderOtherGroupTail(
        display,
        "lg-btn lg-btn-answer lg-other-trigger",
        esc(display.otherGroupLabel),
        secondary.map(btn).join(""),
      );
  } else {
    body = choiceList(node).map(btn).join("");
  }
  return (
    `<div class="lg-answer-group" role="radiogroup"${hydration(node)} data-auto-advance="${autoAdvance ? "true" : "false"}">` +
    body +
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
    // 03 §3.3: data-lg-choice mirrors data-value (the stored boolean).
    ` data-value="${value ? "true" : "false"}" data-lg-choice="${value ? "true" : "false"}">${esc(label)}</button>`;
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
  const card = (c: LeadgenChoice): string => {
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
      // 03 §3.3: data-lg-choice mirrors the choice's REAL stored value.
      attr("data-lg-choice", c.value) +
      attr("data-analytics-id", c.analytics_id) +
      `>${media}<span class="lg-card-title">${esc(c.label)}</span>${desc}</button>`
    );
  };
  const display = readChoiceDisplay(node);
  let cards: string;
  if (display !== undefined && display.otherGroupEnabled) {
    // B9 (06 §6.4): main cards + one Other trigger card + the hidden panel of
    // secondary REAL-value cards.
    const { main, secondary } = splitChoicesForOtherGroup(choiceList(node), display);
    cards =
      main.map(card).join("") +
      renderOtherGroupTail(
        display,
        "lg-card lg-other-trigger",
        `<span class="lg-card-title">${esc(display.otherGroupLabel)}</span>`,
        secondary.map(card).join(""),
      );
  } else {
    cards = choiceList(node).map(card).join("");
  }
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
  const card = (c: LeadgenChoice): string =>
    // Base border/background live in the scoped chrome CSS (.lg-card) — not
    // inline — so the §14.4 selected/hover/focus state rules apply.
    `<button type="button" class="lg-card lg-card-multi" role="checkbox" aria-checked="false"` +
    attr("data-value", c.value) +
    // 03 §3.3: data-lg-choice mirrors the choice's REAL stored value.
    attr("data-lg-choice", c.value) +
    attr("data-analytics-id", c.analytics_id) +
    `><span class="lg-card-title">${esc(c.label)}</span></button>`;
  const display = readChoiceDisplay(node);
  let cards: string;
  if (display !== undefined && display.otherGroupEnabled) {
    // B9 (06 §6.4): main cards + one Other trigger + hidden secondary panel.
    const { main, secondary } = splitChoicesForOtherGroup(choiceList(node), display);
    cards =
      main.map(card).join("") +
      renderOtherGroupTail(
        display,
        "lg-card lg-card-multi lg-other-trigger",
        `<span class="lg-card-title">${esc(display.otherGroupLabel)}</span>`,
        secondary.map(card).join(""),
      );
  } else {
    cards = choiceList(node).map(card).join("");
  }
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
  // 03 §3.3: each <option> is a selectable choice → data-lg-choice. A dropdown
  // with B9 choiceDisplay renders ALL values flat (main + secondary as plain
  // options — real values only, so the §6.4 "never literal Other" invariant
  // holds trivially); the panel-style Other UX for dropdowns arrives with the
  // Phase-2 SearchableDropdownQuestion/OtherGroupSelector presets (08 §8.4).
  const options = choiceList(node)
    .map(
      (c) =>
        `<option value="${esc(c.value)}"${attr("data-lg-choice", c.value)}${attr("data-analytics-id", c.analytics_id)}>${esc(c.label)}</option>`,
    )
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

// 08 §8.3/§8.10 SearchableDropdownQuestion: DropdownQuestion + a search input
// above the option list. HYDRATION ATTRS ONLY — the runtime filters the
// options client-side (data-lg-searchable / data-lg-dropdown-search hooks); no
// client render here. The options are a REAL <select> in the exact
// DropdownQuestion option shape (data-lg-choice + data-analytics-id per
// option) so answer semantics are identical. Base chrome is fully class-driven
// (.lg-input / .lg-dropdown) — no inline style.
export function renderSearchableDropdownQuestion(node: LeadgenComponentNode, _design: DefaultFunnelDesign): string {
  const placeholder = propStr(node, "placeholder") ?? "Select…";
  const options = choiceList(node)
    .map(
      (c) =>
        `<option value="${esc(c.value)}"${attr("data-lg-choice", c.value)}${attr("data-analytics-id", c.analytics_id)}>${esc(c.label)}</option>`,
    )
    .join("");
  return (
    `<div class="lg-searchable-dropdown"${hydration(node)} data-lg-searchable>` +
    `<input class="lg-input lg-dropdown-search" type="text" data-lg-dropdown-search` +
    ` placeholder="Search…" aria-label="Search options">` +
    `<select class="lg-input lg-dropdown">` +
    `<option value="" disabled selected>${esc(placeholder)}</option>` +
    options +
    `</select>` +
    `</div>`
  );
}

// 08 §8.3 OtherGroupSelector — the DEDICATED B9 (06 §6.4) renderer: main
// choices as answer buttons + the shared Other tail (trigger + hidden panel of
// secondary REAL-value choices), driven by the node's choiceDisplay through
// the SAME readChoiceDisplay/splitChoicesForOtherGroup/renderOtherGroupTail
// helpers ButtonAnswerGroup uses. Without grouping metadata (or with
// otherGroupEnabled:false) it renders all choices flat — defensive, and the
// §6.4 "literal 'Other' is never a stored value" invariant holds throughout.
// Base + state chrome is fully class-driven (.lg-btn.lg-btn-answer) — no
// inline style (the renderButtonAnswerGroup discipline).
export function renderOtherGroupSelector(node: LeadgenComponentNode, _design: DefaultFunnelDesign): string {
  const btn = (c: LeadgenChoice): string =>
    `<button type="button" class="lg-btn lg-btn-answer" role="radio" aria-checked="false"` +
    attr("data-value", c.value) +
    attr("data-lg-choice", c.value) +
    attr("data-analytics-id", c.analytics_id) +
    `>${esc(c.label)}</button>`;
  const display = readChoiceDisplay(node);
  let body: string;
  if (display !== undefined && display.otherGroupEnabled) {
    const { main, secondary } = splitChoicesForOtherGroup(choiceList(node), display);
    body =
      main.map(btn).join("") +
      renderOtherGroupTail(
        display,
        "lg-btn lg-btn-answer lg-other-trigger",
        esc(display.otherGroupLabel),
        secondary.map(btn).join(""),
      );
  } else {
    body = choiceList(node).map(btn).join("");
  }
  return (
    `<div class="lg-answer-group lg-other-group" role="radiogroup"${hydration(node)}>` +
    body +
    `</div>`
  );
}

// ---------------------------------------------------------------------------
// free-form + PII inputs
// ---------------------------------------------------------------------------

// The §8.8 field-level Maps config → the 03 §3.3 `data-lg-maps` attribute
// value. `props.maps` (an object) serializes VERBATIM when present (field-level
// config wins); the compat fallback for pre-§8.8 content — where Maps-enablement
// rode the component itself (any AddressAutocompleteQuestion; a ZIP with
// props.validate=true, i.e. the global address_validation_enabled era) — is the
// empty config "{}" (runtime defaults). Callers gate on WHETHER the component
// is Maps-enabled; this only shapes the value.
function mapsConfigJson(node: LeadgenComponentNode): string {
  const raw = node.props?.["maps"];
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    return JSON.stringify(raw);
  }
  return "{}";
}

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
  // 03 §3.3: data-lg-input marks every text/date/email/phone/zip input.
  return (
    `<input class="lg-input" type="${type}"${hydration(node)} data-lg-input` +
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
// 08 §8.3/§8.10 NumberInputQuestion: a PLAIN numeric text input (NOT a
// slider/range) — the renderTextInput discipline (class-driven .lg-input base
// so :focus/[aria-invalid] cascade) + inputmode numeric; min/max/step ride as
// data attributes for the runtime's client-side validation leg.
export function renderNumberInputQuestion(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  return renderTextInput(
    node,
    design,
    "text",
    ` inputmode="numeric"` +
      attr("data-min", propNum(node, "min")) +
      attr("data-max", propNum(node, "max")) +
      attr("data-step", propNum(node, "step")) +
      attr("aria-label", propStr(node, "ariaLabel") ?? node.internal_field),
  );
}
// 08 §8.10 CurrencyInputQuestion: currency-prefixed plain numeric input (NOT a
// Range variant). The prefix symbol (props.currency ?? "$") is a decorative
// aria-hidden span aligned by the scoped chrome CSS (.lg-currency-prefix /
// .lg-currency-input padding); the input itself follows the renderTextInput
// discipline (class-driven base, data-lg-input, inputmode numeric) — no
// inline style anywhere.
export function renderCurrencyInputQuestion(node: LeadgenComponentNode, _design: DefaultFunnelDesign): string {
  const currency = propStr(node, "currency") ?? "$";
  return (
    `<div class="lg-currency"${hydration(node)}>` +
    `<span class="lg-currency-prefix" aria-hidden="true">${esc(currency)}</span>` +
    `<input class="lg-input lg-currency-input" type="text" inputmode="numeric" data-lg-input` +
    attr("placeholder", propStr(node, "placeholder")) +
    attr("data-min", propNum(node, "min")) +
    attr("data-max", propNum(node, "max")) +
    attr("data-currency", currency) +
    attr("aria-label", propStr(node, "ariaLabel") ?? node.internal_field) +
    (node.required === true ? " required" : "") +
    `>` +
    `</div>`
  );
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
  // 03 §3.3 / 08 §8.8: a ZIP component is Maps-enabled when it carries a
  // field-level props.maps config OR the legacy per-node validate flag (the
  // global address_validation_enabled era) — then it emits data-lg-maps.
  const mapsEnabled =
    typeof node.props?.["maps"] === "object" && node.props?.["maps"] !== null
      ? true
      : googleValidate;
  return renderTextInput(
    node,
    design,
    "text",
    ` inputmode="numeric" pattern="\\d{5}" maxlength="5"` +
      (googleValidate ? ` data-validate="google"` : "") +
      (mapsEnabled ? attr("data-lg-maps", mapsConfigJson(node)) : ""),
  );
}

export function renderNameFieldsGroup(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  const first = propStr(node, "firstLabel") ?? "First name";
  const last = propStr(node, "lastLabel") ?? "Surname";
  // Base border lives in the scoped chrome CSS (.lg-input) — not inline — so
  // the :focus / [aria-invalid] state rules win by cascade (no !important).
  const field = (label: string, name: string, autocomplete: string): string =>
    `<label class="lg-field"><span class="lg-label">${esc(label)}</span>` +
    // 03 §3.3: both name text inputs carry data-lg-input.
    `<input class="lg-input" type="text" data-lg-input` +
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
    // 03 §3.3 / 08 §8.8: an address component is ALWAYS Maps-capable →
    // data-lg-maps carries the field-level props.maps config (or the "{}"
    // compat fallback for global-checkbox-era content). The KEY itself never
    // rides here — runtime/maps.ts no-ops gracefully when the shell injected
    // no window.__LG_MAPS_KEY__.
    `<div class="lg-address"${hydration(node)} data-provider="${esc(provider)}"${attr("data-lg-maps", mapsConfigJson(node))}>` +
    // Base border lives in the scoped chrome CSS (.lg-input) — not inline — so
    // the :focus / [aria-invalid] state rules win by cascade (no !important).
    `<input class="lg-input lg-address-input" type="text" data-lg-input` +
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
    // 03 §3.3: data-lg-continue is the engine's advance hook.
    `<button type="submit" class="lg-btn lg-continue"${hydration(node)} data-lg-continue` +
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
    // 03 §3.3: an AutoAdvanceButton is a manual advance control too → it
    // carries the same data-lg-continue hook (auto-advance sections advance on
    // answer_click; this button is the explicit fallback, §3.5 step 4).
    `<button type="button" class="lg-btn lg-auto-advance"${hydration(node)} data-lg-continue` +
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
function logoStripLogos(node: LeadgenComponentNode): Array<{ mediaId: string; alt: string }> {
  const raw = node.props?.["logos"];
  if (!Array.isArray(raw)) return [];
  const out: Array<{ mediaId: string; alt: string }> = [];
  for (const logo of raw) {
    if (typeof logo !== "object" || logo === null || Array.isArray(logo)) continue;
    const r = logo as Record<string, unknown>;
    const mediaId = typeof r["mediaId"] === "string" ? r["mediaId"] : "";
    if (mediaId === "") continue;
    out.push({ mediaId, alt: typeof r["alt"] === "string" ? r["alt"] : "" });
  }
  return out;
}

export function renderLogoStrip(node: LeadgenComponentNode, _design: DefaultFunnelDesign): string {
  const logos = logoStripLogos(node)
    .map(
      (logo) =>
        `<img class="lg-logo-strip-img" src="${esc(logo.mediaId)}" alt="${esc(logo.alt)}" loading="lazy">`,
    )
    .join("");
  return `<div class="lg-logo-strip"${hydration(node)}>${logos}</div>`;
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
    // 03 §3.3: data-lg-error-for names the internal_field this slot reports on
    // (when the author bound one — attr() omits the hook for a generic slot).
    `<p class="lg-error" role="alert" aria-live="polite"${hydration(node)}${attr("data-lg-error-for", node.internal_field)}` +
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
// §8.5 layout containers (fix-contract v2.4 08, E4) — SERVER-side rendering.
// The 5 children-bearing containers recurse via renderSectionComponents(
// node.children ?? [], design, depth + 1) inside their wrapper markup; the 3
// layout leaves (Spacer / HeaderBar / FooterBar) render structured props only.
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
    renderSectionComponents(containerChildren(node), design, depth + 1) +
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
    renderSectionComponents(containerChildren(node), design, depth + 1) +
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
): string {
  if (depth > LEADGEN_MAX_CONTAINER_DEPTH) return "";
  const ratioProp = propStr(node, "ratio");
  const ratio =
    ratioProp === "60/40" || ratioProp === "40/60" || ratioProp === "70/30" ? ratioProp : "50/50";
  const mobile = propStr(node, "mobile") === "keep" ? "keep" : "stack";
  return (
    `<div class="lg-columns"${hydration(node)} data-ratio="${ratio}" data-mobile="${mobile}">` +
    renderSectionComponents(containerChildren(node), design, depth + 1) +
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
    renderSectionComponents(containerChildren(node), design, depth + 1) +
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
    renderSectionComponents(containerChildren(node), design, depth + 1) +
    `</div>` +
    `</div>`
  );
}

// Spacer (§8.5 layout leaf): a token-sized vertical gap. Purely decorative —
// aria-hidden; the size token value is the one inline style.
export function renderSpacer(node: LeadgenComponentNode, design: DefaultFunnelDesign): string {
  return (
    `<div class="lg-spacer"${hydration(node)}` +
    style({ height: spacerSizeValue(design, propStr(node, "size")) }) +
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
// cases consume it (their recursion + the defensive depth guard).
export function renderComponent(
  node: LeadgenComponentNode,
  design: DefaultFunnelDesign,
  depth = 1,
): string {
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
    case "SearchableDropdownQuestion":
      return renderSearchableDropdownQuestion(node, design);
    case "OtherGroupSelector":
      return renderOtherGroupSelector(node, design);
    case "FreeTextQuestion":
      return renderFreeTextQuestion(node, design);
    case "NumberInputQuestion":
      return renderNumberInputQuestion(node, design);
    case "CurrencyInputQuestion":
      return renderCurrencyInputQuestion(node, design);
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
    case "SuccessState":
      return renderSuccessState(node, design);
    case "SecureFormBadge":
      return renderSecureFormBadge(node, design);
    case "TrustBar":
      return renderTrustBar(node, design);
    case "LogoStrip":
      return renderLogoStrip(node, design);
    case "HelperText":
      return renderHelperText(node, design);
    case "ValidationError":
      return renderValidationError(node, design);
    case "LegalNote":
      return renderLegalNote(node, design);
    // §8.5 layout containers (recursive) + layout leaves
    case "Stack":
      return renderStack(node, design, depth);
    case "GridContainer":
      return renderGridContainer(node, design, depth);
    case "Columns":
      return renderColumns(node, design, depth);
    case "CardPanel":
      return renderCardPanel(node, design, depth);
    case "BackgroundPanel":
      return renderBackgroundPanel(node, design, depth);
    case "Spacer":
      return renderSpacer(node, design);
    case "HeaderBar":
      return renderHeaderBar(node, design);
    case "FooterBar":
      return renderFooterBar(node, design);
    default: {
      // Exhaustiveness guard + defensive empty render for a corrupt node.
      const _exhaustive: never = node.type;
      void _exhaustive;
      return "";
    }
  }
}

// Ordered render of a full Section: each component's preset markup, in order.
// §8.5: pass the FULL tree — container presets recurse into their children via
// this same function at depth + 1 (renderComponent threads the depth; the
// container renderers stop past LEADGEN_MAX_CONTAINER_DEPTH). A flat legacy
// array (zero containers) renders byte-identically to the pre-§8.5 output.
export function renderSectionComponents(
  nodes: readonly LeadgenComponentNode[],
  design: DefaultFunnelDesign,
  depth = 1,
): string {
  return nodes.map((n) => renderComponent(n, design, depth)).join("");
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
export function renderSectionComponentsVisible(
  nodes: readonly LeadgenComponentNode[],
  design: DefaultFunnelDesign,
  visibleIds: ReadonlySet<string>,
  depth = 1,
): string {
  if (depth > LEADGEN_MAX_CONTAINER_DEPTH + 1) return "";
  let out = "";
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) continue;
    if (isLayoutContainerType(node.type)) {
      if (depth > LEADGEN_MAX_CONTAINER_DEPTH) continue; // defensive (validator is the gate)
      const inner = renderSectionComponentsVisible(
        containerChildren(node),
        design,
        visibleIds,
        depth + 1,
      );
      // Re-render the container wrapper with the FILTERED children: emit the
      // container via its own preset around the filtered inner markup by
      // rendering a children-less clone and splicing the inner HTML into the
      // wrapper. The wrapper close tag is always the last `</…>` emitted by
      // the container preset, and every container preset nests children as
      // the LAST element before its closing tag(s), so the splice point is
      // the recursion output of the empty clone.
      out += renderContainerWrapper(node, design, depth, inner);
    } else {
      if (typeof node.question_id === "string" && visibleIds.has(node.question_id)) {
        out += renderComponent(node, design, depth);
      }
    }
  }
  return out;
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
