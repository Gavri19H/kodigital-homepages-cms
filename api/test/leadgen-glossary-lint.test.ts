// LeadGen v2.5 Phase C (slice C-verify) — the 15 §15.2 GLOSSARY LINT.
//
// Contract (15 §15.2 + 12 §12.4 + 07 §7.4): forbidden terms outside Advanced
// contexts on the EMITTED normal-mode surfaces of BOTH builders — the served
// admin pages for the Section studio (edit / new / list) and the Quotes
// editor (edit / list) — plus the islands' emitted string constants:
//
//   · raw component type identifiers (IconCardAnswerGrid, TwoButtonYesNo, …)
//   · storage column identifiers (headline_text, frame_config_json, …)
//   · design-token keys (primaryWash, …) + theme role identifiers
//     (brand_primary, surface_wash, …)
//   · public-id prefixes (lgs_…, lgn_…, lgq_…, lgf_…, lgo_…)
//   · the word "JSON"
//   · the phrases "question key" / "schema path"
//   · "slot" for placements (Section-Builder surfaces; the Quote Builder's
//     "Section slot" region name from 03 §3.3 / 04 §4 is the ONE allowed form)
//   · C6: the word "slide" ANYWHERE in the served Section-Builder pages
//     (SSR copy, island JS, blobs, styles — the FULL page), while "slide"
//     stays ALLOWED Quote-Builder vocabulary (calibration test asserts the
//     quote editor still says it) — this SUPERSEDES the wave-1 page lint that
//     lived in leadgen-section-studio-ui.test.ts, extended to the dedicated
//     term matrix below without weakening (same pages, same regex, plus the
//     quote-side calibration).
//   · C1: the phrase "provider value" only ever adjacent to an Offer name
//     (window check over emitted text and island source).
//
// SURFACE MODEL (the "principled Advanced-context exemption mechanism"):
//   normal(html)   = the served markup with every Advanced CONTAINER removed
//                    by balanced-tag scan: <details class="studio-advanced-json">,
//                    <details class="lg-advanced" …> and the inspector's
//                    <div … data-studio-panel="advanced"> panel. Content inside
//                    those containers is Advanced BY CONSTRUCTION (07 §7.3).
//   visible(html)  = normal minus <script>/<style> bodies, tags stripped,
//                    entities decoded — the operator-READABLE text.
//   attrs(html)    = operator-FACING attribute values on normal markup
//                    (title / aria-label / placeholder / alt) — tooltips and
//                    accessible names ARE operator copy.
//   literals(page) = string literals of the inline island scripts (strict-ES5
//                    single/double-quoted; the islands ban backticks). Term
//                    classes that are unambiguous COPY wherever they appear
//                    (slide / JSON / question key / schema path / provider
//                    value) run against these; identifier-shaped classes
//                    (type names, column ids, token keys) do NOT — island
//                    literals legitimately carry identifiers as PLUMBING
//                    (selectors, key comparisons), never as emitted copy that
//                    a static lint could isolate. Documented per-file
//                    allowlists (each entry carries its reason) exempt the
//                    Advanced-owned island strings (e.g. the §7.3 raw-JSON
//                    editor copy) — the island can't be DOM-scoped statically.
//
// Every violation names page :: surface :: term :: ±40 chars of context, so a
// future red is actionable without re-running anything else.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { COMPONENT_CATALOG } from "../src/public/leadgen/components/registry";
import { CURATED_DESIGN_OVERRIDE_KEYS } from "../src/public/leadgen/components/content-schema";
import { FUNNEL_TOKEN_ROLES } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

// --- node:sqlite harness (repo pattern — leadgen-quote-builder-ui.test.ts) ---

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
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
  );
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
  } as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// --- fixture (author data deliberately glossary-clean, so every finding is
// UI copy, never seeded content) ----------------------------------------------

const FIXTURE_CONTENT = {
  components: [
    { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
    { type: "Subheadline", question_id: "q_sub", bind: "section_subheadline" },
    {
      type: "IconCardAnswerGrid",
      question_id: "q_kind",
      internal_field: "company_kind",
      required: true,
      choices: [
        { label: "Consulting firm", value: "consulting-firm", analytics_id: "kind-consulting", icon: "★" },
        { label: "Retail shop", value: "retail-shop", analytics_id: "kind-retail", icon: "☂" },
      ],
    },
    { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", props: { placeholder: "ZIP code" } },
  ],
};

// --- surface extraction --------------------------------------------------------

// Balanced removal of an element whose OPEN tag matches `opener`. Our own SSR
// is well-formed; an unbalanced container is itself a bug worth failing on.
function removeContainers(html: string, opener: RegExp, tag: string): string {
  let out = html;
  for (;;) {
    const start = out.search(new RegExp(opener.source, "i"));
    if (start === -1) return out;
    const tokenRe = new RegExp(`<${tag}\\b|</${tag}>`, "gi");
    let depth = 0;
    let end = -1;
    for (const t of out.slice(start).matchAll(tokenRe)) {
      if (t[0].startsWith("</")) {
        depth -= 1;
        if (depth === 0) {
          end = start + (t.index ?? 0) + t[0].length;
          break;
        }
      } else {
        depth += 1;
      }
    }
    if (end === -1) throw new Error(`unbalanced <${tag}> for Advanced-container strip`);
    out = out.slice(0, start) + out.slice(end);
  }
}

// The Advanced-context exemption mechanism: content inside these containers is
// Advanced by construction and exempt from the normal-mode lint. Each entry
// carries its contract citation:
//   · details.lg-advanced / details.studio-advanced-json — 07 §7.3 "Advanced |
//     always, collapsed" (quote regions, funnel settings, theme admin, studio
//     raw-node editor);
//   · details.lg-rb-advanced — the rules-builder's per-card "Advanced: raw
//     conditions" disclosure (same §7.3 pattern, rules-builder class);
//   · div[data-studio-panel="advanced"] — the studio inspector's Advanced tab
//     panel (07 §7.3);
//   · div[data-studio-drawer-panel="preview"] — the studio "Preview & debug"
//     drawer: 12 §12.3 declares the debug drawer AN ADVANCED SURFACE ("renders
//     the redacted JSON in the debug drawer (Advanced surface — JSON allowed
//     there)").
const ADVANCED_CONTAINERS: ReadonlyArray<{ opener: RegExp; tag: string }> = [
  { opener: /<details\b[^>]*class="[^"]*(?:lg-advanced|lg-rb-advanced|studio-advanced-json)[^"]*"[^>]*>/, tag: "details" },
  { opener: /<div\b[^>]*data-studio-panel="advanced"[^>]*>/, tag: "div" },
  { opener: /<div\b[^>]*data-studio-drawer-panel="preview"[^>]*>/, tag: "div" },
];

function stripAdvanced(html: string): string {
  let out = html;
  for (const c of ADVANCED_CONTAINERS) out = removeContainers(out, c.opener, c.tag);
  return out;
}

function stripScriptsAndStyles(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
}

function visibleText(normalHtml: string): string {
  return decodeEntities(stripScriptsAndStyles(normalHtml).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
}

const OPERATOR_ATTRS = ["title", "aria-label", "placeholder", "alt"] as const;

function operatorAttrs(normalHtml: string): Array<{ attr: string; value: string }> {
  const markupOnly = stripScriptsAndStyles(normalHtml);
  const out: Array<{ attr: string; value: string }> = [];
  for (const attr of OPERATOR_ATTRS) {
    const re = new RegExp(`\\b${attr}="([^"]*)"`, "gi");
    for (const m of markupOnly.matchAll(re)) out.push({ attr, value: decodeEntities(m[1] ?? "") });
  }
  return out;
}

const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function inlineIslands(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    if ((match[0] ?? "").includes('type="application/json"')) continue;
    blocks.push(match[1] ?? "");
  }
  return blocks;
}

interface IslandLiteral {
  text: string;
  index: number; // position of the literal in its island source (window checks)
  island: number;
}

// Strict-ES5 island sources (no backticks by house rule): scan '…' / "…"
// literals with escape handling.
function stringLiterals(islands: string[]): IslandLiteral[] {
  const out: IslandLiteral[] = [];
  islands.forEach((src, island) => {
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === "'" || ch === '"') {
        const quote = ch;
        let j = i + 1;
        let text = "";
        let closed = false;
        while (j < src.length) {
          const c = src[j];
          if (c === "\\") {
            text += src[j] + (src[j + 1] ?? "");
            j += 2;
            continue;
          }
          if (c === quote) {
            closed = true;
            break;
          }
          if (c === "\n") break; // unterminated on one line → not a literal (regex/division noise guard)
          text += c;
          j += 1;
        }
        if (closed) {
          out.push({ text, index: i, island });
          i = j + 1;
          continue;
        }
      }
      i += 1;
    }
  });
  return out;
}

// --- term matrix ---------------------------------------------------------------

// Raw component type identifiers: the camelCase COMPOUND names are code
// identifiers and never legitimate operator words. Single-English-word type
// names (Stack, Columns, Spacer, Subheadline, Slider…) double as real copy on
// purpose (08 §8.3 labels) and are exempt by that documented principle.
const COMPOUND_TYPE_NAMES: readonly string[] = Object.keys(COMPONENT_CATALOG).filter((t) => /[a-z][A-Z]/.test(t));

// Storage column identifiers (12 §12.4 "column names"): snake_case storage
// vocabulary — never operator copy outside Advanced.
//
// FIX 6b: the matrix is DERIVED at test time from the REAL migration chain —
// every leadgen_* table's PRAGMA table_info over the SAME migrations the
// harness applies — so a new column is linted the day its migration lands
// (the old hand-list missed redirect_url_allowlisted). Filtered to COMPOUND
// (underscore-bearing) identifiers: single-English-word columns (status,
// label, weight, priority…) double as real operator copy by the SAME
// documented principle the type-name and token matrices use. The curated
// §14.8 design-override keys ride along under the same compound principle
// (camelCase compounds; `columns` is a real English word used by legit copy
// — "Card columns (2–5)"). The previous hand-list is kept as an API-shape
// supplement so nothing previously linted is dropped (STRENGTHEN-only).
const API_FIELD_IDENTIFIERS: readonly string[] = [
  "headline_text",
  "subheadline_text",
  "content_json",
  "content_html",
  "section_name",
  "continue_mode",
  "address_validation_enabled",
  "design_overrides_json",
  "frame_config_json",
  "frame_overrides_json",
  "theme_json",
  "offer_payload_field_path",
  "provider_expected_type",
  "output_value_map",
  "required_for_offer",
  "value_transform",
  "internal_field",
  "question_key",
  "analytics_id",
  "question_id",
  "public_id",
  "answer_maps",
  "selected_offers",
  "active_payload_schema_id",
];

let columnIdentifiersCache: readonly string[] | null = null;
function derivedColumnIdentifiers(): readonly string[] {
  if (columnIdentifiersCache !== null) return columnIdentifiersCache;
  const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
  const names = new Set<string>(API_FIELD_IDENTIFIERS);
  const tables = sdb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'leadgen_%'")
    .all() as Array<{ name: string }>;
  expect(tables.length, "leadgen_* tables present after the migration chain").toBeGreaterThan(10);
  for (const t of tables) {
    const cols = sdb.prepare(`PRAGMA table_info(${t.name})`).all() as Array<{ name: string }>;
    expect(cols.length, `${t.name} has columns`).toBeGreaterThan(0);
    for (const col of cols) {
      if (col.name.includes("_")) names.add(col.name);
    }
  }
  sdb.close();
  for (const key of CURATED_DESIGN_OVERRIDE_KEYS) {
    if (/[a-z][A-Z]/.test(key)) names.add(key);
  }
  columnIdentifiersCache = [...names].sort();
  return columnIdentifiersCache;
}

// Design-token keys (07 §7.4 "token keys like primaryWash") — grounded in the
// REAL registries: camelCase compound color-token keys of the default design +
// every underscore-bearing theme ROLE identifier (09 §9.1). Single-word keys /
// roles (accent, border, success…) are English words used as labels by design.
const TOKEN_KEY_IDENTIFIERS: readonly string[] = [
  ...Object.keys(defaultFunnelDesign.color).filter((k) => /[a-z][A-Z]/.test(k)),
  ...FUNNEL_TOKEN_ROLES.filter((r) => r.includes("_")),
];

interface Violation {
  page: string;
  surface: string;
  term: string;
  context: string;
}

function fmt(v: Violation): string {
  return `${v.page} :: ${v.surface} :: ${v.term} :: …${v.context}…`;
}

function findTerm(text: string, re: RegExp): Array<{ match: string; context: string }> {
  const out: Array<{ match: string; context: string }> = [];
  const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of text.matchAll(global)) {
    const at = m.index ?? 0;
    out.push({
      match: m[0],
      context: text.slice(Math.max(0, at - 40), Math.min(text.length, at + m[0].length + 40)),
    });
  }
  return out;
}

interface PageCorpus {
  label: string;
  builder: "section" | "quote";
  raw: string;
  normal: string;
  visible: string;
  attrs: Array<{ attr: string; value: string }>;
  islands: string[];
  literals: IslandLiteral[];
}

async function getHtml(env: Env, path: string): Promise<string> {
  const res = await admin.request(path, {}, env);
  expect(res.status, `${path} status`).toBe(200);
  return res.text();
}

async function buildPages(): Promise<PageCorpus[]> {
  const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
  const env = buildEnv(d1FromSqlite(sdb));

  // Section fixture through the REAL create API.
  const createSection = await admin.request(
    `${API}/sections`,
    jsonInit("POST", {
      section_name: "Glossary coverage unit",
      activity: "quote_funnel",
      vertical: "life",
      headline_text: "Which kind of company do you run?",
      subheadline_text: "Takes about two minutes.",
      continue_mode: "button",
      status: "active",
      content_json: JSON.stringify(FIXTURE_CONTENT),
    }),
    env,
  );
  expect(createSection.status, `create section: ${await createSection.clone().text()}`).toBe(201);
  const section = (await createSection.json()) as { id: number; public_id: string };

  // Quote fixture (quote → funnel → variant → frame) through the REAL APIs.
  const createQuote = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Glossary coverage journey", activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(createQuote.status, `create quote: ${await createQuote.clone().text()}`).toBe(201);
  const quote = (await createQuote.json()) as {
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  const putVariant = await admin.request(
    `${API}/variants/${quote.funnels[0]!.variants[0]!.public_id}`,
    jsonInit("PUT", { sections: [{ section_id: section.id, position: 0 }] }),
    env,
  );
  expect(putVariant.status, `variant sections: ${await putVariant.clone().text()}`).toBe(200);
  const putFrame = await admin.request(
    `${API}/funnels/${quote.funnels[0]!.public_id}/frame`,
    jsonInit("PUT", { frame_config_json: { version: 1, template: "centered" } }),
    env,
  );
  expect(putFrame.status, `frame put: ${await putFrame.clone().text()}`).toBe(200);

  const pageDefs: Array<{ label: string; builder: "section" | "quote"; path: string }> = [
    { label: "studio-edit", builder: "section", path: `/admin/leadgen/sections/${section.public_id}/edit` },
    { label: "studio-new", builder: "section", path: "/admin/leadgen/sections/new" },
    { label: "sections-list", builder: "section", path: "/admin/leadgen/sections" },
    { label: "quotes-edit", builder: "quote", path: `/admin/leadgen/quotes/${quote.public_id}/edit` },
    { label: "quotes-list", builder: "quote", path: "/admin/leadgen/quotes" },
  ];

  const out: PageCorpus[] = [];
  for (const def of pageDefs) {
    const raw = await getHtml(env, def.path);
    const normal = stripAdvanced(raw);
    const islands = inlineIslands(raw);
    out.push({
      label: def.label,
      builder: def.builder,
      raw,
      normal,
      visible: visibleText(normal),
      attrs: operatorAttrs(normal),
      islands,
      literals: stringLiterals(islands),
    });
  }
  return out;
}

let pagesPromise: Promise<PageCorpus[]> | null = null;
function pages(): Promise<PageCorpus[]> {
  if (pagesPromise === null) pagesPromise = buildPages();
  return pagesPromise;
}

// Scan visible text + operator attrs of one page for a term regex.
function scanNormalSurfaces(page: PageCorpus, term: string, re: RegExp, allow?: RegExp): Violation[] {
  const out: Violation[] = [];
  const strip = (s: string): string => (allow ? s.replace(new RegExp(allow.source, `${allow.flags.replace("g", "")}g`), " ") : s);
  for (const hit of findTerm(strip(page.visible), re)) {
    out.push({ page: page.label, surface: "visible-text", term, context: hit.context });
  }
  for (const a of page.attrs) {
    for (const hit of findTerm(strip(a.value), re)) {
      out.push({ page: page.label, surface: `attr:${a.attr}`, term, context: hit.context });
    }
  }
  return out;
}

// --- documented island allowlists (each entry: matcher + reason) ----------------

const ISLAND_JSON_ALLOW: ReadonlyArray<{ re: RegExp; reason: string }> = [
  // 07 §7.3: the Advanced tab's raw-node editor — Advanced surface by contract,
  // but the island's literals cannot be DOM-scoped statically.
  { re: /^Invalid JSON: $/, reason: "Advanced raw-node editor parse error (§7.3 Advanced)" },
  { re: /node JSON must be an object/, reason: "Advanced raw-node editor shape error (§7.3 Advanced)" },
  { re: /^Edit the raw component JSON\?/, reason: "the §7.3 explicit Edit-raw confirm (Advanced)" },
  // the rules-builder island rebuilds its per-card Advanced disclosure (the
  // SSR twin is the stripped details.lg-rb-advanced container).
  { re: /^Advanced: raw conditions JSON \(read-only\)$/, reason: "rules-builder Advanced-disclosure summary (island twin of details.lg-rb-advanced)" },
  // FIX 6a: the raw-fallback warning entry is GONE — the banner now speaks
  // operator words ("advanced settings"), so it needs no exemption.
];

describeDb("15 §15.2 glossary-lint — normal-mode language over the emitted builder surfaces", () => {
  it("corpus calibration: every page yields a non-trivial normal-mode corpus (extractor cannot silently no-op)", async () => {
    const all = await pages();
    expect(all).toHaveLength(5);
    for (const p of all) {
      expect(p.visible.length, `${p.label} visible text`).toBeGreaterThan(400);
      expect(p.attrs.length, `${p.label} operator attrs`).toBeGreaterThan(5);
    }
    // the two editors carry their islands + a meaningful literal corpus
    for (const label of ["studio-edit", "quotes-edit"]) {
      const p = all.find((x) => x.label === label)!;
      expect(p.islands.length, `${label} islands`).toBeGreaterThan(0);
      expect(p.literals.length, `${label} island literals`).toBeGreaterThan(100);
    }
    // the Advanced strip actually removed the known Advanced ELEMENTS (the
    // stylesheet keeps mentioning the class names — styles are not copy)
    const studio = all.find((x) => x.label === "studio-edit")!;
    expect(studio.raw).toContain('data-studio-panel="advanced"');
    expect(studio.normal).not.toContain('data-studio-panel="advanced"');
    expect(studio.normal).not.toContain('<details class="studio-advanced-json"');
    expect(studio.raw).toContain('data-studio-drawer-panel="preview"');
    expect(studio.normal).not.toContain('data-studio-drawer-panel="preview"');
    const quotes = all.find((x) => x.label === "quotes-edit")!;
    expect(quotes.raw).toContain('<details class="lg-advanced"');
    expect(quotes.normal).not.toContain('<details class="lg-advanced"');
  });

  it("C6: 'slide' never appears ANYWHERE in the served Section-Builder pages (full page — supersedes the wave-1 studio lint)", async () => {
    const all = await pages();
    const violations: string[] = [];
    for (const p of all.filter((x) => x.builder === "section")) {
      // the WORD "slide" (slide/slides/slideshow…) in any casing. Exempt by
      // regex shape: "slider" (ARIA role, ::-webkit-slider-thumb, the §8.3
      // item name) and interior identifier fragments (toastSlideIn has no
      // word boundary before "Slide").
      const hits = [...p.raw.matchAll(/.{0,20}\bslide(?!r)[a-z]*.{0,20}/gi)].map((m) => `${p.label} :: ${m[0]}`);
      violations.push(...hits);
    }
    expect(violations, `Section-Builder pages say 'slide' ${violations.length}x`).toEqual([]);
  });

  it("C6 calibration: 'Slide' remains ALLOWED Quote-Builder vocabulary (the quote editor still says it)", async () => {
    const all = await pages();
    const quotesEdit = all.find((x) => x.label === "quotes-edit")!;
    // the all-slides stepper label — SSR'd "Slide 1" + island "Slide N of M"
    expect(quotesEdit.raw).toMatch(/\bSlide\b/);
  });

  it("raw component type identifiers never appear as normal-mode operator copy (both builders)", async () => {
    const all = await pages();
    const violations: Violation[] = [];
    for (const p of all) {
      for (const t of COMPOUND_TYPE_NAMES) {
        violations.push(...scanNormalSurfaces(p, `type:${t}`, new RegExp(`\\b${t}\\b`)));
      }
    }
    expect(violations.map(fmt)).toEqual([]);
  });

  it("storage column identifiers never appear as normal-mode operator copy (both builders)", async () => {
    const all = await pages();
    // FIX 6b grounding: the derived matrix is non-trivial, carries the REAL
    // columns (including the one the hand-list missed) and the compound
    // curated override keys.
    const columns = derivedColumnIdentifiers();
    expect(columns.length, "derived matrix size").toBeGreaterThan(60);
    for (const known of ["headline_text", "frame_config_json", "redirect_url_allowlisted", "internal_field", "rule_type", "target_offer_id"]) {
      expect(columns, `derived matrix carries ${known}`).toContain(known);
    }
    for (const key of ["iconColor", "featureColor", "rangeColor", "buttonBackground", "buttonText", "gridGap", "mobileBehavior"]) {
      expect(columns, `curated key ${key} rides the matrix`).toContain(key);
    }
    const violations: Violation[] = [];
    for (const p of all) {
      for (const col of columns) {
        violations.push(...scanNormalSurfaces(p, `column:${col}`, new RegExp(`\\b${col}\\b`, "i")));
      }
    }
    expect(violations.map(fmt)).toEqual([]);
  });

  it("design-token keys + theme role identifiers never appear as normal-mode operator copy (both builders)", async () => {
    const all = await pages();
    expect(TOKEN_KEY_IDENTIFIERS, "grounded registry lists resolved").toContain("primaryWash");
    expect(TOKEN_KEY_IDENTIFIERS).toContain("brand_primary");
    const violations: Violation[] = [];
    for (const p of all) {
      for (const key of TOKEN_KEY_IDENTIFIERS) {
        violations.push(...scanNormalSurfaces(p, `token:${key}`, new RegExp(`\\b${key}\\b`)));
      }
    }
    expect(violations.map(fmt)).toEqual([]);
  });

  it("public-id prefixes (lgs_/lgn_/lgq_/lgf_/lgo_) never appear in normal-mode visible text", async () => {
    const all = await pages();
    const violations: Violation[] = [];
    for (const p of all) {
      for (const hit of findTerm(p.visible, /\blg[a-z]?_[A-Za-z0-9]+/g)) {
        violations.push({ page: p.label, surface: "visible-text", term: "public-id", context: hit.context });
      }
    }
    expect(violations.map(fmt)).toEqual([]);
  });

  it("the word 'JSON' never appears on normal-mode surfaces; island copy only via the documented Advanced allowlist", async () => {
    const all = await pages();
    const violations: Violation[] = [];
    for (const p of all) {
      violations.push(...scanNormalSurfaces(p, "JSON", /\bJSON\b/i));
      // island literals: case-SENSITIVE (the copy form) — 'application/json',
      // '#lg-node-json' selector plumbing stay lowercase and out of scope.
      for (const lit of p.literals) {
        if (!/\bJSON\b/.test(lit.text)) continue;
        if (ISLAND_JSON_ALLOW.some((a) => a.re.test(lit.text))) continue;
        violations.push({ page: p.label, surface: "island-literal", term: "JSON", context: lit.text.slice(0, 90) });
      }
    }
    expect(violations.map(fmt)).toEqual([]);
  });

  it("the phrases 'question key' / 'schema path' never appear outside Advanced (both builders, islands included)", async () => {
    const all = await pages();
    const violations: Violation[] = [];
    const phrases: ReadonlyArray<{ term: string; re: RegExp }> = [
      { term: "question key", re: /\bquestion[\s-]key\b/i },
      { term: "schema path", re: /\bschema[\s-]path\b/i },
    ];
    for (const p of all) {
      for (const { term, re } of phrases) {
        violations.push(...scanNormalSurfaces(p, term, re));
        for (const lit of p.literals) {
          for (const hit of findTerm(lit.text, re)) {
            violations.push({ page: p.label, surface: "island-literal", term, context: hit.context });
          }
        }
      }
    }
    expect(violations.map(fmt)).toEqual([]);
  });

  it("'slot' never appears on Section-Builder surfaces (12 §12.4: 'slot' is the banned PLACEMENT synonym — placements surface Section-side)", async () => {
    // Scope note: 12 §12.4 forbids "slot" FOR PLACEMENTS. Placement vocabulary
    // surfaces only on the Section-side mapping panels (the drawer's Placement
    // column); the Quote Builder never shows placements and its own §3.3/§4
    // region is NAMED section_slot ("Section slot" scope header, template
    // descriptions like "white card slot") — the banned sense cannot occur
    // there, so the check is Section-Builder-scoped by design.
    const all = await pages();
    const violations: Violation[] = [];
    for (const p of all.filter((x) => x.builder === "section")) {
      violations.push(...scanNormalSurfaces(p, "slot", /\bslot\b/i));
    }
    expect(violations.map(fmt)).toEqual([]);
  });

  it("C1: every 'provider value' mention rides adjacent to an Offer name (±80-char window, SSR text + island source)", async () => {
    const all = await pages();
    const violations: string[] = [];
    for (const p of all) {
      for (const m of p.visible.matchAll(/provider\s+values?/gi)) {
        const at = m.index ?? 0;
        const win = p.visible.slice(Math.max(0, at - 80), at + m[0].length + 80);
        if (!/\boffers?\b/i.test(win)) violations.push(`${p.label} :: visible-text :: …${win}…`);
      }
      for (const lit of p.literals) {
        if (!/provider\s+values?/i.test(lit.text)) continue;
        const src = p.islands[lit.island] ?? "";
        const win = src.slice(Math.max(0, lit.index - 80), lit.index + lit.text.length + 82);
        if (!/\boffers?\b/i.test(win)) violations.push(`${p.label} :: island-literal :: '${lit.text}' :: …${win}…`);
      }
    }
    expect(violations).toEqual([]);
  });
});
