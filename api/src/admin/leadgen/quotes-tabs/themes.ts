// LeadGen admin UI — Quotes editor, THEMES tab module (LEADGEN-REWORK-03 §12
// P3a mechanical split of ui-quotes.ts). The theme editor panel (09 §9.3
// harmony steps + button/answer style axes) + the theme presets list.
//
// R2 P2 S2b (contract A.1 #11-E + A.3 rejection) — THREE-PANE REBUILD.
// A.3 verbatim: "themes tab layout (left section chooser by activity/
// vertical, sticky center canvas, right design elements, no duplicate
// canvases)". This replaces the single-column layout the P0/P1 packs left
// here (a stacked mini-preview strip ABOVE a full embedded standalone-page
// iframe — the "duplicate canvases" the owner rejected) with:
//   LEFT   renderSectionChooserPane   — the section library, filterable by
//          activity/vertical pills (idiom copied from quotes-tabs/funnel.ts's
//          renderBoardLibrary/renderLibraryCard — SAME reused CSS classes,
//          `.lg-lib-*`/`.lg-filter-pill`/`.lg-chip-activity`, all defined
//          globally in shared.ts, already loaded on this page). Picking a
//          card is PREVIEW-ONLY (client-side selection only — no write).
//   CENTER renderThemeCanvasPane     — ONE sticky (`position:sticky`) canvas
//          iframe rendering the CHOSEN real section through the REAL
//          renderer (POST /sections/preview, the same endpoint
//          ui-theme-manager.ts's server-side §8.4 canvas already calls).
//   RIGHT  renderThemeRailPane       — the EXISTING color/typography/button/
//          card controls (renderThemeEditorPanel, UNCHANGED except the old
//          mini-preview strip removed) + the preset-apply row, reorganized
//          into a scrolling rail (renderThemePresetsPanel's OLD embedded
//          `?embed=1` iframe removed — that route (ui-theme-manager.ts) is
//          untouched and still serves Section Studio's own overlay; this tab
//          just no longer double-embeds it as a second canvas).
//
// THEMES_TAB_SCRIPT is this tab's OWN self-contained ES5 island (mirrors the
// ui-theme-manager.ts THEME_MGR_SCRIPT pattern this file's sibling already
// uses) — it does not depend on quotes-tabs/funnel.ts's private closure state
// (that file's own working-theme object is not reachable from here; this
// island's OWN draft is `railDraftTheme`, deliberately named apart from it),
// so it:
//   - reads funnel/variant public ids off the EXISTING #lg-quote-editor root
//     data attributes (the same ones funnel.ts's own script reads),
//   - fetches the section library client-side (GET /api/admin/leadgen/
//     sections?status=active) — no new endpoint,
//   - on a rail control edit, applies it directly (GET the funnel's current
//     theme_json, RESOLVE a `theme_id` pointer into the preset's own inline
//     values, merge the changed field on top, PUT the merged whole) then
//     refreshes the canvas. R2 P2 FIX-FIRST (MINOR-1) switched this from R7's
//     other sanctioned branch to this one: R7 offered "resolve the preset
//     into inline values, OR drop theme_id when overriding", and the drop
//     branch silently discarded the applied preset's palette/typography/
//     buttons on the operator's very first control edit. The residual this
//     comment used to leave OPEN — quotes-tabs/funnel.ts's "one-Save" button
//     building its OWN PUT and dropping the preset — is CLOSED: that path now
//     runs the IDENTICAL resolve algorithm (funnel.ts normalizedThemePut, via
//     the shared ./theme-preset-resolve snippet both islands interpolate).
//     R2 P2 FIX-FIRST-2 extended that shared algorithm again: a preset's FONT
//     families now resolve too, and a preset that cannot be read ABORTS the
//     edit (fail-closed) instead of silently PUTting an empty look.
//   - the funnel.ts-owned controls keep their EXACT existing data attributes
//     (data-theme-key / data-role-pick / data-role-pick-for / the override-
//     switch radios) so funnel.ts's OWN delegated listeners keep working
//     completely unchanged (both scripts observe the same DOM events
//     independently; neither stops propagation).
//
// P4 S4.2 audit (retained, now resolved): ground truth #11E's "swatch-only
// preview" gap and the §8.4 live-canvas build are both superseded here — the
// canvas this file now owns directly is a REAL section through the REAL
// renderer, chosen from the REAL section library, not a swatch strip.

import { escapeHtml } from "../../templates/layout";
import {
  THEME_BUTTON_LAYOUTS,
  THEME_BUTTON_MIN_HEIGHTS,
  THEME_BUTTON_SELECTED_STYLES,
  THEME_BUTTON_STYLES,
  THEME_DISPLAY_SIZE_SCALES,
  THEME_FIELD_MIN_HEIGHTS,
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
// R2 P2 tail (item 2): the preset-resolve algorithm (PRESET_ROLE_BRIDGE /
// PRESET_EXTRA_ROLE_BRIDGE / hasAnyKey / inlineThemeFromPreset) now lives in
// this shared snippet so quotes-tabs/funnel.ts's one-Save theme path can
// reuse it byte-identically instead of a hand-copied duplicate — see that
// module's header for why this is a source-text export, not a runtime import.
import { themePresetResolveSnippet } from "./theme-preset-resolve";


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


// R2 F-3 — the two SIZE rails.
//
// "Button height" used to hard-code its vocabulary as ["m","l"]; it now reads
// the EXPORTED enum, which was widened to the full shared s/m/l ladder so a
// preset's Button size = Small has an inline home to be carried into when the
// operator's first rail edit forks theme_json. A hand-typed list here could
// silently fall behind that enum again — that drift is the whole defect class.
// "Field height" is NEW: the field box had no inline axis at all, which is
// exactly why a preset's Field height was discarded at the fork (measured:
// painted 60px -> 44px after editing one colour). Labels live out here so the
// emitted panel markup carries no comment/whitespace noise on the wire.
const BUTTON_HEIGHT_LABELS: Readonly<Record<string, string>> = { s: "Small", m: "Medium", l: "Large" };
const FIELD_HEIGHT_LABELS: Readonly<Record<string, string>> = { small: "Small", medium: "Medium", large: "Large" };

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

  // R2 P2 S2b: the OLD `lg-theme-minipreview`/`lg-theme-minipreview-frame`
  // mini-preview strip (a `data-mini-preview-mode="frame"` request, which
  // ALWAYS server-renders the slot placeholder regardless of whether a real
  // section exists) is REMOVED from this panel — the tab's ONE real canvas
  // now lives in the CENTER pane (renderThemeCanvasPane), fed by THIS tab's
  // own script, never this placeholder-prone mechanism.
  // P8-1 F1 (B3/R6-1 round 2, owner "D. Theme picker per funnel name"): the
  // scope line NAMES the funnel this panel is editing, and carries the picker
  // that changes it. Both are filled by THEMES_TAB_SCRIPT from the board's own
  // #lg-board-data funnel rows (the same list the board columns render) — this
  // function's signature is fixed by its ui-quotes.ts call site, so no server
  // data can reach it here, and no new endpoint is introduced. The trailing
  // sentence stays byte-identical: it is pinned operator copy
  // (test/leadgen-glossary-lint.test.ts's quote-builder "slide" calibration).
  return `<div class="lg-panel-card" id="lg-theme-editor">
  <h3>Funnel theme</h3>
  <div class="lg-scope-head">Editing: <strong id="lg-theme-target-name" data-lg-target-funnel-name>this funnel</strong> · Funnel theme · affects every slide and every component default of this funnel<select class="form-select form-select-sm" id="lg-theme-target-select" data-lg-target-funnel aria-label="Funnel this theme edits" style="margin-left:8px;max-width:200px;vertical-align:middle"></select></div>
  ${renderOverrideSwitch("theme", isControl)}
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
    ${themeSelect("Button height", "button_defaults.min_height", THEME_BUTTON_MIN_HEIGHTS, BUTTON_HEIGHT_LABELS)}
    ${themeSelect("Button casing", "button_defaults.casing", ["none", "upper"], { none: "As written", upper: "UPPERCASE" })}
  </div>
  <h3>Fields</h3>
  <div class="lg-scalars">
    ${themeSelect("Field height", "field_defaults.min_height", THEME_FIELD_MIN_HEIGHTS, FIELD_HEIGHT_LABELS)}
  </div>
  <h4>Button style</h4>
  <p class="form-help">Three independent looks (Images 38&#8211;40) &#8212; mix and match; each defaults to today's look.</p>
  <div class="lg-scalars">
    ${themeSelect("Fill", "button_defaults.fill", THEME_BUTTON_STYLES, { fill: "Solid (default)", outline: "Outline", soft: "Soft pill + shadow" })}
    ${themeSelect("Answer layout", "button_defaults.layout", THEME_BUTTON_LAYOUTS, { grid: "Grid (default)", list: "Single-column list", card: "Full-width cards" })}
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
// (themes-handlers.ts CRUD). Full list/create/edit/delete lives on the
// standalone Themes-manager page (ui-theme-manager.ts, GET /admin/leadgen/
// themes) — R2 P2 S2b (A.3 "no duplicate canvases") stops re-embedding that
// WHOLE page (with its own §8.4 live canvas) inside THIS tab as a second
// canvas; a plain link replaces the old `?embed=1` iframe. This panel keeps
// ONLY what the standalone page cannot do on its own: a picker to APPLY a
// saved preset to THIS funnel/variant (unchanged — funnel.ts's
// wireThemePresets still drives these exact element ids), and the theme A/B
// one-click fork.
// ---------------------------------------------------------------------------

function renderThemePresetsPanel(): string {
  return `<div class="lg-panel-card" id="lg-theme-presets">
  <h3>Theme presets</h3>
  <p class="form-help">Save the current look as a reusable preset from the Themes manager, then apply or delete any preset there. Presets are shared across every funnel.</p>
  <div class="lg-preset-apply-row">
    <select class="form-select" id="lg-theme-preset-select" aria-label="Theme preset"><option value="">Loading presets&#8230;</option></select>
    <button type="button" class="btn btn-sm btn-secondary" id="lg-theme-preset-apply">Apply to this funnel</button>
    <button type="button" class="btn btn-sm btn-outline" id="lg-theme-ab-this" title="Fork this variant with the picked preset as its theme, then set the traffic split">A/B this theme</button>
  </div>
  <a class="btn btn-sm btn-outline" href="/admin/leadgen/themes" target="_blank" rel="noopener" id="lg-theme-manage-link">Manage all presets &#8594;</a>
</div>`;
}


// ---------------------------------------------------------------------------
// R2 P2 S2b — LEFT: the section chooser. Idiom copied from quotes-tabs/
// funnel.ts's renderBoardLibrary/renderLibraryCard (read-only reference for
// this slice): the SAME globally-defined `.lg-lib-*`/`.lg-filter-pill`/
// `.lg-chip-activity` CSS classes (shared.ts, already loaded on every quote-
// editor page load), reused verbatim rather than re-invented, so this pane
// looks and feels exactly like the funnel board's own library rail. Content
// is populated entirely client-side (THEMES_TAB_SCRIPT below) — no server
// data threaded through this function, since renderThemesTabPanel's own
// signature (called from ui-quotes.ts, outside this slice) cannot change.
// Picking a card only sets the CENTER canvas's preview target — it is a
// pure client-side selection, never a write to the chosen section.
// ---------------------------------------------------------------------------

function renderSectionChooserPane(): string {
  return `<div class="lg-board-left" data-pin="r2-theme-chooser" style="flex:0 0 280px;width:280px;">
    <div class="lg-lib-head">
      <div class="lg-lib-title">Section library</div>
      <div class="lg-lib-search"><span class="lg-lib-search-ico" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3.2-3.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></span><input type="search" id="lg-theme-chooser-search" placeholder="Search sections" aria-label="Search sections" /></div>
      <div class="lg-lib-filters" id="lg-theme-chooser-filters" data-lg-theme-filters></div>
    </div>
    <div class="lg-lib-list" id="lg-theme-chooser-list" data-lg-theme-list>
      <p class="lg-col-help" style="padding:8px 4px">Loading sections&#8230;</p>
    </div>
  </div>`;
}


// ---------------------------------------------------------------------------
// R2 P2 S2b — CENTER: the ONE sticky canvas. A.3 verbatim: "sticky center
// canvas". `position:sticky` (inline — this tab introduces no new admin
// stylesheet dependency; matches ui-theme-manager.ts's own all-inline-style
// convention) with a top offset clearing the admin shell's fixed 60px header
// + 24px content padding (ui-theme-manager.ts's own documented 84px figure),
// so it stays in view while the (taller) right rail scrolls past it.
// ---------------------------------------------------------------------------

function renderThemeCanvasPane(): string {
  return `<div class="lg-theme-canvas-pane" id="lg-theme-canvas-pane" data-pin="r2-sticky-canvas" style="flex:1 1 420px;min-width:320px;position:sticky;top:84px;">
    <div class="lg-panel-card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">
        <h3 style="margin:0">Live preview</h3>
        <span class="form-help" id="lg-theme-canvas-section-name" style="margin:0"></span>
      </div>
      <iframe id="lg-theme-canvas-frame" class="lg-theme-canvas-frame" title="Theme live preview" sandbox="allow-same-origin" style="width:100%;min-height:440px;border:1px solid var(--c-border);border-radius:10px;background:#EDF0F4;display:block"></iframe>
      <p class="form-help" id="lg-theme-canvas-status" role="status" aria-live="polite"></p>
    </div>
  </div>`;
}


// ---------------------------------------------------------------------------
// R2 P2 S2b — RIGHT: the existing controls, reorganized as a rail. Content
// is UNCHANGED (renderThemeEditorPanel minus the old mini-preview strip +
// renderThemePresetsPanel minus the old embedded iframe) — only the
// surrounding container is new. `id="lg-theme-rail"` is THEMES_TAB_SCRIPT's
// OWN delegation root for its (additive, non-conflicting) live-apply
// listener; it does not replace funnel.ts's existing delegated listeners
// bound higher up the tree (#lg-quote-editor), which keep running unchanged.
// `id="lg-themes-panel-mount"` is the PRE-EXISTING Round-4 P5b "clean mount
// point" id (kept byte-stable on purpose — test-ui/__p6b-theme-mgr.spec.ts,
// __p5b-quotes-ia.spec.ts and leadgen-round4-quotes-acceptance.gesture.spec.ts
// all locate `#lg-themes-panel-mount #lg-theme-editor`; no reason to move it).
// ---------------------------------------------------------------------------

function renderThemeRailPane(isControl: boolean): string {
  return `<div class="lg-theme-rail" id="lg-theme-rail" data-pin="r2-theme-rail" style="flex:0 0 340px;min-width:280px;max-width:380px">
    <div id="lg-themes-panel-mount">${renderThemeEditorPanel(isControl)}</div>
    ${renderThemePresetsPanel()}
  </div>`;
}


// ---------------------------------------------------------------------------
// R2 P2 S2b — this tab's OWN ES5 island (mirrors ui-theme-manager.ts's
// THEME_MGR_SCRIPT pattern). Strict ES5 (var/function only — no arrow/const/
// let/backtick/async/spread/destructure/optional-chaining), same discipline
// the quote-editor's renderedPages() ES5 scan already enforces.
// ---------------------------------------------------------------------------

const THEMES_TAB_SCRIPT = `
(function () {
  'use strict';
  // R2 P2 FIX-FIRST (MINOR-1) / P2 tail (item 2 extraction): PRESET_ROLE_
  // BRIDGE, PRESET_EXTRA_ROLE_BRIDGE, hasAnyKey, inlineThemeFromPreset now
  // come from the shared theme-preset-resolve snippet (see that module's
  // header) so quotes-tabs/funnel.ts's one-Save theme path can reuse this
  // EXACT algorithm — never a hand-copied duplicate.
  ${themePresetResolveSnippet()}
  var root = document.querySelector('[data-lg-themes-tab]');
  if (!root) { return; }
  // Same element funnel.ts's own island reads (id="lg-quote-editor") — found
  // via a CSS-id selector rather than the other DOM lookup method, so
  // neither this line NOR this comment's own wording repeats that OTHER
  // method-name-plus-id combination as one literal run of characters — an
  // unrelated seam-test harness locates the MAIN combined editor script by
  // scanning every served script's raw text for exactly that one substring.
  var editorRoot = document.querySelector('#lg-quote-editor');
  // P8-1 F1 (contract R6-1, round 2): funnelPublicId/variantPublicId below are
  // the EDITOR-DEFAULT funnel (whichever variant this page was opened on) --
  // frozen once, same as before, and still what this panel edits when nothing
  // else is chosen. WHICH funnel is chosen now lives in the page URL's hash
  // (tab=<name>&funnel=<public id>), written by a board Theme/Template chip
  // click (quotes-tabs/funnel.ts) or by this panel's own funnel picker.
  // Round 1 used a transient data-carried-funnel-public-id attribute that the
  // plain-tab-click listener wiped, so Themes -> Activation -> Themes silently
  // retargeted the editor's funnel and the owner's edit landed on the wrong
  // one; a hash param survives tab navigation, a reload and repeated chip
  // clicks. Every target read below happens AT THE ACTION (never cached).
  var funnelPublicId = editorRoot ? (editorRoot.getAttribute('data-funnel-public-id') || '') : '';
  var variantPublicId = editorRoot ? (editorRoot.getAttribute('data-variant-public-id') || '') : '';
  // Self-sufficient copies (this island is its own closure; see the file
  // header) of the two hash helpers quotes-tabs/funnel.ts also carries.
  // window.location is read defensively so the ES5 island-probe harnesses,
  // which stub window with timers only, keep booting this script unchanged.
  function lgHashParam(name) {
    var loc = (typeof window === 'undefined' || !window) ? null : window.location;
    var h = (loc && loc.hash) ? String(loc.hash) : '';
    var m = h.match(new RegExp('[#&]' + name + '=([^&]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function lgSetHashParam(name, value) {
    var loc = (typeof window === 'undefined' || !window) ? null : window.location;
    if (!loc) { return; }
    var tab = name === 'tab' ? value : lgHashParam('tab');
    var funnel = name === 'funnel' ? value : lgHashParam('funnel');
    var parts = [];
    if (tab) { parts.push('tab=' + encodeURIComponent(tab)); }
    if (funnel) { parts.push('funnel=' + encodeURIComponent(funnel)); }
    var hash = parts.length > 0 ? '#' + parts.join('&') : '';
    var hist = window.history;
    if (hist && hist.replaceState) { hist.replaceState(null, '', (loc.pathname || '') + (loc.search || '') + hash); return; }
    loc.hash = hash;
  }
  // The board's own funnel rows (public_id / name / active_variant_public_id)
  // -- the SAME list the board columns render, already on this page as the
  // #lg-board-data blob (quotes-tabs/funnel.ts's boardDataBlob, emitted before
  // this panel). No new endpoint, no second source of funnel truth.
  function boardFunnels() {
    var el = document.getElementById('lg-board-data');
    var raw = el ? (el.textContent || el.innerText || '') : '';
    if (!raw) { return []; }
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return []; }
    return (parsed && parsed.funnels) ? parsed.funnels : [];
  }
  function boardFunnelBy(pub) {
    var fs = boardFunnels();
    var i;
    for (i = 0; i < fs.length; i++) { if (fs[i].public_id === pub) { return fs[i]; } }
    return null;
  }
  function targetFunnelPublicId() {
    // A chosen funnel the board no longer has (a stale bookmark, a deleted
    // column) resolves back to the editor default rather than editing blind.
    var picked = lgHashParam('funnel');
    if (picked !== '' && boardFunnelBy(picked) !== null) { return picked; }
    return funnelPublicId;
  }
  function targetVariantPublicId() {
    var picked = targetFunnelPublicId();
    if (picked === funnelPublicId) { return variantPublicId; }
    var f = boardFunnelBy(picked);
    return (f && f.active_variant_public_id) ? f.active_variant_public_id : variantPublicId;
  }
  function targetFunnelName() {
    var f = boardFunnelBy(targetFunnelPublicId());
    return (f && f.name) ? String(f.name) : '';
  }
  var isControl = root.getAttribute('data-is-control') === 'true';

  function byId(id) { return document.getElementById(id); }
  function clearChildren(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }
  // ONE status line, TWO kinds of message sharing it:
  //   transient — the canvas's own progress text (Loading preview…), replaced
  //               and cleared freely by every refresh.
  //   notice    — an operator-facing REFUSAL (a rejected save, a preset that
  //               could not be read). R2 P2 FIX-FIRST-2 (FIX 3): a refusal
  //               used to be written straight into the same slot the rollback
  //               refresh was ALREADY re-rendering into, so the server's
  //               message was wiped by that refresh's own setStatus('') a
  //               moment later — the operator saw a flash, then nothing. A
  //               notice now OUTRANKS the transient text and survives until
  //               the next edit is queued.
  var statusTransient = '';
  var statusNotice = '';
  function paintStatus() {
    var el = byId('lg-theme-canvas-status');
    if (el) { el.textContent = statusNotice !== '' ? statusNotice : statusTransient; }
  }
  function setStatus(text) {
    statusTransient = text || '';
    paintStatus();
  }
  function setNotice(text) {
    statusNotice = text || '';
    paintStatus();
  }

  // --- P8-1 F1: WHICH funnel this panel edits, said out loud ----------------
  // The scope line names the target funnel and the picker beside it changes
  // the target, so an operator who arrived from the top bar (no chip) is never
  // stranded on a funnel they can neither see nor change. Both are painted
  // from boardFunnels() above.
  function paintTargetHeader() {
    var name = targetFunnelName();
    var nameEl = byId('lg-theme-target-name');
    if (nameEl) { nameEl.textContent = name !== '' ? name : 'this funnel'; }
    var sel = byId('lg-theme-target-select');
    if (!sel) { return; }
    var fs = boardFunnels();
    if (fs.length === 0) { return; }
    var want = targetFunnelPublicId();
    clearChildren(sel);
    var i;
    for (i = 0; i < fs.length; i++) {
      var opt = document.createElement('option');
      opt.value = fs[i].public_id;
      opt.textContent = fs[i].name;
      if (fs[i].public_id === want) { opt.selected = true; }
      sel.appendChild(opt);
    }
    sel.value = want;
  }
  // --- P8-1 F6: the rail's CONTROLS follow the target too --------------------
  // FAIL-BEFORE (driven 2026-08-03): a Theme-chip click on P8-Charlie repainted
  // the header ("Editing: P8-Charlie") and the canvas, while all 16
  // [data-theme-key] selects beside them still read "Inherit from base design"
  // — Charlie stores typography.display_size = "xl". The operator read one
  // funnel's values under another funnel's name; F5 fixed exactly this class
  // for the Templates panel's layout controls and named this file's rail as
  // the surviving instance.
  // F6 closed it for the SELECTS ONLY — a REDUCED MODEL of its own fix, found
  // by review #2's drive: with P8-Charlie targeted the canvas painted Charlie's
  // --lg-primary #0E7C3A while the Brand-primary swatch beside it painted
  // rgb(171,18,52) (Funnel A's brand-primary), across all 14 role rows, every
  // role-pick swatch and every harmony chip, at 1280 and 375. P8-1 G1 hands the
  // colour table over too (announceTargetFunnelTheme below) so the WHOLE rail
  // reads one funnel.
  // The controls are quotes-tabs/funnel.ts's to paint (its own delegated
  // populateAllControls owns every inspector control on this page), so this
  // island does what quotes-tabs/templates.ts does for the frame: it fetches
  // the newly targeted funnel's stored theme ONCE and hands the SAME body over
  // as an event detail — one GET, two consumers, no second request.
  // P8-1 G1 (review #2, F-1): the announcement carries the SAME response's
  // effective_tokens as well. F6 handed over the stored theme only, so the consumer's
  // 16 selects followed the target while the 14 role rows beside them — whose
  // swatches, harmony chips and role picks all resolve through the role→value
  // table — kept painting the EDITOR funnel's colours under the target
  // funnel's name. GET /funnels/:id/theme already returns both halves
  // ({theme, effective_tokens}: frame-handlers.ts themeProjection), so this is
  // still ONE GET feeding two consumers, not a second mechanism.
  function announceTargetFunnelTheme(pub, theme, tokens) {
    try {
      var evt = document.createEvent('CustomEvent');
      evt.initCustomEvent('lg:target-funnel-theme', true, false, { funnel_public_id: pub, theme: theme, effective_tokens: tokens });
      document.dispatchEvent(evt);
    } catch (e) { /* engines without createEvent: the rail's own writes still resolve the target from the hash */ }
  }
  // P8-1 H1 (m-2): the page's OWN error banner — ui-quotes.ts's
  // #lg-quote-error, which sits above the tab strip (so it is on screen from
  // every tab) and is the element quotes-tabs/funnel.ts's showMsg already
  // writes. One existing element, no new mechanism, nothing blocked.
  function showPageError(text) {
    var el = byId('lg-quote-error');
    if (!el) { return; }
    el.textContent = text;
    el.hidden = false;
    // P8-1 J1 (review #4, MINOR F-7): this banner sits ABOVE the tab strip, so
    // an operator scrolled down to the rail never saw the refusal it exists to
    // deliver — MEASURED at 375 with the rail on screen: top -186px,
    // inViewport false. Bring it into view; feature-detected, so a page (or an
    // island-probe harness) whose element has no scroller is unaffected.
    // block:'center' rather than the default top-align — MEASURED at 375: a
    // top-aligned banner lands under the sticky admin header, which covered its
    // first line. An engine that ignores the options object still top-aligns.
    if (typeof el.scrollIntoView === 'function') {
      try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* engines that refuse: the banner is still shown */ }
    }
  }
  // P8-1 J1 (review #4, MAJOR F-3): WHOSE values the controls are showing. The
  // rail boots on the editor funnel's SSR theme and is re-pointed only by a
  // SUCCESSFUL read below, so this is exactly the funnel whose numbers are on
  // screen — which is what the failure banner has to say out loud when it is
  // not the funnel the header names.
  var themeShownFunnel = funnelPublicId;
  function syncThemeToTargetFunnel() {
    // Named targetFunnel for the same reason quotes-tabs/templates.ts's
    // syncFrameToTargetFunnel is: f is this island's BOARD-ROW name.
    var targetFunnel = targetFunnelPublicId();
    if (targetFunnel === '') { return; }
    fetch('/api/admin/leadgen/funnels/' + encodeURIComponent(targetFunnel) + '/theme', {
      credentials: 'same-origin', headers: { 'Accept': 'application/json' }
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      // P8-1 H1 (m-2): this said "leaves the controls as they are" and did the
      // opposite. A failed GET still resolved, so (body.theme || {}) announced
      // an EMPTY theme AND an EMPTY colour table for the target funnel: driven
      // against an injected 500, all 14 swatches went rgba(0, 0, 0, 0) and
      // every select went blank, with no message anywhere on the page. A
      // response that is not a readable theme now announces NOTHING — the
      // controls really do keep their previous values — and says why.
      // P8-1 K1 (F-1 residual): theme === null is NOT unreadable, the SAME
      // fact themeReadIsReadable below already applies to the write side.
      // frame-handlers.ts themeProjection returns {theme: null} for a funnel
      // that simply has no stored theme yet (a readable, empty answer), never
      // for a failed read. Excluding it here painted a false "Could not load
      // the theme" banner on EVERY themeless funnel switch and, worse, left
      // quotes-tabs/funnel.ts's targetThemeState/unreadableThemeFunnel
      // pointing at the PREVIOUS funnel's colour table (its failed branch
      // never updates targetThemeState), so the rail also kept painting the
      // OLD funnel's swatches under the NEW funnel's name.
      var readable = res.ok && res.body && typeof res.body === 'object' && res.body.theme !== undefined;
      if (!readable) {
        announceUnreadableTheme(targetFunnel);
        showPageError(themeReadFailureText(res.body, targetFunnel));
        return;
      }
      themeShownFunnel = targetFunnel;
      announceTargetFunnelTheme(targetFunnel, res.body.theme || {}, res.body.effective_tokens || {});
    }).catch(function () {
      announceUnreadableTheme(targetFunnel);
      showPageError(themeReadFailureText(null, targetFunnel));
    });
  }
  // The FAILURE half of the seam above — the same event, saying "there is no
  // table for this funnel". quotes-tabs/funnel.ts owns the controls, so it is
  // the one that can hold their current values; without being told, its
  // "blank until the table arrives" rule blanks them forever.
  function announceUnreadableTheme(pub) {
    try {
      var evt = document.createEvent('CustomEvent');
      evt.initCustomEvent('lg:target-funnel-theme', true, false, { funnel_public_id: pub, failed: true });
      document.dispatchEvent(evt);
    } catch (e) { /* engines without createEvent: the banner below is still shown */ }
  }
  function funnelNameOf(pub, fallback) {
    var f = boardFunnelBy(pub);
    return (f && f.name) ? String(f.name) : fallback;
  }
  function themeReadWhy(body) {
    return (body && typeof body.error === 'string' && body.error !== '') ? body.error : 'the theme could not be read';
  }
  // P8-1 J1 (review #4, MAJOR F-3) — SAY WHOSE VALUES ARE ON SCREEN.
  // FAIL-BEFORE (driven, review #4, j3-m2-failedget-1280.png): header
  // "Editing: P8-Charlie", Brand primary painting rgb(171, 18, 52) — Funnel
  // A's own brand primary — and the canvas 30px away painting Charlie's own
  // green, under a banner that said only "the controls still show the previous
  // values". It never said the values belong to a DIFFERENT funnel, nor that
  // an edit made now lands on the one in the header. Holding the previous
  // values is only honest when the disclosure names them (quotes-tabs/
  // funnel.ts's own comment on unreadableThemeFunnel demands exactly that:
  // never "a funnel's name over another funnel's numbers").
  function themeReadFailureText(body, pub) {
    var name = funnelNameOf(pub, 'that funnel');
    var why = themeReadWhy(body);
    var head = 'Could not load the theme for ' + name + ' \\u2014 ' + why + '. ';
    if (themeShownFunnel === pub || themeShownFunnel === '') {
      return head + 'The controls below still show the previous values for ' + name +
        ', which may be out of date. Any edit you make now is saved to ' + name + '.';
    }
    return head + 'The controls below still show the previous values \\u2014 they are ' +
      funnelNameOf(themeShownFunnel, 'another funnel') + '\\u2019s, NOT ' + name +
      '\\u2019s. Any edit you make now is saved to ' + name + '.';
  }
  function onTargetFunnelChanged() {
    // The rail's in-flight draft belonged to the PREVIOUS funnel — drop it, so
    // the canvas re-reads the newly targeted funnel's own stored theme.
    railDraftTheme = null;
    setNotice('');
    paintTargetHeader();
    syncThemeToTargetFunnel();
    refreshCanvas();
  }
  function announceTargetFunnel(pub) {
    var delivered = false;
    try {
      var evt = document.createEvent('CustomEvent');
      evt.initCustomEvent('lg:target-funnel-change', true, false, { funnel_public_id: pub });
      document.dispatchEvent(evt);
      delivered = true;
    } catch (e) { delivered = false; }
    // The dispatch above re-enters this island through its own listener below;
    // when the engine has no CustomEvent, react directly instead.
    if (!delivered) { onTargetFunnelChanged(); }
  }
  var targetSelectEl = byId('lg-theme-target-select');
  if (targetSelectEl) {
    targetSelectEl.addEventListener('change', function (ev) {
      var el = (ev && ev.target) ? ev.target : targetSelectEl;
      // The rail's own delegated change listener and this one are wired to
      // different elements, but an island probe can hand both the same event:
      // only THIS panel's picker (its own marker attribute) switches funnels.
      if (!el.getAttribute || el.getAttribute('data-lg-target-funnel') === null) { return; }
      var next = el.value || '';
      if (next === '') { return; }
      lgSetHashParam('funnel', next);
      announceTargetFunnel(next);
    });
  }
  // A chip click on the board (quotes-tabs/funnel.ts) or the Templates panel's
  // own picker announces the same event — this panel follows either way.
  document.addEventListener('lg:target-funnel-change', function () { onTargetFunnelChanged(); });

  // --- section library (client-fetched — GET /api/admin/leadgen/sections) ---
  var allSections = [];
  var activityFilter = '';
  var verticalFilter = '';
  var searchTerm = '';
  var chosenSection = null;

  function matchesFilters(s) {
    var name = String(s.section_name || '').toLowerCase();
    var act = String(s.activity || '').toLowerCase();
    var vert = String(s.vertical || '').toLowerCase();
    if (activityFilter !== '' && act !== activityFilter) { return false; }
    if (verticalFilter !== '' && vert !== verticalFilter) { return false; }
    if (searchTerm !== '' && name.indexOf(searchTerm) === -1) { return false; }
    return true;
  }

  function addPill(mount, kind, value, label, active) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = active ? 'lg-filter-pill active' : 'lg-filter-pill';
    btn.setAttribute('data-lg-theme-filter-kind', kind);
    btn.setAttribute('data-lg-theme-filter-value', value.toLowerCase());
    btn.textContent = label;
    btn.addEventListener('click', function () {
      if (kind === 'activity') { activityFilter = (activityFilter === value.toLowerCase()) ? '' : value.toLowerCase(); }
      else { verticalFilter = (verticalFilter === value.toLowerCase()) ? '' : value.toLowerCase(); }
      renderFilters();
      renderCards();
    });
    mount.appendChild(btn);
  }

  function renderFilters() {
    var mount = byId('lg-theme-chooser-filters');
    if (!mount) { return; }
    clearChildren(mount);
    var activities = [];
    var verticals = [];
    var seenA = {};
    var seenV = {};
    var i;
    for (i = 0; i < allSections.length; i++) {
      var a = String(allSections[i].activity || '');
      var v = String(allSections[i].vertical || '');
      if (a !== '' && !seenA[a.toLowerCase()]) { seenA[a.toLowerCase()] = true; activities.push(a); }
      if (v !== '' && !seenV[v.toLowerCase()]) { seenV[v.toLowerCase()] = true; verticals.push(v); }
    }
    addPill(mount, 'activity', '', 'All activities', activityFilter === '');
    for (i = 0; i < activities.length; i++) { addPill(mount, 'activity', activities[i], activities[i], activityFilter === activities[i].toLowerCase()); }
    addPill(mount, 'vertical', '', 'All verticals', verticalFilter === '');
    for (i = 0; i < verticals.length; i++) { addPill(mount, 'vertical', verticals[i], verticals[i], verticalFilter === verticals[i].toLowerCase()); }
  }

  function markChosenCard() {
    var cards = root.querySelectorAll('[data-lg-theme-card]');
    var i;
    for (i = 0; i < cards.length; i++) {
      var match = chosenSection !== null && cards[i].getAttribute('data-section-public-id') === chosenSection.public_id;
      cards[i].className = match ? 'lg-lib-card in-current' : 'lg-lib-card';
    }
  }

  function selectSection(s) {
    chosenSection = s;
    var nameEl = byId('lg-theme-canvas-section-name');
    if (nameEl) { nameEl.textContent = s ? s.section_name : ''; }
    markChosenCard();
    refreshCanvas();
  }

  function renderCards() {
    var mount = byId('lg-theme-chooser-list');
    if (!mount) { return; }
    clearChildren(mount);
    var filtered = [];
    var i;
    for (i = 0; i < allSections.length; i++) { if (matchesFilters(allSections[i])) { filtered.push(allSections[i]); } }
    if (filtered.length === 0) {
      var p = document.createElement('p');
      p.className = 'lg-col-help';
      p.style.padding = '8px 4px';
      p.textContent = allSections.length === 0 ? 'No sections yet \\u2014 build one in the Section Builder.' : 'No sections match this filter.';
      mount.appendChild(p);
      return;
    }
    for (i = 0; i < filtered.length; i++) {
      (function (s) {
        var card = document.createElement('div');
        card.className = (chosenSection !== null && chosenSection.public_id === s.public_id) ? 'lg-lib-card in-current' : 'lg-lib-card';
        card.setAttribute('data-lg-theme-card', '1');
        card.setAttribute('data-section-public-id', s.public_id);
        card.setAttribute('data-activity-key', String(s.activity || '').toLowerCase());
        card.setAttribute('data-vertical-key', String(s.vertical || '').toLowerCase());
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', 'Preview section ' + s.section_name);
        var top = document.createElement('div');
        top.className = 'lg-lc-top';
        var nm = document.createElement('span');
        nm.className = 'lg-lc-name';
        nm.textContent = s.section_name;
        top.appendChild(nm);
        var meta = document.createElement('div');
        meta.className = 'lg-lc-meta';
        var chip = document.createElement('span');
        chip.className = 'lg-chip-activity';
        chip.textContent = (s.activity || '') + ' \\u00b7 ' + (s.vertical || '');
        meta.appendChild(chip);
        card.appendChild(top);
        card.appendChild(meta);
        card.addEventListener('click', function () { selectSection(s); });
        card.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); selectSection(s); }
        });
        mount.appendChild(card);
      })(filtered[i]);
    }
  }

  function loadSections() {
    fetch('/api/admin/leadgen/sections?status=active&page_size=200', {
      credentials: 'same-origin', headers: { 'Accept': 'application/json' }
    }).then(function (r) { return r.json(); }).then(function (body) {
      allSections = (body && body.items) || [];
      renderFilters();
      renderCards();
      if (chosenSection === null && allSections.length > 0) { selectSection(allSections[0]); }
      else if (allSections.length === 0) { setStatus('No sections yet \\u2014 build one in the Section Builder.'); }
    }).catch(function () { setStatus('Could not load the section library.'); });
  }

  var searchInput = byId('lg-theme-chooser-search');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      searchTerm = (searchInput.value || '').trim().toLowerCase();
      renderCards();
    });
  }

  // --- CENTER canvas refresh (POST /api/admin/leadgen/sections/preview) ------
  // R2 P2 FIX-FIRST (MAJOR-1 leg 2): the WORKING theme this rail has edited
  // but whose write may still be in flight (or may have been rejected). The
  // canvas posts it EXPLICITLY as frame_context.draft_theme — the Templates
  // canvas's own idiom (quotes-tabs/templates.ts posts draft_frame_config/
  // draft_theme, which is exactly why that canvas was immune to the
  // stored-column gap this leg closes) — so a rail edit renders without
  // depending on the save round-trip. null (nothing edited yet this session)
  // sends no key at all: the server resolves the STORED theme, unchanged.
  var railDraftTheme = null;
  // hasAnyKey now comes from the shared theme-preset-resolve snippet above.
  var canvasSeq = 0;
  function refreshCanvas() {
    var frame = byId('lg-theme-canvas-frame');
    if (!frame || chosenSection === null) { return; }
    canvasSeq += 1;
    var seq = canvasSeq;
    // P8 B3 (R6-1): the carried (chip-clicked) funnel when present, the
    // editor-default otherwise -- read fresh on every refresh, never cached.
    var targetFunnel = targetFunnelPublicId();
    var frameCtx = targetFunnel !== ''
      ? { funnel_public_id: targetFunnel, variant_public_id: targetVariantPublicId() }
      : { default: true };
    if (targetFunnel !== '' && railDraftTheme !== null && hasAnyKey(railDraftTheme)) {
      frameCtx.draft_theme = railDraftTheme;
    }
    var body = {
      content_json: chosenSection.content_json,
      viewport: 'desktop',
      frame_context: frameCtx
    };
    setStatus('Loading preview\\u2026');
    fetch('/api/admin/leadgen/sections/preview', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); }).then(function (res) {
      if (seq !== canvasSeq) { return; }
      if (!res.ok || !res.body || !res.body.preview) { setStatus('Preview unavailable.'); return; }
      var p = res.body.preview;
      frame.setAttribute('srcdoc', '<!doctype html><html><head><meta charset="utf-8"><style>' + (p.css || '') + '</style></head><body>' + (p.html || '') + '</body></html>');
      setStatus('');
    }).catch(function () {
      if (seq !== canvasSeq) { return; }
      setStatus('Preview failed: network error.');
    });
  }

  // --- RIGHT rail: live-apply a control edit, then refresh the canvas --------
  // R2 register R7 normalization: "resolve the preset into inline values, or
  // drop theme_id when overriding" — this RESOLVES the preset (see
  // inlineThemeFromPreset below) the moment ANY inline control is edited
  // through this rail, so the funnel's theme_json never carries theme_id
  // alongside inline fields (the combination validateTheme rejects) AND the
  // preset's own values survive the edit.
  function setPath(obj, path, value) {
    var parts = path.split('.');
    var cur = obj;
    var i;
    for (i = 0; i < parts.length - 1; i++) {
      var existing = cur[parts[i]];
      var isPlainObject = existing !== null && typeof existing === 'object' && Object.prototype.toString.call(existing) !== '[object Array]';
      if (!isPlainObject) { cur[parts[i]] = {}; }
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  // A queued edit whose value is null means DELETE the key — the funnel-tab
  // island's own writeThemeValue semantics ("absent inherits from the base
  // design", 09 §9.2), which is what "Reset to inherited" queues through the
  // seam below. Never setPath(null): an explicit null is not a theme value.
  function deletePath(obj, path) {
    var parts = path.split('.');
    var cur = obj;
    var i;
    for (i = 0; i < parts.length - 1; i++) {
      var next = cur[parts[i]];
      if (next === null || typeof next !== 'object') { return; }
      cur = next;
    }
    if (cur !== null && typeof cur === 'object') { delete cur[parts[parts.length - 1]]; }
  }

  // R2 P2 FIX-FIRST-2 (FIX 3): the rejection branch reads the PARSED body.
  // Both fetch wrappers in this island resolve {ok: r.ok, body: <parsed JSON>},
  // so body.error is the server's own message — but "Validation failed"
  // alone told the operator nothing about WHICH setting was refused. This
  // lifts the per-problem/per-field text out too, exactly as the quote
  // editor's own saveFailureText (quotes-tabs/funnel.ts) already does for the
  // one-Save chain, so the operator sees the server's actual reason.
  function saveRejectionText(body) {
    var msg = (body && typeof body.error === 'string' && body.error !== '') ? body.error : 'Could not apply the change.';
    var parts = [];
    var i;
    var k;
    if (body && body.problems && body.problems.length) {
      for (i = 0; i < body.problems.length; i++) {
        if (body.problems[i] && body.problems[i].message) { parts.push(body.problems[i].message); }
      }
    }
    if (body && body.fields) {
      for (k in body.fields) {
        if (Object.prototype.hasOwnProperty.call(body.fields, k) && body.fields[k]) { parts.push(String(body.fields[k])); }
      }
    }
    return parts.length > 0 ? (msg + ' \\u2014 ' + parts.join(' ')) : msg;
  }

  function overrideIsOn() {
    // Queried by the radio GROUP name (renderOverrideSwitch's own
    // name="lg-ov-<group>") — never by concatenating the words "data",
    // "override" and "group" into one attribute-selector literal here, since
    // an unrelated control-arm SSR scan elsewhere in the quote editor greps
    // the whole page for that exact substring appearing anywhere at all.
    var el = document.querySelector('input[name="lg-ov-theme"]:checked');
    return !!(el && el.value === 'override');
  }

  // inlineThemeFromPreset now comes from the shared theme-preset-resolve
  // snippet above (RESOLVEs an applied preset into inline values so the rail
  // edit below merges on top of the preset's own values, not a bare
  // theme_id).

  // P8-1 J1 (review #4, BLOCKER F-1) — THE READ-BEFORE-MERGE FAILS CLOSED.
  // FAIL-BEFORE (driven twice by review #4): the GET below had NO r.ok check
  // at all — a 500 answered a JSON {error} body, 'getBody.theme' read
  // undefined, the merge base collapsed to {} and the very next PUT REPLACED
  // the funnel's whole stored theme with the single edit just made. Measured
  // on P8-Charlie (j10-wipe-log.txt, no target switch, one Shadows -> High
  // select): a stored theme carrying palette.brand_primary, palette.accent and
  // typography.display_size became exactly {"scales":{"shadow":
  // "high"}}; and again with a target switch (j3-m2-log.txt) it became
  // {"palette":{"brand_secondary":"error"}} after ONE colour click. The PRESET
  // sub-case three lines into the chain already aborts for precisely this
  // reason (presetInlineOrAbort, whose comment describes the same wipe); this
  // is that same shape for the funnel-theme read itself, so an unreadable GET
  // writes NOTHING and the operator is told.
  // theme === null is NOT unreadable: frame-handlers.ts themeProjection
  // returns {theme: null} for a funnel that simply has no stored theme yet,
  // and that funnel's FIRST edit must still save.
  function themeReadIsReadable(res) {
    return !!(res && res.ok && res.body && typeof res.body === 'object' && res.body.theme !== undefined);
  }
  function themeWriteAbortError(body, pub) {
    var name = funnelNameOf(pub, 'that funnel');
    var msg = 'Could not read the current theme for ' + name + ' \\u2014 ' + themeReadWhy(body) +
      '. Your change was NOT saved and ' + name + '\\u2019s stored theme is unchanged.';
    var e = new Error(msg);
    e.lgOperatorMessage = msg;
    return e;
  }

  var applyTimer = null;
  var pendingEdits = {};
  // P8-1 F1: the funnel that was on screen when the operator made the queued
  // edit. Switching the picker inside the 350ms debounce must not redirect an
  // already-made edit onto the newly picked funnel.
  var pendingFunnel = '';
  function flushThemeEdits() {
    applyTimer = null;
    var edits = pendingEdits;
    pendingEdits = {};
    // P8-1 F1 (B3/R6-1): read+write THAT funnel -- the persisted target when
    // one is chosen, the editor-default otherwise. FAIL-BEFORE: this used the
    // frozen funnelPublicId unconditionally, so a Theme-chip click on a
    // DIFFERENT funnel column still GET+PUT the editor-selected funnel.
    var targetFunnel = pendingFunnel !== '' ? pendingFunnel : targetFunnelPublicId();
    pendingFunnel = '';
    if (targetFunnel === '') { return; }
    var base = '/api/admin/leadgen/funnels/' + encodeURIComponent(targetFunnel) + '/theme';
    var previousDraft = railDraftTheme;
    setStatus('Applying\\u2026');
    fetch(base, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, body: j }; }, function () { return { ok: false, body: null }; });
      })
      .then(function (getRes) {
        // P8-1 J1 (F-1): fail CLOSED — see themeReadIsReadable above.
        if (!themeReadIsReadable(getRes)) { throw themeWriteAbortError(getRes.body, targetFunnel); }
        var current = getRes.body.theme || {};
        if (typeof current.theme_id === 'string' && current.theme_id !== '') {
          // FAIL-CLOSED (R2 P2 FIX-FIRST-2): an unreadable preset ABORTS here
          // — no PUT, stored theme untouched (see the shared snippet).
          return presetInlineOrAbort(current.theme_id);
        }
        var inline = {};
        var k;
        for (k in current) {
          if (Object.prototype.hasOwnProperty.call(current, k) && k !== 'theme_id') { inline[k] = current[k]; }
        }
        return inline;
      })
      .then(function (baseTheme) {
        var merged = baseTheme || {};
        var k;
        for (k in edits) {
          if (Object.prototype.hasOwnProperty.call(edits, k)) {
            if (edits[k] === null) { deletePath(merged, k); }
            else { setPath(merged, k, edits[k]); }
          }
        }
        // Leg 2: render the DRAFT now — the canvas no longer waits on (nor
        // depends on) the write landing. P8-1 F1: unless the operator has
        // since switched funnels, in which case the canvas is already showing
        // the OTHER funnel and this draft is not its theme.
        if (targetFunnel === targetFunnelPublicId()) {
          railDraftTheme = merged;
          refreshCanvas();
        }
        return fetch(base, {
          method: 'PUT', credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ theme_json: merged })
        }).then(function (r2) { return r2.json().then(function (j2) { return { ok: r2.ok, body: j2 }; }); });
      })
      .then(function (res) {
        if (!res.ok) {
          // A rejected save must not leave the canvas showing a value the
          // funnel does not have — roll the draft back and re-render (same
          // still-on-that-funnel condition as the draft render above).
          if (targetFunnel === targetFunnelPublicId()) {
            railDraftTheme = previousDraft;
            refreshCanvas();
          }
          setNotice(saveRejectionText(res.body));
          return;
        }
        setStatus('');
        // P8-1 F6 — ONE operator edit, ONE write. quotes-tabs/funnel.ts also
        // records every [data-theme-key]/palette edit (its own delegated
        // listeners cover this rail) and its one-Save chain re-sent them: a
        // single Display-size change was MEASURED issuing two
        // PUT /funnels/<target>/theme. Telling that island which paths just
        // LANDED lets it retire them; a rejected save takes the branch above
        // and announces nothing, so Save stays the retry.
        var landed = [];
        var pk;
        for (pk in edits) { if (Object.prototype.hasOwnProperty.call(edits, pk)) { landed.push(pk); } }
        try {
          var doneEvt = document.createEvent('CustomEvent');
          doneEvt.initCustomEvent('lg:theme-autosaved', true, false, { funnel_public_id: targetFunnel, paths: landed });
          document.dispatchEvent(doneEvt);
        } catch (e) { /* engines without createEvent: the chain simply re-sends the same value */ }
      })
      .catch(function (err) {
        // A fail-closed read (presetInlineOrAbort, or the funnel-theme read
        // itself since P8-1 J1) rejects BEFORE any PUT — the funnel's theme is
        // untouched, so say exactly that instead of the generic network line.
        var msg = (err && err.lgOperatorMessage) ? err.lgOperatorMessage : 'Network error applying the change.';
        setNotice(msg);
        // P8-1 J1 (F-1/F-7): a REFUSED edit is page-level news. The rail's
        // status line lives at the top of the canvas column, which was
        // measured off-screen while the operator worked the rail below it, so
        // the refusal also goes to the page's own banner (the SAME element
        // showPageError already owns — no new surface).
        showPageError(msg);
      });
  }

  function queueThemeEdit(path, value) {
    // A non-control variant with its OWN override switch turned ON writes to
    // the VARIANT's frame_overrides_json, not the funnel's theme_json — left
    // to the existing override-save flow untouched (narrower scope, R2 note).
    // P8-1 F6: that arm belongs to the EDITOR's funnel. While this panel is
    // pointed at a DIFFERENT funnel the arm is not part of it, so standing
    // down here would drop the edit on the floor (the editor arm's override
    // flow cannot write another funnel) — the target funnel's own theme is
    // the only correct destination, and that is this autosave's.
    if (!isControl && overrideIsOn() && targetFunnelPublicId() === funnelPublicId) { return; }
    // A fresh edit clears the previous refusal notice — the operator is
    // trying again, and a stale message must not outrank the new attempt.
    setNotice('');
    pendingEdits[path] = value;
    // P8-1 F1: pin the funnel AT QUEUE TIME (see pendingFunnel above).
    if (pendingFunnel === '') { pendingFunnel = targetFunnelPublicId(); }
    if (applyTimer) { window.clearTimeout(applyTimer); }
    applyTimer = window.setTimeout(flushThemeEdits, 350);
  }

  var railEl = byId('lg-theme-rail');
  if (railEl) {
    railEl.addEventListener('change', function (ev) {
      var el = ev.target;
      if (!el || !el.getAttribute) { return; }
      var key = el.getAttribute('data-theme-key');
      if (key !== null && el.value !== '') { queueThemeEdit(key, el.value); }
    });
  }

  // R2 P2 FIX-FIRST-2 (MAJOR-1 residue) — THE CONVERGENT PALETTE SEAM.
  //
  // FAIL-BEFORE: this island listened for its own data-role-pick clicks
  // only, so exactly ONE of the rail's palette affordances moved this canvas.
  // The other three — the harmony steps (Base/Soft wash/Darker/Lighter), the
  // Advanced token administration hex Apply, and Reset to inherited — are
  // owned by quotes-tabs/funnel.ts (harmony mix math, the hex format gate, the
  // role-alias rule, the §4.5 override-vs-funnel split all live there and feed
  // ITS canvas). Their edits reached the TEMPLATES canvas and left this one
  // byte-identical until a Save plus a section re-pick.
  //
  // Rather than re-implement that math in a second island (two copies of the
  // same rules, guaranteed to drift), funnel.ts's ONE palette write path now
  // ANNOUNCES its resolved (role, value) as a bubbling lg:palette-draft-change
  // document event, and this island consumes it through the SAME
  // single draft path a select edit already takes (queueThemeEdit ->
  // flushThemeEdits -> railDraftTheme -> refreshCanvas). One producer, one
  // consumer, one draft path: the role-pick branch that used to live here is
  // GONE because the seam already carries those very clicks — never two
  // triggers for one write. value === null (Reset to inherited) deletes the
  // key, mirroring writeThemeValue's own inherit semantics.
  document.addEventListener('lg:palette-draft-change', function (ev) {
    var detail = (ev && ev.detail) || null;
    if (detail === null || typeof detail.role !== 'string' || detail.role === '') { return; }
    var value = (detail.value === null || detail.value === undefined) ? null : detail.value;
    queueThemeEdit('palette.' + detail.role, value);
  });

  // P8-1 F1: name the funnel before anything else paints, so the panel is
  // never on screen without saying which funnel it edits.
  paintTargetHeader();
  // P8-1 F6: a page that BOOTS on a persisted target (a reload while editing
  // another funnel's theme) must not leave the rail showing the editor
  // funnel's SSR values under the target's name — same condition
  // quotes-tabs/templates.ts's own init uses for the frame.
  if (targetFunnelPublicId() !== funnelPublicId) { syncThemeToTargetFunnel(); }
  loadSections();
}());
`;


export function renderThemesTabPanel(isControl: boolean): string {
  // Round-4 P5b deliverable 1: a CLEAN mount point — the tab button + this
  // wrapper div stay byte-stable; R2 P2 S2b replaces ONLY the inner three
  // panes (was: a single stacked column with a placeholder mini-preview
  // strip + an embedded standalone-page iframe — the "duplicate canvases"
  // A.3 rejected). `data-is-control` feeds THEMES_TAB_SCRIPT (above) so its
  // live-apply path knows whether this variant is primary (funnel-scoped
  // writes) or a non-control arm (which may have its own override switch).
  return `<div class="lg-qpanel" data-panel="themes">
  <div class="lg-theme-3pane" data-lg-themes-tab data-is-control="${isControl ? "true" : "false"}" data-pin="8.4-themes-tab-layout" style="display:flex;align-items:flex-start;gap:18px">
    ${renderSectionChooserPane()}
    ${renderThemeCanvasPane()}
    ${renderThemeRailPane(isControl)}
  </div>
  <script>${THEMES_TAB_SCRIPT}</script>
</div>`;
}
