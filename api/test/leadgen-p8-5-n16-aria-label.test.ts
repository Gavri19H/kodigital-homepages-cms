// P8-5 F2 — N16: a slider/number/currency field's aria-label fell back
// straight to the raw internal_field id (e.g. "ks_nm") whenever the operator
// left the field's own visible props.label unset, at FIVE presets.ts sites
// (renderRange, renderStepperRange, renderRadialRange,
// renderNumberInputQuestion, renderCurrencyInputQuestion). INVARIANT: a
// screen-reader visitor hears the SAME thing a sighted visitor reads — the
// fallback chain now tries the visible label (labelLine's own props.label
// source) BEFORE the stored id.
//
// Driven through the REAL production dispatcher (renderComponent, presets.ts)
// with the REAL default design tokens (defaultFunnelDesign) — never a
// hand-built stand-in for either side of the render boundary.

import { describe, expect, it } from "vitest";
import { renderComponent } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";

const DESIGN = defaultFunnelDesign;

// The raw db slug a screen reader was hearing before this fix — deliberately
// jargon-shaped (mirrors the contract's own quoted "ks_nm" example), never a
// word an operator would author as a visible caption.
const RAW_FIELD_ID = "ks_nm_raw_slug";
const VISIBLE_LABEL = "Estimated monthly premium";

function rangeNode(sliderType: string, label?: string): LeadgenComponentNode {
  const props: Record<string, unknown> = { min: 0, max: 100, slider_type: sliderType };
  if (sliderType === "stepper") props["step"] = 5;
  if (label !== undefined) props["label"] = label;
  return {
    type: "NumberRangeQuestion",
    question_id: "q1",
    internal_field: RAW_FIELD_ID,
    answer_type: "number",
    props,
  };
}

function numberInputNode(label?: string): LeadgenComponentNode {
  const props: Record<string, unknown> = {};
  if (label !== undefined) props["label"] = label;
  return { type: "NumberInputQuestion", question_id: "q1", internal_field: RAW_FIELD_ID, answer_type: "number", props };
}

function currencyInputNode(label?: string): LeadgenComponentNode {
  const props: Record<string, unknown> = {};
  if (label !== undefined) props["label"] = label;
  return { type: "CurrencyInputQuestion", question_id: "q1", internal_field: RAW_FIELD_ID, answer_type: "number", props };
}

// Pulls the aria-label OFF the real answer-producing <input data-lg-input>
// element specifically. renderStepperRange's own -/+ buttons carry their OWN
// literal aria-label="Decrease"/"Increase" in the SAME markup — requiring
// data-lg-input in the same tag means this can never match those buttons.
function inputAriaLabel(html: string): string | undefined {
  const m = html.match(/<input[^>]*\sdata-lg-input[^>]*\saria-label="([^"]*)"/);
  return m ? m[1] : undefined;
}

describe("N16 — aria-label reads the visible label, not the raw internal_field id (5 presets.ts sites)", () => {
  const sliderSites: Array<[string, string]> = [
    ["single (renderRange)", "single"],
    ["stepper (renderStepperRange)", "stepper"],
    ["radial (renderRadialRange)", "radial"],
  ];

  for (const [name, sliderType] of sliderSites) {
    it(`slider ${name}: an authored label reaches the screen reader, never the raw id`, () => {
      const html = renderComponent(rangeNode(sliderType, VISIBLE_LABEL), DESIGN);
      expect(inputAriaLabel(html)).toBe(VISIBLE_LABEL);
      expect(inputAriaLabel(html)).not.toBe(RAW_FIELD_ID);
    });
  }

  it("NumberInputQuestion: an authored label reaches the screen reader, never the raw id", () => {
    const html = renderComponent(numberInputNode(VISIBLE_LABEL), DESIGN);
    expect(inputAriaLabel(html)).toBe(VISIBLE_LABEL);
    expect(inputAriaLabel(html)).not.toBe(RAW_FIELD_ID);
  });

  it("CurrencyInputQuestion: an authored label reaches the screen reader, never the raw id", () => {
    const html = renderComponent(currencyInputNode(VISIBLE_LABEL), DESIGN);
    expect(inputAriaLabel(html)).toBe(VISIBLE_LABEL);
    expect(inputAriaLabel(html)).not.toBe(RAW_FIELD_ID);
  });

  it("residual, unchanged: with NEITHER ariaLabel NOR a visible label authored, the raw internal_field id is still the last-resort fallback (this component genuinely renders no visible text of its own)", () => {
    const html = renderComponent(rangeNode("single", undefined), DESIGN);
    expect(inputAriaLabel(html)).toBe(RAW_FIELD_ID);
  });

  it("an explicit props.ariaLabel still wins over the visible label (top rung unchanged)", () => {
    const node = rangeNode("single", VISIBLE_LABEL);
    (node.props as Record<string, unknown>)["ariaLabel"] = "Explicit override";
    const html = renderComponent(node, DESIGN);
    expect(inputAriaLabel(html)).toBe("Explicit override");
  });
});
