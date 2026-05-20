import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

// MQAFIX-1 / RX1 regression: POST /api/admin/articles MUST bind body.site_id
// so the per-site slug index is reachable for new articles (T13 PATCH
// tenant guard is unreachable when INSERT did not persist site_id).
//
// BEHAVIORAL contract covered here:
//   * 400 when body.site_id is missing.
//   * 400 with "unknown site" message when body.site_id does not exist.
//   * 409 SLUG_UNIQUENESS_VIOLATION on duplicate (site_id, slug).
//   * 201 with site_id persisted to the INSERT bindings on the happy path.

interface RecordedCall {
  sql: string;
  binds: unknown[];
}

interface PlantedRow {
  match: string;
  row: unknown | null;
}

function makeFakeDb(planted: PlantedRow[] = []): {
  db: D1Database;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          calls.push({ sql, binds: captured });
          for (const entry of planted) {
            if (sql.indexOf(entry.match) >= 0) {
              return (entry.row ?? null) as T | null;
            }
          }
          return null;
        },
        async run() {
          calls.push({ sql, binds: captured });
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          calls.push({ sql, binds: captured });
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, calls };
}

function buildEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    ...overrides,
  };
}

function findCall(
  calls: RecordedCall[],
  substring: string,
): RecordedCall | undefined {
  return calls.find((c) => c.sql.indexOf(substring) >= 0);
}

describe("POST /api/admin/articles binds body.site_id (MQAFIX-1)", () => {
  it("rejects missing site_id with 400", async () => {
    const { db, calls } = makeFakeDb();
    const res = await admin.request(
      "/api/admin/articles",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "x", title: "y" }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/site_id/i);
    expect(findCall(calls, "INSERT INTO articles")).toBeUndefined();
  });

  it("rejects unknown site_id with 400 and error references unknown site", async () => {
    // No planted row for `SELECT id FROM sites WHERE id = ?` -> first()
    // returns null -> handler emits 400 UNKNOWN_SITE.
    const { db, calls } = makeFakeDb();
    const res = await admin.request(
      "/api/admin/articles",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_id: "st_nonexistent",
          slug: "x",
          title: "y",
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.error.toLowerCase()).toMatch(/unknown.*site/);
    expect(body.code).toBe("UNKNOWN_SITE");
    expect(findCall(calls, "INSERT INTO articles")).toBeUndefined();
  });

  it("returns 409 SLUG_UNIQUENESS_VIOLATION on duplicate (site_id, slug)", async () => {
    const { db, calls } = makeFakeDb([
      { match: "FROM sites WHERE id = ?", row: { id: "st_exist" } },
      // Slug uniqueness probe finds an existing article.
      {
        match: "SELECT id FROM articles WHERE slug = ? AND site_id = ?",
        row: { id: 7 },
      },
    ]);
    const res = await admin.request(
      "/api/admin/articles",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_id: "st_exist",
          slug: "dup",
          title: "Dup",
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.code).toBe("SLUG_UNIQUENESS_VIOLATION");
    expect(findCall(calls, "INSERT INTO articles")).toBeUndefined();
  });

  it("inserts with site_id on the happy path (201)", async () => {
    const insertedRow = {
      id: 42,
      site_id: "st_exist",
      slug: "mqafix1",
      title: "T",
      category_id: null,
      status: "draft",
    };
    const { db, calls } = makeFakeDb([
      { match: "FROM sites WHERE id = ?", row: { id: "st_exist" } },
      { match: "INSERT INTO articles", row: insertedRow },
    ]);
    const res = await admin.request(
      "/api/admin/articles",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_id: "st_exist",
          slug: "mqafix1",
          title: "T",
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      article: { id: number; site_id: string; slug: string };
    };
    expect(body.article.site_id).toBe("st_exist");

    const insert = findCall(calls, "INSERT INTO articles");
    expect(insert).toBeDefined();
    // INSERT bind order: (site_id, slug, title, content_json, category_id).
    // site_id MUST be the first bind so the per-site UNIQUE index is
    // engaged for new articles (MQAFIX-1).
    expect(insert?.binds[0]).toBe("st_exist");
    expect(insert?.binds[1]).toBe("mqafix1");
    expect(insert?.binds[2]).toBe("T");
  });
});

// T5: PATCH /api/admin/articles/:id contract surface — 4 BEHAVIORAL cases
// per prd.json T5.AC1 (tenant boundary 403, slug duplicate 409, category
// vertical mismatch 422, allow-list field gating). The PATCH handler in
// api/src/admin/api.ts MUST flow each mutation through tenant-guards so
// the per-site invariants from migration 0007 (per-site UNIQUE slug),
// migration 0001..0006 (sites/category_verticals/vertical_slug), and the
// allow-list whitelist hold across all admin clients.
describe("PATCH /api/admin/articles/:id contract (T5)", () => {
  it("returns 403 with tenant_violation field on cross-tenant mutation", async () => {
    // GIVEN article id=10 owned by site A, WHEN PATCH is invoked with
    // body.site_id=B (site B caller scope), THEN response is 403 AND
    // body contains a tenant_violation field. Per T5.AC2 BEHAVIORAL.
    const { db, calls } = makeFakeDb([
      {
        match: "SELECT id, site_id, slug FROM articles WHERE id = ?",
        row: { id: 10, site_id: "st_A", slug: "about-A" },
      },
    ]);
    const res = await admin.request(
      "/api/admin/articles/10",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site_id: "st_B", title: "Hijack" }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      error: string;
      code?: string;
      tenant_violation?: boolean;
      actor_site_id?: string;
      resource_site_id?: string;
    };
    expect(body.tenant_violation).toBe(true);
    expect(body.code).toBe("TENANT_BOUNDARY_VIOLATION");
    // No UPDATE statement issued — tenant guard short-circuited before
    // building the SET clause.
    expect(findCall(calls, "UPDATE articles")).toBeUndefined();
  });

  it("returns 409 SLUG_UNIQUENESS_VIOLATION when slug collides on same site", async () => {
    // GIVEN article id=11 site_id=A slug='bar', WHEN PATCH sets slug='foo'
    // AND another article with slug='foo' AND site_id=A AND id<>11 exists,
    // THEN response status is 409 with code SLUG_UNIQUENESS_VIOLATION.
    // Per T5.AC3 BEHAVIORAL.
    const { db, calls } = makeFakeDb([
      {
        match: "SELECT id, site_id, slug FROM articles WHERE id = ?",
        row: { id: 11, site_id: "st_A", slug: "bar" },
      },
      {
        match:
          "SELECT id FROM articles WHERE slug = ? AND site_id = ? AND id <> ?",
        row: { id: 99 },
      },
    ]);
    const res = await admin.request(
      "/api/admin/articles/11",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "foo" }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.code).toBe("SLUG_UNIQUENESS_VIOLATION");
    expect(findCall(calls, "UPDATE articles")).toBeUndefined();
  });

  it("returns 422 CATEGORY_INVALID_FOR_SITE when category_id is not allowed for the site's vertical", async () => {
    // GIVEN article id=12 site_id=A and category 99 NOT mapped to A's
    // vertical (no row in category_verticals JOIN verticals JOIN sites),
    // WHEN PATCH sets category_id=99, THEN response status is 422 with
    // code CATEGORY_INVALID_FOR_SITE.
    const { db, calls } = makeFakeDb([
      {
        match: "SELECT id, site_id, slug FROM articles WHERE id = ?",
        row: { id: 12, site_id: "st_A", slug: "about-A" },
      },
      // Slug not changing -> uniqueness probe not triggered. Category
      // probe matches the JOIN literal in validateCategoryForSite and
      // returns null -> handler emits 422.
      { match: "FROM category_verticals cv", row: null },
    ]);
    const res = await admin.request(
      "/api/admin/articles/12",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category_id: 99 }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.code).toBe("CATEGORY_INVALID_FOR_SITE");
    expect(findCall(calls, "UPDATE articles")).toBeUndefined();
  });

  it("gates UPDATE to allow-listed fields only (ignores unknown body keys)", async () => {
    // GIVEN article id=13 site_id=A slug='ok', WHEN PATCH body contains
    // allow-listed { title, status } AND attacker keys { admin_role,
    // secret, owner_id, id, site_id_override }, THEN the UPDATE SQL
    // contains 'title = ?' AND 'status = ?' BUT MUST NOT contain
    // 'admin_role', 'secret', 'owner_id', or any column not in the
    // whitelist (site_id, title, slug, content_json, category_id, status,
    // homepage_section, homepage_rank, is_featured, is_trending,
    // featured_image_id, seo_title, seo_description, author_name).
    const refreshedRow = {
      id: 13,
      site_id: "st_A",
      slug: "ok",
      title: "new title",
      category_id: null,
      status: "published",
    };
    const { db, calls } = makeFakeDb([
      {
        match: "SELECT id, site_id, slug FROM articles WHERE id = ?",
        row: { id: 13, site_id: "st_A", slug: "ok" },
      },
      {
        match: "SELECT * FROM articles WHERE id = ?",
        row: refreshedRow,
      },
    ]);
    const res = await admin.request(
      "/api/admin/articles/13",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "new title",
          status: "published",
          admin_role: "root",
          secret: "leak",
          owner_id: 999,
          id: 0,
          site_id_override: "st_B",
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const update = findCall(calls, "UPDATE articles");
    expect(update).toBeDefined();
    // Allow-listed columns appear in SET clause.
    expect(update?.sql).toContain("title = ?");
    expect(update?.sql).toContain("status = ?");
    // Non-whitelisted keys MUST NOT appear in the generated SQL — the
    // handler builds setClauses only from `typeof body.<field> === ...`
    // branches for whitelisted columns.
    expect(update?.sql).not.toMatch(/admin_role/);
    expect(update?.sql).not.toMatch(/secret\b/);
    expect(update?.sql).not.toMatch(/owner_id/);
    expect(update?.sql).not.toMatch(/site_id_override/);
    // The trailing WHERE id = ? carries the route id (binds last).
    expect(update?.binds[update.binds.length - 1]).toBe(13);
  });
});
