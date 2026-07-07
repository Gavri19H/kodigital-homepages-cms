// LeadGen CH → D1 analytics mirror sync (contract 08 §23/§24, §7.5) — WRITE side.
//
// Two proof surfaces:
//   * REAL node:sqlite running the REAL migration 0037 → proves the §24 upsert,
//     the *_id→*_public_id renames, window bounding, per-table isolation,
//     idempotency, and fail-open no-op actually land (or don't) in D1.
//   * A recording mock D1 (captures {sql, binds} per db.batch()) → proves the
//     ON CONFLICT DO UPDATE SQL shape + the ≤80-statement batch chunking.
// The CH side is always a MOCK client injected via opts.client.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Env } from "../src/env";
import type { LeadgenChClient } from "../src/leadgen/clickhouse";
import { LeadgenChError } from "../src/leadgen/clickhouse";
import {
  MIRRORS,
  coerce,
  rowIsValid,
  buildUpsertSql,
  chSelect,
  mirrorOne,
  rebuildLeadgenAnalyticsRange,
  syncLeadgenAnalytics,
  D1_BATCH_ROWS,
  type MirrorSpec,
} from "../src/leadgen/mirror-sync";

// --- node:sqlite harness (repo pattern) --------------------------------------

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
        async run() { sdb.prepare(sql).run(...binds); return { success: true, meta: {} }; },
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
  return db;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function migration(name: string): string {
  return readFileSync(join(TEST_DIR, "../migrations", name), "utf8");
}

function createDb(ctor: DatabaseSyncCtor): SqliteDb {
  const sdb = new ctor(":memory:");
  runSql(sdb, migration("0037_leadgen_analytics_mirror.sql"));
  return sdb;
}

function buildEnv(db: D1Database, extra?: Partial<Env>): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
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
    ...extra,
  } as Env;
}

// --- Mock CH client -----------------------------------------------------------
// Canned rows per lg_*_daily table, FILTERED by the [from,to] window the sync
// passes (so a wrong/absent window is caught). Optional per-table failure
// injection. Some numerics are STRINGS on purpose (ClickHouse quotes 64-bit
// ints unless output_format_json_quote_64bit_integers=0) — coerce handles both.
const CH_TODAY = "2026-07-03";
const CH_YDAY = "2026-07-02";
const CH_OUT_OF_WINDOW = "2026-06-01";

const CH_ROWS: Record<string, Array<Record<string, unknown>>> = {
  lg_offer_daily: [
    { offer_id: "off_a", dt: CH_TODAY, offer_impressions: "100", clicks: "10", unique_clicks: 8, conversions: 2, revenue: 50 },
    { offer_id: "off_a", dt: CH_OUT_OF_WINDOW, offer_impressions: 999, clicks: 99, unique_clicks: 9, conversions: 9, revenue: 999 }, // out-of-window
    { offer_id: "", dt: CH_TODAY, offer_impressions: 5, clicks: 1, unique_clicks: 1, conversions: 0, revenue: 0 }, // notNull skip
  ],
  lg_section_daily: [
    { section_id: "sec_a", dt: CH_TODAY, views: 200, clicks: 20, continued: 15, validation_errors: 2, default_applied: 5, user_confirmed_default: 3, user_selected: 12, dropoffs: 4 },
  ],
  lg_answer_distribution_daily: [
    { section_id: "sec_a", question_key: "age", answer_value_normalized: "25-34", answer_source: "user_selected", dt: CH_TODAY, count: 50, continued_count: 40 },
  ],
  lg_quote_daily: [
    { quote_id: "q_a", funnel_id: "fnl_a", funnel_variant_id: "var_a", funnel_ab_test_id: "ab_a", site_id: "st_a", traffic_source: "fb", dt: CH_TODAY, visits: 300, unique_visits: 250, bounces: 20, completions: 100, clicks: 80, conversions: 10, unfilled: 5, revenue: 120.5 },
  ],
  lg_quote_drilldown_daily: [
    { quote_id: "q_a", funnel_id: "fnl_a", funnel_variant_id: "var_a", site_id: "st_a", traffic_source: "fb", device: "mobile", state: "CA", section_id: "sec_a", section_index: 1, question_key: "age", answer_value_normalized: "25-34", dt: CH_TODAY, views: 120, continued: 100, clicks: 30, conversions: 2, revenue: 15 },
  ],
  lg_auction_daily: [
    { auction_config_id: "auc_a", dt: CH_TODAY, auctions: 40, filled_auctions: 35, unfilled_auctions: 5, offer_impressions: 200, carrier_impressions: 150, carrier_clicks: 20, bid_value_sum: 12.5, eligible_bid_count: 60, timeouts: 3, below_floor: 4, malformed: 1, no_bid: 6, provider_errors: 1, latency_ms_sum: 9000, revenue: 80 },
  ],
  lg_auction_drilldown_daily: [
    { auction_config_id: "auc_a", offer_id: "off_a", carrier_key: "car_a", device: "mobile", state: "CA", carrier_filtered_reason: "", provider_error_reason: "", auction_unfilled_reason: "", dt: CH_TODAY, offer_impressions: 50, carrier_impressions: 40, clicks: 10, conversions: 1, bid_value_sum: 5.5, revenue: 20 },
  ],
  lg_carrier_daily: [
    { auction_config_id: "auc_a", offer_id: "off_a", carrier_key: "car_a", carrier_name: "Carrier A", dt: CH_TODAY, carrier_impressions: 40, clicks: 8, unique_clicks: 6, conversions: 1, bid_value_sum: 5.5, revenue: 20 },
  ],
  lg_provider_diagnostics_daily: [
    { offer_id: "off_a", auction_config_id: "auc_a", provider_error_reason: "", dt: CH_TODAY, requests: 100, responses: 95, timeouts: 2, errors: 3, no_bid: 5, below_floor: 4, latency_ms_sum: 8000 },
  ],
};

interface MockOpts { failTable?: string; }

function mockChClient(opts?: MockOpts): LeadgenChClient {
  return {
    configured: true,
    async query<T>(sql: string, params?: Record<string, string | number>): Promise<{ rows: T[]; configured: boolean }> {
      const table = Object.keys(CH_ROWS).find((t) => sql.includes(`FROM ${t} FINAL`));
      if (!table) return { rows: [], configured: true };
      if (opts?.failTable && sql.includes(`FROM ${opts.failTable} FINAL`)) {
        throw new LeadgenChError("mock CH failure", 500);
      }
      const from = params?.from as string | undefined;
      const to = params?.to as string | undefined;
      const rows = CH_ROWS[table]!.filter((r) => {
        if (from === undefined || to === undefined) return true;
        const dt = String(r.dt);
        return dt >= from && dt <= to;
      });
      return { rows: rows as unknown as T[], configured: true };
    },
  };
}

// A client that returns a fixed row list for ANY table (chunking test).
function fixedRowsClient(rows: Array<Record<string, unknown>>): LeadgenChClient {
  return {
    configured: true,
    async query<T>(): Promise<{ rows: T[]; configured: boolean }> {
      return { rows: rows as unknown as T[], configured: true };
    },
  };
}

// A client whose query always throws (fail-open / never-throws test).
function throwingClient(): LeadgenChClient {
  return {
    configured: true,
    async query<T>(): Promise<{ rows: T[]; configured: boolean }> {
      throw new LeadgenChError("ch down", 500);
    },
  };
}

// Recording mock D1: captures the statements handed to each db.batch() call.
function recordingD1(): { db: D1Database; batches: Array<Array<{ sql: string; binds: unknown[] }>> } {
  const batches: Array<Array<{ sql: string; binds: unknown[] }>> = [];
  const makeStmt = (sql: string) => {
    const stmt = {
      sql,
      binds: [] as unknown[],
      bind(...a: unknown[]) { stmt.binds = a; return stmt; },
      async run() { return { success: true, meta: {} }; },
    };
    return stmt;
  };
  const db = {
    prepare(sql: string) { return makeStmt(sql); },
    async batch(stmts: Array<ReturnType<typeof makeStmt>>) {
      batches.push(stmts.map((s) => ({ sql: s.sql, binds: s.binds })));
      return stmts.map(() => ({ success: true, meta: {} }));
    },
  } as unknown as D1Database;
  return { db, batches };
}

const NOW = new Date("2026-07-03T12:00:00Z"); // window ⇒ [2026-07-02, 2026-07-03]

const DatabaseSync = loadDatabaseSync();
const d = DatabaseSync === null ? describe.skip : describe;

function specByD1(table: string): MirrorSpec {
  const spec = MIRRORS.find((m) => m.d1Table === table);
  if (!spec) throw new Error(`no spec for ${table}`);
  return spec;
}

// --- MIRRORS: exact 9-table set + PKs ----------------------------------------

describe("MIRRORS spec set (contract 08 §23/§24 + migration 0037)", () => {
  const EXPECTED: Record<string, { ch: string; pk: string[] }> = {
    leadgen_analytics_offer: { ch: "lg_offer_daily", pk: ["offer_public_id", "date"] },
    leadgen_analytics_section: { ch: "lg_section_daily", pk: ["section_public_id", "date"] },
    leadgen_analytics_answer_distribution: {
      ch: "lg_answer_distribution_daily",
      pk: ["section_public_id", "question_key", "answer_value_normalized", "answer_source", "date"],
    },
    leadgen_analytics_quote: {
      ch: "lg_quote_daily",
      pk: ["quote_public_id", "funnel_id", "funnel_variant_id", "site_id", "traffic_source", "date"],
    },
    leadgen_analytics_quote_drilldown: {
      ch: "lg_quote_drilldown_daily",
      pk: ["quote_public_id", "funnel_id", "funnel_variant_id", "site_id", "traffic_source", "device", "state", "section_public_id", "question_key", "answer_value_normalized", "date"],
    },
    leadgen_analytics_auction: { ch: "lg_auction_daily", pk: ["auction_public_id", "date"] },
    leadgen_analytics_auction_drilldown: {
      ch: "lg_auction_drilldown_daily",
      pk: ["auction_public_id", "offer_public_id", "carrier_key", "device", "state", "carrier_filtered_reason", "provider_error_reason", "auction_unfilled_reason", "date"],
    },
    leadgen_analytics_carrier: {
      ch: "lg_carrier_daily",
      pk: ["auction_public_id", "offer_public_id", "carrier_key", "date"],
    },
    leadgen_analytics_provider_diagnostics: {
      ch: "lg_provider_diagnostics_daily",
      pk: ["offer_public_id", "auction_public_id", "provider_error_reason", "date"],
    },
  };

  it("has exactly the nine mirrors, each mapping the right CH MV", () => {
    expect(MIRRORS).toHaveLength(9);
    expect(new Set(MIRRORS.map((m) => m.d1Table))).toEqual(new Set(Object.keys(EXPECTED)));
    expect(new Set(MIRRORS.map((m) => m.chTable))).toEqual(
      new Set(["lg_offer_daily", "lg_section_daily", "lg_answer_distribution_daily", "lg_quote_daily", "lg_quote_drilldown_daily", "lg_auction_daily", "lg_auction_drilldown_daily", "lg_carrier_daily", "lg_provider_diagnostics_daily"]),
    );
  });

  it("every mirror's chTable + PK match the CH DDL / migration 0037 exactly", () => {
    for (const spec of MIRRORS) {
      const exp = EXPECTED[spec.d1Table];
      expect(exp, `unexpected mirror ${spec.d1Table}`).toBeDefined();
      expect(spec.chTable).toBe(exp!.ch);
      expect(spec.pk).toEqual(exp!.pk);
      // Every PK column is a real bound column (or `date`, always bound).
      for (const pkCol of spec.pk) {
        expect(spec.columns.some((c) => c.d1 === pkCol)).toBe(true);
      }
      // `date` is always present + always in the PK (rowIsValid relies on it).
      expect(spec.pk).toContain("date");
      expect(spec.columns.some((c) => c.d1 === "date" && c.ch === "dt")).toBe(true);
    }
  });

  it("applies the *_id → *_public_id rename (§24) on every entity id", () => {
    const col = (table: string, d1: string) => specByD1(table).columns.find((c) => c.d1 === d1);
    // offer_id → offer_public_id
    expect(col("leadgen_analytics_offer", "offer_public_id")?.ch).toBe("offer_id");
    expect(col("leadgen_analytics_auction_drilldown", "offer_public_id")?.ch).toBe("offer_id");
    expect(col("leadgen_analytics_carrier", "offer_public_id")?.ch).toBe("offer_id");
    expect(col("leadgen_analytics_provider_diagnostics", "offer_public_id")?.ch).toBe("offer_id");
    // section_id → section_public_id
    expect(col("leadgen_analytics_section", "section_public_id")?.ch).toBe("section_id");
    expect(col("leadgen_analytics_answer_distribution", "section_public_id")?.ch).toBe("section_id");
    expect(col("leadgen_analytics_quote_drilldown", "section_public_id")?.ch).toBe("section_id");
    // quote_id → quote_public_id
    expect(col("leadgen_analytics_quote", "quote_public_id")?.ch).toBe("quote_id");
    expect(col("leadgen_analytics_quote_drilldown", "quote_public_id")?.ch).toBe("quote_id");
    // auction_config_id → auction_public_id
    expect(col("leadgen_analytics_auction", "auction_public_id")?.ch).toBe("auction_config_id");
    expect(col("leadgen_analytics_auction_drilldown", "auction_public_id")?.ch).toBe("auction_config_id");
    expect(col("leadgen_analytics_carrier", "auction_public_id")?.ch).toBe("auction_config_id");
    expect(col("leadgen_analytics_provider_diagnostics", "auction_public_id")?.ch).toBe("auction_config_id");
    // Guard: no *_public_id column is fed by an identically-named CH column.
    for (const spec of MIRRORS) {
      for (const c of spec.columns) {
        if (c.d1.endsWith("_public_id")) expect(c.ch).not.toBe(c.d1);
      }
    }
  });

  it("omits the three D1 columns the CH MVs do not carry (kept at their D1 default)", () => {
    const has = (table: string, d1: string) => specByD1(table).columns.some((c) => c.d1 === d1);
    expect(has("leadgen_analytics_section", "time_on_section_ms_sum")).toBe(false);
    expect(has("leadgen_analytics_quote", "funnel_name")).toBe(false);
    expect(has("leadgen_analytics_quote", "variant_label")).toBe(false);
  });
});

// --- buildUpsertSql: ON CONFLICT DO UPDATE shape -----------------------------

describe("buildUpsertSql (§24 ON CONFLICT DO UPDATE)", () => {
  it("offer: INSERT … VALUES(…, unixepoch()) ON CONFLICT(pk) DO UPDATE SET nonPk=excluded.*, synced_at=excluded.synced_at", () => {
    const sql = buildUpsertSql(specByD1("leadgen_analytics_offer"));
    expect(sql).toContain("INSERT INTO leadgen_analytics_offer (offer_public_id, date, offer_impressions, clicks, unique_clicks, conversions, revenue, synced_at)");
    expect(sql).toContain("VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())");
    expect(sql).toContain("ON CONFLICT(offer_public_id, date) DO UPDATE SET");
    expect(sql).toContain("offer_impressions=excluded.offer_impressions");
    expect(sql).toContain("synced_at=excluded.synced_at");
    // PK columns are never in the SET clause.
    expect(sql).not.toContain("offer_public_id=excluded");
    expect(sql).not.toContain("date=excluded");
    // one placeholder per bound column (7), plus the unixepoch() literal.
    expect((sql.match(/\?/g) ?? []).length).toBe(7);
  });

  it("answer_distribution: composite 5-col PK all excluded from SET; non-PK metrics updated", () => {
    const spec = specByD1("leadgen_analytics_answer_distribution");
    const sql = buildUpsertSql(spec);
    expect(sql).toContain("ON CONFLICT(section_public_id, question_key, answer_value_normalized, answer_source, date) DO UPDATE SET");
    expect(sql).toContain("count=excluded.count");
    expect(sql).toContain("continued_count=excluded.continued_count");
    expect(sql).toContain("synced_at=excluded.synced_at");
    for (const pk of spec.pk) expect(sql).not.toContain(`${pk}=excluded`);
  });

  it("every mirror's placeholder count equals its bound-column count", () => {
    for (const spec of MIRRORS) {
      const sql = buildUpsertSql(spec);
      expect((sql.match(/\?/g) ?? []).length).toBe(spec.columns.length);
      expect(sql).toContain(`INSERT INTO ${spec.d1Table} (`);
      expect(sql).toContain("unixepoch())");
    }
  });
});

// --- chSelect: FINAL + bounded window ----------------------------------------

describe("chSelect (FINAL + bounded rolling window)", () => {
  it("offer: SELECT ch-cols FROM lg_offer_daily FINAL WHERE dt bounded", () => {
    const sql = chSelect(specByD1("leadgen_analytics_offer"));
    expect(sql.startsWith("SELECT offer_id, dt, offer_impressions")).toBe(true);
    expect(sql).toContain("FROM lg_offer_daily FINAL");
    expect(sql).toContain("WHERE dt >= toDate({from}) AND dt <= toDate({to})");
  });

  it("every mirror selects its CH table FINAL over the bounded window and selects `dt`", () => {
    for (const spec of MIRRORS) {
      const sql = chSelect(spec);
      expect(sql).toContain(`FROM ${spec.chTable} FINAL`);
      expect(sql).toContain("WHERE dt >= toDate({from}) AND dt <= toDate({to})");
      expect(sql).toMatch(/^SELECT /);
      // the CH source columns (deduped) are exactly the spec's ch columns
      expect(sql).toContain("dt");
    }
  });
});

// --- coerce ------------------------------------------------------------------

describe("coerce (CH JSONEachRow → D1 bind values)", () => {
  it("text: null/undefined → '', numbers/strings → String", () => {
    expect(coerce("text", null)).toBe("");
    expect(coerce("text", undefined)).toBe("");
    expect(coerce("text", "off_a")).toBe("off_a");
    expect(coerce("text", 42)).toBe("42");
  });
  it("int: strings/floats truncate; bad values default to 0; 0 preserved", () => {
    expect(coerce("int", "100")).toBe(100);
    expect(coerce("int", 3.9)).toBe(3);
    expect(coerce("int", "abc")).toBe(0);
    expect(coerce("int", null)).toBe(0);
    expect(coerce("int", undefined)).toBe(0);
    expect(coerce("int", "0")).toBe(0);
    expect(coerce("int", 0)).toBe(0);
  });
  it("real: keeps fractions; bad values default to 0; 0 preserved", () => {
    expect(coerce("real", "1.25")).toBe(1.25);
    expect(coerce("real", 50)).toBe(50);
    expect(coerce("real", "x")).toBe(0);
    expect(coerce("real", 0)).toBe(0);
    expect(coerce("real", NaN)).toBe(0);
  });
});

// --- rowIsValid --------------------------------------------------------------

describe("rowIsValid (drops rows missing a PK / with an invalid date)", () => {
  const offer = specByD1("leadgen_analytics_offer");
  it("keeps a row with a present identity + a well-formed YYYY-MM-DD date", () => {
    expect(rowIsValid(offer, { offer_public_id: "o", date: "2026-07-06" })).toBe(true);
  });
  it("drops a row whose identity (notNull PK) is empty", () => {
    expect(rowIsValid(offer, { offer_public_id: "", date: "2026-07-06" })).toBe(false);
  });
  it("drops a row whose `date` is not a YYYY-MM-DD string", () => {
    expect(rowIsValid(offer, { offer_public_id: "o", date: "2026-7-6" })).toBe(false);
    expect(rowIsValid(offer, { offer_public_id: "o", date: "20260706" })).toBe(false);
    expect(rowIsValid(offer, { offer_public_id: "o", date: "" })).toBe(false);
    expect(rowIsValid(offer, { offer_public_id: "o", date: 20260706 })).toBe(false);
  });
  it("multi-identity mirror (carrier) requires all its notNull columns", () => {
    const carrier = specByD1("leadgen_analytics_carrier");
    expect(rowIsValid(carrier, { auction_public_id: "a", carrier_key: "c", date: "2026-07-06" })).toBe(true);
    expect(rowIsValid(carrier, { auction_public_id: "a", carrier_key: "", date: "2026-07-06" })).toBe(false);
    expect(rowIsValid(carrier, { auction_public_id: "", carrier_key: "c", date: "2026-07-06" })).toBe(false);
  });
  it("drops an answer_distribution row whose answer_source violates the D1 CHECK enum (0037) — a poison row would roll back the whole atomic batch chunk", () => {
    const ad = specByD1("leadgen_analytics_answer_distribution");
    const base = { section_public_id: "lgs_1", question_key: "age", answer_value_normalized: "30", date: "2026-07-06", count: 1, continued_count: 1 };
    expect(rowIsValid(ad, { ...base, answer_source: "user_selected" })).toBe(true);
    expect(rowIsValid(ad, { ...base, answer_source: "default_applied" })).toBe(true);
    expect(rowIsValid(ad, { ...base, answer_source: "user_confirmed_default" })).toBe(true);
    // Out-of-enum (e.g. "" from a malformed answer_click, or garbage): DROPPED
    // here, never sent to D1 where the CHECK IN(...) would fail the INSERT and
    // (db.batch being one transaction) roll back up to 80 good sibling rows.
    expect(rowIsValid(ad, { ...base, answer_source: "" })).toBe(false);
    expect(rowIsValid(ad, { ...base, answer_source: "bogus" })).toBe(false);
  });
});

// --- batch chunking (recording D1) -------------------------------------------

describe("batch chunking (≤ D1_BATCH_ROWS single-row statements per db.batch())", () => {
  it("81 rows → two batches of 80 + 1, each statement one row's binds", async () => {
    expect(D1_BATCH_ROWS).toBe(80);
    const spec = specByD1("leadgen_analytics_offer");
    const rows = Array.from({ length: 81 }, (_, i) => ({
      offer_id: `off_${i}`, dt: CH_TODAY, offer_impressions: i, clicks: i, unique_clicks: i, conversions: i, revenue: i,
    }));
    const { db, batches } = recordingD1();
    const res = await mirrorOne(db, fixedRowsClient(rows), spec, CH_YDAY, CH_TODAY);

    expect(res.rows).toBe(81);
    expect(res.error).toBeUndefined();
    expect(batches).toHaveLength(2);
    expect(batches[0]!).toHaveLength(80);
    expect(batches[1]!).toHaveLength(1);
    // Never exceed the chunk size, and every statement binds exactly one row.
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(80);
      for (const stmt of batch) {
        expect(stmt.binds).toHaveLength(spec.columns.length); // 7 for offer
        expect(stmt.sql).toBe(buildUpsertSql(spec));
      }
    }
    // First row's binds are its ordered column values (offer_public_id ← off_0).
    expect(batches[0]![0]!.binds[0]).toBe("off_0");
  });

  it("a large multi-table sync keeps every batch ≤ 80 statements", async () => {
    const bigOffers = Array.from({ length: 161 }, (_, i) => ({
      offer_id: `off_${i}`, dt: CH_TODAY, offer_impressions: 1, clicks: 1, unique_clicks: 1, conversions: 1, revenue: 1,
    }));
    const { db, batches } = recordingD1();
    const res = await mirrorOne(db, fixedRowsClient(bigOffers), specByD1("leadgen_analytics_offer"), CH_YDAY, CH_TODAY);
    expect(res.rows).toBe(161);
    expect(batches).toHaveLength(3); // 80 + 80 + 1
    for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(80);
  });
});

// --- fail-open / never-throws (no sqlite needed) -----------------------------

describe("fail-open", () => {
  it("absent CH creds ⇒ structured skip (no client injected, no creds on env) — never throws", async () => {
    const env = buildEnv({} as unknown as D1Database);
    const summary = await syncLeadgenAnalytics(env, { now: NOW });
    expect(summary.configured).toBe(false);
    expect(String(summary.skipped)).toContain("CH credentials");
    expect(summary.total_rows).toBe(0);
    expect(summary.mirrors).toEqual([]);
  });

  it("syncLeadgenAnalytics never throws when the CH client errors on every table", async () => {
    const env = buildEnv({} as unknown as D1Database);
    const summary = await syncLeadgenAnalytics(env, { client: throwingClient(), now: NOW });
    expect(summary.configured).toBe(true);
    expect(summary.total_rows).toBe(0);
    expect(summary.errors).toHaveLength(MIRRORS.length); // every table isolated its own failure
    expect(summary.mirrors.every((m) => m.error !== undefined && m.rows === 0)).toBe(true);
  });

  it("syncLeadgenAnalytics swallows an unexpected throw via its overall try/catch", async () => {
    const env = buildEnv({} as unknown as D1Database);
    // A DB whose access throws inside the per-table loop, OUTSIDE mirrorOne's try/catch.
    Object.defineProperty(env, "DB", { configurable: true, get() { throw new Error("boom DB"); } });
    const summary = await syncLeadgenAnalytics(env, { client: mockChClient(), now: NOW });
    expect(summary.configured).toBe(false);
    expect(String(summary.skipped)).toContain("sync failed");
    expect(summary.errors.length).toBeGreaterThan(0);
  });

  it("rebuildLeadgenAnalyticsRange rejects a malformed window with a structured skip (no throw)", async () => {
    const env = buildEnv({} as unknown as D1Database);
    const summary = await rebuildLeadgenAnalyticsRange(env, "nope", CH_TODAY, { client: mockChClient() });
    expect(summary.configured).toBe(false);
    expect(String(summary.skipped)).toContain("invalid date window");
    expect(summary.errors).toContain("invalid date window");
  });
});

// --- REAL sqlite end-to-end (migration 0037) ---------------------------------

d("mirror sync — write side against REAL sqlite (migration 0037)", () => {
  it("upserts each lg_*_daily MV into its leadgen_analytics_* mirror; renames + coercion + window bound + notNull skip", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    const summary = await syncLeadgenAnalytics(env, { client: mockChClient(), now: NOW });

    expect(summary.configured).toBe(true);
    expect(summary.window).toEqual({ from: CH_YDAY, to: CH_TODAY });
    expect(summary.errors).toEqual([]);
    expect(summary.total_rows).toBe(9); // one in-window row per mirror

    // offer: only the in-window, non-empty-id row lands; offer_id → offer_public_id; "100" coerced.
    const offers = sdb.prepare("SELECT * FROM leadgen_analytics_offer").all() as Array<Record<string, unknown>>;
    expect(offers).toHaveLength(1);
    expect(offers[0]!.offer_public_id).toBe("off_a");
    expect(offers[0]!.date).toBe(CH_TODAY);
    expect(offers[0]!.offer_impressions).toBe(100);
    expect(offers[0]!.revenue).toBe(50);
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_analytics_offer WHERE date = ?").get(CH_OUT_OF_WINDOW) as { n: number }).n).toBe(0);

    // section: section_id → section_public_id; omitted time_on_section_ms_sum stays NULL.
    const section = sdb.prepare("SELECT * FROM leadgen_analytics_section").get() as Record<string, unknown>;
    expect(section.section_public_id).toBe("sec_a");
    expect(section.views).toBe(200);
    expect(section.dropoffs).toBe(4);
    expect(section.time_on_section_ms_sum).toBeNull();

    // answer_distribution: composite PK row lands with its enum answer_source.
    const ad = sdb.prepare("SELECT * FROM leadgen_analytics_answer_distribution").get() as Record<string, unknown>;
    expect(ad.section_public_id).toBe("sec_a");
    expect(ad.question_key).toBe("age");
    expect(ad.answer_source).toBe("user_selected");
    expect(ad.count).toBe(50);

    // quote: quote_id → quote_public_id; omitted funnel_name/variant_label keep DEFAULT ''.
    const quote = sdb.prepare("SELECT * FROM leadgen_analytics_quote").get() as Record<string, unknown>;
    expect(quote.quote_public_id).toBe("q_a");
    expect(quote.funnel_id).toBe("fnl_a");
    expect(quote.funnel_name).toBe("");
    expect(quote.variant_label).toBe("");
    expect(quote.revenue).toBe(120.5);

    // quote_drilldown: both quote_id + section_id renamed.
    const qd = sdb.prepare("SELECT * FROM leadgen_analytics_quote_drilldown").get() as Record<string, unknown>;
    expect(qd.quote_public_id).toBe("q_a");
    expect(qd.section_public_id).toBe("sec_a");
    expect(qd.views).toBe(120);

    // auction: auction_config_id → auction_public_id; real + int metrics coerced.
    const auction = sdb.prepare("SELECT * FROM leadgen_analytics_auction").get() as Record<string, unknown>;
    expect(auction.auction_public_id).toBe("auc_a");
    expect(auction.auctions).toBe(40);
    expect(auction.bid_value_sum).toBe(12.5);
    expect(auction.latency_ms_sum).toBe(9000);

    // auction_drilldown + carrier + provider_diagnostics: auction_config_id + offer_id renamed.
    const adr = sdb.prepare("SELECT * FROM leadgen_analytics_auction_drilldown").get() as Record<string, unknown>;
    expect(adr.auction_public_id).toBe("auc_a");
    expect(adr.offer_public_id).toBe("off_a");
    const carrier = sdb.prepare("SELECT * FROM leadgen_analytics_carrier").get() as Record<string, unknown>;
    expect(carrier.auction_public_id).toBe("auc_a");
    expect(carrier.offer_public_id).toBe("off_a");
    expect(carrier.carrier_key).toBe("car_a");
    expect(carrier.carrier_name).toBe("Carrier A");
    const pd = sdb.prepare("SELECT * FROM leadgen_analytics_provider_diagnostics").get() as Record<string, unknown>;
    expect(pd.offer_public_id).toBe("off_a");
    expect(pd.auction_public_id).toBe("auc_a");
    expect(pd.requests).toBe(100);
  });

  it("is idempotent: running twice yields identical rows (no dupes, same values)", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    await syncLeadgenAnalytics(env, { client: mockChClient(), now: NOW });
    const after1 = sdb.prepare("SELECT offer_public_id, date, offer_impressions, clicks, revenue FROM leadgen_analytics_offer ORDER BY offer_public_id, date").all();
    const count1 = (sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_analytics_offer").get() as { n: number }).n;

    await syncLeadgenAnalytics(env, { client: mockChClient(), now: NOW });
    const after2 = sdb.prepare("SELECT offer_public_id, date, offer_impressions, clicks, revenue FROM leadgen_analytics_offer ORDER BY offer_public_id, date").all();
    const count2 = (sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_analytics_offer").get() as { n: number }).n;

    expect(count2).toBe(count1);
    expect(after2).toEqual(after1);
    for (const spec of MIRRORS) {
      expect((sdb.prepare(`SELECT COUNT(*) AS n FROM ${spec.d1Table}`).get() as { n: number }).n).toBe(1);
    }
  });

  it("isolates a per-table failure — the other eight still sync", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    const summary = await syncLeadgenAnalytics(env, { client: mockChClient({ failTable: "lg_section_daily" }), now: NOW });

    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain("leadgen_analytics_section");
    const section = summary.mirrors.find((m) => m.mirror === "leadgen_analytics_section");
    expect(section?.rows).toBe(0);
    expect(section?.error).toBeDefined();

    expect((sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_analytics_section").get() as { n: number }).n).toBe(0);
    // The other eight mirrors each populated their one in-window row.
    for (const spec of MIRRORS.filter((m) => m.d1Table !== "leadgen_analytics_section")) {
      expect((sdb.prepare(`SELECT COUNT(*) AS n FROM ${spec.d1Table}`).get() as { n: number }).n).toBe(1);
    }
  });

  it("fail-open no-op when CH secrets are absent (no client injected): nothing lands", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb)); // no CH_URL/USER/PASSWORD
    const summary = await syncLeadgenAnalytics(env, { now: NOW });
    expect(summary.configured).toBe(false);
    expect(summary.skipped).toContain("CH credentials");
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_analytics_offer").get() as { n: number }).n).toBe(0);
  });

  it("rebuildLeadgenAnalyticsRange over an explicit window mirrors the data; a reversed range is swapped", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    const summary = await rebuildLeadgenAnalyticsRange(env, CH_TODAY, CH_YDAY, { client: mockChClient() }); // reversed
    expect(summary.configured).toBe(true);
    expect(summary.window).toEqual({ from: CH_YDAY, to: CH_TODAY }); // normalized
    expect(summary.total_rows).toBe(9);
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_analytics_offer").get() as { n: number }).n).toBe(1);
  });
});
