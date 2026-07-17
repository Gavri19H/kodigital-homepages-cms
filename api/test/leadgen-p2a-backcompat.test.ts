// P2a §R-A back-compat BYTE gate (the phase invariant): content WITHOUT any
// per-choice `style` (and TwoButtonYesNo without props.yesStyle/noStyle) MUST
// render BYTE-IDENTICAL to the pre-P2a output. The fixture
// (fixtures/leadgen-p2a-backcompat/unstyled-choice-render.json) was frozen from
// HEAD before the presets per-choice change; this test re-renders the SAME
// unstyled nodes through the REAL renderComponent and asserts ZERO delta.
// Any non-empty diff here = the additive contract was broken → STOP.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderComponent } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "leadgen-p2a-backcompat", "unstyled-choice-render.json");
const DESIGN = defaultFunnelDesign;

// The SAME representative unstyled nodes the fixture was frozen from (the 5
// per-choice families + OtherGroupSelector) — exercising choices, badges,
// subtitles, images, Other-group split, columns.
const NODES: Record<string, LeadgenComponentNode> = {
  ButtonAnswerGroup: {
    type: "ButtonAnswerGroup",
    question_id: "q_bag",
    internal_field: "bag",
    choices: [
      { label: "Allow", value: "allow", analytics_id: "a_allow" },
      { label: "Disallow", value: "disallow", analytics_id: "a_disallow" },
      { label: "Maybe", value: "maybe", analytics_id: "a_maybe" },
    ],
  },
  TwoButtonYesNo: {
    type: "TwoButtonYesNo",
    question_id: "q_yn",
    internal_field: "yn",
    props: { yesLabel: "Yes", noLabel: "No" },
  },
  IconCardAnswerGrid: {
    type: "IconCardAnswerGrid",
    question_id: "q_icon",
    internal_field: "icon",
    choices: [
      { label: "LLC", value: "llc", analytics_id: "a_llc", icon: "🏢", subtitle: "Company", badge: "Popular" },
      { label: "Corp", value: "corp", analytics_id: "a_corp", icon: "🏦" },
    ],
    props: { columns: 2 },
  },
  ImageCardAnswerGrid: {
    type: "ImageCardAnswerGrid",
    question_id: "q_img",
    internal_field: "img",
    choices: [
      { label: "A", value: "a", analytics_id: "a_a", imageMediaId: "media-a", image_alt: "Brand A" },
      { label: "B", value: "b", analytics_id: "a_b", imageMediaId: "media-b", image_alt: "Brand B" },
    ],
    props: { columns: 2, image_fit: "contain" },
  },
  MultiChoiceCardGroup: {
    type: "MultiChoiceCardGroup",
    question_id: "q_multi",
    internal_field: "multi",
    choices: [
      { label: "One", value: "one", analytics_id: "a_one", subtitle: "first" },
      { label: "Two", value: "two", analytics_id: "a_two" },
      { label: "Three", value: "three", analytics_id: "a_three" },
    ],
    props: { min: 1, max: 2, columns: 3 },
  },
  OtherGroupSelector: {
    type: "OtherGroupSelector",
    question_id: "q_other",
    internal_field: "other",
    choices: [
      { label: "Red", value: "red", analytics_id: "a_red" },
      { label: "Blue", value: "blue", analytics_id: "a_blue" },
      { label: "Green", value: "green", analytics_id: "a_green" },
    ],
    choiceDisplay: { mainValues: ["red", "blue"], otherGroupEnabled: true, otherGroupLabel: "Other", searchableOther: true },
  },
};

describe("P2a back-compat byte gate — unstyled choice content is byte-identical to pre-P2a", () => {
  const frozen = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, string>;

  it("the fixture covers every per-choice family this slice touches", () => {
    expect(Object.keys(frozen).sort()).toEqual(Object.keys(NODES).sort());
  });

  for (const [name, node] of Object.entries(NODES)) {
    it(`${name}: re-rendered HTML === frozen pre-P2a HTML (zero delta)`, () => {
      expect(renderComponent(node, DESIGN)).toBe(frozen[name]);
    });
  }
});
