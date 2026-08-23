// OWNER 2026-08-23 (Leadgen → Quotes → Theme): "support the following:
//   1. Margins (in px)
//   2. Padding (in px)
//   3. Borders (Size & Radius)
//   4. Component's Height
//  This should allow the user to set and adjust the layout itself and also the
//  sections' components on it to their liking."
// Compared against a competitor (Best Money) whose answer buttons are
// full-width, roughly twice as tall, with a bigger radius and far more padding.
//
// FAIL-BEFORE, measured on his live moneylantern.com/lg/business-loans at 414px:
// answer buttons 52px tall (the `m` step — the tallest of the three words on
// offer was 60), radius 10px, rows 12px apart, and NO control at all for
// padding, border width, or any px value anywhere in the Theme tab. The rail
// offered only coarse words: Spacing compact|regular|roomy, Corners
// sharp|soft|round, Button height s|m|l, Field height small|medium|large.
//
// TWO SCOPES, matching his sentence: card_defaults IS "the layout itself",
// button_defaults IS "the components on it" (an answer button and an input field
// share this design's box tokens, so one number moves both — see §10.4 "the
// SHARED SIZE LANGUAGE").
import { describe, expect, it } from "vitest";
import {
  THEME_PX_RANGES,
  readCardMarginY,
  resolveTokens,
  validateTheme,
} from "../src/public/leadgen/designs/theme";
import type { ThemeJson, ThemePxKey } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { funnelChromeCss, DEFAULT_FUNNEL_SCOPE } from "../src/public/leadgen/designs/default-funnel/styles";
import { renderThemesTabPanel } from "../src/admin/leadgen/quotes-tabs/themes";

const BASE = defaultFunnelDesign;
const design = (theme: ThemeJson) => resolveTokens(BASE, theme).design;
const css = (theme: ThemeJson) => funnelChromeCss(design(theme), DEFAULT_FUNNEL_SCOPE);
const BARE = design({});

// His live numbers, so a regression that quietly restores the old ceilings is
// caught by the values he actually complained about.
const HIS_MEASURED = { buttonHeight: "52px", buttonRadius: "10px", rowGapMobile: "12px" };

describe("Theme px axes — the four the owner named exist and are numeric (2026-08-23)", () => {
  it("the base design still paints exactly what he measured, so the before-numbers are real", () => {
    expect(BARE.primaryButton.minHeight).toBe(HIS_MEASURED.buttonHeight);
    expect(BARE.primaryButton.borderRadius).toBe(HIS_MEASURED.buttonRadius);
    expect(BARE.answerGrid.gapMobile).toBe(HIS_MEASURED.rowGapMobile);
  });

  it("COMPONENT height in px goes past the old s|m|l ceiling of 60px", () => {
    const d = design({ button_defaults: { min_height_px: 96 } });
    expect(d.primaryButton.minHeight).toBe("96px");
    // …and the field box comes with it: one control, one shared look.
    expect(d.input.minHeight).toBe("96px");
    // 96 is beyond every word the rail used to offer.
    expect(Number(BARE.primaryButton.minHeight.replace("px", ""))).toBeLessThan(96);
  });

  it("COMPONENT padding, border thickness and radius in px reach the button, the field AND the answer card", () => {
    const d = design({
      button_defaults: { padding_px: 24, border_width_px: 3, radius_px: 20 },
    });
    expect([d.primaryButton.paddingY, d.primaryButton.paddingX]).toEqual(["24px", "24px"]);
    expect(d.input.padding).toBe("24px");
    expect(d.primaryButton.borderRadius).toBe("20px");
    expect(d.input.borderRadius).toBe("20px");
    // the icon/image answer CARD is the same answer surface in another shape
    expect(d.iconCard.borderRadius).toBe("20px");
    // border WIDTH only — the colour channel of the shorthand is preserved
    expect(d.input.border).toBe("3px solid #D2D9E5");
    expect(d.iconCard.border).toBe("3px solid #D2D9E5");
  });

  it("COMPONENT margins in px move every gap between components, not half of them", () => {
    const d = design({ button_defaults: { gap_px: 28 } });
    expect(d.answerGrid.gap).toBe("28px");
    // the MOBILE gap too — his own funnel's 12px rows are the mobile arm, so an
    // axis that skipped it would not move the thing he is looking at
    expect(d.answerGrid.gapMobile).toBe("28px");
    // …and the card's inter-component stack floor
    expect(d.spacing.stack).toBe("28px");
    expect(d.spacing.stackMobile).toBe("28px");
  });

  it("LAYOUT padding, border, radius and margin in px reach the question card a visitor sees", () => {
    const d = design({
      card_defaults: { padding_px: 20, border_width_px: 2, radius_px: 24, margin_px: 40 },
    });
    // one number means one number, at BOTH breakpoints (the base tokens are
    // asymmetric 3-value shorthands the operator cannot see)
    expect(d.questionCard.paddingDesktop).toBe("20px");
    expect(d.questionCard.paddingMobile).toBe("20px");
    expect(d.questionCard.border).toBe("2px solid #E9EDF3");
    expect(d.questionCard.borderRadius).toBe("24px");
    expect(readCardMarginY(d)).toBe("40px");
    // …and each one lands in the rule that paints that card
    const rule = css({ card_defaults: { padding_px: 20, border_width_px: 2, radius_px: 24, margin_px: 40 } })
      .match(/\.lg-question-card\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("padding:20px");
    expect(rule).toContain("border:2px solid #E9EDF3");
    expect(rule).toContain("border-radius:24px");
    expect(rule).toContain("margin-top:40px");
    expect(rule).toContain("margin-bottom:40px");
  });

  it("a px value WINS over its coarse-step sibling — a typed number is the more specific instruction", () => {
    const both = design({
      button_defaults: { min_height_px: 88, min_height: "s", radius_px: 18, radius: "sm" },
      card_defaults: { radius_px: 30, radius: "sm" },
    });
    expect(both.primaryButton.minHeight).toBe("88px");
    expect(both.primaryButton.borderRadius).toBe("18px");
    expect(both.questionCard.borderRadius).toBe("30px");
  });
});

describe("Theme px axes — the full-width `list` layout obeys them too (found by driving)", () => {
  // FAIL-BEFORE: the list arm's own selector (2 classes + an attribute) beats
  // the token-reading `.lg-btn` rule (one class), and it hardcoded
  // min-height:56px / padding:1rem 1.5rem. DRIVEN at 414px, a typed Height 96 +
  // Padding 24 painted 56px and 16px — the two axes the owner cares most about
  // were dead in exactly the layout his competitor reference uses.
  const listRule = (theme: ThemeJson): string =>
    css(theme).match(/\.lg-answer-group\[data-btn-layout="list"\] \.lg-btn-answer\{[^}]*\}/)?.[0] ?? "";

  it("a typed Height and Padding reach the list arm", () => {
    const r = listRule({ button_defaults: { layout: "list", min_height_px: 96, padding_px: 24 } });
    expect(r).toContain("min-height:96px");
    expect(r).toContain("padding:24px");
    expect(r).not.toContain("min-height:56px");
  });

  it("…and with NO px axis typed, that arm keeps its own literals byte-for-byte", () => {
    // The literals differ from the token defaults (52px / 14px 16px), so reading
    // the tokens unconditionally would have restyled every funnel already on
    // list layout. This is the leg that would catch that.
    const r = listRule({ button_defaults: { layout: "list" } });
    expect(r).toContain("min-height:56px");
    expect(r).toContain("padding:1rem 1.5rem");
  });

  it("one axis typed does not drag the other off its literal", () => {
    const onlyHeight = listRule({ button_defaults: { layout: "list", min_height_px: 80 } });
    expect(onlyHeight).toContain("min-height:80px");
    expect(onlyHeight).toContain("padding:1rem 1.5rem");
    const onlyPadding = listRule({ button_defaults: { layout: "list", padding_px: 30 } });
    expect(onlyPadding).toContain("min-height:56px");
    expect(onlyPadding).toContain("padding:30px");
  });
});

describe("Theme px axes — a number, and only a number (§14.10 no-arbitrary-CSS holds)", () => {
  const KEYS: Array<[string, string, ThemePxKey]> = [
    ["button_defaults", "min_height_px", "min_height_px"],
    ["button_defaults", "padding_px", "padding_px"],
    ["button_defaults", "border_width_px", "border_width_px"],
    ["button_defaults", "radius_px", "radius_px"],
    ["button_defaults", "gap_px", "gap_px"],
    ["card_defaults", "margin_px", "margin_px"],
    ["card_defaults", "padding_px", "padding_px"],
    ["card_defaults", "border_width_px", "border_width_px"],
    ["card_defaults", "radius_px", "radius_px"],
  ];

  it("every axis accepts its whole range's ends and refuses one step outside", () => {
    for (const [group, key, rangeKey] of KEYS) {
      const { min, max } = THEME_PX_RANGES[rangeKey];
      for (const ok of [min, max, Math.floor((min + max) / 2)]) {
        const res = validateTheme({ [group]: { [key]: ok } });
        expect(res.problems.filter((p) => p.severity === "error"), `${group}.${key} = ${ok}`).toEqual([]);
      }
      for (const bad of [min - 1, max + 1]) {
        const res = validateTheme({ [group]: { [key]: bad } });
        const err = res.problems.find((p) => p.severity === "error" && p.path === `theme.${group}.${key}`);
        expect(err, `${group}.${key} = ${bad} must be refused`).toBeDefined();
        // the message tells the operator the range instead of making them guess
        expect(err!.message).toContain(String(min));
        expect(err!.message).toContain(String(max));
      }
    }
  });

  it("a CSS STRING is refused — this is the whole reason a px axis can be safe at all", () => {
    for (const value of ["16px", "1rem", "calc(100% - 4px)", "12", "</style><script>alert(1)</script>"]) {
      const res = validateTheme({ button_defaults: { padding_px: value } });
      const err = res.problems.find((p) => p.severity === "error" && p.path === "theme.button_defaults.padding_px");
      expect(err, `${JSON.stringify(value)} must be refused`).toBeDefined();
      expect(err!.message).toContain("just the number, no units");
    }
    // …and nothing string-shaped can reach the sheet even if a corrupted blob
    // bypassed the validator: the render side re-checks and drops it.
    const sneaky = css({ button_defaults: { radius_px: "8px</style><script>x" } } as never);
    expect(sneaky).not.toContain("<script");
    expect(sneaky).not.toContain("</style>");
  });

  it("a fraction is refused — the operator's spinner and the validator agree on whole pixels", () => {
    const res = validateTheme({ card_defaults: { radius_px: 12.5 } });
    expect(res.problems.some((p) => p.severity === "error" && /whole number/.test(p.message))).toBe(true);
  });

  it("an out-of-range value that somehow reached storage paints NOTHING rather than a bad box", () => {
    // defense in depth: the same discipline safeThemeRecordFontStack applies to
    // fonts. 999px is refused at save; if a corrupted record carried it, the
    // renderer falls back to the base token instead of emitting it.
    const d = design({ button_defaults: { min_height_px: 999 } } as never);
    expect(d.primaryButton.minHeight).toBe(BARE.primaryButton.minHeight);
  });
});

describe("Theme px axes — absent means absent (byte-identical for every funnel that sets none)", () => {
  it("no px axis authored ⇒ the sheet is byte-identical to the pre-change sheet", () => {
    // The whole sheet, not a sampled rule: any leaked default would show here.
    expect(css({})).toBe(funnelChromeCss(BARE, DEFAULT_FUNNEL_SCOPE));
    const rule = css({}).match(/\.lg-question-card\{[^}]*\}/)?.[0] ?? "";
    expect(rule).not.toContain("margin-top");
    expect(rule).not.toContain("margin-bottom");
  });

  it("the card margin never becomes a design TOKEN — the public config blob is untouched", () => {
    // A new token key is serialized into #lg-config for every visitor on every
    // funnel (leadgen-frame-legacy-pin.test.ts caught exactly that during this
    // change). The Symbol stash is skipped by JSON.stringify.
    const themed = design({ card_defaults: { margin_px: 40 } });
    expect(readCardMarginY(themed)).toBe("40px");
    expect(JSON.stringify(themed.questionCard)).toBe(JSON.stringify(BARE.questionCard));
    expect(Object.keys(themed.questionCard)).toEqual(Object.keys(BARE.questionCard));
  });
});

describe("Theme px axes — the operator's controls (Quotes → Theme)", () => {
  const PANEL = renderThemesTabPanel(true, []);

  it("all nine are number inputs, range-bounded, under the headings they belong to", () => {
    for (const key of [
      "button_defaults.min_height_px",
      "button_defaults.padding_px",
      "button_defaults.gap_px",
      "button_defaults.border_width_px",
      "button_defaults.radius_px",
      "card_defaults.padding_px",
      "card_defaults.margin_px",
      "card_defaults.border_width_px",
      "card_defaults.radius_px",
    ]) {
      const m = PANEL.match(new RegExp(`<input[^>]*data-theme-key="${key.replace(".", "\\.")}"[^>]*>`));
      expect(m, `${key} must have a control`).not.toBeNull();
      const tag = m![0];
      expect(tag, `${key} is a number input`).toContain('type="number"');
      expect(tag, `${key} carries its range`).toMatch(/min="\d+"/);
      expect(tag).toMatch(/max="\d+"/);
      expect(tag, `${key} steps in whole pixels`).toContain('step="1"');
      // blank = inherit, the same resting state every select in this rail has
      expect(tag).toContain('placeholder="Inherit from base"');
    }
  });

  it("each input's min/max IS the validator's range — one table, no third opinion", () => {
    const pairs: Array<[string, ThemePxKey]> = [
      ["button_defaults.min_height_px", "min_height_px"],
      ["button_defaults.padding_px", "padding_px"],
      ["button_defaults.border_width_px", "border_width_px"],
      ["button_defaults.radius_px", "radius_px"],
      ["button_defaults.gap_px", "gap_px"],
      ["card_defaults.margin_px", "margin_px"],
    ];
    for (const [key, rangeKey] of pairs) {
      const { min, max } = THEME_PX_RANGES[rangeKey];
      const tag = PANEL.match(new RegExp(`<input[^>]*data-theme-key="${key.replace(".", "\\.")}"[^>]*>`))![0];
      expect(tag, `${key} min`).toContain(`min="${min}"`);
      expect(tag, `${key} max`).toContain(`max="${max}"`);
    }
  });

  it("the copy is plain words — it says what the number does, never a storage key", () => {
    expect(PANEL).toContain("Size &amp; spacing in pixels");
    expect(PANEL).toContain("they share one look, so a number here moves both");
    expect(PANEL).toContain("A number typed here wins over the pickers above");
    expect(PANEL).toContain("The gap between one answer and the next.");
    expect(PANEL).toContain("The space above and below the card.");
    // never the stored key at a person
    expect(PANEL).not.toContain(">min_height_px<");
    expect(PANEL).not.toContain("border_width_px<");
  });
});
