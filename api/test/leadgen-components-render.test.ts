// LeadGen Phase 5 STAGE A — content_json validation + component presets
// (contract 05 §12.3 / §13 / §14.3–§14.10). Proves: validateSectionContent
// accepts a well-formed Section and rejects each malformed class (unknown
// type, dup ids, missing required, bad conditional field, non-curated / CSS
// override); every catalog type renders to token-styled markup with the right
// hydration attrs, escaping all hostile author content and emitting NO
// <style>/<script>; and the §14.4/§14.5/§14.6/§14.7 MUSTs hold at the string
// level (the computed-style contract Stage C proves in a browser).

import { describe, expect, it } from "vitest";
import { COMPONENT_CATALOG } from "../src/public/leadgen/components/registry";
import type { ComponentType } from "../src/public/leadgen/components/registry";
import {
  validateSectionContent,
  CURATED_DESIGN_OVERRIDE_KEYS,
} from "../src/public/leadgen/components/content-schema";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import {
  renderComponent,
  renderSectionComponents,
} from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";

const DESIGN = defaultFunnelDesign;
const codes = (content: unknown): string[] => validateSectionContent(content).errors.map((e) => e.code);

// ---------------------------------------------------------------------------
// validateSectionContent — accept a well-formed Section (§12.3 dependent flow)
// ---------------------------------------------------------------------------

describe("validateSectionContent — accepts a well-formed Section", () => {
  it("accepts the §13.2 'Dependent' worked example (insured yes → insurer dropdown)", () => {
    const content = {
      components: [
        { type: "ProgressBar", question_id: "p1", props: { mode: "percent", percent: 40 } },
        { type: "QuestionHeadline", question_id: "h1", props: { text: "Are you insured?" } },
        {
          type: "TwoButtonYesNo",
          question_id: "q_ins",
          question_key: "insured_q",
          internal_field: "currently_insured",
          answer_type: "boolean",
          required: true,
          props: { auto_advance: true },
        },
        {
          type: "DropdownQuestion",
          question_id: "q_insurer",
          question_key: "insurer_q",
          internal_field: "insurer",
          answer_type: "enum",
          choices: [
            { label: "Acme", value: "acme", analytics_id: "ins_acme" },
            { label: "Globex", value: "globex", analytics_id: "ins_globex" },
          ],
          conditional: { when: "currently_insured", op: "eq", value: true },
        },
        { type: "ContinueButton", question_id: "cont1", props: { label: "Continue" } },
      ],
    };
    const result = validateSectionContent(content);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("accepts a currency-range Section with a curated design_override", () => {
    const content = {
      components: [
        { type: "CategoryLabel", question_id: "c1", props: { text: "BUSINESS LOAN" } },
        { type: "QuestionHeadline", question_id: "h1", props: { text: "How much do you need?" } },
        {
          type: "CurrencyRangeQuestion",
          question_id: "q_amt",
          internal_field: "loan_amount",
          answer_type: "currency",
          design_overrides: { rangeColor: "#1B3A5C", columns: 3 },
          props: { min: 10000, max: 1000000, default: 330000, currency: "$" },
        },
      ],
    };
    expect(validateSectionContent(content).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateSectionContent — reject each malformed class
// ---------------------------------------------------------------------------

describe("validateSectionContent — structural rejects", () => {
  it("non-object content", () => {
    expect(codes("nope")).toContain("content_not_object");
    expect(codes(null)).toContain("content_not_object");
  });
  it("components not an array", () => {
    expect(codes({ components: "x" })).toContain("components_not_array");
  });
  it("empty components", () => {
    expect(codes({ components: [] })).toContain("components_empty");
  });
  it("node not an object", () => {
    expect(codes({ components: [42] })).toContain("node_not_object");
  });
});

describe("validateSectionContent — per-node rejects", () => {
  it("unknown component type (registry closing contract)", () => {
    const c = { components: [{ type: "MagicWidget", question_id: "x" }] };
    expect(codes(c)).toContain("unknown_component_type");
  });

  it("missing question_id", () => {
    const c = { components: [{ type: "QuestionHeadline", props: { text: "hi" } }] };
    expect(codes(c)).toContain("missing_question_id");
  });

  it("duplicate question_id", () => {
    const c = {
      components: [
        { type: "QuestionHeadline", question_id: "dup", props: { text: "a" } },
        { type: "Subheadline", question_id: "dup", props: { text: "b" } },
      ],
    };
    expect(codes(c)).toContain("duplicate_question_id");
  });

  it("duplicate question_key", () => {
    const c = {
      components: [
        { type: "FreeTextQuestion", question_id: "a", question_key: "k", internal_field: "fa" },
        { type: "FreeTextQuestion", question_id: "b", question_key: "k", internal_field: "fb" },
      ],
    };
    expect(codes(c)).toContain("duplicate_question_key");
  });

  it("missing required internal_field (RangeQuestion)", () => {
    const c = { components: [{ type: "RangeQuestion", question_id: "r", props: { min: 0, max: 9 } }] };
    expect(codes(c)).toContain("missing_required_field");
  });

  it("missing required text prop (CategoryLabel)", () => {
    const c = { components: [{ type: "CategoryLabel", question_id: "c" }] };
    expect(codes(c)).toContain("missing_required_field");
  });

  it("missing required numeric prop (range min/max)", () => {
    const c = {
      components: [{ type: "NumberRangeQuestion", question_id: "r", internal_field: "n", props: {} }],
    };
    expect(codes(c)).toContain("missing_required_field");
  });

  it("missing choices (IconCardAnswerGrid)", () => {
    const c = { components: [{ type: "IconCardAnswerGrid", question_id: "g", internal_field: "biz" }] };
    expect(codes(c)).toContain("invalid_choice");
  });

  it("choice missing analytics_id / icon (§14.4)", () => {
    const c = {
      components: [
        {
          type: "IconCardAnswerGrid",
          question_id: "g",
          internal_field: "biz",
          choices: [{ label: "LLC", value: "llc" }],
        },
      ],
    };
    const cc = codes(c);
    expect(cc.filter((x) => x === "invalid_choice").length).toBeGreaterThanOrEqual(2); // analytics_id + icon
  });

  it("answer_type mismatch vs catalog produces", () => {
    const c = {
      components: [
        {
          type: "EmailInputQuestion",
          question_id: "e",
          internal_field: "email",
          answer_type: "number", // catalog produces "string"
        },
      ],
    };
    expect(codes(c)).toContain("answer_type_mismatch");
  });

  it("bad valid_values", () => {
    const c = {
      components: [
        { type: "FreeTextQuestion", question_id: "f", internal_field: "x", valid_values: [] },
      ],
    };
    expect(codes(c)).toContain("invalid_valid_values");
  });

  it("conditional referencing an unknown field (§12.3)", () => {
    const c = {
      components: [
        {
          type: "DropdownQuestion",
          question_id: "d",
          internal_field: "insurer",
          choices: [{ label: "A", value: "a", analytics_id: "a" }],
          conditional: { when: "not_a_real_field", op: "eq", value: true },
        },
      ],
    };
    expect(codes(c)).toContain("conditional_unknown_field");
  });

  it("conditional bad op / shape", () => {
    const badOp = {
      components: [
        { type: "FreeTextQuestion", question_id: "f", internal_field: "x", conditional: { when: "x", op: "startsWith", value: 1 } },
      ],
    };
    expect(codes(badOp)).toContain("conditional_invalid");
    const badRange = {
      components: [
        { type: "FreeTextQuestion", question_id: "f", internal_field: "x", conditional: { when: "x", op: "range" } },
      ],
    };
    expect(codes(badRange)).toContain("conditional_invalid");
  });

  it("non-curated design_override key (§14.8)", () => {
    const c = {
      components: [
        { type: "FreeTextQuestion", question_id: "f", internal_field: "x", design_overrides: { boxShadow: "0 0 9px red" } },
      ],
    };
    expect(codes(c)).toContain("non_curated_override_key");
  });

  it("arbitrary-CSS override value on a curated key (§14.10 no-CSS-escape)", () => {
    const c = {
      components: [
        { type: "FreeTextQuestion", question_id: "f", internal_field: "x", design_overrides: { buttonBackground: "red;position:fixed" } },
      ],
    };
    expect(codes(c)).toContain("arbitrary_css_override");
  });

  it("accepts every curated override key with token values", () => {
    const overrides: Record<string, string | number> = {};
    for (const k of CURATED_DESIGN_OVERRIDE_KEYS) overrides[k] = k === "columns" ? 3 : "#1B3A5C";
    const c = {
      components: [
        { type: "IconCardAnswerGrid", question_id: "g", internal_field: "biz", design_overrides: overrides, choices: [{ label: "LLC", value: "llc", analytics_id: "a", icon: "x" }] },
      ],
    };
    expect(validateSectionContent(c).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderComponent — every catalog type renders safe, token-styled markup
// ---------------------------------------------------------------------------

const CHOICES = [
  { label: "Sole Proprietor", value: "sole_prop", analytics_id: "biz_sole" },
  { label: "Partnership", value: "partnership", analytics_id: "biz_partner" },
];
const ICON_CHOICES = CHOICES.map((c) => ({ ...c, icon: "🏢" }));
const IMAGE_CHOICES = CHOICES.map((c) => ({ ...c, imageMediaId: "media_123" }));

// A minimal VALID node per catalog type (covers required fields). The count
// guard below asserts this map stays in lockstep with the catalog.
const NODE_SPECS: Record<ComponentType, LeadgenComponentNode> = {
  ProgressBar: { type: "ProgressBar", question_id: "q", props: { mode: "percent", percent: 50 } },
  HeaderLogo: { type: "HeaderLogo", question_id: "q", props: { logoMediaId: "m1", siteName: "Acme", accent: "Quotes" } },
  BackButton: { type: "BackButton", question_id: "q", props: { label: "Back" } },
  DisclosureLink: { type: "DisclosureLink", question_id: "q", props: { panelHtml: "Legal blurb" } },
  CategoryLabel: { type: "CategoryLabel", question_id: "q", props: { text: "BUSINESS LOAN" } },
  QuestionHeadline: { type: "QuestionHeadline", question_id: "q", props: { text: "How much?" } },
  Subheadline: { type: "Subheadline", question_id: "q", props: { text: "Why we ask" } },
  RangeQuestion: { type: "RangeQuestion", question_id: "q", internal_field: "amt", props: { min: 0, max: 100, default: 50 } },
  CurrencyRangeQuestion: { type: "CurrencyRangeQuestion", question_id: "q", internal_field: "loan", props: { min: 10000, max: 1000000, default: 330000, currency: "$" } },
  NumberRangeQuestion: { type: "NumberRangeQuestion", question_id: "q", internal_field: "count", props: { min: 1, max: 9, default: 3 } },
  ButtonAnswerGroup: { type: "ButtonAnswerGroup", question_id: "q", internal_field: "pick", choices: CHOICES },
  TwoButtonYesNo: { type: "TwoButtonYesNo", question_id: "q", internal_field: "insured", props: { auto_advance: true } },
  IconCardAnswerGrid: { type: "IconCardAnswerGrid", question_id: "q", internal_field: "biz", choices: ICON_CHOICES, props: { columns: 3 } },
  ImageCardAnswerGrid: { type: "ImageCardAnswerGrid", question_id: "q", internal_field: "carrier", choices: IMAGE_CHOICES, props: { columns: 4 } },
  MultiChoiceCardGroup: { type: "MultiChoiceCardGroup", question_id: "q", internal_field: "features", choices: CHOICES, props: { min: 1, max: 2 } },
  DropdownQuestion: { type: "DropdownQuestion", question_id: "q", internal_field: "insurer", choices: CHOICES, props: { placeholder: "Pick one" } },
  FreeTextQuestion: { type: "FreeTextQuestion", question_id: "q", internal_field: "note", props: { placeholder: "Type…", maxLen: 100 } },
  EmailInputQuestion: { type: "EmailInputQuestion", question_id: "q", internal_field: "email", required: true },
  PhoneInputQuestion: { type: "PhoneInputQuestion", question_id: "q", internal_field: "phone" },
  NameFieldsGroup: { type: "NameFieldsGroup", question_id: "q", required: true },
  DateQuestion: { type: "DateQuestion", question_id: "q", internal_field: "dob", props: { min: "1900-01-01" } },
  ZIPInputQuestion: { type: "ZIPInputQuestion", question_id: "q", internal_field: "zip", props: { validate: true } },
  AddressAutocompleteQuestion: { type: "AddressAutocompleteQuestion", question_id: "q", props: { provider: "google" } },
  ContinueButton: { type: "ContinueButton", question_id: "q", props: { label: "Continue", loadingLabel: "Loading…" } },
  AutoAdvanceButton: { type: "AutoAdvanceButton", question_id: "q", props: { label: "Next" } },
  ReassuranceBadge: { type: "ReassuranceBadge", question_id: "q", props: { text: "Get your offers in 2 minutes or less." } },
  HelperText: { type: "HelperText", question_id: "q", props: { text: "We never share this." } },
  ValidationError: { type: "ValidationError", question_id: "q", props: { text: "Required" } },
  LegalNote: { type: "LegalNote", question_id: "q", props: { html: "Terms apply" } },
};

const ALL_TYPES = Object.keys(COMPONENT_CATALOG) as ComponentType[];

// Post-fix: the pure-stateful presets carry NO inline style at all — their base
// border/background/color lives in the scoped chrome CSS so the state rules win
// by cascade (no !important): the :focus / [aria-invalid] rules for the text
// inputs + dropdown, AND the :hover / [aria-checked] selected rules for the
// answer buttons (ButtonAnswerGroup / TwoButtonYesNo) — the §14.6 answer-button
// fix, which leaves no per-instance value to emit. Every OTHER preset still emits
// token-derived per-instance inline style (grid cols, range fill %, icon color,
// progress fill, chrome colours with no state).
const NO_INLINE_STYLE_TYPES = new Set<ComponentType>([
  "DropdownQuestion",
  "FreeTextQuestion",
  "EmailInputQuestion",
  "PhoneInputQuestion",
  "DateQuestion",
  "ZIPInputQuestion",
  "NameFieldsGroup",
  "AddressAutocompleteQuestion",
  "ButtonAnswerGroup",
  "TwoButtonYesNo",
]);

describe("renderComponent — every catalog type", () => {
  it("NODE_SPECS covers every catalog type (lockstep guard)", () => {
    expect(Object.keys(NODE_SPECS).sort()).toEqual([...ALL_TYPES].sort());
  });

  it("every minimal node is accepted by validateSectionContent", () => {
    for (const type of ALL_TYPES) {
      const result = validateSectionContent({ components: [NODE_SPECS[type]] });
      expect(result.errors, type).toEqual([]);
    }
  });

  for (const type of ALL_TYPES) {
    it(`${type} → token-styled markup with hydration attrs, no <style>/<script>`, () => {
      const html = renderComponent(NODE_SPECS[type], DESIGN);
      expect(html.length, type).toBeGreaterThan(0);
      expect(html, type).toContain(`data-component-type="${type}"`);
      expect(html, type).toContain('class="lg-');
      if (NO_INLINE_STYLE_TYPES.has(type)) {
        // FIX proof: the stateful input/dropdown presets emit NO inline style —
        // base styling is fully class-driven so the :focus/[aria-invalid] rules apply.
        expect(html, `${type} carries NO inline style (base styling is class-driven)`).not.toContain('style="');
      } else {
        // token-derived per-instance inline style present (no-state values).
        expect(html, type).toContain('style="');
      }
      // §14.3/§14.10: no preset emits a <style> block or a <script>.
      expect(html.includes("<style"), type).toBe(false);
      expect(html.includes("<script"), type).toBe(false);
    });
  }

  it("question nodes carry data-internal-field + data-answer-type", () => {
    const html = renderComponent(NODE_SPECS.CurrencyRangeQuestion, DESIGN);
    expect(html).toContain('data-internal-field="loan"');
    expect(html).toContain('data-answer-type="currency"'); // catalog produces
  });

  it("choice nodes carry per-choice data-value + data-analytics-id", () => {
    const html = renderComponent(NODE_SPECS.ButtonAnswerGroup, DESIGN);
    expect(html).toContain('data-value="sole_prop"');
    expect(html).toContain('data-analytics-id="biz_sole"');
  });

  it("renderSectionComponents renders a whole ordered Section", () => {
    const html = renderSectionComponents(
      [NODE_SPECS.CategoryLabel, NODE_SPECS.QuestionHeadline, NODE_SPECS.CurrencyRangeQuestion],
      DESIGN,
    );
    expect(html.indexOf("lg-category")).toBeLessThan(html.indexOf("lg-headline"));
    expect(html).toContain("lg-range");
  });
});

// ---------------------------------------------------------------------------
// escaping — hostile author content never becomes live markup (every type)
// ---------------------------------------------------------------------------

describe("renderComponent — escapes all hostile author content", () => {
  const HOSTILE = `<script>alert(1)</script><img src=x onerror=alert(2)>`;

  function hostileNode(type: ComponentType): LeadgenComponentNode {
    const base = NODE_SPECS[type];
    const props: Record<string, unknown> = { ...(base.props ?? {}) };
    for (const key of ["text", "label", "placeholder", "html", "panelHtml", "siteName", "accent", "minLabel", "maxLabel"]) {
      props[key] = HOSTILE;
    }
    const choices = base.choices?.map((c) => ({ ...c, label: HOSTILE }));
    return { ...base, props, ...(choices ? { choices } : {}) };
  }

  for (const type of ALL_TYPES) {
    it(`${type} emits no raw <script>/<img> from author content`, () => {
      const html = renderComponent(hostileNode(type), DESIGN);
      // The `<`/`>` of any author payload are escaped, so no live tag forms.
      // (ImageCard/HeaderLogo emit their OWN <img>, but never the author's.)
      expect(html.includes("<script>"), type).toBe(false);
      expect(html.includes("<img src=x"), type).toBe(false);
      expect(html.includes("onerror=alert(2)>"), type).toBe(false);
    });
  }

  it("escapes hostile text into entities (CategoryLabel)", () => {
    const html = renderComponent(
      { type: "CategoryLabel", question_id: "c", props: { text: HOSTILE } },
      DESIGN,
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("ignores an author-supplied props.style (no arbitrary style leaks through)", () => {
    const html = renderComponent(
      { type: "FreeTextQuestion", question_id: "f", internal_field: "x", props: { style: "position:fixed;top:0", placeholder: "hi" } },
      DESIGN,
    );
    expect(html).not.toContain("position:fixed");
  });
});

// ---------------------------------------------------------------------------
// §14.4 icon card — cols, per-choice icon/label, states, example choices
// ---------------------------------------------------------------------------

describe("IconCardAnswerGrid (§14.4)", () => {
  it("emits the requested desktop column count via --lg-cols (clamped 2..5)", () => {
    const four = renderComponent(
      { type: "IconCardAnswerGrid", question_id: "g", internal_field: "biz", props: { columns: 4 }, choices: ICON_CHOICES },
      DESIGN,
    );
    expect(four).toContain("--lg-cols:4");
    const clampedHigh = renderComponent(
      { type: "IconCardAnswerGrid", question_id: "g", internal_field: "biz", props: { columns: 9 }, choices: ICON_CHOICES },
      DESIGN,
    );
    expect(clampedHigh).toContain("--lg-cols:5");
    const clampedLow = renderComponent(
      { type: "IconCardAnswerGrid", question_id: "g", internal_field: "biz", props: { columns: 1 }, choices: ICON_CHOICES },
      DESIGN,
    );
    expect(clampedLow).toContain("--lg-cols:2");
  });

  it("expresses the §14.4 example choices with per-choice icon + navy icon color", () => {
    const choices = [
      { label: "Sole Proprietor", value: "sole", analytics_id: "a1", icon: "S" },
      { label: "Partnership", value: "partner", analytics_id: "a2", icon: "P" },
      { label: "Limited Liability Company (LLC)", value: "llc", analytics_id: "a3", icon: "L" },
      { label: "C Corporation", value: "ccorp", analytics_id: "a4", icon: "C" },
      { label: "S Corporation", value: "scorp", analytics_id: "a5", icon: "SC" },
    ];
    const html = renderComponent(
      { type: "IconCardAnswerGrid", question_id: "g", internal_field: "biz", props: { columns: 5 }, choices },
      DESIGN,
    );
    for (const c of choices) expect(html).toContain(c.label.replace("(", "(")); // labels present
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('role="radio"');
    // navy icon color (§14.4 default-funnel skin: icons navy #1B3A5C) — a
    // per-choice inline value with NO state variant, so it stays inline.
    expect(html).toContain("color:#1B3A5C");
    // per-card selectable
    expect(html).toContain('aria-checked="false"');
    // FIX: the base card border is NO LONGER inline (moved to the scoped chrome
    // CSS) so the §14.4 selected/hover/focus state rules win by cascade.
    expect(html).not.toContain("border:2px solid #D2D9E5");
    const chrome = funnelChromeCss(DESIGN);
    // (base) the card border token lives in the .lg-card chrome rule …
    expect(chrome).toContain("border:2px solid #D2D9E5");
    // … and (NEW) the §14.4 SELECTED state carries navy border #1B3A5C + wash
    // bg #E8EEF4 — it now APPLIES (no inline base border/background outranks it).
    expect(chrome).toContain('.lg-card[aria-checked="true"]');
    expect(chrome).toContain("border-color:#1B3A5C;background:#E8EEF4");
  });
});

// ---------------------------------------------------------------------------
// §14.6 answer buttons — ButtonAnswerGroup + TwoButtonYesNo (§13.2 "Are you
// insured? [Yes][No]"). Base + selected/hover/focus chrome is CLASS-DRIVEN
// (.lg-btn.lg-btn-answer) so the "selected animation" applies; NO inline
// background/color/border defeats it (the sibling of the icon-card fix).
// ---------------------------------------------------------------------------

describe("ButtonAnswerGroup + TwoButtonYesNo (§14.6 answer-button state)", () => {
  it("both answer-button presets emit NO inline style (base + state fully class-driven)", () => {
    const group = renderComponent(NODE_SPECS.ButtonAnswerGroup, DESIGN);
    const yesno = renderComponent(NODE_SPECS.TwoButtonYesNo, DESIGN);
    // FIX proof: the per-instance inline base (background/color/border) that used
    // to outrank the scoped chrome state rules is GONE from BOTH presets.
    expect(group, "ButtonAnswerGroup carries NO inline style").not.toContain('style="');
    expect(yesno, "TwoButtonYesNo carries NO inline style").not.toContain('style="');
    // …but the class + role/aria + hydration attrs the runtime needs remain.
    expect(group).toContain('class="lg-btn lg-btn-answer"');
    expect(group).toContain('role="radio"');
    expect(group).toContain('aria-checked="false"');
    expect(group).toContain('data-value="sole_prop"');
    expect(group).toContain('data-analytics-id="biz_sole"');
    expect(yesno).toContain('class="lg-btn lg-btn-answer"');
    expect(yesno).toContain('data-value="true"');
    expect(yesno).toContain('data-value="false"');
  });

  it("the .lg-btn.lg-btn-answer chrome is base white + 2px #D2D9E5, navy selected, non-navy-fill hover", () => {
    const chrome = funnelChromeCss(DESIGN);
    // BASE: white bg + dark ink + 2px #D2D9E5 border (reuses color.card /
    // page.textColor / input.border) + the icon-card transition — the compound
    // .lg-btn.lg-btn-answer (2 classes) outranks the .lg-btn primary base (1 class).
    expect(chrome).toContain(
      ".lg-btn.lg-btn-answer{background:#FFFFFF;color:#1A1F36;border:2px solid #D2D9E5;transition:border-color var(--lg-transition-card), background var(--lg-transition-card)}",
    );
    // SELECTED (§14.6 "selected animation"): navy #1B3A5C border + #E8EEF4 wash bg
    // + weight 700 — the SAME iconCard.selectedBorderColor / selectedBackground
    // the icon card uses (§14.4). Asserted on the [data-selected] half of the
    // selector group (a clean contiguous substring) + presence of [aria-checked].
    expect(chrome).toContain(
      '.lg-btn.lg-btn-answer[data-selected="true"]{border-color:#1B3A5C;background:#E8EEF4;font-weight:700}',
    );
    expect(chrome).toContain('.lg-btn.lg-btn-answer[aria-checked="true"]');
    // HOVER: navy border + #F2F6FA wash (iconCard.hover*) — the exact match proves
    // it is NOT the primary navy FILL #0F2440 the bare .lg-btn:hover imposes.
    expect(chrome).toContain(".lg-btn.lg-btn-answer:hover{border-color:#1B3A5C;background:#F2F6FA}");
    // FOCUS: the same visible focus ring the .lg-card:focus-visible rule uses.
    expect(chrome).toContain(".lg-btn.lg-btn-answer:focus-visible{outline:2px solid #1B3A5C;outline-offset:2px}");
  });
});

// ---------------------------------------------------------------------------
// §14.5 range — filled/remaining track + slider a11y + currency format
// ---------------------------------------------------------------------------

describe("RangeQuestion / CurrencyRangeQuestion (§14.5)", () => {
  it("emits role=slider + aria-valuemin/max/now + filled/remaining track", () => {
    const html = renderComponent(
      { type: "CurrencyRangeQuestion", question_id: "q", internal_field: "loan", props: { min: 10000, max: 1000000, default: 330000, minLabel: "$10,000", maxLabel: "$1M+" } },
      DESIGN,
    );
    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuemin="10000"');
    expect(html).toContain('aria-valuemax="1000000"');
    expect(html).toContain('aria-valuenow="330000"');
    // filled + remaining track elements
    expect(html).toContain("lg-range-fill");
    expect(html).toContain("lg-range-track");
    // navy filled track (§14.5)
    expect(html).toContain("background-color:#1B3A5C");
    // currency-formatted value + author min/max labels
    expect(html).toContain("$330,000");
    expect(html).toContain("$1M+");
  });

  it("computes the filled width from (value-min)/(max-min)", () => {
    const html = renderComponent(
      { type: "NumberRangeQuestion", question_id: "q", internal_field: "n", props: { min: 0, max: 200, default: 50 } },
      DESIGN,
    );
    expect(html).toContain("width:25%"); // 50/200
    expect(html).not.toContain("$"); // number format, no currency prefix
  });
});

// ---------------------------------------------------------------------------
// ProgressBar — a11y (accessibility.md: role=progressbar + aria-valuenow)
// ---------------------------------------------------------------------------

describe("ProgressBar (a11y — role=progressbar + aria-value*)", () => {
  it("percent mode emits role=progressbar + aria-valuemin/max/now (0..100)", () => {
    const html = renderComponent(
      { type: "ProgressBar", question_id: "p1", props: { mode: "percent", percent: 40 } },
      DESIGN,
    );
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-valuenow="40"');
  });

  it("step mode sets aria-valuemax to the step count + aria-valuenow to the step", () => {
    const html = renderComponent(
      { type: "ProgressBar", question_id: "p2", props: { mode: "step", step: 2, totalSteps: 5 } },
      DESIGN,
    );
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="5"'); // the step count, not 100
    expect(html).toContain('aria-valuenow="2"');
    // the derived "Step 2 of 5" label is exposed to AT via aria-valuetext.
    expect(html).toContain('aria-valuetext="Step 2 of 5"');
  });

  it("escapes a hostile author label in aria-valuetext (never raw markup)", () => {
    const html = renderComponent(
      { type: "ProgressBar", question_id: "p3", props: { mode: "percent", percent: 10, label: `<img src=x onerror=alert(1)>` } },
      DESIGN,
    );
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("aria-valuetext=");
    expect(html).toContain("&lt;img");
  });
});

// ---------------------------------------------------------------------------
// §14.6 continue — navy (NOT blue) full-width pill + loading spinner
// ---------------------------------------------------------------------------

describe("ContinueButton (§14.6)", () => {
  it("is navy #1B3A5C, NOT blue, full-width pill with a loading spinner", () => {
    const html = renderComponent(NODE_SPECS.ContinueButton, DESIGN);
    // FIX: the navy base background is NO LONGER inline (moved to the .lg-btn
    // chrome rule) so the §14.6 :hover darken wins by cascade.
    expect(html).not.toContain("background:#1B3A5C");
    const chrome = funnelChromeCss(DESIGN);
    expect(chrome).toContain("background:#1B3A5C"); // navy base on the .lg-btn chrome rule
    // (NEW) §14.6 hover darkens to navy-dark #0F2440 (state rule, now unblocked).
    expect(chrome).toContain(".lg-btn:hover{background:#0F2440}");
    expect(html.toLowerCase()).not.toContain("#2a6fdb"); // not the discarded blue
    expect(html).toContain("lg-continue");
    expect(html).toContain("lg-btn-spinner");
    expect(html).toContain('data-loading="false"');
    expect(html).toContain('data-loading-label="Loading…"');
  });

  it("honours a curated buttonBackground override via the --lg-btn-bg custom property", () => {
    const html = renderComponent(
      { type: "ContinueButton", question_id: "c", design_overrides: { buttonBackground: "#0F2440" }, props: { label: "Go" } },
      DESIGN,
    );
    // The override flows to the --lg-btn-bg custom property (read by the
    // .lg-continue chrome rule) — NOT an inline background that would defeat :hover.
    expect(html).toContain("--lg-btn-bg:#0F2440");
    expect(html).not.toContain("background:#0F2440");
  });
});

// ---------------------------------------------------------------------------
// §14.7 reassurance badge — success-green outline + pale bg
// ---------------------------------------------------------------------------

describe("ReassuranceBadge (§14.7)", () => {
  it("has a success-green #0E7C3A outline + pale #F2F6FA background", () => {
    const html = renderComponent(NODE_SPECS.ReassuranceBadge, DESIGN);
    expect(html).toContain("#0E7C3A"); // success-green border + icon/text
    expect(html).toContain("background:#F2F6FA"); // pale bg
    expect(html).toContain("Get your offers in 2 minutes or less.");
  });
});

// ---------------------------------------------------------------------------
// Fix-contract v2.4 03 §3.3 — the data-lg-* hydration hook vocabulary
// (contract-normative: preview + runtime emit these identically by
// construction — 09 §9.1/§9.3; the engine + the 11 §11.6 anti-false-PASS
// probes consume them).
// ---------------------------------------------------------------------------

describe("v2.4 03 §3.3 — data-lg-* hydration hooks", () => {
  const QUESTION_TYPES = ALL_TYPES.filter((t) => COMPONENT_CATALOG[t].produces !== null);
  const NON_QUESTION_TYPES = ALL_TYPES.filter((t) => COMPONENT_CATALOG[t].produces === null);

  it("every answer-PRODUCING type carries data-lg-question={question_id}", () => {
    for (const type of QUESTION_TYPES) {
      const html = renderComponent(NODE_SPECS[type], DESIGN);
      expect(html, type).toContain(`data-lg-question="${NODE_SPECS[type].question_id}"`);
    }
  });

  it("NO chrome/affordance/control type carries data-lg-question (11 §11.6 probe counts questions only)", () => {
    for (const type of NON_QUESTION_TYPES) {
      const html = renderComponent(NODE_SPECS[type], DESIGN);
      expect(html, type).not.toContain("data-lg-question");
    }
  });

  it("data-lg-field mirrors internal_field on question components that carry one", () => {
    expect(renderComponent(NODE_SPECS.TwoButtonYesNo, DESIGN)).toContain('data-lg-field="insured"');
    expect(renderComponent(NODE_SPECS.FreeTextQuestion, DESIGN)).toContain('data-lg-field="note"');
    expect(renderComponent(NODE_SPECS.CurrencyRangeQuestion, DESIGN)).toContain('data-lg-field="loan"');
    // NameFieldsGroup / AddressAutocomplete have no single internal_field → no data-lg-field.
    expect(renderComponent(NODE_SPECS.NameFieldsGroup, DESIGN)).not.toContain("data-lg-field");
    expect(renderComponent(NODE_SPECS.AddressAutocompleteQuestion, DESIGN)).not.toContain("data-lg-field");
  });

  it("every selectable choice carries data-lg-choice={value} (buttons, cards, multi, yes/no, dropdown options)", () => {
    expect(renderComponent(NODE_SPECS.ButtonAnswerGroup, DESIGN)).toContain('data-lg-choice="sole_prop"');
    expect(renderComponent(NODE_SPECS.ButtonAnswerGroup, DESIGN)).toContain('data-lg-choice="partnership"');
    expect(renderComponent(NODE_SPECS.IconCardAnswerGrid, DESIGN)).toContain('data-lg-choice="sole_prop"');
    expect(renderComponent(NODE_SPECS.ImageCardAnswerGrid, DESIGN)).toContain('data-lg-choice="partnership"');
    expect(renderComponent(NODE_SPECS.MultiChoiceCardGroup, DESIGN)).toContain('data-lg-choice="sole_prop"');
    const yesno = renderComponent(NODE_SPECS.TwoButtonYesNo, DESIGN);
    expect(yesno).toContain('data-lg-choice="true"');
    expect(yesno).toContain('data-lg-choice="false"');
    const dropdown = renderComponent(NODE_SPECS.DropdownQuestion, DESIGN);
    expect(dropdown).toContain('data-lg-choice="sole_prop"');
    expect(dropdown).toContain('data-lg-choice="partnership"');
  });

  it("data-lg-input marks the text/date/email/phone/zip inputs (incl. name-group + address inputs)", () => {
    for (const type of [
      "FreeTextQuestion",
      "EmailInputQuestion",
      "PhoneInputQuestion",
      "DateQuestion",
      "ZIPInputQuestion",
    ] as const) {
      expect(renderComponent(NODE_SPECS[type], DESIGN), type).toContain("data-lg-input");
    }
    // both name fields carry it…
    const name = renderComponent(NODE_SPECS.NameFieldsGroup, DESIGN);
    expect(name.split("data-lg-input").length - 1).toBe(2);
    // …and the visible address input (hidden part-fields don't).
    const addr = renderComponent(NODE_SPECS.AddressAutocompleteQuestion, DESIGN);
    expect(addr.split("data-lg-input").length - 1).toBe(1);
  });

  it("nav controls: data-lg-continue on Continue + AutoAdvance buttons; data-lg-back on Back", () => {
    expect(renderComponent(NODE_SPECS.ContinueButton, DESIGN)).toContain("data-lg-continue");
    expect(renderComponent(NODE_SPECS.AutoAdvanceButton, DESIGN)).toContain("data-lg-continue");
    expect(renderComponent(NODE_SPECS.BackButton, DESIGN)).toContain("data-lg-back");
    expect(renderComponent(NODE_SPECS.ContinueButton, DESIGN)).not.toContain("data-lg-back");
  });

  it("progress bar: data-lg-progress + data-mode ride together", () => {
    const html = renderComponent(NODE_SPECS.ProgressBar, DESIGN);
    expect(html).toContain("data-lg-progress");
    expect(html).toContain('data-mode="percent"');
    const step = renderComponent(
      { type: "ProgressBar", question_id: "p", props: { mode: "step", step: 1, totalSteps: 4 } },
      DESIGN,
    );
    expect(step).toContain("data-lg-progress");
    expect(step).toContain('data-mode="step"');
  });

  it("M5: progress bar stamps data-lg-progress-bar on the fill + data-lg-progress-label on the label — hydration updates hooks, never wipes the track", () => {
    // The fill hook rides EVERY ProgressBar render (updateProgress writes the
    // width there instead of falling back to textContent, which would wipe
    // .lg-progress-track/.lg-progress-fill — 03 §3.2 "no visual change").
    const percent = renderComponent(NODE_SPECS.ProgressBar, DESIGN);
    expect(percent).toContain('class="lg-progress-fill" data-lg-progress-bar');
    expect(percent).toContain('class="lg-progress-track"');

    // Step mode auto-derives a label → the label hook rides its text div.
    const step = renderComponent(
      { type: "ProgressBar", question_id: "p", props: { mode: "step", step: 1, totalSteps: 4 } },
      DESIGN,
    );
    expect(step).toContain('class="lg-progress-fill" data-lg-progress-bar');
    expect(step).toContain('class="lg-progress-text" data-lg-progress-label');
  });

  it("data-lg-error-for={internal_field} on a bound error slot; absent on an unbound one", () => {
    const bound = renderComponent(
      { type: "ValidationError", question_id: "e1", internal_field: "email", props: { text: "Required" } },
      DESIGN,
    );
    expect(bound).toContain('data-lg-error-for="email"');
    const unbound = renderComponent(NODE_SPECS.ValidationError, DESIGN);
    expect(unbound).not.toContain("data-lg-error-for");
  });
});

// ---------------------------------------------------------------------------
// v2.4 03 §3.3 / 08 §8.8 — data-lg-maps on Maps-enabled address/ZIP components
// ---------------------------------------------------------------------------

describe("v2.4 §3.3 — data-lg-maps (field-level props.maps; compat fallback)", () => {
  it("AddressAutocompleteQuestion always carries data-lg-maps ('{}' compat fallback without props.maps)", () => {
    const html = renderComponent(NODE_SPECS.AddressAutocompleteQuestion, DESIGN);
    expect(html).toContain('data-lg-maps="{}"');
  });

  it("props.maps serializes VERBATIM into data-lg-maps (field-level config wins, §8.8)", () => {
    const html = renderComponent(
      {
        type: "AddressAutocompleteQuestion",
        question_id: "q_addr",
        props: { maps: { validateFullAddress: true, autofillCity: "city", autofillState: "state" } },
      },
      DESIGN,
    );
    // escapeHtml quotes the JSON for the attribute context.
    expect(html).toContain("data-lg-maps=");
    expect(html).toContain("validateFullAddress");
    expect(html).toContain("autofillCity");
  });

  it("ZIP: data-lg-maps rides the legacy validate flag OR a props.maps config; a plain ZIP has none", () => {
    const legacy = renderComponent(NODE_SPECS.ZIPInputQuestion, DESIGN); // props.validate: true
    expect(legacy).toContain("data-lg-maps=");
    const fieldLevel = renderComponent(
      { type: "ZIPInputQuestion", question_id: "z2", internal_field: "zip", props: { maps: { autofillCity: "city" } } },
      DESIGN,
    );
    expect(fieldLevel).toContain("autofillCity");
    const plain = renderComponent(
      { type: "ZIPInputQuestion", question_id: "z3", internal_field: "zip", props: {} },
      DESIGN,
    );
    expect(plain).not.toContain("data-lg-maps");
  });

  it("non-address/ZIP components never carry data-lg-maps", () => {
    for (const type of ["FreeTextQuestion", "ButtonAnswerGroup", "ContinueButton"] as const) {
      expect(renderComponent(NODE_SPECS[type], DESIGN), type).not.toContain("data-lg-maps");
    }
  });
});

// ---------------------------------------------------------------------------
// v2.4 06 §6.4 (B9) — Other-group markup on choice components with
// choiceDisplay.otherGroupEnabled. Attributes/markup appear ONLY with the
// metadata (no existing content has it → no visual change by construction).
// ---------------------------------------------------------------------------

describe("v2.4 §6.4 (B9) — Other-group render (choiceDisplay)", () => {
  const CARRIERS = [
    { label: "Acme", value: "acme", analytics_id: "c_acme" },
    { label: "Globex", value: "globex", analytics_id: "c_globex" },
    { label: "Initech", value: "initech", analytics_id: "c_initech" },
  ];
  const withDisplay = (extra?: Record<string, unknown>): LeadgenComponentNode =>
    ({
      type: "ButtonAnswerGroup",
      question_id: "q_carrier",
      internal_field: "carrier",
      choices: CARRIERS,
      choiceDisplay: {
        mainValues: ["acme"],
        otherGroupEnabled: true,
        otherGroupLabel: "Other carrier",
        searchableOther: true,
        ...extra,
      },
    }) as LeadgenComponentNode;

  it("renders main values as normal choices + ONE Other trigger + a hidden panel of secondary REAL values", () => {
    const html = renderComponent(withDisplay(), DESIGN);
    // main choice renders as a normal selectable choice…
    expect(html).toContain('data-lg-choice="acme"');
    // …the trigger exists, labelled, expandable, and NEVER a choice itself…
    expect(html).toContain("data-lg-other-trigger");
    expect(html).toContain("Other carrier");
    expect(html).toContain('aria-expanded="false"');
    const triggerTag = html.match(/<button[^>]*data-lg-other-trigger[^>]*>/)?.[0] ?? "";
    expect(triggerTag).not.toBe("");
    expect(triggerTag).not.toContain("data-lg-choice");
    expect(triggerTag).not.toContain("data-value");
    // …the panel is hidden and carries the secondary REAL values.
    expect(html).toContain("data-lg-other-panel");
    expect(html).toMatch(/data-lg-other-panel hidden/);
    expect(html).toContain('data-lg-choice="globex"');
    expect(html).toContain('data-lg-choice="initech"');
    // the literal string "Other" is never a stored value.
    expect(html).not.toContain('data-lg-choice="Other');
    expect(html).not.toContain('data-value="Other');
  });

  it("searchableOther adds the panel search input; searchableOther:false omits it", () => {
    expect(renderComponent(withDisplay(), DESIGN)).toContain("data-lg-other-search");
    expect(renderComponent(withDisplay({ searchableOther: false }), DESIGN)).not.toContain("data-lg-other-search");
  });

  it("card grids + multi-choice render the Other group in their own affordance", () => {
    const icon = renderComponent(
      {
        type: "IconCardAnswerGrid",
        question_id: "q_biz",
        internal_field: "biz",
        choices: CARRIERS.map((c) => ({ ...c, icon: "B" })),
        choiceDisplay: { mainValues: ["acme"], otherGroupEnabled: true, otherGroupLabel: "More", searchableOther: false },
      } as LeadgenComponentNode,
      DESIGN,
    );
    expect(icon).toContain("data-lg-other-trigger");
    expect(icon).toContain("data-lg-other-panel");
    expect(icon).toContain('data-lg-choice="globex"');
    const multi = renderComponent(
      {
        type: "MultiChoiceCardGroup",
        question_id: "q_feat",
        internal_field: "features",
        choices: CARRIERS,
        choiceDisplay: { mainValues: ["acme", "globex"], otherGroupEnabled: true, otherGroupLabel: "Other", searchableOther: false },
      } as LeadgenComponentNode,
      DESIGN,
    );
    expect(multi).toContain("data-lg-other-trigger");
    expect(multi).toContain('data-lg-choice="initech"');
  });

  it("WITHOUT choiceDisplay the markup carries no Other-group artifacts (no visual change)", () => {
    const html = renderComponent(NODE_SPECS.ButtonAnswerGroup, DESIGN);
    expect(html).not.toContain("data-lg-other-trigger");
    expect(html).not.toContain("data-lg-other-panel");
    expect(html).not.toContain("lg-other-");
  });

  it("otherGroupEnabled:false renders flat (metadata present but grouping off)", () => {
    const html = renderComponent(withDisplay({ otherGroupEnabled: false }), DESIGN);
    expect(html).not.toContain("data-lg-other-trigger");
    expect(html).toContain('data-lg-choice="globex"'); // all values flat
  });

  it("escapes a hostile otherGroupLabel (never live markup)", () => {
    const html = renderComponent(
      withDisplay({ otherGroupLabel: `<script>alert(1)</script>` }),
      DESIGN,
    );
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;");
  });

  it("dropdown with choiceDisplay renders ALL values as flat real-value options (panel UX arrives with the Phase-2 preset)", () => {
    const html = renderComponent(
      {
        type: "DropdownQuestion",
        question_id: "q_dd",
        internal_field: "insurer",
        choices: CARRIERS,
        choiceDisplay: { mainValues: ["acme"], otherGroupEnabled: true, otherGroupLabel: "Other", searchableOther: true },
      } as LeadgenComponentNode,
      DESIGN,
    );
    expect(html).not.toContain("data-lg-other-trigger");
    for (const c of CARRIERS) expect(html).toContain(`data-lg-choice="${c.value}"`);
    expect(html).not.toContain('value="Other"');
  });
});
