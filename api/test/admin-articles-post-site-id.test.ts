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
