// F11 — the click route's hidden redirect mark (plan Section 3 D/F, Section 8;
// backlog/CONTRACT-F11.md task 7).
//
// When an "After the offer is shown" countdown ends, the results page sets the
// first-party cookie `lg_rc=<brid>.<slot>` and clicks the chosen card's own
// link. The click route (/lg/lc, public/leadgen/click.ts) then:
//   * records the click with click_source "redirect" ONLY when the cookie
//     equals THIS click's own brid + slot, and deletes the cookie in its reply;
//   * treats every other click (no cookie, another card's value, a stale
//     value) as a normal visitor click (click_source "") and leaves the cookie
//     alone;
//   * changes nothing else: the 302 destination, the click_id, the cap, the
//     remove-clicked row, the CPC revenue booking and ledger row, the replay
//     cap and the Offer's Meta click event are identical with and without it.
//
// Two layers: the resolver function itself (light mock D1), and the REAL app
// route over node:sqlite + the real migrations with Firehose and Meta captured
// (the leadgen-clickout-meta.test.ts harness pattern). No real Provider or
// Meta call: every outbound fetch is stubbed.

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { buildLeadgenClickUrl } from "../src/public/leadgen/auction/banner";
import { resolveLeadgenClick, type LeadgenClickInput } from "../src/public/leadgen/click";
import { SEED_FACEBOOK_TEMPLATE } from "../src/leadgen/revenue-recon";

const CLEAR_MARK = "lg_rc=; Max-Age=0; Path=/; SameSite=Lax; Secure";
const BRID = "6f1d3c2a-8b9e-4f10-9a7d-2c4e5b6a7d80";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ===========================================================================
// 1. the resolver (no database needed)
// ===========================================================================

function lightDb(): D1Database {
  const stmt = {
    bind() {
      return stmt;
    },
    async first() {
      return null;
    },
    async all() {
      return { results: [], success: true, meta: {} };
    },
    async run() {
      return { success: true, meta: {} };
    },
  };
  return { prepare: () => stmt } as unknown as D1Database;
}

function input(cookie: string | null, overrides: Partial<LeadgenClickInput> = {}): LeadgenClickInput {
  return {
    offer_public_id: "lgo_TEST",
    carrier_key: "",
    auction_instance_id: "aiid-unit",
    banner_render_id: BRID,
    slot: 2,
    funnel_attempt_id: "att_unit",
    banner_url_template: "https://partner.example/go?cid={click_id}",
    request_cookie_header: cookie,
    mintClickId: () => "lgl_UNIT",
    now: 1_790_000_000_000,
    ...overrides,
  };
}

async function resolveWith(cookie: string | null, overrides: Partial<LeadgenClickInput> = {}) {
  const env = { DB: lightDb(), APP_ENV: "test" } as unknown as Env;
  const promises: Promise<unknown>[] = [];
  const result = await resolveLeadgenClick(env, { waitUntil: (p) => void promises.push(p) }, input(cookie, overrides));
  await Promise.all(promises);
  return result;
}

describe("resolveLeadgenClick — the hidden redirect mark", () => {
  it("the cookie equals THIS card's brid.slot ⇒ click_source 'redirect' and the route is told to delete it", async () => {
    const r = await resolveWith(`_fbp=fb.1.1790000000000.123; lg_rc=${BRID}.2; other=1`);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.click_source).toBe("redirect");
    expect(r.redirect_mark).toBe(true);
    expect(r.redirect).toBe(true);
    expect(r.destination_url).toBe("https://partner.example/go?cid=lgl_UNIT");
  });

  it("the same value URL-encoded (as a browser may store it) still matches", async () => {
    const r = await resolveWith(`lg_rc=${encodeURIComponent(`${BRID}.2`)}`);
    expect(r.events[0]!.click_source).toBe("redirect");
    expect(r.redirect_mark).toBe(true);
  });

  it("another card's slot, another render's brid, or a bare brid ⇒ a normal visitor click", async () => {
    for (const cookie of [`lg_rc=${BRID}.1`, `lg_rc=00000000-0000-0000-0000-000000000000.2`, `lg_rc=${BRID}`, `lg_rc=.2`, "lg_rc="]) {
      const r = await resolveWith(cookie);
      expect(r.events[0]!.click_source, cookie).toBe("");
      expect(r.redirect_mark, cookie).toBe(false);
    }
  });

  it("no cookie at all ⇒ a normal visitor click", async () => {
    const r = await resolveWith(null);
    expect(r.events[0]!.click_source).toBe("");
    expect(r.redirect_mark).toBe(false);
  });

  it("a link without brid or slot can never be a redirect click, whatever the cookie says", async () => {
    const noSlot = await resolveWith(`lg_rc=${BRID}.null`, { slot: null });
    expect(noSlot.events[0]!.click_source).toBe("");
    expect(noSlot.redirect_mark).toBe(false);
    const noBrid = await resolveWith("lg_rc=.2", { banner_render_id: "" });
    expect(noBrid.events[0]!.click_source).toBe("");
    expect(noBrid.redirect_mark).toBe(false);
  });

  it("the mark changes only click_source: the built event and the 302 are otherwise identical", async () => {
    const marked = await resolveWith(`lg_rc=${BRID}.2`);
    const plain = await resolveWith(null);
    // The mark really was read (else this comparison proves nothing).
    expect(marked.events[0]!.click_source).toBe("redirect");
    const strip = (e: Record<string, unknown>) => {
      const { click_source: _source, event_id: _id, ...rest } = e;
      return rest;
    };
    expect(strip(marked.events[0]! as unknown as Record<string, unknown>)).toEqual(
      strip(plain.events[0]! as unknown as Record<string, unknown>),
    );
    expect(marked.destination_url).toBe(plain.destination_url);
    expect(marked.click_id).toBe(plain.click_id);
    expect([marked.cap_incremented, marked.clicked_recorded]).toEqual([plain.cap_incremented, plain.clicked_recorded]);
    expect(await marked.replay_capped).toBe(await plain.replay_capped);
  });
});

// ===========================================================================
// 2. GET /lg/lc — the real route over node:sqlite
// ===========================================================================

type SqliteDb = Record<string, unknown> & { prepare(sql: string): SqliteStmt };
type SqliteStmt = { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] };
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
      /* fallthrough */
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
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          return (sdb.prepare(sql).get(...binds) ?? null) as T | null;
        },
        async all<T = unknown>() {
          return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} };
        },
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

function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async getWithMetadata(key: string) {
      return { value: store.get(key) ?? null, metadata: null };
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = [
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
  "0056_leadgen_offer_api_token_vault.sql",
  "0057_leadgen_offer_test_verdict.sql",
  "0058_leadgen_offer_clickout_meta.sql",
  "0064_leadgen_meta_pixel.sql",
] as const;

const TENANT_HOST = "one.example.com";
const DATASET = "656145712939950";
const FBCLID = "IwAR3testClickIdFromMetaAd";
const FBC = `fb.1.1790451641000.${FBCLID}`;
const FBP = "fb.1.1790451641000.1234567890";
// One Offer + Auction public id shared by both harnesses so their outputs
// compare 1:1.
const OFFER_PUBLIC_ID = mintPublicId("offer");
const AUCTION_PUBLIC_ID = mintPublicId("auction");

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

interface Harness {
  sdb: SqliteDb;
  env: Env;
}

function newHarness(): Harness {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      `INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','${TENANT_HOST}','loans','active');` +
      `INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','${TENANT_HOST}','active');`,
  );
  for (const file of MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  sdb
    .prepare(
      "INSERT INTO leadgen_media_platforms (platform, enabled, postback_url_template, auth_secret_ref, event_name, value_multiplier) VALUES ('facebook', 0, ?, 'LEADGEN_S2S_TOKEN_FACEBOOK', 'Purchase', 1)",
    )
    .run(SEED_FACEBOOK_TEMPLATE);
  // A pay-per-click Offer with a clicks cap and its Meta click event on — so
  // the cap, the revenue booking, the ledger row and the Meta send all run.
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, banner_url_template,
          static_bid_value, static_bid_currency, cap_enabled, cap_amount, cap_count_by, cap_timezone, status,
          clickout_meta_conversion, clickout_meta_dataset_id)
       VALUES (?, 'Sample CPC Offer', 'Sample Provider', 'leadgen', 'Loans', 's2s_postback', 'cpc',
               0, 'static', 'server', 'https://partner.example/go?cid={click_id}',
               32.5, 'USD', 1, 100, 'clicks', 'UTC', 'active', 1, ?)`,
    )
    .run(OFFER_PUBLIC_ID, DATASET);
  const offerRow = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(OFFER_PUBLIC_ID) as { id: number };
  sdb
    .prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, 'pl-1', 1)")
    .run(mintPublicId("offer_placement"), offerRow.id);
  // The auction that showed this Offer (its card in slot 1) to attempt att_f11.
  const auctionPublicId = AUCTION_PUBLIC_ID;
  sdb
    .prepare(
      `INSERT INTO leadgen_auctions
         (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
          surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
          backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
       VALUES (?, 'A', 'dynamic', 'highest_bid', 'percentage_of_max', 10, 'enabled', 1, 5, 3, 10, 'disabled', 'on_slot_exhaustion', 1, 'offer', 2500, 1, 'active')`,
    )
    .run(auctionPublicId);
  sdb
    .prepare(
      "INSERT INTO leadgen_auction_result_log (auction_instance_id, auction_result_id, auction_config_id, session_id, funnel_attempt_id, funnel_id, carriers_shown_json, macro_context_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      "aiid-f11",
      "ares-f11",
      auctionPublicId,
      "sess-f11",
      "att_f11",
      "lgf_x",
      JSON.stringify([{ carrier_key: "", offer_id: OFFER_PUBLIC_ID, bid: 32.5, slot: 1 }]),
      JSON.stringify({ session_id: "sess-f11", utm_source: "fb", fbc: FBC, fbclid: FBCLID }),
    );
  const env = {
    DB: d1FromSqlite(sdb),
    CACHE: makeKv(),
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "300",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    LEADGEN_CONFIG_SIGNING_KEY: "runtime-signing-key-test-only",
    LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS: "LEADGEN_S2S_TOKEN_FACEBOOK",
    LEADGEN_S2S_TOKEN_FACEBOOK: "EAAtest-token-value-never-rendered",
    // Firehose wired so the click event is observable (captured below).
    AWS_ACCESS_KEY_ID: "k",
    AWS_SECRET_ACCESS_KEY: "s",
    LEADGEN_EVENTS_FIREHOSE_STREAM: "leadgen-events",
  } as unknown as Env;
  return { sdb, env };
}

// Every outbound fetch: Firehose records decoded, Meta answering 200.
function stubOutbound() {
  const firehose: Array<Record<string, unknown>> = [];
  const meta: Array<Record<string, unknown>> = [];
  const other: string[] = [];
  vi.stubGlobal("fetch", async (req: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = req instanceof Request ? req.url : String(req);
    const body = req instanceof Request ? await req.clone().text() : String(init?.body ?? "");
    if (url.includes("firehose")) {
      const parsed = JSON.parse(body) as { Records?: Array<{ Data: string }> };
      for (const r of parsed.Records ?? []) firehose.push(JSON.parse(Buffer.from(r.Data, "base64").toString("utf8")) as Record<string, unknown>);
      return new Response(JSON.stringify({ FailedPutCount: 0, RequestResponses: [] }), { status: 200 });
    }
    if (url.startsWith("https://graph.facebook.com/")) {
      meta.push(JSON.parse(body) as Record<string, unknown>);
      return new Response(JSON.stringify({ events_received: 1, fbtrace_id: "Atrace" }), { status: 200 });
    }
    other.push(url);
    return new Response("{}", { status: 200 });
  });
  return { firehose, meta, other };
}

async function clickCard(h: Harness, opts: { slot: number; cookie?: string }): Promise<Response> {
  const promises: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) {
      promises.push(Promise.resolve(p).catch(() => undefined));
    },
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  const href = buildLeadgenClickUrl(OFFER_PUBLIC_ID, {
    carrier_key: "",
    auction_instance_id: "aiid-f11",
    banner_render_id: BRID,
    slot: opts.slot,
    funnel_attempt_id: "att_f11",
  });
  const headers: Record<string, string> = {
    "cf-connecting-ip": "203.0.113.7",
    "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    referer: `https://${TENANT_HOST}/lg/business-loans`,
  };
  headers["cookie"] = `_fbp=${FBP}` + (opts.cookie !== undefined ? `; ${opts.cookie}` : "");
  const res = await app.request(`http://${TENANT_HOST}${href}`, { headers }, h.env, ctx);
  await Promise.all(promises);
  await Promise.all(promises);
  return res;
}

function clickEvents(firehose: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return firehose.filter((r) => r["event_type"] === "offer_click" || r["event_type"] === "carrier_click");
}

// Everything the click route leaves behind, with the per-click ids and clock
// values normalised so two runs compare 1:1.
function sideEffects(h: Harness, res: Response, out: ReturnType<typeof stubOutbound>) {
  const ids = (s: string) => s.replace(/lgl_[0-9A-Za-z]+/g, "lgl_X");
  const location = ids(res.headers.get("Location") ?? "");
  const events = clickEvents(out.firehose).map((e) => {
    const { event_id: _a, click_id: _b, timestamp: _c, received_at: _d, click_source: _e, ...rest } = e;
    return rest;
  });
  const metaBodies = out.meta.map((m) => JSON.parse(ids(JSON.stringify(m)).replace(/"event_time":\d+/g, '"event_time":0')) as unknown);
  const db = (sql: string) => h.sdb.prepare(sql).all();
  return {
    status: res.status,
    location,
    cache: res.headers.get("Cache-Control"),
    events,
    metaBodies,
    other: out.other,
    clicked: db("SELECT funnel_attempt_id, offer_id, carrier_key, session_id, auction_id, removal_scope FROM leadgen_session_clicked_offers ORDER BY offer_id"),
    caps: db("SELECT offer_id, cap_date, click_count, conversion_count FROM leadgen_offer_cap_counters ORDER BY offer_id"),
    ledger: db("SELECT dt, offer_public_id, source, booking_trigger, conversions, revenue, currency FROM leadgen_revenue_raw ORDER BY id"),
    metaStatus: db("SELECT clickout_meta_last_status FROM leadgen_offers"),
  };
}

describeDb("GET /lg/lc — the hidden redirect mark through the real route", () => {
  it("the page's own click (lg_rc = this card's brid.slot): 302 as usual, the event says 'redirect', the reply deletes the cookie", async () => {
    const h = newHarness();
    const out = stubOutbound();
    const res = await clickCard(h, { slot: 1, cookie: `lg_rc=${BRID}.1` });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toMatch(/^https:\/\/partner\.example\/go\?cid=lgl_/);
    expect(res.headers.get("Set-Cookie")).toBe(CLEAR_MARK);
    const events = clickEvents(out.firehose);
    expect(events).toHaveLength(1); // one counted click, never two
    expect(events[0]!["click_source"]).toBe("redirect");
    expect(events[0]!["banner_render_id"]).toBe(BRID);
    expect(events[0]!["carrier_position"]).toBe(1);
    expect(out.meta).toHaveLength(1); // the Offer's Meta click event, exactly once (decision 7)
  });

  it("a visitor's own click (no lg_rc): click_source '' and no Set-Cookie", async () => {
    const h = newHarness();
    const out = stubOutbound();
    const res = await clickCard(h, { slot: 1 });

    expect(res.status).toBe(302);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    const events = clickEvents(out.firehose);
    expect(events).toHaveLength(1);
    expect(events[0]!["click_source"]).toBe("");
    expect(out.meta).toHaveLength(1);
  });

  it("a click on ANOTHER card while a mark is around (other slot): a visitor click, and the cookie is left alone", async () => {
    const h = newHarness();
    const out = stubOutbound();
    const res = await clickCard(h, { slot: 1, cookie: `lg_rc=${BRID}.3` });

    expect(res.status).toBe(302);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(clickEvents(out.firehose)[0]!["click_source"]).toBe("");
  });

  it("a stale mark from an earlier results page (another brid): a visitor click, and the cookie is left alone", async () => {
    const h = newHarness();
    const out = stubOutbound();
    const res = await clickCard(h, { slot: 1, cookie: "lg_rc=11111111-2222-3333-4444-555555555555.1" });

    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(clickEvents(out.firehose)[0]!["click_source"]).toBe("");
  });

  it("money path: with and without the mark, every other output is identical (302, cap, remove-clicked row, revenue, ledger, Meta event)", async () => {
    const marked = newHarness();
    const outMarked = stubOutbound();
    const resMarked = await clickCard(marked, { slot: 1, cookie: `lg_rc=${BRID}.1` });
    const a = sideEffects(marked, resMarked, outMarked);
    vi.unstubAllGlobals();

    const plain = newHarness();
    const outPlain = stubOutbound();
    const resPlain = await clickCard(plain, { slot: 1 });
    const b = sideEffects(plain, resPlain, outPlain);

    // The mark really was read (else this comparison proves nothing).
    expect(clickEvents(outMarked.firehose)[0]!["click_source"]).toBe("redirect");
    expect(clickEvents(outPlain.firehose)[0]!["click_source"]).toBe("");
    // The click did all of its usual work in both runs…
    expect(a.status).toBe(302);
    expect(a.clicked).toHaveLength(1);
    expect(a.caps).toEqual([expect.objectContaining({ click_count: 1 })]);
    expect(a.ledger).toEqual([expect.objectContaining({ source: "in_site", booking_trigger: "click", revenue: 32.5 })]);
    expect(a.events[0]!["revenue"]).toBe(32.5);
    expect(a.events[0]!["booking_trigger"]).toBe("click");
    expect(a.metaBodies).toHaveLength(1);
    expect(a.metaStatus).toEqual([{ clickout_meta_last_status: "fired" }]);
    // …and nothing differs but click_source and the cookie deletion.
    expect(a).toEqual(b);
    expect(resMarked.headers.get("Set-Cookie")).toBe(CLEAR_MARK);
    expect(resPlain.headers.get("Set-Cookie")).toBeNull();
  });

  it("the card's link itself carries no mark: the 302 Location never mentions lg_rc or 'redirect'", async () => {
    const h = newHarness();
    stubOutbound();
    const res = await clickCard(h, { slot: 1, cookie: `lg_rc=${BRID}.1` });
    expect(res.headers.get("Set-Cookie")).toBe(CLEAR_MARK); // the mark was read…
    const location = res.headers.get("Location") ?? "";
    expect(location).not.toContain("lg_rc");
    expect(location).not.toContain("redirect");
    expect(location).not.toContain(BRID);
  });
});
