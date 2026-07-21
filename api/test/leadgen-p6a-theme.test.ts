// Round-4 P6a — THEME v2 (operator decision D-7). Proves the four P6a
// deliverables at the PURE module level (resolveTokens → funnelChromeCss /
// presets, the real producer → consumer path):
//   1. self-hosted fonts   — widened THEME_FONT_IDS + @font-face emitted for a
//      referenced self-hosted family, same-origin data: src, ZERO external URL;
//   2. size ramp           — a display-only ramp (typography.display_size) with
//      a display-XXL tier (~72px) that never enlarges body copy;
//   3. button styles       — the fill/list/mark vocabulary (Images 38-40) as
//      theme defaults, each producing a DISTINCT CSS/markup signature;
//   4. back-compat         — a v1 theme (old fonts, 3-step size, old
//      button_defaults) triggers NONE of the new machinery (byte-comparable).
//
// PURE: no DB/KV — theme.ts/styles.ts/presets.ts are pure given (design,
// theme). The design object resolveTokens returns is the SAME object
// serve.ts feeds funnelChromeCss + the section renderers, so exercising them
// directly proves the live path minus the (serve.ts-owned) HTTP wiring.

import { describe, expect, it } from "vitest";
import {
  resolveTokens,
  validateTheme,
  readButtonStyle,
  baseTokenForRole,
  FUNNEL_TOKEN_ROLES,
  THEME_FONT_IDS,
  THEME_FONT_STACKS,
  THEME_DISPLAY_SIZE_SCALES,
  THEME_DISPLAY_SIZE_FACTORS,
  THEME_BUTTON_STYLES,
  THEME_BUTTON_LAYOUTS,
  THEME_BUTTON_SELECTED_STYLES,
  THEME_RECORD_ROLE_TO_TOKEN_ROLE,
  THEME_RECORD_EXTRA_ROLE_KEYS,
  THEME_RECORD_EXTRA_ROLE_TO_TOKEN_ROLE,
  THEME_RECORD_FONT_NAMES,
  type ThemeJson,
  type ThemeRecord,
} from "../src/public/leadgen/designs/theme";
import { funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import {
  renderButtonAnswerGroup,
  renderIconCardAnswerGrid,
  renderContinueButton,
} from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import {
  LEADGEN_SELF_HOSTED_FONT_FAMILIES,
  selfHostedFontFaceCss,
} from "../src/public/leadgen/designs/fonts.generated";

const base = defaultFunnelDesign;
// resolveTokens returns a widened design; funnelChromeCss/presets accept it.
type AnyDesign = Parameters<typeof funnelChromeCss>[0];
type AnyNode = Parameters<typeof renderButtonAnswerGroup>[0];

function effDesign(theme: ThemeJson): AnyDesign {
  return resolveTokens(base, theme).design as AnyDesign;
}
function css(design: AnyDesign): string {
  return funnelChromeCss(design, '[data-funnel-design="default-funnel"]');
}

const CHOICES = [
  { label: "Sole Proprietor", value: "sole_prop", analytics_id: "biz_sole" },
  { label: "Partnership", value: "partnership", analytics_id: "biz_partner" },
];
const ICON_CHOICES = CHOICES.map((c) => ({ ...c, icon: "🏢" }));
const bagNode = { type: "ButtonAnswerGroup", question_id: "q", internal_field: "pick", choices: CHOICES } as unknown as AnyNode;
const cardNode = { type: "IconCardAnswerGrid", question_id: "q", internal_field: "biz", choices: ICON_CHOICES, props: { columns: 3 } } as unknown as AnyNode;
const continueNode = { type: "ContinueButton", question_id: "c", props: { label: "Continue" } } as unknown as AnyNode;

// ===========================================================================
// Deliverable 1 — self-hosted fonts (same-origin, zero external requests)
// ===========================================================================

describe("P6a deliverable 1 — self-hosted font set", () => {
  it("THEME_FONT_IDS keeps the 3 back-compat ids and widens to the self-hosted families", () => {
    for (const id of ["literata", "sora", "system"]) expect(THEME_FONT_IDS).toContain(id);
    for (const id of ["poppins", "space_grotesk", "fraunces", "playfair", "manrope", "dm_sans", "work_sans", "lexend"]) {
      expect(THEME_FONT_IDS).toContain(id);
    }
    // every id has a CSS stack
    for (const id of THEME_FONT_IDS) expect(typeof THEME_FONT_STACKS[id]).toBe("string");
  });

  it("validateTheme accepts a self-hosted display/body font and rejects an unknown one", () => {
    expect(validateTheme({ typography: { display: "poppins", body: "manrope" } }).problems).toHaveLength(0);
    expect(validateTheme({ typography: { display: "comicsans" } }).problems[0]?.path).toBe("theme.typography.display");
  });

  it("the base design (Sora/Literata/Newsreader) emits NO @font-face — none of those is self-hosted", () => {
    expect(css(base as AnyDesign)).not.toContain("@font-face");
  });

  it("a theme picking a self-hosted family emits its @font-face with a same-origin data: src and NO external URL", () => {
    const sheet = css(effDesign({ typography: { display: "poppins" } }));
    expect(sheet).toContain("@font-face");
    expect(sheet).toContain("font-family:'Poppins'");
    expect(sheet).toContain("src:url(\"data:font/woff2;base64,");
    // hard security gate — zero external font requests
    expect(sheet).not.toContain("fonts.googleapis.com");
    expect(sheet).not.toContain("fonts.gstatic.com");
    expect(sheet).not.toMatch(/src:\s*url\(["']?https?:/i);
  });

  it("selfHostedFontFaceCss emits for known families in a deterministic order, skips unknown, empty for none", () => {
    expect(selfHostedFontFaceCss([])).toBe("");
    expect(selfHostedFontFaceCss(["NotAFont"])).toBe("");
    const one = selfHostedFontFaceCss(["Poppins"]);
    expect(one).toContain("font-family:'Poppins'");
    // order is the registry order regardless of caller order
    const a = selfHostedFontFaceCss(["Manrope", "Poppins"]);
    const b = selfHostedFontFaceCss(["Poppins", "Manrope"]);
    expect(a).toBe(b);
    expect(a.indexOf("'Poppins'")).toBeLessThan(a.indexOf("'Manrope'"));
  });

  it("the self-hosted set EXCLUDES the base-design families (byte-compat guard)", () => {
    for (const forbidden of ["Sora", "Literata", "Newsreader", "Inter", "Roboto Mono"]) {
      expect(LEADGEN_SELF_HOSTED_FONT_FAMILIES).not.toContain(forbidden);
    }
  });
});

// ===========================================================================
// Deliverable 2 — the display size ramp (display-XXL ~72px, body untouched)
// ===========================================================================

describe("P6a deliverable 2 — display size ramp", () => {
  it("display_size is a closed enum m..xxl", () => {
    expect([...THEME_DISPLAY_SIZE_SCALES]).toEqual(["m", "l", "xl", "xxl"]);
    expect(validateTheme({ typography: { display_size: "xxl" } }).problems).toHaveLength(0);
    expect(validateTheme({ typography: { display_size: "huge" } }).problems[0]?.path).toBe("theme.typography.display_size");
  });

  it("display_size=xxl scales the headline to ~72px WITHOUT enlarging body copy", () => {
    const d = resolveTokens(base, { typography: { display_size: "xxl" } }).design;
    // 31px * 2.3 = 71.3px  (the operator's Image37 display-XXL)
    expect(d.headline.fontSizeDesktop).toBe("71.3px");
    expect(Number.parseFloat(d.headline.fontSizeDesktop)).toBeGreaterThan(68);
    expect(Number.parseFloat(d.headline.fontSizeDesktop)).toBeLessThan(76);
    // BODY tokens are untouched (the whole point of a display-only ramp)
    expect(d.subheadline.fontSize).toBe(base.subheadline.fontSize);
    expect(d.page.fontFamily).toBe(base.page.fontFamily);
    expect(css(d as AnyDesign)).toContain("font-size:71.3px");
  });

  it("display_size=m (default) is the identity — headline byte-identical to base", () => {
    const d = resolveTokens(base, { typography: { display_size: "m" } }).design;
    expect(d.headline.fontSizeDesktop).toBe(base.headline.fontSizeDesktop);
    const dAbsent = resolveTokens(base, {}).design;
    expect(dAbsent.headline.fontSizeDesktop).toBe(base.headline.fontSizeDesktop);
  });

  it("the intermediate tiers ramp up (l < xl < xxl)", () => {
    const px = (s: "l" | "xl" | "xxl"): number =>
      Number.parseFloat(resolveTokens(base, { typography: { display_size: s } }).design.headline.fontSizeDesktop);
    expect(px("l")).toBeLessThan(px("xl"));
    expect(px("xl")).toBeLessThan(px("xxl"));
  });
});

// ===========================================================================
// Deliverable 3 — the button-style vocabulary (Images 38-40), distinct looks
// ===========================================================================

describe("P6a deliverable 3 — button-style sub-schema", () => {
  it("fill/layout/selected are closed enums with precise validation paths", () => {
    expect([...THEME_BUTTON_STYLES]).toEqual(["fill", "outline", "soft"]);
    expect([...THEME_BUTTON_LAYOUTS]).toEqual(["grid", "list"]);
    expect([...THEME_BUTTON_SELECTED_STYLES]).toEqual(["wash", "mark"]);
    expect(validateTheme({ button_defaults: { fill: "soft" } }).problems).toHaveLength(0);
    expect(validateTheme({ button_defaults: { fill: "glossy" } }).problems[0]?.path).toBe("theme.button_defaults.fill");
    expect(validateTheme({ button_defaults: { layout: "masonry" } }).problems[0]?.path).toBe("theme.button_defaults.layout");
    expect(validateTheme({ button_defaults: { selected: "glow" } }).problems[0]?.path).toBe("theme.button_defaults.selected");
  });

  it("resolveTokens stashes a non-default triple on the design; a default theme stashes nothing", () => {
    expect(readButtonStyle(resolveTokens(base, { button_defaults: { fill: "soft" } }).design)).toEqual({
      fill: "soft",
      layout: "grid",
      selected: "wash",
    });
    expect(readButtonStyle(resolveTokens(base, { button_defaults: { layout: "list", selected: "mark" } }).design)).toEqual({
      fill: "fill",
      layout: "list",
      selected: "mark",
    });
    // all-default (or absent) button_defaults ⇒ no stash
    expect(readButtonStyle(resolveTokens(base, { button_defaults: { casing: "upper" } }).design)).toBeUndefined();
    expect(readButtonStyle(resolveTokens(base, {}).design)).toBeUndefined();
    expect(readButtonStyle(base)).toBeUndefined();
  });

  it("Image 39 (soft): distinct CSS — pill radius + soft shadow on buttons; presets stamp data-btn-fill", () => {
    const sheet = css(effDesign({ button_defaults: { fill: "soft" } }));
    expect(sheet).toContain('.lg-continue[data-btn-fill="soft"]');
    expect(sheet).toContain('.lg-answer-group[data-btn-fill="soft"] .lg-btn-answer');
    expect(sheet).toContain("border-radius:9999px");
    expect(renderContinueButton(continueNode, effDesign({ button_defaults: { fill: "soft" } }) as never)).toContain('data-btn-fill="soft"');
  });

  it("Image 38 (list): distinct CSS — single-column list buttons; card grid becomes a two-line list", () => {
    const sheet = css(effDesign({ button_defaults: { layout: "list" } }));
    expect(sheet).toContain('.lg-answer-group[data-btn-layout="list"]');
    expect(sheet).toContain('.lg-card-grid[data-btn-layout="list"]');
    expect(sheet).toContain("grid-template-columns:1fr");
    expect(renderButtonAnswerGroup(bagNode, effDesign({ button_defaults: { layout: "list" } }) as never)).toContain('data-btn-layout="list"');
  });

  it("Image 40 (mark): distinct CSS — scale-up + check badge; presets render the .lg-card-check", () => {
    const design = effDesign({ button_defaults: { selected: "mark" } });
    const sheet = css(design);
    expect(sheet).toContain('.lg-card-grid[data-card-select="mark"]');
    expect(sheet).toContain("transform:scale(1.03)");
    expect(sheet).toContain(".lg-card-check");
    const markup = renderIconCardAnswerGrid(cardNode, design as never);
    expect(markup).toContain('data-card-select="mark"');
    expect(markup).toContain('class="lg-card-check"');
  });

  it("the three looks + default are mutually distinct chrome sheets", () => {
    const def = css(base as AnyDesign);
    const soft = css(effDesign({ button_defaults: { fill: "soft" } }));
    const outline = css(effDesign({ button_defaults: { fill: "outline" } }));
    const list = css(effDesign({ button_defaults: { layout: "list" } }));
    const mark = css(effDesign({ button_defaults: { selected: "mark" } }));
    const all = [def, soft, outline, list, mark];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(all[i]).not.toBe(all[j]);
  });
});

// ===========================================================================
// Deliverable 4 — back-compat: a v1 theme triggers NONE of the new machinery
// ===========================================================================

describe("P6a deliverable 4 — v1 back-compat (byte-comparable)", () => {
  // A fully-populated v1 theme: old font ids, 3-step size, old button_defaults.
  const v1: ThemeJson = {
    version: 1,
    palette: { brand_primary: "#123456" },
    typography: { display: "literata", body: "sora", size: "l" },
    scales: { spacing: "roomy", radius: "round", shadow: "high" },
    button_defaults: { background_role: "accent", radius: "full", min_height: "l", casing: "upper" },
    card_defaults: { background_role: "card_background", radius: "lg", shadow: "lg" },
  };

  it("a v1 theme validates clean (no new required fields)", () => {
    expect(validateTheme(v1).problems.filter((p) => p.severity === "error")).toHaveLength(0);
  });

  it("a v1 theme references no self-hosted family ⇒ its chrome sheet carries NO @font-face", () => {
    expect(css(effDesign(v1))).not.toContain("@font-face");
  });

  it("a v1 theme sets no button style ⇒ NO stash, NO data-btn attributes, NO button-style CSS rules", () => {
    const d = resolveTokens(base, v1).design;
    expect(readButtonStyle(d)).toBeUndefined();
    const sheet = css(d as AnyDesign);
    expect(sheet).not.toContain("data-btn-fill");
    expect(sheet).not.toContain("data-btn-layout");
    expect(sheet).not.toContain("data-card-select");
    // presets emit no new attributes either
    expect(renderButtonAnswerGroup(bagNode, d as never)).not.toContain("data-btn-");
    expect(renderIconCardAnswerGrid(cardNode, d as never)).not.toContain("lg-card-check");
    expect(renderContinueButton(continueNode, d as never)).not.toContain("data-btn-fill");
  });

  it("an ABSENT theme is the identity — design deep-equals base; chrome has no P6 additions", () => {
    const d = resolveTokens(base, {}).design;
    expect(d).toEqual(base);
    const sheet = css(d as AnyDesign);
    expect(sheet).not.toContain("@font-face");
    expect(sheet).not.toContain("data-btn-fill");
    expect(sheet).not.toContain(".lg-card-check");
  });
});

// ===========================================================================
// FOLLOW-ON (coordinator ruling) — ThemeRecord (the KV preset type) carries
// the SAME v2 axes inline theme_json supports, so "author a rich theme →
// save as preset → apply via {theme_id}" does not silently drop the P6a
// richness. Proves: (a) the widened schema shape; (b) preset-vs-inline
// PARITY for the new font / display ramp / button-style axes; (c) the full
// 14-role palette via extra_roles; (d) a legacy 7-role/3-font/no-new-axes
// record resolves byte-identical to pre-P6; (e) defense-in-depth for each
// new field (no write-time validator exists yet — that is P6b's job).
// ===========================================================================

// A legacy (pre-P6) ThemeRecord — EXACTLY the shape that existed before this
// follow-on: 7 roles, one of the original 3 fonts, no extra_roles/
// button_style/display_size keys AT ALL (not merely undefined values —
// genuinely absent, matching a real pre-P6 KV blob).
const LEGACY_RECORD: ThemeRecord = {
  id: "thm_legacy",
  name: "Legacy preset",
  roles: {
    brand_primary: "#1B3A5C",
    accent: "#F5C518",
    page_bg: "#F4F6F9",
    card: "#FFFFFF",
    text: "#1A1F36",
    success: "#0E7C3A",
    error: "#B23A2C",
  },
  typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
  controls: { field_height: "large", button_size: "l", corners: "pill" },
};

// A RICH (post-P6) ThemeRecord authoring all three new-axis deliverables at
// once: a new self-hosted headline font, the display-XXL ramp, and a button
// style — the exact "save-as-preset" scenario the coordinator's ruling names.
const RICH_RECORD: ThemeRecord = {
  ...LEGACY_RECORD,
  id: "thm_rich",
  name: "Rich preset",
  typography: { headline_font: "Poppins", body_font: "Inter", base_px: 16, display_size: "xxl" },
  button_style: { fill: "soft", layout: "list", selected: "mark" },
};

describe("P6a follow-on — ThemeRecord carries the v2 axes (preset parity)", () => {
  it("THEME_RECORD_FONT_NAMES keeps the 3 back-compat names and widens with the 8 self-hosted families", () => {
    for (const name of ["Newsreader", "Inter", "Roboto Mono"]) expect(THEME_RECORD_FONT_NAMES).toContain(name);
    for (const name of ["Poppins", "Space Grotesk", "Fraunces", "Playfair Display", "Manrope", "DM Sans", "Work Sans", "Lexend"]) {
      expect(THEME_RECORD_FONT_NAMES).toContain(name);
    }
  });

  it("the original 7 + extra 7 record role keys together cover ALL 14 FUNNEL_TOKEN_ROLES with no overlap", () => {
    const combined = [
      ...Object.values(THEME_RECORD_ROLE_TO_TOKEN_ROLE),
      ...Object.values(THEME_RECORD_EXTRA_ROLE_TO_TOKEN_ROLE),
    ];
    expect(combined.sort()).toEqual([...FUNNEL_TOKEN_ROLES].sort());
    expect(new Set(combined).size).toBe(14);
    expect(THEME_RECORD_EXTRA_ROLE_KEYS).toHaveLength(7);
  });

  // --- (b) preset-vs-inline parity for the 3 new-axis deliverables ---------

  it("PARITY — a record's new self-hosted headline font resolves the SAME stack string as the inline id", () => {
    const viaRecord = resolveTokens(base, { theme_id: "thm_rich" }, null, RICH_RECORD).design;
    const viaInline = resolveTokens(base, { typography: { display: "poppins" } }).design;
    expect(viaRecord.page.fontDisplay).toBe(THEME_FONT_STACKS.poppins);
    expect(viaRecord.page.fontDisplay).toBe(viaInline.page.fontDisplay);
  });

  it("PARITY — a record's display_size:xxl scales the headline to the SAME ~72px as the inline axis (body untouched)", () => {
    const viaRecord = resolveTokens(base, { theme_id: "thm_rich" }, null, RICH_RECORD).design;
    const viaInline = resolveTokens(base, { typography: { display: "poppins", display_size: "xxl" } }).design;
    expect(viaRecord.headline.fontSizeDesktop).toBe(viaInline.headline.fontSizeDesktop);
    expect(viaRecord.headline.fontSizeDesktop).toBe("71.3px");
    // body untouched on the record path too (display-only ramp, same as inline)
    expect(viaRecord.subheadline.fontSize).toBe(base.subheadline.fontSize);
  });

  it("PARITY — a record's button_style resolves the SAME stashed triple as the inline button_defaults", () => {
    const viaRecord = resolveTokens(base, { theme_id: "thm_rich" }, null, RICH_RECORD).design;
    const viaInline = resolveTokens(base, {
      button_defaults: { fill: "soft", layout: "list", selected: "mark" },
    }).design;
    expect(readButtonStyle(viaRecord)).toEqual({ fill: "soft", layout: "list", selected: "mark" });
    expect(readButtonStyle(viaRecord)).toEqual(readButtonStyle(viaInline));
  });

  it("a record's OWN body_font (Inter, an original-3 name) applies independently of the new headline font", () => {
    const { design } = resolveTokens(base, { theme_id: "thm_rich" }, null, RICH_RECORD);
    expect(design.page.fontFamily).toBe("'Inter',system-ui,Arial,sans-serif");
  });

  // --- (c) the full 14-role palette via extra_roles -------------------------

  it("a record's extra_roles complete the 14-role palette (roles beyond the original 7)", () => {
    const record: ThemeRecord = {
      ...LEGACY_RECORD,
      id: "thm_extra",
      extra_roles: {
        brand_secondary: "#111111",
        surface_wash: "#222222",
        border: "#333333",
        text_muted: "#444444",
        button_primary_bg: "#555555",
        button_primary_text: "#666666",
        button_secondary_bg: "#777777",
      },
    };
    const { roles } = resolveTokens(base, { theme_id: "thm_extra" }, null, record);
    expect(roles.brand_secondary).toBe("#111111");
    expect(roles.surface_wash).toBe("#222222");
    expect(roles.border).toBe("#333333");
    expect(roles.text_muted).toBe("#444444");
    expect(roles.button_primary_bg).toBe("#555555");
    expect(roles.button_primary_text).toBe("#666666");
    expect(roles.button_secondary_bg).toBe("#777777");
  });

  it("a record with NO extra_roles leaves the additional 7 roles at the base design's own value", () => {
    const { roles } = resolveTokens(base, { theme_id: "thm_legacy" }, null, LEGACY_RECORD);
    for (const role of ["brand_secondary", "surface_wash", "border", "text_muted", "button_primary_bg", "button_primary_text", "button_secondary_bg"] as const) {
      expect(roles[role]).toBe(baseTokenForRole(base, role));
    }
  });

  // --- (d) legacy record back-compat: byte-identical to pre-P6 -------------

  it("a legacy 7-role/3-font/no-new-axes record triggers NONE of the new machinery", () => {
    const { design } = resolveTokens(base, { theme_id: "thm_legacy" }, null, LEGACY_RECORD);
    // no button-style stash
    expect(readButtonStyle(design)).toBeUndefined();
    // no @font-face — Newsreader/Inter are NOT in the self-hosted set
    expect(css(design as AnyDesign)).not.toContain("@font-face");
    expect(css(design as AnyDesign)).not.toContain("data-btn-fill");
    // display ramp untouched (absent display_size ⇒ "m" ⇒ identity)
    expect(design.headline.fontSizeDesktop).toBe(base.headline.fontSizeDesktop);
  });

  it("a legacy record's resolveTokens output (roles/typography/scales) matches what the pre-follow-on shape would produce", () => {
    // Cross-check against the EXACT same fixture shape leadgen-v31-themes-*
    // tests use elsewhere in the repo (roles/typography/controls only, no new
    // keys) — this test's own literal IS that shape (LEGACY_RECORD), so a
    // pass here is a pass for that established fixture too.
    const { roles, typography } = resolveTokens(base, { theme_id: "thm_legacy" }, null, LEGACY_RECORD);
    expect(roles.brand_primary).toBe("#1B3A5C");
    expect(roles.page_background).toBe("#F4F6F9");
    expect(typography.size).toBe("m");
  });

  // --- (e) defense-in-depth (no write-time validator exists yet for these
  // NEW fields — P6b's job; resolveTokens must never let an untrusted raw
  // value reach the served output through the NEW axes either) -------------

  it("a non-hex extra_roles value is DROPPED — falls back to the base design's value, never passed through raw", () => {
    const record: ThemeRecord = {
      ...LEGACY_RECORD,
      id: "thm_bad_role",
      extra_roles: { border: "javascript:alert(1)" },
    };
    const { roles } = resolveTokens(base, { theme_id: "thm_bad_role" }, null, record);
    expect(roles.border).toBe(baseTokenForRole(base, "border"));
    expect(roles.border).not.toContain("javascript:");
  });

  it("an invalid record display_size defaults to m (identity) — never NaN/corrupted", () => {
    const record: ThemeRecord = {
      ...LEGACY_RECORD,
      id: "thm_bad_size",
      typography: { ...LEGACY_RECORD.typography, display_size: "gigantic" as never },
    };
    const { design } = resolveTokens(base, { theme_id: "thm_bad_size" }, null, record);
    expect(design.headline.fontSizeDesktop).toBe(base.headline.fontSizeDesktop);
    expect(design.headline.fontSizeDesktop).not.toContain("NaN");
  });

  it("an invalid record button_style axis is dropped per-axis — the OTHER valid axes still apply", () => {
    const record: ThemeRecord = {
      ...LEGACY_RECORD,
      id: "thm_bad_style",
      button_style: { fill: "glossy" as never, layout: "list" },
    };
    const { design } = resolveTokens(base, { theme_id: "thm_bad_style" }, null, record);
    expect(readButtonStyle(design)).toEqual({ fill: "fill", layout: "list", selected: "wash" });
  });

  it("THEME_DISPLAY_SIZE_FACTORS.xxl is exactly 2.3 (documents the 31px -> 71.3px ratio the parity tests above rely on)", () => {
    expect(THEME_DISPLAY_SIZE_FACTORS.xxl).toBe(2.3);
  });
});
