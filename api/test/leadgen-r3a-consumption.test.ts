// Section Builder v3.1 REMEDIATION — phase R3 STAGE A.
// Per-renderer CONSUMPTION units (register S2-1/E1-C3/E2-NEW-7/E1-NEW-8/S2-8/
// E1-NEW-9): design_overrides IN -> the grounded inline styles OUT for the 8
// widened choice/button/card/dropdown renderers, the leading-icon SVG map
// completeness + Address wiring, and the shared helper line for the 7 types.
// These are effect-of-the-server-renderer proofs (the browser effect-matrix
// lives in test-ui/leadgen-r3a-effects.gesture.spec.ts).
import { describe, expect, it } from "vitest";
import { renderComponent } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { LEADGEN_FIELD_LEADING_ICONS } from "../src/public/leadgen/components/content-schema";
import { LEADGEN_ICONS, leadgenIconSvg } from "../src/public/leadgen/components/icons.generated";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { SECTION_STUDIO_SCRIPT } from "../src/admin/leadgen/ui-section-studio";

const DESIGN = defaultFunnelDesign;

// Grounded expected values (Appendix B + §8.5b + the default design tokens).
const BRAND = "#1B3A5C"; // design.color.primary
const ACCENT = "#E85D26"; // design.color.accent
const NEUTRAL = "#D2D9E5"; // design.color.border
const RADIUS = { sharp: "0", rounded: "8px", pill: "20px" };
const CUSTOM_W = 240;
const CUSTOM_H = 56;

// design_overrides exercising width+height custom_px, pill corners, brand border.
const OV = {
  size: { width: { custom_px: CUSTOM_W }, height: { custom_px: CUSTOM_H } },
  corners: "pill",
  border_color: "brand",
} as const;

function node(type: string, extra: Record<string, unknown> = {}): LeadgenComponentNode {
  return {
    type,
    question_id: "q_" + type,
    internal_field: "f_" + type,
    answer_type: "string",
    choices: [
      { label: "Alpha", value: "a" },
      { label: "Beta", value: "b" },
    ],
    props: { yesLabel: "Yes", noLabel: "No", placeholder: "Pick" },
    ...extra,
  } as unknown as LeadgenComponentNode;
}
function render(type: string, extra: Record<string, unknown> = {}): string {
  return renderComponent(node(type, extra), DESIGN);
}

// Rework §10 removal (test repair, P2): OtherGroupSelector's render leg is
// RETIRED to a fail-safe extinct-type box (conductor ruling) that consumes
// NEITHER design_overrides NOR props.helper any more — dropped from both
// lists below (its own dedicated retirement coverage lives in
// leadgen-components-render.test.ts / leadgen-r1-answers.test.ts).
const BUTTON_TYPES = ["ButtonAnswerGroup", "TwoButtonYesNo"];
const CARD_TYPES = ["IconCardAnswerGrid", "ImageCardAnswerGrid", "MultiChoiceCardGroup"];
const DROPDOWN_TYPES = ["DropdownQuestion", "SearchableDropdownQuestion"];
const HELPER_TYPES = [
  "ButtonAnswerGroup",
  "TwoButtonYesNo",
  "IconCardAnswerGrid",
  "ImageCardAnswerGrid",
  "MultiChoiceCardGroup",
  "DropdownQuestion",
  // PC-A10 (drift honesty, register): CONTENT_PROP_FIELDS has always
  // advertised Helper text for SearchableDropdownQuestion (it shares
  // DropdownQuestion's own ["placeholder","helper"] row set) — the renderer
  // just never called fieldHelperLine, an ARBITRARY exclusion this pin used
  // to assert explicitly ("intentionally NOT in the helper set"). Wired now;
  // folded into this set — the honest resolution was to render it, not to
  // keep excluding it.
  "SearchableDropdownQuestion",
  // PC-A10: the Range family shares ONE bespoke renderer (renderRange) that
  // also never called fieldHelperLine despite CONTENT_PROP_FIELDS
  // advertising Helper text for all 3 — same drift class, same fix.
  "RangeQuestion",
  "CurrencyRangeQuestion",
  "NumberRangeQuestion",
];

describe("R3 S2-1/E1-C3 — button/other-group renderers consume size/corners/border", () => {
  for (const t of BUTTON_TYPES) {
    it(`${t}: width→group width, height→button min-height, corners→radius, border→role --lg-field-border (R5 state-safe)`, () => {
      const html = render(t, { design_overrides: OV });
      expect(html, "group width").toContain(`width:${CUSTOM_W}px`);
      expect(html, "button min-height").toContain(`min-height:${CUSTOM_H}px`);
      expect(html, "button radius").toContain(`border-radius:${RADIUS.pill}`);
      // R5 state-safe border (register R3a ROUTING NOTES): border_color now
      // rides the --lg-field-border custom property (presets.ts:1506), never
      // a direct inline border-color — a direct value would beat the
      // .lg-btn.lg-btn-answer:hover/[aria-checked="true"] state rules by
      // inline-style specificity.
      expect(html, "button role rides --lg-field-border, never a direct border-color").toContain(`--lg-field-border:${BRAND}`);
      expect(html, "buttons are state-safe: NO direct border-color").not.toContain(`border-color:${BRAND}`);
    });
    it(`${t}: NO design_overrides ⇒ none of the R3 inline styles (byte-additive)`, () => {
      const html = render(t);
      expect(html).not.toContain("min-height:");
      expect(html).not.toContain("border-radius:");
      expect(html).not.toContain(`width:${CUSTOM_W}px`);
    });
  }
});

describe("R3 S2-1/E1-C3 — card-grid renderers consume size/corners/border", () => {
  for (const t of CARD_TYPES) {
    it(`${t}: width→grid max-width, height→card min-height, corners→radius, border→role --lg-field-border (R5 state-safe)`, () => {
      const html = render(t, { design_overrides: OV });
      expect(html, "grid max-width").toContain(`max-width:${CUSTOM_W}px`);
      expect(html, "card min-height").toContain(`min-height:${CUSTOM_H}px`);
      expect(html, "card radius").toContain(`border-radius:${RADIUS.pill}`);
      // R5 state-safe border: same --lg-field-border idiom as the button
      // family above (presets.ts:1506) — never a direct border-color, so
      // .lg-card:hover/[aria-checked="true"]/[data-selected="true"] still win.
      expect(html, "card role rides --lg-field-border, never a direct border-color").toContain(`--lg-field-border:${BRAND}`);
      expect(html, "cards are state-safe: NO direct border-color").not.toContain(`border-color:${BRAND}`);
    });
    it(`${t}: NO design_overrides ⇒ no max-width / min-height / border-radius inline`, () => {
      const html = render(t);
      expect(html).not.toContain(`max-width:${CUSTOM_W}px`);
      expect(html).not.toContain(`min-height:${CUSTOM_H}px`);
      expect(html).not.toContain(`border-radius:${RADIUS.pill}`);
    });
  }
});

describe("R3 S2-1/E1-C3 — dropdown <select> consumes size/corners/border via the .lg-input idiom (--lg-field-border, state-safe)", () => {
  for (const t of DROPDOWN_TYPES) {
    it(`${t}: width/height + border-radius + --lg-field-border on the select`, () => {
      const html = render(t, { design_overrides: OV });
      expect(html, "select width").toContain(`width:${CUSTOM_W}px`);
      expect(html, "select height").toContain(`height:${CUSTOM_H}px`);
      expect(html, "select radius").toContain(`border-radius:${RADIUS.pill}`);
      expect(html, "select uses the custom property, never direct border-color").toContain(`--lg-field-border:${BRAND}`);
      expect(html, "dropdowns are state-safe: NO direct border-color").not.toContain(`border-color:${BRAND}`);
    });
  }
});

describe("R3 — corners enum → the grounded radius tokens (sharp/rounded/pill = 0/8px/20px)", () => {
  const cases: Array<[keyof typeof RADIUS, string]> = [
    ["sharp", RADIUS.sharp],
    ["rounded", RADIUS.rounded],
    ["pill", RADIUS.pill],
  ];
  for (const [corners, px] of cases) {
    it(`ButtonAnswerGroup corners=${corners} ⇒ border-radius:${px}`, () => {
      expect(render("ButtonAnswerGroup", { design_overrides: { corners } })).toContain(`border-radius:${px}`);
    });
    it(`DropdownQuestion corners=${corners} ⇒ border-radius:${px}`, () => {
      expect(render("DropdownQuestion", { design_overrides: { corners } })).toContain(`border-radius:${px}`);
    });
  }
});

describe("R3 — border_color role → the active design's own themed color", () => {
  const cases: Array<[string, string]> = [
    ["neutral", NEUTRAL],
    ["brand", BRAND],
    ["accent", ACCENT],
  ];
  for (const [role, hex] of cases) {
    // R5 state-safe border: ButtonAnswerGroup now matches DropdownQuestion's
    // own --lg-field-border idiom (both ride the custom property, never a
    // direct border-color) — see presets.ts choiceItemStyle.
    it(`ButtonAnswerGroup border_color=${role} ⇒ --lg-field-border:${hex}`, () => {
      const html = render("ButtonAnswerGroup", { design_overrides: { border_color: role } });
      expect(html).toContain(`--lg-field-border:${hex}`);
      expect(html, "state-safe: NO direct border-color").not.toContain(`border-color:${hex}`);
    });
    it(`DropdownQuestion border_color=${role} ⇒ --lg-field-border:${hex}`, () => {
      expect(render("DropdownQuestion", { design_overrides: { border_color: role } })).toContain(`--lg-field-border:${hex}`);
    });
  }
});

// R3 BLOCKER-1: every size preset is now GROUNDED (was inert with fake active
// feedback). WIDTH m/full grounded to §7.1 line 345 "384 (= 64% of the 600
// column)" + golden non-custom fieldWrapStyle 100%; s/l = 300/480 proposed
// errata (50%/80% of 600). HEIGHT small/medium/large = the §10.4 shared
// size-language control heights 44/52/60px. On ButtonAnswerGroup: width → group
// `width`, height → per-item `min-height` (the same idiom as the custom_px
// tests above). This is the fail-before/pass-after for the resolver fix.
describe("R3 BLOCKER-1 — every size preset resolves to its grounded px (no inert preset)", () => {
  const WIDTH_PX: Record<string, string> = { s: "width:300px", m: "width:384px", l: "width:480px", full: "width:100%" };
  for (const preset of ["s", "m", "l", "full"] as const) {
    it(`ButtonAnswerGroup width=${preset} ⇒ the group carries ${WIDTH_PX[preset]}`, () => {
      expect(render("ButtonAnswerGroup", { design_overrides: { size: { width: preset } } })).toContain(WIDTH_PX[preset]);
    });
  }
  const HEIGHT_PX: Record<string, string> = { small: "min-height:44px", medium: "min-height:52px", large: "min-height:60px" };
  for (const preset of ["small", "medium", "large"] as const) {
    it(`ButtonAnswerGroup height=${preset} ⇒ the buttons carry ${HEIGHT_PX[preset]}`, () => {
      expect(render("ButtonAnswerGroup", { design_overrides: { size: { height: preset } } })).toContain(HEIGHT_PX[preset]);
    });
  }
  it("an absent size override still emits NO size inline (byte-additive — only an explicit override renders)", () => {
    const html = render("ButtonAnswerGroup", {});
    expect(html).not.toMatch(/width:\d+px|width:100%/);
    expect(html).not.toContain("min-height:");
  });
});

// PC-A10 (drift honesty): grew from "the 7 advertising renderers" to 11 —
// SearchableDropdownQuestion (its exclusion was arbitrary, not a documented
// design choice — the register never actually said "7 only") plus the
// 3-member Range family (RangeQuestion/CurrencyRangeQuestion/
// NumberRangeQuestion), whose shared renderRange never called
// fieldHelperLine despite CONTENT_PROP_FIELDS advertising it. This pin
// derives every member from HELPER_TYPES above (not a hand-copied list), so
// a future CONTENT_PROP_FIELDS/renderer drift on any of these 11 goes RED
// here rather than silently reopening the gap this phase closed.
describe("R3/PC-A10 E1-NEW-8 — every advertised-Helper renderer actually renders the shared helper line", () => {
  for (const t of HELPER_TYPES) {
    it(`${t} renders lg-field-help when props.helper is set`, () => {
      const html = render(t, { props: { helper: "We keep this private" } });
      expect(html).toContain("lg-field-help");
      expect(html).toContain("We keep this private");
    });
    it(`${t} renders NO helper div without props.helper (byte-additive)`, () => {
      expect(render(t)).not.toContain("lg-field-help");
    });
  }
});

describe("R3 S2-8/E1-NEW-9/U9 — the leading-icon SVG map is complete (P1b: curated Tabler subset, register PC-11)", () => {
  it("the map keys equal the §8.1 enum exactly (now the curated ~100+ Tabler set, grown from the pre-Tabler 12)", () => {
    expect(Object.keys(LEADGEN_ICONS).sort()).toEqual([...LEADGEN_FIELD_LEADING_ICONS].sort());
    expect(Object.keys(LEADGEN_ICONS).length).toBeGreaterThan(12);
  });
  it("every non-'none' icon is a real currentColor SVG, sized ONLY via leadgenIconSvg (no width/height baked into the map)", () => {
    for (const id of LEADGEN_FIELD_LEADING_ICONS) {
      const svg = LEADGEN_ICONS[id]!;
      if (id === "none") {
        expect(svg, "none renders nothing").toBe("");
        continue;
      }
      expect(svg, `${id} present`).not.toBe("");
      expect(svg, `${id} viewBox`).toContain('viewBox="0 0 24 24"');
      expect(svg, `${id} currentColor`).toContain('stroke="currentColor"');
      expect(svg, `${id} carries no baked-in width/height in the raw map entry`).not.toMatch(/\swidth="|\sheight="/);
      const sized = leadgenIconSvg(id, 48);
      expect(sized, `${id} leadgenIconSvg(id,48) injects the requested size`).toContain('width="48" height="48"');
    }
  });
  it("a field renderer now paints a chosen icon (calendar), fixing U9's 11 dead icons", () => {
    const html = renderComponent(
      { type: "ZIPInputQuestion", question_id: "q", internal_field: "zip", answer_type: "string", props: { icon: "calendar" } } as unknown as LeadgenComponentNode,
      DESIGN,
    );
    expect(html).toContain("lg-field-icon");
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('width="20" height="20"');
  });
  it("E1-NEW-9: AddressAutocompleteQuestion now WIRES the leading icon (previously dead even for 'location')", () => {
    const html = renderComponent(
      { type: "AddressAutocompleteQuestion", question_id: "q", internal_field: "addr", answer_type: "string", props: { icon: "location" } } as unknown as LeadgenComponentNode,
      DESIGN,
    );
    expect(html).toContain("lg-field-icon");
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('width="20" height="20"');
  });
  it("Address WITHOUT props.icon stays byte-additive (no icon markup)", () => {
    const html = renderComponent(
      { type: "AddressAutocompleteQuestion", question_id: "q", internal_field: "addr", answer_type: "string" } as unknown as LeadgenComponentNode,
      DESIGN,
    );
    expect(html).not.toContain("lg-field-icon");
  });
});

describe("R3 S2-6 — the island paints the Border-color role swatches (previously empty)", () => {
  it("BORDER_SWATCH_ROLE maps the 3 border roles onto the funnel token roles the renderer resolves", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain("var BORDER_SWATCH_ROLE = { neutral: 'border', brand: 'brand_primary', accent: 'accent' }");
  });
  it("populateCornersBorderControls paints [data-border-swatch] from ROLE_VALUES", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain("querySelectorAll('[data-border-swatch]')");
    expect(SECTION_STUDIO_SCRIPT).toContain("swatches[i].style.background = ROLE_VALUES[roleKey]");
  });
});

describe("R3a (conductor-ruled addition) — CurrencyInputQuestion: consumption-honesty gates the leading-icon Content control off", () => {
  it("renderCurrencyInputQuestion ignores props.icon — no lg-field-icon markup even when an icon id is authored (the $ prefix owns the left-inset slot)", () => {
    const html = render("CurrencyInputQuestion", { props: { icon: "calendar" } });
    expect(html).not.toContain("lg-field-icon");
    expect(html).toContain("lg-currency-prefix");
  });
  it("CurrencyInputQuestion IS one of the 8 Accept-swappable types (so it would otherwise wrongly inherit the leading-icon control by the generic acceptFmt gate)", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain("CurrencyInputQuestion: 'currency',");
  });
  it("the island specifically excludes CurrencyInputQuestion from the leading-icon Content control (never showing a control its renderer ignores)", () => {
    expect(SECTION_STUDIO_SCRIPT).toContain(
      "iconWrap.hidden = acceptFmt === null || (!!node && node.type === 'CurrencyInputQuestion');",
    );
  });
});
