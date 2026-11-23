// X06 test kit: a real in-memory SQLite (node:sqlite) built from EVERY
// migration in api/migrations (so the seeded AI Presets with {{audience}} and
// the 0070 Vertical audiences are the production ones), and a fake AI that
// replaces global fetch for api.openai.com — no network, no real AI.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
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

export function d1FromSqlite(sdb: SqliteDb): D1Database {
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
  return { prepare: stmtFor } as unknown as D1Database;
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

export function createDb(): SqliteDb {
  const sdb = new DatabaseSync!(":memory:");
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  for (const f of files) runSql(sdb, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  return sdb;
}

export function addSite(
  sdb: SqliteDb,
  id: string,
  name: string,
  verticalSlug: string,
): void {
  sdb
    .prepare(
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES (?, ?, ?, ?, 'active')",
    )
    .run(id, name, `${id}.example`, verticalSlug);
}

export interface R2Put {
  key: string;
}

export function makeEnv(sdb: SqliteDb, withKey = true): Env {
  const env = buildEnv(d1FromSqlite(sdb));
  return {
    ...env,
    OPENAI_TEXT_MODEL: "gpt-5.5",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    MEDIA: {
      async put(key: string) {
        return { key } as unknown as R2Object;
      },
    } as unknown as R2Bucket,
    ...(withKey ? { OPENAI_API_KEY: "sk-test-fake" } : {}),
  } as Env;
}

export interface FakeAi {
  textPrompts: string[];
  imagePrompts: string[];
  restore(): void;
}

// answer(prompt, n) → the text the "AI" returns for the n-th text call (1-based),
// or { status } to answer with an HTTP error.
export function installFakeAi(
  answer: (prompt: string, n: number) => string | { status: number },
): FakeAi {
  const original = globalThis.fetch;
  const textPrompts: string[] = [];
  const imagePrompts: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages?: Array<{ role: string; content: string }>;
      prompt?: string;
    };
    if (url.includes("/v1/chat/completions")) {
      const prompt = body.messages?.[body.messages.length - 1]?.content ?? "";
      textPrompts.push(prompt);
      const a = answer(prompt, textPrompts.length);
      if (typeof a !== "string") {
        return new Response(JSON.stringify({ error: "fake" }), { status: a.status });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: a } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/v1/images/generations")) {
      imagePrompts.push(String(body.prompt ?? ""));
      return new Response(JSON.stringify({ data: [{ b64_json: "AQIDBA==" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`no outbound fetch allowed in tests: ${url}`);
  }) as typeof globalThis.fetch;
  return {
    textPrompts,
    imagePrompts,
    restore() {
      globalThis.fetch = original;
    },
  };
}
