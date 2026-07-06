// LeadGen Phase 7 Stage C — the PUBLIC `/lg/*` funnel runtime over the REAL
// index.ts app (node:sqlite harness; the leadgen-quotes-api pattern extended
// with a base sites/domains schema so a TENANT host resolves + a Map-backed KV
// so the shell/config KV write-through runs). Seeds a fully activated funnel
// through the REAL Stage-B admin API, then drives the public routes end-to-end:
//   * GET /lg/:quote_slug → 200 funnel shell (funnel_id lgf_ + funnel_variant_id
//     lgn_ DISTINCT data attrs, chrome CSS, public max-age=300 + swr + strong
//     ETag + nosniff) + 304 on If-None-Match;
//   * GET /lg → the NULL-slug root activation;
//   * disabled/missing + DEACTIVATED → 404;
//   * GET /lg/attempt → no-store + { funnel_attempt_id (att_), signed_config_token }
//     that VERIFIES via Stage-A verifyConfigToken against the resolved tuple;
//   * GET /lg/config/:variant_id → cacheable + ETag + DTO with server-only fields
//     ABSENT (the §30.4 strip re-proven over HTTP) + 404 for a variant not under
//     an enabled activation on this host;
//   * the browser Maps key + the signing secret NEVER appear in the shell/config,
//     and the per-request Maps key is proven OUTSIDE the cached shell body;
//   * CP3: an activated funnel renders end-to-end (shell → config → attempt).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId, isPublicId } from "../src/leadgen/ids";
import { verifyConfigToken, type ConfigTokenTuple } from "../src/public/leadgen/attempt";

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

// A Map-backed KVNamespace stub (only the members the edge-cache + cache-stats
// paths touch: get / getWithMetadata / put / delete / list). The test inspects
// `store` directly to prove the cached shell body never carries the Maps key.
function makeKvStub(): { kv: KVNamespace; store: Map<string, { value: string; metadata: unknown }> } {
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
  return { kv, store };
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
] as const;

const TENANT_HOST = "one.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;
const MAPS_BROWSER_KEY = "test-browser-maps-key-DO-NOT-CACHE";
const CONFIG_SIGNING_KEY = "runtime-signing-key-test-only";

// Minimal base schema: only the columns resolveSiteByHostname needs
// (domains JOIN sites, both status='active') plus the leadgen tables via the
// real 0036–0039 migrations. site-1 is a live tenant on one.example.com.
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
    // ADMIN_HOST distinct from the tenant host so one.example.com resolves as a
    // public tenant (never the admin surface).
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
    // §30.2 secrets read via readEnvSecret: a signed config token + the browser
    // Maps key (whose presence in the cached shell we prove IMPOSSIBLE).
    GOOGLE_MAPS_BROWSER_KEY: MAPS_BROWSER_KEY,
    LEADGEN_CONFIG_SIGNING_KEY: CONFIG_SIGNING_KEY,
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// --- seeding through the REAL admin API + direct SQL --------------------------

interface Harness {
  sdb: SqliteDb;
  env: Env;
  store: Map<string, { value: string; metadata: unknown }>;
}

function newHarness(): Harness {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createRuntimeDb(ctor);
  const { kv, store } = makeKvStub();
  return { sdb, env: buildEnv(d1FromSqlite(sdb), kv), store };
}

// A section that matches the quote's activity+vertical (so the variant PUT
// accepts it). `contentJson` lets a test embed rogue server-only keys (strip
// re-proof) or an AddressAutocompleteQuestion (Maps-key path).
function seedSection(
  sdb: SqliteDb,
  opts: { activity: string; vertical: string; contentJson?: string; addressValidation?: boolean },
): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content =
    opts.contentJson ??
    JSON.stringify({
      components: [
        { type: "TwoButtonYesNo", question_id: "q1", question_key: "k", internal_field: "f", answer_type: "boolean" },
      ],
    });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, ?, ?, ?, ?, 'button', ?, 'active')",
    )
    .run(publicId, `Section ${publicId.slice(-4)}`, opts.activity, opts.vertical, "Headline", content, opts.addressValidation ? 1 : 0);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

interface SeededFunnel {
  quotePublicId: string;
  funnelId: string;
  variantId: string;
  slug: string | null;
}

// Create a quote (→ active funnel + active control variant), attach one ordered
// section, and activate it on site-1 (root when slug is null). Returns the ids.
async function seedActivatedFunnel(
  env: Env,
  sdb: SqliteDb,
  opts: { quoteName: string; slug: string | null; sectionContentJson?: string; addressValidation?: boolean },
): Promise<SeededFunnel> {
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: opts.quoteName, activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const quote = (await createRes.json()) as {
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  const funnelId = quote.funnels[0]!.public_id;
  const variantId = quote.funnels[0]!.variants[0]!.public_id;

  const section = seedSection(sdb, {
    activity: "quote_funnel",
    vertical: "life",
    contentJson: opts.sectionContentJson,
    addressValidation: opts.addressValidation,
  });
  const putRes = await admin.request(
    `${API}/variants/${variantId}`,
    jsonInit("PUT", { sections: [{ section_id: section.id }] }),
    env,
  );
  expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);

  const activateBody: Record<string, unknown> = { enabled: true };
  if (opts.slug !== null) activateBody.slug = opts.slug;
  const actRes = await admin.request(
    `${API}/quotes/${quote.public_id}/activation/site-1`,
    jsonInit("PUT", activateBody),
    env,
  );
  expect(actRes.status, `activate: ${await actRes.clone().text()}`).toBe(200);

  return { quotePublicId: quote.public_id, funnelId, variantId, slug: opts.slug };
}

async function get(env: Env, path: string, headers?: Record<string, string>): Promise<Response> {
  return app.request(`${TENANT_ORIGIN}${path}`, headers ? { headers } : {}, env);
}

// The section content the config-strip re-proof embeds: a normal client
// component PLUS rogue server-only keys that buildPublicConfig MUST drop.
const ROGUE_SECTION_JSON = JSON.stringify({
  components: [
    {
      type: "TwoButtonYesNo",
      question_id: "q_homeowner",
      question_key: "homeowner",
      internal_field: "homeowner",
      answer_type: "boolean",
      required: true,
      props: {},
      api_token_secret_ref: "LEADGEN_PB_TOKEN_X",
      endpoint_production: "https://provider.example/api",
      bid_source: "response",
      carrier_parse_json: "{...}",
      schema_json: "{...}",
    },
  ],
});

const SERVER_ONLY_DENY = [
  "signed_config_token",
  "funnel_attempt_id",
  "endpoint_production",
  "endpoint_staging",
  "api_token_secret_ref",
  "bid_source",
  "carrier_parse_json",
  "carrier_parse_version",
  "schema_json",
  "static_bid_value",
  "winner_logic",
] as const;

// ===========================================================================

describeDb("GET /lg/:quote_slug — funnel shell (§17.2 / §28)", () => {
  it("200 shell: distinct lgf_/lgn_ data attrs, chrome CSS, cache headers + ETag + nosniff", async () => {
    const { sdb, env } = newHarness();
    const seeded = await seedActivatedFunnel(env, sdb, { quoteName: "Life Quote", slug: "life" });

    const res = await get(env, "/lg/life");
    expect(res.status, `shell: ${await res.clone().text()}`).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300, stale-while-revalidate=86400");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const etag = res.headers.get("ETag") ?? "";
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);

    const html = await res.text();
    // G4: funnel_id (lgf_) + funnel_variant_id (lgn_) present, DISTINCT.
    const fid = html.match(/data-funnel-id="([^"]+)"/)?.[1];
    const vid = html.match(/data-funnel-variant-id="([^"]+)"/)?.[1];
    expect(fid).toBe(seeded.funnelId);
    expect(vid).toBe(seeded.variantId);
    expect(isPublicId("funnel", fid ?? "")).toBe(true);
    expect(isPublicId("funnel_variant", vid ?? "")).toBe(true);
    expect(fid).not.toBe(vid);
    // chrome CSS from funnelChromeCss(getFunnelDesign('default')) is inlined.
    expect(html).toContain('data-funnel-design="default-funnel"');
    expect(html).toContain(".lg-content");
    expect(html).toContain(".lg-btn");
    // the bootstrap fetches /lg/config + /lg/attempt.
    expect(html).toContain("/lg/config/");
    expect(html).toContain("/lg/attempt");
  });

  it("304 on a matching If-None-Match (no body)", async () => {
    const { sdb, env } = newHarness();
    await seedActivatedFunnel(env, sdb, { quoteName: "Life Quote", slug: "life" });
    const first = await get(env, "/lg/life");
    const etag = first.headers.get("ETag") ?? "";
    expect(etag).not.toBe("");
    const conditional = await get(env, "/lg/life", { "If-None-Match": etag });
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
  });

  it("GET /lg serves the NULL-slug root activation", async () => {
    const { sdb, env } = newHarness();
    const seeded = await seedActivatedFunnel(env, sdb, { quoteName: "Root Quote", slug: null });
    const res = await get(env, "/lg");
    expect(res.status, `root: ${await res.clone().text()}`).toBe(200);
    const html = await res.text();
    expect(html.match(/data-funnel-variant-id="([^"]+)"/)?.[1]).toBe(seeded.variantId);
  });

  it("missing activation → 404; a disabled site quote (deactivated) → 404", async () => {
    const { sdb, env } = newHarness();
    const seeded = await seedActivatedFunnel(env, sdb, { quoteName: "Life Quote", slug: "life" });
    // no activation for this slug
    expect((await get(env, "/lg/does-not-exist")).status).toBe(404);
    // deactivate the quote → the slug now 404s.
    const del = await admin.request(`${API}/quotes/${seeded.quotePublicId}/activation/site-1`, { method: "DELETE" }, env);
    expect(del.status).toBe(200);
    expect((await get(env, "/lg/life")).status).toBe(404);
  });
});

describeDb("GET /lg/config/:funnel_variant_id — public client config (§30.4 strip)", () => {
  it("cacheable + ETag + DTO with server-only fields ABSENT (strip re-proven over HTTP)", async () => {
    const { sdb, env } = newHarness();
    const seeded = await seedActivatedFunnel(env, sdb, {
      quoteName: "Life Quote",
      slug: "life",
      sectionContentJson: ROGUE_SECTION_JSON,
    });

    const res = await get(env, `/lg/config/${seeded.variantId}`);
    expect(res.status, `config: ${await res.clone().text()}`).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400",
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("ETag") ?? "").toMatch(/^"[0-9a-f]{16}"$/);

    const raw = await res.text();
    const config = JSON.parse(raw) as { funnel_id: string; funnel_variant_id: string; section_order_hash: string };
    // ALLOW: distinct identity + a stable section_order_hash.
    expect(config.funnel_id).toBe(seeded.funnelId);
    expect(config.funnel_variant_id).toBe(seeded.variantId);
    expect(config.funnel_id).not.toBe(config.funnel_variant_id);
    expect(config.section_order_hash.length).toBeGreaterThan(0);
    // DENY (RED LINE): none of the rogue server-only keys/values survive.
    for (const forbidden of SERVER_ONLY_DENY) {
      expect(raw, `server-only field leaked: ${forbidden}`).not.toContain(forbidden);
    }
    expect(raw).not.toContain("LEADGEN_PB_TOKEN_X");
    expect(raw).not.toContain("provider.example");
  });

  it("304 on a matching If-None-Match", async () => {
    const { sdb, env } = newHarness();
    const seeded = await seedActivatedFunnel(env, sdb, { quoteName: "Life Quote", slug: "life" });
    const first = await get(env, `/lg/config/${seeded.variantId}`);
    const etag = first.headers.get("ETag") ?? "";
    const conditional = await get(env, `/lg/config/${seeded.variantId}`, { "If-None-Match": etag });
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
  });

  it("404 for a variant NOT under an enabled activation on this host (no config leak)", async () => {
    const { sdb, env } = newHarness();
    // a well-formed but never-activated variant id.
    expect((await get(env, `/lg/config/${mintPublicId("funnel_variant")}`)).status).toBe(404);
    // a real active variant whose quote is NOT activated on this site → 404.
    const createRes = await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: "Unactivated", activity: "quote_funnel", verticals: ["life"] }),
      env,
    );
    const quote = (await createRes.json()) as { funnels: Array<{ variants: Array<{ public_id: string }> }> };
    const foreignVariant = quote.funnels[0]!.variants[0]!.public_id;
    expect((await get(env, `/lg/config/${foreignVariant}`)).status).toBe(404);
    // a garbage (non lgn_) param → 404, never a 500.
    expect((await get(env, "/lg/config/not-a-real-id")).status).toBe(404);
  });
});

describeDb("GET /lg/attempt — session mint (§8.3 / §24c)", () => {
  it("no-store + { funnel_attempt_id (att_), signed_config_token } that VERIFIES against the tuple", async () => {
    const { sdb, env } = newHarness();
    const seeded = await seedActivatedFunnel(env, sdb, { quoteName: "Life Quote", slug: "life" });

    // config supplies the section_order_hash + content_version the token binds.
    const configRes = await get(env, `/lg/config/${seeded.variantId}`);
    const config = (await configRes.json()) as { section_order_hash: string; content_version: number };

    const res = await get(env, `/lg/attempt?funnel_variant_id=${seeded.variantId}`);
    expect(res.status, `attempt: ${await res.clone().text()}`).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");

    const attempt = (await res.json()) as { funnel_attempt_id: string; signed_config_token: string };
    expect(attempt.funnel_attempt_id.startsWith("att_")).toBe(true);
    expect(attempt.signed_config_token.startsWith("v1.")).toBe(true); // signed (secret present)

    const tuple: ConfigTokenTuple = {
      funnel_variant_id: seeded.variantId,
      section_order_hash: config.section_order_hash,
      content_version: config.content_version,
      funnel_attempt_id: attempt.funnel_attempt_id,
    };
    expect(await verifyConfigToken(env, attempt.signed_config_token, tuple)).toBe(true);
    // a tampered variant id breaks the binding.
    expect(
      await verifyConfigToken(env, attempt.signed_config_token, { ...tuple, funnel_variant_id: mintPublicId("funnel_variant") }),
    ).toBe(false);
  });

  it("404 (no-store) for a variant not activated on this host", async () => {
    const { env } = newHarness();
    const res = await get(env, `/lg/attempt?funnel_variant_id=${mintPublicId("funnel_variant")}`);
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describeDb("§30.2 / §30.4 — the browser Maps key + signing secret never leak", () => {
  it("Maps key is injected on the RESPONSE for an address funnel but is NEVER in the cached shell body", async () => {
    const { sdb, env, store } = newHarness();
    const addrJson = JSON.stringify({
      components: [
        { type: "AddressAutocompleteQuestion", question_id: "q_addr", question_key: "address", internal_field: "address", props: {} },
      ],
    });
    const seeded = await seedActivatedFunnel(env, sdb, {
      quoteName: "Address Quote",
      slug: "addr",
      sectionContentJson: addrJson,
      addressValidation: true,
    });

    const res = await get(env, "/lg/addr");
    expect(res.status).toBe(200);
    const html = await res.text();
    // per-request injection: the RESPONSE carries the browser key global.
    expect(html).toContain("window.__LG_MAPS_KEY__");
    expect(html).toContain(MAPS_BROWSER_KEY);
    // the signing secret NEVER appears in the shell.
    expect(html).not.toContain(CONFIG_SIGNING_KEY);

    // the CACHED shell body (KV write-through) must NOT carry the Maps key.
    const shellEntries = [...store.entries()].filter(([k]) => k.startsWith("lg-shell:"));
    expect(shellEntries.length).toBeGreaterThan(0);
    for (const [, entry] of shellEntries) {
      expect(entry.value, "Maps key leaked into the cached shell body").not.toContain(MAPS_BROWSER_KEY);
      expect(entry.value).not.toContain(CONFIG_SIGNING_KEY);
      // the cached body carries the sentinel instead of the key script.
      expect(entry.value).toContain("<!--LG_MAPS_KEY-->");
    }

    // config for the address funnel also never carries either secret.
    const configRaw = await (await get(env, `/lg/config/${seeded.variantId}`)).text();
    expect(configRaw).not.toContain(MAPS_BROWSER_KEY);
    expect(configRaw).not.toContain(CONFIG_SIGNING_KEY);
  });

  it("a NON-address funnel shell never contains the Maps key at all", async () => {
    const { sdb, env } = newHarness();
    await seedActivatedFunnel(env, sdb, { quoteName: "Life Quote", slug: "life" });
    const html = await (await get(env, "/lg/life")).text();
    expect(html).not.toContain("window.__LG_MAPS_KEY__");
    expect(html).not.toContain(MAPS_BROWSER_KEY);
  });
});

describeDb("CP3 — an activated funnel renders end-to-end (shell → config → attempt)", () => {
  it("shell resolves the variant, config + attempt succeed, and the token binds the served config", async () => {
    const { sdb, env } = newHarness();
    const seeded = await seedActivatedFunnel(env, sdb, { quoteName: "CP3 Quote", slug: "cp3" });

    // 1) shell
    const shell = await get(env, "/lg/cp3");
    expect(shell.status).toBe(200);
    const variantId = (await shell.text()).match(/data-funnel-variant-id="([^"]+)"/)?.[1];
    expect(variantId).toBe(seeded.variantId);

    // 2) config (the bootstrap's first fetch)
    const config = (await (await get(env, `/lg/config/${variantId}`)).json()) as {
      funnel_variant_id: string;
      section_order_hash: string;
      content_version: number;
      sections: unknown[];
    };
    expect(config.funnel_variant_id).toBe(variantId);
    expect(Array.isArray(config.sections)).toBe(true);
    expect(config.sections.length).toBe(1);

    // 3) attempt (the bootstrap's second fetch) — the token binds THIS config.
    const attempt = (await (await get(env, `/lg/attempt?funnel_variant_id=${variantId}`)).json()) as {
      funnel_attempt_id: string;
      signed_config_token: string;
    };
    const bound = await verifyConfigToken(env, attempt.signed_config_token, {
      funnel_variant_id: variantId!,
      section_order_hash: config.section_order_hash,
      content_version: config.content_version,
      funnel_attempt_id: attempt.funnel_attempt_id,
    });
    expect(bound, "CP3: the minted token binds the served config tuple").toBe(true);
  });
});
