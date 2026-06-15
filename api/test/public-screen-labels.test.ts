// T9 (C4): every public screen's ROOT WRAPPER carries a data-screen-label
// attribute naming the decoded design-export screen — Home → theiwise-home,
// Article → article-page (T9.AC1).
//
// The label is render metadata, not visible brand copy: the no-brand
// regression (public-no-theiwise-brand-render) strips data-screen-label
// attributes before its banned-token sweep, so `theiwise-home` never trips
// the /theiwise/i ban (BCL-047).
//
// Four render surfaces are asserted: the full-document renderers
// renderHomepageHtml / renderArticleHtml (render-pages.ts, what the public
// router caches) and the design templates renderHome / renderArticle
// (templates/, what the C-series design contract styles).

import { describe, it, expect } from "vitest";
import {
  renderHomepageHtml,
  renderArticleHtml,
} from "../src/public/render-pages";
import { renderHome } from "../src/public/templates/home";
import { renderArticle } from "../src/public/templates/article";
import type { PublicSiteContext } from "../src/public/middleware";
import type { HomeViewModel } from "../src/public/view-models/home";
import type { ArticleViewModel } from "../src/public/view-models/article";

// The contract form is UNQUOTED (T9.AC2 grep matches the literal
// `data-screen-label=theiwise-home` with no quote after `=`).
const HOME_LABEL = "data-screen-label=theiwise-home";
const ARTICLE_LABEL = "data-screen-label=article-page";

const siteContext: PublicSiteContext = {
  site_id: "site-acme",
  siteId: "site-acme",
  hostname: "acme.example",
  vertical_slug: "news",
  status: "active",
  content_version: 1,
  settings_version: 1,
};

// T1 (rescue-3): renderHomepageHtml is now db-fed (composes
// buildHomeViewModel). A minimal D1 stub whose every listing query returns
// no rows is enough to exercise the screen-label wrapper — the design
// shell renders all 13 sections with empty buckets.
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

// T2 (rescue-3): renderArticleHtml is now db-fed (it composes
// buildArticleViewModel). A D1 stub whose article-detail query returns one
// published article (with a category + author) and whose related/settings
// listings return no rows is enough to exercise the design article shell and
// its screen-label wrapper.
function makeArticleDb(): D1Database {
  const detailRow = {
    id: 1,
    slug: "story-one",
    title: "Story one",
    content_json: null,
    content_html: "<p>Opening paragraph.</p>",
    category_id: 5,
    status: "published",
    published_at: 1747562400,
    updated_at: 1747562400,
    author_name: "Jamie Reporter",
    featured_image_id: null,
    is_featured: 0,
    site_id: "site-acme",
    category_name: "Tech",
    category_slug: "tech",
    image_url: null,
    image_alt: null,
    seo_title: null,
    seo_description: null,
  };
  const stmt = {
    bind() {
      return stmt;
    },
    async first() {
      return detailRow;
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

function makeHomeVm(): HomeViewModel {
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
    hero: null,
    featured: [],
    picks: [],
    trending: [],
    latest: [],
    categories: [],
    newsletter: {
      heading: "Acme Daily newsletter",
      description: "Get the brief in your inbox.",
      provider: null,
    },
    meta: {
      title: "Acme Daily — Tomorrow's news today",
      description: "Acme Daily covers technology, world, and culture.",
      canonicalUrl: "https://acme.example/",
    },
  };
}

function makeArticleVm(): ArticleViewModel {
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
      body: [{ type: "html", html: "<p>Opening paragraph of the story.</p>" }],
      contentText: "Opening paragraph of the story.",
    },
    breadcrumb: [
      { name: "Home", url: "/" },
      { name: "The Feature That Mattered", url: "/article/the-feature" },
    ],
    faqs: [],
    related: [
      {
        id: 2,
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
      },
    ],
    meta: {
      title: "The Feature That Mattered — Acme Daily",
      description: "A look at the new feature.",
      canonicalUrl: "https://acme.example/article/the-feature",
      ogImage: "/media/feature.jpg",
      publishedAt: "2026-05-18T10:00:00.000Z",
      modifiedAt: "2026-05-18T11:00:00.000Z",
    },
  };
}

describe("public-screen-labels", () => {
  it("renderHomepageHtml — home document wraps the design body in data-screen-label=theiwise-home", async () => {
    const html = await renderHomepageHtml(makeEmptyHomeDb(), siteContext);
    expect(html).toContain(HOME_LABEL);
    // T1 (rescue-3): the screen-label wrapper now opens the design shell's
    // <main> content region (renderLayout wraps renderHome's body), no
    // longer the bare <body><div> fallback.
    expect(html).toContain(`<main id="main-content"><div ${HOME_LABEL}>`);
    expect(html).toContain("theiwise-home");
  });

  it("renderArticleHtml — article document opens the design-shell wrapper with data-screen-label=article-page", async () => {
    const html = await renderArticleHtml(makeArticleDb(), siteContext, "story-one");
    expect(html).toContain(ARTICLE_LABEL);
    // T2 (rescue-3): the screen-label wrapper now opens the design shell's
    // <main> content region (renderLayout wraps renderArticle's body), no
    // longer the bare <body><div> fallback.
    expect(html).toContain(`<main id="main-content"><div ${ARTICLE_LABEL}>`);
    expect(html).toContain("article-page");
  });

  it("renderHome — design-template fragment is rooted in data-screen-label=theiwise-home", () => {
    const html = renderHome({ vm: makeHomeVm() });
    expect(html.startsWith(`<div ${HOME_LABEL}>`)).toBe(true);
    expect(html.trimEnd().endsWith("</div>")).toBe(true);
  });

  it("renderArticle — design-template fragment is rooted in data-screen-label=article-page", () => {
    const html = renderArticle({ vm: makeArticleVm() });
    expect(html.startsWith(`<div ${ARTICLE_LABEL}>`)).toBe(true);
    expect(html.trimEnd().endsWith("</div>")).toBe(true);
  });
});
