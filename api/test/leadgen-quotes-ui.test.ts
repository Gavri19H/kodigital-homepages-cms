// LeadGen Phase 7 Stage B — the contract 03 §9.4 Quotes UI over the REAL admin
// shell router + REAL migrations (node:sqlite harness). Covers: the list
// columns; the full-page editor's five sub-tabs (Funnel builder w/ opening
// lander + ordered sections + the auction-entry-on-MAX-position marker + design
// selector + auction picker, Rules builder, A/B P8-seam note, Activation panel,
// Analytics); hostile author content is escaped; every inline <script> is
// strict ES5 + parses (node --check); /quotes/new create form.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";

// --- node:sqlite harness (repo pattern) --------------------------------------

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
const LEADGEN_MIGRATIONS = ["0036_leadgen_core.sql", "0037_leadgen_analytics_mirror.sql", "0038_leadgen_revenue_infra.sql", "0039_leadgen_conversion_dedupe.sql"] as const;

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
  public_id: string;
  funnels: Array<{ variants: Array<{ public_id: string }> }>;
}

async function createQuote(env: Env, overrides: Record<string, unknown> = {}): Promise<QuoteDetail> {
  const res = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Life Quote", activity: "quote_funnel", verticals: ["life", "health"], ...overrides }), env);
  expect(res.status, `create quote: ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as QuoteDetail;
}

// ===========================================================================

describeDb("Quotes list (03 §9.4)", () => {
  it("renders the §9.4 columns + an enabled Create link", async () => {
    const { env } = newHarness();
    await createQuote(env);
    const html = await getHtml(env, "/admin/leadgen/quotes");
    for (const col of ["Variants", "A/B status", "Active sites", "Visits", "Completion rate", "Avg RPS", "Unfilled rate", "Revenue"]) {
      expect(html, `column ${col}`).toContain(col);
    }
    expect(html).toContain("data-create-quote");
    expect(html).toContain('href="/admin/leadgen/quotes/new"');
    // the after-paint analytics hydrator table marker
    expect(html).toContain("data-lg-analytics");
  });

  it("renders an empty-state when there are no quotes", async () => {
    const { env } = newHarness();
    const html = await getHtml(env, "/admin/leadgen/quotes");
    expect(html).toContain("empty-state");
    expect(html).toContain("No quotes yet");
  });

  it("escapes hostile quote names in the list", async () => {
    const { env } = newHarness();
    await createQuote(env, { quote_name: "<img src=x onerror=alert(1)>" });
    const html = await getHtml(env, "/admin/leadgen/quotes");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});

describeDb("Quotes /new create form", () => {
  it("renders the create-quote form + submit script", async () => {
    const { env } = newHarness();
    const html = await getHtml(env, "/admin/leadgen/quotes/new");
    expect(html).toContain('id="lg-quote-new-form"');
    expect(html).toContain('id="lg-q-name"');
    expect(html).toContain('id="lg-q-verticals"');
    expect(html).toContain("Create Quote");
  });
});

// Build a quote whose control variant has 2 ordered sections + 1 rule, so the
// editor renders the section list, the auction-entry marker, and a rule row.
async function editorHtmlWithContent(): Promise<{ html: string; env: Env; variantId: string; quotePublicId: string }> {
  const { sdb, env } = newHarness();
  const q = await createQuote(env, { quote_name: "<b>Quote</b>" });
  const variantId = q.funnels[0]!.variants[0]!.public_id;
  const s1 = seedSection(sdb, { activity: "quote_funnel", vertical: "life", name: "<i>First</i>" });
  const s2 = seedSection(sdb, { activity: "quote_funnel", vertical: "health", name: "Second" });
  const put = await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { sections: [{ section_id: s1.id }, { section_id: s2.id }], rules: [{ rule_type: "eligibility" }] }), env);
  expect(put.status, `seed variant: ${await put.clone().text()}`).toBe(200);
  const html = await getHtml(env, `/admin/leadgen/quotes/${q.public_id}/edit`);
  return { html, env, variantId, quotePublicId: q.public_id };
}

describeDb("Quotes editor — the five sub-tabs (03 §9.4 / 06 §15–§17)", () => {
  it("renders all five editor sub-tabs + Save/Preview controls", async () => {
    const { html } = await editorHtmlWithContent();
    for (const tab of ["builder", "rules", "ab", "activation", "analytics"]) {
      expect(html, `tab ${tab}`).toContain(`data-tab="${tab}"`);
      expect(html, `panel ${tab}`).toContain(`data-panel="${tab}"`);
    }
    expect(html).toContain('id="lg-variant-save"');
    expect(html).toContain('id="lg-variant-preview"');
    expect(html).toContain('id="lg-preview-iframe"'); // sandboxed preview target
    expect(html).toContain('sandbox="allow-same-origin"');
  });

  it("Funnel builder: opening-lander editor + design selector + auction picker + ordered section list", async () => {
    const { html } = await editorHtmlWithContent();
    // §15.2 opening lander
    expect(html).toContain('id="lg-lander-enabled"');
    expect(html).toContain('id="lg-lander-headline"');
    // §15.4 design selector (registry option present)
    expect(html).toContain('id="lg-funnel-design"');
    expect(html).toContain('value="default-funnel"');
    // auction FK picker
    expect(html).toContain('id="lg-auction-id"');
    // §15.3 ordered section list + the add-section control
    expect(html).toContain('id="lg-section-list"');
    expect(html).toContain('id="lg-add-section"');
    expect(html).toContain("data-section-id");
  });

  it("marks the auction-entry on the MAX-position section only (no 'final' flag)", async () => {
    const { html } = await editorHtmlWithContent();
    // exactly ONE server-rendered auction-entry marker (the last/max section).
    const markers = html.match(/data-auction-entry="1"/g) ?? [];
    expect(markers.length).toBe(1);
    expect(html).toContain("Auction runs after this section");
    // there is NO "final" flag control anywhere (§15.3).
    expect(html.toLowerCase()).not.toContain('name="final"');
    expect(html.toLowerCase()).not.toContain("mark final");
  });

  it("Rules builder: add-rule control + a pre-existing rule row + redirect-safety fields", async () => {
    const { html } = await editorHtmlWithContent();
    expect(html).toContain('id="lg-add-rule"');
    expect(html).toContain("data-rule-row");
    expect(html).toContain("data-rule-type");
    expect(html).toContain("data-rule-target-offer");
    expect(html).toContain("data-rule-redirect-url");
    expect(html).toContain("data-rule-allowlisted");
  });

  it("A/B panel renders the §16.2 allocation UI (percent inputs + Σ indicator + save) — no P8 placeholder", async () => {
    const { html } = await editorHtmlWithContent();
    // per-variant percent input (rendered class, panel-only) + the live Σ row.
    expect(html).toContain("lg-alloc-input");
    expect(html).toContain("lg-alloc-summary");
    expect(html).toContain("data-alloc-sum");
    expect(html).toContain('id="lg-ab-variant-list"');
    expect(html).toContain('id="lg-save-allocations"');
    expect(html).toContain('data-fork-variant="');
    // the P8 "ships in P8" seam placeholder is GONE.
    expect(html).not.toContain("data-p8-seam");
    expect(html).not.toMatch(/ship[s]? in P8/i);
  });

  it("A/B panel: create-experiment when none exists; start + assignment preview once a test exists", async () => {
    const noTest = await editorHtmlWithContent();
    // no test yet → Create A/B test, and NO assignment-preview / start controls
    // rendered (the ="…" attribute form is panel-only; the client JS references
    // the bare attribute name, so we match the rendered attribute specifically).
    expect(noTest.html).toContain('id="lg-create-experiment"');
    expect(noTest.html).not.toContain('data-preview-assignment="');
    expect(noTest.html).not.toContain('data-start-experiment="');

    // create an A/B test → the panel now offers Start + the assignment preview.
    const create = await admin.request(`${API}/quotes/${noTest.quotePublicId}/experiments`, jsonInit("POST", {}), noTest.env);
    expect(create.status, `create ab: ${await create.clone().text()}`).toBe(201);
    const html2 = await getHtml(noTest.env, `/admin/leadgen/quotes/${noTest.quotePublicId}/edit`);
    expect(html2).toContain('data-start-experiment="');
    expect(html2).toContain('data-preview-assignment="');
    expect(html2).toContain('id="lg-ab-preview-session"');
    expect(html2).toContain('id="lg-ab-preview-result"');
  });

  it("Activation panel lists sites with enable + slug + preview URL (§17)", async () => {
    const { html } = await editorHtmlWithContent();
    expect(html).toContain('data-panel="activation"');
    expect(html).toContain('data-site-id="site-1"');
    expect(html).toContain("data-site-enabled");
    expect(html).toContain("data-site-slug");
    expect(html).toContain("data-preview-url");
    expect(html).toContain("one.example.com/lg");
  });

  it("Analytics panel renders the §15.6 read-only table scaffold", async () => {
    const { html } = await editorHtmlWithContent();
    expect(html).toContain('id="lg-analytics-table"');
    expect(html).toContain('id="lg-analytics-body"');
  });

  it("escapes hostile quote + section names in the editor", async () => {
    const { html } = await editorHtmlWithContent();
    expect(html).not.toContain("<b>Quote</b>");
    expect(html).toContain("&lt;b&gt;Quote&lt;/b&gt;");
    expect(html).not.toContain("<i>First</i>");
    expect(html).toContain("&lt;i&gt;First&lt;/i&gt;");
  });

  it("404s in-shell for an unknown quote", async () => {
    const { env } = newHarness();
    const res = await admin.request(`/admin/leadgen/quotes/${mintPublicId("quote")}/edit`, {}, env);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Quote not found");
  });
});

// ---------------------------------------------------------------------------
// ES5-only inline scripts (token scan + node --check)
// ---------------------------------------------------------------------------

const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function extractScripts(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    if ((match[0] ?? "").includes('type="application/json"')) continue; // data blob, not a script
    blocks.push(match[1] ?? "");
  }
  return blocks;
}

const scratchDir = mkdtempSync(join(tmpdir(), "leadgen-quotes-parse-"));
let fileSeq = 0;

function parseError(label: string, source: string): string | null {
  const file = join(scratchDir, `${++fileSeq}-${label.replace(/[^\w-]/g, "_")}.js`);
  writeFileSync(file, source, "utf-8");
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    return null;
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err);
    return `${label}: ${stderr.split("\n").slice(0, 5).join("\n")}`;
  }
}

describeDb("leadgen quotes pages — ES5-only inline scripts", () => {
  async function renderedPages(): Promise<Array<[string, string]>> {
    const { html } = await editorHtmlWithContent();
    const { env } = newHarness();
    await createQuote(env);
    return [
      ["quotes-list", await getHtml(env, "/admin/leadgen/quotes")],
      ["quotes-new", await getHtml(env, "/admin/leadgen/quotes/new")],
      ["quote-editor", html],
    ];
  }

  it("every inline <script> is ES5 (no arrow/const/let/async/await/backtick)", async () => {
    for (const [label, html] of await renderedPages()) {
      const scripts = extractScripts(html);
      expect(scripts.length, `${label} must ship an inline script`).toBeGreaterThan(0);
      for (const script of scripts) {
        expect(script, `${label} arrow`).not.toMatch(/=>/);
        expect(script, `${label} const`).not.toMatch(/\bconst\b/);
        expect(script, `${label} let`).not.toMatch(/\blet\b/);
        expect(script, `${label} async`).not.toMatch(/\basync\b/);
        expect(script, `${label} await`).not.toMatch(/\bawait\b/);
        expect(script, `${label} backtick`).not.toContain("`");
      }
    }
  });

  it("every emitted inline <script> parses as standalone JavaScript (node --check)", async () => {
    for (const [label, html] of await renderedPages()) {
      const errors: string[] = [];
      extractScripts(html).forEach((script, i) => {
        const err = parseError(`${label}-script${i + 1}`, script);
        if (err) errors.push(err);
      });
      expect(errors, errors.join("\n\n")).toEqual([]);
    }
  });
});
