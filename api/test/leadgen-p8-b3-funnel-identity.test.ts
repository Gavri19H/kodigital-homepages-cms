// LeadGen R2 fixing mission — Phase P8-1 S1.2 (P8-DEFECT-CONTRACT v3, B2/B3
// register, contract R6-1): a theme edit from one funnel's chip must write to
// THAT funnel; the chip must name the funnel's current theme.
//
// GROUND FACTS (conductor's live-browser repro, docs/leadgen/r2/evidence/p8/
// b3/repro-before.md): with 4 funnels on the board, clicking a NON-selected
// funnel's Theme chip then editing Brand primary issued GET+PUT
// /funnels/<the EDITOR-SELECTED funnel>/theme — never the clicked funnel.
// Root cause: quotes-tabs/themes.ts's ONLY funnel source was
// #lg-quote-editor[data-funnel-public-id] (a single editor-selected funnel,
// frozen at page load) regardless of which column's chip was clicked. The
// Theme chip also always rendered the static literal "Theme".
//
// Covers, per the P8-1 S1.2 slice contract:
//   (a) the rendered Theme/Template chips carry a funnel-identity attribute,
//       DISTINCT per column (quotes-tabs/funnel.ts's renderFunnelColumn,
//       driven through the REAL admin router's SSR board page — never a
//       hand-built fixture).
//   (b) the Themes island (quotes-tabs/themes.ts's THEMES_TAB_SCRIPT) derives
//       its GET/PUT target funnel from a chip-carried context when present on
//       #lg-quote-editor, the editor-default funnel otherwise — executed as
//       the REAL served script (node:vm), fetch wired to the REAL admin
//       router, the repo's existing island-probe idiom
//       (test/leadgen-p2-fixfirst-r2.test.ts's bootThemesIsland, duplicated
//       here per this repo's stated per-file harness convention — see
//       src/scripts/capture-p3a-presplit.ts's header).
//   (c) the Theme chip's label reflects the funnel's OWN stored theme_json
//       (null -> "Default", inline -> "Custom", {theme_id} -> the id — no
//       preset-name lookup is threaded to the board; a named gap).
//
// P8-1 S1.6 (B3/R6-1, second leg — extends the above): the Template chip's
// identity-carry now has a consumer. quotes-tabs/funnel.ts's Template-chip
// click mirrors the Theme chip's carry exactly (same ordering trap), and
// quotes-tabs/templates.ts's TPL_SCRIPT now reads it via
// targetFunnelPublicId()/targetVariantPublicId() (same carried-attr-first/
// editor-default-fallback semantics as themes.ts), applied to every
// boot-funnel/variant-identity call site in that file: the canvas preview
// (POST /variants/:id/preview), "Apply to funnel" (POST /funnels/:id/
// apply-template), and "A/B templates" (fork + PUT). Covers below:
//   (a2) the Template chip's click handler now carries (string-level guard,
//        retiring the old "still a bare gotoTab" pin — see its comment).
//   (b2) templates.ts's resolver is carried-attr-first/editor-fallback,
//        proven end-to-end via the canvas-preview POST (the one call site
//        that fires unprompted at boot, no dialog-click simulation needed);
//        the other two call sites route through these SAME two resolver
//        functions by construction.
// The Theme chip's label (part (c) below) still falls back to the raw
// {theme_id} — re-investigated for S1.6: no SSR-side theme-preset catalog is
// threaded into renderBuilderPanel/renderFunnelColumn (only `templates:
// FrameTemplateItem[]` is, for the Template chip), and the one client-side
// fetch of GET /api/admin/leadgen/themes left in quotes-tabs/funnel.ts
// (loadThemePresetOptions) targets #lg-theme-preset-select, an id with no
// SSR markup anywhere in this file (adjacent dead code, unrelated to this
// slice, not touched) — so no reachable name source exists without adding a
// new fetch/endpoint, which is out of scope for a label.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import { QUOTE_EDITOR_SCRIPT } from "../src/admin/leadgen/quotes-tabs/funnel";
import { renderThemesTabPanel } from "../src/admin/leadgen/quotes-tabs/themes";
import { renderTemplatesTabPanel } from "../src/admin/leadgen/quotes-tabs/templates";
import { renderOverrideSwitch } from "../src/admin/leadgen/quotes-tabs/shared";
import { mintPublicId } from "../src/leadgen/ids";
import type { Env } from "../src/env";

// ===========================================================================
// string-level guard on the served QUOTE_EDITOR_SCRIPT (funnel.ts's island)
// ===========================================================================

// Balanced-brace slicer for a named `function <name>(…) { … }` declaration in
// a served island string — returns EVERY copy (this page emits several
// separate top-level IIFEs, and a helper each of them needs is DECLARED in
// each of them; see the cross-scope structural test at the bottom).
function sliceIslandFns(src: string, name: string): string[] {
  const out: string[] = [];
  const needle = `function ${name}(`;
  let from = 0;
  for (;;) {
    const at = src.indexOf(needle, from);
    if (at === -1) return out;
    const open = src.indexOf("{", at);
    let depth = 0;
    let i = open;
    for (; i < src.length; i += 1) {
      const ch = src.charAt(i);
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(src.slice(at, i + 1));
    from = i + 1;
  }
}

// P8-1 F1 (B3/R6-1 round 2) — RE-MINTED PINS. The three assertions that used
// to live here froze the ROUND-1 mechanism, which is the defect this round
// fixes: the chip carried its funnel in a transient
// `data-carried-funnel-public-id` attribute on #lg-quote-editor, and the
// plain-tab-click listener DELETED it. The retired lines were, verbatim:
//   1. `const setIdx = QUOTE_EDITOR_SCRIPT.indexOf("setCarriedChipFunnel(tpChip.getAttribute(");`
//      + `expect(setIdx …).toBeGreaterThan(gotoIdx)`  (the ordering trap)
//   2. `expect(QUOTE_EDITOR_SCRIPT).toContain("clearCarriedChipFunnel(); activate(this.getAttribute('data-tab'));");`
//   3. the same ordering pair for `setCarriedChipFunnel(tplChip.getAttribute(`
// Pin 2 asserted the CLEAR that made the owner's defect come straight back
// after Themes -> Activation -> Themes (the fresh-context reviewer drove
// exactly that and measured the write landing on the editor-selected funnel).
// What the re-minted pins below still protect, one for one: (1)+(3) each chip
// still scopes the destination tab to ITS OWN column's funnel id — nothing
// else; (2) a plain tab click is now proven NOT to drop that target, plus the
// tab itself is persisted, which is what makes the target survive the trip.
describe("P8-1 F1 (contract R6-1) — chip clicks set a PERSISTED target funnel; a plain tab click never drops it (string-level guard)", () => {
  // The chip handler's OWN block (`var <n>Chip = t.closest(...)` up to the
  // handler's `return;`) — never a whole-script indexOf, which would compare
  // against an unrelated gotoTab('templates') elsewhere in the island.
  function chipHandlerBlock(varName: string, pickerAttr: string): string {
    const at = QUOTE_EDITOR_SCRIPT.indexOf(`var ${varName} = t.closest('[${pickerAttr}]');`);
    expect(at, `${pickerAttr} handler block`).toBeGreaterThan(-1);
    const end = QUOTE_EDITOR_SCRIPT.indexOf("return;", at);
    expect(end, `${pickerAttr} handler end`).toBeGreaterThan(at);
    return QUOTE_EDITOR_SCRIPT.slice(at, end);
  }

  it("the Theme chip's click handler targets ITS OWN column's funnel, then navigates", () => {
    const block = chipHandlerBlock("tpChip", "data-theme-picker");
    expect(block).toContain("setTargetFunnel(tpChip.getAttribute('data-chip-funnel-public-id'));");
    expect(
      block.indexOf("setTargetFunnel(tpChip.getAttribute("),
      "the target is set before navigating, so the panel opens already naming that funnel",
    ).toBeLessThan(block.indexOf("gotoTab('themes')"));
  });

  it("the Template chip's click handler targets ITS OWN column's funnel, then navigates", () => {
    const block = chipHandlerBlock("tplChip", "data-template-picker");
    expect(block).toContain("setTargetFunnel(tplChip.getAttribute('data-chip-funnel-public-id'));");
    expect(block.indexOf("setTargetFunnel(tplChip.getAttribute("), "the target is set before navigating").toBeLessThan(
      block.indexOf("gotoTab('templates')"),
    );
  });

  it("a plain top-bar tab-button click activates the tab and DROPS NOTHING — no code path clears the target funnel", () => {
    expect(QUOTE_EDITOR_SCRIPT).toContain("tabs[ti].addEventListener('click', function () { activate(this.getAttribute('data-tab')); });");
    // Round 1's clear, in every shape it could return as — measured over
    // CODE ONLY (splitTopLevelCodeScopes blanks comment/string content), so a
    // comment naming the retired mechanism can never satisfy or fail this.
    const code = splitTopLevelCodeScopes(QUOTE_EDITOR_SCRIPT).join("\n");
    expect(code).not.toContain("clearCarriedChipFunnel");
    expect(code).not.toContain("setCarriedChipFunnel");
    // The attribute itself, as a quoted literal (prose mentioning the retired
    // mechanism by name is not a use of it).
    expect(QUOTE_EDITOR_SCRIPT).not.toContain("'data-carried-funnel-public-id'");
    expect(QUOTE_EDITOR_SCRIPT).not.toContain("'data-carried-variant-public-id'");
  });

  it("activate() persists the tab, so a reload returns to it, and the load path honours it", () => {
    expect(QUOTE_EDITOR_SCRIPT).toContain("lgSetHashParam('tab', name);");
    expect(QUOTE_EDITOR_SCRIPT).toContain("function honourPersistedTab()");
    expect(QUOTE_EDITOR_SCRIPT).toContain("document.addEventListener('DOMContentLoaded', honourPersistedTab)");
  });

  it("every emitted scope that reads/writes the target carries its OWN byte-identical copy of the two hash helpers (no cross-scope closure, no drift)", () => {
    const themesIsland = renderThemesTabPanel(true);
    const templatesIsland = renderTemplatesTabPanel(true, []);
    for (const name of ["lgHashParam", "lgSetHashParam"] as const) {
      const copies = [
        ...sliceIslandFns(QUOTE_EDITOR_SCRIPT, name),
        ...sliceIslandFns(themesIsland, name),
        ...sliceIslandFns(templatesIsland, name),
      ];
      // funnel.ts's tab-router scope + its board scope + themes + templates.
      expect(copies.length, `${name} copies across the page's separate top-level scopes`).toBe(4);
      for (const copy of copies) expect(copy, `${name} copies must stay byte-identical`).toBe(copies[0]);
    }
  });
});

// ===========================================================================
// D1 harness (repo pattern; see test/leadgen-themes-threepane-r2.test.ts,
// test/leadgen-p2-fixfirst-r2.test.ts, test/leadgen-board-defects-r2.test.ts)
// ===========================================================================

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
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return out;
    },
  } as unknown as D1Database;
}

function makeKvStub(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
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
  "0045_leadgen_persona_quota.sql",
  "0046_leadgen_rework_m1_variants.sql",
  "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql",
  "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql",
  "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql",
  "0053_leadgen_rework_m12_othergroup_retirement.sql",
  "0054_leadgen_analytics_routing_dims.sql",
  "0055_leadgen_quote_default_template.sql",
] as const;

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  // `sites` carries `domain`: quoteActivationHandler (quotes-handlers.ts) reads
  // `s.domain` for the §17.2 tenant-host preview URL, and the quote-editor page
  // loads its activation blob through that very handler. Without the column
  // every page render in this file logged `no such column: s.domain` (17 times
  // in the P8-1 gate run) and rendered with activation = null — 37 tests
  // asserting against a page no operator sees. Column set mirrors migration
  // 0002's sites table for the columns this path touches, as the sibling
  // leadgen-quotes-ui / leadgen-quote-builder-seam harnesses already do.
  runSql(sdb, "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);");
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
}

function buildEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db,
    CACHE: kv,
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
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(): { sdb: SqliteDb; env: Env } {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), makeKvStub()) };
}

const API = "/api/admin/leadgen";

function jsonInit(method: string, body?: unknown): RequestInit {
  return body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function json<T>(res: Response, label: string): Promise<T> {
  const body = (await res.json()) as T;
  expect(res.status, `${label}: ${JSON.stringify(body)}`).toBeLessThan(300);
  return body;
}

// ===========================================================================
// fixture: one quote, three funnel columns — A (no theme), B (a {theme_id}
// preset pointer), C (an inline override) — seeded through the REAL admin
// router (POST /quotes, POST /quotes/:id/funnels, POST /themes, PUT
// /funnels/:id/theme), never a hand-built StructureBody.
// ===========================================================================

interface FunnelCreateResponse {
  public_id: string;
  variants: Array<{ public_id: string }>;
}

interface ThreeFunnelFixture {
  quotePublicId: string;
  funnelA: string;
  variantA: string;
  funnelB: string;
  variantB: string;
  funnelC: string;
  variantC: string;
  presetId: string;
}

async function createPreset(env: Env, name: string): Promise<string> {
  const created = await json<{ item: { id: string } }>(
    await admin.request(
      `${API}/themes`,
      jsonInit("POST", {
        name,
        roles: { brand_primary: "#1B3A5C", accent: "#F5C518", page_bg: "#F4F6F9", card: "#FFFFFF", text: "#1A1F36", success: "#0E7C3A", error: "#B23A2C" },
        typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
        controls: { field_height: "medium", button_size: "m", corners: "rounded" },
      }),
      env,
    ),
    "create preset",
  );
  return created.item.id;
}

async function putFunnelTheme(env: Env, funnelPublicId: string, themeJson: Record<string, unknown>): Promise<void> {
  await json(await admin.request(`${API}/funnels/${funnelPublicId}/theme`, jsonInit("PUT", { theme_json: themeJson }), env), `assign theme to ${funnelPublicId}`);
}

async function seedThreeFunnelBoard(env: Env): Promise<ThreeFunnelFixture> {
  const quote = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: `P8 B3 ${mintPublicId("quote")}`, activity: "quote_funnel", verticals: ["auto"], funnel_name: "Funnel A" }), env),
    "create quote (funnel A)",
  );
  const funnelB = await json<FunnelCreateResponse>(
    await admin.request(`${API}/quotes/${quote.public_id}/funnels`, jsonInit("POST", { funnel_name: "Funnel B" }), env),
    "create funnel B",
  );
  const funnelC = await json<FunnelCreateResponse>(
    await admin.request(`${API}/quotes/${quote.public_id}/funnels`, jsonInit("POST", { funnel_name: "Funnel C" }), env),
    "create funnel C",
  );
  const presetId = await createPreset(env, "Ocean Blue");
  // Funnel A: theme_json stays NULL (no PUT at all) -> chip label "Default".
  await putFunnelTheme(env, funnelB.public_id, { theme_id: presetId }); // -> chip label falls back to the raw id (no name threaded to the board)
  await putFunnelTheme(env, funnelC.public_id, { palette: { brand_primary: "#112233" } }); // inline -> chip label "Custom"

  return {
    quotePublicId: quote.public_id,
    funnelA: quote.funnels[0]!.public_id,
    variantA: quote.funnels[0]!.variants[0]!.public_id,
    funnelB: funnelB.public_id,
    variantB: funnelB.variants[0]!.public_id,
    funnelC: funnelC.public_id,
    variantC: funnelC.variants[0]!.public_id,
    presetId,
  };
}

function sliceColumn(html: string, funnelPublicId: string): string {
  // NOT a bare data-funnel-public-id="..." marker: #lg-quote-editor's OWN
  // root attribute (ui-quotes.ts) carries that same attribute name for the
  // EDITOR-selected funnel and renders earlier in the page than the board —
  // anchor on the column div's own adjacent attribute pair instead.
  const marker = `data-funnel-col data-funnel-public-id="${funnelPublicId}"`;
  const at = html.indexOf(marker);
  expect(at, `column marker for ${funnelPublicId}`).toBeGreaterThan(-1);
  const divStart = html.lastIndexOf('<div class="lg-col lg-col-funnel', at);
  expect(divStart, `column div start for ${funnelPublicId}`).toBeGreaterThan(-1);
  const nextColAt = html.indexOf('<div class="lg-col lg-col-funnel', divStart + 1);
  const stubAt = html.indexOf("data-add-funnel", divStart + 1);
  let end = html.length;
  if (nextColAt > -1) end = Math.min(end, nextColAt);
  if (stubAt > -1) end = Math.min(end, stubAt);
  return html.slice(divStart, end);
}

// ===========================================================================
// part (a)+(c) — rendered chips: per-column identity + the theme label
// ===========================================================================

describeDb("P8 B3 (contract R6-1) — part (a): rendered Theme/Template chips carry a per-column funnel identity", () => {
  it("the Theme and Template chips each carry THEIR OWN column's funnel public id + active variant, distinct across columns", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    const html = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();

    const columns: Array<[string, string]> = [
      [fx.funnelA, fx.variantA],
      [fx.funnelB, fx.variantB],
      [fx.funnelC, fx.variantC],
    ];
    for (const [funnel, variant] of columns) {
      const col = sliceColumn(html, funnel);
      expect(col, `theme chip identity for ${funnel}`).toMatch(
        new RegExp(`data-theme-picker[\\s\\S]{0,400}data-chip-funnel-public-id="${funnel}"[\\s\\S]{0,200}data-chip-funnel-active-variant="${variant}"`),
      );
      expect(col, `template chip identity for ${funnel}`).toMatch(
        new RegExp(`data-template-picker[\\s\\S]{0,400}data-chip-funnel-public-id="${funnel}"[\\s\\S]{0,200}data-chip-funnel-active-variant="${variant}"`),
      );
      for (const [otherFunnel] of columns) {
        if (otherFunnel !== funnel) expect(col, `${funnel}'s column must not carry ${otherFunnel}`).not.toContain(otherFunnel);
      }
    }
    sdb.close();
  });

  it("the Theme chip's label reflects the funnel's OWN stored theme_json: null -> Default, inline -> Custom, {theme_id} -> the id", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    const html = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();

    const colA = sliceColumn(html, fx.funnelA);
    expect(colA, "no theme set -> Default").toMatch(/data-theme-picker[\s\S]{0,400}>Default<\/span>/);
    const colB = sliceColumn(html, fx.funnelB);
    expect(colB, "theme_id preset pointer -> the raw id (no name threaded to the board — named gap)").toMatch(
      new RegExp(`data-theme-picker[\\s\\S]{0,400}>${fx.presetId}</span>`),
    );
    const colC = sliceColumn(html, fx.funnelC);
    expect(colC, "inline override -> Custom").toMatch(/data-theme-picker[\s\S]{0,400}>Custom<\/span>/);
    sdb.close();
  });
});

// ===========================================================================
// part (b) — the island sandbox (adapted from test/leadgen-p2-fixfirst-r2
// .test.ts's bootThemesIsland — per-file harness duplication is this repo's
// stated convention, see src/scripts/capture-p3a-presplit.ts's header).
// Extended with a fourth param: the chip-carried funnel/variant this P8 B3
// fix reads from #lg-quote-editor at action time (null = no chip context,
// i.e. today's editor-default behaviour).
// ===========================================================================

// P8-1 F1: the page-level state the three islands share — the URL hash (the
// persisted target, written by whichever island the operator used) and the
// board's own funnel rows (#lg-board-data, quotes-tabs/funnel.ts's
// boardDataBlob). A test mutates `hash` ONLY through funnel.ts's own served
// helper (pageHashApi below), never by hand.
interface PageState {
  hash: string;
  funnels: Array<{ public_id: string; name: string; active_variant_public_id: string }>;
}

function boardPage(fx: ThreeFunnelFixture, hash = ""): PageState {
  return {
    hash,
    funnels: [
      { public_id: fx.funnelA, name: "Funnel A", active_variant_public_id: fx.variantA },
      { public_id: fx.funnelB, name: "Funnel B", active_variant_public_id: fx.variantB },
      { public_id: fx.funnelC, name: "Funnel C", active_variant_public_id: fx.variantC },
    ],
  };
}

function windowStubFor(page: PageState, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    location: {
      pathname: "/admin/leadgen/quotes/x/edit",
      search: "",
      get hash() {
        return page.hash;
      },
      set hash(v: string) {
        page.hash = v;
      },
    },
    history: {
      replaceState(_state: unknown, _title: string, url: string) {
        const at = url.indexOf("#");
        page.hash = at === -1 ? "" : url.slice(at);
      },
    },
    ...extra,
  };
}

// The REAL producer: quotes-tabs/funnel.ts's OWN served lgHashParam/
// lgSetHashParam bytes, executed. A "plain tab click" in the tests below is
// this function called exactly the way activate() calls it — never a
// hand-written hash string (E11: the producer side of this boundary is real).
function pageHashApi(page: PageState): { read(name: string): string; write(name: string, value: string): void } {
  const src = sliceIslandFns(QUOTE_EDITOR_SCRIPT, "lgHashParam")[0]! + "\n" + sliceIslandFns(QUOTE_EDITOR_SCRIPT, "lgSetHashParam")[0]!;
  return runInNewContext(`${src}\n({ read: lgHashParam, write: lgSetHashParam })`, { window: windowStubFor(page) }) as {
    read(name: string): string;
    write(name: string, value: string): void;
  };
}

interface IslandHandle {
  fire(kind: "change" | "click", target: Record<string, unknown>): void;
  dispatchDoc(type: string, detail?: unknown): void;
  pickFunnel(publicId: string): void;
  headerName(): string;
  pickerOptions(): Array<{ value: string; label: string }>;
  calls: Array<{ url: string; method: string; body: unknown }>;
  flushTimer(): void;
  settle(): Promise<void>;
}

function bootThemesIsland(
  env: Env,
  defaultFunnelPublicId: string,
  defaultVariantPublicId: string,
  page: PageState,
): IslandHandle {
  const html = renderThemesTabPanel(true);
  const script = html.slice(html.lastIndexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));

  const listeners: Record<string, Array<(ev: unknown) => void>> = { change: [], click: [] };
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const pending: Array<Promise<unknown>> = [];
  let timerFn: (() => void) | null = null;

  const el = (): Record<string, unknown> => ({
    textContent: "",
    className: "",
    style: {},
    firstChild: null,
    value: "",
    appendChild() {},
    removeChild() {},
    setAttribute() {},
    getAttribute: () => null,
    addEventListener(kind: string, fn: (ev: unknown) => void) {
      if (listeners[kind] !== undefined) listeners[kind]!.push(fn);
    },
    querySelectorAll: () => [],
    focus() {},
  });
  const rail = el();
  const stableById: Record<string, Record<string, unknown>> = {};
  const docListeners: Record<string, Array<(ev: unknown) => void>> = {};
  // P8-1 F1 — the three page elements this fix touches: the board's funnel
  // blob (the panel's ONLY funnel-name source), the scope line's name slot,
  // and the funnel picker.
  const boardData = { textContent: JSON.stringify({ funnels: page.funnels }) };
  const nameEl = { textContent: "" };
  const pickerListeners: Array<(ev: unknown) => void> = [];
  const picker = {
    value: "",
    options: [] as Array<Record<string, unknown>>,
    className: "",
    style: {},
    get firstChild() {
      return this.options.length > 0 ? this.options[0]! : null;
    },
    appendChild(child: Record<string, unknown>) {
      this.options.push(child);
    },
    removeChild(child: Record<string, unknown>) {
      const at = this.options.indexOf(child);
      if (at >= 0) this.options.splice(at, 1);
    },
    setAttribute() {},
    getAttribute: (n: string) => (n === "data-lg-target-funnel" ? "" : null),
    addEventListener(kind: string, fn: (ev: unknown) => void) {
      if (kind === "change") pickerListeners.push(fn);
    },
    querySelectorAll: () => [],
    focus() {},
  };
  const editorRoot = {
    getAttribute(name: string) {
      if (name === "data-funnel-public-id") return defaultFunnelPublicId;
      if (name === "data-variant-public-id") return defaultVariantPublicId;
      return null;
    },
  };
  const root = {
    getAttribute: (n: string) => (n === "data-is-control" ? "true" : null),
    querySelectorAll: () => [],
  };
  const document = {
    querySelector(sel: string) {
      if (sel === "[data-lg-themes-tab]") return root;
      if (sel === "#lg-quote-editor") return editorRoot;
      return null;
    },
    getElementById(id: string) {
      if (id === "lg-theme-rail") return rail;
      if (id === "lg-board-data") return boardData;
      if (id === "lg-theme-target-name") return nameEl;
      if (id === "lg-theme-target-select") return picker;
      if (stableById[id] === undefined) stableById[id] = el();
      return stableById[id];
    },
    createElement: () => ({ value: "", textContent: "", selected: false }),
    createTextNode: () => ({}),
    addEventListener(kind: string, fn: (ev: unknown) => void) {
      (docListeners[kind] ??= []).push(fn);
    },
  };
  const win = windowStubFor(page, {
    setTimeout(fn: () => void) {
      timerFn = fn;
      return 1;
    },
    clearTimeout() {
      timerFn = null;
    },
  });
  const fetchShim = (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    let parsedBody: unknown = null;
    if (typeof init?.body === "string") {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    calls.push({ url, method, body: parsedBody });
    const p = Promise.resolve(admin.request(`http://localhost${url}`, init as RequestInit, env));
    pending.push(p);
    return p;
  };

  runInNewContext(script, { document, window: win, fetch: fetchShim, JSON, Object, String, Boolean, Number });

  return {
    fire(kind, target) {
      for (const fn of listeners[kind] ?? []) fn({ target });
    },
    dispatchDoc(type, detail) {
      for (const fn of docListeners[type] ?? []) fn({ type, detail });
    },
    pickFunnel(publicId) {
      picker.value = publicId;
      for (const fn of pickerListeners) fn({ target: picker });
    },
    headerName() {
      return String(nameEl.textContent);
    },
    pickerOptions() {
      return picker.options.map((o) => ({ value: String(o["value"]), label: String(o["textContent"]) }));
    },
    calls,
    flushTimer() {
      const fn = timerFn;
      timerFn = null;
      if (fn !== null) fn();
    },
    async settle() {
      for (let i = 0; i < 25; i += 1) {
        await Promise.allSettled(pending.slice());
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  };
}

function fireRadiusEdit(island: IslandHandle): void {
  island.fire("change", { getAttribute: (n: string) => (n === "data-theme-key" ? "scales.radius" : null), value: "round" });
  island.flushTimer();
}

// P8-1 F1: a "plain tab click" = quotes-tabs/funnel.ts's activate() writing
// the tab it switched to, through that file's OWN served helper. Themes ->
// Activation -> Themes is three of them.
function plainTabClicks(page: PageState, tabs: readonly string[]): void {
  const api = pageHashApi(page);
  for (const t of tabs) api.write("tab", t);
}

// The funnel-scoped theme GET+PUT only — NOT the preset catalog read
// (/themes/:id, which a funnel whose theme_json is a {theme_id} pointer
// legitimately fetches while resolving).
const themeCallsOf = (island: IslandHandle): Array<{ url: string }> => island.calls.filter((c) => c.url.includes("/funnels/") && c.url.endsWith("/theme"));

// R2 P8-3 (F1) — the WRONG-TARGET net used by the two legs below, which assert
// "EVERY theme call targets funnel X / NO call targets funnel Y".
//
// WHICH SIDE WAS WRONG: the MATCHER, not the island. Both legs used to filter
// `url.includes("/theme") && !url.includes("preview")`. `"/theme"` is a
// PREFIX of `"/themes"`, so that predicate also caught the preset-catalog read
// `GET /api/admin/leadgen/themes` (themes.ts:1366 refreshPresetAvailability),
// a collection endpoint that is not funnel-scoped and carries no target at
// all — `.every(url contains "/funnels/<A>/theme")` therefore went false on a
// call that has nothing to target. MEASURED on the failing leg: the island
// issues 4 calls — `…/sections?status=active&page_size=200`,
// `…/themes`, and the funnel-scoped GET+PUT pair `…/funnels/<A>/theme` ×2,
// both already on the RIGHT funnel. The B3 behaviour is intact.
//
// WHY THIS PREDICATE AND NOT `themeCallsOf` ABOVE. Narrowing these two legs to
// `themeCallsOf`'s `/funnels/ + endsWith("/theme")` would ALSO pass, but it
// would silently drop coverage: a theme write on any NON-funnel-scoped path
// (e.g. a future `/variants/:id/theme`) would fall outside the filter and the
// "every call targets X" assertion would go vacuously true on it. So this
// EXCLUDES the preset plane precisely instead of narrowing to funnels.
// COVERAGE, old vs new, over the complete `/theme`-bearing admin route set
// (router.ts:218-222 + :334-335 — `/themes`, `/themes/:id`, `/funnels/:id/theme`;
// grep confirms NO `/variants/:id/theme` route exists at this HEAD):
//   * `/funnels/:id/theme` (GET+PUT)      — matched by BOTH old and new.
//   * any other `…/theme` shape, present  — matched by BOTH old and new
//     or future, that carries a target      (this is the coverage narrowing
//                                            to `/funnels/` would have lost).
//   * `…/preview…`                        — excluded by BOTH (unchanged).
//   * `/themes` and `/themes/:id`         — the preset plane; excluded by the
//                                            NEW predicate only. That is the
//                                            whole fix, and it removes zero
//                                            target-bearing calls.
const PRESET_PLANE_URL = /\/themes(?:\/|$|\?)/;
const themeTargetCallsOf = (island: IslandHandle): Array<{ url: string }> =>
  island.calls.filter((c) => c.url.includes("/theme") && !c.url.includes("preview") && !PRESET_PLANE_URL.test(c.url));

describeDb("P8 B3 (contract R6-1) — part (b): the Themes island targets the chip-carried funnel when present, the editor-default otherwise", () => {
  it("no carried context: GET+PUT still target the editor-default funnel (today's behaviour, unchanged)", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);

    const island = bootThemesIsland(env, fx.funnelA, fx.variantA, boardPage(fx));
    await island.settle();
    fireRadiusEdit(island);
    await island.settle();

    const themeCalls = themeTargetCallsOf(island);
    expect(themeCalls.length, "GET+PUT count to /theme").toBeGreaterThan(0);
    expect(themeCalls.every((c) => c.url.includes(`/funnels/${fx.funnelA}/theme`)), "every /theme call targets funnel A").toBe(true);
    expect(themeCalls.some((c) => c.url.includes(fx.funnelC)), "no call targets funnel C").toBe(false);

    const aTheme = await json<{ theme: Record<string, unknown> | null }>(await admin.request(`${API}/funnels/${fx.funnelA}/theme`, jsonInit("GET"), env), "read funnel A theme back");
    expect((aTheme.theme as { scales?: { radius?: string } } | null)?.scales?.radius, "funnel A's stored theme carries the edit").toBe("round");
    sdb.close();
  });

  it("a chip-carried funnel present: GET+PUT target THAT funnel, never the editor-default — the funnel's ACTUAL persisted theme proves it", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);

    // FAIL-BEFORE (the conductor's repro): clicking funnel C's Theme chip
    // while the editor's own "selected" funnel is A used to GET+PUT funnel
    // A's theme instead — the write landed on the wrong funnel.
    const page = boardPage(fx);
    pageHashApi(page).write("funnel", fx.funnelC); // what the Theme chip does
    const island = bootThemesIsland(env, fx.funnelA, fx.variantA, page);
    await island.settle();
    fireRadiusEdit(island);
    await island.settle();

    const themeCalls = themeTargetCallsOf(island);
    expect(themeCalls.length, "GET+PUT count to /theme").toBeGreaterThan(0);
    expect(themeCalls.every((c) => c.url.includes(`/funnels/${fx.funnelC}/theme`)), "every /theme call targets the CARRIED funnel C").toBe(true);
    expect(themeCalls.some((c) => c.url.includes(fx.funnelA)), "no call targets the editor-default funnel A").toBe(false);

    const cTheme = await json<{ theme: Record<string, unknown> | null }>(await admin.request(`${API}/funnels/${fx.funnelC}/theme`, jsonInit("GET"), env), "read funnel C theme back");
    expect((cTheme.theme as { scales?: { radius?: string } } | null)?.scales?.radius, "funnel C's stored theme carries the edit").toBe("round");
    const aTheme = await json<{ theme: Record<string, unknown> | null }>(await admin.request(`${API}/funnels/${fx.funnelA}/theme`, jsonInit("GET"), env), "read funnel A theme back");
    expect(aTheme.theme, "funnel A's theme must stay untouched").toBeNull();
    sdb.close();
  });

  // ==========================================================================
  // P8-1 F1 — THE ROUND-2 CASES. The fresh-context reviewer drove exactly
  // this and the write landed on Funnel A: "Click Charlie's Theme chip ->
  // click the Activation tab -> click the Themes tab -> change Display size
  // => the write lands on Funnel A". Round 1 passed every test above and
  // still failed here, because its carry was a transient DOM attribute that
  // the plain-tab-click listener deleted.
  // ==========================================================================

  it("TAB ROUND-TRIP: target = funnel C, then Themes -> Activation -> Themes, and the edit STILL writes funnel C", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);

    const page = boardPage(fx);
    pageHashApi(page).write("funnel", fx.funnelC); // the Theme chip on C's column
    const island = bootThemesIsland(env, fx.funnelA, fx.variantA, page);
    await island.settle();
    plainTabClicks(page, ["themes", "activation", "themes"]);

    fireRadiusEdit(island);
    await island.settle();

    const themeCalls = themeCallsOf(island);
    expect(themeCalls.length, "GET+PUT count to /theme after the round trip").toBeGreaterThan(0);
    expect(themeCalls.every((c) => c.url.includes(`/funnels/${fx.funnelC}/theme`)), "every /theme call still targets funnel C").toBe(true);
    expect(themeCalls.some((c) => c.url.includes(fx.funnelA)), "no call fell back to the editor-default funnel A").toBe(false);
    expect(page.hash, "the tab round trip keeps the funnel and remembers the tab").toBe(`#tab=themes&funnel=${fx.funnelC}`);

    const cTheme = await json<{ theme: Record<string, unknown> | null }>(await admin.request(`${API}/funnels/${fx.funnelC}/theme`, jsonInit("GET"), env), "read funnel C theme back");
    expect((cTheme.theme as { scales?: { radius?: string } } | null)?.scales?.radius, "funnel C's stored theme carries the edit").toBe("round");
    const aTheme = await json<{ theme: Record<string, unknown> | null }>(await admin.request(`${API}/funnels/${fx.funnelA}/theme`, jsonInit("GET"), env), "read funnel A theme back");
    expect(aTheme.theme, "funnel A's theme must stay untouched").toBeNull();
    sdb.close();
  });

  it("RELOAD: a page that boots with the persisted target already in the URL edits that funnel, and names it", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);

    // A reload re-parses the island with the hash the previous page left.
    const page = boardPage(fx, `#tab=themes&funnel=${fx.funnelC}`);
    const island = bootThemesIsland(env, fx.funnelA, fx.variantA, page);
    await island.settle();
    expect(island.headerName(), "the scope line names the funnel this panel edits").toBe("Funnel C");

    fireRadiusEdit(island);
    await island.settle();
    const themeCalls = themeCallsOf(island);
    expect(themeCalls.length, "GET+PUT count to /theme").toBeGreaterThan(0);
    expect(themeCalls.every((c) => c.url.includes(`/funnels/${fx.funnelC}/theme`)), "every /theme call targets the persisted funnel C").toBe(true);
    sdb.close();
  });

  it("VISIBLE: the panel names the target funnel and lists every board funnel in its picker (default = the editor's funnel)", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);

    const island = bootThemesIsland(env, fx.funnelA, fx.variantA, boardPage(fx));
    await island.settle();

    expect(island.headerName(), "no chip, no persisted choice -> the editor's own funnel, named").toBe("Funnel A");
    expect(island.pickerOptions(), "the picker is fed by the SAME funnel list the board renders").toEqual([
      { value: fx.funnelA, label: "Funnel A" },
      { value: fx.funnelB, label: "Funnel B" },
      { value: fx.funnelC, label: "Funnel C" },
    ]);
    sdb.close();
  });

  it("SWITCHABLE: changing the picker retargets the writes, renames the header and persists the choice", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);

    const page = boardPage(fx);
    const island = bootThemesIsland(env, fx.funnelA, fx.variantA, page);
    await island.settle();

    island.pickFunnel(fx.funnelB);
    await island.settle();
    expect(page.hash, "the choice is persisted where a reload will find it").toBe(`#funnel=${fx.funnelB}`);
    expect(island.headerName(), "the header follows the switch").toBe("Funnel B");

    fireRadiusEdit(island);
    await island.settle();
    const themeCalls = themeCallsOf(island);
    expect(themeCalls.length, "GET+PUT count to /theme").toBeGreaterThan(0);
    expect(themeCalls.every((c) => c.url.includes(`/funnels/${fx.funnelB}/theme`)), "every /theme call targets the picked funnel B").toBe(true);
    const bTheme = await json<{ theme: Record<string, unknown> | null }>(await admin.request(`${API}/funnels/${fx.funnelB}/theme`, jsonInit("GET"), env), "read funnel B theme back");
    expect((bTheme.theme as { scales?: { radius?: string } } | null)?.scales?.radius, "funnel B's stored theme carries the edit").toBe("round");
    sdb.close();
  });

  it("a chip click elsewhere on the page repaints this panel's header through the shared event", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);

    const page = boardPage(fx);
    const island = bootThemesIsland(env, fx.funnelA, fx.variantA, page);
    await island.settle();
    expect(island.headerName()).toBe("Funnel A");

    // What quotes-tabs/funnel.ts's setTargetFunnel does: write, then announce.
    pageHashApi(page).write("funnel", fx.funnelC);
    island.dispatchDoc("lg:target-funnel-change", { funnel_public_id: fx.funnelC });
    await island.settle();

    expect(island.headerName(), "the panel renames itself without a reload").toBe("Funnel C");
    sdb.close();
  });
});

// ===========================================================================
// part (b2) — the Templates island (S1.6, second leg): resolver proof
// (adapted from bootThemesIsland above; per-file harness duplication is this
// repo's stated convention). Drives the canvas-preview POST — the ONE
// funnel/variant-identity call site that fires UNPROMPTED during init() (via
// populateSectionPicker's synchronous no-sections branch when boot carries no
// quote_public_id) — no dialog-click simulation needed. The other two
// identity call sites in templates.ts ("Apply to funnel", "A/B templates")
// route through these SAME targetFunnelPublicId()/targetVariantPublicId()
// functions by construction (see templates.ts).
// ===========================================================================

interface TplIslandHandle {
  pickFunnel(publicId: string): void;
  headerName(): string;
  pickerOptions(): Array<{ value: string; label: string }>;
  calls: Array<{ url: string; method: string; body: unknown }>;
  settle(): Promise<void>;
}

function bootTemplatesIsland(
  env: Env,
  defaultFunnelPublicId: string,
  defaultVariantPublicId: string,
  page: PageState,
): TplIslandHandle {
  const html = renderTemplatesTabPanel(true, []);
  const script = html.slice(html.lastIndexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));

  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const pending: Array<Promise<unknown>> = [];

  const el = (): Record<string, unknown> => ({
    textContent: "",
    className: "",
    style: {},
    firstChild: null,
    value: "",
    checked: false,
    appendChild() {},
    removeChild() {},
    setAttribute() {},
    getAttribute: () => null,
    addEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    closest: () => null,
    focus() {},
  });

  const stableById: Record<string, Record<string, unknown>> = {
    "lg-quote-data": { textContent: JSON.stringify({ quote_public_id: "", funnel_public_id: defaultFunnelPublicId, selected_variant: defaultVariantPublicId }) },
    "lg-board-data": { textContent: JSON.stringify({ funnels: page.funnels }) },
  };
  // P8-1 F1 — the scope line's name slot (filled with a text node) + the
  // funnel picker, mirroring the Themes panel's pair.
  const nameNodes: string[] = [];
  const nameEl = {
    firstChild: null,
    appendChild(child: Record<string, unknown>) {
      nameNodes.push(String(child["nodeValue"] ?? ""));
    },
    removeChild() {},
  };
  const pickerListeners: Array<(ev: unknown) => void> = [];
  const picker = {
    value: "",
    options: [] as Array<Record<string, unknown>>,
    get firstChild() {
      return this.options.length > 0 ? this.options[0]! : null;
    },
    appendChild(child: Record<string, unknown>) {
      this.options.push(child);
    },
    removeChild(child: Record<string, unknown>) {
      const at = this.options.indexOf(child);
      if (at >= 0) this.options.splice(at, 1);
    },
    setAttribute() {},
    getAttribute: (n: string) => (n === "data-lg-target-funnel" ? "" : null),
    addEventListener(kind: string, fn: (ev: unknown) => void) {
      if (kind === "change") pickerListeners.push(fn);
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    closest: () => null,
    focus() {},
  };
  const document = {
    querySelector() {
      return null;
    },
    querySelectorAll: () => [],
    getElementById(id: string) {
      if (id === "lg-tpl-target-name") return nameEl;
      if (id === "lg-tpl-target-select") return picker;
      if (stableById[id] === undefined) stableById[id] = el();
      return stableById[id];
    },
    // setAttribute(): templates.ts's renderTemplateList builds its unreachable-
    // logo chip with createElement + setAttribute. Without it every boot of
    // this harness threw an UNHANDLED REJECTION (3 per run, the P8-1 gate's
    // "Errors 3 errors" and its exit-1 with 37 green tests — vitest's own
    // "This might cause false positive tests"). Same stub shape the two
    // sibling harnesses in this file already carry.
    createElement: () => ({ value: "", selected: false, children: [] as unknown[], appendChild(c: unknown) { (this.children as unknown[]).push(c); }, setAttribute() {} }),
    createTextNode: (s: unknown) => ({ nodeValue: s === null || s === undefined ? "" : String(s) }),
    addEventListener() {},
    body: el(),
  };
  const win = windowStubFor(page, {
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  });
  const fetchShim = (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    let parsedBody: unknown = null;
    if (typeof init?.body === "string") {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    calls.push({ url, method, body: parsedBody });
    const p = Promise.resolve(admin.request(`http://localhost${url}`, init as RequestInit, env));
    pending.push(p);
    return p;
  };

  runInNewContext(script, { document, window: win, fetch: fetchShim, JSON, Object, String, Boolean, Number });

  return {
    pickFunnel(publicId) {
      picker.value = publicId;
      for (const fn of pickerListeners) fn({ target: picker });
    },
    headerName() {
      return nameNodes.length === 0 ? "" : nameNodes[nameNodes.length - 1]!;
    },
    pickerOptions() {
      return picker.options.map((o) => ({
        value: String(o["value"]),
        label: ((o["children"] ?? []) as Array<Record<string, unknown>>).map((c) => String(c["nodeValue"] ?? "")).join(""),
      }));
    },
    calls,
    async settle() {
      for (let i = 0; i < 25; i += 1) {
        await Promise.allSettled(pending.slice());
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  };
}

describeDb("P8 B3 (contract R6-1) — part (b2): the Templates island targets the chip-carried funnel/variant when present, the editor-default otherwise", () => {
  it("no carried context: the canvas-preview POST still targets the editor-default variant (today's behaviour, unchanged)", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);

    const island = bootTemplatesIsland(env, fx.funnelA, fx.variantA, boardPage(fx));
    await island.settle();

    const previewCalls = island.calls.filter((c) => c.url.includes("/preview"));
    expect(previewCalls.length, "canvas-preview POST count").toBeGreaterThan(0);
    expect(previewCalls.every((c) => c.url.includes(`/variants/${fx.variantA}/preview`)), "every preview call targets the editor-default variant A").toBe(true);
    expect(previewCalls.some((c) => c.url.includes(fx.variantC)), "no call targets variant C").toBe(false);
    expect(island.headerName(), "the panel names the funnel it edits").toBe("Funnel A");
    expect(island.pickerOptions(), "fed by the SAME funnel list the board renders").toEqual([
      { value: fx.funnelA, label: "Funnel A" },
      { value: fx.funnelB, label: "Funnel B" },
      { value: fx.funnelC, label: "Funnel C" },
    ]);
    sdb.close();
  });

  it("a chip-carried funnel/variant present: the canvas-preview POST targets THAT variant, never the editor-default", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);

    // FAIL-BEFORE (pre-S1.6 templates.ts): boot.selected_variant was read
    // unconditionally, so a Template-chip click on funnel C while the
    // editor's own "selected" funnel/variant was A still previewed variant A.
    const page = boardPage(fx);
    pageHashApi(page).write("funnel", fx.funnelC); // what the Template chip does
    const island = bootTemplatesIsland(env, fx.funnelA, fx.variantA, page);
    await island.settle();

    const previewCalls = island.calls.filter((c) => c.url.includes("/preview"));
    expect(previewCalls.length, "canvas-preview POST count").toBeGreaterThan(0);
    expect(previewCalls.every((c) => c.url.includes(`/variants/${fx.variantC}/preview`)), "every preview call targets the TARGETED variant C").toBe(true);
    expect(previewCalls.some((c) => c.url.includes(fx.variantA)), "no call targets the editor-default variant A").toBe(false);
    expect(island.headerName(), "and the panel says so").toBe("Funnel C");
    // The funnel's OWN layout state is re-read, never the editor funnel's.
    // The funnel-scoped frame read only — NOT the /frame-template-records
    // catalog the template bar loads.
    const frameGets = island.calls.filter((c) => c.url.includes("/funnels/") && c.url.endsWith("/frame") && c.method === "GET");
    expect(frameGets.length, "GET /funnels/:id/frame count").toBeGreaterThan(0);
    expect(frameGets.every((c) => c.url.includes(`/funnels/${fx.funnelC}/frame`)), "every frame read targets funnel C").toBe(true);
    sdb.close();
  });

  it("TAB ROUND-TRIP + SWITCHABLE: the target survives Templates -> Activation -> Templates, and the picker retargets the canvas", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);

    const page = boardPage(fx);
    pageHashApi(page).write("funnel", fx.funnelC);
    const island = bootTemplatesIsland(env, fx.funnelA, fx.variantA, page);
    await island.settle();
    plainTabClicks(page, ["templates", "activation", "templates"]);
    expect(page.hash, "the round trip keeps the funnel and remembers the tab").toBe(`#tab=templates&funnel=${fx.funnelC}`);

    const beforeSwitch = island.calls.length;
    island.pickFunnel(fx.funnelB);
    await island.settle();

    expect(page.hash, "the switch is persisted").toBe(`#tab=templates&funnel=${fx.funnelB}`);
    expect(island.headerName(), "the header follows the switch").toBe("Funnel B");
    const after = island.calls.slice(beforeSwitch);
    const previewsAfter = after.filter((c) => c.url.includes("/preview"));
    expect(previewsAfter.length, "the canvas re-renders on the switch").toBeGreaterThan(0);
    expect(previewsAfter.every((c) => c.url.includes(`/variants/${fx.variantB}/preview`)), "every preview after the switch targets variant B").toBe(true);
    expect(after.some((c) => c.url.includes(`/funnels/${fx.funnelB}/frame`) && c.method === "GET"), "and funnel B's own layout state is re-read").toBe(true);
    sdb.close();
  });
});

// ===========================================================================
// FIX ROUND B3 — assembled-page structural check. The conductor's real-
// browser repro (clicking a funnel column's Theme chip) threw, verbatim:
//   ReferenceError: clearCarriedChipFunnel is not defined
//     at HTMLButtonElement.<anonymous> (…/edit:4149:54)  <- plain-tab-click
//     at gotoTab (…/edit:7502:20)
//   ReferenceError: root is not defined
//     at setCarriedChipFunnel (…/edit:7521:5)
// None of the string-level guard tests at the TOP of this file caught it:
// they all run .indexOf/.toContain against the bare QUOTE_EDITOR_SCRIPT
// constant, which proves ORDERING of substrings, never JS SCOPE. Root cause
// (conductor-verified against the SERVED page): renderBuilderPanel emits its
// client JS as MULTIPLE SEPARATE top-level `(function () { ... }())` scopes
// -- the plain-tab-click listener's scope never defines
// clearCarriedChipFunnel (it is defined in a LATER, different scope), and
// that later scope's setCarriedChipFunnel/clearCarriedChipFunnel reference a
// `root` that is local to the FIRST scope only.
//
// This test renders the REAL served editor page through the real admin
// router (same D1 harness as above -- never a hand-built fixture), locates
// the REAL non-JSON <script> block that embeds QUOTE_EDITOR_SCRIPT verbatim,
// splits that block's code into its own top-level `{ ... }` scopes by
// tracking brace depth (string/comment content is blanked out first so
// prose mentions or JSON payload braces can never perturb the count or look
// like an identifier reference), and asserts every carry-related identifier
// (setCarriedChipFunnel, clearCarriedChipFunnel, root) that a scope
// REFERENCES is also DEFINED in that SAME scope -- a structural, per-scope
// check that fails exactly the way the real browser did, and cannot be
// satisfied by any identifier existing merely SOMEWHERE in the page.
// ===========================================================================

// P8-1 F1: the round-2 identifier set. `setCarriedChipFunnel`/
// `clearCarriedChipFunnel` are GONE with the transient carry they served; the
// helpers that replaced them are guarded here in their place, so the same
// class of cross-scope ReferenceError still fails this test.
const CARRY_IDENTIFIERS = ["setTargetFunnel", "lgHashParam", "lgSetHashParam", "honourPersistedTab", "activate", "root"] as const;

// Splits `src` into its top-level `{ ... }` excursions, returning a CODE-ONLY
// copy of each (single/double/backtick-string contents and `//`/`/* */`
// comment contents blanked to spaces, preserving newlines). Brace depth is
// tracked only over the remaining real code characters, so nested blocks,
// object/array literals (including inlined JSON payloads), and
// self-balanced regex quantifiers (e.g. /{3,8}/) never perturb where a
// top-level scope starts or ends, and a comment/string mentioning a carry
// identifier in prose can never be mistaken for a real reference.
// Keywords after which a `/` starts a value (regex), never division, even
// though the keyword itself ends in a word character (e.g. "return /x/").
const REGEX_CONTEXT_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "default",
]);

function splitTopLevelCodeScopes(src: string): string[] {
  const segments: string[] = [];
  let out = "";
  let depth = 0;
  let segStart = 0;
  let i = 0;
  let lastToken = ""; // last real (non-string/comment) token; "" = start of scope
  let wordBuf = "";

  function flushWord(): void {
    if (wordBuf !== "") {
      lastToken = wordBuf;
      wordBuf = "";
    }
  }
  function noteRealChar(ch: string): void {
    if (/[A-Za-z0-9_$]/.test(ch)) {
      wordBuf += ch;
    } else {
      flushWord();
      if (ch.trim() !== "") lastToken = ch;
    }
  }
  // Standard regex-vs-division disambiguation: a bare `/` starts a regex
  // literal unless the last real token is a value-producing one (identifier/
  // number, `)`, `]`, a string, or a prior regex) -- those mean the `/` is
  // division. This matters here because `url.replace(/"/g, ...)` (a regex
  // literal that legitimately CONTAINS a quote character) would otherwise be
  // misread as the start of a string, silently swallowing real code
  // (including braces) until the next stray quote -- corrupting every scope
  // boundary after it.
  function regexContextExpected(): boolean {
    flushWord();
    if (lastToken === "") return true;
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(lastToken)) return REGEX_CONTEXT_KEYWORDS.has(lastToken);
    return lastToken !== ")" && lastToken !== "]";
  }

  while (i < src.length) {
    const ch = src.charAt(i);
    const two = src.slice(i, i + 2);
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      out += " ";
      i += 1;
      while (i < src.length && src.charAt(i) !== quote) {
        if (src.charAt(i) === "\\" && i + 1 < src.length) {
          out += src.charAt(i) === "\n" ? "\n" : " ";
          i += 1;
        }
        out += src.charAt(i) === "\n" ? "\n" : " ";
        i += 1;
      }
      if (i < src.length) {
        out += " ";
        i += 1;
      }
      lastToken = ")"; // a string literal is a value, like a parenthesized expr
      continue;
    }
    if (two === "//") {
      while (i < src.length && src.charAt(i) !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (two === "/*") {
      out += "  ";
      i += 2;
      while (i < src.length && src.slice(i, i + 2) !== "*/") {
        out += src.charAt(i) === "\n" ? "\n" : " ";
        i += 1;
      }
      out += "  ";
      i += 2;
      continue;
    }
    if (ch === "/" && regexContextExpected()) {
      let j = i + 1;
      let inClass = false;
      let ok = false;
      while (j < src.length) {
        const rc = src.charAt(j);
        if (rc === "\n") break; // a real regex literal never spans a raw newline
        if (rc === "\\" && j + 1 < src.length) {
          j += 2;
          continue;
        }
        if (rc === "[") {
          inClass = true;
          j += 1;
          continue;
        }
        if (rc === "]") {
          inClass = false;
          j += 1;
          continue;
        }
        if (rc === "/" && !inClass) {
          ok = true;
          j += 1;
          break;
        }
        j += 1;
      }
      if (ok) {
        while (j < src.length && /[a-zA-Z]/.test(src.charAt(j))) j += 1;
        for (let k = i; k < j; k += 1) out += src.charAt(k) === "\n" ? "\n" : " ";
        i = j;
        lastToken = ")"; // a regex literal is a value too
        continue;
      }
      // Not actually a regex (no unescaped closing `/` before EOF/newline) --
      // fall through and treat this single `/` as a plain (division) char.
    }
    out += ch;
    noteRealChar(ch);
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        segments.push(out.slice(segStart));
        segStart = out.length;
      }
    }
    i += 1;
  }
  if (segStart < out.length) segments.push(out.slice(segStart));
  return segments.filter((s) => s.trim().length > 0);
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m === null ? 0 : m.length;
}

function checkCarryIdentifier(scope: string, name: (typeof CARRY_IDENTIFIERS)[number]): { referenced: boolean; defined: boolean } {
  if (name === "root") {
    const total = countMatches(scope, /\broot\b/g);
    const declared = countMatches(scope, /\bvar\s+root\b/g);
    return { referenced: total - declared > 0, defined: declared > 0 };
  }
  if (name === "activate") {
    // Referenced by BOTH a call and a listener-registration reference
    // (addEventListener('DOMContentLoaded', honourPersistedTab) reaches it
    // through that function, which this same rule covers).
    const total = countMatches(scope, /\bactivate\b/g);
    const declared = countMatches(scope, /\bfunction\s+activate\s*\(/g);
    return { referenced: total - declared > 0, defined: declared > 0 };
  }
  const callLike = countMatches(scope, new RegExp("\\b" + name + "\\s*\\(", "g"));
  const declared = countMatches(scope, new RegExp("\\bfunction\\s+" + name + "\\s*\\(", "g"));
  return { referenced: callLike - declared > 0, defined: declared > 0 };
}

describeDb("P8 B3 FIX ROUND — assembled served page: carry identifiers never cross a top-level emitted-scope boundary", () => {
  it("every setTargetFunnel/lgHashParam/lgSetHashParam/honourPersistedTab/activate/root reference in a top-level scope of the REAL served page's non-JSON <script> block is defined in that SAME scope", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    const page = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();

    const scriptTagRe = /<script([^>]*)>([\s\S]*?)<\/script>/g;
    const hostScripts: string[] = [];
    for (const match of page.matchAll(scriptTagRe)) {
      const attrs = match[1] ?? "";
      const body = match[2] ?? "";
      if (attrs.includes('type="application/json"')) continue;
      if (body.includes(QUOTE_EDITOR_SCRIPT)) hostScripts.push(body);
    }
    expect(hostScripts.length, "a non-JSON <script> block on the REAL served page must embed QUOTE_EDITOR_SCRIPT verbatim").toBeGreaterThan(0);

    const violations: string[] = [];
    let carryScopeCount = 0;
    for (const hostScript of hostScripts) {
      const idx = hostScript.indexOf(QUOTE_EDITOR_SCRIPT);
      const embedded = hostScript.slice(idx, idx + QUOTE_EDITOR_SCRIPT.length);
      expect(embedded, "the served bytes must match the exported constant exactly").toBe(QUOTE_EDITOR_SCRIPT);

      const scopes = splitTopLevelCodeScopes(embedded).filter((s) => CARRY_IDENTIFIERS.some((n) => new RegExp("\\b" + n + "\\b").test(s)));
      carryScopeCount += scopes.length;
      for (const scope of scopes) {
        for (const name of CARRY_IDENTIFIERS) {
          const { referenced, defined } = checkCarryIdentifier(scope, name);
          if (referenced && !defined) {
            violations.push(`"${name}" is referenced in a top-level scope but not defined in that SAME scope. Scope excerpt: ${scope.slice(0, 140).replace(/\s+/g, " ").trim()}...`);
          }
        }
      }
    }
    expect(carryScopeCount, "at least one top-level emitted scope must reference a carry identifier (the check must exercise real content)").toBeGreaterThan(0);
    expect(violations, `cross-scope carry-identifier violation(s):\n${violations.join("\n")}`).toEqual([]);
    sdb.close();
  });
});

// ===========================================================================
// P8-1 F5 (B3/R6-1, defects C + D) — THE SAVE CHAIN AND THE PANEL'S CONTROLS.
//
// F1 gave the Themes/Templates panels a persisted target funnel, but two
// wrong-funnel paths survived it, both inside quotes-tabs/funnel.ts's island:
//   (C) the one-Save chain still built its funnelBase from the EDITOR-selected
//       funnel, so "switch the Templates target to Charlie, edit a layout
//       control, press Save" issued PUT /funnels/<Funnel A>/frame — the
//       owner's B3 sentence again, and destructive (it overwrites a funnel the
//       operator is not looking at).
//   (D) the Templates panel's element controls are populated from THAT SAME
//       island's state, which never followed the switch — canvas = Charlie,
//       controls = Funnel A.
//
// This harness boots BOTH real islands (funnel.ts's QUOTE_EDITOR_SCRIPT and
// templates.ts's TPL_SCRIPT, the served bytes) into ONE shared document, the
// way the real page runs them, and drives the switch through the Templates
// panel's OWN picker. Nothing about the boundary is hand-built (E10/E11):
//   - boot state = the #lg-quote-data / #lg-board-data blobs sliced verbatim
//     out of the REAL SSR edit page,
//   - the hash is written by funnel.ts's/templates.ts's own lgSetHashParam,
//   - the lg:target-funnel-change / lg:target-funnel-frame events are the
//     islands' own createEvent dispatches through the shared document,
//   - every fetch goes to the REAL admin router over the REAL D1 schema, so
//     the assertions read the funnels' ACTUAL persisted rows afterwards.
// ===========================================================================

interface FunnelIslandHandle {
  pickTemplatesFunnel(publicId: string): void;
  editFrameControl(key: string, value: string): void;
  clickSave(): void;
  controlValue(key: string): string;
  calls: Array<{ url: string; method: string; body: unknown }>;
  settle(): Promise<void>;
}

function extractJsonBlob(html: string, id: string): string {
  const open = html.indexOf(`id="${id}"`);
  expect(open, `#${id} on the served page`).toBeGreaterThan(-1);
  const from = html.indexOf(">", open) + 1;
  const to = html.indexOf("</script>", from);
  expect(to, `#${id} close tag`).toBeGreaterThan(from);
  return html.slice(from, to);
}

function bootBothIslands(
  env: Env,
  servedPage: string,
  editorFunnelPublicId: string,
  editorVariantPublicId: string,
  frameKeys: readonly string[],
  page: PageState,
): FunnelIslandHandle {
  const tplHtml = renderTemplatesTabPanel(true, []);
  const tplScript = tplHtml.slice(tplHtml.lastIndexOf("<script>") + "<script>".length, tplHtml.lastIndexOf("</script>"));

  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const pending: Array<Promise<unknown>> = [];

  const el = (): Record<string, unknown> => ({
    textContent: "", className: "", style: {}, firstChild: null, value: "", checked: false, disabled: false,
    hidden: false, options: [], content: null, type: "", tagName: "DIV",
    appendChild() {}, removeChild() {}, setAttribute() {}, removeAttribute() {},
    getAttribute: () => null, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
    closest: () => null, focus() {}, contains: () => false, insertBefore() {},
  });

  // The inspector controls the Templates panel shows beside its canvas —
  // funnel.ts populates and collects them by their data-frame-key alone.
  const controls = frameKeys.map((key) => ({
    ...el(),
    type: "text",
    value: "",
    getAttribute: (n: string) => (n === "data-frame-key" ? key : null),
  }));
  const controlOf = (key: string): Record<string, unknown> => {
    const at = frameKeys.indexOf(key);
    expect(at, `control ${key}`).toBeGreaterThan(-1);
    return controls[at]!;
  };

  const rootListeners: Record<string, Array<(ev: unknown) => void>> = { change: [], click: [] };
  const saveListeners: Array<() => void> = [];
  const pickerListeners: Array<(ev: unknown) => void> = [];
  const docListeners: Record<string, Array<(ev: unknown) => void>> = {};

  const picker: Record<string, unknown> = {
    ...el(),
    value: "",
    options: [] as Array<Record<string, unknown>>,
    getAttribute: (n: string) => (n === "data-lg-target-funnel" ? "" : null),
    addEventListener(kind: string, fn: (ev: unknown) => void) {
      if (kind === "change") pickerListeners.push(fn);
    },
    appendChild(child: Record<string, unknown>) {
      (picker["options"] as Array<Record<string, unknown>>).push(child);
    },
    removeChild(child: Record<string, unknown>) {
      const opts = picker["options"] as Array<Record<string, unknown>>;
      const at = opts.indexOf(child);
      if (at >= 0) opts.splice(at, 1);
    },
    get firstChild() {
      const opts = picker["options"] as Array<Record<string, unknown>>;
      return opts.length > 0 ? opts[0]! : null;
    },
  };

  const store: Record<string, Record<string, unknown>> = {
    "lg-quote-editor": {
      ...el(),
      getAttribute: (n: string) =>
        n === "data-funnel-public-id" ? editorFunnelPublicId
        : n === "data-variant-public-id" ? editorVariantPublicId
        : null,
      addEventListener(kind: string, fn: (ev: unknown) => void) {
        (rootListeners[kind] ??= []).push(fn);
      },
      querySelectorAll: (sel: string) => (sel === "[data-frame-key]" ? controls : []),
    },
    "lg-quote-data": { ...el(), textContent: extractJsonBlob(servedPage, "lg-quote-data") },
    "lg-board-data": { ...el(), textContent: extractJsonBlob(servedPage, "lg-board-data") },
    "lg-tpl-target-select": picker,
    "lg-variant-save": {
      ...el(),
      addEventListener(kind: string, fn: () => void) {
        if (kind === "click") saveListeners.push(fn);
      },
    },
  };

  const document = {
    getElementById(id: string) {
      if (store[id] === undefined) store[id] = el();
      return store[id];
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ value: "", selected: false, children: [] as unknown[], appendChild(c: unknown) { (this.children as unknown[]).push(c); }, setAttribute() {} }),
    createTextNode: (s: unknown) => ({ nodeValue: s === null || s === undefined ? "" : String(s) }),
    createEvent: () => ({
      type: "",
      detail: null as unknown,
      initCustomEvent(t: string, _b: boolean, _c: boolean, d: unknown) {
        this.type = t;
        this.detail = d;
      },
    }),
    dispatchEvent(evt: { type: string }) {
      for (const fn of docListeners[evt.type] ?? []) fn(evt);
      return true;
    },
    addEventListener(kind: string, fn: (ev: unknown) => void) {
      (docListeners[kind] ??= []).push(fn);
    },
    body: el(),
  };
  const win = windowStubFor(page, { setTimeout: () => 1, clearTimeout() {}, addEventListener() {} });

  const fetchShim = (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    let parsedBody: unknown = null;
    if (typeof init?.body === "string") {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    calls.push({ url, method, body: parsedBody });
    const p = Promise.resolve(admin.request(`http://localhost${url}`, init as RequestInit, env));
    pending.push(p);
    return p;
  };

  runInNewContext(`${QUOTE_EDITOR_SCRIPT}\n${tplScript}`, {
    document, window: win, fetch: fetchShim, setTimeout: () => 1, clearTimeout() {}, JSON, Object, String, Boolean, Number,
  });

  return {
    pickTemplatesFunnel(publicId) {
      picker["value"] = publicId;
      for (const fn of pickerListeners) fn({ target: picker });
    },
    editFrameControl(key, value) {
      const ctl = controlOf(key);
      ctl["value"] = value;
      for (const fn of rootListeners["change"] ?? []) fn({ target: ctl });
    },
    clickSave() {
      for (const fn of saveListeners) fn();
    },
    controlValue(key) {
      return String(controlOf(key)["value"] ?? "");
    },
    calls,
    async settle() {
      for (let i = 0; i < 30; i += 1) {
        await Promise.allSettled(pending.slice());
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  };
}

async function storedFrameConfig(env: Env, funnelPublicId: string): Promise<unknown> {
  const body = await json<{ frame_config: unknown }>(
    await admin.request(`${API}/funnels/${funnelPublicId}/frame`, {}, env),
    `GET frame ${funnelPublicId}`,
  );
  return body.frame_config;
}

describeDb("P8-1 F5 (contract R6-1, defects C+D) — the one-Save chain writes the TARGET funnel, and the panel's controls tell the truth about it", () => {
  it("C: after switching the Templates target to funnel C, Save PUTs funnel C's frame and leaves funnel A's row byte-identical", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    // Give BOTH funnels a distinguishable stored frame through the REAL
    // endpoint, so "A unchanged" is a claim about real persisted bytes.
    await json(await admin.request(`${API}/funnels/${fx.funnelA}/frame`, jsonInit("PUT", { frame_config_json: { template: "centered", version: 1, header: { logo_align: "left" } } }), env), "seed A frame");
    await json(await admin.request(`${API}/funnels/${fx.funnelC}/frame`, jsonInit("PUT", { frame_config_json: { template: "centered", version: 1, header: { logo_align: "center" } } }), env), "seed C frame");
    const aBefore = JSON.stringify(await storedFrameConfig(env, fx.funnelA));
    const cBefore = JSON.stringify(await storedFrameConfig(env, fx.funnelC));

    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const page = boardPage(fx);
    const island = bootBothIslands(env, servedPage, fx.funnelA, fx.variantA, ["header.logo_align"], page);
    await island.settle();

    island.pickTemplatesFunnel(fx.funnelC);
    await island.settle();
    expect(page.hash, "the picker persists the target in the URL hash").toContain(`funnel=${fx.funnelC}`);

    island.editFrameControl("header.logo_align", "center");
    island.clickSave();
    await island.settle();

    const framePuts = island.calls.filter((c) => c.method === "PUT" && c.url.endsWith("/frame"));
    expect(framePuts.map((c) => c.url), "the one-Save frame PUT targets the funnel the panel is editing").toEqual([
      `${API}/funnels/${fx.funnelC}/frame`,
    ]);

    const aAfter = JSON.stringify(await storedFrameConfig(env, fx.funnelA));
    const cAfter = await storedFrameConfig(env, fx.funnelC);
    expect(aAfter, `funnel A must be untouched (before: ${aBefore})`).toBe(aBefore);
    expect((cAfter as { header?: { logo_align?: string } }).header?.logo_align, `funnel C must carry the edit (before: ${cBefore})`).toBe("center");
    sdb.close();
  });

  it("C: with NO target switch the chain still writes the editor-selected funnel (today's behaviour, unchanged)", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootBothIslands(env, servedPage, fx.funnelA, fx.variantA, ["header.logo_align"], boardPage(fx));
    await island.settle();

    island.editFrameControl("header.logo_align", "center");
    island.clickSave();
    await island.settle();

    expect(island.calls.filter((c) => c.method === "PUT" && c.url.endsWith("/frame")).map((c) => c.url)).toEqual([
      `${API}/funnels/${fx.funnelA}/frame`,
    ]);
    sdb.close();
  });

  it("C: a hash pointing at a funnel this board does not have falls back to the editor funnel rather than editing blind", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const page = boardPage(fx);
    pageHashApi(page).write("funnel", "lgf_notonthisboard");
    const island = bootBothIslands(env, servedPage, fx.funnelA, fx.variantA, ["header.logo_align"], page);
    await island.settle();

    island.editFrameControl("header.logo_align", "center");
    island.clickSave();
    await island.settle();

    expect(island.calls.filter((c) => c.method === "PUT" && c.url.endsWith("/frame")).map((c) => c.url)).toEqual([
      `${API}/funnels/${fx.funnelA}/frame`,
    ]);
    sdb.close();
  });

  it("D: the panel's element controls repaint to the TARGET funnel's own stored values on a switch — never the previous funnel's", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    await json(await admin.request(`${API}/funnels/${fx.funnelA}/frame`, jsonInit("PUT", { frame_config_json: { template: "centered", version: 1, header: { logo_align: "left" }, progress: { thickness: "s" } } }), env), "seed A frame");
    await json(await admin.request(`${API}/funnels/${fx.funnelC}/frame`, jsonInit("PUT", { frame_config_json: { template: "centered", version: 1, header: { logo_align: "center" }, progress: { thickness: "l" } } }), env), "seed C frame");

    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootBothIslands(env, servedPage, fx.funnelA, fx.variantA, ["header.logo_align", "progress.thickness"], boardPage(fx));
    await island.settle();
    expect(island.controlValue("header.logo_align"), "boots on the editor funnel's own value").toBe("left");
    expect(island.controlValue("progress.thickness")).toBe("s");

    island.pickTemplatesFunnel(fx.funnelC);
    await island.settle();

    expect(island.controlValue("header.logo_align"), "the control must show the TARGET funnel's value, not funnel A's").toBe("center");
    expect(island.controlValue("progress.thickness")).toBe("l");
    sdb.close();
  });

  it("D: the repaint is fed by the GET /funnels/:id/frame the Templates island ALREADY issues — no second request for the same body", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootBothIslands(env, servedPage, fx.funnelA, fx.variantA, ["header.logo_align"], boardPage(fx));
    await island.settle();
    const before = island.calls.length;

    island.pickTemplatesFunnel(fx.funnelC);
    await island.settle();

    const frameGets = island.calls.slice(before).filter((c) => c.method === "GET" && c.url === `${API}/funnels/${fx.funnelC}/frame`);
    expect(frameGets.length, "exactly ONE GET of the target's frame serves both the canvas and the controls").toBe(1);
    sdb.close();
  });

  it("D: an edit made BEFORE the switch cannot ride the next Save onto the newly targeted funnel", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    await json(await admin.request(`${API}/funnels/${fx.funnelC}/frame`, jsonInit("PUT", { frame_config_json: { template: "centered", version: 1, header: { logo_align: "center" } } }), env), "seed C frame");
    const cBefore = JSON.stringify(await storedFrameConfig(env, fx.funnelC));

    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootBothIslands(env, servedPage, fx.funnelA, fx.variantA, ["header.logo_align"], boardPage(fx));
    await island.settle();

    island.editFrameControl("header.logo_align", "center"); // meant for funnel A
    island.pickTemplatesFunnel(fx.funnelC);
    await island.settle();
    island.clickSave();
    await island.settle();

    expect(island.calls.filter((c) => c.method === "PUT" && c.url.endsWith("/frame")).length, "the dropped pre-switch edit leaves nothing to save").toBe(0);
    expect(JSON.stringify(await storedFrameConfig(env, fx.funnelC)), "funnel C never receives funnel A's pending edit").toBe(cBefore);
    sdb.close();
  });

  it("C: the funnel-scoped THEME step of the chain follows the target too, and carries no pre-switch theme baseline onto it", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    // Funnel A owns an inline palette; funnel C owns a DIFFERENT one. A theme
    // edit made after switching to C must land on C and must not stamp A's
    // palette over it.
    await putFunnelTheme(env, fx.funnelA, { palette: { brand_primary: "#AAAAAA", accent: "#A1A1A1" } });
    await putFunnelTheme(env, fx.funnelC, { palette: { brand_primary: "#CCCCCC" } });

    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootBothIslands(env, servedPage, fx.funnelA, fx.variantA, ["header.logo_align"], boardPage(fx));
    await island.settle();

    island.pickTemplatesFunnel(fx.funnelC);
    await island.settle();
    island.clickSave();
    await island.settle();

    const themePuts = island.calls.filter((c) => c.method === "PUT" && c.url.endsWith("/theme"));
    expect(themePuts.map((c) => c.url), "nothing theme-dirty after the switch -> no theme PUT at all").toEqual([]);
    const cTheme = await json<{ theme: { palette?: Record<string, string> } }>(await admin.request(`${API}/funnels/${fx.funnelC}/theme`, {}, env), "GET C theme");
    expect(cTheme.theme.palette?.brand_primary, "funnel C keeps its own palette").toBe("#CCCCCC");
    expect(cTheme.theme.palette?.accent, "funnel A's accent must NOT have been merged onto C").toBeUndefined();
    sdb.close();
  });
});

// ===========================================================================
// P8-1 F6 (contract R6-1) — THE SET IS CLOSED.
//
// This defect class has been found FIVE times, each round one path narrower:
// the Themes island, the Templates island, the one-Save chain (F5), the
// override route (F5's named residual), and — measured live on 2026-08-03,
// with the Themes header reading "P8-Charlie" — the preset row's "Apply to
// this funnel" button, which issued
//   PUT /api/admin/leadgen/funnels/<Funnel A>/theme {"theme_json":{"theme_id":…}}
// Every previous round fixed the sentence that described the bug. The tests
// below instead fail on the SHAPE: any future funnel-scoped URL in these three
// islands that is not built from the target resolver, and any hand-rolled copy
// of the override condition that forgets whose arm it is speaking for.
// ===========================================================================

// `'…/funnels/' + encodeURIComponent(<expr>)` — the ONE way all three islands
// build a funnel-scoped URL (checked below: the count of these is the count of
// funnel-scoped requests in the served bytes).
const FUNNEL_URL_NEEDLE = "/funnels/' + encodeURIComponent(";

function balancedArgFrom(src: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < src.length; i += 1) {
    const ch = src.charAt(i);
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(openParen + 1, i).trim();
    }
  }
  throw new Error(`unbalanced encodeURIComponent( at ${openParen}`);
}

function funnelUrlExpressions(src: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = src.indexOf(FUNNEL_URL_NEEDLE, from);
    if (at === -1) return out;
    out.push(balancedArgFrom(src, at + FUNNEL_URL_NEEDLE.length - 1));
    from = at + FUNNEL_URL_NEEDLE.length;
  }
}

// Which LOCAL names in `src` provably hold a target-resolver result: a name
// every one of whose assignments is built only from the resolver(s), from
// other such names, or from literals — and at least one of which mentions a
// resolver. Fixpoint, so `var targetFunnel = pendingFunnel !== '' ?
// pendingFunnel : targetFunnelPublicId()` (the rail's queue-time pin) counts
// once `pendingFunnel` itself is proven. A name ALSO assigned from anything
// else (a board row, the editor default, a boot blob) never becomes bound —
// which is exactly the bug this file has now seen five times.
function resolverBoundLocals(src: string, resolvers: readonly string[]): Set<string> {
  const assignments = new Map<string, string[]>();
  const re = /(?:var\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)\s*([^;\n]*)/g;
  for (;;) {
    const m = re.exec(src);
    if (m === null) break;
    const list = assignments.get(m[1]!) ?? [];
    list.push(m[2]!);
    assignments.set(m[1]!, list);
  }
  const identsOf = (rhs: string): string[] => rhs.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
  const bound = new Set<string>();
  for (let pass = 0; pass < 8; pass += 1) {
    for (const [name, rhss] of assignments) {
      if (bound.has(name)) continue;
      const clean = rhss.every((rhs) => identsOf(rhs).every((id) => resolvers.includes(id) || bound.has(id)));
      // …and at least one assignment actually carries a resolver value (a name
      // only ever assigned literals proves nothing about the target).
      const derived = rhss.some((rhs) => identsOf(rhs).some((id) => resolvers.includes(id) || bound.has(id)));
      if (clean && derived) bound.add(name);
    }
  }
  return bound;
}

// The served editor script is SEVERAL back-to-back top-level IIFEs (see
// quotes-tabs/funnel.ts's own header). The two that matter here are the EDITOR
// island (which owns the target resolver) and the BOARD island (which owns the
// funnel columns and has no target at all — every one of its funnel URLs is
// built from the CLICKED COLUMN's own public id).
function topLevelIslands(src: string): string[] {
  return src.split(/\n\}\(\)\);\n/);
}

describe("P8-1 F6 (contract R6-1) — every funnel-scoped URL in the three quote-editor islands is built from the target resolver", () => {
  // The board island's per-column identifiers, allowlisted BY NAME with their
  // reason: `funnelOfEl(el)` reads `[data-funnel-col][data-funnel-public-id]`
  // off the column the operator clicked, so duplicate/delete/rename act on THAT
  // column by construction — they are not panel writes and have no target.
  const BOARD_COLUMN_IDENTIFIERS = ["pub", "funnelPub"] as const;

  it("funnel.ts EDITOR island: every funnel URL is saveTargetFunnelPublicId(), and the editor's own funnel id is never put in URL position", () => {
    const islands = topLevelIslands(QUOTE_EDITOR_SCRIPT);
    const editor = islands.find((s) => s.includes("function saveTargetFunnelPublicId("));
    expect(editor, "the editor island (the scope that owns the resolver)").toBeDefined();
    // funnelOfEl is the board island's own column reader — the editor island
    // has no such thing (it edits one funnel: the target).
    expect(editor!.includes("function funnelOfEl("), "…and it is NOT the board island").toBe(false);

    const exprs = funnelUrlExpressions(editor!);
    expect(exprs.length, "the editor island builds at least the one-Save base + the preset apply").toBeGreaterThanOrEqual(2);
    expect([...new Set(exprs)], "every one of them resolves the target").toEqual(["saveTargetFunnelPublicId()"]);
    // The exact shape of rounds 3 and 5: the frozen editor-selected funnel
    // interpolated straight into a URL.
    expect(editor!.includes("encodeURIComponent(funnelPublicId)"), "the editor-default funnel id must never build a URL").toBe(false);
  });

  it("funnel.ts BOARD island: its funnel URLs are the CLICKED COLUMN's id (named allowlist), never a panel target", () => {
    const islands = topLevelIslands(QUOTE_EDITOR_SCRIPT);
    const board = islands.find((s) => s.includes("function funnelOfEl("));
    expect(board, "the board island").toBeDefined();
    expect(board!.includes("function saveTargetFunnelPublicId("), "…and it carries no target resolver at all").toBe(false);
    // The reason the allowlist is legitimate, asserted rather than trusted.
    expect(board!.includes("col.getAttribute('data-funnel-public-id')"), "board ids come from the clicked column").toBe(true);

    const exprs = [...new Set(funnelUrlExpressions(board!))];
    expect(exprs.length, "the board builds duplicate/delete/rename URLs").toBeGreaterThan(0);
    for (const expr of exprs) {
      expect(BOARD_COLUMN_IDENTIFIERS as readonly string[], `board funnel URL built from '${expr}' — add it to the allowlist WITH a reason, or route it through the column`).toContain(expr);
    }
  });

  for (const [label, script, resolver] of [
    ["themes.ts", renderThemesTabPanel(true), "targetFunnelPublicId"],
    ["templates.ts", renderTemplatesTabPanel(true, []), "targetFunnelPublicId"],
  ] as const) {
    it(`${label} island: every funnel URL is the resolver, or a local provably assigned from it`, () => {
      const src = script.slice(script.lastIndexOf("<script>") + "<script>".length, script.lastIndexOf("</script>"));
      const bound = resolverBoundLocals(src, [resolver]);
      const exprs = [...new Set(funnelUrlExpressions(src))];
      expect(exprs.length, `${label} builds at least one funnel URL`).toBeGreaterThan(0);
      for (const expr of exprs) {
        const ok = expr === `${resolver}()` || bound.has(expr);
        expect(ok, `${label}: funnel URL built from '${expr}', which is neither ${resolver}() nor provably assigned from it (bound: ${[...bound].join(", ")})`).toBe(true);
      }
    });
  }

  it("funnel.ts: the §4.5 override condition is asked in ONE place, and it asks whose arm the target belongs to", () => {
    // Rounds 1-5 each re-typed `!isControl && overrideMode[...] === 'override'`
    // in a new spot and forgot the funnel. There are exactly two spellings in
    // the island now — the group-generic router and the theme-specific helper —
    // and BOTH consult editorArmOwnsTarget().
    const themeSpelling = QUOTE_EDITOR_SCRIPT.split("overrideMode['theme'] === 'override'").length - 1;
    expect(themeSpelling, "the theme override test lives only in themeOverrideActive()").toBe(1);
    const helper = sliceIslandFns(QUOTE_EDITOR_SCRIPT, "themeOverrideActive")[0] ?? "";
    expect(helper).toContain("overrideMode['theme'] === 'override'");
    expect(helper, "…and it is target-aware").toContain("editorArmOwnsTarget()");
    const router = sliceIslandFns(QUOTE_EDITOR_SCRIPT, "writeTargetFor")[0] ?? "";
    expect(router).toContain("overrideMode[group] === 'override'");
    expect(router, "the group-generic router is target-aware too").toContain("editorArmOwnsTarget()");
    const owns = sliceIslandFns(QUOTE_EDITOR_SCRIPT, "editorArmOwnsTarget")[0] ?? "";
    expect(owns, "…and 'owns' means: the panel is editing the editor's OWN funnel").toContain("saveTargetFunnelPublicId() === funnelPublicId");
  });
});

// ===========================================================================
// P8-1 F6 — the same four claims, DRIVEN: funnel.ts's island and themes.ts's
// island executed together (one document, so the seam events really flow),
// fetch wired to the REAL admin router over a REAL DB.
// ===========================================================================

// P8-1 G1 (review #2, F-1/F-2) — the rail's 14 role rows, built from the REAL
// panel markup this same boot executes (data-theme-role / data-role-pick /
// data-harmony-step are renderThemeEditorPanel's own attributes, never a
// hand-written list), so the swatch colour, the authorship tag and the
// role-pick selection funnel.ts paints become observable. Without them
// root.querySelectorAll answered [] for every colour selector and the whole
// COLOUR half of the rail ran against nothing.
interface RoleRowSpec {
  role: string;
  picks: string[];
}

function roleRowsFromPanel(html: string): RoleRowSpec[] {
  const rowRe = /<div class="lg-theme-role-row" data-theme-role="([^"]+)">/g;
  const found: Array<{ role: string; at: number }> = [];
  let m: RegExpExecArray | null = rowRe.exec(html);
  while (m !== null) {
    found.push({ role: m[1]!, at: m.index });
    m = rowRe.exec(html);
  }
  expect(found.length, "the rendered themes panel carries role rows").toBeGreaterThan(0);
  return found.map((row, i) => {
    const body = html.slice(row.at, i + 1 < found.length ? found[i + 1]!.at : html.length);
    const pickRe = /data-role-pick="([^"]+)" data-role-pick-for="palette\.([^"]+)"/g;
    const picks: string[] = [];
    let p: RegExpExecArray | null = pickRe.exec(body);
    while (p !== null) {
      if (p[2] === row.role) picks.push(p[1]!);
      p = pickRe.exec(body);
    }
    return { role: row.role, picks };
  });
}

// P8-1 J1 (review #4, F-2) — the §4.5 switch's own inputs, sliced out of the
// SAME rendered panel (shared.ts's renderOverrideSwitch, called by
// renderThemesTabPanel). A control arm renders none and this returns [], which
// is the served page's own truth rather than a harness decision.
function overrideRadioSpecsFromPanel(html: string): Array<{ group: string; value: string; checked: boolean }> {
  const re = /<input type="radio" name="lg-ov-[^"]+" value="([^"]*)" data-override-group="([^"]*)"([^>]*)\/>/g;
  const out: Array<{ group: string; value: string; checked: boolean }> = [];
  let m: RegExpExecArray | null = re.exec(html);
  while (m !== null) {
    out.push({ group: m[2]!, value: m[1]!, checked: (m[3] ?? "").includes("checked") });
    m = re.exec(html);
  }
  return out;
}

function overrideNoteGroupsFromPanel(html: string): string[] {
  const re = /data-override-note="([^"]*)"/g;
  const out: string[] = [];
  let m: RegExpExecArray | null = re.exec(html);
  while (m !== null) {
    out.push(m[1]!);
    m = re.exec(html);
  }
  return out;
}

interface SeamHandle {
  pickThemesFunnel(publicId: string): void;
  setThemeOverride(on: boolean): void;
  pickPaletteRole(role: string, value: string): void;
  resetRole(role: string): void;
  roleSwatchColor(role: string): string;
  roleAuthorship(role: string): string;
  selectedRolePick(role: string): string;
  harmonyChipColor(role: string, step: string): string;
  clickHarmony(role: string, step: string): void;
  editRailControl(key: string, value: string): void;
  applyPreset(themeId: string): void;
  // P8-1 F7: the Themes rail's OTHER preset button — funnel.ts's island wires
  // it (byId('lg-theme-ab-this')), so it is driven through the same seam.
  abThisTheme(themeId: string, percent: string): void;
  navigatedTo(): string;
  clickSave(): void;
  controlValue(key: string): string;
  // P8-1 J1 (F-2): the §4.5 switch's VISIBLE state — what the operator sees
  // the control promising, read off the real rendered radios/note slot.
  overrideSwitch(): { checked: string; disabled: boolean; enabled: boolean; note: string; noteHidden: boolean };
  // P8-1 H1 (m-2): fault-inject the target-funnel theme GET, the way review #3
  // injected a 500 in the browser, and read the page's own error banner.
  failThemeGetsFor(publicId: string): void;
  pageError(): { text: string; hidden: boolean; scrolledIntoView: number };
  calls: Array<{ url: string; method: string; body: unknown }>;
  flushTimers(): void;
  settle(): Promise<void>;
}

function bootFunnelAndThemesIslands(
  env: Env,
  servedPage: string,
  editorFunnelPublicId: string,
  editorVariantPublicId: string,
  themeKeys: readonly string[],
  page: PageState,
  isControl: boolean,
): SeamHandle {
  // THEMES_TAB_SCRIPT's bytes do not depend on isControl (the island reads
  // data-is-control off its own root at boot) — this is the same script the
  // served page carries, extracted the way bootThemesIsland already does.
  const themesHtml = renderThemesTabPanel(isControl);
  const themesScript = themesHtml.slice(themesHtml.lastIndexOf("<script>") + "<script>".length, themesHtml.lastIndexOf("</script>"));

  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const pending: Array<Promise<unknown>> = [];
  const timers: Array<() => void> = [];
  let brokenThemeGetFunnel = "";

  const el = (): Record<string, unknown> => ({
    textContent: "", className: "", style: {}, firstChild: null, value: "", checked: false, disabled: false,
    hidden: false, options: [], content: null, type: "", tagName: "DIV",
    appendChild() {}, removeChild() {}, setAttribute() {}, removeAttribute() {},
    getAttribute: () => null, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
    closest: () => null, focus() {}, contains: () => false, insertBefore() {},
  });

  const themeControls = themeKeys.map((key) => ({
    ...el(),
    type: "select-one",
    value: "",
    getAttribute: (n: string) => (n === "data-theme-key" ? key : null),
  }));
  const controlOf = (key: string): Record<string, unknown> => {
    const at = themeKeys.indexOf(key);
    expect(at, `theme control ${key}`).toBeGreaterThan(-1);
    return themeControls[at]!;
  };

  // --- the rail's COLOUR half, from the real panel markup -------------------
  const HARMONY_STEP_IDS = ["base", "wash", "darker", "lighter"] as const;
  const roleSpecs = roleRowsFromPanel(themesHtml);
  const roleSwatch: Record<string, Record<string, unknown>> = {};
  const roleSourceText: Record<string, string[]> = {};
  const rolePicks: Record<string, Array<Record<string, unknown>>> = {};
  const harmonyChip: Record<string, Record<string, unknown>> = {};
  const allPickNodes: Array<Record<string, unknown>> = [];
  const stripNodes: Array<Record<string, unknown>> = [];
  const roleRowNodes: Array<Record<string, unknown>> = [];
  const harmonyNodes: Array<Record<string, unknown>> = [];
  for (const spec of roleSpecs) {
    const swatch = { ...el() };
    const texts: string[] = [];
    roleSwatch[spec.role] = swatch;
    roleSourceText[spec.role] = texts;
    // clearChildren() walks firstChild, which stays null here (the Templates
    // harness's name slot uses the same idiom) — the LAST text appended is
    // what the operator would be reading.
    const source = { ...el(), appendChild(child: Record<string, unknown>) { texts.push(String(child["nodeValue"] ?? "")); } };
    const picks = spec.picks.map((pick) => ({
      ...el(),
      className: "lg-role-swatch",
      getAttribute: (n: string) => (n === "data-role-pick" ? pick : n === "data-role-pick-for" ? `palette.${spec.role}` : null),
    }));
    rolePicks[spec.role] = picks;
    allPickNodes.push(...picks);
    stripNodes.push({
      ...el(),
      getAttribute: (n: string) => (n === "data-role-strip" ? `palette.${spec.role}` : null),
      querySelectorAll: (sel: string) => (sel === ".lg-role-swatch" ? picks : []),
    });
    roleRowNodes.push({
      ...el(),
      getAttribute: (n: string) => (n === "data-theme-role" ? spec.role : null),
      querySelector: (sel: string) => (sel === "[data-role-swatch]" ? swatch : sel === "[data-role-source]" ? source : null),
    });
    for (const step of HARMONY_STEP_IDS) {
      const chip = { ...el() };
      harmonyChip[`${spec.role}/${step}`] = chip;
      harmonyNodes.push({
        ...el(),
        getAttribute: (n: string) => (n === "data-harmony-role" ? spec.role : n === "data-harmony-step" ? step : null),
        querySelector: (sel: string) => (sel === "[data-harmony-chip]" ? chip : null),
      });
    }
  }
  const bg = (node: Record<string, unknown> | undefined): string => String((node?.["style"] as Record<string, unknown> | undefined)?.["background"] ?? "");

  // --- the §4.5 override switch, from the REAL panel markup ------------------
  // P8-1 J1 (review #4, F-2): the radios and the note slot are sliced out of
  // renderOverrideSwitch's own emitted HTML (via renderThemesTabPanel above),
  // never hand-built — a control arm emits none, so this set is empty exactly
  // when the served page's is (E11: the real producer side).
  const overrideRadios: Array<Record<string, unknown>> = overrideRadioSpecsFromPanel(themesHtml).map((spec) => ({
    ...el(),
    type: "radio",
    value: spec.value,
    checked: spec.checked,
    getAttribute: (n: string) => (n === "data-override-group" ? spec.group : null),
  }));
  const overrideNotes: Array<Record<string, unknown>> = overrideNoteGroupsFromPanel(themesHtml).map((group) => ({
    ...el(),
    className: "lg-override-note lg-hidden",
    getAttribute: (n: string) => (n === "data-override-note" ? group : null),
  }));
  const radioFor = (value: string): Record<string, unknown> => {
    const node = overrideRadios.find((r) => r["value"] === value);
    expect(node, `the override switch's '${value}' radio in the rendered panel`).toBeDefined();
    return node!;
  };

  const rootListeners: Record<string, Array<(ev: unknown) => void>> = { change: [], click: [] };
  const railListeners: Array<(ev: unknown) => void> = [];
  const saveListeners: Array<() => void> = [];
  const presetApplyListeners: Array<() => void> = [];
  const pickerListeners: Array<(ev: unknown) => void> = [];
  const docListeners: Record<string, Array<(ev: unknown) => void>> = {};

  const picker: Record<string, unknown> = {
    ...el(),
    getAttribute: (n: string) => (n === "data-lg-target-funnel" ? "" : null),
    addEventListener(kind: string, fn: (ev: unknown) => void) { if (kind === "change") pickerListeners.push(fn); },
    appendChild() {}, removeChild() {},
  };
  const presetSelect: Record<string, unknown> = { ...el(), value: "" };
  const abThemeListeners: Array<() => void> = [];
  let promptReply: string | null = "50";
  // The A/B tab's OWN "Add variant" precondition badge, with the value the
  // REAL served page carries for this quote (ab.ts computes it server-side) —
  // never a hand-picked string. Pre-fix, "A/B this theme" consulted this badge
  // (the editor funnel's verdict) before acting on the TARGET funnel.
  const servedAddVariantState = /data-add-variant-state="([^"]*)"/.exec(servedPage)?.[1] ?? "";
  // #lg-quote-editor's OWN data-quote-public-id, sliced out of the REAL served
  // page (ui-quotes.ts writes it on that div) — funnel.ts's island reads the
  // quote id from there for the quote-scoped GETs. Without it the stub root
  // answered "" and the island built `/quotes//structure`.
  const servedQuotePublicId = /id="lg-quote-editor"[^>]*data-quote-public-id="([^"]*)"/.exec(servedPage)?.[1] ?? "";
  const store: Record<string, Record<string, unknown>> = {
    "lg-quote-editor": {
      ...el(),
      getAttribute: (n: string) =>
        n === "data-funnel-public-id" ? editorFunnelPublicId
        : n === "data-variant-public-id" ? editorVariantPublicId
        : n === "data-quote-public-id" ? servedQuotePublicId
        : null,
      addEventListener(kind: string, fn: (ev: unknown) => void) { (rootListeners[kind] ??= []).push(fn); },
      querySelectorAll: (sel: string) =>
        sel === "[data-theme-key]" ? themeControls
        : sel === ".lg-role-swatch" ? allPickNodes
        : sel === "[data-theme-role]" ? roleRowNodes
        : sel === "[data-role-strip]" ? stripNodes
        : sel === "[data-harmony-step]" ? harmonyNodes
        : sel === "[data-override-group]" ? overrideRadios
        : sel === "[data-override-note]" ? overrideNotes
        : [],
    },
    "lg-quote-data": { ...el(), textContent: extractJsonBlob(servedPage, "lg-quote-data") },
    "lg-board-data": { ...el(), textContent: extractJsonBlob(servedPage, "lg-board-data") },
    "lg-theme-target-select": picker,
    "lg-theme-rail": { ...el(), addEventListener(kind: string, fn: (ev: unknown) => void) { if (kind === "change") railListeners.push(fn); } },
    "lg-theme-preset-select": presetSelect,
    "lg-theme-preset-apply": { ...el(), addEventListener(kind: string, fn: () => void) { if (kind === "click") presetApplyListeners.push(fn); } },
    "lg-theme-ab-this": { ...el(), addEventListener(kind: string, fn: () => void) { if (kind === "click") abThemeListeners.push(fn); } },
    "lg-add-variant": { ...el(), getAttribute: (n: string) => (n === "data-add-variant-state" ? servedAddVariantState : null) },
    "lg-variant-save": { ...el(), addEventListener(kind: string, fn: () => void) { if (kind === "click") saveListeners.push(fn); } },
    // ui-quotes.ts:764 renders this banner HIDDEN, above the tab strip.
    // P8-1 J1 (F-7): it is a real element with a real scroller, so the stub
    // carries the method the fix feature-detects and counts the calls.
    "lg-quote-error": { ...el(), hidden: true, scrolledIntoView: 0, scrollIntoView(this: Record<string, unknown>) { this["scrolledIntoView"] = Number(this["scrolledIntoView"] ?? 0) + 1; } },
  };

  const themesRoot = { ...el(), getAttribute: (n: string) => (n === "data-is-control" ? (isControl ? "true" : "false") : null) };
  const document = {
    getElementById(id: string) {
      if (store[id] === undefined) store[id] = el();
      return store[id];
    },
    querySelector(sel: string) {
      if (sel === "[data-lg-themes-tab]") return themesRoot;
      if (sel === "#lg-quote-editor") return store["lg-quote-editor"]!;
      // renderOverrideSwitch's own radio group — themes.ts's overrideIsOn().
      // P8-1 J1 (F-2): answered from the RADIOS' live checked state (real DOM
      // semantics), so what that island reads is what the editor island last
      // painted — the two can no longer disagree in the harness the way they
      // did in the product.
      if (sel === 'input[name="lg-ov-theme"]:checked') return overrideRadios.find((r) => r["checked"] === true) ?? null;
      return null;
    },
    querySelectorAll: () => [],
    createElement: () => ({ value: "", textContent: "", selected: false, children: [] as unknown[], appendChild(c: unknown) { (this.children as unknown[]).push(c); }, setAttribute() {} }),
    createTextNode: (s: unknown) => ({ nodeValue: s === null || s === undefined ? "" : String(s) }),
    createEvent: () => ({
      type: "", detail: null as unknown,
      initCustomEvent(t: string, _b: boolean, _c: boolean, d: unknown) { this.type = t; this.detail = d; },
    }),
    dispatchEvent(evt: { type: string }) {
      for (const fn of docListeners[evt.type] ?? []) fn(evt);
      return true;
    },
    addEventListener(kind: string, fn: (ev: unknown) => void) { (docListeners[kind] ??= []).push(fn); },
    body: el(),
  };
  const win = windowStubFor(page, {
    setTimeout(fn: () => void) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    addEventListener() {},
    // funnel.ts's fork path asks for the split with window.prompt (unchanged
    // by F7 — it is asked BEFORE any request, so a cancel writes nothing).
    prompt: () => promptReply,
  });
  (win["location"] as Record<string, unknown>)["reload"] = () => {};
  (win["location"] as Record<string, unknown>)["href"] = "";

  const fetchShim = (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    let parsedBody: unknown = null;
    if (typeof init?.body === "string") {
      try { parsedBody = JSON.parse(init.body); } catch { parsedBody = init.body; }
    }
    calls.push({ url, method, body: parsedBody });
    // P8-1 H1 (m-2): review #3 drove this with an injected 500 on the target
    // funnel's theme GET. Same fault here, in the SAME shape the worker really
    // answers with (a JSON {error} body), so the island's own failure branch
    // is what runs.
    if (brokenThemeGetFunnel !== "" && method === "GET" && url.endsWith("/theme") && url.includes(brokenThemeGetFunnel)) {
      const failed = Promise.resolve(
        new Response(JSON.stringify({ error: "theme read failed" }), { status: 500, headers: { "content-type": "application/json" } }),
      );
      pending.push(failed);
      return failed;
    }
    const p = Promise.resolve(admin.request(`http://localhost${url}`, init as RequestInit, env));
    pending.push(p);
    return p;
  };

  runInNewContext(`${QUOTE_EDITOR_SCRIPT}\n${themesScript}`, {
    document, window: win, fetch: fetchShim, setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; },
    clearTimeout() {}, JSON, Object, String, Boolean, Number,
  });

  return {
    pickThemesFunnel(publicId) {
      picker["value"] = publicId;
      for (const fn of pickerListeners) fn({ target: picker });
    },
    setThemeOverride(on) {
      // A real radio click: the picked input becomes checked, its sibling
      // un-checks, and the change event carries THAT node (pre-J1 this fired a
      // synthetic object and left the page's own radios untouched, which is
      // precisely the state F-2 lived in).
      const radio = radioFor(on ? "override" : "inherit");
      for (const r of overrideRadios) r["checked"] = r === radio;
      for (const fn of rootListeners["change"] ?? []) fn({ target: radio });
    },
    overrideSwitch() {
      const checked = overrideRadios.filter((r) => r["checked"] === true).map((r) => String(r["value"] ?? ""));
      expect(checked.length, "a radio group shows at most one checked input").toBeLessThan(2);
      const note = overrideNotes[0];
      return {
        checked: checked.length === 0 ? "" : checked[0]!,
        disabled: overrideRadios.every((r) => r["disabled"] === true),
        enabled: overrideRadios.every((r) => r["disabled"] === false),
        note: String(note?.["textContent"] ?? ""),
        noteHidden: String(note?.["className"] ?? "").indexOf("lg-hidden") > -1,
      };
    },
    pickPaletteRole(role, value) {
      const swatch = {
        getAttribute: (n: string) => (n === "data-role-pick" ? value : n === "data-role-pick-for" ? `palette.${role}` : null),
      };
      for (const fn of rootListeners["click"] ?? []) fn({ target: swatch });
    },
    resetRole(role) {
      // renderThemeEditorPanel's own "Reset to inherited" button.
      const btn = { ...el(), getAttribute: (n: string) => (n === "data-role-reset" ? role : null) };
      for (const fn of rootListeners["click"] ?? []) fn({ target: btn });
    },
    roleSwatchColor(role) {
      return bg(roleSwatch[role]);
    },
    roleAuthorship(role) {
      const texts = roleSourceText[role] ?? [];
      return texts.length === 0 ? "" : texts[texts.length - 1]!;
    },
    selectedRolePick(role) {
      const picked = (rolePicks[role] ?? []).filter((n) => String(n["className"] ?? "").indexOf("selected") > -1);
      expect(picked.length, `at most one selected pick in the ${role} strip`).toBeLessThan(2);
      return picked.length === 0 ? "" : String(picked[0]!["getAttribute"] instanceof Function ? (picked[0]!["getAttribute"] as (n: string) => string | null)("data-role-pick") : "");
    },
    harmonyChipColor(role, step) {
      return bg(harmonyChip[`${role}/${step}`]);
    },
    clickHarmony(role, step) {
      const node = harmonyNodes.find((n) => {
        const get = n["getAttribute"] as (name: string) => string | null;
        return get("data-harmony-role") === role && get("data-harmony-step") === step;
      });
      expect(node, `harmony step ${role}/${step}`).toBeDefined();
      for (const fn of rootListeners["click"] ?? []) fn({ target: node });
    },
    editRailControl(key, value) {
      // ONE real change event: in the page both listeners (funnel.ts's on
      // #lg-quote-editor, themes.ts's on #lg-theme-rail) see the same target.
      const ctl = controlOf(key);
      ctl["value"] = value;
      for (const fn of railListeners) fn({ target: ctl });
      for (const fn of rootListeners["change"] ?? []) fn({ target: ctl });
    },
    applyPreset(themeId) {
      presetSelect["value"] = themeId;
      for (const fn of presetApplyListeners) fn();
    },
    abThisTheme(themeId, percent) {
      presetSelect["value"] = themeId;
      promptReply = percent;
      for (const fn of abThemeListeners) fn();
    },
    navigatedTo() {
      return String((win["location"] as Record<string, unknown>)["href"] ?? "");
    },
    clickSave() {
      for (const fn of saveListeners) fn();
    },
    controlValue(key) {
      return String(controlOf(key)["value"] ?? "");
    },
    failThemeGetsFor(publicId) {
      brokenThemeGetFunnel = publicId;
    },
    pageError() {
      const banner = store["lg-quote-error"]!;
      return {
        text: String(banner["textContent"] ?? ""),
        hidden: banner["hidden"] === true,
        scrolledIntoView: Number(banner["scrolledIntoView"] ?? 0),
      };
    },
    calls,
    flushTimers() {
      const queued = timers.splice(0, timers.length);
      for (const fn of queued) fn();
    },
    async settle() {
      for (let i = 0; i < 30; i += 1) {
        await Promise.allSettled(pending.slice());
        this.flushTimers();
        await Promise.allSettled(pending.slice());
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  };
}

async function storedTheme(env: Env, funnelPublicId: string): Promise<Record<string, unknown>> {
  const body = await json<{ theme: Record<string, unknown> }>(await admin.request(`${API}/funnels/${funnelPublicId}/theme`, {}, env), `GET theme ${funnelPublicId}`);
  return body.theme;
}

describeDb("P8-1 F6 (contract R6-1) — DRIVEN: the Themes panel's writes and its controls both follow the target funnel", () => {
  it("PRESET APPLY: 'Apply to this funnel' writes the funnel the header names, and leaves the editor's funnel byte-identical", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    const aBefore = JSON.stringify(await storedTheme(env, fx.funnelA));
    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, fx.variantA, ["typography.display_size"], boardPage(fx), true);
    await island.settle();

    island.pickThemesFunnel(fx.funnelC);
    await island.settle();
    island.applyPreset(fx.presetId);
    await island.settle();

    // FAIL-BEFORE (measured in a real browser, 2026-08-03): this list was
    // [`${API}/funnels/${fx.funnelA}/theme`] — the editor's funnel.
    expect(island.calls.filter((c) => c.method === "PUT" && c.url.endsWith("/theme")).map((c) => c.url)).toEqual([
      `${API}/funnels/${fx.funnelC}/theme`,
    ]);
    expect(await storedTheme(env, fx.funnelC), "the targeted funnel got the preset").toEqual({ theme_id: fx.presetId });
    expect(JSON.stringify(await storedTheme(env, fx.funnelA)), "the editor's funnel is untouched").toBe(aBefore);
    sdb.close();
  });

  it("REPAINT: after a target switch the rail's theme control shows the TARGET funnel's stored value, not a blank 'inherit'", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    await putFunnelTheme(env, fx.funnelA, { typography: { display_size: "l" } });
    await putFunnelTheme(env, fx.funnelC, { typography: { display_size: "xl" } });

    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, fx.variantA, ["typography.display_size"], boardPage(fx), true);
    await island.settle();
    expect(island.controlValue("typography.display_size"), "boots on the editor funnel's own value").toBe("l");

    island.pickThemesFunnel(fx.funnelC);
    await island.settle();
    // FAIL-BEFORE (measured in a real browser): "" — every rail select read
    // "Inherit from base design" while the header named the target.
    expect(island.controlValue("typography.display_size"), "the control must show the TARGET funnel's stored value").toBe("xl");

    island.pickThemesFunnel(fx.funnelA);
    await island.settle();
    expect(island.controlValue("typography.display_size"), "switching back shows that funnel's value again").toBe("l");
    sdb.close();
  });

  it("ONE EDIT, ONE WRITE: a rail edit autosaves once and the following Save re-sends nothing", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    await putFunnelTheme(env, fx.funnelC, { typography: { display_size: "xl" } });
    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, fx.variantA, ["typography.display_size"], boardPage(fx), true);
    await island.settle();
    island.pickThemesFunnel(fx.funnelC);
    await island.settle();

    island.editRailControl("typography.display_size", "xxl");
    await island.settle();
    const afterEdit = island.calls.filter((c) => c.method === "PUT" && c.url.endsWith("/theme")).map((c) => c.url);
    expect(afterEdit, "the rail's own autosave, once, on the target").toEqual([`${API}/funnels/${fx.funnelC}/theme`]);

    island.clickSave();
    await island.settle();
    // FAIL-BEFORE (measured): a SECOND PUT of the same value to the same funnel.
    expect(island.calls.filter((c) => c.method === "PUT" && c.url.endsWith("/theme")).map((c) => c.url), "Save re-sends nothing the rail already landed").toEqual(afterEdit);
    expect((await storedTheme(env, fx.funnelC))["typography"], "and the value is persisted").toEqual({ display_size: "xxl" });
    sdb.close();
  });

  it("A/B ARM + OVERRIDE ON: with another funnel targeted the palette edit writes THAT funnel's theme, never the editor arm's overrides", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    // A REAL non-control arm: the server only allows a second variant as an arm
    // of a RUNNING test, so this is the product's own create -> start -> fork.
    const exp = await json<{ public_id: string }>(await admin.request(`${API}/funnels/${fx.funnelA}/experiments`, jsonInit("POST", {}), env), "create experiment");
    await json(await admin.request(`${API}/experiments/${exp.public_id}/start`, jsonInit("POST"), env), "start experiment");
    const arm = await json<{ public_id: string }>(await admin.request(`${API}/variants/${fx.variantA}/fork`, jsonInit("POST"), env), "fork arm");

    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit?variant=${arm.public_id}`, {}, env)).text();
    expect(servedPage, "the served page really is on a NON-control arm").toContain('"selected_variant_is_control":false');
    const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, arm.public_id, ["typography.display_size"], boardPage(fx), false);
    await island.settle();

    island.pickThemesFunnel(fx.funnelC);
    await island.settle();
    island.setThemeOverride(true);
    island.pickPaletteRole("brand_primary", "accent");
    await island.settle();
    island.clickSave();
    await island.settle();

    // FAIL-BEFORE (F5's named residual): the edit rode frame_overrides_json to
    // PUT /variants/<the editor arm> — funnel A's arm — and funnel C, the one
    // the header names, changed nothing at all.
    expect(island.calls.filter((c) => c.method === "PUT" && c.url.endsWith("/theme")).map((c) => c.url)).toEqual([
      `${API}/funnels/${fx.funnelC}/theme`,
    ]);
    expect((await storedTheme(env, fx.funnelC))["palette"], "the targeted funnel carries the role").toMatchObject({ brand_primary: "accent" });
    const structure = await json<{ funnels: Array<{ public_id: string; variants: Array<{ public_id: string; frame_overrides_json: unknown }> }> }>(
      await admin.request(`${API}/quotes/${fx.quotePublicId}/structure`, {}, env),
      "read the arm back",
    );
    const armRow = structure.funnels.flatMap((f) => f.variants).find((v) => v.public_id === arm.public_id);
    expect(armRow, "the forked arm is on the board").toBeDefined();
    expect(armRow!.frame_overrides_json, "the editor arm's overrides are untouched").toBeFalsy();
    sdb.close();
  });
});

// ===========================================================================
// P8-1 G1 (contract R6-1, §5 B3 — review #2's F-1/F-2) — the rail's COLOUR
// half follows the target funnel too.
//
// F6 fixed the 16 [data-theme-key] SELECTS and left the 14 role rows beside
// them reading the editor funnel: a REDUCED MODEL of its own fix. Driven in a
// real browser (review #2, 2026-08-03, 1280 and 375): with P8-Charlie targeted
// the canvas painted Charlie's --lg-primary #0E7C3A while the Brand-primary
// swatch painted rgb(171,18,52) — Funnel A's #AB1234 — and Charlie's
// brand_primary, explicitly authored as the role `success`, displayed
// "Base design" with no role-pick marked selected.
// Same DRIVEN shape as the F6 block above: both real islands in one document,
// every fetch through the REAL admin router over a REAL D1 schema, the role
// rows built from the REAL rendered panel markup, and the funnels' ACTUAL
// persisted rows read back for the expected values (E10/E11).
// ===========================================================================

async function effectiveTokens(env: Env, funnelPublicId: string): Promise<Record<string, string>> {
  const body = await json<{ effective_tokens: Record<string, string> }>(
    await admin.request(`${API}/funnels/${funnelPublicId}/theme`, {}, env),
    `GET effective_tokens ${funnelPublicId}`,
  );
  return body.effective_tokens;
}

// A/C are given DISTINGUISHABLE palettes in the two shapes the product really
// stores: a hex on the editor funnel, a ROLE ALIAS on the target (the live
// P8-Charlie fixture stores palette.brand_primary = "success").
async function seedTwoTonedPalettes(env: Env, fx: ThreeFunnelFixture): Promise<void> {
  await putFunnelTheme(env, fx.funnelA, { palette: { brand_primary: "#AB1234", brand_secondary: "#EE7733" } });
  await putFunnelTheme(env, fx.funnelC, { palette: { brand_primary: "success" } });
}

describeDb("P8-1 G1 (contract R6-1) — DRIVEN: the Themes rail's COLOUR half resolves from the TARGET funnel", () => {
  it("F-1: EVERY role swatch resolves from the TARGET funnel's own palette, and switching back restores the editor funnel's", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    await seedTwoTonedPalettes(env, fx);
    const aTokens = await effectiveTokens(env, fx.funnelA);
    const cTokens = await effectiveTokens(env, fx.funnelC);
    expect(cTokens["brand_primary"], "the two funnels really do resolve brand_primary differently").not.toBe(aTokens["brand_primary"]);

    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, fx.variantA, ["typography.display_size"], boardPage(fx), true);
    await island.settle();
    const roles = roleRowsFromPanel(renderThemesTabPanel(true)).map((r) => r.role);
    expect(roles.length, "all 14 09 §9.2 roles are on the rail").toBe(14);
    for (const role of roles) {
      expect(island.roleSwatchColor(role), `boot: ${role} paints the editor funnel's own value`).toBe(aTokens[role] ?? "");
    }

    island.pickThemesFunnel(fx.funnelC);
    await island.settle();
    // FAIL-BEFORE (measured in a real browser, review #2): every one of these
    // still painted the EDITOR funnel's table — brand_primary rgb(171,18,52).
    for (const role of roles) {
      expect(island.roleSwatchColor(role), `after the switch: ${role} paints the TARGET funnel's value`).toBe(cTokens[role] ?? "");
    }
    expect(island.roleSwatchColor("brand_primary"), "…which is not the editor funnel's").not.toBe(aTokens["brand_primary"]);

    island.pickThemesFunnel(fx.funnelA);
    await island.settle();
    for (const role of roles) {
      expect(island.roleSwatchColor(role), `switching back: ${role} paints the editor funnel again`).toBe(aTokens[role] ?? "");
    }
    expect(island.calls.filter((c) => c.method !== "GET"), "reading the rail wrote nothing to any funnel").toEqual([]);
    sdb.close();
  });

  it("F-2: the authorship tag and the marked role pick describe the TARGET funnel's own theme", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    await seedTwoTonedPalettes(env, fx);
    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, fx.variantA, ["typography.display_size"], boardPage(fx), true);
    await island.settle();
    expect(island.roleAuthorship("brand_secondary"), "boot: a role the EDITOR funnel authors").toBe("This funnel");
    expect(island.selectedRolePick("brand_primary"), "boot: the editor funnel's hex is not one of the 14 role picks").toBe("");

    island.pickThemesFunnel(fx.funnelC);
    await island.settle();
    // FAIL-BEFORE (measured in a real browser, review #2): "Base design" for
    // EVERY role, and no swatch in any strip marked selected — the switch
    // listener empties workingTheme, which is what both of these read.
    expect(island.roleAuthorship("brand_primary"), "the role the TARGET funnel authored says so").toBe("This funnel");
    expect(island.selectedRolePick("brand_primary"), "and its role-value pick is the marked one").toBe("success");
    expect(island.roleAuthorship("brand_secondary"), "a role only the EDITOR funnel authors is NOT claimed for the target").toBe("Base design");
    expect(island.roleAuthorship("accent"), "a role neither funnel authors still reads inherited").toBe("Base design");

    island.pickThemesFunnel(fx.funnelA);
    await island.settle();
    expect(island.roleAuthorship("brand_secondary"), "switching back restores the editor funnel's authorship").toBe("This funnel");
    expect(island.selectedRolePick("brand_primary"), "…and its strip has no role-value pick marked").toBe("");
    sdb.close();
  });

  it("F-2 residue: a role cleared THIS SESSION reads inherited again, on the target and on the editor funnel", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    await seedTwoTonedPalettes(env, fx);
    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, fx.variantA, ["typography.display_size"], boardPage(fx), true);
    await island.settle();

    island.pickThemesFunnel(fx.funnelC);
    await island.settle();
    island.pickPaletteRole("brand_primary", "accent");
    await island.settle();
    expect(island.selectedRolePick("brand_primary"), "an edit made HERE is the marked pick").toBe("accent");
    expect(island.roleAuthorship("brand_primary"), "…and still authored by this funnel").toBe("This funnel");

    // The stored theme underneath must not put a cleared role back: "Reset to
    // inherited" is the only affordance that says "use the base design".
    island.resetRole("brand_primary");
    await island.settle();
    expect(island.roleAuthorship("brand_primary"), "cleared on the TARGET reads inherited").toBe("Base design");
    expect(island.selectedRolePick("brand_primary"), "…with no pick marked").toBe("");

    island.pickThemesFunnel(fx.funnelA);
    await island.settle();
    island.resetRole("brand_secondary");
    await island.settle();
    expect(island.roleAuthorship("brand_secondary"), "cleared on the EDITOR funnel reads inherited too").toBe("Base design");
    sdb.close();
  });
});

// ===========================================================================
// P8-1 H1 (contract R6-1, §5 B3 — review #3's BLOCKER) — THE READ SIDE.
//
// The THIRD instance of this reduced model on this one surface. F5/F6/G1 each
// pointed a WRITE (or a whole rail half) at the target funnel; the arm's
// override palette was still READ ungated, so in an arm-override session with
// a different funnel targeted the rail painted the EDITOR ARM's colour, tagged
// it "This funnel" and marked no pick — under a header and picker both reading
// the target's name — while the canvas beside it painted the target's own.
// Driven by review #3 (2026-08-03, 1280 and 375): swatch rgb(255, 153, 0) on
// all four role strips with "Editing: P8-Bravo" above them, and then the
// control looked DEAD — a role pick for Bravo issued its PUT, the value was
// stored, and the swatch did not move, because the ungated read outranked what
// the pick had just written.
// Same DRIVEN shape as the F6/G1 blocks: both real islands in one document,
// a REAL non-control arm made by the product's own create -> start -> fork,
// every fetch through the REAL admin router over a REAL D1 schema, and the
// funnels' ACTUAL persisted rows read back (E10/E11).
// ===========================================================================

interface ArmOverrideSession {
  island: SeamHandle;
  arm: string;
  aTokens: Record<string, string>;
  cTokens: Record<string, string>;
}

// The reviewer's exact in-UI sequence: fork an arm off the editor funnel, land
// on /edit?variant=<that arm>, open Themes, tick "Override for this variant",
// then author Brand primary (and one more role) on the ARM.
async function armOverrideSession(env: Env, fx: ThreeFunnelFixture): Promise<ArmOverrideSession> {
  const exp = await json<{ public_id: string }>(await admin.request(`${API}/funnels/${fx.funnelA}/experiments`, jsonInit("POST", {}), env), "create experiment");
  await json(await admin.request(`${API}/experiments/${exp.public_id}/start`, jsonInit("POST"), env), "start experiment");
  const arm = await json<{ public_id: string }>(await admin.request(`${API}/variants/${fx.variantA}/fork`, jsonInit("POST"), env), "fork arm");

  const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit?variant=${arm.public_id}`, {}, env)).text();
  expect(servedPage, "the served page really is on a NON-control arm").toContain('"selected_variant_is_control":false');
  const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, arm.public_id, ["typography.display_size"], boardPage(fx), false);
  await island.settle();

  island.setThemeOverride(true);
  island.pickPaletteRole("brand_primary", "accent");
  island.pickPaletteRole("brand_secondary", "success");
  await island.settle();
  return { island, arm: arm.public_id, aTokens: await effectiveTokens(env, fx.funnelA), cTokens: await effectiveTokens(env, fx.funnelC) };
}

describeDb("P8-1 H1 (contract R6-1) — DRIVEN: in an arm-override session the rail's colour half describes the funnel a write would reach", () => {
  it("(a) with ANOTHER funnel targeted, the swatch, the authorship tag and the marked pick all resolve from the TARGET — not the editor arm", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    await seedTwoTonedPalettes(env, fx);
    const { island, aTokens, cTokens } = await armOverrideSession(env, fx);

    // ON THE EDITOR'S OWN FUNNEL the arm override IS what a write touches, so
    // it is exactly what the rail must show — including the marked pick, which
    // pre-H1 read the funnel's stored theme while the pick wrote the arm.
    expect(island.roleSwatchColor("brand_primary"), "the arm's own value is shown while the arm owns the write").toBe(aTokens["accent"]);
    expect(island.roleAuthorship("brand_primary")).toBe("This funnel");
    expect(island.selectedRolePick("brand_primary"), "FAIL-BEFORE: '' — the ring stayed on the funnel's stored value").toBe("accent");

    island.pickThemesFunnel(fx.funnelC);
    await island.settle();

    // FAIL-BEFORE (driven, review #3): rgb(255, 153, 0) — the editor ARM's
    // colour, on a funnel whose canvas 30px away painted its own.
    expect(island.roleSwatchColor("brand_primary"), "the TARGET funnel's own brand_primary").toBe(cTokens["brand_primary"]);
    expect(island.roleSwatchColor("brand_primary"), "…which is NOT the arm's").not.toBe(aTokens["accent"]);
    expect(island.roleAuthorship("brand_primary"), "the target really does author this role").toBe("This funnel");
    expect(island.selectedRolePick("brand_primary"), "…and the marked pick is the target's role value").toBe("success");
    // FAIL-BEFORE: "This funnel" and the arm's colour, on a role funnel C has
    // never authored — the tag claimed authorship for a funnel that has none.
    expect(island.roleAuthorship("brand_secondary"), "a role only the ARM overrides is NOT claimed for the target").toBe("Base design");
    expect(island.roleSwatchColor("brand_secondary"), "…and it paints the target's inherited value").toBe(cTokens["brand_secondary"]);
    expect(island.selectedRolePick("brand_secondary"), "…with no pick marked").toBe("");

    island.pickThemesFunnel(fx.funnelA);
    await island.settle();
    expect(island.roleSwatchColor("brand_primary"), "switching back to the arm's own funnel restores the arm's value").toBe(aTokens["accent"]);
    expect(island.selectedRolePick("brand_secondary"), "…and the arm's other override is marked again").toBe("success");
    sdb.close();
  });

  it("(b) a role pick in that state MOVES the swatch, and the value it moves to is the one the write persisted", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    await seedTwoTonedPalettes(env, fx);
    const { island, arm, cTokens } = await armOverrideSession(env, fx);
    expect(cTokens["accent"], "the two roles really do resolve differently on the target").not.toBe(cTokens["brand_primary"]);

    island.pickThemesFunnel(fx.funnelC);
    await island.settle();
    const before = island.roleSwatchColor("brand_primary");

    island.pickPaletteRole("brand_primary", "accent");
    await island.settle();
    const after = island.roleSwatchColor("brand_primary");

    // FAIL-BEFORE (driven, review #3): before === after === the arm's colour.
    // The PUT landed, the row changed, and the control looked dead.
    expect(after, "the swatch moved").not.toBe(before);
    expect(after, "…to the value the target funnel now resolves for the picked role").toBe(cTokens["accent"]);
    expect((await storedTheme(env, fx.funnelC))["palette"], "and that is what was really persisted").toMatchObject({ brand_primary: "accent" });

    const structure = await json<{ funnels: Array<{ public_id: string; variants: Array<{ public_id: string; frame_overrides_json: unknown }> }> }>(
      await admin.request(`${API}/quotes/${fx.quotePublicId}/structure`, {}, env),
      "read the arm back",
    );
    const armRow = structure.funnels.flatMap((f) => f.variants).find((v) => v.public_id === arm);
    expect(armRow!.frame_overrides_json, "the arm was never written to — nothing was SAVED in this session").toBeFalsy();
    sdb.close();
  });

  it("(m-2) a FAILED target-funnel theme GET keeps the controls as they were and says why on the page's own error banner", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    await seedTwoTonedPalettes(env, fx);
    await putFunnelTheme(env, fx.funnelA, { palette: { brand_primary: "#AB1234", brand_secondary: "#EE7733" }, typography: { display_size: "l" } });
    const aTokens = await effectiveTokens(env, fx.funnelA);

    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, fx.variantA, ["typography.display_size"], boardPage(fx), true);
    await island.settle();
    expect(island.controlValue("typography.display_size"), "boots on the editor funnel's own value").toBe("l");
    expect(island.pageError().hidden, "no error to start with").toBe(true);

    island.failThemeGetsFor(fx.funnelC);
    island.pickThemesFunnel(fx.funnelC);
    await island.settle();

    // FAIL-BEFORE (driven, review #3, injected 500): all 14 swatches went
    // rgba(0, 0, 0, 0) and every select blank, because the failed body still
    // announced an EMPTY theme + EMPTY colour table — with the page's error
    // element still hidden. The comment claimed the opposite of both.
    // Re-driven live on the fixed build (1280 and 375): 0 of 14 swatches
    // transparent, brand_primary still rgb(171, 18, 52), banner shown.
    for (const role of roleRowsFromPanel(renderThemesTabPanel(true)).map((r) => r.role)) {
      expect(island.roleSwatchColor(role), `${role} keeps the value it had`).toBe(aTokens[role] ?? "");
    }
    expect(island.controlValue("typography.display_size"), "and so does the select").toBe("l");
    const err = island.pageError();
    expect(err.hidden, "the page's error banner is shown").toBe(false);
    expect(err.text, "…and it names the funnel and says the controls did not change").toContain("Funnel C");
    expect(err.text).toContain("still show the previous values");
    // Holding the previous VALUES must not hold the previous EDITS: they were
    // authored against the editor funnel and the chain now writes the target.
    island.clickSave();
    await island.settle();
    expect(island.calls.filter((c) => c.method === "PUT" && c.url.includes(fx.funnelC)), "nothing is written to the funnel whose theme could not be read").toEqual([]);
    sdb.close();
  });
});

// ===========================================================================
// P8-1 H1 — THE CLASS, not the instance: no read of the arm's override THEME
// state may be added without the predicate its writes already ask.
// Five rounds fixed a sentence; this fails on the SHAPE.
// ===========================================================================

// Every `function …(…) { … }` body in `src`, innermost-first for a given
// offset. Same naive balanced scan sliceIslandFns above uses (this island is
// ES5 with no brace-carrying string literals — asserted by the site count
// below, which pins how many sites exist at all).
function functionSpansOf(src: string): Array<{ name: string; start: number; end: number; body: string }> {
  const spans: Array<{ name: string; start: number; end: number; body: string }> = [];
  const re = /function\s*([A-Za-z0-9_$]*)\s*\(/g;
  for (;;) {
    const m = re.exec(src);
    if (m === null) return spans;
    const open = src.indexOf("{", m.index);
    if (open === -1) return spans;
    let depth = 0;
    let i = open;
    for (; i < src.length; i += 1) {
      const ch = src.charAt(i);
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    spans.push({ name: m[1] ?? "", start: open, end: i, body: src.slice(open, i + 1) });
  }
}

function innermostFunctionAt(spans: ReturnType<typeof functionSpansOf>, at: number): { name: string; start: number; body: string } | null {
  let best: { name: string; start: number; body: string } | null = null;
  for (const s of spans) {
    if (s.start > at || s.end < at) continue;
    if (best === null || s.start > best.start) best = { name: s.name, start: s.start, body: s.body };
  }
  return best;
}

describe("P8-1 H1 (contract R6-1) — every read of the arm's override theme state asks the same predicate its writes ask", () => {
  // The ONLY functions allowed to name workingOverrides.theme, each with the
  // reason it is allowed. A read added anywhere else fails this list; a read
  // added INSIDE one of these fails the gate-first check below.
  const OVERRIDE_THEME_SITES: ReadonlyArray<{ fn: string; why: string }> = [
    { fn: "shownOverridePalette", why: "the ONE read: returns {} unless themeOverrideActive()" },
    { fn: "applyPaletteValue", why: "the palette WRITE: same predicate, same branch" },
    { fn: "", why: "the anonymous data-role-reset click listener: the reset WRITE, gated by editorArmOwnsTarget()" },
  ];
  const GATES = ["themeOverrideActive()", "editorArmOwnsTarget()"];

  it("funnel.ts EDITOR island: workingOverrides.theme is named only in gated functions, and the gate is asked BEFORE it", () => {
    const editor = topLevelIslands(QUOTE_EDITOR_SCRIPT).find((s) => s.includes("function saveTargetFunnelPublicId("));
    expect(editor, "the editor island").toBeDefined();
    const spans = functionSpansOf(editor!);
    const sites: Array<{ fn: string; at: number }> = [];
    for (let from = 0; ; ) {
      const at = editor!.indexOf("workingOverrides.theme", from);
      if (at === -1) break;
      const fn = innermostFunctionAt(spans, at);
      expect(fn, `workingOverrides.theme at ${at} sits outside every function body`).not.toBeNull();
      sites.push({ fn: fn!.name, at });
      // The gate must be asked in that function, TEXTUALLY BEFORE this use —
      // an override read placed above its own guard is the same defect.
      const gateAt = GATES.map((g) => fn!.body.indexOf(g)).filter((i) => i > -1);
      expect(gateAt.length, `${fn!.name || "<anonymous>"} names workingOverrides.theme but never asks ${GATES.join(" / ")}`).toBeGreaterThan(0);
      expect(Math.min(...gateAt) + fn!.start, `${fn!.name || "<anonymous>"}: the gate must be asked before the override is touched`).toBeLessThan(at);
      from = at + 1;
    }
    expect(sites.length, "the override-theme sites in the editor island").toBeGreaterThanOrEqual(OVERRIDE_THEME_SITES.length);
    for (const site of sites) {
      const allowed = OVERRIDE_THEME_SITES.some((s) => s.fn === site.fn);
      expect(allowed, `workingOverrides.theme read in '${site.fn || "<anonymous>"}' — route it through shownOverridePalette(), or add it to OVERRIDE_THEME_SITES WITH a reason`).toBe(true);
    }
    // …and the anonymous entry really is the reset listener, not any other
    // anonymous function that happens to touch the overrides.
    for (const site of sites.filter((s) => s.fn === "")) {
      const fn = innermostFunctionAt(spans, site.at)!;
      expect(fn.body, "the only anonymous site is the role-reset listener").toContain("data-role-reset");
    }
  });

  it("funnel.ts EDITOR island: the rail's three colour reads all resolve through that one helper", () => {
    const editor = topLevelIslands(QUOTE_EDITOR_SCRIPT).find((s) => s.includes("function saveTargetFunnelPublicId("))!;
    const helper = sliceIslandFns(editor, "shownOverridePalette")[0] ?? "";
    expect(helper, "the read helper asks the write predicate").toContain("themeOverrideActive()");
    expect(sliceIslandFns(editor, "resolveRoleValue")[0] ?? "", "the displayed VALUE").toContain("shownOverridePalette()");
    expect(sliceIslandFns(editor, "paintSwatches")[0] ?? "", "the authorship TAG").toContain("shownOverridePalette()");
    expect(sliceIslandFns(editor, "markStripSelection")[0] ?? "", "the marked PICK").toContain("shownOverridePalette()");
    // The frame half of the same set: its write router is gated, so its read
    // (the inspector controls + the non-palette strip selections) is too.
    expect(sliceIslandFns(editor, "clientEffective")[0] ?? "", "the frame-override read").toContain("editorArmOwnsTarget()");
  });
});

// ===========================================================================
// P8-1 F7 (contract R6-1, §5 B3) — "A/B this theme": the LAST enumerated
// wrong-target write in the three quote-editor islands.
//
// F6 enumerated all 32 entity-scoped requests and fixed every wrong one except
// this: the Themes rail's "A/B this theme" forked the EDITOR funnel's arm and
// stopped/started the EDITOR funnel's experiment while the rail's header named
// a different funnel. It is the owner's B3 sentence ("a theme edit writes to
// the wrong funnel") in its most destructive form — the write lands on a LIVE
// A/B test of a funnel nobody is looking at.
// The fix is the sibling island's proven flow, not a new one: quotes-tabs/
// templates.ts's "A/B templates" ensureRunningThenFork (GET the quote
// structure -> the funnel's own ab_tests -> the running one, else create +
// start), run against the target funnel, then the §16.2 stop -> edit -> start
// split cycle on THAT experiment.
// Driven, not asserted on strings: both real islands in one document, every
// fetch through the REAL admin router over a REAL D1 schema, and the funnels'
// ACTUAL persisted rows read back afterwards (E10/E11).
// ===========================================================================

interface StructureFunnel {
  public_id: string;
  ab_tests: Array<{ public_id: string; status: string }>;
  variants: Array<{ public_id: string; status: string; traffic_allocation_bp: number; frame_overrides_json: unknown }>;
}

async function readStructureFunnels(env: Env, quotePublicId: string): Promise<StructureFunnel[]> {
  const body = await json<{ funnels: StructureFunnel[] }>(
    await admin.request(`${API}/quotes/${quotePublicId}/structure`, {}, env),
    "read structure",
  );
  return body.funnels;
}

function funnelOf(funnels: StructureFunnel[], publicId: string): StructureFunnel {
  const f = funnels.find((x) => x.public_id === publicId);
  expect(f, `funnel ${publicId} in the structure`).toBeDefined();
  return f!;
}

describeDb("P8-1 F7 (contract R6-1) — DRIVEN: 'A/B this theme' forks the TARGET funnel's arm and cycles the TARGET funnel's experiment", () => {
  it("with another funnel targeted, every write lands on THAT funnel and the editor funnel's arm + experiment are untouched", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    const before = await readStructureFunnels(env, fx.quotePublicId);
    const aBefore = funnelOf(before, fx.funnelA);
    expect(aBefore.ab_tests, "the editor funnel starts with no A/B test").toEqual([]);
    expect(aBefore.variants.length, "…and one arm").toBe(1);
    const aArmBpBefore = aBefore.variants[0]!.traffic_allocation_bp;

    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, fx.variantA, ["typography.display_size"], boardPage(fx), true);
    await island.settle();

    island.pickThemesFunnel(fx.funnelC);
    await island.settle();
    island.abThisTheme(fx.presetId, "30");
    await island.settle();

    // ---- (1) the requests, in order -------------------------------------
    // FAIL-BEFORE: this list was [] — the editor funnel's OWN "Add variant"
    // badge ("no-test", server-computed for funnel A) refused a fork of funnel
    // C outright; with that badge "ready" it instead issued
    // `POST /variants/<funnel A's arm>/fork` and stopped/started funnel A's
    // experiment. Either way, funnel C — the funnel the header names — was
    // never touched.
    const writes = island.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`);
    const after = await readStructureFunnels(env, fx.quotePublicId);
    const cAfter = funnelOf(after, fx.funnelC);
    const cTest = cAfter.ab_tests.find((t) => t.status === "running");
    expect(cTest, `the target funnel has a RUNNING test after the click (writes: ${writes.join(" | ")})`).toBeDefined();
    const newArm = cAfter.variants.find((v) => v.public_id !== fx.variantC);
    expect(newArm, "the target funnel gained the forked arm").toBeDefined();

    expect(writes, "create+start the TARGET's test, fork the TARGET's arm, then the §16.2 stop -> edit -> start split cycle on THAT test").toEqual([
      `POST ${API}/funnels/${fx.funnelC}/experiments`,
      `POST ${API}/experiments/${cTest!.public_id}/start`,
      `POST ${API}/variants/${fx.variantC}/fork`,
      `POST ${API}/experiments/${cTest!.public_id}/stop`,
      `PUT ${API}/variants/${newArm!.public_id}`,
      `PUT ${API}/variants/${fx.variantC}`,
      `POST ${API}/experiments/${cTest!.public_id}/start`,
    ]);
    // Nothing in the whole click mentions the editor funnel or its arm.
    for (const w of writes) {
      expect(w.includes(fx.funnelA), `'${w}' names the EDITOR funnel`).toBe(false);
      expect(w.includes(fx.variantA), `'${w}' names the EDITOR funnel's arm`).toBe(false);
    }

    // ---- (2) the target funnel's persisted state ------------------------
    expect(newArm!.frame_overrides_json, "the new arm carries the picked preset as its theme override").toEqual({ theme_id: fx.presetId });
    expect(newArm!.traffic_allocation_bp, "the new arm got the 30% the operator typed").toBe(3000);
    expect(funnelOf(after, fx.funnelC).variants.find((v) => v.public_id === fx.variantC)!.traffic_allocation_bp, "the original arm keeps the rest").toBe(7000);

    // ---- (3) the editor funnel, byte for byte ---------------------------
    const aAfter = funnelOf(after, fx.funnelA);
    expect(aAfter.ab_tests, "the editor funnel's experiments: none created, none stopped, none started").toEqual([]);
    expect(aAfter.variants.length, "the editor funnel still has exactly one arm").toBe(1);
    expect(aAfter.variants[0]!.public_id, "…and it is the same arm").toBe(fx.variantA);
    expect(aAfter.variants[0]!.traffic_allocation_bp, "…with its split untouched").toBe(aArmBpBefore);
    expect(aAfter.variants[0]!.frame_overrides_json, "…and no theme override slipped onto it").toBeFalsy();

    // ---- (4) where the operator lands -----------------------------------
    expect(island.navigatedTo(), "the page reopens on the funnel that was A/B'd, not the editor's arm").toBe(
      `/admin/leadgen/quotes/${fx.quotePublicId}/edit?variant=${fx.variantC}`,
    );
    sdb.close();
  });

  // BEHAVIOUR DELTA, stated rather than hidden: pre-fix this same click issued
  // NOTHING even with no target switch — it consulted the A/B tab's
  // "Add variant" badge (server-computed "no-test" for a funnel with no
  // experiment) and refused with "press Create A/B test, then Start…". That
  // badge is the EDITOR funnel's verdict, which is why it could never speak
  // for a targeted funnel; the button now satisfies the precondition the same
  // way its sibling "A/B templates" (quotes-tabs/templates.ts) always has —
  // create + start the funnel's own test, then fork. One flow, both islands.
  it("NO target switch: the button acts on the editor funnel's OWN arm and experiment, and no other funnel", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, fx.variantA, ["typography.display_size"], boardPage(fx), true);
    await island.settle();

    island.abThisTheme(fx.presetId, "25");
    await island.settle();

    const after = await readStructureFunnels(env, fx.quotePublicId);
    const aAfter = funnelOf(after, fx.funnelA);
    const aTest = aAfter.ab_tests.find((t) => t.status === "running");
    expect(aTest, "the editor funnel's own test").toBeDefined();
    const newArm = aAfter.variants.find((v) => v.public_id !== fx.variantA);
    expect(newArm, "the editor funnel gained the arm").toBeDefined();
    expect(newArm!.frame_overrides_json).toEqual({ theme_id: fx.presetId });
    expect(newArm!.traffic_allocation_bp).toBe(2500);
    // …and the funnels nobody targeted are untouched.
    expect(funnelOf(after, fx.funnelC).variants.length, "funnel C gained nothing").toBe(1);
    expect(funnelOf(after, fx.funnelC).ab_tests, "funnel C has no experiment").toEqual([]);
    sdb.close();
  });

  it("CANCELLED prompt: no funnel is touched at all — the split is asked before any request", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, fx.variantA, ["typography.display_size"], boardPage(fx), true);
    await island.settle();
    island.pickThemesFunnel(fx.funnelC);
    await island.settle();

    const callsBefore = island.calls.length;
    island.abThisTheme(fx.presetId, null as unknown as string); // window.prompt -> Cancel
    await island.settle();

    expect(island.calls.length - callsBefore, "a cancelled prompt issues NO request (never an orphan experiment)").toBe(0);
    const after = await readStructureFunnels(env, fx.quotePublicId);
    expect(funnelOf(after, fx.funnelC).ab_tests, "…so the target funnel has no half-created test").toEqual([]);
    expect(funnelOf(after, fx.funnelC).variants.length, "…and no extra arm").toBe(1);
    sdb.close();
  });
});

// ===========================================================================
// P8-1 J1 (contract R6-1, §5 B3 — review #4's BLOCKER F-1) — AN UNREADABLE
// THEME GET MUST NEVER DESTROY THE FUNNEL'S STORED THEME.
//
// Both theme write paths on this page read-before-merge: the rail's autosave
// (quotes-tabs/themes.ts flushThemeEdits) and the one-Save chain
// (quotes-tabs/funnel.ts normalizedThemePut). Neither asked whether the read
// SUCCEEDED — the first had no r.ok test at all, the second collapsed every
// false value to {} — so an unreadable GET read as "this funnel has no theme"
// and the merged PUT replaced everything.
// Driven twice by review #4 against the live fixture (docs/leadgen/r2/evidence/
// p8/review-p8-1d/j3-m2-log.txt, j10-wipe-log.txt):
//   * target switched : P8-Charlie's stored {"palette":{"brand_primary":
//     "success","accent":"#5A2D8C"},"typography":{"display_size":"xl"}} became
//     {"palette":{"brand_secondary":"error"}} after ONE colour click.
//   * no target switch: the same stored theme became exactly
//     {"scales":{"shadow":"high"}} after ONE Shadows -> High select — and this
//     path shows no banner at all, so nothing on screen said a word.
// Same DRIVEN shape as the blocks above: both real islands in one document,
// every fetch through the REAL admin router over a REAL D1 schema, the funnel's
// ACTUAL persisted row read back before and after (E10/E11).
// ===========================================================================

// The live P8-Charlie fixture's own stored shape, so the loss this pins is the
// loss review #4 measured (two roles + a typography key, not a toy object).
const CHARLIE_SHAPED_THEME = { palette: { brand_primary: "success", accent: "#5A2D8C" }, typography: { display_size: "xl" } };

describeDb("P8-1 J1 (contract R6-1) — DRIVEN: an unreadable theme GET writes NOTHING", () => {
  it("NO TARGET SWITCH: the rail autosave AND the Save behind it both refuse, and the stored theme is byte-identical", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    await putFunnelTheme(env, fx.funnelA, CHARLIE_SHAPED_THEME);
    const before = JSON.stringify(await storedTheme(env, fx.funnelA));

    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, fx.variantA, ["typography.display_size", "scales.shadow"], boardPage(fx), true);
    await island.settle();

    island.failThemeGetsFor(fx.funnelA);
    island.editRailControl("scales.shadow", "high");
    await island.settle();

    // FAIL-BEFORE (driven, review #4): PUT /funnels/<A>/theme
    // {"theme_json":{"scales":{"shadow":"high"}}} — the whole stored theme gone.
    expect(island.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`), "the rail writes nothing when it could not read").toEqual([]);
    expect(JSON.stringify(await storedTheme(env, fx.funnelA)), "the stored theme is untouched").toBe(before);
    const railErr = island.pageError();
    expect(railErr.hidden, "the page's error banner is shown").toBe(false);
    expect(railErr.text, "…naming the funnel").toContain("Funnel A");
    expect(railErr.text, "…and saying the change did not save").toContain("NOT saved");

    // The operator's retry — the one-Save chain — is the OTHER read-before-merge.
    island.clickSave();
    await island.settle();
    expect(island.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`), "Save writes nothing either").toEqual([]);
    expect(JSON.stringify(await storedTheme(env, fx.funnelA)), "…and the stored theme is STILL byte-identical").toBe(before);
    expect(island.pageError().text, "the Save chain says the same thing in its own words").toContain("Nothing was saved");
    sdb.close();
  });

  it("TARGET SWITCHED: a colour pick on a funnel whose theme could not be read writes nothing, and the banner says whose values are on screen", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    await putFunnelTheme(env, fx.funnelA, { palette: { brand_primary: "#AB1234" }, typography: { display_size: "l" } });
    await putFunnelTheme(env, fx.funnelC, CHARLIE_SHAPED_THEME);
    const before = JSON.stringify(await storedTheme(env, fx.funnelC));

    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, fx.variantA, ["typography.display_size"], boardPage(fx), true);
    await island.settle();

    island.failThemeGetsFor(fx.funnelC);
    island.pickThemesFunnel(fx.funnelC);
    await island.settle();

    // ---- MAJOR F-3: the disclosure must say WHOSE numbers these are --------
    // FAIL-BEFORE (driven, review #4, j3-m2-failedget-1280.png): the banner read
    // only "Could not load the theme for P8-Charlie — theme read failed. The
    // controls below still show the previous values." while the rail painted
    // Funnel A's #AB1234 under the header "Editing: P8-Charlie".
    const err = island.pageError();
    expect(err.hidden, "the banner is shown").toBe(false);
    expect(err.text, "it names the funnel that could not be read").toContain("Funnel C");
    expect(err.text, "…and the funnel whose values are actually on screen").toContain("Funnel A’s");
    expect(err.text, "…says they are NOT the named funnel's").toContain("NOT Funnel C’s");
    expect(err.text, "…and where an edit made now would land").toContain("saved to Funnel C");
    // MINOR F-7: measured at 375 with the rail on screen — top -186px,
    // inViewport false. A refusal the operator cannot see is not a disclosure.
    expect(err.scrolledIntoView, "the banner is brought into view").toBeGreaterThan(0);

    // ---- BLOCKER F-1: and the next edit destroys nothing -------------------
    island.pickPaletteRole("brand_secondary", "error");
    await island.settle();
    // FAIL-BEFORE (driven): PUT /funnels/<C>/theme
    // {"theme_json":{"palette":{"brand_secondary":"error"}}} — lost keys
    // ["typography"], and the brand_primary/accent pair with them.
    expect(island.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`), "nothing is written").toEqual([]);
    expect(JSON.stringify(await storedTheme(env, fx.funnelC)), "the target funnel's stored theme survives intact").toBe(before);
    expect(island.pageError().text, "and the refusal names the funnel and says it was not saved").toContain("Funnel C");
    expect(island.pageError().text).toContain("NOT saved");
    sdb.close();
  });

  it("BOUNDARY: a funnel with NO stored theme is not 'unreadable' — its very first edit still saves", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    expect(await storedTheme(env, fx.funnelA), "the fixture's funnel A really has no stored theme").toBeNull();

    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, fx.variantA, ["typography.display_size"], boardPage(fx), true);
    await island.settle();

    island.editRailControl("typography.display_size", "xl");
    await island.settle();

    // The fail-closed rule keys on the RESPONSE being unreadable, never on the
    // theme being empty (frame-handlers.ts themeProjection answers
    // {theme: null} for a themeless funnel) — otherwise every funnel's first
    // theme edit would be refused forever.
    expect(island.calls.filter((c) => c.method === "PUT").map((c) => c.url)).toEqual([`${API}/funnels/${fx.funnelA}/theme`]);
    expect(await storedTheme(env, fx.funnelA), "…and it is persisted").toEqual({ typography: { display_size: "xl" } });
    expect(island.pageError().hidden, "no refusal banner on the honest path").toBe(true);
    sdb.close();
  });

  // P8-1 K1 (F-1 residual, review #4's blocker fixed by J1 above on the WRITE
  // side only): syncThemeToTargetFunnel's own `readable` check additionally
  // required `res.body.theme !== null`, so a TARGET SWITCH onto a themeless
  // funnel took the exact same UNREADABLE branch a real failure does — a
  // false "Could not load the theme" banner, AND (since that branch never
  // updates targetThemeState) the rail kept showing the PREVIOUS funnel's
  // stale theme under the new funnel's name.
  it("K1: switching the TARGET to a themeless funnel is not 'unreadable' either — no banner, and the controls repaint A's own inherited values, not funnel C's stale ones", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    expect(await storedTheme(env, fx.funnelA), "the fixture's funnel A really has no stored theme").toBeNull();
    await putFunnelTheme(env, fx.funnelC, { palette: { brand_primary: "#AB1234" }, typography: { display_size: "xl" } });

    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, fx.variantA, ["typography.display_size"], boardPage(fx), true);
    await island.settle();
    // A's OWN inherited rendering, established once at boot, before anything
    // else runs — the self-referential ground truth the round trip below
    // is compared back against (never a hand-picked colour literal).
    expect(island.pageError().hidden, "no banner on first boot").toBe(true);
    expect(island.controlValue("typography.display_size"), "A boots blank -- inherited from the base design").toBe("");
    const aBrandPrimary = island.roleSwatchColor("brand_primary");

    // Switch away to the themed funnel C first -- the precondition this bug
    // needs: a NON-base state already on screen before switching back to A.
    island.pickThemesFunnel(fx.funnelC);
    await island.settle();
    expect(island.controlValue("typography.display_size"), "the switch really did load C's own stored theme").toBe("xl");
    expect(island.roleSwatchColor("brand_primary"), "…and C's own colour, distinct from A's inherited one").not.toBe(aBrandPrimary);

    island.pickThemesFunnel(fx.funnelA);
    await island.settle();
    expect(island.pageError().hidden, "a themeless funnel switch shows NO error banner").toBe(true);
    expect(island.controlValue("typography.display_size"), "the select shows A's own inherited (blank) value, not C's stale xl").toBe("");
    expect(island.roleSwatchColor("brand_primary"), "the swatch repaints A's own inherited colour, not C's stale override").toBe(aBrandPrimary);
    sdb.close();
  });
});

// ===========================================================================
// P8-1 J1 (contract §4 R3, §5 B3 — review #4's MAJOR F-2) — THE §4.5 OVERRIDE
// SWITCH IS NOT OFFERED WHERE IT CANNOT BE HONOURED.
//
// The FIFTH instance of this class on this surface: the writes were re-pointed
// at the target funnel (F5/F6/F7) and the reads were gated to match (H1), but
// the SWITCH itself never asked, so with another funnel targeted it still read
// "Override for this variant" while the edit restyled that whole funnel for
// every visitor. Driven by review #4 at 375 (j8-tpl-f8-log.txt):
// {"header":"P8-Delta","overrideChecked":true,"inheritChecked":false} and then
// PUT /funnels/<Delta>/theme, with the arm's frame_overrides_json untouched.
// All four combinations of {override on, off} x {target = the editor's funnel,
// target = another funnel} are driven below: the VISIBLE state and the WRITE
// must agree in every one.
// ===========================================================================

async function armSessionNoEdits(env: Env, fx: ThreeFunnelFixture): Promise<{ island: SeamHandle; arm: string }> {
  const exp = await json<{ public_id: string }>(await admin.request(`${API}/funnels/${fx.funnelA}/experiments`, jsonInit("POST", {}), env), "create experiment");
  await json(await admin.request(`${API}/experiments/${exp.public_id}/start`, jsonInit("POST"), env), "start experiment");
  const arm = await json<{ public_id: string }>(await admin.request(`${API}/variants/${fx.variantA}/fork`, jsonInit("POST"), env), "fork arm");
  const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit?variant=${arm.public_id}`, {}, env)).text();
  expect(servedPage, "the served page really is on a NON-control arm").toContain('"selected_variant_is_control":false');
  const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, arm.public_id, ["typography.display_size"], boardPage(fx), false);
  await island.settle();
  return { island, arm: arm.public_id };
}

async function armOverridesOf(env: Env, fx: ThreeFunnelFixture, arm: string): Promise<unknown> {
  const structure = await json<{ funnels: Array<{ variants: Array<{ public_id: string; frame_overrides_json: unknown }> }> }>(
    await admin.request(`${API}/quotes/${fx.quotePublicId}/structure`, {}, env),
    "read the arm back",
  );
  const row = structure.funnels.flatMap((f) => f.variants).find((v) => v.public_id === arm);
  expect(row, `the arm ${arm} is on the board`).toBeDefined();
  return row!.frame_overrides_json;
}

const writesOf = (island: SeamHandle, from: number): string[] =>
  island.calls.slice(from).filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url}`);

describeDb("P8-1 J1 (contract §4 R3) — DRIVEN: in all four combinations the override switch's visible state matches where the edit is written", () => {
  it("the switch is offered, ticked and honoured on the editor's own funnel — and neither offered nor honoured off it", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    const { island, arm } = await armSessionNoEdits(env, fx);

    // ---- (1) override OFF, target = the editor's own funnel ---------------
    const s1 = island.overrideSwitch();
    expect(s1.checked, "boots on 'Same as funnel (default)'").toBe("inherit");
    expect(s1.enabled, "…offered").toBe(true);
    expect(s1.noteHidden, "…with no note to make").toBe(true);
    let at = island.calls.length;
    island.pickPaletteRole("brand_primary", "accent");
    await island.settle();
    expect(writesOf(island, at), "an inherit-mode edit goes to the editor funnel's own theme").toEqual([`PUT ${API}/funnels/${fx.funnelA}/theme`]);

    // ---- (2) override ON, target = the editor's own funnel ----------------
    island.setThemeOverride(true);
    const s2 = island.overrideSwitch();
    expect(s2.checked, "the operator's tick sticks where the arm IS reachable").toBe("override");
    expect(s2.enabled).toBe(true);
    expect(s2.noteHidden).toBe(true);
    at = island.calls.length;
    island.pickPaletteRole("brand_secondary", "success");
    await island.settle();
    expect(writesOf(island, at), "an override-mode edit is held for the arm's own PUT — no funnel theme write").toEqual([]);
    island.clickSave();
    await island.settle();
    expect(writesOf(island, at), "…and Save sends it to the ARM").toEqual([`PUT ${API}/variants/${arm}`]);
    expect(await armOverridesOf(env, fx, arm), "the arm really carries the override").toMatchObject({ theme: { palette: { brand_secondary: "success" } } });

    // ---- (3) that same ticked switch, target = ANOTHER funnel -------------
    const armBefore = JSON.stringify(await armOverridesOf(env, fx, arm));
    island.pickThemesFunnel(fx.funnelC);
    await island.settle();
    const s3 = island.overrideSwitch();
    // FAIL-BEFORE (driven, review #4): "override" — ticked, enabled, silent.
    expect(s3.checked, "off-target the switch shows the scope the write really has").toBe("inherit");
    expect(s3.disabled, "…and is not offered at all (contract §4 R3)").toBe(true);
    expect(s3.noteHidden, "…with the reason on screen").toBe(false);
    expect(s3.note, "the note names the funnel the edit reaches").toContain("Funnel C");
    at = island.calls.length;
    island.pickPaletteRole("brand_primary", "success");
    await island.settle();
    expect(writesOf(island, at), "and the write goes exactly where the switch now says").toEqual([`PUT ${API}/funnels/${fx.funnelC}/theme`]);
    expect(JSON.stringify(await armOverridesOf(env, fx, arm)), "the arm is untouched by an off-target edit").toBe(armBefore);

    // ---- (4) trying to tick it off-target ---------------------------------
    island.setThemeOverride(true);
    const s4 = island.overrideSwitch();
    expect(s4.checked, "a change that reaches a disabled control still cannot arm it").toBe("inherit");
    expect(s4.disabled).toBe(true);
    at = island.calls.length;
    island.pickPaletteRole("accent", "brand_primary");
    await island.settle();
    expect(writesOf(island, at), "…so this edit is still the target funnel's").toEqual([`PUT ${API}/funnels/${fx.funnelC}/theme`]);
    expect(JSON.stringify(await armOverridesOf(env, fx, arm)), "…and the arm is still untouched").toBe(armBefore);

    // ---- back on the editor's funnel: the operator's own state returns ----
    island.pickThemesFunnel(fx.funnelA);
    await island.settle();
    const s5 = island.overrideSwitch();
    expect(s5.checked, "the tick the operator set on this funnel is restored, not lost").toBe("override");
    expect(s5.enabled).toBe(true);
    expect(s5.noteHidden).toBe(true);
    sdb.close();
  });

  it("a CONTROL arm renders no switch at all, and the panel still edits the target funnel", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit`, {}, env)).text();
    const island = bootFunnelAndThemesIslands(env, servedPage, fx.funnelA, fx.variantA, ["typography.display_size"], boardPage(fx), true);
    await island.settle();
    // renderOverrideSwitch returns "" for a control arm: no radios, no note —
    // the harness's set is the panel's own, so this is the served truth.
    expect(overrideRadioSpecsFromPanel(renderThemesTabPanel(true)), "a control arm has no §4.5 switch").toEqual([]);
    expect(island.overrideSwitch().checked).toBe("");
    island.pickThemesFunnel(fx.funnelC);
    await island.settle();
    const at = island.calls.length;
    island.pickPaletteRole("brand_primary", "success");
    await island.settle();
    expect(writesOf(island, at), "and the ordinary path still writes the funnel the panel names").toEqual([`PUT ${API}/funnels/${fx.funnelC}/theme`]);
    sdb.close();
  });
});

// ===========================================================================
// P8-1 J1 (contract R6-1 — review #4's MAJOR F-4, WIDENED AGAIN after review
// #5 falsified the first widening) — THE ARM-SCOPED-STATE GUARD.
//
// The H1 guard above closes ONE literal: the string `workingOverrides.theme`,
// in the ONE island containing saveTargetFunnelPublicId, with a gate appearing
// textually earlier in the same function. F-2 lived in the hole beside it: the
// §4.5 radio's own `checked`, which is not workingOverrides at all.
//
// This guard is a NAME SCAN, and the honest way to describe a name scan is by
// the names it closes — review #5's falsification (5 of 6 evasions missed)
// happened because the previous header claimed a universe ("nothing else can")
// that the code did not implement. What follows is the universe it DOES cover,
// rail by rail, with the review-#5 shape each rail now catches:
//
//   RAIL 1 — `workingOverrides`, the arm's sparse frame_overrides_json inside
//     the editor island. It enters ONCE, through the ONE declaration
//     `var workingOverrides = deepClone(lgData.overrides || {});`, and that
//     declaration is now the ONLY island-TOP-LEVEL text allowed to name it:
//     the old blanket `<island>` exemption let any top-level capture through
//     (review #5 E1). Aliasing is banned outright — and the alias regex now
//     matches the property form (`= workingOverrides.theme`), not only the
//     bare-object form — so a scan over every access form (dot, bracket,
//     argument) is complete for this name.
//   RAIL 2 — the SAME state under the two other spellings it travels by:
//     `lgData.overrides`, the SSR blob it is cloned from (review #5 E2: a
//     second read of the blob), and `frame_overrides_json`, the wire field it
//     is fetched and PUT as (review #5 E5: the arm's overrides pulled from
//     GET /variants/<id> and shown ungated). Both are tier 1.
//   RAIL 3 — `overrideMode`, the §4.5 switch's per-group mode: declared
//     exactly once, and the input to the write routers.
//   RAIL 4 — the switch's RENDERED controls: ALL FOUR spellings
//     renderOverrideSwitch (quotes-tabs/shared.ts) really emits —
//     `data-override-switch` (the container: review #5 E4), the radios'
//     `name="lg-ov-<group>"` (review #5 E3, and the product's OWN idiom —
//     themes.ts overrideIsOn() reads `input[name="lg-ov-theme"]:checked`),
//     `data-override-group` and `data-override-note` — plus the two bare
//     prefixes `data-override-` and `lg-override-`, so a selector or class
//     assembled from fragments trips it too. The four spellings are PINNED
//     against shared.ts's real markup below, so a fifth hook added there fails
//     this file instead of slipping past it.
//
// BOTH ISLANDS THAT CAN CARRY ARM SCOPE ARE SCANNED, each with its own site
// list and its own gate vocabulary. Review #5's other finding was that the DOM
// half had only ever run over the editor island; themes.ts, where the rail
// actually lives, was never scanned with it. themes.ts holds exactly one
// rail-4 touch (overrideIsOn()'s selector) and it is listed there by name.
// templates.ts has no §4.5 surface at all (asserted below).
//
// TIER 1 (state whose value can be WRITTEN to a funnel or SHOWN as one):
//   a gate must be asked, USED, and asked BEFORE the touch.
// TIER 2 (the switch's own mode + its rendered controls): a gate must be asked
//   and USED anywhere in the function — no ordering rule, because these are the
//   predicate's own inputs and outputs (`overrideMode[g] === 'override' &&
//   editorArmOwnsTarget()` is one conjunction, not a read before a check).
//
// WHAT THIS GUARD CANNOT SEE — its stated boundary, so no reader mistakes it
// for total coverage:
//   (i)  A SPELLING THAT IS NOT ON THE LIST. If a route later returns the same
//        arm blob under a new field name, or a new island variable comes to
//        hold it, this scan stays silent until that name is added here. It is
//        closed over the names it enumerates, not over the concept. (Two
//        near-misses are NOT holes: attribute/class selectors assembled from
//        fragments are covered by the two prefix tokens, and identifier
//        reflection cannot reach these vars — they are `var`s inside the
//        island's IIFE, so `window['working' + 'Overrides']` finds nothing.)
//   (ii) "USED" IS TEXTUAL, NOT DATAFLOW. `var x = editorArmOwnsTarget();`
//        counts as used even if `x` is then ignored; only a bare
//        `editorArmOwnsTarget();` statement is rejected as a call that guards
//        nothing. Whether the gate's answer actually changes what the operator
//        sees is proven by behaviour, by the DRIVEN four-combination test
//        above — not by this scan.
// Reach is PROVEN, not asserted: the analyzer runs over the REAL served
// islands (expected: zero findings) and then over each of them with every
// evasion injected — the six shapes review #5 walked through included — each
// of which must be reported.
// ===========================================================================

// Offset-preserving blank of COMMENT text only (keepStrings) or of comments AND
// string contents. Both copies index identically to `src`, so a function-span
// map built from one is valid for offsets found in the other: identifiers are
// scanned in the strings-blanked copy (an identifier never lives in a string),
// DOM attribute names in the strings-kept copy (they only ever live in one).
// Regex literals are copied verbatim and skipped as units, so a quote-carrying
// regex (`replace(/"/g, …)` exists in this island) cannot open a phantom string.
function blankNonCode(src: string, keepStrings: boolean): string {
  let out = "";
  let i = 0;
  let lastReal = "";
  while (i < src.length) {
    const ch = src.charAt(i);
    const two = src.slice(i, i + 2);
    if (two === "//") {
      while (i < src.length && src.charAt(i) !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (two === "/*") {
      out += "  ";
      i += 2;
      while (i < src.length && src.slice(i, i + 2) !== "*/") {
        out += src.charAt(i) === "\n" ? "\n" : " ";
        i += 1;
      }
      out += "  ";
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += keepStrings ? ch : " ";
      i += 1;
      while (i < src.length && src.charAt(i) !== quote) {
        const esc = src.charAt(i) === "\\" && i + 1 < src.length;
        const take = src.slice(i, esc ? i + 2 : i + 1);
        out += keepStrings ? take : take.replace(/[^\n]/g, " ");
        i += esc ? 2 : 1;
      }
      if (i < src.length) {
        out += keepStrings ? src.charAt(i) : " ";
        i += 1;
      }
      lastReal = ")";
      continue;
    }
    // a `/` in value position starts a regex literal (never division)
    if (ch === "/" && "(,=:[!&|?{;".includes(lastReal)) {
      let j = i + 1;
      let closed = false;
      while (j < src.length && src.charAt(j) !== "\n") {
        if (src.charAt(j) === "\\") {
          j += 2;
          continue;
        }
        if (src.charAt(j) === "/") {
          closed = true;
          j += 1;
          break;
        }
        j += 1;
      }
      if (closed) {
        out += src.slice(i, j);
        i = j;
        lastReal = ")";
        continue;
      }
    }
    out += ch;
    if (ch.trim() !== "") lastReal = ch;
    i += 1;
  }
  return out;
}

// The editor island's gate vocabulary…
const ARM_GATES = ["themeOverrideActive()", "editorArmOwnsTarget()", "overrideSwitchOfferable()", "writeTargetFor("] as const;
// …and the themes island's, which spells the same question in its own scope
// (it has no editorArmOwnsTarget(); `targetFunnelPublicId() === funnelPublicId`
// IS that predicate there — see queueThemeEdit).
const THEMES_ARM_GATES = ["overrideIsOn()", "targetFunnelPublicId() === funnelPublicId"] as const;

// Offsets in `body` where a gate is not merely CALLED but USED — its value
// feeds a condition, a return or an assignment. A bare `themeOverrideActive();`
// statement is a call that changes nothing and guards nothing.
function usedGateOffsets(body: string, gates: readonly string[]): number[] {
  const out: number[] = [];
  for (const gate of gates) {
    for (let from = 0; ; ) {
      const at = body.indexOf(gate, from);
      if (at === -1) break;
      from = at + 1;
      const before = body.slice(0, at).replace(/\s+$/, "");
      if (/\bfunction$/.test(before)) continue; // the gate's own declaration
      const last = before.slice(-1);
      const lastWord = /([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(before)?.[1] ?? "";
      if ("(!&|=,?:".includes(last) || lastWord === "return") out.push(at);
    }
  }
  return out.sort((a, b) => a - b);
}

interface ArmStateSite {
  fn: string;
  why: string;
  marker?: string;
  gate: "required" | "none";
}

// Every function allowed to touch arm-scoped state, each with its reason.
// NOTE the absence of a `<island>` row: island top level is no longer exempt
// wholesale (review #5 E1). The ONLY top-level text that may name a carrier is
// a declaration listed in EDITOR_ARM_DECLS below.
const ARM_STATE_SITES: ReadonlyArray<ArmStateSite> = [
  { fn: "shownOverridePalette", why: "the ONE colour read: {} unless themeOverrideActive()", gate: "required" },
  { fn: "applyPaletteValue", why: "the palette WRITE: same predicate, same branch", gate: "required" },
  { fn: "clientEffective", why: "the inspector-control read: editorArmOwnsTarget() before the merge", gate: "required" },
  { fn: "writeConfigValue", why: "the frame-vs-override write router (asks writeTargetFor)", gate: "required" },
  { fn: "writeTargetFor", why: "the routing predicate itself", gate: "required" },
  { fn: "themeOverrideActive", why: "the theme predicate itself", gate: "required" },
  { fn: "syncOverrideSwitches", why: "the switch's whole VISIBLE state: overrideSwitchOfferable() first (P8-1 J1 / F-2)", gate: "required" },
  {
    fn: "collectPayload",
    why: "the arm's OWN save payload — it is PUT to /variants/<the editor arm>, the one destination that is that arm by construction",
    gate: "none",
  },
  { fn: "", marker: "data-role-reset", why: "the anonymous role-reset click listener: the reset WRITE, gated by editorArmOwnsTarget()", gate: "required" },
  { fn: "", marker: "data-override-group", why: "the anonymous override-switch change listener: gated by overrideSwitchOfferable()", gate: "required" },
  {
    fn: "",
    marker: "var newVariantId = res.body.public_id;",
    why: "the fork+split tail: it seeds frame_overrides_json on the arm it FORKED two statements earlier — that arm is that arm by construction, like collectPayload",
    gate: "none",
  },
  {
    fn: "",
    marker: "lg-theme-preset-select",
    why: "the preset Apply button: themeOverrideActive() picks variant-override vs funnel BEFORE the frame_overrides_json body is built",
    gate: "required",
  },
];

// The island-TOP-LEVEL statements that may name a carrier — nothing else at
// top level may (review #5 E1). Anchored by exact text: a declaration that no
// longer reads like this is reported, never silently un-anchored.
const EDITOR_ARM_DECLS = [
  "var workingOverrides = deepClone(lgData.overrides || {});",
  "var overrideMode = {};",
] as const;

// The themes island's own site list. It holds exactly ONE arm-scoped touch.
const THEMES_ARM_SITES: ReadonlyArray<ArmStateSite> = [
  {
    fn: "overrideIsOn",
    why: "the §4.5 radio predicate itself — the ONE arm-scoped read in this island; its single call site is proven to ask the target predicate in the same breath by the test below",
    gate: "none",
  },
];

interface ArmUniverse {
  label: string;
  gates: readonly string[];
  sites: ReadonlyArray<ArmStateSite>;
  decls: readonly string[];
}

const TIER1_TOKENS = ["workingOverrides"] as const;
// The same arm state under the two spellings it travels by outside the island
// variable: the SSR blob it is cloned from, and the wire field it is fetched
// and PUT as. Both carry values that can be SHOWN as a funnel's own.
const TIER1_WIRE_TOKENS = ["lgData.overrides", "frame_overrides_json"] as const;
const TIER2_IDENT_TOKENS = ["overrideMode"] as const;
// All four spellings renderOverrideSwitch emits (pinned against its real
// markup below), plus the two bare prefixes, so a selector or class built from
// fragments at run time trips the scan as well.
const TIER2_DOM_TOKENS = [
  "data-override-switch",
  "data-override-group",
  "data-override-note",
  "data-override-",
  "lg-ov-",
  "lg-override-",
] as const;

// Every finding this analyzer can make, as a stable string:
//   alias:<name>            a second name bound to the arm's override object
//   unlisted:<fn>:<token>   a touch in a function that is not in the site list
//   ungated:<fn>:<token>    …in one that never USES a gate
//   order:<fn>:<token>      …tier 1, where the gate is asked after the touch
//   unanchored-declaration:<text>   a declared entry point this file names but
//                           the island no longer spells that way (the anchor
//                           that makes the top-level exemption a SINGLE
//                           statement rather than a blanket)
function armStateFindings(island: string, universe: ArmUniverse): string[] {
  const found: string[] = [];
  const code = blankNonCode(island, false);
  const codeWithStrings = blankNonCode(island, true);
  const spans = functionSpansOf(code);
  const outerStart = spans.length === 0 ? -1 : Math.min(...spans.map((s) => s.start));

  // The ONE-statement top-level exemption, resolved to offsets in the same
  // space every scan below uses. Exactly one occurrence, or it is a finding.
  const declSpans: Array<{ start: number; end: number }> = [];
  for (const decl of universe.decls) {
    const at = code.indexOf(decl);
    if (at === -1 || code.indexOf(decl, at + 1) !== -1) {
      found.push(`unanchored-declaration:${decl}`);
      continue;
    }
    declSpans.push({ start: at, end: at + decl.length });
  }

  // A second NAME for the arm's object, in either capture form: the bare
  // object (`var wo = workingOverrides;`) or a property lifted straight off it
  // (`var stolen = workingOverrides.theme;` — review #5 E1). The trailing
  // lookahead keeps `x === workingOverrides` and `x ? …` comparisons out.
  const aliasRe = /(?:\bvar\s+)?([A-Za-z0-9_$.[\]']+)\s*=(?!=)\s*workingOverrides\s*(?=[;,)\].[]|\|\||&&)/g;
  let am: RegExpExecArray | null = aliasRe.exec(code);
  while (am !== null) {
    if (am[1] !== "workingOverrides") found.push(`alias:${am[1]}`);
    am = aliasRe.exec(code);
  }

  const scan = (haystack: string, token: string, tier: 1 | 2): void => {
    for (let from = 0; ; ) {
      const at = haystack.indexOf(token, from);
      if (at === -1) return;
      from = at + token.length;
      const fn = innermostFunctionAt(spans, at);
      if (fn === null) {
        found.push(`unlisted:<nowhere>:${token}`);
        continue;
      }
      const name = fn.start === outerStart ? "<island>" : fn.name;
      if (name === "<island>") {
        // Island TOP LEVEL: allowed ONLY inside one of the declarations above.
        if (declSpans.some((d) => at >= d.start && at < d.end)) continue;
        found.push(`unlisted:<island>:${token}`);
        continue;
      }
      // The anonymous listeners are told apart by a marker that may live in a
      // STRING (an attribute name), so the marker test reads the strings-kept
      // copy at the same offsets — never the blanked body the gate scan uses.
      const bodyWithStrings = codeWithStrings.slice(fn.start, fn.start + fn.body.length);
      const site = universe.sites.find((s) => s.fn === name && (s.marker === undefined || bodyWithStrings.includes(s.marker)));
      if (site === undefined) found.push(`unlisted:${name === "" ? "<anonymous>" : name}:${token}`);
      if (site !== undefined && site.gate === "none") continue;
      const gates = usedGateOffsets(fn.body, universe.gates).map((g) => g + fn.start);
      if (gates.length === 0) {
        found.push(`ungated:${name === "" ? "<anonymous>" : name}:${token}`);
        continue;
      }
      if (tier === 1 && Math.min(...gates) > at) found.push(`order:${name === "" ? "<anonymous>" : name}:${token}`);
    }
  };

  for (const token of [...TIER1_TOKENS, ...TIER1_WIRE_TOKENS]) scan(code, token, 1);
  for (const token of TIER2_IDENT_TOKENS) scan(code, token, 2);
  for (const token of TIER2_DOM_TOKENS) scan(codeWithStrings, token, 2);
  return [...new Set(found)];
}

const EDITOR_UNIVERSE: ArmUniverse = { label: "the quote-editor island", gates: ARM_GATES, sites: ARM_STATE_SITES, decls: EDITOR_ARM_DECLS };
// themes.ts declares no carrier of its own (asserted below), so NOTHING at its
// top level may name one: its decl list is empty on purpose.
const THEMES_UNIVERSE: ArmUniverse = { label: "the themes island", gates: THEMES_ARM_GATES, sites: THEMES_ARM_SITES, decls: [] };

function themesIslandScript(isControl: boolean): string {
  const html = renderThemesTabPanel(isControl);
  return html.slice(html.lastIndexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));
}

// Each evasion is injected into the REAL served island and must be REPORTED.
// `expected` lists every finding the shape must produce — all of them, not one.
const ARM_STATE_EVASIONS: ReadonlyArray<{ name: string; inject: string; expected: readonly string[] }> = [
  {
    name: "bracket access — invisible to a literal `workingOverrides.theme` scan",
    inject: "\nfunction j1EvasionBracket() { return workingOverrides['theme']; }\n",
    expected: ["unlisted:j1EvasionBracket:workingOverrides"],
  },
  {
    name: "an alias — a second name for the same object",
    inject: "\nfunction j1EvasionAlias() { var wo = workingOverrides; return wo.theme; }\n",
    expected: ["alias:wo"],
  },
  {
    name: "a gate CALLED but ignored",
    inject: "\nfunction j1EvasionIgnored() { themeOverrideActive(); return workingOverrides.theme; }\n",
    expected: ["ungated:j1EvasionIgnored:workingOverrides"],
  },
  {
    name: "the radio's own state — F-2's shape, not workingOverrides at all",
    inject: "\nfunction j1EvasionRadio() { var rs = root.querySelectorAll('[data-override-group]'); rs[0].checked = true; }\n",
    expected: ["unlisted:j1EvasionRadio:data-override-group"],
  },
  {
    name: "the switch's mode map",
    inject: "\nfunction j1EvasionMode() { overrideMode['theme'] = 'override'; }\n",
    expected: ["unlisted:j1EvasionMode:overrideMode"],
  },
  {
    name: "a gated read placed ABOVE its own gate (tier 1 ordering)",
    inject: "\nfunction shownOverridePalette2() { var p = workingOverrides.theme; if (!themeOverrideActive()) { return {}; } return p; }\n",
    expected: ["unlisted:shownOverridePalette2:workingOverrides"],
  },
  // ---- review #5's falsification set (5 of these 6 were MISSED before) -----
  {
    name: "review #5 E1 — an island-TOP-LEVEL capture of the arm palette, then an ungated display read of the capture",
    inject:
      "\nvar j1Stolen = workingOverrides.theme;\nfunction j1ShowStolen() { root.textContent = JSON.stringify(j1Stolen); }\n",
    expected: ["unlisted:<island>:workingOverrides", "alias:j1Stolen"],
  },
  {
    name: "review #5 E2 — a SECOND read of the SSR blob, the same arm state spelled lgData.overrides",
    inject: "\nfunction j1EvasionBlob() { return deepClone(lgData.overrides || {}); }\n",
    expected: ["unlisted:j1EvasionBlob:lgData.overrides", "ungated:j1EvasionBlob:lgData.overrides"],
  },
  {
    name: "review #5 E3 — the radio's checked state read by name=, the product's OWN idiom (themes.ts overrideIsOn())",
    inject:
      "\nfunction j1EvasionChecked() { var el = root.querySelector('input[name=\"lg-ov-theme\"]:checked'); return !!(el && el.value === 'override'); }\n",
    expected: ["unlisted:j1EvasionChecked:lg-ov-"],
  },
  {
    name: "review #5 E4 — the switch CONTAINER attribute, data-override-switch",
    inject: "\nfunction j1EvasionBox() { var b = root.querySelector('[data-override-switch]'); if (b) { b.className = 'lg-override-switch'; } }\n",
    expected: ["unlisted:j1EvasionBox:data-override-switch", "unlisted:j1EvasionBox:data-override-", "unlisted:j1EvasionBox:lg-override-"],
  },
  {
    name: "review #5 E5 — arm state FETCHED from /variants/<id> and displayed ungated",
    inject:
      "\nfunction j1EvasionFetch() { return fetch('/api/admin/leadgen/variants/' + encodeURIComponent(variantPublicId)).then(function (r) { return r.json(); }).then(j1PaintArm); }\nfunction j1PaintArm(j) { root.textContent = JSON.stringify(j.frame_overrides_json); }\n",
    expected: ["unlisted:j1PaintArm:frame_overrides_json", "ungated:j1PaintArm:frame_overrides_json"],
  },
  {
    name: "review #5 E6 (the control it DID catch) — the same read named workingOverrides inside a new function",
    inject: "\nfunction j1Control() { return workingOverrides.theme; }\n",
    expected: ["unlisted:j1Control:workingOverrides", "ungated:j1Control:workingOverrides"],
  },
  // A selector assembled from fragments — the shape the two prefix tokens exist
  // for, and the one themes.ts's own comment warns authors away from.
  {
    name: "an attribute selector concatenated at run time, so no full spelling appears",
    inject: "\nfunction j1EvasionConcat() { var g = 'group'; return root.querySelectorAll('[data-override-' + g + ']'); }\n",
    expected: ["unlisted:j1EvasionConcat:data-override-"],
  },
];

// The same analyzer, run over the OTHER island that carries a §4.5 surface.
const THEMES_ARM_EVASIONS: ReadonlyArray<{ name: string; inject: string; expected: readonly string[] }> = [
  {
    name: "review #5's DOM-scan gap — the radio read lifted into a second themes-island function",
    inject:
      "\nfunction j1ThemesSteal() { var el = document.querySelector('input[name=\"lg-ov-theme\"]:checked'); return !!(el && el.value === 'override'); }\n",
    expected: ["unlisted:j1ThemesSteal:lg-ov-", "ungated:j1ThemesSteal:lg-ov-"],
  },
  {
    name: "the switch container, reached from the themes island",
    inject: "\nfunction j1ThemesBox() { return document.querySelector('[data-override-switch]'); }\n",
    expected: ["unlisted:j1ThemesBox:data-override-switch", "unlisted:j1ThemesBox:data-override-"],
  },
  {
    name: "a copy of the arm's wire field, read in the themes island",
    inject: "\nfunction j1ThemesWire(res) { return res.body.frame_overrides_json; }\n",
    expected: ["unlisted:j1ThemesWire:frame_overrides_json", "ungated:j1ThemesWire:frame_overrides_json"],
  },
  {
    // The themes island is a CLOSED IIFE, so text appended to it sits outside
    // every function body — reported as <nowhere>, which is a finding too:
    // this island declares no carrier at all, so no top-level text may name one.
    name: "a carrier parked at the themes island's top level, where it declares none",
    inject: "\nvar j1ThemesCarrier = overrideMode;\n",
    expected: ["unlisted:<nowhere>:overrideMode"],
  },
];

describe("P8-1 J1 (contract R6-1) — the arm-scoped-state guard covers its whole universe", () => {
  const editorIsland = (): string => {
    const found = topLevelIslands(QUOTE_EDITOR_SCRIPT).find((s) => s.includes("function saveTargetFunnelPublicId("));
    expect(found, "the editor island").toBeDefined();
    return found!;
  };

  it("the REAL served islands report nothing: every touch of arm-scoped state is listed and gated", () => {
    expect(armStateFindings(editorIsland(), EDITOR_UNIVERSE), "unlisted/ungated/mis-ordered touches of the arm's override state").toEqual([]);
    // The island review #5 found the DOM half had never been pointed at.
    expect(armStateFindings(themesIslandScript(false), THEMES_UNIVERSE), "…and the same analyzer over the themes island").toEqual([]);
    // …and the analyzer really did look at something: the sites it cleared.
    const code = blankNonCode(editorIsland(), false);
    expect(code.split("workingOverrides").length - 1, "workingOverrides touches examined").toBeGreaterThanOrEqual(10);
    expect(code.split("overrideMode").length - 1, "overrideMode touches examined").toBeGreaterThanOrEqual(6);
    expect(code.split("frame_overrides_json").length - 1, "frame_overrides_json touches examined").toBeGreaterThanOrEqual(3);
    const themesWithStrings = blankNonCode(themesIslandScript(false), true);
    expect(themesWithStrings.split("lg-ov-").length - 1, "the themes island's own §4.5 DOM read, examined").toBeGreaterThanOrEqual(1);
  });

  it("the DOM token set IS what renderOverrideSwitch emits — every spelling, pinned against the real markup", () => {
    const markup = renderOverrideSwitch("theme", false);
    const dataAttrs = [...new Set([...markup.matchAll(/\s(data-[a-z-]+)\s*=/g)].map((m) => m[1] ?? ""))].sort();
    expect(dataAttrs, "the data-* hooks the §4.5 switch really emits (a NEW one must be added to TIER2_DOM_TOKENS)").toEqual([
      "data-override-group",
      "data-override-note",
      "data-override-switch",
    ]);
    const names = [...new Set([...markup.matchAll(/\sname\s*=\s*"([^"]*)"/g)].map((m) => m[1] ?? ""))];
    expect(names, "the radios' group name — the spelling themes.ts's overrideIsOn() queries by").toEqual(["lg-ov-theme"]);
    const classes = [...new Set([...markup.matchAll(/\sclass\s*=\s*"([^"]*)"/g)].flatMap((m) => (m[1] ?? "").split(/\s+/)))].filter((c) =>
      c.startsWith("lg-override-"),
    );
    expect(classes.sort(), "its class hooks").toEqual(["lg-override-note", "lg-override-switch"]);
    for (const spelling of [...dataAttrs, ...names, ...classes]) {
      expect(
        TIER2_DOM_TOKENS.some((t) => spelling.startsWith(t)),
        `renderOverrideSwitch emits '${spelling}' — the analyzer must scan for it`,
      ).toBe(true);
    }
    // A control arm is offered no switch at all, so there is nothing to scan.
    expect(renderOverrideSwitch("theme", true), "a control arm renders no §4.5 switch").toBe("");
  });

  it("the universe is closed: ONE declaration of each carrier, and no other served island names them", () => {
    expect(countMatches(QUOTE_EDITOR_SCRIPT, /\bvar\s+workingOverrides\s*=/g), "workingOverrides is declared exactly once").toBe(1);
    expect(countMatches(QUOTE_EDITOR_SCRIPT, /\bvar\s+overrideMode\s*=/g), "overrideMode is declared exactly once").toBe(1);
    expect(QUOTE_EDITOR_SCRIPT).toContain("var workingOverrides = deepClone(lgData.overrides || {});");
    // The other two islands on the same page: no copy of the arm's state.
    for (const [label, island] of [
      ["themes.ts", themesIslandScript(false)],
      ["templates.ts", renderTemplatesTabPanel(true, [])],
    ] as const) {
      for (const token of [...TIER1_TOKENS, ...TIER2_IDENT_TOKENS]) {
        expect(island.includes(token), `${label} must not carry its own copy of ${token}`).toBe(false);
      }
      // The SSR blob and the wire field: no CODE in either island names them
      // (themes.ts mentions frame_overrides_json in one comment, which carries
      // no state — the analyzer blanks comments before it scans, so this
      // assertion reads the same blanked copy it does).
      const islandCode = blankNonCode(island, false);
      for (const token of TIER1_WIRE_TOKENS) {
        expect(islandCode.includes(token), `${label} must not read ${token} itself`).toBe(false);
      }
    }
    // templates.ts has no §4.5 surface at all.
    for (const token of TIER2_DOM_TOKENS) {
      expect(renderTemplatesTabPanel(true, []).includes(token), `templates.ts must not touch ${token}`).toBe(false);
    }
  });

  it("the ONE arm-scoped read in the themes island asks the target predicate in the same breath", () => {
    const themes = blankNonCode(themesIslandScript(false), true);
    const callSites: string[] = [];
    for (let from = 0; ; ) {
      const at = themes.indexOf("overrideIsOn()", from);
      if (at === -1) break;
      from = at + 1;
      if (/\bfunction\s*$/.test(themes.slice(0, at))) continue;
      const start = Math.max(themes.lastIndexOf(";", at), themes.lastIndexOf("{", at));
      callSites.push(themes.slice(start + 1, themes.indexOf("{", at) === -1 ? at + 40 : themes.indexOf("{", at)));
    }
    expect(callSites.length, "the themes island asks it exactly once (queueThemeEdit)").toBe(1);
    for (const site of callSites) {
      expect(site, "an arm-scoped read there is only meaningful while the panel is on the editor's own funnel").toContain(
        "targetFunnelPublicId() === funnelPublicId",
      );
    }
  });

  for (const evasion of ARM_STATE_EVASIONS) {
    it(`EDITOR island catches ${evasion.name}`, () => {
      const findings = armStateFindings(editorIsland() + evasion.inject, EDITOR_UNIVERSE);
      for (const want of evasion.expected) {
        expect(findings, `the widened guard must report this evasion (got: ${findings.join(" | ") || "nothing"})`).toContain(want);
      }
    });
  }

  for (const evasion of THEMES_ARM_EVASIONS) {
    it(`THEMES island catches ${evasion.name}`, () => {
      const findings = armStateFindings(themesIslandScript(false) + evasion.inject, THEMES_UNIVERSE);
      for (const want of evasion.expected) {
        expect(findings, `the themes-island scan must report this evasion (got: ${findings.join(" | ") || "nothing"})`).toContain(want);
      }
    });
  }

  it("the top-level exemption is ANCHORED: rename the declaration and the guard says so rather than going quiet", () => {
    const broken = editorIsland().replace("var workingOverrides = deepClone(lgData.overrides || {});", "var workingOverrides = deepClone(lgData.overrides);");
    const findings = armStateFindings(broken, EDITOR_UNIVERSE);
    expect(findings, "a moved/reworded entry point must surface as a finding").toContain(
      "unanchored-declaration:var workingOverrides = deepClone(lgData.overrides || {});",
    );
  });
});

describeDb("P8-1 K1 (F-13 resolved) — the override badge stays gone: dead code removed, no served page grows the id", () => {
  it("MEASURED on the REAL served editor page: #lg-override-badge stays absent now that updateOverrideBadge() is removed", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThreeFunnelBoard(env);
    const exp = await json<{ public_id: string }>(await admin.request(`${API}/funnels/${fx.funnelA}/experiments`, jsonInit("POST", {}), env), "create experiment");
    await json(await admin.request(`${API}/experiments/${exp.public_id}/start`, jsonInit("POST"), env), "start experiment");
    const arm = await json<{ public_id: string }>(await admin.request(`${API}/variants/${fx.variantA}/fork`, jsonInit("POST"), env), "fork arm");
    const servedPage = await (await admin.request(`/admin/leadgen/quotes/${fx.quotePublicId}/edit?variant=${arm.public_id}`, {}, env)).text();

    // The arm page that WOULD show it (a non-control arm, the only page whose
    // §4.5 switches exist at all) still has no badge shell — retired with the
    // §8.2/§10 canvas (test/leadgen-quote-builder-ui.test.ts pins its absence)
    // and, since P8-1 K1, the dead updateOverrideBadge() function itself is
    // gone from quotes-tabs/funnel.ts too — this stays as the regression
    // guard against either ever coming back.
    expect(servedPage, "the served page really is on a NON-control arm").toContain('"selected_variant_is_control":false');
    expect(servedPage.includes('data-override-switch="theme"'), "…whose §4.5 switch IS rendered").toBe(true);
    expect(servedPage.includes('id="lg-override-badge"'), "…and whose override badge is not").toBe(false);
    expect(servedPage.includes('id="lg-override-badge-list"'), "…nor its list").toBe(false);
    sdb.close();
  });
});
