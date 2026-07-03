// Listicles Phase 9 — §20 outbound S2S dispatcher + §19/§9.3 in-site payout /
// browser-conversion wiring, over REAL sqlite (0032/0033/0034). Proves: platform
// lookup by traffic_source, macro-resolved template incl. fbc-derived-from-fbclid
// + {auth_token} from the secret ref, disabled platform → no fire, dedupe (one
// pixel per click/platform/event), failure logged-not-thrown, CH click-context
// resolution, and processConversionEvent (in-site payout + conversion cap +
// clean-only §31.8 + S2S from the event's own context).

import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Env } from "../src/env";
import type { ListicleChClient } from "../src/listicles/clickhouse";
import {
  dispatchMatchedConversionS2S,
  getEnabledPlatformByTrafficSource,
  deriveFbc,
  resolveClickContextFromCh,
} from "../src/listicles/s2s-dispatch";
import { processConversionEvent } from "../src/analytics/listicle-track";
import { blankListicleEvent } from "../src/analytics/listicle-events";

// --- node:sqlite harness -----------------------------------------------------
type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    try {
      const g = (process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule;
      if (typeof g === "function") return (g("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
    } catch { /* fall through */ }
    return null;
  }
}
function runSql(sdb: SqliteDb, sql: string): void { (sdb["exec"] as (s: string) => void)(sql); }
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
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const r: unknown[] = [];
      try { for (const s of statements) r.push(await s.run()); runSql(sdb, "COMMIT"); }
      catch (err) { runSql(sdb, "ROLLBACK"); throw err; }
      return r;
    },
  } as unknown as D1Database;
  return db;
}
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
function migration(name: string): string { return readFileSync(join(TEST_DIR, "../migrations", name), "utf8"); }
function createDb(ctor: DatabaseSyncCtor): SqliteDb {
  const sdb = new ctor(":memory:");
  runSql(sdb, "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);");
  runSql(sdb, migration("0032_listicles_core.sql"));
  runSql(sdb, migration("0033_listicles_analytics_mirror.sql"));
  runSql(sdb, migration("0034_listicles_revenue_infra.sql"));
  runSql(sdb, migration("0035_listicles_conversion_dedupe.sql"));
  return sdb;
}
function inMemoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(k: string) { return store.get(k) ?? null; },
    async put(k: string, v: string) { store.set(k, v); },
    async delete(k: string) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cacheStatus: null }; },
  } as unknown as KVNamespace;
}
function buildEnv(db: D1Database, extra?: Partial<Env>): Env {
  return {
    DB: db, CACHE: inMemoryKv(), MEDIA: {} as R2Bucket,
    APP_ENV: "test", ADMIN_HOST: "localhost", ADMIN_BASE_URL: "http://localhost:8787", ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false", HTML_CACHE_TTL_SECONDS: "60", OPENAI_TEXT_MODEL: "t", OPENAI_IMAGE_MODEL: "i",
    SITE_PROVISIONING_DRY_RUN: "true", SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    LISTICLE_S2S_TOKEN_FACEBOOK: "fb-token-xyz",
    ...extra,
  } as Env;
}
function makeExecCtx(): { ctx: ExecutionContext; settle: () => Promise<void> } {
  const tasks: Promise<unknown>[] = [];
  const ctx = { waitUntil(p: Promise<unknown>) { tasks.push(Promise.resolve(p).catch(() => {})); }, passThroughOnException() {} } as unknown as ExecutionContext;
  const settle = async () => { let n = -1; while (tasks.length !== n) { n = tasks.length; await Promise.allSettled(tasks.slice()); } };
  return { ctx, settle };
}

function seedPlatform(sdb: SqliteDb, opts: { platform: string; enabled: number; template: string; auth?: string; event?: string }): void {
  sdb.prepare(
    "INSERT INTO listicle_media_platforms (platform, enabled, postback_url_template, auth_secret_ref, event_name) VALUES (?,?,?,?,?)",
  ).run(opts.platform, opts.enabled, opts.template, opts.auth ?? null, opts.event ?? "Purchase");
}

const ctor = loadDatabaseSync();
const d = ctor ? describe : describe.skip;

d("s2s deriveFbc + platform lookup", () => {
  it("deriveFbc: keeps fbc, else derives from fbclid, else empty", () => {
    expect(deriveFbc("fbclidX", "existing", 100)).toBe("existing");
    expect(deriveFbc("fbclidX", "", 100)).toBe("fb.1.100.fbclidX");
    expect(deriveFbc("", "", 100)).toBe("");
  });

  it("getEnabledPlatformByTrafficSource matches case-insensitively, enabled only", async () => {
    const sdb = createDb(ctor as DatabaseSyncCtor);
    const db = d1FromSqlite(sdb);
    seedPlatform(sdb, { platform: "facebook", enabled: 1, template: "https://fb/t?c={click_id}" });
    seedPlatform(sdb, { platform: "taboola", enabled: 0, template: "https://tb/t?c={click_id}" });
    expect((await getEnabledPlatformByTrafficSource(db, "Facebook"))?.platform).toBe("facebook");
    expect(await getEnabledPlatformByTrafficSource(db, "taboola")).toBeNull(); // disabled
    expect(await getEnabledPlatformByTrafficSource(db, "outbrain")).toBeNull(); // absent
  });
});

d("dispatchMatchedConversionS2S", () => {
  let sdb: SqliteDb; let db: D1Database; let env: Env;
  beforeEach(() => { sdb = createDb(ctor as DatabaseSyncCtor); db = d1FromSqlite(sdb); env = buildEnv(db); });

  it("resolves macros (fbc-from-fbclid + {auth_token}) and fires the pixel", async () => {
    seedPlatform(sdb, {
      platform: "facebook", enabled: 1, auth: "LISTICLE_S2S_TOKEN_FACEBOOK", event: "Purchase",
      template: "https://fb.example/tr?id={auth_token}&ev={event_name}&c={click_id}&fbc={fbc}&v={value}&cur={currency}",
    });
    const { ctx, settle } = makeExecCtx();
    let firedUrl = "";
    const fetchImpl = (async (input: RequestInfo | URL) => {
      firedUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response("", { status: 200 });
    }) as typeof fetch;

    const outcome = await dispatchMatchedConversionS2S(
      env, ctx, db,
      { click_id: "ckX", traffic_source: "facebook", fbc: "", fbclid: "FBCLID1" },
      { value: "9.99", currency: "USD" },
      { now: 555, fetchImpl },
    );
    expect(outcome.status).toBe("fired");
    await settle();
    expect(firedUrl).toContain("id=fb-token-xyz");   // {auth_token} from the secret ref
    expect(firedUrl).toContain("ev=Purchase");
    expect(firedUrl).toContain("c=ckX");
    expect(firedUrl).toContain("v=9.99");
    expect(firedUrl).toContain("cur=USD");
    expect(firedUrl).toContain(encodeURIComponent("fb.1.555.FBCLID1")); // fbc derived from fbclid
  });

  it("disabled/absent platform → skipped, NO fire", async () => {
    seedPlatform(sdb, { platform: "facebook", enabled: 0, template: "https://fb/t?c={click_id}" });
    const { ctx, settle } = makeExecCtx();
    let fired = false;
    const fetchImpl = (async () => { fired = true; return new Response("", { status: 200 }); }) as typeof fetch;
    const outcome = await dispatchMatchedConversionS2S(env, ctx, db,
      { click_id: "ckX", traffic_source: "facebook", fbc: "", fbclid: "" }, { value: "1", currency: "USD" }, { fetchImpl });
    await settle();
    expect(outcome.status).toBe("skipped");
    expect(fired).toBe(false);
  });

  it("no traffic_source → skipped", async () => {
    const { ctx } = makeExecCtx();
    const outcome = await dispatchMatchedConversionS2S(env, ctx, db,
      { click_id: "ckX", traffic_source: "", fbc: "", fbclid: "" }, { value: "1", currency: "USD" });
    expect(outcome.status).toBe("skipped");
  });

  it("dedupes: one pixel per (platform, click_id, event_name)", async () => {
    seedPlatform(sdb, { platform: "facebook", enabled: 1, template: "https://fb/t?c={click_id}" });
    const { ctx, settle } = makeExecCtx();
    let count = 0;
    const fetchImpl = (async () => { count += 1; return new Response("", { status: 200 }); }) as typeof fetch;
    const args = [env, ctx, db, { click_id: "ckDup", traffic_source: "facebook", fbc: "", fbclid: "" }, { value: "1", currency: "USD" }, { fetchImpl }] as const;
    const a = await dispatchMatchedConversionS2S(...args);
    await settle();
    const b = await dispatchMatchedConversionS2S(...args);
    await settle();
    expect(a.status).toBe("fired");
    expect(b.status).toBe("deduped");
    expect(count).toBe(1);
  });

  it("pixel failure is logged, never thrown", async () => {
    seedPlatform(sdb, { platform: "facebook", enabled: 1, template: "https://fb/t?c={click_id}" });
    const { ctx, settle } = makeExecCtx();
    const fetchImpl = (async () => { throw new Error("network down"); }) as typeof fetch;
    const outcome = await dispatchMatchedConversionS2S(env, ctx, db,
      { click_id: "ckErr", traffic_source: "facebook", fbc: "", fbclid: "" }, { value: "1", currency: "USD" }, { fetchImpl });
    expect(outcome.status).toBe("fired"); // registered; the failure is swallowed on waitUntil
    await expect(settle()).resolves.toBeUndefined(); // never throws
  });
});

d("resolveClickContextFromCh", () => {
  function mockClient(rows: { offerClick?: Record<string, unknown>; session?: Record<string, unknown> }): ListicleChClient {
    return {
      configured: true,
      async query<T>(sql: string): Promise<{ rows: T[]; configured: boolean }> {
        if (sql.includes("lst_events_raw") && sql.includes("offer_click")) {
          return { rows: (rows.offerClick ? [rows.offerClick] : []) as T[], configured: true };
        }
        if (sql.includes("lst_sessions")) {
          return { rows: (rows.session ? [rows.session] : []) as T[], configured: true };
        }
        return { rows: [], configured: true };
      },
    };
  }

  it("returns click context (traffic_source + fbc/fbclid + offer_id) on a clean match", async () => {
    const env = buildEnv(d1FromSqlite(createDb(ctor as DatabaseSyncCtor)));
    const client = mockClient({ offerClick: { traffic_source: "facebook", session_id: "s1", offer_id: "off_z" }, session: { fbc: "fb.1.1.z", fbclid: "zz" } });
    const ctx = await resolveClickContextFromCh(env, "ck1", { client });
    expect(ctx).not.toBeNull();
    expect(ctx!.traffic_source).toBe("facebook");
    expect(ctx!.offer_id).toBe("off_z");
    expect(ctx!.fbclid).toBe("zz");
  });

  it("null when no offer_click matches", async () => {
    const env = buildEnv(d1FromSqlite(createDb(ctor as DatabaseSyncCtor)));
    expect(await resolveClickContextFromCh(env, "ckNone", { client: mockClient({}) })).toBeNull();
  });

  it("null when CH is unconfigured", async () => {
    const env = buildEnv(d1FromSqlite(createDb(ctor as DatabaseSyncCtor)));
    const unconfigured = { configured: false, async query() { return { rows: [], configured: false }; } } as ListicleChClient;
    expect(await resolveClickContextFromCh(env, "ck1", { client: unconfigured })).toBeNull();
  });
});

d("processConversionEvent (browser conversion → in-site payout + S2S)", () => {
  let sdb: SqliteDb; let db: D1Database; let env: Env;
  beforeEach(() => { sdb = createDb(ctor as DatabaseSyncCtor); db = d1FromSqlite(sdb); env = buildEnv(db); });

  function inSiteOffer(publicId: string, opts?: { cap?: boolean }): void {
    sdb.prepare(
      `INSERT INTO listicle_offers (public_id, offer_name, provider, activity, vertical, conversion_tracking_method,
        offer_url_template, payout_method, payout_currency, payout_value, cap_enabled, cap_amount, cap_timezone, cap_count_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(publicId, "In Site", "acme", "lead", "pets", "browser_side_pixel", "https://t/c?cid={click_id}", "in_site", "USD", 8.5,
      opts?.cap ? 1 : 0, opts?.cap ? 50 : null, opts?.cap ? "UTC" : null, opts?.cap ? "conversions" : null);
  }

  function conversion(overrides: Partial<ReturnType<typeof blankListicleEvent>>): ReturnType<typeof blankListicleEvent> {
    const e = blankListicleEvent("conversion", Date.parse("2026-07-02T12:00:00Z"));
    e.click_id = "ck1"; e.offer_id = "off_is"; e.traffic_source = "facebook"; e.fbclid = "FBC";
    e.page_view_id = "pv1"; // gives a durable derived booking key by default
    e.traffic_quality_flag = "clean";
    return { ...e, ...overrides };
  }

  async function count(sql: string): Promise<number> {
    return (sdb.prepare(sql).get() as Record<string, unknown>).n as number;
  }

  it("in-site + clean → records source='in_site' revenue_raw with payout_value + bumps conversion cap", async () => {
    inSiteOffer("off_is", { cap: true });
    seedPlatform(sdb, { platform: "facebook", enabled: 1, template: "https://fb/t?c={click_id}&v={value}" });
    const { ctx, settle } = makeExecCtx();
    let firedUrl = "";
    const fetchImpl = (async (input: RequestInfo | URL) => { firedUrl = String(input); return new Response("", { status: 200 }); }) as typeof fetch;
    const out = await processConversionEvent(env, ctx, conversion({}), { fetchImpl });
    await settle();
    expect(out.in_site?.recorded).toBe(true);
    const rev = sdb.prepare("SELECT source, revenue, currency FROM listicle_revenue_raw WHERE click_id='ck1'").get() as Record<string, unknown>;
    expect(rev.source).toBe("in_site");
    expect(rev.revenue).toBeCloseTo(8.5, 5);
    const cap = sdb.prepare("SELECT conversion_count FROM listicle_offer_cap_counters WHERE offer_id=(SELECT id FROM listicle_offers WHERE public_id='off_is')").get() as Record<string, unknown>;
    expect(cap.conversion_count).toBe(1);
    // S2S fired with the offer's in-site value as {value}
    expect(firedUrl).toContain("v=8.5");
  });

  it("non-clean conversion → NO payout, NO cap, NO S2S (§31.8)", async () => {
    inSiteOffer("off_is", { cap: true });
    seedPlatform(sdb, { platform: "facebook", enabled: 1, template: "https://fb/t?c={click_id}" });
    const { ctx, settle } = makeExecCtx();
    let fired = false;
    const fetchImpl = (async () => { fired = true; return new Response("", { status: 200 }); }) as typeof fetch;
    const out = await processConversionEvent(env, ctx, conversion({ traffic_quality_flag: "bot", is_bot: true }), { fetchImpl });
    await settle();
    expect(out.skipped).toContain("non-clean");
    expect(sdb.prepare("SELECT COUNT(*) AS n FROM listicle_revenue_raw").get()).toMatchObject({ n: 0 });
    expect(sdb.prepare("SELECT COUNT(*) AS n FROM listicle_offer_cap_counters").get()).toMatchObject({ n: 0 });
    expect(fired).toBe(false);
  });

  it("conversion with no click_id → skipped (revenue_raw.click_id NOT NULL)", async () => {
    inSiteOffer("off_is");
    const { ctx } = makeExecCtx();
    const out = await processConversionEvent(env, ctx, conversion({ click_id: "" }), {});
    expect(out.skipped).toContain("no click_id");
    expect(sdb.prepare("SELECT COUNT(*) AS n FROM listicle_revenue_raw").get()).toMatchObject({ n: 0 });
  });

  it("FIX 1: two identical clean in-site conversions → exactly 1 revenue_raw + cap.conversion_count == 1", async () => {
    inSiteOffer("off_is", { cap: true });
    const { ctx, settle } = makeExecCtx();
    const ev = conversion({}); // same event twice (same derived key ck1|pv1|off_is)
    const first = await processConversionEvent(env, ctx, ev, {});
    await settle();
    const second = await processConversionEvent(env, ctx, ev, {});
    await settle();
    expect(first.in_site?.recorded).toBe(true);
    expect(second.in_site?.recorded).toBe(false);
    expect(second.in_site?.deduped).toBe(true);
    expect(await count("SELECT COUNT(*) AS n FROM listicle_revenue_raw WHERE click_id='ck1'")).toBe(1);
    const cap = sdb.prepare("SELECT conversion_count FROM listicle_offer_cap_counters WHERE offer_id=(SELECT id FROM listicle_offers WHERE public_id='off_is')").get() as Record<string, unknown>;
    expect(cap.conversion_count).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM listicle_conversion_log")).toBe(1);
  });

  it("FIX 1: replay with a CLIENT event_id (server-mint irrelevant) still books once", async () => {
    inSiteOffer("off_is");
    const { ctx, settle } = makeExecCtx();
    // No page_view_id → the key must come from the client event_id; two replays
    // carry the SAME client event_id → one booking.
    const ev = conversion({ page_view_id: "" });
    await processConversionEvent(env, ctx, ev, { clientEventId: "cev-1" });
    await settle();
    await processConversionEvent(env, ctx, ev, { clientEventId: "cev-1" });
    await settle();
    expect(await count("SELECT COUNT(*) AS n FROM listicle_revenue_raw WHERE click_id='ck1'")).toBe(1);
  });

  it("FIX 1: distinct booking keys → 2 revenue rows", async () => {
    inSiteOffer("off_is");
    const { ctx, settle } = makeExecCtx();
    await processConversionEvent(env, ctx, conversion({ page_view_id: "pvA" }), {});
    await settle();
    await processConversionEvent(env, ctx, conversion({ page_view_id: "pvB" }), {});
    await settle();
    expect(await count("SELECT COUNT(*) AS n FROM listicle_revenue_raw WHERE click_id='ck1'")).toBe(2);
  });

  it("FIX 1c: an in-site conversion with NO durable key → 0 booked (analytics still emit)", async () => {
    inSiteOffer("off_is", { cap: true });
    const { ctx, settle } = makeExecCtx();
    // No client event_id AND no page_view_id → underivable key → never booked.
    const out = await processConversionEvent(env, ctx, conversion({ page_view_id: "" }), { clientEventId: "" });
    await settle();
    expect(out.in_site?.recorded).toBe(false);
    expect(out.skipped).toContain("no durable booking key");
    expect(await count("SELECT COUNT(*) AS n FROM listicle_revenue_raw")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM listicle_offer_cap_counters")).toBe(0);
    // The analytics event itself is emitted by the track endpoint independently
    // of this money path (processConversionEvent returned an outcome, no throw).
    expect(out.clean).toBe(true);
  });

  it("FIX 4: distinct conversions on the same click fire distinct S2S pixels", async () => {
    sdb.prepare(
      `INSERT INTO listicle_offers (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_url_template, payout_method)
       VALUES ('off_off','Offsite','acme','lead','pets','s2s_postback','https://t/c?cid={click_id}','offsite')`,
    ).run();
    seedPlatform(sdb, { platform: "facebook", enabled: 1, template: "https://fb/t?c={click_id}" });
    const { ctx, settle } = makeExecCtx();
    let fires = 0;
    const fetchImpl = (async () => { fires += 1; return new Response("", { status: 200 }); }) as typeof fetch;
    // Same click, TWO distinct conversions (distinct page_view_id → distinct key).
    await processConversionEvent(env, ctx, conversion({ offer_id: "off_off", page_view_id: "pvX" }), { fetchImpl });
    await settle();
    await processConversionEvent(env, ctx, conversion({ offer_id: "off_off", page_view_id: "pvY" }), { fetchImpl });
    await settle();
    expect(fires).toBe(2); // both fired — not collapsed by the click-only dedup key
  });

  it("non-in-site offer clean conversion → S2S fires, but NO in-site revenue row", async () => {
    sdb.prepare(
      `INSERT INTO listicle_offers (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_url_template, payout_method)
       VALUES ('off_off','Offsite','acme','lead','pets','s2s_postback','https://t/c?cid={click_id}','offsite')`,
    ).run();
    seedPlatform(sdb, { platform: "facebook", enabled: 1, template: "https://fb/t?c={click_id}" });
    const { ctx, settle } = makeExecCtx();
    let fired = false;
    const fetchImpl = (async () => { fired = true; return new Response("", { status: 200 }); }) as typeof fetch;
    const out = await processConversionEvent(env, ctx, conversion({ offer_id: "off_off" }), { fetchImpl });
    await settle();
    expect(out.in_site).toBeUndefined();
    expect(out.s2s?.status).toBe("fired");
    expect(fired).toBe(true);
    expect(sdb.prepare("SELECT COUNT(*) AS n FROM listicle_revenue_raw").get()).toMatchObject({ n: 0 });
  });
});
