// LeadGen Phase 5 Stage B — the Sections admin UI (contract 03 §9.3 / 05
// §12–§14) over the REAL admin router + REAL 0036–0039 migrations (node:sqlite
// harness; the leadgen-offers-ui.test.ts pattern with DEV_BYPASS_AUTH). All
// seeding goes through the REAL Stage-B JSON API.
//
// Covers: the §9.3 list (columns in order, completeness badge, status pill,
// enabled Create link, filters + timeframe, analytics skeleton + hydration
// wiring); the full-page editor (builder canvas + component palette +
// inspector tokens + the §12.4/§12.11 mapping grid + Desktop/Mobile preview
// toggle + the §14.9 states simulator + the §12.8 Google-Maps toggle +
// continue-mode controls); /sections/new (empty editor); hostile content
// escaped; every inline <script> is strict ES5 + parses; unknown ids → the
// in-shell 404.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { renderMappingGrid, type AnswerMapView, type MappingSummary } from "../src/admin/leadgen/ui-question-builder";

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

const OFFER_SCHEMA = {
  version: 1,
  root: { type: "object", children: [{ path: "data.insured", name: "insured", type: "boolean", required: true, source: "answer", internal_field: "insured" }] },
};

interface OfferDetail { id: number; public_id: string; offer_name: string; [k: string]: unknown }
interface SectionDetail { id: number; public_id: string; [k: string]: unknown }

async function createMappableOffer(env: Env, overrides: Record<string, unknown> = {}): Promise<OfferDetail> {
  const res = await admin.request(
    `${API}/offers`,
    jsonInit("POST", {
      offer_name: "Life Offer",
      activity: "quote_funnel",
      vertical: "life",
      conversion_tracking_method: "s2s_postback",
      offer_type: "cpl",
      placements: [`pl-${mintPublicId("offer").slice(-8)}`],
      calls_provider_api: true,
      bid_source: "static",
      cap_enabled: false,
      ...overrides,
    }),
    env,
  );
  expect(res.status).toBe(201);
  const offer = (await res.json()) as OfferDetail;
  const schemaRes = await admin.request(`${API}/offers/${offer.id}/payload-schemas`, jsonInit("POST", { schema_json: OFFER_SCHEMA }), env);
  expect(schemaRes.status).toBe(201);
  return offer;
}

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

// ---------------------------------------------------------------------------
// List page (03 §9.3)
// ---------------------------------------------------------------------------

const EXPECTED_COLUMNS = [
  "Name",
  "Activity / Vertical",
  "Questions",
  "Mapped Offers",
  "Mapping completeness",
  "Status",
  "Views",
  "Continue rate",
  "Validation-error rate",
  "Actions",
] as const;

describeDb("leadgen sections list page (03 §9.3)", () => {
  it("renders the §9.3 columns in order, the completeness badge, status pill + row actions", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    await createSection(env, {
      section_name: "Insured Q",
      answer_maps: [{ question_id: "q1", offer_id: offer.id, offer_payload_field_path: "data.insured", provider_expected_type: "boolean", required_for_offer: true }],
    });

    const html = await getHtml(env, "/admin/leadgen/sections");

    let cursor = -1;
    for (const label of EXPECTED_COLUMNS) {
      const at = html.indexOf(`>${label}</th>`, cursor + 1);
      expect(at, `${label} column present in order`).toBeGreaterThan(cursor);
      cursor = at;
    }

    expect(html).toContain('data-entity-name="Insured Q"');
    expect(html).toContain("quote_funnel / life");
    // question count (1) + mapped-offer count (1) rendered
    expect(html).toContain('<td class="lg-num">1</td>');
    // completeness badge (the single mapped offer is complete)
    expect(html).toContain('data-completeness="complete"');
    // status pill
    expect(html).toContain('<span class="badge badge-published">active</span>');
    // Create link — ENABLED, points at /sections/new
    expect(html).toContain('href="/admin/leadgen/sections/new" class="btn btn-primary" data-create-section');
    // row actions
    expect(html).toContain('data-section-usage=');
    expect(html).toContain('data-section-archive=');
    expect(html).toContain("/edit");
  });

  it("wires §9.3 filters + timeframe + after-paint analytics hydration", async () => {
    const { env } = newHarness();
    await createSection(env);
    const html = await getHtml(env, "/admin/leadgen/sections");
    for (const name of ["activity", "vertical", "status", "range"]) {
      expect(html, `filter select ${name}`).toContain(`<select name="${name}"`);
    }
    expect(html).toContain('name="search"');
    // analytics hydration wiring + per-cell skeletons
    expect(html).toContain("data-lg-analytics");
    expect(html).toContain('data-analytics-url-prefix="/api/admin/leadgen/sections/"');
    for (const metric of ["views", "continue_rate", "validation_error_rate"]) {
      expect(html, `skeleton ${metric}`).toContain(`<td class="lg-num" data-metric="${metric}"><span class="skel" aria-hidden="true"></span></td>`);
    }
  });

  it("renders the empty state with an enabled Create entry point", async () => {
    const { env } = newHarness();
    const html = await getHtml(env, "/admin/leadgen/sections");
    expect(html).toContain('class="empty-state"');
    expect(html).toContain("No sections yet.");
    expect(html).toContain("data-create-section");
  });
});

// ---------------------------------------------------------------------------
// Editor page (03 §9.3 — builder + inspector + preview + simulator)
// ---------------------------------------------------------------------------

describeDb("leadgen section editor (03 §9.3 / 05 §12–§14)", () => {
  it("renders the builder canvas, capability palette, inspector tokens + the mapping grid", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env, { offer_name: "MapMe" });
    const section = await createSection(env, {
      answer_maps: [{ question_id: "q1", offer_id: offer.id, offer_payload_field_path: "data.insured", provider_expected_type: "boolean", required_for_offer: true, output_value_map: { true: true, false: false } }],
    });
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);

    // LEFT: canvas + palette (add from the capability catalog)
    expect(html).toContain("data-lg-canvas");
    expect(html).toContain('id="lg-canvas-list"');
    expect(html).toContain('data-add-component="TwoButtonYesNo"');
    expect(html).toContain('data-add-component="IconCardAnswerGrid"');
    // the seeded component renders as a canvas card
    expect(html).toContain('data-question-id="q1"');

    // RIGHT: inspector tokens (§14.8 curated) + the mapping grid (§12.4/§12.11)
    expect(html).toContain("data-inspector-tokens");
    expect(html).toContain("data-inspector-mapping");
    expect(html).toContain('id="lg-mapping-grid"');
    for (const col of ["Internal field", "Mapped Offer", "Offer field path", "Expected type", "Value transform", "Completeness", "Test payload"]) {
      expect(html, `mapping column ${col}`).toContain(`>${col}</th>`);
    }
    // the curated token controls (never arbitrary CSS)
    for (const key of ["iconColor", "columns", "featureColor", "rangeColor", "buttonBackground", "buttonText", "gridGap", "mobileBehavior"]) {
      expect(html, `token control ${key}`).toContain(`data-inspector-override="${key}"`);
    }
    // the mapping row for the seeded Offer
    expect(html).toContain(`data-mapping-offer="${offer.id}"`);
    expect(html).toContain('data-mapping-status="complete"');
    expect(html).toContain("MapMe");
  });

  it("renders the Desktop/Mobile preview toggle + the §14.9 states simulator + §12.8 Maps toggle + continue-mode", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);

    // Desktop/Mobile preview toggle → drives POST /sections/preview (sandboxed iframe)
    expect(html).toContain('data-preview-viewport="desktop"');
    expect(html).toContain('data-preview-viewport="mobile"');
    expect(html).toContain('id="lg-preview-frame"');
    expect(html).toContain('sandbox=""'); // sandboxed preview iframe (no innerHTML)
    // §14.9 states simulator
    for (const sim of ["default", "selected", "error", "dependency"]) {
      expect(html, `sim state ${sim}`).toContain(`data-sim-state="${sim}"`);
    }
    // §12.8 Google-Maps toggle (key is a secret — the note says so, no key embedded)
    expect(html).toContain('id="lg-address-validation"');
    expect(html).toContain("GOOGLE_MAPS_BROWSER_KEY");
    expect(html).not.toContain("maps.googleapis.com"); // never embeds the Maps JS/key
    // continue-mode controls (§12.5)
    expect(html).toContain('name="continue_mode" value="button"');
    expect(html).toContain('name="continue_mode" value="auto_advance"');
    // save/archive header (§9.6)
    expect(html).toContain('id="lg-section-save"');
    expect(html).toContain('id="lg-section-archive"');
    expect(html).toContain("beforeunload"); // unsaved-changes guard
    // the state blob feeding the ES5 builder
    expect(html).toContain('id="lg-section-data"');
  });

  it("/sections/new renders the empty editor (no public_id, archive disabled)", async () => {
    const { env } = newHarness();
    const html = await getHtml(env, "/admin/leadgen/sections/new");
    expect(html).toContain('id="lg-section-editor"');
    expect(html).toContain("New Section");
    expect(html).toContain('id="lg-section-save"');
    expect(html).toMatch(/id="lg-section-archive"[^>]*disabled/);
    // empty canvas + empty mapping grid
    expect(html).toContain("No components yet.");
    expect(html).toContain("No answer→Offer mappings yet.");
  });

  it("unknown / foreign-kind / malformed section ids → the in-shell 404", async () => {
    const { env } = newHarness();
    for (const id of [mintPublicId("section"), mintPublicId("offer"), "999999", "lgs_short"]) {
      const res = await admin.request(`/admin/leadgen/sections/${id}/edit`, {}, env);
      expect(res.status, `${id} → 404`).toBe(404);
      const html = await res.text();
      expect(html).toContain("Section not found.");
      expect(html).toContain('data-marker="kodigital-admin-shell"');
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });
});

// ---------------------------------------------------------------------------
// M1 — the §13 builder / §14.8 inspector / §12.4 mapping grid can AUTHOR
// (palette seeds editable nodes; inspector collects; mapping add/edit/remove)
// ---------------------------------------------------------------------------

// Extract a <script type="application/json" id="…"> data blob and JSON.parse it.
function extractJsonBlob(html: string, id: string): Record<string, unknown> {
  const marker = `id="${id}">`;
  const start = html.indexOf(marker);
  expect(start, `blob ${id} present`).toBeGreaterThan(-1);
  const from = start + marker.length;
  const end = html.indexOf("</script>", from);
  const raw = html.slice(from, end).split("\\u003c").join("<");
  return JSON.parse(raw) as Record<string, unknown>;
}

describeDb("leadgen section editor — M1 authoring wired", () => {
  it("palette-add seed templates carry the catalog-required authorable fields", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);

    // The seed blob the ES5 builder reads on palette click.
    expect(html).toContain('id="lg-component-seeds"');
    const seeds = extractJsonBlob(html, "lg-component-seeds");

    // IconCardAnswerGrid needs internal_field + a (fillable) choices array +
    // required, and declares its enum answer_type — enough for the inspector to
    // complete it toward validity.
    expect(seeds["IconCardAnswerGrid"]).toMatchObject({
      internal_field: "",
      required: false,
      choices: [],
      answer_type: "enum",
    });
    // A yes/no question seeds internal_field + boolean answer_type.
    expect(seeds["TwoButtonYesNo"]).toMatchObject({ internal_field: "", answer_type: "boolean" });
    // A choice question seeds a choices array; a range question seeds internal_field.
    expect(seeds["ButtonAnswerGroup"]).toHaveProperty("choices");
    expect(seeds["RangeQuestion"]).toMatchObject({ internal_field: "", answer_type: "number" });
    // chrome with no authorable answer fields seeds an empty (but present) object.
    expect(seeds["ProgressBar"]).toEqual({});
  });

  it("the inspector renders the §13.1 authoring controls (not just style tokens)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);
    expect(html).toContain("data-inspector-authoring");
    expect(html).toContain('data-inspector-field="internal_field"');
    expect(html).toContain('data-inspector-field="required"');
    expect(html).toContain('data-inspector-field="valid_values"');
    expect(html).toContain('data-inspector-cond="when"');
    expect(html).toContain('data-inspector-cond="op"');
    expect(html).toContain("data-inspector-choices");
    expect(html).toContain('id="lg-choice-add"');
  });

  it("the ES5 builder COLLECTS inspector edits back into the selected node (not just markDirty)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);

    // the collectors exist and are wired to input/change (not only markDirty)
    expect(html).toContain("function collectInspectorField(");
    expect(html).toContain("function collectInspectorOverride(");
    expect(html).toContain("function collectConditional(");
    expect(html).toContain("function collectChoices(");
    expect(html).toContain("collectInspectorField(this)");
    // it reads the data-collect hooks and writes into the selected content node
    expect(html).toContain("getAttribute('data-inspector-field')");
    expect(html).toContain("getAttribute('data-inspector-override')");
    expect(html).toContain("data-inspector-cond=");
    expect(html).toContain("getAttribute('data-choice-field')");
    expect(html).toContain("function selectedNode(");
    // palette-add seeds from the catalog blob (not a bare {type, question_id})
    expect(html).toContain("componentSeeds[type]");
  });

  it("the mapping grid has a working add-row control + collects data-map-field into state.answer_maps", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    const section = await createSection(env, {
      answer_maps: [{ question_id: "q1", offer_id: offer.id, offer_payload_field_path: "data.insured", provider_expected_type: "boolean", required_for_offer: true }],
    });
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);

    expect(html).toContain('id="lg-mapping-add"');
    // "+ Add mapping" appends an edge into state.answer_maps
    expect(html).toContain("state.answer_maps.push(");
    // per-row edit/remove/collect wiring reads data-map-field back into state
    expect(html).toContain("function collectMappings(");
    expect(html).toContain("function readMapRow(");
    expect(html).toContain("function removeMapping(");
    expect(html).toContain("getAttribute('data-map-field')");
    expect(html).toContain("data-map-field");
    // per-row Test hits the §12.11 validate-payload endpoint
    expect(html).toContain("function testMapping(");
    expect(html).toContain("/validate-payload");
    // collectSection serializes BOTH the content nodes and the answer_maps
    expect(html).toContain("content_json: JSON.stringify(state.content)");
    expect(html).toContain("answer_maps: state.answer_maps");
  });
});

// ---------------------------------------------------------------------------
// XSS escaping
// ---------------------------------------------------------------------------

describeDb("leadgen sections UI — escaping", () => {
  const HOSTILE = `<script>alert(1)</script>"&'`;

  it("hostile section_name/headline render escaped on the list + editor", async () => {
    const { env } = newHarness();
    // Hostile content ALSO inside content_json (a headline prop) so the JSON
    // state-blob escaping path is exercised too.
    const hostileContent = {
      components: [
        { type: "QuestionHeadline", question_id: "h1", props: { text: HOSTILE } },
        { type: "TwoButtonYesNo", question_id: "q1", internal_field: "currently_insured" },
      ],
    };
    const section = await createSection(env, {
      section_name: HOSTILE,
      headline_text: HOSTILE,
      content_json: JSON.stringify(hostileContent),
    });

    const list = await getHtml(env, "/admin/leadgen/sections");
    expect(list).not.toContain("<script>alert(1)</script>");
    expect(list).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;&#39;");

    const editor = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);
    expect(editor).not.toContain("<script>alert(1)</script>");
    expect(editor).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // the JSON state blob escapes `<` (→ \\u003c) so a hostile content value
    // cannot emit a literal </script> and break out of the data element.
    expect(editor).toContain("\\u003c/script>");
    expect(editor).not.toContain("<script>alert(1)</script>");
  });
});

// ---------------------------------------------------------------------------
// ES5-only inline scripts (listicles-ui-es5 mechanism: token scan + node --check)
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

const scratchDir = mkdtempSync(join(tmpdir(), "leadgen-section-parse-"));
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

describeDb("leadgen sections pages — ES5-only inline scripts", () => {
  async function renderedPages(): Promise<Array<[string, string]>> {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    const section = await createSection(env, {
      answer_maps: [{ question_id: "q1", offer_id: offer.id, offer_payload_field_path: "data.insured", provider_expected_type: "boolean", required_for_offer: true }],
    });
    return [
      ["sections-list", await getHtml(env, "/admin/leadgen/sections")],
      ["sections-new", await getHtml(env, "/admin/leadgen/sections/new")],
      ["section-editor", await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`)],
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
// §12.11 field-level mapping-completeness cell states (pure render — no DB)
// ---------------------------------------------------------------------------

function mapView(mappingStatus: string, over: Partial<AnswerMapView> = {}): AnswerMapView {
  return {
    question_id: "q1",
    question_key: "insured_q",
    internal_field: "insured",
    answer_type: "boolean",
    offer_id: 7,
    offer_payload_field_path: "data.insured",
    provider_expected_type: "boolean",
    output_value_map: null,
    value_transform: null,
    required_for_offer: true,
    default_value: null,
    fallback_value: null,
    mapping_status: mappingStatus,
    ...over,
  };
}

describe("§12.11 mapping grid — the four field-level cell states + publish summary", () => {
  const summary: MappingSummary = { publishable: false, status: "error", required_missing_total: 2 };
  // one row per §12.11 state: complete→ok, incomplete→missing_required,
  // type_mismatch, orphaned. The type_mismatch row names a coercion (string→boolean).
  const html = renderMappingGrid(
    [
      mapView("complete"),
      mapView("incomplete"),
      mapView("type_mismatch", { answer_type: "string" }),
      mapView("orphaned"),
    ],
    new Map<number, string>([[7, "OfferX"]]),
    summary,
  );

  it("renders each of the four §12.11 semantic cell states with the exact copy", () => {
    // the semantic state attribute for each cell
    expect(html).toContain('data-mapping-cell="ok"');
    expect(html).toContain('data-mapping-cell="missing_required"');
    expect(html).toContain('data-mapping-cell="type_mismatch"');
    expect(html).toContain('data-mapping-cell="orphaned"');
    // the §12.11 exact per-state copy
    expect(html).toContain("map required field"); // missing_required (red)
    expect(html).toContain("answer type string not coercible to boolean"); // type_mismatch (amber)
    expect(html).toContain("Offer field no longer exists in schema"); // orphaned (gray)
    // the DB mapping_status attribute is preserved (back-compat)
    expect(html).toContain('data-mapping-status="complete"');
  });

  it("colours each cell (green ok / red missing / amber mismatch / gray orphaned)", () => {
    expect(html).toContain("lg-cell-ok");
    expect(html).toContain("lg-cell-missing");
    expect(html).toContain("lg-cell-mismatch");
    expect(html).toContain("lg-cell-orphaned");
  });

  it("renders the section-level publish verdict + 'N required mappings missing' summary (§12.11 gate)", () => {
    expect(html).toContain("data-mapping-summary");
    expect(html).toContain('data-publishable="false"'); // §12.11 publish gate blocked
    expect(html).toContain("Blocked from publish");
    expect(html).toContain('data-required-missing="2"');
    expect(html).toContain("2 required mappings missing");
  });

  it("a fully-mapped, publishable section shows the publishable verdict", () => {
    const ok = renderMappingGrid(
      [mapView("complete")],
      new Map<number, string>([[7, "OfferX"]]),
      { publishable: true, status: "ok", required_missing_total: 0 },
    );
    expect(ok).toContain('data-publishable="true"');
    expect(ok).toContain("Publishable");
    expect(ok).toContain('data-required-missing="0"');
  });
});

// ---------------------------------------------------------------------------
// P6 editor wiring — §12.3 dependency simulator + §30.2 Maps-key state
// ---------------------------------------------------------------------------

describeDb("leadgen section editor — P6 dependency preview + §30.2 Maps-key state", () => {
  it("renders the §12.3 dependency simulator control + wires it to /sections/preview with sample_answers", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);
    // the dependency sample-answers panel + apply control + aria-live status line
    expect(html).toContain("data-dependency-panel");
    expect(html).toContain("data-dependency-answers");
    expect(html).toContain('id="lg-dependency-apply"');
    expect(html).toContain("data-dependency-status");
    // the P5 "dependency" sim button now drives the state variable
    expect(html).toContain('data-sim-state="dependency"');
    expect(html).toContain("simState = stateName");
    // runPreview sends sample_answers ONLY in dependency mode + reflects the verdict
    expect(html).toContain("function sampleAnswers(");
    expect(html).toContain("function renderDependencyStatus(");
    expect(html).toContain("requestBody.sample_answers = sampleAnswers()");
    expect(html).toContain("simState === 'dependency'");
  });

  it("surfaces the §30.2 Maps-key ABSENT state when no browser key is configured", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);
    expect(html).toContain('data-maps-key="absent"');
    expect(html).toContain("Maps key not configured");
    expect(html).toContain("autofill disabled");
  });

  it("surfaces the CONFIGURED Maps-key state when the browser-key secret is present (value never embedded)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const withKey = { ...env, GOOGLE_MAPS_BROWSER_KEY: "browser-abc" } as Env;
    const res = await admin.request(`/admin/leadgen/sections/${section.public_id}/edit`, {}, withKey);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-maps-key="configured"');
    expect(html).not.toContain("browser-abc"); // §30.2 — the key VALUE is never embedded
  });
});
