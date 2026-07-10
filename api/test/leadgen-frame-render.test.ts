// LeadGen v2.5 Phase A — contract test `frame-plus-unit-composition`
// (redesign-contract-v2.5 13 §13.1 + 04 §4.3 + 10 §10.2 + 11).
//
// Proves, over the PURE renderQuoteFrame/renderLegacyShell module:
//   1. region presence per template — all 6 §4.3 templates render exactly
//      their expected `data-frame-region` set under template defaults;
//   2. engine hooks emitted ONCE — exactly one frame-owned `data-lg-progress`
//      and one frame-owned `data-lg-back` in the composed page even when
//      sectionsHtml itself carries legacy per-section progress/back nodes
//      (they may coexist in the DOM — the frame emits exactly one of its own;
//      counted as total minus the sectionsHtml's own hooks, plus a frame-only
//      render where the count is absolute); the sections list rides inside
//      the section_slot UNTOUCHED and [data-lg-banners] survives once;
//   3. `frame === null` legacy path — renderLegacyShell reproduces the
//      committed legacy-pin fixture's body portion BYTE-EXACTLY.
//      Extraction boundary (13 §13.1 "full body inside #lg-funnel-root"):
//      from `<div id="lg-funnel-root"` through the first `</main></div>` —
//      the root div incl. the data-lg-mount main + banners mount; the
//      config/assignment/prehydrate/engine <script>s after it stay serve.ts
//      chrome. The pin's documented ULID placeholders are handled by
//      construction: the ids fed to renderLegacyShell are read FROM the pin;
//   4. disabled/absent groups render nothing;
//   5. §10.2 header-logo ladder incl. an ABSENT siteBranding (degrades to the
//      CMS fallback mark) + footer links_source:"site" omission rule;
//   6. chrome-CSS extension — funnelChromeCss without the frameRegions opt is
//      byte-identical (the pinned shell embeds it), with the opt it appends
//      the .lg-frame-* rules while keeping ONE @media block and accepts the
//      resolveTokens() widened design.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  CMS_FALLBACK_LOGO_TEXT,
  LG_BANNERS_MOUNT_HTML,
  renderLegacyShell,
  renderQuoteFrame,
} from "../src/public/leadgen/designs/frame";
import type { RenderQuoteFrameInput } from "../src/public/leadgen/designs/frame";
import { FRAME_TEMPLATE_IDS, effectiveFrame } from "../src/public/leadgen/designs/frames";
import type { FrameConfig, FrameTemplateId } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import {
  DEFAULT_FUNNEL_SCOPE,
  funnelChromeCss,
} from "../src/public/leadgen/designs/default-funnel/styles";
import type { SiteBranding } from "../src/leadgen/branding";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SHELL_FIXTURE = join(TEST_DIR, "fixtures", "leadgen-legacy-pin", "legacy-shell.html");

// ---------------------------------------------------------------------------
// shared fixtures + helpers
// ---------------------------------------------------------------------------

const TOKENS = resolveTokens(defaultFunnelDesign); // identity resolve (§9.2)

const BRANDING: SiteBranding = {
  site_name: "Acme Insure",
  logo_url: "/media/site-logo.png",
  tagline: "Compare in minutes",
  legal_links: [
    { label: "Contact", href: "/contact" },
    { label: "Privacy policy", href: "/privacy-policy" },
    { label: "Terms of use", href: "/terms" },
  ],
};

const ROOT = {
  funnelId: "lgf_0000000000000000000FRAME01",
  funnelVariantId: "lgn_0000000000000000000FRAME02",
  quoteId: "lgq_0000000000000000000FRAME03",
  contentVersion: 7,
};

// Two legacy sections CARRYING their own per-section engine hooks (the v2.4
// world): one data-lg-progress mount (+ its -bar child, which must NOT count
// as a mount) and one data-lg-back — the coexistence case the frame must
// tolerate while emitting exactly one of each of its own.
const LEGACY_SECTIONS =
  '<section data-lg-section data-lg-section-id="lgs_0000000000000000000FRSEC01" data-lg-index="0" data-screen-label="01 · Q1">' +
  '<div class="lg-progress" data-lg-progress data-mode="percent" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="40">' +
  '<div class="lg-progress-track"><div class="lg-progress-fill" data-lg-progress-bar style="width:40%"></div></div></div>' +
  '<button type="button" class="lg-back" data-lg-back aria-label="Back"><span aria-hidden="true">&#8592;</span> Back</button>' +
  '<h1 class="lg-headline">Q1</h1>' +
  "</section>" +
  '<section data-lg-section data-lg-section-id="lgs_0000000000000000000FRSEC02" data-lg-index="1" data-screen-label="02 · Q2" hidden>' +
  '<h1 class="lg-headline">Q2</h1>' +
  "</section>";

// Engine-hook counters. The negative lookahead keeps compound attributes
// (data-lg-progress-bar / data-lg-progress-label / data-lg-progress-current…)
// out of the MOUNT count.
const PROGRESS_MOUNT_RE = /data-lg-progress(?![-a-z])/g;
const BACK_MOUNT_RE = /data-lg-back(?![-a-z])/g;
const countRe = (s: string, re: RegExp): number => [...s.matchAll(re)].length;

function composed(
  template: FrameTemplateId,
  patch?: FrameConfig,
  over?: Partial<RenderQuoteFrameInput>,
): string {
  const { frame, problems } = effectiveFrame(template, patch ?? null);
  expect(problems).toEqual([]);
  return renderQuoteFrame({
    effectiveTokens: TOKENS,
    frame,
    siteBranding: BRANDING,
    sectionsHtml: LEGACY_SECTIONS,
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount: 2,
    root: ROOT,
    ...over,
  });
}

function regionSet(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/data-frame-region="([a-z_]+)"/g)) {
    if (m[1] !== undefined) out.add(m[1]);
  }
  return [...out].sort();
}

const regionIdx = (html: string, name: string): number =>
  html.indexOf(`data-frame-region="${name}"`);

// ---------------------------------------------------------------------------
// 1. region presence per template (§4.3 — defaults; content-requiring groups
//    like trust_strip/benefit_bar default OFF, so they are absent here)
// ---------------------------------------------------------------------------

describe("frame-plus-unit-composition — region presence per template (§4.3)", () => {
  const EXPECTED: Record<FrameTemplateId, string[]> = {
    // logo top-center → progress → centered card slot → (trust off) → footer
    centered: ["back", "background", "footer", "logo", "progress", "section_slot"],
    // site header → progress → bare slot → LARGE site footer
    "header-footer": ["back", "background", "footer", "header", "progress", "section_slot"],
    // disclosure top bar → logo+CTA header → progress → slot → back link
    "header-cta": ["back", "background", "disclosure", "footer", "header", "progress", "section_slot"],
    // brand background → logo → step dots → white card slot → legal footer
    "full-background": ["back", "background", "footer", "logo", "progress", "section_slot"],
    // white page → minimal header → slot → (trust strip off by default)
    "white-trust": ["back", "background", "footer", "header", "progress", "section_slot"],
    // clean header → progress → back → bare slot, NO footer
    minimal: ["back", "background", "header", "progress", "section_slot"],
  };

  for (const id of FRAME_TEMPLATE_IDS) {
    it(`'${id}' renders exactly its expected region set`, () => {
      expect(regionSet(composed(id))).toEqual(EXPECTED[id]);
    });
  }

  it("centered/full-background stamp the top band as 'logo'; the site-header templates stamp 'header'", () => {
    for (const id of FRAME_TEMPLATE_IDS) {
      const html = composed(id);
      const expectLogo = id === "centered" || id === "full-background";
      expect(regionIdx(html, "logo") !== -1, id).toBe(expectLogo);
      expect(regionIdx(html, "header") !== -1, id).toBe(!expectLogo);
    }
  });

  it("header-cta follows the §4.3 row order: disclosure top bar → header → progress → slot → back link", () => {
    const html = composed("header-cta");
    const disc = regionIdx(html, "disclosure");
    const header = regionIdx(html, "header");
    const progress = regionIdx(html, "progress");
    const slot = regionIdx(html, "section_slot");
    const back = regionIdx(html, "back");
    expect(disc).toBeGreaterThan(-1);
    expect(disc).toBeLessThan(header);
    expect(header).toBeLessThan(progress);
    expect(progress).toBeLessThan(slot);
    expect(slot).toBeLessThan(back); // back.position below_card (template default)
  });

  it("full-background renders the brand background layer + step dots above the unit", () => {
    const html = composed("full-background");
    expect(html).toContain("lg-frame-bg-role-brand_primary");
    expect(html).toContain("lg-frame-bg-style-brand");
    expect(html).toContain('<span class="lg-step" data-active="true"');
    const logo = regionIdx(html, "logo");
    const progress = regionIdx(html, "progress");
    const slot = regionIdx(html, "section_slot");
    expect(logo).toBeLessThan(progress); // dots at above_unit (template default)
    expect(progress).toBeLessThan(slot);
    expect(progress).toBeGreaterThan(html.indexOf("lg-frame-header")); // after the logo band
  });

  it("the root div carries the serve.ts identity attributes + the frame template stamp", () => {
    const html = composed("centered");
    expect(html.startsWith('<div id="lg-funnel-root" class="lg-frame lg-frame--centered"')).toBe(true);
    expect(html).toContain('data-funnel-design="default-funnel"');
    expect(html).toContain(`data-funnel-id="${ROOT.funnelId}"`);
    expect(html).toContain(`data-funnel-variant-id="${ROOT.funnelVariantId}"`);
    expect(html).toContain(`data-quote-id="${ROOT.quoteId}"`);
    expect(html).toContain('data-content-version="7"');
    expect(html).toContain('data-frame-template="centered"');
    expect(html.endsWith("</div>")).toBe(true);
  });

  it("is PURE: identical inputs render identical bytes", () => {
    expect(composed("header-cta")).toBe(composed("header-cta"));
  });
});

// ---------------------------------------------------------------------------
// 2. engine hooks — emitted once by the frame; sections untouched (13 §13.1)
// ---------------------------------------------------------------------------

describe("frame-plus-unit-composition — SAME engine hooks, exactly one frame-owned mount", () => {
  const legacyProgress = countRe(LEGACY_SECTIONS, PROGRESS_MOUNT_RE);
  const legacyBack = countRe(LEGACY_SECTIONS, BACK_MOUNT_RE);

  it("the legacy-section fixture really carries its own hooks (control)", () => {
    expect(legacyProgress).toBe(1);
    expect(legacyBack).toBe(1);
  });

  for (const id of FRAME_TEMPLATE_IDS) {
    it(`'${id}': exactly ONE frame-owned data-lg-progress + ONE data-lg-back, coexisting with legacy in-section hooks`, () => {
      const html = composed(id);
      expect(countRe(html, PROGRESS_MOUNT_RE) - legacyProgress).toBe(1);
      expect(countRe(html, BACK_MOUNT_RE) - legacyBack).toBe(1);
      // frame-only render (no sections): the absolute counts are 1.
      const frameOnly = composed(id, undefined, { sectionsHtml: "" });
      expect(countRe(frameOnly, PROGRESS_MOUNT_RE)).toBe(1);
      expect(countRe(frameOnly, BACK_MOUNT_RE)).toBe(1);
    });
  }

  it("sectionsHtml rides inside the section_slot UNTOUCHED; banners mount + data-lg-mount survive once", () => {
    const html = composed("centered");
    expect(html).toContain(LEGACY_SECTIONS); // byte-verbatim pass-through
    expect(html.split(LG_BANNERS_MOUNT_HTML).length - 1).toBe(1);
    expect(html.split("data-lg-mount").length - 1).toBe(1);
    // the banners mount sits INSIDE the data-lg-mount main, after the sections
    const mainOpen = html.indexOf('<main class="lg-content" data-lg-mount>');
    const mainClose = html.indexOf("</main>");
    const banners = html.indexOf(LG_BANNERS_MOUNT_HTML);
    expect(mainOpen).toBeGreaterThan(-1);
    expect(banners).toBeGreaterThan(mainOpen);
    expect(banners).toBeLessThan(mainClose);
    // and the whole main lives inside the section_slot region wrapper
    expect(regionIdx(html, "section_slot")).toBeLessThan(mainOpen);
  });
});

// ---------------------------------------------------------------------------
// 3. frame === null legacy path — byte-exact against the committed pin
// ---------------------------------------------------------------------------

describe("frame-plus-unit-composition — renderLegacyShell reproduces the pinned body byte-exactly (13 §13.1)", () => {
  // Boundary: `<div id="lg-funnel-root"` open through the first
  // `</main></div>` (root div incl. data-lg-mount main + banners close). The
  // trailing config/assignment/prehydrate/engine scripts are serve.ts chrome,
  // not frame body — they stay outside renderLegacyShell.
  const pin = readFileSync(SHELL_FIXTURE, "utf8");
  const startTok = '<div id="lg-funnel-root"';
  const endTok = "</main></div>";
  const start = pin.indexOf(startTok);
  const end = pin.indexOf(endTok, start);
  const pinnedBody = pin.slice(start, end + endTok.length);

  const pinAttr = (name: string): string => {
    const m = pinnedBody.match(new RegExp(`${name}="([^"]*)"`));
    if (m === null || m[1] === undefined) throw new Error(`pin attr ${name} missing`);
    return m[1];
  };

  it("the extracted pin portion is a real funnel body (guards the boundary)", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(pinnedBody.length).toBeGreaterThan(4000);
    expect(pinnedBody.split("<section data-lg-section").length - 1).toBe(3);
    expect(pinnedBody).toContain(LG_BANNERS_MOUNT_HTML);
    // the pin's documented ULID placeholders (L is outside the Crockford set)
    expect(pinAttr("data-funnel-id")).toBe(`lgf_${"L".repeat(24)}01`);
    expect(pinAttr("data-funnel-variant-id")).toBe(`lgn_${"L".repeat(24)}02`);
    expect(pinAttr("data-quote-id")).toBe(`lgq_${"L".repeat(24)}03`);
  });

  it("renderLegacyShell(pin inputs) === the pinned body, byte for byte", () => {
    const mainOpen = '<main class="lg-content" data-lg-mount>';
    const innerStart = pinnedBody.indexOf(mainOpen) + mainOpen.length;
    const innerEnd = pinnedBody.indexOf(LG_BANNERS_MOUNT_HTML);
    expect(innerStart).toBeGreaterThan(mainOpen.length - 1);
    expect(innerEnd).toBeGreaterThan(innerStart);

    const rebuilt = renderLegacyShell({
      designId: pinAttr("data-funnel-design"),
      funnelId: pinAttr("data-funnel-id"),
      funnelVariantId: pinAttr("data-funnel-variant-id"),
      quoteId: pinAttr("data-quote-id"),
      contentVersion: pinAttr("data-content-version"),
      sectionsHtml: pinnedBody.slice(innerStart, innerEnd),
      bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    });
    expect(rebuilt).toBe(pinnedBody);
  });

  it("renderLegacyShell emits NO frame markup (legacy = byte-compatible current shell)", () => {
    const rebuilt = renderLegacyShell({
      designId: "default-funnel",
      funnelId: ROOT.funnelId,
      funnelVariantId: ROOT.funnelVariantId,
      quoteId: ROOT.quoteId,
      contentVersion: 1,
      sectionsHtml: "<section data-lg-section></section>",
      bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    });
    expect(rebuilt).not.toContain("data-frame-region");
    expect(rebuilt).not.toContain("lg-frame");
  });
});

// ---------------------------------------------------------------------------
// 4. disabled / absent groups render nothing
// ---------------------------------------------------------------------------

describe("frame-plus-unit-composition — disabled groups render nothing", () => {
  it("header off / footer off / progress hidden / back hidden / disclosure off → only background + section_slot", () => {
    const html = composed("centered", {
      header: { enabled: false },
      footer: { enabled: false },
      progress: { style: "hidden" },
      back: { style: "hidden" },
      disclosure: { enabled: false },
    });
    expect(regionSet(html)).toEqual(["background", "section_slot"]);
    // no frame-owned hooks appear — only the legacy sections' own remain
    expect(countRe(html, PROGRESS_MOUNT_RE)).toBe(countRe(LEGACY_SECTIONS, PROGRESS_MOUNT_RE));
    expect(countRe(html, BACK_MOUNT_RE)).toBe(countRe(LEGACY_SECTIONS, BACK_MOUNT_RE));
  });

  it('footer show_on:"never" renders no footer region', () => {
    const html = composed("centered", { footer: { show_on: "never" } });
    expect(regionIdx(html, "footer")).toBe(-1);
  });

  it("an enabled trust strip with zero logos renders nothing (never a broken strip)", () => {
    const html = composed("centered", { trust_strip: { enabled: true, logos: [] } });
    expect(regionIdx(html, "trust_strip")).toBe(-1);
  });

  it("an enabled benefit bar with zero items renders nothing", () => {
    const html = composed("centered", { benefit_bar: { enabled: true, items: [] } });
    expect(regionIdx(html, "benefit_bar")).toBe(-1);
  });

  it("trust strip + benefit bar render per config when content exists", () => {
    const html = composed("centered", {
      trust_strip: {
        enabled: true,
        logos: [{ media_id: "trust/one.png", alt: "TrustCo" }],
        placement: "between_progress_and_unit",
      },
      benefit_bar: {
        enabled: true,
        items: [{ icon: "✔", text: "No fees" }],
        placement: "below_unit",
      },
    });
    // trust strip: LogoStrip preset over mediaUrl()-resolved refs, REQUIRED alt
    expect(html).toContain('<img class="lg-logo-strip-img" src="/media/trust/one.png" alt="TrustCo"');
    const trust = regionIdx(html, "trust_strip");
    const progress = regionIdx(html, "progress");
    const slot = regionIdx(html, "section_slot");
    expect(trust).toBeGreaterThan(progress); // between progress and unit
    expect(trust).toBeLessThan(slot);
    // benefit bar: TrustBar preset items, below the unit
    const benefit = regionIdx(html, "benefit_bar");
    expect(benefit).toBeGreaterThan(slot);
    expect(html).toContain('<span class="lg-trustbar-text">No fees</span>');
  });

  it('disclosure per location: modal reuses the DisclosureLink panel markup; "footer" is inline text', () => {
    const modal = composed("centered", {
      disclosure: { enabled: true, location: "modal", text: "We are paid by partners." },
    });
    expect(modal).toContain("lg-frame-disclosure--modal");
    expect(modal).toContain('<div class="lg-disclosure-panel" hidden>We are paid by partners.</div>');

    const footer = composed("centered", {
      disclosure: { enabled: true, location: "footer", text: "Ad disclosure text" },
    });
    const footerIdx = regionIdx(footer, "footer");
    const discIdx = footer.indexOf('<div class="lg-frame-footer-disclosure" data-frame-region="disclosure">Ad disclosure text</div>');
    expect(discIdx).toBeGreaterThan(footerIdx); // inline text INSIDE the footer region

    const header = composed("centered", { disclosure: { enabled: true, location: "header" } });
    const headerIdx = regionIdx(header, "logo"); // centered stamps the band as logo
    const linkIdx = header.indexOf('<span class="lg-frame-header-disclosure" data-frame-region="disclosure">');
    expect(linkIdx).toBeGreaterThan(headerIdx);
    expect(header).toContain(">Advertising Disclosure</button>");
  });

  it("hostile operator copy is escaped everywhere (tagline / CTA label+href)", () => {
    const html = composed("header-footer", {
      header: {
        tagline: '<script>alert(1)</script>',
        cta: { enabled: true, label: 'Call <b>now</b>', href: "https://x.example/a?b=1&c=2" },
      },
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Call &lt;b&gt;now&lt;/b&gt;");
    expect(html).toContain('href="https://x.example/a?b=1&amp;c=2"');
  });
});

// ---------------------------------------------------------------------------
// 5. §10.2 logo ladder (incl. absent siteBranding) + footer site links
// ---------------------------------------------------------------------------

describe("frame-plus-unit-composition — §10.2 header-logo ladder + site footer links", () => {
  it('"site" with a site logo → the image mark with the site name as alt', () => {
    const html = composed("centered");
    expect(html).toContain('<img class="lg-logo-img" src="/media/site-logo.png" alt="Acme Insure"');
  });

  it('"site" without a logo → the site_name text mark (renderHeaderLogo text leg)', () => {
    const html = composed("centered", undefined, {
      siteBranding: { ...BRANDING, logo_url: null },
    });
    expect(html).not.toContain("lg-logo-img");
    expect(html).toContain(">Acme Insure</span>");
  });

  it('"site" with ABSENT siteBranding → the CMS fallback mark (§10.2 "site_branding may be absent")', () => {
    const html = composed("centered", undefined, { siteBranding: undefined });
    expect(html).toContain(`>${CMS_FALLBACK_LOGO_TEXT}</span>`);
    expect(html).not.toContain("lg-logo-img");
  });

  it('"cms_fallback" renders the CMS mark even when full branding exists', () => {
    const html = composed("centered", { header: { logo_source: "cms_fallback" } });
    expect(html).toContain(`>${CMS_FALLBACK_LOGO_TEXT}</span>`);
    expect(html).not.toContain("Acme Insure</span>");
  });

  it('"manual" renders the media logo through mediaUrl() and stamps data-logo-media-id', () => {
    const html = composed("centered", {
      header: { logo_source: "manual", logo_media_id: "logos/custom.png" },
    });
    expect(html).toContain('<img class="lg-logo-img" src="/media/logos/custom.png" alt="Acme Insure"');
    expect(html).toContain('data-logo-media-id="logos/custom.png"');
  });

  it('"manual" without a media id degrades down the site ladder (render-defensive)', () => {
    const html = composed("centered", { header: { logo_source: "manual" } });
    expect(html).toContain('<img class="lg-logo-img" src="/media/site-logo.png" alt="Acme Insure"');
  });

  it('footer links_source:"site" renders siteBranding.legal_links', () => {
    const html = composed("centered");
    expect(html.split('class="lg-footerbar-link"').length - 1).toBe(3);
    expect(html).toContain('<a class="lg-footerbar-link" href="/privacy-policy">Privacy policy</a>');
    expect(html).toContain('<a class="lg-footerbar-link" href="/contact">Contact</a>');
    expect(html).toContain('<a class="lg-footerbar-link" href="/terms">Terms of use</a>');
  });

  it("missing site legal links → the links group is OMITTED (never empty anchors)", () => {
    const empty = composed("centered", undefined, {
      siteBranding: { ...BRANDING, legal_links: [] },
    });
    expect(empty).not.toContain("lg-footerbar-link");
    expect(empty).not.toContain("lg-footerbar-links");
    const absent = composed("centered", undefined, { siteBranding: undefined });
    expect(absent).not.toContain("lg-footerbar-link");
  });

  it('links_source:"manual" renders the configured list instead of site links', () => {
    const html = composed("centered", {
      footer: { links_source: "manual", links: [{ label: "Imprint", href: "/imprint" }] },
    });
    expect(html).toContain('<a class="lg-footerbar-link" href="/imprint">Imprint</a>');
    expect(html).not.toContain(">Privacy policy</a>");
  });

  it("footer show_logo renders the site mark; absent branding falls to the CMS mark", () => {
    const withLogo = composed("centered", { footer: { show_logo: true } });
    expect(withLogo).toContain('<img class="lg-frame-footer-logo" src="/media/site-logo.png" alt="Acme Insure"');
    const noBranding = composed("centered", { footer: { show_logo: true } }, { siteBranding: undefined });
    expect(noBranding).toContain(`<span class="lg-frame-footer-logo-text">${CMS_FALLBACK_LOGO_TEXT}</span>`);
  });
});

// ---------------------------------------------------------------------------
// 6. chrome CSS — frame-region rules opt-in; legacy output byte-stable
// ---------------------------------------------------------------------------

describe("frame-plus-unit-composition — funnelChromeCss frame-region extension (13 §13.1)", () => {
  const cssDefault = funnelChromeCss(defaultFunnelDesign);
  const cssFrame = funnelChromeCss(defaultFunnelDesign, DEFAULT_FUNNEL_SCOPE, { frameRegions: true });

  it("without the opt the output is byte-identical (explicit false / empty opts / widened design)", () => {
    expect(funnelChromeCss(defaultFunnelDesign, DEFAULT_FUNNEL_SCOPE, {})).toBe(cssDefault);
    expect(funnelChromeCss(defaultFunnelDesign, DEFAULT_FUNNEL_SCOPE, { frameRegions: false })).toBe(cssDefault);
    // the resolveTokens() widened design (EffectiveTokens.design) is accepted
    // and — identity theme — yields the same bytes.
    expect(funnelChromeCss(TOKENS.design)).toBe(cssDefault);
    expect(cssDefault).not.toContain(".lg-frame-");
  });

  it("with frameRegions the base rules stay a byte-stable prefix and ONE @media block remains", () => {
    const baseOnly = cssDefault.split("\n@media")[0] ?? "";
    expect(baseOnly.length).toBeGreaterThan(1000);
    expect(cssFrame.startsWith(baseOnly)).toBe(true);
    expect(cssFrame.split("@media").length - 1).toBe(1);
  });

  it("frame-region rules are present and role-resolved from the design tokens (no raw values in markup)", () => {
    expect(cssFrame).toContain(".lg-frame-background.lg-frame-bg-role-brand_primary{background:#1B3A5C}");
    expect(cssFrame).toContain(".lg-frame-background.lg-frame-bg-role-page_background{background:#F5F7FA}");
    expect(cssFrame).toContain(".lg-frame-bg-style-brand_gradient");
    expect(cssFrame).toContain(".lg-frame-progress--no-label .lg-progress-text{display:none}");
    expect(cssFrame).toContain(".lg-frame-slot--card");
    expect(cssFrame).toContain(".lg-frame-footer--m-hide{display:none}");
    // the background markup itself carries CLASSES only — proven on a render:
    const html = composed("full-background");
    const bgTag = html.slice(html.indexOf('<div class="lg-frame-background'), html.indexOf('data-frame-region="background"'));
    expect(bgTag).not.toContain("style=");
    expect(bgTag).not.toContain("#");
  });
});
