// Phase 5 / T19 regression: the rendered public Home and Article surfaces
// MUST emit the JSON-LD payloads the PART 1 / PART 6 spec requires, with
// the FAQPage block GATED on a non-empty vm.faqs[] (PART 6 RED LINE).
//
// Home (via buildHomeJsonLd + renderLayout, exactly as the router wires it
// in api/src/public/router.ts GET /):
//   - one <script type="application/ld+json"> with @type="WebSite"
//   - one with @type="Organization"
//   - one with @type="ItemList"
//
// Article (via renderArticle, which builds + emits its own JSON-LD blocks):
//   - WHEN vm.faqs is non-empty: Article + BreadcrumbList + FAQPage
//   - WHEN vm.faqs is empty: Article + BreadcrumbList, NO FAQPage
//
// Test bindings (from implementation_digest):
//   T19.AC1 — `^public-json-ld-presence.*home`
//   T19.AC2 — `^public-json-ld-presence.*article[_-]?with[_-]?faqs`
//   T19.AC3 — `^public-json-ld-presence.*article[_-]?empty[_-]?faqs`
//
// The describe label is `public-json-ld-presence`; the it() names start
// with `home`, `article-with-faqs`, and `article-empty-faqs` so vitest
// renders them in the form `public-json-ld-presence > <name> — …`, which
// matches the AC1/AC2/AC3 name regexes.

import { describe, it, expect } from "vitest";
import { renderLayout } from "../src/public/templates/layout";
import { renderArticle } from "../src/public/templates/article";
import { buildHomeJsonLd } from "../src/public/templates/seo";
import type {
  ArticleCard,
  ArticleViewModel,
  FaqItem,
} from "../src/public/view-models/article";

// Minimal home fixture — the home JSON-LD test only needs the fields
// `buildHomeJsonLd` and `renderLayout` actually consume (site identity +
// featured slugs/titles). We do NOT depend on buildHomeViewModel here so
// the test stays a pure template-layer regression with no D1 stub.
const HOME_SITE = {
  site_id: "site-acme",
  name: "Acme Daily",
  hostname: "acme.example",
  tagline: "Tomorrow's news today",
  description: "Acme Daily covers technology, world, and culture.",
  logoUrl: "https://acme.example/logo.png" as string | null,
  brandTokens: {} as Readonly<Record<string, string>>,
};

const HOME_FEATURED = [
  {
    title: "Featured one",
    slug: "f1",
    excerpt: "Lede sentence for featured one.",
    imageUrl: "/media/f1.jpg" as string | null,
    publishedAt: "2026-05-18T10:00:00.000Z",
  },
  {
    title: "Featured two",
    slug: "f2",
    excerpt: "Lede sentence for featured two.",
    imageUrl: null as string | null,
    publishedAt: "2026-05-18T10:00:00.000Z",
  },
];

function renderHomeWithJsonLd(): string {
  const jsonLd = buildHomeJsonLd({
    site: {
      name: HOME_SITE.name,
      hostname: HOME_SITE.hostname,
      tagline: HOME_SITE.tagline,
      description: HOME_SITE.description,
      logoUrl: HOME_SITE.logoUrl,
    },
    featured: HOME_FEATURED,
  });
  return renderLayout({
    site: {
      name: HOME_SITE.name,
      hostname: HOME_SITE.hostname,
      tagline: HOME_SITE.tagline,
      description: HOME_SITE.description,
      brandTokens: HOME_SITE.brandTokens,
      logoUrl: HOME_SITE.logoUrl,
    },
    meta: {
      title: `${HOME_SITE.name} — ${HOME_SITE.tagline}`,
      description: HOME_SITE.description,
      canonicalUrl: `https://${HOME_SITE.hostname}/`,
      jsonLd,
    },
    body: "<div>home body</div>",
  });
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

// Pull every <script type="application/ld+json">…</script> payload out of
// a rendered HTML string and return the parsed JSON objects in source
// order. Robust to attribute order and whitespace; refuses payloads that
// fail to parse so a regression that breaks the JSON wire form surfaces
// as a hard test failure rather than a silent miss.
function extractJsonLdTypes(html: string): string[] {
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const types: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = (match[1] ?? "").trim();
    if (raw.length === 0) continue;
    const parsed = JSON.parse(raw) as { "@type"?: unknown };
    if (typeof parsed["@type"] === "string") types.push(parsed["@type"]);
  }
  return types;
}

describe("public-json-ld-presence", () => {
  it("T19.AC1: home — renderLayout output contains WebSite + Organization + ItemList JSON-LD blocks", () => {
    const html = renderHomeWithJsonLd();
    const types = extractJsonLdTypes(html);
    expect(types).toContain("WebSite");
    expect(types).toContain("Organization");
    expect(types).toContain("ItemList");
    // The home payload is exactly the three PART 1 schema.org types — no
    // stray FAQPage / Article / BreadcrumbList sneaks into Home.
    expect(types).toEqual(["WebSite", "Organization", "ItemList"]);
    // Defense-in-depth: the wire form of each JSON-LD payload appears in
    // the rendered HTML so the test fails fast if renderLayout regresses
    // its <script type="application/ld+json"> emission.
    expect(html).toContain('"@type":"WebSite"');
    expect(html).toContain('"@type":"Organization"');
    expect(html).toContain('"@type":"ItemList"');
  });

  it("T19.AC1: article-with-faqs — renderArticle emits Article + BreadcrumbList + FAQPage when vm.faqs is non-empty", () => {
    const faqs: FaqItem[] = [
      { question: "What is this story about?", answer: "It is about the feature." },
      { question: "Why does it matter?", answer: "Because users care." },
    ];
    const html = renderArticle({ vm: makeArticleVm({ faqs }) });
    const types = extractJsonLdTypes(html);
    expect(types).toContain("Article");
    expect(types).toContain("BreadcrumbList");
    expect(types).toContain("FAQPage");
    // Article + BreadcrumbList + FAQPage and nothing else (e.g. no WebSite
    // bleed-in from the home pipeline).
    expect(types).toEqual(["Article", "BreadcrumbList", "FAQPage"]);
    // Wire-form sanity checks — these mirror the JSON.stringify output of
    // the seo builders, so a regression that drops a payload regresses
    // both extractJsonLdTypes() and the literal substring check.
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('"@type":"FAQPage"');
  });

  it("T19.AC2: article-empty-faqs — renderArticle omits FAQPage when vm.faqs is empty", () => {
    const html = renderArticle({ vm: makeArticleVm({ faqs: [] }) });
    const types = extractJsonLdTypes(html);
    expect(types).toContain("Article");
    expect(types).toContain("BreadcrumbList");
    expect(types).not.toContain("FAQPage");
    // Exactly two JSON-LD payloads with empty faqs.
    expect(types).toEqual(["Article", "BreadcrumbList"]);
    // PART 6 RED LINE: the FAQPage @type string MUST NOT appear anywhere
    // in the output (no leftover empty mainEntity payload). buildFaqJsonLd
    // returns "" for an empty faqs[], and renderArticle skips pushing the
    // empty string into jsonLdBlocks; this assertion guards both layers.
    expect(html).not.toContain('"@type":"FAQPage"');
  });
});
