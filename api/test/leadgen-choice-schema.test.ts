// LeadGen v2.5.1 Phase A slice A5 — contract test `component-schema-validation`
// (08 §8.4 choice schema extension + 03 §3.4 bind validator codes + 09 §9.4
// color-typed design_overrides VALUE vocabulary). All checks go through the
// real validateSectionContent — plain JSON in, typed codes out.

import { describe, expect, it } from "vitest";
import {
  validateSectionContent,
  type LeadgenComponentNode,
} from "../src/public/leadgen/components/content-schema";

const content = (components: unknown[]): unknown => ({ components });

const codesOf = (result: ReturnType<typeof validateSectionContent>): string[] =>
  result.errors.map((e) => e.code);

describe("component-schema-validation", () => {
  // -------------------------------------------------------------------------
  // §8.4 choice schema extension
  // -------------------------------------------------------------------------
  describe("§8.4 choice fields — validate + round-trip", () => {
    const richNode: LeadgenComponentNode = {
      type: "IconCardAnswerGrid",
      question_id: "q1",
      internal_field: "biz_type",
      choices: [
        {
          label: "LLC",
          value: "llc",
          analytics_id: "a_llc",
          icon: "🏢",
          title: "LLC",
          subtitle: "Limited liability company",
          badge: "Popular",
          disabled: false,
          aria_label: "Choose LLC",
        },
        {
          label: "Corp",
          value: "corp",
          analytics_id: "a_corp",
          icon: "🏦",
          description: "legacy description (read alias, superseded by subtitle)",
          disabled: true,
        },
      ],
      props: { columns: 2 },
    };

    it("new choice fields (title/subtitle/badge/disabled/aria_label + legacy description alias) validate clean", () => {
      const result = validateSectionContent(content([richNode]));
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    });

    it("new choice fields ROUND-TRIP through JSON and stay valid + intact", () => {
      const roundTripped = JSON.parse(JSON.stringify(content([richNode]))) as {
        components: Array<{ choices: unknown[] }>;
      };
      const result = validateSectionContent(roundTripped);
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
      expect(roundTripped.components[0]!.choices[0]).toEqual(richNode.choices![0]);
      expect(roundTripped.components[0]!.choices[1]).toEqual(richNode.choices![1]);
    });

    it("wrongly-typed new fields are rejected with invalid_choice (typed when present)", () => {
      const result = validateSectionContent(
        content([
          {
            type: "ButtonAnswerGroup",
            question_id: "q1",
            internal_field: "pick",
            choices: [
              { label: "A", value: "a", analytics_id: "a_a", title: 7 },
              { label: "B", value: "b", analytics_id: "a_b", disabled: "yes" },
            ],
          },
        ]),
      );
      expect(result.ok).toBe(false);
      expect(result.errors.map((e) => [e.code, e.path])).toEqual([
        ["invalid_choice", "components[0].choices[0].title"],
        ["invalid_choice", "components[0].choices[1].disabled"],
      ]);
    });

    it("image_alt is REQUIRED when imageMediaId is present on ImageCardAnswerGrid (invalid_choice)", () => {
      const missingAlt = validateSectionContent(
        content([
          {
            type: "ImageCardAnswerGrid",
            question_id: "q1",
            internal_field: "carrier",
            choices: [{ label: "Acme", value: "acme", analytics_id: "a_acme", imageMediaId: "m1" }],
          },
        ]),
      );
      expect(missingAlt.ok).toBe(false);
      expect(missingAlt.errors.map((e) => [e.code, e.path])).toContainEqual([
        "invalid_choice",
        "components[0].choices[0].image_alt",
      ]);

      const withAlt = validateSectionContent(
        content([
          {
            type: "ImageCardAnswerGrid",
            question_id: "q1",
            internal_field: "carrier",
            choices: [
              {
                label: "Acme",
                value: "acme",
                analytics_id: "a_acme",
                imageMediaId: "m1",
                image_alt: "Acme Insurance logo",
              },
            ],
          },
        ]),
      );
      expect(withAlt.errors).toEqual([]);
      expect(withAlt.ok).toBe(true);
    });

    it("emoji and icon are mutually exclusive per choice; emoji alone is fine", () => {
      const conflicted = validateSectionContent(
        content([
          {
            type: "ButtonAnswerGroup",
            question_id: "q1",
            internal_field: "pick",
            choices: [{ label: "Go", value: "go", analytics_id: "a_go", emoji: "🚀", icon: "star" }],
          },
        ]),
      );
      expect(conflicted.ok).toBe(false);
      expect(conflicted.errors.map((e) => [e.code, e.path])).toEqual([
        ["invalid_choice", "components[0].choices[0].emoji"],
      ]);

      const emojiOnly = validateSectionContent(
        content([
          {
            type: "ButtonAnswerGroup",
            question_id: "q1",
            internal_field: "pick",
            choices: [{ label: "Go", value: "go", analytics_id: "a_go", emoji: "🚀" }],
          },
        ]),
      );
      expect(emojiOnly.errors).toEqual([]);
      expect(emojiOnly.ok).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // §3.4 canonical headline binding — the three typed codes
  // -------------------------------------------------------------------------
  describe("§3.4 bind validator codes", () => {
    it("bind_type_mismatch: section_headline is legal ONLY on QuestionHeadline", () => {
      const result = validateSectionContent(
        content([{ type: "Subheadline", question_id: "s1", bind: "section_headline" }]),
      );
      expect(result.ok).toBe(false);
      expect(result.errors.map((e) => [e.code, e.path])).toContainEqual([
        "bind_type_mismatch",
        "components[0].bind",
      ]);
    });

    it("bind_type_mismatch: section_subheadline is legal ONLY on Subheadline", () => {
      const result = validateSectionContent(
        content([{ type: "QuestionHeadline", question_id: "h1", bind: "section_subheadline" }]),
      );
      expect(result.ok).toBe(false);
      expect(codesOf(result)).toContain("bind_type_mismatch");
    });

    it("bind_type_mismatch: a value outside the bind vocabulary is rejected", () => {
      const result = validateSectionContent(
        content([
          { type: "QuestionHeadline", question_id: "h1", bind: "garbage" },
          { type: "TwoButtonYesNo", question_id: "q1", internal_field: "insured" },
        ]),
      );
      expect(result.ok).toBe(false);
      expect(result.errors.map((e) => [e.code, e.path])).toContainEqual([
        "bind_type_mismatch",
        "components[0].bind",
      ]);
    });

    it("duplicate_bind: at most ONE node per bind value per Section — whole tree", () => {
      const result = validateSectionContent(
        content([
          { type: "QuestionHeadline", question_id: "h1", bind: "section_headline" },
          {
            type: "Stack",
            question_id: "s1",
            children: [{ type: "QuestionHeadline", question_id: "h2", bind: "section_headline" }],
          },
        ]),
      );
      expect(result.ok).toBe(false);
      expect(result.errors.map((e) => [e.code, e.path])).toEqual([
        ["duplicate_bind", "components[1].children[0].bind"],
      ]);
    });

    it("bound_node_carries_text: a bound node must NOT carry props.text", () => {
      const result = validateSectionContent(
        content([
          {
            type: "QuestionHeadline",
            question_id: "h1",
            bind: "section_headline",
            props: { text: "hardcoded — should live on the Section column" },
          },
        ]),
      );
      expect(result.ok).toBe(false);
      expect(result.errors.map((e) => [e.code, e.path])).toEqual([
        ["bound_node_carries_text", "components[0].props.text"],
      ]);
    });

    it("a bound QuestionHeadline WITHOUT props.text is fully valid (required-text rule waived)", () => {
      const result = validateSectionContent(
        content([
          { type: "QuestionHeadline", question_id: "h1", bind: "section_headline" },
          { type: "Subheadline", question_id: "sh1", bind: "section_subheadline" },
        ]),
      );
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    });

    it("legacy: an UNBOUND QuestionHeadline with props.text stays valid (no forced migration)", () => {
      const result = validateSectionContent(
        content([{ type: "QuestionHeadline", question_id: "h1", props: { text: "How much?" } }]),
      );
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // §9.4 color-typed design_overrides VALUE vocabulary
  // -------------------------------------------------------------------------
  describe("§9.4 design_overrides color values — role OR legacy #hex", () => {
    it("a known theme role name passes on every color-typed key", () => {
      const result = validateSectionContent(
        content([
          {
            type: "CategoryLabel",
            question_id: "cl1",
            props: { text: "BUSINESS LOAN" },
            design_overrides: { featureColor: "brand_primary" },
          },
          {
            type: "ContinueButton",
            question_id: "c1",
            design_overrides: { buttonBackground: "accent", buttonText: "button_primary_text" },
          },
        ]),
      );
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    });

    it("a legacy raw #hex literal passes (existing stored content keeps validating)", () => {
      const result = validateSectionContent(
        content([
          {
            type: "ContinueButton",
            question_id: "c1",
            design_overrides: { buttonBackground: "#0F2440", buttonText: "#FFFFFF" },
          },
          {
            type: "IconCardAnswerGrid",
            question_id: "q1",
            internal_field: "biz",
            choices: [{ label: "LLC", value: "llc", analytics_id: "a_llc", icon: "🏢" }],
            design_overrides: { iconColor: "#1B3A5C", rangeColor: "#E85D26" },
          },
        ]),
      );
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    });

    it("invalid_override_value: a non-role non-hex color value is rejected (path-precise)", () => {
      const result = validateSectionContent(
        content([
          {
            type: "ContinueButton",
            question_id: "c1",
            design_overrides: { buttonBackground: "tomato" },
          },
        ]),
      );
      expect(result.ok).toBe(false);
      expect(result.errors.map((e) => [e.code, e.path])).toEqual([
        ["invalid_override_value", "components[0].design_overrides.buttonBackground"],
      ]);
    });

    it("invalid_override_value: a non-string value on a color-typed key is rejected", () => {
      const result = validateSectionContent(
        content([
          { type: "ContinueButton", question_id: "c1", design_overrides: { buttonText: 7 } },
        ]),
      );
      expect(result.ok).toBe(false);
      expect(codesOf(result)).toEqual(["invalid_override_value"]);
    });

    it("non-color keys are NOT subject to the §9.4 rule (columns/gridGap/mobileBehavior unchanged)", () => {
      const result = validateSectionContent(
        content([
          {
            type: "IconCardAnswerGrid",
            question_id: "q1",
            internal_field: "biz",
            choices: [{ label: "LLC", value: "llc", analytics_id: "a_llc", icon: "🏢" }],
            design_overrides: { columns: 3, gridGap: "16px", mobileBehavior: "stack" },
          },
        ]),
      );
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    });

    it("CSS-injection stays arbitrary_css_override (single error — §9.4 does not double-report)", () => {
      const result = validateSectionContent(
        content([
          {
            type: "ContinueButton",
            question_id: "c1",
            design_overrides: { buttonBackground: "red;}body{display:none" },
          },
        ]),
      );
      expect(result.ok).toBe(false);
      expect(codesOf(result)).toEqual(["arbitrary_css_override"]);
    });
  });

  // -------------------------------------------------------------------------
  // 11 §11.5 duplicate Continue buttons — save-time WARNING (never an error)
  // -------------------------------------------------------------------------
  describe("§11.5 duplicate_continue — save-time warning", () => {
    const question: LeadgenComponentNode = {
      type: "TwoButtonYesNo",
      question_id: "q1",
      question_key: "k1",
      internal_field: "f1",
      answer_type: "boolean",
    };
    const continueNode = (id: string): LeadgenComponentNode => ({
      type: "ContinueButton",
      question_id: id,
      props: { label: "Continue" },
    });

    it("2+ ContinueButton nodes → duplicate_continue WARNING, path-precise to the second+ node; ok stays true", () => {
      const result = validateSectionContent(
        content([question, continueNode("c1"), continueNode("c2"), continueNode("c3")]),
      );
      // A warning, never an error — the save is unaffected (§8.6 channel).
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
      const dups = result.warnings.filter((w) => w.code === "duplicate_continue");
      expect(dups.map((w) => w.path)).toEqual(["components[2]", "components[3]"]);
      expect(dups[0]!.message).toContain("more than one Continue button");
    });

    it("a duplicate Continue INSIDE a container is caught (whole tree) with the nested path", () => {
      const result = validateSectionContent(
        content([
          question,
          continueNode("c1"),
          { type: "Stack", question_id: "s1", children: [continueNode("c2")] },
        ]),
      );
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
      const dups = result.warnings.filter((w) => w.code === "duplicate_continue");
      expect(dups.map((w) => w.path)).toEqual(["components[2].children[0]"]);
    });

    it("a single ContinueButton → NO duplicate_continue warning; ok stays true", () => {
      const result = validateSectionContent(content([question, continueNode("c1")]));
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings.filter((w) => w.code === "duplicate_continue")).toEqual([]);
    });
  });
});
