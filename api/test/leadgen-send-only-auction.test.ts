// Send-only Offers (plan "Send-only Offers", 5 Nov 2026; migration 0068) —
// the auction / funnel / money half, driven through the REAL engine
// (loadAuctionBundle + runAuction + persistAuctionResult) and the real booking
// helper (settleSendOnlyLeads) over a node:sqlite D1 with the repo's own
// leadgen migrations (0068 included). Provider answers are recorded stubs
// keyed on host — no real network.
//
// Covered: an accepted lead never becomes a card and, when nothing else shows,
// becomes ONE non-clickable banner (status ok, auction_filled, fill reason
// lead_sent); the field rule; timeout / error reply (no card even with a
// Static-tab URL); a card from another Offer wins over the banner; two
// accepted leads → one banner (highest fixed bid, USD when currencies differ),
// both CPL booked; CPA books nothing but reports lead_sent with revenue 0; a
// retry books and reports once; team / preview traffic never posts a
// send-only Offer; the eligibility gate needs no parser for it; a default
// Offer is unchanged; an "After the offer is shown" rule produces no
// redirect_after for the banner; a later waterfall tier's card wins.

import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import type { ResolvedActivatedFunnel } from "../src/public/leadgen/resolver";
import {
  loadAuctionBundle,
  persistAuctionResult,
  runAuction,
  type AntiTamperInput,
  type RunAuctionInput,
} from "../src/public/leadgen/auction/engine";
import { settleSendOnlyLeads } from "../src/public/leadgen/send-only-leads";
import { evaluateDynamicOffersEligibility } from "../src/leadgen/validation";
import type { LeadgenAuctionRow, LeadgenSectionRow } from "../src/admin/leadgen/db-types";

// ---------------------------------------------------------------------------
// node:sqlite harness + D1 shim (with batch, for the booking write)
// ---------------------------------------------------------------------------

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

function createDb(): SqliteDb {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','loans.example.com');",
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_leadgen_.*\.sql$/.test(f))
    .filter((f) => Number(f.slice(0, 4)) >= 36)
    .sort();
  for (const f of files) runSql(sdb, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  return sdb;
}

function buildEnv(db: D1Database): Env {
  const kv = new Map<string, string>();
  return {
    DB: db,
    CACHE: {
      async get(k: string) { return kv.get(k) ?? null; },
      async put(k: string, v: string) { kv.set(k, v); },
      async delete(k: string) { kv.delete(k); },
    } as unknown as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.example.com",
    ADMIN_BASE_URL: "https://cms.example.com",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    LEADGEN_CONFIG_SIGNING_KEY: "send-only-signing-key-test-only",
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Seeds (no partner names: "Provider A/B/C", "Lender")
// ---------------------------------------------------------------------------

interface Offer {
  id: number;
  public_id: string;
  host: string;
}

const ANY_OK = { display: "send_only", accept: { kind: "any_ok" } };
const FIELD_RULE = (field: string, value: string) => ({ display: "send_only", accept: { kind: "field_equals", field, value } });
// A CPL card parser (literal brand + a {response:} click link), as a static-bid
// Offer that SHOWS a card is configured.
const CPL_CARD_PARSE = { fields: { carrier_name: "Lender A", click_url: "{response:url}", headline: "Matched" } };

function placeOffer(sdb: SqliteDb, offerId: number, host: string): number {
  const placementPublic = mintPublicId("offer_placement");
  sdb.prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)").run(placementPublic, offerId, `plc-${host}`);
  return (sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(placementPublic) as { id: number }).id;
}

function attach(sdb: SqliteDb, auctionId: number, offerId: number, placementId: number, order: number): void {
  sdb
    .prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, static_bid_override, enabled) VALUES (?, ?, ?, ?, NULL, 1)")
    .run(auctionId, placementId, offerId, order);
}

interface ProviderSeed {
  name: string;
  host: string;
  order: number;
  offerType?: "cpl" | "cpa" | "cpc";
  bidSource?: "static" | "response";
  staticBid?: number | null;
  currency?: string;
  parse?: unknown | null;
  sendOnly?: unknown | null;
  logo?: string | null;
  headline?: string | null;
  subheadline?: string | null;
  fallbackUrl?: string | null;
  template?: string | null;
}

// A "Provider request" Offer: it POSTs to https://<host>.example/quote.
function providerOffer(sdb: SqliteDb, auctionId: number, o: ProviderSeed): Offer {
  const publicId = mintPublicId("offer");
  const bidSource = o.bidSource ?? "static";
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, static_bid_value, static_bid_currency,
          banner_url_template, static_fallback_banner_url, request_method, endpoint_production, endpoint_staging, status,
          static_logo_url, static_headline, static_subheadline, send_only_json)
       VALUES (?, ?, NULL, 'quote_funnel', 'life', 's2s_postback', ?, 1, ?, 'server', ?, ?,
               ?, ?, 'POST', ?, ?, 'active', ?, ?, ?, ?)`,
    )
    .run(
      publicId,
      o.name,
      o.offerType ?? (bidSource === "static" ? "cpl" : "cpc"),
      bidSource,
      o.staticBid === undefined ? 30 : o.staticBid,
      o.currency ?? "USD",
      o.template ?? null,
      o.fallbackUrl ?? null,
      `https://${o.host}.example/quote`,
      `https://${o.host}.example/staging-quote`,
      o.logo === undefined ? "https://cdn.example/logo-a.png" : o.logo,
      o.headline === undefined ? "Your request was sent" : o.headline,
      o.subheadline === undefined ? "A specialist will contact you shortly." : o.subheadline,
      o.sendOnly === undefined || o.sendOnly === null ? null : JSON.stringify(o.sendOnly),
    );
  const id = (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as { id: number }).id;
  const schemaPublic = mintPublicId("payload_schema_version");
  const parse = o.parse === undefined ? null : o.parse;
  sdb
    .prepare(
      "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, carrier_parse_json, carrier_parse_version, source) VALUES (?, ?, 1, ?, ?, 1, 'manual')",
    )
    .run(schemaPublic, id, JSON.stringify({ version: 1, root: { type: "object", children: [] } }), parse === null ? null : JSON.stringify(parse));
  const schemaId = (sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = ?").get(schemaPublic) as { id: number }).id;
  sdb
    .prepare("UPDATE leadgen_offers SET active_payload_schema_id = ?, last_test_status = 'passed', last_test_at = unixepoch(), last_test_source = 'test' WHERE id = ?")
    .run(schemaId, id);
  attach(sdb, auctionId, id, placeOffer(sdb, id, o.host), o.order);
  return { id, public_id: publicId, host: o.host };
}

// A "Static — no provider request" Offer with its own web address (a card).
function staticOffer(sdb: SqliteDb, auctionId: number, order: number): Offer {
  const publicId = mintPublicId("offer");
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, static_bid_value, static_bid_currency,
          static_fallback_banner_url, banner_url_template, status)
       VALUES (?, 'Static Lender', 'Static Lender', 'quote_funnel', 'life', 's2s_postback', 'cpl', 0, 'static', 'server', 20, 'USD',
               'https://static-lender.example/apply', 'https://static-lender.example/apply?sub={click_id}', 'active')`,
    )
    .run(publicId);
  const id = (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as { id: number }).id;
  attach(sdb, auctionId, id, placeOffer(sdb, id, "static"), order);
  return { id, public_id: publicId, host: "static" };
}

function seedAuction(sdb: SqliteDb, opts: { timeout_ms?: number } = {}): LeadgenAuctionRow {
  const publicId = mintPublicId("auction");
  sdb
    .prepare(
      `INSERT INTO leadgen_auctions
         (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
          surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
          backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
       VALUES (?, 'Send-only auction', 'dynamic', 'highest_bid', 'percentage_of_max', 0, 'enabled', 1, 10, 3, 10,
               'disabled', 'on_slot_exhaustion', 0, 'offer', ?, 1, 'active')`,
    )
    .run(publicId, opts.timeout_ms ?? 2500);
  return sdb.prepare("SELECT * FROM leadgen_auctions WHERE public_id = ?").get(publicId) as unknown as LeadgenAuctionRow;
}

function seedVariant(sdb: SqliteDb): number {
  sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, 'Loans', 'quote_funnel', '[\"life\"]')").run(mintPublicId("quote"));
  const quoteId = (sdb.prepare("SELECT id FROM leadgen_quotes ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
  sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES (?, ?, 'Loans Match')").run(mintPublicId("funnel"), quoteId);
  const funnelId = (sdb.prepare("SELECT id FROM leadgen_funnels ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
  sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id) VALUES (?, ?)").run(mintPublicId("funnel_variant"), funnelId);
  return (sdb.prepare("SELECT id FROM leadgen_funnel_variants ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
}

function makeResolved(): ResolvedActivatedFunnel {
  return {
    site_quote: { id: 1, site_id: "site-1", quote_id: 1, enabled: 1, slug: null, settings_overrides_json: null, created_at: 0, updated_at: 0 },
    quote: { id: 1, public_id: "lgq_x", quote_name: "Loans", activity: "quote_funnel", verticals_json: "[]", status: "active", created_by: null, created_at: 0, updated_at: 0, default_funnel_id: null },
    funnel: { id: 1, public_id: "lgf_test0000000000000000000000", quote_id: 1, funnel_name: "F", active_ab_test_id: null, status: "active", created_at: 0, updated_at: 0, frame_config_json: null, theme_json: null, display_order: null, frame_template_id: null },
    variant: {
      id: 1, public_id: "lgn_test0000000000000000000000", funnel_id: 1, ab_test_id: null, variant_label: "A",
      traffic_allocation_bp: 10000, funnel_design_id: "default", auction_id: 1, lander_enabled: 0, lander_headline: null,
      lander_subheadline: null, lander_body_json: null, lander_hero_media_id: null, lander_hero_media_url: null, lander_cta_json: null,
      content_version: 1, status: "active", created_at: 0, frame_overrides_json: null, frame_template_id: null,
    },
    sections: [] as Array<{ position: number; section: LeadgenSectionRow }>,
    ga4_measurement_id: null,
    assignment: { funnel_ab_test_id: "", funnel_ab_test_revision: 0, variant_label: "A", traffic_allocation_bp: 10000, assignment_bucket: null, assignment_reason: "single_control" },
  } as unknown as ResolvedActivatedFunnel;
}

const ATTEMPT = "att_send_only_1";
const BINDING: AntiTamperInput = {
  funnel_variant_id: "lgn_test0000000000000000000000",
  funnel_attempt_id: ATTEMPT,
  section_order_hash: "",
  signed_config_token: "",
  session_id: null,
};

type Answer = Response | "timeout" | (() => Response);
// Recorded answers by Provider host. Returns the hosts called, in order.
function stubProviders(answers: Record<string, Answer>): string[] {
  const called: string[] = [];
  vi.stubGlobal("fetch", async (url: RequestInfo | URL): Promise<Response> => {
    const host = new URL(String(url instanceof Request ? url.url : url)).hostname.split(".")[0] ?? "";
    called.push(host);
    const a = answers[host];
    if (a === undefined) return new Response("{}", { status: 404 });
    if (a === "timeout") return new Promise<Response>(() => {});
    return typeof a === "function" ? a() : a.clone();
  });
  return called;
}
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

async function run(env: Env, auction: LeadgenAuctionRow, variantId: number | null, extra: Partial<RunAuctionInput> = {}) {
  const bundle = await loadAuctionBundle(env.DB, auction, variantId);
  return runAuction(
    env,
    {
      resolved: makeResolved(),
      bundle,
      environment: "production",
      binding: BINDING,
      session_id: "visitor-1",
      raw_answers: {},
      clicked: [],
      runtime: { source: new Request("https://loans.example.com/lg/loans?sub1=adset-77&sub2=ad-88&utm_source=facebook") },
      ...extra,
    },
    { dryRun: true },
  );
}

type Result = Awaited<ReturnType<typeof run>>;
const eventTypes = (r: Result): string[] => r.events.map((e) => e.event_type);

function harness(opts: { timeout_ms?: number } = {}) {
  const sdb = createDb();
  const env = buildEnv(d1FromSqlite(sdb));
  const auction = seedAuction(sdb, opts);
  return { sdb, env, auction };
}

function expectNotACard(html: string): void {
  expect(html).not.toContain("<a");
  expect(html).not.toContain("/lg/lc");
  expect(html).not.toContain("lg-banner-cta");
  expect(html).not.toContain("lg-banner-badge");
  expect(html).not.toContain("data-slot");
  expect(html).not.toContain('class="lg-banner"');
  expect(html).not.toContain("data-lg-px");
}

const revenueRows = (sdb: SqliteDb): Array<{ click_id: string; offer_public_id: string; revenue: number; currency: string; booking_trigger: string; conversions: number; source: string }> =>
  sdb.prepare("SELECT click_id, offer_public_id, revenue, currency, booking_trigger, conversions, source FROM leadgen_revenue_raw ORDER BY id").all() as never;
const conversionLogRows = (sdb: SqliteDb): Array<{ click_id: string; dedupe_key: string; offer_public_id: string; revenue: number }> =>
  sdb.prepare("SELECT click_id, dedupe_key, offer_public_id, revenue FROM leadgen_conversion_log ORDER BY id").all() as never;

// ===========================================================================

describeDb("Send-only Offers — an accepted lead is a banner, never a card", () => {
  it("Any OK reply: accepted, no card; ONE non-clickable banner with logo, headline, subheadline; status ok, auction_filled, fill reason lead_sent", async () => {
    const { sdb, env, auction } = harness();
    const a = providerOffer(sdb, auction.id, {
      name: "Provider A - send only",
      host: "provider-a",
      order: 0,
      sendOnly: ANY_OK,
      parse: null, // a send-only Offer needs no response parser
      logo: "/media/logos/provider-a.png", // a Media-library logo resolves against the funnel origin
      headline: "Your **request** was sent",
      subheadline: 'A specialist will call you. <a href="https://elsewhere.example">Learn more</a>',
      fallbackUrl: "https://provider-a.example/fallback",
    });
    const called = stubProviders({ "provider-a": new Response("OK", { status: 200 }) });

    const r = await run(env, auction, null);

    // it WAS posted, like any static-bid Offer
    expect(called).toEqual(["provider-a"]);
    expect(r.status).toBe("ok");
    expect(r.fill_reason).toBe("lead_sent");
    expect(r.explain.fill_reason).toBe("lead_sent");
    expect(r.explain.lead_sent).toEqual({ offer_id: a.public_id, bid_value: 30, bid_currency: "USD", usd_bid: 30 });
    expect(r.explain.unfilled_reason).toBeNull();
    expect(r.explain.send_only).toEqual([{ offer_id: a.public_id, provider_request_id: expect.any(String), accepted: true, reason: "accepted" }]);
    // no card, no impression, no carrier
    expect(r.banners).toEqual([]);
    expect(r.impression_rows).toEqual([]);
    expect(r.explain.carriers_shown).toEqual([]);
    // the banner
    const html = r.banners_html;
    expect(html.startsWith(`<div class="lg-banners" data-banner-render-id="${r.banner_render_ids[0]}">`)).toBe(true);
    expect(html).toContain('<div class="lg-lead-sent" role="note">');
    expect(html).toContain('<img class="lg-banner-logo" src="https://loans.example.com/media/logos/provider-a.png"');
    expect(html).toContain('<div class="lg-banner-name">Your <strong>request</strong> was sent</div>');
    expect(html).toContain('<div class="lg-banner-subheadline">A specialist will call you. Learn more</div>');
    expectNotACard(html);
    expect(html).not.toContain("elsewhere.example");
    // reports: filled, not unfilled
    expect(eventTypes(r)).toContain("auction_filled");
    expect(eventTypes(r)).not.toContain("auction_unfilled");
    const filled = r.events.find((e) => e.event_type === "auction_filled")!;
    expect(filled.offer_id).toBe(a.public_id);
    expect(filled.banner_render_id).toBe(r.banner_render_ids[0]);
    expect(filled.auction_unfilled_reason).toBe("");
    // the per-Offer events are exactly a provider call's (a plain-text OK is a
    // malformed body to the fetch stage, as for every Offer)
    expect(eventTypes(r)).toContain("auction_offer_request");
    // the lead the live route books
    expect(r.send_only_accepted?.map((l) => [l.offer_public_id, l.offer_type, l.bid_value, l.usd_bid])).toEqual([[a.public_id, "cpl", 30, 30]]);
    const ev = r.send_only_accepted![0]!.event;
    expect(ev.event_type).toBe("lead_sent");
    expect(ev.record_kind).toBe("event");
    expect([ev.sub1, ev.sub2, ev.offer_id, ev.funnel_attempt_id, ev.auction_instance_id]).toEqual(["adset-77", "ad-88", a.public_id, ATTEMPT, r.auction_instance_id]);
    expect(r.events.some((e) => e.event_type === "lead_sent")).toBe(false);
    // the result log stores the fill reason in winner_json
    await persistAuctionResult(env, r);
    const row = sdb.prepare("SELECT winner_json, unfilled_reason, carriers_shown_json FROM leadgen_auction_result_log WHERE auction_instance_id = ?").get(r.auction_instance_id) as {
      winner_json: string | null;
      unfilled_reason: string | null;
      carriers_shown_json: string;
    };
    expect(row.unfilled_reason).toBeNull();
    expect(row.carriers_shown_json).toBe("[]");
    expect(JSON.parse(row.winner_json ?? "null")).toEqual({
      fill_reason: "lead_sent",
      lead_sent: { offer_id: a.public_id, bid_value: 30, bid_currency: "USD", usd_bid: 30 },
    });
    // the 2xx still refreshes the Offer's Test status, as for any Offer
    const offerRow = sdb.prepare("SELECT last_test_status, last_test_source FROM leadgen_offers WHERE id = ?").get(a.id) as { last_test_status: string; last_test_source: string };
    expect(offerRow).toEqual({ last_test_status: "passed", last_test_source: "auction" });
  });

  it("field rule: \"status\" = \"accepted\" is accepted; another value, a false success flag, a missing field and a non-JSON body are not", async () => {
    const cases: Array<{ rule: unknown; reply: Response; accepted: boolean; reason: string }> = [
      { rule: FIELD_RULE("status", "accepted"), reply: json({ status: "Accepted", id: 7 }), accepted: true, reason: "accepted" },
      { rule: FIELD_RULE("status", "accepted"), reply: json({ status: "rejected" }), accepted: false, reason: "field_mismatch" },
      { rule: FIELD_RULE("success", "true"), reply: json({ success: false, errors: { email: "is required" } }), accepted: false, reason: "field_mismatch" },
      { rule: FIELD_RULE("result.status", "accepted"), reply: json({ result: {} }), accepted: false, reason: "field_missing" },
      { rule: FIELD_RULE("status", "accepted"), reply: new Response("accepted", { status: 200 }), accepted: false, reason: "field_missing" },
    ];
    for (const c of cases) {
      const { sdb, env, auction } = harness();
      const a = providerOffer(sdb, auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: c.rule, parse: CPL_CARD_PARSE });
      stubProviders({ "provider-a": c.reply });
      const r = await run(env, auction, null);
      expect(r.explain.send_only?.[0]).toMatchObject({ offer_id: a.public_id, accepted: c.accepted, reason: c.reason });
      expect(r.banners).toEqual([]); // never a card, accepted or not
      if (c.accepted) {
        expect(r.status).toBe("ok");
        expect(r.banners_html).toContain("lg-lead-sent");
        expect(r.send_only_accepted).toHaveLength(1);
      } else {
        expect(["unfilled", "no_bid"]).toContain(r.status);
        expect(r.banners_html).not.toContain("lg-lead-sent");
        expect(r.fill_reason).toBeUndefined();
        expect(r.send_only_accepted).toBeUndefined();
        expect(eventTypes(r)).toContain("auction_unfilled");
        // a JSON 2xx that was not accepted says why on its response event and its provider log row
        const response = r.events.find((e) => e.event_type === "auction_offer_response");
        if (c.reason === "field_mismatch" || (c.reason === "field_missing" && c.rule !== null && JSON.stringify(c.rule).includes("result.status"))) {
          expect(response?.provider_error_reason).toBe(`send_only_not_accepted:${c.reason}`);
          expect(r.provider_log_rows[0]?.provider_error_reason).toBe(`send_only_not_accepted:${c.reason}`);
          expect(r.provider_log_rows[0]?.error_text).toContain("Send-only lead not accepted");
        } else {
          // the non-JSON body is the fetch stage's own malformed_response error, as for any Offer
          expect(r.events.find((e) => e.event_type === "auction_offer_error")?.provider_error_reason).toBe("malformed_response");
        }
      }
    }
  });

  it("timeout and an error reply: not accepted, the usual no-match page, nothing booked — and NO card even with a Static-tab URL", async () => {
    for (const answer of ["timeout", json({ error: "down" }, 500)] as Answer[]) {
      const { sdb, env, auction } = harness({ timeout_ms: 40 });
      const a = providerOffer(sdb, auction.id, {
        name: "Provider A",
        host: "provider-a",
        order: 0,
        sendOnly: ANY_OK,
        parse: CPL_CARD_PARSE,
        fallbackUrl: "https://provider-a.example/static-url",
        template: "https://provider-a.example/go?c={click_id}",
      });
      stubProviders({ "provider-a": answer });
      const r = await run(env, auction, null);
      expect(r.explain.send_only?.[0]).toMatchObject({ offer_id: a.public_id, accepted: false, reason: answer === "timeout" ? "timeout" : "error_reply" });
      expect(r.banners).toEqual([]);
      expect(r.banners_html).not.toContain('class="lg-banner"');
      expect(r.banners_html).not.toContain("lg-lead-sent");
      expect(["unfilled", "no_bid"]).toContain(r.status);
      expect(r.explain.unfilled_reason).not.toBeNull();
      expect(r.send_only_accepted).toBeUndefined();
      expect(eventTypes(r)).toContain(answer === "timeout" ? "auction_offer_timeout" : "auction_offer_error");
      expect(eventTypes(r)).toContain("auction_unfilled");
      // nothing to book
      const settled = await settleSendOnlyLeads(env.DB, r.send_only_accepted ?? [], { funnel_attempt_id: ATTEMPT, traffic_quality: { traffic_quality_flag: "clean" }, now: new Date() });
      expect(settled.events).toEqual([]);
      expect(revenueRows(sdb)).toEqual([]);
    }
  });

  it("accepted together with another Offer's card: the card shows and no banner (the accepted lead is still booked)", async () => {
    const { sdb, env, auction } = harness();
    const a = providerOffer(sdb, auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK });
    const s = staticOffer(sdb, auction.id, 1);
    stubProviders({ "provider-a": json({ ok: true }) });
    const r = await run(env, auction, null);
    expect(r.status).toBe("ok");
    expect(r.banners.map((b) => b.offer_public_id)).toEqual([s.public_id]);
    expect(r.banners_html).toContain('class="lg-banner"');
    expect(r.banners_html).not.toContain("lg-lead-sent");
    expect(r.fill_reason).toBeUndefined();
    expect(r.explain.fill_reason).toBeUndefined();
    expect(r.send_only_accepted?.map((l) => l.offer_public_id)).toEqual([a.public_id]);
    const settled = await settleSendOnlyLeads(env.DB, r.send_only_accepted ?? [], { funnel_attempt_id: ATTEMPT, traffic_quality: { traffic_quality_flag: "clean" }, now: new Date() });
    expect(settled.outcomes).toEqual([{ offer_public_id: a.public_id, outcome: "booked" }]);
    expect(revenueRows(sdb).map((x) => [x.offer_public_id, x.revenue])).toEqual([[a.public_id, 30]]);
  });

  it("two send-only Offers accepted: ONE banner, for the highest fixed bid; both CPL leads are booked, each once", async () => {
    const { sdb, env, auction } = harness();
    const low = providerOffer(sdb, auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK, staticBid: 30, headline: "Low bid headline" });
    const high = providerOffer(sdb, auction.id, { name: "Provider B", host: "provider-b", order: 1, sendOnly: ANY_OK, staticBid: 45, headline: "High bid headline" });
    stubProviders({ "provider-a": json({ ok: 1 }), "provider-b": json({ ok: 1 }) });
    const r = await run(env, auction, null);
    expect(r.status).toBe("ok");
    expect(r.explain.lead_sent?.offer_id).toBe(high.public_id);
    expect(r.banners_html.match(/lg-lead-sent/g)).toHaveLength(1);
    expect(r.banners_html).toContain("High bid headline");
    expect(r.banners_html).not.toContain("Low bid headline");
    expect(r.send_only_accepted?.map((l) => l.offer_public_id).sort()).toEqual([low.public_id, high.public_id].sort());
    const settled = await settleSendOnlyLeads(env.DB, r.send_only_accepted!, { funnel_attempt_id: ATTEMPT, traffic_quality: { traffic_quality_flag: "clean" }, now: new Date() });
    expect(revenueRows(sdb).map((x) => [x.offer_public_id, x.revenue, x.click_id, x.booking_trigger, x.conversions, x.source]).sort()).toEqual(
      [
        [low.public_id, 30, ATTEMPT, "conversion", 1, "in_site"],
        [high.public_id, 45, ATTEMPT, "conversion", 1, "in_site"],
      ].sort(),
    );
    expect(conversionLogRows(sdb).map((x) => x.dedupe_key).sort()).toEqual([`lg:send_only:${high.public_id}`, `lg:send_only:${low.public_id}`].sort());
    expect(settled.events.map((e) => [e.event_type, e.offer_id, e.revenue, e.booking_trigger, e.bid_value, e.bid_currency]).sort()).toEqual(
      [
        ["lead_sent", low.public_id, 30, "lead", 30, "USD"],
        ["lead_sent", high.public_id, 45, "lead", 45, "USD"],
      ].sort(),
    );
  });

  it("currencies differ: the banner goes to the higher bid IN USD (the FX table); ties go to the auction's Offer order", async () => {
    const { sdb, env, auction } = harness();
    const today = new Date().toISOString().slice(0, 10);
    sdb.prepare("INSERT INTO leadgen_fx_rates (date, currency, usd_rate) VALUES (?, 'EUR', 1.2)").run(today);
    const usd = providerOffer(sdb, auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK, staticBid: 45, currency: "USD" });
    const eur = providerOffer(sdb, auction.id, { name: "Provider B", host: "provider-b", order: 1, sendOnly: ANY_OK, staticBid: 40, currency: "EUR" });
    stubProviders({ "provider-a": json({ ok: 1 }), "provider-b": json({ ok: 1 }) });
    const r = await run(env, auction, null);
    expect(r.explain.lead_sent).toEqual({ offer_id: eur.public_id, bid_value: 40, bid_currency: "EUR", usd_bid: 48 });
    void usd;

    // a tie in the same currency → the auction's first Offer
    const h2 = harness();
    const first = providerOffer(h2.sdb, h2.auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK, staticBid: 30 });
    providerOffer(h2.sdb, h2.auction.id, { name: "Provider B", host: "provider-b", order: 1, sendOnly: ANY_OK, staticBid: 30 });
    stubProviders({ "provider-a": json({ ok: 1 }), "provider-b": json({ ok: 1 }) });
    const r2 = await run(h2.env, h2.auction, null);
    expect(r2.explain.lead_sent?.offer_id).toBe(first.public_id);
  });

  it("type CPA accepted: the banner shows, nothing is booked, and ONE lead_sent event with revenue 0", async () => {
    const { sdb, env, auction } = harness();
    const a = providerOffer(sdb, auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK, offerType: "cpa", staticBid: 50 });
    stubProviders({ "provider-a": json({ ok: true }) });
    const r = await run(env, auction, null);
    expect(r.status).toBe("ok");
    expect(r.banners_html).toContain("lg-lead-sent");
    const settled = await settleSendOnlyLeads(env.DB, r.send_only_accepted!, { funnel_attempt_id: ATTEMPT, traffic_quality: { traffic_quality_flag: "clean" }, now: new Date() });
    expect(revenueRows(sdb)).toEqual([]);
    // the once-only claim, with no money on it
    expect(conversionLogRows(sdb)).toEqual([{ click_id: ATTEMPT, dedupe_key: `lg:send_only:${a.public_id}`, offer_public_id: a.public_id, revenue: 0 }]);
    expect(settled.events).toHaveLength(1);
    expect(settled.events[0]).toMatchObject({
      event_type: "lead_sent",
      record_kind: "event",
      offer_id: a.public_id,
      offer_type: "cpa",
      revenue: 0,
      booking_trigger: "lead",
      bid_value: 50,
      bid_currency: "USD",
      is_internal: false,
      is_preview: false,
      is_bot: false,
      traffic_quality_flag: "clean",
      sub1: "adset-77",
      sub2: "ad-88",
    });
  });

  it("a retry of the same funnel attempt books once and sends lead_sent once (CPL and CPA)", async () => {
    const { sdb, env, auction } = harness();
    const cpl = providerOffer(sdb, auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK, staticBid: 30 });
    const cpa = providerOffer(sdb, auction.id, { name: "Provider B", host: "provider-b", order: 1, sendOnly: ANY_OK, offerType: "cpa" });
    stubProviders({ "provider-a": json({ ok: 1 }), "provider-b": json({ ok: 1 }) });
    const first = await run(env, auction, null);
    const s1 = await settleSendOnlyLeads(env.DB, first.send_only_accepted!, { funnel_attempt_id: ATTEMPT, traffic_quality: { traffic_quality_flag: "clean" }, now: new Date() });
    const retry = await run(env, auction, null);
    const s2 = await settleSendOnlyLeads(env.DB, retry.send_only_accepted!, { funnel_attempt_id: ATTEMPT, traffic_quality: { traffic_quality_flag: "clean" }, now: new Date() });
    expect(s1.events.map((e) => e.offer_id).sort()).toEqual([cpl.public_id, cpa.public_id].sort());
    expect(s2.events).toEqual([]);
    expect(s2.outcomes.map((o) => o.outcome)).toEqual(["duplicate", "duplicate"]);
    expect(revenueRows(sdb).map((x) => x.offer_public_id)).toEqual([cpl.public_id]);
    // a different attempt books again
    const s3 = await settleSendOnlyLeads(env.DB, retry.send_only_accepted!, { funnel_attempt_id: "att_other", traffic_quality: { traffic_quality_flag: "clean" }, now: new Date() });
    expect(s3.events).toHaveLength(2);
    expect(revenueRows(sdb)).toHaveLength(2);
  });

  it("review fix: an accepted lead's reply event carries the fixed bid (not a \"no bid\" in Auction / Provider numbers); a declined one stays a no-bid", async () => {
    const { sdb, env, auction } = harness();
    const yes = providerOffer(sdb, auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: FIELD_RULE("status", "accepted"), staticBid: 30 });
    const no = providerOffer(sdb, auction.id, { name: "Provider B", host: "provider-b", order: 1, sendOnly: FIELD_RULE("status", "accepted"), staticBid: 40 });
    stubProviders({ "provider-a": json({ status: "accepted" }), "provider-b": json({ status: "rejected" }) });
    const r = await run(env, auction, null);
    const reply = (offerId: string) => r.events.find((e) => e.event_type === "auction_offer_response" && e.offer_id === offerId);
    expect(reply(yes.public_id)?.bid_value).toBe(30);
    expect(reply(yes.public_id)?.bids_count).toBe(1);
    expect(reply(yes.public_id)?.bid_currency).toBe("USD");
    expect(reply(no.public_id)?.bid_value ?? 0).toBe(0);
    expect(reply(no.public_id)?.bids_count).toBe(0);
    expect(reply(no.public_id)?.provider_error_reason).toBe("send_only_not_accepted:field_mismatch");
  });

  it("review fix: a CPL send-only Offer with no fixed bid books nothing (never a $0 conversion) and says so in the log", async () => {
    const { sdb, env, auction } = harness();
    providerOffer(sdb, auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK, staticBid: null });
    stubProviders({ "provider-a": json({ ok: 1 }) });
    const r = await run(env, auction, null);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const s = await settleSendOnlyLeads(env.DB, r.send_only_accepted!, { funnel_attempt_id: ATTEMPT, traffic_quality: { traffic_quality_flag: "clean" }, now: new Date() });
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("leadgen_send_only_no_bid"));
    errors.mockRestore();
    expect(s.outcomes.map((o) => o.outcome)).toEqual(["error"]);
    expect(s.events).toEqual([]);
    expect(revenueRows(sdb)).toEqual([]);
  });

  it("never books non-clean traffic or an empty attempt", async () => {
    const { sdb, env, auction } = harness();
    providerOffer(sdb, auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK });
    stubProviders({ "provider-a": json({ ok: 1 }) });
    const r = await run(env, auction, null);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bot = await settleSendOnlyLeads(env.DB, r.send_only_accepted!, { funnel_attempt_id: ATTEMPT, traffic_quality: { traffic_quality_flag: "bot" }, now: new Date() });
    const noAttempt = await settleSendOnlyLeads(env.DB, r.send_only_accepted!, { funnel_attempt_id: "", traffic_quality: { traffic_quality_flag: "clean" }, now: new Date() });
    expect(bot.outcomes.map((o) => o.outcome)).toEqual(["not_clean"]);
    expect(noAttempt.outcomes.map((o) => o.outcome)).toEqual(["no_attempt"]);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("leadgen_send_only_no_attempt"));
    errors.mockRestore();
    expect([...bot.events, ...noAttempt.events]).toEqual([]);
    expect(revenueRows(sdb)).toEqual([]);
    expect(conversionLogRows(sdb)).toEqual([]);
  });

  it("team and preview traffic: the send-only Offer is NOT posted (excluded before the request); other Offers still are", async () => {
    for (const quality of [{ is_internal: true, is_preview: false }, { is_internal: false, is_preview: true }]) {
      const { sdb, env, auction } = harness();
      const so = providerOffer(sdb, auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK });
      const card = providerOffer(sdb, auction.id, { name: "Provider B", host: "provider-b", order: 1, parse: CPL_CARD_PARSE });
      const called = stubProviders({ "provider-a": json({ ok: 1 }), "provider-b": json({ url: "https://lender-a.example/go" }) });
      const r = await run(env, auction, null, { traffic_quality: quality });
      expect(called).toEqual(["provider-b"]);
      expect(r.explain.offers_excluded).toContainEqual({ offer_id: so.public_id, reason: "team_or_preview_traffic" });
      expect(r.explain.send_only).toBeUndefined();
      expect(r.send_only_accepted).toBeUndefined();
      expect(r.banners.map((b) => b.offer_public_id)).toEqual([card.public_id]);
    }
    // clean traffic (or none given) posts it
    const { sdb, env, auction } = harness();
    providerOffer(sdb, auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK });
    const called = stubProviders({ "provider-a": json({ ok: 1 }) });
    await run(env, auction, null, { traffic_quality: { is_internal: false, is_preview: false } });
    expect(called).toEqual(["provider-a"]);
  });

  it("eligibility: a send-only Offer needs no response parser; a card-showing CPL Offer without one is still excluded", async () => {
    const { sdb, env, auction } = harness();
    const so = providerOffer(sdb, auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK, parse: null });
    const plain = providerOffer(sdb, auction.id, { name: "Provider B", host: "provider-b", order: 1, sendOnly: null, parse: null });
    const called = stubProviders({ "provider-a": json({ ok: 1 }), "provider-b": json({ ok: 1 }) });
    const r = await run(env, auction, null);
    expect(called).toEqual(["provider-a"]);
    expect(r.explain.offers_excluded).toEqual([{ offer_id: plain.public_id, reason: "carrier_parse_missing" }]);
    expect(r.explain.lead_sent?.offer_id).toBe(so.public_id);
  });

  it("the admin eligibility loader (Offers list, Auction warnings, activation preflight) agrees: no parser needed for a send-only Offer", async () => {
    const { sdb, env, auction } = harness();
    const so = providerOffer(sdb, auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK, parse: null });
    const plain = providerOffer(sdb, auction.id, { name: "Provider B", host: "provider-b", order: 1, sendOnly: null, parse: null });
    const verdicts = await evaluateDynamicOffersEligibility(env.DB, [so.id, plain.id], "production");
    expect(verdicts.get(so.id)?.verdict).toEqual({ eligible: true, reasons: [] });
    expect(verdicts.get(plain.id)?.verdict).toEqual({ eligible: false, reasons: ["carrier_parse_missing"] });
  });

  it("a default Offer (send_only_json NULL) and a send-only setting outside the CPL static-bid mode behave exactly as before: a card", async () => {
    // the default Offer alone: a card, and a trace with no send-only keys
    const h0 = harness();
    const alone = providerOffer(h0.sdb, h0.auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: null, parse: CPL_CARD_PARSE });
    stubProviders({ "provider-a": json({ url: "https://lender-a.example/go" }) });
    const r0 = await run(h0.env, h0.auction, null);
    expect(r0.banners.map((b) => [b.offer_public_id, b.click_url])).toEqual([[alone.public_id, "https://lender-a.example/go"]]);
    expect(Object.keys(r0.explain)).not.toContain("send_only");
    expect(Object.keys(r0.explain)).not.toContain("fill_reason");
    expect(r0.send_only_accepted).toBeUndefined();

    // …and the same default Offer next to a send-only twin answering the same
    // way: the default card is byte-for-byte the same card, the twin is none
    const { sdb, env, auction } = harness();
    const plain = providerOffer(sdb, auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: null, parse: CPL_CARD_PARSE });
    const twin = providerOffer(sdb, auction.id, { name: "Provider B", host: "provider-b", order: 1, sendOnly: ANY_OK, parse: CPL_CARD_PARSE });
    stubProviders({ "provider-a": json({ url: "https://lender-a.example/go" }), "provider-b": json({ url: "https://lender-a.example/go" }) });
    const r = await run(env, auction, null);
    expect(r.status).toBe("ok");
    expect(r.banners.map((b) => [b.offer_public_id, b.click_url])).toEqual([[plain.public_id, "https://lender-a.example/go"]]);
    expect(r.banners_html).toContain('class="lg-banner"');
    expect(r.banners_html).not.toContain("lg-lead-sent");
    const norm = (html: string, offerId: string): string =>
      html.split(offerId).join("OFFER").replace(/(aiid|brid)=[^&"]*/g, "$1=X");
    expect(norm(r.banners[0]!.html, plain.public_id)).toBe(norm(r0.banners[0]!.html, alone.public_id));
    expect(r.explain.send_only?.map((v) => [v.offer_id, v.accepted])).toEqual([[twin.public_id, true]]);
    expect(r.explain.fill_reason).toBeUndefined();
    expect(r.send_only_accepted?.map((l) => l.offer_public_id)).toEqual([twin.public_id]);

    // the setting stored on a CPC (response-bid) Offer is ignored
    const h2 = harness();
    const cpc = providerOffer(h2.sdb, h2.auction.id, {
      name: "Provider C",
      host: "provider-c",
      order: 0,
      bidSource: "response",
      staticBid: null,
      sendOnly: ANY_OK,
      parse: { carriers_path: "carriers", fields: { carrier_name: "name", bid: "bid", click_url: "url" } },
    });
    stubProviders({ "provider-c": json({ carriers: [{ name: "Carrier X", bid: 12, url: "https://x.example/go" }] }) });
    const r2 = await run(h2.env, h2.auction, null);
    expect(r2.banners.map((b) => b.offer_public_id)).toEqual([cpc.public_id]);
    expect(r2.explain.send_only).toBeUndefined();
  });

  it("an \"After the offer is shown\" rule pointing at another Offer: the banner case produces no redirect_after", async () => {
    const { sdb, env, auction } = harness();
    const variantId = seedVariant(sdb);
    providerOffer(sdb, auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK });
    const other = providerOffer(sdb, auction.id, { name: "Provider B", host: "provider-b", order: 1, parse: CPL_CARD_PARSE });
    const rulePublic = mintPublicId("funnel_rule");
    sdb
      .prepare(
        `INSERT INTO leadgen_funnel_rules
           (public_id, variant_id, rule_type, conditions_json, conditions_hash, target_offer_id, priority, enabled, status, redirect_pct, redirect_show_seconds, redirect_display)
         VALUES (?, ?, 'redirect_direct_offer', '{"groups":[]}', ?, ?, 1, 1, 'active', 100, 5, 'banner')`,
      )
      .run(rulePublic, variantId, `h-${rulePublic}`, other.id);
    // the other Offer's Provider declines (no card), the send-only lead is accepted
    stubProviders({ "provider-a": json({ ok: 1 }), "provider-b": () => new Response(null, { status: 204 }) });
    const r = await run(env, auction, variantId);
    expect(r.status).toBe("ok");
    expect(r.fill_reason).toBe("lead_sent");
    expect(r.redirect_after).toBeUndefined();
    expect(eventTypes(r)).not.toContain("redirect_rule_triggered");
    expect(JSON.parse(r.result_log_row?.redirect_json ?? "null")).toEqual({ rule_id: rulePublic, offer_id: other.public_id, outcome: "no_card" });
  });

  it("waterfall: an accepted send-only lead in Tier 1 does not stop Tier 2 — Tier 2's card wins over the banner", async () => {
    const { sdb, env, auction } = harness();
    const so = providerOffer(sdb, auction.id, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK });
    const s = staticOffer(sdb, auction.id, 1);
    sdb
      .prepare(
        `INSERT INTO leadgen_auction_rules (public_id, auction_id, rule_level, action, conditions_json, conditions_hash, priority, enabled, traffic_share_pct, tiers_json)
         VALUES (?, ?, 'offer', 'waterfall', '{"groups":[]}', 'h-wf', 1, 1, 100, ?)`,
      )
      .run(mintPublicId("auction_rule"), auction.id, JSON.stringify({ tiers: [{ offer_ids: [so.id] }, { offer_ids: [s.id] }] }));
    stubProviders({ "provider-a": json({ ok: 1 }) });
    const r = await run(env, auction, null);
    expect(r.explain.waterfall?.tiers.map((t) => t.outcome)).toEqual(["no_result", "shown"]);
    expect(r.banners.map((b) => b.offer_public_id)).toEqual([s.public_id]);
    expect(r.banners_html).not.toContain("lg-lead-sent");
    expect(r.fill_reason).toBeUndefined();
    // the Tier 1 lead was still accepted (and is booked by the live route)
    expect(r.send_only_accepted?.map((l) => l.offer_public_id)).toEqual([so.public_id]);
  });
});
