import { describe, expect, it } from "vitest";
import { resolveSiteBranding, type SiteBranding } from "../src/leadgen/branding";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { renderComponent, renderSectionComponents } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign as design } from "../src/public/leadgen/designs/default-funnel/tokens";
import { LG_BANNERS_MOUNT_HTML, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import { effectiveFrame, type FrameConfig } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import { resolveRedirectLook } from "../src/public/leadgen/redirect/look";
import { renderRedirectMarkup } from "../src/public/leadgen/redirect/screen";
import { makeFakeDb } from "./helpers/admin-test-kit";
import { parseHtml } from "./helpers/mini-dom";

const key = "2026/11/24/0c7da386-a8a3-4b2c-aef2-28595ff055ed.png";
const media = `/media/${key}`;
const external = "https://partners.example/logo.png?brand=home&edition=2";
const alt = "Home & Auto";

function preset(type: LeadgenComponentNode["type"], props: Record<string, unknown>): string {
  return renderComponent({ type, question_id: "q_brand", props }, design);
}

function siteLogo(ref: string): SiteBranding {
  return { site_name: alt, logo_url: ref === key ? media : ref, legal_links: [], trust_logos: null, tagline: null };
}

function frame(config: FrameConfig, siteBranding?: SiteBranding): string {
  const resolved = effectiveFrame("header-footer", { header: { enabled: false }, footer: { enabled: false }, ...config });
  expect(resolved.problems).toEqual([]);
  return renderQuoteFrame({
    frame: resolved.frame, effectiveTokens: resolveTokens(design),
    siteBranding,
    sectionsHtml: '<section data-lg-section data-lg-index="0"></section>',
    bannersMountHtml: LG_BANNERS_MOUNT_HTML, sectionCount: 1,
    root: { funnelId: "lgf_home", funnelVariantId: "lgn_home", quoteId: "lgq_home", contentVersion: 1 },
  });
}

function onlyImage(html: string) {
  const images = parseHtml(html).querySelectorAll("img");
  expect(images).toHaveLength(1);
  return images[0]!;
}

function candidate(axis: "width" | "height", pixels: number): string {
  return `/cdn-cgi/image/${axis}=${pixels},fit=scale-down,format=auto,quality=75${media}`;
}

interface ImageCase {
  name: string;
  render: (ref: string) => string;
  box: [number, number];
  axis?: "width";
  // The standalone header token is 1.1rem (17.6 CSS pixels).
  transformSize?: number;
  loading: "eager" | "lazy";
  alt?: string;
  widths?: number[];
  sizes?: string;
}

const cases: ImageCase[] = [
  { name: "standalone header logo", render: (ref) => preset("HeaderLogo", { logoUrl: ref, siteName: alt }),
    box: [53, 18], transformSize: 17.6, loading: "eager" },
  { name: "section site logo", render: (ref) => preset("ImageBlock", { source: "auto_logo", logoUrl: ref, siteName: alt }),
    box: [53, 18], transformSize: 17.6, loading: "lazy" },
  { name: "header bar", render: (ref) => preset("HeaderBar", { logoMediaId: ref, logoAlt: alt }),
    box: [96, 32], loading: "eager" },
  { name: "section logo strip", render: (ref) => preset("LogoStrip", { logos: [{ mediaId: ref, alt }] }),
    box: [96, 32], loading: "lazy" },
  { name: "image answer card", render: (ref) => renderComponent({
    type: "ImageCardAnswerGrid", question_id: "q_home", internal_field: "home_type",
    choices: [{ label: "House", value: "house", analytics_id: "house", imageMediaId: ref, image_alt: alt }],
  }, design), box: [32, 32], loading: "lazy" },
  { name: "vehicle make card", render: (ref) => renderSectionComponents([{
    type: "IconCardAnswerGrid", question_id: "q_make", internal_field: "make",
    props: { choice_source: "vehicle", vehicle_asks: "make" },
  }], design, {
    headline_text: "Which make?", subheadline_text: null, first_page: true,
    vehicle: { snapshot: "2026-10-05", makes: [{ make_id: 448, name: "Toyota", slug: "toyota" }],
      logos: { toyota: ref === key ? media : ref }, default_featured: [448], sample: null },
  }), box: [80, 40], alt: "", loading: "eager" },
  { name: "section background", render: (ref) => preset("BackgroundPanel", { imageMediaId: ref }),
    box: [600, 338], axis: "width", widths: [320, 480, 600, 640, 768, 960, 1200],
    sizes: "(max-width: 600px) 100vw, 600px", alt: "", loading: "lazy" },
  { name: "viewport background", render: (ref) => frame({ background: { image_media_id: ref } }),
    box: [960, 540], axis: "width", widths: [320, 480, 640, 768, 960, 1200, 1600, 1920],
    sizes: "100vw", alt: "", loading: "eager" },
  { name: "footer site logo", render: (ref) => frame({ footer: { enabled: true, show_logo: true } }, siteLogo(ref)),
    box: [96, 32], loading: "lazy" },
  { name: "footer block logo", render: (ref) => frame({ footer: { enabled: true,
    blocks: [{ type: "logo", logo_source: "manual", logo_media_id: ref, logo_alt: alt }] } }),
    box: [96, 32], loading: "lazy" },
];

for (const [size, headerHeight, stripHeight, side] of [
  ["s", 24, 24, 96], ["m", 32, 32, 160], ["l", 44, 48, 240],
] as const) {
  cases.push(
    { name: `frame header ${size}`, render: (ref) => frame({ header: { enabled: true, logo_size: size } }, siteLogo(ref)),
      box: [headerHeight * 3, headerHeight], loading: "eager" },
    { name: `partner strip ${size}`, render: (ref) => frame({
      brand_logos: { enabled: true, layout: "grid", items: [{ media_id: ref, alt, size }] },
    }), box: [stripHeight * 3, stripHeight], loading: "lazy" },
    { name: `placed image ${size}`, render: (ref) => frame({ images: [{ id: "agent", slot: "above_section", media_id: ref, alt, size }] }),
      box: [side, side], axis: "width", loading: "lazy" },
  );
}

describe("quote images with a display box", () => {
  for (const item of cases) {
    for (const [origin, ref] of [["media", key], ["external", external]] as const) {
      it(`${item.name} with ${origin} input`, () => {
        const img = onlyImage(item.render(ref));
        const [width, height] = item.box;
        expect(img.getAttribute("width")).toBe(String(width));
        expect(img.getAttribute("height")).toBe(String(height));
        expect(img.getAttribute("alt")).toBe(item.alt ?? alt);
        expect(img.getAttribute("loading")).toBe(item.loading);
        if (origin === "external") {
          expect(img.getAttribute("src")).toBe(external);
          expect(img.getAttribute("srcset")).toBeNull();
          return;
        }
        const axis = item.axis ?? "height";
        const size = item.transformSize ?? (axis === "width" ? width : height);
        const twice = Math.round(size * 2);
        expect(img.getAttribute("src")).toBe(candidate(axis, twice));
        const candidates = item.widths
          ? item.widths.map((w) => `${candidate("width", w)} ${w}w`).join(", ")
          : `${candidate(axis, Math.round(size))} 1x, ${candidate(axis, twice)} 2x`;
        expect(img.getAttribute("srcset")).toBe(candidates);
        expect(img.getAttribute("sizes")).toBe(item.sizes ?? null);
      });
    }
  }
});

it("selects the configured mobile header height at the frame breakpoint", () => {
  const html = frame({ header: { enabled: true, logo_size: "s" }, mobile: { logo_size: "l" } }, siteLogo(media));
  const source = parseHtml(html).querySelector("picture source");
  expect(source?.getAttribute("media")).toBe("(max-width: 480px)");
  expect(source?.getAttribute("srcset")).toBe(`${candidate("height", 44)} 1x, ${candidate("height", 88)} 2x`);
  expect(source?.getAttribute("width")).toBe("132");
  expect(source?.getAttribute("height")).toBe("44");
  expect(onlyImage(html).getAttribute("src")).toBe(candidate("height", 48));
});

it("turns stored site and trust-logo keys into sized shell images with one shared header/footer rendition", async () => {
  const partnerKey = "2026/11/24/partner.png";
  const { db } = makeFakeDb([], [{ match: "FROM site_settings", rows: [
    { key: "site_name", value: alt }, { key: "logo_media_id", value: key },
    { key: "trust_logo_media_ids", value: JSON.stringify([partnerKey]) },
  ] }]);
  const branding = await resolveSiteBranding(db, "site-1");
  expect(branding.logo_url).toBe(media);
  expect(branding.trust_logos?.[0]?.url).toBe(`/media/${partnerKey}`);
  const doc = parseHtml(frame({
    header: { enabled: true, logo_size: "m" }, trust_strip: { enabled: true, source: "site_logo_set" },
    footer: { enabled: true, show_logo: true },
  }, branding));
  expect(doc.querySelectorAll("img")).toHaveLength(3);
  const header = doc.querySelector(".lg-logo-img")!;
  const footer = doc.querySelector(".lg-frame-footer-logo")!;
  expect(header.getAttribute("src")).toBe(candidate("height", 64));
  expect(footer.getAttribute("src")).toBe(header.getAttribute("src"));
  expect(footer.getAttribute("srcset")).toBe(header.getAttribute("srcset"));
  expect(doc.querySelector(".lg-logo-strip-img")?.getAttribute("src")).toBe(candidate("height", 64).replace(key, partnerKey));
  expect(doc.querySelector("[data-lg-banners]")?.querySelectorAll("img")).toHaveLength(0);
});

for (const ref of [key, external]) {
  it(`caps authored ImageBlock media without inventing intrinsic dimensions (${ref})`, () => {
    const img = onlyImage(preset("ImageBlock", { source: "media", logoMediaId: ref, alt }));
    expect(img.getAttribute("width")).toBeNull();
    expect(img.getAttribute("height")).toBeNull();
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("alt")).toBe(alt);
    expect(img.getAttribute("src")).toBe(ref === key ? candidate("width", 1280) : external);
    expect(img.getAttribute("srcset")).toBe(ref === key
      ? [640, 960, 1280].map((w) => `${candidate("width", w)} ${w}w`).join(", ") : null);
  });
}

for (const [display, size, width, height] of [
  ["banner", "s", 91, 22], ["banner", "m", 122, 32], ["banner", "l", 182, 52],
  ["animation", "s", 122, 32], ["animation", "m", 182, 52],
] as const) {
  it(`reserves the redirect logo in ${display} display at size ${size}`, () => {
    const html = renderRedirectMarkup({
      display, look: resolveRedirectLook({ animation: "logo_bar", animation_size: size }, design),
      seconds: 5, brand: alt, logo_url: external, slot: 1, brid: "banner-1", faid: "attempt-1",
      cards_html: '<a class="lg-banner" data-slot="1" href="/lg/lc/home?slot=1">View quote</a>',
      stay_mode: "none", stay_key: "",
    });
    const img = onlyImage(html);
    expect(img.getAttribute("src")).toBe(external);
    expect(img.getAttribute("srcset")).toBeNull();
    expect(img.getAttribute("alt")).toBe(alt);
    expect(img.getAttribute("width")).toBe(String(width));
    expect(img.getAttribute("height")).toBe(String(height));
    expect(img.getAttribute("loading")).toBe("eager");
  });
}
