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
  resolveEffectiveFrameOnly,
  buildFrameCtaCtx,
  computeCtaVerdict,
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
  resolveClickContextFromCh,
  type S2SClickContext,
  type S2SRevenueContext,
} from "../src/leadgen/s2s-dispatch";
import type { LeadgenChClient, LeadgenChQueryResult } from "../src/leadgen/clickhouse";
import { resolveLeadgenClick } from "../src/public/leadgen/click";
import { loadAuctionBundle } from "../src/public/leadgen/auction/engine";
import type { LeadgenAuctionRow } from "../src/admin/leadgen/db-types";

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

// Rework P1 coherence sweep (conductor-consolidated round): brought
// current through 0053 (was stale) so this harness's D1 schema matches
// the real Wave-1 shape (handlers now write M1/M2/M4/M5 columns/tables
// this file's schema never had).
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
  "0045_leadgen_persona_quota.sql",
  "0046_leadgen_rework_m1_variants.sql",
  "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql",
  "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql",
  "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql",
  "0053_leadgen_rework_m12_othergroup_retirement.sql",
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

// ---------------------------------------------------------------------------
// REMOVED (conductor-consolidated test-repair round, S1.6 bug-class): this
// helper cluster and the test blocks at each further cut below (originally
// through EOF, ~31 tests total) exercised the
// per-variant `route_funnel_variant` routing model — sibling-variant
// targeting within ONE funnel via leadgen_funnel_rules, seeded through
// is_control-bearing fixture helpers (seedSiblingVariant/seedCheckpointFunnel)
// and asserting checkpoint/entry routing switches a visitor to a target
// VARIANT of the SAME funnel. Contract §5-M3/§4.3 (D5, owner override, §3)
// replaces this architecture: entry/checkpoint routing now targets a
// DIFFERENT FUNNEL via the quote-scoped leadgen_quote_routing_rules table —
// there is no sibling-variant target anymore, so the removed scenarios have
// no honest re-expression here. Full replacement coverage (first-match-wins,
// entry/checkpoint/in-funnel planes, sticky outcomes, S2S multiplier graft
// via the new table, OS/feed conditions, etc.) lives in
// test/leadgen-rework-routing.test.ts's R-01..R-15 suite. The pure-function
// tests above this line (field registry/rule parsing, evaluateEntryRouting,
// evaluateCheckpointRouting, deriveCheckpointPages, detectRoutingRuleConflicts,
// computeResumeSection, redirect_pct pure helpers, buildFrameCtaCtx,
// computeCtaVerdict) test evaluator/helper functions that are unaffected by
// the routing-target axis change and remain green. The S2S value_multiplier
// graft (resolveRoutingMultiplier/dispatchMatchedConversionS2S over
// leadgen_routing_outcomes directly) and reviews minor-4/minor-6 (rule
// status/enabled coherence and 0043 migration-replay byte-fidelity, both
// exercised over the four SURVIVING rule types) test mechanisms the rework
// keeps unchanged and are NOT removed — they remain later in this file.
// ---------------------------------------------------------------------------


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


// ===========================================================================
// Review minor-4: the auction rule-SELECT fallback must NOT widen past what
// each migration state actually removes. A DB with 0043 applied but not yet
// 0044 (status exists, redirect_pct doesn't) must still gate on status.
// ===========================================================================

describeDb("P4a review minor-4: narrowed two-step fallback (0043-without-0044 still gates on status)", () => {
  it("a status='disabled' rule NEVER fires in a DB that has 0043 but NOT 0044 (the redirect_pct column is absent)", async () => {
    const ctor = DatabaseSync as DatabaseSyncCtor;
    const sdb = new ctor(":memory:");
    runSql(
      sdb,
      "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
        "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
        "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
        `INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','${TENANT_HOST}','insurance','active');`,
    );
    // 0036 through 0043 ONLY — deliberately stop before 0044, so redirect_pct
    // does not exist but status (0043) does.
    for (const file of ["0036_leadgen_core.sql", "0037_leadgen_analytics_mirror.sql", "0038_leadgen_revenue_infra.sql", "0039_leadgen_conversion_dedupe.sql", "0040_leadgen_runtime_context.sql", "0041_leadgen_frame_theme.sql", "0042_leadgen_pages.sql", "0043_leadgen_routing_rules.sql"]) {
      runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
    }
    const db = d1FromSqlite(sdb);

    // Minimal quote/funnel/variant scaffold via raw SQL (no admin API needed
    // for this pure fallback-behavior proof).
    sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status) VALUES ('lgq_x','Q','quote_funnel','[]','active')").run();
    const quoteRowId = (sdb.prepare("SELECT id FROM leadgen_quotes WHERE public_id = 'lgq_x'").get() as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status) VALUES ('lgf_x', ?, 'F', 'active')").run(quoteRowId);
    const funnelRowId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = 'lgf_x'").get() as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, is_control, traffic_allocation_bp, status) VALUES ('lgn_x', ?, 'A', 1, 10000, 'active')").run(funnelRowId);
    const variantRowIdLocal = (sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = 'lgn_x'").get() as { id: number }).id;

    // status='disabled', enabled=1 (the exact incoherent shape ui-rules-builder.ts's
    // toggle produces) — a disqualification rule that must NEVER fire.
    sdb
      .prepare(
        "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority, enabled, status) VALUES ('lgfr_disabled', ?, 'disqualification', '{\"groups\":[]}', 'h1', 1, 1, 'disabled')",
      )
      .run(variantRowIdLocal);
    // An ACTIVE rule on the same variant, proving the fallback isn't overly
    // broad either — a genuinely-active rule still comes through.
    sdb
      .prepare(
        "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority, enabled, status) VALUES ('lgfr_active', ?, 'auction_entry', '{\"groups\":[]}', 'h2', 2, 1, 'active')",
      )
      .run(variantRowIdLocal);

    const minimalAuction = { id: 1, banner_config_json: null } as unknown as LeadgenAuctionRow;
    const bundle = await loadAuctionBundle(db, minimalAuction, variantRowIdLocal);
    const publicIds = bundle.funnel_rules.map((r) => r.public_id);
    expect(publicIds, "a status='disabled' rule must never fire even without the redirect_pct column").not.toContain("lgfr_disabled");
    expect(publicIds).toContain("lgfr_active");
  });
});

// ===========================================================================
// Review minor-6: 0043's full-table-recreation ritual replay-safety — a
// LEGACY row (seeded under the pre-0043 six-type CHECK) must survive the
// CREATE-new/INSERT-OR-IGNORE-SELECT/DROP/RENAME sequence with its id AND
// conditions_hash byte-intact (0043's own header claims exactly this;
// this is the executable proof).
// ===========================================================================

describeDb("P4a review minor-6: 0043 migration replay preserves legacy rows byte-intact", () => {
  it("a pre-0043 leadgen_funnel_rules row survives the recreation with id + conditions_hash unchanged", async () => {
    const ctor = DatabaseSync as DatabaseSyncCtor;
    const sdb = new ctor(":memory:");
    runSql(
      sdb,
      "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
        "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
        "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
        `INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','${TENANT_HOST}','insurance','active');`,
    );
    // 0036 through 0042 ONLY — the pre-0043 world (six-type CHECK, no status/
    // match_mode/etc. columns), the exact "before" state 0043's replay runs over.
    for (const file of ["0036_leadgen_core.sql", "0037_leadgen_analytics_mirror.sql", "0038_leadgen_revenue_infra.sql", "0039_leadgen_conversion_dedupe.sql", "0040_leadgen_runtime_context.sql", "0041_leadgen_frame_theme.sql", "0042_leadgen_pages.sql"]) {
      runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
    }

    sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status) VALUES ('lgq_legacy','Q','quote_funnel','[]','active')").run();
    const quoteRowId = (sdb.prepare("SELECT id FROM leadgen_quotes WHERE public_id = 'lgq_legacy'").get() as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status) VALUES ('lgf_legacy', ?, 'F', 'active')").run(quoteRowId);
    const funnelRowId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = 'lgf_legacy'").get() as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, is_control, traffic_allocation_bp, status) VALUES ('lgn_legacy', ?, 'A', 1, 10000, 'active')").run(funnelRowId);
    const variantRowIdLocal = (sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = 'lgn_legacy'").get() as { id: number }).id;

    // A LEGACY rule row, seeded under the pre-0043 (six-type) schema, with an
    // EXPLICIT id + a specific conditions_hash — the exact two values 0043's
    // own header claims are preserved byte-for-byte (id: primary-key stability
    // for any future rule-id reference; conditions_hash: copied, never
    // recomputed by the migration).
    const LEGACY_ID = 4242;
    const LEGACY_HASH = "legacy_conditions_hash_deadbeef00112233";
    sdb
      .prepare(
        "INSERT INTO leadgen_funnel_rules (id, public_id, variant_id, rule_type, conditions_json, conditions_hash, priority, enabled) VALUES (?, 'lgfr_legacy', ?, 'redirect_direct_offer', '{\"groups\":[]}', ?, 5, 1)",
      )
      .run(LEGACY_ID, variantRowIdLocal, LEGACY_HASH);

    // Run the migration under test.
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0043_leadgen_routing_rules.sql"), "utf8"));

    const row = sdb.prepare("SELECT id, public_id, conditions_hash, rule_type, priority, enabled FROM leadgen_funnel_rules WHERE public_id = 'lgfr_legacy'").get() as {
      id: number; public_id: string; conditions_hash: string; rule_type: string; priority: number; enabled: number;
    };
    expect(row, "the legacy row must survive the recreation at all").toBeDefined();
    expect(row.id, "primary key id must be preserved byte-intact").toBe(LEGACY_ID);
    expect(row.conditions_hash, "conditions_hash must be copied, never recomputed").toBe(LEGACY_HASH);
    expect(row.rule_type).toBe("redirect_direct_offer");
    expect(row.priority).toBe(5);
    expect(row.enabled).toBe(1);

    // The NEW (0043) additive columns exist and default correctly for a
    // carried-over row (redirect_pct is 0044's column, not this migration's —
    // out of scope for a 0043-only replay test).
    const extended = sdb.prepare("SELECT status, match_mode FROM leadgen_funnel_rules WHERE public_id = 'lgfr_legacy'").get() as {
      status: string; match_mode: string | null;
    };
    expect(extended.status).toBe("active"); // DEFAULT 'active' -- behavior-preserving
    expect(extended.match_mode).toBeNull();
  });
});



// ===========================================================================
// P4a-adj (P5a runtime seam #1): server-side CTA visibility verdict —
// buildFrameCtaCtx + computeCtaVerdict, pure (no DB), plus the two endpoints
// that carry it (/lg/attempt mint, /lg/ck checkpoint).
// ===========================================================================

describe("P4a-adj: buildFrameCtaCtx (pure, the __-prefixed ctx builder)", () => {
  it("builds the __-prefixed shape matching the client twin (runtime/dependencies.ts buildCtxFields)", () => {
    const ctx = buildFrameCtaCtx({ state: "CA", device: "mobile", hour: 14, weekday: 2 }, 0);
    expect(ctx).toEqual({ __page: 0, __hour: 14, __weekday: 2, __state: "CA", __device: "mobile" });
  });

  it("omits __state/__device when absent or empty (fail-closed, matching the client's own tolerant-absence rule)", () => {
    const ctxAbsent = buildFrameCtaCtx({ hour: 9, weekday: 0 }, 2);
    expect(ctxAbsent).toEqual({ __page: 2, __hour: 9, __weekday: 0 });
    expect("__state" in ctxAbsent).toBe(false);
    expect("__device" in ctxAbsent).toBe(false);
    const ctxEmpty = buildFrameCtaCtx({ state: "", device: "", hour: 9, weekday: 0 }, 1);
    expect("__state" in ctxEmpty).toBe(false);
    expect("__device" in ctxEmpty).toBe(false);
  });
});

describe("P4a-adj: computeCtaVerdict (pure, the server-side condition evaluator)", () => {
  it("a __state-conditioned CTA is visible only when the ctx state matches; absent ctx is fail-closed", () => {
    const slots = [
      {
        slot: "footer" as const, label: "CA hotline", tel: "+1 555 000 0000", id: "cta_ca",
        condition: { match: "all" as const, conditions: [{ when: "__state", op: "eq" as const, value: "CA" }] },
      },
    ];
    expect(computeCtaVerdict(slots, { __state: "CA" })).toEqual(["cta_ca"]);
    expect(computeCtaVerdict(slots, { __state: "NY" })).toEqual([]);
    expect(computeCtaVerdict(slots, {})).toEqual([]); // no __state key at all -> fail-closed, never a false match
  });

  it("an answer-conditioned CTA is visible only when the (server re-normalized) answer is present and matching", () => {
    const slots = [
      {
        slot: "under_header" as const, label: "Senior line", tel: "+1 555 111 0000", id: "cta_senior",
        condition: { match: "all" as const, conditions: [{ when: "age", op: "gte" as const, value: 65 }] },
      },
    ];
    expect(computeCtaVerdict(slots, { age: 70 })).toEqual(["cta_senior"]);
    expect(computeCtaVerdict(slots, { age: 40 })).toEqual([]);
    expect(computeCtaVerdict(slots, {})).toEqual([]); // no answer yet (e.g. mint time) -> fail-closed
  });

  it("an UNCONDITIONAL CTA (no `condition` at all) is never in the verdict — it server-renders visible already, never hidden", () => {
    const slots = [{ slot: "footer" as const, label: "Call now", tel: "+1 555 222 0000", id: "cta_plain" }];
    expect(computeCtaVerdict(slots, { __state: "CA", age: 70 })).toEqual([]);
  });

  it("id derivation matches frame.ts's renderCtaSlot exactly: an authored id wins, else frame_cta_<slot>_<index>", () => {
    const slots = [
      {
        slot: "header_right" as const, label: "A", tel: "+1", // no id -> derived from slot+index
        condition: { match: "all" as const, conditions: [{ when: "__state", op: "eq" as const, value: "CA" }] },
      },
      {
        slot: "footer" as const, label: "B", tel: "+2", id: "explicit_id",
        condition: { match: "all" as const, conditions: [{ when: "__state", op: "eq" as const, value: "CA" }] },
      },
    ];
    expect(computeCtaVerdict(slots, { __state: "CA" })).toEqual(["frame_cta_header_right_0", "explicit_id"]);
  });

  it("absent cta_slots (no frame, or a frame with none) -> empty verdict, never throws", () => {
    expect(computeCtaVerdict(undefined, { __state: "CA" })).toEqual([]);
    expect(computeCtaVerdict([], {})).toEqual([]);
  });
});


