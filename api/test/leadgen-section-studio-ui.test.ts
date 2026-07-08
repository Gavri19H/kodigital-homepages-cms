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
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";
import { STUDIO_LIBRARY_GROUPS } from "../src/admin/leadgen/ui-section-studio";

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

  it("the validation chip carries the server-computed issue count (0 for a valid section, 1 for /new)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toContain('data-issue-count="0"');
    const fresh = await getHtml(env, "/admin/leadgen/sections/new");
    expect(fresh).toContain('data-issue-count="1"'); // components_empty
    // the canvas empty state shows on /new only
    expect(fresh).toMatch(/data-studio-canvas-empty[^>]*>/);
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
  it("groups by intent, covers EVERY catalog type exactly once (lockstep), searchable", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);

    for (const group of ["questions", "choices", "inputs", "layout", "trust", "navigation"]) {
      expect(html, `library group ${group}`).toContain(`data-library-group="${group}"`);
    }
    for (const label of ["Questions", "Answer choices", "Inputs", "Layout", "Trust &amp; affordance", "Navigation"]) {
      expect(html, `group label ${label}`).toContain(label);
    }
    // lockstep: the grouping map covers the catalog exactly
    const grouped = STUDIO_LIBRARY_GROUPS.flatMap((g) => [...g.types]);
    expect([...grouped].sort()).toEqual([...ALL_TYPES].sort());
    // and the SERVED page places each type exactly once
    for (const type of ALL_TYPES) {
      const hits = html.split(`data-add-component="${type}"`).length - 1;
      expect(hits, `${type} placed exactly once`).toBe(1);
    }
    expect(html).toContain("data-studio-library-search");
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
    // every placeable item carries a thumb
    const thumbs = html.split("studio-thumb-scale").length - 1;
    expect(thumbs).toBeGreaterThanOrEqual(ALL_TYPES.length);
    // copy + metadata per §8.3
    expect(html).toContain("Two-button yes/no");
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

  it("§8.6 Design tab: curated token DROPDOWNS sourced from the design's slots — no free-CSS input anywhere", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    for (const key of ["iconColor", "columns", "featureColor", "rangeColor", "buttonBackground", "buttonText", "gridGap", "mobileBehavior"]) {
      expect(html).toContain(`<select id="lg-inspector-${key}"`);
    }
    // the override controls are selects ONLY (no <input data-inspector-override)
    expect(html).not.toMatch(/<input[^>]*data-inspector-override/);
    // values projected from the default design's slots
    const icon = selectBlock(html, "lg-inspector-iconColor");
    expect(icon).toContain("#1B3A5C"); // color.primary
    expect(icon).toContain("#E85D26"); // color.accent
    expect(icon).toContain('<option value="">inherit</option>');
    const gap = selectBlock(html, "lg-inspector-gridGap");
    expect(gap).toContain("0.5rem"); // spacing.sm
    const columns = selectBlock(html, "lg-inspector-columns");
    for (const v of ["2", "3", "4", "5"]) expect(columns).toContain(`<option value="${v}">`);
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
    const island = studioIsland(html);
    expect(island).toContain("setTimeout(function () { canvasTimer = null; renderCanvasNow(); }, 300)");
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

// The island's pure/model functions (no DOM) — sliced together so every
// probe runs the REAL served code, never a test re-implementation.
const MODEL_FUNCS = [
  "trimStr",
  "cloneJson",
  "newQuestionId",
  "typeMeta",
  "isContainerType",
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
] as const;

interface StudioSandbox {
  state: { content: { components: unknown[] }; answer_maps?: unknown[]; public_id?: string | null; continue_mode?: string; address_validation_enabled?: boolean };
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

  it("breadcrumb text walks the ancestor chain: CardPanel › Stack › ButtonAnswerGroup", async () => {
    const probe = await probeHarness(NESTED_CONTENT);
    expect(probe.run(`breadcrumbText('bag1')`)).toBe("CardPanel › Stack › ButtonAnswerGroup");
    expect(probe.run(`breadcrumbText('stack1')`)).toBe("CardPanel › Stack");
    expect(probe.run(`breadcrumbText('panel1')`)).toBe("CardPanel");
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

    // the OLD island's exact body shape (save-path contract preserved)
    expect(Object.keys(body).sort()).toEqual(
      ["section_name", "activity", "vertical", "headline_text", "subheadline_text", "continue_mode", "address_validation_enabled", "content_json", "answer_maps"].sort(),
    );
    expect(body["section_name"]).toBe("Studio renamed");
    expect(body["continue_mode"]).toBe("button");

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
  });
});
