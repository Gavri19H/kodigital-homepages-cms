// Backlog X14 (owner 2026-11-10): the public site header shows the site's
// uploaded logo (Settings → Logo) instead of the teal badge. The AI-made logo
// the setup step stores under ai/<site>/logo/ keeps the badge, and so does a
// site with no logo. The footer always keeps the badge (owner Q2).

import { describe, expect, it } from "vitest";
import { renderFooter, renderHeader, uploadedLogoUrl } from "../src/public/templates/components";
import { publicCss } from "../src/public/assets/public-css";

const UPLOADED = "/media/2026/08/18/21f37bf1-0700-45b1-a831-9553e44dfc5d.png";
const AI_SETUP = "/media/ai/st_9d91f95c66ed4df1/logo/st_9d91f95c66ed4df1.png";

function brandOf(header: string): string {
  const m = /<a class="brand"[^>]*>([\s\S]*?)<\/a>/.exec(header);
  expect(m, "the header has its brand link").not.toBeNull();
  return m![1] as string;
}

describe("X14 — the header shows the site's uploaded logo", () => {
  it("an uploaded logo: one picture, alt = site name, eager, fixed 200×36 box, resized versions at the edge", () => {
    const header = renderHeader({ site: { name: "moneylantern", logoUrl: UPLOADED, hostname: "moneylantern.com" } });
    expect(header).toContain('<a class="brand" href="/" aria-label="moneylantern home">');
    const brand = brandOf(header);
    expect(brand.match(/<img /g)).toHaveLength(1);
    expect(brand).toContain(`<img class="brand-logo-img" src="${UPLOADED}"`);
    expect(brand).toContain('alt="moneylantern"');
    expect(brand).toContain('width="200" height="36" loading="eager"');
    expect(brand).not.toContain("fetchpriority"); // reserved for the page's hero
    expect(brand).toContain('sizes="(max-width: 480px) 160px, 200px"');
    for (const w of [200, 320, 400]) {
      expect(brand).toContain(`/cdn-cgi/image/width=${w},quality=75,format=auto${UPLOADED} ${w}w`);
    }
    expect(brand).not.toContain('class="brand-logo"');
    expect(brand).not.toContain('class="brand-name"');
  });

  it("the AI-made logo from site setup keeps the badge and the name", () => {
    const brand = brandOf(renderHeader({ site: { name: "Thecontentandcareer", logoUrl: AI_SETUP } }));
    expect(brand).not.toContain("<img");
    expect(brand).toContain('<span class="brand-logo" aria-hidden="true"><svg class="brand-glyph"');
    expect(brand).toContain('<span class="brand-name">Thecontentandcareer</span>');
  });

  it("no logo, an empty one, or one from another address keeps the badge and the name", () => {
    for (const logoUrl of [null, undefined, "", "   ", "https://cdn.example.com/logo.png", "data:image/png;base64,AAAA"]) {
      const brand = brandOf(renderHeader({ site: { name: "insurissimo", logoUrl } }));
      expect(brand, String(logoUrl)).not.toContain("<img");
      expect(brand, String(logoUrl)).toContain('<span class="brand-name">insurissimo</span>');
    }
  });

  it("the site name is escaped in the alt text", () => {
    const brand = brandOf(renderHeader({ site: { name: 'A "B" <C>', logoUrl: UPLOADED } }));
    expect(brand).toContain('alt="A &quot;B&quot; &lt;C&gt;"');
    expect(brand).not.toContain("<C>");
  });

  it("the footer keeps the badge and the name even with an uploaded logo (owner Q2)", () => {
    const footer = renderFooter({ site: { name: "insurissimo", logoUrl: UPLOADED } });
    expect(footer).not.toContain("brand-logo-img");
    expect(footer).toContain('<span class="brand-logo" aria-hidden="true">');
  });

  it("uploadedLogoUrl: only same-origin /media/ logos that aren't the AI setup logo", () => {
    expect(uploadedLogoUrl({ name: "x", logoUrl: UPLOADED })).toBe(UPLOADED);
    expect(uploadedLogoUrl({ name: "x", logoUrl: ` ${UPLOADED} ` })).toBe(UPLOADED);
    expect(uploadedLogoUrl({ name: "x", logoUrl: AI_SETUP })).toBeNull();
    expect(uploadedLogoUrl({ name: "x", logoUrl: "/media/ai/st_1/feature_image/a.png" })).toBe("/media/ai/st_1/feature_image/a.png");
    expect(uploadedLogoUrl({ name: "x", logoUrl: "/uploads/logo.png" })).toBeNull();
    expect(uploadedLogoUrl({ name: "x" })).toBeNull();
  });

  it("the stylesheet fits the logo into its box: 200×36, 160×30 on a phone", () => {
    expect(publicCss).toMatch(/\.brand-logo-img \{\s*display: block; width: 200px; height: 36px;\s*object-fit: contain; object-position: left center;\s*\}/);
    expect(publicCss).toContain("@media (max-width:480px) { .brand-logo-img { width: 160px; height: 30px; } }");
  });
});
