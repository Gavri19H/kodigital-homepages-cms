// LeadGen Phase 9 STAGE A — PURE auction-core engine (contract 07 §18).
// Freezes the §18.4 worked example as a golden test for all three winner
// logics, plus floor partition, multi_offer + limits, backfill exhaustion,
// remove-clicked scopes, CPL-merge dedupe, and every tie-breaker branch.

import { describe, expect, it } from "vitest";
import {
  applyBackfill,
  applyRemoveClicked,
  backfillExhausted,
  computeFloor,
  selectWinner,
  surfaceCarriers,
  toAuctionCarrier,
  type AuctionCarrier,
  type AuctionOffer,
  type SurfaceOffer,
  type SurfaceSettings,
} from "../src/leadgen/auction-core";
import type { LeadgenParsedCarrier } from "../src/public/leadgen/auction/parse";

// Minimal AuctionCarrier factory.
function c(offer_public_id: string, carrier_key: string, bid: number): AuctionCarrier {
  return { offer_public_id, carrier_key, bid };
}

// ---------------------------------------------------------------------------
// §18.4 WORKED EXAMPLE — frozen golden test (all 3 winner logics)
// percentage_of_max floor_value=10: X[A 12, B 3], Y[C 9, D 8, E 7.5], Z[F 11]
//   → highest_bid → X, average_bid → Z, sum_bids → Y
// ---------------------------------------------------------------------------

const X: AuctionOffer = { offer_public_id: "offer_x", carriers: [c("offer_x", "A", 12), c("offer_x", "B", 3)] };
const Y: AuctionOffer = {
  offer_public_id: "offer_y",
  carriers: [c("offer_y", "C", 9), c("offer_y", "D", 8), c("offer_y", "E", 7.5)],
};
const Z: AuctionOffer = { offer_public_id: "offer_z", carriers: [c("offer_z", "F", 11)] };
const WORKED_EXAMPLE = [X, Y, Z];

describe("§18.4 worked example (frozen golden)", () => {
  it("floor percentage_of_max=10 → floor 1.2, every carrier qualifies", () => {
    const all = [...X.carriers, ...Y.carriers, ...Z.carriers];
    const floor = computeFloor(all, "percentage_of_max", 10);
    expect(floor.floor).toBeCloseTo(1.2, 10); // 12 (max) × 10/100
    expect(floor.qualified).toHaveLength(6);
    expect(floor.below_floor).toHaveLength(0);
  });

  it("highest_bid → X (single highest bid 12)", () => {
    const r = selectWinner(WORKED_EXAMPLE, "highest_bid");
    expect(r.winner).toBe("offer_x");
    expect(r.score).toBe(12);
  });

  it("average_bid → Z (highest per-Offer mean 11)", () => {
    const r = selectWinner(WORKED_EXAMPLE, "average_bid");
    expect(r.winner).toBe("offer_z");
    expect(r.score).toBeCloseTo(11, 10);
    // X mean = 7.5, Y mean = 8.1667, Z mean = 11.
    const meanOf = (id: string): number => r.offer_scores.find((s) => s.offer_public_id === id)?.score ?? -1;
    expect(meanOf("offer_x")).toBeCloseTo(7.5, 10);
    expect(meanOf("offer_y")).toBeCloseTo(24.5 / 3, 10);
    expect(meanOf("offer_z")).toBeCloseTo(11, 10);
  });

  it("sum_bids → Y (highest per-Offer sum 24.5)", () => {
    const r = selectWinner(WORKED_EXAMPLE, "sum_bids");
    expect(r.winner).toBe("offer_y");
    expect(r.score).toBeCloseTo(24.5, 10);
  });
});

// ---------------------------------------------------------------------------
// §18.3 Floor — both types + below-floor partition
// ---------------------------------------------------------------------------

describe("computeFloor (§18.3)", () => {
  it("percentage_of_max partitions below-floor (floor 50% of top bid 12 = 6)", () => {
    const all = [c("o", "a", 12), c("o", "b", 3), c("o", "c", 6), c("o", "d", 5.99)];
    const r = computeFloor(all, "percentage_of_max", 50);
    expect(r.floor).toBe(6);
    expect(r.qualified.map((x) => x.carrier_key).sort()).toEqual(["a", "c"]); // >= 6
    expect(r.below_floor.map((x) => x.carrier_key).sort()).toEqual(["b", "d"]); // < 6
  });

  it("absolute_bid floor = floor_value (8)", () => {
    const all = [c("o", "a", 12), c("o", "b", 8), c("o", "c", 7.99)];
    const r = computeFloor(all, "absolute_bid", 8);
    expect(r.floor).toBe(8);
    expect(r.qualified.map((x) => x.carrier_key)).toEqual(["a", "b"]); // >= 8 (inclusive)
    expect(r.below_floor.map((x) => x.carrier_key)).toEqual(["c"]);
  });

  it("empty carriers → floor 0, no partitions", () => {
    const r = computeFloor([], "percentage_of_max", 10);
    expect(r.floor).toBe(0);
    expect(r.qualified).toEqual([]);
    expect(r.below_floor).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §18.4 tie-breakers + zero/no_bid handling
// ---------------------------------------------------------------------------

describe("selectWinner tie-breakers (§18.4)", () => {
  it("equal highest_bid → higher eligible SUM wins", () => {
    const p: AuctionOffer = { offer_public_id: "p", carriers: [c("p", "p1", 10), c("p", "p2", 2)] }; // sum 12
    const q: AuctionOffer = { offer_public_id: "q", carriers: [c("q", "q1", 10), c("q", "q2", 5)] }; // sum 15
    const r = selectWinner([p, q], "highest_bid");
    expect(r.winner).toBe("q"); // same max 10, higher sum
  });

  it("equal score + equal sum → MORE eligible carriers wins", () => {
    const p: AuctionOffer = { offer_public_id: "p", carriers: [c("p", "p1", 10), c("p", "p2", 5)] }; // sum 15, count 2
    const q: AuctionOffer = { offer_public_id: "q", carriers: [c("q", "q1", 10), c("q", "q2", 3), c("q", "q3", 2)] }; // sum 15, count 3
    const r = selectWinner([p, q], "highest_bid");
    expect(r.winner).toBe("q"); // same max 10, same sum 15, more carriers
  });

  it("all metrics equal → lexicographically SMALLER offer_public_id wins", () => {
    const bbb: AuctionOffer = { offer_public_id: "bbb", carriers: [c("bbb", "x", 10)] };
    const aaa: AuctionOffer = { offer_public_id: "aaa", carriers: [c("aaa", "y", 10)] };
    // input order bbb-first to prove the tie-break, not input order, decides.
    const r = selectWinner([bbb, aaa], "highest_bid");
    expect(r.winner).toBe("aaa");
  });

  it("zero/invalid bids excluded from avg/sum; all-zero Offer = no_bid", () => {
    const withZeros: AuctionOffer = {
      offer_public_id: "mix",
      carriers: [c("mix", "m1", 10), c("mix", "m2", 0), c("mix", "m3", 5)],
    };
    const sum = selectWinner([withZeros], "sum_bids");
    expect(sum.score).toBe(15); // 10 + 5, the 0 excluded
    const avg = selectWinner([withZeros], "average_bid");
    expect(avg.score).toBeCloseTo(7.5, 10); // (10+5)/2, not /3

    const allZero: AuctionOffer = { offer_public_id: "z", carriers: [c("z", "z1", 0), c("z", "z2", 0)] };
    const r = selectWinner([allZero], "highest_bid");
    expect(r.winner).toBeNull();
    expect(r.offer_scores[0]?.no_bid).toBe(true);
  });

  it("every Offer no_bid → winner null, score 0", () => {
    const a: AuctionOffer = { offer_public_id: "a", carriers: [c("a", "a1", 0)] };
    const b: AuctionOffer = { offer_public_id: "b", carriers: [] };
    const r = selectWinner([a, b], "sum_bids");
    expect(r.winner).toBeNull();
    expect(r.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §18.5 multi_offer + surfacing + limits
// ---------------------------------------------------------------------------

const baseSettings: SurfaceSettings = {
  multi_offer: "disabled",
  surface_static_bid_offers: false,
  max_carriers_per_offer: 10,
  max_total_carriers: 100,
  banner_slots_count: 100,
};

describe("surfaceCarriers multi_offer + limits (§18.5 / §18.2)", () => {
  const W: SurfaceOffer = {
    offer_public_id: "W",
    bid_source: "cpc",
    carriers: [c("W", "w1", 10), c("W", "w2", 8), c("W", "w3", 6)],
  };
  const O: SurfaceOffer = {
    offer_public_id: "O",
    bid_source: "cpc",
    carriers: [c("O", "o1", 9), c("O", "o2", 5)],
  };

  it("disabled → winner Offer carriers only, bid desc", () => {
    const r = surfaceCarriers([W, O], "W", { ...baseSettings, multi_offer: "disabled" });
    expect(r.map((s) => s.carrier_key)).toEqual(["w1", "w2", "w3"]);
    expect(r.every((s) => s.source === "winner")).toBe(true);
    expect(r.map((s) => s.slot)).toEqual([1, 2, 3]);
  });

  it("enabled → ALL cpc carriers in bid order (winner tagged)", () => {
    const r = surfaceCarriers([W, O], "W", { ...baseSettings, multi_offer: "enabled" });
    expect(r.map((s) => s.carrier_key)).toEqual(["w1", "o1", "w2", "w3", "o2"]); // 10,9,8,6,5
    expect(r.find((s) => s.carrier_key === "w1")?.source).toBe("winner");
    expect(r.find((s) => s.carrier_key === "o1")?.source).toBe("multi_offer");
  });

  it("enabled_unique → dedupe by carrier_key (higher bid wins)", () => {
    const wDup: SurfaceOffer = { offer_public_id: "W", bid_source: "cpc", carriers: [c("W", "dup", 8)] };
    const oDup: SurfaceOffer = { offer_public_id: "O", bid_source: "cpc", carriers: [c("O", "dup", 9)] };
    const enabled = surfaceCarriers([wDup, oDup], "W", { ...baseSettings, multi_offer: "enabled" });
    expect(enabled.map((s) => s.carrier_key)).toEqual(["dup", "dup"]); // both shown
    const unique = surfaceCarriers([wDup, oDup], "W", { ...baseSettings, multi_offer: "enabled_unique" });
    expect(unique).toHaveLength(1);
    expect(unique[0]?.bid).toBe(9); // higher-bid instance kept
  });

  it("max_carriers_per_offer caps per Offer", () => {
    const r = surfaceCarriers([W], "W", { ...baseSettings, multi_offer: "disabled", max_carriers_per_offer: 2 });
    expect(r.map((s) => s.carrier_key)).toEqual(["w1", "w2"]); // top 2 of W
  });

  it("max_total_carriers caps the total surfaced", () => {
    const r = surfaceCarriers([W, O], "W", { ...baseSettings, multi_offer: "enabled", max_total_carriers: 2 });
    expect(r.map((s) => s.carrier_key)).toEqual(["w1", "o1"]); // top 2 overall
  });

  it("banner_slots_count caps the rendered slots", () => {
    const r = surfaceCarriers([W, O], "W", { ...baseSettings, multi_offer: "enabled", banner_slots_count: 1 });
    expect(r).toHaveLength(1);
    expect(r[0]?.carrier_key).toBe("w1");
  });
});

describe("surfaceCarriers §18.2 CPL-merge (static/CPL Offers)", () => {
  const W: SurfaceOffer = { offer_public_id: "W", bid_source: "cpc", carriers: [c("W", "acme", 10)] };
  const S: SurfaceOffer = {
    offer_public_id: "S",
    bid_source: "static",
    carriers: [c("S", "acme", 7), c("S", "geico", 4)],
  };

  it("surface_static_bid_offers=false → static Offers NOT surfaced", () => {
    const r = surfaceCarriers([W, S], "W", { ...baseSettings, multi_offer: "disabled", surface_static_bid_offers: false });
    expect(r.map((s) => s.carrier_key)).toEqual(["acme"]);
    expect(r[0]?.source).toBe("winner");
  });

  it("surface_static=true → static surfaced by bid desc, deduped by carrier_key against CPC", () => {
    const r = surfaceCarriers([W, S], "W", { ...baseSettings, multi_offer: "disabled", surface_static_bid_offers: true });
    // acme(static,7) is a carrier_key dup of the CPC acme → dropped; geico stays.
    expect(r.map((s) => s.carrier_key)).toEqual(["acme", "geico"]);
    expect(r.find((s) => s.carrier_key === "acme")?.source).toBe("winner");
    expect(r.find((s) => s.carrier_key === "geico")?.source).toBe("static_bid");
  });
});

// ---------------------------------------------------------------------------
// §18.6 Backfill
// ---------------------------------------------------------------------------

describe("backfillExhausted (§18.6 normative)", () => {
  const rendered = 2;
  const slots = 5; // emptySlots = 3
  it("remaining unique < empty slots → exhausted", () => {
    expect(backfillExhausted([c("o", "a", 5), c("o", "b", 4)], rendered, slots)).toBe(true); // 2 < 3
  });
  it("remaining unique == empty slots → NOT exhausted (boundary)", () => {
    expect(backfillExhausted([c("o", "a", 5), c("o", "b", 4), c("o", "c", 3)], rendered, slots)).toBe(false); // 3 !< 3
  });
  it("dedupes by carrier_key before comparing", () => {
    // 3 rows but 2 unique keys → 2 < 3 → exhausted.
    expect(backfillExhausted([c("o", "a", 5), c("o", "a", 4), c("o", "b", 3)], rendered, slots)).toBe(true);
  });
});

describe("applyBackfill (§18.6)", () => {
  const rendered = [
    { carrier_key: "r1", offer_public_id: "W", bid: 10, source: "winner" as const, slot: 1 },
    { carrier_key: "r2", offer_public_id: "W", bid: 8, source: "winner" as const, slot: 2 },
  ];

  it("fills empty slots by bid desc, continuing slot numbers", () => {
    const r = applyBackfill({
      remaining: [c("O", "b1", 6), c("O", "b2", 7)],
      rendered,
      mode: "enabled",
      bannerSlotsCount: 5,
      maxTotalCarriers: 100,
    });
    expect(r.filled.map((s) => s.carrier_key)).toEqual(["b2", "b1"]); // 7 then 6
    expect(r.filled.map((s) => s.slot)).toEqual([3, 4]);
    expect(r.filled.every((s) => s.source === "backfill")).toBe(true);
    expect(r.unfilled_slots).toBe(1); // 3 empty − 2 filled
    expect(r.unfilled_reason).toBe("all_carriers_shown"); // pool exhausted
  });

  it("unfilled with reason all_carriers_shown when pool exhausted", () => {
    const r = applyBackfill({ remaining: [c("O", "b1", 6)], rendered, mode: "enabled_unique", bannerSlotsCount: 5, maxTotalCarriers: 100 });
    expect(r.filled).toHaveLength(1);
    expect(r.unfilled_slots).toBe(2);
    expect(r.unfilled_reason).toBe("all_carriers_shown");
  });

  it("excludes already-rendered carrier_keys from the backfill pool", () => {
    const r = applyBackfill({ remaining: [c("W", "r1", 9), c("O", "b1", 6)], rendered, mode: "enabled", bannerSlotsCount: 5, maxTotalCarriers: 100 });
    expect(r.filled.map((s) => s.carrier_key)).toEqual(["b1"]); // r1 already rendered
  });

  it("max_total_carriers cap limits fill and is NOT all_carriers_shown (pool not exhausted)", () => {
    const r = applyBackfill({
      remaining: [c("O", "b1", 6), c("O", "b2", 7), c("O", "b3", 5)],
      rendered,
      mode: "enabled",
      bannerSlotsCount: 5,
      maxTotalCarriers: 3, // 2 rendered → only 1 more allowed
    });
    expect(r.filled).toHaveLength(1);
    expect(r.filled[0]?.carrier_key).toBe("b2"); // highest bid
    expect(r.unfilled_slots).toBe(2);
    expect(r.unfilled_reason).toBeNull(); // capped, pool still had carriers
  });

  it("mode disabled → no backfill, no all_carriers_shown", () => {
    const r = applyBackfill({ remaining: [c("O", "b1", 6)], rendered, mode: "disabled", bannerSlotsCount: 5, maxTotalCarriers: 100 });
    expect(r.filled).toEqual([]);
    expect(r.unfilled_reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §18.7 Remove-clicked
// ---------------------------------------------------------------------------

describe("applyRemoveClicked (§18.7)", () => {
  const carriers = [c("W", "w1", 10), c("W", "w2", 8), c("O", "o1", 6)];

  it("offer scope suppresses the WHOLE clicked Offer", () => {
    const r = applyRemoveClicked(carriers, [{ offer_public_id: "W", carrier_key: "" }], "offer");
    expect(r.map((x) => x.carrier_key)).toEqual(["o1"]); // both W carriers gone
  });

  it("carrier scope suppresses only that carrier_key", () => {
    const r = applyRemoveClicked(carriers, [{ offer_public_id: "W", carrier_key: "w1" }], "carrier");
    expect(r.map((x) => x.carrier_key)).toEqual(["w2", "o1"]); // only w1 gone
  });

  it("carrier scope ignores empty carrier_key entries", () => {
    const r = applyRemoveClicked(carriers, [{ offer_public_id: "W", carrier_key: "" }], "carrier");
    expect(r.map((x) => x.carrier_key)).toEqual(["w1", "w2", "o1"]); // nothing removed
  });
});

// ---------------------------------------------------------------------------
// toAuctionCarrier — reuses the canonical parse.ts Carrier shape (no divergent
// re-impl): a LeadgenParsedCarrier is a valid input.
// ---------------------------------------------------------------------------

describe("toAuctionCarrier bridge", () => {
  it("projects a parse.ts LeadgenParsedCarrier + USD bid + Offer into an AuctionCarrier", () => {
    const parsed: LeadgenParsedCarrier = {
      carrier_key: "acme",
      carrier_key_source: "slug",
      carrier_name: "Acme",
      bid: 42, // native — replaced by the USD bid the caller passes
    };
    const ac = toAuctionCarrier(parsed, "offer_1", 12.5);
    expect(ac).toEqual({ carrier_key: "acme", offer_public_id: "offer_1", bid: 12.5 });
  });

  it("collapses a non-positive/invalid USD bid to 0 (§18.4)", () => {
    expect(toAuctionCarrier({ carrier_key: "k" }, "o", -3).bid).toBe(0);
    expect(toAuctionCarrier({ carrier_key: "k" }, "o", Number.NaN).bid).toBe(0);
  });
});
