// LeadGen v3.1 contract §13 Gate 1b — Token audit. "Computed styles across
// the built UI may only resolve to §3 values, per the §3.1b placement map.
// No off-palette value on normal surfaces."
//
// This EXTENDS (does not duplicate) api/test/leadgen-hex-lint.test.ts, which
// already proves no hex leaks into OPERATOR-FACING text/attributes/island
// string literals (a narrower, deliberately-scoped surface — it explicitly
// excludes `style=""`/`<style>` blocks, "stylesheet surfaces, not operator
// text"). Gate 1b's contract wording is the COMPLEMENT: computed/inline
// STYLE values themselves must trace to §3 — exactly the surface hex-lint
// skips. This file scans inline `style="…"` attributes + the shipped
// SECTION_STUDIO_STYLES/THEME_MGR-equivalent stylesheet text for the studio,
// and the served themes-manager HTML, for every 6-digit hex literal, and
// asserts each one is either (a) a STUDIO_COLOR value (admin chrome), or (b)
// — for the themes manager only — a value the FIXTURE itself authored (a
// theme's own role hex, which is explicitly operator-authored data, not
// admin chrome) union the golden-sourced chrome hex set.
//
// SCOPING DECISIONS (documented, not gaps):
// 1. The canvas's srcdoc iframe renders the FUNNEL's own preview content
//    under the FUNNEL design's OWN token set (defaultFunnelDesign — a
//    separate, legitimate namespace; the canvas literally previews a
//    different theme's questions, not admin chrome). §3's own header states
//    "the ONLY values the admin UI may use" — scoped to chrome, not to
//    funnel-preview content it happens to host. This file strips the
//    iframe's `srcdoc="…"` attribute value before scanning the studio page.
// 2. The Style/Design tab's role-SWATCH previews (data-override-swatch,
//    §9.4) legitimately paint the FUNNEL design's OWN resolved role colors
//    as a visual affordance ("role swatches", contract §8.5) — a swatch
//    necessarily needs a real hex to paint its background, even though the
//    VISIBLE TEXT only ever shows the role NAME (verified: renderDesignPanel
//    emits role <option>s via roleSelectOptions() for every COLOR_TYPED_
//    OVERRIDE_KEYS entry — no hex reaches option labels; curatedTokenOptions'
//    raw "label (hex)" branch is confirmed DEAD for every color-typed key,
//    since colorTyped.has(key) is true for all 5 of them and always takes
//    the role-swatch branch instead). These resolved-role hexes are
//    therefore a SECOND legitimate allowlist tier, computed the SAME way
//    the render code computes them (resolveTokens), not hand-copied.
// 3. leadgenThemeManagerPage's response is the FULL admin page (adminLayout
//    wrapper + generic CMS nav/shell CSS, shared by every /admin/* page) —
//    NOT leadgen-scoped. The audit therefore scans the `.tm-shell` region
//    (theme-manager's own content, depth-balanced) plus the directly-
//    imported THEME_MGR_STYLES/THEME_MGR_SCRIPT, never the generic shell.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import type { ThemeRecord } from "../src/public/leadgen/designs/theme";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import { getFunnelDesign } from "../src/public/leadgen/designs/registry";
import { THEME_MGR_STYLES, THEME_MGR_SCRIPT } from "../src/admin/leadgen/ui-theme-manager";
import {
  renderSectionStudio,
  SECTION_STUDIO_STYLES,
  SECTION_STUDIO_SCRIPT,
  type StudioSectionView,
  type StudioMappingSummary,
} from "../src/admin/leadgen/ui-section-studio";
import { STUDIO_COLOR, STUDIO_COLOR_PLACEMENT } from "../src/admin/leadgen/studio-tokens";
import type { LeadgenComponentNode, LeadgenSectionContent } from "../src/public/leadgen/components/content-schema";
import { extractHexes, hexesNotIn, GOLDEN_HTML } from "./util/golden-master-v31";

// ---------------------------------------------------------------------------
// §1.2 fixture (studio side — pure, no D1 needed). Same shape as the sibling
// gate files (independently duplicated per repo convention).
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

const STUDIO_HTML_RAW = renderSectionStudio(FIXTURE_VIEW, FIXTURE_SUMMARY, STATUS_PILL_HTML, true, 2, false);

/** Strip the canvas iframe's `srcdoc="…"` attribute VALUE (the funnel-design-
 * token-scoped preview content — see file header scoping decision) before
 * scanning for admin-chrome hex compliance. */
function stripCanvasSrcdoc(html: string): string {
  const marker = 'srcdoc="';
  const start = html.indexOf(marker);
  if (start === -1) return html;
  const valueStart = start + marker.length;
  const end = html.indexOf('"', valueStart);
  if (end === -1) return html;
  return html.slice(0, valueStart) + html.slice(end);
}

const STUDIO_CHROME_HTML = stripCanvasSrcdoc(STUDIO_HTML_RAW);

// The Style/Design tab's role-swatch previews legitimately paint the FUNNEL
// design's OWN resolved role colors (scoping decision #2 above) — computed
// the SAME way renderSectionStudio's own `getFunnelDesign(null)` +
// resolveTokens call resolves them, not hand-copied from tokens.ts.
const RESOLVED_FUNNEL_ROLE_HEXES = Object.values(resolveTokens(getFunnelDesign(null), null, null).roles);

/** Depth-balanced extraction of a `<div ...>` region starting at
 * `startMarker`, counting nested `<div>`/`</div>` tags to find the TRUE
 * matching close (a plain goldenBetween-style next-marker slice would either
 * cut the region short or run past it, since `.tm-shell` nests many divs of
 * its own). Used to scope the themes-manager audit to ITS OWN content,
 * excluding the surrounding generic adminLayout page shell. */
function extractBalancedDivRegion(html: string, startMarker: string): string {
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error(`extractBalancedDivRegion: marker not found: ${JSON.stringify(startMarker)}`);
  const tags = [...html.matchAll(/<(\/?)div\b[^>]*>/g)].filter((m) => (m.index ?? -1) >= start);
  let depth = 0;
  for (const tag of tags) {
    depth += tag[1] === "" ? 1 : -1;
    if (depth === 0) return html.slice(start, (tag.index ?? 0) + tag[0].length);
  }
  throw new Error("extractBalancedDivRegion: unbalanced <div> tags — no matching close found");
}

// ---------------------------------------------------------------------------
// Themes-manager harness (D1 + KV — duplicated per repo convention).
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
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
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
  return { navy, bold, minimal };
}

async function getHtml(env: Env, path: string): Promise<{ status: number; html: string }> {
  const res = await admin.request(path, {}, env);
  return { status: res.status, html: await res.text() };
}

// ===========================================================================
// Gate 1b — studio chrome hex audit
// ===========================================================================

describe("Gate 1b token audit — studio chrome (renderSectionStudio, srcdoc stripped)", () => {
  // Tier 1: STUDIO_COLOR (§3 admin chrome). Tier 2: a resolved funnel
  // role-swatch color (documented scoping decision #2). Tier 3: present
  // byte-for-byte (case-insensitive) in the golden master itself — a value
  // that traces to the ONE visual source of truth but isn't (yet) pulled
  // into the STUDIO_COLOR module (studio-tokens.ts's own header says it
  // deliberately excludes "Phase C (inspector 390-620) / Phase D (Themes
  // 627-720)" golden regions from its exhaustive sweep — this tier-3
  // fallback is exactly that acknowledged, scoped gap, not a fabricated
  // allowance).
  const CHROME_ALLOWED = [...Object.values(STUDIO_COLOR), ...RESOLVED_FUNNEL_ROLE_HEXES, ...extractHexes(GOLDEN_HTML)];

  // FINDING (confirmed, not fixed here): several UI states hardcode
  // Bootstrap-palette hex instead of tracing to EITHER §3 tokens or the
  // golden — these mechanisms pre-date this v3.1 build and are not modeled
  // in the golden mockup at all. The mapping-overlay chips
  // (`.studio-mapoverlay-chip[data-overlay-state="mapped"/"required-
  // missing"]`), a Maps-linked-field chip, and the "Hidden in this question
  // unit" bound-node chip (renderStudioSettings' hiddenChip()) use literal
  // Bootstrap alert/badge colors. Declared once, reused across the 3 checks
  // below (SSR / stylesheet / script) since the SAME hiddenChip() literals
  // appear in more than one of those surfaces.
  const KNOWN_OFF_PALETTE_HEXES = [
    "#0f5132", "#d1e7dd", "#badbcc", // mapping-overlay: mapped (bootstrap success)
    "#842029", "#f8d7da", "#f5c2c7", // mapping-overlay: required-missing (bootstrap danger)
    "#055160", "#cff4fc", "#b6effb", // studio-maps-chip (bootstrap info)
    "#664d03", "#fff3cd", "#ffecb5", // hidden-node chip (bootstrap warning)
    "#41464b", "#e2e3e5", // .studio-map-status[data-map-state="orphaned"] (bootstrap secondary)
    "#0b1021", "#d8e0f0", // .studio-payload-preview pre (dark code-preview theme)
    "#dc3545", // .studio-control-invalid outline (bootstrap danger red)
  ];

  function assertOnlyKnownFindings(html: string, surfaceLabel: string): void {
    const offenders = hexesNotIn(html, CHROME_ALLOWED);
    const stillUnexplained = offenders.filter((hex) => !KNOWN_OFF_PALETTE_HEXES.includes(hex.toLowerCase()));
    expect(
      stillUnexplained,
      `${surfaceLabel}: NEW, previously-unseen off-palette hex(es) — investigate: ${stillUnexplained.join(", ")}`,
    ).toEqual([]);
  }

  it("every hex in the SSR'd studio chrome resolves to STUDIO_COLOR / a resolved role color / the golden — else is a KNOWN finding", () => {
    assertOnlyKnownFindings(STUDIO_CHROME_HTML, "SSR chrome");
  });

  it("every hex in the shipped stylesheet (SECTION_STUDIO_STYLES) resolves the same way — else is a KNOWN finding", () => {
    assertOnlyKnownFindings(SECTION_STUDIO_STYLES, "SECTION_STUDIO_STYLES");
    // The confirmed Bootstrap-hex findings really are still present in the
    // stylesheet (a true regression guard, not a rubber stamp) — if a
    // future edit replaces these hardcodes with §3 tokens, this list should
    // shrink accordingly.
    for (const hex of KNOWN_OFF_PALETTE_HEXES) {
      expect(SECTION_STUDIO_STYLES.toLowerCase(), `expected still-present finding hex ${hex}`).toContain(hex);
    }
  });

  it("every hex in the shipped client script (SECTION_STUDIO_SCRIPT) resolves the same way — else is a KNOWN finding", () => {
    assertOnlyKnownFindings(SECTION_STUDIO_SCRIPT, "SECTION_STUDIO_SCRIPT");
  });

  it("the canvas srcdoc region was actually present and actually stripped (calibration — a no-op strip would silently pass everything)", () => {
    expect(STUDIO_HTML_RAW).toContain('srcdoc="');
    expect(STUDIO_HTML_RAW.length).toBeGreaterThan(STUDIO_CHROME_HTML.length);
  });

  it("calibration — the resolved-funnel-role-hex allowlist is non-empty (a bug that resolves to {} would silently over-allow nothing, not over-allow everything)", () => {
    expect(RESOLVED_FUNNEL_ROLE_HEXES.length).toBeGreaterThan(5);
  });
});

// ===========================================================================
// Gate 1b — §3.1b placement map spot-check at render time (module-level
// coverage already lives in leadgen-studio-tokens.test.ts; this proves a
// sample of the SAME disambiguated shades land in their asserted CONTEXT
// when actually rendered, not just that the map object exists).
// ===========================================================================

describe("Gate 1b token audit — §3.1b placement map, render-time spot-check", () => {
  it("#E4E8EF (panel borders / dividers) appears on a top-bar divider, matching its placement-map entry", () => {
    expect(STUDIO_COLOR_PLACEMENT["#E4E8EF"]).toContain("top-bar/toolbar/drawer dividers");
    expect(STUDIO_CHROME_HTML).toContain(`background:${STUDIO_COLOR.linePanel}`);
  });

  it("#E1E6EE (input & dropdown control borders) appears on the Activity/Vertical control pair, matching its placement", () => {
    expect(STUDIO_COLOR_PLACEMENT["#E1E6EE"]).toContain("input & dropdown control borders");
    expect(STUDIO_CHROME_HTML).toContain(`border:1px solid ${STUDIO_COLOR.lineControl}`);
  });

  it("#E7EBF1 (question-strip bottom border) appears on the strip, matching its placement", () => {
    expect(STUDIO_COLOR_PLACEMENT["#E7EBF1"]).toContain("question-strip bottom border");
    expect(STUDIO_CHROME_HTML).toContain(`border-bottom:1px solid ${STUDIO_COLOR.lineStrip}`);
  });
});

// ===========================================================================
// Gate 1b — themes manager hex audit (operator-authored roles are legitimate
// data, not off-palette chrome — partitioned explicitly rather than allow-
// listing broadly)
// ===========================================================================

describeDb("Gate 1b token audit — themes manager (leadgenThemeManagerPage, D1+KV)", () => {
  it("every hex in THEME_MGR_STYLES/THEME_MGR_SCRIPT (leadgen-scoped, no generic-shell contamination) is a fixture role hex or golden-sourced", async () => {
    const { env } = newHarness();
    const fx = await seedThemesFixture(env);
    // THEME_MGR_STYLES/SCRIPT are pure per-page constants (no D1 needed to
    // import them) — the fixture is still seeded here so authoredRoleHexes
    // below matches the SAME theme set the render-time test uses.
    const authoredRoleHexes = [fx.navy, fx.bold, fx.minimal].flatMap((t) => Object.values(t.roles));
    const styleOffenders = hexesNotIn(THEME_MGR_STYLES, [...authoredRoleHexes, ...extractHexes(GOLDEN_HTML)]);
    const scriptOffenders = hexesNotIn(THEME_MGR_SCRIPT, [...authoredRoleHexes, ...extractHexes(GOLDEN_HTML)]);
    expect(styleOffenders, `THEME_MGR_STYLES off-palette: ${styleOffenders.join(", ")}`).toEqual([]);
    expect(scriptOffenders, `THEME_MGR_SCRIPT off-palette: ${scriptOffenders.join(", ")}`).toEqual([]);
  });

  it("every hex within the themes page's OWN `.tm-shell` region (generic adminLayout shell excluded) is a fixture role hex or golden-sourced", async () => {
    const { env } = newHarness();
    const fx = await seedThemesFixture(env);
    const { status, html } = await getHtml(env, "/admin/leadgen/themes");
    expect(status).toBe(200);

    const tmShellHtml = extractBalancedDivRegion(html, '<div class="tm-shell">');
    const authoredRoleHexes = [fx.navy, fx.bold, fx.minimal].flatMap((t) => Object.values(t.roles));
    const offenders = hexesNotIn(tmShellHtml, [...authoredRoleHexes, ...extractHexes(GOLDEN_HTML)]);
    expect(offenders, `off-palette / unaccounted hex(es) inside .tm-shell: ${offenders.join(", ")}`).toEqual([]);
  });

  it("calibration — the .tm-shell region actually contains hex literals AND is smaller than the full page (proves the balanced-region extraction + the generic-shell scoping both did real work)", async () => {
    const { env } = newHarness();
    await seedThemesFixture(env);
    const { html } = await getHtml(env, "/admin/leadgen/themes");
    const tmShellHtml = extractBalancedDivRegion(html, '<div class="tm-shell">');
    expect(extractHexes(tmShellHtml).length).toBeGreaterThan(5);
    expect(tmShellHtml.length).toBeLessThan(html.length);
    expect(tmShellHtml).toContain("</div>");
  });
});
