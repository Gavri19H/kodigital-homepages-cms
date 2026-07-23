// LeadGen Rework §10 (P5 / S5.1) — THE ZERO-REFERENCE GATE.
//
// Proves that the §10-removed symbols have ZERO LIVE (non-comment) references in
// LeadGen PRODUCT SOURCE (api/src), so a removed catalog type / mechanism can
// never silently regress back into shipped behavior. This is a PERMANENT guard:
// re-introducing any removed symbol as live code fails this test.
//
// SCOPE — api/src only (product code). Test files are intentionally NOT scanned:
// migration-replay tests, extinct-type SEAM tests (leadgen-rework-schema/render),
// legacy byte-pin fixtures, and back-compat/absence tests all LEGITIMATELY name
// the removed symbols (that IS their job — proving the removal + its seam). The
// anti-regression guarantee that matters is "no live PRODUCT reference"; guarding
// the tests that enforce the removal would be counterproductive.
//
// COMMENT-AWARE — a symbol appearing only in a `//`, `/* */`, JSDoc `*`, or HTML
// `<!--` comment is documentation of the removal, not a live reference; those are
// skipped. Every non-comment (code) occurrence counts.
//
// EXCLUSIONS (documented, per-symbol) — files that legitimately keep the token:
//   * scripts/leadgen-rework-migration-report.ts — the M6/M7/M12 migration report
//     tool + its pre-migration fixtures MUST name the extinct types (migration
//     tooling, same category as the migration SQL).
//   * choiceDisplay: the OFFER-PAYLOAD subsystem (leadgen/payload.ts +
//     admin/leadgen/ui-payload-builder.ts) is a SEPARATE, KEPT feature — the offer
//     payload schema's own Other-group metadata (LeadgenPayloadChoiceDisplay /
//     validateChoiceDisplay). §10 retired only the SECTION-content choiceDisplay.
//   * is_control: the listicle subsystem (src/listicles, src/admin/listicles) has
//     its OWN unrelated is_control column (explicitly out of §10 scope), and the
//     leadgen client-island contract key `selected_variant_is_control` is a
//     deliberately-kept DIFFERENT token (the \bis_control\b match excludes it).
//   * route_funnel_variant — RESOLVED in §10/S5.1 PASS 2 (no exclusion needed):
//     the dead routing panel/resolver/handlers residue this once excluded was
//     swept; see the per-symbol note below for the full disposition.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

function allTsFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === "node_modules") continue;
        walk(full);
      } else if (entry.endsWith(".ts")) {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

// Strip whole-line + block + HTML + inline-tail comments so only CODE remains.
// Conservative: it never invents code, it only blanks comment spans.
function stripComments(src: string): string[] {
  const lines = src.split("\n");
  let inBlock = false; // /* ... */
  let inHtml = false; // <!-- ... -->
  return lines.map((raw) => {
    let line = raw;
    // continue an open block/HTML comment
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end === -1) return "";
      line = line.slice(end + 2);
      inBlock = false;
    }
    if (inHtml) {
      const end = line.indexOf("-->");
      if (end === -1) return "";
      line = line.slice(end + 3);
      inHtml = false;
    }
    // remove closed inline /* */ and <!-- --> spans, and open ones
    // eslint-disable-next-line no-constant-condition
    for (;;) {
      const b = line.indexOf("/*");
      const h = line.indexOf("<!--");
      const next = [b, h].filter((n) => n >= 0).sort((x, y) => x - y)[0];
      if (next === undefined) break;
      if (next === b) {
        const end = line.indexOf("*/", b + 2);
        if (end === -1) { line = line.slice(0, b); inBlock = true; break; }
        line = line.slice(0, b) + " " + line.slice(end + 2);
      } else {
        const end = line.indexOf("-->", h + 4);
        if (end === -1) { line = line.slice(0, h); inHtml = true; break; }
        line = line.slice(0, h) + " " + line.slice(end + 3);
      }
    }
    // strip a `//` line-comment tail (naive but safe for these identifiers —
    // none appears after a `//` in a string literal in this codebase)
    const slash = line.indexOf("//");
    if (slash >= 0) line = line.slice(0, slash);
    return line;
  });
}

interface SymbolSpec {
  name: string;
  // regex to detect a live reference on a (comment-stripped) code line
  pattern: RegExp;
  // relative-path substrings whose files are excluded (documented above)
  excludePaths: string[];
}

const REPORT_TOOL = "scripts/leadgen-rework-migration-report.ts";

// The eight §10-catalog/mechanism symbols S5.1 OWNS the removal of — each MUST be
// zero across api/src except the migration report tool.
const CATALOG_SYMBOLS: SymbolSpec[] = [
  { name: "MultiQuestionGrid", pattern: /\bMultiQuestionGrid\b/, excludePaths: [REPORT_TOOL] },
  { name: "OtherGroupSelector", pattern: /\bOtherGroupSelector\b/, excludePaths: [REPORT_TOOL] },
  { name: "splitChoicesForOtherGroup", pattern: /\bsplitChoicesForOtherGroup\b/, excludePaths: [REPORT_TOOL] },
  { name: "renderOtherGroupTail", pattern: /\brenderOtherGroupTail\b/, excludePaths: [REPORT_TOOL] },
  { name: "toggleSliderFormat", pattern: /\btoggleSliderFormat\b/, excludePaths: [REPORT_TOOL] },
  // RangeQuestion as a TYPE NAME only — NumberRangeQuestion / CurrencyRangeQuestion
  // are separate tokens (the \b before "R" excludes them: preceding "r"/"y" is a
  // word char, so `\bRangeQuestion` does not match inside them).
  { name: "RangeQuestion (type)", pattern: /\bRangeQuestion\b/, excludePaths: [REPORT_TOOL] },
  { name: "CurrencyRangeQuestion", pattern: /\bCurrencyRangeQuestion\b/, excludePaths: [REPORT_TOOL] },
  // choiceDisplay: the SECTION-content mechanism is removed; the offer-payload
  // subsystem keeps its own (separate feature) — excluded.
  {
    name: "choiceDisplay (section)",
    pattern: /\bchoiceDisplay\b/,
    excludePaths: [REPORT_TOOL, "leadgen/payload.ts", "admin/leadgen/ui-payload-builder.ts"],
  },
];

function liveReferences(spec: SymbolSpec): string[] {
  const hits: string[] = [];
  for (const file of allTsFiles(SRC_ROOT)) {
    const rel = relative(SRC_ROOT, file).replace(/\\/g, "/");
    if (spec.excludePaths.some((p) => rel.includes(p))) continue;
    const codeLines = stripComments(readFileSync(file, "utf8"));
    codeLines.forEach((line, i) => {
      if (spec.pattern.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

describe("LeadGen §10 zero-reference gate — removed catalog types/mechanisms have no live product reference", () => {
  for (const spec of CATALOG_SYMBOLS) {
    it(`${spec.name}: zero live (non-comment) references in api/src`, () => {
      const hits = liveReferences(spec);
      expect(hits, `LIVE references to the §10-removed '${spec.name}':\n${hits.join("\n")}`).toEqual([]);
    });
  }

  // is_control (leadgen DB column, dropped by P1/M1). The listicle subsystem keeps
  // its OWN is_control (separate); the leadgen client key selected_variant_is_control
  // is a DIFFERENT token (\b excludes it). Proven zero across leadgen src.
  it("is_control (leadgen DB column): zero live references outside the listicle subsystem", () => {
    const spec: SymbolSpec = {
      name: "is_control",
      pattern: /\bis_control\b/,
      excludePaths: [REPORT_TOOL, "listicles/", "listicle/"],
    };
    const hits = liveReferences(spec);
    expect(hits, `LIVE leadgen references to the M1-dropped 'is_control':\n${hits.join("\n")}`).toEqual([]);
  });

  // route_funnel_variant (rule type migrated out of leadgen_funnel_rules by P1/M3;
  // the CHECK now forbids it). §10/S5.1 PASS 2 deleted the entire dead evaluation
  // chain this token used to name: the orphaned ROUTING_RULES_SCRIPT panel in
  // admin/leadgen/ui-rules-builder.ts (renderRoutingRulesPanel had 0 call sites),
  // the dead routing machinery in public/leadgen/resolver.ts (isActiveRoutingTarget
  // OnFunnel/detectRoutingRuleConflicts/evaluateEntryRouting/evaluateCheckpoint
  // Routing/parseRoutingRule/loadRoutingRules + ROUTING_ENTRY_KNOWN_FIELDS), and
  // the dead locals + computeRoutingRuleConflictProblems in admin/leadgen/
  // quotes-handlers.ts. The token now survives ONLY inside comments in those same
  // three files (historical §10/S5.1 removal notes citing it by name) — zero live
  // (non-comment) occurrences anywhere, so this guard needs no file exclusions.
  it("route_funnel_variant: zero live references anywhere (P1/M3 migrated + P3b-deferred panel/resolver/handlers swept in §10/S5.1 PASS 2)", () => {
    const spec: SymbolSpec = {
      name: "route_funnel_variant",
      pattern: /\broute_funnel_variant\b/,
      excludePaths: [REPORT_TOOL],
    };
    const hits = liveReferences(spec);
    expect(hits, `unexpected LIVE route_funnel_variant refs:\n${hits.join("\n")}`).toEqual([]);
  });
});
