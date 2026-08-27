// LeadGen PURE auction-core engine (contract 07 §18). Phase 9 STAGE A.
//
// These are the deterministic, I/O-free primitives the Phase 10 `/lg/auction`
// runtime composes in the §19 pipeline order (steps 9-16): floor → carrier
// rules → winner logic → surfacing → multi_offer/limits → remove-clicked →
// backfill. Nothing here fetches providers, reads the DB, mints ids, or
// touches FX rates — every function takes ALREADY-PARSED carriers whose `bid`
// is ALREADY USD-NORMALIZED to a definite non-negative number.
//
// FX-normalization delegation (07 §18.4 "bids USD-normalized via
// leadgen_fx_rates"): converting a provider's native-currency bid to USD is
// the Phase 10 caller's job (it owns leadgen_fx_rates). By the time a carrier
// reaches auction-core its `bid` is the USD amount, and the §18.4
// "zero/invalid/missing bids parse to 0" collapse has already happened in
// parse.ts (`extractBid`). auction-core therefore treats `bid` as a plain
// non-negative USD number: 0 means no/invalid bid (excluded from avg/sum;
// an all-zero Offer is `no_bid`).
//
// Carrier shape: auction-core reuses the canonical parse.ts Carrier identity
// (07 §18.8 `carrier_key`) rather than re-implementing it — `AuctionCarrier`
// is the minimal projection the engine needs (carrier_key + USD bid) plus the
// participating Offer's public id. `toAuctionCarrier` is the documented bridge
// from a `LeadgenParsedCarrier` (parse.ts) so no divergent Carrier type is
// introduced.

import type {
  LeadgenBackfillMode,
  LeadgenFloorType,
  LeadgenMultiOfferMode,
  LeadgenRemovalScope,
  LeadgenWinnerLogic,
} from "../admin/leadgen/db-types";
import type { LeadgenParsedCarrier } from "../public/leadgen/auction/parse";

// ---------------------------------------------------------------------------
// Carrier + settings types (mirror the parse.ts Carrier + the 0036
// leadgen_auctions DDL columns the engine honors)
// ---------------------------------------------------------------------------

// The subset of the canonical parse.ts Carrier the pure engine consumes:
// `carrier_key` (07 §18.8 identity) + a USD-normalized non-negative `bid`,
// associated with its participating Offer via `offer_public_id`. Any full
// `LeadgenParsedCarrier` (once its bid is USD-normalized and its Offer known)
// is assignable to this shape — see `toAuctionCarrier`.
export interface AuctionCarrier {
  carrier_key: string;
  // USD-normalized, non-negative (07 §18.4). 0 = no/invalid bid.
  bid: number;
  // The participating Offer this carrier was parsed from (public_id "lgo_…").
  offer_public_id: string;
}

// Bridge a canonical parse.ts carrier into the auction-core projection. The
// USD bid + Offer association are supplied by the Phase 10 caller (FX + the
// offer→carrier grouping are its responsibility); the carrier_key is carried
// through verbatim (07 §18.8). Proves auction-core does NOT re-implement the
// Carrier shape — it consumes parse.ts's.
export function toAuctionCarrier(
  carrier: Pick<LeadgenParsedCarrier, "carrier_key">,
  offer_public_id: string,
  usdBid: number,
): AuctionCarrier {
  const bid = Number.isFinite(usdBid) && usdBid > 0 ? usdBid : 0;
  return { carrier_key: carrier.carrier_key, bid, offer_public_id };
}

// One participating Offer + its eligible carriers (post-floor + post-carrier-
// rules, as decided by the Phase 10 caller). `bid_source` distinguishes the
// CPC auction Offers from the static/CPL-bid Offers surfaced alongside the
// winner (07 §18.2).
export type AuctionBidSource = "cpc" | "static";

export interface AuctionOffer {
  offer_public_id: string;
  carriers: readonly AuctionCarrier[];
}

export interface SurfaceOffer extends AuctionOffer {
  bid_source: AuctionBidSource;
}

// Engine-relevant subset of the leadgen_auctions DDL (0036 lines 216-231),
// typed via the db-types CHECK-derived unions. The Phase 10 caller maps a
// `LeadgenAuctionRow` onto this shape.
export interface AuctionCoreSettings {
  winner_logic: LeadgenWinnerLogic;
  floor_type: LeadgenFloorType;
  floor_value: number;
  multi_offer: LeadgenMultiOfferMode;
  surface_static_bid_offers: boolean;
  banner_slots_count: number;
  max_carriers_per_offer: number;
  max_total_carriers: number;
  backfill: LeadgenBackfillMode;
  removal_scope: LeadgenRemovalScope;
}

// ---------------------------------------------------------------------------
// §18.3 Floor
// ---------------------------------------------------------------------------

export interface FloorResult {
  // The computed floor bid (USD). `percentage_of_max`: maxEligibleBid ×
  // floor_value/100. `absolute_bid`: floor_value.
  floor: number;
  // bid >= floor — qualified for the winner calc + primary surfacing.
  qualified: AuctionCarrier[];
  // bid < floor — NOT qualified; available only for backfill (07 §18.3).
  below_floor: AuctionCarrier[];
}

// 07 §18.3. `carriers` are the floor-eligible carriers (carrier EXCLUDE rules
// are applied PRE-floor by the caller, so excluded carriers never influence
// `maxBid`). `percentage_of_max` reads "Floor (% of top bid)": the floor is a
// single auction-wide value = the maximum bid across all passed carriers ×
// floor_value/100. `absolute_bid` reads "Floor (minimum bid)": floor =
// floor_value. Carriers with `bid < floor` are below-floor (backfill-only).
export function computeFloor(
  carriers: readonly AuctionCarrier[],
  floorType: LeadgenFloorType,
  floorValue: number,
): FloorResult {
  const value = Number.isFinite(floorValue) ? floorValue : 0;
  let floor: number;
  if (floorType === "absolute_bid") {
    floor = value;
  } else {
    // percentage_of_max — over the MAX eligible bid (0 if no carriers).
    const maxBid = carriers.reduce((m, c) => (c.bid > m ? c.bid : m), 0);
    floor = (maxBid * value) / 100;
  }
  const qualified: AuctionCarrier[] = [];
  const below_floor: AuctionCarrier[] = [];
  for (const carrier of carriers) {
    if (carrier.bid >= floor) qualified.push(carrier);
    else below_floor.push(carrier);
  }
  return { floor, qualified, below_floor };
}

// ---------------------------------------------------------------------------
// §18.4 Winner logic
// ---------------------------------------------------------------------------

export interface OfferScore {
  offer_public_id: string;
  score: number;
  // Tie-break metrics (07 §18.4): eligible = carriers with a positive bid.
  eligible_sum: number;
  eligible_count: number;
  // All-zero Offer — excluded from winner candidacy (07 §18.4 `no_bid`).
  no_bid: boolean;
}

export interface WinnerSelection {
  // Winning Offer's public id, or null when EVERY Offer is `no_bid`.
  winner: string | null;
  logic: LeadgenWinnerLogic;
  // The winning Offer's score (0 when there is no winner).
  score: number;
  // Per-Offer scores in input order — feeds §19.2 explainability + proves the
  // tie-break path taken.
  offer_scores: OfferScore[];
}

// Eligible bids for avg/sum: positive finite bids only (07 §18.4
// "zero/invalid/missing bids parse to 0 and are excluded from avg/sum").
function eligibleBids(offer: AuctionOffer): number[] {
  return offer.carriers.filter((c) => Number.isFinite(c.bid) && c.bid > 0).map((c) => c.bid);
}

function scoreOffer(offer: AuctionOffer, logic: LeadgenWinnerLogic): OfferScore {
  const bids = eligibleBids(offer);
  const eligible_count = bids.length;
  const eligible_sum = bids.reduce((s, b) => s + b, 0);
  const no_bid = eligible_count === 0;
  let score: number;
  if (no_bid) {
    score = 0;
  } else if (logic === "highest_bid") {
    score = bids.reduce((m, b) => (b > m ? b : m), 0);
  } else if (logic === "sum_bids") {
    score = eligible_sum;
  } else {
    // average_bid — highest per-Offer MEAN over eligible bids.
    score = eligible_sum / eligible_count;
  }
  return { offer_public_id: offer.offer_public_id, score, eligible_sum, eligible_count, no_bid };
}

// True when candidate `b` beats current best `a` under the 07 §18.4
// tie-breakers: higher score → higher eligible sum → more eligible carriers →
// lexicographically SMALLER offer_public_id.
function beats(b: OfferScore, a: OfferScore): boolean {
  if (b.score !== a.score) return b.score > a.score;
  if (b.eligible_sum !== a.eligible_sum) return b.eligible_sum > a.eligible_sum;
  if (b.eligible_count !== a.eligible_count) return b.eligible_count > a.eligible_count;
  return b.offer_public_id < a.offer_public_id;
}

// 07 §18.4 (NORMATIVE). `offers` carry their eligible carriers (post-floor +
// post-carrier-rules). Reproduces the §18.4 worked example for all three
// logics; `no_bid` Offers are excluded from candidacy; all-`no_bid` → winner
// null.
export function selectWinner(
  offers: readonly AuctionOffer[],
  winnerLogic: LeadgenWinnerLogic,
): WinnerSelection {
  const offer_scores = offers.map((offer) => scoreOffer(offer, winnerLogic));
  let best: OfferScore | null = null;
  for (const candidate of offer_scores) {
    if (candidate.no_bid) continue;
    if (best === null || beats(candidate, best)) best = candidate;
  }
  return {
    winner: best === null ? null : best.offer_public_id,
    logic: winnerLogic,
    score: best === null ? 0 : best.score,
    offer_scores,
  };
}

// ---------------------------------------------------------------------------
// §18.2 / §18.5 Surfacing + multi_offer + limits
// ---------------------------------------------------------------------------

export type SurfacedCarrierSource = "winner" | "multi_offer" | "static_bid" | "backfill";

export interface SurfacedCarrier {
  carrier_key: string;
  offer_public_id: string;
  bid: number;
  source: SurfacedCarrierSource;
  // 1-based render slot (07 §19 step 14 assigns one carrier_impression per slot).
  slot: number;
}

export type SurfaceSettings = Pick<
  AuctionCoreSettings,
  | "multi_offer"
  | "surface_static_bid_offers"
  | "max_carriers_per_offer"
  | "max_total_carriers"
  | "banner_slots_count"
>;

// bid DESC with a fully deterministic tie-break (offer_public_id asc, then
// carrier_key asc) so surfacing order never depends on input order.
function byBidDesc(a: AuctionCarrier, b: AuctionCarrier): number {
  if (b.bid !== a.bid) return b.bid - a.bid;
  if (a.offer_public_id !== b.offer_public_id) return a.offer_public_id < b.offer_public_id ? -1 : 1;
  if (a.carrier_key !== b.carrier_key) return a.carrier_key < b.carrier_key ? -1 : 1;
  return 0;
}

// Top-N carriers of one Offer by bid desc (07 §18.5 max_carriers_per_offer).
function capPerOffer(carriers: readonly AuctionCarrier[], maxPerOffer: number): AuctionCarrier[] {
  const limit = Number.isFinite(maxPerOffer) && maxPerOffer >= 0 ? Math.floor(maxPerOffer) : 0;
  return [...carriers].sort(byBidDesc).slice(0, limit);
}

// 07 §18.2 + §18.5. Builds the ordered, deduped, limit-capped carriers to
// render:
//   * multi_offer `disabled` → the winning Offer's carriers only;
//     `enabled` → all CPC Offers' carriers in bid order;
//     `enabled_unique` → same, deduped by carrier_key.
//   * when surface_static_bid_offers, the static/CPL-bid Offers' carriers are
//     surfaced alongside by bid desc, ALWAYS deduped by carrier_key against
//     the CPC pool (07 §18.2 CPL-merge default).
//   * limits: max_carriers_per_offer (per Offer) → max_total_carriers
//     (surfaced) → banner_slots_count (rendered). Final slot count is the
//     min of the last two.
export function surfaceCarriers(
  offers: readonly SurfaceOffer[],
  winnerOfferId: string | null,
  settings: SurfaceSettings,
): SurfacedCarrier[] {
  const cpcOffers = offers.filter((o) => o.bid_source === "cpc");
  const staticOffers = offers.filter((o) => o.bid_source === "static");

  // --- CPC pool (multi_offer) --------------------------------------------
  let cpcSource: SurfaceOffer[];
  if (settings.multi_offer === "disabled") {
    cpcSource = winnerOfferId === null ? [] : cpcOffers.filter((o) => o.offer_public_id === winnerOfferId);
  } else {
    cpcSource = cpcOffers;
  }
  const cpcRanked: Array<{ carrier: AuctionCarrier; source: SurfacedCarrierSource }> = [];
  for (const offer of cpcSource) {
    const source: SurfacedCarrierSource = offer.offer_public_id === winnerOfferId ? "winner" : "multi_offer";
    for (const carrier of capPerOffer(offer.carriers, settings.max_carriers_per_offer)) {
      cpcRanked.push({ carrier, source });
    }
  }
  // Order the whole CPC pool by bid desc (07 §18.5 "bid order"); a `winner`
  // tag wins an exact-bid tie so the winning Offer leads.
  cpcRanked.sort((a, b) => {
    const cmp = byBidDesc(a.carrier, b.carrier);
    if (cmp !== 0) return cmp;
    if (a.source === b.source) return 0;
    return a.source === "winner" ? -1 : b.source === "winner" ? 1 : 0;
  });

  const pool: Array<{ carrier: AuctionCarrier; source: SurfacedCarrierSource }> = [];
  const seenKeys = new Set<string>();
  const dedupeCpc = settings.multi_offer === "enabled_unique";
  for (const entry of cpcRanked) {
    if (dedupeCpc && seenKeys.has(entry.carrier.carrier_key)) continue;
    pool.push(entry);
    seenKeys.add(entry.carrier.carrier_key);
  }

  // --- static/CPL-bid merge (07 §18.2), always deduped by carrier_key -----
  if (settings.surface_static_bid_offers) {
    const staticRanked: AuctionCarrier[] = [];
    for (const offer of staticOffers) {
      for (const carrier of capPerOffer(offer.carriers, settings.max_carriers_per_offer)) {
        staticRanked.push(carrier);
      }
    }
    staticRanked.sort(byBidDesc);
    for (const carrier of staticRanked) {
      if (seenKeys.has(carrier.carrier_key)) continue; // CPL-merge dedupe
      pool.push({ carrier, source: "static_bid" });
      seenKeys.add(carrier.carrier_key);
    }
  }

  // --- limits: max_total_carriers then banner_slots_count -----------------
  const totalCap = Number.isFinite(settings.max_total_carriers) ? Math.floor(settings.max_total_carriers) : 0;
  const slotCap = Number.isFinite(settings.banner_slots_count) ? Math.floor(settings.banner_slots_count) : 0;
  const renderCap = Math.max(0, Math.min(totalCap, slotCap));

  return pool.slice(0, renderCap).map((entry, index) => ({
    carrier_key: entry.carrier.carrier_key,
    offer_public_id: entry.carrier.offer_public_id,
    bid: entry.carrier.bid,
    source: entry.source,
    slot: index + 1,
  }));
}

// ---------------------------------------------------------------------------
// §18.6 Backfill
// ---------------------------------------------------------------------------

function dedupeByKey(carriers: readonly AuctionCarrier[]): AuctionCarrier[] {
  const seen = new Set<string>();
  const out: AuctionCarrier[] = [];
  for (const carrier of carriers) {
    if (seen.has(carrier.carrier_key)) continue;
    seen.add(carrier.carrier_key);
    out.push(carrier);
  }
  return out;
}

// 07 §18.6 NORMATIVE "exhausted" test: at a trigger point the number of
// eligible AND unique (by carrier_key) carriers remaining — after rules, caps,
// floor, and already-rendered/clicked removal — is LESS THAN the number of
// empty banner slots (`banner_slots_count` minus rendered-unclicked). When
// true, some slots will stay empty (unfilled → `all_carriers_shown`).
export function backfillExhausted(
  remaining: readonly AuctionCarrier[],
  renderedUnclicked: number,
  bannerSlotsCount: number,
): boolean {
  const slots = Number.isFinite(bannerSlotsCount) ? Math.floor(bannerSlotsCount) : 0;
  const rendered = Number.isFinite(renderedUnclicked) ? Math.floor(renderedUnclicked) : 0;
  const emptySlots = Math.max(0, slots - rendered);
  return dedupeByKey(remaining).length < emptySlots;
}

export interface BackfillInput {
  // Eligible carriers not yet rendered (07 §18.6 remaining pool — the caller
  // composes qualified-remaining, then below-floor per §18.3).
  remaining: readonly AuctionCarrier[];
  // Already-rendered (unclicked) carriers — for the slot offset + key exclusion.
  rendered: readonly SurfacedCarrier[];
  mode: LeadgenBackfillMode;
  bannerSlotsCount: number;
  maxTotalCarriers: number;
}

// OWNER 2026-08-27 — why no banner filled. Each value is a DIFFERENT operator
// action, which is the whole point of separating them:
//   all_carriers_shown — the pool really was exhausted for this session
//   carriers_unparsed  — a provider answered with carriers we could not read
//                        (his case: a real 32.50 bid dropped because the parse
//                        config named identity fields the response lacks)
//   no_carriers_returned — every provider answered, none offered anything
export const LEADGEN_UNFILLED_REASONS = [
  "all_carriers_shown",
  "carriers_unparsed",
  "no_carriers_returned",
] as const;
export type LeadgenUnfilledReason = (typeof LEADGEN_UNFILLED_REASONS)[number];

export interface BackfillResult {
  // Carriers filling previously-empty slots (source `backfill`, slots continue
  // after the rendered ones).
  filled: SurfacedCarrier[];
  // Slots left empty after backfill.
  unfilled_slots: number;
  // 07 §18.6: set only when backfill ran but the eligible+unique pool was
  // exhausted before every empty slot filled.
  // OWNER 2026-08-27 — widened. "all_carriers_shown" was the ONLY value, and
  // engine.ts defaulted to it for every empty outcome, so his fresh-session
  // empty page reported that every carrier had already been shown when NOTHING
  // had ever been shown. A reason an operator cannot trust is worse than none.
  unfilled_reason: LeadgenUnfilledReason | null;
}

// 07 §18.6. `disabled` → no backfill attempted (never `all_carriers_shown`).
// `enabled`/`enabled_unique` fill empty slots from `remaining` (excluding
// already-rendered carrier_keys, deduped by carrier_key for `enabled_unique`),
// by bid desc, up to `max_total_carriers`. When the pool is exhausted before
// the slots fill, the remaining empty slots carry reason `all_carriers_shown`.
export function applyBackfill(input: BackfillInput): BackfillResult {
  const slots = Number.isFinite(input.bannerSlotsCount) ? Math.floor(input.bannerSlotsCount) : 0;
  const emptySlots = Math.max(0, slots - input.rendered.length);

  if (input.mode === "disabled" || emptySlots === 0) {
    return { filled: [], unfilled_slots: emptySlots, unfilled_reason: null };
  }

  const renderedKeys = new Set(input.rendered.map((c) => c.carrier_key));
  let pool = input.remaining.filter((c) => !renderedKeys.has(c.carrier_key));
  if (input.mode === "enabled_unique") pool = dedupeByKey(pool);
  pool = [...pool].sort(byBidDesc);

  const totalCap = Number.isFinite(input.maxTotalCarriers) ? Math.floor(input.maxTotalCarriers) : 0;
  const remainingTotalCapacity = Math.max(0, totalCap - input.rendered.length);
  const capacity = Math.min(emptySlots, remainingTotalCapacity);

  const filled: SurfacedCarrier[] = pool.slice(0, capacity).map((carrier, index) => ({
    carrier_key: carrier.carrier_key,
    offer_public_id: carrier.offer_public_id,
    bid: carrier.bid,
    source: "backfill",
    slot: input.rendered.length + index + 1,
  }));

  const unfilled_slots = emptySlots - filled.length;
  // 07 §18.6 `all_carriers_shown` is the POOL-EXHAUSTION reason: slots stayed
  // empty because no eligible+unique carrier remained. Slots left empty only
  // because the max_total_carriers cap was hit (pool still had carriers) are
  // NOT `all_carriers_shown`.
  const poolExhausted = filled.length === pool.length;
  return {
    filled,
    unfilled_slots,
    unfilled_reason: unfilled_slots > 0 && poolExhausted ? ("all_carriers_shown" as const) : null,
  };
}

// ---------------------------------------------------------------------------
// §18.7 Remove-clicked
// ---------------------------------------------------------------------------

// One clicked record (leadgen_session_clicked_offers). `carrier_key` is ''
// when removal_scope=offer (DDL default), the concrete key when scope=carrier.
export interface ClickedRef {
  offer_public_id: string;
  carrier_key: string;
}

// 07 §18.7. `offer` scope suppresses the WHOLE clicked Offer; `carrier` scope
// suppresses only the clicked carrier_key. Consulted on backfill + subsequent
// instances in the session.
export function applyRemoveClicked(
  carriers: readonly AuctionCarrier[],
  clicked: readonly ClickedRef[],
  removalScope: LeadgenRemovalScope,
): AuctionCarrier[] {
  if (removalScope === "offer") {
    const blockedOffers = new Set(clicked.map((c) => c.offer_public_id));
    return carriers.filter((c) => !blockedOffers.has(c.offer_public_id));
  }
  const blockedKeys = new Set(clicked.map((c) => c.carrier_key).filter((k) => k !== ""));
  return carriers.filter((c) => !blockedKeys.has(c.carrier_key));
}
