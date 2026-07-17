// v2.5 contract test `continue-single-dom` — the 11 §11.5 SINGLE-CONTROL RULE
// (C3, normative): exactly ONE `[data-lg-continue]` control per rendered
// `<section data-lg-section>` element, in BOTH placements.
//
//   inside_unit  → the authored ContinueButton position (today's behavior,
//                  byte-identical to a no-ctx render);
//   below_unit   → the in-node visual is SUPPRESSED and the single control is
//                  emitted at the END of the same section subtree in the
//                  frame-styled slot (still inside the section element);
//   duplicates   → the FIRST ContinueButton provides props, later ones render
//                  NOTHING (contracted dedupe — applies to pathological
//                  legacy content too);
//   auto_advance → ZERO continue controls in either placement;
//   legacy no-ctx call → today's markup byte-identically (pinned below from
//                  the pre-change renderer).
//
// NOTE (slice boundary): the `duplicate_continue` SAVE warning + the frame
// composition wrapping (`renderQuoteFrame`) belong to sibling/integration
// slices; this file proves the renderer legs.

import { describe, expect, it } from "vitest";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import {
  renderComponent,
  renderSectionComponents,
} from "../src/public/leadgen/components/presets";
import type { LeadgenSectionRenderCtx } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

const DESIGN = defaultFunnelDesign;

// Count the engine's advance hooks. The only attribute in preset output
// beginning with this literal IS the hook itself (the below_unit slot wrapper
// deliberately carries no data-lg-* attribute).
const controls = (html: string): number => (html.match(/data-lg-continue/g) ?? []).length;

// --- fixtures ---------------------------------------------------------------

const HEADLINE: LeadgenComponentNode = {
  type: "QuestionHeadline",
  question_id: "h1",
  props: { text: "Are you insured?" },
};
const YESNO: LeadgenComponentNode = {
  type: "TwoButtonYesNo",
  question_id: "q_ins",
  internal_field: "currently_insured",
  answer_type: "boolean",
  props: { auto_advance: false },
};
const CONT_FIRST: LeadgenComponentNode = {
  type: "ContinueButton",
  question_id: "cont1",
  props: { label: "See my quote", loadingLabel: "Working…" },
};
const CONT_SECOND: LeadgenComponentNode = {
  type: "ContinueButton",
  question_id: "cont2",
  props: { label: "Second continue" },
};
const AUTO_ADV: LeadgenComponentNode = {
  type: "AutoAdvanceButton",
  question_id: "auto1",
  props: { label: "Skip ahead" },
};

const TREE_ONE: LeadgenComponentNode[] = [HEADLINE, YESNO, CONT_FIRST];
// The duplicate is NESTED inside a Stack → proves the dedupe spans the WHOLE
// tree of one renderSectionComponents call, not one nesting level.
const TREE_DUP: LeadgenComponentNode[] = [
  HEADLINE,
  YESNO,
  CONT_FIRST,
  { type: "Stack", question_id: "stk1", children: [CONT_SECOND] },
];
const TREE_NONE: LeadgenComponentNode[] = [HEADLINE, YESNO];

const CTX_BASE: LeadgenSectionRenderCtx = {
  headline_text: "Are you insured?",
  subheadline_text: null,
};
const inside: LeadgenSectionRenderCtx = {
  ...CTX_BASE,
  continue_mode: "button",
  continue_placement: "inside_unit",
  continue_style_role: "button_primary",
};
const below: LeadgenSectionRenderCtx = {
  ...CTX_BASE,
  continue_mode: "button",
  continue_placement: "below_unit",
  continue_style_role: "button_primary",
};
const autoAdvance = (placement: "inside_unit" | "below_unit"): LeadgenSectionRenderCtx => ({
  ...CTX_BASE,
  continue_mode: "auto_advance",
  continue_placement: placement,
});

// The runtime section wrapper (serve.ts 03 §3.2 shape) — the per-section
// element the single-control rule counts against.
const asSection = (body: string): string =>
  `<section data-lg-section data-lg-section-id="lgs_x" data-lg-index="0">${body}</section>`;

// --- pre-change byte pin (captured from the renderer BEFORE this change) ----

// R5 D11 (register S4-B2, operator decision 1): headline typography now
// matches the golden mockup (Newsreader/#16324f) — the only bytes this pin
// carries forward from that ratified, live-funnel-wide change.
// R7 U12 FIX 3b (conductor-ruled 2026-07-15): the unit-level golden question
// card (golden :308) now wraps the ENTIRE depth-1 render, unconditionally —
// the ONE new attributable delta on this pin (the per-node bytes inside are
// otherwise unchanged).
const SNAPSHOT_TREE_ONE_LEGACY =
  `<div class="lg-question-card">` +
  `<h1 class="lg-headline" data-component-type="QuestionHeadline" data-question-id="h1"` +
  ` style="font-family:&#39;Newsreader&#39;,serif;color:#16324f">Are you insured?</h1>` +
  `<div class="lg-answer-group lg-yesno" role="radiogroup" data-component-type="TwoButtonYesNo"` +
  ` data-question-id="q_ins" data-internal-field="currently_insured" data-answer-type="boolean"` +
  ` data-lg-question="q_ins" data-lg-field="currently_insured" data-auto-advance="false">` +
  `<button type="button" class="lg-btn lg-btn-answer" role="radio" aria-checked="false"` +
  ` data-value="true" data-lg-choice="true">Yes</button>` +
  `<button type="button" class="lg-btn lg-btn-answer" role="radio" aria-checked="false"` +
  ` data-value="false" data-lg-choice="false">No</button></div>` +
  // PC-A2 (P4b): every answer-producing leaf now emits its own hidden auto
  // error slot adjacent to the field (zero authoring) — the runtime fills it
  // on a validation failure so the message is VISIBLE, not an invisible border.
  `<p class="lg-error lg-error-auto" role="alert" aria-live="polite" hidden data-lg-error-for="currently_insured" style="color:#D32F2F"></p>` +
  `<button type="submit" class="lg-btn lg-continue" data-component-type="ContinueButton"` +
  ` data-question-id="cont1" data-lg-continue style="color:#FFFFFF"` +
  ` data-loading-label="Working…" data-loading="false">` +
  `<span class="lg-btn-spinner" aria-hidden="true"></span>` +
  `<span class="lg-btn-label">See my quote</span></button>` +
  `</div>`;

describe("continue-single-dom — legacy no-ctx call renders today's markup (byte pin)", () => {
  it("renderSectionComponents without ctx === the pre-change snapshot", () => {
    expect(renderSectionComponents(TREE_ONE, DESIGN)).toBe(SNAPSHOT_TREE_ONE_LEGACY);
  });

  it("renderComponent (single-node path, no render state) still renders a ContinueButton", () => {
    const html = renderComponent(CONT_FIRST, DESIGN);
    expect(controls(html)).toBe(1);
    expect(html).toContain("See my quote");
  });
});

describe("continue-single-dom — inside_unit (authored position, today's behavior)", () => {
  it("exactly ONE control per rendered section element", () => {
    const html = asSection(renderSectionComponents(TREE_ONE, DESIGN, inside));
    expect(controls(html)).toBe(1);
  });

  it("inside_unit output is byte-identical to the no-ctx render (unbound content)", () => {
    expect(renderSectionComponents(TREE_ONE, DESIGN, inside)).toBe(SNAPSHOT_TREE_ONE_LEGACY);
  });

  it("no continue slot is emitted in inside_unit", () => {
    expect(renderSectionComponents(TREE_ONE, DESIGN, inside)).not.toContain("lg-continue-slot");
  });
});

describe("continue-single-dom — below_unit (suppressed in-node visual + end-of-subtree slot)", () => {
  it("exactly ONE control per rendered section element", () => {
    const html = asSection(renderSectionComponents(TREE_ONE, DESIGN, below));
    expect(controls(html)).toBe(1);
  });

  it("the control sits at the END of the section subtree inside the frame-styled slot", () => {
    const html = renderSectionComponents(TREE_ONE, DESIGN, below);
    // ends with the slot-wrapped control
    expect(html.endsWith("</button></div>")).toBe(true);
    const slotAt = html.indexOf(`<div class="lg-continue-slot"`);
    expect(slotAt).toBeGreaterThan(html.indexOf("lg-yesno")); // after the unit content
    // the in-node visual is suppressed: zero controls BEFORE the slot
    expect(controls(html.slice(0, slotAt))).toBe(0);
    expect(controls(html.slice(slotAt))).toBe(1);
  });

  it("label/loading copy comes from the Section's ContinueButton node", () => {
    const html = renderSectionComponents(TREE_ONE, DESIGN, below);
    expect(html).toContain(`<span class="lg-btn-label">See my quote</span>`);
    expect(html).toContain(`data-loading-label="Working…"`);
  });

  it("the slot stamps the §3.3 continue_style_role for frame/theme CSS", () => {
    const html = renderSectionComponents(TREE_ONE, DESIGN, below);
    expect(html).toContain(`<div class="lg-continue-slot" data-continue-style-role="button_primary">`);
  });

  it("a below_unit Section WITHOUT a ContinueButton node still renders exactly one control with theme copy", () => {
    const html = renderSectionComponents(TREE_NONE, DESIGN, below);
    expect(controls(html)).toBe(1);
    expect(html).toContain(`<span class="lg-btn-label">Continue</span>`); // theme default copy
    expect(html).toContain(`class="lg-continue-slot"`);
  });

  it("two independently rendered sections each carry exactly one control", () => {
    const a = asSection(renderSectionComponents(TREE_ONE, DESIGN, below));
    const b = asSection(renderSectionComponents(TREE_NONE, DESIGN, below));
    expect(controls(a)).toBe(1);
    expect(controls(b)).toBe(1);
  });
});

describe("continue-single-dom — duplicate ContinueButton nodes: FIRST provides props, later render NOTHING", () => {
  it("inside_unit: one control, first node's label, at the first node's authored position", () => {
    const html = renderSectionComponents(TREE_DUP, DESIGN, inside);
    expect(controls(html)).toBe(1);
    expect(html).toContain("See my quote");
    expect(html).not.toContain("Second continue");
    // the surviving control renders BEFORE the Stack (its authored position)
    expect(html.indexOf("data-lg-continue")).toBeLessThan(html.indexOf("lg-stack"));
    // the nested duplicate's Stack renders as an EMPTY wrapper
    expect(html).toMatch(/<div class="lg-stack"[^>]*><\/div>/);
  });

  it("below_unit: one control in the slot, first node's props win", () => {
    const html = renderSectionComponents(TREE_DUP, DESIGN, below);
    expect(controls(html)).toBe(1);
    expect(html).toContain("See my quote");
    expect(html).not.toContain("Second continue");
    expect(html.indexOf(`class="lg-continue-slot"`)).toBeLessThan(html.indexOf("data-lg-continue"));
  });

  it("legacy no-ctx render with duplicates is ALSO deduped (the C3 contracted change)", () => {
    const html = renderSectionComponents(TREE_DUP, DESIGN);
    expect(controls(html)).toBe(1);
    expect(html).toContain("See my quote");
    expect(html).not.toContain("Second continue");
  });
});

describe("continue-single-dom — auto_advance renders ZERO continue controls in either placement", () => {
  const TREE_AUTO: LeadgenComponentNode[] = [HEADLINE, YESNO, CONT_FIRST, AUTO_ADV];

  it("inside_unit placement: zero controls", () => {
    const html = renderSectionComponents(TREE_AUTO, DESIGN, autoAdvance("inside_unit"));
    expect(controls(html)).toBe(0);
    expect(html).not.toContain("lg-continue-slot");
  });

  it("below_unit placement: zero controls AND no slot", () => {
    const html = renderSectionComponents(TREE_AUTO, DESIGN, autoAdvance("below_unit"));
    expect(controls(html)).toBe(0);
    expect(html).not.toContain("lg-continue-slot");
  });

  it("the rest of the unit still renders (only the continue controls are suppressed)", () => {
    const html = renderSectionComponents(TREE_AUTO, DESIGN, autoAdvance("inside_unit"));
    expect(html).toContain("lg-headline");
    expect(html).toContain("lg-yesno");
  });
});
