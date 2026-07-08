// LeadGen Phase 11 STAGE B — the MOUNTED public runtime routes POST /lg/track +
// GET /lg/lc/:offer_id (contract 08 §22.1, 03 §4.3/§8.3 no-store, 07 §19 step 16
// + §18.7, 04 §10.5/§10.6, 09 §28) over the REAL index.ts app (node:sqlite
// harness with a base sites/domains schema so a TENANT host resolves + a
// Map-backed KV so any write-through runs). Proves:
//   * POST /lg/track → always 204 + no-store (mount stamps §4.3); a Firehose
//     no-op when the stream var is absent; fail-open on a malformed body; the
//     admin host → 404 (tenant-host only, via the /lg mount middleware).
//   * GET /lg/lc/:offer_id → 302 to the resolved destination (a governed link
//     built by buildLeadgenClickUrl) + no-store; mints an lgl_ click_id (proven
//     via a {click_id} template destination); increments the clicks cap; writes
//     the §18.7 remove-clicked row; a required-missing {response:*} → a safe
//     non-302 that STILL counts; the admin host → 404; the route is registered
//     BEFORE /lg/:quote_slug (a 3-segment /lg/lc path reaches the click handler,
//     never the slug shell).
//   * CP4 seam: an activated funnel → POST /lg/auction → banner href /lg/lc/…
//     carrying faid=<attempt> → GET it → 302 + the click counted (clicked row +
//     cap) — the full click money-path seam end-to-end.

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { buildLeadgenClickUrl } from "../src/public/leadgen/auction/banner";

// --- node:sqlite harness (repo pattern) --------------------------------------

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
  const db = {
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
  return db;
}

function makeKvStub(): { kv: KVNamespace; store: Map<string, { value: string; metadata: unknown }> } {
  const store = new Map<string, { value: string; metadata: unknown }>();
  const kv = {
    async get(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)!.value : null;
    },
    async getWithMetadata(key: string): Promise<{ value: string | null; metadata: unknown }> {
      const e = store.get(key);
      return e ? { value: e.value, metadata: e.metadata ?? null } : { value: null, metadata: null };
    },
    async put(key: string, value: string, opts?: { metadata?: unknown }): Promise<void> {
      store.set(key, { value, metadata: opts?.metadata ?? null });
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list(): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor: string }> {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql", // macro_context_json snapshot (04 §4.6)
] as const;

const TENANT_HOST = "one.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;
const ADMIN_HOST = "cms.kodigital.app";
const CONFIG_SIGNING_KEY = "runtime-signing-key-test-only";

function createRuntimeDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','one.example.com','insurance','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','one.example.com','active');",
  );
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
}

// `withStream=false` → LEADGEN_EVENTS_FIREHOSE_STREAM absent (the Firehose emit
// no-ops); AWS creds are never present here so a stream var alone still no-ops.
function buildEnv(db: D1Database, kv: KVNamespace, opts: { withStream?: boolean } = {}): Env {
  const env = {
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
    LEADGEN_CONFIG_SIGNING_KEY: CONFIG_SIGNING_KEY,
  } as unknown as Env;
  if (opts.withStream) (env as unknown as Record<string, unknown>).LEADGEN_EVENTS_FIREHOSE_STREAM = "leadgen-events";
  return env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;
const API = "/api/admin/leadgen";

interface Harness {
  sdb: SqliteDb;
  env: Env;
  store: Map<string, { value: string; metadata: unknown }>;
}
function newHarness(opts: { withStream?: boolean } = {}): Harness {
  const sdb = createRuntimeDb(DatabaseSync as DatabaseSyncCtor);
  const { kv, store } = makeKvStub();
  return { sdb, env: buildEnv(d1FromSqlite(sdb), kv, opts), store };
}

// waitUntil capture so the auction's non-blocking persist writes land before the
// click GET reads them (two passes: a nested waitUntil may register during the
// first drain).
interface CapturedCtx {
  ctx: ExecutionContext;
  promises: Promise<unknown>[];
}
function captureCtx(): CapturedCtx {
  const promises: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>): void {
      promises.push(Promise.resolve(p).catch(() => undefined));
    },
    passThroughOnException(): void {},
  } as unknown as ExecutionContext;
  return { ctx, promises };
}
async function settle(captured: CapturedCtx): Promise<void> {
  await Promise.all(captured.promises.map((p) => p.catch(() => undefined)));
  await Promise.all(captured.promises.map((p) => p.catch(() => undefined)));
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function reqTenant(env: Env, path: string, init?: RequestInit, ctx?: ExecutionContext): Promise<Response> {
  return app.request(`${TENANT_ORIGIN}${path}`, init ?? {}, env, ctx);
}
async function reqHost(env: Env, host: string, path: string, init?: RequestInit): Promise<Response> {
  return app.request(`http://${host}${path}`, init ?? {}, env);
}

// --- direct-SQL click-context seeders (for the focused /lg/lc tests) ----------

interface ParsedCarrierRow {
  carrier_key: string;
  carrier_key_source: string;
  carrier_name: string | null;
  carrier_logo: string | null;
  click_url: string | null;
  bid: number;
  bid_currency: string | null;
  tracking_id: string | null;
  headline: string | null;
  subheadline: string | null;
  disclaimer: string | null;
  pricing_model: string | null;
}
function parsedCarrier(overrides: Partial<ParsedCarrierRow> = {}): ParsedCarrierRow {
  return {
    carrier_key: "acme",
    carrier_key_source: "slug",
    carrier_name: "Acme Life",
    carrier_logo: null,
    click_url: "https://acme.example/click?x=1",
    bid: 12,
    bid_currency: "USD",
    tracking_id: null,
    headline: null,
    subheadline: null,
    disclaimer: null,
    pricing_model: null,
    ...overrides,
  };
}

function seedOffer(
  sdb: SqliteDb,
  opts: { bannerUrlTemplate?: string | null; capCountBy?: "clicks" | "conversions" } = {},
): { offerId: number; offerPublicId: string } {
  const offerPublicId = mintPublicId("offer");
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, banner_url_template,
          cap_enabled, cap_amount, cap_timezone, cap_count_by, status)
       VALUES (?, ?, 'Prov', 'quote_funnel', 'life', 's2s_postback', 'cpc', 0, 'static', 'server', ?, 1, 100, 'UTC', ?, 'active')`,
    )
    .run(offerPublicId, `Offer ${offerPublicId.slice(-4)}`, opts.bannerUrlTemplate ?? null, opts.capCountBy ?? "clicks");
  const row = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(offerPublicId) as { id: number };
  return { offerId: row.id, offerPublicId };
}

function seedAuctionRow(sdb: SqliteDb, opts: { removalScope?: "offer" | "carrier" } = {}): { auctionId: number; auctionPublicId: string } {
  const auctionPublicId = mintPublicId("auction");
  sdb
    .prepare(
      `INSERT INTO leadgen_auctions
         (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
          surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
          backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
       VALUES (?, 'A', 'dynamic', 'highest_bid', 'percentage_of_max', 10, 'enabled', 1, 5, 3, 10, 'disabled', 'on_slot_exhaustion', 1, ?, 2500, 1, 'active')`,
    )
    .run(auctionPublicId, opts.removalScope ?? "offer");
  const row = sdb.prepare("SELECT id FROM leadgen_auctions WHERE public_id = ?").get(auctionPublicId) as { id: number };
  return { auctionId: row.id, auctionPublicId };
}

function seedProviderLog(
  sdb: SqliteDb,
  opts: { aiid: string; offerPublicId: string; carriers: ParsedCarrierRow[]; responseRedacted?: unknown },
): void {
  sdb
    .prepare(
      "INSERT INTO leadgen_provider_request_log (auction_instance_id, offer_public_id, environment, parsed_carriers_json, response_redacted_json) VALUES (?, ?, 'production', ?, ?)",
    )
    .run(
      opts.aiid,
      opts.offerPublicId,
      JSON.stringify(opts.carriers),
      opts.responseRedacted === undefined ? null : JSON.stringify(opts.responseRedacted),
    );
}

function seedResultLog(
  sdb: SqliteDb,
  opts: { aiid: string; auctionPublicId: string; sessionId?: string; funnelId?: string; variantId?: string },
): void {
  sdb
    .prepare(
      "INSERT INTO leadgen_auction_result_log (auction_instance_id, auction_result_id, auction_config_id, session_id, funnel_id, funnel_variant_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(opts.aiid, "ares-1", opts.auctionPublicId, opts.sessionId ?? null, opts.funnelId ?? null, opts.variantId ?? null);
}

// Build the governed href exactly as the banner renderer does, then unescape the
// &amp; separators (the runtime rewrites HTML-escape it) for a GET.
function unescapeHref(href: string): string {
  return href.replace(/&amp;/g, "&");
}

// ===========================================================================
// POST /lg/track — the mounted beacon
// ===========================================================================

describeDb("POST /lg/track — mount (§22.1 / §4.3 no-store, tenant-host)", () => {
  it("204 + no-store on a tenant host; a valid event, stream ABSENT ⇒ Firehose no-op (no throw)", async () => {
    const { env } = newHarness({ withStream: false });
    const captured = captureCtx();
    const res = await reqTenant(
      env,
      "/lg/track",
      jsonInit("POST", { event_type: "quote_view", event_id: "evt-1", session_id: "s1", url: "https://one.example.com/lg/life" }),
      captured.ctx,
    );
    await settle(captured);
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.text()).toBe(""); // never reflects a client byte
  });

  it("fail-open on a malformed body → still 204 + no-store", async () => {
    const { env } = newHarness();
    const res = await reqTenant(env, "/lg/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("the ADMIN host → 404 (tenant-host only, via the /lg mount middleware)", async () => {
    const { env } = newHarness();
    const res = await reqHost(env, ADMIN_HOST, "/lg/track", jsonInit("POST", { event_type: "quote_view", event_id: "e" }));
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// GET /lg/lc/:offer_id — the mounted governed click resolver
// ===========================================================================

describeDb("GET /lg/lc/:offer_id — governed click resolver (§19.16 / §4.3)", () => {
  it("302 to the resolved destination (governed link) + no-store; increments the clicks cap + writes the §18.7 remove-clicked row", async () => {
    const { sdb, env } = newHarness();
    const { offerId, offerPublicId } = seedOffer(sdb, { capCountBy: "clicks" });
    const { auctionPublicId } = seedAuctionRow(sdb, { removalScope: "offer" });
    const aiid = "aiid-lc-1";
    seedProviderLog(sdb, { aiid, offerPublicId, carriers: [parsedCarrier({ carrier_key: "acme", click_url: "https://acme.example/click?x=1" })] });
    seedResultLog(sdb, { aiid, auctionPublicId, sessionId: "sess-1", funnelId: "lgf_x", variantId: "lgn_x" });

    const href = buildLeadgenClickUrl(offerPublicId, {
      carrier_key: "acme",
      auction_instance_id: aiid,
      banner_render_id: "brid-1",
      slot: 1,
      funnel_attempt_id: "att_click1",
    });
    const res = await reqTenant(env, href);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://acme.example/click?x=1");
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    // §10.6 cap incremented on the click (clicks-capped).
    const cap = sdb.prepare("SELECT click_count FROM leadgen_offer_cap_counters WHERE offer_id = ?").get(offerId) as { click_count: number } | undefined;
    expect(cap?.click_count).toBe(1);

    // §18.7 remove-clicked row keyed on funnel_attempt_id, scope 'offer' → carrier_key ''.
    const clicked = sdb
      .prepare("SELECT funnel_attempt_id, offer_id, carrier_key, removal_scope FROM leadgen_session_clicked_offers WHERE funnel_attempt_id = ?")
      .get("att_click1") as { funnel_attempt_id: string; offer_id: number; carrier_key: string; removal_scope: string } | undefined;
    expect(clicked).toBeDefined();
    expect(clicked!.offer_id).toBe(offerId);
    expect(clicked!.carrier_key).toBe("");
    expect(clicked!.removal_scope).toBe("offer");
  });

  it("mints an lgl_ click_id + resolves {response:*} from the persisted (redacted) response into the 302", async () => {
    const { sdb, env } = newHarness();
    // No provider click_url → resolve via banner_url_template + {response:*} + {click_id}.
    const { offerPublicId } = seedOffer(sdb, {
      bannerUrlTemplate: "https://go.example.com/c?slug={response:slug}&cid={click_id}",
    });
    const { auctionPublicId } = seedAuctionRow(sdb);
    const aiid = "aiid-lc-2";
    seedProviderLog(sdb, {
      aiid,
      offerPublicId,
      carriers: [parsedCarrier({ carrier_key: "acme", click_url: null })],
      responseRedacted: { slug: "acme" }, // the {response:slug} source (non-PII → passes through redaction)
    });
    seedResultLog(sdb, { aiid, auctionPublicId });

    const href = buildLeadgenClickUrl(offerPublicId, {
      carrier_key: "acme",
      auction_instance_id: aiid,
      banner_render_id: "brid-2",
      slot: 1,
      funnel_attempt_id: "att_click2",
    });
    const res = await reqTenant(env, href);
    expect(res.status).toBe(302);
    const loc = res.headers.get("Location") ?? "";
    expect(loc).toContain("slug=acme"); // {response:slug} resolved from the redacted response
    expect(loc).toMatch(/cid=lgl_/); // a freshly-minted lgl_ click_id was injected
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("a required {response:*} missing at click time → safe non-302 (204, no-store) but the click STILL counts", async () => {
    const { sdb, env } = newHarness();
    const { offerId, offerPublicId } = seedOffer(sdb, {
      bannerUrlTemplate: "https://go.example.com/c?slug={response:slug}", // slug REQUIRED
    });
    const { auctionPublicId } = seedAuctionRow(sdb);
    const aiid = "aiid-lc-3";
    seedProviderLog(sdb, {
      aiid,
      offerPublicId,
      carriers: [parsedCarrier({ carrier_key: "acme", click_url: null })],
      responseRedacted: { other: "x" }, // slug absent → required_missing
    });
    seedResultLog(sdb, { aiid, auctionPublicId });

    const href = buildLeadgenClickUrl(offerPublicId, {
      carrier_key: "acme",
      auction_instance_id: aiid,
      banner_render_id: "brid-3",
      slot: 1,
      funnel_attempt_id: "att_click3",
    });
    const res = await reqTenant(env, href);
    // NEVER a 302 to a broken URL — a safe no-redirect.
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // …but the click still counted (cap + clicked row).
    const cap = sdb.prepare("SELECT click_count FROM leadgen_offer_cap_counters WHERE offer_id = ?").get(offerId) as { click_count: number } | undefined;
    expect(cap?.click_count).toBe(1);
    const clicked = sdb.prepare("SELECT funnel_attempt_id FROM leadgen_session_clicked_offers WHERE funnel_attempt_id = ?").get("att_click3");
    expect(clicked).toBeDefined();
  });

  it("the ADMIN host → 404 (tenant-host only)", async () => {
    const { sdb, env } = newHarness();
    const { offerPublicId } = seedOffer(sdb);
    const href = buildLeadgenClickUrl(offerPublicId, {
      carrier_key: "acme",
      auction_instance_id: "aiid-x",
      banner_render_id: "brid-x",
      slot: 1,
      funnel_attempt_id: "att_x",
    });
    const res = await reqHost(env, ADMIN_HOST, href);
    expect(res.status).toBe(404);
  });

  it("registered BEFORE /lg/:quote_slug: a 3-segment /lg/lc/<unknown> reaches the click handler (204), not the slug shell (404)", async () => {
    const { env } = newHarness();
    // No offer / no context → the click handler resolves no target → safe 204
    // (a proof the /lg/lc/:offer_id route wins over /lg/:quote_slug, which would
    // 404 an unknown slug). A 3-segment path cannot structurally match the
    // 2-segment slug route, and the route is registered ahead of it regardless.
    const res = await reqTenant(env, "/lg/lc/lgo_nonexistent?ck=x&aiid=a&brid=b&slot=1&faid=att_z");
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

// ===========================================================================
// CP4 seam — activated funnel → auction → banner href → click
// ===========================================================================

const CARRIER_PARSE = JSON.stringify({
  carriers_path: "carriers",
  fields: { carrier_name: "name", bid: "bid", click_url: "url", carrier_logo: "logo" },
});

function seedSection(sdb: SqliteDb): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({
    components: [{ type: "TwoButtonYesNo", question_id: "q1", question_key: "k", internal_field: "f", answer_type: "boolean" }],
  });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', 'Headline', ?, 'button', 0, 'active')",
    )
    .run(publicId, `Section ${publicId.slice(-4)}`, content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

async function seedActivatedFunnel(env: Env, sdb: SqliteDb, slug: string): Promise<{ variantId: string; funnelId: string }> {
  const createRes = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: `Q ${slug}`, activity: "quote_funnel", verticals: ["life"] }), env);
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const quote = (await createRes.json()) as { public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> };
  const funnelId = quote.funnels[0]!.public_id;
  const variantId = quote.funnels[0]!.variants[0]!.public_id;
  const section = seedSection(sdb);
  const putRes = await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { sections: [{ section_id: section.id }] }), env);
  expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);
  const actRes = await admin.request(`${API}/quotes/${quote.public_id}/activation/site-1`, jsonInit("PUT", { enabled: true, slug }), env);
  expect(actRes.status, `activate: ${await actRes.clone().text()}`).toBe(200);
  return { variantId, funnelId };
}

// A dynamic CPC offer (calls the provider) with a payload schema + carrier parse,
// attached to an auction that is wired onto the funnel variant.
function seedDynamicAuctionForVariant(sdb: SqliteDb, variantId: string): { offerPublicId: string; offerId: number } {
  const offerPublicId = mintPublicId("offer");
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, static_bid_currency, banner_url_template,
          static_fallback_banner_url, request_method, endpoint_production, endpoint_staging,
          cap_enabled, cap_amount, cap_timezone, cap_count_by, status)
       VALUES (?, ?, ?, 'quote_funnel', 'life', 's2s_postback', 'cpc', 1, 'response', 'server', 'USD', NULL,
               'https://static.example/click', 'POST', 'https://provider.example/quote', 'https://staging.provider.example/quote',
               1, 100, 'UTC', 'clicks', 'active')`,
    )
    .run(offerPublicId, `Offer ${offerPublicId.slice(-4)}`, `Prov ${offerPublicId.slice(-4)}`);
  const offer = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(offerPublicId) as { id: number };

  const schemaPublic = mintPublicId("payload_schema_version");
  sdb
    .prepare(
      "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, carrier_parse_json, carrier_parse_version, source) VALUES (?, ?, 1, ?, ?, 1, 'manual')",
    )
    .run(schemaPublic, offer.id, JSON.stringify({ version: 1, root: { type: "object", children: [] } }), CARRIER_PARSE);
  const schema = sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = ?").get(schemaPublic) as { id: number };
  sdb.prepare("UPDATE leadgen_offers SET active_payload_schema_id = ? WHERE id = ?").run(schema.id, offer.id);

  const placementPublic = mintPublicId("offer_placement");
  sdb.prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)").run(placementPublic, offer.id, `plc-${offerPublicId.slice(-4)}`);
  const placement = sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(placementPublic) as { id: number };

  const auctionPublic = mintPublicId("auction");
  sdb
    .prepare(
      `INSERT INTO leadgen_auctions
         (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
          surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
          backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
       VALUES (?, 'A', 'dynamic', 'highest_bid', 'percentage_of_max', 10, 'enabled', 1, 5, 3, 10, 'disabled', 'on_slot_exhaustion', 1, 'offer', 2500, 1, 'active')`,
    )
    .run(auctionPublic);
  const auction = sdb.prepare("SELECT id FROM leadgen_auctions WHERE public_id = ?").get(auctionPublic) as { id: number };
  sdb.prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, enabled) VALUES (?, ?, ?, 0, 1)").run(auction.id, placement.id, offer.id);
  sdb.prepare("UPDATE leadgen_funnel_variants SET auction_id = ? WHERE public_id = ?").run(auction.id, variantId);
  // R4 (fix-contract v2.4 05 §5.1): a dynamic Offer participates only with a
  // PASSED Test verdict — one TEST-TOOL provider_request_log row (NULL
  // auction_instance_id) marks it tested.
  sdb
    .prepare("INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code) VALUES (?, 'production', 200)")
    .run(offerPublicId);
  return { offerPublicId, offerId: offer.id };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describeDb("CP4 — funnel → auction → banner href /lg/lc/… (faid) → GET → 302 + click counted", () => {
  it("end-to-end: the live auction banner href carries faid=<attempt>; GETting it 302s + counts the click", async () => {
    const { sdb, env } = newHarness();
    const { variantId } = await seedActivatedFunnel(env, sdb, "cp4");
    const { offerId } = seedDynamicAuctionForVariant(sdb, variantId);

    // The client binding: section_order_hash from /lg/config, funnel_attempt_id +
    // signed_config_token from /lg/attempt (the P7 mint the anti-tamper validates).
    const config = (await reqTenant(env, `/lg/config/${variantId}`).then((r) => r.json())) as { section_order_hash: string };
    const attempt = (await reqTenant(env, `/lg/attempt?funnel_variant_id=${variantId}`).then((r) => r.json())) as {
      funnel_attempt_id: string;
      signed_config_token: string;
    };
    expect(attempt.funnel_attempt_id.startsWith("att_")).toBe(true);

    // POST /lg/auction with a mocked provider → banners_html with the governed href.
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ carriers: [{ name: "Acme", bid: 12, url: "https://acme.example/click?c=1", logo: "https://acme.example/l.png" }] }), { status: 200 }),
    );
    const captured = captureCtx();
    const auctionRes = await reqTenant(
      env,
      "/lg/auction",
      jsonInit("POST", {
        funnel_variant_id: variantId,
        funnel_attempt_id: attempt.funnel_attempt_id,
        section_order_hash: config.section_order_hash,
        signed_config_token: attempt.signed_config_token,
        answers: {},
      }),
      captured.ctx,
    );
    expect(auctionRes.status, `auction: ${await auctionRes.clone().text()}`).toBe(200);
    const auction = (await auctionRes.json()) as { status: string; banners_html: string };
    expect(auction.status).toBe("ok");
    await settle(captured); // land the §28 waitUntil persist writes (provider + result log)

    // The governed banner href carries faid=<attempt> (the engine thread) — extract it.
    const hrefMatch = auction.banners_html.match(/href="([^"]*\/lg\/lc\/[^"]*)"/);
    expect(hrefMatch, `banners_html: ${auction.banners_html}`).not.toBeNull();
    const href = unescapeHref(hrefMatch![1] ?? "");
    expect(href).toContain(`faid=${attempt.funnel_attempt_id}`);

    // GET the governed href → 302 to the resolved carrier destination + no-store.
    const clickRes = await reqTenant(env, href);
    expect(clickRes.status, `click: ${clickRes.status}`).toBe(302);
    expect(clickRes.headers.get("Location")).toBe("https://acme.example/click?c=1");
    expect(clickRes.headers.get("Cache-Control")).toBe("no-store");

    // The click counted: the §18.7 remove-clicked row for this attempt + the cap.
    const clicked = sdb
      .prepare("SELECT offer_id FROM leadgen_session_clicked_offers WHERE funnel_attempt_id = ?")
      .get(attempt.funnel_attempt_id) as { offer_id: number } | undefined;
    expect(clicked).toBeDefined();
    expect(clicked!.offer_id).toBe(offerId);
    const cap = sdb.prepare("SELECT click_count FROM leadgen_offer_cap_counters WHERE offer_id = ?").get(offerId) as { click_count: number } | undefined;
    expect(cap?.click_count).toBe(1);
  });
});
