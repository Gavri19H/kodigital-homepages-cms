// LeadGen v2.5 Phase A — contract test `theme-inheritance`
// (redesign-contract-v2.5 09 §9.1/§9.2/§9.3). Proves: resolveTokens applies
// the priority layers 1 base design → 2 funnel theme → 3 variant overrides;
// an ABSENT theme is the IDENTITY to the base design (deep-equal); the §9.1
// role → base-token mapping is exhaustive (all 14 roles) and resolves for
// EVERY design in the registry; scales are lookups/multipliers over the base
// scales; validateTheme rejects unknown roles/keys and flags custom hex
// literals as warnings.

import { describe, expect, it } from "vitest";
import {
  FUNNEL_TOKEN_ROLES,
  ROLE_TO_BASE_TOKEN,
  THEME_FONT_STACKS,
  baseTokenForRole,
  resolveTokens,
  validateTheme,
} from "../src/public/leadgen/designs/theme";
import { FUNNEL_DESIGNS } from "../src/public/leadgen/designs/registry";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

const base = defaultFunnelDesign;

// ---------------------------------------------------------------------------
// §9.1 the 14-role table + registry exhaustiveness
// ---------------------------------------------------------------------------

describe("theme-inheritance — §9.1 role → base-token mapping", () => {
  it("carries EXACTLY the 14 contract roles", () => {
    expect(FUNNEL_TOKEN_ROLES).toHaveLength(14);
    expect(Object.keys(ROLE_TO_BASE_TOKEN).sort()).toEqual([...FUNNEL_TOKEN_ROLES].sort());
  });

  it("maps each role to the §9.1 base token path VERBATIM", () => {
    expect(ROLE_TO_BASE_TOKEN).toEqual({
      brand_primary: "color.primary",
      brand_secondary: "color.primaryLight",
      accent: "color.accent",
      success: "color.success",
      error: "color.error",
      page_background: "page.backgroundColor",
      card_background: "color.card",
      surface_wash: "color.primaryWash",
      border: "color.border",
      text_primary: "page.textColor",
      text_muted: "page.textSecondaryColor",
      button_primary_bg: "primaryButton.background",
      button_primary_text: "primaryButton.color",
      button_secondary_bg: "color.primaryGhost",
    });
  });

  it("resolves to a non-empty token value for EVERY design in the registry (compile-time pattern, runtime-proven)", () => {
    const designIds = Object.keys(FUNNEL_DESIGNS);
    expect(designIds.length).toBeGreaterThan(0);
    for (const [designId, design] of Object.entries(FUNNEL_DESIGNS)) {
      for (const role of FUNNEL_TOKEN_ROLES) {
        const value = baseTokenForRole(design, role);
        expect(typeof value, `${designId} / ${role}`).toBe("string");
        expect(value.length, `${designId} / ${role}`).toBeGreaterThan(0);
      }
    }
  });

  it("reads the measured default-funnel values through the mapping", () => {
    expect(baseTokenForRole(base, "brand_primary")).toBe("#1B3A5C");
    expect(baseTokenForRole(base, "accent")).toBe("#E85D26");
    expect(baseTokenForRole(base, "page_background")).toBe("#F5F7FA");
    expect(baseTokenForRole(base, "button_primary_text")).toBe("#FFFFFF");
    expect(baseTokenForRole(base, "button_secondary_bg")).toBe("#F2F6FA");
  });
});

// ---------------------------------------------------------------------------
// §9.2 resolveTokens priority 1 → 3
// ---------------------------------------------------------------------------

describe("theme-inheritance — resolveTokens priority layers 1→3 (§9.2)", () => {
  it("ABSENT theme = base-design identity (deep-equal), on a fresh copy", () => {
    for (const eff of [resolveTokens(base), resolveTokens(base, null, null), resolveTokens(base, {})]) {
      expect(eff.design).toEqual(base);
      expect(eff.design).not.toBe(base); // never the registry singleton
    }
  });

  it("EXPLICIT identity steps (regular/soft/mid/m) are still the identity", () => {
    const eff = resolveTokens(base, {
      scales: { spacing: "regular", radius: "soft", shadow: "mid" },
      typography: { size: "m" },
    });
    expect(eff.design).toEqual(base);
    expect(eff.scales).toEqual({ spacing: "regular", radius: "soft", shadow: "mid" });
  });

  it("identity roles table = the base mapping for all 14 roles", () => {
    const eff = resolveTokens(base);
    expect(Object.keys(eff.roles).sort()).toEqual([...FUNNEL_TOKEN_ROLES].sort());
    for (const role of FUNNEL_TOKEN_ROLES) {
      expect(eff.roles[role]).toBe(baseTokenForRole(base, role));
    }
  });

  it("layer 2 (funnel theme palette) overrides the mapped base tokens", () => {
    const eff = resolveTokens(base, { palette: { brand_primary: "#111111", accent: "#333333" } });
    expect(eff.roles.brand_primary).toBe("#111111");
    expect(eff.roles.accent).toBe("#333333");
    expect(eff.design.color.primary).toBe("#111111"); // written at the mapped path
    expect(eff.design.color.accent).toBe("#333333");
    expect(eff.roles.success).toBe("#0E7C3A"); // untouched role stays layer 1
    expect(eff.design.color.success).toBe("#0E7C3A");
    // the registry singleton is never mutated
    expect(base.color.primary).toBe("#1B3A5C");
  });

  it("layer 3 (variant frame_overrides theme) beats layer 2 per-role", () => {
    const eff = resolveTokens(
      base,
      { palette: { brand_primary: "#111111", accent: "#333333" } },
      { palette: { brand_primary: "#222222" } },
    );
    expect(eff.roles.brand_primary).toBe("#222222"); // layer 3 wins
    expect(eff.design.color.primary).toBe("#222222");
    expect(eff.roles.accent).toBe("#333333"); // layer 2 survives where 3 is silent
    expect(eff.roles.border).toBe("#D2D9E5"); // layer 1 elsewhere
  });

  it("layer 3 applies even with NO funnel theme (layer 2 absent)", () => {
    const eff = resolveTokens(base, null, { palette: { page_background: "#000000" } });
    expect(eff.roles.page_background).toBe("#000000");
    expect(eff.design.page.backgroundColor).toBe("#000000");
  });

  it("a ROLE-NAME palette value is an alias resolved against the BASE design", () => {
    const eff = resolveTokens(base, { palette: { button_primary_bg: "accent" } });
    expect(eff.roles.button_primary_bg).toBe("#E85D26");
    expect(eff.design.primaryButton.background).toBe("#E85D26");
  });
});

// ---------------------------------------------------------------------------
// §9.3 scales — lookups/multipliers over the base scales
// ---------------------------------------------------------------------------

describe("theme-inheritance — §9.3 scale steps over the base scales", () => {
  it("spacing compact/roomy multiply the base spacing scale (regular = identity)", () => {
    const compact = resolveTokens(base, { scales: { spacing: "compact" } }).design;
    expect(compact.spacing.xs).toBe("0.2rem"); // 0.25 × 0.8
    expect(compact.spacing.md).toBe("0.8rem"); // 1 × 0.8
    expect(compact.spacing.xxl).toBe("2.4rem"); // 3 × 0.8

    const roomy = resolveTokens(base, { scales: { spacing: "roomy" } }).design;
    expect(roomy.spacing.md).toBe("1.25rem");

    const regular = resolveTokens(base, { scales: { spacing: "regular" } }).design;
    expect(regular.spacing).toEqual(base.spacing);
  });

  it("radius sharp = one step DOWN the base radius scale (clamped; pill `full` untouched)", () => {
    const sharp = resolveTokens(base, { scales: { radius: "sharp" } }).design;
    expect(sharp.radius.sm).toBe(base.radius.sm); // clamp at the bottom
    expect(sharp.radius.md).toBe(base.radius.sm); // 10px → 6px
    expect(sharp.radius.lg).toBe(base.radius.md);
    expect(sharp.radius.xl).toBe(base.radius.lg);
    expect(sharp.radius.full).toBe("9999px");
  });

  it("radius round = one step UP (clamped at xl)", () => {
    const round = resolveTokens(base, { scales: { radius: "round" } }).design;
    expect(round.radius.sm).toBe(base.radius.md);
    expect(round.radius.xl).toBe(base.radius.xl); // clamp at the top
    expect(round.radius.full).toBe("9999px");
  });

  it("shadow none blanks every step including glow; low/high shift the scale", () => {
    const none = resolveTokens(base, { scales: { shadow: "none" } }).design;
    expect(none.shadow.sm).toBe("none");
    expect(none.shadow.xl).toBe("none");
    expect(none.shadow.glow).toBe("none");

    const high = resolveTokens(base, { scales: { shadow: "high" } }).design;
    expect(high.shadow.sm).toBe(base.shadow.md);
    expect(high.shadow.xl).toBe(base.shadow.xl); // clamp

    const low = resolveTokens(base, { scales: { shadow: "low" } }).design;
    expect(low.shadow.md).toBe(base.shadow.sm);
    expect(low.shadow.sm).toBe(base.shadow.sm); // clamp
  });
});

// ---------------------------------------------------------------------------
// §9.3 typography + button/card defaults
// ---------------------------------------------------------------------------

describe("theme-inheritance — §9.3 typography + component defaults", () => {
  it("display font from the curated list retargets the display token slots", () => {
    const eff = resolveTokens(base, { typography: { display: "sora" } });
    expect(eff.design.page.fontDisplay).toBe(THEME_FONT_STACKS.sora);
    expect(eff.design.headline.fontFamily).toBe(THEME_FONT_STACKS.sora);
    expect(eff.typography.display).toBe(THEME_FONT_STACKS.sora);
    expect(eff.design.page.fontFamily).toBe(base.page.fontFamily); // body untouched
  });

  it("body font retargets the body token slots", () => {
    const eff = resolveTokens(base, { typography: { body: "system" } });
    expect(eff.design.page.fontFamily).toBe(THEME_FONT_STACKS.system);
    expect(eff.design.primaryButton.fontFamily).toBe(THEME_FONT_STACKS.system);
    expect(eff.design.page.fontDisplay).toBe(base.page.fontDisplay); // display untouched
  });

  // R5 D11 (register S4-B2): headline.fontSizeDesktop is now a literal px
  // (golden fidelity — see tokens.ts's own comment) instead of rem; the
  // scaleFontSizes mechanism is EXPLICITLY unit-agnostic by its own doc
  // comment ("Multiply every *FontSize* token (px/rem) across the design",
  // theme.ts:722) — these two literals are the ONLY typography-attributable
  // update this test needs (31 × 1.1 = 34.1, 31 × 0.9 = 27.9); the
  // subheadline expectation is UNCHANGED (subheadline.fontSize token itself
  // was NOT touched by R5 — only styles.ts gained a separate, surgical
  // question-card-only override, which this pure resolveTokens() unit test
  // never exercises).
  it("size scale s/l multiplies every *FontSize* token (m = identity)", () => {
    const large = resolveTokens(base, { typography: { size: "l" } }).design;
    expect(large.headline.fontSizeDesktop).toBe("34.1px"); // 31 × 1.1
    expect(large.subheadline.fontSize).toBe("0.908rem"); // 0.825 × 1.1 (rounded)

    const small = resolveTokens(base, { typography: { size: "s" } }).design;
    expect(small.headline.fontSizeDesktop).toBe("27.9px"); // 31 × 0.9

    const medium = resolveTokens(base, { typography: { size: "m" } }).design;
    expect(medium.headline.fontSizeDesktop).toBe(base.headline.fontSizeDesktop);
  });

  it("button defaults: roles + radius step + min-height + casing (§9.3)", () => {
    const eff = resolveTokens(base, {
      button_defaults: {
        background_role: "accent",
        text_role: "text_primary",
        radius: "full",
        min_height: "l",
        casing: "upper",
      },
    });
    expect(eff.design.primaryButton.background).toBe("#E85D26");
    expect(eff.design.primaryButton.color).toBe("#1A1F36");
    expect(eff.design.primaryButton.borderRadius).toBe("9999px");
    expect(eff.design.primaryButton.minHeight).toBe("60px");
    expect(eff.button_defaults).toEqual({
      background: "#E85D26",
      color: "#1A1F36",
      border_radius: "9999px",
      min_height: "60px",
      text_transform: "uppercase",
    });
  });

  it("a button radius STEP reads the EFFECTIVE (scaled) radius scale", () => {
    const eff = resolveTokens(base, {
      scales: { radius: "sharp" },
      button_defaults: { radius: "md" },
    });
    expect(eff.design.primaryButton.borderRadius).toBe(base.radius.sm); // sharp md = base sm
  });

  it("card defaults: background/border roles + radius + shadow steps", () => {
    const eff = resolveTokens(base, {
      card_defaults: { background_role: "surface_wash", border_role: "accent", radius: "xl", shadow: "lg" },
    });
    // R2 P8-3 (review MAJOR-1) — a COMPONENT-scoped control must not re-point a
    // GLOBAL role token. `card_defaults.background_role` used to write
    // `design.color.card`, the card_background ROLE's own token, which every
    // consumer of that role reads (the field's resting background among them) —
    // measured live as a "Card background" control flooding the whole frame and
    // making every text input unreadable. theme.ts:1495 now writes ONLY the
    // component slot. Asserted from the base token rather than a literal, and
    // paired with the slot that MUST move, so neither half can regress alone.
    expect(eff.design.color.card, "the global role token is NOT re-pointed").toBe(base.color.card);
    expect(eff.design.color.card).toBe("#FFFFFF");
    expect(eff.design.questionCard.background, "…and the card's own slot IS painted").toBe("#E8EEF4");
    expect(eff.design.content.cardRadius).toBe("20px");
    expect(eff.design.cardPanel.border).toBe("1px solid #E85D26");
    expect(eff.card_defaults).toEqual({
      background: "#E8EEF4",
      border_color: "#E85D26",
      border_radius: "20px",
      shadow: base.shadow.lg,
    });
  });

  it("absent defaults expose the base-design values (identity records)", () => {
    const eff = resolveTokens(base);
    expect(eff.button_defaults).toEqual({
      background: "#1B3A5C",
      color: "#FFFFFF",
      border_radius: "10px",
      min_height: "52px",
      text_transform: "none",
    });
    expect(eff.card_defaults.background).toBe("#FFFFFF");
    expect(eff.typography.display).toBe(base.page.fontDisplay);
    expect(eff.typography.body).toBe(base.page.fontFamily);
  });
});

// ---------------------------------------------------------------------------
// validateTheme (§3.6 problems; §9.3/§9.4 hex policy)
// ---------------------------------------------------------------------------

describe("theme-inheritance — validateTheme (unknown role → error; custom hex flagged)", () => {
  it("a valid role-vocabulary theme validates with ZERO problems", () => {
    const { theme, problems } = validateTheme({
      version: 1,
      palette: { button_primary_bg: "accent" },
      typography: { display: "literata", body: "sora", size: "l" },
      scales: { spacing: "roomy", radius: "round", shadow: "high" },
      button_defaults: { background_role: "brand_primary", casing: "upper" },
      card_defaults: { background_role: "card_background", shadow: "md" },
    });
    expect(problems).toEqual([]);
    expect(theme).not.toBeNull();
  });

  it("an UNKNOWN role in the palette is a path-precise error", () => {
    const { theme, problems } = validateTheme({ palette: { hotpink: "#FF69B4" } });
    expect(theme).toBeNull();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ path: "theme.palette.hotpink", scope: "theme", severity: "error" });
  });

  it("custom hex values are ALLOWED as legacy literals but FLAGGED (warning keeps the theme)", () => {
    const { theme, problems } = validateTheme({ palette: { brand_primary: "#FF0000" } });
    expect(theme).not.toBeNull();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      path: "theme.palette.brand_primary",
      severity: "warning",
      message: "Custom colors skip the design system — check contrast.",
    });
  });

  it("malformed hex / junk palette values are errors", () => {
    expect(validateTheme({ palette: { brand_primary: "#GGGGGG" } }).theme).toBeNull();
    expect(validateTheme({ palette: { brand_primary: "bright-red" } }).theme).toBeNull();
    expect(validateTheme({ palette: { brand_primary: 7 } }).theme).toBeNull();
  });

  it("unknown top-level keys, bad version, and non-objects are rejected", () => {
    const unknownKey = validateTheme({ gradients: {} });
    expect(unknownKey.theme).toBeNull();
    expect(unknownKey.problems[0]?.path).toBe("theme.gradients");

    expect(validateTheme({ version: 2 }).problems[0]?.path).toBe("theme.version");
    expect(validateTheme("theme").theme).toBeNull();
    expect(validateTheme(null).problems[0]?.path).toBe("theme");
  });

  it("typography, scales, and defaults enums are closed sets with precise paths", () => {
    expect(validateTheme({ typography: { display: "comic-sans" } }).problems[0]?.path).toBe(
      "theme.typography.display",
    );
    expect(validateTheme({ typography: { size: "xl" } }).problems[0]?.path).toBe("theme.typography.size");
    expect(validateTheme({ typography: { kerning: 1 } }).problems[0]?.path).toBe("theme.typography.kerning");
    expect(validateTheme({ scales: { radius: "extra-round" } }).problems[0]?.path).toBe("theme.scales.radius");
    expect(validateTheme({ scales: { blur: "high" } }).problems[0]?.path).toBe("theme.scales.blur");
    expect(validateTheme({ button_defaults: { background_role: "hotpink" } }).problems[0]?.path).toBe(
      "theme.button_defaults.background_role",
    );
    expect(validateTheme({ button_defaults: { casing: "shouty" } }).problems[0]?.path).toBe(
      "theme.button_defaults.casing",
    );
    expect(validateTheme({ card_defaults: { glow: true } }).problems[0]?.path).toBe(
      "theme.card_defaults.glow",
    );
  });

  it("every theme problem is scope `theme` and message is an operator sentence (no raw JSON)", () => {
    const { problems } = validateTheme({
      gradients: {},
      palette: { hotpink: "#FF69B4", brand_primary: "#FF0000" },
      scales: { radius: "extra-round" },
    });
    expect(problems.length).toBeGreaterThan(2);
    for (const problem of problems) {
      expect(problem.scope).toBe("theme");
      expect(problem.path.startsWith("theme")).toBe(true);
      expect(problem.message).not.toContain("{");
      expect(problem.message).not.toContain("}");
    }
  });
});
