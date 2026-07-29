// R2 P3 completion — item 1 (SOURCE-OF-TRUTH A.2: "this template element
// could use different color, font and sizes then the main template"):
// designs/frame.ts's footerScopeStyle has always emitted the closed-enum
// --lg-footer-font custom property, but default-funnel/styles.ts's
// `.lg-frame-footer2` rule never had a font-family declaration consuming it
// — the property was set but nothing read it, so an authored footer font
// never painted. This file is the fail-before/pass-after regression for the
// ONE consuming line added to styles.ts.

import { describe, expect, it } from "vitest";
import { funnelChromeCss, DEFAULT_FUNNEL_SCOPE } from "../src/public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { resolveTokens, THEME_RECORD_FONT_STACKS } from "../src/public/leadgen/designs/theme";
import { LG_BANNERS_MOUNT_HTML, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import type { RenderQuoteFrameInput } from "../src/public/leadgen/designs/frame";
import { effectiveFrame } from "../src/public/leadgen/designs/frames";
import type { FrameConfig } from "../src/public/leadgen/designs/frames";

const TOKENS = resolveTokens(defaultFunnelDesign);
const ROOT = {
  funnelId: "lgf_0000000000000000000P3FIX1",
  funnelVariantId: "lgn_0000000000000000000P3FIX2",
  quoteId: "lgq_0000000000000000000P3FIX3",
  contentVersion: 1,
};

function composed(patch: FrameConfig): string {
  const { frame, problems } = effectiveFrame("centered", patch);
  expect(problems).toEqual([]);
  const input: RenderQuoteFrameInput = {
    effectiveTokens: TOKENS,
    frame,
    siteBranding: null,
    sectionsHtml: "",
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount: 2,
    root: ROOT,
  };
  return renderQuoteFrame(input);
}

describe("R2 P3 completion item 1 — .lg-frame-footer2 CONSUMES --lg-footer-font", () => {
  it("the static chrome CSS rule declares font-family:var(--lg-footer-font,inherit)", () => {
    const css = funnelChromeCss(defaultFunnelDesign, DEFAULT_FUNNEL_SCOPE, { frameRegions: true });
    const start = css.indexOf(`${DEFAULT_FUNNEL_SCOPE} .lg-frame-footer2{`);
    expect(start).toBeGreaterThan(-1);
    const rule = css.slice(start, css.indexOf("}", start) + 1);
    expect(rule).toContain("font-family:var(--lg-footer-font,inherit)");
  });

  it("REGRESSION: a footer with typography_scope.font_family set now has a real paint path — the emitted --lg-footer-font custom property AND the consuming CSS declaration both exist, and the footer's font source differs from the main template's page body font", () => {
    // The main template's own body font (page.fontFamily) — the "main
    // template" side of the owner's "different ... font ... then the main
    // template" contrast.
    const mainTemplateBodyFont = TOKENS.design.page.fontFamily;
    expect(mainTemplateBodyFont).toBe("'Sora',system-ui,Arial,sans-serif");

    const patch: FrameConfig = {
      footer: {
        enabled: true,
        blocks: [{ type: "about_paragraph", text: "Acme Inc." }],
        typography_scope: { font_family: "Newsreader" },
      },
    };
    const html = composed(patch);

    // (1) frame.ts's own emission side — unchanged by this fix, proven here
    // so this test would have failed loudly (missing property) had emission
    // regressed too.
    const footerFontStack = THEME_RECORD_FONT_STACKS.Newsreader;
    expect(html).toContain(`--lg-footer-font:${footerFontStack}`);

    // (2) the styles.ts consuming side — THIS is the line item 1 adds; before
    // the fix, static chrome CSS had NO font-family declaration referencing
    // --lg-footer-font at all, so this assertion fails on the pre-fix file.
    const css = funnelChromeCss(defaultFunnelDesign, DEFAULT_FUNNEL_SCOPE, { frameRegions: true });
    expect(css).toContain("font-family:var(--lg-footer-font,inherit)");

    // (3) the owner's "different ... font ... then the main template" is a
    // real contrast, not an accidental match — the footer's declared font
    // stack literal is NOT the same literal as the page body's.
    expect(footerFontStack).not.toBe(mainTemplateBodyFont);
  });

  it("no authored footer font (typography_scope absent) falls to `inherit` — byte-identical pre-fix default, no regression for existing footers", () => {
    const html = composed({ footer: { enabled: true, blocks: [{ type: "about_paragraph", text: "Acme Inc." }] } });
    expect(html).not.toContain("--lg-footer-font:");
    const css = funnelChromeCss(defaultFunnelDesign, DEFAULT_FUNNEL_SCOPE, { frameRegions: true });
    // the rule's declared VALUE still resolves to inherit when the custom
    // property is absent — CSS var() fallback semantics, not a JS branch.
    expect(css).toContain("font-family:var(--lg-footer-font,inherit)");
  });
});
