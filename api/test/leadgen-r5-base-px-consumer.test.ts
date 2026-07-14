// R5 SEAM-1 — wires ThemeRecord.typography.base_px into resolveTokens' font-
// size scaling (register E.5 "Theme base_px: validated, threaded, ZERO
// consumers — dead theme feature" | "R5 (wire consumer)").
//
// Before this slice: base_px was validated at write time (themes-handlers.ts
// 10-24, finite), round-tripped through KV (theme-store.ts), and threaded
// verbatim onto EffectiveTokens.theme_typography (theme.ts) — but no code
// path ever read it back off that property, so a resolved theme record could
// carry ANY value with zero visual effect (register SEAM-1's own words:
// "dead theme feature").
//
// This file proves: base_px now scales every *FontSize* token (px/rem alike,
// reusing the SAME unit-agnostic scaleFontSizes the curated theme_json
// typography.size s/m/l scale already uses) via factor = base_px / 16 — 16
// being both CSS's own default root font-size AND the only value the
// ThemeManager "New theme" payload has ever sent (no UI control exists yet
// to author a different one). It also proves the defense-in-depth clamp
// (10-24) for a value that bypassed the write-time gate (e.g. a hand-edited
// KV blob passing only theme-store.ts's looser "is a number" read check).
//
// NOTE (slice boundary): this file proves theme.ts's pure resolveTokens
// math only — the ThemeManager admin UI has no input control for base_px
// yet (still a hardcoded 16 in the "New theme" payload); giving operators a
// control is a separate, un-scoped follow-up, not this seam.

import { describe, expect, it } from "vitest";
import { resolveTokens, type ThemeRecord } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

const base = defaultFunnelDesign;

const recordWithBasePx = (base_px: number): ThemeRecord => ({
  id: "thm_test",
  name: "Test",
  roles: {
    brand_primary: "#0B5FFF",
    accent: "#AA3300",
    page_bg: "#F4F6F9",
    card: "#F9FAFC",
    text: "#101828",
    success: "#127A3B",
    error: "#B42318",
  },
  typography: { headline_font: "Newsreader", body_font: "Inter", base_px },
  controls: { field_height: "medium", button_size: "m", corners: "rounded" },
});

describe("R5 SEAM-1 — base_px:16 (the only value any real theme record carries today) is the identity", () => {
  it("produces a design byte-identical to the base design's font sizes", () => {
    const eff = resolveTokens(base, { theme_id: "thm_test" }, null, recordWithBasePx(16));
    expect(eff.design.headline.fontSizeDesktop).toBe(base.headline.fontSizeDesktop);
    expect(eff.design.headline.fontSizeMobile).toBe(base.headline.fontSizeMobile);
    expect(eff.design.subheadline.fontSize).toBe(base.subheadline.fontSize);
    expect(eff.design.input.fontSize).toBe(base.input.fontSize);
    expect(eff.design.primaryButton.fontSize).toBe(base.primaryButton.fontSize);
  });

  it("still exposes theme_typography.base_px unchanged (the existing additive pass-through pin)", () => {
    const eff = resolveTokens(base, { theme_id: "thm_test" }, null, recordWithBasePx(16));
    expect(eff.theme_typography?.base_px).toBe(16);
  });
});

describe("R5 SEAM-1 — a non-16 base_px scales EVERY *FontSize* token, px and rem alike", () => {
  it("base_px:20 (factor 1.25) scales a literal-px token (headline.fontSizeDesktop) and a rem token (subheadline.fontSize)", () => {
    const eff = resolveTokens(base, { theme_id: "thm_test" }, null, recordWithBasePx(20));
    expect(base.headline.fontSizeDesktop).toBe("31px"); // pre-condition this test's math depends on
    expect(eff.design.headline.fontSizeDesktop).toBe("38.75px");
    expect(base.subheadline.fontSize).toBe("0.825rem"); // pre-condition
    expect(eff.design.subheadline.fontSize).toBe("1.031rem");
    expect(base.headline.fontSizeMobile).toBe("1.375rem");
    expect(eff.design.headline.fontSizeMobile).toBe("1.719rem");
    expect(base.input.fontSize).toBe("1rem");
    expect(eff.design.input.fontSize).toBe("1.25rem");
  });

  it("base_px:12 (factor 0.75) scales the same tokens the other direction", () => {
    const eff = resolveTokens(base, { theme_id: "thm_test" }, null, recordWithBasePx(12));
    expect(eff.design.headline.fontSizeDesktop).toBe("23.25px");
    expect(eff.design.subheadline.fontSize).toBe("0.619rem");
  });

  it("scaling touches ONLY *FontSize* keys — non-typography tokens (colours, radii, spacing) are untouched", () => {
    const eff = resolveTokens(base, { theme_id: "thm_test" }, null, recordWithBasePx(20));
    expect(eff.design.radius).toEqual(base.radius);
    expect(eff.design.spacing).toEqual(base.spacing);
    expect(eff.design.headline.color).toBe(base.headline.color);
    expect(eff.design.headline.lineHeight).toBe(base.headline.lineHeight);
  });

  it("composes independently of the record's own font-FAMILY application (headline_font/body_font unaffected)", () => {
    const eff = resolveTokens(base, { theme_id: "thm_test" }, null, recordWithBasePx(20));
    expect(eff.design.page.fontDisplay).toBe("'Newsreader',Georgia,serif");
    expect(eff.design.page.fontFamily).toBe("'Inter',system-ui,Arial,sans-serif");
  });
});

describe("R5 SEAM-1 — defense-in-depth clamp for a base_px that bypassed the write-time 10-24 gate", () => {
  it("an out-of-range HIGH value (e.g. a hand-edited KV blob) clamps to 24, never an unbounded multiplier", () => {
    const eff = resolveTokens(base, { theme_id: "thm_test" }, null, recordWithBasePx(999));
    // factor = 24/16 = 1.5, NOT 999/16 (~62x)
    expect(eff.design.headline.fontSizeDesktop).toBe("46.5px");
  });

  it("an out-of-range LOW / zero / negative value clamps to 10, never zero or a negative size", () => {
    for (const wild of [0, -5, -100]) {
      const eff = resolveTokens(base, { theme_id: "thm_test" }, null, recordWithBasePx(wild));
      // factor = 10/16 = 0.625, NOT 0 or negative
      expect(eff.design.headline.fontSizeDesktop).toBe("19.375px");
    }
  });

  it("a non-finite value (NaN / Infinity — never producible via the JSON write path, only a theoretical KV read edge) falls back to the neutral default (identity)", () => {
    for (const wild of [NaN, Infinity, -Infinity]) {
      const eff = resolveTokens(base, { theme_id: "thm_test" }, null, recordWithBasePx(wild));
      expect(eff.design.headline.fontSizeDesktop).toBe(base.headline.fontSizeDesktop);
    }
  });
});

describe("R5 SEAM-1 — untouched paths stay exactly as before (strictly additive)", () => {
  it("the legacy curated theme_json typography.size (s/m/l) path is completely independent — still applies with no record present", () => {
    const eff = resolveTokens(base, { typography: { size: "l" } }, null);
    expect(eff.design.headline.fontSizeDesktop).toBe("34.1px"); // 31 * 1.1 (THEME_SIZE_FACTORS.l)
  });

  it("no theme / null record: base design font sizes are the identity (unaffected by this slice)", () => {
    for (const eff of [resolveTokens(base), resolveTokens(base, null, null), resolveTokens(base, {})]) {
      expect(eff.design.headline.fontSizeDesktop).toBe(base.headline.fontSizeDesktop);
    }
  });
});
