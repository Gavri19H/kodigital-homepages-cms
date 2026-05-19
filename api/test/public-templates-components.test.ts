// Phase 5 / T4 BEHAVIORAL guard for renderChipRail.
// AC: GIVEN CategoryChip slug=tech WHEN renderChipRail THEN result contains
// href=/category/tech AND no href="#".
// PART 8 RED LINE: chip rail (and every public link) must use real URLs;
// placeholder href="#" is forbidden in any rendered Home/Article output.

import { describe, it, expect } from "vitest";
import {
  renderChipRail,
  renderAdSlot,
  renderHeader,
  renderFooter,
  renderNewsletter,
  renderHero,
  renderCard,
  renderFloatingNext,
  type CategoryChip,
} from "../src/public/templates/components";

describe("public-templates-components", () => {
  it("chip-rail emits /category/<slug> hrefs and never href=\"#\"", () => {
    const chips: CategoryChip[] = [
      { slug: "tech", name: "Tech" },
      { slug: "ai", name: "AI" },
      { slug: "world", name: "World" },
    ];
    const html = renderChipRail({ chips });

    expect(html).toContain('href="/category/tech"');
    expect(html).toContain('href="/category/ai"');
    expect(html).toContain('href="/category/world"');
    expect(html).toContain(">Tech<");
    expect(html).toContain(">AI<");
    expect(html).not.toContain('href="#"');
    expect(html).toMatch(/<nav class="chip-rail"/);
  });

  it("chip-rail empty list renders empty string (no rail markup)", () => {
    const html = renderChipRail({ chips: [] });
    expect(html).toBe("");
  });

  it("chip-rail respects caller-provided href when supplied", () => {
    const chips: CategoryChip[] = [
      { slug: "tech", name: "Tech", href: "/topics/technology" },
    ];
    const html = renderChipRail({ chips });
    expect(html).toContain('href="/topics/technology"');
    expect(html).not.toContain('href="/category/tech"');
    expect(html).not.toContain('href="#"');
  });

  it("renderAdSlot emits data-ad-slot + data-ad-type attributes", () => {
    const html = renderAdSlot({ type: "leaderboard", slotId: "home-top", surface: "home" });
    expect(html).toContain('data-ad-slot="home-top"');
    expect(html).toContain('data-ad-type="leaderboard"');
    expect(html).toContain('data-ad-surface="home"');
  });

  it("renderHeader sources brand name from site.name (no hardcoded brand)", () => {
    const html = renderHeader({ site: { name: "Acme Daily", hostname: "acme.example" } });
    expect(html).toContain("Acme Daily");
    expect(html).not.toMatch(/theiwise/i);
    expect(html).not.toContain("cms.kodigital.app");
    expect(html).not.toContain('href="#"');
  });

  it("renderFooter sources brand from site.name and respects copyrightYear", () => {
    const html = renderFooter({
      site: { name: "Acme Daily", hostname: "acme.example" },
      copyrightYear: 2026,
      legalLinks: [{ label: "Privacy", href: "/page/privacy-policy" }],
    });
    expect(html).toContain("Acme Daily");
    expect(html).toContain("2026");
    expect(html).toContain('href="/page/privacy-policy"');
    expect(html).not.toContain('href="#"');
  });

  it("renderNewsletter is disabled when no provider configured", () => {
    const html = renderNewsletter({ heading: "Stay in the loop", provider: null });
    expect(html).toContain("Stay in the loop");
    expect(html).toContain("disabled");
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain("newsletter__notice");
    expect(html).not.toContain('href="#"');
  });

  it("renderNewsletter is enabled when a provider is configured", () => {
    const html = renderNewsletter({ heading: "Subscribe", provider: "buttondown" });
    expect(html).not.toContain("disabled");
    expect(html).not.toContain("newsletter__notice");
  });

  it("renderHero links the title when href is supplied and no href=\"#\"", () => {
    const html = renderHero({
      title: "Big Story",
      excerpt: "Lede sentence.",
      href: "/article/big-story",
      kicker: "Featured",
    });
    expect(html).toContain('href="/article/big-story"');
    expect(html).toContain("Big Story");
    expect(html).toContain("Featured");
    expect(html).not.toContain('href="#"');
  });

  it("renderCard renders article link + image with lazy loading", () => {
    const html = renderCard({
      href: "/article/example",
      title: "Example",
      excerpt: "Short summary.",
      imageUrl: "/media/example.jpg",
      imageAlt: "Example image",
      publishedAt: "May 19, 2026",
      readMinutes: 4,
      categoryName: "World",
    });
    expect(html).toContain('href="/article/example"');
    expect(html).toContain('src="/media/example.jpg"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("Example image");
    expect(html).toContain("4 min read");
    expect(html).not.toContain('href="#"');
  });

  it("renderFloatingNext composes a real article href (PART 4 >=1280px)", () => {
    const html = renderFloatingNext({
      href: "/article/next-up",
      label: "Up next",
      imageUrl: "/media/next.jpg",
      imageAlt: "",
    });
    expect(html).toContain('href="/article/next-up"');
    expect(html).toContain("Up next");
    expect(html).toContain("floating-next");
    expect(html).not.toContain('href="#"');
  });
});
