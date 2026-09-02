// LeadGen Phase 9 Stage B — the contract 03 §8.2 Auction block over the REAL
// admin router + REAL 0036–0039 migrations (node:sqlite harness; the
// leadgen-quotes-api.test.ts pattern with DEV_BYPASS_AUTH). Covers: §18.1
// Auction CRUD + enum validation (against the DDL CHECKs); §18.5 participating-
// offers replace-set (placement-exists + active-offer + Quote activity/vertical
// match, verified IN THE DB); §21 rules CRUD (offer + carrier) + §21.4
// conditions validation + conditions_hash via the Stage-A conditionsHash + the
// equal-priority strictly_override conflict flag (409); §20 banner GET/PUT
// (manual + automatic; validateBannerFieldMap rejects a non-canonical field);
// §18.9 analytics NULLIF ratios; the /simulate P10 seam (501); dual-id +
// no-store headers + 404 semantics.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import { renderBanners } from "../src/public/leadgen/auction/banner";
import { bannerDefaultDesign } from "../src/public/leadgen/designs/banner-default/tokens";
import type { Env } from "../src/env";
import { isPublicId, mintPublicId } from "../src/leadgen/ids";
import { conditionsHash } from "../src/leadgen/auction-rules";
import type { LeadgenRuleConditions } from "../src/admin/leadgen/db-types";

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

// Slice ONE named function out of an island script (the repo's vm-probe idiom,
// leadgen-quotes-ui.test.ts) so the test runs the code the page really ships
// instead of a re-typed copy.
function sliceFn(script: string, name: string): string {
  const start = script.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`island function not found: ${name}`);
  let depth = 0;
  for (let i = script.indexOf("{", start); i < script.length; i += 1) {
    if (script[i] === "{") depth += 1;
    else if (script[i] === "}" && (depth -= 1) === 0) return script.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces slicing ${name}`);
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

// Rework P1 coherence sweep (conductor-consolidated round): brought
// current through 0053 (was stale) so this harness's D1 schema matches
// the real Wave-1 shape (handlers now write M1/M2/M4/M5 columns/tables
// this file's schema never had).
const LEADGEN_MIGRATIONS = [
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
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
  );
  for (const file of LEADGEN_MIGRATIONS) {
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  }
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
  } as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(): { sdb: SqliteDb; env: Env } {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createLeadgenDb(ctor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// --- seeding ------------------------------------------------------------------

async function createQuote(
  env: Env,
  opts: { activity?: string; verticals?: string[] } = {},
): Promise<{ id: number; public_id: string; activity: string; verticals: string[] }> {
  const activity = opts.activity ?? "quote_funnel";
  const verticals = opts.verticals ?? ["life", "health"];
  const res = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Q", activity, verticals }), env);
  const j = (await res.json()) as { id: number; public_id: string };
  return { id: j.id, public_id: j.public_id, activity, verticals };
}

function seedOfferWithPlacement(
  sdb: SqliteDb,
  opts: { activity?: string; vertical?: string; offer_type?: string; status?: string } = {},
): { offer_id: number; offer_public_id: string; placement_id: number; placement_public_id: string } {
  const offerPublic = mintPublicId("offer");
  sdb
    .prepare(
      "INSERT INTO leadgen_offers (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type, status) VALUES (?, ?, ?, ?, 's2s_postback', ?, ?)",
    )
    .run(offerPublic, `Offer ${offerPublic.slice(-4)}`, opts.activity ?? "quote_funnel", opts.vertical ?? "life", opts.offer_type ?? "cpc", opts.status ?? "active");
  const offer = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(offerPublic) as { id: number };
  const placementPublic = mintPublicId("offer_placement");
  sdb
    .prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)")
    .run(placementPublic, offer.id, `plc-${offerPublic.slice(-4)}`);
  const placement = sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(placementPublic) as { id: number };
  return { offer_id: offer.id, offer_public_id: offerPublic, placement_id: placement.id, placement_public_id: placementPublic };
}

interface AuctionJson {
  id: number;
  public_id: string;
  auction_name: string;
  quote_id: number | null;
  auction_type: string;
  winner_logic: string;
  floor_type: string;
  floor_value: number;
  mixed_payout_warn: boolean;
  status: string;
  [key: string]: unknown;
}

async function createAuction(
  env: Env,
  body: Record<string, unknown>,
): Promise<{ res: Response; json: AuctionJson }> {
  const res = await admin.request(`${API}/auctions`, jsonInit("POST", body), env);
  const json = (await res.json()) as AuctionJson;
  return { res, json };
}

// --- Auction CRUD + enum validation (§18.1) ----------------------------------

describeDb("leadgen auctions API — CRUD + §18.1 enum validation", () => {
  it("POST requires auction_name + quote_id (§18.1 attribution)", async () => {
    const { env } = newHarness();
    const noName = await admin.request(`${API}/auctions`, jsonInit("POST", { quote_id: 1 }), env);
    expect(noName.status).toBe(400);
    const noQuote = await admin.request(`${API}/auctions`, jsonInit("POST", { auction_name: "A" }), env);
    expect(noQuote.status).toBe(400);
  });

  it("POST rejects a non-existent quote_id with a clean 400 (not a 500)", async () => {
    const { env } = newHarness();
    const res = await admin.request(`${API}/auctions`, jsonInit("POST", { auction_name: "A", quote_id: 9999 }), env);
    expect(res.status).toBe(400);
    const j = (await res.json()) as { fields?: Record<string, string> };
    expect(j.fields?.quote_id).toBeTruthy();
  });

  it("POST creates with DDL defaults + mints an lga_ public_id", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const { res, json } = await createAuction(env, { auction_name: "My Auction", quote_id: quote.id, auction_type: "dynamic" });
    expect(res.status).toBe(201);
    expect(isPublicId("auction", json.public_id)).toBe(true);
    expect(json.auction_type).toBe("dynamic");
    expect(json.winner_logic).toBe("highest_bid");
    expect(json.floor_type).toBe("percentage_of_max");
    expect(json.floor_value).toBe(10);
    expect(json.mixed_payout_warn).toBe(true); // INTEGER 1 → boolean
  });

  it("POST rejects invalid winner_logic / floor_type / multi_offer / backfill / removal_scope enums", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    for (const [field, bad] of [
      ["winner_logic", "median_bid"],
      ["floor_type", "percent"],
      ["multi_offer", "all"],
      ["backfill", "on"],
      ["removal_scope", "everything"],
      ["auction_type", "hybrid"],
    ] as const) {
      const res = await admin.request(`${API}/auctions`, jsonInit("POST", { auction_name: "A", quote_id: quote.id, [field]: bad }), env);
      expect(res.status, `${field}=${bad} must 400`).toBe(400);
    }
  });

  it("GET /:id resolves by BOTH numeric id and public_id; unknown → 404; no-store header", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const byPublic = await admin.request(`${API}/auctions/${json.public_id}`, {}, env);
    const byNumeric = await admin.request(`${API}/auctions/${json.id}`, {}, env);
    expect(byPublic.status).toBe(200);
    expect(byNumeric.status).toBe(200);
    expect(byPublic.headers.get("Cache-Control")).toBe("private, no-store");
    const missing = await admin.request(`${API}/auctions/${mintPublicId("auction")}`, {}, env);
    expect(missing.status).toBe(404);
  });

  it("PATCH honors every §18.1 setting + mixed_payout_warn", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const patched = await admin.request(
      `${API}/auctions/${json.public_id}`,
      jsonInit("PATCH", {
        winner_logic: "sum_bids",
        floor_type: "absolute_bid",
        floor_value: 0, // ?? default must honor 0
        multi_offer: "enabled_unique",
        backfill: "enabled",
        backfill_trigger: "on_click",
        remove_clicked_offers: true,
        removal_scope: "carrier",
        timeout_ms: 4000,
        banner_slots_count: 8,
        mixed_payout_warn: false,
        render_mode: "progressive",
      }),
      env,
    );
    expect(patched.status).toBe(200);
    const p = (await patched.json()) as AuctionJson & Record<string, unknown>;
    expect(p.winner_logic).toBe("sum_bids");
    expect(p.floor_type).toBe("absolute_bid");
    expect(p.floor_value).toBe(0);
    expect(p.multi_offer).toBe("enabled_unique");
    expect(p.removal_scope).toBe("carrier");
    expect(p.timeout_ms).toBe(4000);
    expect(p.mixed_payout_warn).toBe(false);
  });

  it("PATCH rejects an invalid enum with 400", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const res = await admin.request(`${API}/auctions/${json.public_id}`, jsonInit("PATCH", { winner_logic: "nope" }), env);
    expect(res.status).toBe(400);
  });

  it("DELETE archives (status flip, reversible)", async () => {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env);
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const del = await admin.request(`${API}/auctions/${json.public_id}`, { method: "DELETE" }, env);
    expect(del.status).toBe(200);
    const row = sdb.prepare("SELECT status FROM leadgen_auctions WHERE id = ?").get(json.id) as { status: string };
    expect(row.status).toBe("archived");
  });

  it("GET list returns { items, paging } + participating_count + quote attribution", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    await createAuction(env, { auction_name: "Listed", quote_id: quote.id });
    const res = await admin.request(`${API}/auctions`, {}, env);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { items: Array<Record<string, unknown>>; paging: Record<string, unknown> };
    expect(j.paging).toBeTruthy();
    expect(j.items.length).toBe(1);
    expect(j.items[0]!.participating_count).toBe(0);
    expect(j.items[0]!.quote_name).toBe("Q");
  });

  it("GET list filters by type + rejects an invalid type filter", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    await createAuction(env, { auction_name: "S", quote_id: quote.id, auction_type: "static" });
    await createAuction(env, { auction_name: "D", quote_id: quote.id, auction_type: "dynamic" });
    const staticOnly = await admin.request(`${API}/auctions?type=static`, {}, env);
    const j = (await staticOnly.json()) as { items: unknown[] };
    expect(j.items.length).toBe(1);
    const bad = await admin.request(`${API}/auctions?type=weird`, {}, env);
    expect(bad.status).toBe(400);
  });
});

// --- Participating offers replace-set (§18.5) --------------------------------

describeDb("leadgen auctions API — participating offers (§18.5 replace-set)", () => {
  it("PUT replaces the set; verified IN THE DB; static order/bid persist", async () => {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env, { activity: "quote_funnel", verticals: ["life"] });
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id, auction_type: "static" });
    const o1 = seedOfferWithPlacement(sdb, { activity: "quote_funnel", vertical: "life", offer_type: "cpc" });
    const o2 = seedOfferWithPlacement(sdb, { activity: "quote_funnel", vertical: "life", offer_type: "cpl" });

    const put1 = await admin.request(
      `${API}/auctions/${json.public_id}/offers`,
      jsonInit("PUT", { offers: [{ offer_placement_id: o1.placement_id, static_order: 0, static_bid_override: 2.5 }, { offer_placement_id: o2.placement_id, static_order: 1 }] }),
      env,
    );
    expect(put1.status).toBe(200);
    let rows = sdb.prepare("SELECT offer_placement_id, offer_id, static_order, static_bid_override FROM leadgen_auction_offers WHERE auction_id = ? ORDER BY static_order").all(json.id) as Array<{ offer_placement_id: number; offer_id: number; static_order: number; static_bid_override: number | null }>;
    expect(rows.length).toBe(2);
    expect(rows[0]!.offer_id).toBe(o1.offer_id); // denormalized from placement
    expect(rows[0]!.static_bid_override).toBe(2.5);

    // Replace-set: a second PUT with only o2 leaves exactly one row.
    const put2 = await admin.request(`${API}/auctions/${json.public_id}/offers`, jsonInit("PUT", { offers: [{ offer_placement_id: o2.placement_id }] }), env);
    expect(put2.status).toBe(200);
    rows = sdb.prepare("SELECT offer_placement_id, offer_id, static_order, static_bid_override FROM leadgen_auction_offers WHERE auction_id = ?").all(json.id) as typeof rows;
    expect(rows.length).toBe(1);
    expect(rows[0]!.offer_placement_id).toBe(o2.placement_id);
  });

  it("PUT rejects a non-existent placement", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const res = await admin.request(`${API}/auctions/${json.public_id}/offers`, jsonInit("PUT", { offers: [{ offer_placement_id: 99999 }] }), env);
    expect(res.status).toBe(400);
  });

  it("PUT rejects an offer whose activity/vertical mismatches the Quote (§12.4-style)", async () => {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env, { activity: "quote_funnel", verticals: ["life"] });
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const mismatch = seedOfferWithPlacement(sdb, { activity: "quote_funnel", vertical: "auto" }); // vertical not in quote
    const res = await admin.request(`${API}/auctions/${json.public_id}/offers`, jsonInit("PUT", { offers: [{ offer_placement_id: mismatch.placement_id }] }), env);
    expect(res.status).toBe(400);
  });

  it("PUT rejects a non-active offer", async () => {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env, { activity: "quote_funnel", verticals: ["life"] });
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const paused = seedOfferWithPlacement(sdb, { activity: "quote_funnel", vertical: "life", status: "paused" });
    const res = await admin.request(`${API}/auctions/${json.public_id}/offers`, jsonInit("PUT", { offers: [{ offer_placement_id: paused.placement_id }] }), env);
    expect(res.status).toBe(400);
  });

  it("PUT rejects a stringized static_order (never silently drops it to NULL)", async () => {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env, { activity: "quote_funnel", verticals: ["life"] });
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const o1 = seedOfferWithPlacement(sdb, { activity: "quote_funnel", vertical: "life" });
    const res = await admin.request(
      `${API}/auctions/${json.public_id}/offers`,
      jsonInit("PUT", { offers: [{ offer_placement_id: o1.placement_id, static_order: "2" }] }),
      env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields: Record<string, string> }).fields["offers.0.static_order"]).toMatch(/non-negative integer/);
    // nothing was persisted (the whole replace-set is rejected atomically).
    const n = sdb.prepare("SELECT COUNT(*) AS c FROM leadgen_auction_offers WHERE auction_id = ?").get(json.id) as { c: number };
    expect(n.c).toBe(0);
  });

  it("GET /offers returns per-offer columns (schema version + last_test_status)", async () => {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env, { activity: "quote_funnel", verticals: ["life"] });
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const o1 = seedOfferWithPlacement(sdb, { activity: "quote_funnel", vertical: "life" });
    await admin.request(`${API}/auctions/${json.public_id}/offers`, jsonInit("PUT", { offers: [{ offer_placement_id: o1.placement_id }] }), env);
    const res = await admin.request(`${API}/auctions/${json.public_id}/offers`, {}, env);
    const j = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(j.items.length).toBe(1);
    expect(j.items[0]!.offer_id).toBe(o1.offer_id);
    expect(j.items[0]!.last_test_status).toBe("untested");
  });
});

// --- Rules (§21) + §21.4 conditions + conflict flag --------------------------

describeDb("leadgen auctions API — rules (§21 / §21.4)", () => {
  it("POST an offer-level rule mints lgar_ + stores conditions_hash via the Stage-A conditionsHash", async () => {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env, { activity: "quote_funnel", verticals: ["life"] });
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const offer = seedOfferWithPlacement(sdb, { activity: "quote_funnel", vertical: "life" });
    const conditions: LeadgenRuleConditions = { groups: [{ field: "homeowner", op: "eq", value: false }, { field: "state", op: "in", values: ["CA", "NY"] }] };
    const res = await admin.request(
      `${API}/auctions/${json.public_id}/rules`,
      jsonInit("POST", { rule_level: "offer", action: "exclude", target_offer_id: offer.offer_id, conditions_json: conditions, priority: 50 }),
      env,
    );
    expect(res.status).toBe(201);
    const j = (await res.json()) as { public_id: string; conditions_hash: string; rule_level: string };
    expect(isPublicId("auction_rule", j.public_id)).toBe(true);
    expect(j.conditions_hash).toBe(conditionsHash(conditions));
    const row = sdb.prepare("SELECT conditions_hash FROM leadgen_auction_rules WHERE public_id = ?").get(j.public_id) as { conditions_hash: string };
    expect(row.conditions_hash).toBe(conditionsHash(conditions));
  });

  it("POST a carrier-level rule stores carrier_match_json + null target_offer_id", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const res = await admin.request(
      `${API}/auctions/${json.public_id}/rules`,
      jsonInit("POST", { rule_level: "carrier", action: "block_list", carrier_match_json: { carrier_keys: ["acme"] }, conditions_json: { groups: [] } }),
      env,
    );
    expect(res.status).toBe(201);
    const j = (await res.json()) as { rule_level: string; target_offer_id: number | null; carrier_match_json: unknown };
    expect(j.rule_level).toBe("carrier");
    expect(j.target_offer_id).toBeNull();
    expect(j.carrier_match_json).toEqual({ carrier_keys: ["acme"] });
  });

  it("POST rejects a §21.4 conditions shape with a bad op", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const res = await admin.request(
      `${API}/auctions/${json.public_id}/rules`,
      jsonInit("POST", { rule_level: "carrier", action: "exclude", conditions_json: { groups: [{ field: "x", op: "contains", value: 1 }] } }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("POST an offer-level rule requires target_offer_id", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const res = await admin.request(`${API}/auctions/${json.public_id}/rules`, jsonInit("POST", { rule_level: "offer", action: "exclude", conditions_json: { groups: [] } }), env);
    expect(res.status).toBe(400);
  });

  it("flags an equal-priority strictly_override conflict with 409", async () => {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env, { activity: "quote_funnel", verticals: ["life"] });
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const offer = seedOfferWithPlacement(sdb, { activity: "quote_funnel", vertical: "life" });
    const base = { rule_level: "offer", target_offer_id: offer.offer_id, priority: 100, strictly_override: true, conditions_json: { groups: [] } };
    const a = await admin.request(`${API}/auctions/${json.public_id}/rules`, jsonInit("POST", { ...base, action: "exclude" }), env);
    expect(a.status).toBe(201);
    const b = await admin.request(`${API}/auctions/${json.public_id}/rules`, jsonInit("POST", { ...base, action: "include_only" }), env);
    expect(b.status).toBe(409);
    const j = (await b.json()) as { conflicts?: unknown[] };
    expect(Array.isArray(j.conflicts)).toBe(true);
  });

  it("PATCH + DELETE a rule (scoped to the auction)", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const created = await admin.request(`${API}/auctions/${json.public_id}/rules`, jsonInit("POST", { rule_level: "carrier", action: "exclude", conditions_json: { groups: [] } }), env);
    const rule = (await created.json()) as { public_id: string };
    const patched = await admin.request(`${API}/auctions/${json.public_id}/rules/${rule.public_id}`, jsonInit("PATCH", { priority: 5, enabled: false }), env);
    expect(patched.status).toBe(200);
    const p = (await patched.json()) as { priority: number; enabled: boolean };
    expect(p.priority).toBe(5);
    expect(p.enabled).toBe(false);
    const del = await admin.request(`${API}/auctions/${json.public_id}/rules/${rule.public_id}`, { method: "DELETE" }, env);
    expect(del.status).toBe(200);
    const list = await admin.request(`${API}/auctions/${json.public_id}/rules`, {}, env);
    const lj = (await list.json()) as { items: unknown[] };
    expect(lj.items.length).toBe(0);
  });

  it("a rule of auction A cannot be PATCHed or DELETEd via auction B's id (cross-auction scoping → 404)", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const a = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const b = await createAuction(env, { auction_name: "B", quote_id: quote.id });
    const created = await admin.request(`${API}/auctions/${a.json.public_id}/rules`, jsonInit("POST", { rule_level: "carrier", action: "exclude", conditions_json: { groups: [] } }), env);
    expect(created.status).toBe(201);
    const rule = (await created.json()) as { public_id: string };
    expect(rule.public_id).toMatch(/^lgar_/);
    // address A's rule via B's id → 404, no cross-auction reach.
    const patchViaB = await admin.request(`${API}/auctions/${b.json.public_id}/rules/${rule.public_id}`, jsonInit("PATCH", { priority: 9 }), env);
    expect(patchViaB.status).toBe(404);
    const delViaB = await admin.request(`${API}/auctions/${b.json.public_id}/rules/${rule.public_id}`, { method: "DELETE" }, env);
    expect(delViaB.status).toBe(404);
    // the rule still lives under A (untouched).
    const list = await admin.request(`${API}/auctions/${a.json.public_id}/rules`, {}, env);
    expect(((await list.json()) as { items: unknown[] }).items.length).toBe(1);
  });
});

// --- Banner builder (§20) ----------------------------------------------------

describeDb("leadgen auctions API — banner (§20)", () => {
  it("GET returns the §20 default when no banner row exists", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const res = await admin.request(`${API}/auctions/${json.public_id}/banner`, {}, env);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { mode: string; field_map_json: unknown };
    expect(j.mode).toBe("automatic");
    expect(j.field_map_json).toEqual({});
  });

  it("PUT automatic accepts ONLY canonical Carrier fields; rejects a non-canonical field", async () => {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env);
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const ok = await admin.request(`${API}/auctions/${json.public_id}/banner`, jsonInit("PUT", { mode: "automatic", field_map_json: { carrier_name: "slot-name", click_url: "slot-cta" } }), env);
    expect(ok.status).toBe(200);
    const bad = await admin.request(`${API}/auctions/${json.public_id}/banner`, jsonInit("PUT", { mode: "automatic", field_map_json: { not_a_carrier_field: "slot-x" } }), env);
    expect(bad.status).toBe(400);
    // the OK write is persisted (UNIQUE(auction_id) upsert)
    const row = sdb.prepare("SELECT mode, field_map_json FROM leadgen_auction_banners WHERE auction_id = ?").get(json.id) as { mode: string; field_map_json: string };
    expect(row.mode).toBe("automatic");
    expect(JSON.parse(row.field_map_json)).toEqual({ carrier_name: "slot-name", click_url: "slot-cta" });
  });

  it("PUT manual stores banner_config_json on the auction + upserts the banner row", async () => {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env);
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const res = await admin.request(`${API}/auctions/${json.public_id}/banner`, jsonInit("PUT", { mode: "manual", banner_config_json: { headline: "Best rates", cta: "Get quote" } }), env);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { mode: string; banner_config_json: unknown };
    expect(j.mode).toBe("manual");
    expect(j.banner_config_json).toEqual({ headline: "Best rates", cta: "Get quote" });
    const aRow = sdb.prepare("SELECT banner_config_json FROM leadgen_auctions WHERE id = ?").get(json.id) as { banner_config_json: string };
    expect(JSON.parse(aRow.banner_config_json)).toEqual({ headline: "Best rates", cta: "Get quote" });
    // exactly one banner row (upsert, not duplicate)
    const count = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_auction_banners WHERE auction_id = ?").get(json.id) as { n: number };
    expect(count.n).toBe(1);
  });

  // OWNER 2026-09-01 ("your creative looks horrible"): the card's button text
  // and the winner's badge text apply to an AUTOMATIC auction too, but the
  // editor's save path only sent banner_config_json in manual mode — so those
  // two fields were unauthorable for every automatic auction while the renderer
  // read them. Proven end to end here: the editor page ships the inputs, its
  // OWN save function (sliced from the SERVED page, never re-typed) puts them
  // in the automatic payload, the real handler persists them, and the real
  // renderer paints the persisted bytes.
  it("automatic mode: the served editor collects card copy, the handler stores it, the renderer paints it", async () => {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env);
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });

    // 1. the SERVED editor page carries both inputs
    const page = await admin.request(`/admin/leadgen/auction/${json.public_id}/edit`, {}, env);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('data-banner-config="cta"');
    expect(html).toContain('data-banner-config="badge"');
    // …and they sit OUTSIDE the manual-only panel, so automatic mode can reach
    // them: the last mode panel closes before the shared copy row starts.
    const sharedAt = html.indexOf('data-banner-config="cta"');
    const automaticPanelAt = html.indexOf('data-banner-panel="automatic"');
    expect(automaticPanelAt).toBeGreaterThan(-1);
    expect(sharedAt).toBeGreaterThan(automaticPanelAt);

    // 2. the page's OWN saveBanner, sliced out of the served script and run
    //    against a DOM stub, now sends banner_config_json in automatic mode
    const script = html.slice(html.indexOf("function saveBanner("));
    const saveBannerSrc = sliceFn(script, "saveBanner");
    const inputs = [
      { attr: "cta", value: "See my quote" },
      { attr: "badge", value: "Top pick" },
      { attr: "headline", value: "" },
    ];
    let sent: Record<string, unknown> | null = null;
    const ctx: Record<string, unknown> = {
      currentBannerMode: () => "automatic",
      root: {
        querySelectorAll: (sel: string) =>
          sel.includes("data-fieldmap-key")
            ? [{ getAttribute: () => "carrier_name", value: "slot-name" }]
            : inputs.map((i) => ({ getAttribute: () => i.attr, value: i.value })),
      },
      apiBase: "/api",
      byId: () => null,
      markDirty: () => undefined,
      dirty: true,
      fetch: (_url: string, init: { body: string }) => {
        sent = JSON.parse(init.body) as Record<string, unknown>;
        return { then: () => ({ then: () => undefined }) };
      },
    };
    runInNewContext(`${saveBannerSrc}\nsaveBanner();`, ctx);
    expect(sent).not.toBeNull();
    expect((sent as unknown as { mode: string }).mode).toBe("automatic");
    expect((sent as unknown as { field_map_json: unknown }).field_map_json).toEqual({ carrier_name: "slot-name" });
    // the fix: card copy rides along in AUTOMATIC mode (blank inputs skipped)
    expect((sent as unknown as { banner_config_json: unknown }).banner_config_json).toEqual({
      cta: "See my quote",
      badge: "Top pick",
    });

    // 3. the real handler persists exactly that
    const res = await admin.request(
      `${API}/auctions/${json.public_id}/banner`,
      jsonInit("PUT", sent as unknown as Record<string, unknown>),
      env,
    );
    expect(res.status).toBe(200);
    const aRow = sdb.prepare("SELECT banner_config_json FROM leadgen_auctions WHERE id = ?").get(json.id) as {
      banner_config_json: string;
    };
    const stored = JSON.parse(aRow.banner_config_json) as Record<string, unknown>;
    expect(stored).toEqual({ cta: "See my quote", badge: "Top pick" });

    // 4. the real renderer paints the PERSISTED bytes (no hand-built config)
    const rendered = renderBanners(
      [
        {
          carrier: {
            carrier_key: "c1",
            carrier_name: "NextInsure",
            carrier_logo: "",
            headline: "",
            subheadline: "",
            click_url: "https://example.com/x",
            bid: 1,
            bid_currency: "USD",
            tracking_id: "t",
            disclaimer: "",
          },
          offer_public_id: "lgo_1",
          slot: 1,
          source: "winner",
          bid: 1,
        },
      ] as unknown as Parameters<typeof renderBanners>[0],
      { auction_instance_id: "ai" },
      { mode: "automatic", banner_config_json: stored } as Parameters<typeof renderBanners>[2],
      bannerDefaultDesign,
      { mintId: () => "brid" },
    );
    expect(rendered.html).toContain('<span class="lg-banner-cta">See my quote</span>');
    expect(rendered.html).toContain('<div class="lg-banner-badge">Top pick</div>');
  });
});

// --- Analytics (§18.9 NULLIF) ------------------------------------------------

describeDb("leadgen auctions API — analytics (§18.9 NULLIF)", () => {
  function seedAuctionAnalytics(sdb: SqliteDb, publicId: string): void {
    sdb
      .prepare(
        `INSERT INTO leadgen_analytics_auction
           (auction_public_id, date, auctions, filled_auctions, unfilled_auctions, offer_impressions, carrier_impressions, carrier_clicks,
            bid_value_sum, eligible_bid_count, timeouts, below_floor, malformed, no_bid, provider_errors, latency_ms_sum, revenue)
         VALUES (?, '2026-07-01', 10, 8, 2, 40, 50, 10, 100, 20, 1, 3, 0, 2, 1, 5000, 30)`,
      )
      .run(publicId);
  }

  it("computes NULLIF-guarded ratios at read", async () => {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env);
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    seedAuctionAnalytics(sdb, json.public_id);
    const res = await admin.request(`${API}/auctions/${json.public_id}/analytics?from=2026-06-01&to=2026-07-31`, {}, env);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { analytics: Record<string, number | null> };
    const a = j.analytics;
    expect(a.auctions).toBe(10);
    expect(a.fill_rate).toBeCloseTo(0.8, 5);
    expect(a.avg_bid).toBeCloseTo(5, 5); // bid_value_sum/eligible_bid_count = 100/20
    expect(a.avg_rpc).toBeCloseTo(3, 5); // revenue/carrier_clicks = 30/10
    expect(a.carrier_ctr).toBeCloseTo(0.2, 5); // 10/50
  });

  it("returns NULL ratios (never fake 0) when there are no analytics rows", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const res = await admin.request(`${API}/auctions/${json.public_id}/analytics?from=2026-06-01&to=2026-07-31`, {}, env);
    const j = (await res.json()) as { analytics: Record<string, number | null> };
    expect(j.analytics.auctions).toBe(0);
    expect(j.analytics.fill_rate).toBeNull();
    expect(j.analytics.avg_bid).toBeNull();
  });
});

// --- /simulate — P10 dry-run trace + headers ---------------------------------

describeDb("leadgen auctions API — /simulate dry-run envelope", () => {
  it("POST /simulate returns a 200 dry-run trace for a real auction (no 501 seam)", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const { json } = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const res = await admin.request(`${API}/auctions/${json.public_id}/simulate`, jsonInit("POST", { sample_answers: {} }), env);
    expect(res.status, `simulate: ${await res.clone().text()}`).toBe(200);
    const j = (await res.json()) as { dry_run?: boolean; auction_public_id?: string; offers_considered?: unknown[] };
    expect(j.dry_run).toBe(true);
    expect(j.auction_public_id).toBe(json.public_id);
    expect(Array.isArray(j.offers_considered)).toBe(true);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("POST /simulate on an unknown auction is 404", async () => {
    const { env } = newHarness();
    const res = await admin.request(`${API}/auctions/${mintPublicId("auction")}/simulate`, jsonInit("POST", {}), env);
    expect(res.status).toBe(404);
  });
});
