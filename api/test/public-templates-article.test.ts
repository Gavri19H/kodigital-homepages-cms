// Phase 5 / T11 BEHAVIORAL guards for renderArticle.
//
// Test bindings (from implementation_digest):
//   T11.AC2 — `^public-templates-article.*section[_-]?order`
//   T11.AC3 — `^public-templates-article.*article[_-]?shell[_-]?minmax`
//   T11.AC4 — `^public-templates-article.*faqs[_-]?empty[_-]?no[_-]?faqpage`
//
// PART 2 specifies 12 article sections in numerical render order. PART 4
// requires the article shell to use `minmax(0, 1fr)` so long links/code
// do not blow the grid. PART 6 forbids emitting a FAQPage JSON-LD block
// when faqs[] is empty.

import { describe, it, expect } from "vitest";
import { renderArticle } from "../src/public/templates/article";
import type {
  ArticleViewModel,
  ArticleCard,
  FaqItem,
} from "../src/public/view-models/article";

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

function makeVm(overrides: Partial<ArticleViewModel> = {}): ArticleViewModel {
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
      contentText: "Opening paragraph of the story. Why it matters The point of the story.",
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

function extractMarkerSequence(html: string): number[] {
  const re = /article-section:(\d+)/g;
  const out: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    out.push(Number(match[1]));
  }
  return out;
}

describe("public-templates-article", () => {
  it("T11.AC2: section-order — emits 12 markers in PART 2 numerical order", () => {
    const html = renderArticle({ vm: makeVm() });
    const seq = extractMarkerSequence(html);
    expect(seq).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // each marker is unique (no double-rendered section)
    expect(new Set(seq).size).toBe(12);
  });

  it("section-order — markers stay in order when faqs/related are empty", () => {
    const html = renderArticle({
      vm: makeVm({ faqs: [], related: [] }),
    });
    const seq = extractMarkerSequence(html);
    expect(seq).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("T11.AC3: article-shell-minmax — rendered shell records the minmax(0, 1fr) column contract", () => {
    const html = renderArticle({ vm: makeVm() });
    // PART 4: shell column track is recorded literally in the body so a
    // CSS-less snapshot still captures the contract.
    expect(html).toContain('class="article-shell"');
    expect(html).toContain("minmax(0, 1fr)");
  });

  it("T11.AC4: faqs-empty-no-faqpage — empty faqs[] does NOT emit FAQPage JSON-LD", () => {
    const html = renderArticle({ vm: makeVm({ faqs: [] }) });
    // PART 6: when faqs is empty the FAQPage payload MUST be omitted.
    expect(html).not.toContain('"@type":"FAQPage"');
    expect(html).not.toContain('"@type": "FAQPage"');
    // Article + BreadcrumbList JSON-LD remain present (sanity check).
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain('"@type":"BreadcrumbList"');
  });

  it("faqs-empty-no-faqpage — non-empty faqs DOES emit FAQPage JSON-LD", () => {
    const faqs: FaqItem[] = [
      { question: "First?", answer: "Yes." },
      { question: "Second?", answer: "No." },
    ];
    const html = renderArticle({ vm: makeVm({ faqs }) });
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain("First?");
    expect(html).toContain("Second?");
  });

  it("brand-from-site — site.name surfaces; banned vertical tokens are absent", () => {
    const html = renderArticle({ vm: makeVm() });
    expect(html).toContain("Acme Daily");
    expect(html).not.toMatch(/theiwise/i);
    expect(html).not.toContain("cms.kodigital.app");
    expect(html).not.toContain('href="#"');
  });

  it("breadcrumb — real category + article hrefs (PART 8)", () => {
    const html = renderArticle({ vm: makeVm() });
    expect(html).toContain('href="/category/tech"');
    expect(html).toContain('class="article-breadcrumb"');
  });
});
