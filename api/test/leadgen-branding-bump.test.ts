// LeadGen v2.5 Phase D (D-settings) — the 10 §10.2 branding-edit cache bump.
//
// Contract: a site-settings save touching a BRANDING key (the SiteBranding
// projection inputs — logo_media_id / site_logo_url / site_name / tagline /
// contact_email / privacy_email / trust_logo_media_ids) is followed by ONE
// parameterized UPDATE touching `leadgen_site_quotes.updated_at` for THAT
// site only. updated_at IS the shell cache-key's activation_version segment
// (cache-keys.ts leadgenShellKey; serve.ts reads resolved.site_quote
// .updated_at), so the bump makes the next /lg serve mint a FRESH key + ETag
// and re-bake the branding — no new cache axis, no invalidation dependency.
//
// Legs proven here (through the REAL admin PATCH handler + the REAL /lg app):
//   1. branding save → the site's activation rows bump; ANOTHER site's rows
//      are untouched (parameterized site_id scope);
//   2. non-branding save → NO bump (the gate is the branding key set);
//   3. no activation rows → a no-op (200, zero changes, nothing throws);
//   4. cache impact — builder leg: the pre/post updated_at values mint
//      DIFFERENT leadgenShellKey identities (activation_version axis input);
//   5. cache impact — served leg (E5: cache-bust ≠ served): the warm KV shell
//      is NOT re-served after a logo edit — the second /lg render carries the
//      NEW logo <img> and a SECOND distinct lg-shell key appears whose
//      activation_version segment equals the bumped updated_at;
//   6. the SECOND branding write path — the ai-logo apply (REAL POST
//      /api/admin/ai/logo, generation mocked at the OpenAI fetch boundary,
//      everything below it real: D1 receipts + media row + setting upsert):
//      THIS site's activation rows bump, ANOTHER site's rows stay byte-equal,
//      and a site with NO activation rows is a clean no-op.

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { leadgenShellKey } from "../src/cache/cache-keys";
import {
  LEADGEN_BRANDING_SETTINGS_KEYS,
  touchesLeadGenBranding,
} from "../src/leadgen/branding";

// --- node:sqlite harness (the leadgen-frame-legacy-pin.test.ts pattern) ------

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
          return ((sdb.prepare(sql).get(...binds) ?? null) as T | null);
        },
        async all<T = unknown>() {
          return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} };
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

// KV stub with an introspectable store — the served-leg assertions read the
// lg-shell key population directly.
function makeKvStub(): { kv: KVNamespace; keys(): string[] } {
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
    // prefix-honoring list — invalidate.ts deleteByPrefix wipes the SCOPED
    // namespaces ("settings:<site>:", …); a prefix-blind stub would let that
    // courtesy wipe eat the lg-shell keys this suite asserts on.
    async list(opts?: {
      prefix?: string;
    }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor: string }> {
      const prefix = opts?.prefix ?? "";
      const names = [...store.keys()].filter((name) => name.startsWith(prefix));
      return { keys: names.map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
  return { kv, keys: () => [...store.keys()] };
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

const TENANT_HOST = "one.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;
const API = "/api/admin/leadgen";
const SLUG = "brand-bump";

// site_settings mirrors the REAL migration shape (0003: composite UNIQUE the
// PATCH UPSERT's ON CONFLICT(site_id, key) resolves against). sites carries
// settings_version + updated_at (both written by the PATCH handler's bump).
// media + ai_generations mirror 0008's typed-receipts shape (leg 6 drives the
// REAL logo generator: media UPSERT ON CONFLICT(storage_key) RETURNING id,
// receipts INSERT + success finisher by idempotency_key).
function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1, updated_at INTEGER DEFAULT 0);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT, storage_key TEXT UNIQUE, mime_type TEXT, size_bytes INTEGER, alt_text TEXT, folder TEXT, site_id TEXT, ai_generation_id TEXT);" +
      "CREATE TABLE ai_generations (id TEXT PRIMARY KEY, site_id TEXT, task TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'openai', model TEXT NOT NULL, prompt_version TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, request_json TEXT, response_json TEXT, parsed_json TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed','fallback','skipped_no_api_key')), target_type TEXT, target_id TEXT, error_message TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()));" +
      "CREATE TABLE site_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(site_id, key));" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','one.example.com','insurance','active');" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-2','Site Two','two.example.com','insurance','active');" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-3','Site Three','three.example.com','insurance','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','one.example.com','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('site-2','two.example.com','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('site-3','three.example.com','active');",
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
  kvKeys(): string[];
  funnelId: string;
  variantId: string;
}

// Seed one activated funnel (frame CONFIGURED so the shell bakes the §10.2
// site branding: header defaults are enabled + logo_source "site") on site-1
// AND site-2, through the REAL admin APIs; one minimal section via direct SQL
// (the legacy-pin seeding pattern).
async function seedActivated(): Promise<Harness> {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createDb(ctor);
  const { kv, keys } = makeKvStub();
  const env = buildEnv(d1FromSqlite(sdb), kv);

  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Branding Bump Quote", activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const quote = (await createRes.json()) as {
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  const funnelId = quote.funnels[0]!.public_id;
  const variantId = quote.funnels[0]!.variants[0]!.public_id;

  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', 0, 'active')",
    )
    .run(
      `lgs_${"0".repeat(19)}BRAND01`,
      "Brand Bump Section",
      "Are you insured?",
      JSON.stringify({
        components: [
          { type: "QuestionHeadline", question_id: "h1", props: { text: "Are you insured?" } },
          {
            type: "TwoButtonYesNo",
            question_id: "q1",
            question_key: "insured_q",
            internal_field: "insured",
            answer_type: "boolean",
            props: { auto_advance: true },
          },
        ],
      }),
    );
  const sectionRow = sdb
    .prepare("SELECT id FROM leadgen_sections WHERE section_name = 'Brand Bump Section'")
    .get() as { id: number };

  const putRes = await admin.request(
    `${API}/variants/${variantId}`,
    jsonInit("PUT", { sections: [{ section_id: sectionRow.id }] }),
    env,
  );
  expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);

  // a CONFIGURED frame → /lg composes renderQuoteFrame with site branding
  const frameRes = await admin.request(
    `${API}/funnels/${funnelId}/frame`,
    jsonInit("PUT", { frame_config_json: { version: 1, template: "centered" } }),
    env,
  );
  expect(frameRes.status, `frame put: ${await frameRes.clone().text()}`).toBe(200);

  for (const siteId of ["site-1", "site-2"]) {
    const actRes = await admin.request(
      `${API}/quotes/${quote.public_id}/activation/${siteId}`,
      jsonInit("PUT", { enabled: true, slug: SLUG }),
      env,
    );
    expect(actRes.status, `activate ${siteId}: ${await actRes.clone().text()}`).toBe(200);
  }

  return { sdb, env, kvKeys: keys, funnelId, variantId };
}

function activationVersions(sdb: SqliteDb, siteId: string): number[] {
  return (
    sdb.prepare("SELECT updated_at FROM leadgen_site_quotes WHERE site_id = ? ORDER BY id").all(siteId) as Array<{
      updated_at: number;
    }>
  ).map((r) => r.updated_at);
}

function forceActivationVersion(sdb: SqliteDb, siteId: string, value: number): void {
  sdb.prepare("UPDATE leadgen_site_quotes SET updated_at = ? WHERE site_id = ?").run(value, siteId);
}

async function patchSettings(env: Env, siteId: string, updates: Record<string, string>): Promise<Response> {
  return admin.request("/api/admin/settings", jsonInit("PATCH", { site_id: siteId, updates }), env);
}

const NEW_LOGO_KEY = "uploads/brand-bump-logo.png";
const NEW_LOGO_URL = `/media/${NEW_LOGO_KEY}`;

// ===========================================================================

describeDb("10 §10.2 — branding settings save bumps the activation_version cache axis", () => {
  it("registry: the branding key set is exactly the SiteBranding projection inputs; the gate helper honors it", () => {
    expect([...LEADGEN_BRANDING_SETTINGS_KEYS].sort()).toEqual([
      "contact_email",
      "logo_media_id",
      "privacy_email",
      "site_logo_url",
      "site_name",
      "tagline",
      "trust_logo_media_ids",
    ]);
    expect(touchesLeadGenBranding(["logo_media_id"])).toBe(true);
    expect(touchesLeadGenBranding(["ads_enabled", "tagline"])).toBe(true);
    expect(touchesLeadGenBranding(["site_description", "items_per_page"])).toBe(false);
    expect(touchesLeadGenBranding([])).toBe(false);
  });

  it("a settings save with a logo key bumps THIS site's leadgen_site_quotes.updated_at — other sites' rows untouched", async () => {
    const h = await seedActivated();
    forceActivationVersion(h.sdb, "site-1", 1111);
    forceActivationVersion(h.sdb, "site-2", 2222);

    const res = await patchSettings(h.env, "site-1", { logo_media_id: NEW_LOGO_KEY });
    expect(res.status, await res.clone().text()).toBe(200);

    const site1 = activationVersions(h.sdb, "site-1");
    expect(site1.length).toBeGreaterThan(0);
    for (const v of site1) expect(v, "site-1 activation updated_at bumped past the forced value").toBeGreaterThan(1111);

    // the OTHER site's activation rows are untouched (parameterized site scope)
    expect(activationVersions(h.sdb, "site-2")).toEqual([2222]);

    // …and the settings row itself was written (the bump FOLLOWS the save)
    const setting = h.sdb
      .prepare("SELECT value FROM site_settings WHERE site_id = 'site-1' AND key = 'logo_media_id'")
      .get() as { value: string };
    expect(setting.value).toBe(NEW_LOGO_KEY);
  });

  it("every branding key gates the bump; a NON-branding save never bumps", async () => {
    const h = await seedActivated();
    // each branding key, one at a time (values are plausible, all string-typed)
    const brandingWrites: Record<string, string> = {
      site_name: "Site One Renamed",
      logo_media_id: NEW_LOGO_KEY,
      site_logo_url: "https://cdn.example.com/logo.png",
      tagline: "Compare in minutes.",
      contact_email: "hello@one.example.com",
      privacy_email: "privacy@one.example.com",
      // trust_logo_media_ids is a projection input but NOT PATCH-writable
      // today (ALLOWED_SETTINGS_KEYS) — asserted separately below.
    };
    let epoch = 100;
    for (const [key, value] of Object.entries(brandingWrites)) {
      forceActivationVersion(h.sdb, "site-1", epoch);
      const res = await patchSettings(h.env, "site-1", { [key]: value });
      expect(res.status, `${key}: ${await res.clone().text()}`).toBe(200);
      for (const v of activationVersions(h.sdb, "site-1")) {
        expect(v, `branding key '${key}' bumps updated_at`).toBeGreaterThan(epoch);
      }
      epoch += 100;
    }

    // non-branding saves (real allow-listed keys) leave updated_at untouched
    forceActivationVersion(h.sdb, "site-1", 7777);
    const nonBranding: Array<Record<string, string>> = [
      { site_description: "A trusted site." },
      { ads_enabled: "0" },
    ];
    for (const updates of nonBranding) {
      const res = await patchSettings(h.env, "site-1", updates);
      expect(res.status, await res.clone().text()).toBe(200);
      expect(activationVersions(h.sdb, "site-1"), `no bump for ${Object.keys(updates)[0]}`).toEqual([7777]);
    }
  });

  it("no activation rows → the branding save is a clean no-op (200; zero leadgen rows; nothing throws)", async () => {
    const h = await seedActivated();
    // site-3 exists as a tenant but has NO leadgen activation
    const res = await patchSettings(h.env, "site-3", { logo_media_id: NEW_LOGO_KEY });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(activationVersions(h.sdb, "site-3")).toEqual([]);
    // the save itself persisted (the guarded bump never blocks the write)
    const setting = h.sdb
      .prepare("SELECT value FROM site_settings WHERE site_id = 'site-3' AND key = 'logo_media_id'")
      .get() as { value: string };
    expect(setting.value).toBe(NEW_LOGO_KEY);
  });

  it("cache-key builder leg: the pre/post updated_at values mint DIFFERENT shell keys (activation_version axis input)", async () => {
    const h = await seedActivated();
    forceActivationVersion(h.sdb, "site-1", 1111);
    const before = activationVersions(h.sdb, "site-1")[0]!;
    const res = await patchSettings(h.env, "site-1", { tagline: "Fresh tagline." });
    expect(res.status).toBe(200);
    const after = activationVersions(h.sdb, "site-1")[0]!;
    expect(after).toBeGreaterThan(before);

    const keyBefore = leadgenShellKey("site-1", SLUG, "lgf_X", "lgn_Y", 1, 0, before);
    const keyAfter = leadgenShellKey("site-1", SLUG, "lgf_X", "lgn_Y", 1, 0, after);
    expect(keyBefore).not.toBe(keyAfter);
    // updated_at IS the final activation_version segment of the key
    expect(keyBefore.endsWith(`:${before}`)).toBe(true);
    expect(keyAfter.endsWith(`:${after}`)).toBe(true);
  });

  it("served-shell leg (leg 5): after a logo edit the warm cache is NOT re-served — the new render bakes the new logo under a SECOND distinct shell key", async () => {
    const h = await seedActivated();
    forceActivationVersion(h.sdb, "site-1", 1111);

    // cold serve 1 — no logo settings yet: the frame header renders the
    // site_name text mark; ONE lg-shell key exists, its activation_version
    // segment is the forced value.
    const res1 = await app.request(`${TENANT_ORIGIN}/lg/${SLUG}`, {}, h.env);
    expect(res1.status, await res1.clone().text()).toBe(200);
    const body1 = await res1.text();
    expect(body1).not.toContain(NEW_LOGO_URL);
    const keys1 = h.kvKeys().filter((k) => k.startsWith("lg-shell:site-1:"));
    expect(keys1).toHaveLength(1);
    expect(keys1[0]!.endsWith(":1111")).toBe(true);

    // the branding edit (THE §10.2 trigger): logo_media_id through the REAL
    // settings PATCH — bumps updated_at, minting a fresh key identity.
    const patch = await patchSettings(h.env, "site-1", { logo_media_id: NEW_LOGO_KEY });
    expect(patch.status).toBe(200);
    const bumped = activationVersions(h.sdb, "site-1")[0]!;
    expect(bumped).toBeGreaterThan(1111);

    // serve 2 — the fresh key MISSES the warm shell: a new cold render bakes
    // the new logo <img> (…the §10.4 ladder's media leg) and a SECOND
    // distinct lg-shell key appears carrying the bumped segment.
    const res2 = await app.request(`${TENANT_ORIGIN}/lg/${SLUG}`, {}, h.env);
    expect(res2.status).toBe(200);
    const body2 = await res2.text();
    expect(body2, "the served shell re-baked the NEW logo").toContain(NEW_LOGO_URL);
    expect(body1).not.toBe(body2);
    const keys2 = h.kvKeys().filter((k) => k.startsWith("lg-shell:site-1:"));
    expect(keys2).toHaveLength(2);
    const newKeys = keys2.filter((k) => !keys1.includes(k));
    expect(newKeys).toHaveLength(1);
    expect(newKeys[0]!.endsWith(`:${bumped}`), "the new key rides the bumped activation_version").toBe(true);
  });
});

// ===========================================================================
// Leg 6 — the SECOND §10.2 branding write path: the admin ai-logo apply
// (ai-logo.ts calls the SAME bumpLeadGenActivationVersionForBranding after
// its logo_media_id setting write). Generation is mocked ONLY at the OpenAI
// fetch boundary (the admin-ai-image.test.ts stub); everything below it is
// the REAL route over the REAL tables — receipts row, R2 put, media UPSERT,
// setting upsert, then the parameterized bump.
// ===========================================================================

// R2 put-recording stub (the generator PUTs the logo bytes before the media
// row insert — leg 6 asserts the put happened under the returned key).
function makeMediaStub(): { media: R2Bucket; puts: Array<{ key: string }> } {
  const puts: Array<{ key: string }> = [];
  const bucket = {
    async put(key: string): Promise<null> {
      puts.push({ key });
      return null;
    },
  };
  return { media: bucket as unknown as R2Bucket, puts };
}

// Arm the harness env for the ai-logo route: a key (the 501 gate), the LOCKED
// image model (buildEnv's "img-test" placeholder would 500 at the route's
// getImageModel gate) and a working MEDIA bucket.
function armAiLogo(env: Env): { puts: Array<{ key: string }> } {
  const { media, puts } = makeMediaStub();
  const mutable = env as unknown as Record<string, unknown>;
  mutable["OPENAI_API_KEY"] = "sk-test";
  mutable["OPENAI_IMAGE_MODEL"] = "gpt-image-2";
  mutable["MEDIA"] = media;
  return { puts };
}

const FAKE_LOGO_B64 = Buffer.from("brand-bump-logo-bytes").toString("base64");

// Outbound OpenAI traffic is a stubbed global fetch — no network leaves the
// test; the in-process admin/app.request calls never touch global fetch.
function stubOpenAIFetch(): ReturnType<typeof vi.fn> {
  const impl = vi.fn(
    async () =>
      new Response(JSON.stringify({ data: [{ b64_json: FAKE_LOGO_B64 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", impl);
  return impl;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Full-row snapshot (not just updated_at) — the isolation assertion is
// BYTE-equality of the other tenant's activation rows.
function activationRows(sdb: SqliteDb, siteId: string): unknown[] {
  return sdb.prepare("SELECT * FROM leadgen_site_quotes WHERE site_id = ? ORDER BY id").all(siteId);
}

describeDb("10 §10.2 — the ai-logo apply (POST /api/admin/ai/logo) bumps the activation_version axis", () => {
  it("bumps THIS site's leadgen_site_quotes.updated_at through the REAL route; the OTHER site's rows stay byte-equal", async () => {
    const h = await seedActivated();
    const { puts } = armAiLogo(h.env);
    const fetchSpy = stubOpenAIFetch();
    forceActivationVersion(h.sdb, "site-1", 1111);
    forceActivationVersion(h.sdb, "site-2", 2222);
    const site2Before = activationRows(h.sdb, "site-2");
    expect(site2Before.length, "the isolation leg cannot no-op").toBeGreaterThan(0);

    const res = await admin.request("/api/admin/ai/logo", jsonInit("POST", { site_id: "site-1" }), h.env);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      media_id: number;
      storage_key: string;
      setting_key: string;
    };
    expect(body.ok).toBe(true);
    expect(body.setting_key).toBe("logo_media_id");
    expect(body.media_id).toBeGreaterThan(0);
    expect(fetchSpy, "generation mocked at the fetch boundary — ONE outbound call").toHaveBeenCalledTimes(1);

    // the REAL write path ran end-to-end for the posted site only: R2 put,
    // media row, success receipt, setting upsert.
    expect(puts.map((p) => p.key)).toEqual([body.storage_key]);
    const mediaRow = h.sdb.prepare("SELECT site_id FROM media WHERE storage_key = ?").get(body.storage_key) as {
      site_id: string;
    };
    expect(mediaRow.site_id).toBe("site-1");
    const receipt = h.sdb.prepare("SELECT status, task, site_id FROM ai_generations").get() as {
      status: string;
      task: string;
      site_id: string;
    };
    expect(receipt).toEqual({ status: "success", task: "logo-image", site_id: "site-1" });
    const setting = h.sdb
      .prepare("SELECT value FROM site_settings WHERE site_id = 'site-1' AND key = 'logo_media_id'")
      .get() as { value: string };
    expect(setting.value).toBe(body.storage_key);

    // §10.2: THIS site's activation rows bumped past the forced value…
    const site1 = activationVersions(h.sdb, "site-1");
    expect(site1.length).toBeGreaterThan(0);
    for (const v of site1) {
      expect(v, "site-1 activation updated_at bumped by the ai-logo apply").toBeGreaterThan(1111);
    }
    // …and the OTHER site's rows are BYTE-EQUAL (the bump is parameterized to
    // the posted site_id — full-row compare, not just updated_at).
    expect(activationRows(h.sdb, "site-2")).toEqual(site2Before);
    expect(activationVersions(h.sdb, "site-2")).toEqual([2222]);
  });

  it("no activation rows → the ai-logo apply is a clean no-op on the leadgen axis (200; logo writes persist; zero rows; nothing throws)", async () => {
    const h = await seedActivated();
    const { puts } = armAiLogo(h.env);
    stubOpenAIFetch();
    // site-3 exists as a tenant but has NO leadgen activation; the activated
    // sites' rows must not be collaterally bumped either.
    const othersBefore = [...activationRows(h.sdb, "site-1"), ...activationRows(h.sdb, "site-2")];
    const res = await admin.request("/api/admin/ai/logo", jsonInit("POST", { site_id: "site-3" }), h.env);
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { ok: boolean; storage_key: string };
    expect(body.ok).toBe(true);
    // the apply persisted (the guarded bump never blocks the logo write)…
    expect(puts).toHaveLength(1);
    const setting = h.sdb
      .prepare("SELECT value FROM site_settings WHERE site_id = 'site-3' AND key = 'logo_media_id'")
      .get() as { value: string };
    expect(setting.value).toBe(body.storage_key);
    // …and the leadgen axis is untouched everywhere.
    expect(activationVersions(h.sdb, "site-3")).toEqual([]);
    expect([...activationRows(h.sdb, "site-1"), ...activationRows(h.sdb, "site-2")]).toEqual(othersBefore);
  });
});
