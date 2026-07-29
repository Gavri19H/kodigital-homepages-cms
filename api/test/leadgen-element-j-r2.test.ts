// LeadGen R2 P3 — element J (SOURCE-OF-TRUTH A.2, "bottom of the page
// template management"): the footer (G) upgrade IN PLACE (contract §5.4
// minor-1). Slice S3a — scope note: the conductor's mid-task citation
// correction added designs/frame.ts (singular, the SSR renderer) + the 5
// resolveSiteBranding call sites (D2 picks threading) to this slice's
// ownership, on top of the originally-owned quotes-tabs/templates.ts +
// designs/frames.ts. This file therefore covers BOTH layers: schema/
// validation/sanitization (frames.ts), editor markup + own preview-collector
// (templates.ts), AND real render-level proof through frame.ts's actual
// renderQuoteFrame (the SAME function serve.ts/quotes-handlers.ts/
// sections-handlers.ts call) — the composed() helper below mirrors
// leadgen-p5a-frame.test.ts's own pattern 1:1, deliberately bypassing
// validateFrameConfig (effectiveFrame alone does NOT sanitize) so the render
// path's OWN independent defenses are what is actually being proven, never a
// hand-built pre-sanitized fixture.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  validateFrameConfig,
  effectiveFrame,
  footerLegalPagePicks,
  FRAME_FOOTER_BLOCK_TYPES,
  FRAME_FOOTER_LINKS_SOURCES,
  FRAME_FOOTER_LINK_ROW_SOURCES,
} from "../src/public/leadgen/designs/frames";
import type { FrameConfig, EffectiveFrameConfig } from "../src/public/leadgen/designs/frames";
import { THEME_RECORD_FONT_NAMES, THEME_RECORD_FONT_STACKS, resolveTokens } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { renderQuoteFrame, LG_BANNERS_MOUNT_HTML } from "../src/public/leadgen/designs/frame";
import type { RenderQuoteFrameInput } from "../src/public/leadgen/designs/frame";
import type { SiteBranding } from "../src/leadgen/branding";
import { renderTemplatesTabPanel } from "../src/admin/leadgen/quotes-tabs/templates";

const TEMPLATES_TS_SOURCE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/admin/leadgen/quotes-tabs/templates.ts"),
  "utf8",
);

const TOKENS = resolveTokens(defaultFunnelDesign);
const ROOT = {
  funnelId: "lgf_0000000000000000000ELEMJ01",
  funnelVariantId: "lgn_0000000000000000000ELEMJ02",
  quoteId: "lgq_0000000000000000000ELEMJ03",
  contentVersion: 1,
};
const BRANDING: SiteBranding = {
  site_name: "Acme Insure",
  logo_url: "/media/site-logo.png",
  tagline: null,
  legal_links: [{ label: "Privacy policy", href: "/privacy-policy" }],
  trust_logos: null,
};

// Mirrors leadgen-p5a-frame.test.ts's own composed() 1:1 — effectiveFrame
// ONLY merges (no validation/sanitization happens in it), so a patch handed
// straight to it exercises frame.ts's OWN render-time defenses in isolation.
function composed(patch: FrameConfig, branding: SiteBranding | null = BRANDING): string {
  const { frame, problems } = effectiveFrame("centered", patch);
  expect(problems).toEqual([]);
  const input: RenderQuoteFrameInput = {
    effectiveTokens: TOKENS,
    frame,
    siteBranding: branding,
    sectionsHtml: "",
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount: 2,
    root: ROOT,
  };
  return renderQuoteFrame(input);
}

describe("R2 P3 element J — TPLBOX_CARDS stays a single footer entry (contract §5.4 minor-1)", () => {
  it("grep: exactly ONE { key: \"footer\" TPLBOX_CARDS array-entry literal in templates.ts", () => {
    const matches = TEMPLATES_TS_SOURCE.match(/\{\s*key:\s*"footer"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("the rendered panel has exactly one data-tplbox-panel=\"footer\" editor and one G footer picker card", () => {
    const panel = renderTemplatesTabPanel(true, []);
    expect((panel.match(/data-tplbox-panel="footer"/g) ?? []).length).toBe(1);
    expect((panel.match(/data-tplbox-pick="footer"/g) ?? []).length).toBe(1);
  });
});

describe("R2 P3 element J — anatomy: rich-text toolbar + heading/list types + independent font family + logo toggle", () => {
  const panel = renderTemplatesTabPanel(true, []);

  it("a real formatting toolbar exists (not a bare textarea)", () => {
    expect(panel).toContain('data-footer-fmt="bold"');
    expect(panel).toContain('data-footer-fmt="italic"');
    expect(panel).toContain('data-footer-fmt="link"');
    expect(panel).toContain("data-footer-block-toolbar");
    // the toolbar is IN ADDITION TO the textarea, not instead of it.
    expect(panel).toContain("data-footer-block-text");
  });

  it("the block-type picker offers Heading and List alongside the existing 6 types", () => {
    expect(FRAME_FOOTER_BLOCK_TYPES).toContain("heading");
    expect(FRAME_FOOTER_BLOCK_TYPES).toContain("list");
    expect(FRAME_FOOTER_BLOCK_TYPES.length).toBe(8);
    expect(panel).toContain('data-footer-block-liststyle');
    expect(panel).toContain('data-footer-block-items');
  });

  it("about_paragraph is relabeled to name the owner's company-details example, same enum value", () => {
    expect(panel).toContain("About paragraph / company details");
  });

  it("an independent font-family control exists, distinct from the main template, offering the closed theme font vocabulary", () => {
    expect(panel).toContain('data-frame-key="footer.typography_scope.font_family"');
    for (const name of THEME_RECORD_FONT_NAMES) {
      expect(panel).toContain(`>${name}<`);
    }
    // still independent of (in addition to) the existing text-size control.
    expect(panel).toContain('data-frame-key="footer.typography_scope.size"');
  });

  it("a logo toggle (site logo or manual) exists with media/URL/alt fields", () => {
    expect(panel).toContain("data-footer-block-logosource");
    expect(panel).toContain('data-list-field="logo_media_id"');
    expect(panel).toContain("data-footer-block-logourl");
    expect(panel).toContain("data-footer-block-logoalt");
  });
});

describe("R2 P3 element J — schema backward compatibility (no orphaned old footer)", () => {
  it("a pre-J footer config (only the original 6 block types, no new fields) still validates with zero problems", () => {
    const { config, problems } = validateFrameConfig({
      footer: {
        enabled: true,
        show_on: "all",
        links_source: "site",
        links: [],
        trust_text: null,
        description: null,
        show_logo: true,
        hide_on_mobile: false,
        blocks: [
          { type: "about_paragraph", text: "Acme Inc. is a lead generator.", align: "center" },
          { type: "link_row", links_source: "site", align: "center" },
          { type: "logo", align: "center" },
        ],
        palette_scope: { background: "page_background", text: "text_muted", link: "brand_primary" },
        typography_scope: { size: "s" },
      },
    });
    expect(problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(config).not.toBeNull();
  });
});

describe("R2 P3 element J — SECURITY (contract R2 minor-6): sanitizer fail-before/pass-after", () => {
  it("PASS: a <script>-bearing rich-text html string is stripped (never raw) on an about_paragraph/heading block", () => {
    const { config, problems } = validateFrameConfig({
      footer: {
        blocks: [
          { type: "about_paragraph", html: "<script>alert(1)</script><strong>ok</strong>", align: "left" },
          { type: "heading", html: '<a href="javascript:alert(2)">click</a>', align: "left" },
        ],
      },
    });
    expect(problems.filter((p) => p.severity === "error")).toEqual([]);
    const blocks = (config as { footer: { blocks: Array<{ html?: string }> } }).footer.blocks;
    expect(blocks[0]?.html).not.toContain("<script");
    expect(blocks[0]?.html).toContain("<strong>ok</strong>");
    expect(blocks[1]?.html).not.toContain("javascript:");
  });

  it("PASS: a javascript: link inside a footer LIST block's items is stripped", () => {
    const { config } = validateFrameConfig({
      footer: {
        blocks: [{ type: "list", items: ['<a href="javascript:x">bad</a>', "clean"], list_style: "unordered", align: "left" }],
      },
    });
    const blocks = (config as { footer: { blocks: Array<{ items?: string[] }> } }).footer.blocks;
    expect(blocks[0]?.items?.join(" ")).not.toContain("javascript:");
  });

  it("FAIL->REJECT: a javascript: footer logo URL is rejected (SAFE_HREF_RE gate), mirroring every other footer href", () => {
    const { config, problems } = validateFrameConfig({
      footer: { blocks: [{ type: "logo", logo_source: "manual", logo_url: "javascript:alert(1)", align: "center" }] },
    });
    expect(config).toBeNull();
    expect(problems.some((p) => p.path === "frame.footer.blocks[0].logo_url")).toBe(true);
  });

  it("an invalid footer block type is still rejected (heading/list additions did not widen the enum unsafely)", () => {
    const { config, problems } = validateFrameConfig({
      footer: { blocks: [{ type: "script_injection", align: "left" }] },
    });
    expect(config).toBeNull();
    expect(problems.some((p) => p.path === "frame.footer.blocks[0].type")).toBe(true);
  });
});

describe("R2 P3 element J — logo_source reuses FRAME_FOOTER_LINKS_SOURCES (no new near-duplicate enum)", () => {
  it("accepts site|manual, rejects anything else", () => {
    expect(FRAME_FOOTER_LINKS_SOURCES).toEqual(["site", "manual"]);
    const bad = validateFrameConfig({
      footer: { blocks: [{ type: "logo", logo_source: "cms_fallback", align: "center" }] },
    });
    expect(bad.config).toBeNull();
    expect(bad.problems.some((p) => p.path === "frame.footer.blocks[0].logo_source")).toBe(true);
  });
});

describe("R2 P3 element J — typography_scope.font_family is a CLOSED enum (theme.ts's own vocabulary, never an unconstrained string)", () => {
  it("accepts a THEME_RECORD_FONT_NAMES value", () => {
    const { config, problems } = validateFrameConfig({
      footer: { typography_scope: { size: "m", font_family: "Newsreader" } },
    });
    expect(problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(config).not.toBeNull();
  });

  it("REJECTS an arbitrary, unvetted font-family string (the same P0 STORED-XSS class theme.ts's own comment documents)", () => {
    const { config, problems } = validateFrameConfig({
      footer: { typography_scope: { font_family: "</style><script>alert(1)</script>" } },
    });
    expect(config).toBeNull();
    expect(problems.some((p) => p.path === "frame.footer.typography_scope.font_family")).toBe(true);
  });
});

describe("R2 P3 element J D2 — link_row's OWN wider enum (adds \"picked\"), scoped away from logo_source/top-level links_source", () => {
  it("FRAME_FOOTER_LINK_ROW_SOURCES adds picked; the shared FRAME_FOOTER_LINKS_SOURCES (logo_source, top-level footer.links_source) stays site|manual", () => {
    expect(FRAME_FOOTER_LINK_ROW_SOURCES).toEqual(["site", "manual", "picked"]);
    expect(FRAME_FOOTER_LINKS_SOURCES).toEqual(["site", "manual"]);
  });

  it("a link_row block validates picks (page_type + label required; manual_url SAFE_HREF-gated)", () => {
    const ok = validateFrameConfig({
      footer: {
        blocks: [
          {
            type: "link_row",
            links_source: "picked",
            picks: [{ page_type: "privacy-policy", label: "Privacy Policy" }, { page_type: "terms", label: "Terms", manual_url: "/fallback-terms" }],
          },
        ],
      },
    });
    expect(ok.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(ok.config).not.toBeNull();

    const bad = validateFrameConfig({
      footer: { blocks: [{ type: "link_row", links_source: "picked", picks: [{ page_type: "", label: "" }] }] },
    });
    expect(bad.config).toBeNull();
    expect(bad.problems.some((p) => p.path === "frame.footer.blocks[0].picks[0].page_type")).toBe(true);
    expect(bad.problems.some((p) => p.path === "frame.footer.blocks[0].picks[0].label")).toBe(true);
  });

  it("SECURITY: a javascript: manual_url fallback on a pick is rejected (the ONE new operator-typed href this leg adds)", () => {
    const { config, problems } = validateFrameConfig({
      footer: { blocks: [{ type: "link_row", links_source: "picked", picks: [{ page_type: "terms", label: "Terms", manual_url: "javascript:alert(1)" }] }] },
    });
    expect(config).toBeNull();
    expect(problems.some((p) => p.path === "frame.footer.blocks[0].picks[0].manual_url")).toBe(true);
  });
});

describe("R2 P3 element J D2 — footerLegalPagePicks (the one extraction point every resolveSiteBranding call site reads)", () => {
  it("finds the picked link_row block's picks inside an effective frame", () => {
    const { frame } = effectiveFrame("centered", {
      footer: { blocks: [{ type: "link_row", links_source: "picked", picks: [{ page_type: "privacy-policy", label: "Privacy" }] }] },
    } as FrameConfig);
    expect(footerLegalPagePicks(frame)).toEqual([{ page_type: "privacy-policy", label: "Privacy" }]);
  });

  it("undefined when there is no picked link_row (byte-identical resolveSiteBranding(db, siteId) 2-arg call for every pre-D2 funnel)", () => {
    const { frame } = effectiveFrame("centered", {
      footer: { blocks: [{ type: "link_row", links_source: "site" }] },
    } as FrameConfig);
    expect(footerLegalPagePicks(frame)).toBeUndefined();
    expect(footerLegalPagePicks(null)).toBeUndefined();
    expect(footerLegalPagePicks(undefined)).toBeUndefined();
  });
});

describe("R2 P3 element J — RENDER (designs/frame.ts, real renderQuoteFrame): rich text, headings, lists, independent font, manual logo", () => {
  it("about_paragraph/disclosure/heading render sanitized html through the render path's OWN defenses (composed() never called validateFrameConfig)", () => {
    const html = composed({
      footer: {
        blocks: [
          { type: "about_paragraph", html: "<script>alert(1)</script><strong>Acme Inc.</strong> is a lead generator." },
          { type: "heading", html: "Equal Opportunity Notice" },
          { type: "disclosure", html: '<a href="javascript:alert(2)">click</a> safe copy' },
        ],
      },
    } as FrameConfig);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("<strong>Acme Inc.</strong>");
    expect(html).toContain("Equal Opportunity Notice");
    expect(html).toMatch(/<h[1-6] class="lg-frame-footer2-heading"/);
  });

  it("a list block renders ul/ol with sanitized <li> items (mirrors free-text's own list rendering)", () => {
    const html = composed({
      footer: {
        blocks: [{ type: "list", list_style: "ordered", items: ["<a href=\"javascript:x\">bad</a>", "Licensing & Regulatory Status"] }],
      },
    } as FrameConfig);
    expect(html).toContain("<ol");
    expect(html).toContain("Licensing &amp; Regulatory Status");
    expect(html).not.toContain("javascript:");
  });

  it("the independent font-family renders as a --lg-footer-font CSS custom property, the theme's own pre-vetted stack", () => {
    const html = composed({
      footer: { blocks: [{ type: "about_paragraph", text: "Acme" }], typography_scope: { font_family: "Newsreader" } },
    } as FrameConfig);
    expect(html).toContain(`--lg-footer-font:${THEME_RECORD_FONT_STACKS.Newsreader}`);
  });

  it("a manual logo renders an <img> from a direct URL; an unsafe manual URL falls back to the site logo instead of rendering raw", () => {
    const safe = composed({
      footer: { blocks: [{ type: "logo", logo_source: "manual", logo_url: "https://cdn.example.com/logo.png", logo_alt: "Acme" }] },
    } as FrameConfig);
    expect(safe).toContain('src="https://cdn.example.com/logo.png"');
    expect(safe).toContain('alt="Acme"');

    const unsafe = composed({
      footer: { blocks: [{ type: "logo", logo_source: "manual", logo_url: "javascript:alert(1)" }] },
    } as FrameConfig);
    expect(unsafe).not.toContain("javascript:");
    expect(unsafe).toContain('src="/media/site-logo.png"'); // renderFooterLogo fallback (site branding)
  });

  it("link_row links_source:\"picked\" reads branding.legal_links exactly like \"site\" (S3b's D2 resolution already happened by render time)", () => {
    const html = composed({ footer: { blocks: [{ type: "link_row", links_source: "picked" }] } } as FrameConfig);
    expect(html).toContain("/privacy-policy");
    expect(html).toContain("Privacy policy");
  });

  it("SECURITY (R2 minor-6) defense in depth: an unsafe href in link_row.links / socials.url never reaches the served HTML even bypassing validateFrameConfig entirely", () => {
    const html = composed({
      footer: {
        blocks: [
          { type: "link_row", links_source: "manual", links: [{ label: "Evil", href: "javascript:alert(1)" }] },
          { type: "socials", socials: [{ platform: "Evil", url: "javascript:alert(2)" }] },
        ],
      },
    } as FrameConfig);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain(">Evil<");
  });

  it("BACK-COMPAT: a pre-J footer (plain text only, no html/picks/font_family) renders byte-identically to the escaped-text path", () => {
    const html = composed({
      footer: { blocks: [{ type: "about_paragraph", text: "<b>not markup</b>", align: "left" }] },
    } as FrameConfig);
    expect(html).toContain("&lt;b&gt;not markup&lt;/b&gt;");
    expect(html).not.toContain("<b>not markup</b>");
  });
});
