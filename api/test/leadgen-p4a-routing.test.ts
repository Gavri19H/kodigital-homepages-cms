// LeadGen Round-4 P4a (D-2, operator decision, reference-faithful funnel
// routing) — contract-delta coverage over REAL sqlite (node:sqlite harness,
// the leadgen-runtime-api.test.ts / leadgen-p3a-pages.test.ts pattern):
//   * pure routing-model functions (resolver.ts): entry-known field
//     classification (utm_campaign alias), priority ordering, entry-only vs
//     checkpoint-plane partitioning, auto-CHECKPOINT derivation (answer-field
//     page mapping) incl. entry-only rules producing NO checkpoint page,
//     save-time conflict flagging, the prefix-rule resume computation;
//   * DB-integration: entry routing precedence over §16 A/B (a RUNNING test
//     that would otherwise bucket a visitor elsewhere is bypassed by a
//     matched entry rule);
//   * the full /lg/ck HTTP endpoint: a matched switch (re-issued
//     binding + target plan + resume), a non-match (zero effects), the ≤1-hop
//     guard (a second checkpoint POST on the same attempt after a switch is
//     refused), and binding validation (a forged/tampered signed_config_token
//     is rejected 422 with ZERO effects — no outcome row written, no rule
//     evaluated);
//   * §19-step-4 plane reconciliation: a target variant's OWN non-routing
//     leadgen_funnel_rules are a DISTINCT set from the origin's, keyed by
//     whichever funnel_variant_id resolveActivatedFunnelByVariant resolves —
//     proving the (untouched) /lg/auction pipeline naturally evaluates the
//     TARGET's rules once the engine re-points funnel_variant_id post-switch;
//   * the S2S value_multiplier graft (s2s-dispatch.ts): a recorded routing
//     outcome's multiplier REPLACES the platform base (no stacking); no
//     outcome (or a NULL recorded multiplier) falls back to the base.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { redirectPctBucket, shouldRedirectForSession } from "../src/leadgen/funnel";
import {
  ROUTING_ENTRY_KNOWN_FIELDS,
  parseRoutingRule,
  evaluateEntryRouting,
  evaluateCheckpointRouting,
  deriveCheckpointPages,
  checkpointPageAnchors,
  detectRoutingRuleConflicts,
  computeResumeSection,
  resolveActivatedFunnel,
  resolveActivatedFunnelByVariant,
  type RoutingRuleRow,
  type EntryKnownContext,
  type ResolvedFunnelPage,
  type ResolvedPagePlanEntry,
} from "../src/public/leadgen/resolver";
import { mintFunnelAttempt, verifyConfigTokenDetailed, type ConfigTokenTuple } from "../src/public/leadgen/attempt";
import { computeSectionOrderHash } from "../src/public/leadgen/config-dto";
import {
  dispatchMatchedConversionS2S,
  resolveRoutingMultiplier,
  type S2SClickContext,
  type S2SRevenueContext,
} from "../src/leadgen/s2s-dispatch";

// --- node:sqlite harness (repo pattern, mirrors leadgen-p3a-pages.test.ts) --

type SqliteStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};
type SqliteDb = {
  prepare(sql: string): SqliteStatement;
  close(): void;
  [method: string]: unknown;
};
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    const mod = nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
    return mod.DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as {
        getBuiltinModule?: (name: string) => unknown;
      }).getBuiltinModule;
      if (typeof getBuiltin === "function") {
        const mod = getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
        return mod.DatabaseSync;
      }
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
          const r = sdb.prepare(sql).get(...binds);
          return (r ?? null) as T | null;
        },
        async all<T = unknown>() {
          const rows = sdb.prepare(sql).all(...binds);
          return { results: rows as T[], success: true, meta: {} };
        },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as {
            changes?: number;
            lastInsertRowid?: number | bigint;
          };
          return {
            success: true,
            meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) },
          };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const statement of statements) {
          results.push(await statement.run());
        }
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

function makeKvStub(): KVNamespace {
  const store = new Map<string, { value: string; metadata: unknown }>();
  return {
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
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql",
  "0043_leadgen_routing_rules.sql",
  "0044_leadgen_redirect_pct.sql",
] as const;

const TENANT_HOST = "p4a.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;
const CONFIG_SIGNING_KEY = "p4a-signing-key-test-only";

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
  for (const file of LEADGEN_MIGRATIONS) {
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  }
  return sdb;
}

function buildEnv(db: D1Database, kv: KVNamespace): Env {
  return {
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
    LEADGEN_CONFIG_SIGNING_KEY: CONFIG_SIGNING_KEY,
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

interface Harness {
  sdb: SqliteDb;
  env: Env;
}

function newHarness(): Harness {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createDb(ctor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), makeKvStub()) };
}

function seedSection(sdb: SqliteDb, name: string, opts?: { required?: boolean; field?: string }): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const field = opts?.field ?? name;
  const content = JSON.stringify({
    components: [
      {
        type: "TwoButtonYesNo",
        question_id: `q_${name}`,
        question_key: name,
        internal_field: field,
        answer_type: "boolean",
        ...(opts?.required === true ? { required: true } : {}),
      },
    ],
  });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', 0, 'active')",
    )
    .run(publicId, name, `Headline ${name}`, content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

async function seedQuote(env: Env): Promise<{ quotePublicId: string; variantId: string; funnelId: string }> {
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: `P4a ${Date.now()}-${Math.random()}`, activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const quote = (await createRes.json()) as {
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  return {
    quotePublicId: quote.public_id,
    variantId: quote.funnels[0]!.variants[0]!.public_id,
    funnelId: quote.funnels[0]!.public_id,
  };
}

async function activate(env: Env, quotePublicId: string): Promise<void> {
  const actRes = await admin.request(`${API}/quotes/${quotePublicId}/activation/site-1`, jsonInit("PUT", { enabled: true }), env);
  expect(actRes.status, `activate: ${await actRes.clone().text()}`).toBe(200);
}

async function post(env: Env, path: string, body: unknown): Promise<Response> {
  return app.request(`${TENANT_ORIGIN}${path}`, jsonInit("POST", body), env);
}
async function get(env: Env, path: string): Promise<Response> {
  return app.request(`${TENANT_ORIGIN}${path}`, {}, env);
}

// Raw-SQL rule seeding (bypasses the admin API deliberately — P4b, the
// route_funnel_variant admin authoring surface, is a SEPARATE dispatch not
// yet landed; FUNNEL_RULE_TYPES in quotes-handlers.ts does not accept this
// rule_type yet, so a routing rule can only be seeded directly against the
// 0043 schema for THIS slice's server-layer tests).
function seedRoutingRule(
  sdb: SqliteDb,
  variantId: number,
  opts: {
    conditions: { groups: Array<{ field: string; op: string; value?: unknown; values?: unknown[]; from?: number; to?: number }> };
    targetVariantId: number | null;
    priority?: number;
    multiplier?: number | null;
    status?: string;
    name?: string;
    matchMode?: string | null;
  },
): string {
  const publicId = mintPublicId("funnel_rule");
  const conditionsJson = JSON.stringify(opts.conditions);
  sdb
    .prepare(
      `INSERT INTO leadgen_funnel_rules
         (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority, status,
          target_funnel_variant_id, value_multiplier, rule_name, match_mode, enabled)
       VALUES (?, ?, 'route_funnel_variant', ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    )
    .run(
      publicId,
      variantId,
      conditionsJson,
      `hash_${publicId}`,
      opts.priority ?? 100,
      opts.status ?? "active",
      opts.targetVariantId,
      opts.multiplier ?? null,
      opts.name ?? null,
      opts.matchMode ?? null,
    );
  return publicId;
}

function variantRowId(sdb: SqliteDb, variantPublicId: string): number {
  return (sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ?").get(variantPublicId) as { id: number }).id;
}

// A second variant of the SAME funnel, seeded directly (raw SQL — faster/more
// controllable than the admin `/fork` endpoint for these DB-integration tests;
// the Playwright spec exercises the REAL fork+pages-PUT admin flow instead).
function seedSiblingVariant(sdb: SqliteDb, funnelRowId: number, label: string, isControl: boolean): string {
  const publicId = mintPublicId("funnel_variant");
  sdb
    .prepare(
      "INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, is_control, traffic_allocation_bp, status, content_version) VALUES (?, ?, ?, ?, 10000, 'active', 1)",
    )
    .run(publicId, funnelRowId, label, isControl ? 1 : 0);
  return publicId;
}

function attachSection(sdb: SqliteDb, variantId: number, sectionId: number, position: number): void {
  sdb
    .prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, ?, ?)")
    .run(variantId, sectionId, position);
}

const BASE_CTX: EntryKnownContext = { hour: 12, weekday: 3 };

// ===========================================================================
// Pure routing-model functions (resolver.ts) — no DB
// ===========================================================================

describe("P4a field registry + rule parsing (pure)", () => {
  it("ROUTING_ENTRY_KNOWN_FIELDS carries the closed entry-known set incl. the utm_campaign alias", () => {
    expect([...ROUTING_ENTRY_KNOWN_FIELDS].sort()).toEqual(
      ["device", "hour", "state", "utm_campaign", "utm_content", "utm_medium", "utm_source", "weekday"].sort(),
    );
    expect(ROUTING_ENTRY_KNOWN_FIELDS.has("age")).toBe(false); // an answer field, not entry-known
  });

  function row(overrides: Partial<RoutingRuleRow> = {}): RoutingRuleRow {
    return {
      public_id: "lgfr_x",
      variant_id: 1,
      conditions_json: JSON.stringify({ groups: [] }),
      conditions_hash: "h",
      target_funnel_variant_id: 2,
      value_multiplier: null,
      priority: 100,
      status: "active",
      ...overrides,
    };
  }

  it("a rule whose conditions reference ONLY entry-known fields parses entry_only=true", () => {
    const r = parseRoutingRule(row({ conditions_json: JSON.stringify({ groups: [{ field: "utm_source", op: "eq", value: "facebook" }] }) }));
    expect(r.entry_only).toBe(true);
  });

  it("a rule referencing an answer field (e.g. age) parses entry_only=false", () => {
    const r = parseRoutingRule(row({ conditions_json: JSON.stringify({ groups: [{ field: "age", op: "gte", value: 65 }] }) }));
    expect(r.entry_only).toBe(false);
  });

  it("a rule with NO conditions (catch-all) parses entry_only=true", () => {
    const r = parseRoutingRule(row({ conditions_json: JSON.stringify({ groups: [] }) }));
    expect(r.entry_only).toBe(true);
  });

  it("a corrupt conditions_json blob degrades to an empty catch-all (D1 JSON-parse safety) — never throws", () => {
    const r = parseRoutingRule(row({ conditions_json: "{not json" }));
    expect(r.conditions.groups).toEqual([]);
    expect(r.entry_only).toBe(true);
  });
});

describe("P4a evaluateEntryRouting (pure)", () => {
  it("priority ordering: TWO matching rules, the LOWER priority number (higher precedence) wins", () => {
    const low = parseRoutingRule({
      public_id: "r_low", variant_id: 1, conditions_json: JSON.stringify({ groups: [] }), conditions_hash: "hlow",
      target_funnel_variant_id: 10, value_multiplier: null, priority: 5, status: "active",
    });
    const high = parseRoutingRule({
      public_id: "r_high", variant_id: 1, conditions_json: JSON.stringify({ groups: [] }), conditions_hash: "hhigh",
      target_funnel_variant_id: 20, value_multiplier: null, priority: 50, status: "active",
    });
    // loadRoutingRules ORDER BY priority ASC — simulate that ordering here.
    const match = evaluateEntryRouting([low, high], BASE_CTX);
    expect(match?.target_funnel_variant_id).toBe(10);
    expect(match?.hash).toBe("hlow");
    // Reversed input order — priority (not array order) must still decide.
    const match2 = evaluateEntryRouting([high, low], BASE_CTX);
    expect(match2?.target_funnel_variant_id).toBe(10);
  });

  it("no matching rule -> null (falls through to normal §16 A/B)", () => {
    const rule = parseRoutingRule({
      public_id: "r1", variant_id: 1, conditions_json: JSON.stringify({ groups: [{ field: "state", op: "eq", value: "CA" }] }),
      conditions_hash: "h1", target_funnel_variant_id: 10, value_multiplier: null, priority: 10, status: "active",
    });
    expect(evaluateEntryRouting([rule], { ...BASE_CTX, state: "NY" })).toBeNull();
  });

  it("a rule with a NULL target can never route (skipped even if its conditions match)", () => {
    const rule = parseRoutingRule({
      public_id: "r1", variant_id: 1, conditions_json: JSON.stringify({ groups: [] }), conditions_hash: "h1",
      target_funnel_variant_id: null, value_multiplier: null, priority: 1, status: "active",
    });
    expect(evaluateEntryRouting([rule], BASE_CTX)).toBeNull();
  });

  it("a CHECKPOINT-plane rule (answer field) never matches at the entry plane", () => {
    const rule = parseRoutingRule({
      public_id: "r1", variant_id: 1, conditions_json: JSON.stringify({ groups: [{ field: "age", op: "gte", value: 65 }] }),
      conditions_hash: "h1", target_funnel_variant_id: 10, value_multiplier: null, priority: 1, status: "active",
    });
    expect(evaluateEntryRouting([rule], BASE_CTX)).toBeNull();
  });

  it("utm_campaign is a documented alias of utm_content — a rule authored on either name matches the SAME parsed value", () => {
    const onCampaign = parseRoutingRule({
      public_id: "r1", variant_id: 1, conditions_json: JSON.stringify({ groups: [{ field: "utm_campaign", op: "eq", value: "spring" }] }),
      conditions_hash: "h1", target_funnel_variant_id: 10, value_multiplier: null, priority: 1, status: "active",
    });
    expect(evaluateEntryRouting([onCampaign], { ...BASE_CTX, utm_content: "spring" })?.target_funnel_variant_id).toBe(10);
  });

  // match_mode ANY/ALL (fix round: P4b persists match_mode but nothing read
  // it — an operator's ANY choice silently behaved as ALL on the money path).
  // TWO distinct-field groups (state, device); a context satisfying only ONE.
  it("match_mode='all' (default/unset): a context satisfying only ONE of TWO field groups does NOT match (AND across fields, unchanged)", () => {
    const twoFieldRule = parseRoutingRule({
      public_id: "r1", variant_id: 1,
      conditions_json: JSON.stringify({ groups: [{ field: "state", op: "eq", value: "CA" }, { field: "device", op: "eq", value: "mobile" }] }),
      conditions_hash: "h1", target_funnel_variant_id: 10, value_multiplier: null, priority: 1, status: "active",
      // match_mode omitted entirely — the RoutingRuleRow shape a bare INSERT
      // without the column produces (or a corrupt/legacy value) must behave
      // EXACTLY like "all", never silently becoming ANY.
    });
    expect(evaluateEntryRouting([twoFieldRule], { ...BASE_CTX, state: "CA", device: "desktop" })).toBeNull();
    expect(evaluateEntryRouting([twoFieldRule], { ...BASE_CTX, state: "NY", device: "mobile" })).toBeNull();
    expect(evaluateEntryRouting([twoFieldRule], { ...BASE_CTX, state: "CA", device: "mobile" })?.target_funnel_variant_id).toBe(10);
  });

  it("match_mode='any': a context satisfying EITHER ONE of TWO field groups matches (OR across fields) — routes ONLY because of the fix", () => {
    const anyRule = parseRoutingRule({
      public_id: "r1", variant_id: 1,
      conditions_json: JSON.stringify({ groups: [{ field: "state", op: "eq", value: "CA" }, { field: "device", op: "eq", value: "mobile" }] }),
      conditions_hash: "h1", target_funnel_variant_id: 10, value_multiplier: null, priority: 1, status: "active", match_mode: "any",
    });
    // state matches, device does not — under match_mode='all' this would be
    // null (proved above); under 'any' it routes.
    expect(evaluateEntryRouting([anyRule], { ...BASE_CTX, state: "CA", device: "desktop" })?.target_funnel_variant_id).toBe(10);
    // device matches, state does not — the OTHER field alone is sufficient.
    expect(evaluateEntryRouting([anyRule], { ...BASE_CTX, state: "NY", device: "mobile" })?.target_funnel_variant_id).toBe(10);
    // NEITHER matches — ANY still requires at least one.
    expect(evaluateEntryRouting([anyRule], { ...BASE_CTX, state: "NY", device: "desktop" })).toBeNull();
  });
});

describe("P4a evaluateCheckpointRouting (pure)", () => {
  it("matches over answers UNION entry ctx (an AND across an entry field + an answer field)", () => {
    const rule = parseRoutingRule({
      public_id: "r1", variant_id: 1,
      conditions_json: JSON.stringify({ groups: [{ field: "state", op: "eq", value: "CA" }, { field: "age", op: "gte", value: 65 }] }),
      conditions_hash: "h1", target_funnel_variant_id: 10, value_multiplier: 2.5, priority: 1, status: "active",
    });
    expect(evaluateCheckpointRouting([rule], { ...BASE_CTX, state: "CA" }, { age: 70 })?.target_funnel_variant_id).toBe(10);
    expect(evaluateCheckpointRouting([rule], { ...BASE_CTX, state: "NY" }, { age: 70 })).toBeNull(); // entry field fails
    expect(evaluateCheckpointRouting([rule], { ...BASE_CTX, state: "CA" }, { age: 10 })).toBeNull(); // answer field fails
  });

  it("an ENTRY-only rule never matches at the checkpoint plane (planes are disjoint)", () => {
    const rule = parseRoutingRule({
      public_id: "r1", variant_id: 1, conditions_json: JSON.stringify({ groups: [{ field: "utm_source", op: "eq", value: "fb" }] }),
      conditions_hash: "h1", target_funnel_variant_id: 10, value_multiplier: null, priority: 1, status: "active",
    });
    expect(evaluateCheckpointRouting([rule], { ...BASE_CTX, utm_source: "fb" }, {})).toBeNull();
  });

  it("value_multiplier rides the match (single value, no stacking at the evaluator level)", () => {
    const rule = parseRoutingRule({
      public_id: "r1", variant_id: 1, conditions_json: JSON.stringify({ groups: [{ field: "age", op: "gte", value: 65 }] }),
      conditions_hash: "h1", target_funnel_variant_id: 10, value_multiplier: 3, priority: 1, status: "active",
    });
    expect(evaluateCheckpointRouting([rule], BASE_CTX, { age: 70 })?.value_multiplier).toBe(3);
  });

  // match_mode ANY/ALL at the CHECKPOINT plane (an entry field UNION an
  // answer field — proves the fix applies across BOTH planes, not just entry).
  it("match_mode='all' (default/unset) at checkpoint: satisfying only ONE of {state, age} does NOT match", () => {
    const rule = parseRoutingRule({
      public_id: "r1", variant_id: 1,
      conditions_json: JSON.stringify({ groups: [{ field: "state", op: "eq", value: "CA" }, { field: "age", op: "gte", value: 65 }] }),
      conditions_hash: "h1", target_funnel_variant_id: 10, value_multiplier: null, priority: 1, status: "active",
    });
    expect(evaluateCheckpointRouting([rule], { ...BASE_CTX, state: "CA" }, { age: 10 })).toBeNull();
    expect(evaluateCheckpointRouting([rule], { ...BASE_CTX, state: "NY" }, { age: 70 })).toBeNull();
    expect(evaluateCheckpointRouting([rule], { ...BASE_CTX, state: "CA" }, { age: 70 })?.target_funnel_variant_id).toBe(10);
  });

  it("match_mode='any' at checkpoint: satisfying EITHER ONE of {state, age} matches — routes ONLY because of the fix", () => {
    const rule = parseRoutingRule({
      public_id: "r1", variant_id: 1,
      conditions_json: JSON.stringify({ groups: [{ field: "state", op: "eq", value: "CA" }, { field: "age", op: "gte", value: 65 }] }),
      conditions_hash: "h1", target_funnel_variant_id: 10, value_multiplier: null, priority: 1, status: "active", match_mode: "any",
    });
    // state matches, age does not (proved null under 'all' above).
    expect(evaluateCheckpointRouting([rule], { ...BASE_CTX, state: "CA" }, { age: 10 })?.target_funnel_variant_id).toBe(10);
    // age matches, state does not.
    expect(evaluateCheckpointRouting([rule], { ...BASE_CTX, state: "NY" }, { age: 70 })?.target_funnel_variant_id).toBe(10);
    // neither matches.
    expect(evaluateCheckpointRouting([rule], { ...BASE_CTX, state: "NY" }, { age: 10 })).toBeNull();
  });
});

// A minimal 3-page ResolvedFunnelPage fixture (age question on page 0, a
// middle marker on page 1, a final section on page 2) for the checkpoint-page
// derivation + resume tests below.
function threePageFixture(): { pages: ResolvedFunnelPage[]; ids: { age: string; mid: string; fin: string } } {
  const ageSection = { id: 1, public_id: "lgs_age", content_json: JSON.stringify({ components: [{ type: "TextInput", question_id: "q_age", internal_field: "age", required: true }] }) } as never;
  const midSection = { id: 2, public_id: "lgs_mid", content_json: JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "q_mid", internal_field: "mid_field", required: true }] }) } as never;
  const finSection = { id: 3, public_id: "lgs_fin", content_json: JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "q_fin", internal_field: "fin_field" }] }) } as never;
  const pages: ResolvedFunnelPage[] = [
    { id: 1, public_id: "lgpg_0", position: 0, name: null, slots: [{ id: 1, position: 0, slot_revision: 0, rules: null, ab_allocations: null, candidates: [{ variant_section_id: 1, section: ageSection }] }] },
    { id: 2, public_id: "lgpg_1", position: 1, name: null, slots: [{ id: 2, position: 0, slot_revision: 0, rules: null, ab_allocations: null, candidates: [{ variant_section_id: 2, section: midSection }] }] },
    { id: 3, public_id: "lgpg_2", position: 2, name: null, slots: [{ id: 3, position: 0, slot_revision: 0, rules: null, ab_allocations: null, candidates: [{ variant_section_id: 3, section: finSection }] }] },
  ];
  return { pages, ids: { age: "lgs_age", mid: "lgs_mid", fin: "lgs_fin" } };
}

describe("P4a deriveCheckpointPages + checkpointPageAnchors (pure, answer-field page mapping)", () => {
  it("a rule on `age` derives to page 0 (where `age` is answered) — anchor is lgs_age", () => {
    const { pages } = threePageFixture();
    const rule = parseRoutingRule({
      public_id: "r1", variant_id: 1, conditions_json: JSON.stringify({ groups: [{ field: "age", op: "gte", value: 65 }] }),
      conditions_hash: "h1", target_funnel_variant_id: 10, value_multiplier: null, priority: 1, status: "active",
    });
    const pageNumbers = deriveCheckpointPages(pages, [rule]);
    expect(pageNumbers).toEqual([0]);
    const planPages: ResolvedPagePlanEntry[] = [
      { page_id: "lgpg_0", section_public_ids: ["lgs_age"] },
      { page_id: "lgpg_1", section_public_ids: ["lgs_mid"] },
      { page_id: "lgpg_2", section_public_ids: ["lgs_fin"] },
    ];
    expect(checkpointPageAnchors(pageNumbers, planPages)).toEqual(["lgs_age"]);
  });

  it("a rule on `mid_field` derives to page 1 (a LATER page than a rule on `age`)", () => {
    const { pages } = threePageFixture();
    const rule = parseRoutingRule({
      public_id: "r1", variant_id: 1, conditions_json: JSON.stringify({ groups: [{ field: "mid_field", op: "eq", value: true }] }),
      conditions_hash: "h1", target_funnel_variant_id: 10, value_multiplier: null, priority: 1, status: "active",
    });
    expect(deriveCheckpointPages(pages, [rule])).toEqual([1]);
  });

  it("an ENTRY-only rule contributes NO checkpoint page (it's evaluated at entry, not mid-funnel)", () => {
    const { pages } = threePageFixture();
    const rule = parseRoutingRule({
      public_id: "r1", variant_id: 1, conditions_json: JSON.stringify({ groups: [{ field: "state", op: "eq", value: "CA" }] }),
      conditions_hash: "h1", target_funnel_variant_id: 10, value_multiplier: null, priority: 1, status: "active",
    });
    expect(deriveCheckpointPages(pages, [rule])).toEqual([]);
  });

  it("TWO checkpoint rules on DIFFERENT pages produce a DISTINCT, sorted set of pages", () => {
    const { pages } = threePageFixture();
    const onAge = parseRoutingRule({
      public_id: "r1", variant_id: 1, conditions_json: JSON.stringify({ groups: [{ field: "age", op: "gte", value: 65 }] }),
      conditions_hash: "h1", target_funnel_variant_id: 10, value_multiplier: null, priority: 1, status: "active",
    });
    const onMid = parseRoutingRule({
      public_id: "r2", variant_id: 1, conditions_json: JSON.stringify({ groups: [{ field: "mid_field", op: "eq", value: true }] }),
      conditions_hash: "h2", target_funnel_variant_id: 20, value_multiplier: null, priority: 1, status: "active",
    });
    expect(deriveCheckpointPages(pages, [onAge, onMid])).toEqual([0, 1]);
  });

  it("a rule referencing an answer field NOT present on any page falls back to the LAST page (never unevaluated)", () => {
    const { pages } = threePageFixture();
    const rule = parseRoutingRule({
      public_id: "r1", variant_id: 1, conditions_json: JSON.stringify({ groups: [{ field: "no_such_field", op: "eq", value: 1 }] }),
      conditions_hash: "h1", target_funnel_variant_id: 10, value_multiplier: null, priority: 1, status: "active",
    });
    expect(deriveCheckpointPages(pages, [rule])).toEqual([2]);
  });

  it("no checkpoint-plane rules at all -> empty (the common, non-routing-funnel case)", () => {
    const { pages } = threePageFixture();
    expect(deriveCheckpointPages(pages, [])).toEqual([]);
  });
});

describe("P4a detectRoutingRuleConflicts (pure, save-time Problems mechanism)", () => {
  it("SAME priority + SAME checkpoint (both entry) + OVERLAPPING fields -> a plain-language conflict message", () => {
    const msgs = detectRoutingRuleConflicts([
      { rule_name: "Facebook route", checkpoint_page: null, priority: 10, fields: ["utm_source"] },
      { rule_name: "Google route", checkpoint_page: null, priority: 10, fields: ["utm_source", "state"] },
    ]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("Facebook route");
    expect(msgs[0]).toContain("Google route");
    expect(msgs[0]?.toLowerCase()).not.toMatch(/error|exception|null|undefined/); // jargon-free
  });

  it("a DISTINCT priority resolves the order deterministically -> NO conflict", () => {
    const msgs = detectRoutingRuleConflicts([
      { rule_name: "A", checkpoint_page: null, priority: 1, fields: ["utm_source"] },
      { rule_name: "B", checkpoint_page: null, priority: 2, fields: ["utm_source"] },
    ]);
    expect(msgs).toHaveLength(0);
  });

  it("the SAME priority at DIFFERENT checkpoints never race (different evaluation points) -> NO conflict", () => {
    const msgs = detectRoutingRuleConflicts([
      { rule_name: "A", checkpoint_page: 0, priority: 5, fields: ["age"] },
      { rule_name: "B", checkpoint_page: 1, priority: 5, fields: ["age"] },
    ]);
    expect(msgs).toHaveLength(0);
  });

  it("the SAME priority + checkpoint but NO overlapping fields -> NO conflict", () => {
    const msgs = detectRoutingRuleConflicts([
      { rule_name: "A", checkpoint_page: 0, priority: 5, fields: ["age"] },
      { rule_name: "B", checkpoint_page: 0, priority: 5, fields: ["homeowner"] },
    ]);
    expect(msgs).toHaveLength(0);
  });
});

describe("P4a computeResumeSection (pure, prefix-rule resume)", () => {
  it("the FIRST page with an unanswered required field is the resume point", () => {
    const { pages } = threePageFixture();
    const winners = [
      { page_id: "lgpg_0", slot_id: 1, section_public_id: "lgs_age", assignment_reason: "fixed" as const },
      { page_id: "lgpg_1", slot_id: 2, section_public_id: "lgs_mid", assignment_reason: "fixed" as const },
      { page_id: "lgpg_2", slot_id: 3, section_public_id: "lgs_fin", assignment_reason: "fixed" as const },
    ];
    // age answered (carried over), mid_field NOT answered -> resume at lgs_mid.
    expect(computeResumeSection(winners, pages, { age: 70 })).toBe("lgs_mid");
  });

  it("EVERY required field already satisfied -> \"\" (straight to auction, never a question repeat)", () => {
    const { pages } = threePageFixture();
    const winners = [
      { page_id: "lgpg_0", slot_id: 1, section_public_id: "lgs_age", assignment_reason: "fixed" as const },
      { page_id: "lgpg_1", slot_id: 2, section_public_id: "lgs_mid", assignment_reason: "fixed" as const },
    ];
    expect(computeResumeSection(winners, pages, { age: 70, mid_field: true })).toBe("");
  });

  it("a target plan with NO required fields anywhere -> \"\" immediately", () => {
    const { pages } = threePageFixture();
    const winners = [{ page_id: "lgpg_2", slot_id: 3, section_public_id: "lgs_fin", assignment_reason: "fixed" as const }];
    expect(computeResumeSection(winners, pages, {})).toBe(""); // fin_field is NOT required
  });
});

// §15.5 redirect_pct — session-sticky percentage gate (fix round: 0044 makes
// the column real; funnel.ts's shouldRedirectForSession/redirectPctBucket are
// the reusable, pure bucketing primitives — see the phase report for the
// runtime-wiring seam this does NOT cover, api/src/public/leadgen/auction/
// engine.ts, which is outside this slice's ownership).
describe("P4a redirect_pct (pure, funnel.ts shouldRedirectForSession/redirectPctBucket)", () => {
  it("pct=0 NEVER redirects — across many distinct sessions", () => {
    for (let i = 0; i < 50; i++) {
      expect(shouldRedirectForSession(0, "rule-a", `sess-${i}`)).toBe(false);
    }
  });

  it("unset column (null/undefined) NEVER redirects — §15.5 `redirect_pct ?? 0`", () => {
    expect(shouldRedirectForSession(null, "rule-a", "sess-1")).toBe(false);
    expect(shouldRedirectForSession(undefined, "rule-a", "sess-1")).toBe(false);
  });

  it("a negative pct (defensive — validation should reject it upstream, but the gate itself must still fail-safe) NEVER redirects", () => {
    expect(shouldRedirectForSession(-5, "rule-a", "sess-1")).toBe(false);
  });

  it("pct=100 ALWAYS redirects — across many distinct sessions", () => {
    for (let i = 0; i < 50; i++) {
      expect(shouldRedirectForSession(100, "rule-a", `sess-${i}`)).toBe(true);
    }
  });

  it("pct=50 is SESSION-STICKY: the SAME session + rule always gets the SAME verdict across repeated calls", () => {
    const first = shouldRedirectForSession(50, "rule-a", "sess-sticky-1");
    for (let i = 0; i < 10; i++) {
      expect(shouldRedirectForSession(50, "rule-a", "sess-sticky-1")).toBe(first);
    }
  });

  it("pct=50 approximates a roughly-even split across MANY distinct sessions (statistical, not exact)", () => {
    let redirected = 0;
    const total = 2000;
    for (let i = 0; i < total; i++) {
      if (shouldRedirectForSession(50, "rule-a", `sess-bulk-${i}`)) redirected++;
    }
    // Generous tolerance band (a uniform-hash split, not a coin-flip RNG) —
    // this asserts "roughly half", not a precise ratio.
    expect(redirected).toBeGreaterThan(total * 0.35);
    expect(redirected).toBeLessThan(total * 0.65);
  });

  it("DIFFERENT rule keys draw INDEPENDENT buckets for the SAME session (no forced correlation between two redirect rules, or with an A/B test)", () => {
    let sameVerdictCount = 0;
    const total = 200;
    for (let i = 0; i < total; i++) {
      const sessionId = `sess-indep-${i}`;
      const a = shouldRedirectForSession(50, "rule-a", sessionId);
      const b = shouldRedirectForSession(50, "rule-b", sessionId);
      if (a === b) sameVerdictCount++;
    }
    // Independent 50/50 buckets agree ~half the time; a broken implementation
    // that ignores ruleKey would agree 100% of the time (identical digest).
    expect(sameVerdictCount).toBeLessThan(total); // not IDENTICAL for every session
  });

  it("redirectPctBucket is a pure function of exactly (ruleKey, sessionId): identical inputs -> identical bucket, in 0..9999", () => {
    const b1 = redirectPctBucket("rule-x", "sess-1");
    const b2 = redirectPctBucket("rule-x", "sess-1");
    expect(b1).toBe(b2);
    expect(b1).toBeGreaterThanOrEqual(0);
    expect(b1).toBeLessThan(10000);
  });
});

// ===========================================================================
// DB integration — entry routing precedence over §16 A/B
// ===========================================================================

describeDb("P4a entry routing — DB integration (precedence over A/B)", () => {
  it("a matched ENTRY rule serves its target variant EVEN WITH a running A/B test that would otherwise bucket elsewhere", async () => {
    const { sdb, env } = newHarness();
    const { quotePublicId, variantId, funnelId } = await seedQuote(env);
    const controlRowId = variantRowId(sdb, variantId);
    const funnelRowId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(funnelId) as { id: number }).id;
    const targetPublicId = seedSiblingVariant(sdb, funnelRowId, "B", false);
    const targetRowId = variantRowId(sdb, targetPublicId);

    // A RUNNING A/B test spanning BOTH variants — without the routing rule this
    // would deterministically bucket SOME sessions onto the control.
    sdb.prepare("INSERT INTO leadgen_funnel_ab_tests (public_id, funnel_id, name, revision, status, started_at) VALUES ('lgx_p4a', ?, 'T', 1, 'running', unixepoch())").run(funnelRowId);

    seedRoutingRule(sdb, controlRowId, {
      conditions: { groups: [{ field: "utm_source", op: "eq", value: "facebook" }] },
      targetVariantId: targetRowId,
      priority: 1,
    });
    await activate(env, quotePublicId);

    const resolved = await resolveActivatedFunnel(env, {
      site_id: "site-1",
      session_id: "sess-p4a-entry",
      entry_ctx: { ...BASE_CTX, utm_source: "facebook" },
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.variant.public_id).toBe(targetPublicId);
    expect(resolved!.assignment.assignment_reason).toBe("single_control");
    expect(resolved!.assignment.routing_rule_hash).toBeTruthy();
  });

  it("priority ordering resolved from the DB: the LOWER-priority-number rule's target wins", async () => {
    const { sdb, env } = newHarness();
    const { quotePublicId, variantId, funnelId } = await seedQuote(env);
    const controlRowId = variantRowId(sdb, variantId);
    const funnelRowId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(funnelId) as { id: number }).id;
    const targetLow = seedSiblingVariant(sdb, funnelRowId, "Low", false);
    const targetHigh = seedSiblingVariant(sdb, funnelRowId, "High", false);

    seedRoutingRule(sdb, controlRowId, { conditions: { groups: [] }, targetVariantId: variantRowId(sdb, targetHigh), priority: 50 });
    seedRoutingRule(sdb, controlRowId, { conditions: { groups: [] }, targetVariantId: variantRowId(sdb, targetLow), priority: 5 });
    await activate(env, quotePublicId);

    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1", session_id: "s1", entry_ctx: BASE_CTX });
    expect(resolved!.variant.public_id).toBe(targetLow);
  });

  it("NO matching entry rule -> the ordinary single_control path (byte-identical to pre-P4a)", async () => {
    const { sdb, env } = newHarness();
    const { quotePublicId, variantId, funnelId } = await seedQuote(env);
    const funnelRowId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(funnelId) as { id: number }).id;
    const target = seedSiblingVariant(sdb, funnelRowId, "B", false);
    seedRoutingRule(sdb, variantRowId(sdb, variantId), {
      conditions: { groups: [{ field: "utm_source", op: "eq", value: "facebook" }] },
      targetVariantId: variantRowId(sdb, target),
      priority: 1,
    });
    await activate(env, quotePublicId);

    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1", session_id: "s1", entry_ctx: { ...BASE_CTX, utm_source: "google" } });
    expect(resolved!.variant.public_id).toBe(variantId); // the ORIGINAL control, unrouted
    expect(resolved!.assignment.routing_rule_hash).toBeUndefined();
  });

  it("absent entry_ctx (preview / reverse config lookups) skips routing entirely -- pure §16 path", async () => {
    const { sdb, env } = newHarness();
    const { quotePublicId, variantId, funnelId } = await seedQuote(env);
    const funnelRowId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(funnelId) as { id: number }).id;
    const target = seedSiblingVariant(sdb, funnelRowId, "B", false);
    seedRoutingRule(sdb, variantRowId(sdb, variantId), { conditions: { groups: [] }, targetVariantId: variantRowId(sdb, target), priority: 1 });
    await activate(env, quotePublicId);

    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1", session_id: "s1" }); // no entry_ctx
    expect(resolved!.variant.public_id).toBe(variantId);
  });

  // match_mode ROUND-TRIPS through the REAL SQL SELECT (loadRoutingRules),
  // not just the pure parseRoutingRule unit tests above. A 2-field ANY rule
  // where the request satisfies only ONE field must still route end-to-end.
  it("match_mode='any' persisted + read via the REAL DB query routes on a partial (one-of-two) field match", async () => {
    const { sdb, env } = newHarness();
    const { quotePublicId, variantId, funnelId } = await seedQuote(env);
    const controlRowId = variantRowId(sdb, variantId);
    const funnelRowId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(funnelId) as { id: number }).id;
    const target = seedSiblingVariant(sdb, funnelRowId, "B", false);
    seedRoutingRule(sdb, controlRowId, {
      conditions: { groups: [{ field: "utm_source", op: "eq", value: "facebook" }, { field: "state", op: "eq", value: "CA" }] },
      targetVariantId: variantRowId(sdb, target),
      priority: 1,
      matchMode: "any",
    });
    await activate(env, quotePublicId);

    // utm_source matches, state does not — 'all' would reject this; 'any' routes.
    const resolved = await resolveActivatedFunnel(env, {
      site_id: "site-1",
      session_id: "s1",
      entry_ctx: { ...BASE_CTX, utm_source: "facebook", state: "NY" },
    });
    expect(resolved!.variant.public_id).toBe(target);
  });
});

// ===========================================================================
// The full /lg/ck HTTP endpoint
// ===========================================================================

interface CheckpointSeed {
  env: Env;
  sdb: SqliteDb;
  quotePublicId: string;
  entryVariantId: string;
  targetVariantId: string;
  ageSectionId: string;
  midSectionId: string;
  finSectionId: string;
}

// Entry variant (3 pages: age/mid/fin) + target variant (2 pages: age/fin --
// reuses the SAME leadgen_sections rows so the pages are share-compatible),
// activated, with ONE checkpoint rule (age >= 65 -> target) on the entry
// variant. Mirrors the Playwright spec's design (documented there) so a
// switch is renderable client-side (the target's winning sections are a
// SUBSET of the entry variant's own candidate catalog).
async function seedCheckpointFunnel(opts?: { multiplier?: number | null; requireFin?: boolean }): Promise<CheckpointSeed> {
  const { sdb, env } = newHarness();
  const { quotePublicId, variantId, funnelId } = await seedQuote(env);
  const age = seedSection(sdb, "age", { required: true, field: "age" });
  const mid = seedSection(sdb, "mid", { required: true, field: "mid_field" });
  const fin = seedSection(sdb, "fin", { required: opts?.requireFin === true, field: "fin_field" });

  const entryRowId = variantRowId(sdb, variantId);
  attachSection(sdb, entryRowId, age.id, 0);
  attachSection(sdb, entryRowId, mid.id, 1);
  attachSection(sdb, entryRowId, fin.id, 2);

  const funnelRowId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(funnelId) as { id: number }).id;
  const targetPublicId = seedSiblingVariant(sdb, funnelRowId, "Senior", false);
  const targetRowId = variantRowId(sdb, targetPublicId);
  attachSection(sdb, targetRowId, age.id, 0); // SAME underlying section row as the entry variant's page 0
  attachSection(sdb, targetRowId, fin.id, 1); // skips `mid` entirely

  seedRoutingRule(sdb, entryRowId, {
    conditions: { groups: [{ field: "age", op: "gte", value: 65 }] },
    targetVariantId: targetRowId,
    priority: 10,
    multiplier: opts?.multiplier === undefined ? 2.0 : opts.multiplier,
    name: "Senior route",
  });
  await activate(env, quotePublicId);
  return {
    env, sdb, quotePublicId,
    entryVariantId: variantId, targetVariantId: targetPublicId,
    ageSectionId: age.public_id, midSectionId: mid.public_id, finSectionId: fin.public_id,
  };
}

interface MintedAttempt {
  funnel_attempt_id: string;
  signed_config_token: string;
  session_id: string;
}

async function mintAttempt(env: Env, variantId: string): Promise<MintedAttempt> {
  const res = await get(env, `/lg/attempt?vid=${variantId}`);
  expect(res.status, `mint attempt: ${await res.clone().text()}`).toBe(200);
  const body = (await res.json()) as { funnel_attempt_id: string; signed_config_token: string; session_id: string };
  return body;
}

describeDb("P4a /lg/ck — full HTTP flow", () => {
  it("age >= 65 MATCHES: switched=true, re-issued binding, target's OWN plan, resume at the target's first unanswered required page", async () => {
    const seed = await seedCheckpointFunnel();
    const attempt = await mintAttempt(seed.env, seed.entryVariantId);

    const res = await post(seed.env, "/lg/ck", {
      k: attempt.signed_config_token,
      f: attempt.funnel_attempt_id,
      v: seed.entryVariantId,
      s: attempt.session_id,
      a: { age: { value: 70 } },
    });
    expect(res.status, `checkpoint: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as {
      sw: boolean; k: string; v: string; so: string; cv: number;
      ar: string; pp: Array<{ section_public_id: string }>; r: string;
    };
    expect(body.sw).toBe(true);
    expect(body.v).toBe(seed.targetVariantId);
    expect(body.k).not.toBe(attempt.signed_config_token); // a FRESH re-issued binding
    expect(body.ar).toMatch(/^routing_rule:/);
    // The target's OWN plan: [age, fin] -- `mid` is never a winner post-switch.
    expect(body.pp.map((w) => w.section_public_id)).toEqual([seed.ageSectionId, seed.finSectionId]);
    // age is already answered (carried); fin has no required field in this
    // seed (requireFin defaults false) -> resume straight to auction.
    expect(body.r).toBe("");

    // Server-authoritative outcome recorded, keyed by the SAME attempt id.
    const outcome = seed.sdb
      .prepare("SELECT routed_from_variant, routed_to_variant, plane, value_multiplier FROM leadgen_routing_outcomes WHERE funnel_attempt_id = ?")
      .get(attempt.funnel_attempt_id) as { routed_from_variant: string; routed_to_variant: string; plane: string; value_multiplier: number };
    expect(outcome.routed_from_variant).toBe(seed.entryVariantId);
    expect(outcome.routed_to_variant).toBe(seed.targetVariantId);
    expect(outcome.plane).toBe("checkpoint");
    expect(outcome.value_multiplier).toBe(2.0);
  });

  it("resume lands ON the target's remaining required page when one is unanswered (not '' )", async () => {
    const seed = await seedCheckpointFunnel({ requireFin: true }); // target's `fin` page now REQUIRED
    const attempt = await mintAttempt(seed.env, seed.entryVariantId);
    const res = await post(seed.env, "/lg/ck", {
      k: attempt.signed_config_token, f: attempt.funnel_attempt_id, v: seed.entryVariantId,
      s: attempt.session_id, a: { age: { value: 70 } },
    });
    const body = (await res.json()) as { sw: boolean; r: string };
    expect(body.sw).toBe(true);
    expect(body.r).toBe(seed.finSectionId); // fin is unanswered + required -> prefix-rule resume there
  });

  it("age < 65 does NOT match: sw:false, ZERO effects (no outcome row written)", async () => {
    const seed = await seedCheckpointFunnel();
    const attempt = await mintAttempt(seed.env, seed.entryVariantId);
    const res = await post(seed.env, "/lg/ck", {
      k: attempt.signed_config_token, f: attempt.funnel_attempt_id, v: seed.entryVariantId,
      s: attempt.session_id, a: { age: { value: 20 } },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sw: boolean };
    expect(body.sw).toBe(false);
    // node:sqlite's raw .get() returns `undefined` (not `null`) for no row.
    const outcome = seed.sdb.prepare("SELECT * FROM leadgen_routing_outcomes WHERE funnel_attempt_id = ?").get(attempt.funnel_attempt_id);
    expect(outcome).toBeUndefined();
  });

  it("≤1 HOP: a SECOND checkpoint POST on the SAME attempt after a successful switch is refused (sw:false, no second outcome row)", async () => {
    const seed = await seedCheckpointFunnel();
    const attempt = await mintAttempt(seed.env, seed.entryVariantId);
    const first = await post(seed.env, "/lg/ck", {
      k: attempt.signed_config_token, f: attempt.funnel_attempt_id, v: seed.entryVariantId,
      s: attempt.session_id, a: { age: { value: 70 } },
    });
    expect(((await first.clone().json()) as { sw: boolean }).sw).toBe(true);

    // A second POST -- even resending the ORIGINAL (pre-switch) binding, the
    // most plausible client retry shape -- must be refused by the SERVER'S
    // OWN ≤1-hop check (leadgen_routing_outcomes already carries a
    // 'checkpoint' row for this funnel_attempt_id), independent of any
    // client-side `rtd` bookkeeping.
    const second = await post(seed.env, "/lg/ck", {
      k: attempt.signed_config_token, f: attempt.funnel_attempt_id, v: seed.entryVariantId,
      s: attempt.session_id, a: { age: { value: 70 } },
    });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { sw: boolean }).sw).toBe(false);

    const rows = seed.sdb.prepare("SELECT COUNT(*) as n FROM leadgen_routing_outcomes WHERE funnel_attempt_id = ?").get(attempt.funnel_attempt_id) as { n: number };
    expect(rows.n).toBe(1); // exactly one outcome row, never a second
  });

  it("BINDING VALIDATION: a forged signed_config_token is rejected 422 tampered with ZERO effects (no rule evaluation, no DB write)", async () => {
    const seed = await seedCheckpointFunnel();
    const attempt = await mintAttempt(seed.env, seed.entryVariantId);
    const res = await post(seed.env, "/lg/ck", {
      k: "v2.forged-payload.forged-signature",
      f: attempt.funnel_attempt_id,
      v: seed.entryVariantId,
      s: attempt.session_id,
      a: { age: { value: 70 } }, // even a would-MATCH age -- must never be evaluated
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; traffic_quality_flag: string };
    expect(body.traffic_quality_flag).toBe("tampered");
    // node:sqlite's raw .get() returns `undefined` (not `null`) for no row.
    const outcome = seed.sdb.prepare("SELECT * FROM leadgen_routing_outcomes WHERE funnel_attempt_id = ?").get(attempt.funnel_attempt_id);
    expect(outcome).toBeUndefined(); // zero effects
  });

  it("BINDING VALIDATION: a token minted for a DIFFERENT session_id is rejected 422 (session is v2 crypto-bound)", async () => {
    const seed = await seedCheckpointFunnel();
    const attempt = await mintAttempt(seed.env, seed.entryVariantId);
    const res = await post(seed.env, "/lg/ck", {
      k: attempt.signed_config_token,
      f: attempt.funnel_attempt_id,
      v: seed.entryVariantId,
      s: "some-other-session-id", // tampered session claim
      a: { age: { value: 70 } },
    });
    expect(res.status).toBe(422);
  });

  it("a `__`-prefixed synthetic answer key can NEVER inject an entry attribute into rule evaluation (server re-normalizes, drops it)", async () => {
    const seed = await seedCheckpointFunnel();
    const attempt = await mintAttempt(seed.env, seed.entryVariantId);
    // A rule on `age` should NOT be satisfiable via a client-forged `__state`
    // masquerading as an answer -- confirm the age-gated rule still requires
    // a REAL age answer (this posts NO age at all, only a synthetic key).
    const res = await post(seed.env, "/lg/ck", {
      k: attempt.signed_config_token, f: attempt.funnel_attempt_id, v: seed.entryVariantId,
      s: attempt.session_id, a: { __state: "CA", __age: 70 },
    });
    const body = (await res.json()) as { sw: boolean };
    expect(body.sw).toBe(false); // no REAL `age` answer -> the age>=65 rule cannot match
  });
});

// ===========================================================================
// §19-step-4 plane reconciliation
// ===========================================================================

describeDb("P4a §19-step-4 plane reconciliation", () => {
  it("the target variant's OWN non-routing leadgen_funnel_rules are a DISTINCT set from the origin's -- whichever funnel_variant_id /lg/auction resolves for (the target, post-switch) naturally sees ITS OWN rules via the untouched resolveActivatedFunnelByVariant", async () => {
    const seed = await seedCheckpointFunnel();
    const originRowId = variantRowId(seed.sdb, seed.entryVariantId);
    const targetRowId = variantRowId(seed.sdb, seed.targetVariantId);

    // A §15.5 non-routing rule (existing type, untouched by P4a) on EACH
    // variant, DISTINCT conditions -- simulating an admin having configured
    // per-variant redirect/eligibility rules independently.
    seed.sdb.prepare(
      "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority, enabled) VALUES ('lgfr_origin','" + originRowId + "','eligibility','{\"groups\":[]}','h_origin',1,1)",
    ).run();
    seed.sdb.prepare(
      "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority, enabled) VALUES ('lgfr_target','" + targetRowId + "','eligibility','{\"groups\":[]}','h_target',1,1)",
    ).run();

    // Perform the switch (proving the checkpoint response correctly names the
    // TARGET's variant id -- the ONLY input serve-auction.ts's UNMODIFIED
    // resolveActivatedFunnelByVariant needs to key its OWN §19-step-4 rule
    // read by).
    const attempt = await mintAttempt(seed.env, seed.entryVariantId);
    const ckpt = await post(seed.env, "/lg/ck", {
      k: attempt.signed_config_token, f: attempt.funnel_attempt_id, v: seed.entryVariantId,
      s: attempt.session_id, a: { age: { value: 70 } },
    });
    const ckptBody = (await ckpt.json()) as { sw: boolean; v: string };
    expect(ckptBody.sw).toBe(true);
    expect(ckptBody.v).toBe(seed.targetVariantId);

    // The rule set keyed by the RESOLVED (target) variant is the TARGET's OWN
    // row, never the origin's -- resolveActivatedFunnelByVariant is the exact
    // reverse lookup serve-auction.ts calls with `body.funnel_variant_id`.
    const resolvedTarget = await resolveActivatedFunnelByVariant(seed.env, "site-1", ckptBody.v);
    expect(resolvedTarget).not.toBeNull();
    const targetRules = seed.sdb
      .prepare("SELECT public_id FROM leadgen_funnel_rules WHERE variant_id = (SELECT id FROM leadgen_funnel_variants WHERE public_id = ?) AND rule_type != 'route_funnel_variant'")
      .all(resolvedTarget!.variant.public_id) as Array<{ public_id: string }>;
    expect(targetRules.map((r) => r.public_id)).toEqual(["lgfr_target"]); // never lgfr_origin

    // And post-switch, a REAL /lg/auction POST (the existing, untouched
    // endpoint) accepts the re-issued binding for the TARGET without a 404 —
    // proving the auction pipeline's OWN reverse resolution recognizes it as
    // a servable variant of this activated funnel.
    const auctionRes = await post(seed.env, "/lg/auction", {
      funnel_variant_id: ckptBody.v,
      funnel_attempt_id: attempt.funnel_attempt_id,
      signed_config_token: (ckptBody as unknown as { k: string }).k,
      content_version: (ckptBody as unknown as { cv: number }).cv,
      section_order_hash: (ckptBody as unknown as { so: string }).so,
      session_id: attempt.session_id,
      answers: {},
    });
    expect(auctionRes.status, `auction post-switch: ${await auctionRes.clone().text()}`).not.toBe(404);
  });
});

// ===========================================================================
// redirect_pct WIRED at the auction layer (auction/engine.ts step 4, granted
// extension) + rule-status/enabled coherence (both evaluation planes)
// ===========================================================================

interface FullAttempt {
  funnel_attempt_id: string;
  signed_config_token: string;
  session_id: string;
  content_version: number;
  section_order_hash: string;
}

// Mints a REAL, fully-signed attempt via the real /lg/attempt route —
// optionally pinning session_id via the ko_sid cookie the route reads first
// (m2: readCookie(...) wins over minting a fresh one), so a redirect_pct
// sticky-split test can drive MANY distinct sessions. mintFunnelAttempt's OWN
// return shape is deliberately narrow ({funnel_attempt_id, signed_config_token,
// ...}) — content_version/section_order_hash are NEVER echoed there (they
// live only inside the signed token's payload; a real browser reads them from
// the /lg SHELL's config instead). /lg/auction's anti-tamper recomputes its
// expected section_order_hash from a FRESH resolveActivatedFunnelByVariant —
// so this helper derives the SAME two values the SAME way, rather than
// (wrongly) expecting the mint response to carry them.
async function mintFullAttempt(env: Env, variantId: string, sessionId?: string): Promise<FullAttempt> {
  const headers: Record<string, string> = sessionId !== undefined ? { Cookie: `ko_sid=${sessionId}` } : {};
  const res = await app.request(`${TENANT_ORIGIN}/lg/attempt?vid=${variantId}`, { headers }, env);
  expect(res.status, `mint full attempt: ${await res.clone().text()}`).toBe(200);
  const body = (await res.json()) as { funnel_attempt_id: string; signed_config_token: string; session_id: string };
  const resolved = await resolveActivatedFunnelByVariant(env, "site-1", variantId);
  if (resolved === null) throw new Error(`mintFullAttempt: variant ${variantId} did not resolve`);
  return {
    funnel_attempt_id: body.funnel_attempt_id,
    signed_config_token: body.signed_config_token,
    session_id: body.session_id,
    content_version: resolved.variant.content_version,
    section_order_hash: computeSectionOrderHash(resolved),
  };
}

// Drives the REAL, untouched /lg/auction endpoint (serve-auction.ts ->
// runAuction) with a validly-signed attempt — the actual runtime path a
// browser's engine takes, not a hand-built AuctionBundle.
async function postAuction(env: Env, variantId: string, a: FullAttempt): Promise<{ status: string }> {
  const res = await post(env, "/lg/auction", {
    funnel_variant_id: variantId,
    funnel_attempt_id: a.funnel_attempt_id,
    signed_config_token: a.signed_config_token,
    content_version: a.content_version,
    section_order_hash: a.section_order_hash,
    session_id: a.session_id,
    answers: {},
  });
  expect(res.status, `auction: ${await res.clone().text()}`).not.toBe(404);
  return (await res.json()) as { status: string };
}

// A fresh seedQuote() variant has auction_id=NULL — serve-auction.ts short-
// circuits to status:"no_auction" BEFORE step 4 (funnel rules) ever runs.
// Minimal §19 auction row (leadgen-auction-runtime.test.ts's seedAuction
// column set) + link it onto the variant so runAuction's step 4 is actually
// reached. No offers needed: a redirect_direct_offer match returns at step 4,
// before step 5 (offer participation) is ever evaluated.
function seedMinimalAuction(sdb: SqliteDb, variantRowId: number): void {
  const publicId = mintPublicId("auction");
  sdb
    .prepare(
      `INSERT INTO leadgen_auctions
         (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
          surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
          backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
       VALUES (?, 'P4a redirect_pct test auction', 'dynamic', 'highest_bid', 'percentage_of_max', 10, 'enabled',
               1, 5, 3, 10, 'disabled', 'on_slot_exhaustion', 0, 'offer', 2500, 1, 'active')`,
    )
    .run(publicId);
  const auctionRowId = (sdb.prepare("SELECT id FROM leadgen_auctions WHERE public_id = ?").get(publicId) as { id: number }).id;
  sdb.prepare("UPDATE leadgen_funnel_variants SET auction_id = ? WHERE id = ?").run(auctionRowId, variantRowId);
}

// Raw-SQL §15.5 redirect_direct_offer rule seeding, matching ALL traffic
// (empty conditions groups) — isolates the redirect_pct gate as the ONLY
// variable under test. enabled/status default to the coherent "on" state;
// callers exercising the coherence fix override them explicitly.
function seedRedirectRule(sdb: SqliteDb, variantId: number, opts: { pct?: number | null; enabled?: number; status?: string }): void {
  sdb
    .prepare(
      `INSERT INTO leadgen_funnel_rules
         (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority, enabled, status, redirect_pct)
       VALUES (?, ?, 'redirect_direct_offer', '{"groups":[]}', ?, 1, ?, ?, ?)`,
    )
    .run(mintPublicId("funnel_rule"), variantId, `h_${Math.random()}`, opts.enabled ?? 1, opts.status ?? "active", opts.pct ?? null);
}

describeDb("P4a redirect_pct WIRED at the auction layer (real /lg/auction -> runAuction -> step 4)", () => {
  it("pct=0 NEVER redirects", async () => {
    const { sdb, env } = newHarness();
    const { quotePublicId, variantId } = await seedQuote(env);
    await activate(env, quotePublicId);
    const rowId = variantRowId(sdb, variantId);
    seedMinimalAuction(sdb, rowId);
    seedRedirectRule(sdb, rowId, { pct: 0 });
    const result = await postAuction(env, variantId, await mintFullAttempt(env, variantId));
    expect(result.status).not.toBe("redirect");
  });

  it("NULL redirect_pct (every rule before an operator ever sets it) NEVER redirects — contract `?? 0`", async () => {
    const { sdb, env } = newHarness();
    const { quotePublicId, variantId } = await seedQuote(env);
    await activate(env, quotePublicId);
    const rowId = variantRowId(sdb, variantId);
    seedMinimalAuction(sdb, rowId);
    seedRedirectRule(sdb, rowId, { pct: null });
    const result = await postAuction(env, variantId, await mintFullAttempt(env, variantId));
    expect(result.status).not.toBe("redirect");
  });

  it("pct=100 ALWAYS redirects", async () => {
    const { sdb, env } = newHarness();
    const { quotePublicId, variantId } = await seedQuote(env);
    await activate(env, quotePublicId);
    const rowId = variantRowId(sdb, variantId);
    seedMinimalAuction(sdb, rowId);
    seedRedirectRule(sdb, rowId, { pct: 100 });
    const result = await postAuction(env, variantId, await mintFullAttempt(env, variantId));
    expect(result.status).toBe("redirect");
  });

  it("pct=50 is session-sticky across MANY distinct sessions (roughly half redirect) through the REAL HTTP+D1 path", async () => {
    const { sdb, env } = newHarness();
    const { quotePublicId, variantId } = await seedQuote(env);
    await activate(env, quotePublicId);
    const rowId = variantRowId(sdb, variantId);
    seedMinimalAuction(sdb, rowId);
    seedRedirectRule(sdb, rowId, { pct: 50 });
    let redirected = 0;
    const total = 40; // bounded — real HTTP+D1 round-trips, not a pure-function loop
    for (let i = 0; i < total; i++) {
      const a = await mintFullAttempt(env, variantId, `auction-sticky-${i}`);
      const result = await postAuction(env, variantId, a);
      if (result.status === "redirect") redirected++;
    }
    expect(redirected).toBeGreaterThan(0);
    expect(redirected).toBeLessThan(total);
  });
});

describeDb("P4a rule status/enabled coherence (fix round: enabled=1 AND status!='disabled' unified across both planes)", () => {
  it("a status='disabled' redirect_direct_offer rule (enabled=1 stale, the EXACT shape the ui-rules-builder.ts Disable button produces) NEVER fires at auction", async () => {
    const { sdb, env } = newHarness();
    const { quotePublicId, variantId } = await seedQuote(env);
    await activate(env, quotePublicId);
    const rowId = variantRowId(sdb, variantId);
    seedMinimalAuction(sdb, rowId);
    seedRedirectRule(sdb, rowId, { pct: 100, enabled: 1, status: "disabled" });
    const result = await postAuction(env, variantId, await mintFullAttempt(env, variantId));
    expect(result.status).not.toBe("redirect");
  });

  it("an enabled=0 (legacy-disabled, status left 'active') redirect_direct_offer rule ALSO never fires — both signals gate independently", async () => {
    const { sdb, env } = newHarness();
    const { quotePublicId, variantId } = await seedQuote(env);
    await activate(env, quotePublicId);
    const rowId = variantRowId(sdb, variantId);
    seedMinimalAuction(sdb, rowId);
    seedRedirectRule(sdb, rowId, { pct: 100, enabled: 0, status: "active" });
    const result = await postAuction(env, variantId, await mintFullAttempt(env, variantId));
    expect(result.status).not.toBe("redirect");
  });

  it("a status='disabled' route_funnel_variant rule (enabled=1 stale) NEVER routes at the entry plane", async () => {
    const { sdb, env } = newHarness();
    const { quotePublicId, variantId, funnelId } = await seedQuote(env);
    const controlRowId = variantRowId(sdb, variantId);
    const funnelRowId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(funnelId) as { id: number }).id;
    const target = seedSiblingVariant(sdb, funnelRowId, "B", false);
    seedRoutingRule(sdb, controlRowId, {
      conditions: { groups: [] },
      targetVariantId: variantRowId(sdb, target),
      priority: 1,
      status: "disabled", // seedRoutingRule always sets enabled=1 — isolates status alone
    });
    await activate(env, quotePublicId);
    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1", session_id: "s1", entry_ctx: BASE_CTX });
    expect(resolved!.variant.public_id).toBe(variantId); // control, unrouted — the disabled rule never fires
  });
});

// ===========================================================================
// S2S value_multiplier graft (s2s-dispatch.ts)
// ===========================================================================

describeDb("P4a S2S value_multiplier graft — replace-not-stack", () => {
  it("resolveRoutingMultiplier returns the recorded outcome's multiplier", async () => {
    const { sdb, env } = newHarness();
    sdb.prepare(
      "INSERT INTO leadgen_routing_outcomes (funnel_attempt_id, session_id, routed_from_variant, routed_to_variant, matched_rule_hash, value_multiplier, plane) VALUES ('att_1','s1','lgn_a','lgn_b','h1',2.5,'entry')",
    ).run();
    expect(await resolveRoutingMultiplier(env.DB, "att_1")).toBe(2.5);
  });

  it("no outcome row -> null (falls back to platform base)", async () => {
    const { env } = newHarness();
    expect(await resolveRoutingMultiplier(env.DB, "att_missing")).toBeNull();
  });

  it("an outcome row with a NULL recorded multiplier -> null (a matched rule with no multiplier configured)", async () => {
    const { sdb, env } = newHarness();
    sdb.prepare(
      "INSERT INTO leadgen_routing_outcomes (funnel_attempt_id, session_id, routed_from_variant, routed_to_variant, matched_rule_hash, value_multiplier, plane) VALUES ('att_2','s1','lgn_a','lgn_b','h1',NULL,'checkpoint')",
    ).run();
    expect(await resolveRoutingMultiplier(env.DB, "att_2")).toBeNull();
  });

  it("empty funnel_attempt_id -> null (never a DB read)", async () => {
    const { env } = newHarness();
    expect(await resolveRoutingMultiplier(env.DB, "")).toBeNull();
  });

  it("dispatchMatchedConversionS2S: a recorded routing multiplier REPLACES the platform base (no stacking)", async () => {
    const { sdb, env } = newHarness();
    sdb.prepare(
      "INSERT INTO leadgen_media_platforms (platform, enabled, postback_url_template, value_multiplier) VALUES ('facebook',1,'https://t.example/pb?v={value}',1.0)",
    ).run();
    sdb.prepare(
      "INSERT INTO leadgen_routing_outcomes (funnel_attempt_id, session_id, routed_from_variant, routed_to_variant, matched_rule_hash, value_multiplier, plane) VALUES ('att_route','s1','lgn_a','lgn_b','h1',5.0,'checkpoint')",
    ).run();
    const fetchCalls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      fetchCalls.push(String(input));
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const click: S2SClickContext = { click_id: "c1", traffic_source: "facebook", fbc: "", fbclid: "", funnel_attempt_id: "att_route" };
    const revenue: S2SRevenueContext = { revenue: 10, currency: "USD" };
    const ctx = { waitUntil: (p: Promise<unknown>) => p } as unknown as ExecutionContext;
    const outcome = await dispatchMatchedConversionS2S(env, ctx, env.DB, click, revenue, { fetchImpl });
    expect(outcome.status).toBe("fired");
    await Promise.all([]); // let the fire-and-forget resolve (already awaited via waitUntil above)
    expect(fetchCalls[0]).toContain("v=50"); // 10 revenue * 5.0 routing multiplier, NOT 1.0 base
  });

  it("dispatchMatchedConversionS2S: NO routing outcome -> the platform's OWN base multiplier applies (default, unchanged behavior)", async () => {
    const { sdb, env } = newHarness();
    sdb.prepare(
      "INSERT INTO leadgen_media_platforms (platform, enabled, postback_url_template, value_multiplier) VALUES ('google',1,'https://t.example/pb?v={value}',3.0)",
    ).run();
    const fetchCalls: string[] = [];
    const fetchImpl = (async (input: unknown) => {
      fetchCalls.push(String(input));
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const click: S2SClickContext = { click_id: "c2", traffic_source: "google", fbc: "", fbclid: "" }; // no funnel_attempt_id
    const revenue: S2SRevenueContext = { revenue: 10, currency: "USD" };
    const ctx = { waitUntil: (p: Promise<unknown>) => p } as unknown as ExecutionContext;
    const outcome = await dispatchMatchedConversionS2S(env, ctx, env.DB, click, revenue, { fetchImpl });
    expect(outcome.status).toBe("fired");
    expect(fetchCalls[0]).toContain("v=30"); // 10 * 3.0 base, no routing override
  });
});
