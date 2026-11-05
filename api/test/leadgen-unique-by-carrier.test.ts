// X10 (owner 2026-11-05) — "Enabled (unique by carrier)" shows each Carrier
// ONCE across all Offers and Providers.
//
// Measured on "A Home Insurance" (insurissimo.com/lg/home-insurance), 29 Oct –
// 5 Nov 2026: 271 of 537 auctions showed the same Carrier twice (Progressive,
// Kin, GEICO) — every time a QuinStreet copy + an AdsByMoney copy that carry
// the SAME carrier name but different carrier_keys (QuinStreet `Kin
// Insurance`, AdsByMoney `kin-homeowners-insurance-review`). Uniqueness
// compared carrier_key, so both got through.
//
// Owner decisions (5 Nov 2026): 1 keep today's order (higher bid; a provider
// copy beats a static/CPL copy) · 2 exact name after cleaning, no alias list ·
// 3 the static/CPL merge uses the same identity in every mode, so two Static
// Offers from one Provider with different Brand names no longer hide each
// other · 4 the Simulator names each dropped copy.

import { describe, expect, it } from "vitest";
import {
  applyBackfill,
  backfillExhausted,
  carrierIdentity,
  surfaceCarriers,
  surfaceCarriersExplained,
  toAuctionCarrier,
  type AuctionCarrier,
  type SurfaceOffer,
  type SurfaceSettings,
} from "../src/leadgen/auction-core";

// A carrier as the engine builds it: carrier_key + the SHOWN name.
function named(offer: string, key: string, name: string | null, bid: number): AuctionCarrier {
  return toAuctionCarrier({ carrier_key: key, carrier_name: name }, offer, bid);
}

// "A Home Insurance" live settings: banner slots 5, max per offer 3, max total
// 10, surface static/CPL offers ticked.
const settings: SurfaceSettings = {
  multi_offer: "enabled_unique",
  surface_static_bid_offers: true,
  max_carriers_per_offer: 3,
  max_total_carriers: 10,
  banner_slots_count: 5,
};

// The live shape: two Providers, both naming Kin and Progressive.
const QUINSTREET: SurfaceOffer = {
  offer_public_id: "lgo_quinstreet",
  bid_source: "cpc",
  carriers: [
    named("lgo_quinstreet", "Progressive", "Progressive", 4.1),
    named("lgo_quinstreet", "Kin Insurance", "Kin", 3.2),
    named("lgo_quinstreet", "Geico", "GEICO", 1.0),
  ],
};
const ADSBYMONEY: SurfaceOffer = {
  offer_public_id: "lgo_adsbymoney",
  bid_source: "cpc",
  carriers: [
    named("lgo_adsbymoney", "kin-homeowners-insurance-review", "Kin", 3.6),
    named("lgo_adsbymoney", "progressive-home-insurance-review", "Progressive", 2.0),
    named("lgo_adsbymoney", "lemonade-home", "Lemonade", 1.5),
  ],
};

describe("carrierIdentity — the cleaned shown name (decision 2)", () => {
  it("case, spaces and punctuation do not matter", () => {
    expect(carrierIdentity("Kin", "a")).toBe("kin");
    expect(carrierIdentity("KIN.", "b")).toBe("kin");
    expect(carrierIdentity("  kin ", "c")).toBe("kin");
    expect(carrierIdentity("State-Farm®", "d")).toBe(carrierIdentity("State Farm", "e"));
  });

  it("is an EXACT match after cleaning — no alias list", () => {
    expect(carrierIdentity("Kin Insurance", "a")).not.toBe(carrierIdentity("Kin", "b"));
  });

  it("an empty or missing name falls back to carrier_key (today's behaviour)", () => {
    expect(carrierIdentity("", "the-key")).toBe("the-key");
    expect(carrierIdentity("  ...  ", "the-key")).toBe("the-key");
    expect(carrierIdentity(null, "the-key")).toBe("the-key");
    expect(carrierIdentity(undefined, "the-key")).toBe("the-key");
  });

  it("keeps letters of any alphabet (a Hebrew name is not emptied)", () => {
    expect(carrierIdentity("ביטוח ישיר", "k")).toBe("ביטוחישיר");
  });
});

describe("Enabled (unique by carrier) — each Carrier once across Providers", () => {
  it("the live case: Kin and Progressive from QuinStreet AND AdsByMoney show once each", () => {
    const r = surfaceCarriers([QUINSTREET, ADSBYMONEY], "lgo_quinstreet", settings);
    const names = r.map((s) => s.carrier_identity);
    expect(names).toEqual(["progressive", "kin", "lemonade", "geico"]);
    // decision 1: the higher bid stays — Kin from AdsByMoney (3.6 > 3.2),
    // Progressive from QuinStreet (4.1 > 2.0)
    expect(r.find((s) => s.carrier_identity === "kin")).toMatchObject({ offer_public_id: "lgo_adsbymoney", carrier_key: "kin-homeowners-insurance-review", bid: 3.6 });
    expect(r.find((s) => s.carrier_identity === "progressive")).toMatchObject({ offer_public_id: "lgo_quinstreet", carrier_key: "Progressive", bid: 4.1 });
    // the freed slots hold the next Carriers, numbered without gaps
    expect(r.map((s) => s.slot)).toEqual([1, 2, 3, 4]);
  });

  it("reports each dropped copy and the copy it yielded to (decision 4)", () => {
    const { duplicates } = surfaceCarriersExplained([QUINSTREET, ADSBYMONEY], "lgo_quinstreet", settings);
    expect(duplicates.map((d) => [d.carrier_identity, d.dropped.offer_public_id, d.kept.offer_public_id])).toEqual([
      ["kin", "lgo_quinstreet", "lgo_adsbymoney"],
      ["progressive", "lgo_adsbymoney", "lgo_quinstreet"],
    ]);
  });

  it("Enabled (all, bid order) still shows Kin from both Providers, as today", () => {
    const { surfaced, duplicates } = surfaceCarriersExplained([QUINSTREET, ADSBYMONEY], "lgo_quinstreet", {
      ...settings,
      multi_offer: "enabled",
      banner_slots_count: 10,
    });
    expect(surfaced.filter((s) => s.carrier_identity === "kin")).toHaveLength(2);
    expect(surfaced.filter((s) => s.carrier_identity === "progressive")).toHaveLength(2);
    expect(duplicates).toEqual([]);
  });

  it("Disabled (winner only) still shows only the winner's carriers", () => {
    const r = surfaceCarriers([QUINSTREET, ADSBYMONEY], "lgo_quinstreet", { ...settings, multi_offer: "disabled" });
    expect(r.every((s) => s.offer_public_id === "lgo_quinstreet")).toBe(true);
    expect(r).toHaveLength(3);
  });

  it("two DIFFERENT Carriers stay apart even with an empty name (identity falls back to carrier_key)", () => {
    const a: SurfaceOffer = { offer_public_id: "A", bid_source: "cpc", carriers: [named("A", "k1", "", 5), named("A", "k2", null, 4)] };
    const b: SurfaceOffer = { offer_public_id: "B", bid_source: "cpc", carriers: [named("B", "k3", "", 3)] };
    expect(surfaceCarriers([a, b], "A", settings).map((s) => s.carrier_key)).toEqual(["k1", "k2", "k3"]);
  });

  it("the same Carrier in different letter case from two Providers is ONE card", () => {
    const a: SurfaceOffer = { offer_public_id: "A", bid_source: "cpc", carriers: [named("A", "111", "Kin", 2)] };
    const b: SurfaceOffer = { offer_public_id: "B", bid_source: "cpc", carriers: [named("B", "222", "KIN.", 3)] };
    const r = surfaceCarriers([a, b], "B", settings);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ offer_public_id: "B", bid: 3 });
  });

  it("hand-built carriers without a name keep the old carrier_key comparison", () => {
    const a: SurfaceOffer = { offer_public_id: "A", bid_source: "cpc", carriers: [{ offer_public_id: "A", carrier_key: "dup", bid: 8 }] };
    const b: SurfaceOffer = { offer_public_id: "B", bid_source: "cpc", carriers: [{ offer_public_id: "B", carrier_key: "dup", bid: 9 }] };
    const r = surfaceCarriers([a, b], "A", settings);
    expect(r).toHaveLength(1);
    expect(r[0]?.bid).toBe(9);
  });
});

// Code review 1 (5 Nov): live answers carry 4+ listings 32% of the time. A
// repeat must NOT use up one of its Offer's "Max carriers per offer" places —
// the freed slot has to hold that Offer's next Carrier (the plan's promise).
describe("the freed slot holds the next Carrier (live-shaped answers)", () => {
  const QS5: SurfaceOffer = {
    offer_public_id: "lgo_quinstreet",
    bid_source: "cpc",
    carriers: [
      named("lgo_quinstreet", "Progressive", "Progressive", 4.1),
      named("lgo_quinstreet", "Kin Insurance", "Kin", 3.2),
      named("lgo_quinstreet", "Geico", "GEICO", 1.0),
      named("lgo_quinstreet", "Farmers", "Farmers", 0.9),
      named("lgo_quinstreet", "Allstate", "Allstate", 0.8),
    ],
  };
  const ABM5: SurfaceOffer = {
    offer_public_id: "lgo_adsbymoney",
    bid_source: "cpc",
    carriers: [
      named("lgo_adsbymoney", "kin-homeowners-insurance-review", "Kin", 3.6),
      named("lgo_adsbymoney", "progressive-home-insurance-review", "Progressive", 2.0),
      named("lgo_adsbymoney", "lemonade-home", "Lemonade", 1.5),
      named("lgo_adsbymoney", "hippo-home", "Hippo", 1.2),
      named("lgo_adsbymoney", "openly-home", "Openly", 0.7),
    ],
  };

  it("5 slots, 3 per offer: 5 different Carriers fill the page", () => {
    const r = surfaceCarriers([QS5, ABM5], "lgo_quinstreet", settings);
    expect(r.map((s) => s.carrier_identity)).toEqual(["progressive", "kin", "lemonade", "hippo", "geico"]);
    expect(r).toHaveLength(5);
    // still at most 3 per Offer
    expect(r.filter((s) => s.offer_public_id === "lgo_adsbymoney")).toHaveLength(3);
    expect(r.filter((s) => s.offer_public_id === "lgo_quinstreet")).toHaveLength(2);
  });

  it("the per-offer cap is unchanged for the other modes", () => {
    const r = surfaceCarriers([QS5, ABM5], "lgo_quinstreet", { ...settings, multi_offer: "enabled", banner_slots_count: 10 });
    expect(r.filter((s) => s.offer_public_id === "lgo_quinstreet").map((s) => s.carrier_key)).toEqual(["Progressive", "Kin Insurance", "Geico"]);
    expect(r.filter((s) => s.offer_public_id === "lgo_adsbymoney").map((s) => s.carrier_key)).toEqual(["kin-homeowners-insurance-review", "progressive-home-insurance-review", "lemonade-home"]);
  });

  it("the Simulator list names only copies that would otherwise have been on the page", () => {
    const { duplicates } = surfaceCarriersExplained([QS5, ABM5], "lgo_quinstreet", { ...settings, banner_slots_count: 2 });
    // slots 1-2 are Progressive (QS) and Kin (ABM); QS's Kin (3.2) would have
    // taken slot 3 — outside the 2 slots — so no line for any copy.
    expect(duplicates).toEqual([]);
  });
});

describe("Provider copy vs Static/CPL copy of the same Carrier (decision 1)", () => {
  // Provider A returns "Kin" (key 1234); Provider B's Static Offer has Brand
  // name "kin" (key adsbymoney, from its Provider field).
  const PROVIDER_A: SurfaceOffer = { offer_public_id: "lgo_a", bid_source: "cpc", carriers: [named("lgo_a", "1234", "Kin", 2.5)] };
  const STATIC_B: SurfaceOffer = { offer_public_id: "lgo_b", bid_source: "static", carriers: [named("lgo_b", "adsbymoney", "kin", 9)] };

  it("one card, and it is the provider copy even though the static bid is higher", () => {
    const r = surfaceCarriers([PROVIDER_A, STATIC_B], "lgo_a", settings);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ offer_public_id: "lgo_a", carrier_key: "1234", source: "winner" });
  });

  it("the static merge removes the repeat in every Multi-offer mode (decision 3)", () => {
    for (const multi_offer of ["disabled", "enabled", "enabled_unique"] as const) {
      const r = surfaceCarriers([PROVIDER_A, STATIC_B], "lgo_a", { ...settings, multi_offer });
      expect(r.map((s) => s.offer_public_id), multi_offer).toEqual(["lgo_a"]);
    }
  });
});

describe("Two Static Offers from ONE Provider (decision 3)", () => {
  // Both Offers have Provider "AdsByMoney", so both carrier_keys are
  // `adsbymoney`; only the Brand name tells them apart.
  const KIN: SurfaceOffer = { offer_public_id: "lgo_kin", bid_source: "static", carriers: [named("lgo_kin", "adsbymoney", "Kin", 6)] };
  const LEMONADE: SurfaceOffer = { offer_public_id: "lgo_lemonade", bid_source: "static", carriers: [named("lgo_lemonade", "adsbymoney", "Lemonade", 5)] };
  const KIN_AGAIN: SurfaceOffer = { offer_public_id: "lgo_kin2", bid_source: "static", carriers: [named("lgo_kin2", "adsbymoney", "Kin", 4)] };

  it("different Brand names both show, in every Multi-offer mode", () => {
    for (const multi_offer of ["disabled", "enabled", "enabled_unique"] as const) {
      const r = surfaceCarriers([KIN, LEMONADE], null, { ...settings, multi_offer });
      expect(r.map((s) => s.offer_public_id), multi_offer).toEqual(["lgo_kin", "lgo_lemonade"]);
      expect(r.every((s) => s.source === "static_bid")).toBe(true);
    }
  });

  it("the same Brand name shows once (the higher bid)", () => {
    const { surfaced, duplicates } = surfaceCarriersExplained([KIN_AGAIN, KIN], null, settings);
    expect(surfaced.map((s) => s.offer_public_id)).toEqual(["lgo_kin"]);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({ carrier_identity: "kin", dropped: { offer_public_id: "lgo_kin2" }, kept: { offer_public_id: "lgo_kin" } });
  });
});

describe("Backfill (unique by carrier) never brings back a Carrier already on screen", () => {
  const rendered = [
    { carrier_key: "Kin Insurance", offer_public_id: "lgo_quinstreet", bid: 3.2, source: "winner" as const, slot: 1, carrier_identity: "kin" },
  ];
  const remaining = [
    named("lgo_adsbymoney", "kin-homeowners-insurance-review", "Kin", 3.6),
    named("lgo_adsbymoney", "lemonade-home", "Lemonade", 1.5),
  ];

  it("enabled_unique skips AdsByMoney's Kin because QuinStreet's Kin is on screen", () => {
    const r = applyBackfill({ remaining, rendered, mode: "enabled_unique", bannerSlotsCount: 5, maxTotalCarriers: 10 });
    expect(r.filled.map((s) => s.carrier_key)).toEqual(["lemonade-home"]);
    expect(r.filled[0]?.slot).toBe(2);
  });

  it("Backfill 'Enabled' still backfills it when Multi-offer is NOT unique, as today", () => {
    const r = applyBackfill({ remaining, rendered, mode: "enabled", bannerSlotsCount: 5, maxTotalCarriers: 10 });
    expect(r.filled.map((s) => s.carrier_key)).toEqual(["kin-homeowners-insurance-review", "lemonade-home"]);
  });

  // Code review 1: with Multi-offer "Enabled (unique by carrier)", a repeat
  // surfacing dropped must not come back through Backfill "Enabled".
  it("Backfill 'Enabled' never brings a Carrier back when Multi-offer is unique by carrier", () => {
    const r = applyBackfill({ remaining, rendered, mode: "enabled", bannerSlotsCount: 5, maxTotalCarriers: 10, multiOfferUnique: true });
    expect(r.filled.map((s) => s.carrier_key)).toEqual(["lemonade-home"]);
  });

  it("enabled_unique keeps the HIGHER bid of two copies in the pool", () => {
    const pool = [named("A", "a-kin", "Kin", 1), named("B", "b-kin", "Kin", 7)];
    const r = applyBackfill({ remaining: pool, rendered: [], mode: "enabled_unique", bannerSlotsCount: 5, maxTotalCarriers: 10 });
    expect(r.filled.map((s) => [s.offer_public_id, s.bid])).toEqual([["B", 7]]);
  });

  it("the exhausted test counts Carriers, not keys", () => {
    // 3 rows, 2 Carriers (Kin twice) vs 3 empty slots → exhausted.
    const pool = [named("A", "a-kin", "Kin", 5), named("B", "b-kin", "kin", 4), named("B", "lem", "Lemonade", 3)];
    expect(backfillExhausted(pool, 2, 5)).toBe(true);
  });
});
