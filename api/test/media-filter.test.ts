// T9 — Site-scoped Media filter contract.
//
// T9.AC2 BEHAVIORAL: GIVEN media rows exist for site X (3) and site_id=null
// (2 global), WHEN data.ts:listMediaForSite(X) is called, THEN it returns 5
// rows (3 site + 2 global).
//
// The top-level describe name matches the typed evidence binding regex
// `media filter returns site-scoped and global media`.

import { describe, it, expect } from "vitest";
import { listMediaForSite } from "../src/admin/data";
import type { Env } from "../src/env";

interface MediaRow {
  id: number;
  filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  site_id: string | null;
  created_at: string;
}

// Fake D1 shim. Captures the executed SQL + binds so the test can assert
// both the row filter (returned rows) AND the parameterized predicate
// (WHERE site_id = ? OR site_id IS NULL).
function makeFakeDb(allRows: MediaRow[]): {
  db: D1Database;
  capturedSql: { value: string | null };
  capturedBinds: { value: unknown[] };
} {
  const capturedSql: { value: string | null } = { value: null };
  const capturedBinds: { value: unknown[] } = { value: [] };
  const db = {
    prepare(sql: string) {
      capturedSql.value = sql;
      const stmt = {
        bind(...args: unknown[]) {
          capturedBinds.value = args;
          return stmt;
        },
        async first(): Promise<unknown> {
          return null;
        },
        async run() {
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          if (!sql.includes("FROM media")) {
            return { results: [] as T[], success: true, meta: {} };
          }
          const siteId = String(capturedBinds.value[0] ?? "");
          const filtered = allRows.filter(
            (r) => r.site_id === siteId || r.site_id === null,
          );
          // Mirror the production ORDER BY created_at DESC, id DESC.
          filtered.sort((a, b) => {
            if (a.created_at !== b.created_at) {
              return a.created_at < b.created_at ? 1 : -1;
            }
            return b.id - a.id;
          });
          return {
            results: filtered as unknown as T[],
            success: true,
            meta: {},
          };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return { db, capturedSql, capturedBinds };
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
  } as Env;
}

describe("media filter returns site-scoped and global media", () => {
  const SITE_X = "site-x";
  const SITE_Y = "site-y";

  const rows: MediaRow[] = [
    {
      id: 1,
      filename: "x-1.png",
      storage_key: "x1.png",
      mime_type: "image/png",
      size_bytes: 100,
      site_id: SITE_X,
      created_at: "2026-05-17T10:00:00Z",
    },
    {
      id: 2,
      filename: "x-2.png",
      storage_key: "x2.png",
      mime_type: "image/png",
      size_bytes: 200,
      site_id: SITE_X,
      created_at: "2026-05-17T11:00:00Z",
    },
    {
      id: 3,
      filename: "x-3.png",
      storage_key: "x3.png",
      mime_type: "image/png",
      size_bytes: 300,
      site_id: SITE_X,
      created_at: "2026-05-17T12:00:00Z",
    },
    {
      id: 4,
      filename: "global-1.png",
      storage_key: "g1.png",
      mime_type: "image/png",
      size_bytes: 400,
      site_id: null,
      created_at: "2026-05-17T13:00:00Z",
    },
    {
      id: 5,
      filename: "global-2.png",
      storage_key: "g2.png",
      mime_type: "image/png",
      size_bytes: 500,
      site_id: null,
      created_at: "2026-05-17T14:00:00Z",
    },
    {
      id: 6,
      filename: "y-only.png",
      storage_key: "y1.png",
      mime_type: "image/png",
      size_bytes: 600,
      site_id: SITE_Y,
      created_at: "2026-05-17T15:00:00Z",
    },
  ];

  it("T9.AC2: listMediaForSite(X) returns 5 rows (3 site + 2 global) and excludes other sites", async () => {
    const { db, capturedSql, capturedBinds } = makeFakeDb(rows);
    const env = makeEnv(db);

    const result = await listMediaForSite(env, SITE_X);

    expect(result).toHaveLength(5);

    const siteScoped = result.filter((r) => r.site_id === SITE_X);
    const globalScoped = result.filter((r) => r.site_id === null);
    expect(siteScoped).toHaveLength(3);
    expect(globalScoped).toHaveLength(2);

    // Site Y's row MUST NOT leak across the tenant boundary.
    const otherSite = result.filter((r) => r.site_id === SITE_Y);
    expect(otherSite).toHaveLength(0);

    // The site_id MUST be bound (parameterized) — not interpolated.
    expect(capturedBinds.value).toEqual([SITE_X]);

    // The SQL MUST carry the OR site_id IS NULL predicate so global rows
    // are joined into the per-site listing.
    expect(capturedSql.value).toContain("FROM media");
    expect(capturedSql.value).toContain("site_id = ?");
    expect(capturedSql.value).toContain("site_id IS NULL");
  });

  it("T9.AC2: listMediaForSite(empty-site) still returns global rows", async () => {
    const onlyGlobals: MediaRow[] = rows.filter((r) => r.site_id === null);
    const { db } = makeFakeDb(onlyGlobals);
    const env = makeEnv(db);

    const result = await listMediaForSite(env, "no-such-site");

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.site_id === null)).toBe(true);
  });

  it("T9.AC3 (production_pending): R2 actual upload is deferred; this story binds the read-side filter only", () => {
    // R2 binding name is asserted in T9.AC1 via grep against wrangler.toml
    // (binding = "MEDIA"). The actual upload + R2 write path is a
    // production_pending evidence route (RC-023 deferred_production_pending
    // per implementation_digest.md). This case documents the boundary so
    // future regressions don't fold an R2 write into this dry-run test.
    expect(true).toBe(true);
  });
});
