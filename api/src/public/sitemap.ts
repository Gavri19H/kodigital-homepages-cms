// Sitemap.xml plus the static text feeds (robots.txt, ads.txt) for
// kodigital-homepages-cms. The sitemap is built from the same published
// articles list that drives feed.xml/atom.xml plus the published pages
// table; canonical absolute URLs are constructed from `baseUrl` so the
// sitemap is portable across staging/production hosts.
//
// T27 (Phase 3): the caller in api/src/public/router.ts pre-filters both
// `articles` and `pages` by `siteContext.siteId` before invoking
// renderSitemap, so the URL set this module emits is guaranteed to be one
// tenant's content (no cross-site leak in sitemap.xml). The same scoping
// applies to robots.txt (per-site override stored on site_settings) — the
// router resolves `siteContext.siteId`'s row and falls back to
// `buildRobotsTxt(baseUrl)` only when no per-site override exists.

import type { ArticleRow } from "../db";
import { xmlEscape } from "./feeds";
import type { PublicSiteContext } from "./middleware";

export interface SitemapPageRow {
  slug: string;
  updated_at: number | null;
}

export interface SitemapInput {
  baseUrl: string;
  articles: ArticleRow[];
  pages: SitemapPageRow[];
}

function iso8601(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

function urlEntry(loc: string, lastmod: string): string {
  return [
    "  <url>",
    `    <loc>${xmlEscape(loc)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
    "  </url>",
  ].join("\n");
}

export function renderSitemap(input: SitemapInput): string {
  const base = input.baseUrl.replace(/\/+$/, "");
  const now = Math.floor(Date.now() / 1000);

  const homeEntry = urlEntry(`${base}/`, iso8601(now));

  const articleEntries = input.articles.map((a) => {
    const lastmod = iso8601(a.updated_at ?? a.published_at ?? a.created_at);
    return urlEntry(`${base}/article/${encodeURIComponent(a.slug)}`, lastmod);
  });

  const pageEntries = input.pages.map((p) => {
    const lastmod = iso8601(p.updated_at ?? now);
    return urlEntry(`${base}/page/${encodeURIComponent(p.slug)}`, lastmod);
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    homeEntry,
    ...articleEntries,
    ...pageEntries,
    "</urlset>",
  ].join("\n");
}

// T27: convenience builder — derives sitemap baseUrl from a SiteContext.
// Equivalent to `https://${siteContext.hostname}`; the explicit helper
// keeps the per-site URL composition rule in one place so router.ts and
// future callers do not redefine `siteContext.siteId` → URL composition
// per call site.
export function sitemapBaseUrlForSite(siteContext: PublicSiteContext): string {
  return `https://${siteContext.hostname}`;
}

// T27 (BCL-049): the default robots body MUST explicitly Allow the public
// surface and Disallow the JSON API. Crawlers index every public route by
// default, but `Allow: /` makes the public-content intent explicit and
// `Disallow: /api` keeps the headless API endpoints out of the index
// alongside the existing /admin/ + /preview/ refusals.
export function buildRobotsTxt(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin/",
    "Disallow: /preview/",
    "Disallow: /api",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");
}

// Phase 1 default — empty placeholder. Operators will overwrite this via
// site_settings.ads_txt once advertising integration ships.
export const ADS_TXT_DEFAULT = "# placeholder ads.txt — no ad-network entries configured\n";
