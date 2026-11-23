// Send-only Offers (plan "Send-only Offers", 5 Nov 2026; migration 0068) —
// POST /lg/auction through the REAL visitor routes (/lg/attempt → /lg/config
// → POST /lg/auction, signed token and all) and the admin Simulator, over a
// node:sqlite D1 with every migration from 0036 on. Provider answers and the
// event stream (Firehose) are captured stubs — no real network.
//
// serve-auction.ts's part: it computes the visitor's traffic quality exactly
// like the click route (team = ko_internal=1 cookie, preview = ?preview=1 on
// the request / Referer URL) and passes it to the engine; it books each
// accepted CPL lead's fixed price and claims the once-only lead_sent event
// AWAITED before the reply (GUARDRAILS C-009); and it sends lead_sent through
// the auction's own event batch. The Simulator never posts a send-only Offer.

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";

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
function makeKvStub(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) { return store.get(key) ?? null; },
    async getWithMetadata(key: string) { return { value: store.get(key) ?? null, metadata: null }; },
    async put(key: string, value: string) { store.set(key, value); },
    async delete(key: string) { store.delete(key); },
    async list() { return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" }; },
  } as unknown as KVNamespace;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(TEST_DIR, "..", "migrations");
const TENANT_HOST = "loans.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;
const API = "/api/admin/leadgen";
const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Offer { id: number; public_id: string; host: string }
interface Fixture {
  sdb: SqliteDb;
  env: Env;
  auctionId: number;
  auctionPublic: string;
  variant: { id: number; public_id: string };
}

const ANY_OK = { display: "send_only", accept: { kind: "any_ok" } };

function seed(): Fixture {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, title TEXT, seo_title TEXT);" +
      // X06: migration 0070 adds verticals.audience and 0071 fixes articles.seo_title, so the stub needs both.
      "CREATE TABLE verticals (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      `INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','${TENANT_HOST}','insurance','active');` +
      `INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','${TENANT_HOST}','active');`,
  );
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 36).sort()) {
    runSql(sdb, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  }
  const env = {
    DB: d1FromSqlite(sdb),
    CACHE: makeKvStub(),
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.example.com",
    ADMIN_BASE_URL: "https://cms.example.com",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    DEV_BYPASS_AUTH: "true",
    LEADGEN_CONFIG_SIGNING_KEY: "send-only-route-signing-key-test-only",
    // the event stream, captured by the fetch stub below
    AWS_ACCESS_KEY_ID: "k",
    AWS_SECRET_ACCESS_KEY: "s",
    LEADGEN_EVENTS_FIREHOSE_STREAM: "leadgen-events",
  } as unknown as Env;

  const quotePublic = mintPublicId("quote");
  sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status) VALUES (?, 'Loans', 'quote_funnel', '[\"life\"]', 'active')").run(quotePublic);
  const quoteId = (sdb.prepare("SELECT id FROM leadgen_quotes WHERE public_id = ?").get(quotePublic) as { id: number }).id;
  const auctionPublic = mintPublicId("auction");
  sdb
    .prepare(
      `INSERT INTO leadgen_auctions
         (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
          surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
          backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status, quote_id)
       VALUES (?, 'Send-only auction', 'dynamic', 'highest_bid', 'percentage_of_max', 0, 'enabled', 1, 5, 3, 10,
               'disabled', 'on_slot_exhaustion', 0, 'offer', 2500, 1, 'active', ?)`,
    )
    .run(auctionPublic, quoteId);
  const auctionId = (sdb.prepare("SELECT id FROM leadgen_auctions WHERE public_id = ?").get(auctionPublic) as { id: number }).id;
  const sectionPublic = mintPublicId("section");
  const comp = { type: "TwoButtonYesNo", question_id: "q_a1", question_key: "a1", internal_field: "a1", answer_type: "boolean" };
  sdb
    .prepare("INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, 'a1', 'quote_funnel', 'life', 'Headline', ?, 'button', 0, 'active')")
    .run(sectionPublic, JSON.stringify({ components: [comp] }));
  const sectionId = (sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(sectionPublic) as { id: number }).id;
  const funnelPublic = mintPublicId("funnel");
  sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status, display_order) VALUES (?, ?, 'Loans Match', 'active', 1)").run(funnelPublic, quoteId);
  const funnelId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(funnelPublic) as { id: number }).id;
  const variantPublic = mintPublicId("funnel_variant");
  sdb
    .prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status, content_version, auction_id) VALUES (?, ?, 'A', 10000, 'default', 'active', 1, ?)")
    .run(variantPublic, funnelId, auctionId);
  const variantId = (sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ?").get(variantPublic) as { id: number }).id;
  sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, quote_id, section_id, position) VALUES (?, NULL, ?, 0)").run(variantId, sectionId);
  sdb.prepare("UPDATE leadgen_quotes SET default_funnel_id = ? WHERE id = ?").run(funnelId, quoteId);
  sdb.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES ('site-1', ?, 1, NULL)").run(quoteId);
  return { sdb, env, auctionId, auctionPublic, variant: { id: variantId, public_id: variantPublic } };
}

// A "Provider request" Offer posting to https://<host>.example/quote (and
// /staging-quote for the Simulator).
function providerOffer(
  f: Fixture,
  o: { name: string; host: string; order: number; offerType?: "cpl" | "cpa"; staticBid?: number; sendOnly?: unknown | null; parse?: unknown | null },
): Offer {
  const { sdb } = f;
  const publicId = mintPublicId("offer");
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, static_bid_value, static_bid_currency,
          request_method, endpoint_production, endpoint_staging, status,
          static_logo_url, static_headline, static_subheadline, send_only_json)
       VALUES (?, ?, NULL, 'quote_funnel', 'life', 's2s_postback', ?, 1, 'static', 'server', ?, 'USD',
               'POST', ?, ?, 'active', 'https://cdn.example/logo.png', 'Your request was sent', 'A specialist will call you.', ?)`,
    )
    .run(
      publicId,
      o.name,
      o.offerType ?? "cpl",
      o.staticBid ?? 30,
      `https://${o.host}.example/quote`,
      `https://${o.host}.example/staging-quote`,
      o.sendOnly === undefined || o.sendOnly === null ? null : JSON.stringify(o.sendOnly),
    );
  const id = (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as { id: number }).id;
  const schemaPublic = mintPublicId("payload_schema_version");
  sdb
    .prepare(
      "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, carrier_parse_json, carrier_parse_version, source) VALUES (?, ?, 1, ?, ?, 1, 'manual')",
    )
    .run(schemaPublic, id, JSON.stringify({ version: 1, root: { type: "object", children: [] } }), o.parse === undefined || o.parse === null ? null : JSON.stringify(o.parse));
  const schemaId = (sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = ?").get(schemaPublic) as { id: number }).id;
  sdb
    .prepare("UPDATE leadgen_offers SET active_payload_schema_id = ?, last_test_status = 'passed', last_test_at = unixepoch(), last_test_source = 'test' WHERE id = ?")
    .run(schemaId, id);
  const placementPublic = mintPublicId("offer_placement");
  sdb.prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)").run(placementPublic, id, `plc-${o.host}`);
  const placementId = (sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(placementPublic) as { id: number }).id;
  sdb
    .prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, static_bid_override, enabled) VALUES (?, ?, ?, ?, NULL, 1)")
    .run(f.auctionId, placementId, id, o.order);
  return { id, public_id: publicId, host: o.host };
}

const CPL_CARD_PARSE = { fields: { carrier_name: "Lender B", click_url: "{response:url}" } };

// Provider answers by host + the captured event stream.
function stubNetwork(answers: Record<string, () => Response>): { called: string[]; stream: Array<Record<string, unknown>> } {
  const called: string[] = [];
  const stream: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("firehose")) {
      const bodyText = input instanceof Request ? await input.clone().text() : String(init?.body ?? "{}");
      const body = JSON.parse(bodyText) as { Records?: Array<{ Data: string }> };
      for (const rec of body.Records ?? []) stream.push(JSON.parse(Buffer.from(rec.Data, "base64").toString("utf8")) as Record<string, unknown>);
      return new Response(JSON.stringify({ FailedPutCount: 0, RequestResponses: [] }), { status: 200 });
    }
    const host = new URL(url).hostname.split(".")[0] ?? "";
    called.push(host);
    const a = answers[host];
    return a === undefined ? new Response("{}", { status: 404 }) : a();
  });
  return { called, stream };
}

interface Reply {
  status: string;
  banners_html: string;
  banners: unknown[];
  banner_render_id: string;
  auction_instance_id: string;
  unfilled?: true;
  unfilled_reason: string | null;
  fill_reason?: string;
  redirect_after?: unknown;
  impressions: unknown[];
}

interface Attempt { funnel_attempt_id: string; signed_config_token: string; session_id: string }

async function startAttempt(f: Fixture, session: string): Promise<Attempt> {
  const landing = `${TENANT_ORIGIN}/lg?utm_source=facebook&sub1=adset-123&sub2=ad-456`;
  const res = await app.request(`${TENANT_ORIGIN}/lg/attempt?vid=${f.variant.public_id}&u=${encodeURIComponent(landing)}`, { headers: { Cookie: `ko_sid=${session}` } }, f.env);
  expect(res.status).toBe(200);
  return (await res.json()) as Attempt;
}

// POST /lg/auction. `settled` = the reply came back; `drained` = waitUntil
// work (result log + telemetry) finished too.
async function postAuction(
  f: Fixture,
  attempt: Attempt,
  opts: { cookie?: string; referer?: string } = {},
): Promise<{ reply: Reply; drain: () => Promise<void> }> {
  const config = (await (await app.request(`${TENANT_ORIGIN}/lg/config/${f.variant.public_id}`, {}, f.env)).json()) as { section_order_hash: string };
  const promises: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => promises.push(Promise.resolve(p).catch(() => undefined)), passThroughOnException: () => {} } as unknown as ExecutionContext;
  const headers: Record<string, string> = { "content-type": "application/json", Cookie: opts.cookie ?? `ko_sid=${attempt.session_id}` };
  if (opts.referer !== undefined) headers["Referer"] = opts.referer;
  const res = await app.request(
    new Request(`${TENANT_ORIGIN}/lg/auction`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        funnel_variant_id: f.variant.public_id,
        funnel_attempt_id: attempt.funnel_attempt_id,
        section_order_hash: config.section_order_hash,
        signed_config_token: attempt.signed_config_token,
        session_id: attempt.session_id,
        page_view_id: "pv-1",
        answers: {},
      }),
    }),
    undefined,
    f.env,
    ctx,
  );
  expect(res.status, await res.clone().text()).toBe(200);
  const reply = (await res.json()) as Reply;
  return {
    reply,
    drain: async () => {
      await Promise.all(promises);
      await Promise.all(promises);
    },
  };
}

const revenueRows = (f: Fixture) =>
  f.sdb.prepare("SELECT click_id, offer_public_id, revenue, currency, booking_trigger, conversions FROM leadgen_revenue_raw ORDER BY id").all() as Array<Record<string, unknown>>;

describeDb("Send-only Offers — POST /lg/auction", () => {
  it("an accepted lead: the reply is a normal \"ok\" with the non-clickable banner; the CPL price is booked BEFORE the reply; lead_sent rides the event stream", async () => {
    const f = seed();
    const a = providerOffer(f, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK });
    const net = stubNetwork({ "provider-a": () => new Response(JSON.stringify({ ok: true }), { status: 200 }) });
    const attempt = await startAttempt(f, "s-1");
    const { reply, drain } = await postAuction(f, attempt);

    expect(net.called).toEqual(["provider-a"]);
    expect(reply.status).toBe("ok");
    expect(reply.unfilled).toBeUndefined();
    expect(reply.unfilled_reason).toBeNull();
    expect(reply.fill_reason).toBe("lead_sent");
    expect(reply.banners).toEqual([]);
    expect(reply.impressions).toEqual([]);
    expect(reply.redirect_after).toBeUndefined();
    expect(reply.banners_html).toContain(`<div class="lg-banners" data-banner-render-id="${reply.banner_render_id}"><div class="lg-lead-sent" role="note">`);
    expect(reply.banners_html).not.toContain("<a");
    expect(reply.banners_html).not.toContain("data-slot");
    // C-009: booked and claimed before the reply (no waitUntil drained yet)
    expect(revenueRows(f)).toEqual([
      { click_id: attempt.funnel_attempt_id, offer_public_id: a.public_id, revenue: 30, currency: "USD", booking_trigger: "conversion", conversions: 1 },
    ]);

    await drain();
    const leadSent = net.stream.filter((r) => r.event_type === "lead_sent");
    expect(leadSent).toHaveLength(1);
    expect(leadSent[0]).toMatchObject({
      record_kind: "event",
      offer_id: a.public_id,
      offer_type: "cpl",
      revenue: 30,
      booking_trigger: "lead",
      bid_value: 30,
      bid_currency: "USD",
      sub1: "adset-123",
      sub2: "ad-456",
      utm_source: "facebook",
      funnel_attempt_id: attempt.funnel_attempt_id,
      funnel_variant_id: f.variant.public_id,
      auction_instance_id: reply.auction_instance_id,
      auction_config_id: f.auctionPublic,
      session_id: attempt.session_id,
      is_bot: false,
      is_internal: false,
      is_preview: false,
      traffic_quality_flag: "clean",
    });
    expect(String(leadSent[0]!.quote_id)).toMatch(/^lgq_/);
    expect(String(leadSent[0]!.funnel_id)).toMatch(/^lgf_/);
    expect(String(leadSent[0]!.provider_request_id)).not.toBe("");
    // the auction's own events: filled, not unfilled
    const types = net.stream.map((r) => r.event_type);
    expect(types).toContain("auction_filled");
    expect(types).not.toContain("auction_unfilled");
    // the result log row records the fill reason (winner_json)
    const log = f.sdb.prepare("SELECT winner_json, unfilled_reason FROM leadgen_auction_result_log WHERE auction_instance_id = ?").get(reply.auction_instance_id) as { winner_json: string; unfilled_reason: string | null };
    expect(log.unfilled_reason).toBeNull();
    expect(JSON.parse(log.winner_json)).toMatchObject({ fill_reason: "lead_sent", lead_sent: { offer_id: a.public_id } });
  });

  it("a retry of the same funnel attempt books once and sends lead_sent once; the page is the same", async () => {
    const f = seed();
    const a = providerOffer(f, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK });
    const b = providerOffer(f, { name: "Provider B", host: "provider-b", order: 1, sendOnly: ANY_OK, offerType: "cpa", staticBid: 50 });
    const net = stubNetwork({
      "provider-a": () => new Response("{}", { status: 200 }),
      "provider-b": () => new Response("{}", { status: 200 }),
    });
    const attempt = await startAttempt(f, "s-2");
    const first = await postAuction(f, attempt);
    await first.drain();
    const retry = await postAuction(f, attempt);
    await retry.drain();
    expect(first.reply.status).toBe("ok");
    expect(retry.reply.status).toBe("ok");
    expect(retry.reply.banners_html).toContain("lg-lead-sent");
    // both posts reached the Providers (a retry re-runs the auction)…
    expect(net.called.sort()).toEqual(["provider-a", "provider-a", "provider-b", "provider-b"]);
    // …but money and the lead_sent report happen once per attempt and Offer
    expect(revenueRows(f).map((r) => r.offer_public_id)).toEqual([a.public_id]);
    const leadSent = net.stream.filter((r) => r.event_type === "lead_sent");
    expect(leadSent.map((r) => [r.offer_id, r.revenue]).sort()).toEqual([[a.public_id, 30], [b.public_id, 0]].sort());
  });

  it("team traffic (ko_internal=1) and preview traffic: the send-only Offer is not posted, nothing is booked, no lead_sent — other Offers still post", async () => {
    for (const visit of [{ cookie: "ko_internal=1" }, { referer: `${TENANT_ORIGIN}/lg?preview=1` }]) {
      const f = seed();
      const so = providerOffer(f, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK });
      providerOffer(f, { name: "Provider B", host: "provider-b", order: 1, parse: CPL_CARD_PARSE });
      const net = stubNetwork({
        "provider-a": () => new Response("{}", { status: 200 }),
        "provider-b": () => new Response(JSON.stringify({ url: "https://lender-b.example/go" }), { status: 200 }),
      });
      const attempt = await startAttempt(f, "s-3");
      const { reply, drain } = await postAuction(f, attempt, {
        ...(visit.referer !== undefined ? { referer: visit.referer } : {}),
        cookie: `ko_sid=${attempt.session_id}${visit.cookie !== undefined ? `; ${visit.cookie}` : ""}`,
      });
      await drain();
      expect(net.called).toEqual(["provider-b"]);
      expect(reply.banners).toHaveLength(1);
      expect(reply.fill_reason).toBeUndefined();
      expect(revenueRows(f)).toEqual([]);
      expect(f.sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_conversion_log").get()).toEqual({ n: 0 });
      expect(net.stream.some((r) => r.event_type === "lead_sent")).toBe(false);
      const log = f.sdb.prepare("SELECT offers_excluded_json FROM leadgen_auction_result_log WHERE auction_instance_id = ?").get(reply.auction_instance_id) as { offers_excluded_json: string };
      expect(JSON.parse(log.offers_excluded_json)).toContainEqual({ offer_id: so.public_id, reason: "team_or_preview_traffic" });
    }
  });

  it("not accepted (error reply): the usual no-match reply, nothing booked, no lead_sent", async () => {
    const f = seed();
    providerOffer(f, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK });
    const net = stubNetwork({ "provider-a": () => new Response(JSON.stringify({ error: "x" }), { status: 500 }) });
    const attempt = await startAttempt(f, "s-4");
    const { reply, drain } = await postAuction(f, attempt);
    await drain();
    // it was posted (a send-only Offer needs no response parser) and the error reply decided "not accepted"
    expect(net.called).toEqual(["provider-a"]);
    const providerLog = f.sdb.prepare("SELECT status_code, provider_error_reason FROM leadgen_provider_request_log WHERE auction_instance_id = ?").get(reply.auction_instance_id);
    expect(providerLog).toEqual({ status_code: 500, provider_error_reason: "http_500" });
    expect(reply.unfilled).toBe(true);
    expect(reply.banners_html).not.toContain("lg-lead-sent");
    expect(reply.fill_reason).toBeUndefined();
    expect(revenueRows(f)).toEqual([]);
    expect(net.stream.some((r) => r.event_type === "lead_sent")).toBe(false);
    expect(net.stream.map((r) => r.event_type)).toContain("auction_unfilled");
  });
});

describeDb("Send-only Offers — the admin Simulator never posts a send-only lead", () => {
  it("the Simulator makes real Provider calls, so a send-only Offer is shown as not sent (no call), and other Offers still run", async () => {
    const f = seed();
    const so = providerOffer(f, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK });
    const other = providerOffer(f, { name: "Provider B", host: "provider-b", order: 1, parse: CPL_CARD_PARSE });
    const net = stubNetwork({
      "provider-a": () => new Response("{}", { status: 200 }),
      "provider-b": () => new Response(JSON.stringify({ url: "https://lender-b.example/go" }), { status: 200 }),
    });
    const res = await admin.request(
      `${API}/auctions/${f.auctionPublic}/simulate`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sample_answers: {} }) },
      f.env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      offers_excluded: Array<{ offer_id: string; reason: string }>;
      offers_payload_explain: Array<{ offer_id: string; send_only?: { status: string; label: string } }>;
      banners: Array<{ offer_public_id: string }>;
      fill_reason?: string;
    };
    // the Simulator really calls Providers — but never the send-only one
    expect(net.called).toEqual(["provider-b"]);
    expect(body.offers_excluded).toContainEqual({ offer_id: so.public_id, reason: "send_only_not_sent_simulator" });
    expect(body.offers_payload_explain.find((e) => e.offer_id === so.public_id)?.send_only).toEqual({
      status: "not_sent",
      label: "Send-only: not sent from the Simulator. Use the Offer's Test button.",
    });
    expect(body.offers_payload_explain.find((e) => e.offer_id === other.public_id)?.send_only).toBeUndefined();
    expect(body.banners.map((b) => b.offer_public_id)).toEqual([other.public_id]);
    expect(body.fill_reason).toBeUndefined();
    expect(f.sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_revenue_raw").get()).toEqual({ n: 0 });
  });

  it("the Simulator panel shows the send-only line and \"lead sent\" in the run's summary", async () => {
    const f = seed();
    providerOffer(f, { name: "Provider A", host: "provider-a", order: 0, sendOnly: ANY_OK });
    const html = await (await admin.request(`/admin/leadgen/auction/${f.auctionPublic}/edit`, {}, f.env)).text();
    const start = html.indexOf("function renderSimOffer(host, offer) {");
    const end = html.indexOf("\n  // X10 decision 4", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    // a tiny DOM double: the function only builds elements and text nodes
    interface El { tag: string; className: string; attrs: Record<string, string>; children: Array<El | string> }
    const makeEl = (tag: string, cls?: string): El & { setAttribute(k: string, v: string): void; appendChild(c: El | string): void } => {
      const el = { tag, className: cls ?? "", attrs: {} as Record<string, string>, children: [] as Array<El | string> };
      return Object.assign(el, {
        setAttribute(k: string, v: string) { el.attrs[k] = v; },
        appendChild(c: El | string) { el.children.push(c); },
      });
    };
    const text = (el: El | string): string => (typeof el === "string" ? el : el.children.map(text).join(""));
    const find = (el: El | string, attr: string): El | null => {
      if (typeof el === "string") return null;
      if (attr in el.attrs) return el;
      for (const c of el.children) { const hit = find(c, attr); if (hit !== null) return hit; }
      return null;
    };
    const renderSimOffer = new Function(
      "makeEl", "document", "eligibilityLabel", "simChips", "prettyJson",
      `${html.slice(start, end)}; return renderSimOffer;`,
    )(makeEl, { createTextNode: (t: string) => t }, (c: string) => c, () => undefined, (v: unknown) => JSON.stringify(v)) as (host: El, offer: unknown) => void;
    const host = makeEl("div");
    renderSimOffer(host, {
      offer_id: "lgo_1",
      excluded_reason: "send_only_not_sent_simulator",
      send_only: { status: "not_sent", label: "Send-only: not sent from the Simulator. Use the Offer's Test button." },
    });
    const card = host.children[0] as El;
    expect(find(card, "data-sim-verdict")?.attrs["data-sim-verdict"]).toBe("send_only_not_sent");
    expect(text(find(card, "data-sim-send-only")!)).toBe("Send-only: not sent from the Simulator. Use the Offer's Test button.");
    expect(text(card)).not.toContain("Reason:");
    const host2 = makeEl("div");
    renderSimOffer(host2, { offer_id: "lgo_2", send_only: { status: "not_accepted", label: "Not accepted: the reply field has a different value" } });
    expect(text(host2)).toContain("Not accepted: the reply field has a different value");
    expect(html).toContain("body.fill_reason === 'lead_sent' ? ' \\u00b7 lead sent'");
  });
});
