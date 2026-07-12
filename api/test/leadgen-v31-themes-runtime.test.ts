// LeadGen v3.1 §10/§12 (Phase A, slice A3 — fix round) — the LIVE runtime
// path resolves a funnel/variant's {theme_id} exactly like the admin preview
// paths do: "runtime, quote preview, and section-in-frame preview share
// identical resolution — a preview-only theme model can't merge" (conductor
// directive). This file proves the two live consumers directly:
//
//   GET /lg/:slug                       — serveFunnelShell (the cacheable
//                                          composed shell; serve.ts)
//   GET /lg/config/:funnel_variant_id   — serveLeadgenConfig (the cacheable
//                                          public client config; serve.ts)
//
// Both call resolveFrameComposition through the SAME resolveThemeRecordFor
// helper (ONE KV read on the cold-render path, mirroring loadAnswerMap-
// Versions' existing placement) — proven here via the served bytes, not the
// internal helper (a black-box HTTP proof, matching leadgen-frame-serve.test.ts
// conventions).
//
// Scenarios (conductor's explicit list): funnel theme_id: variant-override
// theme_id wins: unknown theme_id degrades (never throws, keeps serving);
// legacy inline theme_json unchanged; NULL theme_json unchanged.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import type { ThemeRecord } from "../src/public/leadgen/designs/theme";

// --- node:sqlite harness (repo pattern, duplicated per file per convention —
// leadgen-frame-serve.test.ts / leadgen-section-preview-frame.test.ts) -------

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
    // Real Cloudflare KV list() filters by `options.prefix` — the LIVE
    // cache-invalidation sweep (invalidate.ts deleteByPrefix) relies on this
    // to scope its list+delete to `lg-shell:`/`lg-config:` keys ONLY. A stub
    // that ignores `prefix` would report EVERY key (including this file's
    // unrelated `lg-funnel-themes` store) as matching an unrelated prefix
    // sweep, then delete it (deleteByPrefix has no `match` predicate on its
    // lg-config: call) — a TEST-FIDELITY false positive that never happens
    // against real KV, where the prefix filter is enforced server-side.
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
] as const;

const TENANT_HOST = "one.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;
const API = "/api/admin/leadgen";

function createRuntimeDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','one.example.com','insurance','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','one.example.com','active');",
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
  const sdb = createRuntimeDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), makeKvStub()) };
}

function seedSection(sdb: SqliteDb, headline: string, qid: string): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({
    components: [
      { type: "QuestionHeadline", question_id: `${qid}_h`, bind: "section_headline", props: {} },
      {
        type: "TwoButtonYesNo",
        question_id: qid,
        question_key: `${qid}_key`,
        internal_field: `${qid}_field`,
        answer_type: "boolean",
      },
      { type: "ContinueButton", question_id: `${qid}_c`, props: { label: "Continue" } },
    ],
  });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', 0, 'active')",
    )
    .run(publicId, `Section ${publicId.slice(-4)}`, headline, content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as {
    id: number;
  };
  return { id: row.id, public_id: publicId };
}

interface SeededActivatedFunnel {
  h: Harness;
  quotePublicId: string;
  funnelPublicId: string;
  funnelId: number;
  variantPublicId: string;
}

// One activated quote -> funnel -> control-variant -> one section, with a
// minimal frame_config_json (a composition REQUIRES a stored frame — a NULL
// frame_config_json always takes the legacy-shell fork regardless of theme,
// so theme resolution needs the composed path to be observable). No theme
// set here — each test assigns its own.
async function seedActivatedFunnel(slug: string): Promise<SeededActivatedFunnel> {
  const h = newHarness();
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Runtime Theme Quote", activity: "quote_funnel", verticals: ["life"] }),
    h.env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const created = (await createRes.json()) as {
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  const funnelPublicId = created.funnels[0]!.public_id;
  const variantPublicId = created.funnels[0]!.variants[0]!.public_id;
  const funnelRow = h.sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(funnelPublicId) as {
    id: number;
  };

  const section = seedSection(h.sdb, "Are you insured?", "q1");
  const putRes = await admin.request(
    `${API}/variants/${variantPublicId}`,
    jsonInit("PUT", { sections: [{ section_id: section.id }] }),
    h.env,
  );
  expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);

  h.sdb
    .prepare("UPDATE leadgen_funnels SET frame_config_json = ? WHERE public_id = ?")
    .run(JSON.stringify({ version: 1, template: "centered" }), funnelPublicId);

  const actRes = await admin.request(
    `${API}/quotes/${created.public_id}/activation/site-1`,
    jsonInit("PUT", { enabled: true, slug }),
    h.env,
  );
  expect(actRes.status, `activate: ${await actRes.clone().text()}`).toBe(200);

  return { h, quotePublicId: created.public_id, funnelPublicId, funnelId: funnelRow.id, variantPublicId };
}

async function createTheme(env: Env, body: Record<string, unknown>): Promise<ThemeRecord> {
  const res = await admin.request(`${API}/themes`, jsonInit("POST", body), env);
  expect(res.status, `create theme: ${await res.clone().text()}`).toBe(201);
  return ((await res.json()) as { item: ThemeRecord }).item;
}

function themeBody(name: string, brandPrimary: string): Record<string, unknown> {
  return {
    name,
    roles: {
      brand_primary: brandPrimary,
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
}

function extractStyle(html: string): string {
  const start = html.indexOf("<style>") + "<style>".length;
  const end = html.indexOf("</style>", start);
  expect(start).toBeGreaterThan("<style>".length - 1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

// ===========================================================================

describeDb("live runtime path — theme_id resolution (v3.1 §10.1/§12 fix round)", () => {
  it("GET /lg/:slug: a funnel theme_id assignment reskins the served shell's CSS custom properties", async () => {
    const fx = await seedActivatedFunnel("thm-funnel");
    const theme = await createTheme(fx.h.env, themeBody("Funnel Theme", "#AABBCC"));

    const putRes = await admin.request(
      `${API}/funnels/${fx.funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { theme_id: theme.id } }),
      fx.h.env,
    );
    expect(putRes.status, `put theme: ${await putRes.clone().text()}`).toBe(200);

    const res = await app.request(`${TENANT_ORIGIN}/lg/thm-funnel`, {}, fx.h.env);
    expect(res.status, await res.clone().text()).toBe(200);
    const css = extractStyle(await res.text());
    expect(css).toContain("#AABBCC");
  });

  it("GET /lg/config/:funnel_variant_id: the SAME funnel theme_id bakes into design_tokens", async () => {
    const fx = await seedActivatedFunnel("thm-funnel-config");
    const theme = await createTheme(fx.h.env, themeBody("Config Theme", "#112233"));
    await admin.request(
      `${API}/funnels/${fx.funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { theme_id: theme.id } }),
      fx.h.env,
    );

    const res = await app.request(
      `${TENANT_ORIGIN}/lg/config/${fx.variantPublicId}`,
      {},
      fx.h.env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const config = (await res.json()) as { design_tokens: { color: { primary: string } } };
    expect(config.design_tokens.color.primary).toBe("#112233");
  });

  it("variant frame_overrides_json.theme_id WINS over the funnel's theme_id (winningThemeId precedence)", async () => {
    const fx = await seedActivatedFunnel("thm-variant-wins");
    const funnelTheme = await createTheme(fx.h.env, themeBody("Funnel Theme", "#111111"));
    const variantTheme = await createTheme(fx.h.env, themeBody("Variant Theme", "#222222"));

    await admin.request(
      `${API}/funnels/${fx.funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { theme_id: funnelTheme.id } }),
      fx.h.env,
    );
    const variantPut = await admin.request(
      `${API}/variants/${fx.variantPublicId}`,
      jsonInit("PUT", { frame_overrides_json: { theme_id: variantTheme.id } }),
      fx.h.env,
    );
    expect(variantPut.status, `put variant: ${await variantPut.clone().text()}`).toBe(200);

    const res = await app.request(`${TENANT_ORIGIN}/lg/thm-variant-wins`, {}, fx.h.env);
    expect(res.status, await res.clone().text()).toBe(200);
    const css = extractStyle(await res.text());
    expect(css).toContain("#222222");
    expect(css).not.toContain("#111111");
  });

  it("an UNKNOWN/deleted theme_id degrades to the legacy default look — never throws, keeps serving 200", async () => {
    const fx = await seedActivatedFunnel("thm-unknown");
    // Written directly (bypassing the write-path existence check, which would
    // otherwise reject it) to simulate a theme deleted AFTER assignment — the
    // exact "unknown/deleted id" degrade case resolveThemeRecordFor documents.
    fx.h.sdb
      .prepare("UPDATE leadgen_funnels SET theme_json = ?, updated_at = unixepoch() WHERE public_id = ?")
      .run(JSON.stringify({ theme_id: "thm_does_not_exist" }), fx.funnelPublicId);

    const res = await app.request(`${TENANT_ORIGIN}/lg/thm-unknown`, {}, fx.h.env);
    expect(res.status, await res.clone().text()).toBe(200);
    const css = extractStyle(await res.text());
    // The base default-funnel design's own brand_primary — proves the
    // degrade landed on the legacy default look, not a crash/500.
    expect(css).toContain("#1B3A5C");

    const configRes = await app.request(`${TENANT_ORIGIN}/lg/config/${fx.variantPublicId}`, {}, fx.h.env);
    expect(configRes.status, await configRes.clone().text()).toBe(200);
    const config = (await configRes.json()) as { design_tokens: { color: { primary: string } } };
    expect(config.design_tokens.color.primary).toBe("#1B3A5C");
  });

  it("legacy inline theme_json (no theme_id) still resolves exactly as before (regression pin)", async () => {
    const fx = await seedActivatedFunnel("thm-legacy-inline");
    const putRes = await admin.request(
      `${API}/funnels/${fx.funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { version: 1, palette: { brand_primary: "#0B5FFF" } } }),
      fx.h.env,
    );
    expect(putRes.status, `put theme: ${await putRes.clone().text()}`).toBe(200);

    const res = await app.request(`${TENANT_ORIGIN}/lg/thm-legacy-inline`, {}, fx.h.env);
    expect(res.status, await res.clone().text()).toBe(200);
    const css = extractStyle(await res.text());
    expect(css).toContain("#0B5FFF");
  });

  it("NULL theme_json (no theme at all) still resolves to the base design — byte-identical to pre-v3.1", async () => {
    const fx = await seedActivatedFunnel("thm-null");
    // theme_json is never set — stays NULL (the funnel-creation default).
    const res = await app.request(`${TENANT_ORIGIN}/lg/thm-null`, {}, fx.h.env);
    expect(res.status, await res.clone().text()).toBe(200);
    const css = extractStyle(await res.text());
    expect(css).toContain("#1B3A5C");

    const configRes = await app.request(`${TENANT_ORIGIN}/lg/config/${fx.variantPublicId}`, {}, fx.h.env);
    const config = (await configRes.json()) as { design_tokens: { color: { primary: string } } };
    expect(config.design_tokens.color.primary).toBe("#1B3A5C");
  });

  it("a cache HIT serves the previously-rendered bytes without a second KV read (no re-render on the warm path)", async () => {
    const fx = await seedActivatedFunnel("thm-cache-hit");
    const theme = await createTheme(fx.h.env, themeBody("Cache Theme", "#334455"));
    await admin.request(
      `${API}/funnels/${fx.funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { theme_id: theme.id } }),
      fx.h.env,
    );

    const first = await app.request(`${TENANT_ORIGIN}/lg/thm-cache-hit`, {}, fx.h.env);
    expect(first.status).toBe(200);
    const firstCss = extractStyle(await first.text());
    expect(firstCss).toContain("#334455");

    // Delete the theme record from KV directly — if the warm path re-read KV
    // it would degrade to the base design; the cached body must still win.
    const raw = await fx.h.env.CACHE.get("lg-funnel-themes");
    const records = JSON.parse(raw as string) as Record<string, unknown>;
    delete records[theme.id];
    await fx.h.env.CACHE.put("lg-funnel-themes", JSON.stringify(records));

    const second = await app.request(`${TENANT_ORIGIN}/lg/thm-cache-hit`, {}, fx.h.env);
    expect(second.status).toBe(200);
    const secondCss = extractStyle(await second.text());
    expect(secondCss).toContain("#334455"); // served from cache, unaffected
  });
});
