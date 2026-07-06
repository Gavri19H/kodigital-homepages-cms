// LeadGen §12.3 dependency-evaluation engine — branch-complete unit tests.
// Reuses payload.ts condition-op semantics (single source of truth); these
// tests pin visible / required_now / continue_blocked across every op and the
// §12.3 rule kinds (show/hide/require/block-continue) + §12.6 defaults.

import { describe, expect, it } from "vitest";
import {
  evaluateDependencies,
  visibleQuestionIds,
} from "../src/leadgen/dependencies";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";

function node(partial: Partial<LeadgenComponentNode> & { question_id: string }): LeadgenComponentNode {
  return { type: "FreeTextQuestion", ...partial } as LeadgenComponentNode;
}

describe("evaluateDependencies — §12.3 show/hide", () => {
  it("a component with NO conditional is always visible", () => {
    const s = evaluateDependencies([node({ question_id: "q1" })], {});
    expect(s.components[0]?.visible).toBe(true);
  });

  it("show-when: visible only while the condition is met (eq)", () => {
    const comps = [
      node({ question_id: "insurer", conditional: { when: "insured", op: "eq", value: true } }),
    ];
    expect(evaluateDependencies(comps, { insured: true }).components[0]?.visible).toBe(true);
    expect(evaluateDependencies(comps, { insured: false }).components[0]?.visible).toBe(false);
  });

  it("hide-when is authored as the complement (neq/not_in) — shown only while complement holds", () => {
    const comps = [node({ question_id: "z", conditional: { when: "kind", op: "neq", value: "business" } })];
    expect(evaluateDependencies(comps, { kind: "personal" }).components[0]?.visible).toBe(true);
    expect(evaluateDependencies(comps, { kind: "business" }).components[0]?.visible).toBe(false);
  });

  it("unanswered `when` is fail-closed — a show-condition stays hidden", () => {
    const comps = [node({ question_id: "y", conditional: { when: "x", op: "eq", value: 1 } })];
    expect(evaluateDependencies(comps, {}).components[0]?.visible).toBe(false);
  });

  it("every numeric/set op resolves visibility (gt/lt/gte/lte/range/in/not_in)", () => {
    const cases: Array<[LeadgenComponentNode["conditional"], Record<string, unknown>, boolean]> = [
      [{ when: "age", op: "gt", value: 18 }, { age: 20 }, true],
      [{ when: "age", op: "gt", value: 18 }, { age: 18 }, false],
      [{ when: "age", op: "lt", value: 65 }, { age: 40 }, true],
      [{ when: "age", op: "gte", value: 18 }, { age: 18 }, true],
      [{ when: "age", op: "lte", value: 65 }, { age: 65 }, true],
      [{ when: "age", op: "range", from: 25, to: 64 }, { age: 25 }, true],
      [{ when: "age", op: "range", from: 25, to: 64 }, { age: 64 }, true],
      [{ when: "age", op: "range", from: 25, to: 64 }, { age: 65 }, false],
      [{ when: "st", op: "in", values: ["CA", "NY"] }, { st: "CA" }, true],
      [{ when: "st", op: "in", values: ["CA", "NY"] }, { st: "TX" }, false],
      [{ when: "st", op: "not_in", values: ["CA"] }, { st: "TX" }, true],
      [{ when: "st", op: "not_in", values: ["CA"] }, { st: "CA" }, false],
    ];
    for (const [conditional, answers, expected] of cases) {
      const s = evaluateDependencies([node({ question_id: "c", conditional })], answers);
      expect(s.components[0]?.visible, `${conditional?.op} ${JSON.stringify(answers)}`).toBe(expected);
    }
  });
});

describe("evaluateDependencies — §12.3 require-C-when + continue gate", () => {
  it("required-at-rest visible component with no answer blocks continue", () => {
    const comps = [node({ question_id: "email", internal_field: "email", required: true })];
    const s = evaluateDependencies(comps, {});
    expect(s.components[0]?.required_now).toBe(true);
    expect(s.continue_blocked).toBe(true);
    expect(s.blocking_question_ids).toContain("email");
  });

  it("required component WITH a non-empty answer does not block", () => {
    const comps = [node({ question_id: "email", internal_field: "email", required: true })];
    const s = evaluateDependencies(comps, { email: "a@b.co" });
    expect(s.continue_blocked).toBe(false);
    expect(s.blocking_question_ids).toEqual([]);
  });

  it("empty string / empty array count as unanswered", () => {
    const comps = [
      node({ question_id: "n", internal_field: "n", required: true }),
      node({ question_id: "m", internal_field: "m", required: true, type: "MultiChoiceCardGroup" }),
    ];
    const s = evaluateDependencies(comps, { n: "   ", m: [] });
    expect(s.blocking_question_ids).toEqual(["n", "m"]);
  });

  it("require-when: props.requiredWhen makes an at-rest-optional field required only when met", () => {
    const comps = [
      node({
        question_id: "reason",
        internal_field: "reason",
        required: false,
        props: { requiredWhen: { when: "denied", op: "eq", value: true } },
      }),
    ];
    // condition met + unanswered → required-now + blocks
    const met = evaluateDependencies(comps, { denied: true });
    expect(met.components[0]?.required_now).toBe(true);
    expect(met.continue_blocked).toBe(true);
    // condition unmet → not required, does not block
    const unmet = evaluateDependencies(comps, { denied: false });
    expect(unmet.components[0]?.required_now).toBe(false);
    expect(unmet.continue_blocked).toBe(false);
  });

  it("a HIDDEN required component never blocks continue (dependency unmet)", () => {
    const comps = [
      node({
        question_id: "insurer",
        internal_field: "insurer",
        required: true,
        conditional: { when: "insured", op: "eq", value: true },
      }),
    ];
    // insured=false → insurer hidden → not required-now → not blocking
    const s = evaluateDependencies(comps, { insured: false });
    expect(s.components[0]?.visible).toBe(false);
    expect(s.components[0]?.required_now).toBe(false);
    expect(s.continue_blocked).toBe(false);
  });
});

describe("evaluateDependencies — §12.6 defaults + chaining", () => {
  it("a resolved default value drives dependency eval like a user value", () => {
    // The caller passes normalized answers (answers.ts already resolved the
    // default); the engine treats it as the field's value.
    const comps = [node({ question_id: "y", conditional: { when: "insured", op: "eq", value: false } })];
    // insured defaulted to false → the dependent shows
    expect(evaluateDependencies(comps, { insured: false }).components[0]?.visible).toBe(true);
  });

  it("multi-component: an unmet upstream hides its dependent independently", () => {
    const comps = [
      node({ question_id: "insured", internal_field: "insured" }),
      node({ question_id: "insurer", conditional: { when: "insured", op: "eq", value: true } }),
      node({ question_id: "always" }),
    ];
    const s = evaluateDependencies(comps, { insured: false });
    expect(visibleQuestionIds(comps, { insured: false })).toEqual(["insured", "always"]);
    expect(s.components.find((c) => c.question_id === "insurer")?.visible).toBe(false);
  });
});
