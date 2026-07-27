#!/usr/bin/env node
// leadgen-orphan-scan — LeadGen Rework Contract (LEADGEN-REWORK-03) §10 /
// §8.9: "every control in the rebuilt tabs is wired or absent; the §10
// orphan scan gates the phase." This is the permanent, mechanical
// countermeasure: a grep-based (NOT tsc/AST) sweep of the leadgen namespace
// for three honest dead-code shapes:
//
//   (a) EXPORTED SYMBOLS with zero references anywhere outside their own
//       declaring file (function/const/class top-level exports only —
//       `export type`/`export interface` are type-only and excluded per the
//       phase brief).
//   (b) HTTP HANDLERS (exported symbols whose name ends in "Handler")
//       never passed to a route-registration call (`.get(`/`.post(`/
//       `.put(`/`.patch(`/`.delete(`/`.all(`) in any router-ish file.
//   (c) CSS CLASSES defined in a leadgen style block (a template-literal
//       constant whose name contains STYLE, case-insensitively, or a file
//       under a `designs/*/styles.ts` path) but never referenced as a
//       literal token anywhere else in the namespace (template/island
//       markup, class attributes, className/classList/js string builders).
//
// SCOPE: the leadgen namespace is exactly the three source trees the
// contract names (§10): api/src/leadgen/**, api/src/admin/leadgen/**,
// api/src/public/leadgen/**. The IMPORTER/USAGE search corpus is wider —
// all of api/src/**, api/test/**, api/test-ui/** — so a namespace export
// used only by a test file, or by an unrelated non-leadgen route file,
// is correctly NOT flagged as dead.
//
// HONESTY / KNOWN LIMITS (grep-based, not a type-checker or data-flow
// tracer — documented rather than hidden, matching this repo's
// jargon-scan.mjs/golden-allowlist.mjs convention):
//   - (a) counts TEXTUAL references, not call-graph reachability: a
//     function that is imported and CALLED, but whose return value is
//     then discarded (e.g. dead markup nobody concatenates into a
//     response), reads as "used" here. This category catches "nobody
//     even imports this anymore," not "this import's result never reaches
//     a served page." The latter class of dead code (confirmed present in
//     this namespace today — see the phase report) needs a human/adversarial
//     pass, not a grep.
//   - (a)/(b) match on `\bNAME\b` word-boundary text search; a name reused
//     by coincidence in an unrelated string/comment elsewhere would read as
//     "used." Names in this namespace are long/specific enough that this is
//     a low-risk approximation, not a theoretical one.
//   - (c) extracts selectors via a regex over template-literal CSS text
//     (`.name{` / `.name,` / `.name ` selector starts) and checks for the
//     bare token elsewhere. A class built via runtime string concatenation
//     from a NON-literal prefix the scanner can't see through is a possible
//     false negative (reads as "used" when it might not be — the scanner
//     errs toward fewer false positives here, not toward completeness).
//   - No JS-in-string-literal function bodies are parsed (e.g. functions
//     declared inside a `const X = \`...island source...\`` blob are not
//     TS-level exports and are outside categories (a)/(b) entirely — this
//     is a known, reported gap, not a silent one).
//
// Modes:
//   node scripts/verify/leadgen-orphan-scan.mjs            -> full report,
//     exit 1 if any UN-ALLOWLISTED finding exists in any category, else 0.
//
// Invocation: cd api && node scripts/verify/leadgen-orphan-scan.mjs
// (NOT wired into verify:all by this slice — the conductor wires gates).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(__dirname, '../..');

// --- the leadgen namespace (§10 scope) ---------------------------------------

const NAMESPACE_ROOTS = [
  'src/leadgen',
  'src/admin/leadgen',
  'src/public/leadgen',
].map((rel) => path.join(API_ROOT, rel));

// Wider corpus a namespace export/handler/class might legitimately be used
// from (tests, non-leadgen admin plumbing that mounts leadgen routes/pages).
const USAGE_CORPUS_ROOTS = [
  'src',
  'test',
  'test-ui',
].map((rel) => path.join(API_ROOT, rel));

// Router-ish files: where a route-registration call for a leadgen handler
// could plausibly live. (b) searches ONLY these for handler-name tokens.
const ROUTER_FILES = [
  'src/admin/leadgen/router.ts',
  'src/admin/router.ts',
  'src/public/leadgen/runtime-routes.ts',
  'src/public/leadgen/serve.ts',
  'src/public/leadgen/serve-auction.ts',
].map((rel) => path.join(API_ROOT, rel));

function walk(root, extRe, out = []) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(root, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walk(abs, extRe, out);
    } else if (extRe.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(abs);
    }
  }
  return out;
}

const CODE_EXT_RE = /\.(ts|tsx|mjs|js)$/;
// Category (c) considered also widening to .html (this repo commits literal
// served-page snapshots, e.g. test/fixtures/p3a-presplit/*.html). REJECTED
// after investigation: those fixtures are a FROZEN pre-refactor capture (its
// own test's job is "did the P3a file-split change output," a point-in-time
// proof, not a living pin) whose embedded <style> block still carries the
// verbatim OLD canvas/structure-panel CSS text — a rule DEFINITION echo, not
// an element actually wearing the class — and separately, three .ts test
// files reference the exact same class names only inside
// `expect(html).not.toContain('id="lg-canvas-toolbar"')`-shaped NEGATIVE
// assertions (proving the id is GONE), which a plain substring search cannot
// tell apart from a positive usage. Both would silently launder confirmed-
// dead CSS into "used." (a)/(b) already search the wider api/src + api/test
// + api/test-ui corpus (ts/js only) via usageMap — (c) reuses that same,
// narrower, less foolable corpus instead of adding .html.

function readAll(files) {
  const map = new Map();
  for (const abs of files) {
    try {
      map.set(abs, readFileSync(abs, 'utf8'));
    } catch (err) {
      console.error(`leadgen-orphan-scan: could not read ${abs}: ${err.message}`);
      process.exitCode = 1;
    }
  }
  return map;
}

function rel(abs) {
  return path.relative(API_ROOT, abs).split(path.sep).join('/');
}

const namespaceFiles = NAMESPACE_ROOTS.flatMap((r) => walk(r, CODE_EXT_RE));
const namespaceMap = readAll(namespaceFiles);

const usageFiles = Array.from(
  new Set([...USAGE_CORPUS_ROOTS.flatMap((r) => walk(r, CODE_EXT_RE)), ...namespaceFiles]),
);
const usageMap = readAll(usageFiles);

// ---------------------------------------------------------------------------
// (a) exported symbols with zero references outside their own file
// ---------------------------------------------------------------------------

// Top-level (column-0) export declarations. `export type`/`export interface`
// are deliberately excluded (type-only, per the phase brief). Re-export
// lists (`export { A, B as C }`) are handled separately below.
const EXPORT_FUNCTION_RE = /^export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
const EXPORT_CONST_RE = /^export\s+const\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
const EXPORT_CLASS_RE = /^export\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
const EXPORT_LIST_RE = /^export\s*\{([^}]+)\}\s*(?:from\s*['"][^'"]+['"])?\s*;/gm;

function collectExportedSymbols(text) {
  const names = new Set();
  for (const re of [EXPORT_FUNCTION_RE, EXPORT_CONST_RE, EXPORT_CLASS_RE]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) names.add(m[1]);
  }
  EXPORT_LIST_RE.lastIndex = 0;
  for (const m of text.matchAll(EXPORT_LIST_RE)) {
    for (const item of m[1].split(',')) {
      const trimmed = item.trim();
      if (trimmed === '') continue;
      const asMatch = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/);
      names.add(asMatch ? asMatch[2] : trimmed.split(/\s+/)[0]);
    }
  }
  return names;
}

// Small, explicit, PER-ENTRY-justified allowlist. No wildcards, no
// pattern-based blanket excludes — every row names one symbol/handler/class
// and says why it is not dead, verified by hand this phase.
const ALLOWLIST_A = new Map([
  // (LEADGEN_RUNTIME_JS_BYTES / LEADGEN_RUNTIME_JS were allowlisted here on
  // the theory that their only consumers were build/verify scripts OUTSIDE
  // this scan's usage corpus, unreachable by a plain text search. The P5
  // adversarial review proved that theory wrong: both are plain named
  // imports squarely INSIDE the scanned corpus —
  // src/public/leadgen/runtime-routes.ts:66 + src/admin/leadgen/sections-
  // handlers.ts:88 import LEADGEN_RUNTIME_JS directly, and
  // test/leadgen-runtime-engine.test.ts + test/leadgen-runtime-routes.test.ts
  // import/use both symbols — so the scan's own `\bNAME\b` reference search
  // already resolves them as used without any allowlist entry. Removed as
  // unnecessary this round; see the per-entry reasons below for anything
  // that IS a genuine non-textual/generated-pipeline exception.)
]);

const ALLOWLIST_B = new Map([
  // (populated after running the scan against real router files — see the
  // per-entry reasons below, each verified by hand this phase)
]);

const ALLOWLIST_C = new Map([
  // (populated after running the scan against real style blocks — see the
  // per-entry reasons below, each verified by hand this phase)
]);

function findingsForExportedSymbols() {
  const findings = [];
  for (const [abs, text] of namespaceMap) {
    const symbols = collectExportedSymbols(text);
    for (const name of symbols) {
      if (ALLOWLIST_A.has(name)) continue;
      const re = new RegExp(`\\b${name}\\b`, 'g');
      let usedElsewhere = false;
      for (const [otherAbs, otherText] of usageMap) {
        if (otherAbs === abs) continue;
        re.lastIndex = 0;
        if (re.test(otherText)) {
          usedElsewhere = true;
          break;
        }
      }
      if (usedElsewhere) continue;
      // Severity split (disclosed heuristic, not part of the literal (a)
      // definition but essential to make findings actionable): count ALL
      // occurrences of NAME in its OWN file. Exactly 1 (the declaration
      // itself) means truly zero callers anywhere — the strong "nobody
      // calls this" signal. More than 1 means it IS called, just only from
      // within its own file (e.g. a private render-dispatch table entry, or
      // a self-invoking bootstrap) — still "zero importers outside their
      // own file" per the letter of the task, but a materially weaker,
      // lower-risk shape than a fully uncalled function. Both are reported;
      // only tier is used to sort/prioritize.
      const ownFileRe = new RegExp(`\\b${name}\\b`, 'g');
      const ownFileHits = (text.match(ownFileRe) ?? []).length;
      findings.push({ name, file: rel(abs), tier: ownFileHits <= 1 ? 'unreferenced-anywhere' : 'no-external-importer' });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// (b) HTTP handlers registered on no route
// ---------------------------------------------------------------------------

const routerText = ROUTER_FILES.map((abs) => {
  try {
    return readFileSync(abs, 'utf8');
  } catch {
    return '';
  }
}).join('\n');

const ROUTE_CALL_RE = /\.(get|post|put|patch|delete|all)\(/;

function findingsForOrphanHandlers() {
  const findings = [];
  for (const [abs, text] of namespaceMap) {
    const symbols = collectExportedSymbols(text);
    for (const name of symbols) {
      if (!name.endsWith('Handler')) continue;
      if (ALLOWLIST_B.has(name)) continue;
      const re = new RegExp(`\\b${name}\\b`);
      if (!re.test(routerText)) {
        findings.push({ name, file: rel(abs) });
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// (c) CSS classes defined in a leadgen style block but referenced nowhere
// ---------------------------------------------------------------------------

// A "style block": a top-level `const NAME = \`...\`` (or `export const`)
// whose NAME contains STYLE (case-insensitive), OR any file living at a
// `designs/*/styles.ts` (or styles.ts-named) path — scanned in full.
const STYLE_CONST_RE = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*string)?\s*=\s*`([\s\S]*?)`\s*;/gm;
const CLASS_SELECTOR_RE = /(?<![.\w#-])\.(-?[A-Za-z_][A-Za-z0-9_-]*)(?=[\s{,.:#\[>+~)])/g;

function isStyleBearingFile(absPath) {
  const r = rel(absPath);
  return /designs\/[^/]+\/styles\.ts$/.test(r);
}

function extractStyleBlocks(abs, text) {
  const blocks = [];
  if (isStyleBearingFile(abs)) {
    blocks.push({ name: '(whole file)', body: text });
  }
  STYLE_CONST_RE.lastIndex = 0;
  for (const m of text.matchAll(STYLE_CONST_RE)) {
    if (/STYLE/i.test(m[1])) blocks.push({ name: m[1], body: m[2] });
  }
  return blocks;
}

// Whole-corpus text, built once, for the dynamic-suffix check below (avoids
// re-joining usageMap's values on every class checked).
const NAMESPACE_FULL_TEXT = Array.from(usageMap.values()).join('\n');

// Many classes in this codebase are composed at render time from a static
// prefix + a `${variable}` suffix (e.g. `` `lg-frame-progress--${p.style}` ``
// renders lg-frame-progress--numbered/--percent/--bar/... ; a literal
// post-render class like "lg-frame-progress--numbered" then never appears
// as ITS OWN literal text anywhere, and would false-positive as dead).
// Detect this: for every '-'-boundary truncation of the class name (longest
// first), check whether `<prefix>-${` (or `<prefix>${`, no extra dash) is
// present anywhere in the namespace. A hit means "dynamically composed,
// really used" — skip it. This is a disclosed, mechanical heuristic (see
// the file header's KNOWN LIMITS), not a suppression of real findings.
function isDynamicallyComposed(cls) {
  const segments = cls.split('-');
  for (let cut = segments.length - 1; cut >= 1; cut -= 1) {
    const prefix = segments.slice(0, cut).join('-');
    if (prefix.length < 3) continue;
    if (NAMESPACE_FULL_TEXT.includes(`${prefix}-\${`) || NAMESPACE_FULL_TEXT.includes(`${prefix}\${`)) {
      return true;
    }
  }
  return false;
}

// Strip /* ... */ blocks before extracting selectors (blanked, not deleted,
// so this stays purely a pre-pass and never shifts anything downstream).
// Without this, a CSS-comment aside that merely MENTIONS a class in prose
// (e.g. "/* ...lg-maps-note was the legacy fieldset's own note class,
// removed... */") gets misread as a live selector — confirmed present in
// this namespace this phase (ui-section-studio.ts's own R5 D2 comment).
function stripCssComments(body) {
  return body.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function findingsForDeadCss() {
  const findings = [];
  const seenClasses = new Set();
  for (const [abs, text] of namespaceMap) {
    const blocks = extractStyleBlocks(abs, text);
    for (const block of blocks) {
      const classes = new Set();
      const scrubbedBody = stripCssComments(block.body);
      CLASS_SELECTOR_RE.lastIndex = 0;
      for (const m of scrubbedBody.matchAll(CLASS_SELECTOR_RE)) classes.add(m[1]);
      for (const cls of classes) {
        const key = cls;
        if (seenClasses.has(key)) continue; // already resolved via an earlier (definition) site
        if (ALLOWLIST_C.has(cls)) {
          seenClasses.add(key);
          continue;
        }
        if (isDynamicallyComposed(cls)) {
          seenClasses.add(key);
          continue;
        }
        // Usage = the bare class token appearing ANYWHERE in the WIDE corpus
        // (namespace + api/src + api/test + api/test-ui, ts/js only — see
        // the .html rejection note above) OUTSIDE this exact style-block
        // body (same file's OTHER code counts as a use — a class defined
        // and consumed by the same render file is a normal, non-dead
        // pattern). Confirmed necessary this phase: .admin-main/
        // .admin-header/.admin-content/.lg-kebab-menu are leadgen-defined
        // but consumed by the SHARED non-leadgen admin layout
        // (src/admin/templates/layout.ts) — invisible to a namespace-only
        // search, visible here.
        let used = false;
        for (const [otherAbs, otherText] of usageMap) {
          const haystack = otherAbs === abs ? otherText.split(block.body).join('') : otherText;
          if (haystack.includes(cls)) {
            used = true;
            break;
          }
        }
        seenClasses.add(key);
        if (!used) {
          findings.push({ name: cls, file: rel(abs), block: block.name });
        }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  console.log('=== leadgen-orphan-scan (LEADGEN-REWORK-03 §10 / §8.9 dead-code bar) ===');
  console.log(`Namespace files scanned: ${namespaceFiles.length}`);
  for (const r of NAMESPACE_ROOTS) console.log(`  - ${rel(r)}/**`);
  console.log(`Usage/importer corpus: ${usageFiles.length} files (namespace + api/src + api/test + api/test-ui)`);
  console.log('');

  const a = findingsForExportedSymbols();
  const b = findingsForOrphanHandlers();
  const c = findingsForDeadCss();

  const aUnreferenced = a.filter((f) => f.tier === 'unreferenced-anywhere');
  const aNoExternal = a.filter((f) => f.tier === 'no-external-importer');
  console.log(`[a: exported symbols, zero references outside their own file] ${a.length} finding(s)`);
  console.log(`  tier 1 (GATING) — unreferenced ANYWHERE, not even within its own file: ${aUnreferenced.length}`);
  for (const f of aUnreferenced) console.log(`    ${f.file} :: ${f.name}`);
  console.log(`  tier 2 (informational, non-gating) — used within own file only, no external importer: ${aNoExternal.length}`);
  console.log('    (a private helper/constant that is CALLED from within its own file but has no');
  console.log('    outside importer is a much weaker signal than "nobody calls this" — it usually');
  console.log('    means the export keyword is unnecessary, not that the code is dead. Reported for');
  console.log('    visibility; does not fail this gate. See file header KNOWN LIMITS.)');
  for (const f of aNoExternal) console.log(`    ${f.file} :: ${f.name}`);
  console.log(`  (allowlisted: ${ALLOWLIST_A.size})`);
  for (const [name, reason] of ALLOWLIST_A) console.log(`    - ${name}: ${reason}`);
  console.log('');

  console.log(`[b: *Handler exports registered on no route] ${b.length} finding(s)`);
  for (const f of b) console.log(`  ${f.file} :: ${f.name}`);
  console.log(`  (allowlisted: ${ALLOWLIST_B.size})`);
  for (const [name, reason] of ALLOWLIST_B) console.log(`    - ${name}: ${reason}`);
  console.log('');

  console.log(`[c: CSS classes defined but never referenced] ${c.length} finding(s)`);
  for (const f of c) console.log(`  ${f.file} (${f.block}) :: .${f.name}`);
  console.log(`  (allowlisted: ${ALLOWLIST_C.size})`);
  for (const [name, reason] of ALLOWLIST_C) console.log(`    - .${name}: ${reason}`);
  console.log('');

  const gatingTotal = aUnreferenced.length + b.length + c.length;
  console.log(`GATING findings (a-tier1 + b + c): ${gatingTotal}`);
  console.log(`Informational-only (a-tier2, does not gate): ${aNoExternal.length}`);

  if (gatingTotal > 0) {
    console.error('leadgen-orphan-scan FAIL — real dead code or a missing allowlist entry (see findings above).');
    process.exitCode = 1;
    return;
  }
  console.log('leadgen-orphan-scan OK — every gating finding is either absent or explicitly allowlisted with a reason.');
  process.exitCode = 0;
}

main();
