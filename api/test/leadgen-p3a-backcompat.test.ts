// P3a structured-placement back-compat BYTE gate (the phase invariant): content
// WITHOUT any node `layout` field MUST render BYTE-IDENTICAL to the pre-P3a
// output. The fixture (fixtures/leadgen-p3a-backcompat/no-layout-render.json)
// was frozen from HEAD BEFORE the presets/styles placement change landed; this
// test re-renders the SAME no-layout content through the REAL renderComponent /
// renderSectionComponents and asserts ZERO delta. Any non-empty diff here = the
// additive contract was broken (a wrapper leaked onto a no-layout node, or the
// widthCenteringEntries align-generalization changed the un-authored centering) → STOP.
//
// COVERAGE (deliberate): besides plain flat + container trees, the SINGLE_NODES
// set includes one node PER widthCenteringEntries call site that the P3a align
// generalization threads `layout?.align` into — text-input (fieldStyleAttr),
// currency (fieldSizeStyle), button group (answerGroupRootStyle), icon-card grid
// and multi-choice grid (the two card-grid closures) — each carrying a non-full
// design_overrides.size.width so its default (un-authored-align) centering is on
// the frozen bytes. A node with size.width but NO layout must center exactly as
// it did pre-P3a.
//
// UPDATE (only when a no-layout-output change is INTENDED and reviewed):
//   LEADGEN_P3A_PIN_UPDATE=1 npx vitest run test/leadgen-p3a-backcompat.test.ts
// rewrites the fixture then FAILS on purpose (an update run never passes) —
// rerun without the flag to verify.
import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { renderComponent, renderSectionComponents } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "fixtures", "leadgen-p3a-backcompat", "no-layout-render.json");
const UPDATE = process.env["LEADGEN_P3A_PIN_UPDATE"] === "1";
const D = defaultFunnelDesign;

// A representative FLAT no-layout section (the renderNodes fast path + the
// depth-1 question-card wrap).
const FLAT_NODES: LeadgenComponentNode[] = [
  { type: "QuestionHeadline", question_id: "h1", props: { text: "How can we help?" } },
  { type: "Subheadline", question_id: "s1", props: { text: "Pick the closest option" } },
  {
    type: "ButtonAnswerGroup",
    question_id: "q_bag",
    internal_field: "bag",
    answer_type: "enum",
    choices: [
      { label: "Home", value: "home", analytics_id: "a_home" },
      { label: "Auto", value: "auto", analytics_id: "a_auto" },
    ],
  },
  { type: "FreeTextQuestion", question_id: "q_note", internal_field: "note", props: { placeholder: "Notes" } },
  { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } },
];

// A no-layout CONTAINER tree (renderNodes at depth > 1 inside Stack / CardPanel).
const CONTAINER_NODES: LeadgenComponentNode[] = [
  {
    type: "CardPanel",
    question_id: "cp1",
    container_id: "cp1",
    props: { width: "full" },
    children: [
      { type: "QuestionHeadline", question_id: "h2", props: { text: "Inside a card" } },
      {
        type: "Stack",
        question_id: "st1",
        container_id: "st1",
        props: { direction: "vertical", gap: "m" },
        children: [
          { type: "TextBlock", question_id: "tb1", props: { role: "body", text: "Body copy" } },
          { type: "FreeTextQuestion", question_id: "q_x", internal_field: "x", props: { placeholder: "X" } },
        ],
      },
    ],
  },
];

// One node per widthCenteringEntries call site (each with a non-full size.width
// so its default centering is frozen), plus a couple of plain nodes.
const SINGLE_NODES: Record<string, LeadgenComponentNode> = {
  freetext_sized: {
    type: "FreeTextQuestion",
    question_id: "ft_m",
    internal_field: "ft_m",
    props: { placeholder: "Sized" },
    design_overrides: { size: { width: "m" } },
  },
  currency_sized: {
    type: "CurrencyInputQuestion",
    question_id: "cur_m",
    internal_field: "cur_m",
    design_overrides: { size: { width: "m" } },
  },
  buttongroup_sized: {
    type: "ButtonAnswerGroup",
    question_id: "bag_m",
    internal_field: "bag_m",
    choices: [
      { label: "Yes", value: "y", analytics_id: "a_y" },
      { label: "No", value: "n", analytics_id: "a_n" },
    ],
    design_overrides: { size: { width: "m" } },
  },
  iconcard_sized: {
    type: "IconCardAnswerGrid",
    question_id: "ic_m",
    internal_field: "ic_m",
    choices: [
      { label: "A", value: "a", analytics_id: "a_a", icon: "🏢" },
      { label: "B", value: "b", analytics_id: "a_b", icon: "🏦" },
    ],
    props: { columns: 2 },
    design_overrides: { size: { width: "m" } },
  },
  multichoice_sized: {
    type: "MultiChoiceCardGroup",
    question_id: "mc_m",
    internal_field: "mc_m",
    choices: [
      { label: "One", value: "one", analytics_id: "a_1" },
      { label: "Two", value: "two", analytics_id: "a_2" },
    ],
    props: { min: 1, max: 2, columns: 2 },
    design_overrides: { size: { width: "m" } },
  },
  plain_freetext: { type: "FreeTextQuestion", question_id: "ft_p", internal_field: "ft_p", props: { placeholder: "Plain" } },
  plain_textblock: { type: "TextBlock", question_id: "tb_p", props: { role: "body", text: "Plain body" } },
};

function build(): Record<string, string> {
  const out: Record<string, string> = {};
  out["__flat_section__"] = renderSectionComponents(FLAT_NODES, D);
  out["__container_tree__"] = renderSectionComponents(CONTAINER_NODES, D);
  for (const [k, n] of Object.entries(SINGLE_NODES)) out[k] = renderComponent(n, D);
  return out;
}

describe("P3a back-compat byte gate — no-layout content is byte-identical to pre-P3a", () => {
  const actual = build();

  it("re-rendered no-layout content === frozen pre-P3a bytes (zero delta)", () => {
    if (UPDATE) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, JSON.stringify(actual, null, 2) + "\n");
      throw new Error(
        `LEADGEN_P3A_PIN_UPDATE=1: rewrote ${FIXTURE} (${Object.keys(actual).length} entries). ` +
          "An update run never passes — rerun WITHOUT the flag to verify.",
      );
    }
    const frozen = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, string>;
    expect(Object.keys(actual).sort(), "fixture key set must match").toEqual(Object.keys(frozen).sort());
    for (const k of Object.keys(frozen)) {
      expect(actual[k], `${k}: no-layout render drifted from the frozen pre-P3a pin`).toBe(frozen[k]);
    }
  });

  it("meta: the fixture is a real, non-trivial capture", () => {
    const frozen = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, string>;
    expect(frozen["__flat_section__"]).toContain('class="lg-question-card"');
    expect(frozen["__flat_section__"]).not.toContain("lg-el-row");
    expect(frozen["__flat_section__"]).not.toContain('class="lg-el"');
    // sized nodes carry the pre-P3a auto-centering on the frozen bytes.
    expect(frozen["freetext_sized"]).toContain("margin-left:auto");
    expect(frozen["freetext_sized"]).toContain("margin-right:auto");
  });
});
