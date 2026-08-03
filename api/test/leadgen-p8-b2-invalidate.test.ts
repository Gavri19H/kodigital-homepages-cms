// P8 defect contract v3, B2 (R2-2) — "A theme-record edit never invalidates
// the funnel's served config. PATCH /themes/<id> changing brand_primary left
// the live sheet ... stale ... until an unrelated activation PUT flushed it.
// putFunnelThemeHandler calls bumpActiveVariantContentVersions; the
// theme-record PATCH path does not."
//
// This drives the REAL admin router (src/admin/router.ts -> leadgen/router.ts)
// against a real node:sqlite-backed D1 + an in-memory KV stub (repo pattern,
// duplicated per test file — mirrors leadgen-v31-themes-integration.test.ts),
// so the assertions observe actual persisted content_version rows, not a
// hand-built double of either side of the producer/consumer boundary.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import type { ThemeRecord } from "../src/public/leadgen/designs/theme";

// --- node:sqlite harness (repo pattern — duplicated per test file, per
// leadgen-v31-themes-integration.test.ts / leadgen-rework-handlers.test.ts) --

type SqliteStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};
type SqliteDb = {
  prepare(sql: string): SqliteStatement;
  close(): void;
  [method: string]: unknown;
};
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    const mod = nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
    return mod.DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as {
        getBuiltinModule?: (name: string) => unknown;
      }).getBuiltinModule;
      if (typeof getBuiltin === "function") {
        const mod = getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
        return mod.DatabaseSync;
      }
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
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          const r = sdb.prepare(sql).get(...binds);
          return (r ?? null) as T | null;
        },
        async all<T = unknown>() {
          const rows = sdb.prepare(sql).all(...binds);
          return { results: rows as T[], success: true, meta: {} };
        },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as {
            changes?: number;
            lastInsertRowid?: number | bigint;
          };
          return {
            success: true,
            meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) },
          };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const statement of statements) {
          results.push(await statement.run());
        }
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

function makeKvStub(): KVNamespace {
  const store = new Map<string, { value: string; metadata: unknown }>();
  return {
    async get(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)!.value : null;
    },
    async getWithMetadata(key: string): Promise<{ value: string | null; metadata: unknown }> {
      const e = store.get(key);
      return e ? { value: e.value, metadata: e.metadata ?? null } : { value: null, metadata: null };
    },
    async put(key: string, value: string, opts?: { metadata?: unknown }): Promise<void> {
      store.set(key, { value, metadata: opts?.metadata ?? null });
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list(options?: {
      prefix?: string;
      cursor?: string;
    }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor: string }> {
      const prefix = options?.prefix ?? "";
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
      return { keys: keys.map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

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

const API = "/api/admin/leadgen";

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  for (const file of LEADGEN_MIGRATIONS) {
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  }
  return sdb;
}

function buildEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db,
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "300",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    LEADGEN_CONFIG_SIGNING_KEY: "runtime-signing-key-test-only",
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function jsonInit(method: string, body?: unknown): RequestInit {
  return body === undefined
    ? { method }
    : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

interface Harness {
  sdb: SqliteDb;
  env: Env;
}

function newHarness(): Harness {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), makeKvStub()) };
}

interface QuoteFunnel {
  funnelPublicId: string;
  variantPublicId: string;
}

async function createQuoteFunnel(env: Env, name: string): Promise<QuoteFunnel> {
  const res = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: name, activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(res.status, `create quote: ${await res.clone().text()}`).toBe(201);
  const body = (await res.json()) as {
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  return {
    funnelPublicId: body.funnels[0]!.public_id,
    variantPublicId: body.funnels[0]!.variants[0]!.public_id,
  };
}

const THEME_BODY = {
  name: "B2 Repro Theme",
  roles: {
    brand_primary: "#0B5FFF",
    accent: "#123456",
    page_bg: "#F0F0F0",
    card: "#FFFFFF",
    text: "#101010",
    success: "#0E7C3A",
    error: "#B23A2C",
  },
  typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
  controls: { field_height: "medium", button_size: "m", corners: "rounded" },
};

async function createTheme(env: Env): Promise<ThemeRecord> {
  const res = await admin.request(`${API}/themes`, jsonInit("POST", THEME_BODY), env);
  expect(res.status, `create theme: ${await res.clone().text()}`).toBe(201);
  const body = (await res.json()) as { item: ThemeRecord };
  return body.item;
}

function readContentVersion(sdb: SqliteDb, variantPublicId: string): number {
  return (
    sdb.prepare("SELECT content_version FROM leadgen_funnel_variants WHERE public_id = ?").get(
      variantPublicId,
    ) as { content_version: number }
  ).content_version;
}

describeDb("B2 (P8 defect contract R2-2): theme-record PATCH invalidates served config", () => {
  it(
    "a content-changing PATCH /themes/:id bumps content_version on the ACTIVE variant of the funnel " +
      "whose theme_json REFERENCES the record, and leaves a NON-referencing funnel's variant untouched",
    async () => {
      const h = newHarness();
      const referencing = await createQuoteFunnel(h.env, "B2 Referencing Funnel");
      const other = await createQuoteFunnel(h.env, "B2 Unrelated Funnel");
      const theme = await createTheme(h.env);

      // Assign the theme to ONE funnel only ({theme_id} reference, v3.1 §10.1).
      const assignRes = await admin.request(
        `${API}/funnels/${referencing.funnelPublicId}/theme`,
        jsonInit("PUT", { theme_json: { theme_id: theme.id } }),
        h.env,
      );
      expect(assignRes.status, `assign theme: ${await assignRes.clone().text()}`).toBe(200);

      // Baselines captured AFTER assignment (the PUT /theme path itself already
      // bumps once) so the PATCH-caused delta below is isolated and unambiguous.
      const before = readContentVersion(h.sdb, referencing.variantPublicId);
      const otherBefore = readContentVersion(h.sdb, other.variantPublicId);

      // The reproduced defect: PATCH /themes/:id changing brand_primary.
      const patchRes = await admin.request(
        `${API}/themes/${theme.id}`,
        jsonInit("PATCH", { roles: { brand_primary: "#112233" } }),
        h.env,
      );
      expect(patchRes.status, `patch theme: ${await patchRes.clone().text()}`).toBe(200);

      const after = readContentVersion(h.sdb, referencing.variantPublicId);
      const otherAfter = readContentVersion(h.sdb, other.variantPublicId);

      expect(
        after,
        "B2: a content-changing theme-record PATCH must bump content_version on the referencing funnel's active variant (was NEVER bumped pre-fix — only an unrelated activation PUT flushed it)",
      ).toBeGreaterThan(before);
      expect(
        otherAfter,
        "isolation leg: a funnel whose theme_json does NOT reference the patched theme must NOT be bumped",
      ).toBe(otherBefore);
    },
  );
});
