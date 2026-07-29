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
// PRESET_EXTRA_ROLE_BRIDGE, PRESET_FONT_BRIDGE, hasAnyKey(o),
// inlineThemeFromPreset(rec), PRESET_LOAD_FAILED_MESSAGE,
// presetInlineOrAbort(themeId).
import {
  THEME_FONT_IDS,
  THEME_FONT_STACKS,
  THEME_RECORD_EXTRA_ROLE_TO_TOKEN_ROLE,
  THEME_RECORD_FONT_NAMES,
  THEME_RECORD_FONT_STACKS,
  THEME_RECORD_ROLE_TO_TOKEN_ROLE,
} from "../../../public/leadgen/designs/theme";

// R2 P2 FIX-FIRST-2 (MINOR residue): the record-font-name -> inline-font-id
// bridge, DERIVED (never hand-typed) from the two compile-checked stack
// tables. theme.ts's own THEME_RECORD_FONT_STACKS comment states the P6
// widening REUSES THEME_FONT_STACKS' values verbatim so "the record path and
// the inline path produce byte-IDENTICAL stack strings for the same family" —
// so string equality of the two CSS stacks IS the exact-counterpart test. A
// family present on both sides pairs automatically (add one to both tables and
// it maps itself); a record-only family (its stack exists nowhere in
// THEME_FONT_STACKS) is simply absent here and keeps resolving from the base
// design.
function recordFontToInlineId(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of THEME_RECORD_FONT_NAMES) {
    const stack = THEME_RECORD_FONT_STACKS[name];
    for (const id of THEME_FONT_IDS) {
      if (THEME_FONT_STACKS[id] === stack) {
        out[name] = id;
        break;
      }
    }
  }
  return out;
}

// The record font families with NO inline counterpart, computed from the same
// derivation — so the honest in-code line below can never name a stale set.
function unmappableFontNames(): readonly string[] {
  const bridge = recordFontToInlineId();
  return THEME_RECORD_FONT_NAMES.filter((n) => bridge[n] === undefined);
}

export function themePresetResolveSnippet(): string {
  const fontBridge = recordFontToInlineId();
  const unmappable = unmappableFontNames()
    .map((n) => `"${n}"`)
    .join("/");
  return `
  // The record-role -> FunnelTokenRole bridges, SERIALIZED FROM THE SAME
  // compile-checked constants resolveTokens itself applies (designs/
  // theme.ts THEME_RECORD_ROLE_TO_TOKEN_ROLE + THEME_RECORD_EXTRA_ROLE_TO_
  // TOKEN_ROLE) — never a hand-copied table here, so a renamed role can
  // never drift between the preset resolver and this island (a rename is a
  // compile error at this shared module's import above).
  var PRESET_ROLE_BRIDGE = ${JSON.stringify(THEME_RECORD_ROLE_TO_TOKEN_ROLE)};
  var PRESET_EXTRA_ROLE_BRIDGE = ${JSON.stringify(THEME_RECORD_EXTRA_ROLE_TO_TOKEN_ROLE)};
  // Record font family -> inline THEME_FONT_IDS id, derived at compile time
  // from the two byte-identical CSS-stack tables (see this module's
  // recordFontToInlineId above) — the 8 self-hosted families pair exactly.
  var PRESET_FONT_BRIDGE = ${JSON.stringify(fontBridge)};
  function hasAnyKey(o) {
    var k;
    for (k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { return true; } }
    return false;
  }
  function presetFontId(name) {
    return (typeof name === 'string' && Object.prototype.hasOwnProperty.call(PRESET_FONT_BRIDGE, name))
      ? PRESET_FONT_BRIDGE[name] : null;
  }
  // RESOLVE an applied preset into inline values.
  //
  // R2 P2 FIX-FIRST-2 (MINOR residue): typography.headline_font/body_font DO
  // resolve now — every family whose record stack is byte-identical to an
  // inline THEME_FONT_IDS stack maps to that id (PRESET_FONT_BRIDGE above), so
  // a preset's fonts survive the operator's first control edit.
  //
  // Values with genuinely NO inline counterpart (kept resolving from the base
  // design, exactly as before this resolve step existed — mapping them would
  // INVENT a value the preset never expressed):
  //   • typography.headline_font/body_font when the family is ${unmappable} —
  //     record-only families; no THEME_FONT_IDS id produces those CSS stacks.
  //   • typography.base_px — an absolute pixel size; the inline axis
  //     (typography.size s|m|l) is a x0.9/x1/x1.1 ramp over the BASE design's
  //     tokens, so no px value maps onto it.
  //   • controls.field_height/button_size/corners — the inline theme_json
  //     vocabulary HAS no controls axis at all: theme.ts's ThemeJson declares
  //     none, validateTheme's THEME_TOP_KEYS rejects a 'controls' key outright
  //     (a 400), and EffectiveTokens.theme_controls is populated ONLY when a
  //     RECORD is present (resolveTokens: 'if (record !== null)'). These three
  //     cannot be carried by ANY inline theme_json — not a mapping choice.
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
    if (typ) {
      var tp = {};
      if (typ.display_size) { tp.display_size = typ.display_size; }
      var displayId = presetFontId(typ.headline_font);
      if (displayId !== null) { tp.display = displayId; }
      var bodyId = presetFontId(typ.body_font);
      if (bodyId !== null) { tp.body = bodyId; }
      if (hasAnyKey(tp)) { out.typography = tp; }
    }
    return out;
  }
  // R2 P2 FIX-FIRST-2 (MINOR, fail-closed): fetching the applied preset is
  // where this algorithm used to fail OPEN — 'inlineThemeFromPreset(pb &&
  // pb.item)' turned ANY non-OK / unparseable preset GET into an EMPTY preset,
  // so the caller's PUT wiped the funnel's whole look with no error at all.
  // Now a preset that cannot be read ABORTS the edit (rejects): no PUT is
  // sent, the stored theme is untouched, and the operator is told. The
  // rejection carries lgOperatorMessage so a caller can tell "the preset could
  // not be read" apart from a bare network failure.
  var PRESET_LOAD_FAILED_MESSAGE = 'Couldn\\u2019t load the preset \\u2014 the change was not applied.';
  function presetLoadError() {
    var e = new Error(PRESET_LOAD_FAILED_MESSAGE);
    e.lgOperatorMessage = PRESET_LOAD_FAILED_MESSAGE;
    return e;
  }
  function presetInlineOrAbort(themeId) {
    return fetch('/api/admin/leadgen/themes/' + encodeURIComponent(themeId), {
      credentials: 'same-origin', headers: { 'Accept': 'application/json' }
    }).then(function (rp) {
      if (!rp.ok) { throw presetLoadError(); }
      return rp.json().then(function (pb) {
        if (!pb || !pb.item) { throw presetLoadError(); }
        return inlineThemeFromPreset(pb.item);
      }, function () { throw presetLoadError(); });
    }, function () { throw presetLoadError(); });
  }
`;
}
