// Send-only Offers (plan "Send-only Offers", migration 0068) — the ADMIN half,
// through the REAL admin router over a node:sqlite D1 built from the repo's
// leadgen migrations.
//
// A "Provider request · static bid (CPL)" Offer can be set to "Send the lead
// only, no card": the lead is posted, the Offer never shows a card, and the
// Provider's reply decides whether the lead was accepted. What these tests hold:
//   1. the Offer API: NULL by default ("Show a card"), canonical JSON for both
//      "Accepted when" choices, field errors for an incomplete field rule, only
//      the static-bid request mode, a logo and a headline required, the setting
//      cleared when the mode moves away, "Show a card" saves NULL, Duplicate
//      copies it, and the computed `send_only` flag pickers read;
//   2. redirects never target a send-only Offer — Funnel rules (create, edit,
//      the variant save) for BOTH timings, and Quote routing rules — while an
//      ordinary Offer still works;
//   3. the Offer's Test button says whether the reply counts as accepted
//      (fetch mocked; nothing leaves the machine), without touching the
//      existing pass/fail verdict.

import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";

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

function kvStub(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) { return store.get(key) ?? null; },
    async put(key: string, value: string) { store.set(key, value); },
    async delete(key: string) { store.delete(key); },
    async list() { return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" }; },
  } as unknown as KVNamespace;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(TEST_DIR, "..", "migrations");
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
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_leadgen_.*\.sql$/.test(f))
    .filter((f) => Number(f.slice(0, 4)) >= 36)
    .sort();
  for (const f of files) runSql(sdb, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  const env = {
    DB: d1FromSqlite(sdb),
    CACHE: kvStub(),
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

type Mode = "static_no_request" | "request_static_bid" | "request_dynamic_bid";
interface Offer { id: number; public_id: string; name: string }

const LOGO = "https://cdn.example.com/logo.png";
const HEADLINE = "Funding in as little as 24 hours";

function insertOffer(
  sdb: SqliteDb,
  opts: {
    name: string;
    mode: Mode;
    logo?: string | null;
    headline?: string | null;
    banner?: string | null;
    sendOnly?: string | null;
    endpoint?: string | null;
  },
): Offer {
  const publicId = mintPublicId("offer");
  const calls = opts.mode === "static_no_request" ? 0 : 1;
  const bidSource = opts.mode === "request_dynamic_bid" ? "response" : "static";
  sdb
    .prepare(
      `INSERT INTO leadgen_offers (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
         calls_provider_api, bid_source, request_execution_mode, static_bid_value, static_bid_currency, banner_url_template,
         static_logo_url, static_headline, send_only_json, endpoint_production, endpoint_staging, request_method, status)
       VALUES (?, ?, NULL, 'quote_funnel', 'life', 's2s_postback', ?, ?, ?, 'server', ?, 'USD', ?, ?, ?, ?, ?, ?, 'POST', 'active')`,
    )
    .run(
      publicId,
      opts.name,
      opts.mode === "request_dynamic_bid" ? "cpc" : "cpl",
      calls,
      bidSource,
      bidSource === "static" ? 25 : null,
      opts.banner === undefined ? "https://partner.example.com/go?sub={click_id}" : opts.banner,
      opts.logo === undefined ? LOGO : opts.logo,
      opts.headline === undefined ? HEADLINE : opts.headline,
      opts.sendOnly ?? null,
      opts.endpoint ?? null,
      opts.endpoint ?? null,
    );
  const id = (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as { id: number }).id;
  sdb
    .prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)")
    .run(mintPublicId("offer_placement"), id, `pl-${id}`);
  return { id, public_id: publicId, name: opts.name };
}

function storedSendOnly(sdb: SqliteDb, offerId: number): unknown {
  return (sdb.prepare("SELECT send_only_json FROM leadgen_offers WHERE id = ?").get(offerId) as { send_only_json: unknown }).send_only_json;
}

const ANY_OK_JSON = '{"display":"send_only","accept":{"kind":"any_ok"}}';
const SEND_ONLY_ANY_OK = { display: "send_only", accept: { kind: "any_ok" } };
const MODE_MESSAGE = 'Send the lead only works with "Provider request · static bid (CPL)".';

// ===========================================================================
// 1. The Offer API
// ===========================================================================

describeDb("Send-only Offers — the Offer API (PATCH /offers/:id)", () => {
  it("an Offer starts as \"Show a card\": stored NULL, send_only false on the detail and the list; {display:\"card\"} keeps NULL", async () => {
    const { sdb, env } = newHarness();
    const o = insertOffer(sdb, { name: "Request CPL", mode: "request_static_bid" });
    const got = await req(env, "GET", `/offers/${o.public_id}`);
    expect(got.status).toBe(200);
    expect(got.json["send_only_json"]).toBeNull();
    expect(got.json["send_only"]).toBe(false);
    const list = await req(env, "GET", "/offers");
    const item = (list.json["items"] as Array<Record<string, unknown>>).find((r) => r["id"] === o.id);
    expect(item?.["send_only"]).toBe(false);

    const card = await req(env, "PATCH", `/offers/${o.id}`, { send_only_json: { display: "card" } });
    expect(card.status, JSON.stringify(card.json)).toBe(200);
    expect(storedSendOnly(sdb, o.id)).toBeNull();
    expect(card.json["send_only"]).toBe(false);
    const other = await req(env, "PATCH", `/offers/${o.id}`, { offer_name: "Renamed" });
    expect(other.status).toBe(200);
    expect(storedSendOnly(sdb, o.id)).toBeNull();
  });

  it("\"Send the lead only, no card\" + \"Any OK reply\" stores the canonical JSON (object or JSON text) and the API says send_only true", async () => {
    const { sdb, env } = newHarness();
    const o = insertOffer(sdb, { name: "Hook Offer", mode: "request_static_bid" });
    const res = await req(env, "PATCH", `/offers/${o.id}`, { send_only_json: { display: "send_only", accept: { kind: "any_ok", field: "ignored" } } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(storedSendOnly(sdb, o.id)).toBe(ANY_OK_JSON);
    expect(res.json["send_only"]).toBe(true);
    expect(res.json["send_only_json"]).toBe(ANY_OK_JSON);

    const o2 = insertOffer(sdb, { name: "Hook Offer 2", mode: "request_static_bid" });
    const asText = await req(env, "PATCH", `/offers/${o2.id}`, { send_only_json: JSON.stringify({ display: "send_only" }) });
    expect(asText.status, JSON.stringify(asText.json)).toBe(200);
    expect(storedSendOnly(sdb, o2.id)).toBe(ANY_OK_JSON);
    const list = await req(env, "GET", "/offers");
    const items = list.json["items"] as Array<Record<string, unknown>>;
    expect(items.find((r) => r["id"] === o.id)?.["send_only"]).toBe(true);
  });

  it("\"A field in the reply equals a value\" stores the trimmed field (a {response:…} chip unwrapped) and value", async () => {
    const { sdb, env } = newHarness();
    const o = insertOffer(sdb, { name: "Field Offer", mode: "request_static_bid" });
    const res = await req(env, "PATCH", `/offers/${o.id}`, {
      send_only_json: { display: "send_only", accept: { kind: "field_equals", field: " {response:result.status} ", value: "  Accepted " } },
    });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(storedSendOnly(sdb, o.id)).toBe('{"display":"send_only","accept":{"kind":"field_equals","field":"result.status","value":"Accepted"}}');
    expect(res.json["send_only"]).toBe(true);
  });

  it("a field rule without its field or value is refused with field errors, and nothing is stored", async () => {
    const { sdb, env } = newHarness();
    const o = insertOffer(sdb, { name: "Field Offer", mode: "request_static_bid" });
    const res = await req(env, "PATCH", `/offers/${o.id}`, {
      send_only_json: { display: "send_only", accept: { kind: "field_equals", field: "  ", value: "" } },
    });
    expect(res.status).toBe(400);
    expect(res.json["fields"]).toEqual({
      send_only_accept_field: "Enter the reply field to check, for example status.",
      send_only_accept_value: "Enter the value that means accepted, for example accepted.",
    });
    expect(storedSendOnly(sdb, o.id)).toBeNull();
    const spaced = await req(env, "PATCH", `/offers/${o.id}`, {
      send_only_json: { display: "send_only", accept: { kind: "field_equals", field: "result status", value: "yes" } },
    });
    expect(spaced.status).toBe(400);
    expect(Object.keys(spaced.json["fields"] as object)).toEqual(["send_only_accept_field"]);
    const badDisplay = await req(env, "PATCH", `/offers/${o.id}`, { send_only_json: { display: "banner" } });
    expect(badDisplay.status).toBe(400);
    expect(badDisplay.json["fields"]).toEqual({ send_only_display: 'Pick "Show a card" or "Send the lead only, no card".' });
    const badKind = await req(env, "PATCH", `/offers/${o.id}`, { send_only_json: { display: "send_only", accept: { kind: "sometimes" } } });
    expect(badKind.status).toBe(400);
    expect(Object.keys(badKind.json["fields"] as object)).toEqual(["send_only_accept_kind"]);
    expect(storedSendOnly(sdb, o.id)).toBeNull();
  });

  it("send-only on any other mode is refused on send_only_display", async () => {
    const { sdb, env } = newHarness();
    const stat = insertOffer(sdb, { name: "Static Offer", mode: "static_no_request" });
    const dyn = insertOffer(sdb, { name: "Dynamic Offer", mode: "request_dynamic_bid" });
    for (const o of [stat, dyn]) {
      const res = await req(env, "PATCH", `/offers/${o.id}`, { send_only_json: SEND_ONLY_ANY_OK });
      expect(res.status).toBe(400);
      expect(res.json["fields"]).toEqual({ send_only_display: MODE_MESSAGE });
      expect(storedSendOnly(sdb, o.id)).toBeNull();
    }
    // asking for send-only AND moving the mode away in one save is refused too
    const req1 = insertOffer(sdb, { name: "Request CPL", mode: "request_static_bid" });
    const both = await req(env, "PATCH", `/offers/${req1.id}`, { send_only_json: SEND_ONLY_ANY_OK, bid_source: "response" });
    expect(both.status).toBe(400);
    expect(both.json["fields"]).toEqual({ send_only_display: MODE_MESSAGE });
    // …while moving a stat Offer INTO the static-bid request mode with it is fine
    const moved = await req(env, "PATCH", `/offers/${stat.id}`, { calls_provider_api: true, bid_source: "static", send_only_json: SEND_ONLY_ANY_OK });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    expect(storedSendOnly(sdb, stat.id)).toBe(ANY_OK_JSON);
  });

  it("a send-only Offer needs a logo and a headline (in the same save is fine; clearing one later is refused)", async () => {
    const { sdb, env } = newHarness();
    const noLogo = insertOffer(sdb, { name: "No Logo", mode: "request_static_bid", logo: null });
    const r1 = await req(env, "PATCH", `/offers/${noLogo.id}`, { send_only_json: SEND_ONLY_ANY_OK });
    expect(r1.status).toBe(400);
    expect(Object.keys(r1.json["fields"] as object)).toEqual(["static_logo_url"]);
    expect((r1.json["fields"] as Record<string, string>)["static_logo_url"]).toContain("needs a logo");

    const noHeadline = insertOffer(sdb, { name: "No Headline", mode: "request_static_bid", headline: null });
    const r2 = await req(env, "PATCH", `/offers/${noHeadline.id}`, { send_only_json: SEND_ONLY_ANY_OK, static_headline: "   " });
    expect(r2.status).toBe(400);
    expect(Object.keys(r2.json["fields"] as object)).toEqual(["static_headline"]);
    expect((r2.json["fields"] as Record<string, string>)["static_headline"]).toContain("needs a headline");

    const neither = insertOffer(sdb, { name: "Bare", mode: "request_static_bid", logo: null, headline: null });
    const r3 = await req(env, "PATCH", `/offers/${neither.id}`, { send_only_json: SEND_ONLY_ANY_OK });
    expect(Object.keys(r3.json["fields"] as object).sort()).toEqual(["static_headline", "static_logo_url"]);
    const r4 = await req(env, "PATCH", `/offers/${neither.id}`, { send_only_json: SEND_ONLY_ANY_OK, static_logo_url: "/media/logo.png", static_headline: HEADLINE });
    expect(r4.status, JSON.stringify(r4.json)).toBe(200);
    expect(storedSendOnly(sdb, neither.id)).toBe(ANY_OK_JSON);

    const cleared = await req(env, "PATCH", `/offers/${neither.id}`, { static_logo_url: null });
    expect(cleared.status).toBe(400);
    expect(Object.keys(cleared.json["fields"] as object)).toEqual(["static_logo_url"]);
    // the same clear on a "Show a card" Offer is fine (unchanged behaviour)
    const card = insertOffer(sdb, { name: "Card", mode: "request_static_bid" });
    expect((await req(env, "PATCH", `/offers/${card.id}`, { static_logo_url: null, static_headline: null })).status).toBe(200);
  });

  it("review fix: a send-only CPL Offer needs a fixed bid (it is the price booked per accepted lead); a CPA one does not", async () => {
    const { sdb, env } = newHarness();
    const o = insertOffer(sdb, { name: "Request CPL", mode: "request_static_bid" });
    sdb.prepare("UPDATE leadgen_offers SET static_bid_value = NULL WHERE id = ?").run(o.id);
    const r1 = await req(env, "PATCH", `/offers/${o.id}`, { send_only_json: SEND_ONLY_ANY_OK });
    expect(r1.status).toBe(400);
    expect((r1.json["fields"] as Record<string, string>)["static_bid_value"]).toContain("needs a fixed bid");
    const r2 = await req(env, "PATCH", `/offers/${o.id}`, { send_only_json: SEND_ONLY_ANY_OK, static_bid_value: 20 });
    expect(r2.status, JSON.stringify(r2.json)).toBe(200);
    // clearing the bid later is refused while the Offer is send-only CPL
    expect((await req(env, "PATCH", `/offers/${o.id}`, { static_bid_value: null })).status).toBe(400);
    // a CPA send-only Offer may leave it empty
    const cpa = insertOffer(sdb, { name: "Request CPA", mode: "request_static_bid" });
    sdb.prepare("UPDATE leadgen_offers SET static_bid_value = NULL, offer_type = 'cpa' WHERE id = ?").run(cpa.id);
    const r3 = await req(env, "PATCH", `/offers/${cpa.id}`, { send_only_json: SEND_ONLY_ANY_OK });
    expect(r3.status, JSON.stringify(r3.json)).toBe(200);
  });

  it("moving a send-only Offer to another mode clears the setting in the same save, and it does not come back", async () => {
    const { sdb, env } = newHarness();
    const o = insertOffer(sdb, { name: "Hook", mode: "request_static_bid", sendOnly: ANY_OK_JSON });
    expect((await req(env, "GET", `/offers/${o.id}`)).json["send_only"]).toBe(true);
    const toDynamic = await req(env, "PATCH", `/offers/${o.id}`, { bid_source: "response" });
    expect(toDynamic.status, JSON.stringify(toDynamic.json)).toBe(200);
    expect(storedSendOnly(sdb, o.id)).toBeNull();
    expect(toDynamic.json["send_only"]).toBe(false);
    const back = await req(env, "PATCH", `/offers/${o.id}`, { bid_source: "static" });
    expect(back.status).toBe(200);
    expect(storedSendOnly(sdb, o.id)).toBeNull();

    const o2 = insertOffer(sdb, { name: "Hook 2", mode: "request_static_bid", sendOnly: ANY_OK_JSON });
    const toStatic = await req(env, "PATCH", `/offers/${o2.id}`, { calls_provider_api: false });
    expect(toStatic.status, JSON.stringify(toStatic.json)).toBe(200);
    expect(storedSendOnly(sdb, o2.id)).toBeNull();
  });

  it("switching back to \"Show a card\" saves NULL (and needs no logo or headline)", async () => {
    const { sdb, env } = newHarness();
    const o = insertOffer(sdb, { name: "Hook", mode: "request_static_bid", sendOnly: ANY_OK_JSON });
    const res = await req(env, "PATCH", `/offers/${o.id}`, { send_only_json: { display: "card", accept: { kind: "field_equals" } }, static_logo_url: null });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(storedSendOnly(sdb, o.id)).toBeNull();
    expect(res.json["send_only"]).toBe(false);
    const o2 = insertOffer(sdb, { name: "Hook 2", mode: "request_static_bid", sendOnly: ANY_OK_JSON });
    expect((await req(env, "PATCH", `/offers/${o2.id}`, { send_only_json: null })).status).toBe(200);
    expect(storedSendOnly(sdb, o2.id)).toBeNull();
  });

  it("Duplicate copies the setting with the Offer", async () => {
    const { sdb, env } = newHarness();
    const stored = '{"display":"send_only","accept":{"kind":"field_equals","field":"status","value":"accepted"}}';
    const o = insertOffer(sdb, { name: "Hook", mode: "request_static_bid", sendOnly: stored });
    const res = await req(env, "POST", `/offers/${o.id}/duplicate`, { default_placement_id: "pl-copy-1" });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const dup = res.json["offer"] as Record<string, unknown>;
    expect(dup["send_only_json"]).toBe(stored);
    expect(dup["send_only"]).toBe(true);
    expect(storedSendOnly(sdb, dup["id"] as number)).toBe(stored);
    // a "Show a card" Offer duplicates as NULL
    const card = insertOffer(sdb, { name: "Card", mode: "request_static_bid" });
    const dupCard = await req(env, "POST", `/offers/${card.id}/duplicate`, { default_placement_id: "pl-copy-2" });
    expect(storedSendOnly(sdb, (dupCard.json["offer"] as Record<string, unknown>)["id"] as number)).toBeNull();
  });
});

// ===========================================================================
// 2. Redirects never target a send-only Offer
// ===========================================================================

interface RuleSeed {
  sdb: SqliteDb;
  env: Env;
  quote: { id: number; public_id: string };
  variant: { id: number; public_id: string };
  normal: Offer; // a static Offer with its own URL — every redirect may use it
  sendOnly: Offer; // send-only, WITH a URL of its own (so only the new check refuses it)
}

async function seedRules(): Promise<RuleSeed> {
  const { sdb, env } = newHarness();
  const q = await req(env, "POST", "/quotes", { quote_name: "Test Quote", activity: "quote_funnel", verticals: ["life"] });
  expect(q.status, JSON.stringify(q.json)).toBe(201);
  const quote = { id: q.json["id"] as number, public_id: q.json["public_id"] as string };
  const a = await req(env, "POST", "/auctions", { auction_name: "Test Auction", quote_id: quote.id, auction_type: "dynamic" });
  expect(a.status, JSON.stringify(a.json)).toBe(201);
  const funnelPub = mintPublicId("funnel");
  sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status, display_order) VALUES (?, ?, 'Main', 'active', 1)").run(funnelPub, quote.id);
  const funnelId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(funnelPub) as { id: number }).id;
  const variantPub = mintPublicId("funnel_variant");
  sdb
    .prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status, content_version, auction_id) VALUES (?, ?, 'A', 10000, 'default', 'active', 1, ?)")
    .run(variantPub, funnelId, a.json["id"] as number);
  const variantId = (sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ?").get(variantPub) as { id: number }).id;
  return {
    sdb,
    env,
    quote,
    variant: { id: variantId, public_id: variantPub },
    normal: insertOffer(sdb, { name: "Fixed Address Offer", mode: "static_no_request" }),
    sendOnly: insertOffer(sdb, { name: "Lead Hook Offer", mode: "request_static_bid", sendOnly: ANY_OK_JSON }),
  };
}

const SEND_ONLY_REDIRECT = (name: string): string =>
  `“${name}” only sends the lead and never shows a card, so a redirect can't open it. Pick another offer.`;

const STRAIGHT = (offerId: number): Record<string, unknown> => ({
  rule_type: "redirect_direct_offer",
  rule_name: "Straight away",
  conditions_json: { groups: [] },
  target_offer_id: offerId,
  redirect_pct: 50,
});
const AFTER = (offerId: number): Record<string, unknown> => ({
  ...STRAIGHT(offerId),
  rule_name: "After shown",
  redirect_show_seconds: 5,
  redirect_display: "banner",
});

describeDb("Send-only Offers — redirects never target one", () => {
  it("Funnel rule create: refused for \"Straight away\" and \"After the offer is shown\"; an ordinary Offer still saves", async () => {
    const s = await seedRules();
    for (const body of [STRAIGHT(s.sendOnly.id), AFTER(s.sendOnly.id)]) {
      const res = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, body);
      expect(res.status).toBe(400);
      expect(res.json["fields"]).toEqual({ target_offer_id: SEND_ONLY_REDIRECT(s.sendOnly.name) });
    }
    expect((s.sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_funnel_rules").get() as { n: number }).n).toBe(0);
    for (const body of [STRAIGHT(s.normal.id), AFTER(s.normal.id)]) {
      const res = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, body);
      expect(res.status, JSON.stringify(res.json)).toBe(201);
    }
    // a non-redirect rule type is not affected by the target's send-only setting
    const elig = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, { rule_type: "eligibility", conditions_json: { groups: [] } });
    expect(elig.status).toBe(201);
    // only a real send-only Offer is refused: a stale setting on a dynamic-bid
    // Offer is ignored (sendOnlyConfigFor), and a "Show a card" Offer is fine
    const stale = insertOffer(s.sdb, { name: "Stale Setting", mode: "request_dynamic_bid", sendOnly: ANY_OK_JSON });
    expect((await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, AFTER(stale.id))).status).toBe(201);
    const card = insertOffer(s.sdb, { name: "Card Offer", mode: "request_static_bid" });
    expect((await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, STRAIGHT(card.id))).status).toBe(201);
  });

  it("Funnel rule edit: re-pointing to a send-only Offer is refused (both timings); an edit that leaves the target alone still saves", async () => {
    const s = await seedRules();
    const straight = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, STRAIGHT(s.normal.id));
    const after = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, AFTER(s.normal.id));
    for (const created of [straight, after]) {
      const pub = created.json["public_id"] as string;
      const res = await req(s.env, "PATCH", `/variants/${s.variant.public_id}/rules/${pub}`, { target_offer_id: s.sendOnly.id });
      expect(res.status).toBe(400);
      expect(res.json["fields"]).toEqual({ target_offer_id: SEND_ONLY_REDIRECT(s.sendOnly.name) });
      const row = s.sdb.prepare("SELECT target_offer_id FROM leadgen_funnel_rules WHERE public_id = ?").get(pub) as { target_offer_id: number };
      expect(row.target_offer_id).toBe(s.normal.id);
    }
    // an older rule whose Offer became send-only later can still be turned off
    const pub = after.json["public_id"] as string;
    s.sdb.prepare("UPDATE leadgen_offers SET calls_provider_api = 1, bid_source = 'static', send_only_json = ? WHERE id = ?").run(ANY_OK_JSON, s.normal.id);
    const off = await req(s.env, "PATCH", `/variants/${s.variant.public_id}/rules/${pub}`, { status: "disabled" });
    expect(off.status, JSON.stringify(off.json)).toBe(200);
  });

  it("the variant save (rules replace-set) refuses a send-only target for both timings, keyed by the Offer", async () => {
    const s = await seedRules();
    for (const rule of [STRAIGHT(s.sendOnly.id), AFTER(s.sendOnly.id)]) {
      const put = await req(s.env, "PUT", `/variants/${s.variant.public_id}`, { rules: [rule] });
      expect(put.status).toBe(400);
      expect((put.json["fields"] as Record<string, string>)[`rules.target_offer_id.${s.sendOnly.id}`]).toBe(SEND_ONLY_REDIRECT(s.sendOnly.name));
    }
    const ok = await req(s.env, "PUT", `/variants/${s.variant.public_id}`, { rules: [STRAIGHT(s.normal.id), AFTER(s.normal.id)] });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
  });

  it("Quote routing rules: a send-only redirect target is refused on create and edit; an ordinary Offer saves", async () => {
    const s = await seedRules();
    const base = { rule_name: "Redirect", conditions_json: { groups: [] }, redirect_pct: 100 };
    const refused = await req(s.env, "POST", `/quotes/${s.quote.public_id}/routing-rules`, { ...base, target_offer_id: s.sendOnly.id });
    expect(refused.status).toBe(400);
    expect(refused.json["fields"]).toMatchObject({ target_offer_id: SEND_ONLY_REDIRECT(s.sendOnly.name) });
    const ok = await req(s.env, "POST", `/quotes/${s.quote.public_id}/routing-rules`, { ...base, target_offer_id: s.normal.id });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    const edit = await req(s.env, "PATCH", `/routing-rules/${ok.json["public_id"] as string}`, { target_offer_id: s.sendOnly.id });
    expect(edit.status).toBe(400);
    expect(edit.json["fields"]).toMatchObject({ target_offer_id: SEND_ONLY_REDIRECT(s.sendOnly.name) });
  });

});

const BLOCKED = (...names: string[]): string =>
  `Redirect rules still open this Offer: ${names.map((n) => `"${n}"`).join(", ")}. Point them at another offer first, because a send-only Offer never shows a card.`;

describeDb("Send-only Offers — an Offer that redirect rules open can't become send-only", () => {
  it("a Funnel \"Redirect to offer\" rule (\"Straight away\", even turned off) blocks it; retargeting the rule lets it save", async () => {
    const s = await seedRules();
    const card = insertOffer(s.sdb, { name: "Card Offer", mode: "request_static_bid" });
    const rule = await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, { ...STRAIGHT(card.id), rule_name: "Send to card", status: "disabled" });
    expect(rule.status, JSON.stringify(rule.json)).toBe(201);
    const refused = await req(s.env, "PATCH", `/offers/${card.id}`, { send_only_json: SEND_ONLY_ANY_OK });
    expect(refused.status).toBe(400);
    expect(refused.json["fields"]).toEqual({ send_only_display: BLOCKED("Send to card") });
    expect(storedSendOnly(s.sdb, card.id)).toBeNull();

    const moved = await req(s.env, "PATCH", `/variants/${s.variant.public_id}/rules/${rule.json["public_id"] as string}`, { target_offer_id: s.normal.id });
    expect(moved.status, JSON.stringify(moved.json)).toBe(200);
    const ok = await req(s.env, "PATCH", `/offers/${card.id}`, { send_only_json: SEND_ONLY_ANY_OK });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    expect(storedSendOnly(s.sdb, card.id)).toBe(ANY_OK_JSON);
  });

  it("an \"After the offer is shown\" rule blocks it too, and so does moving the Offer into the static-bid mode with send-only", async () => {
    const s = await seedRules();
    const card = insertOffer(s.sdb, { name: "Card Offer", mode: "request_static_bid" });
    expect((await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, { ...AFTER(card.id), rule_name: "Show then open" })).status).toBe(201);
    const refused = await req(s.env, "PATCH", `/offers/${card.id}`, { send_only_json: SEND_ONLY_ANY_OK });
    expect(refused.json["fields"]).toEqual({ send_only_display: BLOCKED("Show then open") });

    // a static Offer the rule opens, switched to static-bid + send-only in one save
    expect((await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, { ...AFTER(s.normal.id), rule_name: "Fixed one" })).status).toBe(201);
    const moving = await req(s.env, "PATCH", `/offers/${s.normal.id}`, { calls_provider_api: true, bid_source: "static", send_only_json: SEND_ONLY_ANY_OK });
    expect(moving.status).toBe(400);
    expect(moving.json["fields"]).toEqual({ send_only_display: BLOCKED("Fixed one") });
  });

  it("a Quote routing rule's redirect target blocks it; retargeting it lets it save", async () => {
    const s = await seedRules();
    const card = insertOffer(s.sdb, { name: "Card Offer", mode: "request_static_bid" });
    const qr = await req(s.env, "POST", `/quotes/${s.quote.public_id}/routing-rules`, { rule_name: "Quote redirect", conditions_json: { groups: [] }, redirect_pct: 100, target_offer_id: card.id });
    expect(qr.status, JSON.stringify(qr.json)).toBe(201);
    const refused = await req(s.env, "PATCH", `/offers/${card.id}`, { send_only_json: SEND_ONLY_ANY_OK });
    expect(refused.status).toBe(400);
    expect(refused.json["fields"]).toEqual({ send_only_display: BLOCKED("Quote redirect") });
    expect((await req(s.env, "PATCH", `/routing-rules/${qr.json["public_id"] as string}`, { target_offer_id: s.normal.id })).status).toBe(200);
    expect((await req(s.env, "PATCH", `/offers/${card.id}`, { send_only_json: SEND_ONLY_ANY_OK })).status).toBe(200);
  });

  it("lists at most 3 rule names (Funnel rules first), and counts the rest", async () => {
    const s = await seedRules();
    const card = insertOffer(s.sdb, { name: "Card Offer", mode: "request_static_bid" });
    for (const name of ["One", "Two", "Three"]) {
      expect((await req(s.env, "POST", `/variants/${s.variant.public_id}/rules`, { ...STRAIGHT(card.id), rule_name: name })).status).toBe(201);
    }
    expect((await req(s.env, "POST", `/quotes/${s.quote.public_id}/routing-rules`, { rule_name: "Four", conditions_json: { groups: [] }, redirect_pct: 100, target_offer_id: card.id })).status).toBe(201);
    const refused = await req(s.env, "PATCH", `/offers/${card.id}`, { send_only_json: SEND_ONLY_ANY_OK });
    expect((refused.json["fields"] as Record<string, string>)["send_only_display"]).toBe(
      'Redirect rules still open this Offer: "One", "Two", "Three" and 1 more. Point them at another offer first, because a send-only Offer never shows a card.',
    );
  });

  it("an Offer that is already send-only saving other fields (or a new \"Accepted when\") is not blocked by this check", async () => {
    const s = await seedRules();
    // a rule saved before the guard existed, written straight to the table
    s.sdb
      .prepare(
        "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, target_offer_id, priority, enabled, rule_name) VALUES (?, ?, 'redirect_direct_offer', '{\"groups\":[]}', 'h', ?, 100, 1, 'Old rule')",
      )
      .run(mintPublicId("funnel_rule"), s.variant.id, s.sendOnly.id);
    expect((await req(s.env, "PATCH", `/offers/${s.sendOnly.id}`, { offer_name: "Renamed hook" })).status).toBe(200);
    const rule = await req(s.env, "PATCH", `/offers/${s.sendOnly.id}`, {
      send_only_json: { display: "send_only", accept: { kind: "field_equals", field: "status", value: "ok" } },
    });
    expect(rule.status, JSON.stringify(rule.json)).toBe(200);
    expect(storedSendOnly(s.sdb, s.sendOnly.id)).toBe('{"display":"send_only","accept":{"kind":"field_equals","field":"status","value":"ok"}}');
  });
});

// ===========================================================================
// 3. The Test button
// ===========================================================================

const ENDPOINT = "https://hooks.provider.example.com/lead";

function withActiveSchema(sdb: SqliteDb, offer: Offer): void {
  const schema = { version: 1, root: { type: "object", children: [{ path: "plan", name: "plan", type: "string", source: "static", value: "gold" }] } };
  sdb
    .prepare("INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json) VALUES (?, ?, 1, ?)")
    .run(mintPublicId("payload_schema_version"), offer.id, JSON.stringify(schema));
  const sid = (sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE offer_id = ?").get(offer.id) as { id: number }).id;
  sdb.prepare("UPDATE leadgen_offers SET active_payload_schema_id = ? WHERE id = ?").run(sid, offer.id);
}

function stubFetch(answer: () => Response | Promise<Response>): Array<{ url: string }> {
  const calls: Array<{ url: string }> = [];
  vi.stubGlobal("fetch", async (url: RequestInfo | URL): Promise<Response> => {
    calls.push({ url: String(url) });
    return answer();
  });
  return calls;
}

function jsonReply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function runTest(env: Env, offer: Offer, environment = "staging"): Promise<Record<string, unknown>> {
  const res = await req(env, "POST", `/offers/${offer.id}/test`, { environment, sample_answers: {} });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json;
}

const FIELD_RULE = '{"display":"send_only","accept":{"kind":"field_equals","field":"result.status","value":"accepted"}}';

describeDb("Send-only Offers — the Test button says whether the reply counts as accepted", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup(sendOnly: string | null, mode: Mode = "request_static_bid"): { sdb: SqliteDb; env: Env; offer: Offer } {
    const { sdb, env } = newHarness();
    const offer = insertOffer(sdb, { name: "Hook", mode, sendOnly, endpoint: ENDPOINT });
    withActiveSchema(sdb, offer);
    return { sdb, env, offer };
  }

  it("\"Any OK reply\": a 2xx is accepted, even a plain-text OK", async () => {
    const h = setup(ANY_OK_JSON);
    const calls = stubFetch(() => new Response("OK", { status: 200 }));
    const body = await runTest(h.env, h.offer);
    expect(calls).toHaveLength(1); // the Test still posts for real
    expect(body["send_only"]).toEqual({ accepted: true, reason: "accepted", label: "accepted" });
    // a "Show a card" Offer, or a stale setting on another mode, gets no send_only
    const card = setup(null);
    expect("send_only" in (await runTest(card.env, card.offer))).toBe(false);
    const stale = setup(ANY_OK_JSON, "request_dynamic_bid");
    expect("send_only" in (await runTest(stale.env, stale.offer))).toBe(false);
  });

  it("a field rule: matching value (any capitals) accepted; another value, a missing field and a non-JSON reply are not", async () => {
    const h = setup(FIELD_RULE);
    stubFetch(() => jsonReply(200, { result: { status: "ACCEPTED " } }));
    expect((await runTest(h.env, h.offer))["send_only"]).toEqual({ accepted: true, reason: "accepted", label: "accepted" });

    stubFetch(() => jsonReply(200, { result: { status: "rejected" } }));
    expect((await runTest(h.env, h.offer))["send_only"]).toEqual({
      accepted: false,
      reason: "field_mismatch",
      label: "the reply field has a different value",
    });

    stubFetch(() => jsonReply(200, { ok: true }));
    expect((await runTest(h.env, h.offer))["send_only"]).toEqual({
      accepted: false,
      reason: "field_missing",
      label: "the reply field is not in the reply",
    });

    stubFetch(() => new Response("accepted", { status: 200 }));
    expect(((await runTest(h.env, h.offer))["send_only"] as Record<string, unknown>)["reason"]).toBe("field_missing");
  });

  it("a non-2xx reply, a network error and a timeout are never accepted", async () => {
    const h = setup(ANY_OK_JSON);
    stubFetch(() => jsonReply(500, { error: "boom" }));
    expect((await runTest(h.env, h.offer))["send_only"]).toEqual({
      accepted: false,
      reason: "error_reply",
      label: "the Provider answered with an error",
    });

    stubFetch(() => {
      throw new TypeError("network down");
    });
    expect(((await runTest(h.env, h.offer))["send_only"] as Record<string, unknown>)["reason"]).toBe("error_reply");

    stubFetch(() => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    });
    const timedOut = await runTest(h.env, h.offer);
    expect(timedOut["provider_error_reason"]).toBe("timeout");
    expect((timedOut["send_only"] as Record<string, unknown>)["accepted"]).toBe(false);
    expect((timedOut["send_only"] as Record<string, unknown>)["reason"]).toBe("timeout");
  });

  it("the existing pass/fail verdict is unchanged: a Production 200 that is NOT accepted still saves \"passed\"", async () => {
    const h = setup(FIELD_RULE);
    stubFetch(() => jsonReply(200, { result: { status: "rejected" } }));
    const body = await runTest(h.env, h.offer, "production");
    expect(body["test_status_saved"]).toBe(true);
    expect((body["send_only"] as Record<string, unknown>)["accepted"]).toBe(false);
    const row = h.sdb.prepare("SELECT last_test_status FROM leadgen_offers WHERE id = ?").get(h.offer.id) as { last_test_status: string };
    expect(row.last_test_status).toBe("passed");
  });

});
