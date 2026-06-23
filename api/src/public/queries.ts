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
import { mediaUrl } from "./view-models/media-url";

// rescue-4 round-3 (issue 1): category/tag listing rows carry the resolved
// feature image (storage_key + alt) so their cards render the REAL image like
// the homepage cards, not the bare teal gradient placeholder. The homepage
// path (view-models/home.ts) already LEFT JOINs media; these listings did not.
export type ArticleCardRow = ArticleRow & {
  image_url?: string | null;
  image_alt?: string | null;
};

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

export interface PublicTagRow {
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

// T27 (BCL-049): the operator-configured `items_per_page` site setting was
// dead — category/tag listings hardcoded PUBLIC_PAGE_SIZE=20. resolvePageSize
// reads the setting (via the same fetchSiteSetting reader the public router
// uses) and clamps it to the 1..100 range the admin number control enforces
// (admin/templates/settings.ts: min=1 max=100). Falls back to the
// PUBLIC_PAGE_SIZE default when the setting is unset or non-numeric.
export async function resolvePageSize(
  db: D1Database,
  siteId: string,
): Promise<number> {
  const raw = await fetchSiteSetting(db, siteId, "items_per_page");
  if (raw === null) return PUBLIC_PAGE_SIZE;
  const parsed = parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return PUBLIC_PAGE_SIZE;
  return Math.min(parsed, 100);
}

export async function fetchCategoryArticles(
  db: D1Database,
  categoryId: number,
  siteId: string,
  page: number,
  pageSize: number = PUBLIC_PAGE_SIZE,
): Promise<ArticleCardRow[]> {
  const offset = Math.max(0, (page - 1) * pageSize);
  const result = await db
    .prepare(
      "SELECT a.*, m.storage_key AS image_url, m.alt_text AS image_alt " +
        "FROM articles a " +
        "LEFT JOIN media m ON m.id = a.featured_image_id " +
        "WHERE a.category_id = ? AND a.site_id = ? AND a.status = 'published' " +
        "ORDER BY a.published_at DESC, a.id DESC LIMIT ? OFFSET ?",
    )
    .bind(categoryId, siteId, pageSize, offset)
    .all<ArticleCardRow>();
  return result.results ?? [];
}

// T14: tag listing pages. tags carry a phase-3 `site_id` column, so the tag
// lookup is tenant-scoped exactly like the per-site article queries (a NULL
// site_id stays globally reachable for legacy/shared tags). The article
// listing joins `article_tags` and is ALWAYS scoped by `a.site_id = ?` so a
// tag page can never leak another tenant's articles.
export async function fetchTag(
  db: D1Database,
  slug: string,
  siteId: string,
): Promise<PublicTagRow | null> {
  const row = await db
    .prepare(
      "SELECT id, slug, name FROM tags WHERE slug = ? " +
        "AND (site_id = ? OR site_id IS NULL) LIMIT 1",
    )
    .bind(slug, siteId)
    .first<PublicTagRow>();
  return row ?? null;
}

export async function fetchTagArticles(
  db: D1Database,
  tagId: number,
  siteId: string,
  page: number,
  pageSize: number = PUBLIC_PAGE_SIZE,
): Promise<ArticleCardRow[]> {
  const offset = Math.max(0, (page - 1) * pageSize);
  const result = await db
    .prepare(
      "SELECT a.*, m.storage_key AS image_url, m.alt_text AS image_alt FROM articles a " +
        "LEFT JOIN media m ON m.id = a.featured_image_id " +
        "JOIN article_tags atg ON atg.article_id = a.id " +
        "WHERE atg.tag_id = ? AND a.site_id = ? AND a.status = 'published' " +
        "ORDER BY a.published_at DESC, a.id DESC LIMIT ? OFFSET ?",
    )
    .bind(tagId, siteId, pageSize, offset)
    .all<ArticleCardRow>();
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

export interface RedirectRow {
  destination_path: string;
  status_code: number;
}

// T15: the operator-managed `redirects` table, finally wired into the public
// router. A matching, ACTIVE row on the request path resolves to an HTTP
// 301/302 to its destination — issued by /:slug BEFORE any page/article lookup
// so a stored legacy redirect is honored even when a slug now occupies the
// same path. Scoped by site_id (with a global `site_id IS NULL` fallback so a
// cross-site legacy rewrite still applies); the site-specific row wins over a
// global one via `ORDER BY site_id IS NULL`. `source_path` is UNIQUE so this
// stays a single-row lookup.
export async function checkRedirect(
  db: D1Database,
  sourcePath: string,
  siteId: string,
): Promise<RedirectRow | null> {
  const row = await db
    .prepare(
      "SELECT destination_path, status_code FROM redirects " +
        "WHERE source_path = ? AND is_active = 1 " +
        "AND (site_id = ? OR site_id IS NULL) " +
        "ORDER BY site_id IS NULL LIMIT 1",
    )
    .bind(sourcePath, siteId)
    .first<RedirectRow>();
  return row ?? null;
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
    // T24: the uploaded/applied logo is stored as a bare media.storage_key in
    // the logo_media_id setting; mediaUrl() turns it into the public
    // /media/<key> web address so the design .brand <img> actually loads.
    // (Historically the bare key was rendered verbatim into src="" → broken.)
    logoUrl: mediaUrl(settings.logo_media_id),
    brandTokens: parseBrandTokensJson(settings.brand_tokens_json),
  };
}
