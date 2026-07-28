// LeadGen R2 P1 §① — the QUESTION GRID container: schema + registry + public
// projection (slice S1a).
//
// The owner's model, verbatim (SOURCE-OF-TRUTH A.1 #1/#2 + the cosmic §5
// correction):
//   · "This component is providing answers to multiple fields … Each one of
//     this questions is answering another field … Each question in the
//     component is independent field, with independent answers, inefendent
//     defaults!! … if the user wants to deviate from the theme - independent
//     style and independent rules!"
//   · "you left a lot of dead parts- If each question is independent so why did
//     you kept the main 'Helper text'? if each question is independent why you
//     kept main 'Answer format'? what is it 'sub questions'???? there is no
//     'Main question'!!!"
//   · "the question grid is a COMPONENT. Inside the component there are
//     different QUESTIONS, each question is answering another field, and can
//     have dependency between of them. Some questions could be buttons, and
//     some can be dropdown or else."
//   · "the user should be able to manage inner dippendancies between of
//     questions inside the component."
//   · Owner clarification 2026-07-28 — dependencies are TYPE-AGNOSTIC on BOTH
//     sides: the trigger may be ANY question with ANY answer values and the
//     dependent may be ANY type; conditions key on the trigger question's FIELD
//     + answer value(s) with the full operator set, never on the question type.
//
// The authored shape under test is the design pin "Screenshot 2026-07-27 at
// 18.30.25.png": stacked labeled questions, mixed types, a dependent dropdown
// that pops in on Yes, and ONE Continue for the whole group.
//
// This suite proves CODE HEALTH of the contract (schema + projection), never
// the rendered UI — the driven-product proof belongs to the phase's product
// gate (E10).

import { describe, expect, it } from "vitest";
import {
  collectKnownAnswerFields,
  flattenComponents,
  isChildrenBearingType,
  isLayoutContainerType,
  isQuestionGridType,
  LEADGEN_QUESTION_GRID_TYPE,
  validateSectionContent,
  type LeadgenComponentNode,
} from "../src/public/leadgen/components/content-schema";
import {
  COMPONENT_CAPABILITIES,
  COMPONENT_CATALOG,
} from "../src/public/leadgen/components/registry";
import {
  buildPublicConfig,
  projectSectionComponents,
  toPublicComponent,
} from "../src/public/leadgen/config-dto";
import type { PublicSectionComponent } from "../src/public/leadgen/config-dto";
import type {
  FunnelAssignment,
  ResolvedActivatedFunnel,
  ResolvedFunnelSection,
} from "../src/public/leadgen/resolver";
import { getFunnelDesign } from "../src/public/leadgen/designs/registry";
import { mintPublicId } from "../src/leadgen/ids";
import type {
  LeadgenFunnelRow,
  LeadgenFunnelVariantRow,
  LeadgenQuoteRow,
  LeadgenSectionRow,
  LeadgenSiteQuoteRow,
} from "../src/admin/leadgen/db-types";

// ---------------------------------------------------------------------------
// The design-pin content (18.30.25): FIVE independent questions in ONE group.
// ---------------------------------------------------------------------------

const Q1_YESNO = {
  type: "TwoButtonYesNo",
  question_id: "qg_q1",
  internal_field: "currently_insured",
  answer_type: "boolean",
  required: true,
  props: { label: "Are you currently insured?", yesLabel: "Yes", noLabel: "No" },
};

// Q2 — a DROPDOWN that depends on Q1 (a Yes/No trigger), with its OWN default.
const Q2_DROPDOWN_DEPENDENT = {
  type: "DropdownQuestion",
  question_id: "qg_q2",
  internal_field: "current_insurer",
  answer_type: "enum",
  required: true,
  conditional: { when: "currently_insured", op: "eq", value: true },
  choices: [
    { label: "Geico", value: "geico", analytics_id: "insurer_geico" },
    { label: "Progressive", value: "progressive", analytics_id: "insurer_progressive" },
    { label: "State Farm", value: "state_farm", analytics_id: "insurer_state_farm" },
  ],
  props: { label: "Who is your insurer?", placeholder: "Choose one", defaultValue: "geico" },
};

const Q3_DROPDOWN = {
  type: "DropdownQuestion",
  question_id: "qg_q3",
  internal_field: "credit_score",
  answer_type: "enum",
  required: true,
  choices: [
    { label: "Excellent", value: "Excellent", analytics_id: "credit_excellent" },
    { label: "Good", value: "Good", analytics_id: "credit_good" },
    { label: "Fair", value: "Fair", analytics_id: "credit_fair" },
    { label: "Poor", value: "Poor", analytics_id: "credit_poor" },
  ],
  props: { label: "What is your credit score?" },
};

const Q4_YESNO = {
  type: "TwoButtonYesNo",
  question_id: "qg_q4",
  internal_field: "accidents_3y",
  answer_type: "boolean",
  props: { label: "Any accidents in the last 3 years?" },
};

// Q5 — a BUTTONS question depending on a NON-BOOLEAN trigger (the dropdown's
// enum values) through the `one of` operator: the type-agnostic dependency.
const Q5_BUTTONS_NONBOOLEAN_DEP = {
  type: "ButtonAnswerGroup",
  question_id: "qg_q5",
  internal_field: "bankruptcy_status",
  answer_type: "enum",
  required: true,
  conditional: { when: "credit_score", op: "in", values: ["Poor", "Fair"] },
  choices: [
    { label: "Never", value: "never", analytics_id: "bk_never" },
    { label: "Discharged", value: "discharged", analytics_id: "bk_discharged" },
    { label: "Active", value: "active", analytics_id: "bk_active" },
  ],
  props: { label: "Have you filed for bankruptcy?" },
};

function grid(children: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: LEADGEN_QUESTION_GRID_TYPE,
    question_id: "qg_group",
    props: { gap: "m" },
    children,
    ...extra,
  };
}

const PIN_CHILDREN = [
  Q1_YESNO,
  Q2_DROPDOWN_DEPENDENT,
  Q3_DROPDOWN,
  Q4_YESNO,
  Q5_BUTTONS_NONBOOLEAN_DEP,
];

// The whole Section: the group + the ONE Continue (outside the group).
function pinSection(children: unknown[] = PIN_CHILDREN): Record<string, unknown> {
  return {
    components: [
      grid(children),
      { type: "ContinueButton", question_id: "q_continue", props: { label: "Continue" } },
    ],
  };
}

const codesOf = (r: ReturnType<typeof validateSectionContent>): string[] =>
  r.errors.map((e) => e.code);

// ---------------------------------------------------------------------------
// 1. The catalog/registry contract
// ---------------------------------------------------------------------------

describe("registry — the question-grid container is a placeable component type", () => {
  it("is in the catalog as a Section-unit question GROUP that PRODUCES nothing itself", () => {
    const entry = COMPONENT_CATALOG[LEADGEN_QUESTION_GRID_TYPE];
    expect(entry).toBeDefined();
    // NOT category "question": every category:"question" type is an answer
    // producer with a recording hook (leadgen-r1-answers Test A's lockstep).
    // NOT "layout" either: a layout container is never projected into
    // /lg/config, and this one is.
    expect(entry.category).toBe("question_group");
    expect(entry.scope).toBe("unit");
    // The container answers no field — its CHILDREN are the answer producers.
    expect(entry.produces).toBeNull();
  });

  it("carries the ALL-BLANK capability row — every question control belongs to the child (no Main question, no shared Helper text / Answer format / default)", () => {
    const cap = COMPONENT_CAPABILITIES[LEADGEN_QUESTION_GRID_TYPE];
    expect(cap.label_helper).toBe(false);
    expect(cap.required).toBe(false);
    expect(cap.choices_editor).toBe(false);
    expect(cap.default_kind).toBeNull();
    expect(cap.other_editor).toBe(false);
    expect(cap.placeholder).toBe(false);
  });

  it("the child question types keep their OWN capability rows untouched (reuse, not a bespoke grid schema — D7)", () => {
    expect(COMPONENT_CAPABILITIES["TwoButtonYesNo"].default_kind).toBe("yesno");
    expect(COMPONENT_CAPABILITIES["DropdownQuestion"].default_kind).toBe("dropdown");
    expect(COMPONENT_CAPABILITIES["ButtonAnswerGroup"].choices_editor).toBe(true);
  });

  it("is NOT a §8.5 LAYOUT container (GridContainer stays the layout primitive) but IS children-bearing", () => {
    expect(isQuestionGridType(LEADGEN_QUESTION_GRID_TYPE)).toBe(true);
    expect(isLayoutContainerType(LEADGEN_QUESTION_GRID_TYPE)).toBe(false);
    expect(isChildrenBearingType(LEADGEN_QUESTION_GRID_TYPE)).toBe(true);
    expect(isQuestionGridType("GridContainer")).toBe(false);
    expect(isLayoutContainerType("GridContainer")).toBe(true);
    expect(COMPONENT_CATALOG["GridContainer"].category).toBe("layout");
  });
});

// ---------------------------------------------------------------------------
// 2. The 18.30.25 shape validates — three+ independent questions, mixed types
// ---------------------------------------------------------------------------

describe("schema — the design-pin group (5 independent questions, mixed types) validates", () => {
  it("accepts the whole authored group with zero errors and zero warnings", () => {
    const result = validateSectionContent(pinSection());
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("every child keeps its OWN field, label, default, required and rules (independent questions)", () => {
    const children = PIN_CHILDREN;
    expect(children.map((c) => c.internal_field)).toEqual([
      "currently_insured",
      "current_insurer",
      "credit_score",
      "accidents_3y",
      "bankruptcy_status",
    ]);
    // independent labels (no Main question), independent defaults, independent
    // required rules, independent dependencies — all authored per child.
    expect(children.every((c) => typeof c.props.label === "string")).toBe(true);
    expect(Q2_DROPDOWN_DEPENDENT.props.defaultValue).toBe("geico");
    expect(Q1_YESNO.required).toBe(true);
    expect((Q4_YESNO as Record<string, unknown>)["required"]).toBeUndefined();
    const result = validateSectionContent(pinSection());
    expect(result.ok).toBe(true);
  });

  it("a NON-BOOLEAN trigger drives a dependent question (credit_score one-of [Poor, Fair] -> a Buttons question)", () => {
    const result = validateSectionContent(pinSection([Q3_DROPDOWN, Q5_BUTTONS_NONBOOLEAN_DEP]));
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("the dependency is TYPE-AGNOSTIC on BOTH sides — a Buttons trigger with non-boolean choices driving a Dropdown validates too", () => {
    const trigger = {
      type: "ButtonAnswerGroup",
      question_id: "qg_t",
      internal_field: "coverage_level",
      choices: [
        { label: "Basic", value: "basic", analytics_id: "cov_basic" },
        { label: "Full", value: "full", analytics_id: "cov_full" },
      ],
      props: { label: "Coverage level" },
    };
    const dependent = {
      type: "DropdownQuestion",
      question_id: "qg_d",
      internal_field: "deductible",
      conditional: { when: "coverage_level", op: "eq", value: "full" },
      choices: [{ label: "$500", value: "500", analytics_id: "ded_500" }],
      props: { label: "Deductible" },
    };
    const result = validateSectionContent(pinSection([trigger, dependent]));
    expect(result.errors).toEqual([]);
  });

  it("the OWNER'S FULL OPERATOR SET is accepted on an inner dependency (is / is not / one of / not one of / greater / less / between)", () => {
    // The owner's words -> the canonical stored op. Every one of the seven
    // already exists in the LeadGen condition vocabulary (nothing added).
    const ownerOps: Array<[string, Record<string, unknown>]> = [
      ["is", { when: "credit_score", op: "eq", value: "Poor" }],
      ["is not", { when: "credit_score", op: "neq", value: "Poor" }],
      ["one of", { when: "credit_score", op: "in", values: ["Poor", "Fair"] }],
      ["not one of", { when: "credit_score", op: "not_in", values: ["Poor"] }],
      ["greater", { when: "credit_score", op: "gt", value: 600 }],
      ["less", { when: "credit_score", op: "lt", value: 600 }],
      ["between", { when: "credit_score", op: "range", from: 500, to: 700 }],
    ];
    for (const [ownerWord, conditional] of ownerOps) {
      const dependent = { ...Q5_BUTTONS_NONBOOLEAN_DEP, conditional };
      const result = validateSectionContent(pinSection([Q3_DROPDOWN, dependent]));
      expect(codesOf(result), `owner operator "${ownerWord}"`).toEqual([]);
    }
  });

  it("a composed rule group ({match, conditions[]}) inside the grid is sibling-checked condition by condition", () => {
    const dependent = {
      ...Q5_BUTTONS_NONBOOLEAN_DEP,
      conditional: {
        match: "all",
        conditions: [
          { when: "credit_score", op: "in", values: ["Poor", "Fair"] },
          { when: "currently_insured", op: "eq", value: false },
        ],
      },
    };
    const ok = validateSectionContent(pinSection([Q1_YESNO, Q3_DROPDOWN, dependent]));
    expect(ok.errors).toEqual([]);
    // …and an inner condition pointing OUT of the group is caught.
    const strayed = validateSectionContent(pinSection([Q3_DROPDOWN, dependent]));
    expect(codesOf(strayed)).toContain("question_grid_conditional_scope");
  });

  it("an empty group is not a save error (the studio inserts the group, then the author adds questions)", () => {
    expect(validateSectionContent(pinSection([])).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Rejections — the owner's rules, enforced
// ---------------------------------------------------------------------------

describe("schema — a question group REJECTS the dead parts (no Main question / shared Helper text / Answer format / sub questions)", () => {
  const deadNodeFields: Array<[string, unknown]> = [
    ["internal_field", "group_answer"],
    ["choices", [{ label: "A", value: "a", analytics_id: "a" }]],
    ["answer_type", "enum"],
    ["valid_values", ["a", "b"]],
    ["required", true],
  ];
  it.each(deadNodeFields)("rejects a shared node-level '%s' on the container", (key, value) => {
    const result = validateSectionContent(pinSection2({ [key as string]: value }));
    expect(codesOf(result)).toContain("question_grid_shared_field_forbidden");
    expect(result.errors.some((e) => e.path === `components[0].${key}`)).toBe(true);
    expect(result.ok).toBe(false);
  });

  const deadProps = ["label", "text", "question", "helper", "helper_text", "format", "answer_format", "rows", "sub_questions", "questions", "defaultValue", "placeholder", "other"];
  it.each(deadProps)("rejects a shared props.%s on the container", (key) => {
    const node = grid(PIN_CHILDREN, { props: { gap: "m", [key]: "anything" } });
    const result = validateSectionContent({ components: [node] });
    expect(codesOf(result)).toContain("question_grid_shared_field_forbidden");
    expect(result.errors.some((e) => e.path === `components[0].props.${key}`)).toBe(true);
  });

  // helper: a grid carrying an extra top-level key
  function pinSection2(extra: Record<string, unknown>): Record<string, unknown> {
    return { components: [grid(PIN_CHILDREN, extra)] };
  }
});

describe("schema — inner dependencies must point at a SIBLING question in the same group", () => {
  it("rejects a self-referencing rule (a question depending on its own answer)", () => {
    const selfRef = {
      ...Q3_DROPDOWN,
      conditional: { when: "credit_score", op: "eq", value: "Poor" },
    };
    const result = validateSectionContent(pinSection([Q1_YESNO, selfRef]));
    expect(codesOf(result)).toContain("question_grid_conditional_scope");
    expect(result.errors[0]!.message).toContain("cannot depend on its own answer");
    expect(result.ok).toBe(false);
  });

  it("rejects a rule pointing at a field that is NOT in the group (even when that field exists elsewhere in the Section)", () => {
    const outsideQuestion = {
      type: "TwoButtonYesNo",
      question_id: "q_outside",
      internal_field: "homeowner",
      props: { label: "Do you own your home?" },
    };
    const dependent = {
      ...Q5_BUTTONS_NONBOOLEAN_DEP,
      conditional: { when: "homeowner", op: "eq", value: true },
    };
    const result = validateSectionContent({
      components: [outsideQuestion, grid([Q3_DROPDOWN, dependent])],
    });
    // The referenced field EXISTS in the Section (so the generic unknown-field
    // gate stays silent) — the group-scope gate is what catches it.
    expect(codesOf(result)).toContain("question_grid_conditional_scope");
    expect(codesOf(result)).not.toContain("conditional_unknown_field");
    expect(result.ok).toBe(false);
  });

  it("rejects a rule pointing at a field that exists nowhere (both the Section-universe gate and the group-scope gate fire)", () => {
    const dependent = {
      ...Q5_BUTTONS_NONBOOLEAN_DEP,
      conditional: { when: "no_such_field", op: "eq", value: true },
    };
    const result = validateSectionContent(pinSection([Q3_DROPDOWN, dependent]));
    expect(codesOf(result)).toContain("conditional_unknown_field");
    expect(codesOf(result)).toContain("question_grid_conditional_scope");
  });

  it("rejects a 2-question dependency CYCLE (neither question could ever show)", () => {
    const a = {
      ...Q3_DROPDOWN,
      conditional: { when: "bankruptcy_status", op: "eq", value: "never" },
    };
    const b = {
      ...Q5_BUTTONS_NONBOOLEAN_DEP,
      conditional: { when: "credit_score", op: "in", values: ["Poor", "Fair"] },
    };
    const result = validateSectionContent(pinSection([a, b]));
    expect(codesOf(result)).toContain("question_grid_conditional_cycle");
    const cycle = result.errors.find((e) => e.code === "question_grid_conditional_cycle")!;
    expect(cycle.message).toContain("qg_q3");
    expect(cycle.message).toContain("qg_q5");
    expect(result.ok).toBe(false);
  });

  it("rejects a 3-question dependency cycle", () => {
    const a = { ...Q1_YESNO, conditional: { when: "credit_score", op: "eq", value: "Poor" } };
    const b = { ...Q3_DROPDOWN, conditional: { when: "bankruptcy_status", op: "eq", value: "never" } };
    const c = { ...Q5_BUTTONS_NONBOOLEAN_DEP, conditional: { when: "currently_insured", op: "eq", value: true } };
    const result = validateSectionContent(pinSection([a, b, c]));
    expect(codesOf(result)).toContain("question_grid_conditional_cycle");
  });

  it("a CHAIN (Q1 -> Q2 -> Q3) is NOT a cycle and validates", () => {
    const b = { ...Q3_DROPDOWN, conditional: { when: "currently_insured", op: "eq", value: true } };
    const c = { ...Q5_BUTTONS_NONBOOLEAN_DEP, conditional: { when: "credit_score", op: "eq", value: "Poor" } };
    const result = validateSectionContent(pinSection([Q1_YESNO, b, c]));
    expect(result.errors).toEqual([]);
  });
});

describe("schema — only QUESTIONS live inside the group", () => {
  it.each([
    ["Stack", { type: "Stack", question_id: "x_stack", children: [] }],
    ["ContinueButton", { type: "ContinueButton", question_id: "x_cont", props: { label: "Go" } }],
    ["TextBlock", { type: "TextBlock", question_id: "x_text", props: { role: "body", text: "hi" } }],
  ])("rejects a %s child (not a question component)", (_name, child) => {
    const result = validateSectionContent({ components: [grid([Q1_YESNO, child])] });
    expect(codesOf(result)).toContain("question_grid_child_invalid");
    expect(result.ok).toBe(false);
  });

  it("rejects a question group nested inside a question group", () => {
    const result = validateSectionContent({
      components: [grid([Q1_YESNO, grid([Q3_DROPDOWN], { question_id: "qg_inner" })])],
    });
    expect(codesOf(result)).toContain("question_grid_child_invalid");
  });

  it("rejects a non-array children value", () => {
    const result = validateSectionContent({
      components: [{ type: LEADGEN_QUESTION_GRID_TYPE, question_id: "qg", children: "nope" }],
    });
    expect(codesOf(result)).toContain("question_grid_child_invalid");
  });

  it("validates each child with the FULL existing per-node rules (D7 reuse): a child missing its choices is the SAME typed error as at top level", () => {
    const broken = { type: "DropdownQuestion", question_id: "qg_bad", internal_field: "insurer2" };
    const result = validateSectionContent({ components: [grid([broken])] });
    expect(codesOf(result)).toContain("invalid_choice");
    expect(result.errors.some((e) => e.path === "components[0].children[0].choices")).toBe(true);
  });

  it("a duplicate internal_field between a group child and a top-level question is still caught (one field universe)", () => {
    const dupe = { ...Q1_YESNO, question_id: "q_dupe" };
    const result = validateSectionContent({ components: [grid([Q1_YESNO]), dupe] });
    expect(codesOf(result)).toContain("duplicate_internal_field");
  });

  it("accepts a per-question STYLE DEVIATION on a child (D4: the existing per-node override axes, free colors included)", () => {
    const styled = {
      ...Q5_BUTTONS_NONBOOLEAN_DEP,
      conditional: undefined,
      design_overrides: { buttonBackground: "#0d47a1", columns: 2, corners: "pill" },
      choices: [
        {
          label: "Never",
          value: "never",
          analytics_id: "bk_never",
          style: { color_hex: "#112233", emphasis: "strong" },
        },
      ],
    };
    const result = validateSectionContent({ components: [grid([styled])] });
    expect(result.errors).toEqual([]);
  });

  it("the container's OWN style bag is gated by the same curated-key rule (no arbitrary CSS on a new type)", () => {
    const bad = grid(PIN_CHILDREN, { design_overrides: { notAKey: "x" } });
    expect(codesOf(validateSectionContent({ components: [bad] }))).toContain("non_curated_override_key");
    const css = grid(PIN_CHILDREN, { design_overrides: { buttonBackground: "url(evil)" } });
    expect(codesOf(validateSectionContent({ components: [css] }))).toContain("arbitrary_css_override");
    const gap = grid(PIN_CHILDREN, { props: { gap: "enormous" } });
    expect(codesOf(validateSectionContent({ components: [gap] }))).toContain("container_prop_invalid");
  });
});

// ---------------------------------------------------------------------------
// 4. The shared walks: the children ARE independent questions everywhere
// ---------------------------------------------------------------------------

describe("shared walks — the group's children are independent questions to every consumer", () => {
  it("flattenComponents yields the 5 child questions in order and NOT the container", () => {
    const flat = flattenComponents(pinSection().components as LeadgenComponentNode[]);
    expect(flat.map((n) => n.question_id)).toEqual([
      "qg_q1",
      "qg_q2",
      "qg_q3",
      "qg_q4",
      "qg_q5",
      "q_continue",
    ]);
    expect(flat.some((n) => isQuestionGridType(n.type))).toBe(false);
  });

  it("collectKnownAnswerFields registers every child field (the rules pickers / activation preflight universe)", () => {
    const fields = collectKnownAnswerFields(pinSection().components as unknown[]);
    for (const f of [
      "currently_insured",
      "current_insurer",
      "credit_score",
      "accidents_3y",
      "bankruptcy_status",
    ]) {
      expect(fields.has(f), `known field ${f}`).toBe(true);
    }
  });

  it("a group nested inside a §8.5 layout container still flattens to its questions", () => {
    const tree = [
      { type: "Stack", question_id: "s1", props: { gap: "m" }, children: [grid([Q1_YESNO, Q3_DROPDOWN])] },
    ];
    expect(flattenComponents(tree as unknown as LeadgenComponentNode[]).map((n) => n.question_id)).toEqual([
      "qg_q1",
      "qg_q3",
    ]);
    expect(validateSectionContent({ components: tree }).errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. The public projection: ONE component, N child questions
// ---------------------------------------------------------------------------

function sectionRow(
  partial: Partial<LeadgenSectionRow> & { public_id: string; content_json: string },
): LeadgenSectionRow {
  return {
    id: 1,
    section_name: "Section",
    activity: "auto",
    vertical: "insurance",
    headline_text: "Tell us about your coverage",
    subheadline_text: null,
    image_json: null,
    content_html: null,
    continue_mode: "button",
    design_overrides_json: null,
    address_validation_enabled: 0,
    section_mapping_version: 1,
    content_version: 1,
    status: "active",
    created_by: null,
    created_at: 0,
    updated_at: 0,
    ...partial,
  };
}

function resolvedWith(contentJson: string): ResolvedActivatedFunnel {
  const sections: ResolvedFunnelSection[] = [
    { position: 0, section: sectionRow({ id: 1, public_id: mintPublicId("section"), content_json: contentJson }) },
  ];
  const quote: LeadgenQuoteRow = {
    id: 5,
    public_id: mintPublicId("quote"),
    quote_name: "Auto Insurance",
    activity: "auto",
    verticals_json: "[]",
    status: "active",
    created_by: null,
    created_at: 0,
    updated_at: 0,
    default_funnel_id: null,
  };
  const funnel: LeadgenFunnelRow = {
    id: 7,
    public_id: mintPublicId("funnel"),
    quote_id: 5,
    funnel_name: "Auto Funnel A",
    active_ab_test_id: null,
    status: "active",
    created_at: 0,
    updated_at: 0,
    frame_config_json: null,
    theme_json: null,
    display_order: null,
    frame_template_id: null,
  };
  const variant: LeadgenFunnelVariantRow = {
    id: 9,
    public_id: mintPublicId("funnel_variant"),
    funnel_id: 7,
    ab_test_id: null,
    variant_label: "A",
    traffic_allocation_bp: 10000,
    funnel_design_id: "default",
    auction_id: null,
    lander_enabled: 0,
    lander_headline: null,
    lander_subheadline: null,
    lander_body_json: null,
    lander_hero_media_id: null,
    lander_hero_media_url: null,
    lander_cta_json: null,
    content_version: 3,
    status: "active",
    created_at: 0,
    frame_overrides_json: null,
    frame_template_id: null,
  };
  const site_quote: LeadgenSiteQuoteRow = {
    id: 2,
    site_id: "site_1",
    quote_id: 5,
    enabled: 1,
    slug: null,
    settings_overrides_json: null,
    created_at: 0,
    updated_at: 0,
  };
  const assignment: FunnelAssignment = {
    funnel_ab_test_id: "",
    funnel_ab_test_revision: 0,
    variant_label: "A",
    traffic_allocation_bp: 10000,
    assignment_bucket: null,
    assignment_reason: "single_control",
  };
  return {
    site_quote,
    quote,
    funnel,
    variant,
    sections,
    ga4_measurement_id: "G-TEST123",
    assignment,
  };
}

describe("public projection — authored JSON -> validated -> /lg/config, every per-question property intact", () => {
  const authored = pinSection();
  const contentJson = JSON.stringify(authored);

  it("the authored content validates before it is projected (real producer input, not a hand-built config)", () => {
    expect(validateSectionContent(JSON.parse(contentJson)).errors).toEqual([]);
  });

  it("projects the group as ONE component carrying its 5 child questions (grouping survives)", () => {
    const config = buildPublicConfig(resolvedWith(contentJson), getFunnelDesign("default"));
    const components = config.sections[0]!.components;
    expect(components.map((c) => c.type)).toEqual([LEADGEN_QUESTION_GRID_TYPE, "ContinueButton"]);
    const group = components[0]!;
    expect(group.children).toBeDefined();
    expect(group.children!.map((c) => c.question_id)).toEqual([
      "qg_q1",
      "qg_q2",
      "qg_q3",
      "qg_q4",
      "qg_q5",
    ]);
    // the container itself never carries an answer field
    expect(group.internal_field).toBeUndefined();
    expect(group.required).toBeUndefined();
    expect(group.choices).toBeUndefined();
  });

  it("each projected child carries its OWN field / answer_type / required / choices / default / conditional / client_validation", () => {
    const config = buildPublicConfig(resolvedWith(contentJson), getFunnelDesign("default"));
    const round = JSON.parse(JSON.stringify(config)) as typeof config;
    const kids = round.sections[0]!.components[0]!.children as PublicSectionComponent[];
    const byField = new Map(kids.map((k) => [k.internal_field, k]));

    const q1 = byField.get("currently_insured")!;
    expect(q1.type).toBe("TwoButtonYesNo");
    expect(q1.answer_type).toBe("boolean");
    expect(q1.required).toBe(true);
    expect(q1.client_validation).toMatchObject({ required: true });
    expect(q1.conditional).toBeUndefined();

    const q2 = byField.get("current_insurer")!;
    expect(q2.type).toBe("DropdownQuestion");
    expect(q2.required).toBe(true);
    // its OWN default — "if we set a 'default' and the user didn't change it -
    // this is his answer" (the runtime consumes default_answer).
    expect(q2.default_answer).toEqual({ value: "geico", answer_source: "default_applied" });
    // its OWN dependency, carried to the client so a hidden child is excludable
    expect(q2.conditional).toEqual({ when: "currently_insured", op: "eq", value: true });
    expect(q2.choices!.map((c) => c.value)).toEqual(["geico", "progressive", "state_farm"]);
    expect(q2.props["label"]).toBe("Who is your insurer?");

    const q5 = byField.get("bankruptcy_status")!;
    // the NON-BOOLEAN dependency survives verbatim
    expect(q5.conditional).toEqual({ when: "credit_score", op: "in", values: ["Poor", "Fair"] });

    const q4 = byField.get("accidents_3y")!;
    expect(q4.required).toBeUndefined();
    expect(q4.default_answer).toBeUndefined();
  });

  it("projectSectionComponents equals the same projection and is a pure function of the nodes", () => {
    const direct = projectSectionComponents(authored.components as LeadgenComponentNode[]);
    const config = buildPublicConfig(resolvedWith(contentJson), getFunnelDesign("default"));
    expect(JSON.parse(JSON.stringify(direct))).toEqual(
      JSON.parse(JSON.stringify(config.sections[0]!.components)),
    );
  });

  it("a §8.5 LAYOUT container is still flattened away, and a group inside it still projects as ONE component", () => {
    const nested = {
      components: [
        {
          type: "CardPanel",
          question_id: "panel",
          props: { width: "m" },
          children: [grid([Q1_YESNO, Q3_DROPDOWN]), { type: "ContinueButton", question_id: "cta" }],
        },
      ],
    };
    expect(validateSectionContent(nested).errors).toEqual([]);
    const projected = projectSectionComponents(nested.components as unknown as LeadgenComponentNode[]);
    expect(projected.map((c) => c.type)).toEqual([LEADGEN_QUESTION_GRID_TYPE, "ContinueButton"]);
    expect(projected[0]!.children).toHaveLength(2);
  });

  it("BACK-COMPAT: content with no question group projects EXACTLY as toPublicComponent over the flattened leaves (no new key anywhere)", () => {
    const legacy = {
      components: [
        Q1_YESNO,
        { type: "Stack", question_id: "s", props: { gap: "m" }, children: [Q3_DROPDOWN] },
        { type: "ContinueButton", question_id: "cta" },
      ],
    };
    const nodes = legacy.components as unknown as LeadgenComponentNode[];
    const expected = flattenComponents(nodes).map(toPublicComponent);
    const actual = projectSectionComponents(nodes);
    expect(JSON.parse(JSON.stringify(actual))).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(JSON.stringify(actual)).not.toContain('"children"');
  });
});
