// X14 plan v2 (owner, 22 Nov 2026): the site's tab icon on every public page
// family, the one logo rule, the footer logo, the 404 page, structured data
// and the logo as the fallback share picture.
import { describe, expect, it } from "vitest";
import {
  absoluteOnHost,
  siteBadgeIconSvg,
  siteBrandColor,
  siteFaviconUrl,
  siteIconHeadTags,
  siteIconHref,
  uploadedLogoUrl,
  DEFAULT_BRAND_COLOR,
} from "../src/public/site-brand";
import { renderLayout } from "../src/public/templates/layout";
import { renderErrorPage } from "../src/public/render-error";
import { resolveSiteBranding, LEADGEN_BRANDING_SETTINGS_KEYS } from "../src/leadgen/branding";

const UPLOADED = "/media/2026/08/18/21f37bf1-0700-45b1-a831-9553e44dfc5d.png";
const AI_SETUP = "/media/ai/st_9d91f95c66ed4df1/logo/st_9d91f95c66ed4df1.png";
const ICON_KEY = "2026/11/22/aaaa-bbbb.png";

describe("the one logo rule (owner Q4)", () => {
  it("uploaded /media/ logos and bare storage keys pass; the AI setup logo, outside addresses and placeholders don't", () => {
    expect(uploadedLogoUrl(UPLOADED)).toBe(UPLOADED);
    expect(uploadedLogoUrl("2026/08/18/x.png")).toBe("/media/2026/08/18/x.png");
    expect(uploadedLogoUrl(AI_SETUP)).toBeNull();
    expect(uploadedLogoUrl("ai/st_1/logo/st_1.png")).toBeNull();
    expect(uploadedLogoUrl("https://cdn.example/logo.png")).toBeNull();
    expect(uploadedLogoUrl("//evil.example/logo.png")).toBeNull();
    expect(uploadedLogoUrl("__pending__")).toBeNull();
    expect(uploadedLogoUrl("")).toBeNull();
    expect(uploadedLogoUrl(null)).toBeNull();
  });
});

describe("tab icon tags (Part A)", () => {
  it("an uploaded PNG icon: a 32 px tab icon and a 180 px phone icon, resized at the edge, plus the browser color", () => {
    const tags = siteIconHeadTags({ faviconUrl: siteFaviconUrl(ICON_KEY), brandColor: "#1ba8c8" });
    expect(tags).toContain(`<link rel="icon" type="image/png" sizes="32x32" href="/cdn-cgi/image/width=32,height=32,fit=contain,format=png/media/${ICON_KEY}">`);
    expect(tags).toContain(`<link rel="apple-touch-icon" sizes="180x180" href="/cdn-cgi/image/width=180,height=180,fit=contain,format=png/media/${ICON_KEY}">`);
    expect(tags).toContain('<meta name="theme-color" content="#1ba8c8">');
  });

  it("an SVG icon is linked as it is; no icon means the site's badge at /site-icon.svg (owner Q3)", () => {
    expect(siteIconHeadTags({ faviconUrl: "/media/2026/11/22/i.svg", brandColor: "#000" })).toContain(
      '<link rel="icon" type="image/svg+xml" href="/media/2026/11/22/i.svg">',
    );
    const none = siteIconHeadTags({ faviconUrl: null, brandColor: DEFAULT_BRAND_COLOR });
    expect(none).toContain('<link rel="icon" type="image/svg+xml" href="/site-icon.svg">');
    expect(none).not.toContain("apple-touch-icon");
    expect(siteIconHref(null, 32)).toBe("/site-icon.svg");
  });

  it("the brand color is the site's tw-brand token only when it is a plain hex color", () => {
    expect(siteBrandColor({ "tw-brand": "#0f8aa6" })).toBe("#0f8aa6");
    expect(siteBrandColor({ "tw-brand": "red;}</style><script>" })).toBe(DEFAULT_BRAND_COLOR);
    expect(siteBrandColor(undefined)).toBe(DEFAULT_BRAND_COLOR);
  });

  it("the badge icon is a stand-alone SVG: a rounded square in the brand color with the white glyph", () => {
    const svg = siteBadgeIconSvg({ brandColor: "#1ba8c8", name: "moneylantern", tagline: "budget tips" });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('<rect width="64" height="64" rx="14" fill="#1ba8c8"/>');
    expect(svg).toContain('<svg x="14" y="14"');
    expect(svg).toContain('color="#ffffff"');
  });

  it("the homepage-family layout carries the icon tags on every page", () => {
    const withIcon = renderLayout({
      site: { name: "moneylantern", hostname: "moneylantern.com", faviconUrl: siteFaviconUrl(ICON_KEY) },
      meta: { title: "t" },
      body: "",
    });
    expect(withIcon).toContain('<link rel="icon" type="image/png" sizes="32x32"');
    const withoutIcon = renderLayout({ site: { name: "x", hostname: "x.com" }, meta: { title: "t" }, body: "" });
    expect(withoutIcon).toContain('href="/site-icon.svg"');
    expect(withoutIcon).toContain('<meta name="theme-color" content="#1ba8c8">');
  });
});

describe("the logo as the fallback share picture (owner Q6)", () => {
  it("a page with no picture of its own shares the uploaded logo as a full address; its own picture wins; AI logos never", () => {
    const fallback = renderLayout({ site: { name: "m", hostname: "moneylantern.com", logoUrl: UPLOADED }, meta: { title: "t" }, body: "" });
    expect(fallback).toContain(`content="https://moneylantern.com${UPLOADED}"`);
    const own = renderLayout({
      site: { name: "m", hostname: "moneylantern.com", logoUrl: UPLOADED },
      meta: { title: "t", ogImage: "https://moneylantern.com/media/hero.png" },
      body: "",
    });
    expect(own).not.toContain(`https://moneylantern.com${UPLOADED}`);
    const ai = renderLayout({ site: { name: "m", hostname: "moneylantern.com", logoUrl: AI_SETUP }, meta: { title: "t" }, body: "" });
    expect(ai).not.toContain("og:image");
  });

  it("absoluteOnHost only builds addresses on a clean host from a same-origin path", () => {
    expect(absoluteOnHost("MoneyLantern.com", "/media/a.png")).toBe("https://moneylantern.com/media/a.png");
    expect(absoluteOnHost("evil.com/x", "/media/a.png")).toBeNull();
    expect(absoluteOnHost("moneylantern.com", "//evil.com/a.png")).toBeNull();
    expect(absoluteOnHost("moneylantern.com", null)).toBeNull();
  });
});

describe("404 and error pages show the site's own brand (Part B)", () => {
  it("with the site's settings: its name, its uploaded logo and its tab icon", () => {
    const html = renderErrorPage({
      hostname: "moneylantern.com",
      status: 404,
      siteName: "moneylantern",
      brand: { logoUrl: UPLOADED, faviconUrl: siteFaviconUrl(ICON_KEY), tagline: "t", brandTokens: {} },
    });
    expect(html).toContain('class="brand-logo-img"');
    expect(html).toContain('alt="moneylantern"');
    expect(html).toContain("Page not found — moneylantern");
    expect(html).toContain('sizes="32x32"');
  });

  it("without them (the site couldn't be read): today's page, badge and web address", () => {
    const html = renderErrorPage({ hostname: "moneylantern.com", status: 500 });
    expect(html).not.toContain("brand-logo-img");
    expect(html).toContain('<span class="brand-logo" aria-hidden="true">');
    expect(html).toContain("Something went wrong — moneylantern.com");
  });
});

// A tiny stand-in for the database: answers the two reads resolveSiteBranding makes.
function fakeDb(settings: Record<string, string>): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return {
            all: async () => ({ results: Object.entries(settings).map(([key, value]) => ({ key, value })) }),
            first: async () => (sql.includes("FROM sites") ? { name: "Site", domain: "site.com" } : null),
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe("LeadGen funnels follow the same rules", () => {
  it("an uploaded logo shows; the AI setup logo counts as none; the tab icon and brand color ride along", async () => {
    const uploaded = await resolveSiteBranding(fakeDb({ logo_media_id: "2026/08/18/x.png", favicon_media_id: ICON_KEY }), "st_1");
    expect(uploaded.logo_url).toBe("/media/2026/08/18/x.png");
    expect(uploaded.favicon_url).toBe(`/media/${ICON_KEY}`);
    expect(uploaded.brand_color).toBe(DEFAULT_BRAND_COLOR);
    const ai = await resolveSiteBranding(fakeDb({ logo_media_id: "ai/st_1/logo/st_1.png" }), "st_1");
    expect(ai.logo_url).toBeNull();
    expect(ai.favicon_url).toBeNull();
  });

  it("a tab-icon or brand-token change refreshes the cached funnel page", () => {
    expect(LEADGEN_BRANDING_SETTINGS_KEYS.has("favicon_media_id")).toBe(true);
    expect(LEADGEN_BRANDING_SETTINGS_KEYS.has("brand_tokens_json")).toBe(true);
  });
});
