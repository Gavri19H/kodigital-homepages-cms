// Listicles Phase 9 — §31.7 reconciliation/backfill + §19 shipper/report channel
// + §20 media-platforms admin CRUD, over REAL sqlite (0032/0033/0034) with a
// MOCK CH client (query/insert/command). Proves: D1→CH revenue shipper (map
// offer_public_id→offer_id + stamp synced_to_ch_at), unmatched re-match within
// 72h → matched / past 72h → unattributed, attribution-MV backfill trigger, FX
// normalization, honest provider reconciliation, report-channel no-op stub, the
// cron entry (daily gate + FB seed), and the media-platforms CRUD (secret-ref-
// not-value, enabled default 0, template validation, dup 409).

import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Env } from "../src/env";
import type { ListicleChClient } from "../src/listicles/clickhouse";
import admin from "../src/admin/router";
import {
  shipRevenueRawToCh,
  reMatchUnmatchedSweep,
  triggerAttributionBackfill,
  dailyProviderReconciliation,
  ingestProviderReports,
  runListicleRevenueCron,
  seedDefaultMediaPlatforms,
  ATTRIBUTION_MV,
} from "../src/listicles/revenue-recon";
import { refreshFxRates, lookupFxRate, computeRevenueUsd } from "../src/listicles/fx";

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
        async run() { const r = sdb.prepare(sql).run(...binds) as { changes?: number }; return { success: true, meta: { changes: r?.changes ?? 0 } }; },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) { const r: unknown[] = []; for (const s of statements) r.push(await s.run()); return r; },
  } as unknown as D1Database;
  return db;
}
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
function migration(name: string): string { return readFileSync(join(TEST_DIR, "../migrations", name), "utf8"); }
function createDb(ctor: DatabaseSyncCtor): SqliteDb {
  const sdb = new ctor(":memory:");
  runSql(sdb, "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);");
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
function buildEnv(db: D1Database, extra?: Record<string, unknown>): Env {
  return {
    DB: db, CACHE: inMemoryKv(), MEDIA: {} as R2Bucket,
    APP_ENV: "test", ADMIN_HOST: "localhost", ADMIN_BASE_URL: "http://localhost:8787", ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false", HTML_CACHE_TTL_SECONDS: "60", OPENAI_TEXT_MODEL: "t", OPENAI_IMAGE_MODEL: "i",
    SITE_PROVISIONING_DRY_RUN: "true", SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false", DEV_BYPASS_AUTH: "true",
    LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS: "OFFER_TOKEN_LISTICLE_FACEBOOK,LISTICLE_S2S_TOKEN_FACEBOOK",
    ...extra,
  } as unknown as Env;
}

interface MockOpts { matched?: string[]; captureInsert?: (rows: Array<Record<string, unknown>>) => void; captureCmd?: (sql: string) => void; configured?: boolean; }
function mockCh(opts?: MockOpts): ListicleChClient {
  return {
    configured: opts?.configured ?? true,
    async query<T>(sql: string, params?: Record<string, string | number>): Promise<{ rows: T[]; configured: boolean }> {
      if (sql.includes("lst_events_raw") && sql.includes("offer_click")) {
        const matched = new Set(opts?.matched ?? []);
        const rows = Object.values(params ?? {})
          .filter((v): v is string => typeof v === "string" && matched.has(v))
          .map((cid) => ({ click_id: cid }));
        return { rows: rows as unknown as T[], configured: true };
      }
      return { rows: [], configured: true };
    },
    async insert(table: string, rows: ReadonlyArray<Record<string, unknown>>) {
      opts?.captureInsert?.(rows as Array<Record<string, unknown>>);
      return { inserted: rows.length, configured: true };
    },
    async command(sql: string) { opts?.captureCmd?.(sql); return { ok: true, configured: true }; },
  } as ListicleChClient;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  if (body === undefined) return { method };
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

const ctor = loadDatabaseSync();
const d = ctor ? describe : describe.skip;

d("§19 D1→CH revenue shipper", () => {
  let sdb: SqliteDb; let db: D1Database; let env: Env;
  beforeEach(() => { sdb = createDb(ctor as DatabaseSyncCtor); db = d1FromSqlite(sdb); env = buildEnv(db); });

  it("ships unsynced rows (offer_public_id→offer_id) and stamps synced_to_ch_at", async () => {
    sdb.prepare("INSERT INTO listicle_revenue_raw (dt, click_id, offer_public_id, source, conversions, revenue, currency) VALUES (?,?,?,?,1,?,?)")
      .run("2026-07-02", "ck1", "off_a", "s2s_postback", 5, "USD");
    sdb.prepare("INSERT INTO listicle_revenue_raw (dt, click_id, offer_public_id, source, conversions, revenue, currency) VALUES (?,?,?,?,1,?,?)")
      .run("2026-07-02", "ck2", null, "in_site", 8, "USD");
    let captured: Array<Record<string, unknown>> = [];
    const res = await shipRevenueRawToCh(env, { client: mockCh({ captureInsert: (r) => { captured = r; } }) });
    expect(res.shipped).toBe(2);
    expect(captured.length).toBe(2);
    expect(captured[0]!.offer_id).toBe("off_a"); // DEV-6 map
    expect(captured[1]!.offer_id).toBe("");       // null → ''
    expect("offer_public_id" in captured[0]!).toBe(false);
    const stamped = sdb.prepare("SELECT COUNT(*) AS n FROM listicle_revenue_raw WHERE synced_to_ch_at IS NOT NULL").get() as Record<string, unknown>;
    expect(stamped.n).toBe(2);
    // Re-run: nothing left to ship.
    const again = await shipRevenueRawToCh(env, { client: mockCh() });
    expect(again.shipped).toBe(0);
  });

  it("unconfigured CH → no-op, rows stay unsynced", async () => {
    sdb.prepare("INSERT INTO listicle_revenue_raw (dt, click_id, source, conversions, revenue, currency) VALUES (?,?,?,1,?,?)")
      .run("2026-07-02", "ck1", "s2s_postback", 5, "USD");
    const res = await shipRevenueRawToCh(env, { client: { configured: false, async query() { return { rows: [], configured: false }; } } as ListicleChClient });
    expect(res.configured).toBe(false);
    expect(res.shipped).toBe(0);
    const unsynced = sdb.prepare("SELECT COUNT(*) AS n FROM listicle_revenue_raw WHERE synced_to_ch_at IS NULL").get() as Record<string, unknown>;
    expect(unsynced.n).toBe(1);
  });
});

d("§31.7 unmatched re-match sweep", () => {
  let sdb: SqliteDb; let db: D1Database; let env: Env;
  beforeEach(() => { sdb = createDb(ctor as DatabaseSyncCtor); db = d1FromSqlite(sdb); env = buildEnv(db); });

  function seedUnmatched(clickId: string, ageHours: number, now: number): void {
    const receivedAt = Math.floor(now / 1000) - ageHours * 3600;
    sdb.prepare(
      "INSERT INTO listicle_revenue_unmatched (click_id, provider, external_txn_id, revenue, currency, received_at, status) VALUES (?,?,?,?,?,?, 'pending')",
    ).run(clickId, "generic", `tx-${clickId}`, 5, "USD", receivedAt);
  }

  it("within 72h + CH match → matched; past 72h → unattributed", async () => {
    const now = new Date("2026-07-03T00:00:00Z");
    seedUnmatched("ck-recent-match", 1, now.getTime());
    seedUnmatched("ck-recent-nomatch", 2, now.getTime());
    seedUnmatched("ck-old", 80, now.getTime());
    const res = await reMatchUnmatchedSweep(env, { now, client: mockCh({ matched: ["ck-recent-match"] }) });
    expect(res.configured).toBe(true);
    const statuses = Object.fromEntries(
      (sdb.prepare("SELECT click_id, status FROM listicle_revenue_unmatched").all() as Array<Record<string, unknown>>).map((r) => [r.click_id, r.status]),
    );
    expect(statuses["ck-recent-match"]).toBe("matched");
    expect(statuses["ck-recent-nomatch"]).toBe("pending");
    expect(statuses["ck-old"]).toBe("unattributed");
  });

  it("unconfigured CH → only the >72h age-out runs", async () => {
    const now = new Date("2026-07-03T00:00:00Z");
    seedUnmatched("ck-recent", 1, now.getTime());
    seedUnmatched("ck-old", 100, now.getTime());
    const res = await reMatchUnmatchedSweep(env, { now, client: { configured: false, async query() { return { rows: [], configured: false }; } } as ListicleChClient });
    expect(res.configured).toBe(false);
    const statuses = Object.fromEntries(
      (sdb.prepare("SELECT click_id, status FROM listicle_revenue_unmatched").all() as Array<Record<string, unknown>>).map((r) => [r.click_id, r.status]),
    );
    expect(statuses["ck-recent"]).toBe("pending");     // no CH → cannot match
    expect(statuses["ck-old"]).toBe("unattributed");   // aged out regardless
  });
});

d("§31.7 attribution-MV backfill trigger", () => {
  it("issues SYSTEM REFRESH VIEW on the attribution MV", async () => {
    const env = buildEnv(d1FromSqlite(createDb(ctor as DatabaseSyncCtor)));
    let cmd = "";
    const res = await triggerAttributionBackfill(env, { client: mockCh({ captureCmd: (s) => { cmd = s; } }) });
    expect(res.refreshed).toBe(true);
    expect(cmd).toContain("SYSTEM REFRESH VIEW");
    expect(cmd).toContain(ATTRIBUTION_MV);
  });
  it("unconfigured CH → honest no-op (auto-refresh still active)", async () => {
    const env = buildEnv(d1FromSqlite(createDb(ctor as DatabaseSyncCtor)));
    const res = await triggerAttributionBackfill(env, { client: { configured: false, async query() { return { rows: [], configured: false }; } } as ListicleChClient });
    expect(res.refreshed).toBe(false);
    expect(res.note).toContain("auto-refresh");
  });
});

d("§31.7 FX normalization", () => {
  let sdb: SqliteDb; let db: D1Database; let env: Env;
  beforeEach(() => { sdb = createDb(ctor as DatabaseSyncCtor); db = d1FromSqlite(sdb); env = buildEnv(db); });

  it("refreshFxRates seeds the USD identity (idempotent) + honest source label", async () => {
    const r1 = await refreshFxRates(env, { now: new Date("2026-07-02T00:00:00Z") });
    expect(r1.source).toBe("identity_only");
    expect(r1.seeded).toBe(1);
    const row = sdb.prepare("SELECT usd_rate FROM listicle_fx_rates WHERE currency='USD'").get() as Record<string, unknown>;
    expect(row.usd_rate).toBe(1);
    await refreshFxRates(env, { now: new Date("2026-07-02T00:00:00Z") }); // idempotent
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM listicle_fx_rates WHERE currency='USD' AND date='2026-07-02'").get() as Record<string, unknown>).n).toBe(1);
  });

  it("refreshFxRates applies injected seededRates", async () => {
    const r = await refreshFxRates(env, { now: new Date("2026-07-02T00:00:00Z"), seededRates: { EUR: 1.08, GBP: 1.27 } });
    expect(r.source).toBe("seeded_rates");
    expect((await lookupFxRate(db, "2026-07-02", "EUR"))).toBeCloseTo(1.08, 5);
  });

  it("lookupFxRate: USD identity, prior-date fallback, unknown → null", async () => {
    sdb.prepare("INSERT INTO listicle_fx_rates (date, currency, usd_rate) VALUES ('2026-07-01','EUR',1.1)").run();
    expect(await lookupFxRate(db, "2026-07-05", "USD")).toBe(1);
    expect(await lookupFxRate(db, "2026-07-05", "EUR")).toBeCloseTo(1.1, 5); // prior-date fallback
    expect(await lookupFxRate(db, "2026-07-05", "JPY")).toBeNull();
    expect(await computeRevenueUsd(db, "2026-07-05", "EUR", 10)).toBeCloseTo(11, 5);
    expect(await computeRevenueUsd(db, "2026-07-05", "JPY", 10)).toBeNull(); // no rate → backfill
  });
});

d("§31.7 daily provider reconciliation + §19 report channel", () => {
  let sdb: SqliteDb; let db: D1Database; let env: Env;
  beforeEach(() => { sdb = createDb(ctor as DatabaseSyncCtor); db = d1FromSqlite(sdb); env = buildEnv(db); });

  it("counts postbacks per provider + day s2s revenue; provider report total is honest NULL", async () => {
    const dayStart = Math.floor(Date.parse("2026-07-02T00:00:00Z") / 1000) + 100;
    sdb.prepare("INSERT INTO listicle_postback_log (provider, external_txn_id, received_at) VALUES ('generic','a',?)").run(dayStart);
    sdb.prepare("INSERT INTO listicle_postback_log (provider, external_txn_id, received_at) VALUES ('generic','b',?)").run(dayStart);
    sdb.prepare("INSERT INTO listicle_postback_log (provider, external_txn_id, received_at) VALUES ('capi','c',?)").run(dayStart);
    sdb.prepare("INSERT INTO listicle_revenue_raw (dt, click_id, source, conversions, revenue, currency) VALUES ('2026-07-02','ck1','s2s_postback',1,5,'USD')").run();
    sdb.prepare("INSERT INTO listicle_revenue_raw (dt, click_id, source, conversions, revenue, currency) VALUES ('2026-07-02','ck2','s2s_postback',1,7,'USD')").run();

    const report = await dailyProviderReconciliation(env, "2026-07-02");
    expect(report.ingested_s2s_revenue).toBeCloseTo(12, 5);
    const byProvider = Object.fromEntries(report.providers.map((p) => [p.provider, p]));
    expect(byProvider["generic"]!.ingested_postback_count).toBe(2);
    expect(byProvider["capi"]!.ingested_postback_count).toBe(1);
    expect(byProvider["generic"]!.provider_report_total).toBeNull();
    expect(byProvider["generic"]!.variance_flag).toBe("NO_PROVIDER_REPORT_SOURCE");
    expect(report.null_reasons.provider_report_total).toContain("no provider-report source");
  });

  it("ingestProviderReports is a structured no-op with no configured adapter", async () => {
    const res = await ingestProviderReports(env, { now: new Date("2026-07-02T00:00:00Z") });
    expect(res.configured_adapters).toEqual([]);
    expect(res.ingested).toBe(0);
    expect(res.note).toContain("no provider report/API adapter configured");
  });
});

d("revenue cron entry + FB seed", () => {
  let sdb: SqliteDb; let db: D1Database; let env: Env;
  beforeEach(() => { sdb = createDb(ctor as DatabaseSyncCtor); db = d1FromSqlite(sdb); env = buildEnv(db); });

  it("seedDefaultMediaPlatforms seeds facebook disabled (idempotent)", async () => {
    await seedDefaultMediaPlatforms(env);
    await seedDefaultMediaPlatforms(env);
    const rows = sdb.prepare("SELECT platform, enabled, auth_secret_ref FROM listicle_media_platforms WHERE platform='facebook'").all() as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.enabled).toBe(0);
    expect(rows[0]!.auth_secret_ref).toBe("LISTICLE_S2S_TOKEN_FACEBOOK");
  });

  it("runListicleRevenueCron force → runs ship+sweep+daily (fx/backfill/recon/seed)", async () => {
    sdb.prepare("INSERT INTO listicle_revenue_raw (dt, click_id, source, conversions, revenue, currency) VALUES ('2026-07-02','ck1','s2s_postback',1,5,'USD')").run();
    const summary = await runListicleRevenueCron(env, { now: new Date("2026-07-02T09:00:00Z"), force: true, client: mockCh() });
    expect(summary.daily_ran).toBe(true);
    expect(summary.ship?.shipped).toBe(1);
    expect(summary.fx?.seeded).toBeGreaterThanOrEqual(1);
    expect(summary.backfill?.refreshed).toBe(true);
    expect(summary.reconciliation?.t).toBe("lst_provider_reconciliation");
    // FB seed ran as part of the daily block.
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM listicle_media_platforms WHERE platform='facebook'").get() as Record<string, unknown>).n).toBe(1);
  });

  it("non-daily minute → only ship + sweep, daily tasks skipped", async () => {
    const summary = await runListicleRevenueCron(env, { now: new Date("2026-07-02T09:03:00Z"), client: mockCh() });
    expect(summary.daily_ran).toBe(false);
    expect(summary.fx).toBeUndefined();
  });
});

d("§20 media-platforms admin CRUD", () => {
  let sdb: SqliteDb; let env: Env;
  beforeEach(() => { sdb = createDb(ctor as DatabaseSyncCtor); env = buildEnv(d1FromSqlite(sdb)); });

  const base = "/api/admin/listicles/media-platforms";

  it("create → 201 enabled=0 default, stores auth_secret_ref NAME (never the token value)", async () => {
    // The env HOLDS the actual secret value; the CRUD must store/return only
    // the ref NAME — the resolved token value must never appear in a response.
    const secretEnv = buildEnv(d1FromSqlite(sdb), { OFFER_TOKEN_LISTICLE_FACEBOOK: "super-secret-token-value" });
    const res = await admin.request(base, jsonInit("POST", {
      platform: "facebook",
      postback_url_template: "https://fb.example/tr?c={click_id}&v={value}&t={auth_token}",
      auth_secret_ref: "OFFER_TOKEN_LISTICLE_FACEBOOK",
      event_name: "Purchase",
    }), secretEnv);
    expect(res.status).toBe(201);
    const body = await res.json() as { media_platform: Record<string, unknown> };
    expect(body.media_platform.enabled).toBe(0); // disabled by default
    expect(body.media_platform.auth_secret_ref).toBe("OFFER_TOKEN_LISTICLE_FACEBOOK");
    // the token VALUE must never be reflected (only the ref NAME is stored).
    expect(JSON.stringify(body)).not.toContain("super-secret-token-value");
    const stored = sdb.prepare("SELECT auth_secret_ref FROM listicle_media_platforms WHERE platform='facebook'").get() as Record<string, unknown>;
    expect(stored.auth_secret_ref).toBe("OFFER_TOKEN_LISTICLE_FACEBOOK");
  });

  it("rejects a value-looking auth_secret_ref (must be an UPPER_SNAKE name)", async () => {
    const res = await admin.request(base, jsonInit("POST", {
      platform: "taboola",
      postback_url_template: "https://tb.example/t?c={click_id}",
      auth_secret_ref: "sk_live_abc123xyz", // looks like a token VALUE
    }), env);
    expect(res.status).toBe(400);
    expect((await res.json() as { fields: Record<string, string> }).fields.auth_secret_ref).toBeDefined();
  });

  it("rejects infrastructure, missing, and newly introduced legacy references before insert", async () => {
    const hardenedEnv = buildEnv(d1FromSqlite(sdb), {
      LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS:
        "OFFER_TOKEN_LISTICLE_FACEBOOK,OFFER_TOKEN_MISSING,LISTICLE_S2S_TOKEN_FACEBOOK,CH_PASSWORD,GITHUB_TOKEN",
      CH_PASSWORD: "must-never-be-selected-by-a-platform",
      GITHUB_TOKEN: "must-never-be-selected-by-a-platform",
      LISTICLE_S2S_TOKEN_FACEBOOK: "legacy-bound-token",
    });
    const cases = [
      { platform: "infra", ref: "CH_PASSWORD", expected: "infrastructure" },
      { platform: "commoninfra", ref: "GITHUB_TOKEN", expected: "infrastructure" },
      { platform: "missing", ref: "OFFER_TOKEN_MISSING", expected: "missing or empty" },
      { platform: "legacynew", ref: "LISTICLE_S2S_TOKEN_FACEBOOK", expected: "OFFER_TOKEN_" },
    ];

    for (const item of cases) {
      const res = await admin.request(base, jsonInit("POST", {
        platform: item.platform,
        postback_url_template: "https://partner.example/t?c={click_id}&t={auth_token}",
        auth_secret_ref: item.ref,
      }), hardenedEnv);
      expect(res.status).toBe(400);
      expect((await res.json() as { fields: Record<string, string> }).fields.auth_secret_ref).toContain(item.expected);
    }

    expect((sdb.prepare("SELECT COUNT(*) AS n FROM listicle_media_platforms").get() as { n: number }).n).toBe(0);
  });

  it("allows an unchanged explicitly allowlisted bound legacy reference to be enabled", async () => {
    const legacyEnv = buildEnv(d1FromSqlite(sdb), {
      LISTICLE_S2S_TOKEN_FACEBOOK: "legacy-bound-token",
    });
    sdb.prepare(
      `INSERT INTO listicle_media_platforms
         (platform, enabled, postback_url_template, auth_secret_ref, event_name)
       VALUES (?, 0, ?, ?, ?)`,
    ).run(
      "facebook",
      "https://fb.example/t?c={click_id}&t={auth_token}",
      "LISTICLE_S2S_TOKEN_FACEBOOK",
      "Lead",
    );

    const res = await admin.request(`${base}/facebook`, jsonInit("PATCH", { enabled: true }), legacyEnv);
    expect(res.status).toBe(200);
    expect((await res.json() as { media_platform: Record<string, unknown> }).media_platform.enabled).toBe(1);
  });

  it("rejects a macro in the host position + a non-absolute template", async () => {
    const bad1 = await admin.request(base, jsonInit("POST", { platform: "p1", postback_url_template: "https://{click_id}.evil/c" }), env);
    expect(bad1.status).toBe(400);
    const bad2 = await admin.request(base, jsonInit("POST", { platform: "p2", postback_url_template: "/relative/path" }), env);
    expect(bad2.status).toBe(400);
  });

  it("duplicate platform → 409", async () => {
    const mk = () => admin.request(base, jsonInit("POST", { platform: "outbrain", postback_url_template: "https://ob.example/t?c={click_id}" }), env);
    expect((await mk()).status).toBe(201);
    expect((await mk()).status).toBe(409);
  });

  it("list + patch enable/edit", async () => {
    await admin.request(base, jsonInit("POST", { platform: "newsbreak", postback_url_template: "https://nb.example/t?c={click_id}" }), env);
    const list = await admin.request(base, {}, env);
    expect(list.status).toBe(200);
    const listed = (await list.json() as { media_platforms: Array<Record<string, unknown>> }).media_platforms;
    expect(listed.some((p) => p.platform === "newsbreak")).toBe(true);

    const patched = await admin.request(`${base}/newsbreak`, jsonInit("PATCH", { enabled: true, event_name: "Lead" }), env);
    expect(patched.status).toBe(200);
    const row = (await patched.json() as { media_platform: Record<string, unknown> }).media_platform;
    expect(row.enabled).toBe(1);
    expect(row.event_name).toBe("Lead");

    const badPatch = await admin.request(`${base}/newsbreak`, jsonInit("PATCH", { auth_secret_ref: "raw-token-value" }), env);
    expect(badPatch.status).toBe(400);
  });
});
