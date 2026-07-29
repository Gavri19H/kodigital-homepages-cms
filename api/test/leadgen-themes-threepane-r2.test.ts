// LeadGen R2 fixing mission — Phase P2 S2b: Themes tab three-pane rebuild.
// Contract A.1 #11-E ("Add a real section to the canvas...") + A.3 rejection
// (verbatim): "themes tab layout (left section chooser by activity/vertical,
// sticky center canvas, right design elements, no duplicate canvases)".
//
// Covers what THIS slice adds, NOT already covered elsewhere:
//   1. Structure — renderThemesTabPanel's own three-pane DOM: exactly ONE
//      canvas element, no placeholder strip, no ?embed=1 iframe, a left
//      chooser + a sticky center canvas + a right rail, the preset-apply-row
//      ids kept byte-stable (funnel.ts's wireThemePresets still drives them
//      unmodified), and the ES5 island present.
//   2. R7 register normalization — the REAL validateTheme (theme.ts,
//      unmodified, imported read-only) rejects {theme_id, <inline field>}
//      together (fail-before: the raw bug, real validator, not a hand-rolled
//      stand-in). The drop-theme_id-then-merge algorithm THEMES_TAB_SCRIPT's
//      flushThemeEdits applies is mirrored here as a plain function (the
//      script text itself is browser JS, not an importable TS unit) and
//      proven to produce a payload the SAME real validator accepts
//      (pass-after) — closing R7 for edits made through this rebuilt rail.
//   3. Image23 authoring — a real ButtonAnswerGroup section combining title+
//      subtitle choices AND an "Other" choice in ONE payload, saved through
//      the real save API, with the theme's button_defaults.layout="card" —
//      verified through the admin preview route (the render anatomy itself,
//      presets.ts/styles.ts, is already exhaustively unit-proven by
//      test/leadgen-rework-render.test.ts and test/leadgen-rework-themes-
//      ui.test.ts; this proves the FULL AUTHORING COMBINATION saves and
//      renders together, not each piece in isolation).
//
// Adjacent, NOT this slice's fix (reported to the conductor, not touched):
//   - A10 ("+ create" for activity/vertical uses raw prompt()) lives in
//     ui-section-studio.ts, outside this slice's owned files.
//   - R7's root cause ALSO lives in quotes-tabs/funnel.ts's workingTheme/
//     one-Save PUT construction (outside this slice) — the normalization
//     below closes it for THIS rebuilt rail's own write path, not the
//     pre-existing "Save" button.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import { renderThemesTabPanel } from "../src/admin/leadgen/quotes-tabs/themes";
import { validateTheme } from "../src/public/leadgen/designs/theme";
import { mintPublicId } from "../src/leadgen/ids";
import type { Env } from "../src/env";
import type { ThemeRecord } from "../src/public/leadgen/designs/theme";

// ===========================================================================
// 1. Structure — the three-pane DOM (pure string builder, no DB)
// ===========================================================================

describe("R2 P2 S2b — Themes tab three-pane structure", () => {
  it("owns exactly ONE canvas element; the placeholder strip and the ?embed=1 iframe are both absent", () => {
    for (const isControl of [true, false]) {
      const html = renderThemesTabPanel(isControl);
      expect(html.match(/<iframe\b/g) ?? [], `isControl=${isControl}`).toHaveLength(1);
      expect(html).toContain('id="lg-theme-canvas-frame"');
      expect(html).not.toContain("This area is the Section’s question unit");
      expect(html).not.toContain("This area is the Section's question unit");
      expect(html).not.toContain("?embed=1");
      expect(html).not.toContain('id="lg-theme-presets-frame"');
      expect(html).not.toContain('id="lg-theme-minipreview"');
      expect(html).not.toContain('id="lg-theme-minipreview-frame"');
    }
  });

  it("renders LEFT (section chooser), CENTER (sticky canvas), RIGHT (rail) as three sibling panes", () => {
    const html = renderThemesTabPanel(true);
    expect(html).toContain('data-pin="r2-theme-chooser"');
    expect(html).toContain("data-lg-theme-filters");
    expect(html).toContain("data-lg-theme-list");
    expect(html).toContain('aria-label="Search sections"');
    expect(html).toContain('data-pin="r2-sticky-canvas"');
    expect(html).toContain("position:sticky");
    expect(html).toContain('data-pin="r2-theme-rail"');
    expect(html).toContain('id="lg-theme-rail"');
    // Left, center, and right are siblings under ONE flex wrapper.
    expect(html).toMatch(/data-lg-themes-tab[\s\S]*data-pin="r2-theme-chooser"[\s\S]*data-pin="r2-sticky-canvas"[\s\S]*data-pin="r2-theme-rail"/);
  });

  it("keeps the EXISTING controls + the preset-apply-row ids byte-stable (funnel.ts's delegated listeners and wireThemePresets keep working unmodified)", () => {
    const html = renderThemesTabPanel(true);
    // Rail content: unchanged existing controls (still reorganized, not rebuilt).
    for (const key of ["typography.display", "typography.body", "button_defaults.layout", "card_defaults.radius"]) {
      expect(html, `control ${key}`).toContain(`data-theme-key="${key}"`);
    }
    expect(html).toContain('id="lg-theme-editor"');
    expect(html).toContain('id="lg-themes-panel-mount"'); // stable mount id (test-ui specs + p3a fixtures locate it)
    // Preset row: same ids funnel.ts's wireThemePresets() queries by id.
    expect(html).toContain('id="lg-theme-preset-select"');
    expect(html).toContain('id="lg-theme-preset-apply"');
    expect(html).toContain('id="lg-theme-ab-this"');
    // The removed iframe is replaced by a plain (non-embedded) link.
    expect(html).toContain('href="/admin/leadgen/themes"');
  });

  it("a non-control variant still renders its own override switch inside the rail (unchanged content, just relocated)", () => {
    const html = renderThemesTabPanel(false);
    expect(html).toContain('data-override-switch="theme"');
    expect(html).toContain('name="lg-ov-theme"');
  });

  it("the tab's own ES5 island is present and never depends on quotes-tabs/funnel.ts's private workingTheme state", () => {
    const html = renderThemesTabPanel(true);
    expect(html).toContain("function refreshCanvas()");
    expect(html).toContain("function flushThemeEdits()");
    expect(html).toContain("/api/admin/leadgen/sections/preview");
    expect(html).toContain("/theme'");
    expect(html).not.toContain("workingTheme");
  });
});

// ===========================================================================
// 2. R7 register — payload normalization proved against the REAL validator
// ===========================================================================

describe("R2 register R7 — theme_id-plus-inline-override normalization", () => {
  it("fail-before: the REAL validateTheme (theme.ts, unmodified) rejects theme_id combined with an inline field — reproduces the register's exact bug", () => {
    const buggyPayload = { theme_id: "some-preset-id", palette: { brand_primary: "#123456" } };
    const result = validateTheme(buggyPayload);
    expect(result.theme).toBeNull();
    expect(result.problems.some((p) => p.severity === "error")).toBe(true);
    expect(result.problems.map((p) => p.message)).toContain("theme_id can't be combined with other theme settings.");
  });

  // Mirrors THEMES_TAB_SCRIPT's flushThemeEdits algorithm exactly (drop a
  // bare theme_id pointer, THEN merge the edited field) — the script text
  // itself is browser JS (verified ES5-safe by the existing quote-editor
  // renderedPages() ES5 scan, test/leadgen-quotes-ui.test.ts), not an
  // importable TS unit; this proves the ALGORITHM against the real
  // validator, which is the part that actually has to be correct.
  function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split(".");
    let cur: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const existing = cur[parts[i]!];
      const isPlainObject = existing !== null && typeof existing === "object" && !Array.isArray(existing);
      if (!isPlainObject) cur[parts[i]!] = {};
      cur = cur[parts[i]!] as Record<string, unknown>;
    }
    cur[parts[parts.length - 1]!] = value;
  }
  function normalizeAndApply(current: Record<string, unknown>, edits: Record<string, unknown>): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    for (const k of Object.keys(current)) if (k !== "theme_id") merged[k] = current[k];
    for (const k of Object.keys(edits)) setPath(merged, k, edits[k]);
    return merged;
  }

  it("pass-after: dropping theme_id before merging the edited field produces a payload the SAME real validator accepts — apply preset, then edit Brand-primary", () => {
    // "apply preset" state: the funnel's theme_json is a bare {theme_id} ref
    // (exactly what the Themes tab's existing 'Apply to this funnel' button
    // writes, quotes-tabs/funnel.ts's wireThemePresets — unmodified).
    const afterApplyPreset = { theme_id: "preset-abc123" };
    // Naive merge (the CURRENT bug — workingTheme spreads the old object
    // as-is) would still carry theme_id and gets rejected:
    const naiveMerge = { ...afterApplyPreset, palette: { brand_primary: "#1B3A5C" } };
    expect(validateTheme(naiveMerge).theme).toBeNull();

    // "edit a control" — Brand-primary via the RIGHT rail's role-strip pick
    // (data-role-pick-for="palette.brand_primary"), applied through THIS
    // slice's own normalization:
    const normalized = normalizeAndApply(afterApplyPreset, { "palette.brand_primary": "#1B3A5C" });
    expect(normalized).not.toHaveProperty("theme_id");
    const result = validateTheme(normalized);
    expect(result.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(result.theme).not.toBeNull();
    expect((result.theme as unknown as { palette: { brand_primary: string } }).palette.brand_primary).toBe("#1B3A5C");
  });

  it("pass-after: a font or a button-shape edit (data-theme-key controls) normalizes the same way", () => {
    const afterApplyPreset = { theme_id: "preset-xyz789" };
    const normalized = normalizeAndApply(afterApplyPreset, {
      "typography.display": "poppins",
      "button_defaults.layout": "card",
    });
    const result = validateTheme(normalized);
    expect(result.problems.filter((p) => p.severity === "error")).toEqual([]);
    expect(result.theme).not.toBeNull();
  });
});

// ===========================================================================
// 3. Image23 authoring — title+subtitle choices AND an "Other" choice
//    together, saved through the REAL save API, applied under a "card"
//    theme, verified through the admin preview route.
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

async function json<T>(res: Response, label: string): Promise<T> {
  const body = (await res.json()) as T;
  expect(res.status, `${label}: ${JSON.stringify(body)}`).toBeLessThan(300);
  return body;
}

interface ThemeCreateResponse {
  item: ThemeRecord;
}

async function createCardTheme(env: Env, name: string): Promise<ThemeRecord> {
  const created = await json<ThemeCreateResponse>(
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
    "create theme",
  );
  const patched = await json<ThemeCreateResponse>(
    await admin.request(`${API}/themes/${created.item.id}`, jsonInit("PATCH", { button_style: { layout: "card" } }), env),
    "patch theme button_style.layout=card",
  );
  return patched.item;
}

interface QuoteCreateResponse {
  id: number;
  public_id: string;
  funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
}

async function createQuote(env: Env, funnelName: string): Promise<QuoteCreateResponse> {
  return json<QuoteCreateResponse>(
    await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: `Fixture for ${funnelName}`, activity: "quote_funnel", verticals: ["auto"], funnel_name: funnelName }), env),
    "create quote",
  );
}

// The Image23 combination: EACH regular choice carries title+subtitle, PLUS
// a final "Other" choice — all in ONE payload, saved through the real save
// API (POST /sections — content-schema.ts's own validateSectionContent gate,
// not a raw-SQL bypass), proving the full authoring shape the operator would
// actually build is accepted together, not just each field in isolation.
function image23SectionPayload(headline: string): Record<string, unknown> {
  return {
    section_name: headline,
    headline_text: headline,
    activity: "quote_funnel",
    vertical: "auto",
    status: "active",
    content_json: JSON.stringify({
      components: [
        {
          type: "ButtonAnswerGroup",
          question_id: "q_biz_image23",
          question_key: "biz_image23",
          internal_field: "business_type_image23",
          answer_type: "enum",
          props: {
            label: headline,
            other: { enabled: true, label: "Other", choices: [{ label: "Something else", value: "other_else", analytics_id: "other_else" }] },
          },
          choices: [
            { label: "Construction", value: "construction", analytics_id: "construction", title: "Construction", subtitle: "Contractors, Home Builders, Renovation" },
            { label: "Food Services", value: "food", analytics_id: "food", title: "Food Services", subtitle: "Restaurants, Bars, Food Trucks" },
          ],
        },
        { type: "ContinueButton", question_id: "q_biz_image23_cont", props: { label: "Continue" } },
      ],
    }),
  };
}

async function attachToVariant(env: Env, variantPublicId: string, sectionId: number): Promise<void> {
  await json(await admin.request(`${API}/variants/${variantPublicId}`, jsonInit("PUT", { sections: [{ section_id: sectionId }] }), env), "attach section to variant");
}

async function assignFunnelTheme(env: Env, funnelPublicId: string, themeId: string): Promise<void> {
  await json(await admin.request(`${API}/funnels/${funnelPublicId}/theme`, jsonInit("PUT", { theme_json: { theme_id: themeId } }), env), "assign funnel theme");
}

describeDb("R2 P2 S2b — Image23 authoring: title+subtitle choices + Other, saved together, rendered under a card theme", () => {
  it("the real save API accepts a section combining per-choice subtitles AND an Other choice in one payload; the admin preview shows the full tscard anatomy for both", async () => {
    const { env } = newHarness();
    const theme = await createCardTheme(env, "Image23 Card Theme");
    const quote = await createQuote(env, "Auto Insurance");
    const funnelId = quote.funnels[0]!.public_id;
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await assignFunnelTheme(env, funnelId, theme.id);

    const createRes = await admin.request(`${API}/sections`, jsonInit("POST", image23SectionPayload("What's your business type?")), env);
    const created = await json<{ id: number; public_id: string }>(createRes, "create Image23 section");
    await attachToVariant(env, variantId, created.id);

    const previewRes = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: image23SectionPayload("What's your business type?")["content_json"],
        theme_id: theme.id,
        frame_context: { funnel_public_id: funnelId, variant_public_id: variantId },
        viewport: "desktop",
      }),
      env,
    );
    const preview = await json<{ preview: { html: string } }>(previewRes, "preview Image23 section");
    const html = preview.preview.html;

    // Both authored choices render as full-width title+subtitle tscards.
    expect(html).toContain('<span class="lg-tscard-title">Construction</span>');
    expect(html).toContain('<span class="lg-tscard-subtitle">Contractors, Home Builders, Renovation</span>');
    expect(html).toContain('<span class="lg-tscard-title">Food Services</span>');
    expect(html).toContain('<span class="lg-tscard-subtitle">Restaurants, Bars, Food Trucks</span>');
    // The trailing "Other" affordance renders as a tscard too — title +
    // chevron, no subtitle span (Image23's own dropdown-chevron row).
    expect(html).toMatch(/lg-other-trigger"[^>]*><span class="lg-tscard-title">Other<\/span><svg/);
    expect(html).toContain('data-btn-layout="card"');
  });
});
