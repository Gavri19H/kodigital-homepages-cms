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
  QUOTE_RULES_SCRIPT,
  RULES_BUILDER_OPS,
  RELOCATED_RULES_SCRIPT,
  RULES_BUILDER_SCRIPT,
  clockFromPicker,
  clockToPicker,
  clockValueText,
  conditionsSentence,
  parseStoredConditions,
  renderQuoteRulesRail,
  renderRulesBuilderPanel,
  ruleValueText,
  serializeRows,
  type RulesBuilderClockInput,
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

// The date / time-of-day visitor facts (rule-fields.ts shape) + one plain
// number field that must read exactly as before.
const CLOCK_FIELDS: Array<{ internal_field: string; label: string; input?: RulesBuilderClockInput }> = [
  { internal_field: "date_et", label: "Date (US Eastern)", input: "date" },
  { internal_field: "time_et", label: "Time of day (US Eastern)", input: "time" },
  { internal_field: "age", label: "Age" },
];

function clockPanelFor(conditions: unknown): string {
  return renderRulesBuilderPanel({
    rules: [{ rule_type: "eligibility", conditions_json: conditions }],
    fields: CLOCK_FIELDS,
    offers: OFFERS,
  });
}

function clockLabelOf(f: string): string {
  const hit = CLOCK_FIELDS.find((x) => x.internal_field === f);
  return hit === undefined ? f : hit.label;
}

// [stored conditions, the sentence both sides must print]
const CLOCK_SENTENCES: Array<[LeadgenRuleConditions, string]> = [
  [{ groups: [{ field: "date_et", op: "eq", value: 20261001 }] }, 'Matches when Date (US Eastern) is "1 Oct 2026".'],
  [{ groups: [{ field: "time_et", op: "range", from: 930, to: 1700 }] }, "Matches when Time of day (US Eastern) is between 9:30 and 17:00."],
  [{ groups: [{ field: "time_et", op: "neq", value: 5 }] }, 'Matches when Time of day (US Eastern) is not "0:05".'],
  [{ groups: [{ field: "date_et", op: "gte", value: 20261031 }] }, 'Matches when Date (US Eastern) is at least "31 Oct 2026".'],
  [{ groups: [{ field: "time_et", op: "lt", value: 1745 }] }, 'Matches when Time of day (US Eastern) is less than "17:45".'],
  [
    { groups: [{ field: "date_et", op: "in", values: [20261001, 20261225] }] },
    'Matches when Date (US Eastern) is any of "1 Oct 2026", "25 Dec 2026".',
  ],
  [{ groups: [{ field: "date_et", op: "range", from: 20261001, to: 20261031 }] }, "Matches when Date (US Eastern) is between 1 Oct 2026 and 31 Oct 2026."],
  // not a real date / unset → the stored number, unquoted (as before)
  [{ groups: [{ field: "date_et", op: "eq", value: 0 }] }, "Matches when Date (US Eastern) is 0."],
  [{ groups: [{ field: "date_et", op: "eq", value: 20260230 }] }, "Matches when Date (US Eastern) is 20260230."],
  // the plain number field: unchanged wording
  [{ groups: [{ field: "age", op: "range", from: 25, to: 64 }] }, "Matches when Age is between 25 and 64."],
  [{ groups: [{ field: "age", op: "eq", value: 30 }] }, "Matches when Age is 30."],
  [
    {
      groups: [
        { field: "date_et", op: "eq", value: 20261225 },
        { field: "time_et", op: "range", from: 0, to: 2359 },
        { field: "age", op: "gte", value: 21 },
      ],
    },
    'Matches when Date (US Eastern) is "25 Dec 2026" and Time of day (US Eastern) is between 0:00 and 23:59 and Age is at least 21.',
  ],
];

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
  cardSentence(rows: unknown[], labelOf: (f: string) => string, valueOf?: unknown, joinWord?: string): string;
  makeValueOf(fields: unknown[]): (field: string, v: unknown) => string;
  clockValueText(input: string, n: unknown): string;
  clockToPicker(input: string, n: unknown): string;
  clockFromPicker(input: string, s: unknown): number | null;
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

    // Date / time-of-day fields (owner residual "Date is typed as a number,
    // Time of day is whole hours only"): both sides read the stored numbers
    // in words, range ends included; the plain number field reads as before.
    const islandValueOf = api.makeValueOf(CLOCK_FIELDS);
    for (const [conditions, expected] of CLOCK_SENTENCES) {
      const ssr = sentenceOf(clockPanelFor(conditions));
      const island = api.parseConditions(JSON.stringify(conditions));
      expect(island.ok).toBe(true);
      expect(ssr, JSON.stringify(conditions)).toBe(expected);
      expect(api.cardSentence(island.rows ?? [], clockLabelOf, islandValueOf), JSON.stringify(conditions)).toBe(ssr);
    }
  });

  // Review fix 2026-10-01: the pop-up's "Match: ANY" used to read "and"
  // between conditions though the engine (now) ORs them.
  it("\"Match: ANY\" reads \"or\" between conditions; ALL keeps \"and\"; the pop-up re-words on change", () => {
    const api = islandApi();
    const parsed = api.parseConditions(JSON.stringify({ groups: [{ field: "state", op: "eq", value: "CA" }, { field: "device", op: "eq", value: "mobile" }] }));
    expect(parsed.ok).toBe(true);
    const labelOf = (f: string): string => f;
    const all = api.cardSentence(parsed.rows ?? [], labelOf, undefined, "and");
    const any = api.cardSentence(parsed.rows ?? [], labelOf, undefined, "or");
    expect(all).toContain(" and ");
    expect(all).not.toContain(" or ");
    expect(any).toContain(" or ");
    expect(any).not.toContain(" and ");
    expect(RULES_BUILDER_SCRIPT).toContain("joinWord: opts.match === 'any' ? 'or' : 'and'");
    expect(RULES_BUILDER_SCRIPT).toContain("setMatch: function (mode)");
    expect(RELOCATED_RULES_SCRIPT).toContain("mountedConditions.setMatch(matchEl.value)");
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

// ---------------------------------------------------------------------------
// 7 · Date / time-of-day fields (PM: "Support other conditions such as (Date,
//     State, Time of day, …)"; owner residual "Date is typed as a number, Time
//     of day is whole hours only"). Stored values stay NUMBERS — date YYYYMMDD,
//     time HHMM, US Eastern — read in words, edited with the browser's pickers.
// ---------------------------------------------------------------------------

// [input, stored number, words, picker string]
const CLOCK_TABLE: Array<[RulesBuilderClockInput, number, string, string]> = [
  ["date", 20261001, "1 Oct 2026", "2026-10-01"],
  ["date", 20261031, "31 Oct 2026", "2026-10-31"],
  ["date", 20260105, "5 Jan 2026", "2026-01-05"],
  ["date", 20261225, "25 Dec 2026", "2026-12-25"],
  ["date", 20240229, "29 Feb 2024", "2024-02-29"],
  ["date", 20000229, "29 Feb 2000", "2000-02-29"],
  ["time", 930, "9:30", "09:30"],
  ["time", 1745, "17:45", "17:45"],
  ["time", 5, "0:05", "00:05"],
  ["time", 0, "0:00", "00:00"],
  ["time", 1200, "12:00", "12:00"],
  ["time", 2359, "23:59", "23:59"],
];

// Not a real date / time of day → words = the number itself, picker empty.
const CLOCK_INVALID: Array<[RulesBuilderClockInput, number]> = [
  ["date", 0],
  ["date", 20260230],
  ["date", 20250229],
  ["date", 19000229],
  ["date", 20261300],
  ["date", 20261000],
  ["date", 2026101],
  ["date", 20261001.5],
  ["date", -20261001],
  ["time", 960],
  ["time", 2400],
  ["time", -5],
  ["time", 930.5],
  ["time", 12345],
];

describe("rules builder — date / time-of-day values", () => {
  it("clockValueText reads a stored date / time in words (day month year; 24-hour h:mm)", () => {
    for (const [input, n, words] of CLOCK_TABLE) {
      expect(clockValueText(input, n), `${input} ${n}`).toBe(words);
    }
    for (const [input, n] of CLOCK_INVALID) {
      expect(clockValueText(input, n), `${input} ${n}`).toBe(String(n));
    }
  });

  it("picker strings convert both ways: '2026-10-01' <-> 20261001, '09:30' <-> 930, '00:05' <-> 5", () => {
    for (const [input, n, , picker] of CLOCK_TABLE) {
      expect(clockToPicker(input, n), `${input} ${n}`).toBe(picker);
      expect(clockFromPicker(input, picker), `${input} ${picker}`).toBe(n);
    }
    for (const [input, n] of CLOCK_INVALID) {
      expect(clockToPicker(input, n), `${input} ${n}`).toBe("");
    }
    // A browser may append seconds to a time; they are ignored.
    expect(clockFromPicker("time", "17:45:12")).toBe(1745);
    expect(clockFromPicker("time", "09:30:00.000")).toBe(930);
    // Empty / half-typed / impossible picker values store nothing (null).
    for (const [input, s] of [
      ["date", ""],
      ["date", "2026-02-30"],
      ["date", "2026-13-01"],
      ["date", "2026-1-1"],
      ["date", "20261001"],
      ["time", ""],
      ["time", "24:00"],
      ["time", "09:60"],
      ["time", "9:30"],
    ] as Array<[RulesBuilderClockInput, string]>) {
      expect(clockFromPicker(input, s), `${input} "${s}"`).toBeNull();
    }
    expect(clockFromPicker("date", undefined)).toBeNull();
  });

  it("the island's conversions agree with the TS ones on the whole table", () => {
    const api = islandApi();
    for (const [input, n, words, picker] of CLOCK_TABLE) {
      expect(api.clockValueText(input, n)).toBe(words);
      expect(api.clockValueText(input, n)).toBe(clockValueText(input, n));
      expect(api.clockToPicker(input, n)).toBe(picker);
      expect(api.clockFromPicker(input, picker)).toBe(n);
    }
    for (const [input, n] of CLOCK_INVALID) {
      expect(api.clockValueText(input, n)).toBe(clockValueText(input, n));
      expect(api.clockToPicker(input, n)).toBe(clockToPicker(input, n));
    }
    for (const s of ["", "2026-02-30", "2026-10-01", "17:45:12", "24:00", "00:05", "x"]) {
      for (const input of ["date", "time"] as RulesBuilderClockInput[]) {
        expect(api.clockFromPicker(input, s), `${input} "${s}"`).toBe(clockFromPicker(input, s));
      }
    }
  });

  it("the island value resolver formats clock-field numbers like the TS one; other fields unchanged", () => {
    const api = islandApi();
    const valueOf = api.makeValueOf(CLOCK_FIELDS);
    const byField = new Map(CLOCK_FIELDS.map((f) => [f.internal_field, f]));
    const cases: Array<[string, string | number | boolean]> = [
      ["date_et", 20261001],
      ["date_et", 0],
      ["date_et", "20261001"],
      ["time_et", 930],
      ["time_et", 5],
      ["time_et", 960],
      ["age", 30],
      ["age", 20261001],
      ["unknown", 930],
    ];
    for (const [field, v] of cases) {
      expect(valueOf(field, v), `${field} ${String(v)}`).toBe(ruleValueText(byField.get(field), v));
    }
    expect(valueOf("date_et", 20261001)).toBe("1 Oct 2026");
    expect(valueOf("time_et", 930)).toBe("9:30");
    expect(valueOf("age", 20261001)).toBe("20261001");
  });

  it("SSR renders calendar / clock pickers for date / time fields (no value-type select) and keeps the numbers in the output", () => {
    const eqDate = clockPanelFor({ groups: [{ field: "date_et", op: "eq", value: 20261001 }] });
    expect(eqDate).toContain('data-lg-rb-value type="date" aria-label="Value" value="2026-10-01"');
    expect(eqDate).not.toContain("data-lg-rb-vtype");
    expect(JSON.parse(hiddenInputValue(eqDate))).toEqual({ groups: [{ field: "date_et", op: "eq", value: 20261001 }] });

    const gtTime = clockPanelFor({ groups: [{ field: "time_et", op: "gt", value: 930 }] });
    expect(gtTime).toContain('data-lg-rb-value type="time" aria-label="Value" value="09:30"');
    expect(gtTime).not.toContain('type="number"');

    const range = clockPanelFor({ groups: [{ field: "time_et", op: "range", from: 930, to: 1700 }] });
    expect(range).toContain('data-lg-rb-from type="time" aria-label="From" value="09:30"');
    expect(range).toContain('data-lg-rb-to type="time" aria-label="To" value="17:00"');

    const list = clockPanelFor({ groups: [{ field: "date_et", op: "in", values: [20261001, 20261225] }] });
    expect(list).toContain(">1 Oct 2026<button");
    expect(list).toContain(">25 Dec 2026<button");
    expect(list).toContain('data-lg-rb-chip-entry type="date" aria-label="New value" value=""');
    expect(list).not.toContain("data-lg-rb-chip-vtype");

    // The data blob tells the island which fields are pickers.
    const blob = list.match(/<script id="lg-rules-builder-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1] ?? "";
    const data = JSON.parse(blob) as { fields: Array<{ internal_field: string; input?: string }> };
    expect(data.fields.map((f) => [f.internal_field, f.input ?? null])).toEqual([
      ["date_et", "date"],
      ["time_et", "time"],
      ["age", null],
    ]);

    // A plain number field renders exactly as before.
    const age = clockPanelFor({ groups: [{ field: "age", op: "range", from: 25, to: 64 }] });
    expect(age).toContain('data-lg-rb-from type="number" step="any" aria-label="From" value="25"');
    expect(age).toContain('data-lg-rb-to type="number" step="any" aria-label="To" value="64"');
  });

  it("the round-trip keeps clock rows as numbers the real evaluator compares (US Eastern facts)", () => {
    const conditions: LeadgenRuleConditions = {
      groups: [
        { field: "date_et", op: "range", from: 20261001, to: 20261031 },
        { field: "time_et", op: "gte", value: 930 },
      ],
    };
    const parsed = parseStoredConditions(conditions);
    expect(parsed.ok).toBe(true);
    const json = JSON.parse(serializeRows(parsed.ok ? parsed.rows : [])) as LeadgenRuleConditions;
    expect(json).toEqual(conditions);
    expect(conditionsMatch(json, { date_et: 20261015, time_et: 1000 })).toBe(true);
    expect(conditionsMatch(json, { date_et: 20261015, time_et: 905 })).toBe(false);
    expect(conditionsMatch(json, { date_et: 20261101, time_et: 1000 })).toBe(false);
  });

  it("ruleValueText (the shared TS resolver) reads clock numbers in words and choice slugs as labels", () => {
    expect(ruleValueText({ input: "date" }, 20261001)).toBe("1 Oct 2026");
    expect(ruleValueText({ input: "time" }, 1745)).toBe("17:45");
    expect(ruleValueText({ input: "time" }, "x")).toBe("x");
    expect(ruleValueText({ choices: [{ value: "ca", label: "California" }] }, "ca")).toBe("California");
    expect(ruleValueText(undefined, 930)).toBe("930");
    // conditionsSentence with that resolver = the builder card's own sentence.
    const rows: RulesBuilderRow[] = [{ field: "time_et", op: "range", from: 930, to: 1700 }];
    expect(conditionsSentence(rows, clockLabelOf, (f, v) => ruleValueText(CLOCK_FIELDS.find((x) => x.internal_field === f), v))).toBe(
      "Matches when Time of day (US Eastern) is between 9:30 and 17:00.",
    );
    // Without a resolver nothing changes (frozen callers).
    expect(conditionsSentence(rows, clockLabelOf)).toBe("Matches when Time of day (US Eastern) is between 930 and 1700.");
  });
});

// ---------------------------------------------------------------------------
// 8 · The island DRIVEN through a minimal DOM: mount() → pickers → output
// ---------------------------------------------------------------------------

class FakeNode {
  tagName: string;
  className = "";
  type = "";
  value = "";
  title = "";
  selected = false;
  disabled = false;
  hidden = false;
  attrs: Record<string, string> = {};
  children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  listeners: Record<string, Array<(e: unknown) => void>> = {};
  private text = "";
  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  get firstChild(): FakeNode | null {
    return this.children[0] ?? null;
  }
  appendChild(n: FakeNode): FakeNode {
    n.parentNode = this;
    this.children.push(n);
    return n;
  }
  removeChild(n: FakeNode): FakeNode {
    const i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  setAttribute(k: string, v: unknown): void {
    this.attrs[k] = String(v);
  }
  getAttribute(k: string): string | null {
    return k in this.attrs ? (this.attrs[k] ?? null) : null;
  }
  hasAttribute(k: string): boolean {
    return k in this.attrs;
  }
  removeAttribute(k: string): void {
    delete this.attrs[k];
  }
  addEventListener(t: string, f: (e: unknown) => void): void {
    (this.listeners[t] ??= []).push(f);
  }
  dispatchEvent(): boolean {
    return true;
  }
  focus(): void {}
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(t: string) {
    this.children = [];
    this.text = String(t);
  }
  fire(type: string): void {
    for (const f of this.listeners[type] ?? []) f({ keyCode: 0 });
  }
  all(): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (n: FakeNode): void => {
      for (const c of n.children) {
        out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  byClass(cls: string): FakeNode[] {
    return this.all().filter((n) => n.className.split(" ").includes(cls));
  }
}

interface MountHandle {
  state: { out: FakeNode; sentenceEl: FakeNode };
}

function drivenIsland(): { mount: (raw: string, fields: unknown[]) => { root: FakeNode; out: FakeNode; sentence: () => string } } {
  const windowObj: Record<string, unknown> = {};
  const fakeEvent = { initEvent: (): void => {}, initCustomEvent: (): void => {} };
  const document = {
    readyState: "complete",
    getElementById: (): null => null,
    createElement: (tag: string): FakeNode => new FakeNode(tag),
    createTextNode: (t: string): FakeNode => {
      const n = new FakeNode("#text");
      n.textContent = t;
      return n;
    },
    createEvent: (): typeof fakeEvent => fakeEvent,
  };
  runInNewContext(RULES_BUILDER_SCRIPT, { window: windowObj, document });
  const api = windowObj["lgRulesBuilder"] as { mount: (c: FakeNode, raw: string, out: null, o: unknown) => MountHandle };
  return {
    mount: (raw, fields) => {
      const root = new FakeNode("div");
      const handle = api.mount(root, raw, null, { fields });
      return { root, out: handle.state.out, sentence: () => handle.state.sentenceEl.textContent };
    },
  };
}

describe("rules builder — island pickers for date / time fields (driven)", () => {
  it("is (=) on a date: one calendar picker, no value-type select; picking stores YYYYMMDD; an empty picker stores nothing", () => {
    const { root, out, sentence } = drivenIsland().mount(
      JSON.stringify({ groups: [{ field: "date_et", op: "eq", value: 20261001 }] }),
      CLOCK_FIELDS,
    );
    expect(root.byClass("lg-rb-vtype")).toHaveLength(0);
    const pickers = root.byClass("lg-rb-value");
    expect(pickers).toHaveLength(1);
    const pick = pickers[0] as FakeNode;
    expect(pick.type).toBe("date");
    expect(pick.value).toBe("2026-10-01");
    expect(sentence()).toBe('Matches when Date (US Eastern) is "1 Oct 2026".');

    pick.value = "2026-10-31";
    pick.fire("input");
    expect(JSON.parse(out.value)).toEqual({ groups: [{ field: "date_et", op: "eq", value: 20261031 }] });
    expect(sentence()).toBe('Matches when Date (US Eastern) is "31 Oct 2026".');

    // Cleared / half-typed: the stored date stays (never 0, never a string).
    pick.value = "";
    pick.fire("input");
    pick.fire("change");
    expect(JSON.parse(out.value)).toEqual({ groups: [{ field: "date_et", op: "eq", value: 20261031 }] });
  });

  it("a fresh row on a date field starts at 0 as a NUMBER (empty picker, never the empty-string 'is empty' sugar); a time starts at 0:00", () => {
    const { root, out, sentence } = drivenIsland().mount("", CLOCK_FIELDS);
    const addCondition = root.all().find((n) => n.tagName === "BUTTON" && n.textContent === "+ Add condition") as FakeNode;
    addCondition.fire("click");
    const pick = root.byClass("lg-rb-value")[0] as FakeNode;
    expect(pick.type).toBe("date");
    expect(pick.value).toBe("");
    expect(JSON.parse(out.value)).toEqual({ groups: [{ field: "date_et", op: "eq", value: 0 }] });
    expect(sentence()).toBe("Matches when Date (US Eastern) is 0.");
    pick.value = "2026-10-01";
    pick.fire("change");
    expect(JSON.parse(out.value)).toEqual({ groups: [{ field: "date_et", op: "eq", value: 20261001 }] });

    // A stored non-number on a time field becomes the numeric default 0:00.
    const fresh = drivenIsland().mount(JSON.stringify({ groups: [{ field: "time_et", op: "eq", value: "x" }] }), CLOCK_FIELDS);
    const timePick = fresh.root.byClass("lg-rb-value")[0] as FakeNode;
    expect(timePick.type).toBe("time");
    expect(timePick.value).toBe("00:00");
    expect(JSON.parse(fresh.out.value)).toEqual({ groups: [{ field: "time_et", op: "eq", value: 0 }] });
    timePick.value = "09:30";
    timePick.fire("change");
    expect(JSON.parse(fresh.out.value)).toEqual({ groups: [{ field: "time_et", op: "eq", value: 930 }] });
  });

  it("at least (≥) on a time: the clock picker replaces the number box", () => {
    const { root, out } = drivenIsland().mount(
      JSON.stringify({ groups: [{ field: "time_et", op: "gte", value: 930 }] }),
      CLOCK_FIELDS,
    );
    const pick = root.byClass("lg-rb-value")[0] as FakeNode;
    expect(pick.type).toBe("time");
    expect(pick.value).toBe("09:30");
    pick.value = "17:45";
    pick.fire("input");
    expect(JSON.parse(out.value)).toEqual({ groups: [{ field: "time_et", op: "gte", value: 1745 }] });
  });

  it("between on a time: From / To clock pickers; the sentence reads 'between 9:30 and 17:00'", () => {
    const { root, out, sentence } = drivenIsland().mount(
      JSON.stringify({ groups: [{ field: "time_et", op: "range", from: 930, to: 1700 }] }),
      CLOCK_FIELDS,
    );
    const from = root.byClass("lg-rb-from")[0] as FakeNode;
    const to = root.byClass("lg-rb-to")[0] as FakeNode;
    expect([from.type, from.value, to.type, to.value]).toEqual(["time", "09:30", "time", "17:00"]);
    expect(sentence()).toBe("Matches when Time of day (US Eastern) is between 9:30 and 17:00.");
    from.value = "00:05";
    from.fire("input");
    to.value = "";
    to.fire("input");
    expect(JSON.parse(out.value)).toEqual({ groups: [{ field: "time_et", op: "range", from: 5, to: 1700 }] });
    expect(sentence()).toBe("Matches when Time of day (US Eastern) is between 0:05 and 17:00.");
  });

  it("in list on a date: chips read as dates; the entry is a calendar picker that adds a numeric chip", () => {
    const { root, out, sentence } = drivenIsland().mount(
      JSON.stringify({ groups: [{ field: "date_et", op: "in", values: [20261001] }] }),
      CLOCK_FIELDS,
    );
    const chipTexts = (): string[] => root.byClass("lg-rb-chip").map((c) => c.firstChild?.textContent ?? "");
    expect(chipTexts()).toEqual(["1 Oct 2026"]);
    expect(root.byClass("lg-rb-chip-vtype")).toHaveLength(0);
    const entry = root.byClass("lg-rb-chip-entry")[0] as FakeNode;
    expect(entry.type).toBe("date");
    const add = root.all().find((n) => n.tagName === "BUTTON" && n.textContent === "Add") as FakeNode;
    // an empty picker adds nothing
    entry.value = "";
    add.fire("click");
    expect(JSON.parse(out.value)).toEqual({ groups: [{ field: "date_et", op: "in", values: [20261001] }] });
    entry.value = "2026-12-25";
    add.fire("click");
    expect(JSON.parse(out.value)).toEqual({ groups: [{ field: "date_et", op: "in", values: [20261001, 20261225] }] });
    expect(chipTexts()).toEqual(["1 Oct 2026", "25 Dec 2026"]);
    expect(sentence()).toBe('Matches when Date (US Eastern) is any of "1 Oct 2026", "25 Dec 2026".');
  });

  it("a field without a picker kind behaves exactly as before (value-type select + number box; text entry + type select)", () => {
    const eq = drivenIsland().mount(JSON.stringify({ groups: [{ field: "age", op: "eq", value: 30 }] }), CLOCK_FIELDS);
    expect(eq.root.byClass("lg-rb-vtype")).toHaveLength(1);
    const num = eq.root.byClass("lg-rb-value")[0] as FakeNode;
    expect(num.type).toBe("number");
    expect(num.value).toBe("30");
    num.value = "";
    num.fire("input");
    expect(JSON.parse(eq.out.value)).toEqual({ groups: [{ field: "age", op: "eq", value: 0 }] });

    const list = drivenIsland().mount(JSON.stringify({ groups: [{ field: "age", op: "in", values: [20261001] }] }), CLOCK_FIELDS);
    expect(list.root.byClass("lg-rb-chip").map((c) => c.firstChild?.textContent)).toEqual(["20261001"]);
    expect((list.root.byClass("lg-rb-chip-entry")[0] as FakeNode).type).toBe("text");
    expect(list.root.byClass("lg-rb-chip-vtype")).toHaveLength(1);
    expect(list.sentence()).toBe("Matches when Age is any of 20261001.");
  });
});

// ---------------------------------------------------------------------------
// 9 · Yes/no questions read their authored labels (owner residual "Yes/No
//     questions don't show their authored labels", e.g. "I own" / "I rent")
// ---------------------------------------------------------------------------

const YES_NO_FIELDS = [
  {
    internal_field: "homeowner",
    label: "Owns a home",
    choices: [
      { value: "true", label: "I own" },
      { value: "false", label: "I rent" },
    ],
  },
  { internal_field: "smoker", label: "Smoker" },
  { internal_field: "rating", label: "Rating", choices: [{ value: "excellent", label: "Excellent" }] },
];

function yesNoPanelFor(conditions: unknown): string {
  return renderRulesBuilderPanel({
    rules: [{ rule_type: "eligibility", conditions_json: conditions }],
    fields: YES_NO_FIELDS,
    offers: OFFERS,
  });
}

const YES_NO_SENTENCES: Array<[LeadgenRuleConditions, string]> = [
  [{ groups: [{ field: "homeowner", op: "eq", value: true }] }, 'Matches when Owns a home is "I own".'],
  [{ groups: [{ field: "homeowner", op: "neq", value: false }] }, 'Matches when Owns a home is not "I rent".'],
  [{ groups: [{ field: "homeowner", op: "in", values: [true, false] }] }, 'Matches when Owns a home is any of "I own", "I rent".'],
  // no labels → Yes / No exactly as before
  [{ groups: [{ field: "smoker", op: "eq", value: true }] }, "Matches when Smoker is Yes."],
  [{ groups: [{ field: "smoker", op: "not_in", values: [false] }] }, "Matches when Smoker is none of No."],
  // choices, but none for true/false → Yes / No
  [{ groups: [{ field: "rating", op: "eq", value: false }] }, "Matches when Rating is No."],
];

describe("rules builder — yes/no questions read their own labels", () => {
  it("SSR and island sentences agree, with the labels when the question has them and Yes / No otherwise", () => {
    const api = islandApi();
    const valueOf = api.makeValueOf(YES_NO_FIELDS);
    const labelOf = (f: string): string => YES_NO_FIELDS.find((x) => x.internal_field === f)?.label ?? f;
    for (const [conditions, expected] of YES_NO_SENTENCES) {
      const ssr = sentenceOf(yesNoPanelFor(conditions));
      expect(ssr, JSON.stringify(conditions)).toBe(expected);
      const parsed = api.parseConditions(JSON.stringify(conditions));
      expect(api.cardSentence(parsed.rows ?? [], labelOf, valueOf), JSON.stringify(conditions)).toBe(ssr);
    }
  });

  it("SSR chips and the yes/no select show the labels; a question without labels keeps Yes / No", () => {
    const list = yesNoPanelFor({ groups: [{ field: "homeowner", op: "in", values: [true, false] }] });
    expect(list).toContain(">I own<button");
    expect(list).toContain(">I rent<button");
    const eq = yesNoPanelFor({ groups: [{ field: "homeowner", op: "eq", value: false }] });
    expect(eq).toContain('<option value="yes">I own</option>');
    expect(eq).toContain('<option value="no" selected>I rent</option>');
    const plain = yesNoPanelFor({ groups: [{ field: "smoker", op: "eq", value: true }] });
    expect(plain).toContain('<option value="yes" selected>Yes</option>');
  });

  it("island chips show the labels too (driven)", () => {
    const { root } = drivenIsland().mount(
      JSON.stringify({ groups: [{ field: "homeowner", op: "in", values: [true, false] }] }),
      YES_NO_FIELDS,
    );
    expect(root.byClass("lg-rb-chip").map((c) => c.firstChild?.textContent)).toEqual(["I own", "I rent"]);
    const plain = drivenIsland().mount(JSON.stringify({ groups: [{ field: "smoker", op: "in", values: [true] }] }), YES_NO_FIELDS);
    expect(plain.root.byClass("lg-rb-chip").map((c) => c.firstChild?.textContent)).toEqual(["Yes"]);
  });

  it("the routing-rules rail cards: SSR chip and the island's own value text agree (label, else Yes / No)", () => {
    const rule = (field: string, value: boolean) => ({
      public_id: "qrr_" + field,
      rule_name: "R",
      priority: 1,
      status: "active" as const,
      match_mode: "all",
      conditions_json: { groups: [{ field, op: "eq", value }] },
      target_funnel_id: null,
      feed_name: null,
      value_multiplier: null,
      redirect_pct: null,
      target_offer_id: null,
      redirect_url: null,
      redirect_url_allowlisted: false,
    });
    const answerFields = YES_NO_FIELDS.map((f) => ({ internal_field: f.internal_field, label: f.label, ...(f.choices ? { choices: f.choices } : {}) }));
    const html = renderQuoteRulesRail({
      quote_public_id: "q_1",
      rules: [rule("homeowner", true), rule("smoker", false)],
      funnels: [],
      default_funnel_id: null,
      shared_page_fields: [],
      answer_fields: answerFields,
      offers: [],
      feed_values: [],
    });
    expect(html).toContain('<span class="lg-qr-chip">Owns a home is I own</span>');
    expect(html).toContain('<span class="lg-qr-chip">Smoker is No</span>');

    // The island's valueText — the REAL function text, run on the same fields.
    const from = QUOTE_RULES_SCRIPT.indexOf("function humanizeChoiceToken(token) {");
    const to = QUOTE_RULES_SCRIPT.indexOf("function conditionChips(rule) {");
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const ctx: Record<string, unknown> = {
      answerFields,
      isArr: (v: unknown): boolean => Array.isArray(v),
    };
    runInNewContext(QUOTE_RULES_SCRIPT.slice(from, to) + "\nthis.valueTextOut = valueText;", ctx);
    const valueText = ctx["valueTextOut"] as (g: unknown, field: string) => string;
    expect(valueText({ op: "eq", value: true }, "homeowner")).toBe("I own");
    expect(valueText({ op: "eq", value: false }, "homeowner")).toBe("I rent");
    expect(valueText({ op: "eq", value: false }, "smoker")).toBe("No");
    expect(valueText({ op: "eq", value: true }, "rating")).toBe("Yes");
  });
});
