// F18 Vehicle database — the funnel page (serve.ts) over the REAL index.ts app
// (the node:sqlite harness of leadgen-runtime-api.test.ts): a funnel with a
// "Vehicle database" question reads the live vehicle list ONCE on the cold
// path, writes the Make choices (and the featured makes' logos) into the page
// and the live snapshot into #lg-config; a funnel without one reads nothing
// from the vehicle storage; an unreadable list still serves a working page.

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { resetVehicleStoreMemo } from "../src/leadgen/vehicles/store";
import { VEHICLE_API_BASE, VEHICLE_LIVE_KEY, vehicleMakesKey } from "../src/leadgen/vehicles/format";

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

const runSql = (sdb: SqliteDb, sql: string): void => (sdb["exec"] as (s: string) => void)(sql);

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
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const s of statements) results.push(await s.run());
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return results;
    },
  } as unknown as D1Database;
}

function makeKvStub(): KVNamespace {
  const store = new Map<string, { value: string; metadata: unknown }>();
  return {
    async get(key: string) {
      return store.has(key) ? store.get(key)!.value : null;
    },
    async getWithMetadata(key: string) {
      const e = store.get(key);
      return e ? { value: e.value, metadata: e.metadata ?? null } : { value: null, metadata: null };
    },
    async put(key: string, value: string, opts?: { metadata?: unknown }) {
      store.set(key, { value, metadata: opts?.metadata ?? null });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
}

// The vehicle storage (R2 binding MEDIA): an in-memory bucket that records
// every read, so a test can prove which funnels read it.
function makeMedia(objects: Record<string, unknown>): { bucket: R2Bucket; reads: string[] } {
  const reads: string[] = [];
  const bucket = {
    async get(key: string) {
      reads.push(key);
      if (!(key in objects)) return null;
      const text = JSON.stringify(objects[key]);
      return { httpEtag: `"${key.length}"`, text: async () => text };
    },
  } as unknown as R2Bucket;
  return { bucket, reads };
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

const SNAPSHOT = "2026-10-05";
const LOGO_KEY = "2026/11/23/vehicle-logo-toyota.png";
const VEHICLE_OBJECTS: Record<string, unknown> = {
  [VEHICLE_LIVE_KEY]: { snapshot: SNAPSHOT },
  [vehicleMakesKey(SNAPSHOT)]: {
    snapshot: SNAPSHOT,
    makes: [
      { make_id: 440, name: "Acura", slug: "acura" },
      { make_id: 474, name: "Honda", slug: "honda" },
      { make_id: 499, name: "Kia", slug: "kia" },
      { make_id: 448, name: "Toyota", slug: "toyota" },
    ],
  },
};

function newEnv(media: R2Bucket): { env: Env; sdb: SqliteDb } {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      // The media columns the make-logo lookup reads (store.ts findVehicleLogoUrls).
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, filename TEXT, storage_key TEXT, created_at TEXT);" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','one.example.com','insurance','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','one.example.com','active');" +
      `INSERT INTO media (site_id, filename, storage_key, created_at) VALUES (NULL, 'vehicle-logo-toyota.png', '${LOGO_KEY}', '2026-11-23T00:00:00Z');`,
  );
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  const env = {
    DB: d1FromSqlite(sdb),
    CACHE: makeKvStub(),
    MEDIA: media,
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
    LEADGEN_CONFIG_SIGNING_KEY: "vehicle-signing-key-test-only",
  } as unknown as Env;
  return { env, sdb };
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;
const API = "/api/admin/leadgen";
const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function insertSection(sdb: SqliteDb, components: unknown[]): { id: number } {
  const publicId = mintPublicId("section");
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', 'Your car', ?, 'button', 0, 'active')",
    )
    .run(publicId, `Section ${publicId.slice(-4)}`, JSON.stringify({ components }));
  return sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
}

async function activatedFunnel(env: Env, sdb: SqliteDb, slug: string, components: unknown[]): Promise<void> {
  const res = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: `Q ${slug}`, activity: "quote_funnel", verticals: ["life"] }), env);
  expect(res.status, await res.clone().text()).toBe(201);
  const quote = (await res.json()) as { id: number; public_id: string; funnels: Array<{ variants: Array<{ public_id: string }> }> };
  const section = insertSection(sdb, components);
  const put = await admin.request(`${API}/variants/${quote.funnels[0]!.variants[0]!.public_id}`, jsonInit("PUT", { sections: [{ section_id: section.id }] }), env);
  expect(put.status, await put.clone().text()).toBe(200);
  // The quote's shared first page (activation requires ≥1 section there).
  const shared = insertSection(sdb, [{ type: "TwoButtonYesNo", question_id: "q_ins", question_key: "k", internal_field: "insured", answer_type: "boolean" }]);
  const pagePublicId = mintPublicId("funnel_page");
  sdb.prepare("INSERT INTO leadgen_funnel_pages (public_id, quote_id, position, name) VALUES (?, ?, 0, NULL)").run(pagePublicId, quote.id);
  sdb
    .prepare("INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position, page_id) VALUES (?, ?, 0, (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?))")
    .run(quote.id, shared.id, pagePublicId);
  const act = await admin.request(`${API}/quotes/${quote.public_id}/activation/site-1`, jsonInit("PUT", { enabled: true, slug }), env);
  expect(act.status, await act.clone().text()).toBe(200);
}

const shell = async (
  env: Env,
  slug: string,
): Promise<{ status: number; html: string; config: Record<string, unknown>; cacheControl: string | null }> => {
  const res = await app.request(`http://one.example.com/lg/${slug}`, {}, env);
  const html = await res.text();
  const json = /<script type="application\/json" id="lg-config">(.*?)<\/script>/s.exec(html)?.[1] ?? "{}";
  return { status: res.status, html, config: JSON.parse(json) as Record<string, unknown>, cacheControl: res.headers.get("Cache-Control") };
};

const MAKE_CARDS = {
  type: "IconCardAnswerGrid",
  question_id: "q_make",
  question_key: "car_make",
  internal_field: "vehicle_make",
  answer_type: "string",
  required: true,
  // Typed data kept for switching back — never on the page.
  choices: [{ label: "Typed Make", value: "typed_make", analytics_id: "t" }],
  props: { choice_source: "vehicle", vehicle_asks: "make", vehicle_featured_makes: [448, 474] },
};
const YEAR_BUTTONS = {
  type: "ButtonAnswerGroup",
  question_id: "q_year",
  question_key: "car_year",
  internal_field: "vehicle_year",
  answer_type: "number",
  required: true,
  props: { choice_source: "vehicle", vehicle_asks: "year", vehicle_make_field: "vehicle_make" },
};

beforeEach(() => resetVehicleStoreMemo());

describeDb("F18 serve.ts — the funnel page with a 'Vehicle database' question", () => {
  it("a funnel without one reads nothing; a funnel with one reads the live list once on the cold path: Make cards (logo from Media) + 'Other make' in the page, the snapshot in #lg-config, Year waits for the browser", async () => {
    const media = makeMedia(VEHICLE_OBJECTS);
    const { env, sdb } = newEnv(media.bucket);
    await activatedFunnel(env, sdb, "plain", [{ ...YEAR_BUTTONS, props: { ...YEAR_BUTTONS.props, choice_source: "typed" }, choices: [{ label: "2024", value: 2024, analytics_id: "y" }] }]);
    await activatedFunnel(env, sdb, "car", [MAKE_CARDS, YEAR_BUTTONS]);

    // No vehicle question: the vehicle storage is never read, no vehicle key.
    const plain = await shell(env, "plain");
    expect(plain.status).toBe(200);
    expect(media.reads).toEqual([]);
    expect(plain.config["vehicle"]).toBeUndefined();
    expect(plain.html).not.toContain("data-lg-vehicle");

    const first = await shell(env, "car");
    expect(first.status).toBe(200);
    expect(media.reads).toEqual([VEHICLE_LIVE_KEY, vehicleMakesKey(SNAPSHOT)]);
    // Make: Toyota (with its logo) and Honda as cards, Acura and Kia under "Other make".
    expect(first.html).toMatch(/data-lg-vehicle="make" data-lg-vlogos/);
    expect(first.html).toContain(`data-lg-choice="448"><img class="lg-card-logo" src="/media/${LOGO_KEY}"`);
    expect(first.html).toContain('data-lg-choice="474"><span class="lg-card-title">Honda</span>');
    expect(first.html).toMatch(/<option value="440" data-lg-choice="440">Acura<\/option><option value="499" data-lg-choice="499">Kia<\/option>/);
    expect(first.html).not.toContain("Typed Make");
    // The vehicle style rules ride the page.
    expect(first.html).toContain(".lg-card-grid.lg-card-grid[data-lg-vlogos]");
    // Year: empty slots + the typed-answer box, linked to the Make field.
    expect(first.html).toMatch(/data-lg-vehicle="year" data-lg-vmake="vehicle_make" data-lg-vcards="6"/);
    expect(first.html).toContain("data-lg-vslot hidden");
    // #lg-config: the snapshot and lookup base; no typed choices for the vehicle question.
    expect(first.config["vehicle"]).toEqual({ snapshot: SNAPSHOT, base: VEHICLE_API_BASE });
    const comps = (first.config["sections"] as Array<{ components: Array<Record<string, unknown>> }>).flatMap((s) => s.components);
    const makeConfig = comps.find((c) => c["question_id"] === "q_make");
    expect(makeConfig?.["choices"]).toBeUndefined();
    expect(makeConfig?.["valid_values"]).toBeUndefined();

    // A warm request is served from the page cache: no further vehicle reads.
    await shell(env, "car");
    expect(media.reads).toHaveLength(2);
  });

  it("an unreadable list (no live snapshot) still serves the page: the vehicle questions are typed-answer boxes and the config has no vehicle key", async () => {
    const media = makeMedia({});
    const { env, sdb } = newEnv(media.bucket);
    await activatedFunnel(env, sdb, "nolist", [MAKE_CARDS, YEAR_BUTTONS]);
    const page = await shell(env, "nolist");
    expect(page.status).toBe(200);
    expect(media.reads).toEqual([VEHICLE_LIVE_KEY]);
    expect(page.config["vehicle"]).toBeUndefined();
    expect(page.html).toMatch(/<div class="lg-vehicle"[^>]*data-lg-vehicle="make"><input class="lg-input lg-vehicle-text"[^>]*placeholder="Type your car&#39;s make"/);
    expect(page.html).not.toContain("Typed Make");
    // Review fix: a degraded page is never cached — not in the page cache,
    // not by the browser or CDN — so the next request tries the list again.
    expect(page.cacheControl).toBe("no-store");
    const keys = await (env.CACHE as KVNamespace).list();
    expect(keys.keys.filter((k) => k.name.startsWith("lg-shell:"))).toEqual([]);
  });

  it("a storage failure while reading the list is not remembered: the page is served uncached and the next request reads again", async () => {
    let fail = true;
    const reads: string[] = [];
    const ok = makeMedia(VEHICLE_OBJECTS);
    const bucket = {
      async get(key: string) {
        reads.push(key);
        if (fail) throw new Error("R2 unavailable");
        return (ok.bucket as unknown as { get(k: string): Promise<unknown> }).get(key);
      },
    } as unknown as R2Bucket;
    const { env, sdb } = newEnv(bucket);
    await activatedFunnel(env, sdb, "flaky", [MAKE_CARDS, YEAR_BUTTONS]);
    const first = await shell(env, "flaky");
    expect(first.status).toBe(200);
    expect(first.cacheControl).toBe("no-store");
    expect(first.config["vehicle"]).toBeUndefined();
    fail = false;
    const second = await shell(env, "flaky");
    expect(reads.filter((k) => k === VEHICLE_LIVE_KEY)).toHaveLength(2);
    expect(second.config["vehicle"]).toEqual({ snapshot: SNAPSHOT, base: "/api/vehicles/v1" });
    expect(second.cacheControl).not.toBe("no-store");
  });
});
