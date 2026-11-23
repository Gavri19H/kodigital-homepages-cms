// X06 (A2, admin screens): a real in-memory SQLite (node:sqlite) built from
// EVERY migration in api/migrations, wrapped as a D1Database, plus a tiny
// request helper over the real admin router. Same set-up as
// test/verticals-admin.test.ts. Skipped where node:sqlite is absent; run with
// NODE_OPTIONS=--experimental-sqlite on Node 22.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import admin from "../../src/admin/router";
import type { Env } from "../../src/env";
import { buildEnv } from "./admin-test-kit";

type SqliteStatement = {
  run(...p: unknown[]): { changes?: number | bigint; lastInsertRowid?: number | bigint };
  get(...p: unknown[]): unknown;
  all(...p: unknown[]): unknown[];
};
export type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor })
      .DatabaseSync;
  } catch {
    return null;
  }
}
const DatabaseSync = loadDatabaseSync();
export const hasSqlite = DatabaseSync !== null;

function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

function d1FromSqlite(sdb: SqliteDb): D1Database {
  function stmtFor(sql: string) {
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
        const r = sdb.prepare(sql).run(...binds);
        return {
          success: true,
          meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) },
        };
      },
    };
    return stmt;
  }
  return {
    prepare: stmtFor,
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const s of statements) results.push(await s.run());
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return results;
    },
  } as unknown as D1Database;
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

/** Every migration up to (and including) `uptoPrefix` when given, else all. */
export function createDb(uptoPrefix?: string): SqliteDb {
  const sdb = new DatabaseSync!(":memory:");
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .filter((f) => uptoPrefix === undefined || f.slice(0, 4) <= uptoPrefix)
    .sort();
  for (const f of files) runSql(sdb, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  return sdb;
}

export function env(sdb: SqliteDb): Env {
  return buildEnv(d1FromSqlite(sdb));
}

export function addSite(sdb: SqliteDb, id: string, name: string, verticalSlug: string): void {
  sdb
    .prepare("INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES (?, ?, ?, ?, 'active')")
    .run(id, name, id + ".example", verticalSlug);
}

export async function call(
  sdb: SqliteDb,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await admin.request(
    path,
    {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env(sdb),
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

export async function page(sdb: SqliteDb, path: string): Promise<string> {
  const res = await admin.request(path, { method: "GET" }, env(sdb));
  if (res.status !== 200) throw new Error("GET " + path + " → " + res.status);
  return res.text();
}
