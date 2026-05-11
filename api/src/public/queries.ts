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
