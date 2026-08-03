// LeadGen R2 — P8-2 slice S2.1 (contract §5 B4): the Themes canvas follows the
// chosen SITE, matches the Templates canvas for the same funnel+site+moment,
// and tells the truth about a dead logo.
//
// Owner verbatim (SOURCE-OF-TRUTH #11A / Image18): "I chose a site - why I
// don't see its logo???? I clearly defined this as an issue!!!!!!"
// Contract §5 B4 acceptance: "choosing a site on Themes re-renders that canvas
// with the site's logo, branding and footer, matching Templates for the same
// site and moment; a dead media row shows the honest chip there too."
//
// FAIL-BEFORE (measured on the pre-fix tree, this file's own runs):
//   · renderThemesTabPanel(): occurrences of `data-site-select` = 0 — the tab
//     had no site control of any kind.
//   · the island's canvas POST body carried NO `site_id` key at all, so the
//     server never called resolveSiteBranding: the composed body was 5,634
//     bytes with ZERO footer links, against 6,164 bytes with Contact /
//     Privacy policy / Terms of use once site_id rode along (real route, real
//     dev DB, funnel A + the r2fix fixture site).
//   · changing the page-level #lg-site-select fired 0 Themes re-renders.
//   · `watchCanvasLogo` occurrences in themes.ts = 0 (9 in templates.ts): a
//     site whose logo file is gone painted the owner's unexplained sliver.
//
// Everything below is driven through the REAL island source (node:vm, the
// repo's island-probe idiom) against the REAL Hono admin router over a REAL
// node:sqlite D1 — the request bodies asserted here are the bytes the product
// actually posts, and the parity block replays BOTH canvases' own captured
// bodies through their REAL routes (never a hand-built body on either side).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import { renderThemesTabPanel } from "../src/admin/leadgen/quotes-tabs/themes";
import { renderTemplatesTabPanel, LOGO_UNREACHABLE_CANVAS_TEXT } from "../src/admin/leadgen/quotes-tabs/templates";
import { mintPublicId } from "../src/leadgen/ids";
import type { Env } from "../src/env";

// ---------------------------------------------------------------------------
// node:sqlite harness (repo pattern — test/leadgen-p2-fixfirst-r2.test.ts)
// ---------------------------------------------------------------------------

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
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

const SITE_A = "st_b4_alpha";
const SITE_B = "st_b4_beta";

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  // The branding projection reads sites(name,domain) + site_settings(key,value)
  // — both real column shapes (src/leadgen/branding.ts), so the composed frame
  // resolves a REAL logo + REAL footer links here exactly as it does live.
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  runSql(
    sdb,
    `INSERT INTO sites (id, name, domain) VALUES ('${SITE_A}', 'B4 Alpha Site', 'alpha.b4.test'), ('${SITE_B}', 'B4 Beta Site', 'beta.b4.test');` +
      `INSERT INTO site_settings (site_id, key, value) VALUES` +
      ` ('${SITE_A}', 'site_name', 'B4 Alpha Site'),` +
      ` ('${SITE_A}', 'site_logo_url', 'https://alpha.b4.test/logo.png'),` +
      ` ('${SITE_A}', 'contact_email', 'hello@alpha.b4.test'),` +
      ` ('${SITE_A}', 'privacy_email', 'privacy@alpha.b4.test'),` +
      ` ('${SITE_B}', 'site_name', 'B4 Beta Site'),` +
      ` ('${SITE_B}', 'site_logo_url', 'https://beta.b4.test/logo.png'),` +
      ` ('${SITE_B}', 'contact_email', 'hello@beta.b4.test');`,
  );
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
  expect(res.status, `${label}: ${JSON.stringify(body).slice(0, 400)}`).toBeLessThan(300);
  return body;
}

// The measurable shape of a composed canvas answer: which frame regions the
// server actually emitted, how many CSS bytes it shipped, whether the site's
// logo image is in the body, and what the footer links say.
interface CanvasShape {
  regions: string[];
  cssBytes: number;
  logoImg: boolean;
  footerLinks: string[];
}
function shapeOf(css: string, html: string): CanvasShape {
  const regions = [...new Set([...html.matchAll(/data-frame-region="([a-z_]+)"/g)].map((m) => m[1] as string))].sort();
  const footerAt = html.indexOf('data-frame-region="footer"');
  const footerHtml = footerAt === -1 ? "" : html.slice(footerAt);
  return {
    regions,
    cssBytes: css.length,
    logoImg: /<img[^>]*class="[^"]*lg-logo-img/.test(html),
    footerLinks: [...footerHtml.matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]!.trim()),
  };
}

// ---------------------------------------------------------------------------
// seeds
// ---------------------------------------------------------------------------

async function seedQuote(env: Env): Promise<{ quote: string; funnel: string; variant: string }> {
  const created = await json<{ public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }>(
    await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: `P8 B4 ${mintPublicId("quote")}`, activity: "quote_funnel", verticals: ["auto"], funnel_name: "B4 Funnel" }),
      env,
    ),
    "create quote",
  );
  return {
    quote: created.public_id,
    funnel: created.funnels[0]!.public_id,
    variant: created.funnels[0]!.variants[0]!.public_id,
  };
}

async function seedSection(env: Env, name: string): Promise<{ id: number; public_id: string }> {
  return await json<{ id: number; public_id: string }>(
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
    "seed section",
  );
}

// ---------------------------------------------------------------------------
// the Themes island sandbox — a DOM small enough for THEMES_TAB_SCRIPT, with
// TWO real `[data-site-select]` pickers on the page (the top bar's
// #lg-site-select and this tab's own), fetch wired into the real router.
// ---------------------------------------------------------------------------

interface SelectStub extends Record<string, unknown> {
  value: string;
}

interface ThemesHandle {
  calls: Array<{ url: string; method: string; body: unknown }>;
  canvasCalls(): Array<Record<string, unknown>>;
  lastCanvasBody(): Record<string, unknown> | null;
  fireDocChange(target: Record<string, unknown>): void;
  topBar: SelectStub;
  ownSelect: SelectStub;
  frame: Record<string, unknown>;
  runLogoWatcher(): void;
  settle(): Promise<void>;
}

function bootThemesIsland(env: Env, funnelPublicId: string, variantPublicId: string): ThemesHandle {
  const html = renderThemesTabPanel(true, [
    { site_id: SITE_A, site_name: "B4 Alpha Site", badge: "Active" },
    { site_id: SITE_B, site_name: "B4 Beta Site", badge: "Not activated yet" },
  ]);
  const script = html.slice(html.lastIndexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));

  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const pending: Array<Promise<unknown>> = [];
  const docListeners: Record<string, Array<(ev: unknown) => void>> = {};
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
    addEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    focus() {},
  });

  // The page-level picker (ui-quotes.ts #lg-site-select) — the control the
  // owner is pointing at in Image18. It starts on "CMS fallback branding".
  const topBar: SelectStub = {
    value: "",
    getAttribute: (n: string) => (n === "data-site-select" ? "" : null),
    querySelector: () => null,
    setAttribute() {},
    addEventListener() {},
  };
  // This tab's OWN picker, SSR-rendered by renderSiteSelect with the real
  // data-badge attributes (the default rule reads the Active one).
  const ownSelect: SelectStub = {
    value: "",
    getAttribute: (n: string) => (n === "data-site-select" ? "" : null),
    querySelector: (sel: string) => (sel === 'option[data-badge="Active"]' ? { value: SITE_A } : null),
    setAttribute() {},
    addEventListener() {},
  };
  const frame: Record<string, unknown> = {
    srcdoc: "",
    onload: null,
    contentDocument: null,
    value: "",
    setAttribute(name: string, value: string) {
      if (name === "srcdoc") frame["srcdoc"] = value;
    },
    getAttribute: () => null,
    addEventListener() {},
  };

  const stableById: Record<string, Record<string, unknown>> = {
    "lg-theme-site-select": ownSelect,
    "lg-theme-canvas-frame": frame,
  };
  const root = { getAttribute: (n: string) => (n === "data-is-control" ? "true" : null), querySelectorAll: () => [] };
  const editorRoot = {
    getAttribute(name: string) {
      if (name === "data-funnel-public-id") return funnelPublicId;
      if (name === "data-variant-public-id") return variantPublicId;
      return null;
    },
  };
  const document = {
    querySelector(sel: string) {
      if (sel === "[data-lg-themes-tab]") return root;
      if (sel === "#lg-quote-editor") return editorRoot;
      return null;
    },
    querySelectorAll(sel: string) {
      return sel === "[data-site-select]" ? [topBar, ownSelect] : [];
    },
    getElementById(id: string) {
      if (stableById[id] === undefined) stableById[id] = el();
      return stableById[id];
    },
    createElement: () => el(),
    createTextNode: (s: unknown) => ({ nodeValue: s === null || s === undefined ? "" : String(s) }),
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

  const canvasCalls = (): Array<Record<string, unknown>> =>
    calls.filter((c) => c.url.includes("/preview")).map((c) => (c.body ?? {}) as Record<string, unknown>);

  return {
    calls,
    canvasCalls,
    lastCanvasBody() {
      const all = canvasCalls();
      return all.length === 0 ? null : all[all.length - 1]!;
    },
    fireDocChange(target: Record<string, unknown>) {
      for (const fn of docListeners["change"] ?? []) fn({ target });
    },
    topBar,
    ownSelect,
    frame,
    runLogoWatcher() {
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

// The TEMPLATES island — the canvas B4's acceptance says Themes must match.
// Booted from its own real source so the parity comparison uses the body that
// canvas really posts, never a body this test invented.
function bootTemplatesIsland(
  env: Env,
  quotePublicId: string,
  funnelPublicId: string,
  variantPublicId: string,
): { calls: Array<{ url: string; method: string; body: unknown }>; settle(): Promise<void> } {
  const html = renderTemplatesTabPanel(true, []);
  const script = html.slice(html.lastIndexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const pending: Array<Promise<unknown>> = [];

  const el = (): Record<string, unknown> => ({
    textContent: "",
    className: "",
    style: {},
    firstChild: null,
    value: "",
    checked: false,
    appendChild() {},
    removeChild() {},
    setAttribute() {},
    getAttribute: () => null,
    addEventListener() {},
    querySelectorAll: () => [],
    querySelector: () => null,
    closest: () => null,
    focus() {},
  });
  const stableById: Record<string, Record<string, unknown>> = {
    "lg-quote-data": {
      textContent: JSON.stringify({
        quote_public_id: quotePublicId,
        funnel_public_id: funnelPublicId,
        selected_variant: variantPublicId,
        sites: [
          { site_id: SITE_A, site_name: "B4 Alpha Site", badge: "Active" },
          { site_id: SITE_B, site_name: "B4 Beta Site", badge: "Not activated yet" },
        ],
      }),
    },
    "lg-board-data": { textContent: JSON.stringify({ funnels: [] }) },
  };
  const document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById(id: string) {
      if (stableById[id] === undefined) stableById[id] = el();
      return stableById[id];
    },
    createElement: () => ({
      value: "",
      selected: false,
      children: [] as unknown[],
      appendChild(c: unknown) {
        (this.children as unknown[]).push(c);
      },
      setAttribute() {},
    }),
    createTextNode: (s: unknown) => ({ nodeValue: s === null || s === undefined ? "" : String(s) }),
    addEventListener() {},
    body: el(),
  };
  const win = {
    setTimeout(fn: () => void) {
      fn();
      return 1;
    },
    clearTimeout() {},
    location: { hash: "" },
    history: null,
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
    calls,
    async settle() {
      for (let i = 0; i < 25; i += 1) {
        await Promise.allSettled(pending.slice());
        await new Promise((r) => setTimeout(r, 0));
      }
    },
  };
}

// ===========================================================================
// 1. SSR — the Themes tab OFFERS a site picker at all (B4 leg 1)
// ===========================================================================

describe("P8-2 B4 — the Themes tab has a preview-site picker", () => {
  const sites = [
    { site_id: SITE_A, site_name: "B4 Alpha Site", badge: "Active" as const },
    { site_id: SITE_B, site_name: "B4 Beta Site", badge: "Not activated yet" as const },
  ];

  it("renders the SHARED site select (same hook + badges as the top bar and the Templates canvas) — fail-before: 0 occurrences of data-site-select", () => {
    const html = renderThemesTabPanel(true, sites);
    expect((html.match(/data-site-select/g) ?? []).length).toBeGreaterThan(0);
    expect(html).toContain('id="lg-theme-site-select"');
    expect(html).toContain(`<option value="${SITE_A}" data-badge="Active">B4 Alpha Site`);
    expect(html).toContain(`<option value="${SITE_B}" data-badge="Not activated yet">B4 Beta Site`);
    // The no-site option stays offerable — previewing under CMS fallback
    // branding is a legitimate choice, not a blocker.
    expect(html).toContain('<option value="">CMS fallback branding</option>');
  });

  it("P8-2 F-8: the picker is REACHABLE at 375 — the 3-pane row wraps, and its bases still fit one row at 1280", () => {
    const html = renderThemesTabPanel(true, sites);
    // Without this the row overflowed a `body{overflow-x:hidden}` ancestor:
    // measured .lg-theme-3pane scrollWidth 976 / clientWidth 343 at 375, the
    // REQUIRED "Preview site" control at x 403..621 off a 375px screen, and
    // documentElement.scrollWidth === clientWidth reporting "no overflow".
    expect(html).toContain('class="lg-theme-3pane"');
    expect(html).toContain("display:flex;flex-wrap:wrap;align-items:flex-start;gap:18px");
    // A wrapping row breaks its lines on flex-BASIS, not on the shrunk width,
    // so the three bases + the two gaps must still fit the 982px content box
    // the admin shell gives this tab at 1280 — otherwise wrapping silently
    // drops a pane onto a second row at the acceptance width (measured: a 420
    // basis totalled 1076 and did exactly that).
    const bases = Array.from(html.matchAll(/style="flex:\d+ \d+ (\d+)px/g)).map((m) => Number(m[1]));
    expect(bases.length, "the three panes each declare a basis").toBe(3);
    expect(bases.reduce((a, b) => a + b, 0) + 2 * 18, "3 bases + 2 gaps at 1280").toBeLessThanOrEqual(982);
    // ...and none of them may refuse to shrink, or the narrow row overflows
    // again instead of wrapping.
    expect(html).not.toContain("style=\"flex:0 0 340px");
  });

  it("the island reads the site at render time, sends it as frame_context.site_id, and watches the canvas logo", () => {
    const html = renderThemesTabPanel(true, sites);
    expect(html).toContain("frameCtx.site_id = pickedSite;");
    expect(html).toContain("function watchCanvasLogo(frame)");
    // Anti-reduced-model: the canvas has exactly ONE srcdoc writer and it is
    // the watched one — a second, unwatched write path would re-open the
    // owner's sliver on whichever render took it.
    expect((html.match(/setAttribute\('srcdoc'/g) ?? []).length).toBe(1);
    expect((html.match(/watchCanvasLogo\(frame\);/g) ?? []).length).toBe(1);
    // The chip copy is the SAME sentence the Templates canvas already shows.
    expect(html).toContain(JSON.stringify(LOGO_UNREACHABLE_CANVAS_TEXT));
  });
});

// ===========================================================================
// 2. DRIVEN — choosing a site re-renders THIS canvas with that site's branding
// ===========================================================================

describeDb("P8-2 B4 — choosing a site re-renders the Themes canvas (island → real router → real DB)", () => {
  it("boots on the Active site, and a change on the PAGE-LEVEL picker re-renders this canvas under the newly chosen site", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const { funnel, variant } = await seedQuote(env);
    await admin.request(`${API}/funnels/${funnel}/frame`, jsonInit("PUT", { frame_config_json: { template: "centered", version: 1 } }), env);
    await seedSection(env, "B4 Canvas Target");

    const island = bootThemesIsland(env, funnel, variant);
    await island.settle();

    // FAIL-BEFORE: the first canvas body had no site_id key at all.
    const first = island.lastCanvasBody();
    expect(first, "the canvas rendered at least once").not.toBeNull();
    const firstCtx = first!["frame_context"] as Record<string, unknown>;
    expect(firstCtx["site_id"], "the first paint already carries the Active site").toBe(SITE_A);
    // Both pickers agree — the tab's own select was defaulted, not left blank.
    expect(island.ownSelect.value).toBe(SITE_A);
    expect(island.topBar.value).toBe(SITE_A);

    // FAIL-BEFORE: 0 Themes re-renders for a page-level site change.
    const before = island.canvasCalls().length;
    island.topBar.value = SITE_B;
    island.fireDocChange(island.topBar);
    await island.settle();
    const after = island.canvasCalls();
    expect(after.length, "the site change re-rendered the Themes canvas").toBeGreaterThan(before);
    expect((after[after.length - 1]!["frame_context"] as Record<string, unknown>)["site_id"]).toBe(SITE_B);
    // …and this tab's own picker followed the page-level one.
    expect(island.ownSelect.value).toBe(SITE_B);

    // The rendered document really carries the newly chosen site's branding.
    expect(String(island.frame["srcdoc"])).toContain("B4 Beta Site");
    sdb.close();
  });

  it("the site's LOGO and FOOTER reach the canvas — the acceptance's own words, through the real route", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const { funnel, variant } = await seedQuote(env);
    await admin.request(`${API}/funnels/${funnel}/frame`, jsonInit("PUT", { frame_config_json: { template: "centered", version: 1 } }), env);
    await seedSection(env, "B4 Branding Target");

    const island = bootThemesIsland(env, funnel, variant);
    await island.settle();
    const body = island.lastCanvasBody();
    expect(body).not.toBeNull();

    // Replay the island's OWN body through the REAL route (with, then
    // without, the site it now sends) — one real producer, one real consumer.
    const withSite = await json<{ preview: { css: string; html: string } }>(
      await admin.request(`${API}/sections/preview`, jsonInit("POST", body), env),
      "themes canvas body with site",
    );
    const stripped = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
    delete (stripped["frame_context"] as Record<string, unknown>)["site_id"];
    const withoutSite = await json<{ preview: { css: string; html: string } }>(
      await admin.request(`${API}/sections/preview`, jsonInit("POST", stripped), env),
      "themes canvas body without site",
    );

    const on = shapeOf(withSite.preview.css, withSite.preview.html);
    const off = shapeOf(withoutSite.preview.css, withoutSite.preview.html);
    expect(on.logoImg, "the site's logo image renders").toBe(true);
    expect(off.logoImg, "FAIL-BEFORE shape: no site, no logo").toBe(false);
    expect(on.footerLinks).toContain("Contact");
    expect(on.footerLinks).toContain("Privacy policy");
    expect(on.footerLinks).toContain("Terms of use");
    expect(off.footerLinks, "FAIL-BEFORE shape: the footer was empty").toEqual([]);
    sdb.close();
  });
});

// ===========================================================================
// 3. PARITY — Themes vs Templates for the SAME funnel + site + moment
// ===========================================================================

describeDb("P8-2 B4 — the Themes canvas matches the Templates canvas for the same funnel and site", () => {
  it("both canvases' OWN posted bodies compose the same frame regions and the same CSS bytes, both with the site's logo and footer", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const { quote, funnel, variant } = await seedQuote(env);
    await admin.request(`${API}/funnels/${funnel}/frame`, jsonInit("PUT", { frame_config_json: { template: "centered", version: 1 } }), env);
    const section = await seedSection(env, "B4 Parity Target");
    await admin.request(`${API}/variants/${variant}`, jsonInit("PUT", { sections: [{ section_id: section.id }] }), env);

    const themes = bootThemesIsland(env, funnel, variant);
    await themes.settle();
    const themesBody = themes.lastCanvasBody();
    expect(themesBody, "the Themes canvas posted a body").not.toBeNull();

    const templates = bootTemplatesIsland(env, quote, funnel, variant);
    await templates.settle();
    const tplCalls = templates.calls.filter((c) => c.url.includes(`/variants/${variant}/preview`));
    expect(tplCalls.length, "the Templates canvas posted a body").toBeGreaterThan(0);
    const tplBody = tplCalls[tplCalls.length - 1]!.body as Record<string, unknown>;
    // Both canvases resolved the SAME site by the SAME default rule.
    expect((themesBody!["frame_context"] as Record<string, unknown>)["site_id"]).toBe(SITE_A);
    expect(tplBody["site_id"]).toBe(SITE_A);

    const themesRes = await json<{ preview: { css: string; html: string } }>(
      await admin.request(`${API}/sections/preview`, jsonInit("POST", themesBody), env),
      "replay themes body",
    );
    const tplRes = await json<{ preview: { css: string; html: string } }>(
      await admin.request(`${API}/variants/${variant}/preview`, jsonInit("POST", tplBody), env),
      "replay templates body",
    );

    const t = shapeOf(themesRes.preview.css, themesRes.preview.html);
    const p = shapeOf(tplRes.preview.css, tplRes.preview.html);
    // A vacuous "both empty" match would prove nothing — the frame must be
    // really composed on both sides.
    expect(t.regions.length, "the Themes canvas composed a real frame").toBeGreaterThan(0);
    expect(t.regions).toContain("logo");
    expect(t.regions).toContain("footer");
    expect(t.regions).toContain("section_slot");
    expect(t.regions, "region set parity, same funnel + same site + same moment").toEqual(p.regions);
    expect(t.cssBytes, "CSS byte parity").toBe(p.cssBytes);
    expect(t.logoImg).toBe(true);
    expect(p.logoImg).toBe(true);
    expect(t.footerLinks).toEqual(p.footerLinks);
    sdb.close();
  });
});

// ===========================================================================
// 4. A dead media row shows the honest chip HERE too (B4's last clause)
// ===========================================================================

describeDb("P8-2 B4 — a logo whose file is gone says so on the Themes canvas", () => {
  it("the watcher replaces the broken <img> with the same plain-words chip the Templates canvas shows", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const { funnel, variant } = await seedQuote(env);
    await admin.request(`${API}/funnels/${funnel}/frame`, jsonInit("PUT", { frame_config_json: { template: "centered", version: 1 } }), env);
    await seedSection(env, "B4 Broken Logo Target");

    const island = bootThemesIsland(env, funnel, variant);
    await island.settle();

    // The browser's own "this load failed" state for the logo the canvas just
    // rendered: complete, zero natural width.
    const attrs: Record<string, string> = {};
    let replacedWith: Record<string, unknown> | null = null;
    const brokenImg: Record<string, unknown> = {
      complete: true,
      naturalWidth: 0,
      getAttribute: (n: string) => attrs[n] ?? null,
      setAttribute: (n: string, v: string) => {
        attrs[n] = v;
      },
      parentNode: {
        replaceChild(next: Record<string, unknown>) {
          replacedWith = next;
        },
      },
      ownerDocument: {
        createElement: () => {
          const node: Record<string, unknown> = {
            className: "",
            attrs: {} as Record<string, string>,
            text: "",
            setAttribute(n: string, v: string) {
              (node["attrs"] as Record<string, string>)[n] = v;
            },
            appendChild(child: { nodeValue?: string }) {
              node["text"] = String(child.nodeValue ?? "");
            },
          };
          return node;
        },
        createTextNode: (s: unknown) => ({ nodeValue: String(s) }),
      },
    };
    island.frame["contentDocument"] = {
      querySelectorAll: (sel: string) => (sel === "img.lg-logo-img" ? [brokenImg] : []),
    };
    // FAIL-BEFORE: this island had no watcher, so nothing ran here at all.
    island.runLogoWatcher();

    expect(replacedWith, "the broken image was replaced").not.toBeNull();
    const chip = replacedWith as unknown as Record<string, unknown>;
    expect(chip["className"]).toBe("lg-frame-logo-fallback");
    expect((chip["attrs"] as Record<string, string>)["data-logo-unreachable"]).toBe("1");
    expect(chip["text"]).toBe(LOGO_UNREACHABLE_CANVAS_TEXT);
    expect(attrs["data-logo-broken"]).toBe("1");
    sdb.close();
  });
});

// ---------------------------------------------------------------------------
// P8-2 FIX-ROUND-2 (N1 / review #2 MAJOR-1): the Themes chooser card is BUILT
// BY THIS FILE'S OWN JS ISLAND (renderCards, unlike the funnel-builder library
// card which is SSR HTML) -- themes.ts:13's own comment says the card idiom
// was "copied from quotes-tabs/funnel.ts's renderBoardLibrary/renderLibraryCard
// -- SAME reused CSS classes" (.lg-lc-name, clipped by the SAME shared.ts
// ellipsis rule), but the copy dropped the title attribute the sibling had.
// This slices the REAL renderCards function (island-probe idiom, not a
// re-implementation) and drives it with a minimal element-tracking DOM stub
// (document.createElement has no Node equivalent in this harness, matching
// the board test's own precedent for stubbing browser primitives).
// ---------------------------------------------------------------------------
function themeIslandScript(): string {
  const html = renderThemesTabPanel(true);
  return html.slice(html.lastIndexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));
}
function sliceThemeFn(island: string, name: string): string {
  const marker = `function ${name}(`;
  const start = island.indexOf(marker);
  expect(start, `island function ${name}`).toBeGreaterThan(-1);
  let depth = 0;
  let seenBody = false;
  for (let i = start; i < island.length; i += 1) {
    const ch = island[i];
    if (ch === "{") { depth += 1; seenBody = true; } else if (ch === "}") {
      depth -= 1;
      if (seenBody && depth === 0) return island.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced island function ${name}`);
}

describe("P8-2 FIX-ROUND-2 (N1) — the Themes chooser card matches the library card's title fix", () => {
  it("MAJOR-1 sibling: renderCards sets a title on the name span, not just textContent -- fail-before this property was never assigned", () => {
    const island = themeIslandScript();
    const src = [sliceThemeFn(island, "renderCards"), "__capture(renderCards);"].join("\n");
    const LONG_NAME = "P8-2 N1 Long Section Name That Clips In The Left Rail";

    function trackedEl(): Record<string, unknown> {
      const node: Record<string, unknown> = {
        className: "", textContent: "", title: "", style: {}, children: [] as unknown[],
        appendChild(child: unknown) { (node["children"] as unknown[]).push(child); },
        setAttribute() { /* no-op: attributes not read by this test */ },
        addEventListener() { /* no-op: click/keydown wiring covered elsewhere */ },
      };
      return node;
    }
    const mount: Record<string, unknown> = {
      children: [] as unknown[],
      appendChild(child: unknown) { (mount["children"] as unknown[]).push(child); },
    };
    runInNewContext(src, {
      byId: (id: string) => (id === "lg-theme-chooser-list" ? mount : null),
      clearChildren: () => undefined,
      allSections: [{ section_name: LONG_NAME, activity: "quote_funnel", vertical: "auto", public_id: "sec_n1" }],
      matchesFilters: () => true,
      chosenSection: null,
      document: { createElement: trackedEl },
      __capture: (fn: () => void) => fn(),
    });

    const card = (mount["children"] as Array<Record<string, unknown>>)[0]!;
    const top = (card["children"] as Array<Record<string, unknown>>)[0]!;
    const nameEl = (top["children"] as Array<Record<string, unknown>>)[0]!;
    expect(nameEl["className"], "the SAME reused class the funnel-builder library card uses").toBe("lg-lc-name");
    expect(nameEl["textContent"]).toBe(LONG_NAME);
    expect(nameEl["title"], "fail-before: '' (nm.title was never assigned)").toBe(LONG_NAME);
  });
});
