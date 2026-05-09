// Sitemap.xml plus the static text feeds (robots.txt, ads.txt) for
// kodigital-homepages-cms. The sitemap is built from the same published
// articles list that drives feed.xml/atom.xml plus the published pages
// table; canonical absolute URLs are constructed from `baseUrl` so the
// sitemap is portable across staging/production hosts.

import type { ArticleRow } from "../db";
import { xmlEscape } from "./feeds";

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

export function buildRobotsTxt(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return [
    "User-agent: *",
    "Disallow: /admin/",
    "Disallow: /preview/",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");
}

// Phase 1 default — empty placeholder. Operators will overwrite this via
// site_settings.ads_txt once advertising integration ships.
export const ADS_TXT_DEFAULT = "# placeholder ads.txt — no ad-network entries configured\n";
