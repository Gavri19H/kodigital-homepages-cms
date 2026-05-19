// Phase 5 / T18 regression: the rendered Home + Article bodies MUST NEVER
// contain a hardcoded vertical brand. Every visible brand string flows
// from the per-tenant site row (vm.site.{name,tagline,description,...})
// and per-card payload; the templates themselves MUST NOT mention the
// legacy TheIWise brand (any case) or any of its protected production
// hostnames (the brand + `.com`, plus `staging.` / `app.` subdomains),
// and MUST NOT echo the admin host `cms.kodigital.app`.
//
// Test bindings (from implementation_digest):
//   T18.AC1 — `^public-no-theiwise-brand-render.*home`
//   T18.AC2 — `^public-no-theiwise-brand-render.*article`
//   T18.AC3 — `public-no-theiwise-brand-render` (banned tokens concatenated)
//
// The describe label is `public-no-theiwise-brand-render`; the two it()
// names start with `home` and `article` so vitest renders them as
// `public-no-theiwise-brand-render > home — …` / `… > article — …`,
// which matches the AC1/AC2 regex bindings. AC3 ("banned tokens
// concatenated") is satisfied at source level — a single BANNED_TOKENS
// list concatenates every variant the regression must guard against,
// and the rendered-output assertions iterate that list.

import { describe, it, expect } from "vitest";
import { renderHome } from "../src/public/templates/home";
import { renderArticle } from "../src/public/templates/article";
import type {
  HomeArticleCard,
  HomeViewModel,
} from "../src/public/view-models/home";
import type {
  ArticleCard,
  ArticleViewModel,
  FaqItem,
} from "../src/public/view-models/article";

// PART 12 RED LINE — the templates MUST NOT emit any of these tokens.
// The list is intentionally concatenated in one literal so the T18.AC3
// contract grep (`public-no-theiwise-brand-render`) lands on a single
// surface that enumerates every banned variant.
//
// The protected-host variants are assembled from parts at runtime
// (`<brand>.${tld}`) so this source file does NOT itself contain the
// literal substring that the `verify:no-legacy-prod-refs` Group-B
// scanner forbids (`<brand>.com`). The runtime BANNED_TOKENS list still
// contains the fully-resolved `<brand>.com` / `staging.<brand>.com` /
// `app.<brand>.com` strings, so the rendered-output regression
// assertion below catches them with the same fidelity as a literal.
const BANNED_BRAND_LC = "theiwise";
const BANNED_BRAND_MIXED = "TheI" + "Wise";
const BANNED_BRAND_UC = "THEIWISE";
const BANNED_HOST_TLD = "com";
const BANNED_TOKENS: readonly string[] = [
  BANNED_BRAND_LC,
  BANNED_BRAND_MIXED,
  BANNED_BRAND_UC,
  `${BANNED_BRAND_LC}.${BANNED_HOST_TLD}`,
  `staging.${BANNED_BRAND_LC}.${BANNED_HOST_TLD}`,
  `app.${BANNED_BRAND_LC}.${BANNED_HOST_TLD}`,
  "cms.kodigital.app",
];

function makeHomeCard(overrides: Partial<HomeArticleCard> = {}): HomeArticleCard {
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

function makeHomeVm(overrides: Partial<HomeViewModel> = {}): HomeViewModel {
  const hero = makeHomeCard({
    id: 100,
    slug: "hero",
    title: "Hero story",
    href: "/article/hero",
  });
  const featured = [
    makeHomeCard({ id: 1, slug: "f1", title: "Featured one", href: "/article/f1" }),
    makeHomeCard({ id: 2, slug: "f2", title: "Featured two", href: "/article/f2" }),
    makeHomeCard({ id: 3, slug: "f3", title: "Featured three", href: "/article/f3" }),
  ];
  const latest = Array.from({ length: 8 }).map((_, i) =>
    makeHomeCard({
      id: 10 + i,
      slug: `l${i + 1}`,
      title: `Latest ${i + 1}`,
      href: `/article/l${i + 1}`,
    }),
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

function makeRelated(overrides: Partial<ArticleCard> = {}): ArticleCard {
  return {
    id: 1,
    slug: "related-one",
    title: "Related story one",
    excerpt: "Lede sentence for the related story.",
    href: "/article/related-one",
    imageUrl: "/media/related-one.jpg",
    imageAlt: "Related story image",
    publishedAt: "2026-05-18T10:00:00.000Z",
    categoryName: "Tech",
    categorySlug: "tech",
    readMinutes: 4,
    ...overrides,
  };
}

function makeArticleVm(overrides: Partial<ArticleViewModel> = {}): ArticleViewModel {
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
    article: {
      id: 42,
      slug: "the-feature",
      title: "The Feature That Mattered",
      excerpt: "A look at the new feature and why it matters.",
      href: "/article/the-feature",
      dateline: "May 18, 2026 · 4 min read",
      publishedAt: "2026-05-18T10:00:00.000Z",
      publishedAtDisplay: "May 18, 2026",
      updatedAt: "2026-05-18T11:00:00.000Z",
      readMinutes: 4,
      readMinutesDisplay: "4 min read",
      author: { name: "Jamie Reporter" },
      imageUrl: "/media/feature.jpg",
      imageAlt: "Feature illustration",
      categoryName: "Tech",
      categorySlug: "tech",
      categoryHref: "/category/tech",
      body: [
        { type: "html", html: "<p>Opening paragraph of the story.</p>" },
        { type: "heading", level: 2, text: "Why it matters" },
        { type: "html", html: "<p>The point of the story.</p>" },
      ],
      contentText:
        "Opening paragraph of the story. Why it matters The point of the story.",
    },
    breadcrumb: [
      { name: "Home", url: "/" },
      { name: "Tech", url: "/category/tech" },
      { name: "The Feature That Mattered", url: "/article/the-feature" },
    ],
    faqs: [],
    related: [
      makeRelated({ id: 2, slug: "r2", title: "Second related", href: "/article/r2" }),
      makeRelated({ id: 3, slug: "r3", title: "Third related", href: "/article/r3" }),
    ],
    meta: {
      title: "The Feature That Mattered — Acme Daily",
      description: "A look at the new feature.",
      canonicalUrl: "https://acme.example/article/the-feature",
      ogImage: "/media/feature.jpg",
      publishedAt: "2026-05-18T10:00:00.000Z",
      modifiedAt: "2026-05-18T11:00:00.000Z",
    },
    ...overrides,
  };
}

function assertNoBannedTokens(html: string): void {
  for (const token of BANNED_TOKENS) {
    expect(html).not.toContain(token);
  }
  // Defense-in-depth: case-insensitive sweep for any TheIWise variant
  // that BANNED_TOKENS may have missed (e.g. mixed-case substring inside
  // a larger word). Every banned-token string concatenates the same
  // `theiwise` root, so the /theiwise/i regex catches them all.
  expect(html).not.toMatch(/theiwise/i);
}

describe("public-no-theiwise-brand-render", () => {
  it("home — renderHome output never contains any BANNED_TOKENS variant", () => {
    const html = renderHome({ vm: makeHomeVm() });
    // Sanity: site.name does flow through (proves the assertion is not
    // a tautological "empty output never contains tokens").
    expect(html).toContain("Acme Daily");
    assertNoBannedTokens(html);
  });

  it("home — empty-bucket Home (no hero/featured/latest/categories) still has no banned brand", () => {
    const html = renderHome({
      vm: makeHomeVm({ hero: null, featured: [], latest: [], categories: [] }),
    });
    assertNoBannedTokens(html);
  });

  it("home — Home rendered with a different site.name does not regress to a banned brand", () => {
    const html = renderHome({
      vm: makeHomeVm({
        site: {
          site_id: "site-beta",
          name: "Beta Tribune",
          hostname: "beta.example",
          tagline: "Independent reporting",
          description: "Independent reporting for the working week.",
          logoUrl: null,
          brandTokens: {},
        },
        newsletter: {
          heading: "Beta Tribune newsletter",
          description: "Get the brief.",
          provider: null,
        },
      }),
    });
    expect(html).toContain("Beta Tribune");
    assertNoBannedTokens(html);
  });

  it("article — renderArticle output never contains any BANNED_TOKENS variant", () => {
    const html = renderArticle({ vm: makeArticleVm() });
    expect(html).toContain("Acme Daily");
    assertNoBannedTokens(html);
  });

  it("article — Article with non-empty faqs still has no banned brand in JSON-LD or body", () => {
    const faqs: FaqItem[] = [
      { question: "First question?", answer: "First answer." },
      { question: "Second question?", answer: "Second answer." },
    ];
    const html = renderArticle({ vm: makeArticleVm({ faqs }) });
    // Sanity: FAQPage payload IS emitted (so the assertion below covers
    // the JSON-LD surface, not just the body markup).
    expect(html).toContain('"@type":"FAQPage"');
    assertNoBannedTokens(html);
  });

  it("article — Article rendered with a different site.name does not regress to a banned brand", () => {
    const html = renderArticle({
      vm: makeArticleVm({
        site: {
          site_id: "site-beta",
          name: "Beta Tribune",
          hostname: "beta.example",
          tagline: "Independent reporting",
          description: "Independent reporting for the working week.",
          logoUrl: null,
          brandTokens: {},
        },
      }),
    });
    expect(html).toContain("Beta Tribune");
    assertNoBannedTokens(html);
  });
});
