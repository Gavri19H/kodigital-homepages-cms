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
import { publicCss } from "../src/public/assets/public-css";
import { renderPageHtml, renderCategoryHtml } from "../src/public/render-pages";
import type { PublicSiteContext } from "../src/public/middleware";
import type { PublicPageRow, PublicCategoryRow } from "../src/public/queries";
import type { ArticleRow } from "../src/db";

// T3 (rescue-3) render-output (T3-AC3) fixture: a D1 stub whose site_settings
// SELECT returns the seeded brand rows so renderPageHtml composes the design
// shell (renderLayout + renderHeader/renderFooter) rather than the bare
// document. `.all()` is the only path fetchPublicLayoutSiteInfo exercises.
function makeSettingsDb(
  rows: ReadonlyArray<{ key: string; value: string | null }>,
): D1Database {
  return {
    prepare() {
      const stmt = {
        bind() {
          return stmt;
        },
        async all<T = unknown>() {
          return { results: rows as unknown as T[], success: true, meta: {} };
        },
        async first<T = unknown>(): Promise<T | null> {
          return null;
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

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
    // Contract §10 ChipRail vocabulary: cat-rail root, cat-chip links.
    expect(html).toMatch(/<nav class="cat-rail"/);
    expect(html).toContain('class="cat-chip"');
    expect(html).toContain('class="cat-chip-label"');
  });

  it("chip-rail empty list renders empty string (no rail markup)", () => {
    const html = renderChipRail({ chips: [] });
    expect(html).toBe("");
  });

  it("T4.AC3: chip-rail respects caller-provided href when supplied", () => {
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

  it("renderHero renders the site-identity title + tagline (design: no title link, no kicker), no href=\"#\"", () => {
    // RESCUE-4 design: the hero is the SITE IDENTITY — the title is plain text
    // (with a trailing period per the design `{heroTitle}.`), NOT a link, and
    // there is no kicker. The hero-search form is the only interactive element.
    const html = renderHero({
      title: "Big Story",
      excerpt: "Lede sentence.",
    });
    expect(html).toContain("Big Story.");
    expect(html).toContain('<span class="tagline">Lede sentence.</span>');
    expect(html).toContain('class="hero-search"');
    expect(html).not.toContain("hero-kicker");
    expect(html).not.toContain('href="#"');
  });

  it("renderCard renders the design card — a.card link + img + categoryName · publishedAt byline (lazy)", () => {
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
    expect(html).toContain('<a class="card" href="/article/example"');
    expect(html).toContain('src="/media/example.jpg"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("Example image");
    // RESCUE-4 design card-foot byline = "{categoryName} · {publishedAt}"
    // (the Spotlight/Latest cards use exactly this — no "min read").
    expect(html).toContain('<span class="card-byline">World · May 19, 2026</span>');
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

  it("T6.AC3: publicCss carries the 5 reference brand tokens (no legacy blue)", () => {
    expect(publicCss).toContain("--tw-brand: #1ba8c8");
    expect(publicCss).toContain("--tw-brand-deep: #0f8aa6");
    expect(publicCss).toContain("--tw-brand-soft: #d6eef5");
    expect(publicCss).toContain("--tw-brand-tint: #f0f9fc");
    expect(publicCss).toContain("--tw-accent: #f0a830");
    expect(publicCss).not.toContain("#2563eb");
  });

  it("T14.AC2: renderHeader emits brand → search → nav in contract order with pinned labels and btn-outline Sign in", () => {
    const html = renderHeader({ site: { name: "Acme Daily", hostname: "acme.example" } });

    // child order pinned by design-contract §11
    const brandAt = html.indexOf('class="brand"');
    const searchAt = html.indexOf('class="header-search"');
    const navAt = html.indexOf('class="header-nav"');
    expect(brandAt).toBeGreaterThan(-1);
    expect(searchAt).toBeGreaterThan(brandAt);
    expect(navAt).toBeGreaterThan(searchAt);

    // nav labels in contract order, then the Sign in outline button
    const exploreAt = html.indexOf(">Explore");
    const trendingAt = html.indexOf(">Trending<");
    const picksAt = html.indexOf(">Editor's Picks<");
    const newsletterAt = html.indexOf(">Newsletter<");
    const signInAt = html.indexOf(">Sign in<");
    expect(exploreAt).toBeGreaterThan(navAt);
    expect(trendingAt).toBeGreaterThan(exploreAt);
    expect(picksAt).toBeGreaterThan(trendingAt);
    expect(newsletterAt).toBeGreaterThan(picksAt);
    expect(signInAt).toBeGreaterThan(newsletterAt);

    // Sign in is the .btn-outline; Explore carries the chevron glyph. RESCUE-4
    // design: each nav label is wrapped in <span class="label"> (so the 880px
    // breakpoint can hide the text), and the chevron follows the Explore label.
    expect(html).toMatch(/<button class="btn-outline" type="button">Sign in<\/button>/);
    expect(html).toMatch(/>Explore<\/span><svg class="nav-chevron"/);
    // every nav link is a real URL (PART 8)
    expect(html).not.toContain('href="#"');
  });

  it("T14: renderHero emits the §11 exact DOM — hero-bg + hero-content > h1 > span.tagline + form.hero-search", () => {
    const html = renderHero({
      title: "Big Story",
      excerpt: "Lede sentence.",
      imageUrl: "/media/hero.jpg",
      imageAlt: "Hero image",
    });

    // .hero-bg immediately precedes .hero-content inside .hero
    const bgAt = html.indexOf('<div class="hero-bg"');
    const contentAt = html.indexOf('<div class="hero-content">');
    expect(bgAt).toBeGreaterThan(-1);
    expect(contentAt).toBeGreaterThan(bgAt);

    // RESCUE-4 design: .hero-bg is a div (no <img>); a set imageUrl paints it
    // via an inline background-image (the gradient is the CSS default otherwise).
    expect(html).toContain('background-image:url(/media/hero.jpg)');
    expect(html.slice(bgAt, contentAt)).not.toContain("<img");

    // tagline is a SPAN inside the h1.hero-title, after the title + literal
    // period (design `{heroTitle}.`).
    expect(html).toMatch(
      /<h1 class="hero-title">Big Story\.<span class="tagline">Lede sentence\.<\/span><\/h1>/,
    );
    // search form lives inside hero-content with a submit button
    expect(html).toContain('<form class="hero-search" role="search"');
    expect(html.indexOf('<form class="hero-search"')).toBeGreaterThan(contentAt);
    expect(html).not.toContain('href="#"');
  });

  it("T14.AC1/AC3: publicCss pins hero min-height clamp and container padding clamp", () => {
    expect(publicCss).toContain("min-height: clamp(340px, 42vw, 480px)");
    expect(publicCss).toContain("padding: 0 clamp(16px, 3vw, 32px)");
  });

  it("T3.AC3: renderPageHtml wraps page content in renderLayout — links /assets/public.css and carries the site-header + site-footer regions, not the bare fallback [api/test/public-templates-components.test.ts]", async () => {
    const RAW_PAGE_BODY = "<p>about-body must-be-wrapped-in-shell</p>";
    const siteContext = {
      siteId: "site_T3",
      hostname: "tenant.example.com",
    } as unknown as PublicSiteContext;
    const row = {
      id: 1,
      slug: "about",
      title: "About Us",
      content_html: RAW_PAGE_BODY,
      status: "published",
      updated_at: 1_700_000_500,
      site_id: "site_T3",
    } as unknown as PublicPageRow;
    const db = makeSettingsDb([
      { key: "site_name", value: "Acme Daily" },
      { key: "brand_tokens_json", value: '{"tw-brand":"#0f8aa6"}' },
    ]);

    const html = await renderPageHtml(db, siteContext, row, "/page/about");

    // Design shell, not the bare document.
    expect(html.trim().toLowerCase().startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toBe(RAW_PAGE_BODY);
    // renderLayout owns the stylesheet + brand-token override (db-fed shell).
    expect(html).toContain('href="/assets/public.css?v=');
    expect(html).toContain('<style data-source="brand_tokens">');
    expect(html).toContain("--tw-brand: #0f8aa6");
    // Header + footer regions present (banner + contentinfo).
    expect(html).toContain('class="site-header"');
    expect(html).toContain('role="banner"');
    expect(html).toContain('class="site-footer"');
    expect(html).toContain('role="contentinfo"');
    // Brand name resolved from site_settings, surfaced in the header.
    expect(html).toContain("Acme Daily");
    // Page content is composed inside the shell.
    expect(html).toContain(RAW_PAGE_BODY);
    expect(html).toContain('class="page-title"');
    // WebPage JSON-LD rides the head exactly once (no double-wrapped script).
    expect(html).toContain('"@type": "WebPage"');
    expect(html).not.toContain(
      '<script type="application/ld+json"><script type="application/ld+json">',
    );
    // Tenant-boundary RED LINE: admin host never appears.
    expect(html).not.toContain("cms.kodigital.app");
  });

  it("T4.AC3: renderCategoryHtml wraps the listing in renderLayout with styled article cards — links /assets/public.css, carries the site-header + site-footer regions and the .card / home-grid markup, not the bare zero-style list [api/test/public-templates-components.test.ts]", async () => {
    const siteContext = {
      siteId: "site_T4",
      hostname: "tenant.example.com",
    } as unknown as PublicSiteContext;
    const cat: PublicCategoryRow = { id: 7, slug: "wellness", name: "Wellness" };
    const articles = [
      {
        id: 201,
        slug: "sleep-better",
        title: "Sleep Better Tonight",
        content_json: "{}",
        content_html: "<p>Tips for restful sleep tonight.</p>",
        category_id: 7,
        status: "published",
        published_at: 1_700_000_900,
        scheduled_at: null,
        author_name: "Wellness Desk",
        featured_image_id: null,
        is_featured: 0,
        is_trending: 0,
        created_at: 1_699_000_000,
        updated_at: 1_700_000_950,
        site_id: "site_T4",
      },
    ] as unknown as ArticleRow[];
    const db = makeSettingsDb([
      { key: "site_name", value: "Acme Daily" },
      { key: "brand_tokens_json", value: '{"tw-brand":"#0f8aa6"}' },
    ]);

    const html = await renderCategoryHtml(
      db,
      siteContext,
      cat,
      articles,
      1,
      "wellness",
    );

    // Design shell, not the rescue-2 bare zero-style document.
    expect(html.trim().toLowerCase().startsWith("<!doctype html>")).toBe(true);
    // renderLayout owns the stylesheet + brand-token override (db-fed shell).
    expect(html).toContain('href="/assets/public.css?v=');
    expect(html).toContain('<style data-source="brand_tokens">');
    expect(html).toContain("--tw-brand: #0f8aa6");
    // Header + footer regions present (banner + contentinfo).
    expect(html).toContain('class="site-header"');
    expect(html).toContain('role="banner"');
    expect(html).toContain('class="site-footer"');
    expect(html).toContain('role="contentinfo"');
    // Brand name resolved from site_settings, surfaced in the header.
    expect(html).toContain("Acme Daily");
    // Styled article cards (renderCard → <a class="card">) inside the
    // home-grid listing — NOT the rescue-2 bare flat <a> list. RESCUE-4 design:
    // the whole card IS the anchor (a.card), not <article><a>.
    expect(html).toContain('<ul class="home-grid home-grid--category">');
    expect(html).toContain('<a class="card"');
    expect(html).toContain('class="card-title"');
    expect(html).toContain('href="/article/sleep-better"');
    expect(html).toContain("Sleep Better Tonight");
    // The category name renders as the section <h1>.
    expect(html).toContain('class="category-title"');
    expect(html).toContain("Wellness");
    // CollectionPage + root-first BreadcrumbList JSON-LD ride the head once.
    expect(html).toContain('"@type": "CollectionPage"');
    expect(html).toContain('"@type": "BreadcrumbList"');
    expect(html).not.toContain(
      '<script type="application/ld+json"><script type="application/ld+json">',
    );
    // GEO §1: no FAQPage on a category route.
    expect(html).not.toContain("FAQPage");
    // Tenant-boundary RED LINE: admin host never appears.
    expect(html).not.toContain("cms.kodigital.app");
  });
});
