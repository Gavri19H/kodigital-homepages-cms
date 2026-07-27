// LeadGen Phase 12 Stage B — the contract 08 §24 analytics admin route over the
// REAL admin router + REAL 0036–0039 migrations (node:sqlite harness; the
// leadgen-auctions-api.test.ts pattern with DEV_BYPASS_AUTH). Covers
// POST /api/admin/leadgen/analytics/rebuild-range: JSON + window validation
// (400s), the MAX_RANGE_DAYS bound, and the honest CH-absent no-op (200 with
// configured:false — never a 5xx) that proves the route is wired + reachable
// through the admin surface. The full CH→D1 sync mechanics are proven in
// leadgen-mirror-sync.test.ts (mocked CH + seeded D1 + node:sqlite end-to-end).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

// --- node:sqlite harness (repo pattern) --------------------------------------

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    return (nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule;
      if (typeof getBuiltin === "function") return (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
    } catch {
      /* fall through */
    }
    return null;
  }
}

function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

function d1FromSqlite(sdb: SqliteDb): D1Database {
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first<T = unknown>(): Promise<T | null> { return (sdb.prepare(sql).get(...binds) ?? null) as T | null; },
        async all<T = unknown>() { return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} }; },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
          return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const statement of statements) results.push(await statement.run());
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return results;
    },
  } as unknown as D1Database;
  return db;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

// Rework P1 coherence sweep (conductor-consolidated round): brought
// current through 0053 (was stale) so this harness's D1 schema matches
// the real Wave-1 shape (handlers now write M1/M2/M4/M5 columns/tables
// this file's schema never had).
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql",
  "0043_leadgen_routing_rules.sql",
  "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql",
  "0046_leadgen_rework_m1_variants.sql",
  "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql",
  "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql",
  "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql",
  "0053_leadgen_rework_m12_othergroup_retirement.sql",
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      // Rework migrations 0046-0053 add FK-referencing tables/columns that
      // assume `media` exists (this harness never needed it while frozen at
      // 0042) — added so the bumped chain applies cleanly.
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
  );
  for (const file of LEADGEN_MIGRATIONS) {
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  }
  return sdb;
}

// buildEnv deliberately OMITS CH_URL/CH_USER/CH_PASSWORD → the sync is a
// structured no-op (configured:false), which is the correct admin-visible
// result until ops applies the DDL + runs the Athena→CH ingest (OQ-3).
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
    DEV_BYPASS_AUTH: "true",
  } as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newEnv(): Env {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  return buildEnv(d1FromSqlite(createLeadgenDb(ctor)));
}

const URL = "/api/admin/leadgen/analytics/rebuild-range";

function post(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describeDb("POST /api/admin/leadgen/analytics/rebuild-range (§24 manual CH→D1 backfill)", () => {
  it("rejects a non-JSON body with 400", async () => {
    const res = await admin.request(URL, { method: "POST", headers: { "content-type": "application/json" }, body: "not-json" }, newEnv());
    expect(res.status).toBe(400);
  });

  it("rejects a missing/malformed `from` with 400", async () => {
    const res = await admin.request(URL, post({ to: "2026-07-07" }), newEnv());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields?: { from?: string } };
    expect(body.fields?.from).toBeDefined();
  });

  it("rejects a malformed `to` with 400", async () => {
    const res = await admin.request(URL, post({ from: "2026-07-01", to: "07/07/2026" }), newEnv());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields?: { to?: string } };
    expect(body.fields?.to).toBeDefined();
  });

  it("rejects from > to with 400 (range)", async () => {
    const res = await admin.request(URL, post({ from: "2026-07-07", to: "2026-07-01" }), newEnv());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields?: { range?: string } };
    expect(body.fields?.range).toBeDefined();
  });

  it("rejects a window wider than the cost bound (400)", async () => {
    const res = await admin.request(URL, post({ from: "2020-01-01", to: "2026-07-07" }), newEnv());
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields?: { range?: string } };
    expect(body.fields?.range).toContain("exceeds");
  });

  it("valid window + NO CH secrets → 200 with an honest no-op summary (configured:false), never a 5xx", async () => {
    const res = await admin.request(URL, post({ from: "2026-07-06", to: "2026-07-07" }), newEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rebuild?: { configured?: boolean; skipped?: string } };
    expect(body.rebuild).toBeDefined();
    expect(body.rebuild?.configured).toBe(false);
    expect(body.rebuild?.skipped).toMatch(/CH credentials absent/i);
  });
});
