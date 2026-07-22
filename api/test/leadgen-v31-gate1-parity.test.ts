// LeadGen v3.1 contract §13 Gate 1a — Markup parity vs the golden master
// (Appendix D "verbatim element index"). For every Appendix-D element
// present in the §1.2 fixture, assert the BUILT UI's tag structure /
// attributes / verbatim-or-computed-style-equivalent value + SVG path data
// match the committed golden (docs/leadgen/redesign-contract-v3/golden/
// golden-master-source.dc.html), via api/test/util/golden-master-v31.ts.
//
// §0 fidelity-vs-function: where the golden hardcodes a FAKE demo value
// (e.g. "≈ 384 px", the 60/40 A-B split, "width:64%"), this file asserts the
// FORMAT the real UI must share, never the fake number itself — those
// numbers are proven live-computed by Gate 4 (leadgen-v31-gate4-behavior)
// and the existing per-phase Playwright specs, referenced in
// leadgen-v31-gate-map.md.
//
// Split (mirrors leadgen-v31-gate3-geometry.test.ts's own harness split):
// STUDIO — renderSectionStudio(...) is a PURE function (confirmed: no D1/KV/
// Env needed), called directly with a hand-built §1.2 fixture. THEMES —
// leadgenThemeManagerPage(c) requires a live D1+KV Hono Context (no pure
// render function exists) — the harness below duplicates the proven
// node:sqlite pattern from api/test/leadgen-theme-manager-ui.test.ts (repo
// convention: every leadgen-*-ui.test.ts file keeps its own copy).
//
// A confirmed, real product<->golden divergence is asserted as CURRENT TRUE
// BEHAVIOR (never silently weakened, never asserted as false compliance) and
// flagged in comments + the phase report — see leadgen-v31-gate3-geometry's
// two documented findings (rail widths, toggle/checkbox styling), reused
// here as needed rather than re-litigated.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import type { ThemeRecord } from "../src/public/leadgen/designs/theme";
import {
  renderSectionStudio,
  STUDIO_LIBRARY_GROUPS,
  SECTION_STUDIO_SCRIPT,
  SECTION_STUDIO_STYLES,
  SECTION_STUDIO_CANVAS_FRAME_CSS,
  type StudioSectionView,
  type StudioMappingSummary,
} from "../src/admin/leadgen/ui-section-studio";
import { STUDIO_COLOR, STUDIO_GEOMETRY } from "../src/admin/leadgen/studio-tokens";
import type { LeadgenComponentNode, LeadgenSectionContent } from "../src/public/leadgen/components/content-schema";
import {
  goldenBetween,
  GOLDEN_HTML,
  GOLDEN_TOP_BAR,
  GOLDEN_QUESTION_STRIP,
  GOLDEN_CANVAS_TOOLBAR,
  GOLDEN_BOTTOM_DRAWER,
  GOLDEN_SCOPE_HEADER,
  GOLDEN_SCOPE_PILLS,
  GOLDEN_AFFECTS_LINE,
  GOLDEN_STYLE_TAB,
  GOLDEN_THEMES_TOPBAR,
  GOLDEN_THEMES_LEFT_LIST,
  GOLDEN_TILE_DATA_NAMES,
  goldenTileSvgs,
} from "./util/golden-master-v31";

// ---------------------------------------------------------------------------
// §1.2 fixture (studio side — pure, no D1 needed). Byte-identical to the
// fixture in leadgen-v31-gate3-geometry.test.ts (independently duplicated
// per the repo's per-file convention, not imported, so each gate file stays
// self-contained and independently re-runnable).
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
// Themes-manager harness (D1 + KV — duplicated per repo convention; see
// leadgen-v31-gate3-geometry.test.ts / leadgen-theme-manager-ui.test.ts for
// the identical pattern).
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

async function seedThemesFixture(env: Env): Promise<{ navy: ThemeRecord; bold: ThemeRecord; minimal: ThemeRecord }> {
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

  // §10.3/§10.5 fixture-value rule: "LIVE · A" requires an actual funnel
  // whose active control variant resolves to this theme — wire "Auto
  // Insurance"/Variant A to Navy so the badge is LIVE-COMPUTED, not asserted
  // against an unassigned theme (which would only ever read DRAFT).
  const quote = await jsonRes<{ funnels: Array<{ public_id: string }> }>(
    await admin.request(
      `${API}/quotes`,
      jsonInit("POST", {
        quote_name: "Gate1a Parity Fixture",
        activity: "quote_funnel",
        verticals: ["auto"],
        funnel_name: "Auto Insurance",
      }),
      env,
    ),
    "create quote",
  );
  const autoFunnelId = quote.funnels[0]!.public_id;
  await jsonRes(
    await admin.request(`${API}/funnels/${autoFunnelId}/theme`, jsonInit("PUT", { theme_json: { theme_id: navy.id } }), env),
    "set funnel theme",
  );

  return { navy, bold, minimal };
}

async function getHtml(env: Env, path: string): Promise<{ status: number; html: string }> {
  const res = await admin.request(path, {}, env);
  return { status: res.status, html: await res.text() };
}

// ===========================================================================
// Parser self-check — every Appendix D marker this suite depends on must
// resolve (a regression guard for golden-master-v31.ts itself).
// ===========================================================================

describe("Gate 1a parity — golden parser resolves every marker it exports", () => {
  it("every Appendix-D region is non-empty", () => {
    expect(GOLDEN_TOP_BAR.length).toBeGreaterThan(100);
    expect(GOLDEN_QUESTION_STRIP.length).toBeGreaterThan(100);
    expect(GOLDEN_CANVAS_TOOLBAR.length).toBeGreaterThan(50);
    expect(GOLDEN_BOTTOM_DRAWER.length).toBeGreaterThan(100);
    expect(GOLDEN_SCOPE_HEADER.length).toBeGreaterThan(50);
    expect(GOLDEN_THEMES_TOPBAR.length).toBeGreaterThan(20);
    expect(GOLDEN_THEMES_LEFT_LIST.length).toBeGreaterThan(50);
  });

  it("a bogus marker throws instead of silently returning an empty slice", () => {
    expect(() => goldenBetween("<!-- DOES NOT EXIST IN GOLDEN -->", "<!-- also fake -->")).toThrow(/start marker not found/);
  });
});

// ===========================================================================
// Top bar (Appendix D: "============ TOP BAR ============")
// ===========================================================================

describe("Gate 1a parity — top bar (Appendix D)", () => {
  it("region height + border-bottom + background match the golden's §3 token values", () => {
    expect(GOLDEN_TOP_BAR).toContain("height:56px");
    expect(GOLDEN_TOP_BAR).toContain("border-bottom:1px solid #E4E8EF");
    expect(STUDIO_HTML).toContain(`height:${56}px`);
    expect(STUDIO_HTML).toContain(`border-bottom:1px solid ${STUDIO_COLOR.linePanel}`);
    expect(STUDIO_COLOR.linePanel).toBe("#E4E8EF");
  });

  it("Sections back-chevron SVG path is byte-identical to golden", () => {
    const goldenSvg = '<path d="M14 6l-6 6 6 6" stroke="#5A6470" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    expect(GOLDEN_TOP_BAR).toContain(goldenSvg);
    expect(STUDIO_HTML).toContain(goldenSvg);
  });

  it("Save button is navy-filled, radius 8, weight 700 (golden: background:#1B3A5C...border-radius:8px)", () => {
    expect(GOLDEN_TOP_BAR).toContain("background:#1B3A5C;color:#fff;font-weight:700;font-size:13px;border-radius:8px");
    expect(STUDIO_HTML).toContain(">Save<");
    expect(STUDIO_HTML).toContain(`background:${STUDIO_COLOR.navy};color:${STUDIO_COLOR.white};font-weight:700;font-size:13px;border:0;border-radius:8px`);
  });

  it("Section-name eyebrow + Archive both render (golden: 'SECTION' eyebrow, Archive ghost/danger)", () => {
    expect(STUDIO_HTML).toContain(">Section<"); // eyebrow label (operator words; golden's ALL-CAPS is CSS text-transform, not the source string)
    expect(STUDIO_HTML).toContain(">Archive<");
    expect(GOLDEN_TOP_BAR).toContain(">Archive</div>");
  });

  it("the 'No issues' chip renders NEUTRAL (golden :49, §3.1b), not the pre-fix bootstrap green — this is the fixture-surface state (§1.2 fixture has 0 validation errors)", () => {
    // ENFORCES the golden (E2 part-2 reconciliation — a fixture-surface
    // finding the conductor caught after the F1-F6 close: the built chip
    // used Bootstrap #0f5132/#d1e7dd/#badbcc while golden :49 is a plain
    // neutral chip, color:#5A6470;background:#F1F3F7, no border).
    expect(GOLDEN_TOP_BAR).toContain("color:#5A6470;background:#F1F3F7");
    expect(STUDIO_HTML).toContain(">No issues<");
    expect(SECTION_STUDIO_STYLES).toContain(
      `.studio-chip-validation[data-issue-count="0"]{color:${STUDIO_COLOR.muted};background:${STUDIO_COLOR.issuesChipBg}`,
    );
    expect(SECTION_STUDIO_STYLES.toLowerCase(), "bootstrap green (#0f5132) gone from this rule").not.toMatch(
      /\.studio-chip-validation\[data-issue-count="0"\]\{color:#0f5132/,
    );
  });

  it("the sibling top-bar Mapping badge ('Mapping 2 / 2 complete') and the bottom-drawer Mapping badge ('2/2') were ALREADY §3-correct before this fix — regression guard, not a new conversion", () => {
    // Confirmed by direct read: renderStudioTopBar's mappingBadgeColor/
    // mappingBadgeBg already use STUDIO_COLOR.success/successTintAlt (golden
    // :45 color:#0E7C3A;background:#E9F4EE — byte-exact), and
    // renderStudioDrawer's drawer badge already uses STUDIO_COLOR.success/
    // mappingBadgeBg (golden :374 color:#0E7C3A;background:#DBEEE2 — byte-
    // exact). Neither needed a product fix; this test locks in the sibling
    // check the conductor asked for so a future edit can't silently regress
    // either one back to a bootstrap hex.
    expect(GOLDEN_TOP_BAR).toContain("color:#0E7C3A;background:#E9F4EE");
    expect(GOLDEN_BOTTOM_DRAWER).toContain("color:#0E7C3A;background:#DBEEE2");
    expect(STUDIO_COLOR.success).toBe("#0E7C3A");
    expect(STUDIO_COLOR.successTintAlt).toBe("#E9F4EE");
    expect(STUDIO_COLOR.mappingBadgeBg).toBe("#DBEEE2");
    expect(STUDIO_HTML).toContain(`color:${STUDIO_COLOR.success};background:${STUDIO_COLOR.successTintAlt}`);
    expect(STUDIO_HTML).toContain(`color:${STUDIO_COLOR.success};background:${STUDIO_COLOR.mappingBadgeBg}`);
  });
});

// ===========================================================================
// Question strip (Appendix D: "============ QUESTION STRIP ============")
// ===========================================================================

describe("Gate 1a parity — question strip (Appendix D)", () => {
  it("background + border-bottom + padding match golden verbatim (§3.1b: question-strip bottom border)", () => {
    expect(GOLDEN_QUESTION_STRIP).toContain("background:#F7F9FB;border-bottom:1px solid #E7EBF1");
    expect(GOLDEN_QUESTION_STRIP).toContain("padding:14px 20px 16px");
    expect(STUDIO_HTML).toContain(`background:${STUDIO_COLOR.stripBg};border-bottom:1px solid ${STUDIO_COLOR.lineStrip}`);
    expect(STUDIO_HTML).toContain("padding:14px 20px 16px");
    expect(STUDIO_COLOR.stripBg).toBe("#F7F9FB");
    expect(STUDIO_COLOR.lineStrip).toBe("#E7EBF1");
  });

  it("Activity/Vertical selects carry the fixture's selected value (Insurance/Car)", () => {
    expect(STUDIO_HTML).toContain('id="lg-section-activity"');
    expect(STUDIO_HTML).toContain('id="lg-section-vertical"');
    expect(STUDIO_HTML).toContain('value="Insurance" selected');
    expect(STUDIO_HTML).toContain('value="Car" selected');
  });

  it("headline/subheadline inputs carry the exact §1.2 fixture text", () => {
    expect(STUDIO_HTML).toContain('id="lg-section-headline"');
    expect(STUDIO_HTML).toContain(`value="What&#39;s your ZIP code?"`);
    expect(STUDIO_HTML).toContain('id="lg-section-subheadline"');
    expect(STUDIO_HTML).toContain(`value="Rates differ by up to 40% based on ZIP code"`);
  });
});

// ===========================================================================
// Component library — 20 unique tile SVGs (Appendix D: "All 20 tile SVGs")
// ===========================================================================

describe("Gate 1a parity — component library tile SVGs (Appendix D, source-constant level)", () => {
  it("STUDIO_LIBRARY_GROUPS carries every one of the 20 unique §5.5 data-names, and each golden tile's svg is byte-identical to the golden", () => {
    const allTiles = STUDIO_LIBRARY_GROUPS.flatMap((g) => g.tiles);
    const builtDataNames = new Set(allTiles.map((t) => t.dataName));
    for (const dataName of GOLDEN_TILE_DATA_NAMES) {
      expect(builtDataNames.has(dataName), `missing tile data-name=${dataName}`).toBe(true);
    }
    // P5 (PC-10): the v3.1 golden master captures the v3.1 palette; a POST-golden
    // tile (the "question grid…" MultiQuestionGrid asset, register golden:false)
    // has no v3.1 golden SVG to byte-match, so the SVG-parity check is scoped to
    // the golden tiles — its presence/label/order are proven by the enumeration
    // legs (leadgen-section-studio-ui / gate4) instead.
    const goldenNames = new Set<string>(GOLDEN_TILE_DATA_NAMES);
    for (const tile of allTiles) {
      if (!goldenNames.has(tile.dataName)) continue;
      const goldenSvgs = goldenTileSvgs(tile.dataName as (typeof GOLDEN_TILE_DATA_NAMES)[number]);
      expect(goldenSvgs, `tile "${tile.dataName}" svg not byte-identical to golden`).toContain(tile.svg);
    }
  });

  it("§5.2 four groups in exact order with the correct default open/collapsed state", () => {
    expect(STUDIO_LIBRARY_GROUPS.map((g) => g.key)).toEqual(["suggested", "answer-fields", "content", "layout"]);
    expect(STUDIO_LIBRARY_GROUPS.map((g) => g.label)).toEqual(["Suggested", "Answer fields", "Content", "Layout"]);
    expect(STUDIO_LIBRARY_GROUPS.find((g) => g.key === "layout")!.defaultOpen).toBe(false);
    for (const key of ["suggested", "answer-fields", "content"]) {
      expect(STUDIO_LIBRARY_GROUPS.find((g) => g.key === key)!.defaultOpen, key).toBe(true);
    }
  });

  // LeadGen Rework §4.1: the one-unit "Question grid" tile is retired — the
  // palette now offers the "Questions on one screen" STARTER at the same
  // position (one insert seeds 2 independent TwoButtonYesNo components, no
  // shared-grid data model). Pin updated to the contracted new reality; the
  // exhaustive 13-tile count + order this test proves is unchanged.
  it("§5.6 Answer-fields group holds the 12 v3.1 contract tiles + the §4.1 'Questions on one screen' starter, in order", () => {
    const group = STUDIO_LIBRARY_GROUPS.find((g) => g.key === "answer-fields")!;
    expect(group.tiles.map((t) => t.label)).toEqual([
      "Buttons",
      "Cards",
      "Yes / No",
      "Dropdown",
      "Multi-select",
      "Questions on one screen",
      "Short text",
      "Number",
      "Amount",
      "Date",
      "Slider",
      "Contact",
      "Address",
    ]);
  });
});

// ===========================================================================
// Canvas toolbar (Appendix D: "CANVAS TOOLBAR")
// ===========================================================================

describe("Gate 1a parity — canvas toolbar (Appendix D)", () => {
  it("breadcrumb root reads 'This section' and Desktop/Mobile viewport labels are present", () => {
    expect(GOLDEN_CANVAS_TOOLBAR).toContain("This section");
    expect(GOLDEN_CANVAS_TOOLBAR).toContain(">Desktop<");
    expect(GOLDEN_CANVAS_TOOLBAR).toContain(">Mobile<");
    expect(STUDIO_HTML).toContain("This section");
    expect(STUDIO_HTML).toContain(">Desktop<");
    expect(STUDIO_HTML).toContain(">Mobile<");
  });

  it("the funnel-layout toggle renders (U15 erratum for golden 'Frame hint') and the skeleton ships VISIBLE by default (§6.1: 'toggle (default ON)')", () => {
    // U15 operator-ordered clarity erratum (2026-07-15): the studio INTENTIONALLY
    // diverges from the golden's "Frame hint"/"Funnel frame" jargon — the
    // operator's 3rd retest flagged "frame" as incomprehensible. The golden
    // strings are still asserted (documenting the SOURCE the erratum departs
    // from); the studio ships the U15 copy (renderFrameHintSkeleton reclassified
    // golden:false in golden-allowlist.json).
    expect(GOLDEN_CANVAS_TOOLBAR).toContain("Frame hint"); // golden's original label
    expect(STUDIO_HTML).toContain("Show funnel layout"); // U15 erratum
    // Default-ON is achieved via a DIFFERENT (but behaviorally identical)
    // mechanism than the golden's demo: the golden's client script defaults
    // a `frameHint:true` state variable; the real product instead SSRs the
    // `[data-studio-frame-skeleton]` divs unconditionally VISIBLE (no
    // `hidden` attribute) and the client toggle only ADDS `hidden` when
    // switched off (ui-section-studio.ts's renderFrameHintSkeleton +
    // frameHintBtn click handler). Both reach the same observable default —
    // asserting the SSR-visible mechanism actually used.
    expect(STUDIO_HTML).toContain('data-studio-frame-skeleton="top"');
    expect(STUDIO_HTML).not.toMatch(/data-studio-frame-skeleton="top"[^>]*\shidden/);
    // U15 erratum: the golden's skeleton pill "Funnel frame" -> "Funnel layout".
    expect(STUDIO_HTML).toContain("Funnel layout");
    expect(STUDIO_HTML).toContain("Advertising disclosure");
  });
});

// ===========================================================================
// Selection chrome + 8 handles (Appendix D: "selection chrome for field") —
// 100% client-injected (no SSR markup at all, confirmed by direct read of
// renderStudioCanvas); asserted against the shipped client script bytes,
// which ARE part of "the built UI" served to the browser.
// ===========================================================================

// Appendix-B erratum (recorded 2026-07-14, remediation phase R2): the golden
// mockup's absolute handle rows (top -11 / mid +19 / bottom +49, only the mid
// pair interactive) encoded ONE demo field's fixed box — wrong by construction
// against any OTHER field (register S1-1/S1-2 measured dx=-6 dy=-6 dw=+12
// dh=+16 on a real 452x54 field). The golden's INTENT — selection chrome ON
// the element, all 8 handles usable — is what R2 delivers: every handle
// position is now MEASURED (getBoundingClientRect) and ALL EIGHT are
// interactive (4 corners drive width+height together with a diagonal cursor,
// 2 N/S mid-handles drive height only, 2 E/W mid-handles drive width only —
// the legacy pair). Proven at ±4px by the real-gesture overlay-alignment gate
// (api/test-ui/leadgen-canvas-interactions.gesture.spec.ts test (i), 7
// component types incl. helper-line/leading-icon fields that broke the old
// hardcode). These two tests pin the NEW binding contract so a future
// regression back to hardcoded/partial-interactive handles fails here.
function sliceScriptFunctionBody(name: string): string {
  const marker = `function ${name}(`;
  const start = SECTION_STUDIO_SCRIPT.indexOf(marker);
  expect(start, `${name} present in SECTION_STUDIO_SCRIPT`).toBeGreaterThan(-1);
  const open = SECTION_STUDIO_SCRIPT.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < SECTION_STUDIO_SCRIPT.length; i += 1) {
    if (SECTION_STUDIO_SCRIPT[i] === "{") depth += 1;
    else if (SECTION_STUDIO_SCRIPT[i] === "}") {
      depth -= 1;
      if (depth === 0) return SECTION_STUDIO_SCRIPT.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces slicing ${name}`);
}

describe("Gate 1a parity — selection chrome + 8 handles (Appendix D, client-script level)", () => {
  it("buildHandle is invoked exactly 8 times with the NEW binding contract (Appendix-B erratum): 4 corners drive BOTH axes with a diagonal cursor, 2 N/S mid-handles drive height only, 2 E/W mid-handles drive width only (the legacy pair) — every position argument is a MEASURED variable, never a signed numeric literal like the golden demo's -11/19/49", () => {
    // The regex's (\w+) position groups can ONLY match a bare identifier
    // (leftX/rightX/midX/topY/botY/midY, etc.) — a regression back to a
    // signed literal like "-11" would not match \w+ (no leading '-'), so a
    // hardcode regression drops call COUNT below 8, failing the toEqual below.
    const calls = [
      ...SECTION_STUDIO_SCRIPT.matchAll(
        /buildHandle\((\w+),\s*(\w+),\s*'([\w-]+)',\s*'([^']*)',\s*'([^']*)',\s*qid\)/g,
      ),
    ].map((m) => [m[3], m[4], m[5]]); // [cursor, wSide, hSide] per call
    expect(calls).toEqual([
      ["nwse-resize", "left", "top"], // NW corner
      ["nesw-resize", "right", "top"], // NE corner
      ["nesw-resize", "left", "bottom"], // SW corner
      ["nwse-resize", "right", "bottom"], // SE corner
      ["ns-resize", "", "top"], // N mid — height only
      ["ns-resize", "", "bottom"], // S mid — height only
      ["ew-resize", "left", ""], // W mid — width only (data-width-handle legacy pair)
      ["ew-resize", "right", ""], // E mid — width only (data-width-handle legacy pair)
    ]);
    // Interactivity is now a FUNCTION-LEVEL invariant, not a per-call boolean —
    // the golden's true/false 3rd argument is GONE. Scoped to buildHandle's OWN
    // body (not the whole script) so this doesn't collide with the selection
    // OUTLINE's unrelated, always-present "pointer-events:none" elsewhere.
    const buildHandleBody = sliceScriptFunctionBody("buildHandle");
    expect(buildHandleBody).toContain("el.addEventListener('mousedown', onWidthHandleMouseDown)");
    expect(buildHandleBody, "no more conditional branch on an 'interactive' flag").not.toContain("if (interactive)");
    expect(buildHandleBody, "no presentational (non-interactive) style ships from this function").not.toContain(
      "pointer-events:none",
    );
    expect(buildHandleBody).toContain("pointer-events:auto");
  });

  it("handle box geometry (11x11, radius 3, 2px navy border/fill) matches the surviving golden constants verbatim; per-axis cursors ship for all 4 directions", () => {
    expect(GOLDEN_TOP_BAR.length).toBeGreaterThan(0); // sanity the import graph is intact
    // The fixed-appearance literal is UNCONDITIONAL now (every handle, not just
    // the old mid pair): 11x11/radius-3/navy fill+border/box-sizing/auto-pointer.
    expect(SECTION_STUDIO_SCRIPT).toContain(
      `width:11px;height:11px;border-radius:3px;background:${STUDIO_COLOR.navy};border:2px solid ${STUDIO_COLOR.navy};box-sizing:border-box;pointer-events:auto`,
    );
    // all 4 per-axis cursors ship as real call-site literals (ew/ns = single
    // axis; nwse/nesw = the two diagonal corner cursors)
    for (const cursor of ["ew-resize", "ns-resize", "nwse-resize", "nesw-resize"]) {
      expect(SECTION_STUDIO_SCRIPT, `cursor literal '${cursor}'`).toContain(`'${cursor}'`);
    }
  });
});

// ===========================================================================
// Bottom drawer (Appendix D: "BOTTOM DRAWER BAR")
// ===========================================================================

describe("Gate 1a parity — bottom drawer (Appendix D)", () => {
  it("Mapping / Validation / Preview-in-a-quote tabs + Preview-theme switcher render", () => {
    for (const label of ["Mapping", "Validation", "Preview in a quote", "Preview theme:"]) {
      expect(GOLDEN_BOTTOM_DRAWER, label).toContain(label);
      expect(STUDIO_HTML, label).toContain(label);
    }
  });

  it("Mapping badge reads the LIVE-computed '2/2' for this fixture (golden hardcodes '2/2' as its fixture-value, §0 fidelity-vs-function)", () => {
    expect(GOLDEN_BOTTOM_DRAWER).toContain(">2/2<");
    expect(STUDIO_HTML).toContain(">2/2<"); // computed from FIXTURE_SUMMARY (2 mapped / 2 total), not a hardcode
    expect(STUDIO_HTML).toContain("Mapping 2 / 2 complete"); // top-bar badge, same computed k/n
  });
});

// ===========================================================================
// Inspector scope header (Appendix D: "scope header" / "scope pills" /
// "affects line")
// ===========================================================================

describe("Gate 1a parity — inspector scope header shell (Appendix D)", () => {
  it("scope pills read This section / This element verbatim (golden §8.1); the first pill is the U15 'Funnel layout' erratum", () => {
    // "This section"/"This element" stay golden-verbatim; the first pill is the
    // U15 operator-ordered clarity erratum (2026-07-15): golden "Funnel frame"
    // -> "Funnel layout" (renderScopePillsMarkup reclassified golden:false in
    // golden-allowlist.json; the data-scope-pill="frame" VALUE is unchanged).
    for (const pill of ["This section", "This element"]) {
      expect(GOLDEN_SCOPE_HEADER, pill).toContain(pill);
      expect(STUDIO_HTML, pill).toContain(pill);
    }
    expect(GOLDEN_SCOPE_HEADER, "golden's original first pill").toContain("Funnel frame");
    expect(STUDIO_HTML, "U15 erratum: the studio ships 'Funnel layout'").toContain("Funnel layout");
  });

  it("the 5 dynamic tab labels render in golden's exact order: Content, Style, Rules, Maps, Offers", () => {
    const tabRe = /data-studio-inspector-tab="(\w+)"[^>]*>([^<]+)</g;
    const found = [...STUDIO_HTML.matchAll(tabRe)].map((m) => m[2]);
    expect(found).toEqual(["Content", "Style", "Rules", "Maps", "Offers"]);
  });
});

// ===========================================================================
// Themes manager (Appendix D: "themes top bar", "LEFT: theme list")
// ===========================================================================

describeDb("Gate 1a parity — themes manager top bar + theme-list swatches (Appendix D, D1+KV)", () => {
  it("top bar title + subtitle + New-theme button match golden verbatim", async () => {
    const { env } = newHarness();
    await seedThemesFixture(env);
    const { status, html } = await getHtml(env, "/admin/leadgen/themes");
    expect(status).toBe(200);
    expect(GOLDEN_THEMES_TOPBAR).toContain(">Themes</span>");
    expect(GOLDEN_THEMES_TOPBAR).toContain("one look &amp; feel per funnel · A/B-testable in a quote");
    expect(GOLDEN_THEMES_TOPBAR).toContain("New theme");
    expect(html).toContain(">Themes<");
    expect(html).toContain("one look &amp; feel per funnel · A/B-testable in a quote");
    expect(html).toContain("New theme");
  });

  it("theme-list swatch strip renders the theme's OWN 4 role hexes (brand/accent/page_bg/text) — golden's are the pal() demo values for the SAME fixture", async () => {
    const { env } = newHarness();
    const fx = await seedThemesFixture(env);
    const { html } = await getHtml(env, "/admin/leadgen/themes");
    // golden pal().navy: brand #1B3A5C, accent #F5C518, bg #F4F6F9, text #1A1F36
    expect(fx.navy.roles.brand_primary).toBe("#1B3A5C");
    expect(fx.navy.roles.accent).toBe("#F5C518");
    expect(fx.navy.roles.page_bg).toBe("#F4F6F9");
    expect(fx.navy.roles.text).toBe("#1A1F36");
    expect(html).toContain("background:#1B3A5C");
    expect(html).toContain("background:#F5C518");
    expect(html).toContain("background:#F4F6F9");
  });

  it("LIVE · A / A/B · B / DRAFT badges match Appendix A verbatim", async () => {
    const { env } = newHarness();
    await seedThemesFixture(env);
    const { html } = await getHtml(env, "/admin/leadgen/themes");
    expect(html).toContain("LIVE · A");
    // Bold Yellow / Minimal have no funnel-variant wiring in this file's
    // minimal fixture (that wiring is exercised by leadgen-v31-gate3 and the
    // existing leadgen-theme-manager-ui.test.ts) — DRAFT is the correct
    // default for an unassigned theme.
    expect(html).toContain(">DRAFT<");
  });
});

// ===========================================================================
// Gate 1a/1b parity — audit-round G (final 3-auditor FIX-FIRST): the Studio
// chrome renders the golden's NAVY/ACCENT palette (FIX 1) and the §8.1 affects
// line is the golden cream callout with the accent star (FIX 2). Each assertion
// pairs a GOLDEN source string with the shipped product string.
// ===========================================================================
describe("Gate parity — audit-round G: navy/accent chrome + §8.1 affects callout", () => {
  // FIX 1a — the Studio scope-overrides the shell's generic --c-primary to the
  // §3 navy, so no control can inherit the #2563eb shell blue.
  it("FIX 1a: the Studio scope-overrides --c-primary to the §3 navy (chrome + canvas iframe), guarding against a shell re-blue", () => {
    expect(SECTION_STUDIO_STYLES).toContain(`.studio-root{--c-primary:${STUDIO_COLOR.navy}}`);
    expect(STUDIO_HTML).toContain('<div class="studio-root">');
    // same root cause on the canvas iframe (selection outline / drop hints).
    expect(SECTION_STUDIO_CANVAS_FRAME_CSS).toContain(`:root{--c-primary:${STUDIO_COLOR.navy};`);
    expect(SECTION_STUDIO_CANVAS_FRAME_CSS).not.toContain("#2563eb");
  });
  // FIX 1b — active inspector tab: navy text + 2px ACCENT underline (golden :759
  // tab() helper / Appendix B), never a navy underline.
  it("FIX 1b: the active inspector tab is a 2px accent (#F5C518) underline + navy text (golden tab helper)", () => {
    expect(GOLDEN_HTML).toContain("border-bottom:2px solid #F5C518");
    expect(SECTION_STUDIO_STYLES).toContain(
      `.studio-tab.active{border-bottom:2px solid ${STUDIO_COLOR.accent};color:var(--c-primary);font-weight:600}`,
    );
    // the previously-unused Appendix-B token now traces to this render.
    expect(STUDIO_GEOMETRY.activeTabUnderline).toBe(`2px ${STUDIO_COLOR.accent}`);
    // no longer a navy (var(--c-primary)) underline.
    expect(SECTION_STUDIO_STYLES).not.toContain(".studio-tab.active{border-bottom-color:var(--c-primary)");
  });
  // FIX 1d — active scope pill: solid navy chip, white text (golden :416).
  it("FIX 1d: the active scope pill is a solid navy chip with white text (golden 'This element')", () => {
    expect(GOLDEN_SCOPE_PILLS).toContain("color:#fff;background:#1B3A5C");
    expect(SECTION_STUDIO_STYLES).toContain(
      `.studio-scope-pill.active{border-color:${STUDIO_COLOR.navy};background:${STUDIO_COLOR.navy};color:${STUDIO_COLOR.white};font-weight:700}`,
    );
  });
  // FIX 1c — §7.3 custom chip: golden :529-530 bg/border/label/sub.
  it("FIX 1c: the §7.3 custom chip uses the golden bg #EAF0F6, border #C7D6E6, navy label, sub #5E799B (golden :529-530)", () => {
    expect(GOLDEN_STYLE_TAB).toContain("background:#EAF0F6;border:1px solid #C7D6E6");
    expect(GOLDEN_STYLE_TAB).toContain("color:#5E799B");
    expect(SECTION_STUDIO_STYLES).toContain(
      `.studio-custom-chip{display:flex;align-items:center;justify-content:space-between;gap:8px;background:${STUDIO_COLOR.navyTint};border:1px solid #C7D6E6`,
    );
    expect(SECTION_STUDIO_STYLES).toContain(".studio-custom-chip-label{font-size:12.5px;font-weight:700;color:var(--c-primary)}");
    expect(SECTION_STUDIO_STYLES).toContain(".studio-custom-chip-sub{font-size:10.5px;color:#5E799B}");
    // the chip border is no longer the (shell-blue-leaking) var(--c-primary).
    expect(SECTION_STUDIO_STYLES).not.toContain("border:1px solid var(--c-primary);border-radius:8px;padding:8px 10px;margin-bottom:10px}");
  });
  // FIX 2 — §8.1 affects line = cream callout + accent star (golden :420-421).
  it("FIX 2: the §8.1 affects line is a cream callout (#FBFBF3/#F0EAC9) with the accent star (golden :420-421)", () => {
    expect(GOLDEN_AFFECTS_LINE).toContain("background:#FBFBF3;border:1px solid #F0EAC9;border-radius:8px;padding:8px 10px");
    expect(GOLDEN_AFFECTS_LINE).toContain(
      'd="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5 20.2l1.4-6.8L1.3 8.9l6.9-.7z" fill="#F5C518"',
    );
    expect(SECTION_STUDIO_STYLES).toContain(
      ".studio-scope-affects{margin-top:11px;display:flex;align-items:flex-start;gap:7px;background:#FBFBF3;border:1px solid #F0EAC9;border-radius:8px;padding:8px 10px}",
    );
    expect(SECTION_STUDIO_STYLES).toContain(".studio-scope-affects-text{font-size:11.5px;color:#7A6B2E;line-height:1.45}");
    // the SSR scope header ships the accent star (fill = STUDIO_COLOR.accent).
    expect(STUDIO_HTML).toContain(
      `<path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5 20.2l1.4-6.8L1.3 8.9l6.9-.7z" fill="${STUDIO_COLOR.accent}"/>`,
    );
  });
});
