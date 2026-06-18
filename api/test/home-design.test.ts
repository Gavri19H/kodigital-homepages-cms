// T19 — Homepage renders the full 13-section theiwise design.
//
// AC1 (RC-034): the rendered home document carries the 13 contract section
// classes IN the exact contract §7 order, the design-export screen label
// `data-screen-label=theiwise-home`, and the inline `--tw-brand` token; and it
// carries NO bare-fallback wrapper / no 'about' section (html_negative_marker).
//
// AC2 (RC-035): each design contract §12 data bucket populates its section —
// featured[3, first=hero], editorsPicks{hero, thumbs[3]}, trending[5],
// spotlight[4], latest[6].
//
// These are render-output behavioural assertions against renderHome /
// renderLayout (no DB, no network) — the same pure-transform pattern the rest
// of the public-template suite uses.
//
// parse_test_output route (required_evidence_plan RC-034/RC-035): the runner
// aliases parse_test_output → vitest_text and binds a PASSING test whose
// verbose-reporter name matches expected_test_name_regex
// `api/test/home-design.test.ts`. Each it() title embeds that file-path literal
// plus the L2_AUTO_DISAMBIGUATION:T19-AC<n>:RC-<nnn> disambiguation tag.

import { describe, it, expect } from "vitest";
import { renderHome } from "../src/public/templates/home";
import { renderLayout } from "../src/public/templates/layout";
import type { HomeArticleCard, HomeViewModel } from "../src/public/view-models/home";

function card(over: Partial<HomeArticleCard> & { slug: string }): HomeArticleCard {
  return {
    id: over.id ?? 0,
    slug: over.slug,
    title: over.title ?? over.slug,
    excerpt: over.excerpt ?? `Excerpt for ${over.slug}`,
    href: over.href ?? `/article/${over.slug}`,
    imageUrl: over.imageUrl ?? `/media/${over.slug}.jpg`,
    imageAlt: over.imageAlt ?? over.slug,
    publishedAt: over.publishedAt ?? "2026-06-01T00:00:00.000Z",
    categoryName: over.categoryName ?? "Tech",
    categorySlug: over.categorySlug ?? "tech",
    readMinutes: over.readMinutes ?? 4,
  };
}

const HERO = card({ slug: "hero-lead", title: "Hero Lead", categoryName: "World", categorySlug: "world" });
const FEATURED = [
  card({ slug: "feat-1", title: "Feature One" }),
  card({ slug: "feat-2", title: "Feature Two" }),
  card({ slug: "feat-3", title: "Feature Three" }),
];
const TRENDING = Array.from({ length: 5 }, (_, i) =>
  card({ slug: `trend-${i + 1}`, title: `Trending ${i + 1}` }),
);
const SPOTLIGHT = Array.from({ length: 4 }, (_, i) =>
  card({ slug: `spot-${i + 1}`, title: `Spotlight ${i + 1}`, categoryName: "Culture", categorySlug: "culture" }),
);
const LATEST = Array.from({ length: 6 }, (_, i) =>
  card({ slug: `late-${i + 1}`, title: `Latest ${i + 1}` }),
);

function makeVm(over: Partial<HomeViewModel> = {}): HomeViewModel {
  return {
    site: {
      site_id: "s1",
      name: "Acme Daily",
      hostname: "acme.example",
      tagline: "All the news",
      description: "Acme Daily covers technology.",
      logoUrl: null,
      brandTokens: { "tw-brand": "#0f8aa6" },
    },
    hero: HERO,
    featured: FEATURED,
    picks: [],
    trending: TRENDING,
    spotlight: SPOTLIGHT,
    latest: LATEST,
    categories: [
      { id: 1, slug: "world", name: "World", href: "/category/world" },
      { id: 2, slug: "tech", name: "Tech", href: "/category/tech" },
      { id: 3, slug: "culture", name: "Culture", href: "/category/culture" },
    ],
    newsletter: { heading: "Subscribe", description: "In your inbox", provider: "buttondown" },
    meta: { title: "Acme Daily", description: "Acme Daily covers technology.", canonicalUrl: "https://acme.example/" },
    ...over,
  };
}

function renderDoc(v: HomeViewModel): string {
  return renderLayout({
    site: {
      name: v.site.name,
      hostname: v.site.hostname,
      tagline: v.site.tagline,
      description: v.site.description,
      brandTokens: v.site.brandTokens,
      logoUrl: v.site.logoUrl,
    },
    meta: { title: v.meta.title, description: v.meta.description, canonicalUrl: v.meta.canonicalUrl },
    body: renderHome({ vm: v }),
  });
}

// Slice the rendered home between the §N and §N+1 section markers so each
// bucket assertion is scoped to its own section.
function sectionSlice(html: string, n: number): string {
  const start = html.indexOf(`<!-- home-section:${n} `);
  expect(start, `section ${n} marker present`).toBeGreaterThan(-1);
  const end = n < 13 ? html.indexOf(`<!-- home-section:${n + 1} `) : html.length;
  expect(end, `section ${n} bounded by next marker`).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe("home-design (T19)", () => {
  it("T19-AC1 render-output: home document emits the 13 contract section classes in §7 order + data-screen-label + inline --tw-brand, no bare/about negative markers [api/test/home-design.test.ts] L2_AUTO_DISAMBIGUATION:T19-AC1:RC-034", () => {
    const doc = renderDoc(makeVm());

    // The 13 contract section root selectors, in the exact docs/design-contract
    // §7 order (§8 spotlight contributes both `section--soft` and `grid-4`).
    const orderedSelectors = [
      'class="site-header"', // §1
      'class="hero"', // §2
      'class="cat-rail"', // §3
      'class="featured"', // §4
      "ad-slot--leaderboard", // §5
      'class="picks-grid"', // §6
      "trending-section", // §7
      "section--soft", // §8 root
      "grid-4", // §8 grid
      "ad-slot--in-feed", // §9
      "grid-3", // §10
      'class="newsletter"', // §11
      'class="site-footer"', // §12
      'class="floating-next"', // §13
    ];
    let prev = -1;
    for (const sel of orderedSelectors) {
      const idx = doc.indexOf(sel);
      expect(idx, `selector ${sel} present`).toBeGreaterThan(-1);
      expect(idx, `selector ${sel} after previous (${prev})`).toBeGreaterThan(prev);
      prev = idx;
    }

    // Design-export screen label + not-the-bare-fallback wrapper (rescue-2
    // served a bare <body><div> with no design shell; the design body roots in
    // data-screen-label=theiwise-home inside <main>).
    expect(doc).toContain("data-screen-label=theiwise-home");
    expect(doc).toContain('<main id="main-content"><div data-screen-label=theiwise-home>');

    // Inline brand token surfaced from brand_tokens_json (renderLayout).
    expect(doc).toContain("--tw-brand: #0f8aa6;");

    // html_negative_marker: the home page has NO 'about' section (contract §7).
    expect(doc).not.toMatch(/home-section:\d+ about/);
    expect(doc).not.toContain("home-about");
  });

  it("T19-AC2 render-output: each design §12 bucket populates its section — featured[3,first=hero], editorsPicks{hero,thumbs[3]}, trending[5], spotlight[4], latest[6] [api/test/home-design.test.ts] L2_AUTO_DISAMBIGUATION:T19-AC2:RC-035", () => {
    const html = renderHome({ vm: makeVm() });

    // §4 featured: 3 cards, first = hero.
    const s4 = sectionSlice(html, 4);
    expect(s4).toContain('href="/article/hero-lead"');
    expect(s4).toContain('href="/article/feat-1"');
    expect(s4).toContain('href="/article/feat-2"');
    expect(s4.indexOf("/article/hero-lead")).toBeLessThan(s4.indexOf("/article/feat-1"));
    // featured[3] — feat-3 rolls into editor's picks, not the 3-card grid.
    expect(s4).not.toContain('href="/article/feat-3"');

    // §6 editor's picks: hero + thumbs[3] = 4 cards (.picks-hero + 3 .story-row).
    const s6 = sectionSlice(html, 6);
    for (const slug of ["hero-lead", "feat-1", "feat-2", "feat-3"]) {
      expect(s6).toContain(`href="/article/${slug}"`);
    }
    expect(s6).toContain('class="picks-hero"');
    expect((s6.match(/class="story-row"/g) ?? []).length).toBe(3);

    // §7 trending: 5 items.
    const s7 = sectionSlice(html, 7);
    for (let i = 1; i <= 5; i++) expect(s7).toContain(`href="/article/trend-${i}"`);

    // §8 spotlight: 4 cards in a soft-bg .grid.grid-4.
    const s8 = sectionSlice(html, 8);
    expect(s8).toContain('class="grid grid-4"');
    for (let i = 1; i <= 4; i++) expect(s8).toContain(`href="/article/spot-${i}"`);

    // §10 latest: the full bucket renders (6 here), one .home-grid__item per card.
    const s10 = sectionSlice(html, 10);
    for (let i = 1; i <= 6; i++) expect(s10).toContain(`href="/article/late-${i}"`);
    expect((s10.match(/class="home-grid__item"/g) ?? []).length).toBe(6);
  });
});
