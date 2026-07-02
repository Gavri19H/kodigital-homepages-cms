// Listicles Phase 2 — rule model, evaluation, and the §15.5 conflict guard.

import { describe, expect, it } from "vitest";
import {
  buildConflictPayload,
  canonicalConditionsJson,
  computeOverlap,
  conditionsHash,
  detectRuleConflicts,
  evaluateRules,
  formatInterval,
  intersectIntervals,
  matchesConditions,
  parseConditions,
  type RuleConditions,
} from "../src/listicles/rules";

const CA_MOBILE: RuleConditions = {
  sets: { state: ["CA"], device: ["mobile"], traffic_source: ["facebook"] },
};

describe("parseConditions — typed conditions model (§15.4)", () => {
  it("parses sets + ranges from a JSON string", () => {
    const parsed = parseConditions(
      '{"sets":{"country":["US"],"sub1":["a"]},"ranges":{"hour":[6,12]}}',
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.conditions.sets?.country).toEqual(["US"]);
      expect(parsed.conditions.ranges?.hour).toEqual([6, 12]);
    }
  });

  it("rejects unknown set dimensions and malformed intervals", () => {
    expect(parseConditions({ sets: { favourite_color: ["red"] } }).ok).toBe(false);
    expect(parseConditions({ ranges: { hour: [12, 6] } }).ok).toBe(false);
    expect(parseConditions({ ranges: { hour: [0, 25] } }).ok).toBe(false);
    expect(parseConditions({ ranges: { minute: [0, 30] } }).ok).toBe(false);
    expect(parseConditions("not json").ok).toBe(false);
  });
});

describe("rule evaluation — priority asc, first match wins (§15.4)", () => {
  it("evaluates by priority ascending and returns the first match", () => {
    const rules = [
      { id: "low-precedence", priority: 20, conditions: { sets: { country: ["US"] } } as RuleConditions },
      { id: "high-precedence", priority: 5, conditions: { sets: { country: ["US"] } } as RuleConditions },
    ];
    const winner = evaluateRules(rules, { country: "US" });
    expect(winner?.id).toBe("high-precedence");
  });

  it("falls through non-matching rules to the next priority", () => {
    const rules = [
      { id: "mobile-only", priority: 1, conditions: { sets: { device: ["mobile"] } } as RuleConditions },
      { id: "us-any-device", priority: 2, conditions: { sets: { country: ["US"] } } as RuleConditions },
    ];
    expect(evaluateRules(rules, { country: "US", device: "desktop" })?.id).toBe("us-any-device");
    expect(evaluateRules(rules, { country: "FR", device: "desktop" })).toBeNull();
  });

  it("missing dimension = any (an empty rule matches every context)", () => {
    expect(matchesConditions({}, {})).toBe(true);
    expect(matchesConditions({ sets: { country: ["US"] } }, { country: "US", device: "tablet" })).toBe(true);
  });

  it("hour ranges are half-open [start, end)", () => {
    const conditions: RuleConditions = { ranges: { hour: [6, 12] } };
    expect(matchesConditions(conditions, { hour: 6 })).toBe(true);
    expect(matchesConditions(conditions, { hour: 11 })).toBe(true);
    expect(matchesConditions(conditions, { hour: 12 })).toBe(false);
    expect(matchesConditions(conditions, {})).toBe(false); // constrained dim needs a ctx value
  });
});

describe("interval intersection (§15.5 range dims)", () => {
  it("06:00-12:00 × 10:00-18:00 ⇒ 10:00-12:00", () => {
    expect(intersectIntervals([6, 12], [10, 18])).toEqual([10, 12]);
    expect(formatInterval([10, 12])).toBe("10:00-12:00");
  });

  it("touching and disjoint intervals do not intersect", () => {
    expect(intersectIntervals([6, 10], [10, 18])).toBeNull();
    expect(intersectIntervals([0, 6], [12, 18])).toBeNull();
  });

  it("computeOverlap merges hour and daypart onto one time axis", () => {
    const a: RuleConditions = { ranges: { hour: [6, 12] } };
    const b: RuleConditions = { ranges: { daypart: [[10, 18]] } };
    expect(computeOverlap(a, b)).toEqual({ hour: ["10:00-12:00"] });
    const disjoint: RuleConditions = { ranges: { hour: [13, 18] } };
    expect(computeOverlap(a, disjoint)).toBeNull();
  });
});

describe("conflict guard — §15.5", () => {
  it("equal-priority overlap is a BLOCKING conflict with the contract payload shape", () => {
    const { conflicts, warnings } = detectRuleConflicts([
      { candidate_key: "Section A", priority: 1, conditions: CA_MOBILE },
      {
        candidate_key: "Section B",
        priority: 1,
        conditions: { sets: { state: ["CA", "NY"], device: ["mobile"] } },
      },
    ]);
    expect(warnings).toEqual([]);
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0];
    expect(conflict?.candidate_a).toBe("Section A");
    expect(conflict?.candidate_b).toBe("Section B");
    expect(conflict?.overlap).toEqual({
      state: ["CA"],
      device: ["mobile"],
      traffic_source: ["facebook"], // one-sided dim: the other rule is "any"
    });
    expect(conflict?.reason).toBe("Both rules can match the same user at the same priority.");

    // The wire payload: { error: "Rule conflict", fields: { "page_2.rules": [...] } }
    const payload = buildConflictPayload(2, conflicts);
    expect(payload.error).toBe("Rule conflict");
    expect(Object.keys(payload.fields)).toEqual(["page_2.rules"]);
    expect(payload.fields["page_2.rules"]).toHaveLength(1);
  });

  it("cross-priority overlap is a non-blocking override warning", () => {
    const { conflicts, warnings } = detectRuleConflicts([
      { candidate_key: "Broad US", priority: 10, conditions: { sets: { country: ["US"] } } },
      { candidate_key: "CA mobile", priority: 5, conditions: CA_MOBILE },
    ]);
    expect(conflicts).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.reason).toBe(
      "Rule 'CA mobile' can override Rule 'Broad US' for these audiences.",
    );
    expect(warnings[0]?.overlap.state).toEqual(["CA"]);
  });

  it("missing dimension = any: an unconstrained rule overlaps everything", () => {
    const { conflicts } = detectRuleConflicts([
      { candidate_key: "Everyone", priority: 3, conditions: {} },
      { candidate_key: "US only", priority: 3, conditions: { sets: { country: ["US"] } } },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.overlap).toEqual({ country: ["US"] });
  });

  it("disjoint value sets do not conflict even at equal priority", () => {
    const { conflicts, warnings } = detectRuleConflicts([
      { candidate_key: "US", priority: 1, conditions: { sets: { country: ["US"] } } },
      { candidate_key: "FR", priority: 1, conditions: { sets: { country: ["FR"] } } },
    ]);
    expect(conflicts).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe("conditionsHash — canonicalized SHA-256 (== matched_rule_json_hash)", () => {
  it("is stable across key ordering", async () => {
    const a = parseConditions('{"sets":{"country":["US"],"device":["mobile"]},"ranges":{"hour":[6,12]}}');
    const b = parseConditions('{"ranges":{"hour":[6,12]},"sets":{"device":["mobile"],"country":["US"]}}');
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(canonicalConditionsJson(a.conditions)).toBe(canonicalConditionsJson(b.conditions));
      expect(await conditionsHash(a.conditions)).toBe(await conditionsHash(b.conditions));
    }
  });

  it("is a 64-char lowercase hex digest and differs for different conditions", async () => {
    const h1 = await conditionsHash({ sets: { country: ["US"] } });
    const h2 = await conditionsHash({ sets: { country: ["FR"] } });
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h2).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).not.toBe(h2);
  });
});
