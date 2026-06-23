// homefix6 round-3 — FINAL production contract coverage.
//
// These tests lock the round-3 production changes (already shipped in src/)
// against regression. They are pure-transform / render-output behavioural
// assertions (renderCategoryHtml / renderArticle / buildArticleViewModel +
// the served publicCss string) — the same DB-stub + pure-render pattern the
// rest of the public-template suite uses. No assertion here is weakened: each
// adds NEW positive coverage for a round-3 contract change.
//
// Coverage:
//   (a) renderCategoryHtml renders the joined feature image as a /media/-prefixed
//       <img> AND a clean "Mon DD, YYYY" card date — never a raw ISO timestamp.
//   (b) the editor's-pick affiliate block renders `affiliate-card--noimg` with
//       NO `.affiliate-img` / `.ph` placeholder.
//   (c) buildArticleViewModel sets article.subtitle from articleRow.subtitle when
//       present, and falls back to the body excerpt when subtitle is null; the
//       article template renders it inside `<p class="article-subtitle">`.
//   (d) public-css.ts carries the legal `.page-article` reading column +
//       `.page-content h2`, the `overflow-x: hidden` body guard, and
//       `.affiliate-card--noimg` + a mobile `@media (max-width: 600px)` affiliate
//       stacking rule.

import { describe, it, expect } from "vitest";
import { renderCategoryHtml } from "../src/public/render-pages";
import { renderArticle } from "../src/public/templates/article";
import { buildArticleViewModel } from "../src/public/view-models/article";
import { publicCss } from "../src/public/assets/public-css";
import type { PublicSiteContext } from "../src/public/middleware";
import type { PublicCategoryRow, ArticleCardRow } from "../src/public/queries";
import type {
  ArticleViewModel,
  BodyBlock,
} from "../src/public/view-models/article";
import type { ArticleRow } from "../src/db";

// Minimal settings DB: fetchPublicLayoutSiteInfo / loadCustomLayoutHtml /
// loadAdsConfig all read site_settings via `.all()`; everything else returns
// empty so the render uses the design-system defaults.
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

const SITE_CONTEXT = {
  siteId: "site_round3",
  hostname: "round3.example",
} as unknown as PublicSiteContext;

const SETTINGS = [
  { key: "site_name", value: "Round Three Daily" },
  { key: "site_description", value: "Round Three covers the contract." },
  { key: "brand_tokens_json", value: JSON.stringify({ "tw-brand": "#1ba8c8" }) },
];

// ---------------------------------------------------------------------------
// (a) renderCategoryHtml: joined feature image -> /media/ <img> + clean date.
// ---------------------------------------------------------------------------
describe("round-3 (a): renderCategoryHtml renders the joined media image + a clean card date", () => {
  it("emits a /media/-prefixed <img> for the joined storage_key and a 'Mon DD, YYYY' card date, never a raw ISO timestamp", async () => {
    // published_at: 2026-06-27 12:51:36 UTC — the exact value that used to leak
    // as "2026-06-27T12:51:36.000Z" before formatCardDate cleaned it.
    const PUBLISHED_AT = 1782564696; // 2026-06-27T12:51:36Z
    const article = {
      id: 11,
      slug: "first-card",
      title: "First Card Story",
      status: "published",
      published_at: PUBLISHED_AT,
      // ArticleCardRow: the LEFT JOIN media surfaces storage_key as image_url.
      featured_image_id: 5,
      image_url: "img/first-card.jpg", // bare storage_key (mediaUrl prefixes /media/)
      image_alt: "First card hero",
    } as unknown as ArticleCardRow;

    const cat: PublicCategoryRow = { id: 3, slug: "news", name: "News" };
    const html = await renderCategoryHtml(
      makeSettingsDb(SETTINGS),
      SITE_CONTEXT,
      cat,
      [article],
      1,
      "news",
    );

    // The card renders a REAL image through the /media/ route (not the bare
    // teal-gradient .ph placeholder) — the storage_key is /media/-prefixed.
    expect(html).toContain('src="/media/img/first-card.jpg"');
    expect(html).toContain('alt="First card hero"');

    // The byline date is the clean human form (formatCardDate: UTC month table).
    expect(html).toContain("Jun 27, 2026");

    // NEGATIVE: the raw ISO timestamp must never leak into the card.
    expect(html).not.toMatch(/20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(html).not.toContain("2026-06-27T12:51:36.000Z");
  });
});

// ---------------------------------------------------------------------------
// (b) editor's-pick affiliate block -> affiliate-card--noimg, no img / .ph.
// ---------------------------------------------------------------------------

function makeArticleVm(body: BodyBlock[]): ArticleViewModel {
  return {
    site: {
      site_id: "site_round3",
      name: "Round Three Daily",
      hostname: "round3.example",
      tagline: "Tomorrow's news today",
      description: "Round Three covers the contract.",
      logoUrl: null,
      brandTokens: { "tw-brand": "#1ba8c8" },
    },
    article: {
      id: 7,
      slug: "the-pick",
      title: "The Pick",
      excerpt: "An excerpt for the pick story.",
      href: "/article/the-pick",
      dateline: "Jun 23, 2026 · 4 min read",
      publishedAt: "2026-06-23T10:00:00.000Z",
      publishedAtDisplay: "Jun 23, 2026",
      updatedAt: "2026-06-23T11:00:00.000Z",
      readMinutes: 4,
      readMinutesDisplay: "4 min read",
      author: { name: "Jamie Reporter" },
      imageUrl: "/media/the-pick.jpg",
      imageAlt: "Hero illustration",
      categoryName: "Tech",
      categorySlug: "tech",
      categoryHref: "/category/tech",
      body,
      contentText: "An excerpt for the pick story.",
    },
    breadcrumb: [
      { name: "Home", url: "/" },
      { name: "The Pick", url: "/article/the-pick" },
    ],
    faqs: [],
    related: [],
    meta: {
      title: "The Pick — Round Three Daily",
      description: "An excerpt for the pick story.",
      canonicalUrl: "https://round3.example/article/the-pick",
      ogImage: "/media/the-pick.jpg",
      publishedAt: "2026-06-23T10:00:00.000Z",
      modifiedAt: "2026-06-23T11:00:00.000Z",
    },
  };
}

describe("round-3 (b): editor's-pick affiliate block is image-less", () => {
  it("renders affiliate-card--noimg with NO .affiliate-img and NO .ph placeholder inside the affiliate block", () => {
    // url:null -> the design's non-link Editor's pick card (the eyebrow names it).
    const body: BodyBlock[] = [
      {
        type: "affiliate",
        title: "Best Widget",
        description: "Why we like it.",
        url: null,
        cta: "Why we recommend it",
      } as unknown as BodyBlock,
    ];
    const html = renderArticle({ vm: makeArticleVm(body), emitJsonLd: false });

    // The image-less card (a <div> here because url is null).
    expect(html).toContain('<div class="affiliate-card affiliate-card--noimg">');
    expect(html).toContain('<span class="affiliate-eyebrow">Editor\'s pick</span>');
    expect(html).toContain("<h4>Best Widget</h4>");
    expect(html).toContain(
      '<span class="affiliate-cta">Why we recommend it →</span>',
    );

    // NEGATIVE: no image column / placeholder in the affiliate markup.
    expect(html).not.toContain('class="affiliate-img"');
    // Isolate the affiliate fragment and assert it carries no `.ph` placeholder
    // (the hero may legitimately render a .ph elsewhere on the page).
    const start = html.indexOf("affiliate-card--noimg");
    const slice = html.slice(start, start + 400);
    expect(slice).not.toContain('class="ph"');
  });

  it("with a safe url, the whole card is the sponsored/nofollow <a> and still image-less", () => {
    const body: BodyBlock[] = [
      {
        type: "affiliate",
        title: "Linked Widget",
        description: "A linked recommendation.",
        url: "https://shop.example/widget",
        cta: "Shop",
      } as unknown as BodyBlock,
    ];
    const html = renderArticle({ vm: makeArticleVm(body), emitJsonLd: false });
    expect(html).toContain(
      '<a class="affiliate-card affiliate-card--noimg" href="https://shop.example/widget" target="_blank" rel="sponsored nofollow noopener">',
    );
    expect(html).not.toContain('class="affiliate-img"');
  });
});

// ---------------------------------------------------------------------------
// (c) buildArticleViewModel.subtitle: from row when present, excerpt fallback;
//     article template renders it inside <p class="article-subtitle">.
// ---------------------------------------------------------------------------

// Article-detail DB: drives buildArticleViewModel's two queries (the detail row
// + the related listing). The detail row carries the `subtitle` column added by
// migration 0027. The related query returns an empty set.
function makeArticleDetailDb(subtitle: string | null): D1Database {
  const detailRow = {
    id: 9,
    slug: "subtitle-story",
    title: "Subtitle Story",
    content_json: null,
    content_html:
      "<p>The opening paragraph is long enough to compute a body excerpt for the fallback path.</p>",
    category_id: 4,
    status: "published",
    published_at: 1782564696,
    updated_at: 1782568296,
    author_name: "Jamie Reporter",
    featured_image_id: null,
    is_featured: 0,
    site_id: "site_round3",
    category_name: "Tech",
    category_slug: "tech",
    image_url: null,
    image_alt: null,
    seo_title: null,
    seo_description: null,
    subtitle,
  };
  return {
    prepare(sql: string) {
      const stmt = {
        bind() {
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          // The article-detail query selects `a.subtitle AS subtitle`.
          if (sql.includes("a.subtitle AS subtitle")) {
            return detailRow as unknown as T;
          }
          return null;
        },
        async all<T = unknown>() {
          // Related listing: none for this fixture.
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

describe("round-3 (c): buildArticleViewModel.subtitle + article-subtitle render", () => {
  it("sets article.subtitle from articleRow.subtitle when present, and the template renders it inside <p class=article-subtitle>", async () => {
    const vm = await buildArticleViewModel(makeArticleDetailDb("A crisp teaser line."), {
      slug: "subtitle-story",
      siteContext: { siteId: "site_round3", hostname: "round3.example" },
    });
    expect(vm).not.toBeNull();
    expect(vm!.article.subtitle).toBe("A crisp teaser line.");

    const html = renderArticle({ vm: vm!, emitJsonLd: false });
    expect(html).toContain('<p class="article-subtitle">A crisp teaser line.</p>');
  });

  it("falls back to the body excerpt when articleRow.subtitle is null", async () => {
    const vm = await buildArticleViewModel(makeArticleDetailDb(null), {
      slug: "subtitle-story",
      siteContext: { siteId: "site_round3", hostname: "round3.example" },
    });
    expect(vm).not.toBeNull();
    // The view model never leaves subtitle null — it falls back to the excerpt.
    expect(vm!.article.subtitle).toBe(vm!.article.excerpt);
    expect((vm!.article.subtitle ?? "").length).toBeGreaterThan(0);

    // The template renders the fallback subtitle inside the article-subtitle <p>.
    const html = renderArticle({ vm: vm!, emitJsonLd: false });
    expect(html).toContain('<p class="article-subtitle">');
    expect(html).toContain(vm!.article.excerpt);
  });
});

// ---------------------------------------------------------------------------
// (d) public-css.ts carries the round-3 layout/affiliate rules.
// ---------------------------------------------------------------------------
describe("round-3 (d): public-css.ts carries the round-3 layout + affiliate rules", () => {
  it("carries the legal reading-column (.page-article) + .page-content h2 rules", () => {
    // Centered narrow reading column for the legal/static pages (issue 2).
    expect(publicCss).toMatch(/\.page-article \{[^}]*max-width: 760px;[^}]*margin: 0 auto/);
    // The legal page heading rhythm.
    expect(publicCss).toContain(".page-content h2 {");
  });

  it("carries the overflow-x: hidden body guard", () => {
    // Body/html overflow-x guard (no horizontal scroll on mobile).
    expect(publicCss).toContain("overflow-x: hidden;");
  });

  it("carries .affiliate-card--noimg + a mobile @media (max-width: 600px) affiliate stacking rule", () => {
    expect(publicCss).toContain(".affiliate-card--noimg {");
    // The mobile breakpoint stacks the affiliate card(s) into a single column.
    expect(publicCss).toMatch(
      /@media \(max-width: 600px\) \{[^}]*\.affiliate-card--noimg \{[^}]*grid-template-columns: 1fr/,
    );
  });
});
