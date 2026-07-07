// LeadGen §25/§26/§29 revenue cron isolation + fail-open (contract 08 §25 + 09
// §29). runLeadgenRevenueCron is called from index.ts scheduled() in its own
// try/catch beside syncLeadgenAnalytics; this proves the function is fail-open by
// itself — a throwing DB is contained per sub-task (the cron never throws), and
// with a real DB but absent CH the daily path is a structured no-op that still
// seeds the §26 default platform + the §29 FX USD identity. No scheduled harness
// is fabricated (the unit contract IS the fail-open guarantee).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Env } from "../src/env";
import { runLeadgenRevenueCron } from "../src/leadgen/revenue-recon";

// --- node:sqlite harness (repo pattern) --------------------------------------

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
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
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          return (sdb.prepare(sql).get(...binds) ?? null) as T | null;
        },
        async all<T = unknown>() {
          return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} };
        },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
          return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
] as const;

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(sdb, "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);");
  for (const file of MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
}

function baseEnv(db: D1Database): Env {
  return { DB: db, CACHE: makeKv(), APP_ENV: "test" } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

describe("runLeadgenRevenueCron — fail-open isolation", () => {
  it("a DB whose every statement throws is contained — the cron NEVER throws", async () => {
    const throwingDb = {
      prepare() {
        throw new Error("db down");
      },
    } as unknown as D1Database;
    const env = { DB: throwingDb, CACHE: makeKv(), APP_ENV: "test" } as unknown as Env;
    // force:true drives EVERY sub-task (ship, sweep, seed, fx, recon, report) —
    // each throw is contained by runLeadgenRevenueCron's own per-task try/catch.
    const summary = await runLeadgenRevenueCron(env, { force: true });
    expect(summary).toBeTruthy();
    expect(summary.daily_ran).toBe(true); // the daily gate opened; sub-tasks were contained
  });
});

describeDb("runLeadgenRevenueCron — daily path with absent CH (structured no-op)", () => {
  it("no CH secrets ⇒ ship/sweep no-op, but the §26 default platform + §29 FX identity are seeded", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = baseEnv(d1FromSqlite(sdb));
    const summary = await runLeadgenRevenueCron(env, { force: true });

    expect(summary.daily_ran).toBe(true);
    // CH is unconfigured → the D1→CH shipper is an honest structured no-op.
    expect(summary.ship?.configured).toBe(false);
    expect(summary.ship?.shipped).toBe(0);

    // §26 default (disabled) facebook platform seeded idempotently.
    const fb = sdb.prepare("SELECT enabled FROM leadgen_media_platforms WHERE platform = 'facebook'").get() as
      | { enabled: number }
      | undefined;
    expect(fb).toBeDefined();
    expect(fb?.enabled).toBe(0);

    // §29 FX USD identity seeded.
    const fx = sdb.prepare("SELECT usd_rate FROM leadgen_fx_rates WHERE currency = 'USD'").get() as { usd_rate: number } | undefined;
    expect(fx?.usd_rate).toBe(1);
  });
});
