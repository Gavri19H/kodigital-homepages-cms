// F11 (backlog F11, plan approved "Final" 11 Nov 2026, updated 19 Nov 2026) —
// Auction → (an Auction) → "Funnel eligibility rules" → "Redirect to offer":
// "When to redirect" ("Straight away, before the auction" / "After the offer
// is shown"), "Show the offer for (seconds)" and "What the visitor sees".
//
// 1. The save, through the REAL admin API (POST / PATCH /variants/:id/rules,
//    the variant PUT replace-set, duplicate) over a node:sqlite D1 with the
//    repo's leadgen migrations: 2..30 whole seconds, "After" needs an Offer
//    and refuses a raw URL, the display is a closed value — each refused with
//    a plain message; any Offer (a Provider Offer with no URL of its own
//    included) is allowed with "After"; "Straight away" is checked exactly as
//    today; "Edit" saves every value; a database without 0066 still saves
//    ordinary rules.
// 2. The rule window, by running the Auction editor page's OWN script in
//    node:vm on the REAL rendered page (test/helpers/mini-dom.ts), its fetch
//    calls answered by the REAL admin router: the choices and their starting
//    values, every Offer pickable with "After", the raw URL hidden, the list
//    chip "Redirect {%} → {Offer} · after {n} s", and "Edit" reopening every
//    saved value.
//
// Offers (recorded names from the plan's Section 2 table): "Honest Loans - OW"
// (fixed address), "Fundera - Tier 1" (Provider, CPL, a personal link per
// visitor — no URL of its own), "QuinStreetHome" (Provider, CPC).

import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { miniDocument, type MiniDocument, type MiniNode } from "./helpers/mini-dom";

// --- node:sqlite harness (repo pattern) -------------------------------------------

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
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
        for (const s of statements) results.push(await s.run());
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
const MIGRATIONS_DIR = join(TEST_DIR, "..", "migrations");
const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(opts: { before?: number } = {}): { sdb: SqliteDb; env: Env } {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_leadgen_.*\.sql$/.test(f))
    .filter((f) => Number(f.slice(0, 4)) >= 36 && (opts.before === undefined || Number(f.slice(0, 4)) < opts.before))
    .sort();
  for (const f of files) runSql(sdb, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
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
    LEADGEN_REDIRECT_URL_ALLOWLIST: "partner.example.com",
  } as unknown as Env;
  return { sdb, env };
}

const API = "/api/admin/leadgen";
async function req(env: Env, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const init: RequestInit = body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await admin.request(`${API}${path}`, init, env);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

// --- seed -------------------------------------------------------------------------

interface Offer { id: number; public_id: string; name: string }
interface Seeded {
  sdb: SqliteDb;
  env: Env;
  quote: { id: number; public_id: string };
  auctionPub: string;
  funnelPub: string;
  variant: { id: number; public_id: string };
  honest: Offer;
  fundera: Offer;
  quinstreet: Offer;
}

function insertOffer(sdb: SqliteDb, name: string, provider: string | null, callsProvider: boolean, bannerUrlTemplate: string | null): Offer {
  const publicId = mintPublicId("offer");
  sdb
    .prepare(
      `INSERT INTO leadgen_offers (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
         calls_provider_api, bid_source, request_execution_mode, static_bid_value, static_bid_currency, banner_url_template, status)
       VALUES (?, ?, ?, 'quote_funnel', 'life', 's2s_postback', ?, ?, ?, 'server', ?, 'USD', ?, 'active')`,
    )
    .run(publicId, name, provider, callsProvider ? "cpc" : "cpl", callsProvider ? 1 : 0, callsProvider ? "response" : "static", callsProvider ? null : 100, bannerUrlTemplate);
  return { id: (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as { id: number }).id, public_id: publicId, name };
}

async function seed(opts: { before?: number } = {}): Promise<Seeded> {
  const { sdb, env } = newHarness(opts);
  const q = await req(env, "POST", "/quotes", { quote_name: "SMB Loans", activity: "quote_funnel", verticals: ["life"] });
  expect(q.status, JSON.stringify(q.json)).toBe(201);
  const quote = { id: q.json["id"] as number, public_id: q.json["public_id"] as string };
  const a = await req(env, "POST", "/auctions", { auction_name: "A Bussines loans", quote_id: quote.id, auction_type: "dynamic" });
  expect(a.status, JSON.stringify(a.json)).toBe(201);
  const auctionId = a.json["id"] as number;
  const funnelPub = mintPublicId("funnel");
  sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status, display_order) VALUES (?, ?, 'Business Loans Match', 'active', 1)").run(funnelPub, quote.id);
  const funnelId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(funnelPub) as { id: number }).id;
  const variantPub = mintPublicId("funnel_variant");
  sdb
    .prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status, content_version, auction_id) VALUES (?, ?, 'A', 10000, 'default', 'active', 1, ?)")
    .run(variantPub, funnelId, auctionId);
  const variantId = (sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ?").get(variantPub) as { id: number }).id;
  return {
    sdb,
    env,
    quote,
    auctionPub: a.json["public_id"] as string,
    funnelPub,
    variant: { id: variantId, public_id: variantPub },
    honest: insertOffer(sdb, "Honest Loans - OW", "Honest Loans", false, "https://www.honestloans.net/apply?sub={click_id}"),
    fundera: insertOffer(sdb, "Fundera - Tier 1", null, true, null),
    quinstreet: insertOffer(sdb, "QuinStreetHome", null, true, null),
  };
}

function ruleRow(s: Seeded, publicId: string): Record<string, unknown> {
  return s.sdb.prepare("SELECT * FROM leadgen_funnel_rules WHERE public_id = ?").get(publicId) as Record<string, unknown>;
}

const SECONDS_MESSAGE = "“Show the offer for (seconds)” must be a whole number from 2 to 30.";
const NEEDS_OFFER_MESSAGE = "“After the offer is shown” needs an offer: pick the offer to show in “Redirect to offer”.";
const NO_RAW_URL_MESSAGE =
  "“After the offer is shown” can’t use a raw redirect URL, because a URL has no offer card to show. Remove the URL, or choose “Straight away, before the auction”.";
const DISPLAY_MESSAGE = "“What the visitor sees” must be “The redirect banner” or “Only the animation”.";

const AFTER = (s: Seeded, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  rule_type: "redirect_direct_offer",
  rule_name: "Show Fundera, then open it",
  conditions_json: { groups: [] },
  target_offer_id: s.fundera.id,
  redirect_pct: 50,
  redirect_show_seconds: 5,
  redirect_display: "banner",
  ...extra,
});

// ===========================================================================
// 1. The save
// ===========================================================================

describeDb("F11 rule save — \"After the offer is shown\"", () => {
  it("any Offer can be the target with \"After\" — a Provider Offer with no URL of its own saves, and reloads as 5 s + banner", async () => {
    const s = await seed();
    for (const offer of [s.fundera, s.quinstreet, s.honest]) {
      const res = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, AFTER(s, { target_offer_id: offer.id }));
      expect(res.status, JSON.stringify(res.json)).toBe(201);
      expect(res.json).toMatchObject({ target_offer_id: offer.id, redirect_show_seconds: 5, redirect_display: "banner", redirect_pct: 50 });
    }
    const list = await req(s.env, "GET", `/variants/${s.variant.public_id}/rules`);
    const items = list.json["items"] as Array<Record<string, unknown>>;
    expect(items.map((r) => [r["target_offer_id"], r["redirect_show_seconds"], r["redirect_display"]])).toEqual([
      [s.fundera.id, 5, "banner"],
      [s.quinstreet.id, 5, "banner"],
      [s.honest.id, 5, "banner"],
    ]);
  });

  it("refuses 1 and 31 (and 2.5, and a word) with a plain message; accepts 2 and 30", async () => {
    const s = await seed();
    for (const bad of [1, 31, 2.5, 0, -5, "five"]) {
      const res = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, AFTER(s, { redirect_show_seconds: bad }));
      expect(res.status, String(bad)).toBe(400);
      expect(res.json["fields"]).toEqual({ redirect_show_seconds: SECONDS_MESSAGE });
    }
    for (const ok of [2, 30]) {
      const res = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, AFTER(s, { redirect_show_seconds: ok }));
      expect(res.status, String(ok)).toBe(201);
      expect(ruleRow(s, res.json["public_id"] as string)["redirect_show_seconds"]).toBe(ok);
    }
  });

  it("refuses \"After\" with no Offer, and \"After\" with a raw redirect URL, each with a plain message", async () => {
    const s = await seed();
    const noOffer = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, AFTER(s, { target_offer_id: null }));
    expect(noOffer.status).toBe(400);
    expect(noOffer.json["fields"]).toEqual({ target_offer_id: NEEDS_OFFER_MESSAGE });
    const rawUrl = await req(
      s.env,
      "POST",
      `/variants/${s.variant.public_id}/rules`,
      AFTER(s, { redirect_url: "https://partner.example.com/land", redirect_url_allowlisted: true }),
    );
    expect(rawUrl.status).toBe(400);
    expect(rawUrl.json["fields"]).toEqual({ redirect_url: NO_RAW_URL_MESSAGE });
    expect((s.sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_funnel_rules").get() as { n: number }).n).toBe(0);
  });

  it("\"What the visitor sees\": 'banner' and 'animation' save; anything else is refused with a plain message", async () => {
    const s = await seed();
    const anim = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, AFTER(s, { redirect_display: "animation" }));
    expect(anim.status).toBe(201);
    expect(ruleRow(s, anim.json["public_id"] as string)["redirect_display"]).toBe("animation");
    const bad = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, AFTER(s, { redirect_display: "video" }));
    expect(bad.status).toBe(400);
    expect(bad.json["fields"]).toEqual({ redirect_display: DISPLAY_MESSAGE });
  });

  it("[compat] \"Straight away\" is checked exactly as today: a Provider Offer with no URL of its own is refused, a fixed-address Offer saves with no seconds", async () => {
    const s = await seed();
    const provider = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, AFTER(s, { redirect_show_seconds: null, redirect_display: null }));
    expect(provider.status).toBe(400);
    expect(JSON.stringify(provider.json)).toContain("has no URL of its own");
    const fixed = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, {
      rule_type: "redirect_direct_offer", conditions_json: { groups: [] }, target_offer_id: s.honest.id, redirect_pct: 100,
    });
    expect(fixed.status).toBe(201);
    expect(fixed.json["redirect_show_seconds"] ?? null).toBeNull();
  });

  it("a \"Straight away\" rule keeps no display, and other rule types never carry the redirect values", async () => {
    const s = await seed();
    const straight = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, {
      rule_type: "redirect_direct_offer", conditions_json: { groups: [] }, target_offer_id: s.honest.id, redirect_pct: 100, redirect_display: "animation",
    });
    expect(straight.status).toBe(201);
    expect(ruleRow(s, straight.json["public_id"] as string)).toMatchObject({ redirect_show_seconds: null, redirect_display: null });
    const elig = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, {
      rule_type: "eligibility", conditions_json: { groups: [] }, redirect_show_seconds: 7, redirect_display: "banner",
    });
    expect(elig.status).toBe(201);
    expect(ruleRow(s, elig.json["public_id"] as string)).toMatchObject({ redirect_show_seconds: null, redirect_display: null });
  });
});

describeDb("F11 rule save — \"Edit\" saves every value, the new ones included", () => {
  it("Offer, timing, seconds, display, Redirect %, conditions, priority and on/off all save and reload", async () => {
    const s = await seed();
    const created = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, AFTER(s));
    const pub = created.json["public_id"] as string;
    const patch = await req(s.env, "PATCH", `/variants/${s.variant.public_id}/rules/${pub}`, {
      target_offer_id: s.quinstreet.id,
      redirect_show_seconds: 8,
      redirect_display: "animation",
      redirect_pct: 75,
      conditions_json: { groups: [{ field: "device", op: "eq", value: "mobile" }] },
      priority: 3,
      status: "disabled",
    });
    expect(patch.status, JSON.stringify(patch.json)).toBe(200);
    const list = await req(s.env, "GET", `/variants/${s.variant.public_id}/rules`);
    expect((list.json["items"] as Array<Record<string, unknown>>)[0]).toMatchObject({
      public_id: pub,
      target_offer_id: s.quinstreet.id,
      redirect_show_seconds: 8,
      redirect_display: "animation",
      redirect_pct: 75,
      conditions_json: { groups: [{ field: "device", op: "eq", value: "mobile" }] },
      priority: 3,
      status: "disabled",
      enabled: false,
    });
  });

  it("an edit that leaves them alone (on/off, a rename) keeps the seconds and the display", async () => {
    const s = await seed();
    const created = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, AFTER(s, { redirect_show_seconds: 9, redirect_display: "animation" }));
    const pub = created.json["public_id"] as string;
    expect((await req(s.env, "PATCH", `/variants/${s.variant.public_id}/rules/${pub}`, { status: "disabled" })).status).toBe(200);
    expect((await req(s.env, "PATCH", `/variants/${s.variant.public_id}/rules/${pub}`, { rule_name: "Renamed" })).status).toBe(200);
    expect(ruleRow(s, pub)).toMatchObject({ redirect_show_seconds: 9, redirect_display: "animation", status: "disabled", rule_name: "Renamed" });
  });

  it("switching back to \"Straight away\" clears the seconds and the display — and brings back the own-URL check", async () => {
    const s = await seed();
    const created = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, AFTER(s, { redirect_display: "animation" }));
    const pub = created.json["public_id"] as string;
    const refused = await req(s.env, "PATCH", `/variants/${s.variant.public_id}/rules/${pub}`, { redirect_show_seconds: null, redirect_display: null });
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.json)).toContain("has no URL of its own");
    expect(ruleRow(s, pub)["redirect_show_seconds"]).toBe(5); // unchanged
    const ok = await req(s.env, "PATCH", `/variants/${s.variant.public_id}/rules/${pub}`, { redirect_show_seconds: null, redirect_display: null, target_offer_id: s.honest.id });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(ruleRow(s, pub)).toMatchObject({ redirect_show_seconds: null, redirect_display: null, target_offer_id: s.honest.id });
  });

  it("an edit to 31 seconds is refused with the plain message and the rule stays as it was", async () => {
    const s = await seed();
    const created = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, AFTER(s));
    const pub = created.json["public_id"] as string;
    const before = ruleRow(s, pub);
    const res = await req(s.env, "PATCH", `/variants/${s.variant.public_id}/rules/${pub}`, { redirect_show_seconds: 31 });
    expect(res.status).toBe(400);
    expect(res.json["fields"]).toEqual({ redirect_show_seconds: SECONDS_MESSAGE });
    expect(ruleRow(s, pub)).toEqual(before);
  });

  it("\"Duplicate\" and the variant save (replace-set) keep \"After\" rules as they are", async () => {
    const s = await seed();
    const created = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, AFTER(s, { redirect_show_seconds: 7, redirect_display: "animation" }));
    const dup = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules/${created.json["public_id"] as string}/duplicate`);
    expect(dup.status).toBe(201);
    expect(ruleRow(s, dup.json["public_id"] as string)).toMatchObject({ target_offer_id: s.fundera.id, redirect_show_seconds: 7, redirect_display: "animation" });

    const put = await req(s.env, "PUT", `/variants/${s.variant.public_id}`, { rules: [AFTER(s, { redirect_show_seconds: 12 })] });
    expect(put.status, JSON.stringify(put.json)).toBe(200);
    const rows = s.sdb.prepare("SELECT target_offer_id, redirect_show_seconds, redirect_display FROM leadgen_funnel_rules WHERE variant_id = ?").all(s.variant.id);
    expect(rows).toEqual([{ target_offer_id: s.fundera.id, redirect_show_seconds: 12, redirect_display: "banner" }]);
    const putBad = await req(s.env, "PUT", `/variants/${s.variant.public_id}`, { rules: [AFTER(s, { redirect_show_seconds: 1 })] });
    expect(putBad.status).toBe(400);
    expect(putBad.json["fields"]).toMatchObject({ "rules.0.redirect_show_seconds": SECONDS_MESSAGE });
  });

  it("[compat] a database without 0066 still creates, edits and duplicates ordinary rules", async () => {
    const s = await seed({ before: 66 });
    const cols = (s.sdb.prepare("PRAGMA table_info(leadgen_funnel_rules)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).not.toContain("redirect_show_seconds");
    const created = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, {
      rule_type: "redirect_direct_offer", conditions_json: { groups: [] }, target_offer_id: s.honest.id, redirect_pct: 100, rule_name: "To Honest",
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const pub = created.json["public_id"] as string;
    expect((await req(s.env, "PATCH", `/variants/${s.variant.public_id}/rules/${pub}`, { status: "disabled", redirect_pct: 40 })).status).toBe(200);
    expect(ruleRow(s, pub)).toMatchObject({ status: "disabled", redirect_pct: 40 });
    expect((await req(s.env, "POST", `/variants/${s.variant.public_id}/rules/${pub}/duplicate`)).status).toBe(201);
    const elig = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, { rule_type: "eligibility", conditions_json: { groups: [] } });
    expect(elig.status).toBe(201);
  });
});

// ===========================================================================
// 2. The rule window (the Auction editor page's own script, in node:vm)
// ===========================================================================

interface Booted {
  doc: MiniDocument;
  calls: Array<{ method: string; url: string; body: Record<string, unknown> | null }>;
  writes: () => Array<{ method: string; url: string; body: Record<string, unknown> | null }>;
  byId: (id: string) => MiniNode;
  settle: () => Promise<void>;
}

async function boot(s: Seeded): Promise<Booted> {
  const res = await admin.request(`/admin/leadgen/auction/${s.auctionPub}/edit`, {}, s.env);
  expect(res.status).toBe(200);
  const html = await res.text();
  const doc = miniDocument(html);
  const script = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !(m[1] ?? "").includes("application/json"))
    .map((m) => m[2] ?? "")
    .find((src) => src.includes("getElementById('lg-frr-root')"));
  expect(script, "the rule window's script is on the page").toBeDefined();
  const calls: Booted["calls"] = [];
  const pending: Array<Promise<unknown>> = [];
  const timers: Array<() => void> = [];
  const fetchStub = (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null });
    const p = Promise.resolve(admin.request(url, { method, headers: init.headers as HeadersInit, body: init.body as BodyInit | undefined }, s.env));
    pending.push(p);
    return p;
  };
  const windowObj: Record<string, unknown> = {
    location: { reload: () => undefined, href: `http://localhost/admin/leadgen/auction/${s.auctionPub}/edit` },
    confirm: () => true,
    setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; },
    innerWidth: 1280,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    requestAnimationFrame: (fn: () => void) => { timers.push(fn); return timers.length; },
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    matchMedia: () => ({ matches: false, addListener: () => undefined, addEventListener: () => undefined }),
  };
  runInNewContext(script as string, { window: windowObj, document: doc, fetch: fetchStub, setTimeout: windowObj["setTimeout"], Promise, console });
  const settle = async (): Promise<void> => {
    let quiet = 0;
    for (let i = 0; i < 500 && quiet < 10; i++) {
      while (timers.length > 0) (timers.shift() as () => void)();
      const inFlight = pending.splice(0);
      if (inFlight.length > 0) { quiet = 0; await Promise.all(inFlight); } else quiet += 1;
      await new Promise((r) => setImmediate(r));
    }
  };
  const byId = (id: string): MiniNode => {
    const el = doc.getElementById(id);
    expect(el, `#${id} on the page`).not.toBeNull();
    return el as MiniNode;
  };
  await settle();
  // the Auction's own quote is pre-selected; pick its funnel and variant
  const funnelSel = byId("lg-frr-funnel");
  funnelSel.value = s.funnelPub;
  funnelSel.fire("change");
  const variantSel = byId("lg-frr-variant");
  variantSel.value = s.variant.public_id;
  variantSel.fire("change");
  await settle();
  return { doc, calls, writes: () => calls.filter((c) => c.method !== "GET"), byId, settle };
}

function offerOption(b: Booted, offer: Offer): MiniNode {
  const opt = b.byId("lg-frr-offer").querySelectorAll("option").find((o) => o.value === String(offer.id));
  expect(opt, `${offer.name} in the Offer list`).toBeDefined();
  return opt as MiniNode;
}
function chooseAfter(b: Booted): void {
  b.byId("lg-frr-timing-now").checked = false;
  b.byId("lg-frr-timing-after").checked = true;
  b.byId("lg-frr-timing-after").fire("change");
}
function rowFor(b: Booted, publicId: string): MiniNode {
  const tr = b.doc.querySelector(`[data-rule-public-id="${publicId}"]`);
  expect(tr, "the rule's row in the list").not.toBeNull();
  return tr as MiniNode;
}

describeDb("F11 rule window — \"When to redirect\"", () => {
  it("a new \"Redirect to offer\" rule starts on \"Straight away, before the auction\": today's window (no-URL Offers greyed out, raw URL available)", async () => {
    const s = await seed();
    const b = await boot(s);
    (b.doc.querySelector("[data-lg-frr-new]") as MiniNode).click();
    b.byId("lg-frr-type").value = "redirect_direct_offer";
    b.byId("lg-frr-type").fire("change");

    const timing = b.doc.querySelector("[data-lg-frr-timing]") as MiniNode;
    expect(timing.querySelector("legend")?.textContent).toBe("When to redirect");
    expect(timing.querySelectorAll("label").map((l) => l.textContent.trim())).toEqual(["Straight away, before the auction", "After the offer is shown"]);
    expect(b.byId("lg-frr-timing-now").checked).toBe(true);
    expect(b.byId("lg-frr-timing-after").checked).toBe(false);
    expect((b.doc.querySelector("[data-lg-frr-after]") as MiniNode).hidden).toBe(true);
    expect((b.doc.querySelector("[data-lg-frr-raw-url]") as MiniNode).hidden).toBe(false);
    expect(offerOption(b, s.fundera).disabled).toBe(true);
    expect(offerOption(b, s.fundera).textContent).toBe("Fundera - Tier 1 (no URL of its own)");
    expect(offerOption(b, s.honest).disabled).toBe(false);
  });

  it("\"After the offer is shown\": seconds start at 5, \"The redirect banner\" is chosen, the Template note shows, every Offer can be picked, and the raw URL is hidden", async () => {
    const s = await seed();
    const b = await boot(s);
    (b.doc.querySelector("[data-lg-frr-new]") as MiniNode).click();
    b.byId("lg-frr-type").value = "redirect_direct_offer";
    b.byId("lg-frr-type").fire("change");
    chooseAfter(b);

    const after = b.doc.querySelector("[data-lg-frr-after]") as MiniNode;
    expect(after.hidden).toBe(false);
    expect(after.querySelector('label[for="lg-frr-seconds"]')?.textContent).toBe("Show the offer for (seconds)");
    expect(b.byId("lg-frr-seconds").value).toBe("5");
    expect(after.querySelector("legend")?.textContent).toBe("What the visitor sees");
    expect(after.querySelectorAll("label.lg-check").map((l) => l.textContent.trim())).toEqual(["The redirect banner", "Only the animation"]);
    expect(b.byId("lg-frr-display-banner").checked).toBe(true);
    expect(after.textContent).toContain("The look of both is set in the funnel's Template → \"L · Redirect\".");
    for (const offer of [s.honest, s.fundera, s.quinstreet]) {
      expect(offerOption(b, offer).disabled, offer.name).toBe(false);
      expect(offerOption(b, offer).textContent).toBe(offer.name);
    }
    expect((b.doc.querySelector("[data-lg-frr-raw-url]") as MiniNode).hidden).toBe(true);
  });

  it("Save sends the timing, seconds and look; the list chip reads \"Redirect 50% → Fundera - Tier 1 · after 5 s\"", async () => {
    const s = await seed();
    const b = await boot(s);
    (b.doc.querySelector("[data-lg-frr-new]") as MiniNode).click();
    b.byId("lg-frr-name").value = "Fundera match";
    b.byId("lg-frr-type").value = "redirect_direct_offer";
    b.byId("lg-frr-type").fire("change");
    chooseAfter(b);
    b.byId("lg-frr-offer").value = String(s.fundera.id);
    b.byId("lg-frr-redirect-pct").value = "50";
    (b.doc.querySelector("[data-lg-frr-save]") as MiniNode).click();
    await b.settle();

    expect(b.writes().map((w) => w.method)).toEqual(["POST"]);
    expect(b.writes()[0]?.body).toMatchObject({
      rule_type: "redirect_direct_offer",
      target_offer_id: s.fundera.id,
      redirect_pct: 50,
      redirect_show_seconds: 5,
      redirect_display: "banner",
      redirect_url: null,
    });
    const row = s.sdb.prepare("SELECT public_id, target_offer_id, redirect_pct, redirect_show_seconds, redirect_display FROM leadgen_funnel_rules").get() as Record<string, unknown>;
    expect(row).toMatchObject({ target_offer_id: s.fundera.id, redirect_pct: 50, redirect_show_seconds: 5, redirect_display: "banner" });
    expect(b.byId("lg-frr-modal").hidden).toBe(true);
    expect(rowFor(b, row["public_id"] as string).querySelector(".lg-frr-chip")?.textContent).toBe("Redirect 50% → Fundera - Tier 1 · after 5 s");
  });

  it("[compat] a \"Straight away\" rule's chip has no timing: \"Redirect 100% → Honest Loans - OW\"", async () => {
    const s = await seed();
    const created = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, {
      rule_type: "redirect_direct_offer", conditions_json: { groups: [] }, target_offer_id: s.honest.id, redirect_pct: 100,
    });
    const b = await boot(s);
    expect(rowFor(b, created.json["public_id"] as string).querySelector(".lg-frr-chip")?.textContent).toBe("Redirect 100% → Honest Loans - OW");
  });

  it("\"Edit\" reopens the window with every saved value filled in, and saves a change in place", async () => {
    const s = await seed();
    const created = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, AFTER(s, { redirect_show_seconds: 9, redirect_display: "animation", priority: 4, match_mode: "any" }));
    const pub = created.json["public_id"] as string;
    const b = await boot(s);
    expect(rowFor(b, pub).querySelector(".lg-frr-chip")?.textContent).toBe("Redirect 50% → Fundera - Tier 1 · after 9 s");
    (rowFor(b, pub).querySelector("[data-frr-edit]") as MiniNode).click();
    await b.settle();

    expect(b.byId("lg-frr-modal-title").textContent).toBe("Edit rule");
    expect(b.byId("lg-frr-name").value).toBe("Show Fundera, then open it");
    expect(b.byId("lg-frr-type").value).toBe("redirect_direct_offer");
    expect(b.byId("lg-frr-priority").value).toBe("4");
    expect(b.byId("lg-frr-match").value).toBe("any");
    expect(b.byId("lg-frr-timing-after").checked).toBe(true);
    expect(b.byId("lg-frr-timing-now").checked).toBe(false);
    expect((b.doc.querySelector("[data-lg-frr-after]") as MiniNode).hidden).toBe(false);
    expect(b.byId("lg-frr-seconds").value).toBe("9");
    expect(b.byId("lg-frr-display-animation").checked).toBe(true);
    expect(b.byId("lg-frr-display-banner").checked).toBe(false);
    expect(b.byId("lg-frr-offer").value).toBe(String(s.fundera.id));
    expect(offerOption(b, s.fundera).disabled).toBe(false);
    expect(b.byId("lg-frr-redirect-pct").value).toBe("50");

    b.byId("lg-frr-seconds").value = "12";
    b.byId("lg-frr-display-animation").checked = false;
    b.byId("lg-frr-display-banner").checked = true;
    (b.doc.querySelector("[data-lg-frr-save]") as MiniNode).click();
    await b.settle();
    expect(b.writes().map((w) => w.method)).toEqual(["PATCH"]);
    expect(ruleRow(s, pub)).toMatchObject({ redirect_show_seconds: 12, redirect_display: "banner", target_offer_id: s.fundera.id, priority: 4, match_mode: "any" });
  });

  it("a refused save shows the server's plain message in the window (1 second), and an empty seconds box is refused before sending", async () => {
    const s = await seed();
    const b = await boot(s);
    (b.doc.querySelector("[data-lg-frr-new]") as MiniNode).click();
    b.byId("lg-frr-type").value = "redirect_direct_offer";
    b.byId("lg-frr-type").fire("change");
    chooseAfter(b);
    b.byId("lg-frr-offer").value = String(s.quinstreet.id);
    b.byId("lg-frr-redirect-pct").value = "100";
    b.byId("lg-frr-seconds").value = "1";
    (b.doc.querySelector("[data-lg-frr-save]") as MiniNode).click();
    await b.settle();
    expect(b.byId("lg-frr-error").hidden).toBe(false);
    expect(b.byId("lg-frr-error").textContent).toBe(SECONDS_MESSAGE);
    expect(b.byId("lg-frr-modal").hidden).toBe(false);

    b.byId("lg-frr-seconds").value = "";
    (b.doc.querySelector("[data-lg-frr-save]") as MiniNode).click();
    await b.settle();
    expect(b.writes()).toHaveLength(1); // only the first (refused) save went out
    expect(b.byId("lg-frr-error").textContent).toBe(SECONDS_MESSAGE);
    expect((s.sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_funnel_rules").get() as { n: number }).n).toBe(0);
  });
});
