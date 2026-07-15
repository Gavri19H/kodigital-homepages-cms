// LeadGen v3.1 R7 U11b — RENDERED field/group centering gate (the assertion
// class the operator retest proved was missing: grounded fixed-width presets
// (R3) rendered LEFT-stuck because centering was NEVER asserted anywhere).
//
// A field/group whose width resolves to a FIXED (non-full) value must CENTER
// within its unit column (the operator's "no way to center; sized elements sit
// LEFT-aligned"). This gate asserts the RENDERED inline style emits the
// centering mechanism (margin-left/right:auto centers a block box on a fixed
// width; the inline-level <input>/<select> additionally needs display:block)
// for width s/m/l on a FreeText (input) AND a ButtonAnswerGroup, AND that the
// FULL-width / no-override output is BYTE-IDENTICAL (no centering leaks in).
//
// The |centerOffset| ≤ 1px BROWSER measurement is the complementary gesture-
// spec assertion (test-ui effects spec) — this Node gate pins the CSS
// mechanism that makes the pixels center by construction.
//
// FAIL-BEFORE (unfixed code): the fixed-width style carried width:Npx with NO
// margin:auto / display:block → left-stuck. Reproduce by neutralising
// widthCenteringEntries (return {}) in components/presets.ts → these RED.

import { describe, expect, it } from "vitest";
import { renderComponent } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";

const WIDTH_PX: Record<string, string> = { s: "300px", m: "384px", l: "480px" };

function freeText(width: string): LeadgenComponentNode {
  return {
    type: "FreeTextQuestion",
    question_id: "q_ft",
    answer_type: "string",
    props: { placeholder: "x" },
    design_overrides: { size: { width: width as "s" | "m" | "l" | "full" } },
  } as LeadgenComponentNode;
}
function buttonGroup(width: string): LeadgenComponentNode {
  return {
    type: "ButtonAnswerGroup",
    question_id: "q_bag",
    answer_type: "string",
    props: {},
    choices: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
    design_overrides: { size: { width: width as "s" | "m" | "l" | "full" } },
  } as unknown as LeadgenComponentNode;
}
function render(node: LeadgenComponentNode): string {
  return renderComponent(node, defaultFunnelDesign, 1, undefined);
}
// The inline style on the element carrying the width (the .lg-input, or the
// .lg-answer-group root).
function styleOf(html: string, className: string): string {
  const re = new RegExp(`class="${className}[^"]*"[^>]*?style="([^"]*)"`);
  const m = html.match(re);
  return m ? m[1]! : "";
}

describe("U11b centering — FreeText (input) width s/m/l centers", () => {
  for (const w of ["s", "m", "l"]) {
    it(`width ${w}: .lg-input emits width:${WIDTH_PX[w]} + display:block + margin auto`, () => {
      const st = styleOf(render(freeText(w)), "lg-input");
      expect(st, "carries the fixed width").toContain(`width:${WIDTH_PX[w]}`);
      expect(st, "block-level so auto margins apply to the replaced input").toContain("display:block");
      expect(st).toContain("margin-left:auto");
      expect(st).toContain("margin-right:auto");
    });
  }
});

describe("U11b centering — ButtonAnswerGroup width s/m/l centers", () => {
  for (const w of ["s", "m", "l"]) {
    it(`width ${w}: .lg-answer-group emits width:${WIDTH_PX[w]} + margin auto`, () => {
      const st = styleOf(render(buttonGroup(w)), "lg-answer-group");
      expect(st).toContain(`width:${WIDTH_PX[w]}`);
      expect(st).toContain("margin-left:auto");
      expect(st).toContain("margin-right:auto");
      // a block <div> centers on auto margins alone — no display:block needed.
      expect(st).not.toContain("display:block");
    });
  }
});

describe("U11b centering — FULL / no-override is BYTE-IDENTICAL (no centering leak)", () => {
  it("FreeText width:full → width:100%, NO margin:auto / display:block", () => {
    const st = styleOf(render(freeText("full")), "lg-input");
    expect(st).toContain("width:100%");
    expect(st).not.toContain("margin-left:auto");
    expect(st).not.toContain("display:block");
  });

  it("ButtonAnswerGroup width:full → width:100%, NO margin:auto", () => {
    const st = styleOf(render(buttonGroup("full")), "lg-answer-group");
    expect(st).toContain("width:100%");
    expect(st).not.toContain("margin-left:auto");
  });

  it("FreeText with NO size override → the input carries NO inline size/centering style", () => {
    const html = render({
      type: "FreeTextQuestion",
      question_id: "q_ft2",
      answer_type: "string",
      props: { placeholder: "x" },
    } as LeadgenComponentNode);
    expect(html).not.toContain("margin-left:auto");
    expect(html).not.toContain("width:300px");
    // pre-v3.1 byte-identity: the bare input carries no style attribute at all.
    expect(html).toMatch(/<input class="lg-input" type="text"[^>]*data-lg-input placeholder=/);
  });
});
