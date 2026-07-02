// Listicles Phase 2 — Offers admin API integration over REAL sqlite
// (node:sqlite), running the REAL migrations (0032/0033) and the REAL
// handlers through src/admin/router.ts.
//
// Follows the repo's node:sqlite harness pattern (see site-delete.test.ts):
// skipped gracefully where node:sqlite is absent; the unit suites remain the
// portable proof.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

// --- node:sqlite harness (repo pattern + transactional batch) ---------------

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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    const mod = nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
    return mod.DatabaseSync;
  } catch {
    try {
      // ESM path (vitest node env): dynamic require unavailable — use
      // process.getBuiltinModule (Node 22.3+).
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

// Bracket-call (repo convention) — node:sqlite's exec is a pure SQL runner.
function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

// D1-shaped adapter over node:sqlite. `batch` emulates D1's transactional
// batch semantics: all-or-nothing via BEGIN/COMMIT/ROLLBACK.
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
          const r = sdb.prepare(sql).get(...binds);
          return (r ?? null) as T | null;
        },
        async all<T = unknown>() {
          const rows = sdb.prepare(sql).all(...binds);
          return { results: rows as T[], success: true, meta: {} };
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
        for (const statement of statements) {
          results.push(await statement.run());
        }
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

// Real schema: the actual 0032/0033 migration files + the two FK targets
// (sites, media) that live in earlier repo migrations.
function createListiclesDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0032_listicles_core.sql"), "utf8"));
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0033_listicles_analytics_mirror.sql"), "utf8"));
  sdb.prepare("INSERT INTO sites (id, name) VALUES (?, ?)").run("st_test", "Test Site");
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
  };
}

function jsonInit(method: string, body?: unknown): RequestInit {
  if (body === undefined) return { method };
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(): { sdb: SqliteDb; env: Env } {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createListiclesDb(ctor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

const VALID_OFFER = {
  offer_name: "Acme Cat Food",
  provider: "acme",
  activity: "lead",
  vertical: "pets",
  conversion_tracking_method: "s2s_postback",
  offer_url_template: "https://track.acme.example/c?cid={clickid}&geo={country}",
  payout_method: "offsite",
};

interface OfferBody {
  offer: {
    id: number;
    public_id: string;
    offer_name: string;
    offer_url_template: string;
    status: string;
    payout_method: string;
  };
  usage_count?: number;
}

describeDb("offers CRUD round-trip (real sqlite + real migrations)", () => {
  it("POST → GET (id + public_id) → PATCH round-trips; {clickid} normalized on save", async () => {
    const { env } = newHarness();

    const created = await admin.request(
      "/api/admin/listicles/offers",
      jsonInit("POST", VALID_OFFER),
      env,
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as OfferBody;
    expect(createdBody.offer.public_id.startsWith("off_")).toBe(true);
    // §9.4/§23: the alias is normalized at save time.
    expect(createdBody.offer.offer_url_template).toBe(
      "https://track.acme.example/c?cid={click_id}&geo={country}",
    );

    const byId = await admin.request(
      `/api/admin/listicles/offers/${createdBody.offer.id}`,
      {},
      env,
    );
    expect(byId.status).toBe(200);
    expect(((await byId.json()) as OfferBody).usage_count).toBe(0);

    const byPublicId = await admin.request(
      `/api/admin/listicles/offers/${createdBody.offer.public_id}`,
      {},
      env,
    );
    expect(byPublicId.status).toBe(200);

    const patched = await admin.request(
      `/api/admin/listicles/offers/${createdBody.offer.id}`,
      jsonInit("PATCH", { offer_name: "Acme Cat Food v2", status: "paused" }),
      env,
    );
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as OfferBody;
    expect(patchedBody.offer.offer_name).toBe("Acme Cat Food v2");
    expect(patchedBody.offer.status).toBe("paused");

    const list = await admin.request("/api/admin/listicles/offers?status=paused", {}, env);
    const listBody = (await list.json()) as { offers: unknown[]; paging: { total: number } };
    expect(listBody.paging.total).toBe(1);
  });

  it("POST rejects a §23-invalid offer with field-keyed errors", async () => {
    const { env } = newHarness();
    const res = await admin.request(
      "/api/admin/listicles/offers",
      jsonInit("POST", { offer_name: "x", payout_method: "in_site" }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; fields: Record<string, string> };
    expect(body.fields.provider).toBeTruthy();
    expect(body.fields.payout_currency).toBeTruthy();
    expect(body.fields.payout_value).toBeTruthy();
  });

  it("PATCH cannot break a conditional set (in_site without currency → 400)", async () => {
    const { env } = newHarness();
    const created = await admin.request(
      "/api/admin/listicles/offers",
      jsonInit("POST", VALID_OFFER),
      env,
    );
    const { offer } = (await created.json()) as OfferBody;
    const res = await admin.request(
      `/api/admin/listicles/offers/${offer.id}`,
      jsonInit("PATCH", { payout_method: "in_site" }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields: Record<string, string> };
    expect(body.fields.payout_currency).toBeTruthy();
  });
});

describeDb("offers DELETE — 409 with usage while referenced (§5.3)", () => {
  it("blocks the delete with the section usage list, then allows it once unused", async () => {
    const { sdb, env } = newHarness();
    const created = await admin.request(
      "/api/admin/listicles/offers",
      jsonInit("POST", VALID_OFFER),
      env,
    );
    const { offer } = (await created.json()) as OfferBody;

    // Reference the offer from a section (the derived §5.4 usage index).
    sdb
      .prepare(
        "INSERT INTO listicle_sections (public_id, section_name, headline_text, content_json) VALUES (?, ?, ?, ?)",
      )
      .run("sec_usage1", "Usage Section", "H", '{"blocks":[]}');
    const sectionRow = sdb
      .prepare("SELECT id FROM listicle_sections WHERE public_id = ?")
      .get("sec_usage1") as { id: number };
    sdb
      .prepare(
        "INSERT INTO listicle_section_offers (section_id, offer_id, link_role, occurrences) VALUES (?, ?, 'button', 2)",
      )
      .run(sectionRow.id, offer.id);

    const blocked = await admin.request(
      `/api/admin/listicles/offers/${offer.id}`,
      { method: "DELETE" },
      env,
    );
    expect(blocked.status).toBe(409);
    const blockedBody = (await blocked.json()) as {
      error: string;
      usage: Array<{ kind: string; public_id: string }>;
      suggestion: string;
    };
    expect(blockedBody.error).toContain("in use");
    expect(blockedBody.usage).toHaveLength(1);
    expect(blockedBody.usage[0]?.kind).toBe("section");
    expect(blockedBody.usage[0]?.public_id).toBe("sec_usage1");
    expect(blockedBody.suggestion).toContain("archive");

    // Usage endpoint mirrors the same §5.4 lookup.
    const usage = await admin.request(
      `/api/admin/listicles/offers/${offer.id}/usage`,
      {},
      env,
    );
    const usageBody = (await usage.json()) as { usage: Array<{ public_id: string }> };
    expect(usageBody.usage[0]?.public_id).toBe("sec_usage1");

    // Un-reference → hard delete succeeds.
    sdb.prepare("DELETE FROM listicle_section_offers WHERE offer_id = ?").run(offer.id);
    const deleted = await admin.request(
      `/api/admin/listicles/offers/${offer.id}`,
      { method: "DELETE" },
      env,
    );
    expect(deleted.status).toBe(200);
    const gone = sdb
      .prepare("SELECT id FROM listicle_offers WHERE id = ?")
      .get(offer.id);
    expect(gone ?? null).toBeNull();
  });
});

describeDb("offers search — picker feed (§13)", () => {
  it("returns at most 50 rows, active only, matched over name/provider/vertical/activity", async () => {
    const { sdb, env } = newHarness();
    const insert = sdb.prepare(
      `INSERT INTO listicle_offers
         (public_id, offer_name, provider, activity, vertical,
          conversion_tracking_method, offer_url_template, payout_method, status)
       VALUES (?, ?, ?, ?, ?, 's2s_postback', 'https://t.example/c?c={click_id}', 'offsite', ?)`,
    );
    for (let i = 0; i < 60; i++) {
      insert.run(`off_seed${String(i).padStart(4, "0")}`, `Offer ${i}`, "bulkprov", "lead", "pets", "active");
    }
    for (let i = 0; i < 5; i++) {
      insert.run(`off_paused${i}`, `Paused ${i}`, "pausedprov", "lead", "pets", "paused");
    }
    insert.run("off_special", "Unique Sunglasses Deal", "rayprov", "sale", "fashion", "active");

    const capped = await admin.request("/api/admin/listicles/offers/search?q=", {}, env);
    expect(capped.status).toBe(200);
    const cappedBody = (await capped.json()) as { offers: Array<{ public_id: string }> };
    expect(cappedBody.offers).toHaveLength(50); // 61 active exist — the feed caps at 50
    expect(cappedBody.offers.some((o) => o.public_id.startsWith("off_paused"))).toBe(false);

    const byProvider = await admin.request(
      "/api/admin/listicles/offers/search?q=rayprov",
      {},
      env,
    );
    const byProviderBody = (await byProvider.json()) as { offers: Array<{ public_id: string }> };
    expect(byProviderBody.offers).toHaveLength(1);
    expect(byProviderBody.offers[0]?.public_id).toBe("off_special");

    // Paused offers never surface, even on an exact match.
    const paused = await admin.request(
      "/api/admin/listicles/offers/search?q=pausedprov",
      {},
      env,
    );
    expect(((await paused.json()) as { offers: unknown[] }).offers).toHaveLength(0);
  });
});

describeDb("offer analytics — §18 mirror reads", () => {
  it("returns zeros (never a 500) when the mirror is empty", async () => {
    const { env } = newHarness();
    const created = await admin.request(
      "/api/admin/listicles/offers",
      jsonInit("POST", VALID_OFFER),
      env,
    );
    const { offer } = (await created.json()) as OfferBody;

    const res = await admin.request(
      `/api/admin/listicles/offers/${offer.id}/analytics?from=2026-06-01&to=2026-06-30`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { analytics: Record<string, number | string> };
    for (const key of [
      "impressions", "clicks", "unique_clicks", "conversions", "revenue",
      "ctr", "cvr", "rpc", "rpm",
    ]) {
      expect(body.analytics[key], key).toBe(0);
    }
  });

  it("sums the ranged window and computes NULLIF-guarded ratios at read time", async () => {
    const { sdb, env } = newHarness();
    const created = await admin.request(
      "/api/admin/listicles/offers",
      jsonInit("POST", VALID_OFFER),
      env,
    );
    const { offer } = (await created.json()) as OfferBody;
    const upsert = sdb.prepare(
      `INSERT INTO listicle_analytics_offer
         (offer_public_id, date, impressions, clicks, unique_clicks, conversions, revenue)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    upsert.run(offer.public_id, "2026-06-01", 1000, 100, 80, 10, 50);
    upsert.run(offer.public_id, "2026-06-02", 1000, 100, 70, 10, 50);
    upsert.run(offer.public_id, "2026-07-15", 9999, 9999, 9999, 9999, 9999); // outside range

    const res = await admin.request(
      `/api/admin/listicles/offers/${offer.id}/analytics?from=2026-06-01&to=2026-06-30`,
      {},
      env,
    );
    const body = (await res.json()) as { analytics: Record<string, number | string> };
    expect(body.analytics.impressions).toBe(2000);
    expect(body.analytics.clicks).toBe(200);
    expect(body.analytics.conversions).toBe(20);
    expect(body.analytics.revenue).toBe(100);
    expect(body.analytics.ctr).toBeCloseTo(0.1, 10); // clicks/impressions
    expect(body.analytics.cvr).toBeCloseTo(0.1, 10); // conversions/clicks
    expect(body.analytics.rpc).toBeCloseTo(0.5, 10); // revenue/clicks
    expect(body.analytics.rpm).toBeCloseTo(50, 10); // revenue/impressions*1000
  });

  it("rejects malformed date ranges with a field-keyed 400", async () => {
    const { env } = newHarness();
    const created = await admin.request(
      "/api/admin/listicles/offers",
      jsonInit("POST", VALID_OFFER),
      env,
    );
    const { offer } = (await created.json()) as OfferBody;
    const res = await admin.request(
      `/api/admin/listicles/offers/${offer.id}/analytics?from=junk&to=2026-06-30`,
      {},
      env,
    );
    expect(res.status).toBe(400);
  });
});
