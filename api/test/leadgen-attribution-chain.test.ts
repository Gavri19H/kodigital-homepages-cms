// LeadGen analytics — §10.3 attribution ID-chain proof (fix-contract v2.4).
//
// One scripted funnel pass through the REAL server surfaces (runAuction →
// persistAuctionResult → resolveLeadgenClick → ingestProviderPostback) with a
// MOCKED provider + an injected ClickHouse client + an intercepted Firehose, then
// assert the §10.3 attribution IDs persist across the SERVER-OWNED legs
//   auction → impression → click → conversion → revenue
// so the downstream ClickHouse joins hold:
//   * auction_result_id: auction_filled == every impression row == the persisted
//     auction_result_log row RESOLVABLE from the click's auction_instance_id;
//   * banner_render_id: links impressions ↔ the click (a real auction-minted id);
//   * provider_request_id: the auction_offer_request/response events == the
//     persisted leadgen_provider_request_log row;
//   * placement_id: the impression == the click == the participating placement;
//   * revenue joins back via click_id + conversion_id;
//   * §5.4 version fields (auction_config_version, payload_schema_version) are
//     non-empty on auction-path events;
//   * session_id is continuous across the server legs (auction ↔ click).
//
// Client-beacon legs (quote_view … quote_complete, and the impression BEACONS the
// client fires from the server-built rows) span the browser; their envelope +
// /lg/track acceptance is proven in leadgen-analytics-producers.test.ts. This file
// documents which legs are server-owned (asserted here) vs client-beacon.

import { describe, expect, it, afterEach, vi } from "vitest";
import type { Env } from "../src/env";
import { loadAuctionBundle, runAuction, persistAuctionResult } from "../src/public/leadgen/auction/engine";
import { resolveLeadgenClick, type LeadgenClickInput } from "../src/public/leadgen/click";
import { ingestProviderPostback } from "../src/public/leadgen/postback";
import type { LeadgenParsedCarrier } from "../src/public/leadgen/auction/parse";
import type { LeadgenEvent } from "../src/analytics/leadgen-events";
import {
  loadDatabaseSync,
  createLeadgenDb,
  d1FromSqlite,
  makeKvStub,
  buildLeadgenEnv,
  stubLeadgenFetch,
  carrierBody,
  ctxCapture,
  settle,
  seedAuction,
  seedAuctionOffer,
  attachOffer,
  makeResolved,
  fakeChClient,
  POSTBACK_TOKEN,
  NO_BINDING,
  type SqliteDb,
  type DatabaseSyncCtor,
} from "./helpers/leadgen-analytics-harness";

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

const SESSION_ID = "sess-chain-1";

function ctxNoop(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
}

describeDb("§10.3 attribution chain — auction → impression → click → conversion → revenue", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the attribution IDs persist across every server-owned leg", async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const { kv } = makeKvStub();
    const env = buildLeadgenEnv(d1FromSqlite(sdb), kv, { firehose: true });

    // Firehose captured; the mocked provider returns one bidding carrier.
    const fetchStub = stubLeadgenFetch(() => new Response(carrierBody([{ name: "Acme", bid: 12 }]), { status: 200 }));

    // --- LEG 1: auction (server) ------------------------------------------------
    const auction = seedAuction(sdb, { multi_offer: "enabled" });
    const offer = seedAuctionOffer(sdb);
    attachOffer(sdb, auction.id, offer, 0);

    const bundle = await loadAuctionBundle(env.DB, auction, 1);
    const result = await runAuction(
      env,
      { resolved: makeResolved(), bundle, environment: "production", binding: NO_BINDING, session_id: SESSION_ID, raw_answers: {}, clicked: [] },
      { dryRun: true },
    );
    expect(result.status).toBe("ok");
    expect(result.banners.length).toBeGreaterThan(0);

    // Persist so the auction_result_log + provider_request_log rows exist for the
    // downstream joins (the caller persists a live auction; dryRun only skips the
    // caller's own persist, so we call it explicitly — leadgen-auction-runtime.test.ts idiom).
    await persistAuctionResult(env, result);

    const byType = (t: string): LeadgenEvent | undefined => result.events.find((e) => e.event_type === t);
    const filled = byType("auction_filled");
    const offerReq = byType("auction_offer_request");
    const offerResp = byType("auction_offer_response");
    const start = byType("auction_start");
    expect(filled, "auction_filled must fire on a filled auction").toBeDefined();
    expect(offerReq && offerResp, "offer request/response must fire for the dynamic offer").toBeTruthy();

    // The server-built impression rows (03 §3.6 / R7) the client beacons.
    const carrierImp = result.impression_rows.find((r) => r.event_type === "carrier_impression");
    const offerImp = result.impression_rows.find((r) => r.event_type === "offer_impression");
    expect(carrierImp, "a carrier_impression row must be built").toBeDefined();
    expect(offerImp, "an offer_impression row must be built").toBeDefined();

    // auction_result_id consistency: filled event == every impression row == run result.
    expect(result.auction_result_id).not.toBe("");
    expect(filled!.auction_result_id).toBe(result.auction_result_id);
    for (const r of result.impression_rows) expect(r.auction_result_id).toBe(result.auction_result_id);

    // §5.4 version fields non-empty on auction-path events.
    expect(start!.auction_config_version).not.toBe("");
    expect(filled!.auction_config_version).not.toBe("");
    expect(offerReq!.payload_schema_version).not.toBe("");
    expect(offerResp!.payload_schema_version).not.toBe("");

    // provider_request_id joins the offer request/response events ↔ the persisted
    // provider_request_log row.
    expect(offerReq!.provider_request_id).not.toBe("");
    expect(offerResp!.provider_request_id).toBe(offerReq!.provider_request_id);
    const provRow = (await env.DB.prepare(
      "SELECT provider_request_id, auction_instance_id FROM leadgen_provider_request_log WHERE auction_instance_id = ? AND provider_request_id = ?",
    )
      .bind(result.auction_instance_id, offerReq!.provider_request_id)
      .first()) as { provider_request_id: string; auction_instance_id: string } | null;
    expect(provRow, "the auction_offer_request provider_request_id must persist to leadgen_provider_request_log").not.toBeNull();

    // --- LEG 2: click (server) — threads the impression's IDs into the click ----
    const carrier: LeadgenParsedCarrier = {
      carrier_key: carrierImp!.carrier_key ?? "",
      carrier_key_source: "slug",
      carrier_name: "Acme Life",
      carrier_logo: null,
      click_url: null,
      bid: 12,
      bid_currency: "USD",
      tracking_id: null,
      headline: null,
      subheadline: null,
      disclaimer: null,
      pricing_model: null,
    };
    const clickInput: LeadgenClickInput = {
      offer_public_id: carrierImp!.offer_id,
      carrier_key: carrierImp!.carrier_key ?? "",
      auction_instance_id: result.auction_instance_id,
      banner_render_id: carrierImp!.banner_render_id,
      slot: carrierImp!.slot_index,
      funnel_attempt_id: "att_chain",
      session_id: SESSION_ID,
      auction_id: auction.id,
      carrier,
      banner_url_template: null,
      response_macro_fallbacks: null,
      response_context: null,
      canonical_macros: {},
      // The click event carries the participating placement (§10.3 placement_id leg).
      event_context: { placement_id: carrierImp!.placement_id },
      offer: null,
      removal_scope: "offer",
      now: 1_700_000_000_000,
    };
    const click = await resolveLeadgenClick(env, ctxNoop(), clickInput);
    const clickEvent = click.events.find((e) => e.event_type === "carrier_click");
    expect(clickEvent, "a carrier_click must fire for the carrier-scoped click").toBeDefined();
    const clickId = click.click_id;
    expect(clickId.startsWith("lgl_")).toBe(true);

    // banner_render_id links impressions ↔ click, and is a REAL auction-minted id.
    expect(clickEvent!.banner_render_id).toBe(carrierImp!.banner_render_id);
    expect(result.banner_render_ids.includes(clickEvent!.banner_render_id)).toBe(true);

    // auction_result_id resolvable from the click's auction_instance_id (via the
    // persisted result log).
    expect(clickEvent!.auction_instance_id).toBe(result.auction_instance_id);
    const resultLog = (await env.DB.prepare(
      "SELECT auction_result_id FROM leadgen_auction_result_log WHERE auction_instance_id = ?",
    )
      .bind(clickEvent!.auction_instance_id)
      .first()) as { auction_result_id: string } | null;
    expect(resultLog, "the auction_instance_id from the click must resolve a persisted result log").not.toBeNull();
    expect(resultLog!.auction_result_id).toBe(result.auction_result_id);

    // placement_id on impression == click == the participating placement (the
    // engine stamps the placement's EXTERNAL id — 04 §4.5).
    expect(carrierImp!.placement_id).toBe(offer.placement_external_id);
    expect(carrierImp!.placement_id).not.toBe("");
    expect(clickEvent!.placement_id).toBe(carrierImp!.placement_id);

    // session_id continuous across the server legs (auction ↔ click).
    expect(start!.session_id).toBe(SESSION_ID);
    expect(clickEvent!.session_id).toBe(SESSION_ID);

    // --- LEG 3: conversion + revenue (server postback) --------------------------
    const CONVERSION_ID = "txn-chain-1";
    const cap = ctxCapture();
    const pbReq = new Request("http://one.example.com/lg/pb/testprov", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Postback-Token": POSTBACK_TOKEN },
      body: JSON.stringify({ external_txn_id: CONVERSION_ID, click_id: clickId, offer_public_id: offer.offer_public_id, revenue: 12.5, currency: "USD" }),
    });
    const pbRes = await ingestProviderPostback(env, cap.ctx, "testprov", pbReq, { chClient: fakeChClient() });
    expect(pbRes.status).toBe(200);
    await settle(cap.promises);

    const streamed = fetchStub.firehoseRecords as unknown as Array<Record<string, unknown>>;
    const conversion = streamed.find((r) => r.event_type === "conversion");
    const revenue = streamed.find((r) => r.event_type === "revenue_received");
    expect(conversion, "conversion must be emitted by the postback").toBeDefined();
    expect(revenue, "revenue_received must be emitted by the postback").toBeDefined();

    // revenue joins back to the click via click_id, and the conversion carries the
    // conversion_id (external txn) — the §10.3 revenue join.
    expect(conversion!.click_id).toBe(clickId);
    expect(conversion!.conversion_id).toBe(CONVERSION_ID);
    expect(revenue!.click_id).toBe(clickId);
    expect(revenue!.conversion_id).toBe(CONVERSION_ID);
    expect(revenue!.revenue).toBe(12.5);

    // The revenue booking also landed in D1 keyed on the SAME click_id (§29).
    const revRow = (await env.DB.prepare(
      "SELECT click_id FROM leadgen_revenue_raw WHERE click_id = ?",
    )
      .bind(clickId)
      .first()) as { click_id: string } | null;
    expect(revRow, "the booked conversion must persist to leadgen_revenue_raw on the same click_id").not.toBeNull();
  });

  it("documents the server-owned vs client-beacon chain legs (coverage honesty)", () => {
    // Server-owned legs asserted end-to-end above (real surfaces, real D1 joins):
    const serverOwned = ["auction", "impression_row(server-built)", "click", "conversion", "revenue"];
    // Client-beacon legs (browser-fired; envelope + /lg/track acceptance proven in
    // leadgen-analytics-producers.test.ts — the runtime bundle is byte-frozen so it
    // cannot be unit-driven here):
    const clientBeacon = ["quote_view", "section_view", "answer_*", "quote_complete", "impression beacon (from server rows)"];
    expect(serverOwned.length).toBe(5);
    expect(clientBeacon.length).toBeGreaterThan(0);
  });
});
