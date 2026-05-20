// Phase 5 / T10 BEHAVIORAL guards for renderHome.
//
// T10.AC2 (section-order): the 13 home-section markers appear in the
// rendered output in numerical PART 1 order — 1,2,…,13 — and each marker
// appears exactly once. The test name MUST match
// `^public-templates-home.*section[_-]?order` per the implementation
// digest's RC-031 binding.
//
// T10.AC3 (brand-from-site): every visible brand string flows from
// vm.site.name (and the per-card payload). Hard-coded vertical brand
// tokens (TheIWise / theiwise / cms.kodigital.app) MUST NOT appear in
// the rendered body. The test name MUST match
// `^public-templates-home.*brand[_-]?from[_-]?site` per the digest's
// RC-032 binding.
//
// PART 8 RED LINE: rendered output never contains href="#".

import { describe, it, expect } from "vitest";
import { renderHome } from "../src/public/templates/home";
import type {
  HomeViewModel,
  HomeArticleCard,
} from "../src/public/view-models/home";

function makeCard(overrides: Partial<HomeArticleCard> = {}): HomeArticleCard {
  return {
    id: 1,
    slug: "story-one",
    title: "Story one",
    excerpt: "Lede sentence for story one.",
    href: "/article/story-one",
    imageUrl: "/media/story-one.jpg",
    imageAlt: "Story one image",
    publishedAt: "2026-05-18T10:00:00.000Z",
    categoryName: "Tech",
    categorySlug: "tech",
    readMinutes: 4,
    ...overrides,
  };
}

function makeVm(overrides: Partial<HomeViewModel> = {}): HomeViewModel {
  const hero = makeCard({ id: 100, slug: "hero", title: "Hero story", href: "/article/hero" });
  const featured = [
    makeCard({ id: 1, slug: "f1", title: "Featured one", href: "/article/f1" }),
    makeCard({ id: 2, slug: "f2", title: "Featured two", href: "/article/f2" }),
    makeCard({ id: 3, slug: "f3", title: "Featured three", href: "/article/f3" }),
  ];
  const latest = Array.from({ length: 8 }).map((_, i) =>
    makeCard({ id: 10 + i, slug: `l${i + 1}`, title: `Latest ${i + 1}`, href: `/article/l${i + 1}` }),
  );
  return {
    site: {
      site_id: "site-acme",
      name: "Acme Daily",
      hostname: "acme.example",
      tagline: "Tomorrow's news today",
      description: "Acme Daily covers technology, world, and culture.",
      logoUrl: null,
      brandTokens: {},
    },
    hero,
    featured,
    latest,
    categories: [
      { id: 1, slug: "tech", name: "Tech", href: "/category/tech" },
      { id: 2, slug: "world", name: "World", href: "/category/world" },
      { id: 3, slug: "culture", name: "Culture", href: "/category/culture" },
    ],
    newsletter: {
      heading: "Acme Daily newsletter",
      description: "Get the brief in your inbox.",
      provider: "buttondown",
    },
    meta: {
      title: "Acme Daily — Tomorrow's news today",
      description: "Acme Daily covers technology, world, and culture.",
      canonicalUrl: "https://acme.example/",
    },
    ...overrides,
  };
}

function extractMarkerSequence(html: string): number[] {
  const re = /home-section:(\d+)/g;
  const out: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    out.push(Number(match[1]));
  }
  return out;
}

describe("public-templates-home", () => {
  it("T10.AC2: section-order — emits 13 markers in PART 1 numerical order", () => {
    const html = renderHome({ vm: makeVm() });
    const seq = extractMarkerSequence(html);
    expect(seq).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    // each marker is unique (no double-rendered section)
    expect(new Set(seq).size).toBe(13);
  });

  it("section-order — section markers stay in order when buckets are empty", () => {
    const html = renderHome({
      vm: makeVm({ hero: null, featured: [], latest: [], categories: [] }),
    });
    const seq = extractMarkerSequence(html);
    expect(seq).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("T10.AC3: brand-from-site — output contains site.name and never the banned vertical tokens", () => {
    const html = renderHome({ vm: makeVm() });

    // site.name flows through header + footer + about
    expect(html).toContain("Acme Daily");

    // PART 12 RED LINE — no hardcoded vertical brand. The /theiwise/i
    // pattern already covers the .com / staging. / app. variants.
    expect(html).not.toMatch(/theiwise/i);
    expect(html).not.toContain("cms.kodigital.app");

    // PART 8 RED LINE — no placeholder anchors
    expect(html).not.toContain('href="#"');
  });

  it("brand-from-site — site.name surfaces in header + footer + about regions", () => {
    const html = renderHome({
      vm: makeVm({
        site: {
          site_id: "a",
          name: "Beta Tribune",
          hostname: "beta.example",
          tagline: "Tomorrow's wires",
          description: "Independent reporting for the working week.",
          logoUrl: null,
          brandTokens: {},
        },
        // Use a generic newsletter heading so the brand-name assertions only
        // count site-sourced surfaces, not the per-site newsletter copy.
        newsletter: {
          heading: "Newsletter",
          description: "",
          provider: null,
        },
      }),
    });
    // header brand wordmark
    expect(html).toMatch(/<header class="site-header"[\s\S]*Beta Tribune/);
    // about heading
    expect(html).toContain("About Beta Tribune");
    // footer copyright
    expect(html).toMatch(/site-footer__copyright[^<]*Beta Tribune/);
    // tagline + description appear in the rendered body (about panel)
    expect(html).toContain("Independent reporting for the working week.");
    // banned tokens still absent
    expect(html).not.toMatch(/theiwise/i);
    expect(html).not.toContain("cms.kodigital.app");
  });

  it("renders category chips with real /category/<slug> hrefs", () => {
    const html = renderHome({ vm: makeVm() });
    expect(html).toContain('href="/category/tech"');
    expect(html).toContain('href="/category/world"');
    expect(html).toContain('href="/category/culture"');
  });

  it("renders ad slots in both leaderboard and in-feed surfaces", () => {
    const html = renderHome({ vm: makeVm() });
    expect(html).toContain('data-ad-type="leaderboard"');
    expect(html).toContain('data-ad-type="in-feed"');
    expect(html).toContain('data-ad-slot="home-leaderboard"');
    expect(html).toContain('data-ad-slot="home-in-feed"');
  });
});
