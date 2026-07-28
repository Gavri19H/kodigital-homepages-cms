// LeadGen R2 P1 §① — the Question-Grid CONTAINER: RUNTIME evaluation (slice
// S1d). Owner-verbatim clauses under test (docs/leadgen/source-of-truth/
// SOURCE-OF-TRUTH.md A.1 #1/#2):
//   · "Each one of this questions is answering another field for the offers
//     payload ... help us to decide the user jurney (the funnel) by the
//     funnel rule" — each child is an INDEPENDENT field.
//   · "if we set a 'default' and the user didn't change it - this is his
//     answer and the 'required' rule is met. but if the user clicked 'no'
//     and the dependency rule wasn't met ... we need to ignore this
//     question- it isn't relevant, so it doesn't exist and the answer is
//     not required."
//
// THE GAP (S1b handoff): config-dto projects a grid as ONE component
// carrying `.children`, but the LIVE evaluators — dependencies.ts
// evaluateComponents/hiddenAnswerFields, validation.ts validateSection —
// read `section.components` only and never descended into `.children`. This
// suite proves the fix at the ONE seam that closes the gap for ALL of them:
// state.ts flattenGridChildren (the boot-time splice engine.ts's constructor
// runs once) — dependencies.ts/validation.ts need ZERO grid-awareness of
// their own; same pure functions, correctly fed.
//
// Also carries the R1b invariant (contract §5.7 / mission-skill-bench
// control-C-GRID m6-value-probe.mjs + m6-control-probe.mjs): a grid child's
// AUTHORED (non-boolean) choice values are never coerced to true/false, and
// a conditional against them matches the literal authored value.

import { describe, expect, it } from "vitest";
import {
  flattenGridChildren,
  LgStateStore,
  type LgComponentConfig,
  type LgSectionConfig,
  type LgStorageAdapter,
} from "../src/public/leadgen/runtime/state";
import { conditionMet, evaluateComponents, hiddenAnswerFields } from "../src/public/leadgen/runtime/dependencies";
import { validateSection } from "../src/public/leadgen/runtime/validation";

// ---------------------------------------------------------------------------
// fixtures — the design-pin grid (Screenshot 2026-07-27 18.30.25): a Yes/No
// -> dependent dropdown (default pre-selected, required) -> credit-score
// dropdown -> buttons conditioned on the NON-boolean "in" leg (mirrors the
// P1 live-drive acceptance's own field names for direct traceability).
// ---------------------------------------------------------------------------

function memoryStorage(): LgStorageAdapter {
  const map = new Map<string, string>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => {
      map.set(k, v);
    },
    remove: (k) => {
      map.delete(k);
    },
    keys: () => [...map.keys()],
  };
}

const Q1: LgComponentConfig = {
  type: "TwoButtonYesNo",
  question_id: "q1",
  internal_field: "r2p1_currently_insured",
  props: {},
};
const Q2: LgComponentConfig = {
  type: "DropdownQuestion",
  question_id: "q2",
  internal_field: "r2p1_current_insurer",
  required: true,
  conditional: { when: "r2p1_currently_insured", op: "eq", value: true },
  choices: [
    { label: "Acme", value: "acme", analytics_id: "a" },
    { label: "Globex", value: "globex", analytics_id: "g" },
  ],
  default_answer: { value: "acme", answer_source: "default_applied" },
  props: {},
};
const Q3: LgComponentConfig = {
  type: "DropdownQuestion",
  question_id: "q3",
  internal_field: "r2p1_credit_score",
  choices: [
    { label: "Poor", value: "Poor", analytics_id: "p" },
    { label: "Fair", value: "Fair", analytics_id: "f" },
    { label: "Good", value: "Good", analytics_id: "gd" },
    { label: "Excellent", value: "Excellent", analytics_id: "e" },
  ],
  props: {},
};
const Q5: LgComponentConfig = {
  type: "ButtonAnswerGroup",
  question_id: "q5",
  internal_field: "r2p1_bankruptcy_status",
  required: true,
  conditional: { when: "r2p1_credit_score", op: "in", values: ["Poor", "Fair"] },
  choices: [
    { label: "Chapter 7", value: "chapter_7", analytics_id: "c7" },
    { label: "None", value: "none", analytics_id: "n" },
  ],
  props: {},
};
const GRID: LgComponentConfig = {
  type: "QuestionGrid",
  question_id: "grid1",
  props: {},
  children: [Q1, Q2, Q3, Q5],
};
const CONT: LgComponentConfig = { type: "ContinueButton", question_id: "cont", props: {} };

function section(components: LgComponentConfig[]): LgSectionConfig {
  return {
    section_public_id: "sec1",
    section_index: 0,
    headline: "Insurance details",
    continue_mode: "button",
    address_validation_enabled: false,
    section_mapping_version: 1,
    answer_mapping_version: "1",
    components,
  };
}

// ---------------------------------------------------------------------------
// flattenGridChildren (state.ts) — the boot-time splice
// ---------------------------------------------------------------------------

describe("flattenGridChildren — boot-time splice (state.ts)", () => {
  it("replaces the container with its children, in order, and drops the container itself", () => {
    const flat = flattenGridChildren([GRID, CONT]);
    expect(flat.map((c) => c.question_id)).toEqual(["q1", "q2", "q3", "q5", "cont"]);
    expect(flat.find((c) => c.question_id === "grid1")).toBeUndefined();
  });

  it("passes a non-grid component through unchanged (byte-identical for pre-R2 content — same object reference)", () => {
    const flat = flattenGridChildren([CONT]);
    expect(flat[0]).toBe(CONT);
  });

  it("preserves each child's choices/conditional/default/required VERBATIM — same object reference, no cloning/coercion", () => {
    const flat = flattenGridChildren([GRID]);
    const q2 = flat.find((c) => c.question_id === "q2");
    expect(q2).toBe(Q2);
    expect(q2?.choices).toEqual(Q2.choices);
    expect(q2?.default_answer).toEqual({ value: "acme", answer_source: "default_applied" });
  });
});

// ---------------------------------------------------------------------------
// evaluateComponents (dependencies.ts) over the flattened list — owner A.1 #2
// ---------------------------------------------------------------------------

describe("evaluateComponents over the flattened list — owner A.1 #2 (unchanged evaluator, correctly fed)", () => {
  const flat = flattenGridChildren([GRID]);

  it("Q1=true reveals Q2 (its own conditional) and marks it required_now", () => {
    const s = evaluateComponents(flat, { r2p1_currently_insured: true });
    const q2 = s.components.find((c) => c.question_id === "q2");
    expect(q2?.visible).toBe(true);
    expect(q2?.required_now).toBe(true);
  });

  it("Q1=false hides Q2 — not required, not visible ('it doesn't exist and the answer is not required')", () => {
    const s = evaluateComponents(flat, { r2p1_currently_insured: false });
    const q2 = s.components.find((c) => c.question_id === "q2");
    expect(q2?.visible).toBe(false);
    expect(q2?.required_now).toBe(false);
  });

  it("Q3=Poor/Fair reveals Q5 via the NON-boolean 'in' op; Q3=Excellent hides it", () => {
    const poor = evaluateComponents(flat, { r2p1_credit_score: "Poor" }).components.find((c) => c.question_id === "q5");
    const excellent = evaluateComponents(flat, { r2p1_credit_score: "Excellent" }).components.find(
      (c) => c.question_id === "q5",
    );
    expect(poor?.visible).toBe(true);
    expect(excellent?.visible).toBe(false);
  });

  it("Q1 (no conditional of its own) is always visible regardless of siblings", () => {
    expect(evaluateComponents(flat, {}).components.find((c) => c.question_id === "q1")?.visible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hiddenAnswerFields (dependencies.ts) — auction/persistence projection
// ---------------------------------------------------------------------------

describe("hiddenAnswerFields over a section carrying a grid — auction projection exclusion", () => {
  it("a hidden child's field is excluded; a visible/unconditional child's is not", () => {
    const sec = section(flattenGridChildren([GRID]));
    const hidden = hiddenAnswerFields([sec], { r2p1_currently_insured: false, r2p1_credit_score: "Excellent" });
    expect(hidden.has("r2p1_current_insurer")).toBe(true); // Q1=false -> Q2 hidden
    expect(hidden.has("r2p1_bankruptcy_status")).toBe(true); // Q3=Excellent -> Q5 hidden
    expect(hidden.has("r2p1_currently_insured")).toBe(false);
    expect(hidden.has("r2p1_credit_score")).toBe(false);
  });

  it("Q1=true + Q3=Poor reveals BOTH Q2 and Q5 — neither is in the hidden set", () => {
    const sec = section(flattenGridChildren([GRID]));
    const hidden = hiddenAnswerFields([sec], { r2p1_currently_insured: true, r2p1_credit_score: "Poor" });
    expect(hidden.has("r2p1_current_insurer")).toBe(false);
    expect(hidden.has("r2p1_bankruptcy_status")).toBe(false);
  });

  it("a hidden child's PRIOR (in-memory) answer is excluded from the auction projection end-to-end", () => {
    const store = new LgStateStore({ storage: memoryStorage(), now: () => 1000 });
    const meta = (qid: string) => ({ question_id: qid, section_public_id: "sec1" });
    store.recordUserAnswer("r2p1_currently_insured", true, meta("q1"));
    store.recordUserAnswer("r2p1_current_insurer", "globex", meta("q2")); // answered while visible
    store.recordUserAnswer("r2p1_credit_score", "Excellent", meta("q3"));
    // visitor flips Q1 to false -> Q2 is now hidden, though its OLD answer is still in memory (back-nav, §3.5.3)
    store.recordUserAnswer("r2p1_currently_insured", false, meta("q1"));
    const sec = section(flattenGridChildren([GRID]));
    const hidden = hiddenAnswerFields([sec], store.answerValues());
    const projected = store.auctionAnswers(hidden);
    expect(projected["r2p1_current_insurer"]).toBeUndefined();
    expect(projected["r2p1_currently_insured"]).toBeDefined();
    expect(projected["r2p1_credit_score"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// validateSection (validation.ts) — required/default semantics, owner A.1 #2
// ---------------------------------------------------------------------------

describe("validateSection over the flattened list — required/default semantics (owner A.1 #2)", () => {
  const flat = flattenGridChildren([GRID]);

  it("a dependency-hidden required child is SKIPPED — never validated, never blocks Continue", () => {
    const answers = { r2p1_currently_insured: false }; // Q2 hidden, unanswered, required:true
    const vis = evaluateComponents(flat, answers).components;
    const failures = validateSection(flat, answers, vis);
    expect(failures.find((f) => f.internal_field === "r2p1_current_insurer")).toBeUndefined();
  });

  it("a visible required child with NO answer fails required", () => {
    const answers = { r2p1_currently_insured: true }; // Q2 visible+required, unanswered
    const vis = evaluateComponents(flat, answers).components;
    const failures = validateSection(flat, answers, vis);
    expect(failures.some((f) => f.internal_field === "r2p1_current_insurer" && f.code === "required")).toBe(true);
  });

  it("the config default counts as answered — satisfies required without the user touching it", () => {
    const answers = { r2p1_currently_insured: true, r2p1_current_insurer: "acme" }; // == Q2.default_answer.value
    const vis = evaluateComponents(flat, answers).components;
    const failures = validateSection(flat, answers, vis);
    expect(failures.find((f) => f.internal_field === "r2p1_current_insurer")).toBeUndefined();
  });

  it("an overriding user answer also satisfies required (override wins over the default)", () => {
    const answers = { r2p1_currently_insured: true, r2p1_current_insurer: "globex" };
    const vis = evaluateComponents(flat, answers).components;
    const failures = validateSection(flat, answers, vis);
    expect(failures.find((f) => f.internal_field === "r2p1_current_insurer")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LgStateStore (state.ts) — default vs override answer-source transitions
// (§3.4), pinned for a grid child field specifically per the acceptance.
// ---------------------------------------------------------------------------

describe("LgStateStore over a grid child field — default vs override (§3.4)", () => {
  const META = { question_id: "q2", section_public_id: "sec1" };

  it("applyDefault records default_applied once; a DIFFERENT user value overrides it (user_selected)", () => {
    const store = new LgStateStore({ storage: memoryStorage(), now: () => 1000 });
    store.applyDefault("r2p1_current_insurer", "acme", META);
    expect(store.getAnswer("r2p1_current_insurer")?.answer_source).toBe("default_applied");
    const write = store.recordUserAnswer("r2p1_current_insurer", "globex", META);
    expect(write.entry.answer_source).toBe("user_selected");
    expect(store.getAnswer("r2p1_current_insurer")?.value).toBe("globex");
  });

  it("re-selecting the SAME default value confirms it (user_confirmed_default) — still satisfies required", () => {
    const store = new LgStateStore({ storage: memoryStorage(), now: () => 1000 });
    store.applyDefault("r2p1_current_insurer", "acme", META);
    const write = store.recordUserAnswer("r2p1_current_insurer", "acme", META);
    expect(write.entry.answer_source).toBe("user_confirmed_default");
  });
});

// ---------------------------------------------------------------------------
// R1b invariant — contract §5.7 / mission-skill-bench control-C-GRID
// m6-value-probe.mjs + m6-control-probe.mjs: an authored (non-boolean)
// choice value flows verbatim and a conditional against it matches the
// literal authored string — never coerced to true/false.
// ---------------------------------------------------------------------------

describe("R1b invariant — a grid child's authored value is never coerced (pinned, no defect found)", () => {
  it("an 'in' rule against a grid-sibling's literal STRING values matches exactly those strings", () => {
    expect(
      conditionMet({ when: "r2p1_credit_score", op: "in", values: ["Poor", "Fair"] }, { r2p1_credit_score: "Poor" }),
    ).toBe(true);
    expect(
      conditionMet({ when: "r2p1_credit_score", op: "in", values: ["Poor", "Fair"] }, { r2p1_credit_score: "Good" }),
    ).toBe(false);
  });

  it("an authored 'yes'/'no' STRING choice domain (never coerced to true/false) still drives its sibling's eq rule post-flatten", () => {
    const yesNoChild: LgComponentConfig = {
      type: "ButtonAnswerGroup",
      question_id: "qc",
      internal_field: "carrier_opt_in",
      choices: [
        { label: "Yes", value: "yes", analytics_id: "y" },
        { label: "No", value: "no", analytics_id: "n" },
      ],
      props: {},
    };
    const dependent: LgComponentConfig = {
      type: "DropdownQuestion",
      question_id: "qd",
      internal_field: "carrier_detail",
      conditional: { when: "carrier_opt_in", op: "eq", value: "yes" },
      choices: [],
      props: {},
    };
    const grid: LgComponentConfig = { type: "QuestionGrid", question_id: "g2", props: {}, children: [yesNoChild, dependent] };
    const flat = flattenGridChildren([grid]);
    // A LIVE click on a `choices`-carrying component records the AUTHORED
    // STRING verbatim (engine.ts handleChoiceActivation: `component?.choices
    // ?.find(...)`), never coerced — this proves the sibling's eq rule
    // matches that literal string with NO coercion, exactly like the probe's
    // "yes"/"no" domain (mission-skill-bench m6-control-probe.mjs).
    expect(evaluateComponents(flat, { carrier_opt_in: "yes" }).components.find((c) => c.question_id === "qd")?.visible).toBe(
      true,
    );
    expect(evaluateComponents(flat, { carrier_opt_in: "no" }).components.find((c) => c.question_id === "qd")?.visible).toBe(
      false,
    );
  });
});
