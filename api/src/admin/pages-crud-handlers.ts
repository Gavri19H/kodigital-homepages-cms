// T29 ([B8] Pages port + CRUD): admin pages write handlers.
//
// Backs the three route registrations in ./api.ts:
//   POST   /api/admin/pages      -> createPageHandler
//   PATCH  /api/admin/pages/:id  -> updatePageHandler
//   DELETE /api/admin/pages/:id  -> deletePageHandler
// (port of the legacy admin/api.ts pages verbs, adapted to the Phase-3
// tenant model). Split out of api.ts per the sites-handlers.ts file-size
// precedent.
//
// Tenant + safety contract:
//   1. Legal page_types (privacy-policy, terms, do-not-sell, contact,
//      legal) may be GLOBAL templates (site_id NULL). Every other
//      page_type requires a site_id that resolves in `sites` — mirrors
//      the pageFormPage client-side rule, enforced server-side.
//   2. Slug uniqueness is per-site (assertSlugUniquePerSite) for
//      site-scoped pages and per-global-tier (site_id IS NULL) for
//      global templates -> 409 SLUG_UNIQUENESS_VIOLATION.
//   3. Cross-tenant moves are refused with 403 TENANT_BOUNDARY_VIOLATION.
//      Unlike articles, a GLOBAL page (site_id NULL) MAY adopt a site via
//      PATCH (legal template -> site page is a legitimate flow); a page
//      already owned by site A can never move to site B.
//   4. PATCH is allow-list partial update: fields absent from the body
//      are RETAINED (page_type retention is a T29.AC1 contract term).
//   5. Every D1 statement is `db.prepare(<static SQL>).bind(...)` — no
//      template-literal SQL (d1-database-safety).
//   6. After a successful write touching a site-owned page, the handler
//      calls applyPageMutationCacheInvalidation (content_version bump +
//      per-site cache wipe — see ./pages.ts). Global templates have no
//      owning site, so there is no per-site namespace to invalidate.

import type { Context } from "hono";
import type { Env } from "../env";
import {
  TenantBoundaryViolation,
  assertSlugUniquePerSite,
  assertTenantBoundary,
} from "../site/tenant-guards";
import { applyPageMutationCacheInvalidation } from "./pages";

// Wire vocabulary — mirrors PAGE_TYPES / LEGAL_PAGE_TYPES / the DB CHECK
// constraint. The form's "pending" status option is NOT DB-legal (pages
// CHECK allows draft|published|archived), so it is rejected with 400
// here rather than surfacing a 500 from the CHECK constraint.
const PAGE_TYPE_VALUES: ReadonlySet<string> = new Set([
  "generic",
  "about",
  "privacy-policy",
  "terms",
  "do-not-sell",
  "contact",
  "legal",
]);
const LEGAL_PAGE_TYPES: ReadonlySet<string> = new Set([
  "privacy-policy",
  "terms",
  "do-not-sell",
  "contact",
  "legal",
]);
const PAGE_STATUS_VALUES: ReadonlySet<string> = new Set([
  "draft",
  "published",
  "archived",
]);

// Static column list shared by INSERT...RETURNING and the PATCH re-read.
// Starts "id, site_id, slug, title" so it is distinguishable from the
// PATCH existence probe ("SELECT id, site_id, slug, page_type ...").
const PAGE_COLUMNS =
  "id, site_id, slug, title, content_json, content_html, status, template, show_in_footer, display_order, page_type, seo_title, seo_description, created_at, updated_at";

export interface PageCrudRow {
  id: number;
  site_id: string | null;
  slug: string;
  title: string;
  content_json: string;
  content_html: string | null;
  status: string;
  template: string;
  show_in_footer: number;
  display_order: number;
  page_type: string;
  seo_title: string | null;
  seo_description: string | null;
  created_at: number;
  updated_at: number;
}

interface PageWriteBody {
  site_id?: unknown;
  slug?: unknown;
  title?: unknown;
  content_json?: unknown;
  content_html?: unknown;
  status?: unknown;
  template?: unknown;
  show_in_footer?: unknown;
  display_order?: unknown;
  page_type?: unknown;
  seo_title?: unknown;
  seo_description?: unknown;
}

// Legacy generateSlug(title, 50) port: lowercase, runs of non-alphanumerics
// collapse to single hyphens, edge hyphens trimmed, hard cap 50 chars.
function generateSlug(title: string, maxLen: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "page";
}

// Form sends 1/0; JSON callers may send booleans. Returns null when the
// value is absent/unusable so PATCH can distinguish "not supplied".
function toZeroOne(v: unknown): number | null {
  if (typeof v === "number") return v ? 1 : 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

function toNonNegativeInt(v: unknown): number | null {
  const parsed =
    typeof v === "number" ? v : typeof v === "string" && v.length > 0 ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
}

async function assertGlobalSlugFree(
  db: D1Database,
  slug: string,
  excludeId?: number,
): Promise<boolean> {
  const row =
    excludeId === undefined
      ? await db
          .prepare("SELECT id FROM pages WHERE slug = ? AND site_id IS NULL LIMIT 1")
          .bind(slug)
          .first<{ id: number }>()
      : await db
          .prepare(
            "SELECT id FROM pages WHERE slug = ? AND site_id IS NULL AND id <> ? LIMIT 1",
          )
          .bind(slug, excludeId)
          .first<{ id: number }>();
  return row === null || row === undefined;
}

// POST /api/admin/pages — create a page (site-scoped or global legal
// template). 400 invalid body / missing title / missing site_id on a
// non-legal page_type / unknown site; 409 slug collision; 201 with the
// inserted row.
export async function createPageHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  let body: PageWriteBody;
  try {
    body = await c.req.json<PageWriteBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return c.json({ error: "Title is required" }, 400);

  const pageType =
    typeof body.page_type === "string" && body.page_type.trim().length > 0
      ? body.page_type.trim()
      : "generic";
  if (!PAGE_TYPE_VALUES.has(pageType)) {
    return c.json({ error: `Unknown page_type: ${pageType}` }, 400);
  }

  const siteId =
    typeof body.site_id === "string" && body.site_id.trim().length > 0
      ? body.site_id.trim()
      : null;
  if (siteId === null && !LEGAL_PAGE_TYPES.has(pageType)) {
    return c.json(
      { error: "site_id is required for non-legal page types" },
      400,
    );
  }
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

  const slug =
    typeof body.slug === "string" && body.slug.trim().length > 0
      ? body.slug.trim()
      : generateSlug(title, 50);
  if (siteId !== null) {
    try {
      await assertSlugUniquePerSite(c.env.DB, "pages", slug, siteId);
    } catch (err) {
      return c.json(
        { error: (err as Error).message, code: "SLUG_UNIQUENESS_VIOLATION" },
        409,
      );
    }
  } else if (!(await assertGlobalSlugFree(c.env.DB, slug))) {
    return c.json(
      {
        error: `Slug ${JSON.stringify(slug)} is already in use by a global template.`,
        code: "SLUG_UNIQUENESS_VIOLATION",
      },
      409,
    );
  }

  const status =
    typeof body.status === "string" && body.status.length > 0
      ? body.status
      : "draft";
  if (!PAGE_STATUS_VALUES.has(status)) {
    return c.json(
      { error: "status must be one of draft|published|archived" },
      400,
    );
  }

  const contentJson =
    typeof body.content_json === "string" && body.content_json.length > 0
      ? body.content_json
      : '{"version":1,"blocks":[]}';
  const contentHtml =
    typeof body.content_html === "string" ? body.content_html : null;
  const template =
    typeof body.template === "string" && body.template.trim().length > 0
      ? body.template.trim()
      : "default";
  const showInFooter = toZeroOne(body.show_in_footer) ?? 0;
  const displayOrder = toNonNegativeInt(body.display_order) ?? 0;
  const seoTitle = typeof body.seo_title === "string" && body.seo_title.length > 0 ? body.seo_title : null;
  const seoDescription =
    typeof body.seo_description === "string" && body.seo_description.length > 0
      ? body.seo_description
      : null;

  const row = await c.env.DB.prepare(
    "INSERT INTO pages (site_id, slug, title, content_json, content_html, status, template, show_in_footer, display_order, page_type, seo_title, seo_description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING " +
      PAGE_COLUMNS,
  )
    .bind(
      siteId,
      slug,
      title,
      contentJson,
      contentHtml,
      status,
      template,
      showInFooter,
      displayOrder,
      pageType,
      seoTitle,
      seoDescription,
    )
    .first<PageCrudRow>();
  if (!row) return c.json({ error: "Insert failed" }, 500);

  if (siteId !== null) {
    await applyPageMutationCacheInvalidation(c.env, siteId);
  }
  return c.json({ page: row }, 201);
}

// PATCH /api/admin/pages/:id — allow-list partial update. Absent fields
// are retained (T29.AC1: page_type retention). 400 invalid id/body/no
// updatable fields; 403 cross-tenant move; 404 unknown page; 409 slug
// collision; 200 with the re-read row.
export async function updatePageHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid id" }, 400);
  }

  const existing = await c.env.DB.prepare(
    "SELECT id, site_id, slug, page_type FROM pages WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<{ id: number; site_id: string | null; slug: string; page_type: string }>();
  if (existing === null || existing === undefined) {
    return c.json({ error: "Not Found" }, 404);
  }

  let body: PageWriteBody;
  try {
    body = await c.req.json<PageWriteBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const existingSiteId =
    typeof existing.site_id === "string" && existing.site_id.length > 0
      ? existing.site_id
      : null;
  const bodySiteId =
    typeof body.site_id === "string" && body.site_id.trim().length > 0
      ? body.site_id.trim()
      : null;

  if (bodySiteId !== null) {
    if (existingSiteId !== null) {
      // Site-owned page: site_id in the body must match (no cross-tenant
      // moves). assertTenantBoundary throws on mismatch.
      try {
        assertTenantBoundary(existingSiteId, bodySiteId);
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
    } else {
      // Global template adopting a site: the target site must exist.
      const existingSite = await c.env.DB.prepare(
        "SELECT id FROM sites WHERE id = ? LIMIT 1",
      )
        .bind(bodySiteId)
        .first<{ id: string }>();
      if (existingSite === null || existingSite === undefined) {
        return c.json(
          { error: `Unknown site_id: ${bodySiteId}`, code: "UNKNOWN_SITE" },
          400,
        );
      }
    }
  }

  const guardSiteId = bodySiteId ?? existingSiteId;

  const newSlug =
    typeof body.slug === "string" && body.slug.trim().length > 0
      ? body.slug.trim()
      : null;
  if (newSlug !== null && newSlug !== existing.slug) {
    if (guardSiteId !== null) {
      try {
        await assertSlugUniquePerSite(c.env.DB, "pages", newSlug, guardSiteId, id);
      } catch (err) {
        return c.json(
          { error: (err as Error).message, code: "SLUG_UNIQUENESS_VIOLATION" },
          409,
        );
      }
    } else if (!(await assertGlobalSlugFree(c.env.DB, newSlug, id))) {
      return c.json(
        {
          error: `Slug ${JSON.stringify(newSlug)} is already in use by a global template.`,
          code: "SLUG_UNIQUENESS_VIOLATION",
        },
        409,
      );
    }
  }

  // Allow-listed UPDATE — only supplied keys enter the SET clause, so a
  // body without page_type leaves the stored page_type untouched.
  const setClauses: string[] = [];
  const bindings: unknown[] = [];

  if (bodySiteId !== null) {
    setClauses.push("site_id = ?");
    bindings.push(bodySiteId);
  }
  if (typeof body.title === "string" && body.title.trim().length > 0) {
    setClauses.push("title = ?");
    bindings.push(body.title.trim());
  }
  if (newSlug !== null) {
    setClauses.push("slug = ?");
    bindings.push(newSlug);
  }
  if (typeof body.content_json === "string") {
    setClauses.push("content_json = ?");
    bindings.push(body.content_json);
  }
  // For nullable text columns an explicit JSON null clears the value;
  // an absent key (undefined after parse) leaves it retained.
  if (typeof body.content_html === "string" || body.content_html === null) {
    setClauses.push("content_html = ?");
    bindings.push(body.content_html);
  }
  if (typeof body.status === "string" && body.status.length > 0) {
    if (!PAGE_STATUS_VALUES.has(body.status)) {
      return c.json(
        { error: "status must be one of draft|published|archived" },
        400,
      );
    }
    setClauses.push("status = ?");
    bindings.push(body.status);
  }
  if (typeof body.page_type === "string" && body.page_type.trim().length > 0) {
    const pt = body.page_type.trim();
    if (!PAGE_TYPE_VALUES.has(pt)) {
      return c.json({ error: `Unknown page_type: ${pt}` }, 400);
    }
    setClauses.push("page_type = ?");
    bindings.push(pt);
  }
  if (typeof body.template === "string" && body.template.trim().length > 0) {
    setClauses.push("template = ?");
    bindings.push(body.template.trim());
  }
  const footer = toZeroOne(body.show_in_footer);
  if (footer !== null) {
    setClauses.push("show_in_footer = ?");
    bindings.push(footer);
  }
  const order = toNonNegativeInt(body.display_order);
  if (order !== null) {
    setClauses.push("display_order = ?");
    bindings.push(order);
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

  if (setClauses.length === 0) {
    return c.json({ error: "No updatable fields provided" }, 400);
  }
  setClauses.push("updated_at = unixepoch()");
  const sql = "UPDATE pages SET " + setClauses.join(", ") + " WHERE id = ?";
  bindings.push(id);

  try {
    await c.env.DB.prepare(sql)
      .bind(...bindings)
      .run();
  } catch (err) {
    const msg = (err as Error).message || "";
    if (/UNIQUE/i.test(msg) && /slug/i.test(msg)) {
      return c.json({ error: msg, code: "SLUG_UNIQUENESS_VIOLATION" }, 409);
    }
    return c.json({ error: msg || "Update failed" }, 500);
  }

  if (guardSiteId !== null) {
    await applyPageMutationCacheInvalidation(c.env, guardSiteId);
  }

  const updated = await c.env.DB.prepare(
    "SELECT " + PAGE_COLUMNS + " FROM pages WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<PageCrudRow>();
  return c.json({ page: updated });
}

// DELETE /api/admin/pages/:id — 400 invalid id, 404 unknown page, 200
// with { ok, id } after the parameterized DELETE (articles DELETE parity).
export async function deletePageHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const id = parseInt(c.req.param("id") ?? "", 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid id" }, 400);
  }
  const existing = await c.env.DB.prepare(
    "SELECT id, site_id FROM pages WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<{ id: number; site_id: string | null }>();
  if (existing === null || existing === undefined) {
    return c.json({ error: "Not Found" }, 404);
  }
  try {
    await c.env.DB.prepare("DELETE FROM pages WHERE id = ?").bind(id).run();
  } catch (err) {
    return c.json({ error: (err as Error).message || "Delete failed" }, 500);
  }
  const siteId =
    typeof existing.site_id === "string" && existing.site_id.length > 0
      ? existing.site_id
      : null;
  if (siteId !== null) {
    // A deleted page changes footer/listing surfaces — same per-site
    // invalidation as create/update.
    await applyPageMutationCacheInvalidation(c.env, siteId);
  }
  return c.json({ ok: true, id });
}
