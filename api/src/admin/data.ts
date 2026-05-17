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
  seo_title: string | null;
  seo_description: string | null;
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
  seo_title: string | null;
  seo_description: string | null;
}

interface CategoryRecord {
  id: number;
  name: string;
  slug: string;
  article_count: number;
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
  seo_title: string;
  seo_description: string;
  published_at: string | null;
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
  label: string;
  model: string;
  scope: string;
  description: string;
}

interface PresetRecord {
  id: number;
  slug: string;
  category: string | null;
  is_system: number;
  is_active: number;
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
export async function listAdminDomains(env: Env): Promise<DomainRowDto[]> {
  const primary = await env.DB.prepare(
    "SELECT d.hostname, s.id AS site_id, s.name AS site_name, s.vertical_slug, s.activity, s.status, s.created_at, s.last_provisioned_at FROM domains d INNER JOIN sites s ON s.id = d.site_id WHERE d.is_primary = 1 ORDER BY s.created_at DESC, d.id DESC LIMIT 500",
  ).all<DomainJoinedRecord>();
  const counts = await env.DB.prepare(
    "SELECT site_id, COUNT(*) AS n FROM articles WHERE site_id IS NOT NULL GROUP BY site_id",
  ).all<{ site_id: string; n: number }>();
  const countBySite = new Map<string, number>();
  for (const c of counts.results ?? []) {
    countBySite.set(c.site_id, c.n);
  }
  return (primary.results ?? []).map((r) => ({
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
    "SELECT id, title, slug, site_id, category_id, status, content_json, content_html, homepage_section, homepage_rank, is_featured, is_trending, seo_title, seo_description, published_at, updated_at FROM articles WHERE id = ? LIMIT 1",
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
    seo_title: row.seo_title ?? "",
    seo_description: row.seo_description ?? "",
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
    "SELECT id, title, slug, site_id, page_type, status, show_in_footer, content_json, content_html, seo_title, seo_description, updated_at FROM pages WHERE id = ? LIMIT 1",
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
    content_json: row.content_json,
    content_html: row.content_html ?? "",
    seo_title: row.seo_title ?? "",
    seo_description: row.seo_description ?? "",
  };
}

export async function listAdminCategories(
  env: Env,
): Promise<CategoryRowDto[]> {
  const result = await env.DB.prepare(
    "SELECT id, name, slug, article_count FROM categories ORDER BY display_order ASC, name ASC LIMIT 500",
  ).all<CategoryRecord>();
  return (result.results ?? []).map((r) => ({
    id: String(r.id),
    name: r.name,
    slug: r.slug,
    article_count: r.article_count,
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

export async function listAdminPresets(env: Env): Promise<PresetRowDto[]> {
  const result = await env.DB.prepare(
    "SELECT id, slug, category, is_system, is_active FROM prompt_presets WHERE is_active = 1 ORDER BY slug ASC, id ASC LIMIT 500",
  ).all<PresetRecord>();
  return (result.results ?? []).map((r) => ({
    id: String(r.id),
    label: r.slug,
    model: "",
    scope: r.is_system === 1 ? "system" : "user",
    description: r.category ?? "",
  }));
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
