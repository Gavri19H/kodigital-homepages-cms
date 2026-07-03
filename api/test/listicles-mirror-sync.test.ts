// Listicles Phase 8 — CH → D1 mirror sync + read-path light-up, over REAL
// sqlite (node:sqlite) running the REAL migrations (0032/0033/0034) and the
// REAL Phase-2 read handlers through src/admin/router. The CH side is a MOCK
// client (no live CH — honest per the §17 residual). Proves:
//   * idempotent §18 upsert (run twice → identical rows)
//   * offer_id → offer_public_id mapping (DEV-6)
//   * bounded rolling window (out-of-window CH rows never land)
//   * per-table error isolation (one table's failure spares the others)
//   * the EXISTING read endpoints light up with the synced numbers + NULLIF
//     ratios (ctr/cvr/rpc/rpm/pps/rule_match_rate) — no more zeros
//   * rebuild-range endpoint (validation + fail-open no-op) + rebuildRange data path
//   * reconciliation ch_ingested wiring (measured / error / absent)

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import type { ListicleChClient } from "../src/listicles/clickhouse";
import { ListicleChError } from "../src/listicles/clickhouse";
import { syncListicleAnalytics, rebuildRange, readChCleanEventCount } from "../src/listicles/mirror-sync";
import { buildListicleReconciliationReport } from "../src/analytics/listicle-reconciliation";

// --- node:sqlite harness (repo pattern; see listicles-offers-api.test.ts) ---

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
  runSql(sdb, "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);");
  runSql(sdb, migration("0032_listicles_core.sql"));
  runSql(sdb, migration("0033_listicles_analytics_mirror.sql"));
  runSql(sdb, migration("0034_listicles_revenue_infra.sql"));
  sdb.prepare("INSERT INTO sites (id, name) VALUES (?, ?)").run("st_test", "Test Site");
  // Core entities the read endpoints resolve (public_ids match the CH rows).
  sdb.prepare(
    "INSERT INTO listicle_offers (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_url_template, payout_method) VALUES (?,?,?,?,?,?,?,?)",
  ).run("off_a", "Offer A", "acme", "lead", "pets", "s2s_postback", "https://t.example/c?cid={click_id}", "offsite");
  sdb.prepare(
    "INSERT INTO listicle_sections (public_id, section_name, headline_text, content_json) VALUES (?,?,?,?)",
  ).run("sec_a", "Section A", "Headline A", "{}");
  sdb.prepare(
    "INSERT INTO listicle_articles (public_id, site_id, slug, article_name) VALUES (?,?,?,?)",
  ).run("art_a", "st_test", "article-a", "Article A");
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
    DEV_BYPASS_AUTH: "true",
    ...extra,
  } as Env;
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

// --- Mock CH client -----------------------------------------------------------
// Returns canned rows per CH daily table, FILTERED by the [from,to] window the
// sync passes (so a wrong/absent window is caught). Handles the reconciliation
// uniqExact(event_id) count query. Optional per-table failure injection.
const CH_TODAY = "2026-07-03";
const CH_YDAY = "2026-07-02";
const CH_OUT_OF_WINDOW = "2026-06-01";

// Some numerics are STRINGS on purpose — ClickHouse quotes 64-bit ints unless
// output_format_json_quote_64bit_integers=0; the coercion must handle both.
const CH_ROWS: Record<string, Array<Record<string, unknown>>> = {
  lst_offer_daily: [
    { offer_id: "off_a", dt: CH_TODAY, impressions: "100", clicks: "10", unique_clicks: 8, conversions: 2, revenue: 50 },
    { offer_id: "off_a", dt: CH_OUT_OF_WINDOW, impressions: 999, clicks: 99, unique_clicks: 9, conversions: 9, revenue: 999 },
    { offer_id: "", dt: CH_TODAY, impressions: 5, clicks: 1, unique_clicks: 1, conversions: 0, revenue: 0 }, // notNull skip
  ],
  lst_section_daily: [
    { section_id: "sec_a", dt: CH_TODAY, impressions: 200, clicks: 20, unique_clicks: 16, conversions: 4, revenue: 80 },
  ],
  lst_article_daily: [
    {
      article_id: "art_a", article_version_id: "ver_a", article_version_revision: 1,
      article_experiment_id: "exp_a", article_split: 50, dt: CH_TODAY,
      total_visits: 300, unique_visits: 250, impressions: 200, clicks: 20, unique_clicks: 16, conversions: 4, revenue: 80,
    },
  ],
  lst_drilldown_daily: [
    {
      article_id: "art_a", article_version_id: "ver_a", article_version_revision: 1,
      article_experiment_id: "exp_a", article_split: 50, page_index: 1, page_selection_mode: "rule_based",
      section_id: "sec_a", page_candidate_id: "cand_a", ab_test_id: "", ab_split: 70,
      page_rule_set_id: "rs_a", page_rule_id: "rule_a", selection_reason: "rule_match", matched_rule_json_hash: "h",
      dt: CH_TODAY, impressions: 150, clicks: 15, unique_clicks: 12, conversions: 3, revenue: 60,
      visits: 180, matched_sessions: 170, fallback_sessions: 30,
    },
  ],
  lst_link_instance_daily: [
    {
      link_instance_id: "lnk_a", section_id: "sec_a", offer_id: "off_a", article_id: "art_a",
      article_version_id: "ver_a", article_version_revision: 1, page_index: 1, page_candidate_id: "cand_a",
      page_selection_mode: "rule_based", page_rule_id: "rule_a", selection_reason: "rule_match",
      section_block_id: "blk_a", link_role: "button", link_position_index: 0,
      button_style_id: "bs_a", button_group_id: "bg_a", anchor_text_hash: "ah", analytics_label: "lab_a",
      dt: CH_TODAY, impressions: 120, clicks: 12, unique_clicks: 10, conversions: 2, revenue: 40,
    },
  ],
};

interface MockOpts { failTable?: string; eventCount?: number; }

function mockChClient(opts?: MockOpts): ListicleChClient {
  return {
    configured: true,
    async query<T>(sql: string, params?: Record<string, string | number>): Promise<{ rows: T[]; configured: boolean }> {
      // reconciliation count
      if (sql.includes("lst_events_raw") && sql.includes("uniqExact")) {
        return { rows: [{ n: opts?.eventCount ?? 0 }] as unknown as T[], configured: true };
      }
      const table = Object.keys(CH_ROWS).find((t) => sql.includes(`FROM ${t} FINAL`));
      if (!table) return { rows: [], configured: true };
      if (opts?.failTable && sql.includes(`FROM ${opts.failTable} FINAL`)) {
        throw new ListicleChError("mock CH failure", 500);
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

const NOW = new Date("2026-07-03T12:00:00Z"); // window ⇒ [2026-07-02, 2026-07-03]

const DatabaseSync = loadDatabaseSync();
const d = DatabaseSync === null ? describe.skip : describe;

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

d("mirror sync — write side", () => {
  it("upserts each CH daily table into its D1 mirror; offer_id→offer_public_id (DEV-6); notNull skip; window bound", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    const summary = await syncListicleAnalytics(env, { client: mockChClient(), now: NOW });

    expect(summary.configured).toBe(true);
    expect(summary.window).toEqual({ from: CH_YDAY, to: CH_TODAY });
    expect(summary.errors).toEqual([]);

    // Offer: only the in-window, non-empty-id row lands (out-of-window + empty skipped).
    const offers = sdb.prepare("SELECT * FROM listicle_analytics_offer").all() as Array<Record<string, unknown>>;
    expect(offers).toHaveLength(1);
    expect(offers[0]!.offer_public_id).toBe("off_a"); // DEV-6: CH offer_id → mirror offer_public_id
    expect(offers[0]!.date).toBe(CH_TODAY);
    expect(offers[0]!.impressions).toBe(100); // coerced from the STRING "100"
    expect(offers[0]!.revenue).toBe(50);
    // Out-of-window date never landed.
    const outOfWindow = sdb.prepare("SELECT COUNT(*) AS n FROM listicle_analytics_offer WHERE date = ?").get(CH_OUT_OF_WINDOW) as { n: number };
    expect(outOfWindow.n).toBe(0);

    // Link-instance: offer_id → offer_public_id here too (DEV-6).
    const li = sdb.prepare("SELECT * FROM listicle_analytics_link_instance").all() as Array<Record<string, unknown>>;
    expect(li).toHaveLength(1);
    expect(li[0]!.offer_public_id).toBe("off_a");
    expect(li[0]!.link_instance_id).toBe("lnk_a");
    expect(li[0]!.link_role).toBe("button");

    // Drilldown: traffic_allocation ← ab_split; matched/fallback carried.
    const dr = sdb.prepare("SELECT * FROM listicle_analytics_drilldown").get() as Record<string, unknown>;
    expect(dr.traffic_allocation).toBe(70);
    expect(dr.matched_sessions).toBe(170);
    expect(dr.fallback_sessions).toBe(30);
    expect(dr.page_rule_priority).toBeNull(); // not carried by CH raw — stays NULL

    // Article: variant_label not carried by CH raw — stays default ''.
    const ar = sdb.prepare("SELECT * FROM listicle_analytics_article").get() as Record<string, unknown>;
    expect(ar.article_experiment_id).toBe("exp_a");
    expect(ar.article_variant_label).toBe("");
    expect(ar.total_visits).toBe(300);
  });

  it("is idempotent: running twice yields identical rows (no dupes, same values)", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    await syncListicleAnalytics(env, { client: mockChClient(), now: NOW });
    const after1 = sdb.prepare("SELECT offer_public_id, date, impressions, clicks, revenue FROM listicle_analytics_offer ORDER BY offer_public_id, date").all();
    const count1 = (sdb.prepare("SELECT COUNT(*) AS n FROM listicle_analytics_offer").get() as { n: number }).n;

    await syncListicleAnalytics(env, { client: mockChClient(), now: NOW });
    const after2 = sdb.prepare("SELECT offer_public_id, date, impressions, clicks, revenue FROM listicle_analytics_offer ORDER BY offer_public_id, date").all();
    const count2 = (sdb.prepare("SELECT COUNT(*) AS n FROM listicle_analytics_offer").get() as { n: number }).n;

    expect(count2).toBe(count1);
    expect(after2).toEqual(after1);
    // Every mirror stays single-row too.
    for (const t of ["listicle_analytics_section", "listicle_analytics_article", "listicle_analytics_drilldown", "listicle_analytics_link_instance"]) {
      expect((sdb.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n).toBe(1);
    }
  });

  it("isolates a per-table failure — the other four still sync", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    const summary = await syncListicleAnalytics(env, { client: mockChClient({ failTable: "lst_section_daily" }), now: NOW });

    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain("listicle_analytics_section");
    const section = summary.mirrors.find((m) => m.mirror === "listicle_analytics_section");
    expect(section?.rows).toBe(0);
    expect(section?.error).toBeDefined();

    // The section mirror is empty; the others populated.
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM listicle_analytics_section").get() as { n: number }).n).toBe(0);
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM listicle_analytics_offer").get() as { n: number }).n).toBe(1);
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM listicle_analytics_article").get() as { n: number }).n).toBe(1);
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM listicle_analytics_link_instance").get() as { n: number }).n).toBe(1);
  });

  it("fail-open no-op when CH secrets are absent (no client injected)", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb)); // no CH_URL/USER/PASSWORD
    const summary = await syncListicleAnalytics(env, { now: NOW });
    expect(summary.configured).toBe(false);
    expect(summary.skipped).toContain("CH credentials");
    expect(summary.total_rows).toBe(0);
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM listicle_analytics_offer").get() as { n: number }).n).toBe(0);
  });

  it("rebuildRange over an explicit window mirrors the data (backfill path)", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    const summary = await rebuildRange(env, CH_YDAY, CH_TODAY, { client: mockChClient() });
    expect(summary.configured).toBe(true);
    expect(summary.total_rows).toBeGreaterThan(0);
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM listicle_analytics_offer").get() as { n: number }).n).toBe(1);
  });
});

d("read-path light-up — the EXISTING Phase-2 endpoints surface the synced numbers", () => {
  it("offer/section analytics: zeros before sync, real numbers + NULLIF ratios after", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));

    // Before sync — empty mirror → zeros, never a 500.
    const before = await json(await admin.request(`/api/admin/listicles/offers/off_a/analytics?from=${CH_YDAY}&to=${CH_TODAY}`, {}, env));
    expect((before.analytics as Record<string, number>).impressions).toBe(0);
    expect((before.analytics as Record<string, number>).ctr).toBe(0);

    await syncListicleAnalytics(env, { client: mockChClient(), now: NOW });

    const offer = (await json(await admin.request(`/api/admin/listicles/offers/off_a/analytics?from=${CH_YDAY}&to=${CH_TODAY}`, {}, env))).analytics as Record<string, number>;
    expect(offer.impressions).toBe(100);
    expect(offer.clicks).toBe(10);
    expect(offer.unique_clicks).toBe(8);
    expect(offer.conversions).toBe(2);
    expect(offer.revenue).toBe(50);
    expect(offer.ctr).toBeCloseTo(0.1, 6);      // 10/100
    expect(offer.cvr).toBeCloseTo(0.2, 6);      // 2/10
    expect(offer.rpc).toBeCloseTo(5, 6);        // 50/10
    expect(offer.rpm).toBeCloseTo(500, 6);      // 50/100*1000

    const section = (await json(await admin.request(`/api/admin/listicles/sections/sec_a/analytics?from=${CH_YDAY}&to=${CH_TODAY}`, {}, env))).analytics as Record<string, number>;
    expect(section.impressions).toBe(200);
    expect(section.ctr).toBeCloseTo(0.1, 6);    // 20/200
  });

  it("article analytics: total + per-version rows with pps", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    await syncListicleAnalytics(env, { client: mockChClient(), now: NOW });

    const a = (await json(await admin.request(`/api/admin/listicles/articles/art_a/analytics?from=${CH_YDAY}&to=${CH_TODAY}`, {}, env))).analytics as {
      total: Record<string, number>; versions: Array<Record<string, unknown>>;
    };
    expect(a.total.total_visits).toBe(300);
    expect(a.total.impressions).toBe(200);
    expect((a.total as Record<string, number>).pps).toBeCloseTo(200 / 300, 6);
    expect(a.versions).toHaveLength(1);
    expect(a.versions[0]!.article_version_id).toBe("ver_a");
  });

  it("drilldown: rule page exposes rule_match_rate = matched/(matched+fallback)", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    await syncListicleAnalytics(env, { client: mockChClient(), now: NOW });

    const dd = (await json(await admin.request(`/api/admin/listicles/articles/art_a/drilldown?from=${CH_YDAY}&to=${CH_TODAY}`, {}, env))).drilldown as {
      versions: Array<{ pages: Array<{ candidates: Array<Record<string, number>> }> }>;
    };
    const cand = dd.versions[0]!.pages[0]!.candidates[0]!;
    expect(cand.ctr).toBeCloseTo(0.1, 6);            // 15/150
    expect(cand.matched_sessions).toBe(170);
    expect(cand.fallback_sessions).toBe(30);
    expect(cand.rule_match_rate).toBeCloseTo(0.85, 6); // 170/200
  });

  it("link-instances (§30.7): per-CTA rows with offer_public_id + ratios", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    await syncListicleAnalytics(env, { client: mockChClient(), now: NOW });

    const body = (await json(await admin.request(`/api/admin/listicles/articles/art_a/link-instances?from=${CH_YDAY}&to=${CH_TODAY}`, {}, env))).link_instances as {
      items: Array<Record<string, number | string>>;
    };
    expect(body.items).toHaveLength(1);
    const item = body.items[0]!;
    expect(item.link_instance_id).toBe("lnk_a");
    expect(item.offer_public_id).toBe("off_a");
    expect(item.link_role).toBe("button");
    expect(item.clicks).toBe(12);
    expect(item.ctr).toBeCloseTo(0.1, 6);            // 12/120
  });
});

d("rebuild-range endpoint (§18 manual backfill)", () => {
  it("valid body, no CH secrets → 200 fail-open no-op summary", async () => {
    const env = buildEnv(d1FromSqlite(createDb(DatabaseSync as DatabaseSyncCtor)));
    const res = await admin.request("/api/admin/listicles/analytics/rebuild-range", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: CH_YDAY, to: CH_TODAY }),
    }, env);
    expect(res.status).toBe(200);
    const summary = (await json(res)).rebuild as Record<string, unknown>;
    expect(summary.configured).toBe(false);
    expect(String(summary.skipped)).toContain("CH credentials");
    expect(summary.total_rows).toBe(0);
  });

  it("rejects a bad date / reversed range", async () => {
    const env = buildEnv(d1FromSqlite(createDb(DatabaseSync as DatabaseSyncCtor)));
    const bad = await admin.request("/api/admin/listicles/analytics/rebuild-range", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: "nope", to: CH_TODAY }),
    }, env);
    expect(bad.status).toBe(400);
    const rev = await admin.request("/api/admin/listicles/analytics/rebuild-range", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: CH_TODAY, to: CH_YDAY }),
    }, env);
    expect(rev.status).toBe(400);
  });
});

d("reconciliation ch_ingested wiring (§31.6)", () => {
  it("populates ch_ingested from CH when configured; variance PARTIAL", async () => {
    const env = buildEnv(d1FromSqlite(createDb(DatabaseSync as DatabaseSyncCtor)), { CACHE: inMemoryKv() });
    const report = await buildListicleReconciliationReport(env, CH_TODAY, { chClient: mockChClient({ eventCount: 42 }) });
    expect(report.ch_ingested).toBe(42);
    expect(report.athena_landed).toBeNull(); // external pipeline owns Athena
    expect(report.variance).toContain("PARTIAL");
    expect(report.null_reasons.ch_ingested).toBeUndefined();
  });

  it("ch_ingested stays NULL + reason when the CH query throws (fail-open)", async () => {
    const throwing: ListicleChClient = {
      configured: true,
      async query() { throw new ListicleChError("ch down", 500); },
    };
    const env = buildEnv(d1FromSqlite(createDb(DatabaseSync as DatabaseSyncCtor)), { CACHE: inMemoryKv() });
    const report = await buildListicleReconciliationReport(env, CH_TODAY, { chClient: throwing });
    expect(report.ch_ingested).toBeNull();
    expect(report.null_reasons.ch_ingested).toContain("CH query failed");
    expect(report.variance).toBe("UNMEASURABLE_PRE_PHASE8");
  });
});

d("readChCleanEventCount", () => {
  it("returns the distinct-clean count when configured", async () => {
    const env = buildEnv(d1FromSqlite(createDb(DatabaseSync as DatabaseSyncCtor)));
    const res = await readChCleanEventCount(env, CH_TODAY, { client: mockChClient({ eventCount: 7 }) });
    expect(res.count).toBe(7);
  });
  it("NULL + reason when unconfigured", async () => {
    const env = buildEnv(d1FromSqlite(createDb(DatabaseSync as DatabaseSyncCtor)));
    const res = await readChCleanEventCount(env, CH_TODAY);
    expect(res.count).toBeNull();
    expect(res.reason).toContain("CH credentials");
  });
});
