// LeadGen Phase 4 Slice D1 — the Section STUDIO editor core (fix-contract
// v2.4 08 §8.1/§8.3/§8.4/§8.6) over the REAL admin router + REAL migrations
// (the leadgen-sections-ui.test.ts harness). SSR: the five §8.1 regions, the
// §8.3 library (preset-rendered thumbnails — proof they are NOT hand-drawn),
// the §8.6 inspector tabs with §8.5 enum dropdowns, the bootstrap blobs, and
// the ES5 parse gate. EXECUTED (vm-probe): the island's model functions are
// sliced from the SERVED page and run for real — add/drop-into-container/
// depth refusal/breadcrumb/reorder/duplicate/delete/group-into-container/
// bulk paste/typed conditionals/container props — with validateSectionContent
// (the REAL server validator) asserting the mutated model stays valid, plus
// the canvas re-render and the save PATCH body executed against the live
// router (client-vs-server seam). NOTE on the canvas-region stub: the island
// injects ONLY our own preview-endpoint output (server-rendered presets that
// escapeHtml every author value) — the stub here is a plain object, no DOM.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { COMPONENT_CATALOG, type ComponentType } from "../src/public/leadgen/components/registry";
import { validateSectionContent, flattenComponents } from "../src/public/leadgen/components/content-schema";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { STUDIO_LIBRARY_GROUPS } from "../src/admin/leadgen/ui-section-studio";
// D2 seam imports: the island's live mapping decode must agree with the REAL
// server rebuild; the events document's config must be the REAL projection and
// its inline script must be the BYTE-IDENTICAL generated runtime bundle.
import { rebuildDerivedIndexes, type OfferSchemaInfo } from "../src/leadgen/sections";
import { toPublicComponent } from "../src/public/leadgen/config-dto";
import { LEADGEN_RUNTIME_JS } from "../src/public/leadgen/runtime/engine-bundle.generated";
// §8.8 seam imports: the preset renderer must serialize props.maps VERBATIM
// into data-lg-maps. The runtime-reader cross-check (parseMapsConfig over the
// SAME emission literals — MAPS_EMITTED_*) lives in
// test/leadgen-runtime-hydration.test.ts ("§8.8 studio emissions"): that file
// belongs to the DOM-lib runtime typecheck program (tsconfig.runtime.json);
// importing runtime/maps.ts HERE would drag DOM types into the worker
// program. Same suite-pairing the M5 progress-bar regressions use.
import { renderComponent } from "../src/public/leadgen/components/presets";
// wave-2 seam: equivalentFrameGroup output must pass the REAL frame PUT gate.
import { validateFrameConfig } from "../src/public/leadgen/designs/frames";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

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
      if (typeof getBuiltin === "function") {
        return (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
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
  return db;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  // wave 2: the §5.4 move-to-frame PUT and the §5.3 frame_context preview
  // read/write the 0040/0041 funnel frame/theme columns.
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(sdb, "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);");
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
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
  };
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

const YESNO_CONTENT = {
  components: [
    { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
  ],
};

interface SectionDetail { id: number; public_id: string; [k: string]: unknown }

async function createSection(env: Env, overrides: Record<string, unknown> = {}): Promise<SectionDetail> {
  const res = await admin.request(
    `${API}/sections`,
    jsonInit("POST", {
      section_name: "Are you insured?",
      activity: "quote_funnel",
      vertical: "life",
      headline_text: "Are you insured?",
      content_json: JSON.stringify(YESNO_CONTENT),
      ...overrides,
    }),
    env,
  );
  expect(res.status, `create section: ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as SectionDetail;
}

async function getHtml(env: Env, path: string, expectedStatus = 200): Promise<string> {
  const res = await admin.request(path, {}, env);
  expect(res.status, `${path} status`).toBe(expectedStatus);
  return res.text();
}

function extractJsonBlob(html: string, id: string): Record<string, unknown> {
  const marker = `id="${id}">`;
  const start = html.indexOf(marker);
  expect(start, `blob ${id} present`).toBeGreaterThan(-1);
  const from = start + marker.length;
  const end = html.indexOf("</script>", from);
  const raw = html.slice(from, end).split("\\u003c").join("<");
  return JSON.parse(raw) as Record<string, unknown>;
}

const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function extractScripts(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    if ((match[0] ?? "").includes('type="application/json"')) continue;
    blocks.push(match[1] ?? "");
  }
  return blocks;
}

async function studioPage(env: Env, publicId: string): Promise<string> {
  return getHtml(env, `/admin/leadgen/sections/${publicId}/edit`);
}

function studioIsland(html: string): string {
  const island = extractScripts(html).find((s) => s.includes("function renderCanvasNow("));
  expect(island, "studio island present").toBeDefined();
  return island!;
}

const ALL_TYPES = Object.keys(COMPONENT_CATALOG) as ComponentType[];

// ---------------------------------------------------------------------------
// §8.1 SSR — the five studio regions with their hooks
// ---------------------------------------------------------------------------

describeDb("section studio SSR — §8.1 layout regions", () => {
  it("renders top bar, library rail, canvas, inspector and bottom drawer with their hooks", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);

    // 1) top bar: name inline edit · status pill · Activity/Vertical (D2 seam
    // hooks) · mapping badge placeholder · validation chip · Save · Archive
    expect(html).toContain("data-studio-topbar");
    expect(html).toContain('id="lg-section-name"');
    expect(html).toContain('<span class="badge badge-published">active</span>');
    expect(html).toContain("data-studio-activity");
    expect(html).toContain("data-studio-vertical");
    expect(html).toContain("data-studio-mapping-badge");
    expect(html).toContain("data-studio-validation-chip");
    expect(html).toContain('id="lg-section-save"');
    expect(html).toContain('id="lg-section-archive"');
    // the settings strip keeps the remaining save-path scalar fields
    expect(html).toContain("data-studio-settings");
    expect(html).toContain('id="lg-section-headline"');
    expect(html).toContain('id="lg-section-subheadline"');
    expect(html).toContain('name="continue_mode" value="button"');
    expect(html).toContain('id="lg-address-validation"');

    // 2) left rail: searchable library
    expect(html).toContain("data-studio-library");
    expect(html).toContain("data-studio-library-search");

    // 3) center: canvas + breadcrumb + selection toolbar + refusal note
    expect(html).toContain("data-studio-canvas");
    expect(html).toContain('id="lg-studio-canvas-render"');
    expect(html).toContain("data-studio-breadcrumb");
    expect(html).toContain("data-studio-selection-toolbar");
    expect(html).toContain("data-studio-drop-refusal");
    for (const act of ["move-up", "move-down", "add-before", "add-after", "duplicate", "delete", "group-stack", "group-cardpanel"]) {
      expect(html, `toolbar action ${act}`).toContain(`data-studio-act="${act}"`);
    }

    // 4) right: tabbed inspector
    expect(html).toContain("data-studio-inspector");

    // 5) bottom drawer: Offer mapping (D2 placeholder) · Validation · Preview
    expect(html).toContain("data-studio-drawer");
    for (const tab of ["mapping", "validation", "preview"]) {
      expect(html, `drawer tab ${tab}`).toContain(`data-studio-drawer-tab="${tab}"`);
      expect(html, `drawer panel ${tab}`).toContain(`data-studio-drawer-panel="${tab}"`);
    }
    expect(html).toContain("data-studio-tab-mapping"); // D2 mapping seam
    expect(html).toContain("data-studio-validation-list");
    expect(html).toContain("data-studio-events-panel"); // D2 events seam
    expect(html).toContain('id="lg-preview-frame"'); // slice-C preview mounted
  });

  it("the validation chip carries the server-computed issue count (0 for a valid section AND for /new — §5.2 seeds bound nodes)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toContain('data-issue-count="0"');
    // §5.2: /new seeds bound QuestionHeadline + Subheadline as nodes 1–2 —
    // components are non-empty and validator-CLEAN (bound nodes waive text),
    // so the chip is 0 and the canvas empty-state is hidden.
    const fresh = await getHtml(env, "/admin/leadgen/sections/new");
    expect(fresh).toContain('data-issue-count="0"');
    expect(fresh).toMatch(/data-studio-canvas-empty[^>]*hidden/);
    expect(html).toMatch(/data-studio-canvas-empty[^>]*hidden/);
  });

  it("SSR canvas renders the section tree via the REAL preset renderer inside the scoped chrome CSS", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const start = html.indexOf('id="lg-studio-canvas-render"');
    const end = html.indexOf("data-studio-canvas-empty", start);
    const region = html.slice(start, end);
    // scoped chrome css + the preview-parity wrapper + the REAL preset markup
    expect(region).toContain("<style>");
    expect(region).toContain('data-funnel-design="default-funnel"');
    expect(region).toContain("lg-preview-desktop");
    expect(region).toContain('data-component-type="TwoButtonYesNo"');
    expect(region).toContain('data-question-id="q1"');
  });
});

// ---------------------------------------------------------------------------
// §8.3 SSR — component library: grouping, lockstep, preset thumbnails
// ---------------------------------------------------------------------------

function libraryItemBlock(html: string, type: string): string {
  const start = html.indexOf(`data-add-component="${type}"`);
  expect(start, `library item ${type}`).toBeGreaterThan(-1);
  // the item block ends where the NEXT library item (or the group close) starts
  const next = html.indexOf("data-add-component=", start + 10);
  return html.slice(start, next === -1 ? start + 6000 : next);
}

describeDb("section studio SSR — §8.3 component library", () => {
  it("§8.3 six intent-first groups; palette = the catalog's unit∪both types exactly once; frame types NEVER placeable (lockstep), searchable", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);

    // the EXACT six groups of the §8.3 table (last group renders "Navigation"
    // — the table's "Slide navigation" heading loses "slide" per C6, which
    // forbids the word anywhere in the Section Builder)
    const expectedGroups: ReadonlyArray<[string, string]> = [
      ["question-copy", "Question copy"],
      ["choices", "Answer choices"],
      ["inputs", "Inputs"],
      ["layout", "Inside-card layout"],
      ["trust", "Trust &amp; help — inside this question unit"],
      ["navigation", "Navigation"],
    ];
    expect(STUDIO_LIBRARY_GROUPS.map((g) => g.key)).toEqual(expectedGroups.map(([k]) => k));
    for (const [key, label] of expectedGroups) {
      expect(html, `library group ${key}`).toContain(`data-library-group="${key}"`);
      expect(html, `group label ${label}`).toContain(label);
    }
    // §8.2 D5 lockstep: the palette is EXACTLY the catalog's unit ∪ both set…
    const unitOrBoth = ALL_TYPES.filter((t) => COMPONENT_CATALOG[t].scope !== "frame");
    const frameTypes = ALL_TYPES.filter((t) => COMPONENT_CATALOG[t].scope === "frame");
    expect(frameTypes.length).toBeGreaterThanOrEqual(8); // the §8.2 frame row
    const grouped = STUDIO_LIBRARY_GROUPS.flatMap((g) => [...g.types]);
    expect([...grouped].sort()).toEqual([...unitOrBoth].sort());
    // …each placeable exactly once on the SERVED page…
    for (const type of unitOrBoth) {
      const hits = html.split(`data-add-component="${type}"`).length - 1;
      expect(hits, `${type} placed exactly once`).toBe(1);
    }
    // …and every frame-scope type is GONE from the palette (§8.2 "Removed").
    for (const type of frameTypes) {
      expect(html, `${type} not placeable`).not.toContain(`data-add-component="${type}"`);
    }
    expect(html).toContain("data-studio-library-search");
  });

  it("§8.3 exact item display names ride the palette (verbatim table names + 'use when' descriptions)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // display names from the §8.3 table (spot set across all six groups)
    for (const name of [
      "Category label",
      "Question headline",
      "Simple answer buttons",
      "Yes / No",
      "Icon answer cards",
      "Image answer cards",
      "Multi-select cards",
      "Main + “Other” choices",
      "Amount ($)",
      "Amount slider",
      "Question card",
      "Answer grid",
      "Two columns",
      "Reassurance badge",
      "Secure-form badge",
      "Trust points",
      "Logo row",
      "Error message slot",
      "Continue button",
      "Auto-advance",
    ]) {
      // none of these names carries an HTML-escaped ASCII char — the served
      // bytes match the table names directly (typographic quotes unescaped)
      expect(html, `item name ${name}`).toContain(name);
    }
    // the table's quoted one-line descriptions, verbatim
    expect(html).toContain("One-tap answer choices.");
    expect(html).toContain("Use when each answer has an icon.");
    expect(html).toContain("Use when each answer has a logo or photo.");
    expect(html).toContain("Reassurance line inside this question unit.");
  });

  it("§8.3 the dismissible Quote-Builder callout + the C7 trust scope note render with their exact copy", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // the callout replaces the old Layout group's frame items
    expect(html).toContain("data-studio-frame-callout");
    expect(html).toContain("Looking for the page header, footer, progress bar or background? Those live in the <strong>Quote Builder</strong>");
    expect(html).toMatch(/data-studio-callout-open[^>]*>Open</);
    expect(html).toMatch(/<a href="\/admin\/leadgen\/quotes"[^>]*data-studio-callout-open/);
    expect(html).toContain("data-studio-callout-dismiss");
    // the island persists the dismissal (localStorage key)
    const island = studioIsland(html);
    expect(island).toContain("lg-studio-frame-callout-dismissed");
    // C7: the Trust & help scope note, verbatim
    expect(html).toContain("data-trust-scope-note");
    expect(html).toContain(
      "These travel with this Section, inside the question unit. Funnel-wide trust strips, logo rows and the legal footer are configured in the Quote Builder.",
    );
  });

  it("library items are role=button DIVS — preset thumbnails contain real <button>/<input> markup and nested interactive content inside a <button> is invalid HTML that shatters the page tree (D2 browser-exposure regression)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // the wrapper is a div[role=button][tabindex] — click + drag + keyboard
    expect(html).toMatch(/<div class="studio-library-item" role="button" tabindex="0" draggable="true" data-add-component=/);
    // NEVER a <button> wrapper (the exact markup class that broke the layout)
    expect(html).not.toMatch(/<button[^>]*data-add-component=/);
    // the island keeps the keyboard-activation contract for the divs
    const island = studioIsland(html);
    expect(island).toContain("ev.key !== 'Enter' && ev.key !== ' '");
  });

  it("every item shows a thumbnail rendered FROM THE COMPONENT'S OWN PRESET (3+ representative proofs), name, description, answer type + maps badge", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);

    // representative proof the thumb contains the preset's own markup — the
    // data-component-type hydration attribute only the REAL renderComponent
    // emits (never hand-drawn SVG): a question, a grid, and a container.
    for (const type of ["TwoButtonYesNo", "IconCardAnswerGrid", "CardPanel", "RangeQuestion"]) {
      const block = libraryItemBlock(html, type);
      expect(block, `${type} thumb is preset-rendered`).toContain(`data-component-type="${type}"`);
      expect(block, `${type} has a scaled thumb`).toContain("studio-thumb-scale");
    }
    // every placeable item carries a thumb (§8.2: placeable = unit ∪ both —
    // frame types left the palette)
    const placeable = ALL_TYPES.filter((t) => COMPONENT_CATALOG[t].scope !== "frame");
    const thumbs = html.split("studio-thumb-scale").length - 1;
    expect(thumbs).toBeGreaterThanOrEqual(placeable.length);
    // copy + metadata per §8.3 (v2.5 table display name)
    expect(html).toContain("Yes / No");
    expect(html).toContain("Yes / No pair storing a boolean answer.");
    const yesno = libraryItemBlock(html, "TwoButtonYesNo");
    expect(yesno).toContain('class="studio-item-type">boolean<');
    expect(yesno).toContain("maps to Offer fields");
    // affordances produce no answer → no maps badge
    const badge = libraryItemBlock(html, "ReassuranceBadge");
    expect(badge).not.toContain("maps to Offer fields");
  });
});

// ---------------------------------------------------------------------------
// §8.6 + §8.5 SSR — inspector tabs, container enum dropdowns, design tokens
// ---------------------------------------------------------------------------

function selectBlock(html: string, selectId: string): string {
  const start = html.indexOf(`<select id="${selectId}"`);
  expect(start, `select ${selectId}`).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</select>", start));
}

describeDb("section studio SSR — §8.6 inspector + §8.5 container props", () => {
  it("renders the per-selection tab set with panels (question vs container vs affordance gating is island-side; all panels SSR once)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    for (const tab of ["content", "choices", "layout", "design", "validation", "dependencies", "mapping", "advanced"]) {
      expect(html).toContain(`data-studio-inspector-tab="${tab}"`);
      expect(html).toContain(`data-studio-panel="${tab}"`);
    }
    // §8.6 Content: per-family display-copy controls (union, island-gated)
    for (const key of ["text", "placeholder", "yesLabel", "noLabel", "heading", "message", "minLabel", "maxLabel", "loadingLabel"]) {
      expect(html, `content control ${key}`).toContain(`data-content-prop="${key}"`);
    }
    // §8.6 Validation: required + rules + §6.5 pattern presets + error text
    expect(html).toContain('data-inspector-field="required"');
    for (const key of ["min", "max", "step", "maxLen"]) expect(html).toContain(`data-vprop="${key}"`);
    const pattern = selectBlock(html, "lg-vprop-pattern");
    for (const preset of ["none", "letters", "digits", "custom"]) expect(pattern).toContain(`<option value="${preset}">`);
    expect(html).toContain('data-inspector-vprop="error_text"');
    // §8.6 Dependencies: typed IF builder (ops + typed value inputs)
    for (const op of ["eq", "neq", "gt", "lt", "gte", "lte", "range", "in", "not_in"]) {
      expect(html, `op ${op}`).toContain(`<option value="${op}">`);
    }
    for (const part of ["when", "op", "value", "value-bool", "value-enum", "from", "to", "values"]) {
      expect(html, `cond input ${part}`).toContain(`data-inspector-cond="${part}"`);
    }
    // §8.6 Advanced: internal_field rename warning + question_key + raw JSON
    expect(html).toContain("data-studio-rename-warning");
    expect(html).toContain('data-inspector-field="question_key"');
    expect(html).toContain("data-studio-node-json");
    expect(html).toContain("data-studio-debug-id");
  });

  it("§8.5 container prop controls are dropdowns of EXACTLY the schema enum values", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);

    for (const type of ["Stack", "GridContainer", "Columns", "CardPanel", "BackgroundPanel", "Spacer", "HeaderBar", "FooterBar"]) {
      expect(html, `container group ${type}`).toContain(`data-container-group="${type}"`);
    }
    const direction = selectBlock(html, "lg-container-Stack-direction");
    expect(direction).toContain('<option value="vertical">');
    expect(direction).toContain('<option value="horizontal">');
    expect(direction.split("<option").length - 1).toBe(3); // default + 2 enums
    const shadow = selectBlock(html, "lg-container-CardPanel-shadow");
    for (const v of ["none", "sm", "md", "lg", "xl"]) expect(shadow).toContain(`<option value="${v}">`);
    const cols = selectBlock(html, "lg-container-GridContainer-columnsDesktop");
    for (const v of ["2", "3", "4", "5"]) expect(cols).toContain(`<option value="${v}">`);
    expect(cols).not.toContain('<option value="1">');
    expect(cols).not.toContain('<option value="6">');
    const ratio = selectBlock(html, "lg-container-Columns-ratio");
    for (const v of ["50/50", "60/40", "40/60", "70/30"]) expect(ratio).toContain(`<option value="${v}">`);
    const size = selectBlock(html, "lg-container-Spacer-size");
    for (const v of ["xs", "s", "m", "l", "xl"]) expect(size).toContain(`<option value="${v}">`);
    const gradient = selectBlock(html, "lg-container-BackgroundPanel-gradient");
    for (const v of ["primary", "accent", "wash"]) expect(gradient).toContain(`<option value="${v}">`);
    // HeaderBar structured slots (§8.5): toggles + cta inputs
    expect(html).toContain(`data-container-prop="back"`);
    expect(html).toContain(`data-container-prop="secure"`);
    expect(html).toContain(`data-container-cta="label"`);
    expect(html).toContain(`data-container-cta="tel"`);
  });

  it("§8.6 Design tab: curated token DROPDOWNS sourced from the design's slots — no free-CSS input anywhere (§9.4: color keys are ROLE swatch rows)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    for (const key of ["iconColor", "columns", "featureColor", "rangeColor", "buttonBackground", "buttonText", "gridGap", "mobileBehavior"]) {
      expect(html).toContain(`<select id="lg-inspector-${key}"`);
    }
    // the override controls are selects ONLY (no <input data-inspector-override)
    expect(html).not.toMatch(/<input[^>]*data-inspector-override/);
    // §9.4 (wave 2): COLOR-typed option VALUES are the 14 §9.1 ROLE NAMES —
    // picking writes the role, never hex; NO hex option values remain.
    const icon = selectBlock(html, "lg-inspector-iconColor");
    expect(icon).toContain('<option value="brand_primary">Brand primary</option>');
    expect(icon).toContain('<option value="accent">Accent</option>');
    expect(icon).not.toContain('<option value="#');
    // §7.4: the no-override state reads as an inherited value
    expect(icon).toContain('<option value="">Inherited (design default)</option>');
    // §9.4 inheritance/source + reset + legacy-convert affordances per row
    expect(html).toContain('data-override-source="iconColor"');
    expect(html).toContain('data-override-reset="buttonBackground"');
    expect(html).toContain('data-override-convert="buttonText"');
    expect(html).toContain("Custom color (legacy)");
    // structural keys keep the design-slot vocabulary (NOT color-typed)
    const gap = selectBlock(html, "lg-inspector-gridGap");
    expect(gap).toContain("0.5rem"); // spacing.sm
    const columns = selectBlock(html, "lg-inspector-columns");
    for (const v of ["2", "3", "4", "5"]) expect(columns).toContain(`<option value="${v}">`);
    // §6.6 (F3): the preset control is the saved-presets dropdown + "(none)"
    expect(html).toContain("data-preset-select");
    expect(html).toContain("<option value=\"\">(none)</option>");
    expect(html).not.toMatch(/<input[^>]*data-inspector-field="design_preset"/);
  });

  it("bootstrap blobs: lg-section-data (unchanged shape), lg-component-seeds (legacy shape), lg-studio-meta (REQUIRED_FIELDS projection)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const data = extractJsonBlob(html, "lg-section-data");
    expect(data).toMatchObject({ public_id: section.public_id, continue_mode: "button", address_validation_enabled: false });
    expect((data["content"] as { components: unknown[] }).components).toHaveLength(1);
    const seeds = extractJsonBlob(html, "lg-component-seeds");
    expect(seeds["TwoButtonYesNo"]).toMatchObject({ internal_field: "", answer_type: "boolean" });
    const meta = extractJsonBlob(html, "lg-studio-meta");
    expect(meta["max_depth"]).toBe(4);
    const types = meta["types"] as Record<string, Record<string, unknown>>;
    expect(Object.keys(types).sort()).toEqual([...ALL_TYPES].sort());
    expect(types["TwoButtonYesNo"]).toMatchObject({ container: false, layout: false, produces: "boolean" });
    expect((types["TwoButtonYesNo"]!["required"] as Record<string, unknown>)["internal_field"]).toBe(true);
    expect(types["Stack"]).toMatchObject({ container: true, layout: true, produces: null });
    expect((types["IconCardAnswerGrid"]!["required"] as Record<string, unknown>)["choice_icon"]).toBe(true);
    expect((types["QuestionHeadline"]!["required"] as Record<string, unknown>)["text_props"]).toEqual(["text"]);
    expect(types["FreeTextQuestion"]!["validation"]).toEqual([{ key: "maxLen", kind: "number" }]);
  });
});

// ---------------------------------------------------------------------------
// ES5 parse gate for the studio island (listicles-ui-es5 mechanism)
// ---------------------------------------------------------------------------

const scratchDir = mkdtempSync(join(tmpdir(), "leadgen-studio-parse-"));
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

describeDb("section studio — ES5-only island", () => {
  it("the studio island is strict ES5 and parses standalone", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const scripts = extractScripts(html);
    expect(scripts.length).toBeGreaterThan(0);
    const errors: string[] = [];
    scripts.forEach((script, i) => {
      expect(script, "arrow").not.toMatch(/=>/);
      expect(script, "const").not.toMatch(/\bconst\b/);
      expect(script, "let").not.toMatch(/\blet\b/);
      expect(script, "async").not.toMatch(/\basync\b/);
      expect(script, "await").not.toMatch(/\bawait\b/);
      expect(script, "backtick").not.toContain("`");
      const err = parseError(`studio-script${i + 1}`, script);
      if (err) errors.push(err);
    });
    expect(errors, errors.join("\n\n")).toEqual([]);
    // canvas re-render is debounced ~300ms through the REAL preview endpoint
    // (wave 2: the debounce body also pauses while an inline edit is open)
    const island = studioIsland(html);
    expect(island).toContain("canvasTimer = setTimeout(function () {");
    expect(island).toContain("if (inlineEditing) { scheduleCanvasRender(); return; }");
    expect(island).toContain("}, 300);");
    expect(island).toContain("'/api/admin/leadgen/sections/preview'");
  });
});

// ---------------------------------------------------------------------------
// EXECUTED island — the model core sliced from the SERVED page (vm-probe)
// ---------------------------------------------------------------------------

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

// Slice a `var NAME = {…};` object-literal statement from the island (the
// §8.8 per-mode key tables ride NEXT TO the functions that consume them —
// probes must run the SERVED tables, never a test copy).
function sliceIslandVar(script: string, name: string): string {
  const marker = `var ${name} = {`;
  const start = script.indexOf(marker);
  expect(start, `island var ${name} present`).toBeGreaterThan(-1);
  const open = script.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < script.length; i += 1) {
    if (script[i] === "{") depth += 1;
    else if (script[i] === "}") {
      depth -= 1;
      if (depth === 0) return `${script.slice(start, i + 1)};`;
    }
  }
  throw new Error(`unbalanced braces while slicing island var ${name}`);
}

// The island's pure/model functions (no DOM) — sliced together so every
// probe runs the REAL served code, never a test re-implementation.
const MODEL_FUNCS = [
  "trimStr",
  "cloneJson",
  "newQuestionId",
  "typeMeta",
  "isContainerType",
  "typeLabel",
  // §5.2 canonical headline binding model core
  "bindForType",
  "bindNoun",
  "bindNodeType",
  "stripInputFor",
  "findBoundNode",
  "unboundCandidate",
  "insertBoundNodeAtTop",
  "linkBoundNode",
  "walkTree",
  "findRefIn",
  "findRef",
  "selectedNode",
  "breadcrumbText",
  "isInSubtree",
  "subtreeMaxContainerDepth",
  "fieldExists",
  "uniqueFieldName",
  "internalFieldsOf",
  "refFieldInfo",
  "findConditionalRefs",
  "slugify",
  "sampleChoice",
  "defaultTextFor",
  "makeNode",
  "addComponentAt",
  "insertRelative",
  "moveNodeTo",
  "moveWithin",
  "removeNode",
  "regenerateIds",
  "duplicateNode",
  "wrapSelection",
  "computeIssues",
  "parseBulkChoices",
  "typedScalar",
  "splitTypedList",
  "buildConditional",
  "ensureObj",
  "setOrDelete",
  "cleanupEmpty",
  "setLinesProp",
  "collectContainerProp",
  "collectSection",
  // §8.8 Maps config model + collectors + banner
  "mapsConfigOf",
  "mapsFillLabels",
  "nodeMapsEnabled",
  "mapsControl",
  "buildMapsConfig",
  "collectMapsConfig",
  "renderMapsBanner",
] as const;

interface StudioSandbox {
  state: { content: { components: unknown[] }; answer_maps?: unknown[]; selected_offers?: number[]; public_id?: string | null; continue_mode?: string; address_validation_enabled?: boolean };
  studioMeta: Record<string, unknown>;
  componentSeeds: Record<string, unknown>;
  MAX_DEPTH: number;
  selectedQuestionId: string | null;
  pendingInsert: unknown;
  refusals: string[];
  document: Record<string, unknown>;
  [k: string]: unknown;
}

interface StudioProbe {
  sandbox: StudioSandbox;
  run(expr: string): unknown;
}

// Boot a vm with the REAL blobs from the served page + the sliced model core.
function studioProbe(html: string, content: unknown, docStub?: Record<string, unknown>): StudioProbe {
  const island = studioIsland(html);
  const seeds = extractJsonBlob(html, "lg-component-seeds");
  const meta = extractJsonBlob(html, "lg-studio-meta");
  const refusals: string[] = [];
  const sandbox: StudioSandbox = {
    state: { content: JSON.parse(JSON.stringify(content)) as { components: unknown[] } },
    studioMeta: meta,
    componentSeeds: seeds,
    MAX_DEPTH: (meta["max_depth"] as number) ?? 4,
    selectedQuestionId: null,
    pendingInsert: null,
    refusals,
    document: docStub ?? {
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
  };
  const source = [
    // stubs for the DOM-side collaborators the model calls
    "function afterModelChange() {}",
    "function showRefusal(m) { refusals.push(m); }",
    "function clearRefusal() {}",
    "function applyCanvasDecoration() {}",
    // the §8.8 per-mode key tables the Maps collectors consume (served code)
    sliceIslandVar(island, "MAPS_FLAG_KEYS"),
    sliceIslandVar(island, "MAPS_FILL_KEYS"),
    ...MODEL_FUNCS.map((n) => sliceIslandFunction(island, n)),
  ].join("\n");
  runInNewContext(source, sandbox);
  return {
    sandbox,
    run(expr: string): unknown {
      return runInNewContext(expr, sandbox);
    },
  };
}

const NESTED_CONTENT = {
  components: [
    {
      type: "CardPanel",
      question_id: "panel1",
      children: [
        {
          type: "Stack",
          question_id: "stack1",
          children: [
            { type: "ButtonAnswerGroup", question_id: "bag1", internal_field: "pick", choices: [{ label: "A", value: "a", analytics_id: "a" }] },
          ],
        },
      ],
    },
  ],
};

const DEEP_CONTENT = {
  components: [
    {
      type: "Stack",
      question_id: "s1",
      children: [
        {
          type: "Stack",
          question_id: "s2",
          children: [
            {
              type: "Stack",
              question_id: "s3",
              children: [{ type: "Stack", question_id: "s4", children: [] }],
            },
          ],
        },
      ],
    },
  ],
};

describeDb("section studio EXECUTED island — §8.4 model mutations (vm-probe of the served code)", () => {
  async function probeHarness(content: unknown): Promise<StudioProbe> {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    return studioProbe(html, content);
  }

  it("add-from-library appends a validateSectionContent-CLEAN node (validity-ready defaults from the REQUIRED_FIELDS projection)", async () => {
    const probe = await probeHarness({ components: [] });
    for (const type of ["TwoButtonYesNo", "IconCardAnswerGrid", "QuestionHeadline", "RangeQuestion", "HeaderLogo"]) {
      const node = probe.run(`addComponentAt(${JSON.stringify(type)}, null, null)`) as Record<string, unknown>;
      expect(node, `${type} added`).not.toBeNull();
      expect(node["type"]).toBe(type);
      expect(typeof node["question_id"]).toBe("string");
    }
    const result = validateSectionContent(probe.sandbox.state.content);
    expect(result.errors, "added nodes are valid as-authored").toEqual([]);
    // IconCardAnswerGrid got icon-bearing sample choices (choice_icon required)
    const grid = (probe.sandbox.state.content.components as Array<Record<string, unknown>>).find((n) => n["type"] === "IconCardAnswerGrid")!;
    const choices = grid["choices"] as Array<Record<string, unknown>>;
    expect(choices.length).toBeGreaterThan(0);
    expect(typeof choices[0]!["icon"]).toBe("string");
    expect(typeof choices[0]!["analytics_id"]).toBe("string");
  });

  it("drop INTO a container appends to its children (§8.4 container regions)", async () => {
    const probe = await probeHarness(NESTED_CONTENT);
    const node = probe.run(`addComponentAt('TwoButtonYesNo', 'stack1', null)`) as Record<string, unknown>;
    expect(node).not.toBeNull();
    const stack = probe.run(`findRef('stack1').node`) as { children: Array<Record<string, unknown>> };
    expect(stack.children).toHaveLength(2);
    expect(stack.children[1]!["question_id"]).toBe(node["question_id"]);
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
  });

  it("a depth-5 CONTAINER drop is refused with a visible refusal; a depth-5 LEAF is allowed (§8.5 exact semantics)", async () => {
    const probe = await probeHarness(DEEP_CONTENT);
    const refused = probe.run(`addComponentAt('Stack', 's4', null)`);
    expect(refused).toBeNull();
    expect(probe.sandbox.refusals.length).toBe(1);
    expect(String(probe.sandbox.refusals[0])).toContain("drop refused");
    const s4 = probe.run(`findRef('s4').node`) as { children: unknown[] };
    expect(s4.children).toHaveLength(0); // model untouched
    // a leaf at depth 5 is fine — the §8.5 cap is on CONTAINER nesting
    const leaf = probe.run(`addComponentAt('QuestionHeadline', 's4', null)`) as Record<string, unknown>;
    expect(leaf).not.toBeNull();
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
  });

  it("breadcrumb text walks the ancestor chain in OPERATOR WORDS (§7.4 — labels, never raw type ids)", async () => {
    const probe = await probeHarness(NESTED_CONTENT);
    expect(probe.run(`breadcrumbText('bag1')`)).toBe("Question card › Stack › Simple answer buttons");
    expect(probe.run(`breadcrumbText('stack1')`)).toBe("Question card › Stack");
    expect(probe.run(`breadcrumbText('panel1')`)).toBe("Question card");
  });

  it("reorder within parent (toolbar/keyboard ↑↓ share moveWithin) — bounded at the edges", async () => {
    const content = {
      components: [
        { type: "QuestionHeadline", question_id: "a", props: { text: "A" } },
        { type: "QuestionHeadline", question_id: "b", props: { text: "B" } },
        { type: "QuestionHeadline", question_id: "c", props: { text: "C" } },
      ],
    };
    const probe = await probeHarness(content);
    probe.run(`moveWithin('b', -1)`);
    let order = (probe.sandbox.state.content.components as Array<{ question_id: string }>).map((n) => n.question_id);
    expect(order).toEqual(["b", "a", "c"]);
    probe.run(`moveWithin('b', -1)`); // already first — no-op
    order = (probe.sandbox.state.content.components as Array<{ question_id: string }>).map((n) => n.question_id);
    expect(order).toEqual(["b", "a", "c"]);
    // within a CONTAINER parent too
    const nested = await probeHarness({
      components: [
        {
          type: "Stack",
          question_id: "s",
          children: [
            { type: "QuestionHeadline", question_id: "x", props: { text: "X" } },
            { type: "QuestionHeadline", question_id: "y", props: { text: "Y" } },
          ],
        },
      ],
    });
    nested.run(`moveWithin('y', -1)`);
    const kids = (nested.run(`findRef('s').node.children`) as Array<{ question_id: string }>).map((n) => n.question_id);
    expect(kids).toEqual(["y", "x"]);
  });

  it("duplicate regenerates ids + de-collides internal_field; delete removes the node", async () => {
    const probe = await probeHarness(YESNO_CONTENT);
    const clone = probe.run(`duplicateNode('q1')`) as Record<string, unknown>;
    expect(clone["question_id"]).not.toBe("q1");
    expect(clone["internal_field"]).toBe("currently_insured_copy");
    expect(probe.sandbox.state.content.components).toHaveLength(2);
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]); // no dup ids/fields
    probe.run(`removeNode(${JSON.stringify(clone["question_id"])})`);
    expect(probe.sandbox.state.content.components).toHaveLength(1);
  });

  it("group-into-container wraps the selection in a Stack/CardPanel whose children = the selection; refuses past the depth cap", async () => {
    const probe = await probeHarness(YESNO_CONTENT);
    const wrapper = probe.run(`wrapSelection('q1', 'Stack')`) as { type: string; question_id: string; children: Array<{ question_id: string }> };
    expect(wrapper.type).toBe("Stack");
    expect(wrapper.children).toHaveLength(1);
    expect(wrapper.children[0]!.question_id).toBe("q1");
    const root = probe.sandbox.state.content.components as Array<{ question_id: string }>;
    expect(root[0]!.question_id).toBe(wrapper.question_id);
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
    // and again into a CardPanel (Stack now nested one deeper — still ≤ 4)
    const outer = probe.run(`wrapSelection(${JSON.stringify(wrapper.question_id)}, 'CardPanel')`) as { type: string };
    expect(outer.type).toBe("CardPanel");
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
    // refusal: grouping the 4-level container chain would push it past 4
    const deep = await probeHarness(DEEP_CONTENT);
    expect(deep.run(`wrapSelection('s1', 'CardPanel')`)).toBeNull();
    expect(deep.sandbox.refusals.length).toBe(1);
  });

  it("add-before / add-after insert relative to the selection inside the SAME parent", async () => {
    const probe = await probeHarness(NESTED_CONTENT);
    const before = probe.run(`insertRelative('bag1', 'before', 'QuestionHeadline')`) as Record<string, unknown>;
    const after = probe.run(`insertRelative('bag1', 'after', 'HelperText')`) as Record<string, unknown>;
    const kids = (probe.run(`findRef('stack1').node.children`) as Array<{ question_id: string; type: string }>).map((n) => n.type);
    expect(kids).toEqual(["QuestionHeadline", "ButtonAnswerGroup", "HelperText"]);
    expect(before["type"]).toBe("QuestionHeadline");
    expect(after["type"]).toBe("HelperText");
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
  });

  it("moveNodeTo re-parents with depth enforcement and self-nesting refusal", async () => {
    const probe = await probeHarness({
      components: [
        { type: "Stack", question_id: "s", children: [] },
        { type: "QuestionHeadline", question_id: "h", props: { text: "H" } },
      ],
    });
    expect(probe.run(`moveNodeTo('h', 's', null)`)).toBe(true);
    expect((probe.run(`findRef('s').node.children`) as unknown[]).length).toBe(1);
    expect(probe.sandbox.state.content.components).toHaveLength(1);
    // a container cannot be moved into its own subtree
    const deep = await probeHarness(DEEP_CONTENT);
    expect(deep.run(`moveNodeTo('s1', 's3', null)`)).toBe(false);
    expect(deep.sandbox.refusals.length).toBe(1);
  });

  it("the live validation model flags missing required fields / choices / depth — and clears on a valid tree", async () => {
    const probe = await probeHarness({
      components: [
        { type: "TwoButtonYesNo", question_id: "q1" }, // missing internal_field
        { type: "ButtonAnswerGroup", question_id: "q2", internal_field: "pick" }, // missing choices
        { type: "QuestionHeadline", question_id: "q3" }, // missing props.text
      ],
    });
    const issues = probe.run(`computeIssues()`) as Array<{ qid: string; message: string }>;
    expect(issues.length).toBe(3);
    expect(issues.map((i) => i.qid).sort()).toEqual(["q1", "q2", "q3"]);
    const clean = await probeHarness(YESNO_CONTENT);
    expect((clean.run(`computeIssues()`) as unknown[]).length).toBe(0);
    const empty = await probeHarness({ components: [] });
    expect((empty.run(`computeIssues()`) as Array<{ message: string }>)[0]!.message).toContain("at least one component");
  });

  it("§8.6 choices bulk paste parses label|value lines (typed choices, slug fallback, icon defaults for icon grids)", async () => {
    const probe = await probeHarness(YESNO_CONTENT);
    const parsed = probe.run(
      `parseBulkChoices('Toyota|toyota\\nHonda|honda\\nJust A Label\\n\\n', {})`,
    ) as Array<Record<string, unknown>>;
    expect(parsed).toEqual([
      { label: "Toyota", value: "toyota", analytics_id: "toyota" },
      { label: "Honda", value: "honda", analytics_id: "honda" },
      { label: "Just A Label", value: "just_a_label", analytics_id: "just_a_label" },
    ]);
    const withIcons = probe.run(`parseBulkChoices('A|a', { choice_icon: true })`) as Array<Record<string, unknown>>;
    expect(typeof withIcons[0]!["icon"]).toBe("string");
    // pasted choices validate on a real choice component
    const content = {
      components: [{ type: "ButtonAnswerGroup", question_id: "b1", internal_field: "make", choices: parsed }],
    };
    expect(validateSectionContent(content).errors).toEqual([]);
  });

  it("§6.10 conditional builder stores TYPED {when, op, value|values|from/to} per the referenced field's answer type", async () => {
    const probe = await probeHarness(YESNO_CONTENT);
    // boolean eq → boolean value
    expect(probe.run(`buildConditional('currently_insured', 'eq', { value: 'true' }, 'boolean')`)).toEqual({
      when: "currently_insured",
      op: "eq",
      value: true,
    });
    // numeric gt → number value
    expect(probe.run(`buildConditional('age', 'gt', { value: '42' }, 'number')`)).toEqual({ when: "age", op: "gt", value: 42 });
    // in → typed values list
    expect(probe.run(`buildConditional('make', 'in', { values: 'toyota, honda' }, 'enum')`)).toEqual({
      when: "make",
      op: "in",
      values: ["toyota", "honda"],
    });
    // range → numeric from/to
    expect(probe.run(`buildConditional('amount', 'range', { from: '10', to: '20' }, 'number')`)).toEqual({
      when: "amount",
      op: "range",
      from: 10,
      to: 20,
    });
    // empty when → null (delete the conditional)
    expect(probe.run(`buildConditional('', 'eq', { value: 'x' }, 'string')`)).toBeNull();
    // a stored typed conditional validates against the REAL schema
    const content = JSON.parse(JSON.stringify(YESNO_CONTENT)) as { components: Array<Record<string, unknown>> };
    content.components.push({
      type: "FreeTextQuestion",
      question_id: "q2",
      internal_field: "insurer",
      conditional: probe.run(`buildConditional('currently_insured', 'eq', { value: 'true' }, 'boolean')`),
    });
    expect(validateSectionContent(content).errors).toEqual([]);
  });

  it("§8.5 container prop collector stores the enum values EXACTLY as the schema validates them", async () => {
    const probe = await probeHarness(NESTED_CONTENT);
    probe.sandbox.selectedQuestionId = "stack1";
    const input = (value: string, key: string, kind: string, type = "text"): string =>
      `collectContainerProp({ value: ${JSON.stringify(value)}, type: ${JSON.stringify(type)}, getAttribute: function (k) { return k === 'data-container-prop' ? ${JSON.stringify(key)} : ${JSON.stringify(kind)}; } })`;
    probe.run(input("horizontal", "direction", "enum"));
    probe.run(input("xl", "gap", "enum"));
    probe.run(input("center", "align", "enum"));
    const stack = probe.run(`findRef('stack1').node`) as { props: Record<string, unknown> };
    expect(stack.props).toMatchObject({ direction: "horizontal", gap: "xl", align: "center" });
    // the whole tree stays schema-valid with the stored enum values
    probe.sandbox.selectedQuestionId = "panel1";
    probe.run(input("l", "width", "enum"));
    probe.run(input("lg", "shadow", "enum"));
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
    // clearing a select deletes the prop (back to the token default)
    probe.sandbox.selectedQuestionId = "stack1";
    probe.run(input("", "gap", "enum"));
    expect((probe.run(`findRef('stack1').node`) as { props: Record<string, unknown> }).props["gap"]).toBeUndefined();
  });

  it("internal_field rename is WARN-ONLY (D1): dependency refs are reported, never silently rewritten", async () => {
    const content = {
      components: [
        { type: "TwoButtonYesNo", question_id: "q1", internal_field: "currently_insured" },
        {
          type: "FreeTextQuestion",
          question_id: "q2",
          internal_field: "insurer",
          conditional: { when: "currently_insured", op: "eq", value: true },
        },
      ],
    };
    const probe = await probeHarness(content);
    expect(probe.run(`findConditionalRefs('currently_insured')`)).toEqual(["q2"]);
    // simulate the rename: the model keeps the OLD `when` (warn-only — the old
    // island never rewrote descendants either; documented D1 behavior)
    probe.run(`findRef('q1').node.internal_field = 'insured_now'`);
    const q2 = probe.run(`findRef('q2').node`) as { conditional: { when: string } };
    expect(q2.conditional.when).toBe("currently_insured");
  });
});

// ---------------------------------------------------------------------------
// EXECUTED client↔server seams: canvas re-render + save PATCH round-trip
// ---------------------------------------------------------------------------

describeDb("section studio EXECUTED island — live server seams", () => {
  it("renderCanvasNow POSTs the model to the REAL preview endpoint and injects preview.html + css into the canvas region", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const region = { innerHTML: "" };
    let captured: { url: string; init: RequestInit } | null = null;
    const sandbox = {
      state: { content: JSON.parse(JSON.stringify(YESNO_CONTENT)) as unknown },
      canvasViewport: "desktop", // wave-2 §6.1.4 island state the fn reads
      document: {
        getElementById(id: string) {
          return id === "lg-studio-canvas-render" ? region : null;
        },
      },
      fetch(url: string, init: RequestInit): Promise<Response> {
        captured = { url, init };
        return Promise.resolve(admin.request(url, init, env));
      },
    };
    const source = [
      "function applyCanvasDecoration() {}",
      "function updateCanvasEmpty() {}",
      sliceIslandFunction(island, "renderCanvasNow"),
      "renderCanvasNow();",
    ].join("\n");
    runInNewContext(source, sandbox);
    for (let i = 0; i < 200 && region.innerHTML === ""; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(captured, "canvas fetch executed").not.toBeNull();
    expect(captured!.url).toBe("/api/admin/leadgen/sections/preview");
    const body = JSON.parse(String(captured!.init.body)) as Record<string, unknown>;
    expect(body["viewport"]).toBe("desktop");
    expect(body["content_json"]).toBe(JSON.stringify(YESNO_CONTENT));
    // the LIVE handler's html + css landed in the canvas region — the REAL
    // preset renderer output (parity by construction, §8.1/§8.4)
    expect(region.innerHTML.startsWith("<style>")).toBe(true);
    expect(region.innerHTML).toContain("lg-preview-desktop");
    expect(region.innerHTML).toContain('data-component-type="TwoButtonYesNo"');
    expect(region.innerHTML).toContain('data-question-id="q1"');
  });

  it("collectSection builds the EXACT save body; PATCHing it through the real router persists the studio-authored tree + preserved answer_maps", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const data = extractJsonBlob(html, "lg-section-data");

    const fields: Record<string, { value: string }> = {
      "lg-section-name": { value: "Studio renamed" },
      "lg-section-activity": { value: "quote_funnel" },
      "lg-section-vertical": { value: "life" },
      "lg-section-headline": { value: "Are you insured?" },
      "lg-section-subheadline": { value: "Takes 2 minutes" },
    };
    const refusals: string[] = [];
    const sandbox: Record<string, unknown> = {
      state: data,
      studioMeta: extractJsonBlob(html, "lg-studio-meta"),
      componentSeeds: extractJsonBlob(html, "lg-component-seeds"),
      MAX_DEPTH: 4,
      selectedQuestionId: null,
      refusals,
      document: {
        getElementById(id: string) {
          return fields[id] ?? null;
        },
      },
    };
    const source = [
      "function afterModelChange() {}",
      "function showRefusal(m) { refusals.push(m); }",
      ...MODEL_FUNCS.map((n) => sliceIslandFunction(island, n)),
      // author through the REAL island model: wrap the seeded question in a
      // Stack and add a helper line inside it
      "var wrapper = wrapSelection('q1', 'Stack');",
      "addComponentAt('HelperText', wrapper.question_id, null);",
      "var body = collectSection();",
    ].join("\n");
    runInNewContext(source, sandbox);
    const body = sandbox["body"] as Record<string, unknown>;

    // the OLD island's exact body shape + the D2 additive selected_offers key
    // + the wave-2 §9.5 design_overrides key (null clears the column; the
    // PATCH path already consumed both server-side).
    expect(Object.keys(body).sort()).toEqual(
      ["section_name", "activity", "vertical", "headline_text", "subheadline_text", "continue_mode", "address_validation_enabled", "content_json", "answer_maps", "selected_offers", "design_overrides"].sort(),
    );
    expect(body["section_name"]).toBe("Studio renamed");
    expect(body["continue_mode"]).toBe("button");
    expect(body["selected_offers"]).toEqual([]);
    expect(body["design_overrides"]).toBeNull();

    // EXECUTED against the live router: the body the island built SAVES
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", body),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as Record<string, unknown>;
    expect(saved["section_name"]).toBe("Studio renamed");
    const savedContent = saved["content_json"] as { components: Array<Record<string, unknown>> };
    expect(savedContent.components).toHaveLength(1);
    expect(savedContent.components[0]!["type"]).toBe("Stack");
    const kids = savedContent.components[0]!["children"] as Array<Record<string, unknown>>;
    expect(kids.map((k) => k["type"])).toEqual(["TwoButtonYesNo", "HelperText"]);
    expect(kids[0]!["question_id"]).toBe("q1");

    // D2 browser-flow catch: an EMPTY subheadline input must serialize as
    // null (the validator rejects '' with "non-empty string or null") — the
    // PATCH below fails-before/passes-after the collectSection fix.
    fields["lg-section-subheadline"] = { value: "" };
    runInNewContext("var body2 = collectSection();", sandbox);
    const body2 = sandbox["body2"] as Record<string, unknown>;
    expect(body2["subheadline_text"]).toBeNull();
    const patch2 = await admin.request(`${API}/sections/${section.public_id}`, jsonInit("PATCH", body2), env);
    expect(patch2.status, await patch2.clone().text()).toBe(200);
  });
});

// ===========================================================================
// Slice D2 — §8.2 Activity/Vertical (E1+E9) · §8.7 mapping panel (E2) ·
// §8.9/§9.1 events panel
// ===========================================================================

// A real Offer (admin API) with an ACTIVE payload schema whose answer-source
// nodes drive the §8.7 mapping grid. Static offer — the schema endpoints do
// not require provider endpoints.
interface SchemaFieldSeed {
  path: string;
  type: string;
  required?: boolean;
  internal_field?: string;
  valid_values?: Array<string | number | boolean>;
}

async function createOfferWithSchema(
  env: Env,
  name: string,
  fields: SchemaFieldSeed[],
  overrides: Record<string, unknown> = {},
): Promise<{ id: number; public_id: string }> {
  const created = await admin.request(
    `${API}/offers`,
    jsonInit("POST", {
      offer_name: name,
      provider: "studioprov",
      activity: "quote_funnel",
      vertical: "life",
      conversion_tracking_method: "s2s_postback",
      offer_type: "cpc",
      placements: [`pl-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`],
      calls_provider_api: false,
      bid_source: "static",
      cap_enabled: false,
      ...overrides,
    }),
    env,
  );
  expect(created.status, `offer create: ${await created.clone().text()}`).toBe(201);
  const offer = (await created.json()) as { id: number; public_id: string };
  if (fields.length > 0) {
    const children = fields.map((f) => ({
      path: f.path,
      name: f.path.split(".").pop(),
      type: f.type,
      ...(f.required === true ? { required: true } : {}),
      source: "answer",
      internal_field: f.internal_field ?? f.path.split(".").pop(),
      ...(f.valid_values !== undefined ? { valid_values: f.valid_values } : {}),
    }));
    // one macro node rides along — it must NEVER appear in answer_fields
    children.push({ path: "meta.click_id", name: "click_id", type: "string", source: "macro", macro: "click_id" } as never);
    const schema = await admin.request(
      `${API}/offers/${offer.public_id}/payload-schemas`,
      jsonInit("POST", { schema_json: { version: 1, root: { type: "object", children } } }),
      env,
    );
    expect(schema.status, `schema create: ${await schema.clone().text()}`).toBe(201);
  }
  return offer;
}

// The island's §8.7/§8.2 model functions (DOM-free) — sliced from the served
// page like MODEL_FUNCS so every probe runs the REAL shipped code.
const MAPPING_FUNCS = [
  "offersList",
  "offerById",
  "answerFieldOf",
  "edgesForOffer",
  "findEdgeIndex",
  "questionByField",
  "answerNodeType",
  "coercibleTo",
  "edgeMapState",
  "offerLiveState",
  "upsertEdge",
  "removeEdge",
  "moveEdgePath",
  "toggleOfferSelected",
  "componentTypeForField",
  "internalFieldFromPath",
  "createQuestionForField",
  "bulkProposals",
  "mapStateNote",
] as const;

interface OffersResponse {
  activity: string;
  vertical: string;
  offers: Array<Record<string, unknown> & { id: number; public_id: string; answer_fields: Array<Record<string, unknown>> }>;
  mappings: Array<Record<string, unknown>>;
}

// Boot a vm with BOTH the D1 model core and the D2 mapping core + the live
// offers response as `offersData`.
function mappingProbe(html: string, content: unknown, offersData: unknown, answerMaps: unknown[] = [], selected: number[] = []): StudioProbe {
  const island = studioIsland(html);
  const seeds = extractJsonBlob(html, "lg-component-seeds");
  const meta = extractJsonBlob(html, "lg-studio-meta");
  const refusals: string[] = [];
  const sandbox: StudioSandbox = {
    state: {
      content: JSON.parse(JSON.stringify(content)) as { components: unknown[] },
      answer_maps: JSON.parse(JSON.stringify(answerMaps)) as unknown[],
      selected_offers: [...selected],
    } as StudioSandbox["state"],
    offersData: JSON.parse(JSON.stringify(offersData)) as unknown,
    studioMeta: meta,
    componentSeeds: seeds,
    MAX_DEPTH: (meta["max_depth"] as number) ?? 4,
    selectedQuestionId: null,
    pendingInsert: null,
    refusals,
    document: {
      getElementById() {
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    },
  };
  const source = [
    "function afterModelChange() {}",
    "function showRefusal(m) { refusals.push(m); }",
    "function clearRefusal() {}",
    "function markDirty() {}",
    ...MODEL_FUNCS.map((n) => sliceIslandFunction(island, n)),
    ...MAPPING_FUNCS.map((n) => sliceIslandFunction(island, n)),
  ].join("\n");
  runInNewContext(source, sandbox);
  return {
    sandbox,
    run(expr: string): unknown {
      return runInNewContext(expr, sandbox);
    },
  };
}

// Two-question content the §8.7 flows map from (boolean + string answers).
const MAPPABLE_CONTENT = {
  components: [
    { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
    { type: "ZIPInputQuestion", question_id: "q2", question_key: "zip_q", internal_field: "zip", answer_type: "string", props: { placeholder: "ZIP" } },
  ],
};

describeDb("section studio SSR — §8.2 Activity/Vertical dropdowns + E9 skeleton (D2)", () => {
  it("Activity/Vertical are SELECTS with the saved value + the allow-create affordances (no free text)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toMatch(/<select id="lg-section-activity"[^>]*data-studio-activity/);
    expect(html).toMatch(/<select id="lg-section-vertical"[^>]*data-studio-vertical/);
    // no free-text inputs for the pair
    expect(html).not.toMatch(/<input[^>]*data-studio-activity/);
    expect(html).not.toMatch(/<input[^>]*data-studio-vertical/);
    // the saved values ride as the selected options
    expect(html).toContain('<option value="quote_funnel" selected>quote_funnel</option>');
    expect(html).toContain('<option value="life" selected>life</option>');
    expect(html).toContain("data-studio-new-activity");
    expect(html).toContain("data-studio-new-vertical");
    // the island wires the §8.2 derivation: /activities + /verticals?activity=
    const island = studioIsland(html);
    expect(island).toContain("'/api/admin/leadgen/activities'");
    expect(island).toContain("'/api/admin/leadgen/verticals'");
    expect(island).toContain("'?activity=' + encodeURIComponent(activity)");
    // changing Activity RESETS Vertical
    expect(island).toContain("verticalSel.value = ''");
    // the allow-create affordance requires the explicit §8.2 confirm
    expect(island).toContain("No Offers exist for '");
  });

  it("the drawer carries the E9 empty-state skeleton with [Open Offers] + [Change Activity/Vertical] and the island's exact copy template", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toContain("data-studio-offers-empty");
    expect(html).toContain("data-studio-offers-empty-copy");
    expect(html).toMatch(/<a href="\/admin\/leadgen\/offers"[^>]*data-studio-open-offers[^>]*>Open Offers<\/a>/);
    expect(html).toMatch(/data-studio-change-pair[^>]*>Change Activity\/Vertical</);
    const island = studioIsland(html);
    // E9 verbatim pattern (island fills the SAVED pair from the offers response)
    expect(island).toContain('"No active Offers match Activity \'" + offersData.activity + "\' + Vertical \'" + offersData.vertical + "\'."');
    // §8.2 save-time zero-match warning
    expect(island).toContain("Warning: no active Offers match Activity");
    expect(html).toContain("data-studio-zero-offers-warning");
  });

  it("the §8.7 mapping table SSRs the normative columns; raw ids/paths/JSON are absent from the surface", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const head = html.slice(html.indexOf("data-studio-mapping-table"), html.indexOf("data-studio-offers-body"));
    for (const col of ["Offer", "Provider", "Placement", "Payload schema version", "Required fields", "Mapped fields", "Mapping status", "Action"]) {
      expect(head, `column ${col}`).toContain(`<th scope="col">${col}</th>`);
    }
    // §8.7: no free-text path inputs, no raw answer-map JSON textarea on this
    // surface (the ONLY raw-JSON control is the Advanced NODE editor).
    expect(html).not.toContain("data-map-field"); // the old builder's raw grid hooks
    expect(html).not.toContain('id="lg-mapping-json"');
    const rawJsonSurfaces = html.match(/<textarea[^>]*data-studio-node-json/g) ?? [];
    expect(rawJsonSurfaces).toHaveLength(1);
  });
});

describeDb("section studio — §8.7 GET /sections/:id/offers answer_fields (server extension)", () => {
  it("each matched offer carries provider, default placement, ACTIVE schema version and its ANSWER-source fields (macro nodes excluded)", async () => {
    const { env } = newHarness();
    const offer = await createOfferWithSchema(env, "Studio Offer A", [
      { path: "data.insured", type: "boolean", required: true, internal_field: "currently_insured" },
      { path: "data.zip", type: "string", required: true, internal_field: "zip" },
      { path: "data.coverage", type: "enum", valid_values: ["basic", "full"], internal_field: "coverage" },
    ]);
    const bare = await createOfferWithSchema(env, "Studio Offer NoSchema", []);
    const section = await createSection(env, { content_json: JSON.stringify(MAPPABLE_CONTENT) });

    const res = await admin.request(`${API}/sections/${section.public_id}/offers`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as OffersResponse;
    // §8.2: the SAVED pair the derivation used rides the response (E9 copy)
    expect(body.activity).toBe("quote_funnel");
    expect(body.vertical).toBe("life");
    const withSchema = body.offers.find((o) => o.id === offer.id)!;
    expect(withSchema).toBeDefined();
    expect(withSchema["provider"]).toBe("studioprov");
    expect(withSchema["default_placement_id"]).toBe("pl-studio-offer-a");
    expect(withSchema["payload_schema_version"]).toBe(1);
    expect(String(withSchema["payload_schema_public_id"])).toMatch(/^lgp_/);
    // ANSWER-source fields only — the macro node never appears
    expect(withSchema.answer_fields.map((f) => f["path"])).toEqual(["data.insured", "data.zip", "data.coverage"]);
    expect(withSchema.answer_fields[0]).toMatchObject({ path: "data.insured", type: "boolean", required: true, internal_field: "currently_insured" });
    expect(withSchema.answer_fields[2]).toMatchObject({ path: "data.coverage", type: "enum", required: false, valid_values: ["basic", "full"] });
    // schema-less offer: honest empties, never a fake schema
    const noSchema = body.offers.find((o) => o.id === bare.id)!;
    expect(noSchema["has_active_schema"]).toBe(false);
    expect(noSchema["payload_schema_version"]).toBeNull();
    expect(noSchema.answer_fields).toEqual([]);
  });
});

describeDb("section studio EXECUTED island — §8.7 mapping model (E2) + REAL server round trip", () => {
  async function seamHarness(): Promise<{
    env: Env;
    section: SectionDetail;
    html: string;
    offers: OffersResponse;
    offerA: { id: number; public_id: string };
    offerB: { id: number; public_id: string };
  }> {
    const { env } = newHarness();
    const offerA = await createOfferWithSchema(env, "Seam Offer A", [
      { path: "data.insured", type: "boolean", required: true, internal_field: "currently_insured" },
      { path: "data.zip", type: "string", required: true, internal_field: "zip" },
    ]);
    const offerB = await createOfferWithSchema(env, "Seam Offer B", [
      { path: "lead.zip_code", type: "string", required: true, internal_field: "zip" },
    ]);
    const section = await createSection(env, { content_json: JSON.stringify(MAPPABLE_CONTENT) });
    const html = await studioPage(env, section.public_id);
    const res = await admin.request(`${API}/sections/${section.public_id}/offers`, {}, env);
    const offers = (await res.json()) as OffersResponse;
    return { env, section, html, offers, offerA, offerB };
  }

  it("picker-built edges (upsertEdge) round-trip through the REAL PATCH: server rebuild agrees with the island's live decode", async () => {
    const { env, section, html, offers, offerA, offerB } = await seamHarness();
    const probe = mappingProbe(html, MAPPABLE_CONTENT, offers);

    // map offer A's two required fields via the picker-equivalent calls
    probe.run(`upsertEdge(offerById(${offerA.id}), answerFieldOf(offerById(${offerA.id}), 'data.insured'), 'currently_insured')`);
    // live decode after ONE of two required fields: incomplete
    expect((probe.run(`offerLiveState(offerById(${offerA.id}))`) as { state: string }).state).toBe("incomplete");
    probe.run(`upsertEdge(offerById(${offerA.id}), answerFieldOf(offerById(${offerA.id}), 'data.zip'), 'zip')`);
    const liveA = probe.run(`offerLiveState(offerById(${offerA.id}))`) as { state: string; required_total: number; required_mapped: number };
    expect(liveA).toMatchObject({ state: "complete", required_total: 2, required_mapped: 2 });
    // offer B: one required field
    probe.run(`upsertEdge(offerById(${offerB.id}), answerFieldOf(offerById(${offerB.id}), 'lead.zip_code'), 'zip')`);
    expect((probe.run(`offerLiveState(offerById(${offerB.id}))`) as { state: string }).state).toBe("complete");
    // mapped offers were implicitly selected by upsertEdge
    expect(probe.sandbox.state["selected_offers"]).toEqual([offerA.id, offerB.id]);

    // the island's save body persists through the REAL router
    const body = {
      section_name: "Seam section",
      activity: "quote_funnel",
      vertical: "life",
      headline_text: "Are you insured?",
      subheadline_text: null,
      continue_mode: "button",
      address_validation_enabled: false,
      content_json: JSON.stringify(probe.sandbox.state.content),
      answer_maps: probe.sandbox.state["answer_maps"],
      selected_offers: probe.sandbox.state["selected_offers"],
    };
    const patch = await admin.request(`${API}/sections/${section.public_id}`, jsonInit("PATCH", body), env);
    expect(patch.status, await patch.clone().text()).toBe(200);

    // SERVER truth: the §12.1 rebuild derived the SAME states the island showed
    const detail = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as Record<string, unknown>;
    const available = detail["available_offers"] as Array<Record<string, unknown>>;
    const rowA = available.find((o) => o["offer_id"] === offerA.id)!;
    const rowB = available.find((o) => o["offer_id"] === offerB.id)!;
    expect(rowA).toMatchObject({ selected: true, mapping_state: "complete", required_fields_total: 2, required_fields_mapped: 2 });
    expect(rowB).toMatchObject({ selected: true, mapping_state: "complete", required_fields_total: 1, required_fields_mapped: 1 });
    const maps = detail["answer_maps"] as Array<Record<string, unknown>>;
    expect(maps).toHaveLength(3);
    for (const m of maps) expect(m["mapping_status"]).toBe("complete");
    expect(detail["validation_status"] ?? "ok").toBeDefined();

    // and validate-payload (the §8.7 per-offer preview endpoint) agrees
    const vp = await admin.request(
      `${API}/sections/${section.public_id}/validate-payload`,
      jsonInit("POST", { answers: { currently_insured: true, zip: "90210" }, offers: [offerA.public_id] }),
      env,
    );
    expect(vp.status).toBe(200);
    const vpBody = (await vp.json()) as { offers: Array<{ completeness: { required_total: number; required_mapped: number } }>; section_validation: { publishable: boolean } };
    expect(vpBody.offers[0]!.completeness).toMatchObject({ required_total: 2, required_mapped: 2 });
    expect(vpBody.section_validation.publishable).toBe(true);
  });

  it("SEAM matrix: the island's edgeMapState/offerLiveState equals the REAL rebuildDerivedIndexes per state (complete/missing_required/type_mismatch/orphaned/selected)", async () => {
    const { env } = newHarness();
    const section = await createSection(env, { content_json: JSON.stringify(MAPPABLE_CONTENT) });
    const html = await studioPage(env, section.public_id);

    // ONE fixture drives BOTH sides: the island-shaped offer and the server's
    // injected OfferSchemaInfo.
    const fieldTypes = new Map<string, "boolean" | "number">([
      ["data.insured", "boolean"],
      ["data.count", "number"],
    ]);
    const offerFixture = {
      id: 7,
      public_id: "lgo_seamfixture",
      offer_name: "Seam",
      has_active_schema: true,
      payload_schema_public_id: "lgp_seamfixture",
      payload_schema_version: 3,
      answer_fields: [
        { path: "data.insured", type: "boolean", required: true, internal_field: null, label: null, valid_values: null },
        { path: "data.count", type: "number", required: false, internal_field: null, label: null, valid_values: null },
      ],
    };
    const schemaInfo: OfferSchemaInfo = {
      status: "active",
      activity: "quote_funnel",
      vertical: "life",
      active_schema_id: 33,
      active_schema_public_id: "lgp_seamfixture",
      fieldTypes,
      requiredFieldPaths: ["data.insured"],
    };
    const edge = (over: Record<string, unknown>): Record<string, unknown> => ({
      question_id: "q1",
      question_key: "insured_q",
      internal_field: "currently_insured",
      answer_type: "boolean",
      offer_id: 7,
      offer_payload_field_path: "data.insured",
      provider_expected_type: "boolean",
      output_value_map: null,
      value_transform: null,
      required_for_offer: true,
      default_value: null,
      fallback_value: null,
      ...over,
    });

    const cases: Array<{ label: string; edges: Array<Record<string, unknown>>; expectEdge: string[]; expectOffer: string }> = [
      { label: "complete", edges: [edge({})], expectEdge: ["complete"], expectOffer: "incomplete" }, // 1 of 1 required mapped BUT wait: complete edge on the only required → complete
      {
        label: "type_mismatch (string answer → number node, no map/transform)",
        edges: [edge({ offer_payload_field_path: "data.count", provider_expected_type: "number", answer_type: "string", required_for_offer: false, internal_field: "zip", question_id: "q2" })],
        expectEdge: ["type_mismatch"],
        expectOffer: "invalid",
      },
      {
        label: "orphaned (path not in the active schema)",
        edges: [edge({ offer_payload_field_path: "data.gone" })],
        expectEdge: ["orphaned"],
        expectOffer: "invalid",
      },
      {
        label: "missing_required (required edge, empty internal_field)",
        edges: [edge({ internal_field: "" })],
        expectEdge: ["missing_required"],
        expectOffer: "incomplete",
      },
      { label: "selected / not started (no edges)", edges: [], expectEdge: [], expectOffer: "selected" },
    ];
    // fix the first case's expected offer state: its one required field IS
    // complete → the offer is complete.
    cases[0]!.expectOffer = "complete";

    for (const c of cases) {
      // ISLAND side (the served code)
      const probe = mappingProbe(html, MAPPABLE_CONTENT, { activity: "quote_funnel", vertical: "life", offers: [offerFixture] }, c.edges, [7]);
      const islandEdgeStates = (c.edges.length > 0
        ? (probe.run(`edgesForOffer(7).map(function (e) { return edgeMapState(e, offerById(7)); })`) as string[])
        : []);
      const islandOffer = probe.run(`offerLiveState(offerById(7))`) as { state: string; required_total: number; required_mapped: number };

      // SERVER side (the REAL rebuild)
      const rebuilt = rebuildDerivedIndexes({
        content: MAPPABLE_CONTENT as never,
        answerMaps: c.edges as never,
        offerSchemas: new Map([[7, schemaInfo]]),
        selectedOfferIds: new Set([7]),
      });
      const serverEdgeStates = rebuilt.answerMaps.map((r) => r.mapping_completeness);
      const serverOffer = rebuilt.availableOffers.find((o) => o.offer_id === 7)!;

      expect(islandEdgeStates, `edge states (${c.label})`).toEqual(serverEdgeStates);
      expect(islandEdgeStates, `expected edge decode (${c.label})`).toEqual(c.expectEdge);
      expect(islandOffer.state, `offer state (${c.label})`).toBe(serverOffer.mapping_state);
      expect(islandOffer.state, `expected offer decode (${c.label})`).toBe(c.expectOffer);
      expect(islandOffer.required_total, `required total (${c.label})`).toBe(serverOffer.required_fields_total);
      expect(islandOffer.required_mapped, `required mapped (${c.label})`).toBe(serverOffer.required_fields_mapped);
    }
  });

  it("PORTED §12.11 cell copy: mapStateNote emits the grid's exact per-state operator vocabulary", async () => {
    const { env } = newHarness();
    const section = await createSection(env, { content_json: JSON.stringify(MAPPABLE_CONTENT) });
    const html = await studioPage(env, section.public_id);
    const offer = {
      id: 7,
      public_id: "lgo_x",
      offer_name: "OfferX",
      has_active_schema: true,
      payload_schema_public_id: "lgp_00000000000000000000000001",
      answer_fields: [{ path: "data.insured", type: "boolean", required: true, internal_field: null, label: null, valid_values: null }],
    };
    const probe = mappingProbe(html, MAPPABLE_CONTENT, { activity: "a", vertical: "v", offers: [offer] });
    const field = `answerFieldOf(offerById(7), 'data.insured')`;
    expect(probe.run(`mapStateNote('complete', ${field}, offerById(7), null)`)).toBe("complete");
    expect(probe.run(`mapStateNote('missing_required', ${field}, offerById(7), null)`)).toBe("map required field");
    expect(
      probe.run(`mapStateNote('type_mismatch', ${field}, offerById(7), { answer_type: 'string' })`),
    ).toBe("answer type string not coercible to boolean");
    expect(probe.run(`mapStateNote('orphaned', null, offerById(7), null)`)).toBe(
      "Offer field no longer exists in schema lgp_00000000000000000000000001",
    );
    expect(probe.run(`mapStateNote('unmapped', ${field}, offerById(7), null)`)).toBe("required — not mapped");
  });

  it("createQuestionForField spawns the RIGHT pre-bound component per schema type/name, choices from valid_values, internal_field from the path", async () => {
    const { env } = newHarness();
    const section = await createSection(env, { content_json: JSON.stringify(MAPPABLE_CONTENT) });
    const html = await studioPage(env, section.public_id);
    const offer = {
      id: 9,
      public_id: "lgo_create",
      offer_name: "Creator",
      has_active_schema: true,
      payload_schema_public_id: "lgp_create",
      answer_fields: [
        { path: "data.homeowner", type: "boolean", required: true, internal_field: null, label: null, valid_values: null },
        { path: "data.coverage", type: "enum", required: false, internal_field: null, label: null, valid_values: ["basic", "full"] },
        { path: "data.loan_amount", type: "number", required: false, internal_field: null, label: null, valid_values: null },
        { path: "data.age", type: "number", required: false, internal_field: null, label: null, valid_values: null },
        { path: "data.dob_date", type: "string", required: false, internal_field: null, label: null, valid_values: null },
        { path: "data.note", type: "string", required: false, internal_field: null, label: null, valid_values: null },
        { path: "data.zip", type: "string", required: true, internal_field: null, label: null, valid_values: null },
      ],
    };
    const probe = mappingProbe(html, MAPPABLE_CONTENT, { activity: "a", vertical: "v", offers: [offer] });

    // the §8.7 type→component mapping table
    const expectType = (path: string, type: string): void => {
      expect(probe.run(`componentTypeForField(answerFieldOf(offerById(9), ${JSON.stringify(path)}))`), path).toBe(type);
    };
    expectType("data.homeowner", "TwoButtonYesNo");
    expectType("data.coverage", "DropdownQuestion");
    expectType("data.loan_amount", "CurrencyInputQuestion");
    expectType("data.age", "NumberInputQuestion");
    expectType("data.dob_date", "DateQuestion");
    expectType("data.note", "FreeTextQuestion");

    // spawn: pre-bound node + edge, appended through the D1 add machinery
    const node = probe.run(`createQuestionForField(offerById(9), answerFieldOf(offerById(9), 'data.homeowner'))`) as Record<string, unknown>;
    expect(node["type"]).toBe("TwoButtonYesNo");
    expect(node["internal_field"]).toBe("homeowner");
    expect(node["required"]).toBe(true);
    const edges = probe.run(`edgesForOffer(9)`) as Array<Record<string, unknown>>;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ offer_payload_field_path: "data.homeowner", internal_field: "homeowner", provider_expected_type: "boolean", required_for_offer: true });
    expect(probe.run(`edgeMapState(edgesForOffer(9)[0], offerById(9))`)).toBe("complete");

    // enum spawn: choices come from valid_values
    const dropdown = probe.run(`createQuestionForField(offerById(9), answerFieldOf(offerById(9), 'data.coverage'))`) as Record<string, unknown>;
    expect(dropdown["type"]).toBe("DropdownQuestion");
    expect(dropdown["choices"]).toEqual([
      { label: "basic", value: "basic", analytics_id: "basic" },
      { label: "full", value: "full", analytics_id: "full" },
    ]);

    // path→internal_field naming de-collides against the existing 'zip'
    expect(probe.run(`internalFieldFromPath('data.zip')`)).toBe("zip_copy");

    // everything the creator authored stays schema-valid
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
  });

  it("bulkProposals proposes name+type-compatible pairs only (exact slug match first) and upsert applies them", async () => {
    const { env } = newHarness();
    const section = await createSection(env, { content_json: JSON.stringify(MAPPABLE_CONTENT) });
    const html = await studioPage(env, section.public_id);
    const offer = {
      id: 4,
      public_id: "lgo_bulk",
      offer_name: "Bulk",
      has_active_schema: true,
      payload_schema_public_id: "lgp_bulk",
      answer_fields: [
        { path: "lead.zip", type: "string", required: true, internal_field: null, label: null, valid_values: null },
        { path: "lead.insured", type: "boolean", required: false, internal_field: null, label: null, valid_values: null }, // substring of currently_insured
        { path: "lead.zip_count", type: "number", required: false, internal_field: null, label: null, valid_values: null }, // name-near but number ⇒ excluded
      ],
    };
    const probe = mappingProbe(html, MAPPABLE_CONTENT, { activity: "a", vertical: "v", offers: [offer] });
    const proposals = probe.run(`bulkProposals(offerById(4))`) as Array<Record<string, unknown>>;
    expect(proposals).toEqual([
      { path: "lead.zip", type: "string", internal_field: "zip" },
      { path: "lead.insured", type: "boolean", internal_field: "currently_insured" },
    ]);
    // applying a proposal creates a COMPLETE edge
    probe.run(`upsertEdge(offerById(4), answerFieldOf(offerById(4), 'lead.zip'), 'zip')`);
    expect(probe.run(`edgeMapState(edgesForOffer(4)[0], offerById(4))`)).toBe("complete");
    // an applied field stops being proposed
    expect((probe.run(`bulkProposals(offerById(4))`) as unknown[]).length).toBe(1);
  });

  it("toggleOfferSelected(off) drops the offer's edges (a mapped offer is implicitly selected); selected_offers persists a selected-but-unmapped offer through PATCH", async () => {
    const { env } = newHarness();
    const offer = await createOfferWithSchema(env, "Sel Only", [
      { path: "data.zip", type: "string", required: true, internal_field: "zip" },
    ]);
    const section = await createSection(env, { content_json: JSON.stringify(MAPPABLE_CONTENT) });
    const html = await studioPage(env, section.public_id);
    const res = await admin.request(`${API}/sections/${section.public_id}/offers`, {}, env);
    const offers = (await res.json()) as OffersResponse;
    const probe = mappingProbe(html, MAPPABLE_CONTENT, offers);

    // island model: select without mapping, then verify the deselect drop
    probe.run(`toggleOfferSelected(${offer.id}, true)`);
    expect((probe.run(`offerLiveState(offerById(${offer.id}))`) as { state: string }).state).toBe("selected");
    probe.run(`upsertEdge(offerById(${offer.id}), answerFieldOf(offerById(${offer.id}), 'data.zip'), 'zip')`);
    expect((probe.run(`edgesForOffer(${offer.id})`) as unknown[]).length).toBe(1);
    probe.run(`toggleOfferSelected(${offer.id}, false)`);
    expect((probe.run(`edgesForOffer(${offer.id})`) as unknown[]).length).toBe(0);
    expect((probe.run(`offerLiveState(offerById(${offer.id}))`) as { state: string }).state).toBe("not_selected");

    // server: a selected-but-unmapped offer SURVIVES the studio save
    const body = {
      section_name: "Selected only",
      activity: "quote_funnel",
      vertical: "life",
      headline_text: "Are you insured?",
      subheadline_text: null,
      continue_mode: "button",
      address_validation_enabled: false,
      content_json: JSON.stringify(MAPPABLE_CONTENT),
      answer_maps: [],
      selected_offers: [offer.id],
    };
    const patch = await admin.request(`${API}/sections/${section.public_id}`, jsonInit("PATCH", body), env);
    expect(patch.status, await patch.clone().text()).toBe(200);
    const detail = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as Record<string, unknown>;
    const available = detail["available_offers"] as Array<Record<string, unknown>>;
    expect(available.find((o) => o["offer_id"] === offer.id)).toMatchObject({ selected: true, mapping_state: "selected" });
    // and the editor page now feeds it back through the state blob
    const html2 = await studioPage(env, section.public_id);
    const blob = extractJsonBlob(html2, "lg-section-data");
    expect(blob["selected_offers"]).toEqual([offer.id]);
  });
});

// ===========================================================================
// §8.9 + §9.1 — the events panel (path (a): the REAL runtime bundle in
// preview mode; would-fire events postMessage'd to the Studio panel)
// ===========================================================================

describeDb("section studio — §8.9/§9.1 runtime events document + events panel", () => {
  it("POST /sections/preview {runtime:true} returns events_html: the shell-shaped preview document (data-lg-preview root, #lg-config through the REAL projection, the SAME versioned bundle URL)", async () => {
    const { env } = newHarness();
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: JSON.stringify(MAPPABLE_CONTENT),
        viewport: "desktop",
        runtime: true,
        section_public_id: "lgs_previewsection",
        headline: "Are you insured?",
        continue_mode: "auto_advance",
        address_validation_enabled: true,
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { preview: Record<string, unknown> };
    const doc = String(body.preview["events_html"]);

    // the 03 §3.2 shell structural contract in PREVIEW mode
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain('id="lg-funnel-root"');
    expect(doc).toContain('data-lg-preview="1"');
    expect(doc).toContain("data-lg-mount");
    expect(doc).toContain('data-lg-section data-lg-section-id="lgs_previewsection" data-lg-index="0"');
    expect(doc).toContain('data-screen-label="01 · Are you insured?"');
    expect(doc).toContain('data-lg-banners hidden');
    // §9.1 "one hydration": the BYTE-IDENTICAL generated bundle the live
    // shell's /lg/runtime/{version}.js serves, inlined (the admin host has no
    // tenant site context, so /lg/* — including the bundle URL — 404s there;
    // LEADGEN_RUNTIME_JS is exactly that route's response body).
    expect(doc).toContain(`<script data-lg-runtime-version="2">`);
    expect(doc).toContain(LEADGEN_RUNTIME_JS);
    // honest preview identity — never faked live ids
    expect(doc).toContain('data-funnel-variant-id="lgn_preview"');

    // #lg-config parses and its components ARE the real toPublicComponent
    // projection of the same nodes (parity by construction)
    const marker = 'id="lg-config">';
    const from = doc.indexOf(marker) + marker.length;
    const configRaw = doc.slice(from, doc.indexOf("</script>", from)).split("\\u003c").join("<");
    const config = JSON.parse(configRaw) as Record<string, unknown>;
    const sections = config["sections"] as Array<Record<string, unknown>>;
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      section_public_id: "lgs_previewsection",
      section_index: 0,
      headline: "Are you insured?",
      continue_mode: "auto_advance",
      address_validation_enabled: true,
    });
    const expectedComponents = flattenComponents(MAPPABLE_CONTENT.components as LeadgenComponentNode[]).map(toPublicComponent);
    expect(sections[0]!["components"]).toEqual(JSON.parse(JSON.stringify(expectedComponents)));

    // the rendered section markup rides INSIDE the section block
    expect(doc).toContain('data-question-id="q1"');
    expect(doc).toContain('data-lg-question="q1"');

    // a legacy body (no runtime flag) returns NO events_html — byte-compatible
    const legacy = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", { content_json: JSON.stringify(MAPPABLE_CONTENT), viewport: "desktop" }),
      env,
    );
    const legacyBody = (await legacy.json()) as { preview: Record<string, unknown> };
    expect("events_html" in legacyBody.preview).toBe(false);
  });

  it("the mobile events document carries the mobile viewport marker (round-trip with desktop)", async () => {
    const { env } = newHarness();
    for (const viewport of ["mobile", "desktop"] as const) {
      const res = await admin.request(
        `${API}/sections/preview`,
        jsonInit("POST", { content_json: JSON.stringify(MAPPABLE_CONTENT), viewport, runtime: true }),
        env,
      );
      const body = (await res.json()) as { preview: Record<string, unknown> };
      const doc = String(body.preview["events_html"]);
      expect(doc, viewport).toContain(`lg-preview-${viewport}`);
      expect(doc, viewport).not.toContain(`lg-preview-${viewport === "mobile" ? "desktop" : "mobile"}`);
    }
  });

  it("EXECUTED island: onPreviewMessage appends ONLY lg-preview-event batches from the island's OWN iframes (MINOR-3 origin gate); clearEventsList resets it", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);

    // a minimal fake-DOM list + document for the three sliced functions
    interface FakeNode {
      children: unknown[];
      attrs: Map<string, string>;
      className: string;
      appendChild(c: unknown): unknown;
      removeChild(c: unknown): void;
      setAttribute(k: string, v: string): void;
      readonly firstChild: unknown;
      textContent?: string;
    }
    const el = (): FakeNode => ({
      children: [],
      attrs: new Map(),
      className: "",
      appendChild(c) {
        this.children.push(c);
        return c;
      },
      removeChild(c) {
        const i = this.children.indexOf(c);
        if (i !== -1) this.children.splice(i, 1);
      },
      setAttribute(k, v) {
        this.attrs.set(k, v);
      },
      get firstChild() {
        return this.children[0] ?? null;
      },
    });
    const list = el();
    // MINOR-3: onPreviewMessage now gates on event.source — it must be one of
    // the island's OWN iframes' contentWindow. Stub getElementById to return
    // the two frame elements, each with a distinct contentWindow sentinel, and
    // a foreign window that is NOT either frame.
    const previewWin = { __frame: "preview" };
    const probeWin = { __frame: "probe" };
    const foreignWin = { __frame: "foreign" };
    const frames: Record<string, { contentWindow: unknown }> = {
      "lg-preview-frame": { contentWindow: previewWin },
      "lg-events-probe-frame": { contentWindow: probeWin },
    };
    const sandbox = {
      previewWin,
      probeWin,
      foreignWin,
      document: {
        querySelector(sel: string) {
          return sel === "[data-studio-events-list]" ? list : null;
        },
        getElementById(id: string) {
          return frames[id] ?? null;
        },
        createElement() {
          return el();
        },
        createTextNode(t: string) {
          return { nodeType: 3, textContent: String(t) };
        },
      },
    };
    const source = [
      sliceIslandFunction(island, "cloneJson"),
      sliceIslandFunction(island, "clearChildren"),
      sliceIslandFunction(island, "clearEventsList"),
      sliceIslandFunction(island, "appendPreviewEvents"),
      sliceIslandFunction(island, "onPreviewMessage"),
      // the REAL engine message shape ({type:'lg-preview-event', events:[...]},
      // engine.ts previewSender) posted BY the preview iframe (event.source ===
      // the preview frame's contentWindow) — ACCEPTED.
      "onPreviewMessage({ source: previewWin, data: { type: 'lg-preview-event', events: [" +
        "{ event_type: 'section_view', section_public_id: 'lgs_x', section_index: 0 }," +
        "{ event_type: 'answer_click', question_key: 'insured_q' } ] } });",
      // MINOR-3 decoys that must be IGNORED: a FOREIGN window forging the right
      // type; the island's own frame but the WRONG type; a non-object payload.
      "onPreviewMessage({ source: foreignWin, data: { type: 'lg-preview-event', events: [ { event_type: 'spoofed' } ] } });",
      "onPreviewMessage({ source: previewWin, data: { type: 'other-message' } });",
      "onPreviewMessage({ source: previewWin, data: 'not-an-object' });",
      // a batch from the hidden events-probe iframe is ALSO accepted.
      "onPreviewMessage({ source: probeWin, data: { type: 'lg-preview-event', events: [ { event_type: 'answer_change', question_key: 'insurer_q' } ] } });",
    ].join("\n");
    runInNewContext(source, sandbox);
    // preview batch (2) + probe batch (1) = 3; foreign-source, wrong-type and
    // non-object messages contributed nothing.
    expect(list.children).toHaveLength(3);
    const first = list.children[0] as FakeNode;
    expect(first.attrs.get("data-event-type")).toBe("section_view");
    // flatten one nesting level: li > [span.studio-event-type > text, text]
    const textOf = (n: unknown): string => {
      const node = n as { textContent?: string; children?: unknown[] };
      if (typeof node.textContent === "string" && node.textContent !== "") return node.textContent;
      return (node.children ?? []).map(textOf).join("");
    };
    const firstText = first.children.map(textOf).join("");
    expect(firstText).toContain("section_view");
    expect(firstText).toContain("lgs_x");
    const second = list.children[1] as FakeNode;
    expect(second.attrs.get("data-event-type")).toBe("answer_click");
    // the events-probe iframe's batch was accepted (its contentWindow matched)
    const third = list.children[2] as FakeNode;
    expect(third.attrs.get("data-event-type")).toBe("answer_change");
    // the foreign-window message never injected a row
    const types = list.children.map((c) => (c as FakeNode).attrs.get("data-event-type"));
    expect(types).not.toContain("spoofed");
    // clear resets the panel (runPreview calls this on every refresh)
    runInNewContext("clearEventsList();", sandbox);
    expect(list.children).toHaveLength(0);
  });

  it("the island wires the panel: message listener + runtime request keys + the events-panel SSR hooks", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toContain("data-studio-events-panel");
    expect(html).toContain("data-studio-events-list");
    expect(html).toContain("data-studio-events-clear");
    expect(html).toContain('sandbox="allow-scripts"');
    const island = studioIsland(html);
    expect(island).toContain("window.addEventListener('message', onPreviewMessage)");
    expect(island).toContain("runtime: true");
    expect(island).toContain("events_html");
  });
});

// ---------------------------------------------------------------------------
// §8.8 field-level Google-Maps config (E6; Q5 browser Places leg only):
// SSR panel + EXECUTED collectors (exact runtime keys) + chips + banner + the
// preset seam. The runtime-reader cross-check over the SAME emission literals
// (MAPS_EMITTED_*) lives in test/leadgen-runtime-hydration.test.ts ("§8.8
// studio emissions") — the DOM-lib typecheck program (see import note above).
// ---------------------------------------------------------------------------

const MAPS_CONTENT = {
  components: [
    // AddressAutocompleteQuestion produces `object` — answer_type left
    // implicit (the catalog fallback) like the studio's own makeNode.
    { type: "AddressAutocompleteQuestion", question_id: "q_addr", internal_field: "address_line" },
    { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", answer_type: "string" },
    { type: "FreeTextQuestion", question_id: "q_city", internal_field: "city", answer_type: "string" },
    { type: "FreeTextQuestion", question_id: "q_state", internal_field: "state_field", answer_type: "string" },
  ],
};

// The EXACT §8.8 emissions the inspector writes (runtime/maps.ts
// parseMapsConfig flat authoring keys). MIRRORED VERBATIM by the hydration
// suite's "§8.8 studio emissions" cross-check — keep both in lockstep.
const MAPS_EMITTED_ADDRESS = {
  enable_autocomplete: true,
  validate_full_address: true,
  normalize_address_line: true,
  autofill_state: "state_field",
  autofill_city: "city",
  autofill_zip: "zip",
};
const MAPS_EMITTED_ZIP = {
  validate_zip: true,
  autofill_city: "city",
  autofill_state: "state_field",
  enable_autocomplete: true,
};
const MAPS_EMITTED_ZIP_VALIDATE_ONLY = { validate_zip: true, enable_autocomplete: true };

interface MapsControlStub {
  checked?: boolean;
  value?: string;
  getAttribute?: (k: string) => string | null;
}

interface MapsBannerStub {
  hidden: boolean;
  attrs: Record<string, string>;
  getAttribute(k: string): string | null;
}

function mapsBannerStub(keyConfigured: boolean): MapsBannerStub {
  return {
    hidden: true,
    attrs: { "data-maps-key-configured": keyConfigured ? "true" : "false" },
    getAttribute(k: string) {
      return this.attrs[k] ?? null;
    },
  };
}

// A document stub that serves ONLY the §8.8 selectors the Maps collectors +
// banner renderer touch — every control value rides the mutable `controls`
// record so a test can flip toggles between collectMapsConfig runs.
function mapsDocStub(
  controls: Record<string, MapsControlStub>,
  banner?: MapsBannerStub,
): Record<string, unknown> {
  return {
    getElementById() {
      return null;
    },
    querySelector(sel: string) {
      if (sel === "[data-studio-maps-banner]") return banner ?? null;
      const m = /^\[data-maps-(flag|fill)="([^"]+)"\]$/.exec(sel);
      return m ? (controls[`${m[1]}:${m[2]}`] ?? null) : null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

describeDb("section studio — §8.8 field-level Maps config (E6, browser Places leg)", () => {
  it("SSR: Maps inspector tab + controls carry the EXACT runtime keys; the meta blob marks address/zip modes; the legacy toggle notes per-field wins", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toContain('data-studio-inspector-tab="maps"');
    expect(html).toContain('data-studio-panel="maps"');
    // control hooks = the runtime parseMapsConfig flat authoring keys, exactly
    for (const flag of ["enable_autocomplete", "validate_full_address", "validate_zip", "normalize_address_line"]) {
      expect(html, `flag ${flag}`).toContain(`data-maps-flag="${flag}"`);
    }
    for (const fill of ["autofill_state", "autofill_city", "autofill_zip"]) {
      expect(html, `fill ${fill}`).toContain(`data-maps-fill="${fill}"`);
    }
    // mode gating wrappers for the island (address-only / zip-only / shared)
    for (const mode of ["address", "zip", "both"]) {
      expect(html, `mode ${mode}`).toContain(`data-maps-mode="${mode}"`);
    }
    // the studio meta blob drives the tab + panel gating island-side
    const meta = extractJsonBlob(html, "lg-studio-meta");
    const types = meta["types"] as Record<string, Record<string, unknown>>;
    expect(types["AddressAutocompleteQuestion"]!["maps"]).toBe("address");
    expect(types["ZIPInputQuestion"]!["maps"]).toBe("zip");
    expect(types["TwoButtonYesNo"]!["maps"]).toBeNull();
    // §8.8: the legacy global checkbox STAYS, with per-field-wins copy
    expect(html).toContain('id="lg-address-validation"');
    expect(html).toContain("data-maps-legacy-note");
    const legacyNote = /<span class="lg-maps-note" data-maps-legacy-note>([^<]+)<\/span>/.exec(html);
    expect(legacyNote, "legacy note present").not.toBeNull();
    expect(legacyNote![1]).toContain("WINS");
  });

  it("SSR: the key-missing banner ships HIDDEN with the exact no-op contract copy + the key state attribute (no key in the test env)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const banner = /<p class="studio-maps-banner"[^>]*>([^<]*)<\/p>/.exec(html);
    expect(banner, "banner present").not.toBeNull();
    expect(banner![0]).toContain("data-studio-maps-banner");
    expect(banner![0]).toContain('data-maps-key-configured="false"');
    expect(banner![0]).toContain(" hidden");
    expect(banner![0]).toContain('role="status"');
    // the §8.8 contract copy, verbatim
    expect(banner![1]).toContain("Autocomplete/validation will no-op; manual entry still works");
  });

  it("EXECUTED: address collectors write EXACTLY the runtime keys (deep-equal + parseMapsConfig cross-check); clearing deletes props.maps", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const controls: Record<string, MapsControlStub> = {
      "flag:enable_autocomplete": { checked: true },
      "flag:validate_full_address": { checked: true },
      "flag:normalize_address_line": { checked: true },
      "fill:autofill_state": { value: "state_field" },
      "fill:autofill_city": { value: "city" },
      "fill:autofill_zip": { value: "zip" },
    };
    const probe = studioProbe(html, MAPS_CONTENT, mapsDocStub(controls));
    probe.sandbox.selectedQuestionId = "q_addr";
    probe.run("collectMapsConfig()");
    const node = probe.run("findRef('q_addr').node") as { props?: Record<string, unknown> };
    // the EXACT §8.8 authoring keys — nothing more, nothing less. The
    // runtime-reader decode of THIS literal (parseMapsConfig → wired config)
    // is pinned in leadgen-runtime-hydration.test.ts "§8.8 studio emissions".
    expect(node.props?.["maps"]).toEqual(MAPS_EMITTED_ADDRESS);
    // the mutated tree stays valid for the REAL server validator
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);

    // unchecking everything + clearing the pickers deletes props.maps — and
    // the (otherwise-empty) props object itself: the node is CLEAN again
    for (const key of Object.keys(controls)) {
      if (controls[key]!.checked !== undefined) controls[key]!.checked = false;
      if (controls[key]!.value !== undefined) controls[key]!.value = "";
    }
    probe.run("collectMapsConfig()");
    const cleared = probe.run("findRef('q_addr').node") as Record<string, unknown>;
    expect(cleared["props"]).toBeUndefined();
  });

  it("EXECUTED: ZIP collectors emit the zip keys + the enable_autocomplete wiring gate; address-only keys never leak into a zip config", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const controls: Record<string, MapsControlStub> = {
      "flag:validate_zip": { checked: true },
      "fill:autofill_city": { value: "city" },
      "fill:autofill_state": { value: "state_field" },
      // address-only controls LEFT CHECKED on purpose: the zip mode must
      // never read them (per-mode key tables, not whatever the DOM holds)
      "flag:enable_autocomplete": { checked: true },
      "flag:validate_full_address": { checked: true },
      "flag:normalize_address_line": { checked: true },
      "fill:autofill_zip": { value: "zip" },
    };
    const probe = studioProbe(html, MAPS_CONTENT, mapsDocStub(controls));
    probe.sandbox.selectedQuestionId = "q_zip";
    probe.run("collectMapsConfig()");
    const node = probe.run("findRef('q_zip').node") as { props?: Record<string, unknown> };
    // §8.8 zip keys + the wiring gate: the runtime's initMapsFields attaches
    // Places ONLY when autocomplete is enabled, and zip fields have no
    // separate autocomplete toggle — the collector rides it automatically.
    // (runtime decode of THIS literal: hydration suite "§8.8 studio emissions")
    expect(node.props?.["maps"]).toEqual(MAPS_EMITTED_ZIP);
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
    // a validate-only zip config still carries the gate; no fills
    controls["fill:autofill_city"]!.value = "";
    controls["fill:autofill_state"]!.value = "";
    probe.run("collectMapsConfig()");
    const validateOnly = probe.run("findRef('q_zip').node") as { props?: Record<string, unknown> };
    expect(validateOnly.props?.["maps"]).toEqual(MAPS_EMITTED_ZIP_VALIDATE_ONLY);
  });

  it("EXECUTED: chip labels derive from the config's autofill keys in the runtime link order (flat AND nested-fills legacy shape)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const probe = studioProbe(html, MAPS_CONTENT);
    // flat §8.8 keys (as the collectors write them) — order street,city,state,zip
    probe.run("findRef('q_zip').node.props = { maps: { validate_zip: true, autofill_city: 'city', autofill_state: 'state_field', enable_autocomplete: true } }");
    expect(probe.run("mapsFillLabels(findRef('q_zip').node)")).toEqual(["city", "state"]);
    probe.run("findRef('q_addr').node.props = { maps: { autofill_zip: 'zip', autofill_city: 'city' } }");
    expect(probe.run("mapsFillLabels(findRef('q_addr').node)")).toEqual(["city", "zip"]);
    // the nested `fills` spelling parseMapsConfig also accepts
    probe.run("findRef('q_addr').node.props = { maps: { fills: { state: 'state_field' } } }");
    expect(probe.run("mapsFillLabels(findRef('q_addr').node)")).toEqual(["state"]);
    // nodeMapsEnabled: {} config → nothing on; legacy compat spellings count
    probe.run("findRef('q_addr').node.props = { maps: {} }");
    expect(probe.run("nodeMapsEnabled(findRef('q_addr').node)")).toBe(false);
    probe.run("findRef('q_addr').node.props = { maps: { validate: true } }");
    expect(probe.run("nodeMapsEnabled(findRef('q_addr').node)")).toBe(true);
    probe.run("findRef('q_addr').node.props = {}");
    expect(probe.run("nodeMapsEnabled(findRef('q_addr').node)")).toBe(false);
  });

  it("EXECUTED: the key-missing banner shows ONLY for enabled-config + missing key (key present → hidden; nothing enabled → hidden)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const banner = mapsBannerStub(false);
    const probe = studioProbe(html, MAPS_CONTENT, mapsDocStub({}, banner));
    // no Maps-enabled component → hidden even without a key
    probe.run("renderMapsBanner()");
    expect(banner.hidden).toBe(true);
    // a Maps-enabled component + missing key → SHOWN
    probe.run("findRef('q_zip').node.props = { maps: { validate_zip: true, enable_autocomplete: true } }");
    probe.run("renderMapsBanner()");
    expect(banner.hidden).toBe(false);
    // key configured → hidden regardless of config
    banner.attrs["data-maps-key-configured"] = "true";
    probe.run("renderMapsBanner()");
    expect(banner.hidden).toBe(true);
  });

  it("round-trip: props.maps → content JSON → REAL validator clean → renderComponent emits data-lg-maps with the exact config (the preset seam)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const controls: Record<string, MapsControlStub> = {
      "flag:validate_zip": { checked: true },
      "fill:autofill_city": { value: "city" },
      "fill:autofill_state": { value: "state_field" },
    };
    const probe = studioProbe(html, MAPS_CONTENT, mapsDocStub(controls));
    probe.sandbox.selectedQuestionId = "q_zip";
    probe.run("collectMapsConfig()");
    // serialize exactly like the save path (collectSection JSON.stringifys
    // state.content), re-parse, and run the REAL server validator
    const roundTripped = JSON.parse(JSON.stringify(probe.sandbox.state.content)) as {
      components: LeadgenComponentNode[];
    };
    expect(validateSectionContent(roundTripped).errors).toEqual([]);
    const zipNode = flattenComponents(roundTripped.components).find((n) => n.question_id === "q_zip");
    expect(zipNode, "zip node survives the round trip").toBeDefined();
    expect(zipNode!.props?.["maps"]).toEqual(MAPS_EMITTED_ZIP);
    // …and the REAL preset renderer serializes it VERBATIM into data-lg-maps
    const rendered = renderComponent(zipNode!, defaultFunnelDesign);
    const attr = /data-lg-maps="([^"]*)"/.exec(rendered);
    expect(attr, "data-lg-maps attribute present").not.toBeNull();
    const decoded = attr![1]!
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    // the attribute value IS the config, byte-faithful after entity decode —
    // exactly what the runtime reader receives (its decode of THIS literal is
    // pinned in the hydration suite's "§8.8 studio emissions" cross-check)
    expect(JSON.parse(decoded)).toEqual(MAPS_EMITTED_ZIP);
    expect(decoded).toBe(JSON.stringify(zipNode!.props?.["maps"]));
    // the address twin: an UNCONFIGURED address node keeps the "{}" compat
    // fallback (runtime defaults; graceful no-op)
    const addrNode = flattenComponents(roundTripped.components).find((n) => n.question_id === "q_addr");
    expect(renderComponent(addrNode!, defaultFunnelDesign)).toContain('data-lg-maps="{}"');
  });
});

// ===========================================================================
// P4 defect fixes — §9.2/§14.9 static sim documents · B9 §6.4 choiceDisplay
// order-independence · §8.1/E6 events-panel layout hygiene · §8.5/§8.6
// TrustBar/LogoStrip/StepIndicator authoring (the §8.11 gaps)
// ===========================================================================

const STATIC_SIM_DEP_CONTENT = {
  components: [
    { type: "TwoButtonYesNo", question_id: "q1", internal_field: "currently_insured", answer_type: "boolean" },
    {
      type: "DropdownQuestion",
      question_id: "q2",
      internal_field: "insurer",
      answer_type: "enum",
      choices: [{ label: "Acme", value: "acme", analytics_id: "i_acme" }],
      conditional: { when: "currently_insured", op: "eq", value: true },
    },
  ],
};

describeDb("P4 fix — §9.2/§14.9 NON-default sims are STATIC documents (no runtime re-hide)", () => {
  it("sim≠default + runtime:true → preview.static_html: the shell-shaped srcdoc WITHOUT any script (data-lg-ready preset; the satisfied reveal STAYS); events_html keeps the runtime", async () => {
    const { env } = newHarness();
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: JSON.stringify(STATIC_SIM_DEP_CONTENT),
        viewport: "desktop",
        runtime: true,
        sim: { state: "dependency", answers: { currently_insured: true } },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { preview: Record<string, unknown> };

    const staticDoc = String(body.preview["static_html"]);
    // a COMPLETE shell-shaped document…
    expect(staticDoc.startsWith("<!doctype html>")).toBe(true);
    expect(staticDoc).toContain('id="lg-funnel-root"');
    expect(staticDoc).toContain("data-lg-mount");
    expect(staticDoc).toContain("data-lg-section");
    // …that is READY by construction (nothing hydrates a static still)…
    expect(staticDoc).toContain('data-lg-ready="1"');
    // …and carries NO script whatsoever — no runtime boot can re-apply
    // dependency visibility over an empty answer store (§14.9 reveal defect)
    expect(staticDoc).not.toContain("<script");
    // the SERVER-revealed dependency target is IN the static markup
    expect(staticDoc).toContain('data-lg-question="q2"');

    // the events panel document is SEPARATE and keeps its runtime (§9.1)
    const eventsDoc = String(body.preview["events_html"]);
    expect(eventsDoc).toContain('id="lg-config"');
    expect(eventsDoc).toContain('<script data-lg-runtime-version="');
    expect(eventsDoc).toContain(LEADGEN_RUNTIME_JS);
    // events_html root does NOT pre-claim readiness — the engine sets it
    // (markup-scoped: the inlined bundle text carries the attribute name)
    const eventsMarkup = eventsDoc.slice(0, eventsDoc.indexOf('id="lg-config"'));
    expect(eventsMarkup).not.toContain('data-lg-ready="1"');

    // unmet answers → the dependent leaf is NOT in the static markup
    const unmet = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: JSON.stringify(STATIC_SIM_DEP_CONTENT),
        viewport: "desktop",
        runtime: true,
        sim: { state: "dependency", answers: { currently_insured: false } },
      }),
      env,
    );
    const unmetBody = (await unmet.json()) as { preview: Record<string, unknown> };
    expect(String(unmetBody.preview["static_html"])).not.toContain('data-lg-question="q2"');
  });

  it("default sim keeps FULL hydration (no static_html; events_html IS the main document); non-runtime bodies gain nothing", async () => {
    const { env } = newHarness();
    const dflt = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: JSON.stringify(STATIC_SIM_DEP_CONTENT),
        viewport: "desktop",
        runtime: true,
        sim: { state: "default" },
      }),
      env,
    );
    const dfltBody = (await dflt.json()) as { preview: Record<string, unknown> };
    expect("static_html" in dfltBody.preview).toBe(false);
    expect(String(dfltBody.preview["events_html"])).toContain('<script data-lg-runtime-version="');

    // a sim WITHOUT the runtime flag stays the legacy shape (no new keys)
    const plain = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: JSON.stringify(STATIC_SIM_DEP_CONTENT),
        sim: { state: "dependency", answers: { currently_insured: true } },
      }),
      env,
    );
    const plainBody = (await plain.json()) as { preview: Record<string, unknown> };
    expect("static_html" in plainBody.preview).toBe(false);
    expect("events_html" in plainBody.preview).toBe(false);
  });

  it("the island routes the documents: static_html → main frame, events_html → the hidden probe frame (SSR probe iframe + wiring present)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // the SSR probe frame next to the main preview frame (sandboxed, hidden)
    expect(html).toContain('id="lg-events-probe-frame"');
    expect(html).toMatch(/<iframe id="lg-events-probe-frame"[^>]*sandbox="allow-scripts"[^>]*aria-hidden="true"/);
    expect(html).toContain(".lg-events-probe-frame{position:absolute");
    const island = studioIsland(html);
    // the srcdoc routing: static doc wins the main frame; the probe frame
    // carries the runtime events document; default parks the probe
    expect(island).toContain("res.body.preview.static_html");
    expect(island).toContain("getElementById('lg-events-probe-frame')");
    expect(island).toContain("probe.setAttribute('srcdoc', eventsDoc)");
    expect(island).toContain("probe.removeAttribute('srcdoc')");
  });
});

describeDb("P4 fix — B9 §6.4 choiceDisplay-only edits persist (EXECUTED wiring probe)", () => {
  interface ListenerEl {
    checked?: boolean;
    value?: string;
    type?: string;
    listeners: Record<string, () => void>;
    addEventListener(ev: string, fn: () => void): void;
    getAttribute?(k: string): string | null;
  }
  function listenerEl(init: Partial<ListenerEl>): ListenerEl {
    return {
      listeners: {},
      addEventListener(ev, fn) {
        this.listeners[ev] = fn;
      },
      ...init,
    } as ListenerEl;
  }

  it("the ONLY edit being the Other-group toggle/label still lands in the model (the registered listener runs the SAME collectChoices path)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // the island WIRES the three [data-choicedisplay] controls at boot
    expect(island).toContain("function wireChoiceDisplayControls(");
    expect(island).toContain("wireChoiceDisplayControls();");

    const CHOICES_MODEL = {
      components: [
        {
          type: "ButtonAnswerGroup",
          question_id: "q_make",
          internal_field: "car_make",
          answer_type: "enum",
          choices: [
            { label: "Toyota", value: "toyota", analytics_id: "c_toyota" },
            { label: "Honda", value: "honda", analytics_id: "c_honda" },
          ],
        },
      ],
    };
    // DOM stubs mirroring the served inspector: two choice ROWS (untouched by
    // the operator) + the three group controls
    const rowEl = (fields: Record<string, string>) => ({
      querySelectorAll(sel: string) {
        return sel === "[data-choice-field]"
          ? Object.entries(fields).map(([f, v]) => ({ getAttribute: () => f, value: v }))
          : [];
      },
      querySelector(sel: string) {
        return sel === "[data-choice-main]" ? { checked: false } : null;
      },
    });
    const rows = [
      rowEl({ label: "Toyota", value: "toyota", analytics_id: "c_toyota" }),
      rowEl({ label: "Honda", value: "honda", analytics_id: "c_honda" }),
    ];
    const container = {
      querySelectorAll(sel: string) {
        return sel === "[data-choice-row]" ? rows : [];
      },
    };
    const enabledCb = listenerEl({ checked: false, type: "checkbox" });
    const labelInput = listenerEl({ value: "", type: "text" });
    const searchCb = listenerEl({ checked: false, type: "checkbox" });
    const docStub = {
      getElementById() {
        return null;
      },
      querySelector(sel: string) {
        if (sel === "[data-inspector-choices]") return container;
        if (sel === '[data-choicedisplay="otherGroupEnabled"]') return enabledCb;
        if (sel === '[data-choicedisplay="otherGroupLabel"]') return labelInput;
        if (sel === '[data-choicedisplay="searchableOther"]') return searchCb;
        return null;
      },
      querySelectorAll(sel: string) {
        return sel === "[data-choicedisplay]" ? [enabledCb, labelInput, searchCb] : [];
      },
    };
    const probe = studioProbe(html, CHOICES_MODEL, docStub as unknown as Record<string, unknown>);
    // add the DOM-side collectors the model core doesn't slice by default
    probe.run(
      [
        sliceIslandFunction(island, "choiceContainer"),
        sliceIslandFunction(island, "collectChoiceDisplay"),
        sliceIslandFunction(island, "collectChoices"),
        sliceIslandFunction(island, "wireChoiceDisplayControls"),
      ].join("\n"),
    );
    probe.sandbox.selectedQuestionId = "q_make";
    probe.run("wireChoiceDisplayControls()");
    // all three controls got BOTH events, bound to collectChoices
    for (const el of [enabledCb, labelInput, searchCb]) {
      expect(typeof el.listeners["change"]).toBe("function");
      expect(typeof el.listeners["input"]).toBe("function");
    }

    // the operator's ONLY action: tick "Enable Other group" → change event
    enabledCb.checked = true;
    (enabledCb.listeners["change"] as () => void)();
    let node = probe.run("findRef('q_make').node") as Record<string, unknown>;
    expect(node["choiceDisplay"], "the toggle alone reached the model").toEqual({ otherGroupEnabled: true });
    // the untouched rows survived the collect (read from the DOM rows)
    expect((node["choices"] as Array<Record<string, unknown>>).map((c) => c["value"])).toEqual([
      "toyota",
      "honda",
    ]);

    // a label-only follow-up edit rides the input event the same way
    labelInput.value = "Other brands";
    (labelInput.listeners["input"] as () => void)();
    node = probe.run("findRef('q_make').node") as Record<string, unknown>;
    expect(node["choiceDisplay"]).toEqual({ otherGroupEnabled: true, otherGroupLabel: "Other brands" });

    // the mutated model is server-valid (choiceDisplay mirror rules)
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
  });
});

describeDb("P4 fix — §8.1/E6 events-panel layout hygiene (CSS containment pins)", () => {
  it("the studio styles break compact-JSON event lines and let .admin-main shrink (no min-content stretch past the viewport)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // the unbreakable-line fix on the event list items
    expect(html).toContain(".studio-events-list li{padding:1px 0;overflow-wrap:anywhere;word-break:break-word}");
    // the flex chain: layout.ts .admin-main{flex:1} needs min-width:0 to stop
    // the intrinsic min-content width of the JSON lines propagating up
    expect(html).toContain(".admin-main{min-width:0}");
  });
});

// ---------------------------------------------------------------------------
// P4 authoring gaps — §8.5/§8.6 TrustBar items+layout · LogoStrip logos ·
// StepIndicator steps/current (SSR controls + EXECUTED collect + save seam)
// ---------------------------------------------------------------------------

const P4_GAPS_CONTENT = {
  components: [
    { type: "TrustBar", question_id: "q_trust" },
    { type: "LogoStrip", question_id: "q_logos" },
    { type: "StepIndicator", question_id: "q_steps" },
  ],
};

// A host-side container-prop input stub collectContainerProp can consume.
function propInput(prop: string, kind: string, value: string, type = "text"): Record<string, unknown> {
  return {
    type,
    value,
    getAttribute(k: string): string | null {
      if (k === "data-container-prop") return prop;
      if (k === "data-container-kind") return kind;
      return null;
    },
  };
}

describeDb("P4 authoring gaps — TrustBar/LogoStrip/StepIndicator inspectors", () => {
  it("SSR: the three inspector groups render with the §8.5-idiom controls; the meta blob + availableTabsFor expose the Layout tab for them", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);

    // TrustBar: items line-editor (icon|text) + layout enum (horizontal|stacked)
    const trustGroup = html.slice(
      html.indexOf('data-container-group="TrustBar"'),
      html.indexOf('data-container-group="LogoStrip"'),
    );
    expect(trustGroup).toContain('data-container-prop="items"');
    expect(trustGroup).toContain('data-container-kind="lines"');
    expect(trustGroup).toContain('data-container-prop="layout"');
    expect(trustGroup).toContain('<option value="horizontal">');
    expect(trustGroup).toContain('<option value="stacked">');
    // LogoStrip: logos line-editor (mediaId|alt)
    const logoGroup = html.slice(
      html.indexOf('data-container-group="LogoStrip"'),
      html.indexOf('data-container-group="StepIndicator"'),
    );
    expect(logoGroup).toContain('data-container-prop="logos"');
    expect(logoGroup).toContain('data-container-kind="lines"');
    // StepIndicator: steps + current NUMERIC inputs, min 1
    const stepGroup = html.slice(html.indexOf('data-container-group="StepIndicator"'));
    expect(stepGroup).toMatch(/<input[^>]*type="number"[^>]*min="1"[^>]*data-container-prop="steps"/);
    expect(stepGroup).toMatch(/<input[^>]*type="number"[^>]*min="1"[^>]*data-container-prop="current"/);

    // the meta blob flags the three types (and only prop-bearing types)
    const meta = extractJsonBlob(html, "lg-studio-meta")["types"] as Record<string, Record<string, unknown>>;
    for (const type of ["TrustBar", "LogoStrip", "StepIndicator", "Stack", "FooterBar"]) {
      expect(meta[type]!["layout_props"], `${type}.layout_props`).toBe(true);
    }
    expect(meta["ReassuranceBadge"]!["layout_props"]).toBe(false);

    // the SLICED availableTabsFor exposes the Layout tab for the affordances
    const island = studioIsland(html);
    const probe = studioProbe(html, P4_GAPS_CONTENT);
    probe.run(sliceIslandFunction(island, "availableTabsFor"));
    expect(probe.run("availableTabsFor({ type: 'StepIndicator' })")).toContain("layout");
    expect(probe.run("availableTabsFor({ type: 'TrustBar' })")).toContain("layout");
    expect(probe.run("availableTabsFor({ type: 'ReassuranceBadge' })")).not.toContain("layout");
  });

  it("EXECUTED: TrustBar items (icon|text lines) + layout collect into the model, render via the REAL preset, and round-trip the populate leg", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, P4_GAPS_CONTENT);
    probe.run(sliceIslandFunction(island, "linesValue")); // populate leg
    probe.sandbox.selectedQuestionId = "q_trust";

    probe.sandbox["__items"] = propInput("items", "lines", "🔒|SSL secured\n★|4.8 rating\nNo spam ever", "textarea");
    probe.run("collectContainerProp(__items)");
    probe.sandbox["__layout"] = propInput("layout", "enum", "stacked", "select-one");
    probe.run("collectContainerProp(__layout)");

    const node = probe.run("findRef('q_trust').node") as { props?: Record<string, unknown> };
    expect(node.props?.["items"]).toEqual([
      { icon: "🔒", text: "SSL secured" },
      { icon: "★", text: "4.8 rating" },
      { text: "No spam ever" }, // bare line → text-only item (icon optional)
    ]);
    expect(node.props?.["layout"]).toBe("stacked");
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);

    // the REAL preset renders the authored pairs (the §8.5 shape the render reads)
    const rendered = renderComponent(node as unknown as LeadgenComponentNode, defaultFunnelDesign);
    expect(rendered).toContain("lg-trustbar-stacked");
    expect(rendered).toContain("SSL secured");
    expect(rendered).toContain("4.8 rating");
    expect((rendered.match(/lg-trustbar-item/g) ?? []).length).toBe(3);

    // populate leg: linesValue reproduces the authored lines exactly
    expect(probe.run("linesValue('items', findRef('q_trust').node.props.items)")).toBe(
      "🔒|SSL secured\n★|4.8 rating\nNo spam ever",
    );
  });

  it("EXECUTED: LogoStrip logos (mediaId|alt lines) collect, render as <img>, and round-trip", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, P4_GAPS_CONTENT);
    probe.run(sliceIslandFunction(island, "linesValue"));
    probe.sandbox.selectedQuestionId = "q_logos";

    probe.sandbox["__logos"] = propInput("logos", "lines", "media_1|Acme\nmedia_2", "textarea");
    probe.run("collectContainerProp(__logos)");
    const node = probe.run("findRef('q_logos').node") as { props?: Record<string, unknown> };
    expect(node.props?.["logos"]).toEqual([{ mediaId: "media_1", alt: "Acme" }, { mediaId: "media_2" }]);
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);

    const rendered = renderComponent(node as unknown as LeadgenComponentNode, defaultFunnelDesign);
    expect(rendered).toContain('src="media_1" alt="Acme"');
    expect(rendered).toContain('src="media_2" alt=""');
    expect(probe.run("linesValue('logos', findRef('q_logos').node.props.logos)")).toBe("media_1|Acme\nmedia_2");
    // an alt-less line without mediaId is dropped (mediaId required)
    probe.sandbox["__badLogos"] = propInput("logos", "lines", "|orphan alt", "textarea");
    probe.run("collectContainerProp(__badLogos)");
    const cleared = probe.run("findRef('q_logos').node") as { props?: Record<string, unknown> };
    expect(cleared.props?.["logos"]).toBeUndefined();
  });

  it("EXECUTED: StepIndicator steps/current numeric collect with the ≥1 + current≤steps clamps; the REAL preset renders the authored dots", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const probe = studioProbe(html, P4_GAPS_CONTENT);
    probe.sandbox.selectedQuestionId = "q_steps";

    probe.sandbox["__steps"] = propInput("steps", "int", "4", "number");
    probe.run("collectContainerProp(__steps)");
    probe.sandbox["__current"] = propInput("current", "int", "2", "number");
    probe.run("collectContainerProp(__current)");
    let node = probe.run("findRef('q_steps').node") as { props?: Record<string, unknown> };
    expect(node.props).toEqual({ steps: 4, current: 2 });
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);

    // the REAL preset renders 4 dots with the 2nd active + a11y mirrors
    const rendered = renderComponent(node as unknown as LeadgenComponentNode, defaultFunnelDesign);
    expect(rendered).toContain('aria-valuemax="4"');
    expect(rendered).toContain('aria-valuenow="2"');
    expect((rendered.match(/class="lg-step"/g) ?? []).length).toBe(4);
    expect((rendered.match(/data-active="true"/g) ?? []).length).toBe(1);

    // current > steps clamps to steps (and reflects into the input)
    const over = propInput("current", "int", "9", "number");
    probe.sandbox["__over"] = over;
    probe.run("collectContainerProp(__over)");
    node = probe.run("findRef('q_steps').node") as { props?: Record<string, unknown> };
    expect(node.props?.["current"]).toBe(4);
    expect(over["value"]).toBe("4");

    // steps below 1 clamps to 1 and drags current down with it
    probe.sandbox["__zero"] = propInput("steps", "int", "0", "number");
    probe.run("collectContainerProp(__zero)");
    node = probe.run("findRef('q_steps').node") as { props?: Record<string, unknown> };
    expect(node.props).toEqual({ steps: 1, current: 1 });

    // clearing the input deletes the prop (back to the preset default)
    probe.sandbox["__empty"] = propInput("current", "int", "", "number");
    probe.run("collectContainerProp(__empty)");
    node = probe.run("findRef('q_steps').node") as { props?: Record<string, unknown> };
    expect(node.props).toEqual({ steps: 1 });
  });

  it("save seam: the probe-authored props PATCH through the real router and read back intact (edit → model → saved props)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const probe = studioProbe(html, P4_GAPS_CONTENT);

    probe.sandbox.selectedQuestionId = "q_trust";
    probe.sandbox["__items"] = propInput("items", "lines", "🔒|SSL secured", "textarea");
    probe.run("collectContainerProp(__items)");
    probe.sandbox["__layout"] = propInput("layout", "enum", "stacked", "select-one");
    probe.run("collectContainerProp(__layout)");
    probe.sandbox.selectedQuestionId = "q_logos";
    probe.sandbox["__logos"] = propInput("logos", "lines", "media_1|Acme", "textarea");
    probe.run("collectContainerProp(__logos)");
    probe.sandbox.selectedQuestionId = "q_steps";
    probe.sandbox["__steps"] = propInput("steps", "int", "4", "number");
    probe.run("collectContainerProp(__steps)");
    probe.sandbox["__current"] = propInput("current", "int", "2", "number");
    probe.run("collectContainerProp(__current)");

    // the island save path serializes state.content — PATCH it for real
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: JSON.stringify(probe.sandbox.state.content) }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as {
      content_json: { components: Array<Record<string, unknown>> };
    };
    const byId = new Map(saved.content_json.components.map((n) => [n["question_id"], n]));
    expect(byId.get("q_trust")!["props"]).toEqual({
      items: [{ icon: "🔒", text: "SSL secured" }],
      layout: "stacked",
    });
    expect(byId.get("q_logos")!["props"]).toEqual({ logos: [{ mediaId: "media_1", alt: "Acme" }] });
    expect(byId.get("q_steps")!["props"]).toEqual({ steps: 4, current: 2 });
  });
});

// ---------------------------------------------------------------------------
// v2.5 wave-1 — §5.1 Question strip + §5.2 canonical headline binding UX
// (contract-v2.5 05; the strip and the bound canvas nodes are ONE store)
// ---------------------------------------------------------------------------

// A tiny recording DOM-element stub for EXECUTED island legs that build DOM
// (the legacy bind banner, the §5.4 frame badge). Only the members the island
// touches exist; listeners are recorded and manually invokable.
interface StubEl {
  tag: string;
  className: string;
  hidden: boolean;
  disabled: boolean;
  title: string;
  type: string;
  value: string;
  textContent: string;
  attrs: Record<string, string>;
  children: StubEl[];
  listeners: Record<string, Array<() => void>>;
  readonly firstChild: StubEl | null;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  appendChild(c: StubEl): StubEl;
  removeChild(c: StubEl): StubEl;
  insertBefore(c: StubEl, ref: StubEl | null): StubEl;
  addEventListener(k: string, f: () => void): void;
  click(): void;
  allText(): string;
}

function stubEl(tag: string, text = ""): StubEl {
  const el: StubEl = {
    tag,
    className: "",
    hidden: false,
    disabled: false,
    title: "",
    type: "",
    value: "",
    textContent: text,
    attrs: {},
    children: [],
    listeners: {},
    get firstChild(): StubEl | null {
      return el.children[0] ?? null;
    },
    setAttribute(k: string, v: string): void {
      el.attrs[k] = String(v);
    },
    getAttribute(k: string): string | null {
      return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k]! : null;
    },
    removeAttribute(k: string): void {
      delete el.attrs[k];
    },
    appendChild(c: StubEl): StubEl {
      el.children.push(c);
      return c;
    },
    removeChild(c: StubEl): StubEl {
      const i = el.children.indexOf(c);
      if (i !== -1) el.children.splice(i, 1);
      return c;
    },
    insertBefore(c: StubEl, ref: StubEl | null): StubEl {
      const i = ref === null ? el.children.length : el.children.indexOf(ref);
      el.children.splice(i === -1 ? el.children.length : i, 0, c);
      return c;
    },
    addEventListener(k: string, f: () => void): void {
      (el.listeners[k] = el.listeners[k] ?? []).push(f);
    },
    click(): void {
      for (const f of el.listeners["click"] ?? []) f();
    },
    allText(): string {
      return el.textContent + el.children.map((c) => c.allText()).join("");
    },
  };
  return el;
}

const BOUND_SEED_CONTENT = {
  components: [
    { type: "QuestionHeadline", question_id: "q_bh", bind: "section_headline" },
    { type: "Subheadline", question_id: "q_bs", bind: "section_subheadline" },
    { type: "TwoButtonYesNo", question_id: "q1", internal_field: "currently_insured", answer_type: "boolean" },
  ],
};

describeDb("v2.5 §5.1 SSR — the Question strip", () => {
  it("canonical editors + Continue-behavior radio (values unchanged) + the EXACT frame note + hidden chips + legacy Maps row", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // canonical editors, §5.1 labels (same element ids — save path unchanged)
    expect(html).toContain(">Question headline *</label>");
    expect(html).toContain('id="lg-section-headline"');
    expect(html).toContain(">Subheadline</label>");
    expect(html).toContain('id="lg-section-subheadline"');
    // Continue behavior: values unchanged, §5.1 operator labels + the note
    expect(html).toContain(">Continue behavior</legend>");
    expect(html).toContain('name="continue_mode" value="button"');
    expect(html).toContain('name="continue_mode" value="auto_advance"');
    expect(html).toContain("Visitor taps Continue (validates first)");
    expect(html).toContain("Advance automatically on answer");
    // served bytes carry the typographic apostrophes as entities
    expect(html).toContain(
      "The Continue button&#8217;s default style and position come from the Quote&#8217;s frame.",
    );
    // §5.2 hidden-in-unit chips (SSR'd hidden; island toggles)
    expect(html).toMatch(/data-bound-chip="section_headline"[^>]*hidden/);
    expect(html).toMatch(/data-bound-chip="section_subheadline"[^>]*hidden/);
    expect(html).toContain("Hidden in this question unit");
    expect(html).toMatch(/data-bound-show="section_headline"[^>]*>Show</);
    // the legacy global Maps checkbox row stays (compat)
    expect(html).toContain('id="lg-address-validation"');
    expect(html).toContain("data-maps-legacy-note");
    // the legacy-link banner slot ships hidden
    expect(html).toMatch(/data-bind-banner[^>]*hidden/);
  });

  it("/new seeds BOUND QuestionHeadline + Subheadline as nodes 1–2 in BOTH the blob and the SSR canvas; palette bind items start disabled", async () => {
    const { env } = newHarness();
    const html = await getHtml(env, "/admin/leadgen/sections/new");
    const data = extractJsonBlob(html, "lg-section-data");
    const content = data["content"] as { components: Array<Record<string, unknown>> };
    expect(content.components).toHaveLength(2);
    expect(content.components[0]).toMatchObject({ type: "QuestionHeadline", bind: "section_headline" });
    expect(content.components[1]).toMatchObject({ type: "Subheadline", bind: "section_subheadline" });
    expect(content.components[0]!["props"]).toBeUndefined(); // bound = NO props.text
    // seeded content validates CLEAN against the REAL server validator
    expect(validateSectionContent(content).errors).toEqual([]);
    // the SSR canvas rendered the bound nodes (empty text until typed)
    const start = html.indexOf('id="lg-studio-canvas-render"');
    const region = html.slice(start, html.indexOf("data-studio-canvas-empty", start));
    expect(region).toContain('data-component-type="QuestionHeadline"');
    expect(region).toContain('data-component-type="Subheadline"');
    // §5.2: while a bound node exists the palette items are disabled with the
    // EXACT tooltip
    expect(html).toMatch(
      /data-add-component="QuestionHeadline"[^>]*data-bind-disabled="true"[^>]*title="This Section already shows its headline"/,
    );
    expect(html).toMatch(
      /data-add-component="Subheadline"[^>]*data-bind-disabled="true"[^>]*title="This Section already shows its subheadline"/,
    );
  });

  it("a legacy Section (no bound nodes) serves ENABLED palette bind items and an SSR canvas that resolves bound text when present", async () => {
    const { env } = newHarness();
    const section = await createSection(env); // YESNO content — no headline nodes
    const html = await studioPage(env, section.public_id);
    expect(html).toMatch(/data-add-component="QuestionHeadline"[^>]*data-bind-disabled="false"/);
    expect(html).toMatch(/data-add-component="Subheadline"[^>]*data-bind-disabled="false"/);

    // a section WITH a bound node SSRs the canonical column text into the
    // canvas (studioCanvasDocument threads sectionCtx)
    const bound = await createSection(env, {
      section_name: "Bound",
      headline_text: "Are you currently insured?",
      content_json: JSON.stringify(BOUND_SEED_CONTENT),
    });
    const boundHtml = await studioPage(env, bound.public_id);
    const start = boundHtml.indexOf('id="lg-studio-canvas-render"');
    const region = boundHtml.slice(start, boundHtml.indexOf("data-studio-canvas-empty", start));
    expect(region).toContain('class="lg-headline"');
    expect(region).toContain("Are you currently insured?");
  });
});

describeDb("v2.5 §5.2 EXECUTED — binding model (vm-probe of the served code)", () => {
  async function boundProbe(content: unknown, docStub?: Record<string, unknown>): Promise<StudioProbe> {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    return studioProbe(html, content, docStub);
  }

  it("palette insert creates a BOUND node (no props.text); a second insert is REFUSED with the exact tooltip copy", async () => {
    const probe = await boundProbe({ components: [] });
    const head = probe.run(`addComponentAt('QuestionHeadline', null, null)`) as Record<string, unknown>;
    expect(head).toMatchObject({ type: "QuestionHeadline", bind: "section_headline" });
    expect(head["props"]).toBeUndefined();
    const sub = probe.run(`addComponentAt('Subheadline', null, null)`) as Record<string, unknown>;
    expect(sub).toMatchObject({ type: "Subheadline", bind: "section_subheadline" });
    // the pair validates CLEAN against the REAL validator (bound waives text)
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
    // §5.2: one bound node per bind value — the second insert refuses
    expect(probe.run(`addComponentAt('QuestionHeadline', null, null)`)).toBeNull();
    expect(probe.sandbox.refusals).toContain("This Section already shows its headline");
    expect(probe.run(`addComponentAt('Subheadline', null, null)`)).toBeNull();
    expect(probe.sandbox.refusals).toContain("This Section already shows its subheadline");
    expect((probe.sandbox.state.content.components as unknown[]).length).toBe(2);
  });

  it("delete bound node keeps the canonical store; [Show] re-inserts the bound node AT THE TOP (§5.2 chip semantics)", async () => {
    const probe = await boundProbe(BOUND_SEED_CONTENT);
    expect(probe.run(`findBoundNode('section_headline')`)).not.toBeNull();
    probe.run(`removeNode('q_bh')`);
    expect(probe.run(`findBoundNode('section_headline')`)).toBeNull();
    // the strip store is a Section COLUMN — deleting the node never touches it
    // (model-side: nothing in content carries the text at all)
    const reinserted = probe.run(`insertBoundNodeAtTop('section_headline')`) as Record<string, unknown>;
    expect(reinserted).toMatchObject({ type: "QuestionHeadline", bind: "section_headline" });
    const components = probe.sandbox.state.content.components as Array<Record<string, unknown>>;
    expect(components[0]!["question_id"]).toBe(reinserted["question_id"]); // AT THE TOP
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
    // idempotent: a second Show is a no-op while the bound node exists
    expect(probe.run(`insertBoundNodeAtTop('section_headline')`)).toBeNull();
  });

  it("duplicating the bound node directly is REFUSED; duplicating a container DETACHES the bound child into a text snapshot (no duplicate bind)", async () => {
    const strip = { value: "Are you insured?" };
    const docStub = {
      getElementById(id: string) {
        return id === "lg-section-headline" ? strip : null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    };
    const probe = await boundProbe(
      {
        components: [
          {
            type: "Stack",
            question_id: "s1",
            children: [{ type: "QuestionHeadline", question_id: "q_bh", bind: "section_headline" }],
          },
        ],
      },
      docStub,
    );
    // direct duplicate of the bound node → refusal
    expect(probe.run(`duplicateNode('q_bh')`)).toBeNull();
    expect(probe.sandbox.refusals.length).toBe(1);
    expect(String(probe.sandbox.refusals[0])).toContain("This Section already shows its headline");
    // container duplicate detaches the clone's bind into the CURRENT canonical text
    const clone = probe.run(`duplicateNode('s1')`) as { children: Array<Record<string, unknown>> };
    expect(clone).not.toBeNull();
    expect(clone.children[0]!["bind"]).toBeUndefined();
    expect((clone.children[0]!["props"] as Record<string, unknown>)["text"]).toBe("Are you insured?");
    // still exactly ONE bound node — the whole tree validates CLEAN
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
  });

  it("linkBoundNode: byte-equal one-click link sets bind + drops props.text; differing text lets the picked value WIN into the strip store", async () => {
    const strip = { value: "Are you insured?" };
    const docStub = {
      getElementById(id: string) {
        return id === "lg-section-headline" ? strip : null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    };
    const probe = await boundProbe(
      { components: [{ type: "QuestionHeadline", question_id: "q_h", props: { text: "Are you insured?" } }] },
      docStub,
    );
    // byte-equal case: winnerText null keeps the canonical value
    expect(probe.run(`unboundCandidate('section_headline')`)).not.toBeNull();
    expect(probe.run(`linkBoundNode('q_h', 'section_headline', null)`)).toBe(true);
    const linked = probe.run(`findRef('q_h').node`) as Record<string, unknown>;
    expect(linked["bind"]).toBe("section_headline");
    expect(linked["props"]).toBeUndefined(); // props.text dropped + cleaned up
    expect(strip.value).toBe("Are you insured?");
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);

    // differing case: the operator picked the COMPONENT's text — it wins into
    // the strip store before binding
    const strip2 = { value: "Old canonical" };
    const probe2 = await boundProbe(
      { components: [{ type: "QuestionHeadline", question_id: "q_h2", props: { text: "New from node" } }] },
      {
        getElementById(id: string) {
          return id === "lg-section-headline" ? strip2 : null;
        },
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
      },
    );
    expect(probe2.run(`linkBoundNode('q_h2', 'section_headline', 'New from node')`)).toBe(true);
    expect(strip2.value).toBe("New from node");
    const linked2 = probe2.run(`findRef('q_h2').node`) as Record<string, unknown>;
    expect(linked2["bind"]).toBe("section_headline");
    expect(linked2["props"]).toBeUndefined();
  });

  it("computeIssues waives the text requirement for BOUND nodes only (unbound headline still flagged, in operator words)", async () => {
    const probe = await boundProbe({
      components: [
        { type: "QuestionHeadline", question_id: "q_bound", bind: "section_headline" },
        { type: "QuestionHeadline", question_id: "q_free" }, // missing props.text
      ],
    });
    const issues = probe.run(`computeIssues()`) as Array<{ qid: string; message: string }>;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.qid).toBe("q_free");
    expect(issues[0]!.message).toContain("Question headline"); // label, not type id
    expect(issues[0]!.message).not.toContain("QuestionHeadline");
  });

  it("the legacy link banner renders BOTH cases from the live model and its buttons run the real link handlers", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const banner = stubEl("div");
    banner.attrs["data-bind-banner"] = "";
    const strip = { value: "Are you insured?" };
    const docStub = {
      querySelector(sel: string) {
        return sel === "[data-bind-banner]" ? banner : null;
      },
      querySelectorAll() {
        return [];
      },
      getElementById(id: string) {
        return id === "lg-section-headline" ? strip : null;
      },
      createElement(tag: string) {
        return stubEl(tag);
      },
      createTextNode(text: string) {
        return stubEl("#text", text);
      },
    };
    // BYTE-EQUAL case → the one-click link button
    const probe = studioProbe(
      html,
      { components: [{ type: "QuestionHeadline", question_id: "q_h", props: { text: "Are you insured?" } }] },
      docStub,
    );
    probe.run(sliceIslandFunction(island, "clearChildren"));
    probe.run(sliceIslandFunction(island, "bindBannerButton"));
    probe.run(sliceIslandFunction(island, "bindBannerLinkHandler"));
    probe.run(sliceIslandFunction(island, "renderBindBanner"));
    probe.run("renderBindBanner()");
    expect(banner.hidden).toBe(false);
    expect(banner.children).toHaveLength(1);
    const row = banner.children[0]!;
    expect(row.getAttribute("data-bind-banner-case")).toBe("equal");
    const linkBtn = row.children.find((c) => c.tag === "button")!;
    expect(linkBtn.textContent).toBe("Link headline to the Section’s canonical headline");
    linkBtn.click(); // the real handler → linkBoundNode
    const node = probe.run("findRef('q_h').node") as Record<string, unknown>;
    expect(node["bind"]).toBe("section_headline");
    expect(node["props"]).toBeUndefined();
    // linked → the banner re-render empties + hides itself
    probe.run("renderBindBanner()");
    expect(banner.hidden).toBe(true);
    expect(banner.children).toHaveLength(0);

    // DIFFERING case → both values shown; picking the component's text wins
    const banner2 = stubEl("div");
    const strip2 = { value: "Old canonical" };
    const probe2 = studioProbe(
      html,
      { components: [{ type: "QuestionHeadline", question_id: "q_h2", props: { text: "New from node" } }] },
      {
        querySelector(sel: string) {
          return sel === "[data-bind-banner]" ? banner2 : null;
        },
        querySelectorAll() {
          return [];
        },
        getElementById(id: string) {
          return id === "lg-section-headline" ? strip2 : null;
        },
        createElement(tag: string) {
          return stubEl(tag);
        },
        createTextNode(text: string) {
          return stubEl("#text", text);
        },
      },
    );
    probe2.run(sliceIslandFunction(island, "clearChildren"));
    probe2.run(sliceIslandFunction(island, "bindBannerButton"));
    probe2.run(sliceIslandFunction(island, "bindBannerLinkHandler"));
    probe2.run(sliceIslandFunction(island, "renderBindBanner"));
    probe2.run("renderBindBanner()");
    const row2 = banner2.children[0]!;
    expect(row2.getAttribute("data-bind-banner-case")).toBe("differs");
    // BOTH values are shown
    expect(row2.allText()).toContain("“Old canonical”");
    expect(row2.allText()).toContain("“New from node”");
    const buttons = row2.children.filter((c) => c.tag === "button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Keep the Section headline",
      "Use this component’s text",
    ]);
    buttons[1]!.click();
    expect(strip2.value).toBe("New from node");
    expect((probe2.run("findRef('q_h2').node") as Record<string, unknown>)["bind"]).toBe("section_headline");
  });

  it("SAVE seam: bound content PATCHes through the REAL router and reads back with the bind markers intact", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const probeContent = JSON.parse(JSON.stringify(BOUND_SEED_CONTENT)) as Record<string, unknown>;
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: JSON.stringify(probeContent), headline_text: "Are you currently insured?" }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as {
      content_json: { components: Array<Record<string, unknown>> };
    };
    expect(saved.content_json.components[0]).toMatchObject({ type: "QuestionHeadline", bind: "section_headline" });
    expect(saved.content_json.components[1]).toMatchObject({ type: "Subheadline", bind: "section_subheadline" });
  });
});

describeDb("v2.5 §5.2 EXECUTED — strip⇄canvas ONE store (live server seam)", () => {
  it("renderCanvasNow sends the LIVE strip values (headline/subheadline) and the server resolves them into the bound nodes' markup", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const region = { innerHTML: "" };
    let captured: { url: string; init: RequestInit } | null = null;
    const sandbox = {
      state: { content: JSON.parse(JSON.stringify(BOUND_SEED_CONTENT)) as unknown },
      canvasViewport: "desktop", // wave-2 §6.1.4 island state the fn reads
      document: {
        getElementById(id: string) {
          if (id === "lg-studio-canvas-render") return region;
          if (id === "lg-section-headline") return { value: "Live typed headline" };
          if (id === "lg-section-subheadline") return { value: "Live sub copy" };
          return null;
        },
      },
      fetch(url: string, init: RequestInit): Promise<Response> {
        captured = { url, init };
        return Promise.resolve(admin.request(url, init, env));
      },
    };
    const source = [
      "function applyCanvasDecoration() {}",
      "function updateCanvasEmpty() {}",
      sliceIslandFunction(island, "renderCanvasNow"),
      "renderCanvasNow();",
    ].join("\n");
    runInNewContext(source, sandbox);
    for (let i = 0; i < 200 && region.innerHTML === ""; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(captured, "canvas fetch executed").not.toBeNull();
    const body = JSON.parse(String(captured!.init.body)) as Record<string, unknown>;
    // §5.2: the strip store rides the render request…
    expect(body["headline"]).toBe("Live typed headline");
    expect(body["subheadline"]).toBe("Live sub copy");
    // …and the REAL preview handler resolved it into the BOUND nodes' markup
    expect(region.innerHTML).toContain("Live typed headline");
    expect(region.innerHTML).toContain("Live sub copy");
    expect(region.innerHTML).toContain('data-component-type="QuestionHeadline"');
  });

  it("the island wires the one-store views: strip inputs re-render the canvas; the inspector shared field writes the strip (handler source)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // strip → canvas: both canonical inputs schedule the (bound-resolving) re-render
    expect(island).toContain("stripHeadline.addEventListener('input', onStripInput)");
    expect(island).toContain("stripSubheadline.addEventListener('input', onStripInput)");
    expect(sliceIslandFunction(island, "onStripInput")).toContain("scheduleCanvasRender()");
    // inspector shared field → strip store (ONE store, never a second field)
    const collect = sliceIslandFunction(island, "collectBoundShared");
    expect(collect).toContain("strip.value = inputEl.value");
    expect(collect).toContain("scheduleCanvasRender()");
    expect(island).toContain("boundSharedInput.addEventListener('input', collectBoundShared)");
    // the §5.2 inspector label for the shared single field (headline + the
    // subheadline variant, island-swapped)
    expect(html).toContain("Question headline (shared with the Section header above)");
    expect(island).toContain("Subheadline (shared with the Section header above)");
    // selecting a bound node hides the generic props.text control (no second
    // text field anywhere)
    expect(island).toContain("!(isBound && k === 'text')");
    // the chip [Show] wiring re-inserts at the top and selects it
    expect(island).toContain("insertBoundNodeAtTop(this.getAttribute('data-bound-show'))");
  });
});

// ---------------------------------------------------------------------------
// v2.5 wave-1 — §5.4 canvas scope: Frame hint + the amber page-frame badge
// ---------------------------------------------------------------------------

describeDb("v2.5 §5.4 — unit-only canvas scope", () => {
  it("SSR: the Frame hint toggle + the dimmed non-interactive skeleton (presentation-only) ship in the canvas region", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toMatch(/data-studio-frame-hint[^>]*aria-pressed="false"/);
    expect(html).toContain(">Frame hint</button>");
    // the two skeleton edges ship HIDDEN, aria-hidden, and the CSS keeps them
    // dimmed + inert (never editable here)
    expect(html).toMatch(/data-studio-frame-skeleton="top"[^>]*hidden/);
    expect(html).toMatch(/data-studio-frame-skeleton="bottom"[^>]*hidden/);
    expect(html).toContain(".studio-frame-skeleton{opacity:.35;pointer-events:none");
    // the island toggle flips aria-pressed + unhides both skeletons
    const island = studioIsland(html);
    expect(island).toContain("data-studio-frame-hint");
    expect(island).toContain("skels[i].hidden = !on");
  });

  it("the meta blob carries §8.2 scope for every type; buildFrameBadge emits the amber badge with a LIVE Move affordance + Keep + the C2 consequence", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // scope rides the served meta blob (the island's badge decision input)
    const meta = extractJsonBlob(html, "lg-studio-meta")["types"] as Record<string, Record<string, unknown>>;
    expect(meta["HeaderBar"]!["scope"]).toBe("frame");
    expect(meta["ProgressBar"]!["scope"]).toBe("frame");
    expect(meta["BackgroundPanel"]!["scope"]).toBe("frame");
    expect(meta["TrustBar"]!["scope"]).toBe("both");
    expect(meta["TwoButtonYesNo"]!["scope"]).toBe("unit");

    // EXECUTED: the badge builder from the SERVED island
    const island = studioIsland(html);
    const probe = studioProbe(html, YESNO_CONTENT, {
      createElement(tag: string) {
        return stubEl(tag);
      },
      createTextNode(text: string) {
        return stubEl("#text", text);
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      getElementById() {
        return null;
      },
    });
    probe.run(sliceIslandFunction(island, "buildFrameBadge"));
    const badge = probe.run("buildFrameBadge('q_hb', 'HeaderBar')") as unknown as StubEl;
    expect(badge.className).toBe("studio-frame-badge");
    expect(badge.getAttribute("data-frame-badge")).toBe("q_hb");
    expect(badge.allText()).toContain("Page-frame element — belongs to the Quote frame ·");
    const move = badge.children.find((c) => c.getAttribute("data-frame-move") !== null)!;
    expect(move.allText()).toBe("Move to Quote frame");
    // wave 2: the Move ACTION is LIVE — no disabled attribute anymore
    expect(move.disabled, "the §5.4 Move action shipped — the button is enabled").not.toBe(true);
    expect(move.title).toContain("Quote frame");
    const keep = badge.children.find((c) => c.getAttribute("data-frame-keep") !== null)!;
    expect(keep.allText()).toBe("Keep (legacy)");
    // C2 (§5.4): the badge NAMES the activation consequence
    expect(badge.allText()).toContain(
      "While a funnel using this Section has a configured frame, activation blocks on this element unless that funnel’s Advanced legacy override allows it.",
    );
    // the decoration pass gates on scope === 'frame' + the session Keep store,
    // and the canvas click handler consumes [data-frame-keep] with NO model change
    expect(island).toContain("typeMeta(nodeType).scope === 'frame' && keptLegacyFrameNodes[qid] !== true");
    expect(island).toContain("keptLegacyFrameNodes[keepBtn.getAttribute('data-frame-keep')] = true");
  });
});

// ---------------------------------------------------------------------------
// v2.5 wave-1 — §7.1/§7.2/§7.3 scope-aware inspector
// ---------------------------------------------------------------------------

describeDb("v2.5 §7 — scope header, pills, dynamic tabs", () => {
  it("§7.1 SSR: the scope header is the inspector's FIRST element — Editing line, four pills (frame disabled here), Affects line, aria-live", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const inspectorStart = html.indexOf("data-studio-inspector");
    const headerAt = html.indexOf("data-studio-scope-header", inspectorStart);
    const tabsAt = html.indexOf('role="tablist"', inspectorStart);
    expect(headerAt).toBeGreaterThan(-1);
    expect(headerAt, "scope header precedes the tab strip").toBeLessThan(tabsAt);
    expect(html).toMatch(/data-studio-scope-header[^>]*aria-live="polite"/);
    expect(html).toContain('data-scope-editing-name>This Section (question unit)<');
    for (const pill of ["frame", "section", "component", "choice"]) {
      expect(html, `pill ${pill}`).toContain(`data-scope-pill="${pill}"`);
    }
    // §7.2: the frame is Quote-Builder-owned — its pill is inert here
    expect(html).toMatch(/data-scope-pill="frame"[^>]*disabled[^>]*title="Page-frame elements are edited in the Quote Builder"/);
    expect(html).toMatch(/data-scope-pill="section"[^>]*aria-pressed="true"/);
    expect(html).toContain("data-scope-affects");
    // the old id/type head is GONE (§7.4: no ids on a normal surface)
    expect(html).not.toContain('id="lg-inspector-target"');
    // the Section-scope helper note points at the strip
    expect(html).toContain("data-studio-section-scope-note");
    // the retarget is announced/animated + the §7.5 Advanced-open event exists
    const island = studioIsland(html);
    expect(island).toContain("studio-scope-flash");
    expect(island).toContain("window.console.info('section_advanced_opened'");
    // choice-row focus retargets the scope header (§7.5 — synchronous handler)
    expect(island).toContain("choicesPanelWrap.addEventListener('focusin'");
    expect(island).toContain("setScope('choice')");
  });

  it("§7.1 EXECUTED: the header copy patterns per scope (operator words; Section cites the usage count; choice = 'this card only')", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, YESNO_CONTENT);
    probe.run(sliceIslandFunction(island, "scopeEditingName"));
    probe.run(sliceIslandFunction(island, "scopeAffectsText"));
    probe.run("var scopeState = 'section'; var choiceScopeLabel = ''; var usageQuoteCount = null;");

    // Section scope + live usage counts
    expect(probe.run("scopeEditingName(null)")).toBe("This Section (question unit)");
    expect(probe.run("scopeAffectsText(null)")).toBe("Affects: changes apply everywhere this Section is used.");
    probe.run("usageQuoteCount = 0");
    expect(probe.run("scopeAffectsText(null)")).toBe("Affects: not used in any quote yet.");
    probe.run("usageQuoteCount = 2");
    expect(probe.run("scopeAffectsText(null)")).toBe(
      "Affects: used in 2 quotes; changes apply everywhere it’s used.",
    );

    // Component scope: the LABEL, never the type id (§7.4)
    probe.run("scopeState = 'component'");
    expect(probe.run("scopeEditingName({ type: 'ImageCardAnswerGrid' })")).toBe("Image answer cards");
    expect(probe.run("scopeAffectsText({ type: 'ImageCardAnswerGrid' })")).toBe(
      "Affects: this question unit — in every quote that uses this Section.",
    );
    // a legacy frame node names its real owner
    expect(probe.run("scopeAffectsText({ type: 'HeaderBar' })")).toContain("edited in the Quote Builder");

    // Choice scope: the §7.1 binding pattern
    probe.run("scopeState = 'choice'; choiceScopeLabel = 'Sole Proprietor';");
    expect(probe.run("scopeEditingName({ type: 'IconCardAnswerGrid' })")).toBe("Answer choice “Sole Proprietor”");
    expect(probe.run("scopeAffectsText({ type: 'IconCardAnswerGrid' })")).toBe("Affects: this card only.");
  });

  it("§7.3 EXECUTED: tabs are DYNAMIC per selection — copy-bearing Content, frame nodes lose unit tabs, containers gain Design, no inapplicable tab", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, YESNO_CONTENT);
    probe.run(sliceIslandFunction(island, "availableTabsFor"));
    const tabsOf = (expr: string): string[] => probe.run(`availableTabsFor(${expr})`) as string[];

    // nothing selected → NO tabs (Section scope edits live in the strip)
    expect(tabsOf("null")).toEqual([]);
    // a BOUND node is copy-bearing (the shared field) — Content present
    expect(tabsOf("{ type: 'QuestionHeadline', bind: 'section_headline' }")).toEqual([
      "content",
      "design",
      "dependencies",
      "advanced",
    ]);
    // answer-producing choice grid: the full §7.3 row
    expect(tabsOf("{ type: 'ImageCardAnswerGrid' }")).toEqual([
      "content",
      "choices",
      "design",
      "validation",
      "dependencies",
      "mapping",
      "advanced",
    ]);
    // ZIP input adds Maps; no Choices
    expect(tabsOf("{ type: 'ZIPInputQuestion' }")).toEqual([
      "content",
      "design",
      "validation",
      "maps",
      "dependencies",
      "mapping",
      "advanced",
    ]);
    // containers are a visual selection → Design joins their Layout tab
    expect(tabsOf("{ type: 'Stack' }")).toEqual(["layout", "design", "dependencies", "advanced"]);
    expect(tabsOf("{ type: 'Spacer' }")).toEqual(["layout", "design", "dependencies", "advanced"]);
    // a legacy PAGE-FRAME element is NOT a unit component: no design/
    // validation/dependencies/mapping — copy/structured props + Advanced only
    expect(tabsOf("{ type: 'HeaderBar' }")).toEqual(["layout", "advanced"]);
    expect(tabsOf("{ type: 'ProgressBar' }")).toEqual(["content", "advanced"]);
    // affordances with copy stay lean
    expect(tabsOf("{ type: 'ReassuranceBadge' }")).toEqual(["content", "design", "dependencies", "advanced"]);
  });

  it("§7.4: the rename consequence is inline and counted against the LIVE mapping model; Advanced owns the bind marker", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // consequence copy pattern ("will unlink N Offer mappings — they'll need
    // remapping") counted from state.answer_maps
    const warn = sliceIslandFunction(island, "showRenameWarning");
    expect(warn).toContain("state.answer_maps[mi].internal_field === oldField");
    expect(warn).toContain("will unlink ' + mapCount + ' Offer mapping");
    expect(warn).toContain("need remapping");
    // the Advanced tab carries the read-only bind marker slot
    expect(html).toContain("data-studio-bind-marker");
    expect(island).toContain("node.bind !== undefined ? node.bind : '\\u2014'");
  });
});

// ---------------------------------------------------------------------------
// v2.5 wave-1 — C6 language lint: "slide" never appears in the Section Studio
// ---------------------------------------------------------------------------

describeDb("v2.5 C6 — the Section Builder never says 'slide'", () => {
  it("the FULL served studio page (edit + new) carries no 'slide' word in any casing (SSR copy, island JS, blobs, styles)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const editHtml = await studioPage(env, section.public_id);
    const newHtml = await getHtml(env, "/admin/leadgen/sections/new");
    for (const [label, html] of [
      ["edit", editHtml],
      ["new", newHtml],
    ] as const) {
      // the WORD "slide" (slide/slides/slideshow…) is the forbidden operator
      // vocabulary. Exempt: "slider" (platform identifiers — ARIA
      // role="slider", ::-webkit-slider-thumb — and the §8.3 item name
      // "Slider") and interior identifier fragments (the shell's
      // toastSlideIn keyframes), neither of which describes a Section as a
      // "slide" to an operator. Capture ±20 chars so a violation names itself.
      const hits = [...html.matchAll(/.{0,20}\bslide(?!r)[a-z]*.{0,20}/gi)].map((m) => m[0]);
      expect(hits, `${label} page says 'slide' ${hits.length}x`).toEqual([]);
    }
    // and the sections LIST page empty-state stopped calling a Section a slide
    const listHtml = await getHtml(env, "/admin/leadgen/sections");
    expect(listHtml.toLowerCase()).not.toContain("quote slide");
  });
});

// ---------------------------------------------------------------------------
// v2.5 wave-1 — A5 image_alt samples + A6 image_fit component prop
// ---------------------------------------------------------------------------

describeDb("v2.5 A5 — image-grid samples always carry image_alt", () => {
  it("palette insert of ImageCardAnswerGrid is validator-CLEAN and SAVES through the real router (pre-fix: alt-less samples 400'd)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const probe = studioProbe(html, { components: [] });
    const node = probe.run(`addComponentAt('ImageCardAnswerGrid', null, null)`) as {
      choices: Array<Record<string, unknown>>;
    };
    expect(node).not.toBeNull();
    for (const choice of node.choices) {
      expect(typeof choice["imageMediaId"]).toBe("string");
      expect(typeof choice["image_alt"], "image_alt rides every sampled image choice").toBe("string");
      expect(choice["image_alt"]).toBe(choice["label"]);
    }
    // the REAL validator accepts the palette-authored grid…
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
    // …and the REAL save path persists it (the A5 repro: this PATCH failed
    // save validation while the samples lacked image_alt)
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: JSON.stringify(probe.sandbox.state.content) }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
  });

  it("bulk paste for an image grid carries image_alt per pasted choice; the choice-row editor PRESERVES image_alt through an edit", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const probe = studioProbe(html, { components: [] });
    const parsed = probe.run(`parseBulkChoices('Toyota|toyota\\nHonda', { choice_image: true })`) as Array<
      Record<string, unknown>
    >;
    expect(parsed).toEqual([
      { label: "Toyota", value: "toyota", analytics_id: "toyota", imageMediaId: "media_toyota", image_alt: "Toyota" },
      { label: "Honda", value: "honda", analytics_id: "honda", imageMediaId: "media_honda", image_alt: "Honda" },
    ]);
    const content = {
      components: [{ type: "ImageCardAnswerGrid", question_id: "g1", internal_field: "make", choices: parsed }],
    };
    expect(validateSectionContent(content).errors).toEqual([]);
    // the row editor lists image_alt so collectChoices (which rebuilds each
    // choice from the row inputs) can never silently drop it
    const island = studioIsland(html);
    expect(island).toContain(
      "var CHOICE_FIELDS = ['label', 'value', 'analytics_id', 'title', 'subtitle', 'badge', 'icon', 'emoji', 'imageMediaId', 'image_alt', 'aria_label', 'description']",
    );
    // the SSR thumbnail sample carries alt too (served page renders real alts)
    expect(html).toContain('alt="Yes, currently"');
  });
});

describeDb("v2.5 A6 — image_fit is a COMPONENT prop on ImageCardAnswerGrid", () => {
  const gridWith = (props: Record<string, unknown> | undefined, choices?: Array<Record<string, unknown>>): Record<string, unknown> => ({
    type: "ImageCardAnswerGrid",
    question_id: "g1",
    internal_field: "make",
    choices: choices ?? [
      { label: "Toyota", value: "toyota", analytics_id: "toyota", imageMediaId: "media_t", image_alt: "Toyota" },
    ],
    ...(props === undefined ? {} : { props }),
  });

  it("schema: cover/contain validate; any other value is a typed enum violation at the precise path", () => {
    expect(validateSectionContent({ components: [gridWith({ image_fit: "cover" })] }).errors).toEqual([]);
    expect(validateSectionContent({ components: [gridWith({ image_fit: "contain" })] }).errors).toEqual([]);
    expect(validateSectionContent({ components: [gridWith(undefined)] }).errors).toEqual([]);
    const bad = validateSectionContent({ components: [gridWith({ image_fit: "stretch" })] });
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0]).toMatchObject({
      code: "container_prop_invalid",
      path: "components[0].props.image_fit",
    });
    expect(bad.errors[0]!.message).toContain("cover|contain");
  });

  it("preset: the component prop drives object-fit for EVERY card; a legacy per-choice value stays the fallback; the component prop WINS", () => {
    const choices = [
      { label: "Toyota", value: "toyota", analytics_id: "toyota", imageMediaId: "media_t", image_alt: "Toyota" },
      { label: "Honda", value: "honda", analytics_id: "honda", imageMediaId: "media_h", image_alt: "Honda", image_fit: "contain" },
    ];
    // component prop → both cards carry it (per-choice legacy is overridden)
    const withProp = renderComponent(
      gridWith({ image_fit: "cover" }, choices) as unknown as LeadgenComponentNode,
      defaultFunnelDesign,
    );
    expect((withProp.match(/object-fit:cover/g) ?? []).length).toBe(2);
    expect(withProp).not.toContain("object-fit:contain");
    // no component prop → the per-choice defensive read still applies
    const legacyOnly = renderComponent(gridWith(undefined, choices) as unknown as LeadgenComponentNode, defaultFunnelDesign);
    expect((legacyOnly.match(/object-fit:contain/g) ?? []).length).toBe(1);
    expect(legacyOnly).not.toContain("object-fit:cover");
    // neither → today's attribute-free <img> (byte-compat pin lives in
    // leadgen-image-card-choice.test.ts)
    const bare = renderComponent(
      gridWith(undefined, [choices[0]!]) as unknown as LeadgenComponentNode,
      defaultFunnelDesign,
    );
    expect(bare).not.toContain("object-fit");
  });

  it("studio: the Design-tab control writes props.image_fit through the standard collect path, gated to the image grid, and PATCHes for real", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // SSR: the control lives on the DESIGN panel (A6 placement decision),
    // hidden until an image grid is selected
    const designPanel = html.slice(
      html.indexOf('data-studio-panel="design"'),
      html.indexOf('data-studio-panel="validation"'),
    );
    expect(designPanel).toMatch(/data-image-fit-wrap[^>]*hidden/);
    const fitSelect = selectBlock(html, "lg-inspector-image-fit");
    expect(fitSelect).toContain('data-inspector-field="image_fit"');
    expect(fitSelect).toContain('<option value="cover">');
    expect(fitSelect).toContain('<option value="contain">');
    const island = studioIsland(html);
    expect(island).toContain("node.type !== 'ImageCardAnswerGrid'");

    // EXECUTED: the sliced generic field collector stores/clears the prop
    const probe = studioProbe(html, {
      components: [gridWith(undefined)],
    });
    probe.run(sliceIslandFunction(island, "collectInspectorField"));
    probe.sandbox.selectedQuestionId = "g1";
    const fitInput = (value: string): Record<string, unknown> => ({
      type: "select-one",
      value,
      getAttribute(k: string): string | null {
        return k === "data-inspector-field" ? "image_fit" : null;
      },
    });
    probe.sandbox["__fit"] = fitInput("cover");
    probe.run("collectInspectorField(__fit)");
    let node = probe.run("findRef('g1').node") as { props?: Record<string, unknown> };
    expect(node.props?.["image_fit"]).toBe("cover");
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);

    // …and the REAL router round-trips it
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: JSON.stringify(probe.sandbox.state.content) }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as {
      content_json: { components: Array<Record<string, unknown>> };
    };
    expect((saved.content_json.components[0]!["props"] as Record<string, unknown>)["image_fit"]).toBe("cover");

    // clearing the select deletes the prop (back to the default fit)
    probe.sandbox["__clear"] = fitInput("");
    probe.run("collectInspectorField(__clear)");
    node = probe.run("findRef('g1').node") as { props?: Record<string, unknown> };
    expect(node.props?.["image_fit"]).toBeUndefined();
  });
});

describeDb("v2.5 §2.4 — 'Used in N quotes' from the REAL usage endpoint", () => {
  it("loadUsage counts DISTINCT quotes (3 variant usages across 2 quotes → 2) through GET /sections/:id/usage", async () => {
    const { sdb, env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // REAL P7 rows: two quotes; quote 1 has two variants using the Section
    sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, ?, ?, ?)").run("lgq_aaaaaaaaaaaa", "Quote A", "quote_funnel", '["life"]');
    sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, ?, ?, ?)").run("lgq_bbbbbbbbbbbb", "Quote B", "quote_funnel", '["life"]');
    sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES (?, 1, ?)").run("lgf_aaaaaaaaaaaa", "Funnel A");
    sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES (?, 2, ?)").run("lgf_bbbbbbbbbbbb", "Funnel B");
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label) VALUES (?, 1, 'A')").run("lgn_aaaaaaaaaaaa");
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label) VALUES (?, 1, 'B')").run("lgn_cccccccccccc");
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label) VALUES (?, 2, 'A')").run("lgn_bbbbbbbbbbbb");
    for (const variantId of [1, 2, 3]) {
      sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, ?, 1)").run(variantId, section.id);
    }
    // EXECUTED: the island's loadUsage against the live router
    const sandbox: Record<string, unknown> = {
      state: { public_id: section.public_id },
      usageQuoteCount: null,
      encodeURIComponent,
      fetch(url: string, init: RequestInit): Promise<Response> {
        return Promise.resolve(admin.request(url, init, env));
      },
    };
    const source = [
      "function renderScopeHeader() {}",
      sliceIslandFunction(island, "loadUsage"),
      "loadUsage();",
    ].join("\n");
    runInNewContext(source, sandbox);
    for (let i = 0; i < 200 && sandbox["usageQuoteCount"] === null; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(sandbox["usageQuoteCount"], "3 variant rows dedupe to 2 quotes").toBe(2);
  });
});

// ===========================================================================
// v2.5 WAVE 2 — §6 canvas toolbar (anatomy + matrix + undo/redo + viewport) ·
// §6.6 named presets · §7.3 C1 provider chip (DEV-55) · §9.4/§9.5 ·
// §5.3 mode 5 · §5.4 move-to-frame · §5.5 depth · §6.2 inline editing
// ===========================================================================

// In-memory KVNamespace stub — the presets endpoints ride the CACHE binding.
function kvStub(): KVNamespace {
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
  } as unknown as KVNamespace;
}

// Slice a `var NAME = [...];` array-literal statement from the island (the
// sliceIslandVar sibling for arrays — TEXT_ROLE_TYPES etc.).
function sliceIslandArray(script: string, name: string): string {
  const marker = `var ${name} = [`;
  const start = script.indexOf(marker);
  expect(start, `island array ${name} present`).toBeGreaterThan(-1);
  const end = script.indexOf("];", start);
  expect(end, `island array ${name} closes`).toBeGreaterThan(start);
  return script.slice(start, end + 2);
}

describeDb("wave 2 — §6.1 toolbar SSR anatomy (1–9)", () => {
  it("hosts breadcrumb, scope pills (ONE implementation with the inspector), undo/redo, viewport, structure/layout/text/component/choice/preset clusters — always visible", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // the toolbar block itself is NOT hidden (matrix row 1 shows the base)
    expect(html).toMatch(/<div class="studio-toolbar" data-studio-selection-toolbar data-studio-canvas-toolbar>/);
    // 1. breadcrumb lives INSIDE the toolbar now
    const toolbarAt = html.indexOf("data-studio-canvas-toolbar");
    const crumbAt = html.indexOf("data-studio-breadcrumb");
    expect(crumbAt).toBeGreaterThan(toolbarAt);
    // 2. scope pills render TWICE (toolbar + inspector) from ONE helper
    expect(html.split('data-scope-pill="section"').length - 1).toBe(2);
    // 3. undo/redo (disabled at boot — empty stacks)
    expect(html).toMatch(/data-studio-act="undo" disabled/);
    expect(html).toMatch(/data-studio-act="redo" disabled/);
    // 4. viewport toggle — Desktop 1280 / Mobile 375
    expect(html).toContain('data-canvas-viewport="desktop"');
    expect(html).toContain('data-canvas-viewport="mobile"');
    expect(html).toContain("Desktop 1280");
    expect(html).toContain("Mobile 375");
    // 5. structure cluster incl. the NEW Group→Grid/Columns + Ungroup
    for (const act of ["move-up", "move-down", "add-before", "add-after", "duplicate", "delete", "group-stack", "group-cardpanel", "group-grid", "group-columns", "ungroup"]) {
      expect(html, `structure act ${act}`).toContain(`data-studio-act="${act}"`);
    }
    // 6. layout cluster: container groups over the SAME data-container-prop
    // hooks (one collect/populate implementation, two hosts) + choice cols/gap
    expect(html).toContain('id="lg-tb-Stack-direction"');
    expect(html).toContain('id="lg-tb-CardPanel-width"');
    expect(html).toContain("data-toolbar-choice-layout");
    // 7. text cluster: type role + color role swatch
    expect(html).toContain("data-text-role");
    expect(html).toContain("data-toolbar-text-color");
    // 8. component cluster quick controls
    expect(html).toContain("data-toolbar-add-choice");
    expect(html).toContain("data-toolbar-autoadvance");
    expect(html).toContain("data-toolbar-open-validation");
    expect(html).toContain("data-toolbar-searchable");
    // choice cluster (§6.4)
    for (const act of ["image", "label", "badge", "disabled", "duplicate", "left", "right", "delete"]) {
      expect(html, `choice act ${act}`).toContain(`data-choice-act="${act}"`);
    }
    expect(html).toContain("data-choice-value-chip");
    // 9. preset menu
    expect(html).toContain("data-preset-save");
    expect(html).toContain("data-preset-apply");
    expect(html).toContain("Save selection as preset");
    // §6.7 inline problems slot
    expect(html).toContain("data-toolbar-problems");
  });
});

describeDb("wave 2 — §6.5 context matrix (executed toolbarClustersFor)", () => {
  it("visible clusters are a pure function of the selection class — the normative table row per row", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, YESNO_CONTENT);
    probe.run(
      [
        sliceIslandArray(island, "TEXT_ROLE_TYPES"),
        sliceIslandFunction(island, "isCopyNode"),
        sliceIslandFunction(island, "toolbarClustersFor"),
      ].join("\n"),
    );
    const clusters = (node: unknown, choice: boolean): string[] =>
      probe.run(`toolbarClustersFor(${JSON.stringify(node)}, ${choice})`) as string[];
    const BASE = ["breadcrumb", "pills", "undo", "viewport"];
    // Nothing selected → base row only
    expect(clusters(null, false)).toEqual(BASE);
    // Bound headline / copy node → + text · structure
    expect(clusters({ type: "QuestionHeadline", question_id: "b", bind: "section_headline" }, false)).toEqual(
      BASE.concat(["text", "structure", "preset"]),
    );
    expect(clusters({ type: "HelperText", question_id: "h" }, false)).toEqual(BASE.concat(["text", "structure", "preset"]));
    // Choice component → + structure · layout(columns/gap) · component
    expect(clusters({ type: "IconCardAnswerGrid", question_id: "g" }, false)).toEqual(
      BASE.concat(["structure", "layout", "component", "preset"]),
    );
    // Single choice → + choice cluster only
    expect(clusters({ type: "IconCardAnswerGrid", question_id: "g" }, true)).toEqual(BASE.concat(["choice"]));
    // Input component → + structure · component
    expect(clusters({ type: "FreeTextQuestion", question_id: "f", internal_field: "note" }, false)).toEqual(
      BASE.concat(["structure", "component", "preset"]),
    );
    // Local container → + structure · layout
    expect(clusters({ type: "Stack", question_id: "s" }, false)).toEqual(BASE.concat(["structure", "layout", "preset"]));
    // Legacy frame node → structure only (frame data is Quote-Builder-owned)
    expect(clusters({ type: "HeaderBar", question_id: "hb" }, false)).toEqual(BASE.concat(["structure"]));
  });
});

describeDb("wave 2 — §6.1.3 undo/redo (executed island history)", () => {
  it("≥30 steps retained (50 cap), covers add/delete/reorder/prop-edit, undo/redo round-trip, cleared on Save; ⌘Z wiring shipped", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // the REAL afterModelChange pushes history as its second act, and the
    // save-success handler clears it (§6.1.3 "cleared on Save")
    expect(island).toContain("markDirty();\n    historyPush();");
    expect(island).toContain("historyReset();");
    expect(island).toContain("if (ev.shiftKey) { historyRedo(); } else { historyUndo(); }");
    const probe = studioProbe(html, { components: [] });
    probe.run(
      [
        "var UNDO_LIMIT = 50; var undoStack = []; var redoStack = [];",
        "var lastSnapshot = JSON.stringify(state.content);",
        "function updateHistoryButtons() {}",
        "function refreshAfterHistory() {}",
        sliceIslandFunction(island, "historyPush"),
        sliceIslandFunction(island, "historyReset"),
        sliceIslandFunction(island, "restoreSnapshot"),
        sliceIslandFunction(island, "historyUndo"),
        sliceIslandFunction(island, "historyRedo"),
        // route the shipped call order: every model mutation pushes history
        "function afterModelChange() { historyPush(); }",
      ].join("\n"),
    );
    // 60 ADD mutations → the stack caps at 50 (≥30 required)
    probe.run("for (var i = 0; i < 60; i++) { addComponentAt('HelperText', null, null); }");
    expect(probe.run("undoStack.length")).toBe(50);
    expect(probe.run("state.content.components.length")).toBe(60);
    // prop-edit + reorder + delete all flow through the same history hook
    probe.run("var first = state.content.components[0]; first.props = { text: 'edited' }; afterModelChange();");
    probe.run("moveWithin(state.content.components[1].question_id, 1);");
    probe.run("removeNode(state.content.components[0].question_id);");
    expect(probe.run("state.content.components.length")).toBe(59);
    // undo the delete → 60 components again, with the edited prop intact
    expect(probe.run("historyUndo()")).toBe(true);
    expect(probe.run("state.content.components.length")).toBe(60);
    expect(probe.run("state.content.components[0].props.text")).toBe("edited");
    // undo reorder + prop edit → the makeNode default text is back
    probe.run("historyUndo(); historyUndo();");
    expect(probe.run("state.content.components[0].props.text")).toBe("New HelperText text");
    // redo replays the prop edit
    expect(probe.run("historyRedo()")).toBe(true);
    expect(probe.run("state.content.components[0].props.text")).toBe("edited");
    // a NEW mutation invalidates the redo branch
    probe.run("addComponentAt('HelperText', null, null);");
    expect(probe.run("redoStack.length")).toBe(0);
    // cleared on Save
    probe.run("historyReset();");
    expect(probe.run("undoStack.length")).toBe(0);
    expect(probe.run("historyUndo()")).toBe(false);
  });
});

describeDb("wave 2 — §6.6 named presets (KV lg-component-presets)", () => {
  it("endpoint round-trip via the live router: POST validates (curated overrides + layout props ONLY), GET lists, DELETE removes; upsert by name", async () => {
    const { env } = newHarness();
    const kvEnv = { ...env, CACHE: kvStub() };
    // invalid: unknown component type
    let res = await admin.request(
      `${API}/component-presets`,
      jsonInit("POST", { name: "Bad", component_type: "NotAType" }),
      kvEnv,
    );
    expect(res.status).toBe(400);
    // invalid: a CONTENT key can never enter a preset (§6.6 never content/choices/mapping)
    res = await admin.request(
      `${API}/component-presets`,
      jsonInit("POST", {
        name: "Bad2",
        component_type: "IconCardAnswerGrid",
        overrides: { iconColor: "accent" },
        props_subset: { text: "smuggled copy" },
      }),
      kvEnv,
    );
    expect(res.status).toBe(400);
    const badBody = (await res.json()) as { fields: Record<string, string> };
    expect(badBody.fields["props_subset.text"]).toContain("§6.6");
    // invalid: a non-curated override key
    res = await admin.request(
      `${API}/component-presets`,
      jsonInit("POST", { name: "Bad3", component_type: "IconCardAnswerGrid", overrides: { freeCss: "red" } }),
      kvEnv,
    );
    expect(res.status).toBe(400);
    // valid create
    res = await admin.request(
      `${API}/component-presets`,
      jsonInit("POST", {
        name: "Hero grid",
        component_type: "IconCardAnswerGrid",
        overrides: { iconColor: "accent", gridGap: "1rem" },
        props_subset: { columnsDesktop: 3, image_fit: "cover" },
      }),
      kvEnv,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const created = (await res.json()) as { item: Record<string, unknown>; items: unknown[] };
    expect(created.item).toMatchObject({
      name: "Hero grid",
      component_type: "IconCardAnswerGrid",
      overrides: { iconColor: "accent", gridGap: "1rem" },
      props_subset: { columnsDesktop: 3, image_fit: "cover" },
      created_by: null, // no Access header in tests — honest null, never faked
    });
    expect(typeof created.item["created_at"]).toBe("number");
    // list
    res = await admin.request(`${API}/component-presets`, {}, kvEnv);
    expect(res.status).toBe(200);
    let listed = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(listed.items).toHaveLength(1);
    // upsert by name replaces in place
    res = await admin.request(
      `${API}/component-presets`,
      jsonInit("POST", { name: "Hero grid", component_type: "IconCardAnswerGrid", overrides: { iconColor: "success" } }),
      kvEnv,
    );
    expect(res.status).toBe(201);
    res = await admin.request(`${API}/component-presets`, {}, kvEnv);
    listed = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(listed.items).toHaveLength(1);
    expect((listed.items[0]!["overrides"] as Record<string, unknown>)["iconColor"]).toBe("success");
    // delete + 404 on repeat
    res = await admin.request(`${API}/component-presets/${encodeURIComponent("Hero grid")}`, { method: "DELETE" }, kvEnv);
    expect(res.status).toBe(200);
    res = await admin.request(`${API}/component-presets/${encodeURIComponent("Hero grid")}`, { method: "DELETE" }, kvEnv);
    expect(res.status).toBe(404);
  });

  it("island: buildPresetPayload captures type + curated overrides + LAYOUT props only; applyPreset merges onto SAME-type nodes and stores the name as provenance", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const CONTENT = {
      components: [
        {
          type: "IconCardAnswerGrid",
          question_id: "g1",
          internal_field: "biz",
          choices: [{ label: "A", value: "a", analytics_id: "a", icon: "★" }],
          props: { columns: 2, gap: "s", helper_text: "keep me out of presets" },
          design_overrides: { iconColor: "accent" },
        },
        { type: "TwoButtonYesNo", question_id: "q2", internal_field: "insured" },
      ],
    };
    const probe = studioProbe(html, CONTENT);
    probe.run(
      [
        sliceIslandArray(island, "PRESET_PROP_KEYS"),
        "var presetsData = [];",
        sliceIslandFunction(island, "presetsForType"),
        sliceIslandFunction(island, "presetByName"),
        sliceIslandFunction(island, "buildPresetPayload"),
        sliceIslandFunction(island, "applyPreset"),
      ].join("\n"),
    );
    // capture: helper_text (content) is EXCLUDED; gap (layout) is captured
    const payload = probe.run("buildPresetPayload(findRef('g1').node)") as Record<string, unknown>;
    expect(payload).toEqual({
      component_type: "IconCardAnswerGrid",
      overrides: { iconColor: "accent" },
      props_subset: { gap: "s" },
    });
    // apply merges onto a same-type node + provenance name
    probe.run(
      "presetsData = [{ name: 'Hero grid', component_type: 'IconCardAnswerGrid', overrides: { iconColor: 'success', gridGap: '1rem' }, props_subset: { columnsDesktop: 3 } }];",
    );
    expect(probe.run("applyPreset(findRef('g1').node, presetByName('Hero grid'))")).toBe(true);
    const node = probe.run("findRef('g1').node") as Record<string, unknown>;
    expect(node["design_preset"]).toBe("Hero grid");
    expect(node["design_overrides"]).toEqual({ iconColor: "success", gridGap: "1rem" });
    expect((node["props"] as Record<string, unknown>)["columnsDesktop"]).toBe(3);
    // choices/content untouched by the merge
    expect((node["choices"] as unknown[]).length).toBe(1);
    expect((node["props"] as Record<string, unknown>)["helper_text"]).toBe("keep me out of presets");
    // mismatched type → refused (§6.6 "mismatched type → disabled")
    expect(probe.run("applyPreset(findRef('q2').node, presetByName('Hero grid'))")).toBe(false);
    // the mutated model stays server-valid
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
  });
});

describeDb("wave 2 — §7.3 C1 provider chip over the DEV-55 projection", () => {
  it("GET /sections/:id (and the SSR blob) carry offer_values: one row per SELECTED offer with per-field output_value_map", async () => {
    const { env } = newHarness();
    const offer = await createOfferWithSchema(env, "Ins Co A", [
      { path: "applicant.insured", type: "boolean", required: true, internal_field: "currently_insured" },
    ]);
    const section = await createSection(env);
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", {
        answer_maps: [
          {
            question_id: "q1",
            offer_id: offer.id,
            offer_payload_field_path: "applicant.insured",
            provider_expected_type: "boolean",
            output_value_map: { yes: "YES_PROVIDER_A" },
            required_for_offer: true,
          },
        ],
      }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const detail = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as Record<string, unknown>;
    const projection = detail["offer_values"] as Array<Record<string, unknown>>;
    expect(projection).toHaveLength(1);
    expect(projection[0]).toMatchObject({
      offer_id: offer.id,
      offer_public_id: offer.public_id,
      offer_name: "Ins Co A",
    });
    const fields = projection[0]!["fields"] as Record<string, { path: string; values: Record<string, unknown> | null }>;
    expect(fields["currently_insured"]).toEqual({ path: "applicant.insured", values: { yes: "YES_PROVIDER_A" } });
    // the studio SSR blob is the chip's data source (DEV-55)
    const html = await studioPage(env, section.public_id);
    const blob = extractJsonBlob(html, "lg-section-data");
    expect((blob["offer_values"] as unknown[]).length).toBe(1);
  });

  it("C1: NO provider-value control exists on the Choices surface; the chip lists ONE ROW PER SELECTED OFFER (value or 'not set') with the value-map deep link", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // the row grid's field list carries NO provider field of any spelling
    expect(island).not.toContain("provider_value");
    expect(island).not.toContain("'provider'");
    // the C1 note names the Mapping tab as the only provider-value editor
    expect(html).toContain("Provider values are set per Offer in the Mapping tab");
    // executed: the chip projection — one row PER SELECTED OFFER
    const probe = studioProbe(html, YESNO_CONTENT);
    probe.run(
      "state.offer_values = [" +
        "{ offer_id: 1, offer_public_id: 'lgo_aaa', offer_name: 'Ins Co A', fields: { currently_insured: { path: 'applicant.insured', values: { yes: 'YES_A' } } } }," +
        "{ offer_id: 2, offer_public_id: 'lgo_bbb', offer_name: 'Ins Co B', fields: {} }" +
        "];",
    );
    probe.run(
      [
        sliceIslandFunction(island, "providerChipRows"),
        sliceIslandFunction(island, "providerChipLabel"),
      ].join("\n"),
    );
    const rows = probe.run("providerChipRows('currently_insured', 'yes')") as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      { offer_name: "Ins Co A", offer_public_id: "lgo_aaa", value: "YES_A", href: "/admin/leadgen/offers/lgo_aaa/edit#payload" },
      { offer_name: "Ins Co B", offer_public_id: "lgo_bbb", value: null, href: "/admin/leadgen/offers/lgo_bbb/edit#payload" },
    ]);
    // k/n label: 1 of 2 Offers carries a value for this choice
    expect(probe.run("providerChipLabel('currently_insured', 'yes')")).toBe("Provider values: 1/2 Offers");
    // the same normalized answer maps to DIFFERENT provider values per Offer
    // (§12.2) — the chip renders each offer's own value, never a universal one
    const rowsNo = probe.run("providerChipRows('currently_insured', 'no')") as Array<Record<string, unknown>>;
    expect(rowsNo.map((r) => r["value"])).toEqual([null, null]);
  });
});

describeDb("wave 2 — §9.5 Section role-overrides drawer mode", () => {
  it("SSR: the Design-overrides drawer tab hosts the §9.5 banner (verbatim), 14 role rows, columnsDefault + gapDefault", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toContain('data-studio-drawer-tab="design"');
    expect(html).toContain('data-studio-drawer-panel="design"');
    expect(html).toContain(
      "These apply wherever this Section is used — prefer the Quote theme for funnel-wide changes.",
    );
    for (const role of ["brand_primary", "accent", "button_primary_bg", "text_muted"]) {
      expect(html, `role row ${role}`).toContain(`data-section-role="${role}"`);
    }
    expect(html.split("data-section-role=").length - 1).toBe(14);
    expect(html).toContain("data-section-columns-default");
    expect(html).toContain("data-section-gap-default");
  });

  it("EXECUTED: buildSectionOverrides emits the sparse §9.5 shape; a real PATCH persists it; the canvas re-render carries it as layer 4 (live preview proof)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // DOM stub: brand_primary re-pointed to accent + columns 3 + gap l
    const roleSel = (role: string, value: string) => ({
      getAttribute: () => role,
      value,
    });
    const docStub = {
      getElementById() {
        return null;
      },
      querySelector(sel: string) {
        if (sel === "[data-section-columns-default]") return { value: "3" };
        if (sel === "[data-section-gap-default]") return { value: "l" };
        return null;
      },
      querySelectorAll(sel: string) {
        if (sel === "[data-section-role]") {
          return [roleSel("button_primary_bg", "accent"), roleSel("text_primary", "")];
        }
        return [];
      },
    };
    const probe = studioProbe(html, YESNO_CONTENT, docStub as unknown as Record<string, unknown>);
    probe.run(sliceIslandFunction(island, "buildSectionOverrides"));
    const built = probe.run("buildSectionOverrides()") as Record<string, unknown>;
    expect(built).toEqual({ palette: { button_primary_bg: "accent" }, columnsDefault: 3, gapDefault: "l" });
    // the island save body + canvas re-render both carry the §9.5 store
    expect(island).toContain("design_overrides: state.design_overrides || null");
    expect(island).toContain("if (state.design_overrides) { canvasBody.design_overrides = state.design_overrides; }");
    // real PATCH persists the shape (the wave-C-1 validator accepts it)
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { design_overrides: built }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as Record<string, unknown>;
    expect(saved["design_overrides_json"]).toEqual(built);
    // layer-4 proof through the REAL preview endpoint the canvas calls: the
    // re-pointed button role lands in the ContinueButton markup
    const preview = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: JSON.stringify({
          components: [{ type: "ContinueButton", question_id: "c1", props: { label: "Continue" } }],
        }),
        viewport: "desktop",
        design_overrides: built,
      }),
      env,
    );
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { preview: { html: string } };
    expect(previewBody.preview.html).toContain("--lg-btn-bg:#E85D26"); // accent
  });
});

describeDb("wave 2 — §9.4 Design-tab role decorations (executed)", () => {
  it("source line speaks role LABELS (no hex text), Section re-points are named, legacy hex converts on exact match", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, YESNO_CONTENT);
    probe.run(
      [
        "var ROLE_VALUES = studioMeta.roles; var ROLE_LABELS = studioMeta.role_labels;",
        sliceIslandArray(island, "COLOR_OVERRIDE_KEYS"),
        sliceIslandVar(island, "OVERRIDE_BACKING_ROLE"),
        sliceIslandFunction(island, "isHexColor"),
        sliceIslandFunction(island, "roleLabelOf"),
        sliceIslandFunction(island, "overrideSourceText"),
        sliceIslandFunction(island, "resolvedOverrideColor"),
        sliceIslandFunction(island, "legacyHexToRole"),
      ].join("\n"),
    );
    // inherited buttonBackground names its backing role in operator words
    expect(probe.run("overrideSourceText('buttonBackground', undefined)")).toBe(
      "Inherited: Button — from the base design.",
    );
    // a Section §9.5 re-point is credited as the source
    probe.run("state.design_overrides = { palette: { button_primary_bg: 'accent' } };");
    expect(probe.run("overrideSourceText('buttonBackground', undefined)")).toBe(
      "Inherited: Accent — from this Section’s Design overrides.",
    );
    // an overridden role names itself; a legacy hex is called out — NO hex TEXT
    expect(probe.run("overrideSourceText('iconColor', 'accent')")).toBe("Accent — overridden for this component.");
    expect(probe.run("overrideSourceText('iconColor', '#123456')")).toBe("Custom color (legacy) — not a theme role.");
    expect(String(probe.run("overrideSourceText('iconColor', '#123456')"))).not.toMatch(/#[0-9a-f]{3,8}/i);
    // convert: an EXACT default-design match maps hex → role; no match → null
    const accentHex = (extractJsonBlob(html, "lg-studio-meta")["roles"] as Record<string, string>)["accent"];
    expect(probe.run(`legacyHexToRole(${JSON.stringify(accentHex)})`)).toBe("accent");
    expect(probe.run("legacyHexToRole('#00dead')")).toBe(null);
  });
});

describeDb("wave 2 — §5.3 mode 5: Preview in Quote frame", () => {
  it("SSR ships the frame picker + the EXACT empty-state copy; the island sends frame_context to the landed preview param", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    for (const hook of ["data-frame-pick-quote", "data-frame-pick-funnel", "data-frame-pick-variant", "data-frame-pick-site"]) {
      expect(html, hook).toContain(hook);
    }
    // the §5.3 empty state, verbatim
    expect(html).toContain("This Section isn’t used in any Quote yet — previewing in the default frame.");
    const island = studioIsland(html);
    expect(island).toContain("requestBody.frame_context = frameCtx;");
    // executed: frameContextBody builds the §13.4 param shape
    const probe = studioProbe(html, YESNO_CONTENT);
    probe.run(
      [
        "var framePick = { quote: 'lgq_q', funnel: '', variant: '', site: '' };",
        sliceIslandFunction(island, "frameContextBody"),
      ].join("\n"),
    );
    expect(probe.run("frameContextBody()")).toBe(null); // no funnel picked → unit only
    probe.run("framePick.funnel = 'lgf_fun';");
    expect(probe.run("frameContextBody()")).toEqual({ funnel_public_id: "lgf_fun" });
    probe.run("framePick.variant = 'lgn_var'; framePick.site = 'site-1';");
    expect(probe.run("frameContextBody()")).toEqual({
      funnel_public_id: "lgf_fun",
      variant_public_id: "lgn_var",
      site_id: "site-1",
    });
  });

  it("EXECUTED runPreview: a picked funnel rides frame_context through the REAL preview endpoint and renders the composed document", async () => {
    const { env } = newHarness();
    // a real quote (creates funnel + control variant atomically)
    const quoteRes = await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: "Life Quote", activity: "quote_funnel", verticals: ["life"] }),
      env,
    );
    expect(quoteRes.status, await quoteRes.clone().text()).toBe(201);
    const quote = (await quoteRes.json()) as { public_id: string };
    const funnels = (await (
      await admin.request(`${API}/quotes/${quote.public_id}/funnels`, {}, env)
    ).json()) as { items: Array<{ public_id: string }> };
    const funnelId = funnels.items[0]!.public_id;
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const frame = stubEl("iframe");
    const probeFrame = stubEl("iframe");
    const errEl = stubEl("p");
    errEl.hidden = true;
    let captured: { url: string; init: RequestInit } | null = null;
    const sandbox = {
      state: { content: JSON.parse(JSON.stringify(YESNO_CONTENT)), public_id: section.public_id },
      simState: "default",
      previewViewport: "desktop",
      framePick: { quote: quote.public_id, funnel: funnelId, variant: "", site: "" },
      document: {
        getElementById(id: string) {
          if (id === "lg-preview-frame") return frame;
          if (id === "lg-events-probe-frame") return probeFrame;
          if (id === "lg-preview-error") return errEl;
          return null;
        },
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
        createTextNode(t: string) {
          return { nodeType: 3, textContent: String(t) };
        },
      },
      fetch(url: string, init: RequestInit): Promise<Response> {
        captured = { url, init };
        return Promise.resolve(admin.request(url, init, env));
      },
    };
    const source = [
      sliceIslandFunction(island, "trimStr"),
      sliceIslandFunction(island, "frameContextBody"),
      sliceIslandFunction(island, "sampleAnswers"),
      sliceIslandFunction(island, "renderDependencyStatus"),
      sliceIslandFunction(island, "clearEventsList"),
      sliceIslandFunction(island, "runPreview"),
      "runPreview();",
    ].join("\n");
    runInNewContext(source, sandbox);
    for (let i = 0; i < 200 && !frame.attrs["srcdoc"] && errEl.hidden; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(captured, "preview fetch executed").not.toBeNull();
    const body = JSON.parse(String(captured!.init.body)) as Record<string, unknown>;
    expect(body["frame_context"]).toEqual({ funnel_public_id: funnelId });
    // the REAL handler composed the unit inside the funnel frame (NULL stored
    // frame → the §13.1 legacy-shell fork — still a full funnel document)
    expect(errEl.hidden, errEl.textContent).toBe(true);
    const doc = frame.attrs["srcdoc"] ?? "";
    expect(doc).toContain('data-funnel-id="' + funnelId + '"');
    expect(doc).toContain("data-lg-section");
  });
});

describeDb("wave 2 — §5.4 Move to Quote frame (LIVE semantics)", () => {
  const FRAME_NODE_CONTENT = {
    components: [
      { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
      { type: "HeaderBar", question_id: "q_hb", props: { logoMediaId: "media_logo", secure: true, secureText: "SSL secured" } },
    ],
  };

  it("equivalentFrameGroup maps every legacy frame-scope type to a group the REAL frame validator accepts", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, { components: [] });
    probe.run(sliceIslandFunction(island, "equivalentFrameGroup"));
    const cases: Array<{ node: Record<string, unknown>; expectKey: string }> = [
      { node: { type: "ProgressBar", question_id: "a", props: { mode: "percent" } }, expectKey: "progress" },
      { node: { type: "StepIndicator", question_id: "b", props: { steps: 4, current: 2 } }, expectKey: "progress" },
      { node: { type: "HeaderLogo", question_id: "c", props: { logoMediaId: "media_1" } }, expectKey: "header" },
      { node: { type: "BackButton", question_id: "d", props: { label: "Back" } }, expectKey: "back" },
      { node: { type: "DisclosureLink", question_id: "e", props: { panelHtml: "Disclosure" } }, expectKey: "disclosure" },
      { node: { type: "HeaderBar", question_id: "f", props: { logoMediaId: "m", secure: true, cta: { label: "Call", tel: "+1 555 123 4567" } } }, expectKey: "header" },
      { node: { type: "FooterBar", question_id: "g", props: { legalHtml: "Terms.", trustMessages: ["SSL"], links: [{ label: "Privacy", href: "/p" }] } }, expectKey: "footer" },
      { node: { type: "BackgroundPanel", question_id: "h", props: { gradient: "primary" } }, expectKey: "background" },
    ];
    for (const c of cases) {
      const group = probe.run(`equivalentFrameGroup(${JSON.stringify(c.node)})`) as Record<string, unknown>;
      expect(group, `${c.node["type"]} maps`).not.toBeNull();
      expect(Object.keys(group)).toContain(c.expectKey);
      // the REAL server gate: no error-severity problems
      const validation = validateFrameConfig(group);
      const errors = validation.problems.filter((pr) => pr.severity === "error");
      expect(errors, `${c.node["type"]} → ${JSON.stringify(errors)}`).toEqual([]);
    }
    // a unit component has no frame equivalent
    expect(probe.run("equivalentFrameGroup({ type: 'TwoButtonYesNo', question_id: 'x' })")).toBe(null);
    // group merge: our group's fields win; untouched stored fields survive
    probe.run(sliceIslandFunction(island, "mergeFrameGroups"));
    const merged = probe.run(
      "mergeFrameGroups({ header: { tagline: 'Keep me' }, progress: { style: 'bar' } }, { header: { enabled: true } })",
    ) as Record<string, Record<string, unknown>>;
    expect(merged["header"]).toEqual({ tagline: "Keep me", enabled: true });
    expect(merged["progress"]).toEqual({ style: "bar" });
  });

  it("single funnel: the confirm NAMES the funnel; the REAL PUT lands the group; the node is removed and PATCHed on the SAME action; cancel = no change", async () => {
    const { env } = newHarness();
    const quoteRes = await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: "Life Quote", activity: "quote_funnel", verticals: ["life"], funnel_name: "Main funnel" }),
      env,
    );
    expect(quoteRes.status).toBe(201);
    const quote = (await quoteRes.json()) as { public_id: string };
    const funnels = (await (
      await admin.request(`${API}/quotes/${quote.public_id}/funnels`, {}, env)
    ).json()) as { items: Array<{ public_id: string; funnel_name: string }> };
    const funnel = funnels.items[0]!;
    const section = await createSection(env, { content_json: JSON.stringify(FRAME_NODE_CONTENT) });
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);

    const confirms: string[] = [];
    let confirmAnswer = false;
    const fetches: string[] = [];
    const probe = studioProbe(html, FRAME_NODE_CONTENT);
    probe.sandbox["window"] = {
      confirm(msg: string) {
        confirms.push(msg);
        return confirmAnswer;
      },
    };
    probe.sandbox["dirty"] = false;
    (probe.sandbox.state as Record<string, unknown>)["public_id"] = section.public_id;
    probe.sandbox["usageRows"] = [
      { quote_public_id: quote.public_id, funnel_public_id: funnel.public_id, funnel_name: funnel.funnel_name, variant_public_id: "lgn_x" },
    ];
    probe.sandbox["fetch"] = (url: string, init?: RequestInit): Promise<Response> => {
      fetches.push(`${init?.method ?? "GET"} ${url}`);
      return Promise.resolve(admin.request(url, init ?? {}, env));
    };
    probe.run(
      [
        "function markDirty() { dirty = true; }",
        "function selectComponent() {}",
        "function showMoveNote() {}",
        "var selectedQuestionId = null;",
        sliceIslandFunction(island, "usageFunnelsOf"),
        sliceIslandFunction(island, "moveConfirmMessage"),
        sliceIslandFunction(island, "equivalentFrameGroup"),
        sliceIslandFunction(island, "mergeFrameGroups"),
        sliceIslandFunction(island, "finishMoveToFrame"),
        sliceIslandFunction(island, "doMoveToFrame"),
        sliceIslandFunction(island, "renderFunnelPicker"),
        sliceIslandFunction(island, "funnelPickBtn"),
        sliceIslandFunction(island, "startMoveToFrame"),
      ].join("\n"),
    );

    // CANCEL: the confirm precedes ANY write — nothing fetched, node kept
    probe.run("startMoveToFrame('q_hb')");
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toContain("Main funnel"); // the confirm NAMES the funnel
    expect(confirms[0]).toContain("Header bar"); // operator words, not type ids
    expect(fetches).toHaveLength(0);
    expect(probe.run("findRef('q_hb') !== null")).toBe(true);

    // CONFIRM: GET frame → PUT merged group → PATCH the section content
    confirmAnswer = true;
    probe.run("startMoveToFrame('q_hb')");
    for (let i = 0; i < 200 && fetches.length < 3; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(probe.sandbox.refusals, "no refusal on the happy path").toEqual([]);
    expect(fetches).toEqual([
      `GET /api/admin/leadgen/funnels/${funnel.public_id}/frame`,
      `PUT /api/admin/leadgen/funnels/${funnel.public_id}/frame`,
      `PATCH /api/admin/leadgen/sections/${section.public_id}`,
    ]);
    // the node left the island model…
    expect(probe.run("findRef('q_hb')")).toBe(null);
    // …the frame group LANDED for real…
    const frameRead = (await (
      await admin.request(`${API}/funnels/${funnel.public_id}/frame`, {}, env)
    ).json()) as { frame_config: Record<string, Record<string, unknown>> };
    expect(frameRead.frame_config["header"]).toMatchObject({
      enabled: true,
      logo_source: "manual",
      logo_media_id: "media_logo",
      secure_badge: { enabled: true, text: "SSL secured" },
    });
    // …and the SAME action persisted the removal (real PATCH landed)
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as Record<string, unknown>;
    const savedContent = saved["content_json"] as { components: Array<Record<string, unknown>> };
    expect(savedContent.components.map((n) => n["type"])).toEqual(["TwoButtonYesNo"]);
    // the pre-move clean state is restored (nothing else was unsaved)
    expect(probe.sandbox["dirty"]).toBe(false);
  });

  it("used-by-many: a funnel PICKER opens (no confirm yet); zero funnels: a refusal names the Quote Builder", async () => {
    const { env } = newHarness();
    const section = await createSection(env, { content_json: JSON.stringify(FRAME_NODE_CONTENT) });
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const confirms: string[] = [];
    const badge = stubEl("div") as StubEl & { querySelector(sel: string): StubEl | null };
    badge.querySelector = (sel: string): StubEl | null =>
      sel === "[data-funnel-picker]" ? (badge.children.find((c) => c.getAttribute("data-funnel-picker") !== null) ?? null) : null;
    const probe = studioProbe(html, FRAME_NODE_CONTENT, {
      createElement(tag: string) {
        return stubEl(tag);
      },
      createTextNode(text: string) {
        return stubEl("#text", text);
      },
      querySelector(sel: string) {
        return sel === '[data-frame-badge="q_hb"]' ? badge : null;
      },
      querySelectorAll() {
        return [];
      },
      getElementById() {
        return null;
      },
    });
    probe.sandbox["window"] = {
      confirm(msg: string) {
        confirms.push(msg);
        return true;
      },
    };
    probe.run(
      [
        "var usageRows = [" +
          "{ funnel_public_id: 'lgf_one', funnel_name: 'Funnel One' }," +
          "{ funnel_public_id: 'lgf_two', funnel_name: 'Funnel Two' }" +
          "];",
        sliceIslandFunction(island, "usageFunnelsOf"),
        sliceIslandFunction(island, "moveConfirmMessage"),
        "function doMoveToFrame(qid, funnel) { moved.push(funnel.public_id); }",
        "var moved = [];",
        sliceIslandFunction(island, "renderFunnelPicker"),
        sliceIslandFunction(island, "funnelPickBtn"),
        sliceIslandFunction(island, "startMoveToFrame"),
      ].join("\n"),
    );
    probe.run("startMoveToFrame('q_hb')");
    // no confirm — the PICKER renders instead, one button per funnel
    expect(confirms).toHaveLength(0);
    const picker = badge.children.find((c) => c.getAttribute("data-funnel-picker") !== null)!;
    expect(picker).toBeDefined();
    const picks = picker.children.filter((c) => c.getAttribute("data-funnel-pick") !== null);
    expect(picks.map((c) => c.getAttribute("data-funnel-pick"))).toEqual(["lgf_one", "lgf_two"]);
    // picking one routes into the confirm-gated move
    picks[1]!.click();
    expect(probe.run("moved")).toEqual(["lgf_two"]);
    // zero funnels → refusal, Quote Builder named
    probe.run("usageRows = [];");
    probe.run("startMoveToFrame('q_hb')");
    const refusals = probe.sandbox.refusals;
    expect(refusals[refusals.length - 1]).toContain("Quote Builder");
  });
});

describeDb("wave 2 — §5.5 choice depth + §6.2 inline editing + §7.3 raw JSON", () => {
  it("each §5.5 editor writes the model (title/subtitle/badge/emoji/aria_label/disabled) and persists via the REAL PATCH", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const GRID = {
      components: [
        {
          type: "ImageCardAnswerGrid",
          question_id: "g1",
          internal_field: "carrier",
          choices: [{ label: "Acme", value: "acme", analytics_id: "acme", imageMediaId: "media_a", image_alt: "Acme" }],
        },
      ],
    };
    // DOM stub: ONE row whose depth inputs carry every §5.5 field
    const rowFields: Record<string, string> = {
      label: "Acme",
      value: "acme",
      analytics_id: "acme_card",
      title: "Acme Insurance",
      subtitle: "Best rated",
      badge: "Recommended",
      emoji: "",
      icon: "",
      imageMediaId: "media_a",
      image_alt: "Acme logo",
      aria_label: "Choose Acme",
      description: "",
    };
    const row = {
      querySelectorAll(sel: string) {
        return sel === "[data-choice-field]"
          ? Object.entries(rowFields).map(([f, v]) => ({ getAttribute: () => f, value: v }))
          : [];
      },
      querySelector(sel: string) {
        if (sel === "[data-choice-main]") return { checked: false };
        if (sel === "[data-choice-disabled]") return { checked: true };
        return null;
      },
    };
    const container = {
      querySelectorAll(sel: string) {
        return sel === "[data-choice-row]" ? [row] : [];
      },
    };
    const docStub = {
      getElementById() {
        return null;
      },
      querySelector(sel: string) {
        return sel === "[data-inspector-choices]" ? container : null;
      },
      querySelectorAll() {
        return [];
      },
    };
    const probe = studioProbe(html, GRID, docStub as unknown as Record<string, unknown>);
    probe.run(
      [
        sliceIslandFunction(island, "choiceContainer"),
        sliceIslandFunction(island, "collectChoiceDisplay"),
        sliceIslandFunction(island, "collectChoices"),
      ].join("\n"),
    );
    probe.sandbox.selectedQuestionId = "g1";
    probe.run("collectChoices()");
    const node = probe.run("findRef('g1').node") as { choices: Array<Record<string, unknown>> };
    expect(node.choices[0]).toEqual({
      label: "Acme",
      value: "acme",
      analytics_id: "acme_card",
      title: "Acme Insurance",
      subtitle: "Best rated",
      badge: "Recommended",
      imageMediaId: "media_a",
      image_alt: "Acme logo",
      aria_label: "Choose Acme",
      disabled: true,
    });
    // the mutated model is server-valid AND PATCHes for real
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: JSON.stringify(probe.sandbox.state.content) }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as Record<string, unknown>;
    const savedChoice = (saved["content_json"] as { components: Array<{ choices: Array<Record<string, unknown>> }> }).components[0]!.choices[0]!;
    expect(savedChoice).toMatchObject({ title: "Acme Insurance", subtitle: "Best rated", badge: "Recommended", disabled: true, aria_label: "Choose Acme" });
    // the row grid ships the media PICKER cell + the §5.5 idiom markers
    expect(island).toContain("data-choice-media-choose");
    expect(island).toContain("openMediaPicker({ input: input, onpick: collectChoices });");
  });

  it("bulk paste accepts the §5.5 'label = value' idiom (legacy 'label|value' kept); the searchable toggle SWITCHES the dropdown type; the range note gates to sliders", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    expect(html).toContain("Bulk paste (one per line: label = value)");
    const probe = studioProbe(html, {
      components: [{ type: "DropdownQuestion", question_id: "d1", internal_field: "make", choices: [{ label: "A", value: "a", analytics_id: "a" }] }],
    });
    const parsed = probe.run(
      "parseBulkChoices('Toyota = toyota\\nHonda|honda\\nMazda', {})",
    ) as Array<Record<string, unknown>>;
    expect(parsed).toEqual([
      { label: "Toyota", value: "toyota", analytics_id: "toyota" },
      { label: "Honda", value: "honda", analytics_id: "honda" },
      { label: "Mazda", value: "mazda", analytics_id: "mazda" },
    ]);
    // §5.5: the searchable toggle is a pure TYPE swap (round-trip)
    probe.run(["function updateCanvasToolbar() {}", sliceIslandFunction(island, "toggleSearchableDropdown")].join("\n"));
    expect(probe.run("toggleSearchableDropdown(findRef('d1').node)")).toBe(true);
    expect(probe.run("findRef('d1').node.type")).toBe("SearchableDropdownQuestion");
    expect(probe.run("toggleSearchableDropdown(findRef('d1').node)")).toBe(true);
    expect(probe.run("findRef('d1').node.type")).toBe("DropdownQuestion");
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
    // §5.5 range provider-format note ships + gates island-side
    expect(html).toContain("data-range-format-note");
    expect(html).toContain("Provider output format is set per Offer in the Mapping tab");
    expect(island).toContain("node.type !== 'RangeQuestion' && node.type !== 'NumberRangeQuestion' && node.type !== 'CurrencyRangeQuestion'");
  });

  it("§6.2 inline editing: dblclick commit writes the BOUND strip store / props.text / choice labels; Advanced raw JSON is read-only until the Edit-raw confirm", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // SSR: the raw textarea ships readonly; Apply hides behind Edit raw…
    expect(html).toMatch(/<textarea id="lg-node-json"[^>]*readonly>/);
    expect(html).toMatch(/<button[^>]*id="lg-node-json-apply" hidden>/);
    expect(html).toContain("data-node-json-edit");
    // island: dblclick wiring + per-selection re-lock
    expect(island).toContain("canvasSurface.addEventListener('dblclick', function (ev) {");
    expect(island).toContain("el.setAttribute('contenteditable', 'true');");
    expect(island).toContain("rawEditArmed = false;\n    syncRawJsonMode();");
    const strip = { value: "Old headline" };
    const mirror = { value: "" };
    const docStub = {
      getElementById(id: string) {
        return id === "lg-section-headline" ? strip : null;
      },
      querySelector(sel: string) {
        return sel === "[data-bound-shared-input]" ? mirror : null;
      },
      querySelectorAll() {
        return [];
      },
    };
    const probe = studioProbe(html, BOUND_SEED_CONTENT, docStub as unknown as Record<string, unknown>);
    probe.run(
      [
        "var dirtyFlags = []; function markDirty() { dirtyFlags.push(1); }",
        "function scheduleCanvasRender() {}",
        sliceIslandFunction(island, "findChoice"),
        sliceIslandFunction(island, "inlineEditKeyFor"),
        sliceIslandFunction(island, "commitInlineText"),
        sliceIslandFunction(island, "commitInlineChoiceLabel"),
      ].join("\n"),
    );
    // the bound headline resolves to the STRIP store (one store, two views)
    expect(probe.run("inlineEditKeyFor(findRef('q_bh').node)")).toBe("bind");
    expect(probe.run("commitInlineText('q_bh', 'bind', 'Typed on canvas')")).toBe(true);
    expect(strip.value).toBe("Typed on canvas");
    expect(mirror.value).toBe("Typed on canvas"); // inspector mirror synced
    // a plain copy node writes props.text through the model
    probe.run("addComponentAt('HelperText', null, null)");
    const helperQid = probe.run("state.content.components[state.content.components.length - 1].question_id") as string;
    expect(probe.run(`inlineEditKeyFor(findRef(${JSON.stringify(helperQid)}).node)`)).toBe("text");
    probe.run(`commitInlineText(${JSON.stringify(helperQid)}, 'text', 'Helper copy')`);
    expect(probe.run(`findRef(${JSON.stringify(helperQid)}).node.props.text`)).toBe("Helper copy");
    // a choice card edits ITS label
    expect(probe.run("commitInlineChoiceLabel('q1', 'x', 'nope')")).toBe(false); // TwoButtonYesNo has no choices
    probe.run("addComponentAt('IconCardAnswerGrid', null, null)");
    const gridQid = probe.run("state.content.components[state.content.components.length - 1].question_id") as string;
    const firstValue = probe.run(`findRef(${JSON.stringify(gridQid)}).node.choices[0].value`) as string;
    expect(probe.run(`commitInlineChoiceLabel(${JSON.stringify(gridQid)}, ${JSON.stringify(firstValue)}, 'Renamed card')`)).toBe(true);
    expect(probe.run(`findRef(${JSON.stringify(gridQid)}).node.choices[0].label`)).toBe("Renamed card");
    // §6.2: width-preset snapping is pure and bounded
    probe.run(sliceIslandArray(island, "WIDTH_PRESETS"));
    probe.run(sliceIslandFunction(island, "snapWidthPreset"));
    expect(probe.run("snapWidthPreset('m', 90)")).toBe("l");
    expect(probe.run("snapWidthPreset('m', 200)")).toBe("full");
    expect(probe.run("snapWidthPreset('m', -90)")).toBe("s");
    expect(probe.run("snapWidthPreset('s', -400)")).toBe("s");
    // raw-JSON arming: confirm gates the unlock; decline keeps it read-only
    const ta = stubEl("textarea");
    ta.setAttribute("readonly", "readonly");
    const applyBtn = stubEl("button");
    applyBtn.hidden = true;
    const editBtn = stubEl("button");
    let confirmAnswer = false;
    const probe2 = studioProbe(html, YESNO_CONTENT, {
      getElementById(id: string) {
        if (id === "lg-node-json") return ta;
        if (id === "lg-node-json-apply") return applyBtn;
        if (id === "lg-node-json-edit") return editBtn;
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    } as unknown as Record<string, unknown>);
    probe2.sandbox["window"] = { confirm: () => confirmAnswer };
    probe2.run(
      [
        "var rawEditArmed = false;",
        sliceIslandFunction(island, "syncRawJsonMode"),
        sliceIslandFunction(island, "armRawEdit"),
      ].join("\n"),
    );
    expect(probe2.run("armRawEdit()")).toBe(false); // declined confirm
    expect(ta.getAttribute("readonly")).not.toBe(null);
    expect(applyBtn.hidden).toBe(true);
    confirmAnswer = true;
    expect(probe2.run("armRawEdit()")).toBe(true);
    expect(ta.getAttribute("readonly")).toBe(null);
    expect(applyBtn.hidden).toBe(false);
    expect(editBtn.hidden).toBe(true);
  });
});

describeDb("wave 2 — MultiChoiceCardGroup choice depth (A6 flag d)", () => {
  it("title/subtitle render with the iconCard token slots; a depth-less choice renders byte-identically (additive)", () => {
    const design = defaultFunnelDesign;
    const base: Record<string, unknown> = {
      type: "MultiChoiceCardGroup",
      question_id: "m1",
      internal_field: "features",
      choices: [{ label: "Alarm", value: "alarm", analytics_id: "alarm" }],
      props: { min: 1, max: 2 },
    };
    const plain = renderComponent(base as never, design);
    // §8.7 D/F: depth-less markup carries NO subtitle span and titles by label
    expect(plain).toContain('<span class="lg-card-title">Alarm</span>');
    expect(plain).not.toContain("lg-card-subtitle");
    const deep = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    (deep["choices"] as Array<Record<string, unknown>>)[0] = {
      label: "Alarm",
      value: "alarm",
      analytics_id: "alarm",
      title: "Alarm system",
      subtitle: "Monitored 24/7",
    };
    const rendered = renderComponent(deep as never, design);
    expect(rendered).toContain('<span class="lg-card-title">Alarm system</span>');
    expect(rendered).toContain('class="lg-card-desc lg-card-subtitle"');
    expect(rendered).toContain("Monitored 24/7");
    // additive: stripping the depth fields reproduces the plain bytes exactly
    (deep["choices"] as Array<Record<string, unknown>>)[0] = { label: "Alarm", value: "alarm", analytics_id: "alarm" };
    expect(renderComponent(deep as never, design)).toBe(plain);
  });
});

