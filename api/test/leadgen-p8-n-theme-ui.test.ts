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
//   N7  — no select shows a truncated version of its own value.
//   N11 — "Apply to this funnel" / "A/B this theme" offered themselves as
//         ready even with ZERO saved presets (contract §4 R3 corollary: "a
//         control that cannot be honoured must not be offered"). Proved
//         BIDIRECTIONALLY: zero presets (disabled + honest copy) AND at
//         least one preset (enabled + the original copy).
//   N20 — the rail (THEME_FONT_IDS) and the standalone Themes manager
//         (THEME_RECORD_FONT_NAMES) offered two disjoint font vocabularies;
//         fonts.generated.ts's LEADGEN_SELF_HOSTED_FONT_FAMILIES is the only
//         8 the renderer actually serves.
//
// ===========================================================================
// FIX ROUND F3 — WHAT CHANGED IN THIS FILE, AND WHY THE OLD PINS WERE WEAK
// ===========================================================================
// A fresh-context adversarial review drove EVERY option of every theme select
// and found F2 had RE-CREATED N7's defect: the phase's own new labels
// overflowed the same box the old string had ("Literata (shows as default
// font)" 191.43px in a 125.00px content box, +66.43px; "Bigger + check badge"
// +10.82px; the manager's "Inter (shows as default font)" 181.2px in a 107.00px
// box, +74.2px).
//
// RETIRED, and what covers its claim now — stated in-file per the standing
// invariant. The old N7 test asserted ONE fact: that 16 selects carry the
// SHORTENED blank text "Inherit from base". That test could not fail for the
// case that matters (it never looked at a box, and it never looked at the
// other 11 options of each select), which is exactly how the overflow shipped
// green twice. It is NOT deleted — it is now the FIRST leg of the N7 block
// below, unchanged in strictness (same regex, same count of 16). What it could
// never prove is proved by the NEW leg beside it: THE BOX INVARIANT — for
// every select in the real rendered markup, for EVERY option it carries, the
// option's text must be narrower than that select's own content box, at every
// container width the layout can take. No hard-coded list of today's strings
// appears in that leg; both the option set and the box arithmetic are read out
// of the real artifacts (the real render functions, the real LG_QUOTES_STYLES /
// ADMIN_STYLES sheets, the real inline styles), so a longer label written
// tomorrow, or a revert of either grid rule, fails HERE.
//
// HOW THE BOX INVARIANT AVOIDS E10/E11 (a test that hand-builds both sides).
// vitest's environment is "node": jsdom/happy-dom are NOT installed and there
// is no CSS engine or font metrics (no-new-deps), so this cannot be a live
// cascade measurement — the conductor's and the reviewer's DRIVEN runs are the
// behavioural proof (E6). What this leg contributes is the arithmetic that the
// driven runs cannot re-derive cheaply, with neither side hand-built:
//   - the OPTION SET and the SELECT SET come from the REAL render functions
//     (renderThemesTabPanel; the REAL admin router's Themes-manager page);
//   - the BOX comes from the REAL stylesheets and the REAL inline styles those
//     same renders emit — parsed, never re-typed;
//   - the TEXT WIDTH comes from a per-character advance model that is
//     CALIBRATED AGAINST REAL MEASURED PIXELS: the 29 strings the reviewer
//     measured in the running product (docs/leadgen/r2/evidence/p8/
//     review-p8-3/r-n7-deep.txt, r-manager.txt, r-themes-rail.txt). The
//     calibration is itself asserted below — the model must never UNDER-state
//     a width the browser really produced — so the estimate is conservative by
//     construction (it over-states every real sample by 5.6%..26.8%, i.e. it
//     fails early, never late).
// ===========================================================================

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import { renderThemesTabPanel } from "../src/admin/leadgen/quotes-tabs/themes";
import { LG_QUOTES_STYLES } from "../src/admin/leadgen/quotes-tabs/shared";
import { ADMIN_STYLES } from "../src/admin/templates/layout";
import { THEME_FONT_IDS, THEME_FONT_STACKS, THEME_RECORD_FONT_NAMES, THEME_RECORD_FONT_STACKS, resolveTokens } from "../src/public/leadgen/designs/theme";
import { DEFAULT_FUNNEL_SCOPE, funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { LEADGEN_SELF_HOSTED_FONT_FAMILIES } from "../src/public/leadgen/designs/fonts.generated";
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
// N7 — NO SELECT SHOWS A TRUNCATED VERSION OF ITS OWN VALUE
//
// The machinery below is shared by both surfaces (rail + Themes manager).
// Everything it consumes is parsed out of a real artifact; nothing about
// today's particular strings is written down.
// ===========================================================================

// --- 1. TEXT WIDTH: a per-character advance model, calibrated against ------
// --- REAL measured pixels from the driven product. -------------------------
// Buckets are ratios of the font-size, fitted (grid search) so that NO sample
// in CALIBRATION below is under-stated.
const ADVANCE = { narrow: 0.22, semi: 0.3, wide: 0.95, upper: 0.72, ellipsis: 0.95, normal: 0.62 };
const NARROW_CHARS = "iljI|!.,;:'`";
const SEMI_CHARS = "ftr()[]{}/\\-– ";
const WIDE_CHARS = "mwMW—@";

function textWidthPx(text: string, fontPx: number): number {
  let em = 0;
  for (const ch of text) {
    if (NARROW_CHARS.includes(ch)) em += ADVANCE.narrow;
    else if (SEMI_CHARS.includes(ch)) em += ADVANCE.semi;
    else if (WIDE_CHARS.includes(ch)) em += ADVANCE.wide;
    else if (ch === "…") em += ADVANCE.ellipsis;
    else if (ch >= "A" && ch <= "Z") em += ADVANCE.upper;
    else em += ADVANCE.normal;
  }
  return em * fontPx;
}

// Every pair below is a REAL width the reviewer's driven run reported for that
// exact string at font-size 14px, transcribed from docs/leadgen/r2/evidence/
// p8/review-p8-3/{r-n7-deep,r-themes-rail,r-manager}.txt. The model is only
// ever allowed to be CONSERVATIVE: >= the browser's own number.
const CALIBRATION: ReadonlyArray<readonly [string, number]> = [
  ["Inherit from base", 105.05],
  ["Literata (shows as default font)", 191.43],
  ["Sora (shows as default font)", 174.31],
  ["System (shows as default font)", 191.41],
  ["Bigger + check badge", 135.82],
  ["R2Fix Fixture Site — Active", 171.15],
  ["— choose a funnel —", 134.63],
  ["Default Funnel Design", 138.52],
  ["R2Fix Fixture Quote — Funnel A", 174.06],
  ["Flat", 23.34],
  ["Site logo (auto)", 94.94],
  ["Small", 35.01],
  ["Center", 42.02],
  ["Under the header", 108.96],
  ["Choose a preset…", 116.73],
  ["Brand primary", 87.92],
  ["Poppins", 52],
  ["Space Grotesk", 94.8],
  ["Fraunces", 59.4],
  ["Playfair Display", 98.5],
  ["Manrope", 57],
  ["DM Sans", 57.4],
  ["Work Sans", 68.8],
  ["Lexend", 46.2],
  ["Newsreader (shows as default font)", 229.3],
  ["Inter (shows as default font)", 181.2],
  ["Roboto Mono (shows as default font)", 238.2],
];

// --- 2. MARKUP: pull the real <select>s and their real <option>s out of -----
// --- whatever HTML the real renderer produced. -----------------------------
interface ParsedOption {
  attrs: string;
  value: string;
  text: string;
  hidden: boolean;
  selected: boolean;
}
interface ParsedSelect {
  attrs: string;
  options: ParsedOption[];
}

function decodeEntities(raw: string): string {
  return raw
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
function attr(attrs: string, name: string): string | null {
  return attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? null;
}

function parseSelects(html: string): ParsedSelect[] {
  return [...html.matchAll(/<select([^>]*)>([\s\S]*?)<\/select>/g)].map((m) => ({
    attrs: m[1] as string,
    options: [...(m[2] as string).matchAll(/<option([^>]*)>([\s\S]*?)<\/option>/g)].map((o) => ({
      attrs: o[1] as string,
      value: decodeEntities(attr(o[1] as string, "value") ?? ""),
      text: decodeEntities(o[2] as string),
      hidden: /\shidden(\s|$|=)/.test(o[1] as string),
      selected: /\sselected(\s|$|=)/.test(o[1] as string),
    })),
  }));
}

// Slice one balanced <div>…</div> starting at `from`.
function sliceElement(html: string, from: number): string {
  let depth = 0;
  for (const m of html.slice(from).matchAll(/<(\/?)div\b[^>]*?(\/?)>/g)) {
    if (m[2] === "/") continue;
    depth += m[1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(from, from + (m.index as number) + m[0].length);
  }
  throw new Error("unbalanced element while slicing the real markup");
}

// The <select>s inside every container carrying `className`, found
// STRUCTURALLY (by the container, in the real markup) rather than by naming
// today's controls — a control added to that grid tomorrow is covered too.
function selectsInsideClass(html: string, className: string): ParsedSelect[] {
  const out: ParsedSelect[] = [];
  for (const m of html.matchAll(new RegExp(`<div[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`, "g"))) {
    out.push(...parseSelects(sliceElement(html, m.index as number)));
  }
  return out;
}

// --- 3. CSS: read the boxes out of the real sheets / real inline styles ----
function styleRule(sheet: string, selector: string): string {
  // strip @media preludes so the brace pairs of the inner rules balance
  const flat = sheet.replace(/@media[^{]*\{/g, "");
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] as string).split(",").map((s) => s.trim());
    if (selectors.includes(selector)) return (m[2] as string).trim();
  }
  throw new Error(`selector not found in the real stylesheet: ${selector}`);
}
function decl(block: string, prop: string): string {
  for (const part of block.split(";")) {
    const at = part.indexOf(":");
    if (at > -1 && part.slice(0, at).trim() === prop) return part.slice(at + 1).trim();
  }
  throw new Error(`declaration "${prop}" not found in: ${block}`);
}
function px(value: string): number {
  const m = value.match(/(-?\d+(?:\.\d+)?)px/);
  if (m === null) throw new Error(`not a px length: ${value}`);
  return Number(m[1]);
}
// `padding: <v>` shorthand -> the horizontal total (left + right).
function paddingX(shorthand: string): number {
  const parts = shorthand.trim().split(/\s+/).map(px);
  return (parts.length === 1 ? (parts[0] as number) : (parts[1] as number)) * 2;
}
// How many columns `grid-template-columns` yields in a `containerW` container.
// Supports BOTH the fixed shape the defect shipped with (`repeat(N,1fr)` /
// `1fr 1fr`) and the auto-fit/minmax shape that fixes it, so a REVERT is
// computed correctly — and fails — instead of being silently unsupported.
function columnCount(spec: string, containerW: number, gap: number): number {
  const fixed = spec.match(/^repeat\(\s*(\d+)\s*,/);
  if (fixed !== null) return Number(fixed[1]);
  const auto = spec.match(/^repeat\(\s*auto-(?:fit|fill)\s*,\s*minmax\(\s*(\d+(?:\.\d+)?)px/);
  if (auto !== null) return Math.max(1, Math.floor((containerW + gap) / (Number(auto[1]) + gap)));
  const tracks = spec.trim().split(/\s+/);
  if (tracks.every((t) => t.endsWith("fr"))) return tracks.length;
  throw new Error(`unsupported grid-template-columns: ${spec}`);
}
function inlineStyleOf(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at, `marker ${marker}`).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at)).match(/style="([^"]*)"/)?.[1] ?? "";
}
function styleValue(style: string, prop: string): string {
  return decl(style, prop);
}

describe("N7 machinery — the width model may never under-state a width the real browser produced", () => {
  for (const [text, measured] of CALIBRATION) {
    it(`"${text}" — model >= ${measured}px measured live`, () => {
      expect(textWidthPx(text, 14)).toBeGreaterThanOrEqual(measured);
    });
  }
});

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

// ---------------------------------------------------------------------------
// N7 THE BOX INVARIANT (rail) — for EVERY option of EVERY select in the rail's
// `.lg-scalars` grids, at EVERY width the rail can take, the option's text
// fits that select's own content box. This is the assertion whose absence let
// the truncation ship green twice.
// ---------------------------------------------------------------------------
describe("N7 BOX INVARIANT — theme rail: no option is wider than its own select", () => {
  const html = renderThemesTabPanel(true, []);
  const railStyle = inlineStyleOf(html, 'id="lg-theme-rail"');
  const railMin = px(styleValue(railStyle, "min-width"));
  const railMax = px(styleValue(railStyle, "max-width"));

  const panelCard = styleRule(LG_QUOTES_STYLES, ".lg-panel-card");
  const panelChromeX = paddingX(decl(panelCard, "padding")) + px(decl(panelCard, "border")) * 2;

  const scalars = styleRule(LG_QUOTES_STYLES, ".lg-scalars");
  const gridSpec = decl(scalars, "grid-template-columns");
  const gap = px(decl(scalars, "gap"));

  const formSelect = styleRule(ADMIN_STYLES, ".form-select");
  const selectChromeX = paddingX(decl(formSelect, "padding")) + px(decl(formSelect, "border")) * 2;
  const fontPx = px(decl(formSelect, "font-size"));

  const selects = selectsInsideClass(html, "lg-scalars");

  // The narrowest content box the rail can produce ANYWHERE in its declared
  // width range — scanned, never assumed, because the column count is a step
  // function of the container width.
  let worstContent = Number.POSITIVE_INFINITY;
  let worstAt = railMin;
  for (let railW = railMin; railW <= railMax; railW += 1) {
    const panelW = railW - panelChromeX;
    const cols = columnCount(gridSpec, panelW, gap);
    const content = (panelW - gap * (cols - 1)) / cols - selectChromeX;
    if (content < worstContent) {
      worstContent = content;
      worstAt = railW;
    }
  }

  it("the rail really is the container this arithmetic describes (real markup + real sheets, nothing assumed)", () => {
    expect(railMin).toBeGreaterThan(0);
    expect(railMax).toBeGreaterThanOrEqual(railMin);
    expect(decl(formSelect, "width")).toBe("100%");
    expect(selects.length).toBe(16);
    for (const s of selects) expect(s.options.length).toBeGreaterThan(0);
    expect(worstContent).toBeGreaterThan(0);
  });

  for (const select of selects) {
    const key = attr(select.attrs, "data-theme-key") ?? "(unkeyed)";
    for (const option of select.options) {
      it(`${key}: "${option.text}" fits the ${worstContent.toFixed(2)}px content box (worst case, rail at ${worstAt}px)`, () => {
        expect(textWidthPx(option.text, fontPx)).toBeLessThanOrEqual(worstContent);
      });
    }
  }
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

// FIX ROUND F3 (MINOR-9) — the island no longer issues its OWN catalog GET
// (the reviewer measured 4x GET /api/admin/leadgen/themes on one tab load; the
// 4th was this island's). It now derives availability from the picker
// quotes-tabs/funnel.ts already fills. So the harness below gained two things:
//   - a REAL option list on #lg-theme-preset-select. Its BOOT state is the
//     select the REAL renderer emitted (parsed out of renderThemesTabPanel's
//     own markup, marker attribute included) — not a hand-typed stand-in — so
//     dropping data-lg-preset-ssr from the SSR breaks these tests;
//   - a pumpable window.setTimeout, because the island watches that select
//     instead of awaiting a promise.
// funnel.ts's populate step is the PRODUCER of the later states and is outside
// this slice's owned files; `repopulatePicker` below reproduces exactly the
// shape it was measured writing (one placeholder + one option per catalog
// item, funnel.ts:3940-3951) and is fed by the REAL catalog endpoint's REAL
// response through the REAL admin router — so the item COUNT that decides the
// state is never hand-invented (E11: the island side and the data side are
// both real; only funnel.ts's DOM-writing hop is simulated, and it is named).
interface MinimalIslandHandle {
  elementById(id: string): Record<string, unknown>;
  settle(): Promise<void>;
  pumpTimers(rounds?: number): Promise<void>;
  repopulatePicker(optionTexts: readonly string[]): void;
  fetchedUrls(): string[];
}

function bootThemesIslandMinimal(env: Env): MinimalIslandHandle {
  const html = renderThemesTabPanel(true);
  const script = html.slice(html.lastIndexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));

  const pending: Array<Promise<unknown>> = [];
  const urls: string[] = [];
  const timers: Array<() => void> = [];
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
  const option = (text: string, ssrMarker: boolean): Record<string, unknown> => ({
    textContent: text,
    value: "",
    getAttribute: (n: string) => (ssrMarker && n === "data-lg-preset-ssr" ? "1" : null),
  });

  // The picker's BOOT option list, read off the REAL emitted markup.
  const ssrPicker = parseSelects(html).find((s) => attr(s.attrs, "id") === "lg-theme-preset-select");
  expect(ssrPicker, "the real markup must carry #lg-theme-preset-select").toBeDefined();
  const pickerEl = el();
  pickerEl["options"] = (ssrPicker as ParsedSelect).options.map((o) => option(o.text, attr(o.attrs, "data-lg-preset-ssr") === "1"));
  stableById["lg-theme-preset-select"] = pickerEl;

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
    setTimeout(fn: () => void) {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
  };
  const fetchShim = (url: string, init?: RequestInit): Promise<Response> => {
    urls.push(url);
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
    async pumpTimers(rounds = 3) {
      for (let i = 0; i < rounds; i += 1) {
        const due = timers.splice(0, timers.length);
        for (const fn of due) fn();
        await new Promise((r) => setTimeout(r, 0));
      }
    },
    repopulatePicker(optionTexts) {
      pickerEl["options"] = optionTexts.map((t) => option(t, false));
    },
    fetchedUrls() {
      return urls.slice();
    },
  };
}

describeDb("N11 — zero presets: both actions render disabled, and stay disabled once confirmed", () => {
  it("SSR default already agrees (disabled + neutral copy) before anything resolves", () => {
    const html = renderThemesTabPanel(true);
    expect(html).toContain('id="lg-theme-preset-apply" disabled');
    expect(html).toContain('id="lg-theme-ab-this" disabled');
    expect(html).toContain('id="lg-theme-preset-help">Checking for saved presets');
    // …and the picker's SSR placeholder carries the marker that lets the
    // island tell "not loaded yet" from "loaded, and empty" WITHOUT a request.
    expect(html).toContain('<option value="" data-lg-preset-ssr="1">');
  });

  it("EXECUTED: an unresolved picker (the SSR marker still present) never reads as ready — fail closed", async () => {
    const { env } = newHarness();
    const island = bootThemesIslandMinimal(env);
    await island.settle();
    await island.pumpTimers(2);
    expect(island.elementById("lg-theme-preset-apply")["disabled"]).not.toBe(false);
    expect(island.elementById("lg-theme-ab-this")["disabled"]).not.toBe(false);
  });

  it("EXECUTED: with the REAL catalog confirmed EMPTY, the buttons stay disabled, the reason is ON SCREEN (not only in a title), and the help line is flagged", async () => {
    const { env } = newHarness();
    const list = await json<{ items: unknown[] }>(await admin.request(`${API}/themes`, jsonInit("GET"), env), "real catalog (empty)");
    expect(list.items.length).toBe(0);

    const island = bootThemesIslandMinimal(env);
    await island.settle();
    island.repopulatePicker(["No presets yet — create one below"]); // funnel.ts's own zero-state shape
    await island.pumpTimers(2);

    const applyBtn = island.elementById("lg-theme-preset-apply");
    const abBtn = island.elementById("lg-theme-ab-this");
    const helpEl = island.elementById("lg-theme-preset-help");
    expect(applyBtn["disabled"]).toBe(true);
    expect(abBtn["disabled"]).toBe(true);
    expect(String(helpEl["textContent"])).toContain("No presets saved yet");
    expect(String(applyBtn["title"])).toContain("No presets saved yet");
    // MAJOR-2: the reason is on the page, carried by a class that paints it.
    expect(String(helpEl["className"])).toContain("lg-preset-help-blocked");
  });
});

describeDb("N11 — at least one preset: both actions become available and the copy reverts to the original", () => {
  it("EXECUTED: with the REAL catalog non-empty, the buttons enable, the blocked flag is cleared and the help text is the pre-existing wording (byte-identical to before this fix)", async () => {
    const { env } = newHarness();
    await json<ThemeCreateResponse>(await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Ready Preset", "Inter", "Inter")), env), "create preset");
    const list = await json<{ items: Array<{ name: string }> }>(await admin.request(`${API}/themes`, jsonInit("GET"), env), "real catalog (1 preset)");
    expect(list.items.length).toBe(1);

    const island = bootThemesIslandMinimal(env);
    await island.settle();
    island.repopulatePicker(["Choose a preset…", ...list.items.map((i) => i.name)]);
    await island.pumpTimers(2);

    const applyBtn = island.elementById("lg-theme-preset-apply");
    const abBtn = island.elementById("lg-theme-ab-this");
    const helpEl = island.elementById("lg-theme-preset-help");
    expect(applyBtn["disabled"]).toBe(false);
    expect(abBtn["disabled"]).toBe(false);
    expect(String(helpEl["textContent"])).toBe(
      "Save the current look as a reusable preset from the Themes manager, then apply or delete any preset there. Presets are shared across every funnel.",
    );
    expect(String(helpEl["className"])).not.toContain("lg-preset-help-blocked");
    expect(String(abBtn["title"])).toContain("Fork this variant with the picked preset");
  });
});

// ---------------------------------------------------------------------------
// MINOR-9 — this island must not add a catalog read of its own.
// ---------------------------------------------------------------------------
describeDb("MINOR-9 — the Themes tab island issues ZERO GET /api/admin/leadgen/themes of its own", () => {
  it("EXECUTED: across boot and both preset states, the island's own request log contains no catalog read", async () => {
    const { env } = newHarness();
    await json<ThemeCreateResponse>(await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Counted Preset", "Inter", "Inter")), env), "create preset");
    const island = bootThemesIslandMinimal(env);
    await island.settle();
    island.repopulatePicker(["Choose a preset…", "Counted Preset"]);
    await island.pumpTimers(3);
    await island.settle();

    const catalogReads = island.fetchedUrls().filter((u) => u === "/api/admin/leadgen/themes" || u.startsWith("/api/admin/leadgen/themes?"));
    expect(catalogReads.length, `island fetched: ${JSON.stringify(island.fetchedUrls())}`).toBe(0);
    // …and the availability it shows is still correct, so the count above is
    // not "zero because the feature stopped working".
    expect(island.elementById("lg-theme-preset-apply")["disabled"]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MAJOR-2 — "disabled" must be VISIBLE, not just a property. Measured
// FAIL-BEFORE (reviewer, both states, 1280 and 375): colour, background,
// border, opacity, filter and text-decoration were IDENTICAL between enabled
// and disabled, and cursor read `pointer` in BOTH.
// ---------------------------------------------------------------------------
describe("MAJOR-2 — the disabled preset actions are painted as unavailable by the real sheets", () => {
  // Resolved INSIDE each test on purpose: deleting the rule must show up as a
  // red assertion naming the missing selector, never as a collection crash
  // that reports "no tests".
  const base = (): string => styleRule(ADMIN_STYLES, ".btn");
  const off = (): string => styleRule(LG_QUOTES_STYLES, ".lg-preset-apply-row .btn:disabled");

  it("the base .btn really is the enabled look this compares against (cursor:pointer, no disabled state of its own)", () => {
    expect(decl(base(), "cursor")).toBe("pointer");
    expect(() => styleRule(ADMIN_STYLES, ".btn:disabled")).toThrow();
  });

  for (const prop of ["background", "border-color", "color", "opacity", "cursor", "box-shadow"]) {
    it(`the disabled rule declares "${prop}"`, () => {
      expect(decl(off(), prop).length).toBeGreaterThan(0);
    });
  }

  it("cursor differs from the enabled state (the single property the reviewer called out by name)", () => {
    expect(decl(off(), "cursor")).not.toBe(decl(base(), "cursor"));
    expect(decl(off(), "cursor")).toBe("not-allowed");
  });

  it("the on-screen reason has a rule that actually paints it (colour + background + border), so it reads as a blocked state at a glance", () => {
    const blocked = styleRule(LG_QUOTES_STYLES, ".lg-preset-help-blocked");
    for (const prop of ["color", "background", "border"]) expect(decl(blocked, prop).length).toBeGreaterThan(0);
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

// ===========================================================================
// FIX ROUND F3 additions
// ===========================================================================

// The font selects the manager renders, parsed out of the REAL page.
function managerFontSelects(html: string): ParsedSelect[] {
  const wanted = ["tm-headline-font", "tm-body-font"];
  const found = parseSelects(html).filter((s) => wanted.includes(attr(s.attrs, "id") ?? ""));
  expect(found.length, "both manager font selects must be in the real page").toBe(2);
  return found;
}
// A control's OFFERED vocabulary = the options a human can actually pick:
// everything that is not hidden and not the blank "inherit" placeholder.
function offeredTexts(select: ParsedSelect): string[] {
  return select.options.filter((o) => !o.hidden && o.value !== "").map((o) => o.text);
}

// ---------------------------------------------------------------------------
// N7 THE BOX INVARIANT (Themes manager) — same rule, the other surface. The
// reviewer measured this select truncating its own value by +74.2px at 1280
// and by +167.1px at 375.
// ---------------------------------------------------------------------------
describeDb("N7 BOX INVARIANT — Themes manager: no font option is wider than its own select", () => {
  it("EXECUTED against the REAL manager page: every option of both font selects fits the computed content box at every column width", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Box Invariant Preset", "Newsreader", "Roboto Mono")), env),
      "create preset",
    );
    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${created.item.id}`);

    // Every number below is parsed out of the markup the real page emitted.
    const editorMin = px(styleValue(inlineStyleOf(html, 'data-pin="8.4-editor-controls"'), "min-width"));
    const gridStyle = inlineStyleOf(html, 'data-pin="8.4-typography-grid"');
    const gridSpec = decl(gridStyle, "grid-template-columns");
    const gap = px(decl(gridStyle, "gap"));
    const wrapAt = html.indexOf('class="tm-font-select-wrap"');
    expect(wrapAt, "the real page must carry the font-select wrapper").toBeGreaterThan(-1);
    const wrapStyle = inlineStyleOf(html, 'class="tm-font-select-wrap"');
    const wrapChromeX = paddingX(decl(wrapStyle, "padding")) + px(decl(wrapStyle, "border")) * 2;
    // the chevron is a real flex sibling of the select and takes its width out
    // of the same line box
    const chevronPx = Number(html.slice(wrapAt).match(/<svg width="(\d+)"/)?.[1] ?? "0");
    expect(chevronPx).toBeGreaterThan(0);

    const selects = managerFontSelects(html);
    const fontPx = px(decl(attr(selects[0]!.attrs, "style") ?? "", "font-size"));

    // Narrowest box anywhere from the column's declared floor up through a
    // generously wide desktop column — scanned, because column count is a step
    // function of the container width.
    let worst = Number.POSITIVE_INFINITY;
    let worstAt = editorMin;
    for (let colW = editorMin; colW <= 1200; colW += 1) {
      const cols = columnCount(gridSpec, colW, gap);
      const content = (colW - gap * (cols - 1)) / cols - wrapChromeX - chevronPx;
      if (content < worst) {
        worst = content;
        worstAt = colW;
      }
    }
    expect(worst).toBeGreaterThan(0);

    const overflowing: string[] = [];
    for (const select of selects) {
      for (const option of select.options) {
        const w = textWidthPx(option.text, fontPx);
        if (w > worst) overflowing.push(`${attr(select.attrs, "id")}: "${option.text}" ${w.toFixed(2)}px > ${worst.toFixed(2)}px`);
      }
    }
    expect(
      overflowing,
      `worst-case content box ${worst.toFixed(2)}px at column width ${worstAt}px (grid "${gridSpec}", gap ${gap}, wrap chrome ${wrapChromeX}, chevron ${chevronPx})`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// MINOR-1 / N20 — ONE FONT VOCABULARY. The reviewer measured 8 of 11 names
// converged and six still split (the rail OFFERED Literata/Sora/System, the
// manager OFFERED Newsreader/Inter/Roboto Mono). Both halves are read out of
// the REAL rendered markup of the two surfaces and compared as SETS — never a
// hand-typed roster of "the names I expect".
// ---------------------------------------------------------------------------
describeDb("MINOR-1 — the rail and the Themes manager OFFER the same font vocabulary", () => {
  it("EXECUTED: the offered set on both surfaces is exactly the families fonts.generated.ts actually vendors", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Vocabulary Preset", "Poppins", "Lexend")), env),
      "create preset",
    );
    const { html: managerHtml } = await getHtml(env, `/admin/leadgen/themes?theme=${created.item.id}`);
    const railHtml = renderThemesTabPanel(true, []);

    const railFontSelects = parseSelects(railHtml).filter((s) => ["typography.display", "typography.body"].includes(attr(s.attrs, "data-theme-key") ?? ""));
    expect(railFontSelects.length).toBe(2);

    const served = [...LEADGEN_SELF_HOSTED_FONT_FAMILIES].sort();
    for (const select of railFontSelects) {
      expect(offeredTexts(select).sort(), `rail ${attr(select.attrs, "data-theme-key")}`).toEqual(served);
    }
    for (const select of managerFontSelects(managerHtml)) {
      expect(offeredTexts(select).sort(), `manager ${attr(select.attrs, "id")}`).toEqual(served);
    }
    // …and the two surfaces offer them in the SAME order, not merely the same
    // set (one vocabulary, one reading order).
    expect(offeredTexts(railFontSelects[0] as ParsedSelect)).toEqual(offeredTexts(managerFontSelects(managerHtml)[0] as ParsedSelect));
  });

  it("EXECUTED: a preset already storing a non-vendored family keeps it selectable, visible and rendering exactly as today", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Stored Legacy Preset", "Newsreader", "Roboto Mono")), env),
      "create preset storing two non-vendored families",
    );
    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${created.item.id}`);
    const [headline, body] = managerFontSelects(html);

    const headlineStored = (headline as ParsedSelect).options.find((o) => o.value === "Newsreader");
    expect(headlineStored, "the stored family must still be an option").toBeDefined();
    expect((headlineStored as ParsedOption).selected).toBe(true);
    expect((headlineStored as ParsedOption).hidden).toBe(false); // visible BECAUSE it is the stored value
    const bodyStored = (body as ParsedSelect).options.find((o) => o.value === "Roboto Mono");
    expect((bodyStored as ParsedOption).selected).toBe(true);
    expect((bodyStored as ParsedOption).hidden).toBe(false);
    // the OTHER non-vendored families are present as values but not offered
    const inter = (headline as ParsedSelect).options.find((o) => o.value === "Inter");
    expect((inter as ParsedOption).hidden).toBe(true);

    // "renders exactly as today": the stored names still resolve through the
    // untouched THEME_RECORD_FONT_STACKS table.
    expect(THEME_RECORD_FONT_STACKS["Newsreader"]).toBe("'Newsreader',Georgia,serif");
    expect(THEME_RECORD_FONT_STACKS["Roboto Mono"]).toBe("'Roboto Mono',monospace");
    // every enum value is still accepted storage — nothing was removed
    for (const name of THEME_RECORD_FONT_NAMES) {
      expect((headline as ParsedSelect).options.some((o) => o.value === name), `manager dropped the value "${name}"`).toBe(true);
    }
  });

  it("EXECUTED: on the rail, a funnel already storing a non-vendored id still has that option AND still paints the same font stack through the REAL renderer", () => {
    const railHtml = renderThemesTabPanel(true, []);
    const display = parseSelects(railHtml).find((s) => attr(s.attrs, "data-theme-key") === "typography.display") as ParsedSelect;

    for (const id of THEME_FONT_IDS) {
      const opt = display.options.find((o) => o.value === id);
      expect(opt, `the rail dropped the stored value "${id}"`).toBeDefined();
    }
    // …the three non-vendored ones are present but NOT offered
    for (const id of ["literata", "sora", "system"]) {
      expect((display.options.find((o) => o.value === id) as ParsedOption).hidden, `${id} must not be offered afresh`).toBe(true);
    }

    // The render half, through the REAL resolveTokens + funnelChromeCss pair —
    // not a lookup-table read: a funnel storing `literata` still emits the
    // identical family stack in the generated stylesheet.
    const css = funnelChromeCss(resolveTokens(defaultFunnelDesign, { typography: { display: "literata" } }, null, null).design, DEFAULT_FUNNEL_SCOPE, {
      frameRegions: true,
    });
    expect(THEME_FONT_STACKS.literata).toBe("'Literata',Georgia,serif");
    expect(css).toContain(THEME_FONT_STACKS.literata);
  });
});
