#!/usr/bin/env tsx
/**
 * capture-p3a-presplit
 *
 * LEADGEN-REWORK-03 §12 P3a — "mechanical split of ui-quotes.ts into per-tab
 * modules." Behavior-freeze proof requires a byte-exact baseline captured
 * BEFORE the split lands. This script drives the REAL admin router (Hono
 * app, node:sqlite-backed D1 harness — the same pattern test/leadgen-quotes-
 * ui.test.ts uses) against a seeded fixture quote and writes every page's
 * (and, for the editor, every tab panel's) full SSR HTML to
 * test/fixtures/p3a-presplit/*.html.
 *
 * test/leadgen-p3a-split-parity.test.ts re-renders the SAME fixture through
 * the CURRENT (post-split) code using the identical harness + panel-slice
 * logic and asserts byte-for-byte equality against these files.
 *
 * Deliberately independent of test/: this script must keep working
 * regardless of test-file churn, so the node:sqlite harness + fixture
 * seeding are duplicated here rather than imported from test/
 * leadgen-quotes-ui.test.ts (matches the repo's existing convention of
 * per-file harness duplication — see e.g. leadgen-rework-migration-report.ts).
 *
 * Run once, at the START of the P3a session, before any edit to ui-quotes.ts:
 *   tsx src/scripts/capture-p3a-presplit.ts
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../admin/router";
import type { Env } from "../env";
import { mintPublicId } from "../leadgen/ids";

// --- node:sqlite harness (repo pattern; see test/leadgen-quotes-ui.test.ts) --

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

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(SCRIPT_DIR, "..", ".."); // src/scripts -> src -> api
const OUT_DIR = join(API_ROOT, "test", "fixtures", "p3a-presplit");

// Kept current with test/leadgen-quotes-ui.test.ts's LEADGEN_MIGRATIONS list.
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
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(API_ROOT, "migrations", file), "utf8"));
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

function newHarness(): { sdb: SqliteDb; env: Env } {
  const DatabaseSync = loadDatabaseSync();
  if (DatabaseSync === null) throw new Error("node:sqlite unavailable in this Node runtime — cannot capture (need Node >= 22 w/ node:sqlite, matching the test harness's own skip gate).");
  const sdb = createLeadgenDb(DatabaseSync);
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

function seedSection(sdb: SqliteDb, opts: { activity: string; vertical: string; name: string }): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "q1", question_key: "k", internal_field: "f", answer_type: "boolean" }] });
  sdb
    .prepare("INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, ?, ?, ?, ?, ?, 'button', 'active')")
    .run(publicId, opts.name, opts.activity, opts.vertical, "Headline", content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

interface QuoteDetail {
  id: number;
  public_id: string;
  funnels: Array<{ variants: Array<{ public_id: string }> }>;
}

async function createQuote(env: Env, overrides: Record<string, unknown> = {}): Promise<QuoteDetail> {
  const res = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Life Quote", activity: "quote_funnel", verticals: ["life", "health"], ...overrides }), env);
  if (res.status !== 201) throw new Error(`create quote failed (${res.status}): ${await res.clone().text()}`);
  return (await res.json()) as QuoteDetail;
}

// --- panel slicer (also duplicated byte-for-byte in the parity test) --------
// Finds the `<div ... data-panel="X">...</div>` region by locating the
// marker, backing up to its enclosing <div, then walking forward with a
// balanced open/close counter (robust to arbitrary nested <div>s).
function extractPanel(html: string, tabName: string): string {
  const marker = `data-panel="${tabName}"`;
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) throw new Error(`panel marker not found: ${tabName}`);
  const openIdx = html.lastIndexOf("<div", markerIdx);
  if (openIdx === -1) throw new Error(`enclosing <div not found for panel: ${tabName}`);
  let depth = 0;
  let pos = openIdx;
  for (;;) {
    const nextOpen = html.indexOf("<div", pos);
    const nextClose = html.indexOf("</div>", pos);
    if (nextClose === -1) throw new Error(`unbalanced <div>/</div> while slicing panel: ${tabName}`);
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      pos = nextOpen + 4;
    } else {
      depth -= 1;
      pos = nextClose + 6;
      if (depth === 0) return html.slice(openIdx, pos);
    }
  }
}

const TAB_NAMES = ["builder", "templates", "themes", "ab", "activation", "analytics"] as const;

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const written: Array<{ file: string; bytes: number }> = [];

  function save(name: string, html: string): void {
    const path = join(OUT_DIR, name);
    writeFileSync(path, html, "utf8");
    written.push({ file: name, bytes: Buffer.byteLength(html, "utf8") });
  }

  // 1) List page, empty state.
  {
    const { env } = newHarness();
    save("quotes-list-empty.html", await getHtml(env, "/admin/leadgen/quotes"));
  }

  // 2) List page, one hostile-named quote seeded (exercises escaping + the
  //    populated-row columns).
  {
    const { env } = newHarness();
    await createQuote(env, { quote_name: "<img src=x onerror=alert(1)>" });
    save("quotes-list-seeded.html", await getHtml(env, "/admin/leadgen/quotes"));
  }

  // 3) /quotes/new create form.
  {
    const { env } = newHarness();
    save("quotes-new.html", await getHtml(env, "/admin/leadgen/quotes/new"));
  }

  // 4) Quote-not-found page (bogus id).
  {
    const { env } = newHarness();
    save("quotes-not-found.html", await getHtml(env, "/admin/leadgen/quotes/does-not-exist/edit"));
  }

  // 5) Editor page — the rich fixture (2 ordered sections + 1 rule), matching
  //    test/leadgen-quotes-ui.test.ts's editorHtmlWithContent() pattern — plus
  //    each of the six tab panels sliced out of the SAME response.
  {
    const { sdb, env } = newHarness();
    const q = await createQuote(env, { quote_name: "<b>Quote</b>" });
    const variantId = q.funnels[0]!.variants[0]!.public_id;
    const s1 = seedSection(sdb, { activity: "quote_funnel", vertical: "life", name: "<i>First</i>" });
    const s2 = seedSection(sdb, { activity: "quote_funnel", vertical: "health", name: "Second" });
    const put = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", { sections: [{ section_id: s1.id }, { section_id: s2.id }], rules: [{ rule_type: "eligibility" }] }),
      env,
    );
    if (put.status !== 200) throw new Error(`seed variant failed (${put.status}): ${await put.clone().text()}`);
    const html = await getHtml(env, `/admin/leadgen/quotes/${q.public_id}/edit`);
    save("editor-full.html", html);
    for (const tab of TAB_NAMES) {
      save(`editor-panel-${tab}.html`, extractPanel(html, tab));
    }
  }

  console.log(`Wrote ${written.length} fixture files to ${OUT_DIR}:`);
  for (const w of written) console.log(`  ${w.file}\t${w.bytes} bytes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
