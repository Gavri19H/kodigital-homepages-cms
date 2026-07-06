// LeadGen Phase 4 — Offer region-block rule evaluation (contract 04 §10.4 /
// issue 4). Truth table over every dimension × action, pass-list vs
// block-list semantics, unknown-geo handling, priority/enabled ordering.

import { describe, expect, it } from "vitest";
import {
  evaluateRegionRules,
  type LeadgenRegionGeo,
  type LeadgenRegionRuleInput,
} from "../src/leadgen/rules";
import {
  LEADGEN_REGION_DIMENSIONS,
  LEADGEN_RULE_ACTIONS,
} from "../src/leadgen/validation";

const GEO: LeadgenRegionGeo = { country: "US", state: "CA", city: "Fresno", zip: "93650" };

function rule(overrides: Partial<LeadgenRegionRuleInput>): LeadgenRegionRuleInput {
  return {
    id: 1,
    public_id: "lgrr_TEST0000000000000000000001",
    dimension: "state",
    action: "exclude",
    values: ["CA"],
    priority: 100,
    enabled: 1,
    ...overrides,
  };
}

describe("evaluateRegionRules — §10.4 truth table (every dimension × action)", () => {
  // Per-dimension: the request's matching value and a non-matching value.
  const dims: Array<{ dimension: LeadgenRegionRuleInput["dimension"]; match: string; miss: string }> = [
    { dimension: "country", match: "US", miss: "GB" },
    { dimension: "state", match: "CA", miss: "NY" },
    { dimension: "city", match: "Fresno", miss: "Miami" },
    { dimension: "zip", match: "93650", miss: "10001" },
  ];
  const passListActions = ["include_only", "allow_list"] as const;
  const blockListActions = ["exclude", "block_list"] as const;

  it("covers all 16 combinations declared by the DDL CHECK enums", () => {
    expect(dims.map((d) => d.dimension)).toEqual([...LEADGEN_REGION_DIMENSIONS]);
    expect([...passListActions, ...blockListActions].sort()).toEqual([...LEADGEN_RULE_ACTIONS].sort());
  });

  for (const { dimension, match, miss } of dims) {
    for (const action of passListActions) {
      it(`${action}×${dimension}: listed value passes, unlisted blocks, unknown blocks`, () => {
        // geo value ∈ list → participate
        expect(evaluateRegionRules([rule({ dimension, action, values: [match] })], GEO)).toEqual({
          participate: true,
        });
        // geo value ∉ list → blocked
        const blocked = evaluateRegionRules([rule({ dimension, action, values: [miss] })], GEO);
        expect(blocked.participate).toBe(false);
        if (!blocked.participate) {
          expect(blocked.blocked_by.dimension).toBe(dimension);
          expect(blocked.blocked_by.action).toBe(action);
          expect(blocked.blocked_by.reason).toContain("not in list");
        }
        // geo value UNKNOWN → a pass-list cannot prove membership → blocked
        const unknown = evaluateRegionRules([rule({ dimension, action, values: [match] })], {});
        expect(unknown.participate).toBe(false);
        if (!unknown.participate) {
          expect(unknown.blocked_by.reason).toContain("unknown");
        }
      });
    }
    for (const action of blockListActions) {
      it(`${action}×${dimension}: listed value blocks, unlisted passes, unknown passes`, () => {
        // geo value ∈ list → blocked
        const blocked = evaluateRegionRules([rule({ dimension, action, values: [match] })], GEO);
        expect(blocked.participate).toBe(false);
        if (!blocked.participate) {
          expect(blocked.blocked_by.dimension).toBe(dimension);
          expect(blocked.blocked_by.action).toBe(action);
          expect(blocked.blocked_by.reason).toContain("in list");
        }
        // geo value ∉ list → participate
        expect(evaluateRegionRules([rule({ dimension, action, values: [miss] })], GEO)).toEqual({
          participate: true,
        });
        // geo value UNKNOWN → a block-list has nothing to match → participate
        expect(evaluateRegionRules([rule({ dimension, action, values: [match] })], {})).toEqual({
          participate: true,
        });
      });
    }
  }
});

describe("evaluateRegionRules — §10.4 contract examples", () => {
  it('"exclude when state=CA" blocks a CA request and passes NY', () => {
    const rules = [rule({ dimension: "state", action: "exclude", values: ["CA"] })];
    expect(evaluateRegionRules(rules, { state: "CA" }).participate).toBe(false);
    expect(evaluateRegionRules(rules, { state: "NY" }).participate).toBe(true);
  });

  it('"include_only when ZIP ∈ list" passes listed ZIPs only', () => {
    const rules = [rule({ dimension: "zip", action: "include_only", values: ["90210", "93650"] })];
    expect(evaluateRegionRules(rules, { zip: "93650" }).participate).toBe(true);
    expect(evaluateRegionRules(rules, { zip: "10001" }).participate).toBe(false);
  });
});

describe("evaluateRegionRules — normalization", () => {
  it("matches case-insensitively over trimmed values (both sides)", () => {
    const rules = [rule({ dimension: "state", action: "exclude", values: ["  ca  "] })];
    expect(evaluateRegionRules(rules, { state: "Ca" }).participate).toBe(false);
    expect(evaluateRegionRules(rules, { state: " CA " }).participate).toBe(false);
    expect(evaluateRegionRules(rules, { state: "NY" }).participate).toBe(true);
  });

  it("treats empty-string and null geo dims as UNKNOWN", () => {
    const passList = [rule({ dimension: "city", action: "allow_list", values: ["Fresno"] })];
    expect(evaluateRegionRules(passList, { city: "" }).participate).toBe(false);
    expect(evaluateRegionRules(passList, { city: null }).participate).toBe(false);
    const blockList = [rule({ dimension: "city", action: "block_list", values: ["Fresno"] })];
    expect(evaluateRegionRules(blockList, { city: "" }).participate).toBe(true);
    expect(evaluateRegionRules(blockList, { city: null }).participate).toBe(true);
  });
});

describe("evaluateRegionRules — ordering, enabled, identity", () => {
  it("no rules → participate", () => {
    expect(evaluateRegionRules([], GEO)).toEqual({ participate: true });
  });

  it("disabled rules are skipped (both 0 and false forms)", () => {
    expect(
      evaluateRegionRules([rule({ enabled: 0 })], GEO), // exclude CA would block if enabled
    ).toEqual({ participate: true });
    expect(evaluateRegionRules([rule({ enabled: false })], GEO)).toEqual({ participate: true });
  });

  it("rules evaluate in priority ASC order — the first blocker wins the verdict", () => {
    const verdict = evaluateRegionRules(
      [
        rule({ id: 2, public_id: "lgrr_B", dimension: "country", action: "exclude", values: ["US"], priority: 20 }),
        rule({ id: 1, public_id: "lgrr_A", dimension: "state", action: "exclude", values: ["CA"], priority: 10 }),
      ],
      GEO,
    );
    expect(verdict.participate).toBe(false);
    if (!verdict.participate) {
      expect(verdict.blocked_by.rule).toBe("lgrr_A"); // priority 10 evaluated first
      expect(verdict.blocked_by.dimension).toBe("state");
    }
  });

  it("missing priority defaults to 100 (the DDL default)", () => {
    const verdict = evaluateRegionRules(
      [
        rule({ public_id: "lgrr_DEFAULT", priority: undefined, dimension: "country", action: "exclude", values: ["US"] }),
        rule({ public_id: "lgrr_EARLY", priority: 10, dimension: "state", action: "exclude", values: ["CA"] }),
      ],
      GEO,
    );
    expect(verdict.participate).toBe(false);
    if (!verdict.participate) expect(verdict.blocked_by.rule).toBe("lgrr_EARLY");
  });

  it("blocked_by identity prefers public_id, falls back to numeric id, then null", () => {
    const byPublicId = evaluateRegionRules([rule({})], GEO);
    expect(byPublicId.participate).toBe(false);
    if (!byPublicId.participate) {
      expect(byPublicId.blocked_by.rule).toBe("lgrr_TEST0000000000000000000001");
    }
    const byNumericId = evaluateRegionRules([rule({ public_id: null, id: 42 })], GEO);
    expect(byNumericId.participate).toBe(false);
    if (!byNumericId.participate) expect(byNumericId.blocked_by.rule).toBe(42);
    const anonymous = evaluateRegionRules([rule({ public_id: undefined, id: undefined })], GEO);
    expect(anonymous.participate).toBe(false);
    if (!anonymous.participate) expect(anonymous.blocked_by.rule).toBeNull();
  });

  it("defensively skips rules with an empty values list (validation rejects them at save)", () => {
    expect(evaluateRegionRules([rule({ action: "include_only", values: [] })], GEO)).toEqual({
      participate: true,
    });
  });

  it("all rules passing → participate (multi-rule AND)", () => {
    const verdict = evaluateRegionRules(
      [
        rule({ dimension: "country", action: "include_only", values: ["US"] }),
        rule({ dimension: "state", action: "exclude", values: ["NY"] }),
        rule({ dimension: "zip", action: "allow_list", values: ["93650"] }),
      ],
      GEO,
    );
    expect(verdict).toEqual({ participate: true });
  });
});
