// LeadGen R2 — Phase P2 FIX-FIRST round (adversarial review 2026-07-29).
// One block per fix, each with the reviewer's repro as the fail-before shape:
//
//   MAJOR-1 leg 2 — the Themes canvas posts the DRAFT theme explicitly
//     (frame_context.draft_theme, the Templates-canvas idiom) so a rail edit
//     renders without depending on the write round-trip. Leg 1 (the
//     resolveFrameComposition widening that makes an INLINE theme compose at
//     all) is pinned in test/leadgen-p7-default-frame.test.ts.
//   MAJOR-2 — the theme's card layout OWNS the column axis: ONE full-width
//     column (Image23 anatomy), never the 2-up half-width grid the section's
//     own `columns` default produced.
//   MINOR-1 — applying a preset then editing ONE control keeps the preset:
//     the rail RESOLVES the preset into inline values first. Driven through
//     the REAL island source against the REAL admin router + DB.
//   MINOR-4 — the ruled-slot dialog shows its generated plain-language
//     sentence LIVE, and a rejected save keeps the dialog open with the
//     server's message beside the controls.
//
// MINOR-3 (the last raw browser dialog in the A10 create flow) is pinned in
// test/leadgen-section-studio-ui.test.ts, alongside the ADJ-A10 modal it
// completes.
//
// The island fixes are driven by EXECUTING the real served script text (or a
// real function sliced out of it) in a node:vm context — the repo's existing
// island-probe idiom (test/leadgen-section-studio-ui.test.ts studioProbe) —
// never by re-implementing the algorithm in the test. For MINOR-1 the
// sandbox's fetch is wired straight into the real Hono admin router over a
// real node:sqlite D1, so the assertion reads the funnel's ACTUAL persisted
// theme back through the real GET.

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import { renderThemesTabPanel } from "../src/admin/leadgen/quotes-tabs/themes";
import { conditionsSentence } from "../src/admin/leadgen/ui-rules-builder";
import { renderComponent } from "../src/public/leadgen/components/presets";
import { getFunnelDesign } from "../src/public/leadgen/designs/registry";
import { resolveTokens, type ThemeJson } from "../src/public/leadgen/designs/theme";
import { mintPublicId } from "../src/leadgen/ids";
import type { Env } from "../src/env";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";

// ===========================================================================
// MAJOR-2 — the theme's card layout owns the column axis (pure render unit)
// ===========================================================================

type AnyDesign = Parameters<typeof renderComponent>[1];
const BASE_DESIGN = getFunnelDesign(null);
function effDesign(theme: ThemeJson): AnyDesign {
  return resolveTokens(BASE_DESIGN, theme).design as AnyDesign;
}
const CARD_THEME: ThemeJson = { button_defaults: { layout: "card" } };
const GRID_THEME: ThemeJson = { button_defaults: { layout: "grid" } };

function choices(n: number): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ label: `L${i}`, value: `v${i}`, analytics_id: `a${i}`, title: `T${i}`, subtitle: `S${i}` });
  }
  return out;
}
function groupNode(count: number, props?: Record<string, unknown>): LeadgenComponentNode {
  return {
    type: "ButtonAnswerGroup",
    question_id: "q_axis",
    internal_field: "axis",
    choices: choices(count),
    ...(props !== undefined ? { props } : {}),
  } as unknown as LeadgenComponentNode;
}

describe("R2 P2 FIX-FIRST MAJOR-2 — theme card layout owns the column axis (Image23 full-width stack)", () => {
  // FAIL-BEFORE: with the design's default 2-column answer grid and 5
  // choices, the §6.7 partial-row machinery emitted --lg-tracks + per-item
  // --lg-gc-end:"span 2"; a 2-track span against the card rule's single
  // explicit 1fr track makes the grid fabricate an implicit column — the live
  // 2-up half-width rows the review measured.
  it("no --lg-tracks and no per-item span survive under a card theme (they are what fabricated the implicit 2nd column)", () => {
    const cardHtml = renderComponent(groupNode(5), effDesign(CARD_THEME));
    expect(cardHtml).not.toContain("--lg-tracks");
    expect(cardHtml).not.toContain("--lg-gc-start");
    expect(cardHtml).not.toContain("--lg-gc-end");
    expect(cardHtml).toContain("--lg-cols:1");
    expect(cardHtml).toContain('data-btn-layout="card"');
  });

  it("the SAME node under a NON-card theme keeps the §6.7 centering machinery untouched (the fix is scoped to the card axis)", () => {
    const gridHtml = renderComponent(groupNode(5), effDesign(GRID_THEME));
    expect(gridHtml).toContain("--lg-tracks");
    expect(gridHtml).toContain("--lg-gc-end");
    expect(gridHtml).not.toContain('data-btn-layout="card"');
  });

  it("a section that authored columns:3 STILL renders one full-width column under a card theme — the theme owns the axis (contract §4 end-state 5)", () => {
    const html = renderComponent(groupNode(3, { columns: 3 }), effDesign(CARD_THEME));
    expect(html).toContain("--lg-cols:1");
    expect(html).not.toContain("--lg-cols:3");
    // …and the node's own columns still drives a NON-card theme, unchanged.
    const gridHtml = renderComponent(groupNode(3, { columns: 3 }), effDesign(GRID_THEME));
    expect(gridHtml).toContain("--lg-cols:3");
  });

  it("Image23 anatomy end-to-end: 5 title+subtitle rows + the Other row, all one-per-line (one CSS track at every viewport — no media-query override exists)", () => {
    const node = groupNode(5, {
      other: { enabled: true, label: "Other", choices: [{ label: "X", value: "x", analytics_id: "ox" }] },
    });
    const html = renderComponent(node, effDesign(CARD_THEME));
    for (let i = 0; i < 5; i += 1) {
      expect(html).toContain(`<span class="lg-tscard-title">T${i}</span>`);
      expect(html).toContain(`<span class="lg-tscard-subtitle">S${i}</span>`);
    }
    expect(html).toContain('class="lg-btn lg-btn-answer lg-tscard lg-other-trigger"');
    // Every card is a direct child of ONE single-track group: the row count
    // equals the child count (5 choices + Other), never half of it.
    const cardCount = (html.match(/class="lg-btn lg-btn-answer lg-tscard/g) ?? []).length;
    expect(cardCount).toBe(6);
  });

  it("TwoButtonYesNo under a card theme also stacks (its fixed pair is not exempt from the axis)", () => {
    const node = { type: "TwoButtonYesNo", question_id: "q_yn", internal_field: "insured" } as unknown as LeadgenComponentNode;
    const html = renderComponent(node, effDesign(CARD_THEME));
    expect(html).toContain("--lg-cols:1");
    expect(html).not.toContain("--lg-tracks");
  });
});

// ===========================================================================
// MINOR-4 — the ruled-slot dialog: live sentence + error stays in the dialog
// ===========================================================================

// The board island is read off the REAL editor page (the same route
// test/leadgen-rework-board.test.ts drives), never a hand-built structure —
// so the sliced functions are exactly the bytes an operator's browser runs.
let EDITOR_HTML = "";
function islandContaining(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at, `island containing ${marker}`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<script>", at);
  const end = html.indexOf("</script>", at);
  return html.slice(start + "<script>".length, end);
}
function boardIsland(): string {
  return islandContaining(EDITOR_HTML, "function saveSharedRuled(");
}
function sliceIslandFunction(island: string, name: string): string {
  const marker = `function ${name}(`;
  const start = island.indexOf(marker);
  expect(start, `island function ${name}`).toBeGreaterThan(-1);
  let depth = 0;
  let seenBody = false;
  for (let i = start; i < island.length; i += 1) {
    const ch = island[i];
    if (ch === "{") {
      depth += 1;
      seenBody = true;
    } else if (ch === "}") {
      depth -= 1;
      if (seenBody && depth === 0) return island.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced island function ${name}`);
}
function sliceIslandVar(island: string, name: string): string {
  const marker = `var ${name} = `;
  const start = island.indexOf(marker);
  expect(start, `island var ${name}`).toBeGreaterThan(-1);
  const end = island.indexOf("\n", start);
  return island.slice(start, end);
}

interface StubEl {
  textContent: string;
  className: string;
  firstChild: StubEl | null;
  children: StubEl[];
  value: string;
  selectedIndex: number;
  options: StubEl[];
  appendChild(c: StubEl): void;
  removeChild(c: StubEl): void;
  querySelector(sel: string): StubEl | null;
  allText(): string;
}
function stubEl(text = ""): StubEl {
  const el: StubEl = {
    textContent: text,
    className: "",
    firstChild: null,
    children: [],
    value: "",
    selectedIndex: -1,
    options: [],
    appendChild(c: StubEl) {
      el.children.push(c);
      el.firstChild = el.children[0] ?? null;
    },
    removeChild(c: StubEl) {
      el.children = el.children.filter((x) => x !== c);
      el.firstChild = el.children[0] ?? null;
    },
    querySelector() {
      return null;
    },
    allText() {
      return el.children.map((c) => c.textContent).join("");
    },
  };
  return el;
}
function selectEl(text: string): StubEl {
  const el = stubEl();
  const opt = stubEl(text);
  opt.value = text;
  el.options = [opt];
  el.selectedIndex = 0;
  el.value = text;
  return el;
}
function ruledCaseRow(field: string, op: string, value: string, sectionName: string, sectionValue: string): StubEl {
  const fieldSel = stubEl();
  fieldSel.value = field;
  const opSel = stubEl();
  opSel.value = op;
  const valueInput = stubEl();
  valueInput.value = value;
  const sectionSel = selectEl(sectionName);
  sectionSel.value = sectionValue;
  const row = stubEl();
  row.querySelector = (sel: string): StubEl | null => {
    if (sel === "[data-ruled-field]") return fieldSel;
    if (sel === "[data-ruled-op]") return opSel;
    if (sel === "[data-ruled-value]") return valueInput;
    if (sel === "[data-ruled-section]") return sectionSel;
    return null;
  };
  return row;
}


// ===========================================================================
// MAJOR-1 leg 2 + MINOR-1 — the Themes rail island, driven against the REAL
// admin router over a REAL node:sqlite D1.
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
  const store = new Map<string, { value: string; metadata: unknown }>();
  return {
    async get(key: string) {
      return store.has(key) ? store.get(key)!.value : null;
    },
    async getWithMetadata(key: string) {
      const e = store.get(key);
      return e ? { value: e.value, metadata: e.metadata ?? null } : { value: null, metadata: null };
    },
    async put(key: string, value: string, opts?: { metadata?: unknown }) {
      store.set(key, { value, metadata: opts?.metadata ?? null });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
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
  runSql(sdb, "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);");
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
const API = "/api/admin/leadgen";

function jsonInit(method: string, body?: unknown): RequestInit {
  return body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
async function json<T>(res: Response, label: string): Promise<T> {
  const body = (await res.json()) as T;
  expect(res.status, `${label}: ${JSON.stringify(body)}`).toBeLessThan(300);
  return body;
}

// --- the island sandbox ------------------------------------------------------
// A DOM small enough for THEMES_TAB_SCRIPT to boot, with fetch wired straight
// into the real router: every read/write the island performs is a real request.

interface IslandHandle {
  fire(kind: "change" | "click", target: Record<string, unknown>): void;
  // R2 P2 FIX-FIRST-2: the document-level palette seam quotes-tabs/funnel.ts
  // announces on (lg:palette-draft-change). `docListenerCount` proves the
  // island actually SUBSCRIBED (fail-before: zero listeners existed).
  dispatchDoc(type: string, detail: unknown): void;
  docListenerCount(type: string): number;
  statusText(): string;
  calls: Array<{ url: string; method: string; body: unknown }>;
  flushTimer(): void;
  settle(): Promise<void>;
}

function bootThemesIsland(env: Env, funnelPublicId: string, variantPublicId: string): IslandHandle {
  const html = renderThemesTabPanel(true);
  const script = html.slice(html.lastIndexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));

  const listeners: Record<string, Array<(ev: unknown) => void>> = { change: [], click: [] };
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const pending: Array<Promise<unknown>> = [];
  let timerFn: (() => void) | null = null;

  const el = (): Record<string, unknown> => ({
    textContent: "",
    className: "",
    style: {},
    firstChild: null,
    value: "",
    appendChild() {},
    removeChild() {},
    setAttribute() {},
    getAttribute: () => null,
    addEventListener(kind: string, fn: (ev: unknown) => void) {
      if (listeners[kind] !== undefined) listeners[kind]!.push(fn);
    },
    querySelectorAll: () => [],
    focus() {},
  });
  const rail = el();
  // Stable per-id elements: setStatus() writes to the SAME status node every
  // time, so a test can read what the operator would actually see.
  const stableById: Record<string, Record<string, unknown>> = {};
  const docListeners: Record<string, Array<(ev: unknown) => void>> = {};
  const editorRoot = {
    getAttribute(name: string) {
      if (name === "data-funnel-public-id") return funnelPublicId;
      if (name === "data-variant-public-id") return variantPublicId;
      return null;
    },
  };
  const root = {
    getAttribute: (n: string) => (n === "data-is-control" ? "true" : null),
    querySelectorAll: () => [],
  };
  const document = {
    querySelector(sel: string) {
      if (sel === "[data-lg-themes-tab]") return root;
      if (sel === "#lg-quote-editor") return editorRoot;
      return null;
    },
    getElementById(id: string) {
      if (id === "lg-theme-rail") return rail;
      if (stableById[id] === undefined) stableById[id] = el();
      return stableById[id];
    },
    createElement: () => el(),
    createTextNode: () => ({}),
    addEventListener(kind: string, fn: (ev: unknown) => void) {
      (docListeners[kind] ??= []).push(fn);
    },
  };
  const win = {
    setTimeout(fn: () => void) {
      timerFn = fn;
      return 1;
    },
    clearTimeout() {
      timerFn = null;
    },
  };
  const fetchShim = (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    let parsedBody: unknown = null;
    if (typeof init?.body === "string") {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    calls.push({ url, method, body: parsedBody });
    const p = Promise.resolve(admin.request(`http://localhost${url}`, init as RequestInit, env));
    pending.push(p);
    return p;
  };

  runInNewContext(script, { document, window: win, fetch: fetchShim, JSON, Object, String, Boolean, Number });

  return {
    fire(kind, target) {
      for (const fn of listeners[kind] ?? []) fn({ target });
    },
    dispatchDoc(type, detail) {
      for (const fn of docListeners[type] ?? []) fn({ type, detail });
    },
    docListenerCount(type) {
      return (docListeners[type] ?? []).length;
    },
    statusText() {
      return String(stableById["lg-theme-canvas-status"]?.["textContent"] ?? "");
    },
    calls,
    flushTimer() {
      const fn = timerFn;
      timerFn = null;
      if (fn !== null) fn();
    },
    async settle() {
      for (let i = 0; i < 25; i += 1) {
        await Promise.allSettled(pending.slice());
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  };
}

async function seedQuote(env: Env): Promise<{ funnel: string; variant: string }> {
  const created = await json<{ funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: `P2 fixfirst ${mintPublicId("quote")}`, activity: "quote_funnel", verticals: ["auto"], funnel_name: "Auto" }),
      env,
    ),
    "create quote",
  );
  return { funnel: created.funnels[0]!.public_id, variant: created.funnels[0]!.variants[0]!.public_id };
}

describeDb("R2 P2 FIX-FIRST MINOR-1 — a preset survives the first control edit (island → real router → real DB)", () => {
  it("apply preset → edit Corners: the funnel's persisted theme STILL carries the preset's palette, plus the radius edit", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const { funnel, variant } = await seedQuote(env);

    const preset = await json<{ item: { id: string } }>(
      await admin.request(
        `${API}/themes`,
        jsonInit("POST", {
          name: "Preset Survives",
          roles: { brand_primary: "#1B3A5C", accent: "#F5C518", page_bg: "#F4F6F9", card: "#FFFFFF", text: "#1A1F36", success: "#0E7C3A", error: "#B23A2C" },
          typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
          controls: { field_height: "medium", button_size: "m", corners: "rounded" },
        }),
        env,
      ),
      "create preset",
    );
    // "Apply to this funnel" — the existing button's own PUT shape.
    await json(await admin.request(`${API}/funnels/${funnel}/theme`, jsonInit("PUT", { theme_json: { theme_id: preset.item.id } }), env), "apply preset");

    const island = bootThemesIsland(env, funnel, variant);
    await island.settle();
    // Edit ONE control through the REAL rail listener: Corners = round.
    island.fire("change", { getAttribute: (n: string) => (n === "data-theme-key" ? "scales.radius" : null), value: "round" });
    island.flushTimer();
    await island.settle();

    const after = await json<{ theme: Record<string, unknown> }>(await admin.request(`${API}/funnels/${funnel}/theme`, jsonInit("GET"), env), "read theme back");
    // FAIL-BEFORE: this object was exactly {scales:{radius:"round"}} — the
    // preset was gone the moment the operator touched one control.
    expect(after.theme).not.toHaveProperty("theme_id");
    expect((after.theme as { scales?: { radius?: string } }).scales?.radius).toBe("round");
    const palette = (after.theme as { palette?: Record<string, string> }).palette ?? {};
    expect(palette["brand_primary"]).toBe("#1B3A5C");
    expect(palette["accent"]).toBe("#F5C518");
    expect(palette["page_background"]).toBe("#F4F6F9");
    expect(palette["card_background"]).toBe("#FFFFFF");
    expect(palette["text_primary"]).toBe("#1A1F36");
    sdb.close();
  });
});

describeDb("R2 P2 FIX-FIRST MAJOR-1 leg 2 — the Themes canvas posts the draft theme explicitly", () => {
  it("after a rail edit the canvas request carries frame_context.draft_theme, and the endpoint composes it (accepted, never ignored)", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const { funnel, variant } = await seedQuote(env);
    // The chooser needs a real active section to preview (the canvas is a
    // no-op with an empty library — exactly as it is in the product).
    await json(
      await admin.request(
        `${API}/sections`,
        jsonInit("POST", {
          section_name: "Canvas Target",
          headline_text: "Canvas Target",
          activity: "quote_funnel",
          vertical: "auto",
          status: "active",
          content_json: JSON.stringify({ components: [{ type: "ContinueButton", question_id: "q_c", props: { label: "Continue" } }] }),
        }),
        env,
      ),
      "seed a previewable section",
    );

    const island = bootThemesIsland(env, funnel, variant);
    await island.settle();
    island.fire("change", { getAttribute: (n: string) => (n === "data-theme-key" ? "scales.radius" : null), value: "round" });
    island.flushTimer();
    await island.settle();

    const previews = island.calls.filter((c) => c.url.includes("/sections/preview"));
    const withDraft = previews.filter((c) => {
      const ctx = (c.body as { frame_context?: Record<string, unknown> } | null)?.frame_context;
      return ctx !== undefined && ctx !== null && ctx["draft_theme"] !== undefined;
    });
    expect(withDraft.length, "at least one canvas render carried the explicit draft").toBeGreaterThan(0);
    const draft = (withDraft[0]!.body as { frame_context: { draft_theme: { scales?: { radius?: string } } } }).frame_context.draft_theme;
    expect(draft.scales?.radius).toBe("round");

    // The endpoint ACCEPTS the draft and composes under it — the same body
    // shape the island just posted, through the REAL route.
    const body = await json<{ preview: { css: string; html: string } }>(
      await admin.request(
        `${API}/sections/preview`,
        jsonInit("POST", {
          content_json: JSON.stringify({ components: [{ type: "ContinueButton", question_id: "q_c", props: { label: "Continue" } }] }),
          frame_context: { funnel_public_id: funnel, variant_public_id: variant, draft_theme: { palette: { brand_primary: "#00AA55" } } },
        }),
        env,
      ),
      "preview with draft_theme",
    );
    expect(body.preview.css).toContain("#00AA55");

    // A structurally invalid draft is REJECTED path-precisely (never silently
    // ignored) — the same validateTheme gate the stored column takes.
    const bad = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: JSON.stringify({ components: [{ type: "ContinueButton", question_id: "q_c", props: { label: "Continue" } }] }),
        frame_context: { funnel_public_id: funnel, variant_public_id: variant, draft_theme: { theme_id: "x", palette: { brand_primary: "#00AA55" } } },
      }),
      env,
    );
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { fields?: Record<string, string> }).fields?.["frame_context.draft_theme"]).toBeDefined();
    sdb.close();
  });
});

describeDb("R2 P2 FIX-FIRST MINOR-4 — ruled-slot dialog: live sentence + rejection stays in the dialog", () => {
  beforeAll(async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const created = await json<{ public_id: string }>(
      await admin.request(
        `${API}/quotes`,
        jsonInit("POST", { quote_name: `MINOR-4 board ${mintPublicId("quote")}`, activity: "quote_funnel", verticals: ["auto"], funnel_name: "Auto" }),
        env,
      ),
      "create quote for the board page",
    );
    EDITOR_HTML = await (await admin.request(`/admin/leadgen/quotes/${created.public_id}/edit`, {}, env)).text();
    sdb.close();
  });

  it("SSR ships the live-sentence sink, and every phrase template comes FROM conditionsSentence itself (cannot drift from the saved chip)", () => {
    expect(EDITOR_HTML).toContain('<p class="form-help" data-ruled-sentence role="status" aria-live="polite"></p>');
    const island = boardIsland();
    const line = sliceIslandVar(island, "SLOT_RULE_SENTENCE_TEMPLATES");
    const templates = JSON.parse(line.slice(line.indexOf("{"), line.lastIndexOf("}") + 1)) as Record<string, string>;
    for (const op of ["eq", "neq", "gt", "lt", "gte", "lte"]) {
      const expected = conditionsSentence(
        [{ field: "@@LG_SLOT_RULE_FIELD@@", op: op as never, value: "@@LG_SLOT_RULE_VALUE@@" }],
        () => "@@LG_SLOT_RULE_FIELD@@",
      ).replace(/\.$/, "");
      expect(templates[op], `op ${op}`).toBe(expected);
    }
  });

  it("EXECUTED: a device rule renders the generated sentence LIVE in the dialog (real island functions; the real TS generator is the oracle)", () => {
    const island = boardIsland();
    const out = stubEl();
    const caseRow = ruledCaseRow("device", "eq", "mobile", "Mobile Landing", "lgs_mobile");
    const defaultSel = selectEl("Default Landing");
    const dialog = stubEl();
    dialog.querySelector = (sel: string): StubEl | null => {
      if (sel === "[data-ruled-sentence]") return out;
      if (sel === "[data-ruled-default]") return defaultSel;
      return null;
    };

    runInNewContext(
      [
        sliceIslandVar(island, "SLOT_RULE_SENTENCE_TEMPLATES"),
        sliceIslandVar(island, "SLOT_RULE_FIELD_LABELS"),
        sliceIslandVar(island, "SLOT_RULE_SENTENCE_FIELD_TOKEN"),
        sliceIslandVar(island, "SLOT_RULE_SENTENCE_VALUE_TOKEN"),
        sliceIslandVar(island, "RULED_SENTENCE_ARROW"),
        sliceIslandVar(island, "RULED_SENTENCE_JOIN"),
        sliceIslandVar(island, "RULED_SENTENCE_OTHERWISE"),
        sliceIslandFunction(island, "selectedOptionText"),
        sliceIslandFunction(island, "ruledCaseSentence"),
        sliceIslandFunction(island, "refreshRuledSentence"),
        "refreshRuledSentence();",
      ].join("\n"),
      {
        ruledDialog: dialog,
        ruledCases: () => [caseRow],
        document: { createTextNode: (t: string) => stubEl(t) },
      },
    );

    const expected = `${conditionsSentence([{ field: "device", op: "eq", value: "mobile" }], (f) => (f === "device" ? "Device" : f)).replace(/\.$/, "")} → Mobile Landing; otherwise → Default Landing`;
    expect(out.allText()).toBe(expected);
    expect(out.allText()).toContain("Device is");
  });

  it("EXECUTED: a REJECTED save keeps the dialog OPEN and renders the server's own message inside it (never a banner behind a closed dialog)", () => {
    const island = boardIsland();
    const errorEl = stubEl();
    errorEl.className = "form-help lg-hidden";
    const defaultSel = selectEl("Default Landing");
    defaultSel.value = "lgs_default";
    const dialog = stubEl();
    dialog.querySelector = (sel: string): StubEl | null => {
      if (sel === "[data-ruled-error]") return errorEl;
      if (sel === "[data-ruled-default]") return defaultSel;
      return null;
    };
    const closes: number[] = [];
    let savedPut: Record<string, unknown> | null = null;
    const ctx = {
      save(put: Record<string, unknown>, onError: (m: string) => void) {
        savedPut = put;
        // What the real shared-page PUT does on a uniqueness conflict: the
        // island's firstFieldError() lifts the field message out of the 400.
        onError("Each section can appear only once on a page.");
      },
    };

    runInNewContext([sliceIslandFunction(island, "saveSharedRuled"), "saveSharedRuled();"].join("\n"), {
      ruledDialog: dialog,
      ruledCtx: ctx,
      ruledCases: () => [ruledCaseRow("device", "eq", "mobile", "Mobile Landing", "lgs_mobile")],
      showErr: (el: StubEl, msg: string) => {
        el.textContent = msg;
        el.className = el.className.replace(/\s*lg-hidden/g, "");
      },
      hide: (el: StubEl) => {
        el.className = `${el.className.replace(/\s*lg-hidden/g, "")} lg-hidden`;
      },
      closeSharedRuledEditor: () => {
        closes.push(1);
      },
    });

    expect(savedPut, "the save was actually attempted").not.toBeNull();
    expect((savedPut as unknown as { kind: string }).kind).toBe("ruled");
    expect(closes.length, "FAIL-BEFORE: the dialog closed BEFORE the save ran, so the rejection landed behind it").toBe(0);
    expect(errorEl.textContent).toBe("Each section can appear only once on a page.");
    expect(errorEl.className).not.toContain("lg-hidden");
  });
});

// ===========================================================================
// R2 P2 FIX-FIRST-2 (adversarial RE-review, 2026-07-29) — the residue of the
// round-1 fixes, each block opening on the reviewer's own driven repro.
//
//   FIX 1 (MAJOR-1 residue) — "two of the three Brand-primary affordances
//     still leave the Themes canvas byte-identical": the harmony steps and the
//     Advanced-hex Apply are owned by quotes-tabs/funnel.ts and only ever fed
//     ITS canvas. The convergent seam: funnel.ts's ONE palette write path
//     announces lg:palette-draft-change; the Themes island consumes it through
//     the SAME draft path (queueThemeEdit -> railDraftTheme -> refreshCanvas)
//     a select edit already takes. Producer and consumer are both EXECUTED
//     below, from the REAL served bytes.
//   FIX 2 (MINOR residue) — a preset's typography was discarded on the first
//     edit. Every family with an exact inline counterpart now resolves.
//   FIX 3 — the rejection branch now shows the server's OWN reason.
//   FIX 4 — an unreadable preset ABORTS the edit (fail-closed) instead of
//     PUTting an empty look over the operator's design.
// ===========================================================================

let FF2_EDITOR_HTML = "";

function ff2FunnelIsland(): string {
  return islandContaining(FF2_EDITOR_HTML, "function normalizedThemePut(");
}

// The preset a mappable-font test applies: BOTH families exist on the inline
// side too (theme.ts THEME_RECORD_FONT_STACKS reuses THEME_FONT_STACKS'
// values verbatim for the 8 self-hosted families).
const FONT_PRESET_BODY = {
  name: "Fonts Survive",
  roles: { brand_primary: "#1B3A5C", accent: "#F5C518", page_bg: "#F4F6F9", card: "#FFFFFF", text: "#1A1F36", success: "#0E7C3A", error: "#B23A2C" },
  typography: { headline_font: "Playfair Display", body_font: "Work Sans", base_px: 16, display_size: "xl" },
  controls: { field_height: "medium", button_size: "m", corners: "rounded" },
};

async function seedPreviewableSection(env: Env, name: string): Promise<void> {
  await json(
    await admin.request(
      `${API}/sections`,
      jsonInit("POST", {
        section_name: name,
        headline_text: name,
        activity: "quote_funnel",
        vertical: "auto",
        status: "active",
        content_json: JSON.stringify({ components: [{ type: "ContinueButton", question_id: "q_c", props: { label: "Continue" } }] }),
      }),
      env,
    ),
    "seed a previewable section",
  );
}

describeDb("R2 P2 FIX-FIRST-2 FIX 1 (producer) — every palette affordance announces ONE lg:palette-draft-change", () => {
  beforeAll(async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const created = await json<{ public_id: string }>(
      await admin.request(
        `${API}/quotes`,
        jsonInit("POST", { quote_name: `FF2 seam ${mintPublicId("quote")}`, activity: "quote_funnel", verticals: ["auto"], funnel_name: "Auto" }),
        env,
      ),
      "create quote for the editor page",
    );
    FF2_EDITOR_HTML = await (await admin.request(`/admin/leadgen/quotes/${created.public_id}/edit`, {}, env)).text();
    sdb.close();
  });

  // FAIL-BEFORE: applyPaletteValue ended at writeThemeValue — the value never
  // left this island, so the Themes tab's canvas could not learn about it.
  it("EXECUTED: the REAL harmony math + the REAL hex gate + the REAL alias rule each emit the resolved (role, value) exactly once", () => {
    const island = ff2FunnelIsland();
    const emitted: Array<{ role: string; value: unknown }> = [];
    const roleSel = { value: "" };
    const valueEl = { value: "" };
    const errors: string[] = [];

    const src = [
      sliceIslandFunction(island, "hexToRgb"),
      sliceIslandFunction(island, "channelHex"),
      sliceIslandFunction(island, "mixHex"),
      sliceIslandFunction(island, "harmonyValue"),
      sliceIslandFunction(island, "emitPaletteDraft"),
      sliceIslandFunction(island, "applyPaletteValue"),
      sliceIslandFunction(island, "applyAdvancedHex"),
      // (1) harmony "Base" — the ROLE-VALUE alias branch of the real handler.
      "applyPaletteValue('brand_primary', 'brand_primary');",
      // (2) harmony "Darker" — the real handler fills the Advanced controls
      //     from harmonyValue() and routes through the real hex gate.
      "var derived = harmonyValue('brand_primary', 'darker');",
      "__derived(derived);",
      "roleSel.value = 'brand_primary'; valueEl.value = derived; applyAdvancedHex();",
      // (3) a typed Advanced hex (the operator's own #FF00FF).
      "roleSel.value = 'brand_primary'; valueEl.value = '#FF00FF'; applyAdvancedHex();",
      // (4) a MALFORMED hex must still be refused — and must NOT announce.
      "roleSel.value = 'brand_primary'; valueEl.value = 'magenta'; applyAdvancedHex();",
    ].join("\n");

    let derivedSeen = "";
    runInNewContext(src, {
      Math,
      RegExp,
      String,
      parseInt,
      document: {
        createEvent: () => ({
          initCustomEvent(type: string, _b: boolean, _c: boolean, detail: { role: string; value: unknown }) {
            (this as unknown as { __t: string; __d: unknown }).__t = type;
            (this as unknown as { __t: string; __d: unknown }).__d = detail;
          },
        }),
        dispatchEvent(ev: { __t: string; __d: { role: string; value: unknown } }) {
          expect(ev.__t, "the seam's event name").toBe("lg:palette-draft-change");
          emitted.push(ev.__d);
        },
      },
      // The two Advanced-panel controls the real handler drives, reachable
      // both by the island's own byId() and by the driver lines above.
      roleSel,
      valueEl,
      byId: (id: string) => (id === "lg-theme-hex-role" ? roleSel : id === "lg-theme-hex-value" ? valueEl : null),
      showMsg: (_id: string, m: string) => errors.push(m),
      hideMsg: () => {},
      themeOverrideActive: () => false,
      // applyPaletteValue's own collaborators (this slice does not re-implement
      // them; they are the funnel tab's canvas/dirty bookkeeping).
      isControl: true,
      overrideMode: {},
      workingTheme: {},
      workingOverrides: {},
      isRecordVal: (v: unknown) => v !== null && typeof v === "object",
      writeThemeValue: () => {},
      paintSwatches: () => {},
      markStripSelection: () => {},
      // P8-1 K1: updateOverrideBadge() is removed from quotes-tabs/funnel.ts
      // (dead code — the badge it painted has been null on every served page
      // since the §8.2/§10 canvas rewrite); applyPaletteValue's sliced body no
      // longer calls it, so this manifest carries no stub for it either.
      schedulePreview: () => {},
      markDirty: () => {},
      baseTokens: { brand_primary: "#1B3A5C" },
      tokens: { brand_primary: "#1B3A5C" },
      __derived: (d: string) => {
        derivedSeen = d;
      },
    });

    // The real mix math, not a re-implementation: 0x1B*0.75 = 20.25 -> 14.
    expect(derivedSeen).toBe("#142c45");
    expect(errors, "the malformed hex was refused by the REAL gate").toEqual([
      "Custom colors must be a color value like #1a2b3c.",
    ]);
    expect(emitted).toEqual([
      { role: "brand_primary", value: "brand_primary" },
      { role: "brand_primary", value: "#142c45" },
      { role: "brand_primary", value: "#FF00FF" },
    ]);
  });

  it("the served editor page wires BOTH previously-dead affordances into that one path (harmony steps -> applyAdvancedHex, Apply button -> applyAdvancedHex)", () => {
    const island = ff2FunnelIsland();
    // the harmony click handler's derived branch ends in applyAdvancedHex()
    expect(island).toContain("if (adv) { adv.open = true; }\n    applyAdvancedHex();");
    // the Advanced "Apply" button
    expect(island).toContain("apply.addEventListener('click', applyAdvancedHex);");
    // and the ONE write path announces
    expect(island).toContain("emitPaletteDraft(role, value);");
  });
});

describeDb("R2 P2 FIX-FIRST-2 FIX 1 (consumer) — an announced palette change moves the Themes canvas with NO Save", () => {
  it("EXECUTED: the island subscribes to the seam, renders the draft, and persists it (harmony/hex reach the canvas at last)", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const { funnel, variant } = await seedQuote(env);
    await seedPreviewableSection(env, "Seam Canvas Target");

    const island = bootThemesIsland(env, funnel, variant);
    await island.settle();
    // FAIL-BEFORE: zero — the island had no document-level listener at all.
    expect(island.docListenerCount("lg:palette-draft-change")).toBe(1);

    const before = island.calls.filter((c) => c.url.includes("/sections/preview")).length;
    island.dispatchDoc("lg:palette-draft-change", { role: "brand_primary", value: "#FF00FF" });
    island.flushTimer();
    await island.settle();

    const previews = island.calls.filter((c) => c.url.includes("/sections/preview"));
    expect(previews.length, "the canvas re-rendered for the announced change").toBeGreaterThan(before);
    const drafted = previews.filter((c) => {
      const ctx = (c.body as { frame_context?: { draft_theme?: { palette?: Record<string, string> } } } | null)?.frame_context;
      return ctx?.draft_theme?.palette?.["brand_primary"] === "#FF00FF";
    });
    expect(drafted.length, "the DRAFT (pre-Save) carried the announced colour").toBeGreaterThan(0);

    // ...and the same seam persisted it through the REAL funnel theme PUT.
    const after = await json<{ theme: { palette?: Record<string, string> } }>(
      await admin.request(`${API}/funnels/${funnel}/theme`, jsonInit("GET"), env),
      "read theme back",
    );
    expect(after.theme.palette?.["brand_primary"]).toBe("#FF00FF");
    sdb.close();
  });

  it("EXECUTED: value null (Reset to inherited) DELETES the role rather than writing a null the validator would refuse", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const { funnel, variant } = await seedQuote(env);
    await seedPreviewableSection(env, "Reset Canvas Target");

    const island = bootThemesIsland(env, funnel, variant);
    await island.settle();
    island.dispatchDoc("lg:palette-draft-change", { role: "brand_primary", value: "#FF00FF" });
    island.flushTimer();
    await island.settle();
    island.dispatchDoc("lg:palette-draft-change", { role: "brand_primary", value: null });
    island.flushTimer();
    await island.settle();

    const puts = island.calls.filter((c) => c.method === "PUT" && c.url.includes("/theme"));
    expect(puts.length, "both edits were written through the real route").toBe(2);
    const last = (puts[puts.length - 1]!.body as { theme_json: { palette?: Record<string, string> } }).theme_json;
    expect(last.palette?.["brand_primary"], "the reset PUT carries no null value").toBeUndefined();
    const after = await json<{ theme: { palette?: Record<string, string> } }>(
      await admin.request(`${API}/funnels/${funnel}/theme`, jsonInit("GET"), env),
      "read theme back",
    );
    expect(after.theme.palette?.["brand_primary"]).toBeUndefined();
    sdb.close();
  });
});

describeDb("R2 P2 FIX-FIRST-2 FIX 2 — a preset's mappable fonts survive the first edit (both save paths)", () => {
  it("rail path: apply a Playfair/Work Sans preset -> ONE rail edit -> the stored theme still carries BOTH fonts", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const { funnel, variant } = await seedQuote(env);
    const preset = await json<{ item: { id: string } }>(
      await admin.request(`${API}/themes`, jsonInit("POST", FONT_PRESET_BODY), env),
      "create preset",
    );
    await json(await admin.request(`${API}/funnels/${funnel}/theme`, jsonInit("PUT", { theme_json: { theme_id: preset.item.id } }), env), "apply preset");

    const island = bootThemesIsland(env, funnel, variant);
    await island.settle();
    island.fire("change", { getAttribute: (n: string) => (n === "data-theme-key" ? "scales.radius" : null), value: "round" });
    island.flushTimer();
    await island.settle();

    const after = await json<{ theme: Record<string, unknown> }>(
      await admin.request(`${API}/funnels/${funnel}/theme`, jsonInit("GET"), env),
      "read theme back",
    );
    const typo = (after.theme as { typography?: Record<string, string> }).typography ?? {};
    // FAIL-BEFORE: typography was exactly {"display_size":"xl"} — both fonts
    // were silently discarded on the operator's very first edit.
    expect(typo["display"]).toBe("playfair");
    expect(typo["body"]).toBe("work_sans");
    expect(typo["display_size"]).toBe("xl");
    expect((after.theme as { scales?: { radius?: string } }).scales?.radius).toBe("round");
    // Honest about the edge the inline vocabulary genuinely cannot express:
    // theme_json has NO controls axis (validateTheme's THEME_TOP_KEYS would
    // reject the key outright), so controls.* still resolves from the base.
    expect(after.theme).not.toHaveProperty("controls");
    sdb.close();
  });

  it("funnel one-Save path: normalizedThemePut resolves the SAME fonts (one shared algorithm, not two)", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const { funnel } = await seedQuote(env);
    const preset = await json<{ item: { id: string } }>(
      await admin.request(`${API}/themes`, jsonInit("POST", FONT_PRESET_BODY), env),
      "create preset",
    );
    await json(await admin.request(`${API}/funnels/${funnel}/theme`, jsonInit("PUT", { theme_json: { theme_id: preset.item.id } }), env), "apply preset");

    const island = ff2FunnelIsland();
    const fetchShim = (url: string, init?: RequestInit): Promise<Response> =>
      Promise.resolve(admin.request(`http://localhost${url}`, init as RequestInit, env));
    let captured: Promise<{ ok: boolean; body: unknown }> | null = null;
    const src = [
      sliceIslandVar(island, "PRESET_ROLE_BRIDGE"),
      sliceIslandVar(island, "PRESET_EXTRA_ROLE_BRIDGE"),
      sliceIslandVar(island, "PRESET_FONT_BRIDGE"),
      // Terminal F-1b: inlineThemeFromPreset now also reads this bridge to
      // carry the preset's Corners across the fork.
      sliceIslandVar(island, "PRESET_CORNERS_BRIDGE"),
      // R2 F-3: inlineThemeFromPreset also reads these two bridges now, to carry
      // the preset's Button size / Field height across the same fork.
      sliceIslandVar(island, "PRESET_BUTTON_SIZE_BRIDGE"),
      sliceIslandVar(island, "PRESET_FIELD_HEIGHT_BRIDGE"),
      sliceIslandVar(island, "PRESET_LOAD_FAILED_MESSAGE"),
      sliceIslandFunction(island, "hasAnyKey"),
      sliceIslandFunction(island, "presetFontId"),
      sliceIslandFunction(island, "inlineThemeFromPreset"),
      sliceIslandFunction(island, "presetLoadError"),
      sliceIslandFunction(island, "presetInlineOrAbort"),
      sliceIslandFunction(island, "isRecordVal"),
      sliceIslandFunction(island, "deepMerge"),
      sliceIslandFunction(island, "putJson"),
      sliceIslandFunction(island, "normalizedThemePut"),
      `__capture(normalizedThemePut(${JSON.stringify(`${API}/funnels/${funnel}`)}));`,
    ].join("\n");
    runInNewContext(src, {
      JSON,
      Object,
      String,
      Boolean,
      Number,
      encodeURIComponent,
      fetch: fetchShim,
      // P8-1 J1 (review #4, F-1) MANIFEST ENTRY: normalizedThemePut now
      // REJECTS an unreadable theme GET through this helper (quotes-tabs/
      // funnel.ts) instead of merging onto {} and PUTting the funnel's whole
      // theme away. This slice drives the READABLE path, so the manifest
      // carries a stub, not the board-blob chain the real helper names.
      themeReadAbortError: (body: unknown) => new Error(`theme read failed: ${JSON.stringify(body)}`),
      workingTheme: { theme_id: preset.item.id, scales: { radius: "round" }, version: 1 },
      __capture: (p: Promise<{ ok: boolean; body: unknown }>) => {
        captured = p;
      },
    });
    const saveRes = await captured!;
    expect(saveRes.ok, `theme PUT: ${JSON.stringify(saveRes.body)}`).toBe(true);

    const after = await json<{ theme: Record<string, unknown> }>(
      await admin.request(`${API}/funnels/${funnel}/theme`, jsonInit("GET"), env),
      "read theme back",
    );
    const typo = (after.theme as { typography?: Record<string, string> }).typography ?? {};
    expect(typo["display"]).toBe("playfair");
    expect(typo["body"]).toBe("work_sans");
    expect((after.theme as { scales?: { radius?: string } }).scales?.radius).toBe("round");
    sdb.close();
  });
});

describeDb("R2 P2 FIX-FIRST-2 FIX 3 + FIX 4 — the rail tells the truth when a write is refused or a preset cannot be read", () => {
  it("FIX 3: a REJECTED theme PUT shows the server's OWN reason, not just 'Validation failed'", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const { funnel, variant } = await seedQuote(env);
    await seedPreviewableSection(env, "Rejection Canvas Target");

    const island = bootThemesIsland(env, funnel, variant);
    await island.settle();
    // A font id outside the curated vocabulary — the REAL validateTheme
    // refuses it with a per-problem message.
    island.fire("change", { getAttribute: (n: string) => (n === "data-theme-key" ? "typography.display" : null), value: "comic_sans" });
    island.flushTimer();
    await island.settle();

    const rejected = island.calls.filter((c) => c.method === "PUT" && c.url.includes("/theme"));
    expect(rejected.length, "the write was attempted (and refused)").toBe(1);
    const status = island.statusText();
    // FAIL-BEFORE: exactly "Validation failed" — the operator was never told
    // WHICH setting was refused or why.
    expect(status).toContain("Validation failed");
    expect(status).toContain("curated fonts");
    sdb.close();
  });

  it("FIX 4: an unreadable preset ABORTS the edit — no PUT, the stored theme is untouched, the operator is told", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const kv = makeKvStub();
    const env = buildEnv(d1FromSqlite(sdb), kv);
    const { funnel, variant } = await seedQuote(env);
    await seedPreviewableSection(env, "Failclosed Canvas Target");
    const preset = await json<{ item: { id: string } }>(
      await admin.request(`${API}/themes`, jsonInit("POST", FONT_PRESET_BODY), env),
      "create preset",
    );
    await json(await admin.request(`${API}/funnels/${funnel}/theme`, jsonInit("PUT", { theme_json: { theme_id: preset.item.id } }), env), "apply preset");
    // The preset record disappears from under the funnel (the KV catalog the
    // themes handler reads) — the funnel still points at it.
    await kv.delete("lg-funnel-themes");
    expect((await admin.request(`${API}/themes/${preset.item.id}`, jsonInit("GET"), env)).status).toBe(404);

    const island = bootThemesIsland(env, funnel, variant);
    await island.settle();
    island.fire("change", { getAttribute: (n: string) => (n === "data-theme-key" ? "scales.radius" : null), value: "round" });
    island.flushTimer();
    await island.settle();

    // FAIL-BEFORE: inlineThemeFromPreset(undefined) produced {}, and this PUT
    // wiped the funnel's whole look with no error shown at all.
    expect(island.calls.filter((c) => c.method === "PUT").length, "no write was attempted").toBe(0);
    expect(island.statusText()).toBe("Couldn’t load the preset — the change was not applied.");
    const after = await json<{ theme: Record<string, unknown> }>(
      await admin.request(`${API}/funnels/${funnel}/theme`, jsonInit("GET"), env),
      "read theme back",
    );
    expect(after.theme["theme_id"], "the stored theme is byte-for-byte what it was").toBe(preset.item.id);
    sdb.close();
  });
});
