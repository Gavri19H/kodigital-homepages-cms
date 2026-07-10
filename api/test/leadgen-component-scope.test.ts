// LeadGen v2.5.1 Phase A slice A5 — component SCOPE catalog (08 §8.2 / 03
// §3.5). Proves: (1) the catalog's scope assignment matches the §8.2 normative
// table EXACTLY (the three sets partition the whole catalog — exhaustive);
// (2) a frame-scope node inside Section content yields the path-precise
// `frame_scope_component` WARNING while `ok` stays true (§3.5 save-time is
// non-blocking; escalation is a 14 §14.1 activation concern, not here);
// (3) flattenComponents is BEHAVIORALLY UNTOUCHED by the §3.4 `bind` field —
// a bound node still projects, same object, field intact.

import { describe, expect, it } from "vitest";
import { COMPONENT_CATALOG } from "../src/public/leadgen/components/registry";
import type { ComponentScope } from "../src/public/leadgen/components/registry";
import {
  flattenComponents,
  validateSectionContent,
  type LeadgenComponentNode,
} from "../src/public/leadgen/components/content-schema";

// The §8.2 normative table, verbatim.
const FRAME_TYPES = [
  "ProgressBar",
  "StepIndicator",
  "HeaderLogo",
  "BackButton",
  "DisclosureLink",
  "HeaderBar",
  "FooterBar",
  "BackgroundPanel",
] as const;

const BOTH_TYPES = [
  "CardPanel",
  "Stack",
  "GridContainer",
  "Columns",
  "Spacer",
  "TrustBar",
  "LogoStrip",
  "SecureFormBadge",
  "ReassuranceBadge",
  "LegalNote",
  "SuccessState",
  "CategoryLabel",
  "QuestionHeadline",
  "Subheadline",
  "HelperText",
] as const;

// §8.2 "unit": all question/input/choice types + ContinueButton /
// AutoAdvanceButton / ValidationError.
const UNIT_TYPES = [
  "RangeQuestion",
  "CurrencyRangeQuestion",
  "NumberRangeQuestion",
  "ButtonAnswerGroup",
  "TwoButtonYesNo",
  "IconCardAnswerGrid",
  "ImageCardAnswerGrid",
  "MultiChoiceCardGroup",
  "DropdownQuestion",
  "SearchableDropdownQuestion",
  "OtherGroupSelector",
  "FreeTextQuestion",
  "NumberInputQuestion",
  "CurrencyInputQuestion",
  "EmailInputQuestion",
  "PhoneInputQuestion",
  "NameFieldsGroup",
  "DateQuestion",
  "ZIPInputQuestion",
  "AddressAutocompleteQuestion",
  "ContinueButton",
  "AutoAdvanceButton",
  "ValidationError",
] as const;

const typesWithScope = (scope: ComponentScope): string[] =>
  Object.entries(COMPONENT_CATALOG)
    .filter(([, entry]) => entry.scope === scope)
    .map(([type]) => type)
    .sort();

describe("component scope — §8.2 exact scope assignment", () => {
  it('the "frame" set matches the §8.2 table exactly', () => {
    expect(typesWithScope("frame")).toEqual([...FRAME_TYPES].sort());
  });

  it('the "both" set matches the §8.2 table exactly', () => {
    expect(typesWithScope("both")).toEqual([...BOTH_TYPES].sort());
  });

  it('the "unit" set matches the §8.2 table exactly (all question/input/choice types + ContinueButton/AutoAdvanceButton/ValidationError)', () => {
    expect(typesWithScope("unit")).toEqual([...UNIT_TYPES].sort());
  });

  it("the three sets PARTITION the whole catalog — every entry has a scope (exhaustive)", () => {
    const union = [...FRAME_TYPES, ...BOTH_TYPES, ...UNIT_TYPES];
    expect(union.length).toBe(new Set(union).size); // disjoint
    expect([...union].sort()).toEqual(Object.keys(COMPONENT_CATALOG).sort()); // total
    for (const [type, entry] of Object.entries(COMPONENT_CATALOG)) {
      expect(["frame", "unit", "both"], `${type} carries a §8.2 scope`).toContain(entry.scope);
    }
  });
});

describe("frame_scope_component — §3.5 save-time WARNING (non-blocking)", () => {
  it("a frame-scope node yields the warning while ok stays true (errors empty)", () => {
    const result = validateSectionContent({
      components: [
        { type: "ProgressBar", question_id: "p1" },
        { type: "TwoButtonYesNo", question_id: "q1", internal_field: "insured" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    const frameWarnings = result.warnings.filter((w) => w.code === "frame_scope_component");
    expect(frameWarnings).toHaveLength(1);
    expect(frameWarnings[0]!.path).toBe("components[0]"); // path-precise
  });

  it("is path-precise for a frame-scope node nested inside a container", () => {
    const result = validateSectionContent({
      components: [
        {
          type: "Stack",
          question_id: "s1",
          children: [
            { type: "HeaderBar", question_id: "h1" },
            { type: "TwoButtonYesNo", question_id: "q1", internal_field: "insured" },
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => [w.code, w.path])).toContainEqual([
      "frame_scope_component",
      "components[0].children[0]",
    ]);
  });

  it("a frame-scope CONTAINER (BackgroundPanel) warns too; unit/both nodes never do", () => {
    const result = validateSectionContent({
      components: [
        {
          type: "BackgroundPanel",
          question_id: "bg1",
          props: { background: "wash" },
          children: [{ type: "TwoButtonYesNo", question_id: "q1", internal_field: "insured" }],
        },
        { type: "QuestionHeadline", question_id: "h1", props: { text: "How much?" } },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => [w.code, w.path])).toEqual([
      ["frame_scope_component", "components[0]"],
    ]);
  });

  it("a Section with no frame-scope nodes yields zero warnings", () => {
    const result = validateSectionContent({
      components: [
        { type: "QuestionHeadline", question_id: "h1", props: { text: "How much?" } },
        { type: "TwoButtonYesNo", question_id: "q1", internal_field: "insured" },
        { type: "ContinueButton", question_id: "c1" },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});

describe("flattenComponents — §3.4 bind is transparently ignored", () => {
  it("a bound node still projects: same object, same order, bind field intact", () => {
    const bound: LeadgenComponentNode = {
      type: "QuestionHeadline",
      question_id: "h1",
      bind: "section_headline",
    };
    const boundSub: LeadgenComponentNode = {
      type: "Subheadline",
      question_id: "sh1",
      bind: "section_subheadline",
    };
    const question: LeadgenComponentNode = {
      type: "TwoButtonYesNo",
      question_id: "q1",
      internal_field: "insured",
    };
    const tree: LeadgenComponentNode[] = [
      bound,
      { type: "Stack", question_id: "s1", children: [boundSub, question] },
    ];

    const flat = flattenComponents(tree);
    expect(flat.map((n) => n.question_id)).toEqual(["h1", "sh1", "q1"]);
    expect(flat[0]).toBe(bound); // SAME object — untouched, not cloned/stripped
    expect(flat[0]!.bind).toBe("section_headline");
    expect(flat[1]).toBe(boundSub);
    expect(flat[1]!.bind).toBe("section_subheadline");
    expect(flat[2]).toBe(question);
  });

  it("flat legacy content (zero containers, no bind) is returned unchanged — same nodes, same order", () => {
    const legacy: LeadgenComponentNode[] = [
      { type: "QuestionHeadline", question_id: "h1", props: { text: "How much?" } },
      { type: "TwoButtonYesNo", question_id: "q1", internal_field: "insured" },
    ];
    const flat = flattenComponents(legacy);
    expect(flat).toHaveLength(2);
    expect(flat[0]).toBe(legacy[0]);
    expect(flat[1]).toBe(legacy[1]);
  });
});
