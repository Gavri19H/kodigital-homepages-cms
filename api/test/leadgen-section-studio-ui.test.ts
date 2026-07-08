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

    // the OLD island's exact body shape + the ONE D2 additive key
    // (selected_offers — §8.7 explicit selection set; parseAnswerMaps already
    // consumed it server-side, so the save-path contract is preserved).
    expect(Object.keys(body).sort()).toEqual(
      ["section_name", "activity", "vertical", "headline_text", "subheadline_text", "continue_mode", "address_validation_enabled", "content_json", "answer_maps", "selected_offers"].sort(),
    );
    expect(body["section_name"]).toBe("Studio renamed");
    expect(body["continue_mode"]).toBe("button");
    expect(body["selected_offers"]).toEqual([]);

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
    expect(doc).toContain(`<script data-lg-runtime-version="1">`);
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

  it("EXECUTED island: onPreviewMessage appends ONLY lg-preview-event batches to the panel list; clearEventsList resets it", async () => {
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
    const sandbox = {
      document: {
        querySelector(sel: string) {
          return sel === "[data-studio-events-list]" ? list : null;
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
      // engine.ts previewSender) + two decoys that must be IGNORED
      "onPreviewMessage({ data: { type: 'lg-preview-event', events: [" +
        "{ event_type: 'section_view', section_public_id: 'lgs_x', section_index: 0 }," +
        "{ event_type: 'answer_click', question_key: 'insured_q' } ] } });",
      "onPreviewMessage({ data: { type: 'other-message' } });",
      "onPreviewMessage({ data: 'not-an-object' });",
    ].join("\n");
    runInNewContext(source, sandbox);
    expect(list.children).toHaveLength(2);
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
