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
import { siteFaviconUrl } from "./site-brand";

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
  // X15 (D2): the Page form's SEO fields; empty/NULL falls back to the
  // title and the site description.
  seo_title?: string | null;
  seo_description?: string | null;
  // Included in the inner About lookup. NULL when unused or unavailable.
  vertical_name?: string | null;
}

export interface PublicCategoryRow {
  id: number;
  slug: string;
  name: string;
  // X06 (owner Q5): the category's own "Description" (Categories → Edit);
  // empty/NULL gets an automatic sentence on the public page.
  description?: string | null;
}

export interface PublicTagRow {
  id: number;
  slug: string;
  name: string;
}

export const PUBLIC_PAGE_SIZE = 20;

// ECMAScript WhiteSpace and LineTerminator characters accepted by trim().
const JS_TRIM_WHITESPACE = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";

const SITE_VERTICAL_NAME_SQL =
  "SELECT v.name AS name FROM sites s INNER JOIN verticals v ON v.slug = s.vertical_slug WHERE s.id = ? LIMIT 1";

function publishedPageStatement(db: D1Database, slug: string, siteId: string, withVertical = false) {
  const page = "SELECT id, slug, title, content_html, status, updated_at, site_id, seo_title, seo_description FROM pages " +
    "WHERE slug = ? AND status = 'published' AND (site_id = ? OR site_id IS NULL) LIMIT 1";
  if (withVertical && slug === "about") {
    // Global pages use the requesting site's vertical too. An operator's SEO
    // description short-circuits the scalar subquery.
    return db.prepare(
      "WITH page AS (" + page + ") SELECT page.*, " +
      "CASE WHEN trim(coalesce(seo_description, ''), ?) = '' THEN (" + SITE_VERTICAL_NAME_SQL + ") END AS vertical_name FROM page",
    ).bind(slug, siteId, JS_TRIM_WHITESPACE, siteId);
  }
  return db.prepare(page).bind(slug, siteId);
}

export async function fetchPublishedPage(
  db: D1Database,
  slug: string,
  siteId: string,
  withVertical = false,
): Promise<PublicPageRow | null> {
  if (withVertical && slug === "about") {
    try {
      return await publishedPageStatement(db, slug, siteId, true).first<PublicPageRow>() ?? null;
    } catch {
      // Keep the page available if its optional vertical cannot be read.
    }
  }
  return await publishedPageStatement(db, slug, siteId).first<PublicPageRow>() ?? null;
}

export async function fetchCategory(
  db: D1Database,
  slug: string,
): Promise<PublicCategoryRow | null> {
  const row = await db
    .prepare("SELECT id, slug, name, description FROM categories WHERE slug = ? LIMIT 1")
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

// LIMIT and OFFSET depend on the tenant setting. Parse its leading decimal
// digits just as resolvePageSize does (parseInt accepts whitespace, a plus
// sign and trailing text). Non-finite and non-positive values use the default.
const PAGE_SIZE_CTE = `
  raw_setting(raw) AS (
    SELECT ltrim(value, ?4) FROM site_settings WHERE site_id = ?1 AND key = 'items_per_page'
  ),
  unsigned(raw) AS (
    SELECT CASE substr(raw, 1, 1) WHEN '+' THEN substr(raw, 2) ELSE raw END FROM raw_setting
  ),
  parsed(n) AS (
    SELECT CAST(substr(raw, 1, length(raw) - length(ltrim(raw, '0123456789'))) AS REAL) FROM unsigned
  ),
  page_size(n) AS (
    SELECT coalesce((SELECT CAST(min(n, 100) AS INTEGER) FROM parsed WHERE n BETWEEN 1 AND ?5), ?6)
  )`;

export type ListingCard = Pick<ArticleCardRow, "slug" | "title" | "published_at" | "image_url" | "image_alt">;

interface ListingRow extends PublicCategoryRow {
  page_size: number;
  article_slug: string | null;
  article_title: string | null;
  published_at: number | null;
  image_url: string | null;
  image_alt: string | null;
}

export async function fetchListing(
  db: D1Database, kind: "category" | "tag", siteId: string, slug: string, page: number,
) {
  const category = kind === "category";
  const taxonomySql = category
    ? "SELECT id, slug, name, description FROM categories WHERE slug = ?2 LIMIT 1"
    : "SELECT id, slug, name, NULL AS description FROM tags WHERE slug = ?2 AND (site_id = ?1 OR site_id IS NULL) LIMIT 1";
  const membershipSql = category
    ? "WHERE a.category_id = (SELECT id FROM taxonomy) "
    : "JOIN article_tags atg ON atg.article_id = a.id WHERE atg.tag_id = (SELECT id FROM taxonomy) ";

  // Limiting articles before the LEFT JOIN retains the heading on empty and
  // out-of-range pages. A missing category or tag produces no row.
  let result: D1Result<ListingRow>;
  try {
    result = await db.prepare(
      "WITH taxonomy AS (" + taxonomySql + "), " + PAGE_SIZE_CTE + `,
      cards AS (
        SELECT a.id, a.slug, a.title, a.published_at, m.storage_key AS image_url, m.alt_text AS image_alt
        FROM articles a LEFT JOIN media m ON m.id = a.featured_image_id ` +
        membershipSql + `AND a.site_id = ?1 AND a.status = 'published'
        ORDER BY a.published_at DESC, a.id DESC
        LIMIT (SELECT n FROM page_size) OFFSET ?3 * (SELECT n FROM page_size)
      )
      SELECT t.*, (SELECT n FROM page_size) AS page_size, c.slug AS article_slug, c.title AS article_title,
             c.published_at, c.image_url, c.image_alt
      FROM taxonomy t LEFT JOIN cards c ON true ORDER BY c.published_at DESC, c.id DESC`,
    ).bind(siteId, slug, page - 1, JS_TRIM_WHITESPACE, Number.MAX_VALUE, PUBLIC_PAGE_SIZE).all<ListingRow>();
  } catch {
    // A failed combined read must still go through the original visibility
    // gate (including the global category and shared-tag rules).
    const taxonomy = category ? await fetchCategory(db, slug) : await fetchTag(db, slug, siteId);
    if (!taxonomy) return null;
    const pageSize = await resolvePageSize(db, siteId);
    const articles = category
      ? await fetchCategoryArticles(db, taxonomy.id, siteId, page, pageSize)
      : await fetchTagArticles(db, taxonomy.id, siteId, page, pageSize);
    return { taxonomy, articles, pageSize };
  }

  const first = result.results[0];
  if (!first) return null;
  const { id, name, description } = first;
  const articles: ListingCard[] = [];
  for (const row of result.results) {
    if (row.article_slug !== null && row.article_title !== null) {
      articles.push({
        slug: row.article_slug, title: row.article_title, published_at: row.published_at,
        image_url: row.image_url, image_alt: row.image_alt,
      });
    }
  }
  return { taxonomy: { id, slug: first.slug, name, description }, articles, pageSize: first.page_size };
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

export async function fetchRobotsSettings(db: D1Database, siteId: string) {
  const rows = await db.prepare(
    "SELECT key, value FROM site_settings WHERE site_id = ? AND key IN ('robots_txt_content', 'ai_block_training')",
  ).bind(siteId).all<{ key: string; value: string | null }>();
  return {
    override: rows.results.find((row) => row.key === "robots_txt_content")?.value ?? null,
    blockTraining: rows.results.find((row) => row.key === "ai_block_training")?.value ?? null,
  };
}

export interface RedirectRow {
  destination_path: string;
  status_code: number;
}

// T15: the operator-managed `redirects` table, finally wired into the public
// router. A matching, ACTIVE row on the request path resolves to an HTTP
// 301/302 to its destination — issued by /:slug before serving other candidates
// so a stored legacy redirect is honored even when a slug now occupies the
// same path. Scoped by site_id (with a global `site_id IS NULL` fallback so a
// cross-site legacy rewrite still applies); the site-specific row wins over a
// global one via `ORDER BY site_id IS NULL`. `source_path` is UNIQUE so this
// stays a single-row lookup.
function redirectStatement(db: D1Database, sourcePath: string, siteId: string) {
  return db
    .prepare(
      "SELECT destination_path, status_code FROM redirects " +
        "WHERE source_path = ? AND is_active = 1 " +
        "AND (site_id = ? OR site_id IS NULL) " +
        "ORDER BY site_id IS NULL LIMIT 1",
    )
    .bind(sourcePath, siteId);
}

export async function checkRedirect(
  db: D1Database,
  sourcePath: string,
  siteId: string,
): Promise<RedirectRow | null> {
  return await redirectStatement(db, sourcePath, siteId).first<RedirectRow>() ?? null;
}

// Only the status is needed for the canonical article redirect. Keep large
// article bodies out of speculative reads. Each statement has the same tenant
// and publication rules as the corresponding sequential gate.
export async function fetchBareSlugCandidates(db: D1Database, slug: string, siteId: string) {
  const [redirect, page, article] = await db.batch([
    redirectStatement(db, "/" + slug, siteId),
    publishedPageStatement(db, slug, siteId, true),
    db.prepare("SELECT status FROM articles WHERE slug = ? AND site_id = ? LIMIT 1").bind(slug, siteId),
  ]) as [D1Result<RedirectRow>, D1Result<PublicPageRow>, D1Result<{ status: string }>];
  return {
    redirect: redirect.results[0] ?? null,
    page: page.results[0] ?? null,
    article: article.results[0] ?? null,
  };
}

export interface PublicLayoutSiteInfo {
  name: string;
  hostname: string;
  tagline: string;
  description: string;
  logoUrl: string | null;
  // X14 v2: the site's "Tab icon" (favicon_media_id), null = the badge.
  faviconUrl?: string | null;
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

// X06 (owner Q5): the site's Vertical display name (e.g. "Finance"), for the
// About page's automatic description. Read only when that page has no SEO
// description of its own; null when unknown or unreadable (the sentence then
// leaves the Vertical out).
export async function fetchSiteVerticalName(
  db: D1Database,
  siteId: string,
): Promise<string | null> {
  try {
    const row = await db
      .prepare(SITE_VERTICAL_NAME_SQL)
      .bind(siteId)
      .first<{ name: string | null }>();
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    return name.length > 0 ? name : null;
  } catch {
    return null;
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
    faviconUrl: siteFaviconUrl(settings.favicon_media_id),
    brandTokens: parseBrandTokensJson(settings.brand_tokens_json),
  };
}
