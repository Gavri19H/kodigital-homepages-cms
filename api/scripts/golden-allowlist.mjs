#!/usr/bin/env node
// golden-allowlist — Section Builder v3.1 remediation, register §A M2:
// "Parity gates assert only golden-covered regions; legacy UI OUTSIDE the
// golden was never checked and never banned." This is the permanent
// countermeasure: every top-level rendered block in the studio's two
// primary source files must carry an EXPLICIT golden:true/false
// classification in golden-allowlist.json — nothing ships unclassified.
//
// DETECTION CONVENTION (documented per this slice's mandate to "define a
// stable detection convention"):
//   A "block" is a top-level (column-0) declaration in
//   ui-section-studio.ts or ui-sections.ts matching ONE of:
//     - `(export )?function NAME(...)` where NAME starts with "render"
//       (case-sensitive) or "studioCanvas"
//     - `(export )?const NAME = ...`   where NAME is one of the two
//       shared-plumbing mega-constants (SECTION_STUDIO_STYLES,
//       SECTION_STUDIO_SCRIPT) — see NOTE below
//     - the two named page-assembly functions in ui-sections.ts
//       (sectionEditorHtml, sectionNotFoundPage)
//   Every OTHER top-level declaration (data tables like
//   STUDIO_LIBRARY_GROUPS, seed blobs, small string-returning helpers like
//   `issueChip`/`segStyle`/`options`) is considered part of whichever
//   render* block calls it, not its own top-level "region" — this keeps
//   the block list at the granularity the register's S4-A/S4-B rows
//   actually cite (whole panels/functions), not every one-line style
//   helper.
//
//   A block's END is the line before the NEXT top-level declaration of ANY
//   kind (function OR const, regardless of whether THAT one matches the
//   "of interest" filter) or EOF. Boundaries are computed from the FULL
//   set of top-level declarations first, then filtered — so a
//   not-of-interest declaration sitting between two blocks of interest
//   never silently gets absorbed into the preceding block's range.
//
//   NOTE on SECTION_STUDIO_STYLES/SECTION_STUDIO_SCRIPT: these are shared
//   plumbing (the whole inline stylesheet / inline behavior script), not a
//   single visual region — seeded golden:true ("not itself a banned
//   legacy REGION"). Specific dead rules inside them (e.g. register
//   S4-A12's orphaned `.studio-activity/.studio-vertical` CSS) are tracked
//   as their own register row, not this gate's concern.
//
//   Line numbers are RECOMPUTED from the live file on every run (never
//   hardcoded from the register's own — necessarily point-in-time —
//   citations), so this gate stays correct as the file changes.
//
// Compares the LIVE detected block list against golden-allowlist.json
// (same directory):
//   - every detected block must have a matching entry (by "file::name" id)
//     -> else UNCLASSIFIED
//   - allowlist entries with no matching live block -> STALE (informational
//     only; does not fail --strict)
//   - among matched entries: golden:false -> printed in the "non-golden"
//     report list
//
// Modes:
//   node scripts/golden-allowlist.mjs            -> report-only, exit 0
//   node scripts/golden-allowlist.mjs --strict   -> exit 1 if ANY block is
//     UNCLASSIFIED (closes M2's "never checked" gap: new code cannot ship
//     without an explicit golden/non-golden decision). --strict does NOT
//     (yet) fail on existing golden:false blocks — those are register
//     S4-A's OWN remediation scope, executed in phase R5 (the golden
//     purge); failing the build today on defects the register already
//     tracks (rather than a NEW regression) would be exactly the kind of
//     indiscriminate gate this mission is trying to replace. R5 should add
//     a second flag (or extend this one) once the purge ships.
//
// Invocation: cd api && node scripts/golden-allowlist.mjs
// (wired as `npm run verify:golden-regions`).

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(__dirname, '..');
const ALLOWLIST_JSON = path.join(__dirname, 'golden-allowlist.json');

const TARGET_FILES = [
  'src/admin/leadgen/ui-section-studio.ts',
  'src/admin/leadgen/ui-sections.ts',
].map((rel) => ({ rel, abs: path.join(API_ROOT, rel) }));

const SPECIAL_CONST_NAMES = new Set(['SECTION_STUDIO_STYLES', 'SECTION_STUDIO_SCRIPT']);
const SPECIAL_FUNCTION_NAMES = new Set(['sectionEditorHtml', 'sectionNotFoundPage']);

function isBlockOfInterest(name) {
  if (SPECIAL_CONST_NAMES.has(name)) return true;
  if (SPECIAL_FUNCTION_NAMES.has(name)) return true;
  return /^render/.test(name) || /^studioCanvas/.test(name);
}

// Matches `(export )?function NAME(` or `(export )?const NAME ... =`,
// anchored at column 0 (start of line) so only TRUE top-level declarations
// match — nothing indented inside a function body or template literal.
const TOP_LEVEL_DECL_RE = /^(?:export\s+)?(?:function\s+([A-Za-z_][A-Za-z0-9_]*)|const\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::[^=\n]*)?=)/gm;

function detectBlocks(text, rel) {
  const allDecls = [];
  for (const m of text.matchAll(TOP_LEVEL_DECL_RE)) {
    const name = m[1] ?? m[2];
    const startLine = text.slice(0, m.index).split('\n').length;
    allDecls.push({ name, startLine });
  }
  allDecls.sort((a, b) => a.startLine - b.startLine);
  const totalLines = text.split('\n').length;
  const blocks = [];
  for (let i = 0; i < allDecls.length; i++) {
    const cur = allDecls[i];
    const next = allDecls[i + 1];
    const endLine = next ? next.startLine - 1 : totalLines;
    if (isBlockOfInterest(cur.name)) {
      blocks.push({ id: `${rel}::${cur.name}`, file: rel, name: cur.name, startLine: cur.startLine, endLine });
    }
  }
  return blocks;
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_JSON)) return { blocks: [] };
  return JSON.parse(readFileSync(ALLOWLIST_JSON, 'utf8'));
}

function main() {
  const strict = process.argv.includes('--strict');
  const allowlist = loadAllowlist();
  const byId = new Map(allowlist.blocks.map((b) => [b.id, b]));

  const liveBlocks = [];
  for (const { rel, abs } of TARGET_FILES) {
    const text = readFileSync(abs, 'utf8');
    liveBlocks.push(...detectBlocks(text, rel));
  }

  const seenIds = new Set();
  const classified = [];
  const unclassified = [];
  for (const b of liveBlocks) {
    seenIds.add(b.id);
    const entry = byId.get(b.id);
    if (!entry) {
      unclassified.push(b);
    } else {
      classified.push({ ...b, golden: entry.golden, register: entry.register ?? null, note: entry.note ?? null });
    }
  }
  const stale = allowlist.blocks.filter((b) => !seenIds.has(b.id));

  const nonGolden = classified.filter((b) => b.golden === false);
  const golden = classified.filter((b) => b.golden === true);

  console.log('=== golden-allowlist (Section Builder v3.1, register §A M2) ===');
  console.log(`Files scanned: ${TARGET_FILES.map((f) => f.rel).join(', ')}`);
  console.log(`Live blocks detected: ${liveBlocks.length}`);
  console.log(`  golden:true   ${golden.length}`);
  console.log(`  golden:false  ${nonGolden.length}`);
  console.log(`  UNCLASSIFIED  ${unclassified.length}`);
  console.log(`Stale allowlist entries (no longer detected in source): ${stale.length}`);
  console.log('');

  console.log(`[non-golden] ${nonGolden.length} block(s)`);
  for (const b of nonGolden) {
    console.log(`  ${b.file}:${b.startLine}-${b.endLine}  ${b.name}  (${b.register ?? 'no register cite'})`);
    if (b.note) console.log(`    -> ${b.note}`);
  }
  console.log('');

  console.log(`[UNCLASSIFIED — needs an allowlist entry] ${unclassified.length} block(s)`);
  for (const b of unclassified) {
    console.log(`  ${b.file}:${b.startLine}-${b.endLine}  ${b.name}`);
  }
  console.log('');

  if (stale.length > 0) {
    console.log(`[stale allowlist entries — no longer detected in source]  ${stale.length}`);
    for (const b of stale) console.log(`  ${b.id}`);
    console.log('');
  }

  console.log(strict ? 'mode: --strict (exit 1 if any UNCLASSIFIED block exists)' : 'mode: report-only (always exit 0)');

  if (strict && unclassified.length > 0) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

main();
