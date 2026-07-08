// LeadGen §19.2 admin dry-run — POST /api/admin/leadgen/auctions/:id/simulate.
// Drives the REAL admin router (admin.request) against a real node:sqlite D1 +
// the real migrations, with MOCKED providers. Proves the §19.2 explainability
// trace is complete AND the dry-run WRITES NOTHING (OQ-10): no result log, no
// provider log — the two auction-write tables stay empty after a simulate.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
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
  } as unknown as D1Database;
  return db;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const LEADGEN_MIGRATIONS = ["0036_leadgen_core.sql", "0037_leadgen_analytics_mirror.sql", "0038_leadgen_revenue_infra.sql", "0039_leadgen_conversion_dedupe.sql", "0040_leadgen_runtime_context.sql"] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
  );
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
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
}

interface CapturedFetch {
  url: string;
}
function stubFetch(handler: (url: string) => Promise<Response> | Response): CapturedFetch[] {
  const calls: CapturedFetch[] = [];
  vi.stubGlobal("fetch", async (url: RequestInfo | URL): Promise<Response> => {
    calls.push({ url: String(url) });
    return handler(String(url));
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const CARRIER_PARSE = JSON.stringify({ carriers_path: "carriers", fields: { carrier_name: "name", bid: "bid", click_url: "url", carrier_logo: "logo" } });

function seedDynamicOffer(sdb: SqliteDb): { offer_id: number; offer_public_id: string; placement_id: number } {
  const offerPublic = mintPublicId("offer");
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, request_method, endpoint_production, endpoint_staging, status)
       VALUES (?, ?, 'Prov', 'quote_funnel', 'life', 's2s_postback', 'cpc', 1, 'response', 'server', 'POST',
               'https://provider.example/quote', 'https://staging.provider.example/quote', 'active')`,
    )
    .run(offerPublic, `Offer ${offerPublic.slice(-4)}`);
  const offer = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(offerPublic) as { id: number };
  const schemaPublic = mintPublicId("payload_schema_version");
  sdb
    .prepare(
      "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, carrier_parse_json, carrier_parse_version, source) VALUES (?, ?, 1, ?, ?, 1, 'manual')",
    )
    .run(schemaPublic, offer.id, JSON.stringify({ version: 1, root: { type: "object", children: [] } }), CARRIER_PARSE);
  const schema = sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = ?").get(schemaPublic) as { id: number };
  sdb.prepare("UPDATE leadgen_offers SET active_payload_schema_id = ? WHERE id = ?").run(schema.id, offer.id);
  const placementPublic = mintPublicId("offer_placement");
  sdb.prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)").run(placementPublic, offer.id, `plc-${offerPublic.slice(-4)}`);
  const placement = sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(placementPublic) as { id: number };
  // R4 (fix-contract v2.4 05 §5.1): a dynamic Offer participates only with a
  // PASSED Test verdict — one TEST-TOOL provider_request_log row
  // (auction_instance_id NULL) marks it tested.
  sdb
    .prepare("INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code) VALUES (?, 'production', 200)")
    .run(offerPublic);
  return { offer_id: offer.id, offer_public_id: offerPublic, placement_id: placement.id };
}

function seedAuction(sdb: SqliteDb): { id: number; public_id: string } {
  const publicId = mintPublicId("auction");
  sdb
    .prepare(
      `INSERT INTO leadgen_auctions
         (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
          surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
          backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
       VALUES (?, 'Sim', 'dynamic', 'highest_bid', 'percentage_of_max', 10, 'enabled', 1, 5, 3, 10, 'disabled', 'on_slot_exhaustion', 0, 'offer', 2500, 1, 'active')`,
    )
    .run(publicId);
  const row = sdb.prepare("SELECT id FROM leadgen_auctions WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

function carrierBody(name: string, bid: number): string {
  return JSON.stringify({ carriers: [{ name, bid, url: "https://acme.example/click", logo: "https://acme.example/l.png" }] });
}

const API = "/api/admin/leadgen";
function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

describeDb("leadgen /auctions/:id/simulate — §19.2 dry-run trace + no writes", () => {
  function harness(): { sdb: SqliteDb; env: Env } {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
  }

  it("returns the full §19.2 trace (offers/providers/carriers/winner/banners) and writes NOTHING", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const o1 = seedDynamicOffer(sdb);
    sdb.prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, enabled) VALUES (?, ?, ?, 0, 1)").run(auction.id, o1.placement_id, o1.offer_id);
    const calls = stubFetch(() => new Response(carrierBody("Acme", 12), { status: 200 }));

    const res = await admin.request(`${API}/auctions/${auction.public_id}/simulate`, jsonInit("POST", { sample_answers: { homeowner: true } }), env);
    expect(res.status, `simulate: ${await res.clone().text()}`).toBe(200);
    const j = (await res.json()) as {
      dry_run: boolean;
      status: string;
      offers_considered: Array<{ offer_id: string }>;
      providers_requested: unknown[];
      providers_responded: unknown[];
      carriers_shown: Array<{ carrier_key: string }>;
      winner: { offer_id: string } | null;
      banner_render_ids: string[];
      banners: unknown[];
    };

    // Trace completeness (§19.2).
    expect(j.dry_run).toBe(true);
    expect(j.offers_considered.some((o) => o.offer_id === o1.offer_public_id)).toBe(true);
    expect(j.providers_requested.length).toBe(1);
    expect(j.providers_responded.length).toBe(1);
    expect(j.carriers_shown.some((c) => c.carrier_key === "acme")).toBe(true);
    expect(j.winner).not.toBeNull();
    expect(j.banner_render_ids.length).toBeGreaterThan(0);
    expect(j.banners.length).toBeGreaterThan(0);
    expect(calls.length).toBe(1); // provider fetched (staging)
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");

    // OQ-10: a dry-run WRITES NOTHING — both auction-write tables stay free of
    // RUNTIME rows (the seeded §5.1 Test-tool verdict row has a NULL
    // auction_instance_id and predates the simulate).
    const logCount = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_auction_result_log").get() as { n: number };
    const provCount = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_provider_request_log WHERE auction_instance_id IS NOT NULL").get() as { n: number };
    expect(logCount.n).toBe(0);
    expect(provCount.n).toBe(0);
  });

  it("S1 (07 §7.6): offers_payload_explain carries the REDACTED payload preview + parser id/version + expected fields per considered offer", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const o1 = seedDynamicOffer(sdb);
    sdb.prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, enabled) VALUES (?, ?, ?, 0, 1)").run(auction.id, o1.placement_id, o1.offer_id);
    stubFetch(() => new Response(carrierBody("Acme", 12), { status: 200 }));

    const res = await admin.request(
      `${API}/auctions/${auction.public_id}/simulate`,
      jsonInit("POST", { sample_answers: { homeowner: true } }),
      env,
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      offers_payload_explain: Array<{
        offer_id: string;
        parser_id: string | null;
        carrier_parse_version: number | null;
        expected_response_fields: string[];
        payload_preview: unknown;
        excluded_reason: string | null;
      }>;
    };
    // the seeded dynamic offer appears with its S1 explainability (NOT on
    // offers_considered — this is the additive §7.6 array the UI reads).
    const entry = j.offers_payload_explain.find((e) => e.offer_id === o1.offer_public_id);
    expect(entry, "considered offer has a payload-explain entry").toBeDefined();
    expect(entry!.parser_id, "parser id surfaced").not.toBeNull();
    expect(entry!.payload_preview, "a payload preview is built").not.toBeNull();
    // the preview is an object (the generated provider payload), redacted — a
    // PII-shaped key would be masked. buildPayload output is a plain object.
    expect(typeof entry!.payload_preview).toBe("object");
    expect(Array.isArray(entry!.expected_response_fields)).toBe(true);
  });

  it("S1 MAJOR fix: the preview is the EXACT payload — request macro, OFFER-scoped macros, placement + masked token all resolve (not answers-only)", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    // an offer whose ACTIVE schema pulls EVERY non-answer source class: a
    // request-scoped macro (utm_source), the three OFFER-scoped macros
    // (offer_id / offer_name / placement — derived from ctx.offer, the residual
    // MAJOR), a source=placement node, and a source=token node — proving the
    // preview threads the FULL runtime context, not just answers.
    const offerPublic = mintPublicId("offer");
    sdb.prepare(
      `INSERT INTO leadgen_offers (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type, calls_provider_api, bid_source, request_execution_mode, request_method, api_token_placement, endpoint_production, endpoint_staging, status)
       VALUES (?, 'MacroOffer', 'P', 'quote_funnel', 'life', 's2s_postback', 'cpc', 1, 'response', 'server', 'POST', 'payload', 'https://p.example/q', 'https://s.example/q', 'active')`,
    ).run(offerPublic);
    const offerId = (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(offerPublic) as { id: number }).id;
    const schemaJson = JSON.stringify({
      version: 1,
      root: { type: "object", children: [
        { path: "src", name: "src", type: "string", source: "macro", macro: "utm_source" },
        { path: "oid", name: "oid", type: "string", source: "macro", macro: "offer_id" },
        { path: "onm", name: "onm", type: "string", source: "macro", macro: "offer_name" },
        { path: "plcm", name: "plcm", type: "string", source: "macro", macro: "placement" },
        { path: "plc", name: "plc", type: "string", source: "placement" },
        { path: "tok", name: "tok", type: "string", source: "token" },
      ] },
    });
    const schemaPublic = mintPublicId("payload_schema_version");
    sdb.prepare(
      "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, carrier_parse_json, carrier_parse_version, source) VALUES (?, ?, 1, ?, ?, 1, 'manual')",
    ).run(schemaPublic, offerId, schemaJson, CARRIER_PARSE);
    const schemaId = (sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = ?").get(schemaPublic) as { id: number }).id;
    sdb.prepare("UPDATE leadgen_offers SET active_payload_schema_id = ? WHERE id = ?").run(schemaId, offerId);
    const plPublic = mintPublicId("offer_placement");
    sdb.prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, 'plc-macro-1', 1)").run(plPublic, offerId);
    const placementRowId = (sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(plPublic) as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code) VALUES (?, 'production', 200)").run(offerPublic); // PASSED test → R4-eligible
    sdb.prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, enabled) VALUES (?, ?, ?, 0, 1)").run(auction.id, placementRowId, offerId);
    stubFetch(() => new Response(carrierBody("Acme", 12), { status: 200 }));

    const res = await admin.request(
      `${API}/auctions/${auction.public_id}/simulate`,
      jsonInit("POST", { sample_answers: {}, context: { utm_source: "fbk-sim" } }),
      env,
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { offers_payload_explain: Array<{ offer_id: string; payload_preview: Record<string, unknown> | null }> };
    const entry = j.offers_payload_explain.find((e) => e.offer_id === offerPublic);
    expect(entry?.payload_preview, "preview built").toBeTruthy();
    const pv = entry!.payload_preview as Record<string, unknown>;
    // request-scoped macro resolves from the simulated context…
    expect(pv["src"]).toBe("fbk-sim");
    // …the three OFFER-scoped macros resolve from ctx.offer (were empty before the fix)…
    expect(pv["oid"]).toBe(offerPublic);
    expect(pv["onm"]).toBe("MacroOffer");
    expect(pv["plcm"]).toBe("plc-macro-1"); // macro:"placement" == the offer's external id, NOT traffic
    // …source=placement resolves to the provider-facing external id…
    expect(pv["plc"]).toBe("plc-macro-1");
    // …and the source=token node renders PRESENT-but-MASKED ([REDACTED]); the
    // real secret is NEVER resolved in an admin dry-run (§7.6 "masked").
    expect(pv["tok"]).toBe("[REDACTED]");
  });

  it("an offer-level exclude rule surfaces in offers_excluded with a typed reason", async () => {
    const { sdb, env } = harness();
    const auction = seedAuction(sdb);
    const o1 = seedDynamicOffer(sdb);
    sdb.prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, enabled) VALUES (?, ?, ?, 0, 1)").run(auction.id, o1.placement_id, o1.offer_id);
    // Exclude Offer o1 when homeowner=false.
    const ruleConditions = JSON.stringify({ groups: [{ field: "homeowner", op: "eq", value: false }] });
    sdb
      .prepare(
        "INSERT INTO leadgen_auction_rules (public_id, auction_id, rule_level, target_offer_id, action, conditions_json, conditions_hash, priority, enabled) VALUES (?, ?, 'offer', ?, 'exclude', ?, 'h', 100, 1)",
      )
      .run(mintPublicId("auction_rule"), auction.id, o1.offer_id, ruleConditions);
    const calls = stubFetch(() => new Response(carrierBody("Acme", 12), { status: 200 }));

    const res = await admin.request(`${API}/auctions/${auction.public_id}/simulate`, jsonInit("POST", { sample_answers: { homeowner: false } }), env);
    expect(res.status, `simulate: ${await res.clone().text()}`).toBe(200);
    const j = (await res.json()) as { offers_excluded: Array<{ offer_id: string; reason: string }>; carriers_shown: unknown[] };
    expect(j.offers_excluded.some((o) => o.offer_id === o1.offer_public_id && o.reason.includes("exclude"))).toBe(true);
    // Excluded → no provider call for it, no carriers shown.
    expect(calls.length).toBe(0);
    expect(j.carriers_shown.length).toBe(0);
  });

  it("POST /simulate on an unknown auction is 404", async () => {
    const { env } = harness();
    const res = await admin.request(`${API}/auctions/${mintPublicId("auction")}/simulate`, jsonInit("POST", {}), env);
    expect(res.status).toBe(404);
  });
});
