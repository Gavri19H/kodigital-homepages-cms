// LeadGen — the Meta (Facebook) event on CLICK of an Offer's banner (0058,
// widened by 0064; src/leadgen/clickout-meta.ts).
//
// Source ask (marketing, #haikov-support, 2026-09-17) built 0058 for static
// Offers, Meta-ad visitors, once per funnel visit. OWNER 2026-10-08 widened it:
// "we want to fire the browser side event to facebook, the system should
// support it in the offer level, including the generated click revenue value";
// R1 "Every click"; R2 "Offer + funnel" — Purchase (configurable) on click,
// value = the click's bid x a multiplier (default 1), browser + server sharing
// ONE event id. So 0064: EVERY Offer, EVERY visitor, EVERY click.
//
// What these tests hold, against the REAL migrations and the REAL app:
//   * the sender: exact Graph request (the shape the Conversions engine's
//     destination-meta adapter and the reference funnel both use), one event
//     per click (replays of the SAME click id deduped), the slot given back
//     when Meta refuses, the outcome recorded on the Offer, and every reason it
//     sends nothing;
//   * FORGERY (review F1): /lg/lc is a public unguarded GET, so a hand-made
//     URL with a pasted fbclid must add nothing — the visitor's Meta ids come
//     only from the auction that showed this Offer to this funnel attempt, and
//     no auction ⇒ no event;
//   * GET /lg/lc: the visitor's 302 is the same with the feature on or off, the
//     Meta POST happens for any Offer with the switch on, and no revenue /
//     conversion row is written by the Meta sender;
//   * §26 is not reused (review F2): production's facebook row exactly as it is
//     today — the seeded /tr GET template, enabled=0 — is enough, because only
//     its token reference is read;
//   * the Offer API takes the switch on any auction mode, refuses it without a
//     dataset; the editor shows it for every Offer, says it is not Admin →
//     Conversions, says honestly whether the token is installed, shows the last
//     clickout's outcome, and never renders the token.

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { buildLeadgenClickUrl } from "../src/public/leadgen/auction/banner";
import { SEED_FACEBOOK_TEMPLATE } from "../src/leadgen/revenue-recon";
import {
  sendClickoutMetaConversion,
  type ClickoutMetaClick,
  type ClickoutMetaOffer,
} from "../src/leadgen/clickout-meta";

// --- node:sqlite harness (repo pattern) --------------------------------------

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

function makeKvStub(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
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
  return { kv, store };
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
const ADMIN_HOST = "cms.kodigital.app";
const DATASET = "656145712939950";
const ENDPOINT = `https://graph.facebook.com/v25.0/${DATASET}/events`;
const TOKEN = "EAAtest-token-value-never-rendered";
const FBCLID = "IwAR3testClickIdFromMetaAd";
const FBC = `fb.1.1790451641000.${FBCLID}`;

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      `INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','${TENANT_HOST}','insurance','active');` +
      `INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','${TENANT_HOST}','active');`,
  );
  for (const file of MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
}

function buildEnv(db: D1Database, kv: KVNamespace, opts: { token?: string | null } = {}): Env {
  const env: Record<string, unknown> = {
    DB: db,
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST,
    ADMIN_BASE_URL: `https://${ADMIN_HOST}`,
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "300",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    LEADGEN_CONFIG_SIGNING_KEY: "runtime-signing-key-test-only",
    // Production's exact allowlist (wrangler.toml [env.production.vars]).
    LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS: "LEADGEN_S2S_TOKEN_FACEBOOK,LISTICLE_S2S_TOKEN_FACEBOOK",
  };
  const token = opts.token === undefined ? TOKEN : opts.token;
  if (token !== null) env.LEADGEN_S2S_TOKEN_FACEBOOK = token;
  return env as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

interface Harness {
  sdb: SqliteDb;
  env: Env;
  kv: Map<string, string>;
}
// The facebook row is production's EXACT row today unless a test says
// otherwise: the seeded /tr GET template, enabled=0, the allowlisted ref.
function newHarness(opts: { token?: string | null; platformRow?: boolean } = {}): Harness {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  const { kv, store } = makeKvStub();
  if (opts.platformRow !== false) {
    sdb
      .prepare(
        "INSERT INTO leadgen_media_platforms (platform, enabled, postback_url_template, auth_secret_ref, event_name, value_multiplier) VALUES ('facebook', 0, ?, 'LEADGEN_S2S_TOKEN_FACEBOOK', 'Purchase', 1)",
      )
      .run(SEED_FACEBOOK_TEMPLATE);
  }
  return { sdb, env: buildEnv(d1FromSqlite(sdb), kv, { token: opts.token }), kv: store };
}

function seedOffer(
  sdb: SqliteDb,
  opts: { static?: boolean; clickout?: number; dataset?: string | null; eventName?: string | null; value?: number | null; testCode?: string | null } = {},
): { offerId: number; offerPublicId: string } {
  const offerPublicId = mintPublicId("offer");
  const isStatic = opts.static ?? true;
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, banner_url_template,
          static_bid_value, static_bid_currency, cap_enabled, status,
          clickout_meta_conversion, clickout_meta_dataset_id, clickout_meta_event_name, clickout_meta_value, clickout_meta_test_event_code)
       VALUES (?, 'Fora - Tier 3', 'Impact', 'leadgen', 'Business Loans', 's2s_postback', 'cpl',
               ?, 'static', 'server', 'https://partner.example/go?cid={click_id}',
               200, 'USD', 0, 'active', ?, ?, ?, ?, ?)`,
    )
    .run(
      offerPublicId,
      isStatic ? 0 : 1,
      opts.clickout ?? 1,
      opts.dataset === undefined ? DATASET : opts.dataset,
      opts.eventName ?? null,
      opts.value ?? null,
      opts.testCode ?? null,
    );
  const row = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(offerPublicId) as { id: number };
  sdb
    .prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, 'pl-1', 1)")
    .run(mintPublicId("offer_placement"), row.id);
  return { offerId: row.id, offerPublicId };
}

const META_SNAPSHOT: Record<string, string> = {
  session_id: "be9974ca-3fd9-46fc-bcfb-27da76a628a4",
  utm_source: "mln",
  utm_medium: "paid",
  fbc: FBC,
  fbclid: FBCLID,
};

// An auction exactly as the engine persists it (shape read from a production
// row): the attempt, the offers whose banners were shown, and the macro
// snapshot that holds the visitor's Meta identifiers.
function seedAuction(
  sdb: SqliteDb,
  opts: { aiid: string; faid: string; shown: string[]; snapshot?: Record<string, string> },
): void {
  const auctionPublicId = mintPublicId("auction");
  sdb
    .prepare(
      `INSERT INTO leadgen_auctions
         (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
          surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
          backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
       VALUES (?, 'A', 'dynamic', 'highest_bid', 'percentage_of_max', 10, 'enabled', 1, 5, 3, 10, 'disabled', 'on_slot_exhaustion', 1, 'offer', 2500, 1, 'active')`,
    )
    .run(auctionPublicId);
  const snapshot = opts.snapshot ?? META_SNAPSHOT;
  sdb
    .prepare(
      "INSERT INTO leadgen_auction_result_log (auction_instance_id, auction_result_id, auction_config_id, session_id, funnel_attempt_id, funnel_id, carriers_shown_json, macro_context_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      opts.aiid,
      `ares-${opts.aiid}`,
      auctionPublicId,
      snapshot["session_id"] ?? null,
      opts.faid,
      "lgf_x",
      JSON.stringify(opts.shown.map((offer_id, i) => ({ carrier_key: "", offer_id, bid: 200, slot: i + 1 }))),
      JSON.stringify(snapshot),
    );
}

interface CapturedCtx {
  ctx: ExecutionContext;
  promises: Promise<unknown>[];
}
function captureCtx(): CapturedCtx {
  const promises: Promise<unknown>[] = [];
  return {
    promises,
    ctx: {
      waitUntil(p: Promise<unknown>) {
        promises.push(Promise.resolve(p).catch(() => undefined));
      },
      passThroughOnException() {},
    } as unknown as ExecutionContext,
  };
}
async function settle(c: CapturedCtx): Promise<void> {
  await Promise.all(c.promises);
  await Promise.all(c.promises);
}

// Every outbound fetch from the app, with Meta answering the way it does.
function stubFetch(status = 200, body: unknown = { events_received: 1, fbtrace_id: "Atrace" }) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input instanceof Request ? input.url : input), init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return { calls, spy, metaCalls: () => calls.filter((c) => c.url.startsWith("https://graph.facebook.com/")) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function click(overrides: Partial<ClickoutMetaClick> = {}): ClickoutMetaClick {
  return {
    click_id: "lgl_01TESTCLICK",
    auction_instance_id: "aiid-1",
    funnel_attempt_id: "att_1",
    ip: "203.0.113.7",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    page_url: "https://moneylantern.com/lg/business-loans?fbclid=x",
    host: "moneylantern.com",
    ...overrides,
  };
}

function offerRow(sdb: SqliteDb, publicId: string): ClickoutMetaOffer {
  return sdb
    .prepare(
      "SELECT public_id, calls_provider_api, offer_type, clickout_meta_conversion, clickout_meta_dataset_id, clickout_meta_event_name, clickout_meta_value, clickout_meta_value_multiplier, clickout_meta_test_event_code, static_bid_currency FROM leadgen_offers WHERE public_id = ?",
    )
    .get(publicId) as ClickoutMetaOffer;
}

function lastOutcome(sdb: SqliteDb, publicId: string): { status: string | null; detail: string | null; at: number | null } {
  const r = sdb
    .prepare("SELECT clickout_meta_last_status s, clickout_meta_last_detail d, clickout_meta_last_at a FROM leadgen_offers WHERE public_id = ?")
    .get(publicId) as { s: string | null; d: string | null; a: number | null };
  return { status: r.s, detail: r.d, at: r.a };
}

// A shown static offer + its auction, ready to click.
function ready(h: Harness, offerOpts: Parameters<typeof seedOffer>[1] = {}, auction: Partial<{ aiid: string; faid: string; snapshot: Record<string, string> }> = {}) {
  const o = seedOffer(h.sdb, offerOpts);
  seedAuction(h.sdb, { aiid: auction.aiid ?? "aiid-1", faid: auction.faid ?? "att_1", shown: [o.offerPublicId], snapshot: auction.snapshot });
  return o;
}

// ===========================================================================
// the sender
// ===========================================================================

describeDb("sendClickoutMetaConversion — what reaches Meta", () => {
  it("POSTs one Conversions API event to the offer's dataset, token as access_token, the auction visitor's Meta click id attached", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h, { testCode: "TEST34567" });
    const f = stubFetch();
    const out = await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click(), { now: 1790500000123 });

    // 0064: no saved event name ⇒ Purchase (R2); the event id is the click's
    // own ('lgc_' + click id) when the link carried no browser-minted `eid`.
    expect(out).toEqual({
      status: "fired",
      dataset_id: DATASET,
      event_name: "Purchase",
      event_id: "lgc_lgl_01TESTCLICK",
      http_status: 200,
      events_received: 1,
      fbtrace_id: "Atrace",
      test: true,
    });
    expect(f.metaCalls()).toHaveLength(1);
    const sent = f.metaCalls()[0]!;
    const url = new URL(sent.url);
    expect(`${url.origin}${url.pathname}`).toBe(ENDPOINT);
    expect(url.searchParams.get("access_token")).toBe(TOKEN);
    expect(sent.init?.method).toBe("POST");
    const body = JSON.parse(String(sent.init?.body)) as { data: Array<Record<string, unknown>>; test_event_code?: string };
    expect(body.test_event_code).toBe("TEST34567");
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toEqual({
      event_name: "Purchase",
      event_time: 1790500000,
      event_id: "lgc_lgl_01TESTCLICK",
      action_source: "website",
      event_source_url: "https://moneylantern.com/lg/business-loans?fbclid=x",
      user_data: {
        fbc: FBC,
        client_ip_address: "203.0.113.7",
        client_user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        external_id: [createHash("sha256").update(META_SNAPSHOT["session_id"]!).digest("hex")],
      },
    });
    // No fixed value, and a CPL offer has no click bid ⇒ no value sent.
    expect(body.data[0]).not.toHaveProperty("custom_data");
  });

  it("records what happened on the Offer, in words, so a tester reads it on the Offer page", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h);
    stubFetch();
    await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click(), { now: 1790500000123 });
    expect(lastOutcome(h.sdb, offerPublicId)).toEqual({
      status: "fired",
      detail: `Sent to Meta dataset ${DATASET}: Purchase, Meta accepted 1 event.`,
      at: 1790500000,
    });
  });

  it("the token never appears in the log line", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h);
    stubFetch();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click());
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("leadgen clickout meta conversion") && l.includes('"status":"fired"'))).toBe(true);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });

  it("an operator-set value goes out as custom_data in the offer's currency; the chosen event name is used", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h, { value: 12.5, eventName: "SubmitApplication" });
    const f = stubFetch();
    await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click());
    const body = JSON.parse(String(f.metaCalls()[0]!.init?.body)) as { data: Array<Record<string, unknown>>; test_event_code?: string };
    expect(body.data[0]!["event_name"]).toBe("SubmitApplication");
    expect(body.data[0]!["custom_data"]).toEqual({ value: 12.5, currency: "USD" });
    expect(body).not.toHaveProperty("test_event_code"); // live, not a test
  });

  it("the auction captured only an fbclid ⇒ fbc derived exactly as §26 derives it", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h, {}, { snapshot: { ...META_SNAPSHOT, fbc: "" } });
    const f = stubFetch();
    await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click(), { now: 1790500000123 });
    const body = JSON.parse(String(f.metaCalls()[0]!.init?.body)) as { data: Array<{ user_data: { fbc: string } }> };
    expect(body.data[0]!.user_data.fbc).toBe(`fb.1.1790500000123.${FBCLID}`);
  });

  it("OWNER R1 'Every click': a second click in the same funnel visit is its own event; only a replay of the SAME click is deduped", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h);
    const f = stubFetch();
    const offer = offerRow(h.sdb, offerPublicId);
    const first = await sendClickoutMetaConversion(h.env, h.env.DB, offer, click({ click_id: "lgl_A" }));
    const second = await sendClickoutMetaConversion(h.env, h.env.DB, offer, click({ click_id: "lgl_B" }));
    const replay = await sendClickoutMetaConversion(h.env, h.env.DB, offer, click({ click_id: "lgl_B" }));
    expect(first).toMatchObject({ status: "fired", event_id: "lgc_lgl_A" });
    expect(second).toMatchObject({ status: "fired", event_id: "lgc_lgl_B" });
    expect(replay).toEqual({ status: "deduped", event_id: "lgc_lgl_B" });
    expect(f.metaCalls()).toHaveLength(2);
    expect([...h.kv.keys()].every((k) => k.startsWith("lg_s2s:facebook:clickout:"))).toBe(true);
  });

  it("REVIEW M1: Meta refusing (bad token) gives the slot back — once the token is fixed the visitor's next click is sent", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h);
    const offer = offerRow(h.sdb, offerPublicId);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    stubFetch(400, { error: { message: "Invalid OAuth access token", type: "OAuthException", code: 190, fbtrace_id: "T1" } });
    const refused = await sendClickoutMetaConversion(h.env, h.env.DB, offer, click({ click_id: "lgl_1" }));
    expect(refused.status).toBe("failed");
    expect(lastOutcome(h.sdb, offerPublicId).detail).toBe("Meta refused it: the access token is invalid or expired (Meta error 190).");
    vi.restoreAllMocks();
    const f = stubFetch();
    const retried = await sendClickoutMetaConversion(h.env, h.env.DB, offer, click({ click_id: "lgl_2" }));
    expect(retried.status).toBe("fired");
    expect(f.metaCalls()).toHaveLength(1);
  });
});

describeDb("sendClickoutMetaConversion — FORGERY (review F1): nothing on the click URL can make it send", () => {
  it("no auction behind the click (a hand-made /lg/lc URL) ⇒ nothing", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb); // no auction at all
    const f = stubFetch();
    expect(await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click({ auction_instance_id: "forged" }))).toEqual({
      status: "skipped",
      reason: "no_auction",
    });
    expect(f.calls).toHaveLength(0);
  });

  it("a real auction, but a made-up attempt id (the trick to dodge dedupe) ⇒ nothing", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h);
    const f = stubFetch();
    expect(
      await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click({ funnel_attempt_id: "rvforge-123" })),
    ).toEqual({ status: "skipped", reason: "attempt_mismatch" });
    expect(f.calls).toHaveLength(0);
  });

  it("a real auction that never showed THIS offer ⇒ nothing", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    seedAuction(h.sdb, { aiid: "aiid-1", faid: "att_1", shown: ["lgo_SOMEONE_ELSE"] });
    const f = stubFetch();
    expect(await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click())).toEqual({
      status: "skipped",
      reason: "offer_not_shown",
    });
    expect(f.calls).toHaveLength(0);
  });

  it("REVIEW N1: a forged click cannot overwrite the operator's 'last clickout' line", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h);
    stubFetch();
    await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click(), { now: 1790500000123 });
    const genuine = lastOutcome(h.sdb, offerPublicId);
    expect(genuine.status).toBe("fired");
    const offer = offerRow(h.sdb, offerPublicId);
    for (const forged of [
      click({ auction_instance_id: "forged" }),
      click({ funnel_attempt_id: "rvforge-9" }),
    ]) {
      expect((await sendClickoutMetaConversion(h.env, h.env.DB, offer, forged, { now: 1790500999000 })).status).toBe("skipped");
    }
    const other = seedOffer(h.sdb);
    seedAuction(h.sdb, { aiid: "aiid-x", faid: "att_x", shown: [other.offerPublicId] });
    await sendClickoutMetaConversion(h.env, h.env.DB, offer, click({ auction_instance_id: "aiid-x", funnel_attempt_id: "att_x" }));
    expect(lastOutcome(h.sdb, offerPublicId)).toEqual(genuine);
  });

  it("0064: a visitor who did not come from a Meta ad is still sent (the reference funnel sends every click) — with NO fbc, which only the auction can supply", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h, {}, { snapshot: { session_id: "s-organic", utm_source: "google" } });
    const f = stubFetch();
    const out = await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click());
    expect(out.status).toBe("fired");
    const body = JSON.parse(String(f.metaCalls()[0]!.init?.body)) as { data: Array<{ user_data: Record<string, unknown> }> };
    expect(body.data[0]!.user_data).not.toHaveProperty("fbc");
    expect(body.data[0]!.user_data["external_id"]).toEqual([createHash("sha256").update("s-organic").digest("hex")]);
  });
});

describeDb("sendClickoutMetaConversion — every other reason it sends nothing", () => {
  it("switch off (the default for every existing offer) — and an ordinary click leaves no record", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h, { clickout: 0 });
    const f = stubFetch();
    expect(await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click())).toEqual({
      status: "skipped",
      reason: "offer_setting_off",
    });
    expect(f.calls).toHaveLength(0);
    expect(lastOutcome(h.sdb, offerPublicId).status).toBeNull();
  });

  it("the 0058 default IS off: an offer inserted without the column never fires", async () => {
    const h = newHarness();
    const publicId = mintPublicId("offer");
    h.sdb
      .prepare(
        `INSERT INTO leadgen_offers (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type, calls_provider_api, bid_source, request_execution_mode, status)
         VALUES (?, 'Old', 'leadgen', 'x', 's2s_postback', 'cpl', 0, 'static', 'server', 'active')`,
      )
      .run(publicId);
    expect(offerRow(h.sdb, publicId).clickout_meta_conversion).toBe(0);
  });

  it("0064: a provider-request (API) offer with the switch on now sends too (R2: the offer level, every offer)", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h, { static: false, clickout: 1 });
    const f = stubFetch();
    expect((await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click())).status).toBe("fired");
    expect(f.metaCalls()).toHaveLength(1);
  });

  it("no dataset on the offer", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h, { dataset: null });
    const f = stubFetch();
    expect(await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click())).toEqual({
      status: "skipped",
      reason: "meta_dataset_missing",
    });
    expect(f.calls).toHaveLength(0);
  });

  it("no facebook media platform row (so no token reference)", async () => {
    const h = newHarness({ platformRow: false });
    const { offerPublicId } = ready(h);
    stubFetch();
    expect(await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click())).toEqual({
      status: "skipped",
      reason: "meta_platform_missing",
    });
  });

  it("the access token is not installed — fails closed before any request, and the dedupe slot is NOT spent", async () => {
    const h = newHarness({ token: null });
    const { offerPublicId } = ready(h);
    const f = stubFetch();
    expect(await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click())).toEqual({
      status: "skipped",
      reason: "meta_token_missing",
    });
    expect(f.calls).toHaveLength(0);
    expect(h.kv.size).toBe(0);
  });

  it("Meta rejects ⇒ 'failed' with Meta's code/type/trace only — never its message, never the token", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h);
    stubFetch(400, {
      error: { message: `Invalid OAuth access token ${TOKEN}`, type: "OAuthException", code: 190, fbtrace_id: "AbCdEf123" },
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click());
    expect(out).toEqual({
      status: "failed",
      reason: "meta_rejected",
      http_status: 400,
      meta_error: { code: 190, subcode: null, type: "OAuthException", fbtrace_id: "AbCdEf123" },
    });
    const logged = err.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).not.toContain("Invalid OAuth");
    expect(logged).not.toContain(TOKEN);
  });

  it("the network throws (with the URL in the message) ⇒ 'failed', the token never logged or stored", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError(`fetch failed ${ENDPOINT}?access_token=${TOKEN}`));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click());
    expect(out.status).toBe("failed");
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(err.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain(TOKEN);
    expect(JSON.stringify(lastOutcome(h.sdb, offerPublicId))).not.toContain(TOKEN);
  });
});

// ===========================================================================
// GET /lg/lc — the real route
// ===========================================================================

async function clickThrough(
  h: Harness,
  offerPublicId: string,
  q: { aiid: string; faid: string; extraQuery?: string },
): Promise<{ res: Response; captured: CapturedCtx }> {
  const captured = captureCtx();
  const href =
    buildLeadgenClickUrl(offerPublicId, {
      carrier_key: "",
      auction_instance_id: q.aiid,
      banner_render_id: "brid-1",
      slot: 1,
      funnel_attempt_id: q.faid,
    }).replace(/&amp;/g, "&") + (q.extraQuery ?? "");
  const res = await app.request(
    `http://${TENANT_HOST}${href}`,
    {
      headers: {
        "cf-connecting-ip": "203.0.113.7",
        "user-agent": "Mozilla/5.0 (iPhone)",
        referer: `https://${TENANT_HOST}/lg/business-loans`,
      },
    },
    h.env,
    captured.ctx,
  );
  await settle(captured);
  return { res, captured };
}

function moneyRows(sdb: SqliteDb): { revenue: number; conversions: number } {
  return {
    revenue: (sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_revenue_raw").get() as { n: number }).n,
    conversions: (sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_conversion_log").get() as { n: number }).n,
  };
}

describeDb("GET /lg/lc — a static offer's clickout sends Meta a media signal", () => {
  it("302 to the partner as before; exactly one Meta event carrying the AUCTION's fbc; no revenue, no conversion row", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h, {}, { aiid: "aiid-r1", faid: "att_r1" });
    const f = stubFetch();

    const { res } = await clickThrough(h, offerPublicId, { aiid: "aiid-r1", faid: "att_r1" });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toMatch(/^https:\/\/partner\.example\/go\?cid=lgl_/);
    expect(f.metaCalls()).toHaveLength(1);
    const body = JSON.parse(String(f.metaCalls()[0]!.init?.body)) as {
      data: Array<{ event_name: string; event_id: string; event_source_url: string; user_data: Record<string, unknown> }>;
    };
    expect(body.data[0]!.event_name).toBe("Purchase");
    // No `eid` on the link ⇒ the server names the event after the click it minted.
    const clickId = new URL(res.headers.get("Location")!).searchParams.get("cid");
    expect(body.data[0]!.event_id).toBe(`lgc_${clickId}`);
    expect(body.data[0]!.event_source_url).toBe(`https://${TENANT_HOST}/lg/business-loans`);
    expect(body.data[0]!.user_data["fbc"]).toBe(FBC);
    expect(body.data[0]!.user_data["client_ip_address"]).toBe("203.0.113.7");
    expect(moneyRows(h.sdb)).toEqual({ revenue: 0, conversions: 0 });
    expect(lastOutcome(h.sdb, offerPublicId).status).toBe("fired");
  });

  it("REVIEW F1 through the real route: a forged URL with a pasted fbclid and a fresh attempt id sends NOTHING (the visitor still gets the 302)", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb); // switched on, no auction behind it
    const f = stubFetch();
    const forged = await clickThrough(h, offerPublicId, { aiid: "", faid: "rvforge-1", extraQuery: `&fbclid=FORGED${FBCLID}` });
    expect(forged.res.status).toBe(302);
    expect(f.metaCalls()).toHaveLength(0);
  });

  it("REVIEW F1: an fbclid/fbc pasted onto a REAL banner link whose visitor was organic adds NOTHING to what Meta gets (the click is still sent — R1)", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h, {}, { aiid: "aiid-org", faid: "att_org", snapshot: { session_id: "s-org", utm_source: "google" } });
    const f = stubFetch();
    const { res } = await clickThrough(h, offerPublicId, { aiid: "aiid-org", faid: "att_org", extraQuery: `&fbclid=${FBCLID}&fbc=${FBC}` });
    expect(res.status).toBe(302);
    expect(f.metaCalls()).toHaveLength(1);
    const sent = String(f.metaCalls()[0]!.init?.body);
    expect(sent).not.toContain(FBCLID);
    expect((JSON.parse(sent) as { data: Array<{ user_data: Record<string, unknown> }> }).data[0]!.user_data).not.toHaveProperty("fbc");
  });

  it("OWNER R1: clicking the same banner twice in one funnel visit: two 302s, TWO Meta events with different ids", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h, {}, { aiid: "aiid-r2", faid: "att_r2" });
    const f = stubFetch();
    const a = await clickThrough(h, offerPublicId, { aiid: "aiid-r2", faid: "att_r2" });
    const b = await clickThrough(h, offerPublicId, { aiid: "aiid-r2", faid: "att_r2" });
    expect(a.res.status).toBe(302);
    expect(b.res.status).toBe(302);
    expect(f.metaCalls()).toHaveLength(2);
    const ids = f.metaCalls().map((c) => (JSON.parse(String(c.init?.body)) as { data: Array<{ event_id: string }> }).data[0]!.event_id);
    expect(new Set(ids).size).toBe(2);
  });

  it("switch OFF: the identical click sends nothing, and the 302 is the same", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h, { clickout: 0 }, { aiid: "aiid-r3", faid: "att_r3" });
    const f = stubFetch();
    const { res } = await clickThrough(h, offerPublicId, { aiid: "aiid-r3", faid: "att_r3" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toMatch(/^https:\/\/partner\.example\/go\?cid=lgl_/);
    expect(f.metaCalls()).toHaveLength(0);
  });

  it("0064: a provider-request (API) offer with the switch on sends its click event through the real route", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h, { static: false, clickout: 1 }, { aiid: "aiid-r4", faid: "att_r4" });
    const f = stubFetch();
    const { res } = await clickThrough(h, offerPublicId, { aiid: "aiid-r4", faid: "att_r4" });
    expect(res.status).toBe(302);
    expect(f.metaCalls()).toHaveLength(1);
  });

  it("Meta down: the visitor still gets the 302 (the send is after the response, on waitUntil)", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h, {}, { aiid: "aiid-r5", faid: "att_r5" });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { res } = await clickThrough(h, offerPublicId, { aiid: "aiid-r5", faid: "att_r5" });
    expect(res.status).toBe(302);
  });

  it("REVIEW F2: §26 is not reused — production's facebook row as it is today (the /tr GET template, enabled=0) is enough, and stays exactly as it was", async () => {
    const h = newHarness(); // the seeded placeholder row
    const before = h.sdb.prepare("SELECT * FROM leadgen_media_platforms").all();
    const { offerPublicId } = ready(h, {}, { aiid: "aiid-r6", faid: "att_r6" });
    const f = stubFetch();
    await clickThrough(h, offerPublicId, { aiid: "aiid-r6", faid: "att_r6" });
    expect(f.metaCalls()).toHaveLength(1);
    expect(new URL(f.metaCalls()[0]!.url).pathname).toBe(`/v25.0/${DATASET}/events`);
    expect(h.sdb.prepare("SELECT * FROM leadgen_media_platforms").all()).toEqual(before);
  });
});

// ===========================================================================
// the Offer API + the editor
// ===========================================================================

const API = "/api/admin/leadgen";
function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describeDb("Offer API — the switch exists on every offer (0064)", () => {
  it("saves and reads back on a static offer", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb, { clickout: 0, dataset: null });
    const res = await admin.request(
      `${API}/offers/${offerPublicId}`,
      jsonInit("PATCH", {
        clickout_meta_conversion: true,
        clickout_meta_dataset_id: ` ${DATASET} `,
        clickout_meta_event_name: "Lead",
        clickout_meta_value: null,
        clickout_meta_test_event_code: "TEST34567",
      }),
      h.env,
    );
    expect(res.status).toBe(200);
    const got = (await (await admin.request(`${API}/offers/${offerPublicId}`, {}, h.env)).json()) as Record<string, unknown>;
    expect(got["clickout_meta_conversion"]).toBe(true);
    expect(got["clickout_meta_dataset_id"]).toBe(DATASET);
    expect(got["clickout_meta_event_name"]).toBe("Lead");
    expect(got["clickout_meta_value"]).toBeNull();
    expect(got["clickout_meta_test_event_code"]).toBe("TEST34567");
    expect(got["clickout_meta_value_multiplier"]).toBe(1); // 0064 default
    expect(got["clickout_meta_last_status"]).toBeNull();
  });

  it("switching ON needs a dataset", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb, { clickout: 0, dataset: null });
    const res = await admin.request(`${API}/offers/${offerPublicId}`, jsonInit("PATCH", { clickout_meta_conversion: true }), h.env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields?: Record<string, string> };
    expect(body.fields?.["clickout_meta_dataset_id"]).toMatch(/required/);
  });

  it("0064: accepted on a provider-request offer (R2 — every offer), with a multiplier", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb, { static: false, clickout: 0 });
    const res = await admin.request(
      `${API}/offers/${offerPublicId}`,
      jsonInit("PATCH", { clickout_meta_conversion: true, clickout_meta_value_multiplier: 0.8 }),
      h.env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const got = (await (await admin.request(`${API}/offers/${offerPublicId}`, {}, h.env)).json()) as Record<string, unknown>;
    expect(got["clickout_meta_conversion"]).toBe(true);
    expect(got["clickout_meta_value_multiplier"]).toBe(0.8);
  });

  it("0064: switching a static offer to a provider-request mode keeps the switch on", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb, { clickout: 1 });
    const res = await admin.request(
      `${API}/offers/${offerPublicId}`,
      jsonInit("PATCH", { calls_provider_api: true, bid_source: "static" }),
      h.env,
    );
    expect(res.status).toBe(200);
    expect(offerRow(h.sdb, offerPublicId).clickout_meta_conversion).toBe(1);
  });

  it("0064: the multiplier must be above 0 and at most 100; null resets it to 1", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    for (const bad of [0, -1, 101, "2"]) {
      const res = await admin.request(`${API}/offers/${offerPublicId}`, jsonInit("PATCH", { clickout_meta_value_multiplier: bad }), h.env);
      expect(res.status, String(bad)).toBe(400);
      const body = (await res.json()) as { fields?: Record<string, string> };
      expect(body.fields?.["clickout_meta_value_multiplier"], String(bad)).toBeDefined();
    }
    expect((await admin.request(`${API}/offers/${offerPublicId}`, jsonInit("PATCH", { clickout_meta_value_multiplier: 2.5 }), h.env)).status).toBe(200);
    expect(offerRow(h.sdb, offerPublicId).clickout_meta_value_multiplier).toBe(2.5);
    expect((await admin.request(`${API}/offers/${offerPublicId}`, jsonInit("PATCH", { clickout_meta_value_multiplier: null }), h.env)).status).toBe(200);
    expect(offerRow(h.sdb, offerPublicId).clickout_meta_value_multiplier).toBe(1);
  });

  it("rejects an unknown event, a non-positive value, a malformed test code and a non-numeric dataset", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    for (const [field, value] of [
      ["clickout_meta_event_name", "PageView"],
      ["clickout_meta_value", 0],
      ["clickout_meta_test_event_code", "TEST 1<script>"],
      ["clickout_meta_dataset_id", "pixel-abc"],
    ] as const) {
      const res = await admin.request(`${API}/offers/${offerPublicId}`, jsonInit("PATCH", { [field]: value }), h.env);
      expect(res.status, field).toBe(400);
      const body = (await res.json()) as { fields?: Record<string, string> };
      expect(body.fields?.[field], field).toBeDefined();
    }
  });

  it("the outcome columns are read-only", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    const res = await admin.request(`${API}/offers/${offerPublicId}`, jsonInit("PATCH", { clickout_meta_last_status: "fired" }), h.env);
    expect(res.status).toBe(400);
  });
});

describeDb("Offer editor — the control, its copy, and what it can honestly say", () => {
  async function editorHtml(h: Harness, publicId: string): Promise<string> {
    const res = await admin.request(`/admin/leadgen/offers/${publicId}/edit`, {}, h.env);
    expect(res.status).toBe(200);
    return res.text();
  }
  function fieldset(html: string): string {
    const at = html.indexOf("<fieldset class=\"form-group lg-clickout-meta\"");
    expect(at, "the clickout fieldset is rendered").toBeGreaterThan(-1);
    return html.slice(at, html.indexOf("</fieldset>", at));
  }

  it("static offer: visible, under Auction mode on Basics, says browser AND server on every click, value = bid x multiplier or fixed, not Admin → Conversions", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    const html = await editorHtml(h, offerPublicId);
    const box = fieldset(html);
    expect(box.slice(0, box.indexOf(">"))).not.toContain("hidden");
    expect(box).toContain("Fire a Facebook event on every click of this offer");
    expect(box).toContain("in the visitor's browser (the Facebook pixel) AND sends the same event from the server");
    expect(box).toContain("the click's bid × the multiplier below, or the fixed value");
    expect(box).toContain("not configured in, and does not use, Admin → Conversions");
    expect(box).not.toContain("at most once per funnel visit per offer");
    expect(box).toContain('name="clickout_meta_value_multiplier"');
    expect(box).toContain('name="clickout_meta_dataset_id"');
    expect(box).toContain(`value="${DATASET}"`);
    const basics = html.indexOf('data-lg-tab-panel="basics"');
    const mode = html.indexOf("Auction mode", basics);
    expect(mode).toBeGreaterThan(basics);
    expect(html.indexOf("lg-clickout-meta", mode)).toBeGreaterThan(mode);
    expect(html.indexOf("lg-clickout-meta", mode)).toBeLessThan(html.indexOf('data-lg-tab-panel="static"'));
  });

  it("the test-code copy tells the truth: Meta still counts test events (Meta's docs: they 'are not dropped')", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    const box = fieldset(await editorHtml(h, offerPublicId));
    expect(box).toContain("Meta still counts these events");
    expect(box).not.toContain("not used for optimisation");
  });

  it("0064: provider-request offer — the control is visible too; a newly enabled offer defaults to Purchase", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb, { static: false, clickout: 0 });
    const box = fieldset(await editorHtml(h, offerPublicId));
    expect(box.slice(0, box.indexOf(">"))).not.toContain("hidden");
    expect(box).toContain('<option value="Purchase" selected>Purchase (default)</option>');
  });

  it("token installed: says exactly that — never 'Connected' — and the token is never on the page", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    const html = await editorHtml(h, offerPublicId);
    expect(fieldset(html)).toContain('data-lg-clickout-meta-status="token_installed"');
    expect(fieldset(html)).not.toContain("Connected");
    expect(html).not.toContain(TOKEN);
  });

  it("token missing: says nothing will be sent", async () => {
    const h = newHarness({ token: null });
    const { offerPublicId } = seedOffer(h.sdb);
    const box = fieldset(await editorHtml(h, offerPublicId));
    expect(box).toContain('data-lg-clickout-meta-status="token_missing"');
    expect(box).toContain("access token is not installed on the server yet, so nothing will be sent");
  });

  it("after a real clickout the Offer page shows what happened", async () => {
    const h = newHarness();
    const { offerPublicId } = ready(h, {}, { aiid: "aiid-e1", faid: "att_e1" });
    stubFetch();
    await clickThrough(h, offerPublicId, { aiid: "aiid-e1", faid: "att_e1" });
    vi.restoreAllMocks();
    const box = fieldset(await editorHtml(h, offerPublicId));
    expect(box).toContain('data-lg-clickout-meta-last="fired"');
    expect(box).toContain(`Sent to Meta dataset ${DATASET}: Purchase, Meta accepted 1 event.`);
  });
});
