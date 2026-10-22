// OWNER 2026-10-22 (CRITICAL): "In the "Leadgen" --> "Auction" --> "Rules" -->
// "Add a rule" menu --> the "or" operand isn't working when trying to use
// answers from more than 1 question. For example: When I want to combine the
// following "Business duration is "Haven't started yet" or Credit Score is
// "Unsure / Below 550". --> the "or" changes automatically to "and"."
//
// Root cause: §21.4 conditions only OR'd entries on the SAME field; the
// builder's "+ or" row re-clustered by field once its question changed, and
// the evaluator AND'd different fields. The fix: an optional entry key
// `or_group` — entries sharing one are ONE matching unit (any of them is
// enough); legacy entries (no key) keep the same-field unit.
//
// Proven here through: the ONE shared evaluator (conditionsMatch), the REAL
// admin API (auction rules, routing rules, funnel rules) over a node:sqlite
// schema built from the real migrations, the REAL auction dry-run route
// (/auctions/:id/simulate → runAuction), the REAL routing evaluator over rules
// read back from the DB, and the REAL admin islands (RULES_BUILDER_SCRIPT +
// QUOTE_RULES_SCRIPT) driven over a minimal DOM — the owner's own journey.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createContext, runInContext } from "node:vm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { conditionsHash, conditionsMatch } from "../src/leadgen/auction-rules";
import { validateFunnelRule } from "../src/leadgen/funnel";
import { loadQuoteRoutingRules, evaluateQuoteEntryRouting, type EntryKnownContext } from "../src/public/leadgen/resolver";
import {
  QUOTE_RULES_SCRIPT,
  RULES_BUILDER_SCRIPT,
  conditionsSentence,
  parseStoredConditions,
  renderQuoteRulesRail,
  renderRulesBuilderPanel,
  ruleValueText,
  serializeRows,
  type QuoteRulesRailData,
  type QuoteRulesRailRule,
  type RulesBuilderRow,
} from "../src/admin/leadgen/ui-rules-builder";
import type { LeadgenRuleConditions } from "../src/admin/leadgen/db-types";

// ---------------------------------------------------------------------------
// The owner's two questions (the auction rule-fields shape, rule-fields.ts)
// ---------------------------------------------------------------------------

const OWNER_FIELDS = [
  {
    internal_field: "business_duration",
    label: "Business duration",
    group: "question",
    choices: [
      { value: "havent_started", label: "Haven't started yet" },
      { value: "under_1_year", label: "Less than 1 year" },
    ],
    stored_choices: [
      { label: "Haven't started yet", stored: "havent_started" },
      { label: "Less than 1 year", stored: "under_1_year" },
    ],
  },
  {
    internal_field: "credit_score",
    label: "Credit Score",
    group: "question",
    choices: [
      { value: "700_plus", label: "700+" },
      { value: "below_550", label: "Unsure / Below 550" },
    ],
    stored_choices: [
      { label: "700+", stored: "700_plus" },
      { label: "Unsure / Below 550", stored: "below_550" },
    ],
  },
  { internal_field: "state", label: "State", group: "visitor", hint: "two-letter code, e.g. CA" },
];

const BD_HAVENT = { field: "business_duration", op: "eq", value: "havent_started" } as const;
const CS_BELOW = { field: "credit_score", op: "eq", value: "below_550" } as const;
const STATE_CA = { field: "state", op: "eq", value: "CA" } as const;
const OWNER_CONDITIONS = { groups: [{ ...BD_HAVENT, or_group: "g1" }, { ...CS_BELOW, or_group: "g1" }] };
const OWNER_SENTENCE = 'Matches when (Business duration is "Haven\'t started yet" or Credit Score is "Unsure / Below 550").';

function cond(c: unknown): LeadgenRuleConditions {
  return c as LeadgenRuleConditions;
}

// ===========================================================================
// 1 — the ONE shared evaluator
// ===========================================================================

describe("conditionsMatch — or_group: entries sharing one are ONE unit", () => {
  it("A or B across two questions matches either answer, both, and not neither", () => {
    const c = cond(OWNER_CONDITIONS);
    expect(conditionsMatch(c, { business_duration: "havent_started" })).toBe(true);
    expect(conditionsMatch(c, { credit_score: "below_550" })).toBe(true);
    expect(conditionsMatch(c, { business_duration: "havent_started", credit_score: "below_550" })).toBe(true);
    expect(conditionsMatch(c, { business_duration: "under_1_year", credit_score: "700_plus" })).toBe(false);
    expect(conditionsMatch(c, {})).toBe(false);
  });

  it("(A or B) and C", () => {
    const c = cond({ groups: [{ ...BD_HAVENT, or_group: "g1" }, STATE_CA, { ...CS_BELOW, or_group: "g1" }] });
    expect(conditionsMatch(c, { business_duration: "havent_started", state: "CA" })).toBe(true);
    expect(conditionsMatch(c, { credit_score: "below_550", state: "CA" })).toBe(true);
    expect(conditionsMatch(c, { credit_score: "below_550", state: "TX" })).toBe(false);
    expect(conditionsMatch(c, { state: "CA" })).toBe(false);
  });

  it("two separate or groups AND together; a legacy same-field entry beside a group stays its own unit", () => {
    const c = cond({
      groups: [
        { ...BD_HAVENT, or_group: "a" },
        { ...CS_BELOW, or_group: "a" },
        { field: "state", op: "eq", value: "CA", or_group: "b" },
        { field: "device", op: "eq", value: "mobile", or_group: "b" },
      ],
    });
    expect(conditionsMatch(c, { business_duration: "havent_started", device: "mobile" })).toBe(true);
    expect(conditionsMatch(c, { credit_score: "below_550", state: "CA" })).toBe(true);
    expect(conditionsMatch(c, { credit_score: "below_550" })).toBe(false);
    const mixed = cond({ groups: [{ ...STATE_CA, or_group: "g1" }, { ...CS_BELOW, or_group: "g1" }, { field: "state", op: "eq", value: "TX" }] });
    // (state CA or credit below) AND state TX
    expect(conditionsMatch(mixed, { state: "TX", credit_score: "below_550" })).toBe(true);
    expect(conditionsMatch(mixed, { state: "CA" })).toBe(false);
  });

  it("legacy data (no or_group) evaluates exactly as before: same field OR, different fields AND", () => {
    const c = cond({ groups: [STATE_CA, { field: "age", op: "gte", value: 21 }, { field: "state", op: "eq", value: "TX" }] });
    expect(conditionsMatch(c, { state: "TX", age: 30 })).toBe(true);
    expect(conditionsMatch(c, { state: "CA", age: 18 })).toBe(false);
    expect(conditionsMatch(c, { state: "NV", age: 30 })).toBe(false);
    expect(conditionsMatch(cond({ groups: [BD_HAVENT, CS_BELOW] }), { business_duration: "havent_started" })).toBe(false);
  });

  it("Match ANY ORs the units; empty groups always match", () => {
    const c = cond({ groups: [{ ...BD_HAVENT, or_group: "g1" }, { ...CS_BELOW, or_group: "g1" }, STATE_CA] });
    expect(conditionsMatch(c, { state: "CA" }, "any")).toBe(true);
    expect(conditionsMatch(c, { credit_score: "below_550" }, "any")).toBe(true);
    expect(conditionsMatch(c, { state: "TX" }, "any")).toBe(false);
    expect(conditionsMatch(cond({ groups: [] }), {})).toBe(true);
    expect(conditionsMatch(cond({ groups: [] }), {}, "any")).toBe(true);
  });

  it("an or_group carried by ONE entry has nothing to OR with — it is read like a legacy entry (by its question)", () => {
    const lonely = cond({ groups: [{ ...STATE_CA, or_group: "g1" }, { field: "state", op: "eq", value: "TX" }] });
    const legacy = cond({ groups: [STATE_CA, { field: "state", op: "eq", value: "TX" }] });
    for (const ctx of [{ state: "CA" }, { state: "TX" }, { state: "NV" }, {}]) {
      expect(conditionsMatch(lonely, ctx), JSON.stringify(ctx)).toBe(conditionsMatch(legacy, ctx));
    }
  });
});

// ===========================================================================
// 1b — conditions_hash (fix round 1, MINOR-1): or_group names are canonical
// ===========================================================================

describe("conditionsHash — logically identical or groups hash identically", () => {
  const h = (c: unknown): string => conditionsHash(cond(c));
  const TX_OR_CA = { field: "state", op: "in", values: ["TX", "CA"] } as const;
  // Pinned from the production canonicalizer (c4044672 — unchanged by this
  // feature): rules without or_group keep their stored hashes byte-for-byte.
  const LEGACY_BD_CS = "214d1448318234866afc375a2c5cb6c832b7690f981a6f6c9489c8e82adb2b03";
  const LEGACY_ST_TX_BD = "34c8f6bd50fb3a5af995fc8f781ee180a930f3a588eb14e18a50cbdd0e6fcd4b";
  const LEGACY_EMPTY = "47aec4b16657492be8ea01cac39a2b54a0485f848fdc1bae4e70dd6bad83abd8";

  it("legacy rules (no or_group) hash exactly as before", () => {
    expect(h({ groups: [BD_HAVENT, CS_BELOW] })).toBe(LEGACY_BD_CS);
    expect(h({ groups: [CS_BELOW, BD_HAVENT] })).toBe(LEGACY_BD_CS);
    expect(h({ groups: [STATE_CA, TX_OR_CA, BD_HAVENT] })).toBe(LEGACY_ST_TX_BD);
    expect(h({ groups: [] })).toBe(LEGACY_EMPTY);
  });

  it("the group's NAME never matters: g1 / zz / swapped names / another entry order hash the same", () => {
    const base = h({ groups: [{ ...BD_HAVENT, or_group: "g1" }, { ...CS_BELOW, or_group: "g1" }] });
    expect(h({ groups: [{ ...BD_HAVENT, or_group: "zz" }, { ...CS_BELOW, or_group: "zz" }] })).toBe(base);
    expect(h({ groups: [{ ...CS_BELOW, or_group: "x" }, { ...BD_HAVENT, or_group: "x" }] })).toBe(base);
    const two = h({ groups: [{ ...BD_HAVENT, or_group: "a" }, { ...CS_BELOW, or_group: "a" }, { ...STATE_CA, or_group: "b" }, { ...TX_OR_CA, or_group: "b" }] });
    expect(h({ groups: [{ ...BD_HAVENT, or_group: "b" }, { ...CS_BELOW, or_group: "b" }, { ...STATE_CA, or_group: "a" }, { ...TX_OR_CA, or_group: "a" }] })).toBe(two);
    expect(h({ groups: [{ ...TX_OR_CA, or_group: "g1" }, { ...CS_BELOW, or_group: "g2" }, { ...STATE_CA, or_group: "g1" }, { ...BD_HAVENT, or_group: "g2" }] })).toBe(two);
  });

  it("a name carried by ONE entry is dropped: it hashes like the same rule without the key", () => {
    expect(h({ groups: [{ ...BD_HAVENT, or_group: "solo" }, CS_BELOW] })).toBe(LEGACY_BD_CS);
    expect(h({ groups: [{ ...BD_HAVENT, or_group: "p" }, { ...CS_BELOW, or_group: "q" }] })).toBe(LEGACY_BD_CS);
  });

  it("different logic still hashes differently", () => {
    const anyOf = h({ groups: [{ ...BD_HAVENT, or_group: "g1" }, { ...CS_BELOW, or_group: "g1" }] });
    expect(anyOf).not.toBe(LEGACY_BD_CS); // (A or B) ≠ A and B
    const abC = h({ groups: [{ ...BD_HAVENT, or_group: "g1" }, { ...CS_BELOW, or_group: "g1" }, STATE_CA] });
    const acB = h({ groups: [{ ...BD_HAVENT, or_group: "g1" }, { ...STATE_CA, or_group: "g1" }, CS_BELOW] });
    expect(abC).not.toBe(acB); // (A or B) and C ≠ (A or C) and B
    const overlap1 = h({ groups: [{ ...BD_HAVENT, or_group: "x" }, { ...CS_BELOW, or_group: "x" }, { ...BD_HAVENT, or_group: "y" }, { ...STATE_CA, or_group: "y" }] });
    const overlap2 = h({ groups: [{ ...BD_HAVENT, or_group: "y" }, { ...STATE_CA, or_group: "y" }, { ...BD_HAVENT, or_group: "x" }, { ...CS_BELOW, or_group: "x" }] });
    expect(overlap2).toBe(overlap1); // (A or B) and (A or C), written in either order
    expect(overlap1).not.toBe(h({ groups: [{ ...BD_HAVENT, or_group: "x" }, { ...STATE_CA, or_group: "x" }, { ...BD_HAVENT, or_group: "y" }, { ...STATE_CA, or_group: "y" }] }));
  });
});

// ===========================================================================
// node:sqlite harness over the real migrations (repo pattern)
// ===========================================================================

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
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
const MIGRATIONS_DIR = join(TEST_DIR, "..", "migrations");
const API = "/api/admin/leadgen";

function createDb(ctor: DatabaseSyncCtor): SqliteDb {
  const sdb = new ctor(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','or.example.com','insurance','active');",
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 36)
    .sort();
  for (const f of files) runSql(sdb, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
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
    DEV_BYPASS_AUTH: "true",
  } as unknown as Env;
}

async function adminReq(env: Env, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const init: RequestInit = body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await admin.request(`${API}${path}`, init, env);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- auction seed (the simulate suite's shapes) ----------------------------

const CARRIER_PARSE = JSON.stringify({ carriers_path: "carriers", fields: { carrier_name: "name", bid: "bid", click_url: "url", carrier_logo: "logo" } });

function seedDynamicOffer(sdb: SqliteDb): { offer_id: number; offer_public_id: string; placement_id: number } {
  const offerPublic = mintPublicId("offer");
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, request_method, endpoint_production, endpoint_staging, status)
       VALUES (?, ?, 'Prov', 'quote_funnel', 'life', 's2s_postback', 'cpc', 1, 'response', 'server', 'POST',
               'https://provider.example/quote', 'https://staging.provider.example/quote', 'active')`,
    )
    .run(offerPublic, `Offer ${offerPublic.slice(-4)}`);
  const offer = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(offerPublic) as { id: number };
  const schemaPublic = mintPublicId("payload_schema_version");
  sdb
    .prepare(
      "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, carrier_parse_json, carrier_parse_version, source) VALUES (?, ?, 1, ?, ?, 1, 'manual')",
    )
    .run(schemaPublic, offer.id, JSON.stringify({ version: 1, root: { type: "object", children: [] } }), CARRIER_PARSE);
  const schema = sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = ?").get(schemaPublic) as { id: number };
  sdb.prepare("UPDATE leadgen_offers SET active_payload_schema_id = ? WHERE id = ?").run(schema.id, offer.id);
  const placementPublic = mintPublicId("offer_placement");
  sdb.prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)").run(placementPublic, offer.id, `plc-${offerPublic.slice(-4)}`);
  const placement = sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(placementPublic) as { id: number };
  sdb
    .prepare("UPDATE leadgen_offers SET last_test_status = 'passed', last_test_at = unixepoch(), last_test_source = 'test' WHERE public_id = ?")
    .run(offerPublic);
  return { offer_id: offer.id, offer_public_id: offerPublic, placement_id: placement.id };
}

function seedAuction(sdb: SqliteDb): { id: number; public_id: string } {
  const publicId = mintPublicId("auction");
  sdb
    .prepare(
      `INSERT INTO leadgen_auctions
         (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
          surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
          backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
       VALUES (?, 'Or rules', 'dynamic', 'highest_bid', 'percentage_of_max', 10, 'enabled', 1, 5, 3, 10, 'disabled', 'on_slot_exhaustion', 0, 'offer', 2500, 1, 'active')`,
    )
    .run(publicId);
  const row = sdb.prepare("SELECT id FROM leadgen_auctions WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

function auctionHarness(): { sdb: SqliteDb; env: Env; auction: { id: number; public_id: string }; offer: ReturnType<typeof seedDynamicOffer> } {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  const env = buildEnv(d1FromSqlite(sdb));
  const auction = seedAuction(sdb);
  const offer = seedDynamicOffer(sdb);
  sdb
    .prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, enabled) VALUES (?, ?, ?, 0, 1)")
    .run(auction.id, offer.placement_id, offer.offer_id);
  vi.stubGlobal(
    "fetch",
    async (): Promise<Response> =>
      new Response(JSON.stringify({ carriers: [{ name: "Acme", bid: 12, url: "https://acme.example/click", logo: "https://acme.example/l.png" }] }), { status: 200 }),
  );
  return { sdb, env, auction, offer };
}

interface SimulateBody {
  status?: string;
  unfilled_reason?: string | null;
  offers_excluded: Array<{ offer_id: string; reason: string }>;
  carriers_shown: unknown[];
}
async function simulate(env: Env, auctionPublicId: string, answers: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<SimulateBody> {
  const res = await adminReq(env, "POST", `/auctions/${auctionPublicId}/simulate`, { sample_answers: answers, ...extra });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json as unknown as SimulateBody;
}

// ===========================================================================
// 2 — Auction → Rules: the real admin API + the real auction dry-run
// ===========================================================================

describeDb("Auction rules — the owner's rule through the real admin API and the auction engine", () => {
  it("saves the or group (stored, listed back), and the engine hides the offer for EITHER answer, not for neither", async () => {
    const { sdb, env, auction, offer } = auctionHarness();
    const created = await adminReq(env, "POST", `/auctions/${auction.public_id}/rules`, {
      rule_level: "offer",
      action: "exclude",
      target_offer_id: offer.offer_id,
      conditions_json: OWNER_CONDITIONS,
      priority: 50,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const stored = sdb.prepare("SELECT conditions_json FROM leadgen_auction_rules WHERE public_id = ?").get(created.json["public_id"]) as { conditions_json: string };
    expect(JSON.parse(stored.conditions_json)).toEqual(OWNER_CONDITIONS);
    const list = await adminReq(env, "GET", `/auctions/${auction.public_id}/rules`);
    const listed = (list.json["items"] as Array<{ public_id: string; conditions_json: unknown }>).find((r) => r.public_id === created.json["public_id"]);
    expect(listed?.conditions_json).toEqual(OWNER_CONDITIONS);

    const hidden = (j: SimulateBody): boolean => j.offers_excluded.some((o) => o.offer_id === offer.offer_public_id && o.reason.includes("exclude"));
    const onlyDuration = await simulate(env, auction.public_id, { business_duration: "havent_started", credit_score: "700_plus" });
    expect(hidden(onlyDuration), "Business duration = Haven't started yet only").toBe(true);
    expect(onlyDuration.carriers_shown).toHaveLength(0);
    const onlyCredit = await simulate(env, auction.public_id, { business_duration: "under_1_year", credit_score: "below_550" });
    expect(hidden(onlyCredit), "Credit Score = Unsure / Below 550 only").toBe(true);
    const neither = await simulate(env, auction.public_id, { business_duration: "under_1_year", credit_score: "700_plus" });
    expect(hidden(neither), "neither answer").toBe(false);
    expect(neither.carriers_shown.length).toBeGreaterThan(0);
  });

  it("end to end: the JSON the builder writes for the owner's clicks, saved through the API, hides the offer for either answer", async () => {
    const { env, auction, offer } = auctionHarness();
    const built = JSON.parse(ownerJourneyJson()) as unknown;
    const created = await adminReq(env, "POST", `/auctions/${auction.public_id}/rules`, {
      rule_level: "offer",
      action: "exclude",
      target_offer_id: offer.offer_id,
      conditions_json: built,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    expect(created.json["conditions_json"]).toEqual(built);
    const hidden = (j: SimulateBody): boolean => j.offers_excluded.some((o) => o.offer_id === offer.offer_public_id);
    expect(hidden(await simulate(env, auction.public_id, { business_duration: "havent_started" }))).toBe(true);
    expect(hidden(await simulate(env, auction.public_id, { credit_score: "below_550" }))).toBe(true);
    expect(hidden(await simulate(env, auction.public_id, {}))).toBe(false);
  });

  it("(A or B) and C through the API: the offer is hidden only when the visitor also matches C", async () => {
    const { env, auction, offer } = auctionHarness();
    const created = await adminReq(env, "POST", `/auctions/${auction.public_id}/rules`, {
      rule_level: "offer",
      action: "exclude",
      target_offer_id: offer.offer_id,
      conditions_json: { groups: [...OWNER_CONDITIONS.groups, { field: "homeowner", op: "eq", value: true }] },
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const hidden = (j: SimulateBody): boolean => j.offers_excluded.some((o) => o.offer_id === offer.offer_public_id);
    expect(hidden(await simulate(env, auction.public_id, { credit_score: "below_550", homeowner: true }))).toBe(true);
    expect(hidden(await simulate(env, auction.public_id, { credit_score: "below_550", homeowner: false }))).toBe(false);
  });

  it("refuses a malformed or_group, and Share of traffic inside an or group", async () => {
    const { env, auction, offer } = auctionHarness();
    const post = (groups: unknown[]) =>
      adminReq(env, "POST", `/auctions/${auction.public_id}/rules`, { rule_level: "offer", action: "exclude", target_offer_id: offer.offer_id, conditions_json: { groups } });
    for (const bad of ["", "has space", "x".repeat(33), 7, null, "é"]) {
      const res = await post([{ ...BD_HAVENT, or_group: bad }, { ...CS_BELOW, or_group: bad }]);
      expect(res.status, `or_group ${JSON.stringify(bad)}`).toBe(400);
      expect(JSON.stringify(res.json)).toContain("or_group");
    }
    const share = await post([{ field: "traffic_share", op: "eq", value: 10, or_group: "g1" }, { ...CS_BELOW, or_group: "g1" }]);
    expect(share.status).toBe(400);
    expect(JSON.stringify(share.json)).toContain("Share of traffic");
    const ok = await post([{ ...BD_HAVENT, or_group: "Or_group-1" }, { ...CS_BELOW, or_group: "Or_group-1" }]);
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
  });

  it("the rule list's IF line reads the real logic: (… or …)", async () => {
    const { env, auction, offer } = auctionHarness();
    const created = await adminReq(env, "POST", `/auctions/${auction.public_id}/rules`, {
      rule_level: "offer",
      action: "exclude",
      target_offer_id: offer.offer_id,
      conditions_json: OWNER_CONDITIONS,
    });
    expect(created.status).toBe(201);
    // the REAL Auction editor page (Leadgen → Auction → Rules list); this
    // harness seeds no funnel questions, so the fields read by their names
    const page = await (await admin.request(`/admin/leadgen/auction/${auction.public_id}/edit`, {}, env)).text();
    expect(page).toContain("IF: Matches when (business_duration is &quot;havent_started&quot; or credit_score is &quot;below_550&quot;).");
    // with the questions' own words (the same sentence ui-auctions.ts ifSentence prints)
    const parsed = parseStoredConditions(OWNER_CONDITIONS);
    expect(parsed.ok).toBe(true);
    const labelOf = (f: string): string => OWNER_FIELDS.find((x) => x.internal_field === f)?.label ?? f;
    const valueOf = (f: string, v: unknown): string => ruleValueText(OWNER_FIELDS.find((x) => x.internal_field === f) as never, v as never);
    expect(conditionsSentence(parsed.ok ? parsed.rows : [], labelOf, valueOf)).toBe(OWNER_SENTENCE);
  });
});

// ===========================================================================
// 3 — the builder island, driven: the owner's own journey
// ===========================================================================

// A minimal DOM — enough for the island's createElement/textContent/attribute
// writes and its [attr] / #id / .class lookups (repo pattern).
class FakeNode {
  tagName: string;
  className = "";
  type = "";
  value = "";
  title = "";
  selected = false;
  disabled = false;
  hidden = false;
  checked = false;
  attrs: Record<string, string> = {};
  children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  listeners: Record<string, Array<(e: unknown) => void>> = {};
  private text = "";
  constructor(tag: string, attrs: Record<string, string> = {}, cls = "") {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.className = cls;
  }
  get firstChild(): FakeNode | null {
    return this.children[0] ?? null;
  }
  appendChild(n: FakeNode): FakeNode {
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.children.push(n);
    return n;
  }
  removeChild(n: FakeNode): FakeNode {
    const i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  get nextSibling(): FakeNode | null {
    const p = this.parentNode;
    if (!p) return null;
    return p.children[p.children.indexOf(this) + 1] ?? null;
  }
  insertBefore(n: FakeNode, ref: FakeNode | null | undefined): FakeNode {
    if (n.parentNode) n.parentNode.removeChild(n);
    const i = ref ? this.children.indexOf(ref) : -1;
    n.parentNode = this;
    if (i < 0) this.children.push(n);
    else this.children.splice(i, 0, n);
    return n;
  }
  setAttribute(k: string, v: unknown): void {
    this.attrs[k] = String(v);
  }
  getAttribute(k: string): string | null {
    return k in this.attrs ? (this.attrs[k] ?? null) : null;
  }
  hasAttribute(k: string): boolean {
    return k in this.attrs;
  }
  removeAttribute(k: string): void {
    delete this.attrs[k];
  }
  addEventListener(t: string, f: (e: unknown) => void): void {
    (this.listeners[t] ??= []).push(f);
  }
  dispatchEvent(): boolean {
    return true;
  }
  focus(): void {}
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(t: string) {
    this.children = [];
    this.text = String(t);
  }
  fire(type: string, event: Record<string, unknown> = {}): void {
    for (const f of this.listeners[type] ?? []) f({ keyCode: 0, target: this, ...event });
  }
  all(): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (n: FakeNode): void => {
      for (const c of n.children) {
        out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  matches(sel: string): boolean {
    if (sel.startsWith("#")) return this.attrs["id"] === sel.slice(1);
    if (sel.startsWith("[")) return sel.slice(1, -1) in this.attrs;
    const classes = this.className.split(" ");
    return sel.split(".").filter((c) => c !== "").every((c) => classes.includes(c));
  }
  querySelector(sel: string): FakeNode | null {
    return this.all().find((n) => n.matches(sel)) ?? null;
  }
  querySelectorAll(sel: string): FakeNode[] {
    return this.all().filter((n) => n.matches(sel));
  }
  byClass(cls: string): FakeNode[] {
    return this.all().filter((n) => n.className.split(" ").includes(cls));
  }
}

interface BuilderApi {
  mount(container: FakeNode, raw: string, out: FakeNode | null, options: Record<string, unknown>): { serialize(): string; setMatch?(m: string): void };
  parseConditions(raw: unknown): { ok: boolean; rows?: unknown[]; reason?: string };
  serializeRows(rows: unknown[]): string;
  cardSentence(rows: unknown[], labelOf: (f: string) => string, valueOf: unknown, joinWord?: string): string;
  makeValueOf(fields: unknown[]): unknown;
}

function fakeDocument(byId: (id: string) => FakeNode | null = () => null): Record<string, unknown> {
  const fakeEvent = { initEvent: (): void => {}, initCustomEvent: (): void => {} };
  return {
    readyState: "complete",
    getElementById: byId,
    createElement: (tag: string): FakeNode => new FakeNode(tag),
    createTextNode: (t: string): FakeNode => {
      const tn = new FakeNode("#text");
      tn.textContent = t;
      return tn;
    },
    createEvent: (): typeof fakeEvent => fakeEvent,
  };
}

function bootBuilder(): BuilderApi {
  const windowObj: Record<string, unknown> = {};
  runInContext(RULES_BUILDER_SCRIPT, createContext({ window: windowObj, document: fakeDocument() }));
  return windowObj["lgRulesBuilder"] as BuilderApi;
}

// One mounted builder (the auction "Add a rule" modal mounts exactly this:
// lgRulesBuilder.mount(condMount, condOut.value, condOut, { fields })).
function mountOwner(api: BuilderApi, raw = "", options: Record<string, unknown> = {}) {
  const container = new FakeNode("div");
  const out = new FakeNode("input");
  const handle = api.mount(container, raw, out, { fields: OWNER_FIELDS, ...options });
  const zone = (): FakeNode => container.byClass("lg-rb-clusters")[0]!;
  return {
    container,
    out,
    handle,
    zone,
    rows: (): FakeNode[] => container.byClass("lg-rb-row"),
    clusters: (): FakeNode[] => zone().children.filter((c) => c.hasAttribute("data-lg-rb-cluster")),
    // every separator word, in screen order (and / or)
    separators: (): string[] => zone().all().filter((n) => n.className === "lg-rb-andsep" || n.className === "lg-rb-orsep").map((n) => n.textContent),
    sentence: (): string => container.byClass("lg-rb-sentence")[0]!.textContent,
    button: (label: string): FakeNode => container.all().find((n) => n.tagName === "BUTTON" && n.textContent === label)!,
    groups: (): Array<Record<string, unknown>> => (JSON.parse(out.value) as { groups: Array<Record<string, unknown>> }).groups,
  };
}

function pickField(row: FakeNode, field: string): void {
  const sel = row.byClass("lg-rb-field")[0]!;
  sel.value = field;
  sel.fire("change");
}
function pickAnswer(row: FakeNode, label: string): void {
  const sel = row.byClass("lg-rb-answer")[0]!;
  const idx = sel.children.findIndex((o) => o.textContent === label);
  expect(idx, `answer "${label}" offered`).toBeGreaterThanOrEqual(0);
  sel.value = String(idx);
  sel.fire("change");
}

// The owner's clicks on a fresh "Add a rule" builder; returns the JSON the
// builder writes into the modal's hidden conditions input.
function ownerJourneyJson(): string {
  const b = mountOwner(bootBuilder());
  b.button("+ Add condition").fire("click");
  pickField(b.rows()[0]!, "business_duration");
  pickAnswer(b.rows()[0]!, "Haven't started yet");
  b.button("+ or").fire("click");
  pickField(b.rows()[1]!, "credit_score");
  pickAnswer(b.rows()[1]!, "Unsure / Below 550");
  return b.out.value;
}

describe("Rules builder — the owner's journey: Business duration … + or … Credit Score", () => {
  it('"+ or", then changing the new row to another question keeps "or": one cluster, one shared or_group, the sentence reads (… or …)', () => {
    const api = bootBuilder();
    const b = mountOwner(api);
    b.button("+ Add condition").fire("click");
    pickField(b.rows()[0]!, "business_duration");
    pickAnswer(b.rows()[0]!, "Haven't started yet");
    b.button("+ or").fire("click");
    expect(b.rows()).toHaveLength(2);
    pickField(b.rows()[1]!, "credit_score");
    pickAnswer(b.rows()[1]!, "Unsure / Below 550");

    expect(b.separators(), "the word between the two questions").toEqual(["or"]);
    expect(b.clusters()).toHaveLength(1);
    const groups = b.groups();
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => [g["field"], g["op"], g["value"]])).toEqual([
      ["business_duration", "eq", "havent_started"],
      ["credit_score", "eq", "below_550"],
    ]);
    const og = groups[0]!["or_group"];
    expect(typeof og).toBe("string");
    expect(og).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(groups[1]!["or_group"]).toBe(og);
    expect(b.sentence()).toBe(OWNER_SENTENCE);
    // the engine reads the saved JSON exactly as the sentence says
    const saved = cond(JSON.parse(b.out.value));
    expect(conditionsMatch(saved, { business_duration: "havent_started" })).toBe(true);
    expect(conditionsMatch(saved, { credit_score: "below_550" })).toBe(true);
    expect(conditionsMatch(saved, { business_duration: "under_1_year", credit_score: "700_plus" })).toBe(false);

    // reopen: the saved rule parses back into the same "or" cluster
    const reopened = mountOwner(api, b.out.value);
    expect(reopened.separators()).toEqual(["or"]);
    expect(reopened.clusters()).toHaveLength(1);
    expect(reopened.sentence()).toBe(OWNER_SENTENCE);
    expect(reopened.handle.serialize()).toBe(b.out.value);
  });

  it('a further "+ Add condition" (State is "CA") is AND-ed with the or group: (… or …) and State is "CA"', () => {
    const api = bootBuilder();
    const b = mountOwner(api, JSON.stringify(OWNER_CONDITIONS));
    b.button("+ Add condition").fire("click");
    const third = b.rows()[2]!;
    pickField(third, "state");
    const value = b.rows()[2]!.byClass("lg-rb-value").find((n) => n.tagName === "INPUT")!;
    value.value = "CA";
    value.fire("input");
    expect(b.separators()).toEqual(["or", "and"]);
    expect(b.sentence()).toBe('Matches when (Business duration is "Haven\'t started yet" or Credit Score is "Unsure / Below 550") and State is "CA".');
    const groups = b.groups();
    expect(groups[2]).toEqual({ field: "state", op: "eq", value: "CA" });
    expect(groups[0]!["or_group"]).toBe(groups[1]!["or_group"]);
  });

  it("removing a row down to one drops the or_group", () => {
    const api = bootBuilder();
    const b = mountOwner(api, JSON.stringify(OWNER_CONDITIONS));
    const removeOf = (row: FakeNode): FakeNode => row.all().find((n) => n.tagName === "BUTTON" && n.getAttribute("aria-label") === "Remove condition")!;
    removeOf(b.rows()[1]!).fire("click");
    expect(b.groups()).toEqual([BD_HAVENT]);
    expect(b.separators()).toEqual([]);
  });

  it("Match ANY reads 'or' between the clusters and keeps the parentheses", () => {
    const api = bootBuilder();
    const b = mountOwner(api, JSON.stringify({ groups: [...OWNER_CONDITIONS.groups, STATE_CA] }), { match: "any" });
    expect(b.sentence()).toBe('Matches when (Business duration is "Haven\'t started yet" or Credit Score is "Unsure / Below 550") or State is "CA".');
    expect(b.separators()).toEqual(["or", "or"]);
  });
});

// ===========================================================================
// 3b — Fix round 1 (review BLOCKER): "+ Add condition" followed by a question
// change stays AND. Only "+ or" makes an or group (it names one AT CLICK
// TIME); a row keeps its cluster on a question change only when it already
// carries an or_group; "+ Add condition" starts on the first unused question.
// ===========================================================================

// The reviewer's dev page: two carrier questions + State (labels/values as
// the reviewer's j1/failbefore logs show them).
const CARRIER_SIMPLE = "Which carrier do you want a quote from? (Simple answer buttons)";
const CARRIER_IMAGE = "Which carrier do you want a quote from? (Image answer cards)";
const REVIEWER_FIELDS = [
  {
    internal_field: "r2fix_carrier",
    label: CARRIER_SIMPLE,
    group: "question",
    choices: [
      { value: "acme_insurance", label: "Acme Insurance" },
      { value: "beta_mutual", label: "Beta Mutual" },
      { value: "gamma_direct", label: "Gamma Direct" },
    ],
    stored_choices: [
      { label: "Acme Insurance", stored: "acme_insurance" },
      { label: "Beta Mutual", stored: "beta_mutual" },
      { label: "Gamma Direct", stored: "gamma_direct" },
    ],
  },
  {
    internal_field: "field_msotdm9w_6el7",
    label: CARRIER_IMAGE,
    group: "question",
    choices: [
      { value: "option_1", label: "Option 1" },
      { value: "option_2", label: "Option 2" },
    ],
    stored_choices: [
      { label: "Option 1", stored: "option_1" },
      { label: "Option 2", stored: "option_2" },
    ],
  },
  { internal_field: "state", label: "State", group: "visitor", hint: "two-letter code, e.g. CA" },
];

// The question a row's field select shows (the island marks it selected).
function shownField(row: FakeNode): string {
  const sel = row.byClass("lg-rb-field")[0]!;
  const opts = sel.all().filter((n) => n.tagName === "OPTION" && n.selected);
  expect(opts, "one selected question").toHaveLength(1);
  return opts[0]!.value;
}

// The TS twin reads the island's saved JSON identically: parse → serialize is
// byte-identical and the TS sentence equals the sentence the island shows.
function expectTsParity(b: ReturnType<typeof mountOwner>, fields: ReadonlyArray<{ internal_field: string; label: string }>): void {
  const json = b.out.value;
  const ts = parseStoredConditions(JSON.parse(json));
  expect(ts.ok, json).toBe(true);
  const rows = (ts.ok ? ts.rows : []) as RulesBuilderRow[];
  expect(serializeRows(rows), "TS serialize of the island's JSON").toBe(json);
  const labelOf = (f: string): string => fields.find((x) => x.internal_field === f)?.label ?? f;
  const valueOf = (f: string, v: unknown): string => ruleValueText(fields.find((x) => x.internal_field === f) as never, v as never);
  expect(conditionsSentence(rows, labelOf, valueOf), "TS sentence = island sentence").toBe(b.sentence());
}

describe('Rules builder — "+ Add condition" then a question change stays AND (fix round 1)', () => {
  it('the reviewer\'s exact scenario: carrier is "Gamma Direct" → "+ Add condition" → the new row switched to the image-card question saves AND (no or_group), as production does', () => {
    const b = mountOwner(bootBuilder(), "", { fields: REVIEWER_FIELDS });
    b.button("+ Add condition").fire("click");
    pickField(b.rows()[0]!, "r2fix_carrier");
    pickAnswer(b.rows()[0]!, "Gamma Direct");
    b.button("+ Add condition").fire("click");
    const startedOn = shownField(b.rows()[1]!);
    const separatorsAtAdd = b.separators();
    pickField(b.rows()[1]!, "field_msotdm9w_6el7");
    pickAnswer(b.rows()[1]!, "Option 2");

    expect(b.separators(), "the word between the two questions").toEqual(["and"]);
    expect(b.clusters()).toHaveLength(2);
    expect(b.groups()).toEqual([
      { field: "r2fix_carrier", op: "eq", value: "gamma_direct" },
      { field: "field_msotdm9w_6el7", op: "eq", value: "option_2" },
    ]);
    expect(b.sentence()).toBe(`Matches when ${CARRIER_SIMPLE} is "Gamma Direct" and ${CARRIER_IMAGE} is "Option 2".`);
    expectTsParity(b, REVIEWER_FIELDS);
    const saved = cond(JSON.parse(b.out.value));
    expect(conditionsMatch(saved, { r2fix_carrier: "gamma_direct", field_msotdm9w_6el7: "option_2" })).toBe(true);
    expect(conditionsMatch(saved, { r2fix_carrier: "gamma_direct" })).toBe(false);
    expect(conditionsMatch(saved, { field_msotdm9w_6el7: "option_2" })).toBe(false);
    // (c) the new row started on the first question not used yet — never inside the carrier cluster
    expect(startedOn).toBe("field_msotdm9w_6el7");
    expect(separatorsAtAdd).toEqual(["and"]);
  });

  it("the same scenario with the new row drawn INSIDE the carrier cluster first (as production's '+ Add condition' starts it): switching its question leaves the cluster → AND", () => {
    const b = mountOwner(bootBuilder(), "", { fields: REVIEWER_FIELDS });
    b.button("+ Add condition").fire("click");
    pickField(b.rows()[0]!, "r2fix_carrier");
    pickAnswer(b.rows()[0]!, "Gamma Direct");
    b.button("+ Add condition").fire("click");
    pickField(b.rows()[1]!, "r2fix_carrier");
    pickAnswer(b.rows()[1]!, "Acme Insurance");
    // two answers to ONE question: the engine ORs them, the screen says "or" (legacy, no or_group)
    expect(b.separators()).toEqual(["or"]);
    expect(b.groups().every((g) => !("or_group" in g))).toBe(true);
    pickField(b.rows()[1]!, "field_msotdm9w_6el7");
    pickAnswer(b.rows()[1]!, "Option 2");
    expect(b.separators()).toEqual(["and"]);
    expect(b.groups()).toEqual([
      { field: "r2fix_carrier", op: "eq", value: "gamma_direct" },
      { field: "field_msotdm9w_6el7", op: "eq", value: "option_2" },
    ]);
    expect(b.sentence()).toBe(`Matches when ${CARRIER_SIMPLE} is "Gamma Direct" and ${CARRIER_IMAGE} is "Option 2".`);
    expectTsParity(b, REVIEWER_FIELDS);
  });

  it('"+ or" names the or_group AT CLICK TIME (the cluster\'s rows + the new row), then switching EITHER row keeps "or"', () => {
    for (const which of [0, 1]) {
      const b = mountOwner(bootBuilder(), "", { fields: REVIEWER_FIELDS });
      b.button("+ Add condition").fire("click");
      pickField(b.rows()[0]!, "r2fix_carrier");
      pickAnswer(b.rows()[0]!, "Beta Mutual");
      b.button("+ or").fire("click");
      const atClick = b.groups();
      expect(atClick).toHaveLength(2);
      expect(atClick[0]!["or_group"], "named at click time").toMatch(/^[A-Za-z0-9_-]{1,32}$/);
      expect(atClick[1]!["or_group"]).toBe(atClick[0]!["or_group"]);
      pickField(b.rows()[which]!, "field_msotdm9w_6el7");
      pickAnswer(b.rows()[which]!, "Option 1");
      if (which === 1) pickAnswer(b.rows()[0]!, "Beta Mutual");
      else pickAnswer(b.rows()[1]!, "Acme Insurance");
      expect(b.separators(), `switched row ${which}`).toEqual(["or"]);
      expect(b.clusters()).toHaveLength(1);
      const groups = b.groups();
      expect(groups).toHaveLength(2);
      expect(groups[0]!["or_group"]).toBeTruthy();
      expect(groups[1]!["or_group"]).toBe(groups[0]!["or_group"]);
      expect(new Set(groups.map((g) => g["field"]))).toEqual(new Set(["r2fix_carrier", "field_msotdm9w_6el7"]));
      expect(b.sentence()).toMatch(/^Matches when \(.+ or .+\)\.$/);
      expectTsParity(b, REVIEWER_FIELDS);
      const saved = cond(JSON.parse(b.out.value));
      expect(conditionsMatch(saved, { field_msotdm9w_6el7: "option_1" })).toBe(true);
      expect(conditionsMatch(saved, { r2fix_carrier: which === 1 ? "beta_mutual" : "acme_insurance" })).toBe(true);
      expect(conditionsMatch(saved, { r2fix_carrier: "gamma_direct", field_msotdm9w_6el7: "option_2" })).toBe(false);
    }
  });

  // Fix round 2 (m2) REPLACES this round-1 expectation ("legacy … switching
  // one row's question reads and saves AND"): what the editor SHOWS as "or"
  // stays "or" — a saved rule's same-question cluster is named when opened.
  it("fix round 2 (m2): legacy JSON with two answers to ONE question (no or_group) — mount → switch one row's question → still 'or', one shared or_group", () => {
    const b = mountOwner(bootBuilder(), JSON.stringify({ groups: [BD_HAVENT, { field: "business_duration", op: "eq", value: "under_1_year" }] }));
    expect(b.separators()).toEqual(["or"]);
    pickField(b.rows()[1]!, "credit_score");
    pickAnswer(b.rows()[1]!, "Unsure / Below 550");
    expect(b.separators(), "the word the editor showed stays").toEqual(["or"]);
    expect(b.clusters()).toHaveLength(1);
    const groups = b.groups();
    expect(groups.map((g) => [g["field"], g["op"], g["value"]])).toEqual([
      ["business_duration", "eq", "havent_started"],
      ["credit_score", "eq", "below_550"],
    ]);
    expect(groups[0]!["or_group"]).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(groups[1]!["or_group"]).toBe(groups[0]!["or_group"]);
    expect(b.sentence()).toBe(OWNER_SENTENCE);
    expectTsParity(b, OWNER_FIELDS);
  });

  it("the owner's journey still saves OR (one shared or_group) and reads (… or …)", () => {
    const b = mountOwner(bootBuilder());
    b.button("+ Add condition").fire("click");
    pickField(b.rows()[0]!, "business_duration");
    pickAnswer(b.rows()[0]!, "Haven't started yet");
    b.button("+ or").fire("click");
    pickField(b.rows()[1]!, "credit_score");
    pickAnswer(b.rows()[1]!, "Unsure / Below 550");
    expect(b.separators()).toEqual(["or"]);
    const groups = b.groups();
    expect(groups[0]!["or_group"]).toBeTruthy();
    expect(groups[1]!["or_group"]).toBe(groups[0]!["or_group"]);
    expect(b.sentence()).toBe(OWNER_SENTENCE);
    expectTsParity(b, OWNER_FIELDS);
  });

  // Fix round 2 (m1) REPLACES the round-1 third step (it started on State, a
  // visitor fact with an empty value): when every question is used, the new
  // row starts on the first question.
  it('"+ Add condition" starts on the first question not used yet; when every one is used, on the first question (never State)', () => {
    const b = mountOwner(bootBuilder());
    const fieldOf = (i: number): string => shownField(b.rows()[i]!);
    b.button("+ Add condition").fire("click");
    expect(fieldOf(0)).toBe("business_duration");
    b.button("+ Add condition").fire("click");
    expect(b.rows().map((_, i) => fieldOf(i))).toEqual(["business_duration", "credit_score"]);
    expect(b.separators()).toEqual(["and"]);
    b.button("+ Add condition").fire("click");
    expect(b.rows()).toHaveLength(3);
    expect(b.rows().map((_, i) => fieldOf(i)).filter((f) => f === "business_duration")).toHaveLength(2);
    expect(b.rows().map((_, i) => fieldOf(i))).not.toContain("state");
    expect(b.groups().some((g) => g["field"] === "state")).toBe(false);
  });

  it("MINOR-3: the State row's hint is a block of its own, before the row's remove button (never inline against it)", () => {
    const b = mountOwner(bootBuilder(), JSON.stringify({ groups: [STATE_CA] }));
    const row = b.rows()[0]!;
    const hint = row.byClass("lg-rb-hint")[0]!;
    expect(hint.textContent).toBe("two-letter code, e.g. CA");
    expect(hint.tagName).toBe("DIV");
    const remove = row.children.find((n) => n.getAttribute("aria-label") === "Remove condition")!;
    expect(row.children.indexOf(remove)).toBeGreaterThan(row.children.indexOf(hint.parentNode!));
  });
});

// ===========================================================================
// 4 — TS ↔ island parity on the new shapes
// ===========================================================================

const PARITY_SHAPES: unknown[] = [
  OWNER_CONDITIONS,
  { groups: [{ ...BD_HAVENT, or_group: "g1" }, STATE_CA, { ...CS_BELOW, or_group: "g1" }] },
  { groups: [STATE_CA, { ...BD_HAVENT, or_group: "a" }, { field: "state", op: "eq", value: "TX" }, { ...CS_BELOW, or_group: "a" }] },
  { groups: [{ field: "state", op: "in", values: ["CA", "TX"], or_group: "x" }, { field: "age", op: "range", from: 25, to: 64, or_group: "x" }, { field: "age", op: "gt", value: 70 }] },
  { groups: [{ ...STATE_CA, or_group: "solo" }, { field: "state", op: "eq", value: "TX" }] },
  { groups: [BD_HAVENT, CS_BELOW] },
];

describe("Rules builder — TS and island agree on or groups (parse, serialize, sentence)", () => {
  it("parse + serialize are identical on both sides and evaluate like the stored rule", () => {
    const api = bootBuilder();
    for (const shape of PARITY_SHAPES) {
      const ts = parseStoredConditions(shape);
      const island = api.parseConditions(JSON.stringify(shape));
      expect(ts.ok, JSON.stringify(shape)).toBe(true);
      expect(island.ok, JSON.stringify(shape)).toBe(true);
      const tsJson = serializeRows(ts.ok ? ts.rows : []);
      expect(api.serializeRows(island.rows ?? []), JSON.stringify(shape)).toBe(tsJson);
      const contexts = [
        {},
        { business_duration: "havent_started" },
        { credit_score: "below_550", state: "CA" },
        { state: "TX" },
        { state: "CA", age: 30 },
        { age: 80 },
        { state: "TX", age: 71, credit_score: "below_550" },
      ];
      for (const ctx of contexts) {
        expect(conditionsMatch(cond(JSON.parse(tsJson)), ctx), `${JSON.stringify(shape)} @ ${JSON.stringify(ctx)}`).toBe(conditionsMatch(cond(shape), ctx));
      }
    }
  });

  it("sentences are identical on both sides", () => {
    const api = bootBuilder();
    const labelOf = (f: string): string => OWNER_FIELDS.find((x) => x.internal_field === f)?.label ?? f;
    const tsValueOf = (f: string, v: unknown): string => ruleValueText(OWNER_FIELDS.find((x) => x.internal_field === f) as never, v as never);
    const islandValueOf = api.makeValueOf(OWNER_FIELDS);
    const expected: Record<number, string> = {
      0: OWNER_SENTENCE,
      1: 'Matches when (Business duration is "Haven\'t started yet" or Credit Score is "Unsure / Below 550") and State is "CA".',
      2: 'Matches when (State is "CA" or State is "TX") and (Business duration is "Haven\'t started yet" or Credit Score is "Unsure / Below 550").',
      5: 'Matches when Business duration is "Haven\'t started yet" and Credit Score is "Unsure / Below 550".',
    };
    PARITY_SHAPES.forEach((shape, i) => {
      const ts = parseStoredConditions(shape);
      const rows = (ts.ok ? ts.rows : []) as RulesBuilderRow[];
      const tsSentence = conditionsSentence(rows, labelOf, tsValueOf);
      const island = api.parseConditions(JSON.stringify(shape));
      expect(api.cardSentence(island.rows ?? [], labelOf, islandValueOf, "and"), JSON.stringify(shape)).toBe(tsSentence);
      if (expected[i] !== undefined) expect(tsSentence).toBe(expected[i]);
    });
  });

  it("SSR builder card renders one cluster per or group with 'or' inside it", () => {
    const html = renderRulesBuilderPanel({ rules: [{ rule_type: "eligibility", conditions_json: OWNER_CONDITIONS }], fields: OWNER_FIELDS as never, offers: [] });
    expect(html.match(/data-lg-rb-cluster /g) ?? []).toHaveLength(1);
    expect(html.match(/data-lg-rb-orsep>or</g) ?? []).toHaveLength(1);
    expect(html).not.toContain("data-lg-rb-andsep");
    expect(html).toContain("Matches when (Business duration is &quot;Haven&#39;t started yet&quot; or Credit Score is &quot;Unsure / Below 550&quot;).");
  });

  it("an unreadable or_group sends the card to the preserved advanced view (never silently dropped)", () => {
    const bad = { groups: [{ ...BD_HAVENT, or_group: "has space" }, { ...CS_BELOW, or_group: "has space" }] };
    expect(parseStoredConditions(bad).ok).toBe(false);
    expect(bootBuilder().parseConditions(JSON.stringify(bad)).ok).toBe(false);
  });
});

// ===========================================================================
// 5 — Routing rules (Quotes → Funnel builder → Routing rules) + funnel rules
// ===========================================================================

interface RoutingFixture {
  sdb: SqliteDb;
  env: Env;
  quote: { id: number; public_id: string };
  longFunnel: { id: number; public_id: string };
}

function seedRouting(): RoutingFixture {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  const env = buildEnv(d1FromSqlite(sdb));
  const qPublic = mintPublicId("quote");
  sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status) VALUES (?, 'Loans', 'quote_funnel', '[\"life\"]', 'active')").run(qPublic);
  const quoteId = (sdb.prepare("SELECT id FROM leadgen_quotes WHERE public_id = ?").get(qPublic) as { id: number }).id;
  const funnel = (name: string, order: number): { id: number; public_id: string } => {
    const pub = mintPublicId("funnel");
    sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status, display_order) VALUES (?, ?, ?, 'active', ?)").run(pub, quoteId, name, order);
    const id = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(pub) as { id: number }).id;
    sdb
      .prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status, content_version) VALUES (?, ?, 'A', 10000, 'default', 'active', 1)")
      .run(mintPublicId("funnel_variant"), id);
    return { id, public_id: pub };
  };
  const main = funnel("Main", 1);
  const longFunnel = funnel("Long", 2);
  sdb.prepare("UPDATE leadgen_quotes SET default_funnel_id = ? WHERE id = ?").run(main.id, quoteId);
  return { sdb, env, quote: { id: quoteId, public_id: qPublic }, longFunnel };
}

const UTM_FB = { field: "utm_source", op: "eq", value: "fb" } as const;
const ROUTING_OR = { groups: [{ ...UTM_FB, or_group: "g1" }, { ...STATE_CA, or_group: "g1" }] };
const ENTRY: EntryKnownContext = { hour: 12, weekday: 3 };

describeDb("Routing rules — an or group saves and routes the same way", () => {
  it("UTM Source is fb OR State is CA → either one routes to the target funnel; neither does not", async () => {
    const f = seedRouting();
    const res = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, {
      rule_name: "fb or CA",
      conditions_json: ROUTING_OR,
      target_funnel_id: f.longFunnel.public_id,
    });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(res.json["conditions_json"]).toEqual(ROUTING_OR);
    const rules = await loadQuoteRoutingRules(f.env.DB, f.quote.id);
    expect(evaluateQuoteEntryRouting(rules, { ...ENTRY, utm_source: "fb", state: "TX" })).not.toBeNull();
    expect(evaluateQuoteEntryRouting(rules, { ...ENTRY, utm_source: "google", state: "CA" })).not.toBeNull();
    expect(evaluateQuoteEntryRouting(rules, { ...ENTRY, utm_source: "google", state: "TX" })).toBeNull();
  });

  it("refuses a malformed or_group and Share of traffic inside an or group", async () => {
    const f = seedRouting();
    const post = (groups: unknown[]) => adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, { rule_name: "x", conditions_json: { groups }, feed_name: "x" });
    const bad = await post([{ ...UTM_FB, or_group: "no spaces allowed" }, { ...STATE_CA, or_group: "no spaces allowed" }]);
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.json)).toContain("or_group");
    const share = await post([{ field: "traffic_share", op: "eq", value: 10, or_group: "g1" }, { ...UTM_FB, or_group: "g1" }]);
    expect(share.status).toBe(400);
    expect(JSON.stringify(share.json)).toContain("Share of traffic");
  });
});

describeDb("Funnel rules (Auction tab → funnel eligibility) — an or group saves and evaluates the same way", () => {
  it("validateFunnelRule keeps / refuses the key; an eligibility rule with an or group lets EITHER answer through the real dry-run", async () => {
    expect(validateFunnelRule({ rule_type: "eligibility", conditions_json: OWNER_CONDITIONS }, []).ok).toBe(true);
    const bad = validateFunnelRule({ rule_type: "eligibility", conditions_json: { groups: [{ ...BD_HAVENT, or_group: 3 }] } }, []);
    expect(bad.ok).toBe(false);
    const share = validateFunnelRule({ rule_type: "eligibility", conditions_json: { groups: [{ field: "traffic_share", op: "eq", value: 10, or_group: "g" }, { ...CS_BELOW, or_group: "g" }] } }, []);
    expect(share.ok).toBe(false);

    const { sdb, env, auction } = auctionHarness();
    sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, 'SMB Loans', 'quote_funnel', '[\"life\"]')").run(mintPublicId("quote"));
    const quoteId = (sdb.prepare("SELECT id FROM leadgen_quotes ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES (?, ?, 'Business Loans')").run(mintPublicId("funnel"), quoteId);
    const funnelId = (sdb.prepare("SELECT id FROM leadgen_funnels ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
    const variantPub = mintPublicId("funnel_variant");
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, auction_id) VALUES (?, ?, ?)").run(variantPub, funnelId, auction.id);
    const created = await adminReq(env, "POST", `/variants/${variantPub}/rules`, { rule_type: "eligibility", conditions_json: OWNER_CONDITIONS, priority: 1 });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const stored = sdb.prepare("SELECT conditions_json FROM leadgen_funnel_rules WHERE public_id = ?").get(created.json["public_id"]) as { conditions_json: string };
    expect(JSON.parse(stored.conditions_json)).toEqual(OWNER_CONDITIONS);
    expect((await simulate(env, auction.public_id, { business_duration: "havent_started" })).status).toBe("ok");
    expect((await simulate(env, auction.public_id, { credit_score: "below_550" })).status).toBe("ok");
    expect(await simulate(env, auction.public_id, { business_duration: "under_1_year", credit_score: "700_plus" })).toMatchObject({ status: "disqualified", unfilled_reason: "not_eligible" });
  });
});

// --- the routing rail (cards + modal) ----------------------------------------

const RAIL_FUNNELS = [
  { id: 1, public_id: "lgf_main", name: "Main", is_default: true, pages: [{ position: 0, fields: ["a1"] }] },
  { id: 2, public_id: "lgf_long", name: "Long", is_default: false, pages: [{ position: 0, fields: ["b1"] }] },
];
function railRule(conditions: unknown, matchMode: "all" | "any" = "all"): QuoteRulesRailRule {
  return {
    public_id: "lgqr_or",
    rule_name: "Or rule",
    priority: 1,
    status: "active",
    match_mode: matchMode,
    conditions_json: conditions as QuoteRulesRailRule["conditions_json"],
    target_funnel_id: 2,
    feed_name: null,
    value_multiplier: null,
    redirect_pct: null,
    target_offer_id: null,
    redirect_url: null,
    redirect_url_allowlisted: false,
  };
}
function railData(rules: QuoteRulesRailRule[]): QuoteRulesRailData {
  return { quote_public_id: "lgq_or", rules, funnels: RAIL_FUNNELS, default_funnel_id: 1, shared_page_fields: [], answer_fields: [], offers: [], feed_values: [] };
}

const RAIL_BLOB_RE = /<script id="lg-qr-data" type="application\/json">([^]*?)<\/script>/;
function bootRail(data: QuoteRulesRailData): { root: FakeNode; modal: FakeNode; mount: FakeNode; sentence: () => string; matchItem: (m: string) => FakeNode } {
  const blob = (renderQuoteRulesRail(data).match(RAIL_BLOB_RE) ?? [])[1] ?? "";
  const n = (tag: string, attrs: Record<string, string> = {}, cls = ""): FakeNode => new FakeNode(tag, attrs, cls);
  const root = n("div", { id: "lg-qr-rail" });
  const list = root.appendChild(n("div", { id: "lg-qr-list" }));
  const railErr = list.appendChild(n("p", { "data-qr-rail-error": "", role: "alert" }));
  railErr.hidden = true;
  list.appendChild(n("div", { "data-qr-cards": "" }));
  const modal = root.appendChild(n("div", { id: "lg-qr-modal" }));
  modal.appendChild(n("h3", { id: "lg-qr-modal-title" }));
  modal.appendChild(n("input", { "data-qr-modal-name": "" }));
  modal.appendChild(n("input", { "data-qr-modal-priority": "" }));
  const seg = modal.appendChild(n("div", { "data-qr-matchmode": "" }));
  seg.appendChild(n("span", { "data-qr-match": "all" }, "lg-qr-segitem active"));
  seg.appendChild(n("span", { "data-qr-match": "any" }, "lg-qr-segitem"));
  modal.appendChild(n("div", { "data-qr-modal-checkpoint": "" }));
  const mount = modal.appendChild(n("div", { id: "lg-qr-cond-mount" }));
  modal.appendChild(n("input", { "data-qr-cond-out": "" }));
  const action = modal.appendChild(n("div", { "data-qr-action": "target_funnel" }, "lg-qr-arow"));
  action.appendChild(n("span", { "data-qr-action-toggle": "" }, "lg-qr-swi on"));
  action.appendChild(n("select", { "data-qr-target-funnel": "" }));
  const sentence = modal.appendChild(n("span", { "data-qr-sentence": "" }));
  const dataEl = n("script", { id: "lg-qr-data" });
  dataEl.textContent = blob;
  const byId = (id: string): FakeNode | null => (id === "lg-qr-data" ? dataEl : root.attrs["id"] === id ? root : root.querySelector(`#${id}`));
  const ctx = createContext({ window: {}, document: fakeDocument(byId), fetch: () => Promise.reject(new Error("no network")) });
  runInContext(RULES_BUILDER_SCRIPT, ctx);
  runInContext(QUOTE_RULES_SCRIPT, ctx);
  return {
    root,
    modal,
    mount,
    sentence: () => sentence.textContent,
    matchItem: (m: string) => seg.children.find((c) => c.getAttribute("data-qr-match") === m)!,
  };
}
function condChipsOf(container: FakeNode): string[] {
  return container.querySelector("[data-qr-cond-summ]")!.children.map((c) => c.textContent);
}

describe("Routing rules rail — cards, the sentence and the modal read the real logic", () => {
  it("an or group is ONE chip (… or …) on the SSR card and the island card; the modal sentence agrees", () => {
    const rule = railRule({ groups: [...ROUTING_OR.groups, { field: "device", op: "eq", value: "mobile" }] });
    const html = renderQuoteRulesRail(railData([rule]));
    const summ = (html.match(/<div class="lg-qr-summ" data-qr-cond-summ>(.*?)<\/div>/) ?? [])[1] ?? "";
    expect(summ).toBe(
      '<span class="lg-qr-chip">(UTM Source is fb or State is CA)</span><span class="lg-qr-chip join">and</span><span class="lg-qr-chip">Device is mobile</span>',
    );
    const { root, sentence } = bootRail(railData([rule]));
    expect(condChipsOf(root.querySelector("[data-qr-card]")!)).toEqual(["(UTM Source is fb or State is CA)", "and", "Device is mobile"]);
    root.fire("click", { target: root.querySelector("[data-qr-edit]")! });
    expect(sentence()).toBe("When (UTM Source is fb or State is CA) and Device is mobile, → Long.");
  });

  it("pre-existing wording bug: two answers to the SAME question read 'or' (the engine ORs them), not 'and'", () => {
    const rule = railRule({ groups: [STATE_CA, UTM_FB, { field: "state", op: "eq", value: "TX" }] });
    const html = renderQuoteRulesRail(railData([rule]));
    expect(html).toContain('<span class="lg-qr-chip">(State is CA or State is TX)</span><span class="lg-qr-chip join">and</span><span class="lg-qr-chip">UTM Source is fb</span>');
    const { root } = bootRail(railData([rule]));
    expect(condChipsOf(root.querySelector("[data-qr-card]")!)).toEqual(["(State is CA or State is TX)", "and", "UTM Source is fb"]);
  });

  it("pre-existing wording bug: the modal's 'Matches when' follows Match ANY (on open and when switched)", () => {
    const rule = railRule({ groups: [UTM_FB, STATE_CA] }, "any");
    const { root, mount, matchItem, sentence } = bootRail(railData([rule]));
    root.fire("click", { target: root.querySelector("[data-qr-edit]")! });
    const builderSentence = (): string => mount.byClass("lg-rb-sentence")[0]!.textContent;
    expect(builderSentence()).toBe('Matches when UTM Source is "fb" or State is "CA".');
    expect(sentence()).toBe("When UTM Source is fb or State is CA, → Long.");
    root.querySelector("#lg-qr-modal")!.fire("click", { target: matchItem("all") });
    expect(builderSentence()).toBe('Matches when UTM Source is "fb" and State is "CA".');
    expect(mount.byClass("lg-rb-andsep").map((n) => n.textContent)).toEqual(["and"]);
    root.querySelector("#lg-qr-modal")!.fire("click", { target: matchItem("any") });
    expect(builderSentence()).toBe('Matches when UTM Source is "fb" or State is "CA".');
  });
});

// ===========================================================================
// 6 — Fix round 2 (confirmation review minors, base fac0b7a8)
//   m1: "+ Add condition" starts on the first UNUSED question with answer
//       choices; when every question is used, on the first question — never
//       a visitor fact (State) with an empty value.
//   m2: what the editor SHOWS as "or" stays "or": a saved rule's cluster of
//       2+ rows on ONE question (legacy, no or_group) is named when the rule
//       is opened; rows added during the session keep fix (b).
//   o1: the auction simulator's long offer id wraps inside its card (375).
// ===========================================================================

const DEVICE_VISITOR = {
  internal_field: "device",
  label: "Device",
  group: "visitor",
  choices: [
    { value: "mobile", label: "Mobile" },
    { value: "desktop", label: "Desktop" },
  ],
  stored_choices: [
    { label: "Mobile", stored: "mobile" },
    { label: "Desktop", stored: "desktop" },
  ],
};
const BD_UNDER = { field: "business_duration", op: "eq", value: "under_1_year" } as const;
const LEGACY_PAIR = { groups: [BD_HAVENT, BD_UNDER] };

describe('Fix round 2 (m1) — "+ Add condition" default field', () => {
  it("with every question used the default is the first question — never State (the reviewer's page: two carrier questions + State)", () => {
    const b = mountOwner(bootBuilder(), "", { fields: REVIEWER_FIELDS });
    const fields = (): string[] => b.rows().map((r) => shownField(r));
    b.button("+ Add condition").fire("click");
    b.button("+ Add condition").fire("click");
    expect(fields()).toEqual(["r2fix_carrier", "field_msotdm9w_6el7"]);
    b.button("+ Add condition").fire("click");
    expect(fields().filter((f) => f === "r2fix_carrier"), "the third row starts on the first question").toHaveLength(2);
    expect(fields()).not.toContain("state");
    // the untouched default row carries a real answer, never an empty value
    expect(b.groups().map((g) => [g["field"], g["value"]])).toEqual([
      ["r2fix_carrier", "acme_insurance"],
      ["r2fix_carrier", "acme_insurance"],
      ["field_msotdm9w_6el7", "option_1"],
    ]);
    expect(b.groups().some((g) => g["value"] === "")).toBe(false);
  });

  it("with one question unused the default is that question (whatever else the saved rule uses)", () => {
    const usesImageAndState = mountOwner(bootBuilder(), JSON.stringify({ groups: [{ field: "field_msotdm9w_6el7", op: "eq", value: "option_1" }, STATE_CA] }), { fields: REVIEWER_FIELDS });
    usesImageAndState.button("+ Add condition").fire("click");
    expect(usesImageAndState.rows().map((r) => shownField(r))).toEqual(["field_msotdm9w_6el7", "state", "r2fix_carrier"]);
    const usesCarrier = mountOwner(bootBuilder(), JSON.stringify({ groups: [{ field: "r2fix_carrier", op: "eq", value: "gamma_direct" }] }), { fields: REVIEWER_FIELDS });
    usesCarrier.button("+ Add condition").fire("click");
    expect(usesCarrier.rows().map((r) => shownField(r))).toEqual(["r2fix_carrier", "field_msotdm9w_6el7"]);
    expect(usesCarrier.separators()).toEqual(["and"]);
  });

  it("a visitor fact WITH answer choices (Device) is never the default either", () => {
    const fields = [REVIEWER_FIELDS[0]!, DEVICE_VISITOR, REVIEWER_FIELDS[2]!];
    const b = mountOwner(bootBuilder(), "", { fields });
    b.button("+ Add condition").fire("click");
    b.button("+ Add condition").fire("click");
    expect(b.rows().map((r) => shownField(r))).toEqual(["r2fix_carrier", "r2fix_carrier"]);
  });

  it("the routing modal (real rail): its Answer fields are the questions — the second condition starts on the first one, never State / a UTM fact", () => {
    const data = railData([]);
    data.answer_fields = [
      { internal_field: "credit_score", label: "Credit Score", choices: [{ value: "700_plus", label: "700+" }, { value: "below_550", label: "Unsure / Below 550" }] },
    ];
    const { root, mount } = bootRail(data);
    const newBtn = root.appendChild(new FakeNode("div", { "data-qr-new": "" }));
    root.fire("click", { target: newBtn });
    const add = (): void => mount.all().find((x) => x.tagName === "BUTTON" && x.textContent === "+ Add condition")!.fire("click");
    add();
    add();
    expect(mount.byClass("lg-rb-row").map((r) => shownField(r))).toEqual(["credit_score", "credit_score"]);
  });
});

describe("Fix round 2 (m2) — a saved same-question cluster keeps its 'or' when one row's question changes", () => {
  it("mount names the saved cluster: switching EITHER row keeps 'or' and one shared or_group (auction builder)", () => {
    for (const which of [0, 1]) {
      const b = mountOwner(bootBuilder(), JSON.stringify(LEGACY_PAIR));
      expect(b.separators()).toEqual(["or"]);
      pickField(b.rows()[which]!, "credit_score");
      pickAnswer(b.rows()[which]!, "Unsure / Below 550");
      expect(b.separators(), `switched row ${which}`).toEqual(["or"]);
      expect(b.clusters()).toHaveLength(1);
      const groups = b.groups();
      expect(groups).toHaveLength(2);
      expect(groups[0]!["or_group"]).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
      expect(groups[1]!["or_group"]).toBe(groups[0]!["or_group"]);
      // the switched row keeps its place inside the group (authored order)
      expect(b.sentence()).toBe(
        which === 0
          ? 'Matches when (Credit Score is "Unsure / Below 550" or Business duration is "Less than 1 year").'
          : 'Matches when (Business duration is "Haven\'t started yet" or Credit Score is "Unsure / Below 550").',
      );
      expectTsParity(b, OWNER_FIELDS);
      const saved = cond(JSON.parse(b.out.value));
      expect(conditionsMatch(saved, { credit_score: "below_550" })).toBe(true);
      expect(conditionsMatch(saved, { business_duration: which === 0 ? "under_1_year" : "havent_started" })).toBe(true);
      expect(conditionsMatch(saved, { business_duration: which === 0 ? "havent_started" : "under_1_year", credit_score: "700_plus" })).toBe(false);
    }
  });

  it("rows added during the session keep fix (b): a '+ Add condition' row on an already-used question leaves on a question change ('and')", () => {
    const b = mountOwner(bootBuilder(), JSON.stringify({ groups: [CS_BELOW] }));
    b.button("+ Add condition").fire("click"); // business_duration (unused)
    pickAnswer(b.rows()[1]!, "Haven't started yet");
    b.button("+ Add condition").fire("click"); // every question used → the first one
    expect(b.rows().map((r) => shownField(r)).filter((f) => f === "business_duration")).toHaveLength(2);
    expect(b.separators(), "drawn with the used question (legacy: same question = or)").toEqual(["and", "or"]);
    const added = b.rows().filter((r) => shownField(r) === "business_duration")[1]!;
    pickField(added, "state");
    expect(b.separators()).toEqual(["and", "and"]);
    expect(b.groups().every((g) => !("or_group" in g)), "no or group from '+ Add condition'").toBe(true);
  });

  it("an untouched legacy rule re-saved evaluates exactly the same (the evaluator reads the named cluster like the legacy one)", () => {
    const api = bootBuilder();
    const shapes: unknown[] = [
      LEGACY_PAIR,
      { groups: [BD_HAVENT, CS_BELOW, BD_UNDER] },
      { groups: [STATE_CA, BD_HAVENT, { field: "state", op: "eq", value: "TX" }, BD_UNDER, CS_BELOW] },
      { groups: [{ field: "state", op: "neq", value: "CA" }, { field: "state", op: "neq", value: "TX" }] },
    ];
    const contexts = [
      {},
      { business_duration: "havent_started" },
      { business_duration: "under_1_year", credit_score: "below_550" },
      { business_duration: "havent_started", credit_score: "700_plus" },
      { state: "CA", business_duration: "under_1_year", credit_score: "below_550" },
      { state: "TX", business_duration: "havent_started", credit_score: "below_550" },
      { state: "NV", business_duration: "havent_started", credit_score: "below_550" },
    ];
    for (const shape of shapes) {
      const b = mountOwner(api, JSON.stringify(shape));
      const resaved = cond(JSON.parse(b.out.value));
      for (const ctx of contexts) {
        expect(conditionsMatch(resaved, ctx), `${JSON.stringify(shape)} → ${b.out.value} @ ${JSON.stringify(ctx)}`).toBe(conditionsMatch(cond(shape), ctx));
      }
      expect(b.out.value, "the JSON the editor writes on open").toBe(b.handle.serialize());
    }
    // the saved same-question pair carries ONE or_group in the editor from the moment it opens
    const opened = (JSON.parse(mountOwner(api, JSON.stringify(LEGACY_PAIR)).out.value) as { groups: Array<Record<string, unknown>> }).groups;
    expect(opened.map((g) => g["or_group"])).toEqual(["g1", "g1"]);
  });

  it("the routing modal (real rail): a saved State CA / State TX rule, State TX switched to UTM Source → still 'or'", () => {
    const rule = railRule({ groups: [STATE_CA, { field: "state", op: "eq", value: "TX" }] });
    const { root, modal, mount, sentence } = bootRail(railData([rule]));
    root.fire("click", { target: root.querySelector("[data-qr-edit]")! });
    const rows = (): FakeNode[] => mount.byClass("lg-rb-row");
    expect(mount.byClass("lg-rb-orsep").map((n) => n.textContent)).toEqual(["or"]);
    const tx = rows()[1]!;
    pickField(tx, "utm_source");
    const value = rows()[1]!.byClass("lg-rb-value").find((n) => n.tagName === "INPUT")!;
    value.value = "fb";
    value.fire("input");
    modal.fire("input");
    expect(mount.byClass("lg-rb-orsep").map((n) => n.textContent)).toEqual(["or"]);
    expect(mount.byClass("lg-rb-andsep")).toHaveLength(0);
    const out = root.querySelector("[data-qr-cond-out]")!;
    const groups = (JSON.parse(out.value) as { groups: Array<Record<string, unknown>> }).groups;
    expect(groups.map((g) => g["field"])).toEqual(["state", "utm_source"]);
    expect(groups[0]!["or_group"]).toBeTruthy();
    expect(groups[1]!["or_group"]).toBe(groups[0]!["or_group"]);
    expect(sentence()).toBe("When (State is CA or UTM Source is fb), → Long.");
  });
});

describeDb("Fix round 2 (m2) — an untouched legacy auction rule, opened and re-saved through the real API, hides the same offers", () => {
  it("POST legacy → open in the builder → PATCH what it writes → the auction dry-run hides exactly as before", async () => {
    const { sdb, env, auction, offer } = auctionHarness();
    const legacy = { groups: [BD_HAVENT, CS_BELOW, BD_UNDER] };
    const created = await adminReq(env, "POST", `/auctions/${auction.public_id}/rules`, {
      rule_level: "offer",
      action: "exclude",
      target_offer_id: offer.offer_id,
      conditions_json: legacy,
      priority: 50,
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const hidden = (j: SimulateBody): boolean => j.offers_excluded.some((o) => o.offer_id === offer.offer_public_id && o.reason.includes("exclude"));
    const visitors = [
      { business_duration: "havent_started", credit_score: "below_550" },
      { business_duration: "under_1_year", credit_score: "below_550" },
      { business_duration: "havent_started", credit_score: "700_plus" },
      { business_duration: "other", credit_score: "below_550" },
    ];
    const before: boolean[] = [];
    for (const v of visitors) before.push(hidden(await simulate(env, auction.public_id, v)));
    expect(before).toEqual([true, true, false, false]);

    const stored = sdb.prepare("SELECT conditions_json FROM leadgen_auction_rules WHERE public_id = ?").get(created.json["public_id"]) as { conditions_json: string };
    const b = mountOwner(bootBuilder(), stored.conditions_json);
    const patched = await adminReq(env, "PATCH", `/auctions/${auction.public_id}/rules/${String(created.json["public_id"])}`, { conditions_json: JSON.parse(b.out.value) });
    expect(patched.status, JSON.stringify(patched.json)).toBe(200);
    const after: boolean[] = [];
    for (const v of visitors) after.push(hidden(await simulate(env, auction.public_id, v)));
    expect(after).toEqual(before);
  });
});

describeDb("Fix round 2 (o1) — the auction simulator's offer id wraps inside its card", () => {
  it("the served editor page carries the scoped wrap rule for the offer id (the <strong> the simulator puts in .lg-sim-offer-head)", async () => {
    const { env, auction } = auctionHarness();
    const res = await admin.request(`/admin/leadgen/auction/${auction.public_id}/edit`, {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(".lg-sim-offer-head>strong{min-width:0;overflow-wrap:anywhere}");
    expect(html).toContain("var head = makeEl('div', 'lg-sim-offer-head');");
    expect(html).toContain("var title = makeEl('strong');");
  });
});
