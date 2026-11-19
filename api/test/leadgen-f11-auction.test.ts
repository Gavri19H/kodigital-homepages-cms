// F11 (backlog F11, plan approved "Final" 11 Nov 2026, updated 19 Nov 2026) —
// Auction → Funnel eligibility rules → "Redirect to offer" → "When to
// redirect" → "After the offer is shown": the auction runs as normal, and the
// answer carries ONE extra instruction — open the rule's Offer's top card
// after N seconds. Driven through the REAL engine (loadAuctionBundle +
// runAuction + persistAuctionResult) over a node:sqlite D1 with the repo's
// own leadgen migrations, with RECORDED Provider answers (no real calls):
//
//   * a fixed-address Offer ("Honest Loans - OW": "Static — no provider
//     request", its own web address);
//   * a Provider Offer with a personal link ("Fundera - Tier 1", CPL): his
//     stored carrier_parse_json (schema v21) and Fundera's real ACCEPTED body
//     (sample_response_json, schema v10) / DECLINED body (provider-log row
//     210) — the same artefacts leadgen-cpl-static-bid.test.ts pins;
//   * a Provider returning several cards with no brand name
//     ("QuinStreetHome"): his stored parser (schema v57) over the recorded
//     6-listing NextInsure answer (test/fixtures/parser-every-listing) with
//     the brand ("displayname") taken out of every listing, as QuinStreet
//     may send it.
//
// Plan Section 8 checks covered here: the full auction runs and the open
// instruction is returned only when the Offer has a card; only the first
// matching rule counts (no backup Offer, even when a second rule's Offer has
// a card); the top card when an Offer has several; a missing brand gives
// brand null; "Straight away" unchanged; "Stay here" (stay_hides) for off,
// on + Offer and on + Carrier; the results-log record for all three outcomes;
// "Present only this offer"; a database without 0066 still works.

import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { shouldRedirectForSession } from "../src/leadgen/funnel";
import type { ResolvedActivatedFunnel } from "../src/public/leadgen/resolver";
import {
  loadAuctionBundle,
  persistAuctionResult,
  runAuction,
  type AntiTamperInput,
} from "../src/public/leadgen/auction/engine";
import type { LeadgenAuctionRow, LeadgenSectionRow } from "../src/admin/leadgen/db-types";

// ---------------------------------------------------------------------------
// node:sqlite harness + D1 shim (the leadgen-auction-runtime.test.ts convention)
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
  } as unknown as D1Database;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(TEST_DIR, "..", "migrations");

// Every leadgen migration from 0036 on — 0066 (the F11 columns) included.
// `before` keeps a database that has NOT had a given migration yet.
function createDb(opts: { before?: number } = {}): SqliteDb {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_leadgen_.*\.sql$/.test(f))
    .filter((f) => Number(f.slice(0, 4)) >= 36 && (opts.before === undefined || Number(f.slice(0, 4)) < opts.before))
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
    LEADGEN_CONFIG_SIGNING_KEY: "f11-signing-key-test-only",
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Recorded data
// ---------------------------------------------------------------------------

// leadgen_offer_payload_schemas id 139 (Fundera - Tier 1, version 21)
// carrier_parse_json, verbatim from production.
const FUNDERA_CPL_PARSE = {
  fields: {
    provider_id: "1050",
    carrier_name: "Fundera",
    carrier_logo: "https://moneylantern.com/media/2026/08/18/811ac6c8-8f49-43a4-b06d-2ffbdcd14aee.png",
    bid_currency: "usd",
    click_url: "{response:matches.registration_url}",
    headline: "It's a Match!",
    subheadline: "A rep will be in touch. You can start your application in the meantime.",
  },
};
// Fundera ACCEPTING a lead — the personal link the card's click goes to
// (sample_response_json on schema v10 of the same Offer).
const FUNDERA_ACCEPTED = {
  success: true,
  matches: {
    count: 4,
    product_types: ["Short-Term Loan", "SBA Loan", "Equipment Financing", "Merchant Cash Advance"],
    registration_url: "https://www.fundera.com/referral/560b178e44453357618d9eddca7b2d40",
    uuid: "682de0b9-dd73-4054-ab01-480c0f113dfd",
  },
};
// Fundera DECLINING (leadgen_provider_request_log row 210, redacted).
const FUNDERA_DECLINED = { success: false, errors: { owners: { 0: { email: "is required" } } } };

// QuinStreetHome (offer 8), active schema v57 — carrier_parse_json verbatim.
const QUINSTREET_HOME_PARSER = {
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
};
// The recorded 6-listing answer, with no brand name on any listing.
function quinstreetUnbranded(): unknown {
  const recorded = JSON.parse(
    readFileSync(join(TEST_DIR, "fixtures", "parser-every-listing", "nextinsure-home-6-listings.json"), "utf8"),
  ) as { response: { listingset: { listing: Array<Record<string, string>> } } };
  for (const listing of recorded.response.listingset.listing) delete listing["displayname"];
  return recorded;
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

interface Offer {
  id: number;
  public_id: string;
  host: string;
}

function placeOffer(sdb: SqliteDb, offerId: number, host: string): number {
  const placementPublic = mintPublicId("offer_placement");
  sdb.prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)").run(placementPublic, offerId, `plc-${host}`);
  return (sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(placementPublic) as { id: number }).id;
}

// "Honest Loans - OW": a "Static — no provider request" Offer with a web
// address of its own (a fixed-address Offer).
function honestLoans(sdb: SqliteDb, auctionId: number, order: number): Offer {
  const publicId = mintPublicId("offer");
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, static_bid_value, static_bid_currency,
          static_fallback_banner_url, banner_url_template, status)
       VALUES (?, 'Honest Loans - OW', 'Honest Loans', 'quote_funnel', 'life', 's2s_postback', 'cpl', 0, 'static', 'server', 212, 'USD',
               'https://www.honestloans.net/apply', 'https://www.honestloans.net/apply?sub={click_id}', 'active')`,
    )
    .run(publicId);
  const id = (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as { id: number }).id;
  attach(sdb, auctionId, id, placeOffer(sdb, id, "honest"), order);
  return { id, public_id: publicId, host: "honest" };
}

// A Provider Offer (calls its Provider; no web address of its own).
function providerOffer(
  sdb: SqliteDb,
  auctionId: number,
  o: { name: string; host: string; bidSource: "static" | "response"; staticBid: number | null; parse: unknown; order: number },
): Offer {
  const publicId = mintPublicId("offer");
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, static_bid_value, static_bid_currency,
          banner_url_template, static_fallback_banner_url, request_method, endpoint_production, endpoint_staging, status)
       VALUES (?, ?, NULL, 'quote_funnel', 'life', 's2s_postback', ?, 1, ?, 'server', ?, 'USD',
               NULL, NULL, 'POST', ?, ?, 'active')`,
    )
    .run(publicId, o.name, o.bidSource === "static" ? "cpl" : "cpc", o.bidSource, o.staticBid, `https://${o.host}.example/quote`, `https://staging.${o.host}.example/quote`);
  const id = (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as { id: number }).id;
  const schemaPublic = mintPublicId("payload_schema_version");
  sdb
    .prepare(
      "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, carrier_parse_json, carrier_parse_version, source) VALUES (?, ?, 1, ?, ?, 1, 'manual')",
    )
    .run(schemaPublic, id, JSON.stringify({ version: 1, root: { type: "object", children: [] } }), JSON.stringify(o.parse));
  const schemaId = (sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = ?").get(schemaPublic) as { id: number }).id;
  sdb
    .prepare("UPDATE leadgen_offers SET active_payload_schema_id = ?, last_test_status = 'passed', last_test_at = unixepoch(), last_test_source = 'test' WHERE id = ?")
    .run(schemaId, id);
  attach(sdb, auctionId, id, placeOffer(sdb, id, o.host), o.order);
  return { id, public_id: publicId, host: o.host };
}

function fundera(sdb: SqliteDb, auctionId: number, order: number): Offer {
  return providerOffer(sdb, auctionId, { name: "Fundera - Tier 1", host: "fundera", bidSource: "static", staticBid: 30, parse: FUNDERA_CPL_PARSE, order });
}
function quinstreet(sdb: SqliteDb, auctionId: number, order: number): Offer {
  return providerOffer(sdb, auctionId, { name: "QuinStreetHome", host: "quinstreet", bidSource: "response", staticBid: null, parse: QUINSTREET_HOME_PARSER, order });
}

function attach(sdb: SqliteDb, auctionId: number, offerId: number, placementId: number, order: number): void {
  sdb
    .prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, static_bid_override, enabled) VALUES (?, ?, ?, ?, NULL, 1)")
    .run(auctionId, placementId, offerId, order);
}

function seedAuction(sdb: SqliteDb, opts: { remove_clicked_offers?: number; removal_scope?: string } = {}): LeadgenAuctionRow {
  const publicId = mintPublicId("auction");
  sdb
    .prepare(
      `INSERT INTO leadgen_auctions
         (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
          surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
          backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
       VALUES (?, 'A Bussines loans', 'dynamic', 'highest_bid', 'percentage_of_max', 0, 'enabled', 1, 10, 3, 10,
               'disabled', 'on_slot_exhaustion', ?, ?, 2500, 1, 'active')`,
    )
    .run(publicId, opts.remove_clicked_offers ?? 0, opts.removal_scope ?? "offer");
  return sdb.prepare("SELECT * FROM leadgen_auctions WHERE public_id = ?").get(publicId) as unknown as LeadgenAuctionRow;
}

function seedVariant(sdb: SqliteDb): number {
  sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, 'SMB Loans', 'quote_funnel', '[\"life\"]')").run(mintPublicId("quote"));
  const quoteId = (sdb.prepare("SELECT id FROM leadgen_quotes ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
  sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES (?, ?, 'Business Loans Match')").run(mintPublicId("funnel"), quoteId);
  const funnelId = (sdb.prepare("SELECT id FROM leadgen_funnels ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
  sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id) VALUES (?, ?)").run(mintPublicId("funnel_variant"), funnelId);
  return (sdb.prepare("SELECT id FROM leadgen_funnel_variants ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
}

interface RuleSeed {
  type?: "redirect_direct_offer" | "disqualification" | "eligibility";
  offer?: Offer | null;
  pct?: number | null;
  seconds?: number | null; // null/absent = "Straight away"
  display?: "banner" | "animation" | null;
  priority: number;
  conditions?: unknown;
}
// Rules are written straight into leadgen_funnel_rules (the admin save is
// leadgen-f11-rules.test.ts's subject); the F11 columns only when set, so the
// same helper seeds a database without 0066.
function seedRule(sdb: SqliteDb, variantId: number, r: RuleSeed): string {
  const publicId = mintPublicId("funnel_rule");
  const after = r.seconds !== undefined && r.seconds !== null;
  sdb
    .prepare(
      `INSERT INTO leadgen_funnel_rules
         (public_id, variant_id, rule_type, conditions_json, conditions_hash, target_offer_id, priority, enabled, status, redirect_pct${after ? ", redirect_show_seconds, redirect_display" : ""})
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', ?${after ? ", ?, ?" : ""})`,
    )
    .run(
      publicId,
      variantId,
      r.type ?? "redirect_direct_offer",
      JSON.stringify(r.conditions ?? { groups: [] }),
      `h-${publicId}`,
      r.offer?.id ?? null,
      r.priority,
      r.pct ?? null,
      ...(after ? [r.seconds, r.display ?? null] : []),
    );
  return publicId;
}

function makeResolved(): ResolvedActivatedFunnel {
  return {
    site_quote: { id: 1, site_id: "site-1", quote_id: 1, enabled: 1, slug: null, settings_overrides_json: null, created_at: 0, updated_at: 0 },
    quote: { id: 1, public_id: "lgq_x", quote_name: "SMB Loans", activity: "quote_funnel", verticals_json: "[]", status: "active", created_by: null, created_at: 0, updated_at: 0, default_funnel_id: null },
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

const BINDING: AntiTamperInput = {
  funnel_variant_id: "lgn_test0000000000000000000000",
  funnel_attempt_id: "att_f11",
  section_order_hash: "",
  signed_config_token: "",
  session_id: null,
};

// Recorded answers by Provider host: Fundera accepts or declines, QuinStreet
// returns its unbranded listings. Returns the hosts called, in order.
function stubProviders(answers: { fundera?: "accepted" | "declined" } = {}): string[] {
  const called: string[] = [];
  vi.stubGlobal("fetch", async (url: RequestInfo | URL): Promise<Response> => {
    const host = new URL(String(url)).hostname.split(".")[0] ?? "";
    called.push(host);
    if (host === "fundera") {
      return new Response(JSON.stringify(answers.fundera === "declined" ? FUNDERA_DECLINED : FUNDERA_ACCEPTED), { status: 200 });
    }
    if (host === "quinstreet") return new Response(JSON.stringify(quinstreetUnbranded()), { status: 200 });
    return new Response("{}", { status: 404 });
  });
  return called;
}

async function run(
  env: Env,
  auction: LeadgenAuctionRow,
  variantId: number,
  extra: { session_id?: string; present_only_offer_id?: number | null; clicked?: Array<{ offer_public_id: string; carrier_key: string }> } = {},
) {
  const bundle = await loadAuctionBundle(env.DB, auction, variantId);
  return runAuction(
    env,
    {
      resolved: makeResolved(),
      bundle,
      environment: "production",
      binding: BINDING,
      session_id: extra.session_id ?? "visitor-1",
      raw_answers: {},
      clicked: extra.clicked ?? [],
      present_only_offer_id: extra.present_only_offer_id ?? null,
      runtime: { source: new Request("https://moneylantern.com/lg/business-loans") },
    },
    { dryRun: true },
  );
}

type Result = Awaited<ReturnType<typeof run>>;
const shownOffers = (r: Result): string[] => [...new Set(r.banners.map((b) => b.offer_public_id))].sort();
const eventTypes = (r: Result): string[] => r.events.map((e) => e.event_type);
// The record persistAuctionResult writes (the real INSERT), read back.
async function loggedRedirect(env: Env, sdb: SqliteDb, r: Result): Promise<unknown> {
  await persistAuctionResult(env, r);
  const row = sdb.prepare("SELECT redirect_json FROM leadgen_auction_result_log WHERE auction_instance_id = ?").get(r.auction_instance_id) as
    | { redirect_json: string | null }
    | undefined;
  expect(row, "the auction's results-log row was written").toBeDefined();
  return row?.redirect_json === null || row?.redirect_json === undefined ? null : JSON.parse(row.redirect_json);
}
// A visitor key on the requested side of a rule's sticky "Redirect %" draw.
function sessionFor(rulePublicId: string, pct: number, inside: boolean): string {
  for (let i = 0; i < 10000; i++) {
    const s = `visitor-${i}`;
    if (shouldRedirectForSession(pct, rulePublicId, s) === inside) return s;
  }
  throw new Error("no session found");
}

function harness(opts: { auction?: { remove_clicked_offers?: number; removal_scope?: string } } = {}) {
  const sdb = createDb();
  const env = buildEnv(d1FromSqlite(sdb));
  const auction = seedAuction(sdb, opts.auction);
  const variantId = seedVariant(sdb);
  return { sdb, env, auction, variantId };
}

// ===========================================================================

describeDb("F11 — an \"After the offer is shown\" rule runs the full auction and opens the Offer's card", () => {
  it("Provider Offer with a personal link (Fundera, recorded \"accepted\"): every Provider is still called, every card is built, and the answer opens Fundera's card", async () => {
    const { sdb, env, auction, variantId } = harness();
    const honest = honestLoans(sdb, auction.id, 0);
    const fun = fundera(sdb, auction.id, 1);
    const qs = quinstreet(sdb, auction.id, 2);
    const rule = seedRule(sdb, variantId, { offer: fun, pct: 100, seconds: 5, priority: 1 });
    const called = stubProviders({ fundera: "accepted" });

    const r = await run(env, auction, variantId);

    // the auction is NOT stopped: same Provider calls, same cards
    expect(called.sort()).toEqual(["fundera", "quinstreet"]);
    expect(r.status).toBe("ok");
    expect(r.redirect).toBeNull();
    expect(shownOffers(r)).toEqual([honest.public_id, fun.public_id, qs.public_id].sort());
    // the one extra instruction
    const card = r.banners.find((b) => b.offer_public_id === fun.public_id)!;
    expect(r.redirect_after).toEqual({
      rule_public_id: rule,
      offer_public_id: fun.public_id,
      slot: card.slot,
      carrier_key: "1050",
      seconds: 5,
      display: "banner",
      brand: "Fundera",
      logo_url: FUNDERA_CPL_PARSE.fields.carrier_logo,
      stay_hides: { mode: "none" },
      banner_render_id: r.banner_render_ids[0],
    });
    // the card's own link is unchanged: the governed /lg/lc link with its brid + slot
    expect(r.banners_html).toContain(`data-slot="${card.slot}" data-carrier-key="1050" data-offer="${fun.public_id}"`);
    expect(r.banners_html).toMatch(new RegExp(`href="/lg/lc/${fun.public_id}\\?ck=1050&amp;aiid=[^"]*&amp;brid=${r.banner_render_ids[0]}&amp;slot=${card.slot}&amp;`));
    // the click goes to the recorded personal link
    expect(card.click_url).toBe(FUNDERA_ACCEPTED.matches.registration_url);
    // the redirect events fire, naming the Offer
    expect(eventTypes(r)).toContain("redirect_rule_triggered");
    const direct = r.events.find((e) => e.event_type === "direct_offer_redirect");
    expect(direct?.offer_id).toBe(fun.public_id);
    expect(direct?.offer_name).toBe("Fundera - Tier 1");
    expect(await loggedRedirect(env, sdb, r)).toEqual({ rule_id: rule, offer_id: fun.public_id, outcome: "opened" });
  });

  it("a fixed-address Offer (Honest Loans): its card is opened, with its brand; display \"Only the animation\" rides along", async () => {
    const { sdb, env, auction, variantId } = harness();
    const honest = honestLoans(sdb, auction.id, 0);
    fundera(sdb, auction.id, 1);
    const rule = seedRule(sdb, variantId, { offer: honest, pct: 100, seconds: 12, display: "animation", priority: 1 });
    stubProviders({ fundera: "accepted" });

    const r = await run(env, auction, variantId);

    const card = r.banners.find((b) => b.offer_public_id === honest.public_id)!;
    expect(r.status).toBe("ok");
    expect(r.redirect_after).toMatchObject({
      rule_public_id: rule,
      offer_public_id: honest.public_id,
      slot: card.slot,
      carrier_key: card.carrier_key,
      seconds: 12,
      display: "animation",
      brand: "Honest Loans",
      logo_url: null,
    });
    expect(card.click_url).toBe("https://www.honestloans.net/apply");
  });

  it("a Provider with several unbranded cards (QuinStreetHome, recorded answer): the TOP card of that Offer is the one opened, and brand is null", async () => {
    const { sdb, env, auction, variantId } = harness();
    honestLoans(sdb, auction.id, 0);
    const qs = quinstreet(sdb, auction.id, 1);
    seedRule(sdb, variantId, { offer: qs, pct: 100, seconds: 5, priority: 1 });
    stubProviders();

    const r = await run(env, auction, variantId);

    const qsCards = r.banners.filter((b) => b.offer_public_id === qs.public_id);
    expect(qsCards.length).toBeGreaterThan(1); // several cards of the one Offer
    const top = qsCards[0]!;
    expect(Math.min(...qsCards.map((c) => c.slot))).toBe(top.slot);
    // the first listing (rank 1, the highest bid) — its own headline is its name line
    expect(top.html).toContain("Compare Home Insurance Rates in Minnesota");
    expect(r.redirect_after).toMatchObject({ offer_public_id: qs.public_id, slot: top.slot, carrier_key: top.carrier_key, brand: null, logo_url: "https://cdn.example/logo-1.png" });
  });
});

describeDb("F11 — only the first matching rule counts; no backup Offer", () => {
  it("the Offer has no card (Fundera, recorded \"declined\"): today's page, no instruction — even though the SECOND matching rule's Offer has a card", async () => {
    const { sdb, env, auction, variantId } = harness();
    const honest = honestLoans(sdb, auction.id, 0);
    const fun = fundera(sdb, auction.id, 1);
    const qs = quinstreet(sdb, auction.id, 2);
    const first = seedRule(sdb, variantId, { offer: fun, pct: 100, seconds: 5, priority: 1 });
    seedRule(sdb, variantId, { offer: qs, pct: 100, seconds: 5, priority: 2 });
    stubProviders({ fundera: "declined" });

    const r = await run(env, auction, variantId);

    expect(r.status).toBe("ok");
    expect(shownOffers(r)).toEqual([honest.public_id, qs.public_id].sort()); // the other Offers' cards, as today
    expect(r.redirect_after).toBeUndefined();
    expect(r.redirect).toBeNull();
    expect(eventTypes(r)).not.toContain("redirect_rule_triggered");
    expect(eventTypes(r)).not.toContain("direct_offer_redirect");
    expect(await loggedRedirect(env, sdb, r)).toEqual({ rule_id: first, offer_id: fun.public_id, outcome: "no_card" });
  });

  it("no card anywhere: today's no-offers result, no instruction, outcome \"no_card\"", async () => {
    const { sdb, env, auction, variantId } = harness();
    const fun = fundera(sdb, auction.id, 0);
    const rule = seedRule(sdb, variantId, { offer: fun, pct: 100, seconds: 5, priority: 1 });
    stubProviders({ fundera: "declined" });

    const r = await run(env, auction, variantId);

    expect(r.banners).toEqual([]);
    expect(["unfilled", "no_bid"]).toContain(r.status);
    expect(r.redirect_after).toBeUndefined();
    expect(await loggedRedirect(env, sdb, r)).toEqual({ rule_id: rule, offer_id: fun.public_id, outcome: "no_card" });
  });

  it("a \"Straight away\" rule BELOW the matching \"After\" rule does not fire for that visitor", async () => {
    const { sdb, env, auction, variantId } = harness();
    const honest = honestLoans(sdb, auction.id, 0);
    const fun = fundera(sdb, auction.id, 1);
    seedRule(sdb, variantId, { offer: fun, pct: 100, seconds: 5, priority: 1 });
    seedRule(sdb, variantId, { offer: honest, pct: 100, priority: 2 }); // Straight away
    stubProviders({ fundera: "accepted" });

    const r = await run(env, auction, variantId);

    expect(r.status).toBe("ok");
    expect(r.redirect).toBeNull();
    expect(r.redirect_after?.offer_public_id).toBe(fun.public_id);
  });

  it("a \"Straight away\" rule ABOVE it still redirects before the auction, exactly as today", async () => {
    const { sdb, env, auction, variantId } = harness();
    const honest = honestLoans(sdb, auction.id, 0);
    const fun = fundera(sdb, auction.id, 1);
    seedRule(sdb, variantId, { offer: honest, pct: 100, priority: 1 }); // Straight away
    seedRule(sdb, variantId, { offer: fun, pct: 100, seconds: 5, priority: 2 });
    const called = stubProviders({ fundera: "accepted" });

    const r = await run(env, auction, variantId);

    expect(r.status).toBe("redirect");
    expect(r.redirect).toEqual({ target_offer_id: honest.id, redirect_url: null });
    expect(called).toEqual([]); // no Provider asked
    expect(r.redirect_after).toBeUndefined();
    expect(r.result_log_row?.redirect_json).toBeUndefined();
  });

  it("a visitor outside the rule's \"Redirect %\" draw is held back: today's page, no instruction, no events, and no lower rule fires", async () => {
    const { sdb, env, auction, variantId } = harness();
    const honest = honestLoans(sdb, auction.id, 0);
    const fun = fundera(sdb, auction.id, 1);
    const rule = seedRule(sdb, variantId, { offer: fun, pct: 50, seconds: 5, priority: 1 });
    seedRule(sdb, variantId, { offer: honest, pct: 100, priority: 2 }); // Straight away, below
    stubProviders({ fundera: "accepted" });

    const out = await run(env, auction, variantId, { session_id: sessionFor(rule, 50, false) });
    expect(out.status).toBe("ok");
    expect(out.redirect).toBeNull();
    expect(out.redirect_after).toBeUndefined();
    expect(shownOffers(out)).toEqual([honest.public_id, fun.public_id].sort());
    expect(eventTypes(out)).not.toContain("redirect_rule_triggered");
    expect(await loggedRedirect(env, sdb, out)).toEqual({ rule_id: rule, offer_id: fun.public_id, outcome: "held_back" });

    // the same draw, the other half: opened
    const inside = await run(env, auction, variantId, { session_id: sessionFor(rule, 50, true) });
    expect(inside.redirect_after?.offer_public_id).toBe(fun.public_id);
    expect(await loggedRedirect(env, sdb, inside)).toEqual({ rule_id: rule, offer_id: fun.public_id, outcome: "opened" });
  });

  it("the rule never adds a card: a disqualification rule below it still disqualifies the visitor", async () => {
    const { sdb, env, auction, variantId } = harness();
    const fun = fundera(sdb, auction.id, 0);
    seedRule(sdb, variantId, { offer: fun, pct: 100, seconds: 5, priority: 1 });
    seedRule(sdb, variantId, { type: "disqualification", priority: 2, conditions: { groups: [{ field: "state", op: "eq", value: "CA" }] } });
    stubProviders({ fundera: "accepted" });

    const bundle = await loadAuctionBundle(env.DB, auction, variantId);
    const r = await runAuction(
      env,
      { resolved: makeResolved(), bundle, environment: "production", binding: BINDING, session_id: "visitor-1", raw_answers: {}, clicked: [], request_context: { state: "CA" } },
      { dryRun: true },
    );
    expect(r.status).toBe("disqualified");
    expect(r.redirect_after).toBeUndefined();
  });
});

describeDb("F11 — \"Stay here\" follows the Auction's \"Remove clicked offers\" + \"Removal scope\"", () => {
  for (const [label, settings, expected] of [
    ["off", { remove_clicked_offers: 0, removal_scope: "offer" }, (_o: string, _c: string) => ({ mode: "none" })],
    ["on + Offer", { remove_clicked_offers: 1, removal_scope: "offer" }, (o: string, _c: string) => ({ mode: "offer", offer_public_id: o })],
    ["on + Carrier", { remove_clicked_offers: 1, removal_scope: "carrier" }, (_o: string, c: string) => ({ mode: "carrier", carrier_key: c })],
  ] as const) {
    it(`${label}`, async () => {
      const { sdb, env, auction, variantId } = harness({ auction: settings });
      honestLoans(sdb, auction.id, 0);
      const qs = quinstreet(sdb, auction.id, 1);
      seedRule(sdb, variantId, { offer: qs, pct: 100, seconds: 5, priority: 1 });
      stubProviders();
      const r = await run(env, auction, variantId);
      const top = r.banners.find((b) => b.offer_public_id === qs.public_id)!;
      expect(r.redirect_after?.stay_hides).toEqual(expected(qs.public_id, top.carrier_key));
    });
  }
});

describeDb("F11 — \"Present only this offer\" works as today", () => {
  it("a visitor narrowed to one Offer is never sent to a different Offer (no instruction, no record)", async () => {
    const { sdb, env, auction, variantId } = harness();
    const honest = honestLoans(sdb, auction.id, 0);
    const fun = fundera(sdb, auction.id, 1);
    seedRule(sdb, variantId, { offer: fun, pct: 100, seconds: 5, priority: 1 });
    const called = stubProviders({ fundera: "accepted" });

    const r = await run(env, auction, variantId, { present_only_offer_id: honest.id });

    expect(called).toEqual([]); // Fundera is not in this attempt's auction
    expect(shownOffers(r)).toEqual([honest.public_id]);
    expect(r.redirect_after).toBeUndefined();
    expect(await loggedRedirect(env, sdb, r)).toBeNull();
  });

  it("…and a rule for that same Offer still opens its card", async () => {
    const { sdb, env, auction, variantId } = harness();
    const honest = honestLoans(sdb, auction.id, 0);
    fundera(sdb, auction.id, 1);
    const rule = seedRule(sdb, variantId, { offer: honest, pct: 100, seconds: 5, priority: 1 });
    stubProviders({ fundera: "accepted" });

    const r = await run(env, auction, variantId, { present_only_offer_id: honest.id });

    expect(r.redirect_after).toMatchObject({ rule_public_id: rule, offer_public_id: honest.public_id });
  });
});

describeDb("F11 — compatibility (pure \"unchanged when nothing is set\" checks)", () => {
  it("[compat] \"Straight away\" is unchanged: redirect before the auction, no Provider call, no instruction, no record", async () => {
    const { sdb, env, auction, variantId } = harness();
    const honest = honestLoans(sdb, auction.id, 0);
    fundera(sdb, auction.id, 1);
    seedRule(sdb, variantId, { offer: honest, pct: 100, priority: 1 });
    const called = stubProviders({ fundera: "accepted" });

    const r = await run(env, auction, variantId);

    expect(r.status).toBe("redirect");
    expect(r.redirect).toEqual({ target_offer_id: honest.id, redirect_url: null });
    expect(called).toEqual([]);
    expect(eventTypes(r)).toContain("redirect_rule_triggered");
    expect(r.redirect_after).toBeUndefined();
    expect(r.result_log_row?.redirect_json).toBeUndefined();
  });

  it("[compat] an auction with no rule carries no instruction and logs NULL", async () => {
    const { sdb, env, auction, variantId } = harness();
    honestLoans(sdb, auction.id, 0);
    fundera(sdb, auction.id, 1);
    stubProviders({ fundera: "accepted" });
    const r = await run(env, auction, variantId);
    expect(r.status).toBe("ok");
    expect(r.redirect_after).toBeUndefined();
    expect(await loggedRedirect(env, sdb, r)).toBeNull();
  });

  it("[compat] a database without 0066: rules load, \"Straight away\" redirects, a normal auction runs and is logged", async () => {
    const sdb = createDb({ before: 66 });
    const cols = (sdb.prepare("PRAGMA table_info(leadgen_funnel_rules)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).not.toContain("redirect_show_seconds");
    const env = buildEnv(d1FromSqlite(sdb));
    const auction = seedAuction(sdb);
    const variantId = seedVariant(sdb);
    const honest = honestLoans(sdb, auction.id, 0);
    const fun = fundera(sdb, auction.id, 1);
    stubProviders({ fundera: "accepted" });

    const normal = await run(env, auction, variantId);
    expect(normal.status).toBe("ok");
    expect(shownOffers(normal)).toEqual([honest.public_id, fun.public_id].sort());
    await persistAuctionResult(env, normal);
    expect(sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_auction_result_log WHERE auction_instance_id = ?").get(normal.auction_instance_id)).toEqual({ n: 1 });

    seedRule(sdb, variantId, { offer: honest, pct: 100, priority: 1 });
    const redirected = await run(env, auction, variantId);
    expect(redirected.status).toBe("redirect");
    expect(redirected.redirect).toEqual({ target_offer_id: honest.id, redirect_url: null });
  });
});
