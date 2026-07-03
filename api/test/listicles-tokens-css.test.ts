// Listicles Phase 4 — tokens → scoped CSS (§30.1/§30.6/§31.0).
//
// The Section-preview stylesheet is GENERATED from
// `defaultListicleLayoutTokens` (no hand-written duplicates): every checked
// value below is compared against the token object itself, never against a
// literal. PROVISIONAL/BLOCKER statuses stay untouched and never leak into
// the emitted CSS (§31.0 honesty).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { defaultListicleLayoutTokens } from "../src/public/listicle/layouts/default/tokens";
import {
  curatedColorCss,
  DEFAULT_LAYOUT_SCOPE,
  defaultLayoutSectionCss,
} from "../src/public/listicle/layouts/default/tokens-to-css";
import {
  LISTICLE_HIGHLIGHTS,
  LISTICLE_TEXT_COLORS,
} from "../src/editor/listicle-blocks";

const T = defaultListicleLayoutTokens;
const css = defaultLayoutSectionCss();

describe("defaultLayoutSectionCss — token-derived, scoped", () => {
  it("every rule is scoped under [data-layout=\"default\"]", () => {
    const selectors = css
      .split("\n")
      .filter((line) => line.includes("{") && !line.startsWith("@media"))
      .map((line) => line.slice(0, line.indexOf("{")));
    expect(selectors.length).toBeGreaterThan(10);
    for (const selector of selectors) {
      for (const part of selector.split(",")) {
        expect(part.trim().startsWith(DEFAULT_LAYOUT_SCOPE), part).toBe(true);
      }
    }
  });

  it("emits the measured token values (compared against the tokens, not literals)", () => {
    expect(css).toContain(`max-width:${T.articleContainer.maxWidth}`);
    expect(css).toContain(`margin-top:${T.sectionWrapper.marginTop}`);
    expect(css).toContain(`font-size:${T.sectionHeading.fontSizeDesktop}`);
    expect(css).toContain(`background-color:${T.choiceButton.backgroundColor}`);
    expect(css).toContain(`border-radius:${T.choiceButton.borderRadius}`);
    expect(css).toContain(`min-height:${T.choiceButton.minHeight}`);
    expect(css).toContain(`max-width:${T.choiceButton.maxWidth}`);
    expect(css).toContain(`color:${T.textCta.color}`);
    expect(css).toContain(`line-height:${T.bodyParagraph.lineHeightDesktop}`);
    expect(css).toContain(`color:${T.legalDisclosureBlock.color}`);
    expect(css).toContain(`gap:${T.choiceButtonGroup.gap}`);
  });

  it("hover/active states use the token hover/active colours", () => {
    expect(css).toContain(T.choiceButton.hoverBackgroundColor);
    expect(css).toContain(T.choiceButton.activeBackgroundColor);
    expect(css).toContain(T.inlineLink.hoverColor);
  });

  it("mobile overrides ride a media query from the *Mobile token fields", () => {
    expect(css).toContain("@media (max-width: 767px)");
    expect(css).toContain(`font-size:${T.sectionHeading.fontSizeMobile}`);
    expect(css).toContain(`font-size:${T.bodyParagraph.fontSizeMobile}`);
  });

  it("no BLOCKER/PROVISIONAL/measured metadata leaks into the CSS", () => {
    expect(css).not.toContain("BLOCKER");
    expect(css).not.toContain("PROVISIONAL");
    expect(css).not.toContain("measured");
    expect(css).not.toContain("status");
  });

  it("emits valid property names only (no camelCase leftovers, no padding-x shorthand)", () => {
    // Check DECLARATIONS only (selectors legitimately carry camelCase
    // layout_binding values like default.legalDisclosureBlock).
    const declarations = [...css.matchAll(/\{([^}]*)\}/g)].map((m) => m[1] ?? "").join(";");
    expect(declarations).not.toMatch(/[a-z][A-Z]/);
    expect(declarations).not.toContain("padding-x:");
    expect(declarations).not.toContain("padding-y:");
    expect(declarations).not.toContain("text-color:");
  });
});

describe("curatedColorCss — the §12 palette as CSS", () => {
  const colorCss = curatedColorCss({
    textColors: LISTICLE_TEXT_COLORS,
    highlights: LISTICLE_HIGHLIGHTS,
  });

  it("one scoped rule per curated token", () => {
    for (const [name, value] of Object.entries(LISTICLE_TEXT_COLORS)) {
      expect(colorCss).toContain(`[data-lst-color="${name}"]{color:${value}}`);
    }
    for (const [name, value] of Object.entries(LISTICLE_HIGHLIGHTS)) {
      expect(colorCss).toContain(`[data-lst-highlight="${name}"]{background-color:${value}}`);
    }
  });
});

describe("§31.0 honesty — blockers RESOLVED by the 2026-07-03 capture pass", () => {
  // Phase 4/5 pinned the package to its BLOCKER statuses (§31.0: never
  // fabricate). The §31.0 REQUIRED CAPTURE pass landed 2026-07-03 (register
  // DEV-13: today's live page is the reference), so the SAME honesty
  // invariant now points the other way: no BLOCKER status may remain, every
  // resolved group is stamped `measured` + `measuredAt: 2026-07-03`, and the
  // top-page drift is recorded in the register — never silently overwritten.
  it("the token OBJECT carries ZERO remaining BLOCKER status fields", () => {
    let blockers = 0;
    let measured = 0;
    const walk = (value: unknown): void => {
      if (typeof value !== "object" || value === null) return;
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === "status" && typeof v === "string" && v.startsWith("BLOCKER")) blockers++;
        if (k === "status" && typeof v === "string" && v.startsWith("measured")) measured++;
        walk(v);
      }
    };
    walk(defaultListicleLayoutTokens);
    expect(blockers).toBe(0);
    // The 8 lower-page groups + Disclosure interaction + mobile viewport +
    // the package-level status are all stamped measured.
    expect(measured).toBeGreaterThanOrEqual(10);
  });

  it("the raw tokens.ts source records the capture date + the drift register (baseline not overwritten)", () => {
    const tokensPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../src/public/listicle/layouts/default/tokens.ts",
    );
    const raw = readFileSync(tokensPath, "utf8");
    expect(raw).not.toContain('"BLOCKER');
    expect((raw.match(/measuredAt: "2026-07-03"/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(raw).toContain("measuredDriftRegister2026_07_03");
    // §30.1 baseline values stay recorded (drift register keeps BOTH):
    expect(raw).toContain("#ce2e35");
  });
});
