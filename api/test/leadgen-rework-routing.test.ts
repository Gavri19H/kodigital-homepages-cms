// LeadGen Rework — §4.3 funnel & routing semantics, over REAL sqlite (node:sqlite
// harness, the leadgen-p4a-routing / leadgen-p3a-pages pattern) driving the REAL
// resolve / attempt / ck / shell-serve server paths against fixtures seeded on
// the FULL reworked schema (migrations 0036→0053, incl. M1–M12). ONE named test
// per §4.3 clause (R-01…R-15) plus the M10 os table, the M10 os SHELL-SERVE
// parity leg, the M10/D3 feed_name legs (payload context node + event
// dimensions), the M7 slider sub-fields, and the L-192 legacy seam.
//
// Fixtures are seeded by RAW SQL (deterministic, self-contained — the admin
// authoring surfaces for shared pages / multi-funnel / quote rules are P3, not
// yet landed). Pages use the resolver's SYNTHETIC 1-section-per-page /
// 1-shared-page fallback (no page/slot rows needed): variant-owned
// leadgen_funnel_variant_sections → the variant's pages; quote-owned rows → the
// one shared first page. node:sqlite (Node >= 22.5); older Node skips the whole
// suite like its sibling migration/seam suites.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import {
  resolveActivatedFunnel,
  resolveActivatedFunnelByVariant,
  loadQuoteRoutingRules,
  evaluateQuoteEntryRouting,
  evaluateQuoteCheckpointRouting,
  deriveQuoteCheckpointPages,
  loadSharedPages,
  deriveOs,
  resolveEffectiveFrameOnly,
  resolveSavedFrameTemplateDefaultsFor,
  type EntryKnownContext,
} from "../src/public/leadgen/resolver";
import { deriveRuleCheckpoint, ENTRY_KNOWN_ROUTING_FIELDS } from "../src/leadgen/rule-checkpoint";
import { buildPayload, LEADGEN_FEED_NAME_CONTEXT_MACRO } from "../src/leadgen/payload";
import { buildLeadgenRuntimeContext, resolveRoutingOutcomeDims } from "../src/leadgen/runtime-context";
import { blankLeadgenEvent, stampAuctionIds } from "../src/analytics/leadgen-events";
import { fetchProvider } from "../src/public/leadgen/auction/fetch";
import type { LeadgenOfferRow } from "../src/admin/leadgen/db-types";
import { normalizeAnswers } from "../src/leadgen/answers";
import { resolveRoutingMultiplier } from "../src/leadgen/s2s-dispatch";
import { shouldRedirectForSession } from "../src/leadgen/funnel";

// --- node:sqlite harness (repo pattern) ------------------------------------
type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
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

// D1 adapter over a node:sqlite handle (leadgen-p4a-routing idiom).
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
      const out: unknown[] = [];
      try {
        for (const s of statements) out.push(await s.run());
        runSql(sdb, "COMMIT");
      } catch (e) {
        runSql(sdb, "ROLLBACK");
        throw e;
      }
      return out;
    },
  } as unknown as D1Database;
}

function makeKvStub(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(k: string) {
      return store.has(k) ? store.get(k)! : null;
    },
    async getWithMetadata(k: string) {
      return { value: store.get(k) ?? null, metadata: null };
    },
    async put(k: string, v: string) {
      store.set(k, v);
    },
    async delete(k: string) {
      store.delete(k);
    },
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(TEST_DIR, "..", "migrations");
const TENANT_HOST = "rework.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;
const SIGNING_KEY = "rework-signing-key-test-only";

// Every leadgen migration (0036→latest) in filename order — the FULL reworked
// schema, so createQuote's M4 writes + the M2/M3/M5 tables all exist (unlike the
// pre-rework harnesses that hardcode a stale 0036–0044 list).
function leadgenMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 36)
    .sort();
}

function createDb(ctor: DatabaseSyncCtor): SqliteDb {
  const sdb = new ctor(":memory:");
  // Minimal CMS host graph (leadgen migrations reference sites/media by id).
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      `INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','${TENANT_HOST}','insurance','active');` +
      `INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','${TENANT_HOST}','active');`,
  );
  for (const f of leadgenMigrationFiles()) runSql(sdb, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  return sdb;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: makeKvStub(),
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    LEADGEN_CONFIG_SIGNING_KEY: SIGNING_KEY,
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

interface Harness {
  sdb: SqliteDb;
  env: Env;
}
function newHarness(): Harness {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

// --- raw-SQL fixture builders ----------------------------------------------
function insertSection(sdb: SqliteDb, opts: { field: string; type?: string; required?: boolean; sliderType?: string }): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const comp: Record<string, unknown> = {
    type: opts.type ?? "TwoButtonYesNo",
    question_id: `q_${opts.field}`,
    question_key: opts.field,
    internal_field: opts.field,
    answer_type: opts.type === "NumberRangeQuestion" ? "number" : "boolean",
    ...(opts.required === true ? { required: true } : {}),
    ...(opts.sliderType !== undefined ? { props: { slider_type: opts.sliderType } } : {}),
  };
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', 0, 'active')",
    )
    .run(publicId, opts.field, `Headline ${opts.field}`, JSON.stringify({ components: [comp] }));
  return { id: (sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number }).id, public_id: publicId };
}

function insertQuote(sdb: SqliteDb, name: string): { id: number; public_id: string } {
  const publicId = mintPublicId("quote");
  sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status) VALUES (?, ?, 'quote_funnel', '[\"life\"]', 'active')").run(publicId, name);
  return { id: (sdb.prepare("SELECT id FROM leadgen_quotes WHERE public_id = ?").get(publicId) as { id: number }).id, public_id: publicId };
}

function insertFunnel(sdb: SqliteDb, quoteId: number, name: string, displayOrder: number): { id: number; public_id: string } {
  const publicId = mintPublicId("funnel");
  sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status, display_order) VALUES (?, ?, ?, 'active', ?)").run(publicId, quoteId, name, displayOrder);
  return { id: (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(publicId) as { id: number }).id, public_id: publicId };
}

function insertVariant(sdb: SqliteDb, funnelId: number, label: string): { id: number; public_id: string } {
  const publicId = mintPublicId("funnel_variant");
  sdb
    .prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status, content_version) VALUES (?, ?, ?, 10000, 'default', 'active', 1)")
    .run(publicId, funnelId, label);
  return { id: (sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ?").get(publicId) as { id: number }).id, public_id: publicId };
}

// A funnel variant + its ordered sections (variant-owned rows → the resolver's
// synthetic 1-section-per-page fallback).
function seedFunnelWithSections(sdb: SqliteDb, quoteId: number, name: string, order: number, fields: { field: string; required?: boolean }[]): { funnel: { id: number; public_id: string }; variant: { id: number; public_id: string } } {
  const funnel = insertFunnel(sdb, quoteId, name, order);
  const variant = insertVariant(sdb, funnel.id, "A");
  fields.forEach((f, i) => {
    const s = insertSection(sdb, f);
    sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, quote_id, section_id, position) VALUES (?, NULL, ?, ?)").run(variant.id, s.id, i);
  });
  return { funnel, variant };
}

// The quote's ONE shared first page = quote-owned section rows.
function seedSharedPage(sdb: SqliteDb, quoteId: number, fields: { field: string; required?: boolean }[]): void {
  fields.forEach((f, i) => {
    const s = insertSection(sdb, f);
    sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, quote_id, section_id, position) VALUES (NULL, ?, ?, ?)").run(quoteId, s.id, i);
  });
}

interface RuleOpts {
  conditions: { groups: { field: string; op: string; value?: unknown; values?: unknown[] }[] };
  targetFunnelId: number | null;
  priority?: number;
  feed?: string | null;
  multiplier?: number | null;
  redirectPct?: number | null;
  redirectUrl?: string | null;
  matchMode?: string | null;
  status?: string;
}
function insertQuoteRule(sdb: SqliteDb, quoteId: number, o: RuleOpts): string {
  const publicId = mintPublicId("funnel_rule").replace(/^lgfr_/, "lgqr_");
  sdb
    .prepare(
      `INSERT INTO leadgen_quote_routing_rules
         (public_id, quote_id, rule_name, priority, status, match_mode, conditions_json, conditions_hash,
          target_funnel_id, feed_name, value_multiplier, redirect_pct, redirect_url, redirect_url_allowlisted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .run(
      publicId,
      quoteId,
      `rule ${publicId}`,
      o.priority ?? 100,
      o.status ?? "active",
      o.matchMode ?? null,
      JSON.stringify(o.conditions),
      `hash_${publicId}`,
      o.targetFunnelId,
      o.feed ?? null,
      o.multiplier ?? null,
      o.redirectPct ?? null,
      o.redirectUrl ?? null,
    );
  return `hash_${publicId}`;
}

function activate(sdb: SqliteDb, quoteId: number): void {
  sdb.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES ('site-1', ?, 1, NULL)").run(quoteId);
}
function setDefault(sdb: SqliteDb, quoteId: number, funnelId: number): void {
  sdb.prepare("UPDATE leadgen_quotes SET default_funnel_id = ? WHERE id = ?").run(funnelId, quoteId);
}

const BASE: EntryKnownContext = { hour: 12, weekday: 3 };

async function httpGet(env: Env, path: string, headers?: Record<string, string>): Promise<Response> {
  return app.request(`${TENANT_ORIGIN}${path}`, { headers: headers ?? {} }, env);
}
async function httpPostJson(env: Env, path: string, body: unknown): Promise<Response> {
  return app.request(`${TENANT_ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, env);
}

// ===========================================================================
// R-03 + M10 os table + feed→payload: PURE units (no DB)
// ===========================================================================

describe("M10 — deriveOs (server UA → os bucket, contract match order VERBATIM)", () => {
  it("maps the six buckets + weird UAs, first-match-wins, case-sensitive", () => {
    expect(deriveOs("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("ios"); // iPhone before Mac OS X
    expect(deriveOs("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("ios");
    expect(deriveOs("... iPod ...")).toBe("ios");
    expect(deriveOs("Mozilla/5.0 (Linux; Android 14; Pixel)")).toBe("android"); // Android before Linux
    expect(deriveOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(deriveOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macos");
    expect(deriveOs("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
    expect(deriveOs("curl/8.0")).toBe("other");
    expect(deriveOs("")).toBe("other");
    expect(deriveOs(null)).toBe("other");
    expect(deriveOs("android")).toBe("other"); // case-sensitive: lowercase 'android' does NOT match
  });
  it("os is a member of the entry-known routing universe (§4.3-3a)", () => {
    expect(ENTRY_KNOWN_ROUTING_FIELDS.has("os")).toBe(true);
  });
});

describe("R-03 (§4.3-3) — deriveRuleCheckpoint plane derivation incl. the unreachable warning", () => {
  const shared = new Set<string>(["shared_q"]);
  const funnels = [
    { id: 1, publicId: "lgf_1", name: "F1", pages: [{ position: 0, fields: new Set(["age"]) }, { position: 1, fields: new Set(["income"]) }] },
    { id: 2, publicId: "lgf_2", name: "F2", pages: [{ position: 0, fields: new Set(["f2_only"]) }] },
  ];
  it("(a) all-entry-known fields (utm/os/state) → entry plane", () => {
    expect(deriveRuleCheckpoint(["utm_source", "os", "state"], shared, funnels)).toEqual({ plane: "entry" });
  });
  it("(b) all answer fields on the shared page → shared checkpoint", () => {
    expect(deriveRuleCheckpoint(["shared_q"], shared, funnels)).toEqual({ plane: "shared" });
    expect(deriveRuleCheckpoint(["shared_q", "os"], shared, funnels)).toEqual({ plane: "shared" }); // os is entry-known, ignored
  });
  it("(c) a field collected only inside a funnel → in_funnel at the earliest all-known page of the first collecting funnel", () => {
    const cp = deriveRuleCheckpoint(["income"], shared, funnels);
    expect(cp.plane).toBe("in_funnel");
    expect(cp.funnelId).toBe(1);
    expect(cp.pagePosition).toBe(1); // income is on F1 page 1
    expect(cp.unreachable).toBeUndefined();
  });
  it("(c) unreachable when NO funnel collects the answer field (Appendix A-6)", () => {
    const cp = deriveRuleCheckpoint(["nowhere_field"], shared, funnels);
    expect(cp.plane).toBe("in_funnel");
    expect(cp.unreachable).toBe(true);
  });
});

describe("M10/D3 — feed_name exposed as a payload context node (ctx.feed_name)", () => {
  it("a macro:'feed_name' node resolves from ctx.feed_name and maps into an offer payload", () => {
    const schema = { version: 1, root: { type: "object" as const, children: [{ path: "data.feed", name: "feed", type: "string" as const, source: "macro" as const, macro: LEADGEN_FEED_NAME_CONTEXT_MACRO }] } };
    const built = buildPayload(schema, { answers: {}, feed_name: "senior_life_v2" });
    expect(built).toEqual({ data: { feed: "senior_life_v2" } });
    // absent feed_name → the node cleans away (no fabrication).
    expect(buildPayload(schema, { answers: {} })).toEqual({});
  });
});

describe("M7 — dual_range / from_to slider sub-fields join the field universe (answers.ts fieldsOf)", () => {
  const sliderContent = (sliderType: string) => ({
    components: [{ type: "NumberRangeQuestion", question_id: "q_loan", internal_field: "loan", answer_type: "number", props: { slider_type: sliderType } }],
  });
  it("dual_range expands to {field}_min / {field}_max (both numbers), like Address sub-fields", () => {
    const n = normalizeAnswers(sliderContent("dual_range") as never, { loan_min: "10000", loan_max: "50000" });
    expect(n.answers).toEqual({ loan_min: 10000, loan_max: 50000 });
    expect(n.answers.loan).toBeUndefined(); // the base field is NOT itself an answer for dual_range
  });
  it("from_to expands the same way", () => {
    const n = normalizeAnswers(sliderContent("from_to") as never, { loan_min: "5", loan_max: "9" });
    expect(n.answers).toEqual({ loan_min: 5, loan_max: 9 });
  });
  it("single keeps the one scalar internal_field", () => {
    const n = normalizeAnswers(sliderContent("single") as never, { loan: "42" });
    expect(n.answers).toEqual({ loan: 42 });
  });
});

// ===========================================================================
// DB-integration: the REAL resolve / attempt / ck paths
// ===========================================================================

describeDb("R-01/R-02/R-07/R-10 — entities, shared-first, default funnel, A/B", () => {
  // A quote: shared page (shared_q) + F1 (default, collects a1) + F2 (collects a2)
  // + an entry rule utm_source=fb → F2.
  function seedTwoFunnelQuote(sdb: SqliteDb): { quoteId: number; f1: { id: number; public_id: string }; f2: { id: number; public_id: string }; f1v: string; f2v: string; sharedFirstSection: string } {
    const q = insertQuote(sdb, "TwoFunnel");
    seedSharedPage(sdb, q.id, [{ field: "shared_q", required: true }]);
    const f1 = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "a1" }]);
    const f2 = seedFunnelWithSections(sdb, q.id, "F2", 2, [{ field: "a2" }]);
    setDefault(sdb, q.id, f1.funnel.id);
    activate(sdb, q.id);
    const sharedFirstSection = (sdb.prepare("SELECT s.public_id AS p FROM leadgen_funnel_variant_sections fvs JOIN leadgen_sections s ON s.id = fvs.section_id WHERE fvs.quote_id = ? ORDER BY fvs.position LIMIT 1").get(q.id) as { p: string }).p;
    return { quoteId: q.id, f1: f1.funnel, f2: f2.funnel, f1v: f1.variant.public_id, f2v: f2.variant.public_id, sharedFirstSection };
  }

  it("R-01 (§4.3-1): a quote resolves with a shared first page + the served funnel's pages (plan = shared + funnel)", async () => {
    const { sdb, env } = newHarness();
    const { sharedFirstSection } = seedTwoFunnelQuote(sdb);
    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1", session_id: "s1", entry_ctx: BASE });
    expect(resolved).not.toBeNull();
    // shared page (1) + F1's one page (1) = 2 pages.
    expect(resolved!.pages?.length).toBe(2);
    expect(resolved!.sections.map((s) => s.section.public_id)[0]).toBe(sharedFirstSection);
  });

  it("R-02 (§4.3-2): the shared first page serves FIRST for an ENTRY-routed visitor too (entry rules only pre-select the funnel)", async () => {
    const { sdb, env } = newHarness();
    const t = seedTwoFunnelQuote(sdb);
    insertQuoteRule(sdb, t.quoteId, { conditions: { groups: [{ field: "utm_source", op: "eq", value: "fb" }] }, targetFunnelId: t.f2.id, priority: 1 });
    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1", session_id: "s1", entry_ctx: { ...BASE, utm_source: "fb" } });
    // entry-routed to F2…
    expect(resolved!.funnel.public_id).toBe(t.f2.public_id);
    // …yet the FIRST section served is still the shared page's.
    expect(resolved!.sections[0]!.section.public_id).toBe(t.sharedFirstSection);
    expect(resolved!.assignment.routing_rule_hash).toBeTruthy();
  });

  it("R-07 (§4.3-7): an unmatched visitor enters the DEFAULT funnel", async () => {
    const { sdb, env } = newHarness();
    const t = seedTwoFunnelQuote(sdb);
    insertQuoteRule(sdb, t.quoteId, { conditions: { groups: [{ field: "utm_source", op: "eq", value: "fb" }] }, targetFunnelId: t.f2.id, priority: 1 });
    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1", session_id: "s1", entry_ctx: { ...BASE, utm_source: "google" } });
    expect(resolved!.funnel.public_id).toBe(t.f1.public_id); // the default (F1), not F2
    expect(resolved!.assignment.routing_rule_hash).toBeUndefined();
  });

  it("R-10 (§4.3-10): with no running test the single active variant serves (no control concept), variant_label ASC", async () => {
    const { sdb, env } = newHarness();
    const t = seedTwoFunnelQuote(sdb);
    // add a SECOND active variant to F1 (label B) — with NO running test the primary (A, label ASC) serves.
    insertVariant(sdb, t.f1.id, "B");
    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1", session_id: "s1", entry_ctx: BASE });
    expect(resolved!.variant.public_id).toBe(t.f1v); // label A (variant_label ASC), never a "control" flag
    expect(resolved!.assignment.assignment_reason).toBe("single_control");
  });
});

describeDb("R-04 (§4.3-4) — first match wins the ENTIRE action set; lower priority ignored", () => {
  it("two overlapping entry rules: the higher-priority (lower number) rule's full action set applies, the lower is ignored", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "FirstMatch");
    const f1 = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "a1" }]);
    const f2 = seedFunnelWithSections(sdb, q.id, "F2", 2, [{ field: "a2" }]);
    setDefault(sdb, q.id, f1.funnel.id);
    activate(sdb, q.id);
    // both match a catch-all entry; priority 1 → F2 (feed hi), priority 50 → F1 (feed lo).
    insertQuoteRule(sdb, q.id, { conditions: { groups: [] }, targetFunnelId: f1.funnel.id, priority: 50, feed: "lo" });
    insertQuoteRule(sdb, q.id, { conditions: { groups: [] }, targetFunnelId: f2.funnel.id, priority: 1, feed: "hi" });
    const rules = await loadQuoteRoutingRules(env.DB, q.id);
    const match = evaluateQuoteEntryRouting(rules, BASE);
    expect(match!.target_funnel_id).toBe(f2.funnel.id); // priority 1 wins
    expect(match!.feed_name).toBe("hi"); // its ENTIRE action set (feed), not the loser's
  });
});

describeDb("R-05/R-06 (§4.3-5/6) — one outcome per attempt (PK guard) + sticky outcome", () => {
  // shared page collects `q_shared`; a shared-checkpoint rule q_shared=yes → F2.
  function seedCheckpointQuote(sdb: SqliteDb) {
    const q = insertQuote(sdb, "Sticky");
    seedSharedPage(sdb, q.id, [{ field: "q_shared", required: true }]);
    const f1 = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "a1" }]);
    const f2 = seedFunnelWithSections(sdb, q.id, "F2", 2, [{ field: "a2" }]);
    setDefault(sdb, q.id, f1.funnel.id);
    activate(sdb, q.id);
    insertQuoteRule(sdb, q.id, { conditions: { groups: [{ field: "q_shared", op: "eq", value: "yes" }] }, targetFunnelId: f2.funnel.id, priority: 1, feed: "switched" });
    return { q, f1, f2 };
  }
  async function attemptFor(env: Env, variantPublicId: string, session: string): Promise<{ token: string; faid: string }> {
    const res = await httpGet(env, `/lg/attempt?vid=${variantPublicId}`, { Cookie: `ko_sid=${session}` });
    const body = (await res.json()) as { signed_config_token: string; funnel_attempt_id: string };
    return { token: body.signed_config_token, faid: body.funnel_attempt_id };
  }

  it("R-05: after a checkpoint outcome exists, a SECOND /lg/ck on the same attempt does NOT re-route (PK guard)", async () => {
    const { sdb, env } = newHarness();
    const { f1, f2 } = seedCheckpointQuote(sdb);
    const { token, faid } = await attemptFor(env, f1.variant.public_id, "sess-r05");
    const first = (await (await httpPostJson(env, "/lg/ck", { k: token, f: faid, v: f1.variant.public_id, s: "sess-r05", a: { q_shared: "yes" } })).json()) as { sw: boolean; v?: string };
    expect(first.sw).toBe(true);
    expect(first.v).toBe(f2.variant.public_id);
    // a second POST (even matching) is refused — one outcome per attempt.
    const second = (await (await httpPostJson(env, "/lg/ck", { k: token, f: faid, v: f1.variant.public_id, s: "sess-r05", a: { q_shared: "yes" } })).json()) as { sw: boolean };
    expect(second.sw).toBe(false);
    const n = (sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_routing_outcomes WHERE funnel_attempt_id = ?").get(faid) as { n: number }).n;
    expect(n).toBe(1);
  });

  it("R-06: an ENTRY outcome makes the attempt sticky — a later /lg/ck does NOT re-route (back-nav answer change never re-routes)", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "StickyEntry");
    seedSharedPage(sdb, q.id, [{ field: "q_shared", required: true }]);
    const f1 = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "a1" }]);
    const f2 = seedFunnelWithSections(sdb, q.id, "F2", 2, [{ field: "a2" }]);
    setDefault(sdb, q.id, f1.funnel.id);
    activate(sdb, q.id);
    // entry rule (utm) → F2, AND a shared-checkpoint rule q_shared=yes → F1.
    insertQuoteRule(sdb, q.id, { conditions: { groups: [{ field: "utm_source", op: "eq", value: "fb" }] }, targetFunnelId: f2.funnel.id, priority: 1 });
    insertQuoteRule(sdb, q.id, { conditions: { groups: [{ field: "q_shared", op: "eq", value: "yes" }] }, targetFunnelId: f1.funnel.id, priority: 2 });
    // /lg/attempt for F2's variant WITH a matching entry utm → records an ENTRY outcome.
    const res = await httpGet(env, `/lg/attempt?vid=${f2.variant.public_id}&u=${encodeURIComponent(`${TENANT_ORIGIN}/lg?utm_source=fb`)}`, { Cookie: "ko_sid=sess-r06" });
    const body = (await res.json()) as { signed_config_token: string; funnel_attempt_id: string };
    const entryOutcome = sdb.prepare("SELECT plane FROM leadgen_routing_outcomes WHERE funnel_attempt_id = ?").get(body.funnel_attempt_id) as { plane: string } | null;
    expect(entryOutcome?.plane).toBe("entry");
    // now a shared-checkpoint POST that WOULD match F1 — the sticky entry outcome refuses it.
    const ck = (await (await httpPostJson(env, "/lg/ck", { k: body.signed_config_token, f: body.funnel_attempt_id, v: f2.variant.public_id, s: "sess-r06", a: { q_shared: "yes" } })).json()) as { sw: boolean };
    expect(ck.sw).toBe(false);
    const planes = sdb.prepare("SELECT plane FROM leadgen_routing_outcomes WHERE funnel_attempt_id = ?").all(body.funnel_attempt_id) as { plane: string }[];
    expect(planes).toEqual([{ plane: "entry" }]); // still exactly the one entry outcome
  });
});

describeDb("R-08 (§4.3-8) — funnel switch resume position", () => {
  it("resume lands at the target funnel's first page with an unanswered required field (shared already answered)", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "Resume");
    seedSharedPage(sdb, q.id, [{ field: "q_shared", required: true }]);
    const f1 = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "age", required: true }]);
    // F2 has two required pages; the resume must land on the FIRST unanswered one.
    const f2 = seedFunnelWithSections(sdb, q.id, "F2", 2, [{ field: "f2_a", required: true }, { field: "f2_b", required: true }]);
    setDefault(sdb, q.id, f1.funnel.id);
    activate(sdb, q.id);
    insertQuoteRule(sdb, q.id, { conditions: { groups: [{ field: "age", op: "gte", value: 65 }] }, targetFunnelId: f2.funnel.id, priority: 1 });
    const res = await httpGet(env, `/lg/attempt?vid=${f1.variant.public_id}`, { Cookie: "ko_sid=sess-r08" });
    const body = (await res.json()) as { signed_config_token: string; funnel_attempt_id: string };
    // The client posts ALL accumulated answers at the checkpoint (the shared page
    // + F1's age are already done), so the resume skips the already-answered
    // shared page and lands inside the target funnel (§4.3-8).
    const ck = (await (await httpPostJson(env, "/lg/ck", { k: body.signed_config_token, f: body.funnel_attempt_id, v: f1.variant.public_id, s: "sess-r08", a: { q_shared: "yes", age: 70 } })).json()) as { sw: boolean; r?: string };
    expect(ck.sw).toBe(true);
    // f2_a is the target's first unanswered required field → resume at its section.
    const f2aSection = (sdb.prepare("SELECT s.public_id AS p FROM leadgen_funnel_variant_sections fvs JOIN leadgen_sections s ON s.id = fvs.section_id WHERE fvs.variant_id = ? ORDER BY fvs.position LIMIT 1").get(f2.variant.id) as { p: string }).p;
    expect(ck.r).toBe(f2aSection);
  });
});

describeDb("R-09 (§4.3-9) — all actions apply together on ONE routed session", () => {
  it("a checkpoint rule with target+feed+multiplier+redirect_pct records them all; multiplier reaches the S2S graft; redirect is session-sticky-gated", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "AllActions");
    seedSharedPage(sdb, q.id, [{ field: "q_shared", required: true }]);
    const f1 = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "age", required: true }]);
    const f2 = seedFunnelWithSections(sdb, q.id, "F2", 2, [{ field: "a2" }]);
    setDefault(sdb, q.id, f1.funnel.id);
    activate(sdb, q.id);
    const hash = insertQuoteRule(sdb, q.id, { conditions: { groups: [{ field: "age", op: "gte", value: 65 }] }, targetFunnelId: f2.funnel.id, priority: 1, feed: "senior", multiplier: 5.0, redirectPct: 100, redirectUrl: "https://x.example.com/o" });
    const res = await httpGet(env, `/lg/attempt?vid=${f1.variant.public_id}`, { Cookie: "ko_sid=sess-r09" });
    const body = (await res.json()) as { signed_config_token: string; funnel_attempt_id: string };
    const ck = (await (await httpPostJson(env, "/lg/ck", { k: body.signed_config_token, f: body.funnel_attempt_id, v: f1.variant.public_id, s: "sess-r09", a: { age: 70 } })).json()) as { sw: boolean; v?: string; ar?: string };
    expect(ck.sw).toBe(true);
    expect(ck.v).toBe(f2.variant.public_id); // target funnel served
    expect(ck.ar).toBe(`routing_rule:${hash}`);
    // the recorded outcome carries the FULL action set.
    const o = sdb.prepare("SELECT routed_to_funnel, routed_to_variant, feed_name, value_multiplier, plane FROM leadgen_routing_outcomes WHERE funnel_attempt_id = ?").get(body.funnel_attempt_id) as { routed_to_funnel: string; routed_to_variant: string; feed_name: string; value_multiplier: number; plane: string };
    expect(o.routed_to_funnel).toBe(f2.funnel.public_id);
    expect(o.routed_to_variant).toBe(f2.variant.public_id);
    expect(o.feed_name).toBe("senior");
    expect(o.value_multiplier).toBe(5.0);
    expect(o.plane).toBe("checkpoint");
    // multiplier reaches the S2S graft (the existing mechanism, keyed by attempt id).
    expect(await resolveRoutingMultiplier(env.DB, body.funnel_attempt_id)).toBe(5.0);
    // redirect_pct=100 → the existing gated+sticky redirect machinery always redirects.
    expect(shouldRedirectForSession(100, hash, "sess-r09")).toBe(true);
  });
});

describeDb("R-11/R-12/R-13/R-14/R-15 — progress denominator, auction trigger, uniqueness, delete guards, activation preflight", () => {
  it("R-11 (§4.3-11): the resolved plan denominator = shared pages + the served funnel's pages (progress recompute is a P2 client leg)", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "Progress");
    seedSharedPage(sdb, q.id, [{ field: "q_shared" }]);
    const f1 = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "a1" }, { field: "a2" }]);
    setDefault(sdb, q.id, f1.funnel.id);
    activate(sdb, q.id);
    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1", session_id: "s1", entry_ctx: BASE });
    expect(resolved!.pages?.length).toBe(3); // 1 shared + 2 funnel pages
  });

  it("R-12 (§4.3-12): the auction trigger fires after the LAST page of the served plan, which is a FUNNEL page — never the shared page alone (server plan ordering guarantees this)", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "AuctionTrigger");
    seedSharedPage(sdb, q.id, [{ field: "q_shared" }]);
    const f1 = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "a1" }]);
    setDefault(sdb, q.id, f1.funnel.id);
    activate(sdb, q.id);
    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1", session_id: "s1", entry_ctx: BASE });
    // shared page is FIRST; the LAST page (where the engine fires the auction) belongs to the funnel, never the shared page.
    const pages = resolved!.pages!;
    const sharedFirst = (sdb.prepare("SELECT s.public_id AS p FROM leadgen_funnel_variant_sections fvs JOIN leadgen_sections s ON s.id = fvs.section_id WHERE fvs.quote_id = ? ORDER BY fvs.position LIMIT 1").get(q.id) as { p: string }).p;
    expect(pages[0]!.slots[0]!.candidates[0]!.section.public_id).toBe(sharedFirst); // shared first
    expect(pages[pages.length - 1]!.slots[0]!.candidates[0]!.section.public_id).not.toBe(sharedFirst); // last page is a funnel page
  });

  it("R-13 (§4.3-13): the resolver tolerates the SAME section reused across DIFFERENT funnels (uniqueness is scoped per funnel; save/activation validation is S1.4's)", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "Reuse");
    const shared = insertSection(sdb, { field: "reused" });
    // the SAME section id in F1 and F2 (allowed: a section may appear in different funnels).
    const f1 = insertFunnel(sdb, q.id, "F1", 1);
    const f1v = insertVariant(sdb, f1.id, "A");
    sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, quote_id, section_id, position) VALUES (?, NULL, ?, 0)").run(f1v.id, shared.id);
    const f2 = insertFunnel(sdb, q.id, "F2", 2);
    const f2v = insertVariant(sdb, f2.id, "A");
    sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, quote_id, section_id, position) VALUES (?, NULL, ?, 0)").run(f2v.id, shared.id);
    setDefault(sdb, q.id, f1.id);
    activate(sdb, q.id);
    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1", session_id: "s1", entry_ctx: BASE });
    expect(resolved).not.toBeNull(); // resolves without error despite the shared section id
    expect(resolved!.sections[0]!.section.public_id).toBe(shared.public_id);
  });

  it("R-14 (§4.3-14): a rule whose target funnel is archived is defensively ignored at resolve (delete/target guards are enforced at save — S1.4)", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "TargetGuard");
    const f1 = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "a1" }]);
    const f2 = seedFunnelWithSections(sdb, q.id, "F2", 2, [{ field: "a2" }]);
    setDefault(sdb, q.id, f1.funnel.id);
    activate(sdb, q.id);
    // archive F2 then point an entry rule at it: the resolver falls through to the default (F1).
    sdb.prepare("UPDATE leadgen_funnels SET status='archived' WHERE id = ?").run(f2.funnel.id);
    insertQuoteRule(sdb, q.id, { conditions: { groups: [] }, targetFunnelId: f2.funnel.id, priority: 1 });
    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1", session_id: "s1", entry_ctx: BASE });
    expect(resolved!.funnel.public_id).toBe(f1.funnel.public_id); // never serves the archived target
  });

  it("R-15 (§4.3-15): the resolver returns null when a quote has NO active funnel (the activation-preflight-observable floor)", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "NoFunnel");
    activate(sdb, q.id); // activated but no funnels
    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1", session_id: "s1", entry_ctx: BASE });
    expect(resolved).toBeNull();
  });
});

describeDb("checkpoint plane derivation + legacy seam (L-192)", () => {
  it("deriveQuoteCheckpointPages: an in-funnel rule derives its checkpoint page over the RESOLVED (shared+funnel) plan; an entry rule contributes none", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "Checkpoints");
    seedSharedPage(sdb, q.id, [{ field: "q_shared" }]);
    const f1 = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "age", required: true }, { field: "income" }]);
    setDefault(sdb, q.id, f1.funnel.id);
    activate(sdb, q.id);
    insertQuoteRule(sdb, q.id, { conditions: { groups: [{ field: "income", op: "gte", value: 5 }] }, targetFunnelId: f1.funnel.id, priority: 1 }); // in-funnel
    insertQuoteRule(sdb, q.id, { conditions: { groups: [{ field: "utm_source", op: "eq", value: "fb" }] }, targetFunnelId: f1.funnel.id, priority: 2 }); // entry
    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1", session_id: "s1", entry_ctx: BASE });
    const rules = await loadQuoteRoutingRules(env.DB, q.id);
    const pages = deriveQuoteCheckpointPages(resolved!.pages!, rules);
    // plan: page0=shared, page1=age, page2=income → income's checkpoint is page index 2; the entry rule contributes nothing.
    expect(pages).toEqual([2]);
  });

  it("evaluateQuoteCheckpointRouting matches over answers ∪ entry ctx; an entry-only rule never matches at the checkpoint plane", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "CkEval");
    const f1 = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "age" }]);
    const f2 = seedFunnelWithSections(sdb, q.id, "F2", 2, [{ field: "a2" }]);
    setDefault(sdb, q.id, f1.funnel.id);
    activate(sdb, q.id);
    insertQuoteRule(sdb, q.id, { conditions: { groups: [{ field: "age", op: "gte", value: 65 }] }, targetFunnelId: f2.funnel.id, priority: 1 });
    insertQuoteRule(sdb, q.id, { conditions: { groups: [{ field: "utm_source", op: "eq", value: "fb" }] }, targetFunnelId: f2.funnel.id, priority: 2 });
    const rules = await loadQuoteRoutingRules(env.DB, q.id);
    expect(evaluateQuoteCheckpointRouting(rules, BASE, { age: 70 })!.target_funnel_id).toBe(f2.funnel.id);
    expect(evaluateQuoteCheckpointRouting(rules, BASE, { age: 40 })).toBeNull();
    // the entry-only utm rule is never a checkpoint match even when utm matches.
    expect(evaluateQuoteCheckpointRouting(rules, { ...BASE, utm_source: "fb" }, {})).toBeNull();
  });

  it("L-192 legacy seam: a variant-owned-only quote (NO shared page, NO quote rules — the pre-M2 shape) still resolves (variant pages only), never 500s", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "Legacy");
    const f1 = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "a1" }, { field: "a2" }]);
    setDefault(sdb, q.id, f1.funnel.id);
    activate(sdb, q.id);
    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1", session_id: "s1", entry_ctx: BASE });
    expect(resolved).not.toBeNull();
    expect(resolved!.pages?.length).toBe(2); // just the two funnel pages, no shared page
    // loadSharedPages returns [] for a quote with no quote-owned sections.
    expect(await loadSharedPages(env.DB, q.id)).toEqual([]);
  });
});

// ===========================================================================
// Conductor extension round — M10 os SHELL-SERVE parity + M10/D3 feed_name
// remaining legs (payload context node + event dimensions), over serve.ts /
// macros.ts / runtime-context.ts / fetch.ts / leadgen-events.ts (files not
// owned by any P1 slice; ownership extended to this slice for this round).
// ===========================================================================

describeDb("M10 os SHELL-SERVE parity (serve.ts entryCtx derives os identically to /lg/attempt + /lg/ck)", () => {
  it("an os-conditioned entry rule selects the funnel at SHELL-serve time (GET /lg), not only at /lg/attempt", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "ShellOs");
    const f1 = seedFunnelWithSections(sdb, q.id, "Default", 1, [{ field: "a1" }]);
    const f2 = seedFunnelWithSections(sdb, q.id, "IosOnly", 2, [{ field: "a2" }]);
    setDefault(sdb, q.id, f1.funnel.id);
    activate(sdb, q.id);
    insertQuoteRule(sdb, q.id, { conditions: { groups: [{ field: "os", op: "eq", value: "ios" }] }, targetFunnelId: f2.funnel.id, priority: 1 });

    // an iPhone UA (deriveOs -> "ios") routes to F2 AT SHELL-SERVE TIME.
    const iosRes = await httpGet(env, "/lg", { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15" });
    expect(iosRes.status).toBe(200);
    const iosHtml = await iosRes.text();
    expect(iosHtml).toContain(f2.variant.public_id); // the #lg-config JSON carries the SERVED variant's id
    expect(iosHtml).not.toContain(f1.variant.public_id);

    // a desktop (Windows) UA (deriveOs -> "windows") does NOT match the ios
    // rule -> the default funnel serves, at shell-serve time too.
    const desktopRes = await httpGet(env, "/lg", { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" });
    expect(desktopRes.status).toBe(200);
    const desktopHtml = await desktopRes.text();
    expect(desktopHtml).toContain(f1.variant.public_id);
    expect(desktopHtml).not.toContain(f2.variant.public_id);
  });
});

describeDb("M10/D3 feed_name — the remaining contract legs (payload context node via runtime-context.ts + fetch.ts; event dimensions via leadgen-events.ts)", () => {
  // A minimal server-mode Offer with NO configured endpoint (both
  // endpoint_production/staging "") so fetchProvider short-circuits at the
  // "no_endpoint" typed no-op BEFORE any network call — result.debug.request_payload
  // still reflects the REAL buildPayload(...) output built just before that
  // check, so this proves fetch.ts's wiring with zero network dependency.
  function makeOffer(): LeadgenOfferRow {
    return {
      id: 1,
      public_id: "lgo_feedtest",
      offer_name: "Feed Test Offer",
      provider: null,
      activity: "quote_funnel",
      vertical: "life",
      tag: null,
      conversion_tracking_method: "s2s_postback",
      offer_type: "cpc",
      calls_provider_api: 1,
      bid_source: "response",
      request_execution_mode: "server",
      static_bid_value: null,
      static_bid_currency: null,
      static_order: null,
      banner_url_template: null,
      static_fallback_banner_url: null,
      request_method: "POST",
      endpoint_production: "",
      endpoint_staging: "",
      api_token_secret_ref: null,
      api_token_placement: null,
      api_token_param_name: null,
      active_payload_schema_id: null,
      cap_enabled: 0,
      cap_amount: null,
      cap_timezone: null,
      cap_count_by: null,
      cap_fallback_offer_id: null,
      cap_fallback_url: null,
      status: "active",
      created_by: null,
      created_at: 0,
      updated_at: 0,
    };
  }
  const FEED_SCHEMA = {
    version: 1,
    root: {
      type: "object" as const,
      children: [{ path: "meta.feed", name: "feed", type: "string" as const, source: "macro" as const, macro: LEADGEN_FEED_NAME_CONTEXT_MACRO }],
    },
  };

  it("end-to-end: a rule with feed_name matches -> outcome recorded -> resolveRoutingOutcomeDims reads it -> buildLeadgenRuntimeContext carries ctx.feed_name (+ the 'feed_name' canonical macro) -> fetchProvider's built payload carries the value", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "FeedE2E");
    const f1 = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "age", required: true }]);
    const f2 = seedFunnelWithSections(sdb, q.id, "F2", 2, [{ field: "a2" }]);
    setDefault(sdb, q.id, f1.funnel.id);
    activate(sdb, q.id);
    insertQuoteRule(sdb, q.id, { conditions: { groups: [{ field: "age", op: "gte", value: 65 }] }, targetFunnelId: f2.funnel.id, priority: 1, feed: "senior_life_v2" });

    // drive the REAL routing: /lg/attempt then a matching /lg/ck (mirrors R-09).
    const res = await httpGet(env, `/lg/attempt?vid=${f1.variant.public_id}`, { Cookie: "ko_sid=sess-feed-e2e" });
    const body = (await res.json()) as { signed_config_token: string; funnel_attempt_id: string };
    const ck = (await (await httpPostJson(env, "/lg/ck", { k: body.signed_config_token, f: body.funnel_attempt_id, v: f1.variant.public_id, s: "sess-feed-e2e", a: { age: 70 } })).json()) as { sw: boolean };
    expect(ck.sw).toBe(true);

    // resolveRoutingOutcomeDims reads the recorded outcome back.
    const dims = await resolveRoutingOutcomeDims(env.DB, body.funnel_attempt_id);
    expect(dims).not.toBeNull();
    expect(dims!.feed_name).toBe("senior_life_v2");
    expect(dims!.routed_to_funnel).toBe(f2.funnel.public_id);

    // buildLeadgenRuntimeContext threads it onto the top-level ctx.feed_name
    // field AND the canonical "feed_name" macro (registered in macros.ts
    // CANONICAL_MACROS, with the matching ui-payload-builder.ts
    // ADVANCED_MACRO_GROUPS entry so that file's drift guard holds).
    const ctx = buildLeadgenRuntimeContext(new Request(`${TENANT_ORIGIN}/lg/auction`), {
      session_id: "sess-feed-e2e",
      page_view_id: "pv1",
      funnel_attempt_id: body.funnel_attempt_id,
      quote: { public_id: q.public_id },
      funnel: { public_id: f2.funnel.public_id },
      variant: { public_id: f2.variant.public_id },
      feed_name: dims!.feed_name ?? undefined,
    });
    expect(ctx.feed_name).toBe("senior_life_v2");
    expect(ctx.macros["feed_name"]).toBe("senior_life_v2");

    // fetchProvider's REAL buildPayload wiring carries the value into the offer payload.
    const result = await fetchProvider(env, makeOffer(), [], FEED_SCHEMA, { answers: {}, macros: ctx.macros, timeout_ms: 2500, feed_name: ctx.feed_name }, "production");
    expect(result.error_reason).toBe("no_endpoint"); // no network call was made
    expect(result.debug.request_payload).toEqual({ meta: { feed: "senior_life_v2" } });
  });

  it("absent otherwise: an UNROUTED attempt has no recorded outcome -> resolveRoutingOutcomeDims is null -> ctx.feed_name is absent -> the payload node cleans away (never fabricated)", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "FeedAbsent");
    const f1 = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "a1" }]);
    setDefault(sdb, q.id, f1.funnel.id);
    activate(sdb, q.id);
    const res = await httpGet(env, `/lg/attempt?vid=${f1.variant.public_id}`, { Cookie: "ko_sid=sess-feed-absent" });
    const body = (await res.json()) as { funnel_attempt_id: string };

    const dims = await resolveRoutingOutcomeDims(env.DB, body.funnel_attempt_id);
    expect(dims).toBeNull();

    const ctx = buildLeadgenRuntimeContext(new Request(`${TENANT_ORIGIN}/lg/auction`), {
      session_id: "sess-feed-absent",
      page_view_id: "pv1",
      funnel_attempt_id: body.funnel_attempt_id,
      quote: { public_id: q.public_id },
      funnel: { public_id: f1.funnel.public_id },
      variant: { public_id: f1.variant.public_id },
      feed_name: dims?.feed_name ?? undefined,
    });
    expect(ctx.feed_name).toBeUndefined();
    expect(ctx.macros["feed_name"]).toBe(""); // unresolved-macro policy: "" never undefined

    const result = await fetchProvider(env, makeOffer(), [], FEED_SCHEMA, { answers: {}, macros: ctx.macros, timeout_ms: 2500, feed_name: ctx.feed_name }, "production");
    expect(result.debug.request_payload).toEqual({}); // node cleans away — no fabrication
  });

  it("leadgen-events.ts: stampAuctionIds carries feed_name + routed_to_funnel from a REAL recorded outcome onto a blank event; absent outcome leaves both '' (never fabricated)", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "FeedEvents");
    const f1 = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "age", required: true }]);
    const f2 = seedFunnelWithSections(sdb, q.id, "F2", 2, [{ field: "a2" }]);
    setDefault(sdb, q.id, f1.funnel.id);
    activate(sdb, q.id);
    insertQuoteRule(sdb, q.id, { conditions: { groups: [{ field: "age", op: "gte", value: 65 }] }, targetFunnelId: f2.funnel.id, priority: 1, feed: "events_feed" });

    const res = await httpGet(env, `/lg/attempt?vid=${f1.variant.public_id}`, { Cookie: "ko_sid=sess-feed-events" });
    const body = (await res.json()) as { signed_config_token: string; funnel_attempt_id: string };
    const ck = (await (await httpPostJson(env, "/lg/ck", { k: body.signed_config_token, f: body.funnel_attempt_id, v: f1.variant.public_id, s: "sess-feed-events", a: { age: 70 } })).json()) as { sw: boolean };
    expect(ck.sw).toBe(true);

    const dims = await resolveRoutingOutcomeDims(env.DB, body.funnel_attempt_id);
    const event = stampAuctionIds(blankLeadgenEvent("auction_start", Date.now()), {
      feed_name: dims?.feed_name ?? undefined,
      routed_to_funnel: dims?.routed_to_funnel,
    });
    expect(event.feed_name).toBe("events_feed");
    expect(event.routed_to_funnel).toBe(f2.funnel.public_id);

    // an UNROUTED attempt's event: no outcome -> both dims stay the blank "".
    const unroutedRes = await httpGet(env, `/lg/attempt?vid=${f1.variant.public_id}`, { Cookie: "ko_sid=sess-feed-unrouted" });
    const unroutedBody = (await unroutedRes.json()) as { funnel_attempt_id: string };
    const noDims = await resolveRoutingOutcomeDims(env.DB, unroutedBody.funnel_attempt_id);
    const unroutedEvent = stampAuctionIds(blankLeadgenEvent("auction_start", Date.now()), {
      feed_name: noDims?.feed_name ?? undefined,
      routed_to_funnel: noDims?.routed_to_funnel,
    });
    expect(unroutedEvent.feed_name).toBe("");
    expect(unroutedEvent.routed_to_funnel).toBe("");
  });
});

// ===========================================================================
// Conductor mini-round — M5 saved-template threading on the LIVE serve path.
// S2.2 landed frames.ts effectiveFrame's optional 4th arg + resolver.ts's
// resolveEffectiveFrameOnly saved_template_defaults field (unit-tested there);
// this slice's job is the 4 EXTERNAL call sites that must actually populate
// it: runtime-routes.ts (x2), serve.ts (x1, internal to resolveFrameComposition
// via renderFunnelShell + serveLeadgenConfig), attempt.ts (x1) — via the NEW
// shared resolver.ts helper resolveSavedFrameTemplateDefaultsFor.
// ===========================================================================

// A full, valid EffectiveFrameConfig blob (the M5 seed "Centered card" shape,
// migrations/0049) with a DISTINCTIVE header.secure_badge.text marker —
// proves a live-served page's base layer came from THIS saved template, not
// a built-in FRAME_TEMPLATES default (whose secure_badge starts disabled).
function centeredFrameJsonWithMarker(secureBadgeText: string): string {
  return JSON.stringify({
    version: 1,
    template: "centered",
    compat: { allow_section_chrome: false },
    header: {
      enabled: true,
      logo_source: "site",
      logo_media_id: null,
      logo_size: "m",
      logo_align: "center",
      tagline: null,
      secure_badge: { enabled: true, text: secureBadgeText },
      cta: { enabled: false, label: "", href: null, tel: null },
      disclosure_link: false,
      sticky: true,
    },
    progress: { style: "bar", position: "under_header", thickness: "m", width: "content", color_role: "brand_primary", show_label: false },
    back: { style: "text", position: "in_card", label: "Back", history_fallback: true },
    disclosure: { enabled: false, location: "footer", link_label: "Advertising Disclosure", text: "" },
    footer: { enabled: true, show_on: "all", links_source: "site", links: [], trust_text: null, description: null, show_logo: false, hide_on_mobile: false },
    trust_strip: { enabled: false, source: "manual", logos: [], placement: "below_unit", mobile: "wrap" },
    benefit_bar: { enabled: false, items: [], placement: "below_unit" },
    background: { role: "page_background", image_media_id: null, style: "flat" },
    section_slot: { max_width: "m", align: "center", card: "card", padding: "m", offset_y: "none", allow_section_card: true, transition: "fade", continue_placement: "inside_unit", continue_style_role: "button_primary" },
    mobile: {},
  });
}

// A sparse, VALID funnel-level frame_config_json that never touches
// header.secure_badge — mirrors leadgen-section-preview-frame.test.ts's own
// FRAME_CONFIG shape (template + a couple of unrelated groups only) — so a
// saved template's own secure_badge value survives mergeInto as the base layer.
const SPARSE_FRAME_CONFIG = JSON.stringify({
  version: 1,
  template: "centered",
  progress: { style: "bar", show_label: true },
});

function insertFrameTemplate(sdb: SqliteDb, name: string, frameJson: string): { id: number; public_id: string } {
  const publicId = mintPublicId("frame_template");
  sdb.prepare("INSERT INTO leadgen_frame_templates (public_id, name, frame_json, is_default) VALUES (?, ?, ?, 0)").run(publicId, name, frameJson);
  return { id: (sdb.prepare("SELECT id FROM leadgen_frame_templates WHERE public_id = ?").get(publicId) as { id: number }).id, public_id: publicId };
}

describeDb("M5 saved-template threading — LIVE serve path (resolver.ts resolveSavedFrameTemplateDefaultsFor)", () => {
  it("a live-served funnel with a SAVED custom template renders that template's distinctive default through the REAL serve path", async () => {
    const { sdb, env } = newHarness();
    const template = insertFrameTemplate(sdb, "Marker Template 1", centeredFrameJsonWithMarker("SAVED-TEMPLATE-MARKER-1"));
    const q = insertQuote(sdb, "SavedTemplateLive");
    const f = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "a1" }]);
    sdb.prepare("UPDATE leadgen_funnels SET frame_config_json = ?, frame_template_id = ? WHERE id = ?").run(SPARSE_FRAME_CONFIG, template.id, f.funnel.id);
    setDefault(sdb, q.id, f.funnel.id);
    activate(sdb, q.id);

    const res = await httpGet(env, "/lg");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("SAVED-TEMPLATE-MARKER-1");
    expect(html).toContain('<span class="lg-secure-badge-text">SAVED-TEMPLATE-MARKER-1</span>');
  });

  it("a variant-level frame_overrides_json wins over the saved template's default (precedence: template ⊕ funnel.frame_config ⊕ variant.overrides)", async () => {
    const { sdb, env } = newHarness();
    const template = insertFrameTemplate(sdb, "Marker Template 2", centeredFrameJsonWithMarker("SAVED-TEMPLATE-MARKER-2"));
    const q = insertQuote(sdb, "SavedTemplateOverride");
    const f = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "a1" }]);
    sdb.prepare("UPDATE leadgen_funnels SET frame_config_json = ?, frame_template_id = ? WHERE id = ?").run(SPARSE_FRAME_CONFIG, template.id, f.funnel.id);
    // the variant's OWN frame_overrides_json re-points secure_badge.text —
    // this must win over the saved template's base-layer value.
    const overrides = JSON.stringify({ header: { secure_badge: { enabled: true, text: "VARIANT-OVERRIDE-MARKER" } } });
    sdb.prepare("UPDATE leadgen_funnel_variants SET frame_overrides_json = ? WHERE id = ?").run(overrides, f.variant.id);
    setDefault(sdb, q.id, f.funnel.id);
    activate(sdb, q.id);

    const res = await httpGet(env, "/lg");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("VARIANT-OVERRIDE-MARKER");
    expect(html).not.toContain("SAVED-TEMPLATE-MARKER-2");
  });

  it("a funnel/variant with NO frame_template_id anywhere stays byte-identical to before (capture-compare: omitted vs explicit-null saved_template_defaults; no marker leaks into the live serve)", async () => {
    const { sdb, env } = newHarness();
    const q = insertQuote(sdb, "NoFtidLegacy");
    const f = seedFunnelWithSections(sdb, q.id, "F1", 1, [{ field: "a1" }]);
    // a REAL, ftid-less frame_config_json (same sparse shape as tests above) —
    // this funnel takes the composed-frame branch, just with no saved template.
    sdb.prepare("UPDATE leadgen_funnels SET frame_config_json = ? WHERE id = ?").run(SPARSE_FRAME_CONFIG, f.funnel.id);
    setDefault(sdb, q.id, f.funnel.id);
    activate(sdb, q.id);

    // (a) resolveSavedFrameTemplateDefaultsFor returns null when neither the
    // funnel nor the variant carries a frame_template_id.
    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1", session_id: "s1", entry_ctx: BASE });
    expect(resolved).not.toBeNull();
    const savedDefaults = await resolveSavedFrameTemplateDefaultsFor(env.DB, resolved!);
    expect(savedDefaults).toBeNull();

    // (b) capture-compare: resolveEffectiveFrameOnly with the field OMITTED
    // entirely (the pre-round call shape) vs the SAME call with an EXPLICIT
    // `saved_template_defaults: null` (what my new code now always passes)
    // must produce byte-identical (deep-equal) results — proving "absent"
    // and "resolved-to-null" degrade through the EXACT SAME legacy branch.
    const frameSource = {
      frame_config_json: resolved!.funnel.frame_config_json,
      theme_json: resolved!.funnel.theme_json,
      frame_overrides_json: resolved!.variant.frame_overrides_json,
    };
    const withoutField = resolveEffectiveFrameOnly(frameSource);
    const withExplicitNull = resolveEffectiveFrameOnly({ ...frameSource, saved_template_defaults: null });
    expect(withExplicitNull).toEqual(withoutField);
    expect(withoutField).not.toBeNull();
    // the legacy built-in "centered" template's secure_badge starts disabled —
    // confirming this really is the untouched FRAME_TEMPLATES default, not a
    // saved template (which this test never attached).
    expect(withoutField!.header.secure_badge.enabled).toBe(false);

    // (c) the REAL served HTML never leaks either other test's marker, and
    // shows no secure badge at all (secure_badge.enabled is false here).
    const res = await httpGet(env, "/lg");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("SAVED-TEMPLATE-MARKER");
    expect(html).not.toContain("VARIANT-OVERRIDE-MARKER");
    expect(html).not.toContain("lg-secure-badge-text");
  });
});
