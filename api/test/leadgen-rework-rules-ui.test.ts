// LeadGen Rework P3b (slice S3b.2) — QUOTE-scoped routing-rules rail + modal
// (§8.2 RIGHT) and the §13-D5 auction-tab relocation of the four auction-domain
// funnel-rule types.
//
// Pins (SSR + strict-ES5 island; vitest node env — the interactive gestures are
// proven in the Playwright spec leadgen-rework-p3b-rules.gesture.spec.ts):
//   1. The rail renders one card per rule in PRIORITY-ascending order.
//   2. The read-only Checkpoint renders all three §4.3-3 forms (Entry / Shared
//      page / In funnel X — page N) PLUS the A-6 unreachable warning — driven
//      through the rendered output by the SHARED deriveRuleCheckpoint.
//   3. All FIVE action rows (§4.3-9) are present in the modal, each with a
//      toggle; the A-11 "no action" error string is rendered VERBATIM.
//   4. The island (QUOTE_RULES_SCRIPT) is strict ES5 (no arrow/const/let/
//      template-literal/backtick/script-close), the VM parses+runs it, and its
//      checkpoint mirror matches rule-checkpoint.ts deriveRuleCheckpoint 1:1.
//   5. §13-D5 wiring round (S1.4 landed variant-scoped rule CRUD): the Auction
//      tab's relocated editor's quote/funnel/variant PICKER is SSR-bound to a
//      REAL auction's REAL attributed quote (driven through the REAL admin
//      router + a node:sqlite-backed D1, the repo's leadgen-auctions-ui.test.ts
//      pattern); its list/create/edit/duplicate/delete verbs are proven against
//      the REAL GET/POST /variants/:id/rules, PATCH/DELETE /variants/:id/
//      rules/:rule_id, POST .../duplicate endpoints, including a validation
//      failure whose SERVER message is asserted verbatim (the island renders
//      it unmodified — proven live in the gesture spec). The quote-rules rail
//      stays FREE of the four auction-domain rule types (L-196 rendered scan).

import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  QR_ENTRY_FIELD_OPTIONS,
  QUOTE_RULES_SCRIPT,
  renderQuoteRulesRail,
  // the four-type editor stays DEFINED here (§13-D5 relocation is an import-mount
  // in ui-auctions, not a physical move — see the module note there)
  renderRoutingRulesPanel,
  type QuoteRulesRailData,
  type QuoteRulesRailRule,
} from "../src/admin/leadgen/ui-rules-builder";
// NOTE: renderRelocatedFunnelRulesPanel (ui-auctions.ts) is deliberately NOT
// imported directly here. Bisection proved that a DIRECT top-level import of
// ui-auctions.ts, combined with this file's OWN `admin` router import below,
// causes Vitest/Vite's SSR module loader to instantiate ui-auctions.ts TWICE
// (a dual-module-instance artifact — reproduced/isolated in 5 scratch probes,
// confirmed NOT a product bug: two standalone tsx scripts and two isolated
// vitest files hitting the SAME router.ts path without ALSO directly
// importing ui-auctions.ts all rendered the auction editor page fine); the
// SECOND instance's copy of the Hono sub-app never receives the auction-editor
// route registration, so /admin/leadgen/auction/:id/edit 404s for every test
// in a file that does both. ui-rules-builder.ts alone (+ admin) is SAFE
// (isolated separately) — only ui-auctions.ts collides. The router-driven
// tests below prove the SAME renderRelocatedFunnelRulesPanel output (picker +
// four type labels) through the REAL page instead, which is a STRICTLY
// stronger assertion (real data, real router) than a synthetic direct call.
// The SHARED pure derivation — the single source the SSR, the island mirror and
// the runtime all agree with.
import { deriveRuleCheckpoint, type RuleCheckpointFunnel } from "../src/leadgen/rule-checkpoint";
// --- router-driven harness (§13-D5 wiring-round tests only) ----------------
import admin from "../src/admin/router";
import type { Env } from "../src/env";

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const FUNNELS = [
  {
    id: 1,
    public_id: "lgf_auto",
    name: "Auto Insurance",
    is_default: true,
    pages: [
      { position: 1, fields: ["zip"] },
      { position: 2, fields: ["coverage"] },
    ],
  },
  {
    id: 2,
    public_id: "lgf_home",
    name: "Home Insurance",
    is_default: false,
    pages: [{ position: 1, fields: ["homeowner"] }],
  },
];
const ANSWER_FIELDS = [
  { internal_field: "zip", label: "ZIP code" },
  { internal_field: "coverage", label: "Coverage type" },
  { internal_field: "homeowner", label: "Home owner" },
];
const OFFERS = [{ id: 10, name: "Kissterra" }];
const SHARED_FIELDS = ["zip"]; // the shared first page collects ZIP

function conds(field: string, op: string, value: unknown): unknown {
  return { groups: [{ field, op, value }] };
}

const RULE_ENTRY: QuoteRulesRailRule = {
  public_id: "lgqr_entry",
  rule_name: "Desktop from Google",
  priority: 1,
  status: "active",
  match_mode: "all",
  conditions_json: conds("device", "eq", "desktop"),
  target_funnel_id: 1,
  feed_name: "long_pii",
  value_multiplier: 1,
  redirect_pct: null,
  target_offer_id: null,
  redirect_url: null,
  redirect_url_allowlisted: false,
};
const RULE_SHARED: QuoteRulesRailRule = {
  public_id: "lgqr_shared",
  rule_name: "NYC ZIPs",
  priority: 5,
  status: "active",
  match_mode: "all",
  conditions_json: conds("zip", "gte", 10000),
  target_funnel_id: 1,
  feed_name: "short",
  value_multiplier: null,
  redirect_pct: null,
  target_offer_id: null,
  redirect_url: null,
  redirect_url_allowlisted: false,
};
const RULE_INFUNNEL: QuoteRulesRailRule = {
  public_id: "lgqr_infunnel",
  rule_name: "Liability only",
  priority: 10,
  status: "active",
  match_mode: "all",
  conditions_json: conds("coverage", "eq", "Liability"),
  target_funnel_id: null,
  feed_name: null,
  value_multiplier: null,
  redirect_pct: 100,
  target_offer_id: 10,
  redirect_url: null,
  redirect_url_allowlisted: false,
};
const RULE_UNREACHABLE: QuoteRulesRailRule = {
  public_id: "lgqr_ghost",
  rule_name: "Old build test",
  priority: 20,
  status: "disabled",
  match_mode: "all",
  conditions_json: conds("ghostfield", "eq", "x"),
  target_funnel_id: 2,
  feed_name: "medium",
  value_multiplier: null,
  redirect_pct: null,
  target_offer_id: null,
  redirect_url: null,
  redirect_url_allowlisted: false,
};

function railData(rules: QuoteRulesRailRule[]): QuoteRulesRailData {
  return {
    quote_public_id: "lgq_demo",
    rules,
    funnels: FUNNELS,
    default_funnel_id: 1,
    shared_page_fields: SHARED_FIELDS,
    answer_fields: ANSWER_FIELDS,
    offers: OFFERS,
    feed_values: ["long_pii", "short", "medium"],
  };
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Every card's checkpoint text, document order.
function cardCheckpoints(html: string): string[] {
  const out: string[] = [];
  const re = /<span data-qr-ckpt-text>([\s\S]*?)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(unescapeHtml(m[1] ?? ""));
  return out;
}

// Card priority badges, document order.
function cardPriorities(html: string): string[] {
  const out: string[] = [];
  const re = /<span class="lg-qr-prio" data-qr-prio>([\s\S]*?)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(unescapeHtml(m[1] ?? ""));
  return out;
}

// ---------------------------------------------------------------------------
// Island pure API (bare VM — no DOM; init no-ops, checkpoint mirror exposed)
// ---------------------------------------------------------------------------

interface IslandCheckpoint {
  plane: string;
  funnelName?: string;
  pagePosition?: number;
  unreachable?: boolean;
}
interface QuoteRulesApi {
  deriveCheckpoint(
    conditionFields: string[],
    shared: string[],
    funnels: { name: string; pages: { position: number; fields: string[] }[] }[],
  ): IslandCheckpoint;
  checkpointLabelOf(cp: IslandCheckpoint): string;
  conditionFieldsOf(conditions: unknown): string[];
}
function islandApi(): QuoteRulesApi {
  const windowObj: Record<string, unknown> = {};
  const sandbox = {
    window: windowObj,
    document: { getElementById: (): null => null, readyState: "complete" },
  };
  // runInNewContext PARSES then RUNS the island — a syntax error (or a boot
  // throw) fails the test. Combined with the ES6-token scan below this is the
  // strict-ES5 gate (the layout.ts inline-script constraint).
  runInNewContext(QUOTE_RULES_SCRIPT, sandbox);
  const api = windowObj["lgQuoteRules"];
  expect(api, "window.lgQuoteRules exposed").toBeTruthy();
  return api as QuoteRulesApi;
}

// The island's board-order funnel shape (fields as arrays).
function islandFunnels(): { name: string; pages: { position: number; fields: string[] }[] }[] {
  return FUNNELS.map((f) => ({ name: f.name, pages: f.pages.map((p) => ({ position: p.position, fields: p.fields.slice() })) }));
}
// The TS checkpoint shape (fields as Sets).
function tsFunnels(): RuleCheckpointFunnel[] {
  return FUNNELS.map((f) => ({
    id: f.id,
    publicId: f.public_id,
    name: f.name,
    pages: f.pages.map((p) => ({ position: p.position, fields: new Set(p.fields) })),
  }));
}

// ===========================================================================

describe("P3b quote-rules rail — SSR structure", () => {
  it("renders one card per rule in priority-ascending order (given out of order)", () => {
    const html = renderQuoteRulesRail(railData([RULE_INFUNNEL, RULE_ENTRY, RULE_UNREACHABLE, RULE_SHARED]));
    expect(cardPriorities(html)).toEqual(["1", "5", "10", "20"]);
  });

  it("renders the rail head, colhead and + New rule button verbatim", () => {
    const html = renderQuoteRulesRail(railData([RULE_ENTRY]));
    expect(html).toContain(">Routing rules<");
    expect(html).toContain(
      "Rules decide which funnel a visitor sees, and can tag the lead, set the FB multiplier, or redirect. Lowest priority number wins when more than one matches.",
    );
    expect(html).toContain("Name · Checkpoint · Conditions · Actions · Status");
    expect(html).toContain('data-pin="8.2-new-rule-btn"');
    expect(html).toContain('data-pin="8.2-rules-rail"');
    expect(html).toContain('data-pin="8.2-rules-table"');
  });

  it("drives deriveRuleCheckpoint through the rendered cards — all three forms + A-6 unreachable", () => {
    const html = renderQuoteRulesRail(railData([RULE_ENTRY, RULE_SHARED, RULE_INFUNNEL, RULE_UNREACHABLE]));
    expect(cardCheckpoints(html)).toEqual([
      "Entry",
      "Shared page",
      "In funnel Auto Insurance — page 2",
      "In a funnel",
    ]);
    // A-6 verbatim. It appears twice here: the modal's live (hidden) warning
    // PLUS the one unreachable card. With only reachable rules it appears once
    // (modal only) — proving cards carry it ONLY when unreachable.
    const a6 = "This rule can never apply before a visitor enters a funnel that asks these questions.";
    expect(html.split(a6).length - 1).toBe(2);
    const reachableOnly = renderQuoteRulesRail(railData([RULE_ENTRY, RULE_SHARED, RULE_INFUNNEL]));
    expect(reachableOnly.split(a6).length - 1).toBe(1);
    expect(html).toContain('data-pin="A-6-inline"');
    // The unreachable rule is the disabled one — its card carries the pin.
    expect(html).toContain('data-pin="8.2-rule-disabled"');
  });

  it("renders all five toggleable action rows and the A-11 error verbatim", () => {
    const html = renderQuoteRulesRail(railData([RULE_ENTRY]));
    for (const pin of [
      "action-target-funnel",
      "action-feed-name",
      "action-fb-multiplier",
      "action-redirect-pct",
      "action-redirect-target",
    ]) {
      expect(html, pin).toContain(`data-pin="${pin}"`);
    }
    // one toggle per action row (5) inside the modal actions block.
    const actionsBlock = html.slice(html.indexOf('data-pin="4.3-9-actions"'));
    expect((actionsBlock.match(/data-qr-action-toggle/g) ?? []).length).toBe(5);
    expect(html).toContain("Pick at least one action for this rule.");
    expect(html).toContain('data-pin="A-11-validation"');
    expect(html).toContain('data-pin="8.2-rule-modal"');
    expect(html).toContain('data-pin="8.2-rule-sentence"');
    // checkpoint + priority + name pins.
    expect(html).toContain('data-pin="4.3-3-checkpoint"');
    expect(html).toContain('data-pin="8.2-rule-priority"');
    expect(html).toContain('data-pin="8.2-rule-name"');
  });

  it("condition + action summaries render as wrapping chips", () => {
    const html = renderQuoteRulesRail(railData([RULE_ENTRY, RULE_INFUNNEL]));
    expect(html).toContain("Device is desktop"); // entry-field label mapping
    expect(html).toContain("→ Auto Insurance"); // action chip
    expect(html).toContain("Feed long_pii");
    expect(html).toContain("×1"); // multiplier
    expect(html).toContain("Redirect 100% → Kissterra"); // redirect target by name
    expect(html).toContain("Coverage type is Liability"); // answer-field label mapping
  });
});

describe("P3b quote-rules rail — the island is strict ES5 + mirrors deriveRuleCheckpoint", () => {
  it("QUOTE_RULES_SCRIPT contains no ES6+ constructs (strict-ES5 token scan)", () => {
    expect(QUOTE_RULES_SCRIPT).not.toMatch(/=>/);
    expect(QUOTE_RULES_SCRIPT).not.toMatch(/\bconst\b/);
    expect(QUOTE_RULES_SCRIPT).not.toMatch(/\blet\b/);
    expect(QUOTE_RULES_SCRIPT).not.toMatch(/\basync\b/);
    expect(QUOTE_RULES_SCRIPT).not.toMatch(/\bawait\b/);
    expect(QUOTE_RULES_SCRIPT).not.toContain("`");
    expect(QUOTE_RULES_SCRIPT).not.toContain("${");
    expect(QUOTE_RULES_SCRIPT).not.toContain("</script");
  });

  it("boots safely with no rail root (VM parses+runs, no throw) and exposes the pure API", () => {
    const api = islandApi();
    expect(typeof api.deriveCheckpoint).toBe("function");
  });

  it("checkpoint mirror agrees with rule-checkpoint.ts on entry / shared / in-funnel / unreachable", () => {
    const api = islandApi();
    const cases: Array<{ fields: string[]; plane: string; label: string }> = [
      { fields: ["device", "utm_source"], plane: "entry", label: "Entry" },
      { fields: ["zip"], plane: "shared", label: "Shared page" },
      { fields: ["coverage"], plane: "in_funnel", label: "In funnel Auto Insurance — page 2" },
      { fields: ["ghostfield"], plane: "in_funnel", label: "In a funnel" },
    ];
    for (const c of cases) {
      const mirror = api.deriveCheckpoint(c.fields, SHARED_FIELDS, islandFunnels());
      const truth = deriveRuleCheckpoint(c.fields, new Set(SHARED_FIELDS), tsFunnels());
      expect(mirror.plane, c.fields.join(",")).toBe(truth.plane);
      expect(mirror.plane, c.fields.join(",")).toBe(c.plane);
      expect(api.checkpointLabelOf(mirror), c.fields.join(",")).toBe(c.label);
      if (c.label === "In a funnel") {
        expect(mirror.unreachable).toBe(true);
        expect(truth.unreachable).toBe(true);
      }
    }
  });

  it("checkpoint mirror plane matches the truth across a field matrix (drift guard)", () => {
    const api = islandApi();
    const matrix = [["os"], ["state", "coverage"], ["homeowner"], ["zip", "coverage"], []];
    for (const fields of matrix) {
      const mirror = api.deriveCheckpoint(fields, SHARED_FIELDS, islandFunnels());
      const truth = deriveRuleCheckpoint(fields, new Set(SHARED_FIELDS), tsFunnels());
      expect(mirror.plane, fields.join(",")).toBe(truth.plane);
    }
  });

  it("the entry-field picker options are all entry-known (never route to a checkpoint plane)", () => {
    const api = islandApi();
    for (const opt of QR_ENTRY_FIELD_OPTIONS) {
      const cp = api.deriveCheckpoint([opt.internal_field], [], islandFunnels());
      expect(cp.plane, opt.internal_field).toBe("entry");
    }
  });
});

describe("P3b §13-D5 (pure SSR) — the relocated editor's static shell + quote-rules-rail exclusion", () => {
  const FOUR_TYPES = ["eligibility", "disqualification", "auction_entry", "redirect_direct_offer"];

  // renderRelocatedFunnelRulesPanel's own picker + four-type-label rendering is
  // asserted below in "P3b §13-D5 wiring round — real router + D1" (through the
  // REAL /admin/leadgen/auction/:id/edit page with REAL data) instead of a
  // synthetic direct call here — see the import-graph note above this
  // describe's imports (ui-auctions.ts cannot be imported directly in this
  // file alongside `admin`).

  it("renderRoutingRulesPanel (byte-identical, still the quote/variant editor's OWN condition-envelope editor) still renders its four-type table shell", () => {
    const html = renderRoutingRulesPanel({
      rules: [],
      fields: [],
      offers: [],
      sections: [],
      variants: [],
      field_pages: {},
      page_count: 0,
    });
    expect(html).toContain('id="lg-routing-rules-root"');
    expect(html).toContain("No rules yet.");
  });

  it("the quote-rules rail output contains none of the four auction-domain rule-type tokens (L-196)", () => {
    const html = renderQuoteRulesRail(railData([RULE_ENTRY, RULE_SHARED, RULE_INFUNNEL, RULE_UNREACHABLE]));
    for (const t of FOUR_TYPES) {
      expect(html.indexOf(t), `rail must not mention ${t}`).toBe(-1);
    }
    // and the island likewise never references them
    for (const t of FOUR_TYPES) {
      expect(QUOTE_RULES_SCRIPT.indexOf(t), `island must not mention ${t}`).toBe(-1);
    }
  });
});

// ---------------------------------------------------------------------------
// §13-D5 wiring round — router-driven: SSR picker + panel bound to REAL rows
// through the REAL admin router + a node:sqlite-backed D1 (the repo's
// leadgen-auctions-ui.test.ts / leadgen-p4a-routing.test.ts harness pattern).
// ---------------------------------------------------------------------------

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
        for (const statement of statements) results.push(await statement.run());
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

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
  );
  for (const file of LEADGEN_MIGRATIONS) {
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  }
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
const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;
function newHarness(): { sdb: SqliteDb; env: Env } {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createLeadgenDb(ctor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

const API = "/api/admin/leadgen";
function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
async function getHtml(env: Env, path: string): Promise<string> {
  const res = await admin.request(path, {}, env);
  return res.text();
}
async function createQuote(env: Env, name = "Life Quote"): Promise<{ id: number; public_id: string }> {
  const res = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: name, activity: "quote_funnel", verticals: ["life"] }), env);
  const j = (await res.json()) as { id: number; public_id: string };
  return { id: j.id, public_id: j.public_id };
}
interface FunnelWithVariants {
  id: number;
  public_id: string;
  variants: Array<{ id: number; public_id: string; variant_label: string }>;
}
async function createFunnel(env: Env, quotePublicId: string, name = "Auto Insurance"): Promise<FunnelWithVariants> {
  const res = await admin.request(`${API}/quotes/${quotePublicId}/funnels`, jsonInit("POST", { funnel_name: name }), env);
  return (await res.json()) as FunnelWithVariants;
}
// The funnel-creation endpoint always seeds exactly one control variant
// (variant_label 'A') in the SAME insert batch — asserted, never optional.
function firstVariant(funnel: FunnelWithVariants): { id: number; public_id: string; variant_label: string } {
  const v = funnel.variants[0];
  expect(v, "auto-created control variant").toBeTruthy();
  return v as { id: number; public_id: string; variant_label: string };
}
async function createAuction(env: Env, body: Record<string, unknown>): Promise<{ id: number; public_id: string; auction_name: string }> {
  const res = await admin.request(`${API}/auctions`, jsonInit("POST", body), env);
  return (await res.json()) as { id: number; public_id: string; auction_name: string };
}

describeDb("P3b §13-D5 wiring round — real router + D1", () => {
  it("SSR: the picker is bound to the auction's REAL attributed quote (selected) among REAL quotes", async () => {
    const { env } = newHarness();
    const quoteA = await createQuote(env, "Life Quote");
    await createQuote(env, "Auto Quote"); // a second real quote the picker must ALSO list
    const auction = await createAuction(env, { auction_name: "Life Auction", quote_id: quoteA.id, auction_type: "dynamic" });

    const html = await getHtml(env, `/admin/leadgen/auction/${auction.public_id}/edit`);
    expect(html).toContain("Funnel eligibility rules");
    expect(html).toContain('data-lg-frr-quote');
    // the attributed quote is pre-selected…
    const selRe = new RegExp(`<option value="${quoteA.public_id}" selected>Life Quote</option>`);
    expect(html).toMatch(selRe);
    // …and the OTHER real quote is present too (reachable, not filtered out)
    expect(html).toContain("Auto Quote");
    // the four type labels ship in the modal's type select regardless of picker state
    for (const label of ["Redirect to offer", "Eligibility", "Disqualification", "Auction entry"]) {
      expect(html, label).toContain(label);
    }
  });

  it("SSR: an auction with NO attributed quote still renders the picker with every quote, none pre-selected", async () => {
    const { env } = newHarness();
    await createQuote(env, "Orphan-adjacent Quote");
    // quote_id is required by createAuctionHandler, so attribute then verify the
    // OTHER (non-attributed) quote renders unselected in the SAME picker.
    const quoteB = await createQuote(env, "Second Quote");
    const auction = await createAuction(env, { auction_name: "Second Auction", quote_id: quoteB.id, auction_type: "dynamic" });
    const html = await getHtml(env, `/admin/leadgen/auction/${auction.public_id}/edit`);
    expect(html).toContain("Orphan-adjacent Quote");
    expect(html).not.toMatch(/<option value="[^"]+" selected>Orphan-adjacent Quote<\/option>/);
  });

  it("list/create/edit/duplicate/delete round-trip through the REAL variant-rule endpoints (S1.4)", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const funnel = await createFunnel(env, quote.public_id);
    const variant = firstVariant(funnel);
    const variantsPath = `${API}/variants/${variant.public_id}/rules`;

    // list: empty
    const empty = await admin.request(variantsPath, {}, env);
    expect((await empty.json()) as { items: unknown[] }).toEqual({ items: [] });

    // create
    const created = await admin.request(
      variantsPath,
      jsonInit("POST", {
        rule_name: "US residents only",
        rule_type: "eligibility",
        priority: 5,
        conditions_json: { groups: [{ field: "state", op: "neq", value: "" }] },
      }),
      env,
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { public_id: string; rule_name: string; priority: number; status: string };
    expect(createdBody.rule_name).toBe("US residents only");
    expect(createdBody.status).toBe("active");

    // list: shows it
    const afterCreate = await admin.request(variantsPath, {}, env);
    const listBody = (await afterCreate.json()) as { items: Array<{ public_id: string; rule_name: string }> };
    expect(listBody.items.map((r) => r.rule_name)).toEqual(["US residents only"]);

    // edit (PATCH)
    const edited = await admin.request(
      `${API}/variants/${variant.public_id}/rules/${createdBody.public_id}`,
      jsonInit("PATCH", { rule_name: "US residents only (v2)", priority: 7 }),
      env,
    );
    expect(edited.status).toBe(200);
    const editedBody = (await edited.json()) as { rule_name: string; priority: number };
    expect(editedBody.rule_name).toBe("US residents only (v2)");
    expect(editedBody.priority).toBe(7);

    // duplicate
    const duped = await admin.request(`${API}/variants/${variant.public_id}/rules/${createdBody.public_id}/duplicate`, { method: "POST" }, env);
    expect(duped.status).toBe(201);
    const dupedBody = (await duped.json()) as { public_id: string; rule_name: string };
    expect(dupedBody.rule_name).toBe("US residents only (v2) (copy)");
    expect(dupedBody.public_id).not.toBe(createdBody.public_id);

    const afterDuplicate = await admin.request(variantsPath, {}, env);
    expect(((await afterDuplicate.json()) as { items: unknown[] }).items.length).toBe(2);

    // enable/disable (PATCH status)
    const disabled = await admin.request(
      `${API}/variants/${variant.public_id}/rules/${createdBody.public_id}`,
      jsonInit("PATCH", { status: "disabled" }),
      env,
    );
    const disabledBody = (await disabled.json()) as { status: string; enabled: boolean };
    expect(disabledBody.status).toBe("disabled");
    expect(disabledBody.enabled).toBe(false); // P4b status/enabled coherence

    // delete
    const deleted = await admin.request(`${API}/variants/${variant.public_id}/rules/${createdBody.public_id}`, { method: "DELETE" }, env);
    expect(deleted.status).toBe(200);
    const afterDelete = await admin.request(variantsPath, {}, env);
    expect(((await afterDelete.json()) as { items: Array<{ public_id: string }> }).items.map((r) => r.public_id)).toEqual([dupedBody.public_id]);
  });

  it("a validation failure returns the SERVER's own field messages verbatim (the island renders them unmodified)", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const funnel = await createFunnel(env, quote.public_id);
    const variant = firstVariant(funnel);

    // an unknown rule_type is rejected by prepareOneRule's Stage-A check.
    const res = await admin.request(
      `${API}/variants/${variant.public_id}/rules`,
      jsonInit("POST", { rule_name: "Bad type", rule_type: "not_a_real_type" }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; fields: Record<string, string> };
    expect(body.error).toBe("Validation failed");
    expect(body.fields.rule_type).toBe(
      "rule_type must be one of redirect_direct_offer|eligibility|disqualification|auction_entry",
    );

    // redirect_direct_offer with BOTH an offer id and a raw URL is incoherent
    // (prepareOneRule/validateFunnelRule's redirect-target exclusivity).
    const res2 = await admin.request(
      `${API}/variants/${variant.public_id}/rules`,
      jsonInit("POST", {
        rule_name: "Bad redirect",
        rule_type: "redirect_direct_offer",
        target_offer_id: 999999,
        redirect_url: "https://not-on-any-allowlist.example.com",
        redirect_url_allowlisted: true,
        redirect_pct: 50,
      }),
      env,
    );
    expect(res2.status).toBe(400);
    const body2 = (await res2.json()) as { error: string; fields: Record<string, string> };
    expect(body2.error).toBe("Validation failed");
    expect(Object.keys(body2.fields).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// P3b adversarial review finding P2-C — the composer's DB-row -> rail map
// (ui-quotes.ts ~L923-937, feeding renderQuoteRulesRail) exercised through the
// REAL editor route with a NON-EMPTY rail: seed 2+ routing rules via the real
// POST /quotes/:id/routing-rules, GET the real /admin/leadgen/quotes/:id/edit
// page, and assert the rail renders BOTH cards in priority order with correct
// summaries — never asserted before through the real route (only an empty
// rail was exercised there).
// ---------------------------------------------------------------------------

async function createRoutingRule(env: Env, quotePublicId: string, body: Record<string, unknown>): Promise<{ public_id: string }> {
  const res = await admin.request(`${API}/quotes/${quotePublicId}/routing-rules`, jsonInit("POST", body), env);
  expect(res.status, `create routing rule ${JSON.stringify(body)}`).toBe(201);
  return (await res.json()) as { public_id: string };
}

describeDb("P3b quote-rules rail — SSR through the REAL editor route, non-empty (finding P2-C)", () => {
  it("GET /admin/leadgen/quotes/:id/edit renders BOTH seeded rule cards, in priority order, with correct summaries", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env, "Rail SSR Quote");

    // seed 2 routing rules OUT OF priority order, so a naive unsorted render
    // would fail this test — proves the composer's map preserves the rail's
    // own priority-ascending contract, not just "both rows present somewhere."
    await createRoutingRule(env, quote.public_id, {
      rule_name: "Low priority number rule",
      priority: 2,
      conditions_json: { groups: [{ field: "device", op: "eq", value: "desktop" }] },
      feed_name: "short",
    });
    await createRoutingRule(env, quote.public_id, {
      rule_name: "High priority number rule",
      priority: 8,
      conditions_json: { groups: [{ field: "utm_source", op: "eq", value: "google" }] },
      value_multiplier: 1.5,
    });

    const html = await getHtml(env, `/admin/leadgen/quotes/${quote.public_id}/edit`);
    expect(html).toContain('id="lg-qr-rail"');
    expect(html).toContain('data-pin="8.2-rules-table"');

    // both names present
    expect(html).toContain("Low priority number rule");
    expect(html).toContain("High priority number rule");

    // priority order: card order in the DOM matches priority ascending (2, 8),
    // regardless of DB insertion order (rule 2 — "High priority number rule",
    // priority 8 — was created SECOND but must render SECOND too since 2 < 8).
    const lowIdx = html.indexOf("Low priority number rule");
    const highIdx = html.indexOf("High priority number rule");
    expect(lowIdx).toBeGreaterThan(-1);
    expect(highIdx).toBeGreaterThan(-1);
    expect(lowIdx, "priority 2 card must render BEFORE priority 8 card").toBeLessThan(highIdx);
    const priorities = cardPriorities(html);
    expect(priorities).toEqual(["2", "8"]);

    // per-card condition + action summaries (the DB-row -> rail-row mapping,
    // not just names) — device/utm_source labels + the feed/multiplier chips.
    expect(html).toContain("Device is desktop");
    expect(html).toContain("UTM Source is google");
    expect(html).toContain("Feed short");
    expect(html).toContain("×1.5");
  });
});
