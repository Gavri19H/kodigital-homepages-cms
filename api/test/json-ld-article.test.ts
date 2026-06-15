import { describe, it, expect } from "vitest";
import {
  renderArticleJsonLd,
  renderBreadcrumbJsonLd,
  renderFaqJsonLd,
} from "../src/public/templates/jsonld-article";
import {
  renderArticleHtml,
  renderHomepageHtml,
  renderCategoryHtml,
  renderPageHtml,
} from "../src/public/render-pages";
import type { ArticleRow } from "../src/db";
import type { PublicSiteContext } from "../src/public/middleware";
import type {
  PublicCategoryRow,
  PublicPageRow,
} from "../src/public/queries";

function parseJsonLd(html: string): Record<string, unknown> {
  const open = '<script type="application/ld+json">';
  const close = "</script>";
  const startIdx = html.indexOf(open);
  const endIdx = html.lastIndexOf(close);
  if (startIdx < 0 || endIdx <= startIdx) {
    throw new Error(`JSON-LD <script> markers not found in: ${html}`);
  }
  const body = html.slice(startIdx + open.length, endIdx).trim();
  // Reverse the "<\/script" guard so JSON.parse sees clean JSON.
  return JSON.parse(body.replace(/<\\\//g, "</")) as Record<string, unknown>;
}

// T1 (rescue-3): renderHomepageHtml is now db-fed (it composes
// buildHomeViewModel). These GEO assertions only care about the homepage's
// JSON-LD *shape* (no FAQPage, no BreadcrumbList), so an empty-listing D1
// stub is sufficient — the home doc renders WebSite + Organization only.
function makeEmptyHomeDb(): D1Database {
  const stmt = {
    bind() {
      return stmt;
    },
    async first() {
      return null;
    },
    async all() {
      return { results: [], success: true, meta: {} };
    },
    async run() {
      return { success: true, meta: {} };
    },
  };
  return {
    prepare() {
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

describe("T9 renderArticleJsonLd: Article schema", () => {
  const baseInput = {
    url: "https://example.com/article/hello",
    headline: "Hello World",
    image: "https://example.com/img/hello.jpg",
    datePublished: "2026-05-22T10:00:00Z",
    dateModified: "2026-05-22T11:30:00Z",
    authorName: "Jane Doe",
    authorUrl: "https://example.com/author/jane",
    publisherName: "Example Publisher",
    publisherLogo: "https://example.com/img/logo.png",
    description: "A short article summary used by SERP rich results.",
  };

  it("emits a <script type=\"application/ld+json\"> wrapper", () => {
    const html = renderArticleJsonLd(baseInput);
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain("</script>");
  });

  it("sets @type Article + @context schema.org", () => {
    const payload = parseJsonLd(renderArticleJsonLd(baseInput));
    expect(payload["@context"]).toBe("https://schema.org");
    expect(payload["@type"]).toBe("Article");
  });

  it("T9-AC2: emits headline, author, datePublished, dateModified, image, description", () => {
    const payload = parseJsonLd(renderArticleJsonLd(baseInput));
    expect(payload.headline).toBe("Hello World");
    expect(payload.datePublished).toBe("2026-05-22T10:00:00Z");
    expect(payload.dateModified).toBe("2026-05-22T11:30:00Z");
    expect(payload.image).toBe("https://example.com/img/hello.jpg");
    expect(payload.description).toBe(
      "A short article summary used by SERP rich results.",
    );
    const author = payload.author as Record<string, unknown>;
    expect(author["@type"]).toBe("Person");
    expect(author.name).toBe("Jane Doe");
  });

  it("T9-AC4: emits mainEntityOfPage with @type WebPage + canonical url", () => {
    const payload = parseJsonLd(renderArticleJsonLd(baseInput));
    const mainEntityOfPage = payload.mainEntityOfPage as Record<string, unknown>;
    expect(mainEntityOfPage["@type"]).toBe("WebPage");
    expect(mainEntityOfPage["@id"]).toBe("https://example.com/article/hello");
  });

  it("emits a Publisher Organization with logo ImageObject when supplied", () => {
    const payload = parseJsonLd(renderArticleJsonLd(baseInput));
    const publisher = payload.publisher as Record<string, unknown>;
    expect(publisher["@type"]).toBe("Organization");
    expect(publisher.name).toBe("Example Publisher");
    const logo = publisher.logo as Record<string, unknown>;
    expect(logo["@type"]).toBe("ImageObject");
    expect(logo.url).toBe("https://example.com/img/logo.png");
  });

  it("omits optional fields (image, description, section) when not supplied", () => {
    const payload = parseJsonLd(
      renderArticleJsonLd({
        url: "https://example.com/article/min",
        headline: "Minimal",
        datePublished: "2026-05-22T10:00:00Z",
        dateModified: "2026-05-22T10:00:00Z",
        authorName: "A",
        publisherName: "P",
      }),
    );
    expect(payload.image).toBeUndefined();
    expect(payload.description).toBeUndefined();
    expect(payload.articleSection).toBeUndefined();
  });

  it("emits articleSection when section is supplied", () => {
    const payload = parseJsonLd(
      renderArticleJsonLd({ ...baseInput, section: "news" }),
    );
    expect(payload.articleSection).toBe("news");
  });

  it("never substitutes a default host (T8 tenant-boundary discipline)", () => {
    const html = renderArticleJsonLd(baseInput);
    expect(html).not.toMatch(/cms\.kodigital\.app/);
  });

  it("guards against </script> early termination inside string values", () => {
    const html = renderArticleJsonLd({
      ...baseInput,
      headline: "Evil </script><script>alert(1)</script>",
    });
    // The literal </script ... > end-tag MUST appear ONLY as the closing
    // </script> of the JSON-LD wrapper, not from the embedded payload.
    const matches = html.match(/<\/script/gi) ?? [];
    expect(matches.length).toBe(1);
    // The embedded sequence must be neutered via "<\/script>".
    expect(html).toContain("<\\/script");
  });
});

describe("T9 renderBreadcrumbJsonLd: BreadcrumbList", () => {
  it("emits @type BreadcrumbList with itemListElement array", () => {
    const payload = parseJsonLd(
      renderBreadcrumbJsonLd({
        items: [
          { name: "Home", url: "https://example.com/" },
          { name: "News", url: "https://example.com/category/news" },
          { name: "Story", url: "https://example.com/article/story" },
        ],
      }),
    );
    expect(payload["@type"]).toBe("BreadcrumbList");
    const items = payload.itemListElement as Record<string, unknown>[];
    expect(items).toHaveLength(3);
    const first = items[0]!;
    const third = items[2]!;
    expect(first["@type"]).toBe("ListItem");
    expect(first.position).toBe(1);
    expect(first.name).toBe("Home");
    expect(first.item).toBe("https://example.com/");
    expect(third.position).toBe(3);
    expect(third.name).toBe("Story");
  });

  it("emits an empty itemListElement array when no items supplied", () => {
    const payload = parseJsonLd(renderBreadcrumbJsonLd({ items: [] }));
    expect(payload.itemListElement).toEqual([]);
  });
});

describe("T9 renderFaqJsonLd: FAQPage", () => {
  it("emits @type FAQPage with mainEntity Question/Answer pairs", () => {
    const payload = parseJsonLd(
      renderFaqJsonLd({
        questions: [
          { question: "What is X?", answer: "X is Y." },
          { question: "How do I Z?", answer: "Click here to Z." },
        ],
      }),
    );
    expect(payload["@type"]).toBe("FAQPage");
    const main = payload.mainEntity as Record<string, unknown>[];
    expect(main).toHaveLength(2);
    const q0 = main[0]!;
    expect(q0["@type"]).toBe("Question");
    expect(q0.name).toBe("What is X?");
    const accepted = q0.acceptedAnswer as Record<string, unknown>;
    expect(accepted["@type"]).toBe("Answer");
    expect(accepted.text).toBe("X is Y.");
  });

  it("emits an empty mainEntity when no questions supplied", () => {
    const payload = parseJsonLd(renderFaqJsonLd({ questions: [] }));
    expect(payload.mainEntity).toEqual([]);
  });

  it("preserves unicode in question/answer text", () => {
    const payload = parseJsonLd(
      renderFaqJsonLd({
        questions: [{ question: "Quoi?", answer: "résumé — \"caché\"." }],
      }),
    );
    const main = payload.mainEntity as Record<string, unknown>[];
    const q0 = main[0]!;
    expect(q0.name).toBe("Quoi?");
    const accepted = q0.acceptedAnswer as Record<string, unknown>;
    expect(accepted.text).toBe("résumé — \"caché\".");
  });
});

// ---------------------------------------------------------------------------
// T41 [F2] GEO checklist conformance (docs/geo-checklist.md §1–§5) against
// the LIVE render path (render-pages.ts — what the public router caches).
// The evidence runner binds each AC to a test whose title carries the literal
// "cd api && npx vitest run test/json-ld-article.test.ts" in their titles.
// ---------------------------------------------------------------------------

function extractJsonLdBlocks(html: string): Record<string, unknown>[] {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  const blocks: Record<string, unknown>[] = [];
  for (const m of html.matchAll(re)) {
    blocks.push(
      JSON.parse(m[1]!.trim().replace(/<\\\//g, "</")) as Record<
        string,
        unknown
      >,
    );
  }
  return blocks;
}

function findByType(
  blocks: Record<string, unknown>[],
  type: string,
): Record<string, unknown> | undefined {
  return blocks.find((b) => b["@type"] === type);
}

const geoSiteContext: PublicSiteContext = {
  site_id: "site-acme",
  siteId: "site-acme",
  hostname: "acme.example",
  vertical_slug: "news",
  status: "active",
  content_version: 1,
  settings_version: 1,
};

const FAQ_CONTENT_JSON = JSON.stringify({
  blocks: [
    { type: "html", html: "<p>Opening paragraph.</p>" },
    {
      type: "faq",
      question: "What is GEO?",
      answer: "Generative engine optimization.",
    },
    {
      type: "faq",
      question: "Why emit JSON-LD?",
      answer: "Structured facts are machine-extractable and cite-stable.",
    },
  ],
});

function makeGeoArticleRow(overrides: Partial<ArticleRow> = {}): ArticleRow {
  return {
    id: 1,
    slug: "story-one",
    title: "Story one",
    content_json: "{}",
    content_html: "<p>Opening paragraph.</p>",
    category_id: null,
    status: "published",
    published_at: 1747562400,
    scheduled_at: null,
    author_name: "Jamie Reporter",
    featured_image_id: null,
    is_featured: 0,
    is_trending: 0,
    created_at: 1747562400,
    updated_at: 1747566000,
    site_id: "site-acme",
    ...overrides,
  };
}

const geoCategory: PublicCategoryRow = { id: 7, slug: "news", name: "News" };

const geoPage: PublicPageRow = {
  id: 3,
  slug: "about",
  title: "About us",
  content_html: "<p>About body.</p>",
  status: "published",
  updated_at: 1747566000,
  site_id: "site-acme",
};

describe("T41 [F2] GEO checklist conformance (docs/geo-checklist.md)", () => {
  const articlePath = "/article/story-one";
  const articleCanonical = "https://acme.example/article/story-one";

  it("T41.AC1 article render emits author + publisher + datePublished + dateModified [cd api && npx vitest run test/json-ld-article.test.ts]", () => {
    const html = renderArticleHtml(
      geoSiteContext,
      makeGeoArticleRow(),
      articlePath,
    );
    const article = findByType(extractJsonLdBlocks(html), "Article")!;
    expect(article).toBeDefined();
    // §3 author metadata: Person byline with name.
    const author = article.author as Record<string, unknown>;
    expect(author["@type"]).toBe("Person");
    expect(author.name).toBe("Jamie Reporter");
    // §3 publisher: tenant Organization with name.
    const publisher = article.publisher as Record<string, unknown>;
    expect(publisher["@type"]).toBe("Organization");
    expect(publisher.name).toBe("acme.example");
    // §4 freshness dates: both ISO-8601, dateModified >= datePublished.
    const datePublished = article.datePublished as string;
    const dateModified = article.dateModified as string;
    expect(datePublished).toBe(new Date(1747562400 * 1000).toISOString());
    expect(dateModified).toBe(new Date(1747566000 * 1000).toISOString());
    expect(Date.parse(dateModified)).toBeGreaterThanOrEqual(
      Date.parse(datePublished),
    );
  });

  it("T41.AC2 FAQPage emitted only when faqs non-empty [cd api && npx vitest run test/json-ld-article.test.ts]", () => {
    // §1: an article whose content_json carries faq blocks emits FAQPage
    // with Question / acceptedAnswer / Answer wire names.
    const withFaqs = renderArticleHtml(
      geoSiteContext,
      makeGeoArticleRow({ content_json: FAQ_CONTENT_JSON }),
      articlePath,
    );
    const faqPage = findByType(extractJsonLdBlocks(withFaqs), "FAQPage")!;
    expect(faqPage).toBeDefined();
    const main = faqPage.mainEntity as Record<string, unknown>[];
    expect(main).toHaveLength(2);
    expect(main[0]!["@type"]).toBe("Question");
    expect(main[0]!.name).toBe("What is GEO?");
    const accepted = main[0]!.acceptedAnswer as Record<string, unknown>;
    expect(accepted["@type"]).toBe("Answer");
    expect(accepted.text).toBe("Generative engine optimization.");
    // §1: empty FAQ set -> NO FAQPage block at all (an emitted FAQPage with
    // mainEntity: [] is forbidden — engines read it as a negative signal).
    const withoutFaqs = renderArticleHtml(
      geoSiteContext,
      makeGeoArticleRow(),
      articlePath,
    );
    expect(withoutFaqs).not.toContain("FAQPage");
  });

  it("T41.AC3 BreadcrumbList root-first with canonical-host URLs [cd api && npx vitest run test/json-ld-article.test.ts]", () => {
    const html = renderArticleHtml(
      geoSiteContext,
      makeGeoArticleRow(),
      articlePath,
    );
    const blocks = extractJsonLdBlocks(html);
    // §2 breadcrumbs: root-first ListItems, 1-indexed positions, absolute
    // canonical-host URLs.
    const breadcrumb = findByType(blocks, "BreadcrumbList")!;
    expect(breadcrumb).toBeDefined();
    const items = breadcrumb.itemListElement as Record<string, unknown>[];
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]!["@type"]).toBe("ListItem");
    expect(items[0]!.position).toBe(1);
    expect(items[0]!.name).toBe("Home");
    expect(items[0]!.item).toBe("https://acme.example/");
    const last = items[items.length - 1]!;
    expect(last.position).toBe(items.length);
    expect(last.name).toBe("Story one");
    expect(last.item).toBe(articleCanonical);
    for (const item of items) {
      expect(String(item.item).startsWith("https://acme.example/")).toBe(true);
    }
    // §5 canonical consistency: <head> canonical byte-equals the JSON-LD
    // @id / mainEntityOfPage.@id for the same page.
    expect(html).toContain(
      `<link rel="canonical" href="${articleCanonical}">`,
    );
    const article = findByType(blocks, "Article")!;
    expect(article["@id"]).toBe(articleCanonical);
    const mainEntityOfPage = article.mainEntityOfPage as Record<
      string,
      unknown
    >;
    expect(mainEntityOfPage["@id"]).toBe(articleCanonical);
    // §5 tenant boundary: the admin host is NEVER a content-page canonical.
    expect(html).not.toMatch(/cms\.kodigital\.app/);
  });

  it("GEO §1: FAQPage is forbidden on homepage / category / page routes", async () => {
    const home = await renderHomepageHtml(makeEmptyHomeDb(), geoSiteContext);
    const category = renderCategoryHtml(
      geoSiteContext,
      geoCategory,
      [makeGeoArticleRow()],
      1,
      "news",
    );
    const page = renderPageHtml(geoSiteContext, geoPage, "/about");
    expect(home).not.toContain("FAQPage");
    expect(category).not.toContain("FAQPage");
    expect(page).not.toContain("FAQPage");
  });

  it("GEO §2: category + page emit BreadcrumbList; homepage MUST NOT", async () => {
    const category = renderCategoryHtml(
      geoSiteContext,
      geoCategory,
      [makeGeoArticleRow()],
      1,
      "news",
    );
    const categoryCrumb = findByType(
      extractJsonLdBlocks(category),
      "BreadcrumbList",
    )!;
    expect(categoryCrumb).toBeDefined();
    const categoryItems = categoryCrumb.itemListElement as Record<
      string,
      unknown
    >[];
    expect(categoryItems[0]!.name).toBe("Home");
    expect(categoryItems[1]!.item).toBe("https://acme.example/category/news");
    const page = renderPageHtml(geoSiteContext, geoPage, "/about");
    const pageCrumb = findByType(extractJsonLdBlocks(page), "BreadcrumbList")!;
    expect(pageCrumb).toBeDefined();
    const pageItems = pageCrumb.itemListElement as Record<string, unknown>[];
    expect(pageItems[1]!.item).toBe("https://acme.example/about");
    // Homepage: a one-item breadcrumb chain is a negative signal.
    const home = await renderHomepageHtml(makeEmptyHomeDb(), geoSiteContext);
    expect(home).not.toContain("BreadcrumbList");
  });

  it("GEO §3: anonymous article sets author to the publisher Organization", () => {
    const html = renderArticleHtml(
      geoSiteContext,
      makeGeoArticleRow({ author_name: null }),
      articlePath,
    );
    const article = findByType(extractJsonLdBlocks(html), "Article")!;
    const author = article.author as Record<string, unknown>;
    expect(author["@type"]).toBe("Organization");
    expect(author.name).toBe("acme.example");
  });

  it("GEO §5: paginated category pages canonical to page 1", () => {
    const html = renderCategoryHtml(
      geoSiteContext,
      geoCategory,
      [makeGeoArticleRow()],
      2,
      "news",
    );
    expect(html).toContain(
      '<link rel="canonical" href="https://acme.example/category/news">',
    );
    expect(html).not.toContain("/category/news/page/2");
  });
});
