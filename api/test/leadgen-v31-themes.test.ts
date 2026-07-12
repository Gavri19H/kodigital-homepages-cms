// LeadGen v3.1 §10 (Concern 2) — Themes manager FOUNDATIONS (Phase A, slice
// A3: storage + resolution + preview param + assignment API). NO studio UI
// ships this phase — these tests cover the pure theme.ts resolution math +
// the themes-handlers.ts KV CRUD routes. Preview-handler theme_id parity and
// funnel/variant assignment-validation coverage live in the sibling
// leadgen-v31-themes-integration.test.ts (needs a seeded quote/funnel).
//
//   §10.1 model: theme_json / frame_overrides_json.theme_id may hold a
//   {theme_id} REFERENCE into a KV `lg-funnel-themes` record — mutually
//   exclusive with the legacy inline ThemeJson shape (§9.2/§9.3, unchanged).
//   §10.4 record shape: {id, name, roles, typography, controls, spacing?}.
//   §11.2 storage: KV `lg-funnel-themes`, admin-scoped, no migration — the
//   SAME pattern as `lg-component-presets` (v2.5 §6.6).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import {
  isThemeIdRef,
  resolveTokens,
  validateTheme,
  winningThemeId,
  type ThemeRecord,
} from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

const base = defaultFunnelDesign;

const THEME_RECORD_FIXTURE: ThemeRecord = {
  id: "thm_navy",
  name: "Navy",
  roles: {
    brand_primary: "#0B5FFF",
    accent: "#AA3300",
    page_bg: "#F4F6F9",
    card: "#F9FAFC",
    text: "#101828",
    success: "#127A3B",
    error: "#B42318",
  },
  typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
  controls: { field_height: "medium", button_size: "m", corners: "rounded" },
  spacing: "cozy",
};

// ===========================================================================
// 1. isThemeIdRef — the {theme_id} discriminant (§10.1)
// ===========================================================================

describe("themes v3.1 — isThemeIdRef discriminant (§10.1)", () => {
  it("accepts {theme_id: <non-empty string>} alone", () => {
    expect(isThemeIdRef({ theme_id: "thm_navy" })).toBe(true);
  });

  it("rejects theme_id mixed with other keys", () => {
    expect(isThemeIdRef({ theme_id: "thm_navy", palette: {} })).toBe(false);
  });

  it("rejects empty / whitespace-only theme_id", () => {
    expect(isThemeIdRef({ theme_id: "" })).toBe(false);
    expect(isThemeIdRef({ theme_id: "   " })).toBe(false);
  });

  it("rejects non-string theme_id, null, non-objects, and the legacy shape", () => {
    expect(isThemeIdRef({ theme_id: 123 })).toBe(false);
    expect(isThemeIdRef(null)).toBe(false);
    expect(isThemeIdRef("thm_navy")).toBe(false);
    expect(isThemeIdRef({})).toBe(false);
    expect(isThemeIdRef({ palette: { brand_primary: "#111111" } })).toBe(false);
  });
});

// ===========================================================================
// 2. winningThemeId — variant-over-funnel precedence (§10.1)
// ===========================================================================

describe("themes v3.1 — winningThemeId precedence (§10.1 'variant wins over funnel')", () => {
  it("the VARIANT's theme_id wins when both funnel and variant carry one", () => {
    expect(winningThemeId({ theme_id: "thm_funnel" }, { theme_id: "thm_variant" })).toBe("thm_variant");
  });

  it("falls back to the funnel's theme_id when the variant carries none", () => {
    expect(winningThemeId({ theme_id: "thm_funnel" }, {})).toBe("thm_funnel");
    expect(winningThemeId({ theme_id: "thm_funnel" }, null)).toBe("thm_funnel");
  });

  it("a whitespace-only variant theme_id does not win — falls through to the funnel", () => {
    expect(winningThemeId({ theme_id: "thm_funnel" }, { theme_id: "   " })).toBe("thm_funnel");
  });

  it("returns null when neither side carries a theme_id (legacy inline / no theme at all)", () => {
    expect(winningThemeId(null, null)).toBeNull();
    expect(winningThemeId({ palette: { brand_primary: "#111111" } }, null)).toBeNull();
    expect(winningThemeId(null, { header: { enabled: true } })).toBeNull();
  });
});

// ===========================================================================
// 3. resolveTokens — the theme_id path, alongside legacy-inline and NULL
//    (§9.2 unchanged priority layers 1→3 + the NEW record layer, §10.4/§12)
// ===========================================================================

describe("themes v3.1 — resolveTokens theme_id path (§10.4 record → existing token layer)", () => {
  it("bridges the record's 7 roles onto the existing 14-role vocabulary", () => {
    const eff = resolveTokens(base, { theme_id: "thm_navy" }, null, THEME_RECORD_FIXTURE);
    expect(eff.roles.brand_primary).toBe("#0B5FFF");
    expect(eff.roles.accent).toBe("#AA3300");
    expect(eff.roles.page_background).toBe("#F4F6F9"); // page_bg -> page_background
    expect(eff.roles.card_background).toBe("#F9FAFC"); // card -> card_background
    expect(eff.roles.text_primary).toBe("#101828"); // text -> text_primary
    expect(eff.roles.success).toBe("#127A3B");
    expect(eff.roles.error).toBe("#B42318");
  });

  it("roles OUTSIDE the record's 7 keys keep the base design's value (identity)", () => {
    const eff = resolveTokens(base, { theme_id: "thm_navy" }, null, THEME_RECORD_FIXTURE);
    expect(eff.roles.brand_secondary).toBe(base.color.primaryLight);
    expect(eff.roles.border).toBe(base.color.border);
    expect(eff.roles.text_muted).toBe(base.page.textSecondaryColor);
    expect(eff.roles.button_primary_bg).toBe(base.primaryButton.background);
    expect(eff.roles.button_secondary_bg).toBe(base.color.primaryGhost);
  });

  it("also bakes the resolved role into `design` (the SAME token layer inline theme_json.palette feeds)", () => {
    const eff = resolveTokens(base, { theme_id: "thm_navy" }, null, THEME_RECORD_FIXTURE);
    expect(eff.design.color.primary).toBe("#0B5FFF");
    expect(eff.design.color.card).toBe("#F9FAFC");
  });

  it("feeds typography (headline_font/body_font) into the design's font slots and the returned typography via the SAFE whitelisted CSS stack (P0 stored-XSS fix — never the raw record string)", () => {
    const eff = resolveTokens(base, { theme_id: "thm_navy" }, null, THEME_RECORD_FIXTURE);
    expect(eff.typography.display).toBe("'Newsreader',Georgia,serif");
    expect(eff.typography.body).toBe("'Inter',system-ui,Arial,sans-serif");
    expect(eff.design.page.fontDisplay).toBe("'Newsreader',Georgia,serif");
    expect(eff.design.page.fontFamily).toBe("'Inter',system-ui,Arial,sans-serif");
  });

  it("exposes the resolved controls + typography ADDITIVELY (theme_controls / theme_typography)", () => {
    const eff = resolveTokens(base, { theme_id: "thm_navy" }, null, THEME_RECORD_FIXTURE);
    expect(eff.theme_controls).toEqual(THEME_RECORD_FIXTURE.controls);
    expect(eff.theme_typography).toEqual(THEME_RECORD_FIXTURE.typography);
  });

  it("an UNKNOWN/deleted theme_id (no record supplied) degrades to the base design — never throws", () => {
    const eff = resolveTokens(base, { theme_id: "thm_missing" }, null, null);
    expect(eff.design).toEqual(base);
    expect(eff.theme_controls).toBeUndefined();
    expect(eff.theme_typography).toBeUndefined();
  });

  it("a variant-level record (passed as the 4th arg) overrides what a funnel-level record would have — precedence is the CALLER's job (winningThemeId), resolveTokens just applies whichever ONE record it is given", () => {
    const funnelOnly = resolveTokens(base, { theme_id: "thm_navy" }, null, THEME_RECORD_FIXTURE);
    const otherRecord: ThemeRecord = {
      ...THEME_RECORD_FIXTURE,
      id: "thm_bold",
      name: "Bold",
      roles: { ...THEME_RECORD_FIXTURE.roles, brand_primary: "#FFCC00" },
    };
    const variantWins = resolveTokens(base, { theme_id: "thm_navy" }, null, otherRecord);
    expect(funnelOnly.roles.brand_primary).toBe("#0B5FFF");
    expect(variantWins.roles.brand_primary).toBe("#FFCC00");
  });

  it("MINOR-3 fix: a WINNING variant theme record fully supersedes a funnel's LEGACY INLINE theme_json.palette — no partial per-role masking", () => {
    // Repro: the funnel's OWN theme_json is passed through UNCHANGED here
    // (exactly what resolveFrameComposition does — only a {theme_id} SHAPE
    // empties `theme`, never an inline shape), while `themeRecord` carries
    // whichever id ACTUALLY won (winningThemeId already picked the variant's
    // — that precedence pick is proven separately in the winningThemeId
    // describe block above; this proves resolveTokens applies the winner
    // CLEANLY once handed to it, never blended with the superseded inline
    // funnel theme).
    const funnelInlineTheme = {
      version: 1 as const,
      palette: { brand_primary: "#111111", accent: "#222222" },
    };
    const variantRecord: ThemeRecord = {
      ...THEME_RECORD_FIXTURE,
      id: "thm_variant_b",
      name: "Variant B",
      roles: { ...THEME_RECORD_FIXTURE.roles, brand_primary: "#0B5FFF", accent: "#AA3300" },
    };
    const eff = resolveTokens(base, funnelInlineTheme, null, variantRecord);
    // The record's roles win OUTRIGHT — the funnel's inline #111111/#222222
    // must not survive for ANY role the record also specifies.
    expect(eff.roles.brand_primary).toBe("#0B5FFF");
    expect(eff.roles.accent).toBe("#AA3300");
    expect(eff.design.color.primary).toBe("#0B5FFF");
  });
});

describe("themes v3.1 — resolveTokens legacy inline path stays byte-identical (§9.2, unaffected by the new params)", () => {
  it("an inline palette theme_json still resolves exactly as before", () => {
    const eff = resolveTokens(base, { palette: { brand_primary: "#123456" } }, null);
    expect(eff.roles.brand_primary).toBe("#123456");
    expect(eff.design.color.primary).toBe("#123456");
  });

  it("no theme_controls / theme_typography on the legacy path (strictly additive)", () => {
    const eff = resolveTokens(base, { palette: { brand_primary: "#123456" } }, null);
    expect(eff.theme_controls).toBeUndefined();
    expect(eff.theme_typography).toBeUndefined();
  });
});

describe("themes v3.1 — resolveTokens NULL path (§9.2 identity, still additive-safe)", () => {
  it("ABSENT theme is still the base-design identity, with no theme_controls", () => {
    for (const eff of [resolveTokens(base), resolveTokens(base, null, null), resolveTokens(base, {})]) {
      expect(eff.design).toEqual(base);
      expect(eff.theme_controls).toBeUndefined();
      expect(eff.theme_typography).toBeUndefined();
    }
  });
});

// ===========================================================================
// 4. validateTheme — the {theme_id} branch (§10.1, structural only — no KV)
// ===========================================================================

describe("themes v3.1 — validateTheme accepts {theme_id} structurally (§10.1)", () => {
  it("a bare {theme_id: <string>} validates with zero problems", () => {
    const result = validateTheme({ theme_id: "thm_navy" });
    expect(result.problems).toEqual([]);
    expect(result.theme).not.toBeNull();
    expect(isThemeIdRef(result.theme)).toBe(true);
  });

  it("theme_id mixed with legacy keys is REJECTED (mutually exclusive shapes)", () => {
    const result = validateTheme({ theme_id: "thm_navy", palette: { brand_primary: "#111111" } });
    expect(result.theme).toBeNull();
    expect(result.problems.some((p) => p.path === "theme.theme_id")).toBe(true);
  });

  it("an empty/whitespace theme_id is REJECTED", () => {
    expect(validateTheme({ theme_id: "" }).theme).toBeNull();
    expect(validateTheme({ theme_id: "   " }).theme).toBeNull();
  });

  it("a non-string theme_id is REJECTED", () => {
    expect(validateTheme({ theme_id: 123 }).theme).toBeNull();
  });

  it("the legacy inline shape still validates exactly as before (regression pin — a custom hex is a WARNING only, theme stays non-null)", () => {
    const result = validateTheme({ palette: { brand_primary: "#123456" } });
    expect(result.theme).not.toBeNull();
    expect(result.problems.every((p) => p.severity === "warning")).toBe(true);
  });
});

// ===========================================================================
// 5. Themes manager KV CRUD routes (§10.1/§11.2) — list/create/get/update
// ===========================================================================

// --- node:sqlite harness (repo pattern — the leadgen-frame-routes.test.ts
// duplication convention: each test file carries its own small harness) ------

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
] as const;

const API = "/api/admin/leadgen";

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      // site-1/site-2 for the fix-round-2 theme-edit invalidation section
      // below (PUT /quotes/:id/activation/:site_id needs a real sites row).
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-2','Site Two','two.example.com');",
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

function newEnv(): Env {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  return buildEnv(d1FromSqlite(sdb), makeKvStub());
}

const VALID_THEME_BODY = {
  name: "Navy",
  roles: {
    brand_primary: "#1B3A5C",
    accent: "#F5C518",
    page_bg: "#F4F6F9",
    card: "#FFFFFF",
    text: "#1A1F36",
    success: "#0E7C3A",
    error: "#B23A2C",
  },
  typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
  controls: { field_height: "medium", button_size: "m", corners: "rounded" },
};

describeDb("themes routes — GET/POST /themes, GET/PATCH /themes/:id (v3.1 §10.1/§11.2)", () => {
  it("list on an empty store returns { items: [] }", async () => {
    const env = newEnv();
    const res = await admin.request(`${API}/themes`, jsonInit("GET"), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });

  it("create mints a thm_<slug> id, persists under lg-funnel-themes, and round-trips via GET", async () => {
    const env = newEnv();
    const createRes = await admin.request(`${API}/themes`, jsonInit("POST", VALID_THEME_BODY), env);
    expect(createRes.status, `create: ${await createRes.clone().text()}`).toBe(201);
    const created = (await createRes.json()) as { item: ThemeRecord; items: ThemeRecord[] };
    expect(created.item.id).toBe("thm_navy");
    expect(created.item.name).toBe("Navy");
    expect(created.item.roles.brand_primary).toBe("#1B3A5C");
    expect(created.items).toHaveLength(1);

    const raw = await env.CACHE.get("lg-funnel-themes");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toHaveProperty("thm_navy");

    const getRes = await admin.request(`${API}/themes/thm_navy`, jsonInit("GET"), env);
    expect(getRes.status).toBe(200);
    expect(((await getRes.json()) as { item: ThemeRecord }).item).toEqual(created.item);

    const listRes = await admin.request(`${API}/themes`, jsonInit("GET"), env);
    expect(((await listRes.json()) as { items: ThemeRecord[] }).items).toHaveLength(1);
  });

  it("a second create with the SAME name mints a disambiguated id (thm_navy-2)", async () => {
    const env = newEnv();
    await admin.request(`${API}/themes`, jsonInit("POST", VALID_THEME_BODY), env);
    const second = await admin.request(`${API}/themes`, jsonInit("POST", VALID_THEME_BODY), env);
    expect(second.status).toBe(201);
    const body = (await second.json()) as { item: ThemeRecord; items: ThemeRecord[] };
    expect(body.item.id).toBe("thm_navy-2");
    expect(body.items).toHaveLength(2);
  });

  it("create rejects missing/invalid groups with field-precise errors, and persists nothing", async () => {
    const env = newEnv();
    const res = await admin.request(
      `${API}/themes`,
      jsonInit("POST", { name: "", roles: { brand_primary: "not-a-hex" }, typography: {}, controls: { field_height: "huge" } }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; fields: Record<string, string> };
    expect(body.error).toBe("Validation failed");
    expect(body.fields["name"]).toBeTruthy();
    expect(body.fields["roles.brand_primary"]).toBeTruthy();
    expect(body.fields["controls.field_height"]).toBeTruthy();
    expect(await env.CACHE.get("lg-funnel-themes")).toBeNull();
  });

  it("create rejects an unrecognised role key", async () => {
    const env = newEnv();
    const res = await admin.request(
      `${API}/themes`,
      jsonInit("POST", { ...VALID_THEME_BODY, roles: { ...VALID_THEME_BODY.roles, bogus_role: "#111111" } }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields: Record<string, string> };
    expect(body.fields["roles.bogus_role"]).toBeTruthy();
  });

  // P0 stored-XSS fix (adversarial review BLOCKER-1): fail-before/pass-after
  // regression — a headline_font/body_font carrying a <style>/<script>
  // breakout is REJECTED at create AND at PATCH (the authoritative gate),
  // never persisted, never reaching resolveTokens or a served page. See
  // leadgen-v31-themes-size-parity.test.ts for the served-CSS defense-in-
  // depth proof (a value that bypasses this gate entirely, e.g. direct KV
  // tampering, still can't reach the page).
  it("create REJECTS a headline_font/body_font carrying a </style><script> breakout (400, not persisted)", async () => {
    const env = newEnv();
    const payload = "Arial</style><script>alert(1)</script>";
    const res = await admin.request(
      `${API}/themes`,
      jsonInit("POST", {
        ...VALID_THEME_BODY,
        typography: { ...VALID_THEME_BODY.typography, headline_font: payload },
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields: Record<string, string> };
    expect(body.fields["typography.headline_font"]).toBeTruthy();
    expect(await env.CACHE.get("lg-funnel-themes")).toBeNull();
  });

  it("create REJECTS a body_font outside the curated whitelist (not just headline_font)", async () => {
    const env = newEnv();
    const res = await admin.request(
      `${API}/themes`,
      jsonInit("POST", {
        ...VALID_THEME_BODY,
        typography: { ...VALID_THEME_BODY.typography, body_font: "Comic Sans MS" },
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields: Record<string, string> };
    expect(body.fields["typography.body_font"]).toBeTruthy();
  });

  it("PATCH REJECTS the SAME </style><script> breakout on an existing theme (400, stored record untouched)", async () => {
    const env = newEnv();
    const createRes = await admin.request(`${API}/themes`, jsonInit("POST", VALID_THEME_BODY), env);
    const created = (await createRes.json()) as { item: ThemeRecord };
    const payload = "</style><script>alert(document.cookie)</script>";

    const patchRes = await admin.request(
      `${API}/themes/${created.item.id}`,
      jsonInit("PATCH", { typography: { ...VALID_THEME_BODY.typography, headline_font: payload } }),
      env,
    );
    expect(patchRes.status).toBe(400);
    const body = (await patchRes.json()) as { fields: Record<string, string> };
    expect(body.fields["typography.headline_font"]).toBeTruthy();

    const getRes = await admin.request(`${API}/themes/${created.item.id}`, jsonInit("GET"), env);
    expect(((await getRes.json()) as { item: ThemeRecord }).item).toEqual(created.item);
  });

  it("accepts every curated font name for both fields (Newsreader / Inter / Roboto Mono)", async () => {
    const env = newEnv();
    for (const font of ["Newsreader", "Inter", "Roboto Mono"] as const) {
      const res = await admin.request(
        `${API}/themes`,
        jsonInit("POST", {
          ...VALID_THEME_BODY,
          name: `Theme ${font}`,
          typography: { headline_font: font, body_font: font, base_px: 16 },
        }),
        env,
      );
      expect(res.status, `${font}: ${await res.clone().text()}`).toBe(201);
    }
  });

  it("GET /themes/:id on an unknown id → 404", async () => {
    const env = newEnv();
    const res = await admin.request(`${API}/themes/thm_missing`, jsonInit("GET"), env);
    expect(res.status).toBe(404);
  });

  it("PATCH /themes/:id updates ONLY the sent group, preserving the rest (§10.4 per-section save)", async () => {
    const env = newEnv();
    const createRes = await admin.request(`${API}/themes`, jsonInit("POST", VALID_THEME_BODY), env);
    const created = (await createRes.json()) as { item: ThemeRecord };

    const patchRes = await admin.request(
      `${API}/themes/${created.item.id}`,
      jsonInit("PATCH", { roles: { brand_primary: "#FFCC00" } }),
      env,
    );
    expect(patchRes.status, `patch: ${await patchRes.clone().text()}`).toBe(200);
    const patched = (await patchRes.json()) as { item: ThemeRecord };
    expect(patched.item.roles.brand_primary).toBe("#FFCC00");
    // Every OTHER role + the untouched groups ride through unchanged.
    expect(patched.item.roles.accent).toBe(VALID_THEME_BODY.roles.accent);
    expect(patched.item.typography).toEqual(VALID_THEME_BODY.typography);
    expect(patched.item.controls).toEqual(VALID_THEME_BODY.controls);
    expect(patched.item.name).toBe(VALID_THEME_BODY.name);
    expect(patched.item.id).toBe(created.item.id); // id never changes on update
  });

  it("PATCH /themes/:id on an unknown id → 404", async () => {
    const env = newEnv();
    const res = await admin.request(`${API}/themes/thm_missing`, jsonInit("PATCH", { name: "X" }), env);
    expect(res.status).toBe(404);
  });

  it("PATCH /themes/:id rejects an invalid patch and leaves the stored record untouched", async () => {
    const env = newEnv();
    const createRes = await admin.request(`${API}/themes`, jsonInit("POST", VALID_THEME_BODY), env);
    const created = (await createRes.json()) as { item: ThemeRecord };

    const badRes = await admin.request(
      `${API}/themes/${created.item.id}`,
      jsonInit("PATCH", { controls: { field_height: "huge" } }),
      env,
    );
    expect(badRes.status).toBe(400);

    const getRes = await admin.request(`${API}/themes/${created.item.id}`, jsonInit("GET"), env);
    expect(((await getRes.json()) as { item: ThemeRecord }).item).toEqual(created.item);
  });

  it("a corrupt KV blob degrades to an empty store rather than throwing (D1/KV JSON-parse safety rule)", async () => {
    const env = newEnv();
    await env.CACHE.put("lg-funnel-themes", "{not json");
    const res = await admin.request(`${API}/themes`, jsonInit("GET"), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });
});

// ===========================================================================
// 6. Theme-edit cache invalidation (v3.1 §10.4/§12, fix round 2) — "change
//    one here and every question in the funnel reskins": a REAL content
//    PATCH must invalidate every cached shell/config for every funnel
//    currently resolving to that theme_id (funnel-level theme_json OR
//    variant-level frame_overrides_json), reusing the EXISTING §28
//    invalidateOnVariantPublish machinery. Mirrors the spyCache/
//    collectingCtx pattern leadgen-quotes-api.test.ts uses for the variant/
//    activation invalidation triggers (waitUntil fire-and-forget).
// ===========================================================================

// Wrap an existing (working) KV stub so every delete() is ALSO recorded —
// get/put/list keep delegating to the SAME underlying store (no duplicated
// mock logic; the theme CRUD routes' own "lg-funnel-themes" reads/writes
// keep working normally through the SAME binding).
function instrumentDeletes(kv: KVNamespace): { kv: KVNamespace; deletes: string[] } {
  const deletes: string[] = [];
  const original = kv as unknown as { delete: (key: string) => Promise<void> };
  const wrapped = {
    ...kv,
    async delete(key: string): Promise<void> {
      deletes.push(key);
      await original.delete(key);
    },
  } as unknown as KVNamespace;
  return { kv: wrapped, deletes };
}

// Collecting ExecutionContext: captures every waitUntil promise so the test
// can await the background invalidation before asserting (the EXACT
// leadgen-quotes-api.test.ts §28 pattern).
function collectingCtx(): { ctx: ExecutionContext; settled: () => Promise<void> } {
  const promises: Array<Promise<unknown>> = [];
  const ctx = {
    waitUntil(p: Promise<unknown>): void {
      promises.push(Promise.resolve(p));
    },
    passThroughOnException(): void {
      /* no-op */
    },
  } as unknown as ExecutionContext;
  return { ctx, settled: async () => void (await Promise.all(promises)) };
}

interface ActivatedFunnel {
  funnelPublicId: string;
  variantPublicId: string;
}

async function createActivatedFunnel(env: Env, siteId: string, slug: string): Promise<ActivatedFunnel> {
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: `Invalidation Quote ${slug}`, activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const created = (await createRes.json()) as {
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  const funnelPublicId = created.funnels[0]!.public_id;
  const variantPublicId = created.funnels[0]!.variants[0]!.public_id;

  const actRes = await admin.request(
    `${API}/quotes/${created.public_id}/activation/${siteId}`,
    jsonInit("PUT", { enabled: true, slug }),
    env,
  );
  expect(actRes.status, `activate: ${await actRes.clone().text()}`).toBe(200);
  return { funnelPublicId, variantPublicId };
}

function shellKey(site: string, slug: string, funnel: string, variant: string): string {
  return `lg-shell:${site}:${slug}:${funnel}:${variant}:1:1`;
}
function configKey(site: string, funnel: string, variant: string): string {
  return `lg-config:${site}:${funnel}:${variant}:1:0`;
}

describeDb("theme-edit cache invalidation (v3.1 §10.4/§12, fix round 2)", () => {
  it("PATCH with a real content change invalidates the REFERENCED funnel's shell+config on every activated site; an unreferenced funnel's keys survive (funnel-narrowed)", async () => {
    const env = newEnv();
    const theme = (
      (await (await admin.request(`${API}/themes`, jsonInit("POST", VALID_THEME_BODY), env)).json()) as {
        item: ThemeRecord;
      }
    ).item;

    // Referenced funnel: assigned this theme, activated on site-1.
    const referenced = await createActivatedFunnel(env, "site-1", "ref-funnel");
    const putTheme = await admin.request(
      `${API}/funnels/${referenced.funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { theme_id: theme.id } }),
      env,
    );
    expect(putTheme.status, `assign theme: ${await putTheme.clone().text()}`).toBe(200);

    // Unreferenced funnel: no theme assignment at all, activated on site-2.
    const unreferenced = await createActivatedFunnel(env, "site-2", "other-funnel");

    const refShell = shellKey("site-1", "ref-funnel", referenced.funnelPublicId, referenced.variantPublicId);
    const refConfig = configKey("site-1", referenced.funnelPublicId, referenced.variantPublicId);
    const otherShell = shellKey("site-2", "other-funnel", unreferenced.funnelPublicId, unreferenced.variantPublicId);
    const otherConfig = configKey("site-2", unreferenced.funnelPublicId, unreferenced.variantPublicId);
    await env.CACHE.put(refShell, "x");
    await env.CACHE.put(refConfig, "x");
    await env.CACHE.put(otherShell, "x");
    await env.CACHE.put(otherConfig, "x");

    const { kv: instrumented, deletes } = instrumentDeletes(env.CACHE);
    env.CACHE = instrumented;
    const { ctx, settled } = collectingCtx();

    const patchRes = await admin.request(
      `${API}/themes/${theme.id}`,
      jsonInit("PATCH", { roles: { ...VALID_THEME_BODY.roles, brand_primary: "#FFCC00" } }),
      env,
      ctx,
    );
    expect(patchRes.status, `patch: ${await patchRes.clone().text()}`).toBe(200);
    await settled();

    expect(deletes).toContain(refShell);
    expect(deletes).toContain(refConfig);
    expect(deletes).not.toContain(otherShell);
    expect(deletes).not.toContain(otherConfig);
  });

  it("a theme referenced ONLY via a variant's frame_overrides_json.theme_id is ALSO invalidated", async () => {
    const env = newEnv();
    const theme = (
      (await (await admin.request(`${API}/themes`, jsonInit("POST", VALID_THEME_BODY), env)).json()) as {
        item: ThemeRecord;
      }
    ).item;

    const fx = await createActivatedFunnel(env, "site-1", "variant-ref-funnel");
    const putVariant = await admin.request(
      `${API}/variants/${fx.variantPublicId}`,
      jsonInit("PUT", { frame_overrides_json: { theme_id: theme.id } }),
      env,
    );
    expect(putVariant.status, `assign variant theme: ${await putVariant.clone().text()}`).toBe(200);

    const shell = shellKey("site-1", "variant-ref-funnel", fx.funnelPublicId, fx.variantPublicId);
    await env.CACHE.put(shell, "x");
    const { kv: instrumented, deletes } = instrumentDeletes(env.CACHE);
    env.CACHE = instrumented;
    const { ctx, settled } = collectingCtx();

    const patchRes = await admin.request(
      `${API}/themes/${theme.id}`,
      jsonInit("PATCH", { roles: { ...VALID_THEME_BODY.roles, brand_primary: "#00FFCC" } }),
      env,
      ctx,
    );
    expect(patchRes.status, `patch: ${await patchRes.clone().text()}`).toBe(200);
    await settled();

    expect(deletes).toContain(shell);
  });

  it("POST /themes (create) triggers NO invalidation sweep — nothing can reference a brand-new theme_id yet", async () => {
    const env = newEnv();
    const fx = await createActivatedFunnel(env, "site-1", "precreate-funnel");
    const shell = shellKey("site-1", "precreate-funnel", fx.funnelPublicId, fx.variantPublicId);
    await env.CACHE.put(shell, "x");
    const { kv: instrumented, deletes } = instrumentDeletes(env.CACHE);
    env.CACHE = instrumented;
    const { ctx, settled } = collectingCtx();

    const createRes = await admin.request(`${API}/themes`, jsonInit("POST", VALID_THEME_BODY), env, ctx);
    expect(createRes.status, `create: ${await createRes.clone().text()}`).toBe(201);
    await settled();

    expect(deletes).toEqual([]);
  });

  it("a no-op PATCH (byte-identical values) does NOT trigger an invalidation sweep", async () => {
    const env = newEnv();
    const theme = (
      (await (await admin.request(`${API}/themes`, jsonInit("POST", VALID_THEME_BODY), env)).json()) as {
        item: ThemeRecord;
      }
    ).item;
    const fx = await createActivatedFunnel(env, "site-1", "noop-funnel");
    await admin.request(
      `${API}/funnels/${fx.funnelPublicId}/theme`,
      jsonInit("PUT", { theme_json: { theme_id: theme.id } }),
      env,
    );
    const shell = shellKey("site-1", "noop-funnel", fx.funnelPublicId, fx.variantPublicId);
    await env.CACHE.put(shell, "x");
    const { kv: instrumented, deletes } = instrumentDeletes(env.CACHE);
    env.CACHE = instrumented;
    const { ctx, settled } = collectingCtx();

    // Re-PATCH with the theme's OWN current values — byte-identical, a no-op.
    const patchRes = await admin.request(
      `${API}/themes/${theme.id}`,
      jsonInit("PATCH", { roles: theme.roles, typography: theme.typography, controls: theme.controls, name: theme.name }),
      env,
      ctx,
    );
    expect(patchRes.status, `patch: ${await patchRes.clone().text()}`).toBe(200);
    await settled();

    expect(deletes).toEqual([]);
  });
});
