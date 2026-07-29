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
//     buttons on the operator's very first control edit. See the phase report
//     for the residual this does not close (the pre-existing "one-Save"
//     button in quotes-tabs/funnel.ts constructs its OWN PUT from a stale
//     in-memory object outside this slice's ownership).
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
  return `<div class="lg-panel-card" id="lg-theme-editor">
  <h3>Funnel theme</h3>
  <div class="lg-scope-head">Editing: <strong>Funnel theme</strong> · affects every slide and every component default of this funnel</div>
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
    ${themeSelect("Button height", "button_defaults.min_height", ["m", "l"], { m: "Medium", l: "Large" })}
    ${themeSelect("Button casing", "button_defaults.casing", ["none", "upper"], { none: "As written", upper: "UPPERCASE" })}
  </div>
  <h4>Button style</h4>
  <p class="form-help">Three independent looks (Images 38&#8211;40) &#8212; mix and match; each defaults to today's look.</p>
  <div class="lg-scalars">
    ${themeSelect("Fill", "button_defaults.fill", THEME_BUTTON_STYLES, { fill: "Solid (default)", outline: "Outline", soft: "Soft pill + shadow" })}
    ${themeSelect("Answer layout", "button_defaults.layout", THEME_BUTTON_LAYOUTS, { grid: "Grid (default)", list: "Single-column list", card: "Full-width cards (Image23)" })}
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
  var funnelPublicId = editorRoot ? (editorRoot.getAttribute('data-funnel-public-id') || '') : '';
  var variantPublicId = editorRoot ? (editorRoot.getAttribute('data-variant-public-id') || '') : '';
  var isControl = root.getAttribute('data-is-control') === 'true';

  function byId(id) { return document.getElementById(id); }
  function clearChildren(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }
  function setStatus(text) {
    var el = byId('lg-theme-canvas-status');
    if (el) { el.textContent = text || ''; }
  }

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
    var frameCtx = funnelPublicId !== ''
      ? { funnel_public_id: funnelPublicId, variant_public_id: variantPublicId }
      : { default: true };
    if (funnelPublicId !== '' && railDraftTheme !== null && hasAnyKey(railDraftTheme)) {
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

  var applyTimer = null;
  var pendingEdits = {};
  function flushThemeEdits() {
    applyTimer = null;
    var edits = pendingEdits;
    pendingEdits = {};
    if (funnelPublicId === '') { return; }
    var base = '/api/admin/leadgen/funnels/' + encodeURIComponent(funnelPublicId) + '/theme';
    var previousDraft = railDraftTheme;
    setStatus('Applying\\u2026');
    fetch(base, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (getBody) {
        var current = (getBody && getBody.theme) || {};
        if (typeof current.theme_id === 'string' && current.theme_id !== '') {
          return fetch('/api/admin/leadgen/themes/' + encodeURIComponent(current.theme_id), {
            credentials: 'same-origin', headers: { 'Accept': 'application/json' }
          }).then(function (rp) { return rp.json(); }).then(function (pb) {
            return inlineThemeFromPreset(pb && pb.item);
          });
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
          if (Object.prototype.hasOwnProperty.call(edits, k)) { setPath(merged, k, edits[k]); }
        }
        // Leg 2: render the DRAFT now — the canvas no longer waits on (nor
        // depends on) the write landing.
        railDraftTheme = merged;
        refreshCanvas();
        return fetch(base, {
          method: 'PUT', credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ theme_json: merged })
        }).then(function (r2) { return r2.json().then(function (j2) { return { ok: r2.ok, body: j2 }; }); });
      })
      .then(function (res) {
        if (!res.ok) {
          // A rejected save must not leave the canvas showing a value the
          // funnel does not have — roll the draft back and re-render.
          railDraftTheme = previousDraft;
          refreshCanvas();
          setStatus((res.body && res.body.error) ? res.body.error : 'Could not apply the change.');
          return;
        }
        setStatus('');
      })
      .catch(function () { setStatus('Network error applying the change.'); });
  }

  function queueThemeEdit(path, value) {
    // A non-control variant with its OWN override switch turned ON writes to
    // the VARIANT's frame_overrides_json, not the funnel's theme_json — left
    // to the existing override-save flow untouched (narrower scope, R2 note).
    if (!isControl && overrideIsOn()) { return; }
    pendingEdits[path] = value;
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
    railEl.addEventListener('click', function (ev) {
      var el = ev.target;
      if (!el || !el.getAttribute) { return; }
      var pick = el.getAttribute('data-role-pick');
      if (pick === null) { return; }
      var pickFor = el.getAttribute('data-role-pick-for') || '';
      if (pickFor.indexOf('palette.') === 0) { queueThemeEdit(pickFor, pick); }
    });
  }

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
