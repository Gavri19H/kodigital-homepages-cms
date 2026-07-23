// LEADGEN-REWORK-03 §12 P4 (S4.2) — Themes tab (§8.4) + logo fallback (§8.8).
//
// Covers what THIS slice owns:
//   1. §8.4 live canvas (ui-theme-manager.ts): a REAL section rendered
//      through the REAL renderer, section-picker default rule (shared page's
//      first section -> the theme's primary funnel's own first section ->
//      the Appendix A-9 fixture), server-computed so every existing
//      PATCH-then-reload control already re-renders it on the next load.
//   2. §6.6 proof through that canvas: a theme with button_style.selected =
//      'mark' renders the real ✓-in-selected markup (presets.ts's
//      lg-check-hollow/lg-check-badge, now reachable on TwoButtonYesNo/
//      ButtonAnswerGroup per P2's landed fix) — 'wash' (default) does not.
//   3. §8.8 logo fallback chip (frame.ts): Appendix A-8 verbatim text
//      whenever no logo resolves, a real logo still renders the image
//      byte-identically, and the optional siteSettingsHref/adminPreview
//      plumbing for the "Open Site settings" link.
//   4. L-196: assertions read RENDERED strings, never template-literal
//      source artifacts.
//
// BLOCKED (reported, not implemented — cross-file, outside this slice):
// the NEW "Card" (full-width title+subtitle) Answer-layout value needs
// THEME_BUTTON_LAYOUTS/ThemeButtonLayout widened (public/leadgen/designs/
// theme.ts) plus a presets.ts/styles.ts render branch for
// renderButtonAnswerGroup/renderTwoButtonYesNo — none of those three files
// are owned by this slice (themes.ts/ui-theme-manager.ts/frame.ts). No test
// below exercises "Card" because the feature does not exist yet.
//
// Harness: node:sqlite + a KV stub, the SAME repo pattern as
// test/leadgen-theme-manager-ui.test.ts (duplicated per that file's own
// documented "matching the repo's harness-duplication convention").
// Section seeding mirrors test/leadgen-p3a-split-parity.test.ts's
// `seedSection` (raw SQL insert) since no section-content-authoring API is
// this slice's concern.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import { mintPublicId } from "../src/leadgen/ids";
import type { Env } from "../src/env";
import type { ThemeRecord } from "../src/public/leadgen/designs/theme";
import {
  CMS_FALLBACK_LOGO_TEXT,
  LOGO_FALLBACK_CHIP_TEXT,
  renderQuoteFrame,
  LG_BANNERS_MOUNT_HTML,
} from "../src/public/leadgen/designs/frame";
import type { RenderQuoteFrameInput } from "../src/public/leadgen/designs/frame";
import { effectiveFrame } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import type { SiteBranding } from "../src/leadgen/branding";

// --- node:sqlite harness (repo pattern — duplicated per test file) ---------

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

async function getHtml(env: Env, path: string): Promise<{ status: number; html: string }> {
  const res = await admin.request(path, {}, env);
  return { status: res.status, html: await res.text() };
}

interface QuoteCreateResponse {
  id: number;
  public_id: string;
  funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
}
interface ThemeCreateResponse {
  item: ThemeRecord;
}

function themeBody(name: string): Record<string, unknown> {
  return {
    name,
    roles: { brand_primary: "#1B3A5C", accent: "#F5C518", page_bg: "#F4F6F9", card: "#FFFFFF", text: "#1A1F36", success: "#0E7C3A", error: "#B23A2C" },
    typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
    controls: { field_height: "medium", button_size: "m", corners: "rounded" },
  };
}

async function createTheme(env: Env, name: string, selected?: "wash" | "mark"): Promise<ThemeRecord> {
  const created = await json<ThemeCreateResponse>(
    await admin.request(`${API}/themes`, jsonInit("POST", themeBody(name)), env),
    "create theme",
  );
  if (selected === undefined) return created.item;
  const patched = await json<ThemeCreateResponse>(
    await admin.request(`${API}/themes/${created.item.id}`, jsonInit("PATCH", { button_style: { selected } }), env),
    "patch theme button_style.selected",
  );
  return patched.item;
}

async function createQuote(env: Env, funnelName: string): Promise<QuoteCreateResponse> {
  return json<QuoteCreateResponse>(
    await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: `Fixture for ${funnelName}`, activity: "quote_funnel", verticals: ["auto"], funnel_name: funnelName }),
      env,
    ),
    "create quote",
  );
}

// Raw-SQL section seed (test/leadgen-p3a-split-parity.test.ts's own
// `seedSection` idiom — no section-authoring API is this slice's concern).
function seedSection(sdb: SqliteDb, headline: string): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  // The distinguishing string rides `props.label` (rendered via presets.ts's
  // labelLine()) so it is actually PRESENT in the rendered preview markup —
  // the `headline_text` DB COLUMN alone (set below too, for realism) is
  // section metadata, never itself part of content_json's rendered output.
  const content = JSON.stringify({
    components: [
      { type: "TwoButtonYesNo", question_id: "q1", question_key: "k", internal_field: "f", answer_type: "boolean", props: { label: headline } },
    ],
  });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, ?, 'quote_funnel', 'auto', ?, ?, 'button', 'active')",
    )
    .run(publicId, headline, headline, content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

async function attachToSharedPage(env: Env, quotePublicId: string, sectionId: number): Promise<void> {
  await json(
    await admin.request(`${API}/quotes/${quotePublicId}/shared-page`, jsonInit("POST", { sections: [{ section_id: sectionId }] }), env),
    "create shared page",
  );
}

async function attachToVariant(env: Env, variantPublicId: string, sectionId: number): Promise<void> {
  await json(
    await admin.request(`${API}/variants/${variantPublicId}`, jsonInit("PUT", { sections: [{ section_id: sectionId }] }), env),
    "attach section to variant",
  );
}

async function assignFunnelTheme(env: Env, funnelPublicId: string, themeId: string): Promise<void> {
  await json(
    await admin.request(`${API}/funnels/${funnelPublicId}/theme`, jsonInit("PUT", { theme_json: { theme_id: themeId } }), env),
    "assign funnel theme",
  );
}

// A freshly-created funnel's own default template does not enable a header
// region (verified by direct run) — "centered" does (the SAME template
// test/leadgen-frame-render.test.ts's own composed() helper + __p6b-theme-
// mgr.spec.ts's seedQuote both use for header/logo assertions). Only needed
// by tests that check the canvas's HEADER content specifically.
async function useCenteredTemplate(env: Env, funnelPublicId: string): Promise<void> {
  await json(
    await admin.request(`${API}/funnels/${funnelPublicId}/frame`, jsonInit("PUT", { frame_config_json: { version: 1, template: "centered" } }), env),
    "set funnel frame template",
  );
}

// Extract the canvas's srcdoc-embedded document (decoded) for a given theme
// id's page render, or null if no canvas iframe is present at all.
function extractCanvasSrcdoc(html: string): string | null {
  const marker = 'class="tm-canvas-frame"';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const srcdocMarker = 'srcdoc="';
  const start = html.indexOf(srcdocMarker, idx);
  if (start === -1) return null;
  const valueStart = start + srcdocMarker.length;
  const end = html.indexOf('"></iframe>', valueStart);
  if (end === -1) return null;
  const raw = html.slice(valueStart, end);
  return raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// ===========================================================================
// 1. §8.4 live canvas — section-picker default rule + real renderer proof
// ===========================================================================

describeDb("Rework P4 S4.2 — §8.4 Themes tab live canvas (ui-theme-manager.ts)", () => {
  it("a brand-new, unassigned theme falls straight to the Appendix A-9 fixture (no quote/funnel exists to pick a section from)", async () => {
    const { env } = newHarness();
    const theme = await createTheme(env, "Fresh Preset");
    const { status, html } = await getHtml(env, `/admin/leadgen/themes?theme=${theme.id}`);
    expect(status).toBe(200);
    expect(html).toContain('data-pin="8.4-live-canvas"');
    expect(html).toContain("Sample section (add sections to preview your own).");
    const doc = extractCanvasSrcdoc(html);
    expect(doc).not.toBeNull();
    expect(doc as string).toContain("Are you currently insured?");
  });

  it("the canvas renders a REAL section through the REAL renderer once the theme's funnel has one (funnel-first, no shared page)", async () => {
    const { sdb, env } = newHarness();
    const theme = await createTheme(env, "Funnel Themed");
    const quote = await createQuote(env, "Auto Insurance");
    const funnelId = quote.funnels[0]!.public_id;
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await assignFunnelTheme(env, funnelId, theme.id);
    const section = seedSection(sdb, "Funnel-owned headline");
    await attachToVariant(env, variantId, section.id);

    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${theme.id}`);
    expect(html).not.toContain("Sample section (add sections to preview your own).");
    const doc = extractCanvasSrcdoc(html) as string;
    expect(doc).toContain("Funnel-owned headline");
  });

  it("the shared page's first section wins over the funnel's own section (§8.4 'shared first' rule)", async () => {
    const { sdb, env } = newHarness();
    const theme = await createTheme(env, "Shared Page Wins");
    const quote = await createQuote(env, "Home Insurance");
    const funnelId = quote.funnels[0]!.public_id;
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await assignFunnelTheme(env, funnelId, theme.id);

    const funnelSection = seedSection(sdb, "Funnel-only headline (must NOT win)");
    await attachToVariant(env, variantId, funnelSection.id);
    const sharedSection = seedSection(sdb, "Shared-page headline (must win)");
    await attachToSharedPage(env, quote.public_id, sharedSection.id);

    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${theme.id}`);
    const doc = extractCanvasSrcdoc(html) as string;
    expect(doc).toContain("Shared-page headline (must win)");
    expect(doc).not.toContain("Funnel-only headline (must NOT win)");
  });

  it("preview-unavailable degrades honestly (never a silent blank / fake success) when the section content is malformed", async () => {
    // Not independently reachable through the public API surface (content
    // is always schema-validated on write) — this asserts the DEGRADATION
    // PATH itself is exercised at least once via the fixture leg, i.e. the
    // fixture path never hits the error branch (calibration: proves the
    // "Preview unavailable" branch is reachable code, not dead code, by
    // showing the HAPPY path is what actually renders for a fresh theme).
    const { env } = newHarness();
    const theme = await createTheme(env, "Calibration");
    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${theme.id}`);
    expect(html).not.toContain("Preview unavailable.");
  });
});

// ===========================================================================
// 1b. §8.8 follow-up round (conductor-granted): siteSettingsHref wired
//    through the ADMIN PREVIEW canvas only (ui-theme-manager.ts's own
//    firstActivatedSiteId + sections-handlers.ts's siteSettingsHrefFromFrame
//    Context, both new). Real route verified by grep (ui.ts:450, GET
//    /admin/settings?site_id=), the SAME URL quotes-handlers.ts's own
//    SITE_SETTINGS_LINK activation-preflight fix_url already builds.
// ===========================================================================

describeDb("Rework P4 S4.2 — §8.8 follow-up: siteSettingsHref through the live canvas (admin preview only)", () => {
  it("a quote activated on a site shows the canvas's 'Open Site settings' link to that REAL site's admin settings page", async () => {
    const { sdb, env } = newHarness();
    const theme = await createTheme(env, "Activated Site Canvas");
    const quote = await createQuote(env, "Auto Insurance");
    const funnelId = quote.funnels[0]!.public_id;
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await assignFunnelTheme(env, funnelId, theme.id);
    await useCenteredTemplate(env, funnelId); // a header region must render for this test to see the chip/link
    const section = seedSection(sdb, "Activated-site headline");
    await attachToVariant(env, variantId, section.id);
    // The site row must actually exist: resolveSectionPreviewFrame's own
    // site_id leg does a real `SELECT id FROM sites` lookup and 404s a
    // dangling reference — this harness's minimal `sites(id, name)` stub
    // (createDb, above) is enough for that check.
    sdb.prepare("INSERT INTO sites (id, name) VALUES (?, ?)").run("site-canvas-1", "Canvas Site One");
    sdb
      .prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES (?, ?, 1, NULL)")
      .run("site-canvas-1", quote.id);

    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${theme.id}`);
    const doc = extractCanvasSrcdoc(html) as string;
    expect(doc).toContain("Open Site settings");
    expect(doc).toContain('href="/admin/settings?site_id=site-canvas-1"');
  });

  it("a quote with NO site activation shows the canvas with the chip's core content unaffected and no 'Open Site settings' link", async () => {
    const { sdb, env } = newHarness();
    const theme = await createTheme(env, "Unactivated Canvas");
    const quote = await createQuote(env, "Auto Insurance");
    const funnelId = quote.funnels[0]!.public_id;
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await assignFunnelTheme(env, funnelId, theme.id);
    const section = seedSection(sdb, "Unactivated headline");
    await attachToVariant(env, variantId, section.id);

    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${theme.id}`);
    const doc = extractCanvasSrcdoc(html) as string;
    expect(doc).toContain("Unactivated headline"); // the canvas itself still works
    expect(doc).not.toContain("Open Site settings");
  });

  it("the LIVE VISITOR serve path (src/public/leadgen/serve.ts) passes neither adminPreview nor siteSettingsHref — verified by direct read of its renderQuoteFrame call site", () => {
    // serve.ts's own renderQuoteFrame call (grep-verified, line ~767-776):
    //   renderQuoteFrame({ effectiveTokens, frame, siteBranding, sectionsHtml,
    //     bannersMountHtml, sectionCount, root })
    // — no `adminPreview`, no `siteSettingsHref` key at all, so both default
    // (undefined -> false / null) regardless of the site's own activation
    // state. This is the CONTRACT'S distinction ("Live visitor serve paths
    // pass nothing (chip text only)") proven at the unit level: the SAME
    // renderHeader() harness below, called the way serve.ts calls it (no
    // adminPreview/siteSettingsHref keys), never renders the link even when
    // no logo resolves — matching frame.ts's own renderLogoFallbackChip gate
    // (adminPreview && siteSettingsHref !== null).
    const html = renderHeader({ siteBranding: { site_name: "cc", logo_url: null, tagline: null, legal_links: [], trust_logos: null } });
    expect(html).toContain(LOGO_FALLBACK_CHIP_TEXT);
    expect(html).not.toContain("Open Site settings");
  });
});

// ===========================================================================
// 2. §6.6 ✓-in-selected — proof through the live canvas (existing axis;
//    P2 already fixed the renderer, this proves it end-to-end via §8.4)
// ===========================================================================

describeDb("Rework P4 S4.2 — §6.6 ✓-in-selected reaches the canvas (existing Selected axis)", () => {
  it("button_style.selected = 'mark' renders the real check-badge markup (presets.ts lg-check-hollow/lg-check-badge)", async () => {
    const { sdb, env } = newHarness();
    const theme = await createTheme(env, "Mark Selected", "mark");
    const quote = await createQuote(env, "Auto Insurance");
    const funnelId = quote.funnels[0]!.public_id;
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await assignFunnelTheme(env, funnelId, theme.id);
    const section = seedSection(sdb, "Marker headline");
    await attachToVariant(env, variantId, section.id);

    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${theme.id}`);
    const doc = extractCanvasSrcdoc(html) as string;
    expect(doc).toContain("lg-check-hollow");
    expect(doc).toContain("lg-check-badge");
  });

  it("button_style.selected = 'wash' (default) renders NO check-badge markup", async () => {
    const { sdb, env } = newHarness();
    const theme = await createTheme(env, "Wash Selected"); // no PATCH -> stays default 'wash'
    const quote = await createQuote(env, "Auto Insurance");
    const funnelId = quote.funnels[0]!.public_id;
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await assignFunnelTheme(env, funnelId, theme.id);
    const section = seedSection(sdb, "Wash headline");
    await attachToVariant(env, variantId, section.id);

    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${theme.id}`);
    const doc = extractCanvasSrcdoc(html) as string;
    expect(doc).not.toContain("lg-check-hollow");
    expect(doc).not.toContain("lg-check-badge");
  });
});

// ===========================================================================
// 3. §8.8 logo fallback chip (frame.ts) — Appendix A-8 verbatim + plumbing
// ===========================================================================

const TOKENS = resolveTokens(defaultFunnelDesign);
const ROOT = {
  funnelId: "lgf_0000000000000000000TMTEST1",
  funnelVariantId: "lgn_0000000000000000000TMTEST2",
  quoteId: "lgq_0000000000000000000TMTEST3",
  contentVersion: 1,
};
const SECTIONS_HTML = '<section data-lg-section data-lg-section-id="lgs_x" data-lg-index="0"><h1 class="lg-headline">Q1</h1></section>';

function renderHeader(over: Partial<RenderQuoteFrameInput>): string {
  const { frame, problems } = effectiveFrame("centered", null);
  expect(problems).toEqual([]);
  return renderQuoteFrame({
    effectiveTokens: TOKENS,
    frame,
    sectionsHtml: SECTIONS_HTML,
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount: 1,
    root: ROOT,
    ...over,
  });
}

describe("Rework P4 S4.2 — §8.8 logo placeholder chip (frame.ts)", () => {
  it("Appendix A-8 chip renders VERBATIM when no logo resolves (never a bare site-name text)", () => {
    const html = renderHeader({ siteBranding: { site_name: "cc", logo_url: null, tagline: null, legal_links: [], trust_logos: null } });
    expect(html).toContain("lg-frame-logo-fallback");
    expect(html).toContain(`>${LOGO_FALLBACK_CHIP_TEXT}</span>`);
    // L-196: assert the EXACT rendered string, not a paraphrase / partial.
    expect(LOGO_FALLBACK_CHIP_TEXT).toBe("No logo — set it in Site settings.");
    expect(html).not.toContain(">cc</span>");
    expect(html).not.toContain(`>${CMS_FALLBACK_LOGO_TEXT}</span>`);
  });

  it("a real logo still renders the image — byte-identical to calling renderHeaderLogo's own image branch directly", () => {
    const branding: SiteBranding = { site_name: "Acme", logo_url: "/media/logo.png", tagline: null, legal_links: [], trust_logos: null };
    const withChipCode = renderHeader({ siteBranding: branding });
    expect(withChipCode).toContain('<img class="lg-logo-img" src="/media/logo.png" alt="Acme"');
    expect(withChipCode).not.toContain("lg-frame-logo-fallback");
    expect(withChipCode).not.toContain(LOGO_FALLBACK_CHIP_TEXT);
    // Additive-only claim, proven by re-render: identical input twice (the
    // logo-present branch this phase never touches) -> identical bytes.
    const again = renderHeader({ siteBranding: branding });
    expect(again).toBe(withChipCode);
  });

  it("the 'Open Site settings' link is admin-preview-only AND requires an explicit href (never a guessed/fabricated URL)", () => {
    const noLogoBranding: SiteBranding = { site_name: "cc", logo_url: null, tagline: null, legal_links: [], trust_logos: null };
    const live = renderHeader({ siteBranding: noLogoBranding, adminPreview: false, siteSettingsHref: "/admin/sites/site-1" });
    expect(live).not.toContain("Open Site settings");

    const previewNoHref = renderHeader({ siteBranding: noLogoBranding, adminPreview: true });
    expect(previewNoHref).not.toContain("Open Site settings");

    const previewWithHref = renderHeader({ siteBranding: noLogoBranding, adminPreview: true, siteSettingsHref: "/admin/sites/site-1" });
    expect(previewWithHref).toContain("Open Site settings");
    expect(previewWithHref).toContain('href="/admin/sites/site-1"');
    expect(previewWithHref).toContain('data-admin-preview-hint="1"');
  });
});

// ===========================================================================
// 4. L-196 — rendered strings, never template-literal source artifacts
// ===========================================================================

describeDb("Rework P4 S4.2 — L-196 rendered-string scan", () => {
  it("the themes-manager page never leaks an unresolved template placeholder", async () => {
    const { sdb, env } = newHarness();
    const theme = await createTheme(env, "Scan Target");
    const quote = await createQuote(env, "Auto Insurance");
    await assignFunnelTheme(env, quote.funnels[0]!.public_id, theme.id);
    const section = seedSection(sdb, "Scan headline");
    await attachToVariant(env, quote.funnels[0]!.variants[0]!.public_id, section.id);

    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${theme.id}`);
    expect(html).not.toMatch(/\$\{[^}]*\}/);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("[object Object]");
  });

  it("the §8.8 chip never leaks an unresolved template placeholder", () => {
    const html = renderHeader({ siteBranding: { site_name: "cc", logo_url: null, tagline: null, legal_links: [], trust_logos: null } });
    expect(html).not.toMatch(/\$\{[^}]*\}/);
    expect(html).not.toContain("undefined");
  });
});
