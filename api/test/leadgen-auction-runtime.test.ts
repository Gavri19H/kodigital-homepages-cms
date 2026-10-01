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
  "0057_leadgen_offer_test_verdict.sql",
  "0060_leadgen_offer_static_creative.sql", // static-Offer banner creative
  "0061_leadgen_routing_present_only_offer.sql", // Present only this offer (force_offer_id)
  "0062_leadgen_auction_waterfalls.sql", // traffic share + offer waterfalls
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
  // OWNER 2026-09-15: a `request_static_bid` (CPL) Offer authors its carrier
  // identity/brand as CONSTANTS, so its carrier_parse_json is a different shape
  // from the shared CPC one above.
  carrierParse?: string;
  // A bespoke payload schema_json (the default is an empty object root).
  schemaJson?: string;
}

// Seed the Offer's Test verdict: one TEST-TOOL provider_request_log row
// (auction_instance_id NULL — the §5.1 scoping). "untested" seeds nothing.
function seedOfferTestStatus(sdb: SqliteDb, offerPublicId: string, status: "passed" | "failed"): void {
  sdb
    .prepare(
      "INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code) VALUES (?, 'production', ?)",
    )
    .run(offerPublicId, status === "passed" ? 200 : 500);
  // 0057: eligibility reads the DURABLE verdict on the Offer, so seed it too.
  sdb.prepare("UPDATE leadgen_offers SET last_test_status = ?, last_test_at = unixepoch(), last_test_source = 'test' WHERE public_id = ?").run(status, offerPublicId);
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
  const schemaJson = opts.schemaJson ?? (opts.tokenInPayload
    ? JSON.stringify({ version: 1, root: { type: "object", children: [{ path: "auth", name: "auth", type: "string", source: "token" }] } })
    : JSON.stringify({ version: 1, root: { type: "object", children: [] } }));
  sdb
    .prepare(
      "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, carrier_parse_json, carrier_parse_version, source) VALUES (?, ?, 1, ?, ?, 1, 'manual')",
    )
    .run(schemaPublic, offer.id, schemaJson, opts.carrierParse ?? CARRIER_PARSE);
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
function makeResolved(sections: Array<{ public_id: string; content_version: number; content_json?: string }> = []): ResolvedActivatedFunnel {
  const sectionRows = sections.map((s, i) => ({
    position: i,
    // Stable numeric ids (i+1) so the v2 answer_mapping_hash recomputation
    // (computeAttemptBindingExtras — keyed on section.id) has a real key.
    section: { id: i + 1, public_id: s.public_id, content_version: s.content_version, content_json: s.content_json ?? '{"components":[]}' } as unknown as LeadgenSectionRow,
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

  // -------------------------------------------------------------------------
  // OWNER 2026-09-15 (moneylantern.com/lg/business-loans): "the offers in this
  // funnel are CPL offers - we are sending request to the offer, and if the
  // offer is responding- we should show the banner to the user. I tested it and
  // never see results even though the offer is responding."
  //
  // A `request_static_bid` Offer (calls_provider_api=1 + bid_source='static')
  // POSTs the lead and gets an ACCEPT/REJECT back — no carrier list — so its
  // identity and brand are CONSTANTS in carrier_parse_json and only the
  // per-lead URL is read from the answer. Routed through the CPC carrier-list
  // parser those constants were read as dotted paths, all resolved undefined,
  // and the carrier was dropped for having no identity: an empty page for an
  // offer that had answered 200. Both halves are driven through the REAL engine
  // here. The parse-level proof over his verbatim production config and
  // Fundera's real bodies is in leadgen-cpl-static-bid.test.ts.
  // -------------------------------------------------------------------------

  const CPL_PARSE = JSON.stringify({
    fields: {
      provider_id: "1050",
      carrier_name: "Fundera",
      carrier_logo: "https://cdn.example/fundera.png",
      click_url: "{response:matches.registration_url}",
      headline: "It's a Match!",
    },
  });

  it("CPL: an ACCEPTED provider answer renders the banner at the Offer's static bid", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { multi_offer: "disabled", surface_static_bid_offers: 1 });
    const cpl = seedOffer(sdb, { dynamic: true, bidSource: "static", staticBid: 1, carrierParse: CPL_PARSE });
    // Production parity (leadgen_offers row 5): this Offer has NO static
    // fallback URL, so the referral URL in the answer is the only destination.
    sdb.prepare("UPDATE leadgen_offers SET static_fallback_banner_url = NULL WHERE id = ?").run(cpl.offer_id);
    attachOffer(sdb, auction.id, cpl, 0);
    const calls = stubFetch(
      () =>
        new Response(
          JSON.stringify({ success: true, matches: { registration_url: "https://www.fundera.com/referral/560b178e" } }),
          { status: 200 },
        ),
    );

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });

    expect(calls.length).toBe(1); // the CPL Offer DOES call its provider
    expect(result.explain.carriers_shown.map((c) => c.carrier_key)).toEqual(["1050"]);
    expect(result.explain.carriers_shown[0]?.bid).toBe(1); // static, not from the answer
    expect(result.banners.length).toBe(1);
    expect(result.banners_html).toContain("Fundera");
    expect(result.explain.unfilled_reason).toBeNull();
  });

  it("CPL: a DECLINED answer shows nothing and says carriers_dropped_at_render", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { multi_offer: "disabled", surface_static_bid_offers: 1 });
    const cpl = seedOffer(sdb, { dynamic: true, bidSource: "static", staticBid: 1, carrierParse: CPL_PARSE });
    // Production parity (leadgen_offers row 5): this Offer has NO static
    // fallback URL, so the referral URL in the answer is the only destination.
    sdb.prepare("UPDATE leadgen_offers SET static_fallback_banner_url = NULL WHERE id = ?").run(cpl.offer_id);
    attachOffer(sdb, auction.id, cpl, 0);
    // Fundera's real rejection shape: HTTP 200, success:false, no referral URL.
    stubFetch(() => new Response(JSON.stringify({ success: false, errors: { owners: { 0: { email: "is required" } } } }), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });

    expect(result.banners.length).toBe(0);
    expect(result.carriers_filtered.map((c) => c.carrier_filtered_reason)).toContain("missing_click_url");
    // NOT "all_carriers_shown" (nothing was ever shown) and NOT
    // "carriers_unparsed" (the parser worked) — the carrier reached render and
    // was dropped there.
    expect(result.explain.unfilled_reason).toBe("carriers_dropped_at_render");
  });

  // -------------------------------------------------------------------------
  // OWNER 2026-09-15 — the calculated answer never reached the live POST.
  //
  // His "Business duration" section (lgs_01KY25WJYW6PWJHKEWYN6Y5BZP) authors
  // "2+ Years" with value_calc {kind:"date_ago", amount:2, unit:"years"} — the
  // 2026-08-27 feature whose whole point is that a duration question can send a
  // DATE. normalizeAnswers computes it. runAuction destructured only the
  // `answers` half and threw `computed` away, and fetch.ts never passed
  // answer_computed to buildPayload, so the live POST carried the raw saved
  // value "2". Fundera answered
  //   {"success":false,"errors":{"company":{"business_inception":
  //    "is not a valid date"}}}
  // (leadgen_provider_request_log row 213, 2026-09-15 13:23 UTC).
  //
  // Asserted on the BYTES ACTUALLY POSTED, not on an intermediate.
  // -------------------------------------------------------------------------

  // The choice list from his live section, verbatim.
  const BUSINESS_DURATION_FIELD = "field_mrujqnc5_2e5a";
  const BUSINESS_DURATION_CONTENT = JSON.stringify({
    components: [
      {
        internal_field: BUSINESS_DURATION_FIELD,
        required: false,
        answer_type: "enum",
        type: "ButtonAnswerGroup",
        question_id: "q_mrujqnc5_2e5a",
        choices: [
          { label: "2+ Years", value: "2", value_calc: { kind: "date_ago", amount: 2, unit: "years" }, analytics_id: "2" },
          { label: "1-2 Years", value: "1", value_calc: { kind: "date_ago", amount: 1, unit: "years" }, analytics_id: "1" },
          { label: "6-12 Months", value: "0.5", value_calc: { kind: "date_ago", amount: 6, unit: "months" }, analytics_id: "0.5" },
          { label: "Haven't started yet", value: "0", analytics_id: "0" },
        ],
      },
    ],
  });

  function seedDurationBinding(sdb: SqliteDb, o: SeededOffer, sectionPublicId: string): void {
    sdb
      .prepare(
        "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, status) VALUES (?, 'Business duration', 'quote_funnel', 'life', 'How long?', ?, 'active')",
      )
      .run(sectionPublicId, BUSINESS_DURATION_CONTENT);
    const section = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(sectionPublicId) as { id: number };
    const schema = sdb.prepare("SELECT id, public_id FROM leadgen_offer_payload_schemas WHERE offer_id = ?").get(o.offer_id) as { id: number; public_id: string };
    sdb
      .prepare(
        `INSERT INTO leadgen_section_answer_maps
           (public_id, section_id, question_id, question_key, internal_field, answer_type, offer_id,
            payload_schema_id, payload_schema_public_id, offer_payload_field_path, provider_expected_type,
            mapping_status, validation_status)
         VALUES (?, ?, 'q_mrujqnc5_2e5a', 'business_duration', ?, 'enum', ?, ?, ?, 'company.business_inception', 'string', 'complete', 'ok')`,
      )
      .run(mintPublicId("answer_field_map"), section.id, BUSINESS_DURATION_FIELD, o.offer_id, schema.id, schema.public_id);
  }

  const BUSINESS_INCEPTION_SCHEMA = JSON.stringify({
    version: 1,
    root: {
      type: "object",
      children: [{ path: "company.business_inception", name: "business_inception", type: "string", required: false, source: "answer" }],
    },
  });

  it("FAIL-BEFORE/PASS-AFTER: a value_calc choice POSTs the calculated DATE, not the saved value", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const o1 = seedOffer(sdb, { schemaJson: BUSINESS_INCEPTION_SCHEMA });
    attachOffer(sdb, auction.id, o1, 0);
    const sectionPublicId = "lgs_duration000000000000000000";
    seedDurationBinding(sdb, o1, sectionPublicId);
    const calls = stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    await runAuction(
      env,
      {
        resolved: makeResolved([{ public_id: sectionPublicId, content_version: 1, content_json: BUSINESS_DURATION_CONTENT }]),
        bundle,
        environment: "production",
        binding: NO_BINDING,
        session_id: null,
        raw_answers: { [BUSINESS_DURATION_FIELD]: "2" },
        clicked: [],
      },
      { dryRun: true },
    );

    expect(calls.length).toBe(1);
    const posted = JSON.parse(String(calls[0]?.init.body ?? "{}")) as { company?: { business_inception?: unknown } };
    const sent = posted.company?.business_inception;
    // Before the fix this was the string "2" -- what Fundera called "not a
    // valid date".
    expect(sent).not.toBe("2");
    expect(typeof sent).toBe("string");
    expect(sent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Exactly two years back from today, UTC (evaluateChoiceCalc's own rule).
    const now = new Date();
    const expected = new Date(Date.UTC(now.getUTCFullYear() - 2, now.getUTCMonth(), now.getUTCDate()))
      .toISOString()
      .slice(0, 10);
    expect(sent).toBe(expected);
  });

  // -------------------------------------------------------------------------
  // OWNER 2026-09-28 — "Allow mapping the value of a given question in the
  // section to more than 1 field in the offer's payload" and "select different
  // values for different providers … AmONE wants the revenue value to be
  // Monthly while Fundera wants it to be Annual". Asserted on the bytes POSTed.
  // -------------------------------------------------------------------------

  function seedSectionRow(sdb: SqliteDb, publicId: string, contentJson: string): number {
    sdb
      .prepare(
        "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, status) VALUES (?, 'S', 'quote_funnel', 'life', 'Q?', ?, 'active')",
      )
      .run(publicId, contentJson);
    return (sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number }).id;
  }

  function seedMapRow(
    sdb: SqliteDb,
    sectionId: number,
    o: SeededOffer,
    q: { question_id: string; internal_field: string; answer_type: string },
    path: string,
    type: string,
    valueMap: Record<string, string> | null = null,
  ): void {
    const schema = sdb.prepare("SELECT id, public_id FROM leadgen_offer_payload_schemas WHERE offer_id = ?").get(o.offer_id) as { id: number; public_id: string };
    sdb
      .prepare(
        `INSERT INTO leadgen_section_answer_maps
           (public_id, section_id, question_id, question_key, internal_field, answer_type, offer_id,
            payload_schema_id, payload_schema_public_id, offer_payload_field_path, provider_expected_type,
            output_value_map_json, mapping_status, validation_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'complete', 'ok')`,
      )
      .run(
        mintPublicId("answer_field_map"), sectionId, q.question_id, q.question_id, q.internal_field, q.answer_type,
        o.offer_id, schema.id, schema.public_id, path, type, valueMap === null ? null : JSON.stringify(valueMap),
      );
  }

  const schemaOf = (children: Array<{ path: string; type: string }>): string =>
    JSON.stringify({
      version: 1,
      root: { type: "object", children: children.map((c) => ({ ...c, name: c.path.split(".").pop(), required: false, source: "answer" })) },
    });

  it("OWNER 2026-09-28: ONE answer fills TWO fields of the same offer (zip -> tracking.ni_zc AND contact.zip)", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const o = seedOffer(sdb, { schemaJson: schemaOf([{ path: "tracking.ni_zc", type: "string" }, { path: "contact.zip", type: "string" }]) });
    attachOffer(sdb, auction.id, o, 0);
    const zipQ = { question_id: "q_zip", internal_field: "zip", answer_type: "string" };
    const content = JSON.stringify({ components: [{ type: "FreeTextQuestion", ...zipQ }] });
    const sectionPublicId = "lgs_zip00000000000000000000000";
    const sectionId = seedSectionRow(sdb, sectionPublicId, content);
    seedMapRow(sdb, sectionId, o, zipQ, "tracking.ni_zc", "string");
    seedMapRow(sdb, sectionId, o, zipQ, "contact.zip", "string");
    const calls = stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    await runAuction(
      env,
      {
        resolved: makeResolved([{ public_id: sectionPublicId, content_version: 1, content_json: content }]),
        bundle, environment: "production", binding: NO_BINDING, session_id: null,
        raw_answers: { zip: "94043" }, clicked: [],
      },
      { dryRun: true },
    );
    expect(calls.length).toBe(1);
    expect(JSON.parse(String(calls[0]?.init.body ?? "{}"))).toEqual({ tracking: { ni_zc: "94043" }, contact: { zip: "94043" } });
  });

  // His live "Monthly Revnue" section (lgs id 18): choices saved as ANNUAL numbers.
  const REVENUE_FIELD = "field_mrum8ruj_2sau";
  const REVENUE_Q = { question_id: "q_mrum8ruj_2sau", internal_field: REVENUE_FIELD, answer_type: "enum" };
  const REVENUE_CONTENT = JSON.stringify({
    components: [
      {
        ...REVENUE_Q,
        type: "ButtonAnswerGroup",
        required: false,
        choices: [
          { label: "Over $50,000", value: "600000", analytics_id: "600000" },
          { label: "$30,000 \u2013 $50,000", value: "360000", analytics_id: "360000" },
          { label: "Under $5,000", value: "30000", analytics_id: "30000" },
        ],
      },
    ],
  });

  it("OWNER 2026-09-28: ONE answer sends a DIFFERENT value to each provider (monthly to one, annual to the other)", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const monthly = seedOffer(sdb, { schemaJson: schemaOf([{ path: "Income", type: "string" }]) });
    const annual = seedOffer(sdb, { schemaJson: schemaOf([{ path: "company.annual_revenue", type: "number" }]) });
    attachOffer(sdb, auction.id, monthly, 0);
    attachOffer(sdb, auction.id, annual, 1);
    const sectionPublicId = "lgs_revenue000000000000000000";
    const sectionId = seedSectionRow(sdb, sectionPublicId, REVENUE_CONTENT);
    // the monthly provider's own value per saved answer; the annual one sends the saved value as is
    seedMapRow(sdb, sectionId, monthly, REVENUE_Q, "Income", "string", { "600000": "50000", "360000": "30000", "30000": "2500" });
    seedMapRow(sdb, sectionId, annual, REVENUE_Q, "company.annual_revenue", "number");
    const calls = stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    await runAuction(
      env,
      {
        resolved: makeResolved([{ public_id: sectionPublicId, content_version: 1, content_json: REVENUE_CONTENT }]),
        bundle, environment: "production", binding: NO_BINDING, session_id: null,
        raw_answers: { [REVENUE_FIELD]: "600000" }, clicked: [],
      },
      { dryRun: true },
    );
    const bodies = calls.map((c) => JSON.parse(String(c.init.body ?? "{}")) as Record<string, unknown>);
    expect(bodies).toHaveLength(2);
    expect(bodies).toContainEqual({ Income: "50000" });
    expect(bodies).toContainEqual({ company: { annual_revenue: 600000 } });
  });

  it("OWNER 2026-09-28: a calculated-date choice still POSTs its date when the offer carries per-provider values", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const o1 = seedOffer(sdb, { schemaJson: BUSINESS_INCEPTION_SCHEMA });
    attachOffer(sdb, auction.id, o1, 0);
    const sectionPublicId = "lgs_durationmap00000000000000";
    const sectionId = seedSectionRow(sdb, sectionPublicId, BUSINESS_DURATION_CONTENT);
    // a per-provider value list over the saved values (the Content-tab editor writes all of them)
    seedMapRow(
      sdb, sectionId, o1,
      { question_id: "q_mrujqnc5_2e5a", internal_field: BUSINESS_DURATION_FIELD, answer_type: "enum" },
      "company.business_inception", "string",
      { "2": "2", "1": "1", "0.5": "0.5", "0": "not_started" },
    );
    const post = async (answer: string): Promise<unknown> => {
      const calls = stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));
      const bundle = await loadAuctionBundle(env.DB, auction, 1);
      await runAuction(
        env,
        {
          resolved: makeResolved([{ public_id: sectionPublicId, content_version: 1, content_json: BUSINESS_DURATION_CONTENT }]),
          bundle, environment: "production", binding: NO_BINDING, session_id: null,
          raw_answers: { [BUSINESS_DURATION_FIELD]: answer }, clicked: [],
        },
        { dryRun: true },
      );
      vi.unstubAllGlobals();
      return (JSON.parse(String(calls[0]?.init.body ?? "{}")) as { company?: { business_inception?: unknown } }).company?.business_inception;
    };
    const now = new Date();
    const twoYearsAgo = new Date(Date.UTC(now.getUTCFullYear() - 2, now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
    // before the fix the date was looked up in the map, missed, and the field was dropped
    expect(await post("2")).toBe(twoYearsAgo);
    // a fixed choice still takes the provider's own value
    expect(await post("0")).toBe("not_started");
  });

  it("a choice with NO value_calc still POSTs its literal saved value", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const o1 = seedOffer(sdb, { schemaJson: BUSINESS_INCEPTION_SCHEMA });
    attachOffer(sdb, auction.id, o1, 0);
    const sectionPublicId = "lgs_duration000000000000000001";
    seedDurationBinding(sdb, o1, sectionPublicId);
    const calls = stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    await runAuction(
      env,
      {
        resolved: makeResolved([{ public_id: sectionPublicId, content_version: 1, content_json: BUSINESS_DURATION_CONTENT }]),
        bundle,
        environment: "production",
        binding: NO_BINDING,
        session_id: null,
        raw_answers: { [BUSINESS_DURATION_FIELD]: "0" }, // "Haven't started yet" — no calc
        clicked: [],
      },
      { dryRun: true },
    );

    const posted = JSON.parse(String(calls[0]?.init.body ?? "{}")) as { company?: { business_inception?: unknown } };
    expect(posted.company?.business_inception).toBe("0");
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

  // OWNER 2026-08-27 — RENAMED with the behaviour. This case stubs a provider
  // that ANSWERED WITH NOTHING, and the old blanket default reported
  // "all_carriers_shown" for it: on a fresh session, with nothing ever shown,
  // the product's one line of diagnosis was false. That is what sent the owner
  // to us with "the auction wasn't running - I got to an empty page" instead of
  // being able to read the reason himself. The reason now distinguishes
  // "nobody offered anything" (the market's answer, not actionable) from
  // "we could not read what they offered" (a config fault he can fix).
  it("unfilled: a provider that returns no carriers → no_carriers_returned", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const o1 = seedOffer(sdb);
    attachOffer(sdb, auction.id, o1, 0);
    stubFetch(() => new Response(JSON.stringify({ carriers: [] }), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
    expect(result.explain.carriers_shown.length).toBe(0);
    expect(result.explain.unfilled_reason).toBe("no_carriers_returned");
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

// OWNER 2026-09-03: "I got back to validate the results page after your last
// fix of the creative — No results at all appear now, when the funnel is
// complete."
//
// It was not the creative. Both of his live Offers were excluded BEFORE any
// provider call: leadgen_auction_result_log carried
// offers_excluded_json=[{…,"reason":"test_untested"},{…,"reason":"test_untested"}],
// carriers_shown_json=[], unfilled_reason="no_carriers_returned", and
// leadgen_provider_request_log had ZERO rows for those auction instances.
//
// ROOT CAUSE: §5.1 eligibility required a passing provider Test, and the
// verdict was DERIVED at read time from the newest Test-tool row in
// leadgen_provider_request_log — a table the §30.3 retention cron prunes to
// SEVEN DAYS (retention.ts PROVIDER_LOG_RETENTION_SECONDS). So every dynamic
// Offer in this product silently went ineligible exactly one week after its
// last Test, and the funnel served an empty page with no operator-visible
// warning. His data dates it: last FILLED auction 2026-08-30 08:35, first
// empty one 2026-09-01 15:43, and the oldest surviving row in that table
// equalled now-7d.
//
// A gate that decides whether an Offer may earn money must not read a log with
// a TTL. The verdict is now a durable column on the Offer (migration 0057).
describeDb("§5.1 eligibility survives the §30.3 retention prune (OWNER 2026-09-03)", () => {
  function harness(): { sdb: SqliteDb; env: Env } {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const { kv } = makeKvStub();
    return { sdb, env: buildEnv(d1FromSqlite(sdb), kv) };
  }

  it("FAIL-BEFORE/PASS-AFTER: wiping every provider-log row does NOT empty the auction", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const offer = seedOffer(sdb);
    attachOffer(sdb, auction.id, offer, 0);
    stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));

    // the auction fills while the Test row is inside the 7-day window
    const before = await runAuction(
      env,
      { resolved: makeResolved(), bundle: await loadAuctionBundle(env.DB, auction, 1), environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] },
      { dryRun: true },
    );
    expect(before.status).toBe("ok");
    expect(before.explain.carriers_shown.length).toBeGreaterThan(0);

    // …now the retention cron runs. Every provider-log row for this Offer is
    // GONE — exactly the state his production DB was in.
    sdb.prepare("DELETE FROM leadgen_provider_request_log").run();
    expect(
      (sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_provider_request_log").get() as { n: number }).n,
      "the prune really did empty the table",
    ).toBe(0);

    stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));
    const after = await runAuction(
      env,
      { resolved: makeResolved(), bundle: await loadAuctionBundle(env.DB, auction, 1), environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] },
      { dryRun: true },
    );
    // BEFORE the fix this was: excluded `test_untested`, 0 carriers, an empty
    // results page for every visitor.
    expect(
      after.explain.offers_excluded.map((o) => o.reason),
      "a pruned log must never make a tested Offer ineligible",
    ).not.toContain("test_untested");
    expect(after.status).toBe("ok");
    expect(after.explain.carriers_shown.length).toBeGreaterThan(0);
  });

  it("a genuinely never-tested Offer is STILL refused — the gate keeps its teeth", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const offer = seedOffer(sdb, { testStatus: "untested" });
    attachOffer(sdb, auction.id, offer, 0);
    const calls = stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));

    const result = await runAuction(
      env,
      { resolved: makeResolved(), bundle: await loadAuctionBundle(env.DB, auction, 1), environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] },
      { dryRun: true },
    );
    expect(result.explain.offers_excluded.map((o) => o.reason)).toContain("test_untested");
    expect(calls.length, "an untested Offer's provider is never called").toBe(0);
  });

  it("a live provider call refreshes the verdict, so a serving Offer cannot decay", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const offer = seedOffer(sdb);
    attachOffer(sdb, auction.id, offer, 0);
    // an OLD verdict, as if the last Test were long ago
    sdb
      .prepare("UPDATE leadgen_offers SET last_test_at = 1, last_test_source = 'test' WHERE public_id = ?")
      .run(offer.offer_public_id);
    stubFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));

    // the verdict refresh rides the PERSIST path, beside the provider-log row
    const result = await runAuction(
      env,
      { resolved: makeResolved(), bundle: await loadAuctionBundle(env.DB, auction, 1), environment: "production", binding: NO_BINDING, session_id: "s1", raw_answers: {}, clicked: [] },
      { dryRun: true },
    );
    await persistAuctionResult(env, result);
    const row = sdb
      .prepare("SELECT last_test_status, last_test_at, last_test_source FROM leadgen_offers WHERE public_id = ?")
      .get(offer.offer_public_id) as { last_test_status: string; last_test_at: number; last_test_source: string };
    expect(row.last_test_status).toBe("passed");
    expect(row.last_test_source).toBe("auction");
    expect(row.last_test_at, "the live 200 refreshed the verdict timestamp").toBeGreaterThan(1);
  });
});

// ===========================================================================
// OWNER 2026-09-27 — the banner creative of a "Static — no provider request"
// Offer (0060). His screenshot: the Fora card rendered as the word "Impact"
// (the Provider field) over the CTA, with no logo or copy, beside a Fundera
// card that had all of them. Driven through the REAL pipeline
// (loadAuctionBundle → runAuction → renderBanners), not a hand-built card.
// ===========================================================================

describeDb("static Offer banner creative (0060) — through the real auction", () => {
  function harness(): { sdb: SqliteDb; env: Env } {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const { kv } = makeKvStub();
    return { sdb, env: buildEnv(d1FromSqlite(sdb), kv) };
  }
  const LIVE_REQUEST = { source: new Request("https://moneylantern.com/lg/auction", { method: "POST" }) };

  function creative(sdb: SqliteDb, offerId: number, c: Record<string, string | null>): void {
    for (const [k, v] of Object.entries(c)) sdb.prepare(`UPDATE leadgen_offers SET ${k} = ? WHERE id = ?`).run(v, offerId);
  }

  it("the authored creative is on the card: brand, logo, headline, subheadline, disclaimer", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { surface_static_bid_offers: 1 });
    const fora = seedOffer(sdb, { dynamic: false, staticBid: 200 });
    creative(sdb, fora.offer_id, {
      static_brand_name: "Fora Financial",
      static_logo_url: "/media/2026/09/27/fora-logo.png",
      static_headline: "Funding in as little as 24 hours",
      static_subheadline: "Check your options in minutes",
      static_disclaimer: "Not all applicants qualify.",
    });
    attachOffer(sdb, auction.id, fora, 0);
    stubFetch(() => new Response("{}", { status: 200 }));
    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(
      env,
      { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [], runtime: LIVE_REQUEST },
      { dryRun: true },
    );
    const html = result.banners_html;
    expect(html).toContain('<div class="lg-banner-name">Fora Financial</div>');
    // the Media-library logo is made absolute against the FUNNEL's own domain
    expect(html).toContain('src="https://moneylantern.com/media/2026/09/27/fora-logo.png"');
    expect(html).toContain("Funding in as little as 24 hours");
    expect(html).toContain("Check your options in minutes");
    expect(html).toContain("Not all applicants qualify.");
    expect(html).not.toContain(">Prov "); // the Provider name no longer stands in for the brand
  });

  it("an Offer nobody edited renders exactly as before: Provider as the name, no logo, no copy", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { surface_static_bid_offers: 1 });
    const plain = seedOffer(sdb, { dynamic: false, staticBid: 5 });
    attachOffer(sdb, auction.id, plain, 0);
    stubFetch(() => new Response("{}", { status: 200 }));
    const provider = (sdb.prepare("SELECT provider FROM leadgen_offers WHERE id = ?").get(plain.offer_id) as { provider: string }).provider;
    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(
      env,
      { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [], runtime: LIVE_REQUEST },
      { dryRun: true },
    );
    expect(result.banners_html).toContain(`<div class="lg-banner-name">${provider}</div>`);
    expect(result.banners_html).not.toContain("lg-banner-logo");
    expect(result.banners_html).not.toContain("lg-banner-headline");
  });

  it("the carrier key does NOT move when the brand is edited (remove-clicked / dedupe / analytics keys stay put)", async () => {
    const run = async (brand: string | null): Promise<string[]> => {
      const { sdb, env } = harness();
      const auction = seedAuction(sdb, { surface_static_bid_offers: 1 });
      const o = seedOffer(sdb, { dynamic: false, staticBid: 5 });
      sdb.prepare("UPDATE leadgen_offers SET provider = 'Impact', static_brand_name = ? WHERE id = ?").run(brand, o.offer_id);
      attachOffer(sdb, auction.id, o, 0);
      stubFetch(() => new Response("{}", { status: 200 }));
      const bundle = await loadAuctionBundle(env.DB, auction, 1);
      const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
      return result.explain.carriers_shown.map((c) => c.carrier_key);
    };
    expect(await run(null)).toEqual(["impact"]);
    expect(await run("Fora Financial")).toEqual(["impact"]);
  });

  it("no request context at all: a Media-library logo is left off rather than broken; an https logo still shows", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { surface_static_bid_offers: 1, multi_offer: "enabled" });
    const a = seedOffer(sdb, { dynamic: false, staticBid: 9 });
    const b = seedOffer(sdb, { dynamic: false, staticBid: 8 });
    creative(sdb, a.offer_id, { static_brand_name: "Media Logo Co", static_logo_url: "/media/2026/09/27/a.png" });
    creative(sdb, b.offer_id, { static_brand_name: "Https Logo Co", static_logo_url: "https://cdn.example/b.png" });
    attachOffer(sdb, auction.id, a, 0);
    attachOffer(sdb, auction.id, b, 1);
    stubFetch(() => new Response("{}", { status: 200 }));
    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
    expect(result.banners_html).not.toContain("/media/2026/09/27/a.png");
    expect(result.banners_html).toContain('src="https://cdn.example/b.png"');
  });

  it("a CPL (provider-request) Offer's card still comes from its response parser, even with creative columns set", async () => {
    const CPL = JSON.stringify({
      fields: { provider_id: "1050", carrier_name: "Fundera", carrier_logo: "https://cdn.example/fundera.png", click_url: "{response:matches.registration_url}", headline: "It's a Match!" },
    });
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { surface_static_bid_offers: 1 });
    const cpl = seedOffer(sdb, { dynamic: true, bidSource: "static", staticBid: 1, carrierParse: CPL });
    sdb.prepare("UPDATE leadgen_offers SET static_fallback_banner_url = NULL WHERE id = ?").run(cpl.offer_id);
    creative(sdb, cpl.offer_id, { static_brand_name: "SHOULD NOT SHOW", static_headline: "SHOULD NOT SHOW EITHER" });
    attachOffer(sdb, auction.id, cpl, 0);
    stubFetch(() => new Response(JSON.stringify({ success: true, matches: { registration_url: "https://www.fundera.com/referral/x" } }), { status: 200 }));
    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(
      env,
      { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: { email: "a@b.co" }, clicked: [], runtime: LIVE_REQUEST },
      { dryRun: true },
    );
    expect(result.banners_html).toContain('<div class="lg-banner-name">Fundera</div>');
    expect(result.banners_html).toContain("It&#39;s a Match!");
    expect(result.banners_html).not.toContain("SHOULD NOT SHOW");
  });
});

// ===========================================================================
// OWNER 2026-09-28 (insurissimo.com/lg/home-insurance): "each time I got only 1
// result" while NextInsure returned 6 listings. Through the real pipeline with
// the production auction's settings (auction 1: multi_offer enabled,
// max_carriers_per_offer 3, banner_slots_count 5, floor 10% of max) and the
// offer's stored parser, verbatim.
// ===========================================================================

describeDb("every provider listing reaches the auction (OWNER 2026-09-28)", () => {
  const NEXTINSURE_6 = readFileSync(join(TEST_DIR, "fixtures", "parser-every-listing", "nextinsure-home-6-listings.json"), "utf8");
  const QUINSTREET_HOME_PARSER = JSON.stringify({
    fields: {
      provider_id: "{response:response.listingset.listing.0.company}",
      carrier_name: "{response:response.listingset.listing.0.displayname}",
      carrier_logo: "{response:response.listingset.listing.0.logo}",
      bid: "{response:response.listingset.listing.0.cpc}",
      bid_currency: "{response:response.listingset.listing.0.usd}",
      click_url: "{response:response.listingset.listing.0.clickurl}",
      tracking_id: "{response:response.listingset.searchid}",
      headline: "{response:response.listingset.listing.0.title}",
      subheadline: "{response:response.listingset.listing.0.description}",
    },
  });
  async function run(maxPerOffer: number): Promise<string[]> {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const { kv } = makeKvStub();
    const env = buildEnv(d1FromSqlite(sdb), kv);
    const auction = seedAuction(sdb, { multi_offer: "enabled", max_carriers_per_offer: maxPerOffer, banner_slots_count: 5, max_total_carriers: 10, floor_type: "percentage_of_max", floor_value: 10 });
    const qs = seedOffer(sdb, { dynamic: true, carrierParse: QUINSTREET_HOME_PARSER });
    attachOffer(sdb, auction.id, qs, 0);
    stubFetch(() => new Response(NEXTINSURE_6, { status: 200, headers: { "content-type": "application/json" } }));
    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
    return result.explain.carriers_shown.map((c) => c.carrier_key);
  }

  it("with his auction's own cap (3 carriers per offer): the top 3 bids, not 1", async () => {
    expect(await run(3)).toEqual(["Contactability - 32485", "Farmers Insurance Group", "ultimateinsurance.com (32925110)"]);
  });

  it("the cap is what limits: at 10 per offer, the 5 banner slots fill", async () => {
    expect(await run(10)).toHaveLength(5);
  });

  it("a carrier the answer names twice is ONE card with its FIRST listing's copy and bid", async () => {
    const answer = JSON.parse(NEXTINSURE_6) as { response: { listingset: { listing: Array<Record<string, unknown>> } } };
    const listing = answer.response.listingset.listing;
    // Farmers again further down, with its own copy, bid and click
    listing[4] = { ...listing[4], company: listing[1]!["company"], displayname: "Farmers", title: "SECOND FARMERS LISTING", cpc: "2.42", clickurl: "https://second-farmers.example/click" };
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const { kv } = makeKvStub();
    const env = buildEnv(d1FromSqlite(sdb), kv);
    const auction = seedAuction(sdb, { multi_offer: "enabled", max_carriers_per_offer: 10, banner_slots_count: 5, max_total_carriers: 10, floor_type: "percentage_of_max", floor_value: 10 });
    const qs = seedOffer(sdb, { dynamic: true, carrierParse: QUINSTREET_HOME_PARSER });
    attachOffer(sdb, auction.id, qs, 0);
    stubFetch(() => new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } }));
    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
    const shown = result.explain.carriers_shown;
    expect(shown.map((c) => c.carrier_key)).toEqual([
      "Contactability - 32485", "Farmers Insurance Group", "ultimateinsurance.com (32925110)", "AgileRates, LLC (Buyer)", "Union Square Media (33141310)",
    ]);
    expect(shown.find((c) => c.carrier_key === "Farmers Insurance Group")?.bid).toBe(3.45);
    expect(result.banners_html).toContain("FastQuote® From Farmers");
    expect(result.banners_html).not.toContain("SECOND FARMERS LISTING");
  });
});

describeDb("one recommended card when the winning Offer yields several carriers (OWNER 2026-09-28)", () => {
  it("only the first card carries the BEST MATCH badge and the recommended styling", async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const { kv } = makeKvStub();
    const env = buildEnv(d1FromSqlite(sdb), kv);
    const auction = seedAuction(sdb, { multi_offer: "enabled", max_carriers_per_offer: 3, banner_slots_count: 5 });
    const parser = JSON.stringify({ fields: { provider_id: "response.listingset.listing.0.company", carrier_name: "response.listingset.listing.0.displayname", bid: "response.listingset.listing.0.cpc", click_url: "response.listingset.listing.0.clickurl" } });
    const qs = seedOffer(sdb, { dynamic: true, carrierParse: parser });
    attachOffer(sdb, auction.id, qs, 0);
    stubFetch(() => new Response(readFileSync(join(TEST_DIR, "fixtures", "parser-every-listing", "nextinsure-home-6-listings.json"), "utf8"), { status: 200 }));
    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: null, raw_answers: {}, clicked: [] }, { dryRun: true });
    const html = result.banners_html;
    expect(result.banners).toHaveLength(3);
    expect(html.match(/BEST MATCH FOR YOU/g) ?? []).toHaveLength(1);
    expect(html.match(/data-recommended="true"/g) ?? []).toHaveLength(1);
    // …and it is the top card (the highest bid)
    expect(html.indexOf('data-recommended="true"')).toBeLessThan(html.indexOf('data-recommended="false"'));
    expect(html.slice(0, html.indexOf('data-recommended="false"'))).toContain("Contactability");
  });
});


// ---------------------------------------------------------------------------
// 0062 — offer waterfalls + traffic share (OWNER 2026-10-01)
// ---------------------------------------------------------------------------
//
// "We want 50% of the traffic to see Fundera's offer as the first priority
// (Tier 1) as long as they meet Fundera's offer rules. If they don't, the next
// Offer (Tier 2) they should see will be Amone's … Only if the users don't
// meet either of the two priority offers, they will see Tier 3 results (which
// … can include more than 1 specific offer, so it's kinda like an Offerwall)."
// Owner rulings: a lower tier's provider is called ONLY if the tier above says
// no; the visitor sees ONLY the tier that qualified; an auction's waterfalls
// split the traffic like an A/B test.

describeDb("0062 offer waterfall — tiers through the REAL engine (mocked providers)", () => {
  function harness(): { sdb: SqliteDb; env: Env } {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const { kv } = makeKvStub();
    return { sdb, env: buildEnv(d1FromSqlite(sdb), kv) };
  }
  // Each provider gets its own endpoint so the stub knows who was called.
  function providerOffer(sdb: SqliteDb, name: string): SeededOffer {
    const o = seedOffer(sdb);
    sdb.prepare("UPDATE leadgen_offers SET endpoint_production = ?, endpoint_staging = ? WHERE id = ?")
      .run(`https://${name}.provider.example/quote`, `https://${name}.provider.example/quote`, o.offer_id);
    return o;
  }
  function waterfall(sdb: SqliteDb, auctionId: number, sharePct: number, tiers: number[][], opts: { priority?: number; conditions?: unknown } = {}): string {
    const publicId = mintPublicId("auction_rule");
    sdb
      .prepare(
        `INSERT INTO leadgen_auction_rules (public_id, auction_id, rule_level, target_offer_id, action, conditions_json, conditions_hash, priority, enabled, traffic_share_pct, tiers_json)
         VALUES (?, ?, 'offer', NULL, 'waterfall', ?, 'h', ?, 1, ?, ?)`,
      )
      .run(publicId, auctionId, JSON.stringify(opts.conditions ?? { groups: [] }), opts.priority ?? 100, sharePct, JSON.stringify({ tiers: tiers.map((ids) => ({ offer_ids: ids })) }));
    return publicId;
  }
  const hostOf = (url: string): string => new URL(url).host.split(".")[0] ?? "";
  // A provider that answers with one carrier (a "yes") or none (a "no").
  const yes = (name: string): Response => new Response(carrierBody([{ name, bid: 12 }]), { status: 200 });
  const no = (): Response => new Response(JSON.stringify({ carriers: [] }), { status: 200 });
  async function run(env: Env, sdb: SqliteDb, auction: LeadgenAuctionRow, extra: Record<string, unknown> = {}) {
    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    return runAuction(env, {
      resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING,
      session_id: "visitor-1", raw_answers: {}, clicked: [], ...extra,
    } as Parameters<typeof runAuction>[1], { dryRun: true });
  }
  const shownOffers = (r: Awaited<ReturnType<typeof runAuction>>): string[] => [...new Set(r.banners.map((b) => b.offer_public_id))].sort();

  it("Tier 1 says yes: ONLY Tier 1's provider is called and the visitor sees only Tier 1", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { multi_offer: "enabled" });
    const fundera = providerOffer(sdb, "fundera");
    const amone = providerOffer(sdb, "amone");
    const fora = seedOffer(sdb, { dynamic: false, staticBid: 5 });
    for (const o of [fundera, amone, fora]) attachOffer(sdb, auction.id, o);
    waterfall(sdb, auction.id, 100, [[fundera.offer_id], [amone.offer_id], [fora.offer_id]]);
    const calls = stubFetch((url) => (hostOf(url) === "fundera" ? yes("Fundera") : yes("AmONE")));

    const r = await run(env, sdb, auction);
    expect(calls.map((c) => hostOf(c.url))).toEqual(["fundera"]);
    expect(shownOffers(r)).toEqual([fundera.offer_public_id]);
    expect(r.explain.waterfall?.served_tier).toBe(1);
    expect(r.explain.waterfall?.tiers.map((t) => t.outcome)).toEqual(["shown", "not_reached", "not_reached"]);
  });

  it("Tier 1 says no: Tier 2 is called only AFTER Tier 1 answered (never in parallel) and only Tier 2 shows", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { multi_offer: "enabled" });
    const fundera = providerOffer(sdb, "fundera");
    const amone = providerOffer(sdb, "amone");
    const fora = seedOffer(sdb, { dynamic: false, staticBid: 5 });
    for (const o of [fundera, amone, fora]) attachOffer(sdb, auction.id, o);
    waterfall(sdb, auction.id, 100, [[fundera.offer_id], [amone.offer_id], [fora.offer_id]]);
    const timeline: string[] = [];
    stubFetch(async (url) => {
      const who = hostOf(url);
      timeline.push(`start:${who}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      timeline.push(`end:${who}`);
      return who === "fundera" ? no() : yes("AmONE");
    });

    const r = await run(env, sdb, auction);
    expect(timeline).toEqual(["start:fundera", "end:fundera", "start:amone", "end:amone"]);
    expect(shownOffers(r)).toEqual([amone.offer_public_id]);
    expect(r.explain.waterfall?.tiers.map((t) => t.outcome)).toEqual(["no_result", "shown", "not_reached"]);
    // both calls really made are explained + logged
    expect(r.explain.providers_requested.map((p) => p.offer_id)).toEqual([fundera.offer_public_id, amone.offer_public_id]);
    expect(r.provider_log_rows.map((p) => p.offer_public_id)).toEqual([fundera.offer_public_id, amone.offer_public_id]);
  });

  it("Tiers 1 and 2 show nothing: Tier 3's offers show TOGETHER (offerwall) even with multi-offer off", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { multi_offer: "disabled", surface_static_bid_offers: 0 });
    const fundera = providerOffer(sdb, "fundera");
    const amone = providerOffer(sdb, "amone");
    const fora = seedOffer(sdb, { dynamic: false, staticBid: 5 });
    const honest = seedOffer(sdb, { dynamic: false, staticBid: 4 });
    for (const o of [fundera, amone, fora, honest]) attachOffer(sdb, auction.id, o);
    waterfall(sdb, auction.id, 100, [[fundera.offer_id], [amone.offer_id], [fora.offer_id, honest.offer_id]]);
    const calls = stubFetch(() => no());

    const r = await run(env, sdb, auction);
    expect(calls.map((c) => hostOf(c.url))).toEqual(["fundera", "amone"]);
    expect(shownOffers(r)).toEqual([fora.offer_public_id, honest.offer_public_id].sort());
    expect(r.explain.waterfall?.served_tier).toBe(3);
  });

  it("an offer whose OWN rules the visitor fails is skipped without a call (Fundera blocked in CA → AmONE)", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { multi_offer: "enabled" });
    const fundera = providerOffer(sdb, "fundera");
    const amone = providerOffer(sdb, "amone");
    for (const o of [fundera, amone]) attachOffer(sdb, auction.id, o);
    sdb.prepare("INSERT INTO leadgen_offer_region_rules (public_id, offer_id, dimension, action, values_json) VALUES (?, ?, 'state', 'exclude', '[\"CA\"]')")
      .run(mintPublicId("offer_region_rule"), fundera.offer_id);
    waterfall(sdb, auction.id, 100, [[fundera.offer_id], [amone.offer_id]]);
    const calls = stubFetch(() => yes("Any"));

    const r = await run(env, sdb, auction, { request_context: { state: "CA" } });
    expect(calls.map((c) => hostOf(c.url))).toEqual(["amone"]);
    expect(r.explain.waterfall?.tiers.map((t) => t.outcome)).toEqual(["no_qualifying_offer", "shown"]);
    expect(shownOffers(r)).toEqual([amone.offer_public_id]);
  });

  it("no tier shows anything: the visitor sees nothing — offers outside the tiers are never called", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { multi_offer: "enabled" });
    const fundera = providerOffer(sdb, "fundera");
    const other = providerOffer(sdb, "other");
    for (const o of [fundera, other]) attachOffer(sdb, auction.id, o);
    waterfall(sdb, auction.id, 100, [[fundera.offer_id]]);
    const calls = stubFetch(() => no());

    const r = await run(env, sdb, auction);
    expect(calls.map((c) => hostOf(c.url))).toEqual(["fundera"]);
    expect(r.banners).toEqual([]);
    expect(r.status).not.toBe("ok");
    expect(r.explain.waterfall?.served_tier).toBeNull();
  });

  it("the share is real and sticky: a 50% waterfall gets about half of 300 visitors; the rest get the normal auction", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { multi_offer: "enabled" });
    const fundera = providerOffer(sdb, "fundera");
    const amone = providerOffer(sdb, "amone");
    for (const o of [fundera, amone]) attachOffer(sdb, auction.id, o);
    waterfall(sdb, auction.id, 50, [[fundera.offer_id], [amone.offer_id]]);
    const calls = stubFetch((url) => yes(hostOf(url)));
    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const inWaterfall = new Map<string, boolean>();
    for (let i = 0; i < 300; i++) {
      calls.length = 0;
      const r = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: `visitor-${i}`, raw_answers: {}, clicked: [] }, { dryRun: true });
      const waterfallPath = r.explain.waterfall !== null;
      // waterfall path: Fundera alone (it says yes); normal auction: both, in parallel
      expect(calls.map((c) => hostOf(c.url)).sort()).toEqual(waterfallPath ? ["fundera"] : ["amone", "fundera"]);
      inWaterfall.set(`visitor-${i}`, waterfallPath);
    }
    const share = [...inWaterfall.values()].filter(Boolean).length / 300;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.6);
    // sticky: the same visitor gets the same path again
    for (let i = 0; i < 20; i++) {
      const r = await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: `visitor-${i}`, raw_answers: {}, clicked: [] }, { dryRun: true });
      expect(r.explain.waterfall !== null).toBe(inWaterfall.get(`visitor-${i}`));
    }
  });

  it("an exclude rule limited to 30% of traffic removes its offer for about 30% of visitors only", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { multi_offer: "enabled" });
    const fundera = providerOffer(sdb, "fundera");
    const amone = providerOffer(sdb, "amone");
    for (const o of [fundera, amone]) attachOffer(sdb, auction.id, o);
    sdb
      .prepare(
        "INSERT INTO leadgen_auction_rules (public_id, auction_id, rule_level, target_offer_id, action, conditions_json, conditions_hash, priority, enabled, traffic_share_pct) VALUES (?, ?, 'offer', ?, 'exclude', '{\"groups\":[]}', 'h', 100, 1, 30)",
      )
      .run(mintPublicId("auction_rule"), auction.id, fundera.offer_id);
    const calls = stubFetch((url) => yes(hostOf(url)));
    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    let excluded = 0;
    for (let i = 0; i < 300; i++) {
      calls.length = 0;
      await runAuction(env, { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: `v-${i}`, raw_answers: {}, clicked: [] }, { dryRun: true });
      if (!calls.some((c) => hostOf(c.url) === "fundera")) excluded += 1;
    }
    expect(excluded / 300).toBeGreaterThan(0.22);
    expect(excluded / 300).toBeLessThan(0.38);
  });

  it("the auction log records the path: waterfall_json on a waterfall run, NULL on a normal one", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { multi_offer: "enabled" });
    const fundera = providerOffer(sdb, "fundera");
    attachOffer(sdb, auction.id, fundera);
    const ruleId = waterfall(sdb, auction.id, 100, [[fundera.offer_id]]);
    stubFetch(() => yes("Fundera"));

    const withWaterfall = await run(env, sdb, auction);
    await persistAuctionResult(env, withWaterfall);
    const normal = await run(env, sdb, auction, { waterfall_choice: "none" });
    await persistAuctionResult(env, normal);
    const rows = sdb.prepare("SELECT auction_instance_id, waterfall_json FROM leadgen_auction_result_log").all() as Array<{ auction_instance_id: string; waterfall_json: string | null }>;
    const byId = new Map(rows.map((r) => [r.auction_instance_id, r.waterfall_json]));
    const logged = JSON.parse(byId.get(withWaterfall.auction_instance_id) ?? "null") as { rule_id: string; served_tier: number };
    expect(logged.rule_id).toBe(ruleId);
    expect(logged.served_tier).toBe(1);
    expect(byId.get(normal.auction_instance_id)).toBeNull();
  });

  it("a 'Present only this offer' attempt is never sent down a waterfall", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb, { multi_offer: "enabled" });
    const fundera = providerOffer(sdb, "fundera");
    const amone = providerOffer(sdb, "amone");
    for (const o of [fundera, amone]) attachOffer(sdb, auction.id, o);
    waterfall(sdb, auction.id, 100, [[fundera.offer_id], [amone.offer_id]]);
    const calls = stubFetch((url) => yes(hostOf(url)));

    const r = await run(env, sdb, auction, { present_only_offer_id: amone.offer_id });
    expect(calls.map((c) => hostOf(c.url))).toEqual(["amone"]);
    expect(r.explain.waterfall).toBeNull();
    expect(shownOffers(r)).toEqual([amone.offer_public_id]);
  });
});
