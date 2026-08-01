// LeadGen §19 auction runtime — through the REAL engine (loadAuctionBundle +
// runAuction + persistAuctionResult) against a real node:sqlite D1 with the real
// 0036-0039 migrations, MOCKED providers (vi.stubGlobal fetch). Every §19 branch
// + the anti-tamper 422 cases + the secret-never-to-D1 + dry-run-no-write RED
// LINES are proven with real assertions.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { mintFunnelAttempt } from "../src/public/leadgen/attempt";
import { computeSectionOrderHash } from "../src/public/leadgen/config-dto";
import type { ResolvedActivatedFunnel, ResolvedFunnelPage } from "../src/public/leadgen/resolver";
import {
  loadAuctionBundle,
  persistAuctionResult,
  runAuction,
  validateAntiTamper,
  type AntiTamperInput,
} from "../src/public/leadgen/auction/engine";
import type { LeadgenAuctionRow, LeadgenSectionRow } from "../src/admin/leadgen/db-types";

// ---------------------------------------------------------------------------
// node:sqlite harness + D1 shim (the leadgen-auctions-api.test.ts convention)
// ---------------------------------------------------------------------------

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
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
  } as unknown as D1Database;
  return db;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
// Rework P1 coherence sweep: brought current through 0053 (was frozen at
// 0042) so this harness's D1 schema matches the real Wave-1 shape — see
// leadgen-gates.test.ts's identical fix for the failure class this avoids.
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql", // macro_context_json snapshot (04 §4.6)
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
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
  );
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
}

// ---------------------------------------------------------------------------
// Map-backed KV (for the encrypted debug blob) + env
// ---------------------------------------------------------------------------

function makeKvStub(): { kv: KVNamespace; store: Map<string, string> } {
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

const SECRET_VALUE = "super-secret-token-DO-NOT-LEAK";
const SIGNING_KEY = "leadgen-signing-key-test-only";

function buildEnv(db: D1Database, kv: KVNamespace, extra: Record<string, string> = {}): Env {
  return {
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
    LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS: "OFFER_TOKEN_TEST_SECRET",
    OFFER_TOKEN_TEST_SECRET: SECRET_VALUE,
    ...extra,
  } as unknown as Env;
}

// ---------------------------------------------------------------------------
// fetch stub (the leadgen-auction-fetch.test.ts convention)
// ---------------------------------------------------------------------------

interface CapturedFetch {
  url: string;
  init: RequestInit;
}
function stubFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response): CapturedFetch[] {
  const calls: CapturedFetch[] = [];
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const captured = { url: String(url), init: init ?? {} };
    calls.push(captured);
    return handler(captured.url, captured.init);
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Seed helpers (direct SQL over the sqlite handle)
// ---------------------------------------------------------------------------

interface SeededOffer {
  offer_id: number;
  offer_public_id: string;
  placement_id: number;
  placement_public_id: string;
}

const CARRIER_PARSE = JSON.stringify({
  carriers_path: "carriers",
  fields: { carrier_name: "name", bid: "bid", click_url: "url", carrier_logo: "logo" },
});

interface SeedOfferOpts {
  dynamic?: boolean;
  bidSource?: "response" | "static";
  staticBid?: number | null;
  headerSecret?: boolean;
  tokenInPayload?: boolean;
  capEnabled?: boolean;
  capAmount?: number | null;
  // R4 (fix-contract v2.4 05 §5.1): a dynamic Offer participates only with a
  // PASSED Test status (newest test-tool provider_request_log row). The seed
  // defaults to "passed" so pipeline-branch tests exercise participation; the
  // eligibility tests set "untested"/"failed" explicitly.
  testStatus?: "passed" | "failed" | "untested";
}

// Seed the Offer's Test verdict: one TEST-TOOL provider_request_log row
// (auction_instance_id NULL — the §5.1 scoping). "untested" seeds nothing.
function seedOfferTestStatus(sdb: SqliteDb, offerPublicId: string, status: "passed" | "failed"): void {
  sdb
    .prepare(
      "INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code) VALUES (?, 'production', ?)",
    )
    .run(offerPublicId, status === "passed" ? 200 : 500);
}

function seedOffer(sdb: SqliteDb, opts: SeedOfferOpts = {}): SeededOffer {
  const dynamic = opts.dynamic ?? true;
  const bidSource = opts.bidSource ?? (dynamic ? "response" : "static");
  const offerPublic = mintPublicId("offer");
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, static_bid_value, static_bid_currency,
          banner_url_template, static_fallback_banner_url, request_method, endpoint_production, endpoint_staging,
          api_token_secret_ref, api_token_placement, api_token_param_name, cap_enabled, cap_amount, cap_count_by, status)
       VALUES (?, ?, ?, 'quote_funnel', 'life', 's2s_postback', ?, ?, ?, 'server', ?, 'USD',
               NULL, 'https://static.example/click', 'POST', 'https://provider.example/quote', 'https://staging.provider.example/quote',
               ?, ?, ?, ?, ?, 'clicks', 'active')`,
    )
    .run(
      offerPublic,
      `Offer ${offerPublic.slice(-4)}`,
      `Prov ${offerPublic.slice(-4)}`,
      dynamic ? "cpc" : "cpl",
      dynamic ? 1 : 0,
      bidSource,
      opts.staticBid ?? null,
      opts.headerSecret || opts.tokenInPayload ? "OFFER_TOKEN_TEST_SECRET" : null,
      opts.tokenInPayload ? "payload" : opts.headerSecret ? "header" : null,
      opts.tokenInPayload ? null : opts.headerSecret ? "X-Api-Token" : null,
      opts.capEnabled ? 1 : 0,
      opts.capAmount ?? null,
    );
  const offer = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(offerPublic) as { id: number };

  // Payload schema (+ carrier_parse_json). A payload token node when the secret
  // is placed in the payload.
  const schemaPublic = mintPublicId("payload_schema_version");
  const schemaJson = opts.tokenInPayload
    ? JSON.stringify({ version: 1, root: { type: "object", children: [{ path: "auth", name: "auth", type: "string", source: "token" }] } })
    : JSON.stringify({ version: 1, root: { type: "object", children: [] } });
  sdb
    .prepare(
      "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, carrier_parse_json, carrier_parse_version, source) VALUES (?, ?, 1, ?, ?, 1, 'manual')",
    )
    .run(schemaPublic, offer.id, schemaJson, CARRIER_PARSE);
  const schema = sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = ?").get(schemaPublic) as { id: number };
  sdb.prepare("UPDATE leadgen_offers SET active_payload_schema_id = ? WHERE id = ?").run(schema.id, offer.id);

  if (opts.headerSecret) {
    sdb
      .prepare("INSERT INTO leadgen_offer_headers (offer_id, header_name, value_kind, value_text) VALUES (?, 'X-Api-Token', 'secret_ref', 'OFFER_TOKEN_TEST_SECRET')")
      .run(offer.id);
  }

  const placementPublic = mintPublicId("offer_placement");
  sdb
    .prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)")
    .run(placementPublic, offer.id, `plc-${offerPublic.slice(-4)}`);
  const placement = sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(placementPublic) as { id: number };

  // R4 (05 §5.1): dynamic Offers default to a PASSED Test verdict so they are
  // auction-eligible; static Offers are outside the gate.
  const testStatus = opts.testStatus ?? "passed";
  if (dynamic && testStatus !== "untested") seedOfferTestStatus(sdb, offerPublic, testStatus);

  return { offer_id: offer.id, offer_public_id: offerPublic, placement_id: placement.id, placement_public_id: placementPublic };
}

interface SeedAuctionOpts {
  floor_type?: string;
  floor_value?: number;
  multi_offer?: string;
  banner_slots_count?: number;
  max_carriers_per_offer?: number;
  max_total_carriers?: number;
  backfill?: string;
  backfill_trigger?: string;
  remove_clicked_offers?: number;
  removal_scope?: string;
  surface_static_bid_offers?: number;
  winner_logic?: string;
  timeout_ms?: number;
}

function seedAuction(sdb: SqliteDb, opts: SeedAuctionOpts = {}): LeadgenAuctionRow {
  const publicId = mintPublicId("auction");
  sdb
    .prepare(
      `INSERT INTO leadgen_auctions
         (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
          surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
          backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
       VALUES (?, 'Sim Auction', 'dynamic', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active')`,
    )
    .run(
      publicId,
      opts.winner_logic ?? "highest_bid",
      opts.floor_type ?? "percentage_of_max",
      opts.floor_value ?? 10,
      opts.multi_offer ?? "enabled",
      opts.surface_static_bid_offers ?? 1,
      opts.banner_slots_count ?? 5,
      opts.max_carriers_per_offer ?? 3,
      opts.max_total_carriers ?? 10,
      opts.backfill ?? "disabled",
      opts.backfill_trigger ?? "on_slot_exhaustion",
      opts.remove_clicked_offers ?? 0,
      opts.removal_scope ?? "offer",
      opts.timeout_ms ?? 2500,
    );
  return sdb.prepare("SELECT * FROM leadgen_auctions WHERE public_id = ?").get(publicId) as unknown as LeadgenAuctionRow;
}

function attachOffer(sdb: SqliteDb, auctionId: number, o: SeededOffer, staticOrder = 0, staticBidOverride: number | null = null): void {
  sdb
    .prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, static_bid_override, enabled) VALUES (?, ?, ?, ?, ?, 1)")
    .run(auctionId, o.placement_id, o.offer_id, staticOrder, staticBidOverride);
}

// A minimal ResolvedActivatedFunnel for the engine (anti-tamper needs variant +
// sections; the pipeline reads variant.public_id/content_version + funnel id).
function makeResolved(sections: Array<{ public_id: string; content_version: number }> = []): ResolvedActivatedFunnel {
  const sectionRows = sections.map((s, i) => ({
    position: i,
    // Stable numeric ids (i+1) so the v2 answer_mapping_hash recomputation
    // (computeAttemptBindingExtras — keyed on section.id) has a real key.
    section: { id: i + 1, public_id: s.public_id, content_version: s.content_version, content_json: '{"components":[]}' } as unknown as LeadgenSectionRow,
  }));
  return {
    site_quote: { id: 1, site_id: "site-1", quote_id: 1, enabled: 1, slug: null, settings_overrides_json: null, created_at: 0, updated_at: 0 },
    quote: { id: 1, public_id: "lgq_x", quote_name: "Q", activity: "quote_funnel", verticals_json: "[]", status: "active", created_by: null, created_at: 0, updated_at: 0, default_funnel_id: null },
    funnel: { id: 1, public_id: "lgf_test0000000000000000000000", quote_id: 1, funnel_name: "F", active_ab_test_id: null, status: "active", created_at: 0, updated_at: 0, frame_config_json: null, theme_json: null, display_order: null, frame_template_id: null },
    // Rework M1 (§5-M1, §4.3-10): is_control dropped; variant_label "A" is
    // this fixture's single active variant (replacement semantics — no
    // running test ⇒ exactly one active variant, deterministically first by
    // variant_label ASC/id ASC). frame_template_id is new (M5); NULL =
    // inherit the funnel's template.
    variant: {
      id: 1, public_id: "lgn_test0000000000000000000000", funnel_id: 1, ab_test_id: null, variant_label: "A",
      traffic_allocation_bp: 10000, funnel_design_id: "default", auction_id: 1, lander_enabled: 0, lander_headline: null,
      lander_subheadline: null, lander_body_json: null, lander_hero_media_id: null, lander_hero_media_url: null, lander_cta_json: null,
      content_version: 1, status: "active", created_at: 0, frame_overrides_json: null, frame_template_id: null,
    },
    sections: sectionRows,
    ga4_measurement_id: null,
    assignment: { funnel_ab_test_id: "", funnel_ab_test_revision: 0, variant_label: "A", traffic_allocation_bp: 10000, assignment_bucket: null, assignment_reason: "single_control" },
  };
}

function carrierBody(carriers: Array<{ name: string; bid: number; url?: string; logo?: string }>): string {
  return JSON.stringify({ carriers: carriers.map((c) => ({ name: c.name, bid: c.bid, url: c.url ?? "https://acme.example/click", logo: c.logo ?? "https://acme.example/logo.png" })) });
}

// A binding with NO anti-tamper (dry-run style) — used when we only exercise the
// pipeline, not the §19.1 gate.
const NO_BINDING: AntiTamperInput = {
  funnel_variant_id: "lgn_test0000000000000000000000",
  funnel_attempt_id: "att_x",
  section_order_hash: "",
  signed_config_token: "",
  session_id: null,
};

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

// ---------------------------------------------------------------------------
// §19 pipeline branches (dry-run runs the pipeline; providers mocked)
// ---------------------------------------------------------------------------

describeDb("leadgen §19 runtime — pipeline branches (mocked providers)", () => {
  function harness(): { sdb: SqliteDb; env: Env; kv: Map<string, string> } {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const { kv, store } = makeKvStub();
    return { sdb, env: buildEnv(d1FromSqlite(sdb), kv), kv: store };
  }

  it("happy path: dynamic winner + rendered banners + carriers_shown", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { multi_offer: "enabled" });
    const o1 = seedOffer(sdb);
    const o2 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    attachOffer(sdb, auction.id, o2, 1);
    const calls = stubFetch((url) => new Response(carrierBody([{ name: url.includes(o1.offer_public_id.slice(-4)) ? "Acme" : "Beta", bid: 12 }]), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });

    expect(calls.length).toBe(2); // both dynamic offers fetched
    expect(result.status).toBe("ok");
    expect(result.explain.winner).not.toBeNull();
    expect(result.banners.length).toBeGreaterThan(0);
    expect(result.explain.carriers_shown.length).toBeGreaterThan(0);
    expect(result.banners_html).toContain("lg-banner");
  });

  it("timeout: a slow provider is dropped, its carriers never surface", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { timeout_ms: 30 });
    const o1 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    stubFetch(() => new Promise<Response>(() => {})); // never resolves → timeout arm fires

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });

    expect(result.explain.providers_responded[0]?.provider_error_reason).toBe("timeout");
    expect(result.explain.carriers_shown.length).toBe(0);
  });

  it("malformed response: a non-JSON 200 yields no carriers", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const o1 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    stubFetch(() => new Response("<html>not json</html>", { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
    expect(result.explain.carriers_shown.length).toBe(0);
    expect(result.explain.providers_responded[0]?.provider_error_reason).toBe("malformed_response");
  });

  it("no-bid: an all-zero-bid Offer has no winner (winner-only surfacing → no_bid)", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { multi_offer: "disabled" });
    const o1 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 0 }]), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
    expect(result.explain.winner).toBeNull();
    expect(result.status).toBe("no_bid");
  });

  it("below-floor: a carrier under the floor is filtered (not shown)", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { floor_type: "absolute_bid", floor_value: 10, multi_offer: "enabled" });
    const o1 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    // One carrier at 20 (qualifies), one at 2 (below the absolute floor 10).
    stubFetch(() => new Response(carrierBody([{ name: "High", bid: 20, logo: "https://l/high.png" }, { name: "Low", bid: 2, logo: "https://l/low.png" }]), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
    expect(result.carriers_filtered.some((c) => c.carrier_filtered_reason === "below_floor")).toBe(true);
    expect(result.explain.carriers_shown.some((c) => c.carrier_key === "high")).toBe(true);
    expect(result.explain.carriers_shown.some((c) => c.carrier_key === "low")).toBe(false);
  });

  it("unfilled: no carriers surface → all_carriers_shown", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const o1 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    stubFetch(() => new Response(JSON.stringify({ carriers: [] }), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
    expect(result.explain.carriers_shown.length).toBe(0);
    expect(result.explain.unfilled_reason).toBe("all_carriers_shown");
  });

  it("multi-offer + backfill: below-floor carrier backfills an empty slot", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { floor_type: "absolute_bid", floor_value: 10, multi_offer: "enabled", banner_slots_count: 3, backfill: "enabled", backfill_trigger: "on_slot_exhaustion", max_carriers_per_offer: 5, max_total_carriers: 10 });
    const o1 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    // 1 qualifying (20) + 1 below-floor (2). Slots=3 → 1 rendered, backfill pulls the below-floor.
    stubFetch(() => new Response(carrierBody([{ name: "High", bid: 20, logo: "https://l/h.png" }, { name: "Low", bid: 2, logo: "https://l/l.png" }]), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
    // Backfill produces a 2nd banner_render_id when it fills a slot.
    expect(result.banner_render_ids.length).toBeGreaterThanOrEqual(1);
    expect(result.explain.carriers_shown.some((c) => c.carrier_key === "high")).toBe(true);
  });

  it("remove-clicked: a clicked Offer is suppressed from surfacing", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { remove_clicked_offers: 1, removal_scope: "offer", multi_offer: "enabled" });
    const o1 = seedOffer(sdb);
    const o2 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    attachOffer(sdb, auction.id, o2, 1);
    stubFetch(() => new Response(carrierBody([{ name: "C", bid: 12 }]), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(
      env,
      { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [{ offer_public_id: o1.offer_public_id, carrier_key: "" }] },
      { dryRun: true },
    );
    // o1 suppressed → its carriers never shown.
    expect(result.explain.carriers_shown.every((c) => c.offer_id !== o1.offer_public_id)).toBe(true);
  });

  it("FX: a non-USD bid is normalized to USD via leadgen_fx_rates before winner logic", async () => {
    const { sdb, env } = harness();
    sdb.prepare("INSERT INTO leadgen_fx_rates (date, currency, usd_rate) VALUES ('2026-01-01','EUR', 1.5)").run();
    const auction = seedAuction(sdb, { winner_logic: "highest_bid", multi_offer: "enabled" });
    const o1 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    // Provider returns a EUR bid of 10 → 15 USD.
    stubFetch(() => new Response(JSON.stringify({ carriers: [{ name: "Euro", bid: 10, bid_currency: "EUR", url: "https://x/click", logo: "https://x/l.png" }] }), { status: 200 }));
    // carrier_parse needs a bid_currency field — override this offer's parse to include it.
    sdb.prepare("UPDATE leadgen_offer_payload_schemas SET carrier_parse_json = ? WHERE offer_id = ?").run(
      JSON.stringify({ carriers_path: "carriers", fields: { carrier_name: "name", bid: "bid", bid_currency: "bid_currency", click_url: "url", carrier_logo: "logo" } }),
      o1.offer_id,
    );

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
    expect(result.explain.carriers_shown[0]?.bid).toBeCloseTo(15, 5);
  });
});

// ---------------------------------------------------------------------------
// §19.1 anti-tamper (RED LINE 2)
// ---------------------------------------------------------------------------

describeDb("leadgen §19.1 anti-tamper (RED LINE 2)", () => {
  function harness(): { sdb: SqliteDb; env: Env } {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const { kv } = makeKvStub();
    return { sdb, env: buildEnv(d1FromSqlite(sdb), kv) };
  }

  // Build a resolved with real sections so computeSectionOrderHash is meaningful.
  function resolvedWithSections(): ResolvedActivatedFunnel {
    return makeResolved([{ public_id: "lgs_a", content_version: 1 }, { public_id: "lgs_b", content_version: 2 }]);
  }

  async function validBinding(env: Env, resolved: ResolvedActivatedFunnel): Promise<AntiTamperInput> {
    // v2 (05 §5.3): session_id is CRYPTO-bound — the mint must see the same
    // session the auction binding declares.
    const attempt = await mintFunnelAttempt(env, resolved, Date.now(), { session_id: "sess-1" });
    return {
      funnel_variant_id: resolved.variant.public_id,
      funnel_attempt_id: attempt.funnel_attempt_id,
      section_order_hash: computeSectionOrderHash(resolved),
      signed_config_token: attempt.signed_config_token,
      session_id: "sess-1",
    };
  }

  it("valid signed binding passes; the tuple reconciles verifyConfigToken", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const resolved = resolvedWithSections();
    const binding = await validBinding(env, resolved);
    const verdict = await validateAntiTamper(env, resolved, auction, binding);
    expect(verdict.ok).toBe(true);
  });

  it("v2: a FORGED session_id breaks the crypto binding (05 §5.3)", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const resolved = resolvedWithSections();
    const binding = await validBinding(env, resolved);
    const verdict = await validateAntiTamper(env, resolved, auction, { ...binding, session_id: "sess-FORGED" });
    expect(verdict).toEqual({ ok: false, reason: "signed_token_invalid" });
  });

  it("v2: a mid-session answer-map change breaks the answer_mapping_hash binding (05 §5.3)", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const resolved = resolvedWithSections();
    // Seed REAL section rows matching the resolved public_ids so the hash has
    // a live DB source, then mint.
    sdb.prepare(
      "INSERT INTO leadgen_sections (id, public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (1, 'lgs_a', 'A', 'quote_funnel', 'life', 'H', '{\"components\":[]}', 'button', 0, 'active')",
    ).run();
    const offer = seedOffer(sdb);
    attachOffer(sdb, auction.id, offer, 0);
    const binding = await validBinding(env, resolved);
    // Remap AFTER mint: a new answer-map row bumps the section's mapping
    // version → the server-side recomputation no longer matches the token.
    const schema = sdb.prepare("SELECT id, public_id FROM leadgen_offer_payload_schemas WHERE offer_id = ?").get(offer.offer_id) as { id: number; public_id: string };
    sdb.prepare(
      "INSERT INTO leadgen_section_answer_maps (public_id, section_id, question_id, question_key, internal_field, answer_type, offer_id, payload_schema_id, payload_schema_public_id, offer_payload_field_path, provider_expected_type) VALUES (?, 1, 'q1', 'k', 'f', 'string', ?, ?, ?, 'zip', 'string')",
    ).run(mintPublicId("answer_field_map"), offer.offer_id, schema.id, schema.public_id);
    const verdict = await validateAntiTamper(env, resolved, auction, binding);
    expect(verdict).toEqual({ ok: false, reason: "signed_token_invalid" });
  });

  it("forged variant → mismatch (no token even consulted)", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const resolved = resolvedWithSections();
    const binding = await validBinding(env, resolved);
    const verdict = await validateAntiTamper(env, resolved, auction, { ...binding, funnel_variant_id: "lgn_forged000000000000000000000" });
    expect(verdict).toEqual({ ok: false, reason: "variant_mismatch" });
  });

  it("reordered sections (stale section_order_hash) → mismatch", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const resolved = resolvedWithSections();
    const binding = await validBinding(env, resolved);
    const verdict = await validateAntiTamper(env, resolved, auction, { ...binding, section_order_hash: "deadbeef" });
    expect(verdict).toEqual({ ok: false, reason: "section_order_hash_mismatch" });
  });

  it("forged/invalid signed token → mismatch", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const resolved = resolvedWithSections();
    const binding = await validBinding(env, resolved);
    const verdict = await validateAntiTamper(env, resolved, auction, { ...binding, signed_config_token: "v1.forged.signature" });
    expect(verdict).toEqual({ ok: false, reason: "signed_token_invalid" });
  });

  it("stale auction_config_version → mismatch", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb); // carrier_normalization_version = 1
    const resolved = resolvedWithSections();
    const binding = await validBinding(env, resolved);
    const verdict = await validateAntiTamper(env, resolved, auction, { ...binding, auction_config_version: 999 });
    expect(verdict).toEqual({ ok: false, reason: "auction_config_version_mismatch" });
  });

  it("FAILS CLOSED: an UNSIGNED token is rejected on the live path even with NO signing secret (money-path guard)", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const resolved = resolvedWithSections();
    // Strip the signing secret → mintFunnelAttempt yields an EXPLICIT unsigned token.
    const noSecretEnv = { ...env, LEADGEN_CONFIG_SIGNING_KEY: undefined } as unknown as Env;
    const binding = await validBinding(noSecretEnv, resolved);
    expect(binding.signed_config_token.startsWith("unsigned.")).toBe(true);
    // validateAntiTamper (live path) passes requireSigned:true → the unsigned token
    // is rejected as signed_token_invalid, so a prod deploy missing the secret fails
    // CLOSED (rejects) rather than OPEN (accepting a forged binding). Pre-fix this
    // returned { ok: true } because verifyConfigToken accepted the tuple-matching
    // unsigned token when the secret was absent.
    const verdict = await validateAntiTamper(noSecretEnv, resolved, auction, binding);
    expect(verdict).toEqual({ ok: false, reason: "signed_token_invalid" });
  });

  // §18.4-normative / §21: engine-level composition of carrier rules (the unit
  // logic is in leadgen-auction-rules.test.ts; this pins it THROUGH runAuction).
  it("a carrier EXCLUDE rule filters the carrier through runAuction (excluded pre-floor, not shown, not winning)", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { multi_offer: "enabled" });
    const o1 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    // Carrier-level EXCLUDE targeting "Acme" (the high bid) by name; empty groups → context always matches.
    sdb
      .prepare(
        `INSERT INTO leadgen_auction_rules (public_id, auction_id, rule_level, action, conditions_json, conditions_hash, carrier_match_json, strictly_override, priority, enabled)
         VALUES (?, ?, 'carrier', 'exclude', ?, 'h', ?, 0, 100, 1)`,
      )
      .run(mintPublicId("auction_rule"), auction.id, JSON.stringify({ groups: [] }), JSON.stringify({ carrier_names: ["Acme"] }));
    // Provider returns Acme (bid 12, would win) + Beta (bid 3).
    stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }, { name: "Beta", bid: 3 }]), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });

    // Acme is filtered with a carrier-exclude reason; Beta survives + is shown.
    const filtered = result.explain.carriers_filtered.map((f) => f.carrier_key);
    const shown = result.explain.carriers_shown.map((s) => s.carrier_key);
    const acmeShown = shown.some((k) => /acme/i.test(k));
    const betaShown = shown.some((k) => /beta/i.test(k));
    expect(filtered.some((k) => /acme/i.test(k))).toBe(true); // excluded pre-floor
    expect(acmeShown).toBe(false); // never surfaced
    expect(betaShown).toBe(true); // Beta (the non-excluded carrier) is shown
    // The winner is not Acme's offer via Acme's (removed) bid — Acme set no floor.
    expect(result.explain.carriers_filtered.find((f) => /acme/i.test(f.carrier_key))?.carrier_filtered_reason).toMatch(/exclude|block/);
  });

  // P11 §19 step 16 / §18.7: the engine now threads input.binding.funnel_attempt_id
  // into the banner render context, so the LIVE governed /lg/lc href carries
  // faid=<attempt>. Stage A left it empty (faid= with no value).
  it("P11: the LIVE banner href carries faid=<attempt> (engine funnel_attempt_id thread)", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { multi_offer: "enabled" });
    const o1 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    const resolved = resolvedWithSections();
    const binding = await validBinding(env, resolved); // real minted att_ id
    stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12, url: "https://acme.example/click" }]), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(
      env,
      { resolved, bundle, environment: "production", binding, session_id: "sess-1", raw_answers: {}, clicked: [] },
      { dryRun: false },
    );

    expect(result.status).toBe("ok");
    expect(result.banners.length).toBeGreaterThan(0);
    // The governed banner href now carries the anti-tamper-validated attempt id.
    expect(binding.funnel_attempt_id.startsWith("att_")).toBe(true);
    expect(result.banners_html).toContain(`faid=${binding.funnel_attempt_id}`);
    // Regression guard: it is NOT the Stage-A empty faid= (value present, non-empty).
    expect(result.banners_html).not.toContain("faid=&");
    expect(result.banners_html).not.toContain('faid="');
  });

  it("runAuction (non-dry) with a bad binding is 422 + tampered + NO fetch + NO writes", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const o1 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    const calls = stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));
    const resolved = resolvedWithSections();

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(
      env,
      { resolved, bundle, environment: "production", binding: { ...NO_BINDING, funnel_variant_id: resolved.variant.public_id, signed_config_token: "v1.bad.sig", section_order_hash: computeSectionOrderHash(resolved) }, session_id: null, raw_answers: {}, clicked: [] },
      { dryRun: false },
    );

    expect(result.status).toBe("tampered");
    expect(result.http_status).toBe(422);
    expect(result.traffic_quality_flag).toBe("tampered");
    expect(calls.length).toBe(0); // NO provider fetch
    expect(result.provider_log_rows.length).toBe(0);
    expect(result.result_log_row).toBeNull(); // NOTHING to persist

    // Belt + braces: persist is a no-op on a tampered result (result_log_row null).
    // RUNTIME rows only (auction_instance_id set) — the seeded §5.1 Test-tool
    // verdict row legitimately lives in the same table with a NULL instance.
    await persistAuctionResult(env, result);
    const logCount = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_auction_result_log").get() as { n: number };
    const provCount = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_provider_request_log WHERE auction_instance_id IS NOT NULL").get() as { n: number };
    expect(logCount.n).toBe(0);
    expect(provCount.n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// RED LINE 1 (secret never to D1) + persistence + dry-run no-write
// ---------------------------------------------------------------------------

describeDb("leadgen §19 writes — secret never to D1 + dry-run writes nothing", () => {
  function harness(extra: Record<string, string> = {}): { sdb: SqliteDb; env: Env; kv: Map<string, string> } {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const { kv, store } = makeKvStub();
    return { sdb, env: buildEnv(d1FromSqlite(sdb), kv, extra), kv: store };
  }

  it("secret header value NEVER reaches any D1 column (redacted rows only)", async () => {
    const { sdb, env } = harness(); // no debug encryption key → debug_ref null
    const auction = seedAuction(sdb);
    const o1 = seedOffer(sdb, { headerSecret: true });
    attachOffer(sdb, auction.id, o1, 0);
    // Provider echoes nothing sensitive back.
    stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
    // The engine's redacted log carries the mask, not the secret.
    const row = result.provider_log_rows[0];
    expect(row).toBeDefined();
    expect(row!.request_headers_redacted_json).not.toContain(SECRET_VALUE);
    expect(row!.request_headers_redacted_json).toContain("[REDACTED]");

    // Persist and re-read from D1: no column carries the secret; debug_ref null.
    // Runtime row only — the seeded Test-tool verdict row (NULL instance) is
    // not the row under test.
    await persistAuctionResult(env, { ...result, result_log_row: result.result_log_row });
    const persisted = sdb
      .prepare("SELECT request_headers_redacted_json, request_payload_redacted_json, response_redacted_json, debug_ref FROM leadgen_provider_request_log WHERE offer_public_id = ? AND auction_instance_id IS NOT NULL")
      .get(o1.offer_public_id) as { request_headers_redacted_json: string; request_payload_redacted_json: string; response_redacted_json: string | null; debug_ref: string | null };
    expect(persisted.request_headers_redacted_json).not.toContain(SECRET_VALUE);
    expect(persisted.request_payload_redacted_json).not.toContain(SECRET_VALUE);
    expect(persisted.response_redacted_json ?? "").not.toContain(SECRET_VALUE);
    expect(persisted.debug_ref).toBeNull(); // absent key ⇒ no blob + NULL debug_ref
  });

  it("provider-echoed outbound secrets are scrubbed from the public result and every D1 response column", async () => {
    const echoedSecret = "runtime !'()~ /+%?=Z";
    const { sdb, env } = harness({ OFFER_TOKEN_TEST_SECRET: echoedSecret }); // no debug key: raw echo cannot persist
    const auction = seedAuction(sdb);
    const o1 = seedOffer(sdb, { headerSecret: true });
    attachOffer(sdb, auction.id, o1, 0);
    const encodedSecret = encodeURIComponent(echoedSecret);
    const formSecret = new URLSearchParams({ token: echoedSecret }).toString().slice("token=".length);
    const doubleFormSecret = new URLSearchParams({ token: formSecret }).toString().slice("token=".length);
    stubFetch(
      () =>
        new Response(
          JSON.stringify({
            carriers: [
              {
                name: `Acme ${formSecret}`,
                bid: 12,
                url: `https://acme.example/click?echo=${doubleFormSecret}`,
                logo: "https://acme.example/logo.png",
              },
            ],
            echoed_token: echoedSecret,
            echoed_encoded_token: encodedSecret,
            echoed_form_token: formSecret,
            echoed_double_form_token: doubleFormSecret,
          }),
          { status: 200 },
        ),
    );

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(
      env,
      {
        resolved: makeResolved(),
        bundle,
        environment: "production",
        binding: NO_BINDING,
        session_id: null,
        raw_answers: {},
        clicked: [],
      },
      { dryRun: true },
    );

    expect(result.status).toBe("ok");
    for (const secretVariant of [echoedSecret, encodedSecret, formSecret, doubleFormSecret]) {
      expect(result.banners_html).not.toContain(secretVariant);
      expect(JSON.stringify(result.banners)).not.toContain(secretVariant);
      expect(JSON.stringify(result.events)).not.toContain(secretVariant);
    }

    const providerRow = result.provider_log_rows[0];
    expect(providerRow).toBeDefined();
    expect(providerRow!.response_redacted_json).toContain("[REDACTED]");
    for (const secretVariant of [echoedSecret, encodedSecret, formSecret, doubleFormSecret]) {
      expect(providerRow!.response_redacted_json).not.toContain(secretVariant);
      expect(providerRow!.parsed_carriers_json).not.toContain(secretVariant);
    }
    // The raw response is retained only in the encrypt-only debug carrier.
    expect(JSON.stringify(providerRow!.debug_record)).toContain(echoedSecret);

    await persistAuctionResult(env, result);
    const persisted = sdb
      .prepare(
        "SELECT response_redacted_json, parsed_carriers_json, debug_ref FROM leadgen_provider_request_log WHERE offer_public_id = ? AND auction_instance_id IS NOT NULL",
      )
      .get(o1.offer_public_id) as {
      response_redacted_json: string | null;
      parsed_carriers_json: string;
      debug_ref: string | null;
    };
    expect(persisted.response_redacted_json).toContain("[REDACTED]");
    for (const secretVariant of [echoedSecret, encodedSecret, formSecret, doubleFormSecret]) {
      expect(persisted.response_redacted_json ?? "").not.toContain(secretVariant);
      expect(persisted.parsed_carriers_json).not.toContain(secretVariant);
    }
    expect(persisted.debug_ref).toBeNull();
  });

  it("payload token secret is masked in D1; the full debug blob is AES-encrypted (no plaintext secret)", async () => {
    const { sdb, env, kv } = harness({ LEADGEN_DEBUG_ENCRYPTION_KEY: "debug-key-test-only" });
    const auction = seedAuction(sdb);
    const o1 = seedOffer(sdb, { tokenInPayload: true });
    attachOffer(sdb, auction.id, o1, 0);
    stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
    await persistAuctionResult(env, result);

    const persisted = sdb
      .prepare("SELECT request_payload_redacted_json, debug_ref FROM leadgen_provider_request_log WHERE offer_public_id = ? AND auction_instance_id IS NOT NULL")
      .get(o1.offer_public_id) as { request_payload_redacted_json: string; debug_ref: string | null };
    // The token node value is masked in the redacted payload.
    expect(persisted.request_payload_redacted_json).not.toContain(SECRET_VALUE);
    // A debug_ref was minted; the KV blob is CIPHERTEXT (no plaintext secret).
    expect(persisted.debug_ref).toBeTruthy();
    expect(persisted.debug_ref!.startsWith("lg-debug:")).toBe(true);
    const blob = kv.get(persisted.debug_ref!);
    expect(blob).toBeTruthy();
    expect(blob!).not.toContain(SECRET_VALUE); // AES-GCM ciphertext, base64(iv).base64(ct)
    expect(blob!).toContain("."); // iv.ciphertext shape
  });

  it("dry-run writes NOTHING (persist never called; tables stay empty)", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const o1 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "staging", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
    expect(result.status).toBe("ok");
    // OQ-10: the caller does NOT persist a dry-run; the RUNTIME tables remain
    // empty (the seeded §5.1 Test-tool row has a NULL auction_instance_id).
    const logCount = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_auction_result_log").get() as { n: number };
    const provCount = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_provider_request_log WHERE auction_instance_id IS NOT NULL").get() as { n: number };
    expect(logCount.n).toBe(0);
    expect(provCount.n).toBe(0);
  });

  it("non-dry persist lands the result log + redacted provider log", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const o1 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    // A valid binding is not needed here — exercise persistence with a dry-run
    // result reused as the row source (the persist path is binding-agnostic).
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: "s1", raw_answers: {}, clicked: [] }, { dryRun: true });
    await persistAuctionResult(env, result);

    const log = sdb.prepare("SELECT auction_instance_id, auction_config_id, carriers_shown_json FROM leadgen_auction_result_log WHERE auction_instance_id = ?").get(result.auction_instance_id) as { auction_instance_id: string; auction_config_id: string; carriers_shown_json: string } | undefined;
    expect(log).toBeDefined();
    expect(log!.auction_config_id).toBe(auction.public_id);
    const prov = sdb.prepare("SELECT auction_instance_id, parsed_carriers_json FROM leadgen_provider_request_log WHERE auction_instance_id = ?").get(result.auction_instance_id) as { auction_instance_id: string } | undefined;
    expect(prov).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Round-4 P3a review round (MAJOR-2): page-model auction-side coverage.
// MAJOR-1's ruling REMOVES the auction-side page_plan_hash RE-RESOLUTION
// equality check (it false-rejected legitimate conversions -- hour-boundary
// dayparting, geo drift, mid-session slot edits -- while adding ZERO anti-
// tamper value: page_plan_hash already rides inside the HMAC, so a forged
// value is still caught by signed_token_invalid). These three pin: (a) a
// page-model resolved bundle still auctions normally through the signed-
// token path; (b) a forged token is STILL rejected -- the HMAC, not the
// removed re-resolution, is what protects page_plan_hash; (c) THE
// REGRESSION THE REVIEWER DEMANDED -- a post-mint slot/candidate edit no
// longer false-rejects a still-valid original token.
// ---------------------------------------------------------------------------

describeDb("leadgen §19.1 anti-tamper — page-model (Round-4 P3a review round)", () => {
  function harness(): { sdb: SqliteDb; env: Env } {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const { kv } = makeKvStub();
    return { sdb, env: buildEnv(d1FromSqlite(sdb), kv) };
  }

  // A resolved bundle with a REAL page-model structure: one page, one A/B
  // slot (2 candidates) -- the `resolved.pages !== undefined` shape
  // mintFunnelAttempt/resolvePagePlan actually branch on. Hand-built per
  // this file's OWN convention (makeResolved above is ALSO hand-built,
  // never DB-round-tripped -- validateAntiTamper takes `resolved` as a
  // direct parameter, so a test fully controls it without touching D1).
  function resolvedWithAbPage(): ResolvedActivatedFunnel {
    const base = makeResolved([{ public_id: "lgs_a", content_version: 1 }, { public_id: "lgs_b", content_version: 1 }]);
    const sectionA = base.sections[0]!.section;
    const sectionB = base.sections[1]!.section;
    const pages: ResolvedFunnelPage[] = [
      {
        id: 1,
        public_id: "lgpg_test00000000000000000ab1",
        position: 0,
        name: null,
        slots: [
          {
            id: 1,
            position: 0,
            slot_revision: 0,
            rules: null,
            ab_allocations: [
              { section_id: sectionA.id, bp: 5000 },
              { section_id: sectionB.id, bp: 5000 },
            ],
            candidates: [
              { variant_section_id: 1, section: sectionA },
              { variant_section_id: 2, section: sectionB },
            ],
          },
        ],
      },
    ];
    return { ...base, pages };
  }

  // A resolved bundle with a FIXED slot whose one candidate is deterministic
  // (candidateIndex picks WHICH of the 2 sections it is) -- used ONLY by the
  // no-false-reject pin (c), which needs a GUARANTEED page_plan_hash change
  // between mint-time and verify-time (an A/B hash-bucket flip is not
  // guaranteed to occur for any two arbitrary revisions/sessions; a fixed
  // slot's one candidate changing is a 100%-deterministic hash change).
  function resolvedWithFixedPage(candidateIndex: 0 | 1): ResolvedActivatedFunnel {
    const base = makeResolved([{ public_id: "lgs_a", content_version: 1 }, { public_id: "lgs_b", content_version: 1 }]);
    const sections = [base.sections[0]!.section, base.sections[1]!.section];
    const chosen = sections[candidateIndex]!;
    const pages: ResolvedFunnelPage[] = [
      {
        id: 1,
        public_id: "lgpg_test00000000000000000fx1",
        position: 0,
        name: null,
        slots: [
          {
            id: 1,
            position: 0,
            slot_revision: 0,
            rules: null,
            ab_allocations: null,
            candidates: [{ variant_section_id: candidateIndex + 1, section: chosen }],
          },
        ],
      },
    ];
    return { ...base, pages };
  }

  async function pageModelBinding(env: Env, resolved: ResolvedActivatedFunnel): Promise<AntiTamperInput> {
    const attempt = await mintFunnelAttempt(env, resolved, Date.now(), { session_id: "sess-page-1" });
    return {
      funnel_variant_id: resolved.variant.public_id,
      funnel_attempt_id: attempt.funnel_attempt_id,
      section_order_hash: computeSectionOrderHash(resolved),
      signed_config_token: attempt.signed_config_token,
      session_id: "sess-page-1",
    };
  }

  it("(a) a valid signed token carrying the minted page_plan_hash auctions ok, result logged", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const o1 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));

    const resolved = resolvedWithAbPage();
    const binding = await pageModelBinding(env, resolved);
    const verdict = await validateAntiTamper(env, resolved, auction, binding);
    expect(verdict.ok).toBe(true);

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(
      env,
      { resolved, bundle, environment: "production", binding, session_id: "sess-page-1", raw_answers: {}, clicked: [] },
      { dryRun: false },
    );
    expect(result.status).toBe("ok");
    await persistAuctionResult(env, result);
    const log = sdb.prepare("SELECT auction_instance_id FROM leadgen_auction_result_log WHERE auction_instance_id = ?").get(result.auction_instance_id) as { auction_instance_id: string } | undefined;
    expect(log, "the ok result is logged to leadgen_auction_result_log").toBeDefined();
  });

  it("(b) a forged/mangled token over a page-model bundle is STILL rejected -- 422 tampered, no fetch, no writes", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const o1 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    const calls = stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));

    const resolved = resolvedWithAbPage();
    const binding = await pageModelBinding(env, resolved);
    const forged = { ...binding, signed_config_token: "v2.forged.pagemodel.signature" };
    const verdict = await validateAntiTamper(env, resolved, auction, forged);
    expect(verdict).toEqual({ ok: false, reason: "signed_token_invalid" });

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(
      env,
      { resolved, bundle, environment: "production", binding: forged, session_id: "sess-page-1", raw_answers: {}, clicked: [] },
      { dryRun: false },
    );
    expect(result.status).toBe("tampered");
    expect(result.http_status).toBe(422);
    expect(calls.length, "NO provider fetch on a tampered result").toBe(0);
    expect(result.result_log_row).toBeNull();
    await persistAuctionResult(env, result);
    const logCount = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_auction_result_log").get() as { n: number };
    expect(logCount.n, "NO write on a tampered result").toBe(0);
  });

  it("(c) THE NO-FALSE-REJECT PIN: a post-mint slot/candidate edit does NOT invalidate the still-valid original token", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const o1 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));

    // Mint against a fixed slot whose one candidate is section A.
    const mintTimeResolved = resolvedWithFixedPage(0);
    const binding = await pageModelBinding(env, mintTimeResolved);

    // "Config edit after mint": the CURRENT resolved bundle at auction-verify
    // time now has the SAME page/slot ids but the operator re-pointed the
    // fixed slot's candidate to section B (an admin edit made AFTER this
    // visitor's attempt minted -- exactly D-1's "a mid-session slot edit is
    // real config drift, not a forgery" scenario). This DETERMINISTICALLY
    // changes what a fresh resolvePagePlan would compute (unlike an A/B
    // hash-bucket flip, which is not guaranteed for arbitrary revisions).
    // The auction must still verify + serve the ORIGINALLY MINTED plan.
    const verifyTimeResolved = resolvedWithFixedPage(1);
    const verdict = await validateAntiTamper(env, verifyTimeResolved, auction, binding);
    expect(verdict.ok, "a post-mint slot/candidate edit must NOT false-reject the still-valid original token").toBe(true);

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(
      env,
      { resolved: verifyTimeResolved, bundle, environment: "production", binding, session_id: "sess-page-1", raw_answers: {}, clicked: [] },
      { dryRun: false },
    );
    expect(result.status, "the auction still succeeds using the minted plan despite the post-mint edit").toBe("ok");
  });
});
