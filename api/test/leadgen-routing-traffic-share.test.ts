// OWNER 2026-10-18 — Leadgen → Quotes → Funnel builder → Routing rules →
// "+ Add conditions" → Conditions: "support using share of traffic as a
// condition to decide which funnel to run. For example, I want to be able to
// decide that 10% of all traffic runs a different funnel (longer, more
// detailed)." Prior owner ruling reused (auction waterfalls #209): shares split
// like an A/B test — each share is its own slice, slices never overlap, total
// ≤ 100%, leftover = normal behaviour.
//
// Proven through the REAL admin API (save gate), the REAL evaluators over
// rules READ from a real (node:sqlite) schema, the REAL visitor routes
// (/lg shell, /lg/attempt, /lg/ck) and the REAL admin islands
// (RULES_BUILDER_SCRIPT + QUOTE_RULES_SCRIPT) driven over a minimal DOM.
// Plus the separate same-release fix: assignment_bucket is null (not "") when
// there is no A/B bucket (Athena int column).

import { describe, expect, it } from "vitest";
import { createContext, runInContext, runInNewContext } from "node:vm";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { loadQuoteRoutingRules, evaluateQuoteEntryRouting, type EntryKnownContext } from "../src/public/leadgen/resolver";
import { deriveRuleCheckpoint, isEntryPlane } from "../src/leadgen/rule-checkpoint";
import {
  QUOTE_RULES_SCRIPT,
  RULES_BUILDER_SCRIPT,
  renderQuoteRulesRail,
  type QuoteRulesRailData,
  type QuoteRulesRailRule,
} from "../src/admin/leadgen/ui-rules-builder";
import { blankLeadgenEvent, leadgenEventFromPayload, leadgenSessionFromQuoteView } from "../src/analytics/leadgen-events";

// --- node:sqlite harness (repo pattern: leadgen-routing-present-only) -------
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
const TENANT_HOST = "share.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;
const API = "/api/admin/leadgen";

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

interface Funnel {
  funnel: { id: number; public_id: string };
  variant: { id: number; public_id: string };
}
interface Fixture {
  sdb: SqliteDb;
  env: Env;
  quote: { id: number; public_id: string };
  main: Funnel;
  long: Funnel;
}

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
function insertFunnel(sdb: SqliteDb, quoteId: number, name: string, order: number, fields: string[]): Funnel {
  const fPublic = mintPublicId("funnel");
  sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status, display_order) VALUES (?, ?, ?, 'active', ?)").run(fPublic, quoteId, name, order);
  const fId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(fPublic) as { id: number }).id;
  const vPublic = mintPublicId("funnel_variant");
  sdb
    .prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status, content_version) VALUES (?, ?, 'A', 10000, 'default', 'active', 1)")
    .run(vPublic, fId);
  const vId = (sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ?").get(vPublic) as { id: number }).id;
  fields.forEach((field, i) => {
    sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, quote_id, section_id, position) VALUES (?, NULL, ?, ?)").run(vId, insertSection(sdb, field), i);
  });
  return { funnel: { id: fId, public_id: fPublic }, variant: { id: vId, public_id: vPublic } };
}

// One quote: a shared first page asking `q_shared`; "Main" (the default, short)
// and "Long" (longer, more detailed) funnels; activated on the tenant site.
function seed(): Fixture {
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
    LEADGEN_CONFIG_SIGNING_KEY: "traffic-share-signing-key-test-only",
  } as unknown as Env;
  const qPublic = mintPublicId("quote");
  sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status) VALUES (?, 'Life', 'quote_funnel', '[\"life\"]', 'active')").run(qPublic);
  const quote = { id: (sdb.prepare("SELECT id FROM leadgen_quotes WHERE public_id = ?").get(qPublic) as { id: number }).id, public_id: qPublic };
  sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, quote_id, section_id, position) VALUES (NULL, ?, ?, 0)").run(quote.id, insertSection(sdb, "q_shared"));
  const main = insertFunnel(sdb, quote.id, "Main", 1, ["a1"]);
  const long = insertFunnel(sdb, quote.id, "Long", 2, ["b1", "b2", "b3"]);
  sdb.prepare("UPDATE leadgen_quotes SET default_funnel_id = ? WHERE id = ?").run(main.funnel.id, quote.id);
  sdb.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES ('site-1', ?, 1, NULL)").run(quote.id);
  return { sdb, env, quote, main, long };
}

async function adminReq(env: Env, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const init: RequestInit = body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
  const res = await admin.request(`${API}${path}`, init, env);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}
async function createRule(f: Fixture, body: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  return adminReq(f.env, "POST", `/quotes/${f.quote.public_id}/routing-rules`, { rule_name: "Share rule", ...body });
}
function fieldsOf(res: { json: Record<string, unknown> }): Record<string, string> {
  return (res.json["fields"] ?? {}) as Record<string, string>;
}

const share = (pct: unknown): { field: string; op: string; value: unknown } => ({ field: "traffic_share", op: "eq", value: pct });
const BASE: EntryKnownContext = { hour: 12, weekday: 3 };
const N = 10000;
const SIDS = Array.from({ length: N }, (_, i) => `visitor-${i}`);

// The spec's per-visitor bucket, computed independently of the product code:
// sha256("routing_share:" + quote_public_id + ":" + session_id), first 4 bytes
// big-endian, % 10000.
function specBucket(quotePublicId: string, sid: string): number {
  return parseInt(createHash("sha256").update(`routing_share:${quotePublicId}:${sid}`).digest("hex").slice(0, 8), 16) % 10000;
}

// ===========================================================================
// 1 — the plane stays ENTRY
// ===========================================================================

describeDb("Share of traffic — a share-only rule stays an ENTRY rule", () => {
  it("the shared derivation, the runtime partition, the admin save and the island mirror all say Entry", async () => {
    expect(deriveRuleCheckpoint(["traffic_share"], new Set(["q_shared"]), []).plane).toBe("entry");
    expect(isEntryPlane(["traffic_share", "utm_source"])).toBe(true);
    const f = seed();
    const res = await createRule(f, { conditions_json: { groups: [share(10)] }, target_funnel_id: f.long.funnel.public_id });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    expect(res.json["checkpoint_page"]).toBeNull();
    const rules = await loadQuoteRoutingRules(f.env.DB, f.quote.id);
    expect(rules[0]?.entry_only).toBe(true);
    const windowObj: Record<string, unknown> = {};
    runInNewContext(QUOTE_RULES_SCRIPT, { window: windowObj, document: { getElementById: (): null => null, readyState: "complete" } });
    const island = windowObj["lgQuoteRules"] as { deriveCheckpoint(fields: string[], shared: string[], funnels: unknown[]): { plane: string } };
    expect(island.deriveCheckpoint(["traffic_share"], ["q_shared"], []).plane).toBe("entry");
  });
});

// ===========================================================================
// 2 — matching: shared slices of one per-visitor bucket
// ===========================================================================

describeDb("Share of traffic — matching", () => {
  it("a 10% rule routes ≈10% of 10,000 sessions to its funnel (exactly the bucket < 1000 slice) and the same session always gets the same funnel", async () => {
    const f = seed();
    const res = await createRule(f, { conditions_json: { groups: [share(10)] }, target_funnel_id: f.long.funnel.public_id, feed_name: "long_10" });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const rules = await loadQuoteRoutingRules(f.env.DB, f.quote.id);
    const visitor = (sid: string) => ({ quote_public_id: f.quote.public_id, session_id: sid });
    let routed = 0;
    for (const sid of SIDS) {
      const m = evaluateQuoteEntryRouting(rules, BASE, visitor(sid));
      const inSlice = specBucket(f.quote.public_id, sid) < 1000;
      expect(m?.target_funnel_id ?? null, sid).toBe(inSlice ? f.long.funnel.id : null);
      if (m !== null) routed++;
    }
    expect(routed).toBeGreaterThanOrEqual(900);
    expect(routed).toBeLessThanOrEqual(1100);
    // sticky: re-evaluating (fresh rule read) gives every session the same verdict
    const again = await loadQuoteRoutingRules(f.env.DB, f.quote.id);
    for (const sid of SIDS.slice(0, 500)) {
      expect(evaluateQuoteEntryRouting(again, BASE, visitor(sid))?.target_funnel_id ?? null).toBe(
        evaluateQuoteEntryRouting(rules, BASE, visitor(sid))?.target_funnel_id ?? null,
      );
    }
  });

  it("no session id → the share condition never matches", async () => {
    const f = seed();
    await createRule(f, { conditions_json: { groups: [share(100)] }, target_funnel_id: f.long.funnel.public_id });
    const rules = await loadQuoteRoutingRules(f.env.DB, f.quote.id);
    expect(evaluateQuoteEntryRouting(rules, BASE)).toBeNull();
    expect(evaluateQuoteEntryRouting(rules, BASE, { quote_public_id: f.quote.public_id, session_id: "" })).toBeNull();
    expect(evaluateQuoteEntryRouting(rules, BASE, { quote_public_id: f.quote.public_id, session_id: "anyone" })?.target_funnel_id).toBe(f.long.funnel.id);
  });

  it("two 10% rules never overlap: consecutive slices [0,1000) and [1000,2000) in priority order, each ≈10%", async () => {
    const f = seed();
    // created out of priority order on purpose — priority decides the slice order
    await createRule(f, { rule_name: "B", priority: 20, conditions_json: { groups: [share(10)] }, target_funnel_id: f.long.funnel.public_id, feed_name: "slice_b" });
    await createRule(f, { rule_name: "A", priority: 10, conditions_json: { groups: [share(10)] }, target_funnel_id: f.long.funnel.public_id, feed_name: "slice_a" });
    const rules = await loadQuoteRoutingRules(f.env.DB, f.quote.id);
    const counts = { slice_a: 0, slice_b: 0 };
    for (const sid of SIDS) {
      const m = evaluateQuoteEntryRouting(rules, BASE, { quote_public_id: f.quote.public_id, session_id: sid });
      const b = specBucket(f.quote.public_id, sid);
      const expected = b < 1000 ? "slice_a" : b < 2000 ? "slice_b" : null;
      expect(m?.feed_name ?? null, sid).toBe(expected);
      if (m !== null) counts[m.feed_name as "slice_a" | "slice_b"]++;
    }
    for (const n of Object.values(counts)) {
      expect(n).toBeGreaterThanOrEqual(900);
      expect(n).toBeLessThanOrEqual(1100);
    }
  });

  it("share + UTM combine under the rule's match mode (ALL: both; ANY: either)", async () => {
    const f = seed();
    const all = await createRule(f, {
      conditions_json: { groups: [share(50), { field: "utm_source", op: "eq", value: "fb" }] },
      target_funnel_id: f.long.funnel.public_id,
    });
    expect(all.status, JSON.stringify(all.json)).toBe(201);
    let rules = await loadQuoteRoutingRules(f.env.DB, f.quote.id);
    let fbRouted = 0;
    for (const sid of SIDS) {
      const inSlice = specBucket(f.quote.public_id, sid) < 5000;
      const v = { quote_public_id: f.quote.public_id, session_id: sid };
      const fb = evaluateQuoteEntryRouting(rules, { ...BASE, utm_source: "fb" }, v);
      expect(fb !== null, sid).toBe(inSlice);
      if (fb !== null) fbRouted++;
      expect(evaluateQuoteEntryRouting(rules, { ...BASE, utm_source: "google" }, v), sid).toBeNull();
    }
    expect(fbRouted).toBeGreaterThanOrEqual(4800);
    expect(fbRouted).toBeLessThanOrEqual(5200);
    // the same rule on Match ANY: fb always, everyone else only inside the slice
    expect((await adminReq(f.env, "PATCH", `/routing-rules/${all.json["public_id"] as string}`, { match_mode: "any" })).status).toBe(200);
    rules = await loadQuoteRoutingRules(f.env.DB, f.quote.id);
    for (const sid of SIDS.slice(0, 2000)) {
      const inSlice = specBucket(f.quote.public_id, sid) < 5000;
      const v = { quote_public_id: f.quote.public_id, session_id: sid };
      expect(evaluateQuoteEntryRouting(rules, { ...BASE, utm_source: "fb" }, v), sid).not.toBeNull();
      expect(evaluateQuoteEntryRouting(rules, { ...BASE, utm_source: "google" }, v) !== null, sid).toBe(inSlice);
    }
  });

  it("disabling a rule frees its slice: the next share rule moves up to [0,1000)", async () => {
    const f = seed();
    const a = await createRule(f, { rule_name: "A", priority: 10, conditions_json: { groups: [share(10)] }, target_funnel_id: f.long.funnel.public_id, feed_name: "slice_a" });
    await createRule(f, { rule_name: "B", priority: 20, conditions_json: { groups: [share(10)] }, target_funnel_id: f.long.funnel.public_id, feed_name: "slice_b" });
    const off = await adminReq(f.env, "PATCH", `/routing-rules/${a.json["public_id"] as string}`, { status: "disabled" });
    expect(off.status, JSON.stringify(off.json)).toBe(200);
    const rules = await loadQuoteRoutingRules(f.env.DB, f.quote.id);
    for (const sid of SIDS.slice(0, 3000)) {
      const b = specBucket(f.quote.public_id, sid);
      const m = evaluateQuoteEntryRouting(rules, BASE, { quote_public_id: f.quote.public_id, session_id: sid });
      expect(m?.feed_name ?? null, sid).toBe(b < 1000 ? "slice_b" : null);
    }
  });
});

// ===========================================================================
// 3 — the real visitor routes (every evaluator call site gets the session)
// ===========================================================================

describeDb("Share of traffic — through the real visitor routes", () => {
  function pickSessions(f: Fixture, threshold: number): { inside: string; outside: string } {
    const inside = SIDS.find((s) => specBucket(f.quote.public_id, s) < threshold)!;
    const outside = SIDS.find((s) => specBucket(f.quote.public_id, s) >= threshold)!;
    return { inside, outside };
  }
  async function shell(f: Fixture, sid: string): Promise<string> {
    const res = await app.request(`${TENANT_ORIGIN}/lg`, { headers: { Cookie: `ko_sid=${sid}` } }, f.env);
    expect(res.status).toBe(200);
    return res.text();
  }
  async function attempt(f: Fixture, variantPublicId: string, sid: string): Promise<{ faid: string; token: string; session: string; outcome: Record<string, unknown> | null }> {
    const landing = encodeURIComponent(`${TENANT_ORIGIN}/lg`);
    const res = await app.request(`${TENANT_ORIGIN}/lg/attempt?vid=${variantPublicId}&u=${landing}`, { headers: { Cookie: `ko_sid=${sid}` } }, f.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { funnel_attempt_id: string; signed_config_token: string; session_id: string };
    const outcome = (f.sdb.prepare("SELECT * FROM leadgen_routing_outcomes WHERE funnel_attempt_id = ?").get(body.funnel_attempt_id) ?? null) as Record<string, unknown> | null;
    return { faid: body.funnel_attempt_id, token: body.signed_config_token, session: body.session_id, outcome };
  }

  it("/lg serves the Long funnel to an in-slice session (same on every request) and the default funnel otherwise; /lg/attempt records the share rule's outcome", async () => {
    const f = seed();
    await createRule(f, { conditions_json: { groups: [share(10)] }, target_funnel_id: f.long.funnel.public_id, feed_name: "long_10" });
    const { inside, outside } = pickSessions(f, 1000);
    for (let i = 0; i < 2; i++) {
      const inHtml = await shell(f, inside);
      expect(inHtml).toContain(f.long.variant.public_id);
      expect(inHtml).not.toContain(f.main.variant.public_id);
      const outHtml = await shell(f, outside);
      expect(outHtml).toContain(f.main.variant.public_id);
      expect(outHtml).not.toContain(f.long.variant.public_id);
    }
    const a = await attempt(f, f.long.variant.public_id, inside);
    expect(a.outcome?.["routed_to_funnel"]).toBe(f.long.funnel.public_id);
    expect(a.outcome?.["feed_name"]).toBe("long_10");
    expect(a.outcome?.["plane"]).toBe("entry");
    expect((await attempt(f, f.main.variant.public_id, outside)).outcome).toBeNull();
  });

  it("/lg/ck: a checkpoint rule (share + shared-page answer) switches only the sessions inside its slice", async () => {
    const f = seed();
    const r = await createRule(f, { conditions_json: { groups: [share(50), { field: "q_shared", op: "eq", value: true }] }, target_funnel_id: f.long.funnel.public_id });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const { inside, outside } = pickSessions(f, 5000);
    const verdict = async (sid: string): Promise<{ sw: boolean; v?: string }> => {
      const a = await attempt(f, f.main.variant.public_id, sid);
      expect(a.outcome).toBeNull(); // not an entry rule
      const ck = await app.request(
        `${TENANT_ORIGIN}/lg/ck`,
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ k: a.token, f: a.faid, v: f.main.variant.public_id, s: a.session, a: { q_shared: true } }) },
        f.env,
      );
      expect(ck.status).toBe(200);
      return (await ck.json()) as { sw: boolean; v?: string };
    };
    const yes = await verdict(inside);
    expect(yes.sw).toBe(true);
    expect(yes.v).toBe(f.long.variant.public_id);
    expect((await verdict(outside)).sw).toBe(false);
  });
});

// ===========================================================================
// 4 — the save gate (value range, one per rule, active total ≤ 100%)
// ===========================================================================

describeDb("Share of traffic — what the API accepts", () => {
  const VALUE_MSG = "Share of traffic must be a percentage above 0 and at most 100, with up to 2 decimals.";

  it("refuses 0, 101 and more than 2 decimals; accepts 33.33 and 100", async () => {
    const f = seed();
    for (const bad of [0, 101, 10.555, -5, "10"]) {
      const res = await createRule(f, { conditions_json: { groups: [share(bad)] }, feed_name: "x" });
      expect(res.status, String(bad)).toBe(400);
      expect(fieldsOf(res)["conditions_json"], String(bad)).toBe(VALUE_MSG);
    }
    const ok = await createRule(f, { conditions_json: { groups: [share(33.33)] }, feed_name: "x" });
    expect(ok.status, JSON.stringify(ok.json)).toBe(201);
    const opRange = await createRule(f, { conditions_json: { groups: [{ field: "traffic_share", op: "gte", value: 10 }] }, feed_name: "x" });
    expect(fieldsOf(opRange)["conditions_json"]).toBe(VALUE_MSG);
    const f2 = seed();
    const full = await createRule(f2, { conditions_json: { groups: [share(100)] }, feed_name: "x" });
    expect(full.status, JSON.stringify(full.json)).toBe(201);
  });

  it("refuses two share conditions in one rule", async () => {
    const f = seed();
    const res = await createRule(f, { conditions_json: { groups: [share(10), share(5)] }, feed_name: "x" });
    expect(res.status).toBe(400);
    expect(fieldsOf(res)["conditions_json"]).toBe("A rule can have only one Share of traffic condition.");
  });

  it("the quote's ACTIVE shares add up to at most 100% — create, edit, switch on, duplicate; a disabled rule frees its share", async () => {
    const f = seed();
    const r60 = await createRule(f, { conditions_json: { groups: [share(60)] }, feed_name: "s60" });
    const r40 = await createRule(f, { conditions_json: { groups: [share(40)] }, feed_name: "s40" });
    expect([r60.status, r40.status]).toEqual([201, 201]); // exactly 100% is fine
    const over = await createRule(f, { conditions_json: { groups: [share(10)] }, feed_name: "s10" });
    expect(over.status).toBe(400);
    expect(fieldsOf(over)["traffic_share"]).toBe("Shares of traffic add up to 110% — at most 100%");
    // editing a share up past 100%
    const edit = await adminReq(f.env, "PATCH", `/routing-rules/${r40.json["public_id"] as string}`, { conditions_json: { groups: [share(50)] } });
    expect(edit.status).toBe(400);
    expect(fieldsOf(edit)["traffic_share"]).toBe("Shares of traffic add up to 110% — at most 100%");
    // a disabled rule takes no share, so it saves …
    const off = await createRule(f, { status: "disabled", conditions_json: { groups: [share(10)] }, feed_name: "s10" });
    expect(off.status, JSON.stringify(off.json)).toBe(201);
    // … but switching it on (the rail's status-only PATCH) is refused while it does not fit
    const on = await adminReq(f.env, "PATCH", `/routing-rules/${off.json["public_id"] as string}`, { status: "active" });
    expect(on.status).toBe(400);
    expect(fieldsOf(on)["traffic_share"]).toBe("Shares of traffic add up to 110% — at most 100%");
    // duplicating an active share rule would take another slice
    const dup = await adminReq(f.env, "POST", `/routing-rules/${r40.json["public_id"] as string}/duplicate`, {});
    expect(dup.status).toBe(400);
    expect(fieldsOf(dup)["traffic_share"]).toBe("Shares of traffic add up to 140% — at most 100%");
    // disabling the 60% rule frees its share: the 10% rule now switches on
    expect((await adminReq(f.env, "PATCH", `/routing-rules/${r60.json["public_id"] as string}`, { status: "disabled" })).status).toBe(200);
    const onNow = await adminReq(f.env, "PATCH", `/routing-rules/${off.json["public_id"] as string}`, { status: "active" });
    expect(onNow.status, JSON.stringify(onNow.json)).toBe(200);
    expect(onNow.json["status"]).toBe("active");
  });
});

// ===========================================================================
// 5 — the admin editor: card chip, island sentence, the single % box
// ===========================================================================

const RAIL_FUNNELS = [
  { id: 1, public_id: "lgf_main", name: "Main", is_default: true, pages: [{ position: 0, fields: ["a1"] }] },
  { id: 2, public_id: "lgf_long", name: "Long", is_default: false, pages: [{ position: 0, fields: ["b1"] }] },
];
const SHARE_RULE: QuoteRulesRailRule = {
  public_id: "lgqr_share",
  rule_name: "10% to the long funnel",
  priority: 1,
  status: "active",
  match_mode: "all",
  conditions_json: { groups: [share(10), { field: "utm_source", op: "eq", value: "fb" }] },
  target_funnel_id: 2,
  feed_name: null,
  value_multiplier: null,
  redirect_pct: null,
  target_offer_id: null,
  redirect_url: null,
  redirect_url_allowlisted: false,
};
function railData(rules: QuoteRulesRailRule[]): QuoteRulesRailData {
  return {
    quote_public_id: "lgq_share",
    rules,
    funnels: RAIL_FUNNELS,
    default_funnel_id: 1,
    shared_page_fields: [],
    answer_fields: [],
    offers: [],
    feed_values: [],
  };
}

// A minimal DOM — enough for the two islands' createElement/textContent/
// attribute writes and their [attr] / #id / .class lookups.
class FakeNode {
  tagName: string;
  className = "";
  type = "";
  value = "";
  title = "";
  selected = false;
  disabled = false;
  hidden = false;
  attrs: Record<string, string> = {};
  children: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  listeners: Record<string, Array<(e: unknown) => void>> = {};
  private text = "";
  constructor(tag: string, attrs: Record<string, string> = {}, cls = "") {
    this.tagName = tag.toUpperCase();
    this.attrs = { ...attrs };
    this.className = cls;
  }
  get firstChild(): FakeNode | null {
    return this.children[0] ?? null;
  }
  appendChild(n: FakeNode): FakeNode {
    n.parentNode = this;
    this.children.push(n);
    return n;
  }
  removeChild(n: FakeNode): FakeNode {
    const i = this.children.indexOf(n);
    if (i >= 0) this.children.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  get nextSibling(): FakeNode | null {
    const p = this.parentNode;
    if (!p) return null;
    return p.children[p.children.indexOf(this) + 1] ?? null;
  }
  // DOM insertBefore: a null/absent ref appends (as the real DOM does).
  insertBefore(n: FakeNode, ref: FakeNode | null | undefined): FakeNode {
    if (n.parentNode) n.parentNode.removeChild(n);
    const i = ref ? this.children.indexOf(ref) : -1;
    n.parentNode = this;
    if (i < 0) this.children.push(n);
    else this.children.splice(i, 0, n);
    return n;
  }
  setAttribute(k: string, v: unknown): void {
    this.attrs[k] = String(v);
  }
  getAttribute(k: string): string | null {
    return k in this.attrs ? (this.attrs[k] ?? null) : null;
  }
  hasAttribute(k: string): boolean {
    return k in this.attrs;
  }
  removeAttribute(k: string): void {
    delete this.attrs[k];
  }
  addEventListener(t: string, f: (e: unknown) => void): void {
    (this.listeners[t] ??= []).push(f);
  }
  dispatchEvent(): boolean {
    return true;
  }
  focus(): void {}
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(t: string) {
    this.children = [];
    this.text = String(t);
  }
  fire(type: string, event: Record<string, unknown> = {}): void {
    for (const f of this.listeners[type] ?? []) f({ keyCode: 0, target: this, ...event });
  }
  all(): FakeNode[] {
    const out: FakeNode[] = [];
    const walk = (n: FakeNode): void => {
      for (const c of n.children) {
        out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  matches(sel: string): boolean {
    if (sel.startsWith("#")) return this.attrs["id"] === sel.slice(1);
    if (sel.startsWith("[")) return sel.slice(1, -1) in this.attrs;
    const classes = this.className.split(" ");
    return sel.split(".").filter((c) => c !== "").every((c) => classes.includes(c));
  }
  querySelector(sel: string): FakeNode | null {
    return this.all().find((n) => n.matches(sel)) ?? null;
  }
  querySelectorAll(sel: string): FakeNode[] {
    return this.all().filter((n) => n.matches(sel));
  }
  byClass(cls: string): FakeNode[] {
    return this.all().filter((n) => n.className.split(" ").includes(cls));
  }
}

const RAIL_BLOB_RE = /<script id="lg-qr-data" type="application\/json">([^]*?)<\/script>/;

// Boots the REAL rail island (with the REAL condition builder mounted into its
// modal) over the rail's REAL SSR data blob.
type FetchStub = (url: string, init?: { method?: string; body?: string }) => Promise<unknown>;
function bootRail(
  data: QuoteRulesRailData,
  fetchImpl: FetchStub = () => Promise.reject(new Error("no network in this test")),
): { root: FakeNode; modal: FakeNode; sentence: () => string; out: () => string; mount: FakeNode } {
  const blob = (renderQuoteRulesRail(data).match(RAIL_BLOB_RE) ?? [])[1] ?? "";
  const n = (tag: string, attrs: Record<string, string> = {}, cls = ""): FakeNode => new FakeNode(tag, attrs, cls);
  const root = n("div", { id: "lg-qr-rail" });
  const list = root.appendChild(n("div", { id: "lg-qr-list" }));
  const railErr = list.appendChild(n("p", { "data-qr-rail-error": "", role: "alert" }));
  railErr.hidden = true;
  list.appendChild(n("div", { "data-qr-cards": "" }));
  const modal = root.appendChild(n("div", { id: "lg-qr-modal" }));
  modal.appendChild(n("h3", { id: "lg-qr-modal-title" }));
  modal.appendChild(n("input", { "data-qr-modal-name": "" }));
  modal.appendChild(n("input", { "data-qr-modal-priority": "" }));
  modal.appendChild(n("div", { "data-qr-modal-checkpoint": "" }));
  const mount = modal.appendChild(n("div", { id: "lg-qr-cond-mount" }));
  const out = modal.appendChild(n("input", { "data-qr-cond-out": "" }));
  const row = modal.appendChild(n("div", { "data-qr-action": "target_funnel" }, "lg-qr-arow"));
  row.appendChild(n("span", { "data-qr-action-toggle": "" }, "lg-qr-swi on"));
  row.appendChild(n("select", { "data-qr-target-funnel": "" }));
  const sentence = modal.appendChild(n("span", { "data-qr-sentence": "" }));
  const dataEl = n("script", { id: "lg-qr-data" });
  dataEl.textContent = blob;
  const byId = (id: string): FakeNode | null => (id === "lg-qr-data" ? dataEl : root.attrs["id"] === id ? root : root.querySelector(`#${id}`));
  const fakeEvent = { initEvent: (): void => {}, initCustomEvent: (): void => {} };
  const document = {
    readyState: "complete",
    getElementById: byId,
    createElement: (tag: string): FakeNode => new FakeNode(tag),
    createTextNode: (t: string): FakeNode => {
      const tn = new FakeNode("#text");
      tn.textContent = t;
      return tn;
    },
    createEvent: (): typeof fakeEvent => fakeEvent,
  };
  const ctx = createContext({ window: {}, document, fetch: fetchImpl });
  runInContext(RULES_BUILDER_SCRIPT, ctx);
  runInContext(QUOTE_RULES_SCRIPT, ctx);
  return { root, modal, sentence: () => sentence.textContent, out: () => out.value, mount };
}
function click(root: FakeNode, target: FakeNode): void {
  root.fire("click", { target });
}
function shareGroups(json: string): unknown[] {
  return ((JSON.parse(json) as { groups: Array<{ field: string }> }).groups ?? []).filter((g) => g.field === "traffic_share");
}

describe("Share of traffic — the admin editor", () => {
  it("SSR: the card chip reads '10% of traffic', the checkpoint stays Entry, and the help text lists Share of traffic", () => {
    const html = renderQuoteRulesRail(railData([SHARE_RULE]));
    expect(html).toContain('<span class="lg-qr-chip">10% of traffic</span>');
    expect(html).not.toContain("Share of traffic is");
    expect(html).toContain("<span data-qr-ckpt-text>Entry</span>");
    expect(html).toMatch(/<div class="lg-qr-help">Sources:[^<]*Share of traffic[^<]*<\/div>/);
  });

  it("island: the card chip and the modal's plain-language sentence read '10% of traffic'; the builder shows ONE '% of traffic' box with no operator", () => {
    const { root, modal, sentence, out, mount } = bootRail(railData([SHARE_RULE]));
    const card = root.querySelector("[data-qr-card]")!;
    expect(card.byClass("lg-qr-chip").map((c) => c.textContent)).toContain("10% of traffic");
    click(root, card.querySelector("[data-qr-edit]")!);
    expect(mount.children.length, "the condition builder mounted").toBeGreaterThan(0);
    expect(sentence()).toBe("When 10% of traffic and UTM Source is fb, → Long.");
    const rows = mount.byClass("lg-rb-row");
    const shareRow = rows.find((r) => r.byClass("lg-rb-share").length > 0)!;
    expect(shareRow).toBeDefined();
    const box = shareRow.byClass("lg-rb-share")[0]!;
    expect([box.type, box.value, box.getAttribute("min"), box.getAttribute("max"), box.getAttribute("step"), box.getAttribute("aria-label")]).toEqual([
      "number", "10", "0.01", "100", "0.01", "% of traffic",
    ]);
    expect(shareRow.byClass("lg-rb-op"), "no operator choice").toHaveLength(0);
    expect(shareRow.byClass("lg-rb-share-unit")[0]!.textContent).toBe("% of traffic");
    expect(mount.byClass("lg-rb-sentence")[0]!.textContent).toContain("10% of traffic");
    // typing a new share updates the stored entry and the sentence
    box.value = "25";
    box.fire("input");
    modal.fire("input");
    expect(shareGroups(out())).toEqual([{ field: "traffic_share", op: "eq", value: 25 }]);
    expect(sentence()).toBe("When 25% of traffic and UTM Source is fb, → Long.");
    // one per rule: the other row's field list does not offer it, and no "+ or"
    const utmRow = rows.find((r) => r !== shareRow)!;
    const utmOptions = utmRow.byClass("lg-rb-field")[0]!.children.map((o) => o.value);
    expect(utmOptions).toContain("utm_source");
    expect(utmOptions).not.toContain("traffic_share");
    expect(shareRow.byClass("lg-rb-field")[0]!.children.find((o) => o.value === "traffic_share")?.selected).toBe(true);
    const shareCluster = mount.all().find((x) => x.getAttribute("data-cluster-field") === "traffic_share")!;
    expect(shareCluster.all().some((x) => x.tagName === "BUTTON" && x.textContent === "+ or")).toBe(false);
  });

  it("island: choosing 'Share of traffic' on a new condition gives the % box at 10; the Custom field path cannot add it twice", () => {
    const { root, mount, out } = bootRail(railData([]));
    // "+ New rule" (the SSR rail's [data-qr-new]) opens an empty modal
    const newBtn = root.appendChild(new FakeNode("div", { "data-qr-new": "" }));
    click(root, newBtn);
    const add = (): void => mount.all().find((x) => x.tagName === "BUTTON" && x.textContent === "+ Add condition")!.fire("click");
    add();
    const firstSel = mount.byClass("lg-rb-field")[0]!;
    expect(firstSel.children.find((o) => o.selected)?.value, "never the default field").not.toBe("traffic_share");
    firstSel.value = "traffic_share";
    firstSel.fire("change");
    expect(shareGroups(out())).toEqual([{ field: "traffic_share", op: "eq", value: 10 }]);
    expect(mount.byClass("lg-rb-share")).toHaveLength(1);
    expect(mount.byClass("lg-rb-op")).toHaveLength(0);
    expect(mount.byClass("lg-rb-sentence")[0]!.textContent).toBe("Matches when 10% of traffic.");
    // a second condition → Custom field… → typed "traffic_share": refused
    add();
    const secondSel = mount.byClass("lg-rb-field")[1]!;
    secondSel.value = "__lgcustom__";
    secondSel.fire("change");
    const custom = mount.byClass("lg-rb-field-custom").find((c) => !c.hasAttribute("hidden"))!;
    custom.value = "traffic_share";
    custom.fire("input");
    expect(custom.getAttribute("aria-invalid")).toBe("true");
    expect(custom.title).toBe("Share of traffic is already a condition of this rule.");
    custom.fire("change");
    expect(shareGroups(out())).toHaveLength(1);
  });
});

// ===========================================================================
// 5b — review 1 (FIX-FIRST) findings
// ===========================================================================

const SHARE_HELP_TEXT = "Changing a share rule's percentage, order or on/off switch can move returning visitors between the share funnels.";
const REFUSED_107 = "Shares of traffic add up to 107% — at most 100%";
const SHARE_97_OFF: QuoteRulesRailRule = {
  ...SHARE_RULE,
  public_id: "lgqr_share97",
  rule_name: "97% (off)",
  priority: 2,
  status: "disabled",
  conditions_json: { groups: [share(97)] },
};
const ticks = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
const jsonResponse = (status: number, body: unknown): Promise<unknown> =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
function cardOf(root: FakeNode, pub: string): FakeNode {
  return root.querySelectorAll("[data-qr-card]").find((c) => c.getAttribute("data-rule-public-id") === pub)!;
}
function openShareModal(rule: QuoteRulesRailRule): { root: FakeNode; mount: FakeNode } {
  const booted = bootRail(railData([rule]));
  click(booted.root, booted.root.querySelector("[data-qr-edit]")!);
  return booted;
}

describe("Share of traffic — review 1 fixes", () => {
  it("MAJOR-1: a refused switch-on / duplicate puts the server's reason ON that rule's card (the switch stays off); the next accepted action clears it", async () => {
    const calls: string[] = [];
    let rules: QuoteRulesRailRule[] = [SHARE_RULE, SHARE_97_OFF];
    const refused = { error: "Validation failed", fields: { traffic_share: REFUSED_107 } };
    const fetchImpl: FetchStub = (url, init) => {
      const method = init?.method ?? "GET";
      calls.push(method + " " + url);
      if (method === "GET") return jsonResponse(200, { items: rules });
      if (method === "PATCH" && url.endsWith("/lgqr_share97")) return jsonResponse(400, refused);
      if (method === "POST" && url.endsWith("/lgqr_share/duplicate")) return jsonResponse(400, { error: "Validation failed", fields: { traffic_share: "Shares of traffic add up to 20% — at most 100%" } });
      if (method === "PATCH" && url.endsWith("/lgqr_share")) {
        rules = [{ ...SHARE_RULE, status: "disabled" }, SHARE_97_OFF];
        return jsonResponse(200, rules[0]);
      }
      return jsonResponse(500, null);
    };
    const { root } = bootRail(railData([SHARE_RULE, SHARE_97_OFF]), fetchImpl);
    const railErr = root.querySelector("[data-qr-rail-error]")!;
    expect(cardOf(root, "lgqr_share97").querySelector("[data-qr-card-error]"), "no error before any action").toBeNull();

    // switch on the 97% rule → the server refuses (10% + 97% = 107%)
    click(root, cardOf(root, "lgqr_share97").querySelector("[data-qr-toggle]")!);
    await ticks();
    expect(calls).toContain("PATCH /api/admin/leadgen/routing-rules/lgqr_share97");
    const offCard = cardOf(root, "lgqr_share97");
    const err = offCard.querySelector("[data-qr-card-error]");
    expect(err, "the reason sits on the clicked rule's card").not.toBeNull();
    expect(err!.textContent).toBe(REFUSED_107);
    expect(err!.getAttribute("role")).toBe("alert");
    expect(offCard.querySelector("[data-qr-toggle]")!.getAttribute("aria-checked"), "the switch snaps back off").toBe("false");
    expect(cardOf(root, "lgqr_share").querySelector("[data-qr-card-error]"), "only that card").toBeNull();
    expect(railErr.hidden, "not parked at the top of the rail").toBe(true);
    // the card's error is the last thing on the card (right under the switch row)
    expect(offCard.children[offCard.children.length - 1]!.hasAttribute("data-qr-card-error")).toBe(true);

    // duplicate the 10% rule → refused: the reason moves to THAT card
    click(root, cardOf(root, "lgqr_share").querySelector("[data-qr-duplicate]")!);
    await ticks();
    expect(cardOf(root, "lgqr_share").querySelector("[data-qr-card-error]")!.textContent).toBe("Shares of traffic add up to 20% — at most 100%");
    expect(cardOf(root, "lgqr_share97").querySelector("[data-qr-card-error]")).toBeNull();

    // an accepted action (switch the 10% rule off) clears the card error
    click(root, cardOf(root, "lgqr_share").querySelector("[data-qr-toggle]")!);
    await ticks();
    expect(root.querySelectorAll("[data-qr-card-error]")).toHaveLength(0);
    expect(cardOf(root, "lgqr_share").querySelector("[data-qr-toggle]")!.getAttribute("aria-checked")).toBe("false");
  });

  it("MAJOR-1: a network failure on a card action also lands on that card", async () => {
    const { root } = bootRail(railData([SHARE_RULE, SHARE_97_OFF]), () => Promise.reject(new Error("offline")));
    click(root, cardOf(root, "lgqr_share97").querySelector("[data-qr-toggle]")!);
    await ticks();
    expect(cardOf(root, "lgqr_share97").querySelector("[data-qr-card-error]")!.textContent).toBe("Network error — could not turn on the rule.");
  });

  it("MINOR-1: the Custom field path refusing a second share shows a plain hint under the input and keeps the typed text", () => {
    const { root, mount, out } = bootRail(railData([]));
    const newBtn = root.appendChild(new FakeNode("div", { "data-qr-new": "" }));
    click(root, newBtn);
    const add = (): void => mount.all().find((x) => x.tagName === "BUTTON" && x.textContent === "+ Add condition")!.fire("click");
    add();
    const firstSel = mount.byClass("lg-rb-field")[0]!;
    firstSel.value = "traffic_share";
    firstSel.fire("change");
    add();
    const secondSel = mount.byClass("lg-rb-field")[1]!;
    secondSel.value = "__lgcustom__";
    secondSel.fire("change");
    const custom = mount.byClass("lg-rb-field-custom").find((c) => !c.hasAttribute("hidden"))!;
    custom.value = "traffic_share";
    custom.fire("input");
    const hintOf = (): FakeNode | null => mount.querySelector("[data-lg-rb-custom-hint]");
    expect(hintOf(), "a visible hint, not only a tooltip").not.toBeNull();
    expect(hintOf()!.textContent).toBe("Share of traffic is already a condition of this rule.");
    expect(hintOf()!.hidden).toBe(false);
    expect(hintOf()!.className.split(" ")).toContain("form-error");
    // the hint sits in the custom input's own row, after the input
    const row = custom.parentNode!;
    expect(row.children.indexOf(hintOf()!)).toBeGreaterThan(row.children.indexOf(custom));
    // leaving the box (change → the builder re-renders) keeps the typed text and the hint
    custom.fire("change");
    const customAfter = mount.byClass("lg-rb-field-custom").find((c) => !c.hasAttribute("hidden"))!;
    expect(customAfter.value, "the typed text is not erased").toBe("traffic_share");
    expect(customAfter.getAttribute("aria-invalid")).toBe("true");
    expect(hintOf()!.textContent).toBe("Share of traffic is already a condition of this rule.");
    expect(shareGroups(out())).toHaveLength(1);
    // typing an allowed field clears the hint and stores it
    customAfter.value = "my_field";
    customAfter.fire("input");
    expect(hintOf()).toBeNull();
    expect(customAfter.getAttribute("aria-invalid")).toBeNull();
    expect((JSON.parse(out()) as { groups: Array<{ field: string }> }).groups.map((g) => g.field)).toEqual(["traffic_share", "my_field"]);
  });

  it("confirmation N1 + N2: the hint sits right under the box; once the other share row is removed the kept name becomes the row's field", () => {
    const { root, mount, out } = bootRail(railData([]));
    const newBtn = root.appendChild(new FakeNode("div", { "data-qr-new": "" }));
    click(root, newBtn);
    const add = (): void => mount.all().find((x) => x.tagName === "BUTTON" && x.textContent === "+ Add condition")!.fire("click");
    add();
    const firstSel = mount.byClass("lg-rb-field")[0]!;
    firstSel.value = "traffic_share";
    firstSel.fire("change");
    add();
    const secondSel = mount.byClass("lg-rb-field")[1]!;
    secondSel.value = "__lgcustom__";
    secondSel.fire("change");
    const custom = mount.byClass("lg-rb-field-custom").find((c) => !c.hasAttribute("hidden"))!;
    custom.value = "traffic_share";
    custom.fire("input");
    const hint = mount.querySelector("[data-lg-rb-custom-hint]")!;
    // N2: directly after the box, before the row's operator/value/remove controls
    const row = custom.parentNode!;
    expect(row.children.indexOf(hint)).toBe(row.children.indexOf(custom) + 1);
    custom.fire("change");
    // N1: remove the first (real) share row — the kept "traffic_share" is no longer refused
    const removes = mount.all().filter((x) => x.tagName === "BUTTON" && x.getAttribute("aria-label") === "Remove condition");
    removes[0]!.fire("click");
    expect(mount.querySelector("[data-lg-rb-custom-hint]"), "no refusal any more").toBeNull();
    const groups = shareGroups(out());
    expect(groups, "the kept name is now the rule's share condition").toHaveLength(1);
    expect(mount.byClass("lg-rb-share").length, "the row shows the % box, not an empty custom box").toBe(1);
  });

  it("MINOR-2: the % box allows what the server allows (> 0, 2 decimals, ≤ 100): min 0.01, step 0.01, max 100", () => {
    const { mount } = openShareModal(SHARE_RULE);
    const box = mount.byClass("lg-rb-share")[0]!;
    expect([box.getAttribute("min"), box.getAttribute("step"), box.getAttribute("max")]).toEqual(["0.01", "0.01", "100"]);
  });

  it("MINOR-3: ONE help line about returning visitors shows while Share of traffic is in use, and not otherwise", () => {
    const { mount } = openShareModal(SHARE_RULE);
    const help = mount.querySelectorAll("[data-lg-rb-share-help]");
    expect(help).toHaveLength(1);
    expect(help[0]!.textContent).toBe(SHARE_HELP_TEXT);
    expect(help[0]!.className.split(" ")).toContain("form-help");
    const utmOnly = openShareModal({ ...SHARE_RULE, conditions_json: { groups: [{ field: "utm_source", op: "eq", value: "fb" }] } });
    expect(utmOnly.mount.querySelectorAll("[data-lg-rb-share-help]")).toHaveLength(0);
  });
});

// ===========================================================================
// 6 — same release, separate concern: assignment_bucket null, never ""
// ===========================================================================

describe("leadgen events — assignment_bucket is null when there is no A/B bucket (Athena int column)", () => {
  it("blank event, client payload without / with an empty bucket, and the session record carry null; a real bucket is kept", () => {
    expect(blankLeadgenEvent("quote_view", 1).assignment_bucket).toBeNull();
    const none = leadgenEventFromPayload({ event_type: "quote_view" }, 1);
    expect(none.assignment_bucket).toBeNull();
    const empty = leadgenEventFromPayload({ event_type: "quote_view", assignment_bucket: "" }, 1);
    expect(empty.assignment_bucket).toBeNull();
    expect(JSON.stringify(empty)).toContain('"assignment_bucket":null');
    expect(leadgenSessionFromQuoteView(empty).assignment_bucket).toBeNull();
    expect(JSON.stringify(leadgenSessionFromQuoteView(empty))).toContain('"assignment_bucket":null');
    const real = leadgenEventFromPayload({ event_type: "quote_view", assignment_bucket: "1234" }, 1);
    // A real bucket is stored as an integer — the Athena column is an int.
    expect(real.assignment_bucket).toBe(1234);
    expect(JSON.stringify(real)).toContain('"assignment_bucket":1234');
    expect(leadgenSessionFromQuoteView(real).assignment_bucket).toBe(1234);
    expect(leadgenEventFromPayload({ event_type: "quote_view", assignment_bucket: 77 }, 1).assignment_bucket).toBe(77);
    expect(leadgenEventFromPayload({ event_type: "quote_view", assignment_bucket: "12a" }, 1).assignment_bucket).toBeNull();
    expect(leadgenEventFromPayload({ event_type: "quote_view", assignment_bucket: "10000" }, 1).assignment_bucket).toBeNull();
  });
});
