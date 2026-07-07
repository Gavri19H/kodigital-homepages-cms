// LeadGen §25 provider postback — POST/GET /lg/pb/:provider (contract 08 §25/§26
// + 09 §29/§30). Direct-ingest unit tests (node:sqlite DB + Map-KV + injected CH
// client / S2S fetch for full control of the CH-matched + S2S paths) PLUS a few
// MOUNTED tests over the real index.ts app (tenant host) that prove the route is
// registered before /lg/:quote_slug, the §30.4 guard runs first, and no-store.
// Proves: absent secret → 401; wrong token → 401; correct+new → 200 + revenue_raw
// (CH-matched) or the §29 unmatched queue (CH absent); a replay is an idempotent
// 200 no 2nd row; CPL books on conversion / CPC-default does NOT book on a click;
// S2S fires once on a CH-matched conversion; malformed body → 400 not 500; POST +
// GET both; no-store.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
import type { Env } from "../src/env";
import { ingestProviderPostback } from "../src/public/leadgen/postback";
import { decideBooking } from "../src/leadgen/revenue-ingest";
import type { LeadgenChClient } from "../src/leadgen/clickhouse";

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

function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

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

function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
] as const;
const TENANT_ORIGIN = "http://one.example.com";
const ADMIN_HOST = "cms.kodigital.app";

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','one.example.com','life','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','one.example.com','active');",
  );
  for (const file of MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
}

// token defaults to present; token:null → the secret is absent (401 path).
function buildEnv(db: D1Database, kv: KVNamespace, opts: { token?: string | null; blocklist?: string } = {}): Env {
  const env = {
    DB: db,
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST,
    ADMIN_BASE_URL: `https://${ADMIN_HOST}`,
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "300",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
  } as unknown as Record<string, unknown>;
  if (opts.token !== null) env.LEADGEN_PB_TOKEN_TESTPROV = opts.token ?? "pb-secret";
  if (opts.blocklist !== undefined) env.LEADGEN_BLOCKLIST = opts.blocklist;
  return env as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

interface Harness {
  sdb: SqliteDb;
  env: Env;
}
function newHarness(opts: { token?: string | null; blocklist?: string } = {}): Harness {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), makeKv(), opts) };
}

// waitUntil capture (the S2S fire rides ctx.waitUntil).
function captureCtx(): { ctx: ExecutionContext; promises: Promise<unknown>[] } {
  const promises: Promise<unknown>[] = [];
  return {
    promises,
    ctx: {
      waitUntil(p: Promise<unknown>) {
        promises.push(Promise.resolve(p).catch(() => undefined));
      },
      passThroughOnException() {},
    } as unknown as ExecutionContext,
  };
}
async function settle(c: { promises: Promise<unknown>[] }): Promise<void> {
  await Promise.all(c.promises.map((p) => p.catch(() => undefined)));
  await Promise.all(c.promises.map((p) => p.catch(() => undefined)));
}

// A CH client that resolves the click context (traffic_source + session fbclid) —
// makes resolveClickContextFromCh return a matched context without live CH.
function fakeChClient(trafficSource = "facebook"): LeadgenChClient {
  return {
    configured: true,
    async query<T>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("offer_click")) {
        return { rows: [{ traffic_source: trafficSource, session_id: "sess-1", offer_id: "lgo_x" }] as unknown as T[] };
      }
      if (sql.includes("lg_sessions")) {
        return { rows: [{ fbc: "", fbclid: "fbclid-1" }] as unknown as T[] };
      }
      return { rows: [] };
    },
  } as unknown as LeadgenChClient;
}

function makeS2sFetch(): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(input instanceof Request ? input.url : String(input));
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function seedOffer(sdb: SqliteDb, publicId: string, offerType: "cpc" | "cpl" | "cpa" | "cpi"): void {
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, banner_url_template,
          cap_enabled, cap_amount, cap_timezone, cap_count_by, status)
       VALUES (?, 'Offer', 'Prov', 'quote_funnel', 'life', 's2s_postback', ?, 0, 'static', 'server', NULL, 0, 100, 'UTC', 'clicks', 'active')`,
    )
    .run(publicId, offerType);
}

function seedEnabledFacebookPlatform(sdb: SqliteDb): void {
  sdb
    .prepare(
      `INSERT INTO leadgen_media_platforms (platform, enabled, postback_url_template, auth_secret_ref, event_name, value_multiplier)
       VALUES ('facebook', 1, 'https://s2s.example.com/tr?cid={click_id}&v={value}&cur={currency}', NULL, 'Purchase', 1)`,
    )
    .run();
}

function countRows(sdb: SqliteDb, table: string): number {
  const r = sdb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return r.n;
}

function postReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${TENANT_ORIGIN}/lg/pb/testprov`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function goodBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    external_txn_id: "txn-1",
    click_id: "lgl_click_1",
    offer_public_id: "lgo_x",
    revenue: 12.5,
    currency: "USD",
    ...overrides,
  };
}

// ===========================================================================
// Direct-ingest unit tests
// ===========================================================================

describeDb("ingestProviderPostback — token gate (§30.2)", () => {
  it("absent per-provider secret ⇒ 401 (no-store)", async () => {
    const { env } = newHarness({ token: null });
    const cap = captureCtx();
    const res = await ingestProviderPostback(env, cap.ctx, "testprov", postReq(goodBody(), { "X-Postback-Token": "pb-secret" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("wrong token ⇒ 401", async () => {
    const { env } = newHarness();
    const cap = captureCtx();
    const res = await ingestProviderPostback(env, cap.ctx, "testprov", postReq(goodBody(), { "X-Postback-Token": "WRONG" }));
    expect(res.status).toBe(401);
  });

  it("no token presented ⇒ 401", async () => {
    const { env } = newHarness();
    const cap = captureCtx();
    const res = await ingestProviderPostback(env, cap.ctx, "testprov", postReq(goodBody()));
    expect(res.status).toBe(401);
  });
});

describeDb("ingestProviderPostback — booking + attribution (§25/§29)", () => {
  it("correct + new txn, CH-matched ⇒ 200 + a leadgen_revenue_raw row (source s2s_postback), NO unmatched row", async () => {
    const { sdb, env } = newHarness();
    seedOffer(sdb, "lgo_x", "cpl");
    const cap = captureCtx();
    const res = await ingestProviderPostback(env, cap.ctx, "testprov", postReq(goodBody(), { "X-Postback-Token": "pb-secret" }), {
      chClient: fakeChClient(),
    });
    await settle(cap);
    expect(res.status).toBe(200);
    expect(countRows(sdb, "leadgen_revenue_raw")).toBe(1);
    expect(countRows(sdb, "leadgen_revenue_unmatched")).toBe(0);
    const row = sdb.prepare("SELECT source, booking_trigger, click_id FROM leadgen_revenue_raw LIMIT 1").get() as {
      source: string;
      booking_trigger: string;
      click_id: string;
    };
    expect(row.source).toBe("s2s_postback");
    expect(row.booking_trigger).toBe("conversion");
    expect(row.click_id).toBe("lgl_click_1");
  });

  it("correct + new txn, CH ABSENT ⇒ 200 + a §29 unmatched pending row, NO revenue_raw", async () => {
    const { sdb, env } = newHarness();
    seedOffer(sdb, "lgo_x", "cpl");
    const cap = captureCtx();
    const res = await ingestProviderPostback(env, cap.ctx, "testprov", postReq(goodBody(), { "X-Postback-Token": "pb-secret" }));
    await settle(cap);
    expect(res.status).toBe(200);
    expect(countRows(sdb, "leadgen_revenue_raw")).toBe(0);
    expect(countRows(sdb, "leadgen_revenue_unmatched")).toBe(1);
    const row = sdb.prepare("SELECT status, click_id FROM leadgen_revenue_unmatched LIMIT 1").get() as { status: string; click_id: string };
    expect(row.status).toBe("pending");
    expect(row.click_id).toBe("lgl_click_1");
  });

  it("replay (same provider, external_txn_id) ⇒ 200 idempotent, NO 2nd row", async () => {
    const { sdb, env } = newHarness();
    seedOffer(sdb, "lgo_x", "cpl");
    const cap = captureCtx();
    const first = await ingestProviderPostback(env, cap.ctx, "testprov", postReq(goodBody(), { "X-Postback-Token": "pb-secret" }));
    expect(first.status).toBe(200);
    const second = await ingestProviderPostback(env, cap.ctx, "testprov", postReq(goodBody(), { "X-Postback-Token": "pb-secret" }));
    await settle(cap);
    expect(second.status).toBe(200);
    const dup = (await second.json()) as { status: string };
    expect(dup.status).toBe("duplicate");
    // recordPostbackLog UNIQUE(provider, external_txn_id) blocked the 2nd write.
    expect(countRows(sdb, "leadgen_revenue_unmatched")).toBe(1);
    expect(countRows(sdb, "leadgen_postback_log")).toBe(1);
  });

  it("a CPL conversion books; decideBooking proves a CPC-default click does NOT book (§25)", async () => {
    const { sdb, env } = newHarness();
    seedOffer(sdb, "lgo_cpl", "cpl");
    const cap = captureCtx();
    const res = await ingestProviderPostback(
      env,
      cap.ctx,
      "testprov",
      postReq(goodBody({ external_txn_id: "txn-cpl", offer_public_id: "lgo_cpl" }), { "X-Postback-Token": "pb-secret" }),
    );
    await settle(cap);
    expect(res.status).toBe(200);
    expect(countRows(sdb, "leadgen_revenue_unmatched")).toBe(1); // CPL conversion booked

    // §25: a CPC Offer NOT explicitly click-booked never books on a click signal.
    expect(decideBooking({ offer_type: "cpc", signal: "click", source: "s2s_postback" }).book).toBe(false);
    // …but the same CPC Offer books on a conversion signal.
    expect(decideBooking({ offer_type: "cpc", signal: "conversion", source: "s2s_postback" }).book).toBe(true);
  });
});

describeDb("ingestProviderPostback — §26 S2S dispatch on a CH-matched conversion", () => {
  it("fires exactly one outbound S2S pixel to the matched (enabled) platform", async () => {
    const { sdb, env } = newHarness();
    seedOffer(sdb, "lgo_x", "cpl");
    seedEnabledFacebookPlatform(sdb);
    const cap = captureCtx();
    const s2s = makeS2sFetch();
    const res = await ingestProviderPostback(
      env,
      cap.ctx,
      "testprov",
      postReq(goodBody(), { "X-Postback-Token": "pb-secret" }),
      { chClient: fakeChClient("facebook"), s2sFetch: s2s.fetch },
    );
    await settle(cap);
    expect(res.status).toBe(200);
    expect(countRows(sdb, "leadgen_revenue_raw")).toBe(1);
    expect(s2s.calls).toHaveLength(1);
    expect(s2s.calls[0]).toContain("s2s.example.com");
    expect(s2s.calls[0]).toContain("cid=lgl_click_1");
  });
});

describeDb("ingestProviderPostback — payload + method handling (§24)", () => {
  it("malformed JSON body ⇒ 400, never a 500 / throw", async () => {
    const { env } = newHarness();
    const cap = captureCtx();
    const res = await ingestProviderPostback(env, cap.ctx, "testprov", postReq("{not valid json", { "X-Postback-Token": "pb-secret" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("a missing required field (external_txn_id) ⇒ 400 (field names only)", async () => {
    const { env } = newHarness();
    const cap = captureCtx();
    const res = await ingestProviderPostback(
      env,
      cap.ctx,
      "testprov",
      postReq(goodBody({ external_txn_id: "" }), { "X-Postback-Token": "pb-secret" }),
    );
    expect(res.status).toBe(400);
  });

  it("GET with query params (token via ?token=) ⇒ 200 + unmatched row", async () => {
    const { sdb, env } = newHarness();
    seedOffer(sdb, "lgo_x", "cpl");
    const cap = captureCtx();
    const url = `${TENANT_ORIGIN}/lg/pb/testprov?token=pb-secret&external_txn_id=txn-get&click_id=lgl_get_1&offer_public_id=lgo_x&revenue=5&currency=USD`;
    const res = await ingestProviderPostback(env, cap.ctx, "testprov", new Request(url, { method: "GET" }));
    await settle(cap);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(countRows(sdb, "leadgen_revenue_unmatched")).toBe(1);
  });
});

// ===========================================================================
// MOUNTED route tests (real app, tenant host) — wiring / mount-order / guard
// ===========================================================================

describeDb("POST/GET /lg/pb/:provider — mounted (§4.3 no-store, guard, mount order)", () => {
  it("correct + new txn over the mounted route ⇒ 200 + no-store + a §29 unmatched row (CH absent)", async () => {
    const { sdb, env } = newHarness();
    seedOffer(sdb, "lgo_x", "cpl");
    const res = await app.request(
      `${TENANT_ORIGIN}/lg/pb/testprov`,
      { method: "POST", headers: { "content-type": "application/json", "X-Postback-Token": "pb-secret" }, body: JSON.stringify(goodBody()) },
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(countRows(sdb, "leadgen_revenue_unmatched")).toBe(1);
  });

  it("registered BEFORE /lg/:quote_slug: a no-token /lg/pb/testprov reaches the postback handler (401), not the slug shell", async () => {
    const { env } = newHarness();
    const res = await app.request(`${TENANT_ORIGIN}/lg/pb/testprov`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }, env);
    expect(res.status).toBe(401); // the postback handler's token gate — not a funnel 404
  });

  it("§30.4 guard runs FIRST: a blocklisted IP ⇒ 403 no-store, no money write", async () => {
    const { sdb, env } = newHarness({ blocklist: "203.0.113.9" });
    seedOffer(sdb, "lgo_x", "cpl");
    const res = await app.request(
      `${TENANT_ORIGIN}/lg/pb/testprov`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "X-Postback-Token": "pb-secret", "CF-Connecting-IP": "203.0.113.9" },
        body: JSON.stringify(goodBody()),
      },
      env,
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(countRows(sdb, "leadgen_revenue_unmatched")).toBe(0); // guard blocked before ingest
    expect(countRows(sdb, "leadgen_postback_log")).toBe(0);
  });

  it("the ADMIN host ⇒ 404 (tenant-host only, via the /lg mount middleware)", async () => {
    const { env } = newHarness();
    const res = await app.request(
      `http://${ADMIN_HOST}/lg/pb/testprov`,
      { method: "POST", headers: { "content-type": "application/json", "X-Postback-Token": "pb-secret" }, body: JSON.stringify(goodBody()) },
      env,
    );
    expect(res.status).toBe(404);
  });
});
