// LeadGen — Meta (Facebook) conversion on CLICKOUT for "Static — no provider
// request" Offers (0058, src/leadgen/clickout-meta.ts).
//
// Source ask (marketing, #haikov-support, 2026-09-17): partners with no API
// give no conversion signal, so send Meta a conversion when the visitor clicks
// out; the setting lives on the LeadGen Offer, only for Static — no provider
// request; media signal only — no LeadGen revenue; default OFF.
//
// What these tests hold, against the REAL migrations and the REAL app:
//   * the sender: exact Graph request (the shape the Conversions engine's
//     destination-meta adapter and the reference funnel both use), the
//     once-per-visitor-per-Offer dedupe, and every reason it refuses to send —
//     including production's ACTUAL facebook row today (the seeded /tr
//     placeholder), which must read as "not configured", never fire;
//   * GET /lg/lc: the visitor's 302 is byte-identical with the feature on or
//     off, the Meta POST happens only for a static Offer with the switch on,
//     and no revenue / conversion row is ever written;
//   * the Offer API: the switch is refused for any other auction mode;
//   * the editor: the control shows only for Static, says it is not Admin →
//     Conversions, states whether Meta is actually connected, and never
//     renders the token.

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
function newHarness(opts: { token?: string | null; template?: string | null } = {}): Harness {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  const { kv, store } = makeKvStub();
  const template = opts.template === undefined ? ENDPOINT : opts.template;
  if (template !== null) {
    sdb
      .prepare(
        "INSERT INTO leadgen_media_platforms (platform, enabled, postback_url_template, auth_secret_ref, event_name, value_multiplier) VALUES ('facebook', 0, ?, 'LEADGEN_S2S_TOKEN_FACEBOOK', 'Purchase', 1)",
      )
      .run(template);
  }
  return { sdb, env: buildEnv(d1FromSqlite(sdb), kv, { token: opts.token }), kv: store };
}

function seedOffer(
  sdb: SqliteDb,
  opts: { static?: boolean; clickout?: number; eventName?: string | null; value?: number | null; testCode?: string | null } = {},
): { offerId: number; offerPublicId: string } {
  const offerPublicId = mintPublicId("offer");
  const isStatic = opts.static ?? true;
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, banner_url_template,
          static_bid_value, static_bid_currency, cap_enabled, status,
          clickout_meta_conversion, clickout_meta_event_name, clickout_meta_value, clickout_meta_test_event_code)
       VALUES (?, 'Fora - Tier 3', 'Impact', 'leadgen', 'Business Loans', 's2s_postback', 'cpl',
               ?, 'static', 'server', 'https://partner.example/go?cid={click_id}',
               200, 'USD', 0, 'active', ?, ?, ?, ?)`,
    )
    .run(
      offerPublicId,
      isStatic ? 0 : 1,
      opts.clickout ?? 1,
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

// The auction's persisted macro snapshot is where the click route gets the
// visitor's Meta identifiers — the real shape, from a real production row.
function seedResultLog(sdb: SqliteDb, aiid: string, snapshot: Record<string, string>): void {
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
  sdb
    .prepare(
      "INSERT INTO leadgen_auction_result_log (auction_instance_id, auction_result_id, auction_config_id, session_id, funnel_id, macro_context_json) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(aiid, `ares-${aiid}`, auctionPublicId, snapshot["session_id"] ?? null, "lgf_x", JSON.stringify(snapshot));
}

const META_SNAPSHOT = {
  session_id: "be9974ca-3fd9-46fc-bcfb-27da76a628a4",
  utm_source: "mln",
  utm_medium: "paid",
  fbc: FBC,
  fbclid: FBCLID,
};

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
    funnel_attempt_id: "att_1",
    session_id: META_SNAPSHOT.session_id,
    fbc: FBC,
    fbclid: FBCLID,
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
      "SELECT public_id, calls_provider_api, clickout_meta_conversion, clickout_meta_event_name, clickout_meta_value, clickout_meta_test_event_code, static_bid_currency FROM leadgen_offers WHERE public_id = ?",
    )
    .get(publicId) as ClickoutMetaOffer;
}

// ===========================================================================
// the sender
// ===========================================================================

describeDb("sendClickoutMetaConversion — what reaches Meta", () => {
  it("POSTs one Conversions API event to the dataset, token as access_token, the visitor's Meta click id attached", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb, { testCode: "TEST34567" });
    const f = stubFetch();
    const out = await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click(), { now: 1790500000123 });

    expect(out).toEqual({
      status: "fired",
      dataset_id: DATASET,
      event_name: "Lead",
      event_id: `lgco.att_1.${offerPublicId}`,
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
      event_name: "Lead",
      event_time: 1790500000,
      event_id: `lgco.att_1.${offerPublicId}`,
      action_source: "website",
      event_source_url: "https://moneylantern.com/lg/business-loans?fbclid=x",
      user_data: {
        fbc: FBC,
        client_ip_address: "203.0.113.7",
        client_user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
        external_id: [createHash("sha256").update(META_SNAPSHOT.session_id).digest("hex")],
      },
    });
    // No value configured ⇒ no value sent. A click is not a sale.
    expect(body.data[0]).not.toHaveProperty("custom_data");
  });

  it("the token never appears in the log line", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    stubFetch();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click());
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("leadgen clickout meta conversion") && l.includes('"status":"fired"'))).toBe(true);
    expect(lines.join("\n")).not.toContain(TOKEN);
  });

  it("an operator-set value goes out as custom_data in the offer's currency; the chosen event name is used", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb, { value: 12.5, eventName: "SubmitApplication" });
    const f = stubFetch();
    await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click());
    const body = JSON.parse(String(f.metaCalls()[0]!.init?.body)) as { data: Array<Record<string, unknown>>; test_event_code?: string };
    expect(body.data[0]!["event_name"]).toBe("SubmitApplication");
    expect(body.data[0]!["custom_data"]).toEqual({ value: 12.5, currency: "USD" });
    expect(body).not.toHaveProperty("test_event_code"); // live, not a test
  });

  it("fbclid only (no fbc captured) ⇒ fbc derived exactly as §26 derives it", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    const f = stubFetch();
    await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click({ fbc: "" }), { now: 1790500000123 });
    const body = JSON.parse(String(f.metaCalls()[0]!.init?.body)) as { data: Array<{ user_data: { fbc: string } }> };
    expect(body.data[0]!.user_data.fbc).toBe(`fb.1.1790500000123.${FBCLID}`);
  });

  it("once per visitor per offer: a second click in the same funnel attempt is deduped; another visitor still fires", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    const f = stubFetch();
    const offer = offerRow(h.sdb, offerPublicId);
    const first = await sendClickoutMetaConversion(h.env, h.env.DB, offer, click({ click_id: "lgl_A" }));
    const again = await sendClickoutMetaConversion(h.env, h.env.DB, offer, click({ click_id: "lgl_B" }));
    const other = await sendClickoutMetaConversion(h.env, h.env.DB, offer, click({ click_id: "lgl_C", funnel_attempt_id: "att_2" }));
    expect(first.status).toBe("fired");
    expect(again).toEqual({ status: "deduped", event_id: `lgco.att_1.${offerPublicId}` });
    expect(other.status).toBe("fired");
    expect(f.metaCalls()).toHaveLength(2);
    // the LeadGen S2S KV prefix
    expect([...h.kv.keys()].every((k) => k.startsWith("lg_s2s:facebook:clickout:"))).toBe(true);
  });

  it("no attempt id on the href ⇒ the click_id is the identity (at most once per click_id)", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    const f = stubFetch();
    const offer = offerRow(h.sdb, offerPublicId);
    await sendClickoutMetaConversion(h.env, h.env.DB, offer, click({ funnel_attempt_id: "", click_id: "lgl_X" }));
    const replay = await sendClickoutMetaConversion(h.env, h.env.DB, offer, click({ funnel_attempt_id: "", click_id: "lgl_X" }));
    expect(replay).toEqual({ status: "deduped", event_id: "lgco.lgl_X" });
    expect(f.metaCalls()).toHaveLength(1);
  });
});

describeDb("sendClickoutMetaConversion — every reason it sends nothing", () => {
  it("switch off (the default for every existing offer)", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb, { clickout: 0 });
    const f = stubFetch();
    expect(await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click())).toEqual({
      status: "skipped",
      reason: "offer_setting_off",
    });
    expect(f.calls).toHaveLength(0);
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

  it("a provider-request offer, even with the flag forced on in the database", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb, { static: false, clickout: 1 });
    const f = stubFetch();
    expect(await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click())).toEqual({
      status: "skipped",
      reason: "offer_not_static",
    });
    expect(f.calls).toHaveLength(0);
  });

  it("a visitor who did not come from Meta (no fbc, no fbclid)", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    const f = stubFetch();
    expect(
      await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click({ fbc: "", fbclid: "" })),
    ).toEqual({ status: "skipped", reason: "not_meta_traffic" });
    expect(f.calls).toHaveLength(0);
  });

  it("PRODUCTION'S ROW TODAY — the seeded /tr placeholder — is 'not configured', never a fire", async () => {
    const h = newHarness({ template: SEED_FACEBOOK_TEMPLATE });
    const { offerPublicId } = seedOffer(h.sdb);
    const f = stubFetch();
    expect(await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click())).toEqual({
      status: "skipped",
      reason: "meta_endpoint_not_configured",
    });
    expect(f.calls).toHaveLength(0);
  });

  it("no facebook media platform at all", async () => {
    const h = newHarness({ template: null });
    const { offerPublicId } = seedOffer(h.sdb);
    stubFetch();
    expect((await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click())).status).toBe("skipped");
  });

  it("the Conversions API token is not installed — fails closed before any request, and the dedupe slot is NOT spent", async () => {
    const h = newHarness({ token: null });
    const { offerPublicId } = seedOffer(h.sdb);
    const f = stubFetch();
    expect(await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click())).toEqual({
      status: "skipped",
      reason: "meta_token_missing",
    });
    expect(f.calls).toHaveLength(0);
    expect(h.kv.size).toBe(0);
  });

  it("Meta rejects (4xx) ⇒ 'failed' with the status, logged, never thrown", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    // Meta's real bad-token answer shape.
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
    // Meta's free-form message is never logged — not even when it quotes back what we sent.
    expect(err.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("Invalid OAuth");
    expect(err.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain(TOKEN);
  });

  it("the network throws (with the URL in the message) ⇒ 'failed', the token never logged", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError(`fetch failed ${ENDPOINT}?access_token=${TOKEN}`));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await sendClickoutMetaConversion(h.env, h.env.DB, offerRow(h.sdb, offerPublicId), click());
    expect(out.status).toBe("failed");
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(err.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain(TOKEN);
  });
});

// ===========================================================================
// GET /lg/lc — the real route
// ===========================================================================

async function clickThrough(h: Harness, offerPublicId: string, aiid: string, faid: string): Promise<{ res: Response; captured: CapturedCtx }> {
  const captured = captureCtx();
  const href = buildLeadgenClickUrl(offerPublicId, {
    carrier_key: "",
    auction_instance_id: aiid,
    banner_render_id: "brid-1",
    slot: 1,
    funnel_attempt_id: faid,
  }).replace(/&amp;/g, "&");
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
  it("302 to the partner as before; exactly one Meta event with the visitor's fbc; no revenue, no conversion row", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    seedResultLog(h.sdb, "aiid-meta-1", META_SNAPSHOT);
    const f = stubFetch();

    const { res } = await clickThrough(h, offerPublicId, "aiid-meta-1", "att_meta_1");

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toMatch(/^https:\/\/partner\.example\/go\?cid=lgl_/);
    expect(f.metaCalls()).toHaveLength(1);
    const body = JSON.parse(String(f.metaCalls()[0]!.init?.body)) as {
      data: Array<{ event_name: string; event_id: string; event_source_url: string; user_data: Record<string, unknown> }>;
    };
    expect(body.data[0]!.event_name).toBe("Lead");
    expect(body.data[0]!.event_id).toBe(`lgco.att_meta_1.${offerPublicId}`);
    expect(body.data[0]!.event_source_url).toBe(`https://${TENANT_HOST}/lg/business-loans`);
    expect(body.data[0]!.user_data["fbc"]).toBe(FBC);
    expect(body.data[0]!.user_data["client_ip_address"]).toBe("203.0.113.7");
    expect(moneyRows(h.sdb)).toEqual({ revenue: 0, conversions: 0 });
  });

  it("clicking the same banner twice in one funnel attempt: two 302s, ONE Meta event", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    seedResultLog(h.sdb, "aiid-meta-2", META_SNAPSHOT);
    const f = stubFetch();
    const a = await clickThrough(h, offerPublicId, "aiid-meta-2", "att_meta_2");
    const b = await clickThrough(h, offerPublicId, "aiid-meta-2", "att_meta_2");
    expect(a.res.status).toBe(302);
    expect(b.res.status).toBe(302);
    expect(f.metaCalls()).toHaveLength(1);
  });

  it("switch OFF: the identical click sends nothing, and the 302 is the same", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb, { clickout: 0 });
    seedResultLog(h.sdb, "aiid-meta-3", META_SNAPSHOT);
    const f = stubFetch();
    const { res } = await clickThrough(h, offerPublicId, "aiid-meta-3", "att_meta_3");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toMatch(/^https:\/\/partner\.example\/go\?cid=lgl_/);
    expect(f.metaCalls()).toHaveLength(0);
  });

  it("a provider-request offer is unchanged: no Meta event even with the flag forced on", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb, { static: false, clickout: 1 });
    seedResultLog(h.sdb, "aiid-meta-4", META_SNAPSHOT);
    const f = stubFetch();
    const { res } = await clickThrough(h, offerPublicId, "aiid-meta-4", "att_meta_4");
    expect(res.status).toBe(302);
    expect(f.metaCalls()).toHaveLength(0);
  });

  it("Meta down: the visitor still gets the 302 (the send is after the response, on waitUntil)", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    seedResultLog(h.sdb, "aiid-meta-5", META_SNAPSHOT);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { res } = await clickThrough(h, offerPublicId, "aiid-meta-5", "att_meta_5");
    expect(res.status).toBe(302);
  });
});

// ===========================================================================
// the Offer API + the editor
// ===========================================================================

const API = "/api/admin/leadgen";
function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

describeDb("Offer API — the switch exists only for Static — no provider request", () => {
  it("saves and reads back on a static offer", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb, { clickout: 0 });
    const res = await admin.request(
      `${API}/offers/${offerPublicId}`,
      jsonInit("PATCH", {
        clickout_meta_conversion: true,
        clickout_meta_event_name: "Lead",
        clickout_meta_value: null,
        clickout_meta_test_event_code: "TEST34567",
      }),
      h.env,
    );
    expect(res.status).toBe(200);
    const got = (await (await admin.request(`${API}/offers/${offerPublicId}`, {}, h.env)).json()) as Record<string, unknown>;
    expect(got["clickout_meta_conversion"]).toBe(true);
    expect(got["clickout_meta_event_name"]).toBe("Lead");
    expect(got["clickout_meta_value"]).toBeNull();
    expect(got["clickout_meta_test_event_code"]).toBe("TEST34567");
  });

  it("refused on a provider-request offer", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb, { static: false, clickout: 0 });
    const res = await admin.request(`${API}/offers/${offerPublicId}`, jsonInit("PATCH", { clickout_meta_conversion: true }), h.env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields?: Record<string, string> };
    expect(body.fields?.["clickout_meta_conversion"]).toMatch(/only available for Static — no provider request/);
  });

  it("switching a static offer to a provider-request mode while the switch is on is refused, not silently kept", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb, { clickout: 1 });
    const res = await admin.request(
      `${API}/offers/${offerPublicId}`,
      jsonInit("PATCH", { calls_provider_api: true, bid_source: "static" }),
      h.env,
    );
    expect(res.status).toBe(400);
    const ok = await admin.request(
      `${API}/offers/${offerPublicId}`,
      jsonInit("PATCH", { calls_provider_api: true, bid_source: "static", clickout_meta_conversion: false }),
      h.env,
    );
    expect(ok.status).toBe(200);
  });

  it("rejects an unknown event, a non-positive value and a malformed test code", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    for (const [field, value] of [
      ["clickout_meta_event_name", "PageView"],
      ["clickout_meta_value", 0],
      ["clickout_meta_test_event_code", "TEST 1<script>"],
    ] as const) {
      const res = await admin.request(`${API}/offers/${offerPublicId}`, jsonInit("PATCH", { [field]: value }), h.env);
      expect(res.status, field).toBe(400);
      const body = (await res.json()) as { fields?: Record<string, string> };
      expect(body.fields?.[field], field).toBeDefined();
    }
  });
});

describeDb("Offer editor — the control, its copy, and whether Meta is really connected", () => {
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

  it("static offer: visible, under Auction mode on Basics, says it is not Admin → Conversions and books no revenue", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    const html = await editorHtml(h, offerPublicId);
    const box = fieldset(html);
    expect(box.slice(0, box.indexOf(">"))).not.toContain("hidden");
    expect(box).toContain("Fire Meta conversion on clickout");
    expect(box).toContain("not configured in, and does not use, Admin → Conversions");
    expect(box).toContain("books no LeadGen revenue");
    // placed right after the Auction mode radios, inside the Basics panel
    const basics = html.indexOf('data-lg-tab-panel="basics"');
    const mode = html.indexOf("Auction mode", basics);
    expect(mode).toBeGreaterThan(basics);
    expect(html.indexOf("lg-clickout-meta", mode)).toBeGreaterThan(mode);
    expect(html.indexOf("lg-clickout-meta", mode)).toBeLessThan(html.indexOf('data-lg-tab-panel="static"'));
  });

  it("provider-request offer: rendered hidden (the mode radio can still reveal it without a reload)", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb, { static: false, clickout: 0 });
    const box = fieldset(await editorHtml(h, offerPublicId));
    expect(box.slice(0, box.indexOf(">"))).toContain("hidden");
  });

  it("connected: names the dataset — and the token is never on the page", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h.sdb);
    const html = await editorHtml(h, offerPublicId);
    expect(fieldset(html)).toContain(`data-lg-clickout-meta-status="connected"`);
    expect(fieldset(html)).toContain(`Meta dataset ${DATASET}`);
    expect(html).not.toContain(TOKEN);
  });

  it("production's row today (the /tr placeholder): says NOT connected, plainly", async () => {
    const h = newHarness({ template: SEED_FACEBOOK_TEMPLATE });
    const { offerPublicId } = seedOffer(h.sdb);
    const box = fieldset(await editorHtml(h, offerPublicId));
    expect(box).toContain(`data-lg-clickout-meta-status="meta_endpoint_not_configured"`);
    expect(box).toContain("Not connected");
  });

  it("dataset set but token missing: says so", async () => {
    const h = newHarness({ token: null });
    const { offerPublicId } = seedOffer(h.sdb);
    const box = fieldset(await editorHtml(h, offerPublicId));
    expect(box).toContain(`data-lg-clickout-meta-status="meta_token_missing"`);
    expect(box).toContain(`Meta dataset ${DATASET} is set, but its Conversions API access token is not installed`);
  });
});
