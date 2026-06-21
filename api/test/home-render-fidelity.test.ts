// RESCUE-4 render-fidelity guards (live-defect regression).
//
// The pre-existing home/design tests asserted SECTION PRESENCE + order, so they
// stayed green while the rendered page was wrong end-to-end (the rescue-3
// failure mode). These tests assert the CORRECTED CONTENT the live site got
// wrong, each tied to a real screenshot defect:
//   D1 hero  — the §2 hero is the SITE IDENTITY (name + tagline + search), not
//              the lead article (which wrongly filled the hero on the live site).
//   D2 chips — when no category is flagged show_on_homepage, the §3 cat-rail is
//              derived from the published-article taxonomy (was empty live).
//   D3 imgs  — no /cdn-cgi/image transform is emitted (every one 404s on the
//              zone → broken images live); the bare /media/ src is used.
//   D4 footer— the §12 footer carries a description + populated link columns
//              (was just the brand name + copyright live).
//   D5 ads   — ad slots never force a fixed pixel width (970px overflowed 375px).

import { describe, it, expect } from "vitest";
import { renderHome } from "../src/public/templates/home";
import { buildHomeViewModel } from "../src/public/view-models/home";
import type {
  HomeArticleCard,
  HomeViewModel,
  HomeSiteContext,
} from "../src/public/view-models/home";

function card(slug: string, title: string, categoryName: string): HomeArticleCard {
  return {
    id: Math.abs(slug.split("").reduce((a, c) => a + c.charCodeAt(0), 0)),
    slug,
    title,
    excerpt: `Excerpt for ${title}.`,
    href: `/article/${slug}`,
    imageUrl: `/media/ai/site/${slug}.png`,
    imageAlt: `Image for ${title}`,
    publishedAt: "Jun 21, 2026",
    categoryName,
    categorySlug: categoryName.toLowerCase().replace(/\s+/g, "-"),
    readMinutes: 3,
  };
}

const HERO = card("top-story", "Top Story Headline", "Parenting Tips");

function makeVm(over: Partial<HomeViewModel> = {}): HomeViewModel {
  return {
    site: {
      site_id: "s1",
      name: "Playtrail",
      hostname: "playtrail.net",
      tagline: "Your playful path through parenthood",
      description: "A site about parenting.",
      logoUrl: "/media/logo-key.png",
      brandTokens: {},
    },
    hero: HERO,
    heroImageUrl: null,
    featured: [card("a2", "Second Feature", "Child Development"), card("a3", "Third Feature", "Family Activities")],
    picks: [HERO, card("a2", "Second Feature", "Child Development"), card("a4", "Pick Four", "Newborn & Baby Care")],
    trending: Array.from({ length: 5 }, (_, i) => card(`tr-${i + 1}`, `Trending ${i + 1}`, "Parenting Tips")),
    spotlight: Array.from({ length: 4 }, (_, i) => card(`sp-${i + 1}`, `Spotlight ${i + 1}`, "Child Development")),
    latest: Array.from({ length: 6 }, (_, i) => card(`la-${i + 1}`, `Latest ${i + 1}`, "Family Activities")),
    categories: [
      { id: 1, slug: "parenting-tips", name: "Parenting Tips", href: "/category/parenting-tips" },
      { id: 2, slug: "child-development", name: "Child Development", href: "/category/child-development" },
    ],
    newsletter: { heading: "Subscribe to the newsletter", description: "Get the latest stories in your inbox.", provider: null },
    meta: { title: "Playtrail", description: "A site about parenting.", canonicalUrl: "https://playtrail.net/" },
    ...over,
  };
}

function section(html: string, n: number): string {
  const start = html.indexOf(`<!-- home-section:${n} `);
  const end = html.indexOf(`<!-- home-section:${n + 1} `);
  expect(start, `section ${n} marker missing`).toBeGreaterThanOrEqual(0);
  return end > start ? html.slice(start, end) : html.slice(start);
}

describe("rescue-4 home render fidelity", () => {
  it("D1: the section-2 hero renders the SITE NAME + tagline + search, NOT the lead article", () => {
    const html = renderHome({ vm: makeVm() });
    const hero = section(html, 2);
    expect(hero).toContain("hero-title");
    expect(hero).toContain("Playtrail");
    expect(hero).toContain("Your playful path through parenthood");
    expect(hero).toContain("hero-search");
    expect(hero, "hero must not show the article title").not.toContain("Top Story Headline");
    expect(hero, "hero must not show an article kicker").not.toContain("hero-kicker");
    expect(section(html, 4)).toContain("Top Story Headline");
  });

  it("D3: no /cdn-cgi image transform is emitted anywhere (every one 404s on the zone)", () => {
    const html = renderHome({ vm: makeVm() });
    expect(html, "no /cdn-cgi/ transform may appear — they 404 and break images").not.toContain("/cdn-cgi/");
    expect(html).toContain('src="/media/ai/site/');
  });

  it("D4: the section-12 footer carries a description + populated Explore/Read/Follow columns", () => {
    const html = renderHome({ vm: makeVm() });
    const footer = section(html, 12);
    expect(footer).toContain("site-footer__description");
    expect(footer).toContain("Your playful path through parenthood");
    expect(footer).toContain("Explore");
    expect(footer).toContain("Read");
    expect(footer).toContain("Follow");
    expect(footer).toContain("site-footer__col");
    expect(footer).toContain('href="/#trending"');
    expect(footer).toContain('href="/feed.xml"');
  });

  it("D5: ad slots reserve height but never force a fixed pixel width (375px overflow)", () => {
    const html = renderHome({ vm: makeVm() });
    expect(html).toContain("max-width:970px;width:100%");
    expect(html, "leaderboard must not force a fixed 970px width on mobile").not.toContain("width:970px;min-width");
    expect(html, "no min-width may pin the slot wider than the viewport").not.toContain("min-width:970px");
  });
});

interface Row { [k: string]: unknown }
function fakeDb(articles: Row[], categoryRows: Row[], settings: Row[]): D1Database {
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first<T = unknown>(): Promise<T | null> { return null; },
        async all<T = unknown>() {
          if (sql.startsWith("SELECT a.id AS id, a.slug AS slug")) {
            const site = String(binds[0] ?? "");
            return { results: articles.filter((r) => r.site_id === site) as unknown as T[], success: true, meta: {} };
          }
          if (sql.startsWith("SELECT c.id AS id, c.slug AS slug, c.name AS name")) {
            return { results: categoryRows as unknown as T[], success: true, meta: {} };
          }
          if (sql.startsWith("SELECT key AS key, value AS value FROM site_settings")) {
            return { results: settings as unknown as T[], success: true, meta: {} };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() { return { success: true, meta: {} }; },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

describe("rescue-4 cat-rail fallback (view-model)", () => {
  it("D2: derives chips from published-article categories when none are flagged show_on_homepage", async () => {
    const articles: Row[] = [
      { id: 1, slug: "p1", title: "P1", content_html: "<p>x</p>", category_id: 1, status: "published", published_at: 1700000100, featured_image_id: null, is_featured: 1, is_trending: 0, homepage_rank: 1, site_id: "site_A", category_name: "Parenting Tips", category_slug: "parenting-tips", image_url: "ai/site/p1.png", image_alt: "P1" },
      { id: 2, slug: "p2", title: "P2", content_html: "<p>x</p>", category_id: 2, status: "published", published_at: 1700000090, featured_image_id: null, is_featured: 0, is_trending: 1, homepage_rank: null, site_id: "site_A", category_name: "Child Development", category_slug: "child-development", image_url: "ai/site/p2.png", image_alt: "P2" },
      { id: 3, slug: "p3", title: "P3", content_html: "<p>x</p>", category_id: 1, status: "published", published_at: 1700000080, featured_image_id: null, is_featured: 0, is_trending: 0, homepage_rank: null, site_id: "site_A", category_name: "Parenting Tips", category_slug: "parenting-tips", image_url: null, image_alt: null },
    ];
    const settings: Row[] = [{ key: "site_name", value: "Playtrail" }, { key: "tagline", value: "Your playful path" }];
    const ctx: HomeSiteContext = { siteId: "site_A", hostname: "playtrail.net" };

    const vm = await buildHomeViewModel(fakeDb(articles, [], settings), ctx);

    expect(vm.categories.length, "cat-rail must not be empty when articles have categories").toBeGreaterThanOrEqual(2);
    const names = vm.categories.map((c) => c.name);
    expect(names).toContain("Parenting Tips");
    expect(names).toContain("Child Development");
    expect(names.filter((n) => n === "Parenting Tips").length).toBe(1);

    const html = renderHome({ vm });
    expect(section(html, 3)).toContain("cat-chip");
  });
});
