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
// (FIX ROUND F12 later re-scoped the clip reveal out of the CROSS-PRODUCT
// admin shell into src/admin/leadgen/clip-reveal.ts, and states the 141 -> 63
// retirement arithmetic F10 left unstated — see "F12 BLAST RADIUS" and "F12
// RETIREMENT LEDGER" below.)
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
import { QUOTE_EDITOR_SCRIPT } from "../src/admin/leadgen/quotes-tabs/funnel";
import { LG_QUOTES_STYLES } from "../src/admin/leadgen/quotes-tabs/shared";
import type { PreviewSiteOption } from "../src/admin/leadgen/quotes-tabs/shared";
import { ADMIN_SCRIPTS, ADMIN_STYLES } from "../src/admin/templates/layout";
import { LG_CLIP_REVEAL_SCRIPT } from "../src/admin/leadgen/clip-reveal";
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

// ===========================================================================
// N7 — THE CLIP INVARIANT (FIX ROUND F10). ONE mechanism, three surfaces.
//
// WHAT THIS REPLACES, AND WHY. F3 shipped two box invariants: one over the
// rail's `.lg-scalars` grids, one over the manager's typography grid. Both
// were correct and both were BLIND, because each was scoped to the CONTAINER
// CLASS the reported instance happened to live in. Review #2 then measured a
// string written by F5 into `#lg-theme-preset-select` — same panel, same tab,
// different container (`.lg-preset-apply-row`) — overflowing by +59.05px at
// 1280 AND 375. A universe named by container class is not the universe the
// operator sees. NOTHING IS RETIRED: every assertion those two blocks made is
// made here, over a strictly larger set (they covered 18 selects between them;
// this covers every select the three surfaces render, currently 24), with the
// same conservative width model and the same declaration-derived boxes.
//
// THE INVARIANT. Every operator-facing control that can clip its own text, on
// the Themes rail, the Themes manager and the quote-editor board, either
//   (A) shows every PRODUCT-AUTHORED string it can hold in full, inside its
//       own content box, at every width its layout can take; or
//   (B) can hold OPERATOR data (a site, funnel, section or preset name — a
//       length no box can bound), in which case the product must hand the
//       operator the full text anyway: the clip-reveal in
//       templates/layout.ts's ADMIN_SCRIPTS (title + ellipsis, driven by the
//       element's OWN scrollWidth/clientWidth).
// A select is put in (B) by MEASUREMENT, not by a list: the same surface is
// rendered twice through the real code with two different real data sets and
// the option texts are diffed. A select whose texts move with the data is
// data-bearing; one whose texts do not is product-authored. So a control added
// tomorrow is classified by what it does, not by whether someone remembered it.
//
// WHAT THE UNIVERSE OF STRINGS IS. Not "the options in the SSR markup" — that
// is precisely what missed the BLOCKER, whose string is written by an island
// at runtime and appears nowhere in the markup. For every select the universe
// is: its real SSR option texts, PLUS every string literal the REAL served
// island script assigns to a `.textContent` inside the function that resolves
// that select by id. `#lg-theme-preset-select` therefore carries funnel.ts's
// two placeholder literals, and a longer replacement fails HERE.
//
// SURFACE COVERAGE — stated exactly, because a coverage claim wider than the
// code is the same failure as a box claim wider than the browser. The BOX leg
// enumerates TWO surfaces, the two whose renderers this slice owns:
//   S1 the Themes tab     — renderThemesTabPanel (quotes-tabs/themes.ts): the
//                           16 rail scalars, the funnel picker, the preview-
//                           site picker, the Advanced role picker and the
//                           preset picker = 20 controls.
//   S2 the Themes manager — the REAL admin route /admin/leadgen/themes: both
//                           font selects = 2 controls.
// The REVEAL leg (B) is page-global by construction — it lives in
// templates/layout.ts's ADMIN_SCRIPTS, which adminLayout and
// adminStandalonePage interpolate into EVERY admin page — so it covers the
// quote-editor board and every other admin surface, including controls added
// tomorrow, without this file enumerating them.
// WHAT IS DELIBERATELY NOT IN THE BOX LEG, and why (each also in
// OUT_OF_COVERAGE below, with its measured overflow): the whole
// /admin/leadgen/quotes/:id/edit page composes SIX tab panels from five
// renderers and serves 70 more selects, most of them from files this slice
// does not own and from inspector containers whose width no declaration in an
// owned file pins. Putting a box under those here would be arithmetic dressed
// as coverage — the paper-audit failure this contract names. They are covered
// behaviourally by (B) instead, and that was DRIVEN, not assumed:
// #lg-tpl-target-select (+283.77px) and #lg-tpl-section-select (+305.80px)
// both went from title="" / text-overflow:clip to the full operator name in a
// title plus an ellipsis, at 1280 and at 375.
//
// HOW THIS AVOIDS E10/E11. vitest's environment is "node": no jsdom, no CSS
// engine, no font metrics (no-new-deps). So this is not a cascade measurement
// and never claims to be — the DRIVEN runs are the behavioural proof (E6).
// What it contributes is the arithmetic the driven runs cannot re-derive
// cheaply, with NEITHER side hand-built: the select set and the option set
// come from the real renderers/real routes, the literals from the real served
// island bytes, the boxes from the real stylesheets and the real inline
// styles, and the width model is calibrated against 29 pixel widths the real
// browser produced (CALIBRATION above), asserted never to under-state one.
// ===========================================================================

// --- the real ancestor chain of a select, out of the real markup ----------
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
interface RawEl {
  tag: string;
  attrs: string;
  start: number;
  end: number;
}
// Only the MARKUP: <script>/<style> bodies and comments are not elements, and
// a tag name mentioned inside one is not a control the operator can see.
function markupOnly(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, (m) => " ".repeat(m.length))
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, (m) => " ".repeat(m.length))
    .replace(/<!--[\s\S]*?-->/g, (m) => " ".repeat(m.length));
}
// Every <select> in `html`, each with the open-element stack above it.
function selectsWithChain(rawHtml: string): Array<{ select: ParsedSelect; chain: RawEl[]; at: number }> {
  const html = markupOnly(rawHtml); // offsets preserved (blanked, never removed)
  const stack: RawEl[] = [];
  const out: Array<{ select: ParsedSelect; chain: RawEl[]; at: number }> = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g)) {
    const closing = m[1] === "/";
    const tag = (m[2] as string).toLowerCase();
    const attrs = m[3] as string;
    const at = m.index as number;
    if (tag === "select" && !closing) {
      const block = html.slice(at, html.indexOf("</select>", at) + "</select>".length);
      out.push({ select: parseSelects(block)[0] as ParsedSelect, chain: stack.slice(), at });
      continue; // options are parsed above; never push <select> itself
    }
    if (VOID_TAGS.has(tag) || m[4] === "/") continue;
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if ((stack[i] as RawEl).tag === tag) {
          stack.length = i;
          break;
        }
      }
    } else {
      stack.push({ tag, attrs, start: at, end: -1 });
    }
  }
  return out;
}
// One balanced element of ANY tag starting at `from` (sliceElement above is
// <div>-only and stays as it is — its own callers depend on that).
function sliceAnyElement(html: string, from: number): string {
  const open = html.slice(from).match(/^<([a-zA-Z][\w-]*)/);
  if (open === null) throw new Error("not an element start");
  const tag = (open[1] as string).toLowerCase();
  if (VOID_TAGS.has(tag)) return html.slice(from, html.indexOf(">", from) + 1);
  let depth = 0;
  const re = new RegExp(`<(/?)${tag}\\b((?:"[^"]*"|'[^']*'|[^>"'])*?)(/?)>`, "g");
  for (const m of html.slice(from).matchAll(re)) {
    if (m[3] === "/") continue;
    depth += m[1] === "/" ? -1 : 1;
    if (depth === 0) return html.slice(from, from + (m.index as number) + m[0].length);
  }
  throw new Error(`unbalanced <${tag}> while slicing the real markup`);
}
// The top-level element children of one element's markup, each carrying its
// ABSOLUTE offset in the page so "which child holds my select" is an index
// comparison, never a substring guess.
function topLevelChildren(elementHtml: string, baseOffset: number): Array<{ html: string; tag: string; attrs: string; from: number; to: number }> {
  const innerAt = elementHtml.indexOf(">") + 1;
  const inner = elementHtml.slice(innerAt, elementHtml.lastIndexOf("<"));
  const kids: Array<{ html: string; tag: string; attrs: string; from: number; to: number }> = [];
  let i = 0;
  while (i < inner.length) {
    const next = inner.indexOf("<", i);
    if (next === -1) break;
    const open = inner.slice(next).match(/^<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/);
    if (open === null) {
      i = next + 1;
      continue;
    }
    const slice = sliceAnyElement(inner, next);
    const from = baseOffset + innerAt + next;
    kids.push({ html: slice, tag: (open[1] as string).toLowerCase(), attrs: open[2] as string, from, to: from + slice.length });
    i = next + slice.length;
  }
  return kids;
}

// --- declarations for one element, from the real sheets + real inline style -
function classesOf(attrs: string): string[] {
  return (attr(attrs, "class") ?? "").split(/\s+/).filter((c) => c !== "");
}
function declFor(attrs: string, prop: string, sheets: readonly string[]): string | null {
  const inline = attr(attrs, "style");
  if (inline !== null) {
    try {
      return decl(inline, prop);
    } catch {
      /* fall through to the class rules */
    }
  }
  for (const cls of classesOf(attrs)) {
    for (const sheet of sheets) {
      try {
        return decl(styleRule(sheet, `.${cls}`), prop);
      } catch {
        /* this class does not carry it */
      }
    }
  }
  return null;
}
function pxOr(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  try {
    return px(value);
  } catch {
    return fallback;
  }
}
function chromeX(attrs: string, sheets: readonly string[]): number {
  const pad = declFor(attrs, "padding", sheets);
  const border = declFor(attrs, "border", sheets);
  return (pad === null ? 0 : paddingX(pad)) + (border === null ? 0 : pxOr(border, 0) * 2);
}
function fontPxOf(attrs: string, sheets: readonly string[], fallback: number): number {
  return pxOr(declFor(attrs, "font-size", sheets), fallback);
}
function visibleText(elementHtml: string): string {
  return decodeEntities(elementHtml.replace(/<[^>]*>/g, "")).trim();
}
// `flex: <grow> <shrink> <basis>` -> the basis in px, when it has one.
function flexBasisPx(attrs: string, sheets: readonly string[]): number | null {
  const spec = declFor(attrs, "flex", sheets);
  if (spec === null) return null;
  const m = spec.trim().match(/(?:^|\s)(\d+(?:\.\d+)?)px\s*$/);
  return m === null ? null : Number(m[1]);
}

// --- the box: resolve DOWN the real chain from the nearest anchored --------
// --- ancestor to the select's own content box. -----------------------------
// An ANCHOR is an ancestor whose own width is pinned by a declaration
// (min-width/max-width, or a flex basis with a min-width) — the only honest
// place to start without a layout engine. Everything below it is resolved from
// the real declarations of each hop: padding/border, grid tracks, flex lines.
interface BoxResult {
  content: number;
  at: number;
  anchor: string;
}
function resolveContentBox(html: string, entry: { select: ParsedSelect; chain: RawEl[]; at: number }, sheets: readonly string[]): BoxResult | null {
  let anchorIdx = -1;
  for (let i = entry.chain.length - 1; i >= 0; i -= 1) {
    const el = entry.chain[i] as RawEl;
    const min = declFor(el.attrs, "min-width", sheets);
    const max = declFor(el.attrs, "max-width", sheets);
    if ((min !== null && /px/.test(min)) || (max !== null && /px/.test(max)) || flexBasisPx(el.attrs, sheets) !== null) {
      anchorIdx = i;
      break;
    }
  }
  const selectMax = declFor(entry.select.attrs, "max-width", sheets);
  const selectChrome = chromeX(entry.select.attrs, sheets);
  // A select capped by its OWN max-width needs no ancestor: the cap IS the box
  // (its content is always wider than the cap, or it would not be capped).
  if (selectMax !== null && /px/.test(selectMax)) {
    return { content: px(selectMax) - selectChrome, at: px(selectMax), anchor: "own max-width" };
  }
  if (anchorIdx === -1) return null;

  const anchor = entry.chain[anchorIdx] as RawEl;
  const anchorMin = pxOr(declFor(anchor.attrs, "min-width", sheets), flexBasisPx(anchor.attrs, sheets) ?? 0);
  const anchorMax = pxOr(declFor(anchor.attrs, "max-width", sheets), Math.max(anchorMin, 1200));
  if (anchorMin <= 0) return null;

  let worst: BoxResult | null = null;
  for (let anchorW = anchorMin; anchorW <= anchorMax; anchorW += 1) {
    let width = anchorW;
    for (let i = anchorIdx; i < entry.chain.length; i += 1) {
      const el = entry.chain[i] as RawEl;
      width -= chromeX(el.attrs, sheets);
      const grid = declFor(el.attrs, "grid-template-columns", sheets);
      const gap = pxOr(declFor(el.attrs, "gap", sheets), 0);
      if (grid !== null) {
        const cols = columnCount(grid, width, gap);
        width = (width - gap * (cols - 1)) / cols;
        continue;
      }
      if ((declFor(el.attrs, "display", sheets) ?? "").indexOf("flex") > -1) {
        const kids = topLevelChildren(sliceAnyElement(html, el.start), el.start);
        const wraps = (declFor(el.attrs, "flex-wrap", sheets) ?? "nowrap") === "wrap";
        const mineIdx = kids.findIndex((k) => entry.at >= k.from && entry.at < k.to);
        const others = kids.filter((_k, n) => n !== mineIdx);
        let siblingW = 0;
        for (const k of others) {
          const basis = flexBasisPx(k.attrs, sheets);
          const maxW = declFor(k.attrs, "max-width", sheets);
          const wAttr = attr(k.attrs, "width"); // svg/img chevrons and icons
          if (basis !== null) siblingW += basis;
          else if (maxW !== null && /px/.test(maxW)) siblingW += px(maxW);
          else if (wAttr !== null && /^\d+$/.test(wAttr)) siblingW += Number(wAttr) + chromeX(k.attrs, sheets);
          else siblingW += textWidthPx(visibleText(k.html), fontPxOf(k.attrs, sheets, 14)) + chromeX(k.attrs, sheets);
        }
        const gaps = gap * Math.max(0, kids.length - 1);
        // The line-break decision needs MY OWN hypothetical width too, not
        // just the siblings': a child declared width:100% (every .form-select)
        // already claims the whole line, which is exactly why the browser puts
        // it alone on one and gives it the full width — .lg-list-row measured
        // 292px of a 292px line, .lg-preset-apply-row 314 of 314. Comparing
        // siblings alone said "it shares", and under-stated both boxes by more
        // than half.
        const mineEl = mineIdx === -1 ? null : (kids[mineIdx] as { attrs: string; html: string });
        const mineBasis = mineEl === null ? null : flexBasisPx(mineEl.attrs, sheets);
        const claimsFullLine =
          mineEl !== null && (declFor(mineEl.attrs, "width", sheets) === "100%" || /class="[^"]*\bform-select\b/.test(mineEl.html) || mineEl.html.startsWith("<select"));
        const mineHypo = mineBasis !== null ? mineBasis : claimsFullLine ? width : textWidthPx(visibleText(mineEl?.html ?? ""), fontPxOf(mineEl?.attrs ?? "", sheets, 14));
        const nextOther = others.length > 0 ? (others[0] as { attrs: string; html: string }) : null;
        const nextHypo =
          nextOther === null ? 0 : (flexBasisPx(nextOther.attrs, sheets) ?? textWidthPx(visibleText(nextOther.html), fontPxOf(nextOther.attrs, sheets, 14)) + chromeX(nextOther.attrs, sheets));
        const alone = wraps && (mineHypo >= width || mineHypo + gap + nextHypo > width);
        width = alone ? width : width - siblingW - gaps;
        continue;
      }
    }
    width -= selectChrome;
    if (worst === null || width < worst.content) worst = { content: width, at: anchorW, anchor: (attr(anchor.attrs, "id") ?? attr(anchor.attrs, "data-pin") ?? attr(anchor.attrs, "class") ?? anchor.tag) };
  }
  return worst;
}

// --- the string universe: SSR options + the island literals written in -----
// The real served script, sliced to the function body that resolves this
// select by id, then every string literal assigned to a `.textContent`.
// `literals` are product copy (they must FIT); `writesData` means the island
// also assigns something that is NOT a literal — an operator's own name — so
// no box can bound this control and it needs the reveal instead. The harvest
// is scoped to the enclosing function, which is deliberately conservative: it
// may attribute a sibling element's literal to this select, and that can only
// ever make the fit check stricter, never blinder.
function islandTextWrites(script: string, selectId: string): { literals: string[]; writesData: boolean } {
  const out: string[] = [];
  let writesData = false;
  for (const ref of script.matchAll(new RegExp(`['"]${selectId.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}['"]`, "g"))) {
    const fnAt = script.lastIndexOf("function", ref.index as number);
    if (fnAt === -1) continue;
    const bodyAt = script.indexOf("{", fnAt);
    let depth = 0;
    let end = bodyAt;
    for (let i = bodyAt; i < script.length; i += 1) {
      if (script[i] === "{") depth += 1;
      else if (script[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    const body = script.slice(bodyAt, end);
    for (const w of body.matchAll(/\.(?:textContent|text|innerText)\s*=\s*([^;]+);/g)) {
      const rhs = w[1] as string;
      let stripped = rhs;
      for (const lit of rhs.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
        const raw = (lit[1] ?? lit[2]) as string;
        out.push(raw.replace(/\\u([0-9a-fA-F]{4})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\\'/g, "'"));
        stripped = stripped.replace(lit[0] as string, "");
      }
      // anything left after removing the literals is an expression: data.
      if (/[A-Za-z_$][\w$]*/.test(stripped.replace(/\b(?:true|false|null|undefined)\b/g, ""))) writesData = true;
    }
  }
  return { literals: [...new Set(out)], writesData };
}

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
// The zero-preset placeholder EXACTLY as quotes-tabs/funnel.ts writes it,
// harvested from the real exported island source and never re-typed, so this
// harness cannot drift from its producer.
function zeroStatePlaceholderLiteral(): string {
  const literals = islandTextWrites(QUOTE_EDITOR_SCRIPT, "lg-theme-preset-select").literals;
  const zero = literals.filter((t) => /^no .*preset/i.test(t));
  expect(zero.length, `funnel.ts must write exactly one zero-state placeholder literal; found ${JSON.stringify(literals)}`).toBe(1);
  return zero[0] as string;
}

interface MinimalIslandHandle {
  elementById(id: string): Record<string, unknown>;
  settle(): Promise<void>;
  pumpTimers(rounds?: number): Promise<void>;
  repopulatePicker(optionTexts: readonly string[]): void;
  fetchedUrls(): string[];
  pendingTimers(): number;
}

function bootThemesIslandMinimal(env: Env, withObserver = false): MinimalIslandHandle {
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

  // F10 (MINOR-2/MINOR-5): the island now WATCHES the picker instead of
  // polling it, so the sandbox carries a real (minimal) MutationObserver whose
  // callbacks repopulatePicker() fires — the same childList churn
  // quotes-tabs/funnel.ts's clearChildren()+appendChild() produces on the real
  // page. Engines without it fall back to the timer, which the legs above
  // still exercise (this stub is only installed when `observed` is asked for).
  const observers: Array<{ target: unknown; cb: () => void }> = [];
  function MutationObserverStub(this: Record<string, unknown>, cb: () => void) {
    (this as { observe: (t: unknown) => void }).observe = (t: unknown) => {
      observers.push({ target: t, cb });
    };
  }
  runInNewContext(script, {
    document,
    window: win,
    fetch: fetchShim,
    MutationObserver: withObserver ? MutationObserverStub : undefined,
    JSON,
    Object,
    String,
    Boolean,
    Number,
  });

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
      for (const o of observers) {
        if (o.target === pickerEl) o.cb();
      }
    },
    fetchedUrls() {
      return urls.slice();
    },
    pendingTimers() {
      return timers.length;
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
    // funnel.ts's own zero-state shape, READ OUT of the real served island
    // rather than re-typed here (F10: a hand-typed copy of the producer's
    // string is the E11 "both sides hand-built" trap, and it is exactly what
    // went stale the moment BLOCKER-1's fix shortened that literal).
    island.repopulatePicker([zeroStatePlaceholderLiteral()]);
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

// ---------------------------------------------------------------------------
// MINOR-2 + MINOR-5 (review-p8-3b) — THE FAILED STATE IS RECOVERABLE, AND THE
// POLL IS BOUNDED. FAIL-BEFORE (source-confirmed by the reviewer):
// refreshPresetAvailability called applyPresetState('failed') after
// PRESET_UNKNOWN_LIMIT (25) x PRESET_TICK_MS (400ms) = 10s and RETURNED
// WITHOUT RESCHEDULING, so a catalog that resolved at 10.1s left both buttons
// dead beside a populated picker for the life of the page; and in every other
// state it re-armed a 400ms timer forever. Both legs below are EXECUTED
// against the REAL served island in the vm sandbox.
// ---------------------------------------------------------------------------
describeDb("MINOR-2/MINOR-5 — a late catalog recovers the dead state, and the settled island keeps no timer", () => {
  it("EXECUTED: after the 10s unknown window has latched 'failed', a picker that fills LATER re-enables both actions", async () => {
    const { env } = newHarness();
    const island = bootThemesIslandMinimal(env, true);
    await island.settle();
    // burn past PRESET_UNKNOWN_LIMIT while the picker still shows the SSR
    // marker: the island gives up and says so.
    await island.pumpTimers(30);
    expect(String(island.elementById("lg-theme-preset-help")["textContent"])).toContain("Could not check");
    expect(island.elementById("lg-theme-preset-apply")["disabled"]).toBe(true);
    expect(island.pendingTimers(), "the failed state must not keep re-arming the fast tick").toBe(0);

    // …then the slow catalog lands and funnel.ts fills the picker.
    island.repopulatePicker(["Choose a preset…", "Arrived Late Preset"]);
    expect(island.elementById("lg-theme-preset-apply")["disabled"], "a late catalog must un-stick the buttons").toBe(false);
    expect(island.elementById("lg-theme-ab-this")["disabled"]).toBe(false);
    expect(String(island.elementById("lg-theme-preset-help")["textContent"])).not.toContain("Could not check");
  });

  it("EXECUTED: once the state is settled the island holds NO pending timer at all — the watcher replaced the poll", async () => {
    const { env } = newHarness();
    const island = bootThemesIslandMinimal(env, true);
    await island.settle();
    island.repopulatePicker(["Choose a preset…", "Ready Preset"]);
    await island.pumpTimers(3);
    expect(island.elementById("lg-theme-preset-apply")["disabled"]).toBe(false);
    expect(island.pendingTimers(), "a settled island must not keep polling every 400ms").toBe(0);
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

// ===========================================================================
// N7 — THE CLIP INVARIANT, EXECUTED over all three surfaces at once.
// (Machinery + the coverage statement are at the top of the N7 section.)
// ===========================================================================

// A select this enumeration finds but cannot place a box around. Every entry
// carries the reason IN FILE; the leg below FAILS if an entry ever becomes
// resolvable, so this can never quietly become a parking lot.
const OUT_OF_COVERAGE: ReadonlyArray<{ id: string; reason: string }> = [
  {
    id: "lg-site-select",
    reason:
      "the quote-editor page header's site picker (ui-quotes.ts:730, a file this slice does not own; it is on the board surface, not inside either enumerated one). It sits in a .lg-chip inside .lg-editor-head, a wrapping row whose width is the admin content box, which no declaration in any owned file pins — there is no honest anchor to resolve from. DATA-BEARING (operator site names), so the clip reveal covers it. Driven: widest entry -33.84px at 1280 (fits) and +2.47px at 375, which the element's own scrollWidth reports as no overflow at all, so the reveal correctly stays silent.",
  },
  {
    id: "lg-tpl-target-select",
    reason:
      "the Templates tab's funnel picker (quotes-tabs/templates.ts:894). Not this slice's file and not one of the three covered surfaces. Measured +283.77px with operator funnel names; data-bearing, so the page-global clip reveal covers it — driven after this round it reports title='R2C3 Bravo Extremely Long Funnel Column Name…' and text-overflow:ellipsis. Reported to the conductor as an adjacent surface, not silently absorbed.",
  },
  {
    id: "lg-tpl-section-select",
    reason:
      "the Templates tab's section picker (quotes-tabs/templates.ts:862). Same file, same reason; measured +305.80px with operator section names and likewise closed by the page-global reveal.",
  },
  {
    id: "lg-tpl-theme-select",
    reason: "the Templates tab's theme switcher (quotes-tabs/templates.ts:858). Not owned, not a covered surface; driven -68.86px (fits).",
  },
  {
    id: "lg-tpl-site-select",
    reason: "the Templates tab's site picker (quotes-tabs/templates.ts:865). Not owned, not a covered surface; driven -3.22px (fits) and data-bearing, so the reveal covers the unbounded case.",
  },
];

interface CoveredSelect {
  surface: string;
  key: string;
  select: ParsedSelect;
  box: BoxResult | null;
  strings: string[];
  dataBearing: boolean;
  fontPx: number;
}

async function coveredSelects(
  env: Env,
  themeId: string,
  // F12: the sheet set is a parameter ONLY so the mutation leg below can feed
  // the reverted grid rule and prove this arithmetic still fails for the
  // regression it claims to catch. Every caller but that one passes the real
  // sheets, and the default IS the real pair.
  sheets: readonly string[] = [LG_QUOTES_STYLES, ADMIN_STYLES],
): Promise<CoveredSelect[]> {
  const siteA: PreviewSiteOption[] = [
    { site_id: "s1", site_name: "R2Fix Fixture Site", badge: "Active" },
    { site_id: "s2", site_name: "Seed Local Living", badge: "Not activated yet" },
  ];
  const siteB: PreviewSiteOption[] = [
    { site_id: "s1", site_name: "Zzz Other Site", badge: "Active" },
    { site_id: "s2", site_name: "Another Longer Site Name Entirely", badge: "Not activated yet" },
  ];
  // The islands as SERVED, never re-typed: every <script> body the surface
  // itself emits, plus (for the Themes tab, which is mounted inside the quote
  // editor) that page's own script — the one that fills the preset picker.
  const scriptsOf = (html: string): string => [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] as string).join("\n");
  const railA = renderThemesTabPanel(true, siteA);
  const managerHtml = (await getHtml(env, `/admin/leadgen/themes?theme=${themeId}`)).html;

  const surfaces: Array<{ name: string; html: string; alt: string; script: string; fallbackFont: number }> = [
    {
      name: "S1 Themes tab (renderThemesTabPanel)",
      html: railA,
      alt: renderThemesTabPanel(true, siteB),
      script: scriptsOf(railA) + "\n" + QUOTE_EDITOR_SCRIPT,
      fallbackFont: px(decl(styleRule(ADMIN_STYLES, ".form-select"), "font-size")),
    },
    {
      name: "S2 Themes manager (/admin/leadgen/themes)",
      html: managerHtml,
      alt: managerHtml,
      script: scriptsOf(managerHtml),
      fallbackFont: 14,
    },
  ];

  const out: CoveredSelect[] = [];
  for (const surface of surfaces) {
    const altById = new Map(selectsWithChain(surface.alt).map((e) => [attr(e.select.attrs, "id") ?? attr(e.select.attrs, "data-theme-key") ?? "", e.select.options.map((o) => o.text).join(" ")]));
    for (const entry of selectsWithChain(surface.html)) {
      const id = attr(entry.select.attrs, "id") ?? "";
      const key = id !== "" ? id : (attr(entry.select.attrs, "data-theme-key") ?? "(unkeyed)");
      const ssrTexts = entry.select.options.map((o) => o.text);
      const island = id === "" ? { literals: [] as string[], writesData: false } : islandTextWrites(surface.script, id);
      // DATA-BEARING is MEASURED, never listed: either the SAME renderer with
      // DIFFERENT real data produced different option texts, or the real
      // island assigns a non-literal (an operator's own name) into it.
      const dataBearing = altById.get(key) !== ssrTexts.join(" ") || island.writesData;
      out.push({
        surface: surface.name,
        key,
        select: entry.select,
        box: resolveContentBox(surface.html, entry, sheets),
        // The product-authored universe: SSR options that do NOT move with the
        // data, plus every literal the real island writes into this select.
        strings: [...new Set([...(dataBearing ? [] : ssrTexts), ...island.literals])],
        dataBearing,
        fontPx: pxOr(declFor(entry.select.attrs, "font-size", sheets), surface.fallbackFont),
      });
    }
  }
  return out;
}

describeDb("N7 CLIP INVARIANT — every select on the covered surfaces shows its own product text in full", () => {
  it("EXECUTED: the enumeration reaches the whole surface set, and every select is either boxed or named out of coverage", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Clip Invariant Preset", "Newsreader", "Roboto Mono")), env),
      "create preset",
    );
    const all = await coveredSelects(env, created.item.id);

    // The enumeration is real: the two surfaces together render the 16 rail
    // scalars + the 4 other Themes-tab selects + the 2 manager font selects.
    expect(all.length, all.map((c) => c.key).join(", ")).toBe(22);
    expect(all.filter((c) => c.key.startsWith("typography.") || c.key.startsWith("scales.") || c.key.startsWith("button_defaults.") || c.key.startsWith("card_defaults.") || c.key.startsWith("field_defaults.")).length).toBe(16);
    for (const id of ["lg-theme-target-select", "lg-theme-site-select", "lg-theme-hex-role", "lg-theme-preset-select", "tm-headline-font", "tm-body-font"]) {
      expect(all.some((c) => c.key === id), `the enumeration missed ${id}`).toBe(true);
    }

    const unplaced = all.filter((c) => c.box === null).map((c) => `${c.key} (${c.surface})`);
    const excused = new Set(OUT_OF_COVERAGE.map((o) => o.id));
    expect(
      unplaced.filter((u) => !excused.has(u.split(" ")[0] as string)),
      "a select on a covered surface has no resolvable box: give it one, or add it to OUT_OF_COVERAGE with a written reason",
    ).toEqual([]);
  });

  it("EXECUTED: no product-authored string is wider than the box that shows it, at the narrowest width its layout can take", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Clip Invariant Preset", "Newsreader", "Roboto Mono")), env),
      "create preset",
    );
    const all = await coveredSelects(env, created.item.id);

    const overflowing: string[] = [];
    let checked = 0;
    for (const c of all) {
      if (c.box === null) continue;
      for (const text of c.strings) {
        checked += 1;
        const w = textWidthPx(text, c.fontPx);
        if (w > c.box.content) {
          overflowing.push(`${c.key}: "${text}" ${w.toFixed(2)}px > ${c.box.content.toFixed(2)}px (anchor ${c.box.anchor} at ${c.box.at}px, ${c.surface})`);
        }
      }
    }
    // THE INVARIANT, first, so a regression's own message is the one that
    // names the offending string, its width and its box.
    expect(overflowing).toEqual([]);
    // …and it was not vacuous. The enumeration is not hollow and nothing was
    // skipped in silence: the number of strings measured IS the number the
    // covered selects carry (a floor of 100 so an empty universe cannot pass),
    // and both halves really came from the real artifacts — the rail's SSR
    // options AND funnel.ts's island literals for the picker.
    const boxed = all.filter((c) => c.box !== null);
    expect(boxed.length).toBe(all.length);
    expect(checked).toBe(boxed.reduce((n, c) => n + c.strings.length, 0));
    expect(checked).toBeGreaterThanOrEqual(100);
    const picker = all.find((c) => c.key === "lg-theme-preset-select") as CoveredSelect;
    expect(picker.strings, "funnel.ts's zero-state literal must reach this check").toContain("No presets yet");
    expect(picker.strings).toContain("Choose a preset…");
  });

  it("EXECUTED: every select that can hold OPERATOR data is covered by the clip reveal, and the reveal is on the page that renders it", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Clip Invariant Preset", "Newsreader", "Roboto Mono")), env),
      "create preset",
    );
    const all = await coveredSelects(env, created.item.id);
    // Detected by re-rendering the SAME surface with DIFFERENT real data —
    // never by a list of "the ones I think take names".
    const bearing = all.filter((c) => c.dataBearing).map((c) => c.key);
    expect(bearing, "the differential render must catch the site picker").toContain("lg-theme-site-select");
    for (const key of bearing) {
      expect(OUT_OF_COVERAGE.some((o) => o.id === key) || all.find((c) => c.key === key)?.box !== null, `${key} is data-bearing and unplaced`).toBe(true);
    }
    // …and the mechanism that covers them is served on the real page.
    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${created.item.id}`);
    expect(html).toContain("function lgRevealClippedSelect(");
    expect(html).toContain("sel.scrollWidth > sel.clientWidth");
  });

  it("the OUT_OF_COVERAGE list is honest: every excused select is really unplaceable or really outside the covered surfaces", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Clip Invariant Preset", "Newsreader", "Roboto Mono")), env),
      "create preset",
    );
    const all = await coveredSelects(env, created.item.id);
    for (const row of OUT_OF_COVERAGE) {
      expect(row.reason.length, `${row.id} needs a written reason`).toBeGreaterThan(80);
      const hit = all.find((c) => c.key === row.id);
      // Stale-residual leg: an excused id that this enumeration now places
      // must be REMOVED from the list, not left standing.
      expect(hit === undefined || hit.box === null, `${row.id} is now resolvable — delete its OUT_OF_COVERAGE row`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// THE CLIP REVEAL, EXECUTED — the REAL served LG_CLIP_REVEAL_SCRIPT bytes run
// in a node:vm against a select whose painted box is the one THIS FILE
// computes from the real declarations, so neither side of the boundary is
// hand-built: the script is the real artifact, the overflow condition is the
// real arithmetic. FAIL-BEFORE (driven, both widths): every one of these
// selects reported title="" and text-overflow:clip while its text was clipped.
//
// FIX ROUND F12 — WHERE THESE BYTES LIVE, AND WHY THAT MOVED. F10 put them in
// templates/layout.ts's ADMIN_SCRIPTS, which is the admin shell SHARED WITH
// THE CONVERSIONS PRODUCT (one worker, several products): the leadgen fix
// added 5,477 bytes of JavaScript to every conversions admin page and turned
// test/conversions-admin-shell.test.ts's byte-identical legacy-shell pin red
// (25789 vs 20312). The mechanism is unchanged and still page-global; only its
// include site moved, to the two leadgen renderers that need it. The legs
// below therefore execute src/admin/leadgen/clip-reveal.ts's real exported
// bytes — same strictness, same four claims, same vm — and the blast-radius
// block that follows pins BOTH halves of the new arrangement: absent from the
// shared shell, present on both leadgen surfaces.
// ---------------------------------------------------------------------------
describe("N7 CLIP REVEAL — the real leadgen script hands over text a select cannot show", () => {
  function runReveal(scrollW: number, clientW: number, optionText: string): Record<string, unknown> {
    const attrs: Record<string, string> = {};
    const style: Record<string, string> = {};
    const sel = {
      tagName: "SELECT",
      scrollWidth: scrollW,
      clientWidth: clientW,
      selectedIndex: 0,
      options: [{ textContent: optionText }],
      style,
      setAttribute(n: string, v: string) {
        attrs[n] = v;
      },
      getAttribute: (n: string) => attrs[n] ?? null,
      removeAttribute(n: string) {
        delete attrs[n];
      },
    };
    const listeners: Record<string, (e: unknown) => void> = {};
    const doc = {
      getElementById: () => null,
      querySelectorAll: () => [sel],
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      addEventListener(type: string, fn: (e: unknown) => void) {
        listeners[type] = fn;
      },
      head: { appendChild() {} },
      body: {},
    };
    const win: Record<string, unknown> = {};
    runInNewContext(LG_CLIP_REVEAL_SCRIPT, {
      document: doc,
      window: win,
      setTimeout: (fn: () => void) => {
        fn();
        return 0;
      },
      String,
      Object,
      Number,
      Boolean,
      JSON,
      fetch: () => Promise.resolve({}),
    });
    return { attrs, style, sel, win, listeners };
  }

  it("EXECUTED: a select whose own box cannot show its selected option gets that option verbatim as a title, plus an ellipsis", () => {
    const r = runReveal(363, 312, "No presets yet — create one from the Themes manager");
    expect((r["attrs"] as Record<string, string>)["title"]).toBe("No presets yet — create one from the Themes manager");
    expect((r["attrs"] as Record<string, string>)["data-lg-clipped"]).toBe("1");
    expect((r["style"] as Record<string, string>)["textOverflow"]).toBe("ellipsis");
  });

  it("EXECUTED: a select that fits is left completely alone — no title, no ellipsis, no attribute", () => {
    const r = runReveal(312, 312, "No presets saved yet");
    expect((r["attrs"] as Record<string, string>)["title"]).toBeUndefined();
    expect((r["style"] as Record<string, string>)["textOverflow"]).toBeUndefined();
  });

  it("EXECUTED: the reveal is withdrawn when a shorter value is selected — and only ever its OWN title", () => {
    const r = runReveal(363, 312, "Seed Local Living — Not activated yet");
    const sel = r["sel"] as { scrollWidth: number; options: Array<{ textContent: string }> };
    expect((r["attrs"] as Record<string, string>)["title"]).toBe("Seed Local Living — Not activated yet");
    sel.scrollWidth = 312;
    sel.options[0]!.textContent = "R2Fix Fixture Site — Active";
    (r["win"] as { lgRevealClippedSelects: (root: unknown) => void }).lgRevealClippedSelects(null);
    expect((r["attrs"] as Record<string, string>)["title"]).toBeUndefined();
    expect((r["attrs"] as Record<string, string>)["data-lg-clipped"]).toBeUndefined();
  });

  it("EXECUTED: it reacts to the events an island-filled select actually produces (change / focusin / mouseover), with no timer of its own", () => {
    const r = runReveal(312, 312, "short");
    const listeners = r["listeners"] as Record<string, (e: unknown) => void>;
    for (const type of ["change", "focusin", "mouseover"]) expect(typeof listeners[type], type).toBe("function");
    const sel = r["sel"] as { scrollWidth: number };
    sel.scrollWidth = 400;
    (listeners["change"] as (e: unknown) => void)({ target: r["sel"] });
    expect((r["attrs"] as Record<string, string>)["title"]).toBe("short");
  });
});

// ---------------------------------------------------------------------------
// F12 BLAST RADIUS — the reveal runs on the leadgen surfaces that need it and
// changes NOTHING for any other product. `test/conversions-admin-shell.test.ts`
// owns the other half of this claim (an adminLayout call that does not opt in
// is byte-identical, 20312 / sha b7d6e8df…); it is READ-ONLY and unedited. The
// legs here are the leadgen-side half: absent from the shared shell, present
// verbatim on both leadgen surfaces, installed once.
// ---------------------------------------------------------------------------
describeDb("F12 — the clip reveal is leadgen-scoped: out of the cross-product shell, on both leadgen surfaces", () => {
  it("the SHARED admin shell (templates/layout.ts ADMIN_SCRIPTS) carries no part of the reveal", () => {
    for (const token of [
      "lgRevealClippedSelect",
      "lgRevealClippedSelects",
      "data-lg-clipped",
      "sel.scrollWidth > sel.clientWidth",
      "lgTouchesASelect",
    ]) {
      expect(ADMIN_SCRIPTS, `ADMIN_SCRIPTS must not carry "${token}" — it ships on every conversions page too`).not.toContain(token);
    }
  });

  it("the Themes rail surface emits the reveal verbatim, exactly once, and after it the tab island is still the LAST script (no vm manifest moves)", () => {
    const html = renderThemesTabPanel(true);
    expect(html).toContain(LG_CLIP_REVEAL_SCRIPT);
    expect(html.split("function lgRevealClippedSelect(").length - 1, "one copy, not two").toBe(1);
    const lastScript = html.slice(html.lastIndexOf("<script>") + "<script>".length, html.lastIndexOf("</script>"));
    expect(lastScript, "every existing harness slices this panel's LAST script and expects the tab island").toContain("refreshPresetAvailability");
    expect(lastScript).not.toContain("lgRevealClippedSelect");
  });

  it("EXECUTED: the standalone Themes manager page serves the reveal verbatim", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Blast Radius Preset", "Poppins", "Lexend")), env),
      "create preset",
    );
    const { html } = await getHtml(env, `/admin/leadgen/themes?theme=${created.item.id}`);
    expect(html).toContain(LG_CLIP_REVEAL_SCRIPT);
  });

  it("the emitted body keeps the island rules: ES5 only, and NO comment bytes (rationale stays in the TypeScript, which never ships)", () => {
    expect(LG_CLIP_REVEAL_SCRIPT).not.toMatch(/\b(?:const|let|async|class)\b|=>/);
    expect(LG_CLIP_REVEAL_SCRIPT).not.toContain("/*");
    expect(LG_CLIP_REVEAL_SCRIPT).not.toContain("//");
    expect(LG_CLIP_REVEAL_SCRIPT).not.toContain("0x");
  });

  it("EXECUTED: a second include installs nothing — one listener set per page, whatever includes it", () => {
    let added = 0;
    const win: Record<string, unknown> = {};
    const doc = {
      getElementById: () => null,
      querySelectorAll: () => [],
      addEventListener() {
        added += 1;
      },
      head: { appendChild() {} },
      body: {},
    };
    const sandbox = { document: doc, window: win, setTimeout: (fn: () => void) => (fn(), 0), String, Object, Number, Boolean, JSON };
    runInNewContext(LG_CLIP_REVEAL_SCRIPT, sandbox);
    const afterFirst = added;
    expect(afterFirst).toBeGreaterThan(0);
    runInNewContext(LG_CLIP_REVEAL_SCRIPT, sandbox);
    expect(added, "the install guard must make the second include a no-op").toBe(afterFirst);
  });
});

// ===========================================================================
// F12 RETIREMENT LEDGER — the arithmetic F10 did not state.
//
// THE NUMBERS. This file went 141 tests (gate run4/run5) -> 63 (gate run6):
// net -78. F10's report named only what it ADDED (+2 recovery, +4 reveal). The
// full arithmetic is 141 - 88 + 10 = 63, and the 10 added legs are the 4 clip-
// invariant legs, the 4 clip-reveal legs and the 2 recovery legs.
//
// WHAT THE 88 RETIRED LEGS WERE, AND WHAT EACH CLAIMED. They were F3's TWO
// container-scoped box invariants, both generated one leg per case:
//   (R) 86 legs — one per <option> of the 16 rail scalar selects that live in
//       the `.lg-scalars` grids (16 selects; 12+12+4+5+4+4+5+6+4+3+4+4+4+3+6+6
//       = 86 options). Claim per leg: THIS option's text is narrower than THIS
//       select's own content box, at the narrowest width the `.lg-scalars`
//       grid can give it.
//   (M)  2 legs — one per Themes-manager typography-grid font select
//       (#tm-headline-font, #tm-body-font). Claim per leg: every option that
//       select carries fits its own content box.
//
// WHERE EACH CLAIM IS COVERED NOW. Both claims are made by the single clip-
// invariant leg "no product-authored string is wider than the box that shows
// it", over 22 selects (the 16 scalars + 4 other Themes-tab controls + the 2
// manager font selects) instead of 18 — same conservative width model, same
// declaration-derived boxes, same narrowest-width sweep. Nothing about the
// claims is weaker; what was lost is only per-case granularity in the failure
// message, and TWO structural properties that the consolidation left implicit
// and this ledger RESTORES as executed legs:
//   1. The retired legs checked their options UNCONDITIONALLY. The clip
//      invariant checks a select's SSR option texts only while the select is
//      classified product-authored — a select that ever measures DATA-BEARING
//      has its SSR texts dropped from the universe by design (that is the (B)
//      branch: no box can bound operator data). Correct for a site picker,
//      silent coverage loss for a scalar. Leg 1 below pins the 18 selects the
//      retired legs covered as product-authored AND boxed, so they can never
//      leave the checked universe unnoticed.
//   2. The retired rail legs read their box out of the `.lg-scalars` rule, so
//      a revert of that rule failed them by construction. Leg 2 below feeds
//      the reverted rule (`repeat(2,1fr)`, the shape the defect shipped with)
//      back through the SAME arithmetic and requires it to name overflows —
//      a fail-before kept in a bottle, so the invariant can never go vacuous.
// KNOWN RESIDUAL, stated rather than hidden: on surface S2 the data-bearing
// differential renders the manager page against ITSELF (alt === html), so S2's
// data-bearing detection cannot fire. That is inherited from F10 and it does
// not weaken the retired (M) claim — alt === html means dataBearing is false,
// so both font selects' option texts are always in the checked universe, which
// is exactly what the 2 retired legs asserted. Leg 1 pins that outcome.
// ===========================================================================
describeDb("F12 RETIREMENT LEDGER — every claim the 88 consolidated legs made is still enforced", () => {
  it("EXECUTED (restores claim 1): the 18 selects F3's two box blocks covered are all still boxed AND still product-authored, so none of their 86+22 option texts can silently leave the universe", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Ledger Preset", "Newsreader", "Roboto Mono")), env),
      "create preset",
    );
    const all = await coveredSelects(env, created.item.id);

    // (R) the rail half — rebuilt STRUCTURALLY from the real markup, by the
    // same container class F3 scoped to, never from a list of today's keys.
    const railScalars = selectsInsideClass(renderThemesTabPanel(true), "lg-scalars");
    expect(railScalars.length, "the `.lg-scalars` grids no longer hold the 16 selects the retired legs covered").toBe(16);
    expect(railScalars.reduce((n, s) => n + s.options.length, 0), "the retired rail legs were one per option").toBe(86);

    // (M) the manager half.
    const { html: managerHtml } = await getHtml(env, `/admin/leadgen/themes?theme=${created.item.id}`);
    const managerFonts = managerFontSelects(managerHtml);

    const retiredUniverse: Array<{ key: string; texts: string[] }> = [
      ...railScalars.map((s) => ({ key: attr(s.attrs, "data-theme-key") ?? "(unkeyed)", texts: s.options.map((o) => o.text) })),
      ...managerFonts.map((s) => ({ key: attr(s.attrs, "id") ?? "(unkeyed)", texts: s.options.map((o) => o.text) })),
    ];
    expect(retiredUniverse.length).toBe(18);

    for (const row of retiredUniverse) {
      const covered = all.find((c) => c.key === row.key);
      expect(covered, `${row.key} was covered by a retired leg and is not in the clip invariant's enumeration`).toBeDefined();
      const c = covered as CoveredSelect;
      expect(c.box, `${row.key} lost its resolvable box`).not.toBeNull();
      expect(c.dataBearing, `${row.key} now measures data-bearing, which DROPS its option texts from the checked universe`).toBe(false);
      for (const text of row.texts) {
        expect(c.strings, `${row.key}: option "${text}" is no longer checked by the clip invariant`).toContain(text);
      }
    }
  });

  it("EXECUTED (restores claim 2): with `.lg-scalars` reverted to the shape the defect shipped with, the SAME arithmetic still names the overflows", async () => {
    const { env } = newHarness();
    const created = await json<ThemeCreateResponse>(
      await admin.request(`${API}/themes`, jsonInit("POST", presetBody("Ledger Preset", "Newsreader", "Roboto Mono")), env),
      "create preset",
    );
    const FIXED = ".lg-scalars{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}";
    const REVERTED = ".lg-scalars{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}";
    expect(LG_QUOTES_STYLES, "the real sheet must still carry the fixed rule this leg reverts").toContain(FIXED);
    const reverted = LG_QUOTES_STYLES.replace(FIXED, REVERTED);
    expect(reverted, "the mutation must actually change the sheet, or this leg proves nothing").not.toBe(LG_QUOTES_STYLES);

    const overflowing: string[] = [];
    for (const c of await coveredSelects(env, created.item.id, [reverted, ADMIN_STYLES])) {
      if (c.box === null) continue;
      for (const text of c.strings) {
        if (textWidthPx(text, c.fontPx) > c.box.content) overflowing.push(`${c.key}: "${text}"`);
      }
    }
    // Reproduced this round: 31 named overflows, the same number F10's own
    // evidence reported for this exact revert, the first three being
    // typography.display "Inherit from base" / "Space Grotesk" /
    // "Playfair Display". The count is not pinned (a label edit may legitimately move it); what is
    // pinned is that the reverted grid FAILS, and that the failures are the
    // rail scalars whose boxes that rule sets.
    expect(overflowing.length, "the reverted grid rule must still be caught").toBeGreaterThan(0);
    expect(overflowing.some((o) => o.startsWith("typography."))).toBe(true);
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
