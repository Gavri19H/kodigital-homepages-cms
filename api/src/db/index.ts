// Typed D1 query helpers for kodigital-homepages-cms.
//
// Hard rule: every query is built with `db.prepare(<static SQL>).bind(...)` —
// NO template-literal interpolation of values into SQL. Parameters are passed
// to `.bind(...)` as positional `?` placeholders only. This keeps the module
// SQL-injection-safe and lets the AC grep `\.prepare\(`[^`]*\$\{` stay at 0.
//
// Phase 3 / T12: Each public-content helper accepts an optional siteId.
// When siteId is provided, the prepared statement appends `AND site_id = ?`
// so queries are scoped to one tenant — no cross-site leak. Public-path
// callers (T26/T27 wiring) MUST supply siteId; the helper preserves the
// legacy (unscoped) shape only for Phase-1/2 internal callers during the
// migration window.

export interface ArticleRow {
  id: number;
  slug: string;
  title: string;
  content_json: string;
  content_html: string | null;
  category_id: number | null;
  status: string;
  published_at: number | null;
  scheduled_at: number | null;
  author_name: string | null;
  featured_image_id: number | null;
  is_featured: number;
  is_trending: number;
  created_at: number;
  updated_at: number;
}

export interface MediaRow {
  id: number;
  filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  folder: string | null;
  created_at: number;
}

export interface CategoryRow {
  id: number;
  slug: string;
  name: string;
  parent_id: number | null;
  featured_image_id: number | null;
  display_order: number;
  article_count: number;
}

export interface ListArticlesOptions {
  status?: string;
  limit?: number;
  offset?: number;
  siteId?: string | null;
}

export interface ListCategoriesOptions {
  limit?: number;
  offset?: number;
  siteId?: string | null;
}

export interface GetArticleBySlugOptions {
  siteId?: string | null;
}

export interface GetMediaByIdOptions {
  siteId?: string | null;
}

export async function getArticleBySlug(
  db: D1Database,
  slug: string,
  options: GetArticleBySlugOptions = {},
): Promise<ArticleRow | null> {
  const siteId = options.siteId ?? null;
  const stmt = siteId !== null
    ? db.prepare("SELECT * FROM articles WHERE slug = ? AND site_id = ? LIMIT 1").bind(slug, siteId)
    : db.prepare("SELECT * FROM articles WHERE slug = ? LIMIT 1").bind(slug);
  const row = await stmt.first<ArticleRow>();
  return row ?? null;
}

export async function listArticles(
  db: D1Database,
  options: ListArticlesOptions = {},
): Promise<ArticleRow[]> {
  const status = options.status ?? "published";
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  const siteId = options.siteId ?? null;
  const stmt = siteId !== null
    ? db.prepare("SELECT * FROM articles WHERE status = ? AND site_id = ? ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?").bind(status, siteId, limit, offset)
    : db.prepare("SELECT * FROM articles WHERE status = ? ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?").bind(status, limit, offset);
  const result = await stmt.all<ArticleRow>();
  return result.results ?? [];
}

export async function getMediaById(
  db: D1Database,
  id: number,
  options: GetMediaByIdOptions = {},
): Promise<MediaRow | null> {
  const siteId = options.siteId ?? null;
  const stmt = siteId !== null
    ? db.prepare("SELECT * FROM media WHERE id = ? AND (site_id = ? OR site_id IS NULL) LIMIT 1").bind(id, siteId)
    : db.prepare("SELECT * FROM media WHERE id = ? LIMIT 1").bind(id);
  const row = await stmt.first<MediaRow>();
  return row ?? null;
}

export async function listCategories(
  db: D1Database,
  options: ListCategoriesOptions = {},
): Promise<CategoryRow[]> {
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  const siteId = options.siteId ?? null;
  const stmt = siteId !== null
    ? db.prepare("SELECT c.*, s.id AS site_id FROM categories c INNER JOIN category_verticals cv ON cv.category_id = c.id INNER JOIN verticals v ON v.id = cv.vertical_id INNER JOIN sites s ON s.vertical_slug = v.slug WHERE s.id = ? ORDER BY c.display_order ASC, c.name ASC LIMIT ? OFFSET ?").bind(siteId, limit, offset)
    : db.prepare("SELECT * FROM categories ORDER BY display_order ASC, name ASC LIMIT ? OFFSET ?").bind(limit, offset);
  const result = await stmt.all<CategoryRow>();
  return result.results ?? [];
}
