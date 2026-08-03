// LeadGen R2 P8-3 — SLICE S3.2 "the theme controls say what they mean".
// Owner verbatim (SOURCE-OF-TRUTH.md): "theme is only design language!!!!
// colors, fonts, sizes" — the operator is a marketer, not an engineer.
// Contract minors N1/N7/N11/N20 (§7), against the REAL rendered admin
// markup produced by the REAL render functions (renderThemesTabPanel for the
// rail; the real admin router for the standalone Themes manager page) — never
// a hand-assembled string — and, for N11's runtime behaviour, the REAL served
// island script executed in a node:vm sandbox wired to the REAL admin router
// over a REAL node:sqlite D1 (the repo's existing island-probe idiom, e.g.
// test/leadgen-p2-fixfirst-r2.test.ts's bootThemesIsland).
//
//   N1  — Button corners / Card corners / Card shadow showed raw enum
//         members (sm|md|lg|xl|full / none|sm|md|lg|xl) as the visible
//         option text. Fixed with the SAME existing mechanism every other
//         rail control already uses (themeSelect's optional label map) —
//         never a second one. (The contract also named a "Base visual
//         design" control with raw `default`/`default-funnel` options — found
//         at quotes-tabs/funnel.ts:555, OUTSIDE this slice's owned files; not
//         touched here, reported to the conductor instead.)
//   N7  — the shared blank/current-value option ("Inherit from base
//         design") truncates in the rail's 2-column `.lg-scalars` grid
//         (shared.ts, not owned) under `.form-select{width:100%}`
//         (templates/layout.ts, not owned) — the only in-scope lever is the
//         string itself, shortened here.
//   N11 — "Apply to this funnel" / "A/B this theme" offered themselves as
//         ready even with ZERO saved presets (contract §4 R3 corollary: "a
//         control that cannot be honoured must not be offered"). Proved
//         BIDIRECTIONALLY: zero presets (disabled + honest copy) AND at
//         least one preset (enabled + the original copy).
//   N20 — the rail (THEME_FONT_IDS) and the standalone Themes manager
//         (THEME_RECORD_FONT_NAMES) offered two disjoint font vocabularies;
//         fonts.generated.ts's LEADGEN_SELF_HOSTED_FONT_FAMILIES is the only
//         8 the renderer actually serves. Proved BIDIRECTIONALLY: a preset
//         storing a LEGACY font (still selectable, labelled, byte-identical
//         render) AND a preset storing a FRESH self-hosted font (no legacy
//         suffix), on the manager; plus the rail's own SSR ordering.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import { renderThemesTabPanel } from "../src/admin/leadgen/quotes-tabs/themes";
import type { Env } from "../src/env";

// --- node:sqlite harness (repo pattern — duplicated per test file, e.g. ---
// --- test/leadgen-theme-manager-ui.test.ts, leadgen-p2-fixfirst-r2.test.ts)

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
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
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

function newHarness(): { sdb: SqliteDb; env: Env } {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), makeKvStub()) };
}
function jsonInit(method: string, body?: unknown): RequestInit {
  return body === undefined ? { method } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
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
function presetBody(name: string, headlineFont: string, bodyFont: string): Record<string, unknown> {
  return {
    name,
    roles: { brand_primary: "#1B3A5C", accent: "#F5C518", page_bg: "#F4F6F9", card: "#FFFFFF", text: "#1A1F36", success: "#0E7C3A", error: "#B23A2C" },
    typography: { headline_font: headlineFont, body_font: bodyFont, base_px: 16 },
    controls: { field_height: "medium", button_size: "m", corners: "rounded" },
  };
}
interface ThemeCreateResponse {
  item: { id: string };
}

// --- markup extraction: find ONE <select>...</select> by an attribute it --
// --- carries, so an assertion is scoped to the exact control under test ---
function selectBlock(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at, `marker ${marker}`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<select", at);
  const end = html.indexOf("</select>", at) + "</select>".length;
  expect(start, `<select for ${marker}`).toBeGreaterThan(-1);
  return html.slice(start, end);
}

// ===========================================================================
// N1 — raw enum tokens are no longer the visible label (rail, pure SSR)
// ===========================================================================

describe("N1 — theme rail: Button/Card corners + Card shadow show design words, not raw enum members", () => {
  const html = renderThemesTabPanel(true);

  it("Button corners: sm/md/lg/xl/full render as Small/Medium/Large/Extra large/Fully round; every stored VALUE is unchanged", () => {
    const block = selectBlock(html, 'data-theme-key="button_defaults.radius"');
    expect(block).toContain('value="sm"');
    expect(block).toContain('value="md"');
    expect(block).toContain('value="lg"');
    expect(block).toContain('value="xl"');
    expect(block).toContain('value="full"');
    expect(block).toContain(">Small<");
    expect(block).toContain(">Medium<");
    expect(block).toContain(">Large<");
    expect(block).toContain(">Extra large<");
    expect(block).toContain(">Fully round<");
    expect(block).not.toContain(">sm<");
    expect(block).not.toContain(">md<");
    expect(block).not.toContain(">lg<");
    expect(block).not.toContain(">xl<");
    expect(block).not.toContain(">full<");
  });

  it("Card corners: the SAME label map (no second mechanism invented)", () => {
    const block = selectBlock(html, 'data-theme-key="card_defaults.radius"');
    expect(block).toContain('value="sm"');
    expect(block).toContain(">Small<");
    expect(block).not.toContain(">sm<");
    expect(block).not.toContain(">full<");
  });

  it("Card shadow: none/sm/md/lg/xl render as None/Small/Medium/Large/Extra large", () => {
    const block = selectBlock(html, 'data-theme-key="card_defaults.shadow"');
    expect(block).toContain('value="none"');
    expect(block).toContain(">None<");
    expect(block).toContain('value="xl"');
    expect(block).toContain(">Extra large<");
    expect(block).not.toContain(">none<");
    expect(block).not.toContain(">xl<");
  });

  it("ADJACENT DEFECT (not in this slice's owned files): the contract's third named control, 'Base visual design', lives at quotes-tabs/funnel.ts:555 (<select id=\"lg-funnel-design\">), rendering raw design ids via designOptions — reported, not fixed here", () => {
    expect(html).not.toContain('id="lg-funnel-design"');
  });
});

// ===========================================================================
// N7 — the blank/current-value option no longer truncates itself
// ===========================================================================

describe("N7 — the shared blank option is short enough not to be its own truncation", () => {
  it("every themeSelect-based control (16 of them) uses the shortened 'Inherit from base' text; the stored value is still the empty (inherit) string", () => {
    const html = renderThemesTabPanel(true);
    // Scoped to the RENDERED <option> element itself (not the whole page):
    // a pre-existing, unrelated island comment (P8-1 F6's own FAIL-BEFORE
    // narrative, quoting the OLD text as history) still contains the phrase
    // "Inherit from base design" in prose, so a page-wide substring check
    // would be a false positive here — the option markup is the actual claim.
    expect(html).not.toMatch(/<option value="">Inherit from base design<\/option>/);
    const occurrences = html.match(/<option value="">Inherit from base<\/option>/g) ?? [];
    expect(occurrences.length).toBe(16);
  });
});

// ===========================================================================
// N20 (rail half) — fresh (self-hosted) fonts first, legacy last, labelled
// ===========================================================================

describe("N20 — theme rail: fresh self-hosted fonts sort first, legacy (not self-hosted) sort last and say so", () => {
  it("Display font: all 8 self-hosted ids precede all 3 legacy ids; every id (fresh AND legacy) stays a selectable value", () => {
    const html = renderThemesTabPanel(true);
    const block = selectBlock(html, 'data-theme-key="typography.display"');
    for (const id of ["poppins", "space_grotesk", "fraunces", "playfair", "manrope", "dm_sans", "work_sans", "lexend"]) {
      expect(block, id).toContain(`value="${id}"`);
    }
    for (const id of ["literata", "sora", "system"]) {
      expect(block, id).toContain(`value="${id}"`);
    }
    expect(block).toContain(">Poppins<");
    // FIX ROUND F2: "(legacy)" was engineering jargon printed to a marketer
    // (jargon-scan.mjs's gate correctly rejected it) — re-pinned to the
    // plain-English outcome label. Strictness unchanged: still an exact
    // substring pin on the rendered <option> text, still asserting the same
    // fresh-first/unavailable-last ordering below.
    expect(block).toContain(">Literata (shows as default font)<");
    expect(block).toContain(">Sora (shows as default font)<");
    expect(block).toContain(">System (shows as default font)<");
    const lastFreshAt = block.indexOf(">Lexend<");
    const firstLegacyAt = block.indexOf("(shows as default font)");
    expect(lastFreshAt).toBeGreaterThan(-1);
    expect(firstLegacyAt).toBeGreaterThan(lastFreshAt);
  });

  it("Body font: the SAME ordering (one shared list, not a per-field re-derivation)", () => {
    const html = renderThemesTabPanel(true);
    const block = selectBlock(html, 'data-theme-key="typography.body"');
    expect(block.indexOf(">Manrope<")).toBeGreaterThan(-1);
    expect(block.indexOf("(shows as default font)")).toBeGreaterThan(block.indexOf(">Manrope<"));
  });
});

// ===========================================================================
// N11 — "Apply to this funnel" / "A/B this theme" are honest about presets
// (contract §4 R3 corollary). DRIVEN through the REAL served island script.
// ===========================================================================

interface MinimalIslandHandle {
  elementById(id: string): Record<string, unknown>;
  settle(): Promise<void>;
}

function bootThemesIslandMinimal(env: Env): MinimalIslandHandle {
  const html = renderThemesTabPanel(true);
  const script = html.slice(html.lastIndexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));

  const pending: Array<Promise<unknown>> = [];
  const stableById: Record<string, Record<string, unknown>> = {};
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
    addEventListener() {},
    querySelectorAll: () => [],
    focus() {},
  });
  const root = { getAttribute: (n: string) => (n === "data-is-control" ? "true" : null), querySelectorAll: () => [] };
  const editorRoot = { getAttribute: () => null };
  const document = {
    querySelector(sel: string) {
      if (sel === "[data-lg-themes-tab]") return root;
      if (sel === "#lg-quote-editor") return editorRoot;
      return null;
    },
    getElementById(id: string) {
      if (stableById[id] === undefined) stableById[id] = el();
      return stableById[id]!;
    },
    createElement: () => el(),
    createTextNode: () => ({}),
    addEventListener() {},
  };
  const win = {
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  };
  const fetchShim = (url: string, init?: RequestInit): Promise<Response> => {
    const p = Promise.resolve(admin.request(`http://localhost${url}`, init as RequestInit, env));
    pending.push(p);
    return p;
  };

  runInNewContext(script, { document, window: win, fetch: fetchShim, JSON, Object, String, Boolean, Number });

  return {
    elementById(id) {
      if (stableById[id] === undefined) stableById[id] = el();
      return stableById[id]!;
    },
    async settle() {
      for (let i = 0; i < 25; i += 1) {
        await Promise.allSettled(pending.slice());
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  };
}

describeDb("N11 — zero presets: both actions render disabled, and stay disabled once confirmed", () => {
  it("SSR default already agrees (disabled + neutral copy) before any fetch resolves", () => {
    const html = renderThemesTabPanel(true);
    expect(html).toContain('id="lg-theme-preset-apply" disabled');
    expect(html).toContain('id="lg-theme-ab-this" disabled');
    expect(html).toContain('id="lg-theme-preset-help">Checking for saved presets');
  });

  it("EXECUTED: with the REAL /api/admin/leadgen/themes list confirmed empty, the buttons stay disabled and the help text says there is nothing to apply", async () => {
    const { env } = newHarness();
    const island = bootThemesIslandMinimal(env);
    await island.settle();
    const applyBtn = island.elementById("lg-theme-preset-apply");
    const abBtn = island.elementById("lg-theme-ab-this");
    const helpEl = island.elementById("lg-theme-preset-help");
    expect(applyBtn["disabled"]).toBe(true);
    expect(abBtn["disabled"]).toBe(true);
    expect(String(helpEl["textContent"])).toContain("No presets saved yet");
    expect(String(applyBtn["title"])).toContain("No presets saved yet");
  });
});

describeDb("N11 — at least one preset: both actions become available and the copy reverts to the original", () => {
  it("EXECUTED: with the REAL list confirmed non-empty, the buttons enable and the help text is the pre-existing wording (byte-identical to before this fix)", async () => {
    const { env } = newHarness();
    await json<ThemeCreateResponse>(await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Ready Preset", "Inter", "Inter")), env), "create preset");

    const island = bootThemesIslandMinimal(env);
    await island.settle();
    const applyBtn = island.elementById("lg-theme-preset-apply");
    const abBtn = island.elementById("lg-theme-ab-this");
    const helpEl = island.elementById("lg-theme-preset-help");
    expect(applyBtn["disabled"]).toBe(false);
    expect(abBtn["disabled"]).toBe(false);
    expect(String(helpEl["textContent"])).toBe(
      "Save the current look as a reusable preset from the Themes manager, then apply or delete any preset there. Presets are shared across every funnel.",
    );
    expect(String(abBtn["title"])).toContain("Fork this variant with the picked preset");
  });
});

// ===========================================================================
// N20 (manager half) — the standalone Themes manager offers the SAME 8-family
// fresh vocabulary as the rail, legacy sorted last; a legacy value already
// stored stays selected and rendered, byte-identical.
// ===========================================================================

function fontSelectBlockById(html: string, id: string): string {
  const marker = `id="${id}"`;
  const at = html.indexOf(marker);
  expect(at, `select#${id}`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<select", at);
  const end = html.indexOf("</select>", at) + "</select>".length;
  return html.slice(start, end);
}

describeDb("N20 — Themes manager: fresh-first ordering, legacy labelled and still selectable", () => {
  // FIX ROUND F2: "(legacy)" was engineering jargon printed to a marketer
  // (jargon-scan.mjs's gate correctly rejected it) — every pin below is
  // re-minted to the plain-English outcome label at the SAME strictness
  // (exact substring match on the rendered <option> text; same selected/
  // ordering claims).
  it("a preset storing a LEGACY font (Newsreader) keeps it SELECTED, labelled '(shows as default font)', and sorted after the fresh choices", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Legacy Font Preset", "Newsreader", "Roboto Mono")), env),
      "create legacy-font preset",
    );
    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${created.item.id}`);
    const headlineBlock = fontSelectBlockById(html, "tm-headline-font");
    expect(headlineBlock).toContain('value="Newsreader" selected');
    expect(headlineBlock).toContain(">Newsreader (shows as default font)<");
    // fresh-first: a self-hosted family's option index precedes the legacy one.
    expect(headlineBlock.indexOf(">Poppins<")).toBeGreaterThan(-1);
    expect(headlineBlock.indexOf(">Poppins<")).toBeLessThan(headlineBlock.indexOf(">Newsreader (shows as default font)<"));

    const bodyBlock = fontSelectBlockById(html, "tm-body-font");
    expect(bodyBlock).toContain('value="Roboto Mono" selected');
    expect(bodyBlock).toContain(">Roboto Mono (shows as default font)<");
  });

  it("a preset storing a FRESH self-hosted font (Poppins/Lexend) keeps it SELECTED with NO legacy suffix, and renders the SAME 8 words the rail offers", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Fresh Font Preset", "Poppins", "Lexend")), env),
      "create fresh-font preset",
    );
    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${created.item.id}`);
    const headlineBlock = fontSelectBlockById(html, "tm-headline-font");
    expect(headlineBlock).toContain('value="Poppins" selected');
    expect(headlineBlock).not.toContain("Poppins (shows as default font)");
    for (const name of ["Space Grotesk", "Fraunces", "Playfair Display", "Manrope", "DM Sans", "Work Sans", "Lexend"]) {
      expect(headlineBlock, name).toContain(name);
    }
    const bodyBlock = fontSelectBlockById(html, "tm-body-font");
    expect(bodyBlock).toContain('value="Lexend" selected');
    expect(bodyBlock).not.toContain("Lexend (shows as default font)");
  });
});
