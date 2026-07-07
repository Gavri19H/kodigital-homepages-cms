// LeadGen Phase 10 STAGE A — auction explainability (contract 07 §19.2 +
// leadgen_auction_result_log DDL 0036:271-281). PURE builder. Proves: the
// trace assembles from partial pipeline state (empty defaults), the full §19.2
// shape (considered/excluded/carriers_shown/winner/filtered/requested/responded/
// banner_render_ids/unfilled_reason), every reason lives in a DEDICATED field
// (issue 31), and toResultLogRow serializes EXACTLY the DDL columns (round-trips
// against LeadgenAuctionResultLogApi; §19.2 extras are not result-log columns).

import { describe, expect, it } from "vitest";
import { buildExplainTrace, toResultLogRow } from "../src/public/leadgen/auction/explain";
import type {
  LeadgenAuctionConsideredOffer,
  LeadgenAuctionExcludedOffer,
  LeadgenAuctionResultLogApi,
  LeadgenAuctionShownCarrier,
  LeadgenAuctionWinner,
} from "../src/admin/leadgen/db-types";

const IDS = { auction_instance_id: "ai_1", auction_result_id: "ar_1", auction_config_id: "ac_1" };

const CONSIDERED: LeadgenAuctionConsideredOffer[] = [
  { offer_id: "lgo_x", placement_id: "lgpl_1" },
  { offer_id: "lgo_y", placement_id: "lgpl_2" },
];
const EXCLUDED: LeadgenAuctionExcludedOffer[] = [{ offer_id: "lgo_z", reason: "below_floor" }];
const SHOWN: LeadgenAuctionShownCarrier[] = [
  { carrier_key: "acme", offer_id: "lgo_x", bid: 12, slot: 1 },
  { carrier_key: "beta", offer_id: "lgo_y", bid: 9, slot: 2 },
];
const WINNER: LeadgenAuctionWinner = { offer_id: "lgo_x", logic: "highest_bid", score: 12 };

// ---------------------------------------------------------------------------
// buildExplainTrace
// ---------------------------------------------------------------------------

describe("buildExplainTrace — §19.2 trace assembly", () => {
  it("defaults every collection to empty and winner to null from the identity-only input", () => {
    const trace = buildExplainTrace(IDS);
    expect(trace.auction_instance_id).toBe("ai_1");
    expect(trace.offers_considered).toEqual([]);
    expect(trace.offers_excluded).toEqual([]);
    expect(trace.carriers_shown).toEqual([]);
    expect(trace.carriers_filtered).toEqual([]);
    expect(trace.providers_requested).toEqual([]);
    expect(trace.providers_responded).toEqual([]);
    expect(trace.banner_render_ids).toEqual([]);
    expect(trace.winner).toBeNull();
    expect(trace.unfilled_reason).toBeNull();
    expect(trace.session_id).toBeNull();
  });

  it("assembles the full §19.2 shape with reasons in DEDICATED fields (issue 31)", () => {
    const trace = buildExplainTrace({
      ...IDS,
      session_id: "sess_1",
      funnel_attempt_id: "fa_1",
      funnel_id: "lgf_1",
      funnel_variant_id: "lgn_1",
      offers_considered: CONSIDERED,
      offers_excluded: EXCLUDED,
      carriers_shown: SHOWN,
      winner: WINNER,
      banner_render_ids: ["brid_1"],
      unfilled_reason: "all_carriers_shown",
      carriers_filtered: [{ carrier_key: "gamma", offer_id: "lgo_x", carrier_filtered_reason: "missing_required_response_field" }],
      providers_requested: [{ offer_id: "lgo_x", provider_request_id: "prq_1", environment: "production" }],
      providers_responded: [{ offer_id: "lgo_x", provider_request_id: "prq_1", status: 200, latency_ms: 120, provider_error_reason: null }],
    });

    expect(trace.offers_considered).toEqual(CONSIDERED);
    expect(trace.carriers_shown).toEqual(SHOWN);
    expect(trace.winner).toEqual(WINNER);
    expect(trace.banner_render_ids).toEqual(["brid_1"]);

    // reasons live in their OWN fields — never encoded elsewhere
    expect(trace.offers_excluded[0]?.reason).toBe("below_floor");
    expect(trace.carriers_filtered[0]?.carrier_filtered_reason).toBe("missing_required_response_field");
    expect(trace.unfilled_reason).toBe("all_carriers_shown");
    expect(trace.providers_responded[0]?.status).toBe(200);
  });

  it("copies input collections (mutating the input arrays afterward never mutates the trace)", () => {
    const considered = [...CONSIDERED];
    const trace = buildExplainTrace({ ...IDS, offers_considered: considered });
    considered.push({ offer_id: "lgo_extra", placement_id: "lgpl_9" });
    expect(trace.offers_considered).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// toResultLogRow — leadgen_auction_result_log DDL columns
// ---------------------------------------------------------------------------

describe("toResultLogRow — leadgen_auction_result_log serialization (0036:271-281)", () => {
  it("serializes EXACTLY the DDL columns; §19.2 extras are NOT result-log columns", () => {
    const trace = buildExplainTrace({
      ...IDS,
      session_id: "sess_1",
      offers_considered: CONSIDERED,
      offers_excluded: EXCLUDED,
      carriers_shown: SHOWN,
      winner: WINNER,
      banner_render_ids: ["brid_1", "brid_2"],
      unfilled_reason: null,
      carriers_filtered: [{ carrier_key: "gamma", offer_id: "lgo_x", carrier_filtered_reason: "device" }],
      providers_requested: [{ offer_id: "lgo_x", provider_request_id: "prq_1", environment: "staging" }],
    });
    const row = toResultLogRow(trace);

    // exactly the DDL column set — no §19.2-only keys leaked in
    expect(Object.keys(row).sort()).toEqual(
      [
        "auction_config_id",
        "auction_instance_id",
        "auction_result_id",
        "banner_render_ids_json",
        "carriers_shown_json",
        "funnel_attempt_id",
        "funnel_id",
        "funnel_variant_id",
        "offers_considered_json",
        "offers_excluded_json",
        "session_id",
        "unfilled_reason",
        "winner_json",
      ].sort(),
    );
    expect(row).not.toHaveProperty("carriers_filtered_json");
    expect(row).not.toHaveProperty("providers_requested_json");
  });

  it("round-trips the JSON columns back to the LeadgenAuctionResultLogApi arrays", () => {
    const trace = buildExplainTrace({
      ...IDS,
      offers_considered: CONSIDERED,
      offers_excluded: EXCLUDED,
      carriers_shown: SHOWN,
      winner: WINNER,
      banner_render_ids: ["brid_1"],
    });
    const row = toResultLogRow(trace);

    const parsed: Pick<
      LeadgenAuctionResultLogApi,
      "offers_considered_json" | "offers_excluded_json" | "carriers_shown_json" | "winner_json" | "banner_render_ids_json"
    > = {
      offers_considered_json: JSON.parse(row.offers_considered_json) as LeadgenAuctionConsideredOffer[],
      offers_excluded_json: JSON.parse(row.offers_excluded_json) as LeadgenAuctionExcludedOffer[],
      carriers_shown_json: JSON.parse(row.carriers_shown_json) as LeadgenAuctionShownCarrier[],
      winner_json: row.winner_json === null ? null : (JSON.parse(row.winner_json) as LeadgenAuctionWinner),
      banner_render_ids_json: JSON.parse(row.banner_render_ids_json) as string[],
    };
    expect(parsed.offers_considered_json).toEqual(CONSIDERED);
    expect(parsed.offers_excluded_json).toEqual(EXCLUDED);
    expect(parsed.carriers_shown_json).toEqual(SHOWN);
    expect(parsed.winner_json).toEqual(WINNER);
    expect(parsed.banner_render_ids_json).toEqual(["brid_1"]);
  });

  it("empty collections serialize to '[]' and a null winner to null", () => {
    const row = toResultLogRow(buildExplainTrace(IDS));
    expect(row.offers_considered_json).toBe("[]");
    expect(row.carriers_shown_json).toBe("[]");
    expect(row.banner_render_ids_json).toBe("[]");
    expect(row.winner_json).toBeNull();
    expect(row.unfilled_reason).toBeNull();
  });
});
