// 0062 — how an auction's waterfalls split the traffic (OWNER 2026-10-01: the
// example sheet's 50% / 25% / 10% / 15% paths). Pure helpers from
// src/leadgen/auction-rules.ts, measured over many visitor ids.

import { describe, expect, it } from "vitest";
import {
  parseWaterfallTiers,
  pickWaterfall,
  ruleAppliesToVisitor,
  trafficBucket,
  type WaterfallRuleInput,
} from "../src/leadgen/auction-rules";

const SHEET: WaterfallRuleInput[] = [
  { rule_id: "lgar_a", traffic_share_pct: 50, tiers: [{ offer_ids: ["fundera"] }, { offer_ids: ["lt"] }, { offer_ids: ["ow1", "ow2"] }], priority: 1 },
  { rule_id: "lgar_b", traffic_share_pct: 25, tiers: [{ offer_ids: ["lendzi"] }, { offer_ids: ["fundera"] }], priority: 2 },
  { rule_id: "lgar_c", traffic_share_pct: 10, tiers: [{ offer_ids: ["capital"] }], priority: 3 },
  { rule_id: "lgar_d", traffic_share_pct: 15, tiers: [{ offer_ids: ["lt"] }], priority: 4 },
];

describe("pickWaterfall — the waterfalls split the traffic like an A/B test", () => {
  it("50/25/10/15 over 20,000 visitors: every visitor in exactly one path, shares within 1.5 points", () => {
    const counts = new Map<string, number>();
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const pick = pickWaterfall(SHEET, "lga_auction", `visitor-${i}`);
      expect(pick).not.toBeNull(); // 100% covered: nobody falls through
      counts.set(pick!.rule.rule_id, (counts.get(pick!.rule.rule_id) ?? 0) + 1);
    }
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(N);
    for (const w of SHEET) {
      const measured = ((counts.get(w.rule_id) ?? 0) / N) * 100;
      expect(Math.abs(measured - w.traffic_share_pct)).toBeLessThan(1.5);
    }
  });

  it("shares below 100%: the leftover visitors get no waterfall (the normal auction)", () => {
    const N = 10000;
    let none = 0;
    for (let i = 0; i < N; i++) if (pickWaterfall([SHEET[0]!], "lga_auction", `v-${i}`) === null) none += 1;
    expect(Math.abs((none / N) * 100 - 50)).toBeLessThan(2);
  });

  it("sticky: the same visitor always gets the same path; ranges follow priority order", () => {
    for (let i = 0; i < 200; i++) {
      const a = pickWaterfall(SHEET, "lga_auction", `s-${i}`);
      const b = pickWaterfall([...SHEET].reverse(), "lga_auction", `s-${i}`);
      expect(b?.rule.rule_id).toBe(a?.rule.rule_id); // input order does not matter, priority does
    }
    const first = pickWaterfall(SHEET, "lga_auction", "s-1");
    expect(first?.range.from).toBeLessThanOrEqual(first?.bucket ?? -1);
    expect(first?.range.to).toBeGreaterThan(first?.bucket ?? 10001);
  });

  it("no visitor id → no waterfall; a different auction re-shuffles the same visitor independently", () => {
    expect(pickWaterfall(SHEET, "lga_auction", "")).toBeNull();
    let differ = 0;
    for (let i = 0; i < 500; i++) {
      if (trafficBucket("auction_waterfall:lga_one", `x-${i}`) !== trafficBucket("auction_waterfall:lga_two", `x-${i}`)) differ += 1;
    }
    expect(differ).toBeGreaterThan(490);
  });
});

describe("ruleAppliesToVisitor — an include/exclude rule limited to a share", () => {
  it("null = every visitor (every rule saved before 0062); 100 = every visitor; no visitor id = nobody", () => {
    expect(ruleAppliesToVisitor(null, "lgar_x", "v")).toBe(true);
    expect(ruleAppliesToVisitor(undefined, "lgar_x", "")).toBe(true);
    expect(ruleAppliesToVisitor(100, "lgar_x", "v")).toBe(true);
    expect(ruleAppliesToVisitor(30, "lgar_x", "")).toBe(false);
  });

  it("30% applies to about 30% of 10,000 visitors, the same ones every time", () => {
    let hits = 0;
    for (let i = 0; i < 10000; i++) if (ruleAppliesToVisitor(30, "lgar_x", `v-${i}`)) hits += 1;
    expect(Math.abs(hits / 100 - 30)).toBeLessThan(2);
    for (let i = 0; i < 100; i++) expect(ruleAppliesToVisitor(30, "lgar_x", `v-${i}`)).toBe(ruleAppliesToVisitor(30, "lgar_x", `v-${i}`));
  });
});

describe("parseWaterfallTiers — stored tiers never throw", () => {
  it("reads the stored shape and degrades garbage to no tiers", () => {
    expect(parseWaterfallTiers('{"tiers":[{"offer_ids":[5]},{"offer_ids":[10,13]}]}')).toEqual([{ offer_ids: [5] }, { offer_ids: [10, 13] }]);
    expect(parseWaterfallTiers("not json")).toEqual([]);
    expect(parseWaterfallTiers(null)).toEqual([]);
    expect(parseWaterfallTiers('{"tiers":[{"offer_ids":["x", -1, 2.5]},{"offer_ids":[7]}]}')).toEqual([{ offer_ids: [7] }]);
  });
});
