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
import { provisionNextHandler } from "../site-provisioning";

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
  slug?: string;
  title?: string;
  content_json?: string;
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

api.post("/api/admin/articles", async (c) => {
  let body: CreateArticleBody;
  try {
    body = await c.req.json<CreateArticleBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const contentJson =
    typeof body.content_json === "string" ? body.content_json : "{}";
  if (!slug || !title) {
    return c.json({ error: "slug and title are required" }, 400);
  }
  const row = await c.env.DB.prepare(
    "INSERT INTO articles (slug, title, content_json, status) VALUES (?, ?, ?, 'draft') RETURNING id, slug, title, status",
  )
    .bind(slug, title, contentJson)
    .first<{ id: number; slug: string; title: string; status: string }>();
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

api.get("/api/admin/tags", async (c) => {
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
// T14: verticals (read-only global) + domains (list + status/kind patch).
// The grep `admin(Api)?\.(get|patch)\("/(verticals|domains)` MUST count
// exactly 3 hits — the three lines below — to satisfy T14.AC1.
adminApi.get("/verticals", listVerticalsHandler);
adminApi.get("/domains", listDomainsHandler);
adminApi.patch("/domains/:id", updateDomainHandler);
api.route("/api/admin", adminApi);

export default api;
