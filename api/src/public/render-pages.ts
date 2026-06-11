// T11: render helpers for public HTML routes. Composes the T8 SEO head +
// T9/T10 JSON-LD blocks + the underlying body into a complete HTML document
// so the router's cache pipeline can store fully-rendered pages.
//
// Tenant-boundary contract: every canonical URL is derived from the
// resolved SiteContext.hostname. The admin host MUST NEVER appear as a
// canonical href / og:url on a content page (mission RED LINE).

import type { ArticleRow } from "../db";
import type { PublicSiteContext } from "./middleware";
import type { PublicPageRow, PublicCategoryRow } from "./queries";
import { renderSeoHead, buildCanonicalUrl } from "./templates/seo-head";
import {
  renderArticleJsonLd,
  renderBreadcrumbJsonLd,
  renderFaqJsonLd,
} from "./templates/jsonld-article";
import { adaptBodyBlocks } from "./view-models/article";
import {
  renderHomeWebsiteJsonLd,
  renderHomeOrganizationJsonLd,
  renderHomeItemListJsonLd,
  renderCategoryJsonLd,
  renderWebPageJsonLd,
} from "./templates/jsonld-home-category-page";

function wrapHtmlDocument(headHtml: string, bodyHtml: string): string {
  return (
    `<!doctype html>\n<html><head>${headHtml}</head>` +
    `<body>${bodyHtml}</body></html>`
  );
}

function isoDate(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return new Date(0).toISOString();
  return new Date(seconds * 1000).toISOString();
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderHomepageHtml(
  siteContext: PublicSiteContext,
  articles: ArticleRow[],
): string {
  const path = "/";
  const canonicalUrl = buildCanonicalUrl(siteContext.hostname, path);
  const head = [
    renderSeoHead({
      canonicalHost: siteContext.hostname,
      path,
      title: siteContext.hostname,
      description: `Latest articles on ${siteContext.hostname}`,
      ogType: "website",
      siteName: siteContext.hostname,
    }),
    renderHomeWebsiteJsonLd({
      url: canonicalUrl,
      name: siteContext.hostname,
      searchRouteEnabled: false,
    }),
    renderHomeOrganizationJsonLd({
      url: canonicalUrl,
      name: siteContext.hostname,
    }),
    renderHomeItemListJsonLd({
      items: articles.map((a) => ({
        name: a.title,
        url: buildCanonicalUrl(siteContext.hostname, `/article/${a.slug}`),
      })),
      listName: `Articles on ${siteContext.hostname}`,
    }),
  ].join("\n");
  const articleList = articles
    .map(
      (a) =>
        `<article><a href="/article/${a.slug}">${escapeHtml(a.title)}</a></article>`,
    )
    .join("\n");
  // C4 root wrapper: data-screen-label names the decoded design-export
  // screen. UNQUOTED on purpose — the T9.AC2 contract grep matches the
  // literal `data-screen-label=theiwise-home` with no quote after `=`.
  const body = `<div data-screen-label=theiwise-home>${articleList}</div>`;
  return wrapHtmlDocument(head, body);
}

export function renderArticleHtml(
  siteContext: PublicSiteContext,
  row: ArticleRow,
  path: string,
): string {
  const canonicalUrl = buildCanonicalUrl(siteContext.hostname, path);
  // GEO checklist §1: FAQ blocks in content_json drive a FAQPage payload —
  // emitted ONLY when faqs is non-empty (empty FAQPage is a negative signal).
  const { faqs } = adaptBodyBlocks(row.content_json, row.content_html);
  const headBlocks = [
    renderSeoHead({
      canonicalHost: siteContext.hostname,
      path,
      title: row.title,
      ogType: "article",
      siteName: siteContext.hostname,
    }),
    renderArticleJsonLd({
      url: canonicalUrl,
      headline: row.title,
      datePublished: isoDate(row.published_at ?? row.created_at),
      dateModified: isoDate(row.updated_at ?? row.published_at),
      // GEO checklist §3: anonymous content sets author to the publisher
      // Organization — never a Person-typed placeholder, never omitted.
      authorName: row.author_name ?? siteContext.hostname,
      authorType: row.author_name ? "Person" : "Organization",
      publisherName: siteContext.hostname,
    }),
    // GEO checklist §2: every content route emits a root-first BreadcrumbList
    // with absolute canonical-host URLs. The category crumb belongs to the
    // joined view-model path (T13); this render layer has no category join.
    renderBreadcrumbJsonLd({
      items: [
        { name: "Home", url: buildCanonicalUrl(siteContext.hostname, "/") },
        { name: row.title, url: canonicalUrl },
      ],
    }),
  ];
  if (faqs.length > 0) {
    headBlocks.push(renderFaqJsonLd({ questions: faqs }));
  }
  // C4 root wrapper (see renderHomepageHtml): article screen label.
  const body = `<div data-screen-label=article-page>${row.content_html ?? ""}</div>`;
  return wrapHtmlDocument(headBlocks.join("\n"), body);
}

export function renderCategoryHtml(
  siteContext: PublicSiteContext,
  cat: PublicCategoryRow,
  articles: ArticleRow[],
  pageNum: number,
  slug: string,
): string {
  // Paginated category pages canonical to page 1 (no duplicate-content signal).
  const canonicalPath = `/category/${slug}`;
  const canonicalUrl = buildCanonicalUrl(siteContext.hostname, canonicalPath);
  const articleEntries = articles.map((a) => ({
    name: a.title,
    url: buildCanonicalUrl(siteContext.hostname, `/article/${a.slug}`),
  }));
  const head = [
    renderSeoHead({
      canonicalHost: siteContext.hostname,
      path: canonicalPath,
      title: cat.name,
      canonicalUrl,
      ogType: "website",
      siteName: siteContext.hostname,
    }),
    renderCategoryJsonLd({
      url: canonicalUrl,
      name: cat.name,
      articles: articleEntries,
    }),
    // GEO checklist §2: content routes emit a root-first BreadcrumbList.
    renderBreadcrumbJsonLd({
      items: [
        { name: "Home", url: buildCanonicalUrl(siteContext.hostname, "/") },
        { name: cat.name, url: canonicalUrl },
      ],
    }),
  ].join("\n");
  const body =
    `<h1>${escapeHtml(cat.name)}</h1>` +
    `<div data-page="${pageNum}">` +
    articleEntries
      .map((e) => `<a href="${e.url}">${escapeHtml(e.name)}</a>`)
      .join("") +
    `</div>`;
  return wrapHtmlDocument(head, body);
}

export function renderPageHtml(
  siteContext: PublicSiteContext,
  row: PublicPageRow,
  path: string,
): string {
  const canonicalUrl = buildCanonicalUrl(siteContext.hostname, path);
  const head = [
    renderSeoHead({
      canonicalHost: siteContext.hostname,
      path,
      title: row.title,
      ogType: "website",
      siteName: siteContext.hostname,
    }),
    renderWebPageJsonLd({
      url: canonicalUrl,
      name: row.title,
      dateModified: row.updated_at ? isoDate(row.updated_at) : undefined,
    }),
    // GEO checklist §2: content routes emit a root-first BreadcrumbList.
    renderBreadcrumbJsonLd({
      items: [
        { name: "Home", url: buildCanonicalUrl(siteContext.hostname, "/") },
        { name: row.title, url: canonicalUrl },
      ],
    }),
  ].join("\n");
  return wrapHtmlDocument(head, row.content_html ?? "");
}
