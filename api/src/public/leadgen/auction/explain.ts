// LeadGen auction explainability (contract 07 §19.2 + the
// `leadgen_auction_result_log` DDL, 0036:271-281). PURE builder Stage B fills
// as the §19 pipeline runs and `/auctions/:id/simulate` returns as a dry-run.
//
// The result-log ROW columns are EXACTLY the 0036 DDL: offers considered /
// excluded[{offer_id,reason}] / carriers_shown[{carrier_key,offer_id,bid,slot}]
// / winner{offer_id,logic,score} / banner_render_ids[] / unfilled_reason. The
// §19.2 view additionally surfaces provider requested/responded + carriers
// filtered — those are NOT result-log columns (they live in
// leadgen_provider_request_log + the carrier_filtered_reason event field), so
// the trace carries them for the /simulate response while `toResultLogRow`
// serializes ONLY the DDL columns.
//
// §29 (issue 31): every reason is a DEDICATED field
// (offers_excluded[].reason, carriers_filtered[].carrier_filtered_reason,
// unfilled_reason) — NEVER encoded in answer_value_normalized. This builder
// keeps reasons in their own fields by construction.

import type {
  LeadgenAuctionConsideredOffer,
  LeadgenAuctionExcludedOffer,
  LeadgenAuctionShownCarrier,
  LeadgenAuctionWinner,
} from "../../../admin/leadgen/db-types";

// §19.2 carriers-filtered entry (dedicated reason field, issue 31). Distinct
// from offers_excluded: a CARRIER (not an Offer) removed post-parse (floor /
// carrier rules / missing_required_response_field), keyed by carrier_key.
export interface ExplainFilteredCarrier {
  carrier_key: string;
  offer_id: string;
  carrier_filtered_reason: string;
}

// §19.2 "requested (payload + redacted headers)" — the auction-side reference
// to a provider_request_log row (the redacted payload/headers live there).
export interface ExplainProviderRequested {
  offer_id: string;
  provider_request_id: string;
  environment: string;
}

// §19.2 "responded (status/latency)".
export interface ExplainProviderResponded {
  offer_id: string;
  provider_request_id: string;
  status: number | null;
  latency_ms: number | null;
  provider_error_reason: string | null;
}

// 0062 offer waterfall: which waterfall owned this visitor's share of the
// traffic and what each tier did. outcome per tier:
//   shown               — the tier rendered; the visitor sees only this tier
//   no_result           — its offers were tried and showed nothing
//   no_qualifying_offer — none of its offers qualified (rules/caps/readiness), no call
//   not_reached         — a tier above was shown, so this one was never called
export interface AuctionWaterfallTrace {
  rule_id: string;
  traffic_share_pct: number;
  // The visitor's bucket 0..9999 (null when the Simulator forced the path).
  bucket: number | null;
  forced: boolean;
  // false = in this waterfall's share but its IF conditions did not match:
  // the visitor got the normal auction.
  conditions_matched: boolean;
  served_tier: number | null;
  tiers: Array<{ tier: number; offer_ids: string[]; outcome: "shown" | "no_result" | "no_qualifying_offer" | "not_reached" }>;
}

// The full §19.2 explainability trace. The result-log columns
// (auction_instance_id … unfilled_reason) plus the join-surfaced §19.2 extras.
export interface AuctionExplainTrace {
  auction_instance_id: string;
  auction_result_id: string;
  auction_config_id: string;
  session_id: string | null;
  funnel_attempt_id: string | null;
  funnel_id: string | null;
  funnel_variant_id: string | null;
  offers_considered: LeadgenAuctionConsideredOffer[];
  offers_excluded: LeadgenAuctionExcludedOffer[];
  carriers_shown: LeadgenAuctionShownCarrier[];
  winner: LeadgenAuctionWinner | null;
  banner_render_ids: string[];
  unfilled_reason: string | null;
  // §19.2 extras (surfaced from provider_request_log + carrier_filtered events;
  // NOT result-log columns).
  carriers_filtered: ExplainFilteredCarrier[];
  providers_requested: ExplainProviderRequested[];
  providers_responded: ExplainProviderResponded[];
  // 0062 (result-log column waterfall_json); null when no waterfall applied.
  waterfall: AuctionWaterfallTrace | null;
}

// The identity fields a trace always needs; everything else defaults empty so
// Stage B can build the trace incrementally as the pipeline advances.
export interface ExplainTraceInput {
  auction_instance_id: string;
  auction_result_id: string;
  auction_config_id: string;
  session_id?: string | null;
  funnel_attempt_id?: string | null;
  funnel_id?: string | null;
  funnel_variant_id?: string | null;
  offers_considered?: readonly LeadgenAuctionConsideredOffer[];
  offers_excluded?: readonly LeadgenAuctionExcludedOffer[];
  carriers_shown?: readonly LeadgenAuctionShownCarrier[];
  winner?: LeadgenAuctionWinner | null;
  banner_render_ids?: readonly string[];
  unfilled_reason?: string | null;
  carriers_filtered?: readonly ExplainFilteredCarrier[];
  providers_requested?: readonly ExplainProviderRequested[];
  providers_responded?: readonly ExplainProviderResponded[];
  waterfall?: AuctionWaterfallTrace | null;
}

// Assemble the §19.2 trace from whatever the pipeline has recorded so far.
// Pure + deterministic: absent collections default to empty arrays, absent
// winner to null. Reasons stay in their dedicated fields.
export function buildExplainTrace(input: ExplainTraceInput): AuctionExplainTrace {
  return {
    auction_instance_id: input.auction_instance_id,
    auction_result_id: input.auction_result_id,
    auction_config_id: input.auction_config_id,
    session_id: input.session_id ?? null,
    funnel_attempt_id: input.funnel_attempt_id ?? null,
    funnel_id: input.funnel_id ?? null,
    funnel_variant_id: input.funnel_variant_id ?? null,
    offers_considered: [...(input.offers_considered ?? [])],
    offers_excluded: [...(input.offers_excluded ?? [])],
    carriers_shown: [...(input.carriers_shown ?? [])],
    winner: input.winner ?? null,
    banner_render_ids: [...(input.banner_render_ids ?? [])],
    unfilled_reason: input.unfilled_reason ?? null,
    carriers_filtered: [...(input.carriers_filtered ?? [])],
    providers_requested: [...(input.providers_requested ?? [])],
    providers_responded: [...(input.providers_responded ?? [])],
    waterfall: input.waterfall ?? null,
  };
}

// The persistable leadgen_auction_result_log row (0036:271-281): the JSON
// columns pre-serialized. Stage B binds these directly on INSERT.
export interface AuctionResultLogRowInsert {
  auction_instance_id: string;
  auction_result_id: string;
  auction_config_id: string;
  session_id: string | null;
  funnel_attempt_id: string | null;
  funnel_id: string | null;
  funnel_variant_id: string | null;
  banner_render_ids_json: string;
  offers_considered_json: string;
  offers_excluded_json: string;
  carriers_shown_json: string;
  winner_json: string | null;
  unfilled_reason: string | null;
  // 0062; null when no waterfall applied (the column is then not written, so a
  // database without the migration keeps working).
  waterfall_json: string | null;
}

// Serialize a trace to the EXACT leadgen_auction_result_log DDL columns (only
// those columns — the §19.2 extras are dropped, they are not result-log
// columns). Arrays serialize to JSON (empty → "[]"); winner → JSON or null;
// unfilled_reason passes through. Round-trips against LeadgenAuctionResultLogApi.
export function toResultLogRow(trace: AuctionExplainTrace): AuctionResultLogRowInsert {
  return {
    auction_instance_id: trace.auction_instance_id,
    auction_result_id: trace.auction_result_id,
    auction_config_id: trace.auction_config_id,
    session_id: trace.session_id,
    funnel_attempt_id: trace.funnel_attempt_id,
    funnel_id: trace.funnel_id,
    funnel_variant_id: trace.funnel_variant_id,
    banner_render_ids_json: JSON.stringify(trace.banner_render_ids),
    offers_considered_json: JSON.stringify(trace.offers_considered),
    offers_excluded_json: JSON.stringify(trace.offers_excluded),
    carriers_shown_json: JSON.stringify(trace.carriers_shown),
    winner_json: trace.winner === null ? null : JSON.stringify(trace.winner),
    unfilled_reason: trace.unfilled_reason,
    waterfall_json: trace.waterfall === null ? null : JSON.stringify(trace.waterfall),
  };
}
