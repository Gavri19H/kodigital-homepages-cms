// Backlog F15 — "Edit rule" on every auction rule (LeadGen → Auction → Rules).
//
// 1. The served Rules panel: every rule row (Waterfalls, Tier-level,
//    Offer-level, Carrier-level) shows "Disable", "Edit rule", "Delete rule"
//    in that order, and the page carries each rule's saved values for the
//    form.
// 2. The page's own editor script, run in node:vm on the REAL rendered page
//    (test/helpers/mini-dom.ts), with its fetch calls answered by the REAL
//    admin router over the node:sqlite D1 harness: "Edit rule" fills the
//    "Add a rule" form, "Save changes" sends PATCH …/rules/:rule_id (never
//    POST or DELETE) and the rule keeps its id; a refused save shows the
//    server's message and leaves the rule as it was; "Cancel" returns the
//    form to "Add a rule".

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { miniDocument, type MiniDocument, type MiniNode } from "./helpers/mini-dom";

// --- node:sqlite harness (repo pattern, as in leadgen-auctions-ui.test.ts) --------

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    return (nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule;
      if (typeof getBuiltin === "function") return (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
    } catch {
      /* fall through */
    }
    return null;
  }
}

function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

function d1FromSqlite(sdb: SqliteDb): D1Database {
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first<T = unknown>(): Promise<T | null> { return (sdb.prepare(sql).get(...binds) ?? null) as T | null; },
        async all<T = unknown>() { return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} }; },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
          return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const statement of statements) results.push(await statement.run());
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return results;
    },
  } as unknown as D1Database;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql",
  "0043_leadgen_routing_rules.sql",
  "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql",
  "0046_leadgen_rework_m1_variants.sql",
  "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql",
  "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql",
  "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql",
  "0053_leadgen_rework_m12_othergroup_retirement.sql",
  "0057_leadgen_offer_test_verdict.sql",
  "0062_leadgen_auction_waterfalls.sql",
  "0063_leadgen_auction_tier_rules.sql",
] as const;

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(): { sdb: SqliteDb; env: Env } {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
  );
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  const env = {
    DB: d1FromSqlite(sdb),
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
  } as Env;
  return { sdb, env };
}

const API = "/api/admin/leadgen";
const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function seedOffer(sdb: SqliteDb, name: string): { offer_id: number; placement_id: number } {
  const offerPublic = mintPublicId("offer");
  sdb
    .prepare("INSERT INTO leadgen_offers (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type, status) VALUES (?, ?, 'quote_funnel', 'life', 's2s_postback', 'cpl', 'active')")
    .run(offerPublic, name);
  const offer = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(offerPublic) as { id: number };
  const placementPublic = mintPublicId("offer_placement");
  sdb.prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)").run(placementPublic, offer.id, `plc-${offerPublic.slice(-4)}`);
  const placement = sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(placementPublic) as { id: number };
  return { offer_id: offer.id, placement_id: placement.id };
}

interface Seeded {
  sdb: SqliteDb;
  env: Env;
  auctionPub: string;
  ids: Record<"fundera" | "amone" | "fora" | "honest", number>;
  rules: Record<"waterfall" | "waterfall2" | "offer" | "tier" | "carrier", string>;
}

async function seed(): Promise<Seeded> {
  const { sdb, env } = newHarness();
  const q = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Loans Quote", activity: "quote_funnel", verticals: ["life"] }), env);
  const quote = (await q.json()) as { id: number };
  const a = await admin.request(`${API}/auctions`, jsonInit("POST", { auction_name: "A Bussines loans", quote_id: quote.id, auction_type: "dynamic" }), env);
  const auction = (await a.json()) as { public_id: string };
  const fundera = seedOffer(sdb, "Fundera - Tier 1");
  const amone = seedOffer(sdb, "AmONE - Tier 2");
  const fora = seedOffer(sdb, "Fora - Tier 3");
  const honest = seedOffer(sdb, "Honest Loans - OW");
  await admin.request(
    `${API}/auctions/${auction.public_id}/offers`,
    jsonInit("PUT", { offers: [fundera, amone, fora, honest].map((o) => ({ offer_placement_id: o.placement_id })) }),
    env,
  );
  const post = async (body: unknown): Promise<string> => {
    const r = await admin.request(`${API}/auctions/${auction.public_id}/rules`, jsonInit("POST", body), env);
    expect(r.status, await r.clone().text()).toBe(201);
    return ((await r.json()) as { public_id: string }).public_id;
  };
  const rules = {
    waterfall: await post({
      action: "waterfall",
      traffic_share_pct: 50,
      priority: 1,
      tiers: [[fundera.offer_id], [amone.offer_id], [fora.offer_id, honest.offer_id]],
      conditions_json: { groups: [{ field: "device", op: "eq", value: "mobile" }] },
    }),
    waterfall2: await post({ action: "waterfall", traffic_share_pct: 30, priority: 2, tiers: [[amone.offer_id]] }),
    offer: await post({ rule_level: "offer", action: "exclude", target_offer_id: amone.offer_id, traffic_share_pct: 30, priority: 10, conditions_json: { groups: [] } }),
    tier: await post({ rule_level: "tier", action: "include_only", tier_offer_ids: [fora.offer_id, honest.offer_id], priority: 20, conditions_json: { groups: [{ field: "os", op: "eq", value: "ios" }] } }),
    carrier: await post({ rule_level: "carrier", action: "exclude", carrier_match_json: { carrier_keys: ["acme"] }, priority: 30, strictly_override: true }),
  };
  return {
    sdb,
    env,
    auctionPub: auction.public_id,
    ids: { fundera: fundera.offer_id, amone: amone.offer_id, fora: fora.offer_id, honest: honest.offer_id },
    rules,
  };
}

async function editorHtml(s: Seeded): Promise<string> {
  const res = await admin.request(`/admin/leadgen/auction/${s.auctionPub}/edit`, {}, s.env);
  expect(res.status).toBe(200);
  return res.text();
}

function ruleRow(s: Seeded, publicId: string): Record<string, unknown> {
  return s.sdb.prepare("SELECT * FROM leadgen_auction_rules WHERE public_id = ?").get(publicId) as Record<string, unknown>;
}

// --- 1. the served Rules panel ----------------------------------------------------

describeDb("F15 — every auction rule row has \"Edit rule\"", () => {
  it("Disable, Edit rule, Delete rule — in that order — on Waterfall, Tier-level, Offer-level and Carrier-level rows", async () => {
    const s = await seed();
    const html = await editorHtml(s);
    for (const [kind, id] of Object.entries(s.rules)) {
      const start = html.indexOf(`data-rule-id="${id}"`);
      expect(start, `${kind} row rendered`).toBeGreaterThan(-1);
      const row = html.slice(start, html.indexOf("</div>\n", html.indexOf("data-delete-rule", start)));
      const toggle = row.indexOf("data-toggle-rule=");
      const edit = row.indexOf(`<button type="button" class="btn btn-sm btn-secondary" data-edit-rule="${id}">Edit rule</button>`);
      const del = row.indexOf(`data-delete-rule="${id}"`);
      expect(toggle, `${kind}: Disable`).toBeGreaterThan(-1);
      expect(edit, `${kind}: Edit rule`).toBeGreaterThan(toggle);
      expect(del, `${kind}: Delete rule`).toBeGreaterThan(edit);
    }
    expect(html.match(/data-edit-rule="/g)).toHaveLength(5);
  });

  it("the page carries each rule's saved values for the form, and the form starts as \"Add a rule\"", async () => {
    const s = await seed();
    const html = await editorHtml(s);
    const blob = /<script type="application\/json" id="lg-a-rules-data">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    const data = JSON.parse(blob) as Record<string, Record<string, unknown>>;
    expect(Object.keys(data).sort()).toEqual(Object.values(s.rules).sort());
    expect(data[s.rules.waterfall]).toMatchObject({ action: "waterfall", traffic_share_pct: 50, priority: 1, tiers: [[s.ids.fundera], [s.ids.amone], [s.ids.fora, s.ids.honest]] });
    expect(data[s.rules.offer]).toMatchObject({ rule_level: "offer", action: "exclude", target_offer_id: s.ids.amone, traffic_share_pct: 30 });
    expect(data[s.rules.carrier]).toMatchObject({ rule_level: "carrier", carrier_match_json: { carrier_keys: ["acme"] }, strictly_override: true });
    expect(html).toContain('<h4 id="lg-a-rule-heading">Add a rule</h4>');
    expect(html).toContain('<button type="button" class="btn btn-primary" id="lg-a-rule-add">Add rule</button> <button type="button" class="btn btn-outline" id="lg-a-rule-cancel" hidden>Cancel</button>');
  });
});

// --- 2. the page's own script ------------------------------------------------------

interface Booted {
  doc: MiniDocument;
  // every request the page makes; writes() leaves out its own GET loads
  calls: Array<{ method: string; url: string; body: Record<string, unknown> | null }>;
  writes: () => Array<{ method: string; url: string; body: Record<string, unknown> | null }>;
  reloads: () => number;
  conditions: () => unknown;
  byId: (id: string) => MiniNode;
  settle: () => Promise<void>;
  confirmAnswer: boolean;
}

function editorScript(html: string): string {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !(m[1] ?? "").includes("application/json"))
    .map((m) => m[2] ?? "");
  const found = scripts.find((s) => s.includes("getElementById('lg-auction-editor')"));
  expect(found, "the editor script is on the page").toBeDefined();
  return found as string;
}

async function boot(s: Seeded): Promise<Booted> {
  const html = await editorHtml(s);
  const doc = miniDocument(html);
  const calls: Booted["calls"] = [];
  let reloads = 0;
  let booted = { confirmAnswer: true } as Booted;
  const timers: Array<() => void> = [];
  const pending: Array<Promise<unknown>> = [];
  const fetchStub = (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null });
    const p = Promise.resolve(admin.request(url, { method, headers: init.headers as HeadersInit, body: init.body as BodyInit | undefined }, s.env));
    pending.push(p);
    return p;
  };
  const windowObj: Record<string, unknown> = {
    location: { reload: () => { reloads += 1; }, href: `http://localhost/admin/leadgen/auction/${s.auctionPub}/edit` },
    confirm: () => booted.confirmAnswer,
    setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; },
    innerWidth: 1280,
    // the page's other islands (clip reveal, kebabs) only need these to exist
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    requestAnimationFrame: (fn: () => void) => { timers.push(fn); return timers.length; },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    matchMedia: () => ({ matches: false, addListener: () => undefined, addEventListener: () => undefined }),
  };
  // The page's REAL condition builder (ui-rules-builder.ts) ships in the same
  // script and mounts on the hidden #lg-r-conditions.
  runInNewContext(editorScript(html), { window: windowObj, document: doc, fetch: fetchStub, setTimeout: windowObj["setTimeout"], console });
  while (timers.length > 0) (timers.shift() as () => void)();
  // Waits until the page's fetch chains are done: no request in flight for
  // several quiet rounds (bounded, so a hang still fails the test).
  const settle = async (): Promise<void> => {
    let quiet = 0;
    for (let i = 0; i < 500 && quiet < 10; i++) {
      const inFlight = pending.splice(0);
      if (inFlight.length > 0) { quiet = 0; await Promise.all(inFlight); }
      else quiet += 1;
      await new Promise((r) => setImmediate(r));
    }
  };
  const byId = (id: string): MiniNode => {
    const el = doc.getElementById(id);
    expect(el, `#${id} on the page`).not.toBeNull();
    return el as MiniNode;
  };
  const writes = (): Booted["calls"] => calls.filter((c) => c.method !== "GET");
  const conditions = (): unknown => JSON.parse(byId("lg-r-conditions").value);
  booted = { doc, calls, writes, reloads: () => reloads, conditions, byId, settle, confirmAnswer: true };
  return booted;
}

function editButton(b: Booted, ruleId: string): MiniNode {
  const el = b.doc.querySelector(`[data-edit-rule="${ruleId}"]`);
  expect(el, `Edit rule button for ${ruleId}`).not.toBeNull();
  return el as MiniNode;
}

function checkedIds(scope: MiniNode, selector: string): number[] {
  return scope.querySelectorAll(selector).filter((b) => b.checked).map((b) => Number(b.value));
}

describeDb("F15 — Edit rule fills the form; Save changes sends PATCH in place", () => {
  it("a waterfall: the form gets 50%, priority 1, the three tiers and the conditions; the heading reads \"Edit rule\"", async () => {
    const s = await seed();
    const b = await boot(s);
    editButton(b, s.rules.waterfall).click();
    expect(b.byId("lg-a-rule-heading").textContent).toBe("Edit rule");
    expect(b.byId("lg-a-rule-add").textContent).toBe("Save changes");
    expect(b.byId("lg-a-rule-cancel").hidden).toBe(false);
    expect(b.byId("lg-r-action").value).toBe("waterfall");
    expect(b.byId("lg-r-share").value).toBe("50");
    expect(b.byId("lg-r-priority").value).toBe("1");
    const tiers = b.byId("lg-r-tiers").querySelectorAll("[data-tier]");
    expect(tiers.map((t) => checkedIds(t, "[data-tier-offer]"))).toEqual([[s.ids.fundera], [s.ids.amone], [s.ids.fora, s.ids.honest].sort((x, y) => x - y)]);
    expect(tiers.map((t) => t.querySelector("[data-tier-label]")?.textContent)).toEqual(["Tier 1", "Tier 2", "Tier 3"]);
    expect(b.conditions()).toEqual({ groups: [{ field: "device", op: "eq", value: "mobile" }] });
    expect(b.doc.querySelector("[data-rule-waterfall-field]")?.hidden).toBe(false);
    expect(b.byId("lg-a-rule-builder").scrolled).toBe(true);
    expect(b.byId("lg-r-action").focused).toBe(true);
  });

  it("50% → 40% → Save changes: one PATCH to the same rule id (never POST or DELETE), the row is updated in place, the page reloads", async () => {
    const s = await seed();
    const before = ruleRow(s, s.rules.waterfall);
    const b = await boot(s);
    editButton(b, s.rules.waterfall).click();
    b.byId("lg-r-share").value = "40";
    b.byId("lg-a-rule-add").click();
    await b.settle();
    expect(b.writes().map((c) => `${c.method} ${c.url}`)).toEqual([`PATCH /api/admin/leadgen/auctions/${encodeURIComponent(s.auctionPub)}/rules/${encodeURIComponent(s.rules.waterfall)}`]);
    expect(b.writes()[0]?.body).toMatchObject({
      action: "waterfall",
      traffic_share_pct: 40,
      priority: 1,
      tiers: [{ offer_ids: [s.ids.fundera] }, { offer_ids: [s.ids.amone] }, { offer_ids: [s.ids.fora, s.ids.honest].sort((x, y) => x - y) }],
    });
    expect(b.reloads()).toBe(1);
    const after = ruleRow(s, s.rules.waterfall);
    expect(after["id"]).toBe(before["id"]);
    expect(after["traffic_share_pct"]).toBe(40);
    expect(JSON.parse(after["conditions_json"] as string)).toEqual({ groups: [{ field: "device", op: "eq", value: "mobile" }] });
    expect((s.sdb.prepare("SELECT COUNT(*) n FROM leadgen_auction_rules").get() as { n: number }).n).toBe(5);
  });

  it("a share that pushes the waterfalls over 100% shows the server's message; the rule stays exactly as it was", async () => {
    const s = await seed();
    const before = ruleRow(s, s.rules.waterfall);
    const b = await boot(s);
    editButton(b, s.rules.waterfall).click();
    b.byId("lg-r-share").value = "80"; // + the other waterfall's 30% = 110%
    b.byId("lg-a-rule-add").click();
    await b.settle();
    expect(b.writes().map((c) => c.method)).toEqual(["PATCH"]);
    expect(b.reloads()).toBe(0);
    const msg = b.byId("lg-a-rule-msg");
    expect(msg.hidden).toBe(false);
    expect(msg.className).toBe("alert alert-error");
    expect(msg.textContent).toMatch(/100%/);
    expect(b.byId("lg-a-rule-add").disabled).toBe(false);
    expect(b.byId("lg-a-rule-heading").textContent).toBe("Edit rule"); // still editing, nothing lost
    expect(ruleRow(s, s.rules.waterfall)).toEqual(before);
  });

  it("an Offer-level rule: target and share load; clearing the share saves \"all traffic\" (null), not the old 30%", async () => {
    const s = await seed();
    const b = await boot(s);
    editButton(b, s.rules.offer).click();
    expect(b.byId("lg-r-level").value).toBe("offer");
    expect(b.byId("lg-r-action").value).toBe("exclude");
    expect(b.byId("lg-r-target-offer").value).toBe(String(s.ids.amone));
    expect(b.byId("lg-r-share").value).toBe("30");
    expect(b.byId("lg-r-level").focused).toBe(true);
    b.byId("lg-r-share").value = "";
    b.byId("lg-a-rule-add").click();
    await b.settle();
    expect(b.writes()[0]?.method).toBe("PATCH");
    expect(b.writes()[0]?.body).toHaveProperty("traffic_share_pct", null);
    expect(ruleRow(s, s.rules.offer)["traffic_share_pct"]).toBeNull();
    expect(ruleRow(s, s.rules.offer)["target_offer_id"]).toBe(s.ids.amone);
  });

  it("a Tier-level rule: its offers are ticked; switching Show only → Hide saves in place", async () => {
    const s = await seed();
    const b = await boot(s);
    editButton(b, s.rules.tier).click();
    expect(b.byId("lg-r-level").value).toBe("tier");
    expect(checkedIds(b.doc.root, "[data-tier-group-offer]")).toEqual([s.ids.fora, s.ids.honest].sort((x, y) => x - y));
    expect(b.doc.querySelector("[data-rule-tier-field]")?.hidden).toBe(false);
    b.byId("lg-r-action").value = "exclude";
    b.byId("lg-a-rule-add").click();
    await b.settle();
    expect(b.writes().map((c) => c.method)).toEqual(["PATCH"]);
    expect(b.writes()[0]?.url).toContain(encodeURIComponent(s.rules.tier));
    const row = ruleRow(s, s.rules.tier);
    expect(row["action"]).toBe("exclude");
    expect(JSON.parse(row["tiers_json"] as string)).toEqual({ tiers: [{ offer_ids: [s.ids.fora, s.ids.honest].sort((x, y) => x - y) }] });
  });

  it("a Carrier-level rule: carrier match and \"Overrides other rules\" load; a new priority saves in place", async () => {
    const s = await seed();
    const b = await boot(s);
    editButton(b, s.rules.carrier).click();
    expect(b.byId("lg-r-level").value).toBe("carrier");
    expect(JSON.parse(b.byId("lg-r-carrier-match").value)).toEqual({ carrier_keys: ["acme"] });
    expect(b.byId("lg-r-strictly").checked).toBe(true);
    b.byId("lg-r-priority").value = "35";
    b.byId("lg-a-rule-add").click();
    await b.settle();
    expect(b.writes().map((c) => c.method)).toEqual(["PATCH"]);
    expect(ruleRow(s, s.rules.carrier)["priority"]).toBe(35);
    expect(ruleRow(s, s.rules.carrier)["strictly_override"]).toBe(1);
  });

  it("review fix: a Carrier-level rule saved with no match keeps it empty on an edit (no {} written)", async () => {
    const s = await seed();
    s.sdb.prepare("UPDATE leadgen_auction_rules SET carrier_match_json = NULL WHERE public_id = ?").run(s.rules.carrier);
    const b = await boot(s);
    editButton(b, s.rules.carrier).click();
    expect(b.byId("lg-r-carrier-match").value).toBe("");
    b.byId("lg-r-priority").value = "36";
    b.byId("lg-a-rule-add").click();
    await b.settle();
    expect(b.writes()[0]?.body).not.toHaveProperty("carrier_match_json");
    expect(ruleRow(s, s.rules.carrier)["carrier_match_json"]).toBeNull();
    expect(ruleRow(s, s.rules.carrier)["priority"]).toBe(36);
  });

  it("an Offer-level rule can become a waterfall (Q2: level and action may change); the rule keeps its id", async () => {
    const s = await seed();
    const before = ruleRow(s, s.rules.offer);
    const b = await boot(s);
    editButton(b, s.rules.offer).click();
    const action = b.byId("lg-r-action");
    action.value = "waterfall";
    action.fire("change"); // the form adds two empty tiers for a new waterfall
    const tiers = b.byId("lg-r-tiers").querySelectorAll("[data-tier]");
    expect(tiers.length).toBe(2);
    (tiers[0]?.querySelector(`[data-tier-offer][value="${s.ids.fora}"]`) as MiniNode).checked = true;
    (tiers[1] as MiniNode).querySelector("[data-tier-remove]")?.click();
    b.byId("lg-r-share").value = "10";
    b.byId("lg-a-rule-add").click();
    await b.settle();
    expect(b.writes().map((c) => c.method)).toEqual(["PATCH"]);
    const after = ruleRow(s, s.rules.offer);
    expect(after["id"]).toBe(before["id"]);
    expect(after["action"]).toBe("waterfall");
    expect(after["target_offer_id"]).toBeNull();
    expect(after["traffic_share_pct"]).toBe(10);
  });

  it("Cancel returns the form to \"Add a rule\" with empty fields; \"Add rule\" then creates a new rule (POST)", async () => {
    const s = await seed();
    const b = await boot(s);
    editButton(b, s.rules.waterfall).click();
    b.byId("lg-a-rule-cancel").click();
    expect(b.byId("lg-a-rule-heading").textContent).toBe("Add a rule");
    expect(b.byId("lg-a-rule-add").textContent).toBe("Add rule");
    expect(b.byId("lg-a-rule-cancel").hidden).toBe(true);
    expect(b.byId("lg-r-action").value).toBe("include_only");
    expect(b.byId("lg-r-share").value).toBe("");
    expect(b.byId("lg-r-priority").value).toBe("100");
    expect(b.byId("lg-r-tiers").querySelectorAll("[data-tier]")).toHaveLength(0);
    expect(b.conditions()).toEqual({ groups: [] });
    b.byId("lg-r-target-offer").value = String(s.ids.fundera);
    b.byId("lg-a-rule-add").click();
    await b.settle();
    expect(b.writes().map((c) => `${c.method} ${c.url}`)).toEqual([`POST /api/admin/leadgen/auctions/${encodeURIComponent(s.auctionPub)}/rules`]);
    expect((s.sdb.prepare("SELECT COUNT(*) n FROM leadgen_auction_rules").get() as { n: number }).n).toBe(6);
    expect(ruleRow(s, s.rules.waterfall)["traffic_share_pct"]).toBe(50); // untouched
  });

  it("an offer that left the auction: an Offer-level target is kept; a waterfall tier drops it and says so", async () => {
    const s = await seed();
    s.sdb.prepare("UPDATE leadgen_auction_offers SET enabled = 0 WHERE offer_id = ?").run(s.ids.amone);
    const b = await boot(s);
    editButton(b, s.rules.offer).click();
    expect(b.byId("lg-r-target-offer").value).toBe(String(s.ids.amone));
    expect(b.doc.querySelector("[data-rule-temp-target]")?.textContent).toBe(`offer ${s.ids.amone} (not running in this auction)`);
    editButton(b, s.rules.waterfall).click();
    expect(b.doc.querySelector("[data-rule-temp-target]")).toBeNull(); // the stand-in option is gone again
    const msg = b.byId("lg-a-rule-msg");
    expect(msg.hidden).toBe(false);
    expect(msg.className).toBe("alert alert-warning");
    expect(msg.textContent).toContain(`Offer ${s.ids.amone} no longer runs in this auction`);
    // review fix: saving asks first; "Cancel" in that question saves nothing
    b.confirmAnswer = false;
    b.byId("lg-a-rule-add").click();
    await b.settle();
    expect(b.writes()).toEqual([]);
    b.confirmAnswer = true;
    b.byId("lg-a-rule-add").click();
    await b.settle();
    expect(b.writes().map((c) => c.method)).toEqual(["PATCH"]);
  });
});
