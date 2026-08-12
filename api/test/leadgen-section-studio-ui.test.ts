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
// DEV-66: the render region now lives INSIDE the canvas srcdoc iframe (a
// REAL viewport, so the design's @media mobile block can genuinely fire at
// 375); the executed probes model iframe.contentDocument — the document stub
// serves 'lg-studio-canvas-frame' as a frame object whose contentDocument
// owns the '#lg-studio-canvas-render' mount.

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
import { MEDIA_PENDING_REF } from "../src/public/view-models/media-url";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { STUDIO_LIBRARY_GROUPS } from "../src/admin/leadgen/ui-section-studio";
// D2 seam imports: the island's live mapping decode must agree with the REAL
// server rebuild; the events document's config must be the REAL projection and
// its inline script must be the BYTE-IDENTICAL generated runtime bundle.
import { rebuildDerivedIndexes, type OfferSchemaInfo } from "../src/leadgen/sections";
import { toPublicComponent } from "../src/public/leadgen/config-dto";
import { LEADGEN_RUNTIME_JS } from "../src/public/leadgen/runtime/engine-bundle.generated";
// §8.8 seam imports: the preset renderer must serialize props.maps VERBATIM
// into data-lg-maps. The runtime-reader cross-check (parseMapsConfig over the
// SAME emission literals — MAPS_EMITTED_*) lives in
// test/leadgen-runtime-hydration.test.ts ("§8.8 studio emissions"): that file
// belongs to the DOM-lib runtime typecheck program (tsconfig.runtime.json);
// importing runtime/maps.ts HERE would drag DOM types into the worker
// program. Same suite-pairing the M5 progress-bar regressions use.
import { renderComponent, renderSectionComponents } from "../src/public/leadgen/components/presets";
// review FIX 4a seam (DEV-68 re-pin): the selected-state override consumer
// rides the BASE sheet (frame-independent markup; the legacy pins carry it).
import { funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
// wave-2 seam: equivalentFrameGroup output must pass the REAL frame PUT gate.
import { validateFrameConfig } from "../src/public/leadgen/designs/frames";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

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
  // wave 2: the §5.4 move-to-frame PUT and the §5.3 frame_context preview
  // read/write the 0040/0041 funnel frame/theme columns.
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql",
  "0043_leadgen_routing_rules.sql",
  "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql",
  // Rework P1 (§5 M1-M12): the full migration set. quotes-handlers.ts's
  // createQuoteHandler/putVariantHandler already write the M4 columns
  // (leadgen_funnels.display_order, leadgen_quotes.default_funnel_id)
  // unconditionally, so this suite's fixture creation needs the schema they
  // land in; the M2 owner axis (leadgen_funnel_variant_sections.quote_id) is
  // what sections-handlers.ts's readSectionUsageRows now reads (the "Used in
  // N quotes" GET /usage tests below).
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

// DEV-66: the SSR canvas document rides the canvas iframe's srcdoc attribute
// (escapeHtml-escaped). Unescape it so the region pins keep asserting the
// REAL preset markup byte-for-byte (adjusted for the new mount, never
// weakened). &amp; decodes LAST — the inverse of escapeHtml's order.
function canvasSrcdoc(html: string): string {
  const m = html.match(/<iframe[^>]*id="lg-studio-canvas-frame"[^>]*srcdoc="([^"]*)"/);
  expect(m, "canvas srcdoc iframe present").not.toBeNull();
  return m![1]!
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
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

    // 1) top bar (v3.1 §4.1, golden 29-57): name inline edit · status pill ·
    // real "Mapping k / n complete" badge · validation chip · Save · Archive.
    // Activity/Vertical MOVED to the §4.2 question strip (golden 59-97) —
    // same element ids (collectSection/dirty-watcher unaffected).
    expect(html).toContain("data-studio-topbar");
    expect(html).toContain('id="lg-section-name"');
    // R5 D7 (register S4-B5): the studio topbar uses the golden dot+pill
    // treatment (studioActivePill, ui.ts) — NOT the shared list-page
    // statusBadge (which the Sections LIST page still uses unchanged).
    expect(html).toContain('data-studio-status="active"');
    expect(html).toMatch(/class="studio-status-pill"[^>]*>[^<]*<span[^>]*background:#0E7C3A[^>]*><\/span>Active/);
    expect(html).toContain("data-studio-mapping-badge");
    expect(html).toContain("data-studio-validation-chip");
    expect(html).toContain('id="lg-section-save"');
    expect(html).toContain('id="lg-section-archive"');
    const topbarBlock = html.slice(html.indexOf("data-studio-topbar"), html.indexOf("data-studio-settings"));
    expect(topbarBlock, "Activity/Vertical must have MOVED out of the top bar").not.toContain("data-studio-activity");
    expect(topbarBlock, "Activity/Vertical must have MOVED out of the top bar").not.toContain("data-studio-vertical");
    // §4.1 asserted format: "Mapping k / n complete" — real computed counts,
    // never the golden fixture's hardcoded "2 / 2" (§0 fidelity-vs-function).
    expect(html).toMatch(/Mapping \d+ \/ \d+ complete/);

    // the settings strip (v3.1 §4.2) now owns Activity/Vertical + the
    // canonical headline/subheadline + the "On answer" segmented control.
    expect(html).toContain("data-studio-settings");
    expect(html).toContain("data-studio-activity");
    expect(html).toContain("data-studio-vertical");
    expect(html).toContain('id="lg-section-headline"');
    expect(html).toContain('id="lg-section-subheadline"');
    // §4.2 "On answer" segmented (replaces the old native radio pair) —
    // default state is "Wait for Continue" (continue_mode=button).
    expect(html).toContain('data-continue-mode="button"');
    expect(html).toContain('data-continue-mode="auto_advance"');
    expect(html).toContain(">Wait for Continue<");
    expect(html).toContain(">Go to next<");
    expect(html).not.toMatch(/<input[^>]*name="continue_mode"/);
    // R5 D2 (register S4-A2): the legacy global Maps/validation fieldset
    // (id="lg-address-validation") is REMOVED — safe post-R4b (S3-8:
    // per-field precedence proven in both readers). No replacement control;
    // address_validation_enabled round-trips through `state` alone.
    expect(html).not.toContain('id="lg-address-validation"');
    expect(html).toContain("The question"); // §4.2 strip eyebrow (Appendix A)

    // 2) left rail: searchable library
    expect(html).toContain("data-studio-library");
    expect(html).toContain("data-studio-library-search");

    // 3) center: canvas + breadcrumb + selection toolbar + refusal note.
    // DEV-66: the render region mounts INSIDE the canvas srcdoc iframe (a
    // real viewport — same-origin; scripts inert via the srcdoc's own
    // script-src 'none' CSP, NOT the sandbox, which now grants allow-scripts
    // so Chromium delivers held-button page.mouse streams — U13 fix) — the
    // parent page hosts the frame element; the mount id lives in the frame doc.
    expect(html).toContain("data-studio-canvas");
    expect(html).toMatch(/<iframe[^>]*id="lg-studio-canvas-frame"[^>]*sandbox="allow-same-origin allow-scripts"/);
    expect(html).toMatch(/<iframe[^>]*id="lg-studio-canvas-frame"[^>]*data-canvas-frame-viewport="desktop"/);
    expect(canvasSrcdoc(html)).toContain('id="lg-studio-canvas-render"');
    expect(html).toContain("data-studio-breadcrumb");
    expect(html).toContain("data-studio-selection-toolbar");
    expect(html).toContain("data-studio-drop-refusal");
    for (const act of ["move-up", "move-down", "add-before", "add-after", "duplicate", "delete", "group-stack", "group-cardpanel"]) {
      expect(html, `toolbar action ${act}`).toContain(`data-studio-act="${act}"`);
    }

    // 4) right: tabbed inspector
    expect(html).toContain("data-studio-inspector");

    // 5) bottom drawer (v3.1 §2.1, golden 370-387): Mapping (badge) ·
    // Validation · Preview in a quote · (right) Preview-theme switcher ·
    // Expand. "Design overrides" (§9.5, no golden position) stays reachable
    // as a smaller 4th control (preserve-every-mechanism).
    expect(html).toContain("data-studio-drawer");
    for (const tab of ["mapping", "validation", "preview", "design"]) {
      expect(html, `drawer tab ${tab}`).toContain(`data-studio-drawer-tab="${tab}"`);
      expect(html, `drawer panel ${tab}`).toContain(`data-studio-drawer-panel="${tab}"`);
    }
    expect(html).toMatch(/>Mapping <span[^>]*>\d+\/\d+<\/span></);
    expect(html).toContain(">Validation<");
    expect(html).toContain(">Preview in a quote<");
    expect(html).not.toContain("Preview &amp; debug"); // superseded copy
    expect(html).toContain("Preview theme:");
    expect(html).toContain("data-studio-drawer-expand");
    expect(html).toContain(">Expand<");
    expect(html).toContain("data-studio-tab-mapping"); // D2 mapping seam
    expect(html).toContain("data-studio-validation-list");
    expect(html).toContain("data-studio-events-panel"); // D2 events seam
    expect(html).toContain('id="lg-preview-frame"'); // slice-C preview mounted
  });

  it("the validation chip carries the server-computed issue count (0 for a valid section AND for /new — §5.2 seeds bound nodes)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toContain('data-issue-count="0"');
    // §5.2: /new seeds bound QuestionHeadline + Subheadline as nodes 1–2 —
    // components are non-empty and validator-CLEAN (bound nodes waive text),
    // so the chip is 0 and the canvas empty-state is hidden.
    const fresh = await getHtml(env, "/admin/leadgen/sections/new");
    expect(fresh).toContain('data-issue-count="0"');
    expect(fresh).toMatch(/data-studio-canvas-empty[^>]*hidden/);
    expect(html).toMatch(/data-studio-canvas-empty[^>]*hidden/);
  });

  it("SSR canvas renders the section tree via the REAL preset renderer inside the scoped chrome CSS (in the canvas srcdoc)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const region = canvasSrcdoc(html);
    // scoped chrome css + the preview-parity wrapper + the REAL preset markup
    expect(region).toContain("<style>");
    expect(region).toContain('data-funnel-design="default-funnel"');
    expect(region).toContain("lg-preview-desktop");
    expect(region).toContain('data-component-type="TwoButtonYesNo"');
    expect(region).toContain('data-question-id="q1"');
    // DEV-66: the srcdoc is a COMPLETE document carrying the mount + the
    // design css INCLUDING its mobile media block — the reason the canvas is
    // an iframe at all (the block can now genuinely fire at the 375 viewport)
    expect(region).toContain("<!doctype html>");
    expect(region).toContain('id="lg-studio-canvas-render"');
    expect(region).toContain("@media (max-width: 480px)");
  });
});

// ---------------------------------------------------------------------------
// DEV-66 — the Build canvas is a REAL srcdoc iframe (viewport-faithful media
// queries): the design's mobile block NEVER fired in the inline region no
// matter the admin window; the frame document is an actual 375/1280 viewport.
// ---------------------------------------------------------------------------

describeDb("DEV-66 — canvas srcdoc iframe (§6.1.4 real viewports)", () => {
  it("SSR: the frame is same-origin + script-inert (via in-frame CSP); its srcdoc carries the REAL scoped design css whose mobile block can fire at 375", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const tag = html.match(/<iframe[^>]*id="lg-studio-canvas-frame"[^>]*>/)?.[0];
    expect(tag, "canvas frame tag present").toBeDefined();
    // U13 fix: the sandbox now grants allow-scripts (so Chromium delivers
    // held-button page.mouse streams across the srcdoc boundary — the operator's
    // dead-drag root cause); scripts are kept inert by the srcdoc's OWN
    // first-in-head script-src 'none' CSP, asserted below, NOT by the sandbox.
    expect(tag!).toContain('sandbox="allow-same-origin allow-scripts"'); // parent reaches contentDocument; scripts inert via CSP
    expect(tag!).toContain('class="studio-canvas-frame"');
    expect(tag!).toContain('data-canvas-frame-viewport="desktop"');
    const doc = canvasSrcdoc(html);
    // The inertness mechanism: a first-in-head CSP meta (script-src 'none';
    // object-src 'none'; base-uri 'none') emitted right after the charset meta,
    // BEFORE the <style> — only our own fixed bytes precede it.
    expect(doc).toContain(
      '<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src \'none\'; object-src \'none\'; base-uri \'none\'">',
    );
    // the srcdoc document embeds the BYTE-IDENTICAL scoped chrome css the
    // design module emits — including its @media mobile block (the leg cannot
    // degenerate: the reference css is asserted to carry the block first)
    const scopedCss = funnelChromeCss(defaultFunnelDesign, `[data-funnel-design="${defaultFunnelDesign.id}"]`);
    expect(scopedCss).toContain("@media (max-width: 480px)");
    expect(doc).toContain(scopedCss);
    // decoration rules live INSIDE the frame document now (the parent page's
    // stylesheet cannot cross the boundary)
    expect(doc).toContain(".studio-canvas-render .studio-selected-node");
    expect(doc).toContain(".studio-frame-badge");
    expect(doc).toContain(".studio-mapoverlay-chip");
    // the island wires the frame: load-time delegation re-bind + region
    // resolution THROUGH contentDocument + the §6.1.4 width swap
    const island = studioIsland(html);
    expect(island).toContain("function canvasFrameDoc() {");
    expect(island).toContain("frame.contentDocument");
    expect(island).toContain("frame.addEventListener('load', bindCanvasFrameDoc);");
    expect(island).toContain("frame.style.width = canvasViewport === 'mobile' ? '375px' : '1280px';");
  });

  it("EXECUTED: the Mobile toggle sizes the frame to 375 (back to 1280) and the live mobile re-render carries the media block INTO the frame document", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const region = { innerHTML: "" };
    const frameAttrs: Record<string, string> = {};
    const frame = {
      style: {} as Record<string, string>,
      setAttribute(k: string, v: string) {
        frameAttrs[k] = v;
      },
      contentDocument: {
        getElementById(id: string) {
          return id === "lg-studio-canvas-render" ? region : null;
        },
        body: { scrollHeight: 912 },
      },
    };
    let captured: { url: string; init: RequestInit } | null = null;
    const sandbox = {
      state: { content: JSON.parse(JSON.stringify(YESNO_CONTENT)) as unknown },
      canvasViewport: "mobile",
      document: {
        getElementById(id: string) {
          return id === "lg-studio-canvas-frame" ? frame : null;
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
      "function scheduleCanvasRender() {}",
      sliceIslandFunction(island, "canvasFrameEl"),
      sliceIslandFunction(island, "canvasFrameDoc"),
      sliceIslandFunction(island, "canvasRegion"),
      sliceIslandFunction(island, "updateCanvasFrameViewport"),
      sliceIslandFunction(island, "updateCanvasFrameHeight"),
      sliceIslandFunction(island, "renderCanvasNow"),
      // the §6.1.4 toggle path: size the frame viewport FIRST, then re-render
      "updateCanvasFrameViewport();",
      "renderCanvasNow();",
    ].join("\n");
    runInNewContext(source, sandbox);
    for (let i = 0; i < 200 && region.innerHTML.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    // the frame IS the mobile viewport
    expect(frame.style["width"]).toBe("375px");
    expect(frameAttrs["data-canvas-frame-viewport"]).toBe("mobile");
    // the REAL endpoint round-trip: viewport=mobile rode the POST; the mobile
    // wrap AND the design css (with the block that can now fire at 375)
    // landed in the frame document
    expect(captured, "canvas fetch executed").not.toBeNull();
    const body = JSON.parse(String(captured!.init.body)) as Record<string, unknown>;
    expect(body["viewport"]).toBe("mobile");
    expect(region.innerHTML).toContain("lg-preview-mobile");
    expect(region.innerHTML).toContain("@media (max-width: 480px)");
    // the height tracker sizes the frame element to the frame document
    runInNewContext("updateCanvasFrameHeight();", sandbox);
    expect(frame.style["height"]).toBe("912px");
    // desktop round-trip restores the 1280 viewport
    runInNewContext("canvasViewport = 'desktop'; updateCanvasFrameViewport();", sandbox);
    expect(frame.style["width"]).toBe("1280px");
    expect(frameAttrs["data-canvas-frame-viewport"]).toBe("desktop");
  });

  it("EXECUTED: in-frame image loads re-run the height tracker — bindCanvasFrameDoc binds ONE capture-phase load delegate per loaded document", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // the wiring point is bindCanvasFrameDoc (same lifetime as the surface
    // delegation) and it MUST ride the capture phase — img 'load' never bubbles
    expect(island).toContain("doc.addEventListener('load', onFrameDocLoadCapture, true);");

    const region = { innerHTML: "" };
    const loadListeners: Array<{ fn: (ev: unknown) => unknown; capture: boolean }> = [];
    let docHeight = 480;
    const doc = {
      getElementById(id: string) {
        return id === "lg-studio-canvas-render" ? region : null;
      },
      addEventListener(type: string, fn: (ev: unknown) => unknown, capture?: boolean) {
        if (type === "load") loadListeners.push({ fn, capture: capture === true });
      },
      body: {
        get scrollHeight() {
          return docHeight;
        },
      },
    };
    const frame = {
      style: {} as Record<string, string>,
      setAttribute() {
        /* viewport attr — not under test */
      },
      contentDocument: doc,
    };
    const sandbox = {
      canvasViewport: "desktop",
      document: {
        getElementById(id: string) {
          return id === "lg-studio-canvas-frame" ? frame : null;
        },
      },
    };
    const source = [
      "function bindCanvasSurface() {}",
      "function applyCanvasDecoration() {}",
      "var canvasDocBound = null;",
      sliceIslandFunction(island, "canvasFrameEl"),
      sliceIslandFunction(island, "canvasFrameDoc"),
      sliceIslandFunction(island, "updateCanvasFrameViewport"),
      sliceIslandFunction(island, "updateCanvasFrameHeight"),
      sliceIslandFunction(island, "onFrameDocLoadCapture"),
      sliceIslandFunction(island, "bindCanvasFrameDoc"),
      "bindCanvasFrameDoc();",
    ].join("\n");
    runInNewContext(source, sandbox);

    // bound exactly once, capture phase, and the pass-time height was applied
    expect(loadListeners).toHaveLength(1);
    expect(loadListeners[0]!.capture, "img load does not bubble — capture required").toBe(true);
    expect(frame.style["height"]).toBe("480px");
    // re-binding the SAME loaded document is a no-op (once per document)
    runInNewContext("bindCanvasFrameDoc();", sandbox);
    expect(loadListeners).toHaveLength(1);

    // an in-frame <img> finishes loading AFTER the render pass → the document
    // grows → the delegated capture listener re-runs the tracker
    docHeight = 912;
    loadListeners[0]!.fn({ target: { tagName: "IMG" } });
    expect(frame.style["height"]).toBe("912px");
    // a non-image subresource load never recomputes (the delegate filters)
    docHeight = 1500;
    loadListeners[0]!.fn({ target: { tagName: "LINK" } });
    expect(frame.style["height"]).toBe("912px");
    // …and the lowercase tagName shape (foreign-doc defensiveness) still counts
    loadListeners[0]!.fn({ target: { tagName: "img" } });
    expect(frame.style["height"]).toBe("1500px");
  });

  it("EXECUTED: dragover/drop delegation operates on FRAME-document nodes — insertion hint + palette drop mutate the model through the re-bound path", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // a frame-document-resident canvas node: canvasOwns() must resolve it
    // through canvasRegion().contains (the parent surface is ABSENT — the
    // exact contentDocument leg)
    const target = {
      className: "",
      closest(sel: string) {
        return sel === "[data-question-id]" ? target : null;
      },
      getAttribute(k: string) {
        if (k === "data-question-id") return "q1";
        if (k === "data-component-type") return "TwoButtonYesNo";
        return null;
      },
      getBoundingClientRect() {
        return { top: 0, height: 100 };
      },
    };
    const region = {
      contains(el: unknown) {
        return el === target;
      },
    };
    const frame = {
      contentDocument: {
        getElementById(id: string) {
          return id === "lg-studio-canvas-render" ? region : null;
        },
      },
    };
    const probe = studioProbe(html, YESNO_CONTENT, {
      getElementById(id: string) {
        return id === "lg-studio-canvas-frame" ? frame : null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    });
    probe.run(
      [
        "var canvasSurface = null;",
        "var dropHint = null;",
        "var selected = [];",
        "function selectComponent(qid) { selected.push(qid); }",
        "function clearDropClasses() {}",
        sliceIslandArray(island, "DROP_CLASSES"),
        sliceIslandFunction(island, "withoutClasses"),
        sliceIslandFunction(island, "canvasFrameEl"),
        sliceIslandFunction(island, "canvasFrameDoc"),
        sliceIslandFunction(island, "canvasRegion"),
        sliceIslandFunction(island, "canvasOwns"),
        sliceIslandFunction(island, "onCanvasDragOver"),
        sliceIslandFunction(island, "onCanvasDrop"),
      ].join("\n"),
    );
    // dragover over the TOP half of the frame-doc node → 'before' hint + the
    // insertion-indicator class on the node
    probe.sandbox["dragEv"] = { preventDefault() {}, target, clientY: 10 };
    probe.run("onCanvasDragOver(dragEv)");
    expect(probe.run("dropHint.qid")).toBe("q1");
    expect(probe.run("dropHint.mode")).toBe("before");
    expect(target.className).toContain("studio-drop-before");
    // the palette drop (dataTransfer text 'add:<type>' — the library
    // dragstart payload) lands the component BEFORE q1 in the model
    probe.sandbox["dropEv"] = {
      preventDefault() {},
      target,
      dataTransfer: {
        getData() {
          return "add:HelperText";
        },
      },
    };
    probe.run("onCanvasDrop(dropEv)");
    expect(probe.run("state.content.components.map(function (c) { return c.type; })")).toEqual([
      "HelperText",
      "TwoButtonYesNo",
    ]);
    expect(probe.run("selected.length")).toBe(1); // the drop selected the new node
    // the mutated model stays valid against the REAL server validator
    expect(validateSectionContent(probe.sandbox.state.content as never).errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §5 SSR — component library: 4 groups × 20 verbatim golden tiles (v3.1)
// ---------------------------------------------------------------------------

// Tiles are keyed by data-name (unique per tile), NOT data-add-component —
// "Buttons"/"Cards"/"Short text" deliberately repeat their defaultType across
// the Suggested + Answer-fields groups (contract §5.2: "a shortcut row with
// IDENTICAL insert semantics to the same tiles below").
function libraryTileBlock(html: string, dataName: string, fromIndex = 0): string {
  const nameAt = html.indexOf(`data-name="${dataName}"`, fromIndex);
  expect(nameAt, `library tile "${dataName}"`).toBeGreaterThan(-1);
  // data-tile/data-add-component precede data-name in the real attribute
  // order — the block must start at the tile's OWN wrapper div, not at the
  // data-name attribute itself.
  const start = html.lastIndexOf('<div class="studio-library-item"', nameAt);
  expect(start, `library tile "${dataName}" wrapper start`).toBeGreaterThan(-1);
  const next = html.indexOf('<div class="studio-library-item"', start + 10);
  return html.slice(start, next === -1 ? start + 2000 : next);
}

// §5.5 the exact 20 synonym strings, in §5.2 table order, with their group.
// P5 S5c (ADJ-A6 / D6 RULED yes) added ONE post-golden tile: standalone
// "phone" in answer-fields, right after Contact (same "post-golden addition"
// precedent as "questions on one screen starter" — golden:false in
// golden-allowlist.json, no byte-parity SVG check, see leadgen-v31-gate1-
// parity.test.ts's own scoped-to-golden-names loop).
const EXPECTED_TILES: ReadonlyArray<[group: string, dataName: string, label: string]> = [
  ["suggested", "short text", "Short text"],
  ["suggested", "buttons", "Buttons"],
  ["suggested", "cards", "Cards"],
  ["suggested", "continue button", "Continue"],
  ["answer-fields", "buttons", "Buttons"],
  ["answer-fields", "cards", "Cards"],
  ["answer-fields", "yes no", "Yes / No"],
  ["answer-fields", "dropdown", "Dropdown"],
  ["answer-fields", "multi-select", "Multi-select"],
  ["answer-fields", "questions on one screen starter", "Questions on one screen"],
  ["answer-fields", "short text", "Short text"],
  ["answer-fields", "number", "Number"],
  ["answer-fields", "amount money", "Amount"],
  ["answer-fields", "date", "Date"],
  ["answer-fields", "slider scale", "Slider"],
  ["answer-fields", "contact name email phone", "Contact"],
  ["answer-fields", "phone", "Phone"],
  ["answer-fields", "address zip location", "Address"],
  ["content", "text legal note reassurance disclosure", "Text"],
  ["content", "image logo picture", "Image / Logo"],
  ["content", "divider line", "Divider"],
  ["layout", "card panel", "Card"],
  ["layout", "columns", "Columns"],
  ["layout", "grid", "Grid"],
  ["layout", "spacer gap", "Spacer"],
];

describeDb("section studio SSR — §5 component library (v3.1)", () => {
  it("§5.2 exactly 4 intent-first groups, in order, with the correct default open/collapsed state", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(STUDIO_LIBRARY_GROUPS.map((g) => [g.key, g.label, g.defaultOpen])).toEqual([
      ["suggested", "Suggested", true],
      ["answer-fields", "Answer fields", true],
      ["content", "Content", true],
      ["layout", "Layout", false],
    ]);
    for (const group of STUDIO_LIBRARY_GROUPS) {
      expect(html, `group ${group.key}`).toContain(`data-library-group="${group.key}"`);
      expect(html, `group label ${group.label}`).toContain(`>${group.label}<`);
    }
    // Layout ships hidden (collapsed by default); the other 3 do not.
    expect(html).toMatch(/data-library-items="layout"[^>]* hidden/);
    expect(html).not.toMatch(/data-library-items="suggested"[^>]* hidden/);
    expect(html).not.toMatch(/data-library-items="answer-fields"[^>]* hidden/);
    expect(html).not.toMatch(/data-library-items="content"[^>]* hidden/);
  });

  it("§5.5 the EXACT data-name synonym tiles ride the palette (20 v3.1 + the §4.1 'Questions on one screen' starter + P5 S5c's standalone Phone = 22 unique), in §5.2 order, each inside its correct group", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // every expected (group, dataName) pair appears, in the SAME relative
    // order group-by-group (indexOf is monotonically increasing per group).
    const groupStarts: Record<string, number> = {};
    for (const group of STUDIO_LIBRARY_GROUPS) groupStarts[group.key] = html.indexOf(`data-library-group="${group.key}"`);
    let lastIndexInGroup: Record<string, number> = { suggested: -1, "answer-fields": -1, content: -1, layout: -1 };
    for (const [group, dataName, label] of EXPECTED_TILES) {
      const at = html.indexOf(`data-name="${dataName}"`, groupStarts[group]!);
      expect(at, `tile "${dataName}" in group ${group}`).toBeGreaterThan(lastIndexInGroup[group]!);
      lastIndexInGroup[group] = at;
      const block = libraryTileBlock(html, dataName, groupStarts[group]!);
      expect(block, `tile "${dataName}" label`).toContain(`>${label}<`);
      expect(block, `tile "${dataName}" is a data-tile`).toContain("data-tile");
    }
    // 25 tile instances total (22 unique names incl. the §4.1 "Questions on one
    // screen" starter + P5 S5c's standalone Phone; Buttons/Cards/Short text
    // repeat once each across Suggested + Answer fields = 3 duplicates).
    expect((html.match(/data-tile /g) ?? []).length).toBe(EXPECTED_TILES.length);
  });

  it("§5.6 each tile's data-add-component is its EXACT default concrete type; Contact carries the 3-node Stack children", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const defaultTypeOf: Record<string, string> = {
      "short text": "FreeTextQuestion",
      buttons: "ButtonAnswerGroup",
      cards: "IconCardAnswerGrid",
      "continue button": "ContinueButton",
      "yes no": "TwoButtonYesNo",
      dropdown: "DropdownQuestion",
      "multi-select": "MultiChoiceCardGroup",
      number: "NumberInputQuestion",
      "amount money": "CurrencyInputQuestion",
      date: "DateQuestion",
      "slider scale": "NumberRangeQuestion",
      "contact name email phone": "Stack",
      phone: "PhoneInputQuestion",
      "address zip location": "AddressAutocompleteQuestion",
      "text legal note reassurance disclosure": "TextBlock",
      "image logo picture": "ImageBlock",
      "divider line": "Spacer",
      "card panel": "CardPanel",
      columns: "Columns",
      grid: "GridContainer",
      "spacer gap": "Spacer",
    };
    for (const [dataName, type] of Object.entries(defaultTypeOf)) {
      const block = libraryTileBlock(html, dataName);
      expect(block, `tile "${dataName}" default type`).toContain(`data-add-component="${type}"`);
    }
    const contact = libraryTileBlock(html, "contact name email phone");
    expect(contact).toContain('data-add-children="NameFieldsGroup,EmailInputQuestion,PhoneInputQuestion"');
    // m2 (adversarial review): the Divider tile carries its variant:"line"
    // starting prop JSON-encoded — the Layout group's OWN plain Spacer tile
    // (same defaultType) carries NO such attribute, so the two remain
    // distinguishable at insert time despite sharing data-add-component.
    const divider = libraryTileBlock(html, "divider line");
    expect(divider).toContain("data-add-props=");
    expect(JSON.parse(divider.match(/data-add-props="([^"]*)"/)![1]!.replace(/&quot;/g, '"'))).toEqual({ variant: "line" });
    const plainSpacer = libraryTileBlock(html, "spacer gap");
    expect(plainSpacer).not.toContain("data-add-props");
  });

  it("§5.1 NO descriptions, thumbnails, id strings, or 'maps to Offer fields' badges anywhere in the palette", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const libStart = html.indexOf("data-studio-library");
    const libEnd = html.indexOf("</div>\n</div>", html.indexOf("studio-frame-callout"));
    const libBlock = html.slice(libStart, libEnd === -1 ? libStart + 20000 : libEnd);
    expect(libBlock).not.toContain("studio-item-desc");
    expect(libBlock).not.toContain("studio-thumb");
    expect(libBlock).not.toContain("maps to Offer fields");
    expect(libBlock).not.toContain("stores one choice");
    expect(libBlock).not.toContain("stores a number");
    // no raw catalog type name leaks as VISIBLE tile text (only inside the
    // data-add-component attribute value, never as rendered copy)
    expect(libBlock).not.toMatch(/>ButtonAnswerGroup</);
    expect(libBlock).not.toMatch(/>ZIPInputQuestion</);
  });

  it("§5.2 the dismissible Quote-Builder callout renders after the Layout group with its exact copy", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toContain("data-studio-frame-callout");
    // E2 F5: the Appendix-A verbatim copy (§5.2 line 269 / Appendix A line
    // 653), not the pre-fix "Looking for the page ..." rephrase.
    expect(html).toContain("Header, footer, progress &amp; background belong to the whole funnel &#8212; set them once in the <strong>Quote Builder</strong>");
    expect(html).toMatch(/data-studio-callout-open[^>]*>Open &#8594;</);
    expect(html).toMatch(/<a href="\/admin\/leadgen\/quotes"[^>]*data-studio-callout-open/);
    expect(html).toContain("data-studio-callout-dismiss");
    // renders AFTER the Layout group (golden position, below the 4 groups)
    expect(html.indexOf("data-studio-frame-callout")).toBeGreaterThan(html.indexOf('data-library-group="layout"'));
    const island = studioIsland(html);
    expect(island).toContain("lg-studio-frame-callout-dismissed");
  });

  it("§5.1 group chevrons toggle open/closed (island) and search filters by data-name across ALL groups, force-opening collapsed ones", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toMatch(/data-library-group-toggle="layout"[^>]*aria-expanded="false"/);
    expect(html).toMatch(/data-library-group-toggle="suggested"[^>]*aria-expanded="true"/);
    const island = studioIsland(html);
    expect(island).toContain("data-library-group-toggle");
    expect(island).toContain("setGroupOpen");
    // search reads data-name (golden's own filter() attribute), not a
    // separate description-derived search-text blob
    expect(island).toContain("getAttribute('data-name')");
    expect(island).toContain("data-library-items");
  });

  it("library tiles are role=button DIVS (never <button> — D2 browser-exposure regression guard survives the re-chrome)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toMatch(/<div class="studio-library-item" data-tile role="button" tabindex="0" draggable="true" data-add-component=/);
    expect(html).not.toMatch(/<button[^>]*data-add-component=/);
    const island = studioIsland(html);
    expect(island).toContain("ev.key !== 'Enter' && ev.key !== ' '");
  });

  it("every one of the 20 tile SVGs is copied byte-for-byte from the committed golden master (Appendix D verbatim-asset rule)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // spot-check a representative sample's exact path/geometry data against
    // the golden literal (not just "an svg exists") — the ZIP fixture's own
    // tile (short text) plus a text-glyph tile (Amount) and a dashed-stroke
    // tile (Spacer), each copied from the golden lines named in the comment.
    expect(html).toContain(
      '<rect x="4" y="8.5" width="38" height="13" rx="3" fill="#fff" stroke="#1B3A5C" stroke-width="1.5"/><line x1="9" y1="11.5" x2="9" y2="18.5" stroke="#1B3A5C" stroke-width="1.5" stroke-linecap="round"/><line x1="13" y1="15" x2="27" y2="15" stroke="#C2CCDA" stroke-width="1.8" stroke-linecap="round"/>',
    ); // golden :123 (short text)
    expect(html).toContain(
      '<text x="9" y="19" font-family="Inter" font-size="11" font-weight="800" fill="#1B3A5C">$</text><line x1="17" y1="15" x2="30" y2="15" stroke="#C2CCDA" stroke-width="1.8" stroke-linecap="round"/>',
    ); // golden :178 (amount)
    expect(html).toContain(
      '<rect x="6" y="5" width="34" height="20" rx="3" fill="none" stroke="#9AA9BD" stroke-width="1.3" stroke-dasharray="3 3"/><path d="M23 9v12M20 12l3-3 3 3M20 18l3 3 3-3" stroke="#1B3A5C" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
    ); // golden :243 (spacer)
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
  // v3.1 §8.2: the old 9-panel strip is REPLACED by the golden's 5 dynamic
  // tabs (Content/Style/Rules/Maps/Offers); Advanced is now a persistent
  // disclosure outside the tab system (not a data-studio-panel). The
  // choices/layout/design/validation/dependencies/mapping mechanisms this
  // test asserted all survive, FOLDED into the new tabs — the assertions
  // below still check them via their (unchanged) underlying data hooks.
  it("renders the per-selection 5-tab set with panels + the Advanced disclosure (question vs container vs affordance gating is island-side; all panels SSR once)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    for (const tab of ["content", "style", "rules", "maps", "offers"]) {
      expect(html).toContain(`data-studio-inspector-tab="${tab}"`);
      expect(html).toContain(`data-studio-panel="${tab}"`);
    }
    expect(html).toContain("data-studio-advanced-toggle");
    expect(html).toContain("data-studio-advanced-body");
    // §8.6 Content: per-family display-copy controls (union, island-gated)
    // v3.1 R3 MINOR-4: loadingLabel control removed (out-of-contract, §8.4) — no longer projected.
    for (const key of ["text", "placeholder", "yesLabel", "noLabel", "heading", "message", "minLabel", "maxLabel"]) {
      expect(html, `content control ${key}`).toContain(`data-content-prop="${key}"`);
    }
    // §8.6 Validation: required + rules + §6.5 pattern presets + error text
    expect(html).toContain('data-inspector-field="required"');
    for (const key of ["min", "max", "step", "maxLen"]) expect(html).toContain(`data-vprop="${key}"`);
    const pattern = selectBlock(html, "lg-vprop-pattern");
    for (const preset of ["none", "letters", "digits", "custom"]) expect(pattern).toContain(`<option value="${preset}">`);
    expect(html).toContain('data-inspector-vprop="error_text"');
    // PC-5/PC-A5 (P4b): the DateQuestion Min/Max token+picker — a token dropdown
    // per bound with the dynamic-token options (shown for Date fields via the
    // island's populateDateBound; hidden otherwise).
    for (const key of ["min", "max"]) expect(html).toContain(`data-inspector-vdate="${key}"`);
    for (const tok of ["today", "+7d", "+2w", "+1m", "year_end", "__custom__"]) {
      expect(html, `date token ${tok}`).toContain(`<option value="${tok}">`);
    }
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

  it("§8.6 Style tab: curated token DROPDOWNS sourced from the design's slots — no free-CSS input anywhere (§9.4: color keys are ROLE swatch rows)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // R3b S2-7/S4-A4 (rail removal, renderDesignPanel -> renderStyleExtraControls):
    // featureColor/buttonBackground/buttonText rows DIED from this rail —
    // only the genuinely-consumed, correctly-gated survivors remain.
    for (const key of ["iconColor", "columns", "rangeColor", "gridGap"]) {
      expect(html).toContain(`<select id="lg-inspector-${key}"`);
    }
    // FIX 4b: the mobileBehavior control is GONE (zero renderer consumers —
    // a dead write); the schema key stays legal for stored legacy data.
    expect(html).not.toContain('<select id="lg-inspector-mobileBehavior"');
    expect(html).not.toContain('data-inspector-override="mobileBehavior"');
    // R3b: the OLD rail ids are gone by NAME, not merely hidden — featureColor
    // is now the text family's OWN "Text color role" control (pinned below);
    // buttonBackground/buttonText are frame/theme-owned (§8.5b), no authoring
    // control at all (legacy stored values still render, renderer untouched).
    expect(html).not.toContain('<select id="lg-inspector-featureColor"');
    expect(html).not.toContain('<select id="lg-inspector-buttonBackground"');
    expect(html).not.toContain('<select id="lg-inspector-buttonText"');
    // FIX 4b: the structural rows carry the gating hook the island uses to
    // hide dead-write rows per type (columns/gridGap → card grids only).
    expect(html).toContain('data-override-row="columns"');
    expect(html).toContain('data-override-row="gridGap"');
    // the override ROLE controls are selects ONLY (no <input data-inspector-override=")
    //
    // NARROWED by DEC-D4 (owner-RULED 2026-07-28): per-question style deviation
    // must "Reuse the existing per-section override axes incl. free colors" —
    // the roles-only alternative was REJECTED. The §9.4-era form of this pin
    // ("no free-CSS input anywhere") predates that ruling and its prefix-matching
    // regex also caught the D4 control; it now binds exactly what it was
    // defending — the ROLE controls (data-inspector-override="…") stay selects —
    // while the ruled free-color escape hatch is pinned POSITIVELY below.
    expect(html).not.toMatch(/<input[^>]*data-inspector-override="/);
    // DEC-D4: the free-color control EXISTS on the per-question Style panel,
    // bound to the same design_overrides keys as the role selects (the schema
    // already accepts a #hex literal for every color-typed key).
    for (const key of ["buttonBackground", "iconColor", "featureColor", "rangeColor"]) {
      expect(html, `D4 free color for ${key}`).toContain(`data-inspector-override-hex="${key}"`);
    }
    // §9.4 (wave 2): COLOR-typed option VALUES are the 14 §9.1 ROLE NAMES —
    // picking writes the role, never hex; NO hex option values remain.
    const icon = selectBlock(html, "lg-inspector-iconColor");
    expect(icon).toContain('<option value="brand_primary">Brand primary</option>');
    expect(icon).toContain('<option value="accent">Accent</option>');
    expect(icon).not.toContain('<option value="#');
    // §7.4: the no-override state reads as an inherited value
    expect(icon).toContain('<option value="">Inherited (design default)</option>');
    // §9.4 inheritance/source + reset + legacy-convert affordances per row —
    // re-pinned against the 2 SURVIVING color-typed keys (iconColor/rangeColor;
    // buttonBackground/buttonText no longer have rows to carry these hooks).
    expect(html).toContain('data-override-source="iconColor"');
    expect(html).toContain('data-override-reset="rangeColor"');
    expect(html).toContain('data-override-convert="rangeColor"');
    // R5 jargon purge: "Custom color (legacy)" -> "Custom color" (the word
    // "legacy" never renders in operator-visible copy; data-override-legacy
    // -> data-override-custom; .studio-role-legacy -> .studio-role-custom).
    // Scoped exact-string checks only — a bare `.not.toContain("legacy")`
    // over-matches the unrelated internal plumbing identifier
    // legacyHexToRole (an ES5 island function NAME, never rendered/visible
    // copy — the jargon-scan gate's own scanned-categories doc excludes
    // plumbing identifiers by design, only rendered text/attrs/string
    // literals are in scope).
    expect(html).toContain("Custom color");
    expect(html).not.toContain("Custom color (legacy)");
    expect(html).not.toContain('data-override-legacy=');
    expect(html).not.toContain("studio-role-legacy");
    // structural keys keep the design-slot vocabulary (NOT color-typed)
    const gap = selectBlock(html, "lg-inspector-gridGap");
    expect(gap).toContain("0.5rem"); // spacing.sm
    const columns = selectBlock(html, "lg-inspector-columns");
    for (const v of ["2", "3", "4", "5"]) expect(columns).toContain(`<option value="${v}">`);
    // §6.6 (F3): the preset control is the saved-presets dropdown + "(none)"
    expect(html).toContain("data-preset-select");
    expect(html).toContain("<option value=\"\">(none)</option>");
    expect(html).not.toMatch(/<input[^>]*data-inspector-field="design_preset"/);
    // R3b deliverable 2/E2-C1: featureColor's REAL home is now the text
    // family's own "Text color role" control (data-style-text-block) — the
    // renderer WIRING (E2-C1) makes this a genuinely-consumed control, unlike
    // the old rail's dead-axis row.
    expect(html).toContain('<select id="lg-text-color-role"');
    expect(html).toContain('data-inspector-override="featureColor"');
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
    // (wave 2: the debounce body also pauses while an inline edit is open)
    const island = studioIsland(html);
    expect(island).toContain("canvasTimer = setTimeout(function () {");
    expect(island).toContain("if (inlineEditing) { scheduleCanvasRender(); return; }");
    expect(island).toContain("}, 300);");
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

// Slice a `var NAME = {…};` object-literal statement from the island (the
// §8.8 per-mode key tables ride NEXT TO the functions that consume them —
// probes must run the SERVED tables, never a test copy).
// A single-statement `var NAME = <scalar/expr>[, more...];` declaration —
// sliceIslandVar only handles object literals; this handles plain scalars
// (e.g. `var WIDTH_PX_MIN = 200, WIDTH_PX_MAX = 600, WIDTH_PX_GRID = 4;`).
function sliceIslandLine(script: string, startsWith: string): string {
  const start = script.indexOf(startsWith);
  expect(start, `island line starting "${startsWith}"`).toBeGreaterThan(-1);
  const end = script.indexOf(";", start);
  expect(end, `island line starting "${startsWith}" terminates`).toBeGreaterThan(-1);
  return script.slice(start, end + 1);
}

function sliceIslandVar(script: string, name: string): string {
  const marker = `var ${name} = {`;
  const start = script.indexOf(marker);
  expect(start, `island var ${name} present`).toBeGreaterThan(-1);
  const open = script.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < script.length; i += 1) {
    if (script[i] === "{") depth += 1;
    else if (script[i] === "}") {
      depth -= 1;
      if (depth === 0) return `${script.slice(start, i + 1)};`;
    }
  }
  throw new Error(`unbalanced braces while slicing island var ${name}`);
}

// The island's pure/model functions (no DOM) — sliced together so every
// probe runs the REAL served code, never a test re-implementation.
const MODEL_FUNCS = [
  "trimStr",
  "cloneJson",
  "newQuestionId",
  "typeMeta",
  "isContainerType",
  "typeLabel",
  // §5.2 canonical headline binding model core
  "bindForType",
  "bindNoun",
  "bindNodeType",
  "stripInputFor",
  "findBoundNode",
  "unboundCandidate",
  "insertBoundNodeAtTop",
  "linkBoundNode",
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
  // PC-12 (register PC-12): the rules-picker/sentence human-naming core —
  // sectionFieldLabels/conditionValueLabel are pure; currentHeadlineText is
  // the one DOM read they need (degrades to '' under the shared docStub,
  // same as populateMapsTab et al. above already do).
  "sectionFieldLabels",
  "currentHeadlineText",
  "conditionValueLabel",
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
  // CONDUCTOR FIX (P3 review MINOR-1): the row-cap-aware mutation guards
  // duplicateNode/wrapSelection now call — sliced alongside them so the probe
  // exercises the REAL cap-check/clear/dissolve logic, not a stub.
  "nodeRowId",
  "ensureLayout",
  "cleanupLayout",
  "clearNodeRow",
  "countRowMembersInList",
  "rowRunBounds",
  "dissolveIfRemainder",
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
  // §9 Maps config model + collectors + banner (v3.1 Phase C job-based shape;
  // mapsControl/buildMapsConfig/collectMapsConfig retired with the old flat
  // autofill-picker panel — see leadgen-section-studio-ui.test.ts's own
  // "§8.8 field-level Maps config" describe block, rewritten for §9)
  "mapsConfigOf",
  "mapsFillLabels",
  "nodeMapsEnabled",
  "mapsConfigEnabledOf",
  "mapsJobsOf",
  "mapsAnyJobOn",
  "mapsValidateCopyFor",
  "populateMapsTab",
  "collectMapsToggle",
  "collectMapsJob",
  "renderMapsBanner",
  // P5 S5c (ADJ-A9): the tree-wide "a Maps-enabled field has zero jobs" risk
  // banner + the keyless-degrade key-state reader it and the Address
  // field-set editor share.
  "mapsKeyIsConfigured",
  "renderMapsJobRiskBanner",
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
    "function applyCanvasDecoration() {}",
    // CONDUCTOR FIX (P3 review MINOR-1): duplicateNode/wrapSelection now
    // reference the bare MAX_ROW_MEMBERS literal (a free var, not a function)
    // — sliced alongside MODEL_FUNCS so the vm-probe runs the REAL served
    // value, never a hand-typed re-guess of the cap.
    sliceIslandLine(island, "var MAX_ROW_MEMBERS ="),
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
    for (const type of ["TwoButtonYesNo", "IconCardAnswerGrid", "QuestionHeadline", "NumberRangeQuestion", "HeaderLogo"]) {
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

  it("breadcrumb text walks the ancestor chain in OPERATOR WORDS (§7.4 — labels, never raw type ids)", async () => {
    const probe = await probeHarness(NESTED_CONTENT);
    expect(probe.run(`breadcrumbText('bag1')`)).toBe("Question card › Stack › Simple answer buttons");
    expect(probe.run(`breadcrumbText('stack1')`)).toBe("Question card › Stack");
    expect(probe.run(`breadcrumbText('panel1')`)).toBe("Question card");
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
    // DEV-66: the region lives in the canvas iframe — the stub models the
    // contentDocument the sliced canvasRegion() resolves through.
    const region = { innerHTML: "" };
    const frame = {
      contentDocument: {
        getElementById(id: string) {
          return id === "lg-studio-canvas-render" ? region : null;
        },
      },
    };
    let captured: { url: string; init: RequestInit } | null = null;
    const sandbox = {
      state: { content: JSON.parse(JSON.stringify(YESNO_CONTENT)) as unknown },
      canvasViewport: "desktop", // wave-2 §6.1.4 island state the fn reads
      document: {
        getElementById(id: string) {
          return id === "lg-studio-canvas-frame" ? frame : null;
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
      "function scheduleCanvasRender() {}",
      sliceIslandFunction(island, "canvasFrameEl"),
      sliceIslandFunction(island, "canvasFrameDoc"),
      sliceIslandFunction(island, "canvasRegion"),
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
      // CONDUCTOR FIX (P3 review MINOR-1): duplicateNode/wrapSelection now
    // reference the bare MAX_ROW_MEMBERS literal (a free var, not a function)
    // — sliced alongside MODEL_FUNCS so the vm-probe runs the REAL served
    // value, never a hand-typed re-guess of the cap.
    sliceIslandLine(island, "var MAX_ROW_MEMBERS ="),
    ...MODEL_FUNCS.map((n) => sliceIslandFunction(island, n)),
      // author through the REAL island model: wrap the seeded question in a
      // Stack and add a helper line inside it
      "var wrapper = wrapSelection('q1', 'Stack');",
      "addComponentAt('HelperText', wrapper.question_id, null);",
      "var body = collectSection();",
    ].join("\n");
    runInNewContext(source, sandbox);
    const body = sandbox["body"] as Record<string, unknown>;

    // the OLD island's exact body shape + the D2 additive selected_offers key
    // + the wave-2 §9.5 design_overrides key (null clears the column; the
    // PATCH path already consumed both server-side).
    expect(Object.keys(body).sort()).toEqual(
      ["section_name", "activity", "vertical", "headline_text", "subheadline_text", "continue_mode", "address_validation_enabled", "content_json", "answer_maps", "selected_offers", "design_overrides"].sort(),
    );
    expect(body["section_name"]).toBe("Studio renamed");
    expect(body["continue_mode"]).toBe("button");
    expect(body["selected_offers"]).toEqual([]);
    expect(body["design_overrides"]).toBeNull();

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
    // R3b deliverable 7 (E2-NEW-4/E3-NEW-5): collectSection now invokes the
    // retired-node migration at the SAME save seam as migrateHelperKey — the
    // authored HelperText node is rewritten to its primitive TextBlock form
    // (role:"helper") before it ever reaches the PATCH body. This PIN's RED
    // (expecting "HelperText" to survive unmigrated) was itself proof the
    // migration now runs: §5.3 promises "Save rewrites the node to the
    // primitive form," and nothing called that function anywhere before this
    // phase (register E2-NEW-4).
    expect(kids.map((k) => k["type"])).toEqual(["TwoButtonYesNo", "TextBlock"]);
    expect(kids[1]!["props"]).toMatchObject({ role: "helper" });
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
  // §12.5: the authored schema label — field_label derivation source.
  label?: string;
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
      ...(f.label !== undefined ? { label: f.label } : {}),
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
  "mapStateNote",
  // §12.1 panel decode core (slice D-studio)
  "fieldDisplayLabel",
  "plainTypeWords",
  "overlayChipInfo",
  "pathOptionLabel",
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
    // CONDUCTOR FIX (P3 review MINOR-1): duplicateNode/wrapSelection now
    // reference the bare MAX_ROW_MEMBERS literal (a free var, not a function)
    // — sliced alongside MODEL_FUNCS so the vm-probe runs the REAL served
    // value, never a hand-typed re-guess of the cap.
    sliceIslandLine(island, "var MAX_ROW_MEMBERS ="),
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

  it("the 12 §12.1 mapping table SSRs the EXACT column contract; raw ids/paths/JSON are absent from the surface", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const head = html.slice(html.indexOf("data-studio-mapping-table"), html.indexOf("data-studio-offers-body"));
    // §12.1 COLUMN CONTRACT — the normative order, verbatim.
    const contractColumns = [
      "Offer",
      "Provider",
      "Placement",
      "Field",
      "Expected type",
      "Required",
      "Mapped component",
      "Status",
      "Fix",
    ];
    const headCells = [...head.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map((m) => m[1]);
    expect(headCells).toEqual(contractColumns);
    // §12.1: the raw path lives in tooltip + ADVANCED — the panel ships the
    // Advanced disclosure (an lg-advanced container, lint-stripped from the
    // normal surface) the island fills with one line per Offer × field.
    expect(html).toContain("data-studio-mapping-advanced");
    expect(html).toContain("data-studio-mapping-advanced-list");
    expect(html).toMatch(/<details class="lg-advanced studio-mapping-advanced"[^>]*data-studio-mapping-advanced/);
    expect(html).toContain("Advanced: raw field paths");
    // §8.7: no free-text path inputs, no raw answer-map JSON textarea on this
    // surface (the ONLY raw-JSON control is the Advanced NODE editor).
    expect(html).not.toContain("data-map-field"); // the old builder's raw grid hooks
    expect(html).not.toContain('id="lg-mapping-json"');
    const rawJsonSurfaces = html.match(/<textarea[^>]*data-studio-node-json/g) ?? [];
    expect(rawJsonSurfaces).toHaveLength(1);
  });

  it("the 12 §12.3 mapping-overlay toggle ships in the canvas toolbar and the island wires it to the canvas decoration", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // R4a E3-NEW-10: relocated from the preview drawer to the ALWAYS-VISIBLE
    // canvas toolbar — its handler repaints the canvas, so the control now
    // lives where its effect is seen.
    const canvasToolbar = html.slice(
      html.indexOf("data-studio-canvas-toolbar"),
      html.indexOf('<div class="studio-canvas-surface"'),
    );
    expect(canvasToolbar).toMatch(/data-studio-overlay-toggle[^>]*aria-pressed="false"/);
    expect(canvasToolbar).toContain("Offer mapping overlay");
    const island = studioIsland(html);
    // toggle → repaint; chips rebuild inside the decoration pass; click →
    // the inspector Offers tab (v3.1 §8.2 folds Mapping -> Offers) scoped to
    // the chip's component
    expect(island).toContain("mappingOverlayOn = !mappingOverlayOn;");
    expect(island).toContain("function decorateMappingOverlay(");
    expect(island).toContain("decorateMappingOverlay(region);");
    expect(island).toContain("'data-mapping-overlay-chip'");
    expect(island).toContain("selectComponent(this.getAttribute('data-mapping-overlay-chip'));");
    expect(island).toMatch(/data-mapping-overlay-chip'\)\);\s*setInspectorTab\('offers'\);/);
    // the overlay chips are part of the stale-cleanup list (rebuild per pass)
    expect(island).toContain(".studio-mapoverlay-chip");
  });
});

// ---------------------------------------------------------------------------
// ADJ-A10 (probe): "Activity/vertical lists start EMPTY locally; '+ create'
// flow works but with raw JS prompts." The name is now collected through the
// studio's OWN modal idiom (renderNewSharedValueModal — the Media picker's
// role="dialog" aria-modal="true" + lg-hidden toggle) with Create/Cancel and
// an inline error for an empty name; window.prompt() is gone.
// R2 P2 FIX-FIRST (MINOR-3, adversarial review): the §8.2 "no Offers exist
// yet" gate was the LAST raw browser dialog in this flow (a window.confirm())
// — A10's complaint is raw JS dialogs as a CLASS — so it is now the SAME
// two-button modal idiom (renderNoOffersConfirmModal). The gate still gates:
// declining creates nothing. Both assertions below are strengthened to
// "window.confirm is never called at all".
// ---------------------------------------------------------------------------

describeDb("section studio — ADJ-A10 '+ New activity/vertical' is a MODAL, not a raw window.prompt()", () => {
  it("SSR ships the modal (role=dialog, aria-modal, Create/Cancel, inline error slot) and the island never calls window.prompt", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toMatch(
      /<div class="lg-media-picker-overlay lg-hidden" id="lg-new-shared-value-modal" role="dialog" aria-modal="true"/,
    );
    expect(html).toContain("data-new-shared-value-title");
    expect(html).toContain('id="lg-new-shared-value-close"');
    expect(html).toContain('id="lg-new-shared-value-input"');
    expect(html).toMatch(/<p class="form-help studio-field-error" data-new-shared-value-error hidden>/);
    expect(html).toContain("data-new-shared-value-cancel");
    expect(html).toContain("data-new-shared-value-create");
    const island = studioIsland(html);
    // the ADJ-A10 activity/vertical create block (state var through the two
    // trigger-button wire-ups, same span test/leadgen-r4a-pipeline.test.ts's
    // "+New activity/vertical…renderOffersStaleNote()" test slices) never
    // calls window.prompt — scoped to THIS block, not the whole island,
    // since other (out-of-scope) prompt() affordances elsewhere are untouched.
    const createBlockStart = island.indexOf("var newSharedValueTarget =");
    const createBlockEnd = island.indexOf("if (activitySel) {");
    expect(createBlockStart).toBeGreaterThan(-1);
    expect(createBlockEnd).toBeGreaterThan(createBlockStart);
    const createBlock = island.slice(createBlockStart, createBlockEnd);
    expect(createBlock).not.toContain("window.prompt");
    // MINOR-3: the §8.2 "no Offers yet" business gate keeps its EXACT sentence
    // but is no longer a raw browser dialog anywhere in this block.
    expect(createBlock).toContain("No Offers exist for '");
    expect(createBlock).not.toContain("window.confirm");
    // …and the gate modal itself is SSR'd, same idiom as the name dialog.
    expect(html).toMatch(
      /<div class="lg-media-picker-overlay lg-hidden" id="lg-no-offers-confirm-modal" role="dialog" aria-modal="true"/,
    );
    expect(html).toContain("data-no-offers-question");
    expect(html).toContain("data-no-offers-cancel");
    expect(html).toContain("data-no-offers-confirm");
  });

  it("EXECUTED: empty name shows the inline error (never silent, never window.prompt); a valid name + confirmed create lands the option end-to-end via the SAME sel/markDirty/after path; a declined confirm creates nothing; window.confirm is NEVER called", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);

    const modal = stubEl("div");
    modal.className = "lg-media-picker-overlay lg-hidden";
    const title = stubEl("span");
    const input = stubEl("input");
    const errorEl = stubEl("p");
    errorEl.hidden = true;
    const sel = stubEl("select");
    // MINOR-3: the gate is a real SSR'd modal now, so the probe DOM carries it.
    const gateModal = stubEl("div");
    gateModal.className = "lg-media-picker-overlay lg-hidden";
    const gateQuestion = stubEl("p");
    const gateConfirmBtn = stubEl("button");

    const docStub = {
      getElementById(id: string) {
        if (id === "lg-new-shared-value-modal") return modal;
        if (id === "lg-new-shared-value-input") return input;
        if (id === "lg-no-offers-confirm-modal") return gateModal;
        return null;
      },
      querySelector(q: string) {
        if (q === "[data-new-shared-value-title]") return title;
        if (q === "[data-new-shared-value-error]") return errorEl;
        if (q === "[data-no-offers-question]") return gateQuestion;
        if (q === "[data-no-offers-confirm]") return gateConfirmBtn;
        return null;
      },
      querySelectorAll() {
        return [];
      },
      createElement(tag: string) {
        return stubEl(tag);
      },
      createTextNode(text: string) {
        return stubEl("#text", text);
      },
    };

    const probe = studioProbe(html, { components: [] }, docStub as unknown as Record<string, unknown>);
    const confirms: string[] = [];
    probe.sandbox["window"] = {
      confirm(msg: string) {
        confirms.push(msg);
        throw new Error("MINOR-3 regression: window.confirm must never be called");
      },
      prompt() {
        throw new Error("ADJ-A10 regression: window.prompt must never be called");
      },
    };
    probe.sandbox["dirty"] = false;
    const afterCalls: string[] = [];
    probe.sandbox["fakeSel"] = sel;
    probe.sandbox["afterSpy"] = (v: string) => afterCalls.push(v);
    probe.run(
      [
        "function markDirty() { dirty = true; }",
        sliceIslandLine(island, "var newSharedValueTarget ="),
        sliceIslandFunction(island, "trimStr"),
        sliceIslandFunction(island, "clearChildren"),
        sliceIslandFunction(island, "refreshPairPillState"),
        sliceIslandFunction(island, "newSharedValueErrorEl"),
        sliceIslandFunction(island, "newSharedValueInputEl"),
        sliceIslandFunction(island, "clearNewSharedValueError"),
        sliceIslandFunction(island, "showNewSharedValueError"),
        sliceIslandFunction(island, "openNewSharedValueModal"),
        sliceIslandFunction(island, "closeNewSharedValueModal"),
        sliceIslandFunction(island, "closeNoOffersConfirm"),
        sliceIslandFunction(island, "openNoOffersConfirm"),
        sliceIslandFunction(island, "commitNewSharedValue"),
        sliceIslandFunction(island, "submitNewSharedValueModal"),
        sliceIslandFunction(island, "confirmNoOffersCreate"),
      ].join("\n"),
    );

    // open (from the "+ New activity" trigger's callback signature)
    probe.run("openNewSharedValueModal('activity', fakeSel, afterSpy)");
    expect(title.allText()).toBe("Create a new activity");
    expect(modal.className).toBe("lg-media-picker-overlay");
    expect(errorEl.hidden).toBe(true);

    // EMPTY NAME: inline error shown, NOT a silent no-op, modal stays open,
    // nothing created, window.prompt never invoked (it would have thrown).
    input.value = "";
    probe.run("submitNewSharedValueModal()");
    expect(errorEl.hidden).toBe(false);
    expect(errorEl.allText()).toBe("Enter a name.");
    expect(input.className).toBe("form-input studio-input-error");
    expect(confirms).toHaveLength(0);
    expect(sel.children).toHaveLength(0);
    expect(probe.sandbox["dirty"]).toBe(false);
    expect(afterCalls).toEqual([]);
    expect(modal.className).toBe("lg-media-picker-overlay"); // still open

    expect(gateModal.className).toBe("lg-media-picker-overlay lg-hidden"); // gate never opened

    // VALID NAME: the gate opens as the studio's own modal — the SAME sentence
    // the window.confirm() used to ask — and creates NOTHING on its own.
    input.value = "New Activity";
    probe.run("submitNewSharedValueModal()");
    expect(gateModal.className).toBe("lg-media-picker-overlay"); // gate open
    expect(gateQuestion.allText()).toBe("No Offers exist for 'New Activity' yet. Create the activity anyway?");
    expect(sel.children).toHaveLength(0);

    // DECLINE (the Cancel/Close button's own handler): the §8.2 gate still
    // gates — no option, no dirty flag, no after() — and the name dialog stays
    // open with the typed name intact.
    probe.run("closeNoOffersConfirm()");
    expect(gateModal.className).toBe("lg-media-picker-overlay lg-hidden");
    expect(sel.children).toHaveLength(0);
    expect(probe.sandbox["dirty"]).toBe(false);
    expect(afterCalls).toEqual([]);
    expect(modal.className).toBe("lg-media-picker-overlay"); // still open
    expect(input.value).toBe("New Activity");

    // CONFIRM (the "Create anyway" button's own handler): creates end-to-end —
    // option appended to the REAL <select>, value set, markDirty fired, the
    // after() callback (the same one the "+ New activity" wiring passes —
    // loadVerticals/renderOffersStaleNote in production) invoked with the
    // created value, both modals closed. The create mechanics are
    // byte-identical to pre-modal.
    probe.run("submitNewSharedValueModal()");
    probe.run("confirmNoOffersCreate()");
    expect(gateModal.className).toBe("lg-media-picker-overlay lg-hidden");
    expect(sel.children).toHaveLength(1);
    expect(sel.children[0]!.value).toBe("New Activity");
    expect(sel.children[0]!.textContent).toBe("New Activity");
    expect(sel.value).toBe("New Activity");
    expect(probe.sandbox["dirty"]).toBe(true);
    expect(afterCalls).toEqual(["New Activity"]);
    expect(modal.className).toBe("lg-media-picker-overlay lg-hidden"); // closed
    // MINOR-3: not one raw browser dialog anywhere in the whole flow.
    expect(confirms).toHaveLength(0);
  });
});

describeDb("section studio — §8.7 GET /sections/:id/offers answer_fields (server extension)", () => {
  it("each matched offer carries provider, default placement, ACTIVE schema version and its ANSWER-source fields (macro nodes excluded)", async () => {
    const { env } = newHarness();
    const offer = await createOfferWithSchema(env, "Studio Offer A", [
      { path: "data.insured", type: "boolean", required: true, internal_field: "currently_insured", label: "Currently insured?" },
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
    // 12 §12.5 ADDITIVE field_label: authored schema label wins; absent one,
    // the humanized leaf segment (derived — no storage change).
    expect(withSchema.answer_fields[0]!["field_label"]).toBe("Currently insured?");
    expect(withSchema.answer_fields[1]!["field_label"]).toBe("Zip");
    expect(withSchema.answer_fields[2]!["field_label"]).toBe("Coverage");
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

});

// ===========================================================================
// 12 §12.1 / §12.3 (slice D-studio) — the mapping-panel COLUMN CONTRACT
// decode core, the ONE-Fix-action routing and the canvas mapping overlay,
// executed against the SERVED island code (vm-probe)
// ===========================================================================

describeDb("section studio EXECUTED island — 12 §12.1 panel decode + Fix routing + §12.3 overlay", () => {
  // ONE island-shaped offer fixture drives the whole decode matrix. Shapes
  // mirror the REAL /sections/:id/offers projection (field_label included).
  const PANEL_OFFER = {
    id: 11,
    public_id: "lgo_panelfixture",
    offer_name: "Panel Offer",
    provider: "panelprov",
    default_placement_id: "pl-panel",
    has_active_schema: true,
    payload_schema_public_id: "lgp_panelfixture",
    payload_schema_version: 2,
    answer_fields: [
      { path: "data.insured", type: "boolean", required: true, internal_field: "currently_insured", label: null, field_label: "Currently insured?", valid_values: null },
      { path: "data.zip", type: "string", required: true, internal_field: "zip", label: null, field_label: "Zip", valid_values: null },
      { path: "data.coverage", type: "enum", required: false, internal_field: null, label: null, field_label: "Coverage", valid_values: ["basic", "full"] },
      { path: "data.household_count", type: "number", required: false, internal_field: null, label: null, field_label: "Household count", valid_values: null },
    ],
  };

  function panelProbe(html: string, answerMaps: unknown[] = [], selected: number[] = [11]): ReturnType<typeof mappingProbe> {
    return mappingProbe(html, MAPPABLE_CONTENT, { activity: "quote_funnel", vertical: "life", offers: [PANEL_OFFER] }, answerMaps, selected);
  }

  const panelEdge = (over: Record<string, unknown>): Record<string, unknown> => ({
    question_id: "q1",
    question_key: "insured_q",
    internal_field: "currently_insured",
    answer_type: "boolean",
    offer_id: 11,
    offer_payload_field_path: "data.insured",
    provider_expected_type: "boolean",
    output_value_map: null,
    value_transform: null,
    required_for_offer: true,
    default_value: null,
    fallback_value: null,
    ...over,
  });

  it("§12.1 Field column: fieldDisplayLabel prefers the server's field_label, then the authored label, then the humanized leaf — never the raw dotted path", async () => {
    const { env } = newHarness();
    const section = await createSection(env, { content_json: JSON.stringify(MAPPABLE_CONTENT) });
    const html = await studioPage(env, section.public_id);
    const probe = panelProbe(html);
    // server projection wins
    expect(probe.run(`fieldDisplayLabel(answerFieldOf(offerById(11), 'data.insured'))`)).toBe("Currently insured?");
    // pre-§12.5 response shapes: authored label, then humanized leaf
    expect(probe.run(`fieldDisplayLabel({ path: 'lead.loan_amount', label: 'Loan amount requested' })`)).toBe("Loan amount requested");
    expect(probe.run(`fieldDisplayLabel({ path: 'lead.loan_amount' })`)).toBe("Loan amount");
    expect(probe.run(`fieldDisplayLabel({ path: 'zip-code' })`)).toBe("Zip code");
    // the raw path never leaks into the display value
    expect(String(probe.run(`fieldDisplayLabel(answerFieldOf(offerById(11), 'data.household_count'))`))).not.toContain("data.");

    // and the SAME derivation holds against the REAL server projection
    const offerReal = await createOfferWithSchema(env, "Label Source", [
      { path: "data.first_name", type: "string", label: "First name (as on the policy)" },
      { path: "data.household_count", type: "number" },
    ]);
    const res = await admin.request(`${API}/sections/${section.public_id}/offers`, {}, env);
    const body = (await res.json()) as OffersResponse;
    const realOffer = body.offers.find((o) => o.id === offerReal.id)!;
    const realProbe = mappingProbe(html, MAPPABLE_CONTENT, body);
    expect(realOffer.answer_fields.map((f) => f["field_label"])).toEqual(["First name (as on the policy)", "Household count"]);
    expect(realProbe.run(`fieldDisplayLabel(answerFieldOf(offerById(${offerReal.id}), 'data.first_name'))`)).toBe("First name (as on the policy)");
  });

  it("§12.1 Expected type speaks plain words — text / number / yes or no / one of: … / list / group", async () => {
    const { env } = newHarness();
    const section = await createSection(env, { content_json: JSON.stringify(MAPPABLE_CONTENT) });
    const html = await studioPage(env, section.public_id);
    const probe = panelProbe(html);
    expect(probe.run(`plainTypeWords(answerFieldOf(offerById(11), 'data.zip'))`)).toBe("text");
    expect(probe.run(`plainTypeWords(answerFieldOf(offerById(11), 'data.household_count'))`)).toBe("number");
    expect(probe.run(`plainTypeWords(answerFieldOf(offerById(11), 'data.insured'))`)).toBe("yes or no");
    expect(probe.run(`plainTypeWords(answerFieldOf(offerById(11), 'data.coverage'))`)).toBe("one of: basic, full");
    expect(probe.run(`plainTypeWords({ type: 'enum' })`)).toBe("one of the allowed values");
    expect(probe.run(`plainTypeWords({ type: 'array' })`)).toBe("list");
    expect(probe.run(`plainTypeWords({ type: 'object' })`)).toBe("group of fields");
  });

  it("OWNER RULING 2026-08-12: the ONE mapping surface is the inspector — every relevant Offer, a field dropdown, no drawer mapper", async () => {
    const { env } = newHarness();
    const section = await createSection(env, { content_json: JSON.stringify(MAPPABLE_CONTENT) });
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);

    // 1. the inspector lists EVERY matching Offer — the "select it in the drawer
    //    first" gate is gone (that is why he could not see the buyer at all)
    expect(island).toContain("function renderInspectorMapping(");
    expect(island).not.toMatch(/renderInspectorMapping[\s\S]{0,1200}live\.state === 'not_selected'/);
    // 2. picking a field is what selects the Offer; clearing the last one releases it
    expect(island).toMatch(/upsertEdge\(offer, field, node\.internal_field\)/);
    expect(island).toMatch(/edgesForOffer\(offer\.id\)\.length === 0[\s\S]{0,400}selected_offers\.splice/);
    // 3. the option TEXT is the buyer's field label in plain words; the raw path
    //    only ever rides the tooltip
    expect(island).toContain("o.textContent = pathOptionLabel(fields[j]);");
    expect(island).toContain("sel.title = current === '' ?");
    // 4. the backwards surface is GONE: no field→question picker, no bulk-map,
    //    no per-field rows, no "selected" checkbox, no create-question jargon
    for (const dead of [
      "function buildFieldRow(",
      "function buildFixCell(",
      "function renderMapGrid(",
      "function renderBulkReview(",
      "function questionOptions(",
      "function bulkProposals(",
      "function createQuestionForField(",
      "function toggleOfferSelected(",
      "data-studio-field-row",
      "data-studio-offer-select",
      "data-studio-offer-map",
      "data-studio-offer-bulkmap",
      "data-map-question",
      "+ Create question for this field",
      "__create__",
    ]) {
      expect(island, `${dead} must be gone`).not.toContain(dead);
    }
    // 5. what the drawer keeps: a per-Offer readout + the deep links
    expect(island).toContain("function buildOfferHeadRow(");
    expect(island).toContain("schemaLink.href = offerDeepLink(offer);");
    expect(island).toContain("/edit#payload");
    expect(island).toContain("function renderMappingAdvancedPaths(");
    // 6. Re-link… still lands on the inspector's dropdown for that Offer
    expect(island).toContain("function openFixRelink(");
    expect(island).toContain("'[data-inspector-quickmap=\"' + offer.id + '\"]'");
  });

  it("DEV-65(c): the picker speaks the field LABEL + plain type — never a raw dotted path", async () => {
    const { env } = newHarness();
    const section = await createSection(env, { content_json: JSON.stringify(MAPPABLE_CONTENT) });
    const html = await studioPage(env, section.public_id);
    const probe = panelProbe(html);
    expect(probe.run(`pathOptionLabel(answerFieldOf(offerById(11), 'data.insured'))`)).toBe("Currently insured? — yes or no (required)");
    expect(probe.run(`pathOptionLabel(answerFieldOf(offerById(11), 'data.coverage'))`)).toBe("Coverage — one of: basic, full");
    expect(String(probe.run(`pathOptionLabel(answerFieldOf(offerById(11), 'data.household_count'))`))).not.toContain("data.");
  });

  it("§12.3 overlayChipInfo: mapped (n Offers) count + required-missing decode over the live model", async () => {
    const { env } = newHarness();
    const section = await createSection(env, { content_json: JSON.stringify(MAPPABLE_CONTENT) });
    const html = await studioPage(env, section.public_id);

    // fully mapped required field → mapped, 1 Offer, no red
    expect(panelProbe(html, [panelEdge({})]).run(`overlayChipInfo('currently_insured')`))
      .toEqual({ count: 1, required_missing: false });
    // selected Offer, nothing mapped: the schema's required hint names this
    // component → required-missing red
    expect(panelProbe(html, []).run(`overlayChipInfo('currently_insured')`))
      .toEqual({ count: 0, required_missing: true });
    // a required edge that is NOT complete (stored type drift) → red
    const drift = panelEdge({ provider_expected_type: "string" });
    expect(panelProbe(html, [drift]).run(`overlayChipInfo('currently_insured')`))
      .toEqual({ count: 1, required_missing: true });
    // offer not selected → invisible to the overlay
    expect(panelProbe(html, [], []).run(`overlayChipInfo('currently_insured')`))
      .toEqual({ count: 0, required_missing: false });
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
    expect(doc).toContain(`<script data-lg-runtime-version="3">`);
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

  it("EXECUTED island: onPreviewMessage appends ONLY lg-preview-event batches from the island's OWN iframes (MINOR-3 origin gate); clearEventsList resets it", async () => {
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
    // MINOR-3: onPreviewMessage now gates on event.source — it must be one of
    // the island's OWN iframes' contentWindow. Stub getElementById to return
    // the two frame elements, each with a distinct contentWindow sentinel, and
    // a foreign window that is NOT either frame.
    const previewWin = { __frame: "preview" };
    const probeWin = { __frame: "probe" };
    const foreignWin = { __frame: "foreign" };
    const frames: Record<string, { contentWindow: unknown }> = {
      "lg-preview-frame": { contentWindow: previewWin },
      "lg-events-probe-frame": { contentWindow: probeWin },
    };
    const sandbox = {
      previewWin,
      probeWin,
      foreignWin,
      document: {
        querySelector(sel: string) {
          return sel === "[data-studio-events-list]" ? list : null;
        },
        getElementById(id: string) {
          return frames[id] ?? null;
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
      // engine.ts previewSender) posted BY the preview iframe (event.source ===
      // the preview frame's contentWindow) — ACCEPTED.
      "onPreviewMessage({ source: previewWin, data: { type: 'lg-preview-event', events: [" +
        "{ event_type: 'section_view', section_public_id: 'lgs_x', section_index: 0 }," +
        "{ event_type: 'answer_click', question_key: 'insured_q' } ] } });",
      // MINOR-3 decoys that must be IGNORED: a FOREIGN window forging the right
      // type; the island's own frame but the WRONG type; a non-object payload.
      "onPreviewMessage({ source: foreignWin, data: { type: 'lg-preview-event', events: [ { event_type: 'spoofed' } ] } });",
      "onPreviewMessage({ source: previewWin, data: { type: 'other-message' } });",
      "onPreviewMessage({ source: previewWin, data: 'not-an-object' });",
      // a batch from the hidden events-probe iframe is ALSO accepted.
      "onPreviewMessage({ source: probeWin, data: { type: 'lg-preview-event', events: [ { event_type: 'answer_change', question_key: 'insurer_q' } ] } });",
    ].join("\n");
    runInNewContext(source, sandbox);
    // preview batch (2) + probe batch (1) = 3; foreign-source, wrong-type and
    // non-object messages contributed nothing.
    expect(list.children).toHaveLength(3);
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
    // the events-probe iframe's batch was accepted (its contentWindow matched)
    const third = list.children[2] as FakeNode;
    expect(third.attrs.get("data-event-type")).toBe("answer_change");
    // the foreign-window message never injected a row
    const types = list.children.map((c) => (c as FakeNode).attrs.get("data-event-type"));
    expect(types).not.toContain("spoofed");
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

// ---------------------------------------------------------------------------
// §8.8 field-level Google-Maps config (E6; Q5 browser Places leg only):
// SSR panel + EXECUTED collectors (exact runtime keys) + chips + banner + the
// preset seam. The runtime-reader cross-check over the SAME emission literals
// (MAPS_EMITTED_*) lives in test/leadgen-runtime-hydration.test.ts ("§8.8
// studio emissions") — the DOM-lib typecheck program (see import note above).
// ---------------------------------------------------------------------------

const MAPS_CONTENT = {
  components: [
    // AddressAutocompleteQuestion produces `object` — answer_type left
    // implicit (the catalog fallback) like the studio's own makeNode.
    { type: "AddressAutocompleteQuestion", question_id: "q_addr", internal_field: "address_line" },
    { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", answer_type: "string" },
    { type: "FreeTextQuestion", question_id: "q_city", internal_field: "city", answer_type: "string" },
    { type: "FreeTextQuestion", question_id: "q_state", internal_field: "state_field", answer_type: "string" },
  ],
};

// v3.1 §9 — the EXACT {enabled,jobs} shape the inspector writes (Phase C:
// replaces the old flat runtime-key emissions the pre-v3.1 inspector wrote
// directly; presets.ts's mapsJobsFor/isNewMapsShape TRANSLATES this to the
// runtime's flat wire keys, cross-checked in leadgen-components-render.test.ts
// "v3.1 §9.3 — Maps job-based precedence").
function mapsShape(jobs: { validate?: boolean; auction?: boolean; autocomplete?: boolean }): Record<string, unknown> {
  return { enabled: true, jobs: { validate: false, auction: false, autocomplete: false, ...jobs } };
}

interface MapsControlStub {
  checked?: boolean;
  value?: string;
  getAttribute?: (k: string) => string | null;
}

function mapsJobStub(job: string, checked: boolean): MapsControlStub {
  return { checked, getAttribute: (k) => (k === "data-maps-job" ? job : null) };
}

interface MapsBannerStub {
  hidden: boolean;
  attrs: Record<string, string>;
  getAttribute(k: string): string | null;
}

function mapsBannerStub(keyConfigured: boolean): MapsBannerStub {
  return {
    hidden: true,
    attrs: { "data-maps-key-configured": keyConfigured ? "true" : "false" },
    getAttribute(k: string) {
      return this.attrs[k] ?? null;
    },
  };
}

// P5 S5c (ADJ-A9) — the tree-wide "Maps job risk" banner stub: read/write,
// matching renderMapsJobRiskBanner's own hidden + data-maps-job-risk-qid
// read-and-write contract.
interface MapsJobRiskBannerStub {
  hidden: boolean;
  attrs: Record<string, string>;
  getAttribute(k: string): string | null;
  setAttribute(k: string, v: string): void;
}
function mapsJobRiskBannerStub(): MapsJobRiskBannerStub {
  return {
    hidden: true,
    attrs: {},
    getAttribute(k: string) {
      return this.attrs[k] ?? null;
    },
    setAttribute(k: string, v: string) {
      this.attrs[k] = v;
    },
  };
}

interface MapsHiddenStub {
  hidden: boolean;
}
interface MapsTextStub {
  textContent: string;
}

// A document stub that serves ONLY the §9 selectors populateMapsTab/
// collectMapsToggle/collectMapsJob touch. `toggle` and `jobEls` are mutable
// so a test can flip them between collect/populate runs (mirrors the
// pre-v3.1 idiom this replaces).
function mapsDocStub(opts: {
  toggle?: MapsControlStub;
  jobEls?: MapsControlStub[];
  jobsBlock?: MapsHiddenStub;
  zeroJobBanner?: MapsHiddenStub;
  validateCopy?: MapsTextStub;
  keyMissingBanner?: MapsBannerStub;
  jobRiskBanner?: MapsJobRiskBannerStub;
}): Record<string, unknown> {
  const jobsBlock = opts.jobsBlock ?? { hidden: true };
  const zeroJobBanner = opts.zeroJobBanner ?? { hidden: true };
  const validateCopy = opts.validateCopy ?? { textContent: "" };
  return {
    getElementById() {
      return null;
    },
    querySelector(sel: string) {
      if (sel === "[data-maps-enabled-toggle]") return opts.toggle ?? null;
      if (sel === "[data-maps-jobs-block]") return jobsBlock;
      if (sel === "[data-maps-zero-job-banner]") return zeroJobBanner;
      if (sel === "[data-maps-validate-copy]") return validateCopy;
      if (sel === "[data-studio-maps-banner]") return opts.keyMissingBanner ?? null;
      if (sel === "[data-studio-maps-job-risk-banner]") return opts.jobRiskBanner ?? null;
      return null;
    },
    querySelectorAll(sel: string) {
      if (sel === "[data-maps-job]") return opts.jobEls ?? [];
      return [];
    },
  };
}

// v3.1 §9 — the pre-v3.1 flat autofill-picker Maps panel is REPLACED by the
// golden's toggle + 3 whole-row jobs (Validate/Use in auction/Auto-complete),
// writing node.props.maps = {enabled, jobs:{validate,auction,autocomplete}}
// (content-schema.ts §9.2). The manual per-field autofill-TARGET picker has
// no successor in the golden design (flagged contract gap, final report) —
// mapsFillLabels/nodeMapsEnabled stay for legacy stored content only.
describeDb("section studio — §9 field-level Maps config (job-based model, Phase C)", () => {
  it("SSR: Maps tab carries the toggle + 3 job checkboxes; the meta blob marks address/zip modes; the legacy toggle notes per-field wins", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toContain('data-studio-inspector-tab="maps"');
    expect(html).toContain('data-studio-panel="maps"');
    expect(html).toContain("data-maps-enabled-toggle");
    expect(html).toContain("data-maps-jobs-block");
    expect(html).toContain("data-maps-zero-job-banner");
    for (const job of ["validate", "auction", "autocomplete"]) {
      expect(html, `job ${job}`).toContain(`data-maps-job="${job}"`);
    }
    // the studio meta blob drives the tab + panel gating island-side
    const meta = extractJsonBlob(html, "lg-studio-meta");
    const types = meta["types"] as Record<string, Record<string, unknown>>;
    expect(types["AddressAutocompleteQuestion"]!["maps"]).toBe("address");
    expect(types["ZIPInputQuestion"]!["maps"]).toBe("zip");
    expect(types["TwoButtonYesNo"]!["maps"]).toBeNull();
    // R5 D2 (register S4-A2): the legacy global Maps/validation fieldset is
    // REMOVED — safe post-R4b (S3-8 proved per-field precedence in both
    // readers). The field's OWN Maps tab (asserted above: data-maps-enabled-
    // toggle / data-maps-jobs-block / the 3 data-maps-job entries) is the
    // real, current mechanism — no legacy checkbox/note survives anywhere.
    expect(html).not.toContain('id="lg-address-validation"');
    expect(html).not.toContain("data-maps-legacy-note");
    expect(html).not.toContain("data-maps-precedence-note");
  });

  it("SSR: the key-missing banner ships HIDDEN with the exact no-op contract copy + the key state attribute (no key in the test env)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const banner = /<p class="studio-maps-banner"[^>]*>([^<]*)<\/p>/.exec(html);
    expect(banner, "banner present").not.toBeNull();
    expect(banner![0]).toContain("data-studio-maps-banner");
    expect(banner![0]).toContain('data-maps-key-configured="false"');
    expect(banner![0]).toContain(" hidden");
    expect(banner![0]).toContain('role="status"');
    // the §8.8 contract copy, verbatim
    expect(banner![1]).toContain("Autocomplete/validation will no-op; manual entry still works");
  });

  it("EXECUTED: the enabled toggle writes {enabled:true, jobs:{false,false,false}}; turning it off deletes props.maps entirely", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const toggle: MapsControlStub = { checked: true };
    const probe = studioProbe(html, MAPS_CONTENT, mapsDocStub({ toggle }));
    probe.sandbox.selectedQuestionId = "q_addr";
    probe.run("collectMapsToggle()");
    const node = probe.run("findRef('q_addr').node") as { props?: Record<string, unknown> };
    expect(node.props?.["maps"]).toEqual(mapsShape({}));
    // the mutated tree stays valid for the REAL server validator
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);

    // turning OFF deletes props.maps — and the (otherwise-empty) props
    // object itself: the node is CLEAN again
    toggle.checked = false;
    probe.run("collectMapsToggle()");
    const cleared = probe.run("findRef('q_addr').node") as Record<string, unknown>;
    expect(cleared["props"]).toBeUndefined();
  });

  it("EXECUTED: job checkboxes collect independently once enabled; a job change is a no-op while enabled is not true (guard)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const toggle: MapsControlStub = { checked: true };
    const probe = studioProbe(html, MAPS_CONTENT, mapsDocStub({ toggle }));
    probe.sandbox.selectedQuestionId = "q_zip";
    probe.run("collectMapsToggle()"); // seeds enabled:true, all jobs false
    // collectMapsJob takes the CHECKBOX ELEMENT directly (not a document
    // query) — call it with an inline stub, mirroring how the ES5 handler
    // wires "this" from the change-event listener.
    const jobStubExpr = (job: string, checked: boolean): string =>
      `{ checked: ${String(checked)}, getAttribute: function (k) { return k === 'data-maps-job' ? '${job}' : null; } }`;
    probe.run(`collectMapsJob(${jobStubExpr("validate", true)})`);
    let node = probe.run("findRef('q_zip').node") as { props?: Record<string, unknown> };
    expect(node.props?.["maps"]).toEqual(mapsShape({ validate: true }));

    probe.run(`collectMapsJob(${jobStubExpr("autocomplete", true)})`);
    node = probe.run("findRef('q_zip').node") as { props?: Record<string, unknown> };
    expect(node.props?.["maps"]).toEqual(mapsShape({ validate: true, autocomplete: true }));

    probe.run(`collectMapsJob(${jobStubExpr("validate", false)})`);
    node = probe.run("findRef('q_zip').node") as { props?: Record<string, unknown> };
    expect(node.props?.["maps"]).toEqual(mapsShape({ autocomplete: true }));

    // the guard: a job-checkbox change on a node with NO enabled:true config
    // (never toggled on) must not fabricate a config.
    probe.sandbox.selectedQuestionId = "q_addr";
    probe.run(`collectMapsJob(${jobStubExpr("validate", true)})`);
    const addrNode = probe.run("findRef('q_addr').node") as Record<string, unknown>;
    expect(addrNode["props"]).toBeUndefined();
  });

  it("EXECUTED: populateMapsTab reflects enabled/jobs state, the zero-job banner, and the mode-specific validate copy", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const toggle: MapsControlStub = { checked: false };
    const zeroJobBanner: MapsHiddenStub = { hidden: true };
    const validateCopy: MapsTextStub = { textContent: "" };
    const jobEls = [mapsJobStub("validate", false), mapsJobStub("auction", false), mapsJobStub("autocomplete", false)];
    const probe = studioProbe(html, MAPS_CONTENT, mapsDocStub({ toggle, jobEls, zeroJobBanner, validateCopy }));
    probe.sandbox.selectedQuestionId = "q_zip";
    // enabled:true + 0 jobs -> the LIVE zero-job banner shows (§9.3 mirror of
    // the save-time maps_no_job warning) + ZIP-specific validate copy
    probe.run(
      "findRef('q_zip').node.props = { maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: false } } }",
    );
    probe.run("populateMapsTab(findRef('q_zip').node, typeMeta('ZIPInputQuestion'))");
    expect(toggle.checked).toBe(true);
    expect(zeroJobBanner.hidden).toBe(false);
    expect(validateCopy.textContent).toContain("ZIP");
    // a job selected -> banner clears
    probe.run("findRef('q_zip').node.props.maps.jobs.validate = true");
    probe.run("populateMapsTab(findRef('q_zip').node, typeMeta('ZIPInputQuestion'))");
    expect(zeroJobBanner.hidden).toBe(true);
    expect(jobEls[0]!.checked).toBe(true);
    // the address mode gets its OWN validate copy (flagged contract gap: no
    // asserted Address-specific string exists — a faithful generalization)
    probe.sandbox.selectedQuestionId = "q_addr";
    probe.run(
      "findRef('q_addr').node.props = { maps: { enabled: true, jobs: { validate: true, auction: false, autocomplete: false } } }",
    );
    probe.run("populateMapsTab(findRef('q_addr').node, typeMeta('AddressAutocompleteQuestion'))");
    expect(validateCopy.textContent).toContain("address");
  });

  it("EXECUTED: chip labels derive from the config's autofill keys in the runtime link order (flat AND nested-fills legacy shape)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const probe = studioProbe(html, MAPS_CONTENT);
    // flat §8.8 keys (as the collectors write them) — order street,city,state,zip
    probe.run("findRef('q_zip').node.props = { maps: { validate_zip: true, autofill_city: 'city', autofill_state: 'state_field', enable_autocomplete: true } }");
    expect(probe.run("mapsFillLabels(findRef('q_zip').node)")).toEqual(["city", "state"]);
    probe.run("findRef('q_addr').node.props = { maps: { autofill_zip: 'zip', autofill_city: 'city' } }");
    expect(probe.run("mapsFillLabels(findRef('q_addr').node)")).toEqual(["city", "zip"]);
    // the nested `fills` spelling parseMapsConfig also accepts
    probe.run("findRef('q_addr').node.props = { maps: { fills: { state: 'state_field' } } }");
    expect(probe.run("mapsFillLabels(findRef('q_addr').node)")).toEqual(["state"]);
    // nodeMapsEnabled: {} config → nothing on; legacy compat spellings count;
    // the NEW {enabled:true} shape counts too (§9.3)
    probe.run("findRef('q_addr').node.props = { maps: {} }");
    expect(probe.run("nodeMapsEnabled(findRef('q_addr').node)")).toBe(false);
    probe.run("findRef('q_addr').node.props = { maps: { validate: true } }");
    expect(probe.run("nodeMapsEnabled(findRef('q_addr').node)")).toBe(true);
    probe.run(
      "findRef('q_addr').node.props = { maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: false } } }",
    );
    expect(probe.run("nodeMapsEnabled(findRef('q_addr').node)")).toBe(true);
    probe.run("findRef('q_addr').node.props = {}");
    expect(probe.run("nodeMapsEnabled(findRef('q_addr').node)")).toBe(false);
  });

  it("EXECUTED: the key-missing banner shows ONLY for enabled-config + missing key (key present → hidden; nothing enabled → hidden); recognizes the NEW shape", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const banner = mapsBannerStub(false);
    const probe = studioProbe(html, MAPS_CONTENT, mapsDocStub({ keyMissingBanner: banner }));
    // no Maps-enabled component → hidden even without a key
    probe.run("renderMapsBanner()");
    expect(banner.hidden).toBe(true);
    // a Maps-enabled component (NEW shape) + missing key → SHOWN
    probe.run(
      "findRef('q_zip').node.props = { maps: { enabled: true, jobs: { validate: true, auction: false, autocomplete: false } } }",
    );
    probe.run("renderMapsBanner()");
    expect(banner.hidden).toBe(false);
    // key configured → hidden regardless of config
    banner.attrs["data-maps-key-configured"] = "true";
    probe.run("renderMapsBanner()");
    expect(banner.hidden).toBe(true);
  });

  // P5 S5c (ADJ-A9): the operator can DISCOVER a "Maps enabled, zero jobs
  // picked" misconfiguration from the top of the Studio (whole-tree walk,
  // like renderMapsBanner) instead of only hitting a bare 409 at the Quote's
  // activation preflight. content-schema.ts's maps_no_job is a save-time
  // WARNING but an activation-preflight ERROR (§9.3) — this banner closes
  // that discoverability gap PRE-emptively, in-Studio.
  it("EXECUTED: the Maps job-risk banner shows tree-wide for ANY zero-job Maps-enabled field (not just the selected one), names the offending qid, and clears once a job is picked", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const riskBanner = mapsJobRiskBannerStub();
    const probe = studioProbe(html, MAPS_CONTENT, mapsDocStub({ jobRiskBanner: riskBanner }));
    // nothing Maps-enabled yet → hidden
    probe.run("renderMapsJobRiskBanner()");
    expect(riskBanner.hidden).toBe(true);
    // q_zip: Maps enabled, ALL jobs false → the risk is real, tree-wide,
    // regardless of which node (if any) is "selected" in the island.
    probe.run(
      "findRef('q_zip').node.props = { maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: false } } }",
    );
    probe.run("renderMapsJobRiskBanner()");
    expect(riskBanner.hidden).toBe(false);
    expect(riskBanner.attrs["data-maps-job-risk-qid"]).toBe("q_zip");
    // picking a job clears the risk
    probe.run("findRef('q_zip').node.props.maps.jobs.validate = true;");
    probe.run("renderMapsJobRiskBanner()");
    expect(riskBanner.hidden).toBe(true);
  });

  it("round-trip: props.maps {enabled,jobs} → content JSON → REAL validator clean → renderComponent translates to the runtime's flat data-lg-maps wire keys (the preset seam)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const toggle: MapsControlStub = { checked: true };
    const probe = studioProbe(html, MAPS_CONTENT, mapsDocStub({ toggle }));
    probe.sandbox.selectedQuestionId = "q_zip";
    probe.run("collectMapsToggle()");
    probe.run(
      "collectMapsJob({ checked: true, getAttribute: function (k) { return k === 'data-maps-job' ? 'validate' : null; } })",
    );
    // serialize exactly like the save path (collectSection JSON.stringifys
    // state.content), re-parse, and run the REAL server validator
    const roundTripped = JSON.parse(JSON.stringify(probe.sandbox.state.content)) as {
      components: LeadgenComponentNode[];
    };
    expect(validateSectionContent(roundTripped).errors).toEqual([]);
    const zipNode = flattenComponents(roundTripped.components).find((n) => n.question_id === "q_zip");
    expect(zipNode, "zip node survives the round trip").toBeDefined();
    expect(zipNode!.props?.["maps"]).toEqual(mapsShape({ validate: true }));
    // …and the REAL preset renderer TRANSLATES it to the runtime's flat wire
    // keys (mapsJobsFor/mapsConfigJson, presets.ts) — cross-checked against
    // this EXACT translation in leadgen-components-render.test.ts's
    // "v3.1 §9.3 — Maps job-based precedence" describe block.
    const rendered = renderComponent(zipNode!, defaultFunnelDesign);
    expect(rendered).toContain('data-validate="google"');
    const attr = /data-lg-maps="([^"]*)"/.exec(rendered);
    expect(attr, "data-lg-maps attribute present").not.toBeNull();
    const decoded = attr![1]!
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
    expect(JSON.parse(decoded)).toEqual({ enable_autocomplete: false, validate: true });
    // P5 S5a (D3 composite-by-default) STRENGTHENING: the address twin is an
    // UNCONFIGURED node (no props.fields authored) — it no longer renders the
    // retired single bare input + a "{}" compat fallback. It now renders the
    // SAME 4-field street/city/state/zip composite the studio inspector's own
    // default shows (renderAddressFieldSet + ADDRESS_DEFAULT_FIELD_SPECS),
    // with REAL data-lg-field names and a REAL (non-empty) data-lg-maps
    // config on the field driving Places autocomplete (defaults to street —
    // Maps defaults ON for an unconfigured node, isNewMapsShape's own
    // fallback), carrying the sibling-fill map to the other 3 fields.
    const addrNode = flattenComponents(roundTripped.components).find((n) => n.question_id === "q_addr");
    const addrRendered = renderComponent(addrNode!, defaultFunnelDesign);
    expect(addrRendered).toContain('data-lg-field="address_line_street"');
    expect(addrRendered).toContain('data-lg-field="address_line_city"');
    expect(addrRendered).toContain('data-lg-field="address_line_state"');
    expect(addrRendered).toContain('data-lg-field="address_line_zip"');
    expect(addrRendered).not.toContain('data-lg-maps="{}"');
    const addrMapsMatch = addrRendered.match(/data-lg-maps="([^"]*)"/);
    expect(addrMapsMatch, "the autocomplete-driving field carries a REAL data-lg-maps config").not.toBeNull();
    const addrMapsDecoded = addrMapsMatch![1]!.replace(/&quot;/g, '"');
    // B1/R1-1 re-mint: pinned bytes froze the defective nested data-lg-maps; flat shape per presets.ts flatMapsConfigJson — still pins that the round trip preserves autocomplete=true/validate=false plus the sibling-fill map onto the runtime wire.
    expect(JSON.parse(addrMapsDecoded)).toEqual({
      enable_autocomplete: true,
      validate: false,
      fills: { city: "address_line_city", state: "address_line_state", zip: "address_line_zip" },
    });
  });
});

// ===========================================================================
// P4 defect fixes — §9.2/§14.9 static sim documents · B9 §6.4 choiceDisplay
// order-independence · §8.1/E6 events-panel layout hygiene · §8.5/§8.6
// TrustBar/LogoStrip/StepIndicator authoring (the §8.11 gaps)
// ===========================================================================

const STATIC_SIM_DEP_CONTENT = {
  components: [
    { type: "TwoButtonYesNo", question_id: "q1", internal_field: "currently_insured", answer_type: "boolean" },
    {
      type: "DropdownQuestion",
      question_id: "q2",
      internal_field: "insurer",
      answer_type: "enum",
      choices: [{ label: "Acme", value: "acme", analytics_id: "i_acme" }],
      conditional: { when: "currently_insured", op: "eq", value: true },
    },
  ],
};

describeDb("P4 fix — §9.2/§14.9 NON-default sims are STATIC documents (no runtime re-hide)", () => {
  it("sim≠default + runtime:true → preview.static_html: the shell-shaped srcdoc WITHOUT any script (data-lg-ready preset; the satisfied reveal STAYS); events_html keeps the runtime", async () => {
    const { env } = newHarness();
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: JSON.stringify(STATIC_SIM_DEP_CONTENT),
        viewport: "desktop",
        runtime: true,
        sim: { state: "dependency", answers: { currently_insured: true } },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { preview: Record<string, unknown> };

    const staticDoc = String(body.preview["static_html"]);
    // a COMPLETE shell-shaped document…
    expect(staticDoc.startsWith("<!doctype html>")).toBe(true);
    expect(staticDoc).toContain('id="lg-funnel-root"');
    expect(staticDoc).toContain("data-lg-mount");
    expect(staticDoc).toContain("data-lg-section");
    // …that is READY by construction (nothing hydrates a static still)…
    expect(staticDoc).toContain('data-lg-ready="1"');
    // …and carries NO script whatsoever — no runtime boot can re-apply
    // dependency visibility over an empty answer store (§14.9 reveal defect)
    expect(staticDoc).not.toContain("<script");
    // the SERVER-revealed dependency target is IN the static markup
    expect(staticDoc).toContain('data-lg-question="q2"');

    // the events panel document is SEPARATE and keeps its runtime (§9.1)
    const eventsDoc = String(body.preview["events_html"]);
    expect(eventsDoc).toContain('id="lg-config"');
    expect(eventsDoc).toContain('<script data-lg-runtime-version="');
    expect(eventsDoc).toContain(LEADGEN_RUNTIME_JS);
    // events_html root does NOT pre-claim readiness — the engine sets it
    // (markup-scoped: the inlined bundle text carries the attribute name)
    const eventsMarkup = eventsDoc.slice(0, eventsDoc.indexOf('id="lg-config"'));
    expect(eventsMarkup).not.toContain('data-lg-ready="1"');

    // unmet answers → the dependent leaf is NOT in the static markup
    const unmet = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: JSON.stringify(STATIC_SIM_DEP_CONTENT),
        viewport: "desktop",
        runtime: true,
        sim: { state: "dependency", answers: { currently_insured: false } },
      }),
      env,
    );
    const unmetBody = (await unmet.json()) as { preview: Record<string, unknown> };
    expect(String(unmetBody.preview["static_html"])).not.toContain('data-lg-question="q2"');
  });

  it("default sim keeps FULL hydration (no static_html; events_html IS the main document); non-runtime bodies gain nothing", async () => {
    const { env } = newHarness();
    const dflt = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: JSON.stringify(STATIC_SIM_DEP_CONTENT),
        viewport: "desktop",
        runtime: true,
        sim: { state: "default" },
      }),
      env,
    );
    const dfltBody = (await dflt.json()) as { preview: Record<string, unknown> };
    expect("static_html" in dfltBody.preview).toBe(false);
    expect(String(dfltBody.preview["events_html"])).toContain('<script data-lg-runtime-version="');

    // a sim WITHOUT the runtime flag stays the legacy shape (no new keys)
    const plain = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: JSON.stringify(STATIC_SIM_DEP_CONTENT),
        sim: { state: "dependency", answers: { currently_insured: true } },
      }),
      env,
    );
    const plainBody = (await plain.json()) as { preview: Record<string, unknown> };
    expect("static_html" in plainBody.preview).toBe(false);
    expect("events_html" in plainBody.preview).toBe(false);
  });

  it("the island routes the documents: static_html → main frame, events_html → the hidden probe frame (SSR probe iframe + wiring present)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // the SSR probe frame next to the main preview frame (sandboxed, hidden)
    expect(html).toContain('id="lg-events-probe-frame"');
    expect(html).toMatch(/<iframe id="lg-events-probe-frame"[^>]*sandbox="allow-scripts"[^>]*aria-hidden="true"/);
    expect(html).toContain(".lg-events-probe-frame{position:absolute");
    const island = studioIsland(html);
    // the srcdoc routing: static doc wins the main frame; the probe frame
    // carries the runtime events document; default parks the probe
    expect(island).toContain("res.body.preview.static_html");
    expect(island).toContain("getElementById('lg-events-probe-frame')");
    expect(island).toContain("probe.setAttribute('srcdoc', eventsDoc)");
    expect(island).toContain("probe.removeAttribute('srcdoc')");
  });
});

describeDb("P4 fix — B9 §6.4 choiceDisplay-only edits persist (EXECUTED wiring probe)", () => {
  interface ListenerEl {
    checked?: boolean;
    value?: string;
    type?: string;
    listeners: Record<string, () => void>;
    addEventListener(ev: string, fn: () => void): void;
    getAttribute?(k: string): string | null;
  }
  function listenerEl(init: Partial<ListenerEl>): ListenerEl {
    return {
      listeners: {},
      addEventListener(ev, fn) {
        this.listeners[ev] = fn;
      },
      ...init,
    } as ListenerEl;
  }

  it("Rework §6.5: enabling authored Other + a value lands props.other = {enabled, label?, choices} in the model (collectOther) — the removed choiceDisplay/mainValues path is gone", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // the island wires the §6.5 Other editor; the choiceDisplay machinery is gone
    expect(island).toContain("function collectOther(");
    expect(island).toContain("function toggleOtherEnabled(");
    expect(island).not.toContain("function collectChoiceDisplay(");

    const CHOICES_MODEL = {
      components: [
        {
          type: "ButtonAnswerGroup",
          question_id: "q_make",
          internal_field: "car_make",
          answer_type: "enum",
          choices: [
            { label: "Toyota", value: "toyota", analytics_id: "c_toyota" },
            { label: "Honda", value: "honda", analytics_id: "c_honda" },
          ],
        },
      ],
    };
    // DOM stubs mirroring the served §6.5 Other editor: the enable toggle, the
    // Other label, and a values list with ONE authored row (label/value/
    // analytics_id — the base-choice anatomy).
    const otherFieldInput = (f: string, v: string) => ({ getAttribute: () => f, value: v });
    const otherRow = {
      querySelectorAll(sel: string) {
        return sel === "[data-other-field]"
          ? [otherFieldInput("label", "Diesel"), otherFieldInput("value", "diesel"), otherFieldInput("analytics_id", "c_diesel")]
          : [];
      },
    };
    const otherList = {
      querySelectorAll(sel: string) {
        return sel === "[data-other-row]" ? [otherRow] : [];
      },
    };
    const enabledCb = { checked: true, type: "checkbox" };
    const fieldsWrap = { hidden: false };
    const labelInput = { value: "Other brands" };
    const docStub = {
      getElementById() {
        return null;
      },
      querySelector(sel: string) {
        if (sel === "[data-other-enabled]") return enabledCb;
        if (sel === "[data-other-fields]") return fieldsWrap;
        if (sel === "[data-other-label]") return labelInput;
        if (sel === "[data-other-values]") return otherList;
        return null;
      },
      querySelectorAll() {
        return [];
      },
    };
    const probe = studioProbe(html, CHOICES_MODEL, docStub as unknown as Record<string, unknown>);
    // slice the §6.5 collector + its matrix-gating primitives (cap/capsOf read
    // studioMeta.capabilities, projected by studioTypeMeta and carried in the
    // served meta blob studioProbe loads into the sandbox).
    probe.run(
      [
        sliceIslandFunction(island, "capsOf"),
        sliceIslandFunction(island, "cap"),
        sliceIslandFunction(island, "collectOther"),
      ].join("\n"),
    );
    probe.sandbox.selectedQuestionId = "q_make";
    probe.run("collectOther()");
    const node = probe.run("findRef('q_make').node") as Record<string, unknown>;
    // authored Other reaches props.other (NOT a top-level field, NOT choiceDisplay)
    expect(node["choiceDisplay"], "choiceDisplay is retired").toBeUndefined();
    expect((node["props"] as Record<string, unknown>)["other"], "authored Other reached props.other").toEqual({
      enabled: true,
      label: "Other brands",
      choices: [{ label: "Diesel", value: "diesel", analytics_id: "c_diesel" }],
    });
    // base choices are UNTOUCHED — Other is a separate authored list, not a re-bucket
    expect((node["choices"] as Array<Record<string, unknown>>).map((c) => c["value"])).toEqual([
      "toyota",
      "honda",
    ]);
    // the mutated model is server-valid (the §6.5 props.other shape)
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
  });

  // P5 S5c (ADJ-A7): an "Other" value row the operator leaves with an empty
  // label is NEVER silently dropped — collectOther() already PRESERVES it
  // (missing only the `label` key); before this fix the studio's issues chip
  // never looked at props.other at all, so "No structural issues" could read
  // clean while the row was actually invalid — a save round-trip was the
  // FIRST the operator would hear about it. FAIL-BEFORE/PASS-AFTER: reverting
  // computeIssues()'s new props.other mirror reproduces the silent-chip gap
  // (computeIssues() returns [] for this exact model); with the fix in place
  // the SAME model surfaces a VISIBLE, clickable issue — cross-checked
  // against the REAL server validator so the client mirror and server truth
  // agree on what's actually wrong (E10/E11: one real side of this boundary
  // is the actual validateSectionContent call, not a hand-typed expectation).
  it("ADJ-A7: an other-value row with an empty label is preserved (never silently dropped) AND surfaces as a VISIBLE studio issue matching the REAL server rejection", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const CHOICES_MODEL = {
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
    const otherFieldInput = (f: string, v: string) => ({ getAttribute: () => f, value: v });
    const otherRow = {
      querySelectorAll(sel: string) {
        return sel === "[data-other-field]"
          ? [otherFieldInput("label", ""), otherFieldInput("value", "diesel"), otherFieldInput("analytics_id", "")]
          : [];
      },
    };
    const otherList = {
      querySelectorAll(sel: string) {
        return sel === "[data-other-row]" ? [otherRow] : [];
      },
    };
    const enabledCb = { checked: true, type: "checkbox" };
    const fieldsWrap = { hidden: false };
    const labelInput = { value: "" };
    const docStub = {
      getElementById() {
        return null;
      },
      querySelector(sel: string) {
        if (sel === "[data-other-enabled]") return enabledCb;
        if (sel === "[data-other-fields]") return fieldsWrap;
        if (sel === "[data-other-label]") return labelInput;
        if (sel === "[data-other-values]") return otherList;
        return null;
      },
      querySelectorAll() {
        return [];
      },
    };
    const probe = studioProbe(html, CHOICES_MODEL, docStub as unknown as Record<string, unknown>);
    probe.run(
      [
        sliceIslandFunction(island, "capsOf"),
        sliceIslandFunction(island, "cap"),
        sliceIslandFunction(island, "collectOther"),
      ].join("\n"),
    );
    probe.sandbox.selectedQuestionId = "q_make";
    probe.run("collectOther()");
    const node = probe.run("findRef('q_make').node") as { props?: { other?: { choices?: Array<Record<string, unknown>> } } };
    // preserved — the row survives with the value/analytics_id it had, just
    // no label key (never removed from the array).
    expect(node.props?.other?.choices).toEqual([{ value: "diesel", analytics_id: "diesel" }]);
    // VISIBLE in the issues chip — computeIssues() is already sliced via
    // MODEL_FUNCS by studioProbe's own baseline.
    const issues = probe.run("computeIssues()") as Array<{ qid: string; message: string }>;
    expect(issues.some((i) => i.qid === "q_make" && /Other.*missing its label/.test(i.message)), JSON.stringify(issues)).toBe(true);
    // …and it MATCHES the real server rejection for the identical content —
    // the client mirror isn't inventing its own rule.
    const serverErrors = validateSectionContent(probe.sandbox.state.content).errors;
    expect(serverErrors.some((e) => e.code === "invalid_choice" && e.path.includes("props.other.choices[0].label"))).toBe(true);
  });
});

describeDb("P4 fix — §8.1/E6 events-panel layout hygiene (CSS containment pins)", () => {
  it("the studio styles break compact-JSON event lines and let .admin-main shrink (no min-content stretch past the viewport)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // the unbreakable-line fix on the event list items
    expect(html).toContain(".studio-events-list li{padding:1px 0;overflow-wrap:anywhere;word-break:break-word}");
    // the flex chain: layout.ts .admin-main{flex:1} needs min-width:0 to stop
    // the intrinsic min-content width of the JSON lines propagating up
    expect(html).toContain(".admin-main{min-width:0}");
  });
});

// ---------------------------------------------------------------------------
// P4 authoring gaps — §8.5/§8.6 TrustBar items+layout · LogoStrip logos ·
// StepIndicator steps/current (SSR controls + EXECUTED collect + save seam)
// ---------------------------------------------------------------------------

const P4_GAPS_CONTENT = {
  components: [
    { type: "TrustBar", question_id: "q_trust" },
    { type: "LogoStrip", question_id: "q_logos" },
    { type: "StepIndicator", question_id: "q_steps" },
  ],
};

// A host-side container-prop input stub collectContainerProp can consume.
function propInput(prop: string, kind: string, value: string, type = "text"): Record<string, unknown> {
  return {
    type,
    value,
    getAttribute(k: string): string | null {
      if (k === "data-container-prop") return prop;
      if (k === "data-container-kind") return kind;
      return null;
    },
  };
}

describeDb("P4 authoring gaps — TrustBar/LogoStrip/StepIndicator inspectors", () => {
  it("SSR: the three inspector groups render with the §8.5-idiom controls; the meta blob + availableTabsFor expose the Layout tab for them", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);

    // TrustBar: items line-editor (icon|text) + layout enum (horizontal|stacked)
    const trustGroup = html.slice(
      html.indexOf('data-container-group="TrustBar"'),
      html.indexOf('data-container-group="LogoStrip"'),
    );
    expect(trustGroup).toContain('data-container-prop="items"');
    expect(trustGroup).toContain('data-container-kind="lines"');
    expect(trustGroup).toContain('data-container-prop="layout"');
    expect(trustGroup).toContain('<option value="horizontal">');
    expect(trustGroup).toContain('<option value="stacked">');
    // LogoStrip: logos line-editor (mediaId|alt)
    const logoGroup = html.slice(
      html.indexOf('data-container-group="LogoStrip"'),
      html.indexOf('data-container-group="StepIndicator"'),
    );
    expect(logoGroup).toContain('data-container-prop="logos"');
    expect(logoGroup).toContain('data-container-kind="lines"');
    // StepIndicator: steps + current NUMERIC inputs, min 1
    const stepGroup = html.slice(html.indexOf('data-container-group="StepIndicator"'));
    expect(stepGroup).toMatch(/<input[^>]*type="number"[^>]*min="1"[^>]*data-container-prop="steps"/);
    expect(stepGroup).toMatch(/<input[^>]*type="number"[^>]*min="1"[^>]*data-container-prop="current"/);

    // the meta blob flags the three types (and only prop-bearing types)
    const meta = extractJsonBlob(html, "lg-studio-meta")["types"] as Record<string, Record<string, unknown>>;
    for (const type of ["TrustBar", "LogoStrip", "StepIndicator", "Stack", "FooterBar"]) {
      expect(meta[type]!["layout_props"], `${type}.layout_props`).toBe(true);
    }
    expect(meta["ReassuranceBadge"]!["layout_props"]).toBe(false);

    // v3.1 §8.5 "Style tab (any visual selection)": the pre-v3.1 Layout tab
    // folded into Style UNCONDITIONALLY for every type (a capability
    // EXPANSION, not gated per-type at the tab level anymore) — the SLICED
    // availableTabsFor now returns 'style' for ALL three, and for
    // ReassuranceBadge too. The REAL remaining differentiation is which
    // data-container-group renders WITHIN the Style tab body (still gated
    // per type, unchanged mechanism) — StepIndicator/TrustBar have one,
    // ReassuranceBadge does not.
    const island = studioIsland(html);
    const probe = studioProbe(html, P4_GAPS_CONTENT);
    // R3b: availableTabsFor now also reads these two top-level island vars
    // (frame-scope Content honesty + the text-family Rules exclusion) —
    // inject them alongside the sliced function, mirroring how this sandbox
    // already injects every other sibling dependency.
    probe.run(sliceIslandVar(island, "FRAME_SCOPE_STUDIO_TYPES"));
    probe.run(sliceIslandVar(island, "RULES_EXCLUDED_TEXT_TYPES"));
    probe.run(sliceIslandFunction(island, "availableTabsFor"));
    expect(probe.run("availableTabsFor({ type: 'StepIndicator' })")).toContain("style");
    expect(probe.run("availableTabsFor({ type: 'TrustBar' })")).toContain("style");
    expect(probe.run("availableTabsFor({ type: 'ReassuranceBadge' })")).toContain("style");
    expect(html).toContain('data-container-group="StepIndicator"');
    expect(html).toContain('data-container-group="TrustBar"');
    expect(html).not.toContain('data-container-group="ReassuranceBadge"');
  });

  it("EXECUTED: TrustBar items (icon|text lines) + layout collect into the model, render via the REAL preset, and round-trip the populate leg", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, P4_GAPS_CONTENT);
    probe.run(sliceIslandFunction(island, "linesValue")); // populate leg
    probe.sandbox.selectedQuestionId = "q_trust";

    probe.sandbox["__items"] = propInput("items", "lines", "🔒|SSL secured\n★|4.8 rating\nNo spam ever", "textarea");
    probe.run("collectContainerProp(__items)");
    probe.sandbox["__layout"] = propInput("layout", "enum", "stacked", "select-one");
    probe.run("collectContainerProp(__layout)");

    const node = probe.run("findRef('q_trust').node") as { props?: Record<string, unknown> };
    expect(node.props?.["items"]).toEqual([
      { icon: "🔒", text: "SSL secured" },
      { icon: "★", text: "4.8 rating" },
      { text: "No spam ever" }, // bare line → text-only item (icon optional)
    ]);
    expect(node.props?.["layout"]).toBe("stacked");
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);

    // the REAL preset renders the authored pairs (the §8.5 shape the render reads)
    const rendered = renderComponent(node as unknown as LeadgenComponentNode, defaultFunnelDesign);
    expect(rendered).toContain("lg-trustbar-stacked");
    expect(rendered).toContain("SSL secured");
    expect(rendered).toContain("4.8 rating");
    expect((rendered.match(/lg-trustbar-item/g) ?? []).length).toBe(3);

    // populate leg: linesValue reproduces the authored lines exactly
    expect(probe.run("linesValue('items', findRef('q_trust').node.props.items)")).toBe(
      "🔒|SSL secured\n★|4.8 rating\nNo spam ever",
    );
  });

  it("EXECUTED: LogoStrip logos (mediaId|alt lines) collect, render as <img>, and round-trip", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, P4_GAPS_CONTENT);
    probe.run(sliceIslandFunction(island, "linesValue"));
    probe.sandbox.selectedQuestionId = "q_logos";

    probe.sandbox["__logos"] = propInput("logos", "lines", "media_1|Acme\nmedia_2", "textarea");
    probe.run("collectContainerProp(__logos)");
    const node = probe.run("findRef('q_logos').node") as { props?: Record<string, unknown> };
    expect(node.props?.["logos"]).toEqual([{ mediaId: "media_1", alt: "Acme" }, { mediaId: "media_2" }]);
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);

    const rendered = renderComponent(node as unknown as LeadgenComponentNode, defaultFunnelDesign);
    expect(rendered).toContain('src="/media/media_1" alt="Acme"'); // /media/ prefix: see leadgen-card-image-media-url
    expect(rendered).toContain('src="/media/media_2" alt=""');
    expect(probe.run("linesValue('logos', findRef('q_logos').node.props.logos)")).toBe("media_1|Acme\nmedia_2");
    // an alt-less line without mediaId is dropped (mediaId required)
    probe.sandbox["__badLogos"] = propInput("logos", "lines", "|orphan alt", "textarea");
    probe.run("collectContainerProp(__badLogos)");
    const cleared = probe.run("findRef('q_logos').node") as { props?: Record<string, unknown> };
    expect(cleared.props?.["logos"]).toBeUndefined();
  });

  it("EXECUTED: StepIndicator steps/current numeric collect with the ≥1 + current≤steps clamps; the REAL preset renders the authored dots", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const probe = studioProbe(html, P4_GAPS_CONTENT);
    probe.sandbox.selectedQuestionId = "q_steps";

    probe.sandbox["__steps"] = propInput("steps", "int", "4", "number");
    probe.run("collectContainerProp(__steps)");
    probe.sandbox["__current"] = propInput("current", "int", "2", "number");
    probe.run("collectContainerProp(__current)");
    let node = probe.run("findRef('q_steps').node") as { props?: Record<string, unknown> };
    expect(node.props).toEqual({ steps: 4, current: 2 });
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);

    // the REAL preset renders 4 dots with the 2nd active + a11y mirrors
    const rendered = renderComponent(node as unknown as LeadgenComponentNode, defaultFunnelDesign);
    expect(rendered).toContain('aria-valuemax="4"');
    expect(rendered).toContain('aria-valuenow="2"');
    expect((rendered.match(/class="lg-step"/g) ?? []).length).toBe(4);
    expect((rendered.match(/data-active="true"/g) ?? []).length).toBe(1);

    // current > steps clamps to steps (and reflects into the input)
    const over = propInput("current", "int", "9", "number");
    probe.sandbox["__over"] = over;
    probe.run("collectContainerProp(__over)");
    node = probe.run("findRef('q_steps').node") as { props?: Record<string, unknown> };
    expect(node.props?.["current"]).toBe(4);
    expect(over["value"]).toBe("4");

    // steps below 1 clamps to 1 and drags current down with it
    probe.sandbox["__zero"] = propInput("steps", "int", "0", "number");
    probe.run("collectContainerProp(__zero)");
    node = probe.run("findRef('q_steps').node") as { props?: Record<string, unknown> };
    expect(node.props).toEqual({ steps: 1, current: 1 });

    // clearing the input deletes the prop (back to the preset default)
    probe.sandbox["__empty"] = propInput("current", "int", "", "number");
    probe.run("collectContainerProp(__empty)");
    node = probe.run("findRef('q_steps').node") as { props?: Record<string, unknown> };
    expect(node.props).toEqual({ steps: 1 });
  });

  it("save seam: the probe-authored props PATCH through the real router and read back intact (edit → model → saved props)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const probe = studioProbe(html, P4_GAPS_CONTENT);

    probe.sandbox.selectedQuestionId = "q_trust";
    probe.sandbox["__items"] = propInput("items", "lines", "🔒|SSL secured", "textarea");
    probe.run("collectContainerProp(__items)");
    probe.sandbox["__layout"] = propInput("layout", "enum", "stacked", "select-one");
    probe.run("collectContainerProp(__layout)");
    probe.sandbox.selectedQuestionId = "q_logos";
    probe.sandbox["__logos"] = propInput("logos", "lines", "media_1|Acme", "textarea");
    probe.run("collectContainerProp(__logos)");
    probe.sandbox.selectedQuestionId = "q_steps";
    probe.sandbox["__steps"] = propInput("steps", "int", "4", "number");
    probe.run("collectContainerProp(__steps)");
    probe.sandbox["__current"] = propInput("current", "int", "2", "number");
    probe.run("collectContainerProp(__current)");

    // the island save path serializes state.content — PATCH it for real
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: JSON.stringify(probe.sandbox.state.content) }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as {
      content_json: { components: Array<Record<string, unknown>> };
    };
    const byId = new Map(saved.content_json.components.map((n) => [n["question_id"], n]));
    expect(byId.get("q_trust")!["props"]).toEqual({
      items: [{ icon: "🔒", text: "SSL secured" }],
      layout: "stacked",
    });
    expect(byId.get("q_logos")!["props"]).toEqual({ logos: [{ mediaId: "media_1", alt: "Acme" }] });
    expect(byId.get("q_steps")!["props"]).toEqual({ steps: 4, current: 2 });
  });
});

// ---------------------------------------------------------------------------
// v2.5 wave-1 — §5.1 Question strip + §5.2 canonical headline binding UX
// (contract-v2.5 05; the strip and the bound canvas nodes are ONE store)
// ---------------------------------------------------------------------------

// A tiny recording DOM-element stub for EXECUTED island legs that build DOM
// (the legacy bind banner, the §5.4 frame badge). Only the members the island
// touches exist; listeners are recorded and manually invokable.
interface StubEl {
  tag: string;
  className: string;
  hidden: boolean;
  disabled: boolean;
  title: string;
  type: string;
  value: string;
  textContent: string;
  attrs: Record<string, string>;
  children: StubEl[];
  listeners: Record<string, Array<() => void>>;
  readonly firstChild: StubEl | null;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  appendChild(c: StubEl): StubEl;
  removeChild(c: StubEl): StubEl;
  insertBefore(c: StubEl, ref: StubEl | null): StubEl;
  addEventListener(k: string, f: () => void): void;
  click(): void;
  allText(): string;
}

function stubEl(tag: string, text = ""): StubEl {
  const el: StubEl = {
    tag,
    className: "",
    hidden: false,
    disabled: false,
    title: "",
    type: "",
    value: "",
    textContent: text,
    attrs: {},
    children: [],
    listeners: {},
    get firstChild(): StubEl | null {
      return el.children[0] ?? null;
    },
    setAttribute(k: string, v: string): void {
      el.attrs[k] = String(v);
    },
    getAttribute(k: string): string | null {
      return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k]! : null;
    },
    removeAttribute(k: string): void {
      delete el.attrs[k];
    },
    appendChild(c: StubEl): StubEl {
      el.children.push(c);
      return c;
    },
    removeChild(c: StubEl): StubEl {
      const i = el.children.indexOf(c);
      if (i !== -1) el.children.splice(i, 1);
      return c;
    },
    insertBefore(c: StubEl, ref: StubEl | null): StubEl {
      const i = ref === null ? el.children.length : el.children.indexOf(ref);
      el.children.splice(i === -1 ? el.children.length : i, 0, c);
      return c;
    },
    addEventListener(k: string, f: () => void): void {
      (el.listeners[k] = el.listeners[k] ?? []).push(f);
    },
    click(): void {
      for (const f of el.listeners["click"] ?? []) f();
    },
    allText(): string {
      return el.textContent + el.children.map((c) => c.allText()).join("");
    },
  };
  return el;
}

const BOUND_SEED_CONTENT = {
  components: [
    { type: "QuestionHeadline", question_id: "q_bh", bind: "section_headline" },
    { type: "Subheadline", question_id: "q_bs", bind: "section_subheadline" },
    { type: "TwoButtonYesNo", question_id: "q1", internal_field: "currently_insured", answer_type: "boolean" },
  ],
};

describeDb("v3.1 §4.2 SSR — the Question strip", () => {
  it("canonical editors + 'On answer' segmented (replaces the old radio) + the EXACT frame note + hidden chips + legacy Maps row", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // canonical editors, §4.2 labels (same element ids — save path unchanged)
    expect(html).toContain(">Question headline *</label>");
    expect(html).toContain('id="lg-section-headline"');
    expect(html).toContain(">Subheadline <span");
    expect(html).toContain('id="lg-section-subheadline"');
    // §4.2 "On answer" segmented (golden :71-75) — the old native radio pair
    // is GONE; two clickable segments write continue_mode via the island.
    expect(html).toContain(">On answer<");
    expect(html).toContain('data-continue-mode="button"');
    expect(html).toContain('data-continue-mode="auto_advance"');
    expect(html).toContain(">Wait for Continue<");
    expect(html).toContain(">Go to next<");
    expect(html).not.toMatch(/<input[^>]*type="radio"[^>]*name="continue_mode"/);
    expect(html).not.toContain(">Continue behavior</legend>");
    // served bytes carry the typographic apostrophes as entities — the note
    // survives (visually-hidden + a title tooltip) even though the visible
    // fieldset legend it used to sit under is gone.
    expect(html).toContain(
      "The Continue button&#8217;s default style and position are set per funnel in the Quote Builder.",
    );
    // Appendix A: the strip's informational Maps status chip.
    expect(html).toMatch(/Google Maps: (connected|not connected)/);
    // §5.2 hidden-in-unit chips (SSR'd hidden; island toggles)
    expect(html).toMatch(/data-bound-chip="section_headline"[^>]*hidden/);
    expect(html).toMatch(/data-bound-chip="section_subheadline"[^>]*hidden/);
    expect(html).toContain("Hidden in this question unit");
    expect(html).toMatch(/data-bound-show="section_headline"[^>]*>Show</);
    // R5 D2 (register S4-A2): the legacy global Maps checkbox row is
    // REMOVED (safe post-R4b — §9's real per-field Maps tab is the current
    // mechanism; S3-8 proved per-field precedence in both readers).
    expect(html).not.toContain('id="lg-address-validation"');
    expect(html).not.toContain("data-maps-legacy-note");
    // the legacy-link banner slot ships hidden
    expect(html).toMatch(/data-bind-banner[^>]*hidden/);
  });

  it("/new seeds BOUND QuestionHeadline + Subheadline as nodes 1–2 in BOTH the blob and the SSR canvas; v3.1 §5.4 — neither is a palette tile (the strip's hidden-chip owns re-insertion instead)", async () => {
    const { env } = newHarness();
    const html = await getHtml(env, "/admin/leadgen/sections/new");
    const data = extractJsonBlob(html, "lg-section-data");
    const content = data["content"] as { components: Array<Record<string, unknown>> };
    expect(content.components).toHaveLength(2);
    expect(content.components[0]).toMatchObject({ type: "QuestionHeadline", bind: "section_headline" });
    expect(content.components[1]).toMatchObject({ type: "Subheadline", bind: "section_subheadline" });
    expect(content.components[0]!["props"]).toBeUndefined(); // bound = NO props.text
    // seeded content validates CLEAN against the REAL server validator
    expect(validateSectionContent(content).errors).toEqual([]);
    // the SSR canvas rendered the bound nodes (empty text until typed) —
    // DEV-66: the canvas document rides the frame srcdoc
    const region = canvasSrcdoc(html);
    expect(region).toContain('data-component-type="QuestionHeadline"');
    expect(region).toContain('data-component-type="Subheadline"');
    // v3.1 §5.4 (binding): Headline & Subheadline are NOT palette items at
    // all — no data-add-component tile for either type exists anywhere.
    expect(html).not.toContain('data-add-component="QuestionHeadline"');
    expect(html).not.toContain('data-add-component="Subheadline"');
    // the strip's "Show" chips stay HIDDEN while the bound nodes exist
    // (§5.2 mechanism, tested fully in the v3.1 §4.2 strip block — this is
    // just the cross-check that a freshly-seeded /new section is consistent).
    expect(html).toMatch(/data-bound-chip="section_headline"[^>]*hidden/);
    expect(html).toMatch(/data-bound-chip="section_subheadline"[^>]*hidden/);
  });

  it("a legacy Section (no bound nodes) still has NO palette tile for Headline/Subheadline; the SSR canvas resolves bound text when a bound node is present elsewhere", async () => {
    const { env } = newHarness();
    const section = await createSection(env); // YESNO content — no headline nodes
    const html = await studioPage(env, section.public_id);
    // v3.1 §5.4: retired from the palette regardless of bound-node presence.
    expect(html).not.toContain('data-add-component="QuestionHeadline"');
    expect(html).not.toContain('data-add-component="Subheadline"');

    // a section WITH a bound node SSRs the canonical column text into the
    // canvas (studioCanvasDocument threads sectionCtx)
    const bound = await createSection(env, {
      section_name: "Bound",
      headline_text: "Are you currently insured?",
      content_json: JSON.stringify(BOUND_SEED_CONTENT),
    });
    const boundHtml = await studioPage(env, bound.public_id);
    const region = canvasSrcdoc(boundHtml);
    expect(region).toContain('class="lg-headline"');
    expect(region).toContain("Are you currently insured?");
  });
});

describeDb("v2.5 §5.2 EXECUTED — binding model (vm-probe of the served code)", () => {
  async function boundProbe(content: unknown, docStub?: Record<string, unknown>): Promise<StudioProbe> {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    return studioProbe(html, content, docStub);
  }

  it("palette insert creates a BOUND node (no props.text); a second insert is REFUSED with the exact tooltip copy", async () => {
    const probe = await boundProbe({ components: [] });
    const head = probe.run(`addComponentAt('QuestionHeadline', null, null)`) as Record<string, unknown>;
    expect(head).toMatchObject({ type: "QuestionHeadline", bind: "section_headline" });
    expect(head["props"]).toBeUndefined();
    const sub = probe.run(`addComponentAt('Subheadline', null, null)`) as Record<string, unknown>;
    expect(sub).toMatchObject({ type: "Subheadline", bind: "section_subheadline" });
    // the pair validates CLEAN against the REAL validator (bound waives text)
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
    // §5.2: one bound node per bind value — the second insert refuses
    expect(probe.run(`addComponentAt('QuestionHeadline', null, null)`)).toBeNull();
    expect(probe.sandbox.refusals).toContain("This Section already shows its headline");
    expect(probe.run(`addComponentAt('Subheadline', null, null)`)).toBeNull();
    expect(probe.sandbox.refusals).toContain("This Section already shows its subheadline");
    expect((probe.sandbox.state.content.components as unknown[]).length).toBe(2);
  });

  it("delete bound node keeps the canonical store; [Show] re-inserts the bound node AT THE TOP (§5.2 chip semantics)", async () => {
    const probe = await boundProbe(BOUND_SEED_CONTENT);
    expect(probe.run(`findBoundNode('section_headline')`)).not.toBeNull();
    probe.run(`removeNode('q_bh')`);
    expect(probe.run(`findBoundNode('section_headline')`)).toBeNull();
    // the strip store is a Section COLUMN — deleting the node never touches it
    // (model-side: nothing in content carries the text at all)
    const reinserted = probe.run(`insertBoundNodeAtTop('section_headline')`) as Record<string, unknown>;
    expect(reinserted).toMatchObject({ type: "QuestionHeadline", bind: "section_headline" });
    const components = probe.sandbox.state.content.components as Array<Record<string, unknown>>;
    expect(components[0]!["question_id"]).toBe(reinserted["question_id"]); // AT THE TOP
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
    // idempotent: a second Show is a no-op while the bound node exists
    expect(probe.run(`insertBoundNodeAtTop('section_headline')`)).toBeNull();
  });

  it("duplicating the bound node directly is REFUSED; duplicating a container DETACHES the bound child into a text snapshot (no duplicate bind)", async () => {
    const strip = { value: "Are you insured?" };
    const docStub = {
      getElementById(id: string) {
        return id === "lg-section-headline" ? strip : null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    };
    const probe = await boundProbe(
      {
        components: [
          {
            type: "Stack",
            question_id: "s1",
            children: [{ type: "QuestionHeadline", question_id: "q_bh", bind: "section_headline" }],
          },
        ],
      },
      docStub,
    );
    // direct duplicate of the bound node → refusal
    expect(probe.run(`duplicateNode('q_bh')`)).toBeNull();
    expect(probe.sandbox.refusals.length).toBe(1);
    expect(String(probe.sandbox.refusals[0])).toContain("This Section already shows its headline");
    // container duplicate detaches the clone's bind into the CURRENT canonical text
    const clone = probe.run(`duplicateNode('s1')`) as { children: Array<Record<string, unknown>> };
    expect(clone).not.toBeNull();
    expect(clone.children[0]!["bind"]).toBeUndefined();
    expect((clone.children[0]!["props"] as Record<string, unknown>)["text"]).toBe("Are you insured?");
    // still exactly ONE bound node — the whole tree validates CLEAN
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
  });

  it("linkBoundNode: byte-equal one-click link sets bind + drops props.text; differing text lets the picked value WIN into the strip store", async () => {
    const strip = { value: "Are you insured?" };
    const docStub = {
      getElementById(id: string) {
        return id === "lg-section-headline" ? strip : null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    };
    const probe = await boundProbe(
      { components: [{ type: "QuestionHeadline", question_id: "q_h", props: { text: "Are you insured?" } }] },
      docStub,
    );
    // byte-equal case: winnerText null keeps the canonical value
    expect(probe.run(`unboundCandidate('section_headline')`)).not.toBeNull();
    expect(probe.run(`linkBoundNode('q_h', 'section_headline', null)`)).toBe(true);
    const linked = probe.run(`findRef('q_h').node`) as Record<string, unknown>;
    expect(linked["bind"]).toBe("section_headline");
    expect(linked["props"]).toBeUndefined(); // props.text dropped + cleaned up
    expect(strip.value).toBe("Are you insured?");
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);

    // differing case: the operator picked the COMPONENT's text — it wins into
    // the strip store before binding
    const strip2 = { value: "Old canonical" };
    const probe2 = await boundProbe(
      { components: [{ type: "QuestionHeadline", question_id: "q_h2", props: { text: "New from node" } }] },
      {
        getElementById(id: string) {
          return id === "lg-section-headline" ? strip2 : null;
        },
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
      },
    );
    expect(probe2.run(`linkBoundNode('q_h2', 'section_headline', 'New from node')`)).toBe(true);
    expect(strip2.value).toBe("New from node");
    const linked2 = probe2.run(`findRef('q_h2').node`) as Record<string, unknown>;
    expect(linked2["bind"]).toBe("section_headline");
    expect(linked2["props"]).toBeUndefined();
  });

  it("computeIssues waives the text requirement for BOUND nodes only (unbound headline still flagged, in operator words)", async () => {
    const probe = await boundProbe({
      components: [
        { type: "QuestionHeadline", question_id: "q_bound", bind: "section_headline" },
        { type: "QuestionHeadline", question_id: "q_free" }, // missing props.text
      ],
    });
    const issues = probe.run(`computeIssues()`) as Array<{ qid: string; message: string }>;
    expect(issues).toHaveLength(1);
    expect(issues[0]!.qid).toBe("q_free");
    expect(issues[0]!.message).toContain("Question headline"); // label, not type id
    expect(issues[0]!.message).not.toContain("QuestionHeadline");
  });

  // P5 S5c (ADJ-A5): "Studio 'No issues' chip vs server-only icon rule -> save
  // 400 the operator can't predict." req.choice_icon/choice_image
  // (studioTypeMeta's own `required` projection, content-schema.ts §14.4) was
  // computed server-side but never mirrored into computeIssues() — an
  // IconCardAnswerGrid/ImageCardAnswerGrid choice missing its icon/image
  // looked "clean" in the chip and only 400'd at save. FAIL-BEFORE/
  // PASS-AFTER: reverting the req.choice_icon/choice_image checks reproduces
  // the gap (computeIssues() returns [] for these exact nodes); cross-checked
  // against the REAL server validator so the mirror matches server truth.
  it("ADJ-A5: an IconCardAnswerGrid/ImageCardAnswerGrid choice missing its icon/image is a VISIBLE studio issue, matching the REAL server 400", async () => {
    const probe = await boundProbe({
      components: [
        {
          type: "IconCardAnswerGrid",
          question_id: "q_icon",
          internal_field: "icon_field",
          answer_type: "enum",
          choices: [{ label: "A", value: "a", analytics_id: "a" }], // no icon
        },
        {
          type: "ImageCardAnswerGrid",
          question_id: "q_image",
          internal_field: "image_field",
          answer_type: "enum",
          choices: [{ label: "B", value: "b", analytics_id: "b" }], // no imageMediaId
        },
      ],
    });
    const issues = probe.run(`computeIssues()`) as Array<{ qid: string; message: string }>;
    expect(issues.some((i) => i.qid === "q_icon" && /missing its icon/.test(i.message)), JSON.stringify(issues)).toBe(true);
    expect(issues.some((i) => i.qid === "q_image" && /missing its image/.test(i.message)), JSON.stringify(issues)).toBe(true);
    const serverErrors = validateSectionContent(probe.sandbox.state.content).errors;
    // Re-minted for M5: "requires a per-choice icon/imageMediaId" rewritten to
    // operator copy ("needs an icon"/"needs an image").
    expect(serverErrors.some((e) => e.code === "invalid_choice" && /needs an icon/.test(e.message))).toBe(true);
    expect(serverErrors.some((e) => e.code === "invalid_choice" && /needs an image/.test(e.message))).toBe(true);
  });

  it("the legacy link banner renders BOTH cases from the live model and its buttons run the real link handlers", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const banner = stubEl("div");
    banner.attrs["data-bind-banner"] = "";
    const strip = { value: "Are you insured?" };
    const docStub = {
      querySelector(sel: string) {
        return sel === "[data-bind-banner]" ? banner : null;
      },
      querySelectorAll() {
        return [];
      },
      getElementById(id: string) {
        return id === "lg-section-headline" ? strip : null;
      },
      createElement(tag: string) {
        return stubEl(tag);
      },
      createTextNode(text: string) {
        return stubEl("#text", text);
      },
    };
    // BYTE-EQUAL case → the one-click link button
    const probe = studioProbe(
      html,
      { components: [{ type: "QuestionHeadline", question_id: "q_h", props: { text: "Are you insured?" } }] },
      docStub,
    );
    probe.run(sliceIslandFunction(island, "clearChildren"));
    probe.run(sliceIslandFunction(island, "bindBannerButton"));
    probe.run(sliceIslandFunction(island, "bindBannerLinkHandler"));
    probe.run(sliceIslandFunction(island, "renderBindBanner"));
    probe.run("renderBindBanner()");
    expect(banner.hidden).toBe(false);
    expect(banner.children).toHaveLength(1);
    const row = banner.children[0]!;
    expect(row.getAttribute("data-bind-banner-case")).toBe("equal");
    const linkBtn = row.children.find((c) => c.tag === "button")!;
    expect(linkBtn.textContent).toBe("Link headline to the Section’s canonical headline");
    linkBtn.click(); // the real handler → linkBoundNode
    const node = probe.run("findRef('q_h').node") as Record<string, unknown>;
    expect(node["bind"]).toBe("section_headline");
    expect(node["props"]).toBeUndefined();
    // linked → the banner re-render empties + hides itself
    probe.run("renderBindBanner()");
    expect(banner.hidden).toBe(true);
    expect(banner.children).toHaveLength(0);

    // DIFFERING case → both values shown; picking the component's text wins
    const banner2 = stubEl("div");
    const strip2 = { value: "Old canonical" };
    const probe2 = studioProbe(
      html,
      { components: [{ type: "QuestionHeadline", question_id: "q_h2", props: { text: "New from node" } }] },
      {
        querySelector(sel: string) {
          return sel === "[data-bind-banner]" ? banner2 : null;
        },
        querySelectorAll() {
          return [];
        },
        getElementById(id: string) {
          return id === "lg-section-headline" ? strip2 : null;
        },
        createElement(tag: string) {
          return stubEl(tag);
        },
        createTextNode(text: string) {
          return stubEl("#text", text);
        },
      },
    );
    probe2.run(sliceIslandFunction(island, "clearChildren"));
    probe2.run(sliceIslandFunction(island, "bindBannerButton"));
    probe2.run(sliceIslandFunction(island, "bindBannerLinkHandler"));
    probe2.run(sliceIslandFunction(island, "renderBindBanner"));
    probe2.run("renderBindBanner()");
    const row2 = banner2.children[0]!;
    expect(row2.getAttribute("data-bind-banner-case")).toBe("differs");
    // BOTH values are shown
    expect(row2.allText()).toContain("“Old canonical”");
    expect(row2.allText()).toContain("“New from node”");
    const buttons = row2.children.filter((c) => c.tag === "button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Keep the Section headline",
      "Use this component’s text",
    ]);
    buttons[1]!.click();
    expect(strip2.value).toBe("New from node");
    expect((probe2.run("findRef('q_h2').node") as Record<string, unknown>)["bind"]).toBe("section_headline");
  });

  it("SAVE seam: bound content PATCHes through the REAL router and reads back with the bind markers intact", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const probeContent = JSON.parse(JSON.stringify(BOUND_SEED_CONTENT)) as Record<string, unknown>;
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: JSON.stringify(probeContent), headline_text: "Are you currently insured?" }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as {
      content_json: { components: Array<Record<string, unknown>> };
    };
    expect(saved.content_json.components[0]).toMatchObject({ type: "QuestionHeadline", bind: "section_headline" });
    expect(saved.content_json.components[1]).toMatchObject({ type: "Subheadline", bind: "section_subheadline" });
  });
});

describeDb("v2.5 §5.2 EXECUTED — strip⇄canvas ONE store (live server seam)", () => {
  it("renderCanvasNow sends the LIVE strip values (headline/subheadline) and the server resolves them into the bound nodes' markup", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // DEV-66: the frame-doc stub — the strip inputs stay PARENT-document.
    const region = { innerHTML: "" };
    const frame = {
      contentDocument: {
        getElementById(id: string) {
          return id === "lg-studio-canvas-render" ? region : null;
        },
      },
    };
    let captured: { url: string; init: RequestInit } | null = null;
    const sandbox = {
      state: { content: JSON.parse(JSON.stringify(BOUND_SEED_CONTENT)) as unknown },
      canvasViewport: "desktop", // wave-2 §6.1.4 island state the fn reads
      document: {
        getElementById(id: string) {
          if (id === "lg-studio-canvas-frame") return frame;
          if (id === "lg-section-headline") return { value: "Live typed headline" };
          if (id === "lg-section-subheadline") return { value: "Live sub copy" };
          return null;
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
      "function scheduleCanvasRender() {}",
      sliceIslandFunction(island, "canvasFrameEl"),
      sliceIslandFunction(island, "canvasFrameDoc"),
      sliceIslandFunction(island, "canvasRegion"),
      sliceIslandFunction(island, "renderCanvasNow"),
      "renderCanvasNow();",
    ].join("\n");
    runInNewContext(source, sandbox);
    for (let i = 0; i < 200 && region.innerHTML === ""; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(captured, "canvas fetch executed").not.toBeNull();
    const body = JSON.parse(String(captured!.init.body)) as Record<string, unknown>;
    // §5.2: the strip store rides the render request…
    expect(body["headline"]).toBe("Live typed headline");
    expect(body["subheadline"]).toBe("Live sub copy");
    // …and the REAL preview handler resolved it into the BOUND nodes' markup
    expect(region.innerHTML).toContain("Live typed headline");
    expect(region.innerHTML).toContain("Live sub copy");
    expect(region.innerHTML).toContain('data-component-type="QuestionHeadline"');
  });

  it("the island wires the one-store views: strip inputs re-render the canvas; the inspector shared field writes the strip (handler source)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // strip → canvas: both canonical inputs schedule the (bound-resolving) re-render
    expect(island).toContain("stripHeadline.addEventListener('input', onStripInput)");
    expect(island).toContain("stripSubheadline.addEventListener('input', onStripInput)");
    expect(sliceIslandFunction(island, "onStripInput")).toContain("scheduleCanvasRender()");
    // inspector shared fields → strip store (ONE store, never a THIRD field).
    // v3.1 §8.4: the Content tab shows BOTH Headline and Subheadline inputs
    // together — collectBoundShared now takes the bind value explicitly (a
    // single generic selector can only ever reach the FIRST of two same-
    // attribute elements) and BOTH get their own wireBoundSharedInput call.
    const collect = sliceIslandFunction(island, "collectBoundShared");
    expect(collect).toContain("strip.value = inputEl.value");
    expect(collect).toContain("scheduleCanvasRender()");
    expect(island).toContain("wireBoundSharedInput('section_headline')");
    expect(island).toContain("wireBoundSharedInput('section_subheadline')");
    // the §8.4 Content tab: both Headline and Subheadline inputs, SSR once
    expect(html).toContain('data-bound-shared-input="section_headline"');
    expect(html).toContain('data-bound-shared-input="section_subheadline"');
    // selecting a bound node hides the generic props.text control (no second
    // text field anywhere)
    expect(island).toContain("!(isBound && k === 'text')");
    // the chip [Show] wiring re-inserts at the top and selects it
    expect(island).toContain("insertBoundNodeAtTop(this.getAttribute('data-bound-show'))");
  });
});

// ---------------------------------------------------------------------------
// v2.5 wave-1 — §5.4 canvas scope: Frame hint + the amber page-frame badge
// ---------------------------------------------------------------------------

describeDb("v3.1 §6.1/§6.3 — unit-only canvas scope", () => {
  it("SSR: the Frame hint toggle (default ON per contract §6.1/golden state.frameHint=true) + the dimmed non-interactive skeleton (presentation-only) ship VISIBLE in the canvas region", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // v3.1 fix: the pre-v3.1 code defaulted Frame hint OFF — contract §6.1
    // table ("toggle (default ON)") and the golden's own state (frameHint:
    // true) both require default ON; ships pressed + the skeletons VISIBLE.
    expect(html).toMatch(/data-studio-frame-hint[^>]*aria-pressed="true"/);
    expect(html).toContain(">Show funnel layout</button>"); // U15 erratum (golden "Frame hint")
    expect(html).toContain("Funnel layout"); // U15 erratum for golden :301 "Funnel frame" (Appendix A)
    expect(html).toContain("Advertising disclosure"); // golden footer copy (Appendix A)
    // the two skeleton edges ship VISIBLE (no bare `hidden` attribute — note
    // the \s boundary so this does NOT false-match inside "aria-hidden"),
    // and dimmed at the golden's exact opacity .5 (§6.3) via their own inline style
    expect(html).not.toMatch(/data-studio-frame-skeleton="top"[^>]*\shidden(?=[\s>])/);
    expect(html).not.toMatch(/data-studio-frame-skeleton="bottom"[^>]*\shidden(?=[\s>])/);
    expect(html).toMatch(/data-studio-frame-skeleton="top"[^>]*aria-hidden="true"/);
    expect(html).toMatch(/opacity:\.5;pointer-events:none/);
    // the island toggle flips aria-pressed + (un)hides both skeletons
    const island = studioIsland(html);
    expect(island).toContain("data-studio-frame-hint");
    expect(island).toContain("skels[i].hidden = !on");
  });

  it("the meta blob carries §8.2 scope for every type; buildFrameBadge emits the amber badge with a LIVE Move affordance + Keep + the C2 consequence", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // scope rides the served meta blob (the island's badge decision input)
    const meta = extractJsonBlob(html, "lg-studio-meta")["types"] as Record<string, Record<string, unknown>>;
    expect(meta["HeaderBar"]!["scope"]).toBe("frame");
    expect(meta["ProgressBar"]!["scope"]).toBe("frame");
    expect(meta["BackgroundPanel"]!["scope"]).toBe("frame");
    expect(meta["TrustBar"]!["scope"]).toBe("both");
    expect(meta["TwoButtonYesNo"]!["scope"]).toBe("unit");

    // EXECUTED: the badge builder from the SERVED island
    const island = studioIsland(html);
    const probe = studioProbe(html, YESNO_CONTENT, {
      createElement(tag: string) {
        return stubEl(tag);
      },
      createTextNode(text: string) {
        return stubEl("#text", text);
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      getElementById() {
        return null;
      },
    });
    probe.run(sliceIslandFunction(island, "buildFrameBadge"));
    const badge = probe.run("buildFrameBadge('q_hb', 'HeaderBar')") as unknown as StubEl;
    expect(badge.className).toBe("studio-frame-badge");
    expect(badge.getAttribute("data-frame-badge")).toBe("q_hb");
    // U15 fix-round (2026-07-15): "Page-frame element — belongs to the Quote
    // frame ·" -> "Part of the funnel layout — shared across this funnel ·".
    expect(badge.allText()).toContain("Part of the funnel layout — shared across this funnel ·");
    const move = badge.children.find((c) => c.getAttribute("data-frame-move") !== null)!;
    expect(move.allText()).toBe("Move to funnel layout"); // U15: "Move to Quote frame" renamed
    // wave 2: the Move ACTION is LIVE — no disabled attribute anymore
    expect(move.disabled, "the §5.4 Move action shipped — the button is enabled").not.toBe(true);
    expect(move.title).toContain("funnel layout");
    const keep = badge.children.find((c) => c.getAttribute("data-frame-keep") !== null)!;
    // R5 jargon purge: "Keep (legacy)" -> "Keep as-is" (the word "legacy"
    // never renders).
    expect(keep.allText()).toBe("Keep as-is");
    // C2 (§5.4): the badge NAMES the activation consequence
    expect(badge.allText()).toContain(
      "While a funnel using this Section has a configured funnel layout, activation blocks on this element unless that funnel’s Advanced override allows it.",
    );
    // the decoration pass gates on scope === 'frame' + the session Keep store,
    // and the canvas click handler consumes [data-frame-keep] with NO model change
    expect(island).toContain("typeMeta(nodeType).scope === 'frame' && keptLegacyFrameNodes[qid] !== true");
    expect(island).toContain("keptLegacyFrameNodes[keepBtn.getAttribute('data-frame-keep')] = true");
  });
});

// ---------------------------------------------------------------------------
// v2.5 wave-1 — §7.1/§7.2/§7.3 scope-aware inspector
// ---------------------------------------------------------------------------

describeDb("v2.5 §7 — scope header, pills, dynamic tabs", () => {
  it("§7.1 SSR: the scope header is the inspector's FIRST element — Editing line, four pills (frame disabled here), Affects line, aria-live", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const inspectorStart = html.indexOf("data-studio-inspector");
    const headerAt = html.indexOf("data-studio-scope-header", inspectorStart);
    const tabsAt = html.indexOf('role="tablist"', inspectorStart);
    expect(headerAt).toBeGreaterThan(-1);
    expect(headerAt, "scope header precedes the tab strip").toBeLessThan(tabsAt);
    expect(html).toMatch(/data-studio-scope-header[^>]*aria-live="polite"/);
    expect(html).toContain('data-scope-editing-name>This Section (question unit)<');
    for (const pill of ["frame", "section", "component", "choice"]) {
      expect(html, `pill ${pill}`).toContain(`data-scope-pill="${pill}"`);
    }
    // §7.2: the frame is Quote-Builder-owned — its pill is inert here
    expect(html).toMatch(/data-scope-pill="frame"[^>]*disabled[^>]*title="The funnel layout \(shared header, progress &amp; Continue\) is edited in the Quote Builder"/);
    expect(html).toMatch(/data-scope-pill="section"[^>]*aria-pressed="true"/);
    expect(html).toContain("data-scope-affects");
    // the old id/type head is GONE (§7.4: no ids on a normal surface)
    expect(html).not.toContain('id="lg-inspector-target"');
    // the Section-scope helper note points at the strip
    expect(html).toContain("data-studio-section-scope-note");
    // the retarget is announced/animated + the §7.5 Advanced-open event exists
    const island = studioIsland(html);
    expect(island).toContain("studio-scope-flash");
    expect(island).toContain("window.console.info('section_advanced_opened'");
    // choice-row focus retargets the scope header (§7.5 — synchronous handler)
    expect(island).toContain("choicesPanelWrap.addEventListener('focusin'");
    expect(island).toContain("setScope('choice')");
  });

  it("§7.1 EXECUTED: the header copy patterns per scope (operator words; Section cites the usage count; choice = 'this card only')", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, YESNO_CONTENT);
    // scopeEditingName's v3.1 §5.6 "Short text field" special-case calls
    // acceptFormatOfNode, which reads the module-level ACCEPT_TYPE_FORMAT var.
    probe.run(sliceIslandVar(island, "ACCEPT_TYPE_FORMAT"));
    probe.run(sliceIslandFunction(island, "acceptFormatOfNode"));
    probe.run(sliceIslandFunction(island, "scopeEditingName"));
    probe.run(sliceIslandFunction(island, "scopeAffectsText"));
    probe.run("var scopeState = 'section'; var choiceScopeLabel = ''; var usageQuoteCount = null;");

    // Section scope + live usage counts
    expect(probe.run("scopeEditingName(null)")).toBe("This Section (question unit)");
    expect(probe.run("scopeAffectsText(null)")).toBe("Affects: changes apply everywhere this Section is used.");
    probe.run("usageQuoteCount = 0");
    expect(probe.run("scopeAffectsText(null)")).toBe("Affects: not used in any quote yet.");
    probe.run("usageQuoteCount = 2");
    expect(probe.run("scopeAffectsText(null)")).toBe(
      "Affects: used in 2 quotes; changes apply everywhere it’s used.",
    );

    // Component scope: the LABEL, never the type id (§7.4)
    probe.run("scopeState = 'component'");
    expect(probe.run("scopeEditingName({ type: 'ImageCardAnswerGrid' })")).toBe("Image answer cards");
    expect(probe.run("scopeAffectsText({ type: 'ImageCardAnswerGrid' })")).toBe(
      "Affects: this question unit — in every quote that uses this Section.",
    );
    // a legacy frame node names its real owner
    expect(probe.run("scopeAffectsText({ type: 'HeaderBar' })")).toContain("edited in the Quote Builder");
    // v3.1 §5.6/§8.1: the whole 8-value Accept-swap family reads "Short text
    // field" — never its OWN concrete-type catalog label (e.g. "ZIP"/"Text")
    expect(probe.run("scopeEditingName({ type: 'ZIPInputQuestion' })")).toBe("Short text field");
    expect(probe.run("scopeEditingName({ type: 'FreeTextQuestion' })")).toBe("Short text field");
    // a non-Accept-swap field keeps its own catalog label
    expect(probe.run("scopeEditingName({ type: 'TwoButtonYesNo' })")).toBe("Yes / No");

    // Choice scope: the §7.1 binding pattern
    probe.run("scopeState = 'choice'; choiceScopeLabel = 'Sole Proprietor';");
    expect(probe.run("scopeEditingName({ type: 'IconCardAnswerGrid' })")).toBe("Answer choice “Sole Proprietor”");
    expect(probe.run("scopeAffectsText({ type: 'IconCardAnswerGrid' })")).toBe("Affects: this card only.");
  });

  it("§7.3 EXECUTED: tabs are DYNAMIC per selection — copy-bearing Content, frame nodes lose unit tabs, containers gain Design, no inapplicable tab", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, YESNO_CONTENT);
    // R3b: availableTabsFor now also reads these two top-level island vars
    // (frame-scope Content honesty + the text-family Rules exclusion) —
    // inject them alongside the sliced function, mirroring how this sandbox
    // already injects every other sibling dependency.
    probe.run(sliceIslandVar(island, "FRAME_SCOPE_STUDIO_TYPES"));
    probe.run(sliceIslandVar(island, "RULES_EXCLUDED_TEXT_TYPES"));
    probe.run(sliceIslandFunction(island, "availableTabsFor"));
    const tabsOf = (expr: string): string[] => probe.run(`availableTabsFor(${expr})`) as string[];

    // v3.1 §8.2: the golden's 5 dynamic tabs (content/style/rules/maps/
    // offers) replace the pre-v3.1 9-tab set (choices/layout/design fold
    // into style; validation folds into content; dependencies -> rules;
    // mapping -> offers). Advanced is no longer in this array at all (a
    // persistent disclosure now, setAdvancedOpen — see populateInspector).
    //
    // nothing selected → NO tabs (Section scope edits live in the strip)
    expect(tabsOf("null")).toEqual([]);
    // §8.2's table EXPLICITLY restricts the bound headline/subheadline row
    // to Content·Style ONLY — no Rules (the dependency evaluator doesn't
    // apply to the shared strip-store field).
    expect(tabsOf("{ type: 'QuestionHeadline', bind: 'section_headline' }")).toEqual(["content", "style"]);
    // §8.2's table EXPLICITLY restricts Continue to Content·Style ONLY too.
    expect(tabsOf("{ type: 'ContinueButton' }")).toEqual(["content", "style"]);
    // answer-producing choice grid: the full §8.2 row (Content·Style·Rules·Offers)
    expect(tabsOf("{ type: 'ImageCardAnswerGrid' }")).toEqual(["content", "style", "rules", "offers"]);
    // ZIP input adds Maps (§8.2 "*Maps only for ZIP/Address types")
    expect(tabsOf("{ type: 'ZIPInputQuestion' }")).toEqual(["content", "style", "rules", "maps", "offers"]);
    // containers are ANY visual selection (§8.5) → Style unconditionally,
    // but no Content (no content_props, not choice-bearing)
    expect(tabsOf("{ type: 'Stack' }")).toEqual(["style", "rules"]);
    expect(tabsOf("{ type: 'Spacer' }")).toEqual(["style", "rules"]);
    // a legacy PAGE-FRAME element: the pre-v3.1 special-case (no design/
    // dependencies at all) is FOLDED into the general rule now — §8.5's
    // "any visual selection" is unconditional, so HeaderBar (no
    // content_props) ALSO gets Style+Rules where before it got neither
    // (a capability EXPANSION, never a regression). It still never gets
    // Maps/Offers (meta.maps/produces are false for it). R3b deliverable 8
    // (E2-NEW-3/E2-NEW-8/E2-C4): HeaderBar is now ALSO one of the 10
    // FRAME_SCOPE_STUDIO_TYPES — hasContent is true for it via that set even
    // though content_props is empty, so it gains 'content' too (the Content
    // tab shows the read-only "edited in the Quote Builder" notice there,
    // never dead editing controls).
    expect(tabsOf("{ type: 'HeaderBar' }")).toEqual(["content", "style", "rules"]);
    expect(tabsOf("{ type: 'ProgressBar' }")).toEqual(["content", "style", "rules"]);
    // affordances with copy stay lean
    expect(tabsOf("{ type: 'ReassuranceBadge' }")).toEqual(["content", "style", "rules"]);
  });

  it("§7.4: the rename consequence is inline and counted against the LIVE mapping model; Advanced owns the bind marker", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // consequence copy pattern ("will unlink N Offer mappings — they'll need
    // remapping") counted from state.answer_maps
    const warn = sliceIslandFunction(island, "showRenameWarning");
    expect(warn).toContain("state.answer_maps[mi].internal_field === oldField");
    expect(warn).toContain("will unlink ' + mapCount + ' Offer mapping");
    expect(warn).toContain("need remapping");
    // the Advanced tab carries the read-only bind marker slot
    expect(html).toContain("data-studio-bind-marker");
    expect(island).toContain("node.bind !== undefined ? node.bind : '\\u2014'");
  });
});

// ---------------------------------------------------------------------------
// v2.5 wave-1 C6 "slide" page lint — SUPERSEDED (slice C-verify): the lint
// moved to the dedicated 15 §15.2 suite, test/leadgen-glossary-lint.test.ts,
// EXTENDED without weakening — same full-page regex over edit + new + the
// sections LIST page, plus the quote-side "Slide stays allowed" calibration
// and the full §12.4/§7.4 forbidden-term matrix.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// v2.5 wave-1 — A5 image_alt samples + A6 image_fit component prop
// ---------------------------------------------------------------------------

describeDb("v2.5 A5 — image-grid samples always carry image_alt", () => {
  it("palette insert of ImageCardAnswerGrid is validator-CLEAN and SAVES through the real router (pre-fix: alt-less samples 400'd)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const probe = studioProbe(html, { components: [] });
    const node = probe.run(`addComponentAt('ImageCardAnswerGrid', null, null)`) as {
      choices: Array<Record<string, unknown>>;
    };
    expect(node).not.toBeNull();
    for (const choice of node.choices) {
      expect(typeof choice["imageMediaId"]).toBe("string");
      expect(typeof choice["image_alt"], "image_alt rides every sampled image choice").toBe("string");
      expect(choice["image_alt"]).toBe(choice["label"]);
    }
    // the REAL validator accepts the palette-authored grid…
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
    // ADDED 2026-08-10 while fixing the owner's card-image defect: A5's rule is
    // BIDIRECTIONAL and only half of it was pinned. An image without an alt is
    // refused (below), AND a choice with no image at all is refused too ("Every
    // answer on the Image answer cards needs an image") — which is exactly why
    // the scaffold above must seed a key, and why making that seed honest is an
    // authoring-contract change rather than a bug fix.
    const imageNoAlt = validateSectionContent({
      components: [
        {
          type: "ImageCardAnswerGrid",
          question_id: "g_alt",
          internal_field: "make",
          choices: [{ label: "Cadillac", value: "c", analytics_id: "c", imageMediaId: "2026/08/10/k.png" }],
        },
      ],
    });
    expect(imageNoAlt.errors.map((e) => e.path)).toEqual(["components[0].choices[0].image_alt"]);
    const noImageAtAll = validateSectionContent({
      components: [
        {
          type: "ImageCardAnswerGrid",
          question_id: "g_noimg",
          internal_field: "make",
          choices: [{ label: "Cadillac", value: "c", analytics_id: "c" }],
        },
      ],
    });
    expect(noImageAtAll.errors.map((e) => e.path)).toEqual(["components[0].choices[0].imageMediaId"]);
    // the picker is what turns a chosen key into a save-legal pair
    expect(studioIsland(html)).toContain("c.image_alt = c.label || storageKey");
    // …and the REAL save path persists it (the A5 repro: this PATCH failed
    // save validation while the samples lacked image_alt)
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: JSON.stringify(probe.sandbox.state.content) }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
  });

  it("bulk paste for an image grid carries image_alt per pasted choice; the choice-row editor PRESERVES image_alt through an edit", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const probe = studioProbe(html, { components: [] });
    const parsed = probe.run(`parseBulkChoices('Toyota|toyota\\nHonda', { choice_image: true })`) as Array<
      Record<string, unknown>
    >;
    // UPDATED 2026-08-11 (owner approved): a pasted image-card choice is seeded
    // with the recognisable not-picked-yet ref instead of a fake key like
    // "media_toyota". It is still a save-legal image+alt pair (the tree below is
    // asserted validator-clean); the difference is that presets.ts renders it as a
    // labelled "Image" slot rather than 20 broken images the operator never authored.
    expect(parsed).toEqual([
      { label: "Toyota", value: "toyota", analytics_id: "toyota", imageMediaId: MEDIA_PENDING_REF, image_alt: "Toyota" },
      { label: "Honda", value: "honda", analytics_id: "honda", imageMediaId: MEDIA_PENDING_REF, image_alt: "Honda" },
    ]);
    const content = {
      components: [{ type: "ImageCardAnswerGrid", question_id: "g1", internal_field: "make", choices: parsed }],
    };
    expect(validateSectionContent(content).errors).toEqual([]);
    // the row editor lists image_alt so collectChoices (which rebuilds each
    // choice from the row inputs) can never silently drop it
    const island = studioIsland(html);
    expect(island).toContain(
      "var CHOICE_FIELDS = ['label', 'value', 'analytics_id', 'title', 'subtitle', 'badge', 'icon', 'emoji', 'imageMediaId', 'image_alt', 'aria_label', 'description']",
    );
    // v3.1 §5.1 retires the palette's live-preset thumbnails (bespoke SVGs
    // replace them — no component render, so no sample image_alt rides the
    // served page from the palette anymore); the CHOICE_FIELDS assertion
    // above is this test's real proof.
  });
});

describeDb("v2.5 A6 — image_fit is a COMPONENT prop on ImageCardAnswerGrid", () => {
  const gridWith = (props: Record<string, unknown> | undefined, choices?: Array<Record<string, unknown>>): Record<string, unknown> => ({
    type: "ImageCardAnswerGrid",
    question_id: "g1",
    internal_field: "make",
    choices: choices ?? [
      { label: "Toyota", value: "toyota", analytics_id: "toyota", imageMediaId: "media_t", image_alt: "Toyota" },
    ],
    ...(props === undefined ? {} : { props }),
  });

  it("schema: cover/contain validate; any other value is a typed enum violation at the precise path", () => {
    expect(validateSectionContent({ components: [gridWith({ image_fit: "cover" })] }).errors).toEqual([]);
    expect(validateSectionContent({ components: [gridWith({ image_fit: "contain" })] }).errors).toEqual([]);
    expect(validateSectionContent({ components: [gridWith(undefined)] }).errors).toEqual([]);
    const bad = validateSectionContent({ components: [gridWith({ image_fit: "stretch" })] });
    expect(bad.errors).toHaveLength(1);
    expect(bad.errors[0]).toMatchObject({
      code: "container_prop_invalid",
      path: "components[0].props.image_fit",
    });
    // Re-minted for M5: "cover|contain" rewritten to "cover or contain" operator copy.
    expect(bad.errors[0]!.message).toContain("must be one of: cover or contain");
  });

  it("preset: the component prop drives object-fit for EVERY card; a legacy per-choice value stays the fallback; the component prop WINS", () => {
    const choices = [
      { label: "Toyota", value: "toyota", analytics_id: "toyota", imageMediaId: "media_t", image_alt: "Toyota" },
      { label: "Honda", value: "honda", analytics_id: "honda", imageMediaId: "media_h", image_alt: "Honda", image_fit: "contain" },
    ];
    // component prop → both cards carry it (per-choice legacy is overridden)
    const withProp = renderComponent(
      gridWith({ image_fit: "cover" }, choices) as unknown as LeadgenComponentNode,
      defaultFunnelDesign,
    );
    expect((withProp.match(/object-fit:cover/g) ?? []).length).toBe(2);
    expect(withProp).not.toContain("object-fit:contain");
    // no component prop → the per-choice defensive read still applies
    const legacyOnly = renderComponent(gridWith(undefined, choices) as unknown as LeadgenComponentNode, defaultFunnelDesign);
    expect((legacyOnly.match(/object-fit:contain/g) ?? []).length).toBe(1);
    expect(legacyOnly).not.toContain("object-fit:cover");
    // neither → today's attribute-free <img> (byte-compat pin lives in
    // leadgen-image-card-choice.test.ts)
    const bare = renderComponent(
      gridWith(undefined, [choices[0]!]) as unknown as LeadgenComponentNode,
      defaultFunnelDesign,
    );
    expect(bare).not.toContain("object-fit");
  });

  it("studio: the Content-tab control writes props.image_fit through the standard collect path, gated to the image grid, and PATCHes for real", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // R3b deliverable 2 (rail removal) relocated this control from the OLD
    // Design-tab rail to the Content tab, next to the choices editor
    // (renderImageFitControl, deliverable 4's image-controls neighborhood) —
    // hidden until an image grid is selected. Conductor correction: the
    // control is ImageCardAnswerGrid's per-grid image_fit prop, NOT the
    // ImageBlock primitive (dispatch phrasing error, now recorded).
    const contentPanel = html.slice(
      html.indexOf('data-studio-panel="content"'),
      html.indexOf('data-studio-panel="style"'),
    );
    expect(contentPanel).toMatch(/data-image-fit-wrap[^>]*hidden/);
    const fitSelect = selectBlock(html, "lg-inspector-image-fit");
    expect(fitSelect).toContain('data-inspector-field="image_fit"');
    expect(fitSelect).toContain('<option value="cover">');
    expect(fitSelect).toContain('<option value="contain">');
    const island = studioIsland(html);
    expect(island).toContain("node.type !== 'ImageCardAnswerGrid'");

    // EXECUTED: the sliced generic field collector stores/clears the prop
    const probe = studioProbe(html, {
      components: [gridWith(undefined)],
    });
    probe.run(sliceIslandFunction(island, "collectInspectorField"));
    probe.sandbox.selectedQuestionId = "g1";
    const fitInput = (value: string): Record<string, unknown> => ({
      type: "select-one",
      value,
      getAttribute(k: string): string | null {
        return k === "data-inspector-field" ? "image_fit" : null;
      },
    });
    probe.sandbox["__fit"] = fitInput("cover");
    probe.run("collectInspectorField(__fit)");
    let node = probe.run("findRef('g1').node") as { props?: Record<string, unknown> };
    expect(node.props?.["image_fit"]).toBe("cover");
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);

    // …and the REAL router round-trips it
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: JSON.stringify(probe.sandbox.state.content) }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as {
      content_json: { components: Array<Record<string, unknown>> };
    };
    expect((saved.content_json.components[0]!["props"] as Record<string, unknown>)["image_fit"]).toBe("cover");

    // clearing the select deletes the prop (back to the default fit)
    probe.sandbox["__clear"] = fitInput("");
    probe.run("collectInspectorField(__clear)");
    node = probe.run("findRef('g1').node") as { props?: Record<string, unknown> };
    expect(node.props?.["image_fit"]).toBeUndefined();
  });
});

describeDb("v2.5 §2.4 — 'Used in N quotes' from the REAL usage endpoint", () => {
  it("loadUsage counts DISTINCT quotes (3 variant usages across 2 quotes → 2) through GET /sections/:id/usage", async () => {
    const { sdb, env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // REAL P7 rows: two quotes; quote 1 has two variants using the Section
    sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, ?, ?, ?)").run("lgq_aaaaaaaaaaaa", "Quote A", "quote_funnel", '["life"]');
    sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, ?, ?, ?)").run("lgq_bbbbbbbbbbbb", "Quote B", "quote_funnel", '["life"]');
    sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES (?, 1, ?)").run("lgf_aaaaaaaaaaaa", "Funnel A");
    sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES (?, 2, ?)").run("lgf_bbbbbbbbbbbb", "Funnel B");
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label) VALUES (?, 1, 'A')").run("lgn_aaaaaaaaaaaa");
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label) VALUES (?, 1, 'B')").run("lgn_cccccccccccc");
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label) VALUES (?, 2, 'A')").run("lgn_bbbbbbbbbbbb");
    for (const variantId of [1, 2, 3]) {
      sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, ?, 1)").run(variantId, section.id);
    }
    // EXECUTED: the island's loadUsage against the live router
    const sandbox: Record<string, unknown> = {
      state: { public_id: section.public_id },
      usageQuoteCount: null,
      encodeURIComponent,
      fetch(url: string, init: RequestInit): Promise<Response> {
        return Promise.resolve(admin.request(url, init, env));
      },
    };
    const source = [
      "function renderScopeHeader() {}",
      sliceIslandFunction(island, "loadUsage"),
      "loadUsage();",
    ].join("\n");
    runInNewContext(source, sandbox);
    for (let i = 0; i < 200 && sandbox["usageQuoteCount"] === null; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(sandbox["usageQuoteCount"], "3 variant rows dedupe to 2 quotes").toBe(2);
  });
});

// ===========================================================================
// v2.5 WAVE 2 — §6 canvas toolbar (anatomy + matrix + undo/redo + viewport) ·
// §6.6 named presets · §7.3 C1 provider chip (DEV-55) · §9.4/§9.5 ·
// §5.3 mode 5 · §5.4 move-to-frame · §5.5 depth · §6.2 inline editing
// ===========================================================================

// In-memory KVNamespace stub — the presets endpoints ride the CACHE binding.
function kvStub(): KVNamespace {
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
  } as unknown as KVNamespace;
}

// Slice a `var NAME = [...];` array-literal statement from the island (the
// sliceIslandVar sibling for arrays — TEXT_ROLE_TYPES etc.).
function sliceIslandArray(script: string, name: string): string {
  const marker = `var ${name} = [`;
  const start = script.indexOf(marker);
  expect(start, `island array ${name} present`).toBeGreaterThan(-1);
  const end = script.indexOf("];", start);
  expect(end, `island array ${name} closes`).toBeGreaterThan(start);
  return script.slice(start, end + 2);
}

describeDb("wave 2 — §6.1 toolbar SSR anatomy (1–9)", () => {
  // R5 D3 (register S4-A3, golden single-row toolbar): REWRITTEN for the new
  // toolbar model — the golden's own ONE-ROW chrome (breadcrumb/pills · undo/
  // redo · viewport · frame hint · offer-mapping toggle) plus ONE compact
  // "More actions" popover (structure + choice-item quick actions — the two
  // concerns with no inspector-tab home). Every OTHER control that used to
  // balloon this row was either an exact duplicate of an existing Content/
  // Style-tab control (REMOVED, not migrated) or a genuine type-swap/style
  // control MIGRATED to Content ("Answer format": searchable/card-style/
  // slider-format/type-swap) or Style (selected-role/preset apply-save/
  // choice-grid columns+gap — see the dedicated tests for those tabs).
  it("hosts breadcrumb, scope pills (ONE implementation with the inspector), undo/redo, viewport, frame hint, offer-mapping toggle, and the compact More popover (structure + choice) — always visible; every migrated/removed control is gone from the toolbar", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // the toolbar block itself is NOT hidden (matrix row 1 shows the base).
    // v3.1: the toolbar now carries an inline style (golden 46px bar chrome).
    expect(html).toMatch(/<div class="studio-toolbar" data-studio-selection-toolbar data-studio-canvas-toolbar style="[^"]*">/);
    // 1. breadcrumb lives INSIDE the toolbar now
    const toolbarAt = html.indexOf("data-studio-canvas-toolbar");
    const crumbAt = html.indexOf("data-studio-breadcrumb");
    expect(crumbAt).toBeGreaterThan(toolbarAt);
    // 2. scope pills render TWICE (toolbar + inspector) from ONE helper
    expect(html.split('data-scope-pill="section"').length - 1).toBe(2);
    // 3. undo/redo (disabled at boot — empty stacks)
    expect(html).toMatch(/data-studio-act="undo" disabled/);
    expect(html).toMatch(/data-studio-act="redo" disabled/);
    // 4. viewport toggle — Desktop 1280 / Mobile 375
    expect(html).toContain('data-canvas-viewport="desktop"');
    expect(html).toContain('data-canvas-viewport="mobile"');
    expect(html).toContain("Desktop 1280");
    expect(html).toContain("Mobile 375");
    // 5. structure cluster incl. the Group→Grid/Columns + Ungroup — now
    // inside the toolbar's "More" popover (still a toolbar descendant).
    expect(html).toContain("data-studio-more-toggle");
    expect(html).toContain("data-studio-more-panel");
    for (const act of ["move-up", "move-down", "add-before", "add-after", "duplicate", "delete", "group-stack", "group-cardpanel", "group-grid", "group-columns", "ungroup"]) {
      expect(html, `structure act ${act}`).toContain(`data-studio-act="${act}"`);
    }
    // 6. the toolbar's OWN "layout" cluster is GONE (was a pure duplicate of
    // the Style tab's renderContainerLayoutPanel, register S4-A3 removal) —
    // the SAME container props now live ONLY at the Style tab's ids.
    expect(html).not.toContain('id="lg-tb-Stack-direction"');
    expect(html).not.toContain('id="lg-tb-CardPanel-width"');
    expect(html).toContain('id="lg-container-Stack-direction"');
    expect(html).toContain('id="lg-container-CardPanel-width"');
    // data-toolbar-choice-layout kept its NAME (attribute-addressed, works
    // regardless of DOM location) but now renders inside the Style tab.
    expect(html).toContain("data-toolbar-choice-layout");
    // 7. the toolbar's OWN "text" cluster is GONE: the type-swap select
    // MOVED to the Content tab (data-text-role, same attribute, new id) and
    // the text-color role select was a DUPLICATE of the Style tab's own
    // featureColor select (data-style-text-block) — DELETED, not migrated.
    expect(html).toContain("data-text-role");
    expect(html).toContain('id="lg-content-type-swap"');
    expect(html).not.toContain("data-toolbar-text-color");
    // 8. the toolbar's OWN "component" cluster quick controls: add-choice/
    // autoadvance/open-validation are GONE (exact duplicates of the Content
    // tab's own +Add-choice button, "When answered" segmented, and the
    // Content tab itself being one click away — respectively). searchable/
    // card-style/slider-format/accept MIGRATED to the Content tab (same
    // attribute names, new location).
    expect(html).not.toContain("data-toolbar-add-choice");
    expect(html).not.toContain("data-toolbar-autoadvance");
    expect(html).not.toContain("data-toolbar-open-validation");
    expect(html).toContain("data-toolbar-searchable");
    expect(html).not.toContain("data-toolbar-accept-wrap");
    expect(html).toContain('id="lg-inspector-accept"'); // the Content tab's own (pre-existing) Accept select
    // choice cluster (§6.4) — now inside the "More" popover. "label" is
    // REMOVED (the data-choice-value-chip already does the exact same
    // "opens its Choices row" navigation — a redundant twin, not migrated).
    for (const act of ["image", "badge", "disabled", "duplicate", "left", "right", "delete"]) {
      expect(html, `choice act ${act}`).toContain(`data-choice-act="${act}"`);
    }
    expect(html).not.toContain('data-choice-act="label"');
    expect(html).toContain("data-choice-value-chip");
    // 9. preset menu MIGRATED to the Style tab (same attribute names).
    expect(html).toContain("data-preset-save");
    expect(html).toContain("data-preset-apply");
    expect(html).toContain("Save as preset");
    expect(html).not.toContain('data-toolbar-cluster="preset"');
    // §6.7 inline problems slot — stays in the toolbar.
    expect(html).toContain("data-toolbar-problems");
  });
});

describeDb("wave 2 — §6.5 context matrix (executed toolbarClustersFor)", () => {
  it("visible clusters are a pure function of the selection class — the normative table row per row", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, YESNO_CONTENT);
    probe.run(
      [
        sliceIslandArray(island, "TEXT_ROLE_TYPES"),
        sliceIslandFunction(island, "isCopyNode"),
        sliceIslandFunction(island, "toolbarClustersFor"),
      ].join("\n"),
    );
    const clusters = (node: unknown, choice: boolean): string[] =>
      probe.run(`toolbarClustersFor(${JSON.stringify(node)}, ${choice})`) as string[];
    const BASE = ["breadcrumb", "pills", "undo", "viewport"];
    // Nothing selected → base row only
    expect(clusters(null, false)).toEqual(BASE);
    // Bound headline / copy node → + text · structure
    expect(clusters({ type: "QuestionHeadline", question_id: "b", bind: "section_headline" }, false)).toEqual(
      BASE.concat(["text", "structure", "preset"]),
    );
    expect(clusters({ type: "HelperText", question_id: "h" }, false)).toEqual(BASE.concat(["text", "structure", "preset"]));
    // Choice component → + structure · layout(columns/gap) · component
    expect(clusters({ type: "IconCardAnswerGrid", question_id: "g" }, false)).toEqual(
      BASE.concat(["structure", "layout", "component", "preset"]),
    );
    // Single choice → + choice cluster only
    expect(clusters({ type: "IconCardAnswerGrid", question_id: "g" }, true)).toEqual(BASE.concat(["choice"]));
    // Input component → + structure · component
    expect(clusters({ type: "FreeTextQuestion", question_id: "f", internal_field: "note" }, false)).toEqual(
      BASE.concat(["structure", "component", "preset"]),
    );
    // Local container → + structure · layout
    expect(clusters({ type: "Stack", question_id: "s" }, false)).toEqual(BASE.concat(["structure", "layout", "preset"]));
    // Legacy frame node → structure only (frame data is Quote-Builder-owned)
    expect(clusters({ type: "HeaderBar", question_id: "hb" }, false)).toEqual(BASE.concat(["structure"]));
  });
});

describeDb("wave 2 — §6.1.3 undo/redo (executed island history)", () => {
  it("≥30 steps retained (50 cap), covers add/delete/reorder/prop-edit, undo/redo round-trip, cleared on Save; ⌘Z wiring shipped", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // the REAL afterModelChange pushes history as its second act, and the
    // save-success handler clears it (§6.1.3 "cleared on Save")
    expect(island).toContain("markDirty();\n    historyPush();");
    expect(island).toContain("historyReset();");
    expect(island).toContain("if (ev.shiftKey) { historyRedo(); } else { historyUndo(); }");
    const probe = studioProbe(html, { components: [] });
    probe.run(
      [
        "var UNDO_LIMIT = 50; var undoStack = []; var redoStack = [];",
        "var lastSnapshot = JSON.stringify(state.content);",
        "function updateHistoryButtons() {}",
        "function refreshAfterHistory() {}",
        sliceIslandFunction(island, "historyPush"),
        sliceIslandFunction(island, "historyReset"),
        sliceIslandFunction(island, "restoreSnapshot"),
        sliceIslandFunction(island, "historyUndo"),
        sliceIslandFunction(island, "historyRedo"),
        // route the shipped call order: every model mutation pushes history
        "function afterModelChange() { historyPush(); }",
      ].join("\n"),
    );
    // 60 ADD mutations → the stack caps at 50 (≥30 required)
    probe.run("for (var i = 0; i < 60; i++) { addComponentAt('HelperText', null, null); }");
    expect(probe.run("undoStack.length")).toBe(50);
    expect(probe.run("state.content.components.length")).toBe(60);
    // prop-edit + reorder + delete all flow through the same history hook
    probe.run("var first = state.content.components[0]; first.props = { text: 'edited' }; afterModelChange();");
    probe.run("moveWithin(state.content.components[1].question_id, 1);");
    probe.run("removeNode(state.content.components[0].question_id);");
    expect(probe.run("state.content.components.length")).toBe(59);
    // undo the delete → 60 components again, with the edited prop intact
    expect(probe.run("historyUndo()")).toBe(true);
    expect(probe.run("state.content.components.length")).toBe(60);
    expect(probe.run("state.content.components[0].props.text")).toBe("edited");
    // undo reorder + prop edit → the makeNode default text is back
    probe.run("historyUndo(); historyUndo();");
    expect(probe.run("state.content.components[0].props.text")).toBe("New HelperText text");
    // redo replays the prop edit
    expect(probe.run("historyRedo()")).toBe(true);
    expect(probe.run("state.content.components[0].props.text")).toBe("edited");
    // a NEW mutation invalidates the redo branch
    probe.run("addComponentAt('HelperText', null, null);");
    expect(probe.run("redoStack.length")).toBe(0);
    // cleared on Save
    probe.run("historyReset();");
    expect(probe.run("undoStack.length")).toBe(0);
    expect(probe.run("historyUndo()")).toBe(false);
  });
});

describeDb("wave 2 — §6.6 named presets (KV lg-component-presets)", () => {
  it("endpoint round-trip via the live router: POST validates (curated overrides + layout props ONLY), GET lists, DELETE removes; upsert by name", async () => {
    const { env } = newHarness();
    const kvEnv = { ...env, CACHE: kvStub() };
    // invalid: unknown component type
    let res = await admin.request(
      `${API}/component-presets`,
      jsonInit("POST", { name: "Bad", component_type: "NotAType" }),
      kvEnv,
    );
    expect(res.status).toBe(400);
    // invalid: a CONTENT key can never enter a preset (§6.6 never content/choices/mapping)
    res = await admin.request(
      `${API}/component-presets`,
      jsonInit("POST", {
        name: "Bad2",
        component_type: "IconCardAnswerGrid",
        overrides: { iconColor: "accent" },
        props_subset: { text: "smuggled copy" },
      }),
      kvEnv,
    );
    expect(res.status).toBe(400);
    const badBody = (await res.json()) as { fields: Record<string, string> };
    expect(badBody.fields["props_subset.text"]).toContain("is not a preset-capturable key");
    // R2 P7 D3: the operator-visible message no longer quotes a clause number
    expect(badBody.fields["props_subset.text"]).not.toContain("§");
    // invalid: a non-curated override key
    res = await admin.request(
      `${API}/component-presets`,
      jsonInit("POST", { name: "Bad3", component_type: "IconCardAnswerGrid", overrides: { freeCss: "red" } }),
      kvEnv,
    );
    expect(res.status).toBe(400);
    // valid create
    res = await admin.request(
      `${API}/component-presets`,
      jsonInit("POST", {
        name: "Hero grid",
        component_type: "IconCardAnswerGrid",
        overrides: { iconColor: "accent", gridGap: "1rem" },
        props_subset: { columnsDesktop: 3, image_fit: "cover" },
      }),
      kvEnv,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const created = (await res.json()) as { item: Record<string, unknown>; items: unknown[] };
    expect(created.item).toMatchObject({
      name: "Hero grid",
      component_type: "IconCardAnswerGrid",
      overrides: { iconColor: "accent", gridGap: "1rem" },
      props_subset: { columnsDesktop: 3, image_fit: "cover" },
      created_by: null, // no Access header in tests — honest null, never faked
    });
    expect(typeof created.item["created_at"]).toBe("number");
    // list
    res = await admin.request(`${API}/component-presets`, {}, kvEnv);
    expect(res.status).toBe(200);
    let listed = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(listed.items).toHaveLength(1);
    // upsert by name replaces in place
    res = await admin.request(
      `${API}/component-presets`,
      jsonInit("POST", { name: "Hero grid", component_type: "IconCardAnswerGrid", overrides: { iconColor: "success" } }),
      kvEnv,
    );
    expect(res.status).toBe(201);
    res = await admin.request(`${API}/component-presets`, {}, kvEnv);
    listed = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(listed.items).toHaveLength(1);
    expect((listed.items[0]!["overrides"] as Record<string, unknown>)["iconColor"]).toBe("success");
    // delete + 404 on repeat
    res = await admin.request(`${API}/component-presets/${encodeURIComponent("Hero grid")}`, { method: "DELETE" }, kvEnv);
    expect(res.status).toBe(200);
    res = await admin.request(`${API}/component-presets/${encodeURIComponent("Hero grid")}`, { method: "DELETE" }, kvEnv);
    expect(res.status).toBe(404);
  });

  it("island: buildPresetPayload captures type + curated overrides + LAYOUT props only; applyPreset merges onto SAME-type nodes and stores the name as provenance", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const CONTENT = {
      components: [
        {
          type: "IconCardAnswerGrid",
          question_id: "g1",
          internal_field: "biz",
          choices: [{ label: "A", value: "a", analytics_id: "a", icon: "★" }],
          props: { columns: 2, gap: "s", helper_text: "keep me out of presets" },
          design_overrides: { iconColor: "accent" },
        },
        { type: "TwoButtonYesNo", question_id: "q2", internal_field: "insured" },
      ],
    };
    const probe = studioProbe(html, CONTENT);
    probe.run(
      [
        sliceIslandArray(island, "PRESET_PROP_KEYS"),
        "var presetsData = [];",
        sliceIslandFunction(island, "presetsForType"),
        sliceIslandFunction(island, "presetByName"),
        sliceIslandFunction(island, "buildPresetPayload"),
        sliceIslandFunction(island, "applyPreset"),
      ].join("\n"),
    );
    // capture: helper_text (content) is EXCLUDED; gap (layout) is captured
    const payload = probe.run("buildPresetPayload(findRef('g1').node)") as Record<string, unknown>;
    expect(payload).toEqual({
      component_type: "IconCardAnswerGrid",
      overrides: { iconColor: "accent" },
      props_subset: { gap: "s" },
    });
    // apply merges onto a same-type node + provenance name
    probe.run(
      "presetsData = [{ name: 'Hero grid', component_type: 'IconCardAnswerGrid', overrides: { iconColor: 'success', gridGap: '1rem' }, props_subset: { columnsDesktop: 3 } }];",
    );
    expect(probe.run("applyPreset(findRef('g1').node, presetByName('Hero grid'))")).toBe(true);
    const node = probe.run("findRef('g1').node") as Record<string, unknown>;
    expect(node["design_preset"]).toBe("Hero grid");
    expect(node["design_overrides"]).toEqual({ iconColor: "success", gridGap: "1rem" });
    expect((node["props"] as Record<string, unknown>)["columnsDesktop"]).toBe(3);
    // choices/content untouched by the merge
    expect((node["choices"] as unknown[]).length).toBe(1);
    expect((node["props"] as Record<string, unknown>)["helper_text"]).toBe("keep me out of presets");
    // mismatched type → refused (§6.6 "mismatched type → disabled")
    expect(probe.run("applyPreset(findRef('q2').node, presetByName('Hero grid'))")).toBe(false);
    // the mutated model stays server-valid
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
  });
});

describeDb("wave 2 — §7.3 C1 provider chip over the DEV-55 projection", () => {
  it("GET /sections/:id (and the SSR blob) carry offer_values: one row per SELECTED offer with per-field output_value_map", async () => {
    const { env } = newHarness();
    const offer = await createOfferWithSchema(env, "Ins Co A", [
      { path: "applicant.insured", type: "boolean", required: true, internal_field: "currently_insured" },
    ]);
    const section = await createSection(env);
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", {
        answer_maps: [
          {
            question_id: "q1",
            offer_id: offer.id,
            offer_payload_field_path: "applicant.insured",
            provider_expected_type: "boolean",
            output_value_map: { yes: "YES_PROVIDER_A" },
            required_for_offer: true,
          },
        ],
      }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const detail = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as Record<string, unknown>;
    const projection = detail["offer_values"] as Array<Record<string, unknown>>;
    expect(projection).toHaveLength(1);
    expect(projection[0]).toMatchObject({
      offer_id: offer.id,
      offer_public_id: offer.public_id,
      offer_name: "Ins Co A",
    });
    const fields = projection[0]!["fields"] as Record<string, { path: string; values: Record<string, unknown> | null }>;
    expect(fields["currently_insured"]).toEqual({ path: "applicant.insured", values: { yes: "YES_PROVIDER_A" } });
    // the studio SSR blob is the chip's data source (DEV-55)
    const html = await studioPage(env, section.public_id);
    const blob = extractJsonBlob(html, "lg-section-data");
    expect((blob["offer_values"] as unknown[]).length).toBe(1);
  });

  it("C1: NO provider-value control exists on the Choices surface; the chip lists ONE ROW PER SELECTED OFFER (value or 'not set') with the value-map deep link", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // the row grid's field list carries NO provider field of any spelling
    expect(island).not.toContain("provider_value");
    expect(island).not.toContain("'provider'");
    // the C1 note names the Offers tab (v3.1 §8.2 folds Mapping -> Offers)
    // as the only provider-value editor
    expect(html).toContain("Provider values are set per Offer in the Offers tab");
    // executed: the chip projection — one row PER SELECTED OFFER
    const probe = studioProbe(html, YESNO_CONTENT);
    probe.run(
      "state.offer_values = [" +
        "{ offer_id: 1, offer_public_id: 'lgo_aaa', offer_name: 'Ins Co A', fields: { currently_insured: { path: 'applicant.insured', values: { yes: 'YES_A' } } } }," +
        "{ offer_id: 2, offer_public_id: 'lgo_bbb', offer_name: 'Ins Co B', fields: {} }" +
        "];",
    );
    probe.run(
      [
        sliceIslandFunction(island, "providerChipRows"),
        sliceIslandFunction(island, "providerChipLabel"),
      ].join("\n"),
    );
    const rows = probe.run("providerChipRows('currently_insured', 'yes')") as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      { offer_name: "Ins Co A", offer_public_id: "lgo_aaa", value: "YES_A", href: "/admin/leadgen/offers/lgo_aaa/edit#payload" },
      { offer_name: "Ins Co B", offer_public_id: "lgo_bbb", value: null, href: "/admin/leadgen/offers/lgo_bbb/edit#payload" },
    ]);
    // k/n label: 1 of 2 Offers carries a value for this choice
    expect(probe.run("providerChipLabel('currently_insured', 'yes')")).toBe("Provider values: 1/2 Offers");
    // the same normalized answer maps to DIFFERENT provider values per Offer
    // (§12.2) — the chip renders each offer's own value, never a universal one
    const rowsNo = probe.run("providerChipRows('currently_insured', 'no')") as Array<Record<string, unknown>>;
    expect(rowsNo.map((r) => r["value"])).toEqual([null, null]);
  });
});

describeDb("wave 2 — §9.5 Section role-overrides drawer mode", () => {
  it("SSR: the Design-overrides drawer tab hosts the §9.5 banner (verbatim), 14 role rows, columnsDefault + gapDefault", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toContain('data-studio-drawer-tab="design"');
    expect(html).toContain('data-studio-drawer-panel="design"');
    expect(html).toContain(
      "These apply wherever this Section is used — prefer the Quote theme for funnel-wide changes.",
    );
    for (const role of ["brand_primary", "accent", "button_primary_bg", "text_muted"]) {
      expect(html, `role row ${role}`).toContain(`data-section-role="${role}"`);
    }
    expect(html.split("data-section-role=").length - 1).toBe(14);
    expect(html).toContain("data-section-columns-default");
    expect(html).toContain("data-section-gap-default");
  });

  it("EXECUTED: buildSectionOverrides emits the sparse §9.5 shape; a real PATCH persists it; the canvas re-render carries it as layer 4 (live preview proof)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // DOM stub: brand_primary re-pointed to accent + columns 3 + gap l
    const roleSel = (role: string, value: string) => ({
      getAttribute: () => role,
      value,
    });
    const docStub = {
      getElementById() {
        return null;
      },
      querySelector(sel: string) {
        if (sel === "[data-section-columns-default]") return { value: "3" };
        if (sel === "[data-section-gap-default]") return { value: "l" };
        return null;
      },
      querySelectorAll(sel: string) {
        if (sel === "[data-section-role]") {
          return [roleSel("button_primary_bg", "accent"), roleSel("text_primary", "")];
        }
        return [];
      },
    };
    const probe = studioProbe(html, YESNO_CONTENT, docStub as unknown as Record<string, unknown>);
    probe.run(sliceIslandFunction(island, "buildSectionOverrides"));
    const built = probe.run("buildSectionOverrides()") as Record<string, unknown>;
    expect(built).toEqual({ palette: { button_primary_bg: "accent" }, columnsDefault: 3, gapDefault: "l" });
    // the island save body + canvas re-render both carry the §9.5 store
    expect(island).toContain("design_overrides: state.design_overrides || null");
    expect(island).toContain("if (state.design_overrides) { canvasBody.design_overrides = state.design_overrides; }");
    // real PATCH persists the shape (the wave-C-1 validator accepts it)
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { design_overrides: built }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as Record<string, unknown>;
    expect(saved["design_overrides_json"]).toEqual(built);
    // layer-4 proof through the REAL preview endpoint the canvas calls: the
    // re-pointed button role lands in the ContinueButton markup
    const preview = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: JSON.stringify({
          components: [{ type: "ContinueButton", question_id: "c1", props: { label: "Continue" } }],
        }),
        viewport: "desktop",
        design_overrides: built,
      }),
      env,
    );
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { preview: { html: string } };
    expect(previewBody.preview.html).toContain("--lg-btn-bg:#E85D26"); // accent
  });
});

describeDb("wave 2 — §9.4 Design-tab role decorations (executed)", () => {
  it("source line speaks role LABELS (no hex text), Section re-points are named, legacy hex converts on exact match", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, YESNO_CONTENT);
    probe.run(
      [
        "var ROLE_VALUES = studioMeta.roles; var ROLE_LABELS = studioMeta.role_labels;",
        sliceIslandArray(island, "COLOR_OVERRIDE_KEYS"),
        sliceIslandVar(island, "OVERRIDE_BACKING_ROLE"),
        sliceIslandFunction(island, "isHexColor"),
        sliceIslandFunction(island, "roleLabelOf"),
        sliceIslandFunction(island, "overrideSourceText"),
        sliceIslandFunction(island, "resolvedOverrideColor"),
        sliceIslandFunction(island, "legacyHexToRole"),
      ].join("\n"),
    );
    // inherited buttonBackground names its backing role in operator words
    expect(probe.run("overrideSourceText('buttonBackground', undefined)")).toBe(
      "Inherited: Button — from the base design.",
    );
    // a Section §9.5 re-point is credited as the source
    probe.run("state.design_overrides = { palette: { button_primary_bg: 'accent' } };");
    expect(probe.run("overrideSourceText('buttonBackground', undefined)")).toBe(
      "Inherited: Accent — from this Section’s Design overrides.",
    );
    // an overridden role names itself; a stored hex is called out — NO hex TEXT
    // (R5 jargon purge: "Custom color (legacy)" -> "Custom color" — the word
    // "legacy" never renders).
    expect(probe.run("overrideSourceText('iconColor', 'accent')")).toBe("Accent — overridden for this component.");
    expect(probe.run("overrideSourceText('iconColor', '#123456')")).toBe("Custom color — not a theme role.");
    expect(String(probe.run("overrideSourceText('iconColor', '#123456')"))).not.toMatch(/#[0-9a-f]{3,8}/i);
    // convert: an EXACT default-design match maps hex → role; no match → null
    const accentHex = (extractJsonBlob(html, "lg-studio-meta")["roles"] as Record<string, string>)["accent"];
    expect(probe.run(`legacyHexToRole(${JSON.stringify(accentHex)})`)).toBe("accent");
    expect(probe.run("legacyHexToRole('#00dead')")).toBe(null);
  });

  it("a role PICK repaints the decorations SAME-TICK through afterModelChange — source line + Reset + swatch, no re-selection (09 §9.4)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // decoration elements for ONE key (buttonBackground); every other lookup null
    const srcEl = { textContent: "" };
    const resetBtn = { hidden: true };
    const legacyEl = { hidden: false };
    const swatch = { style: { background: "" } };
    const decorations: Record<string, unknown> = {
      '[data-override-source="buttonBackground"]': srcEl,
      '[data-override-reset="buttonBackground"]': resetBtn,
      // R5 jargon purge: data-override-legacy -> data-override-custom
      // (.studio-role-legacy CSS class -> .studio-role-custom).
      '[data-override-custom="buttonBackground"]': legacyEl,
      '[data-override-swatch="buttonBackground"]': swatch,
    };
    const probe = studioProbe(html, YESNO_CONTENT, {
      getElementById() {
        return null;
      },
      querySelector(sel: string) {
        return decorations[sel] ?? null;
      },
      querySelectorAll() {
        return [];
      },
    });
    probe.run(
      [
        "var ROLE_VALUES = studioMeta.roles; var ROLE_LABELS = studioMeta.role_labels;",
        sliceIslandArray(island, "COLOR_OVERRIDE_KEYS"),
        sliceIslandVar(island, "OVERRIDE_BACKING_ROLE"),
        sliceIslandFunction(island, "isHexColor"),
        sliceIslandFunction(island, "roleLabelOf"),
        sliceIslandFunction(island, "overrideSourceText"),
        sliceIslandFunction(island, "resolvedOverrideColor"),
        sliceIslandFunction(island, "ensureLegacyOption"),
        sliceIslandFunction(island, "renderOverrideDecorations"),
        sliceIslandFunction(island, "collectInspectorOverride"),
        // the REAL served afterModelChange (overrides the harness no-op) + stubs
        // for its non-§9.4 collaborators. populateInspector THROWS on purpose:
        // repainting by re-selection is the defect — same-tick or fail.
        sliceIslandFunction(island, "afterModelChange"),
        "function markDirty() {} function historyPush() {} function renderIssues() {}",
        "function renderBoundChips() {} function updatePaletteBindItems() {} function renderBindBanner() {}",
        "function updateCanvasToolbar() {} function scheduleCanvasRender() {}",
        "function populateInspector() { throw new Error('§9.4 repaint must not require re-selection'); }",
      ].join("\n"),
    );
    // a node is selected; its decorations are still unpainted
    probe.run("selectedQuestionId = 'q1';");
    expect(srcEl.textContent).toBe("");
    expect(resetBtn.hidden).toBe(true);
    // the PICK rides the real inspector change path (collect → afterModelChange)
    probe.sandbox["pickInput"] = {
      value: "accent",
      getAttribute: (k: string) => (k === "data-inspector-override" ? "buttonBackground" : null),
    };
    probe.run("collectInspectorOverride(pickInput)");
    // same tick: the source line speaks the role LABEL, Reset appears, the
    // swatch paints the role's resolved color — with NO re-selection.
    expect(srcEl.textContent).toBe("Accent — overridden for this component.");
    expect(resetBtn.hidden).toBe(false);
    expect(legacyEl.hidden).toBe(true); // a role pick is not a legacy hex
    const accentHex = (extractJsonBlob(html, "lg-studio-meta")["roles"] as Record<string, string>)["accent"];
    expect(swatch.style.background).toBe(accentHex);
    // and the model carries exactly the override the decorations describe
    expect(probe.run("selectedNode().design_overrides.buttonBackground")).toBe("accent");
  });
});

describeDb("wave 2 — §5.3 mode 5: Preview with funnel layout", () => {
  it("SSR ships the frame picker + the EXACT empty-state copy; the island sends frame_context to the landed preview param", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    for (const hook of ["data-frame-pick-quote", "data-frame-pick-funnel", "data-frame-pick-variant", "data-frame-pick-site"]) {
      expect(html, hook).toContain(hook);
    }
    // the §5.3 empty state, verbatim
    expect(html).toContain("This Section isn’t used in any Quote yet — previewing in the default funnel layout.");
    const island = studioIsland(html);
    expect(island).toContain("requestBody.frame_context = frameCtx;");
    // executed: frameContextBody builds the §13.4 param shape
    const probe = studioProbe(html, YESNO_CONTENT);
    probe.run(
      [
        "var framePick = { quote: 'lgq_q', funnel: '', variant: '', site: '' };",
        sliceIslandFunction(island, "frameContextBody"),
      ].join("\n"),
    );
    expect(probe.run("frameContextBody()")).toBe(null); // no funnel picked → unit only
    probe.run("framePick.funnel = 'lgf_fun';");
    expect(probe.run("frameContextBody()")).toEqual({ funnel_public_id: "lgf_fun" });
    probe.run("framePick.variant = 'lgn_var'; framePick.site = 'site-1';");
    expect(probe.run("frameContextBody()")).toEqual({
      funnel_public_id: "lgf_fun",
      variant_public_id: "lgn_var",
      site_id: "site-1",
    });
  });

  it("EXECUTED runPreview: a picked funnel rides frame_context through the REAL preview endpoint and renders the composed document", async () => {
    const { env } = newHarness();
    // a real quote (creates funnel + control variant atomically)
    const quoteRes = await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: "Life Quote", activity: "quote_funnel", verticals: ["life"] }),
      env,
    );
    expect(quoteRes.status, await quoteRes.clone().text()).toBe(201);
    const quote = (await quoteRes.json()) as { public_id: string };
    const funnels = (await (
      await admin.request(`${API}/quotes/${quote.public_id}/funnels`, {}, env)
    ).json()) as { items: Array<{ public_id: string }> };
    const funnelId = funnels.items[0]!.public_id;
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const frame = stubEl("iframe");
    const probeFrame = stubEl("iframe");
    const errEl = stubEl("p");
    errEl.hidden = true;
    let captured: { url: string; init: RequestInit } | null = null;
    const sandbox = {
      state: { content: JSON.parse(JSON.stringify(YESNO_CONTENT)), public_id: section.public_id },
      simState: "default",
      previewViewport: "desktop",
      framePick: { quote: quote.public_id, funnel: funnelId, variant: "", site: "" },
      document: {
        getElementById(id: string) {
          if (id === "lg-preview-frame") return frame;
          if (id === "lg-events-probe-frame") return probeFrame;
          if (id === "lg-preview-error") return errEl;
          return null;
        },
        querySelector() {
          return null;
        },
        querySelectorAll() {
          return [];
        },
        createTextNode(t: string) {
          return { nodeType: 3, textContent: String(t) };
        },
      },
      fetch(url: string, init: RequestInit): Promise<Response> {
        captured = { url, init };
        return Promise.resolve(admin.request(url, init, env));
      },
    };
    const source = [
      sliceIslandFunction(island, "trimStr"),
      sliceIslandFunction(island, "frameContextBody"),
      sliceIslandFunction(island, "sampleAnswers"),
      sliceIslandFunction(island, "renderDependencyStatus"),
      sliceIslandFunction(island, "clearEventsList"),
      sliceIslandFunction(island, "runPreview"),
      "runPreview();",
    ].join("\n");
    runInNewContext(source, sandbox);
    for (let i = 0; i < 200 && !frame.attrs["srcdoc"] && errEl.hidden; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(captured, "preview fetch executed").not.toBeNull();
    const body = JSON.parse(String(captured!.init.body)) as Record<string, unknown>;
    expect(body["frame_context"]).toEqual({ funnel_public_id: funnelId });
    // the REAL handler composed the unit inside the funnel frame (NULL stored
    // frame → the §13.1 legacy-shell fork — still a full funnel document)
    expect(errEl.hidden, errEl.textContent).toBe(true);
    const doc = frame.attrs["srcdoc"] ?? "";
    expect(doc).toContain('data-funnel-id="' + funnelId + '"');
    expect(doc).toContain("data-lg-section");
  });
});

describeDb("wave 2 — §5.4 Move to funnel layout (LIVE semantics)", () => {
  const FRAME_NODE_CONTENT = {
    components: [
      { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
      { type: "HeaderBar", question_id: "q_hb", props: { logoMediaId: "media_logo", secure: true, secureText: "SSL secured" } },
    ],
  };

  it("equivalentFrameGroup maps every legacy frame-scope type to a group the REAL frame validator accepts", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, { components: [] });
    probe.run(sliceIslandFunction(island, "equivalentFrameGroup"));
    const cases: Array<{ node: Record<string, unknown>; expectKey: string }> = [
      { node: { type: "ProgressBar", question_id: "a", props: { mode: "percent" } }, expectKey: "progress" },
      { node: { type: "StepIndicator", question_id: "b", props: { steps: 4, current: 2 } }, expectKey: "progress" },
      { node: { type: "HeaderLogo", question_id: "c", props: { logoMediaId: "media_1" } }, expectKey: "header" },
      { node: { type: "BackButton", question_id: "d", props: { label: "Back" } }, expectKey: "back" },
      { node: { type: "DisclosureLink", question_id: "e", props: { panelHtml: "Disclosure" } }, expectKey: "disclosure" },
      { node: { type: "HeaderBar", question_id: "f", props: { logoMediaId: "m", secure: true, cta: { label: "Call", tel: "+1 555 123 4567" } } }, expectKey: "header" },
      { node: { type: "FooterBar", question_id: "g", props: { legalHtml: "Terms.", trustMessages: ["SSL"], links: [{ label: "Privacy", href: "/p" }] } }, expectKey: "footer" },
      { node: { type: "BackgroundPanel", question_id: "h", props: { gradient: "primary" } }, expectKey: "background" },
      // FIX 3: the REAL legacy step mode ('step', presets.ts enum) → numbered;
      // a label carries as show_label. FIX 1b: a panel image moves WITH it.
      { node: { type: "ProgressBar", question_id: "a2", props: { mode: "step", step: 2, totalSteps: 5, label: "Step 2 of 5" } }, expectKey: "progress" },
      { node: { type: "BackgroundPanel", question_id: "h2", props: { imageMediaId: "media_bg_1" } }, expectKey: "background" },
    ];
    for (const c of cases) {
      const group = probe.run(`equivalentFrameGroup(${JSON.stringify(c.node)})`) as Record<string, unknown>;
      expect(group, `${c.node["type"]} maps`).not.toBeNull();
      expect(Object.keys(group)).toContain(c.expectKey);
      // the REAL server gate: no error-severity problems
      const validation = validateFrameConfig(group);
      const errors = validation.problems.filter((pr) => pr.severity === "error");
      expect(errors, `${c.node["type"]} → ${JSON.stringify(errors)}`).toEqual([]);
    }
    // FIX 3 exact mapping: 'step' (the real stored value) → numbered + the
    // label presence rides progress.show_label; 'percent' stays percent with
    // NO show_label key (sparse group).
    expect(
      probe.run("equivalentFrameGroup({ type: 'ProgressBar', question_id: 'p', props: { mode: 'step', label: 'Step 1 of 3' } })"),
    ).toEqual({ progress: { style: "numbered", show_label: true } });
    expect(
      probe.run("equivalentFrameGroup({ type: 'ProgressBar', question_id: 'p', props: { mode: 'percent', percent: 40 } })"),
    ).toEqual({ progress: { style: "percent" } });
    // the dead pre-fix comparison value maps like any non-step mode
    expect(
      probe.run("equivalentFrameGroup({ type: 'ProgressBar', question_id: 'p', props: { mode: 'steps' } })"),
    ).toEqual({ progress: { style: "percent" } });
    // FIX 1b exact mapping: imageMediaId → background.image_media_id
    expect(
      probe.run("equivalentFrameGroup({ type: 'BackgroundPanel', question_id: 'b', props: { gradient: 'primary', imageMediaId: 'media_bg_1' } })"),
    ).toEqual({ background: { style: "brand_gradient", image_media_id: "media_bg_1" } });
    // a unit component has no frame equivalent
    expect(probe.run("equivalentFrameGroup({ type: 'TwoButtonYesNo', question_id: 'x' })")).toBe(null);
    // group merge: our group's fields win; untouched stored fields survive
    probe.run(sliceIslandFunction(island, "mergeFrameGroups"));
    const merged = probe.run(
      "mergeFrameGroups({ header: { tagline: 'Keep me' }, progress: { style: 'bar' } }, { header: { enabled: true } })",
    ) as Record<string, Record<string, unknown>>;
    expect(merged["header"]).toEqual({ tagline: "Keep me", enabled: true });
    expect(merged["progress"]).toEqual({ style: "bar" });
  });

  it("single funnel: the confirm NAMES the funnel; the REAL PUT lands the group; the node is removed and PATCHed on the SAME action; cancel = no change", async () => {
    const { env } = newHarness();
    const quoteRes = await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: "Life Quote", activity: "quote_funnel", verticals: ["life"], funnel_name: "Main funnel" }),
      env,
    );
    expect(quoteRes.status).toBe(201);
    const quote = (await quoteRes.json()) as { public_id: string };
    const funnels = (await (
      await admin.request(`${API}/quotes/${quote.public_id}/funnels`, {}, env)
    ).json()) as { items: Array<{ public_id: string; funnel_name: string }> };
    const funnel = funnels.items[0]!;
    const section = await createSection(env, { content_json: JSON.stringify(FRAME_NODE_CONTENT) });
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);

    const confirms: string[] = [];
    let confirmAnswer = false;
    const fetches: string[] = [];
    const probe = studioProbe(html, FRAME_NODE_CONTENT);
    probe.sandbox["window"] = {
      confirm(msg: string) {
        confirms.push(msg);
        return confirmAnswer;
      },
    };
    probe.sandbox["dirty"] = false;
    (probe.sandbox.state as Record<string, unknown>)["public_id"] = section.public_id;
    probe.sandbox["usageRows"] = [
      { quote_public_id: quote.public_id, funnel_public_id: funnel.public_id, funnel_name: funnel.funnel_name, variant_public_id: "lgn_x" },
    ];
    probe.sandbox["fetch"] = (url: string, init?: RequestInit): Promise<Response> => {
      fetches.push(`${init?.method ?? "GET"} ${url}`);
      return Promise.resolve(admin.request(url, init ?? {}, env));
    };
    probe.run(
      [
        "function markDirty() { dirty = true; }",
        "function selectComponent() {}",
        "function showMoveNote() {}",
        "var selectedQuestionId = null;",
        sliceIslandFunction(island, "usageFunnelsOf"),
        sliceIslandFunction(island, "moveConfirmMessage"),
        sliceIslandFunction(island, "equivalentFrameGroup"),
        sliceIslandFunction(island, "mergeFrameGroups"),
        // FIX 1a: the child-preserving removal finishMoveToFrame delegates to.
        sliceIslandFunction(island, "removeMovedFrameNode"),
        // R3 MINOR-3 (reland): finishMoveToFrame now calls collectSection,
        // which calls confirmSaveMigrationLoss's sibling helpers — FRAME_NODE_
        // CONTENT has no LogoStrip, so confirmSaveMigrationLoss short-circuits
        // to `true` without prompting (confirms stays length 1 throughout).
        sliceIslandLine(island, "var LOSSY_LOGOSTRIP_SAVE_CONFIRM"),
        sliceIslandFunction(island, "contentHasRetiredLogoStrip"),
        sliceIslandFunction(island, "confirmSaveMigrationLoss"),
        sliceIslandFunction(island, "finishMoveToFrame"),
        sliceIslandFunction(island, "doMoveToFrame"),
        sliceIslandFunction(island, "renderFunnelPicker"),
        sliceIslandFunction(island, "funnelPickBtn"),
        sliceIslandFunction(island, "startMoveToFrame"),
      ].join("\n"),
    );

    // CANCEL: the confirm precedes ANY write — nothing fetched, node kept
    probe.run("startMoveToFrame('q_hb')");
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toContain("Main funnel"); // the confirm NAMES the funnel
    expect(confirms[0]).toContain("Header bar"); // operator words, not type ids
    expect(fetches).toHaveLength(0);
    expect(probe.run("findRef('q_hb') !== null")).toBe(true);

    // CONFIRM: GET frame → PUT merged group → PATCH the section content
    confirmAnswer = true;
    probe.run("startMoveToFrame('q_hb')");
    for (let i = 0; i < 200 && fetches.length < 3; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(probe.sandbox.refusals, "no refusal on the happy path").toEqual([]);
    expect(fetches).toEqual([
      `GET /api/admin/leadgen/funnels/${funnel.public_id}/frame`,
      `PUT /api/admin/leadgen/funnels/${funnel.public_id}/frame`,
      `PATCH /api/admin/leadgen/sections/${section.public_id}`,
    ]);
    // the node left the island model…
    expect(probe.run("findRef('q_hb')")).toBe(null);
    // …the frame group LANDED for real…
    const frameRead = (await (
      await admin.request(`${API}/funnels/${funnel.public_id}/frame`, {}, env)
    ).json()) as { frame_config: Record<string, Record<string, unknown>> };
    expect(frameRead.frame_config["header"]).toMatchObject({
      enabled: true,
      logo_source: "manual",
      logo_media_id: "media_logo",
      secure_badge: { enabled: true, text: "SSL secured" },
    });
    // …and the SAME action persisted the removal (real PATCH landed)
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as Record<string, unknown>;
    const savedContent = saved["content_json"] as { components: Array<Record<string, unknown>> };
    expect(savedContent.components.map((n) => n["type"])).toEqual(["TwoButtonYesNo"]);
    // the pre-move clean state is restored (nothing else was unsaved)
    expect(probe.sandbox["dirty"]).toBe(false);
  });

  it("FIX 1 (BLOCKER): moving a BackgroundPanel WITH children keeps the children in the Section (spliced in place, order preserved); the frame gains style+image; the confirm NAMES the contents' fate — API read-backs", async () => {
    const { env } = newHarness();
    const quoteRes = await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: "Panel Quote", activity: "quote_funnel", verticals: ["life"], funnel_name: "Panel funnel" }),
      env,
    );
    expect(quoteRes.status).toBe(201);
    const quote = (await quoteRes.json()) as { public_id: string };
    const funnels = (await (
      await admin.request(`${API}/quotes/${quote.public_id}/funnels`, {}, env)
    ).json()) as { items: Array<{ public_id: string; funnel_name: string }> };
    const funnel = funnels.items[0]!;
    const PANEL_CONTENT = {
      components: [
        { type: "QuestionHeadline", question_id: "h1", props: { text: "Are you insured?" } },
        {
          type: "BackgroundPanel",
          question_id: "bg1",
          props: { gradient: "primary", imageMediaId: "media_bg_7" },
          children: [
            { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
            { type: "HelperText", question_id: "help1", props: { text: "Takes two minutes." } },
          ],
        },
        { type: "ContinueButton", question_id: "c1", props: { label: "Continue" } },
      ],
    };
    const section = await createSection(env, { content_json: JSON.stringify(PANEL_CONTENT) });
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const confirms: string[] = [];
    const fetches: string[] = [];
    const probe = studioProbe(html, PANEL_CONTENT);
    probe.sandbox["window"] = {
      confirm(msg: string) {
        confirms.push(msg);
        return true;
      },
    };
    probe.sandbox["dirty"] = false;
    (probe.sandbox.state as Record<string, unknown>)["public_id"] = section.public_id;
    probe.sandbox["usageRows"] = [
      { quote_public_id: quote.public_id, funnel_public_id: funnel.public_id, funnel_name: funnel.funnel_name, variant_public_id: "lgn_x" },
    ];
    probe.sandbox["fetch"] = (url: string, init?: RequestInit): Promise<Response> => {
      fetches.push(`${init?.method ?? "GET"} ${url}`);
      return Promise.resolve(admin.request(url, init ?? {}, env));
    };
    // R3 GRANT-2: the vm-probe now ALSO slices collectSection's migration
    // helpers (confirmSaveMigrationLoss/contentHasRetiredLogoStrip + the
    // LOSSY_LOGOSTRIP_SAVE_CONFIRM string) alongside finishMoveToFrame/
    // doMoveToFrame — MINOR-3 reland routes finishMoveToFrame's PATCH through
    // collectSection, so this sandbox must carry every symbol that call graph
    // now touches (collectSection itself already rides via MODEL_FUNCS).
    probe.run(
      [
        "function markDirty() { dirty = true; }",
        "function selectComponent() {}",
        "function showMoveNote() {}",
        "var selectedQuestionId = null;",
        sliceIslandFunction(island, "usageFunnelsOf"),
        sliceIslandFunction(island, "moveConfirmMessage"),
        sliceIslandFunction(island, "equivalentFrameGroup"),
        sliceIslandFunction(island, "mergeFrameGroups"),
        sliceIslandFunction(island, "removeMovedFrameNode"),
        sliceIslandLine(island, "var LOSSY_LOGOSTRIP_SAVE_CONFIRM"),
        sliceIslandFunction(island, "contentHasRetiredLogoStrip"),
        sliceIslandFunction(island, "confirmSaveMigrationLoss"),
        sliceIslandFunction(island, "finishMoveToFrame"),
        sliceIslandFunction(island, "doMoveToFrame"),
        sliceIslandFunction(island, "renderFunnelPicker"),
        sliceIslandFunction(island, "funnelPickBtn"),
        sliceIslandFunction(island, "startMoveToFrame"),
      ].join("\n"),
    );

    probe.run("startMoveToFrame('bg1')");
    for (let i = 0; i < 200 && fetches.length < 3; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(probe.sandbox.refusals, "no refusal on the happy path").toEqual([]);
    // FIX 1c: the confirm NAMES the contents' fate. This section has no
    // retired LogoStrip, so confirmSaveMigrationLoss short-circuits to `true`
    // WITHOUT prompting — still exactly ONE confirm (the move confirm).
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toContain("Panel funnel");
    expect(confirms[0]).toContain("Its contents stay in this Section.");
    expect(fetches).toEqual([
      `GET /api/admin/leadgen/funnels/${funnel.public_id}/frame`,
      `PUT /api/admin/leadgen/funnels/${funnel.public_id}/frame`,
      `PATCH /api/admin/leadgen/sections/${section.public_id}`,
    ]);
    // FIX 1a: the container is GONE, its children SURVIVE at its index —
    // order preserved (h1, q1, help1, c1).
    expect(probe.run("findRef('bg1')")).toBe(null);
    expect(
      probe.run("state.content.components.map(function (n) { return n.question_id; })"),
    ).toEqual(["h1", "q1", "help1", "c1"]);
    // the mutated model still passes the REAL server validator
    const mutated = probe.run("state.content") as Parameters<typeof validateSectionContent>[0];
    expect(validateSectionContent(mutated).errors).toEqual([]);
    // FIX 1b: the frame READ-BACK carries style + image_media_id
    const frameRead = (await (
      await admin.request(`${API}/funnels/${funnel.public_id}/frame`, {}, env)
    ).json()) as { frame_config: Record<string, Record<string, unknown>> };
    expect(frameRead.frame_config["background"]).toMatchObject({
      style: "brand_gradient",
      image_media_id: "media_bg_7",
    });
    // the SAME action persisted the child-preserving removal (real PATCH)
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as Record<string, unknown>;
    const savedContent = saved["content_json"] as { components: Array<Record<string, unknown>> };
    expect(savedContent.components.map((n) => n["question_id"])).toEqual(["h1", "q1", "help1", "c1"]);
    // MIGRATED (E2-NEW-4, R3 MINOR-3 reland): finishMoveToFrame now routes its
    // content-only PATCH through collectSection, so the retired HelperText
    // child is rewritten to TextBlock(role:helper) on THIS save, same as the
    // main Save button — no more permanently-legacy shape via this path.
    expect(savedContent.components.map((n) => n["type"])).toEqual([
      "QuestionHeadline",
      "TwoButtonYesNo",
      "TextBlock",
      "ContinueButton",
    ]);
    const migratedHelper = savedContent.components.find((n) => n["question_id"] === "help1");
    expect(migratedHelper?.["props"]).toMatchObject({ role: "helper", text: "Takes two minutes." });
    expect(probe.sandbox["dirty"]).toBe(false);
  });

  it("MINOR-3 reland: the lossy-LogoStrip save confirm gates the move-to-frame path too — decline aborts BEFORE any write; accept proceeds and migrates the WHOLE tree (E2-NEW-4)", async () => {
    const { env } = newHarness();
    const quoteRes = await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: "Lossy Move Quote", activity: "quote_funnel", verticals: ["life"], funnel_name: "Lossy Move funnel" }),
      env,
    );
    expect(quoteRes.status).toBe(201);
    const quote = (await quoteRes.json()) as { public_id: string };
    const funnels = (await (
      await admin.request(`${API}/quotes/${quote.public_id}/funnels`, {}, env)
    ).json()) as { items: Array<{ public_id: string; funnel_name: string }> };
    const funnel = funnels.items[0]!;
    // The LogoStrip is a STRAY node — NOT the one being moved — proving the
    // guard covers the whole-tree migration collectSection now runs, not just
    // the moved subtree.
    const LOSSY_MOVE_CONTENT = {
      components: [
        { type: "QuestionHeadline", question_id: "h1", props: { text: "Are you insured?" } },
        { type: "LogoStrip", question_id: "logos1", props: { logos: ["a.png", "b.png"] } },
        {
          type: "BackgroundPanel",
          question_id: "bg1",
          props: { gradient: "primary", imageMediaId: "media_bg_7" },
          children: [
            { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
          ],
        },
        { type: "ContinueButton", question_id: "c1", props: { label: "Continue" } },
      ],
    };
    const section = await createSection(env, { content_json: JSON.stringify(LOSSY_MOVE_CONTENT) });
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const sliceMoveFns = [
      "function markDirty() { dirty = true; }",
      "function selectComponent() {}",
      "function showMoveNote() {}",
      "var selectedQuestionId = null;",
      sliceIslandFunction(island, "usageFunnelsOf"),
      sliceIslandFunction(island, "moveConfirmMessage"),
      sliceIslandFunction(island, "equivalentFrameGroup"),
      sliceIslandFunction(island, "mergeFrameGroups"),
      sliceIslandFunction(island, "removeMovedFrameNode"),
      sliceIslandLine(island, "var LOSSY_LOGOSTRIP_SAVE_CONFIRM"),
      sliceIslandFunction(island, "contentHasRetiredLogoStrip"),
      sliceIslandFunction(island, "confirmSaveMigrationLoss"),
      sliceIslandFunction(island, "finishMoveToFrame"),
      sliceIslandFunction(island, "doMoveToFrame"),
      sliceIslandFunction(island, "renderFunnelPicker"),
      sliceIslandFunction(island, "funnelPickBtn"),
      sliceIslandFunction(island, "startMoveToFrame"),
    ].join("\n");

    // ---- DECLINE: accept the move-confirm, DECLINE the lossy-confirm ----
    const confirmsDecline: string[] = [];
    const fetchesDecline: string[] = [];
    const probeDecline = studioProbe(html, LOSSY_MOVE_CONTENT);
    probeDecline.sandbox["window"] = {
      confirm(msg: string) {
        confirmsDecline.push(msg);
        return confirmsDecline.length === 1; // 1st (move) = accept, 2nd (lossy) = decline
      },
    };
    probeDecline.sandbox["dirty"] = false;
    (probeDecline.sandbox.state as Record<string, unknown>)["public_id"] = section.public_id;
    probeDecline.sandbox["usageRows"] = [
      { quote_public_id: quote.public_id, funnel_public_id: funnel.public_id, funnel_name: funnel.funnel_name, variant_public_id: "lgn_x" },
    ];
    probeDecline.sandbox["fetch"] = (url: string, init?: RequestInit): Promise<Response> => {
      fetchesDecline.push(`${init?.method ?? "GET"} ${url}`);
      return Promise.resolve(admin.request(url, init ?? {}, env));
    };
    probeDecline.run(sliceMoveFns);
    probeDecline.run("startMoveToFrame('bg1')");
    await new Promise((r) => setTimeout(r, 50));
    expect(confirmsDecline, "move-confirm then lossy-confirm, both shown").toHaveLength(2);
    expect(confirmsDecline[1]).toContain("retired Logo strip");
    expect(fetchesDecline, "declining the lossy confirm aborts BEFORE any write (no frame GET/PUT, no content PATCH)").toEqual([]);
    expect(
      probeDecline.run("state.content.components.some(function (n) { return n.type === 'LogoStrip'; })"),
      "content untouched — the LogoStrip is still unmigrated",
    ).toBe(true);

    // ---- ACCEPT: both confirms accepted — the move AND the whole-tree save migration proceed ----
    const confirmsAccept: string[] = [];
    const fetchesAccept: string[] = [];
    const probeAccept = studioProbe(html, LOSSY_MOVE_CONTENT);
    probeAccept.sandbox["window"] = {
      confirm(msg: string) {
        confirmsAccept.push(msg);
        return true;
      },
    };
    probeAccept.sandbox["dirty"] = false;
    (probeAccept.sandbox.state as Record<string, unknown>)["public_id"] = section.public_id;
    probeAccept.sandbox["usageRows"] = [
      { quote_public_id: quote.public_id, funnel_public_id: funnel.public_id, funnel_name: funnel.funnel_name, variant_public_id: "lgn_x" },
    ];
    probeAccept.sandbox["fetch"] = (url: string, init?: RequestInit): Promise<Response> => {
      fetchesAccept.push(`${init?.method ?? "GET"} ${url}`);
      return Promise.resolve(admin.request(url, init ?? {}, env));
    };
    probeAccept.run(sliceMoveFns);
    probeAccept.run("startMoveToFrame('bg1')");
    for (let i = 0; i < 200 && fetchesAccept.length < 3; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(confirmsAccept).toHaveLength(2);
    expect(fetchesAccept).toEqual([
      `GET /api/admin/leadgen/funnels/${funnel.public_id}/frame`,
      `PUT /api/admin/leadgen/funnels/${funnel.public_id}/frame`,
      `PATCH /api/admin/leadgen/sections/${section.public_id}`,
    ]);
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as Record<string, unknown>;
    const savedContent = saved["content_json"] as { components: Array<Record<string, unknown>> };
    const migratedLogo = savedContent.components.find((n) => n["question_id"] === "logos1");
    expect(migratedLogo?.["type"], "the STRAY LogoStrip elsewhere in the tree migrates too — collectSection runs on the whole tree (E2-NEW-4)").toBe("ImageBlock");
    expect(migratedLogo?.["props"]).toMatchObject({ source: "auto_logo" });
    expect((migratedLogo?.["props"] as Record<string, unknown>)?.["logos"], "its logos are dropped (lossy)").toBeUndefined();
  });

  it("used-by-many: a funnel PICKER opens (no confirm yet); zero funnels: a refusal names the Quote Builder", async () => {
    const { env } = newHarness();
    const section = await createSection(env, { content_json: JSON.stringify(FRAME_NODE_CONTENT) });
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const confirms: string[] = [];
    const badge = stubEl("div") as StubEl & { querySelector(sel: string): StubEl | null };
    badge.querySelector = (sel: string): StubEl | null =>
      sel === "[data-funnel-picker]" ? (badge.children.find((c) => c.getAttribute("data-funnel-picker") !== null) ?? null) : null;
    // DEV-66: the badge is a canvas decoration — renderFunnelPicker resolves
    // it through the frame document's region, so the stub models the iframe.
    const region = stubEl("div") as StubEl & { querySelector(sel: string): StubEl | null };
    region.querySelector = (sel: string): StubEl | null => (sel === '[data-frame-badge="q_hb"]' ? badge : null);
    const frame = {
      contentDocument: {
        getElementById(id: string) {
          return id === "lg-studio-canvas-render" ? region : null;
        },
      },
    };
    const probe = studioProbe(html, FRAME_NODE_CONTENT, {
      createElement(tag: string) {
        return stubEl(tag);
      },
      createTextNode(text: string) {
        return stubEl("#text", text);
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      getElementById(id: string) {
        return id === "lg-studio-canvas-frame" ? frame : null;
      },
    });
    probe.sandbox["window"] = {
      confirm(msg: string) {
        confirms.push(msg);
        return true;
      },
    };
    probe.run(
      [
        "var usageRows = [" +
          "{ funnel_public_id: 'lgf_one', funnel_name: 'Funnel One' }," +
          "{ funnel_public_id: 'lgf_two', funnel_name: 'Funnel Two' }" +
          "];",
        sliceIslandFunction(island, "usageFunnelsOf"),
        sliceIslandFunction(island, "moveConfirmMessage"),
        "function doMoveToFrame(qid, funnel) { moved.push(funnel.public_id); }",
        "var moved = [];",
        sliceIslandFunction(island, "canvasFrameEl"),
        sliceIslandFunction(island, "canvasFrameDoc"),
        sliceIslandFunction(island, "canvasRegion"),
        sliceIslandFunction(island, "renderFunnelPicker"),
        sliceIslandFunction(island, "funnelPickBtn"),
        sliceIslandFunction(island, "startMoveToFrame"),
      ].join("\n"),
    );
    probe.run("startMoveToFrame('q_hb')");
    // no confirm — the PICKER renders instead, one button per funnel
    expect(confirms).toHaveLength(0);
    const picker = badge.children.find((c) => c.getAttribute("data-funnel-picker") !== null)!;
    expect(picker).toBeDefined();
    const picks = picker.children.filter((c) => c.getAttribute("data-funnel-pick") !== null);
    expect(picks.map((c) => c.getAttribute("data-funnel-pick"))).toEqual(["lgf_one", "lgf_two"]);
    // picking one routes into the confirm-gated move
    picks[1]!.click();
    expect(probe.run("moved")).toEqual(["lgf_two"]);
    // zero funnels → refusal, Quote Builder named
    probe.run("usageRows = [];");
    probe.run("startMoveToFrame('q_hb')");
    const refusals = probe.sandbox.refusals;
    expect(refusals[refusals.length - 1]).toContain("Quote Builder");
  });
});

describeDb("wave 2 — §5.5 choice depth + §6.2 inline editing + §7.3 raw JSON", () => {
  it("each §5.5 editor writes the model (title/subtitle/badge/emoji/aria_label/disabled) and persists via the REAL PATCH", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const GRID = {
      components: [
        {
          type: "ImageCardAnswerGrid",
          question_id: "g1",
          internal_field: "carrier",
          choices: [{ label: "Acme", value: "acme", analytics_id: "acme", imageMediaId: "media_a", image_alt: "Acme" }],
        },
      ],
    };
    // DOM stub: ONE row whose depth inputs carry every §5.5 field
    const rowFields: Record<string, string> = {
      label: "Acme",
      value: "acme",
      analytics_id: "acme_card",
      title: "Acme Insurance",
      subtitle: "Best rated",
      badge: "Recommended",
      emoji: "",
      icon: "",
      imageMediaId: "media_a",
      image_alt: "Acme logo",
      aria_label: "Choose Acme",
      description: "",
    };
    const row = {
      querySelectorAll(sel: string) {
        return sel === "[data-choice-field]"
          ? Object.entries(rowFields).map(([f, v]) => ({ getAttribute: () => f, value: v }))
          : [];
      },
      querySelector(sel: string) {
        if (sel === "[data-choice-main]") return { checked: false };
        if (sel === "[data-choice-disabled]") return { checked: true };
        return null;
      },
    };
    const container = {
      querySelectorAll(sel: string) {
        return sel === "[data-choice-row]" ? [row] : [];
      },
    };
    const docStub = {
      getElementById() {
        return null;
      },
      querySelector(sel: string) {
        return sel === "[data-inspector-choices]" ? container : null;
      },
      querySelectorAll() {
        return [];
      },
    };
    const probe = studioProbe(html, GRID, docStub as unknown as Record<string, unknown>);
    probe.run(
      [
        sliceIslandFunction(island, "choiceContainer"),
        sliceIslandFunction(island, "collectChoices"),
      ].join("\n"),
    );
    probe.sandbox.selectedQuestionId = "g1";
    probe.run("collectChoices()");
    const node = probe.run("findRef('g1').node") as { choices: Array<Record<string, unknown>> };
    expect(node.choices[0]).toEqual({
      label: "Acme",
      value: "acme",
      analytics_id: "acme_card",
      title: "Acme Insurance",
      subtitle: "Best rated",
      badge: "Recommended",
      imageMediaId: "media_a",
      image_alt: "Acme logo",
      aria_label: "Choose Acme",
      disabled: true,
    });
    // the mutated model is server-valid AND PATCHes for real
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: JSON.stringify(probe.sandbox.state.content) }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as Record<string, unknown>;
    const savedChoice = (saved["content_json"] as { components: Array<{ choices: Array<Record<string, unknown>> }> }).components[0]!.choices[0]!;
    expect(savedChoice).toMatchObject({ title: "Acme Insurance", subtitle: "Best rated", badge: "Recommended", disabled: true, aria_label: "Choose Acme" });
    // the row grid ships the media PICKER cell + the §5.5 idiom markers
    expect(island).toContain("data-choice-media-choose");
    // R3a (S2-5d): the image cell's Choose… now shows a live THUMBNAIL next to
    // the picker, so onpick must do more than re-collect the choice — it
    // refreshes the thumb <img> from the newly-picked value FIRST, so the
    // preview never lags one pick behind.
    expect(island).toContain(
      "openMediaPicker({ input: input, onpick: function () { setChoiceThumb(thumb, input.value); collectChoices(); } });",
    );
  });

  it("bulk paste accepts the §5.5 'label = value' idiom (legacy 'label|value' kept); the searchable toggle SWITCHES the dropdown type; the range note gates to sliders", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    expect(html).toContain("Bulk paste (one per line: label = value)");
    const probe = studioProbe(html, {
      components: [{ type: "DropdownQuestion", question_id: "d1", internal_field: "make", choices: [{ label: "A", value: "a", analytics_id: "a" }] }],
    });
    const parsed = probe.run(
      "parseBulkChoices('Toyota = toyota\\nHonda|honda\\nMazda', {})",
    ) as Array<Record<string, unknown>>;
    expect(parsed).toEqual([
      { label: "Toyota", value: "toyota", analytics_id: "toyota" },
      { label: "Honda", value: "honda", analytics_id: "honda" },
      { label: "Mazda", value: "mazda", analytics_id: "mazda" },
    ]);
    // §5.5: the searchable toggle is a pure TYPE swap (round-trip)
    probe.run(["function updateCanvasToolbar() {}", sliceIslandFunction(island, "toggleSearchableDropdown")].join("\n"));
    expect(probe.run("toggleSearchableDropdown(findRef('d1').node)")).toBe(true);
    expect(probe.run("findRef('d1').node.type")).toBe("SearchableDropdownQuestion");
    expect(probe.run("toggleSearchableDropdown(findRef('d1').node)")).toBe(true);
    expect(probe.run("findRef('d1').node.type")).toBe("DropdownQuestion");
    expect(validateSectionContent(probe.sandbox.state.content).errors).toEqual([]);
    // §5.5 range provider-format note ships + gates island-side
    expect(html).toContain("data-range-format-note");
    expect(html).toContain("Provider output format is set per Offer in the Offers tab");
    expect(island).toContain("node.type !== 'NumberRangeQuestion'"); // §10: the ONE slider type gates the range note
  });

  it("v3.1 §5.6 EXECUTED: Cards style (Icon/Image/Plain) + the Accept-swap rule round-trip preserving internal_field/choices, SEEDING what the new type requires; §6.8 slider type/currency are PROPS (never a node.type flip)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, {
      components: [
        { type: "IconCardAnswerGrid", question_id: "c1", internal_field: "make", choices: [{ label: "Toyota", value: "toyota", analytics_id: "toyota", icon: "car" }] },
        { type: "NumberRangeQuestion", question_id: "s1", internal_field: "loan_amount", props: { min: 0, max: 100 } },
        { type: "ZIPInputQuestion", question_id: "z1", internal_field: "zip", props: { placeholder: "ZIP", label: "ZIP code" } },
      ],
    });
    probe.run(
      [
        "function updateCanvasToolbar() {}",
        sliceIslandVar(island, "CARD_STYLE_TYPES"),
        sliceIslandVar(island, "ACCEPT_FORMAT_TYPE"),
        sliceIslandVar(island, "ACCEPT_TYPE_FORMAT"),
        sliceIslandArray(island, "CARD_STYLE_FAMILY"),
        sliceIslandFunction(island, "cardStyleOf"),
        sliceIslandFunction(island, "setCardStyle"),
        // setCardStyle now seeds the fields the NEW type requires — the helper has
        // to be in the sandbox or the sliced caller throws (it is in the same IIFE
        // in the shipped island; this file's slice list is the harness, not the
        // product).
        sliceIslandFunction(island, "seedChoiceRequirements"),
        sliceIslandFunction(island, "typeMeta"),
        sliceIslandFunction(island, "trimStr"),
        sliceIslandFunction(island, "acceptFormatOfNode"),
        sliceIslandFunction(island, "setAcceptFormat"),
      ].join("\n"),
    );
    // §5.6 Cards: Icon -> Image -> Plain -> back to Icon; choices survive.
    expect(probe.run("cardStyleOf(findRef('c1').node)")).toBe("icon");
    expect(probe.run("setCardStyle(findRef('c1').node, 'image')")).toBe(true);
    expect(probe.run("findRef('c1').node.type")).toBe("ImageCardAnswerGrid");
    expect(probe.run("setCardStyle(findRef('c1').node, 'plain')")).toBe(true);
    expect(probe.run("findRef('c1').node.type")).toBe("ButtonAnswerGroup");
    expect(probe.run("findRef('c1').node.choices[0].label")).toBe("Toyota"); // never dropped
    expect(probe.run("setCardStyle(findRef('c1').node, 'icon')")).toBe(true);
    expect(probe.run("findRef('c1').node.type")).toBe("IconCardAnswerGrid");
    // ADDED 2026-08-11 (owner approved): the swap SEEDS what the new type requires.
    // Before this, "Cards → Image" retyped the node and left every choice without
    // an image, so content-schema refused the whole Section ("Every answer on the
    // Image answer cards needs an image") — the grid was UNSAVEABLE the moment the
    // operator picked the Image style, measured in the studio. The seed is the
    // not-picked-yet ref, which presets.ts paints as a labelled "Image" slot; the
    // operator's own values are never overwritten.
    expect(probe.run("setCardStyle(findRef('c1').node, 'image')")).toBe(true);
    expect(probe.run("findRef('c1').node.choices[0].imageMediaId")).toBe("__pending__");
    expect(probe.run("findRef('c1').node.choices[0].image_alt")).toBe("Toyota");
    expect(probe.run("findRef('c1').node.choices[0].label")).toBe("Toyota");
    // …and an authored image is left alone on a later swap through the family
    probe.run("findRef('c1').node.choices[0].imageMediaId = '2026/08/10/real.png'");
    probe.run("setCardStyle(findRef('c1').node, 'icon')");
    probe.run("setCardStyle(findRef('c1').node, 'image')");
    expect(probe.run("findRef('c1').node.choices[0].imageMediaId")).toBe("2026/08/10/real.png");
    // leave the node back on `icon` so the same-style no-op assertions below still
    // describe what they say they do
    expect(probe.run("setCardStyle(findRef('c1').node, 'icon')")).toBe(true);
    expect(probe.run("findRef('c1').node.type")).toBe("IconCardAnswerGrid");
    // a same-style set is a documented no-op (not a spurious history entry)
    expect(probe.run("setCardStyle(findRef('c1').node, 'icon')")).toBe(false);
    // non-card-family node is never swapped by this control
    expect(probe.run("setCardStyle(findRef('s1').node, 'icon')")).toBe(false);

    // §6.8 Slider: the Format-$ TYPE flip (toggleSliderFormat) is REMOVED — the
    // slider TYPE + currency affix are PROPS on the ONE NumberRangeQuestion
    // (never a node.type flip; the eliminated Image9 answer_type_mismatch class).
    probe.run("function populateInspector() {}");
    probe.run(
      [
        sliceIslandFunction(island, "capsOf"),
        sliceIslandFunction(island, "cap"),
        sliceIslandFunction(island, "setSliderType"),
        sliceIslandFunction(island, "setCurrencyAffix"),
      ].join("\n"),
    );
    probe.sandbox.selectedQuestionId = "s1";
    probe.run("setSliderType('dual_range')");
    expect(probe.run("findRef('s1').node.type")).toBe("NumberRangeQuestion"); // type NEVER flips
    expect(probe.run("findRef('s1').node.props.slider_type")).toBe("dual_range");
    expect(probe.run("findRef('s1').node.props.max")).toBe(100); // props survive
    probe.run("setCurrencyAffix(true)");
    expect(probe.run("findRef('s1').node.props.currency_affix")).toBe(true);
    expect(probe.run("findRef('s1').node.type")).toBe("NumberRangeQuestion");
    // 'single' is the implicit default — clears the key, type stays put
    probe.run("setSliderType('single')");
    expect(probe.run("findRef('s1').node.props.slider_type")).toBeUndefined();

    // §5.6 the Accept-swap rule: every one of the 8 values round-trips
    // through setAcceptFormat, writing BOTH the concrete type AND
    // props.format (§11.3 worked example shape), preserving label/placeholder.
    expect(probe.run("acceptFormatOfNode(findRef('z1').node)")).toBe("us_zip");
    expect(probe.run("setAcceptFormat(findRef('z1').node, 'email')")).toBe(true);
    expect(probe.run("findRef('z1').node.type")).toBe("EmailInputQuestion");
    expect(probe.run("findRef('z1').node.props.format")).toBe("email");
    expect(probe.run("findRef('z1').node.props.label")).toBe("ZIP code"); // shared props survive
    expect(probe.run("setAcceptFormat(findRef('z1').node, 'us_zip')")).toBe(true);
    expect(probe.run("findRef('z1').node.type")).toBe("ZIPInputQuestion");
    expect(probe.run("findRef('z1').node.props.format")).toBe("us_zip");
    expect(probe.run("acceptFormatOfNode(findRef('c1').node)")).toBe(null); // not an Accept-family type
    expect(probe.run("setAcceptFormat(findRef('c1').node, 'text')")).toBe(false);
    // the mutated model stays valid against the REAL server validator
    expect(validateSectionContent(probe.sandbox.state.content as never).errors).toEqual([]);
  });

  // R5 D3 (register S4-A3 migration): Card-style / Slider-format MOVED from
  // the canvas toolbar into the Content tab's "Answer format" section (same
  // attribute names — data-toolbar-card-style-wrap/data-card-style/
  // data-toolbar-slider-format-wrap/data-toolbar-slider-format are kept
  // verbatim, only their SSR location changed); the Accept dropdown's
  // TOOLBAR copy (data-toolbar-accept-wrap/#lg-tb-accept) was a pure
  // duplicate of the Content tab's PRE-EXISTING #lg-inspector-accept and is
  // REMOVED (not migrated — nothing to migrate).
  it("v3.1 §5.6 SSR: the Content tab hosts the Card-style segmented, the §6.8 Slider type picker (Format-$ toggle removed), and the Accept dropdown with the exact 8-option enumeration", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toContain("data-toolbar-card-style-wrap");
    for (const style of ["icon", "image", "plain"]) expect(html).toContain(`data-card-style="${style}"`);
    // Rework §6.8/§10: the Format-$ type-flip toggle is REPLACED by the slider
    // type picker (single/dual_range/stepper/from_to/radial) + currency affix.
    expect(html).not.toContain("data-toolbar-slider-format");
    expect(html).toContain("data-slider-type-wrap");
    for (const t of ["single", "dual_range", "stepper", "from_to", "radial"]) expect(html).toContain(`data-set-slider-type="${t}"`);
    expect(html).toContain("data-slider-currency-affix");
    // the toolbar's OWN accept copy is gone
    expect(html).not.toContain("data-toolbar-accept-wrap");
    expect(html).not.toContain('id="lg-tb-accept"');
    expect(html).toMatch(/<select id="lg-inspector-accept"[^>]*data-inspector-accept/);
    // the exact §8.5b Accept enumeration, in order, none other
    const acceptBlockStart = html.indexOf('id="lg-inspector-accept"');
    const acceptBlockEnd = html.indexOf("</select>", acceptBlockStart);
    const acceptBlock = html.slice(acceptBlockStart, acceptBlockEnd);
    expect(
      [...acceptBlock.matchAll(/<option value="[^"]+">([^<]+)<\/option>/g)].map((m) => m[1]),
    ).toEqual(["Any text", "Number", "Amount ($)", "Email", "Phone", "ZIP code (5 digits)", "Date", "Street address"]);
  });

  it("§6.2 inline editing: dblclick commit writes the BOUND strip store / props.text / choice labels; Advanced raw JSON is read-only until the Edit-raw confirm", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // SSR: the raw textarea ships readonly; Apply hides behind Edit raw…
    expect(html).toMatch(/<textarea id="lg-node-json"[^>]*readonly>/);
    expect(html).toMatch(/<button[^>]*id="lg-node-json-apply" hidden>/);
    expect(html).toContain("data-node-json-edit");
    // island: dblclick wiring + per-selection re-lock. DEV-66: the delegation
    // is a NAMED handler bound on BOTH roots — the parent surface AND (per
    // load) the canvas frame's contentDocument, where every node now lives.
    expect(island).toContain("function onCanvasDblClick(ev) {");
    expect(island).toContain("target.addEventListener('dblclick', onCanvasDblClick);");
    expect(island).toContain("if (canvasSurface) { bindCanvasSurface(canvasSurface); }");
    expect(island).toContain("bindCanvasSurface(doc);");
    expect(island).toContain("frame.addEventListener('load', bindCanvasFrameDoc);");
    expect(island).toContain("el.setAttribute('contenteditable', 'true');");
    expect(island).toContain("rawEditArmed = false;\n    syncRawJsonMode();");
    const strip = { value: "Old headline" };
    const mirror = { value: "" };
    const docStub = {
      getElementById(id: string) {
        return id === "lg-section-headline" ? strip : null;
      },
      // v3.1 §8.4: the Content tab's headline variant carries TWO
      // data-bound-shared-input elements (headline/subheadline) — the
      // mirror lookup is now value-specific, not a bare-attribute match.
      querySelector(sel: string) {
        return sel === '[data-bound-shared-input="section_headline"]' ? mirror : null;
      },
      querySelectorAll() {
        return [];
      },
    };
    const probe = studioProbe(html, BOUND_SEED_CONTENT, docStub as unknown as Record<string, unknown>);
    probe.run(
      [
        "var dirtyFlags = []; function markDirty() { dirtyFlags.push(1); }",
        "function scheduleCanvasRender() {}",
        sliceIslandFunction(island, "findChoice"),
        sliceIslandFunction(island, "inlineEditKeyFor"),
        sliceIslandFunction(island, "commitInlineText"),
        sliceIslandFunction(island, "commitInlineChoiceLabel"),
      ].join("\n"),
    );
    // the bound headline resolves to the STRIP store (one store, two views)
    expect(probe.run("inlineEditKeyFor(findRef('q_bh').node)")).toBe("bind");
    expect(probe.run("commitInlineText('q_bh', 'bind', 'Typed on canvas')")).toBe(true);
    expect(strip.value).toBe("Typed on canvas");
    expect(mirror.value).toBe("Typed on canvas"); // inspector mirror synced
    // a plain copy node writes props.text through the model
    probe.run("addComponentAt('HelperText', null, null)");
    const helperQid = probe.run("state.content.components[state.content.components.length - 1].question_id") as string;
    expect(probe.run(`inlineEditKeyFor(findRef(${JSON.stringify(helperQid)}).node)`)).toBe("text");
    probe.run(`commitInlineText(${JSON.stringify(helperQid)}, 'text', 'Helper copy')`);
    expect(probe.run(`findRef(${JSON.stringify(helperQid)}).node.props.text`)).toBe("Helper copy");
    // a choice card edits ITS label
    expect(probe.run("commitInlineChoiceLabel('q1', 'x', 'nope')")).toBe(false); // TwoButtonYesNo has no choices
    probe.run("addComponentAt('IconCardAnswerGrid', null, null)");
    const gridQid = probe.run("state.content.components[state.content.components.length - 1].question_id") as string;
    const firstValue = probe.run(`findRef(${JSON.stringify(gridQid)}).node.choices[0].value`) as string;
    expect(probe.run(`commitInlineChoiceLabel(${JSON.stringify(gridQid)}, ${JSON.stringify(firstValue)}, 'Renamed card')`)).toBe(true);
    expect(probe.run(`findRef(${JSON.stringify(gridQid)}).node.choices[0].label`)).toBe("Renamed card");
    // §6.2: width-preset snapping is pure and bounded
    probe.run(sliceIslandArray(island, "WIDTH_PRESETS"));
    probe.run(sliceIslandFunction(island, "snapWidthPreset"));
    expect(probe.run("snapWidthPreset('m', 90)")).toBe("l");
    expect(probe.run("snapWidthPreset('m', 200)")).toBe("full");
    expect(probe.run("snapWidthPreset('m', -90)")).toBe("s");
    expect(probe.run("snapWidthPreset('s', -400)")).toBe("s");
    // raw-JSON arming: confirm gates the unlock; decline keeps it read-only
    const ta = stubEl("textarea");
    ta.setAttribute("readonly", "readonly");
    const applyBtn = stubEl("button");
    applyBtn.hidden = true;
    const editBtn = stubEl("button");
    let confirmAnswer = false;
    const probe2 = studioProbe(html, YESNO_CONTENT, {
      getElementById(id: string) {
        if (id === "lg-node-json") return ta;
        if (id === "lg-node-json-apply") return applyBtn;
        if (id === "lg-node-json-edit") return editBtn;
        return null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
    } as unknown as Record<string, unknown>);
    probe2.sandbox["window"] = { confirm: () => confirmAnswer };
    probe2.run(
      [
        "var rawEditArmed = false;",
        sliceIslandFunction(island, "syncRawJsonMode"),
        sliceIslandFunction(island, "armRawEdit"),
      ].join("\n"),
    );
    expect(probe2.run("armRawEdit()")).toBe(false); // declined confirm
    expect(ta.getAttribute("readonly")).not.toBe(null);
    expect(applyBtn.hidden).toBe(true);
    confirmAnswer = true;
    expect(probe2.run("armRawEdit()")).toBe(true);
    expect(ta.getAttribute("readonly")).toBe(null);
    expect(applyBtn.hidden).toBe(false);
    expect(editBtn.hidden).toBe(true);
  });

  it("v3.1 §6.2/§7 EXECUTED: default selection = first real answer node (skips bound copy); selectionChromeKind classifies field/headline/continue/container; width snap+clamp is pure and bounded [200,600]/4px", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const FIXTURE = {
      components: [
        { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
        { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", props: { placeholder: "ZIP" } },
        { type: "ContinueButton", question_id: "q_go" },
        { type: "CardPanel", question_id: "q_card", children: [] },
      ],
    };
    const probe = studioProbe(html, FIXTURE);
    probe.run(
      [
        sliceIslandLine(island, "var WIDTH_PX_MIN"),
        sliceIslandFunction(island, "findDefaultSelectionId"),
        sliceIslandFunction(island, "selectionChromeKind"),
        sliceIslandFunction(island, "currentCustomWidthPx"),
        sliceIslandFunction(island, "snapWidthCustomPx"),
      ].join("\n"),
    );
    // §6.2 default selection: the FIRST node with produces !== null and no
    // bind — the ZIP field, NOT the bound headline (generalizes the
    // fixture's "default = the ZIP field" beyond this one hardcoded type).
    expect(probe.run("findDefaultSelectionId()")).toBe("q_zip");
    // §6.2 chrome-kind classification — the 3 golden variants + null (no
    // golden-specific chrome; containers keep their PRE-EXISTING
    // .studio-resize-handle mechanism untouched).
    expect(probe.run(`selectionChromeKind(findRef('q_head').node)`)).toBe("headline");
    expect(probe.run(`selectionChromeKind(findRef('q_zip').node)`)).toBe("field");
    expect(probe.run(`selectionChromeKind(findRef('q_go').node)`)).toBe("continue");
    expect(probe.run(`selectionChromeKind(findRef('q_card').node)`)).toBe(null);
    // §7.1.3 measurement formula: snapped to a 4px grid, clamped [200,600].
    expect(probe.run("snapWidthCustomPx(383)")).toBe(384); // snaps to nearest 4
    expect(probe.run("snapWidthCustomPx(50)")).toBe(200); // clamped to the floor
    expect(probe.run("snapWidthCustomPx(9000)")).toBe(600); // clamped to the ceiling
    expect(probe.run("snapWidthCustomPx(602)")).toBe(600); // 604 snaps then clamps
    // currentCustomWidthPx reads back exactly what was written — never a fake
    expect(probe.run(`currentCustomWidthPx(findRef('q_zip').node)`)).toBe(null);
    probe.run(`findRef('q_zip').node.design_overrides = { size: { width: { custom_px: 344 } } }`);
    expect(probe.run(`currentCustomWidthPx(findRef('q_zip').node)`)).toBe(344);
  });

  it("v3.1 §7 EXECUTED: dragging a width handle writes node.design_overrides.size.width.custom_px through the SAME afterModelChange path as every other mutation (one history entry, canvas re-render scheduled)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const FIXTURE = { components: [{ type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip" }] };
    // a minimal DOM stub: the handle's wrapper hosts a getBoundingClientRect
    // (the "measured content-box width" §7.1.3 requires) + the target input.
    const target = { getBoundingClientRect: () => ({ width: 300 }) };
    const wrap = {
      querySelector: (sel: string) => (sel.includes('data-question-id="q_zip"') ? target : null),
    };
    const handle = {
      getAttribute(name: string): string | null {
        if (name === "data-width-handle") return "q_zip";
        if (name === "data-handle-side") return "right";
        return null;
      },
      parentNode: wrap,
      ownerDocument: null as unknown,
      closest: () => handle,
    };
    let historyPushed = 0;
    let canvasScheduled = 0;
    const probe = studioProbe(html, FIXTURE, {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
    });
    probe.sandbox["afterModelChange"] = () => {
      historyPushed += 1;
      canvasScheduled += 1;
    };
    // simulate the mouseup 84px to the right (dragging the RIGHT handle
    // widens: 300 + 84 = 384, already grid-aligned). finishUp is a closure
    // inside onWidthHandleMouseDown — captured via a synthetic
    // document.addEventListener('mouseup', ...) stub, then invoked directly
    // (deterministic, no real timers/events needed).
    let capturedUp: ((ev: unknown) => void) | null = null;
    let capturedMove: ((ev: unknown) => void) | null = null;
    probe.sandbox["document"] = {
      addEventListener: (name: string, fn: (ev: unknown) => void) => {
        if (name === "mouseup") capturedUp = fn;
        if (name === "mousemove") capturedMove = fn;
      },
      removeEventListener: () => {},
    };
    // Stub objects carry FUNCTION properties (getAttribute/closest/etc.) —
    // they must ride the sandbox by reference, never JSON.stringify (which
    // silently drops every function, the bug this comment replaced).
    probe.sandbox["mouseDownStub"] = { target: handle, clientX: 100, preventDefault: () => {}, stopPropagation: () => {} };
    probe.run(
      [
        sliceIslandLine(island, "var WIDTH_PX_MIN"),
        sliceIslandFunction(island, "snapWidthCustomPx"),
        "function canvasFrameDoc() { return null; }",
        "function canvasFrameEl() { return null; }",
        sliceIslandLine(island, "var activeWidthDragCleanup"),
        sliceIslandFunction(island, "onWidthHandleMouseDown"),
      ].join("\n"),
    );
    probe.run("onWidthHandleMouseDown(mouseDownStub)");
    expect(capturedUp).toBeTruthy();
    expect(capturedMove).toBeTruthy();
    // the moved gate (adversarial re-review, m3(a-2)) requires an ACTUAL
    // mousemove between mousedown and mouseup — a real drag, not just a
    // mousedown+mouseup with the pointer never having moved.
    (capturedMove as unknown as (ev: unknown) => void)({ clientX: 140 });
    (capturedUp as unknown as (ev: unknown) => void)({ clientX: 184 }); // +84px
    expect(probe.run(`findRef('q_zip').node.design_overrides.size.width`)).toEqual({ custom_px: 384 });
    expect(historyPushed).toBeGreaterThan(0);
    expect(canvasScheduled).toBeGreaterThan(0);
  });

  it("m3(a) (adversarial review): a width-drag whose mouseup is never delivered can't later write bogus custom_px through a STALE listener — a new drag tears the old pair down first", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const FIXTURE = { components: [{ type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip" }] };
    const target = { getBoundingClientRect: () => ({ width: 300 }), setAttribute: () => {} };
    const wrap = { querySelector: (sel: string) => (sel.includes('data-question-id="q_zip"') ? target : null) };
    function makeHandle(): { getAttribute(name: string): string | null; parentNode: unknown; ownerDocument: unknown; closest(): unknown } {
      const h = {
        getAttribute(name: string) {
          if (name === "data-width-handle") return "q_zip";
          if (name === "data-handle-side") return "right";
          return null;
        },
        parentNode: wrap,
        ownerDocument: null as unknown,
        closest: () => h,
      };
      return h;
    }
    // a REAL registry (not a single capture slot): removeEventListener must
    // actually unregister, so a stale handler genuinely cannot fire again —
    // proving the FIX via registry SIZE (last-write-wins would otherwise
    // mask the bug: if A's stale handler fired alongside B's on the SAME
    // dispatch, B's write happens last either way and the final value looks
    // identical whether or not A leaked — the registry count is what
    // actually discriminates fixed vs buggy).
    type Handler = (ev: unknown) => void;
    function makeEventTarget() {
      const handlers: Record<string, Handler[]> = {};
      return {
        addEventListener(name: string, fn: Handler) {
          (handlers[name] = handlers[name] ?? []).push(fn);
        },
        removeEventListener(name: string, fn: Handler) {
          const arr = handlers[name] ?? [];
          const at = arr.indexOf(fn);
          if (at >= 0) arr.splice(at, 1);
        },
        dispatch(name: string, ev: unknown) {
          for (const fn of (handlers[name] ?? []).slice()) fn(ev);
        },
        count(name: string) {
          return (handlers[name] ?? []).length;
        },
      };
    }
    const outerDoc = makeEventTarget();
    const probe = studioProbe(html, FIXTURE, { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] });
    probe.sandbox["afterModelChange"] = () => {};
    probe.sandbox["document"] = outerDoc;
    probe.run(
      [
        sliceIslandLine(island, "var WIDTH_PX_MIN"),
        sliceIslandFunction(island, "snapWidthCustomPx"),
        "function canvasFrameDoc() { return null; }",
        "function canvasFrameEl() { return null; }",
        sliceIslandLine(island, "var activeWidthDragCleanup"),
        sliceIslandFunction(island, "onWidthHandleMouseDown"),
      ].join("\n"),
    );
    // Drag A starts (clientX 100) — mouseup never arrives (simulates the
    // pointer being released outside the browser window entirely).
    probe.sandbox["mouseDownA"] = { target: makeHandle(), clientX: 100, preventDefault: () => {}, stopPropagation: () => {} };
    probe.run("onWidthHandleMouseDown(mouseDownA)");
    expect(outerDoc.count("mouseup"), "A's mouseup listener registered").toBe(1);
    // Drag B starts on the SAME handle before A ever finished (clientX 120)
    // — this must tear down A's still-registered listener before adding B's:
    // the registry count stays at 1, it does NOT grow to 2. This is the
    // assertion that actually distinguishes the fix from the bug.
    probe.sandbox["mouseDownB"] = { target: makeHandle(), clientX: 120, preventDefault: () => {}, stopPropagation: () => {} };
    probe.run("onWidthHandleMouseDown(mouseDownB)");
    expect(outerDoc.count("mouseup"), "A's stale listener was torn down, not accumulated").toBe(1);
    // Drag B is a REAL drag (m3(a-2)'s moved gate requires an actual
    // mousemove before a mouseup commits anything) — completes normally:
    // startWidth 300 + (150-120) = 330, snapped to the nearest 4px grid = 332.
    outerDoc.dispatch("mousemove", { clientX: 135 });
    outerDoc.dispatch("mouseup", { clientX: 150 });
    expect(probe.run(`findRef('q_zip').node.design_overrides.size.width`)).toEqual({ custom_px: 332 });
    expect(outerDoc.count("mouseup"), "B's own listener is gone too after finishing").toBe(0);
  });

  it("m3(a-2) (adversarial re-review): a handle mousedown with NO committed drag can't write bogus custom_px off a LATER, wholly unrelated mouseup — moved gates the write, not just dragActive", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const FIXTURE = { components: [{ type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip" }] };
    const target = { getBoundingClientRect: () => ({ width: 300 }), setAttribute: () => {} };
    const wrap = { querySelector: (sel: string) => (sel.includes('data-question-id="q_zip"') ? target : null) };
    function makeHandle(): { getAttribute(name: string): string | null; parentNode: unknown; ownerDocument: unknown; closest(): unknown } {
      const h = {
        getAttribute(name: string) {
          if (name === "data-width-handle") return "q_zip";
          if (name === "data-handle-side") return "right";
          return null;
        },
        parentNode: wrap,
        ownerDocument: null as unknown,
        closest: () => h,
      };
      return h;
    }
    type Handler = (ev: unknown) => void;
    function makeEventTarget() {
      const handlers: Record<string, Handler[]> = {};
      return {
        addEventListener(name: string, fn: Handler) {
          (handlers[name] = handlers[name] ?? []).push(fn);
        },
        removeEventListener(name: string, fn: Handler) {
          const arr = handlers[name] ?? [];
          const at = arr.indexOf(fn);
          if (at >= 0) arr.splice(at, 1);
        },
        dispatch(name: string, ev: unknown) {
          for (const fn of (handlers[name] ?? []).slice()) fn(ev);
        },
      };
    }
    const outerDoc = makeEventTarget();
    let afterModelChangeCalls = 0;
    const probe = studioProbe(html, FIXTURE, { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] });
    probe.sandbox["afterModelChange"] = () => {
      afterModelChangeCalls += 1;
    };
    probe.sandbox["document"] = outerDoc;
    probe.run(
      [
        sliceIslandLine(island, "var WIDTH_PX_MIN"),
        sliceIslandFunction(island, "snapWidthCustomPx"),
        "function canvasFrameDoc() { return null; }",
        "function canvasFrameEl() { return null; }",
        sliceIslandLine(island, "var activeWidthDragCleanup"),
        sliceIslandFunction(island, "onWidthHandleMouseDown"),
      ].join("\n"),
    );
    // Grab the handle (clientX 100) — NO mousemove ever fires (the pointer
    // is released off-window with zero drag distance, OR the browser simply
    // never delivered a move before the mouseup was lost). Then a WHOLLY
    // UNRELATED mouseup fires later — e.g. the user clicking anywhere else
    // on the page. Reviewer's concrete repro: this would otherwise snap
    // 300 + (250-100) = 450 → 452.
    probe.sandbox["mouseDownStub"] = { target: makeHandle(), clientX: 100, preventDefault: () => {}, stopPropagation: () => {} };
    probe.run("onWidthHandleMouseDown(mouseDownStub)");
    outerDoc.dispatch("mouseup", { clientX: 250 });
    expect(probe.run(`findRef('q_zip').node.design_overrides`), "no width was ever written").toBeUndefined();
    expect(afterModelChangeCalls, "the section was never marked dirty").toBe(0);
  });

  it("Scenario D (adversarial re-review, ship-blocking residual): a REAL drag (mousedown+mousemove, moved=true) whose TERMINAL mouseup is lost off-window can't write bogus custom_px through a later STRAY mouseup, even when a non-handle mousedown intervenes BEFORE any selectComponent/afterModelChange would have torn it down", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const FIXTURE = { components: [{ type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip" }] };
    const target = { getBoundingClientRect: () => ({ width: 300 }), setAttribute: () => {} };
    const wrap = { querySelector: (sel: string) => (sel.includes('data-question-id="q_zip"') ? target : null) };
    function makeHandle(): { getAttribute(name: string): string | null; parentNode: unknown; ownerDocument: unknown; closest(): unknown } {
      const h = {
        getAttribute(name: string) {
          if (name === "data-width-handle") return "q_zip";
          if (name === "data-handle-side") return "right";
          return null;
        },
        parentNode: wrap,
        ownerDocument: null as unknown,
        closest: () => h,
      };
      return h;
    }
    // a non-handle target: .closest('[data-width-handle]') returns null, so
    // onOtherMouseDown must NOT skip it (unlike a fresh handle mousedown).
    const nonHandleTarget = { closest: () => null };
    type Handler = (ev: unknown) => void;
    function makeEventTarget() {
      const handlers: Record<string, Handler[]> = {};
      return {
        addEventListener(name: string, fn: Handler) {
          (handlers[name] = handlers[name] ?? []).push(fn);
        },
        removeEventListener(name: string, fn: Handler) {
          const arr = handlers[name] ?? [];
          const at = arr.indexOf(fn);
          if (at >= 0) arr.splice(at, 1);
        },
        dispatch(name: string, ev: unknown) {
          for (const fn of (handlers[name] ?? []).slice()) fn(ev);
        },
        count(name: string) {
          return (handlers[name] ?? []).length;
        },
      };
    }
    const outerDoc = makeEventTarget();
    let afterModelChangeCalls = 0;
    const probe = studioProbe(html, FIXTURE, { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] });
    probe.sandbox["afterModelChange"] = () => {
      afterModelChangeCalls += 1;
    };
    probe.sandbox["document"] = outerDoc;
    probe.run(
      [
        sliceIslandLine(island, "var WIDTH_PX_MIN"),
        sliceIslandFunction(island, "snapWidthCustomPx"),
        "function canvasFrameDoc() { return null; }",
        "function canvasFrameEl() { return null; }",
        sliceIslandLine(island, "var activeWidthDragCleanup"),
        sliceIslandFunction(island, "onWidthHandleMouseDown"),
      ].join("\n"),
    );
    // 1) grab the handle (clientX 100).
    probe.sandbox["mouseDownStub"] = { target: makeHandle(), clientX: 100, preventDefault: () => {}, stopPropagation: () => {} };
    probe.run("onWidthHandleMouseDown(mouseDownStub)");
    expect(outerDoc.count("mousedown"), "the teardown-on-other-mousedown listener registered").toBe(1);
    // 2) a REAL mousemove — this IS a committed drag (moved=true).
    outerDoc.dispatch("mousemove", { clientX: 150 });
    // 3) the TERMINAL mouseup is LOST — never dispatched at all (pointer
    // released off-window). The stale mouseup/mousemove/mousedown listeners
    // all remain registered.
    // 4) a non-handle mousedown elsewhere (a library tile / top-bar chrome,
    // reachable BEFORE that interaction's own click ever fires
    // selectComponent/afterModelChange) — must tear the stale drag down.
    outerDoc.dispatch("mousedown", { target: nonHandleTarget });
    expect(outerDoc.count("mouseup"), "the stale mouseup listener was torn down by the intervening mousedown").toBe(0);
    // 5) a stray mouseup (reviewer's cited repro: 300 + (300-100) = 500) —
    // must be a no-op: the listener that would have run finishUp is gone.
    outerDoc.dispatch("mouseup", { clientX: 300 });
    expect(probe.run(`findRef('q_zip').node.design_overrides`), "no width was ever written").toBeUndefined();
    expect(afterModelChangeCalls, "the section was never marked dirty").toBe(0);
  });

  it("R7 U11a: EVERY canvas node is draggable=false (selected or not) — native DnD is retired for canvas moves; the delegated pointer gesture owns all node reorders", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const FIXTURE = {
      components: [
        { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip" },
        { type: "TwoButtonYesNo", question_id: "q_ins", internal_field: "insured" },
      ],
    };
    function makeFakeNode(qid: string, componentType: string) {
      return {
        _attrs: {} as Record<string, string>,
        className: "",
        parentNode: null as unknown,
        getAttribute(name: string): string | null {
          if (name === "data-question-id") return qid;
          if (name === "data-component-type") return componentType;
          return this._attrs[name] ?? null;
        },
        setAttribute(name: string, value: string) {
          this._attrs[name] = value;
        },
      };
    }
    const zipNode = makeFakeNode("q_zip", "ZIPInputQuestion");
    const insNode = makeFakeNode("q_ins", "TwoButtonYesNo");
    const region = {
      querySelectorAll(sel: string) {
        return sel === "[data-question-id]" ? [zipNode, insNode] : [];
      },
    };
    const probe = studioProbe(html, FIXTURE, { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] });
    probe.sandbox["canvasRegion"] = () => region;
    probe.sandbox["mapsFillLabels"] = () => [];
    probe.sandbox["decorateChoiceCards"] = () => {};
    probe.sandbox["decorateMappingOverlay"] = () => {};
    // P3b (register PC-2): applyCanvasDecoration now also decorates container
    // select-chips — stub it out here like its sibling decorators (this probe
    // isolates the draggable=false loop, not the chip pass).
    probe.sandbox["decorateContainerChips"] = () => {};
    probe.sandbox["updateCanvasFrameHeight"] = () => {};
    probe.sandbox["decorateFieldSelection"] = () => {};
    probe.sandbox["decorateSimpleSelection"] = () => {};
    probe.sandbox["clearSelectionChrome"] = () => {};
    probe.sandbox.selectedQuestionId = "q_zip";
    probe.run(
      [
        sliceIslandLine(island, "var SELECT_CLASS"),
        sliceIslandFunction(island, "withoutClasses"),
        sliceIslandVar(island, "keptLegacyFrameNodes"),
        sliceIslandFunction(island, "selectionChromeKind"),
        sliceIslandFunction(island, "applyCanvasDecoration"),
      ].join("\n"),
    );
    probe.run("applyCanvasDecoration()");
    // R7 U11a: native HTML5 DnD is retired for canvas moves — EVERY node is
    // draggable=false, selected or not, so a real page.mouse (not native DnD,
    // which hangs in the srcdoc iframe under Chrome) can drive the reorder via
    // the ONE delegated pointer gesture (onFieldMoveMouseDown).
    expect(zipNode._attrs["draggable"], "selected field: draggable=false").toBe("false");
    expect(insNode._attrs["draggable"], "unselected node: ALSO draggable=false now").toBe("false");

    // deselect — still false (uniform; no per-selection native-DnD restore).
    probe.sandbox.selectedQuestionId = null;
    probe.run("applyCanvasDecoration()");
    expect(zipNode._attrs["draggable"], "deselected: stays draggable=false").toBe("false");
  });

  it("§6.2 Escape ends the inline edit WITHOUT walking the selection — onKey stops propagation before the doc-level handler", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    // the wiring: BOTH terminating keys are stopped at the element (finish()
    // clears inlineEditing before the bubble, so the doc guard alone can't)
    expect(island).toContain("keyEv.preventDefault(); keyEv.stopPropagation(); finish(false);");
    expect(island).toContain("keyEv.preventDefault(); keyEv.stopPropagation(); finish(true);");

    type Handler = (ev: unknown) => unknown;
    const committed: string[] = [];
    const renders: number[] = [];
    const selections: Array<string | null> = [];
    const el = {
      attrs: {} as Record<string, string>,
      handlers: {} as Record<string, Handler[]>,
      textContent: "Edited copy",
      setAttribute(n: string, v: string) {
        this.attrs[n] = v;
      },
      removeAttribute(n: string) {
        delete this.attrs[n];
      },
      addEventListener(t: string, f: Handler) {
        (this.handlers[t] = this.handlers[t] ?? []).push(f);
      },
      removeEventListener(t: string, f: Handler) {
        const a = this.handlers[t] ?? [];
        const at = a.indexOf(f);
        if (at >= 0) a.splice(at, 1);
      },
      focus() {
        /* noop */
      },
    };
    const probe = studioProbe(html, NESTED_CONTENT);
    probe.sandbox["el"] = el;
    probe.sandbox["committed"] = committed;
    probe.sandbox["renders"] = renders;
    probe.sandbox["selections"] = selections;
    probe.run(
      [
        "var inlineEditing = false;",
        "function scheduleCanvasRender() { renders.push(1); }",
        "function selectComponent(qid) { selectedQuestionId = qid; selections.push(qid); }",
        sliceIslandFunction(island, "startInlineEdit"),
        sliceIslandFunction(island, "onCanvasKeyDown"),
      ].join("\n"),
    );
    probe.sandbox.selectedQuestionId = "bag1"; // nested: bag1 → stack1 → panel1

    // the DOM bubble contract: element listeners first, the document handler
    // ONLY if propagation was not stopped — both handlers are the REAL code.
    const bubble = (key: string): boolean => {
      let stopped = false;
      const ev = {
        key,
        preventDefault() {
          /* noop */
        },
        stopPropagation() {
          stopped = true;
        },
      };
      probe.sandbox["ev"] = ev;
      for (const h of [...(el.handlers["keydown"] ?? [])]) h(ev);
      if (!stopped) probe.run("onCanvasKeyDown(ev)");
      return stopped;
    };

    expect(probe.run("startInlineEdit(el, function (text) { committed.push(text); })")).toBe(true);
    expect(el.attrs["contenteditable"]).toBe("true");
    expect(probe.run("inlineEditing")).toBe(true);

    // Escape: the edit CANCELS (no commit, lock restored, stale draft
    // repainted) and the selection NEVER walks to the parent.
    expect(bubble("Escape"), "onKey stopped the Escape at the element").toBe(true);
    expect(probe.run("inlineEditing")).toBe(false);
    expect(el.attrs["contenteditable"]).toBeUndefined();
    expect(committed).toEqual([]);
    expect(renders.length, "cancel repaints the canvas (stale draft text)").toBeGreaterThan(0);
    expect(selections, "selection unchanged — the doc handler never ran").toEqual([]);
    expect(probe.sandbox.selectedQuestionId).toBe("bag1");

    // Enter: commits through the SAME stopped path (selection untouched too).
    expect(probe.run("startInlineEdit(el, function (text) { committed.push(text); })")).toBe(true);
    expect(bubble("Enter"), "onKey stopped the Enter at the element").toBe(true);
    expect(committed).toEqual(["Edited copy"]);
    expect(selections).toEqual([]);

    // calibration — the stop is LOAD-BEARING: the same Escape arriving at the
    // doc handler OUTSIDE an edit session walks the selection up the ancestry.
    probe.run("onCanvasKeyDown({ key: 'Escape', preventDefault: function () {} })");
    expect(selections).toEqual(["stack1"]);
  });
});

describeDb("wave 2 — MultiChoiceCardGroup choice depth (A6 flag d)", () => {
  it("title/subtitle render with the iconCard token slots; a depth-less choice renders byte-identically (additive)", () => {
    const design = defaultFunnelDesign;
    const base: Record<string, unknown> = {
      type: "MultiChoiceCardGroup",
      question_id: "m1",
      internal_field: "features",
      choices: [{ label: "Alarm", value: "alarm", analytics_id: "alarm" }],
      props: { min: 1, max: 2 },
    };
    const plain = renderComponent(base as never, design);
    // §8.7 D/F: depth-less markup carries NO subtitle span and titles by label
    expect(plain).toContain('<span class="lg-card-title">Alarm</span>');
    expect(plain).not.toContain("lg-card-subtitle");
    const deep = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    (deep["choices"] as Array<Record<string, unknown>>)[0] = {
      label: "Alarm",
      value: "alarm",
      analytics_id: "alarm",
      title: "Alarm system",
      subtitle: "Monitored 24/7",
    };
    const rendered = renderComponent(deep as never, design);
    expect(rendered).toContain('<span class="lg-card-title">Alarm system</span>');
    expect(rendered).toContain('class="lg-card-desc lg-card-subtitle"');
    expect(rendered).toContain("Monitored 24/7");
    // additive: stripping the depth fields reproduces the plain bytes exactly
    (deep["choices"] as Array<Record<string, unknown>>)[0] = { label: "Alarm", value: "alarm", analytics_id: "alarm" };
    expect(renderComponent(deep as never, design)).toBe(plain);
  });
});


// ---------------------------------------------------------------------------
// Phase-C review fixes (v2.5.1) — FIX 2/4/5/7/8 + minors 9/15
// ---------------------------------------------------------------------------

describeDb("review FIX 2 — the §9.5 editor never clobbers the legacy curated bag", () => {
  function drawerStub(roleValue: string, cols: string, gap: string): Record<string, unknown> {
    const roleSel = (role: string, value: string) => ({ getAttribute: () => role, value });
    return {
      getElementById() {
        return null;
      },
      querySelector(sel: string) {
        if (sel === "[data-section-columns-default]") return { value: cols };
        if (sel === "[data-section-gap-default]") return { value: gap };
        return null;
      },
      querySelectorAll(sel: string) {
        if (sel === "[data-section-role]") return [roleSel("button_primary_bg", roleValue)];
        return [];
      },
    };
  }

  it("EXECUTED + real PATCH: a loaded {buttonBackground:'#123456'} bag survives editing ONE §9.5 role — the stored JSON carries BOTH; untouched controls round-trip the legacy bag byte-identically", async () => {
    const { env } = newHarness();
    const LEGACY_BAG = { buttonBackground: "#123456" };
    const section = await createSection(env, { design_overrides: LEGACY_BAG });
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);

    // leg 1: ONE §9.5 role edited — the merge keeps the legacy key
    const probe = studioProbe(html, YESNO_CONTENT, drawerStub("accent", "", ""));
    probe.run("state.design_overrides = { buttonBackground: '#123456' };"); // the LOADED bag
    probe.run(sliceIslandFunction(island, "buildSectionOverrides"));
    const built = probe.run("buildSectionOverrides()") as Record<string, unknown>;
    expect(built).toEqual({ buttonBackground: "#123456", palette: { button_primary_bg: "accent" } });

    // leg 2: untouched §9.5 controls — the pure-legacy bag round-trips
    // BYTE-identically (stored key order preserved)
    const probe2 = studioProbe(html, YESNO_CONTENT, drawerStub("", "", ""));
    probe2.run("state.design_overrides = { buttonBackground: '#123456' };");
    probe2.run(sliceIslandFunction(island, "buildSectionOverrides"));
    const untouched = probe2.run("buildSectionOverrides()") as Record<string, unknown>;
    expect(JSON.stringify(untouched)).toBe(JSON.stringify(LEGACY_BAG));

    // the REAL PATCH persists BOTH keys (§14.8 curated + §9.5 mixed is legal)
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { design_overrides: built }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as Record<string, unknown>;
    expect(saved["design_overrides_json"]).toEqual({
      buttonBackground: "#123456",
      palette: { button_primary_bg: "accent" },
    });
  });
});

describeDb("review FIX 4a — answer-group selected-state override renders back", () => {
  const DESIGN = defaultFunnelDesign;
  // Rework §10 removal (test repair, P2): OtherGroupSelector's render leg is
  // RETIRED to a fail-safe extinct-type box (conductor ruling) that consumes
  // NO design_overrides at all — dropped from this map (own dedicated
  // retirement coverage lives in leadgen-components-render.test.ts /
  // leadgen-r1-answers.test.ts). "all three types" in the test title below
  // is now the two remaining button-family types.
  const NODES: Record<string, Record<string, unknown>> = {
    ButtonAnswerGroup: {
      type: "ButtonAnswerGroup",
      question_id: "q",
      internal_field: "pick",
      choices: [{ label: "A", value: "a", analytics_id: "a" }],
    },
    TwoButtonYesNo: { type: "TwoButtonYesNo", question_id: "q", internal_field: "insured" },
  };

  it("override → the group ROOT carries --lg-sel-bg (role resolved via ovColor); absent → byte-identical markup (all three types)", () => {
    for (const [type, base] of Object.entries(NODES)) {
      const plain = renderComponent(base as never, DESIGN);
      expect(plain, `${type} absent override carries no var`).not.toContain("--lg-sel-bg");
      // a ROLE value resolves through the design (§9.4 role-or-hex). Rework
      // §6.7 (test repair, P2): ButtonAnswerGroup's 1-choice fixture now ALSO
      // emits --lg-cols:1 in the SAME style attribute (min(design-default 2,
      // choiceCount 1)=1) — assert the --lg-sel-bg substring, not the whole
      // (now additionally --lg-cols-bearing) style value.
      const withRole = { ...base, design_overrides: { buttonBackground: "accent" } };
      const rendered = renderComponent(withRole as never, DESIGN);
      expect(rendered, `${type} role override`).toContain("--lg-sel-bg:#E85D26"); // accent
      // a legacy #hex is byte-preserved
      const withHex = { ...base, design_overrides: { buttonBackground: "#123456" } };
      expect(renderComponent(withHex as never, DESIGN), `${type} hex override`).toContain(
        "--lg-sel-bg:#123456",
      );
      // stripping the override reproduces the plain bytes exactly (ADDITIVE)
      const stripped = { ...base };
      delete (stripped as Record<string, unknown>)["design_overrides"];
      expect(renderComponent(stripped as never, DESIGN)).toBe(plain);
    }
  });

  it("a §9.5 Section palette re-point reaches the role through layer 4 (renderSectionComponents ctx)", () => {
    const nodes = [{ ...NODES["ButtonAnswerGroup"], design_overrides: { buttonBackground: "button_primary_bg" } }];
    const ctx = {
      headline_text: "",
      subheadline_text: null,
      design_overrides: { palette: { button_primary_bg: "#0F2440" } },
    };
    const out = renderSectionComponents(nodes as never, DESIGN, ctx as never);
    // Rework §6.7 (test repair, P2): NODES.ButtonAnswerGroup carries only 1
    // choice with no authored columns, so effective columns are now ALSO
    // clamped (min(design-default 2, 1)=1) and ride the SAME style attribute
    // — assert the --lg-sel-bg substring rather than the whole (now
    // additionally --lg-cols:1-bearing) style value.
    expect(out).toContain("--lg-sel-bg:#0F2440");
  });

  it("DEV-68: the consuming CSS rule rides the BASE sheet (frame-independent markup) — exactly once, AFTER the §14.6 selected rule; framed sheet inherits it without duplication", () => {
    const base = funnelChromeCss(DESIGN);
    const framed = funnelChromeCss(DESIGN, undefined, { frameRegions: true });
    // the rule re-states the SAME selected selector THROUGH the var so the
    // fallback keeps the §14.6 token when no override rides the group.
    // P2b FIX-ROUND (adversarial review R1+R2): the selector grew a third
    // alternative, .lg-selected (R2 — the live runtime's real selection
    // marker), and the background now nests var(--lg-answer-bg, …) OUTSIDE
    // var(--lg-sel-bg, …) (R1 — a per-choice color wins over the node-level
    // curated override too, while an unset per-choice var still falls all the
    // way through to the SAME #E8EEF4 token as before).
    const consumer =
      /\.lg-btn\.lg-btn-answer\[aria-checked="true"\][^{]*\.lg-btn\.lg-btn-answer\.lg-selected\{background:var\(--lg-answer-bg, var\(--lg-sel-bg, #E8EEF4\)\)\}/g;
    // the BASE sheet (legacy funnels + unit-only previews) carries the consumer
    // exactly once — the DEV-68 coordinated re-pin carried the byte change
    expect(base.match(consumer), "exactly one base-sheet emission").toHaveLength(1);
    // …emitted AFTER the §14.6 selected rule, so the var restatement wins by
    // source order at equal specificity (override set ⇒ role/hex; unset ⇒
    // identical computed style via the token fallback)
    const selectedRuleAt = base.indexOf('.lg-btn.lg-btn-answer[aria-checked="true"]');
    const consumerAt = base.indexOf("var(--lg-sel-bg, ");
    expect(selectedRuleAt, "the §14.6 selected rule exists").toBeGreaterThan(-1);
    expect(consumerAt, "the consumer follows the §14.6 selected rule").toBeGreaterThan(selectedRuleAt);
    // the framed sheet appends the gated rules to the SAME base — the consumer
    // rides it exactly once (no duplicate gated emission remains)
    expect(framed.match(consumer), "exactly one framed-sheet emission").toHaveLength(1);
  });

  it("FIX 8b: the dropdown presets consume props.default — the matching option is selected; absent/unmatched default renders byte-identically", () => {
    const dropdown = {
      type: "DropdownQuestion",
      question_id: "q",
      internal_field: "insurer",
      choices: [
        { label: "Acme", value: "acme", analytics_id: "a" },
        { label: "Globex", value: "globex", analytics_id: "g" },
      ],
    };
    const plain = renderComponent(dropdown as never, DESIGN);
    expect(plain).toContain('<option value="" disabled selected>');
    const withDefault = { ...dropdown, props: { default: "globex" } };
    const rendered = renderComponent(withDefault as never, DESIGN);
    expect(rendered).toContain('<option value="" disabled>');
    expect(rendered).toMatch(/<option value="globex"[^>]* selected>Globex</);
    expect(rendered).not.toMatch(/<option value="acme"[^>]* selected>/);
    // the searchable twin shares the semantics
    const searchable = { ...withDefault, type: "SearchableDropdownQuestion" };
    expect(renderComponent(searchable as never, DESIGN)).toMatch(/<option value="globex"[^>]* selected>Globex</);
    // an unmatched default is IGNORED (placeholder stays selected — defensive)
    const unmatched = { ...dropdown, props: { default: "nope" } };
    expect(renderComponent(unmatched as never, DESIGN)).toBe(plain);
    // range presets already consume props.default (§5.5) — the slider starts there
    const range = {
      type: "NumberRangeQuestion",
      question_id: "q",
      internal_field: "amount",
      props: { min: 0, max: 100, step: 1, default: 40 },
    };
    expect(renderComponent(range as never, DESIGN)).toContain('value="40"');
  });
});

describeDb("review FIX 4b — dead-write controls are gated per type (executed island gates)", () => {
  it("isCardGridType/overrideRowHidden: columns+gridGap only for the card grids; iconColor hidden for MultiChoiceCardGroup; color rows untouched", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, YESNO_CONTENT);
    // R3b: overrideRowHidden now also calls isRangeFamilyType (rangeColor's
    // corrected gating) — inject it alongside the sliced function, mirroring
    // how this sandbox already injects every other sibling dependency.
    probe.run(
      [
        sliceIslandFunction(island, "isCardGridType"),
        sliceIslandFunction(island, "isAnswerLayoutType"),
        sliceIslandFunction(island, "isRangeFamilyType"),
        sliceIslandFunction(island, "overrideRowHidden"),
      ].join("\n"),
    );
    // selIcon (the two card grids' icon slot) still keys off isCardGridType.
    // Rework §6.2: the "Card layout" (columns/gap) control is now gated on the
    // MATRIX Columns capability — cap(node,'columns') — which drops it from
    // TwoButtonYesNo (§6.2's YesNo Columns cell is BLANK — a fixed pair has no
    // column count) while keeping it for the card grids + Buttons + MultiChoice.
    expect(island).toContain("selIcon.hidden = !isCardGridType(node);");
    expect(island).toContain("choiceLayout.hidden = cap(node, 'columns') !== true;");
    // isAnswerLayoutType itself is UNCHANGED (still used by showChoiceExtras) —
    // it stays true for the answer-group family incl. YesNo; only the choiceLayout
    // GATE moved to cap(node,'columns').
    for (const t of ["IconCardAnswerGrid", "ImageCardAnswerGrid", "MultiChoiceCardGroup", "ButtonAnswerGroup", "TwoButtonYesNo"]) {
      expect(probe.run(`isAnswerLayoutType({ type: '${t}' })`), `${t} answer-layout`).toBe(true);
    }
    expect(probe.run("isAnswerLayoutType({ type: 'FreeTextQuestion' })")).toBe(false);
    expect(probe.run("isAnswerLayoutType(null)")).toBe(false);
    // §6.2 Columns capability: card grids + Buttons + MultiChoice YES; YesNo +
    // Dropdown NO (BLANK cells) — the cap the choiceLayout control now reads.
    probe.run([sliceIslandFunction(island, "capsOf"), sliceIslandFunction(island, "cap")].join("\n"));
    for (const t of ["IconCardAnswerGrid", "ImageCardAnswerGrid", "MultiChoiceCardGroup", "ButtonAnswerGroup"]) {
      expect(probe.run(`cap({ type: '${t}' }, 'columns')`), `${t} cap columns`).toBe(true);
    }
    expect(probe.run("cap({ type: 'TwoButtonYesNo' }, 'columns')"), "YesNo cap columns blank").toBe(false);
    expect(probe.run("cap({ type: 'DropdownQuestion' }, 'columns')"), "Dropdown cap columns blank").toBe(false);
    for (const grid of ["IconCardAnswerGrid", "ImageCardAnswerGrid"]) {
      expect(probe.run(`isCardGridType({ type: '${grid}' })`), grid).toBe(true);
      expect(probe.run(`overrideRowHidden('columns', { type: '${grid}' })`), `${grid} columns`).toBe(false);
      expect(probe.run(`overrideRowHidden('gridGap', { type: '${grid}' })`), `${grid} gridGap`).toBe(false);
    }
    // The STRUCTURAL override-ROWS (data-override-row, renderStyleExtraControls)
    // stay card-grid-gated — overrideRowHidden is UNCHANGED; P1a routes the
    // answer groups' columns/gridGap authoring through the "Card layout" control
    // (choiceLayout, above) instead, so these generic rows remain hidden for them.
    for (const t of ["ButtonAnswerGroup", "TwoButtonYesNo", "DropdownQuestion", "SearchableDropdownQuestion", "MultiChoiceCardGroup"]) {
      expect(probe.run(`isCardGridType({ type: '${t}' })`), t).toBe(false);
      expect(probe.run(`overrideRowHidden('columns', { type: '${t}' })`), `${t} columns hidden`).toBe(true);
      expect(probe.run(`overrideRowHidden('gridGap', { type: '${t}' })`), `${t} gridGap hidden`).toBe(true);
    }
    // R3b S2-7: iconColor is now hidden EVERYWHERE except the card grids (was
    // "hidden for MultiChoiceCardGroup only" — the wrong-axis bug the rail
    // removal fixed); MCG (no icon slot) and a non-grid choice type both stay
    // gated off, the two grids keep it.
    expect(probe.run("overrideRowHidden('iconColor', { type: 'MultiChoiceCardGroup' })")).toBe(true);
    expect(probe.run("overrideRowHidden('iconColor', { type: 'ButtonAnswerGroup' })")).toBe(true);
    expect(probe.run("overrideRowHidden('iconColor', { type: 'IconCardAnswerGrid' })")).toBe(false);
    expect(probe.run("overrideRowHidden('iconColor', { type: 'ImageCardAnswerGrid' })")).toBe(false);
    // R3b S2-7: rangeColor is now hidden EVERYWHERE except the range family
    // (was ungated/always-visible — another wrong-axis dead-write row the
    // rail removal fixed).
    expect(probe.run("overrideRowHidden('rangeColor', { type: 'ButtonAnswerGroup' })")).toBe(true);
    // §10: the ONE surviving slider type keeps the rangeColor row visible.
    for (const rangeType of ["NumberRangeQuestion"]) {
      expect(probe.run(`overrideRowHidden('rangeColor', { type: '${rangeType}' })`), rangeType).toBe(false);
    }
    // R3b S2-7/S4-A4: featureColor/buttonBackground/buttonText no longer have
    // ANY rendered row at all (rail removal — featureColor's real home is now
    // the text family's own "Text color role" control; buttonBackground/
    // buttonText are frame/theme-owned, no authoring control). overrideRowHidden
    // has no per-key branch for them, so it falls through to its default
    // (`false`, i.e. "not explicitly hidden") — vacuously true since there is
    // no row for that default to ever apply to; this documents the fallthrough
    // rather than claiming these are "visible controls".
    for (const key of ["featureColor", "buttonBackground", "buttonText"]) {
      expect(probe.run(`overrideRowHidden('${key}', { type: 'ButtonAnswerGroup' })`), key).toBe(false);
    }
    // no selection → structural rows hidden (nothing to write to)
    expect(probe.run("overrideRowHidden('columns', null)")).toBe(true);
  });
});

describeDb("review FIX 5 — save-response problems[] + inline routing", () => {
  const FRAME_WARN_CONTENT = {
    components: [
      { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
      { type: "HeaderBar", question_id: "hb1", props: { logoMediaId: "media_logo" } },
    ],
  };

  it("PATCH success carries the frame_scope_component warning as a §3.6 problem (scope component, path-precise); POST too; a clean save carries []", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    // clean content → problems: []
    const clean = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: JSON.stringify(YESNO_CONTENT) }),
      env,
    );
    expect(clean.status).toBe(200);
    expect(((await clean.json()) as { problems: unknown[] }).problems).toEqual([]);
    // a legacy frame-scope node → the save SUCCEEDS and carries the warning
    const res = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: JSON.stringify(FRAME_WARN_CONTENT) }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { problems: Array<Record<string, unknown>> };
    expect(body.problems).toHaveLength(1);
    expect(body.problems[0]).toMatchObject({
      scope: "component",
      severity: "warning",
      path: "components[1]",
    });
    expect(String(body.problems[0]!["message"])).toContain("funnel layout"); // U15: content-schema.ts:1514 renamed
    // POST leg: same shape on create (201)
    const created = await admin.request(
      `${API}/sections`,
      jsonInit("POST", {
        section_name: "Warned",
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Warned",
        content_json: JSON.stringify(FRAME_WARN_CONTENT),
      }),
      env,
    );
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { problems: Array<Record<string, unknown>> };
    expect(createdBody.problems).toHaveLength(1);
    expect(createdBody.problems[0]).toMatchObject({ scope: "component", severity: "warning" });
  });

  it("EXECUTED island seam: renderSaveProblems shows the summary + click-to-focus rows; routeSaveFieldErrors marks the matching control inline", async () => {
    const { env } = newHarness();
    const section = await createSection(env, { content_json: JSON.stringify(FRAME_WARN_CONTENT) });
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const box = stubEl("div");
    box.hidden = true;
    const strip = stubEl("input");
    const focused: string[] = [];
    const probe = studioProbe(html, FRAME_WARN_CONTENT, {
      createElement(tag: string) {
        return stubEl(tag);
      },
      createTextNode(text: string) {
        return stubEl("#text", text);
      },
      querySelector(sel: string) {
        return sel === "[data-studio-save-problems]" ? box : null;
      },
      querySelectorAll() {
        return [];
      },
      getElementById(id: string) {
        return id === "lg-section-headline" ? strip : null;
      },
    });
    probe.run("function selectComponent(qid) { focusedQids.push(qid); }");
    probe.sandbox["focusedQids"] = focused;
    probe.run(
      [
        sliceIslandFunction(island, "clearChildren"),
        sliceIslandFunction(island, "componentByProblemPath"),
        sliceIslandFunction(island, "saveProblemFocusHandler"),
        sliceIslandFunction(island, "renderSaveProblems"),
        sliceIslandVar(island, "SAVE_FIELD_CONTROL_IDS"),
        sliceIslandFunction(island, "markSaveFieldControl"),
        sliceIslandFunction(island, "routeSaveFieldErrors"),
      ].join("\n"),
    );
    // the save handler itself consumes both legs. R4a E3-NEW-1: problems[]
    // now surface unconditionally (new OR existing Section) — a first save
    // no longer discards them by redirecting away first.
    expect(island).toContain("if (problems.length > 0) {");
    expect(island).toContain("routeSaveFieldErrors(res.body && res.body.fields);");
    // problems[] → the summary + one row per problem
    probe.run(
      "renderSaveProblems([{ path: 'components[1]', scope: 'component', severity: 'warning', message: 'Header bar belongs to the funnel layout.' }]);",
    );
    expect(box.hidden).toBe(false);
    const allDescendants = (el: StubEl): StubEl[] => [el, ...el.children.flatMap(allDescendants)];
    const row = allDescendants(box).find((c) => c.getAttribute("data-save-problem-path") === "components[1]");
    expect(row, "the problem row rides the box").toBeDefined();
    // clicking the row focuses the offending component (§6.7 idiom)
    row!.click();
    expect(focused).toEqual(["hb1"]);
    // empty problems reset the box
    probe.run("renderSaveProblems([]);");
    expect(box.hidden).toBe(true);
    // 400 FIELD errors route inline where a control matches: a scalar strip
    // field marks its input; a content path focuses the component
    probe.run(
      "routeSaveFieldErrors({ 'headline_text': 'headline_text is required', 'content.components[0].question_id': 'duplicate' });",
    );
    expect(strip.className).toContain("studio-control-invalid");
    expect(focused).toEqual(["hb1", "q1"]);
  });
});

describeDb("review FIX 7 — Require-this-component-IF (props.requiredWhen) + sentences", () => {
  it("SSR: the Dependencies panel carries BOTH row types with sentence lines; requiredWhen round-trips via the REAL PATCH into the public config", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toContain("Show this component IF");
    expect(html).toContain("Require this component IF");
    expect(html).toContain("data-cond-sentence");
    expect(html).toContain("data-reqcond-sentence");
    expect(html).toContain('data-inspector-reqcond="when"');
    // requiredWhen persists through the REAL PATCH…
    const CONTENT = {
      components: [
        { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
        {
          type: "DropdownQuestion",
          question_id: "q2",
          internal_field: "insurer",
          answer_type: "enum",
          choices: [{ label: "Acme", value: "acme", analytics_id: "a" }],
          props: { requiredWhen: { when: "currently_insured", op: "eq", value: true } },
        },
      ],
    };
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: JSON.stringify(CONTENT) }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as Record<string, unknown>;
    const savedNodes = (saved["content_json"] as { components: Array<Record<string, unknown>> }).components;
    expect((savedNodes[1]!["props"] as Record<string, unknown>)["requiredWhen"]).toEqual({
      when: "currently_insured",
      op: "eq",
      value: true,
    });
    // …and rides the PUBLIC component config the runtime's requiredNow reads
    const pub = toPublicComponent(savedNodes[1] as never);
    expect((pub.props as Record<string, unknown>)["requiredWhen"]).toEqual({
      when: "currently_insured",
      op: "eq",
      value: true,
    });
  });

  it("EXECUTED: collectRequiredWhen writes props.requiredWhen from the pickers; the §7.3 sentences render both row types", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const CONTENT = {
      components: [
        { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
        {
          type: "DropdownQuestion",
          question_id: "q2",
          internal_field: "insurer",
          answer_type: "enum",
          choices: [{ label: "Acme", value: "acme", analytics_id: "a" }],
        },
      ],
    };
    const reqEls: Record<string, { value: string; hidden: boolean }> = {
      when: { value: "currently_insured", hidden: false },
      op: { value: "eq", hidden: false },
      "value-bool": { value: "true", hidden: false },
      value: { value: "", hidden: false },
      from: { value: "", hidden: false },
      to: { value: "", hidden: false },
      values: { value: "", hidden: false },
    };
    const showSentence = stubEl("p");
    const reqSentence = stubEl("p");
    const probe = studioProbe(html, CONTENT, {
      getElementById() {
        return null;
      },
      querySelector(sel: string) {
        const m = sel.match(/\[data-inspector-reqcond="([^"]+)"\]/);
        if (m) return reqEls[m[1]!] ?? null;
        if (sel === "[data-cond-sentence]") return showSentence;
        if (sel === "[data-reqcond-sentence]") return reqSentence;
        return null;
      },
      querySelectorAll() {
        return [];
      },
    });
    probe.sandbox.selectedQuestionId = "q2";
    probe.run(
      [
        sliceIslandFunction(island, "readReqCond"),
        sliceIslandFunction(island, "reqCondPartValue"),
        sliceIslandFunction(island, "nodeRequiredWhen"),
        sliceIslandFunction(island, "updateReqCondValueInputs"),
        sliceIslandFunction(island, "conditionSentence"),
        sliceIslandFunction(island, "renderConditionSentences"),
        sliceIslandFunction(island, "collectRequiredWhen"),
      ].join("\n"),
    );
    probe.run("collectRequiredWhen();");
    // the TYPED conditional landed on props.requiredWhen (boolean, not 'true')
    expect(probe.run("selectedNode().props.requiredWhen")).toEqual({
      when: "currently_insured",
      op: "eq",
      value: true,
    });
    // the §7.3 sentence pattern renders the readable text — PC-12: the field
    // speaks its human name (this fixture's docStub returns no headline
    // input, so "currently_insured" — TwoButtonYesNo, no props.yesLabel
    // authored — falls back to its typeLabel "Yes / No"; the boolean VALUE
    // speaks its own yes/no wording ("Yes"), not the raw "true").
    expect(reqSentence.textContent).toBe("Require this question when Yes / No is Yes");
    // the show-if sentence renders the pattern too
    probe.run("selectedNode().conditional = { when: 'currently_insured', op: 'eq', value: true };");
    probe.run("renderConditionSentences(selectedNode());");
    expect(showSentence.textContent).toBe("Show this question when Yes / No is Yes");
    // clearing the picker deletes the key (no empty-object residue)
    reqEls["when"]!.value = "";
    probe.run("collectRequiredWhen();");
    expect(probe.run("selectedNode().props ? selectedNode().props.requiredWhen : undefined")).toBeUndefined();
  });
});

describeDb("review FIX 8 — §5.5 defaults + the AI media-picker affordance", () => {
  // R2 P1 FIX-FIRST (BLOCKER 2) retitled + re-asserted: the canonical authored-
  // default key is props.defaultValue for EVERY kind (yes/no boolean, range
  // number, dropdown choice value). props.default survives ONLY as the range
  // mirror the presets.ts slider renderers read. The dropdown leg is the exact
  // one the owner's 18.30.25 drive failed on: authored default → default_answer.
  it("SSR + EXECUTED: the typed default controls write props.defaultValue for every kind (yes/no boolean · range number, mirrored to props.default · dropdown value); real PATCH round-trip + config-dto default_answer", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    // the three §5.5 default controls + the confirm-default note (§5.5 copy)
    expect(html).toContain('data-default-wrap="yesno"');
    expect(html).toContain('data-default-wrap="range"');
    expect(html).toContain('data-default-wrap="dropdown"');
    expect(html).toContain("the visitor must still confirm it before continuing");
    const island = studioIsland(html);
    const CONTENT = {
      components: [
        { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
        { type: "NumberRangeQuestion", question_id: "q2", internal_field: "amount", answer_type: "number", props: { min: 0, max: 100, step: 1 } },
        {
          type: "DropdownQuestion",
          question_id: "q3",
          internal_field: "insurer",
          answer_type: "enum",
          choices: [{ label: "Acme", value: "acme", analytics_id: "a" }],
        },
      ],
    };
    const probe = studioProbe(html, CONTENT);
    probe.run(
      [
        // Rework §6.4: defaultKindOf is matrix-driven now (cap → studioMeta
        // capabilities.default_kind), not the removed RANGE/DROPDOWN arrays.
        sliceIslandFunction(island, "capsOf"),
        sliceIslandFunction(island, "cap"),
        sliceIslandFunction(island, "defaultKindOf"),
        sliceIslandFunction(island, "collectDefaultControl"),
      ].join("\n"),
    );
    const collect = (qid: string, kind: string, value: string): void => {
      probe.sandbox.selectedQuestionId = qid;
      probe.run(
        `collectDefaultControl({ value: ${JSON.stringify(value)}, getAttribute: function () { return ${JSON.stringify(kind)}; } });`,
      );
    };
    // yes/no → BOOLEAN defaultValue (the config-dto default_applied field)
    collect("q1", "yesno", "true");
    expect(probe.run("state.content.components[0].props.defaultValue")).toBe(true);
    // range → NUMBER props.defaultValue (the answer) MIRRORED to props.default
    // (the presets.ts slider renderers read propNum(node,"default") only)
    collect("q2", "range", "40");
    expect(probe.run("state.content.components[1].props.defaultValue")).toBe(40);
    expect(probe.run("state.content.components[1].props.default")).toBe(40);
    // dropdown → the choice VALUE, on the canonical key
    collect("q3", "dropdown", "acme");
    expect(probe.run("state.content.components[2].props.defaultValue")).toBe("acme");
    expect(probe.run("state.content.components[2].props.default")).toBeUndefined();
    // a mismatched control kind never writes (type-gated)
    collect("q1", "range", "7");
    expect(probe.run("state.content.components[0].props.default")).toBeUndefined();
    // clearing deletes
    collect("q1", "yesno", "");
    expect(probe.run("state.content.components[0].props ? state.content.components[0].props.defaultValue : undefined")).toBeUndefined();
    collect("q1", "yesno", "true");

    // the REAL PATCH persists all three defaults
    const mutated = probe.run("state.content") as Record<string, unknown>;
    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { content_json: JSON.stringify(mutated) }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const saved = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as Record<string, unknown>;
    const savedNodes = (saved["content_json"] as { components: Array<Record<string, unknown>> }).components;
    expect((savedNodes[0]!["props"] as Record<string, unknown>)["defaultValue"]).toBe(true);
    expect((savedNodes[1]!["props"] as Record<string, unknown>)["defaultValue"]).toBe(40);
    expect((savedNodes[1]!["props"] as Record<string, unknown>)["default"]).toBe(40);
    expect((savedNodes[2]!["props"] as Record<string, unknown>)["defaultValue"]).toBe("acme");
    // the runtime's default_applied path consumes the default via the REAL
    // projection (config-dto default_answer) — for the yes/no AND (B2) for the
    // dropdown + range the studio just authored: an authored default IS the
    // visitor's answer, so it must reach the client config, not vanish.
    const pub = toPublicComponent(savedNodes[0] as never);
    expect(pub.default_answer).toEqual({ value: true, answer_source: "default_applied" });
    expect(toPublicComponent(savedNodes[1] as never).default_answer).toEqual({ value: 40, answer_source: "default_applied" });
    expect(toPublicComponent(savedNodes[2] as never).default_answer).toEqual({ value: "acme", answer_source: "default_applied" });
  });

  it("the media picker's Generate-with-AI affordance: HIDDEN without the route (§8.4); present + wired when the key exists (both builders' shared idiom)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    // the harness env has NO OPENAI_API_KEY → the affordance ships hidden
    const html = await studioPage(env, section.public_id);
    expect(html).toContain("data-media-ai-generate");
    expect(html).toMatch(/data-media-ai-generate[^>]*data-ai-image-available="false"[^>]*hidden/);
    // availability flips the SAME markup on (the SSR stamps the signal)
    const keyedEnv = { ...env, OPENAI_API_KEY: "test-key" } as Env;
    const htmlKeyed = await getHtml(keyedEnv, `/admin/leadgen/sections/${section.public_id}/edit`);
    expect(htmlKeyed).toMatch(/data-media-ai-generate[^>]*data-ai-image-available="true"/);
    expect(htmlKeyed).not.toMatch(/data-media-ai-generate[^>]*data-ai-image-available="true"[^>]*hidden/);
    expect(htmlKeyed).toContain('id="lg-media-ai-generate"');
    expect(htmlKeyed).toContain("Generate with AI");
    // the island posts to the EXISTING generation endpoint and applies the
    // resulting storage_key through the SAME pick path an upload takes
    const island = studioIsland(htmlKeyed);
    expect(island).toContain("fetch('/api/admin/ai/image', {");
    expect(island).toContain("applyMediaPick(res.body.storage_key);");
  });
});

describeDb("review minors 9 + 15 — frame-pill deep link · default-frame empty state", () => {
  it("MINOR 9: usageFunnelsOf carries the owning quote id; funnelQuoteUrl deep-links its Quote Builder; the pill enables only with usage", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, YESNO_CONTENT);
    probe.run("var usageRows = [{ quote_public_id: 'lgq_q1', funnel_public_id: 'lgf_one', funnel_name: 'Funnel One', variant_public_id: 'lgn_x' }];");
    probe.run([sliceIslandFunction(island, "usageFunnelsOf"), sliceIslandFunction(island, "funnelQuoteUrl")].join("\n"));
    const funnels = probe.run("usageFunnelsOf()") as Array<Record<string, unknown>>;
    expect(funnels).toEqual([{ public_id: "lgf_one", name: "Funnel One", quote_public_id: "lgq_q1" }]);
    expect(probe.run("funnelQuoteUrl(usageFunnelsOf()[0])")).toBe("/admin/leadgen/quotes/lgq_q1/edit");
    // a row without a quote id degrades to the Quotes list, never a broken URL
    expect(probe.run("funnelQuoteUrl({ public_id: 'x', name: 'X', quote_public_id: null })")).toBe("/admin/leadgen/quotes");
    // the pill is enabled ONLY when a using funnel exists; clicking with many
    // opens the picker (island wiring), one navigates
    expect(island).toContain("pills[i].disabled = usageFunnelsOf().length === 0;");
    expect(island).toContain("if (funnels.length === 1) { window.location.href = funnelQuoteUrl(funnels[0]); return; }");
    expect(island).toContain("renderFramePillPicker(this, funnels);");
  });

  it("MINOR 15: zero usage → frameContextBody sends {default:true}; the REAL preview endpoint composes the DEFAULT centered template frame (no funnel, no branding)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const probe = studioProbe(html, YESNO_CONTENT);
    probe.run("var framePick = { quote: '', funnel: '', variant: '', site: '' };");
    probe.run(sliceIslandFunction(island, "frameContextBody"));
    // usage UNKNOWN (not loaded) → unit-only, exactly as before
    expect(probe.run("frameContextBody()")).toBe(null);
    // usage loaded and ZERO → the default-frame context (the §5.3 empty-state
    // copy promises "previewing in the default funnel layout")
    probe.run("var usageQuoteCount = 0;");
    expect(probe.run("frameContextBody()")).toEqual({ default: true });
    // any usage → back to unit-only until a funnel is picked
    probe.run("usageQuoteCount = 2;");
    expect(probe.run("frameContextBody()")).toBe(null);

    // the LANDED endpoint leg: {default:true} composes the default template
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: JSON.stringify(YESNO_CONTENT),
        viewport: "desktop",
        frame_context: { default: true },
      }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { preview: { html: string; css: string } };
    // the composed document is a FRAMED funnel doc with the honest preview ids
    expect(body.preview.html).toContain('data-funnel-id="lgf_preview"');
    expect(body.preview.html).toContain('data-quote-id="lgq_preview"');
    expect(body.preview.html).toContain("data-lg-section");
    expect(body.preview.html).toContain("lg-frame-slot");
    // template defaults only — no site branding rode in
    expect(body.preview.css).toContain(".lg-frame-region");
    // a default:true context never 404s and needs NO funnel_public_id
    expect(body.preview.html).not.toContain("Not Found");
  });
});
