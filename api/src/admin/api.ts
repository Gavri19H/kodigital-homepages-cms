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
  const result = await c.env.DB.prepare(
    "SELECT key, value FROM site_settings ORDER BY key ASC",
  ).all<SettingRow>();
  return c.json({ settings: result.results ?? [] });
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
api.route("/api/admin", adminApi);

export default api;
