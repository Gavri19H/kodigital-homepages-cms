import { deepStrictEqual } from "node:assert";
import { expect, it, vi } from "vitest";
import type { LeadgenRuleConditionGroup } from "../src/admin/leadgen/db-types";
import { geoFromCf, parseClientUa, readCfSignals } from "../src/analytics/listicle-quality";
import { buildLeadgenSnapshot, selectLeadgenEntry, type LeadgenSelection } from "../src/edge/leadgen-select";
import type { GatewayRequestInput } from "../src/edge/types";
import type { Env } from "../src/env";
import { toFunnelVariantId } from "../src/leadgen/funnel";
import { deriveOs, parseUtmFromLandingUrl, resolveActivatedFunnel, resolveEntryRedirect } from "../src/public/leadgen/resolver";
import { readCookie } from "../src/public/listicle/experiment-pick";
import { addSite, createDb, env, type SqliteDb } from "./helpers/x06-a2-sqlite";

const siteId = "entry-parity";
const rawLocation = "https://partner.example/quotes?campaign=renewal#start";
const count = 10_000;

// Fixed public IDs make the A/B, traffic-share and redirect salts reproducible.
function publicId(prefix: string, n: number): string {
  return prefix + "_" + String(n).padStart(26, "0");
}

function seed(db: SqliteDb): void {
  addSite(db, siteId, "Entry parity", "health");
  addSite(db, "second-site", "Second site", "health");
  const quote = db.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status)
                            VALUES (?, ?, ?, 'quote_funnel', '["life"]', 'active')`);
  for (const [i, name] of ["Root", "Life", "Other"].entries()) quote.run(i + 1, publicId("lgq", i + 1), name);
  const activate = db.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES (?, ?, ?, ?)");
  activate.run(siteId, 1, 1, null);
  activate.run(siteId, 2, 1, "life");
  activate.run(siteId, 3, 0, "disabled");
  activate.run("second-site", 3, 1, "life");

  const funnel = db.prepare(`INSERT INTO leadgen_funnels (id, public_id, quote_id, funnel_name, status, display_order)
                             VALUES (?, ?, ?, ?, ?, ?)`);
  funnel.run(11, publicId("lgf", 11), 1, "Default", "active", 2);
  funnel.run(12, publicId("lgf", 12), 1, "Routed", "active", 1);
  funnel.run(13, publicId("lgf", 13), 1, "Archived", "archived", 0);
  funnel.run(21, publicId("lgf", 21), 2, "Routed", "active", 2);
  funnel.run(22, publicId("lgf", 22), 2, "First on board", "active", 1);
  funnel.run(31, publicId("lgf", 31), 3, "Other tenant", "active", 1);
  db.prepare("UPDATE leadgen_quotes SET default_funnel_id = ? WHERE id = ?").run(11, 1);

  const abTest = db.prepare(`INSERT INTO leadgen_funnel_ab_tests (public_id, funnel_id, name, revision, status)
                             VALUES (?, ?, 'Entry split', ?, ?)`);
  abTest.run(publicId("lgx", 11), 11, 7, "running");
  abTest.run(publicId("lgx", 12), 12, 3, "running");
  abTest.run(publicId("lgx", 22), 22, 2, "stopped");
  const variant = db.prepare(`INSERT INTO leadgen_funnel_variants
    (id, public_id, funnel_id, variant_label, traffic_allocation_bp, status) VALUES (?, ?, ?, ?, ?, ?)`);
  variant.run(111, publicId("lgn", 111), 11, "B", 3750, "active");
  variant.run(112, publicId("lgn", 112), 11, "A", 6250, "active");
  variant.run(113, publicId("lgn", 113), 11, "0", 10000, "archived");
  variant.run(121, publicId("lgn", 121), 12, "A", 2175, "active");
  variant.run(122, publicId("lgn", 122), 12, "B", 7825, "active");
  variant.run(211, publicId("lgn", 211), 21, "A", 10000, "active");
  variant.run(221, publicId("lgn", 221), 22, "B", 5000, "active");
  variant.run(222, publicId("lgn", 222), 22, "A", 5000, "active");
  variant.run(311, publicId("lgn", 311), 31, "A", 10000, "active");

  db.prepare(`INSERT INTO leadgen_sections
    (id, public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status)
    VALUES (1, ?, 'Age', 'quote_funnel', 'life', 'Your age', ?, 'button', 'active')`).run(publicId("lgs", 1),
    JSON.stringify({ components: [{ type: "NumberRangeQuestion", question_id: "q_age", question_key: "age", internal_field: "age" }] }));
  const section = db.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, 1, 0)");
  for (const id of [111, 112, 121, 122, 211, 221, 222, 311]) section.run(id);

  const offer = db.prepare(`INSERT INTO leadgen_offers
    (id, public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type, banner_url_template)
    VALUES (?, ?, ?, 'quote_funnel', 'life', 's2s_postback', 'cpc', ?)`);
  offer.run(1, publicId("lgo", 1), "Governed", "https://offer.example/go?click={click_id}");
  offer.run(2, publicId("lgo", 2), "Provider only", null);

  const insertRule = db.prepare(`INSERT INTO leadgen_quote_routing_rules
    (public_id, quote_id, rule_name, conditions_hash, priority, status, match_mode, conditions_json,
     target_funnel_id, redirect_pct, target_offer_id, redirect_url, redirect_url_allowlisted, force_offer_id, feed_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let ruleId = 0;
  function rule(
    quoteId: number, name: string, priority: number, groups: LeadgenRuleConditionGroup[],
    actions: {
      target?: number; pct?: number; offer?: number; url?: string; allowlisted?: boolean; force?: number; feed?: string;
      mode?: "all" | "any"; disabled?: boolean;
    },
  ): void {
    insertRule.run(publicId("lgqr", ++ruleId), quoteId, name, name, priority, actions.disabled ? "disabled" : "active",
      actions.mode ?? "all", JSON.stringify({ groups }), actions.target ?? null, actions.pct ?? null, actions.offer ?? null,
      actions.url ?? null, actions.allowlisted ? 1 : 0, actions.force ?? null, actions.feed ?? null);
  }

  rule(1, "disabled", 0, [], { disabled: true, url: "https://disabled.example", allowlisted: true, pct: 100 });
  rule(1, "checkpoint", 1, [
    { field: "traffic_share", op: "eq", value: 13.5 }, { field: "age", op: "gt", value: 29 },
  ], { target: 12 });
  rule(1, "governed", 2, [
    { field: "state", op: "eq", value: "CA", or_group: "audience" },
    { field: "os", op: "eq", value: "ios", or_group: "audience" },
    { field: "utm_medium", op: "in", values: ["paid search", "social"] },
    { field: "hour", op: "range", from: 7, to: 17 },
  ], { target: 12, offer: 1, pct: 37.5 });
  rule(1, "raw", 3, [
    { field: "device", op: "eq", value: "tablet", or_group: "audience" },
    { field: "utm_source", op: "eq", value: "partner", or_group: "audience" },
    { field: "utm_campaign", op: "eq", value: "renewal" },
  ], { mode: "any", url: rawLocation, allowlisted: true, pct: 42 });
  // Priority ties retain insertion (SQLite id) order for both share slices.
  rule(1, "share-east", 4, [{ field: "traffic_share", op: "eq", value: 20.75 }], { target: 12 });
  rule(1, "share-west", 4, [{ field: "traffic_share", op: "eq", value: 17 }], { target: 11 });

  rule(2, "early", 1, [
    { field: "utm_source", op: "neq", value: "partner" },
    { field: "weekday", op: "gte", value: 2 },
    { field: "hour", op: "lt", value: 8 },
  ], { target: 21, offer: 2, pct: 100 });
  rule(2, "late", 2, [
    { field: "hour", op: "gt", value: 16 },
    { field: "weekday", op: "lte", value: 5 },
    { field: "utm_content", op: "not_in", values: ["video", "blocked"] },
  ], { target: 21, url: "https://not-allowlisted.example", pct: 100 });
  rule(2, "force-offer", 3, [{ field: "utm_campaign", op: "eq", value: "forced" }],
    { target: 21, force: 1, offer: 1, pct: 100 });
  const mobile = [{ field: "device", op: "eq", value: "mobile" }] as const;
  rule(2, "feed-only", 4, [...mobile], { feed: "mobile" });
  rule(2, "preempted", 4, [...mobile], { target: 21 });
}

function seededInputs(): GatewayRequestInput[] {
  let state = 19260817;
  function random(limit: number): number {
    state = (state * 48271) % 2147483647;
    return Math.floor((state / 2147483647) * limit);
  }
  function pick<T>(values: readonly T[]): T {
    return values[random(values.length)]!;
  }

  const userAgents = [null, "Mozilla/5.0 (iPad; CPU OS 16_1 like Mac OS X)", "iPhone like Mac OS X",
    "Linux Android Mobile", "Linux Android", "Windows NT 10.0", "Mac OS X", "X11; Linux", "ipad", "Phone"];
  return Array.from({ length: count }, (_, i) => {
    const url = new URL(pick(["/lg", "/lg/life"]), "https://entry-parity.example");
    const params = {
      utm_source: pick([null, "search", "partner", "social", ""]),
      utm_medium: pick([null, "organic", "paid search", "social"]),
      utm_content: pick([null, "banner", "video", "blocked", "renewal"]),
      utm_campaign: pick([null, "renewal", "forced", "summer"]),
    };
    for (const [key, value] of Object.entries(params)) {
      if (value !== null) url.searchParams.set(key, value);
    }
    if (random(4) === 0) url.searchParams.append("utm_campaign", "duplicate");
    url.searchParams.set("gclid", "click-" + i);
    const sid = "visit:" + random(1_000_000_000).toString(36) + "-" + i;
    const headers = new Headers({ Cookie: "ko_internal=0; ko_sid=" + encodeURIComponent(sid) });
    const ua = pick(userAgents);
    if (ua !== null) headers.set("User-Agent", ua);
    return {
      url, headers, cookies: { ko_sid: sid }, sid,
      cf: { regionCode: pick([undefined, "", "NY", "CA", "TX"]), region: pick([undefined, "CA", "California", "Ontario"]),
        timezone: pick(["Asia/Jerusalem", "America/Los_Angeles", "UTC"]) },
      nowMs: Date.UTC(2026, 0, 1) + random(365 * 86400) * 1000,
    };
  });
}

// Reconstruct serveFunnelShell's inputs from the original request. The second
// argument to injectAssignment is resolved.assignment, including its bucket.
async function liveDecision(bindings: Env, input: GatewayRequestInput): Promise<LeadgenSelection> {
  const req = Object.assign(new Request(input.url.href, { headers: input.headers }), { cf: input.cf });
  const sid = readCookie(req.headers.get("Cookie"), "ko_sid");
  const ua = req.headers.get("User-Agent");
  const device = parseClientUa(ua).device;
  const geo = geoFromCf(readCfSignals(req));
  const now = new Date(input.nowMs);
  const ctx = {
    hour: now.getUTCHours(), weekday: now.getUTCDay(), os: deriveOs(ua),
    ...(geo.state !== "" ? { state: geo.state } : {}),
    ...(device !== "" ? { device } : {}),
    ...parseUtmFromLandingUrl(req.url),
  };
  const resolved = await resolveActivatedFunnel(bindings, {
    site_id: siteId, quote_slug: input.url.pathname.split("/")[2] ?? null, session_id: sid, entry_ctx: ctx,
  });
  if (resolved === null) throw new Error("A seeded activation did not resolve for " + req.url);
  const location = await resolveEntryRedirect(bindings.DB, resolved.quote, ctx, sid);
  if (location !== null) return { kind: "redirect", location, status: 302 };
  return {
    kind: "render", quoteId: resolved.quote.public_id, funnelVariantId: toFunnelVariantId(resolved.variant.public_id),
    assignment: resolved.assignment,
  };
}

it("matches the live SQLite quote path for 10,000 seeded requests with zero D1 reads during selection", async () => {
  const db = createDb();
  try {
    seed(db);
    const bindings = env(db);
    const snapshot: Record<string, unknown> = JSON.parse(JSON.stringify(await buildLeadgenSnapshot(bindings.DB, siteId)));
    expect(Object.keys(snapshot).sort()).toEqual(["/lg", "life"]);
    const other = await buildLeadgenSnapshot(bindings.DB, "second-site");
    expect(Object.keys(other)).toEqual(["life"]);
    expect(other.life?.quoteId).toBe(publicId("lgq", 3));

    const inputs = seededInputs();
    const guard = vi.spyOn(bindings.DB, "prepare").mockImplementation(() => { throw new Error("D1 on the gateway path"); });
    let selections: LeadgenSelection[];
    try {
      selections = inputs.map((request) => {
        const key = request.url.pathname === "/lg" ? "/lg" : request.url.pathname.slice("/lg/".length);
        return selectLeadgenEntry(snapshot[key], request);
      });
      expect(guard).toHaveBeenCalledTimes(0);
    } finally {
      guard.mockRestore();
    }

    const locations = new Set<string>();
    const variants = new Set<string>();
    const routedHashes = new Set<string>();
    let redirects = 0;
    let compared = 0;
    for (const [i, request] of inputs.entries()) {
      const expected = await liveDecision(bindings, request);
      deepStrictEqual(selections[i], expected, `input ${i}: ${request.url.href}, sid=${request.sid}, time=${request.nowMs}`);
      compared++;
      if (expected.kind === "redirect") {
        redirects++;
        locations.add(expected.location);
      } else if (expected.kind === "render") {
        variants.add(expected.funnelVariantId);
        if (expected.assignment.routing_rule_hash !== undefined) routedHashes.add(expected.assignment.routing_rule_hash);
      }
    }
    expect(compared).toBe(count);
    expect(locations).toEqual(new Set([rawLocation, "/lg/lc/" + publicId("lgo", 1)]));
    expect(variants).toEqual(new Set([111, 112, 121, 122, 211, 222].map((id) => publicId("lgn", id))));
    expect(routedHashes).toEqual(new Set(["governed", "share-east", "share-west", "early", "late", "force-offer"]));
    console.log(`Leadgen parity compared ${compared} requests (${compared - redirects} renders, ${redirects} redirects, 0 gateway D1 reads).`);
  } finally {
    db.close();
  }
}, 120_000);
