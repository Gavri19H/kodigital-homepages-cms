// RSS 2.0 and Atom 1.0 feed serializers for kodigital-homepages-cms.
//
// Feeds are derived directly from the published-articles list — no caching
// at this layer (the public router calls cacheGet/cacheSet around these
// helpers and invalidateFeeds wipes the cache entries on publish).
//
// All user-supplied content (title, slug, summary) is XML-escaped via
// `xmlEscape` before interpolation. The function is hand-rolled (no
// 3rd-party XML lib) because Workers runtime + bundle-size discipline.
//
// T27 (Phase 3): the caller in api/src/public/router.ts always pre-filters
// articles by `siteContext.siteId` via `listArticles(..., { siteId })`
// before passing them here, so the article list this module receives is
// guaranteed to be a single tenant's published rows — no cross-site leak
// at the serializer layer. `FeedSiteInfo.baseUrl` is the tenant's host so
// every <link> / <id> URL is scoped to that site.

import type { ArticleRow } from "../db";
import type { PublicSiteContext } from "./middleware";

export interface FeedSiteInfo {
  baseUrl: string;
  title: string;
  description: string;
}

// T27: convenience builder used by tests + alternate callers — derives a
// FeedSiteInfo from a SiteContext (specifically `siteContext.siteId`'s
// canonical hostname / vertical). Kept here so router.ts and any future
// caller can construct the feed envelope from the SiteContext without
// re-implementing the URL composition rule.
export function feedSiteInfoFromContext(
  siteContext: PublicSiteContext,
): FeedSiteInfo {
  return {
    baseUrl: `https://${siteContext.hostname}`,
    title: siteContext.hostname,
    description: `Articles for ${siteContext.hostname} (site=${siteContext.siteId})`,
  };
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function articleUrl(baseUrl: string, slug: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/article/${encodeURIComponent(slug)}`;
}

function rfc2822(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toUTCString();
}

function iso8601(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

function summarize(article: ArticleRow, max = 280): string {
  const html = article.content_html ?? "";
  const text = html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export function renderRssFeed(
  articles: ArticleRow[],
  site: FeedSiteInfo,
): string {
  const channelTitle = xmlEscape(site.title);
  const channelLink = xmlEscape(site.baseUrl);
  const channelDescription = xmlEscape(site.description);
  const lastBuild = rfc2822(Math.floor(Date.now() / 1000));

  const items = articles.map((a) => {
    const url = articleUrl(site.baseUrl, a.slug);
    const pub = a.published_at ?? a.updated_at ?? a.created_at;
    return [
      "    <item>",
      `      <title>${xmlEscape(a.title)}</title>`,
      `      <link>${xmlEscape(url)}</link>`,
      `      <guid isPermaLink="true">${xmlEscape(url)}</guid>`,
      `      <pubDate>${rfc2822(pub)}</pubDate>`,
      `      <description>${xmlEscape(summarize(a))}</description>`,
      "    </item>",
    ].join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${channelTitle}</title>`,
    `    <link>${channelLink}</link>`,
    `    <description>${channelDescription}</description>`,
    `    <lastBuildDate>${lastBuild}</lastBuildDate>`,
    ...items,
    "  </channel>",
    "</rss>",
  ].join("\n");
}

export function renderAtomFeed(
  articles: ArticleRow[],
  site: FeedSiteInfo,
): string {
  const feedTitle = xmlEscape(site.title);
  const feedSubtitle = xmlEscape(site.description);
  const baseUrl = site.baseUrl.replace(/\/+$/, "");
  const selfUrl = xmlEscape(`${baseUrl}/atom.xml`);
  const homeUrl = xmlEscape(baseUrl);
  const updated = iso8601(
    articles[0]?.published_at ??
      articles[0]?.updated_at ??
      Math.floor(Date.now() / 1000),
  );

  const entries = articles.map((a) => {
    const url = articleUrl(baseUrl, a.slug);
    const pub = a.published_at ?? a.updated_at ?? a.created_at;
    return [
      "  <entry>",
      `    <id>${xmlEscape(url)}</id>`,
      `    <title>${xmlEscape(a.title)}</title>`,
      `    <link href="${xmlEscape(url)}"/>`,
      `    <updated>${iso8601(pub)}</updated>`,
      `    <summary>${xmlEscape(summarize(a))}</summary>`,
      "  </entry>",
    ].join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${feedTitle}</title>`,
    `  <subtitle>${feedSubtitle}</subtitle>`,
    `  <id>${homeUrl}</id>`,
    `  <link href="${homeUrl}"/>`,
    `  <link rel="self" href="${selfUrl}"/>`,
    `  <updated>${updated}</updated>`,
    ...entries,
    "</feed>",
  ].join("\n");
}
