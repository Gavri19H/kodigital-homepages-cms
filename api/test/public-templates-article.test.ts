// C8 / T13 BEHAVIORAL guards for renderArticle.
//
// Contract: docs/design-contract.md §8 — Article section order (12) +
// nesting. §§5–9 nest inside the §4 article-shell; §§7–8 nest inside the
// §6 article-body. ReadingProgress is §1 — index 0 of the page, BEFORE the
// header. There is no top-level ad or breadcrumb section on Article; the
// only Article ad is the sidebar 300×250 rect (`.sidebar-ad.ad-slot--rect`).
//
//   T13.AC1 — section order correct with nested shell content
//   T13.AC2 — reading-progress is index 0
//   T13.AC4 — BreadcrumbList JSON-LD intact (also json-ld-article.test.ts)
//
// Carried-over guards from the earlier article template phase: the shell
// records the literal `minmax(0, 1fr)` column contract, and an empty
// faqs[] MUST NOT emit a FAQPage JSON-LD payload.

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

function markerIndex(html: string, n: number, name: string): number {
  return html.indexOf(`<!-- article-section:${n} ${name} -->`);
}

describe("public-templates-article", () => {
  it("T13.AC1: section-order — emits 12 §8 markers in contract order with §§5–9 nested in the shell and §§7–8 nested in the body", () => {
    const html = renderArticle({ vm: makeVm() });
    const seq = extractMarkerSequence(html);
    expect(seq).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // each marker is unique (no double-rendered section)
    expect(new Set(seq).size).toBe(12);

    // Nesting: §§5–9 sit INSIDE the §4 article-shell (between the shell
    // marker and the §10 related-section marker)…
    const shellStart = markerIndex(html, 4, "article-shell");
    const relatedStart = markerIndex(html, 10, "related-section");
    expect(shellStart).toBeGreaterThan(-1);
    expect(relatedStart).toBeGreaterThan(shellStart);
    const shellHtml = html.slice(shellStart, relatedStart);
    expect(markerIndex(shellHtml, 5, "share-rail")).toBeGreaterThan(-1);
    expect(markerIndex(shellHtml, 6, "article-body")).toBeGreaterThan(-1);
    expect(markerIndex(shellHtml, 9, "article-sidebar")).toBeGreaterThan(-1);

    // …and §§7–8 sit INSIDE the §6 article-body element.
    const bodyOpen = shellHtml.indexOf('<article class="article-body"');
    const bodyClose = shellHtml.indexOf("</article>");
    expect(bodyOpen).toBeGreaterThan(-1);
    expect(bodyClose).toBeGreaterThan(bodyOpen);
    const bodyHtml = shellHtml.slice(bodyOpen, bodyClose);
    expect(markerIndex(bodyHtml, 7, "faq-section")).toBeGreaterThan(-1);
    expect(markerIndex(bodyHtml, 8, "article-share-bottom")).toBeGreaterThan(-1);
    // The sidebar is a shell child, NOT a body child.
    expect(bodyHtml).not.toContain('class="article-sidebar"');
  });

  it("section-order — markers stay in order when faqs/related are empty", () => {
    const html = renderArticle({
      vm: makeVm({ faqs: [], related: [] }),
    });
    const seq = extractMarkerSequence(html);
    expect(seq).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("T13.AC2: reading-progress-index-0 — reading-progress is the first section, before the header", () => {
    const html = renderArticle({ vm: makeVm() });
    const seq = extractMarkerSequence(html);
    expect(seq[0]).toBe(1);
    const progressAt = markerIndex(html, 1, "reading-progress");
    const headerAt = markerIndex(html, 2, "site-header");
    expect(progressAt).toBeGreaterThan(-1);
    expect(headerAt).toBeGreaterThan(progressAt);
    // The 3px-bar element itself renders at index 0 (right after its marker,
    // before any header markup).
    const progressEl = html.indexOf('class="reading-progress"');
    expect(progressEl).toBeGreaterThan(progressAt);
    expect(progressEl).toBeLessThan(headerAt);
    expect(html).toContain('class="reading-progress-bar"');
  });

  it("article-shell-minmax — rendered shell records the minmax(0, 1fr) column contract on `.article-shell.container`", () => {
    const html = renderArticle({ vm: makeVm() });
    // PART 4: shell column track is recorded literally in the body so a
    // CSS-less snapshot still captures the contract. §8 row 4 pins the
    // shell root selector as `.article-shell.container`.
    expect(html).toContain('class="article-shell container"');
    expect(html).toContain("minmax(0, 1fr)");
  });

  it("ad-slots — no top-level leaderboard/in-feed on Article; the sidebar rect is the only ad (§8/§10)", () => {
    const html = renderArticle({ vm: makeVm() });
    expect(html).not.toContain('data-ad-type="leaderboard"');
    expect(html).not.toContain('data-ad-type="in-feed"');
    // §11 sidebar ad card: `.sidebar-ad.ad-slot--rect` wrapping the rect slot.
    expect(html).toContain('class="sidebar-card sidebar-ad ad-slot--rect"');
    expect(html).toContain('data-ad-type="rect"');
    expect(html).toContain('data-ad-slot="article-sidebar-ad"');
  });

  it("faqs-empty-no-faqpage — empty faqs[] does NOT emit FAQPage JSON-LD", () => {
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

  it("T13.AC4: breadcrumb — no visible breadcrumb section (§8), but the BreadcrumbList JSON-LD stays intact", () => {
    const html = renderArticle({ vm: makeVm() });
    // §8 lists 12 sections; none is a breadcrumb, and §10's class
    // vocabulary has no breadcrumb class.
    expect(html).not.toContain("article-breadcrumb");
    // The structured-data trail survives with every crumb present.
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('"Home"');
    expect(html).toContain('"Tech"');
    // PART 8: the category link stays a real URL (now via the hero pill).
    expect(html).toContain('href="/category/tech"');
  });
});
