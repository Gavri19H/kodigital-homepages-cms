// Phase 3 / T11: schema-aware data helpers for api/src/admin/ui.ts.
//
// Every D1 call is `db.prepare(<static SQL>).bind(...)` — no template-
// literal SQL. Schema invariants:
//   * domains hostname lives on `domains.hostname`; queries MUST NOT
//     select a column literally named `domain` from `domains`.
//   * sites read path uses the Phase-3 column set: id, name,
//     vertical_slug, activity, status, settings_version,
//     last_provisioned_at, created_at, updated_at.

import type { Env } from "../env";
import { buildWhereClause } from "./query-filters";

interface SiteRecord {
  id: string;
  name: string;
  vertical_slug: string;
  activity: string;
  status: string;
  settings_version: number;
  last_provisioned_at: number | null;
  created_at: number;
  updated_at: number;
}

interface VerticalRecord {
  slug: string;
  name: string;
  display_order: number;
}

interface DomainJoinedRecord {
  hostname: string;
  site_id: string;
  site_name: string;
  vertical_slug: string;
  activity: string;
  status: string;
  created_at: number;
  last_provisioned_at: number | null;
}

interface ArticleListRecord {
  id: number;
  title: string;
  slug: string;
  site_id: string | null;
  category_id: number | null;
  status: string;
  homepage_section: string | null;
  is_featured: number;
  is_trending: number;
  published_at: number | null;
  updated_at: number;
}

interface ArticleRecord extends ArticleListRecord {
  content_json: string;
  content_html: string | null;
  homepage_rank: number | null;
  featured_image_id: number | null;
  featured_image_storage_key: string | null;
  seo_title: string | null;
  seo_description: string | null;
  author_name: string | null;
  author_bio: string | null;
}

interface PageListRecord {
  id: number;
  title: string;
  slug: string;
  site_id: string | null;
  page_type: string;
  status: string;
  show_in_footer: number;
  updated_at: number;
}

interface PageRecord extends PageListRecord {
  content_json: string;
  content_html: string | null;
  display_order: number;
  seo_title: string | null;
  seo_description: string | null;
}

interface CategoryRecord {
  id: number;
  name: string;
  slug: string;
  article_count: number;
  display_order: number;
  show_on_homepage: number;
  // Correlated group_concat of the category's vertical slugs (NULL when the
  // category belongs to no vertical). Populated by the category_verticals →
  // verticals join in the list SELECTs below.
  verticals: string | null;
}

interface TagRecord {
  id: number;
  name: string;
  slug: string;
  site_id: string | null;
  article_count: number;
}

interface MediaRecord {
  id: number;
  filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  site_id: string | null;
  created_at: number;
}

interface SettingRecord {
  key: string;
  value: string;
}

export interface AdminBranding {
  userEmail?: string;
}

export interface DashboardStats {
  sites: number;
  totalArticles: number;
  published: number;
  drafts: number;
  pages: number;
  mediaFiles: number;
  categories: number;
}

export interface RecentArticleDto {
  id: string;
  title: string;
  site: string;
  status: string;
  updatedAt: string;
}

export interface SiteDto {
  id: string;
  name: string;
}

export interface DomainRowDto {
  domain: string;
  site_name: string;
  vertical: string;
  activity: string;
  status: string;
  articles: number;
  created: string;
  last_provisioned: string;
}

export interface VerticalDto {
  slug: string;
  label: string;
}

export interface ArticleRowDto {
  id: string;
  title: string;
  slug: string;
  site: string;
  site_id: string | null;
  category: string;
  status: string;
  homepage_section: string | null;
  is_featured: boolean;
  is_trending: boolean;
  published_at: string | null;
  updated_at: string;
}

export interface ArticleFormDto {
  id: string;
  title: string;
  slug: string;
  site_id: string | null;
  category_id: string;
  status: string;
  content_json: string;
  content_html: string;
  homepage_section: string | null;
  homepage_rank: number | null;
  is_featured: boolean;
  is_trending: boolean;
  featured_image_id: number | null;
  featured_image_url: string | null;
  seo_title: string;
  seo_description: string;
  subtitle: string;
  published_at: string | null;
  author_name: string;
  author_bio: string;
}

export interface PageRowDto {
  id: string;
  title: string;
  slug: string;
  site: string;
  site_id: string | null;
  page_type: string;
  status: string;
  show_in_footer: boolean;
  updated_at: string;
}

export interface PageFormDto {
  id: string;
  title: string;
  slug: string;
  site_id: string | null;
  page_type: string;
  status: string;
  show_in_footer: boolean;
  display_order: number;
  content_json: string;
  content_html: string;
  seo_title: string;
  seo_description: string;
}

export interface CategoryRowDto {
  id: string;
  name: string;
  slug: string;
  article_count: number;
  display_order: number;
  show_on_homepage: number;
  verticals: string[];
}

export interface TagRowDto {
  id: string;
  name: string;
  slug: string;
  site_id: string | null;
  article_count: number;
}

export interface MediaRowDto {
  id: string;
  filename: string;
  preview_url: string;
  site_id: string | null;
  kind: string;
  size: number;
  uploaded_at: string;
}

export type SettingsValueMap = { [key: string]: string };

export interface PresetRowDto {
  id: string;
  slug: string;
  label: string;
  // Human display name (prompt_presets.name). Falls back to the slug when the
  // row has no name (legacy/system rows seeded before migration 0014).
  name: string;
  // The configured text model (prompt_presets.text_model); empty string when
  // the row has no model set.
  model: string;
  scope: string;
  category: string;
  description: string;
  usageCount: number;
  // Count of declared entries in the parsed variables_schema JSON (0 on absent
  // or corrupt JSON).
  variableCount: number;
  isActive: boolean;
  isSystem: boolean;
}

interface PresetRecord {
  id: number;
  slug: string;
  category: string | null;
  is_system: number;
  is_active: number;
  // Reference columns: text_model (migration 0011), name (0014),
  // variables_schema (0019), usage_count (0001).
  name: string | null;
  text_model: string | null;
  usage_count: number;
  variables_schema: string | null;
}

function fmtDate(unixSeconds: number | null | undefined): string {
  if (typeof unixSeconds !== "number" || !Number.isFinite(unixSeconds)) {
    return "";
  }
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function fmtKind(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
}

export function getAdminBranding(userEmail?: string): AdminBranding {
  return userEmail !== undefined && userEmail.length > 0
    ? { userEmail }
    : {};
}

export async function getDashboardStats(env: Env): Promise<DashboardStats> {
  const sitesRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sites",
  ).first<{ n: number }>();
  const articlesRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM articles",
  ).first<{ n: number }>();
  const publishedRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM articles WHERE status = ?",
  )
    .bind("published")
    .first<{ n: number }>();
  const draftsRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM articles WHERE status = ?",
  )
    .bind("draft")
    .first<{ n: number }>();
  const pagesRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM pages",
  ).first<{ n: number }>();
  const mediaRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM media",
  ).first<{ n: number }>();
  const categoriesRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM categories",
  ).first<{ n: number }>();
  return {
    sites: sitesRow?.n ?? 0,
    totalArticles: articlesRow?.n ?? 0,
    published: publishedRow?.n ?? 0,
    drafts: draftsRow?.n ?? 0,
    pages: pagesRow?.n ?? 0,
    mediaFiles: mediaRow?.n ?? 0,
    categories: categoriesRow?.n ?? 0,
  };
}

export async function getRecentArticles(
  env: Env,
  limit = 10,
): Promise<RecentArticleDto[]> {
  const result = await env.DB.prepare(
    "SELECT a.id, a.title, a.status, a.updated_at, s.name AS site_name FROM articles a LEFT JOIN sites s ON s.id = a.site_id ORDER BY a.updated_at DESC, a.id DESC LIMIT ?",
  )
    .bind(limit)
    .all<{
      id: number;
      title: string;
      status: string;
      updated_at: number;
      site_name: string | null;
    }>();
  return (result.results ?? []).map((r) => ({
    id: String(r.id),
    title: r.title,
    site: r.site_name ?? "",
    status: r.status,
    updatedAt: fmtDate(r.updated_at),
  }));
}

export async function listAdminSites(env: Env): Promise<SiteDto[]> {
  const result = await env.DB.prepare(
    "SELECT id, name, vertical_slug, activity, status, settings_version, last_provisioned_at, created_at, updated_at FROM sites ORDER BY name ASC, id ASC LIMIT 500",
  ).all<SiteRecord>();
  return (result.results ?? []).map((r) => ({ id: r.id, name: r.name }));
}

// Single statement in this file that reads FROM the domains table.
// Hostname column is `domains.hostname`; we re-project it into the DTO
// as `domain` so the existing DomainEntry-consuming template (T4) keeps
// working without churn.
//
// T34 (G5 "Admin domains list shows all domains"): this list MUST surface
// EVERY domain row — alias (non-primary) hostnames included — not only the
// `is_primary = 1` canonical one. The earlier `WHERE d.is_primary = 1`
// predicate hid every secondary domain from the admin Domains tab; it is
// removed so each domain (primary + alias) gets its own row. Primary rows
// still sort first within a site via the `d.is_primary DESC` order key.
export async function listAdminDomains(env: Env): Promise<DomainRowDto[]> {
  const rows = await env.DB.prepare(
    "SELECT d.hostname, s.id AS site_id, s.name AS site_name, s.vertical_slug, s.activity, s.status, s.created_at, s.last_provisioned_at FROM domains d INNER JOIN sites s ON s.id = d.site_id ORDER BY s.created_at DESC, d.is_primary DESC, d.id DESC LIMIT 500",
  ).all<DomainJoinedRecord>();
  const counts = await env.DB.prepare(
    "SELECT site_id, COUNT(*) AS n FROM articles WHERE site_id IS NOT NULL GROUP BY site_id",
  ).all<{ site_id: string; n: number }>();
  const countBySite = new Map<string, number>();
  for (const c of counts.results ?? []) {
    countBySite.set(c.site_id, c.n);
  }
  return (rows.results ?? []).map((r) => ({
    domain: r.hostname,
    site_name: r.site_name,
    vertical: r.vertical_slug,
    activity: r.activity,
    status: r.status,
    articles: countBySite.get(r.site_id) ?? 0,
    created: fmtDate(r.created_at),
    last_provisioned: fmtDate(r.last_provisioned_at),
  }));
}

export async function listAdminVerticals(env: Env): Promise<VerticalDto[]> {
  const result = await env.DB.prepare(
    "SELECT slug, name, display_order FROM verticals ORDER BY display_order ASC, slug ASC LIMIT 50",
  ).all<VerticalRecord>();
  return (result.results ?? []).map((r) => ({
    slug: r.slug,
    label: r.name,
  }));
}

export async function listAdminArticles(
  env: Env,
): Promise<ArticleRowDto[]> {
  const result = await env.DB.prepare(
    "SELECT a.id, a.title, a.slug, a.site_id, a.category_id, a.status, a.homepage_section, a.is_featured, a.is_trending, a.published_at, a.updated_at, s.name AS site_name, c.name AS category_name FROM articles a LEFT JOIN sites s ON s.id = a.site_id LEFT JOIN categories c ON c.id = a.category_id ORDER BY a.updated_at DESC, a.id DESC LIMIT 500",
  ).all<
    ArticleListRecord & { site_name: string | null; category_name: string | null }
  >();
  return (result.results ?? []).map((r) => ({
    id: String(r.id),
    title: r.title,
    slug: r.slug,
    site: r.site_name ?? "",
    site_id: r.site_id,
    category: r.category_name ?? "",
    status: r.status,
    homepage_section: r.homepage_section,
    is_featured: r.is_featured === 1,
    is_trending: r.is_trending === 1,
    published_at: r.published_at !== null ? fmtDate(r.published_at) : null,
    updated_at: fmtDate(r.updated_at),
  }));
}

export async function getAdminArticle(
  env: Env,
  id: number,
): Promise<ArticleFormDto | null> {
  const row = await env.DB.prepare(
    "SELECT a.id, a.title, a.slug, a.site_id, a.category_id, a.status, a.content_json, a.content_html, a.homepage_section, a.homepage_rank, a.is_featured, a.is_trending, a.featured_image_id, m.storage_key AS featured_image_storage_key, a.seo_title, a.seo_description, a.subtitle, a.author_name, a.author_bio, a.published_at, a.updated_at FROM articles a LEFT JOIN media m ON m.id = a.featured_image_id WHERE a.id = ? LIMIT 1",
  )
    .bind(id)
    .first<ArticleRecord>();
  if (row === null || row === undefined) return null;
  return {
    id: String(row.id),
    title: row.title,
    slug: row.slug,
    site_id: row.site_id,
    category_id: row.category_id !== null ? String(row.category_id) : "",
    status: row.status,
    content_json: row.content_json,
    content_html: row.content_html ?? "",
    homepage_section: row.homepage_section,
    homepage_rank: row.homepage_rank,
    is_featured: row.is_featured === 1,
    is_trending: row.is_trending === 1,
    featured_image_id: row.featured_image_id,
    featured_image_url: row.featured_image_storage_key
      ? `/media/${row.featured_image_storage_key}`
      : null,
    seo_title: row.seo_title ?? "",
    seo_description: row.seo_description ?? "",
    subtitle: (row as { subtitle?: string | null }).subtitle ?? "",
    author_name: row.author_name ?? "",
    author_bio: row.author_bio ?? "",
    published_at: row.published_at !== null ? fmtDate(row.published_at) : null,
  };
}

export async function listArticlesForSite(
  env: Env,
  siteId: string,
): Promise<ArticleRowDto[]> {
  const result = await env.DB.prepare(
    "SELECT a.id, a.title, a.slug, a.site_id, a.category_id, a.status, a.homepage_section, a.is_featured, a.is_trending, a.published_at, a.updated_at, s.name AS site_name, c.name AS category_name FROM articles a LEFT JOIN sites s ON s.id = a.site_id LEFT JOIN categories c ON c.id = a.category_id WHERE a.site_id = ? ORDER BY a.updated_at DESC, a.id DESC LIMIT 500",
  )
    .bind(siteId)
    .all<
      ArticleListRecord & { site_name: string | null; category_name: string | null }
    >();
  return (result.results ?? []).map((r) => ({
    id: String(r.id),
    title: r.title,
    slug: r.slug,
    site: r.site_name ?? "",
    site_id: r.site_id,
    category: r.category_name ?? "",
    status: r.status,
    homepage_section: r.homepage_section,
    is_featured: r.is_featured === 1,
    is_trending: r.is_trending === 1,
    published_at: r.published_at !== null ? fmtDate(r.published_at) : null,
    updated_at: fmtDate(r.updated_at),
  }));
}

export async function listAdminPages(env: Env): Promise<PageRowDto[]> {
  const result = await env.DB.prepare(
    "SELECT p.id, p.title, p.slug, p.site_id, p.page_type, p.status, p.show_in_footer, p.updated_at, s.name AS site_name FROM pages p LEFT JOIN sites s ON s.id = p.site_id ORDER BY p.updated_at DESC, p.id DESC LIMIT 500",
  ).all<PageListRecord & { site_name: string | null }>();
  return (result.results ?? []).map((r) => ({
    id: String(r.id),
    title: r.title,
    slug: r.slug,
    site: r.site_name ?? "",
    site_id: r.site_id,
    page_type: r.page_type,
    status: r.status,
    show_in_footer: r.show_in_footer === 1,
    updated_at: fmtDate(r.updated_at),
  }));
}

export async function getAdminPage(
  env: Env,
  id: number,
): Promise<PageFormDto | null> {
  const row = await env.DB.prepare(
    "SELECT id, title, slug, site_id, page_type, status, show_in_footer, display_order, content_json, content_html, seo_title, seo_description, updated_at FROM pages WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<PageRecord>();
  if (row === null || row === undefined) return null;
  return {
    id: String(row.id),
    title: row.title,
    slug: row.slug,
    site_id: row.site_id,
    page_type: row.page_type,
    status: row.status,
    show_in_footer: row.show_in_footer === 1,
    display_order: row.display_order,
    content_json: row.content_json,
    content_html: row.content_html ?? "",
    seo_title: row.seo_title ?? "",
    seo_description: row.seo_description ?? "",
  };
}

// Per-category vertical slugs are folded in via a correlated subquery
// (group_concat over the category_verticals → verticals join, ordered by
// the join's display_order) so the list keeps a single round-trip and no
// extra .bind() params — sidestepping the 100-binding cap (d1-database-safety).
const CATEGORY_VERTICALS_SUBQUERY =
  "(SELECT group_concat(v.slug, ',') FROM category_verticals cv " +
  "INNER JOIN verticals v ON v.id = cv.vertical_id " +
  "WHERE cv.category_id = categories.id ORDER BY cv.display_order ASC) AS verticals";

function splitVerticals(raw: string | null): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  return raw.split(",").filter((s) => s.length > 0);
}

export async function listAdminCategories(
  env: Env,
): Promise<CategoryRowDto[]> {
  const result = await env.DB.prepare(
    "SELECT id, name, slug, article_count, display_order, show_on_homepage, " +
      CATEGORY_VERTICALS_SUBQUERY +
      " FROM categories ORDER BY display_order ASC, name ASC LIMIT 500",
  ).all<CategoryRecord>();
  return (result.results ?? []).map((r) => ({
    id: String(r.id),
    name: r.name,
    slug: r.slug,
    article_count: r.article_count,
    display_order: r.display_order,
    show_on_homepage: r.show_on_homepage,
    verticals: splitVerticals(r.verticals),
  }));
}

// T7: data-layer helper that resolves a site's allowed vertical set.
// The HTTP handler at api.ts:POST /api/admin/categories uses an inline
// query (no helper) so the test seam can plant rows; this wrapper is
// exposed for future read paths (Settings → vertical pickers) that need
// the same set without going through the create handler. Wrapper is a
// plain bind() call — schema invariant: verticals.id is the PK that
// category_verticals.vertical_id references.
export async function listAllowedVerticalsForSite(
  env: Env,
  siteId: string,
): Promise<number[]> {
  if (typeof siteId !== "string" || siteId.trim().length === 0) return [];
  const result = await env.DB.prepare(
    "SELECT v.id AS id FROM verticals v INNER JOIN sites s ON s.vertical_slug = v.slug WHERE s.id = ? ORDER BY v.display_order ASC",
  )
    .bind(siteId)
    .all<{ id: number }>();
  return (result.results ?? []).map((r) => r.id);
}

export async function listAdminTags(env: Env): Promise<TagRowDto[]> {
  const result = await env.DB.prepare(
    "SELECT id, name, slug, site_id, article_count FROM tags ORDER BY name ASC LIMIT 500",
  ).all<TagRecord>();
  return (result.results ?? []).map((r) => ({
    id: String(r.id),
    name: r.name,
    slug: r.slug,
    site_id: r.site_id,
    article_count: r.article_count,
  }));
}

// T10: site-scoped Tags read path. The Tags admin page (templates/tags.ts)
// emits select[name="site_id"] so the filter form submits ?site_id=<id>.
// This wrapper drives GET /api/admin/tags?site_id=<id> and returns the
// site's own tags only (NULL/global rows are excluded by AC: site A with
// 3 tags + site B with 2 tags MUST yield exactly 3 rows for site_id=A).
// Site-id is bound (parameterized) — never interpolated.
export async function listTagsForSite(
  env: Env,
  siteId: string,
): Promise<TagRowDto[]> {
  const result = await env.DB.prepare(
    "SELECT id, name, slug, site_id, article_count FROM tags WHERE site_id = ? ORDER BY name ASC LIMIT 500",
  )
    .bind(siteId)
    .all<TagRecord>();
  return (result.results ?? []).map((r) => ({
    id: String(r.id),
    name: r.name,
    slug: r.slug,
    site_id: r.site_id,
    article_count: r.article_count,
  }));
}

export async function listAdminMedia(env: Env): Promise<MediaRowDto[]> {
  const result = await env.DB.prepare(
    "SELECT id, filename, storage_key, mime_type, size_bytes, site_id, created_at FROM media ORDER BY created_at DESC, id DESC LIMIT 500",
  ).all<MediaRecord>();
  return (result.results ?? []).map((r) => ({
    id: String(r.id),
    filename: r.filename,
    preview_url: "/media/" + r.storage_key,
    site_id: r.site_id,
    kind: fmtKind(r.mime_type),
    size: r.size_bytes,
    uploaded_at: fmtDate(r.created_at),
  }));
}

export async function listMediaForSite(
  env: Env,
  siteId: string,
): Promise<MediaRowDto[]> {
  const result = await env.DB
    .prepare(
      "SELECT id, filename, storage_key, mime_type, size_bytes, site_id, created_at FROM media WHERE site_id = ? OR site_id IS NULL ORDER BY created_at DESC, id DESC LIMIT 500",
    )
    .bind(siteId)
    .all<MediaRecord>();
  return (result.results ?? []).map((r) => ({
    id: String(r.id),
    filename: r.filename,
    preview_url: "/media/" + r.storage_key,
    site_id: r.site_id,
    kind: fmtKind(r.mime_type),
    size: r.size_bytes,
    uploaded_at: fmtDate(r.created_at),
  }));
}

// The admin AI-presets list. Returns ALL presets (active AND inactive) so the
// list-page Status column can surface inactive rows and the operator can
// reactivate them — the earlier `WHERE is_active = 1` filter hid every
// deactivated preset from the only screen that can toggle it back on.
export async function listAdminPresets(env: Env): Promise<PresetRowDto[]> {
  const result = await env.DB.prepare(
    "SELECT id, slug, category, is_system, is_active, name, text_model, usage_count, variables_schema FROM prompt_presets ORDER BY is_system DESC, slug ASC, id ASC LIMIT 500",
  ).all<PresetRecord>();
  return (result.results ?? []).map((r) => ({
    id: String(r.id),
    slug: r.slug,
    // Prefer the human name; fall back to the slug when absent.
    label: r.name && r.name.length > 0 ? r.name : r.slug,
    name: r.name && r.name.length > 0 ? r.name : r.slug,
    model: r.text_model ?? "",
    scope: r.is_system === 1 ? "system" : "user",
    category: r.category ?? "",
    description: r.category ?? "",
    usageCount: r.usage_count ?? 0,
    variableCount: countVariablesSchema(r.variables_schema),
    isActive: r.is_active === 1,
    isSystem: r.is_system === 1,
  }));
}

// Count declared variables in a stored variables_schema JSON. The column is a
// JSON array of {key,...} entries (migration 0019). Corrupt/non-array JSON or
// a NULL column yields 0 (guarded parse — never throws during a list render).
function countVariablesSchema(raw: string | null | undefined): number {
  if (typeof raw !== "string" || raw.length === 0) return 0;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export async function listAdminSettings(
  env: Env,
  siteId: string | null,
): Promise<SettingsValueMap> {
  const result = siteId !== null && siteId.length > 0
    ? await env.DB
        .prepare(
          "SELECT key, value FROM site_settings WHERE site_id = ? ORDER BY key ASC",
        )
        .bind(siteId)
        .all<SettingRecord>()
    : await env.DB
        .prepare(
          "SELECT key, value FROM site_settings WHERE site_id IS NULL ORDER BY key ASC",
        )
        .all<SettingRecord>();
  const values: SettingsValueMap = {};
  for (const row of result.results ?? []) {
    values[row.key] = row.value;
  }
  return values;
}

// ---------------------------------------------------------------------------
// T32: dynamic list filtering + pagination for the four admin lists
// (Articles / Pages / Categories / Tags). Each reader builds its WHERE clause
// from FIXED-literal fragments via buildWhereClause (./query-filters) — user
// values ONLY ever travel through bound params, NEVER interpolated into SQL.
// Pagination is LIMIT ?/OFFSET ? (also bound). A returned ListPage carries the
// page rows plus the page/per_page/total the toolbar pager needs.
// ---------------------------------------------------------------------------

export interface ListPageMeta {
  page: number;
  per_page: number;
  total: number;
}

export interface ListPage<T> extends ListPageMeta {
  rows: T[];
}

const LIST_DEFAULT_PER_PAGE = 50;
const LIST_MAX_PER_PAGE = 200;

function normalizePage(page: number | null | undefined): number {
  return typeof page === "number" && Number.isFinite(page) && page > 0
    ? Math.floor(page)
    : 1;
}

function normalizePerPage(perPage: number | null | undefined): number {
  if (
    typeof perPage !== "number" ||
    !Number.isFinite(perPage) ||
    perPage <= 0
  ) {
    return LIST_DEFAULT_PER_PAGE;
  }
  return Math.min(Math.floor(perPage), LIST_MAX_PER_PAGE);
}

// A %term% LIKE param. Bound, never interpolated — a literal % / _ in the
// term acts as a wildcard, which is acceptable for a free-text search box.
function likeParam(value: string): string {
  return "%" + value + "%";
}

type ArticleJoinedRecord = ArticleListRecord & {
  site_name: string | null;
  category_name: string | null;
};

function mapArticleRow(r: ArticleJoinedRecord): ArticleRowDto {
  return {
    id: String(r.id),
    title: r.title,
    slug: r.slug,
    site: r.site_name ?? "",
    site_id: r.site_id,
    category: r.category_name ?? "",
    status: r.status,
    homepage_section: r.homepage_section,
    is_featured: r.is_featured === 1,
    is_trending: r.is_trending === 1,
    published_at: r.published_at !== null ? fmtDate(r.published_at) : null,
    updated_at: fmtDate(r.updated_at),
  };
}

export interface ArticleListQuery {
  site_id?: string | null;
  search?: string | null;
  category?: string | null;
  status?: string | null;
  featured?: string | null;
  trending?: string | null;
  published?: string | null;
  page?: number | null;
  per_page?: number | null;
}

export async function listAdminArticlesFiltered(
  env: Env,
  q: ArticleListQuery,
): Promise<ListPage<ArticleRowDto>> {
  const search = typeof q.search === "string" ? q.search.trim() : "";
  const categoryId =
    q.category != null && String(q.category).trim() !== ""
      ? Number(q.category)
      : null;
  const { clause, params } = buildWhereClause([
    {
      when: typeof q.site_id === "string" && q.site_id.length > 0,
      clause: "a.site_id = ?",
      params: [q.site_id as string],
    },
    { when: search.length > 0, clause: "a.title LIKE ?", params: [likeParam(search)] },
    {
      when: categoryId !== null && Number.isFinite(categoryId),
      clause: "a.category_id = ?",
      params: [categoryId as number],
    },
    {
      when: typeof q.status === "string" && q.status.length > 0,
      clause: "a.status = ?",
      params: [q.status as string],
    },
    {
      when: q.featured === "0" || q.featured === "1",
      clause: "a.is_featured = ?",
      params: [q.featured === "1" ? 1 : 0],
    },
    {
      when: q.trending === "0" || q.trending === "1",
      clause: "a.is_trending = ?",
      params: [q.trending === "1" ? 1 : 0],
    },
    { when: q.published === "1", clause: "a.published_at IS NOT NULL", params: [] },
    { when: q.published === "0", clause: "a.published_at IS NULL", params: [] },
  ]);
  const page = normalizePage(q.page);
  const perPage = normalizePerPage(q.per_page);
  const offset = (page - 1) * perPage;

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM articles a WHERE " + clause,
  )
    .bind(...params)
    .first<{ n: number }>();
  const total = countRow ? Number(countRow.n) : 0;

  const result = await env.DB.prepare(
    "SELECT a.id, a.title, a.slug, a.site_id, a.category_id, a.status, a.homepage_section, a.is_featured, a.is_trending, a.published_at, a.updated_at, s.name AS site_name, c.name AS category_name FROM articles a LEFT JOIN sites s ON s.id = a.site_id LEFT JOIN categories c ON c.id = a.category_id WHERE " +
      clause +
      " ORDER BY a.updated_at DESC, a.id DESC LIMIT ? OFFSET ?",
  )
    .bind(...params, perPage, offset)
    .all<ArticleJoinedRecord>();

  return {
    rows: (result.results ?? []).map(mapArticleRow),
    page,
    per_page: perPage,
    total,
  };
}

export interface PageListQuery {
  site_id?: string | null;
  search?: string | null;
  page_type?: string | null;
  status?: string | null;
  page?: number | null;
  per_page?: number | null;
}

export async function listAdminPagesFiltered(
  env: Env,
  q: PageListQuery,
): Promise<ListPage<PageRowDto>> {
  const search = typeof q.search === "string" ? q.search.trim() : "";
  const site = typeof q.site_id === "string" ? q.site_id : "";
  const { clause, params } = buildWhereClause([
    { when: site === "__global__", clause: "p.site_id IS NULL", params: [] },
    {
      when: site.length > 0 && site !== "__global__",
      clause: "p.site_id = ?",
      params: [site],
    },
    { when: search.length > 0, clause: "p.title LIKE ?", params: [likeParam(search)] },
    {
      when: typeof q.page_type === "string" && q.page_type.length > 0,
      clause: "p.page_type = ?",
      params: [q.page_type as string],
    },
    {
      when: typeof q.status === "string" && q.status.length > 0,
      clause: "p.status = ?",
      params: [q.status as string],
    },
  ]);
  const page = normalizePage(q.page);
  const perPage = normalizePerPage(q.per_page);
  const offset = (page - 1) * perPage;

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM pages p WHERE " + clause,
  )
    .bind(...params)
    .first<{ n: number }>();
  const total = countRow ? Number(countRow.n) : 0;

  const result = await env.DB.prepare(
    "SELECT p.id, p.title, p.slug, p.site_id, p.page_type, p.status, p.show_in_footer, p.updated_at, s.name AS site_name FROM pages p LEFT JOIN sites s ON s.id = p.site_id WHERE " +
      clause +
      " ORDER BY p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?",
  )
    .bind(...params, perPage, offset)
    .all<PageListRecord & { site_name: string | null }>();

  return {
    rows: (result.results ?? []).map((r) => ({
      id: String(r.id),
      title: r.title,
      slug: r.slug,
      site: r.site_name ?? "",
      site_id: r.site_id,
      page_type: r.page_type,
      status: r.status,
      show_in_footer: r.show_in_footer === 1,
      updated_at: fmtDate(r.updated_at),
    })),
    page,
    per_page: perPage,
    total,
  };
}

export interface CategoryListQuery {
  site?: string | null;
  search?: string | null;
  vertical?: string | null;
  page?: number | null;
  per_page?: number | null;
}

export async function listAdminCategoriesFiltered(
  env: Env,
  q: CategoryListQuery,
): Promise<ListPage<CategoryRowDto>> {
  const search = typeof q.search === "string" ? q.search.trim() : "";
  const site = typeof q.site === "string" ? q.site : "";
  const vertical = typeof q.vertical === "string" ? q.vertical.trim() : "";
  // Categories have no own site_id column — site scoping is via the
  // site_categories allocation join; vertical scoping via category_verticals.
  const { clause, params } = buildWhereClause([
    { when: search.length > 0, clause: "name LIKE ?", params: [likeParam(search)] },
    {
      when: site === "__global__",
      clause: "id NOT IN (SELECT category_id FROM site_categories)",
      params: [],
    },
    {
      when: site.length > 0 && site !== "__global__",
      clause: "id IN (SELECT category_id FROM site_categories WHERE site_id = ?)",
      params: [site],
    },
    {
      when: vertical.length > 0,
      clause:
        "id IN (SELECT cv.category_id FROM category_verticals cv INNER JOIN verticals v ON v.id = cv.vertical_id WHERE v.slug = ?)",
      params: [vertical],
    },
  ]);
  const page = normalizePage(q.page);
  const perPage = normalizePerPage(q.per_page);
  const offset = (page - 1) * perPage;

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM categories WHERE " + clause,
  )
    .bind(...params)
    .first<{ n: number }>();
  const total = countRow ? Number(countRow.n) : 0;

  const result = await env.DB.prepare(
    "SELECT id, name, slug, article_count, display_order, show_on_homepage, " +
      CATEGORY_VERTICALS_SUBQUERY +
      " FROM categories WHERE " +
      clause +
      " ORDER BY display_order ASC, name ASC LIMIT ? OFFSET ?",
  )
    .bind(...params, perPage, offset)
    .all<CategoryRecord>();

  return {
    rows: (result.results ?? []).map((r) => ({
      id: String(r.id),
      name: r.name,
      slug: r.slug,
      article_count: r.article_count,
      display_order: r.display_order,
      show_on_homepage: r.show_on_homepage,
      verticals: splitVerticals(r.verticals),
    })),
    page,
    per_page: perPage,
    total,
  };
}

export interface TagListQuery {
  site_id?: string | null;
  search?: string | null;
  page?: number | null;
  per_page?: number | null;
}

export async function listAdminTagsFiltered(
  env: Env,
  q: TagListQuery,
): Promise<ListPage<TagRowDto>> {
  const search = typeof q.search === "string" ? q.search.trim() : "";
  const site = typeof q.site_id === "string" ? q.site_id : "";
  const { clause, params } = buildWhereClause([
    { when: search.length > 0, clause: "name LIKE ?", params: [likeParam(search)] },
    { when: site === "__global__", clause: "site_id IS NULL", params: [] },
    {
      when: site.length > 0 && site !== "__global__",
      clause: "site_id = ?",
      params: [site],
    },
  ]);
  const page = normalizePage(q.page);
  const perPage = normalizePerPage(q.per_page);
  const offset = (page - 1) * perPage;

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM tags WHERE " + clause,
  )
    .bind(...params)
    .first<{ n: number }>();
  const total = countRow ? Number(countRow.n) : 0;

  const result = await env.DB.prepare(
    "SELECT id, name, slug, site_id, article_count FROM tags WHERE " +
      clause +
      " ORDER BY name ASC LIMIT ? OFFSET ?",
  )
    .bind(...params, perPage, offset)
    .all<TagRecord>();

  return {
    rows: (result.results ?? []).map((r) => ({
      id: String(r.id),
      name: r.name,
      slug: r.slug,
      site_id: r.site_id,
      article_count: r.article_count,
    })),
    page,
    per_page: perPage,
    total,
  };
}
