// LeadGen admin UI — shared ES5 island snippet: RESOLVE an applied theme
// preset into inline theme_json values.
//
// R2 P2 tail (item 2): closes the R7 residual quotes-tabs/themes.ts's own
// THEMES_TAB_SCRIPT header documented but explicitly left open — "the
// pre-existing 'one-Save' button in quotes-tabs/funnel.ts constructs its OWN
// PUT from a stale in-memory object outside this slice's ownership." R2 P2
// FIX-FIRST (MINOR-1) upgraded themes.ts's rail-edit save (flushThemeEdits)
// from R7's "drop theme_id, lose the preset" branch to this one: RESOLVE the
// theme_id pointer into the preset's own inline values BEFORE merging the
// edit, so the preset's palette/typography/buttons survive. This module
// extracts that resolve step (inlineThemeFromPreset + its bridge constants)
// out of themes.ts so quotes-tabs/funnel.ts's own one-Save theme path
// (normalizedThemePut) can reuse the IDENTICAL algorithm instead of a
// hand-copied duplicate.
//
// Client-side islands (THEMES_TAB_SCRIPT / QUOTE_EDITOR_SCRIPT) are each
// their OWN independent <script> — a served page has no shared JS module
// scope between the two — so this cannot be a normal function import at
// runtime. Instead this exports the ES5 SOURCE TEXT (a template literal
// string) that both islands' own template literals interpolate directly
// into their own IIFE, giving both a byte-identical copy of the algorithm
// compiled from ONE TypeScript source, never two hand-maintained copies.
// Strict ES5 (var/function only — no arrow/const/let/backtick/async/spread/
// destructure/optional-chaining), matching every other island in this file
// family.
//
// Declares, in the including IIFE's scope: PRESET_ROLE_BRIDGE,
// PRESET_EXTRA_ROLE_BRIDGE, hasAnyKey(o), inlineThemeFromPreset(rec).
import {
  THEME_RECORD_EXTRA_ROLE_TO_TOKEN_ROLE,
  THEME_RECORD_ROLE_TO_TOKEN_ROLE,
} from "../../../public/leadgen/designs/theme";

export function themePresetResolveSnippet(): string {
  return `
  // The record-role -> FunnelTokenRole bridges, SERIALIZED FROM THE SAME
  // compile-checked constants resolveTokens itself applies (designs/
  // theme.ts THEME_RECORD_ROLE_TO_TOKEN_ROLE + THEME_RECORD_EXTRA_ROLE_TO_
  // TOKEN_ROLE) — never a hand-copied table here, so a renamed role can
  // never drift between the preset resolver and this island (a rename is a
  // compile error at this shared module's import above).
  var PRESET_ROLE_BRIDGE = ${JSON.stringify(THEME_RECORD_ROLE_TO_TOKEN_ROLE)};
  var PRESET_EXTRA_ROLE_BRIDGE = ${JSON.stringify(THEME_RECORD_EXTRA_ROLE_TO_TOKEN_ROLE)};
  function hasAnyKey(o) {
    var k;
    for (k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { return true; } }
    return false;
  }
  // RESOLVE an applied preset into inline values. Deliberately NOT mapped (no
  // faithful 1:1 exists — mapping them would INVENT values rather than
  // preserve the preset's): typography.headline_font/body_font (a record's
  // font vocabulary is Inter/Newsreader/Roboto Mono; inline typography.
  // display/body is the literata/sora/... set) and controls.field_height/
  // button_size/corners (corners is sharp|rounded|pill vs the inline radius
  // scale sharp|soft|round). Those keep resolving from the base design,
  // exactly as they did before this resolve step existed.
  function inlineThemeFromPreset(rec) {
    var out = {};
    var palette = {};
    var k;
    var roles = (rec && rec.roles) || {};
    for (k in PRESET_ROLE_BRIDGE) {
      if (Object.prototype.hasOwnProperty.call(PRESET_ROLE_BRIDGE, k) && typeof roles[k] === 'string' && roles[k] !== '') {
        palette[PRESET_ROLE_BRIDGE[k]] = roles[k];
      }
    }
    var extra = (rec && rec.extra_roles) || {};
    for (k in PRESET_EXTRA_ROLE_BRIDGE) {
      if (Object.prototype.hasOwnProperty.call(PRESET_EXTRA_ROLE_BRIDGE, k) && typeof extra[k] === 'string' && extra[k] !== '') {
        palette[PRESET_EXTRA_ROLE_BRIDGE[k]] = extra[k];
      }
    }
    if (hasAnyKey(palette)) { out.palette = palette; }
    var bstyle = (rec && rec.button_style) || null;
    if (bstyle) {
      var bd = {};
      if (bstyle.fill) { bd.fill = bstyle.fill; }
      if (bstyle.layout) { bd.layout = bstyle.layout; }
      if (bstyle.selected) { bd.selected = bstyle.selected; }
      if (hasAnyKey(bd)) { out.button_defaults = bd; }
    }
    var typ = (rec && rec.typography) || null;
    if (typ && typ.display_size) { out.typography = { display_size: typ.display_size }; }
    return out;
  }
`;
}
