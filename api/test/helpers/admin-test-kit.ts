// Shared admin-router test kit (extracted from admin-articles-list.test.ts
// in T26). A planted-row fake D1 that records every prepare/bind call, a
// minimal fake KV (workflow transitions wipe per-site cache namespaces via
// CACHE.list/delete), and the canonical test Env with the dev auth bypass
// active so admin.request() passes the Access gate.

import type { Env } from "../../src/env";

export interface RecordedCall {
  sql: string;
  binds: unknown[];
}

export interface PlantedRow {
  match: string;
  row: unknown | null;
}

export interface PlantedList {
  match: string;
  rows: unknown[];
}

export function makeFakeDb(
  planted: PlantedRow[] = [],
  plantedLists: PlantedList[] = [],
): {
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
          for (const entry of plantedLists) {
            if (sql.indexOf(entry.match) >= 0) {
              return { results: entry.rows as T[], success: true, meta: {} };
            }
          }
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, calls };
}

export function makeFakeKv(): { kv: KVNamespace; deletes: string[] } {
  const deletes: string[] = [];
  const kv = {
    async get() {
      return null;
    },
    async put() {},
    async delete(k: string) {
      deletes.push(k);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
  return { kv, deletes };
}

export function buildEnv(db: D1Database, kv?: KVNamespace): Env {
  return {
    DB: db,
    CACHE: kv ?? makeFakeKv().kv,
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
  };
}
