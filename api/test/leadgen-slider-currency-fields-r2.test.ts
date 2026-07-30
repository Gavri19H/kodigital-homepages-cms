// R2 P4 S4c — the currency-display-only guarantee + the slider field-name
// integrity (SOURCE-OF-TRUTH.md A.1 #7B, contract R2 M-2 scope split: the
// three-format value_transform work is P5's; this slice proves the slider
// widget RENDERS + RECORDS correctly, nothing about how a value later ships
// to an Offer).
//
// Owner-verbatim (A.1 #7B): "if I add a '$' I can't save the section because
// of conflict between 'number' and 'currency' ... the currency is only a
// graphic feature ... your conflict here, and in any other component with
// the same dependency, is just a low level sloppy logic."
//
// HONESTY (mission-loop E10/E11): the driven-product proof for this slice —
// a real admin-API section save/toggle round trip (content before/after
// pasted) AND a real /lg/auction call whose leadgen_provider_request_log row
// was read back with the distinctive _min/_max values — lives in the P4 S4c
// dispatch report, not reproducible here without a running wrangler dev
// server. These tests are the deterministic CI-safe regression that PINS the
// two invariants that live drive proved true, exercising the REAL production
// functions on BOTH sides of each boundary (never a hand-built double of
// either side):
//   * validateSectionContent (content-schema.ts) — the real save gate.
//   * normalizeAnswers        (answers.ts)        — the real fieldsOf producer.
//   * renderComponent         (presets.ts, S4a)    — the real DOM the visitor sees.

import { describe, expect, it } from "vitest";
import {
  validateSectionContent,
  LEADGEN_SLIDER_TYPES,
  type LeadgenComponentNode,
  type LeadgenSectionContent,
  type LeadgenSliderType,
} from "../src/public/leadgen/components/content-schema";
import { normalizeAnswers } from "../src/leadgen/answers";
import { renderComponent } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

const DESIGN = defaultFunnelDesign;

function section(components: LeadgenComponentNode[]): LeadgenSectionContent {
  return { components };
}

function slider(type: LeadgenSliderType, internalField: string, currencyAffix?: boolean): LeadgenComponentNode {
  const props: Record<string, unknown> = { min: 0, max: 100, slider_type: type };
  if (type === "stepper") props["step"] = 5;
  if (currencyAffix !== undefined) props["currency_affix"] = currencyAffix;
  return {
    type: "NumberRangeQuestion",
    question_id: `q_${internalField}`,
    internal_field: internalField,
    answer_type: "number",
    props,
  };
}

describe("owner A.1 #7B — currency ($) is DISPLAY-ONLY: the toggle never touches node.type/answer_type", () => {
  it("all five slider types save cleanly OFF -> ON -> OFF again — no save error, ever (the Image9 conflict is gone)", () => {
    for (const type of LEADGEN_SLIDER_TYPES) {
      const off1 = slider(type, `f_${type}`, undefined);
      const on = slider(type, `f_${type}`, true);
      const off2 = slider(type, `f_${type}`, false);
      const r1 = validateSectionContent(section([off1]));
      const r2 = validateSectionContent(section([on]));
      const r3 = validateSectionContent(section([off2]));
      expect(r1.ok, `${type} OFF1: ${JSON.stringify(r1.errors)}`).toBe(true);
      expect(r2.ok, `${type} ON: ${JSON.stringify(r2.errors)}`).toBe(true);
      expect(r3.ok, `${type} OFF2: ${JSON.stringify(r3.errors)}`).toBe(true);
      // The SAME node shape is the literal input to a PASSING validation in
      // all three currency states: the validator never requires, implies, or
      // rejects on a type change for the toggle — type/answer_type are the
      // one thing that stays byte-identical across it.
      for (const n of [off1, on, off2]) {
        expect(n.type).toBe("NumberRangeQuestion");
        expect(n.answer_type).toBe("number");
      }
    }
  });

  it("the render's format switch reads props.currency_affix ONLY — never node.type/answer_type (presets.ts propBool, S4a)", () => {
    for (const type of LEADGEN_SLIDER_TYPES) {
      const withDollar = renderComponent(slider(type, "amt", true), DESIGN);
      const without = renderComponent(slider(type, "amt", false), DESIGN);
      expect(withDollar, type).toContain('data-format="currency"');
      expect(without, type).toContain('data-format="number"');
    }
  });
});

describe("R2 P4 S4c — from_to/dual_range _min/_max field-name AGREEMENT: fieldsOf (answers.ts) == the render's data-lg-field (presets.ts, S4a)", () => {
  it("normalizeAnswers reads EXACTLY {internal_field}_min/{internal_field}_max — the same flat pair the render's data-lg-field wrappers declare", () => {
    for (const type of ["from_to", "dual_range"] as const) {
      const node = slider(type, "band");
      const html = renderComponent(node, DESIGN);
      // the render's own field names (presets.ts rangeMinMaxFieldNames, S4a).
      expect(html, type).toContain('data-lg-field="band_min"');
      expect(html, type).toContain('data-lg-field="band_max"');

      // fieldsOf (answers.ts, unexported — proven through its one producer,
      // normalizeAnswers) reads a raw answer keyed by THOSE SAME flat names.
      const { answers } = normalizeAnswers(section([node]), {
        band_min: 12345,
        band_max: 67890,
      });
      expect(answers, type).toEqual({ band_min: 12345, band_max: 67890 });
      // the base (un-suffixed) internal_field is never a key of its own —
      // dual_range/from_to contribute ONLY the two sub-fields (§6.8/M7).
      expect(Object.prototype.hasOwnProperty.call(answers, "band"), type).toBe(false);
    }
  });

  it("a raw answer keyed by the base field (no _min/_max suffix) is dropped — the base is never a producer for these two types", () => {
    const node = slider("from_to", "band");
    const { answers } = normalizeAnswers(section([node]), { band: 999 });
    expect(answers).toEqual({});
  });

  it("single/stepper/radial keep the scalar internal_field (no _min/_max split)", () => {
    for (const type of ["single", "stepper", "radial"] as const) {
      const node = slider(type, "solo");
      const { answers } = normalizeAnswers(section([node]), { solo: 42 });
      expect(answers, type).toEqual({ solo: 42 });
    }
  });
});
