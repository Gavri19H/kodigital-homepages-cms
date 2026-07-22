// LeadGen §26 media-platforms admin JSON CRUD (contract 08 §26 + 09 §30.2) over
// the REAL admin router + REAL 0036–0039 migrations (node:sqlite harness with
// DEV_BYPASS_AUTH — the leadgen-offers-api.test.ts pattern). Proves:
// create/list/get/patch/delete, dup platform → 409, the value_multiplier
// round-trip, the enabled toggle, and the §30.2 secret-VALUE masking (the
// auth_secret_ref NAME is surfaced; the resolved token value never is).

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

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
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
    // A resolved S2S token VALUE — must NEVER appear in any admin response.
    LEADGEN_S2S_TOKEN_FACEBOOK: "super-secret-token-value",
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;
const API = "/api/admin/leadgen/media-platforms";

function newEnv(): Env {
  return buildEnv(d1FromSqlite(createDb(DatabaseSync as DatabaseSyncCtor)));
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

const TEMPLATE = "https://example.com/s2s?cid={click_id}&v={value}&cur={currency}&ev={event_name}&t={auth_token}";

interface PlatformRow {
  id: number;
  platform: string;
  enabled: number;
  postback_url_template: string;
  auth_secret_ref: string | null;
  event_name: string | null;
  value_multiplier: number;
  created_at: number;
}

describeDb("§26 media-platforms admin CRUD", () => {
  it("create → 201; list; get by id + by platform name", async () => {
    const env = newEnv();
    const createRes = await admin.request(
      API,
      jsonInit("POST", { platform: "facebook", postback_url_template: TEMPLATE, auth_secret_ref: "LEADGEN_S2S_TOKEN_FACEBOOK", value_multiplier: 1.5 }),
      env,
    );
    expect(createRes.status, `create: ${await createRes.clone().text()}`).toBe(201);
    const created = (await createRes.json()) as { media_platform: PlatformRow };
    expect(created.media_platform.platform).toBe("facebook");
    expect(created.media_platform.enabled).toBe(0); // disabled by default (§26)
    expect(created.media_platform.value_multiplier).toBe(1.5);

    const listRes = await admin.request(API, {}, env);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { media_platforms: PlatformRow[] };
    expect(list.media_platforms).toHaveLength(1);

    const byId = await admin.request(`${API}/${created.media_platform.id}`, {}, env);
    expect(byId.status).toBe(200);
    const byName = await admin.request(`${API}/facebook`, {}, env);
    expect(byName.status).toBe(200);
    const byNameBody = (await byName.json()) as { media_platform: PlatformRow };
    expect(byNameBody.media_platform.id).toBe(created.media_platform.id);
  });

  it("duplicate platform → 409", async () => {
    const env = newEnv();
    const first = await admin.request(API, jsonInit("POST", { platform: "taboola", postback_url_template: TEMPLATE }), env);
    expect(first.status).toBe(201);
    const dup = await admin.request(API, jsonInit("POST", { platform: "taboola", postback_url_template: TEMPLATE }), env);
    expect(dup.status).toBe(409);
  });

  it("rejects a non-empty missing template + a negative value_multiplier → 400", async () => {
    const env = newEnv();
    const noTemplate = await admin.request(API, jsonInit("POST", { platform: "x" }), env);
    expect(noTemplate.status).toBe(400);
    const badMult = await admin.request(API, jsonInit("POST", { platform: "x", postback_url_template: TEMPLATE, value_multiplier: -1 }), env);
    expect(badMult.status).toBe(400);
  });

  it("SSRF: rejects a postback_url_template targeting a private/internal host → 400 (finding 6)", async () => {
    const env = newEnv();
    // The cloud-metadata address is the canonical SSRF target for the {auth_token} secret.
    for (const host of ["http://169.254.169.254/latest/meta-data", "http://127.0.0.1/tr", "http://10.0.0.5/x", "http://localhost/x", "http://metadata.google.internal/x"]) {
      const res = await admin.request(API, jsonInit("POST", { platform: "p", postback_url_template: `${host}?cid={click_id}` }), env);
      expect(res.status, `internal host ${host} must be rejected`).toBe(400);
    }
    // A legitimate public host still passes.
    const ok = await admin.request(API, jsonInit("POST", { platform: "pubok", postback_url_template: TEMPLATE }), env);
    expect(ok.status).toBe(201);
  });

  it("patch: enabled toggle + value_multiplier persisted; delete removes it", async () => {
    const env = newEnv();
    const createRes = await admin.request(API, jsonInit("POST", { platform: "outbrain", postback_url_template: TEMPLATE }), env);
    const created = (await createRes.json()) as { media_platform: PlatformRow };

    const patchRes = await admin.request(`${API}/${created.media_platform.id}`, jsonInit("PATCH", { enabled: true, value_multiplier: 2.25 }), env);
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { media_platform: PlatformRow };
    expect(patched.media_platform.enabled).toBe(1);
    expect(patched.media_platform.value_multiplier).toBe(2.25);

    const delRes = await admin.request(`${API}/${created.media_platform.id}`, { method: "DELETE" }, env);
    expect(delRes.status).toBe(200);
    const gone = await admin.request(`${API}/${created.media_platform.id}`, {}, env);
    expect(gone.status).toBe(404);
  });

  it("§30.2 masking: the response carries the auth_secret_ref NAME but NEVER the resolved token value", async () => {
    const env = newEnv();
    await admin.request(
      API,
      jsonInit("POST", { platform: "facebook", postback_url_template: TEMPLATE, auth_secret_ref: "LEADGEN_S2S_TOKEN_FACEBOOK" }),
      env,
    );
    const listRes = await admin.request(API, {}, env);
    const rawText = await listRes.clone().text();
    // The NAME is surfaced (operators need it to know which secret is wired)…
    expect(rawText).toContain("LEADGEN_S2S_TOKEN_FACEBOOK");
    // …but the resolved secret VALUE is NEVER anywhere in the response.
    expect(rawText).not.toContain("super-secret-token-value");
  });

  it("rejects an auth_secret_ref that looks like a token VALUE (not an UPPER_SNAKE name) → 400", async () => {
    const env = newEnv();
    const res = await admin.request(
      API,
      jsonInit("POST", { platform: "pinterest", postback_url_template: TEMPLATE, auth_secret_ref: "sk-live-abc123" }),
      env,
    );
    expect(res.status).toBe(400);
  });
});
