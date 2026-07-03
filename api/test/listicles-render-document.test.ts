// Public listicle document assembly — §30.2 order, §21 GA4 head path, hero
// eager/lazy media, governed hrefs, XSS: hostile content stays escaped.

import { describe, it, expect } from "vitest";
import {
  renderListicleDocument,
  renderByline,
  type ListicleRenderInput,
  type RenderSectionRow,
} from "../src/public/listicle/render";

function baseInput(overrides: Partial<ListicleRenderInput> = {}): ListicleRenderInput {
  const sections = new Map<number, RenderSectionRow>([
    [
      1,
      {
        id: 1,
        public_id: "sec_1",
        section_name: "S1",
        headline_text: "First neutral heading",
        headline_offer_id: 42,
        image_json: JSON.stringify({ url: "/media/img-1.png" }),
        content_json: JSON.stringify({
          blocks: [
            { type: "paragraph", data: { text: "Neutral body copy." } },
            {
              type: "choice_button_group",
              data: {
                layout_binding: "default.choiceButtonGroup",
                items: [
                  { text: "Yes", offer_id: "off_9", link_instance_id: "lnk_1" },
                  { text: "No", offer_id: "off_9", link_instance_id: "lnk_2" },
                ],
              },
            },
          ],
        }),
      },
    ],
  ]);
  return {
    hostname: "tenant.example.com",
    brand: { siteName: "Tenant Site", logoUrl: "/media/logo.png" },
    settings: {},
    article: { public_id: "art_1", slug: "fixture-slug" },
    version: {
      public_id: "ver_1",
      headline: "Two line\nHeadline here",
      intro_paragraph: "Intro copy.\n\nSecond intro.",
      hero_url: "/media/hero.png",
      byline_json: JSON.stringify({
        enabled: true,
        author_name: "Casey Author",
        author_avatar_url: "/media/avatar.png",
        label: "Advertorial",
        updated_label: "Updated:",
        updated_date: "July 1, 2026",
      }),
      layout_style_id: "default",
      content_version: 1,
    },
    pages: [
      {
        public_id: "pg_0",
        page_index: 0,
        selection_mode: "single",
        ab_test_id: null,
        rule_set_id: null,
        candidates: [
          { public_id: "cand_A", section_id: 1, is_fallback: 0, rule_public_id: null },
        ],
      },
    ],
    sections,
    offerPublicIdByRef: new Map([
      ["off_9", "off_9"],
      ["42", "off_headline42"],
    ]),
    ...overrides,
  };
}

describe("document assembly (§30.2 order + head composition)", () => {
  const { html } = renderListicleDocument(baseInput());

  it("§30.2 component order: header → shell → legal band → footer", () => {
    // Search the BODY only (the <head> stylesheet legitimately mentions the
    // same class names in its selectors).
    const body = html.slice(html.indexOf("</head>"));
    const header = body.indexOf('<header class="lst-header"');
    const shell = body.indexOf('<article class="lst-article-shell"');
    const legal = body.indexOf('<div class="lst-legal-band"');
    const footer = body.indexOf('<footer class="lst-footer"');
    expect(header).toBeGreaterThan(-1);
    expect(shell).toBeGreaterThan(header);
    expect(legal).toBeGreaterThan(shell);
    expect(footer).toBeGreaterThan(legal);
  });

  it("hero is EAGER + fetchpriority high; section media is lazy (responsive-img)", () => {
    expect(html).toContain('loading="eager" fetchpriority="high"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("/cdn-cgi/image/"); // responsive srcset candidates
  });

  it("the HostLogo is the site-settings logo (the ONLY per-host brand swap)", () => {
    expect(html).toContain('src="/media/logo.png"');
  });

  it("governed anchors carry minted /lc hrefs with full context", () => {
    expect(html).toContain('href="/lc/off_9?a=art_1&amp;lv=ver_1');
    // linked headline resolves its legacy numeric ref (42 → off_headline42).
    expect(html).toContain('href="/lc/off_headline42?');
  });

  it("byline renders the §30.2 model (label · author · updated)", () => {
    expect(html).toContain("Advertorial · By Casey Author · Updated: July 1, 2026");
    expect(html).toContain('class="lst-byline-avatar"');
  });

  it("canonical + title compose from the tenant host + headline", () => {
    expect(html).toContain('<link rel="canonical" href="https://tenant.example.com/fixture-slug">');
    expect(html).toContain("<title>Two line Headline here</title>");
  });

  it("the numbered heading badge + linked heading structure render", () => {
    expect(html).toContain('<span class="lst-heading-badge">1.</span>');
    expect(html).toContain('data-link-role="headline"');
  });

  it("choice groups are annotated with their measured column mode (2 buttons → 2-col)", () => {
    expect(html).toContain('data-lst-cols="2"');
  });

  it("the HOMEPAGE beacon script is NOT included (listicle beacon is Phase 7)", () => {
    expect(html).not.toContain("/api/track");
    expect(html).not.toContain("koTrack");
    // …and the homepage assets do not leak into the listicle page.
    expect(html).not.toContain("/assets/public.js");
    expect(html).not.toContain("/assets/public.css");
  });
});

describe("§21 GA4 — the existing custom-head path", () => {
  it("analytics_script (GA4 loader) rides into <head> sanitized", () => {
    const ga =
      '<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST1"></script>' +
      "<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-TEST1');</script>";
    const { html } = renderListicleDocument(
      baseInput({ settings: { analytics_script: ga } }),
    );
    expect(html).toContain("googletagmanager.com/gtag/js?id=G-TEST1");
    expect(html).toContain("gtag('config','G-TEST1')");
    expect(html).toContain("<!-- analytics_script -->");
  });

  it("head is byte-clean of analytics when no settings exist", () => {
    const { html } = renderListicleDocument(baseInput({ settings: {} }));
    expect(html).not.toContain("analytics_script");
    expect(html).not.toContain("googletagmanager");
  });
});

describe("XSS — hostile stored content stays escaped/governed through the render path", () => {
  it("hostile section + version fields render inert", () => {
    const hostile = baseInput();
    const hostileSection: RenderSectionRow = {
      id: 1,
      public_id: "sec_1",
      section_name: "S1",
      headline_text: '<script>alert(1)</script><img src=x onerror=alert(2)>',
      headline_offer_id: null,
      image_json: JSON.stringify({ url: "javascript:alert(3)" }),
      content_json: JSON.stringify({
        blocks: [
          {
            type: "paragraph",
            data: {
              text: "",
              html: '<a href="https://evil.example" data-offer="off_9">click</a><script>alert(4)</script>',
            },
          },
        ],
      }),
    };
    hostile.sections = new Map([[1, hostileSection]]);
    hostile.version = {
      ...hostile.version,
      headline: '<script>alert(5)</script>\n<b onmouseover=alert(6)>x</b>',
      intro_paragraph: '<iframe src="https://evil.example"></iframe>',
      byline_json: JSON.stringify({
        enabled: true,
        author_name: '<script>alert(7)</script>',
        label: "",
        updated_label: "",
        updated_date: "",
      }),
    };
    hostile.brand = { siteName: '<script>alert(8)</script>', logoUrl: null };
    const { html } = renderListicleDocument(hostile);

    // No LIVE hostile markup survives — escaped text may contain the inert
    // substrings (e.g. "&lt;img src=x onerror=…"), but no actual tag does.
    expect(html).not.toContain("<script>alert(");
    expect(html).not.toMatch(/<img[^>]*onerror/);
    expect(html).not.toMatch(/<b[^>]*onmouseover/);
    expect(html).not.toMatch(/(?:href|src)\s*=\s*"javascript:/i);
    expect(html).not.toContain("<iframe");
    // the hostile governed anchor's raw href never survives; the /lc mint owns it.
    expect(html).not.toContain('href="https://evil.example"');
  });
});

describe("renderByline edge cases", () => {
  it("disabled/absent/malformed byline renders nothing", () => {
    expect(renderByline(null)).toBe("");
    expect(renderByline("{not json")).toBe("");
    expect(renderByline(JSON.stringify({ enabled: false, author_name: "X" }))).toBe("");
  });
});
