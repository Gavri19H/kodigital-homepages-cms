// LeadGen Rework P4 (contract §8.3) — the rebuilt Quotes → Templates tab.
// Proves the SSR shape the design pack (docs/leadgen/rework/design-pack/
// templates.html) pins: elements-list LEFT (A–H existing boxes + I·Progress
// NEW) / live-canvas CENTER / settings RIGHT; the saved-template bar; the
// Apply-to-funnel + A/B-templates dialogs; Progress's six controls
// (Position/Alignment/Thickness/Width/Color/Show label) over the real
// FrameProgressConfig axes; Appendix A-9's fixture string shipped verbatim;
// and that the new inline island script is strict ES5 (token scan — the
// SAME harness convention already established by test/leadgen-quotes-ui
// .test.ts, duplicated here per this codebase's own test-file-local-
// duplication convention). The STANDALONE node --check parse proof for this
// exact script is covered by that sibling file's OWN "every emitted inline
// <script> parses as standalone JavaScript" test, which scans every
// <script> block on the SAME rendered quote-editor page (this panel's new
// script included) — not duplicated here to avoid a raw child_process
// invocation in a freshly-added file.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

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
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
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
  funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
}

async function createQuote(env: Env, overrides: Record<string, unknown> = {}): Promise<QuoteDetail> {
  const res = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Templates Tab Quote", activity: "quote_funnel", verticals: ["life"], ...overrides }), env);
  expect(res.status, `create quote: ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as QuoteDetail;
}

async function editorHtml(): Promise<{ html: string; env: Env; quotePublicId: string; funnelPublicId: string; variantPublicId: string }> {
  const { env } = newHarness();
  const q = await createQuote(env);
  const html = await getHtml(env, `/admin/leadgen/quotes/${q.public_id}/edit`);
  return {
    html,
    env,
    quotePublicId: q.public_id,
    funnelPublicId: q.funnels[0]!.public_id,
    variantPublicId: q.funnels[0]!.variants[0]!.public_id,
  };
}

// A minimal, balanced slice of the templates panel (from `data-panel="templates"`
// to its matching closing </div>) so assertions about "inside the panel" don't
// accidentally match content from a sibling tab panel.
function templatesPanelSlice(html: string): string {
  const start = html.indexOf('data-panel="templates"');
  expect(start, "templates panel present").toBeGreaterThan(-1);
  const openTagStart = html.lastIndexOf("<div", start);
  let depth = 0;
  const tagRe = /<div\b|<\/div>/g;
  tagRe.lastIndex = openTagStart;
  let match: RegExpExecArray | null;
  let end = -1;
  while ((match = tagRe.exec(html)) !== null) {
    if (match[0] === "<div") depth++;
    else depth--;
    if (depth === 0) { end = match.index + match[0].length; break; }
  }
  expect(end, "templates panel has a balanced closing </div>").toBeGreaterThan(-1);
  return html.slice(openTagStart, end);
}

describeDb("Quotes editor — Templates tab (contract §8.3, P4 rebuild)", () => {
  it("renders the §8.3 three-column shell: elements list LEFT, live canvas CENTER, settings RIGHT", async () => {
    const { html } = await editorHtml();
    const panel = templatesPanelSlice(html);
    expect(panel).toContain('id="lg-tpl-shell"');
    expect(panel).toContain("lg-tpl2-left");
    expect(panel).toContain("lg-tpl2-center");
    expect(panel).toContain("lg-tpl2-right");
    // the canvas + its toolbar
    expect(panel).toContain('id="lg-tpl-canvas-iframe"');
    expect(panel).toContain('id="lg-tpl-theme-select"');
    expect(panel).toContain('id="lg-tpl-section-select"');
    // the pre-existing box-picker mechanism (unchanged container ids)
    expect(panel).toContain('id="lg-tplbox-grid"');
    expect(panel).toContain('id="lg-tplbox-editor"');
  });

  // R2 P7 (owner ruling, SOURCE-OF-TRUTH A.2 "→ new Funnel-Layout Element
  // \"J\"") — the footer tile is lettered J, not G, and sits last. Every OTHER
  // letter/label pair below is unchanged and asserted exactly as before; only
  // the footer's letter moves, because the owner's own words name it J.
  it("lists the 8 in-page elements (A–F, H, I) plus the separate footer element J", async () => {
    const { html } = await editorHtml();
    const panel = templatesPanelSlice(html);
    const letters: Array<[string, string]> = [
      ["A", "Background"], ["B", "Logo"], ["C", "Phone / URL"], ["D", "Disclosure"],
      ["E", "Free text"], ["F", "Brand logos"], ["H", "Images"], ["I", "Progress"], ["J", "Footer"],
    ];
    for (const [letter, label] of letters) {
      expect(panel, `card ${letter} letter`).toContain(`>${letter}<`);
      expect(panel, `card ${letter} label ${label}`).toContain(label);
    }
    // Progress (I) starts pre-selected per the pack's Pin 1.
    expect(panel).toContain('data-tplbox-pick="progress"');
    expect(panel).toContain('class="lg-tplbox-card selected" data-tplbox-pick="progress"');
  });

  it("Progress box I renders the type picker (5 real styles, no visible 'hidden' thumbnail) + all six §8.3 controls", async () => {
    const { html } = await editorHtml();
    const panel = templatesPanelSlice(html);
    expect(panel).toContain('data-tplbox-panel="progress"');
    // 5 real styles as data-frame-key="progress.style" radios
    for (const style of ["bar", "dots", "numbered", "percent", "icon_on_track"]) {
      expect(panel, `progress style option ${style}`).toContain(`value="${style}" data-frame-key="progress.style"`);
    }
    // the "hidden" state is a proxy radio, not a visible thumbnail card
    expect(panel).toContain('id="lg-tpl-progress-hidden-radio"');
    expect(panel).toContain('id="lg-tpl-progress-show-checkbox"');
    // ALL SIX §8.3 controls
    expect(panel).toContain('data-frame-key="progress.position"');
    expect(panel).toContain('data-frame-key="progress.align"');
    expect(panel).toContain('data-frame-key="progress.thickness"');
    expect(panel).toContain('data-frame-key="progress.width"');
    expect(panel).toContain('data-role-strip="progress.color_role"');
    expect(panel).toContain('data-frame-key="progress.show_label"');
  });

  it("renders the saved-template bar (create/apply/A-B affordances) and both dialogs, hidden by default", async () => {
    const { html } = await editorHtml();
    const panel = templatesPanelSlice(html);
    expect(panel).toContain('id="lg-tpl-bar"');
    expect(panel).toContain('id="lg-tpl-list"');
    expect(panel).toContain('id="lg-tpl-new-btn"');
    expect(panel).toContain('id="lg-tpl-apply-btn"');
    expect(panel).toContain('id="lg-tpl-ab-btn"');
    expect(panel).toContain('id="lg-tpl-delete-guard"');
    // dialogs exist but start hidden (two-dialog apply flow + A/B dialog)
    expect(panel).toMatch(/class="[^"]*lg-hidden[^"]*"\s+id="lg-tpl-apply-dialog"/);
    expect(panel).toMatch(/class="[^"]*lg-hidden[^"]*"\s+id="lg-tpl-ab-dialog"/);
    expect(panel).toContain('data-apply-state="choose"');
    expect(panel).toContain('data-apply-state="confirm"');
  });

  it("ships the Appendix A-9 fixture string verbatim (the no-sections canvas fallback)", async () => {
    const { html } = await editorHtml();
    expect(html).toContain("Sample section (add sections to preview your own).");
  });

  it("the new inline island script is strict ES5 (no arrow/const/let/async/await/backtick)", async () => {
    const { html } = await editorHtml();
    const panel = templatesPanelSlice(html);
    const scriptMatch = panel.match(/<script>([\s\S]*?)<\/script>/);
    expect(scriptMatch, "templates panel ships its own inline <script>").not.toBeNull();
    const script = scriptMatch![1] ?? "";
    expect(script.length, "script body non-trivial").toBeGreaterThan(500);
    expect(script).not.toMatch(/=>/);
    expect(script).not.toMatch(/\bconst\b/);
    expect(script).not.toMatch(/\blet\b/);
    expect(script).not.toMatch(/\basync\b/);
    expect(script).not.toMatch(/\bawait\b/);
    expect(script).not.toContain("`");
  });

  it("the panel's own SSR markup carries no per-request author data (fully static — nothing to escape)", async () => {
    const { html } = await editorHtml();
    const panel = templatesPanelSlice(html);
    expect(panel).not.toMatch(/<script[^>]*>[^<]*<img/i);
  });
});
