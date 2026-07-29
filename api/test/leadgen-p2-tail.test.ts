// LeadGen R2 — Phase P2 TAIL round (post-FIX-FIRST, HEAD 00d60fb). Two
// known-class residuals inside quotes-tabs/funnel.ts, both closed by reusing
// an idiom the FIX-FIRST round already shipped for a sibling surface:
//
//   ITEM 1 — the A/B-slot dialog (openSharedAbEditor / openFunnelAbEditor,
//     both routing through the SAME saveSharedAb) used to CLOSE before its
//     save resolved, so a server rejection (the §4.3-13 per-funnel section-
//     uniqueness rule) surfaced as a board-level banner behind an already-
//     closed dialog. This applies the IDENTICAL onError idiom MINOR-4 (the
//     FIX-FIRST round) shipped for the ruled-slot dialog's saveSharedRuled,
//     plus a NEW live plain-language summary ("Splits traffic: 50% X / 50%
//     Y"), reusing the ruled dialog's OWN selectedOptionText helper.
//
//   ITEM 2 — quotes-tabs/funnel.ts's own one-Save theme path
//     (normalizedThemePut) still used the OLDER "drop theme_id the moment
//     an inline field is present" shape (R7's other sanctioned branch) even
//     after MINOR-1 upgraded quotes-tabs/themes.ts's OWN rail-edit save
//     (flushThemeEdits) to RESOLVE the preset into inline values first — a
//     residual themes.ts's own THEMES_TAB_SCRIPT header explicitly flagged
//     as open. This brings normalizedThemePut to the SAME resolve-then-
//     merge behavior via a shared theme-preset-resolve snippet BOTH islands
//     now import (extracted here since inlineThemeFromPreset was private to
//     themes.ts's template literal).
//
// Both islands are driven by EXECUTING the real served script text (a
// function/var sliced out of it) in a node:vm context — the repo's existing
// island-probe idiom (test/leadgen-p2-fixfirst-r2.test.ts, itself following
// test/leadgen-section-studio-ui.test.ts's studioProbe) — never by
// re-implementing the algorithm in the test. Item 2's assertion reads the
// funnel's ACTUAL persisted theme back through the real GET, over a real
// node:sqlite D1 (the same harness pattern; duplicated per this repo's own
// stated convention of per-file harness duplication — see
// src/scripts/capture-p3a-presplit.ts's header).

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import { mintPublicId } from "../src/leadgen/ids";
import type { Env } from "../src/env";

// --- node:sqlite D1 harness (repo pattern; see test/leadgen-quotes-ui.test.ts,
// test/leadgen-p2-fixfirst-r2.test.ts) -----------------------------------------

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
async function seedQuoteFull(env: Env): Promise<{ quote: string; funnel: string; variant: string }> {
  const created = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: `P2 tail ${mintPublicId("quote")}`, activity: "quote_funnel", verticals: ["auto"], funnel_name: "Auto" }),
      env,
    ),
    "create quote",
  );
  return { quote: created.public_id, funnel: created.funnels[0]!.public_id, variant: created.funnels[0]!.variants[0]!.public_id };
}

// --- island slicing (test/leadgen-p2-fixfirst-r2.test.ts's own idiom) ---------

function islandContaining(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at, `island containing ${marker}`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<script>", at);
  const end = html.indexOf("</script>", at);
  return html.slice(start + "<script>".length, end);
}
function funnelIsland(html: string): string {
  return islandContaining(html, "function saveSharedAb(");
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
function abArmRow(sectionName: string, pct: string): StubEl {
  const sectionSel = selectEl(sectionName);
  const pctInput = stubEl();
  pctInput.value = pct;
  const row = stubEl();
  row.querySelector = (sel: string): StubEl | null => {
    if (sel === "[data-ab-arm-section]") return sectionSel;
    if (sel === "[data-ab-arm-pct]") return pctInput;
    return null;
  };
  return row;
}

const SANDBOX_BUILTINS = { JSON, Object, String, Boolean, Number, Math, isFinite, encodeURIComponent };

let EDITOR_HTML = "";

describeDb("R2 P2 tail — item 1: the A/B-slot dialog stays open on a rejected save + live plain-language summary", () => {
  beforeAll(async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const { quote } = await seedQuoteFull(env);
    EDITOR_HTML = await (await admin.request(`/admin/leadgen/quotes/${quote}/edit`, {}, env)).text();
    sdb.close();
  });

  it("SSR ships the live-sentence sink beside the Σ summary (same [data-ab-error] neighbor position as the ruled dialog's [data-ruled-sentence])", () => {
    expect(EDITOR_HTML).toContain('<p class="form-help" data-ab-sentence role="status" aria-live="polite"></p>');
  });

  it("EXECUTED: refreshAbSentence renders 'Splits traffic: N% Section / N% Section' from the dialog's OWN current DOM state", () => {
    const island = funnelIsland(EDITOR_HTML);
    const out = stubEl();
    const arm1 = abArmRow("Mobile Landing", "50");
    const arm2 = abArmRow("Desktop Landing", "50");
    const dialog = stubEl();
    dialog.querySelector = (sel: string): StubEl | null => (sel === "[data-ab-sentence]" ? out : null);

    runInNewContext(
      [sliceIslandFunction(island, "selectedOptionText"), sliceIslandFunction(island, "refreshAbSentence"), "refreshAbSentence();"].join("\n"),
      {
        ...SANDBOX_BUILTINS,
        abDialog: dialog,
        abArms: () => [arm1, arm2],
        document: { createTextNode: (t: string) => stubEl(t) },
      },
    );

    expect(out.allText()).toBe("Splits traffic: 50% Mobile Landing / 50% Desktop Landing");
  });

  it("EXECUTED: a REJECTED save (the §4.3-13 uniqueness rule) keeps the dialog OPEN and renders the server's own message inside it (never a banner behind a closed dialog)", () => {
    const island = funnelIsland(EDITOR_HTML);
    const errorEl = stubEl();
    errorEl.className = "form-help lg-hidden";
    const dialog = stubEl();
    dialog.querySelector = (sel: string): StubEl | null => (sel === "[data-ab-error]" ? errorEl : null);
    const closes: number[] = [];
    let savedPut: Record<string, unknown> | null = null;
    const ctx = {
      save(put: Record<string, unknown>, onError: (m: string) => void) {
        savedPut = put;
        // What the real funnel-scope / shared-scope save does on the §4.3-13
        // uniqueness 400 (variantSaveUniquenessErrors's own field message).
        onError("'Mobile Landing' is already in this funnel — a section can appear once per funnel.");
      },
    };

    runInNewContext([sliceIslandFunction(island, "saveSharedAb"), "saveSharedAb();"].join("\n"), {
      ...SANDBOX_BUILTINS,
      abDialog: dialog,
      abCtx: ctx,
      abArms: () => [abArmRow("Mobile Landing", "50"), abArmRow("Mobile Landing", "50")],
      showErr: (el: StubEl, msg: string) => {
        el.textContent = msg;
        el.className = el.className.replace(/\s*lg-hidden/g, "");
      },
      hide: (el: StubEl) => {
        el.className = `${el.className.replace(/\s*lg-hidden/g, "")} lg-hidden`;
      },
      closeSharedAbEditor: () => {
        closes.push(1);
      },
    });

    expect(savedPut, "the save was actually attempted").not.toBeNull();
    expect((savedPut as unknown as { kind: string }).kind).toBe("ab");
    expect(closes.length, "FAIL-BEFORE: the dialog closed BEFORE the save ran, so the rejection landed behind it").toBe(0);
    expect(errorEl.textContent).toBe("'Mobile Landing' is already in this funnel — a section can appear once per funnel.");
    expect(errorEl.className).not.toContain("lg-hidden");
  });
});

// ===========================================================================
// ITEM 2 — funnel.ts's own one-Save theme path resolves a preset before
// merging the edit (mirrors MINOR-1's themes.ts regression, funnel-path
// variant), driven against the REAL admin router over a REAL node:sqlite D1.
// ===========================================================================

describeDb("R2 P2 tail — item 2: normalizedThemePut resolves a theme_id preset before merging workingTheme's edit", () => {
  it("apply preset → edit ONE palette role through the funnel-tab save path → GET the theme: the preset's OTHER palette roles survive, AND the edited role carries the new value", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const { quote, funnel } = await seedQuoteFull(env);

    const preset = await json<{ item: { id: string } }>(
      await admin.request(
        `${API}/themes`,
        jsonInit("POST", {
          name: "P2 Tail Preset",
          roles: { brand_primary: "#1B3A5C", accent: "#F5C518", page_bg: "#F4F6F9", card: "#FFFFFF", text: "#1A1F36", success: "#0E7C3A", error: "#B23A2C" },
          typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
          controls: { field_height: "medium", button_size: "m", corners: "rounded" },
        }),
        env,
      ),
      "create preset",
    );
    // "Apply to this funnel" — wireThemePresets's own PUT shape.
    await json(await admin.request(`${API}/funnels/${funnel}/theme`, jsonInit("PUT", { theme_json: { theme_id: preset.item.id } }), env), "apply preset");

    const editorHtml = await (await admin.request(`/admin/leadgen/quotes/${quote}/edit`, {}, env)).text();
    const island = funnelIsland(editorHtml);

    const calls: Array<{ url: string; method: string }> = [];
    const fetchShim = (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, method: (init?.method ?? "GET").toUpperCase() });
      return Promise.resolve(admin.request(`http://localhost${url}`, init as RequestInit, env));
    };

    let captured: Promise<{ ok: boolean; body: unknown }> | null = null;
    // normalizedThemePut's OWN parameter is the funnel base WITHOUT "/theme"
    // — it appends that itself (fetch(funnelBase + '/theme', ...)), exactly
    // like the real Save button's own `funnelBase` construction.
    const funnelBase = `${API}/funnels/${funnel}`;
    const src = [
      sliceIslandVar(island, "PRESET_ROLE_BRIDGE"),
      sliceIslandVar(island, "PRESET_EXTRA_ROLE_BRIDGE"),
      sliceIslandFunction(island, "hasAnyKey"),
      sliceIslandFunction(island, "inlineThemeFromPreset"),
      sliceIslandFunction(island, "isRecordVal"),
      sliceIslandFunction(island, "deepMerge"),
      sliceIslandFunction(island, "putJson"),
      sliceIslandFunction(island, "normalizedThemePut"),
      `__capture(normalizedThemePut(${JSON.stringify(funnelBase)}));`,
    ].join("\n");

    runInNewContext(src, {
      ...SANDBOX_BUILTINS,
      fetch: fetchShim,
      // The operator edited ONLY the "accent" swatch this session; workingTheme
      // still carries the theme_id the preset-apply reload left behind (R7's
      // exact described shape) — FAIL-BEFORE this drops the WHOLE preset the
      // moment this edit is present; FIXED this resolves + merges it.
      workingTheme: { theme_id: preset.item.id, palette: { accent: "#00AA55" }, version: 1 },
      __capture: (p: Promise<{ ok: boolean; body: unknown }>) => {
        captured = p;
      },
    });

    const saveRes = await captured!;
    expect(saveRes.ok, `theme PUT: ${JSON.stringify(saveRes.body)}`).toBe(true);
    expect(calls.some((c) => c.url.includes("/themes/") && c.method === "GET"), "resolved the preset record via GET").toBe(true);

    const after = await json<{ theme: Record<string, unknown> }>(await admin.request(`${API}/funnels/${funnel}/theme`, jsonInit("GET"), env), "read theme back");
    expect(after.theme).not.toHaveProperty("theme_id");
    const palette = (after.theme as { palette?: Record<string, string> }).palette ?? {};
    // FAIL-BEFORE: this object was exactly {palette:{accent:"#00AA55"},version:1}
    // — every OTHER preset role vanished the moment this one edit landed.
    expect(palette["brand_primary"]).toBe("#1B3A5C");
    expect(palette["page_background"]).toBe("#F4F6F9");
    expect(palette["card_background"]).toBe("#FFFFFF");
    expect(palette["text_primary"]).toBe("#1A1F36");
    expect(palette["success"]).toBe("#0E7C3A");
    expect(palette["error"]).toBe("#B23A2C");
    // ...and the edit itself DID apply (not just the untouched preset).
    expect(palette["accent"]).toBe("#00AA55");
    sdb.close();
  });
});
