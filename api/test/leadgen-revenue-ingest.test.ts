// LeadGen Phase 13 Stage A — provider-revenue ingestion + §25 booking rules
// over the REAL 0036–0039 migrations (node:sqlite harness). Proves the
// money-critical invariants: the booking-rule matrix (offer_type × signal ×
// source), the in-site dedupe (replay = no-op, conversion cap bumps EXACTLY
// once via caps.ts), the leadgen_revenue_raw source/booking_trigger CHECKs, the
// (provider, external_txn_id) postback dedupe, and §30.3 PII redaction +
// AES-GCM debug_ref (absent key ⇒ NULL ref).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Env } from "../src/env";
import {
  decideBooking,
  getOfferByPublicId,
  insertRevenueRaw,
  isConversionCapped,
  queueRevenueUnmatched,
  recordInSitePayout,
  recordPostbackLog,
  resolveBookingTrigger,
  type OfferRevenueRow,
} from "../src/leadgen/revenue-ingest";

// --- node:sqlite harness (repo pattern; batch-capable for the in-site path) --

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
        for (const statement of statements) results.push(await statement.run());
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
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  for (const file of LEADGEN_MIGRATIONS) {
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  }
  return sdb;
}

// Map-backed KV mock (recordPostbackLog debug_ref blob).
function makeKv(): KVNamespace & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(k: string) { return store.has(k) ? (store.get(k) ?? null) : null; },
    async put(k: string, v: string) { store.set(k, v); },
    async delete(k: string) { store.delete(k); },
  } as unknown as KVNamespace & { store: Map<string, string> };
}

function buildEnv(db: D1Database, kv: KVNamespace, extra?: Record<string, string>): Env {
  return {
    DB: db,
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "t",
    OPENAI_IMAGE_MODEL: "i",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    ...(extra ?? {}),
  } as unknown as Env;
}

interface SeedOfferOpts {
  public_id: string;
  offer_type?: "cpc" | "cpl" | "cpa" | "cpi";
  tracking?: "s2s_postback" | "browser_side_pixel" | "script";
  cap_enabled?: number;
  cap_amount?: number | null;
  cap_count_by?: "clicks" | "conversions" | null;
  cap_timezone?: string | null;
}

function seedOffer(sdb: SqliteDb, o: SeedOfferOpts): void {
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type,
          cap_enabled, cap_amount, cap_timezone, cap_count_by, status)
       VALUES (?, ?, 'act', 'vert', ?, ?, ?, ?, ?, ?, 'active')`,
    )
    .run(
      o.public_id,
      o.public_id,
      o.tracking ?? "browser_side_pixel",
      o.offer_type ?? "cpl",
      o.cap_enabled ?? 0,
      o.cap_amount ?? null,
      o.cap_timezone ?? null,
      o.cap_count_by ?? null,
    );
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function harness(extra?: Record<string, string>): { sdb: SqliteDb; db: D1Database; env: Env; kv: KVNamespace & { store: Map<string, string> } } {
  const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
  const db = d1FromSqlite(sdb);
  const kv = makeKv();
  return { sdb, db, env: buildEnv(db, kv, extra), kv };
}

const DT = "2026-07-07";
const NOW = new Date("2026-07-07T12:00:00Z");

function countRevenueRaw(sdb: SqliteDb, clickId: string): number {
  const r = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_revenue_raw WHERE click_id = ?").get(clickId) as { n: number };
  return r.n;
}
function convCount(sdb: SqliteDb, offerId: number): number {
  const r = sdb.prepare("SELECT COALESCE(SUM(conversion_count),0) AS n FROM leadgen_offer_cap_counters WHERE offer_id = ?").get(offerId) as { n: number };
  return r.n;
}

// ---------------------------------------------------------------------------
// §25 booking-rule matrix
// ---------------------------------------------------------------------------

describe("§25 booking rules — resolveBookingTrigger / decideBooking", () => {
  it("CPC books on click ONLY when explicitly configured; otherwise conversion", () => {
    expect(resolveBookingTrigger("cpc")).toBe("conversion");
    expect(resolveBookingTrigger("cpc", { cpc_books_on_click: true })).toBe("click");
    expect(resolveBookingTrigger("cpl")).toBe("conversion");
    expect(resolveBookingTrigger("cpa")).toBe("conversion");
    expect(resolveBookingTrigger("cpi")).toBe("conversion");
    // CPL/CPA/CPI never book on click even if the flag is (wrongly) set.
    expect(resolveBookingTrigger("cpl", { cpc_books_on_click: true })).toBe("conversion");
  });

  it("a CLICK signal books only a click-booked CPC offer (never CPL/CPA/CPI)", () => {
    expect(decideBooking({ offer_type: "cpc", signal: "click", source: "s2s_postback", cpc_books_on_click: true }))
      .toMatchObject({ book: true, booking_trigger: "click" });
    expect(decideBooking({ offer_type: "cpc", signal: "click", source: "s2s_postback" }))
      .toMatchObject({ book: false, booking_trigger: "conversion" });
    for (const t of ["cpl", "cpa", "cpi"] as const) {
      expect(decideBooking({ offer_type: t, signal: "click", source: "api" }).book).toBe(false);
    }
  });

  it("a CONVERSION signal books a conversion-triggered offer, not a click-booked CPC", () => {
    expect(decideBooking({ offer_type: "cpl", signal: "conversion", source: "s2s_postback" }))
      .toMatchObject({ book: true, booking_trigger: "conversion" });
    expect(decideBooking({ offer_type: "cpc", signal: "conversion", source: "s2s_postback", cpc_books_on_click: true }).book)
      .toBe(false);
  });

  it("source='in_site' ALWAYS books immediately (any offer_type), stamped 'conversion'", () => {
    for (const t of ["cpc", "cpl", "cpa", "cpi"] as const) {
      expect(decideBooking({ offer_type: t, signal: "conversion", source: "in_site" }))
        .toMatchObject({ book: true, booking_trigger: "conversion" });
    }
  });

  it("isConversionCapped is true only for cap_enabled + cap_count_by='conversions'", () => {
    expect(isConversionCapped({ cap_enabled: 1, cap_count_by: "conversions" })).toBe(true);
    expect(isConversionCapped({ cap_enabled: 1, cap_count_by: "clicks" })).toBe(false);
    expect(isConversionCapped({ cap_enabled: 0, cap_count_by: "conversions" })).toBe(false);
    expect(isConversionCapped({ cap_enabled: 1, cap_count_by: null })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getOfferByPublicId + staging writes + the 0038 CHECKs
// ---------------------------------------------------------------------------

describeDb("getOfferByPublicId + staging writes", () => {
  it("reads the Offer's booking/cap columns by public_id; null for unknown/blank", async () => {
    const { sdb, db } = harness();
    seedOffer(sdb, { public_id: "lgo_a", offer_type: "cpa", tracking: "s2s_postback" });
    const offer = await getOfferByPublicId(db, "lgo_a");
    expect(offer).toMatchObject({ public_id: "lgo_a", offer_type: "cpa", conversion_tracking_method: "s2s_postback", status: "active" });
    expect(await getOfferByPublicId(db, "lgo_missing")).toBeNull();
    expect(await getOfferByPublicId(db, "")).toBeNull();
  });

  it("insertRevenueRaw stages a row with source + booking_trigger satisfying the CHECKs", async () => {
    const { sdb, db } = harness();
    await insertRevenueRaw(db, {
      dt: DT, click_id: "c1", offer_public_id: "lgo_a", source: "s2s_postback",
      booking_trigger: "conversion", conversions: 1, revenue: 4.5, currency: "USD",
    });
    const row = sdb.prepare("SELECT source, booking_trigger, revenue FROM leadgen_revenue_raw WHERE click_id = 'c1'").get() as { source: string; booking_trigger: string; revenue: number };
    expect(row).toEqual({ source: "s2s_postback", booking_trigger: "conversion", revenue: 4.5 });
  });

  it("the 0038 source + booking_trigger CHECK constraints reject out-of-set values", () => {
    const { sdb } = harness();
    expect(() =>
      sdb.prepare("INSERT INTO leadgen_revenue_raw (dt, click_id, source, booking_trigger) VALUES ('2026-07-07','x','BOGUS','conversion')").run(),
    ).toThrow();
    expect(() =>
      sdb.prepare("INSERT INTO leadgen_revenue_raw (dt, click_id, source, booking_trigger) VALUES ('2026-07-07','x','api','sideways')").run(),
    ).toThrow();
  });

  it("queueRevenueUnmatched stages a 'pending' row with the normalized revenue_usd (or NULL)", async () => {
    const { sdb, db } = harness();
    await queueRevenueUnmatched(db, { click_id: "cu", provider: "acme", external_txn_id: "t1", revenue: 9, currency: "EUR", revenue_usd: null });
    const row = sdb.prepare("SELECT status, provider, revenue_usd FROM leadgen_revenue_unmatched WHERE click_id = 'cu'").get() as { status: string; provider: string; revenue_usd: number | null };
    expect(row).toEqual({ status: "pending", provider: "acme", revenue_usd: null });
  });
});

// ---------------------------------------------------------------------------
// recordInSitePayout — dedupe + cap-once (the money-write core)
// ---------------------------------------------------------------------------

describeDb("recordInSitePayout — in-site dedupe + conversion cap once", () => {
  it("books a new in-site conversion (revenue+currency from the EVENT, not a payout column)", async () => {
    const { sdb, db } = harness();
    seedOffer(sdb, { public_id: "lgo_is" });
    const offer = (await getOfferByPublicId(db, "lgo_is")) as OfferRevenueRow;
    const out = await recordInSitePayout(db, offer, "clk1", "dedupe-1", DT, 7.25, "EUR", true, NOW);
    expect(out).toMatchObject({ recorded: true, deduped: false, revenue: 7.25, currency: "EUR" });
    const row = sdb.prepare("SELECT source, booking_trigger, revenue, currency FROM leadgen_revenue_raw WHERE click_id = 'clk1'").get() as { source: string; booking_trigger: string; revenue: number; currency: string };
    expect(row).toEqual({ source: "in_site", booking_trigger: "conversion", revenue: 7.25, currency: "EUR" });
    // The conversion-log row is the durable dedupe key.
    const log = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_conversion_log WHERE click_id='clk1' AND dedupe_key='dedupe-1'").get() as { n: number };
    expect(log.n).toBe(1);
  });

  it("a REPLAY (same click_id, dedupe_key) is a no-op — no second revenue row", async () => {
    const { sdb, db } = harness();
    seedOffer(sdb, { public_id: "lgo_is" });
    const offer = (await getOfferByPublicId(db, "lgo_is")) as OfferRevenueRow;
    await recordInSitePayout(db, offer, "clk2", "d2", DT, 5, "USD", true, NOW);
    const replay = await recordInSitePayout(db, offer, "clk2", "d2", DT, 5, "USD", true, NOW);
    expect(replay).toMatchObject({ recorded: false, deduped: true });
    expect(countRevenueRaw(sdb, "clk2")).toBe(1); // still exactly one
  });

  it("conversion cap bumps EXACTLY once (newly booked, CLEAN); a replay never re-bumps", async () => {
    const { sdb, db } = harness();
    seedOffer(sdb, { public_id: "lgo_cap", cap_enabled: 1, cap_amount: 100, cap_count_by: "conversions", cap_timezone: "UTC" });
    const offer = (await getOfferByPublicId(db, "lgo_cap")) as OfferRevenueRow;
    const first = await recordInSitePayout(db, offer, "clk3", "d3", DT, 3, "USD", true, NOW);
    expect(first.capIncremented).toBe(true);
    expect(convCount(sdb, offer.id)).toBe(1);
    const replay = await recordInSitePayout(db, offer, "clk3", "d3", DT, 3, "USD", true, NOW);
    expect(replay.deduped).toBe(true);
    expect(convCount(sdb, offer.id)).toBe(1); // NOT bumped again
  });

  it("does NOT bump the cap on non-clean (preview/simulate/bot) traffic (§29)", async () => {
    const { sdb, db } = harness();
    seedOffer(sdb, { public_id: "lgo_cap2", cap_enabled: 1, cap_amount: 100, cap_count_by: "conversions", cap_timezone: "UTC" });
    const offer = (await getOfferByPublicId(db, "lgo_cap2")) as OfferRevenueRow;
    const out = await recordInSitePayout(db, offer, "clk4", "d4", DT, 3, "USD", false /* not clean */, NOW);
    expect(out.recorded).toBe(true);
    expect(out.capIncremented).toBe(false);
    expect(convCount(sdb, offer.id)).toBe(0);
  });

  it("a clicks-capped offer does NOT bump conversion_count on an in-site conversion", async () => {
    const { sdb, db } = harness();
    seedOffer(sdb, { public_id: "lgo_clk", cap_enabled: 1, cap_amount: 100, cap_count_by: "clicks", cap_timezone: "UTC" });
    const offer = (await getOfferByPublicId(db, "lgo_clk")) as OfferRevenueRow;
    const out = await recordInSitePayout(db, offer, "clk5", "d5", DT, 3, "USD", true, NOW);
    expect(out.recorded).toBe(true);
    expect(out.capIncremented).toBe(false); // not conversion-capped
    expect(convCount(sdb, offer.id)).toBe(0);
  });

  it("refuses to book on an empty click_id or an empty dedupe key (never money on an ephemeral identity)", async () => {
    const { sdb, db } = harness();
    seedOffer(sdb, { public_id: "lgo_x" });
    const offer = (await getOfferByPublicId(db, "lgo_x")) as OfferRevenueRow;
    expect((await recordInSitePayout(db, offer, "", "d", DT, 5, "USD", true, NOW)).recorded).toBe(false);
    expect((await recordInSitePayout(db, offer, "clk", "", DT, 5, "USD", true, NOW)).recorded).toBe(false);
    expect(countRevenueRaw(sdb, "clk")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// recordPostbackLog — (provider, external_txn_id) dedupe + PII redaction
// ---------------------------------------------------------------------------

describeDb("recordPostbackLog — dedupe + §30.3 redaction + debug_ref", () => {
  it("records a new postback with PII HASHED in payload_redacted_json (raw PII never stored)", async () => {
    const { sdb, env } = harness(); // no encryption key
    const payload = { email: "Buyer@Example.com", zip: "90210", amount: 12.5, txn: "abc" };
    const out = await recordPostbackLog(env, { provider: "acme", external_txn_id: "txn-1", click_id: "c1", offer_public_id: "lgo_a", event_ts: 1000, payload });
    expect(out.recorded).toBe(true);
    expect(out.debug_ref).toBeNull(); // no LEADGEN_DEBUG_ENCRYPTION_KEY ⇒ NULL ref
    const row = sdb.prepare("SELECT payload_redacted_json, debug_ref FROM leadgen_postback_log WHERE provider='acme' AND external_txn_id='txn-1'").get() as { payload_redacted_json: string; debug_ref: string | null };
    expect(row.debug_ref).toBeNull();
    const redacted = JSON.parse(row.payload_redacted_json) as Record<string, unknown>;
    expect(String(redacted.email).startsWith("sha256:")).toBe(true);
    expect(String(redacted.zip).startsWith("sha256:")).toBe(true);
    expect(redacted.amount).toBe(12.5); // non-PII preserved (0 preserved too)
    expect(row.payload_redacted_json.includes("Buyer@Example.com")).toBe(false); // raw PII absent
  });

  it("a REPLAY of the same (provider, external_txn_id) is a no-op (0038 UNIQUE)", async () => {
    const { sdb, env } = harness();
    const payload = { txn: "x" };
    expect((await recordPostbackLog(env, { provider: "acme", external_txn_id: "dup", click_id: "c", offer_public_id: null, event_ts: null, payload })).recorded).toBe(true);
    const replay = await recordPostbackLog(env, { provider: "acme", external_txn_id: "dup", click_id: "c", offer_public_id: null, event_ts: null, payload });
    expect(replay.recorded).toBe(false);
    const n = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_postback_log WHERE provider='acme' AND external_txn_id='dup'").get() as { n: number };
    expect(n.n).toBe(1);
  });

  it("refuses an undedupable postback (empty external_txn_id)", async () => {
    const { env } = harness();
    const out = await recordPostbackLog(env, { provider: "acme", external_txn_id: "", click_id: "c", offer_public_id: null, event_ts: null, payload: {} });
    expect(out.recorded).toBe(false);
  });

  it("with LEADGEN_DEBUG_ENCRYPTION_KEY set, mints an AES-GCM debug_ref + writes the KV blob", async () => {
    const { sdb, env, kv } = harness({ LEADGEN_DEBUG_ENCRYPTION_KEY: "unit-test-key" });
    const out = await recordPostbackLog(env, { provider: "cap", external_txn_id: "e1", click_id: "c9", offer_public_id: "lgo_a", event_ts: 5, payload: { email: "x@y.com" } });
    expect(out.recorded).toBe(true);
    expect(out.debug_ref).not.toBeNull();
    expect(String(out.debug_ref).startsWith("lg-debug:")).toBe(true);
    // The full (encrypted) payload lives in KV under the debug_ref key.
    expect(kv.store.has(String(out.debug_ref))).toBe(true);
    const row = sdb.prepare("SELECT debug_ref FROM leadgen_postback_log WHERE provider='cap' AND external_txn_id='e1'").get() as { debug_ref: string | null };
    expect(row.debug_ref).toBe(out.debug_ref);
  });
});
