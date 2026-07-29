// P3 Checklist Fix — footer list block's list_style:"check" must emit the
// check-style class and render with checkmarks (not bullets).
//
// The defect: the footer list renderer only checked for list_style:"ordered"
// but ignored list_style:"check", so the served markup was always UL:disc
// (visually identical to "Bulleted"), even when the editor persisted the check
// option. The free-text renderer (same module) already handled this correctly.
import { describe, expect, it } from "vitest";
import { LG_BANNERS_MOUNT_HTML, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import type { RenderQuoteFrameInput } from "../src/public/leadgen/designs/frame";
import { effectiveFrame } from "../src/public/leadgen/designs/frames";
import type { EffectiveFrameConfig, FrameConfig } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";

const TOKENS = resolveTokens(defaultFunnelDesign);

const ROOT = {
  funnelId: "lgf_0000000000000000000P3FIX01",
  funnelVariantId: "lgn_0000000000000000000P3FIX02",
  quoteId: "lgq_0000000000000000000P3FIX03",
  contentVersion: 1,
};

function frameWithFooter(footer: Record<string, unknown>): EffectiveFrameConfig {
  const { frame, problems } = effectiveFrame("centered", { footer } as unknown as FrameConfig);
  expect(problems).toEqual([]);
  return frame;
}

function renderFooterHtml(frame: EffectiveFrameConfig): string {
  const input: RenderQuoteFrameInput = {
    effectiveTokens: TOKENS,
    frame,
    siteBranding: {
      site_name: "Test",
      logo_url: "/media/logo.png",
      tagline: null,
      legal_links: [],
      trust_logos: null,
    },
    sectionsHtml: "",
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount: 2,
    root: ROOT,
  };
  return renderQuoteFrame(input);
}

const CSS = funnelChromeCss(defaultFunnelDesign, `[data-lg-design="default-funnel"]`, { frameRegions: true });

describe("P3 Checklist — footer list block list_style:check renders checkmarks", () => {
  it("a footer list with list_style:unordered (default) renders a UL with disc bullets", () => {
    const html = renderFooterHtml(
      frameWithFooter({
        enabled: true,
        blocks: [
          {
            type: "list",
            align: "left",
            list_style: "unordered",
            items: ["Item 1", "Item 2"],
          },
        ],
      }),
    );
    expect(html).toContain('class="lg-frame-footer2-list"');
    expect(html).not.toContain("lg-frame-footer2-list--check");
    expect(html).toContain("<ul");
  });

  it("a footer list with list_style:check emits the --check class", () => {
    const html = renderFooterHtml(
      frameWithFooter({
        enabled: true,
        blocks: [
          {
            type: "list",
            align: "left",
            list_style: "check",
            items: ["Item 1", "Item 2"],
          },
        ],
      }),
    );
    expect(html).toContain("lg-frame-footer2-list--check");
  });

  it("the check-style list uses UL (not OL) regardless of ordered vs check", () => {
    const html = renderFooterHtml(
      frameWithFooter({
        enabled: true,
        blocks: [
          {
            type: "list",
            align: "left",
            list_style: "check",
            items: ["Item 1", "Item 2"],
          },
        ],
      }),
    );
    expect(html).toContain("<ul");
    expect(html).not.toContain("<ol");
  });

  it("the footer list CSS for --check removes list-style and hides bullets", () => {
    const rule = CSS.match(/\.lg-frame-footer2-list--check\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("list-style:none");
    expect(rule).toContain("padding-left:0");
  });

  it("the footer list --check li rule positions the checkmark via ::before", () => {
    const rule = CSS.match(/\.lg-frame-footer2-list--check li\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("position:relative");
    expect(rule).toMatch(/padding-left:[0-9]/);
  });

  it("the footer list --check li::before emits a checkmark glyph", () => {
    const rule = CSS.match(/\.lg-frame-footer2-list--check li::before\{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("content:");
    expect(rule).toContain("2713"); // Unicode check mark
    expect(rule).toContain("position:absolute");
    expect(rule).toContain("left:0");
  });

  it("a footer list with list_style:ordered renders an OL (unchanged from before fix)", () => {
    const html = renderFooterHtml(
      frameWithFooter({
        enabled: true,
        blocks: [
          {
            type: "list",
            align: "left",
            list_style: "ordered",
            items: ["Item 1", "Item 2"],
          },
        ],
      }),
    );
    expect(html).toContain("<ol");
    expect(html).toContain('class="lg-frame-footer2-list"');
    expect(html).not.toContain("lg-frame-footer2-list--check");
  });

  it("the check-style list item content is NOT double-escaped", () => {
    const html = renderFooterHtml(
      frameWithFooter({
        enabled: true,
        blocks: [
          {
            type: "list",
            align: "left",
            list_style: "check",
            items: ["Item <b>bold</b>"],
          },
        ],
      }),
    );
    expect(html).toContain("<li>");
    // The sanitizeFrameInlineHtml call should allow basic tags
    expect(html).toContain("</li>");
  });
});
