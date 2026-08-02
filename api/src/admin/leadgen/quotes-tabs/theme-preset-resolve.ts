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
// PRESET_EXTRA_ROLE_BRIDGE, PRESET_FONT_BRIDGE, PRESET_CORNERS_BRIDGE,
// PRESET_BUTTON_SIZE_BRIDGE, PRESET_FIELD_HEIGHT_BRIDGE, hasAnyKey(o),
// inlineThemeFromPreset(rec), PRESET_LOAD_FAILED_MESSAGE,
// presetInlineOrAbort(themeId).
import {
  THEME_FONT_IDS,
  THEME_FONT_STACKS,
  THEME_RECORD_BUTTON_SIZE_TO_INLINE_MIN_HEIGHT,
  THEME_RECORD_CORNERS_TO_RADIUS_SCALE,
  THEME_RECORD_FIELD_HEIGHT_TO_INLINE_MIN_HEIGHT,
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

// ---------------------------------------------------------------------------
// R2 F-1 FOLLOW-UP — WHY controls.corners IS CARRIED ACROSS THE FORK.
//
// This rationale lives HERE, in TypeScript, and not inside the emitted snippet
// below: the snippet is shipped verbatim into two admin pages on every load, so
// prose belongs on the compile side, not the wire.
//
// THE FORK. Inline theme_json and a {theme_id} preset are MUTUALLY EXCLUSIVE by
// construction: validateTheme rejects the combination outright ("theme_id can't
// be combined with other theme settings", a 400), and resolveTokens empties
// `theme` for a reference (isThemeIdRef) while loading `record` ONLY for a pure
// reference. So the operator's first Themes-rail edit converts theme_json from
// a pointer into inline values, and the record leaves resolution for good.
// Every preset value this resolver does not carry is SILENTLY LOST at that
// instant — the exact class of defect the owner has rejected repeatedly.
//
// THE MEASURED LOSS (live visitor page, both arms, driven through the real
// Themes manager + the real rail): apply a PILL preset -> painted card/answer/
// continue 20/14/14; then edit ONE unrelated rail control (a colour) -> 16/10/
// 10. Sharp: 10/6/6 -> 16/10/10. The stored theme_json went from
// {"theme_id":"thm_..."} to {"palette":{...}} with no corner value anywhere.
// The operator changed a colour and lost their corner shape, with nothing said.
//
// WHY IT IS FIXABLE NOW. Until F-1 the honest line in this module was that
// controls.corners "cannot be carried by ANY inline theme_json — not a mapping
// choice", because the inline vocabulary had no controls axis. F-1
// (THEME_RECORD_CORNERS_TO_RADIUS_SCALE in designs/theme.ts) gave the record's
// corner words an exact counterpart in the §9.3 radius SCALE —
// sharp/rounded/pill -> sharp/soft/round — so corners now has precisely the
// "byte-identical counterpart" property the font bridge above relies on. That
// sentence is therefore no longer true of corners, and has been corrected.
//
// WHY CARRY AT THE FORK, rather than keep the record alive beside the inline
// overrides: the mutual exclusivity above is an INVARIANT of both the validator
// and the resolver, so blending them would mean inventing a record-vs-inline
// precedence — a SECOND corner mechanism that would drift from applyRadiusScale
// the first time either ladder moved, and would resurrect the very trap F-1
// closed. Translating the record's word into the inline word it already equals
// keeps ONE derivation (applyRadiusScale) for both paths and adds no new
// resolution rule: after the fork the funnel is a plain inline theme like any
// other.
//
// ---------------------------------------------------------------------------
// R2 F-3 — …AND WHY controls.field_height AND controls.button_size ARE NOW
// CARRIED TOO. This paragraph REPLACES this module's previous closing sentence,
// "field_height/button_size stay uncarried for the original reason — unlike
// corners they have no equivalent inline axis to be translated INTO." That
// sentence was true of the vocabulary as it stood and false as a resting place:
// closing only the reported arm of a defect class and leaving its twins is the
// same silent loss the owner rejected in ADJ-A7, P5-F11 and P6-FIX-1.
//
// THE MEASURED LOSS (live visitor page, real Themes manager + real rail, both
// arms — docs/leadgen/r2/evidence/p7-owner/fork-survival/measurements.txt):
// apply a preset with Field height = Large, Button size = L and Corners = Pill
// -> painted field min-height 60px (box 60px), button min-height 60px, card
// radius 20px. Then click ONE colour in the rail -> field min-height 44px (box
// 54px), button min-height 52px; corners held at 20px (the F-1 carry working).
// The stored theme_json went from {"theme_id":…} to a palette + scales.radius
// object with no size anywhere. The operator changed a colour and lost both
// sizes, with nothing said.
//
// WHAT CHANGED SO THEY CAN BE CARRIED: designs/theme.ts now gives each of them
// the inline axis it lacked — `button_defaults.min_height` WIDENED from ["m","l"]
// to the full shared s/m/l ladder, and a new `field_defaults.min_height`
// (small/medium/large), both validated by validateTheme and both offered on the
// rail. Each inline vocabulary is deliberately spelled in the RECORD's own
// words, so the bridges below are compile-checked IDENTITIES
// (THEME_RECORD_*_TO_INLINE_MIN_HEIGHT, `satisfies`-pinned at their
// declaration) — exactly the "byte-identical counterpart" property the font and
// corners bridges rely on, and the SAME single carry idiom, not a second
// mechanism. Nothing in ThemeRecordControls is uncarried now.
//
// STILL NOT CARRIED, and honestly so: the record-only font families (the ones
// unmappableFontNames() computes) and typography.base_px — those genuinely have
// no inline counterpart.
// ---------------------------------------------------------------------------
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
  // R2 F-1 follow-up: the record's controls.corners -> inline scales.radius,
  // SERIALIZED from the same compile-checked table resolveTokens reads on the
  // preset path (theme.ts THEME_RECORD_CORNERS_TO_RADIUS_SCALE), so the two
  // corner ladders can never drift apart.
  var PRESET_CORNERS_BRIDGE = ${JSON.stringify(THEME_RECORD_CORNERS_TO_RADIUS_SCALE)};
  // R2 F-3: button_size -> button_defaults.min_height, field_height ->
  // field_defaults.min_height — SERIALIZED from the same satisfies-pinned
  // tables designs/theme.ts declares (rationale in this module's TS comment).
  var PRESET_BUTTON_SIZE_BRIDGE = ${JSON.stringify(THEME_RECORD_BUTTON_SIZE_TO_INLINE_MIN_HEIGHT)};
  var PRESET_FIELD_HEIGHT_BRIDGE = ${JSON.stringify(THEME_RECORD_FIELD_HEIGHT_TO_INLINE_MIN_HEIGHT)};
  function hasAnyKey(o) {
    var k;
    for (k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { return true; } }
    return false;
  }
  function presetFontId(name) {
    return (typeof name === 'string' && Object.prototype.hasOwnProperty.call(PRESET_FONT_BRIDGE, name))
      ? PRESET_FONT_BRIDGE[name] : null;
  }
  // RESOLVE an applied preset into inline values. The operator's first rail
  // edit FORKS theme_json from a {theme_id} pointer into inline values, and
  // the record then drops out of resolution entirely — so anything NOT carried
  // across this fork is silently lost. Carried: palette, button_style,
  // display_size, the mappable fonts, and — as their exact inline counterparts
  // — ALL THREE of ThemeRecordControls: corners -> scales.radius (R2 F-1),
  // button_size -> button_defaults.min_height and field_height ->
  // field_defaults.min_height (R2 F-3). Deliberately NOT carried, because no
  // inline axis expresses them: the ${unmappable} font families and
  // typography.base_px. Full rationale in this module's TypeScript comment.
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
    var bd = {};
    if (bstyle) {
      if (bstyle.fill) { bd.fill = bstyle.fill; }
      if (bstyle.layout) { bd.layout = bstyle.layout; }
      if (bstyle.selected) { bd.selected = bstyle.selected; }
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
    // R2 F-1 FOLLOW-UP — carry the preset's Corners across the fork, as the
    // inline word for the same shape (PRESET_CORNERS_BRIDGE above). A record
    // ALWAYS carries a corners value (the manager's own default is 'rounded'),
    // and 'rounded' -> 'soft' is the identity resolveTokens already defaulted
    // to, so pinning it explicitly is byte-identical in paint while making the
    // operator's actual choice durable. An absent or off-table value writes
    // NOTHING (no scales key at all) — byte-identical to before this carry.
    // R2 F-3 — the SAME carry, for the other two controls. Each writes only
    // when the stored word is on its own closed bridge, so an absent or
    // off-table value writes NOTHING (byte-identical to before this carry) and
    // a corrupt record can never PUT an unvalidatable inline theme.
    var ctrls = (rec && rec.controls) || null;
    if (ctrls) {
      var sc = {};
      if (typeof ctrls.corners === 'string' && Object.prototype.hasOwnProperty.call(PRESET_CORNERS_BRIDGE, ctrls.corners)) {
        sc.radius = PRESET_CORNERS_BRIDGE[ctrls.corners];
      }
      if (hasAnyKey(sc)) { out.scales = sc; }
      if (typeof ctrls.button_size === 'string' && Object.prototype.hasOwnProperty.call(PRESET_BUTTON_SIZE_BRIDGE, ctrls.button_size)) {
        bd.min_height = PRESET_BUTTON_SIZE_BRIDGE[ctrls.button_size];
      }
      var fd = {};
      if (typeof ctrls.field_height === 'string' && Object.prototype.hasOwnProperty.call(PRESET_FIELD_HEIGHT_BRIDGE, ctrls.field_height)) {
        fd.min_height = PRESET_FIELD_HEIGHT_BRIDGE[ctrls.field_height];
      }
      if (hasAnyKey(fd)) { out.field_defaults = fd; }
    }
    if (hasAnyKey(bd)) { out.button_defaults = bd; }
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
