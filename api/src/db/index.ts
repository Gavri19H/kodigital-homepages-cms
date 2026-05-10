// Typed D1 query helpers for kodigital-homepages-cms.
//
// Hard rule: every query is built with `db.prepare(<static SQL>).bind(...)` —
// NO template-literal interpolation of values into SQL. Parameters are passed
// to `.bind(...)` as positional `?` placeholders only. This keeps the module
// SQL-injection-safe and lets the AC grep `\.prepare\(`[^`]*\$\{` stay at 0.

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
}

export interface ListCategoriesOptions {
  limit?: number;
  offset?: number;
}

export async function getArticleBySlug(
  db: D1Database,
  slug: string,
): Promise<ArticleRow | null> {
  const stmt = db
    .prepare("SELECT * FROM articles WHERE slug = ? LIMIT 1")
    .bind(slug);
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
  const stmt = db
    .prepare(
      "SELECT * FROM articles WHERE status = ? ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?",
    )
    .bind(status, limit, offset);
  const result = await stmt.all<ArticleRow>();
  return result.results ?? [];
}

export async function getMediaById(
  db: D1Database,
  id: number,
): Promise<MediaRow | null> {
  const stmt = db
    .prepare("SELECT * FROM media WHERE id = ? LIMIT 1")
    .bind(id);
  const row = await stmt.first<MediaRow>();
  return row ?? null;
}

export async function listCategories(
  db: D1Database,
  options: ListCategoriesOptions = {},
): Promise<CategoryRow[]> {
  const limit = options.limit ?? 100;
  const offset = options.offset ?? 0;
  const stmt = db
    .prepare(
      "SELECT * FROM categories ORDER BY display_order ASC, name ASC LIMIT ? OFFSET ?",
    )
    .bind(limit, offset);
  const result = await stmt.all<CategoryRow>();
  return result.results ?? [];
}
