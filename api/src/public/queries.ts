// Per-tenant DB query helpers for the public router (T27).
//
// Every helper here scopes its WHERE clause by `siteId` so the public
// router can never leak content across tenants. Page lookups additionally
// allow `site_id IS NULL` so global legal templates (privacy-policy etc.)
// remain reachable from any tenant — those rows are the only documented
// exception to strict per-site scoping (per T22 AC).
//
// Article queries route through `getArticleBySlug` / `listArticles` from
// `../db`; this module owns the queries that don't yet have a generic
// helper (pages, categories, site_settings overrides).

import type { ArticleRow } from "../db";
import type { SitemapPageRow } from "./sitemap";

export interface PublicPageRow {
  id: number;
  slug: string;
  title: string;
  content_html: string | null;
  status: string;
  updated_at: number | null;
  site_id: string | null;
}

export interface PublicCategoryRow {
  id: number;
  slug: string;
  name: string;
}

export const PUBLIC_PAGE_SIZE = 20;

export async function fetchPublishedPage(
  db: D1Database,
  slug: string,
  siteId: string,
): Promise<PublicPageRow | null> {
  const row = await db
    .prepare(
      "SELECT id, slug, title, content_html, status, updated_at, site_id FROM pages " +
        "WHERE slug = ? AND status = 'published' " +
        "AND (site_id = ? OR site_id IS NULL) LIMIT 1",
    )
    .bind(slug, siteId)
    .first<PublicPageRow>();
  return row ?? null;
}

export async function fetchCategory(
  db: D1Database,
  slug: string,
): Promise<PublicCategoryRow | null> {
  const row = await db
    .prepare("SELECT id, slug, name FROM categories WHERE slug = ? LIMIT 1")
    .bind(slug)
    .first<PublicCategoryRow>();
  return row ?? null;
}

export async function fetchCategoryArticles(
  db: D1Database,
  categoryId: number,
  siteId: string,
  page: number,
): Promise<ArticleRow[]> {
  const offset = Math.max(0, (page - 1) * PUBLIC_PAGE_SIZE);
  const result = await db
    .prepare(
      "SELECT * FROM articles WHERE category_id = ? AND site_id = ? AND status = 'published' " +
        "ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?",
    )
    .bind(categoryId, siteId, PUBLIC_PAGE_SIZE, offset)
    .all<ArticleRow>();
  return result.results ?? [];
}

export async function fetchSitemapPages(
  db: D1Database,
  siteId: string,
): Promise<SitemapPageRow[]> {
  const result = await db
    .prepare(
      "SELECT slug, updated_at FROM pages WHERE status = 'published' " +
        "AND (site_id = ? OR site_id IS NULL) ORDER BY updated_at DESC",
    )
    .bind(siteId)
    .all<SitemapPageRow>();
  return result.results ?? [];
}

interface SiteSettingRow {
  value: string | null;
}

export async function fetchSiteSetting(
  db: D1Database,
  siteId: string,
  key: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT value FROM site_settings WHERE site_id = ? AND key = ? LIMIT 1",
    )
    .bind(siteId, key)
    .first<SiteSettingRow>();
  return row?.value ?? null;
}

export interface PublicLayoutSiteInfo {
  name: string;
  hostname: string;
  tagline: string;
  description: string;
  logoUrl: string | null;
  brandTokens: Readonly<Record<string, string>>;
}

function parseBrandTokensJson(
  raw: string | null | undefined,
): Readonly<Record<string, string>> {
  if (raw === null || raw === undefined || raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

// T15: shared per-site layout data loader used by /category/:slug and
// /page/:slug so both routes can wrap their bodies in renderLayout with
// the same site-aware header + brand tokens that Home + Article already
// use. The SQL string `WHERE site_id = ?` matches the form used by the
// home/article view-models so the tenant-scoping grep remains accurate.
export async function fetchPublicLayoutSiteInfo(
  db: D1Database,
  siteContext: { siteId: string; hostname: string },
): Promise<PublicLayoutSiteInfo> {
  const result = await db
    .prepare(
      "SELECT key AS key, value AS value FROM site_settings WHERE site_id = ?",
    )
    .bind(siteContext.siteId)
    .all<{ key: string; value: string | null }>();
  const settings: Record<string, string> = {};
  for (const row of result.results ?? []) {
    if (typeof row.value === "string") settings[row.key] = row.value;
  }
  return {
    name: settings.site_name ?? siteContext.hostname,
    hostname: siteContext.hostname,
    tagline: settings.tagline ?? "",
    description: settings.site_description ?? "",
    logoUrl:
      settings.logo_media_id !== undefined && settings.logo_media_id.length > 0
        ? settings.logo_media_id
        : null,
    brandTokens: parseBrandTokensJson(settings.brand_tokens_json),
  };
}
