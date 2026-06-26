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

export interface RobotsOptions {
  // Opt-in (wired from the `ai_block_training` site setting) — append a named
  // Disallow group per training-only crawler. Default false: non-destructive.
  blockTrainingCrawlers?: boolean;
}

// AI crawlers that harvest TRAINING data only (no live citation / referral
// value). Google-Extended + Applebot-Extended are training opt-out TOKENS, not
// crawlers: blocking them drops the site from Gemini / Apple model training
// while KEEPING it in Google / Apple search.
const TRAINING_ONLY_CRAWLERS: ReadonlyArray<string> = [
  "GPTBot",
  "ClaudeBot",
  "CCBot",
  "Bytespider",
  "meta-externalagent",
  "Google-Extended",
  "Applebot-Extended",
];

// T27 + rescue-6 (agent-readiness M1.1): the default body keeps the explicit
// Allow:/ + Disallow:/api //admin //preview directives AND adds a Content
// Signals preference line (contentsignals.org): search indexing + AI
// live-answer retrieval are welcome (they cite us -> referral + ad/affiliate
// revenue); AI model TRAINING is declined. The signal is a stated preference,
// not enforcement (honest crawlers honor it). A hard per-crawler block of the
// training bots is the opt-in `blockTrainingCrawlers`. Named ALLOW groups are
// deliberately NOT emitted: a named group makes that bot IGNORE the
// `User-agent: *` group, which would leak /admin //preview //api to it — the
// wildcard already allows the search bots, so Content-Signal states intent.
export function buildRobotsTxt(baseUrl: string, opts: RobotsOptions = {}): string {
  const base = baseUrl.replace(/\/+$/, "");
  const lines: string[] = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin/",
    "Disallow: /preview/",
    "Disallow: /api",
    "Content-Signal: search=yes, ai-input=yes, ai-train=no",
  ];
  if (opts.blockTrainingCrawlers === true) {
    for (const bot of TRAINING_ONLY_CRAWLERS) {
      lines.push("", `User-agent: ${bot}`, "Disallow: /");
    }
  }
  lines.push("", `Sitemap: ${base}/sitemap.xml`, "");
  return lines.join("\n");
}

// Phase 1 default — empty placeholder. Operators will overwrite this via
// site_settings.ads_txt once advertising integration ships.
export const ADS_TXT_DEFAULT = "# placeholder ads.txt — no ad-network entries configured\n";


// rescue-6 (agent-readiness M1/M2): /llms.txt body — a plain-markdown briefing
// for AI agents (llmstxt.org structure: H1 name, blockquote summary, H2 link
// sections). Built from the resolved site info. NOTE: most crawlers do not
// fetch this today (it is a low-cost hedge); the request observability can
// measure whether anything actually reads it.
export function buildLlmsTxt(args: {
  siteName: string;
  tagline?: string | null;
  description?: string | null;
  baseUrl: string;
}): string {
  const base = args.baseUrl.replace(/\/+$/, "");
  const desc = args.description && args.description.trim().length > 0
    ? args.description.trim()
    : null;
  const tag = args.tagline && args.tagline.trim().length > 0
    ? args.tagline.trim()
    : null;
  const summary = desc ?? tag ?? `${args.siteName}: articles and guides.`;
  return [
    `# ${args.siteName}`,
    "",
    `> ${summary}`,
    "",
    "## Site",
    "",
    `- [Home](${base}/): the homepage`,
    `- [Sitemap](${base}/sitemap.xml): every indexable URL`,
    `- [RSS feed](${base}/feed.xml): the latest articles`,
    "",
  ].join("\n");
}
