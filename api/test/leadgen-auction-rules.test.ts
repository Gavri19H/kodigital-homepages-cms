// LeadGen Phase 9 STAGE A — §21 auction rule evaluation (contract 07 §21 /
// §21.4). Offer-level include_only/exclude/allow/block + strictly_override +
// priority; §21.4 groups OR-within-field / AND-across-field over every op;
// carrier-level exclude-PRE-floor / include-only-POST-winner ordering;
// deterministic conditions_hash.

import { describe, expect, it } from "vitest";
import {
  carrierRulePhase,
  conditionsHash,
  conditionsMatch,
  evaluateCarrierRules,
  evaluateOfferRules,
  type CarrierRuleInput,
  type OfferRuleInput,
} from "../src/leadgen/auction-rules";
import { computeFloor, type AuctionCarrier } from "../src/leadgen/auction-core";
import type { LeadgenRuleConditions } from "../src/admin/leadgen/db-types";

// ---------------------------------------------------------------------------
// §21.4 conditionsMatch — OR within a field, AND across fields, every op
// ---------------------------------------------------------------------------

function cond(groups: LeadgenRuleConditions["groups"]): LeadgenRuleConditions {
  return { groups };
}

describe("conditionsMatch — every §21.4 op", () => {
  it("eq / neq", () => {
    expect(conditionsMatch(cond([{ field: "homeowner", op: "eq", value: true }]), { homeowner: true })).toBe(true);
    expect(conditionsMatch(cond([{ field: "homeowner", op: "eq", value: true }]), { homeowner: false })).toBe(false);
    expect(conditionsMatch(cond([{ field: "homeowner", op: "neq", value: true }]), { homeowner: false })).toBe(true);
  });

  it("gt / lt / gte / lte", () => {
    expect(conditionsMatch(cond([{ field: "age", op: "gt", value: 25 }]), { age: 26 })).toBe(true);
    expect(conditionsMatch(cond([{ field: "age", op: "gt", value: 25 }]), { age: 25 })).toBe(false);
    expect(conditionsMatch(cond([{ field: "age", op: "lt", value: 25 }]), { age: 24 })).toBe(true);
    expect(conditionsMatch(cond([{ field: "age", op: "gte", value: 25 }]), { age: 25 })).toBe(true);
    expect(conditionsMatch(cond([{ field: "age", op: "lte", value: 25 }]), { age: 25 })).toBe(true);
  });

  it("range (inclusive)", () => {
    const r = cond([{ field: "age", op: "range", from: 25, to: 64 }]);
    expect(conditionsMatch(r, { age: 25 })).toBe(true);
    expect(conditionsMatch(r, { age: 64 })).toBe(true);
    expect(conditionsMatch(r, { age: 65 })).toBe(false);
    expect(conditionsMatch(r, { age: 24 })).toBe(false);
  });

  it("in / not_in", () => {
    expect(conditionsMatch(cond([{ field: "state", op: "in", values: ["CA", "NY"] }]), { state: "CA" })).toBe(true);
    expect(conditionsMatch(cond([{ field: "state", op: "in", values: ["CA", "NY"] }]), { state: "TX" })).toBe(false);
    expect(conditionsMatch(cond([{ field: "state", op: "not_in", values: ["CA"] }]), { state: "TX" })).toBe(true);
    expect(conditionsMatch(cond([{ field: "state", op: "not_in", values: ["CA"] }]), { state: "CA" })).toBe(false);
  });

  it("OR within a field (same field, multiple entries)", () => {
    const r = cond([
      { field: "state", op: "eq", value: "CA" },
      { field: "state", op: "eq", value: "NY" },
    ]);
    expect(conditionsMatch(r, { state: "NY" })).toBe(true); // matches the 2nd entry
    expect(conditionsMatch(r, { state: "TX" })).toBe(false);
  });

  it("AND across fields (distinct fields all required)", () => {
    const r = cond([
      { field: "homeowner", op: "eq", value: true },
      { field: "state", op: "in", values: ["CA"] },
    ]);
    expect(conditionsMatch(r, { homeowner: true, state: "CA" })).toBe(true);
    expect(conditionsMatch(r, { homeowner: true, state: "TX" })).toBe(false); // state fails
    expect(conditionsMatch(r, { homeowner: false, state: "CA" })).toBe(false); // homeowner fails
  });

  it("absent field never satisfies (deterministic)", () => {
    expect(conditionsMatch(cond([{ field: "age", op: "gt", value: 25 }]), {})).toBe(false);
  });

  it("empty / absent groups → unconditional (always matches)", () => {
    expect(conditionsMatch(cond([]), {})).toBe(true);
    expect(conditionsMatch(null, {})).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// conditions_hash — deterministic + key-order independent
// ---------------------------------------------------------------------------

describe("conditionsHash", () => {
  it("is a 64-char hex sha256", () => {
    const h = conditionsHash(cond([{ field: "age", op: "gt", value: 25 }]));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is canonical: key-order, value-order (OR-within), AND group-order (AND-across) independent — §21.4 logically-equal rules hash equal", () => {
    const a: LeadgenRuleConditions = { groups: [{ field: "state", op: "in", values: ["CA", "NY"] }] };
    // same logical rule, group object keys inserted in a different order.
    const b: LeadgenRuleConditions = { groups: [{ op: "in", values: ["CA", "NY"], field: "state" }] };
    expect(conditionsHash(a)).toBe(conditionsHash(b));
    // values array order is NOT significant (OR within a field, §21.4) — so
    // ["NY","CA"] is the SAME logical rule as ["CA","NY"] and hashes equal.
    const c: LeadgenRuleConditions = { groups: [{ field: "state", op: "in", values: ["NY", "CA"] }] };
    expect(conditionsHash(a)).toBe(conditionsHash(c));
    // group array order is NOT significant (AND across fields, §21.4).
    const d: LeadgenRuleConditions = {
      groups: [
        { field: "age", op: "gt", value: 25 },
        { field: "state", op: "in", values: ["CA", "NY"] },
      ],
    };
    const e: LeadgenRuleConditions = {
      groups: [
        { field: "state", op: "in", values: ["NY", "CA"] },
        { field: "age", op: "gt", value: 25 },
      ],
    };
    expect(conditionsHash(d)).toBe(conditionsHash(e));
    // a genuinely different rule still hashes differently.
    const f: LeadgenRuleConditions = { groups: [{ field: "state", op: "in", values: ["CA", "TX"] }] };
    expect(conditionsHash(a)).not.toBe(conditionsHash(f));
  });
});

// ---------------------------------------------------------------------------
// §21 Offer-level rules
// ---------------------------------------------------------------------------

function offerRule(o: Partial<OfferRuleInput> & Pick<OfferRuleInput, "target_offer_id" | "action">): OfferRuleInput {
  return { conditions: cond([]), ...o };
}

describe("evaluateOfferRules — include/exclude/allow/block", () => {
  it("exclude removes the target when its conditions match", () => {
    const rules = [offerRule({ rule_id: "r1", target_offer_id: "X", action: "exclude", conditions: cond([{ field: "homeowner", op: "eq", value: false }]) })];
    const r = evaluateOfferRules(rules, { context: { homeowner: false }, candidate_offer_ids: ["X", "Y"] });
    expect(r.participating).toEqual(["Y"]);
    expect(r.excluded).toEqual([{ offer_id: "X", reason: "rule_exclude" }]);
  });

  it("exclude does NOT fire when conditions unmet", () => {
    const rules = [offerRule({ target_offer_id: "X", action: "exclude", conditions: cond([{ field: "homeowner", op: "eq", value: false }]) })];
    const r = evaluateOfferRules(rules, { context: { homeowner: true }, candidate_offer_ids: ["X", "Y"] });
    expect(r.participating).toEqual(["X", "Y"]);
  });

  it("block_list behaves like exclude", () => {
    const rules = [offerRule({ target_offer_id: "X", action: "block_list", conditions: cond([{ field: "state", op: "in", values: ["CA"] }]) })];
    const r = evaluateOfferRules(rules, { context: { state: "CA" }, candidate_offer_ids: ["X", "Y"] });
    expect(r.participating).toEqual(["Y"]);
    expect(r.excluded[0]?.reason).toBe("rule_block_list");
  });

  it("include_only restricts participation to the target (others excluded)", () => {
    const rules = [offerRule({ target_offer_id: "Y", action: "include_only", conditions: cond([{ field: "state", op: "in", values: ["CA"] }]) })];
    const r = evaluateOfferRules(rules, { context: { state: "CA" }, candidate_offer_ids: ["X", "Y", "Z"] });
    expect(r.participating).toEqual(["Y"]);
    expect(r.excluded.map((e) => e.offer_id).sort()).toEqual(["X", "Z"]);
    expect(r.excluded.every((e) => e.reason === "rule_include_only_restriction")).toBe(true);
  });

  it("allow_list behaves like include_only (pass-list restriction)", () => {
    const rules = [offerRule({ target_offer_id: "Y", action: "allow_list", conditions: cond([{ field: "state", op: "in", values: ["CA"] }]) })];
    const r = evaluateOfferRules(rules, { context: { state: "CA" }, candidate_offer_ids: ["X", "Y"] });
    expect(r.participating).toEqual(["Y"]);
  });

  it("include_only that does NOT match → no restriction (all participate)", () => {
    const rules = [offerRule({ target_offer_id: "Y", action: "include_only", conditions: cond([{ field: "state", op: "in", values: ["CA"] }]) })];
    const r = evaluateOfferRules(rules, { context: { state: "TX" }, candidate_offer_ids: ["X", "Y"] });
    expect(r.participating).toEqual(["X", "Y"]);
  });

  it("within an included set, a matching exclude wins over include (default precedence)", () => {
    const rules = [
      offerRule({ rule_id: "inc", target_offer_id: "Y", action: "include_only", conditions: cond([{ field: "state", op: "in", values: ["CA"] }]) }),
      offerRule({ rule_id: "exc", target_offer_id: "Y", action: "exclude", conditions: cond([{ field: "state", op: "in", values: ["CA"] }]) }),
    ];
    const r = evaluateOfferRules(rules, { context: { state: "CA" }, candidate_offer_ids: ["X", "Y"] });
    expect(r.participating).toEqual([]); // X restricted out, Y excluded
    expect(r.excluded.find((e) => e.offer_id === "Y")?.reason).toBe("rule_exclude");
  });

  it("skips disabled rules", () => {
    const rules = [offerRule({ target_offer_id: "X", action: "exclude", enabled: 0, conditions: cond([{ field: "homeowner", op: "eq", value: false }]) })];
    const r = evaluateOfferRules(rules, { context: { homeowner: false }, candidate_offer_ids: ["X"] });
    expect(r.participating).toEqual(["X"]);
  });
});

describe("evaluateOfferRules — strictly_override + priority", () => {
  const match = cond([{ field: "state", op: "in", values: ["CA"] }]);
  const ctx = { context: { state: "CA" }, candidate_offer_ids: ["X"] };

  it("strictly_override exclude forces the Offer out even under an include restriction", () => {
    const rules = [
      offerRule({ rule_id: "inc", target_offer_id: "X", action: "include_only", conditions: match }),
      offerRule({ rule_id: "exc", target_offer_id: "X", action: "exclude", strictly_override: 1, conditions: match }),
    ];
    const r = evaluateOfferRules(rules, ctx);
    expect(r.participating).toEqual([]);
    expect(r.excluded).toEqual([{ offer_id: "X", reason: "rule_exclude_override" }]);
  });

  it("strictly_override include forces the Offer in even when an exclude matches", () => {
    const rules = [
      offerRule({ rule_id: "exc", target_offer_id: "X", action: "exclude", conditions: match }),
      offerRule({ rule_id: "inc", target_offer_id: "X", action: "include_only", strictly_override: 1, conditions: match }),
    ];
    const r = evaluateOfferRules(rules, ctx);
    expect(r.participating).toEqual(["X"]);
  });

  it("priority decides between two conflicting override rules (lower number wins)", () => {
    const incLow = offerRule({ rule_id: "inc", target_offer_id: "X", action: "include_only", strictly_override: 1, priority: 10, conditions: match });
    const excHigh = offerRule({ rule_id: "exc", target_offer_id: "X", action: "exclude", strictly_override: 1, priority: 50, conditions: match });
    // include has the lower priority number → include wins → participate.
    expect(evaluateOfferRules([incLow, excHigh], ctx).participating).toEqual(["X"]);
    // flip priorities → exclude wins → out.
    const incHigh = { ...incLow, priority: 50 };
    const excLow = { ...excHigh, priority: 10 };
    expect(evaluateOfferRules([incHigh, excLow], ctx).participating).toEqual([]);
  });

  it("equal-priority override conflict → exclude wins (fail-safe)", () => {
    const rules = [
      offerRule({ rule_id: "inc", target_offer_id: "X", action: "include_only", strictly_override: 1, priority: 10, conditions: match }),
      offerRule({ rule_id: "exc", target_offer_id: "X", action: "exclude", strictly_override: 1, priority: 10, conditions: match }),
    ];
    expect(evaluateOfferRules(rules, ctx).participating).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §21 Carrier-level rules — exclude PRE-floor / include-only POST-winner
// ---------------------------------------------------------------------------

function carrierRule(o: Partial<CarrierRuleInput> & Pick<CarrierRuleInput, "action">): CarrierRuleInput {
  return { conditions: cond([]), ...o };
}

describe("evaluateCarrierRules — exclude PRE-floor", () => {
  const rules = [carrierRule({ rule_id: "cr1", action: "exclude", carrier_match: { carrier_keys: ["bad"] } })];

  it("matched carrier is excluded_pre_floor; others are not", () => {
    expect(evaluateCarrierRules(rules, { carrier_key: "bad" }, {}).excluded_pre_floor).toBe(true);
    expect(evaluateCarrierRules(rules, { carrier_key: "good" }, {}).excluded_pre_floor).toBe(false);
  });

  it("excluded carriers do NOT set the floor (ordering proof: exclude then computeFloor)", () => {
    // A high-bid carrier excluded pre-floor must not raise the % floor.
    const carriers: AuctionCarrier[] = [
      { offer_public_id: "o", carrier_key: "bad", bid: 100 },
      { offer_public_id: "o", carrier_key: "good", bid: 10 },
    ];
    const kept = carriers.filter((c) => !evaluateCarrierRules(rules, c, {}).excluded_pre_floor);
    const floor = computeFloor(kept, "percentage_of_max", 10);
    // max eligible bid is 10 (bad removed), not 100 → floor 1, not 10.
    expect(floor.floor).toBe(1);
    expect(kept.map((c) => c.carrier_key)).toEqual(["good"]);
  });

  it("context conditions gate the rule (device=mobile only)", () => {
    const mobileOnly = [carrierRule({ action: "exclude", carrier_match: { carrier_keys: ["bad"] }, conditions: cond([{ field: "device", op: "eq", value: "mobile" }]) })];
    expect(evaluateCarrierRules(mobileOnly, { carrier_key: "bad" }, { device: "mobile" }).excluded_pre_floor).toBe(true);
    expect(evaluateCarrierRules(mobileOnly, { carrier_key: "bad" }, { device: "desktop" }).excluded_pre_floor).toBe(false);
  });

  it("carrier_match by name is case-insensitive; absent match → matches all", () => {
    const byName = [carrierRule({ action: "exclude", carrier_match: { carrier_names: ["Acme Life"] } })];
    expect(evaluateCarrierRules(byName, { carrier_key: "x", carrier_name: "acme life" }, {}).excluded_pre_floor).toBe(true);
    const matchAll = [carrierRule({ action: "exclude" })];
    expect(evaluateCarrierRules(matchAll, { carrier_key: "anything" }, {}).excluded_pre_floor).toBe(true);
  });
});

describe("evaluateCarrierRules — include-only POST-winner", () => {
  const rules = [carrierRule({ rule_id: "cr2", action: "include_only", carrier_match: { carrier_keys: ["keep"] }, conditions: cond([{ field: "device", op: "eq", value: "mobile" }]) })];

  it("when the include rule's context matches: restriction active; only matched carrier is included", () => {
    const keep = evaluateCarrierRules(rules, { carrier_key: "keep" }, { device: "mobile" });
    expect(keep.include_only_active).toBe(true);
    expect(keep.included_post_winner).toBe(true);
    const other = evaluateCarrierRules(rules, { carrier_key: "other" }, { device: "mobile" });
    expect(other.include_only_active).toBe(true); // restriction active auction-wide
    expect(other.included_post_winner).toBe(false); // but this carrier is not included
  });

  it("when the include rule's context does NOT match: no restriction", () => {
    const v = evaluateCarrierRules(rules, { carrier_key: "keep" }, { device: "desktop" });
    expect(v.include_only_active).toBe(false);
    expect(v.included_post_winner).toBe(false);
  });
});

describe("carrierRulePhase", () => {
  it("exclude/block → pre_floor; include_only/allow → post_winner", () => {
    expect(carrierRulePhase("exclude")).toBe("pre_floor");
    expect(carrierRulePhase("block_list")).toBe("pre_floor");
    expect(carrierRulePhase("include_only")).toBe("post_winner");
    expect(carrierRulePhase("allow_list")).toBe("post_winner");
  });
});
