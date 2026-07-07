// LeadGen Phase 13 Stage A — §26 outbound S2S media-platform dispatcher over
// the REAL 0038 leadgen_media_platforms table (node:sqlite). Proves: platform
// match (case-insensitive, disabled fires nothing), deriveFbc, {value} = revenue
// × value_multiplier, KV dedupe (no double-fire, distinct conversion_id re-fires,
// prefix lg_s2s:), absent-secret tokenless no-op, non-2xx LOGGED-not-thrown,
// fetch-throws contained, and CH-backed click-context resolution.

import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import {
  deriveFbc,
  dispatchMatchedConversionS2S,
  getEnabledPlatformByTrafficSource,
  resolveClickContextFromCh,
  type S2SClickContext,
  type S2SRevenueContext,
} from "../src/leadgen/s2s-dispatch";
import type { LeadgenChClient } from "../src/leadgen/clickhouse";

// --- node:sqlite harness (only leadgen_media_platforms is needed) ------------

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
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first<T = unknown>(): Promise<T | null> { return (sdb.prepare(sql).get(...binds) ?? null) as T | null; },
        async all<T = unknown>() { return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} }; },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as { changes?: number };
          return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: 0 } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return db;
}

// The exact 0038 leadgen_media_platforms DDL (with value_multiplier).
const MEDIA_DDL =
  "CREATE TABLE leadgen_media_platforms (" +
  "id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 0," +
  "postback_url_template TEXT NOT NULL, auth_secret_ref TEXT, event_name TEXT DEFAULT 'Purchase'," +
  "value_multiplier REAL NOT NULL DEFAULT 1, created_at INTEGER NOT NULL DEFAULT (unixepoch()));";

const TEMPLATE =
  "https://track.example.com/pb?ev={event_name}&click={click_id}&fbc={fbc}&fbclid={fbclid}&value={value}&cur={currency}&token={auth_token}";

function makeKv(): KVNamespace & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(k: string) { return store.has(k) ? (store.get(k) ?? null) : null; },
    async put(k: string, v: string) { store.set(k, v); },
    async delete(k: string) { store.delete(k); },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

interface FetchCapture { calls: Array<{ url: string }>; impl: typeof fetch; }
function makeFetch(behavior: "ok" | "non2xx" | "throw"): FetchCapture {
  const calls: Array<{ url: string }> = [];
  const impl = (async (input: unknown) => {
    calls.push({ url: String(input) });
    if (behavior === "throw") throw new Error("network down");
    return { ok: behavior === "ok", status: behavior === "ok" ? 200 : 500 } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, impl };
}

function makeCtx(): { ctx: ExecutionContext; tasks: Array<Promise<unknown>> } {
  const tasks: Array<Promise<unknown>> = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) { tasks.push(Promise.resolve(p)); },
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  return { ctx, tasks };
}

function buildEnv(kv: KVNamespace, extra?: Record<string, string>): Env {
  return { DB: {} as D1Database, CACHE: kv, MEDIA: {} as R2Bucket, APP_ENV: "test", ...(extra ?? {}) } as unknown as Env;
}

function seedPlatform(
  sdb: SqliteDb,
  o: { platform: string; enabled: number; auth_secret_ref?: string | null; value_multiplier?: number; event_name?: string },
): void {
  sdb
    .prepare(
      "INSERT INTO leadgen_media_platforms (platform, enabled, postback_url_template, auth_secret_ref, event_name, value_multiplier) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(o.platform, o.enabled, TEMPLATE, o.auth_secret_ref ?? null, o.event_name ?? "Purchase", o.value_multiplier ?? 1);
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function freshDb(): { sdb: SqliteDb; db: D1Database } {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(sdb, MEDIA_DDL);
  return { sdb, db: d1FromSqlite(sdb) };
}

const CLICK: S2SClickContext = { click_id: "clk1", traffic_source: "facebook", fbc: "", fbclid: "fbid9" };

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------

describe("deriveFbc — §26 fbc from fbclid", () => {
  it("derives fb.1.<now>.<fbclid> when fbc is absent", () => {
    expect(deriveFbc("fbid9", "", 1000)).toBe("fb.1.1000.fbid9");
  });
  it("keeps an existing fbc verbatim", () => {
    expect(deriveFbc("fbid9", "fb.1.5.existing", 1000)).toBe("fb.1.5.existing");
  });
  it("returns empty when there is no fbclid and no fbc", () => {
    expect(deriveFbc("", "", 1000)).toBe("");
  });
});

describeDb("getEnabledPlatformByTrafficSource", () => {
  it("matches case-insensitively and returns value_multiplier", async () => {
    const { sdb, db } = freshDb();
    seedPlatform(sdb, { platform: "facebook", enabled: 1, value_multiplier: 2 });
    const row = await getEnabledPlatformByTrafficSource(db, "FaceBook");
    expect(row).toMatchObject({ platform: "facebook", enabled: 1, value_multiplier: 2 });
  });
  it("returns null for a disabled platform (fires nothing) or a blank source", async () => {
    const { sdb, db } = freshDb();
    seedPlatform(sdb, { platform: "tiktok", enabled: 0 });
    expect(await getEnabledPlatformByTrafficSource(db, "tiktok")).toBeNull();
    expect(await getEnabledPlatformByTrafficSource(db, "")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// dispatchMatchedConversionS2S
// ---------------------------------------------------------------------------

describeDb("dispatchMatchedConversionS2S — §26 fire / value×multiplier / dedupe / secrets", () => {
  const revenue: S2SRevenueContext = { revenue: 10, currency: "USD", conversion_id: "conv-1" };

  it("fires on waitUntil; {value} = revenue × value_multiplier; {fbc} derived; {auth_token} from the secret", async () => {
    const { sdb, db } = freshDb();
    seedPlatform(sdb, { platform: "facebook", enabled: 1, value_multiplier: 2, auth_secret_ref: "LEADGEN_S2S_TOKEN_FACEBOOK" });
    const kv = makeKv();
    const env = buildEnv(kv, { LEADGEN_S2S_TOKEN_FACEBOOK: "tok123" });
    const { ctx, tasks } = makeCtx();
    const f = makeFetch("ok");
    const out = await dispatchMatchedConversionS2S(env, ctx, db, CLICK, revenue, { now: 1000, fetchImpl: f.impl });
    expect(out).toEqual({ status: "fired", platform: "facebook" });
    await Promise.all(tasks);
    expect(f.calls).toHaveLength(1);
    const url = f.calls[0]?.url ?? "";
    expect(url.includes("value=20")).toBe(true); // 10 × 2
    expect(url.includes("fbc=fb.1.1000.fbid9")).toBe(true);
    expect(url.includes("token=tok123")).toBe(true);
    expect(url.includes("ev=Purchase")).toBe(true);
  });

  it("KV dedupe: the SAME (platform, click_id, event_name, conversion_id) fires at most once; a distinct conversion_id re-fires", async () => {
    const { sdb, db } = freshDb();
    seedPlatform(sdb, { platform: "facebook", enabled: 1 });
    const kv = makeKv();
    const env = buildEnv(kv);
    const { ctx } = makeCtx();
    const f = makeFetch("ok");
    const first = await dispatchMatchedConversionS2S(env, ctx, db, CLICK, revenue, { now: 1, fetchImpl: f.impl });
    const replay = await dispatchMatchedConversionS2S(env, ctx, db, CLICK, revenue, { now: 1, fetchImpl: f.impl });
    expect(first.status).toBe("fired");
    expect(replay.status).toBe("deduped");
    expect(f.calls).toHaveLength(1); // no double-fire
    // The dedupe key uses the leadgen prefix, not the listicles one.
    expect([...kv.store.keys()].some((k) => k.startsWith("lg_s2s:"))).toBe(true);
    expect([...kv.store.keys()].some((k) => k.startsWith("lst_s2s:"))).toBe(false);
    // A genuinely different conversion fires again.
    const other = await dispatchMatchedConversionS2S(env, ctx, db, CLICK, { ...revenue, conversion_id: "conv-2" }, { now: 1, fetchImpl: f.impl });
    expect(other.status).toBe("fired");
    expect(f.calls).toHaveLength(2);
  });

  it("absent secret ⇒ tokenless no-op ({auth_token} empty), still fires, never throws", async () => {
    const { sdb, db } = freshDb();
    seedPlatform(sdb, { platform: "facebook", enabled: 1, auth_secret_ref: "LEADGEN_S2S_TOKEN_FACEBOOK" });
    const env = buildEnv(makeKv()); // secret NOT set
    const { ctx, tasks } = makeCtx();
    const f = makeFetch("ok");
    const out = await dispatchMatchedConversionS2S(env, ctx, db, CLICK, revenue, { now: 1, fetchImpl: f.impl });
    expect(out.status).toBe("fired");
    await Promise.all(tasks);
    const url = f.calls[0]?.url ?? "";
    expect(url.endsWith("token=")).toBe(true); // {auth_token} resolved EMPTY (tokenless)
    expect(url.includes("token=tok")).toBe(false);
  });

  it("a disabled platform fires nothing (skipped)", async () => {
    const { sdb, db } = freshDb();
    seedPlatform(sdb, { platform: "facebook", enabled: 0 });
    const f = makeFetch("ok");
    const { ctx } = makeCtx();
    const out = await dispatchMatchedConversionS2S(buildEnv(makeKv()), ctx, db, CLICK, revenue, { fetchImpl: f.impl });
    expect(out.status).toBe("skipped");
    expect(f.calls).toHaveLength(0);
  });

  it("skips when there is no click_id / traffic_source", async () => {
    const { db } = freshDb();
    const { ctx } = makeCtx();
    const out = await dispatchMatchedConversionS2S(buildEnv(makeKv()), ctx, db, { ...CLICK, click_id: "" }, revenue, {});
    expect(out.status).toBe("skipped");
  });

  it("a non-2xx response is LOGGED, not thrown, never blocks ingestion (still 'fired')", async () => {
    const { sdb, db } = freshDb();
    seedPlatform(sdb, { platform: "facebook", enabled: 1 });
    const { ctx, tasks } = makeCtx();
    const f = makeFetch("non2xx");
    const out = await dispatchMatchedConversionS2S(buildEnv(makeKv()), ctx, db, CLICK, revenue, { fetchImpl: f.impl });
    expect(out.status).toBe("fired");
    await expect(Promise.all(tasks)).resolves.toBeDefined(); // the fire promise settles, no throw
  });

  it("a fetch that throws is contained in the fire promise (dispatch never rejects)", async () => {
    const { sdb, db } = freshDb();
    seedPlatform(sdb, { platform: "facebook", enabled: 1 });
    const { ctx, tasks } = makeCtx();
    const f = makeFetch("throw");
    const out = await dispatchMatchedConversionS2S(buildEnv(makeKv()), ctx, db, CLICK, revenue, { fetchImpl: f.impl });
    expect(out.status).toBe("fired");
    await expect(Promise.all(tasks)).resolves.toBeDefined(); // .catch swallowed the throw
  });

  it("value×multiplier preserves a 0 multiplier (reports value 0, not coerced to 1)", async () => {
    const { sdb, db } = freshDb();
    seedPlatform(sdb, { platform: "facebook", enabled: 1, value_multiplier: 0 });
    const { ctx, tasks } = makeCtx();
    const f = makeFetch("ok");
    await dispatchMatchedConversionS2S(buildEnv(makeKv()), ctx, db, CLICK, { revenue: 10, currency: "USD", conversion_id: "z" }, { fetchImpl: f.impl });
    await Promise.all(tasks);
    expect((f.calls[0]?.url ?? "").includes("value=0")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveClickContextFromCh
// ---------------------------------------------------------------------------

describe("resolveClickContextFromCh — CH-backed context (honest residual)", () => {
  it("returns null when CH is unconfigured (postback path fires no S2S)", async () => {
    const unconfigured: LeadgenChClient = {
      configured: false,
      async query() { return { rows: [], configured: false }; },
    };
    expect(await resolveClickContextFromCh({} as Env, "clk1", { client: unconfigured })).toBeNull();
  });

  it("resolves traffic_source/offer_id from lg_events_raw + fbc/fbclid from lg_sessions", async () => {
    const client: LeadgenChClient = {
      configured: true,
      async query<T>(sql: string): Promise<{ rows: T[]; configured: boolean }> {
        if (sql.includes("lg_events_raw")) {
          return { rows: [{ traffic_source: "facebook", session_id: "s1", offer_id: "lgo_a" }] as unknown as T[], configured: true };
        }
        return { rows: [{ fbc: "fb.1.9.z", fbclid: "z" }] as unknown as T[], configured: true };
      },
    };
    const ctx = await resolveClickContextFromCh({} as Env, "clk1", { client });
    expect(ctx).toEqual({ click_id: "clk1", traffic_source: "facebook", fbc: "fb.1.9.z", fbclid: "z", offer_id: "lgo_a" });
  });

  it("returns null (never throws) when the CH query fails", async () => {
    const client: LeadgenChClient = {
      configured: true,
      async query(): Promise<{ rows: never[]; configured: boolean }> { throw new Error("ch down"); },
    };
    await expect(resolveClickContextFromCh({} as Env, "clk1", { client })).resolves.toBeNull();
  });
});
