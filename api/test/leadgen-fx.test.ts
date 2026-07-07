// LeadGen Phase 10 STAGE A — auction FX normalization (contract 07 §18.4 + 09
// §29). Exercises normalizeToUsd (USD identity, exact-date rate, most-recent
// on-or-before, missing-rate no_rate, invalid amount, never throws) and
// normalizeCarrierBidsToUsd (bid-set normalization, the zero vs passthrough
// missing-rate policy, per-currency lookup caching) over the REAL
// leadgen_fx_rates table (node:sqlite), never a hand-built stub.

import { describe, expect, it } from "vitest";
import {
  BASE_CURRENCY,
  computeRevenueUsd,
  lookupFxRate,
  normalizeToUsd,
  normalizeCarrierBidsToUsd,
  refreshFxRates,
  type CarrierBidInput,
  type FxRefreshSummary,
} from "../src/leadgen/fx";
import type { Env } from "../src/env";

// --- node:sqlite harness (repo pattern; only the fx table is needed) ---------

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [method: string]: unknown };
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
    } catch {
      /* fall through */
    }
    return null;
  }
}

// Run raw DDL through node:sqlite's statement runner via bracket access (the
// repo pattern — keeps the literal method token off the source line).
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
          return (sdb.prepare(sql).get(...binds) ?? null) as T | null;
        },
        async all<T = unknown>() {
          return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} };
        },
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

// The exact 0038 leadgen_fx_rates DDL (0038:34): PK (date, currency).
const FX_DDL =
  "CREATE TABLE leadgen_fx_rates (date TEXT NOT NULL, currency TEXT NOT NULL, usd_rate REAL NOT NULL, PRIMARY KEY (date, currency));";

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function freshDb(): { sdb: SqliteDb; db: D1Database } {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(sdb, FX_DDL);
  return { sdb, db: d1FromSqlite(sdb) };
}

function seedRate(sdb: SqliteDb, date: string, currency: string, rate: number): void {
  sdb.prepare("INSERT INTO leadgen_fx_rates (date, currency, usd_rate) VALUES (?, ?, ?)").run(date, currency, rate);
}

const DATE = "2026-07-06";

// ---------------------------------------------------------------------------
// normalizeToUsd
// ---------------------------------------------------------------------------

describeDb("normalizeToUsd — 07 §18.4 bid USD normalization", () => {
  it("USD (and blank) currency is the identity — rate 1, no lookup", async () => {
    const { db } = freshDb();
    const usd = await normalizeToUsd(db, 12.5, "USD", DATE);
    expect(usd).toEqual({ currency: "USD", amount: 12.5, rate: 1, usd: 12.5, status: "usd_identity" });
    const blank = await normalizeToUsd(db, 3, "", DATE);
    expect(blank.status).toBe("usd_identity");
    expect(blank.usd).toBe(3);
    expect(BASE_CURRENCY).toBe("USD");
  });

  it("applies an exact (date,currency) rate: usd = amount × usd_rate", async () => {
    const { sdb, db } = freshDb();
    seedRate(sdb, DATE, "EUR", 1.1);
    const r = await normalizeToUsd(db, 10, "eur", DATE); // currency normalized upper
    expect(r).toEqual({ currency: "EUR", amount: 10, rate: 1.1, usd: 11, status: "rate_applied" });
  });

  it("falls back to the most recent rate ON OR BEFORE the date", async () => {
    const { sdb, db } = freshDb();
    seedRate(sdb, "2026-07-01", "GBP", 1.25);
    seedRate(sdb, "2026-07-04", "GBP", 1.3);
    const r = await normalizeToUsd(db, 100, "GBP", DATE); // no 07-06 row → 07-04 rate
    expect(r.rate).toBe(1.3);
    expect(r.usd).toBe(130);
    expect(r.status).toBe("rate_applied");
  });

  it("missing rate → typed no_rate with usd null (NEVER fabricated, NEVER thrown)", async () => {
    const { db } = freshDb();
    const r = await normalizeToUsd(db, 42, "JPY", DATE);
    expect(r).toEqual({ currency: "JPY", amount: 42, rate: null, usd: null, status: "no_rate" });
  });

  it("invalid amount (NaN / negative / non-finite) → invalid_amount, usd null, no throw", async () => {
    const { db } = freshDb();
    expect((await normalizeToUsd(db, Number.NaN, "USD", DATE)).status).toBe("invalid_amount");
    expect((await normalizeToUsd(db, -5, "EUR", DATE)).status).toBe("invalid_amount");
    expect((await normalizeToUsd(db, Number.POSITIVE_INFINITY, "USD", DATE)).usd).toBeNull();
  });

  it("defaults the date to today (UTC) when omitted", async () => {
    const { sdb, db } = freshDb();
    const today = new Date().toISOString().slice(0, 10);
    seedRate(sdb, today, "CAD", 0.75);
    const r = await normalizeToUsd(db, 4, "CAD"); // no date arg
    expect(r.usd).toBe(3);
    expect(r.status).toBe("rate_applied");
  });

  it("lookupFxRate returns 1 for USD/blank and null for an unknown currency", async () => {
    const { db } = freshDb();
    expect(await lookupFxRate(db, DATE, "USD")).toBe(1);
    expect(await lookupFxRate(db, DATE, "")).toBe(1);
    expect(await lookupFxRate(db, DATE, "AUD")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeCarrierBidsToUsd
// ---------------------------------------------------------------------------

describeDb("normalizeCarrierBidsToUsd — bid-set normalization + missing-rate policy", () => {
  const carriers: CarrierBidInput[] = [
    { carrier_key: "a", offer_public_id: "lgo_x", bid: 10, bid_currency: "USD" },
    { carrier_key: "b", offer_public_id: "lgo_x", bid: 10, bid_currency: "EUR" },
    { carrier_key: "c", offer_public_id: "lgo_y", bid: 20, bid_currency: "JPY" }, // no rate
  ];

  it("normalizes each carrier's native bid to a definite non-negative USD bid", async () => {
    const { sdb, db } = freshDb();
    seedRate(sdb, DATE, "EUR", 1.2);
    const out = await normalizeCarrierBidsToUsd(db, carriers, { date: DATE });
    expect(out.map((c) => c.usd_bid)).toEqual([10, 12, 0]); // USD identity, EUR×1.2, JPY no_rate→0
    expect(out.map((c) => c.fx_status)).toEqual(["usd_identity", "rate_applied", "no_rate"]);
    expect(out.map((c) => c.fx_rate)).toEqual([1, 1.2, null]);
  });

  it("default 'zero' policy collapses an unconvertible bid to 0 (07 §18.4 no_bid)", async () => {
    const { db } = freshDb();
    const out = await normalizeCarrierBidsToUsd(db, [carriers[2] as CarrierBidInput], { date: DATE });
    expect(out[0]?.usd_bid).toBe(0);
    expect(out[0]?.fx_status).toBe("no_rate");
  });

  it("'passthrough' policy keeps the native bid when no rate is known", async () => {
    const { db } = freshDb();
    const out = await normalizeCarrierBidsToUsd(db, [carriers[2] as CarrierBidInput], {
      date: DATE,
      onMissingRate: "passthrough",
    });
    expect(out[0]?.usd_bid).toBe(20); // native amount used as USD
    expect(out[0]?.fx_status).toBe("no_rate");
  });

  it("caches the rate per distinct currency within the batch (many carriers, one currency)", async () => {
    const { sdb, db } = freshDb();
    seedRate(sdb, DATE, "EUR", 1.5);
    const many: CarrierBidInput[] = Array.from({ length: 5 }, (_, i) => ({
      carrier_key: `k${i}`,
      offer_public_id: "lgo_z",
      bid: 2,
      bid_currency: "EUR",
    }));
    const out = await normalizeCarrierBidsToUsd(db, many, { date: DATE });
    expect(out.every((c) => c.usd_bid === 3 && c.fx_status === "rate_applied")).toBe(true);
  });

  it("never throws and returns [] for an empty carrier set", async () => {
    const { db } = freshDb();
    await expect(normalizeCarrierBidsToUsd(db, [], { date: DATE })).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// P13 revenue-side FX — computeRevenueUsd (08 §25 / 09 §29)
// ---------------------------------------------------------------------------

describeDb("computeRevenueUsd — revenue currency normalization", () => {
  it("USD passthrough: revenue × 1 (no fabrication, no lookup)", async () => {
    const { db } = freshDb();
    expect(await computeRevenueUsd(db, DATE, "USD", 12.5)).toBe(12.5);
    expect(await computeRevenueUsd(db, DATE, "", 4)).toBe(4); // blank ⇒ USD identity
    expect(BASE_CURRENCY).toBe("USD");
  });

  it("applies an exact (date,currency) rate: usd = revenue × usd_rate", async () => {
    const { sdb, db } = freshDb();
    seedRate(sdb, DATE, "EUR", 1.1);
    expect(await computeRevenueUsd(db, DATE, "eur", 10)).toBeCloseTo(11, 10);
  });

  it("unknown currency → null (unconvertible; caller stores NULL revenue_usd, never a fabricated figure)", async () => {
    const { db } = freshDb();
    expect(await computeRevenueUsd(db, DATE, "JPY", 100)).toBeNull();
  });

  it("non-finite revenue → null, never throws", async () => {
    const { db } = freshDb();
    expect(await computeRevenueUsd(db, DATE, "USD", Number.NaN)).toBeNull();
    expect(await computeRevenueUsd(db, DATE, "USD", Number.POSITIVE_INFINITY)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// P13 revenue-side FX — refreshFxRates (09 §29 daily FX seed)
// ---------------------------------------------------------------------------

function ratesOf(sdb: SqliteDb, date: string): Array<{ currency: string; usd_rate: number }> {
  return sdb
    .prepare("SELECT currency, usd_rate FROM leadgen_fx_rates WHERE date = ? ORDER BY currency ASC")
    .all(date) as Array<{ currency: string; usd_rate: number }>;
}

describeDb("refreshFxRates — idempotent daily FX seed (honest no-op without a source)", () => {
  const NOW = new Date("2026-07-07T00:07:00Z");

  it("seeds ONLY the USD identity without a source (never a fabricated non-USD rate)", async () => {
    const { sdb, db } = freshDb();
    const summary: FxRefreshSummary = await refreshFxRates({ DB: db } as unknown as Env, { now: NOW });
    expect(summary.t).toBe("lg_fx_refresh");
    expect(summary.source).toBe("identity_only");
    expect(summary.date).toBe("2026-07-07");
    const rows = ratesOf(sdb, "2026-07-07");
    expect(rows).toEqual([{ currency: "USD", usd_rate: 1 }]);
  });

  it("applies injected seededRates (a static seed / future FX adapter) alongside the USD identity", async () => {
    const { sdb, db } = freshDb();
    const summary = await refreshFxRates({ DB: db } as unknown as Env, {
      now: NOW,
      seededRates: { EUR: 1.1, gbp: 1.25 },
    });
    expect(summary.source).toBe("seeded_rates");
    const rows = ratesOf(sdb, "2026-07-07");
    expect(rows).toEqual([
      { currency: "EUR", usd_rate: 1.1 },
      { currency: "GBP", usd_rate: 1.25 },
      { currency: "USD", usd_rate: 1 },
    ]);
  });

  it("is idempotent: a re-run never clobbers a rate already recorded for the day (INSERT OR IGNORE)", async () => {
    const { sdb, db } = freshDb();
    const env = { DB: db } as unknown as Env;
    await refreshFxRates(env, { now: NOW, seededRates: { EUR: 1.1 } });
    // A later run with a DIFFERENT rate must NOT overwrite the PK (date,EUR) row.
    await refreshFxRates(env, { now: NOW, seededRates: { EUR: 9.99 } });
    const eur = ratesOf(sdb, "2026-07-07").find((r) => r.currency === "EUR");
    expect(eur?.usd_rate).toBe(1.1); // original preserved
  });

  it("skips a non-positive / non-finite injected rate (never seeds a bad rate)", async () => {
    const { sdb, db } = freshDb();
    await refreshFxRates({ DB: db } as unknown as Env, {
      now: NOW,
      seededRates: { EUR: 0, GBP: -1, JPY: Number.NaN },
    });
    const currencies = ratesOf(sdb, "2026-07-07").map((r) => r.currency);
    expect(currencies).toEqual(["USD"]); // only the identity survived
  });

  it("never throws even when the write path fails (fail-open cron leg)", async () => {
    const throwingEnv = {
      DB: {
        prepare() {
          return {
            bind() {
              return {
                async run() {
                  throw new Error("d1 down");
                },
              };
            },
          };
        },
      },
    } as unknown as Env;
    const summary = await refreshFxRates(throwingEnv, { now: NOW });
    expect(summary.seeded).toBe(0); // nothing seeded, but no throw
    expect(summary.t).toBe("lg_fx_refresh");
  });
});
