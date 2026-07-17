// Rules visual condition builder (v2.5.1 04 intro / v2.4 06 §6.10) — slice B3.
//
// Pins:
//   1. SSR renders sentence rows + pickers from stored §21.4 conditions for
//      EVERY supported grammar construct (each op, empty sugar, AND across
//      fields, OR within a field, empty).
//   2. Round-trip: the builder's serialized JSON is accepted by the REAL
//      evaluator stack (funnel.ts validateFunnelRule + auction-rules.ts
//      conditionsMatch — the §21.4 single source) and evaluates IDENTICALLY
//      to the original conditions on fixture answer contexts.
//   3. The ES5 island mirrors the TS parse/serialize byte-for-byte (drift
//      guard), passes the house ES5 parse gate (token scan + node --check),
//      and never contains a backtick / dollar-brace (template-literal-host
//      hazard) / script-closing sequence.
//   4. The data blob is <-escaped (house idiom) and JSON-round-trips.
//   5. Unparseable/unsupported stored conditions fall back to the Advanced
//      raw view preserving the ORIGINAL JSON byte-exactly (hidden output +
//      <pre>), with a warning banner — never destroyed, never re-serialized.
//   6. Normal-mode visible copy carries no raw op/type enum tokens and no
//      hex colors (§6.10 plain-language policy).
//   7. Nesting: the §21.4 grammar allows NO nested groups — nested constructs
//      route to the raw fallback (documented behavior).

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import {
  DEFAULT_RULES_CONDITIONS_INPUT_ID,
  RULES_BUILDER_OPS,
  RULES_BUILDER_SCRIPT,
  parseStoredConditions,
  renderRulesBuilderPanel,
  serializeRows,
  type RulesBuilderRow,
} from "../src/admin/leadgen/ui-rules-builder";
// REAL evaluator stack — the §21.4 single source of truth.
import { conditionsMatch } from "../src/leadgen/auction-rules";
import { validateFunnelRule } from "../src/leadgen/funnel";
import type { LeadgenRuleConditions } from "../src/admin/leadgen/db-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIELDS = [
  { internal_field: "state", label: "State" },
  { internal_field: "age", label: "Age" },
  { internal_field: "homeowner", label: "Owns a home" },
];
const OFFERS = [{ public_id: "ofr_1", name: "NextInsure" }];

function panelFor(conditions: unknown, extra: Record<string, unknown> = {}): string {
  return renderRulesBuilderPanel({
    rules: [{ rule_type: "eligibility", priority: 100, enabled: true, conditions_json: conditions, ...extra }],
    fields: FIELDS,
    offers: OFFERS,
  });
}

// Reverse of layout.ts escapeHtml (amp LAST — escapeHtml escapes it first).
function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function hiddenInputValue(html: string, index = 0): string {
  const re = new RegExp(
    `<input type="hidden" data-rule-conditions data-lg-rb-out data-rule-index="${index}" value="([^"]*)"`,
  );
  const m = html.match(re);
  expect(m, `hidden output input for rule ${index}`).not.toBeNull();
  return unescapeHtml((m as RegExpMatchArray)[1] ?? "");
}

function advancedPre(html: string): string {
  const m = html.match(/<pre class="lg-rb-json" data-lg-rb-json>([\s\S]*?)<\/pre>/);
  expect(m, "advanced <pre> present").not.toBeNull();
  return unescapeHtml((m as RegExpMatchArray)[1] ?? "");
}

function sentenceOf(html: string): string {
  const m = html.match(/<p class="lg-rb-sentence" data-lg-rb-sentence>([\s\S]*?)<\/p>/);
  expect(m, "sentence <p> present").not.toBeNull();
  return unescapeHtml((m as RegExpMatchArray)[1] ?? "");
}

function count(html: string, needle: RegExp): number {
  return (html.match(needle) ?? []).length;
}

// The visible normal-mode copy: everything except scripts, styles and the
// Advanced disclosure, with tags stripped and entities decoded.
function visibleCopy(html: string): string {
  const withoutBlocks = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<details[\s\S]*?<\/details>/gi, " ");
  return unescapeHtml(withoutBlocks.replace(/<[^>]*>/g, " "));
}

// ---------------------------------------------------------------------------
// The ES5 island under a bare VM (no DOM): init must no-op, the pure
// parse/serialize API must be exposed on window.lgRulesBuilder.
// ---------------------------------------------------------------------------

interface IslandParse {
  ok: boolean;
  rows?: unknown[];
  reason?: string;
}
interface IslandApi {
  parseConditions(raw: unknown): IslandParse;
  serializeRows(rows: unknown[]): string;
  cardSentence(rows: unknown[], labelOf: (f: string) => string): string;
  getValues(): Array<{ index: number; json: string }>;
  ops: Array<{ ui: string; label: string; kind: string }>;
}

function islandApi(): IslandApi {
  const windowObj: Record<string, unknown> = {};
  const sandbox = {
    window: windowObj,
    document: { getElementById: (): null => null, readyState: "complete" },
  };
  runInNewContext(RULES_BUILDER_SCRIPT, sandbox);
  const api = windowObj["lgRulesBuilder"];
  expect(api, "window.lgRulesBuilder exposed").toBeTruthy();
  return api as IslandApi;
}

// ---------------------------------------------------------------------------
// Fixtures — every supported §21.4 construct, each with answer contexts that
// cover match / non-match / absent-answer / coercion edges.
// ---------------------------------------------------------------------------

interface Fixture {
  name: string;
  conditions: LeadgenRuleConditions;
  contexts: Array<Record<string, unknown>>;
}

const FIXTURES: Fixture[] = [
  {
    name: "eq string",
    conditions: { groups: [{ field: "state", op: "eq", value: "CA" }] },
    contexts: [{ state: "CA" }, { state: "TX" }, {}, { state: "" }],
  },
  {
    name: "eq boolean",
    conditions: { groups: [{ field: "homeowner", op: "eq", value: true }] },
    contexts: [{ homeowner: true }, { homeowner: false }, { homeowner: "true" }, {}],
  },
  {
    name: "eq number",
    conditions: { groups: [{ field: "age", op: "eq", value: 30 }] },
    contexts: [{ age: 30 }, { age: "30" }, { age: 31 }, {}],
  },
  {
    name: "neq",
    conditions: { groups: [{ field: "state", op: "neq", value: "CA" }] },
    contexts: [{ state: "CA" }, { state: "TX" }, {}],
  },
  {
    name: "gt",
    conditions: { groups: [{ field: "age", op: "gt", value: 25 }] },
    contexts: [{ age: 26 }, { age: 25 }, { age: "40" }, { age: "x" }, {}],
  },
  {
    name: "lt",
    conditions: { groups: [{ field: "age", op: "lt", value: 25 }] },
    contexts: [{ age: 24 }, { age: 25 }, { age: "10" }, {}],
  },
  {
    name: "gte",
    conditions: { groups: [{ field: "age", op: "gte", value: 25 }] },
    contexts: [{ age: 25 }, { age: 24 }, { age: "25" }, {}],
  },
  {
    name: "lte",
    conditions: { groups: [{ field: "age", op: "lte", value: 25 }] },
    contexts: [{ age: 25 }, { age: 26 }, { age: "20" }, {}],
  },
  {
    name: "range (inclusive)",
    conditions: { groups: [{ field: "age", op: "range", from: 25, to: 64 }] },
    contexts: [{ age: 25 }, { age: 64 }, { age: 24 }, { age: 65 }, { age: "40" }, {}],
  },
  {
    name: "in",
    conditions: { groups: [{ field: "state", op: "in", values: ["CA", "TX"] }] },
    contexts: [{ state: "CA" }, { state: "FL" }, {}],
  },
  {
    name: "not_in",
    conditions: { groups: [{ field: "n", op: "not_in", values: [1, 2] }] },
    contexts: [{ n: 3 }, { n: 1 }, {}],
  },
  {
    name: "is-empty sugar (eq empty string)",
    conditions: { groups: [{ field: "state", op: "eq", value: "" }] },
    contexts: [{ state: "" }, { state: "CA" }, {}],
  },
  {
    name: "is-not-empty sugar (neq empty string)",
    conditions: { groups: [{ field: "state", op: "neq", value: "" }] },
    contexts: [{ state: "" }, { state: "CA" }, {}],
  },
  {
    name: "AND group (distinct fields)",
    conditions: {
      groups: [
        { field: "age", op: "gte", value: 25 },
        { field: "state", op: "eq", value: "CA" },
      ],
    },
    contexts: [
      { age: 30, state: "CA" },
      { age: 20, state: "CA" },
      { age: 30, state: "TX" },
      {},
    ],
  },
  {
    name: "OR group (same field twice)",
    conditions: {
      groups: [
        { field: "state", op: "eq", value: "CA" },
        { field: "state", op: "eq", value: "TX" },
      ],
    },
    contexts: [{ state: "CA" }, { state: "TX" }, { state: "FL" }, {}],
  },
  {
    name: "mixed AND + OR",
    conditions: {
      groups: [
        { field: "state", op: "eq", value: "CA" },
        { field: "age", op: "range", from: 25, to: 64 },
        { field: "state", op: "in", values: ["TX", "FL"] },
      ],
    },
    contexts: [
      { state: "CA", age: 30 },
      { state: "TX", age: 30 },
      { state: "NV", age: 30 },
      { state: "CA", age: 70 },
      {},
    ],
  },
  {
    name: "interleaved same-field entries (order independence)",
    conditions: {
      groups: [
        { field: "state", op: "eq", value: "CA" },
        { field: "age", op: "gte", value: 21 },
        { field: "state", op: "eq", value: "TX" },
      ],
    },
    contexts: [
      { state: "TX", age: 30 },
      { state: "CA", age: 18 },
      { state: "NV", age: 30 },
    ],
  },
  {
    name: "empty groups (always matches)",
    conditions: { groups: [] },
    contexts: [{}, { anything: 1 }],
  },
];

// All-ops single rule for SSR structure assertions.
const ALL_OPS: LeadgenRuleConditions = {
  groups: [
    { field: "state", op: "eq", value: "CA" },
    { field: "state", op: "neq", value: "NY" },
    { field: "age", op: "gt", value: 18 },
    { field: "age", op: "lt", value: 99 },
    { field: "age", op: "gte", value: 21 },
    { field: "age", op: "lte", value: 80 },
    { field: "age", op: "range", from: 25, to: 64 },
    { field: "state", op: "in", values: ["CA", "TX"] },
    { field: "state", op: "not_in", values: ["AK"] },
  ],
};

// ---------------------------------------------------------------------------
// 1 · SSR: rows + pickers from stored conditions
// ---------------------------------------------------------------------------

describe("rules builder — SSR rows from stored conditions", () => {
  it("renders one sentence row per §21.4 entry with the op picker pre-selected (every supported op)", () => {
    const html = panelFor(ALL_OPS);
    expect(html).toContain('id="lg-rules-builder-root"');
    expect(html).toContain(`data-target-input="${DEFAULT_RULES_CONDITIONS_INPUT_ID}"`);
    expect(count(html, /data-lg-rb-row/g)).toBe(9);
    for (const op of ["eq", "neq", "gt", "lt", "gte", "lte", "range", "in", "not_in"]) {
      expect(html, `op ${op} selected somewhere`).toContain(`<option value="${op}" selected>`);
    }
    // Typed value controls: text value, range bounds, list chips.
    expect(html).toContain('value="CA"');
    expect(html).toContain('data-lg-rb-from type="number" step="any" aria-label="From" value="25"');
    expect(html).toContain('data-lg-rb-to type="number" step="any" aria-label="To" value="64"');
    expect(count(html, /data-lg-rb-chip /g)).toBe(3); // CA, TX, AK
    // Field picker uses the operator-facing labels.
    expect(html).toContain(">State</option>");
    expect(html).toContain(">Age</option>");
  });

  it("clusters express §21.4 semantics: OR inside a field cluster, AND between clusters", () => {
    const html = panelFor(ALL_OPS);
    // Normalized: state-cluster (4 rows) + age-cluster (5 rows).
    expect(count(html, /data-lg-rb-cluster /g)).toBe(2);
    expect(count(html, /data-lg-rb-andsep/g)).toBe(1);
    expect(count(html, /data-lg-rb-orsep/g)).toBe(7); // (4-1) + (5-1)

    const orOnly = panelFor({
      groups: [
        { field: "state", op: "eq", value: "CA" },
        { field: "state", op: "eq", value: "TX" },
      ],
    });
    expect(count(orOnly, /data-lg-rb-cluster /g)).toBe(1);
    expect(count(orOnly, /data-lg-rb-andsep/g)).toBe(0);
    expect(count(orOnly, /data-lg-rb-orsep/g)).toBe(1);

    const andOnly = panelFor({
      groups: [
        { field: "age", op: "gte", value: 25 },
        { field: "state", op: "eq", value: "CA" },
      ],
    });
    expect(count(andOnly, /data-lg-rb-cluster /g)).toBe(2);
    expect(count(andOnly, /data-lg-rb-andsep/g)).toBe(1);
    expect(count(andOnly, /data-lg-rb-orsep/g)).toBe(0);
  });

  it("renders the §6.10 live preview sentence from field labels", () => {
    const s = sentenceOf(panelFor(ALL_OPS));
    expect(s.startsWith("Matches when (State is ")).toBe(true);
    expect(s).toContain('State is any of "CA", "TX"');
    expect(s).toContain('State is none of "AK"');
    expect(s).toContain("Age is between 25 and 64");
    expect(s).toContain(") and (");
    expect(s.endsWith(".")).toBe(true);
  });

  it("renders empty-string eq/neq as the is-empty/is-not-empty sugar", () => {
    const emptyEq = panelFor({ groups: [{ field: "state", op: "eq", value: "" }] });
    expect(emptyEq).toContain('<option value="is_empty" selected>');
    expect(sentenceOf(emptyEq)).toBe("Matches when State is empty.");
    const emptyNeq = panelFor({ groups: [{ field: "state", op: "neq", value: "" }] });
    expect(emptyNeq).toContain('<option value="not_empty" selected>');
    expect(sentenceOf(emptyNeq)).toBe("Matches when State is not empty.");
  });

  it("renders boolean values as a Yes/no picker (typed per §6.10)", () => {
    const html = panelFor({ groups: [{ field: "homeowner", op: "eq", value: true }] });
    expect(html).toContain('<option value="bool" selected>Yes/no</option>');
    expect(html).toContain('<option value="yes" selected>Yes</option>');
    expect(sentenceOf(html)).toBe("Matches when Owns a home is Yes.");
  });

  it("empty conditions render the always-matches state and a usable empty builder", () => {
    const html = panelFor({ groups: [] });
    expect(html).toContain("data-lg-rb-empty");
    expect(sentenceOf(html)).toBe("Always matches — no conditions.");
    expect(hiddenInputValue(html)).toBe('{"groups":[]}');
    // No rules at all → still one editable card.
    const bare = renderRulesBuilderPanel({ rules: [], fields: FIELDS, offers: OFFERS });
    expect(count(bare, /data-lg-rb-card/g)).toBe(1);
    expect(hiddenInputValue(bare)).toBe('{"groups":[]}');
  });

  it("honors the documented target_input_id option (default otherwise)", () => {
    const custom = renderRulesBuilderPanel({
      rules: [],
      fields: FIELDS,
      offers: OFFERS,
      target_input_id: "my-conditions-input",
    });
    expect(custom).toContain('data-target-input="my-conditions-input"');
    expect(panelFor({ groups: [] })).toContain(
      `data-target-input="${DEFAULT_RULES_CONDITIONS_INPUT_ID}"`,
    );
  });

  it("stored fields outside the picker list stay editable as custom options (never dropped)", () => {
    const html = panelFor({ groups: [{ field: "utm_source", op: "eq", value: "meta" }] });
    expect(html).toContain('<option value="utm_source" selected>utm_source (custom)</option>');
    expect(sentenceOf(html)).toBe('Matches when utm_source is "meta".');
    const round = JSON.parse(hiddenInputValue(html)) as LeadgenRuleConditions;
    expect(round).toEqual({ groups: [{ field: "utm_source", op: "eq", value: "meta" }] });
  });

  it("accepts the ui-quotes.ts host shape: rules[] = BARE conditions documents (object or JSON string)", () => {
    // The host passes `selected.rules.map((r) => r.conditions_json ?? {groups: []})`.
    const html = renderRulesBuilderPanel({
      rules: [
        { groups: [{ field: "state", op: "eq", value: "CA" }] },
        '{"groups":[{"field":"age","op":"gte","value":21}]}',
        { groups: [] },
      ],
      fields: FIELDS,
      offers: OFFERS,
    });
    expect(count(html, /data-lg-rb-card/g)).toBe(3);
    // Card 0 (bare object) renders its row — NOT an empty builder.
    expect(JSON.parse(hiddenInputValue(html, 0))).toEqual({
      groups: [{ field: "state", op: "eq", value: "CA" }],
    });
    // Card 1 (bare JSON string) parses too.
    expect(JSON.parse(hiddenInputValue(html, 1))).toEqual({
      groups: [{ field: "age", op: "gte", value: 21 }],
    });
    // Card 2 is the empty (always-matches) builder.
    expect(hiddenInputValue(html, 2)).toBe('{"groups":[]}');
    expect(count(html, /data-mode="raw"/g)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2 · Round-trip through the REAL evaluator
// ---------------------------------------------------------------------------

describe("rules builder — serialization round-trip against the real evaluator", () => {
  it("every supported fixture re-parses, passes validateFunnelRule, and evaluates identically (object + string inputs)", () => {
    for (const fixture of FIXTURES) {
      for (const input of [fixture.conditions, JSON.stringify(fixture.conditions)]) {
        const parsed = parseStoredConditions(input);
        expect(parsed.ok, `${fixture.name}: parse ok`).toBe(true);
        if (!parsed.ok) continue;
        const json = serializeRows(parsed.rows);
        const reparsed = JSON.parse(json) as LeadgenRuleConditions;

        // The evaluator MODULE accepts it: funnel.ts §21.4 validation is clean.
        const verdict = validateFunnelRule(
          { rule_type: "eligibility", conditions_json: reparsed },
          [],
        );
        expect(verdict.errors, `${fixture.name}: validateFunnelRule clean`).toEqual([]);
        expect(verdict.ok).toBe(true);

        // Identical evaluation on every fixture context.
        for (const ctx of fixture.contexts) {
          expect(
            conditionsMatch(reparsed, ctx),
            `${fixture.name} on ${JSON.stringify(ctx)}`,
          ).toBe(conditionsMatch(fixture.conditions, ctx));
        }
      }
    }
  });

  it("spot-checks concrete verdicts survive the round-trip (not just symmetry)", () => {
    const roundTrip = (c: LeadgenRuleConditions): LeadgenRuleConditions => {
      const parsed = parseStoredConditions(c);
      expect(parsed.ok).toBe(true);
      return JSON.parse(serializeRows(parsed.ok ? parsed.rows : [])) as LeadgenRuleConditions;
    };
    const eq = roundTrip({ groups: [{ field: "state", op: "eq", value: "CA" }] });
    expect(conditionsMatch(eq, { state: "CA" })).toBe(true);
    expect(conditionsMatch(eq, { state: "TX" })).toBe(false);
    expect(conditionsMatch(eq, {})).toBe(false);

    const or = roundTrip({
      groups: [
        { field: "state", op: "eq", value: "CA" },
        { field: "state", op: "eq", value: "TX" },
      ],
    });
    expect(conditionsMatch(or, { state: "TX" })).toBe(true);
    expect(conditionsMatch(or, { state: "FL" })).toBe(false);

    const empty = roundTrip({ groups: [] });
    expect(conditionsMatch(empty, {})).toBe(true);

    // Boolean identity preserved as a REAL boolean through the round-trip.
    // CONDUCTOR FIX (register PC-12, 2026-07-17): conditionsMatch (via
    // payload.ts conditionalMet) now treats true≡"true"/false≡"false" for
    // eq/neq/in/not_in — a boolean-authored eq now ALSO matches a live-
    // recorded STRING answer (a TwoButtonYesNo's live click records the raw
    // string "true"/"false", not a real boolean — see conditionalMet's own
    // module comment). This assertion used to pin the pre-fix strict-===
    // behavior as correct; it now pins the fixed, intent-restoring behavior.
    const boolCond = roundTrip({ groups: [{ field: "homeowner", op: "eq", value: true }] });
    expect(conditionsMatch(boolCond, { homeowner: true })).toBe(true);
    expect(conditionsMatch(boolCond, { homeowner: "true" })).toBe(true);
  });

  it("the SSR hidden output itself is the round-tripped JSON the evaluator accepts", () => {
    const html = panelFor(ALL_OPS);
    const value = hiddenInputValue(html);
    const reparsed = JSON.parse(value) as LeadgenRuleConditions;
    expect(validateFunnelRule({ rule_type: "eligibility", conditions_json: reparsed }, []).ok).toBe(
      true,
    );
    for (const ctx of [{ state: "CA", age: 30 }, { state: "TX", age: 30 }, { state: "CA", age: 17 }, {}]) {
      expect(conditionsMatch(reparsed, ctx)).toBe(conditionsMatch(ALL_OPS, ctx));
    }
  });

  it("nested grouping is NOT part of the §21.4 grammar — nested constructs route to fallback, never a lossy re-serialize", () => {
    const nested = {
      groups: [
        { field: "a", op: "in", values: [{ nested: true }] },
      ],
    };
    const parsed = parseStoredConditions(nested);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("value_shape_unsupported");
  });

  it("empty rows serialize to the existing textarea default byte-exactly", () => {
    expect(serializeRows([])).toBe('{"groups":[]}');
  });

  it("the builder op set covers exactly the evaluator vocabulary (plus the two empty sugars)", () => {
    const storage = new Set(RULES_BUILDER_OPS.map((o) => o.storage));
    expect([...storage].sort()).toEqual(
      ["eq", "gt", "gte", "in", "lt", "lte", "neq", "not_in", "range"].sort(),
    );
    // §6.10: unsupported operators are omitted — never disabled-but-visible.
    expect(RULES_BUILDER_OPS.some((o) => (o.ui as string) === "contains")).toBe(false);
    // Every storage op individually passes the funnel-rule validator.
    for (const op of storage) {
      const conditions =
        op === "range"
          ? { groups: [{ field: "age", op, from: 1, to: 2 }] }
          : op === "in" || op === "not_in"
            ? { groups: [{ field: "age", op, values: ["x"] }] }
            : { groups: [{ field: "age", op, value: 1 }] };
      expect(
        validateFunnelRule({ rule_type: "eligibility", conditions_json: conditions }, []).ok,
        `evaluator accepts op ${op}`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3 · ES5 island: parse gate + TS/ES5 parity
// ---------------------------------------------------------------------------

const scratchDir = mkdtempSync(join(tmpdir(), "leadgen-rules-builder-es5-"));

describe("rules builder — ES5 island", () => {
  it("passes the house ES5 gate: token scan + node --check, and is safe inside a template-literal host + <script> tag", () => {
    expect(RULES_BUILDER_SCRIPT).not.toMatch(/=>/);
    expect(RULES_BUILDER_SCRIPT).not.toMatch(/\bconst\b/);
    expect(RULES_BUILDER_SCRIPT).not.toMatch(/\blet\b/);
    expect(RULES_BUILDER_SCRIPT).not.toMatch(/\basync\b/);
    expect(RULES_BUILDER_SCRIPT).not.toMatch(/\bawait\b/);
    expect(RULES_BUILDER_SCRIPT).not.toContain("`");
    expect(RULES_BUILDER_SCRIPT).not.toContain("${");
    expect(RULES_BUILDER_SCRIPT).not.toContain("</script");
    const file = join(scratchDir, "rules-builder-island.js");
    writeFileSync(file, RULES_BUILDER_SCRIPT, "utf-8");
    // Throws (failing the test) on any parse error.
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  });

  it("initializes as a no-op without the panel DOM and exposes the pure api", () => {
    const api = islandApi();
    expect(typeof api.parseConditions).toBe("function");
    expect(typeof api.serializeRows).toBe("function");
    expect(api.getValues()).toEqual([]);
    expect(api.ops.map((o) => o.ui)).toEqual(RULES_BUILDER_OPS.map((o) => o.ui));
  });

  it("island parse+serialize is byte-identical to the TS side for every fixture (drift guard)", () => {
    const api = islandApi();
    for (const fixture of FIXTURES) {
      const text = JSON.stringify(fixture.conditions);
      const tsParsed = parseStoredConditions(text);
      const jsParsed = api.parseConditions(text);
      expect(jsParsed.ok, `${fixture.name}: island parse ok`).toBe(tsParsed.ok);
      if (!tsParsed.ok || !jsParsed.ok) continue;
      const tsJson = serializeRows(tsParsed.rows);
      const jsJson = api.serializeRows(jsParsed.rows ?? []);
      expect(jsJson, `${fixture.name}: identical serialization`).toBe(tsJson);
      // And the island's output is evaluator-identical to the original too.
      const reparsed = JSON.parse(jsJson) as LeadgenRuleConditions;
      for (const ctx of fixture.contexts) {
        expect(conditionsMatch(reparsed, ctx)).toBe(conditionsMatch(fixture.conditions, ctx));
      }
    }
  });

  it("island rejects the same unsupported constructs with the same reasons", () => {
    const api = islandApi();
    const cases: Array<[unknown, string]> = [
      ["not json {{{", "invalid_json"],
      ["[]", "not_object"],
      [JSON.stringify({ groups: [{ field: "a", op: "contains", value: "x" }] }), "op_unsupported"],
      [JSON.stringify({ groups: [{ field: "a", op: "gt", value: "25" }] }), "value_shape_unsupported"],
      [JSON.stringify({ groups: [], note: "extra" }), "extra_root_keys"],
      [JSON.stringify({ groups: [{ field: "a", op: "eq", value: "x", extra: 1 }] }), "extra_entry_keys"],
      [JSON.stringify({ groups: [{ field: "a", op: "in", values: [{ nested: 1 }] }] }), "value_shape_unsupported"],
    ];
    for (const [input, reason] of cases) {
      const ts = parseStoredConditions(input);
      const js = api.parseConditions(input);
      expect(ts.ok).toBe(false);
      expect(js.ok).toBe(false);
      if (!ts.ok) expect(ts.reason).toBe(reason);
      expect(js.reason).toBe(reason);
    }
    // Empty inputs are fine on both sides.
    expect(api.parseConditions("").ok).toBe(true);
    expect(api.serializeRows([])).toBe('{"groups":[]}');
  });

  it("island sentences match the SSR sentence for the all-ops fixture", () => {
    const api = islandApi();
    const parsed = api.parseConditions(JSON.stringify(ALL_OPS));
    expect(parsed.ok).toBe(true);
    const labelOf = (f: string): string => {
      const hit = FIELDS.find((x) => x.internal_field === f);
      return hit === undefined ? f : hit.label;
    };
    expect(api.cardSentence(parsed.rows ?? [], labelOf)).toBe(sentenceOf(panelFor(ALL_OPS)));
  });
});

// ---------------------------------------------------------------------------
// 4 · Data blob
// ---------------------------------------------------------------------------

describe("rules builder — data blob", () => {
  it("is <-escaped (house idiom) and JSON-round-trips hostile content", () => {
    const hostileLabel = "<b>Zip</b>";
    const hostileValue = '</script><img src=x>';
    const html = renderRulesBuilderPanel({
      rules: [
        {
          rule_type: "eligibility",
          conditions_json: { groups: [{ field: "zip", op: "eq", value: hostileValue }] },
        },
      ],
      fields: [{ internal_field: "zip", label: hostileLabel }],
      offers: OFFERS,
    });
    const m = html.match(
      /<script id="lg-rules-builder-data" type="application\/json">([\s\S]*?)<\/script>/,
    );
    expect(m).not.toBeNull();
    const blob = (m as RegExpMatchArray)[1] ?? "";
    expect(blob).not.toContain("<");
    const data = JSON.parse(blob) as {
      target_input_id: string;
      fields: Array<{ internal_field: string; label: string }>;
      offers: Array<{ public_id: string; name: string }>;
      rules: Array<{ index: number; parsed_rows: Array<{ value?: unknown }> | null }>;
    };
    expect(data.target_input_id).toBe(DEFAULT_RULES_CONDITIONS_INPUT_ID);
    expect(data.fields[0]?.label).toBe(hostileLabel);
    expect(data.offers[0]?.name).toBe("NextInsure");
    expect(data.rules[0]?.parsed_rows?.[0]?.value).toBe(hostileValue);
  });
});

// ---------------------------------------------------------------------------
// 5 · Unparseable / unsupported fallback — byte-exact preservation
// ---------------------------------------------------------------------------

describe("rules builder — raw fallback preserves the original JSON byte-exactly", () => {
  const RAW_UNSUPPORTED =
    '{"groups":[{"field":"a","op":"in","values":[{"deep":1}]}],"note":"keep me"}';

  it("unsupported constructs: warning banner + Advanced view + hidden output all carry the original bytes", () => {
    const html = panelFor(RAW_UNSUPPORTED);
    expect(html).toContain('data-mode="raw"');
    expect(html).toContain("data-lg-rb-warning");
    // FIX 6a (15 §15.2): the banner speaks OPERATOR words — the preservation
    // promise stays, "JSON" lives only inside the Advanced details below.
    expect(html).toContain("The original settings are preserved exactly.");
    const warningText = html.match(/data-lg-rb-warning>([^<]*)</)?.[1] ?? "";
    expect(warningText, "banner copy present").not.toBe("");
    expect(warningText, "no 'JSON' outside Advanced").not.toMatch(/\bJSON\b/i);
    expect(html).toContain("<details class=\"lg-rb-advanced\" data-lg-rb-advanced open>");
    expect(advancedPre(html)).toBe(RAW_UNSUPPORTED);
    expect(hiddenInputValue(html)).toBe(RAW_UNSUPPORTED);
    // No visual editors on a fallback card.
    expect(html).not.toContain("data-lg-rb-row");
  });

  it("invalid JSON strings are preserved verbatim too", () => {
    const garbage = 'not json {{{ "unterminated';
    const html = panelFor(garbage);
    expect(html).toContain('data-unsupported-reason="invalid_json"');
    expect(advancedPre(html)).toBe(garbage);
    expect(hiddenInputValue(html)).toBe(garbage);
  });

  it("a string numeric bound (semantics trap: never-matching gt) is NOT silently converted", () => {
    const trap = '{"groups":[{"field":"age","op":"gt","value":"25"}]}';
    const html = panelFor(trap);
    expect(html).toContain('data-unsupported-reason="value_shape_unsupported"');
    expect(hiddenInputValue(html)).toBe(trap);
  });

  it("a fallback card never breaks sibling visual cards in the same panel", () => {
    const html = renderRulesBuilderPanel({
      rules: [
        { rule_type: "eligibility", conditions_json: RAW_UNSUPPORTED },
        { rule_type: "skip_section", conditions_json: { groups: [{ field: "state", op: "eq", value: "CA" }] } },
      ],
      fields: FIELDS,
      offers: OFFERS,
    });
    expect(count(html, /data-lg-rb-card/g)).toBe(2);
    expect(hiddenInputValue(html, 0)).toBe(RAW_UNSUPPORTED);
    expect(JSON.parse(hiddenInputValue(html, 1))).toEqual({
      groups: [{ field: "state", op: "eq", value: "CA" }],
    });
  });
});

// ---------------------------------------------------------------------------
// 6 · Plain-language copy discipline
// ---------------------------------------------------------------------------

describe("rules builder — normal-mode copy", () => {
  it("contains no raw op/type enum tokens and no hex colors", () => {
    const html = renderRulesBuilderPanel({
      rules: [
        {
          rule_type: "redirect_direct_offer",
          priority: 10,
          enabled: false,
          target_offer_public_id: "ofr_1",
          conditions_json: ALL_OPS,
        },
        { rule_type: "eligibility", conditions_json: { groups: [{ field: "homeowner", op: "eq", value: true }] } },
        { rule_type: "auction_entry", conditions_json: "not json {{{" },
      ],
      fields: FIELDS,
      offers: OFFERS,
    });
    const copy = visibleCopy(html);
    for (const token of [
      "not_in",
      "neq",
      "gte",
      "lte",
      "is_empty",
      "conditions_json",
      "rule_type",
      "redirect_direct_offer",
      "auction_entry",
      "boolean",
    ]) {
      expect(copy, `raw token ${token} leaked into visible copy`).not.toMatch(
        new RegExp(`\\b${token}\\b`),
      );
    }
    expect(copy).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // Plain-language rule labels + offer chip are what the operator sees.
    expect(copy).toContain("Redirect to offer");
    expect(copy).toContain("NextInsure");
    expect(copy).toContain("Disabled");
    expect(copy).toContain("Auction entry");
  });
});
