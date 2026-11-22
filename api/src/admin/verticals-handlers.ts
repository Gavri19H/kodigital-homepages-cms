// X01 Part C (owner, 22 Nov 2026): manage verticals in the CMS.
//
//   POST   /api/admin/verticals               "Add vertical"
//   DELETE /api/admin/verticals/:id           "Delete" (refused while in use)
//   POST   /api/admin/articles/bulk-vertical  Articles → "Set vertical"
//
// plus the one shared rule for "which vertical does this Article use":
// the Article's own vertical (articles.vertical_id) when set, else its Site's
// (sites.vertical_slug). The AI writer's {{vertical}}, the Articles "All
// verticals" filter, the Verticals screen's Articles count and the delete
// guard all use this same rule.
//
// Every D1 call is `db.prepare(<static SQL>).bind(...)`; the only dynamic SQL
// is a run of "?" placeholders for the bulk update, bounded by
// BULK_CHUNK_SIZE so a statement never passes D1's 100-binding limit.

import type { Context } from "hono";
import type { Env } from "../env";

type Ctx = Context<{ Bindings: Env }>;

// Lowercase letters and numbers, single dashes between words.
export const VERTICAL_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 64;
const MAX_NAME_LENGTH = 80;

// The Articles list shows at most 200 rows a page, so one "Set vertical"
// never needs more. Each UPDATE binds the vertical + up to 80 ids (81 < 100).
export const BULK_MAX_ARTICLES = 200;
const BULK_CHUNK_SIZE = 80;

export interface VerticalRow {
  id: number;
  slug: string;
  name: string;
  display_order: number;
}

export interface VerticalUsage {
  site_count: number;
  category_count: number;
  article_count: number;
}

// Articles that use a vertical = Articles whose own vertical is it, plus
// Articles with no own vertical whose Site uses it. Both count because both
// feed that vertical to the AI writer. Bind order: vertical id, vertical slug.
export const ARTICLES_USING_VERTICAL_WHERE =
  "(a.vertical_id = ? OR (a.vertical_id IS NULL AND a.site_id IN (SELECT s.id FROM sites s WHERE s.vertical_slug = ?)))";

// The same rule keyed by slug (the Articles "All verticals" filter sends a
// slug). Bind order: vertical slug, vertical slug.
export const ARTICLES_USING_VERTICAL_SLUG_WHERE =
  "(a.vertical_id IN (SELECT v.id FROM verticals v WHERE v.slug = ?) OR (a.vertical_id IS NULL AND a.site_id IN (SELECT s.id FROM sites s WHERE s.vertical_slug = ?)))";

export async function getVerticalUsage(
  db: D1Database,
  vertical: { id: number; slug: string },
): Promise<VerticalUsage> {
  const row = await db
    .prepare(
      "SELECT " +
        "(SELECT COUNT(*) FROM sites WHERE vertical_slug = ?) AS site_count, " +
        "(SELECT COUNT(*) FROM category_verticals WHERE vertical_id = ?) AS category_count, " +
        "(SELECT COUNT(*) FROM articles a WHERE " +
        ARTICLES_USING_VERTICAL_WHERE +
        ") AS article_count",
    )
    .bind(vertical.slug, vertical.id, vertical.id, vertical.slug)
    .first<VerticalUsage>();
  return {
    site_count: Number(row?.site_count ?? 0),
    category_count: Number(row?.category_count ?? 0),
    article_count: Number(row?.article_count ?? 0),
  };
}

export function verticalInUseMessage(siteCount: number, articleCount: number): string {
  return (
    "Cannot delete vertical in use. Move its Sites and Articles first. (" +
    String(siteCount) +
    " Sites, " +
    String(articleCount) +
    " Articles)"
  );
}

function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw === "string" && /^[0-9]+$/.test(raw.trim())) {
    const n = Number(raw.trim());
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  return null;
}

// Reads an Article-vertical value from a request body.
//   undefined          → { kind: "absent" }  (leave the stored value alone)
//   null / ""          → { kind: "clear" }   ("Same as site")
//   id of a vertical   → { kind: "set", id }
//   anything else      → { kind: "invalid" } / { kind: "unknown" }
export type ArticleVerticalInput =
  | { kind: "absent" }
  | { kind: "clear" }
  | { kind: "set"; id: number }
  | { kind: "invalid" }
  | { kind: "unknown" };

export async function readArticleVerticalInput(
  db: D1Database,
  raw: unknown,
): Promise<ArticleVerticalInput> {
  if (raw === undefined) return { kind: "absent" };
  if (raw === null || raw === "") return { kind: "clear" };
  const id = parsePositiveInt(raw);
  if (id === null) return { kind: "invalid" };
  const row = await db
    .prepare("SELECT id FROM verticals WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: number }>();
  if (row === null || row === undefined) return { kind: "unknown" };
  return { kind: "set", id };
}

export function articleVerticalInputError(
  input: ArticleVerticalInput,
): { error: string; code: string } | null {
  if (input.kind === "invalid") {
    return { error: "vertical_id must be a vertical id or empty", code: "INVALID_VERTICAL" };
  }
  if (input.kind === "unknown") {
    return { error: "Unknown vertical", code: "UNKNOWN_VERTICAL" };
  }
  return null;
}

// The vertical slug an Article writes with: the Article's own vertical when
// set, else its Site's. `override` is the editor's current (maybe unsaved)
// "Vertical" choice: a vertical id, or null for "Same as site"; undefined
// means "use what the Article has saved".
export async function resolveArticleVerticalSlug(
  db: D1Database,
  opts: {
    siteVerticalSlug: string;
    articleId?: number | null;
    override?: number | null;
  },
): Promise<string> {
  let verticalId: number | null = null;
  if (opts.override !== undefined) {
    verticalId = opts.override;
  } else if (typeof opts.articleId === "number" && opts.articleId > 0) {
    const art = await db
      .prepare("SELECT vertical_id FROM articles WHERE id = ? LIMIT 1")
      .bind(opts.articleId)
      .first<{ vertical_id: number | null }>();
    verticalId = art && typeof art.vertical_id === "number" ? art.vertical_id : null;
  }
  if (verticalId !== null) {
    const v = await db
      .prepare("SELECT slug FROM verticals WHERE id = ? LIMIT 1")
      .bind(verticalId)
      .first<{ slug: string }>();
    if (v && typeof v.slug === "string" && v.slug.length > 0) return v.slug;
  }
  return opts.siteVerticalSlug;
}

// Parses the optional { article_id, vertical_id } pair the AI panel sends
// alongside site_id. vertical_id present → the editor's live choice wins
// (null/"" = "Same as site"); absent → the Article's saved vertical.
export function readAiVerticalContext(body: {
  article_id?: unknown;
  vertical_id?: unknown;
}): { articleId: number | null; override: number | null | undefined } {
  const articleId = parsePositiveInt(body.article_id);
  let override: number | null | undefined;
  if (body.vertical_id === undefined) override = undefined;
  else if (body.vertical_id === null || body.vertical_id === "") override = null;
  else override = parsePositiveInt(body.vertical_id) ?? undefined;
  return { articleId, override };
}

// POST /api/admin/verticals { name, slug } → 201 { resource }.
// 400 missing name / bad slug; 409 VERTICAL_SLUG_TAKEN. The new vertical goes
// to the end of the list (display_order = current max + 1).
export async function createVerticalHandler(c: Ctx): Promise<Response> {
  let body: { name?: unknown; slug?: unknown };
  try {
    body = await c.req.json<{ name?: unknown; slug?: unknown }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (name.length === 0) {
    return c.json({ error: "Name is required", code: "NAME_REQUIRED" }, 400);
  }
  if (name.length > MAX_NAME_LENGTH) {
    return c.json(
      { error: "Name is too long (max " + String(MAX_NAME_LENGTH) + " characters)", code: "NAME_TOO_LONG" },
      400,
    );
  }
  if (slug.length === 0 || slug.length > MAX_SLUG_LENGTH || !VERTICAL_SLUG_PATTERN.test(slug)) {
    return c.json(
      {
        error: "Slug must use lowercase letters, numbers and dashes (for example: home-insurance)",
        code: "INVALID_SLUG",
      },
      400,
    );
  }
  const taken = await c.env.DB.prepare("SELECT id FROM verticals WHERE slug = ? LIMIT 1")
    .bind(slug)
    .first<{ id: number }>();
  if (taken !== null && taken !== undefined) {
    return c.json(
      { error: 'Slug "' + slug + '" is already used by another vertical', code: "VERTICAL_SLUG_TAKEN" },
      409,
    );
  }
  let row: VerticalRow | null;
  try {
    row = await c.env.DB.prepare(
      "INSERT INTO verticals (slug, name, display_order) SELECT ?, ?, COALESCE(MAX(display_order), 0) + 1 FROM verticals RETURNING id, slug, name, display_order",
    )
      .bind(slug, name)
      .first<VerticalRow>();
  } catch (err) {
    // Two adds racing for the same slug: the UNIQUE index decides.
    if (/UNIQUE/i.test((err as Error).message ?? "")) {
      return c.json(
        { error: 'Slug "' + slug + '" is already used by another vertical', code: "VERTICAL_SLUG_TAKEN" },
        409,
      );
    }
    return c.json({ error: "Failed to add vertical" }, 500);
  }
  if (row === null || row === undefined) {
    return c.json({ error: "Failed to add vertical" }, 500);
  }
  return c.json({ resource: row }, 201);
}

// DELETE /api/admin/verticals/:id → 200 { ok, id, categories_unlinked }.
// 404 unknown; 409 VERTICAL_IN_USE while any Site or Article uses it (it never
// moves Sites or Articles by itself). The Category links go with it, in the
// same atomic batch; both statements repeat the in-use check, so a Site or
// Article that starts using the vertical mid-request makes the batch a no-op.
export async function deleteVerticalHandler(c: Ctx): Promise<Response> {
  const id = parsePositiveInt(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid vertical id" }, 400);

  const vertical = await c.env.DB.prepare(
    "SELECT id, slug, name, display_order FROM verticals WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<VerticalRow>();
  if (vertical === null || vertical === undefined) {
    return c.json({ error: "Vertical not found" }, 404);
  }

  const usage = await getVerticalUsage(c.env.DB, vertical);
  if (usage.site_count > 0 || usage.article_count > 0) {
    return c.json(
      {
        error: verticalInUseMessage(usage.site_count, usage.article_count),
        code: "VERTICAL_IN_USE",
        site_count: usage.site_count,
        article_count: usage.article_count,
      },
      409,
    );
  }

  const NOT_IN_USE =
    "NOT EXISTS (SELECT 1 FROM sites WHERE vertical_slug = ?) AND NOT EXISTS (SELECT 1 FROM articles WHERE vertical_id = ?)";
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM category_verticals WHERE vertical_id = ? AND " + NOT_IN_USE,
    ).bind(id, vertical.slug, id),
    c.env.DB.prepare("DELETE FROM verticals WHERE id = ? AND " + NOT_IN_USE).bind(
      id,
      vertical.slug,
      id,
    ),
  ]);
  const deleted = Number(
    (results[1] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0,
  );
  if (deleted === 0) {
    const now = await getVerticalUsage(c.env.DB, vertical);
    return c.json(
      {
        error: verticalInUseMessage(now.site_count, now.article_count),
        code: "VERTICAL_IN_USE",
        site_count: now.site_count,
        article_count: now.article_count,
      },
      409,
    );
  }
  return c.json({ ok: true, id, categories_unlinked: usage.category_count });
}

// POST /api/admin/articles/bulk-vertical { article_ids, vertical_id|null }
// → 200 { ok, updated, requested }. Changes only the ticked Articles, and only
// their vertical (null = "Same as site"). updated_at is left alone: the
// vertical is admin-only and not shown on the site, so it should not reorder
// lists or move sitemap dates. All chunks run in one atomic D1 batch.
export async function bulkSetArticleVerticalHandler(c: Ctx): Promise<Response> {
  let body: { article_ids?: unknown; vertical_id?: unknown };
  try {
    body = await c.req.json<{ article_ids?: unknown; vertical_id?: unknown }>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.article_ids) || body.article_ids.length === 0) {
    return c.json({ error: "Tick at least one Article", code: "NO_ARTICLES" }, 400);
  }
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const raw of body.article_ids) {
    const n = parsePositiveInt(raw);
    if (n === null) {
      return c.json({ error: "article_ids must be Article ids", code: "INVALID_ARTICLE_IDS" }, 400);
    }
    if (!seen.has(n)) {
      seen.add(n);
      ids.push(n);
    }
  }
  if (ids.length > BULK_MAX_ARTICLES) {
    return c.json(
      {
        error: "Too many Articles at once (max " + String(BULK_MAX_ARTICLES) + ")",
        code: "TOO_MANY_ARTICLES",
      },
      400,
    );
  }
  if (body.vertical_id === undefined) {
    return c.json({ error: "vertical_id is required (empty for Same as site)", code: "INVALID_VERTICAL" }, 400);
  }
  const input = await readArticleVerticalInput(c.env.DB, body.vertical_id);
  const inputErr = articleVerticalInputError(input);
  if (inputErr !== null) return c.json(inputErr, 400);
  const verticalId = input.kind === "set" ? input.id : null;

  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < ids.length; i += BULK_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + BULK_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(",");
    statements.push(
      c.env.DB.prepare(
        "UPDATE articles SET vertical_id = ? WHERE id IN (" + placeholders + ")",
      ).bind(verticalId, ...chunk),
    );
  }
  const results = await c.env.DB.batch(statements);
  let updated = 0;
  for (const r of results) {
    updated += Number((r as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0);
  }
  return c.json({ ok: true, updated, requested: ids.length, vertical_id: verticalId });
}
