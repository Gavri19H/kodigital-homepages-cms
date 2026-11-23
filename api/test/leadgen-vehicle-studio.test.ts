// F18 Vehicle database — Section Studio (admin) side.
//
// 1. The three admin JSON routes over the REAL admin router: the live list
//    (GET /vehicles/live), one make (GET /vehicles/makes/:make_id) — both read
//    a tiny snapshot from a stubbed R2 bucket — and the Make / Year questions a
//    Section can link to (GET /sections/:id/vehicle-fields) over an in-memory
//    node:sqlite database built from the real migrations.
// 2. The inspector skeleton carries the new "Source" controls.
// 3. The REAL island functions (sliced from SECTION_STUDIO_SCRIPT and run in a
//    vm against the real inspector markup in a mini DOM): switching Source
//    keeps the typed choices, the Make pre-fill, what shows and hides, the
//    issues list, the canvas affordances, and "Send as" on the mapping edge.

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { renderStudioInspector, renderStudioSettings, SECTION_STUDIO_SCRIPT, studioTypeMeta } from "../src/admin/leadgen/ui-section-studio";
import { resetVehicleStoreMemo } from "../src/leadgen/vehicles/store";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { miniDocument, MiniNode } from "./helpers/mini-dom";

// --- node:sqlite harness (repo pattern, see leadgen-section-studio-ui.test.ts) ---

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const getBuiltin = (process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule;
    if (typeof getBuiltin === "function") return (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    /* fall through */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createRequire } = require("node:module") as typeof import("node:module");
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
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
  } as unknown as D1Database;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = [
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
  "0061_leadgen_routing_present_only_offer.sql",
] as const;

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

// --- a tiny vehicle snapshot in a stubbed R2 bucket ---------------------------

const SNAPSHOT = "2026-10-05";
const VEHICLE_FILES: Record<string, unknown> = {
  "vehicles/live.json": { snapshot: SNAPSHOT },
  [`vehicles/${SNAPSHOT}/makes.json`]: {
    snapshot: SNAPSHOT,
    makes: [
      { make_id: 460, name: "Ford", slug: "ford" },
      { make_id: 474, name: "Honda", slug: "honda" },
      { make_id: 448, name: "Toyota", slug: "toyota" },
    ],
  },
  [`vehicles/${SNAPSHOT}/makes/448.json`]: {
    snapshot: SNAPSHOT,
    make_id: 448,
    models: [
      { model_id: "m_0123456789", name: "4Runner" },
      { model_id: "m_abcdefabcd", name: "bZ4X" },
      { model_id: "m_1111111111", name: "Corolla" },
    ],
    years: [
      { year: 2027, m: [0, 1] },
      { year: 2023, m: [0, 1, 2] },
      { year: 1981, m: [2] },
    ],
  },
};

function mediaStub(files: Record<string, unknown>): R2Bucket {
  return {
    async get(key: string) {
      if (!(key in files)) return null;
      const text = JSON.stringify(files[key]);
      return { text: async () => text, httpEtag: '"t"' };
    },
  } as unknown as R2Bucket;
}

function newHarness(files: Record<string, unknown> = VEHICLE_FILES): { sdb: SqliteDb; env: Env } {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, filename TEXT, storage_key TEXT, created_at INTEGER);",
  );
  for (const file of MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  const env = {
    DB: d1FromSqlite(sdb),
    CACHE: {} as KVNamespace,
    MEDIA: mediaStub(files),
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
  return { sdb, env };
}

const API = "/api/admin/leadgen";

async function getJson(env: Env, path: string): Promise<{ status: number; body: Record<string, unknown>; cache: string | null }> {
  const res = await admin.request(path, {}, env);
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cache: res.headers.get("cache-control") };
}

afterEach(() => resetVehicleStoreMemo());

// ---------------------------------------------------------------------------
// 1. Admin JSON routes
// ---------------------------------------------------------------------------

describeDb("F18 admin route — GET /vehicles/live", () => {
  it("returns the live snapshot, the real make count, every make with its logo (newest global upload wins) and the pre-filled featured makes", async () => {
    const { sdb, env } = newHarness();
    const ins = sdb.prepare("INSERT INTO media (site_id, filename, storage_key, created_at) VALUES (?, ?, ?, ?)");
    ins.run(null, "vehicle-logo-toyota.png", "logos/toyota-old.png", 1);
    ins.run(null, "vehicle-logo-toyota.png", "logos/toyota-new.png", 2);
    ins.run("site_1", "vehicle-logo-honda.png", "logos/honda-site.png", 3); // a site's own upload is not the global set
    const r = await getJson(env, `${API}/vehicles/live`);
    expect(r.status).toBe(200);
    expect(r.cache).toContain("no-store");
    expect(r.body).toEqual({
      snapshot: SNAPSHOT,
      make_count: 3,
      makes: [
        { make_id: 460, name: "Ford", slug: "ford", logo_url: null },
        { make_id: 474, name: "Honda", slug: "honda", logo_url: null },
        { make_id: 448, name: "Toyota", slug: "toyota", logo_url: "/media/logos/toyota-new.png" },
      ],
      // Q8 order (Toyota, Honda, Ford, …) — only the makes this snapshot has
      default_featured: [448, 474, 460],
    });
  });

  it("answers 404 with a plain reason when no list is live", async () => {
    const { env } = newHarness({});
    const r = await getJson(env, `${API}/vehicles/live`);
    expect(r.status).toBe(404);
    expect(r.body["error"]).toBe("no_live_list");
  });
});

describeDb("F18 admin route — GET /vehicles/makes/:make_id", () => {
  it("returns the make with its years newest first and each year's models", async () => {
    const { env } = newHarness();
    const r = await getJson(env, `${API}/vehicles/makes/448`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      snapshot: SNAPSHOT,
      make_id: 448,
      name: "Toyota",
      slug: "toyota",
      logo_url: null,
      years: [
        { year: 2027, models: [{ model_id: "m_0123456789", name: "4Runner" }, { model_id: "m_abcdefabcd", name: "bZ4X" }] },
        {
          year: 2023,
          models: [
            { model_id: "m_0123456789", name: "4Runner" },
            { model_id: "m_abcdefabcd", name: "bZ4X" },
            { model_id: "m_1111111111", name: "Corolla" },
          ],
        },
        { year: 1981, models: [{ model_id: "m_1111111111", name: "Corolla" }] },
      ],
    });
  });

  it("400 for a bad make_id, 404 for a make not in the live list", async () => {
    const { env } = newHarness();
    const bad = await getJson(env, `${API}/vehicles/makes/abc`);
    expect(bad.status).toBe(400);
    expect(bad.body["error"]).toBe("invalid_param");
    const unknown = await getJson(env, `${API}/vehicles/makes/999`);
    expect(unknown.status).toBe(404);
    expect(unknown.body["error"]).toBe("unknown_make");
    // Honda is in makes.json but its make file is missing: still a plain 404
    const noFile = await getJson(env, `${API}/vehicles/makes/474`);
    expect(noFile.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /sections/:id/vehicle-fields
// ---------------------------------------------------------------------------

function sectionPublicId(n: number): string {
  return `lgs_01J${String(n).padStart(23, "0")}`;
}

function vehicleNode(qid: string, type: string, field: string, asks: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type, question_id: qid, internal_field: field, props: { choice_source: "vehicle", vehicle_asks: asks, ...extra } };
}

function insertSection(sdb: SqliteDb, n: number, name: string, headline: string, components: unknown[]): number {
  const publicId = sectionPublicId(n);
  sdb
    .prepare("INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, ?, 'quote_funnel', 'auto', ?, ?)")
    .run(publicId, name, headline, JSON.stringify({ components }));
  return (sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number }).id;
}

describeDb("F18 admin route — GET /sections/:id/vehicle-fields", () => {
  function fixture(): { sdb: SqliteDb; env: Env } {
    const h = newHarness();
    const { sdb } = h;
    sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, ?, ?, ?)").run("lgq_aaaaaaaaaaaa", "Car Quote", "quote_funnel", '["auto"]');
    sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, ?, ?, ?)").run("lgq_bbbbbbbbbbbb", "Other Quote", "quote_funnel", '["auto"]');
    sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES (?, 1, ?)").run("lgf_aaaaaaaaaaaa", "Default");
    sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES (?, 2, ?)").run("lgf_bbbbbbbbbbbb", "Default");
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label) VALUES (?, 1, 'A')").run("lgn_aaaaaaaaaaaa"); // 1
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label) VALUES (?, 1, 'B')").run("lgn_cccccccccccc"); // 2
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label) VALUES (?, 2, 'A')").run("lgn_bbbbbbbbbbbb"); // 3
    const make = insertSection(sdb, 1, "1 Car make", "Who makes your car?", [
      vehicleNode("q_make", "IconCardAnswerGrid", "vehicle_make", "make", { label: "Car make", vehicle_featured_makes: [448] }),
    ]);
    const year = insertSection(sdb, 2, "2 Car year", "What year is your car?", [
      vehicleNode("q_year", "DropdownQuestion", "vehicle_year", "year", { vehicle_make_field: "vehicle_make" }),
    ]);
    const model = insertSection(sdb, 3, "3 Car model", "Which model?", [
      vehicleNode("q_model", "SearchableDropdownQuestion", "vehicle_model", "model", { vehicle_make_field: "vehicle_make", vehicle_year_field: "vehicle_year" }),
      { type: "ButtonAnswerGroup", question_id: "q_typed", internal_field: "owns_car", choices: [{ label: "Yes", value: "yes", analytics_id: "yes" }] },
    ]);
    const otherQuote = insertSection(sdb, 4, "4 Other quote make", "Make?", [vehicleNode("q_om", "ButtonAnswerGroup", "other_make", "make")]);
    const otherVariantYear = insertSection(sdb, 5, "5 Variant B year", "Year?", [vehicleNode("q_by", "DropdownQuestion", "b_year", "year")]);
    insertSection(sdb, 6, "6 Not used", "Car?", [
      vehicleNode("q_um", "DropdownQuestion", "solo_make", "make"),
      vehicleNode("q_uy", "DropdownQuestion", "solo_year", "year"),
      vehicleNode("q_ux", "DropdownQuestion", "solo_model", "model"),
    ]);
    const fvsVariant = sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, ?, ?)");
    const fvsShared = sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position) VALUES (?, ?, ?)");
    fvsShared.run(1, make, 1); // the Car Quote's shared first page
    fvsVariant.run(1, year, 1);
    fvsVariant.run(1, model, 2);
    fvsVariant.run(2, otherVariantYear, 1);
    fvsVariant.run(3, otherQuote, 1);
    return h;
  }

  it("a Model Section lists the Make on the shared first page and the Year in its own funnel — never another Quote's or another variant's", async () => {
    const { env } = fixture();
    const r = await getJson(env, `${API}/sections/${sectionPublicId(3)}/vehicle-fields`);
    expect(r.status).toBe(200);
    expect(r.body["fields"]).toEqual([
      { field: "vehicle_make", label: "Car make", asks: "make", section_public_id: sectionPublicId(1), section_name: "1 Car make" },
      { field: "vehicle_year", label: "What year is your car?", asks: "year", section_public_id: sectionPublicId(2), section_name: "2 Car year" },
    ]);
  });

  it("a Section on the shared first page sees every funnel variant of its Quote", async () => {
    const { env } = fixture();
    const r = await getJson(env, `${API}/sections/${sectionPublicId(1)}/vehicle-fields`);
    const fields = (r.body["fields"] as Array<{ field: string }>).map((f) => f.field);
    expect(fields).toEqual(["vehicle_make", "vehicle_year", "b_year"]);
    expect(fields).not.toContain("other_make");
  });

  it("a Section in no Quote lists only its own Make / Year questions (Model never listed); an unknown Section is 404", async () => {
    const { env } = fixture();
    const r = await getJson(env, `${API}/sections/${sectionPublicId(6)}/vehicle-fields`);
    expect((r.body["fields"] as Array<{ field: string; asks: string }>).map((f) => `${f.field}:${f.asks}`)).toEqual(["solo_make:make", "solo_year:year"]);
    const missing = await getJson(env, `${API}/sections/${sectionPublicId(99)}/vehicle-fields`);
    expect(missing.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// 2. Inspector skeleton
// ---------------------------------------------------------------------------

const INSPECTOR = renderStudioInspector(defaultFunnelDesign as never, null);

describe("F18 inspector skeleton — Content → Answer format", () => {
  it("carries the Source control right under 'Answer format', the vehicle settings and the read-only notice + details card", () => {
    const fmt = INSPECTOR.indexOf(`<div class="studio-panel-eyebrow">Answer format</div>`);
    const src = INSPECTOR.indexOf("data-vehicle-source-wrap");
    expect(src).toBeGreaterThan(fmt);
    expect(src).toBeLessThan(INSPECTOR.indexOf("data-accept-wrap"));
    expect(INSPECTOR).toContain(`<button type="button" data-set-choice-source="typed">Typed choices</button>`);
    expect(INSPECTOR).toContain(`<button type="button" data-set-choice-source="vehicle">Vehicle database</button>`);
    expect(INSPECTOR).toContain(`<label class="form-label">This question asks for</label>`);
    for (const [v, l] of [["make", "Make"], ["year", "Year"], ["model", "Model"]]) {
      expect(INSPECTOR).toContain(`<button type="button" data-set-vehicle-asks="${v}">${l}</button>`);
    }
    expect(INSPECTOR).toContain(">Make answer comes from</label>");
    expect(INSPECTOR).toContain(">Year answer comes from</label>");
    expect(INSPECTOR).toContain(">Featured makes (required)</label>");
    expect(INSPECTOR).toContain(">Show the newest N years as cards</label>");
    expect(INSPECTOR).toContain('data-inspector-field="vehicle_other_label"');
    expect(INSPECTOR).toContain(
      `<p class="alert studio-callout-blue" data-vehicle-notice>Choices come from the vehicle database. Names and years update when the yearly refresh goes live.</p>`,
    );
    expect(INSPECTOR).toContain(">Look up a make</label>");
    expect(INSPECTOR).toContain(">No logo yet</span>");
    // Card style "Logo" (read-only) next to the Icon / Image / Plain switch
    expect(INSPECTOR).toMatch(/data-card-style-logo hidden>\s*<button type="button" class="active" disabled aria-disabled="true">Logo<\/button>/);
    // the typed list and its editors sit inside one wrapper the island hides
    const typed = INSPECTOR.slice(INSPECTOR.indexOf("data-typed-choices-wrap"), INSPECTOR.indexOf("data-vehicle-choices-wrap"));
    for (const hook of ["data-inspector-choices", 'id="lg-choice-add"', "data-other-editor-block", "data-choice-bulk-wrap", "data-choices-c1-note"]) {
      expect(typed).toContain(hook);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The REAL island functions
// ---------------------------------------------------------------------------

function sliceIslandFunction(name: string): string {
  const marker = `function ${name}(`;
  const start = SECTION_STUDIO_SCRIPT.indexOf(marker);
  expect(start, `island function ${name} present`).toBeGreaterThan(-1);
  const open = SECTION_STUDIO_SCRIPT.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < SECTION_STUDIO_SCRIPT.length; i += 1) {
    const ch = SECTION_STUDIO_SCRIPT[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return SECTION_STUDIO_SCRIPT.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${name}`);
}

function sliceIslandVar(name: string): string {
  const marker = `var ${name} = `;
  const start = SECTION_STUDIO_SCRIPT.indexOf(marker);
  expect(start, `island var ${name} present`).toBeGreaterThan(-1);
  const at = start + marker.length;
  const openCh = SECTION_STUDIO_SCRIPT[at]!;
  if (openCh !== "{" && openCh !== "[") return SECTION_STUDIO_SCRIPT.slice(start, SECTION_STUDIO_SCRIPT.indexOf(";", at) + 1);
  const closeCh = openCh === "[" ? "]" : "}";
  let depth = 0;
  for (let i = at; i < SECTION_STUDIO_SCRIPT.length; i += 1) {
    if (SECTION_STUDIO_SCRIPT[i] === openCh) depth += 1;
    else if (SECTION_STUDIO_SCRIPT[i] === closeCh) {
      depth -= 1;
      if (depth === 0) return `${SECTION_STUDIO_SCRIPT.slice(start, i + 1)};`;
    }
  }
  throw new Error(`unbalanced ${name}`);
}

const VEHICLE_VARS = ["VEHICLE_SOURCE_KINDS", "VEHICLE_SETTING_KEYS", "VEHICLE_FEATURED_LIMIT", "VEHICLE_YEAR_CARDS_RANGE", "vehicleUi"];
const VEHICLE_FUNCS = [
  "trimStr",
  "cloneJson",
  "clearChildren",
  "ensureObj",
  "setOrDelete",
  "cleanupEmpty",
  "typeMeta",
  "isContainerType",
  "walkTree",
  "findRefIn",
  "findRef",
  "selectedNode",
  "vehicleKindOf",
  "isVehicleSourceNode",
  "isVehicleSourceQid",
  "vehicleAsksOf",
  "vehicleNeedsFeatured",
  "vehicleFeaturedOf",
  "writeVehicleFeatured",
  "prefillFeaturedMakes",
  "prefillFeaturedWhenLoaded",
  "setChoiceSource",
  "setVehicleAsks",
  "setVehicleLink",
  "addFeaturedMake",
  "removeFeaturedMake",
  "moveFeaturedMake",
  "setVehicleYearCards",
  "loadVehicleLive",
  "loadVehicleLinkFields",
  "lookUpVehicleMake",
  "vehicleLinkOptions",
  "fillVehicleLinkSelect",
  "vehicleMakeById",
  "renderVehicleFeatured",
  "renderVehicleLiveLine",
  "renderVehicleLookup",
  "showVehicleLookupYear",
  "populateVehicleSource",
  "vehicleSendAsApplies",
  "buildVehicleSendAs",
  "setEdgeSendAs",
  "findEdgeIndex",
  "closedAnswerValuesOf",
];

const LIVE = {
  snapshot: SNAPSHOT,
  make_count: 3,
  makes: [
    { make_id: 460, name: "Ford", slug: "ford", logo_url: null },
    { make_id: 474, name: "Honda", slug: "honda", logo_url: null },
    { make_id: 448, name: "Toyota", slug: "toyota", logo_url: "/media/logos/toyota.png" },
  ],
  default_featured: [448, 474, 460],
};

interface Probe {
  doc: ReturnType<typeof miniDocument>;
  sandbox: Record<string, unknown>;
  fetches: string[];
  run(expr: string): unknown;
  q(sel: string): MiniNode;
  node(): Record<string, unknown> & { props?: Record<string, unknown> };
}

// The routes the island fetches, answered from fixed bodies.
type Routes = Record<string, { ok: boolean; body: unknown }>;

function probe(components: unknown[], opts: { selected?: string; routes?: Routes; live?: unknown; publicId?: string | null } = {}): Probe {
  const doc = miniDocument(`<html><body><input id="lg-section-headline" value="Your car" />${INSPECTOR}</body></html>`);
  const fetches: string[] = [];
  const routes: Routes = opts.routes ?? {};
  const sandbox: Record<string, unknown> = {
    document: doc,
    studioMeta: { types: studioTypeMeta() },
    state: { public_id: opts.publicId === undefined ? sectionPublicId(3) : opts.publicId, content: { components: JSON.parse(JSON.stringify(components)) }, answer_maps: [] },
    selectedQuestionId: opts.selected ?? "q1",
    CHANGES: 0,
    DIRTY: 0,
    fetch(url: string) {
      fetches.push(url);
      const hit = routes[url];
      return Promise.resolve({ ok: hit ? hit.ok : false, json: () => Promise.resolve(hit ? hit.body : { error: "Not Found" }) });
    },
  };
  const source = [
    "function afterModelChange() { CHANGES += 1; }",
    "function markDirty() { DIRTY += 1; }",
    "function populateInspector() { populateVehicleSource(selectedNode()); }",
    "function currentHeadlineText() { return 'Your car'; }",
    ...VEHICLE_VARS.map(sliceIslandVar),
    ...VEHICLE_FUNCS.map(sliceIslandFunction),
  ].join("\n");
  runInNewContext(source, sandbox);
  if (opts.live !== undefined) runInNewContext(`vehicleUi.live = ${JSON.stringify(opts.live)};`, sandbox);
  const run = (expr: string): unknown => runInNewContext(expr, sandbox);
  return {
    doc,
    sandbox,
    fetches,
    run,
    q: (sel) => {
      const el = doc.querySelector(sel);
      expect(el, sel).not.toBeNull();
      return el!;
    },
    node: () => run("selectedNode()") as Record<string, unknown> & { props?: Record<string, unknown> },
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

const TYPED_CARDS = {
  type: "IconCardAnswerGrid",
  question_id: "q1",
  internal_field: "vehicle_make",
  choices: [
    { label: "Toyota", value: "toyota", analytics_id: "toyota", icon: "★" },
    { label: "Honda", value: "honda", analytics_id: "honda", icon: "★" },
  ],
  props: { other: { enabled: true, label: "Other", choices: [{ label: "Kia", value: "kia", analytics_id: "kia" }] }, defaultValue: "honda" },
};

describe("F18 island — switching Source", () => {
  it("Vehicle database keeps the typed rows, 'Other' values and default untouched; Typed choices shows them exactly as saved; the vehicle settings come back on the next switch", () => {
    const p = probe([TYPED_CARDS], { live: LIVE });
    p.run("populateVehicleSource(selectedNode())");
    expect(p.q("[data-vehicle-source-wrap]").hidden).toBe(false);
    expect(p.q("[data-typed-choices-wrap]").hidden).toBe(false);
    expect(p.q("[data-vehicle-choices-wrap]").hidden).toBe(true);

    p.run("setChoiceSource('vehicle')");
    let n = p.node();
    expect(n.props!["choice_source"]).toBe("vehicle");
    expect(n.props!["vehicle_asks"]).toBe("make");
    expect(n["choices"]).toEqual(TYPED_CARDS.choices);
    expect(n.props!["other"]).toEqual(TYPED_CARDS.props.other);
    expect(n.props!["defaultValue"]).toBe("honda");
    expect(p.q("[data-typed-choices-wrap]").hidden).toBe(true);
    expect(p.q("[data-vehicle-choices-wrap]").hidden).toBe(false);
    expect(p.q("[data-vehicle-settings]").hidden).toBe(false);
    expect(p.q('[data-set-choice-source="vehicle"]').className).toBe("active");

    p.run("moveFeaturedMake(0, 1)"); // operator's own order: Honda, Toyota, Ford
    p.run("setChoiceSource('typed')");
    n = p.node();
    expect(n.props).toEqual(TYPED_CARDS.props); // no vehicle key left behind
    expect(n["choices"]).toEqual(TYPED_CARDS.choices);
    expect(p.q("[data-typed-choices-wrap]").hidden).toBe(false);
    expect(p.q("[data-vehicle-settings]").hidden).toBe(true);
    expect(p.q('[data-set-choice-source="typed"]').className).toBe("active");

    p.run("setChoiceSource('vehicle')");
    expect(p.node().props!["vehicle_featured_makes"]).toEqual([474, 448, 460]);
  });

  it("only the five vehicle-capable types show the Source control", () => {
    for (const type of ["ButtonAnswerGroup", "IconCardAnswerGrid", "ImageCardAnswerGrid", "DropdownQuestion", "SearchableDropdownQuestion"]) {
      const p = probe([{ type, question_id: "q1" }]);
      p.run("populateVehicleSource(selectedNode())");
      expect(p.q("[data-vehicle-source-wrap]").hidden, type).toBe(false);
    }
    for (const type of ["MultiChoiceCardGroup", "FreeTextQuestion", "TwoButtonYesNo"]) {
      const p = probe([{ type, question_id: "q1" }]);
      p.run("populateVehicleSource(selectedNode())");
      expect(p.q("[data-vehicle-source-wrap]").hidden, type).toBe(true);
      p.run("setChoiceSource('vehicle')");
      expect(p.node().props, type).toBeUndefined();
    }
  });
});

describe("F18 island — featured makes (Q8, Q10)", () => {
  it("Make on Buttons / Cards is pre-filled with the live list's default makes; Dropdown gets none; an existing list is kept", () => {
    const cards = probe([{ type: "IconCardAnswerGrid", question_id: "q1" }], { live: LIVE });
    cards.run("setChoiceSource('vehicle')");
    expect(cards.node().props!["vehicle_featured_makes"]).toEqual([448, 474, 460]);

    const dropdown = probe([{ type: "DropdownQuestion", question_id: "q1" }], { live: LIVE });
    dropdown.run("setChoiceSource('vehicle')");
    expect(dropdown.node().props!["vehicle_featured_makes"]).toBeUndefined();

    const kept = probe([{ type: "ButtonAnswerGroup", question_id: "q1", props: { vehicle_featured_makes: [460] } }], { live: LIVE });
    kept.run("setChoiceSource('vehicle')");
    expect(kept.node().props!["vehicle_featured_makes"]).toEqual([460]);
  });

  it("when the live list is still loading, the pre-fill lands once it arrives (one fetch of the admin route)", async () => {
    const p = probe([{ type: "ButtonAnswerGroup", question_id: "q1" }], { routes: { "/api/admin/leadgen/vehicles/live": { ok: true, body: LIVE } } });
    p.run("setChoiceSource('vehicle')");
    expect(p.node().props!["vehicle_featured_makes"]).toBeUndefined();
    await flush();
    expect(p.fetches.filter((u) => u === "/api/admin/leadgen/vehicles/live")).toHaveLength(1);
    expect(p.node().props!["vehicle_featured_makes"]).toEqual([448, 474, 460]);
    // the picker lists the featured makes by name, in order, and offers the rest
    const rows = p.doc.querySelectorAll("[data-vehicle-featured-row]").map((r) => r.querySelector(".studio-vehicle-name")!.textContent);
    expect(rows).toEqual(["Toyota", "Honda", "Ford"]);
    expect(p.q("[data-vehicle-featured-add]").querySelectorAll("option").map((o) => o.textContent)).toEqual(["+ Add a make…"]);
  });

  it("add / move / remove keep make_ids in the operator's order; removing the last shows the required note", () => {
    const p = probe([{ type: "IconCardAnswerGrid", question_id: "q1", props: { choice_source: "vehicle", vehicle_asks: "make", vehicle_featured_makes: [448] } }], { live: LIVE });
    p.run("populateVehicleSource(selectedNode())");
    p.run("addFeaturedMake('460')");
    p.run("addFeaturedMake('460')"); // twice is a no-op
    expect(p.node().props!["vehicle_featured_makes"]).toEqual([448, 460]);
    p.run("moveFeaturedMake(1, -1)");
    expect(p.node().props!["vehicle_featured_makes"]).toEqual([460, 448]);
    // the move-up button of the first row is disabled
    expect(p.doc.querySelector('[data-vehicle-featured-action="up"][data-vehicle-featured-index="0"]')!.disabled).toBe(true);
    p.run("removeFeaturedMake(0)");
    p.run("removeFeaturedMake(0)");
    expect(p.node().props!["vehicle_featured_makes"]).toBeUndefined();
    expect(p.q("[data-vehicle-featured-empty]").hidden).toBe(false);
  });
});

describe("F18 island — what shows and hides", () => {
  it("Make on Icon cards: Card style reads 'Logo', featured makes show, typed list / '+ Add choice' / Bulk paste / Other / defaults are hidden", () => {
    const p = probe([{ ...TYPED_CARDS, props: { ...TYPED_CARDS.props, choice_source: "vehicle", vehicle_asks: "make", vehicle_featured_makes: [448] } }], { live: LIVE });
    for (const w of p.doc.querySelectorAll("[data-default-wrap]")) w.hidden = false; // as populateDefaultControls may leave them
    p.run("populateVehicleSource(selectedNode())");
    expect(p.q("[data-card-style-group]").hidden).toBe(true);
    expect(p.q("[data-card-style-logo]").hidden).toBe(false);
    expect(p.q("[data-vehicle-featured-wrap]").hidden).toBe(false);
    expect(p.q("[data-vehicle-other-label-wrap]").hidden).toBe(false);
    expect(p.q("#lg-vehicle-other-label").getAttribute("placeholder")).toBe("Other make");
    expect(p.q("[data-vehicle-year-cards-wrap]").hidden).toBe(true);
    expect(p.q('[data-vehicle-link-wrap="make"]').hidden).toBe(true);
    expect(p.q('[data-vehicle-link-wrap="year"]').hidden).toBe(true);
    expect(p.q("[data-typed-choices-wrap]").hidden).toBe(true);
    for (const w of p.doc.querySelectorAll("[data-default-wrap]")) expect(w.hidden).toBe(true);
    expect(p.q("[data-vehicle-live-line]").textContent).toBe("Live list: 2026-10-05 · 3 makes");
  });

  it("Year on Buttons: 'Make answer comes from' lists this Section's own Make and the funnels' others; newest-N years shows; Card style stays the normal switch", async () => {
    const own = { type: "DropdownQuestion", question_id: "q_m", internal_field: "own_make", props: { choice_source: "vehicle", vehicle_asks: "make" } };
    const year = { type: "ButtonAnswerGroup", question_id: "q1", internal_field: "vehicle_year", props: { choice_source: "vehicle", vehicle_asks: "year", vehicle_year_cards: 8 } };
    const routes: Routes = {
      [`/api/admin/leadgen/sections/${sectionPublicId(3)}/vehicle-fields`]: {
        ok: true,
        body: {
          fields: [
            { field: "vehicle_make", label: "Car make", asks: "make", section_public_id: sectionPublicId(1), section_name: "1 Car make" },
            { field: "own_make", label: "stale saved copy", asks: "make", section_public_id: sectionPublicId(3), section_name: "3 Car model" },
            { field: "vehicle_year", label: "Year", asks: "year", section_public_id: sectionPublicId(2), section_name: "2 Car year" },
          ],
        },
      },
    };
    const p = probe([own, year], { live: LIVE, routes });
    p.run("populateVehicleSource(selectedNode())");
    await flush();
    expect(p.q('[data-vehicle-link-wrap="make"]').hidden).toBe(false);
    expect(p.q('[data-vehicle-link-wrap="year"]').hidden).toBe(true);
    const options = p.q('[data-vehicle-link="make"]').querySelectorAll("option").map((o) => `${o.value}|${o.textContent}`);
    expect(options).toEqual([
      "|Pick the Make question",
      "own_make|Your car · own_make",
      "vehicle_make|Car make · vehicle_make (1 Car make)",
    ]);
    expect(p.q('[data-vehicle-link-empty="make"]').hidden).toBe(true);
    p.run("setVehicleLink('make', 'vehicle_make')");
    expect(p.node().props!["vehicle_make_field"]).toBe("vehicle_make");
    expect(p.q("[data-vehicle-year-cards-wrap]").hidden).toBe(false);
    expect((p.q("[data-vehicle-year-cards]") as MiniNode).value).toBe("8");
    p.run("setVehicleYearCards('40')");
    expect(p.node().props!["vehicle_year_cards"]).toBe(12);
    p.run("setVehicleYearCards('')");
    expect(p.node().props!["vehicle_year_cards"]).toBeUndefined();
    expect(p.q("#lg-vehicle-other-label").getAttribute("placeholder")).toBe("Older year");
    expect(p.q("[data-vehicle-featured-wrap]").hidden).toBe(true);
    expect(p.q("[data-card-style-group]").hidden).toBe(false);
    expect(p.q("[data-card-style-logo]").hidden).toBe(true);
  });

  it("Model on Dropdown in a new, unsaved Section: both links show, with the plain empty-list help; no Other label, no network call for links", () => {
    const p = probe([{ type: "DropdownQuestion", question_id: "q1", props: { choice_source: "vehicle", vehicle_asks: "model" } }], { live: LIVE, publicId: null });
    p.run("populateVehicleSource(selectedNode())");
    expect(p.q('[data-vehicle-link-wrap="make"]').hidden).toBe(false);
    expect(p.q('[data-vehicle-link-wrap="year"]').hidden).toBe(false);
    expect(p.q('[data-vehicle-link-empty="make"]').hidden).toBe(false);
    expect(p.q('[data-vehicle-link-empty="year"]').textContent).toContain("save this Section and add it to a Quote");
    expect(p.q("[data-vehicle-other-label-wrap]").hidden).toBe(true);
    expect(p.q("[data-vehicle-featured-wrap]").hidden).toBe(true);
    expect(p.fetches.some((u) => u.includes("vehicle-fields"))).toBe(false);
  });

  it("switching what the question asks for drops the other kinds' settings and pre-fills Make", () => {
    const p = probe([{ type: "ImageCardAnswerGrid", question_id: "q1", props: { choice_source: "vehicle", vehicle_asks: "model", vehicle_make_field: "m", vehicle_year_field: "y", vehicle_other_label: "x" } }], { live: LIVE });
    p.run("setVehicleAsks('make')");
    expect(p.node().props).toEqual({ choice_source: "vehicle", vehicle_asks: "make", vehicle_featured_makes: [448, 474, 460] });
    p.run("setVehicleAsks('year')");
    expect(p.node().props).toEqual({ choice_source: "vehicle", vehicle_asks: "year" });
    expect(p.q("[data-card-style-vehicle-note]").textContent).toBe("Year and Model cards always show as Plain.");
  });

  it("'Look up a make' shows the make_id, name, 'No logo yet', years newest first and the picked year's models", async () => {
    const make = {
      snapshot: SNAPSHOT,
      make_id: 448,
      name: "Toyota",
      slug: "toyota",
      logo_url: null,
      years: [
        { year: 2027, models: [{ model_id: "m_0123456789", name: "4Runner" }] },
        { year: 2023, models: [{ model_id: "m_0123456789", name: "4Runner" }, { model_id: "m_abcdefabcd", name: "bZ4X" }] },
      ],
    };
    const p = probe([{ type: "DropdownQuestion", question_id: "q1", props: { choice_source: "vehicle", vehicle_asks: "make" } }], {
      live: LIVE,
      routes: { "/api/admin/leadgen/vehicles/makes/448": { ok: true, body: make } },
    });
    p.run("populateVehicleSource(selectedNode())");
    expect(p.q("[data-vehicle-lookup]").querySelectorAll("option").map((o) => o.textContent)).toEqual(["Pick a make", "Ford", "Honda", "Toyota"]);
    p.run("lookUpVehicleMake('448')");
    await flush();
    expect(p.q("[data-vehicle-lookup-result]").hidden).toBe(false);
    expect(p.q("[data-vehicle-lookup-name]").textContent).toBe("Toyota");
    expect(p.q("[data-vehicle-lookup-id]").textContent).toBe("make_id 448");
    expect(p.q("[data-vehicle-lookup-nologo]").hidden).toBe(false);
    expect(p.q("[data-vehicle-lookup-logo]").hidden).toBe(true);
    expect(p.q("[data-vehicle-lookup-years]").textContent).toBe("Years: 2027 → 2023 (newest first)");
    expect(p.q("[data-vehicle-lookup-models-head]").textContent).toBe("2027 · 1 model");
    p.run("showVehicleLookupYear('2023')");
    expect(p.q("[data-vehicle-lookup-models]").querySelectorAll("span").map((s) => s.textContent)).toEqual(["4Runner", "bZ4X"]);
    expect(p.q("[data-vehicle-lookup-models-head]").textContent).toBe("2023 · 2 models");
  });
});

describe("F18 island — issues list (computeIssues)", () => {
  function issuesFor(components: unknown[]): string[] {
    const sandbox: Record<string, unknown> = { studioMeta: { types: studioTypeMeta() }, MAX_DEPTH: 4, state: { content: { components } } };
    const src = ["trimStr", "typeMeta", "isContainerType", "typeLabel", "walkTree", "bindNodeType", "computeIssues"].map(sliceIslandFunction).join("\n");
    runInNewContext(src, sandbox);
    return (runInNewContext("computeIssues()", sandbox) as Array<{ message: string }>).map((i) => i.message);
  }

  it("a vehicle question is never flagged for no choices / icons / Other values; its own missing settings are", () => {
    const ok = issuesFor([
      { type: "IconCardAnswerGrid", question_id: "a", internal_field: "vehicle_make", props: { choice_source: "vehicle", vehicle_asks: "make", vehicle_featured_makes: [448], other: { enabled: true, choices: [] } }, choices: [{ label: "", value: "x" }] },
      { type: "DropdownQuestion", question_id: "b", internal_field: "vehicle_year", props: { choice_source: "vehicle", vehicle_asks: "year", vehicle_make_field: "vehicle_make" } },
      { type: "SearchableDropdownQuestion", question_id: "c", internal_field: "vehicle_model", props: { choice_source: "vehicle", vehicle_asks: "model", vehicle_make_field: "vehicle_make", vehicle_year_field: "vehicle_year" } },
    ]);
    expect(ok).toEqual([]);

    const bad = issuesFor([
      { type: "ButtonAnswerGroup", question_id: "a", internal_field: "vehicle_make", props: { choice_source: "vehicle", vehicle_asks: "make" } },
      { type: "DropdownQuestion", question_id: "b", internal_field: "vehicle_model", props: { choice_source: "vehicle", vehicle_asks: "model" } },
      { type: "DropdownQuestion", question_id: "c", internal_field: "vehicle_x", props: { choice_source: "vehicle" } },
    ]);
    expect(bad.some((m) => m.includes("needs at least one featured make"))).toBe(true);
    expect(bad.some((m) => m.includes("needs “Make answer comes from”"))).toBe(true);
    expect(bad.some((m) => m.includes("needs “Year answer comes from”"))).toBe(true);
    expect(bad.some((m) => m.includes("needs “This question asks for”"))).toBe(true);
    expect(bad.some((m) => m.includes("needs at least one choice"))).toBe(false);

    // a TYPED question with no choices is still flagged (nothing loosened)
    expect(issuesFor([{ type: "IconCardAnswerGrid", question_id: "t", internal_field: "f", props: {} }]).some((m) => m.includes("needs at least one choice"))).toBe(true);
  });
});

describe("F18 island — canvas affordances (decorateChoiceCards)", () => {
  it("a vehicle question's cards get no remove x, no drag and no '+ Add choice' ghost; a typed question keeps them", () => {
    const proto = MiniNode.prototype as unknown as { insertBefore?: (n: MiniNode, ref: MiniNode | null) => MiniNode };
    proto.insertBefore = function (this: MiniNode, n: MiniNode, ref: MiniNode | null): MiniNode {
      this.appendChild(n);
      const kids = this.childNodes;
      kids.pop();
      const at = ref ? kids.indexOf(ref) : -1;
      kids.splice(at === -1 ? kids.length : at, 0, n);
      return n;
    };
    const doc = miniDocument(
      `<html><body><div id="region">` +
        `<div data-question-id="q1" data-component-type="IconCardAnswerGrid"><button data-lg-choice="448">Toyota</button></div>` +
        `<div data-question-id="q2" data-component-type="IconCardAnswerGrid"><button data-lg-choice="a">A</button></div>` +
        `</div></body></html>`,
    );
    const sandbox: Record<string, unknown> = {
      document: doc,
      studioMeta: { types: studioTypeMeta() },
      state: {
        content: {
          components: [
            { type: "IconCardAnswerGrid", question_id: "q1", props: { choice_source: "vehicle", vehicle_asks: "make" } },
            { type: "IconCardAnswerGrid", question_id: "q2", choices: [{ label: "A", value: "a", analytics_id: "a", icon: "x" }] },
          ],
        },
      },
      selectedQuestionId: null,
      selectedChoiceValue: null,
      selectedChoiceIndex: -1,
    };
    const src = [
      "function frameCreate(tag) { return document.createElement(tag); }",
      sliceIslandVar("VEHICLE_SOURCE_KINDS"),
      ...["typeMeta", "isContainerType", "findRefIn", "findRef", "withoutClasses", "vehicleKindOf", "isVehicleSourceNode", "isVehicleSourceQid", "decorateChoiceCards"].map(sliceIslandFunction),
    ].join("\n");
    runInNewContext(src, sandbox);
    runInNewContext("decorateChoiceCards(document.getElementById('region'))", sandbox);
    const card = (qid: string): MiniNode => doc.querySelector(`[data-question-id="${qid}"] [data-lg-choice]`)!;
    expect(card("q1").getAttribute("draggable")).toBeNull();
    expect(card("q1").querySelector("[data-choice-x]")).toBeNull();
    expect(doc.querySelector('[data-choice-ghost="q1"]')).toBeNull();
    expect(card("q2").getAttribute("draggable")).toBe("true");
    expect(card("q2").querySelector("[data-choice-x]")).not.toBeNull();
    expect(doc.querySelector('[data-choice-ghost="q2"]')).not.toBeNull();
    delete proto.insertBefore;
  });
});

describe("F18 island — Offers mapping 'Send as: Name / ID' (Q4)", () => {
  const MAKE = { type: "DropdownQuestion", question_id: "q1", internal_field: "vehicle_make", props: { choice_source: "vehicle", vehicle_asks: "make" } };

  it("writes send_as: 'id' on the edge and removes it for Name; only Make / Model get the control", () => {
    const p = probe([MAKE]);
    p.run("state.answer_maps.push({ offer_id: 7, offer_payload_field_path: 'vehicle.make', internal_field: 'vehicle_make' })");
    expect(p.run("setEdgeSendAs(7, 'vehicle.make', 'vehicle_make', 'id')")).toBe(true);
    expect(p.run("state.answer_maps[0].send_as")).toBe("id");
    expect(p.sandbox["DIRTY"]).toBe(1);
    expect(p.run("setEdgeSendAs(7, 'vehicle.make', 'vehicle_make', 'id')")).toBe(false);
    expect(p.run("setEdgeSendAs(7, 'vehicle.make', 'other_field', 'id')")).toBe(false);
    expect(p.run("setEdgeSendAs(7, 'vehicle.make', 'vehicle_make', 'name')")).toBe(true);
    expect(p.run("'send_as' in state.answer_maps[0]")).toBe(false);

    expect(p.run("vehicleSendAsApplies(selectedNode())")).toBe(true);
    p.run("selectedNode().props.vehicle_asks = 'model'");
    expect(p.run("vehicleSendAsApplies(selectedNode())")).toBe(true);
    p.run("selectedNode().props.vehicle_asks = 'year'");
    expect(p.run("vehicleSendAsApplies(selectedNode())")).toBe(false);
    p.run("delete selectedNode().props.choice_source");
    expect(p.run("vehicleSendAsApplies(selectedNode())")).toBe(false);
  });

  it("the mapping line shows Name (default) | ID for a mapped vehicle Make; upsertEdge carries send_as to the re-picked field", () => {
    const p = probe([MAKE]);
    const src = [
      "function pathOptionLabel(f) { return f.path; }",
      "function fieldOptionLabelIn(o, f) { return f.path; }",
      "function fieldDisplayLabel(f) { return f.path; }",
      "function edgeMapState() { return 'complete'; }",
      "function mapStateNote() { return 'ok'; }",
      "function answerFieldOf(o, path) { return { path: path, type: 'string' }; }",
      "function valuesNotSent() { return 99; }",
      "function answerNodeType() { return 'string'; }",
      "function questionByAnswerKey() { return selectedNode(); }",
      "function answerTypeOfKey() { return 'string'; }",
      sliceIslandFunction("buildQuickmapLine"),
      sliceIslandFunction("upsertEdge"),
    ].join("\n");
    runInNewContext(src, p.sandbox);
    p.run("var OFFER = { id: 7, public_id: 'lgo_x', offer_name: 'Car buyer', answer_fields: [{ path: 'vehicle.make', type: 'string' }, { path: 'car.brand', type: 'string' }] };");
    p.run("state.selected_offers = []; state.answer_maps.push({ offer_id: 7, offer_payload_field_path: 'vehicle.make', internal_field: 'vehicle_make' })");
    const line = p.run("buildQuickmapLine(OFFER, selectedNode(), state.answer_maps[0], state.answer_maps, 'vehicle_make')") as MiniNode;
    const buttons = line.querySelectorAll("[data-quickmap-sendas]");
    expect(buttons.map((b) => `${b.textContent}:${b.className}`)).toEqual(["Name:active", "ID:"]);
    expect(line.querySelector(".studio-map-sendas-label")!.textContent).toBe("Send as");
    // hidden typed choices never count as "answers never reach this field"
    expect(line.querySelector("[data-quickmap-notsent]")).toBeNull();

    p.run("setEdgeSendAs(7, 'vehicle.make', 'vehicle_make', 'id')");
    const again = p.run("buildQuickmapLine(OFFER, selectedNode(), state.answer_maps[0], state.answer_maps, 'vehicle_make')") as MiniNode;
    expect(again.querySelectorAll("[data-quickmap-sendas]").map((b) => b.className)).toEqual(["", "active"]);
    // the operator re-picks another field for the same answer: the edge keeps ID
    p.run("var OLD = state.answer_maps.splice(0, 1)[0]; upsertEdge(OFFER, OFFER.answer_fields[1], 'vehicle_make', OLD);");
    expect(p.run("state.answer_maps[0].offer_payload_field_path + '|' + state.answer_maps[0].send_as")).toBe("car.brand|id");

    // Year: no control
    p.run("selectedNode().props.vehicle_asks = 'year'");
    const yearLine = p.run("buildQuickmapLine(OFFER, selectedNode(), state.answer_maps[0], state.answer_maps, 'vehicle_make')") as MiniNode;
    expect(yearLine.querySelector("[data-quickmap-sendas]")).toBeNull();
  });

  it("closedAnswerValuesOf ignores a vehicle question's hidden typed rows (sections.ts closedAnswerValues)", () => {
    const p = probe([{ ...MAKE, choices: [{ label: "A", value: "a" }] }]);
    expect(p.run("closedAnswerValuesOf(selectedNode())")).toBeNull();
    p.run("selectedNode().props.vehicle_asks = 'year'");
    expect(p.run("closedAnswerValuesOf(selectedNode())")).toBeNull();
    p.run("delete selectedNode().props.choice_source");
    expect(p.run("closedAnswerValuesOf(selectedNode())")).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// Follow-up 1: the mapping check matches the server (sections.ts
// vehicleAnswerValues / edgeAnswerValues / mappingCompleteness)
// ---------------------------------------------------------------------------

describe("F18 island — a vehicle mapping is judged by what it sends ('Send as')", () => {
  const OFFER = {
    id: 7,
    has_active_schema: true,
    answer_fields: [
      { path: "car.make_number", type: "number" },
      { path: "car.make_text", type: "string" },
      { path: "car.is_new", type: "boolean" },
    ],
  };
  function stateOf(asks: string, sendAs: string | null, path: string): { st: string; note: string } {
    const node = { type: "DropdownQuestion", question_id: "q1", internal_field: "vehicle_x", answer_type: "enum", props: { choice_source: "vehicle", vehicle_asks: asks }, choices: [{ label: "One", value: "1" }] };
    const p = probe([node]);
    const field = OFFER.answer_fields.find((f) => f.path === path)!;
    const src = [
      "function answerFieldOf(o, path) { var i; for (i = 0; i < o.answer_fields.length; i++) { if (o.answer_fields[i].path === path) { return o.answer_fields[i]; } } return null; }",
      "function plainTypeWords(f) { return f.type === 'number' ? 'number' : (f.type === 'boolean' ? 'yes or no' : 'text'); }",
      ...["questionByField", "answerNodeType", "choiceValueCoercibleTo", "vehicleAnswerValuesOf", "coercibleTo", "edgeMapState", "mapStateNote"].map(sliceIslandFunction),
    ].join("\n");
    runInNewContext(src, p.sandbox);
    p.sandbox["OFFER"] = OFFER;
    p.sandbox["EDGE"] = {
      internal_field: "vehicle_x",
      answer_type: "enum",
      offer_payload_field_path: path,
      provider_expected_type: field.type,
      ...(sendAs === null ? {} : { send_as: sendAs }),
    };
    const st = p.run("edgeMapState(EDGE, OFFER)") as string;
    const note = p.run("mapStateNote(edgeMapState(EDGE, OFFER), answerFieldOf(OFFER, EDGE.offer_payload_field_path), OFFER, EDGE)") as string;
    return { st, note };
  }

  it("Make sent as ID into a number field is complete; Make by name, Model by name or ID into a number field stay a mismatch", () => {
    expect(stateOf("make", "id", "car.make_number").st).toBe("complete");
    expect(stateOf("make", null, "car.make_number").st).toBe("type_mismatch");
    expect(stateOf("model", "id", "car.make_number").st).toBe("type_mismatch");
    // (the hidden typed row "1" would fit a number field — it is never what is judged)
    expect(stateOf("model", null, "car.make_number").st).toBe("type_mismatch");
    // the year is always a number; names fit a text field; nothing vehicle fits yes / no
    expect(stateOf("year", null, "car.make_number").st).toBe("complete");
    expect(stateOf("make", null, "car.make_text").st).toBe("complete");
    expect(stateOf("make", "id", "car.is_new").st).toBe("type_mismatch");
  });

  it("the mismatch line names the vehicle fix, never the hidden Provider values", () => {
    const byName = stateOf("make", null, "car.make_number").note;
    expect(byName).toContain("set \u201cSend as\u201d to ID");
    expect(byName).not.toContain("Provider values");
    const model = stateOf("model", "id", "car.make_number").note;
    expect(model).toBe("this buyer wants number, which this vehicle answer can\u2019t send \u2014 pick another field");
  });
});

// ---------------------------------------------------------------------------
// Follow-up 2: the {make} / {year} headline tip (owner decision, 23 Nov)
// ---------------------------------------------------------------------------

describe("F18 Studio — {make} / {year} headline tip", () => {
  const VIEW = {
    public_id: null,
    section_name: "Car year",
    status: "active",
    activity: "quote_funnel",
    vertical: "auto",
    headline_text: "What year is your {make}?",
    subheadline_text: null,
    continue_mode: "button",
    address_validation_enabled: false,
    content: { components: [] },
  };

  it("the question strip carries the tip, hidden until the island shows it", () => {
    const html = renderStudioSettings(VIEW as never, false);
    expect(html).toMatch(
      /<p class="form-help" data-vehicle-headline-tip hidden[^>]*>Tip: write \{make\} or \{year\} to show the visitor&#8217;s answer, for example &#8220;What year is your \{make\}\?&#8221;<\/p>/,
    );
    // it sits under the headline and subheadline inputs, inside the same form
    const form = html.slice(html.indexOf('id="lg-section-form"'), html.indexOf("</form>"));
    expect(form.indexOf("data-vehicle-headline-tip")).toBeGreaterThan(form.indexOf('id="lg-section-subheadline"'));
  });

  it("shows only while this Section has a Vehicle database Year or Model question, and follows every model change", () => {
    const tipFor = (components: unknown[]): boolean => {
      const doc = miniDocument(`<html><body>${renderStudioSettings(VIEW as never, false)}</body></html>`);
      const sandbox: Record<string, unknown> = { document: doc, studioMeta: { types: studioTypeMeta() }, state: { content: { components } } };
      const src = [
        sliceIslandVar("VEHICLE_SOURCE_KINDS"),
        ...["typeMeta", "isContainerType", "walkTree", "vehicleKindOf", "isVehicleSourceNode", "vehicleAsksOf", "renderVehicleHeadlineTip"].map(sliceIslandFunction),
      ].join("\n");
      runInNewContext(src, sandbox);
      runInNewContext("renderVehicleHeadlineTip()", sandbox);
      return !doc.querySelector("[data-vehicle-headline-tip]")!.hidden;
    };
    const v = (type: string, asks: string): Record<string, unknown> => ({ type, question_id: `q_${asks}`, props: { choice_source: "vehicle", vehicle_asks: asks } });
    expect(tipFor([v("ButtonAnswerGroup", "year")])).toBe(true);
    expect(tipFor([v("SearchableDropdownQuestion", "model")])).toBe(true);
    expect(tipFor([v("IconCardAnswerGrid", "make")])).toBe(false);
    expect(tipFor([{ type: "ButtonAnswerGroup", question_id: "q", props: { vehicle_asks: "year" } }])).toBe(false); // typed choices
    expect(tipFor([])).toBe(false);
    // refreshed on every edit, after Undo / Redo and when the page opens
    expect(sliceIslandFunction("afterModelChange")).toContain("renderVehicleHeadlineTip();");
    expect(sliceIslandFunction("refreshAfterHistory")).toContain("renderVehicleHeadlineTip();");
    expect(SECTION_STUDIO_SCRIPT).toContain("  loadUsage();\n  renderVehicleHeadlineTip();\n");
  });
});

// ---------------------------------------------------------------------------
// Follow-up 3: the canvas's first paint has no vehicle data — a Section with a
// Vehicle database question is redrawn once through the preview endpoint on open
// ---------------------------------------------------------------------------

describe("F18 Studio — redraw the canvas on open when a vehicle question exists", () => {
  function openWith(components: unknown[]): { scheduled: number; rendered: number; dirty: number; history: number; found: unknown } {
    const sandbox: Record<string, unknown> = {
      studioMeta: { types: studioTypeMeta() },
      state: { content: { components } },
      canvasModelRev: 0,
      canvasTimer: null,
      inlineEditing: false,
      TIMERS: [] as Array<() => void>,
      SCHEDULED: 0,
      RENDERED: 0,
      DIRTY: 0,
      HISTORY: 0,
    };
    const src = [
      "function setTimeout(fn) { TIMERS.push(fn); return TIMERS.length; }",
      "function clearTimeout() {}",
      "function renderCanvasNow() { RENDERED += 1; }",
      "function markDirty() { DIRTY += 1; }",
      "function historyPush() { HISTORY += 1; }",
      ...["typeMeta", "isContainerType", "walkTree", "scheduleCanvasRender", "redrawCanvasForVehicleData"].map(sliceIslandFunction),
      // count scheduler calls without replacing the real scheduler
      "var realSchedule = scheduleCanvasRender; scheduleCanvasRender = function () { SCHEDULED += 1; realSchedule(); };",
    ].join("\n");
    runInNewContext(src, sandbox);
    const found = runInNewContext("redrawCanvasForVehicleData()", sandbox);
    for (const t of sandbox["TIMERS"] as Array<() => void>) t();
    return {
      scheduled: sandbox["SCHEDULED"] as number,
      rendered: sandbox["RENDERED"] as number,
      dirty: sandbox["DIRTY"] as number,
      history: sandbox["HISTORY"] as number,
      found,
    };
  }

  it("a Section with a vehicle question (nested ones too) gets one preview redraw — not dirty, no Undo step; others get none", () => {
    const withVehicle = openWith([
      { type: "TextBlock", question_id: "t" },
      { type: "CardPanel", question_id: "c", children: [{ type: "DropdownQuestion", question_id: "q", props: { choice_source: "vehicle", vehicle_asks: "model" } }] },
    ]);
    expect(withVehicle).toEqual({ scheduled: 1, rendered: 1, dirty: 0, history: 0, found: true });
    const typed = openWith([{ type: "ButtonAnswerGroup", question_id: "q", props: { choice_source: "typed" } }]);
    expect(typed).toEqual({ scheduled: 0, rendered: 0, dirty: 0, history: 0, found: false });
  });

  it("runs on open, right after the page's other first loads and before the first preview", () => {
    const boot = SECTION_STUDIO_SCRIPT.slice(SECTION_STUDIO_SCRIPT.lastIndexOf("  historyReset();"));
    expect(boot).toContain("  renderVehicleHeadlineTip();\n  redrawCanvasForVehicleData();\n");
    expect(boot.indexOf("redrawCanvasForVehicleData();")).toBeLessThan(boot.indexOf("runPreview();"));
  });
});
