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
  flattenComponents,
  LEADGEN_CONTAINER_TYPES,
} from "../src/public/leadgen/components/content-schema";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import {
  renderComponent,
  renderSectionComponents,
  renderSectionComponentsVisible,
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

  it("MAJOR-1: rejects HTML-attribute breakout quotes in a curated override (\" ' ` §14.10 no-CSS-escape)", () => {
    // The proven stored-XSS payload: a `"` that terminates the inline style="…"
    // attribute + a paren-free tagged-template onfocus handler. Pre-fix this
    // validated ok:true and rendered a real `autofocus onfocus` on the funnel.
    const proven = 'red" autofocus onfocus="alert`1`';
    for (const value of [proven, "x' onmouseover='y", "a`b`c"]) {
      const c = {
        components: [
          { type: "ContinueButton", question_id: "c1", design_overrides: { buttonText: value } },
        ],
      };
      expect(codes(c), value).toContain("arbitrary_css_override");
    }
  });

  it("accepts every curated override key with token values", () => {
    // v3.1 §7.2: `size` is the one object-shaped curated key. v3.1 §8.5b
    // (Phase C): `corners`/`border_color` are plain enum-scalar keys with
    // their OWN small vocabularies (sharp/rounded/pill;
    // neutral/brand/accent) — NOT the general color-role/hex vocabulary the
    // other scalar keys accept, so they need their own valid representative
    // value here too.
    const overrides: Record<string, string | number | { width: string }> = {};
    for (const k of CURATED_DESIGN_OVERRIDE_KEYS) {
      overrides[k] =
        k === "columns" ? 3
        : k === "size" ? { width: "full" }
        : k === "corners" ? "rounded"
        : k === "border_color" ? "neutral"
        : "#1B3A5C";
    }
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
// v2.5 §8.4: image_alt is REQUIRED alongside imageMediaId on ImageCardAnswerGrid
// — the minimal-VALID fixture must carry it.
const IMAGE_CHOICES = CHOICES.map((c) => ({ ...c, imageMediaId: "media_123", image_alt: `${c.label} logo` }));

// A minimal VALID node per catalog type (covers required fields). The count
// guard below asserts this map stays in lockstep with the catalog.
const NODE_SPECS: Record<ComponentType, LeadgenComponentNode> = {
  ProgressBar: { type: "ProgressBar", question_id: "q", props: { mode: "percent", percent: 50 } },
  HeaderLogo: { type: "HeaderLogo", question_id: "q", props: { logoMediaId: "m1", siteName: "Acme", accent: "Quotes" } },
  BackButton: { type: "BackButton", question_id: "q", props: { label: "Back" } },
  DisclosureLink: { type: "DisclosureLink", question_id: "q", props: { panelHtml: "Legal blurb" } },
  StepIndicator: { type: "StepIndicator", question_id: "q", props: { steps: 4, current: 2 } },
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
  SearchableDropdownQuestion: { type: "SearchableDropdownQuestion", question_id: "q", internal_field: "make", choices: CHOICES, props: { placeholder: "Pick one" } },
  OtherGroupSelector: { type: "OtherGroupSelector", question_id: "q", internal_field: "carrier", choices: CHOICES, choiceDisplay: { mainValues: ["sole_prop"], otherGroupEnabled: true, otherGroupLabel: "Other", searchableOther: false } },
  FreeTextQuestion: { type: "FreeTextQuestion", question_id: "q", internal_field: "note", props: { placeholder: "Type…", maxLen: 100 } },
  NumberInputQuestion: { type: "NumberInputQuestion", question_id: "q", internal_field: "age", props: { min: 18, max: 99, step: 1, placeholder: "Your age" } },
  CurrencyInputQuestion: { type: "CurrencyInputQuestion", question_id: "q", internal_field: "income", props: { currency: "$", min: 0, max: 1000000, placeholder: "Annual income" } },
  EmailInputQuestion: { type: "EmailInputQuestion", question_id: "q", internal_field: "email", required: true },
  PhoneInputQuestion: { type: "PhoneInputQuestion", question_id: "q", internal_field: "phone" },
  NameFieldsGroup: { type: "NameFieldsGroup", question_id: "q", required: true },
  DateQuestion: { type: "DateQuestion", question_id: "q", internal_field: "dob", props: { min: "1900-01-01" } },
  ZIPInputQuestion: { type: "ZIPInputQuestion", question_id: "q", internal_field: "zip", props: { validate: true } },
  AddressAutocompleteQuestion: { type: "AddressAutocompleteQuestion", question_id: "q", props: { provider: "google" } },
  ContinueButton: { type: "ContinueButton", question_id: "q", props: { label: "Continue", loadingLabel: "Loading…" } },
  AutoAdvanceButton: { type: "AutoAdvanceButton", question_id: "q", props: { label: "Next" } },
  ReassuranceBadge: { type: "ReassuranceBadge", question_id: "q", props: { text: "Get your offers in 2 minutes or less." } },
  SuccessState: { type: "SuccessState", question_id: "q", props: { heading: "All set", message: "We found offers for you.", icon: "✓" } },
  SecureFormBadge: { type: "SecureFormBadge", question_id: "q", props: { text: "256-bit SSL encrypted" } },
  TrustBar: { type: "TrustBar", question_id: "q", props: { items: [{ icon: "🔒", text: "SSL secured" }, { icon: "★", text: "4.8 rating" }], layout: "horizontal" } },
  LogoStrip: { type: "LogoStrip", question_id: "q", props: { logos: [{ mediaId: "media_1", alt: "Acme" }, { mediaId: "media_2", alt: "Globex" }] } },
  HelperText: { type: "HelperText", question_id: "q", props: { text: "We never share this." } },
  ValidationError: { type: "ValidationError", question_id: "q", props: { text: "Required" } },
  LegalNote: { type: "LegalNote", question_id: "q", props: { html: "Terms apply" } },
  // §8.5 layout containers (children-bearing: each spec nests a real question
  // so the lockstep render proves recursion) + prop-driven layout leaves.
  Stack: {
    type: "Stack", question_id: "q", props: { direction: "vertical", gap: "m", align: "stretch" },
    children: [{ type: "FreeTextQuestion", question_id: "q_in_stack", internal_field: "stack_note", props: { placeholder: "Type…" } }],
  },
  GridContainer: {
    type: "GridContainer", question_id: "q", props: { columnsDesktop: 3, columnsTablet: 2, columnsMobile: 1, gap: "s", sizing: "equal" },
    children: [{ type: "FreeTextQuestion", question_id: "q_in_grid", internal_field: "grid_note" }],
  },
  Columns: {
    type: "Columns", question_id: "q", props: { ratio: "60/40", mobile: "stack" },
    children: [{ type: "FreeTextQuestion", question_id: "q_in_columns", internal_field: "columns_note" }],
  },
  CardPanel: {
    type: "CardPanel", question_id: "q", props: { width: "m", background: "card", shadow: "md", radius: "lg", padding: "m" },
    children: [{ type: "FreeTextQuestion", question_id: "q_in_panel", internal_field: "panel_note" }],
  },
  BackgroundPanel: {
    type: "BackgroundPanel", question_id: "q", props: { gradient: "primary" },
    children: [{ type: "FreeTextQuestion", question_id: "q_in_bg", internal_field: "bg_note" }],
  },
  Spacer: { type: "Spacer", question_id: "q", props: { size: "l" } },
  HeaderBar: { type: "HeaderBar", question_id: "q", props: { logoMediaId: "media_logo", logoAlt: "Acme", back: true, secure: true, cta: { label: "Call now", tel: "+1 800 555 1212" } } },
  FooterBar: { type: "FooterBar", question_id: "q", props: { legalHtml: "Terms apply", trustMessages: ["SSL secured"], links: [{ label: "Privacy", href: "/privacy" }] } },
  // v3.1 05 §5.3 Text/Image primitives (conductor fix round — catalog lockstep).
  TextBlock: { type: "TextBlock", question_id: "q", props: { role: "heading", text: "How much?" } },
  ImageBlock: { type: "ImageBlock", question_id: "q", props: { source: "auto_logo", siteName: "Acme" } },
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
  // 08 §8.3/§8.10 Slice A: the new input/choice presets follow the same
  // class-driven discipline (.lg-input / .lg-btn.lg-btn-answer base so
  // :focus/[aria-invalid]/selected states cascade)…
  "NumberInputQuestion",
  "CurrencyInputQuestion",
  "SearchableDropdownQuestion",
  "OtherGroupSelector",
  // …and the structural affordances/chrome are fully class-driven too
  // (layout via modifier class / [data-active] state — no per-instance value).
  "TrustBar",
  "LogoStrip",
  "StepIndicator",
  // §8.5 layout: Columns rides data-ratio/data-mobile variants; HeaderBar /
  // FooterBar are fully token-class-driven. (Stack/Grid/CardPanel/Background
  // Panel/Spacer DO emit per-instance token values inline — gap scale,
  // --lg-gc-cols-*, panel tokens, spacer height.)
  "Columns",
  "HeaderBar",
  "FooterBar",
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

  it("MAJOR-1 render-hardening: a hostile design_overrides value FORCED past validation cannot break out of the style attribute", () => {
    // Construct the node directly (bypassing validateSectionContent) so the
    // renderer alone is the defense. Pre-fix `style()` emitted the raw `"`,
    // closing style="…" and producing a live `autofocus onfocus="alert`…`"`.
    const html = renderComponent(
      { type: "ContinueButton", question_id: "c1", design_overrides: { buttonText: 'red" autofocus onfocus="alert`1`' } },
      DESIGN,
    );
    // the hostile `"` is entity-escaped, so it stays INSIDE the style value
    expect(html).toContain("&quot;");
    // and the style attribute is intact — its whole value is the escaped token
    expect(html).toMatch(/style="color:red&quot;[^"]*"/);
    // NO real breakout attribute is emitted (the `onfocus=`/`autofocus` text
    // survives only as inert characters inside the escaped style value)
    expect(html).not.toContain('onfocus="');
    const outsideStyle = html.replace(/style="[^"]*"/g, "");
    expect(outsideStyle).not.toContain("autofocus");
    expect(outsideStyle).not.toContain("onfocus");
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

  it("NO chrome/affordance/control/layout type carries data-lg-question (11 §11.6 probe counts questions only)", () => {
    for (const type of NON_QUESTION_TYPES) {
      // §8.5 containers: assert on the container's OWN markup (children-less
      // clone) — a QUESTION nested inside it legitimately carries the hook
      // and MUST keep it (the probe counts nested questions too; proven in
      // the layout-container render suite).
      const spec = NODE_SPECS[type];
      const node = spec.children !== undefined ? { ...spec, children: [] } : spec;
      const html = renderComponent(node, DESIGN);
      expect(html, type).not.toContain("data-lg-question");
    }
  });

  it("a question nested inside a container KEEPS its data-lg-question hook (§8.5 + §3.3)", () => {
    const html = renderComponent(NODE_SPECS.Stack, DESIGN);
    expect(html).toContain('data-lg-question="q_in_stack"');
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
// v3.1 §9.3 — the NEW {enabled,jobs} shape's per-field precedence over the
// legacy validate flag / legacy flat props.maps. Regression: before this
// phase's presets.ts fix, ANY object-shaped props.maps (new OR legacy) was
// treated as unconditionally Maps-enabled and passed through VERBATIM —
// jobs.validate was never consulted, so a field with maps.enabled:true but
// jobs.validate:false still rendered as validate-active.
// ---------------------------------------------------------------------------

describe("v3.1 §9.3 — Maps job-based precedence (NEW shape wins over legacy)", () => {
  function zipNode(props: Record<string, unknown>) {
    return { type: "ZIPInputQuestion" as const, question_id: "q_zip", internal_field: "zip", props };
  }
  function addressNode(props: Record<string, unknown>) {
    return { type: "AddressAutocompleteQuestion" as const, question_id: "q_addr", internal_field: "addr", props };
  }

  it("ZIP: jobs.validate=true → data-validate + data-lg-maps validate:true", () => {
    const html = renderComponent(
      zipNode({ maps: { enabled: true, jobs: { validate: true, auction: false, autocomplete: false } } }),
      DESIGN,
    );
    expect(html).toContain('data-validate="google"');
    expect(html).toContain("data-lg-maps=");
    expect(html).toContain("&quot;validate&quot;:true");
  });

  it("ZIP: jobs.validate=false → NO data-validate, even though maps.enabled is true (§9.3 regression)", () => {
    const html = renderComponent(
      zipNode({ maps: { enabled: true, jobs: { validate: false, auction: true, autocomplete: false } } }),
      DESIGN,
    );
    expect(html).not.toContain("data-validate=");
    expect(html).toContain("&quot;validate&quot;:false");
  });

  it("ZIP: maps.enabled=false → NO data-lg-maps at all, even with jobs.validate:true stored (per-field OFF wins)", () => {
    const html = renderComponent(
      zipNode({ maps: { enabled: false, jobs: { validate: true, auction: false, autocomplete: false } } }),
      DESIGN,
    );
    expect(html).not.toContain("data-lg-maps");
    expect(html).not.toContain("data-validate=");
  });

  it("ZIP: NEW shape's jobs.validate WINS over the legacy bare props.validate flag when both are present", () => {
    // per-field precedence (§9.3): the new authoring shape is authoritative —
    // a stale/unrelated legacy `validate` flag must NOT leak through.
    const html = renderComponent(
      zipNode({ validate: true, maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: false } } }),
      DESIGN,
    );
    expect(html).not.toContain("data-validate=");
  });

  it("ZIP: jobs.autocomplete=true → data-lg-maps carries enable_autocomplete:true (translated to the runtime's flat wire key)", () => {
    const html = renderComponent(
      zipNode({ maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: true } } }),
      DESIGN,
    );
    expect(html).toContain("&quot;enable_autocomplete&quot;:true");
  });

  it("Address: maps.enabled=false now actually turns Maps OFF (pre-v3.1 it was unconditional)", () => {
    const html = renderComponent(addressNode({ maps: { enabled: false, jobs: { validate: false, auction: false, autocomplete: false } } }), DESIGN);
    expect(html).not.toContain("data-lg-maps");
  });

  it("Address: maps.enabled=true, jobs.validate=true → data-lg-maps carries validate:true", () => {
    const html = renderComponent(addressNode({ maps: { enabled: true, jobs: { validate: true, auction: false, autocomplete: true } } }), DESIGN);
    expect(html).toContain("data-lg-maps=");
    expect(html).toContain("&quot;validate&quot;:true");
  });

  it("a legacy flat-shape props.maps (no .jobs key) still passes through VERBATIM on both types (§12 no-regression)", () => {
    const zipHtml = renderComponent(zipNode({ maps: { validate_zip: true } }), DESIGN);
    expect(zipHtml).toContain("data-lg-maps=");
    expect(zipHtml).toContain("validate_zip");
    const addrHtml = renderComponent(addressNode({ maps: { autofill_city: "city" } }), DESIGN);
    expect(addrHtml).toContain("autofill_city");
  });
});

// ---------------------------------------------------------------------------
// v3.1 §8.5b/§11.5/§12 (adversarial-review fix round, MAJOR-1) — Style tab
// Corners/Border-color render wiring: setNodeCorners/setNodeBorderColor
// (ui-section-studio.ts) persisted design_overrides.corners/.border_color
// and highlighted the segment active, but no renderer consumed them — a
// silent no-op with false "active" feedback. See also the real-HTTP §12
// 3-path parity proof in leadgen-v31-themes-size-parity.test.ts; these are
// the unit-level grounding + placement + defensive-guard checks.
// ---------------------------------------------------------------------------
describe("v3.1 §8.5b/§11.5/§12 — Style tab Corners/Border-color render wiring (fix-round MAJOR-1)", () => {
  function freeTextNode(designOverrides: Record<string, unknown>) {
    return {
      type: "FreeTextQuestion" as const,
      question_id: "q_ft",
      internal_field: "ft",
      design_overrides: designOverrides,
    };
  }
  function currencyNode(designOverrides: Record<string, unknown>) {
    return {
      type: "CurrencyInputQuestion" as const,
      question_id: "q_cur",
      internal_field: "cur",
      design_overrides: designOverrides,
    };
  }
  function addrAppearanceNode(designOverrides: Record<string, unknown>) {
    return {
      type: "AddressAutocompleteQuestion" as const,
      question_id: "q_addr2",
      internal_field: "addr2",
      design_overrides: designOverrides,
    };
  }

  it("corners:pill -> border-radius:20px (§3.3 pills/chips), corners:rounded -> 8px (§3.3 controls/inputs), corners:sharp -> 0 (inferred, flagged — no explicit contract px)", () => {
    expect(renderComponent(freeTextNode({ corners: "pill" }), DESIGN)).toContain('style="border-radius:20px"');
    expect(renderComponent(freeTextNode({ corners: "rounded" }), DESIGN)).toContain('style="border-radius:8px"');
    expect(renderComponent(freeTextNode({ corners: "sharp" }), DESIGN)).toContain('style="border-radius:0"');
  });

  it("border_color:brand/accent resolve to the ACTIVE design's OWN color.primary/color.accent tokens (never a fabricated hex); neutral resolves to color.border", () => {
    expect(renderComponent(freeTextNode({ border_color: "brand" }), DESIGN)).toContain(
      `style="--lg-field-border:${DESIGN.color.primary}"`,
    );
    expect(renderComponent(freeTextNode({ border_color: "accent" }), DESIGN)).toContain(
      `style="--lg-field-border:${DESIGN.color.accent}"`,
    );
    expect(renderComponent(freeTextNode({ border_color: "neutral" }), DESIGN)).toContain(
      `style="--lg-field-border:${DESIGN.color.border}"`,
    );
  });

  // Adversarial-review cascade-regression close-out: border_color rides the
  // --lg-field-border CUSTOM PROPERTY, never `border-color` directly. A
  // direct inline border-color would beat designs/default-funnel/styles.ts's
  // .lg-input:focus / .lg-input[aria-invalid="true"] rules by specificity
  // (inline always wins over a class/attribute selector without
  // !important), silently losing the focus/invalid border color. The full
  // live browser proof (computed style under :focus/[aria-invalid]) is in
  // test-ui/leadgen-section-studio.spec.ts; this is the render-output-shape
  // pin at the unit level.
  it("border_color NEVER emits a direct border-color on the field — only the --lg-field-border custom property (cascade-regression close-out)", () => {
    const html = renderComponent(freeTextNode({ border_color: "brand" }), DESIGN);
    // The closing `"` in this exact substring means the style attribute's
    // content is EXACTLY this value — a trailing ";border-color:…" would
    // break the match.
    expect(html).toContain(`style="--lg-field-border:${DESIGN.color.primary}"`);
  });

  it('both keys together merge into ONE style attribute (never two style="…" attributes on one tag)', () => {
    const html = renderComponent(freeTextNode({ corners: "pill", border_color: "brand" }), DESIGN);
    expect(html).toContain(`style="border-radius:20px;--lg-field-border:${DESIGN.color.primary}"`);
    expect(html.match(/style="/g)?.length).toBe(1);
  });

  it("REGRESSION — a node with NO corners/border_color renders NO style attribute at all (byte-identical to pre-fix output)", () => {
    const html = renderComponent(freeTextNode({}), DESIGN);
    expect(html).not.toContain("style=");
  });

  it("CurrencyInputQuestion — corners/border_color render on the INNER lg-input element (the .lg-currency wrapper has no border of its own in designs/default-funnel/styles.ts)", () => {
    const html = renderComponent(currencyNode({ corners: "pill", border_color: "accent" }), DESIGN);
    expect(html).not.toMatch(/<div class="lg-currency"[^>]*style=/);
    expect(html).toContain(
      `lg-currency-input" type="text" inputmode="numeric" data-lg-input style="border-radius:20px;--lg-field-border:${DESIGN.color.accent}"`,
    );
  });

  it("AddressAutocompleteQuestion — corners/border_color render on the INNER lg-input element, not the lg-address wrapper", () => {
    const html = renderComponent(addrAppearanceNode({ corners: "sharp", border_color: "neutral" }), DESIGN);
    expect(html).not.toMatch(/<div class="lg-address"[^>]*style=/);
    expect(html).toContain(
      `lg-address-input" type="text" data-lg-input style="border-radius:0;--lg-field-border:${DESIGN.color.border}"`,
    );
  });

  it("a stale/corrupt design_overrides.corners value outside sharp|rounded|pill is ignored defensively (no crash; that key alone emits nothing, the other key is unaffected)", () => {
    const html = renderComponent(freeTextNode({ corners: "square", border_color: "brand" }), DESIGN);
    expect(html).not.toContain("border-radius");
    expect(html).toContain(`style="--lg-field-border:${DESIGN.color.primary}"`);
  });

  it("the served .lg-input base rule reads border-color:var(--lg-field-border, color.border) while :focus/[aria-invalid] keep setting border-color DIRECTLY, unconditionally (funnelChromeCss structure pin)", () => {
    const chrome = funnelChromeCss(DESIGN);
    expect(chrome).toContain(`border-color:var(--lg-field-border, ${DESIGN.color.border})`);
    expect(chrome).toContain(`.lg-input:focus{outline:none;border-color:${DESIGN.input.focusBorderColor}}`);
    expect(chrome).toContain(`.lg-input[aria-invalid="true"]{border-color:${DESIGN.input.errorBorderColor}}`);
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

// ---------------------------------------------------------------------------
// v2.4 08 §8.3/§8.10 — Phase 4 Slice A leaf components: plain Number/Currency
// inputs (NOT Range variants), searchable dropdown, the dedicated B9
// OtherGroupSelector, success/trust affordances, and the step indicator.
// ---------------------------------------------------------------------------

describe("v2.4 08 §8.3/§8.10 — new leaf components", () => {
  it("NumberInputQuestion is a plain numeric text input (NOT a slider) with min/max/step data attrs", () => {
    const html = renderComponent(NODE_SPECS.NumberInputQuestion, DESIGN);
    expect(html).toContain('type="text"');
    expect(html).toContain('inputmode="numeric"');
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain('role="slider"');
    expect(html).toContain('data-min="18"');
    expect(html).toContain('data-max="99"');
    expect(html).toContain('data-step="1"');
    expect(html).toContain("data-lg-input");
    expect(html).toContain('aria-label="age"'); // label falls back to internal_field
    expect(html).toContain('data-answer-type="number"');
  });

  it("CurrencyInputQuestion renders the currency prefix + numeric input (default $, author currency honored)", () => {
    const html = renderComponent(NODE_SPECS.CurrencyInputQuestion, DESIGN);
    expect(html).toContain('class="lg-currency-prefix" aria-hidden="true">$</span>');
    expect(html).toContain('inputmode="numeric"');
    expect(html).toContain("data-lg-input");
    expect(html).toContain('data-min="0"');
    expect(html).toContain('data-max="1000000"');
    expect(html).not.toContain('role="slider"'); // plain input, NOT the Range variant
    expect(html).toContain('data-answer-type="currency"');
    const eur = renderComponent(
      { type: "CurrencyInputQuestion", question_id: "q", internal_field: "income", props: { currency: "€" } },
      DESIGN,
    );
    expect(eur).toContain(">€</span>");
    // prefix alignment lives in the scoped chrome CSS (no inline style).
    const chrome = funnelChromeCss(DESIGN);
    expect(chrome).toContain(".lg-currency{position:relative}");
    expect(chrome).toContain(".lg-currency-prefix{");
    expect(chrome).toContain(".lg-currency-input{padding-left:");
  });

  it("SearchableDropdownQuestion = search input above a REAL select with the DropdownQuestion option shape", () => {
    const html = renderComponent(NODE_SPECS.SearchableDropdownQuestion, DESIGN);
    expect(html).toContain("data-lg-searchable");
    expect(html).toContain("data-lg-dropdown-search");
    expect(html).toContain('aria-label="Search options"');
    expect(html).toContain('<select class="lg-input lg-dropdown">');
    expect(html).toContain('data-lg-choice="sole_prop"');
    expect(html).toContain('data-lg-choice="partnership"');
    expect(html).toContain('data-analytics-id="biz_sole"');
    expect(html).toContain(">Pick one</option>"); // placeholder option
    // hydration attrs only — the runtime filters client-side; no script here.
    expect(html).not.toContain("<script");
  });

  it("OtherGroupSelector renders main choices as answer buttons + the Other trigger + hidden panel of REAL secondary values", () => {
    const html = renderComponent(NODE_SPECS.OtherGroupSelector, DESIGN);
    expect(html).toContain('class="lg-btn lg-btn-answer"'); // the answer-button affordance
    expect(html).toContain('data-lg-choice="sole_prop"'); // main value stays a normal choice
    expect(html).toContain("data-lg-other-trigger");
    expect(html).toMatch(/data-lg-other-panel hidden/);
    expect(html).toContain('data-lg-choice="partnership"'); // secondary REAL value in the panel
    const triggerTag = html.match(/<button[^>]*data-lg-other-trigger[^>]*>/)?.[0] ?? "";
    expect(triggerTag).not.toBe("");
    expect(triggerTag).not.toContain("data-value"); // the trigger itself is never a choice
    expect(html).not.toContain('data-lg-choice="Other');
    // defensive flat fallback without grouping metadata.
    const flat = renderComponent(
      { type: "OtherGroupSelector", question_id: "q", internal_field: "carrier", choices: CHOICES },
      DESIGN,
    );
    expect(flat).not.toContain("data-lg-other-trigger");
    expect(flat).toContain('data-lg-choice="partnership"');
  });

  it("SuccessState renders icon + heading + message in the success-green family; role=status", () => {
    const html = renderComponent(NODE_SPECS.SuccessState, DESIGN);
    expect(html).toContain('role="status"');
    expect(html).toContain("All set");
    expect(html).toContain("We found offers for you.");
    expect(html).toContain("#0E7C3A"); // success-green outline/icon tokens
    // heading/message are optional — absent props emit no empty nodes.
    const bare = renderComponent({ type: "SuccessState", question_id: "q" }, DESIGN);
    expect(bare).not.toContain("lg-success-heading");
    expect(bare).not.toContain("lg-success-message");
    expect(bare).toContain("lg-success-icon"); // default check icon still renders
  });

  it("SecureFormBadge renders icon + text (token exampleCopy fallback)", () => {
    const html = renderComponent(NODE_SPECS.SecureFormBadge, DESIGN);
    expect(html).toContain("lg-secure-badge");
    expect(html).toContain("256-bit SSL encrypted");
    const fallback = renderComponent({ type: "SecureFormBadge", question_id: "q" }, DESIGN);
    expect(fallback).toContain(DESIGN.secureFormBadge.exampleCopy);
  });

  it("TrustBar renders structured icon/text items; layout=stacked adds the modifier class; junk rows are skipped", () => {
    const html = renderComponent(NODE_SPECS.TrustBar, DESIGN);
    expect(html).toContain('class="lg-trustbar"');
    expect(html).toContain("SSL secured");
    expect(html).toContain("4.8 rating");
    expect(html.split("lg-trustbar-item").length - 1).toBe(2);
    expect(html).not.toContain("lg-trustbar-stacked");
    const stacked = renderComponent(
      { type: "TrustBar", question_id: "q", props: { items: [{ icon: "✓", text: "A" }], layout: "stacked" } },
      DESIGN,
    );
    expect(stacked).toContain('class="lg-trustbar lg-trustbar-stacked"');
    const junk = renderComponent(
      { type: "TrustBar", question_id: "q", props: { items: [null, "x", { icon: 5 }, { text: "ok" }] } } as LeadgenComponentNode,
      DESIGN,
    );
    expect(junk.split("lg-trustbar-item").length - 1).toBe(1);
    expect(junk).toContain("ok");
  });

  it("LogoStrip renders an img per logo with alt text (mediaId → src, the ImageCard idiom); rows without mediaId are skipped", () => {
    const html = renderComponent(NODE_SPECS.LogoStrip, DESIGN);
    expect(html).toContain('class="lg-logo-strip"');
    expect(html.split("<img").length - 1).toBe(2);
    expect(html).toContain('src="media_1"');
    expect(html).toContain('alt="Acme"');
    expect(html).toContain('loading="lazy"');
    const junk = renderComponent(
      { type: "LogoStrip", question_id: "q", props: { logos: [{ alt: "no-src" }, { mediaId: "m9" }] } } as LeadgenComponentNode,
      DESIGN,
    );
    expect(junk.split("<img").length - 1).toBe(1);
    expect(junk).toContain('src="m9"');
    expect(junk).toContain('alt=""');
  });

  it("StepIndicator renders a dot per step, marks the current one, and exposes progressbar a11y", () => {
    const html = renderComponent(NODE_SPECS.StepIndicator, DESIGN);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuemin="1"');
    expect(html).toContain('aria-valuemax="4"');
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain('aria-valuetext="Step 2 of 4"');
    expect(html.split('class="lg-step"').length - 1).toBe(4);
    expect(html.split('data-active="true"').length - 1).toBe(1);
    // current clamps into 1..steps (defensive).
    const clamped = renderComponent(
      { type: "StepIndicator", question_id: "q", props: { steps: 3, current: 9 } },
      DESIGN,
    );
    expect(clamped).toContain('aria-valuenow="3"');
    // the active-dot state lives in the scoped chrome CSS.
    const chrome = funnelChromeCss(DESIGN);
    expect(chrome).toContain('.lg-step[data-active="true"]');
  });
});

// ---------------------------------------------------------------------------
// §8.5 layout containers (E4) — validation: depth cap, children placement,
// answer-field ban, tree-wide uniqueness, token-enum props, legacy compat.
// ---------------------------------------------------------------------------

const q = (id: string, field: string): LeadgenComponentNode => ({
  type: "FreeTextQuestion",
  question_id: id,
  internal_field: field,
});

const stack = (id: string, children: LeadgenComponentNode[]): LeadgenComponentNode => ({
  type: "Stack",
  question_id: id,
  children,
});

describe("validateSectionContent — §8.5 layout containers", () => {
  it("accepts a nested tree (CardPanel › Stack › questions) with container props", () => {
    const content = {
      components: [
        {
          type: "CardPanel",
          question_id: "panel",
          container_id: "c_panel",
          props: { width: "m", background: "card", shadow: "md", radius: "lg", padding: "m" },
          children: [
            { type: "QuestionHeadline", question_id: "h1", props: { text: "Are you insured?" } },
            stack("stk", [
              {
                type: "TwoButtonYesNo",
                question_id: "q_ins",
                internal_field: "currently_insured",
                answer_type: "boolean",
              },
            ]),
          ],
        },
        { type: "ContinueButton", question_id: "cont", props: { label: "Continue" } },
      ],
    };
    const result = validateSectionContent(content);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects container nesting deeper than 4 (depth-5 → container_depth_exceeded)", () => {
    const five = stack("s1", [stack("s2", [stack("s3", [stack("s4", [stack("s5", [q("qq", "f")])])])])]);
    const result = validateSectionContent({ components: [five] });
    expect(result.errors.map((e) => e.code)).toContain("container_depth_exceeded");
    // the offending path names the depth-5 container
    const err = result.errors.find((e) => e.code === "container_depth_exceeded");
    expect(err?.path).toBe("components[0].children[0].children[0].children[0].children[0]");
  });

  it("accepts 4 nested containers with a leaf question inside the deepest", () => {
    const four = stack("s1", [stack("s2", [stack("s3", [stack("s4", [q("qq", "f")])])])]);
    expect(validateSectionContent({ components: [four] }).errors).toEqual([]);
  });

  it("rejects children on a non-container type (children_not_allowed)", () => {
    const content = {
      components: [
        { ...q("q1", "f1"), children: [q("q2", "f2")] },
      ],
    };
    const codes2 = validateSectionContent(content).errors.map((e) => e.code);
    expect(codes2).toContain("children_not_allowed");
  });

  it("rejects answer fields on a container (internal_field / choices / answer_type)", () => {
    const content = {
      components: [
        {
          type: "Stack",
          question_id: "s",
          internal_field: "nope",
          answer_type: "string",
          choices: [{ label: "A", value: "a", analytics_id: "a" }],
          children: [q("q1", "f1")],
        },
      ],
    };
    const errs = validateSectionContent(content).errors;
    const paths = errs.filter((e) => e.code === "container_answer_field_forbidden").map((e) => e.path);
    expect(paths).toContain("components[0].internal_field");
    expect(paths).toContain("components[0].choices");
    expect(paths).toContain("components[0].answer_type");
  });

  it("enforces question_id / internal_field uniqueness ACROSS the tree (cross-level duplicates)", () => {
    const dupField = {
      components: [q("top", "shared_field"), stack("s", [q("nested", "shared_field")])],
    };
    const fieldErrs = validateSectionContent(dupField).errors;
    const dup = fieldErrs.find((e) => e.code === "duplicate_internal_field");
    expect(dup?.path).toBe("components[1].children[0].internal_field");

    const dupId = {
      components: [q("same_id", "f1"), stack("s", [q("same_id", "f2")])],
    };
    expect(validateSectionContent(dupId).errors.map((e) => e.code)).toContain("duplicate_question_id");

    // containers' OWN question_ids join the uniqueness universe too
    const dupContainerId = {
      components: [q("clash", "f1"), stack("clash", [q("nested", "f2")])],
    };
    expect(validateSectionContent(dupContainerId).errors.map((e) => e.code)).toContain(
      "duplicate_question_id",
    );
  });

  it("scopes internal_field uniqueness to ANSWER-PRODUCING types: a ValidationError/HelperText may REFERENCE a question's field (§8.13 error-slot binding)", () => {
    // The P1-seed idiom (leadgen-fix-p1-seed.ts): a required ZIP question +
    // a ValidationError affordance carrying the SAME internal_field as its
    // data-lg-error-for binding. produces===null nodes never claim the
    // answer name — this section must validate clean and stay re-savable.
    const referencing = {
      components: [
        {
          type: "ZIPInputQuestion",
          question_id: "q_zip",
          internal_field: "zip",
          answer_type: "string",
          required: true,
          props: { placeholder: "ZIP code" },
        },
        { type: "ValidationError", question_id: "zip_err", internal_field: "zip" },
        { type: "HelperText", question_id: "zip_help", internal_field: "zip", props: { text: "5 digits" } },
      ],
    };
    const result = validateSectionContent(referencing);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);

    // two ANSWER-PRODUCING components sharing one internal_field still reject
    const twoQuestions = {
      components: [q("q1", "zip"), q("q2", "zip")],
    };
    const errs = validateSectionContent(twoQuestions).errors;
    const dup = errs.find((e) => e.code === "duplicate_internal_field");
    expect(dup?.path).toBe("components[1].internal_field");

    // and a non-producing node's reference does NOT reserve the name for a
    // LATER question either (order independence of the reference exemption)
    const referenceFirst = {
      components: [
        { type: "ValidationError", question_id: "err_first", internal_field: "zip" },
        q("q_real", "zip"),
      ],
    };
    expect(validateSectionContent(referenceFirst).errors).toEqual([]);
  });

  it("a nested conditional resolves a field defined in a SIBLING container", () => {
    const content = {
      components: [
        stack("s1", [
          {
            type: "TwoButtonYesNo",
            question_id: "q_ins",
            internal_field: "currently_insured",
            answer_type: "boolean",
          },
        ]),
        stack("s2", [
          {
            type: "DropdownQuestion",
            question_id: "q_insurer",
            internal_field: "insurer",
            choices: [{ label: "Acme", value: "acme", analytics_id: "a" }],
            conditional: { when: "currently_insured", op: "eq", value: true },
          },
        ]),
      ],
    };
    expect(validateSectionContent(content).errors).toEqual([]);
  });

  it("rejects container prop token-enum violations (container_prop_invalid, per prop path)", () => {
    const content = {
      components: [
        { type: "Stack", question_id: "s", props: { direction: "diagonal", gap: "xxl", align: "middle" }, children: [q("q1", "f1")] },
        { type: "GridContainer", question_id: "g", props: { columnsDesktop: 7, columnsMobile: 0, sizing: "masonry" }, children: [q("q2", "f2")] },
        { type: "Columns", question_id: "c", props: { ratio: "80/20", mobile: "float" }, children: [q("q3", "f3")] },
        { type: "CardPanel", question_id: "p", props: { width: "xxl", background: "#ff00ff", shadow: "mega", radius: "pill", padding: "tight" }, children: [q("q4", "f4")] },
        { type: "BackgroundPanel", question_id: "b", props: { background: "hotpink", gradient: "rainbow" }, children: [q("q5", "f5")] },
        { type: "Spacer", question_id: "sp", props: { size: "huge" } },
        { type: "HeaderBar", question_id: "hb", props: { cta: { label: "Call", href: "javascript:alert(1)" } } },
        { type: "FooterBar", question_id: "fb", props: { trustMessages: [42], links: [{ label: "Privacy" }] } },
      ],
    };
    const errs = validateSectionContent(content).errors.filter((e) => e.code === "container_prop_invalid");
    const paths = errs.map((e) => e.path);
    expect(paths).toContain("components[0].props.direction");
    expect(paths).toContain("components[0].props.gap");
    expect(paths).toContain("components[0].props.align");
    expect(paths).toContain("components[1].props.columnsDesktop");
    expect(paths).toContain("components[1].props.columnsMobile");
    expect(paths).toContain("components[1].props.sizing");
    expect(paths).toContain("components[2].props.ratio");
    expect(paths).toContain("components[2].props.mobile");
    expect(paths).toContain("components[3].props.width");
    expect(paths).toContain("components[3].props.background");
    expect(paths).toContain("components[3].props.shadow");
    expect(paths).toContain("components[3].props.radius");
    expect(paths).toContain("components[3].props.padding");
    expect(paths).toContain("components[4].props.background");
    expect(paths).toContain("components[4].props.gradient");
    expect(paths).toContain("components[5].props.size");
    expect(paths).toContain("components[7].props.trustMessages");
    expect(paths).toContain("components[7].props.links[0].href");
    // unsafe cta scheme is rejected
    expect(paths).toContain("components[6].props.cta.href");
  });

  it("validates nested nodes with the SAME per-node rules (paths follow children[j])", () => {
    const content = {
      components: [
        stack("s", [
          { type: "IconCardAnswerGrid", question_id: "g", internal_field: "biz", choices: [{ label: "LLC", value: "llc" }] } as unknown as LeadgenComponentNode,
        ]),
      ],
    };
    const errs = validateSectionContent(content).errors;
    const paths = errs.map((e) => e.path);
    expect(paths).toContain("components[0].children[0].choices[0].analytics_id");
    expect(paths).toContain("components[0].children[0].choices[0].icon");
  });
});

// ---------------------------------------------------------------------------
// §8.13 legacy compat — a flat array IS the degenerate tree: zero containers,
// zero validation errors, and a render byte-identical to the flat per-node
// concatenation (the pre-§8.5 renderSectionComponents definition).
// ---------------------------------------------------------------------------

describe("§8.13 legacy compat — flat arrays validate + render byte-identically", () => {
  // A pre-P4 fixture: the §13.2 dependent-flow Section exactly as stored today.
  const LEGACY_FLAT: LeadgenComponentNode[] = [
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
      internal_field: "insurer",
      answer_type: "enum",
      choices: [
        { label: "Acme", value: "acme", analytics_id: "ins_acme" },
        { label: "Globex", value: "globex", analytics_id: "ins_globex" },
      ],
      conditional: { when: "currently_insured", op: "eq", value: true },
    },
    { type: "ContinueButton", question_id: "cont1", props: { label: "Continue" } },
  ];

  it("validates with zero errors", () => {
    expect(validateSectionContent({ components: LEGACY_FLAT }).errors).toEqual([]);
  });

  it("flattenComponents is the identity on flat content (same nodes, same order)", () => {
    const flat = flattenComponents(LEGACY_FLAT);
    expect(flat.length).toBe(LEGACY_FLAT.length);
    for (let i = 0; i < flat.length; i++) expect(flat[i]).toBe(LEGACY_FLAT[i]);
  });

  it("renderSectionComponents output is byte-identical to the flat per-node render", () => {
    const treeRender = renderSectionComponents(LEGACY_FLAT, DESIGN);
    const flatRender = LEGACY_FLAT.map((n) => renderComponent(n, DESIGN)).join("");
    expect(treeRender).toBe(flatRender);
    expect(treeRender.length).toBeGreaterThan(0);
  });

  it("serialization round-trip preserves a container tree (parse → validate → stringify → parse)", () => {
    const content = {
      components: [
        {
          type: "CardPanel",
          question_id: "panel",
          container_id: "c1",
          props: { width: "m" },
          children: [
            stack("stk", [
              { type: "TwoButtonYesNo", question_id: "q_ins", internal_field: "ins", answer_type: "boolean" },
            ]),
          ],
        },
      ],
    };
    expect(validateSectionContent(content).ok).toBe(true);
    const rt = JSON.parse(JSON.stringify(content)) as typeof content;
    expect(rt).toEqual(content);
    expect(validateSectionContent(rt).ok).toBe(true);
    // children + container_id survive the round trip verbatim
    expect(rt.components[0]?.children?.[0]?.children?.[0]?.question_id).toBe("q_ins");
    expect(rt.components[0]?.container_id).toBe("c1");
  });
});

// ---------------------------------------------------------------------------
// §8.5 layout containers — render: recursion, depth guard, token mapping,
// leaves, and the dependency-filtered tree render.
// ---------------------------------------------------------------------------

describe("layout containers — render recursion + §8.5 token mapping", () => {
  it("a container renders its nested question markup INSIDE the wrapper", () => {
    const html = renderComponent(NODE_SPECS.Stack, DESIGN);
    const open = html.indexOf('<div class="lg-stack"');
    const child = html.indexOf('data-component-type="FreeTextQuestion"');
    const close = html.lastIndexOf("</div>");
    expect(open).toBe(0);
    expect(child).toBeGreaterThan(open);
    expect(child).toBeLessThan(close);
    expect(html).toContain('data-internal-field="stack_note"');
  });

  it("Stack: data-direction/data-align + gap token value inline", () => {
    const html = renderComponent(NODE_SPECS.Stack, DESIGN);
    expect(html).toContain('data-direction="vertical"');
    expect(html).toContain('data-align="stretch"');
    expect(html).toContain("gap:1rem"); // gap token m → spacing.md
    const horizontal = renderComponent(
      { type: "Stack", question_id: "s", props: { direction: "horizontal", gap: "xl", align: "center" }, children: [] },
      DESIGN,
    );
    expect(horizontal).toContain('data-direction="horizontal"');
    expect(horizontal).toContain('data-align="center"');
    expect(horizontal).toContain("gap:2rem");
  });

  it("GridContainer: per-breakpoint --lg-gc-cols-* custom props (clamped) + sizing", () => {
    const html = renderComponent(NODE_SPECS.GridContainer, DESIGN);
    expect(html).toContain("--lg-gc-cols-d:3");
    expect(html).toContain("--lg-gc-cols-t:2");
    expect(html).toContain("--lg-gc-cols-m:1");
    expect(html).toContain('data-sizing="equal"');
    const clamped = renderComponent(
      { type: "GridContainer", question_id: "g", props: { columnsDesktop: 9, columnsTablet: 9, columnsMobile: 9, sizing: "auto" }, children: [] },
      DESIGN,
    );
    expect(clamped).toContain("--lg-gc-cols-d:5");
    expect(clamped).toContain("--lg-gc-cols-t:4");
    expect(clamped).toContain("--lg-gc-cols-m:2");
    expect(clamped).toContain('data-sizing="auto"');
  });

  it("Columns: data-ratio + data-mobile, no inline style (fully class-driven)", () => {
    const html = renderComponent(NODE_SPECS.Columns, DESIGN);
    expect(html).toContain('data-ratio="60/40"');
    expect(html).toContain('data-mobile="stack"');
    expect(html).not.toContain('style="');
    // unknown ratio falls to 50/50; mobile keep is honored
    const fallback = renderComponent(
      { type: "Columns", question_id: "c", props: { ratio: "99/1", mobile: "keep" }, children: [] } as LeadgenComponentNode,
      DESIGN,
    );
    expect(fallback).toContain('data-ratio="50/50"');
    expect(fallback).toContain('data-mobile="keep"');
  });

  it("CardPanel: §8.5 token enums resolve to measured design values", () => {
    const html = renderComponent(NODE_SPECS.CardPanel, DESIGN);
    expect(html).toContain('data-width="m"');
    expect(html).toContain("max-width:420px"); // width m
    expect(html).toContain("background:#FFFFFF"); // background card
    expect(html).toContain("box-shadow:0 4px 8px rgba(27,58,92,.06)"); // shadow md
    expect(html).toContain("border-radius:14px"); // radius lg
    expect(html).toContain("padding:24px 20px"); // padding m
    const washed = renderComponent(
      { type: "CardPanel", question_id: "p", props: { width: "s", background: "wash", shadow: "none", radius: "xl", padding: "l" }, children: [] },
      DESIGN,
    );
    expect(washed).toContain("max-width:320px");
    expect(washed).toContain("background:#E8EEF4");
    expect(washed).toContain("box-shadow:none");
    expect(washed).toContain("border-radius:20px");
    expect(washed).toContain("padding:32px 28px");
  });

  it("BackgroundPanel: gradient token wins; image mediaId renders a decorative cover img", () => {
    const gradient = renderComponent(NODE_SPECS.BackgroundPanel, DESIGN);
    expect(gradient).toContain("background:linear-gradient(135deg,#1B3A5C,#2A5080)");
    expect(gradient).toContain('<div class="lg-bg-panel-inner">');
    const image = renderComponent(
      { type: "BackgroundPanel", question_id: "b", props: { background: "wash", imageMediaId: "media_bg" }, children: [q("qi", "fi")] },
      DESIGN,
    );
    expect(image).toContain('class="lg-bg-panel-img"');
    expect(image).toContain('src="media_bg"');
    expect(image).toContain('alt=""');
    expect(image).toContain("background:#E8EEF4");
    // approved tokens only — the media reference never enters a style attribute
    expect(image).not.toContain("url(");
  });

  it("Spacer: token height inline + aria-hidden (decorative)", () => {
    const html = renderComponent(NODE_SPECS.Spacer, DESIGN);
    expect(html).toContain('class="lg-spacer"');
    expect(html).toContain("height:1.5rem"); // size l
    expect(html).toContain('aria-hidden="true"');
    // an absent variant is the default "gap" — no center rule at all (m2,
    // adversarial review: byte-identical to before the variant prop existed).
    expect(html).not.toContain("lg-spacer-line");
    expect(html).not.toContain("border-top");
  });

  it('Spacer variant:"line" (m2, adversarial review — the Divider tile): renders a VISIBLE center rule, distinct from the default gap-only Spacer', () => {
    const html = renderComponent({ type: "Spacer", question_id: "q", props: { size: "l", variant: "line" } }, DESIGN);
    expect(html).toContain('class="lg-spacer lg-spacer-line"');
    expect(html).toContain("height:1.5rem"); // size l — unaffected by the variant
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("border-top:");
    // the Layout group's own Spacer tile (variant omitted / "gap") must NOT
    // be affected by this addition — re-render the plain spec and confirm.
    const gapHtml = renderComponent(NODE_SPECS.Spacer, DESIGN);
    expect(gapHtml).not.toContain("lg-spacer-line");
  });

  it("HeaderBar: logo mediaId → src, back toggle carries data-lg-back, secure slot, tel CTA", () => {
    const html = renderComponent(NODE_SPECS.HeaderBar, DESIGN);
    expect(html).toContain('class="lg-headerbar"');
    expect(html).toContain('src="media_logo"');
    expect(html).toContain('alt="Acme"');
    expect(html).toContain("data-lg-back"); // engine back hook (03 §3.3)
    expect(html).toContain("lg-headerbar-secure");
    expect(html).toContain("Your information is secure"); // token exampleSecureCopy fallback
    expect(html).toContain('href="tel:+1 800 555 1212"');
    expect(html).toContain("Call now");
  });

  it("HeaderBar escapes hostile CTA label + omits slots not toggled on", () => {
    const html = renderComponent(
      { type: "HeaderBar", question_id: "h", props: { cta: { label: "<script>x</script>", href: "https://example.com" } } },
      DESIGN,
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("data-lg-back");
    expect(html).not.toContain("lg-headerbar-secure");
  });

  it("FooterBar: trust messages + links + escaped legal html", () => {
    const html = renderComponent(NODE_SPECS.FooterBar, DESIGN);
    expect(html).toContain('class="lg-footerbar"');
    expect(html).toContain("SSL secured");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain("Privacy");
    expect(html).toContain("Terms apply");
    const hostile = renderComponent(
      { type: "FooterBar", question_id: "f", props: { legalHtml: "<img src=x onerror=alert(1)>", links: [{ label: "<b>x</b>", href: "/ok" }] } },
      DESIGN,
    );
    expect(hostile).not.toContain("<img src=x");
    expect(hostile).not.toContain("<b>");
    expect(hostile).toContain("&lt;img src=x");
  });

  it("depth guard: containers stop recursing past depth 4 (corrupt data never stack-overflows)", () => {
    const five = stack("s1", [stack("s2", [stack("s3", [stack("s4", [stack("s5", [q("q_deep", "deep")])])])])]);
    const html = renderComponent(five, DESIGN);
    // the four allowed wrappers render; the depth-5 container renders nothing
    expect(html.split('class="lg-stack"').length - 1).toBe(4);
    expect(html).not.toContain("q_deep");
    // depth 4 with a LEAF inside renders the leaf
    const four = stack("s1", [stack("s2", [stack("s3", [stack("s4", [q("q_leaf", "leaf")])])])]);
    expect(renderComponent(four, DESIGN)).toContain('data-question-id="q_leaf"');
  });

  it("flattenComponents yields all non-container leaves in depth-first render order", () => {
    const tree: LeadgenComponentNode[] = [
      q("a", "fa"),
      {
        type: "CardPanel",
        question_id: "panel",
        children: [q("b", "fb"), stack("inner", [q("c", "fc")]), q("d", "fd")],
      },
      { type: "Spacer", question_id: "sp", props: { size: "m" } },
      q("e", "fe"),
    ];
    const ids = flattenComponents(tree).map((n) => n.question_id);
    expect(ids).toEqual(["a", "b", "c", "d", "sp", "e"]);
    // container types never appear in the flattened list
    const types = new Set(flattenComponents(tree).map((n) => n.type));
    for (const containerType of LEADGEN_CONTAINER_TYPES) {
      expect(types.has(containerType)).toBe(false);
    }
  });

  it("renderSectionComponentsVisible keeps container wrappers while dropping hidden leaves", () => {
    const tree: LeadgenComponentNode[] = [
      stack("wrap", [q("shown", "f_shown"), q("hidden", "f_hidden")]),
    ];
    const html = renderSectionComponentsVisible(tree, DESIGN, new Set(["shown"]));
    expect(html).toContain('class="lg-stack"'); // wrapper kept
    expect(html).toContain('data-question-id="shown"');
    expect(html).not.toContain('data-question-id="hidden"');
    // an emptied container keeps its wrapper (the runtime nested-DOM shape)
    const emptied = renderSectionComponentsVisible(tree, DESIGN, new Set<string>());
    expect(emptied).toContain('class="lg-stack"');
    expect(emptied).not.toContain("data-question-id=\"shown\"");
  });

  it("renderSectionComponentsVisible on FLAT content equals filter-then-render byte-for-byte", () => {
    const flat: LeadgenComponentNode[] = [
      q("q1", "f1"),
      q("q2", "f2"),
      { type: "QuestionHeadline", question_id: "h1", props: { text: "Hi" } },
    ];
    const visible = new Set(["q1", "h1"]);
    const viaTree = renderSectionComponentsVisible(flat, DESIGN, visible);
    const viaFilter = flat
      .filter((n) => typeof n.question_id === "string" && visible.has(n.question_id))
      .map((n) => renderComponent(n, DESIGN))
      .join("");
    expect(viaTree).toBe(viaFilter);
  });
});

// ===========================================================================
// audit-round G FIX 3a — renderTextInput (exercised through renderComponent)
// emits the §8.1 leading pin (icon="location", golden :323) + the helper line
// (props.helper, golden :326), reads legacy props.helper_text as a fallback
// (erratum 8), renders NO icon for the other 11 §8.1 picker values (contract
// gap — only Location has a golden asset), and is byte-identical to the bare
// input when neither is authored (strictly additive, §12 no-regression).
// ===========================================================================
describe("audit-round G FIX 3a — renderTextInput §8.1 leading pin + helper line", () => {
  const base: LeadgenComponentNode = {
    type: "ZIPInputQuestion",
    question_id: "q_zip",
    internal_field: "zip",
    answer_type: "string",
  };
  const PIN = '<path d="M12 21s7-6.6 7-12a7 7 0 10-14 0c0 5.4 7 12 7 12z" stroke="#8DA0B6" stroke-width="1.8"/>';
  const HELPER = '<div class="lg-field-help" style="font-size:12.5px;color:#96A0AF;margin-top:7px;padding-left:2px">We never share this</div>';

  it("icon='location' + props.helper: pin verbatim + helper line + input left-inset", () => {
    const html = renderComponent(
      { ...base, props: { placeholder: "Enter your ZIP code", helper: "We never share this", icon: "location" } },
      DESIGN,
    );
    expect(html).toContain(PIN);
    expect(html).toContain('<circle cx="12" cy="9" r="2.4" stroke="#8DA0B6" stroke-width="1.8"/>');
    expect(html).toContain(HELPER);
    expect(html).toContain('style="padding-left:42px"');
  });

  it("audit-round G MINOR-1 regression guard: the icon span carries z-index:1 so it paints ABOVE the Studio's own [data-selection-wrap] decoration span (both position:relative/absolute siblings at the implicit z-index:auto level — without an explicit z-index the LATER-DOM wrap's opaque input background visually occludes the icon even though it remains a real, present, correctly-positioned DOM node; confirmed live via a Playwright canvas probe during this fix's investigation)", () => {
    const html = renderComponent(
      { ...base, props: { placeholder: "Enter your ZIP code", icon: "location" } },
      DESIGN,
    );
    expect(html).toContain(
      '<span class="lg-field-icon" aria-hidden="true" style="position:absolute;left:14px;top:0;bottom:0;display:flex;align-items:center;pointer-events:none;z-index:1">',
    );
  });

  it("legacy props.helper_text is read as a fallback (erratum 8) when props.helper is absent", () => {
    const html = renderComponent({ ...base, props: { helper_text: "Legacy helper" } }, DESIGN);
    expect(html).toContain(
      '<div class="lg-field-help" style="font-size:12.5px;color:#96A0AF;margin-top:7px;padding-left:2px">Legacy helper</div>',
    );
  });

  it("the other §8.1 icon values (e.g. 'calendar') render NO icon — contract gap, never an invented SVG", () => {
    const html = renderComponent({ ...base, props: { icon: "calendar" } }, DESIGN);
    expect(html).not.toContain('stroke="#8DA0B6"');
    expect(html).not.toContain("lg-field-icon");
  });

  it("REGRESSION — absent icon AND helper renders the bare <input> (byte-identical, no wrapper)", () => {
    const html = renderComponent({ ...base, props: { placeholder: "Enter your ZIP code" } }, DESIGN);
    expect(html.startsWith('<input class="lg-input"')).toBe(true);
    expect(html).not.toContain("lg-field-boxed");
    expect(html).not.toContain("lg-field-help");
    expect(html).not.toContain("lg-field-icon");
  });

  it("audit-round G MINOR-3: helper:'' (e.g. a legacy node migrated from helper_text:'') renders NO helper div — byte-identical to absent", () => {
    const html = renderComponent({ ...base, props: { placeholder: "Enter your ZIP code", helper: "" } }, DESIGN);
    expect(html).not.toContain("lg-field-help");
    expect(html).not.toContain("lg-field-boxed");
    expect(html.startsWith('<input class="lg-input"')).toBe(true);
  });

  it("audit-round G MINOR-3: helper:'   ' (whitespace-only) also renders NO helper div", () => {
    const html = renderComponent({ ...base, props: { placeholder: "Enter your ZIP code", helper: "   " } }, DESIGN);
    expect(html).not.toContain("lg-field-help");
  });

  it("audit-round G MINOR-3: legacy helper_text:'' (post-migration empty alias) also renders NO helper div", () => {
    const html = renderComponent({ ...base, props: { placeholder: "Enter your ZIP code", helper_text: "" } }, DESIGN);
    expect(html).not.toContain("lg-field-help");
  });
});
