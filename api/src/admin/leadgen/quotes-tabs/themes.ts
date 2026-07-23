// LeadGen admin UI — Quotes editor, THEMES tab module (LEADGEN-REWORK-03 §12
// P3a mechanical split of ui-quotes.ts). The theme editor panel (09 §9.3
// harmony steps + button/answer style axes) + the theme presets list.
// P4 (Templates + Themes tabs, §8.3-8.4) owns this file next.
// PURE MOVE from ui-quotes.ts — zero logic/behavior change (P3a phase gate:
// test/leadgen-p3a-split-parity.test.ts asserts byte-identical SSR output).

import { escapeHtml } from "../../templates/layout";
import {
  THEME_BUTTON_LAYOUTS,
  THEME_BUTTON_SELECTED_STYLES,
  THEME_BUTTON_STYLES,
  THEME_DISPLAY_SIZE_SCALES,
  THEME_FONT_IDS,
  THEME_RADIUS_SCALES,
  THEME_RADIUS_STEPS,
  THEME_SHADOW_SCALES,
  THEME_SHADOW_STEPS,
  THEME_SIZE_SCALES,
  THEME_SPACING_SCALES,
} from "../../../public/leadgen/designs/theme";
import {
  ROLE_META,
  enumOptions,
  renderRoleStrip,
  frameControl,
  renderOverrideSwitch,
} from "./shared";


// --- theme editor (09 §9.3) ---------------------------------------------------

// DEV-60 (d), 09 §9.3 — the curated harmony steps per role-edit control:
// base value + wash / darker / lighter steps DERIVED from the base design's
// value (island mix math paints the chips; labels only, never hex text).
// "Base" writes the ROLE-VALUE alias; derived steps are custom values and
// flow through the Advanced custom-color path (same storage + warning
// semantics), never a silent bypass.
const HARMONY_STEPS: ReadonlyArray<{ step: string; label: string }> = [
  { step: "base", label: "Base" },
  { step: "wash", label: "Soft wash" },
  { step: "darker", label: "Darker" },
  { step: "lighter", label: "Lighter" },
];


function renderHarmonyRow(role: string): string {
  const buttons = HARMONY_STEPS.map(
    (s) =>
      `<button type="button" class="lg-harmony-step" data-harmony-role="${escapeHtml(role)}" data-harmony-step="${escapeHtml(s.step)}"><span class="lg-harmony-chip" data-harmony-chip aria-hidden="true"></span>${escapeHtml(s.label)}</button>`,
  ).join("");
  return `<div class="lg-harmony-row" data-harmony-row="${escapeHtml(role)}">${buttons}</div>`;
}


// P6b (deliverable 2) — proper-case labels for the FULL THEME_FONT_IDS
// vocabulary. P6a widened THEME_FONT_IDS from the 3 back-compat ids
// (literata/sora/system) to 11 (+8 curated self-hosted families, theme.ts
// THEME_FONT_STACKS doc comment) — enumOptions() already falls back to a
// de-underscored raw id when no label is given (e.g. "space grotesk"), so
// this map exists purely to give every option a polished human label,
// extending the pre-existing 3-id inline label the two font selects used.
const THEME_FONT_LABELS: Readonly<Record<string, string>> = {
  literata: "Literata",
  sora: "Sora",
  system: "System",
  poppins: "Poppins",
  space_grotesk: "Space Grotesk",
  fraunces: "Fraunces",
  playfair: "Playfair Display",
  manrope: "Manrope",
  dm_sans: "DM Sans",
  work_sans: "Work Sans",
  lexend: "Lexend",
};


function renderThemeEditorPanel(isControl: boolean): string {
  const paletteRows = ROLE_META.map(
    (r) => `<div class="lg-theme-role-row" data-theme-role="${escapeHtml(r.role)}">
    <span class="lg-theme-swatch" data-role-swatch aria-hidden="true"></span>
    <span class="lg-grow"><strong>${escapeHtml(r.label)}</strong><br /><span class="lg-used-by">Used by: ${escapeHtml(r.used_by)}</span></span>
    <span class="lg-inherit-tag" data-role-source>Base design</span>
    <details class="lg-theme-edit"><summary class="form-help">Edit</summary>
      <p class="form-help">Suggested from this design&#8217;s base value:</p>
      ${renderHarmonyRow(r.role)}
      <p class="form-help">Or pick a color from this design&#8217;s palette:</p>
      ${renderRoleStrip(`palette.${r.role}`)}
      <button type="button" class="btn btn-sm btn-outline" data-role-reset="${escapeHtml(r.role)}">Reset to inherited</button>
    </details>
  </div>`,
  ).join("");

  const themeSelect = (label: string, key: string, values: readonly string[], labels?: Readonly<Record<string, string>>): string =>
    `<div class="form-group"><label class="form-label">${escapeHtml(label)}</label><select class="form-select" data-theme-key="${escapeHtml(key)}"><option value="">Inherit from base design</option>${enumOptions(values, labels)}</select></div>`;

  // Round-4 P5b: lives inside the new "Themes" top tab now (moved out of the
  // canvas toolbar) — the tab panel wrapper owns visibility.
  return `<div class="lg-panel-card" id="lg-theme-editor">
  <h3>Funnel theme</h3>
  <div class="lg-scope-head">Editing: <strong>Funnel theme</strong> · affects every slide and every component default of this funnel</div>
  ${renderOverrideSwitch("theme", isControl)}
  <div class="lg-theme-minipreview" id="lg-theme-minipreview" data-mini-preview-mode="frame">
    <iframe id="lg-theme-minipreview-frame" class="lg-minipreview-frame" title="Theme mini preview" sandbox="allow-same-origin"></iframe>
    <p class="form-help" id="lg-theme-minipreview-status" role="status"></p>
  </div>
  <h3>Colors</h3>
  <div id="lg-theme-palette">${paletteRows}</div>
  <h3>Typography</h3>
  <p class="form-help">Display sets headlines, big numbers and the display size below. Body sets paragraphs, labels and inputs — the two never share a size or a font by accident.</p>
  <div class="lg-scalars">
    ${themeSelect("Display font (headlines)", "typography.display", THEME_FONT_IDS, THEME_FONT_LABELS)}
    ${themeSelect("Body font (paragraphs)", "typography.body", THEME_FONT_IDS, THEME_FONT_LABELS)}
    ${themeSelect("Body text size", "typography.size", THEME_SIZE_SCALES, { s: "Small", m: "Medium", l: "Large" })}
    ${themeSelect("Display size", "typography.display_size", THEME_DISPLAY_SIZE_SCALES, { m: "Base", l: "Large", xl: "X-Large", xxl: "XX-Large" })}
  </div>
  <h3>Scales</h3>
  <div class="lg-scalars">
    ${themeSelect("Spacing", "scales.spacing", THEME_SPACING_SCALES, { compact: "Compact", regular: "Regular", roomy: "Roomy" })}
    ${themeSelect("Corners", "scales.radius", THEME_RADIUS_SCALES, { sharp: "Sharp", soft: "Soft", round: "Round" })}
    ${themeSelect("Shadows", "scales.shadow", THEME_SHADOW_SCALES, { none: "None", low: "Low", mid: "Mid", high: "High" })}
  </div>
  <h3>Buttons</h3>
  ${frameControl("Button background", renderRoleStrip("theme:button_defaults.background_role"))}
  ${frameControl("Button text", renderRoleStrip("theme:button_defaults.text_role"))}
  <div class="lg-scalars">
    ${themeSelect("Button corners", "button_defaults.radius", THEME_RADIUS_STEPS)}
    ${themeSelect("Button height", "button_defaults.min_height", ["m", "l"], { m: "Medium", l: "Large" })}
    ${themeSelect("Button casing", "button_defaults.casing", ["none", "upper"], { none: "As written", upper: "UPPERCASE" })}
  </div>
  <h4>Button style</h4>
  <p class="form-help">Three independent looks (Images 38&#8211;40) &#8212; mix and match; each defaults to today's look.</p>
  <div class="lg-scalars">
    ${themeSelect("Fill", "button_defaults.fill", THEME_BUTTON_STYLES, { fill: "Solid (default)", outline: "Outline", soft: "Soft pill + shadow" })}
    ${themeSelect("Answer layout", "button_defaults.layout", THEME_BUTTON_LAYOUTS, { grid: "Grid (default)", list: "Single-column list" })}
    ${themeSelect("Selected style", "button_defaults.selected", THEME_BUTTON_SELECTED_STYLES, { wash: "Soft wash (default)", mark: "Bigger + check badge" })}
  </div>
  <h3>Cards</h3>
  ${frameControl("Card background", renderRoleStrip("theme:card_defaults.background_role"))}
  ${frameControl("Card border", renderRoleStrip("theme:card_defaults.border_role"))}
  <div class="lg-scalars">
    ${themeSelect("Card corners", "card_defaults.radius", THEME_RADIUS_STEPS)}
    ${themeSelect("Card shadow", "card_defaults.shadow", THEME_SHADOW_STEPS)}
  </div>
  <details class="lg-advanced" id="lg-theme-advanced">
    <summary>Advanced token administration</summary>
    <p class="form-help">Custom colors skip the design system &#8212; check contrast.</p>
    <div class="lg-list-row">
      <select class="form-select" id="lg-theme-hex-role">${ROLE_META.map((r) => `<option value="${escapeHtml(r.role)}">${escapeHtml(r.label)}</option>`).join("")}</select>
      <input class="form-input" id="lg-theme-hex-value" placeholder="Custom color value" />
      <button type="button" class="btn btn-sm btn-secondary" id="lg-theme-hex-apply">Apply</button>
    </div>
  </details>
</div>`;
}


// ---------------------------------------------------------------------------
// P6b (deliverables 3+4) — PRESETS: the KV `lg-funnel-themes` catalog
// (themes-handlers.ts CRUD), surfaced inline in the SAME Themes tab. Full
// list/create/edit/delete already exists as the standalone Themes-manager
// page (ui-theme-manager.ts) — embedded here via its OWN `?embed=1`
// chromeless mode, the SAME mechanism Section Studio already uses to overlay
// it (ui-section-studio.ts's `#lg-themes-overlay-frame`), so this reuses
// 100% of its rendering/CRUD/delete-guard UI rather than duplicating any of
// it ("Reuse ui-theme-manager's existing editor internals" — the whole page
// IS its internals). This panel adds ONLY what that page cannot do on its
// own: a picker to APPLY a saved preset to THIS funnel/variant (a per-funnel
// ThemeIdRef picker), and the theme A/B one-click fork.
// ---------------------------------------------------------------------------

function renderThemePresetsPanel(): string {
  return `<div class="lg-panel-card" id="lg-theme-presets">
  <h3>Theme presets</h3>
  <p class="form-help">Save the current look as a reusable preset from the panel below (its own "New theme" button), then apply or delete any preset here. Presets are shared across every funnel.</p>
  <div class="lg-preset-apply-row">
    <select class="form-select" id="lg-theme-preset-select" aria-label="Theme preset"><option value="">Loading presets&#8230;</option></select>
    <button type="button" class="btn btn-sm btn-secondary" id="lg-theme-preset-apply">Apply to this funnel</button>
    <button type="button" class="btn btn-sm btn-outline" id="lg-theme-ab-this" title="Fork this variant with the picked preset as its theme, then set the traffic split">A/B this theme</button>
  </div>
  <iframe id="lg-theme-presets-frame" class="lg-theme-presets-frame" title="Theme presets manager" src="/admin/leadgen/themes?embed=1"></iframe>
</div>`;
}


export function renderThemesTabPanel(isControl: boolean): string {
  // Round-4 P5b deliverable 1: a CLEAN mount point — P6b replaces the panel
  // BODY (renderThemeEditorPanel's internals) without touching this tab's
  // chrome (the tab button + this wrapper div stay byte-stable across P6b).
  return `<div class="lg-qpanel" data-panel="themes">
  <div id="lg-themes-panel-mount">${renderThemeEditorPanel(isControl)}</div>
  ${renderThemePresetsPanel()}
</div>`;
}
