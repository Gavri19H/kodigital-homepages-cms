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
import { assignVariant } from "../src/public/leadgen/ab-hash";
import { sha256Hex } from "../src/public/leadgen/auction/parse";

// The v2 (R9, 05 §5.3) token tuple for a funnel with NO answer maps and NO
// auction: session_id "" by default — the /lg/attempt route now MINTS + binds
// + ECHOES a session id when no ko_sid cookie rides the request (m2), so
// route-minted tokens verify with `session_id: attempt.session_id` overlaid.
// answer_mapping_hash = SHA-256 over the ordered per-section version strings
// (["0", …] when nothing is mapped — attempt.computeAttemptBindingExtras
// semantics), auction_config_version "" (no auction bound to the variant).
function v2Tuple(
  base: Pick<ConfigTokenTuple, "funnel_variant_id" | "section_order_hash" | "content_version" | "funnel_attempt_id">,
  opts?: { sectionVersions?: string[]; auction_config_version?: string },
): ConfigTokenTuple {
  return {
    ...base,
    session_id: "",
    answer_mapping_hash: sha256Hex(JSON.stringify(opts?.sectionVersions ?? ["0"])),
    auction_config_version: opts?.auction_config_version ?? "",
  };
}

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
  "0042_leadgen_pages.sql",
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

// A GET against an ARBITRARY tenant host (cross-tenant tests need a 2nd host).
async function getHost(env: Env, host: string, path: string): Promise<Response> {
  return app.request(`http://${host}${path}`, {}, env);
}

// Seed a second active tenant site + its active domain (host→site resolution).
function addSite(sdb: SqliteDb, id: string, hostname: string): void {
  sdb
    .prepare(
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES (?, ?, ?, 'insurance', 'active')",
    )
    .run(id, `Site ${id}`, hostname);
  sdb.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(id, hostname);
}

// Create a quote (→ active funnel + control variant) + one ordered section, WITHOUT
// activating it — the caller activates on the site(s) it wants (with per-site GA4).
async function seedQuoteWithSection(
  env: Env,
  sdb: SqliteDb,
  quoteName: string,
): Promise<{ quotePublicId: string; variantId: string }> {
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: quoteName, activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const quote = (await createRes.json()) as {
    public_id: string;
    funnels: Array<{ variants: Array<{ public_id: string }> }>;
  };
  const variantId = quote.funnels[0]!.variants[0]!.public_id;
  const section = seedSection(sdb, { activity: "quote_funnel", vertical: "life" });
  const putRes = await admin.request(
    `${API}/variants/${variantId}`,
    jsonInit("PUT", { sections: [{ section_id: section.id }] }),
    env,
  );
  expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);
  return { quotePublicId: quote.public_id, variantId };
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
    // v2.4 03 §3.2 (the 11 §11.6 anti-false-PASS flip of the old bootstrap
    // assertions): the shell no longer fetch-bootstraps /lg/config — it BAKES
    // the #lg-config JSON, ships the pre-hydration click-queue stub, and loads
    // the versioned hydration engine; the ENGINE (not the shell) fetches
    // /lg/attempt and sets data-lg-ready="1".
    expect(html).toContain('<script type="application/json" id="lg-config">');
    expect(html).toContain('src="/lg/runtime/3.js" defer');
    expect(html).toContain("__LG_PREHYDRATE_QUEUE__");
    expect(html).not.toContain("__LG_BOOTSTRAP__");
    expect(html).not.toContain('data-lg-ready="1"');
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

    const attempt = (await res.json()) as { funnel_attempt_id: string; signed_config_token: string; session_id: string };
    expect(attempt.funnel_attempt_id.startsWith("att_")).toBe(true);
    expect(attempt.signed_config_token.startsWith("v2.")).toBe(true); // signed v2 (R9, 05 §5.3)
    // m2: no cookie rode the request → the route MINTED + bound a session id,
    // echoes it, and Set-Cookies it (best-effort for cookie-accepting UAs).
    expect(typeof attempt.session_id).toBe("string");
    expect(attempt.session_id).not.toBe("");
    expect(res.headers.get("Set-Cookie") ?? "").toContain("ko_sid=");

    const tuple: ConfigTokenTuple = {
      ...v2Tuple({
        funnel_variant_id: seeded.variantId,
        section_order_hash: config.section_order_hash,
        content_version: config.content_version,
        funnel_attempt_id: attempt.funnel_attempt_id,
      }),
      session_id: attempt.session_id, // m2: the tuple binds the ECHOED sid
    };
    expect(await verifyConfigToken(env, attempt.signed_config_token, tuple)).toBe(true);
    // a tampered variant id breaks the binding.
    expect(
      await verifyConfigToken(env, attempt.signed_config_token, { ...tuple, funnel_variant_id: mintPublicId("funnel_variant") }),
    ).toBe(false);
    // …and so does a session the mint never bound (the m2 crypto guarantee).
    expect(
      await verifyConfigToken(env, attempt.signed_config_token, { ...tuple, session_id: "some-other-sid" }),
    ).toBe(false);
  });

  it("m6: an oversized `u` landing URL is capped at 4096 chars INSIDE the signed payload (param-boundary truncation)", async () => {
    const { sdb, env } = newHarness();
    const seeded = await seedActivatedFunnel(env, sdb, { quoteName: "Cap Quote", slug: "cap" });
    const longValue = "x".repeat(6000);
    const landing = `https://one.example.com/lg/cap?utm_source=capped&big=${longValue}&tail=1`;
    const res = await get(env, `/lg/attempt?funnel_variant_id=${seeded.variantId}&u=${encodeURIComponent(landing)}`);
    expect(res.status).toBe(200);
    const attempt = (await res.json()) as { signed_config_token: string };
    const payload = decodeTokenPayload(attempt.signed_config_token);
    const landingUrl = payload["landing_url"] as string;
    expect(landingUrl.length).toBeLessThanOrEqual(4096);
    // The cut lands on the last complete query-param boundary inside the cap:
    // the half-sliced `big` param is dropped whole, params before it survive
    // verbatim (never a dangling half value).
    expect(landingUrl).toBe("https://one.example.com/lg/cap?utm_source=capped");
    // The mint stays functional: the token is still a signed v2 token.
    expect(attempt.signed_config_token.startsWith("v2.")).toBe(true);
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

    // 3) attempt (the bootstrap's second fetch) — the token binds THIS config
    // (+ the m2 minted-when-absent session id the route echoes).
    const attempt = (await (await get(env, `/lg/attempt?funnel_variant_id=${variantId}`)).json()) as {
      funnel_attempt_id: string;
      signed_config_token: string;
      session_id: string;
    };
    const bound = await verifyConfigToken(env, attempt.signed_config_token, {
      ...v2Tuple({
        funnel_variant_id: variantId!,
        section_order_hash: config.section_order_hash,
        content_version: config.content_version,
        funnel_attempt_id: attempt.funnel_attempt_id,
      }),
      session_id: attempt.session_id,
    });
    expect(bound, "CP3: the minted token binds the served config tuple").toBe(true);
  });
});

describeDb("B1 + M1 — one funnel on TWO tenant sites: per-site config, no cross-tenant bleed", () => {
  it("each host's /lg/config carries ITS OWN ga4 id + the two cached KV entries are DISTINCT site-scoped keys", async () => {
    const { sdb, env, store } = newHarness();
    addSite(sdb, "site-2", "two.example.com");

    // ONE quote/funnel/variant, activated on BOTH sites with DIFFERENT ga4 ids
    // (site-specific settings_overrides_json). Same slug is fine — it is unique
    // PER site.
    const { quotePublicId, variantId } = await seedQuoteWithSection(env, sdb, "Shared Quote");
    const actA = await admin.request(
      `${API}/quotes/${quotePublicId}/activation/site-1`,
      jsonInit("PUT", { enabled: true, slug: "shared", settings_overrides_json: { ga4_measurement_id: "G-AAA" } }),
      env,
    );
    expect(actA.status, `activate site-1: ${await actA.clone().text()}`).toBe(200);
    const actB = await admin.request(
      `${API}/quotes/${quotePublicId}/activation/site-2`,
      jsonInit("PUT", { enabled: true, slug: "shared", settings_overrides_json: { ga4_measurement_id: "G-BBB" } }),
      env,
    );
    expect(actB.status, `activate site-2: ${await actB.clone().text()}`).toBe(200);

    // site-1 fetched FIRST — it warms the cache. Pre-fix (funnel-only key) this
    // poisons the shared entry, so site-2 would read site-1's ga4 id.
    const cfgA = (await (await getHost(env, "one.example.com", `/lg/config/${variantId}`)).json()) as {
      ga4_measurement_id: string | null;
    };
    const cfgB = (await (await getHost(env, "two.example.com", `/lg/config/${variantId}`)).json()) as {
      ga4_measurement_id: string | null;
    };
    expect(cfgA.ga4_measurement_id).toBe("G-AAA");
    expect(cfgB.ga4_measurement_id).toBe("G-BBB");

    // Two DISTINCT site-scoped cache keys — never one shared funnel-only key.
    const configKeys = [...store.keys()].filter((k) => k.startsWith("lg-config:"));
    expect(configKeys.length).toBe(2);
    expect(new Set(configKeys).size).toBe(2);
    expect(configKeys.some((k) => k.includes("site-1"))).toBe(true);
    expect(configKeys.some((k) => k.includes("site-2"))).toBe(true);
  });
});

describeDb("MINOR-4 — cross-tenant anti-leak: a variant activated on site-2 is 404 from site-1", () => {
  it("a variant activated ONLY on site-2 → 404 from site-1's host (config + attempt); 200 from site-2", async () => {
    const { sdb, env } = newHarness();
    addSite(sdb, "site-2", "two.example.com");

    const { quotePublicId, variantId } = await seedQuoteWithSection(env, sdb, "Site2 Quote");
    // activate ONLY on site-2.
    const act = await admin.request(
      `${API}/quotes/${quotePublicId}/activation/site-2`,
      jsonInit("PUT", { enabled: true, slug: "s2only" }),
      env,
    );
    expect(act.status, `activate site-2: ${await act.clone().text()}`).toBe(200);

    // TRUE cross-tenant: requested from site-1's host → 404 (not just "nowhere").
    expect((await getHost(env, "one.example.com", `/lg/config/${variantId}`)).status).toBe(404);
    expect((await getHost(env, "one.example.com", `/lg/attempt?funnel_variant_id=${variantId}`)).status).toBe(404);
    // sanity: from its OWN host it resolves.
    expect((await getHost(env, "two.example.com", `/lg/config/${variantId}`)).status).toBe(200);
  });
});

// ===========================================================================
// P8 — §16.2 A/B assignment over the RUNNING test (edge-hash, sticky per session)
// ===========================================================================

interface RunningArm {
  variant_label: string;
  traffic_allocation_bp: number;
  public_id: string;
}
interface RunningTestSeed {
  quotePublicId: string;
  funnelId: string;
  slug: string | null;
  controlId: string;
  forkId: string;
  testId: string;
  revision: number;
  arms: RunningArm[];
}

// Seed a funnel with TWO active variants (control + a fork) split 50/50, a
// RUNNING A/B test over them, and an activation on site-1. The arms are read
// back from the builder structure so they MIRROR exactly the set the resolver
// buckets over (funnel-scoped active variants) — a true end-to-end setup.
async function seedRunning2VariantTest(
  env: Env,
  sdb: SqliteDb,
  opts: { quoteName: string; slug: string | null },
): Promise<RunningTestSeed> {
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
  const controlId = quote.funnels[0]!.variants[0]!.public_id;

  const section = seedSection(sdb, { activity: "quote_funnel", vertical: "life" });
  expect(
    (await admin.request(`${API}/variants/${controlId}`, jsonInit("PUT", { sections: [{ section_id: section.id }] }), env)).status,
  ).toBe(200);

  // fork the control → a 2nd active variant (clones the section).
  const forkRes = await admin.request(`${API}/variants/${controlId}/fork`, { method: "POST" }, env);
  expect(forkRes.status, `fork: ${await forkRes.clone().text()}`).toBe(201);
  const forkId = ((await forkRes.json()) as { public_id: string }).public_id;

  // 50/50 while draft (allocations are free) → create + start (Σ==10000 → running).
  expect((await admin.request(`${API}/variants/${controlId}`, jsonInit("PUT", { traffic_allocation_bp: 5000 }), env)).status).toBe(200);
  expect((await admin.request(`${API}/variants/${forkId}`, jsonInit("PUT", { traffic_allocation_bp: 5000 }), env)).status).toBe(200);
  const abRes = await admin.request(`${API}/quotes/${quote.public_id}/experiments`, jsonInit("POST", {}), env);
  const ab = (await abRes.json()) as { public_id: string };
  const startRes = await admin.request(`${API}/experiments/${ab.public_id}/start`, { method: "POST" }, env);
  expect(startRes.status, `start: ${await startRes.clone().text()}`).toBe(200);
  const started = (await startRes.json()) as { public_id: string; revision: number; status: string };
  expect(started.status).toBe("running");

  const activateBody: Record<string, unknown> = { enabled: true };
  if (opts.slug !== null) activateBody.slug = opts.slug;
  expect(
    (await admin.request(`${API}/quotes/${quote.public_id}/activation/site-1`, jsonInit("PUT", activateBody), env)).status,
  ).toBe(200);

  const struct = (await (await admin.request(`${API}/quotes/${quote.public_id}/structure`, {}, env)).json()) as {
    funnels: Array<{ variants: Array<{ public_id: string; variant_label: string; traffic_allocation_bp: number; status: string }> }>;
  };
  const arms: RunningArm[] = struct.funnels[0]!.variants
    .filter((v) => v.status === "active")
    .map((v) => ({ variant_label: v.variant_label, traffic_allocation_bp: v.traffic_allocation_bp, public_id: v.public_id }));

  return {
    quotePublicId: quote.public_id,
    funnelId,
    slug: opts.slug,
    controlId,
    forkId,
    testId: started.public_id,
    revision: started.revision,
    arms,
  };
}

// The variant/bucket assignVariant picks for a session — the resolver's expected
// output for the SAME (testId, revision, sid, arms) inputs.
function expectedVariantFor(seed: RunningTestSeed, sid: string): string {
  return assignVariant(seed.testId, seed.revision, sid, seed.arms).variant.public_id;
}
function expectedBucketFor(seed: RunningTestSeed, sid: string): number {
  return assignVariant(seed.testId, seed.revision, sid, seed.arms).assignment_bucket ?? -1;
}
function shellVariantId(html: string): string | undefined {
  return html.match(/data-funnel-variant-id="([^"]+)"/)?.[1];
}
function parseInjectedAssignment(html: string): Record<string, unknown> | null {
  const m = html.match(/window\.__LG_ASSIGNMENT__=(\{[^}]*\});/);
  if (m === null) return null;
  return JSON.parse(m[1] ?? "null") as Record<string, unknown>;
}

describeDb("P8 — a RUNNING 2-variant test buckets by session (§16.2/§16.3)", () => {
  it("each session cookie is served the variant assignVariant picks for it + injected §16.3 dims", async () => {
    const { sdb, env } = newHarness();
    const seed = await seedRunning2VariantTest(env, sdb, { quoteName: "AB Quote", slug: "ab" });
    expect(seed.arms.length).toBe(2);

    for (const sid of ["sess-alpha", "sess-bravo", "sess-charlie", "sess-delta"]) {
      const expected = expectedVariantFor(seed, sid);
      const res = await get(env, "/lg/ab", { Cookie: `ko_sid=${sid}` });
      expect(res.status, `shell ${sid}`).toBe(200);
      const html = await res.text();
      // the SERVED variant matches the deterministic edge hash for THIS session.
      expect(shellVariantId(html), `served variant for ${sid}`).toBe(expected);
      // the NON-session §16.3 dims are injected on the RESPONSE (P11 beacon reads them).
      const assign = parseInjectedAssignment(html);
      expect(assign, `assignment injected for ${sid}`).not.toBeNull();
      expect(assign!["assignment_reason"]).toBe("ab_hash");
      expect(assign!["funnel_ab_test_id"]).toBe(seed.testId);
      expect(assign!["funnel_ab_test_revision"]).toBe(seed.revision);
      // the served (non-session) variant id rides the dims too.
      expect(assign!["funnel_variant_id"]).toBe(expected);
      // m1: the per-SESSION bucket must NOT ride this public shell — it is null even
      // on the ab_hash path (P11 recomputes it; the dedicated m1 test asserts this).
      expect(assign!["assignment_bucket"]).toBeNull();
    }
  });

  it("stickiness: the SAME cookie is served the SAME variant across requests", async () => {
    const { sdb, env } = newHarness();
    const seed = await seedRunning2VariantTest(env, sdb, { quoteName: "Sticky Quote", slug: "sticky" });
    const sid = "sticky-session-1";
    const first = shellVariantId(await (await get(env, "/lg/sticky", { Cookie: `ko_sid=${sid}` })).text());
    const second = shellVariantId(await (await get(env, "/lg/sticky", { Cookie: `ko_sid=${sid}` })).text());
    const third = shellVariantId(await (await get(env, "/lg/sticky", { Cookie: `ko_sid=${sid}` })).text());
    expect(first).toBe(expectedVariantFor(seed, sid));
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("serves TWO DISTINCT cached shells — one per assigned variant (§28 per-variant cache)", async () => {
    const { sdb, env, store } = newHarness();
    const seed = await seedRunning2VariantTest(env, sdb, { quoteName: "TwoShell Quote", slug: "two" });
    // find one session id per variant (50/50 → a short scan reaches both).
    const byVariant = new Map<string, string>();
    for (let i = 0; i < 40 && byVariant.size < 2; i++) {
      const sid = `scan-${i}`;
      if (!byVariant.has(expectedVariantFor(seed, sid))) byVariant.set(expectedVariantFor(seed, sid), sid);
    }
    expect(byVariant.size, "both variants reachable at 50/50").toBe(2);
    for (const [variantId, sid] of byVariant) {
      const html = await (await get(env, "/lg/two", { Cookie: `ko_sid=${sid}` })).text();
      expect(shellVariantId(html)).toBe(variantId);
    }
    // two DISTINCT per-variant cached shell entries (never one shared key).
    const shellKeys = [...store.keys()].filter((k) => k.startsWith("lg-shell:"));
    expect(new Set(shellKeys).size).toBe(2);
    for (const variantId of byVariant.keys()) {
      expect(shellKeys.some((k) => k.includes(variantId)), `a shell key for ${variantId}`).toBe(true);
    }
  });

  it("the served variant's /lg/config carries the §16.3 ab_hash dims; token binds the ASSIGNED variant", async () => {
    const { sdb, env } = newHarness();
    const seed = await seedRunning2VariantTest(env, sdb, { quoteName: "Cfg Quote", slug: "cfg" });
    const sid = "cfg-session";
    const served = shellVariantId(await (await get(env, "/lg/cfg", { Cookie: `ko_sid=${sid}` })).text());
    expect(served).toBe(expectedVariantFor(seed, sid));
    const servedArm = seed.arms.find((a) => a.public_id === served)!;

    const config = (await (await get(env, `/lg/config/${served}`)).json()) as {
      funnel_variant_id: string;
      funnel_ab_test_id: string;
      funnel_ab_test_revision: number;
      variant_label: string;
      traffic_allocation_bp: number;
      assignment_reason: string;
      section_order_hash: string;
      content_version: number;
    };
    expect(config.funnel_variant_id).toBe(served);
    expect(config.assignment_reason).toBe("ab_hash");
    expect(config.funnel_ab_test_id).toBe(seed.testId);
    expect(config.funnel_ab_test_revision).toBe(seed.revision);
    expect(config.variant_label).toBe(servedArm.variant_label);
    expect(config.traffic_allocation_bp).toBe(servedArm.traffic_allocation_bp);
    // §8.3/§30.4 — the cacheable config carries NO per-session bucket.
    expect(JSON.stringify(config)).not.toContain("assignment_bucket");

    // the minted token binds the ASSIGNED variant (never the control by default)
    // + the m2 minted-when-absent session id the route echoes.
    const attempt = (await (await get(env, `/lg/attempt?funnel_variant_id=${served}`)).json()) as {
      funnel_attempt_id: string;
      signed_config_token: string;
      session_id: string;
    };
    const bound = await verifyConfigToken(env, attempt.signed_config_token, {
      ...v2Tuple({
        funnel_variant_id: served!,
        section_order_hash: config.section_order_hash,
        content_version: config.content_version,
        funnel_attempt_id: attempt.funnel_attempt_id,
      }),
      session_id: attempt.session_id,
    });
    expect(bound, "token binds the assigned variant's config tuple").toBe(true);
  });

  it("a funnel with NO running test → single_control on config + shell", async () => {
    const { sdb, env } = newHarness();
    const seeded = await seedActivatedFunnel(env, sdb, { quoteName: "Solo Quote", slug: "solo" });
    const config = (await (await get(env, `/lg/config/${seeded.variantId}`)).json()) as {
      assignment_reason: string;
      funnel_ab_test_id: string;
      funnel_ab_test_revision: number;
    };
    expect(config.assignment_reason).toBe("single_control");
    expect(config.funnel_ab_test_id).toBe("");
    expect(config.funnel_ab_test_revision).toBe(0);
    // shell serves the control variant with a single_control injected assignment.
    const html = await (await get(env, "/lg/solo", { Cookie: "ko_sid=whatever" })).text();
    expect(shellVariantId(html)).toBe(seeded.variantId);
    const assign = parseInjectedAssignment(html);
    expect(assign!["assignment_reason"]).toBe("single_control");
    expect(assign!["assignment_bucket"]).toBeNull();
  });

  // m1 — a per-session datum must not ride a `public` (cacheable-shell) response.
  // The shell injects the NON-session §16.3 dims but assignment_bucket is null even
  // on the ab_hash path; the P11 beacon recomputes the bucket from its OWN ko_sid +
  // the injected funnel_ab_test_id/revision. FAILS pre-fix (the shell emitted the
  // server-computed per-session bucket) — the /lg/config primary cache is unchanged.
  it("m1: the public shell injects the NON-session dims with assignment_bucket:null; /lg/config still carries the §16.3 constants", async () => {
    const { sdb, env } = newHarness();
    const seed = await seedRunning2VariantTest(env, sdb, { quoteName: "m1 Quote", slug: "m1" });
    const sid = "m1-session-x";
    const served = expectedVariantFor(seed, sid);
    const servedArm = seed.arms.find((a) => a.public_id === served)!;
    // the bucket the P11 client RECOMPUTES from its own ko_sid + the injected test
    // id/revision — a valid 0..9999 value the shell deliberately does NOT emit.
    const recomputable = expectedBucketFor(seed, sid);
    expect(recomputable).toBeGreaterThanOrEqual(0);
    expect(recomputable).toBeLessThan(10000);

    const html = await (await get(env, "/lg/m1", { Cookie: `ko_sid=${sid}` })).text();
    expect(shellVariantId(html)).toBe(served);
    const assign = parseInjectedAssignment(html);
    expect(assign, "assignment injected").not.toBeNull();
    // RED LINE (m1): assignment_bucket is null on the public shell, even on ab_hash.
    expect(assign!["assignment_bucket"], "per-session bucket must NOT ride the public shell").toBeNull();
    // the NON-session dims ARE present (P11 needs them to recompute the bucket).
    expect(assign!["funnel_ab_test_id"]).toBe(seed.testId);
    expect(assign!["funnel_ab_test_revision"]).toBe(seed.revision);
    expect(assign!["variant_label"]).toBe(servedArm.variant_label);
    expect(assign!["assignment_reason"]).toBe("ab_hash");
    expect(assign!["funnel_variant_id"]).toBe(served);

    // the /lg/config primary cache STILL carries the §16.3 constants (variant/test-
    // scoped, cacheable) and STILL carries no per-session bucket.
    const config = JSON.parse(await (await get(env, `/lg/config/${served}`)).text()) as Record<string, unknown>;
    expect(config["funnel_ab_test_id"]).toBe(seed.testId);
    expect(config["funnel_ab_test_revision"]).toBe(seed.revision);
    expect(config["variant_label"]).toBe(servedArm.variant_label);
    expect(config["assignment_reason"]).toBe("ab_hash");
    expect(Object.prototype.hasOwnProperty.call(config, "assignment_bucket")).toBe(false);
  });
});

// ===========================================================================
// Fix-contract v2.4 03 §3.2 / §3.11 — the SERVER-RENDERED shell (11 §11.6:
// these flip the old "empty mount" false-comfort boundary; may never be waived)
// ===========================================================================

// Extract + parse the baked #lg-config JSON blob from the shell HTML.
function parseInlineConfig(html: string): Record<string, unknown> | null {
  const m = html.match(/<script type="application\/json" id="lg-config">(.*?)<\/script>/s);
  if (m === null) return null;
  return JSON.parse(m[1] ?? "null") as Record<string, unknown>;
}

// Decode the v2 token's signed payload (base64url JSON — segment 1).
function decodeTokenPayload(token: string): Record<string, unknown> {
  const seg = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(seg, "base64url").toString("utf8")) as Record<string, unknown>;
}

// A second-section body distinct from the default (a dropdown question).
const SECOND_SECTION_JSON = JSON.stringify({
  components: [
    {
      type: "DropdownQuestion",
      question_id: "q2",
      question_key: "k2",
      internal_field: "insurer",
      answer_type: "enum",
      choices: [
        { label: "Acme", value: "acme", analytics_id: "ins_acme" },
        { label: "Globex", value: "globex", analytics_id: "ins_globex" },
      ],
    },
    { type: "ContinueButton", question_id: "c2", props: { label: "Continue" } },
  ],
});

// Seed a quote whose control variant carries TWO ordered sections, activated
// on site-1 (the §3.2a in-order render + first-visible proof needs >1).
async function seedActivatedFunnelTwoSections(
  env: Env,
  sdb: SqliteDb,
  opts: { quoteName: string; slug: string },
): Promise<SeededFunnel & { sectionIds: string[] }> {
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
  const s1 = seedSection(sdb, { activity: "quote_funnel", vertical: "life" });
  const s2 = seedSection(sdb, { activity: "quote_funnel", vertical: "life", contentJson: SECOND_SECTION_JSON });
  const putRes = await admin.request(
    `${API}/variants/${variantId}`,
    jsonInit("PUT", { sections: [{ section_id: s1.id }, { section_id: s2.id }] }),
    env,
  );
  expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);
  const actRes = await admin.request(
    `${API}/quotes/${quote.public_id}/activation/site-1`,
    jsonInit("PUT", { enabled: true, slug: opts.slug }),
    env,
  );
  expect(actRes.status, `activate: ${await actRes.clone().text()}`).toBe(200);
  return {
    quotePublicId: quote.public_id,
    funnelId,
    variantId,
    slug: opts.slug,
    sectionIds: [s1.public_id, s2.public_id],
  };
}

describeDb("v2.4 03 §3.2/§3.11 — server-rendered sections + #lg-config + runtime tag (11 §11.6)", () => {
  it("renders EVERY section in order (§3.2a): first VISIBLE with real question markup (no-JS correct), rest hidden", async () => {
    const { sdb, env } = newHarness();
    const seeded = await seedActivatedFunnelTwoSections(env, sdb, { quoteName: "Shell Quote", slug: "shell" });

    const html = await (await get(env, "/lg/shell")).text();

    // the EXACT §3.2 wrapper vocabulary, in section order.
    const sec0 = html.match(
      /<section data-lg-section data-lg-section-id="([^"]+)" data-lg-index="0" data-screen-label="([^"]+)"([^>]*)>/,
    );
    const sec1 = html.match(
      /<section data-lg-section data-lg-section-id="([^"]+)" data-lg-index="1" data-screen-label="([^"]+)"([^>]*)>/,
    );
    expect(sec0, "first section wrapper").not.toBeNull();
    expect(sec1, "second section wrapper").not.toBeNull();
    expect(sec0![1]).toBe(seeded.sectionIds[0]);
    expect(sec1![1]).toBe(seeded.sectionIds[1]);
    // {i+1:02d} · {headline} labels.
    expect(sec0![2]!.startsWith("01 · ")).toBe(true);
    expect(sec1![2]!.startsWith("02 · ")).toBe(true);
    // FIRST section not hidden (03 §3.11 — visible without JS); the rest hidden.
    expect(sec0![3]).not.toContain("hidden");
    expect(sec1![3]).toContain("hidden");
    // the sections live INSIDE the data-lg-mount main.
    expect(html.indexOf("data-lg-mount")).toBeLessThan(html.indexOf("data-lg-section"));
    // 11 §11.6: real question markup exists (never an empty mount) — the first
    // section's TwoButtonYesNo renders as an answer group with lg choices.
    expect(html).toContain("data-lg-question");
    expect(html).toContain('data-lg-choice="true"');
    // the second section's dropdown rendered too (ALL sections server-render).
    expect(html).toContain('data-lg-choice="acme"');
    // the [data-lg-banners] auction mount rides after the sections, hidden.
    const bannersAt = html.indexOf("data-lg-banners");
    expect(bannersAt).toBeGreaterThan(html.indexOf('data-lg-index="1"'));
    expect(html.slice(bannersAt - 60, bannersAt + 60)).toContain("hidden");
  });

  it("bakes #lg-config = the SAME LeadgenPublicConfig JSON /lg/config serves (§3.2b), runtime tag (§3.2c), no pre-set ready", async () => {
    const { sdb, env } = newHarness();
    await seedActivatedFunnelTwoSections(env, sdb, { quoteName: "Cfg Shell Quote", slug: "cfgshell" });

    const html = await (await get(env, "/lg/cfgshell")).text();
    const inline = parseInlineConfig(html);
    expect(inline, "#lg-config parses").not.toBeNull();

    const variantId = inline!["funnel_variant_id"] as string;
    const overHttp = (await (await get(env, `/lg/config/${variantId}`)).json()) as Record<string, unknown>;
    // §3.2b: the SAME DTO — deep equality, not just same identity fields.
    expect(inline).toEqual(overHttp);

    // §3.2c: the versioned hydration-engine tag (route lands in its own slice).
    expect(html).toContain('<script src="/lg/runtime/3.js" defer></script>');
    // the shell must NOT pre-set readiness — the ENGINE sets data-lg-ready="1".
    expect(html).not.toContain('data-lg-ready="1"');
    // the pre-hydration stub only QUEUES clicks (no fetch, no bootstrap).
    expect(html).toContain("__LG_PREHYDRATE_QUEUE__");
    expect(html).toContain("[data-lg-choice],[data-lg-continue]");
    expect(html).not.toContain("__LG_BOOTSTRAP__");
    expect(html).not.toContain("lg:bootstrap");
  });

  it("the KV-cached shell body is BYTE-IDENTICAL across two different visitors (sentinel discipline preserved)", async () => {
    const { sdb, env, store } = newHarness();
    await seedActivatedFunnel(env, sdb, { quoteName: "Invariant Quote", slug: "inv" });

    const res1 = await get(env, "/lg/inv", { Cookie: "ko_sid=visitor-one" });
    expect(res1.status).toBe(200);
    const cachedAfterFirst = [...store.entries()].filter(([k]) => k.startsWith("lg-shell:"));
    expect(cachedAfterFirst.length).toBe(1);
    const bodyAfterFirst = cachedAfterFirst[0]![1].value;

    const res2 = await get(env, "/lg/inv", { Cookie: "ko_sid=visitor-two" });
    expect(res2.status).toBe(200);
    const cachedAfterSecond = [...store.entries()].filter(([k]) => k.startsWith("lg-shell:"));
    expect(cachedAfterSecond.length).toBe(1);
    // byte-identical pristine body across visitors.
    expect(cachedAfterSecond[0]![1].value).toBe(bodyAfterFirst);

    // the pristine body carries the SENTINELS, never the per-visitor splices…
    expect(bodyAfterFirst).toContain("<!--LG_MAPS_KEY-->");
    expect(bodyAfterFirst).toContain("<!--LG_ASSIGN-->");
    expect(bodyAfterFirst).not.toContain("window.__LG_ASSIGNMENT__");
    // …while each RESPONSE carries the spliced assignment (and no sentinel).
    for (const res of [res1, res2]) {
      const html = await res.text();
      expect(html).toContain("window.__LG_ASSIGNMENT__");
      expect(html).not.toContain("<!--LG_ASSIGN-->");
    }
    // …and the baked #lg-config IS in the pristine cached body (visitor-invariant).
    expect(bodyAfterFirst).toContain('id="lg-config"');

    // the shell key carries the ab_rev axis: …:{content_version}:{ab_rev}:{template}:{activation}.
    const key = cachedAfterSecond[0]![0];
    const segs = key.split(":");
    const servedContentVersion = bodyAfterFirst.match(/data-content-version="(\d+)"/)?.[1];
    expect(segs[5]).toBe(servedContentVersion); // content_version segment matches the served variant
    expect(segs[6]).toBe("0"); // ab_rev — single_control
    expect(segs[7]).toBe("3"); // LEADGEN_TEMPLATE_VERSION (v3 since the v2.5 redesign engine deltas)
  });
});

describeDb("v2.4 03 §3.2 — the SHELL never goes stale across an A/B start (ab_rev key+etag axis)", () => {
  it("a start (rev bump) mints a NEW shell key + ETag and serves the ab_hash dims in #lg-config (not the stale single_control body)", async () => {
    const { sdb, env, store } = newHarness();
    const seeded = await seedActivatedFunnel(env, sdb, { quoteName: "ShellM1 Quote", slug: "m1shell" });

    // 1) BEFORE any test: the shell caches at the ab_rev=0 key with the
    // single_control dims BAKED into #lg-config.
    const before = await get(env, "/lg/m1shell", { Cookie: "ko_sid=m1-shell-sid" });
    const etagBefore = before.headers.get("ETag") ?? "";
    const cfgBefore = parseInlineConfig(await before.text());
    expect(cfgBefore!["assignment_reason"]).toBe("single_control");
    expect(cfgBefore!["funnel_ab_test_revision"]).toBe(0);
    expect([...store.keys()].filter((k) => k.startsWith("lg-shell:")).length).toBe(1);

    // 2) create + start a test on THAT funnel (lone control at bp 10000 →
    // Σ==10000 → running). Start bumps the test revision but NOT the variant's
    // content_version — ONLY ab_rev distinguishes the shell cache identity.
    const create = await admin.request(`${API}/quotes/${seeded.quotePublicId}/experiments`, jsonInit("POST", {}), env);
    expect(create.status, `create ab: ${await create.clone().text()}`).toBe(201);
    const ab = (await create.json()) as { public_id: string };
    const startRes = await admin.request(`${API}/experiments/${ab.public_id}/start`, { method: "POST" }, env);
    expect(startRes.status, `start: ${await startRes.clone().text()}`).toBe(200);
    const started = (await startRes.json()) as { public_id: string; revision: number; status: string };
    expect(started.status).toBe("running");

    // 3) the SAME visitor re-fetches: fresh ETag, fresh key, ab_hash dims baked.
    const after = await get(env, "/lg/m1shell", { Cookie: "ko_sid=m1-shell-sid" });
    const etagAfter = after.headers.get("ETag") ?? "";
    expect(etagAfter, "a start MUST mint a fresh shell ETag (no 304-loop on stale dims)").not.toBe(etagBefore);
    const cfgAfter = parseInlineConfig(await after.text());
    expect(cfgAfter!["assignment_reason"], "the baked dims must flip — never the stale single_control body").toBe("ab_hash");
    expect(cfgAfter!["funnel_ab_test_id"]).toBe(started.public_id);
    expect(cfgAfter!["funnel_ab_test_revision"]).toBe(started.revision);
    // two DISTINCT cached shells now exist (rev-0 orphaned, rev-N live).
    expect([...store.keys()].filter((k) => k.startsWith("lg-shell:")).length).toBe(2);

    // 4) conditional-GET with the STALE etag must NOT 304 (the etag mirrors the key).
    const conditional = await get(env, "/lg/m1shell", { Cookie: "ko_sid=m1-shell-sid", "If-None-Match": etagBefore });
    expect(conditional.status).toBe(200);
  });
});

// ===========================================================================
// v2.4 03 §3.8 / 05 §5.4 (R6) — answer_mapping_version populated end-to-end +
// the config↔token coherence invariant
// ===========================================================================

describeDb("R6 — answer_mapping_version populated from leadgen_section_answer_maps (v2.4 03 §3.8)", () => {
  // Minimal FK-satisfying offer + active schema + answer-map rows, seeded via
  // direct SQL (the admin mapping flow is exercised in leadgen-sections tests;
  // here we prove the RESOLVE-TIME read).
  function seedAnswerMapRows(sdb: SqliteDb, sectionPublicId: string, rowCount: number): number {
    sdb
      .prepare(
        "INSERT INTO leadgen_offers (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type) VALUES (?, 'Offer X', 'quote_funnel', 'life', 's2s_postback', 'cpl')",
      )
      .run(mintPublicId("offer"));
    const offerId = (sdb.prepare("SELECT id FROM leadgen_offers ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
    const schemaPublicId = mintPublicId("payload_schema_version");
    sdb
      .prepare(
        "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json) VALUES (?, ?, 1, '{}')",
      )
      .run(schemaPublicId, offerId);
    const schemaId = (sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
    for (let i = 0; i < rowCount; i++) {
      sdb
        .prepare(
          `INSERT INTO leadgen_section_answer_maps
             (public_id, section_id, question_id, question_key, internal_field, answer_type,
              offer_id, payload_schema_id, payload_schema_public_id, offer_payload_field_path, provider_expected_type)
           VALUES (?, (SELECT id FROM leadgen_sections WHERE public_id = ?), 'q1', 'k', 'f', 'boolean', ?, ?, ?, ?, 'string')`,
        )
        .run(mintPublicId("answer_field_map"), sectionPublicId, offerId, schemaId, schemaPublicId, `field_${i}`);
    }
    const max = sdb
      .prepare(
        "SELECT COALESCE(MAX(id), 0) AS v FROM leadgen_section_answer_maps WHERE section_id = (SELECT id FROM leadgen_sections WHERE public_id = ?)",
      )
      .get(sectionPublicId) as { v: number };
    return max.v;
  }

  it("/lg/config carries String(MAX(id)) per mapped section; '0' for an unmapped section; and the SAME values ride the shell's #lg-config", async () => {
    const { sdb, env } = newHarness();
    const seeded = await seedActivatedFunnelTwoSections(env, sdb, { quoteName: "R6 Quote", slug: "r6" });
    // map ONLY the first section (3 rows) — the second stays unmapped.
    const maxId = seedAnswerMapRows(sdb, seeded.sectionIds[0]!, 3);
    expect(maxId).toBeGreaterThan(0);

    const config = (await (await get(env, `/lg/config/${seeded.variantId}`)).json()) as {
      sections: Array<{ section_public_id: string; answer_mapping_version: string }>;
    };
    expect(config.sections[0]?.answer_mapping_version).toBe(String(maxId));
    expect(config.sections[1]?.answer_mapping_version).toBe("0");

    // the shell bakes the SAME populated values (one buildPublicConfig source).
    const html = await (await get(env, "/lg/r6")).text();
    const inline = parseInlineConfig(html) as {
      sections: Array<{ answer_mapping_version: string }>;
    } | null;
    expect(inline?.sections[0]?.answer_mapping_version).toBe(String(maxId));
    expect(inline?.sections[1]?.answer_mapping_version).toBe("0");
  });

  it("COHERENCE: sha256 over the config's ordered answer_mapping_versions == the v2 token's answer_mapping_hash (05 §5.3)", async () => {
    const { sdb, env } = newHarness();
    const seeded = await seedActivatedFunnelTwoSections(env, sdb, { quoteName: "Coherence Quote", slug: "coh" });
    seedAnswerMapRows(sdb, seeded.sectionIds[0]!, 2);

    const config = (await (await get(env, `/lg/config/${seeded.variantId}`)).json()) as {
      sections: Array<{ answer_mapping_version: string }>;
    };
    const attempt = (await (await get(env, `/lg/attempt?funnel_variant_id=${seeded.variantId}`)).json()) as {
      signed_config_token: string;
    };
    const payload = decodeTokenPayload(attempt.signed_config_token);
    const recomputed = sha256Hex(JSON.stringify(config.sections.map((s) => s.answer_mapping_version)));
    expect(payload["answer_mapping_hash"], "config and token must agree on the mapping generation").toBe(recomputed);
  });
});

describeDb("v2.4 03 §3.2d — the Maps key also injects for a ZIP-validate funnel (no address section)", () => {
  it("a funnel whose ONLY Maps signal is ZIPInputQuestion validate:true gets the key splice; the cached body stays key-free", async () => {
    const { sdb, env, store } = newHarness();
    const zipJson = JSON.stringify({
      components: [
        { type: "ZIPInputQuestion", question_id: "q_zip", question_key: "zip", internal_field: "zip", props: { validate: true } },
      ],
    });
    await seedActivatedFunnel(env, sdb, {
      quoteName: "Zip Quote",
      slug: "zip",
      sectionContentJson: zipJson,
      addressValidation: false,
    });

    const html = await (await get(env, "/lg/zip")).text();
    expect(html).toContain("window.__LG_MAPS_KEY__");
    expect(html).toContain(MAPS_BROWSER_KEY);
    // the rendered ZIP input carries its §3.3 Maps hook in the same body.
    expect(html).toContain("data-lg-maps=");
    // cached body: sentinel only, never the key.
    for (const [k, entry] of store.entries()) {
      if (!k.startsWith("lg-shell:")) continue;
      expect(entry.value).not.toContain(MAPS_BROWSER_KEY);
      expect(entry.value).toContain("<!--LG_MAPS_KEY-->");
    }
  });
});

// v3.1 §9.3 — the NEW {enabled,jobs} shape's per-field precedence in the
// KEY-INJECTION gate (funnelNeedsMapsKey), mirroring presets.ts's renderer.
// Regression: before this phase, ANY object-shaped props.maps (new or
// legacy) counted as "needs the key" unconditionally — an explicit
// maps.enabled:false must now suppress it for that field.
describeDb("v3.1 §9.3 — funnelNeedsMapsKey respects an explicit maps.enabled:false (no key injected)", () => {
  it("a funnel whose ONLY Maps signal is a ZIP with maps.enabled:false gets NO key splice", async () => {
    const { sdb, env } = newHarness();
    const zipJson = JSON.stringify({
      components: [
        {
          type: "ZIPInputQuestion",
          question_id: "q_zip",
          question_key: "zip",
          internal_field: "zip",
          props: { maps: { enabled: false, jobs: { validate: false, auction: false, autocomplete: false } } },
        },
      ],
    });
    await seedActivatedFunnel(env, sdb, {
      quoteName: "Zip Off Quote",
      slug: "zip-off",
      sectionContentJson: zipJson,
      addressValidation: false,
    });

    const html = await (await get(env, "/lg/zip-off")).text();
    expect(html).not.toContain("window.__LG_MAPS_KEY__");
    expect(html).not.toContain("data-lg-maps");
  });

  it("a funnel whose ONLY Maps signal is a ZIP with maps.enabled:true (new shape) DOES get the key splice", async () => {
    const { sdb, env } = newHarness();
    const zipJson = JSON.stringify({
      components: [
        {
          type: "ZIPInputQuestion",
          question_id: "q_zip",
          question_key: "zip",
          internal_field: "zip",
          props: { maps: { enabled: true, jobs: { validate: true, auction: false, autocomplete: false } } },
        },
      ],
    });
    await seedActivatedFunnel(env, sdb, {
      quoteName: "Zip On Quote",
      slug: "zip-on",
      sectionContentJson: zipJson,
      addressValidation: false,
    });

    const html = await (await get(env, "/lg/zip-on")).text();
    expect(html).toContain("window.__LG_MAPS_KEY__");
    expect(html).toContain("data-lg-maps=");
  });
});

describeDb("M1 — /lg/config never goes stale across a test start (ab_rev cache axis, §16.2)", () => {
  it("the control variant's config flips single_control → ab_hash after a start (NOT the stale cached body)", async () => {
    const { sdb, env } = newHarness();
    const seeded = await seedActivatedFunnel(env, sdb, { quoteName: "M1 Quote", slug: "m1cfg" });

    // 1) BEFORE any test: config is single_control (revision 0) — and is now CACHED
    // at the ab_rev=0 key.
    const before = JSON.parse(await (await get(env, `/lg/config/${seeded.variantId}`)).text()) as {
      assignment_reason: string;
      funnel_ab_test_id: string;
      funnel_ab_test_revision: number;
    };
    expect(before.assignment_reason).toBe("single_control");
    expect(before.funnel_ab_test_id).toBe("");
    expect(before.funnel_ab_test_revision).toBe(0);

    // 2) create + start a test on THAT funnel. The lone control is at bp 10000 →
    // Σ==10000 → start succeeds, bumps the test revision, flips it to running. start
    // does NOT touch the variant's content_version (so ONLY ab_rev distinguishes the
    // cache identity — the whole point of M1).
    const create = await admin.request(`${API}/quotes/${seeded.quotePublicId}/experiments`, jsonInit("POST", {}), env);
    expect(create.status, `create ab: ${await create.clone().text()}`).toBe(201);
    const ab = (await create.json()) as { public_id: string };
    const startRes = await admin.request(`${API}/experiments/${ab.public_id}/start`, { method: "POST" }, env);
    expect(startRes.status, `start: ${await startRes.clone().text()}`).toBe(200);
    const started = (await startRes.json()) as { public_id: string; revision: number; status: string };
    expect(started.status).toBe("running");

    // 3) fetch the SAME control variant's config again → it now reflects the running
    // test (ab_hash + the started test id/revision), NOT the stale single_control body.
    const after = JSON.parse(await (await get(env, `/lg/config/${seeded.variantId}`)).text()) as {
      assignment_reason: string;
      funnel_ab_test_id: string;
      funnel_ab_test_revision: number;
    };
    expect(after.assignment_reason, "config must NOT serve the stale single_control body after a start").toBe("ab_hash");
    expect(after.funnel_ab_test_id).toBe(started.public_id);
    expect(after.funnel_ab_test_revision).toBe(started.revision);
  });
});
