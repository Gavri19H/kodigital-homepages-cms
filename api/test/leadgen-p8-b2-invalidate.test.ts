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

// --- D1 fidelity: the LIKE/GLOB pattern-length limit -----------------------
// D1's SQLite caps a LIKE/GLOB PATTERN at 50 bytes
// (SQLITE_LIMIT_LIKE_PATTERN_LENGTH) and throws
// "D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR" above it.
// node:sqlite carries the 50_000-byte DEFAULT, so a bare node:sqlite harness
// CANNOT see the class of bug this file now guards. The boundary emulated here
// was MEASURED through the real worker's own DB binding (wrangler dev,
// PATCH /api/admin/leadgen/themes/:id): theme id 35 chars → 50-byte pattern →
// 200; theme id 36 chars → 51-byte pattern → 500 + that D1_ERROR in the log.
const D1_LIKE_PATTERN_MAX_BYTES = 50;

// Ordinals (0-based) of the `?` placeholders that sit in a LIKE/GLOB PATTERN
// position — only those are length-limited by SQLite; ordinary value binds are
// not.
function likePatternBindIndexes(sql: string): number[] {
  const indexes: number[] = [];
  let ordinal = 0;
  for (let i = 0; i < sql.length; i += 1) {
    if (sql[i] !== "?") continue;
    const before = sql.slice(0, i).replace(/\s+$/, "");
    if (/\b(LIKE|GLOB)$/i.test(before)) indexes.push(ordinal);
    ordinal += 1;
  }
  return indexes;
}

function enforceD1LikePatternLimit(sql: string, binds: readonly unknown[]): void {
  for (const index of likePatternBindIndexes(sql)) {
    const value = binds[index];
    if (typeof value !== "string") continue;
    const bytes = new TextEncoder().encode(value).byteLength;
    if (bytes > D1_LIKE_PATTERN_MAX_BYTES) {
      throw new Error(
        `D1_ERROR: LIKE or GLOB pattern too complex: SQLITE_ERROR (pattern was ${bytes} bytes, D1 allows ${D1_LIKE_PATTERN_MAX_BYTES})`,
      );
    }
  }
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
          enforceD1LikePatternLimit(sql, binds); // D1 rejects at execution, not at bind
          const r = sdb.prepare(sql).get(...binds);
          return (r ?? null) as T | null;
        },
        async all<T = unknown>() {
          enforceD1LikePatternLimit(sql, binds);
          const rows = sdb.prepare(sql).all(...binds);
          return { results: rows as T[], success: true, meta: {} };
        },
        async run() {
          enforceD1LikePatternLimit(sql, binds);
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

async function createTheme(env: Env, name?: string): Promise<ThemeRecord> {
  const body = name === undefined ? THEME_BODY : { ...THEME_BODY, name };
  const res = await admin.request(`${API}/themes`, jsonInit("POST", body), env);
  expect(res.status, `create theme: ${await res.clone().text()}`).toBe(201);
  const parsed = (await res.json()) as { item: ThemeRecord };
  return parsed.item;
}

// A theme name of the shape the acceptance specs actually author — a label plus
// a `${Date.now()}${rand}` uniquifier (__p6b-theme-mgr.spec.ts:516-517,
// leadgen-r2p7-f3-fork-survival-drive.spec.ts) — which mintThemeId slugifies
// into a 36-char id. Fixed digits here (not Date.now()) so the id length is
// deterministic; 16 digits is exactly what Date.now()+3 random digits yields.
const LONG_THEME_NAME = "P6b Rich Preset 1785960866888990";

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

  // W1 (P8 CLOSE round) — the regression the terminal browser battery caught:
  // PATCH /themes/:id 500'd with "D1_ERROR: LIKE or GLOB pattern too complex"
  // for every theme whose minted id reached 36 chars, because the candidate
  // scan's LIKE pattern `%"theme_id":"<id>"%` grew past D1's 50-byte
  // pattern limit. It is the SAME scan the case above exercises — that case
  // stays green because its theme name ("B2 Repro Theme") mints a SHORT id.
  it(
    "a LONG operator-named theme (the 36-char id the acceptance specs mint) still PATCHes 200 and " +
      "bumps its funnel — the candidate LIKE pattern stays inside D1's 50-byte limit",
    async () => {
      const h = newHarness();
      const referencing = await createQuoteFunnel(h.env, "W1 Long Theme Funnel");
      const other = await createQuoteFunnel(h.env, "W1 Unrelated Funnel");
      const theme = await createTheme(h.env, LONG_THEME_NAME);
      expect(theme.id.length, `minted id must be long enough to trip the old needle: ${theme.id}`).toBe(36);
      // Pre-fix needle length, for the record: 13 ('%"theme_id":"') + 36 + 2 = 51 > 50.

      const assignRes = await admin.request(
        `${API}/funnels/${referencing.funnelPublicId}/theme`,
        jsonInit("PUT", { theme_json: { theme_id: theme.id } }),
        h.env,
      );
      expect(assignRes.status, `assign long-id theme: ${await assignRes.clone().text()}`).toBe(200);

      const before = readContentVersion(h.sdb, referencing.variantPublicId);
      const otherBefore = readContentVersion(h.sdb, other.variantPublicId);

      const patchRes = await admin.request(
        `${API}/themes/${theme.id}`,
        jsonInit("PATCH", {
          typography: { headline_font: "Poppins", display_size: "xxl" },
          button_style: { fill: "soft" },
        }),
        h.env,
      );
      const patchBody = await patchRes.clone().text();
      expect(patchRes.status, `patch long-id theme: ${patchBody}`).toBe(200);
      // The route may never paper over a failed propagation with a silent 200.
      expect(patchBody, "no cache_refresh_warning: the bump itself must have succeeded").not.toContain(
        "cache_refresh_warning",
      );

      expect(
        readContentVersion(h.sdb, referencing.variantPublicId),
        "W1: the long-id theme's funnel must be bumped exactly like a short-id theme's",
      ).toBeGreaterThan(before);
      expect(
        readContentVersion(h.sdb, other.variantPublicId),
        "isolation leg (long id): an unrelated funnel must NOT be bumped",
      ).toBe(otherBefore);
    },
  );

  // What the W1 fix itself could have introduced: the bounded pattern TRUNCATES
  // the id, so two ids sharing a 36-byte prefix (thm_<slug> and thm_<slug>-2,
  // what mintThemeId produces for a duplicate name) now both come back as SQL
  // candidates. referencesThemeId's exact parse must still decide, or a theme
  // edit would bump the WRONG funnel.
  it(
    "two long theme ids sharing the truncated prefix (thm_<slug> vs thm_<slug>-2) do not cross-bump: " +
      "the exact-parse check still decides which funnel is affected",
    async () => {
      const h = newHarness();
      const funnelA = await createQuoteFunnel(h.env, "W1 Prefix Collision A");
      const funnelB = await createQuoteFunnel(h.env, "W1 Prefix Collision B");
      const themeA = await createTheme(h.env, LONG_THEME_NAME);
      const themeB = await createTheme(h.env, LONG_THEME_NAME); // same name → id + "-2"
      expect(themeB.id, "mintThemeId must produce the prefix-colliding sibling").toBe(`${themeA.id}-2`);

      for (const [funnel, theme] of [
        [funnelA, themeA],
        [funnelB, themeB],
      ] as const) {
        const res = await admin.request(
          `${API}/funnels/${funnel.funnelPublicId}/theme`,
          jsonInit("PUT", { theme_json: { theme_id: theme.id } }),
          h.env,
        );
        expect(res.status, `assign ${theme.id}: ${await res.clone().text()}`).toBe(200);
      }

      const beforeA = readContentVersion(h.sdb, funnelA.variantPublicId);
      const beforeB = readContentVersion(h.sdb, funnelB.variantPublicId);

      const patchRes = await admin.request(
        `${API}/themes/${themeA.id}`,
        jsonInit("PATCH", { roles: { brand_primary: "#445566" } }),
        h.env,
      );
      expect(patchRes.status, `patch themeA: ${await patchRes.clone().text()}`).toBe(200);

      expect(
        readContentVersion(h.sdb, funnelA.variantPublicId),
        "the patched theme's own funnel must bump",
      ).toBeGreaterThan(beforeA);
      expect(
        readContentVersion(h.sdb, funnelB.variantPublicId),
        "the prefix-sibling theme's funnel must NOT bump (substring candidate, exact-parse reject)",
      ).toBe(beforeB);
    },
  );
});
