// LeadGen Rework §8.7 — "routed_to_funnel and feed_name join the drilldown
// dimensions." Two legs, both previously uncovered (verified: no test file
// exercised GET /quotes/:id/analytics's `breakdowns` object at all before
// this file — leadgen-quotes-api.test.ts's own "§15.6 analytics" describe
// block only asserts `analytics.funnels`, never `analytics.breakdowns`):
//
//   1. QUERY leg — quotes-handlers.ts's quoteAnalyticsHandler GROUP BYs
//      leadgen_analytics_quote_drilldown (migration 0054) over ALL FOUR
//      breakdown dimensions the handler exposes today: the pre-existing
//      by_site/by_traffic_source (also never asserted before this file) and
//      the new by_routed_funnel/by_feed_name. Proven over the REAL admin
//      router + REAL migrations (the leadgen-quotes-api.test.ts node:sqlite
//      pattern), asserting real SUM-across-rows aggregation and date-range
//      scoping — not just row presence.
//
//   2. UI leg — quotes-tabs/funnel.ts's renderBreakdowns/buildBreakdownCard
//      (the client-side "fill after paint" cards §15.6's own funnel table
//      already uses — these 4 breakdown tables have NO SSR shell at all, so
//      quotes-tabs/analytics.ts's renderAnalyticsPanel SSR output and its
//      test/leadgen-p3a-split-parity.test.ts byte-identity pin are both
//      unaffected). Proven with the leadgen-offers-ui.test.ts F1
//      executed-island idiom: the REAL functions are sliced out of the
//      SERVED quote-editor script and run in a vm over a minimal element
//      stand-in — behavior against real server-shaped JSON, not source text.
//
// NOTE: there is no "dimension picker" anywhere in this surface (no dropdown
// ever existed to add an option to) — §15.6's breakdowns render as four
// always-visible cards. "Follow the existing dimension pattern exactly"
// means the by_routed_funnel/by_feed_name cards match the by_site/
// by_traffic_source cards' shape (same table markup, same NULLIF-guarded
// numeric formatting), which this file's UI-leg assertions verify directly.
//
// Scope boundary (see migrations/0054's own note): routed_to_funnel/
// feed_name read '' until ops applies the ClickHouse DDL + a follow-up wires
// mirror-sync.ts's MirrorSpec for this table — this file seeds the D1
// drilldown table directly (as production rows will look once that lands),
// it does not exercise the CH mirror itself.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";

// --- node:sqlite harness (repo pattern; leadgen-quotes-api.test.ts / leadgen-quotes-ui.test.ts) ---

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
function d1FromSqlite(sdb: SqliteDb): D1Database {
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first<T = unknown>(): Promise<T | null> { return (sdb.prepare(sql).get(...binds) ?? null) as T | null; },
        async all<T = unknown>() { return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} }; },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
          return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      try {
        const out: unknown[] = [];
        for (const s of statements) out.push(await s.run());
        runSql(sdb, "COMMIT");
        return out;
      } catch (e) {
        runSql(sdb, "ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(TEST_DIR, "..", "migrations");

// Every leadgen migration (0036→latest) by directory scan, NOT a hardcoded
// list (the leadgen-rework-routing.test.ts pattern) — so this brand-new file
// never goes stale the way leadgen-quotes-api.test.ts's/leadgen-quotes-ui.
// test.ts's own hardcoded lists were found to have (both needed a
// conductor-consolidated "brought current through 0053" catch-up round).
function leadgenMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 36)
    .sort();
}

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
  );
  for (const f of leadgenMigrationFiles()) runSql(sdb, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  return sdb;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db, CACHE: {} as KVNamespace, MEDIA: {} as R2Bucket, APP_ENV: "test",
    ADMIN_HOST: "localhost", ADMIN_BASE_URL: "http://localhost:8787", ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false", HTML_CACHE_TTL_SECONDS: "60", OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test", SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false", DEV_BYPASS_AUTH: "true",
  } as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(): { sdb: SqliteDb; env: Env } {
  const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
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

interface QuoteDetail {
  id: number;
  public_id: string;
  quote_name: string;
  funnels: Array<{ id: number; public_id: string; funnel_id: string }>;
}
async function createQuote(env: Env): Promise<QuoteDetail> {
  const res = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Drilldown Quote", activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(res.status, `create quote: ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as QuoteDetail;
}

// One row of leadgen_analytics_quote_drilldown (migration 0054 shape). Every
// PK column is bound explicitly; section_public_id varies per call so rows
// sharing the same site/source/routed_funnel/feed_name dimensions (to prove
// real SUM-across-rows aggregation, not just row echoing) don't collide on
// the primary key.
function seedDrilldownRow(
  sdb: SqliteDb,
  r: {
    quote_public_id: string;
    section_public_id: string;
    site_id?: string;
    traffic_source?: string;
    routed_to_funnel?: string;
    feed_name?: string;
    date: string;
    views: number;
    clicks: number;
    conversions: number;
    revenue: number;
  },
): void {
  sdb
    .prepare(
      `INSERT INTO leadgen_analytics_quote_drilldown
         (quote_public_id, funnel_id, funnel_variant_id, site_id, traffic_source, device, state,
          routed_to_funnel, feed_name, section_public_id, section_index, question_key, answer_value_normalized,
          date, views, continued, clicks, conversions, revenue, synced_at)
       VALUES (?, '', '', ?, ?, '', '', ?, ?, ?, 0, '', '', ?, ?, 0, ?, ?, ?, 0)`,
    )
    .run(
      r.quote_public_id,
      r.site_id ?? "",
      r.traffic_source ?? "",
      r.routed_to_funnel ?? "",
      r.feed_name ?? "",
      r.section_public_id,
      r.date,
      r.views,
      r.clicks,
      r.conversions,
      r.revenue,
    );
}

interface DimRow {
  views: number | null;
  clicks: number | null;
  conversions: number | null;
  revenue: number | null;
  [dim: string]: unknown;
}
interface AnalyticsBreakdowns {
  by_site: DimRow[];
  by_traffic_source: DimRow[];
  by_routed_funnel: DimRow[];
  by_feed_name: DimRow[];
}

// ===========================================================================
// 1. QUERY leg — the REAL admin router + REAL D1
// ===========================================================================

describeDb("§8.7 query leg — quoteAnalyticsHandler breakdowns (by_site/by_traffic_source/by_routed_funnel/by_feed_name)", () => {
  it("SUMs across rows sharing a dimension value, orders ASC, and keeps the honest '' bucket for unrouted rows", async () => {
    const { sdb, env } = newHarness();
    const q = await createQuote(env);
    const date = "2026-07-10";
    // Two rows share (site-1, google, funnel-a, feedA) — proves GROUP BY SUMs, not row-echo.
    seedDrilldownRow(sdb, { quote_public_id: q.public_id, section_public_id: "sec-1", site_id: "site-1", traffic_source: "google", routed_to_funnel: "funnel-a", feed_name: "feedA", date, views: 100, clicks: 20, conversions: 5, revenue: 50 });
    seedDrilldownRow(sdb, { quote_public_id: q.public_id, section_public_id: "sec-2", site_id: "site-1", traffic_source: "google", routed_to_funnel: "funnel-a", feed_name: "feedA", date, views: 50, clicks: 10, conversions: 1, revenue: 10 });
    // A distinct dimension combo.
    seedDrilldownRow(sdb, { quote_public_id: q.public_id, section_public_id: "sec-3", site_id: "site-2", traffic_source: "facebook", routed_to_funnel: "funnel-b", feed_name: "feedB", date, views: 40, clicks: 8, conversions: 2, revenue: 20 });
    // The honest "no routing rule matched / no CH mirror yet" '' bucket (migration 0054's own default).
    seedDrilldownRow(sdb, { quote_public_id: q.public_id, section_public_id: "sec-4", site_id: "", traffic_source: "", routed_to_funnel: "", feed_name: "", date, views: 7, clicks: 1, conversions: 0, revenue: 0 });
    // Out-of-range row: must NOT affect any breakdown sum.
    seedDrilldownRow(sdb, { quote_public_id: q.public_id, section_public_id: "sec-5", site_id: "site-1", traffic_source: "google", routed_to_funnel: "funnel-a", feed_name: "feedA", date: "2026-01-01", views: 9999, clicks: 9999, conversions: 9999, revenue: 9999 });

    const res = await admin.request(`${API}/quotes/${q.public_id}/analytics?from=2026-07-01&to=2026-07-31`, {}, env);
    expect(res.status, `analytics: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as { analytics: { breakdowns: AnalyticsBreakdowns } };
    const b = body.analytics.breakdowns;

    // by_routed_funnel: '' (7) < 'funnel-a' (150) < 'funnel-b' (40), ASC by name not value.
    expect(b.by_routed_funnel.map((r) => r["routed_to_funnel"])).toEqual(["", "funnel-a", "funnel-b"]);
    const funnelA = b.by_routed_funnel.find((r) => r["routed_to_funnel"] === "funnel-a")!;
    expect(funnelA.views).toBe(150);
    expect(funnelA.clicks).toBe(30);
    expect(funnelA.conversions).toBe(6);
    expect(funnelA.revenue).toBe(60);
    const unrouted = b.by_routed_funnel.find((r) => r["routed_to_funnel"] === "")!;
    expect(unrouted.views).toBe(7);

    // by_feed_name mirrors the same aggregation over the paired dimension.
    expect(b.by_feed_name.map((r) => r["feed_name"])).toEqual(["", "feedA", "feedB"]);
    const feedA = b.by_feed_name.find((r) => r["feed_name"] === "feedA")!;
    expect(feedA.views).toBe(150);
    expect(feedA.revenue).toBe(60);

    // by_site / by_traffic_source — pre-existing dimensions, ALSO previously
    // uncovered by any test; closing that gap here since the same query leg
    // now has real assertions for the first time.
    expect(b.by_site.map((r) => r["site_id"])).toEqual(["", "site-1", "site-2"]);
    const site1 = b.by_site.find((r) => r["site_id"] === "site-1")!;
    expect(site1.views).toBe(150);
    expect(b.by_traffic_source.map((r) => r["traffic_source"])).toEqual(["", "facebook", "google"]);
    const google = b.by_traffic_source.find((r) => r["traffic_source"] === "google")!;
    expect(google.views).toBe(150);

    // The 9999-row (2026-01-01) is outside ?from=2026-07-01&to=2026-07-31 —
    // confirmed excluded (funnel-a's 150 above already proves it: had the
    // out-of-range row counted, funnel-a would read 10149).
  });

  it("an empty range returns empty breakdown arrays, never fabricated rows", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const res = await admin.request(`${API}/quotes/${q.public_id}/analytics?from=2026-07-01&to=2026-07-31`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { analytics: { breakdowns: AnalyticsBreakdowns } };
    expect(body.analytics.breakdowns.by_routed_funnel).toEqual([]);
    expect(body.analytics.breakdowns.by_feed_name).toEqual([]);
  });
});

// ===========================================================================
// 2. CUTOVER-SAFETY compat leg — during the merge->deploy window the
// ALREADY-DEPLOYED worker keeps running mirror-sync.ts's buildUpsertSql()
// UNCHANGED (this round deliberately does not touch that file — see
// migrations/0054's own SCOPE NOTE). That upsert's ON CONFLICT target names
// ONLY the pre-0054 11-column PK, no WHERE clause. Empirically verified (see
// migrations/0054's CUTOVER-SAFETY COMPAT INDEX note): without a compat
// index, SQLite rejects that ON CONFLICT target outright — "does not match
// any PRIMARY KEY or UNIQUE constraint" — on every single call (100% failure,
// not a graceful '' aggregation) because it now names a strict subset of the
// new 13-column PK's columns. migrations/0054 adds
// uq_leadgen_quote_drilldown_legacy_upsert (a FULL, non-partial UNIQUE index
// on exactly the original 11 columns) so the old code's ON CONFLICT target
// resolves against IT instead. This suite drives mirror-sync.ts's REAL,
// UNCHANGED buildUpsertSql()/MIRRORS spec (not a hand-copied SQL string) —
// so it fails if either the compat index regresses OR mirror-sync.ts's spec
// ever silently drifts from what shipped.
// ===========================================================================

describeDb("§8.7 cutover-safety — the already-deployed mirror-sync.ts upsert survives the post-0054 schema", () => {
  it("the REAL, unchanged MIRRORS quote_drilldown spec has no routed_to_funnel/feed_name yet (confirms this is testing the OLD/frozen shape)", async () => {
    const { MIRRORS } = await import("../src/leadgen/mirror-sync");
    const spec = MIRRORS.find((m) => m.name === "quote_drilldown")!;
    expect(spec.pk).not.toContain("routed_to_funnel");
    expect(spec.pk).not.toContain("feed_name");
    expect(spec.columns.map((c) => c.d1)).not.toContain("routed_to_funnel");
    expect(spec.columns.map((c) => c.d1)).not.toContain("feed_name");
  });

  it("the old upsert SUCCEEDS as a fresh insert and as a repeat upsert (aggregation), landing in the '' bucket", async () => {
    const { sdb } = newHarness();
    const { MIRRORS, buildUpsertSql } = await import("../src/leadgen/mirror-sync");
    const spec = MIRRORS.find((m) => m.name === "quote_drilldown")!;
    const sql = buildUpsertSql(spec); // the REAL generated SQL, not a hand-copied string
    const cols = spec.columns.map((c) => c.d1);
    const rowValues = (views: number): unknown[] =>
      cols.map((c) => {
        if (c === "quote_public_id") return "quote-compat";
        if (c === "funnel_id") return "funnel-compat";
        if (c === "date") return "2026-07-20";
        if (c === "section_index") return 0;
        if (c === "views" || c === "continued" || c === "clicks" || c === "conversions") return views;
        if (c === "revenue") return 1.5;
        return ""; // funnel_variant_id/site_id/traffic_source/device/state/section_public_id/question_key/answer_value_normalized
      });

    expect(() => sdb.prepare(sql).run(...rowValues(10))).not.toThrow();
    expect(() => sdb.prepare(sql).run(...rowValues(20))).not.toThrow(); // same 11-dim combo -> upsert path, not a duplicate row

    const rows = sdb.prepare("SELECT quote_public_id, funnel_id, routed_to_funnel, feed_name, views FROM leadgen_analytics_quote_drilldown WHERE quote_public_id = 'quote-compat'").all() as Array<{
      routed_to_funnel: string;
      feed_name: string;
      views: number;
    }>;
    expect(rows).toHaveLength(1); // aggregated into ONE row, not duplicated
    expect(rows[0]!.routed_to_funnel).toBe(""); // the honest, never-fabricated default
    expect(rows[0]!.feed_name).toBe("");
    expect(rows[0]!.views).toBe(20); // the second call's value won (DO UPDATE), proving real upsert not insert-ignore
  });

  it("a real-dimension row for a DIFFERENT 11-dim combo is unaffected by the compat index (only same-combo rows are constrained)", async () => {
    const { sdb } = newHarness();
    sdb
      .prepare(
        `INSERT INTO leadgen_analytics_quote_drilldown
           (quote_public_id, funnel_id, funnel_variant_id, site_id, traffic_source, device, state,
            routed_to_funnel, feed_name, section_public_id, section_index, question_key, answer_value_normalized,
            date, views, continued, clicks, conversions, revenue, synced_at)
         VALUES ('quote-compat','funnel-OTHER','','','','','','funnel-a','feedA','',0,'','', '2026-07-20', 7, 0, 1, 0, 0, 0)`,
      )
      .run();
    const row = sdb.prepare("SELECT routed_to_funnel, feed_name FROM leadgen_analytics_quote_drilldown WHERE funnel_id = 'funnel-OTHER'").get() as { routed_to_funnel: string; feed_name: string };
    expect(row.routed_to_funnel).toBe("funnel-a");
    expect(row.feed_name).toBe("feedA");
  });

  it("KNOWN, DOCUMENTED boundary: two DISTINCT routed_to_funnel values for the SAME 11-dim combo collide on the compat index today (expected until mirror-sync.ts's follow-up drops it — migrations/0054's REMOVAL OBLIGATION note)", async () => {
    const { sdb } = newHarness();
    sdb
      .prepare(
        `INSERT INTO leadgen_analytics_quote_drilldown
           (quote_public_id, funnel_id, funnel_variant_id, site_id, traffic_source, device, state,
            routed_to_funnel, feed_name, section_public_id, section_index, question_key, answer_value_normalized,
            date, views, continued, clicks, conversions, revenue, synced_at)
         VALUES ('quote-compat','funnel-collide','','','','','','funnel-a','feedA','',0,'','', '2026-07-20', 7, 0, 1, 0, 0, 0)`,
      )
      .run();
    expect(() =>
      sdb
        .prepare(
          `INSERT INTO leadgen_analytics_quote_drilldown
             (quote_public_id, funnel_id, funnel_variant_id, site_id, traffic_source, device, state,
              routed_to_funnel, feed_name, section_public_id, section_index, question_key, answer_value_normalized,
              date, views, continued, clicks, conversions, revenue, synced_at)
           VALUES ('quote-compat','funnel-collide','','','','','','funnel-b','feedB','',0,'','', '2026-07-20', 3, 0, 0, 0, 0, 0)`,
        )
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });
});

// ===========================================================================
// 3. UI leg — executed island (leadgen-offers-ui.test.ts F1 pattern): the
// REAL renderBreakdowns/buildBreakdownCard sliced from the SERVED script.
// ===========================================================================

interface FakeEl {
  tagName: string;
  nodeType: number;
  attrs: Map<string, string>;
  children: FakeEl[];
  className: string;
  id: string;
  textContent: string;
  readonly firstChild: FakeEl | null;
  appendChild(c: FakeEl): FakeEl;
  removeChild(c: FakeEl): FakeEl;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
}

function fakeElement(tag: string): FakeEl {
  const attrs = new Map<string, string>();
  const children: FakeEl[] = [];
  const node: FakeEl = {
    tagName: String(tag).toUpperCase(),
    nodeType: 1,
    attrs,
    children,
    className: "",
    id: "",
    textContent: "",
    get firstChild() { return children.length > 0 ? children[0]! : null; },
    appendChild(c) { children.push(c); return c; },
    removeChild(c) {
      const i = children.indexOf(c);
      if (i !== -1) children.splice(i, 1);
      return c;
    },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k)! : null; },
  };
  return node;
}
function fakeTextNode(text: string): FakeEl {
  const n = fakeElement("#text");
  n.nodeType = 3;
  n.textContent = String(text);
  return n;
}
function textOf(node: FakeEl): string {
  let out = node.nodeType === 3 ? node.textContent : node.textContent || "";
  for (const c of node.children) out += textOf(c);
  return out;
}
function findAll(root: FakeEl, pred: (el: FakeEl) => boolean): FakeEl[] {
  const out: FakeEl[] = [];
  for (const c of root.children) {
    if (c.nodeType === 1 && pred(c)) out.push(c);
    out.push(...findAll(c, pred));
  }
  return out;
}
function findById(root: FakeEl, id: string): FakeEl | null {
  for (const c of root.children) {
    if (c.id === id) return c;
    const nested = findById(c, id);
    if (nested !== null) return nested;
  }
  return null;
}
function attrSelectorMatch(el: FakeEl, sel: string): boolean {
  const m = sel.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/);
  if (m === null) return false;
  const name = m[1]!;
  if (!el.attrs.has(name)) return false;
  return m[2] === undefined ? true : el.attrs.get(name) === m[2];
}

const SCRIPT_RE = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
function extractScripts(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    if ((match[0] ?? "").includes('type="application/json"')) continue;
    blocks.push(match[1] ?? "");
  }
  return blocks;
}

function sliceIslandFunction(script: string, name: string): string {
  const marker = `function ${name}(`;
  const start = script.indexOf(marker);
  expect(start, `island function ${name} present`).toBeGreaterThan(-1);
  const open = script.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < script.length; i += 1) {
    if (script[i] === "{") depth += 1;
    else if (script[i] === "}") {
      depth -= 1;
      if (depth === 0) return script.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces while slicing island function ${name}`);
}

interface BreakdownsIsland {
  renderBreakdowns(breakdowns: Partial<AnalyticsBreakdowns> | null): void;
}
// Sandbox's `document` fake carries ONE element — the analytics panel
// ([data-panel="analytics"], matching quotes-tabs/analytics.ts's real SSR
// panel attribute) — since renderBreakdowns looks it up via
// document.querySelector + document.getElementById exactly like the real
// browser DOM (no container-as-parameter signature here, unlike renderUsage).
function breakdownsIsland(html: string): { island: BreakdownsIsland; panel: FakeEl } {
  const script = extractScripts(html).find((s) => s.includes("function renderBreakdowns("));
  expect(script, "analytics breakdowns island script present in the served editor page").toBeDefined();
  const source = ["orDash", "money", "byId", "buildBreakdownCard", "renderBreakdowns"].map((n) => sliceIslandFunction(script!, n)).join("\n");
  const panel = fakeElement("div");
  panel.setAttribute("data-panel", "analytics");
  const sandbox = {
    document: {
      createElement: fakeElement,
      createTextNode: fakeTextNode,
      querySelector(sel: string) { return attrSelectorMatch(panel, sel) ? panel : null; },
      getElementById(id: string) { return findById(panel, id); },
    },
  };
  const island = runInNewContext(`${source}\n({ renderBreakdowns: renderBreakdowns })`, sandbox) as BreakdownsIsland;
  return { island, panel };
}

describeDb("§8.7 UI leg — the breakdown cards island, executed over the REAL served quote-editor script", () => {
  it("renders 4 cards (Site, Traffic source, Routed funnel, Feed name) in order, with rows sourced from the real dimension keys", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const html = await getHtml(env, `/admin/leadgen/quotes/${q.public_id}/edit`);
    const { island, panel } = breakdownsIsland(html);

    island.renderBreakdowns({
      by_site: [{ site_id: "site-1", views: 150, clicks: 30, conversions: 6, revenue: 60 }],
      by_traffic_source: [{ traffic_source: "google", views: 150, clicks: 30, conversions: 6, revenue: 60 }],
      by_routed_funnel: [
        { routed_to_funnel: "", views: 7, clicks: 1, conversions: 0, revenue: 0 },
        { routed_to_funnel: "funnel-a", views: 150, clicks: 30, conversions: 6, revenue: 60 },
      ],
      by_feed_name: [{ feed_name: "feedA", views: 150, clicks: 30, conversions: 6, revenue: 60 }],
    });

    const host = findById(panel, "lg-analytics-breakdowns");
    expect(host).not.toBeNull();
    expect(host!.children).toHaveLength(4);
    const titles = host!.children.map((card) => textOf(findAll(card, (e) => e.tagName === "H4")[0]!));
    expect(titles).toEqual(["Site", "Traffic source", "Routed funnel", "Feed name"]);

    // Routed funnel card: '' → em dash label, real value verbatim, real sums present.
    const routedCard = host!.children[2]!;
    const rows = findAll(routedCard, (e) => e.tagName === "TR");
    // rows[0] is the header row (site/label + Views/Clicks/Conversions/Revenue).
    expect(textOf(rows[0]!)).toContain("Views");
    expect(textOf(rows[1]!)).toContain("—"); // '' dimension value
    expect(textOf(rows[1]!)).toContain("7");
    expect(textOf(rows[2]!)).toContain("funnel-a");
    expect(textOf(rows[2]!)).toContain("150");

    // Feed name card renders the paired dimension identically.
    const feedCard = host!.children[3]!;
    expect(textOf(feedCard)).toContain("feedA");
    expect(textOf(feedCard)).toContain("150");
  });

  it("a re-render clears the host (no duplicate cards) and an empty breakdown prints the no-data placeholder", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const html = await getHtml(env, `/admin/leadgen/quotes/${q.public_id}/edit`);
    const { island, panel } = breakdownsIsland(html);

    island.renderBreakdowns({ by_site: [{ site_id: "site-1", views: 1, clicks: 0, conversions: 0, revenue: 0 }], by_traffic_source: [], by_routed_funnel: [], by_feed_name: [] });
    island.renderBreakdowns({ by_site: [], by_traffic_source: [], by_routed_funnel: [], by_feed_name: [] }); // second call, different data

    const host = findById(panel, "lg-analytics-breakdowns");
    expect(host!.children).toHaveLength(4); // still 4, not 8 — old cards were cleared first
    expect(textOf(host!)).toContain("No data for this timeframe.");
    expect(textOf(host!)).not.toContain("site-1"); // the FIRST render's row is gone, not accumulated
  });

  it("a null breakdowns payload (e.g. a fetch that hasn't resolved a shape yet) renders all 4 cards empty, never throws", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const html = await getHtml(env, `/admin/leadgen/quotes/${q.public_id}/edit`);
    const { island, panel } = breakdownsIsland(html);
    expect(() => island.renderBreakdowns(null)).not.toThrow();
    const host = findById(panel, "lg-analytics-breakdowns");
    expect(host!.children).toHaveLength(4);
  });
});
