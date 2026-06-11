// T30 ([B9] Categories + Tags port + CRUD completion): admin taxonomy
// write handlers.
//
// Backs the four route registrations in ./api.ts:
//   PUT    /api/admin/categories/:id -> updateCategoryHandler
//   DELETE /api/admin/categories/:id -> deleteCategoryHandler
//   POST   /api/admin/tags           -> createTagHandler
//   DELETE /api/admin/tags/:id       -> deleteTagHandler
// (port of the legacy admin/api.ts categories/tags verbs, adapted to the
// Phase-3 tenant model). Split out of api.ts per the sites-handlers.ts /
// pages-crud-handlers.ts file-size precedent.
//
// Tenant + safety contract:
//   1. Categories carry NO site_id column — site scoping flows through
//      the site_categories allocation join (0002). When a request names
//      a site_id, the handler verifies that site actually has the
//      category allocated; a mismatch is refused with 403
//      TENANT_BOUNDARY_VIOLATION rather than silently mutating another
//      tenant's taxonomy.
//   2. Tags DO carry site_id (0002), nullable for the global tier. A
//      DELETE that names a site_id may not remove a tag owned by a
//      different site (403); POST verifies a provided site_id resolves
//      in `sites` (400 UNKNOWN_SITE — T7 categories-POST precedent).
//   3. tags.slug kept its 0001 column-level UNIQUE through the 0007
//      rebuild (0007 only recreated articles + pages), so the POST slug
//      probe is GLOBAL — a per-site-only probe would surface a 500 from
//      the sqlite_autoindex instead of the typed 409.
//   4. Category delete-guard: the categories row's article_count column
//      is read first; a category with articles is refused with 400
//      CATEGORY_HAS_ARTICLES (legacy port: "Move or delete articles
//      first."). Join rows (category_verticals, site_categories) are
//      removed in the same D1 batch as the categories row.
//   5. Every D1 statement is `db.prepare(<static SQL>).bind(...)` — no
//      template-literal SQL (d1-database-safety).

import type { Context } from "hono";
import type { Env } from "../env";

export interface CategoryCrudRow {
  id: number;
  slug: string;
  name: string;
  parent_id: number | null;
  featured_image_id: number | null;
  display_order: number;
  article_count: number;
}

export interface TagCrudRow {
  id: number;
  slug: string;
  name: string;
  site_id: string | null;
  article_count: number;
}

interface CategoryUpdateBody {
  site_id?: unknown;
  slug?: unknown;
  name?: unknown;
  parent_id?: unknown;
  featured_image_id?: unknown;
  display_order?: unknown;
}

interface TagCreateBody {
  site_id?: unknown;
  name?: unknown;
  slug?: unknown;
}

const CATEGORY_COLUMNS =
  "id, slug, name, parent_id, featured_image_id, display_order, article_count";

// Legacy isValidId port: positive decimal integer route param.
function parseNumericId(raw: string | undefined): number | null {
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// Legacy generateSlug(name, 50) port — pages-crud-handlers parity.
function generateSlug(name: string, maxLen: number): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "tag";
}

// Nullable-int body field: returns {provided, value} so PUT can
// distinguish "absent → retain" from "null → clear".
function readNullableInt(
  body: Record<string, unknown>,
  key: string,
): { provided: boolean; value: number | null; valid: boolean } {
  if (!(key in body)) return { provided: false, value: null, valid: true };
  const raw = body[key];
  if (raw === null) return { provided: true, value: null, valid: true };
  const parsed =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.length > 0
        ? parseInt(raw, 10)
        : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { provided: true, value: null, valid: false };
  }
  return { provided: true, value: Math.floor(parsed), valid: true };
}

// site_categories allocation probe — the categories tenant boundary.
async function siteHasCategory(
  db: D1Database,
  siteId: string,
  categoryId: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT category_id FROM site_categories WHERE site_id = ? AND category_id = ? LIMIT 1",
    )
    .bind(siteId, categoryId)
    .first<{ category_id: number }>();
  return row !== null && row !== undefined;
}

// PUT /api/admin/categories/:id — partial field update (slug, name,
// parent_id, featured_image_id, display_order; absent fields are
// RETAINED). 400 invalid id/body; 403 tenant mismatch when a site_id is
// named; 404 unknown category; 409 slug collision.
export async function updateCategoryHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const id = parseNumericId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid category ID" }, 400);

  let body: CategoryUpdateBody;
  try {
    body = await c.req.json<CategoryUpdateBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const existing = await c.env.DB.prepare(
    "SELECT id, slug, name, parent_id, featured_image_id, display_order, article_count FROM categories WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<CategoryCrudRow>();
  if (existing === null || existing === undefined) {
    return c.json({ error: "Category not found" }, 404);
  }

  const siteId =
    typeof body.site_id === "string" && body.site_id.trim().length > 0
      ? body.site_id.trim()
      : null;
  if (siteId !== null && !(await siteHasCategory(c.env.DB, siteId, id))) {
    return c.json(
      {
        error: "Category is not allocated to this site",
        code: "TENANT_BOUNDARY_VIOLATION",
      },
      403,
    );
  }

  const nextSlug =
    typeof body.slug === "string" && body.slug.trim().length > 0
      ? body.slug.trim()
      : existing.slug;
  const nextName =
    typeof body.name === "string" && body.name.trim().length > 0
      ? body.name.trim()
      : existing.name;

  if (nextSlug !== existing.slug) {
    const slugTaken = await c.env.DB.prepare(
      "SELECT id FROM categories WHERE slug = ? AND id <> ? LIMIT 1",
    )
      .bind(nextSlug, id)
      .first<{ id: number }>();
    if (slugTaken !== null && slugTaken !== undefined) {
      return c.json(
        { error: "A category with this slug already exists" },
        409,
      );
    }
  }

  const fields = body as Record<string, unknown>;
  const parentField = readNullableInt(fields, "parent_id");
  if (!parentField.valid || parentField.value === id) {
    return c.json({ error: "Invalid parent_id" }, 400);
  }
  const imageField = readNullableInt(fields, "featured_image_id");
  if (!imageField.valid) {
    return c.json({ error: "Invalid featured_image_id" }, 400);
  }
  const orderField = readNullableInt(fields, "display_order");
  if (!orderField.valid) {
    return c.json({ error: "Invalid display_order" }, 400);
  }

  const nextParent = parentField.provided
    ? parentField.value
    : existing.parent_id;
  const nextImage = imageField.provided
    ? imageField.value
    : existing.featured_image_id;
  const nextOrder =
    orderField.provided && orderField.value !== null
      ? orderField.value
      : existing.display_order;

  await c.env.DB.prepare(
    "UPDATE categories SET slug = ?, name = ?, parent_id = ?, featured_image_id = ?, display_order = ? WHERE id = ?",
  )
    .bind(nextSlug, nextName, nextParent, nextImage, nextOrder, id)
    .run();

  const updated = await c.env.DB.prepare(
    "SELECT " + CATEGORY_COLUMNS + " FROM categories WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<CategoryCrudRow>();
  return c.json({ item: updated ?? null });
}

// DELETE /api/admin/categories/:id — delete-guard on article_count, then
// remove the join rows + the category atomically. 400 invalid id or
// guard refusal; 403 tenant mismatch (?site_id=); 404 unknown category;
// 200 { ok, id } on success (NOT the legacy 204 — the admin layout's
// window.api json()-parses every response; deletePageHandler precedent).
export async function deleteCategoryHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const id = parseNumericId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid category ID" }, 400);

  const existing = await c.env.DB.prepare(
    "SELECT id, article_count FROM categories WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<{ id: number; article_count: number }>();
  if (existing === null || existing === undefined) {
    return c.json({ error: "Category not found" }, 404);
  }

  const siteId = c.req.query("site_id");
  if (
    typeof siteId === "string" &&
    siteId.length > 0 &&
    !(await siteHasCategory(c.env.DB, siteId, id))
  ) {
    return c.json(
      {
        error: "Category is not allocated to this site",
        code: "TENANT_BOUNDARY_VIOLATION",
      },
      403,
    );
  }

  // Delete-guard: the categories row's own article_count column is the
  // authority (maintained by the article write paths). Refuse while
  // articles still reference the category.
  if ((existing.article_count ?? 0) > 0) {
    return c.json(
      {
        error:
          "Cannot delete category with articles. Move or delete articles first.",
        code: "CATEGORY_HAS_ARTICLES",
        article_count: existing.article_count,
      },
      400,
    );
  }

  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM category_verticals WHERE category_id = ?",
    ).bind(id),
    c.env.DB.prepare("DELETE FROM site_categories WHERE category_id = ?").bind(
      id,
    ),
    c.env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(id),
  ]);

  return c.json({ ok: true, id });
}

// POST /api/admin/tags — create a tag (site-scoped via tags.site_id, or
// global when site_id is omitted). 400 invalid body / missing name /
// unknown site; 409 global slug collision (schema note 3); 201 { item }.
export async function createTagHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  let body: TagCreateBody;
  try {
    body = await c.req.json<TagCreateBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return c.json({ error: "Name is required" }, 400);

  const slug =
    typeof body.slug === "string" && body.slug.trim().length > 0
      ? body.slug.trim()
      : generateSlug(name, 50);

  const siteId =
    typeof body.site_id === "string" && body.site_id.trim().length > 0
      ? body.site_id.trim()
      : null;
  if (siteId !== null) {
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
  }

  const slugTaken = await c.env.DB.prepare(
    "SELECT id FROM tags WHERE slug = ? LIMIT 1",
  )
    .bind(slug)
    .first<{ id: number }>();
  if (slugTaken !== null && slugTaken !== undefined) {
    return c.json({ error: "A tag with this slug already exists" }, 409);
  }

  const inserted = await c.env.DB.prepare(
    "INSERT INTO tags (slug, name, site_id) VALUES (?, ?, ?) RETURNING id, slug, name, site_id, article_count",
  )
    .bind(slug, name, siteId)
    .first<TagCrudRow>();
  if (inserted === null || inserted === undefined) {
    return c.json({ error: "Insert failed" }, 500);
  }

  return c.json({ item: inserted }, 201);
}

// DELETE /api/admin/tags/:id — remove the tag + its article_tags join
// rows atomically. 400 invalid id; 403 tenant mismatch (?site_id= names
// a site that does not own the tag); 404 unknown tag; 200 { ok, id } on
// success (window.api json()-parse, deletePageHandler precedent).
export async function deleteTagHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const id = parseNumericId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid tag ID" }, 400);

  const existing = await c.env.DB.prepare(
    "SELECT id, site_id FROM tags WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<{ id: number; site_id: string | null }>();
  if (existing === null || existing === undefined) {
    return c.json({ error: "Tag not found" }, 404);
  }

  const siteId = c.req.query("site_id");
  if (
    typeof siteId === "string" &&
    siteId.length > 0 &&
    existing.site_id !== null &&
    existing.site_id !== siteId
  ) {
    return c.json(
      {
        error: "Tag belongs to a different site",
        code: "TENANT_BOUNDARY_VIOLATION",
      },
      403,
    );
  }

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM article_tags WHERE tag_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM tags WHERE id = ?").bind(id),
  ]);

  return c.json({ ok: true, id });
}
