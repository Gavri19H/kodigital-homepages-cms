#!/usr/bin/env node
// jargon-scan — Section Builder v3.1 remediation, register §A M6:
// "No jargon gate: §-refs, 'legacy', wrangler secret names render in
// product UI copy." This is the permanent countermeasure: a static scan of
// the three admin studio source files for operator-visible spec-leakage.
//
// Categories scanned:
//   section  - the "§" section-reference glyph
//   legacy   - the word "legacy"/"Legacy" (word-boundary, case-insensitive)
//   wrangler - the literal "wrangler"
//   googleMaps - the literal "GOOGLE_MAPS" (secret-name identifier)
//   rawOperatorCodes - rule-operator codes (eq/neq/gt/lt/gte/lte/in/not_in)
//     rendered as VISIBLE <option>/label TEXT rather than a human label
//     (register S3-2: studio:1422-1425 `options()` falls back to the raw
//     value as display text when no `labels` array is passed; studio:1757
//     is the call site that omits it for the rule-operator dropdown).
//
// DETECTION CONVENTION (documented per this slice's mandate to "define a
// stable detection convention"):
//   1. Every top-level function in these three files either returns (or,
//      for the two big exported constants, directly IS) an HTML/JS template
//      string that ships to the browser. There is no separate "template
//      language" to parse: the ENTIRE non-comment content of these files is,
//      by construction, rendered output (HTML tag text, attribute values —
//      title/aria-label INCLUDED, since native tooltips and the
//      accessible name ARE operator-visible/operator-audible — or a JS
//      string literal inside the inline SECTION_STUDIO_SCRIPT that becomes
//      DOM text at runtime, e.g. `el.textContent = '...'`).
//   2. So "extract rendered strings" reduces to "strip comments, scan what's
//      left": a line is EXCLUDED if it falls inside a `/* ... */` block
//      (this single stripper covers BOTH the register's "code comments" and
//      "CSS comments" buckets — a CSS comment embedded in the exported
//      SECTION_STUDIO_STYLES template string is lexically identical `/* */`
//      syntax) or inside an `<!-- ... -->` HTML comment (these ship as
//      invisible DOM comment nodes — never seen/heard by an operator), or
//      if its TRIMMED content starts with `//` (this codebase's exclusive
//      whole-line-comment convention — verified empirically: zero lines in
//      these three files carry a trailing same-line `//` comment that also
//      contains any of the scanned words; see KNOWN LIMITATIONS below).
//   3. Comment-stripping BLANKS matched spans character-by-character
//      (preserving embedded newlines), so every reported line number is the
//      REAL line number in the source file — never shifted by the strip.
//   4. Post-review fix (adversarial review, R0 FIX-FIRST round 1): the
//      scrubbed text is DECODED before any category check runs, so a
//      rendered glyph written as an escape/entity is caught exactly like a
//      literal one. Proven false-negative this closes: studio:9162 (inside
//      SECTION_STUDIO_SCRIPT) reads `(\\u00A78.2)` in the raw .ts SOURCE —
//      TWO backslashes, because that constant is inner ES5 browser-JS
//      SOURCE TEXT nested inside this outer (non-raw) TS template literal;
//      the outer template literal's own escape processing collapses `\\`
//      to one literal `\`, leaving the INNER text `§8.2)` in the
//      string the browser receives as its `<script>` body; the BROWSER's
//      own JS engine then decodes THAT `§` to a real `§` when it runs
//      `offersNote(...)` -> `el.textContent = text` (studio:8514). A plain
//      (non-nested) render*() template literal would only need ONE
//      backslash for the same operator-visible result. decodeEscapesAndEntities()
//      below therefore resolves BOTH the doubled form (nested-string case)
//      and the single form (direct case) — plus the HTML-entity forms
//      (&sect; / &#167; / &#xA7;) in case a rendered string ever spells a
//      glyph that way — for EVERY category, not just "§".
//
// KNOWN LIMITATIONS (this is a REPORT-ONLY static convention, not a full
// HTML/JS parse — intentionally broad rather than narrow, so a human/future
// --strict gate triages candidates rather than the scanner silently
// under-reporting):
//   - Trailing SAME-LINE `//` comments (`code(); // note`) are NOT stripped
//     (only whole-line `//` comments are). Verified today: this affects
//     zero jargon-relevant lines in the three target files. A string-
//     literal-aware tokenizer would be needed to strip these safely without
//     risking a false-negative on a rendered string containing `://`
//     (e.g. an href) — out of scope for this static convention.
//   - decodeEscapesAndEntities handles 1x and 2x backslash nesting depth
//     (covering every case that exists in this codebase today: a direct
//     render*() template literal, or one level of ES5-string-inside-outer-
//     template-literal). A THIRD nesting layer, if one is ever introduced,
//     would need a 3-backslash pattern added alongside the existing two.
//   - The "legacy" category is a broad lexical word-boundary match: it will
//     also catch CSS class-name tokens (e.g. `.studio-role-legacy{...}`)
//     and unrelated JS string literals (e.g. a "Custom color (legacy)"
//     tooltip describing a hex-vs-theme-role distinction) that are NOT the
//     spec-leakage class register S2-9 flags (the two unconditionally-
//     rendered legacy-Maps-fieldset lines). Both print with their snippet
//     so a reviewer can eyeball false positives immediately.
//   - rawOperatorCodes is a targeted static heuristic (see below), not a
//     runtime trace: it flags `options(IDENT)` call sites (single argument,
//     no `labels` array) where IDENT resolves to a same-file top-level
//     array literal containing one of the raw operator codes. It cannot
//     see indirection through a helper function that itself wraps
//     `options()`.
//
// Modes:
//   node scripts/jargon-scan.mjs            -> report-only, ALWAYS exit 0
//   node scripts/jargon-scan.mjs --strict   -> exit 1 if ANY hit exists
//
// Invocation: cd api && node scripts/jargon-scan.mjs
// (wired as `npm run verify:jargon`).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(__dirname, '..');

const TARGET_FILES = [
  'src/admin/leadgen/ui-section-studio.ts',
  'src/admin/leadgen/ui-sections.ts',
  'src/admin/leadgen/ui-theme-manager.ts',
].map((rel) => ({ rel, abs: path.join(API_ROOT, rel) }));

const RAW_OP_CODES = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'in', 'not_in'];
const SNIPPET_MAX = 160;

/** Blank every char of `matched` except embedded newlines, preserving line numbers in the caller's downstream line-split. */
function blankPreservingNewlines(matched) {
  let out = '';
  for (const ch of matched) out += ch === '\n' ? '\n' : ' ';
  return out;
}

/**
 * Strip `/* ... *\/` blocks and `<!-- ... -->` blocks (both multi-line
 * aware, both blanked-not-deleted so line numbers survive), then blank any
 * line whose trimmed content starts with `//`. Returns the scrubbed text —
 * same total line count as the input.
 */
function scrub(text) {
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blankPreservingNewlines);
  out = out.replace(/<!--[\s\S]*?-->/g, blankPreservingNewlines);
  const lines = out.split('\n').map((line) => (line.trim().startsWith('//') ? '' : line));
  return lines.join('\n');
}

// Codepoints that are line terminators (ECMAScript LF/CR/LS/PS, plus NEL —
// a line terminator in several legacy/HTML contexts). A rendered newline is
// never itself jargon, so decoding any escape/entity that WOULD produce one
// of these substitutes a single space instead of the literal character.
// Fixes a real bug (adversarial review, FIX-FIRST round 2): `&#10;` at
// ui-section-studio.ts:1902 (a textarea placeholder's bulk-paste example,
// `"Toyota = toyota&#10;Honda = honda"`) decoded to an ACTUAL newline,
// silently inserting an extra line into the decoded text and shifting
// every subsequent reported line number by +1 relative to the real source
// — violating this scanner's own documented invariant (point 3 above:
// "every reported line number is the REAL line number in the source
// file"). Grepped all three target files for every other newline-escape
// form (decimal &#10;/&#13;, hex &#xA;/&#xD; case-insensitive, single- and
// double-backslash JS hex/unicode escapes for the same LF/CR codepoints,
// and the LS/PS/NEL equivalents) -- line 1902 is the ONLY injection point
// that exists today.
const LINE_TERMINATOR_CODEPOINTS = new Set([0x0a, 0x0d, 0x2028, 0x2029, 0x85]);

function codepointToSafeChar(codepoint) {
  return LINE_TERMINATOR_CODEPOINTS.has(codepoint) ? ' ' : String.fromCodePoint(codepoint);
}

/**
 * Decode escape/entity forms that resolve to a literal rendered character,
 * so a category check (`includes('§')`, etc.) sees the SAME text an
 * operator would ultimately see, regardless of which escape depth the
 * source used. Order matters: the doubled forms (`\\uXXXX`, `\\xXX`) are
 * resolved FIRST — a naive single-backslash pass run first would consume
 * the SECOND backslash of a doubled escape as if it started its own
 * (wrong) single escape, leaving a stray literal backslash beside the
 * decoded character instead of resolving the true nested-string escape.
 * HTML entities (named §, decimal, hex) are decoded last. Every numeric
 * decode routes through codepointToSafeChar so a line-terminator codepoint
 * NEVER becomes a real newline (see comment above) — this function must
 * never change the input's newline count, only its content.
 */
function decodeEscapesAndEntities(text) {
  let out = text;
  out = out.replace(/\\\\u([0-9A-Fa-f]{4})/g, (_m, hex) => codepointToSafeChar(parseInt(hex, 16)));
  out = out.replace(/\\\\x([0-9A-Fa-f]{2})/g, (_m, hex) => codepointToSafeChar(parseInt(hex, 16)));
  out = out.replace(/\\u([0-9A-Fa-f]{4})/g, (_m, hex) => codepointToSafeChar(parseInt(hex, 16)));
  out = out.replace(/\\x([0-9A-Fa-f]{2})/g, (_m, hex) => codepointToSafeChar(parseInt(hex, 16)));
  out = out.replace(/&#x([0-9A-Fa-f]+);/g, (_m, hex) => codepointToSafeChar(parseInt(hex, 16)));
  out = out.replace(/&#([0-9]+);/g, (_m, dec) => codepointToSafeChar(parseInt(dec, 10)));
  out = out.replace(/&sect;/gi, '§');
  return out;
}

function snippet(line) {
  const t = line.trim();
  return t.length > SNIPPET_MAX ? `${t.slice(0, SNIPPET_MAX)}…` : t;
}

/** Line-based categories: section (§), legacy (word-boundary), wrangler, googleMaps. */
function scanLexicalCategories(scrubbedText, rel) {
  const lines = scrubbedText.split('\n');
  const hits = { section: [], legacy: [], wrangler: [], googleMaps: [] };
  const legacyRe = /\blegacy\b/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (line.includes('§')) hits.section.push({ file: rel, line: lineNo, snippet: snippet(line) });
    if (legacyRe.test(line)) hits.legacy.push({ file: rel, line: lineNo, snippet: snippet(line) });
    if (line.includes('wrangler')) hits.wrangler.push({ file: rel, line: lineNo, snippet: snippet(line) });
    if (line.includes('GOOGLE_MAPS')) hits.googleMaps.push({ file: rel, line: lineNo, snippet: snippet(line) });
  }
  return hits;
}

/**
 * Raw-operator-code detector: resolve every top-level `const NAME = [...]`
 * array literal whose string values overlap RAW_OP_CODES, then flag every
 * single-argument `options(NAME)` call site (no `labels` arg -> the
 * fallback path in `options()` renders the raw code as display text — see
 * register S3-2).
 */
function scanRawOperatorCodes(scrubbedText, rel) {
  const hits = [];
  const arraysWithOpCodes = new Set();
  const constArrayRe = /^const\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=]*)?=\s*\[([^\]]*)\]/gm;
  for (const m of scrubbedText.matchAll(constArrayRe)) {
    const name = m[1];
    const body = m[2];
    const values = Array.from(body.matchAll(/["']([^"']*)["']/g)).map((x) => x[1]);
    if (values.some((v) => RAW_OP_CODES.includes(v))) arraysWithOpCodes.add(name);
  }
  const lines = scrubbedText.split('\n');
  const callRe = /\boptions\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const cm of line.matchAll(callRe)) {
      const ident = cm[1];
      if (arraysWithOpCodes.has(ident)) {
        hits.push({
          file: rel,
          line: i + 1,
          snippet: snippet(line),
          detail: `options(${ident}) called with no labels arg — ${ident} contains raw operator codes, so its values ALSO become the visible <option> text`,
        });
      }
    }
  }
  return hits;
}

function main() {
  const strict = process.argv.includes('--strict');
  const perFile = [];
  const totals = { section: 0, legacy: 0, wrangler: 0, googleMaps: 0, rawOperatorCodes: 0 };

  for (const { rel, abs } of TARGET_FILES) {
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch (err) {
      console.error(`jargon-scan: could not read ${rel}: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    const scrubbed = scrub(text);
    const decoded = decodeEscapesAndEntities(scrubbed);
    const lexical = scanLexicalCategories(decoded, rel);
    const rawOps = scanRawOperatorCodes(decoded, rel);
    perFile.push({ rel, lexical, rawOps });
    totals.section += lexical.section.length;
    totals.legacy += lexical.legacy.length;
    totals.wrangler += lexical.wrangler.length;
    totals.googleMaps += lexical.googleMaps.length;
    totals.rawOperatorCodes += rawOps.length;
  }

  const grandTotal = totals.section + totals.legacy + totals.wrangler + totals.googleMaps + totals.rawOperatorCodes;

  console.log('=== jargon-scan (Section Builder v3.1, register §A M6) ===');
  console.log(`Files scanned: ${TARGET_FILES.length}`);
  for (const { rel } of TARGET_FILES) console.log(`  - ${rel}`);
  console.log('');

  function printCategory(label, key) {
    console.log(`[${label}] ${totals[key]} hit(s)`);
    for (const { rel, lexical } of perFile) {
      for (const h of lexical[key]) {
        console.log(`  ${rel}:${h.line}  ${h.snippet}`);
      }
    }
    console.log('');
  }

  printCategory('section (§)', 'section');
  printCategory('legacy', 'legacy');
  printCategory('wrangler', 'wrangler');
  printCategory('GOOGLE_MAPS', 'googleMaps');

  console.log(`[raw-operator-codes] ${totals.rawOperatorCodes} hit(s)`);
  for (const { rel, rawOps } of perFile) {
    for (const h of rawOps) {
      console.log(`  ${rel}:${h.line}  ${h.snippet}`);
      console.log(`    -> ${h.detail}`);
    }
  }
  console.log('');

  console.log(`TOTAL: ${grandTotal} hit(s) across 5 categories`);
  console.log(strict ? 'mode: --strict (exit 1 if TOTAL > 0)' : 'mode: report-only (always exit 0)');

  if (strict && grandTotal > 0) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

main();
