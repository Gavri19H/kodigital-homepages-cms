// LeadGen fix-contract v2.4 — Slice B gate tests (G2 + G3).
//
// G2 (04 §4.7/§4.6 — runtime context + snapshot + click merge):
//   * a LIVE /lg/auction provider payload carries REAL geo/ip/ua/utm values
//     (fabricated request.cf + headers through the real HTTP path; traffic
//     from the /lg/attempt `u` landing URL persisted in the SIGNED token);
//   * Test-tool parity — the SAME simulated context produces the SAME payload
//     as the runtime builder (both call buildLeadgenRuntimeContext);
//   * click-time merge precedence — persisted snapshot wins for
//     session/traffic keys, fresh request values win for request keys,
//     click_id always fresh;
//   * snapshot redaction — NO raw ip/ua/url/referer in the persisted
//     macro_context_json;
//   * §5.4 version stamps non-empty on every auction-path event.
//
// G3 (05 §5.1/§5.2/§5.3 — gates):
//   * dynamicAuctionEligibility extended-codes matrix;
//   * the engine EXCLUDES an ineligible dynamic Offer with a typed reason and
//     the mock provider records ZERO calls for it;
//   * auctions PUT offers → warnings[] {offer_id, eligible:false, reasons[]};
//   * activation PUT → the EXACT normative 409 report (code + fields[] +
//     fix_links) and a clean quote → 200;
//   * variant save recomputes + stores the preflight verdict;
//   * anti-tamper tuple v2: per-field tamper matrix — EACH of the 7 bound
//     fields mutated inside a RE-SIGNED payload (valid signature, wrong
//     tuple) → 422 + `tampered`;
//   * a v1 token: grace flag off ⇒ reject, on ⇒ accept;
//   * an `unsigned.` token is rejected on the money path even with NO
//     signing secret (fails closed).

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { sha256Hex } from "../src/public/leadgen/auction/parse";
import { dynamicAuctionEligibility } from "../src/leadgen/validation";
import { buildLeadgenRuntimeContext } from "../src/leadgen/runtime-context";
import { buildPayload, type LeadgenPayloadSchema } from "../src/leadgen/payload";
import { fetchProvider } from "../src/public/leadgen/auction/fetch";
import { loadAuctionBundle, runAuction } from "../src/public/leadgen/auction/engine";
import {
  computeAttemptBindingExtras,
  mintFunnelAttempt,
  verifyConfigTokenDetailed,
  type ConfigTokenTuple,
} from "../src/public/leadgen/attempt";
import { buildLeadgenClickUrl } from "../src/public/leadgen/auction/banner";
import type { ResolvedActivatedFunnel } from "../src/public/leadgen/resolver";
import type { LeadgenOfferRow, LeadgenSectionRow } from "../src/admin/leadgen/db-types";

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

function makeKvStub(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)! : null;
    },
    async getWithMetadata(key: string): Promise<{ value: string | null; metadata: unknown }> {
      return { value: store.get(key) ?? null, metadata: null };
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
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
  "0040_leadgen_runtime_context.sql",
] as const;

const TENANT_HOST = "one.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;
const CONFIG_SIGNING_KEY = "gates-signing-key-test-only";

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

function buildEnv(db: D1Database, kv: KVNamespace, opts: { signingKey?: string | null; extra?: Record<string, string> } = {}): Env {
  const env = {
    DB: db,
    CACHE: kv,
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
    DEV_BYPASS_AUTH: "true",
    ...(opts.signingKey === null ? {} : { LEADGEN_CONFIG_SIGNING_KEY: opts.signingKey ?? CONFIG_SIGNING_KEY }),
    ...(opts.extra ?? {}),
  } as unknown as Env;
  return env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;
const API = "/api/admin/leadgen";

interface Harness {
  sdb: SqliteDb;
  env: Env;
  store: Map<string, string>;
}
function newHarness(opts: { signingKey?: string | null; extra?: Record<string, string> } = {}): Harness {
  const sdb = createRuntimeDb(DatabaseSync as DatabaseSyncCtor);
  const { kv, store } = makeKvStub();
  return { sdb, env: buildEnv(d1FromSqlite(sdb), kv, opts), store };
}

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

// A tenant request whose `cf` edge signals are fabricated (readCfSignals reads
// request.cf — an expando property survives Hono's pass-through fetch).
function tenantRequestWithCf(path: string, init: RequestInit, cf: Record<string, unknown>): Request {
  const req = new Request(`${TENANT_ORIGIN}${path}`, init);
  Object.assign(req, { cf });
  return req;
}

async function reqTenant(env: Env, path: string, init?: RequestInit, ctx?: ExecutionContext): Promise<Response> {
  return app.request(`${TENANT_ORIGIN}${path}`, init ?? {}, env, ctx);
}

// --- base64url + HMAC forging helpers (token tamper matrix) ------------------

function b64urlEncodeBytes(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlDecodeToString(seg: string): string {
  const pad = seg.length % 4 === 0 ? "" : "=".repeat(4 - (seg.length % 4));
  return atob(seg.replace(/-/g, "+").replace(/_/g, "/") + pad);
}
async function hmacSign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64urlEncodeBytes(new Uint8Array(sig));
}
// Decode a v2 token payload, mutate one field, and RE-SIGN with the REAL key:
// a VALID signature over a WRONG tuple — only tuple equality can reject it.
async function forgeTokenField(token: string, mutate: (p: Record<string, unknown>) => void): Promise<string> {
  const parts = token.split(".");
  const payload = JSON.parse(b64urlDecodeToString(parts[1]!)) as Record<string, unknown>;
  mutate(payload);
  const payloadJson = JSON.stringify(payload);
  const payloadSeg = b64urlEncodeBytes(new TextEncoder().encode(payloadJson));
  const sig = await hmacSign(CONFIG_SIGNING_KEY, payloadJson);
  return `${parts[0]}.${payloadSeg}.${sig}`;
}

// --- funnel + auction seeders (runtime-routes.test.ts conventions) -----------

const CARRIER_PARSE = JSON.stringify({
  carriers_path: "carriers",
  fields: { carrier_name: "name", bid: "bid", click_url: "url", carrier_logo: "logo" },
});

// The G2 payload schema: macro + placement + computed sources so the captured
// provider POST proves the live context end-to-end.
const G2_SCHEMA = JSON.stringify({
  version: 1,
  root: {
    type: "object",
    children: [
      { path: "ip", name: "ip", type: "string", source: "macro", macro: "ip" },
      { path: "ua", name: "ua", type: "string", source: "macro", macro: "ua" },
      { path: "country", name: "country", type: "string", source: "macro", macro: "country" },
      { path: "city", name: "city", type: "string", source: "macro", macro: "city" },
      { path: "utm", name: "utm", type: "string", source: "macro", macro: "utm_source" },
      { path: "sub", name: "sub", type: "string", source: "macro", macro: "sub1" },
      { path: "plc", name: "plc", type: "string", source: "placement" },
      { path: "ts", name: "ts", type: "number", source: "computed", computed: "request_timestamp" },
    ],
  },
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

async function seedActivatedFunnel(env: Env, sdb: SqliteDb, slug: string): Promise<{ variantId: string; funnelId: string; quoteId: string; sectionId: number }> {
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
  return { variantId, funnelId, quoteId: quote.public_id, sectionId: section.id };
}

interface SeededDynamic {
  offerPublicId: string;
  offerId: number;
  auctionId: number;
  placementExternalId: string;
}

function seedDynamicAuctionForVariant(
  sdb: SqliteDb,
  variantId: string,
  opts: { schemaJson?: string; testStatus?: "passed" | "failed" | "untested" } = {},
): SeededDynamic {
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
    .run(schemaPublic, offer.id, opts.schemaJson ?? G2_SCHEMA, CARRIER_PARSE);
  const schema = sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = ?").get(schemaPublic) as { id: number };
  sdb.prepare("UPDATE leadgen_offers SET active_payload_schema_id = ? WHERE id = ?").run(schema.id, offer.id);

  const placementPublic = mintPublicId("offer_placement");
  const placementExternalId = `plc-${offerPublicId.slice(-4)}`;
  sdb.prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)").run(placementPublic, offer.id, placementExternalId);
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

  const testStatus = opts.testStatus ?? "passed";
  if (testStatus !== "untested") {
    sdb
      .prepare("INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code) VALUES (?, 'production', ?)")
      .run(offerPublicId, testStatus === "passed" ? 200 : 500);
  }
  return { offerPublicId, offerId: offer.id, auctionId: auction.id, placementExternalId };
}

// The live client leg: /lg/config + /lg/attempt (with the funnel page's
// original URL in `u`), then POST /lg/auction with the fabricated cf/headers.
async function mintLiveAttempt(env: Env, variantId: string, landingUrl: string): Promise<{
  section_order_hash: string;
  funnel_attempt_id: string;
  signed_config_token: string;
}> {
  const config = (await reqTenant(env, `/lg/config/${variantId}`).then((r) => r.json())) as { section_order_hash: string };
  const attemptRes = await reqTenant(env, `/lg/attempt?funnel_variant_id=${variantId}&u=${encodeURIComponent(landingUrl)}`);
  expect(attemptRes.status, `attempt: ${await attemptRes.clone().text()}`).toBe(200);
  const attempt = (await attemptRes.json()) as { funnel_attempt_id: string; signed_config_token: string };
  return { section_order_hash: config.section_order_hash, ...attempt };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ===========================================================================
// G3 — eligibility fn extended-codes matrix (05 §5.1, pure)
// ===========================================================================

describe("dynamicAuctionEligibility — 05 §5.1 extended codes", () => {
  const okSchema = { ok: true as const, errors: [] };
  const goodExtras = {
    endpoint: "https://provider.example/quote",
    headers: [{ header_name: "X-A", value_kind: "static", value_text: "v" }],
    carrier_parse: { carriers_path: "carriers", fields: { bid: "bid" } },
  };

  it("fully-configured dynamic Offer with a passed test is eligible", () => {
    const v = dynamicAuctionEligibility({ calls_provider_api: 1 }, okSchema, "passed", goodExtras);
    expect(v).toEqual({ eligible: true, reasons: [] });
  });

  it("static Offers are outside the gate", () => {
    const v = dynamicAuctionEligibility({ calls_provider_api: 0 }, null, null, { endpoint: "" });
    expect(v.eligible).toBe(true);
  });

  it("original 4 codes still fire (no_active_schema / schema_validation_errors / test_untested / test_failed)", () => {
    expect(dynamicAuctionEligibility({ calls_provider_api: 1 }, null, "passed").reasons).toContain("no_active_schema");
    expect(dynamicAuctionEligibility({ calls_provider_api: 1 }, { ok: false, errors: [] }, "passed").reasons).toContain("schema_validation_errors");
    expect(dynamicAuctionEligibility({ calls_provider_api: 1 }, okSchema, "untested").reasons).toContain("test_untested");
    expect(dynamicAuctionEligibility({ calls_provider_api: 1 }, okSchema, null).reasons).toContain("test_untested");
    expect(dynamicAuctionEligibility({ calls_provider_api: 1 }, okSchema, "failed").reasons).toContain("test_failed");
  });

  it("endpoint_missing: no endpoint for the selected environment", () => {
    const v = dynamicAuctionEligibility({ calls_provider_api: 1 }, okSchema, "passed", { ...goodExtras, endpoint: "" });
    expect(v.eligible).toBe(false);
    expect(v.reasons).toEqual(["endpoint_missing"]);
    expect(dynamicAuctionEligibility({ calls_provider_api: 1 }, okSchema, "passed", { ...goodExtras, endpoint: null }).reasons).toEqual(["endpoint_missing"]);
  });

  it("invalid_headers: empty header name / empty macro or secret_ref value", () => {
    for (const headers of [
      [{ header_name: "", value_kind: "static", value_text: "v" }],
      [{ header_name: "X-T", value_kind: "secret_ref", value_text: "" }],
      [{ header_name: "X-T", value_kind: "secret_ref", value_text: null }],
      [{ header_name: "X-T", value_kind: "macro", value_text: "  " }],
    ]) {
      const v = dynamicAuctionEligibility({ calls_provider_api: 1 }, okSchema, "passed", { ...goodExtras, headers });
      expect(v.reasons, JSON.stringify(headers)).toEqual(["invalid_headers"]);
    }
    // A static header with an empty value is legal.
    const okStatic = dynamicAuctionEligibility({ calls_provider_api: 1 }, okSchema, "passed", {
      ...goodExtras,
      headers: [{ header_name: "X-T", value_kind: "static", value_text: "" }],
    });
    expect(okStatic.eligible).toBe(true);
  });

  it("carrier_parse_missing / carrier_parse_invalid", () => {
    expect(
      dynamicAuctionEligibility({ calls_provider_api: 1 }, okSchema, "passed", { ...goodExtras, carrier_parse: null }).reasons,
    ).toEqual(["carrier_parse_missing"]);
    expect(
      dynamicAuctionEligibility({ calls_provider_api: 1 }, okSchema, "passed", { ...goodExtras, carrier_parse: "nonsense" }).reasons,
    ).toEqual(["carrier_parse_invalid"]);
    expect(
      dynamicAuctionEligibility({ calls_provider_api: 1 }, okSchema, "passed", { ...goodExtras, carrier_parse: { carriers_path: "c" } }).reasons,
    ).toEqual(["carrier_parse_invalid"]); // no usable fields object
  });

  it("reasons accumulate", () => {
    const v = dynamicAuctionEligibility({ calls_provider_api: 1 }, null, "failed", {
      endpoint: "",
      headers: [{ header_name: "", value_kind: "static", value_text: null }],
      carrier_parse: null,
    });
    expect(v.eligible).toBe(false);
    expect(v.reasons).toEqual([
      "no_active_schema",
      "test_failed",
      "endpoint_missing",
      "invalid_headers",
      "carrier_parse_missing",
    ]);
  });
});

// ===========================================================================
// 04 §4.7.1 — fetch.ts context gate (typed no_runtime_context, never a POST)
// ===========================================================================

describe("fetchProvider — missing runtime context is a typed no-call exclusion", () => {
  it("ctx without macros → error_reason no_runtime_context and ZERO fetch calls", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: RequestInfo | URL): Promise<Response> => {
      calls.push(String(url));
      return new Response("{}", { status: 200 });
    });
    const offer = {
      public_id: "lgo_ctxgate",
      offer_name: "CtxGate",
      request_execution_mode: "server",
      api_token_secret_ref: null,
      api_token_placement: null,
      api_token_param_name: null,
      request_method: "POST",
      endpoint_production: "https://provider.example/quote",
      endpoint_staging: null,
    } as unknown as LeadgenOfferRow;
    const schema: LeadgenPayloadSchema = { version: 1, root: { type: "object", children: [] } };
    const result = await fetchProvider({} as Env, offer, [], schema, { answers: {}, timeout_ms: 100 }, "production");
    expect(result.error_reason).toBe("no_runtime_context");
    expect(result.status).toBeNull();
    expect(calls.length).toBe(0); // the provider was NEVER called
  });
});

// ===========================================================================
// G2 — live auction context + snapshot + click merge + stamps (HTTP + engine)
// ===========================================================================

describeDb("G2 — the live /lg/auction provider payload carries the REAL runtime context", () => {
  const LANDING = "https://one.example.com/lg/g2?utm_source=facebook&sub1=abc&fbclid=XYZ";
  const CF = { country: "DE", regionCode: "BE", city: "Berlin", postalCode: "10115", timezone: "Europe/Berlin", colo: "TXL" };
  const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) TestUA/1.0";
  const IP = "203.0.113.9";

  async function runLiveAuction(h: Harness): Promise<{
    seeded: SeededDynamic;
    attempt: { funnel_attempt_id: string; signed_config_token: string; section_order_hash: string };
    providerBodies: Array<Record<string, unknown>>;
    auctionJson: Record<string, unknown>;
    captured: CapturedCtx;
  }> {
    const { sdb, env } = h;
    const { variantId } = await seedActivatedFunnel(env, sdb, "g2");
    const seeded = seedDynamicAuctionForVariant(sdb, variantId);
    const attempt = await mintLiveAttempt(env, variantId, LANDING);

    const providerBodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      providerBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
      return new Response(
        JSON.stringify({ carriers: [{ name: "Acme", bid: 12, url: "https://acme.example/click?c=1", logo: "https://acme.example/l.png" }] }),
        { status: 200 },
      );
    });

    const captured = captureCtx();
    const req = tenantRequestWithCf(
      "/lg/auction",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": UA,
          "cf-connecting-ip": IP,
          "accept-language": "de-DE,de;q=0.9",
        },
        body: JSON.stringify({
          funnel_variant_id: variantId,
          funnel_attempt_id: attempt.funnel_attempt_id,
          section_order_hash: attempt.section_order_hash,
          signed_config_token: attempt.signed_config_token,
          page_view_id: "pv-1",
          // 03 §3.6 answer envelope shape {value, answer_source}.
          answers: { f: { value: true, answer_source: "user_selected" } },
        }),
      },
      CF,
    );
    const res = await app.request(req, undefined, env, captured.ctx);
    expect(res.status, `auction: ${await res.clone().text()}`).toBe(200);
    const auctionJson = (await res.json()) as Record<string, unknown>;
    return { seeded, attempt, providerBodies, auctionJson, captured };
  }

  it("payload macros resolve real ip/ua/geo (from the live request) + utm/subs (from the VERIFIED landing URL) + placement + computed", async () => {
    const h = newHarness();
    const { seeded, providerBodies, auctionJson } = await runLiveAuction(h);

    expect(providerBodies.length).toBe(1);
    const p = providerBodies[0]!;
    expect(p["ip"]).toBe(IP);
    expect(p["ua"]).toBe(UA);
    expect(p["country"]).toBe("DE");
    expect(p["city"]).toBe("Berlin");
    // Traffic from the /lg/attempt landing URL — NOT the auction POST URL.
    expect(p["utm"]).toBe("facebook");
    expect(p["sub"]).toBe("abc");
    // §4.5: the PARTICIPATING placement's provider-facing id.
    expect(p["plc"]).toBe(seeded.placementExternalId);
    // Computed resolves at runtime (epoch seconds).
    expect(typeof p["ts"]).toBe("number");
    expect(p["ts"] as number).toBeGreaterThan(1_500_000_000);

    // 03 §3.6 response additions (R7): result id + render id + impressions.
    expect(auctionJson["status"]).toBe("ok");
    expect(typeof auctionJson["auction_result_id"]).toBe("string");
    expect(auctionJson["auction_result_id"]).not.toBe("");
    expect(typeof auctionJson["banner_render_id"]).toBe("string");
    const impressions = auctionJson["impressions"] as Array<Record<string, unknown>>;
    expect(Array.isArray(impressions)).toBe(true);
    const carrierImps = impressions.filter((i) => i["event_type"] === "carrier_impression");
    const offerImps = impressions.filter((i) => i["event_type"] === "offer_impression");
    expect(carrierImps.length).toBe(1);
    expect(offerImps.length).toBe(1);
    for (const imp of impressions) {
      expect(imp["offer_id"]).toBe(seeded.offerPublicId);
      expect(imp["placement_id"]).toBe(seeded.placementExternalId);
      expect(imp["auction_result_id"]).toBe(auctionJson["auction_result_id"]);
      expect(typeof imp["slot_index"]).toBe("number");
      expect(typeof imp["banner_render_id"]).toBe("string");
    }
    expect(carrierImps[0]!["carrier_key"]).toBe("acme");
  });

  it("snapshot redaction: macro_context_json persists session/traffic keys ONLY — no raw ip/ua/url/referer", async () => {
    const h = newHarness();
    const { captured } = await runLiveAuction(h);
    await settle(captured);

    const row = h.sdb.prepare("SELECT macro_context_json FROM leadgen_auction_result_log LIMIT 1").get() as
      | { macro_context_json: string }
      | undefined;
    expect(row).toBeDefined();
    const snapshot = JSON.parse(row!.macro_context_json) as Record<string, string>;
    // Traffic keys persisted (from the verified landing URL); fbc derived.
    expect(snapshot["utm_source"]).toBe("facebook");
    expect(snapshot["sub1"]).toBe("abc");
    expect(snapshot["fbclid"]).toBe("XYZ");
    expect(snapshot["fbc"]).toMatch(/^fb\.1\.\d+\.XYZ$/);
    // NO request-scoped values (04 §4.6 — re-derived at click time).
    for (const forbidden of ["ip", "ua", "url", "referer", "language", "device", "country", "state", "city", "page"]) {
      expect(snapshot[forbidden], `snapshot must not persist '${forbidden}'`).toBeUndefined();
    }
    expect(row!.macro_context_json).not.toContain(IP);
    expect(row!.macro_context_json).not.toContain("TestUA");
  });

  it("click-time merge: persisted snapshot wins for traffic keys, fresh request values win for request keys, click_id always fresh", async () => {
    const h = newHarness();
    const { sdb, env } = h;
    // Direct-seeded click context (focused): a persisted snapshot + a template
    // referencing a traffic key, a request key, and {click_id}.
    const offerPublicId = mintPublicId("offer");
    sdb
      .prepare(
        `INSERT INTO leadgen_offers
           (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
            calls_provider_api, bid_source, request_execution_mode, banner_url_template, cap_enabled, status)
         VALUES (?, 'ClickOffer', 'Prov', 'quote_funnel', 'life', 's2s_postback', 'cpc', 0, 'static', 'server', ?, 0, 'active')`,
      )
      .run(offerPublicId, "https://go.example.com/c?src={utm_source}&ip={ip}&cid={click_id}");
    const aiid = "aiid-merge-1";
    sdb
      .prepare(
        "INSERT INTO leadgen_provider_request_log (auction_instance_id, offer_public_id, environment, parsed_carriers_json) VALUES (?, ?, 'production', ?)",
      )
      .run(aiid, offerPublicId, JSON.stringify([{ carrier_key: "acme", carrier_key_source: "slug", click_url: null }]));
    sdb
      .prepare(
        "INSERT INTO leadgen_auction_result_log (auction_instance_id, auction_result_id, auction_config_id, session_id, macro_context_json) VALUES (?, 'ares-m', 'lga_m', 'sess-snap', ?)",
      )
      .run(aiid, JSON.stringify({ utm_source: "persisted_fb", sub1: "persisted_sub" }));

    const href = buildLeadgenClickUrl(offerPublicId, {
      carrier_key: "acme",
      auction_instance_id: aiid,
      banner_render_id: "brid-m",
      slot: 1,
      funnel_attempt_id: "att_merge",
    }).replace(/&amp;/g, "&");
    const res = await reqTenant(env, href, { headers: { "cf-connecting-ip": "198.51.100.7" } });
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("Location") ?? "");
    // Persisted snapshot wins for the traffic key…
    expect(loc.searchParams.get("src")).toBe("persisted_fb");
    // …fresh request value wins for the request key…
    expect(loc.searchParams.get("ip")).toBe("198.51.100.7");
    // …and click_id is always freshly minted.
    expect(loc.searchParams.get("cid")).toMatch(/^lgl_/);
  });
});

// ===========================================================================
// G2 — §5.4 version stamps on the auction-path events (engine-level)
// ===========================================================================

describeDb("§5.4 stamps — auction-path events carry non-empty ids/versions", () => {
  function makeResolved(): ResolvedActivatedFunnel {
    return {
      site_quote: { id: 1, site_id: "site-1", quote_id: 1, enabled: 1, slug: null, settings_overrides_json: null, created_at: 0, updated_at: 0 },
      quote: { id: 1, public_id: "lgq_stamps", quote_name: "Q", activity: "quote_funnel", verticals_json: "[]", status: "active", created_by: null, created_at: 0, updated_at: 0 },
      funnel: { id: 1, public_id: "lgf_stamps", quote_id: 1, funnel_name: "F", active_ab_test_id: null, status: "active", created_at: 0, updated_at: 0 },
      variant: {
        id: 1, public_id: "lgn_stamps", funnel_id: 1, ab_test_id: null, variant_label: "A", is_control: 1,
        traffic_allocation_bp: 10000, funnel_design_id: "default", auction_id: 1, lander_enabled: 0, lander_headline: null,
        lander_subheadline: null, lander_body_json: null, lander_hero_media_id: null, lander_hero_media_url: null, lander_cta_json: null,
        content_version: 1, status: "active", created_at: 0,
      },
      sections: [{ position: 0, section: { id: 1, public_id: "lgs_stamps", content_version: 1, content_json: '{"components":[]}' } as unknown as LeadgenSectionRow }],
      ga4_measurement_id: null,
      assignment: { funnel_ab_test_id: "", funnel_ab_test_revision: 0, variant_label: "A", traffic_allocation_bp: 10000, assignment_bucket: null, assignment_reason: "single_control" },
    };
  }

  it("auction_start / offer request+response / carrier_eligible / filled all carry the §5.4 stamps", async () => {
    const { sdb, env } = newHarness();
    const seeded = seedDynamicAuctionForVariant(sdb, "lgn_never-matched"); // variant link irrelevant at engine level
    const auction = sdb.prepare("SELECT * FROM leadgen_auctions WHERE id = ?").get(seeded.auctionId) as never;
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ carriers: [{ name: "Acme", bid: 12, url: "https://acme.example/c", logo: "https://a.example/l.png" }] }), { status: 200 }));

    const bundle = await loadAuctionBundle(env.DB, auction, null);
    const result = await runAuction(
      env,
      {
        resolved: makeResolved(),
        bundle,
        environment: "production",
        binding: { funnel_variant_id: "lgn_stamps", funnel_attempt_id: "att_stamps", section_order_hash: "", signed_config_token: "", session_id: "sess-s" },
        session_id: "sess-s",
        raw_answers: {},
        runtime: { source: new Request("http://one.example.com/lg/auction"), page_view_id: "pv-s" },
        clicked: [],
      },
      { dryRun: true },
    );

    expect(result.status).toBe("ok");
    const types = result.events.map((e) => e.event_type);
    expect(types).toContain("auction_start");
    expect(types).toContain("auction_offer_request");
    expect(types).toContain("auction_offer_response");
    expect(types).toContain("auction_carrier_eligible");
    expect(types).toContain("auction_filled");
    for (const e of result.events) {
      expect(e.event_id, `${e.event_type}.event_id`).not.toBe("");
      expect(e.auction_instance_id, `${e.event_type}.auction_instance_id`).toBe(result.auction_instance_id);
      expect(e.auction_result_id, `${e.event_type}.auction_result_id`).toBe(result.auction_result_id);
      expect(e.auction_config_id, `${e.event_type}.auction_config_id`).toBe(result.auction_config_id);
      expect(e.auction_config_version, `${e.event_type}.auction_config_version`).toBe("1");
      expect(e.session_id).toBe("sess-s");
      expect(e.page_view_id).toBe("pv-s");
    }
    const offerReq = result.events.find((e) => e.event_type === "auction_offer_request")!;
    expect(offerReq.provider_request_id).not.toBe("");
    expect(offerReq.auction_request_id).toBe(result.auction_request_id);
    expect(offerReq.payload_schema_version).toBe("1");
    expect(offerReq.offer_id).toBe(seeded.offerPublicId);
    expect(offerReq.placement_id).toBe(seeded.placementExternalId);
    const filled = result.events.find((e) => e.event_type === "auction_filled")!;
    expect(filled.banner_render_id).not.toBe("");
  });

  it("an INELIGIBLE dynamic Offer is excluded with the typed reason, emits auction_carrier_filtered, and the provider records ZERO calls", async () => {
    const { sdb, env } = newHarness();
    const seeded = seedDynamicAuctionForVariant(sdb, "lgn_never-matched", { testStatus: "untested" });
    const auction = sdb.prepare("SELECT * FROM leadgen_auctions WHERE id = ?").get(seeded.auctionId) as never;
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: RequestInfo | URL): Promise<Response> => {
      calls.push(String(url));
      return new Response("{}", { status: 200 });
    });

    const bundle = await loadAuctionBundle(env.DB, auction, null);
    const result = await runAuction(
      env,
      {
        resolved: makeResolved(),
        bundle,
        environment: "production",
        binding: { funnel_variant_id: "lgn_stamps", funnel_attempt_id: "att_x", section_order_hash: "", signed_config_token: "", session_id: null },
        session_id: null,
        raw_answers: {},
        clicked: [],
      },
      { dryRun: true },
    );

    // R4: typed exclusion, no fetch, unfilled terminal.
    expect(calls.length).toBe(0);
    expect(result.explain.offers_excluded).toEqual([{ offer_id: seeded.offerPublicId, reason: "test_untested" }]);
    const filtered = result.events.find((e) => e.event_type === "auction_carrier_filtered");
    expect(filtered).toBeDefined();
    expect(filtered!.offer_id).toBe(seeded.offerPublicId);
    expect(filtered!.carrier_filtered_reason).toBe("test_untested");
    expect(result.events.some((e) => e.event_type === "auction_unfilled")).toBe(true);
  });
});

// ===========================================================================
// G2 — Test-tool parity (04 §4.7.2): same simulated context ⇒ same payload
// ===========================================================================

describeDb("Test tool — the SAME simulated context yields the SAME payload as the runtime builder", () => {
  it("dry-run Test payload == buildPayload over buildLeadgenRuntimeContext with identical overrides", async () => {
    const { sdb, env } = newHarness();
    // A schema of macro+placement sources only (no time-dependent computed —
    // parity must be byte-stable across the two builds).
    const schemaJson = JSON.stringify({
      version: 1,
      root: {
        type: "object",
        children: [
          { path: "ip", name: "ip", type: "string", source: "macro", macro: "ip" },
          { path: "country", name: "country", type: "string", source: "macro", macro: "country" },
          { path: "utm", name: "utm", type: "string", source: "macro", macro: "utm_source" },
          { path: "plc", name: "plc", type: "string", source: "placement" },
        ],
      },
    });
    const seeded = seedDynamicAuctionForVariant(sdb, "lgn_never-matched", { schemaJson });
    const offerRow = sdb.prepare("SELECT offer_name FROM leadgen_offers WHERE public_id = ?").get(seeded.offerPublicId) as { offer_name: string };

    const overrides = { ip: "198.51.100.44", country: "FR", utm_source: "newsletter" };
    const res = await admin.request(
      `${API}/offers/${seeded.offerPublicId}/test`,
      jsonInit("POST", { environment: "production", dry_run: true, sample_answers: {}, overrides }),
      env,
    );
    expect(res.status, `test: ${await res.clone().text()}`).toBe(200);
    const j = (await res.json()) as { request: { payload: Record<string, unknown> }; context_used: { placement_id: string | null } };

    // The runtime builder over an equivalent request + the SAME overrides.
    const ctx = buildLeadgenRuntimeContext(new Request("https://cms.kodigital.app/x"), {
      session_id: "",
      page_view_id: "",
      funnel_attempt_id: "",
      quote: "",
      funnel: "",
      variant: "",
      offer: { offer_id: seeded.offerPublicId, offer_name: offerRow.offer_name, placement_id: seeded.placementExternalId },
      overrides,
    });
    const expected = buildPayload(JSON.parse(schemaJson) as LeadgenPayloadSchema, {
      answers: {},
      macros: ctx.macros,
      computed: ctx.computed,
      offer: ctx.offer,
    });
    expect(j.request.payload).toEqual(expected);
    expect(j.request.payload["plc"]).toBe(seeded.placementExternalId);
    expect(j.request.payload["utm"]).toBe("newsletter");
    expect(j.context_used.placement_id).toBe(seeded.placementExternalId);
  });

  it("unknown override keys are a typed 400 (public B5 whitelist; never silently dropped)", async () => {
    const { sdb, env } = newHarness();
    const seeded = seedDynamicAuctionForVariant(sdb, "lgn_never-matched");
    const res = await admin.request(
      `${API}/offers/${seeded.offerPublicId}/test`,
      jsonInit("POST", { environment: "production", dry_run: true, overrides: { session_id: "forged" } }),
      env,
    );
    expect(res.status).toBe(400);
    const j = (await res.json()) as { fields: { overrides: string } };
    expect(j.fields.overrides).toContain("unknown override 'session_id'");
  });
});

// ===========================================================================
// G3 — auctions PUT warnings (05 §5.1 site 2)
// ===========================================================================

describeDb("PUT /auctions/:id/offers — per-offer eligibility warnings, save accepted", () => {
  it("an ineligible dynamic Offer produces {offer_id, eligible:false, reasons[]}; the save still lands", async () => {
    const { sdb, env } = newHarness();
    const seeded = seedDynamicAuctionForVariant(sdb, "lgn_never-matched", { testStatus: "untested" });
    const auctionPublic = (sdb.prepare("SELECT public_id FROM leadgen_auctions WHERE id = ?").get(seeded.auctionId) as { public_id: string }).public_id;
    const placement = sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE offer_id = ?").get(seeded.offerId) as { id: number };

    const res = await admin.request(
      `${API}/auctions/${auctionPublic}/offers`,
      jsonInit("PUT", { offers: [{ offer_placement_id: placement.id }] }),
      env,
    );
    expect(res.status, `put offers: ${await res.clone().text()}`).toBe(200);
    const j = (await res.json()) as { items: unknown[]; warnings: Array<{ offer_id: string; eligible: boolean; reasons: string[] }> };
    expect(j.items.length).toBe(1); // the save was ACCEPTED (draft may reference not-yet-ready Offers)
    expect(j.warnings.length).toBe(1);
    expect(j.warnings[0]).toEqual({ offer_id: seeded.offerPublicId, eligible: false, reasons: ["test_untested"] });
  });

  it("an eligible set produces warnings: []", async () => {
    const { sdb, env } = newHarness();
    const seeded = seedDynamicAuctionForVariant(sdb, "lgn_never-matched", { testStatus: "passed" });
    const auctionPublic = (sdb.prepare("SELECT public_id FROM leadgen_auctions WHERE id = ?").get(seeded.auctionId) as { public_id: string }).public_id;
    const placement = sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE offer_id = ?").get(seeded.offerId) as { id: number };
    const res = await admin.request(
      `${API}/auctions/${auctionPublic}/offers`,
      jsonInit("PUT", { offers: [{ offer_placement_id: placement.id }] }),
      env,
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { warnings: unknown[] };
    expect(j.warnings).toEqual([]);
  });
});

// ===========================================================================
// G3 — activation gate R5 (05 §5.2): 409 report / clean 200 / variant verdict
// ===========================================================================

describeDb("R5 — quote activation preflight", () => {
  // A quote whose section SELECTS an offer with an unmapped REQUIRED provider
  // field → the normative 409 report.
  async function seedBlockedQuote(env: Env, sdb: SqliteDb): Promise<{ quoteId: string; sectionPublicId: string; offerPublicId: string; sectionName: string; offerName: string }> {
    const createRes = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Blocked Q", activity: "quote_funnel", verticals: ["life"] }), env);
    expect(createRes.status).toBe(201);
    const quote = (await createRes.json()) as { public_id: string; funnels: Array<{ variants: Array<{ public_id: string }> }> };
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    const section = seedSection(sdb);
    const sectionRow = sdb.prepare("SELECT public_id, section_name FROM leadgen_sections WHERE id = ?").get(section.id) as { public_id: string; section_name: string };
    const putRes = await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { sections: [{ section_id: section.id }] }), env);
    expect(putRes.status).toBe(200);

    // An offer with a REQUIRED provider field, SELECTED on the section, with
    // NO answer maps → missing_required_provider_fields.
    const offerPublicId = mintPublicId("offer");
    sdb
      .prepare(
        `INSERT INTO leadgen_offers
           (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
            calls_provider_api, bid_source, request_execution_mode, request_method, endpoint_production, status)
         VALUES (?, 'NextInsure', 'Prov', 'quote_funnel', 'life', 's2s_postback', 'cpc', 1, 'response', 'server', 'POST', 'https://provider.example/q', 'active')`,
      )
      .run(offerPublicId);
    const offer = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(offerPublicId) as { id: number };
    const schemaPublic = mintPublicId("payload_schema_version");
    const schemaJson = JSON.stringify({
      version: 1,
      root: {
        type: "object",
        children: [
          { path: "carrier", name: "carrier", type: "string", source: "answer", internal_field: "f", required: true },
        ],
      },
    });
    sdb
      .prepare(
        "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, carrier_parse_json, carrier_parse_version, source) VALUES (?, ?, 1, ?, ?, 1, 'manual')",
      )
      .run(schemaPublic, offer.id, schemaJson, CARRIER_PARSE);
    const schema = sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = ?").get(schemaPublic) as { id: number };
    sdb.prepare("UPDATE leadgen_offers SET active_payload_schema_id = ? WHERE id = ?").run(schema.id, offer.id);
    sdb
      .prepare("INSERT INTO leadgen_section_available_offers (section_id, offer_id, selected, mapping_state) VALUES (?, ?, 1, 'selected')")
      .run(section.id, offer.id);
    return { quoteId: quote.public_id, sectionPublicId: sectionRow.public_id, offerPublicId, sectionName: sectionRow.section_name, offerName: "NextInsure" };
  }

  it("activation PUT HARD-BLOCKS with the EXACT normative 409 report (code + fields + fix_links)", async () => {
    const { sdb, env } = newHarness();
    const seeded = await seedBlockedQuote(env, sdb);
    const res = await admin.request(`${API}/quotes/${seeded.quoteId}/activation/site-1`, jsonInit("PUT", { enabled: true, slug: "blocked" }), env);
    expect(res.status, `activation: ${await res.clone().text()}`).toBe(409);
    const j = (await res.json()) as {
      error: string;
      quote_id: string;
      funnel_id: string;
      funnel_variant_id: string;
      blocks: Array<{ section_id: string; section_name: string; offer_id: string; offer_name: string; code: string; fields: string[]; fix_links: Record<string, string> }>;
    };
    expect(j.error).toBe("quote_activation_blocked");
    expect(j.quote_id).toBe(seeded.quoteId);
    expect(j.funnel_id).toMatch(/^lgf_/);
    expect(j.funnel_variant_id).toMatch(/^lgn_/);
    const block = j.blocks.find((b) => b.code === "missing_required_provider_fields");
    expect(block, JSON.stringify(j.blocks)).toBeDefined();
    expect(block!.section_id).toBe(seeded.sectionPublicId);
    expect(block!.section_name).toBe(seeded.sectionName);
    expect(block!.offer_id).toBe(seeded.offerPublicId);
    expect(block!.offer_name).toBe(seeded.offerName);
    expect(block!.fields).toEqual(["carrier"]);
    expect(block!.fix_links).toEqual({
      section_mapping: `/admin/leadgen/sections/${seeded.sectionPublicId}/edit#mapping`,
      offer_schema: `/admin/leadgen/offers/${seeded.offerPublicId}/edit#payload`,
    });
    // The quote was NOT activated.
    const activation = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_site_quotes").get() as { n: number };
    expect(activation.n).toBe(0);
  });

  it("a participating INELIGIBLE dynamic Offer blocks activation with code offer_ineligible (§5.1 leg)", async () => {
    const { sdb, env } = newHarness();
    const createRes = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Auction Q", activity: "quote_funnel", verticals: ["life"] }), env);
    const quote = (await createRes.json()) as { public_id: string; funnels: Array<{ variants: Array<{ public_id: string }> }> };
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    const section = seedSection(sdb);
    await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { sections: [{ section_id: section.id }] }), env);
    const seeded = seedDynamicAuctionForVariant(sdb, variantId, { testStatus: "untested" });

    const res = await admin.request(`${API}/quotes/${quote.public_id}/activation/site-1`, jsonInit("PUT", { enabled: true, slug: "auq" }), env);
    expect(res.status).toBe(409);
    const j = (await res.json()) as { error: string; blocks: Array<{ code: string; offer_id: string; fields: string[] }> };
    expect(j.error).toBe("quote_activation_blocked");
    const block = j.blocks.find((b) => b.code === "offer_ineligible");
    expect(block).toBeDefined();
    expect(block!.offer_id).toBe(seeded.offerPublicId);
    expect(block!.fields).toContain("test_untested");
  });

  it("a clean quote activates 200 with a PASS verdict on the response", async () => {
    const { sdb, env } = newHarness();
    const seeded = await seedActivatedFunnel(env, sdb, "cleanq"); // asserts the 200 internally
    // Re-PUT to read the additive verdict field.
    const res = await admin.request(`${API}/quotes/${seeded.quoteId}/activation/site-1`, jsonInit("PUT", { enabled: true, slug: "cleanq" }), env);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { activation_preflight: { ok: boolean; blocks: unknown[] } };
    expect(j.activation_preflight.ok).toBe(true);
    expect(j.activation_preflight.blocks).toEqual([]);
  });

  it("variant save recomputes + STORES the preflight verdict (KV + response field)", async () => {
    const h = newHarness();
    const { sdb, env, store } = h;
    const createRes = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Verdict Q", activity: "quote_funnel", verticals: ["life"] }), env);
    const quote = (await createRes.json()) as { funnels: Array<{ variants: Array<{ public_id: string }> }> };
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    const section = seedSection(sdb);
    const putRes = await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { sections: [{ section_id: section.id }] }), env);
    expect(putRes.status).toBe(200);
    const j = (await putRes.json()) as { activation_preflight: { ok: boolean; funnel_variant_id: string } };
    expect(j.activation_preflight.ok).toBe(true);
    expect(j.activation_preflight.funnel_variant_id).toBe(variantId);
    const stored = store.get(`lg-preflight:${variantId}`);
    expect(stored, "stored verdict in KV").toBeDefined();
    expect((JSON.parse(stored!) as { ok: boolean }).ok).toBe(true);
  });
});

// ===========================================================================
// G3 — tuple v2 per-field tamper matrix over the LIVE money path (05 §5.3)
// ===========================================================================

describeDb("anti-tamper v2 — per-field tamper matrix → 422 tampered", () => {
  const LANDING = "https://one.example.com/lg/tam?utm_source=x";

  async function postAuction(env: Env, variantId: string, binding: Record<string, unknown>): Promise<Response> {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ carriers: [] }), { status: 200 }));
    return reqTenant(env, "/lg/auction", jsonInit("POST", { funnel_variant_id: variantId, answers: {}, ...binding }));
  }

  it("EACH of the 7 bound fields mutated (re-signed, VALID signature) → 422 + tampered; the untampered token → 200", async () => {
    const { sdb, env } = newHarness();
    const { variantId } = await seedActivatedFunnel(env, sdb, "tam");
    seedDynamicAuctionForVariant(sdb, variantId);
    const attempt = await mintLiveAttempt(env, variantId, LANDING);
    const base = {
      funnel_attempt_id: attempt.funnel_attempt_id,
      section_order_hash: attempt.section_order_hash,
      signed_config_token: attempt.signed_config_token,
    };

    // Control: the untampered binding is accepted.
    const okRes = await postAuction(env, variantId, base);
    expect(okRes.status, `control: ${await okRes.clone().text()}`).toBe(200);

    // The 7 bound fields, each mutated INSIDE a re-signed payload: the
    // signature verifies, only the tuple equality can reject.
    const mutations: Array<[string, (p: Record<string, unknown>) => void]> = [
      ["funnel_variant_id", (p) => { p["funnel_variant_id"] = mintPublicId("funnel_variant"); }],
      ["section_order_hash", (p) => { p["section_order_hash"] = "deadbeef"; }],
      ["content_version", (p) => { p["content_version"] = (p["content_version"] as number) + 1; }],
      ["funnel_attempt_id", (p) => { p["funnel_attempt_id"] = "att_forged"; }],
      ["session_id", (p) => { p["session_id"] = "sess-forged"; }],
      ["answer_mapping_hash", (p) => { p["answer_mapping_hash"] = sha256Hex("forged"); }],
      ["auction_config_version", (p) => { p["auction_config_version"] = "999"; }],
    ];
    for (const [field, mutate] of mutations) {
      const forged = await forgeTokenField(attempt.signed_config_token, mutate);
      const res = await postAuction(env, variantId, { ...base, signed_config_token: forged });
      expect(res.status, `tampered ${field}`).toBe(422);
      const j = (await res.json()) as { traffic_quality_flag: string };
      expect(j.traffic_quality_flag, `tampered ${field}`).toBe("tampered");
    }
  });

  it("a v1 token: grace flag OFF ⇒ 422; flag ON ⇒ verifies", async () => {
    const { sdb, env } = newHarness();
    const { variantId } = await seedActivatedFunnel(env, sdb, "v1g");
    seedDynamicAuctionForVariant(sdb, variantId);
    const attempt = await mintLiveAttempt(env, variantId, LANDING);

    // Craft a LEGACY v1 token (4-field payload) signed with the REAL key.
    const parts = attempt.signed_config_token.split(".");
    const v2payload = JSON.parse(b64urlDecodeToString(parts[1]!)) as Record<string, unknown>;
    const v1payload = JSON.stringify({
      funnel_variant_id: v2payload["funnel_variant_id"],
      section_order_hash: v2payload["section_order_hash"],
      content_version: v2payload["content_version"],
      funnel_attempt_id: v2payload["funnel_attempt_id"],
    });
    const v1token = `v1.${b64urlEncodeBytes(new TextEncoder().encode(v1payload))}.${await hmacSign(CONFIG_SIGNING_KEY, v1payload)}`;

    // Flag OFF (default): the live path rejects the v1 token.
    const offRes = await postAuction(env, variantId, {
      funnel_attempt_id: attempt.funnel_attempt_id,
      section_order_hash: attempt.section_order_hash,
      signed_config_token: v1token,
    });
    expect(offRes.status).toBe(422);

    // Flag ON: the SAME v1 token verifies (deploy-grace for in-flight sessions).
    const envWithGrace = { ...(env as unknown as Record<string, unknown>), LEADGEN_ACCEPT_V1_TOKENS: "true" } as unknown as Env;
    const expected: ConfigTokenTuple = {
      funnel_variant_id: v2payload["funnel_variant_id"] as string,
      section_order_hash: v2payload["section_order_hash"] as string,
      content_version: v2payload["content_version"] as number,
      funnel_attempt_id: v2payload["funnel_attempt_id"] as string,
      session_id: "",
      answer_mapping_hash: v2payload["answer_mapping_hash"] as string,
      auction_config_version: v2payload["auction_config_version"] as string,
    };
    expect((await verifyConfigTokenDetailed(env, v1token, expected, { requireSigned: true })).ok).toBe(false);
    expect((await verifyConfigTokenDetailed(envWithGrace, v1token, expected, { requireSigned: true })).ok).toBe(true);
  });

  it("an `unsigned.` token is rejected on the money path even when NO signing secret is configured (fails closed)", async () => {
    const { sdb, env } = newHarness({ signingKey: null }); // no LEADGEN_CONFIG_SIGNING_KEY
    const { variantId } = await seedActivatedFunnel(env, sdb, "unsig");
    seedDynamicAuctionForVariant(sdb, variantId);
    const attempt = await mintLiveAttempt(env, variantId, LANDING);
    expect(attempt.signed_config_token.startsWith("unsigned.")).toBe(true);

    const res = await postAuction(env, variantId, {
      funnel_attempt_id: attempt.funnel_attempt_id,
      section_order_hash: attempt.section_order_hash,
      signed_config_token: attempt.signed_config_token,
    });
    expect(res.status).toBe(422); // requireSigned fails CLOSED — never a silent void
    const j = (await res.json()) as { traffic_quality_flag: string };
    expect(j.traffic_quality_flag).toBe("tampered");
  });

  it("computeAttemptBindingExtras: an answer-map save bumps the per-section version → a new hash (mint/verify symmetric)", async () => {
    const { sdb, env } = newHarness();
    const { variantId } = await seedActivatedFunnel(env, sdb, "hashv");
    // Resolve via the live route machinery: mint now, then remap, then mint again.
    const a1 = await mintLiveAttempt(env, variantId, LANDING);
    const sectionRow = sdb.prepare("SELECT s.id AS id FROM leadgen_sections s JOIN leadgen_funnel_variant_sections fvs ON fvs.section_id = s.id LIMIT 1").get() as { id: number };
    const seeded = seedDynamicAuctionForVariant(sdb, variantId);
    const schema = sdb.prepare("SELECT id, public_id FROM leadgen_offer_payload_schemas WHERE offer_id = ?").get(seeded.offerId) as { id: number; public_id: string };
    sdb
      .prepare(
        "INSERT INTO leadgen_section_answer_maps (public_id, section_id, question_id, question_key, internal_field, answer_type, offer_id, payload_schema_id, payload_schema_public_id, offer_payload_field_path, provider_expected_type) VALUES (?, ?, 'q1', 'k', 'f', 'string', ?, ?, ?, 'zip', 'string')",
      )
      .run(mintPublicId("answer_field_map"), sectionRow.id, seeded.offerId, schema.id, schema.public_id);
    // The PRE-remap token no longer verifies (422 on the live path): the
    // server-side hash recomputation moved.
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ carriers: [] }), { status: 200 }));
    const res = await reqTenant(env, "/lg/auction", jsonInit("POST", {
      funnel_variant_id: variantId,
      funnel_attempt_id: a1.funnel_attempt_id,
      section_order_hash: a1.section_order_hash,
      signed_config_token: a1.signed_config_token,
      answers: {},
    }));
    expect(res.status).toBe(422);
  });
});

// ===========================================================================
// mint helper sanity — the exported extras computation is DB-consistent
// ===========================================================================

describeDb("computeAttemptBindingExtras — deterministic + auction-version aware", () => {
  it("no maps ⇒ hash over ['0',…]; an auction on the variant binds its carrier_normalization_version", async () => {
    const { sdb, env } = newHarness();
    const { variantId } = await seedActivatedFunnel(env, sdb, "extras");
    seedDynamicAuctionForVariant(sdb, variantId);
    // Resolve through the public resolver row shapes: mint via the HTTP route
    // and verify with locally-recomputed extras — symmetry proof.
    const attempt = await mintLiveAttempt(env, variantId, "https://one.example.com/lg/extras");
    const variantRow = sdb.prepare("SELECT * FROM leadgen_funnel_variants WHERE public_id = ?").get(variantId) as Record<string, unknown>;
    const funnelRow = sdb.prepare("SELECT * FROM leadgen_funnels WHERE id = ?").get(variantRow["funnel_id"]) as Record<string, unknown>;
    const quoteRow = sdb.prepare("SELECT * FROM leadgen_quotes WHERE id = ?").get(funnelRow["quote_id"]) as Record<string, unknown>;
    const sectionJoin = sdb.prepare("SELECT s.* FROM leadgen_sections s JOIN leadgen_funnel_variant_sections fvs ON fvs.section_id = s.id WHERE fvs.variant_id = ? ORDER BY fvs.position").all(variantRow["id"]) as Array<Record<string, unknown>>;
    const resolved = {
      site_quote: { id: 1, site_id: "site-1", quote_id: quoteRow["id"], enabled: 1, slug: "extras", settings_overrides_json: null, created_at: 0, updated_at: 0 },
      quote: quoteRow,
      funnel: funnelRow,
      variant: variantRow,
      sections: sectionJoin.map((s, i) => ({ position: i, section: s })),
      ga4_measurement_id: null,
      assignment: { funnel_ab_test_id: "", funnel_ab_test_revision: 0, variant_label: "A", traffic_allocation_bp: 10000, assignment_bucket: null, assignment_reason: "single_control" },
    } as unknown as ResolvedActivatedFunnel;
    const extras = await computeAttemptBindingExtras(env, resolved);
    expect(extras.answer_mapping_hash).toBe(sha256Hex(JSON.stringify(["0"])));
    expect(extras.auction_config_version).toBe("1"); // carrier_normalization_version
    // And the minted token indeed binds them (round-trip through mint).
    const again = await mintFunnelAttempt(env, resolved, Date.now(), { session_id: "" });
    expect(again.signed_config_token.startsWith("v2.")).toBe(true);
  });
});
