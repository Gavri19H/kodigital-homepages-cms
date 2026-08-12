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
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
// P5-F2 (ADJ-A7 fix-first): cross-check the client issues-chip mirror against
// the REAL server validator (the same function sections-handlers.ts calls at
// save time) — never a hand-built stand-in for the server side of the
// boundary (E11).
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";
// D2: ui-question-builder.ts is DELETED — its §12.11 mapping-grid cell-state
// assertions are ported to test/leadgen-section-studio-ui.test.ts (the studio
// island's edgeMapState/mapStateNote decode, executed from the served page).
import {
  mappingSummaryOf,
  type AnswerMapApiRow,
  type AvailableOfferRow,
} from "../src/admin/leadgen/ui-sections";

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
  it("renders the studio library, canvas, inspector token dropdowns + the mapping drawer summary", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env, { offer_name: "MapMe" });
    const section = await createSection(env, {
      answer_maps: [{ question_id: "q1", offer_id: offer.id, offer_payload_field_path: "data.insured", provider_expected_type: "boolean", required_for_offer: true, output_value_map: { true: true, false: false } }],
    });
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);

    // LEFT: the §8.3 component library (drag + click-to-add from the catalog)
    expect(html).toContain("data-studio-library");
    expect(html).toContain('data-add-component="TwoButtonYesNo"');
    expect(html).toContain('data-add-component="IconCardAnswerGrid"');
    // CENTER: the §8.4 canvas — the seeded component is preset-rendered with
    // its selection hit-target attribute. DEV-66: the canvas document rides
    // the srcdoc attribute of the canvas iframe (escapeHtml-escaped), so the
    // hit-target pin asserts the escaped byte form inside that attribute.
    expect(html).toContain("data-studio-canvas");
    expect(html).toMatch(/<iframe[^>]*id="lg-studio-canvas-frame"[^>]*sandbox="allow-same-origin allow-scripts"/); // U13: allow-scripts (scripts inert via in-frame CSP)
    expect(html).toContain("data-question-id=&quot;q1&quot;");

    // RIGHT: the §8.6 Style tab (renderStyleExtraControls, R3b rename of the
    // old renderDesignPanel) — curated token DROPDOWNS only (§14.8; the
    // free-text token inputs are gone, values come from the design's slots).
    // FIX 4b: mobileBehavior is NOT rendered (zero renderer consumers — a
    // dead write); the schema key stays legal for stored legacy data.
    // R3b S2-7/S4-A4 (rail removal): featureColor/buttonBackground/buttonText
    // rows DIED — featureColor is now the text family's OWN "Text color role"
    // control (data-style-text-block, pinned below); buttonBackground/
    // buttonText are frame/theme-owned per contract §8.5b, no authoring
    // control at all (legacy stored values still render, renderer untouched).
    for (const key of ["iconColor", "columns", "rangeColor", "gridGap"]) {
      expect(html, `token control ${key}`).toContain(`data-inspector-override="${key}"`);
      expect(html, `token control ${key} is a select`).toContain(`<select id="lg-inspector-${key}"`);
    }
    expect(html, "the dead mobileBehavior control is gone").not.toContain('<select id="lg-inspector-mobileBehavior"');
    expect(html, "the old rail's featureColor id is gone (removed, not merely hidden)").not.toContain('<select id="lg-inspector-featureColor"');
    expect(html, "the old rail's buttonBackground id is gone").not.toContain('<select id="lg-inspector-buttonBackground"');
    expect(html, "the old rail's buttonText id is gone").not.toContain('<select id="lg-inspector-buttonText"');
    // the text family's own "Text color role" control (deliverable 2) is the
    // REAL home for featureColor now — pinned by id + the correct override key.
    expect(html, "the Text color role control exists").toContain('<select id="lg-text-color-role"');
    expect(html, "it writes the featureColor override key").toContain('data-inspector-override="featureColor"');
    // BOTTOM drawer: the D2 §8.7 mapping panel skeleton + the summary derived
    // from the seeded (complete) mapping — data preserved untouched.
    expect(html).toContain('data-studio-drawer-tab="mapping"');
    expect(html).toContain("data-mapping-summary");
    expect(html).toContain('data-publishable="true"');
    expect(html).toContain("1 mapping edge on this Section");
    expect(html).toContain("data-studio-mapping-table");
    expect(html).toContain("data-studio-offers-empty"); // the E9 slot
    expect(html).toContain("data-studio-inspector-mapping");
    // the mapping edges ride the state blob (pass-through to save)
    const data = extractJsonBlob(html, "lg-section-data");
    const maps = data["answer_maps"] as Array<Record<string, unknown>>;
    expect(maps).toHaveLength(1);
    expect(maps[0]).toMatchObject({ offer_id: offer.id, offer_payload_field_path: "data.insured", mapping_status: "complete" });
  });

  it("renders the Desktop/Mobile preview toggle + the §14.9 states simulator + §12.8 Maps toggle + continue-mode", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);

    // Desktop/Mobile preview toggle → drives POST /sections/preview (sandboxed iframe)
    expect(html).toContain('data-preview-viewport="desktop"');
    expect(html).toContain('data-preview-viewport="mobile"');
    expect(html).toContain('id="lg-preview-frame"');
    // §9.1 (D2): the srcdoc runs the REAL runtime bundle in preview mode —
    // scripts allowed, same-origin still withheld (opaque origin).
    expect(html).toContain('sandbox="allow-scripts"');
    // §8.9 design picker (preview under any registered design; "" = server default)
    expect(html).toContain('id="lg-preview-design"');
    expect(html).toContain('<option value="default-funnel">');
    // §14.9/§9.2 states simulator — ALL sims server-rendered via preview params
    for (const sim of ["default", "selected", "error", "dependency", "validation_success", "validation_error"]) {
      expect(html, `sim state ${sim}`).toContain(`data-sim-state="${sim}"`);
    }
    // §9.2: the outer-iframe attribute hacks are GONE — the iframe element
    // carries no data-viewport, and mobile sizing is a plain width class the
    // island swaps on re-render (server wrapper does the real sizing).
    const iframeTag = html.match(/<iframe[^>]*id="lg-preview-frame"[^>]*>/);
    expect(iframeTag).not.toBeNull();
    expect(iframeTag![0]).not.toContain("data-viewport");
    expect(html).not.toContain(".lg-preview-frame[data-viewport");
    expect(html).toContain(".lg-preview-frame-mobile{max-width:375px}");
    // R5 D2 (register S4-A2): the legacy global Maps/validation fieldset
    // (id="lg-address-validation", the wrangler-secret-name sentence) is
    // REMOVED — safe post-R4b (S3-8 proved per-field precedence in both
    // readers). No secret name renders anywhere on this surface any more.
    expect(html).not.toContain('id="lg-address-validation"');
    expect(html).not.toContain("GOOGLE_MAPS_BROWSER_KEY");
    expect(html).not.toContain("maps.googleapis.com"); // never embeds the Maps JS/key
    // continue-mode controls (§12.5; v3.1 §4.2 — "On answer" segmented
    // replaces the old native radio pair, same continue_mode store)
    expect(html).toContain('data-continue-mode="button"');
    expect(html).toContain('data-continue-mode="auto_advance"');
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
    // empty canvas + the D2 §8.7 panel skeleton (the island notes that a NEW
    // Section must save before the Available Offers derivation exists)
    expect(html).toContain("No components yet.");
    expect(html).toContain("data-studio-offers-note");
    expect(html).toContain("data-studio-offers-empty");
    expect(html).toContain("data-studio-mapping-table");
  });

  // R5 grant 1 (register S4-A1/A9/A10): the editor route is now a
  // self-contained full-bleed page — NO admin sidebar/header/LeadGen sub-tabs
  // (conductor-ratified pin, replacing the Stage-1 imprecise citation of
  // this file's :413 — the only pre-existing kodigital-admin-shell assertion
  // in this file is on the 404 fallback page below, which correctly KEEPS
  // the admin shell since it is not part of the golden-covered surface).
  it("the EDITOR route (both /new and /:id/edit) carries the standalone marker, NOT the admin shell — no sidebar/header/LeadGen tabs", async () => {
    const { env } = newHarness();
    const newHtml = await getHtml(env, "/admin/leadgen/sections/new");
    expect(newHtml).toContain('data-marker="kodigital-admin-standalone"');
    expect(newHtml).not.toContain('data-marker="kodigital-admin-shell"');
    expect(newHtml).not.toContain('class="admin-sidebar"');
    expect(newHtml).not.toContain('class="admin-header"');
    expect(newHtml).not.toContain('class="leadgen-tabs"');

    const section = await createSection(env);
    const editHtml = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);
    expect(editHtml).toContain('data-marker="kodigital-admin-standalone"');
    expect(editHtml).not.toContain('data-marker="kodigital-admin-shell"');
    expect(editHtml).not.toContain('class="admin-sidebar"');
    expect(editHtml).not.toContain('class="leadgen-tabs"');
  });

  // The Sections LIST page (a different route/page than the editor) is
  // UNCHANGED — it keeps the admin shell (sidebar/header/tabs), matching the
  // conductor's grant ("keep asserting the admin shell for the LIST page").
  it("the Sections LIST page (/admin/leadgen/sections) still carries the admin shell + LeadGen tabs, unlike the editor", async () => {
    const { env } = newHarness();
    const html = await getHtml(env, "/admin/leadgen/sections");
    expect(html).toContain('data-marker="kodigital-admin-shell"');
    expect(html).toContain('class="leadgen-tabs"');
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
    // A choice question seeds a choices array; the slider seeds internal_field.
    expect(seeds["ButtonAnswerGroup"]).toHaveProperty("choices");
    expect(seeds["NumberRangeQuestion"]).toMatchObject({ internal_field: "", answer_type: "number" });
    // chrome with no authorable answer fields seeds an empty (but present) object.
    expect(seeds["ProgressBar"]).toEqual({});
  });

  // v3.1 §8.2 (contract-v3.1.html): the old 9-panel strip (content/choices/
  // layout/design/validation/maps/dependencies/mapping/advanced) is REPLACED
  // by the golden's 5 dynamic tabs — Content/Style/Rules/Maps/Offers, with
  // Advanced now a persistent disclosure OUTSIDE the tab system (not a 6th
  // tab). The underlying mechanisms this test asserted (choices, the typed
  // conditional builder, internal_field/question_key, raw JSON) all survive,
  // relocated: choices/validation fold into Content, dependencies -> Rules,
  // mapping -> Offers, layout+design -> Style, advanced stays the one
  // ids/JSON surface (contract §8.8).
  it("the inspector renders the §8.2 5-tab structure + Advanced disclosure with the folded-in authoring controls", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);
    // the 5 dynamic tabs (§8.2)
    for (const tab of ["content", "style", "rules", "maps", "offers"]) {
      expect(html, `inspector tab ${tab}`).toContain(`data-studio-inspector-tab="${tab}"`);
      expect(html, `inspector panel ${tab}`).toContain(`data-studio-panel="${tab}"`);
    }
    // Advanced (§8.8): a persistent disclosure, not a data-studio-panel.
    expect(html).toContain("data-studio-advanced-toggle");
    expect(html).toContain("data-studio-advanced-body");
    // Advanced owns internal_field/question_key (+ the ONLY raw-JSON surface);
    // Content owns Required + choices; Rules the typed IF builder.
    expect(html).toContain('data-inspector-field="internal_field"');
    expect(html).toContain('data-inspector-field="question_key"');
    expect(html).toContain('data-inspector-field="required"');
    expect(html).toContain("data-studio-node-json");
    expect(html).toContain('data-inspector-cond="when"');
    expect(html).toContain('data-inspector-cond="op"');
    expect(html).toContain("data-inspector-choices");
    expect(html).toContain('id="lg-choice-add"');
    expect(html).toContain("data-choice-bulk"); // §8.6 bulk paste
    // LeadGen Rework §6.5: the old B9 "main/Other grouping" choiceDisplay
    // editor (data-choicedisplay="otherGroupEnabled") is retired, replaced by
    // the authored-values Other editor (props.other = {enabled, label,
    // choices}) — same choices-block region, current control markup.
    expect(html).toContain("data-other-editor-block");
    expect(html).toContain("data-other-enabled");
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

  it("the studio preserves answer_maps through the save body (D2 owns the §8.7 editing panel)", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    const section = await createSection(env, {
      answer_maps: [{ question_id: "q1", offer_id: offer.id, offer_payload_field_path: "data.insured", provider_expected_type: "boolean", required_for_offer: true }],
    });
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);

    // the raw §12.4 grid inputs are GONE from this surface (§8.7: no raw
    // numeric offer ids / free-text paths outside the Advanced drawer)…
    expect(html).not.toContain("data-map-field");
    expect(html).not.toContain('id="lg-mapping-add"');
    // …but the mapping edges still ride the state blob and the save body
    // (pass-through until the D2 picker panel).
    expect(html).toContain('data-studio-tab-mapping');
    // collectSection serializes BOTH the content nodes and the answer_maps
    expect(html).toContain("content_json: JSON.stringify(state.content)");
    expect(html).toContain("answer_maps: state.answer_maps");
    const data = extractJsonBlob(html, "lg-section-data");
    expect((data["answer_maps"] as unknown[]).length).toBe(1);
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

  // Rework M2 (§4.3-1 "shared first page"): the list page's Usage panel
  // script (SECTION_LIST_SCRIPT) must split a quote-owned shared-page usage
  // row (no funnel_public_id) from a true funnel-variant row instead of
  // rendering a misleading "Funnel › Variant ?" line — sections-handlers.ts's
  // readSectionUsageRows now emits both shapes in body.usage.variants. This
  // is a minimal shipped-source check (this list-page script has no jsdom/VM
  // execution harness in this suite — only the studio island does, further
  // below — matching this file's existing precedent for row-action scripts).
  it("Usage panel script discriminates shared-page rows (no funnel_public_id) from funnel-variant rows", async () => {
    const { env } = newHarness();
    const html = await getHtml(env, "/admin/leadgen/sections");
    const scripts = extractScripts(html).join("\n");
    expect(scripts).toContain("shared first page(s):");
    expect(scripts).toContain("!variants[i].funnel_public_id");
    expect(scripts).toContain("Not used by any funnel variant, shared page, or rule.");
  });
});

// ---------------------------------------------------------------------------
// §12.11 field-level mapping-completeness cell states — PORTED (D2): the old
// builder's renderMappingGrid is deleted with ui-question-builder.ts; the
// studio's live decode (edgeMapState/mapStateNote/offerLiveState, executed
// from the SERVED island) carries these assertions in
// test/leadgen-section-studio-ui.test.ts ("§8.7 mapping panel — ported §12.11
// cell states"). The SSR summary attrs (data-mapping-summary /
// data-publishable / data-required-missing) stay asserted in the editor
// describe above.
// ---------------------------------------------------------------------------

// MAJOR-#1 regression: mappingSummaryOf (the REAL editor derivation, not a
// hand-built MappingSummary) must agree with sectionValidationStatus — a
// per-edge non-complete mapping_status blocks publish even when the aggregated
// available-offer counts look complete.
describe("mappingSummaryOf — edge-level errors block publish (sectionValidationStatus parity)", () => {
  const cleanOffer: AvailableOfferRow = {
    offer_id: 7,
    selected: true,
    mapping_state: "complete",
    required_fields_total: 1,
    required_fields_mapped: 1, // aggregate looks fully mapped
  };
  const edge = (mapping_status: string): AnswerMapApiRow => ({
    question_id: "q1",
    question_key: "q1",
    internal_field: "f1",
    answer_type: "string",
    offer_id: 7,
    offer_payload_field_path: "data.f1",
    provider_expected_type: "string",
    output_value_map: null,
    value_transform: null,
    required_for_offer: true,
    default_value: null,
    fallback_value: null,
    mapping_status,
  });

  it("aggregate-clean + a complete edge → publishable", () => {
    const s = mappingSummaryOf([cleanOffer], [edge("complete")]);
    expect(s.publishable).toBe(true);
  });

  it("aggregate-clean but an `incomplete` edge → NOT publishable (the missed case)", () => {
    const s = mappingSummaryOf([cleanOffer], [edge("incomplete")]);
    expect(s.publishable).toBe(false);
  });

  it("aggregate-clean but a `type_mismatch` / `orphaned` edge → NOT publishable", () => {
    expect(mappingSummaryOf([cleanOffer], [edge("type_mismatch")]).publishable).toBe(false);
    expect(mappingSummaryOf([cleanOffer], [edge("orphaned")]).publishable).toBe(false);
  });

  it("an `invalid` offer state → NOT publishable even with complete edges", () => {
    const invalid: AvailableOfferRow = { ...cleanOffer, mapping_state: "invalid" };
    expect(mappingSummaryOf([invalid], [edge("complete")]).publishable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P6 editor wiring — §12.3 dependency simulator + §30.2 Maps-key state
// ---------------------------------------------------------------------------

describeDb("leadgen section editor — P6 dependency preview + §30.2 Maps-key state", () => {
  it("renders the §12.3 dependency simulator control + wires it to /sections/preview via §9.2 sim params", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);
    // the dependency sample-answers panel + apply control + aria-live status line
    expect(html).toContain("data-dependency-panel");
    expect(html).toContain("data-dependency-answers");
    expect(html).toContain('id="lg-dependency-apply"');
    expect(html).toContain("data-dependency-status");
    // the sim buttons drive the state variable
    expect(html).toContain('data-sim-state="dependency"');
    expect(html).toContain("simState = stateName");
    // §9.2: runPreview sends the parameterized body — viewport + sim {state,
    // answers} (answers on every non-default sim) — and consumes preview.html
    expect(html).toContain("function sampleAnswers(");
    expect(html).toContain("function renderDependencyStatus(");
    expect(html).toContain("viewport: previewViewport");
    expect(html).toContain("sim: { state: simState }");
    expect(html).toContain("requestBody.sim.answers = sampleAnswers()");
    expect(html).toContain("simState !== 'default'");
    expect(html).toContain("res.body.preview.html");
    // the legacy body key is gone from the island
    expect(html).not.toContain("requestBody.sample_answers");
  });

  it("§9.2: the outer-iframe attribute hacks are DELETED from the island source", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);
    const island = extractScripts(html).find((s) => s.includes("runPreview"));
    expect(island, "builder island present").toBeDefined();
    // the sim-state + viewport writes onto the iframe element are gone —
    // every sim/viewport is SERVER-rendered into the srcdoc markup
    expect(island!).not.toContain("setAttribute('data-sim-state'");
    expect(island!).not.toContain("setAttribute('data-viewport'");
    // the only frame attribute the island writes is the srcdoc itself
    expect(island!).toContain("setAttribute('srcdoc'");
    // mobile sizing = plain class swap on re-render (not an attribute selector)
    expect(island!).toContain("'lg-preview-frame lg-preview-frame-mobile'");
  });

  // R5 D2 (register S4-A2): the legacy fieldset carrying data-maps-key=
  // "absent"/"configured" is REMOVED — its informational job is covered by
  // the SEPARATE, already-wired data-studio-maps-banner (data-maps-key-
  // configured="true"/"false", studio:~2591 + the island's hide-when-
  // configured toggle at ~4535) inside the Preview drawer panel, asserted in
  // its own "SSR: the key-missing banner ships HIDDEN..." test — no
  // duplication needed here. The question-strip's "Google Maps: connected /
  // not connected" chip (data-maps-strip-chip) is the remaining SURFACE-LEVEL
  // indicator; it carries no data-maps-key attribute (informational text
  // only — the Maps TAB per-field controls are the real mechanism).
  it("the legacy data-maps-key note is gone; the question-strip chip reflects ABSENT/CONFIGURED via plain text only", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);
    expect(html).not.toContain("data-maps-key=");
    expect(html).toMatch(/Google Maps: not connected/);
  });

  it("the question-strip chip flips to 'connected' when the browser-key secret is present (value never embedded)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const withKey = { ...env, GOOGLE_MAPS_BROWSER_KEY: "browser-abc" } as Env;
    const res = await admin.request(`/admin/leadgen/sections/${section.public_id}/edit`, {}, withKey);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/Google Maps: connected/);
    expect(html).not.toContain("browser-abc"); // §30.2 — the key VALUE is never embedded
  });
});

// ---------------------------------------------------------------------------
// §9.2 EXECUTED island probe — the REAL runPreview sliced from the served page
// runs in a vm whose fetch is the REAL admin router (client-vs-server-JSON
// seam: the request body the island BUILDS is served by the live handler and
// the island CONSUMES the live response — preview.html → srcdoc, class swap).
// ---------------------------------------------------------------------------

// Two-component content whose second question depends on the first (drives a
// real dependencies verdict through the executed round-trip).
const UI_DEP_CONTENT = {
  components: [
    { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
    {
      type: "FreeTextQuestion",
      question_id: "q2",
      question_key: "insurer_q",
      internal_field: "insurer",
      answer_type: "string",
      required: true,
      conditional: { when: "currently_insured", op: "eq", value: true },
    },
  ],
};

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

// Minimal element stand-in implementing exactly the DOM surface the preview
// slice touches (value/hidden/className, get/set/removeAttribute, text children).
interface ProbeEl {
  hidden: boolean;
  value: string;
  className: string;
  textContent: string;
  attrs: Map<string, string>;
  children: unknown[];
  readonly firstChild: unknown;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  appendChild(c: unknown): unknown;
  removeChild(c: unknown): unknown;
}

function probeEl(): ProbeEl {
  const attrs = new Map<string, string>();
  const children: unknown[] = [];
  return {
    hidden: false,
    value: "",
    className: "",
    textContent: "",
    attrs,
    children,
    get firstChild() {
      return children.length > 0 ? children[0]! : null;
    },
    setAttribute(k, v) {
      attrs.set(k, String(v));
    },
    getAttribute(k) {
      return attrs.has(k) ? attrs.get(k)! : null;
    },
    removeAttribute(k) {
      attrs.delete(k);
    },
    appendChild(c) {
      children.push(c);
      return c;
    },
    removeChild(c) {
      const i = children.indexOf(c);
      if (i !== -1) children.splice(i, 1);
      return c;
    },
  };
}

interface PreviewProbeOut {
  requestBody: Record<string, unknown>;
  url: string;
  frame: ProbeEl;
  probeFrame: ProbeEl;
  errEl: ProbeEl;
  statusEl: ProbeEl;
}

// Slice trimStr/sampleAnswers/renderDependencyStatus/runPreview out of the
// SERVED island, execute runPreview() in a vm, and route its fetch through
// the REAL admin router. Waits for the async chain to land (srcdoc or error).
async function runPreviewProbe(opts: {
  env: Env;
  island: string;
  content: unknown;
  simState: string;
  viewport: string;
  answersJson?: string;
  designValue?: string;
}): Promise<PreviewProbeOut> {
  const frame = probeEl();
  frame.className = "lg-preview-frame";
  const probeFrame = probeEl(); // the hidden §8.9 events probe (§14.9 fix)
  const errEl = probeEl();
  errEl.hidden = true;
  const statusEl = probeEl();
  const answersEl = probeEl();
  answersEl.value = opts.answersJson ?? "";
  const designEl = probeEl();
  designEl.value = opts.designValue ?? "";
  let captured: { url: string; init: RequestInit } | null = null;
  const sandbox = {
    document: {
      getElementById(id: string): ProbeEl | null {
        if (id === "lg-preview-frame") return frame;
        if (id === "lg-events-probe-frame") return probeFrame;
        if (id === "lg-preview-error") return errEl;
        if (id === "lg-dependency-answers") return answersEl;
        if (id === "lg-preview-design") return designEl;
        return null;
      },
      querySelector(sel: string): ProbeEl | null {
        return sel === "[data-dependency-status]" ? statusEl : null;
      },
      createTextNode(t: string): unknown {
        return { nodeType: 3, textContent: String(t) };
      },
    },
    fetch(url: string, init: RequestInit): Promise<Response> {
      captured = { url, init };
      return Promise.resolve(admin.request(url, init, opts.env));
    },
  };
  const source = [
    `var state = { content: ${JSON.stringify(opts.content)} };`,
    `var simState = ${JSON.stringify(opts.simState)};`,
    `var previewViewport = ${JSON.stringify(opts.viewport)};`,
    // wave 2 (§5.3 mode 5): runPreview consults the frame picker — slice the
    // SERVED frameContextBody with its empty default (no frame picked).
    "var framePick = { quote: '', funnel: '', variant: '', site: '' };",
    sliceIslandFunction(opts.island, "frameContextBody"),
    sliceIslandFunction(opts.island, "trimStr"),
    sliceIslandFunction(opts.island, "sampleAnswers"),
    sliceIslandFunction(opts.island, "renderDependencyStatus"),
    sliceIslandFunction(opts.island, "clearEventsList"), // D2: runPreview resets the events panel
    sliceIslandFunction(opts.island, "runPreview"),
    "runPreview();",
  ].join("\n");
  runInNewContext(source, sandbox);
  for (let i = 0; i < 200 && !frame.attrs.has("srcdoc") && errEl.hidden; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(captured, "island fetch executed").not.toBeNull();
  const { url, init } = captured!;
  return {
    url,
    requestBody: JSON.parse(String(init.body)) as Record<string, unknown>,
    frame,
    probeFrame,
    errEl,
    statusEl,
  };
}

describeDb("§9.2 executed island — runPreview against the REAL preview handler", () => {
  async function editorIsland(env: Env): Promise<string> {
    const html = await getHtml(env, "/admin/leadgen/sections/new");
    const island = extractScripts(html).find((s) => s.includes("function runPreview("));
    expect(island, "builder island present").toBeDefined();
    return island!;
  }

  it("dependency sim @ mobile: body carries viewport+sim.answers; srcdoc consumes preview.html; class swap (no attribute hacks)", async () => {
    const { env } = newHarness();
    const island = await editorIsland(env);
    const out = await runPreviewProbe({
      env,
      island,
      content: UI_DEP_CONTENT,
      simState: "dependency",
      viewport: "mobile",
      answersJson: '{"currently_insured": true}',
    });

    // --- the CLIENT-built request body (the §9.2 shape) ---------------------
    expect(out.url).toBe("/api/admin/leadgen/sections/preview");
    expect(out.requestBody["content_json"]).toBe(JSON.stringify(UI_DEP_CONTENT));
    expect(out.requestBody["viewport"]).toBe("mobile");
    expect(out.requestBody["sim"]).toEqual({ state: "dependency", answers: { currently_insured: true } });
    expect("design_id" in out.requestBody).toBe(false); // picker empty ⇒ omitted
    expect("sample_answers" in out.requestBody).toBe(false); // legacy key gone

    // --- the island CONSUMED the live server JSON ---------------------------
    expect(out.errEl.hidden).toBe(true);
    const srcdoc = out.frame.attrs.get("srcdoc") ?? "";
    // P4 §9.2/§14.9: a NON-default sim loads the STATIC server still — a
    // shell-shaped document carrying NO scripts (a runtime boot would re-apply
    // dependency visibility from an EMPTY answer store and re-hide the sim's
    // reveal). Ready by construction.
    expect(srcdoc.startsWith("<!doctype html>")).toBe(true);
    expect(srcdoc).toContain("<style>");
    expect(srcdoc).toContain('data-lg-preview="1"');
    expect(srcdoc).toContain('data-lg-ready="1"');
    expect(srcdoc).not.toContain("<script");
    // the MOBILE wrapper (the requested viewport), not desktop — the whole
    // static document IS markup (no bundle literals to scope away)
    expect(srcdoc).toContain("lg-preview-mobile");
    expect(srcdoc).not.toContain("lg-preview-desktop");
    // both dependency-visible questions rendered by the live handler
    expect(srcdoc).toContain('data-lg-question="q1"');
    expect(srcdoc).toContain('data-lg-question="q2"');
    // …while the hidden probe frame carries the RUNTIME events document, so
    // the §8.9 panel keeps its stream during static sims (§9.1)
    const probeDoc = out.probeFrame.attrs.get("srcdoc") ?? "";
    expect(probeDoc).toContain('id="lg-config"');
    expect(probeDoc).toContain('<script data-lg-runtime-version="');
    // mobile sizing = plain class swap on re-render; srcdoc is the ONLY
    // attribute the island writes on the iframe (hacks deleted)
    expect(out.frame.className).toBe("lg-preview-frame lg-preview-frame-mobile");
    expect([...out.frame.attrs.keys()]).toEqual(["srcdoc"]);
    // the live dependencies verdict landed in the status line (q2 visible +
    // required + unanswered ⇒ continue blocked)
    expect(out.statusEl.attrs.get("data-continue-blocked")).toBe("true");
  });

  it("selected sim @ desktop with the design picker: design_id rides; the srcdoc markup is SERVER-rendered selected state", async () => {
    const { env } = newHarness();
    const island = await editorIsland(env);
    const out = await runPreviewProbe({
      env,
      island,
      content: YESNO_CONTENT,
      simState: "selected",
      viewport: "desktop",
      answersJson: '{"currently_insured": true}',
      designValue: "default-funnel",
    });

    expect(out.requestBody["design_id"]).toBe("default-funnel");
    expect(out.requestBody["viewport"]).toBe("desktop");
    expect((out.requestBody["sim"] as Record<string, unknown>)["state"]).toBe("selected");

    const srcdoc = out.frame.attrs.get("srcdoc") ?? "";
    // P4 §9.2: the selected sim is a STATIC still — the whole document IS
    // markup (no config/runtime scripts on non-default sims)
    expect(srcdoc).not.toContain("<script");
    expect(srcdoc).toContain("lg-preview-desktop");
    expect(srcdoc).toContain('data-funnel-design="default-funnel"');
    // the SERVER rendered the selection into the markup — the client painted
    // nothing (E5: never attributes for the client to interpret)
    expect(srcdoc).toContain('aria-checked="true"');
    expect(srcdoc).toContain("lg-selected");
    // ADJ-R8: selected state now emits aria-checked (role="radio"), never aria-pressed
    expect(srcdoc).not.toContain('aria-pressed="true"');
    expect(out.frame.className).toBe("lg-preview-frame");
  });

  it("default sim sends NO sim.answers (classic full render request)", async () => {
    const { env } = newHarness();
    const island = await editorIsland(env);
    const out = await runPreviewProbe({
      env,
      island,
      content: YESNO_CONTENT,
      simState: "default",
      viewport: "desktop",
      answersJson: '{"currently_insured": true}', // affordance filled but state=default ⇒ ignored
    });
    expect(out.requestBody["sim"]).toEqual({ state: "default" });
    const srcdoc = out.frame.attrs.get("srcdoc") ?? "";
    // the DEFAULT state keeps FULL hydration: the runtime events document
    // (§9.1) with config + inlined bundle — markup-scoped assertions (the
    // bundle JS carries the class literal)
    expect(srcdoc).toContain('id="lg-config"');
    expect(srcdoc).toContain('<script data-lg-runtime-version="');
    const markup = srcdoc.slice(0, srcdoc.indexOf('<script type="application/json" id="lg-config">'));
    expect(markup).toContain("lg-preview-desktop");
    // P2b FIX-ROUND (adversarial review R2): styles.ts now emits `.lg-selected`
    // as a CSS SELECTOR (the live runtime's real selection marker gained a
    // paint rule) — that literal substring is now UNCONDITIONALLY present in
    // every page's <style> block, which `markup` still includes. The intent
    // here has always been narrower: no rendered ELEMENT is marked selected in
    // a DEFAULT (nothing pre-chosen) sim — a class-attribute-scoped match,
    // never matching the unrelated CSS ruleset text.
    expect(markup).not.toMatch(/class="[^"]*\blg-selected\b[^"]*"/);
    // …and the probe frame is PARKED (only ONE runtime document at a time)
    expect(out.probeFrame.attrs.has("srcdoc")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P5-F2 (ADJ-A7 fix-first) — SOURCE-OF-TRUTH.md A.1 #8 requires "Other" on
// Buttons/Cards; the R2 §5.7 A7 regression clause requires "the empty-label
// row is either preserved or rejected with a visible message (never silently
// dropped)". An Other-value row the operator ADDS and leaves fully blank
// (both label and value empty) must never be silently dropped. Driven
// (E10/E11) against the REAL served island — collectOther/computeIssues/the
// "+ Add value" click handler are sliced byte-identical from the page, cross-
// checked against the REAL server validator (validateSectionContent) —
// never a hand-built stand-in for either side of the boundary.
// ---------------------------------------------------------------------------

function studioIsland(html: string): string {
  const island = extractScripts(html).find((s) => s.includes("function collectOther("));
  expect(island, "studio island present").toBeDefined();
  return island!;
}

// Grab a bare `var X = ...; if (X) { ... }`-shaped statement block (the
// "+ Add value" wiring is not a `function name(...)` — sliceIslandFunction's
// marker does not match it) by balancing braces from the first `{` at/after
// the given start marker — the same algorithm sliceIslandFunction uses.
function sliceIslandBlock(script: string, startsWith: string): string {
  const start = script.indexOf(startsWith);
  expect(start, `island block starting "${startsWith}"`).toBeGreaterThan(-1);
  const open = script.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < script.length; i += 1) {
    if (script[i] === "{") depth += 1;
    else if (script[i] === "}") {
      depth -= 1;
      if (depth === 0) return script.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces while slicing island block "${startsWith}"`);
}

// A `var NAME = {...};` or `var NAME = [...];` statement — OTHER_VALUE_FIELDS
// (array) plus CHOICE_FIELD_LABELS/CHOICE_FIELD_PLACEHOLDERS (objects) that
// buildOtherValueRow/choiceCellWrap read.
function sliceIslandVar(script: string, name: string): string {
  const marker = `var ${name} = `;
  const start = script.indexOf(marker);
  expect(start, `island var ${name} present`).toBeGreaterThan(-1);
  const openIdx = start + marker.length;
  const openChar = script[openIdx];
  const closeChar = openChar === "[" ? "]" : "}";
  let depth = 0;
  for (let i = openIdx; i < script.length; i += 1) {
    if (script[i] === openChar) depth += 1;
    else if (script[i] === closeChar) {
      depth -= 1;
      if (depth === 0) return `${script.slice(start, i + 1)};`;
    }
  }
  throw new Error(`unbalanced while slicing island var ${name}`);
}

interface FakeTextNode {
  nodeType: number;
  textContent: string;
}

interface FakeEl {
  tag: string;
  className: string;
  value: string;
  checked: boolean;
  hidden: boolean;
  attrs: Map<string, string>;
  children: Array<FakeEl | FakeTextNode>;
  listeners: Record<string, Array<() => void>>;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  addEventListener(ev: string, fn: () => void): void;
  appendChild<T extends FakeEl | FakeTextNode>(c: T): T;
  querySelectorAll(sel: string): FakeEl[];
}

function isFakeEl(n: FakeEl | FakeTextNode): n is FakeEl {
  return Object.prototype.hasOwnProperty.call(n, "attrs");
}

// A minimal but REAL element stub — just enough DOM surface for
// buildOtherValueRow/choiceCellWrap/otherValueMoveBtn to construct a row and
// for collectOther()'s rows[i].querySelectorAll('[data-other-field]') to find
// its inputs (nested two levels deep), exactly like a real descendant query.
function makeFakeEl(tag: string): FakeEl {
  const attrs = new Map<string, string>();
  const children: Array<FakeEl | FakeTextNode> = [];
  const listeners: Record<string, Array<() => void>> = {};
  const el: FakeEl = {
    tag,
    className: "",
    value: "",
    checked: false,
    hidden: false,
    attrs,
    children,
    listeners,
    setAttribute(k, v) {
      attrs.set(k, String(v));
    },
    getAttribute(k) {
      return attrs.has(k) ? attrs.get(k)! : null;
    },
    removeAttribute(k) {
      attrs.delete(k);
    },
    addEventListener(ev, fn) {
      if (!listeners[ev]) { listeners[ev] = []; }
      listeners[ev]!.push(fn);
    },
    appendChild(c) {
      children.push(c);
      return c;
    },
    querySelectorAll(sel: string): FakeEl[] {
      const m = sel.match(/^\[([a-zA-Z0-9-]+)\]$/);
      const attrName = m ? m[1]! : "";
      const out: FakeEl[] = [];
      const walk = (node: FakeEl | FakeTextNode): void => {
        if (isFakeEl(node)) {
          if (attrName !== "" && node.attrs.has(attrName)) out.push(node);
          node.children.forEach(walk);
        }
      };
      children.forEach(walk);
      return out;
    },
  };
  return el;
}

function otherAddDocument(routes: Record<string, FakeEl>): Record<string, unknown> {
  return {
    createElement(tag: string): FakeEl {
      return makeFakeEl(tag);
    },
    createTextNode(t: string): FakeTextNode {
      return { nodeType: 3, textContent: String(t) };
    },
    querySelector(sel: string): FakeEl | null {
      return routes[sel] ?? null;
    },
  };
}

interface OtherProbeSandbox {
  state: { content: { components: unknown[] } };
  studioMeta: Record<string, unknown>;
  MAX_DEPTH: number;
  selectedQuestionId: string | null;
  document: Record<string, unknown>;
  [k: string]: unknown;
}

interface OtherProbe {
  sandbox: OtherProbeSandbox;
  run(expr: string): unknown;
}

// Boot a vm with computeIssues/collectOther + their pure/model collaborators
// sliced byte-identical from the SERVED island (never re-implemented).
function otherStudioProbe(html: string, content: unknown, docStub: Record<string, unknown>): OtherProbe {
  const island = studioIsland(html);
  const meta = extractJsonBlob(html, "lg-studio-meta");
  const sandbox: OtherProbeSandbox = {
    state: { content: JSON.parse(JSON.stringify(content)) as { components: unknown[] } },
    studioMeta: meta,
    MAX_DEPTH: (meta["max_depth"] as number) ?? 4,
    selectedQuestionId: null,
    document: docStub,
  };
  const source = [
    "function afterModelChange() {}",
    sliceIslandFunction(island, "trimStr"),
    sliceIslandFunction(island, "typeMeta"),
    sliceIslandFunction(island, "isContainerType"),
    sliceIslandFunction(island, "capsOf"),
    sliceIslandFunction(island, "cap"),
    sliceIslandFunction(island, "typeLabel"),
    sliceIslandFunction(island, "bindNodeType"),
    sliceIslandFunction(island, "walkTree"),
    sliceIslandFunction(island, "findRefIn"),
    sliceIslandFunction(island, "findRef"),
    sliceIslandFunction(island, "selectedNode"),
    sliceIslandFunction(island, "ensureObj"),
    sliceIslandFunction(island, "cleanupEmpty"),
    sliceIslandFunction(island, "computeIssues"),
    sliceIslandFunction(island, "collectOther"),
  ].join("\n");
  runInNewContext(source, sandbox);
  return {
    sandbox,
    run(expr: string): unknown {
      return runInNewContext(expr, sandbox);
    },
  };
}

const OTHER_BASE_CONTENT = {
  components: [
    {
      type: "ButtonAnswerGroup",
      question_id: "q_make",
      internal_field: "car_make",
      answer_type: "enum",
      choices: [{ label: "Toyota", value: "toyota", analytics_id: "c_toyota" }],
    },
  ],
};

// A hand-built docStub row (no DOM construction needed) representing an
// already-authored [data-other-row] with the given label/value/analytics_id
// input values.
function otherRowStub(label: string, value: string, analyticsId: string): { querySelectorAll(sel: string): unknown[] } {
  const field = (f: string, v: string) => ({ getAttribute: () => f, value: v });
  return {
    querySelectorAll(sel: string) {
      return sel === "[data-other-field]" ? [field("label", label), field("value", value), field("analytics_id", analyticsId)] : [];
    },
  };
}

// P5-F11: `enabledCb` defaults to a FRESH { checked: true } literal (the
// existing call sites' behavior, unchanged) but callers that need to inspect
// the checkbox's `.checked` state AFTER collectOther()/populateOtherEditor()
// have run (P5-F11's "never silently unchecked" assertion) can pass their
// OWN persistent reference in.
function otherDocStub(rows: unknown[], labelValue: string, enabledCb: { checked: boolean } = { checked: true }): Record<string, unknown> {
  const otherList = {
    querySelectorAll(sel: string) {
      return sel === "[data-other-row]" ? rows : [];
    },
  };
  return {
    getElementById: () => null,
    querySelector(sel: string) {
      if (sel === "[data-other-enabled]") return enabledCb;
      if (sel === "[data-other-fields]") return { hidden: false };
      if (sel === "[data-other-label]") return { value: labelValue };
      if (sel === "[data-other-values]") return otherList;
      return null;
    },
    querySelectorAll: () => [],
  };
}

describeDb("P5-F2 (ADJ-A7 fix-first) — an empty Other row is never silently dropped", () => {
  it("clicking + Add value and leaving both inputs empty surfaces a VISIBLE issue and never silently persists (fail-before/pass-after)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);
    const island = studioIsland(html);

    const enabledCb = makeFakeEl("input");
    enabledCb.checked = true; // Other already enabled
    const fieldsWrap = makeFakeEl("div");
    const labelEl = makeFakeEl("input");
    const listEl = makeFakeEl("div"); // starts with ZERO rows — nothing authored yet
    const addBtn = makeFakeEl("button");
    const routes: Record<string, FakeEl> = {
      "[data-other-enabled]": enabledCb,
      "[data-other-fields]": fieldsWrap,
      "[data-other-label]": labelEl,
      "[data-other-values]": listEl,
      "[data-other-add]": addBtn,
    };

    const probe = otherStudioProbe(html, OTHER_BASE_CONTENT, otherAddDocument(routes));
    probe.run(
      [
        sliceIslandVar(island, "OTHER_VALUE_FIELDS"),
        sliceIslandVar(island, "CHOICE_FIELD_LABELS"),
        sliceIslandVar(island, "CHOICE_FIELD_PLACEHOLDERS"),
        sliceIslandFunction(island, "choiceCellWrap"),
        sliceIslandFunction(island, "otherValueMoveBtn"),
        sliceIslandFunction(island, "buildOtherValueRow"),
      ].join("\n"),
    );
    probe.sandbox.selectedQuestionId = "q_make";
    // register the REAL "+ Add value" click wiring, byte-identical to the
    // served island — never a re-implementation of its logic.
    probe.run(sliceIslandBlock(island, "var otherAddEl = document.querySelector('[data-other-add]');"));
    expect(addBtn.listeners["click"]?.length, "click handler registered").toBe(1);

    expect(listEl.children.length, "no row before the click").toBe(0);
    addBtn.listeners["click"]![0]!(); // simulate the operator's click

    expect(listEl.children.length, "the click appends one row").toBe(1);
    const node = probe.sandbox.state.content.components[0] as {
      props?: { other?: { choices?: Array<Record<string, unknown>> } };
    };
    // the click alone (no keystroke) already reached the model — the row is
    // preserved (not silently dropped before validation could see it).
    expect(node.props?.other?.choices, "the blank row reached props.other.choices").toEqual([{}]);

    // VISIBLE in the issues chip — the operator-facing text, not an internal flag.
    const issues = probe.run("computeIssues()") as Array<{ qid: string | null; message: string }>;
    const otherIssues = issues.filter((i) => i.qid === "q_make" && i.message.includes('"Other"'));
    expect(otherIssues.length, JSON.stringify(issues)).toBeGreaterThan(0);
    expect(otherIssues.some((i) => i.message.includes("missing its label")), JSON.stringify(otherIssues)).toBe(true);

    // save blocked — the REAL server validator (the same function the save
    // route calls) rejects this exact content, matching the value-without-
    // label row's already-working rejection one row over.
    const serverResult = validateSectionContent(probe.sandbox.state.content);
    expect(serverResult.ok).toBe(false);
    expect(
      serverResult.errors.some((e) => e.code === "invalid_choice" && e.path.includes("props.other.choices[0].label")),
      JSON.stringify(serverResult.errors),
    ).toBe(true);

    // never silently dropped: the row is STILL in the model after the
    // blocked save (nothing purges it) — exactly where the operator left it.
    expect(node.props?.other?.choices).toEqual([{}]);
  });

  it("regression guard: an Other row with a value but an empty label still fires the existing 'missing its label' issue", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);
    const probe = otherStudioProbe(html, OTHER_BASE_CONTENT, otherDocStub([otherRowStub("", "diesel", "")], ""));
    probe.sandbox.selectedQuestionId = "q_make";
    probe.run("collectOther()");
    const node = probe.sandbox.state.content.components[0] as {
      props?: { other?: { choices?: Array<Record<string, unknown>> } };
    };
    expect(node.props?.other?.choices).toEqual([{ value: "diesel", analytics_id: "diesel" }]);
    const issues = probe.run("computeIssues()") as Array<{ qid: string | null; message: string }>;
    expect(
      issues.some((i) => i.qid === "q_make" && /"Other".*missing its label/.test(i.message)),
      JSON.stringify(issues),
    ).toBe(true);
  });

  it("Other enabled, label+value filled: no issue; the choice persists validly", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);
    const probe = otherStudioProbe(html, OTHER_BASE_CONTENT, otherDocStub([otherRowStub("Diesel", "diesel", "c_diesel")], "Fuel type"));
    probe.sandbox.selectedQuestionId = "q_make";
    probe.run("collectOther()");
    const node = probe.sandbox.state.content.components[0] as {
      props?: { other?: { enabled?: boolean; label?: string; choices?: Array<Record<string, unknown>> } };
    };
    expect(node.props?.other).toEqual({
      enabled: true,
      label: "Fuel type",
      choices: [{ label: "Diesel", value: "diesel", analytics_id: "c_diesel" }],
    });
    const issues = probe.run("computeIssues()") as Array<{ message: string }>;
    expect(issues.some((i) => i.message.includes('"Other"')), JSON.stringify(issues)).toBe(false);
    const serverResult = validateSectionContent(probe.sandbox.state.content);
    expect(serverResult.errors.filter((e) => e.path.includes("props.other"))).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // P5-F11 fix-first -- the IDENTICAL ADJ-A7 class applied to the ENABLE FLAG
  // rather than a value row. Driven repro: enable Other (a starter row is
  // auto-seeded) then remove that row -- the checkbox stays checked but the
  // values list is now empty. collectOther() used to take the SAME `else`
  // branch as an explicit uncheck and silently `delete props.other`: the "No
  // issues" chip read clean, save 200'd, and on reload "Enable Other" came
  // back unchecked -- the operator checked a box, the product quietly
  // unchecked it, and nothing said so. This test SUPERSEDES the
  // identically-shaped test this replaces (which asserted that exact silent
  // clear as correct for `otherDocStub([], "")` -- it was the bug this fixes).
  //
  // Discriminator: collectOther's keep-vs-delete decision is now the
  // checkbox's own `enabled` boolean ALONE, never choices.length. An
  // explicit uncheck (enabled === false) is the only path that still
  // deletes props.other; it cannot misfire into this zero-rows-but-checked
  // case because that case has enabled === true by construction (the
  // operator never touched the checkbox to get here). computeIssues() then
  // mirrors the schema's "choices non-empty" rule as a VISIBLE issue for the
  // retained empty-choices shape -- the same preserve-then-let-validation-
  // flag-it mechanism P5-F2 (ADJ-A7) established one row over, reused
  // rather than reinvented.
  // -------------------------------------------------------------------------
  it("P5-F11: Other enabled with ZERO value rows is a VISIBLE issue, the real server validator blocks the save, and the enable checkbox is never silently unchecked (fail-before/pass-after)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);
    const island = studioIsland(html);
    const enabledCb = { checked: true }; // Other IS enabled; every row has since been removed
    const probe = otherStudioProbe(html, OTHER_BASE_CONTENT, otherDocStub([], "", enabledCb));
    probe.sandbox.selectedQuestionId = "q_make";
    probe.run("collectOther()");
    const node = probe.sandbox.state.content.components[0] as {
      props?: { other?: { enabled?: boolean; choices?: Array<Record<string, unknown>> } };
    };
    // never silently unchecked-by-omission: props.other is RETAINED (enabled
    // stays true) instead of being deleted just because choices is empty.
    expect(node.props?.other, "enabled Other with zero rows is preserved, not dropped").toEqual({ enabled: true, choices: [] });

    // VISIBLE in the issues chip -- the operator-facing text, not an internal flag.
    const issues = probe.run("computeIssues()") as Array<{ qid: string | null; message: string }>;
    const otherIssues = issues.filter((i) => i.qid === "q_make" && i.message.includes('"Other"'));
    expect(otherIssues.length, JSON.stringify(issues)).toBeGreaterThan(0);
    expect(
      otherIssues.some((i) => i.message.includes('has "Other" enabled with no values')),
      JSON.stringify(otherIssues),
    ).toBe(true);

    // save blocked -- the REAL server validator (the same function the save
    // route calls) rejects this exact content: props.other.choices must be
    // a non-empty array once props.other is present at all.
    const serverResult = validateSectionContent(probe.sandbox.state.content);
    expect(serverResult.ok).toBe(false);
    expect(
      serverResult.errors.some((e) => e.code === "invalid_field_prop" && e.path.includes("props.other.choices")),
      JSON.stringify(serverResult.errors),
    ).toBe(true);

    // the enable checkbox is never silently unchecked: simulating the exact
    // "on reload" redraw the defect described (populateOtherEditor
    // re-reading the model) still finds enabled === true and keeps the box
    // checked -- it was never flipped by anything in the blocked-save path.
    probe.run(
      [sliceIslandFunction(island, "clearChildren"), sliceIslandFunction(island, "populateOtherEditor")].join("\n"),
    );
    probe.run("populateOtherEditor(state.content.components[0])");
    expect(enabledCb.checked, "the enable checkbox stays checked after the blocked save").toBe(true);
  });

  // Constraint 1 (must not regress): an EXPLICIT uncheck still deletes
  // props.other silently and cleanly -- that is the operator saying so, and
  // it stays frictionless. The signal is enabledCb.checked === false, which
  // cannot coincide with the zero-rows-but-checked case above (that case is
  // checked === true by definition).
  it("constraint: explicitly UNCHECKING Other still deletes props.other silently and cleanly (no issue, no complaint)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, `/admin/leadgen/sections/${section.public_id}/edit`);
    const enabledCb = { checked: false }; // the operator just unchecked the box
    const probe = otherStudioProbe(
      html,
      OTHER_BASE_CONTENT,
      otherDocStub([otherRowStub("Diesel", "diesel", "c_diesel")], "Fuel type", enabledCb),
    );
    probe.sandbox.selectedQuestionId = "q_make";
    probe.run("collectOther()");
    const node = probe.sandbox.state.content.components[0] as { props?: { other?: unknown } };
    expect(node.props?.other, "explicit uncheck deletes props.other cleanly").toBeUndefined();
    const issues = probe.run("computeIssues()") as Array<{ message: string }>;
    expect(issues.some((i) => i.message.includes('"Other"')), JSON.stringify(issues)).toBe(false);
    const serverResult = validateSectionContent(probe.sandbox.state.content);
    expect(serverResult.errors.filter((e) => e.path.includes("props.other"))).toEqual([]);
  });
});
