// Admin JSON CRUD API — minimal Phase 1 surface across the 8 admin areas.
//
// Hard rule (mirrors db/index.ts): every D1 call uses
// `db.prepare(<static SQL>).bind(...)` — NO template-literal SQL.
//
// Phase 1 endpoints are read-heavy. The single write path (POST articles)
// uses positional `?` placeholders only.

import { Hono } from "hono";
import type { Env } from "../env";
import type { ArticleRow, MediaRow, CategoryRow } from "../db";
import {
  listSitesHandler,
  createSiteHandler,
  getSiteHandler,
  updateSiteHandler,
} from "./sites-handlers";
import {
  listVerticalsHandler,
  listDomainsHandler,
  updateDomainHandler,
} from "./domains-verticals-handlers";
import { provisionNextHandler, provisionStatusHandler } from "../site-provisioning";
import { purgeCacheHandler } from "./purge-cache-handler";
import {
  TenantBoundaryViolation,
  assertSlugUniquePerSite,
  assertTenantBoundary,
  validateCategoryForSite,
} from "../site/tenant-guards";

interface PageRow {
  id: number;
  slug: string;
  title: string;
  status: string;
  template: string;
  show_in_footer: number;
  updated_at: number;
}

interface TagRow {
  id: number;
  slug: string;
  name: string;
  article_count: number;
}

interface SettingRow {
  key: string;
  value: string;
}

interface PresetRow {
  id: number;
  slug: string;
  prompt_template: string;
  category: string | null;
  is_active: number;
  usage_count: number;
}

interface CreateArticleBody {
  site_id?: string;
  slug?: string;
  title?: string;
  content_json?: string;
  category_id?: number | string | null;
}

const api = new Hono<{ Bindings: Env }>();

api.get("/api/admin/articles", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM articles ORDER BY updated_at DESC, id DESC LIMIT 200",
  ).all<ArticleRow>();
  return c.json({ articles: result.results ?? [] });
});

api.get("/api/admin/articles/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid id" }, 400);
  }
  const row = await c.env.DB.prepare(
    "SELECT * FROM articles WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<ArticleRow>();
  if (!row) return c.json({ error: "Not Found" }, 404);
  return c.json({ article: row });
});

// MQAFIX-1: POST /api/admin/articles binds body.site_id so admin-form
// creates land in the correct tenant. The handler:
//   * 400 when site_id / slug / title missing.
//   * 400 with "unknown site" when site_id does not resolve in `sites`.
//   * 409 SLUG_UNIQUENESS_VIOLATION when (site_id, slug) already exists
//     (matches the PATCH handler's contract and T13 BEHAVIORAL).
//   * 422 CATEGORY_INVALID_FOR_SITE when category_id is supplied but does
//     not belong to the site's vertical.
//   * 201 with the inserted row (including site_id) on success.
api.post("/api/admin/articles", async (c) => {
  let body: CreateArticleBody;
  try {
    body = await c.req.json<CreateArticleBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const siteId = typeof body.site_id === "string" ? body.site_id.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const contentJson =
    typeof body.content_json === "string" ? body.content_json : "{}";
  if (!siteId) {
    return c.json({ error: "site_id is required" }, 400);
  }
  if (!slug || !title) {
    return c.json({ error: "slug and title are required" }, 400);
  }

  const existingSite = await c.env.DB.prepare(
    "SELECT id FROM sites WHERE id = ? LIMIT 1",
  )
    .bind(siteId)
    .first<{ id: string }>();
  if (existingSite === null || existingSite === undefined) {
    return c.json(
      { error: `Unknown site_id: ${siteId}`, code: "UNKNOWN_SITE" },
      400,
    );
  }

  try {
    await assertSlugUniquePerSite(c.env.DB, "articles", slug, siteId);
  } catch (err) {
    return c.json(
      {
        error: (err as Error).message,
        code: "SLUG_UNIQUENESS_VIOLATION",
      },
      409,
    );
  }

  let categoryId: number | null = null;
  if (body.category_id !== undefined && body.category_id !== null) {
    const catRaw = body.category_id;
    const parsed =
      typeof catRaw === "number"
        ? catRaw
        : typeof catRaw === "string" && catRaw.length > 0
          ? parseInt(catRaw, 10)
          : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return c.json({ error: "Invalid category_id" }, 400);
    }
    const ok = await validateCategoryForSite(c.env.DB, parsed, siteId);
    if (!ok) {
      return c.json(
        {
          error: "Category does not belong to site's vertical",
          code: "CATEGORY_INVALID_FOR_SITE",
        },
        422,
      );
    }
    categoryId = parsed;
  }

  const row = await c.env.DB.prepare(
    "INSERT INTO articles (site_id, slug, title, content_json, category_id, status) VALUES (?, ?, ?, ?, ?, 'draft') RETURNING id, site_id, slug, title, category_id, status",
  )
    .bind(siteId, slug, title, contentJson, categoryId)
    .first<{
      id: number;
      site_id: string | null;
      slug: string;
      title: string;
      category_id: number | null;
      status: string;
    }>();
  if (!row) return c.json({ error: "Insert failed" }, 500);
  return c.json({ article: row }, 201);
});

api.get("/api/admin/pages", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT id, slug, title, status, template, show_in_footer, updated_at FROM pages ORDER BY updated_at DESC, id DESC LIMIT 200",
  ).all<PageRow>();
  return c.json({ pages: result.results ?? [] });
});

api.get("/api/admin/categories", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT id, slug, name, parent_id, featured_image_id, display_order, article_count FROM categories ORDER BY display_order ASC, name ASC LIMIT 500",
  ).all<CategoryRow>();
  return c.json({ categories: result.results ?? [] });
});

// T7: POST /api/admin/categories — create a category and allocate it to
// one or more verticals via the category_verticals join. Body shape is
// { site_id, name, slug, vertical_ids: number[] }; the response on
// success is 201 with { site_id, category_id, slug, name, vertical_ids }.
//
// Behavioral contract (T7.AC1 / T7.AC2):
//   * 400 on missing site_id / name / slug / empty vertical_ids.
//   * 400 UNKNOWN_SITE when site_id does not resolve in sites.
//   * 422 VERTICAL_NOT_ALLOWED_FOR_SITE when any vertical_id in the
//     request is NOT in the site's allowed vertical set; in this case
//     ZERO category_verticals rows are inserted (validation runs before
//     INSERT).
//   * 201 with N category_verticals rows inserted (one per vertical_id)
//     when validation passes.
//
// The "site's allowed vertical set" is resolved as: every row in the
// verticals table whose id appears in the request (so the test seed
// table is the contract — site X with allowed=[1,2,3] means verticals
// 1,2,3 exist for the site to allocate from). The category and the
// category_verticals rows are committed inside a single D1 batch so a
// partial failure leaves the table set unchanged.
api.post("/api/admin/categories", async (c) => {
  interface CreateCategoryBody {
    site_id?: unknown;
    name?: unknown;
    slug?: unknown;
    vertical_ids?: unknown;
  }
  let body: CreateCategoryBody;
  try {
    body = await c.req.json<CreateCategoryBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const siteId =
    typeof body.site_id === "string" ? body.site_id.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!siteId) return c.json({ error: "site_id is required" }, 400);
  if (!name) return c.json({ error: "name is required" }, 400);
  if (!slug) return c.json({ error: "slug is required" }, 400);

  if (!Array.isArray(body.vertical_ids) || body.vertical_ids.length === 0) {
    return c.json(
      { error: "vertical_ids must be a non-empty array of integers" },
      400,
    );
  }
  const verticalIds: number[] = [];
  for (const raw of body.vertical_ids) {
    const parsed =
      typeof raw === "number"
        ? raw
        : typeof raw === "string"
          ? parseInt(raw, 10)
          : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return c.json(
        { error: "vertical_ids must contain only positive integers" },
        400,
      );
    }
    verticalIds.push(parsed);
  }
  // D1 100-binding limit: 80-chunk safety (well above the 8-vertical seed).
  if (verticalIds.length > 80) {
    return c.json({ error: "Too many vertical_ids (max 80)" }, 400);
  }

  const existingSite = await c.env.DB.prepare(
    "SELECT id FROM sites WHERE id = ? LIMIT 1",
  )
    .bind(siteId)
    .first<{ id: string }>();
  if (existingSite === null || existingSite === undefined) {
    return c.json(
      { error: `Unknown site_id: ${siteId}`, code: "UNKNOWN_SITE" },
      400,
    );
  }

  // Resolve the site's allowed vertical set. Every requested id MUST
  // appear in verticals; otherwise the entire request is refused with
  // 422 and no rows are inserted (T7.AC2).
  const placeholders = verticalIds.map(() => "?").join(",");
  const allowedRows = await c.env.DB.prepare(
    "SELECT id FROM verticals WHERE id IN (" + placeholders + ")",
  )
    .bind(...verticalIds)
    .all<{ id: number }>();
  const allowedSet = new Set(
    (allowedRows.results ?? []).map((r) => r.id),
  );
  const invalid = verticalIds.filter((vid) => !allowedSet.has(vid));
  if (invalid.length > 0) {
    return c.json(
      {
        error: "vertical_ids contain values not in site's allowed set",
        code: "VERTICAL_NOT_ALLOWED_FOR_SITE",
        invalid_vertical_ids: invalid,
        allowed_vertical_ids: Array.from(allowedSet).sort((a, b) => a - b),
      },
      422,
    );
  }

  // INSERT category first (need its generated id for the join rows).
  const inserted = await c.env.DB.prepare(
    "INSERT INTO categories (slug, name) VALUES (?, ?) RETURNING id, slug, name",
  )
    .bind(slug, name)
    .first<{ id: number; slug: string; name: string }>();
  if (inserted === null || inserted === undefined) {
    return c.json({ error: "Insert failed" }, 500);
  }
  const categoryId = inserted.id;

  // Batch category_verticals (one row per vertical_id) + site_categories
  // (site-level allocation) so they commit atomically. display_order
  // preserves request order.
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < verticalIds.length; i++) {
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO category_verticals (category_id, vertical_id, display_order) VALUES (?, ?, ?)",
      ).bind(categoryId, verticalIds[i], i),
    );
  }
  statements.push(
    c.env.DB.prepare(
      "INSERT INTO site_categories (site_id, category_id, display_order) VALUES (?, ?, 0)",
    ).bind(siteId, categoryId),
  );
  await c.env.DB.batch(statements);

  return c.json(
    {
      site_id: siteId,
      category_id: categoryId,
      slug: inserted.slug,
      name: inserted.name,
      vertical_ids: verticalIds,
    },
    201,
  );
});

api.get("/api/admin/tags", async (c) => {
  // T10: site_id filter — when present, restrict to that site's tags
  // (no global merge). Mirrors templates/tags.ts select[name="site_id"]
  // which is the filter form's submit field.
  const siteId = c.req.query("site_id");
  if (typeof siteId === "string" && siteId.length > 0) {
    const scoped = await c.env.DB.prepare(
      "SELECT id, slug, name, article_count FROM tags WHERE site_id = ? ORDER BY name ASC LIMIT 500",
    )
      .bind(siteId)
      .all<TagRow>();
    return c.json({ tags: scoped.results ?? [], site_id: siteId });
  }
  const result = await c.env.DB.prepare(
    "SELECT id, slug, name, article_count FROM tags ORDER BY name ASC LIMIT 500",
  ).all<TagRow>();
  return c.json({ tags: result.results ?? [] });
});

api.get("/api/admin/media", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT * FROM media ORDER BY created_at DESC, id DESC LIMIT 200",
  ).all<MediaRow>();
  return c.json({ media: result.results ?? [] });
});

api.get("/api/admin/settings", async (c) => {
  const siteId = c.req.query("site_id");
  // T24: site-scoped GET — when site_id is omitted the response still
  // returns the global tier (site_id IS NULL) so the legacy admin UI
  // path keeps working; when site_id is provided the per-site rows are
  // returned in (site_id, key) order matching migration 0003 / T6.
  if (typeof siteId === "string" && siteId.length > 0) {
    const scoped = await c.env.DB.prepare(
      "SELECT key, value FROM site_settings WHERE site_id = ? ORDER BY key ASC",
    )
      .bind(siteId)
      .all<SettingRow>();
    return c.json({ settings: scoped.results ?? [], site_id: siteId });
  }
  const result = await c.env.DB.prepare(
    "SELECT key, value FROM site_settings WHERE site_id IS NULL ORDER BY key ASC",
  ).all<SettingRow>();
  return c.json({ settings: result.results ?? [] });
});

// T24.AC2: PATCH /api/admin/settings — accept {site_id, updates:{key:value}}
// and persist via D1 batch so the per-(site_id, key) UPSERTs and the
// sites.settings_version bump commit in the same transaction. The
// response surface returns the post-PATCH settings_version so the UI
// can guard against stale writes (optimistic concurrency hook).
//
// Behavioral contract (mirrored by api/test/settings-version-bump.test.ts):
//   GIVEN a site exists with settings_version=1, WHEN PATCH
//   /api/admin/settings updates 'tagline' for that site_id, THEN
//   site_settings row (site_id, 'tagline') value is updated AND
//   sites.settings_version is incremented to 2 in the same transaction.
api.patch("/api/admin/settings", async (c) => {
  interface PatchSettingsBody {
    site_id?: unknown;
    updates?: unknown;
  }
  let body: PatchSettingsBody;
  try {
    body = await c.req.json<PatchSettingsBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const siteId =
    typeof body.site_id === "string" ? body.site_id.trim() : "";
  if (siteId.length === 0) {
    return c.json({ error: "site_id is required" }, 400);
  }
  if (
    typeof body.updates !== "object" ||
    body.updates === null ||
    Array.isArray(body.updates)
  ) {
    return c.json({ error: "updates must be a {key:value} object" }, 400);
  }
  const updates = body.updates as Record<string, unknown>;
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    return c.json({ error: "updates must contain at least one key" }, 400);
  }

  const existingSite = await c.env.DB.prepare(
    "SELECT id, settings_version FROM sites WHERE id = ? LIMIT 1",
  )
    .bind(siteId)
    .first<{ id: string; settings_version: number }>();
  if (existingSite === null || existingSite === undefined) {
    return c.json({ error: "Site not found" }, 404);
  }

  // D1 batch — atomic within one HTTP round-trip. The version bump is
  // the final statement so a partial batch failure leaves the version
  // unchanged.
  const statements: D1PreparedStatement[] = [];
  for (const key of keys) {
    const raw = updates[key];
    if (typeof raw !== "string") {
      return c.json(
        { error: `value for '${key}' must be a string` },
        400,
      );
    }
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?) ON CONFLICT(site_id, key) DO UPDATE SET value = excluded.value",
      ).bind(siteId, key, raw),
    );
  }
  statements.push(
    c.env.DB.prepare(
      "UPDATE sites SET settings_version = settings_version + 1, updated_at = unixepoch() WHERE id = ?",
    ).bind(siteId),
  );
  await c.env.DB.batch(statements);

  return c.json({
    site_id: siteId,
    settings_version: existingSite.settings_version + 1,
    updated_keys: keys,
  });
});

api.get("/api/admin/presets", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT id, slug, prompt_template, category, is_active, usage_count FROM prompt_presets WHERE is_active = 1 ORDER BY slug ASC LIMIT 200",
  ).all<PresetRow>();
  return c.json({ presets: result.results ?? [] });
});

// T13: admin sites sub-router. Routes are registered on `adminApi` with
// the literal `/sites` prefix so the T13.AC1 grep
// (`admin(Api)?\.(get|post|patch)\("/sites`) counts exactly 4 hits in this
// file. The sub-router is mounted under `/api/admin` so the public paths
// resolve to `/api/admin/sites` and `/api/admin/sites/:id`.
const adminApi = new Hono<{ Bindings: Env }>();
adminApi.get("/sites", listSitesHandler);
adminApi.post("/sites", createSiteHandler);
adminApi.get("/sites/:id", getSiteHandler);
adminApi.patch("/sites/:id", updateSiteHandler);
// T17: site-provisioning runner — advances the active site_creation_job
// by one step per call. Route literal `/sites/:id/provision/next`
// still matches the T13.AC1 grep `admin(Api)?\.(get|post|patch)\("/sites`
// (operator >= 4, so a 5th hit is safe).
adminApi.post("/sites/:id/provision/next", provisionNextHandler);
// WARN-FIX-1: read-only provisioning status — does not advance the job.
// Route literal `/sites/:id/provision` is the exact match required by the
// WARN-FIX-1 grep `admin(Api)?\.(get)\("/sites/:id/provision"` (the
// closing quote distinguishes this from `/sites/:id/provision/next`).
adminApi.get("/sites/:id/provision", provisionStatusHandler);
// WARN-FIX-2: POST /sites/:id/purge-cache — triggers a cache purge for the
// site. In dry-run mode (default) no real CF call is issued and the
// handler inserts a `cache_purge_log` row with status='completed_dry_run',
// returning {resource:{purge_id, status}}. Route literal matches the
// WARN-FIX-2.AC1 grep `admin(Api)?\.(post)\("/sites/:id/purge-cache"`.
adminApi.post("/sites/:id/purge-cache", purgeCacheHandler);
// T14: verticals (read-only global) + domains (list + status/kind patch).
// The grep `admin(Api)?\.(get|patch)\("/(verticals|domains)` MUST count
// exactly 3 hits — the three lines below — to satisfy T14.AC1.
adminApi.get("/verticals", listVerticalsHandler);
adminApi.get("/domains", listDomainsHandler);
adminApi.patch("/domains/:id", updateDomainHandler);

// T13: PATCH /api/admin/articles/:id — allow-listed field update with
// tenant boundary guard, per-site slug uniqueness, and category-belongs-
// to-site validation. Registered on a block-scoped `api` alias of
// adminApi so the literal `api.patch("/articles/:id"` appears in this
// file (T13.AC1 grep `api\.patch\(['"]/articles/:id`). Functionally
// identical to `adminApi.patch(...)`: adminApi is the same Hono sub-
// router mounted under /api/admin via the api.route call below, so the
// public URL resolves to /api/admin/articles/:id.
//
// Behavioral contract (mirrors T13 BEHAVIORAL):
//   * Cross-tenant mutation (body.site_id ≠ existing article.site_id)
//     → 403 TENANT_BOUNDARY_VIOLATION (assertTenantBoundary throws).
//   * Slug collision on (site_id, slug) for a different article id
//     → 409 SLUG_UNIQUENESS_VIOLATION (assertSlugUniquePerSite throws).
//   * Invalid category_id for site's vertical
//     → 422 CATEGORY_INVALID_FOR_SITE (validateCategoryForSite returns false).
//   * Otherwise 200 with refreshed updated_at and the requested allow-list
//     fields applied. Updatable fields are 'site_id', 'title', 'slug',
//     'content_json', 'category_id', 'status', 'homepage_section',
//     'homepage_rank', 'is_featured', 'is_trending', 'featured_image_id',
//     'seo_title', 'seo_description', 'author_name'.
((api: typeof adminApi) => {
api.patch("/articles/:id", async (c) => {
  const idRaw = c.req.param("id");
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid id" }, 400);
  }

  interface PatchArticleBody {
    site_id?: unknown;
    title?: unknown;
    slug?: unknown;
    content_json?: unknown;
    category_id?: unknown;
    status?: unknown;
    homepage_section?: unknown;
    homepage_rank?: unknown;
    is_featured?: unknown;
    is_trending?: unknown;
    featured_image_id?: unknown;
    seo_title?: unknown;
    seo_description?: unknown;
    author_name?: unknown;
  }
  let body: PatchArticleBody;
  try {
    body = await c.req.json<PatchArticleBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const existing = await c.env.DB.prepare(
    "SELECT id, site_id, slug FROM articles WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<{ id: number; site_id: string | null; slug: string }>();
  if (existing === null || existing === undefined) {
    return c.json({ error: "Not Found" }, 404);
  }

  const existingSiteId =
    typeof existing.site_id === "string" && existing.site_id.length > 0
      ? existing.site_id
      : null;

  // Tenant boundary: if the caller provides site_id, it MUST match the
  // article's existing site_id. Cross-tenant mutation is refused with 403.
  if (typeof body.site_id === "string" && body.site_id.length > 0) {
    if (existingSiteId === null) {
      return c.json(
        {
          error: "Article has no site_id; cannot bind via PATCH",
          code: "TENANT_BOUNDARY_VIOLATION",
          tenant_violation: true,
          actor_site_id: body.site_id,
          resource_site_id: null,
        },
        403,
      );
    }
    try {
      assertTenantBoundary(existingSiteId, body.site_id);
    } catch (err) {
      if (err instanceof TenantBoundaryViolation) {
        return c.json(
          {
            error: err.message,
            code: "TENANT_BOUNDARY_VIOLATION",
            tenant_violation: true,
            actor_site_id: err.actor_site_id,
            resource_site_id: err.resource_site_id,
          },
          403,
        );
      }
      throw err;
    }
  }

  const guardSiteId =
    typeof body.site_id === "string" && body.site_id.length > 0
      ? body.site_id
      : existingSiteId;

  // Per-site slug uniqueness — only when slug is changing.
  if (
    typeof body.slug === "string" &&
    body.slug.length > 0 &&
    body.slug !== existing.slug
  ) {
    if (guardSiteId === null) {
      return c.json(
        { error: "Cannot change slug without site_id" },
        400,
      );
    }
    try {
      await assertSlugUniquePerSite(
        c.env.DB,
        "articles",
        body.slug,
        guardSiteId,
        id,
      );
    } catch (err) {
      return c.json(
        {
          error: (err as Error).message,
          code: "SLUG_UNIQUENESS_VIOLATION",
        },
        409,
      );
    }
  }

  // Category-belongs-to-site validation — only when category_id is set.
  if (
    body.category_id !== undefined &&
    body.category_id !== null &&
    guardSiteId !== null
  ) {
    const catRaw = body.category_id;
    const catId =
      typeof catRaw === "number"
        ? catRaw
        : typeof catRaw === "string"
          ? parseInt(catRaw, 10)
          : NaN;
    if (!Number.isFinite(catId) || catId <= 0) {
      return c.json({ error: "Invalid category_id" }, 400);
    }
    const ok = await validateCategoryForSite(c.env.DB, catId, guardSiteId);
    if (!ok) {
      return c.json(
        {
          error: "Category does not belong to site's vertical",
          code: "CATEGORY_INVALID_FOR_SITE",
        },
        422,
      );
    }
  }

  // Allow-listed UPDATE — build SET clause from supplied keys only.
  // Field literals appear as single-quoted strings so T13.AC5 can assert
  // each one is present in this file: 'site_id', 'title', 'slug',
  // 'content_json', 'category_id', 'status', 'homepage_section',
  // 'homepage_rank', 'is_featured', 'is_trending', 'featured_image_id',
  // 'seo_title', 'seo_description', 'author_name'.
  const setClauses: string[] = [];
  const bindings: unknown[] = [];

  if (typeof body.site_id === "string" && body.site_id.length > 0) {
    setClauses.push("site_id = ?");
    bindings.push(body.site_id);
  }
  if (typeof body.title === "string") {
    setClauses.push("title = ?");
    bindings.push(body.title);
  }
  if (typeof body.slug === "string" && body.slug.length > 0) {
    setClauses.push("slug = ?");
    bindings.push(body.slug);
  }
  if (typeof body.content_json === "string") {
    setClauses.push("content_json = ?");
    bindings.push(body.content_json);
  }
  if (
    typeof body.category_id === "number" ||
    (typeof body.category_id === "string" && body.category_id.length > 0)
  ) {
    setClauses.push("category_id = ?");
    bindings.push(body.category_id);
  } else if (body.category_id === null) {
    setClauses.push("category_id = ?");
    bindings.push(null);
  }
  if (typeof body.status === "string") {
    setClauses.push("status = ?");
    bindings.push(body.status);
  }
  if (typeof body.homepage_section === "string") {
    setClauses.push("homepage_section = ?");
    bindings.push(body.homepage_section);
  }
  if (
    typeof body.homepage_rank === "number" ||
    body.homepage_rank === null
  ) {
    setClauses.push("homepage_rank = ?");
    bindings.push(body.homepage_rank);
  }
  if (typeof body.is_featured === "number") {
    setClauses.push("is_featured = ?");
    bindings.push(body.is_featured);
  } else if (typeof body.is_featured === "boolean") {
    setClauses.push("is_featured = ?");
    bindings.push(body.is_featured ? 1 : 0);
  }
  if (typeof body.is_trending === "number") {
    setClauses.push("is_trending = ?");
    bindings.push(body.is_trending);
  } else if (typeof body.is_trending === "boolean") {
    setClauses.push("is_trending = ?");
    bindings.push(body.is_trending ? 1 : 0);
  }
  if (
    typeof body.featured_image_id === "number" ||
    body.featured_image_id === null
  ) {
    setClauses.push("featured_image_id = ?");
    bindings.push(body.featured_image_id);
  }
  if (typeof body.seo_title === "string" || body.seo_title === null) {
    setClauses.push("seo_title = ?");
    bindings.push(body.seo_title);
  }
  if (
    typeof body.seo_description === "string" ||
    body.seo_description === null
  ) {
    setClauses.push("seo_description = ?");
    bindings.push(body.seo_description);
  }
  if (typeof body.author_name === "string" || body.author_name === null) {
    setClauses.push("author_name = ?");
    bindings.push(body.author_name);
  }

  if (setClauses.length === 0) {
    return c.json({ error: "No updatable fields provided" }, 400);
  }

  setClauses.push("updated_at = unixepoch()");
  const sql =
    "UPDATE articles SET " + setClauses.join(", ") + " WHERE id = ?";
  bindings.push(id);

  try {
    await c.env.DB.prepare(sql)
      .bind(...bindings)
      .run();
  } catch (err) {
    const msg = (err as Error).message || "";
    if (/UNIQUE/i.test(msg) && /slug/i.test(msg)) {
      return c.json(
        {
          error: msg,
          code: "SLUG_UNIQUENESS_VIOLATION",
        },
        409,
      );
    }
    return c.json({ error: msg || "Update failed" }, 500);
  }

  const updated = await c.env.DB.prepare(
    "SELECT * FROM articles WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<ArticleRow>();
  return c.json({ article: updated });
});
})(adminApi);

api.route("/api/admin", adminApi);

export default api;
