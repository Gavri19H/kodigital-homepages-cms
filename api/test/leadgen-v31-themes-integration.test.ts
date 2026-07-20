// LeadGen v3.1 §10 (Concern 2) — Themes manager FOUNDATIONS (Phase A, slice
// A3), integration half: the sibling leadgen-v31-themes.test.ts covers pure
// theme.ts resolution + KV CRUD; THIS file proves the two write/read seams
// that need a real funnel/variant/section:
//
//   §10.6/§12  POST /sections/preview `theme_id` param — resolves the KV
//              record and feeds it through the SAME resolveTokens the
//              composed frame_context branch already calls; absent theme_id
//              stays byte-identical.
//   §10.1      Assignment API — funnel `theme_json={"theme_id":…}` (PUT
//              /funnels/:id/theme) and variant `frame_overrides_json.
//              theme_id` (PUT /variants/:id), each additive + minimally
//              validated ("theme_id must exist in the store").

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import type { ThemeRecord } from "../src/public/leadgen/designs/theme";

// --- node:sqlite harness (repo pattern — duplicated per test file, per
// leadgen-frame-routes.test.ts / leadgen-section-preview-frame.test.ts) -----

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
    // unrelated `lg-funnel-themes` store) as matching, so an invalidation
    // call with no `match` predicate would delete it — a TEST-FIDELITY false
    // positive that never happens against real KV, where the prefix filter
    // is enforced server-side.
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
    ],
  });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', 0, 'active')",
    )
    .run(publicId, `Section ${qid}`, headline, content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as {
    id: number;
  };
  return { id: row.id, public_id: publicId };
}

interface SeededFixture {
  h: Harness;
  quotePublicId: string;
  funnelPublicId: string;
  funnelId: number;
  variantPublicId: string;
  sectionPublicId: string;
  sectionContentJson: string;
  sectionHeadline: string;
}

// One quote -> funnel -> control-variant -> one section, with a minimal
// frame_config_json (§13.4 requires SOME stored frame for the composed
// branch — "centered" template, no theme, no overrides). No activation
// (resolveSectionPreviewFrame needs none — activation is orthogonal).
async function seedFixture(): Promise<SeededFixture> {
  const h = newHarness();
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Themes Preview Quote", activity: "quote_funnel", verticals: ["life"] }),
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

  const sectionRow = h.sdb.prepare("SELECT content_json, headline_text FROM leadgen_sections WHERE id = ?").get(
    section.id,
  ) as { content_json: string; headline_text: string };

  return {
    h,
    quotePublicId: created.public_id,
    funnelPublicId,
    funnelId: funnelRow.id,
    variantPublicId,
    sectionPublicId: section.public_id,
    sectionContentJson: sectionRow.content_json,
    sectionHeadline: sectionRow.headline_text,
  };
}

function previewBody(fx: SeededFixture, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    content_json: fx.sectionContentJson,
    headline: fx.sectionHeadline,
    section_public_id: fx.sectionPublicId,
    frame_context: { funnel_public_id: fx.funnelPublicId, variant_public_id: fx.variantPublicId },
    ...(extra ?? {}),
  };
}

interface PreviewResponse {
  preview: { css: string; desktop: string; design_id: string };
}

const THEME_BODY = {
  name: "Distinct Theme",
  roles: {
    brand_primary: "#ABCDEF",
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

// ===========================================================================
// 1. POST /sections/preview — theme_id (§10.6/§12 parity)
// ===========================================================================

describeDb("POST /sections/preview — theme_id override (v3.1 §10.6/§12)", () => {
  it("absent theme_id renders the composed frame with the BASE design's own primary colour", async () => {
    const fx = await seedFixture();
    const res = await admin.request(`${API}/sections/preview`, jsonInit("POST", previewBody(fx)), fx.h.env);
    expect(res.status, `preview: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as PreviewResponse;
    expect(body.preview.css).not.toContain("#ABCDEF");
  });

  it("theme_id resolves the KV record and feeds its roles into the SAME composed css (§12 parity)", async () => {
    const fx = await seedFixture();
    const theme = await createTheme(fx.h.env);
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", previewBody(fx, { theme_id: theme.id })),
      fx.h.env,
    );
    expect(res.status, `preview: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as PreviewResponse;
    expect(body.preview.css).toContain("#ABCDEF");
  });

  it("an UNKNOWN theme_id → 400, field-precise, no crash", async () => {
    const fx = await seedFixture();
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", previewBody(fx, { theme_id: "thm_does_not_exist" })),
      fx.h.env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields: Record<string, string> };
    expect(body.fields["theme_id"]).toBeTruthy();
  });

  it("a non-string theme_id → 400", async () => {
    const fx = await seedFixture();
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", previewBody(fx, { theme_id: 42 })),
      fx.h.env,
    );
    expect(res.status).toBe(400);
  });

  it("a legacy body with NEITHER frame_context NOR theme_id stays 200 (byte-identical existing path untouched)", async () => {
    const fx = await seedFixture();
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", { content_json: fx.sectionContentJson, headline: fx.sectionHeadline }),
      fx.h.env,
    );
    expect(res.status, `preview: ${await res.clone().text()}`).toBe(200);
  });
});

// ===========================================================================
// 2. Assignment API — funnel theme_json={theme_id} / variant
//    frame_overrides_json.theme_id (§10.1)
// ===========================================================================

describeDb("PUT /funnels/:id/theme — theme_json={theme_id} assignment (v3.1 §10.1)", () => {
  it("assigns a KNOWN theme_id: 200, persisted, effective_tokens reflects the record's roles", async () => {
    const fx = await seedFixture();
    const theme = await createTheme(fx.h.env);
    const res = await admin.request(
      `${API}/funnels/${fx.funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { theme_id: theme.id } }),
      fx.h.env,
    );
    expect(res.status, `put theme: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as { effective_tokens: Record<string, string> };
    expect(body.effective_tokens["brand_primary"]).toBe("#ABCDEF");

    const row = fx.h.sdb
      .prepare("SELECT theme_json AS v FROM leadgen_funnels WHERE id = ?")
      .get(fx.funnelId) as { v: string };
    expect(JSON.parse(row.v)).toEqual({ theme_id: theme.id });
  });

  it("assigning an UNKNOWN theme_id → 400 + problems; theme_json stays NULL (nothing persisted)", async () => {
    const fx = await seedFixture();
    const res = await admin.request(
      `${API}/funnels/${fx.funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { theme_id: "thm_missing" } }),
      fx.h.env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { problems: Array<{ path: string }> };
    expect(body.problems.some((p) => p.path === "theme_json.theme_id")).toBe(true);

    const row = fx.h.sdb
      .prepare("SELECT theme_json AS v FROM leadgen_funnels WHERE id = ?")
      .get(fx.funnelId) as { v: string | null };
    expect(row.v).toBeNull();
  });

  it("theme_id mixed with legacy palette keys is REJECTED (structural, via validateTheme)", async () => {
    const fx = await seedFixture();
    const theme = await createTheme(fx.h.env);
    const res = await admin.request(
      `${API}/funnels/${fx.funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { theme_id: theme.id, palette: { brand_primary: "#000000" } } }),
      fx.h.env,
    );
    expect(res.status).toBe(400);
  });

  it("the pre-existing legacy inline theme_json PUT still works unchanged (regression pin)", async () => {
    const fx = await seedFixture();
    const res = await admin.request(
      `${API}/funnels/${fx.funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { version: 1, palette: { brand_primary: "#0B5FFF" } } }),
      fx.h.env,
    );
    expect(res.status, `put theme: ${await res.clone().text()}`).toBe(200);
    const row = fx.h.sdb
      .prepare("SELECT theme_json AS v FROM leadgen_funnels WHERE id = ?")
      .get(fx.funnelId) as { v: string };
    expect(row.v).toContain("#0B5FFF");
  });
});

describeDb("PUT /variants/:id — frame_overrides_json.theme_id assignment (v3.1 §10.1)", () => {
  it("assigns a KNOWN theme_id as an ADDITIVE key, preserving existing frame_overrides_json keys", async () => {
    const fx = await seedFixture();
    const theme = await createTheme(fx.h.env);
    const res = await admin.request(
      `${API}/variants/${fx.variantPublicId}`,
      jsonInit("PUT", { frame_overrides_json: { header: { logo_size: "s" }, theme_id: theme.id } }),
      fx.h.env,
    );
    expect(res.status, `put variant: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as { frame_overrides_json: unknown };
    expect(body.frame_overrides_json).toEqual({ header: { logo_size: "s" }, theme_id: theme.id });

    const row = fx.h.sdb
      .prepare("SELECT frame_overrides_json AS v FROM leadgen_funnel_variants WHERE public_id = ?")
      .get(fx.variantPublicId) as { v: string };
    expect(JSON.parse(row.v)).toEqual({ header: { logo_size: "s" }, theme_id: theme.id });
  });

  it("assigning an UNKNOWN theme_id → 400 + problems; frame_overrides_json unchanged", async () => {
    const fx = await seedFixture();
    const res = await admin.request(
      `${API}/variants/${fx.variantPublicId}`,
      jsonInit("PUT", { frame_overrides_json: { theme_id: "thm_missing" } }),
      fx.h.env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields: Record<string, string>; problems: Array<{ path: string }> };
    expect(body.fields["frame_overrides_json"]).toBeTruthy();
    expect(body.problems.some((p) => p.path === "frame_overrides.theme_id")).toBe(true);

    const row = fx.h.sdb
      .prepare("SELECT frame_overrides_json AS v FROM leadgen_funnel_variants WHERE public_id = ?")
      .get(fx.variantPublicId) as { v: string | null };
    expect(row.v).toBeNull();
  });

  it("an empty-string theme_id → 400", async () => {
    const fx = await seedFixture();
    const res = await admin.request(
      `${API}/variants/${fx.variantPublicId}`,
      jsonInit("PUT", { frame_overrides_json: { theme_id: "" } }),
      fx.h.env,
    );
    expect(res.status).toBe(400);
  });

  it("the pre-existing theme.palette ad hoc override still works unchanged (regression pin)", async () => {
    const fx = await seedFixture();
    const res = await admin.request(
      `${API}/variants/${fx.variantPublicId}`,
      jsonInit("PUT", { frame_overrides_json: { theme: { palette: { accent: "#116611" } } } }),
      fx.h.env,
    );
    expect(res.status, `put variant: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as { frame_overrides_json: unknown };
    expect(body.frame_overrides_json).toEqual({ theme: { palette: { accent: "#116611" } } });
  });
});
