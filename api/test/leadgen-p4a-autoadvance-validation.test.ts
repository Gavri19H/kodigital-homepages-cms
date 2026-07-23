// P4a auto_advance SAVE-TIME eligibility (register PC-4-behavior / PC-A1).
//
// The operator's binding rule: continue_mode="auto_advance" is valid ONLY for a
// section the engine can actually auto-advance — exactly ONE answer-producing
// component, single-select, click-to-answer (buttons/cards), no conditional.
// Every other composition needs the Continue button. This proves the
// `auto_advance_conflict` gate in content-schema.ts: a save endpoint turns any
// error into a 400 (leadgen-sections-api.test.ts holds the HTTP leg), so this
// is the gate's unit evidence, one row per composition class from the rule.
import { describe, expect, it } from "vitest";
import {
  autoAdvanceEligibility,
  validateSectionContent,
} from "../src/public/leadgen/components/content-schema";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";

const codesOf = (r: ReturnType<typeof validateSectionContent>): string[] => r.errors.map((e) => e.code);
const content = (components: unknown[]): { components: unknown[] } => ({ components });

// Minimal, otherwise-valid nodes (each verified to save clean in button mode
// below, so any auto_advance_conflict is the ONLY code the matrix rows assert).
const choice = (v: string) => ({ label: v.toUpperCase(), value: v, analytics_id: v });
// ELIGIBLE: single-select click-to-answer (fires handleChoiceActivation).
const yesno = (id: string, extra?: Record<string, unknown>): LeadgenComponentNode =>
  ({ type: "TwoButtonYesNo", question_id: id, internal_field: id, ...extra }) as LeadgenComponentNode;
const buttons = (id: string, extra?: Record<string, unknown>): LeadgenComponentNode =>
  ({ type: "ButtonAnswerGroup", question_id: id, internal_field: id, choices: [choice("a"), choice("b")], ...extra }) as LeadgenComponentNode;
// INELIGIBLE: multi-select (answer_type array).
const multi = (id: string): LeadgenComponentNode =>
  ({ type: "MultiChoiceCardGroup", question_id: id, internal_field: id, choices: [choice("a"), choice("b")], props: { min: 1, max: 2 } }) as LeadgenComponentNode;
// INELIGIBLE: no click-to-answer control (select fires change→handleInputEvent).
const dropdown = (id: string): LeadgenComponentNode =>
  ({ type: "DropdownQuestion", question_id: id, internal_field: id, choices: [choice("a"), choice("b")] }) as LeadgenComponentNode;
const freetext = (id: string): LeadgenComponentNode =>
  ({ type: "FreeTextQuestion", question_id: id, internal_field: id }) as LeadgenComponentNode;
// Non-producing chrome/affordance — never counts toward the producer tally.
const text = (id: string): LeadgenComponentNode =>
  ({ type: "TextBlock", question_id: id, props: { role: "body", text: "t" } }) as LeadgenComponentNode;

describe("P4a auto_advance eligibility — the VALID single-choice case saves", () => {
  it("one single-select TwoButtonYesNo + decorative TextBlocks is eligible (no conflict)", () => {
    const body = content([text("hd"), yesno("insured"), text("legal")]);
    expect(autoAdvanceEligibility(body.components as LeadgenComponentNode[]).eligible).toBe(true);
    expect(codesOf(validateSectionContent(body, "auto_advance"))).toEqual([]);
  });

  it("one single-select ButtonAnswerGroup is eligible (no conflict)", () => {
    const body = content([buttons("q1")]);
    expect(codesOf(validateSectionContent(body, "auto_advance"))).toEqual([]);
  });

  it("every eligible node type validates clean under auto_advance", () => {
    for (const t of ["ButtonAnswerGroup", "TwoButtonYesNo", "IconCardAnswerGrid", "ImageCardAnswerGrid"]) {
      const node: Record<string, unknown> = { type: t, question_id: "q", internal_field: "q", choices: [choice("a")] };
      if (t === "IconCardAnswerGrid") node["choices"] = [{ ...choice("a"), icon: "check" }];
      if (t === "ImageCardAnswerGrid") node["choices"] = [{ ...choice("a"), imageMediaId: "m1", image_alt: "alt" }];
      const r = validateSectionContent(content([node]), "auto_advance");
      expect(r.errors.filter((e) => e.code === "auto_advance_conflict"), t).toEqual([]);
    }
  });
});

describe("P4a auto_advance eligibility — REJECT (400) every stuck composition", () => {
  it("MULTIPLE components → multiple_producers conflict, names the components", () => {
    const body = content([yesno("a"), buttons("b")]);
    const r = validateSectionContent(body, "auto_advance");
    expect(codesOf(r)).toEqual(["auto_advance_conflict"]);
    expect(r.errors[0]?.message).toContain("2 answer components");
    expect(r.errors[0]?.message).toContain("TwoButtonYesNo");
    expect(autoAdvanceEligibility(body.components as LeadgenComponentNode[]).reason).toBe("multiple_producers");
  });

  it("NO-CLICK-ONLY (dropdown) → not_click_to_answer conflict", () => {
    const r = validateSectionContent(content([dropdown("q")]), "auto_advance");
    expect(codesOf(r)).toEqual(["auto_advance_conflict"]);
    expect(r.errors[0]?.message).toContain("DropdownQuestion");
  });

  it("NO-CLICK-ONLY (free-text input) → not_click_to_answer conflict", () => {
    const r = validateSectionContent(content([freetext("q")]), "auto_advance");
    expect(codesOf(r)).toEqual(["auto_advance_conflict"]);
    expect(autoAdvanceEligibility([freetext("q")]).reason).toBe("not_click_to_answer");
  });

  it("MULTI-SELECT-ONLY → multi_select conflict", () => {
    const r = validateSectionContent(content([multi("q")]), "auto_advance");
    expect(codesOf(r)).toEqual(["auto_advance_conflict"]);
    expect(autoAdvanceEligibility([multi("q")]).reason).toBe("multi_select");
  });

  it("ButtonAnswerGroup configured multi (props.multiple) → multi_select conflict", () => {
    const r = validateSectionContent(content([buttons("q", { props: { multiple: true } })]), "auto_advance");
    expect(codesOf(r)).toEqual(["auto_advance_conflict"]);
  });

  it("REVEAL-RULE RISK: 1 base + 1 conditional producer → multiple_producers (a 2nd CAN become visible)", () => {
    const conditional = buttons("b", { conditional: { when: "a", op: "eq", value: "x" } });
    const r = validateSectionContent(content([yesno("a"), conditional]), "auto_advance");
    expect(codesOf(r)).toEqual(["auto_advance_conflict"]);
    expect(autoAdvanceEligibility([yesno("a"), conditional]).reason).toBe("multiple_producers");
  });

  it("REVEAL-RULE RISK: the SOLE producer carries a conditional → conditional_producer", () => {
    const node = yesno("a", { conditional: { when: "hd", op: "eq", value: "y" } });
    const r = validateSectionContent(content([text("hd"), node]), "auto_advance");
    expect(codesOf(r)).toEqual(["auto_advance_conflict"]);
    expect(autoAdvanceEligibility([node]).reason).toBe("conditional_producer");
  });

  it("NO producers (chrome-only section) → no_producers conflict", () => {
    const r = validateSectionContent(content([text("hd"), text("legal")]), "auto_advance");
    expect(codesOf(r)).toEqual(["auto_advance_conflict"]);
    expect(autoAdvanceEligibility([text("hd")]).reason).toBe("no_producers");
  });
});

describe("P4a auto_advance eligibility — button mode is never gated (regression)", () => {
  it("the SAME stuck compositions save clean in button mode (or with continue_mode omitted)", () => {
    const stuck = [content([yesno("a"), buttons("b")]), content([dropdown("q")]), content([multi("q")])];
    for (const body of stuck) {
      expect(codesOf(validateSectionContent(body, "button"))).toEqual([]);
      expect(codesOf(validateSectionContent(body))).toEqual([]);
    }
  });
});
