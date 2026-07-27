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
  id: number;
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

describeDb("Quotes editor — the six sub-tabs (03 §9.4 / 06 §15–§17)", () => {
  // v2.5 B2 ADJUSTED: the head "Preview" button (`lg-variant-preview`) is
  // gone — the §4.1 frame canvas IS the preview (an always-on srcdoc iframe,
  // same id + sandbox contract as before).
  //
  // Round-4 P4b DELIBERATE RE-PIN (conductor-granted, operator restructure):
  // the standalone "Rules" top tab is REMOVED — routing rules now live
  // INSIDE the Funnel builder tab's right column.
  //
  // Round-4 P5b DELIBERATE RE-PIN (conductor-granted, operator restructure):
  // "Templates" and "Themes" are promoted to top-level tabs (ui-quotes.ts
  // renderTemplatesTabPanel / renderThemesTabPanel), inserted between
  // Funnel builder and A/B. Six tabs remain (builder/templates/themes/ab/
  // activation/analytics); this test asserts the four the assertions below
  // have always covered — templates/themes are proven by test-ui/__p5b-
  // quotes-ia.spec.ts instead (this file's assertions stay untouched, only
  // this comment + the two titles change).
  //
  // LEADGEN-REWORK-03 P3b RETIREMENT (§8.2/§10): the funnel-builder tab was
  // rebuilt into the library/board/rules-rail (contract §8.2) — the OLD frame
  // canvas (id="lg-preview-iframe", sandbox="allow-same-origin") and the OLD
  // embedded rules panel (id="lg-routing-rules-root", ui-rules-builder.ts
  // renderRoutingRulesPanel) are REMOVED, replaced by the board's own Preview
  // action (opens the real composed preview route in a new tab) and the §8.2
  // RIGHT quote-scoped routing-rules rail (id="lg-qr-rail",
  // ui-rules-builder.ts renderQuoteRulesRail). Replacement coverage: SSR —
  // test/leadgen-rework-board.test.ts + test/leadgen-rework-rules-ui.test.ts;
  // live gestures — test-ui/leadgen-rework-p3b-board.gesture.spec.ts (Preview
  // action) + test-ui/leadgen-rework-p3b-rules.gesture.spec.ts (rail).
  it("renders the (four of six) editor sub-tabs it covers + Save + the §8.2 board + its routing-rules rail", async () => {
    const { html } = await editorHtmlWithContent();
    for (const tab of ["builder", "ab", "activation", "analytics"]) {
      expect(html, `tab ${tab}`).toContain(`data-tab="${tab}"`);
      expect(html, `panel ${tab}`).toContain(`data-panel="${tab}"`);
    }
    // the removed standalone Rules tab/panel no longer exist
    expect(html).not.toContain('data-tab="rules"');
    expect(html).not.toContain('data-panel="rules"');
    // §8.2: the board + its routing-rules rail are embedded in the builder panel
    expect(html).toContain("data-board");
    expect(html).toContain('id="lg-qr-rail"');
    expect(html).toContain('id="lg-variant-save"');
    // the OLD frame canvas is gone (§8.2/§10) — the board's per-funnel
    // Preview action (data-pin="8.2-preview", quotes-tabs/funnel.ts) replaces
    // it. NOTE: a bare "data-preview" substring check would collide with the
    // Activation panel's ALWAYS-rendered data-preview-url attribute (a
    // different feature) — data-pin="8.2-preview" is the collision-free marker.
    expect(html).not.toContain('id="lg-preview-iframe"');
    expect(html).toContain('data-pin="8.2-preview"');
  });

  // LEADGEN-REWORK-03 P3b RETIREMENT (§8.2/§10): the §15.3 ordered flat
  // section list (id="lg-section-list"/"lg-add-section", data-section-id rows)
  // is REPLACED by the §8.2 board's library + per-page section chips —
  // replacement coverage: test/leadgen-rework-board.test.ts ("section chips
  // render...") + test-ui/leadgen-rework-p3b-board.gesture.spec.ts (library
  // drag + the "+ section" menu path).
  //
  // CONTRACT GAP — flagged in the P3b follow-up report, NOT authorized by any
  // §8.2/§10 citation, UPDATED per conductor ruling (§8.9): the §15.2 opening-
  // lander toggle/headline/subheadline/hero (id="lg-lander-enabled"/
  // "lg-lander-headline"/"lg-lander-sub"/"lg-lander-hero"), the §15.4 base
  // funnel-design selector (id="lg-funnel-design"), and the per-variant
  // auction FK picker (id="lg-auction-id") lost their ONLY admin surface
  // when the old structure panel (renderStructurePanel's "Funnel settings"
  // <details> block) was deleted with the board rebuild. The conductor RULED
  // this was NOT a sanctioned §10 removal (unlike the canvas/inspectors/old
  // rules grid, which §8.2/§10 explicitly call out) and ordered a pure
  // relocation: the SAME six controls, SAME ids, SAME PUT /variants/:id
  // fields, now live behind a "Funnel settings" item on the funnel column's
  // kebab, opening a dialog in the board's delete-guard dialog vocabulary
  // (data-funnel-settings). See test/leadgen-rework-board.test.ts for the
  // deeper coverage (kebab item + all-six-current-values from real seeded
  // data + the save-round-trip / no-wipe proof).
  it("Funnel builder: §8.2 board section chips replace the old section list; lander/design/auction controls relocated to the funnel kebab's Funnel settings dialog (conductor ruling, §8.9)", async () => {
    const { html } = await editorHtmlWithContent();
    expect(html).not.toContain('id="lg-section-list"');
    expect(html).not.toContain('id="lg-add-section"');
    // relocated: the funnel kebab menu lists "Funnel settings"...
    expect(html).toContain('data-menu-action="funnel-settings"');
    expect(html).toContain("Funnel settings");
    // ...opening a dialog in the board's delete-guard dialog vocabulary...
    expect(html).toContain("data-funnel-settings");
    // ...carrying the SAME six controls (SAME ids) the old builder had.
    expect(html).toContain('id="lg-lander-enabled"');
    expect(html).toContain('id="lg-lander-headline"');
    expect(html).toContain('id="lg-lander-sub"');
    expect(html).toContain('id="lg-lander-hero"');
    expect(html).toContain('id="lg-funnel-design"');
    expect(html).toContain('id="lg-auction-id"');
    // the board's own section-chip anatomy proves the replacement is real
    expect(html).toContain("data-sec-chip");
    expect(html).toContain("data-add-section");
  });

  // LEADGEN-REWORK-03 P3b RETIREMENT (§8.2/§10): the OLD structure panel's
  // "Auction runs after this slide" INDICATOR (data-auction-entry="1", a
  // builder-only informational hint) was rendered by renderStructurePanel,
  // which the §8.2 board rebuild replaces. Neither the contract nor the P0
  // pack specifies an equivalent visual indicator anywhere on the board — a
  // contract-silent gap (purely cosmetic; UNLIKE the lander/design/auction
  // controls above, no DATA or CAPABILITY is lost). The underlying §4.3-12
  // auction-timing BEHAVIOR ("Auction fires after the last page of the served
  // variant's plan") is unaffected and proven elsewhere — this file never
  // asserted the runtime behavior itself, only this SSR hint — see
  // test/leadgen-rework-routing.test.ts / test/leadgen-rework-runtime.test.ts
  // / test/leadgen-funnel.test.ts for the live-behavior proofs. There is
  // still NO "final" flag control anywhere (§15.3 invariant unchanged).
  it("the old auction-entry SSR hint is gone (§8.2 board replaces the structure panel; no 'final' flag control anywhere)", async () => {
    const { html } = await editorHtmlWithContent();
    expect(html).not.toContain('data-auction-entry="1"');
    expect(html.toLowerCase()).not.toContain('name="final"');
    expect(html.toLowerCase()).not.toContain("mark final");
  });

  // LEADGEN-REWORK-03 M3/§13-D5 RETIREMENT: the OLD per-variant hidden rule
  // grid (id="lg-add-rule", data-rule-row/-type/-target-offer/-redirect-url/
  // -allowlisted — renderRuleRow/renderRulesPanel, deleted with the §8.2 board
  // rebuild) covered leadgen_funnel_rules, whose CHECK is now tightened to
  // exactly the four auction-domain types (eligibility/disqualification/
  // redirect_direct_offer/auction_entry); their UI RELOCATES to the Auction
  // tab per contract §5-M3/§13-D5 (ui-auctions.ts, "Funnel eligibility rules"
  // panel, data-pin="d5-funnel-eligibility-rules") — a DIFFERENT file, proven
  // by test/leadgen-rework-rules-ui.test.ts (§13-D5's own coverage) +
  // test-ui/leadgen-rework-p3b-rules.gesture.spec.ts. The quote-SCOPED
  // routing-rules rail (§8.2 RIGHT, this page's replacement chrome) is
  // asserted above (id="lg-qr-rail").
  it("the old per-variant hidden rule grid is gone (§5-M3/§13-D5: relocated to the Auction tab)", async () => {
    const { html } = await editorHtmlWithContent();
    // Element-FORM checks (L-196 discipline — the shared QUOTE_EDITOR_SCRIPT
    // island still carries INERT byId()/querySelector('[data-rule-row]')-
    // style string literals referencing these now-absent ids/attributes;
    // flagged for the P5 orphan-scan removal sweep, not rendered chrome. A
    // bare substring check on the ATTRIBUTE NAME ALONE would false-positive
    // on those dead JS strings — these check the actual RENDERED opening-tag
    // forms renderRuleRow/renderRulesPanel used to emit.)
    expect(html).not.toContain('id="lg-add-rule"');
    expect(html).not.toContain('class="lg-rule-row" data-rule-row');
    expect(html).not.toContain('class="form-input" data-rule-target-offer');
  });

  it("A/B panel renders the §16.2 allocation UI (percent inputs + Σ indicator + save) — no P8 placeholder", async () => {
    const { html } = await editorHtmlWithContent();
    // per-variant percent input (rendered class, panel-only) + the live Σ row.
    expect(html).toContain("lg-alloc-input");
    expect(html).toContain("lg-alloc-summary");
    expect(html).toContain("data-alloc-sum");
    expect(html).toContain('id="lg-ab-variant-list"');
    expect(html).toContain('id="lg-save-allocations"');
    // LEADGEN-REWORK-03 P3b RETIREMENT (§8.2/§10): the "Fork this variant"
    // BUTTON (data-fork-variant="…") is REMOVED — the variant selector + Fork
    // bar above the tabs is gone; ab.ts's own "Add variant…" affordance
    // (asserted just above via lg-ab-variant-list context) is the
    // replacement, per §8.5. NOTE: a substring check on the bare text "Fork
    // this variant" would collide with themes.ts's UNRELATED "A/B this theme"
    // button's title tooltip ("Fork this variant with the picked preset…",
    // a different feature, not this slice's file) — the attribute is the
    // precise, collision-free marker for the REMOVED button specifically.
    expect(html).not.toContain('data-fork-variant="');
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

// ---------------------------------------------------------------------------
// 05 §5.2 (fix-contract v2.4, R5) — the Activation-tab preflight panel:
// server-verdict-driven blocking cards / green PASS checks, the head badge,
// and the 409-report + variant-save re-render wiring.
// ---------------------------------------------------------------------------

// A dynamic offer with REQUIRED provider fields, SELECTED on the section,
// with NO answer maps → missing_required_provider_fields (the normative
// §5.2 example: current_insurance.carrier + current_insurance.carrier_months).
function seedSelectedOfferMissingRequired(
  sdb: SqliteDb,
  sectionId: number,
  offerName: string,
): { offerPublicId: string } {
  const offerPublicId = mintPublicId("offer");
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, request_method, endpoint_production, status)
       VALUES (?, ?, 'Prov', 'quote_funnel', 'life', 's2s_postback', 'cpc', 1, 'response', 'server', 'POST', 'https://provider.example/q', 'active')`,
    )
    .run(offerPublicId, offerName);
  const offer = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(offerPublicId) as { id: number };
  const schemaPublic = mintPublicId("payload_schema_version");
  const schemaJson = JSON.stringify({
    version: 1,
    root: {
      type: "object",
      children: [
        { path: "current_insurance.carrier", name: "carrier", type: "string", source: "answer", internal_field: "f", required: true },
        { path: "current_insurance.carrier_months", name: "carrier_months", type: "string", source: "answer", internal_field: "f", required: true },
      ],
    },
  });
  sdb
    .prepare(
      "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, carrier_parse_json, carrier_parse_version, source) VALUES (?, ?, 1, ?, ?, 1, 'manual')",
    )
    .run(
      schemaPublic,
      offer.id,
      schemaJson,
      JSON.stringify({ carriers_path: "carriers", fields: { carrier_name: "name", bid: "bid", click_url: "url" } }),
    );
  const schema = sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = ?").get(schemaPublic) as { id: number };
  sdb.prepare("UPDATE leadgen_offers SET active_payload_schema_id = ? WHERE id = ?").run(schema.id, offer.id);
  sdb
    .prepare("INSERT INTO leadgen_section_available_offers (section_id, offer_id, selected, mapping_state) VALUES (?, ?, 1, 'selected')")
    .run(sectionId, offer.id);
  return { offerPublicId };
}

async function seedQuoteWithSection(
  opts: { sectionName: string } = { sectionName: "ZIP" },
): Promise<{ sdb: SqliteDb; env: Env; quotePublicId: string; sectionId: number; sectionPublicId: string }> {
  const { sdb, env } = newHarness();
  const q = await createQuote(env, { quote_name: "Preflight Q" });
  const variantId = q.funnels[0]!.variants[0]!.public_id;
  const section = seedSection(sdb, { activity: "quote_funnel", vertical: "life", name: opts.sectionName });
  const put = await admin.request(
    `${API}/variants/${variantId}`,
    jsonInit("PUT", { sections: [{ section_id: section.id }] }),
    env,
  );
  expect(put.status, `seed variant: ${await put.clone().text()}`).toBe(200);
  // Rework M2 (§4.3-1, §4.3-15): activation preflight now also requires the
  // quote's shared first page (leadgen_funnel_pages, quote_id-owned) to carry
  // ≥1 section — a SEPARATE section (never the variant's own, per §4.3-13
  // uniqueness), raw-inserted quote_id-owned (not variant_id-owned). Route
  // wiring for POST/PUT /quotes/:id/shared-page is mid-flight in another
  // round, so this seeds the SQL shape directly (mirrors
  // leadgen-rework-handlers.test.ts / leadgen-rework-routing.test.ts).
  const sharedSection = seedSection(sdb, { activity: "quote_funnel", vertical: "life", name: "Shared" });
  const sharedPagePublicId = mintPublicId("funnel_page");
  sdb.prepare("INSERT INTO leadgen_funnel_pages (public_id, quote_id, position, name) VALUES (?, ?, 0, NULL)").run(sharedPagePublicId, q.id);
  sdb
    .prepare(
      `INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position, page_id)
       VALUES (?, ?, 0, (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?))`,
    )
    .run(q.id, sharedSection.id, sharedPagePublicId);
  return { sdb, env, quotePublicId: q.public_id, sectionId: section.id, sectionPublicId: section.public_id };
}

describeDb("Quotes Activation preflight panel (05 §5.2)", () => {
  it("clean quote: PASS panel with green itemized checks + the Publishable head badge", async () => {
    const { env, quotePublicId } = await seedQuoteWithSection();
    const html = await getHtml(env, `/admin/leadgen/quotes/${quotePublicId}/edit`);
    expect(html).toContain('id="lg-preflight-panel"');
    expect(html).toContain('data-preflight-state="pass"');
    expect(html).toContain("Ready to activate — all preflight checks pass.");
    for (const check of [
      "section_mappings_complete",
      "required_provider_fields_mapped",
      "no_orphaned_provider_fields",
      "type_conversions_valid",
      "payload_schema_versions_present",
      "dependencies_resolve",
      "auction_config_valid",
      "participating_offers_eligible",
    ]) {
      expect(html, `pass check ${check}`).toContain(`data-preflight-check="${check}"`);
    }
    // the head chip reflects the SAME server verdict (authoritative) —
    // v2.5 B2 ADJUSTED to the 14 §14.2 count copy (was ">Publishable</span>").
    expect(html).toContain('data-publish-verdict="ok"');
    expect(html).toMatch(/data-publish-verdict="ok"[^>]*>Ready/);
    // no blocked panel/badge state anywhere (the ES5 renderer's string
    // constants legitimately live in the page script; the SSR state matters)
    expect(html).not.toContain('data-preflight-state="blocked"');
    expect(html).not.toContain('data-publish-verdict="blocked"');
    expect(html).not.toContain('class="lg-preflight-blocked-title"');
  });

  it("blocked quote: blocking card renders EXACTLY the operator copy pattern + both fix links", async () => {
    const { sdb, env, quotePublicId, sectionId, sectionPublicId } = await seedQuoteWithSection({ sectionName: "ZIP" });
    const { offerPublicId } = seedSelectedOfferMissingRequired(sdb, sectionId, "NextInsure");

    // the activation PUT HARD-BLOCKS (the server gate the panel mirrors)
    const put = await admin.request(
      `${API}/quotes/${quotePublicId}/activation/site-1`,
      jsonInit("PUT", { enabled: true, slug: "blocked-ui" }),
      env,
    );
    expect(put.status).toBe(409);
    const report = (await put.json()) as { error: string };
    expect(report.error).toBe("quote_activation_blocked");

    const html = await getHtml(env, `/admin/leadgen/quotes/${quotePublicId}/edit`);
    expect(html).toContain('data-preflight-state="blocked"');
    expect(html).toContain("Cannot activate this Quote.");
    expect(html).toContain('data-preflight-code="missing_required_provider_fields"');
    // the normative §5.2 operator copy pattern, verbatim
    expect(html).toContain(
      "Section: ZIP · Offer: NextInsure · Missing required provider fields: current_insurance.carrier, current_insurance.carrier_months",
    );
    expect(html).toContain(`href="/admin/leadgen/sections/${sectionPublicId}/edit#mapping"`);
    expect(html).toContain(">Open Section Mapping</a>");
    expect(html).toContain(`href="/admin/leadgen/offers/${offerPublicId}/edit#payload"`);
    expect(html).toContain(">Open Offer Payload Schema</a>");
    // DEV-59: the structure-panel dot mirrors the SAME verdict — the seeded
    // selected-but-unmapped offer reads "incomplete" in operator words.
    expect(html).toContain('data-mapping-status="incomplete" title="Offer mapping incomplete"');
    expect(html).not.toContain('data-mapping-status="unknown"');
    // the head chip flips to the blocked verdict — v2.5 B2 ADJUSTED to the
    // 14 §14.2 count copy (was ">Blocked from publish</span>"); this fixture
    // has exactly one blocking row → "Blocked (1 error)".
    expect(html).toContain('data-publish-verdict="blocked"');
    expect(html).toMatch(/data-publish-verdict="blocked"[^>]*>Blocked \(\d+ errors?\)/);
  });

  it("hostile section/offer names render escaped inside the blocking card", async () => {
    const { sdb, env, quotePublicId, sectionId } = await seedQuoteWithSection({
      sectionName: '<img src=x onerror=alert(1)>',
    });
    seedSelectedOfferMissingRequired(sdb, sectionId, "<b>EvilOffer</b>");
    const html = await getHtml(env, `/admin/leadgen/quotes/${quotePublicId}/edit`);
    expect(html).toContain('data-preflight-state="blocked"');
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<b>EvilOffer</b>");
    expect(html).toContain("&lt;b&gt;EvilOffer&lt;/b&gt;");
  });

  it("offer_ineligible block fields render as §5.1 operator labels, never raw codes", async () => {
    // an auction whose participating dynamic offer has NO schema/test →
    // the §5.1 leg of the preflight (offer_ineligible with reason codes).
    const { sdb, env, quotePublicId } = await seedQuoteWithSection();
    const offerPublicId = mintPublicId("offer");
    sdb
      .prepare(
        `INSERT INTO leadgen_offers
           (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type,
            calls_provider_api, bid_source, status)
         VALUES (?, 'Unready Dyn', 'quote_funnel', 'life', 's2s_postback', 'cpc', 1, 'response', 'active')`,
      )
      .run(offerPublicId);
    const offer = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(offerPublicId) as { id: number };
    const placementPublic = mintPublicId("offer_placement");
    sdb
      .prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, 'plc-x', 1)")
      .run(placementPublic, offer.id);
    const placement = sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(placementPublic) as { id: number };
    const auctionPublic = mintPublicId("auction");
    sdb
      .prepare(
        `INSERT INTO leadgen_auctions
           (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
            surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
            backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
         VALUES (?, 'A', 'dynamic', 'highest_bid', 'percentage_of_max', 10, 'enabled', 1, 5, 3, 10, 'disabled', 'on_slot_exhaustion', 1, 'offer', 2500, 1, 'active')`,
      )
      .run(auctionPublic);
    const auction = sdb.prepare("SELECT id FROM leadgen_auctions WHERE public_id = ?").get(auctionPublic) as { id: number };
    sdb
      .prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, enabled) VALUES (?, ?, ?, 0, 1)")
      .run(auction.id, placement.id, offer.id);
    const variantRow = sdb
      .prepare(
        "SELECT v.public_id FROM leadgen_funnel_variants v JOIN leadgen_funnels f ON f.id = v.funnel_id JOIN leadgen_quotes q ON q.id = f.quote_id WHERE q.public_id = ?",
      )
      .get(quotePublicId) as { public_id: string };
    sdb.prepare("UPDATE leadgen_funnel_variants SET auction_id = ? WHERE public_id = ?").run(auction.id, variantRow.public_id);

    const html = await getHtml(env, `/admin/leadgen/quotes/${quotePublicId}/edit`);
    expect(html).toContain('data-preflight-code="offer_ineligible"');
    expect(html).toContain("Participating offer is not eligible for live auction");
    // §5.1 reason codes mapped to operator labels in the card text
    expect(html).toContain("No active payload schema");
    expect(html).toContain("Provider test has not been run yet");
    // the raw codes never appear as visible card text (only labels)
    expect(html).not.toContain("no_active_schema,");
    expect(html).not.toContain("Offer: Unready Dyn · offer_ineligible");
  });

  it("the editor script wires the 409 report + variant-save verdict into the panel (re-render, no raw JSON)", async () => {
    const { env, quotePublicId } = await seedQuoteWithSection();
    const html = await getHtml(env, `/admin/leadgen/quotes/${quotePublicId}/edit`);
    // 409 report path: typed error → renderPreflight(report.blocks + the C2
    // §3.6 problems rows), operator message
    expect(html).toContain("quote_activation_blocked");
    expect(html).toContain("renderPreflight({ ok: false, blocks: res.body.blocks || [], problems: res.body.problems || [] })");
    expect(html).toContain("status: r.status");
    // variant save + activation PUT success both re-render the panel
    expect(html).toContain("res.body.activation_preflight");
    // the client renderer builds the SAME operator copy + fix links —
    // v2.5 B2 ADJUSTED: the chip re-renderer now carries the 14 §14.2 count
    // copy constants (was the fixed "'Blocked from publish'" string).
    expect(html).toContain("'Cannot activate this Quote.'");
    expect(html).toContain("'Open Section Mapping'");
    expect(html).toContain("'Open Offer Payload Schema'");
    expect(html).toContain("'Blocked (' + errors +");
    expect(html).toContain("' error' : ' errors'");
    expect(html).toContain("'Ready (' + warnings +");
    // ALL 8 preflight block-code labels ship in the embedded map
    for (const pair of [
      '"missing_required_provider_fields":"Missing required provider fields"',
      '"orphaned_provider_fields":"Mapped provider fields no longer exist in the active payload schema"',
      '"type_conversion_invalid":"Answer type conversion is invalid for provider fields"',
      '"payload_schema_version_missing":"The selected offer has no active payload schema version"',
      '"dependency_missing_field":"A visibility condition references a missing field"',
      '"mapping_incomplete":"Offer mapping is incomplete"',
      '"auction_config_invalid":"Auction configuration is invalid"',
      '"offer_ineligible":"Participating offer is not eligible for live auction"',
    ]) {
      expect(html, `embedded label ${pair}`).toContain(pair);
    }
    // ALL 8 §5.1 eligibility reason labels ship for offer_ineligible fields
    for (const pair of [
      '"no_active_schema":"No active payload schema"',
      '"schema_validation_errors":"Active payload schema has validation errors"',
      '"test_untested":"Provider test has not been run yet"',
      '"test_failed":"Last provider test failed"',
      '"endpoint_missing":"No endpoint configured for the live (production) environment"',
      '"invalid_headers":"A request header cannot resolve (empty name or missing macro/secret reference)"',
      '"carrier_parse_missing":"Response parsing (carrier parse) is not configured"',
      '"carrier_parse_invalid":"Response parsing (carrier parse) configuration is invalid"',
    ]) {
      expect(html, `embedded eligibility label ${pair}`).toContain(pair);
    }
  });
});
