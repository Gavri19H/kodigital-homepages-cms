// Shared in-process harness for the fix-contract v2.4 · 10 §10.2/§10.3 analytics
// proofs (test/leadgen-analytics-producers.test.ts + test/leadgen-attribution-
// chain.test.ts). It is a straight extraction of the PROVEN node:sqlite + D1-shim
// + seed conventions already used by leadgen-auction-runtime.test.ts and
// leadgen-postback-route.test.ts, unified so BOTH analytics tests drive the REAL
// server surfaces (runAuction / persistAuctionResult / resolveLeadgenClick /
// ingestProviderPostback / POST /lg/track) against real 0036–0040 migrations with
// MOCKED providers and an intercepted Firehose so every emitted record is
// observable. Test-only; imports no product runtime bundle.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { vi } from "vitest";
import type { Env } from "../../src/env";
import { mintPublicId } from "../../src/leadgen/ids";
import type { ResolvedActivatedFunnel } from "../../src/public/leadgen/resolver";
import type { LeadgenAuctionRow, LeadgenSectionRow } from "../../src/admin/leadgen/db-types";
import type { AntiTamperInput } from "../../src/public/leadgen/auction/engine";
import type { LeadgenStreamRecord } from "../../src/analytics/leadgen-events";
import type { LeadgenChClient } from "../../src/leadgen/clickhouse";

// ---------------------------------------------------------------------------
// node:sqlite handle + D1 shim
// ---------------------------------------------------------------------------

export type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
export type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
export type DatabaseSyncCtor = new (path: string) => SqliteDb;

export function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
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

export function d1FromSqlite(sdb: SqliteDb): D1Database {
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
// The api/ root (this file lives at api/test/helpers/).
export const API_ROOT = join(TEST_DIR, "..", "..");

const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
] as const;

export function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  // node:sqlite's DatabaseSync enables foreign-key constraints by default. These
  // analytics proofs seed synthetic runtime rows (e.g. a funnel rule on a
  // resolved-in-memory variant) whose parents are not materialized, so disable FK
  // enforcement for this test-only DB — the proofs assert EVENT EMISSION + the
  // downstream join columns, not referential integrity (which its own suites own).
  const Ctor = DatabaseSync as unknown as new (
    path: string,
    options?: { enableForeignKeyConstraints?: boolean },
  ) => SqliteDb;
  const sdb = new Ctor(":memory:", { enableForeignKeyConstraints: false });
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','one.example.com','life','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','one.example.com','active');",
  );
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(API_ROOT, "migrations", file), "utf8"));
  return sdb;
}

// ---------------------------------------------------------------------------
// KV + Env
// ---------------------------------------------------------------------------

export function makeKvStub(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

export const SECRET_VALUE = "super-secret-token-DO-NOT-LEAK";
export const SIGNING_KEY = "leadgen-signing-key-test-only";
export const POSTBACK_TOKEN = "pb-secret";

export interface BuildEnvOpts {
  // When true, wire AWS creds + the Firehose stream var so emitLeadgenRecords
  // dispatches (and `stubLeadgenFetch` can capture the emitted records).
  firehose?: boolean;
  extra?: Record<string, unknown>;
}

export function buildLeadgenEnv(db: D1Database, kv: KVNamespace, opts: BuildEnvOpts = {}): Env {
  const env: Record<string, unknown> = {
    DB: db,
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.example.com",
    ADMIN_BASE_URL: "https://cms.example.com",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    LEADGEN_CONFIG_SIGNING_KEY: SIGNING_KEY,
    LEADGEN_TEST_SECRET: SECRET_VALUE,
    // provider "testprov" postback token (08 §30.2 per-provider secret).
    LEADGEN_PB_TOKEN_TESTPROV: POSTBACK_TOKEN,
  };
  if (opts.firehose === true) {
    env.AWS_ACCESS_KEY_ID = "k";
    env.AWS_SECRET_ACCESS_KEY = "s";
    env.LEADGEN_EVENTS_FIREHOSE_STREAM = "leadgen-events";
  }
  return { ...env, ...(opts.extra ?? {}) } as unknown as Env;
}

// ---------------------------------------------------------------------------
// Fetch stub: route Firehose → capture, everything else → the provider handler
// ---------------------------------------------------------------------------

export interface CapturedFetch {
  url: string;
  init: RequestInit;
}

export interface FetchStub {
  firehoseRecords: LeadgenStreamRecord[];
  providerCalls: CapturedFetch[];
}

// Install a global fetch stub. Firehose PutRecordBatch calls are decoded into
// `firehoseRecords` (base64 → utf8 → JSON, one record per Firehose record — the
// leadgen-track.test.ts convention). Every other fetch is captured and delegated
// to `providerHandler` (defaults to a bare 200 — enough for fire-and-forget S2S).
export function stubLeadgenFetch(
  providerHandler: (url: string, init: RequestInit) => Response | Promise<Response> = () =>
    new Response("{}", { status: 200 }),
): FetchStub {
  const firehoseRecords: LeadgenStreamRecord[] = [];
  const providerCalls: CapturedFetch[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const rInit = init ?? {};
    if (url.includes("firehose")) {
      const bodyText = input instanceof Request ? await input.clone().text() : String(rInit.body ?? "{}");
      try {
        const body = JSON.parse(bodyText) as { Records?: Array<{ Data: string }> };
        for (const rec of body.Records ?? []) {
          firehoseRecords.push(JSON.parse(Buffer.from(rec.Data, "base64").toString("utf8")) as LeadgenStreamRecord);
        }
      } catch {
        /* a malformed batch body is not the assertion under test */
      }
      return new Response(JSON.stringify({ FailedPutCount: 0, RequestResponses: [] }), { status: 200 });
    }
    providerCalls.push({ url, init: rInit });
    return providerHandler(url, rInit);
  });
  return { firehoseRecords, providerCalls };
}

// A carrier provider body (the leadgen-auction-runtime.test.ts convention).
export function carrierBody(
  carriers: Array<{ name: string; bid: number; url?: string; logo?: string; bid_currency?: string }>,
): string {
  return JSON.stringify({
    carriers: carriers.map((c) => ({
      name: c.name,
      bid: c.bid,
      url: c.url ?? "https://acme.example/click",
      logo: c.logo ?? "https://acme.example/logo.png",
      ...(c.bid_currency !== undefined ? { bid_currency: c.bid_currency } : {}),
    })),
  });
}

// waitUntil capture + settle (the emit rides ctx.waitUntil).
export function ctxCapture(): { ctx: ExecutionContext; promises: Promise<unknown>[] } {
  const promises: Promise<unknown>[] = [];
  return {
    promises,
    ctx: {
      waitUntil(p: Promise<unknown>) {
        promises.push(Promise.resolve(p).catch(() => undefined));
      },
      passThroughOnException() {},
    } as unknown as ExecutionContext,
  };
}

export async function settle(promises: Promise<unknown>[]): Promise<void> {
  await Promise.all(promises.map((p) => p.catch(() => undefined)));
  await Promise.all(promises.map((p) => p.catch(() => undefined)));
}

// ---------------------------------------------------------------------------
// Auction seeds (rich Offer/Auction — the leadgen-auction-runtime.test.ts idiom)
// ---------------------------------------------------------------------------

export interface SeededOffer {
  offer_id: number;
  offer_public_id: string;
  placement_id: number;
  placement_public_id: string;
  // The placement's EXTERNAL id (leadgen_offer_placements.placement_id) — the
  // value the engine stamps as event `placement_id` (04 §4.5 participating placement).
  placement_external_id: string;
}

const CARRIER_PARSE = JSON.stringify({
  carriers_path: "carriers",
  fields: { carrier_name: "name", bid: "bid", click_url: "url", carrier_logo: "logo" },
});

function seedOfferTestStatus(sdb: SqliteDb, offerPublicId: string, status: "passed" | "failed"): void {
  sdb
    .prepare("INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code) VALUES (?, 'production', ?)")
    .run(offerPublicId, status === "passed" ? 200 : 500);
}

export function seedAuctionOffer(sdb: SqliteDb): SeededOffer {
  const offerPublic = mintPublicId("offer");
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, static_bid_value, static_bid_currency,
          banner_url_template, static_fallback_banner_url, request_method, endpoint_production, endpoint_staging,
          api_token_secret_ref, api_token_placement, api_token_param_name, cap_enabled, cap_amount, cap_count_by, status)
       VALUES (?, ?, ?, 'quote_funnel', 'life', 's2s_postback', 'cpc', 1, 'response', 'server', NULL, 'USD',
               NULL, 'https://static.example/click', 'POST', 'https://provider.example/quote', 'https://staging.provider.example/quote',
               NULL, NULL, NULL, 0, NULL, 'clicks', 'active')`,
    )
    .run(offerPublic, `Offer ${offerPublic.slice(-4)}`, `Prov ${offerPublic.slice(-4)}`);
  const offer = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(offerPublic) as { id: number };

  const schemaPublic = mintPublicId("payload_schema_version");
  const schemaJson = JSON.stringify({ version: 1, root: { type: "object", children: [] } });
  sdb
    .prepare(
      "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, carrier_parse_json, carrier_parse_version, source) VALUES (?, ?, 1, ?, ?, 1, 'manual')",
    )
    .run(schemaPublic, offer.id, schemaJson, CARRIER_PARSE);
  const schema = sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = ?").get(schemaPublic) as { id: number };
  sdb.prepare("UPDATE leadgen_offers SET active_payload_schema_id = ? WHERE id = ?").run(schema.id, offer.id);

  const placementPublic = mintPublicId("offer_placement");
  const placementExternal = `plc-${offerPublic.slice(-4)}`;
  sdb
    .prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)")
    .run(placementPublic, offer.id, placementExternal);
  const placement = sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(placementPublic) as { id: number };

  // A dynamic Offer participates only with a PASSED Test verdict (R4 / 05 §5.1).
  seedOfferTestStatus(sdb, offerPublic, "passed");

  return {
    offer_id: offer.id,
    offer_public_id: offerPublic,
    placement_id: placement.id,
    placement_public_id: placementPublic,
    placement_external_id: placementExternal,
  };
}

export interface SeedAuctionOpts {
  floor_type?: string;
  floor_value?: number;
  multi_offer?: string;
  banner_slots_count?: number;
  timeout_ms?: number;
  winner_logic?: string;
}

export function seedAuction(sdb: SqliteDb, opts: SeedAuctionOpts = {}): LeadgenAuctionRow {
  const publicId = mintPublicId("auction");
  sdb
    .prepare(
      `INSERT INTO leadgen_auctions
         (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
          surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
          backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
       VALUES (?, 'Sim Auction', 'dynamic', ?, ?, ?, ?, 1, ?, 3, 10, 'disabled', 'on_slot_exhaustion', 0, 'offer', ?, 1, 'active')`,
    )
    .run(
      publicId,
      opts.winner_logic ?? "highest_bid",
      opts.floor_type ?? "percentage_of_max",
      opts.floor_value ?? 10,
      opts.multi_offer ?? "enabled",
      opts.banner_slots_count ?? 5,
      opts.timeout_ms ?? 2500,
    );
  return sdb.prepare("SELECT * FROM leadgen_auctions WHERE public_id = ?").get(publicId) as unknown as LeadgenAuctionRow;
}

export function attachOffer(sdb: SqliteDb, auctionId: number, o: SeededOffer, staticOrder = 0): void {
  sdb
    .prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, static_bid_override, enabled) VALUES (?, ?, ?, ?, NULL, 1)")
    .run(auctionId, o.placement_id, o.offer_id, staticOrder);
}

// A redirect_direct_offer funnel rule on variant 1 targeting `targetOfferNumericId`
// (empty condition groups ⇒ always matches) — drives redirect_rule_triggered +
// direct_offer_redirect through the engine funnel-rule loop.
export function seedRedirectRule(sdb: SqliteDb, variantId: number, targetOfferNumericId: number): void {
  sdb
    .prepare(
      `INSERT INTO leadgen_funnel_rules
         (public_id, variant_id, rule_type, conditions_json, conditions_hash, target_offer_id, redirect_url, redirect_url_allowlisted, priority, enabled)
       VALUES (?, ?, 'redirect_direct_offer', ?, 'h', ?, 'https://redirect.example/go', 1, 10, 1)`,
    )
    .run(mintPublicId("funnel_rule"), variantId, JSON.stringify({ groups: [] }), targetOfferNumericId);
}

// A minimal ResolvedActivatedFunnel (the leadgen-auction-runtime.test.ts idiom).
export function makeResolved(sections: Array<{ public_id: string; content_version: number }> = []): ResolvedActivatedFunnel {
  const sectionRows = sections.map((s, i) => ({
    position: i,
    section: { id: i + 1, public_id: s.public_id, content_version: s.content_version, content_json: '{"components":[]}' } as unknown as LeadgenSectionRow,
  }));
  return {
    site_quote: { id: 1, site_id: "site-1", quote_id: 1, enabled: 1, slug: null, settings_overrides_json: null, created_at: 0, updated_at: 0 },
    quote: { id: 1, public_id: "lgq_x", quote_name: "Q", activity: "quote_funnel", verticals_json: "[]", status: "active", created_by: null, created_at: 0, updated_at: 0 },
    funnel: { id: 1, public_id: "lgf_test0000000000000000000000", quote_id: 1, funnel_name: "F", active_ab_test_id: null, status: "active", created_at: 0, updated_at: 0 },
    variant: {
      id: 1, public_id: "lgn_test0000000000000000000000", funnel_id: 1, ab_test_id: null, variant_label: "A", is_control: 1,
      traffic_allocation_bp: 10000, funnel_design_id: "default", auction_id: 1, lander_enabled: 0, lander_headline: null,
      lander_subheadline: null, lander_body_json: null, lander_hero_media_id: null, lander_hero_media_url: null, lander_cta_json: null,
      content_version: 1, status: "active", created_at: 0,
    },
    sections: sectionRows,
    ga4_measurement_id: null,
    assignment: { funnel_ab_test_id: "", funnel_ab_test_revision: 0, variant_label: "A", traffic_allocation_bp: 10000, assignment_bucket: null, assignment_reason: "single_control" },
  };
}

// A binding with NO anti-tamper — used with dryRun to exercise the pipeline
// without the §19.1 gate (the leadgen-auction-runtime.test.ts NO_BINDING).
export const NO_BINDING: AntiTamperInput = {
  funnel_variant_id: "lgn_test0000000000000000000000",
  funnel_attempt_id: "att_x",
  section_order_hash: "",
  signed_config_token: "",
  session_id: null,
};

// ---------------------------------------------------------------------------
// Postback seeds (the leadgen-postback-route.test.ts idiom)
// ---------------------------------------------------------------------------

export function seedPostbackOffer(sdb: SqliteDb, publicId: string, offerType: "cpc" | "cpl" | "cpa" | "cpi"): void {
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, banner_url_template,
          cap_enabled, cap_amount, cap_timezone, cap_count_by, status)
       VALUES (?, 'Offer', 'Prov', 'quote_funnel', 'life', 's2s_postback', ?, 0, 'static', 'server', NULL, 0, 100, 'UTC', 'clicks', 'active')`,
    )
    .run(publicId, offerType);
}

// A ClickHouse client that resolves a click's context (matched conversion path).
export function fakeChClient(trafficSource = "facebook"): LeadgenChClient {
  return {
    configured: true,
    async query<T>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes("offer_click")) {
        return { rows: [{ traffic_source: trafficSource, session_id: "sess-1", offer_id: "lgo_x" }] as unknown as T[] };
      }
      if (sql.includes("lg_sessions")) {
        return { rows: [{ fbc: "", fbclid: "fbclid-1" }] as unknown as T[] };
      }
      return { rows: [] };
    },
  } as unknown as LeadgenChClient;
}
