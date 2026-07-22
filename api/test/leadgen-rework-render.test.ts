// LeadGen Rework P2 (S2.2) — server renderer fixture-driven proofs through the
// REAL renderComponent/renderSectionComponents/effectiveFrame. Contract:
// LEADGEN-REWORK-03-CONTRACT-PLAN.md §6.3 (label/helper), §6.5 (Other),
// §6.6 (✓-marker), §6.7 (columns/centering), §6.8 (slider types), §6.9
// (phone mask scaffold), §6.10 (address field-set), §10 (renderer removals),
// M5 (frames.ts effectiveFrame saved-template axis + its S2.2 follow-up round
// threading into resolver.ts's resolveEffectiveFrameOnly — the admin-layer
// call sites at frame-handlers.ts/quotes-handlers.ts resolve the DB row and
// are covered by their OWN existing suites via the follow-up gate's covering-
// suite count, not this file; this file proves the shared MECHANISM those
// call sites depend on).
//
// A-6a byte-identity sweep: the 4 named fixtures were captured from the REAL
// renderComponent BEFORE this slice's first edit landed (capture-first
// technique) — test/fixtures/p2-prerender/pre-p2-render.json. Every OTHER
// test in this file proves an ADDITIVE behavior (absent new props ⇒ no
// change) or the handful of deliberately-INTENTIONAL fixes this phase makes
// (§6.7's under-filled-grid column clamp + wrapped-last-row centering).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  renderComponent,
  renderSectionComponents,
} from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import type { ThemeJson } from "../src/public/leadgen/designs/theme";
import { effectiveFrame, FRAME_TEMPLATES, parseSavedFrameTemplateDefaults } from "../src/public/leadgen/designs/frames";
import type { EffectiveFrameConfig } from "../src/public/leadgen/designs/frames";
import { resolveEffectiveFrameOnly } from "../src/public/leadgen/resolver";

const DESIGN = defaultFunnelDesign;
const HERE = dirname(fileURLToPath(import.meta.url));

// The SAME effDesign/css helpers leadgen-p6a-theme.test.ts uses to exercise
// the button-style triple (Images 38-40) — resolveTokens returns the widened
// EFFECTIVE design funnelChromeCss/presets both accept.
type AnyDesign = Parameters<typeof funnelChromeCss>[0];
function effDesign(theme: ThemeJson): AnyDesign {
  return resolveTokens(DESIGN, theme).design as AnyDesign;
}
function css(design: AnyDesign): string {
  return funnelChromeCss(design, '[data-funnel-design="default-funnel"]');
}

// ---------------------------------------------------------------------------
// A-6a byte-identity sweep (capture-first fixtures)
// ---------------------------------------------------------------------------

describe("A-6a byte-identity sweep — pre-P2 fixtures render byte-identical", () => {
  const frozen = JSON.parse(
    readFileSync(join(HERE, "fixtures", "p2-prerender", "pre-p2-render.json"), "utf8"),
  ) as Record<string, string>;

  it("an un-labeled button group (4 choices, exact-fit at the default 2 columns)", () => {
    const node: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q_ubg",
      internal_field: "ubg",
      choices: [
        { label: "Red", value: "red", analytics_id: "a_red" },
        { label: "Blue", value: "blue", analytics_id: "a_blue" },
        { label: "Green", value: "green", analytics_id: "a_green" },
        { label: "Yellow", value: "yellow", analytics_id: "a_yellow" },
      ],
    } as LeadgenComponentNode;
    expect(renderComponent(node, DESIGN)).toBe(frozen["unlabeledButtonGroup"]);
  });

  it("a plain dropdown (no label/helper/default)", () => {
    const node: LeadgenComponentNode = {
      type: "DropdownQuestion",
      question_id: "q_dd",
      internal_field: "dd",
      choices: [
        { label: "One", value: "one", analytics_id: "a_one" },
        { label: "Two", value: "two", analytics_id: "a_two" },
      ],
      props: { placeholder: "Select…" },
    } as LeadgenComponentNode;
    expect(renderComponent(node, DESIGN)).toBe(frozen["plainDropdown"]);
  });

  it("a legacy address (no props.fields[] at all — L-192)", () => {
    const node: LeadgenComponentNode = {
      type: "AddressAutocompleteQuestion",
      question_id: "q_addr",
      internal_field: "addr",
      required: true,
      props: { provider: "google" },
    } as LeadgenComponentNode;
    expect(renderComponent(node, DESIGN)).toBe(frozen["legacyAddress"]);
  });

  it("the migrated M7 slider shape (NumberRangeQuestion + slider_type:'single')", () => {
    const node: LeadgenComponentNode = {
      type: "NumberRangeQuestion",
      question_id: "q_slider",
      internal_field: "loan",
      props: { min: 10000, max: 1000000, default: 330000, slider_type: "single" },
    } as LeadgenComponentNode;
    expect(renderComponent(node, DESIGN)).toBe(frozen["migratedSlider"]);
  });
});

// ---------------------------------------------------------------------------
// §6.3 — label + helper additive extension to choice/dropdown/slider/address
// ---------------------------------------------------------------------------

describe("§6.3 — label/helper extends to choice/dropdown/slider/address renderers", () => {
  const LABEL = "Are you currently insured?";

  it("ButtonAnswerGroup: absent label ⇒ no .lg-label; authored label renders it above the group", () => {
    const base: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "f",
      choices: [{ label: "Yes", value: "yes", analytics_id: "a" }],
    } as LeadgenComponentNode;
    expect(renderComponent(base, DESIGN)).not.toContain("lg-label");
    const withLabel = { ...base, props: { label: LABEL } } as LeadgenComponentNode;
    const html = renderComponent(withLabel, DESIGN);
    expect(html).toContain(`<span class="lg-label">${LABEL}</span>`);
    expect(html.indexOf("lg-label")).toBeLessThan(html.indexOf("lg-answer-group"));
  });

  it("TwoButtonYesNo / IconCardAnswerGrid / ImageCardAnswerGrid / MultiChoiceCardGroup / DropdownQuestion / SearchableDropdownQuestion / NumberRangeQuestion all honor props.label additively", () => {
    const specs: LeadgenComponentNode[] = [
      { type: "TwoButtonYesNo", question_id: "q1", internal_field: "f1" } as LeadgenComponentNode,
      {
        type: "IconCardAnswerGrid",
        question_id: "q2",
        internal_field: "f2",
        choices: [{ label: "A", value: "a", analytics_id: "a", icon: "x" }],
      } as LeadgenComponentNode,
      {
        type: "ImageCardAnswerGrid",
        question_id: "q3",
        internal_field: "f3",
        choices: [{ label: "A", value: "a", analytics_id: "a" }],
      } as LeadgenComponentNode,
      {
        type: "MultiChoiceCardGroup",
        question_id: "q4",
        internal_field: "f4",
        choices: [{ label: "A", value: "a", analytics_id: "a" }],
      } as LeadgenComponentNode,
      {
        type: "DropdownQuestion",
        question_id: "q5",
        internal_field: "f5",
        choices: [{ label: "A", value: "a", analytics_id: "a" }],
      } as LeadgenComponentNode,
      {
        type: "SearchableDropdownQuestion",
        question_id: "q6",
        internal_field: "f6",
        choices: [{ label: "A", value: "a", analytics_id: "a" }],
      } as LeadgenComponentNode,
      {
        type: "NumberRangeQuestion",
        question_id: "q7",
        internal_field: "f7",
        props: { min: 0, max: 10, slider_type: "single" },
      } as LeadgenComponentNode,
    ];
    for (const spec of specs) {
      const bare = renderComponent(spec, DESIGN);
      expect(bare, `${spec.type} bare`).not.toContain("lg-label");
      const labeled = renderComponent({ ...spec, props: { ...spec.props, label: LABEL } } as LeadgenComponentNode, DESIGN);
      expect(labeled, `${spec.type} labeled`).toContain(`<span class="lg-label">${LABEL}</span>`);
    }
  });

  it("Address (per-field fields[] mode): ONE label above the whole field-set", () => {
    const node: LeadgenComponentNode = {
      type: "AddressAutocompleteQuestion",
      question_id: "q",
      internal_field: "addr",
      props: {
        label: "Your address",
        fields: [{ field: "street" }, { field: "city" }],
      },
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    expect(html).toContain(`<span class="lg-label">Your address</span>`);
    expect(html.match(/lg-label/g)?.length).toBe(1);
  });

  it("Address (legacy composite): absent label ⇒ no .lg-label; authored label renders it", () => {
    const bare: LeadgenComponentNode = {
      type: "AddressAutocompleteQuestion",
      question_id: "q",
      internal_field: "addr",
    } as LeadgenComponentNode;
    expect(renderComponent(bare, DESIGN)).not.toContain("lg-label");
    const labeled = { ...bare, props: { label: "Your address" } } as LeadgenComponentNode;
    expect(renderComponent(labeled, DESIGN)).toContain(`<span class="lg-label">Your address</span>`);
  });
});

// ---------------------------------------------------------------------------
// §6.5 — authored "Other" affordance (replaces choiceDisplay)
// ---------------------------------------------------------------------------

describe("§6.5 — authored props.other renders a trailing Other affordance", () => {
  const baseChoices = [
    { label: "Construction", value: "construction", analytics_id: "a_c" },
    { label: "Food Services", value: "food", analytics_id: "a_f" },
  ];
  const other = {
    enabled: true,
    label: "Other",
    choices: [{ label: "Agriculture", value: "agriculture", analytics_id: "a_ag" }],
  };

  it("ButtonAnswerGroup: base choices unchanged + one trailing Other trigger (chevron) + hidden native <select>", () => {
    const withOther: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "industry",
      choices: baseChoices,
      props: { other },
    } as LeadgenComponentNode;
    const html = renderComponent(withOther, DESIGN);
    // base choices intact
    expect(html).toContain('data-lg-choice="construction"');
    expect(html).toContain('data-lg-choice="food"');
    // trailing trigger: same family class, chevron, never itself a stored value
    const triggerTag = html.match(/<button[^>]*data-lg-other-trigger[^>]*>/)?.[0] ?? "";
    expect(triggerTag).toContain('class="lg-btn lg-btn-answer lg-other-trigger"');
    expect(triggerTag).not.toContain("data-value");
    expect(triggerTag).not.toContain("data-lg-choice");
    expect(html).toContain("<svg"); // the chevron
    // hidden native <select> with placeholder "Choose…" + authored values
    expect(html).toMatch(/<select[^>]*class="lg-input lg-other-select lg-other-panel"[^>]*hidden[^>]*>/);
    expect(html).toContain('<option value="" selected disabled>Choose…</option>');
    expect(html).toContain('<option value="agriculture" data-lg-choice="agriculture" data-analytics-id="a_ag">Agriculture</option>');
    // without props.other: no Other artifacts at all (byte-safe additive)
    const flat: LeadgenComponentNode = { ...withOther, props: {} } as LeadgenComponentNode;
    const flatHtml = renderComponent(flat, DESIGN);
    expect(flatHtml).not.toContain("lg-other-");
  });

  it("IconCardAnswerGrid / ImageCardAnswerGrid: the trailing Other affordance is card-styled", () => {
    for (const type of ["IconCardAnswerGrid", "ImageCardAnswerGrid"] as const) {
      const node: LeadgenComponentNode = {
        type,
        question_id: "q",
        internal_field: "biz",
        choices: baseChoices,
        props: { other },
      } as LeadgenComponentNode;
      const html = renderComponent(node, DESIGN);
      const triggerTag = html.match(/<button[^>]*data-lg-other-trigger[^>]*>/)?.[0] ?? "";
      expect(triggerTag, type).toContain('class="lg-card lg-other-trigger"');
      expect(html, type).toContain('<span class="lg-card-title">Other</span>');
      expect(html, type).toContain("lg-other-select");
    }
  });

  it("MultiChoiceCardGroup: NOT single-select ⇒ props.other is never rendered even if authored (matrix)", () => {
    const node: LeadgenComponentNode = {
      type: "MultiChoiceCardGroup",
      question_id: "q",
      internal_field: "features",
      choices: baseChoices,
      props: { other },
    } as LeadgenComponentNode;
    expect(renderComponent(node, DESIGN)).not.toContain("lg-other-");
  });

  it("selecting an Other value: the <select> carries data-lg-input so the EXISTING generic recording mechanism applies (no new engine code required)", () => {
    const node: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "industry",
      choices: baseChoices,
      props: { other },
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    expect(html).toMatch(/<select[^>]*data-lg-input[^>]*>/);
  });

  it("hostile props.other.label / choice content stays escaped", () => {
    const hostile: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "f",
      choices: baseChoices,
      props: {
        other: {
          enabled: true,
          label: "<script>alert(1)</script>",
          choices: [{ label: "<script>x</script>", value: "x", analytics_id: "a" }],
        },
      },
    } as LeadgenComponentNode;
    const html = renderComponent(hostile, DESIGN);
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ---------------------------------------------------------------------------
// §6.6 — ✓-in-selected marker resolution (choice > node > theme)
// ---------------------------------------------------------------------------

describe("§6.6 — ✓-in-selected marker resolution order", () => {
  const choices = [
    { label: "Yes", value: true, analytics_id: "a_yes" },
    { label: "No", value: false, analytics_id: "a_no" },
  ];

  it("neither layer set ⇒ wash (no mark markup) — byte-identical to pre-§6.6", () => {
    const node: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "f",
      choices,
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    expect(html).not.toContain("lg-check-badge");
    expect(html).not.toContain("lg-check-hollow");
  });

  it("node-level props.selected_marker:'mark' applies to every choice", () => {
    const node: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "f",
      choices,
      props: { selected_marker: "mark" },
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    expect((html.match(/lg-check-badge/g) ?? []).length).toBe(2);
    expect((html.match(/lg-check-hollow/g) ?? []).length).toBe(2);
    // the theme-level data-card-select gate opens too (styles.ts consumption hook)
    expect(html).toContain('data-card-select="mark"');
  });

  it("per-choice style.selected_marker OVERRIDES the node-level value for that ONE choice", () => {
    const node: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "f",
      choices: [
        { ...choices[0]!, style: { selected_marker: "wash" } },
        { ...choices[1]!, style: { selected_marker: "mark" } },
      ],
      props: { selected_marker: "mark" },
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    // exactly ONE mark rendering (the second choice's per-choice override wins
    // over the node-level 'mark' for the FIRST choice, which resolves 'wash').
    expect((html.match(/lg-check-badge/g) ?? []).length).toBe(1);
  });

  it("TwoButtonYesNo also honors the SAME resolution chain (choice via yesStyle/noStyle > node > theme)", () => {
    const node: LeadgenComponentNode = {
      type: "TwoButtonYesNo",
      question_id: "q",
      internal_field: "f",
      props: { yesStyle: { selected_marker: "mark" } },
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    expect((html.match(/lg-check-badge/g) ?? []).length).toBe(1);
  });

  it("IconCardAnswerGrid: per-card markCheck resolves the SAME chain (extends the pre-§6.6 theme-only ternary)", () => {
    const node: LeadgenComponentNode = {
      type: "IconCardAnswerGrid",
      question_id: "q",
      internal_field: "f",
      choices: [
        { label: "A", value: "a", analytics_id: "a", icon: "x", style: { selected_marker: "mark" } },
        { label: "B", value: "b", analytics_id: "b", icon: "y" },
      ],
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    expect((html.match(/lg-card-check/g) ?? []).length).toBe(1);
    expect(html).toContain('data-card-select="mark"'); // gate opens for the ONE mark card
  });

  // Follow-up round (coordinator-directed): AC #4 needs the ✓ to actually
  // RENDER on buttons, not just carry markup — styles.ts now emits a
  // button-family sibling of pushButtonStyleRules' existing card-mark branch
  // (~line 159-191 there). These two tests prove (a) the CSS rule text
  // targets the button family with the SAME selector triplet/sizes the card
  // branch uses, and (b) the rendered markup carries exactly the class hooks
  // that CSS keys on — the visual pixel proof itself stays with the P6
  // journeys (Playwright), per the coordinator's scope note.
  it("CSS: a theme selecting 'mark' emits the button-family sibling rule (resting hollow + hidden badge + selected swap)", () => {
    const design = effDesign({ button_defaults: { selected: "mark" } });
    const sheet = css(design);
    // resting: the hollow circle is styled unconditionally under the gate.
    expect(sheet).toContain('.lg-answer-group[data-card-select="mark"] .lg-check-hollow');
    // the filled badge exists but starts hidden.
    expect(sheet).toMatch(/\.lg-answer-group\[data-card-select="mark"\] \.lg-check-badge\{[^}]*display:none/);
    // selected-state triplet swaps which one paints (mirrors the card branch
    // 1:1 — .lg-selected / [aria-checked="true"] / [data-selected="true"]).
    expect(sheet).toContain('.lg-answer-group[data-card-select="mark"] .lg-btn-answer.lg-selected .lg-check-hollow');
    expect(sheet).toContain('.lg-answer-group[data-card-select="mark"] .lg-btn-answer[aria-checked="true"] .lg-check-hollow');
    expect(sheet).toContain('.lg-answer-group[data-card-select="mark"] .lg-btn-answer[data-selected="true"] .lg-check-hollow');
    expect(sheet).toMatch(
      /\.lg-answer-group\[data-card-select="mark"\] \.lg-btn-answer\.lg-selected \.lg-check-badge[^{]*\{display:inline-flex\}/,
    );
    // P0 pack sizes (studio-panels.html .lg-check-badge/.lg-check-hollow):
    // 17px hollow, 19px badge — reused verbatim, not re-invented.
    expect(sheet).toMatch(/\.lg-check-hollow\{width:17px;height:17px/);
    expect(sheet).toMatch(/\.lg-check-badge\{display:none;width:19px;height:19px/);
  });

  it("CSS: 'wash' (default) theme emits NONE of the button-mark rules — byte-safe additive", () => {
    const sheet = css(effDesign({}));
    expect(sheet).not.toContain("lg-check-hollow");
    expect(sheet).not.toContain("lg-check-badge");
  });

  it("rendered-selected-button: the markup carries exactly the hooks the emitted CSS keys on (mark theme + a mark-resolved button)", () => {
    const design = effDesign({ button_defaults: { selected: "mark" } });
    const sheet = css(design);
    const node: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "f",
      choices: [
        { label: "Yes", value: "yes", analytics_id: "a_yes" },
        { label: "No", value: "no", analytics_id: "a_no" },
      ],
    } as LeadgenComponentNode;
    const html = renderComponent(node, design as never);
    // group root: the CSS gate attribute the sheet's selector requires.
    expect(html).toContain('data-card-select="mark"');
    // every choice carries BOTH spans (server can't know client selection
    // state; CSS alone decides which paints — proven by the CSS test above).
    expect((html.match(/lg-check-hollow/g) ?? []).length).toBe(2);
    expect((html.match(/lg-check-badge/g) ?? []).length).toBe(2);
    // the runtime toggles .lg-selected/[aria-checked=true] on click (engine.ts,
    // out of this slice) — simulate that ONE hop and confirm the emitted CSS
    // sheet contains a rule literally selecting this exact combination, so
    // the marker is provably visible once the engine flips the class.
    const selectedButton = html.replace(
      '<button type="button" class="lg-btn lg-btn-answer" role="radio" aria-checked="false" data-value="yes"',
      '<button type="button" class="lg-btn lg-btn-answer lg-selected" role="radio" aria-checked="true" data-value="yes"',
    );
    expect(selectedButton).toContain('class="lg-btn lg-btn-answer lg-selected" role="radio" aria-checked="true"');
    expect(sheet).toContain(".lg-btn-answer.lg-selected .lg-check-badge");
    expect(sheet).toMatch(/\.lg-check-badge[^{]*\{display:inline-flex\}$/m);
  });
});

// ---------------------------------------------------------------------------
// §6.7 — columns = min(authored, choiceCount); wrapped last row centered
// ---------------------------------------------------------------------------

describe("§6.7 — columns clamp + wrapped-last-row centering (L-195)", () => {
  const cardsOf = (n: number): { label: string; value: string; analytics_id: string; icon: string }[] =>
    Array.from({ length: n }, (_, i) => ({ label: `C${i}`, value: `c${i}`, analytics_id: `a${i}`, icon: "x" }));

  it("2-card component (unauthored, design default 3): renders 2 columns, no ghost cell", () => {
    const node: LeadgenComponentNode = {
      type: "IconCardAnswerGrid",
      question_id: "q",
      internal_field: "f",
      choices: cardsOf(2),
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    expect(html).toContain("--lg-cols:2");
    // exact-fit (2 choices / 2 cols, remainder 0) ⇒ no centering override needed
    expect(html).not.toContain("justify-content:center");
    expect(html).not.toContain("grid-column-start");
  });

  it("5-card component at the design default (3 cols): wrapped last row (2 items) gets explicit centering", () => {
    const node: LeadgenComponentNode = {
      type: "IconCardAnswerGrid",
      question_id: "q",
      internal_field: "f",
      choices: cardsOf(5),
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    expect(html).toContain("--lg-cols:3");
    // L-195: an EXPLICIT track/justify rule, never margin:auto on an inline box.
    expect(html).toContain("justify-content:center");
    expect(html).not.toMatch(/margin(-left|-right)?\s*:\s*auto/);
    // the trailing 2 cards (indices 3,4) carry an explicit grid-column-start;
    // the first 3 do not.
    const starts = [...html.matchAll(/grid-column-start:(\d+)/g)].map((m) => m[1]);
    expect(starts.length).toBe(2);
  });

  it("author override columns:1..5 clamped to choiceCount (min(authored, count))", () => {
    const node: LeadgenComponentNode = {
      type: "IconCardAnswerGrid",
      question_id: "q",
      internal_field: "f",
      choices: cardsOf(2),
      props: { columns: 5 },
    } as LeadgenComponentNode;
    expect(renderComponent(node, DESIGN)).toContain("--lg-cols:2");
  });

  it("ButtonAnswerGroup: the SAME clamp + centering rule applies (unified with cards)", () => {
    const node: LeadgenComponentNode = {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "f",
      choices: cardsOf(5).map((c) => ({ label: c.label, value: c.value, analytics_id: c.analytics_id })),
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    // 5 choices, unauthored ⇒ effective cols = min(design-default 2, 5) = 2,
    // which EQUALS the default — buttons (unlike cards) only emit --lg-cols
    // when it differs from the CSS fallback, so no --lg-cols attribute is a
    // byte-correct no-op here (the CSS default already resolves to 2).
    expect(html).not.toContain("--lg-cols");
    // 5 choices / 2 cols ⇒ remainder 1 ⇒ a wrapped partial row STILL exists,
    // and centering applies regardless of whether --lg-cols itself was emitted.
    expect(html).toContain("justify-content:center");
  });

  it("mobile columns are unchanged (tokens.ts answerGrid/iconCardGrid mobile slots untouched by this slice)", () => {
    expect(DESIGN.iconCardGrid.columnsMobile).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §6.8 — slider types (5 markups, one NumberRangeQuestion catalog entry)
// ---------------------------------------------------------------------------

describe("§6.8 — slider_type dispatch (5 markups)", () => {
  const base = { type: "NumberRangeQuestion" as const, question_id: "q", internal_field: "amt" };

  it("single (default when slider_type absent): the pre-§6.8 shape, native range input + value/track/minmax", () => {
    const html = renderComponent({ ...base, props: { min: 0, max: 100, default: 50 } } as LeadgenComponentNode, DESIGN);
    expect(html).toContain('class="lg-range"');
    expect(html).toContain('type="range"');
    expect(html).toContain("lg-range-value");
    expect(html).toContain("lg-range-minmax");
    expect(html).not.toContain("data-slider-type");
  });

  it("stepper: single + −/＋ buttons (S2.3 engine contract: data-lg-step=\"dec\"/\"inc\"), step required (author-supplied)", () => {
    const html = renderComponent(
      { ...base, props: { min: 0, max: 10, default: 3, step: 1, slider_type: "stepper" } } as LeadgenComponentNode,
      DESIGN,
    );
    expect(html).toContain('data-slider-type="stepper"');
    expect(html).toContain('data-lg-step="dec"');
    expect(html).toContain('data-lg-step="inc"');
    expect(html).toMatch(/<input[^>]*type="range"[^>]*data-lg-input/);
  });

  it("from_to: two number inputs, each WRAPPED in [data-lg-field=\"{base}_min|_max\"] containing its own [data-lg-input] (S2.3 engine contract)", () => {
    const html = renderComponent(
      { ...base, props: { min: 0, max: 100000, step: 5000, slider_type: "from_to" } } as LeadgenComponentNode,
      DESIGN,
    );
    expect(html).toContain('data-slider-type="from_to"');
    expect(html).toMatch(/<span data-lg-field="amt_min"><input[^>]*type="number"[^>]*data-lg-input/);
    expect(html).toMatch(/<span data-lg-field="amt_max"><input[^>]*type="number"[^>]*data-lg-input/);
  });

  it("dual_range: two drag handles (native range inputs), each WRAPPED in [data-lg-field], SAME _min/_max data contract as from_to", () => {
    const html = renderComponent(
      { ...base, props: { min: 0, max: 100, step: 1, slider_type: "dual_range" } } as LeadgenComponentNode,
      DESIGN,
    );
    expect(html).toContain('data-slider-type="dual_range"');
    // each handle: a [data-lg-field] wrapper CONTAINING (not necessarily
    // immediately preceding) its own type=range [data-lg-input] — the track
    // div sits between the wrapper's open tag and the input.
    expect(html).toMatch(/<span data-lg-field="amt_min">(?:(?!<\/span>).)*<input[^>]*type="range"[^>]*data-lg-input(?:(?!<\/span>).)*<\/span>/);
    expect(html).toMatch(/<span data-lg-field="amt_max">(?:(?!<\/span>).)*<input[^>]*type="range"[^>]*data-lg-input(?:(?!<\/span>).)*<\/span>/);
  });

  it("radial: 'single' substrate — ONE real native range input carries role=slider; the conic-gradient arc is a PURELY presentational, aria-hidden wrapper (no competing slider landmark)", () => {
    const html = renderComponent(
      { ...base, props: { min: 0, max: 100, default: 45, slider_type: "radial" } } as LeadgenComponentNode,
      DESIGN,
    );
    expect(html).toContain('data-slider-type="radial"');
    expect(html).toContain("conic-gradient(");
    expect(html).toMatch(/<input[^>]*type="range"[^>]*data-lg-input/);
    // exactly ONE role="slider" in the whole component (the real input).
    expect((html.match(/role="slider"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/<div class="lg-range-radial-outer" aria-hidden="true"/);
  });

  it("currency_affix is display-only: toggles the $ format WITHOUT touching node.type/answer_type (the Image9 fix)", () => {
    const withAffix = renderComponent({ ...base, props: { min: 0, max: 100, default: 10, currency_affix: true } } as LeadgenComponentNode, DESIGN);
    const without = renderComponent({ ...base, props: { min: 0, max: 100, default: 10, currency_affix: false } } as LeadgenComponentNode, DESIGN);
    expect(withAffix).toContain('data-format="currency"');
    expect(without).toContain('data-format="number"');
  });

  it("legacy RangeQuestion/CurrencyRangeQuestion: unconditional 'single' shape regardless of any slider_type prop (M7 never adds it to these legacy types)", () => {
    const html = renderComponent(
      { type: "RangeQuestion", question_id: "q", internal_field: "amt", props: { min: 0, max: 100, default: 50 } } as LeadgenComponentNode,
      DESIGN,
    );
    expect(html).not.toContain("data-slider-type");
    expect(html).toContain('class="lg-range"');
  });
});

// ---------------------------------------------------------------------------
// §6.9 / M8 — phone mask scaffold
// ---------------------------------------------------------------------------

describe("§6.9 / M8 — phone mask scaffold render", () => {
  it("a valid mask pattern compiles to a scaffold + digit-count data hook + a fallback placeholder", () => {
    const node: LeadgenComponentNode = {
      type: "PhoneInputQuestion",
      question_id: "q",
      internal_field: "phone",
      props: { phone_format: { mask: { pattern: "(3) 3-4" } } },
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    expect(html).toContain('data-lg-mask-scaffold="(___) ___-____"');
    expect(html).toContain('data-lg-mask-digits="10"');
    expect(html).toContain('placeholder="(___) ___-____"');
    expect(html).toContain('type="tel"');
    expect(html).toContain("data-lg-input");
  });

  it("an authored props.placeholder always wins over the mask-scaffold fallback", () => {
    const node: LeadgenComponentNode = {
      type: "PhoneInputQuestion",
      question_id: "q",
      internal_field: "phone",
      props: { phone_format: { mask: { pattern: "(3) 3-4" } }, placeholder: "Cell number" },
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    expect(html).toContain('placeholder="Cell number"');
    expect(html).not.toContain('placeholder="(___) ___-____"');
  });

  it("NO mask (absent props.phone_format, or a legacy nanp/e164_intl/il preset string) ⇒ byte-identical plain <input> — no mask data hooks", () => {
    const bare: LeadgenComponentNode = { type: "PhoneInputQuestion", question_id: "q", internal_field: "phone" } as LeadgenComponentNode;
    const html = renderComponent(bare, DESIGN);
    expect(html).not.toContain("data-lg-mask-scaffold");
    expect(html).not.toContain("data-lg-mask-digits");
    const legacyPreset: LeadgenComponentNode = {
      type: "PhoneInputQuestion",
      question_id: "q",
      internal_field: "phone",
      props: { phone_format: "nanp" },
    } as LeadgenComponentNode;
    expect(renderComponent(legacyPreset, DESIGN)).not.toContain("data-lg-mask-scaffold");
  });

  it("a grammar-invalid mask pattern parses to undefined ⇒ falls back to the plain unmask render (never throws)", () => {
    const node: LeadgenComponentNode = {
      type: "PhoneInputQuestion",
      question_id: "q",
      internal_field: "phone",
      props: { phone_format: { mask: { pattern: "(3x) 3-4" } } },
    } as LeadgenComponentNode;
    expect(() => renderComponent(node, DESIGN)).not.toThrow();
    expect(renderComponent(node, DESIGN)).not.toContain("data-lg-mask-scaffold");
  });
});

// ---------------------------------------------------------------------------
// §6.10 / M9 — address field-set render
// ---------------------------------------------------------------------------

describe("§6.10 / M9 — address renders per props.fields[]", () => {
  it("4-field order (street/city/state/zip): 4 separate inputs, in author order, each self-declaring data-lg-field", () => {
    const node: LeadgenComponentNode = {
      type: "AddressAutocompleteQuestion",
      question_id: "q",
      internal_field: "addr",
      props: {
        fields: [
          { field: "street", mode: "autofill" },
          { field: "city", mode: "autofill" },
          { field: "state", mode: "autofill" },
          { field: "zip", mode: "autofill", validation: "zip5" },
        ],
      },
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    const order = ["addr_street", "addr_city", "addr_state", "addr_zip"];
    let lastIndex = -1;
    for (const field of order) {
      const idx = html.indexOf(`data-lg-field="${field}"`);
      expect(idx, field).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }
    // default per-kind placeholders (pack pins: Street address/City/State/ZIP code)
    expect(html).toContain('placeholder="Street address"');
    expect(html).toContain('placeholder="City"');
    expect(html).toContain('placeholder="State"');
    expect(html).toContain('placeholder="ZIP code"');
    // zip5 validation renders the native numeric hint
    expect(html).toMatch(/inputmode="numeric" pattern="\\d\{5\}" maxlength="5"/);
    // exactly ONE data-lg-maps wrapper (the autocomplete-driving field — street, first autofill)
    expect((html.match(/data-lg-maps/g) ?? []).length).toBe(1);
  });

  it("a subset (street + zip only) renders exactly those 2 fields, in that order", () => {
    const node: LeadgenComponentNode = {
      type: "AddressAutocompleteQuestion",
      question_id: "q",
      internal_field: "addr",
      props: { fields: [{ field: "street" }, { field: "zip", validation: "zip5" }] },
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    expect(html).not.toContain('data-lg-field="addr_city"');
    expect(html).not.toContain('data-lg-field="addr_state"');
    expect(html.indexOf('data-lg-field="addr_street"')).toBeLessThan(html.indexOf('data-lg-field="addr_zip"'));
  });

  it("per-field custom label overrides the default placeholder", () => {
    const node: LeadgenComponentNode = {
      type: "AddressAutocompleteQuestion",
      question_id: "q",
      internal_field: "addr",
      props: { fields: [{ field: "street", label: "Property address" }] },
    } as LeadgenComponentNode;
    expect(renderComponent(node, DESIGN)).toContain('placeholder="Property address"');
  });

  it("full_address alone renders ONE composite input (today's exact semantics), never a per-field set", () => {
    const node: LeadgenComponentNode = {
      type: "AddressAutocompleteQuestion",
      question_id: "q",
      internal_field: "addr",
      props: { fields: [{ field: "full_address" }] },
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    expect(html).toContain("lg-address-input");
    expect(html).not.toContain("lg-address-field-wrap");
    expect((html.match(/<input/g) ?? []).length).toBe(1);
  });

  it("mode:'manual' fields never carry data-lg-maps, even when the master Maps toggle is on", () => {
    const node: LeadgenComponentNode = {
      type: "AddressAutocompleteQuestion",
      question_id: "q",
      internal_field: "addr",
      props: {
        maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: true } },
        fields: [{ field: "street", mode: "manual" }, { field: "zip", mode: "autofill", validation: "zip5" }],
      },
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    // the AUTOFILL field (zip) drives the map; the MANUAL field (street) never does
    expect(html).toMatch(/data-lg-field="addr_zip"[^>]*data-lg-maps/);
    expect(html).not.toMatch(/data-lg-field="addr_street"[^>]*data-lg-maps/);
  });

  it("Maps off/keyless (existing graceful path): fields still render as plain, functional, typeable inputs — no renderer branching required", () => {
    const node: LeadgenComponentNode = {
      type: "AddressAutocompleteQuestion",
      question_id: "q",
      internal_field: "addr",
      props: { fields: [{ field: "street", mode: "autofill" }, { field: "zip", mode: "autofill", validation: "zip5" }] },
    } as LeadgenComponentNode;
    const html = renderComponent(node, DESIGN);
    expect(html).toContain('type="text"');
    expect(html).toContain("data-lg-input");
  });

  it("absent props.fields[] (legacy, un-migrated shape) renders EXACTLY today's composite — L-192, verified against the SAME frozen A-6a fixture", () => {
    const legacy: LeadgenComponentNode = {
      type: "AddressAutocompleteQuestion",
      question_id: "q_addr",
      internal_field: "addr",
      required: true,
      props: { provider: "google" },
    } as LeadgenComponentNode;
    const frozen = JSON.parse(
      readFileSync(join(HERE, "fixtures", "p2-prerender", "pre-p2-render.json"), "utf8"),
    ) as Record<string, string>;
    expect(renderComponent(legacy, DESIGN)).toBe(frozen["legacyAddress"]);
  });

  it("a corrupt/malformed props.fields (not an array, or an unrecognized field kind) falls back to the legacy composite render defensively (never throws)", () => {
    const corrupt: LeadgenComponentNode = {
      type: "AddressAutocompleteQuestion",
      question_id: "q_addr",
      internal_field: "addr",
      required: true,
      props: { provider: "google", fields: "not-an-array" },
    } as LeadgenComponentNode;
    expect(() => renderComponent(corrupt, DESIGN)).not.toThrow();
    expect(renderComponent(corrupt, DESIGN)).toContain("lg-address-input");
  });
});

// ---------------------------------------------------------------------------
// §10 removals — OtherGroupSelector fail-safe box; MultiQuestionGrid unchanged
// ---------------------------------------------------------------------------

describe("§10 — retired render legs stay non-500", () => {
  it("OtherGroupSelector renders the fail-safe extinct-type box regardless of legacy choiceDisplay content", () => {
    const node: LeadgenComponentNode = {
      type: "OtherGroupSelector",
      question_id: "q",
      internal_field: "f",
      choices: [{ label: "A", value: "a", analytics_id: "a" }],
      choiceDisplay: { mainValues: ["a"], otherGroupEnabled: true, otherGroupLabel: "Other", searchableOther: false },
    } as unknown as LeadgenComponentNode;
    expect(() => renderComponent(node, DESIGN)).not.toThrow();
    const html = renderComponent(node, DESIGN);
    expect(html).toContain('class="lg-mqg-empty"');
    expect(html).not.toContain("data-lg-choice");
  });
});

// ---------------------------------------------------------------------------
// M5 — effectiveFrame saved-template axis (frames.ts)
// ---------------------------------------------------------------------------

describe("M5 — effectiveFrame accepts a saved-template defaults override", () => {
  it("byte-identical legacy behavior when the 4th argument is omitted (every pre-M5 call site)", () => {
    const withArg = effectiveFrame("centered", null, null);
    const without = effectiveFrame("centered", null, null, undefined);
    expect(without).toEqual(withArg);
  });

  it("a provided savedTemplateDefaults becomes the base layer INSTEAD of the templateId lookup — funnel/variant layers still merge on top", () => {
    const custom: EffectiveFrameConfig = {
      ...FRAME_TEMPLATES["minimal"]!.defaults,
      header: { ...FRAME_TEMPLATES["minimal"]!.defaults.header, tagline: "CUSTOM SAVED TEMPLATE" },
    };
    // template requested is 'centered' (would normally win) — but a saved
    // template row's defaults are supplied, so THEY are the base instead.
    const result = effectiveFrame("centered", null, null, custom);
    expect(result.frame.header.tagline).toBe("CUSTOM SAVED TEMPLATE");
    // funnel-level frame_config_json still merges on top of the saved template.
    const withFunnelPatch = effectiveFrame("centered", { header: { tagline: "FUNNEL OVERRIDE" } }, null, custom);
    expect(withFunnelPatch.frame.header.tagline).toBe("FUNNEL OVERRIDE");
  });

  it("a saved-template resolution never emits the 'unknown template' warning (an ftid resolution is never unknown)", () => {
    const custom = FRAME_TEMPLATES["centered"]!.defaults;
    const result = effectiveFrame("not-a-real-template-id", null, null, custom);
    expect(result.problems).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// M5 follow-up (S2.2, coordinator-directed 2026-07-22) — the DB-facing legs:
// parseSavedFrameTemplateDefaults (frames.ts, pure — parses a
// leadgen_frame_templates.frame_json column value) and resolveEffectiveFrameOnly
// (resolver.ts — the frame-only half serve.ts/runtime-routes.ts/attempt.ts all
// share). The actual row FETCH (SELECT ... FROM leadgen_frame_templates WHERE
// id = ?) and the variant.frame_template_id ?? funnel.frame_template_id
// precedence live in the 3 admin call sites (frame-handlers.ts's
// resolveSavedFrameTemplateDefaults, quotes-handlers.ts's
// loadSavedFrameTemplateDefaults) — those are covered by their OWN existing
// suites (leadgen-frame-obligations.test.ts, leadgen-quotes-* suites, run by
// count per the follow-up gate), not this file. This file proves the SHARED
// MECHANISM every one of those call sites depends on: a parsed row wins as
// the base layer, and whichever row a caller's `??` resolves is exactly what
// flows through — omitted stays byte-identical to the pre-M5 legacy path.
// ---------------------------------------------------------------------------

describe("M5 follow-up — parseSavedFrameTemplateDefaults (frames.ts)", () => {
  it("a valid, complete frame_json column parses to an EffectiveFrameConfig", () => {
    const stored = {
      ...FRAME_TEMPLATES["minimal"]!.defaults,
      header: { ...FRAME_TEMPLATES["minimal"]!.defaults.header, tagline: "ROW TAGLINE" },
    };
    const result = parseSavedFrameTemplateDefaults(JSON.stringify(stored));
    expect(result?.header.tagline).toBe("ROW TAGLINE");
  });

  it("malformed JSON (unparseable) degrades to null", () => {
    expect(parseSavedFrameTemplateDefaults("{not valid json")).toBeNull();
  });

  it("a JSON array (not an object) degrades to null", () => {
    expect(parseSavedFrameTemplateDefaults("[1,2,3]")).toBeNull();
  });

  it("a JSON primitive (number/string, not an object) degrades to null", () => {
    expect(parseSavedFrameTemplateDefaults("42")).toBeNull();
  });

  it("null, undefined, and an empty/blank string all degrade to null", () => {
    expect(parseSavedFrameTemplateDefaults(null)).toBeNull();
    expect(parseSavedFrameTemplateDefaults(undefined)).toBeNull();
    expect(parseSavedFrameTemplateDefaults("")).toBeNull();
    expect(parseSavedFrameTemplateDefaults("   ")).toBeNull();
  });

  it("a schema-invalid object (unknown top-level key) degrades to null — defensive re-validation on READ, not a blind trust of the write-time gate", () => {
    const badRow = { ...FRAME_TEMPLATES["minimal"]!.defaults, bogus_unknown_top_level_field: "x" };
    expect(parseSavedFrameTemplateDefaults(JSON.stringify(badRow))).toBeNull();
  });
});

describe("M5 follow-up — resolveEffectiveFrameOnly's saved_template_defaults field (resolver.ts)", () => {
  const richSource = {
    frame_config_json: JSON.stringify({ template: "header-footer", header: { tagline: "STORED TAGLINE" } }),
    theme_json: null,
    frame_overrides_json: JSON.stringify({ back: { label: "Go back" } }),
  };

  it("byte-identical when saved_template_defaults is omitted, undefined, or null — every pre-M5 caller (runtime-routes.ts x2, serve.ts, attempt.ts) is unaffected", () => {
    const omitted = resolveEffectiveFrameOnly(richSource);
    const explicitUndefined = resolveEffectiveFrameOnly({ ...richSource, saved_template_defaults: undefined });
    const explicitNull = resolveEffectiveFrameOnly({ ...richSource, saved_template_defaults: null });
    expect(explicitUndefined).toEqual(omitted);
    expect(explicitNull).toEqual(omitted);
    // and the frame/overrides merge still applies normally (this wrapper's
    // pre-existing behavior, unchanged by the new field's presence in the type).
    expect(omitted?.header.tagline).toBe("STORED TAGLINE");
    expect(omitted?.back.label).toBe("Go back");
  });

  it("a provided saved_template_defaults becomes the base layer — the funnel's stored frame_config_json and the variant's frame_overrides_json still merge on top of it", () => {
    const savedDefaults: EffectiveFrameConfig = {
      ...FRAME_TEMPLATES["minimal"]!.defaults,
      header: { ...FRAME_TEMPLATES["minimal"]!.defaults.header, tagline: "WILL BE OVERWRITTEN", secure_badge: { enabled: true, text: "Saved-template badge" } },
    };
    const result = resolveEffectiveFrameOnly({ ...richSource, saved_template_defaults: savedDefaults });
    // funnel's stored header.tagline still wins over the saved template's (a
    // higher merge layer, exactly as effectiveFrame's own A-6a test proves).
    expect(result?.header.tagline).toBe("STORED TAGLINE");
    // but a field the funnel/variant layers never touch flows through from
    // the saved template row — the distinguishing proof it was actually used
    // as the base rather than FRAME_TEMPLATES['split'].defaults.
    expect(result?.header.secure_badge.text).toBe("Saved-template badge");
    const legacy = resolveEffectiveFrameOnly(richSource);
    expect(legacy?.header.secure_badge.text).not.toBe("Saved-template badge");
  });

  it("honors whichever resolved row the CALLER passes — the mechanism frame-handlers.ts / quotes-handlers.ts's variant.frame_template_id ?? funnel.frame_template_id precedence depends on", () => {
    const funnelDefaults: EffectiveFrameConfig = {
      ...FRAME_TEMPLATES["minimal"]!.defaults,
      header: { ...FRAME_TEMPLATES["minimal"]!.defaults.header, secure_badge: { enabled: true, text: "FUNNEL-LEVEL ROW" } },
    };
    const variantDefaults: EffectiveFrameConfig = {
      ...FRAME_TEMPLATES["minimal"]!.defaults,
      header: { ...FRAME_TEMPLATES["minimal"]!.defaults.header, secure_badge: { enabled: true, text: "VARIANT-LEVEL ROW" } },
    };
    // A variant WITH its own ftid: the caller's `??` resolves to
    // variantDefaults before ever calling this function — variant wins.
    const variantWins = resolveEffectiveFrameOnly({ ...richSource, saved_template_defaults: variantDefaults });
    expect(variantWins?.header.secure_badge.text).toBe("VARIANT-LEVEL ROW");
    // A variant with NO ftid (null): the caller's `??` falls through to the
    // funnel's row instead — funnel wins (the "neither set at variant level"
    // case, distinct from "neither set at all" above).
    const funnelWins = resolveEffectiveFrameOnly({ ...richSource, saved_template_defaults: funnelDefaults });
    expect(funnelWins?.header.secure_badge.text).toBe("FUNNEL-LEVEL ROW");
  });
});
