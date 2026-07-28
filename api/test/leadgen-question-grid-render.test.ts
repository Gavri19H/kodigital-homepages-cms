// LeadGen R2 P1 §① — the QUESTION GRID container RENDER (slice S1b).
//
// The spec these tests hold is the owner's own words + the design pin:
//
//   A.1 #1  "Each question in the component is independent field, with
//            independent answers, inefendent **defaults!!** … independent
//            style" / "you left a lot of dead parts- If each question is
//            independent so why did you kept the main 'Helper text'? if each
//            question is independent why you kept main 'Answer format'? what
//            is it 'sub questions'???? there is no 'Main question'!!!"
//   A.1 #2  "I changed the 'Are you currectly insured' question and the 'who
//            is your current insurer' dropdown is poped up … if the user
//            clicked 'no' and the dependency rule wasn't met, we need to
//            ignore this question- it isn't relevant, so it doesn't exist"
//   pin     docs/leadgen/source-of-truth/images/
//           "Screenshot 2026-07-27 at 18.30.25.png" — one screen: a title,
//           STACKED LABELED questions of MIXED types (Yes/No pairs +
//           dropdowns), the dependent dropdown appearing under its own label,
//           and ONE Continue for the whole screen.
//
// SCOPE OF PROOF (E10 honesty): these are SERVER-RENDER proofs — the markup
// anatomy the live runtime and both preview surfaces consume. They prove the
// DOM contract (one hideable labeled block per question, per-child renderers,
// per-child overrides, no shared/dead container fields, no extra Continue).
// The visitor-visible behavior itself (a click hides the block, the ✓ paints)
// is the driven-product gate's job, not this lane's.

import { describe, expect, it } from "vitest";
import {
  renderComponent,
  renderSectionComponents,
  renderSectionComponentsVisible,
} from "../src/public/leadgen/components/presets";
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";

const DESIGN = defaultFunnelDesign;

// ---------------------------------------------------------------------------
// fixtures — the design pin's OWN screen, node for node
// ---------------------------------------------------------------------------

const INSURER_CHOICES = [
  { label: "Geico", value: "geico", analytics_id: "ins_geico" },
  { label: "Progressive", value: "progressive", analytics_id: "ins_prog" },
];
const CREDIT_CHOICES = [
  { label: "Excellent", value: "excellent", analytics_id: "cs_exc" },
  { label: "Good", value: "good", analytics_id: "cs_good" },
];
const CARRIER_CHOICES = [
  { label: "State Farm", value: "state_farm", analytics_id: "car_sf" },
  { label: "Farmers", value: "farmers", analytics_id: "car_farm" },
];

// The pin, 1:1: Q1 Yes/No → Q2 dependent dropdown → Q3 dropdown → Q4 Yes/No →
// (Q5 buttons, the §4 "another buttons structure" family) — ONE group.
function pinGrid(): LeadgenComponentNode {
  return {
    type: "QuestionGrid",
    question_id: "grid_ins",
    props: { gap: "m" },
    children: [
      {
        type: "TwoButtonYesNo",
        question_id: "q_insured",
        internal_field: "currently_insured",
        required: true,
        props: { label: "Are you currently insured?", defaultValue: true },
      },
      {
        type: "DropdownQuestion",
        question_id: "q_insurer",
        internal_field: "current_insurer",
        required: true,
        choices: INSURER_CHOICES,
        // `default` is the SSR pre-selection key renderDropdownQuestion reads;
        // `defaultValue` is the /lg/config default_answer key (config-dto).
        // A grid child owns BOTH independently — see the S1c/S1d handoff note.
        props: { label: "Who is your current insurer?", default: "geico", defaultValue: "geico" },
        conditional: { when: "currently_insured", op: "eq", value: true },
      },
      {
        type: "DropdownQuestion",
        question_id: "q_credit",
        internal_field: "credit_score",
        choices: CREDIT_CHOICES,
        props: { label: "Credit Score", default: "excellent", defaultValue: "excellent" },
      },
      {
        type: "TwoButtonYesNo",
        question_id: "q_accidents",
        internal_field: "accidents_3y",
        props: { label: "Accidents in the last 3 years?", defaultValue: false },
      },
      {
        type: "ButtonAnswerGroup",
        question_id: "q_carrier",
        internal_field: "preferred_carrier",
        choices: CARRIER_CHOICES,
        props: { label: "Preferred carrier?", selected_marker: "mark" },
      },
    ],
  } as LeadgenComponentNode;
}

// One question's rendered block. Children never nest another `.lg-qgrid-q`, so
// splitting on the opening tag yields exactly one chunk per question.
function questionBlocks(html: string): string[] {
  return html.split('<div class="lg-qgrid-q').slice(1);
}
function blockFor(html: string, questionId: string): string {
  const block = questionBlocks(html).find((b) => b.includes(`data-lg-question="${questionId}"`));
  expect(block, `a .lg-qgrid-q block exists for ${questionId}`).toBeDefined();
  return block!;
}

// ---------------------------------------------------------------------------
// 1. N children → N labeled blocks (NEVER one merged unit)
// ---------------------------------------------------------------------------

describe("QuestionGrid render — N independent questions, N labeled blocks", () => {
  it("the pin fixture is minimal-valid content", () => {
    expect(validateSectionContent({ components: [pinGrid()] }).errors).toEqual([]);
  });

  it("5 children render 5 labeled blocks inside ONE grid container (never merged)", () => {
    const html = renderComponent(pinGrid(), DESIGN);
    expect(questionBlocks(html).length).toBe(5);
    // …each with its OWN label line, in the pin's own order.
    const labels = [
      "Are you currently insured?",
      "Who is your current insurer?",
      "Credit Score",
      "Accidents in the last 3 years?",
      "Preferred carrier?",
    ];
    for (const label of labels) expect(html).toContain(`<span class="lg-label">${label}</span>`);
    let cursor = -1;
    for (const label of labels) {
      const at = html.indexOf(`<span class="lg-label">${label}</span>`);
      expect(at, `${label} renders after the previous question`).toBeGreaterThan(cursor);
      cursor = at;
    }
    // ONE container, stacked, with the authored gap inline (per-instance token).
    expect((html.match(/class="lg-qgrid"/g) ?? []).length).toBe(1);
    expect(html).toContain('<div class="lg-qgrid" data-component-type="QuestionGrid"');
    expect(html).toContain(`style="gap:${DESIGN.stack.gapM}"`);
  });

  it("each child answers its OWN field through its OWN renderer (independent hydration)", () => {
    const html = renderComponent(pinGrid(), DESIGN);
    for (const [qid, field] of [
      ["q_insured", "currently_insured"],
      ["q_insurer", "current_insurer"],
      ["q_credit", "credit_score"],
      ["q_accidents", "accidents_3y"],
      ["q_carrier", "preferred_carrier"],
    ] as const) {
      expect(html, qid).toContain(`data-lg-question="${qid}"`);
      expect(html, field).toContain(`data-lg-field="${field}"`);
    }
    // mixed control types, each from its own preset (no bespoke grid control).
    expect((html.match(/class="lg-answer-group lg-yesno"/g) ?? []).length).toBe(2);
    expect((html.match(/class="lg-input lg-dropdown"/g) ?? []).length).toBe(2);
    expect((html.match(/class="lg-answer-group" role="radiogroup"/g) ?? []).length).toBe(1);
  });

  it("independent DEFAULTS: every child's own default renders (not only the first)", () => {
    const html = renderComponent(pinGrid(), DESIGN);
    // the dropdowns pre-select their own default option…
    expect(html).toContain('<option value="geico" data-lg-choice="geico" data-analytics-id="ins_geico" selected>');
    expect(html).toContain('<option value="excellent" data-lg-choice="excellent" data-analytics-id="cs_exc" selected>');
    // …and no placeholder option stays selected where a default exists.
    expect(html).not.toContain('<option value="" disabled selected>');
  });

  it("the CONTAINER carries no [data-lg-question] and no answer hooks of its own", () => {
    const html = renderComponent(pinGrid(), DESIGN);
    const containerTag = html.slice(0, html.indexOf(">") + 1);
    expect(containerTag).toContain('data-component-type="QuestionGrid"');
    expect(containerTag).toContain('data-question-id="grid_ins"');
    expect(containerTag).not.toContain("data-lg-question");
    expect(containerTag).not.toContain("data-lg-field");
    expect(containerTag).not.toContain("data-answer-type");
    // exactly one [data-lg-question] per CHILD — the group adds none.
    expect((html.match(/data-lg-question="/g) ?? []).length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 2. the dead parts the owner named are absent from the rendered DOM
// ---------------------------------------------------------------------------

describe("QuestionGrid render — no 'dead parts' (owner A.1 #1)", () => {
  it("renders no Main question / Helper text / Answer format / sub-questions chrome", () => {
    const html = renderComponent(pinGrid(), DESIGN);
    for (const dead of ["Helper text", "Answer format", "sub-questions", "sub questions", "Main question"]) {
      expect(html, `"${dead}" never appears in the rendered grid`).not.toContain(dead);
    }
    // and none of the retired one-unit grid's own markup survives.
    expect(html).not.toContain("lg-mqg");
    expect(html).not.toContain("data-component-type=\"MultiQuestionGrid\"");
  });
});

// ---------------------------------------------------------------------------
// 3. the dependency anatomy (owner A.1 #2 + probe A1: the label may never
//    orphan) — label + control share ONE hideable wrapper
// ---------------------------------------------------------------------------

describe("QuestionGrid render — a conditional question's label + control share ONE hide target", () => {
  it("the conditional child's wrapper carries data-lg-node and CONTAINS both label and control", () => {
    const html = renderComponent(pinGrid(), DESIGN);
    const block = blockFor(html, "q_insurer");
    const openTag = block.slice(0, block.indexOf(">"));
    expect(openTag).toContain('data-lg-node="q_insurer"');
    expect(block).toContain('<span class="lg-label">Who is your current insurer?</span>');
    expect(block).toContain('data-lg-question="q_insurer"');
    // the label sits INSIDE the same wrapper, ABOVE the control (pin anatomy).
    expect(block.indexOf('class="lg-label"')).toBeLessThan(block.indexOf('data-lg-question="q_insurer"'));
  });

  it("the runtime's hide target (first [data-lg-question|data-lg-node] match) IS that wrapper", () => {
    // render.applyComponentVisibility selects
    // `[data-lg-question="q"],[data-lg-node="q"]` and toggles the FIRST match in
    // document order — the ancestor wrapper, so hiding it takes the label with
    // it ("it isn't relevant, so it doesn't exist"), never the control alone.
    const html = renderComponent(pinGrid(), DESIGN);
    const nodeHook = html.indexOf('data-lg-node="q_insurer"');
    const questionHook = html.indexOf('data-lg-question="q_insurer"');
    expect(nodeHook).toBeGreaterThan(-1);
    expect(nodeHook).toBeLessThan(questionHook);
    // the wrapper opens BEFORE the label, which is before the control.
    const wrapperOpen = html.lastIndexOf('<div class="lg-qgrid-q', nodeHook);
    const labelAt = html.indexOf('<span class="lg-label">Who is your current insurer?</span>');
    expect(wrapperOpen).toBeGreaterThan(-1);
    expect(wrapperOpen).toBeLessThan(labelAt);
    expect(labelAt).toBeLessThan(questionHook);
  });

  it("an UNconditional question gets a plain block (no hide hook invented)", () => {
    const html = renderComponent(pinGrid(), DESIGN);
    const block = blockFor(html, "q_credit");
    expect(block.slice(0, block.indexOf(">"))).not.toContain("data-lg-node");
    expect((html.match(/data-lg-node="/g) ?? []).length).toBe(1); // only q_insurer
  });

  it("the dependency PREVIEW walk drops the hidden question's WHOLE block (label included)", () => {
    const visible = new Set(["q_insured", "q_credit", "q_accidents", "q_carrier"]); // insurer hidden
    const html = renderSectionComponentsVisible([pinGrid()], DESIGN, visible);
    expect(html).toContain('class="lg-qgrid"'); // the group itself stays
    expect(questionBlocks(html).length).toBe(4);
    expect(html).not.toContain("Who is your current insurer?");
    expect(html).not.toContain('data-lg-question="q_insurer"');
    // the other questions are untouched.
    expect(html).toContain("Credit Score");
    expect(html).toContain('data-lg-question="q_insured"');
  });
});

// ---------------------------------------------------------------------------
// 4. per-question style deviation (D4) — "if the user wants to deviate from
//    the theme - independent style"
// ---------------------------------------------------------------------------

describe("QuestionGrid render — per-question design_overrides land on THAT child only", () => {
  it("one child's override renders on its control; its siblings stay untouched", () => {
    const grid = pinGrid();
    const children = grid.children as LeadgenComponentNode[];
    children[2] = {
      ...(children[2] as LeadgenComponentNode),
      design_overrides: { size: { width: "s" }, corners: "pill" },
    } as LeadgenComponentNode;
    expect(validateSectionContent({ components: [grid] }).errors).toEqual([]);
    const html = renderComponent(grid, DESIGN);
    const styled = blockFor(html, "q_credit");
    const sibling = blockFor(html, "q_insurer");
    expect(styled).toContain("border-radius:");
    expect(styled).toMatch(/<select[^>]*style="[^"]*border-radius/);
    // the SIBLING dropdown (same type, no override) carries no inline field style.
    expect(sibling).not.toMatch(/<select[^>]*style="/);
  });
});

// ---------------------------------------------------------------------------
// 5. ONE Continue for the whole screen (the pin) — the group adds none
// ---------------------------------------------------------------------------

describe("QuestionGrid render — ONE Continue for the whole screen", () => {
  it("a section of [headline, grid, continue] renders exactly one continue control", () => {
    const nodes: LeadgenComponentNode[] = [
      { type: "QuestionHeadline", question_id: "h1", props: { text: "Insurance Details" } } as LeadgenComponentNode,
      pinGrid(),
      { type: "ContinueButton", question_id: "c1", props: { label: "Continue" } } as LeadgenComponentNode,
    ];
    expect(validateSectionContent({ components: nodes }).errors).toEqual([]);
    const html = renderSectionComponents(nodes, DESIGN);
    expect((html.match(/data-lg-continue/g) ?? []).length).toBe(1);
    // …and it is the LAST thing on the screen, below every question block.
    expect(html.indexOf("data-lg-continue")).toBeGreaterThan(html.lastIndexOf('class="lg-qgrid-q'));
    expect(html).toContain("Insurance Details");
    expect(questionBlocks(html).length).toBe(5);
  });

  it("the grid alone adds NO continue control", () => {
    expect(renderComponent(pinGrid(), DESIGN)).not.toContain("data-lg-continue");
  });
});

// ---------------------------------------------------------------------------
// 6. the ✓ INSIDE the chosen button (owner A.1 #4; probe 4a "contrast subtle")
// ---------------------------------------------------------------------------

describe("QuestionGrid buttons — the ✓ inside the chosen answer is legible", () => {
  it("the marker markup stays INSIDE the button (anatomy unchanged)", () => {
    const html = renderComponent(pinGrid(), DESIGN);
    const block = blockFor(html, "q_carrier");
    expect((block.match(/lg-check-hollow/g) ?? []).length).toBe(2); // one per choice
    expect((block.match(/lg-check-badge/g) ?? []).length).toBe(2);
    // each marker pair opens INSIDE its own <button>, before the label text.
    expect(block).toMatch(
      /<button [^>]*data-lg-choice="state_farm"[^>]*><span class="lg-check-hollow"[^>]*><\/span><span class="lg-check-badge"/,
    );
  });

  it("the DEFAULT design now styles that ✓ — a filled primary disc, not a bare white glyph", () => {
    // Probe 4a's nit: the badge markup renders on any AUTHOR-opted question
    // (props/choice selected_marker), but its CSS used to be emitted only for a
    // theme whose Selected axis was 'mark' — so on the default design the ✓ was
    // an unhidden, uncircled WHITE glyph on the light selected wash.
    const sheet = funnelChromeCss(DESIGN);
    expect(sheet).toMatch(/\.lg-check-badge\{display:none;width:19px;height:19px/);
    expect(sheet).toContain(`background:${DESIGN.color.primary}`);
    expect(sheet).toMatch(/\.lg-check-hollow\{width:17px;height:17px/);
    // resting hollow hidden / filled badge shown on the selected button.
    expect(sheet).toContain('.lg-answer-group[data-card-select="mark"] .lg-btn-answer.lg-selected .lg-check-badge');
    // the glyph itself is white — on #1B3A5C, not on the #E8EEF4 wash.
    expect(renderComponent(pinGrid(), DESIGN)).toContain('stroke="#fff"');
    expect(DESIGN.color.primary).toBe("#1B3A5C");
  });
});

// ---------------------------------------------------------------------------
// 7. the grid's own CSS — stacked, mobile-safe
// ---------------------------------------------------------------------------

describe("QuestionGrid CSS — one stacked column, no 375 overflow", () => {
  it("the chrome sheet stacks the group and clamps every block", () => {
    const sheet = funnelChromeCss(DESIGN);
    expect(sheet).toMatch(/\.lg-qgrid\{display:grid;grid-template-columns:minmax\(0, 1fr\);width:100%;box-sizing:border-box\}/);
    expect(sheet).toMatch(/\.lg-qgrid-q\{min-width:0;max-width:100%\}/);
    // the gap is per-instance (inline), never hard-coded in the sheet.
    expect(sheet).not.toContain(".lg-qgrid{display:grid;gap:");
  });
});
