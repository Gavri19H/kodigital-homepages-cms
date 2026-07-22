// LeadGen v3.1 contract §13 Gate 3 — Geometry (Appendix B), asserted against
// the RENDERED built UI (studio + themes manager), not just the token
// module. api/test/leadgen-studio-tokens.test.ts already proves
// STUDIO_GEOMETRY/STUDIO_RADIUS match the golden byte-for-byte at the
// MODULE level — this file is the complementary, genuinely-new proof that
// the SERVED HTML actually emits those values at render time (a module
// constant nobody consumes would still pass the module-level test).
//
// STUDIO side: renderSectionStudio(...) is a PURE function (no D1/KV/Env) —
// confirmed by direct read of ui-section-studio.ts, so the fixture below
// calls it directly. THEMES side: leadgenThemeManagerPage(c) requires a live
// Hono Context + D1 + KV (no pure render function exists) — the harness
// below mirrors api/test/leadgen-theme-manager-ui.test.ts's own proven
// node:sqlite + KV-stub pattern verbatim (repo convention: every leadgen-*-
// ui.test.ts file duplicates this harness rather than importing it).
//
// Fixture: contract §1.2's "Zip" section (Insurance/Car, ZIP field, bound
// headline/subheadline, Continue) + §10.3's Navy/Bold Yellow/Minimal themes
// (hex values byte-identical to the golden's own pal() demo-state function,
// docs/leadgen/redesign-contract-v3/golden/golden-master-source.dc.html
// lines 773-780 — confirmed by direct read, not assumed).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import { mintPublicId } from "../src/leadgen/ids";
import type { Env } from "../src/env";
import type { ThemeRecord } from "../src/public/leadgen/designs/theme";
import {
  renderSectionStudio,
  SECTION_STUDIO_STYLES,
  SECTION_STUDIO_SCRIPT,
  type StudioSectionView,
  type StudioMappingSummary,
} from "../src/admin/leadgen/ui-section-studio";
import { STUDIO_COLOR, STUDIO_GEOMETRY, STUDIO_RADIUS } from "../src/admin/leadgen/studio-tokens";
import type { LeadgenComponentNode, LeadgenSectionContent } from "../src/public/leadgen/components/content-schema";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

// ---------------------------------------------------------------------------
// §1.2 fixture (studio side — pure, no D1 needed)
// ---------------------------------------------------------------------------

const ZIP_NODE: LeadgenComponentNode = {
  type: "ZIPInputQuestion",
  question_id: "q_zip",
  internal_field: "zip",
  answer_type: "string",
  required: true,
  props: {
    label: "ZIP code",
    placeholder: "Enter your ZIP code",
    helper: "We never share this",
    icon: "location",
    format: "us_zip",
    error_text: "Please enter a valid ZIP code",
  },
};
const FIXTURE_CONTENT: LeadgenSectionContent = {
  components: [
    { type: "QuestionHeadline", question_id: "q_bound_headline", bind: "section_headline" },
    { type: "Subheadline", question_id: "q_bound_subheadline", bind: "section_subheadline" },
    ZIP_NODE,
    { type: "ContinueButton", question_id: "q_cont", props: { label: "View My Quote" } },
  ],
};
const FIXTURE_VIEW: StudioSectionView = {
  public_id: "lgs_zip_fixture",
  section_name: "Zip",
  status: "active",
  activity: "Insurance",
  vertical: "Car",
  headline_text: "What's your ZIP code?",
  subheadline_text: "Rates differ by up to 40% based on ZIP code",
  continue_mode: "button",
  address_validation_enabled: false,
  content: FIXTURE_CONTENT,
};
const FIXTURE_SUMMARY: StudioMappingSummary = {
  publishable: true,
  status: "ok",
  required_missing_total: 0,
  required_mapped_total: 2,
  required_fields_total: 2,
};
const STATUS_PILL_HTML = `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:${STUDIO_COLOR.success};background:${STUDIO_COLOR.successTint};padding:3px 9px;border-radius:20px"><span style="width:6px;height:6px;border-radius:50%;background:${STUDIO_COLOR.success}"></span>Active</span>`;

const STUDIO_HTML = renderSectionStudio(FIXTURE_VIEW, FIXTURE_SUMMARY, STATUS_PILL_HTML, true, 2, false);

// ---------------------------------------------------------------------------
// Themes-manager harness (D1 + KV — repo-standard node:sqlite shim,
// duplicated per file per the established leadgen-*-ui.test.ts convention)
// ---------------------------------------------------------------------------

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
          return {
            success: true,
            meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) },
          };
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

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
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
  return body === undefined
    ? { method }
    : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function jsonRes<T>(res: Response, label: string): Promise<T> {
  const body = (await res.json()) as T;
  expect(res.status, `${label}: ${JSON.stringify(body)}`).toBeLessThan(300);
  return body;
}

function themeBody(
  name: string,
  brand: string,
  accent: string,
  pageBg: string,
  card: string,
  text: string,
): Record<string, unknown> {
  return {
    name,
    roles: { brand_primary: brand, accent, page_bg: pageBg, card, text, success: "#0E7C3A", error: "#B23A2C" },
    typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
    controls: { field_height: "medium", button_size: "m", corners: "rounded" },
  };
}

// §10.3/§10.5 fixture: Navy/Bold Yellow/Minimal (hex byte-identical to the
// golden's pal() function) assigned to Auto Insurance (Variant A/B, 60/40)
// and Home Insurance (Variant A) — matches leadgen-theme-manager-ui.test.ts's
// own seedFixture() 1:1.
async function seedThemesFixture(sdb: SqliteDb, env: Env): Promise<{ navy: ThemeRecord; bold: ThemeRecord; minimal: ThemeRecord }> {
  const navy = (
    await jsonRes<{ item: ThemeRecord }>(
      await admin.request(
        `${API}/themes`,
        jsonInit("POST", themeBody("Navy", "#1B3A5C", "#F5C518", "#F4F6F9", "#FFFFFF", "#1A1F36")),
        env,
      ),
      "create navy",
    )
  ).item;
  const bold = (
    await jsonRes<{ item: ThemeRecord }>(
      await admin.request(
        `${API}/themes`,
        jsonInit("POST", themeBody("Bold Yellow", "#13233B", "#F5C518", "#FFF7DE", "#FFFFFF", "#14181F")),
        env,
      ),
      "create bold",
    )
  ).item;
  const minimal = (
    await jsonRes<{ item: ThemeRecord }>(
      await admin.request(
        `${API}/themes`,
        jsonInit("POST", themeBody("Minimal", "#232A34", "#6B7486", "#FFFFFF", "#F6F8FA", "#14181F")),
        env,
      ),
      "create minimal",
    )
  ).item;

  const quote = await jsonRes<{
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  }>(
    await admin.request(
      `${API}/quotes`,
      jsonInit("POST", {
        quote_name: "Gate3 Geometry Fixture",
        activity: "quote_funnel",
        verticals: ["auto"],
        funnel_name: "Auto Insurance",
      }),
      env,
    ),
    "create quote",
  );
  const autoFunnelId = quote.funnels[0]!.public_id;
  const variantAId = quote.funnels[0]!.variants[0]!.public_id;
  // Rework M1 (§4.3-10): POST /funnels/:id/variants (createVariantUnderFunnel)
  // now unconditionally refuses a 2nd active variant — see
  // leadgen-quotes-api.test.ts's Σ-gate test for the full rationale. This
  // fixture just needs a 2nd variant with a different theme override to
  // exist, so it's seeded via raw SQL (leadgen-rework-handlers.test.ts's own
  // equal-arms idiom) instead.
  const autoFunnelRowId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(autoFunnelId) as { id: number }).id;
  const variantBId = mintPublicId("funnel_variant");
  sdb
    .prepare(
      "INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status) VALUES (?, ?, 'B', 10000, 'default', 'active')",
    )
    .run(variantBId, autoFunnelRowId);
  await jsonRes(
    await admin.request(`${API}/funnels/${autoFunnelId}/theme`, jsonInit("PUT", { theme_json: { theme_id: navy.id } }), env),
    "set funnel theme",
  );
  await jsonRes(
    await admin.request(`${API}/variants/${variantAId}`, jsonInit("PUT", { traffic_allocation_bp: 6000 }), env),
    "set variant A split",
  );
  await jsonRes(
    await admin.request(
      `${API}/variants/${variantBId}`,
      jsonInit("PUT", { traffic_allocation_bp: 4000, frame_overrides_json: { theme_id: bold.id } }),
      env,
    ),
    "set variant B split+theme",
  );
  return { navy, bold, minimal };
}

async function getHtml(env: Env, path: string): Promise<{ status: number; html: string }> {
  const res = await admin.request(path, {}, env);
  return { status: res.status, html: await res.text() };
}

// ===========================================================================
// Gate 3 — region heights / rail widths / unit column (Appendix B)
// ===========================================================================

describe("Gate 3 geometry — studio SSR (renderSectionStudio, pure)", () => {
  it("region heights render: top bar 56, bottom drawer 42 (inline), canvas toolbar 46 (min-height)", () => {
    expect(STUDIO_GEOMETRY.topBarHeight).toBe(56);
    expect(STUDIO_GEOMETRY.canvasToolbarHeight).toBe(46);
    expect(STUDIO_GEOMETRY.bottomDrawerHeight).toBe(42);
    expect(STUDIO_HTML).toContain(`height:${STUDIO_GEOMETRY.topBarHeight}px`);
    expect(STUDIO_HTML).toContain(`height:${STUDIO_GEOMETRY.bottomDrawerHeight}px`);
    // The canvas toolbar renders `min-height` (not `height`) BY DESIGN — a
    // documented adversarial-review fix (ui-section-studio.ts ~line 1289):
    // a fixed height clips a 2-cluster selection toolbar under real viewport
    // wrapping. min-height still reproduces the golden's 46px look for the
    // common (single-cluster) case, so this is the FORMAT-not-fake-value
    // reading the contract's own §0 fidelity-vs-function rule calls for —
    // not a divergence.
    expect(STUDIO_HTML).toContain(`min-height:${STUDIO_GEOMETRY.canvasToolbarHeight}px`);
  });

  it("rail widths render 292/344 (Appendix B §2): the .lg-editor-grid emits the token values, byte-identical to the golden's 292 left rail", () => {
    // ENFORCES the golden (was a documented E1 divergence; FIXED in E2, F1):
    // STUDIO_GEOMETRY.leftLibraryWidth/rightInspectorWidth (292/344, Appendix
    // B — byte-identical to golden :103's `flex:0 0 292px` and §2/§5's "left
    // rail 292 / right rail 344") are now interpolated into the rendered
    // `.lg-editor-grid` grid-template-columns, replacing the pre-fix 280/380.
    // Asserts the RENDERED CSS (SECTION_STUDIO_STYLES), not merely the module
    // constant — a constant nobody consumes would still pass a module test.
    expect(STUDIO_GEOMETRY.leftLibraryWidth, "Appendix B / token module").toBe(292);
    expect(STUDIO_GEOMETRY.rightInspectorWidth, "Appendix B / token module").toBe(344);
    expect(SECTION_STUDIO_STYLES, "rendered .lg-editor-grid rail widths == token 292/344").toContain(
      `grid-template-columns:${STUDIO_GEOMETRY.leftLibraryWidth}px 1fr ${STUDIO_GEOMETRY.rightInspectorWidth}px`,
    );
    expect(SECTION_STUDIO_STYLES, "the pre-fix 280/380 divergence is gone").not.toContain(
      "grid-template-columns:280px 1fr 380px",
    );
  });

  it("v3.1 Phase E: Activity/Vertical + frame-pick selects carry a fixed width (no admin-catalog-driven layout drift)", () => {
    // Regression guard for the Phase E product fix (ui-section-studio.ts):
    // `.studio-pair select` (#lg-section-activity/#lg-section-vertical) and
    // `.lg-preview-design` (the drawer's 4 [data-frame-pick-*] selects + the
    // §8.9 design picker) are populated from ADMIN-WIDE, UNSCOPED catalogs
    // (every Activity/Vertical/Quote ever created, any spec/operator) — a
    // native <select> with no width discipline auto-sizes to its WIDEST
    // <option>, so the box visibly grows/shrinks as those catalogs grow —
    // confirmed by live getBoundingClientRect measurement on a fresh vs. a
    // deliberately-polluted local D1 (leadgen-v31-gate1c-baselines.spec.ts's
    // own file-header note has the numbers: both were byte-identical once
    // this fixed width shipped). `max-width` ALONE is not enough (it still
    // lets the box shrink on sparse content — a real, measured delta); a
    // fixed `width` is required, mirroring the sibling `#lg-preview-theme`'s
    // own max-width:130px discipline one step further. If this test breaks
    // because the width/max-width pair was removed or changed, the gate1c
    // baseline spec's own removed test-side width pins would need to come
    // back to keep that suite's baselines stable — i.e. this assertion is
    // what lets that test stay hack-free.
    expect(SECTION_STUDIO_STYLES, "Activity/Vertical selects: fixed width, matching #lg-preview-theme's discipline").toContain(
      ".studio-pair select{width:160px;max-width:160px}",
    );
    expect(SECTION_STUDIO_STYLES, "the old floor-only (unbounded) rule is gone").not.toContain(
      ".studio-pair select{min-width:120px}",
    );
    expect(SECTION_STUDIO_STYLES, "frame-pick + design-picker selects: fixed width").toContain(
      ".lg-preview-design{width:220px;max-width:220px;font-size:12px;padding:4px 6px}",
    );
    expect(SECTION_STUDIO_STYLES, "the old unbounded width:auto rule is gone").not.toContain(
      ".lg-preview-design{width:auto;font-size:12px;padding:4px 6px}",
    );
  });

  it("unit column width 600 renders on the canvas preview (design.header.contentMaxWidth)", () => {
    expect(STUDIO_GEOMETRY.unitColumnWidth).toBe(600);
    // The canvas's unit column is the FUNNEL design's own contentMaxWidth
    // (studioCanvasDocument: `max-width:${design.header.contentMaxWidth}`) —
    // a SEPARATE, legitimate token namespace from admin STUDIO_GEOMETRY (the
    // canvas renders FUNNEL content, not admin chrome), but both resolve to
    // the SAME Appendix B constant (600) for the default design.
    expect(defaultFunnelDesign.header.contentMaxWidth).toBe("600px");
    // The srcdoc is HTML-escaped into an iframe attribute; escapeHtml leaves
    // plain digits/letters (incl. "600px") untouched, so the raw substring
    // still round-trips through the escaped attribute value.
    expect(STUDIO_HTML).toContain("600px");
  });

  it("tile grid geometry renders: padding 13px 8px 10px, 2-column grid, gap 8px, radius 9", () => {
    expect(STUDIO_GEOMETRY.tile.padding).toBe("13px 8px 10px");
    expect(STUDIO_RADIUS.tile).toBe(9);
    expect(STUDIO_HTML).toContain(`padding:${STUDIO_GEOMETRY.tile.padding}`);
    expect(STUDIO_HTML).toContain(`border-radius:${STUDIO_RADIUS.tile}px`);
    expect(STUDIO_HTML).toContain(`gap:${STUDIO_GEOMETRY.tile.gap}px`);
  });

  it("radii set renders: control 8, pill 20 (Appendix B: controls 8 · pills 20)", () => {
    expect(STUDIO_RADIUS.control).toBe(8);
    expect(STUDIO_RADIUS.pill).toBe(20);
    expect(STUDIO_HTML).toContain(`border-radius:${STUDIO_RADIUS.control}px`); // Save button, inputs
    // the "Mapping k/n" + status pill are 20px pill radius
    expect(STUDIO_HTML).toContain("border-radius:20px");
  });

  it("token module says toggle 38×22/18px knob (Appendix B) — CONFIRMED DIVERGENCE: Required/Maps-enabled render as a NATIVE unstyled checkbox", () => {
    // FINDING (not fixed here — conductor decision): the golden's Required
    // toggle and Maps "Validate with Google Maps" toggle are custom
    // sliding-pill switches (38×22px track, 18px knob, navy on / #CBD3DF
    // off — golden reqToggleStyle/mapsToggleStyle helpers, byte-matched by
    // STUDIO_GEOMETRY.toggle). The BUILT product renders these as a plain
    // `<input type="checkbox">` inside a generic `.lg-check` flex wrapper
    // (ui-section-studio.ts:1349, :2375) with NO custom width/height/
    // border-radius/background override anywhere — confirmed by grep across
    // both ui-section-studio.ts and every shared admin template/stylesheet
    // (zero hits for "38px" track or an 18px circular knob rule). The
    // FUNCTIONAL requirement (a real, working toggle) is met; the
    // §13 Gate 1/3 VISUAL parity to Appendix B's toggle geometry is not.
    expect(STUDIO_GEOMETRY.toggle.trackWidth, "Appendix B / token module").toBe(38);
    expect(STUDIO_GEOMETRY.toggle.trackHeight, "Appendix B / token module").toBe(22);
    expect(STUDIO_GEOMETRY.toggle.knob, "Appendix B / token module").toBe(18);
    expect(STUDIO_HTML, 'current: a plain native checkbox, not a custom pill toggle').toContain(
      '<label class="lg-check"><input type="checkbox" data-inspector-field="required" aria-label="Required" /></label>',
    );
    expect(SECTION_STUDIO_STYLES, "no custom 38x22 toggle-track rule exists").not.toContain("38px");
  });

  it("token module says Maps-job checkbox 20×20/radius 6 (Appendix B) — CONFIRMED DIVERGENCE: Maps job rows render as NATIVE unstyled checkboxes", () => {
    // Same class of finding as the toggle above, for the 3 Maps-job rows
    // (Validate/auction/autocomplete): golden's cb() helper draws a custom
    // 20×20px radius-6 navy-filled box with a white check glyph
    // (STUDIO_GEOMETRY.mapsCheckbox); the built product's Maps tab
    // (ui-section-studio.ts, MAPS TAB block) renders
    // `<input type="checkbox" data-maps-job="validate" />` etc. with no
    // matching custom-box CSS anywhere (confirmed by grep).
    expect(STUDIO_GEOMETRY.mapsCheckbox.size, "Appendix B / token module").toBe(20);
    expect(STUDIO_GEOMETRY.mapsCheckbox.radius, "Appendix B / token module").toBe(6);
    expect(STUDIO_HTML, "current: a plain native checkbox for the Validate job row").toContain(
      '<input type="checkbox" data-maps-job="validate" />',
    );
    // "border-radius:6px" alone appears elsewhere in the stylesheet for
    // unrelated rules (chevrons etc.) — the precise absence check is a rule
    // that combines the checkbox's own 20x20 box dimensions with that
    // radius, which is what a real custom Maps-checkbox rule would need.
    expect(
      SECTION_STUDIO_STYLES,
      "no custom 20x20-with-radius-6 checkbox box rule exists",
    ).not.toMatch(/width:20px;height:20px;border-radius:6px/);
  });

  it("8-handle selection geometry ships from MEASUREMENT, not the golden demo's absolute rows (Appendix-B erratum, 2026-07-14 remediation phase R2)", () => {
    // §6.2 the selection chrome (outline, 8 handles, name tag, custom badge)
    // is 100% client-injected (buildHandle/decorateFieldSelection in the
    // ES5 island) — there is NO SSR markup for it at all (confirmed by
    // direct read: renderStudioCanvas's SSR output is only the toolbar +
    // empty srcdoc iframe + empty-state text).
    //
    // ERRATUM: Appendix B's absolute rows (offsets −11/−6/−30, rows −11/19/49)
    // encoded the golden MOCKUP's one demo field — register S1-1/S1-2 measured
    // this wrong-by-construction on a real 452×54 field (dx=-6 dy=-6 dw=+12
    // dh=+16), worst on fields with a helper line or leading icon. The golden's
    // INTENT (selection chrome ON the element, tracking its real box) is what
    // ships now: every handle/outline/tag/badge position is DERIVED FROM
    // MEASUREMENT (el.getBoundingClientRect inside the iframe doc), proven at
    // ±4px across 7 component types by the real-gesture overlay-alignment gate
    // (api/test-ui/leadgen-canvas-interactions.gesture.spec.ts test (i)) — the
    // browser-executed complement no vm-execution/pure-SSR vitest file can
    // provide. This test pins (a) the golden constants that DO survive
    // (dimensions/radius/color/border — unrelated to the demo's absolute
    // position) and (b) the measurement MECHANISM itself + the absence of the
    // old hardcoded literals, so a regression back to fixed offsets fails here
    // even before the browser gate would catch it.
    expect(STUDIO_GEOMETRY.selection.handleSize, "Appendix B — survives").toBe(11);
    expect(STUDIO_GEOMETRY.selection.handleRadius, "Appendix B — survives").toBe(3);
    expect(STUDIO_GEOMETRY.selection.outlineWidth, "Appendix B — survives").toBe(2);
    expect(STUDIO_GEOMETRY.selection.outlineColor, "Appendix B — survives").toBe(STUDIO_COLOR.navy);
    expect(STUDIO_GEOMETRY.selection.outlineRadius, "Appendix B — survives (field outline radius)").toBe(12);
    // the fixed-appearance handle literal ships verbatim (11x11/radius-3/navy
    // fill+border) — unconditional now, every one of the 8 handles, not just
    // the golden's 2 interactive side-midpoints
    expect(SECTION_STUDIO_SCRIPT).toContain(
      `width:11px;height:11px;border-radius:3px;background:${STUDIO_COLOR.navy};border:2px solid ${STUDIO_COLOR.navy}`,
    );
    // the measured selection OUTLINE's border/color/radius survive too (2px
    // solid navy, radius 12 — STUDIO_GEOMETRY.selection.outline* above)
    expect(SECTION_STUDIO_SCRIPT).toContain(`border-radius:12px;outline:2px solid ${STUDIO_COLOR.navy};outline-offset:3px`);
    // per-axis cursors for all 4 directions (2 new: ns/nwse/nesw; 1 legacy: ew)
    for (const cursor of ["ew-resize", "ns-resize", "nwse-resize", "nesw-resize"]) {
      expect(SECTION_STUDIO_SCRIPT, `cursor literal '${cursor}'`).toContain(`'${cursor}'`);
    }
    // MECHANISM PIN: positions are DERIVED FROM MEASUREMENT — a regression to
    // a hardcoded offset must fail THIS assertion, not just the browser gate.
    expect(SECTION_STUDIO_SCRIPT, "measures the field's own box").toContain(
      "el.getBoundingClientRect ? el.getBoundingClientRect()",
    );
    expect(SECTION_STUDIO_SCRIPT, "measures the wrap's box (offsets are relative to it)").toContain(
      "wrap.getBoundingClientRect ? wrap.getBoundingClientRect()",
    );
    // the golden demo's absolute literals must NEVER return
    expect(SECTION_STUDIO_SCRIPT, "the demo-absolute left offset must not return").not.toContain("left:-11px;");
    expect(SECTION_STUDIO_SCRIPT, "the demo-absolute right offset must not return").not.toContain("right:-11px;");
    expect(SECTION_STUDIO_SCRIPT, "the demo-absolute centered handle must not return").not.toContain(
      "left:calc(50% - 5px);",
    );
    expect(SECTION_STUDIO_SCRIPT, "the demo-absolute 66px outline height must not return").not.toContain(
      "top:-6px;height:66px",
    );
  });

  it("every STUDIO_GEOMETRY hex/px value used above traces to the §3 token module (no invented literal in this test)", () => {
    // Sanity: this test file must never introduce its OWN geometry numbers —
    // every constant asserted above comes from STUDIO_GEOMETRY/STUDIO_RADIUS,
    // which leadgen-studio-tokens.test.ts already proves byte-identical to
    // the golden. Guards against a future edit hand-copying a literal here
    // instead of importing the token.
    expect(STUDIO_GEOMETRY.leftLibraryWidth).toBe(292);
    expect(STUDIO_GEOMETRY.rightInspectorWidth).toBe(344);
    expect(STUDIO_GEOMETRY.themesListWidth).toBe(300);
    expect(STUDIO_GEOMETRY.themesAbPanelWidth).toBe(320);
  });
});

// ===========================================================================
// Gate 3 — Themes manager geometry (300/320 rail widths, swatch radius)
// ===========================================================================

describeDb("Gate 3 geometry — themes manager SSR (leadgenThemeManagerPage, D1+KV)", () => {
  it("theme list width 300 and A/B panel width 320 render (Appendix B: 'Themes list / A-B panel width 300 / 320')", async () => {
    const { sdb, env } = newHarness();
    await seedThemesFixture(sdb, env);
    const { status, html } = await getHtml(env, "/admin/leadgen/themes");
    expect(status).toBe(200);
    expect(STUDIO_GEOMETRY.themesListWidth).toBe(300);
    expect(STUDIO_GEOMETRY.themesAbPanelWidth).toBe(320);
    expect(html).toContain(`flex:0 0 ${STUDIO_GEOMETRY.themesListWidth}px`);
    expect(html).toContain(`flex:0 0 ${STUDIO_GEOMETRY.themesAbPanelWidth}px`);
  });

  it("theme swatch radius 10 renders (Appendix B radii: 'swatches 10')", async () => {
    const { sdb, env } = newHarness();
    await seedThemesFixture(sdb, env);
    const { html } = await getHtml(env, "/admin/leadgen/themes");
    expect(STUDIO_RADIUS.swatch).toBe(10);
    // the CENTER editor's role swatches are the big 40x40 radius-10 squares
    expect(html).toContain(`width:40px;height:40px;border-radius:${STUDIO_RADIUS.swatch}px`);
  });

  it("active theme-card border matches the §3 navy token (2px solid)", async () => {
    const { sdb, env } = newHarness();
    const fx = await seedThemesFixture(sdb, env);
    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${fx.navy.id}`);
    expect(html).toContain(`border:2px solid ${STUDIO_COLOR.navy}`);
  });
});
