// LeadGen v2.5 Phase B (slice B1) — the 04 §4.8 route table + 10 §10.5:
//
//   GET/PUT /funnels/:id/frame   — {frame_config, effective_frame,
//     template_defaults}; PUT validates (400 + §3.6 problems on error
//     severity, 14 §14.3 "invalid never persisted"), persists warnings WITH
//     the save, and bumps content_version on ACTIVE variants only (03 §3.1).
//   GET/PUT /funnels/:id/theme   — {theme, effective_tokens} (the resolved
//     role→value swatch table); same validation/versioning rules.
//   GET /frame-templates         — the 6-template registry projection.
//   GET /sites/:site_id/branding — resolveSiteBranding + has_logo (C4: ALL
//     CMS sites legal, no activation required).
//   PUT /variants/:id            — extended ADDITIVELY with
//     frame_overrides_json (§4.5/§4.7; serve-split validation) and
//   POST /variants/:id/fork      — the fork clones frame_overrides_json
//     ("a fork clones the arm", 04 §4.5).
//
// Harness: the leadgen-runtime-api node:sqlite pattern + migrations 0036–0041
// + a site_settings table (branding source).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import { mintPublicId } from "../src/leadgen/ids";
import type { Env } from "../src/env";
import { FRAME_TEMPLATE_IDS } from "../src/public/leadgen/designs/frames";

// --- node:sqlite harness (repo pattern) --------------------------------------

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
    // Real Cloudflare KV list() filters by `options.prefix` — the LIVE §28
    // cache-invalidation sweep (invalidate.ts deleteByPrefix) relies on this
    // to scope its list+delete to `lg-shell:`/`lg-config:` keys ONLY. A stub
    // that ignored `prefix` would report EVERY key as matching an unrelated
    // prefix sweep — a TEST-FIDELITY gap that never happens against real KV,
    // where the prefix filter is enforced server-side (found + fixed while
    // building the v3.1 Themes KV store, leadgen-v31-themes*.test.ts).
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

const API = "/api/admin/leadgen";
const SITE_LOGO_URL = "https://cdn.example.com/site-one-logo.png";

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT);" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','one.example.com','insurance','active');" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-2','Site Two','two.example.com','insurance','active');" +
      // site-1 = fully-branded (§10.1 keys); site-2 = bare (text-mark leg).
      "INSERT INTO site_settings (site_id, key, value) VALUES ('site-1','site_name','Site One Brand');" +
      `INSERT INTO site_settings (site_id, key, value) VALUES ('site-1','site_logo_url','${SITE_LOGO_URL}');` +
      "INSERT INTO site_settings (site_id, key, value) VALUES ('site-1','tagline','Compare fast');" +
      "INSERT INTO site_settings (site_id, key, value) VALUES ('site-1','contact_email','hi@one.example.com');" +
      "INSERT INTO site_settings (site_id, key, value) VALUES ('site-1','privacy_email','privacy@one.example.com');",
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

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

interface Harness {
  sdb: SqliteDb;
  env: Env;
}

function newHarness(): Harness {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), makeKvStub()) };
}

interface SeededQuote {
  quotePublicId: string;
  funnelPublicId: string;
  funnelId: number;
  controlPublicId: string;
}

async function seedQuote(h: Harness, name = "Frame Routes Quote"): Promise<SeededQuote> {
  const res = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: name, activity: "quote_funnel", verticals: ["life"] }),
    h.env,
  );
  expect(res.status, `create quote: ${await res.clone().text()}`).toBe(201);
  const created = (await res.json()) as {
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  const funnelPublicId = created.funnels[0]!.public_id;
  const funnelRow = h.sdb
    .prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?")
    .get(funnelPublicId) as { id: number };
  return {
    quotePublicId: created.public_id,
    funnelPublicId,
    funnelId: funnelRow.id,
    controlPublicId: created.funnels[0]!.variants[0]!.public_id,
  };
}

function funnelColumn(h: Harness, funnelId: number, column: "frame_config_json" | "theme_json"): string | null {
  const row = h.sdb
    .prepare(`SELECT ${column} AS v FROM leadgen_funnels WHERE id = ?`)
    .get(funnelId) as { v: string | null };
  return row.v;
}

function variantVersion(h: Harness, publicId: string): number {
  const row = h.sdb
    .prepare("SELECT content_version AS v FROM leadgen_funnel_variants WHERE public_id = ?")
    .get(publicId) as { v: number };
  return row.v;
}

type Problem = { path: string; scope: string; severity: string; message: string };

// ===========================================================================

describeDb("frame routes — GET/PUT /funnels/:id/frame (04 §4.8)", () => {
  it("GET on a legacy funnel: null stored config + the centered effective echo", async () => {
    const h = newHarness();
    const seed = await seedQuote(h);
    const res = await admin.request(`${API}/funnels/${seed.funnelPublicId}/frame`, {}, h.env);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      frame_config: unknown;
      effective_frame: { template: string; header: { enabled: boolean } };
      template_defaults: { template: string };
      problems: Problem[];
    };
    expect(body.frame_config).toBeNull();
    expect(body.effective_frame.template).toBe("centered");
    expect(body.effective_frame.header.enabled).toBe(true);
    expect(body.template_defaults.template).toBe("centered");
    expect(body.problems).toEqual([]);
  });

  it("PUT persists a valid config, echoes template ⊕ stored, and bumps ACTIVE variants only (03 §3.1)", async () => {
    const h = newHarness();
    const seed = await seedQuote(h);
    // A second ACTIVE variant + then archive it — the bump must skip it.
    // Rework M1 (§4.3-10): POST /funnels/:id/variants now unconditionally
    // refuses a 2nd active variant — see leadgen-quotes-api.test.ts's
    // Σ-gate test for the full rationale. This test's point is the frame
    // bump skipping archived variants, so the 2nd (soon-archived) variant
    // is seeded via raw SQL (leadgen-rework-handlers.test.ts's own
    // equal-arms idiom) instead.
    const extraId = mintPublicId("funnel_variant");
    h.sdb
      .prepare(
        "INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status) VALUES (?, ?, 'B', 10000, 'default', 'active')",
      )
      .run(extraId, seed.funnelId);
    h.sdb
      .prepare("UPDATE leadgen_funnel_variants SET status = 'archived' WHERE public_id = ?")
      .run(extraId);
    const controlBefore = variantVersion(h, seed.controlPublicId);
    const archivedBefore = variantVersion(h, extraId);

    const put = await admin.request(
      `${API}/funnels/${seed.funnelPublicId}/frame`,
      jsonInit("PUT", {
        frame_config_json: {
          version: 1,
          template: "header-footer",
          header: { tagline: "Fast quotes" },
        },
      }),
      h.env,
    );
    expect(put.status, await put.clone().text()).toBe(200);
    const body = (await put.json()) as {
      frame_config: { template: string; header: { tagline: string } };
      effective_frame: {
        template: string;
        header: { tagline: string | null; logo_align: string };
        section_slot: { card: string };
        footer: { show_logo: boolean };
      };
      template_defaults: { template: string };
      bumped_variants: number;
    };
    expect(body.frame_config.template).toBe("header-footer");
    // effective = template defaults ⊕ stored config (13 §13.2 one merge).
    expect(body.effective_frame.header.tagline).toBe("Fast quotes");
    expect(body.effective_frame.header.logo_align).toBe("left");
    expect(body.effective_frame.section_slot.card).toBe("bare");
    expect(body.effective_frame.footer.show_logo).toBe(true);
    expect(body.template_defaults.template).toBe("header-footer");
    expect(body.bumped_variants).toBe(1);

    const stored = funnelColumn(h, seed.funnelId, "frame_config_json");
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toMatchObject({ template: "header-footer" });
    expect(variantVersion(h, seed.controlPublicId)).toBe(controlBefore + 1);
    expect(variantVersion(h, extraId)).toBe(archivedBefore); // archived: untouched
  });

  it("no-op save (DEV-57): a byte-identical re-PUT skips the UPDATE + bump (200, bumped_variants 0, content_version UNCHANGED); a changed config bumps", async () => {
    const h = newHarness();
    const seed = await seedQuote(h);
    const config = { version: 1, template: "header-footer", header: { tagline: "Fast quotes" } };

    const first = await admin.request(
      `${API}/funnels/${seed.funnelPublicId}/frame`,
      jsonInit("PUT", { frame_config_json: config }),
      h.env,
    );
    expect(first.status, await first.clone().text()).toBe(200);
    expect(((await first.json()) as { bumped_variants: number }).bumped_variants).toBe(1);
    const versionAfterFirst = variantVersion(h, seed.controlPublicId);
    const storedAfterFirst = funnelColumn(h, seed.funnelId, "frame_config_json");

    // IDENTICAL second save: 200 with the normal projection shape, zero bump,
    // stored column byte-untouched.
    const second = await admin.request(
      `${API}/funnels/${seed.funnelPublicId}/frame`,
      jsonInit("PUT", { frame_config_json: config }),
      h.env,
    );
    expect(second.status, await second.clone().text()).toBe(200);
    const secondBody = (await second.json()) as {
      frame_config: Record<string, unknown>;
      effective_frame: { header: { tagline: string } };
      template_defaults: unknown;
      bumped_variants: number;
    };
    expect(secondBody.bumped_variants).toBe(0);
    expect(secondBody.frame_config).toEqual(config);
    expect(secondBody.effective_frame.header.tagline).toBe("Fast quotes");
    expect(secondBody.template_defaults).toBeDefined();
    expect(variantVersion(h, seed.controlPublicId)).toBe(versionAfterFirst);
    expect(funnelColumn(h, seed.funnelId, "frame_config_json")).toBe(storedAfterFirst);

    // a CHANGED config takes the normal write path and bumps again
    const changed = await admin.request(
      `${API}/funnels/${seed.funnelPublicId}/frame`,
      jsonInit("PUT", { frame_config_json: { ...config, header: { tagline: "New tagline" } } }),
      h.env,
    );
    expect(changed.status, await changed.clone().text()).toBe(200);
    expect(((await changed.json()) as { bumped_variants: number }).bumped_variants).toBe(1);
    expect(variantVersion(h, seed.controlPublicId)).toBe(versionAfterFirst + 1);
    expect(funnelColumn(h, seed.funnelId, "frame_config_json")).toContain("New tagline");
  });

  it("PUT with a schema-invalid config → 400 + §3.6 problems; nothing persisted; no bump (14 §14.3)", async () => {
    const h = newHarness();
    const seed = await seedQuote(h);
    const before = variantVersion(h, seed.controlPublicId);
    const put = await admin.request(
      `${API}/funnels/${seed.funnelPublicId}/frame`,
      jsonInit("PUT", {
        frame_config_json: { version: 1, template: "nope", bogus_group: {} },
      }),
      h.env,
    );
    expect(put.status).toBe(400);
    const body = (await put.json()) as { error: string; problems: Problem[] };
    expect(body.error).toBe("Validation failed");
    const paths = body.problems.filter((p) => p.severity === "error").map((p) => p.path);
    expect(paths).toContain("frame.template");
    expect(paths).toContain("frame.bogus_group");
    expect(funnelColumn(h, seed.funnelId, "frame_config_json")).toBeNull();
    expect(variantVersion(h, seed.controlPublicId)).toBe(before);

    // Non-object frame_config_json → the {error, fields} convention.
    const junk = await admin.request(
      `${API}/funnels/${seed.funnelPublicId}/frame`,
      jsonInit("PUT", { frame_config_json: "not-an-object" }),
      h.env,
    );
    expect(junk.status).toBe(400);
    expect(((await junk.json()) as { fields: Record<string, string> }).fields["frame_config_json"]).toBeTruthy();
  });

  it("warning-severity rows persist WITH the save (§4.4 manual logo) and re-surface on GET", async () => {
    const h = newHarness();
    const seed = await seedQuote(h);
    const put = await admin.request(
      `${API}/funnels/${seed.funnelPublicId}/frame`,
      jsonInit("PUT", {
        frame_config_json: {
          version: 1,
          template: "centered",
          header: { logo_source: "manual", logo_media_id: "logos/brand.png" },
        },
      }),
      h.env,
    );
    expect(put.status, await put.clone().text()).toBe(200);
    const putBody = (await put.json()) as { problems: Problem[] };
    const warning = putBody.problems.find((p) => p.path === "frame.header.logo_source");
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toBe("Manual logo overrides site branding.");
    // Persisted despite the warning (14 §14.3 severity split).
    expect(funnelColumn(h, seed.funnelId, "frame_config_json")).toContain('"manual"');

    const get = await admin.request(`${API}/funnels/${seed.funnelPublicId}/frame`, {}, h.env);
    const getBody = (await get.json()) as {
      frame_config: { header: { logo_source: string } };
      effective_frame: { header: { logo_media_id: string | null } };
      problems: Problem[];
    };
    expect(getBody.frame_config.header.logo_source).toBe("manual");
    expect(getBody.effective_frame.header.logo_media_id).toBe("logos/brand.png");
    expect(getBody.problems.some((p) => p.path === "frame.header.logo_source")).toBe(true);
  });

  it("unknown funnel → 404 on all four frame/theme routes", async () => {
    const h = newHarness();
    await seedQuote(h);
    for (const [method, path, body] of [
      ["GET", "/funnels/999999/frame", undefined],
      ["PUT", "/funnels/999999/frame", { frame_config_json: { version: 1 } }],
      ["GET", "/funnels/999999/theme", undefined],
      ["PUT", "/funnels/999999/theme", { theme_json: { version: 1 } }],
    ] as const) {
      const res = await admin.request(
        `${API}${path}`,
        body === undefined ? { method } : jsonInit(method, body),
        h.env,
      );
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });
});

describeDb("theme routes — GET/PUT /funnels/:id/theme (04 §4.8 + 09 §9.2)", () => {
  it("GET returns the stored theme + the resolved role→value swatch table (all 14 roles)", async () => {
    const h = newHarness();
    const seed = await seedQuote(h);
    const res = await admin.request(`${API}/funnels/${seed.funnelPublicId}/theme`, {}, h.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      theme: unknown;
      effective_tokens: Record<string, string>;
      problems: Problem[];
    };
    expect(body.theme).toBeNull();
    expect(Object.keys(body.effective_tokens)).toHaveLength(14);
    for (const value of Object.values(body.effective_tokens)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
    expect(body.problems).toEqual([]);
  });

  it("PUT validates, persists (custom-hex warning rides the save), resolves tokens, and bumps", async () => {
    const h = newHarness();
    const seed = await seedQuote(h);
    const before = variantVersion(h, seed.controlPublicId);

    const put = await admin.request(
      `${API}/funnels/${seed.funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { version: 1, palette: { brand_primary: "#0B5FFF" } } }),
      h.env,
    );
    expect(put.status, await put.clone().text()).toBe(200);
    const body = (await put.json()) as {
      theme: { palette: { brand_primary: string } };
      effective_tokens: Record<string, string>;
      problems: Problem[];
      bumped_variants: number;
    };
    expect(body.theme.palette.brand_primary).toBe("#0B5FFF");
    expect(body.effective_tokens["brand_primary"]).toBe("#0B5FFF");
    const warning = body.problems.find((p) => p.path === "theme.palette.brand_primary");
    expect(warning?.severity).toBe("warning"); // §9.3 custom colors — flagged, kept
    expect(body.bumped_variants).toBe(1);
    expect(funnelColumn(h, seed.funnelId, "theme_json")).toContain("#0B5FFF");
    expect(variantVersion(h, seed.controlPublicId)).toBe(before + 1);

    // no-op save (DEV-57): the identical theme re-PUT skips the UPDATE + bump
    // and keeps the normal response shape (warnings still ride it).
    const versionAfterFirst = variantVersion(h, seed.controlPublicId);
    const second = await admin.request(
      `${API}/funnels/${seed.funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { version: 1, palette: { brand_primary: "#0B5FFF" } } }),
      h.env,
    );
    expect(second.status, await second.clone().text()).toBe(200);
    const secondBody = (await second.json()) as {
      theme: { palette: { brand_primary: string } };
      effective_tokens: Record<string, string>;
      problems: Problem[];
      bumped_variants: number;
    };
    expect(secondBody.bumped_variants).toBe(0);
    expect(secondBody.theme.palette.brand_primary).toBe("#0B5FFF");
    expect(secondBody.effective_tokens["brand_primary"]).toBe("#0B5FFF");
    expect(secondBody.problems.some((p) => p.path === "theme.palette.brand_primary" && p.severity === "warning")).toBe(true);
    expect(variantVersion(h, seed.controlPublicId)).toBe(versionAfterFirst);

    // a CHANGED theme bumps again
    const changed = await admin.request(
      `${API}/funnels/${seed.funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { version: 1, palette: { brand_primary: "#0B5FFF" }, scales: { radius: "round" } } }),
      h.env,
    );
    expect(changed.status, await changed.clone().text()).toBe(200);
    expect(((await changed.json()) as { bumped_variants: number }).bumped_variants).toBe(1);
    expect(variantVersion(h, seed.controlPublicId)).toBe(versionAfterFirst + 1);
  });

  it("PUT with an invalid theme → 400 + problems; not persisted (14 §14.3)", async () => {
    const h = newHarness();
    const seed = await seedQuote(h);
    const put = await admin.request(
      `${API}/funnels/${seed.funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { palette: { bogus_role: "#111111" }, scales: { radius: "circle" } } }),
      h.env,
    );
    expect(put.status).toBe(400);
    const body = (await put.json()) as { problems: Problem[] };
    const paths = body.problems.filter((p) => p.severity === "error").map((p) => p.path);
    expect(paths).toContain("theme.palette.bogus_role");
    expect(paths).toContain("theme.scales.radius");
    expect(funnelColumn(h, seed.funnelId, "theme_json")).toBeNull();
  });
});

describeDb("GET /frame-templates — the §4.3 registry projection", () => {
  it("serves all 6 templates with id, label, thumbnail HTML, and per-group defaults", async () => {
    const h = newHarness();
    const res = await admin.request(`${API}/frame-templates`, {}, h.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{
        id: string;
        label: string;
        arrangement: string;
        thumbnail_html: string;
        defaults: Record<string, unknown> & { template: string };
      }>;
      default_template_id: string;
    };
    expect(body.items.map((i) => i.id)).toEqual([...FRAME_TEMPLATE_IDS]);
    expect(body.default_template_id).toBe("centered");
    const GROUPS = [
      "compat",
      "header",
      "progress",
      "back",
      "disclosure",
      "footer",
      "trust_strip",
      "benefit_bar",
      "background",
      "section_slot",
      "mobile",
    ];
    for (const item of body.items) {
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.arrangement.length).toBeGreaterThan(0);
      expect(item.thumbnail_html).toContain(`data-template-thumb="${item.id}"`);
      expect(item.thumbnail_html).toContain("lg-tpl-band");
      expect(item.defaults.template).toBe(item.id);
      for (const group of GROUPS) {
        expect(item.defaults[group], `${item.id} defaults.${group}`).toBeDefined();
      }
    }
    // Arrangement-faithful thumbnails: minimal has no footer band; header-cta
    // carries the top disclosure band.
    const minimal = body.items.find((i) => i.id === "minimal")!;
    expect(minimal.thumbnail_html).not.toContain("lg-tpl-footer");
    const headerCta = body.items.find((i) => i.id === "header-cta")!;
    expect(headerCta.thumbnail_html).toContain("lg-tpl-disclosure");
  });
});

describeDb("GET /sites/:site_id/branding (10 §10.5, C4)", () => {
  it("serves the resolveSiteBranding projection + has_logo for ANY CMS site — activation NOT required", async () => {
    const h = newHarness();
    // C4 proof: no activation rows exist at all.
    const activations = h.sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_site_quotes").get() as { n: number };
    expect(activations.n).toBe(0);

    const one = await admin.request(`${API}/sites/site-1/branding`, {}, h.env);
    expect(one.status).toBe(200);
    const site1 = (await one.json()) as {
      site_id: string;
      site_name: string;
      logo_url: string | null;
      tagline: string | null;
      legal_links: Array<{ label: string; href: string }>;
      has_logo: boolean;
    };
    expect(site1.site_id).toBe("site-1");
    expect(site1.site_name).toBe("Site One Brand");
    expect(site1.logo_url).toBe(SITE_LOGO_URL);
    expect(site1.tagline).toBe("Compare fast");
    expect(site1.has_logo).toBe(true);
    expect(site1.legal_links.map((l) => l.href)).toEqual(["/contact", "/privacy-policy", "/terms"]);

    // The no-logo leg (§10.4 ladder floor): has_logo false, site_name = domain.
    const two = await admin.request(`${API}/sites/site-2/branding`, {}, h.env);
    expect(two.status).toBe(200);
    const site2 = (await two.json()) as { site_name: string; logo_url: string | null; has_logo: boolean; legal_links: unknown[] };
    expect(site2.logo_url).toBeNull();
    expect(site2.has_logo).toBe(false);
    expect(site2.site_name).toBe("two.example.com");
    expect(site2.legal_links).toEqual([]);
  });

  it("unknown site → 404", async () => {
    const h = newHarness();
    const res = await admin.request(`${API}/sites/site-nope/branding`, {}, h.env);
    expect(res.status).toBe(404);
  });
});

describeDb("PUT /variants/:id — additive frame_overrides_json (04 §4.5/§4.7)", () => {
  const OVERRIDES = {
    progress: { style: "numbered", position: "above_unit" },
    theme: { palette: { accent: "#116611" } },
  };

  it("persists a valid sparse overrides patch, parses it back, and bumps content_version", async () => {
    const h = newHarness();
    const seed = await seedQuote(h);
    const before = variantVersion(h, seed.controlPublicId);
    const put = await admin.request(
      `${API}/variants/${seed.controlPublicId}`,
      jsonInit("PUT", { frame_overrides_json: OVERRIDES }),
      h.env,
    );
    expect(put.status, await put.clone().text()).toBe(200);
    const body = (await put.json()) as { frame_overrides_json: unknown };
    expect(body.frame_overrides_json).toEqual(OVERRIDES); // variantRowToApi parses the column
    const row = h.sdb
      .prepare("SELECT frame_overrides_json AS v FROM leadgen_funnel_variants WHERE public_id = ?")
      .get(seed.controlPublicId) as { v: string | null };
    expect(JSON.parse(row.v!)).toEqual(OVERRIDES);
    expect(variantVersion(h, seed.controlPublicId)).toBe(before + 1); // §4.7 save bumps

    // Explicit null clears back to "no overrides".
    const clear = await admin.request(
      `${API}/variants/${seed.controlPublicId}`,
      jsonInit("PUT", { frame_overrides_json: null }),
      h.env,
    );
    expect(clear.status).toBe(200);
    const cleared = h.sdb
      .prepare("SELECT frame_overrides_json AS v FROM leadgen_funnel_variants WHERE public_id = ?")
      .get(seed.controlPublicId) as { v: string | null };
    expect(cleared.v).toBeNull();
  });

  it("schema-invalid overrides → 400 + §3.6 problems (frame part AND theme part); nothing persisted", async () => {
    const h = newHarness();
    const seed = await seedQuote(h);
    const bad = await admin.request(
      `${API}/variants/${seed.controlPublicId}`,
      jsonInit("PUT", {
        frame_overrides_json: { header: { logo_size: "xxl" }, theme: { palette: { nope: "#123456" } } },
      }),
      h.env,
    );
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: string; fields: Record<string, string>; problems: Problem[] };
    expect(body.error).toBe("Validation failed");
    expect(body.fields["frame_overrides_json"]).toBeTruthy();
    const paths = body.problems.filter((p) => p.severity === "error").map((p) => p.path);
    expect(paths).toContain("frame.header.logo_size");
    expect(paths).toContain("theme.palette.nope");
    const row = h.sdb
      .prepare("SELECT frame_overrides_json AS v FROM leadgen_funnel_variants WHERE public_id = ?")
      .get(seed.controlPublicId) as { v: string | null };
    expect(row.v).toBeNull();
  });

  it("frame_overrides_json.template / .version are REJECTED with path-precise problems (§4.5 — overrides may not switch templates); nothing persisted", async () => {
    const h = newHarness();
    const seed = await seedQuote(h);
    const storedOverrides = (): string | null =>
      (h.sdb
        .prepare("SELECT frame_overrides_json AS v FROM leadgen_funnel_variants WHERE public_id = ?")
        .get(seed.controlPublicId) as { v: string | null }).v;

    // template inside overrides — even a VALID template id is rejected
    const badTemplate = await admin.request(
      `${API}/variants/${seed.controlPublicId}`,
      jsonInit("PUT", { frame_overrides_json: { template: "minimal", progress: { style: "dots" } } }),
      h.env,
    );
    expect(badTemplate.status).toBe(400);
    const templateBody = (await badTemplate.json()) as { error: string; fields: Record<string, string>; problems: Problem[] };
    expect(templateBody.error).toBe("Validation failed");
    expect(templateBody.fields["frame_overrides_json"]).toBeTruthy();
    const templateProblem = templateBody.problems.find((p) => p.path === "frame_overrides.template");
    expect(templateProblem, JSON.stringify(templateBody.problems)).toBeDefined();
    expect(templateProblem!.severity).toBe("error");
    expect(storedOverrides()).toBeNull();

    // version inside overrides — same funnel-level rejection
    const badVersion = await admin.request(
      `${API}/variants/${seed.controlPublicId}`,
      jsonInit("PUT", { frame_overrides_json: { version: 1, progress: { style: "dots" } } }),
      h.env,
    );
    expect(badVersion.status).toBe(400);
    const versionBody = (await badVersion.json()) as { problems: Problem[] };
    expect(versionBody.problems.some((p) => p.path === "frame_overrides.version" && p.severity === "error")).toBe(true);
    expect(storedOverrides()).toBeNull();

    // the SAME patch without the funnel-level keys persists fine
    const good = await admin.request(
      `${API}/variants/${seed.controlPublicId}`,
      jsonInit("PUT", { frame_overrides_json: { progress: { style: "dots" } } }),
      h.env,
    );
    expect(good.status, await good.clone().text()).toBe(200);
    expect(JSON.parse(storedOverrides()!)).toEqual({ progress: { style: "dots" } });
  });

  it("warning-severity overrides persist WITH the save and ride the response", async () => {
    const h = newHarness();
    const seed = await seedQuote(h);
    const put = await admin.request(
      `${API}/variants/${seed.controlPublicId}`,
      jsonInit("PUT", {
        frame_overrides_json: { header: { logo_source: "manual", logo_media_id: "logos/x.png" } },
      }),
      h.env,
    );
    expect(put.status, await put.clone().text()).toBe(200);
    const body = (await put.json()) as { problems?: Problem[] };
    expect(body.problems?.some((p) => p.severity === "warning" && p.path === "frame.header.logo_source")).toBe(true);
    const row = h.sdb
      .prepare("SELECT frame_overrides_json AS v FROM leadgen_funnel_variants WHERE public_id = ?")
      .get(seed.controlPublicId) as { v: string | null };
    expect(row.v).toContain('"manual"');
  });

  it("POST /variants/:id/fork clones frame_overrides_json (04 §4.5 — a fork clones the arm)", async () => {
    const h = newHarness();
    const seed = await seedQuote(h);
    const put = await admin.request(
      `${API}/variants/${seed.controlPublicId}`,
      jsonInit("PUT", { frame_overrides_json: OVERRIDES }),
      h.env,
    );
    expect(put.status).toBe(200);
    // Rework M1 (§4.3-10): forkVariantHandler now unconditionally refuses a
    // 2nd active variant — archiving the source first is the minimal way to
    // still exercise the real fork endpoint (this test's point is that the
    // clone carries frame_overrides_json, not fork's own guard).
    h.sdb.prepare("UPDATE leadgen_funnel_variants SET status = 'archived' WHERE public_id = ?").run(seed.controlPublicId);
    const fork = await admin.request(`${API}/variants/${seed.controlPublicId}/fork`, { method: "POST" }, h.env);
    expect(fork.status, await fork.clone().text()).toBe(201);
    const forked = (await fork.json()) as { public_id: string; frame_overrides_json: unknown };
    expect(forked.frame_overrides_json).toEqual(OVERRIDES);
    const row = h.sdb
      .prepare("SELECT frame_overrides_json AS v FROM leadgen_funnel_variants WHERE public_id = ?")
      .get(forked.public_id) as { v: string | null };
    expect(JSON.parse(row.v!)).toEqual(OVERRIDES);
  });

  it("preflight gains the DEV-57/B disclosure-orphan warning when the disclosure points at a footer that never shows", async () => {
    const h = newHarness();
    const seed = await seedQuote(h);
    // Valid config whose EFFECTIVE frame orphans the disclosure: minimal
    // disables the footer by template default; the disclosure targets it.
    const put = await admin.request(
      `${API}/funnels/${seed.funnelPublicId}/frame`,
      jsonInit("PUT", {
        frame_config_json: {
          version: 1,
          template: "minimal",
          disclosure: { enabled: true, location: "footer", text: "Ad disclosure copy." },
        },
      }),
      h.env,
    );
    expect(put.status, await put.clone().text()).toBe(200);

    const activation = await admin.request(`${API}/quotes/${seed.quotePublicId}/activation`, {}, h.env);
    expect(activation.status).toBe(200);
    const body = (await activation.json()) as { activation_preflight: { problems: Problem[] } };
    const orphan = body.activation_preflight.problems.find((p) => p.path === "frame.disclosure.location");
    expect(orphan, JSON.stringify(body.activation_preflight.problems, null, 2)).toBeDefined();
    expect(orphan!.severity).toBe("warning");
    expect(orphan!.message).toContain("The advertising disclosure points at the footer, but the footer never shows");
    expect((orphan as { fix_url?: string }).fix_url).toContain("/admin/leadgen/quotes/");

    // show_on:"never" orphans it the same way; an enabled footer clears it.
    const never = await admin.request(
      `${API}/funnels/${seed.funnelPublicId}/frame`,
      jsonInit("PUT", {
        frame_config_json: {
          version: 1,
          template: "centered",
          disclosure: { enabled: true, location: "footer", text: "Ad disclosure copy." },
          footer: { show_on: "never" },
        },
      }),
      h.env,
    );
    expect(never.status).toBe(200);
    const neverBody = (await (await admin.request(`${API}/quotes/${seed.quotePublicId}/activation`, {}, h.env)).json()) as {
      activation_preflight: { problems: Problem[] };
    };
    expect(neverBody.activation_preflight.problems.some((p) => p.path === "frame.disclosure.location")).toBe(true);

    const healthy = await admin.request(
      `${API}/funnels/${seed.funnelPublicId}/frame`,
      jsonInit("PUT", {
        frame_config_json: {
          version: 1,
          template: "centered",
          disclosure: { enabled: true, location: "footer", text: "Ad disclosure copy." },
        },
      }),
      h.env,
    );
    expect(healthy.status).toBe(200);
    const healthyBody = (await (await admin.request(`${API}/quotes/${seed.quotePublicId}/activation`, {}, h.env)).json()) as {
      activation_preflight: { problems: Problem[] };
    };
    expect(healthyBody.activation_preflight.problems.some((p) => p.path === "frame.disclosure.location")).toBe(false);
  });

  it("GET /funnels/:id serves the parsed 0041 columns (funnelRowToApi projection)", async () => {
    const h = newHarness();
    const seed = await seedQuote(h);
    await admin.request(
      `${API}/funnels/${seed.funnelPublicId}/frame`,
      jsonInit("PUT", { frame_config_json: { version: 1, template: "minimal" } }),
      h.env,
    );
    await admin.request(
      `${API}/funnels/${seed.funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { version: 1, scales: { radius: "round" } } }),
      h.env,
    );
    const res = await admin.request(`${API}/funnels/${seed.funnelPublicId}`, {}, h.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      frame_config_json: { template: string } | null;
      theme_json: { scales: { radius: string } } | null;
      variants: Array<{ frame_overrides_json: unknown }>;
    };
    expect(body.frame_config_json?.template).toBe("minimal");
    expect(body.theme_json?.scales.radius).toBe("round");
    expect(body.variants[0]!.frame_overrides_json).toBeNull(); // parsed, explicit null
  });
});
