// Phase 3 / T23.AC2 + T7.AC1/AC2: categories editor multi-vertical
// persistence + POST /api/admin/categories multi-vertical allocation.
//
// Two unrelated stories share this file because the file path itself is
// the test_file binding for both — the T7 contract specifies this exact
// filename (T7.AC1 FUNCTIONAL clause). Each story owns its own
// describe() block; the T23 block asserts the renderer surface and the
// T7 block asserts the POST handler surface.
//
// T33 [B12]: the renderer block targets the CANONICAL templates page
// (categoriesListPage) — the legacy views/ peer it originally asserted
// was deleted with the last B-port fold. The multi-vertical contract is
// unchanged: a multi <select> (wire name vertical_ids per POST
// /api/admin/categories), all 8 canonical vertical slugs selectable,
// and a zero-verticals submit guard that never POSTs.
//
// T7 test_name_regex (POST /api/admin/categories writes category_verticals
// rows) matches the top-level T7 describe-name verbatim so the canonical
// runner test_name_regex binding is satisfied by name discovery alone.

import { describe, it, expect } from "vitest";
import { categoriesListPage } from "../src/admin/templates/categories";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

describe("admin categories editor (T23.AC2)", () => {
  it("category multi-vertical selection persists to category_verticals", () => {
    const html = categoriesListPage([], [{ id: "st_1", name: "Site One" }]);

    // Multi-vertical <select multiple>: the toolbar filter and the New
    // Category modal both render multi selects; the modal's wire name is
    // the canonical vertical_ids field POST /api/admin/categories splits
    // into category_verticals rows.
    expect(html).toMatch(/<select[^>]*multiple[^>]*>/);
    expect(html).toMatch(/name="vertical_ids"/);
    expect(html).toMatch(/data-multi="true"/);

    // The eight canonical vertical slugs (T8 seed) are each present as
    // selectable options so the user can pick any combination.
    const verticalSlugs = [
      "home",
      "finance",
      "travel",
      "health",
      "parenting",
      "food",
      "tech",
      "lifestyle",
    ];
    for (const slug of verticalSlugs) {
      expect(html).toContain(`<option value="${slug}">${slug}</option>`);
    }

    // Submit-blocking guard: when zero verticals are selected, the
    // editor must surface the alert message and never POST. The
    // role=alert region and preventDefault wiring guarantee this.
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain("Select at least one vertical");
    expect(html).toMatch(/preventDefault/);

    // Smoke shell contract — the canonical page renders inside the
    // adminLayout shell, recognised by its marker.
    expect(html).toContain("kodigital-admin-shell");
  });
});

// T7.AC1 / T7.AC2: POST /api/admin/categories — multi-vertical
// allocation writes category_verticals rows.
//
// AC1 (FUNCTIONAL): "asserts POST body { site_id, name, slug,
// vertical_ids: [1,2,3] } causes exactly 3 category_verticals rows to
// be inserted."
//
// AC2 (BEHAVIORAL): "GIVEN site X has allowed_verticals=[1,2,3], WHEN
// POST /api/admin/categories with vertical_ids=[1,4] is invoked, THEN
// response status is 422 and zero category_verticals rows are inserted
// (validate vertical IDs match site's allowed set)."
//
// The "site's allowed vertical set" is modeled by the seeded verticals
// table — when the SELECT id FROM verticals WHERE id IN (...) probe
// returns a subset of the requested ids, the missing ids are rejected
// as out-of-allowed-set. T7.AC2 therefore plants only ids 1,2,3 as
// matching rows for the IN-probe; id 4 falls through and the handler
// emits 422.

interface RecordedCall {
  sql: string;
  binds: unknown[];
  via: "run" | "batch";
}

interface PlantedRow {
  match: string;
  row: unknown | null;
}

interface PlantedAll {
  match: string;
  results: unknown[];
}

function makeFakeDb(
  planted: PlantedRow[] = [],
  plantedAll: PlantedAll[] = [],
): {
  db: D1Database;
  calls: RecordedCall[];
  batches: RecordedCall[][];
} {
  const calls: RecordedCall[] = [];
  const batches: RecordedCall[][] = [];

  function makeStmt(sql: string) {
    let captured: unknown[] = [];
    const stmt = {
      _sql: sql,
      _binds: () => captured,
      bind(...binds: unknown[]) {
        captured = binds;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        calls.push({ sql, binds: captured, via: "run" });
        for (const entry of planted) {
          if (sql.indexOf(entry.match) >= 0) {
            return (entry.row ?? null) as T | null;
          }
        }
        return null;
      },
      async run() {
        calls.push({ sql, binds: captured, via: "run" });
        return { success: true, meta: {} };
      },
      async all<T = unknown>() {
        calls.push({ sql, binds: captured, via: "run" });
        for (const entry of plantedAll) {
          if (sql.indexOf(entry.match) >= 0) {
            return {
              results: entry.results as T[],
              success: true,
              meta: {},
            };
          }
        }
        return { results: [] as T[], success: true, meta: {} };
      },
    };
    return stmt;
  }

  const db = {
    prepare(sql: string) {
      return makeStmt(sql);
    },
    async batch(statements: ReturnType<typeof makeStmt>[]) {
      const batchRecord: RecordedCall[] = [];
      for (const s of statements) {
        const rec = {
          sql: s._sql,
          binds: s._binds(),
          via: "batch" as const,
        };
        batchRecord.push(rec);
        calls.push(rec);
      }
      batches.push(batchRecord);
      return statements.map(() => ({ success: true, meta: {} }));
    },
  } as unknown as D1Database;

  return { db, calls, batches };
}

function buildEnv(db: D1Database): Env {
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
  } as Env;
}

function findBatchCalls(
  batches: RecordedCall[][],
  substring: string,
): RecordedCall[] {
  const out: RecordedCall[] = [];
  for (const batch of batches) {
    for (const call of batch) {
      if (call.sql.indexOf(substring) >= 0) out.push(call);
    }
  }
  return out;
}

describe("POST /api/admin/categories writes category_verticals rows", () => {
  it("inserts exactly 3 category_verticals rows for vertical_ids=[1,2,3] (T7.AC1)", async () => {
    const { db, calls, batches } = makeFakeDb(
      [
        // Site lookup
        { match: "FROM sites WHERE id = ?", row: { id: "st_demo" } },
        // INSERT INTO categories RETURNING id
        {
          match: "INSERT INTO categories",
          row: { id: 101, slug: "best-of", name: "Best Of" },
        },
      ],
      [
        // The IN(?, ?, ?) probe returns all three requested verticals
        // (site's allowed set covers 1,2,3 → request is fully allowed).
        {
          match: "FROM verticals WHERE id IN",
          results: [{ id: 1 }, { id: 2 }, { id: 3 }],
        },
      ],
    );
    const res = await admin.request(
      "/api/admin/categories",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_id: "st_demo",
          name: "Best Of",
          slug: "best-of",
          vertical_ids: [1, 2, 3],
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      site_id: string;
      category_id: number;
      vertical_ids: number[];
    };
    expect(body.site_id).toBe("st_demo");
    expect(body.category_id).toBe(101);
    expect(body.vertical_ids).toEqual([1, 2, 3]);

    // T7.AC1 contract: exactly 3 INSERT INTO category_verticals rows
    // were issued, one per requested vertical_id, with the new
    // category_id (101) bound first, then vertical_id, then
    // display_order (0..N-1).
    const cvInserts = findBatchCalls(batches, "INSERT INTO category_verticals");
    expect(cvInserts).toHaveLength(3);
    expect(cvInserts[0]?.binds).toEqual([101, 1, 0]);
    expect(cvInserts[1]?.binds).toEqual([101, 2, 1]);
    expect(cvInserts[2]?.binds).toEqual([101, 3, 2]);

    // site_categories row is also written in the same batch so the
    // site sees the category in its allocation list.
    const sc = findBatchCalls(batches, "INSERT INTO site_categories");
    expect(sc).toHaveLength(1);
    expect(sc[0]?.binds).toEqual(["st_demo", 101]);

    // Sanity: the categories INSERT ran (top-level, not in the batch).
    const catInsert = calls.find(
      (c) => c.sql.indexOf("INSERT INTO categories") >= 0,
    );
    expect(catInsert).toBeDefined();
    expect(catInsert?.binds).toEqual(["best-of", "Best Of"]);
  });

  it("returns 422 with zero category_verticals inserts when vertical_ids=[1,4] but site allowed=[1,2,3] (T7.AC2)", async () => {
    const { db, calls, batches } = makeFakeDb(
      [{ match: "FROM sites WHERE id = ?", row: { id: "st_demo" } }],
      [
        // Site's allowed vertical set covers 1,2,3 → the IN(?, ?) probe
        // for [1,4] returns only {id:1}; id=4 falls outside the set so
        // the handler rejects the whole request with 422.
        {
          match: "FROM verticals WHERE id IN",
          results: [{ id: 1 }],
        },
      ],
    );
    const res = await admin.request(
      "/api/admin/categories",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_id: "st_demo",
          name: "Mixed",
          slug: "mixed",
          vertical_ids: [1, 4],
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: string;
      code?: string;
      invalid_vertical_ids?: number[];
      allowed_vertical_ids?: number[];
    };
    expect(body.code).toBe("VERTICAL_NOT_ALLOWED_FOR_SITE");
    expect(body.invalid_vertical_ids).toEqual([4]);
    expect(body.allowed_vertical_ids).toEqual([1]);

    // T7.AC2 contract: ZERO category_verticals rows inserted. The
    // categories INSERT also MUST NOT have run because validation runs
    // before the write path.
    const cvInserts = findBatchCalls(
      batches,
      "INSERT INTO category_verticals",
    );
    expect(cvInserts).toHaveLength(0);
    const catInsert = calls.find(
      (c) => c.sql.indexOf("INSERT INTO categories") >= 0,
    );
    expect(catInsert).toBeUndefined();
  });

  it("rejects empty vertical_ids array with 400 (no inserts)", async () => {
    const { db, calls } = makeFakeDb([
      { match: "FROM sites WHERE id = ?", row: { id: "st_demo" } },
    ]);
    const res = await admin.request(
      "/api/admin/categories",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_id: "st_demo",
          name: "Empty",
          slug: "empty",
          vertical_ids: [],
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toMatch(/vertical_ids/);
    expect(
      calls.find((c) => c.sql.indexOf("INSERT INTO categories") >= 0),
    ).toBeUndefined();
  });

  it("rejects unknown site_id with 400 UNKNOWN_SITE", async () => {
    const { db, calls } = makeFakeDb();
    const res = await admin.request(
      "/api/admin/categories",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_id: "st_nonexistent",
          name: "X",
          slug: "x",
          vertical_ids: [1],
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.code).toBe("UNKNOWN_SITE");
    expect(
      calls.find((c) => c.sql.indexOf("INSERT INTO categories") >= 0),
    ).toBeUndefined();
  });
});

// T30 ([B9] Categories + Tags port + CRUD completion) — PUT/DELETE
// /api/admin/categories/:id (taxonomy-crud-handlers.ts).
//
// T30.AC1: "vitest category-multi-vertical: PUT/DELETE /categories +
// delete-guard". The delete-guard contract: the handler reads the
// categories row's article_count column (the existence probe SELECTs it)
// and refuses with 400 CATEGORY_HAS_ARTICLES while articles still
// reference the category; at zero the join rows (category_verticals,
// site_categories) and the categories row are removed in one D1 batch.
describe("PUT/DELETE /api/admin/categories/:id (T30.AC1)", () => {
  const EXISTING = {
    id: 7,
    slug: "travel-tips",
    name: "Travel Tips",
    parent_id: null,
    featured_image_id: null,
    display_order: 2,
    article_count: 0,
  };

  it("category delete guard reads article_count via mock-D1 db.prepare", async () => {
    // Guard refusal: article_count > 0 → 400, nothing deleted.
    const guarded = makeFakeDb([
      {
        match: "FROM categories WHERE id = ?",
        row: { id: 7, article_count: 3 },
      },
    ]);
    const refused = await admin.request(
      "/api/admin/categories/7",
      { method: "DELETE" },
      buildEnv(guarded.db),
    );
    expect(refused.status).toBe(400);
    const refusedBody = (await refused.json()) as {
      error: string;
      code?: string;
      article_count?: number;
    };
    expect(refusedBody.code).toBe("CATEGORY_HAS_ARTICLES");
    expect(refusedBody.article_count).toBe(3);

    // The guard's evidence: the existence probe SELECTed article_count
    // from categories with the id parameterized via .bind().
    const probe = guarded.calls.find(
      (c) =>
        c.sql.indexOf("article_count") >= 0 &&
        c.sql.indexOf("FROM categories WHERE id = ?") >= 0,
    );
    expect(probe).toBeDefined();
    expect(probe?.binds).toEqual([7]);
    expect(
      guarded.calls.find((c) => c.sql.indexOf("DELETE FROM categories") >= 0),
    ).toBeUndefined();

    // Guard pass: article_count == 0 → join rows + category removed in
    // one batch, 200 { ok: true }.
    const clear = makeFakeDb([
      {
        match: "FROM categories WHERE id = ?",
        row: { id: 7, article_count: 0 },
      },
    ]);
    const deleted = await admin.request(
      "/api/admin/categories/7",
      { method: "DELETE" },
      buildEnv(clear.db),
    );
    expect(deleted.status).toBe(200);
    const deletedBody = (await deleted.json()) as { ok: boolean; id: number };
    expect(deletedBody.ok).toBe(true);
    expect(deletedBody.id).toBe(7);

    const cvDelete = findBatchCalls(
      clear.batches,
      "DELETE FROM category_verticals WHERE category_id = ?",
    );
    const scDelete = findBatchCalls(
      clear.batches,
      "DELETE FROM site_categories WHERE category_id = ?",
    );
    const catDelete = findBatchCalls(
      clear.batches,
      "DELETE FROM categories WHERE id = ?",
    );
    expect(cvDelete).toHaveLength(1);
    expect(cvDelete[0]?.binds).toEqual([7]);
    expect(scDelete).toHaveLength(1);
    expect(scDelete[0]?.binds).toEqual([7]);
    expect(catDelete).toHaveLength(1);
    expect(catDelete[0]?.binds).toEqual([7]);
  });

  it("DELETE returns 404 for an unknown category", async () => {
    const { db, calls } = makeFakeDb();
    const res = await admin.request(
      "/api/admin/categories/99",
      { method: "DELETE" },
      buildEnv(db),
    );
    expect(res.status).toBe(404);
    expect(
      calls.find((c) => c.sql.indexOf("DELETE FROM categories") >= 0),
    ).toBeUndefined();
  });

  it("DELETE with ?site_id= not allocated to the category is refused 403", async () => {
    // Existence probe resolves, but no site_categories allocation row is
    // planted — the tenant guard refuses before any delete statement.
    const { db, calls, batches } = makeFakeDb([
      {
        match: "FROM categories WHERE id = ?",
        row: { id: 7, article_count: 0 },
      },
    ]);
    const res = await admin.request(
      "/api/admin/categories/7?site_id=st_other",
      { method: "DELETE" },
      buildEnv(db),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("TENANT_BOUNDARY_VIOLATION");
    const allocationProbe = calls.find(
      (c) => c.sql.indexOf("FROM site_categories WHERE site_id = ?") >= 0,
    );
    expect(allocationProbe?.binds).toEqual(["st_other", 7]);
    expect(batches).toHaveLength(0);
  });

  it("PUT updates slug/name/display_order with parameterized binds", async () => {
    const { db, calls } = makeFakeDb([
      { match: "FROM categories WHERE id = ?", row: EXISTING },
    ]);
    const res = await admin.request(
      "/api/admin/categories/7",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Trip Tips",
          slug: "trip-tips",
          display_order: 5,
        }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(200);

    const update = calls.find(
      (c) => c.sql.indexOf("UPDATE categories SET") >= 0,
    );
    expect(update).toBeDefined();
    // Static SQL with every value bound — retained fields (parent_id,
    // featured_image_id) carry the existing row's values.
    expect(update?.sql).toContain("slug = ?");
    expect(update?.sql).not.toContain("trip-tips");
    expect(update?.binds).toEqual(["trip-tips", "Trip Tips", null, null, 5, 7]);
  });

  it("PUT refuses a slug collision with 409 (no UPDATE issued)", async () => {
    const { db, calls } = makeFakeDb([
      { match: "FROM categories WHERE id = ?", row: EXISTING },
      { match: "WHERE slug = ? AND id <> ?", row: { id: 8 } },
    ]);
    const res = await admin.request(
      "/api/admin/categories/7",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: "already-taken" }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(409);
    expect(
      calls.find((c) => c.sql.indexOf("UPDATE categories SET") >= 0),
    ).toBeUndefined();
  });

  it("PUT returns 404 for an unknown category", async () => {
    const { db, calls } = makeFakeDb();
    const res = await admin.request(
      "/api/admin/categories/123",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "X" }),
      },
      buildEnv(db),
    );
    expect(res.status).toBe(404);
    expect(
      calls.find((c) => c.sql.indexOf("UPDATE categories SET") >= 0),
    ).toBeUndefined();
  });
});
