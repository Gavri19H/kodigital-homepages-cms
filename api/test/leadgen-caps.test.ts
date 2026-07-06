// LeadGen Phase 4 — synchronous Offer cap counters (contract 04 §10.6) over
// the REAL leadgen_offer_cap_counters DDL: period-key derivation across
// timezones, atomic UPSERT increments (clicks vs conversions), the pure
// capExceeded check, and the §10.6 fallback resolution order. The UPSERT
// path runs against node:sqlite through a minimal D1-shaped shim (repo
// pattern — mirrors leadgen-migrations.test.ts).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  capExceeded,
  capPeriodKey,
  incrementCap,
  readCapStatus,
  resolveCapFallback,
  type LeadgenCapOffer,
} from "../src/leadgen/caps";

// --- node:sqlite harness (repo pattern — mirrors leadgen-migrations) --------

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

// Same helper name/shape as leadgen-migrations.test.ts — runs a SQL script
// through node:sqlite's script runner.
function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

// Minimal D1-shaped adapter over node:sqlite: caps.ts only needs
// .prepare().bind().first()/.run(), which map 1:1 onto sqlite get()/run().
function d1Shim(sdb: SqliteDb): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            first: async <T>(): Promise<T | null> =>
              ((sdb.prepare(sql).get(...params) as T | undefined) ?? null),
            run: async (): Promise<unknown> => sdb.prepare(sql).run(...params),
          };
        },
      };
    },
  } as unknown as D1Database;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newDb(): { sdb: SqliteDb; db: D1Database; offerId: number } {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  // Pre-0036 FK targets (same stub tables the migrations harness creates).
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0036_leadgen_core.sql"), "utf8"));
  sdb
    .prepare(
      "INSERT INTO leadgen_offers (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type) VALUES ('lgo_cap', 'Cap Offer', 'quote_funnel', 'life', 's2s_postback', 'cpc')",
    )
    .run();
  const offerId = (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = 'lgo_cap'").get() as {
    id: number;
  }).id;
  return { sdb, db: d1Shim(sdb), offerId };
}

function capOffer(overrides: Partial<LeadgenCapOffer> = {}): LeadgenCapOffer {
  return {
    id: 1,
    cap_enabled: 1,
    cap_amount: 3,
    cap_timezone: "UTC",
    cap_count_by: "clicks",
    cap_fallback_offer_id: null,
    cap_fallback_url: null,
    ...overrides,
  };
}

describe("capPeriodKey — period derivation per cap_timezone", () => {
  // 2026-07-06T02:30:00Z: still 2026-07-05 in New York (UTC-4) and already
  // 2026-07-06 in UTC and Berlin — the cap day boundary follows the OFFER's
  // timezone, not the server's.
  const at = new Date("2026-07-06T02:30:00Z");

  it("derives the calendar date in the offer timezone (YYYY-MM-DD)", () => {
    expect(capPeriodKey("UTC", at)).toBe("2026-07-06");
    expect(capPeriodKey("America/New_York", at)).toBe("2026-07-05");
    expect(capPeriodKey("Europe/Berlin", at)).toBe("2026-07-06");
  });

  it("crosses the day boundary exactly at the zone's midnight", () => {
    // 03:59Z = 23:59 New York (previous day); 04:00Z = 00:00 New York.
    expect(capPeriodKey("America/New_York", new Date("2026-07-06T03:59:00Z"))).toBe("2026-07-05");
    expect(capPeriodKey("America/New_York", new Date("2026-07-06T04:00:00Z"))).toBe("2026-07-06");
  });

  it("falls back to the UTC date for absent / blank / invalid timezones", () => {
    expect(capPeriodKey(null, at)).toBe("2026-07-06");
    expect(capPeriodKey(undefined, at)).toBe("2026-07-06");
    expect(capPeriodKey("  ", at)).toBe("2026-07-06");
    expect(capPeriodKey("Mars/Olympus", at)).toBe("2026-07-06");
  });
});

describeDb("readCapStatus + incrementCap — atomic UPSERT over the 0036 DDL", () => {
  const now = new Date("2026-07-06T12:00:00Z");

  it("reads zeros when no counter row exists yet", async () => {
    const { db, offerId } = newDb();
    const status = await readCapStatus(db, capOffer({ id: offerId }), now);
    expect(status).toEqual({
      cap_date: "2026-07-06",
      timezone: "UTC",
      click_count: 0,
      conversion_count: 0,
    });
  });

  it("first increment inserts the row; repeats bump click_count atomically", async () => {
    const { db, offerId } = newDb();
    const offer = capOffer({ id: offerId });
    await incrementCap(db, offer, now);
    await incrementCap(db, offer, now);
    await incrementCap(db, offer, now);
    const status = await readCapStatus(db, offer, now);
    expect(status.click_count).toBe(3);
    expect(status.conversion_count).toBe(0);
    expect(status.cap_date).toBe("2026-07-06");
  });

  it("a conversions-capped Offer bumps conversion_count instead", async () => {
    const { db, offerId } = newDb();
    const offer = capOffer({ id: offerId, cap_count_by: "conversions" });
    await incrementCap(db, offer, now);
    await incrementCap(db, offer, now);
    const status = await readCapStatus(db, offer, now);
    expect(status.conversion_count).toBe(2);
    expect(status.click_count).toBe(0);
  });

  it("separate cap days write separate rows (injectable clock)", async () => {
    const { sdb, db, offerId } = newDb();
    const offer = capOffer({ id: offerId });
    await incrementCap(db, offer, new Date("2026-07-06T12:00:00Z"));
    await incrementCap(db, offer, new Date("2026-07-07T12:00:00Z"));
    const rows = sdb
      .prepare("SELECT cap_date, click_count FROM leadgen_offer_cap_counters ORDER BY cap_date")
      .all() as Array<{ cap_date: string; click_count: number }>;
    expect(rows).toEqual([
      { cap_date: "2026-07-06", click_count: 1 },
      { cap_date: "2026-07-07", click_count: 1 },
    ]);
  });

  it("the timezone decides WHICH day a click lands on (2:30Z → previous NY day)", async () => {
    const { db, offerId } = newDb();
    const offer = capOffer({ id: offerId, cap_timezone: "America/New_York" });
    const lateNight = new Date("2026-07-06T02:30:00Z");
    await incrementCap(db, offer, lateNight);
    const status = await readCapStatus(db, offer, lateNight);
    expect(status.cap_date).toBe("2026-07-05");
    expect(status.click_count).toBe(1);
    expect(status.timezone).toBe("America/New_York");
  });

  it("increment + exceeded round-trip: the cap gates after cap_amount events", async () => {
    const { db, offerId } = newDb();
    const offer = capOffer({ id: offerId, cap_amount: 2 });
    expect(capExceeded(await readCapStatus(db, offer, now), offer)).toBe(false);
    await incrementCap(db, offer, now);
    expect(capExceeded(await readCapStatus(db, offer, now), offer)).toBe(false);
    await incrementCap(db, offer, now);
    expect(capExceeded(await readCapStatus(db, offer, now), offer)).toBe(true);
  });
});

describe("capExceeded — pure §10.6 gate", () => {
  const status = (clicks: number, conversions = 0) => ({
    cap_date: "2026-07-06",
    timezone: "UTC",
    click_count: clicks,
    conversion_count: conversions,
  });

  it("gates on the count_by-selected counter (clicks)", () => {
    const offer = capOffer({ cap_amount: 5 });
    expect(capExceeded(status(4), offer)).toBe(false);
    expect(capExceeded(status(5), offer)).toBe(true); // at the cap == capped
    expect(capExceeded(status(6), offer)).toBe(true);
  });

  it("gates on conversions when cap_count_by='conversions'", () => {
    const offer = capOffer({ cap_amount: 2, cap_count_by: "conversions" });
    expect(capExceeded(status(99, 1), offer)).toBe(false);
    expect(capExceeded(status(0, 2), offer)).toBe(true);
  });

  it("a NULL cap_count_by defaults to clicks", () => {
    const offer = capOffer({ cap_amount: 1, cap_count_by: null });
    expect(capExceeded(status(1, 0), offer)).toBe(true);
    expect(capExceeded(status(0, 5), offer)).toBe(false);
  });

  it("disabled caps and missing/zero amounts never gate", () => {
    expect(capExceeded(status(999), capOffer({ cap_enabled: 0 }))).toBe(false);
    expect(capExceeded(status(999), capOffer({ cap_amount: null }))).toBe(false);
    expect(capExceeded(status(999), capOffer({ cap_amount: 0 }))).toBe(false);
  });
});

describe("resolveCapFallback — §10.6 resolution order", () => {
  it("prefers cap_fallback_offer_id", () => {
    expect(
      resolveCapFallback(capOffer({ cap_fallback_offer_id: 7, cap_fallback_url: "https://f.example/x" })),
    ).toEqual({ kind: "fallback_offer", offer_id: 7 });
  });

  it("falls back to cap_fallback_url when no fallback offer is set", () => {
    expect(resolveCapFallback(capOffer({ cap_fallback_url: "https://f.example/x" }))).toEqual({
      kind: "fallback_url",
      url: "https://f.example/x",
    });
    // Whitespace-padded URLs are trimmed.
    expect(resolveCapFallback(capOffer({ cap_fallback_url: "  https://f.example/x " }))).toEqual({
      kind: "fallback_url",
      url: "https://f.example/x",
    });
  });

  it("drops when neither fallback is configured (or both are blank)", () => {
    expect(resolveCapFallback(capOffer())).toEqual({ kind: "drop" });
    expect(resolveCapFallback(capOffer({ cap_fallback_url: "   " }))).toEqual({ kind: "drop" });
    expect(resolveCapFallback(capOffer({ cap_fallback_offer_id: 0 }))).toEqual({ kind: "drop" });
  });
});
