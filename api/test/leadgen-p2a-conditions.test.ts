// Round-4 P2a — A-4 composed condition groups ({match:'all'|'any', conditions})
// + 10C ctx-field plumbing (the ctx describes are appended with the engine leg).
//
// PARITY BY CONSTRUCTION: the client evaluator (runtime/dependencies.ts
// conditionMet) and the server money-path evaluator (payload.ts conditionalMet)
// carry byte-identical group dispatch, so a single table drives BOTH sides and
// every cell asserts client === server === the independently-aggregated
// all/any of the per-leg bare results. Back-compat: a bare single-object
// conditional takes the unchanged legacy path (a 1-element all-group equals it).

import { describe, expect, it } from "vitest";
import { conditionMet, isConditionGroup } from "../src/public/leadgen/runtime/dependencies";
import {
  conditionalMet,
  isPayloadConditionGroup,
  type LeadgenPayloadConditional,
  type LeadgenPayloadConditionGroup,
} from "../src/leadgen/payload";

// ---------------------------------------------------------------------------
// Table: one bare conditional per op (+ a missing-answer leg), a spread of
// answer maps (incl. string-coercion edges + all-absent), and every pairwise
// all/any composition over them.
// ---------------------------------------------------------------------------

const BARE: LeadgenPayloadConditional[] = [
  { when: "a", op: "eq", value: 1 },
  { when: "a", op: "neq", value: 2 },
  { when: "b", op: "gt", value: 10 },
  { when: "b", op: "lt", value: 100 },
  { when: "b", op: "gte", value: 25 },
  { when: "b", op: "lte", value: 25 },
  { when: "b", op: "range", from: 5, to: 50 },
  { when: "c", op: "in", values: ["x", "y"] },
  { when: "c", op: "not_in", values: ["z"] },
  { when: "missing", op: "eq", value: 1 }, // unanswered `when` → always false
];

const ANSWER_MAPS: Array<Record<string, unknown>> = [
  {}, // all absent
  { a: 1, b: 25, c: "x" },
  { a: 2, b: 200, c: "z" },
  { a: 1, b: 5, c: "y" },
  { a: "1", b: "25", c: "x" }, // Number()-coercion + string membership edges
  { a: true, b: 0, c: "" },
];

// Build every 2-condition all/any group, plus a few 1- and 3-condition groups.
function allGroups(): LeadgenPayloadConditionGroup[] {
  const groups: LeadgenPayloadConditionGroup[] = [];
  for (let i = 0; i < BARE.length; i++) {
    for (let j = i + 1; j < BARE.length; j++) {
      const bi = BARE[i] as LeadgenPayloadConditional;
      const bj = BARE[j] as LeadgenPayloadConditional;
      groups.push({ match: "all", conditions: [bi, bj] });
      groups.push({ match: "any", conditions: [bi, bj] });
    }
  }
  // 1-element groups (both matches) + one 3-element group + a match-absent group.
  const b0 = BARE[0] as LeadgenPayloadConditional;
  const b2 = BARE[2] as LeadgenPayloadConditional;
  const b7 = BARE[7] as LeadgenPayloadConditional;
  groups.push({ match: "all", conditions: [b0] });
  groups.push({ match: "any", conditions: [b0] });
  groups.push({ match: "all", conditions: [b0, b2, b7] });
  groups.push({ match: "any", conditions: [b0, b2, b7] });
  groups.push({ conditions: [b0, b2] } as LeadgenPayloadConditionGroup); // match absent → AND
  return groups;
}

// Independent expected: aggregate the per-leg BARE results (the bare path is
// covered cell-for-cell by leadgen-runtime-engine.test.ts's parity table).
function expectedGroup(g: LeadgenPayloadConditionGroup, answers: Record<string, unknown>): boolean {
  const legs = g.conditions.map((c) => conditionMet(c, answers));
  return g.match === "any" ? legs.some((x) => x) : legs.every((x) => x);
}

describe("P2a A-4: composed condition groups — client↔server parity + all/any semantics", () => {
  it("client conditionMet === server conditionalMet === all/any aggregate, over every group × answer map", () => {
    const groups = allGroups();
    let cells = 0;
    for (const g of groups) {
      for (const answers of ANSWER_MAPS) {
        const expected = expectedGroup(g, answers);
        const client = conditionMet(g, answers);
        const server = conditionalMet(g, answers);
        if (client !== server || client !== expected) {
          throw new Error(
            `group mismatch: match=${g.match ?? "(absent)"} n=${g.conditions.length} ` +
              `answers=${JSON.stringify(answers)} client=${String(client)} ` +
              `server=${String(server)} expected=${String(expected)}`,
          );
        }
        cells += 1;
      }
    }
    // 2-combos ×2 matches + 5 extra groups, × the answer maps.
    const twoCombos = (BARE.length * (BARE.length - 1)) / 2; // 45
    const expectedGroups = twoCombos * 2 + 5; // 95
    expect(groups.length).toBe(expectedGroups);
    expect(cells).toBe(expectedGroups * ANSWER_MAPS.length);
  });

  it("empty conditions follows every/some: all ⇒ true, any ⇒ false (both sides)", () => {
    const emptyAll: LeadgenPayloadConditionGroup = { match: "all", conditions: [] };
    const emptyAny: LeadgenPayloadConditionGroup = { match: "any", conditions: [] };
    expect(conditionMet(emptyAll, {})).toBe(true);
    expect(conditionalMet(emptyAll, {})).toBe(true);
    expect(conditionMet(emptyAny, {})).toBe(false);
    expect(conditionalMet(emptyAny, {})).toBe(false);
  });

  it("match absent defaults to AND (every)", () => {
    const g = {
      conditions: [
        { when: "a", op: "eq", value: 1 },
        { when: "b", op: "eq", value: 2 },
      ],
    } as LeadgenPayloadConditionGroup;
    expect(conditionMet(g, { a: 1, b: 2 })).toBe(true);
    expect(conditionMet(g, { a: 1, b: 9 })).toBe(false); // AND, not OR
    expect(conditionalMet(g, { a: 1, b: 9 })).toBe(false);
  });

  it("missing-answer leg is fail-closed inside a group (never throws, never blocks)", () => {
    const g: LeadgenPayloadConditionGroup = {
      match: "all",
      conditions: [
        { when: "present", op: "eq", value: 1 },
        { when: "missing", op: "eq", value: 1 },
      ],
    };
    // present=1 true, missing → false ⇒ AND false; ANY of the two → true.
    expect(conditionMet(g, { present: 1 })).toBe(false);
    expect(conditionMet({ ...g, match: "any" }, { present: 1 })).toBe(true);
    expect(() => conditionMet(g, { present: 1 })).not.toThrow();
  });
});

describe("P2a A-4: back-compat — bare conditional unchanged", () => {
  it("a bare single-object conditional evaluates identically to a 1-element all-group, for every op × answer map", () => {
    let cells = 0;
    for (const bare of BARE) {
      for (const answers of ANSWER_MAPS) {
        const asGroup: LeadgenPayloadConditionGroup = { match: "all", conditions: [bare] };
        const bareC = conditionMet(bare, answers);
        const bareS = conditionalMet(bare, answers);
        expect(bareC).toBe(bareS); // bare parity (unchanged legacy path)
        expect(conditionMet(asGroup, answers)).toBe(bareC); // group wrapping is transparent
        expect(conditionalMet(asGroup, answers)).toBe(bareS);
        cells += 1;
      }
    }
    expect(cells).toBe(BARE.length * ANSWER_MAPS.length);
  });

  it("shape detectors: group iff an array `conditions`; bare/primitive/null/array are not groups (client === server guard)", () => {
    const group: unknown = { match: "any", conditions: [] };
    const bare: unknown = { when: "a", op: "eq", value: 1 };
    for (const v of [group, bare, null, undefined, 5, "x", [], { conditions: "no" }, {}]) {
      expect(isConditionGroup(v)).toBe(isPayloadConditionGroup(v));
    }
    expect(isConditionGroup(group)).toBe(true);
    expect(isConditionGroup(bare)).toBe(false);
    expect(isConditionGroup({ conditions: [] })).toBe(true); // structural: array conditions
    expect(isConditionGroup(null)).toBe(false);
    expect(isConditionGroup([])).toBe(false);
  });
});
