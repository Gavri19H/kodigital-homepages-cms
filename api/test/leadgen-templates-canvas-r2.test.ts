// LEADGEN R2 · P2 ② (SOURCE-OF-TRUTH A.1 #11-D) — the Templates CANVAS.
//
// Owner truth (verbatim): "…in the middle should be a *CANVAS* so the user
// will see what he is designing!!! the canvas should include one section in
// the middle so the user could see a real reference of how is design is gonna
// look like in real life, and to swich 'Themes' so he will see how it looks on
// different themes designs." · "Add a 'I' 'funnel layout element' - progress
// bar - I clearly explained that I want different types of progress bars and
// to design them with a dedicated box!" · A.1 #11A: "I chose a site - why I
// don't see its logo????"
//
// What this file proves, through the REAL admin router (node:sqlite D1
// harness — repo pattern, see test/leadgen-preview-modes.test.ts):
//
//   1. ONE preview path. The empty funnel and the populated funnel both take
//      POST /variants/:id/preview; the empty one gets its sample section
//      INSIDE the composed frame (sample_section:true). The retired second
//      endpoint (POST /sections/preview, a frameless card) is GONE from the
//      island.
//   2. Every Funnel-layout element A–J changes the canvas: the SAME endpoint
//      the canvas calls, given that element's draft edit, returns HTML that
//      differs from the unedited baseline (a per-element self-diff, array-
//      shaped elements C/D/E/F/G/H included).
//   3. Element I: all five FRAME_PROGRESS_STYLES stamp their modifier class
//      and the four structurally-distinct renderers differ in the DOM
//      (bar vs icon_on_track share ProgressBar markup by design — they differ
//      by a CSS ::after thumb, a screenshot matter, asserted here as the
//      shared-markup + distinct-class truth).
//   4. The logo seam (#11A): with site_id, an authored site_settings
//      .logo_media_id renders as the header <img>; without it the canvas
//      shows LOGO_FALLBACK_CHIP_TEXT. A site that genuinely has no logo keeps
//      the chip.
//   5. The island regressions R4 (create-template posts the LIVE draft),
//      R5 (site_id rides the preview body), R6 (the real #lg-tpl-canvas-status
//      id + a visible message) and B6 (the dead "Live server preview" chip is
//      gone) — asserted against the island source the panel actually ships.
//
// Behavioral UI proof (a real operator drive + screenshots) is the phase's
// product-proof gate; this file is the deterministic server/markup lane.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { LOGO_FALLBACK_CHIP_TEXT } from "../src/public/leadgen/designs/frame";
import { FRAME_PROGRESS_STYLES } from "../src/public/leadgen/designs/frames";
import { LG_SAMPLE_SECTION_HELPER } from "../src/admin/leadgen/quotes-handlers";
import { renderTemplatesTabPanel } from "../src/admin/leadgen/quotes-tabs/templates";

// --- node:sqlite harness (repo pattern) --------------------------------------

type SqliteStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [method: string]: unknown };
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
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first<T = unknown>(): Promise<T | null> { return (sdb.prepare(sql).get(...binds) ?? null) as T | null; },
        async all<T = unknown>() { return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} }; },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
          return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const statement of statements) results.push(await statement.run());
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return results;
    },
  } as unknown as D1Database;
}

function makeKvStub(): KVNamespace {
  const store = new Map<string, { value: string; metadata: unknown }>();
  return {
    async get(key: string): Promise<string | null> { return store.has(key) ? store.get(key)!.value : null; },
    async getWithMetadata(key: string): Promise<{ value: string | null; metadata: unknown }> {
      const e = store.get(key);
      return e ? { value: e.value, metadata: e.metadata ?? null } : { value: null, metadata: null };
    },
    async put(key: string, value: string, opts?: { metadata?: unknown }): Promise<void> {
      store.set(key, { value, metadata: opts?.metadata ?? null });
    },
    async delete(key: string): Promise<void> { store.delete(key); },
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

const API = "/api/admin/leadgen";
// An authored site logo: site_settings.logo_media_id holds a bare R2 storage
// key — the SAME value the CMS logo panel writes — which the §10.4 ladder
// resolves through mediaUrl() to "/media/<key>".
const LOGO_MEDIA_KEY = "sites/site-1/brand/logo-r2.png";
const LOGO_MEDIA_URL = `/media/${LOGO_MEDIA_KEY}`;

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT);" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','one.example.com','insurance','active');" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-nologo','Site NoLogo','two.example.com','insurance','active');" +
      "INSERT INTO site_settings (site_id, key, value) VALUES ('site-1','site_name','Site One Brand');" +
      `INSERT INTO site_settings (site_id, key, value) VALUES ('site-1','logo_media_id','${LOGO_MEDIA_KEY}');` +
      "INSERT INTO site_settings (site_id, key, value) VALUES ('site-nologo','site_name','No Logo Brand');",
  );
  for (const file of LEADGEN_MIGRATIONS) {
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  }
  return sdb;
}

function buildEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db,
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "300",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    LEADGEN_CONFIG_SIGNING_KEY: "runtime-signing-key-test-only",
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// The funnel's stored frame: a `centered` template with a labelled step bar.
const FRAME_CONFIG = { version: 1, template: "centered", progress: { style: "bar", show_label: true } } as const;

function seedSection(sdb: SqliteDb, headline: string, qid: string): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({
    components: [
      { type: "QuestionHeadline", question_id: `${qid}_h`, bind: "section_headline", props: {} },
      { type: "TwoButtonYesNo", question_id: qid, question_key: `${qid}_key`, internal_field: `${qid}_field`, answer_type: "boolean" },
      { type: "ContinueButton", question_id: `${qid}_c`, props: { label: "Continue" } },
    ],
  });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', 0, 'active')",
    )
    .run(publicId, `Section ${qid}`, headline, content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

interface Fixture {
  sdb: SqliteDb;
  env: Env;
  quotePublicId: string;
  funnelPublicId: string;
  variantPublicId: string;
  sections: Array<{ id: number; public_id: string }>;
}

async function seedFixture(sectionCount: number): Promise<Fixture> {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "R2 Canvas Quote", activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const created = (await createRes.json()) as {
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  const funnelPublicId = created.funnels[0]!.public_id;
  const variantPublicId = created.funnels[0]!.variants[0]!.public_id;

  const sections: Array<{ id: number; public_id: string }> = [];
  for (let i = 0; i < sectionCount; i++) {
    sections.push(seedSection(sdb, `Question ${i + 1}?`, `q${i + 1}`));
  }
  if (sectionCount > 0) {
    const putRes = await admin.request(
      `${API}/variants/${variantPublicId}`,
      jsonInit("PUT", { sections: sections.map((s) => ({ section_id: s.id })) }),
      env,
    );
    expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);
  }
  sdb.prepare("UPDATE leadgen_funnels SET frame_config_json = ? WHERE public_id = ?").run(JSON.stringify(FRAME_CONFIG), funnelPublicId);
  return { sdb, env, quotePublicId: created.public_id, funnelPublicId, variantPublicId, sections };
}

type PreviewBody = {
  preview: { css: string; html?: string; pages?: string[]; section_count: number };
  config: Record<string, unknown>;
  sample_section?: boolean;
  problems?: Array<{ path: string; severity: string; message: string }>;
};

async function postPreview(fx: Fixture, body: unknown): Promise<{ status: number; json: PreviewBody }> {
  const res = await admin.request(`${API}/variants/${fx.variantPublicId}/preview`, jsonInit("POST", body), fx.env);
  const text = await res.clone().text();
  expect(res.status, `preview ${res.status}: ${text.slice(0, 400)}`).toBe(200);
  return { status: res.status, json: (await res.json()) as PreviewBody };
}

// Slice one balanced <div>…</div> starting at `openPrefix` — a plain index
// scan over the two div tokens (the same balanced-slicer idiom
// test/leadgen-rework-templates-ui.test.ts uses for the panel).
function sliceBalancedDiv(html: string, openPrefix: string): string {
  const start = html.indexOf(openPrefix);
  if (start === -1) return "";
  let depth = 0;
  let at = start;
  while (at < html.length) {
    const open = html.indexOf("<div", at);
    const close = html.indexOf("</div>", at);
    if (close === -1) return "";
    if (open !== -1 && open < close) {
      depth++;
      at = open + 4;
      continue;
    }
    depth--;
    if (depth === 0) return html.slice(start, close + 6);
    at = close + 6;
  }
  return "";
}

// The island source the Templates panel actually ships (the panel is fully
// static markup — no per-request data — so this IS what the browser runs).
function islandSource(): string {
  const panel = renderTemplatesTabPanel(true, []);
  const match = panel.match(/<script>([\s\S]*?)<\/script>/);
  expect(match, "templates panel ships its inline island").not.toBeNull();
  return match![1] ?? "";
}

// ===========================================================================
// 1 · ONE preview path — the empty funnel renders the sample INSIDE the frame
// ===========================================================================

describeDb("R2 ② canvas — ONE preview endpoint serves the empty funnel too", () => {
  it("the island calls POST /variants/:id/preview and NOTHING else (the /sections/preview detour is gone)", () => {
    const src = islandSource();
    expect(src).not.toContain("/sections/preview");
    expect(src).not.toContain("renderFixture");
    expect(src.match(/\/variants\/' \+ encodeURIComponent\(boot\.selected_variant\) \+ '\/preview/g)?.length ?? 0).toBe(1);
    // …and it asks that ONE endpoint for the empty-funnel sample.
    expect(src).toContain("body.sample_section = true");
  });

  it("EMPTY funnel + sample_section:true → the sample section renders INSIDE the composed frame", async () => {
    const fx = await seedFixture(0);
    const { json } = await postPreview(fx, { mode: "section", viewport: "desktop", sample_section: true });
    const html = json.preview.html ?? "";
    // the frame is real (header + progress + the funnel root), not a bare card
    expect(html).toContain("lg-frame-header");
    expect(html).toContain("lg-frame-progress");
    expect(html).toContain('id="lg-funnel-root"');
    // …with ONE section inside it, carrying the pack's no-sections copy
    expect(html).toContain("data-lg-section");
    expect(html).toContain(LG_SAMPLE_SECTION_HELPER);
    expect(json.preview.section_count).toBe(1);
    expect(json.sample_section).toBe(true);
  });

  it("EMPTY funnel WITHOUT the flag renders the frame with no section (the flag is what adds the sample)", async () => {
    const fx = await seedFixture(0);
    const { json } = await postPreview(fx, { mode: "section", viewport: "desktop" });
    const html = json.preview.html ?? "";
    expect(html).toContain("lg-frame-header");
    expect(html).not.toContain(LG_SAMPLE_SECTION_HELPER);
    expect(json.preview.section_count).toBe(0);
    expect(json.sample_section).toBeUndefined();
  });

  it("a POPULATED funnel ignores sample_section — a real section always wins", async () => {
    const fx = await seedFixture(2);
    const { json } = await postPreview(fx, { mode: "section", viewport: "desktop", sample_section: true });
    const html = json.preview.html ?? "";
    expect(html).not.toContain(LG_SAMPLE_SECTION_HELPER);
    expect(html).toContain("Question 1?");
    expect(json.preview.section_count).toBe(2);
    expect(json.sample_section).toBeUndefined();
  });

  it("the empty-funnel sample honours a LIVE frame edit (the whole point of one path)", async () => {
    const fx = await seedFixture(0);
    const base = await postPreview(fx, { mode: "section", viewport: "desktop", sample_section: true });
    const edited = await postPreview(fx, {
      mode: "section",
      viewport: "desktop",
      sample_section: true,
      draft_frame_config: { version: 1, template: "centered", progress: { style: "dots", show_label: true } },
    });
    expect(edited.json.preview.html).not.toBe(base.json.preview.html);
    expect(edited.json.preview.html ?? "").toContain("lg-frame-progress--dots");
    expect(edited.json.preview.html ?? "").toContain(LG_SAMPLE_SECTION_HELPER);
  });

  it("sample_section must be a boolean (a typed body, not a coerced string)", async () => {
    const fx = await seedFixture(0);
    const res = await admin.request(
      `${API}/variants/${fx.variantPublicId}/preview`,
      jsonInit("POST", { mode: "section", sample_section: "yes" }),
      fx.env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields?: Record<string, string> };
    expect(body.fields?.["sample_section"]).toBeTruthy();
  });
});

// ===========================================================================
// 2 · Every element A–J changes the canvas (per-element self-diff)
// ===========================================================================

// One draft edit per Funnel-layout element, over the SAME base frame. Each
// must produce different canvas HTML than the unedited baseline — including
// the ARRAY-shaped elements (C/D/E/F/G/H) that previously reached the canvas
// only after a Save.
const ELEMENT_EDITS: ReadonlyArray<{ letter: string; name: string; patch: Record<string, unknown>; marker: string }> = [
  { letter: "A", name: "Background", patch: { background: { role: "accent", style: "brand_gradient" } }, marker: "lg-frame-bg-style-brand_gradient" },
  { letter: "B", name: "Logo", patch: { header: { enabled: true, logo_source: "cms_fallback", logo_size: "l", logo_align: "center" } }, marker: "lg-frame-header--logo-l" },
  { letter: "C", name: "Phone / URL", patch: { cta_slots: [{ slot: "header_right", label: "Call now", tel: "+15551234567", align: "right" }] }, marker: "Call now" },
  { letter: "D", name: "Disclosure", patch: { disclosure: { entries: [{ location: "top", mode: "full", text: "R2 disclosure copy", align: "center" }] } }, marker: "R2 disclosure copy" },
  { letter: "E", name: "Free text", patch: { free_text: [{ id: "ft_r2", slot: "above_section", align: "center", blocks: [{ type: "paragraph", html: "R2 free text block" }] }] }, marker: "R2 free text block" },
  { letter: "F", name: "Brand logos", patch: { brand_logos: { enabled: true, layout: "row", slot: "below_section", align: "center", items: [{ url: "https://cdn.example.com/partner.png", alt: "R2 partner logo", size: "m" }] } }, marker: "R2 partner logo" },
  // R2 P7: the footer tile is lettered J (owner ruling, SOURCE-OF-TRUTH A.2).
  // This field is the test's display label only — the assertion below is the
  // canvas diff, unchanged.
  { letter: "J", name: "Footer", patch: { footer: { enabled: true, show_on: "all", blocks: [{ type: "about_paragraph", align: "left", text: "R2 footer about copy" }] } }, marker: "R2 footer about copy" },
  { letter: "H", name: "Images", patch: { images: [{ id: "img_r2", url: "https://cdn.example.com/persona.png", alt: "R2 persona portrait", slot: "above_section", size: "m", align: "center" }] }, marker: "R2 persona portrait" },
  { letter: "I", name: "Progress", patch: { progress: { style: "numbered", show_label: true } }, marker: "lg-frame-progress--numbered" },
];

describeDb("R2 ② canvas — EVERY funnel-layout element A–J changes the canvas", () => {
  for (const el of ELEMENT_EDITS) {
    it(`${el.letter} · ${el.name}: the edit renders (canvas HTML differs from the unedited baseline)`, async () => {
      const fx = await seedFixture(2);
      const base = await postPreview(fx, {
        mode: "section",
        viewport: "desktop",
        draft_frame_config: { ...FRAME_CONFIG },
      });
      const edited = await postPreview(fx, {
        mode: "section",
        viewport: "desktop",
        draft_frame_config: { ...FRAME_CONFIG, ...el.patch },
      });
      const baseHtml = base.json.preview.html ?? "";
      const editedHtml = edited.json.preview.html ?? "";
      expect(editedHtml.length, `${el.letter} rendered`).toBeGreaterThan(0);
      expect(editedHtml, `${el.letter} changes the canvas`).not.toBe(baseHtml);
      expect(editedHtml, `${el.letter} marker present`).toContain(el.marker);
      expect(baseHtml, `${el.letter} marker absent from the baseline`).not.toContain(el.marker);
    });
  }

  it("the island re-reads the ARRAY-shaped elements from their box rows on every render (no Save needed)", () => {
    const src = islandSource();
    for (const fn of [
      "function collectCtaSlots()",
      "function collectDisclosureEntries()",
      "function collectFreeText()",
      "function collectBrandLogos()",
      "function collectFooterBlocks()",
      "function collectImages()",
      "function overlayListGroups(",
      "function overlayHiddenFrameKeys(",
    ]) {
      expect(src, `island carries ${fn}`).toContain(fn);
    }
    // …and the draft the canvas posts overlays them.
    expect(src).toContain("if (arraysArmed) { overlayListGroups(d); }");
    expect(src).toContain("overlayHiddenFrameKeys(d);");
    // every Templates-panel edit (typing, select, and the add/remove/media
    // buttons) schedules a render.
    expect(src).toContain("document.addEventListener('input', onPanelEdit);");
    expect(src).toContain("document.addEventListener('change', onPanelEdit);");
    expect(src).toContain("document.addEventListener('click', onPanelEdit);");
  });
});

// ===========================================================================
// 3 · Element I — the dedicated design box drives all five progress styles
// ===========================================================================

describeDb("R2 ② canvas — element I · Progress: five styles, four distinct renderers", () => {
  it("the dedicated box offers exactly the five real FRAME_PROGRESS_STYLES (hidden is the toggle, not a style)", () => {
    const panel = renderTemplatesTabPanel(true, []);
    const real = FRAME_PROGRESS_STYLES.filter((s) => s !== "hidden");
    expect(real.length).toBe(5);
    for (const style of real) {
      expect(panel, `style card ${style}`).toContain(`value="${style}" data-frame-key="progress.style"`);
    }
    expect(panel).toContain('id="lg-tpl-progress-hidden-radio"');
    expect(panel).toContain('id="lg-tpl-progress-show-checkbox"');
  });

  it("each style stamps lg-frame-progress--{style} in the canvas", async () => {
    const fx = await seedFixture(3);
    for (const style of FRAME_PROGRESS_STYLES.filter((s) => s !== "hidden")) {
      const { json } = await postPreview(fx, {
        mode: "section",
        viewport: "desktop",
        draft_frame_config: { version: 1, template: "centered", progress: { style, show_label: true } },
      });
      expect(json.preview.html ?? "", `progress ${style} modifier class`).toContain(`lg-frame-progress--${style}`);
    }
  });

  it("all FIVE styles are distinct in the canvas — icon_on_track is a real style, not a bar alias", async () => {
    const fx = await seedFixture(3);
    const inner: Record<string, string> = {};
    const whole: Record<string, string> = {};
    for (const style of FRAME_PROGRESS_STYLES.filter((s) => s !== "hidden")) {
      const { json } = await postPreview(fx, {
        mode: "section",
        viewport: "desktop",
        draft_frame_config: { version: 1, template: "centered", progress: { style, show_label: true } },
      });
      const html = json.preview.html ?? "";
      const region = sliceBalancedDiv(html, '<div class="lg-frame-region lg-frame-progress ');
      expect(region.length, `progress region rendered for ${style}`).toBeGreaterThan(0);
      whole[style] = region;
      // strip the region's own modifier classes: what remains is the RENDERER.
      // (whitespace collapsed so a differing NUMBER of stripped modifiers can
      // never masquerade as a markup difference — the comparison below is
      // about the emitted DOM, and `whole` above keeps the un-stripped truth.)
      inner[style] = region.replace(/lg-frame-progress--[a-z_-]+/g, "").replace(/\s+/g, " ");
    }
    // dots = StepIndicator · numbered = numbered circles + "Step 1 of N" ·
    // percent = ProgressBar percent · bar = ProgressBar step.
    expect(inner["dots"]).not.toBe(inner["numbered"]);
    expect(inner["dots"]).not.toBe(inner["percent"]);
    expect(inner["dots"]).not.toBe(inner["bar"]);
    expect(inner["numbered"]).not.toBe(inner["percent"]);
    expect(inner["numbered"]).not.toBe(inner["bar"]);
    expect(inner["percent"]).not.toBe(inner["bar"]);
    // the pinned DOM truth per renderer
    expect(inner["dots"]).toContain("lg-step");
    expect(inner["numbered"]).toContain("Step 1 of 3");
    expect(inner["percent"]).toContain('data-mode="percent"');
    expect(inner["bar"]).toContain('data-mode="step"');
    // R2 P7 D2 — the owner rejected exactly what this assertion used to RECORD
    // ("three of the five options are identical … where is the icon on track???
    // how do I define it????"): icon_on_track was a bar alias whose only
    // difference was a modifier class. It now carries an AUTHORED marker
    // identity, so the five REGIONS are five different strings.
    const regions = FRAME_PROGRESS_STYLES.filter((s) => s !== "hidden").map((s) => whole[s] as string);
    expect(new Set(regions).size, "the five progress styles emit five different regions").toBe(5);
    expect(whole["icon_on_track"], "the marker choice rides the region, authorable per funnel").toContain(
      "lg-frame-progress--icon-",
    );
    expect(whole["bar"], "bar carries no marker identity").not.toContain("lg-frame-progress--icon-");
    // The INNER ProgressBar markup stays shared with `bar` ON PURPOSE and this
    // is load-bearing, not laziness: quotes-handlers.ts advanceFrameProgress
    // advances a composed preview by an EXACT substring swap of that preset's
    // step-1 output, so a bespoke inner DOM would silently stop the per-step
    // advance. The marker is painted by styles.ts off the region class and
    // rides the fill's own right edge, which is what the engine already moves.
    // The VISIBLE difference is proven where visibility can be measured:
    // test-ui/__r2-logo-progress-drive.spec.ts (live page, 1280 + 375).
    expect(inner["icon_on_track"]).toBe(inner["bar"]);
    // and the authored icon reaches the canvas
    const { json: withIcon } = await postPreview(fx, {
      mode: "section",
      viewport: "desktop",
      draft_frame_config: {
        version: 1,
        template: "centered",
        progress: { style: "icon_on_track", show_label: true, icon: "car" },
      },
    });
    expect(withIcon.preview.html ?? "").toContain("lg-frame-progress--icon-car");
  });
});

// ===========================================================================
// 4 · The logo seam (#11A) — a chosen site's authored logo renders
// ===========================================================================

describeDb("R2 ② canvas — #11A the chosen site's logo renders (R5 site_id end-to-end)", () => {
  it("WITH site_id: an authored site_settings.logo_media_id renders as the header image, no fallback chip", async () => {
    const fx = await seedFixture(2);
    const { json } = await postPreview(fx, { mode: "section", viewport: "desktop", site_id: "site-1" });
    const html = json.preview.html ?? "";
    expect(html).toContain(LOGO_MEDIA_URL);
    expect(html).not.toContain(LOGO_FALLBACK_CHIP_TEXT);
  });

  it("WITHOUT site_id (the pre-R2 Templates body): the canvas shows the fallback chip — the #11A defect", async () => {
    const fx = await seedFixture(2);
    const { json } = await postPreview(fx, { mode: "section", viewport: "desktop" });
    const html = json.preview.html ?? "";
    expect(html).not.toContain(LOGO_MEDIA_URL);
    expect(html).toContain(LOGO_FALLBACK_CHIP_TEXT);
  });

  it("a site that genuinely has no logo keeps the chip (the fallback is not silenced)", async () => {
    const fx = await seedFixture(2);
    const { json } = await postPreview(fx, { mode: "section", viewport: "desktop", site_id: "site-nologo" });
    expect(json.preview.html ?? "").toContain(LOGO_FALLBACK_CHIP_TEXT);
  });

  it("the sample-section canvas (empty funnel) renders the site logo too", async () => {
    const fx = await seedFixture(0);
    const { json } = await postPreview(fx, { mode: "section", viewport: "desktop", sample_section: true, site_id: "site-1" });
    const html = json.preview.html ?? "";
    expect(html).toContain(LOGO_MEDIA_URL);
    expect(html).toContain(LG_SAMPLE_SECTION_HELPER);
  });
});

// ===========================================================================
// 5 · The island regressions: R4 · R5 · R6 · B6 · B7
// ===========================================================================

describe("R2 ② canvas — island regressions (R4 · R5 · R6 · B6 · B7)", () => {
  it("R4: '+ New template' posts the LIVE draft, never boot.frame.effective_frame", () => {
    const src = islandSource();
    expect(src).toContain("frame_json: currentEffectiveFrameForDraft()");
    expect(src).not.toContain("frame_json: (boot && boot.frame && boot.frame.effective_frame)");
  });

  it("R5: the preview body carries site_id (the funnel canvas's working sibling behaviour)", () => {
    const src = islandSource();
    expect(src).toContain("if (mySiteId) { body.site_id = mySiteId; }");
    // the site select exists in the toolbar and shares the funnel builder's hook
    const panel = renderTemplatesTabPanel(true, []);
    expect(panel).toContain('id="lg-tpl-site-select"');
    expect(panel).toContain("data-site-select");
  });

  it("R6: the canvas status uses the REAL element id and always says something on failure", () => {
    const src = islandSource();
    expect(src).not.toContain("lg-tpl-canvas-status_UNUSED");
    expect(src).toContain("function canvasStatus(msg)");
    expect(src).toContain("byId('lg-tpl-canvas-status')");
    expect(src).toContain("canvasStatus('Preview failed: network error.');");
    // a failure names the server's own path-precise problem, never a bare
    // "Validation failed", and the last good render stays on screen.
    expect(src).toContain("var problems = res.body && res.body.problems;");
    expect(src).toContain("canvasStatus(detail ? 'Preview failed: ' + detail :");
    // the status element the messages land in
    expect(renderTemplatesTabPanel(true, [])).toContain('id="lg-tpl-canvas-status"');
  });

  it("a half-typed image / brand-logo row never blanks the canvas with a validation error (preview-safe collect)", () => {
    const src = islandSource();
    // both media-bearing list collectors require a media id or a URL before
    // the row rides the preview draft (drive evidence: an alt-only row 400s
    // the whole preview otherwise).
    expect(src.match(/if \(mediaId === '' && url === ''\) \{ continue; \}/g)?.length ?? 0).toBe(2);
  });

  it("B6: the dead 'Live server preview' chip is gone", () => {
    expect(renderTemplatesTabPanel(true, [])).not.toContain("Live server preview");
  });

  it("B7: the theme dropdown consumes the real presets and offers a route to theme creation", () => {
    const panel = renderTemplatesTabPanel(true, []);
    expect(panel).toContain('id="lg-tpl-theme-select"');
    expect(panel).toContain('id="lg-tpl-theme-create"');
    const src = islandSource();
    expect(src).toContain("LG_API + '/themes'");
    expect(src).toContain("No themes yet");
    expect(src).toContain("document.querySelector('[data-tab=\"themes\"]')");
    // switching a theme re-renders the canvas under it (draft_theme, never a persist)
    expect(src).toContain("myDraftThemeId = sel.value;");
    expect(src).toContain("return { theme_id: myDraftThemeId };");
  });

  it("the island stays strict ES5 (the renderedPages() scan's contract)", () => {
    const src = islandSource();
    expect(src).not.toMatch(/=>/);
    expect(src).not.toMatch(/\bconst\b/);
    expect(src).not.toMatch(/\blet\b/);
    expect(src).not.toMatch(/\basync\b/);
    expect(src).not.toMatch(/\bawait\b/);
    expect(src).not.toContain("`");
  });
});
