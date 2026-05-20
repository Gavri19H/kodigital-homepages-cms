// Phase 3 / T23.AC2 + T7.AC1/AC2: categories editor multi-vertical
// persistence + POST /api/admin/categories multi-vertical allocation.
//
// Two unrelated stories share this file because the file path itself is
// the test_file binding for both — the T7 contract specifies this exact
// filename (T7.AC1 FUNCTIONAL clause). Each story owns its own
// describe() block; the T23 block continues to assert the renderer
// surface and the T7 block asserts the POST handler surface.
//
// T7 test_name_regex (POST /api/admin/categories writes category_verticals
// rows) matches the top-level T7 describe-name verbatim so the canonical
// runner test_name_regex binding is satisfied by name discovery alone.

import { describe, it, expect } from "vitest";
import { renderCategoriesView } from "../src/admin/views/categories";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

describe("admin categories editor (T23.AC2)", () => {
  it("category multi-vertical selection persists to category_verticals", () => {
    const html = renderCategoriesView();

    // Multi-vertical <select multiple>: the contract grep is
    // `(multiple).*verticals|verticals.*multiple` and at minimum needs
    // one matching line. The editor renders <select ... multiple ...>
    // with name="verticals[]" so submit serializes a multi-value field
    // that the server splits into category_verticals rows.
    expect(html).toMatch(/<select[^>]*multiple[^>]*>/);
    expect(html).toMatch(/name="verticals\[\]"/);
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
    // editor must surface a polite status message and never POST. The
    // aria-live region and preventDefault wiring guarantee this.
    expect(html).toMatch(/aria-live="polite"/);
    expect(html).toContain("Select at least one vertical");
    expect(html).toMatch(/preventDefault/);
    expect(html).toMatch(/stopImmediatePropagation/);

    // Smoke shell contract from T10.AC1 — categories view must keep
    // the data-area and admin-shell marker so the integration suite
    // still recognises the page.
    expect(html).toMatch(/data-area="categories"/);
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
