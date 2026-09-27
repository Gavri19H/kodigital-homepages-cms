// OWNER 2026-09-27 (Ido, #haikov-support) — three asks on the quote routing
// rule modal, proven here through the REAL admin API, the REAL modal script
// (QUOTE_RULES_SCRIPT, run in a VM) and the REAL visitor routes
// (/lg → /lg/attempt → /lg/ck → /lg/auction):
//   A. A rule with UTM Source = Fundera and the tag "Fundera - Tier 1" failed
//      with a bare "Validation failed". The API's real reason (the tag's
//      charset) now reaches the modal, and the modal turns what the operator
//      typed into the stored form ("Fundera-Tier-1") before save.
//   B. "Feed name" is renamed "Traffic tag" (storage + {feed_name} macro kept).
//   C. New action "Present only this offer": matching visitors stay in the
//      funnel and the auction shows that one offer; everyone else unchanged;
//      a removed/disabled offer shows nothing (fail closed) with a reason.

import { afterEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import {
  QUOTE_RULES_SCRIPT,
  renderQuoteRulesRail,
  type QuoteRulesRailData,
  type QuoteRulesRailRule,
} from "../src/admin/leadgen/ui-rules-builder";

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
function makeKvStub(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
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
const MIGRATIONS_DIR = join(TEST_DIR, "..", "migrations");
const TENANT_HOST = "present.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;
const API = "/api/admin/leadgen";

// Every leadgen migration (0036→latest), so the harness is the real schema.
function createDb(ctor: DatabaseSyncCtor): SqliteDb {
  const sdb = new ctor(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      `INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','${TENANT_HOST}','insurance','active');` +
      `INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','${TENANT_HOST}','active');`,
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 36)
    .sort();
  for (const f of files) runSql(sdb, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  return sdb;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

interface Harness {
  sdb: SqliteDb;
  env: Env;
}
function newHarness(): Harness {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  const env = {
    DB: d1FromSqlite(sdb),
    CACHE: makeKvStub(),
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    DEV_BYPASS_AUTH: "true",
    LEADGEN_CONFIG_SIGNING_KEY: "present-only-signing-key-test-only",
  } as unknown as Env;
  return { sdb, env };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- fixtures (raw SQL for the funnel graph; the RULE always goes through the
// real admin API so its validation is the thing under test) -----------------
function insertSection(sdb: SqliteDb, field: string): number {
  const publicId = mintPublicId("section");
  const comp = { type: "TwoButtonYesNo", question_id: `q_${field}`, question_key: field, internal_field: field, answer_type: "boolean" };
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', 0, 'active')",
    )
    .run(publicId, field, `Headline ${field}`, JSON.stringify({ components: [comp] }));
  return (sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number }).id;
}
function insertQuote(sdb: SqliteDb): { id: number; public_id: string } {
  const publicId = mintPublicId("quote");
  sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status) VALUES (?, 'SMB Loans', 'quote_funnel', '[\"life\"]', 'active')").run(publicId);
  return { id: (sdb.prepare("SELECT id FROM leadgen_quotes WHERE public_id = ?").get(publicId) as { id: number }).id, public_id: publicId };
}
interface Funnel {
  funnel: { id: number; public_id: string };
  variant: { id: number; public_id: string };
}
function insertFunnel(sdb: SqliteDb, quoteId: number, name: string, order: number, field: string, auctionId: number | null): Funnel {
  const fPublic = mintPublicId("funnel");
  sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status, display_order) VALUES (?, ?, ?, 'active', ?)").run(fPublic, quoteId, name, order);
  const fId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(fPublic) as { id: number }).id;
  const vPublic = mintPublicId("funnel_variant");
  sdb
    .prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status, content_version, auction_id) VALUES (?, ?, 'A', 10000, 'default', 'active', 1, ?)")
    .run(vPublic, fId, auctionId);
  const vId = (sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ?").get(vPublic) as { id: number }).id;
  sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, quote_id, section_id, position) VALUES (?, NULL, ?, 0)").run(vId, insertSection(sdb, field));
  return { funnel: { id: fId, public_id: fPublic }, variant: { id: vId, public_id: vPublic } };
}
function seedSharedPage(sdb: SqliteDb, quoteId: number, field: string): void {
  sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, quote_id, section_id, position) VALUES (NULL, ?, ?, 0)").run(quoteId, insertSection(sdb, field));
}
function insertAuction(sdb: SqliteDb): number {
  const publicId = mintPublicId("auction");
  sdb
    .prepare(
      `INSERT INTO leadgen_auctions
         (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
          surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
          backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
       VALUES (?, 'SMB Auction', 'dynamic', 'highest_bid', 'percentage_of_max', 10, 'enabled', 1, 5, 3, 10,
               'disabled', 'on_slot_exhaustion', 0, 'offer', 2500, 1, 'active')`,
    )
    .run(publicId);
  return (sdb.prepare("SELECT id FROM leadgen_auctions WHERE public_id = ?").get(publicId) as { id: number }).id;
}
interface Offer {
  id: number;
  public_id: string;
  provider: string;
}
// A "Static — no provider request" Offer (no provider call; its static bid +
// fallback click URL make the card), attached to the auction.
function insertStaticOffer(sdb: SqliteDb, auctionId: number, provider: string, bid: number, order: number): Offer {
  const publicId = mintPublicId("offer");
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, static_bid_value, static_bid_currency,
          static_fallback_banner_url, status)
       VALUES (?, ?, ?, 'quote_funnel', 'life', 's2s_postback', 'cpl', 0, 'static', 'server', ?, 'USD', ?, 'active')`,
    )
    .run(publicId, `${provider} - Tier 1`, provider, bid, `https://${provider.toLowerCase()}.example/apply`);
  const id = (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as { id: number }).id;
  const placementPublic = mintPublicId("offer_placement");
  sdb.prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)").run(placementPublic, id, `plc-${provider}`);
  const placementId = (sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(placementPublic) as { id: number }).id;
  sdb
    .prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, static_bid_override, enabled) VALUES (?, ?, ?, ?, NULL, 1)")
    .run(auctionId, placementId, id, order);
  return { id, public_id: publicId, provider };
}

interface Fixture extends Harness {
  quote: { id: number; public_id: string };
  auctionId: number;
  main: Funnel;
  alt: Funnel;
  fora: Offer;
  fundera: Offer;
}
// One quote, two funnels (Main = default; Alt) on the SAME auction, which has
// two static offers. A shared first page asks `q_shared` (so an answer-based
// checkpoint rule is authorable). Activated on the tenant site.
function seed(): Fixture {
  const h = newHarness();
  const { sdb } = h;
  const quote = insertQuote(sdb);
  const auctionId = insertAuction(sdb);
  seedSharedPage(sdb, quote.id, "q_shared");
  const main = insertFunnel(sdb, quote.id, "Main", 1, "a1", auctionId);
  const alt = insertFunnel(sdb, quote.id, "Alt", 2, "a2", auctionId);
  sdb.prepare("UPDATE leadgen_quotes SET default_funnel_id = ? WHERE id = ?").run(main.funnel.id, quote.id);
  sdb.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES ('site-1', ?, 1, NULL)").run(quote.id);
  const fora = insertStaticOffer(sdb, auctionId, "Fora", 200, 0);
  const fundera = insertStaticOffer(sdb, auctionId, "Fundera", 150, 1);
  return { ...h, quote, auctionId, main, alt, fora, fundera };
}

async function adminReq(env: Env, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const init: RequestInit = body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await admin.request(`${API}${path}`, init, env);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
async function tenantGet(env: Env, path: string, headers: Record<string, string> = {}): Promise<Response> {
  return app.request(`${TENANT_ORIGIN}${path}`, { headers }, env);
}

const UTM_FUNDERA = { groups: [{ field: "utm_source", op: "eq", value: "Fundera" }] };

// The visitor's whole result-page journey: /lg/config + /lg/attempt from a
// landing URL, optionally a /lg/ck checkpoint post, then POST /lg/auction.
// Returns the shown offers + the persisted result-log row.
async function visit(
  f: Fixture,
  landingQuery: string,
  opts: { session: string; checkpointAnswers?: Record<string, unknown> },
): Promise<{ shown: string[]; status: string; unfilledReason: string | null; excluded: Array<{ offer_id: string; reason: string }>; outcome: Record<string, unknown> | null; servedVariant: string }> {
  const cookie = { Cookie: `ko_sid=${opts.session}` };
  const landing = `${TENANT_ORIGIN}/lg${landingQuery}`;
  const attemptRes = await tenantGet(f.env, `/lg/attempt?vid=${f.main.variant.public_id}&u=${encodeURIComponent(landing)}`, cookie);
  expect(attemptRes.status).toBe(200);
  const attempt = (await attemptRes.json()) as { funnel_attempt_id: string; signed_config_token: string; session_id: string };
  let variant = f.main.variant.public_id;
  let token = attempt.signed_config_token;
  let sectionOrderHash = ((await (await tenantGet(f.env, `/lg/config/${variant}`)).json()) as { section_order_hash: string }).section_order_hash;
  if (opts.checkpointAnswers !== undefined) {
    const ck = await app.request(
      `${TENANT_ORIGIN}/lg/ck`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ k: token, f: attempt.funnel_attempt_id, v: variant, s: attempt.session_id, a: opts.checkpointAnswers }) },
      f.env,
    );
    const body = (await ck.json()) as { sw: boolean; k?: string; v?: string; so?: string };
    if (body.sw) {
      variant = body.v!;
      token = body.k!;
      sectionOrderHash = body.so!;
    }
  }
  const promises: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => promises.push(Promise.resolve(p).catch(() => undefined)), passThroughOnException: () => {} } as unknown as ExecutionContext;
  const res = await app.request(
    new Request(`${TENANT_ORIGIN}/lg/auction`, {
      method: "POST",
      headers: { "content-type": "application/json", Cookie: `ko_sid=${attempt.session_id}` },
      body: JSON.stringify({
        funnel_variant_id: variant,
        funnel_attempt_id: attempt.funnel_attempt_id,
        section_order_hash: sectionOrderHash,
        signed_config_token: token,
        session_id: attempt.session_id,
        page_view_id: "pv-1",
        answers: {},
      }),
    }),
    undefined,
    f.env,
    ctx,
  );
  expect(res.status, await res.clone().text()).toBe(200);
  const json = (await res.json()) as { status: string; banners: Array<{ offer_public_id: string }>; unfilled_reason: string | null };
  await Promise.all(promises);
  const log = f.sdb
    .prepare("SELECT unfilled_reason, offers_excluded_json FROM leadgen_auction_result_log WHERE funnel_attempt_id = ?")
    .get(attempt.funnel_attempt_id) as { unfilled_reason: string | null; offers_excluded_json: string } | undefined;
  const outcome = (f.sdb.prepare("SELECT * FROM leadgen_routing_outcomes WHERE funnel_attempt_id = ?").get(attempt.funnel_attempt_id) ?? null) as Record<string, unknown> | null;
  return {
    shown: [...new Set(json.banners.map((b) => b.offer_public_id))],
    status: json.status,
    unfilledReason: log?.unfilled_reason ?? json.unfilled_reason,
    excluded: log ? (JSON.parse(log.offers_excluded_json) as Array<{ offer_id: string; reason: string }>) : [],
    outcome,
    servedVariant: variant,
  };
}

// The modal's own helpers, from the REAL island script (no DOM root → it
// exposes its pure API and returns).
interface IslandApi {
  slugifyTag(raw: string): string;
  errorText(body: unknown): string | null;
}
function island(): IslandApi {
  const windowObj: Record<string, unknown> = {};
  runInNewContext(QUOTE_RULES_SCRIPT, { window: windowObj, document: { getElementById: (): null => null, readyState: "complete" } });
  return windowObj["lgQuoteRules"] as IslandApi;
}

// ===========================================================================
// A — the save that failed, and the message the modal shows
// ===========================================================================

describeDb("A — Ido's rule (UTM Source = Fundera, tag 'Fundera - Tier 1')", () => {
  it("the API refuses the tag as typed with the Traffic tag reason, and the modal shows THAT reason, not 'Validation failed'", async () => {
    const f = seed();
    const res = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, {
      rule_name: "Fundera Test page",
      priority: 100,
      conditions_json: UTM_FUNDERA,
      feed_name: "Fundera - Tier 1",
    });
    expect(res.status).toBe(400);
    expect(res.json["error"]).toBe("Validation failed");
    const shown = island().errorText(res.json);
    expect(shown).toBe("Traffic tag must be 1–64 characters: letters, digits, underscore (_) or hyphen (-).");
    expect(shown).not.toContain("Validation failed");
  });

  it("every field reason shows, one per line", () => {
    const text = island().errorText({ error: "Validation failed", fields: { rule_name: "Rule name is required.", feed_name: "Traffic tag must be …" } });
    expect(text).toBe("Rule name is required.\nTraffic tag must be …");
    expect(island().errorText({ error: "Not Found" })).toBe("Not Found");
  });

  it("what the operator typed is saved in its stored form: 'Fundera - Tier 1' → 'Fundera-Tier-1' (201, and that is the {feed_name} value)", async () => {
    const f = seed();
    const tag = island().slugifyTag("Fundera - Tier 1");
    expect(tag).toBe("Fundera-Tier-1");
    const res = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, {
      rule_name: "Fundera Test page",
      priority: 100,
      conditions_json: UTM_FUNDERA,
      feed_name: tag,
    });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(res.json["feed_name"]).toBe("Fundera-Tier-1");
    // …and it is what a matching visitor's attempt is stamped with.
    const v = await visit(f, "?utm_source=Fundera", { session: "s-tag" });
    expect(v.outcome?.["feed_name"]).toBe("Fundera-Tier-1");
  });

  it("the stored form: accents, symbols, runs, edges, length", () => {
    const s = island().slugifyTag;
    expect(s("Fundera_-_Tier_1")).toBe("Fundera_-_Tier_1"); // already valid → unchanged
    expect(s("  Fundera / Tier 1.5 ")).toBe("Fundera-Tier-1-5");
    expect(s("Café Crème")).toBe("Cafe-Creme");
    expect(s("--x--")).toBe("x");
    expect(s("!!!")).toBe(""); // nothing savable → the modal says so instead of sending it
    expect(s("a".repeat(70))).toHaveLength(64);
  });
});

// ===========================================================================
// C — "Present only this offer": save rules
// ===========================================================================

describeDb("C — Present only this offer: what the API accepts", () => {
  it("is an action on its own (passes the ≥1-action gate) and is stored in its own column, not as a redirect", async () => {
    const f = seed();
    const res = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, {
      rule_name: "Fundera partner QA",
      conditions_json: UTM_FUNDERA,
      force_offer_id: f.fundera.id,
    });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(res.json["force_offer_id"]).toBe(f.fundera.id);
    expect(res.json["target_offer_id"]).toBeNull();
    expect(res.json["redirect_pct"]).toBeNull();
  });

  it("refuses an offer that does not exist, or is not active, with a reason", async () => {
    const f = seed();
    const missing = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, { rule_name: "R", conditions_json: UTM_FUNDERA, force_offer_id: 999999 });
    expect(missing.status).toBe(400);
    expect((missing.json["fields"] as Record<string, string>)["force_offer_id"]).toBeTruthy();
    f.sdb.prepare("UPDATE leadgen_offers SET status = 'archived' WHERE id = ?").run(f.fora.id);
    const archived = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, { rule_name: "R", conditions_json: UTM_FUNDERA, force_offer_id: f.fora.id });
    expect(archived.status).toBe(400);
    expect((archived.json["fields"] as Record<string, string>)["force_offer_id"]).toBe("That offer is archived — pick an active offer to present.");
  });

  it("on answer conditions it needs a Target funnel (without one the rule could never apply)", async () => {
    const f = seed();
    const answerOnly = { groups: [{ field: "q_shared", op: "eq", value: true }] };
    const refused = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, { rule_name: "R", conditions_json: answerOnly, force_offer_id: f.fora.id });
    expect(refused.status).toBe(400);
    expect((refused.json["fields"] as Record<string, string>)["force_offer_id"]).toContain("entry conditions");
    const ok = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, {
      rule_name: "R",
      conditions_json: answerOnly,
      force_offer_id: f.fora.id,
      target_funnel_id: f.alt.funnel.public_id,
    });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
  });

  it("is kept by Duplicate (rule and quote) and cleared by PATCH null", async () => {
    const f = seed();
    const r = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, { rule_name: "QA", conditions_json: UTM_FUNDERA, force_offer_id: f.fora.id, feed_name: "qa" });
    const dup = await adminReq(f.env, "POST", `/routing-rules/${r.json["public_id"] as string}/duplicate`, {});
    expect(dup.status).toBe(201);
    expect(dup.json["force_offer_id"]).toBe(f.fora.id);
    const cloned = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/duplicate`, {});
    expect(cloned.status, JSON.stringify(cloned.json)).toBe(201);
    const clonedQuote = (cloned.json["public_id"] ?? (cloned.json["quote"] as Record<string, unknown> | undefined)?.["public_id"]) as string;
    const clonedRules = await adminReq(f.env, "GET", `/quotes/${clonedQuote}/routing-rules`);
    const items = clonedRules.json["items"] as Array<{ force_offer_id: number | null }>;
    expect(items.length).toBe(2);
    expect(items.every((i) => i.force_offer_id === f.fora.id)).toBe(true);
    const cleared = await adminReq(f.env, "PATCH", `/routing-rules/${r.json["public_id"] as string}`, { force_offer_id: null });
    expect(cleared.status).toBe(200);
    expect(cleared.json["force_offer_id"]).toBeNull();
  });
});

// ===========================================================================
// C — Present only this offer: what the visitor sees
// ===========================================================================

describeDb("C — Present only this offer, through the real visitor routes", () => {
  async function presentOnlyRule(f: Fixture, offer: Offer): Promise<void> {
    const res = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, {
      rule_name: "Fundera partner QA",
      conditions_json: UTM_FUNDERA,
      feed_name: "Fundera-Tier-1",
      force_offer_id: offer.id,
    });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
  }

  it("without any rule, both offers show (the baseline this feature narrows)", async () => {
    const f = seed();
    const v = await visit(f, "?utm_source=Fundera", { session: "s-base" });
    expect(v.shown.sort()).toEqual([f.fora.public_id, f.fundera.public_id].sort());
  });

  it("a matching visitor stays in the funnel (GET /lg is the funnel, not a redirect) and sees ONLY the chosen offer", async () => {
    const f = seed();
    await presentOnlyRule(f, f.fundera);
    const shell = await tenantGet(f.env, "/lg?utm_source=Fundera", { Cookie: "ko_sid=s-match" });
    expect(shell.status).toBe(200);
    expect(shell.headers.get("Location")).toBeNull();
    expect(await shell.text()).toContain(f.main.variant.public_id);
    const v = await visit(f, "?utm_source=Fundera", { session: "s-match" });
    expect(v.outcome?.["force_offer_id"]).toBe(f.fundera.id);
    expect(v.shown).toEqual([f.fundera.public_id]);
    expect(v.status).toBe("ok");
    // explainability names why the other offer was not in this auction
    expect(v.excluded).toContainEqual({ offer_id: f.fora.public_id, reason: "present_only_rule" });
  });

  it("a visitor the rule does not match is unchanged: both offers", async () => {
    const f = seed();
    await presentOnlyRule(f, f.fundera);
    const v = await visit(f, "?utm_source=google", { session: "s-other" });
    expect(v.outcome).toBeNull();
    expect(v.shown.sort()).toEqual([f.fora.public_id, f.fundera.public_id].sort());
  });

  it("the chosen offer beats a higher static bid — it is the only participant, not a preference", async () => {
    const f = seed();
    // Fora bids 200, Fundera 150 at a 10%-of-max floor; present only Fora's
    // RIVAL at the LOWER bid and it is still the one shown.
    f.sdb.prepare("UPDATE leadgen_offers SET static_bid_value = 1 WHERE id = ?").run(f.fundera.id);
    await presentOnlyRule(f, f.fundera);
    const v = await visit(f, "?utm_source=Fundera", { session: "s-floor" });
    expect(v.shown).toEqual([f.fundera.public_id]);
  });

  it("fails CLOSED: the offer disabled in the auction after the rule was saved → a matching visitor sees no offers (never the others), with the reason on the auction record", async () => {
    const f = seed();
    await presentOnlyRule(f, f.fundera);
    f.sdb.prepare("UPDATE leadgen_auction_offers SET enabled = 0 WHERE offer_id = ?").run(f.fundera.id);
    const v = await visit(f, "?utm_source=Fundera", { session: "s-closed" });
    expect(v.shown).toEqual([]);
    expect(v.status).toBe("unfilled");
    expect(v.unfilledReason).toBe("present_only_offer_unavailable");
    // ordinary traffic still gets the remaining offer
    const other = await visit(f, "?utm_source=google", { session: "s-closed-other" });
    expect(other.shown).toEqual([f.fora.public_id]);
  });

  it("fails CLOSED when the offer is archived after the rule was saved", async () => {
    const f = seed();
    await presentOnlyRule(f, f.fora);
    f.sdb.prepare("UPDATE leadgen_offers SET status = 'archived' WHERE id = ?").run(f.fora.id);
    const v = await visit(f, "?utm_source=Fundera", { session: "s-archived" });
    expect(v.shown).toEqual([]);
    expect(v.unfilledReason).toBe("present_only_offer_unavailable");
  });

  it("Redirect → Offer and Present only stay distinct: the redirect rule sends the visitor away, the present-only rule keeps them", async () => {
    const f = seed();
    const redirect = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, {
      rule_name: "Redirect QA",
      priority: 1,
      conditions_json: { groups: [{ field: "utm_source", op: "eq", value: "redir" }] },
      redirect_pct: 100,
      target_offer_id: f.fora.id,
    });
    expect(redirect.status).toBe(201);
    await presentOnlyRule(f, f.fora);
    const away = await tenantGet(f.env, "/lg?utm_source=redir", { Cookie: "ko_sid=s-away" });
    expect(away.status).toBe(302);
    expect(away.headers.get("Location")).toBe(`/lg/lc/${f.fora.public_id}`);
    const stay = await tenantGet(f.env, "/lg?utm_source=Fundera", { Cookie: "ko_sid=s-stay" });
    expect(stay.status).toBe(200);
  });

  it("an answer-based rule with a Target funnel records the offer at the checkpoint switch, and the auction honours it", async () => {
    const f = seed();
    const rule = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, {
      rule_name: "Shared answer → Alt, Fora only",
      conditions_json: { groups: [{ field: "q_shared", op: "eq", value: true }] },
      target_funnel_id: f.alt.funnel.public_id,
      force_offer_id: f.fora.id,
    });
    expect(rule.status, JSON.stringify(rule.json)).toBe(201);
    const v = await visit(f, "", { session: "s-ck", checkpointAnswers: { q_shared: true } });
    expect(v.servedVariant).toBe(f.alt.variant.public_id);
    expect(v.outcome?.["plane"]).toBe("checkpoint");
    expect(v.outcome?.["force_offer_id"]).toBe(f.fora.id);
    expect(v.shown).toEqual([f.fora.public_id]);
  });

  it("the gap the new rail warning names is real: an answer-based rule with NO Target funnel never applies (no switch, no outcome)", async () => {
    const f = seed();
    const rule = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, {
      rule_name: "Shared answer → tag only",
      conditions_json: { groups: [{ field: "q_shared", op: "eq", value: true }] },
      feed_name: "answered-yes",
    });
    expect(rule.status).toBe(201);
    const v = await visit(f, "", { session: "s-gap", checkpointAnswers: { q_shared: true } });
    expect(v.outcome).toBeNull();
  });
});

// ===========================================================================
// B + C — the rail and the modal (server render)
// ===========================================================================

describe("B + C — the rules rail and modal copy", () => {
  function rule(over: Partial<QuoteRulesRailRule>): QuoteRulesRailRule {
    return {
      public_id: "lgqr_1",
      rule_name: "Fundera Test page",
      priority: 100,
      status: "active",
      match_mode: null,
      conditions_json: UTM_FUNDERA,
      target_funnel_id: null,
      feed_name: null,
      value_multiplier: null,
      redirect_pct: null,
      target_offer_id: null,
      redirect_url: null,
      redirect_url_allowlisted: false,
      force_offer_id: null,
      ...over,
    };
  }
  function data(rules: QuoteRulesRailRule[], liveOfferIds?: number[]): QuoteRulesRailData {
    return {
      quote_public_id: "lgq_1",
      rules,
      funnels: [
        {
          id: 1,
          public_id: "lgf_1",
          name: "Business Loans Match",
          is_default: true,
          pages: [{ position: 0, fields: ["a1"] }],
          ...(liveOfferIds !== undefined ? { live_offer_ids: liveOfferIds } : {}),
        },
      ],
      default_funnel_id: 1,
      shared_page_fields: ["q_shared"],
      answer_fields: [{ internal_field: "q_shared", label: "Shared question" }],
      offers: [
        { id: 7, name: "Fora - Tier 3", status: "active" },
        { id: 8, name: "Fundera - Tier 1", status: "active" },
        { id: 9, name: "Old Offer", status: "archived" },
      ],
      feed_values: [],
    };
  }

  it("says Traffic tag everywhere on this surface — never Feed name", () => {
    const html = renderQuoteRulesRail(data([rule({ feed_name: "Fundera-Tier-1" })]));
    expect(html).not.toMatch(/Feed name/i);
    expect(html).not.toContain(">Feed ");
    expect(html).toContain('<div class="lg-qr-aname">Traffic tag</div>');
    expect(html).toContain("Tag matching sessions for analytics and downstream offer routing.");
    expect(html).toContain('aria-label="Traffic tag"');
    expect(html).toContain(">Tag Fundera-Tier-1<");
    expect(html).toContain("No traffic tags used yet.");
    // the allowed characters are stated BEFORE save
    expect(html).toContain("Letters, digits, underscore (_) and hyphen (-), up to 64 characters. Spaces and other characters are saved as a hyphen.");
  });

  it("offers Present only this offer beside Redirect, with the same offers (inactive ones shown but not selectable)", () => {
    const html = renderQuoteRulesRail(data([]));
    expect(html).toContain('data-qr-action="force_offer"');
    expect(html).toContain('<div class="lg-qr-aname">Present only this offer</div>');
    const select = html.slice(html.indexOf("data-qr-force-offer"), html.indexOf("</select>", html.indexOf("data-qr-force-offer")));
    expect(select).toContain('<option value="7">Fora - Tier 3</option>');
    expect(select).toContain('<option value="8">Fundera - Tier 1</option>');
    expect(select).toContain('<option value="9" disabled>Old Offer (archived)</option>');
    // Redirect → Offer is still its own action with its own picker
    expect(html).toContain('data-qr-target-offer');
  });

  it("the rule card names the presented offer, and warns when it is not live in the funnel's auction", () => {
    const live = renderQuoteRulesRail(data([rule({ force_offer_id: 8 })], [7, 8]));
    expect(live).toContain(">Only offer Fundera - Tier 1<");
    expect(live).not.toContain("data-qr-present-only-warn");
    const notLive = renderQuoteRulesRail(data([rule({ force_offer_id: 8 })], [7]));
    expect(notLive).toContain("data-qr-present-only-warn");
    expect(notLive).toContain("“Fundera - Tier 1” is not a live offer in the auction of funnel “Business Loans Match”.");
    const archived = renderQuoteRulesRail(data([rule({ force_offer_id: 9 })], [7, 8]));
    expect(archived).toContain("“Old Offer” is archived. Matching visitors will see no offers.");
  });

  it("warns on an answer-based rule with no Target funnel (it never applies), and not on an entry rule", () => {
    const answerOnly = renderQuoteRulesRail(data([rule({ conditions_json: { groups: [{ field: "q_shared", op: "eq", value: true }] }, feed_name: "x" })]));
    expect(answerOnly).toContain("data-qr-needs-funnel>");
    const entry = renderQuoteRulesRail(data([rule({ feed_name: "x" })]));
    expect(entry).not.toContain("data-qr-needs-funnel>");
  });
});

// ===========================================================================
// Review round 1 (fresh-context adversarial review, FIX-FIRST) — regressions
// ===========================================================================

describeDb("review — lists past 25 rows (the API caps page_size at 100 and answers 200 with 25)", () => {
  it("the editor's offer pickers list EVERY offer, not the 25 most recently edited", async () => {
    const f = seed();
    for (let i = 0; i < 30; i++) insertStaticOffer(f.sdb, insertAuction(f.sdb), `Extra${i}`, 5, 0);
    // the cause, measured: the old ask is silently served 25 rows
    const capped = await adminReq(f.env, "GET", "/offers?page_size=200");
    expect((capped.json["items"] as unknown[]).length).toBe(25);
    const html = await (await admin.request(`/admin/leadgen/quotes/${f.quote.public_id}/edit`, {}, f.env)).text();
    const start = html.indexOf("data-qr-force-offer");
    const select = html.slice(start, html.indexOf("</select>", start));
    const values = [...select.matchAll(/<option value="(\d+)"/g)].map((m) => m[1]);
    expect(values.length).toBe(32); // Fora + Fundera + 30 extra
    expect(values).toContain(String(f.fora.id)); // the OLDEST offers are there too
  });

  it("apiJsonAll pages through a list of any length", async () => {
    const { apiJsonAll } = await import("../src/admin/leadgen/ui");
    const f = seed();
    for (let i = 0; i < 230; i++) insertStaticOffer(f.sdb, f.auctionId, `Bulk${i}`, 5, 0);
    const res = await apiJsonAll<{ id: number }>(f.env, "/api/admin/leadgen/offers");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.body.items.length).toBe(232);
      expect(new Set(res.body.items.map((o) => o.id)).size).toBe(232);
    }
  });
});

describeDb("review — nothing else reaches a present-only visitor", () => {
  function funnelRedirect(f: Fixture, targetOfferId: number | null, redirectUrl: string | null = null): void {
    f.sdb
      .prepare(
        `INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, target_offer_id, redirect_url, redirect_url_allowlisted, priority, enabled, status, redirect_pct)
         VALUES (?, ?, 'redirect_direct_offer', '{"groups":[]}', 'h-redir', ?, ?, ?, 0, 1, 'active', 100)`,
      )
      .run(mintPublicId("funnel_rule"), f.main.variant.id, targetOfferId, redirectUrl, redirectUrl === null ? 0 : 1);
  }
  async function presentOnly(f: Fixture, offer: Offer): Promise<void> {
    const res = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, { rule_name: "QA", conditions_json: UTM_FUNDERA, force_offer_id: offer.id });
    expect(res.status).toBe(201);
  }

  it("an Auction-tab redirect rule to ANOTHER offer does not take the present-only visitor away (ordinary visitors are still redirected)", async () => {
    const f = seed();
    funnelRedirect(f, f.fundera.id);
    await presentOnly(f, f.fora);
    const qa = await visit(f, "?utm_source=Fundera", { session: "s-fr-qa" });
    expect(qa.status).toBe("ok");
    expect(qa.shown).toEqual([f.fora.public_id]);
    const other = await visit(f, "?utm_source=google", { session: "s-fr-other" });
    expect(other.status).toBe("redirect");
  });

  it("…nor a redirect rule to a raw URL; a redirect to the SAME offer still applies", async () => {
    const f = seed();
    funnelRedirect(f, null, "https://partner.example.com/land");
    await presentOnly(f, f.fora);
    expect((await visit(f, "?utm_source=Fundera", { session: "s-fr-url" })).shown).toEqual([f.fora.public_id]);
    const g = seed();
    funnelRedirect(g, g.fora.id);
    await presentOnly(g, g.fora);
    expect((await visit(g, "?utm_source=Fundera", { session: "s-fr-same" })).status).toBe("redirect");
  });

  it("a static offer is presented even when the auction does not surface static offers", async () => {
    const f = seed();
    f.sdb.prepare("UPDATE leadgen_auctions SET surface_static_bid_offers = 0 WHERE id = ?").run(f.auctionId);
    const normal = await visit(f, "?utm_source=google", { session: "s-nostatic" });
    expect(normal.shown).toEqual([]); // the auction's own setting, unchanged for ordinary traffic
    await presentOnly(f, f.fundera);
    const qa = await visit(f, "?utm_source=Fundera", { session: "s-nostatic-qa" });
    expect(qa.shown).toEqual([f.fundera.public_id]);
  });
});

describeDb("review — rail actions and delete guard", () => {
  it("the on/off switch still works on a present-only rule a funnel deletion left without its Target funnel", async () => {
    const f = seed();
    const r = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, {
      rule_name: "Answer → Alt, Fora only",
      conditions_json: { groups: [{ field: "q_shared", op: "eq", value: true }] },
      target_funnel_id: f.alt.funnel.public_id,
      force_offer_id: f.fora.id,
    });
    expect(r.status).toBe(201);
    // what deleting the Alt funnel does to its rules (quotes-handlers.ts)
    f.sdb.prepare("UPDATE leadgen_quote_routing_rules SET target_funnel_id = NULL WHERE public_id = ?").run(r.json["public_id"] as string);
    const off = await adminReq(f.env, "PATCH", `/routing-rules/${r.json["public_id"] as string}`, { status: "disabled" });
    expect(off.status, JSON.stringify(off.json)).toBe(200);
    // editing the rule's own inputs still gets the reason
    const edit = await adminReq(f.env, "PATCH", `/routing-rules/${r.json["public_id"] as string}`, { force_offer_id: f.fundera.id });
    expect(edit.status).toBe(400);
    expect((edit.json["fields"] as Record<string, string>)["force_offer_id"]).toContain("entry conditions");
  });

  it("an offer a routing rule presents or redirects to cannot be hard-deleted (it is listed as in use)", async () => {
    const f = seed();
    await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, { rule_name: "QA", conditions_json: UTM_FUNDERA, force_offer_id: f.fora.id });
    await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, { rule_name: "Away", conditions_json: UTM_FUNDERA, target_offer_id: f.fundera.id, redirect_pct: 10 });
    // not participating anywhere, so only the routing rules hold them
    f.sdb.prepare("DELETE FROM leadgen_auction_offers").run();
    for (const [offer, rule] of [[f.fora, "QA"], [f.fundera, "Away"]] as const) {
      const del = await admin.request(`${API}/offers/${offer.id}?mode=hard`, { method: "DELETE" }, f.env);
      expect(del.status).toBe(409);
      const body = (await del.json()) as { usage: { kinds: Array<{ kind: string; count: number; items: Array<{ name: string }> }> } };
      const kind = body.usage.kinds.find((k) => k.kind === "quote_routing_rules_targeting")!;
      expect(kind.count).toBe(1);
      expect(kind.items[0]!.name).toBe(`SMB Loans — ${rule}`);
    }
  });

  it("the rail carries an error line for card actions", () => {
    const html = renderQuoteRulesRail({
      quote_public_id: "lgq_1", rules: [], funnels: [], default_funnel_id: null, shared_page_fields: [], answer_fields: [], offers: [], feed_values: [],
    });
    expect(html).toContain('data-qr-rail-error role="alert" hidden');
  });
});

describe("review — the not-live warning across A/B versions", () => {
  it("names an offer live in only some versions of the funnel", () => {
    const html = renderQuoteRulesRail({
      quote_public_id: "lgq_1",
      rules: [
        {
          public_id: "lgqr_1", rule_name: "QA", priority: 1, status: "active", match_mode: null, conditions_json: UTM_FUNDERA,
          target_funnel_id: null, feed_name: null, value_multiplier: null, redirect_pct: null, target_offer_id: null,
          redirect_url: null, redirect_url_allowlisted: false, force_offer_id: 8,
        },
      ],
      funnels: [{ id: 1, public_id: "lgf_1", name: "Main", is_default: true, pages: [], live_offer_ids: [7], partly_live_offer_ids: [8] }],
      default_funnel_id: 1,
      shared_page_fields: [],
      answer_fields: [],
      offers: [{ id: 7, name: "Fora", status: "active" }, { id: 8, name: "Fundera", status: "active" }],
      feed_values: [],
    });
    expect(html).toContain("“Fundera” is live in only some A/B versions of funnel “Main”. Matching visitors on the other versions will see no offers.");
  });
});

describeDb("review — the not-live warning, from the real editor page and database", () => {
  function setup(): { f: Fixture; page: () => Promise<string>; addVersionB: (withFundera: boolean, share: number) => number } {
    const f = seed();
    const page = async (): Promise<string> => {
      const html = await (await admin.request(`/admin/leadgen/quotes/${f.quote.public_id}/edit`, {}, f.env)).text();
      const start = html.indexOf("data-qr-card data-rule-public-id");
      return html.slice(start, html.indexOf("data-qr-delete", start));
    };
    // a second active A/B version of Main, on its own auction
    const addVersionB = (withFundera: boolean, share: number): number => {
      const auction2 = insertAuction(f.sdb);
      insertStaticOffer(f.sdb, auction2, "Other", 10, 0);
      if (withFundera) {
        const pl = f.sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE offer_id = ?").get(f.fundera.id) as { id: number };
        f.sdb.prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, enabled) VALUES (?, ?, ?, 1, 1)").run(auction2, pl.id, f.fundera.id);
      }
      f.sdb
        .prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status, content_version, auction_id) VALUES (?, ?, 'B', ?, 'default', 'active', 1, ?)")
        .run(mintPublicId("funnel_variant"), f.main.funnel.id, share, auction2);
      return auction2;
    };
    return { f, page, addVersionB };
  }
  function startAbTest(f: Fixture): void {
    f.sdb.prepare("UPDATE leadgen_funnel_variants SET traffic_allocation_bp = 5000 WHERE id = ?").run(f.main.variant.id);
    f.sdb.prepare("INSERT INTO leadgen_funnel_ab_tests (public_id, funnel_id, name, revision, status, started_at) VALUES (?, ?, 'AB', 1, 'running', unixepoch())").run(mintPublicId("funnel_ab_test"), f.main.funnel.id);
  }
  async function qaRule(f: Fixture): Promise<void> {
    const r = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, { rule_name: "QA", conditions_json: UTM_FUNDERA, force_offer_id: f.fundera.id });
    expect(r.status).toBe(201);
  }

  it("live in the served version: no warning; removed from its auction: 'not a live offer'", async () => {
    const { f, page } = setup();
    await qaRule(f);
    expect(await page()).not.toContain("data-qr-present-only-warn");
    f.sdb.prepare("UPDATE leadgen_auction_offers SET enabled = 0 WHERE offer_id = ?").run(f.fundera.id);
    expect(await page()).toContain("is not a live offer in the auction of funnel “Main”");
  });

  it("with NO running A/B test only version A serves: a version B without the offer changes nothing, and an offer live only in B is 'not live'", async () => {
    const { f, page, addVersionB } = setup();
    await qaRule(f);
    addVersionB(false, 5000);
    expect(await page()).not.toContain("data-qr-present-only-warn");
    // Fundera live only in B (removed from A's auction), still no running test
    const g = setup();
    await qaRule(g.f);
    g.addVersionB(true, 5000);
    g.f.sdb.prepare("UPDATE leadgen_auction_offers SET enabled = 0 WHERE offer_id = ? AND auction_id = ?").run(g.f.fundera.id, g.f.auctionId);
    expect(await g.page()).toContain("is not a live offer in the auction of funnel “Main”");
  });

  it("with a RUNNING A/B test both versions serve: an offer missing from one version is 'only some A/B versions'", async () => {
    const { f, page, addVersionB } = setup();
    await qaRule(f);
    addVersionB(false, 5000);
    startAbTest(f);
    expect(await page()).toContain("is live in only some A/B versions of funnel “Main”");
  });

  it("a running test's version with 0% traffic serves nobody and is ignored", async () => {
    const { f, page, addVersionB } = setup();
    await qaRule(f);
    addVersionB(false, 0);
    startAbTest(f);
    f.sdb.prepare("UPDATE leadgen_funnel_variants SET traffic_allocation_bp = 10000 WHERE id = ?").run(f.main.variant.id);
    expect(await page()).not.toContain("data-qr-present-only-warn");
  });
});

describeDb("review round 2 — Present only and Redirect never share a rule", () => {
  it("the API refuses Present only together with a Redirect % or target, with the reason; the modal shows the same reason before saving", async () => {
    const f = seed();
    for (const redirect of [
      { redirect_pct: 100, target_offer_id: f.fora.id },
      { redirect_pct: 0, target_offer_id: f.fora.id },
      { redirect_pct: 50, redirect_url: "https://partner.example.com/land" },
    ]) {
      const res = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, { rule_name: "Combo", conditions_json: UTM_FUNDERA, force_offer_id: f.fundera.id, ...redirect });
      expect(res.status, JSON.stringify(redirect)).toBe(400);
      expect((res.json["fields"] as Record<string, string>)["force_offer_id"]).toContain("can't share a rule with a Redirect");
    }
    // …and adding a redirect to an existing present-only rule is refused too
    const r = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, { rule_name: "QA", conditions_json: UTM_FUNDERA, force_offer_id: f.fundera.id });
    const patch = await adminReq(f.env, "PATCH", `/routing-rules/${r.json["public_id"] as string}`, { redirect_pct: 100, target_offer_id: f.fora.id });
    expect(patch.status).toBe(400);
    expect(QUOTE_RULES_SCRIPT).toContain("can\\'t share a rule with a Redirect");
  });

  it("even a row carrying both never redirects the QA visitor — they stay and see only the chosen offer", async () => {
    const f = seed();
    const r = await adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, { rule_name: "QA", conditions_json: UTM_FUNDERA, force_offer_id: f.fundera.id });
    f.sdb.prepare("UPDATE leadgen_quote_routing_rules SET redirect_pct = 100, target_offer_id = ? WHERE public_id = ?").run(f.fora.id, r.json["public_id"] as string);
    const shell = await tenantGet(f.env, "/lg?utm_source=Fundera", { Cookie: "ko_sid=s-combo" });
    expect(shell.status).toBe(200);
    expect(shell.headers.get("Location")).toBeNull();
    expect((await visit(f, "?utm_source=Fundera", { session: "s-combo" })).shown).toEqual([f.fundera.public_id]);
  });

  it("the rail says plainly when a rule was deleted elsewhere, and a later successful save clears the rail error", () => {
    expect(QUOTE_RULES_SCRIPT).toContain("That rule no longer exists");
    expect(QUOTE_RULES_SCRIPT).toContain("showRailErr(''); closeModal(); refetch();");
  });
});
