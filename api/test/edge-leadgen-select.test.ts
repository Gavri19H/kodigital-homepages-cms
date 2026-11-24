import { describe, expect, it } from "vitest";
import type { LeadgenRuleConditionGroup } from "../src/admin/leadgen/db-types";
import { buildLeadgenSnapshot, selectLeadgenEntry, type LeadgenSnapshotEntry } from "../src/edge/leadgen-select";
import type { GatewayRequestInput } from "../src/edge/types";
import { trafficBucket } from "../src/leadgen/auction-rules";
import { abBucket } from "../src/public/leadgen/ab-hash";
import type { ParsedQuoteRule } from "../src/public/leadgen/resolver";
import { createDb, env } from "./helpers/x06-a2-sqlite";

const quoteId = "lgq_00000000000000000000000001";
const control = "lgn_00000000000000000000000001";
const routed = "lgn_00000000000000000000000002";
const baseUrl = "https://tenant.example/lg?utm_source=search&utm_medium=paid+search&utm_content=banner&utm_campaign=winter&utm_campaign=second";
const time = (day: number, hour: number) => Date.UTC(2026, 10, day, hour);

function input(overrides: Partial<GatewayRequestInput> = {}): GatewayRequestInput {
  return {
    url: new URL(baseUrl),
    headers: new Headers({ "User-Agent": "Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X)" }),
    cf: { regionCode: "CA", region: "California", timezone: "Pacific/Honolulu" },
    cookies: {}, sid: "visitor", nowMs: time(24, 14), ...overrides,
  };
}

function rule(groups: LeadgenRuleConditionGroup[], overrides: Partial<ParsedQuoteRule> = {}): ParsedQuoteRule {
  return {
    public_id: "rule-1", hash: "matched", priority: 1, conditions: { groups }, entry_only: true,
    match_mode: "all", target_funnel_id: 2, force_offer_id: null, feed_name: null, value_multiplier: null,
    redirect_pct: null, target_offer_id: null, redirect_url: null, redirect_url_allowlisted: false, ...overrides,
  };
}

function entry(...rules: ParsedQuoteRule[]): LeadgenSnapshotEntry {
  return {
    quoteId, defaultFunnelId: 1, rules, offerLocations: {},
    funnels: [control, routed].map((public_id, i) => ({
      id: i + 1, abTest: null, variants: [{ public_id, variant_label: "A", traffic_allocation_bp: 10000 }],
    })),
  };
}

function changeParam(key: string, value: string): URL {
  const url = new URL(baseUrl);
  url.searchParams.set(key, value);
  return url;
}

const conditions: Array<{ condition: LeadgenRuleConditionGroup; miss: Partial<GatewayRequestInput> }> = [
  { condition: { field: "state", op: "eq", value: "CA" }, miss: { cf: { regionCode: "NY", region: "CA" } } },
  { condition: { field: "device", op: "in", values: ["tablet", "mobile"] }, miss: { headers: new Headers() } },
  { condition: { field: "os", op: "eq", value: "ios" }, miss: { headers: new Headers({ "User-Agent": "ipad like Mac OS X" }) } },
  { condition: { field: "utm_source", op: "neq", value: "partner" }, miss: { url: changeParam("utm_source", "partner") } },
  { condition: { field: "utm_medium", op: "eq", value: "paid search" }, miss: { url: changeParam("utm_medium", "organic") } },
  { condition: { field: "utm_content", op: "not_in", values: ["video", "text"] }, miss: { url: changeParam("utm_content", "video") } },
  { condition: { field: "utm_campaign", op: "eq", value: "winter" }, miss: { url: changeParam("utm_campaign", "summer") } },
  { condition: { field: "hour", op: "gt", value: 13 }, miss: { nowMs: time(24, 13) } },
  { condition: { field: "hour", op: "lt", value: 15 }, miss: { nowMs: time(24, 15) } },
  { condition: { field: "hour", op: "gte", value: 14 }, miss: { nowMs: time(24, 13) } },
  { condition: { field: "weekday", op: "lte", value: 2 }, miss: { nowMs: time(25, 14) } },
  { condition: { field: "hour", op: "range", from: 13, to: 14 }, miss: { nowMs: time(24, 15) } },
];

describe("leadgen snapshot selection", () => {
  it.each(conditions)("routes on $condition.field $condition.op", ({ condition, miss }) => {
    const snapshot = entry(rule([condition]));
    expect(selectLeadgenEntry(snapshot, input())).toMatchObject({ kind: "render", funnelVariantId: routed });
    expect(selectLeadgenEntry(snapshot, input(miss))).toMatchObject({ kind: "render", funnelVariantId: control });
  });

  it("falls back to the CF region name and the shell's empty UTM and UA defaults", () => {
    const snapshot = entry(rule([
      { field: "state", op: "eq", value: "California" },
      { field: "device", op: "eq", value: "desktop" },
      { field: "os", op: "eq", value: "other" },
      { field: "utm_content", op: "eq", value: "" },
    ]));
    const request = input({ headers: new Headers(), url: new URL("https://tenant.example/lg"), cf: { region: "California" } });
    expect(selectLeadgenEntry(snapshot, request)).toMatchObject({ funnelVariantId: routed });
  });

  it.each(["all", "any"] as const)("combines a cross-field or_group with another unit under %s", (match_mode) => {
    const snapshot = entry(rule([
      { field: "state", op: "eq", value: "TX", or_group: "audience" },
      { field: "utm_campaign", op: "eq", value: "winter", or_group: "audience" },
      { field: "device", op: "eq", value: "tablet" },
    ], { match_mode }));
    expect(selectLeadgenEntry(snapshot, input())).toMatchObject({ funnelVariantId: routed });
    expect(selectLeadgenEntry(snapshot, input({ headers: new Headers() }))).toMatchObject({
      funnelVariantId: match_mode === "all" ? control : routed,
    });
    expect(selectLeadgenEntry(snapshot, input({ headers: new Headers(), url: changeParam("utm_campaign", "") })))
      .toMatchObject({ funnelVariantId: control });
  });

  it("accounts for checkpoint traffic_share slices, both entry slices and the remainder", () => {
    const share = { field: "traffic_share", op: "eq", value: 25 } as const;
    const snapshot = entry(
      rule([share, { field: "age", op: "gt", value: 18 }], { entry_only: false }),
      rule([share], { priority: 2, public_id: "east", hash: "east" }),
      rule([share], { priority: 3, public_id: "west", hash: "west" }),
    );
    const sessions = Array.from({ length: 128 }, (_, i) => "session-" + i);
    for (const [quarter, hash] of [null, "east", "west", null].entries()) {
      const sid = sessions.find((s) => Math.floor(trafficBucket("routing_share:" + quoteId, s) / 2500) === quarter);
      expect(sid).toBeDefined();
      const result = selectLeadgenEntry(snapshot, input({ sid: sid! }));
      expect(result).toMatchObject({ kind: "render", funnelVariantId: hash === null ? control : routed });
      if (result.kind === "render") expect(result.assignment.routing_rule_hash).toBe(hash ?? undefined);
    }
  });

  it("passes the raw A/B bucket and routed attribution to the assignment injector", () => {
    const snapshot = entry(rule([]));
    const funnel = snapshot.funnels[1]!;
    const alternate = "lgn_00000000000000000000000003";
    funnel.abTest = { public_id: "lgx_00000000000000000000000001", revision: 7 };
    funnel.variants = [
      { public_id: routed, variant_label: "A", traffic_allocation_bp: 3000 },
      { public_id: alternate, variant_label: "B", traffic_allocation_bp: 7000 },
    ];
    const bucket = abBucket(funnel.abTest.public_id, 7, "visitor");
    const variant = funnel.variants[bucket < 3000 ? 0 : 1]!;
    expect(selectLeadgenEntry(snapshot, input())).toEqual({
      kind: "render", quoteId, funnelVariantId: variant.public_id,
      assignment: {
        funnel_ab_test_id: funnel.abTest.public_id, funnel_ab_test_revision: 7,
        variant_label: variant.variant_label, traffic_allocation_bp: variant.traffic_allocation_bp,
        assignment_bucket: bucket, assignment_reason: "ab_hash", routing_rule_hash: "matched",
      },
    });
  });

  it("honors a winner with no active funnel target before lower-priority rules", () => {
    for (const target_funnel_id of [null, 99]) {
      const snapshot = entry(rule([], { target_funnel_id, feed_name: "feed" }), rule([], { priority: 2 }));
      expect(selectLeadgenEntry(snapshot, input())).toEqual({
        kind: "render", quoteId, funnelVariantId: control,
        assignment: {
          funnel_ab_test_id: "", funnel_ab_test_revision: 0, variant_label: "A", traffic_allocation_bp: 10000,
          assignment_bucket: null, assignment_reason: "single_control",
        },
      });
    }
  });

  it("resolves raw and governed redirects only after confirming a servable variant", () => {
    const url = "https://partner.example/form?campaign=one";
    const action = rule([], { redirect_url: url, redirect_url_allowlisted: true, redirect_pct: 100 });
    expect(selectLeadgenEntry(entry(action), input())).toEqual({ kind: "redirect", location: url, status: 302 });
    for (const change of [{ redirect_pct: 0 }, { force_offer_id: 3 }, { redirect_url_allowlisted: false }]) {
      expect(selectLeadgenEntry(entry({ ...action, ...change }), input())).toMatchObject({ kind: "render" });
    }

    const snapshot = entry({ ...action, target_offer_id: 9 });
    expect(selectLeadgenEntry(snapshot, input())).toEqual({ kind: "fallback" }); // incomplete offer projection
    snapshot.offerLocations[9] = null;
    expect(selectLeadgenEntry(snapshot, input())).toMatchObject({ kind: "render" }); // provider-only or deleted offer
    snapshot.offerLocations[9] = "/lg/lc/offer";
    expect(selectLeadgenEntry(snapshot, input())).toEqual({ kind: "redirect", location: "/lg/lc/offer", status: 302 });
    snapshot.funnels[1]!.variants = [];
    expect(selectLeadgenEntry(snapshot, input())).toEqual({ kind: "fallback" });
  });

  it("uses a JSON round-trip of a built snapshot after the database is closed", async () => {
    const db = createDb();
    let snapshot: Record<string, unknown>;
    try {
      db.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status)
                  VALUES (1, ?, 'Root', 'quote_funnel', '["life"]', 'active')`).run(quoteId);
      db.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled) VALUES ('tenant', 1, 1)").run();
      db.prepare("INSERT INTO leadgen_funnels (id, public_id, quote_id, funnel_name, status) VALUES (1, ?, 1, 'Main', 'active')")
        .run("lgf_00000000000000000000000001");
      db.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp) VALUES (?, 1, 'A', 10000)")
        .run(control);
      const built = await buildLeadgenSnapshot(env(db).DB, "tenant");
      snapshot = JSON.parse(JSON.stringify(built)) as Record<string, unknown>;
      expect(snapshot).toEqual(built);
    } finally {
      db.close();
    }
    expect(Object.keys(snapshot)).toEqual(["/lg"]);
    expect(selectLeadgenEntry(snapshot["/lg"], input())).toMatchObject({ kind: "render", quoteId, funnelVariantId: control });
  });

  it("falls back on malformed or unsupported entries without choosing a different funnel", () => {
    const snapshot = entry(rule([]));
    const funnel = snapshot.funnels[0]!;
    const malformed: unknown[] = [
      undefined, null, false, "{}", [], {}, { ...snapshot, quoteId: 17 }, { ...snapshot, funnels: {} },
      { ...snapshot, defaultFunnelId: "1" }, { ...snapshot, rules: null }, { ...snapshot, offerLocations: null },
      { ...snapshot, rules: [null] }, { ...snapshot, rules: [{ ...rule([]), redirect_url_allowlisted: "false" }] },
      { ...snapshot, rules: [{ ...rule([]), conditions: { groups: [null] } }] },
      { ...snapshot, rules: [{ ...rule([]), conditions: { groups: [{ field: "state", op: "unknown" }] } }] },
      { ...snapshot, rules: [rule([{ field: "answer", op: "eq", value: "x" }])] }, // incorrect entry_only flag
      { ...snapshot, funnels: [{ ...funnel, abTest: { revision: 2 } }] },
      { ...snapshot, funnels: [{ ...funnel, variants: [{}] }] },
      { ...snapshot, offerLocations: { 1: "https://other.example/" } },
    ];
    for (const value of malformed) expect(selectLeadgenEntry(value, input())).toEqual({ kind: "fallback" });
    expect(selectLeadgenEntry(snapshot, input({ nowMs: NaN }))).toEqual({ kind: "fallback" });
    expect(selectLeadgenEntry(snapshot, input({ sid: "" }))).toEqual({ kind: "fallback" });
  });
});
