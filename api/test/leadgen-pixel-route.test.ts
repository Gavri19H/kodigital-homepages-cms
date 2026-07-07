// LeadGen §27 browser-side pixel — GET /lg/px/:token (contract 08 §27 + 09 §29).
// Direct-ingest unit tests (node:sqlite DB + Map-KV + injected CH client / S2S
// fetch) PLUS a mounted app test (tenant host). Proves: a new conversion writes
// leadgen_conversion_log + leadgen_revenue_raw + bumps the conversion cap once; a
// replay (click_id, conversion_id) is a no-op; preview / bot traffic never books;
// a missing Offer is a safe 200 GIF; S2S fires once on the newly-booked
// conversion (conversion_id = the dedupe_key); the response is a no-store
// image/gif; the pixel never throws.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
import type { Env } from "../src/env";
import { ingestBrowserPixel } from "../src/public/leadgen/postback";
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

function buildEnv(db: D1Database, kv: KVNamespace): Env {
  return {
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
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(): { sdb: SqliteDb; env: Env } {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), makeKv()) };
}

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

// A browser_side_pixel Offer, conversion-capped so the cap-bump path is exercised.
function seedPixelOffer(sdb: SqliteDb, publicId: string): number {
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, banner_url_template,
          cap_enabled, cap_amount, cap_timezone, cap_count_by, status)
       VALUES (?, 'Pixel Offer', 'Prov', 'quote_funnel', 'life', 'browser_side_pixel', 'cpa', 0, 'static', 'server', NULL, 1, 100, 'UTC', 'conversions', 'active')`,
    )
    .run(publicId);
  return (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as { id: number }).id;
}

function seedEnabledFacebookPlatform(sdb: SqliteDb): void {
  sdb
    .prepare(
      `INSERT INTO leadgen_media_platforms (platform, enabled, postback_url_template, auth_secret_ref, event_name, value_multiplier)
       VALUES ('facebook', 1, 'https://s2s.example.com/tr?cid={click_id}&v={value}', NULL, 'Purchase', 1)`,
    )
    .run();
}

function countRows(sdb: SqliteDb, table: string): number {
  return (sdb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function pxReq(query: string, cf?: unknown): Request {
  const r = new Request(`${TENANT_ORIGIN}/lg/px/lgo_pixel?${query}`, { method: "GET" });
  if (cf !== undefined) (r as unknown as { cf: unknown }).cf = cf;
  return r;
}

// ===========================================================================
// Direct-ingest unit tests
// ===========================================================================

describeDb("ingestBrowserPixel — booking + dedupe + cap (§27/§29)", () => {
  it("a new CLEAN conversion writes conversion_log + revenue_raw + bumps the conversion cap once; no-store image/gif", async () => {
    const { sdb, env } = newHarness();
    const offerId = seedPixelOffer(sdb, "lgo_pixel");
    const cap = captureCtx();
    const res = await ingestBrowserPixel(env, cap.ctx, "lgo_pixel", pxReq("click_id=lgl_c1&conversion_id=cv-1&value=9&currency=USD"));
    await settle(cap);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/gif");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(countRows(sdb, "leadgen_revenue_raw")).toBe(1);
    expect(countRows(sdb, "leadgen_conversion_log")).toBe(1);
    const rev = sdb.prepare("SELECT source FROM leadgen_revenue_raw LIMIT 1").get() as { source: string };
    expect(rev.source).toBe("in_site");
    const capRow = sdb.prepare("SELECT conversion_count FROM leadgen_offer_cap_counters WHERE offer_id = ?").get(offerId) as
      | { conversion_count: number }
      | undefined;
    expect(capRow?.conversion_count).toBe(1);
  });

  it("a replay (same click_id, conversion_id) is a no-op — no 2nd revenue row, cap NOT bumped again", async () => {
    const { sdb, env } = newHarness();
    const offerId = seedPixelOffer(sdb, "lgo_pixel");
    const cap = captureCtx();
    await ingestBrowserPixel(env, cap.ctx, "lgo_pixel", pxReq("click_id=lgl_c1&conversion_id=cv-1&value=9"));
    await ingestBrowserPixel(env, cap.ctx, "lgo_pixel", pxReq("click_id=lgl_c1&conversion_id=cv-1&value=9"));
    await settle(cap);
    expect(countRows(sdb, "leadgen_revenue_raw")).toBe(1);
    expect(countRows(sdb, "leadgen_conversion_log")).toBe(1);
    const capRow = sdb.prepare("SELECT conversion_count FROM leadgen_offer_cap_counters WHERE offer_id = ?").get(offerId) as
      | { conversion_count: number }
      | undefined;
    expect(capRow?.conversion_count).toBe(1); // exactly once, never on replay
  });

  it("preview traffic (?preview=1) never books, still a 200 GIF (§29)", async () => {
    const { sdb, env } = newHarness();
    seedPixelOffer(sdb, "lgo_pixel");
    const cap = captureCtx();
    const res = await ingestBrowserPixel(env, cap.ctx, "lgo_pixel", pxReq("click_id=lgl_c1&conversion_id=cv-1&value=9&preview=1"));
    await settle(cap);
    expect(res.status).toBe(200);
    expect(countRows(sdb, "leadgen_revenue_raw")).toBe(0);
    expect(countRows(sdb, "leadgen_conversion_log")).toBe(0);
  });

  it("bot traffic (cf.botManagement.verifiedBot) never books, still a 200 GIF (§29)", async () => {
    const { sdb, env } = newHarness();
    seedPixelOffer(sdb, "lgo_pixel");
    const cap = captureCtx();
    const res = await ingestBrowserPixel(
      env,
      cap.ctx,
      "lgo_pixel",
      pxReq("click_id=lgl_c1&conversion_id=cv-1&value=9", { botManagement: { verifiedBot: true } }),
    );
    await settle(cap);
    expect(res.status).toBe(200);
    expect(countRows(sdb, "leadgen_revenue_raw")).toBe(0);
  });

  it("a missing/unknown Offer token ⇒ a safe 200 GIF, no booking (no oracle)", async () => {
    const { sdb, env } = newHarness();
    const cap = captureCtx();
    const res = await ingestBrowserPixel(env, cap.ctx, "lgo_does_not_exist", pxReq("click_id=lgl_c1&conversion_id=cv-1&value=9"));
    await settle(cap);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/gif");
    expect(countRows(sdb, "leadgen_revenue_raw")).toBe(0);
  });

  it("a conversion with no stable dedupe key (conversion_id absent) never books (§29)", async () => {
    const { sdb, env } = newHarness();
    seedPixelOffer(sdb, "lgo_pixel");
    const cap = captureCtx();
    const res = await ingestBrowserPixel(env, cap.ctx, "lgo_pixel", pxReq("click_id=lgl_c1&value=9"));
    await settle(cap);
    expect(res.status).toBe(200);
    expect(countRows(sdb, "leadgen_revenue_raw")).toBe(0);
  });
});

describeDb("ingestBrowserPixel — §26 S2S fires once on a newly-booked conversion", () => {
  it("fires exactly one outbound S2S pixel (conversion_id = dedupe_key); a replay fires none", async () => {
    const { sdb, env } = newHarness();
    seedPixelOffer(sdb, "lgo_pixel");
    seedEnabledFacebookPlatform(sdb);
    const s2s = makeS2sFetch();
    const cap = captureCtx();
    await ingestBrowserPixel(env, cap.ctx, "lgo_pixel", pxReq("click_id=lgl_c1&conversion_id=cv-1&value=9"), {
      chClient: fakeChClient("facebook"),
      s2sFetch: s2s.fetch,
    });
    await settle(cap);
    expect(s2s.calls).toHaveLength(1);
    expect(s2s.calls[0]).toContain("cid=lgl_c1");

    // Replay of the SAME conversion → recordInSitePayout dedupes → no 2nd S2S.
    const cap2 = captureCtx();
    await ingestBrowserPixel(env, cap2.ctx, "lgo_pixel", pxReq("click_id=lgl_c1&conversion_id=cv-1&value=9"), {
      chClient: fakeChClient("facebook"),
      s2sFetch: s2s.fetch,
    });
    await settle(cap2);
    expect(s2s.calls).toHaveLength(1); // still once — at-most-once across replays
  });
});

// ===========================================================================
// MOUNTED route test (real app, tenant host)
// ===========================================================================

describeDb("GET /lg/px/:token — mounted (§4.3 no-store image/gif, mount order)", () => {
  it("a clean conversion over the mounted route ⇒ 200 image/gif + no-store + books", async () => {
    const { sdb, env } = newHarness();
    seedPixelOffer(sdb, "lgo_pixel");
    const res = await app.request(`${TENANT_ORIGIN}/lg/px/lgo_pixel?click_id=lgl_m1&conversion_id=cv-m1&value=7&currency=USD`, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/gif");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(countRows(sdb, "leadgen_revenue_raw")).toBe(1);
  });

  it("registered BEFORE /lg/:quote_slug: a 3-segment /lg/px/<unknown> reaches the pixel handler (GIF), not the slug shell", async () => {
    const { env } = newHarness();
    const res = await app.request(`${TENANT_ORIGIN}/lg/px/lgo_unknown?click_id=c&conversion_id=cv`, {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/gif");
  });

  it("the ADMIN host ⇒ 404 (tenant-host only)", async () => {
    const { env } = newHarness();
    const res = await app.request(`http://${ADMIN_HOST}/lg/px/lgo_pixel?click_id=c&conversion_id=cv`, {}, env);
    expect(res.status).toBe(404);
  });
});
