// Listicles Phase 9 — POST /api/pb/:provider inbound postback, over REAL sqlite
// (node:sqlite) running the REAL migrations (0032/0033/0034). Proves the §19/§24
// steps: unknown provider 404, token 401 (constant-time), strict-payload 400,
// idempotent dedupe (replay → 200 no-op, one row), revenue_raw insert, unmatched
// queue on no-match (+ §31.7 revenue_usd from listicle_fx_rates), matched path
// (clean CH offer_click → conversion-cap increment + no unmatched), fast-200 /
// no payload reflection, and per-provider rate limiting.

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Env } from "../src/env";
import {
  listiclePostbackRouter,
  timingSafeEqualStr,
  utcDateFromEventTs,
  POSTBACK_RATE_LIMIT_PER_MINUTE,
} from "../src/public/listicle/postback";

// --- node:sqlite harness (repo pattern; see listicles-mirror-sync.test.ts) ---

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    return (nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule;
      if (typeof getBuiltin === "function") {
        return (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
      }
    } catch { /* fall through */ }
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
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first<T = unknown>(): Promise<T | null> { return (sdb.prepare(sql).get(...binds) ?? null) as T | null; },
        async all<T = unknown>() { return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} }; },
        async run() { const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint }; return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) } }; },
      };
      return stmt;
    },
    // Transactional batch (mirrors D1 batch atomicity): a throw rolls back all.
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
  return db;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
function migration(name: string): string {
  return readFileSync(join(TEST_DIR, "../migrations", name), "utf8");
}

function createDb(ctor: DatabaseSyncCtor): SqliteDb {
  const sdb = new ctor(":memory:");
  runSql(sdb, "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);");
  runSql(sdb, migration("0032_listicles_core.sql"));
  runSql(sdb, migration("0033_listicles_analytics_mirror.sql"));
  runSql(sdb, migration("0034_listicles_revenue_infra.sql"));
  runSql(sdb, migration("0035_listicles_conversion_dedupe.sql"));
  sdb.prepare("INSERT INTO sites (id, name) VALUES (?, ?)").run("st_test", "Test Site");
  return sdb;
}

function inMemoryKv(seed?: Record<string, string>): KVNamespace {
  const store = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    async get(k: string) { return store.get(k) ?? null; },
    async put(k: string, v: string) { store.set(k, v); },
    async delete(k: string) { store.delete(k); },
    async list(opts?: { prefix?: string }) {
      const prefix = opts?.prefix ?? "";
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

function buildEnv(db: D1Database, extra?: Partial<Env>): Env {
  return {
    DB: db,
    CACHE: inMemoryKv(),
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    LISTICLE_PB_TOKEN_GENERIC: "secret-generic",
    LISTICLE_PB_TOKEN_CAPI: "secret-capi",
    ...extra,
  } as Env;
}

// Collect ctx.waitUntil promises so post-200 background work can be awaited.
// Drains repeatedly to settle NESTED waitUntil (S2S fire registered inside the
// background promise).
function makeExecCtx(): { ctx: ExecutionContext; settle: () => Promise<void> } {
  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) { tasks.push(Promise.resolve(p).catch(() => {})); },
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  const settle = async () => {
    let n = -1;
    while (tasks.length !== n) {
      n = tasks.length;
      await Promise.allSettled(tasks.slice());
    }
  };
  return { ctx, settle };
}

function post(url: string, body: Record<string, unknown> | null, headers?: Record<string, string>): Request {
  const init: RequestInit = { method: "POST", headers: { "Content-Type": "application/json", ...(headers ?? {}) } };
  if (body !== null) init.body = JSON.stringify(body);
  return new Request(url, init);
}

const ctor = loadDatabaseSync();
const d = ctor ? describe : describe.skip;

d("listicle postback — pure helpers", () => {
  it("timingSafeEqualStr (SHA-256 hashed compare) is length-safe and value-correct", async () => {
    expect(await timingSafeEqualStr("abc", "abc")).toBe(true);
    expect(await timingSafeEqualStr("abc", "abd")).toBe(false);
    expect(await timingSafeEqualStr("abc", "abcd")).toBe(false); // different length → false
    expect(await timingSafeEqualStr("", "")).toBe(true);
    expect(await timingSafeEqualStr("", "x")).toBe(false);
    expect(await timingSafeEqualStr("short", "a-much-longer-secret-value")).toBe(false);
  });
  it("utcDateFromEventTs handles seconds, ms, and absent", () => {
    expect(utcDateFromEventTs(1_700_000_000, new Date("2026-01-01T00:00:00Z"))).toBe("2023-11-14"); // seconds
    expect(utcDateFromEventTs(1_700_000_000_000, new Date("2026-01-01T00:00:00Z"))).toBe("2023-11-14"); // ms
    expect(utcDateFromEventTs(null, new Date("2026-07-02T10:00:00Z"))).toBe("2026-07-02");
  });
});

d("listicle postback — endpoint", () => {
  let sdb: SqliteDb;
  let db: D1Database;
  let env: Env;

  beforeEach(() => {
    sdb = createDb(ctor as DatabaseSyncCtor);
    db = d1FromSqlite(sdb);
    env = buildEnv(db);
  });

  const TOKEN = { "X-Postback-Token": "secret-generic" };

  it("unknown provider → 404, no payload echo", async () => {
    const res = await listiclePostbackRouter.request(
      post("http://x/api/pb/nope", { click_id: "ck1", external_txn_id: "tx1", revenue: 5 }, TOKEN),
      {}, env,
    );
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain("ck1");
    expect(text).not.toContain("tx1");
  });

  it("bad/missing token → 401", async () => {
    const bad = await listiclePostbackRouter.request(
      post("http://x/api/pb/generic", { click_id: "ck1", external_txn_id: "tx1", revenue: 5 }, { "X-Postback-Token": "wrong" }),
      {}, env,
    );
    expect(bad.status).toBe(401);
    const missing = await listiclePostbackRouter.request(
      post("http://x/api/pb/generic", { click_id: "ck1", external_txn_id: "tx1", revenue: 5 }),
      {}, env,
    );
    expect(missing.status).toBe(401);
  });

  it("401 when the provider has no configured secret", async () => {
    const noSecretEnv = buildEnv(db, { LISTICLE_PB_TOKEN_CAPI: undefined });
    const res = await listiclePostbackRouter.request(
      post("http://x/api/pb/capi", { sub1: "ck1", event_id: "tx1", value: 5 }, { "X-Postback-Token": "anything" }),
      {}, noSecretEnv,
    );
    expect(res.status).toBe(401);
  });

  it("strict payload → 400 with field names only (no values)", async () => {
    const res = await listiclePostbackRouter.request(
      post("http://x/api/pb/generic", { revenue: 5, currency: "USD" }, TOKEN), {}, env,
    );
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string; fields: Record<string, string> };
    expect(json.fields.click_id).toBeDefined();
    expect(json.fields.external_txn_id).toBeDefined();
  });

  it("valid postback → 200 accepted, inserts revenue_raw (source s2s_postback), no reflection", async () => {
    const { ctx, settle } = makeExecCtx();
    const res = await listiclePostbackRouter.request(
      post("http://x/api/pb/generic", { click_id: "ck-abc", external_txn_id: "tx-xyz", revenue: 12.5, currency: "USD" }, TOKEN),
      {}, env, ctx,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("accepted");
    // no reflection of payload bytes
    expect(body).not.toContain("ck-abc");
    expect(body).not.toContain("tx-xyz");
    await settle();

    const rev = sdb.prepare("SELECT click_id, source, revenue, currency, conversions FROM listicle_revenue_raw").all() as Array<Record<string, unknown>>;
    expect(rev.length).toBe(1);
    expect(rev[0]!.click_id).toBe("ck-abc");
    expect(rev[0]!.source).toBe("s2s_postback");
    expect(rev[0]!.revenue).toBe(12.5);
    expect(rev[0]!.conversions).toBe(1);
    const log = sdb.prepare("SELECT provider, external_txn_id FROM listicle_postback_log").all() as Array<Record<string, unknown>>;
    expect(log.length).toBe(1);
    expect(log[0]!.provider).toBe("generic");
  });

  it("FIX 2: ?token= is never persisted into postback_log.payload_json", async () => {
    const { ctx, settle } = makeExecCtx();
    const res = await listiclePostbackRouter.request(
      // token on the query string (the ?token= path) — must be stripped at rest.
      post("http://x/api/pb/generic?token=secret-generic&click_id=ck-tok&external_txn_id=tx-tok&revenue=5&currency=USD", null),
      {}, env, ctx,
    );
    expect(res.status).toBe(200);
    await settle();
    const row = sdb.prepare("SELECT payload_json FROM listicle_postback_log WHERE external_txn_id='tx-tok'").get() as Record<string, unknown>;
    expect(String(row.payload_json)).not.toContain("secret-generic");
    expect(String(row.payload_json)).not.toContain("token");
  });

  it("FIX 3: a revenue insert failing mid-batch rolls back the dedupe log (503, no silent loss)", async () => {
    // Force the revenue_raw insert to abort for a sentinel click_id.
    runSql(sdb, "CREATE TRIGGER lst_fail_rev BEFORE INSERT ON listicle_revenue_raw WHEN NEW.click_id = 'ck-fail' BEGIN SELECT RAISE(ABORT, 'boom'); END;");
    const { ctx, settle } = makeExecCtx();
    const res = await listiclePostbackRouter.request(
      post("http://x/api/pb/generic", { click_id: "ck-fail", external_txn_id: "tx-fail", revenue: 9 }, TOKEN), {}, env, ctx,
    );
    await settle();
    expect(res.status).toBe(503); // retryable — NOT a fake 200
    // The batch rolled back → NO dedupe-log row persisted (so a retry re-attempts).
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM listicle_postback_log WHERE external_txn_id='tx-fail'").get() as Record<string, unknown>).n).toBe(0);
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM listicle_revenue_raw WHERE click_id='ck-fail'").get() as Record<string, unknown>).n).toBe(0);

    // Retry after the transient condition clears → succeeds, revenue booked once.
    runSql(sdb, "DROP TRIGGER lst_fail_rev;");
    const retry = await listiclePostbackRouter.request(
      post("http://x/api/pb/generic", { click_id: "ck-fail", external_txn_id: "tx-fail", revenue: 9 }, TOKEN), {}, env, ctx,
    );
    await settle();
    expect(retry.status).toBe(200);
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM listicle_revenue_raw WHERE click_id='ck-fail'").get() as Record<string, unknown>).n).toBe(1);
  });

  it("idempotent dedupe: replay of (provider, external_txn_id) → 200 duplicate, ONE row", async () => {
    const { ctx, settle } = makeExecCtx();
    const req = () => post("http://x/api/pb/generic", { click_id: "ck1", external_txn_id: "dup-1", revenue: 3 }, TOKEN);
    const a = await listiclePostbackRouter.request(req(), {}, env, ctx);
    expect(a.status).toBe(200);
    await settle();
    const b = await listiclePostbackRouter.request(req(), {}, env, ctx);
    expect(b.status).toBe(200);
    expect(await b.text()).toContain("duplicate");
    await settle();

    const rev = sdb.prepare("SELECT id FROM listicle_revenue_raw").all() as unknown[];
    expect(rev.length).toBe(1); // replay did NOT insert a second revenue row
    const log = sdb.prepare("SELECT id FROM listicle_postback_log").all() as unknown[];
    expect(log.length).toBe(1);
  });

  it("no CH match → unmatched queue (pending) with §31.7 revenue_usd from fx table", async () => {
    // Seed a EUR rate for today; USD is identity.
    const today = new Date().toISOString().slice(0, 10);
    sdb.prepare("INSERT INTO listicle_fx_rates (date, currency, usd_rate) VALUES (?, 'EUR', ?)").run(today, 1.1);

    const { ctx, settle } = makeExecCtx();
    const res = await listiclePostbackRouter.request(
      post("http://x/api/pb/generic", { click_id: "ck-eur", external_txn_id: "tx-eur", revenue: 10, currency: "EUR" }, TOKEN),
      {}, env, ctx,
    );
    expect(res.status).toBe(200);
    await settle();

    const un = sdb.prepare("SELECT click_id, status, revenue, currency, revenue_usd FROM listicle_revenue_unmatched").all() as Array<Record<string, unknown>>;
    expect(un.length).toBe(1);
    expect(un[0]!.status).toBe("pending");
    expect(un[0]!.currency).toBe("EUR");
    expect(un[0]!.revenue_usd).toBeCloseTo(11, 5); // 10 EUR * 1.1
  });

  it("USD unmatched → revenue_usd identity (no fx row needed)", async () => {
    const { ctx, settle } = makeExecCtx();
    await listiclePostbackRouter.request(
      post("http://x/api/pb/generic", { click_id: "ck-usd", external_txn_id: "tx-usd", revenue: 7, currency: "USD" }, TOKEN),
      {}, env, ctx,
    );
    await settle();
    const un = sdb.prepare("SELECT revenue_usd FROM listicle_revenue_unmatched WHERE click_id='ck-usd'").get() as Record<string, unknown>;
    expect(un.revenue_usd).toBeCloseTo(7, 5);
  });

  it("capi adapter: sub-mapping (click_id from sub1, dedupe from event_id)", async () => {
    const { ctx, settle } = makeExecCtx();
    const res = await listiclePostbackRouter.request(
      post("http://x/api/pb/capi", { sub1: "ck-capi", event_id: "evt-1", value: 4.2, currency: "USD" }, { "X-Postback-Token": "secret-capi" }),
      {}, env, ctx,
    );
    expect(res.status).toBe(200);
    await settle();
    const rev = sdb.prepare("SELECT click_id, revenue FROM listicle_revenue_raw").get() as Record<string, unknown>;
    expect(rev.click_id).toBe("ck-capi");
    expect(rev.revenue).toBeCloseTo(4.2, 5);
  });

  it("rate-limited → 429 once the per-provider minute counter is exhausted", async () => {
    const minute = Math.floor(Date.now() / 60000);
    await env.CACHE.put(`lst_pb_rl:generic:${minute}`, String(POSTBACK_RATE_LIMIT_PER_MINUTE));
    const res = await listiclePostbackRouter.request(
      post("http://x/api/pb/generic", { click_id: "ck1", external_txn_id: "tx-rl", revenue: 1 }, TOKEN),
      {}, env,
    );
    expect(res.status).toBe(429);
  });

  it("matched CH clean offer_click → conversion-cap increment + NO unmatched row", async () => {
    // A conversion-capped offer + the matching enabled media platform.
    sdb.prepare(
      `INSERT INTO listicle_offers (public_id, offer_name, provider, activity, vertical, conversion_tracking_method,
        offer_url_template, payout_method, cap_enabled, cap_amount, cap_timezone, cap_count_by)
       VALUES ('off_cap','Cap Offer','acme','lead','pets','s2s_postback','https://t.example/c?cid={click_id}','offsite',1,100,'UTC','conversions')`,
    ).run();

    // A fake global fetch answering the CH HTTP interface (offer_click + session)
    // and any outbound pixel. resolveClickContextFromCh builds its client from
    // env, so configure CH + stub fetch.
    const chEnv = buildEnv(db, { CH_URL: "https://ch.example", CH_USER: "u", CH_PASSWORD: "p" });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("https://ch.example")) {
        const bodyText = typeof init?.body === "string" ? init.body : "";
        if (bodyText.includes("lst_events_raw") && bodyText.includes("offer_click")) {
          return new Response(JSON.stringify({ traffic_source: "facebook", session_id: "sess1", offer_id: "off_cap" }) + "\n", { status: 200 });
        }
        if (bodyText.includes("lst_sessions")) {
          return new Response(JSON.stringify({ fbc: "fb.1.100.x", fbclid: "xy" }) + "\n", { status: 200 });
        }
        return new Response("", { status: 200 });
      }
      return new Response("", { status: 200 }); // outbound pixel
    }) as typeof fetch;

    try {
      const { ctx, settle } = makeExecCtx();
      const res = await listiclePostbackRouter.request(
        post("http://x/api/pb/generic", { click_id: "ck-match", external_txn_id: "tx-match", revenue: 20, currency: "USD" }, TOKEN),
        {}, chEnv, ctx,
      );
      expect(res.status).toBe(200);
      await settle();

      const cap = sdb.prepare("SELECT conversion_count FROM listicle_offer_cap_counters WHERE offer_id=(SELECT id FROM listicle_offers WHERE public_id='off_cap')").get() as Record<string, unknown> | undefined;
      expect(cap?.conversion_count).toBe(1);
      const un = sdb.prepare("SELECT id FROM listicle_revenue_unmatched").all() as unknown[];
      expect(un.length).toBe(0); // matched → NOT queued unmatched
      const rev = sdb.prepare("SELECT source FROM listicle_revenue_raw WHERE click_id='ck-match'").get() as Record<string, unknown>;
      expect(rev.source).toBe("s2s_postback");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
