// LeadGen Phase 13 Stage A — §29 revenue reconciliation + the P12-deferred
// revenue cron over the REAL 0038 revenue infra (node:sqlite). Proves: the D1→CH
// shipper (read-only prod client ⇒ honest no-op per §23; write client ships +
// marks synced), the 72h re-match sweep (aged-out vs matched transitions),
// attribution-MV backfill, per-provider reconciliation drift (honest NULL
// provider_report_total), provider-report ingest (stub no-op + configured
// adapter), and runLeadgenRevenueCron fail-open + daily self-gate.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Env } from "../src/env";
import {
  ATTRIBUTION_MV,
  dailyProviderReconciliation,
  ingestProviderReports,
  reMatchUnmatchedSweep,
  runLeadgenRevenueCron,
  seedDefaultMediaPlatforms,
  shipRevenueRawToCh,
  triggerAttributionBackfill,
  type LeadgenChWriteClient,
  type ProviderReportAdapter,
} from "../src/leadgen/revenue-recon";

// --- node:sqlite harness (0038 revenue infra is standalone — no FKs) ---------

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

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    CH_URL: "",
    CH_USER: "",
    CH_PASSWORD: "",
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function freshDb(): { sdb: SqliteDb; db: D1Database; env: Env } {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0038_leadgen_revenue_infra.sql"), "utf8"));
  const db = d1FromSqlite(sdb);
  return { sdb, db, env: buildEnv(db) };
}

// --- CH client mocks ---------------------------------------------------------

const unconfiguredClient: LeadgenChWriteClient = {
  configured: false,
  async query() { return { rows: [], configured: false }; },
};

// Configured but READ-ONLY (no insert/command) — mirrors the production LeadGen
// CH client (§23). ship/backfill must degrade to a structured no-op.
const readOnlyClient: LeadgenChWriteClient = {
  configured: true,
  async query() { return { rows: [], configured: true }; },
};

function writeClient(opts?: { matched?: string[] }): LeadgenChWriteClient & {
  inserts: Array<{ table: string; rows: ReadonlyArray<Record<string, unknown>> }>;
  commands: string[];
} {
  const inserts: Array<{ table: string; rows: ReadonlyArray<Record<string, unknown>> }> = [];
  const commands: string[] = [];
  const matched = opts?.matched ?? [];
  return {
    inserts,
    commands,
    configured: true,
    async query<T>(): Promise<{ rows: T[]; configured: boolean }> {
      return { rows: matched.map((c) => ({ click_id: c })) as unknown as T[], configured: true };
    },
    async insert(table, rows) { inserts.push({ table, rows }); return { inserted: rows.length, configured: true }; },
    async command(sql) { commands.push(sql); return { ok: true, configured: true }; },
  };
}

const throwingClient: LeadgenChWriteClient = {
  configured: true,
  async query(): Promise<{ rows: never[]; configured: boolean }> { throw new Error("ch down"); },
};

// --- seed helpers ------------------------------------------------------------

function seedRevenueRaw(sdb: SqliteDb, r: { dt: string; click_id: string; source?: string; revenue?: number; synced?: number | null }): void {
  sdb
    .prepare(
      "INSERT INTO leadgen_revenue_raw (dt, click_id, offer_public_id, source, booking_trigger, conversions, revenue, currency, synced_to_ch_at) VALUES (?, ?, 'lgo_a', ?, 'conversion', 1, ?, 'USD', ?)",
    )
    .run(r.dt, r.click_id, r.source ?? "s2s_postback", r.revenue ?? 1, r.synced ?? null);
}

function seedUnmatched(sdb: SqliteDb, click_id: string, received_at: number): void {
  sdb
    .prepare(
      "INSERT INTO leadgen_revenue_unmatched (click_id, provider, external_txn_id, revenue, currency, status, received_at) VALUES (?, 'acme', ?, 1, 'USD', 'pending', ?)",
    )
    .run(click_id, `t-${click_id}`, received_at);
}

function seedPostback(sdb: SqliteDb, provider: string, txn: string, received_at: number): void {
  sdb
    .prepare("INSERT INTO leadgen_postback_log (provider, external_txn_id, received_at) VALUES (?, ?, ?)")
    .run(provider, txn, received_at);
}

// ---------------------------------------------------------------------------
// shipRevenueRawToCh
// ---------------------------------------------------------------------------

describeDb("shipRevenueRawToCh — D1→CH shipper (§23 read-only prod client ⇒ no-op)", () => {
  it("read-only production client (no insert path) ⇒ honest structured no-op; rows stay unsynced", async () => {
    const { sdb, env } = freshDb();
    seedRevenueRaw(sdb, { dt: "2026-07-07", click_id: "c1" });
    const res = await shipRevenueRawToCh(env, { client: readOnlyClient });
    expect(res).toMatchObject({ configured: true, shipped: 0 });
    expect(res.reason?.includes("write path unavailable")).toBe(true);
    const unsynced = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_revenue_raw WHERE synced_to_ch_at IS NULL").get() as { n: number };
    expect(unsynced.n).toBe(1);
  });

  it("write-capable client ships unsynced rows to lg_revenue_raw (offer_id + booking_trigger) then marks synced", async () => {
    const { sdb, env } = freshDb();
    seedRevenueRaw(sdb, { dt: "2026-07-07", click_id: "c1", revenue: 5 });
    seedRevenueRaw(sdb, { dt: "2026-07-07", click_id: "c2", revenue: 7 });
    const client = writeClient();
    const res = await shipRevenueRawToCh(env, { client });
    expect(res).toEqual({ configured: true, shipped: 2 });
    expect(client.inserts).toHaveLength(1);
    expect(client.inserts[0]?.table).toBe("lg_revenue_raw");
    const first = client.inserts[0]?.rows[0] as Record<string, unknown>;
    expect(first).toMatchObject({ offer_id: "lgo_a", source: "s2s_postback", booking_trigger: "conversion" });
    const unsynced = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_revenue_raw WHERE synced_to_ch_at IS NULL").get() as { n: number };
    expect(unsynced.n).toBe(0);
    // A second run has nothing to ship.
    expect((await shipRevenueRawToCh(env, { client })).shipped).toBe(0);
  });

  it("unconfigured client ⇒ {configured:false, shipped:0}", async () => {
    const { env } = freshDb();
    expect(await shipRevenueRawToCh(env, { client: unconfiguredClient })).toMatchObject({ configured: false, shipped: 0 });
  });
});

// ---------------------------------------------------------------------------
// reMatchUnmatchedSweep
// ---------------------------------------------------------------------------

describeDb("reMatchUnmatchedSweep — §29 72h re-match / age-out", () => {
  const NOW = new Date("2026-07-07T12:00:00Z");
  const nowSec = Math.floor(NOW.getTime() / 1000);

  it("ages out pending rows older than 72h to 'unattributed' (CH-independent)", async () => {
    const { sdb, env } = freshDb();
    seedUnmatched(sdb, "old", nowSec - 73 * 3600); // past the window
    const res = await reMatchUnmatchedSweep(env, { client: unconfiguredClient, now: NOW });
    expect(res.aged_out).toBe(1);
    const status = sdb.prepare("SELECT status FROM leadgen_revenue_unmatched WHERE click_id='old'").get() as { status: string };
    expect(status.status).toBe("unattributed");
  });

  it("re-matches in-window pending rows found CLEAN in CH → 'matched'", async () => {
    const { sdb, env } = freshDb();
    seedUnmatched(sdb, "inwin", nowSec - 3600); // within window
    const res = await reMatchUnmatchedSweep(env, { client: writeClient({ matched: ["inwin"] }), now: NOW });
    expect(res).toMatchObject({ configured: true, matched: 1, scanned: 1 });
    const status = sdb.prepare("SELECT status FROM leadgen_revenue_unmatched WHERE click_id='inwin'").get() as { status: string };
    expect(status.status).toBe("matched");
  });

  it("unconfigured CH ⇒ age-out still runs, no re-match", async () => {
    const { sdb, env } = freshDb();
    seedUnmatched(sdb, "p1", nowSec - 3600);
    const res = await reMatchUnmatchedSweep(env, { client: unconfiguredClient, now: NOW });
    expect(res.configured).toBe(false);
    expect(res.matched).toBe(0);
    const status = sdb.prepare("SELECT status FROM leadgen_revenue_unmatched WHERE click_id='p1'").get() as { status: string };
    expect(status.status).toBe("pending"); // still pending, not aged (in window), not matched
  });
});

// ---------------------------------------------------------------------------
// triggerAttributionBackfill
// ---------------------------------------------------------------------------

describeDb("triggerAttributionBackfill — CH attribution MV refresh", () => {
  it("issues SYSTEM REFRESH VIEW on a command-capable client", async () => {
    const { env } = freshDb();
    const client = writeClient();
    const res = await triggerAttributionBackfill(env, { client });
    expect(res).toMatchObject({ configured: true, refreshed: true });
    expect(client.commands).toEqual([`SYSTEM REFRESH VIEW ${ATTRIBUTION_MV}`]);
  });

  it("read-only client (no command path) ⇒ no-op note, never throws (§23)", async () => {
    const { env } = freshDb();
    const res = await triggerAttributionBackfill(env, { client: readOnlyClient });
    expect(res.refreshed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dailyProviderReconciliation
// ---------------------------------------------------------------------------

describeDb("dailyProviderReconciliation — §29 per-provider drift (honest NULL report total)", () => {
  it("counts postbacks per provider + sums s2s revenue; provider_report_total NULL + reason", async () => {
    const { sdb, env } = freshDb();
    const date = "2026-07-06";
    const dayStart = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000) + 3600;
    seedPostback(sdb, "acme", "a1", dayStart);
    seedPostback(sdb, "acme", "a2", dayStart);
    seedPostback(sdb, "cap", "c1", dayStart);
    seedRevenueRaw(sdb, { dt: date, click_id: "r1", source: "s2s_postback", revenue: 4 });
    seedRevenueRaw(sdb, { dt: date, click_id: "r2", source: "s2s_postback", revenue: 6 });
    seedRevenueRaw(sdb, { dt: date, click_id: "r3", source: "in_site", revenue: 99 }); // excluded (not s2s)

    const report = await dailyProviderReconciliation(env, date);
    expect(report.t).toBe("lg_provider_reconciliation");
    expect(report.ingested_s2s_revenue).toBe(10); // 4 + 6, in_site excluded
    expect(report.providers).toEqual([
      { provider: "acme", date, ingested_postback_count: 2, provider_report_total: null, variance: null, variance_flag: "NO_PROVIDER_REPORT_SOURCE" },
      { provider: "cap", date, ingested_postback_count: 1, provider_report_total: null, variance: null, variance_flag: "NO_PROVIDER_REPORT_SOURCE" },
    ]);
    expect(report.null_reasons.provider_report_total.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ingestProviderReports + seedDefaultMediaPlatforms
// ---------------------------------------------------------------------------

describeDb("ingestProviderReports — §25 script/API channel", () => {
  it("no configured adapter ⇒ honest structured no-op (ingested 0)", async () => {
    const { env } = freshDb();
    const res = await ingestProviderReports(env);
    expect(res).toMatchObject({ t: "lg_provider_report_ingest", ingested: 0, configured_adapters: [] });
  });

  it("a configured adapter stages its rows as source='script'", async () => {
    const { sdb, env } = freshDb();
    const adapter: ProviderReportAdapter = {
      name: "acme-report",
      configured() { return true; },
      async fetchRows() {
        return [{ click_id: "rc1", external_txn_id: "x1", revenue: 3, currency: "USD", offer_public_id: "lgo_a" }];
      },
    };
    const res = await ingestProviderReports(env, { adapters: [adapter] });
    expect(res.ingested).toBe(1);
    const row = sdb.prepare("SELECT source, booking_trigger, revenue FROM leadgen_revenue_raw WHERE click_id='rc1'").get() as { source: string; booking_trigger: string; revenue: number };
    expect(row).toEqual({ source: "script", booking_trigger: "conversion", revenue: 3 });
  });
});

describeDb("seedDefaultMediaPlatforms — §26 disabled-by-default facebook seed", () => {
  it("seeds facebook enabled=0 with value_multiplier=1; idempotent", async () => {
    const { sdb, env } = freshDb();
    await seedDefaultMediaPlatforms(env);
    await seedDefaultMediaPlatforms(env); // idempotent (INSERT OR IGNORE)
    const rows = sdb.prepare("SELECT platform, enabled, auth_secret_ref, value_multiplier FROM leadgen_media_platforms").all() as Array<{ platform: string; enabled: number; auth_secret_ref: string; value_multiplier: number }>;
    expect(rows).toEqual([{ platform: "facebook", enabled: 0, auth_secret_ref: "LEADGEN_S2S_TOKEN_FACEBOOK", value_multiplier: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// runLeadgenRevenueCron — fail-open + daily self-gate
// ---------------------------------------------------------------------------

describeDb("runLeadgenRevenueCron — isolated, fail-open, daily self-gate", () => {
  it("non-daily clock + unconfigured CH ⇒ ship/sweep no-op, daily_ran false, never throws", async () => {
    const { env } = freshDb();
    const summary = await runLeadgenRevenueCron(env, { client: unconfiguredClient, now: new Date("2026-07-07T12:34:00Z") });
    expect(summary.daily_ran).toBe(false);
    expect(summary.ship).toMatchObject({ configured: false });
    expect(summary.sweep).toMatchObject({ configured: false });
    expect(summary.fx).toBeUndefined();
  });

  it("force=true runs the daily tasks (fx / backfill / reconciliation / report ingest)", async () => {
    const { sdb, env } = freshDb();
    seedRevenueRaw(sdb, { dt: "2026-07-06", click_id: "c1", source: "s2s_postback", revenue: 2 });
    const summary = await runLeadgenRevenueCron(env, { client: writeClient(), now: new Date("2026-07-07T09:00:00Z"), force: true });
    expect(summary.daily_ran).toBe(true);
    expect(summary.fx?.t).toBe("lg_fx_refresh");
    expect(summary.backfill?.refreshed).toBe(true);
    expect(summary.reconciliation?.t).toBe("lg_provider_reconciliation");
    expect(summary.report_ingest?.t).toBe("lg_provider_report_ingest");
    // The daily FX refresh seeded the USD identity for the run date.
    const fx = sdb.prepare("SELECT usd_rate FROM leadgen_fx_rates WHERE currency='USD'").get() as { usd_rate: number } | undefined;
    expect(fx?.usd_rate).toBe(1);
  });

  it("a throwing CH client is contained — the cron returns a summary, never throws", async () => {
    const { sdb, env } = freshDb();
    const now = new Date("2026-07-07T12:00:00Z");
    // An in-window pending row forces the sweep to reach the CH query (which throws).
    seedUnmatched(sdb, "pthrow", Math.floor(now.getTime() / 1000) - 3600);
    const summary = await runLeadgenRevenueCron(env, { client: throwingClient, now });
    // ship no-ops (no insert path); sweep reaches the CH query which throws, caught by the cron → null.
    expect(summary.sweep).toBeNull();
    expect(summary.daily_ran).toBe(false);
  });

  it("daily self-gates to 00:07 UTC (a 00:07 clock runs the daily tasks without force)", async () => {
    const { env } = freshDb();
    const summary = await runLeadgenRevenueCron(env, { client: readOnlyClient, now: new Date("2026-07-07T00:07:00Z") });
    expect(summary.daily_ran).toBe(true);
    expect(summary.fx?.t).toBe("lg_fx_refresh");
  });
});
