// Measured-token conformance (§30.1 + register DEV-13) — the guard that
// every prose-derived CSS value in measured-values.ts is evidence-backed by
// the tokens.ts measurement it claims to transcribe, and that the generated
// stylesheet derives from tokens (no stale-baseline literals where the
// drift register carries a measured replacement).

import { describe, it, expect } from "vitest";
import { defaultListicleLayoutTokens } from "../src/public/listicle/layouts/default/tokens";
import {
  ALL_DERIVED_VALUES,
  DRIFT_OVERRIDES_2026_07_03,
  resolveTokenPath,
} from "../src/public/listicle/layouts/default/measured-values";
import { defaultLayoutCss, defaultLayoutCssVars } from "../src/public/listicle/layouts/default/styles";

const T = defaultListicleLayoutTokens;

function proseOf(source: string): string {
  const node = resolveTokenPath(source);
  if (typeof node === "string") return node;
  // A group source (e.g. sectionWrapper.measured): concatenate every string
  // leaf so evidence substrings can live in any field of the group.
  const parts: string[] = [];
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      parts.push(value);
      return;
    }
    if (typeof value === "object" && value !== null) {
      for (const child of Object.values(value as Record<string, unknown>)) walk(child);
    }
  };
  walk(node);
  return parts.join(" | ");
}

describe("every derived value is evidence-backed by tokens.ts prose", () => {
  for (const [name, entry] of Object.entries(ALL_DERIVED_VALUES)) {
    it(`${name} ← tokens.${entry.source}`, () => {
      const prose = proseOf(entry.source);
      expect(prose, `tokens path ${entry.source} must exist`).not.toBe("");
      for (const evidence of entry.evidence) {
        expect(prose, `evidence '${evidence}' must appear in tokens.${entry.source}`).toContain(
          evidence,
        );
      }
    });
  }
});

describe("drift register ↔ overrides SET EQUALITY (DEV-13: measured wins, nothing ignored)", () => {
  it("every measuredDriftRegister2026_07_03 key has a structured override and vice versa", () => {
    const registerKeys = Object.keys(T.measuredDriftRegister2026_07_03).sort();
    const overrideKeys = Object.keys(DRIFT_OVERRIDES_2026_07_03).sort();
    expect(overrideKeys).toEqual(registerKeys);
  });
});

describe("the generated stylesheet derives from tokens + measured drift", () => {
  const css = defaultLayoutCss();

  it("measured (new) values WIN where the register carries old+new", () => {
    // Live header #e0072b — and the computed cascade must end on it: the
    // LAST .lst-header background declaration is the drift value.
    const headerDecls = [...css.matchAll(/\.lst-header\{[^}]*background-color:([^;}]+)/g)].map(
      (m) => m[1],
    );
    expect(headerDecls.length).toBeGreaterThan(0);
    expect(headerDecls[headerDecls.length - 1]).toBe("#e0072b");
    expect(css).toContain("Inter, Arial, Helvetica, sans-serif"); // live font stack
    expect(css).toContain("border-radius:8px"); // live hero radius + buttons
    // Live body paragraph 18px/30px: the LAST .lst-section p font-size wins.
    const paraSizes = [...css.matchAll(/\.lst-section p\{[^}]*font-size:([^;}]+)/g)].map(
      (m) => m[1],
    );
    expect(paraSizes[paraSizes.length - 1]).toBe("18px");
  });

  it("measured §31.0 groups are emitted from tokens (buttons/links/footer/divider)", () => {
    expect(css).toContain(`background-color:${T.choiceButton.backgroundColor}`); // #f8020e
    expect(css).toContain(`min-height:${T.choiceButton.minHeight}`); // 62px
    expect(css).toContain(`color:${T.inlineLink.color}`); // #3b82f6
    expect(css).toContain(`background-color:${T.footer.backgroundColor}`); // #000002
    // O3: divider rhythm on the hr — 32px/20px margins, 3px #e5e7eb band.
    expect(css).toContain(
      `.lst-divider{border:0;height:3px;background-color:${T.sectionWrapper.measured.separatorColor};margin:${T.sectionWrapper.measured.separatorMarginTop} 0 ${T.sectionWrapper.measured.separatorMarginBottom} 0}`,
    );
    // …and the section wrapper itself carries the measured ZERO margins.
    expect(css).toContain(`.lst-section{margin-top:0px;margin-bottom:0px}`);
  });

  it("the Disclosure dropdown panel is styled per the measured capture", () => {
    expect(css).toContain(`width:${T.disclosureInteraction.measured.panelWidth}`); // 288px
    expect(css).toContain(`border-radius:${T.disclosureInteraction.measured.panelBorderRadius}`);
    expect(css).toContain("top:calc(100% + 8px)"); // below trigger, 8px offset
    expect(css).not.toContain("(shadow-lg)"); // annotation stripped, shadow kept
    expect(css).toContain("0 10px 15px -3px rgba(0,0,0,0.1)");
  });

  it("no stale-baseline literal shadows a drift-measured value in the CHROME rules", () => {
    // The baseline #ce2e35 may only appear via the tokens-to-css CORE (whose
    // token fields the conductor kept per the drift-register policy) — never
    // in a .lst-header/.lst-hero/.lst-byline/.lst-title chrome rule.
    for (const m of css.matchAll(/[^{}]*\{[^}]*#ce2e35[^}]*\}/g)) {
      const rule = m[0] ?? "";
      expect(rule).not.toContain(".lst-header");
      expect(rule).not.toContain(".lst-title");
      expect(rule).not.toContain(".lst-byline");
      expect(rule).not.toContain(".lst-hero");
    }
  });

  it("responsive blocks: mobile headline 24px/32px (<640px) + lg 27.2px/40.8px headings (≥1024px)", () => {
    expect(css).toContain("@media (max-width: 639px)");
    expect(css).toContain(`font-size:${T.articleHeadline.fontSizeMobile}`); // 24px
    expect(css).toContain("@media (min-width: 1024px)");
    expect(css).toContain("font-size:27.2px");
    expect(css).toContain("line-height:40.8px");
  });

  it("cssVars expose the drift-resolved identity", () => {
    const vars = defaultLayoutCssVars();
    expect(vars["--lst-header-bg"]).toBe("#e0072b");
    expect(vars["--lst-footer-bg"]).toBe(T.footer.backgroundColor);
  });
});
