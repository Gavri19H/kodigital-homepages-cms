// P4b (register PC-7 / PC-A3) — step honesty.
//
// Three seams:
//   1. validation.ts — the off-grid message names the nearest valid neighbors
//      (the operator's "terrible": min=1,step=5,502 → "Use steps of 5." told
//      the visitor nothing).
//   2. content-schema.ts — props.step is REJECTED on non-numeric Accept-swap
//      tiles (the stale-step-survives-onto-text bug), a clear author message.
//   3. ui-section-studio.ts — setAcceptFormat CLEANS the type-specific
//      validation props on swap so a stale step never reaches the model.

import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { validateValue } from "../src/public/leadgen/runtime/validation";
import type { LgComponentConfig } from "../src/public/leadgen/runtime/state";
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";
import { SECTION_STUDIO_SCRIPT } from "../src/admin/leadgen/ui-section-studio";

// --- 1. validation.ts step neighbor message ---------------------------------

const num = (cv: Record<string, unknown>): LgComponentConfig =>
  ({
    type: "NumberInputQuestion",
    question_id: "q_n",
    internal_field: "n",
    client_validation: cv,
  }) as unknown as LgComponentConfig;

describe("P4b PC-A3 — off-grid step message names the nearest valid neighbors", () => {
  it("the operator's case: min=1, step=5, value 502 → the two neighbors", () => {
    const fails = validateValue(num({ min: 1, step: 5 }), 502, false);
    expect(fails.map((f) => f.code)).toEqual(["step"]);
    // valid grid is 1,6,...,501,506 → 502 sits between 501 and 506
    expect(fails[0]?.message).toBe("Nearest valid values: 501 and 506.");
  });

  it("min=0, step=5, value 502 → 500 and 505", () => {
    expect(validateValue(num({ min: 0, step: 5 }), 502, false)[0]?.message).toBe(
      "Nearest valid values: 500 and 505.",
    );
  });

  it("clamps a neighbor that would exceed max → single-value phrasing", () => {
    // grid 0,10,20 (max 20); value 18 → low 10, high 20; both in range → two
    // but value 19 with max 15 → low 10, high 20>max → only 10 offered
    const fails = validateValue(num({ min: 0, max: 15, step: 10 }), 12, false);
    expect(fails.map((f) => f.code)).toContain("step");
    const stepMsg = fails.find((f) => f.code === "step")?.message;
    expect(stepMsg).toBe("Nearest valid value: 10.");
  });

  it("an on-grid value produces NO step failure", () => {
    expect(validateValue(num({ min: 1, step: 5 }), 6, false)).toEqual([]);
  });

  it("error_text still overrides the neighbor message", () => {
    const fails = validateValue(num({ min: 1, step: 5, error_text: "Pick a listed amount." }), 502, false);
    expect(fails[0]?.message).toBe("Pick a listed amount.");
  });
});

// --- 2. content-schema step-on-non-numeric rejection ------------------------

const codes = (content: unknown): string[] => validateSectionContent(content).errors.map((e) => e.code);
const field = (type: string, props: Record<string, unknown>) => ({
  components: [{ type, question_id: "q", internal_field: "f", props }],
});

describe("P4b PC-7 — props.step rejected on non-numeric Accept-swap tiles", () => {
  it("step on a FreeTextQuestion → invalid_field_prop", () => {
    expect(codes(field("FreeTextQuestion", { step: 5 }))).toContain("invalid_field_prop");
  });
  it("step on Email/Phone/ZIP/Date/Address → invalid_field_prop", () => {
    for (const t of ["EmailInputQuestion", "PhoneInputQuestion", "ZIPInputQuestion", "DateQuestion", "AddressAutocompleteQuestion"]) {
      expect(codes(field(t, { step: 5 })), t).toContain("invalid_field_prop");
    }
  });
  it("step on Number/Amount fields is ACCEPTED", () => {
    expect(codes(field("NumberInputQuestion", { step: 5 }))).not.toContain("invalid_field_prop");
    expect(codes(field("CurrencyInputQuestion", { step: 5 }))).not.toContain("invalid_field_prop");
  });
  it("step on a Range family (not an Accept tile) is untouched by this rule", () => {
    expect(codes({ components: [{ type: "RangeQuestion", question_id: "q", internal_field: "f", props: { min: 0, max: 10, step: 2 } }] })).not.toContain(
      "invalid_field_prop",
    );
  });
  it("ProgressBar's own props.step (progress count) is NOT rejected", () => {
    expect(codes({ components: [{ type: "ProgressBar", question_id: "p", props: { mode: "step", step: 2, totalSteps: 5 } }] })).not.toContain(
      "invalid_field_prop",
    );
  });
});

// --- 3. setAcceptFormat cleanup (vm-probe of the served ES5 island) ----------

// Slice a `function NAME(...) {...}` / `var NAME = {...};` out of the island by
// brace-matching (mirrors the studio-ui suite's own probe discipline: run the
// REAL served code, never a re-implementation).
function sliceFn(script: string, name: string): string {
  const start = script.indexOf(`function ${name}(`);
  expect(start, `island fn ${name}`).toBeGreaterThan(-1);
  const open = script.indexOf("{", start);
  let d = 0;
  for (let i = open; i < script.length; i += 1) {
    if (script[i] === "{") d += 1;
    else if (script[i] === "}" && --d === 0) return script.slice(start, i + 1);
  }
  throw new Error(`unbalanced ${name}`);
}
function sliceVar(script: string, name: string): string {
  const start = script.indexOf(`var ${name} = {`);
  expect(start, `island var ${name}`).toBeGreaterThan(-1);
  const open = script.indexOf("{", start);
  let d = 0;
  for (let i = open; i < script.length; i += 1) {
    if (script[i] === "{") d += 1;
    else if (script[i] === "}" && --d === 0) return `${script.slice(start, i + 1)};`;
  }
  throw new Error(`unbalanced ${name}`);
}

describe("P4b PC-7 — setAcceptFormat clears stale validation props on swap", () => {
  function makeSandbox(): { run: (expr: string) => unknown } {
    const source = [
      "function afterModelChange() {}",
      sliceVar(SECTION_STUDIO_SCRIPT, "ACCEPT_FORMAT_TYPE"),
      sliceVar(SECTION_STUDIO_SCRIPT, "ACCEPT_TYPE_FORMAT"),
      sliceFn(SECTION_STUDIO_SCRIPT, "setAcceptFormat"),
    ].join("\n");
    const sandbox: Record<string, unknown> = {};
    runInNewContext(source, sandbox);
    return { run: (expr) => runInNewContext(expr, sandbox) };
  }

  it("Number(min/max/step) → text drops min/max/step, keeps shared props + sets format", () => {
    const { run } = makeSandbox();
    run(
      "node = { type: 'NumberInputQuestion', question_id: 'q', internal_field: 'salary', required: true, props: { min: 1, max: 100, step: 5, label: 'Salary', icon: 'dollar' } };",
    );
    expect(run("setAcceptFormat(node, 'text')")).toBe(true);
    expect(run("node.type")).toBe("FreeTextQuestion");
    expect(run("node.props.format")).toBe("text");
    // stale numeric validation props are GONE
    for (const k of ["min", "max", "step"]) {
      expect(run(`node.props.${k}`), `${k} cleared`).toBeUndefined();
    }
    // shared props survive (internal_field/label/icon/required)
    expect(run("node.internal_field")).toBe("salary");
    expect(run("node.required")).toBe(true);
    expect(run("node.props.label")).toBe("Salary");
    expect(run("node.props.icon")).toBe("dollar");
  });

  it("text(maxLen/pattern) → date drops maxLen/pattern (no cross-type survival)", () => {
    const { run } = makeSandbox();
    run("node = { type: 'FreeTextQuestion', question_id: 'q', internal_field: 'dob', props: { maxLen: 40, pattern: '^x$', pattern_preset: 'letters' } };");
    expect(run("setAcceptFormat(node, 'date')")).toBe(true);
    expect(run("node.type")).toBe("DateQuestion");
    for (const k of ["maxLen", "pattern", "pattern_preset"]) {
      expect(run(`node.props.${k}`), `${k} cleared`).toBeUndefined();
    }
  });

  it("the swapped, cleaned node validates clean (no stale-step invalid_field_prop)", () => {
    const { run } = makeSandbox();
    run("node = { type: 'NumberInputQuestion', question_id: 'q', internal_field: 'f', props: { min: 1, step: 5 } };");
    run("setAcceptFormat(node, 'phone')");
    const node = run("node") as Record<string, unknown>;
    expect(validateSectionContent({ components: [node] }).errors.map((e) => e.code)).not.toContain("invalid_field_prop");
  });
});
