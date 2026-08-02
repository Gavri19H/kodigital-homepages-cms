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
import {
  renderPublishBadge,
  publishBlockingReasons,
  publishFixTarget,
  isQuoteEditorSelfLink,
} from "../src/admin/leadgen/quotes-tabs/activation";
import { QUOTE_EDITOR_SCRIPT } from "../src/admin/leadgen/quotes-tabs/funnel";

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

  it("the rendered panel has exactly one data-tplbox-panel=\"footer\" editor and one footer picker card", () => {
    const panel = renderTemplatesTabPanel(true, []);
    expect((panel.match(/data-tplbox-panel="footer"/g) ?? []).length).toBe(1);
    expect((panel.match(/data-tplbox-pick="footer"/g) ?? []).length).toBe(1);
  });

  // R2 P7 (owner: "the 'J' element, I don't see it in the Quotes"). A.2 names
  // the footer element "J" and calls it a "seperate template element"; A.1
  // item 11.D names the progress bar "I". Both owner letters hold, the footer
  // is LAST, and A–F keep the letters the owner's other references use.
  it("the footer tile is lettered J, sits LAST, and neither A–F nor I·Progress moved", () => {
    const panel = renderTemplatesTabPanel(true, []);
    const tiles = [...panel.matchAll(/lg-tplbox-card-letter">([A-Z])<\/span>\s*<span>([^<]+)</g)].map(
      (m) => `${m[1]}:${m[2]}`,
    );
    expect(tiles).toEqual([
      "A:Background",
      "B:Logo",
      "C:Phone / URL",
      "D:Disclosure",
      "E:Free text",
      "F:Brand logos",
      "H:Images",
      "I:Progress",
      "J:Footer",
    ]);
    // the footer's own editor heading agrees with its tile letter
    expect(panel).toContain("<h3>J &middot; Footer</h3>");
    expect(panel).not.toContain("<h3>G &middot; Footer</h3>");
    // A.2's "seperate template element" is separate ON THE SCREEN too: its own
    // group, below the in-page elements.
    expect(panel).toContain('id="lg-tplbox-grid-separate"');
    expect(panel).toContain("Bottom of the page &mdash; separate template element");
    expect(panel.indexOf('id="lg-tplbox-grid-separate"')).toBeGreaterThan(panel.indexOf('id="lg-tplbox-grid"'));
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

// ---------------------------------------------------------------------------
// R2 P7 · Finding 2 — the owner's second report: "Blocked (2 errors)" named no
// reason, so the operator had to leave the tab they were standing on to learn
// why. Same defect shape as ADJ-A9 (a bare 409 the operator could not predict).
// ---------------------------------------------------------------------------

describe("R2 P7 — the publish chip STATES its blocking reasons next to the count", () => {
  // The exact preflight the owner's quote produces (Insurance / Car / draft /
  // no sections / no logo), captured live on 127.0.0.1:8901 from the REAL
  // GET /quotes/:id/activation: blocks=0, problems=2, both error-severity.
  const OWNER_PREFLIGHT = {
    ok: true,
    quote_id: "lgq_ownerCar",
    funnel_id: "lgf_ownerCar",
    funnel_variant_id: "lgn_ownerCar",
    computed_at: 0,
    blocks: [],
    problems: [
      {
        path: "activation.shared_page",
        scope: "section",
        severity: "error",
        message: "The shared first page needs at least one section.",
        fix_url: "/admin/leadgen/quotes/lgq_ownerCar/edit",
      },
      {
        path: "activation.funnel.lgf_ownerCar",
        scope: "section",
        severity: "error",
        message: "Funnel 'car — Funnel A' needs at least one page with a section.",
        fix_url: "/admin/leadgen/quotes/lgq_ownerCar/edit",
      },
    ],
  } as unknown as Parameters<typeof renderPublishBadge>[0];

  it("the chip still reads 'Blocked (2 errors)' — the count copy is untouched", () => {
    expect(renderPublishBadge(OWNER_PREFLIGHT)).toContain(">Blocked (2 errors)<");
  });

  it("FAIL-BEFORE/PASS-AFTER: the two reasons ship WITH the chip, no extra click", () => {
    const html = renderPublishBadge(OWNER_PREFLIGHT) ?? "";
    expect(html).toContain('id="lg-publish-why"');
    expect(html).toContain('data-publish-why-count="2"');
    expect((html.match(/data-publish-reason/g) ?? []).length).toBe(2);
    expect(html).toContain("The shared first page needs at least one section.");
    expect(html).toContain("needs at least one page with a section.");
  });

  it("the reason count and the chip count can never disagree (both derive from blocks + error problems)", () => {
    const reasons = publishBlockingReasons(OWNER_PREFLIGHT!);
    expect(reasons.length).toBe(2);
    const html = renderPublishBadge(OWNER_PREFLIGHT) ?? "";
    const chip = /data-publish-errors="(\d+)"/.exec(html);
    expect(chip?.[1]).toBe(String(reasons.length));
  });

  it("a warning-only preflight stays 'Ready (1 warning)' and emits NO reasons block", () => {
    const warnOnly = {
      ...(OWNER_PREFLIGHT as unknown as Record<string, unknown>),
      problems: [{ path: "frame.x", scope: "frame", severity: "warning", message: "Cosmetic", fix_url: "" }],
    } as unknown as Parameters<typeof renderPublishBadge>[0];
    const html = renderPublishBadge(warnOnly) ?? "";
    expect(html).toContain(">Ready (1 warning)<");
    expect(html).not.toContain('id="lg-publish-why"');
  });

  it("blocks (not just problems) are named too, reusing the preflight card's own wording", () => {
    const withBlock = {
      ...(OWNER_PREFLIGHT as unknown as Record<string, unknown>),
      ok: false,
      problems: [],
      blocks: [
        {
          section_id: 1,
          section_name: "ZIP",
          offer_id: 2,
          offer_name: "NextInsure",
          code: "missing_required_provider_fields",
          fields: ["current_insurance.carrier"],
          fix_links: { section_mapping: "/admin/leadgen/quotes/lgq_ownerCar/sections/1" },
        },
      ],
    } as unknown as Parameters<typeof renderPublishBadge>[0];
    const reasons = publishBlockingReasons(withBlock!);
    expect(reasons.length).toBe(1);
    expect(reasons[0]?.text).toBe(
      "Section: ZIP · Offer: NextInsure · Missing required provider fields: current_insurance.carrier",
    );
    expect(renderPublishBadge(withBlock)).toContain("Review slide");
  });

  it("the ES5 island mirrors the SSR structure (so a live re-render cannot strand stale reasons)", () => {
    for (const token of [
      "function publishBlockingReasons(preflight)",
      "function updatePublishReasons(badge, preflight)",
      "updatePublishReasons(badge, preflight);",
      "lg-publish-why",
      "data-publish-reason",
      "data-publish-why-count",
    ]) {
      expect(QUOTE_EDITOR_SCRIPT, `island token ${token}`).toContain(token);
    }
    // ES5 island discipline: the two functions this leg adds use no let/const/
    // arrow/template-literal syntax.
    const added = QUOTE_EDITOR_SCRIPT.slice(
      QUOTE_EDITOR_SCRIPT.indexOf("function publishBlockingReasons(preflight)"),
      QUOTE_EDITOR_SCRIPT.indexOf("function preflightFixLink("),
    );
    expect(added.length).toBeGreaterThan(500);
    expect(added).not.toMatch(/\blet\s|\bconst\s|=>/);
  });
});

// ---------------------------------------------------------------------------
// R2 P7 FIX-FIRST (owner) — D1: "Open Quote Builder", offered to an operator
// already standing in the Quote Builder. Every blocking reason must point at
// the CONTROL that clears it; a reason with no single control ships NO link,
// because a link that lands on the current screen is worse than none.
// D2: the board names the blocking page on the column itself.
// ---------------------------------------------------------------------------

describe("R2 P7 FIX-FIRST — every blocking reason points at the control that clears it", () => {
  const SELF = "/admin/leadgen/quotes/lgq_ownerCar/edit";
  const problem = (path: string, message: string, fix_url = SELF): Record<string, unknown> => ({
    path,
    scope: "section",
    severity: "error",
    message,
    fix_url,
  });
  const pf = (problems: Array<Record<string, unknown>>, blocks: Array<Record<string, unknown>> = []): Parameters<typeof renderPublishBadge>[0] =>
    ({
      ok: blocks.length === 0,
      quote_id: "lgq_ownerCar",
      funnel_id: "lgf_ownerCar",
      funnel_variant_id: "lgn_ownerCar",
      computed_at: 0,
      blocks,
      problems,
    }) as unknown as Parameters<typeof renderPublishBadge>[0];

  // The owner's live state: quote Car_ins, draft, Funnel builder tab open,
  // shared first page EMPTY while the funnel's PAGE 1 holds a section.
  const OWNER = pf([problem("activation.shared_page", "The shared first page needs at least one section.")]);

  it("FAIL-BEFORE: the owner's one reason no longer links to the page the operator is standing on", () => {
    const html = renderPublishBadge(OWNER) ?? "";
    // the exact <a href=".../edit">Open Quote Builder</a> the owner was shown
    expect(html).not.toContain(`href="${SELF}"`);
    expect(html).not.toContain(">Open Quote Builder<");
    expect(isQuoteEditorSelfLink(SELF)).toBe(true);
  });

  it("PASS-AFTER: it points at the Shared first page column's own ＋ section control", () => {
    const html = renderPublishBadge(OWNER) ?? "";
    expect(html).toContain('data-publish-fix-tab="builder"');
    expect(html).toContain('data-publish-fix-sel="[data-shared-col] [data-add-shared-section]"');
    expect(html).toContain("Add the shared page&#39;s first section");
    expect((html.match(/data-publish-reason/g) ?? []).length).toBe(1);
  });

  it("a funnel reason aims at THAT funnel's own page affordance (page card first, else + Add page)", () => {
    const target = publishFixTarget("activation.funnel.lgf_ownerCar", SELF);
    expect(target?.tab).toBe("builder");
    expect(target?.sel).toBe(
      '[data-funnel-col][data-funnel-public-id="lgf_ownerCar"] [data-add-section],[data-funnel-col][data-funnel-public-id="lgf_ownerCar"] [data-add-page]',
    );
    expect(target?.label).toBe("Add a section to this funnel");
  });

  // The AUDIT the owner asked for: every reason publishBlockingReasons() can
  // emit, with its target — or a stated reason it has none.
  const AUDIT: Array<[string, string | null]> = [
    ["activation.shared_page", "[data-shared-col] [data-add-shared-section]"],
    ["activation.funnel.lgf_ownerCar", '[data-funnel-col][data-funnel-public-id="lgf_ownerCar"] [data-add-section],[data-funnel-col][data-funnel-public-id="lgf_ownerCar"] [data-add-page]'],
    ["activation.default_funnel", "[data-funnel-col] [data-funnel-kebab]"],
    ["activation.rule.lgr_owner1", '[data-qr-card][data-rule-public-id="lgr_owner1"]'],
    // no single control: the same section sits on two pages, either copy can go
    ["activation.section_uniqueness", null],
    ["frame", '.lg-qpanel[data-panel="templates"]'],
    ["frame.trust_strip.logos[0].alt", '.lg-qpanel[data-panel="templates"]'],
    ["theme", '.lg-qpanel[data-panel="themes"]'],
    ["theme.palette.accent", '.lg-qpanel[data-panel="themes"]'],
  ];

  it.each(AUDIT)("audited reason path %s resolves to its control (%s)", (path, sel) => {
    expect(publishFixTarget(path, SELF)?.sel ?? null).toBe(sel);
  });

  it("NO reason ever renders a link back to this editor page (the ADJ-A9 invariant)", () => {
    const html = renderPublishBadge(pf(AUDIT.map(([p]) => problem(p, `msg ${p}`)))) ?? "";
    expect((html.match(/data-publish-reason/g) ?? []).length).toBe(AUDIT.length);
    expect(html).not.toContain(`href="${SELF}"`);
    expect(html).not.toContain(">Open Quote Builder<");
    // the one audited no-target path ships no affordance at all rather than a
    // link that lands nowhere
    expect((html.match(/data-publish-fix-sel=/g) ?? []).length).toBe(AUDIT.length - 1);
  });

  it("a genuine cross-screen fix keeps its link (Review slide / Open site settings)", () => {
    const html =
      renderPublishBadge(
        pf([
          problem("section.lgs_1.content", "Slide 2 'ZIP' contains funnel-layout elements", "/admin/leadgen/sections/lgs_1/edit"),
          problem("site.logo", "This site has no logo", "/admin/settings?site_id=st_1"),
        ]),
      ) ?? "";
    expect(html).toContain('href="/admin/leadgen/sections/lgs_1/edit"');
    expect(html).toContain(">Review slide<");
    expect(html).toContain(">Open site settings<");
  });

  it("the ES5 island mirrors the target map + the D2 board markers 1:1", () => {
    for (const token of [
      "function publishFixTarget(path, fixUrl)",
      "function isQuoteEditorSelfLink(fixUrl)",
      "function publishReasonFixNode(reason)",
      "function revealPublishFixTarget(tab, sel)",
      "function syncBoardBlockMarkers(preflight)",
      "data-publish-fix-sel",
      "data-publish-fix-tab",
      "data-publish-fix-flash",
      "data-col-block",
      "data-col-blocking",
      "syncBoardBlockMarkers(preflight);",
      "syncBoardBlockMarkers(lgData.preflight || null);",
      "[data-shared-col] [data-add-shared-section]",
      "[data-funnel-col] [data-funnel-kebab]",
      "'[data-qr-card][data-rule-public-id=\"' + pid + '\"]'",
    ]) {
      expect(QUOTE_EDITOR_SCRIPT, `island token ${token}`).toContain(token);
    }
    const added = QUOTE_EDITOR_SCRIPT.slice(
      QUOTE_EDITOR_SCRIPT.indexOf("function isQuoteEditorSelfLink(fixUrl)"),
      QUOTE_EDITOR_SCRIPT.indexOf("function preflightFixLink("),
    );
    expect(added.length).toBeGreaterThan(2000);
    expect(added).not.toMatch(/\blet\s|\bconst\s|=>/);
  });

  it("D2: the marker copy names the problem AND the owner's shared-first model", () => {
    // "the first page is shared by all the funnels" — stated on the board, at
    // the moment the shared page is the thing blocking, not only at publish.
    expect(QUOTE_EDITOR_SCRIPT).toContain(
      "Empty \\u2014 and every funnel starts with this page, before its own. Publishing is blocked until it has a section.",
    );
    expect(QUOTE_EDITOR_SCRIPT).toContain("No page with a section yet. Publishing is blocked until this funnel has one.");
    // quiet when nothing blocks: markers are cleared before any repaint and
    // only re-added per named error reason
    expect(QUOTE_EDITOR_SCRIPT).toContain("clearBoardBlockMarkers();");
    expect(QUOTE_EDITOR_SCRIPT).toContain("if (!preflight) { return; }");
  });

  it("an unexpected public_id never reaches a selector", () => {
    expect(publishFixTarget('activation.funnel.x"]:has(script)', SELF)).toBeNull();
    expect(publishFixTarget("activation.rule.a b", SELF)).toBeNull();
  });

  it("warning-only stays quiet — no reasons, no targets", () => {
    const html = renderPublishBadge(pf([{ path: "frame.x", scope: "frame", severity: "warning", message: "Cosmetic", fix_url: "" }])) ?? "";
    expect(html).toContain(">Ready (1 warning)<");
    expect(html).not.toContain("data-publish-fix-sel");
  });
});
