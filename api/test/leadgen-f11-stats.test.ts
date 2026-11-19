// F11 — Offers stats: redirect clicks apart from visitor clicks (plan Section
// 3 F, Section 8 "Offers stats"; backlog/CONTRACT-F11.md task 11).
//
// What these tests hold:
//   * the stats copy (leadgen/mirror-sync.ts) carries ClickHouse
//     lg_offer_daily.redirect_clicks into D1 leadgen_analytics_offer
//     .redirect_clicks like the other columns — and never fails while the
//     ClickHouse change is not applied yet: ClickHouse then refuses the
//     column, the copy reads again without it, syncs every other column, and
//     leaves the D1 value as it is (never a made-up 0). Any other ClickHouse
//     failure is still reported;
//   * one visitor click + one redirect click on the same Offer show as
//     Clicks 2, Visitor clicks 1, Redirect clicks 1 (Visitor CTR = visitor
//     clicks ÷ impressions) on the Offer's Analytics tab, and as
//     "Redirect clicks" 1 in the Offers list — through the REAL admin router,
//     the REAL endpoint and the list's REAL after-paint script (mini-DOM);
//   * "Clicks" and "CTR" keep counting every click.
// ClickHouse is always a mock client (no connection).

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { LeadgenChError, type LeadgenChClient } from "../src/leadgen/clickhouse";
import { MIRRORS, chSelect, syncLeadgenAnalytics } from "../src/leadgen/mirror-sync";
import { miniDocument, type MiniNode } from "./helpers/mini-dom";

afterEach(() => {
  vi.restoreAllMocks();
});

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
          sdb.prepare(sql).run(...binds);
          return { success: true, meta: {} };
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

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const BASE_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql",
  "0043_leadgen_routing_rules.sql",
  "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql",
  "0046_leadgen_rework_m1_variants.sql",
  "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql",
  "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql",
  "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql",
  "0053_leadgen_rework_m12_othergroup_retirement.sql",
  "0057_leadgen_offer_test_verdict.sql",
  "0060_leadgen_offer_static_creative.sql",
  "0061_leadgen_routing_present_only_offer.sql",
  "0062_leadgen_auction_waterfalls.sql",
  "0063_leadgen_auction_tier_rules.sql",
] as const;
const F11_MIGRATION = "0066_leadgen_redirect_after_shown.sql";

function createDb(opts: { withF11Migration?: boolean } = {}): SqliteDb {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(sdb, "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);");
  const files = opts.withF11Migration === false ? BASE_MIGRATIONS : [...BASE_MIGRATIONS, F11_MIGRATION];
  for (const file of files) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
}

function buildEnv(db: D1Database): Env {
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
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

const API = "/api/admin/leadgen";
const TODAY = new Date().toISOString().slice(0, 10);

async function createOffer(env: Env, name: string): Promise<{ id: number; public_id: string }> {
  const res = await admin.request(
    `${API}/offers`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        offer_name: name,
        activity: "quote_funnel",
        vertical: "loans",
        conversion_tracking_method: "s2s_postback",
        offer_type: "cpc",
        placements: [`pl-${mintPublicId("offer").slice(-8)}`],
        cap_enabled: false,
        calls_provider_api: false,
        bid_source: "static",
      }),
    },
    env,
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: number; public_id: string };
}

// --- mock ClickHouse ------------------------------------------------------------

type ChRow = Record<string, unknown>;

// lg_offer_daily answers like a real server: a column the table lacks makes
// the whole read fail (with the given wording); `failWith` fails any read.
function offerDailyClient(
  rows: ChRow[],
  opts: { tableHasRedirectClicks?: boolean; missingColumnWording?: "current" | "older"; failWith?: Error } = {},
): { client: LeadgenChClient; offerReads: string[] } {
  const offerReads: string[] = [];
  const client: LeadgenChClient = {
    configured: true,
    async query<T>(sql: string): Promise<{ rows: T[]; configured: boolean }> {
      if (!sql.includes("FROM lg_offer_daily FINAL")) return { rows: [], configured: true };
      offerReads.push(sql);
      if (opts.failWith !== undefined) throw opts.failWith;
      const hasColumn = opts.tableHasRedirectClicks !== false;
      if (!hasColumn && sql.includes("redirect_clicks")) {
        throw new LeadgenChError(
          opts.missingColumnWording === "older"
            ? "Code: 47. DB::Exception: Missing columns: 'redirect_clicks' while processing query: 'SELECT offer_id, dt, offer_impressions, clicks, unique_clicks, conversions, revenue, redirect_clicks FROM lg_offer_daily FINAL', required columns: 'offer_id' 'dt' (UNKNOWN_IDENTIFIER) (version 23.8.1.1)"
            : "Code: 47. DB::Exception: Unknown expression identifier `redirect_clicks` in scope SELECT offer_id, dt, offer_impressions, clicks, unique_clicks, conversions, revenue, redirect_clicks FROM lg_offer_daily FINAL. (UNKNOWN_IDENTIFIER) (version 24.10.1.2812 (official build))",
          404,
        );
      }
      const shaped = hasColumn
        ? rows
        : rows.map((r) => {
            const { redirect_clicks: _drop, ...rest } = r;
            return rest;
          });
      return { rows: shaped as unknown as T[], configured: true };
    },
  };
  return { client, offerReads };
}

function offerRow(sdb: SqliteDb, publicId: string): Record<string, unknown> | undefined {
  return sdb
    .prepare("SELECT offer_public_id, date, offer_impressions, clicks, unique_clicks, conversions, revenue, redirect_clicks FROM leadgen_analytics_offer WHERE offer_public_id = ?")
    .get(publicId) as Record<string, unknown> | undefined;
}

// ===========================================================================
// the stats copy
// ===========================================================================

describeDb("the stats copy (mirror-sync.ts) — lg_offer_daily.redirect_clicks → leadgen_analytics_offer.redirect_clicks", () => {
  it("asks ClickHouse for redirect_clicks with the other Offer columns", () => {
    const spec = MIRRORS.find((m) => m.d1Table === "leadgen_analytics_offer")!;
    const sql = chSelect(spec);
    expect(sql).toContain("FROM lg_offer_daily FINAL");
    expect(sql).toMatch(/\bredirect_clicks\b/);
    expect(sql).toMatch(/\bclicks\b/);
  });

  it("copies redirect_clicks next to clicks, like every other column", async () => {
    const sdb = createDb();
    const env = buildEnv(d1FromSqlite(sdb));
    const { client } = offerDailyClient([
      { offer_id: "lgo_A", dt: TODAY, offer_impressions: 10, clicks: 2, unique_clicks: 2, conversions: 0, revenue: 65, redirect_clicks: 1 },
    ]);
    const summary = await syncLeadgenAnalytics(env, { client, now: new Date() });

    expect(summary.errors).toEqual([]);
    expect(offerRow(sdb, "lgo_A")).toEqual({
      offer_public_id: "lgo_A",
      date: TODAY,
      offer_impressions: 10,
      clicks: 2,
      unique_clicks: 2,
      conversions: 0,
      revenue: 65,
      redirect_clicks: 1,
    });
  });

  it("a later sync updates redirect_clicks in place (ON CONFLICT … DO UPDATE)", async () => {
    const sdb = createDb();
    const env = buildEnv(d1FromSqlite(sdb));
    await syncLeadgenAnalytics(env, {
      client: offerDailyClient([{ offer_id: "lgo_A", dt: TODAY, offer_impressions: 10, clicks: 2, unique_clicks: 2, conversions: 0, revenue: 0, redirect_clicks: 1 }]).client,
      now: new Date(),
    });
    await syncLeadgenAnalytics(env, {
      client: offerDailyClient([{ offer_id: "lgo_A", dt: TODAY, offer_impressions: 12, clicks: 5, unique_clicks: 4, conversions: 0, revenue: 0, redirect_clicks: 3 }]).client,
      now: new Date(),
    });
    expect(offerRow(sdb, "lgo_A")).toMatchObject({ clicks: 5, redirect_clicks: 3 });
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_analytics_offer").get() as { n: number }).n).toBe(1);
  });

  it("before the ClickHouse change is applied: ClickHouse refuses the column, the copy still syncs every other column with NO error, and redirect_clicks keeps its D1 value", async () => {
    const sdb = createDb();
    const env = buildEnv(d1FromSqlite(sdb));
    // A D1 row that already holds a redirect count (e.g. from a backfill).
    sdb
      .prepare("INSERT INTO leadgen_analytics_offer (offer_public_id, date, offer_impressions, clicks, unique_clicks, conversions, revenue, redirect_clicks) VALUES ('lgo_A', ?, 1, 1, 1, 0, 0, 3)")
      .run(TODAY);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client, offerReads } = offerDailyClient(
      [
        { offer_id: "lgo_A", dt: TODAY, offer_impressions: 10, clicks: 7, unique_clicks: 6, conversions: 1, revenue: 9.5, redirect_clicks: 99 },
        { offer_id: "lgo_B", dt: TODAY, offer_impressions: 4, clicks: 1, unique_clicks: 1, conversions: 0, revenue: 0, redirect_clicks: 99 },
      ],
      { tableHasRedirectClicks: false },
    );
    const summary = await syncLeadgenAnalytics(env, { client, now: new Date() });

    expect(summary.errors).toEqual([]);
    const offer = summary.mirrors.find((m) => m.mirror === "leadgen_analytics_offer");
    expect(offer?.error).toBeUndefined();
    expect(offer?.rows).toBe(2);
    expect(offerReads).toHaveLength(2); // the refused read, then one read without the column
    expect(offerReads[1]).not.toContain("redirect_clicks");
    // every other column synced; the D1 redirect count is untouched (3), a new row keeps the default 0
    expect(offerRow(sdb, "lgo_A")).toMatchObject({ offer_impressions: 10, clicks: 7, unique_clicks: 6, conversions: 1, revenue: 9.5, redirect_clicks: 3 });
    expect(offerRow(sdb, "lgo_B")).toMatchObject({ clicks: 1, redirect_clicks: 0 });
  });

  it("the older ClickHouse wording for a missing column ('Missing columns: …') is recognised the same way", async () => {
    const sdb = createDb();
    const env = buildEnv(d1FromSqlite(sdb));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { client } = offerDailyClient(
      [{ offer_id: "lgo_A", dt: TODAY, offer_impressions: 10, clicks: 2, unique_clicks: 2, conversions: 0, revenue: 0, redirect_clicks: 1 }],
      { tableHasRedirectClicks: false, missingColumnWording: "older" },
    );
    const summary = await syncLeadgenAnalytics(env, { client, now: new Date() });
    expect(summary.errors).toEqual([]);
    expect(offerRow(sdb, "lgo_A")).toMatchObject({ clicks: 2, redirect_clicks: 0 });
  });

  it("any OTHER ClickHouse failure is still reported for the Offer copy, and is not retried as if the column were missing", async () => {
    const sdb = createDb();
    const env = buildEnv(d1FromSqlite(sdb));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client, offerReads } = offerDailyClient([], {
      failWith: new LeadgenChError("Code: 241. DB::Exception: Memory limit (total) exceeded: would use 9.31 GiB. (MEMORY_LIMIT_EXCEEDED)", 500),
    });
    const summary = await syncLeadgenAnalytics(env, { client, now: new Date() });
    expect(summary.errors.some((e) => e.startsWith("leadgen_analytics_offer:"))).toBe(true);
    expect(offerReads).toHaveLength(1);
  });
});

// ===========================================================================
// the endpoint + the Analytics tab + the Offers list
// ===========================================================================

// One visitor click + one redirect click on the same Offer, today, through
// the real stats copy (10 card views).
async function seedOneOfEach(): Promise<{ sdb: SqliteDb; env: Env; offer: { id: number; public_id: string } }> {
  const sdb = createDb();
  const env = buildEnv(d1FromSqlite(sdb));
  const offer = await createOffer(env, "Sample Business Loan Offer");
  const { client } = offerDailyClient([
    { offer_id: offer.public_id, dt: TODAY, offer_impressions: 10, clicks: 2, unique_clicks: 2, conversions: 0, revenue: 65, redirect_clicks: 1 },
  ]);
  const summary = await syncLeadgenAnalytics(env, { client, now: new Date() });
  expect(summary.errors).toEqual([]);
  return { sdb, env, offer };
}

function statCards(html: string): Array<{ label: string; value: string }> {
  return [...html.matchAll(/<div class="stat-card"><div class="stat-label">([^<]+)<\/div><div class="stat-value">([^<]*)<\/div><\/div>/g)].map((m) => ({
    label: m[1]!,
    value: m[2]!,
  }));
}

describeDb("Offers stats — one visitor click + one redirect click on the same Offer", () => {
  it("the Analytics endpoint: Clicks 2, Visitor clicks 1, Redirect clicks 1; CTR keeps every click, Visitor CTR = visitor clicks ÷ impressions", async () => {
    const { env, offer } = await seedOneOfEach();
    const res = await admin.request(`${API}/offers/${offer.public_id}/analytics`, {}, env);
    expect(res.status).toBe(200);
    const { analytics } = (await res.json()) as { analytics: Record<string, number | null> };
    expect(analytics["clicks"]).toBe(2);
    expect(analytics["visitor_clicks"]).toBe(1);
    expect(analytics["redirect_clicks"]).toBe(1);
    expect(analytics["offer_impressions"]).toBe(10);
    expect(analytics["ctr"]).toBeCloseTo(0.2, 10); // unchanged meaning: every click
    expect(analytics["visitor_ctr"]).toBeCloseTo(0.1, 10);
    expect(analytics["rpc"]).toBeCloseTo(32.5, 10); // revenue still spread over every click
  });

  it("Offer → Analytics tab: 'Visitor clicks', 'Redirect clicks', 'Visitor CTR' right after 'Clicks', with the one-line help", async () => {
    const { env, offer } = await seedOneOfEach();
    const res = await admin.request(`/admin/leadgen/offers/${offer.public_id}/edit`, {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    const cards = statCards(html);
    const labels = cards.map((c) => c.label);
    const at = labels.indexOf("Clicks");
    expect(at).toBeGreaterThanOrEqual(0);
    expect(labels.slice(at, at + 4)).toEqual(["Clicks", "Visitor clicks", "Redirect clicks", "Visitor CTR"]);
    const value = (label: string) => cards.find((c) => c.label === label)?.value;
    expect(value("Clicks")).toBe("2");
    expect(value("Visitor clicks")).toBe("1");
    expect(value("Redirect clicks")).toBe("1");
    expect(value("Visitor CTR")).toBe("10.00%");
    expect(value("CTR")).toBe("20.00%");
    expect(value("Impressions")).toBe("10");
    // the existing cards are all still there
    for (const label of ["Impressions", "Unique clicks", "Conversions", "CVR", "Revenue", "RPC", "RPM"]) {
      expect(labels, label).toContain(label);
    }
    const help = /<p class="form-help" data-lg-redirect-clicks-help>([^<]+)<\/p>/.exec(html)?.[1] ?? "";
    expect(help).toContain("Redirect clicks");
    expect(help).toContain("Visitor clicks");
    expect(help).toContain("Visitor CTR");
    expect(help).toContain("countdown");
  });

  it("LeadGen → Offers list: a 'Redirect clicks' column right after 'Clicks', filled with 1 by the list's own after-paint script", async () => {
    const { env, offer } = await seedOneOfEach();
    const res = await admin.request("/admin/leadgen/offers", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();

    const headers = [...html.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]);
    const clicksAt = headers.indexOf("Clicks");
    expect(clicksAt).toBeGreaterThanOrEqual(0);
    expect(headers[clicksAt + 1]).toBe("Redirect clicks");
    expect(html).toContain('data-metric-col="redirect_clicks"');
    expect(html).toContain('<td class="lg-num" data-metric="redirect_clicks"><span class="skel" aria-hidden="true"></span></td>');
    // the empty row spans every column, the new one included
    expect(headers.length).toBe(20);

    // Run the list's REAL after-paint script against the REAL page and the REAL endpoint.
    const doc = miniDocument(html);
    const fnAt = html.indexOf("function fmtInt(v)");
    const start = html.lastIndexOf("(function () {", fnAt);
    const end = html.indexOf("}());", html.indexOf("window.lgUi = {")) + "}());".length;
    expect(start).toBeGreaterThan(-1);
    const script = html.slice(start, end);
    const pending: Array<Promise<unknown>> = [];
    const fetchStub = (url: string): Promise<Response> => {
      const p = Promise.resolve(admin.request(url, {}, env));
      pending.push(p);
      return p;
    };
    const windowObj: Record<string, unknown> = { showToast: () => undefined };
    runInNewContext(script, { window: windowObj, document: doc, fetch: fetchStub, console });
    for (let i = 0; i < 50; i++) {
      await Promise.all(pending.splice(0));
      await new Promise((r) => setImmediate(r));
    }
    const row = doc.querySelector(`tr[data-offer-public-id="${offer.public_id}"]`) as MiniNode;
    expect(row).not.toBeNull();
    const cell = (metric: string) => (row.querySelector(`td[data-metric="${metric}"]`) as MiniNode).textContent;
    expect(cell("clicks")).toBe("2");
    expect(cell("redirect_clicks")).toBe("1");
    expect(cell("offer_impressions")).toBe("10");
    expect(cell("ctr")).toBe("20.00%");
  });

  it("an Offer with no stats yet: Redirect clicks 0, Visitor clicks 0, Visitor CTR '—'", async () => {
    const sdb = createDb();
    const env = buildEnv(d1FromSqlite(sdb));
    const offer = await createOffer(env, "Fresh Offer");
    const api = (await (await admin.request(`${API}/offers/${offer.public_id}/analytics`, {}, env)).json()) as {
      analytics: Record<string, number | null>;
    };
    expect(api.analytics["redirect_clicks"]).toBe(0);
    expect(api.analytics["visitor_clicks"]).toBe(0);
    expect(api.analytics["visitor_ctr"]).toBeNull();
    const html = await (await admin.request(`/admin/leadgen/offers/${offer.public_id}/edit`, {}, env)).text();
    expect(statCards(html).find((c) => c.label === "Visitor CTR")?.value).toBe("—");
  });

  it("a database one migration behind (no redirect_clicks column yet) still shows the stats: every click counts as a visitor click", async () => {
    const sdb = createDb({ withF11Migration: false });
    const env = buildEnv(d1FromSqlite(sdb));
    const offer = await createOffer(env, "Older Database Offer");
    sdb
      .prepare("INSERT INTO leadgen_analytics_offer (offer_public_id, date, offer_impressions, clicks, unique_clicks, conversions, revenue) VALUES (?, ?, 10, 2, 2, 0, 0)")
      .run(offer.public_id, TODAY);
    const res = await admin.request(`${API}/offers/${offer.public_id}/analytics`, {}, env);
    expect(res.status).toBe(200);
    const { analytics } = (await res.json()) as { analytics: Record<string, number | null> };
    expect(analytics["clicks"]).toBe(2);
    expect(analytics["redirect_clicks"]).toBe(0);
    expect(analytics["visitor_clicks"]).toBe(2);
    expect(analytics["visitor_ctr"]).toBeCloseTo(0.2, 10);
  });
});
