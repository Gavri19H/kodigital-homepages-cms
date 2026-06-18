// T16 (BCL-057) BEHAVIORAL regression for two user-facing defects:
//
//   T16-AC1 / RC-030 — (a) every non-featured article appears in a home
//   section: renderHome must render the FULL vm.latest bucket. The previous
//   `vm.latest.slice(5)` silently dropped the first 5 non-featured articles
//   (a false "remaining after trending" assumption — §7 trending is a
//   separate is_trending bucket already removed in buildHomeViewModel, never
//   the head of vm.latest), so those stories surfaced in NO section.
//   (b) the article share-rail URL contains the real host (site.hostname =
//   siteContext.hostname), not the literal `__SITE__` placeholder that
//   shipped a broken copy/share link.
//
// These are render-output behavioural assertions against renderHome /
// renderArticle — not source greps — so they fail if the user-facing output
// regresses (negative_fail_conditions: AC passes while outcome is broken).
//
// The `[api/test/home-bucketing.test.ts]` literal in each it() title is the
// deterministic binding for the required_evidence_plan RC-030
// parse_test_output route (expected_test_name_regex =
// api/test/home-bucketing.test.ts).

import { describe, it, expect } from "vitest";
import { renderHome } from "../src/public/templates/home";
import { renderArticle } from "../src/public/templates/article";
import type {
  HomeViewModel,
  HomeArticleCard,
} from "../src/public/view-models/home";
import type { ArticleViewModel } from "../src/public/view-models/article";

function homeCard(overrides: Partial<HomeArticleCard> = {}): HomeArticleCard {
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

function homeVm(latest: HomeArticleCard[]): HomeViewModel {
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
    hero: homeCard({ id: 100, slug: "hero", title: "Hero story", href: "/article/hero" }),
    featured: [
      homeCard({ id: 1, slug: "f1", title: "Featured one", href: "/article/f1" }),
      homeCard({ id: 2, slug: "f2", title: "Featured two", href: "/article/f2" }),
    ],
    picks: [],
    trending: [
      homeCard({ id: 90, slug: "t1", title: "Trending one", href: "/article/t1" }),
    ],
    latest,
    categories: [{ id: 1, slug: "tech", name: "Tech", href: "/category/tech" }],
    newsletter: { heading: "News", description: "Get the brief.", provider: "buttondown" },
    meta: {
      title: "Acme Daily",
      description: "Acme Daily covers technology, world, and culture.",
      canonicalUrl: "https://acme.example/",
    },
  };
}

function articleVm(hostname: string, slug: string): ArticleViewModel {
  return {
    site: {
      site_id: "site-acme",
      name: "Acme Daily",
      hostname,
      tagline: "Tomorrow's news today",
      description: "Acme Daily covers technology, world, and culture.",
      logoUrl: null,
      brandTokens: {},
    },
    article: {
      id: 42,
      slug,
      title: "The Feature That Mattered",
      excerpt: "A look at the new feature and why it matters.",
      href: `/article/${slug}`,
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
      body: [{ type: "html", html: "<p>Opening paragraph of the story.</p>" }],
      contentText: "Opening paragraph of the story.",
    },
    breadcrumb: [
      { name: "Home", url: "/" },
      { name: "The Feature That Mattered", url: `/article/${slug}` },
    ],
    faqs: [],
    related: [],
    meta: {
      title: "The Feature That Mattered — Acme Daily",
      description: "A look at the new feature.",
      canonicalUrl: `https://${hostname}/article/${slug}`,
      ogImage: "/media/feature.jpg",
      publishedAt: "2026-05-18T10:00:00.000Z",
      modifiedAt: "2026-05-18T11:00:00.000Z",
    },
  };
}

// Pull the §10 latest grid out of the rendered Home so the assertion is
// scoped to the bucket under test (not to incidental hero/featured/footer
// occurrences of the same href).
function latestSection(html: string): string {
  const start = html.indexOf("<!-- home-section:10 latest -->");
  const end = html.indexOf("<!-- home-section:11 newsletter -->");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe("home-bucketing (T16 / RC-030)", () => {
  it("renderHome renders EVERY non-featured article in the §10 latest section — no silent slice(5) drop [api/test/home-bucketing.test.ts]", () => {
    // 9 latest cards. Under the old `vm.latest.slice(5)` the first five
    // (l1..l5) were dropped from the page entirely.
    const latest = Array.from({ length: 9 }).map((_, i) =>
      homeCard({ id: 200 + i, slug: `l${i + 1}`, title: `Latest ${i + 1}`, href: `/article/l${i + 1}` }),
    );
    const html = renderHome({ vm: homeVm(latest) });
    const section = latestSection(html);

    // All nine appear — including the previously-dropped head (l1..l5).
    for (let i = 1; i <= 9; i++) {
      expect(section).toContain(`href="/article/l${i}"`);
      expect(section).toContain(`Latest ${i}`);
    }
    // Exactly nine cards rendered in the latest grid (one <li> per card) —
    // proves nothing was dropped AND nothing duplicated.
    const itemCount = (section.match(/class="home-grid__item"/g) ?? []).length;
    expect(itemCount).toBe(9);
  });

  it("the article share-rail URL contains the real host (site.hostname), never the __SITE__ placeholder [api/test/home-bucketing.test.ts]", () => {
    const html = renderArticle({ vm: articleVm("news.example.com", "the-feature") });

    // The §5 share-rail copy/native buttons carry the real, resolvable URL.
    expect(html).toContain('data-share-url="https://news.example.com/article/the-feature"');
    // The broken placeholder host must be gone from the whole page.
    expect(html).not.toContain("__SITE__");
  });

  it("the share-rail URL tracks the live request host per tenant [api/test/home-bucketing.test.ts]", () => {
    // A different tenant host proves the URL is data-driven, not hard-coded.
    const html = renderArticle({ vm: articleVm("daily.other-tenant.io", "second-story") });
    expect(html).toContain('data-share-url="https://daily.other-tenant.io/article/second-story"');
    expect(html).not.toContain("__SITE__");
  });
});
