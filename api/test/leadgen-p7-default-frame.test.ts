// P7fix — NARROW DEFAULT FRAME (register R4 item 10I), render-path only.
//
// Root cause (proven by the P7 investigation, re-verified here): a funnel
// whose `frame_config_json` is NULL takes serve.ts's LEGACY frameless fork
// (resolveFrameComposition returns null → renderLegacyShell), which renders
// the byte-pinned base design and IGNORES the resolved theme entirely — a
// ThemeRecord composes ONLY on the frame path. So a theme applied to a
// frameless funnel never showed.
//
// FIRST CUT (create-time default on EVERY new funnel) was rejected: it broke
// 18 unrelated test files (11 pre-0041-schema harnesses hit "no such column";
// 7 post-0041 harnesses either byte-drifted off the legacy pin or — for
// u15-jargon-copy-pin specifically — tripped the admin activation preflight's
// "funnel-layout elements would render twice" 409, because EVERY new funnel
// got a frame unconditionally, regardless of whether it was ever themed.
//
// THIS (narrower) fix scopes frame synthesis to resolveFrameComposition
// (serve.ts) ONLY, and ONLY when BOTH hold:
//   1. frame_config_json is NULL (no operator-set frame), AND
//   2. theme_json parses to an object with a STRING `theme_id` key — an
//      EXPLICIT theme-preset reference (written only by
//      PUT /funnels/:id/theme), never a resolved/default ThemeRecord and
//      never a bespoke inline theme with no theme_id.
// Every other frameless funnel (no theme_json at all, OR an inline theme with
// no theme_id) takes the EXACT unchanged legacy fork — no DB write, no schema
// dependency, no effect on any funnel that never had an explicit theme
// applied. When the narrow condition fires, the composition synthesizes onto
// the "minimal" template (least additional chrome) with its header disabled
// (header.enabled: false — designs/frame.ts's renderHeaderRegion returns ""
// when disabled, so this can never double-render against a section's own
// legacy HeaderBar).
//
// FAIL-BEFORE / PASS-AFTER: this file's "explicit theme_id" case is asserted
// against resolveFrameComposition directly — reverting resolveFrameComposition
// to always `return null` when frame_config_json is NULL (the pre-fix state)
// fails the "explicit theme_id composes" assertions below (composition stays
// null) while leaving the "no theme" / "inline theme, no theme_id" cases
// passing unchanged (they were never the point of failure).
//
// R4-48 FOLLOW-UP (money-path fail-safe): parseJsonRecordColumn collapses TWO
// distinct frame_config_json states into the same `rawFrame === null` — a
// TRUE SQL-NULL/absent column, and a present-but-CORRUPT/schema-invalid
// string that fails to parse. The initial fc41ae2 cut synthesized the narrow
// default on EITHER, which would have weakened leadgen-frame-serve.test.ts's
// "a corrupt or schema-invalid stored frame must never break OR ALTER a
// revenue-serving page" fail-safe for themed funnels. The fix distinguishes
// them at the resolveFrameComposition call site using the RAW column value
// already in hand (source.frame_config_json) — only a truly absent/blank
// column is eligible; a corrupt one always stays on the exact legacy path,
// themed or not. See the two new tests below ('CORRUPT frame_config_json...'
// and 'schema-invalid (non-object) frame_config_json...').
//
// Harness: the leadgen-frame-serve.test.ts node:sqlite pattern + migrations
// 0036–0042 (0041 adds the frame/theme columns).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { resolveFrameComposition } from "../src/public/leadgen/serve";
import { getFunnelDesign } from "../src/public/leadgen/designs/registry";

// --- node:sqlite harness (the leadgen-frame-serve.test.ts pattern) -----------

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
  const kv = {
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
    async list(): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor: string }> {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
  return kv;
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

function createRuntimeDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT);",
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

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function newHarness(): { sdb: SqliteDb; env: Env } {
  const sdb = createRuntimeDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), makeKvStub()) };
}

// ===========================================================================
// Part 1 — resolveFrameComposition, pure unit assertions (no HTTP/DB needed).
// ===========================================================================

describe("P7fix (narrow): resolveFrameComposition NULL-frame branch (R4 item 10I)", () => {
  const design = getFunnelDesign("default");

  it("no theme_json at all: composition stays null (exact legacy, unchanged)", () => {
    const composition = resolveFrameComposition(
      { frame_config_json: null, theme_json: null, frame_overrides_json: null },
      design,
    );
    expect(composition, "themeless + frameless funnel takes the legacy fork").toBeNull();
  });

  it("inline theme_json with NO theme_id: composition stays null (narrow condition requires an explicit reference)", () => {
    const composition = resolveFrameComposition(
      {
        frame_config_json: null,
        theme_json: JSON.stringify({ version: 1, palette: { brand_primary: "#123456" } }),
        frame_overrides_json: null,
      },
      design,
    );
    expect(composition, "a bespoke inline theme with no theme_id does not trigger the narrow default").toBeNull();
  });

  it("explicit theme_json.theme_id + NULL frame: composition synthesizes onto the least-chrome 'minimal' template with header disabled", () => {
    const composition = resolveFrameComposition(
      {
        frame_config_json: null,
        theme_json: JSON.stringify({ theme_id: "thm_someone_authored_this" }),
        frame_overrides_json: null,
      },
      design,
    );
    expect(composition, "an explicit theme_id flips the frameless funnel onto the frame path").not.toBeNull();
    expect(composition!.frame.template).toBe("minimal");
    expect(composition!.frame.header.enabled, "the synthesized frame's header is OFF (never double-renders a section HeaderBar)").toBe(false);
  });

  // R4-48 (money-path fail-safe): parseJsonRecordColumn collapses TWO distinct
  // frame_config_json states to the same `rawFrame === null` — a TRUE
  // SQL-NULL/absent column (eligible for the narrow default above) and a
  // present-but-CORRUPT string that fails to parse (NOT eligible — it must
  // stay on the exact legacy fail-safe path unconditionally, themed or not).
  // Uses the SAME corrupt literal ('{not json') as leadgen-frame-serve.
  // test.ts's fail-safe fixture.
  it("CORRUPT frame_config_json ('{not json') + explicit theme_id: stays on the EXACT legacy byte path — NOT synthesized/framed (13 §13.3 fail-safe)", () => {
    const composition = resolveFrameComposition(
      {
        frame_config_json: "{not json",
        theme_json: JSON.stringify({ theme_id: "thm_someone_authored_this" }),
        frame_overrides_json: null,
      },
      design,
    );
    expect(composition, "a corrupt (present, unparseable) frame must never be synthesized, even when explicitly themed").toBeNull();
  });

  it("schema-invalid (non-object) frame_config_json ('[1,2,3]') + explicit theme_id: also stays legacy — corrupt-shape, not SQL-NULL", () => {
    const composition = resolveFrameComposition(
      {
        frame_config_json: "[1,2,3]",
        theme_json: JSON.stringify({ theme_id: "thm_someone_authored_this" }),
        frame_overrides_json: null,
      },
      design,
    );
    expect(composition, "a non-object parse result is also 'present but not a valid frame' — legacy, not synthesized").toBeNull();
  });

  it("explicit theme_id WITH an existing operator frame: the operator's own frame wins untouched (narrow default only fires on NULL frame)", () => {
    const composition = resolveFrameComposition(
      {
        frame_config_json: JSON.stringify({ version: 1, template: "centered" }),
        theme_json: JSON.stringify({ theme_id: "thm_someone_authored_this" }),
        frame_overrides_json: null,
      },
      design,
    );
    expect(composition).not.toBeNull();
    expect(composition!.frame.template, "an operator-configured frame is never overridden by the narrow default").toBe("centered");
  });
});

// ===========================================================================
// Part 2 — through the real admin API: applying a theme via PUT /funnels/:id/
// theme does NOT write frame_config_json (no DB mutation; render-path-only
// fix), yet the persisted row's OWN columns now compose non-null.
// ===========================================================================

// A validated theme-preset payload (createThemeHandler's expected shape) —
// mirrors the leadgen-round4-funnel-acceptance Item 10I fixture's themePayload.
function themePayload(name: string): Record<string, unknown> {
  return {
    name,
    roles: {
      brand_primary: "#123456",
      accent: "#654321",
      page_bg: "#FFFFFF",
      card: "#FFFFFF",
      text: "#101010",
      success: "#0E7C3A",
      error: "#B23A2C",
    },
    typography: { headline_font: "Poppins", body_font: "Inter", base_px: 16 },
    controls: { field_height: "medium", button_size: "m", corners: "rounded" },
  };
}

describeDb("P7fix (narrow): PUT /funnels/:id/theme on a frameless funnel — no DB frame write, render composes", () => {
  it("theme applied to a brand-new (frameless) funnel: frame_config_json stays NULL in storage; resolveFrameComposition on the persisted row is non-null", async () => {
    const { sdb, env } = newHarness();
    const themeRecordRes = await admin.request(`${API}/themes`, jsonInit("POST", themePayload("P7 Narrow Fix Preset")), env);
    expect(themeRecordRes.status, `create theme preset: ${await themeRecordRes.clone().text()}`).toBe(201);
    const themeRecord = (await themeRecordRes.json()) as { item: { id: string } };
    const themeId = themeRecord.item.id;

    const createRes = await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: "P7 Narrow Fix", activity: "quote_funnel", verticals: ["life"] }),
      env,
    );
    expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
    const quote = (await createRes.json()) as { funnels: Array<{ public_id: string }> };
    const funnelPublicId = quote.funnels[0]!.public_id;

    // Sanity: freshly created funnel is frameless, exactly as it always was —
    // this fix writes NOTHING at create time.
    const beforeRow = sdb
      .prepare("SELECT frame_config_json, theme_json FROM leadgen_funnels WHERE public_id = ?")
      .get(funnelPublicId) as { frame_config_json: string | null; theme_json: string | null };
    expect(beforeRow.frame_config_json, "a freshly-created funnel has NO frame (unchanged create path)").toBeNull();
    expect(beforeRow.theme_json).toBeNull();

    const themeRes = await admin.request(
      `${API}/funnels/${funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { theme_id: themeId } }),
      env,
    );
    expect(themeRes.status, `apply theme: ${await themeRes.clone().text()}`).toBe(200);

    const afterRow = sdb
      .prepare("SELECT frame_config_json, theme_json FROM leadgen_funnels WHERE public_id = ?")
      .get(funnelPublicId) as { frame_config_json: string | null; theme_json: string | null };
    expect(afterRow.frame_config_json, "applying a theme never writes frame_config_json (render-path-only fix)").toBeNull();
    expect(JSON.parse(afterRow.theme_json as string)).toEqual({ theme_id: themeId });

    // The exact columns now on the row: resolveFrameComposition composes.
    const design = getFunnelDesign("default");
    const composition = resolveFrameComposition(
      { frame_config_json: afterRow.frame_config_json, theme_json: afterRow.theme_json, frame_overrides_json: null },
      design,
    );
    expect(composition, "the persisted (still frame-NULL) row now composes via the narrow default").not.toBeNull();
    expect(composition!.frame.template).toBe("minimal");
    expect(composition!.frame.header.enabled).toBe(false);
  });

  it("a funnel that never receives a theme stays frameless end-to-end (matches the legacy-pin fixture's exact shape)", async () => {
    const { sdb, env } = newHarness();
    const createRes = await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: "P7 Untouched Legacy", activity: "quote_funnel", verticals: ["life"] }),
      env,
    );
    expect(createRes.status).toBe(201);
    const quote = (await createRes.json()) as { funnels: Array<{ public_id: string }> };
    const row = sdb
      .prepare("SELECT frame_config_json, theme_json FROM leadgen_funnels WHERE public_id = ?")
      .get(quote.funnels[0]!.public_id) as { frame_config_json: string | null; theme_json: string | null };
    expect(row.frame_config_json).toBeNull();
    expect(row.theme_json).toBeNull();
    const design = getFunnelDesign("default");
    const composition = resolveFrameComposition(
      { frame_config_json: row.frame_config_json, theme_json: row.theme_json, frame_overrides_json: null },
      design,
    );
    expect(composition, "no theme ever applied -> composition stays null, the legacy-pin's exact condition").toBeNull();
  });
});
