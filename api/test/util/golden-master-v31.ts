// LeadGen v3.1 §13 Gate 1 — the GOLDEN-MASTER PARSER/INDEX util.
//
// Loads the byte-identical committed golden (docs/leadgen/redesign-contract-v3/
// golden/golden-master-source.dc.html — contract §0.1 Artifact D) ONCE and
// exposes per-Appendix-D-element lookups keyed by the EXACT search strings
// Appendix D names ("Find in source" column), so every gate test asserts
// against the real committed bytes — never a paraphrase or a hand-copied
// literal that can silently drift from the file on disk.
//
// Contract §0.1: "Builders copy these strings, never reinterpret them." This
// util NEVER reinterprets: every export below is either (a) a byte-range
// SLICE of the real file between two verbatim marker strings taken from the
// file itself, or (b) a small, documented regex extraction (hex literals,
// per-tile SVGs). Resolved relative to THIS file via import.meta.url (never a
// hardcoded/foreign path) — the same discipline api/test/leadgen-studio-tokens
// .test.ts already uses for its own GOLDEN load.
//
// A marker typo must FAIL LOUDLY, not silently produce an empty string that
// lets a gate pass on nothing (evidence-standards E1/E2) — goldenBetween/
// goldenTileSvgs throw with the exact missing marker when a lookup fails.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_PATH = join(
  HERE,
  "..",
  "..",
  "..",
  "docs",
  "leadgen",
  "redesign-contract-v3",
  "golden",
  "golden-master-source.dc.html",
);

/** The full committed golden source, verbatim. */
export const GOLDEN_HTML: string = readFileSync(GOLDEN_PATH, "utf8");

/**
 * Slice the golden between two EXACT marker strings (start inclusive, end
 * exclusive). Throws when either marker is absent, so a mis-typed marker
 * fails the test run immediately instead of silently returning "".
 */
export function goldenBetween(startMarker: string, endMarker: string): string {
  const start = GOLDEN_HTML.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`golden-master-v31: start marker not found in golden: ${JSON.stringify(startMarker)}`);
  }
  const end = GOLDEN_HTML.indexOf(endMarker, start + startMarker.length);
  if (end === -1) {
    throw new Error(
      `golden-master-v31: end marker not found after start marker ${JSON.stringify(startMarker)}: ${JSON.stringify(endMarker)}`,
    );
  }
  return GOLDEN_HTML.slice(start, end);
}

// ---------------------------------------------------------------------------
// Appendix D element index — one export per row of the contract's
// "Golden-master source — verbatim element index" table, keyed by the EXACT
// "Find in source" search string from that table. Boundaries are the next
// structural HTML comment in the file (verified by direct read of the
// committed golden, not inferred).
// ---------------------------------------------------------------------------

export const GOLDEN_APP_FRAME = goldenBetween(
  '<div style="width:1440px;height:944px',
  "<!-- ============ TOP BAR ============ -->",
);

export const GOLDEN_TOP_BAR = goldenBetween(
  "<!-- ============ TOP BAR ============ -->",
  "<!-- ============ QUESTION STRIP ============ -->",
);

export const GOLDEN_QUESTION_STRIP = goldenBetween(
  "<!-- ============ QUESTION STRIP ============ -->",
  "<!-- ============ BODY: 3 PANELS ============ -->",
);

export const GOLDEN_LIBRARY = goldenBetween(
  "<!-- ---- LEFT: COMPONENT LIBRARY ---- -->",
  "<!-- ---- CENTER: CANVAS ---- -->",
);

export const GOLDEN_FRAME_CALLOUT = goldenBetween("<!-- FRAME CALLOUT -->", "<!-- ---- CENTER: CANVAS ---- -->");

export const GOLDEN_CANVAS_TOOLBAR = goldenBetween("<!-- CANVAS TOOLBAR -->", "<!-- CANVAS SURFACE -->");

export const GOLDEN_CANVAS_SURFACE = goldenBetween("<!-- CANVAS SURFACE -->", "<!-- BOTTOM DRAWER BAR -->");

export const GOLDEN_FRAME_HINT_HEADER = goldenBetween(
  "<!-- FRAME HINT: HEADER -->",
  "<!-- THE QUESTION UNIT (editable) -->",
);

export const GOLDEN_QUESTION_UNIT = goldenBetween(
  "<!-- THE QUESTION UNIT (editable) -->",
  "<!-- FRAME HINT: FOOTER -->",
);

export const GOLDEN_SELECTION_CHROME = goldenBetween(
  "<!-- selection chrome for field -->",
  "<!-- continue button (selectable) -->",
);

export const GOLDEN_FRAME_HINT_FOOTER = goldenBetween("<!-- FRAME HINT: FOOTER -->", "<!-- BOTTOM DRAWER BAR -->");

export const GOLDEN_BOTTOM_DRAWER = goldenBetween("<!-- BOTTOM DRAWER BAR -->", "<!-- ---- RIGHT: INSPECTOR ---- -->");

export const GOLDEN_INSPECTOR = goldenBetween(
  "<!-- ---- RIGHT: INSPECTOR ---- -->",
  '<sc-if value="{{ viewThemes }}"',
);

export const GOLDEN_SCOPE_HEADER = goldenBetween("<!-- scope header -->", "<!-- tabs -->");
export const GOLDEN_SCOPE_PILLS = goldenBetween("<!-- scope pills -->", "<!-- affects line -->");
export const GOLDEN_AFFECTS_LINE = goldenBetween("<!-- affects line -->", "<!-- tabs -->");
export const GOLDEN_TABS_STRIP = goldenBetween("<!-- tabs -->", "<!-- tab body -->");

export const GOLDEN_CONTENT_TAB = goldenBetween("<!-- ===== CONTENT TAB ===== -->", "<!-- ===== STYLE TAB ===== -->");
export const GOLDEN_STYLE_TAB = goldenBetween("<!-- ===== STYLE TAB ===== -->", "<!-- ===== RULES TAB ===== -->");
export const GOLDEN_RULES_TAB = goldenBetween("<!-- ===== RULES TAB ===== -->", "<!-- ===== MAPS TAB ===== -->");
export const GOLDEN_MAPS_TAB = goldenBetween("<!-- ===== MAPS TAB ===== -->", "<!-- ===== OFFERS TAB ===== -->");
export const GOLDEN_OFFERS_TAB = goldenBetween(
  "<!-- ===== OFFERS TAB ===== -->",
  "<!-- ADVANCED (always, collapsed) -->",
);
export const GOLDEN_ADVANCED = goldenBetween(
  "<!-- ADVANCED (always, collapsed) -->",
  '<sc-if value="{{ viewThemes }}"',
);

export const GOLDEN_THEMES_TOPBAR = goldenBetween("<!-- themes top bar -->", "<!-- LEFT: theme list -->");
export const GOLDEN_THEMES_LEFT_LIST = goldenBetween("<!-- LEFT: theme list -->", "<!-- CENTER: editor -->");
export const GOLDEN_THEMES_CENTER_EDITOR = goldenBetween("<!-- CENTER: editor -->", "<!-- RIGHT: A/B assignment -->");
export const GOLDEN_THEMES_RIGHT_PANEL = goldenBetween("<!-- RIGHT: A/B assignment -->", "</sc-if></x-dc>");

/** The golden's demo-logic <script> block (state machine + seg()/tab()/cb()/
 * themeCard()/pal()/frameBtnStyle/reqToggleStyle/fieldBoxStyle/fieldWrapStyle/
 * mapsToggleStyle helpers Appendix D's last row names). This is the FAKE-STATE
 * reference for interaction-state style strings — §0 fidelity-vs-function:
 * the golden's own hardcoded demo values (e.g. fieldWrapStyle's custom-mode
 * "width:64%") are explicitly NOT contract fact; only the FORMAT + the
 * non-custom/grounded branches are asserted elsewhere. */
export const GOLDEN_DEMO_SCRIPT = goldenBetween('<script type="text/x-dc"', "</script>\n</body>\n</html>");

// ---------------------------------------------------------------------------
// The 20 unique §5.5 tile data-name synonym strings (Appendix D: "All 20 tile
// SVGs — data-tile data-name=\"…\" — one block per §5.5 synonym string").
// Verified against the committed golden's own §5.2/§5.5 tile markup: some
// data-names (e.g. "short text", "buttons", "cards") appear TWICE across two
// palette groups with byte-IDENTICAL svg content each time (§5.2 "Suggested"
// is an explicit shortcut row with "identical insert semantics... never a
// different catalog") — so "20" counts unique tile IDENTITIES (this list),
// not palette tile-SLOT occurrences (22, since 2 of the 4 Suggested tiles are
// reused Answer-fields tiles rather than new assets).
// ---------------------------------------------------------------------------
export const GOLDEN_TILE_DATA_NAMES = [
  "short text",
  "buttons",
  "cards",
  "continue button",
  "yes no",
  "dropdown",
  "multi-select",
  "number",
  "amount money",
  "date",
  "slider scale",
  "contact name email phone",
  "address zip location",
  "text legal note reassurance disclosure",
  "image logo picture",
  "divider line",
  "card panel",
  "columns",
  "grid",
  "spacer gap",
] as const;
export type GoldenTileDataName = (typeof GOLDEN_TILE_DATA_NAMES)[number];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every verbatim `<svg ...>...</svg>` block that immediately follows a
 * `data-tile data-name="<dataName>"` opening tag in the golden's library
 * region (Appendix D: "the SVG inside each block is the tile's asset").
 * Returns one entry per OCCURRENCE in reading order (1 or 2 — see
 * GOLDEN_TILE_DATA_NAMES doc above); every occurrence is byte-identical for a
 * given dataName in the committed golden. Throws if the dataName has no tile
 * in the golden (a fixture/marker bug, never a silent empty match).
 */
export function goldenTileSvgs(dataName: GoldenTileDataName): string[] {
  const pattern = new RegExp(`data-tile data-name="${escapeRegExp(dataName)}"[^]*?(<svg[^]*?<\\/svg>)`, "g");
  const out = [...GOLDEN_LIBRARY.matchAll(pattern)].map((match) => match[1]!);
  if (out.length === 0) {
    throw new Error(`golden-master-v31: no tile <svg> found in golden for data-name=${JSON.stringify(dataName)}`);
  }
  return out;
}

/** The first (canonical) SVG for a tile — use when every occurrence is
 * already known to be byte-identical (asserted once via goldenTileSvgs). */
export function goldenTileSvg(dataName: GoldenTileDataName): string {
  return goldenTileSvgs(dataName)[0]!;
}

// ---------------------------------------------------------------------------
// Generic extraction helpers for the Gate 1b token audit.
// ---------------------------------------------------------------------------

const HEX_PATTERN_G = /#[0-9A-Fa-f]{6}\b/g;

/** Every unique 6-digit hex literal appearing in a string, in first-seen
 * order. Golden + built UI both use only 6-digit hex throughout (confirmed by
 * direct read) — 3-digit shorthand is intentionally NOT matched so a future
 * shorthand hex is surfaced as a NEW, unaccounted-for literal rather than
 * silently normalized away. */
export function extractHexes(html: string): string[] {
  return [...new Set([...html.matchAll(HEX_PATTERN_G)].map((match) => match[0]))];
}

/**
 * True when every hex literal in `html` is a member of `allowed`, compared
 * CASE-INSENSITIVELY. Hex colors are case-insensitive in CSS semantics (a
 * lowercase re-typing of an on-palette value is still on-palette — the
 * SAME visual color); byte-exact casing is a SEPARATE, narrower concern
 * (golden-vs-token-module fidelity) already proven at the module level by
 * leadgen-studio-tokens.test.ts, which is where "note the lowercase
 * navy-hover" byte-exactness belongs. Returns the offending hexes (their
 * ORIGINAL case, for a readable failure message) rather than a boolean.
 */
export function hexesNotIn(html: string, allowed: ReadonlySet<string> | readonly string[]): string[] {
  const allowedUpper = new Set([...allowed].map((hex) => hex.toUpperCase()));
  return extractHexes(html).filter((hex) => !allowedUpper.has(hex.toUpperCase()));
}
