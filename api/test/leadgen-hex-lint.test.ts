// LeadGen v2.5 Phase C (slice C-verify) — the 15 §15.2 HEX LINT.
//
// Contract (15 §15.2 + 07 §7.4 + 09 §9.4): "no hex literals in normal-mode
// option labels" — and, per §7.4, no hex STRINGS as operator copy on any
// normal surface. Engineering surface (same model as the glossary lint):
// the EMITTED normal-mode pages of BOTH builders — Section studio (edit /
// new / list) + Quotes editor (edit / list):
//
//   1. every <option> label (the contract's named surface),
//   2. the whole normal-mode visible text,
//   3. operator-facing attributes (title / aria-label / placeholder / alt),
//   4. the islands' emitted string literals.
//
// Advanced-context exemption mechanism (identical to the glossary lint):
// Advanced CONTAINERS are removed by balanced scan before any SSR corpus is
// read — <details class="studio-advanced-json">, <details class="lg-advanced">
// and the inspector's data-studio-panel="advanced" panel. The 09 §9.3 Advanced
// custom-color path is the ONLY legitimate hex entry point, and it lives
// inside those containers. Island literals cannot be DOM-scoped statically, so
// two documented exemptions apply there:
//   · CSS-rule-shaped literals (contain `{`, `:`+`;`, `}`) — style injection
//     (e.g. the quotes island's selection-outline rule), presentation not copy;
//   · the per-file allowlist below, each entry with its reason (the §9.3
//     Advanced custom-color validation message names a hex EXAMPLE).
//
// <style> blocks and inline style="" attributes are stylesheet surfaces, not
// operator text — excluded by construction (tags are stripped whole).
//
// Every violation names page :: surface :: ±40 chars of context.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

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

// Fixture content: hex-free author data (a hex finding is always UI-emitted,
// never seeded content). A choice grid + ZIP guarantee the Design-tab role
// rows, the toolbar clusters and the §9.5 overrides drawer all SSR.
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

// --- surface extraction (the glossary-lint model) -------------------------------

// DEV-66a (mirrors the glossary lint — one mechanism, two suites): with
// `keepSummary` the container's FIRST <summary> is re-emitted in place of the
// removed container — a collapsed <details> still RENDERS its summary, so the
// label is always-visible operator copy the hex scan must cover. Details
// containers strip first; a summary nested inside an enclosing Advanced div
// panel is removed with that panel (correct: it only shows on the Advanced tab).
function removeContainers(html: string, opener: RegExp, tag: string, keepSummary = false): string {
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
    const summary = keepSummary
      ? (out.slice(start, end).match(/<summary\b[^>]*>[\s\S]*?<\/summary>/i)?.[0] ?? "")
      : "";
    out = out.slice(0, start) + summary + out.slice(end);
  }
}

// Same container set as the glossary lint (one mechanism, two suites):
// §7.3 Advanced disclosures (lg-advanced / lg-rb-advanced /
// studio-advanced-json), the studio inspector's Advanced tab panel, and the
// "Preview & debug" drawer — 12 §12.3 declares the debug drawer an Advanced
// surface. The details entries keep their always-visible <summary> labels on
// the normal surface (DEV-66a).
const ADVANCED_CONTAINERS: ReadonlyArray<{ opener: RegExp; tag: string; keepSummary?: boolean }> = [
  { opener: /<details\b[^>]*class="[^"]*(?:lg-advanced|lg-rb-advanced|studio-advanced-json)[^"]*"[^>]*>/, tag: "details", keepSummary: true },
  { opener: /<div\b[^>]*data-studio-panel="advanced"[^>]*>/, tag: "div" },
  { opener: /<div\b[^>]*data-studio-drawer-panel="preview"[^>]*>/, tag: "div" },
];

function stripAdvanced(html: string): string {
  let out = html;
  for (const c of ADVANCED_CONTAINERS) out = removeContainers(out, c.opener, c.tag, c.keepSummary === true);
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

// Every <option> LABEL on the normal-mode markup — the contract's named
// surface ("no hex literals in normal-mode option labels").
function optionLabels(normalHtml: string): string[] {
  const out: string[] = [];
  for (const m of stripScriptsAndStyles(normalHtml).matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)) {
    out.push(decodeEntities((m[1] ?? "").replace(/<[^>]+>/g, " ")).trim());
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
  index: number; // position of the literal's OPENING quote in its island source
  island: number;
}

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
          if (c === "\n") break;
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

// The hex-literal shape (§9.4 LEGACY_HEX_RE family): #rgb…#rrggbbaa. Entities
// are decoded BEFORE scanning, so "&#8212;" can never read as "#8212".
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

// CSS-rule-shaped island literal → style injection, not operator copy.
function isCssRuleLiteral(text: string): boolean {
  return text.includes("{") && text.includes("}") && text.includes(":");
}

// v3.1 §6.2/§7 (Section-studio re-chrome): a BARE CSS declaration-list — no
// wrapping selector/braces — is the SAME "style injection, not copy" shape,
// just without the braces. This is the golden master's OWN per-state
// style-helper idiom (seg()/segFull()/vpSeg()/tab()/fieldBoxStyle()/
// fieldWrapStyle()/frameBtnStyle()/… every one of these golden helpers
// returns exactly "prop:value;prop:value;…", applied via a style attribute)
// — the ES5 island re-implements each as a function returning the identical
// string, so these literals are style injection through .setAttribute('style',
// …) / .style.cssText, never rendered as visible operator text. Structural,
// not value-based (unlike ISLAND_HEX_ALLOW): the WHOLE literal must parse as
// 2+ semicolon-separated `key:value` declarations, where each key is a bare
// LOWERCASE-hyphenated CSS-property-shaped token (no spaces, no capitals —
// real CSS properties are never "Color"/"Type"/"Field") — a real sentence
// with a colon ("See docs: https://x") never matches because "See docs"
// contains a space, so this cannot be used to smuggle real operator copy
// through on shape alone.
function isCssDeclarationListLiteral(text: string): boolean {
  const parts = text
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length < 2) return false;
  return parts.every((p) => /^[a-z-]+:.+$/.test(p));
}

// Adversarial review m1: shape alone is not enough — "Color: #1B3A5C; Size: M"
// and "Type: FreeTextQuestion; Field: zip" both LOOK like declaration lists.
// (The tightened lowercase-key shape above already rejects both of those two
// examples, since real CSS properties are never capitalized — but shape is
// still only a necessary, not sufficient, condition.) The exemption now ALSO
// requires the literal's OWN originating usage — read from the real island
// source, never assumed — to actually flow into a style sink: either a direct
// assignment (`X.style.cssText = …` / `X.setAttribute('style', …)`) or this
// codebase's own multi-part concatenation idiom (`var css = '…'; css += '…';`,
// later passed to one of those sinks — buildHandle's per-state literal is
// exactly this shape). The sink pattern is looked for within a fixed lookbehind
// window (not "back to the nearest `;`/`{`/`}`" — a bare declaration-list
// literal routinely CONTAINS its own internal `;` between declarations, which
// would make that boundary search stop INSIDE a prior sibling literal instead
// of at the real statement start; a ternary's second+ branch is exactly this
// case). A fixed window is a heuristic, not a parser — same order of rigor as
// the pre-existing DEV-66c toast-hex context check — but it correctly
// recognizes every real shape in this file (direct/concat/ternary) without
// being fooled by a prior literal's own punctuation.
const CSS_SINK_CONTEXT_RE = /\.style\.cssText\s*=|\.setAttribute\(\s*['"]style['"]\s*,|\bcss\w*\s*\+?=/i;
const SINK_LOOKBEHIND_CHARS = 400;
function flowsToStyleSink(lit: IslandLiteral, islandSrc: string): boolean {
  const windowStart = Math.max(0, lit.index - SINK_LOOKBEHIND_CHARS);
  return CSS_SINK_CONTEXT_RE.test(islandSrc.slice(windowStart, lit.index));
}
// The golden's OWN "returns a style string" helper idiom (segStyle/
// vpSegStyle/… — Appendix D, cited above): the literal sits in a
// `return cond ? 'A' : 'B';` inside a helper function, and the ACTUAL style
// sink is wherever the CALLER later does `el.setAttribute('style',
// segStyle(x))` — potentially far away in the source, sometimes a different
// function entirely. Fixed lookbehind window again (not a boundary search):
// "return" is a JS keyword that can never appear as text WITHIN a css
// declaration-list string, so unlike `;` it is never confused by a literal's
// OWN internal punctuation — but the FIRST branch of a two-branch ternary
// sits entirely BETWEEN "return" and the SECOND branch's literal, and that
// first branch's own semicolons would defeat any "nothing but the ternary
// condition in between" boundary check just as badly. A fixed window is the
// same order of rigor as the sink check above, and covers every real
// segStyle/vpSegStyle-shaped helper in this file.
const RETURN_LOOKBEHIND_CHARS = 400;
function isReturnedDeclarationList(lit: IslandLiteral, islandSrc: string): boolean {
  const windowStart = Math.max(0, lit.index - RETURN_LOOKBEHIND_CHARS);
  return /\breturn\b/.test(islandSrc.slice(windowStart, lit.index));
}
// A BARE hex value (no declaration-list shape — just "#1B3A5C" standing
// alone) assigned DIRECTLY to a CSSStyleDeclaration property
// (`el.style.color = '#…'`) is the SAME style-injection concept through a
// DIFFERENT, non-cssText sink — used where only one property should change
// without clobbering the element's other inline styles (a cssText
// re-assignment would). A short, unanchored lookbehind window (not "the sink
// pattern must be the LAST thing before the literal" — a ternary's second
// branch, e.g. `el.style.color = complete ? '#0E7C3A' : '#5A6470'`, has the
// ternary's own `: ` immediately before it, not the assignment itself).
const STYLE_PROPERTY_SINK_RE = /\.style\.[a-zA-Z]+\s*=/;
const HEX_ONLY_RE = /^#[0-9a-fA-F]{3,8}$/;
function isStyleSinkBareHex(lit: IslandLiteral, islandSrc: string): boolean {
  if (!HEX_ONLY_RE.test(lit.text)) return false;
  const windowStart = Math.max(0, lit.index - 80);
  return STYLE_PROPERTY_SINK_RE.test(islandSrc.slice(windowStart, lit.index));
}
function isStyleSinkDeclarationList(lit: IslandLiteral, islandSrc: string): boolean {
  if (isStyleSinkBareHex(lit, islandSrc)) return true;
  if (!isCssDeclarationListLiteral(lit.text)) return false;
  return flowsToStyleSink(lit, islandSrc) || isReturnedDeclarationList(lit, islandSrc);
}

// Documented island allowlist — each entry names its reason. DEV-66c: an
// entry may additionally be CONTEXT-SCOPED via `context(lit, islandSrc)` —
// the exemption then applies ONLY where the literal originates (its usage
// site inside the island source), never globally by value. The 4 admin-shell
// toast hexes are the scoped class: the SAME hex string anywhere else (an
// option label, a chip, a different island) is a violation.
interface IslandHexAllowEntry {
  re: RegExp;
  reason: string;
  context?: (lit: IslandLiteral, islandSrc: string) => boolean;
}

const ISLAND_HEX_ALLOW: ReadonlyArray<IslandHexAllowEntry> = [
  {
    re: /^Custom colors must be a color value like #1a2b3c\.$/,
    reason: "09 §9.3 Advanced custom-color validation message — the ONLY hex entry point names a hex EXAMPLE (Advanced surface)",
  },
  {
    re: /^#(?:10b981|ef4444|f59e0b|3b82f6)$/,
    reason:
      "admin-shell toast background values (templates/layout.ts showToast: toast.style.background = '#…') — style-property " +
      "assignments in the SHARED shell script that rides every admin page; presentation, never an option label " +
      "(the 'toastSlideIn' class of platform identifier)",
    // DEV-66c context scope: the literal's own usage site must BE the
    // showToast style assignment — `toast.style.background = ` immediately
    // precedes the opening quote in the originating shell script.
    context: (lit, islandSrc) => /toast\.style\.background\s*=\s*$/.test(islandSrc.slice(0, lit.index)),
  },
];

// True when an island hex literal is exempt — value match AND (when the entry
// is context-scoped) the originating-context predicate. Exposed as a function
// so the calibration test can probe the scoping directly.
function isAllowedIslandHex(lit: IslandLiteral, islandSrc: string): boolean {
  return ISLAND_HEX_ALLOW.some((a) => a.re.test(lit.text) && (a.context === undefined || a.context(lit, islandSrc)));
}

interface PageCorpus {
  label: string;
  normal: string;
  visible: string;
  attrs: Array<{ attr: string; value: string }>;
  options: string[];
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

  const createSection = await admin.request(
    `${API}/sections`,
    jsonInit("POST", {
      section_name: "Hex coverage unit",
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

  const createQuote = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Hex coverage journey", activity: "quote_funnel", verticals: ["life"] }),
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

  const pageDefs: Array<{ label: string; path: string }> = [
    { label: "studio-edit", path: `/admin/leadgen/sections/${section.public_id}/edit` },
    { label: "studio-new", path: "/admin/leadgen/sections/new" },
    { label: "sections-list", path: "/admin/leadgen/sections" },
    { label: "quotes-edit", path: `/admin/leadgen/quotes/${quote.public_id}/edit` },
    { label: "quotes-list", path: "/admin/leadgen/quotes" },
  ];

  const out: PageCorpus[] = [];
  for (const def of pageDefs) {
    const raw = await getHtml(env, def.path);
    const normal = stripAdvanced(raw);
    const islands = inlineIslands(raw);
    out.push({
      label: def.label,
      normal,
      visible: visibleText(normal),
      attrs: operatorAttrs(normal),
      options: optionLabels(normal),
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

function hexHits(text: string): string[] {
  return [...text.matchAll(HEX_RE)].map((m) => {
    const at = m.index ?? 0;
    return `${m[0]} :: …${text.slice(Math.max(0, at - 40), Math.min(text.length, at + m[0].length + 40))}…`;
  });
}

describeDb("15 §15.2 hex-lint — no hex literals on normal-mode operator surfaces", () => {
  it("corpus calibration: option labels, attrs and island literals were actually extracted", async () => {
    const all = await pages();
    expect(all).toHaveLength(5);
    const studio = all.find((p) => p.label === "studio-edit")!;
    // the studio Design tab role selects alone contribute dozens of options
    expect(studio.options.length, "studio option labels").toBeGreaterThan(40);
    expect(studio.attrs.length, "studio operator attrs").toBeGreaterThan(10);
    expect(studio.literals.length, "studio island literals").toBeGreaterThan(100);
    // …and the role rows render their swatch hooks (the §9.4 surface exists)
    expect(studio.normal).toContain("data-override-swatch");
    // the detector itself works (self-test on a crafted violation) …
    expect(hexHits("pick #1B3A5C now")).toHaveLength(1);
    // …and entity decoding prevents the "&#8212;" → "#8212" false positive
    expect(hexHits(decodeEntities("dash &#8212; entity"))).toHaveLength(0);
  });

  it("no hex literals in normal-mode <option> labels (the contract surface — both builders)", async () => {
    const all = await pages();
    const violations: string[] = [];
    for (const p of all) {
      for (const label of p.options) {
        violations.push(...hexHits(label).map((h) => `${p.label} :: option :: ${h}`));
      }
    }
    expect(violations).toEqual([]);
  });

  it("no hex literals in normal-mode visible text (both builders)", async () => {
    const all = await pages();
    const violations: string[] = [];
    for (const p of all) {
      violations.push(...hexHits(p.visible).map((h) => `${p.label} :: visible-text :: ${h}`));
    }
    expect(violations).toEqual([]);
  });

  it("no hex literals in operator-facing attributes (title / aria-label / placeholder / alt)", async () => {
    const all = await pages();
    const violations: string[] = [];
    for (const p of all) {
      for (const a of p.attrs) {
        violations.push(...hexHits(a.value).map((h) => `${p.label} :: attr:${a.attr} :: ${h}`));
      }
    }
    expect(violations).toEqual([]);
  });

  it("no hex literals in island-emitted UI strings (CSS-rule literals + the documented CONTEXT-SCOPED allowlist exempt)", async () => {
    const all = await pages();
    const violations: string[] = [];
    for (const p of all) {
      for (const lit of p.literals) {
        if (!HEX_RE.test(lit.text)) {
          HEX_RE.lastIndex = 0;
          continue;
        }
        HEX_RE.lastIndex = 0;
        if (isCssRuleLiteral(lit.text)) continue; // style injection, not copy (braced CSS rule)
        // m1 (adversarial review): shape alone is not enough — the bare
        // declaration-list exemption is now ALSO usage-context gated (the
        // literal must actually flow to a style sink in its real source).
        if (isStyleSinkDeclarationList(lit, p.islands[lit.island] ?? "")) continue;
        // DEV-66c: the allowlist is value + ORIGINATING-CONTEXT scoped — the
        // toast hexes pass only at their showToast assignment site.
        if (isAllowedIslandHex(lit, p.islands[lit.island] ?? "")) continue;
        violations.push(`${p.label} :: island-literal :: '${lit.text.slice(0, 90)}'`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("DEV-66c: the toast-hex exemption is context-scoped — the SAME hex outside its showToast assignment site is a violation", async () => {
    // positive probe: the literal at its REAL originating site is exempt
    const toastSrc = "function showToast(m){var toast=document.createElement('div');toast.style.background = '#10b981';}";
    const toastLit = stringLiterals([toastSrc]).find((l) => l.text === "#10b981")!;
    expect(toastLit, "probe extracted the toast literal").toBeTruthy();
    expect(isAllowedIslandHex(toastLit, toastSrc)).toBe(true);

    // counter-probes: the SAME value with NO toast context — a plain variable,
    // an option label, a different style property — is NOT exempt.
    for (const src of [
      "var accent = '#10b981';",
      "opt.textContent = '#10b981';",
      "el.style.color = '#10b981';",
    ]) {
      const lit = stringLiterals([src]).find((l) => l.text === "#10b981")!;
      expect(lit, `counter-probe extracted from ${src}`).toBeTruthy();
      expect(isAllowedIslandHex(lit, src), `NOT exempt in: ${src}`).toBe(false);
    }

    // …and on the LIVE pages every occurrence of the 4 toast hexes sits at the
    // showToast assignment site (the exemption never fires anywhere else).
    const all = await pages();
    let liveToastSites = 0;
    for (const p of all) {
      for (const lit of p.literals) {
        if (!/^#(?:10b981|ef4444|f59e0b|3b82f6)$/.test(lit.text)) continue;
        liveToastSites += 1;
        const src = p.islands[lit.island] ?? "";
        expect(
          /toast\.style\.background\s*=\s*$/.test(src.slice(0, lit.index)),
          `${p.label}: '${lit.text}' rides its showToast assignment site`,
        ).toBe(true);
      }
    }
    expect(liveToastSites, "the admin-shell toast hexes are actually present (probe grounded)").toBeGreaterThan(0);
  });

  it("v3.1 §6.2/§7: a bare CSS declaration-list (no braces) is style injection, not copy — but real prose with a colon is NOT exempted", () => {
    // positive: the golden's own seg()/fieldBoxStyle()/… idiom — a bare
    // "prop:value;prop:value;…" string with no wrapping selector/braces.
    expect(
      isCssDeclarationListLiteral(
        "padding:5px 11px;font-size:12px;font-weight:700;color:#1B3A5C;background:#fff;border-radius:6px;cursor:pointer;white-space:nowrap",
      ),
    ).toBe(true);
    expect(isCssDeclarationListLiteral("width:38px;height:22px;border-radius:20px;background:#1B3A5C")).toBe(true);
    // a lone declaration (no semicolon) still requires 2+ parts to count —
    // guards against a coincidental single "word:word".
    expect(isCssDeclarationListLiteral("color:#1B3A5C")).toBe(false);
    // negative: real operator-facing sentences that happen to contain a
    // colon must NEVER be swallowed by this exemption — the KEY-shaped
    // require (letters/hyphens only, no space) is what protects this.
    expect(isCssDeclarationListLiteral("Brand color: #1a2b3c is now active")).toBe(false);
    expect(isCssDeclarationListLiteral("See docs: https://example.com; Note: uses #ff0000")).toBe(false);
    expect(isCssDeclarationListLiteral("Custom colors must be a color value like #1a2b3c.")).toBe(false);
  });

  it("m1 (adversarial review): the declaration-list exemption is usage-context gated — shape alone is not enough", () => {
    // positive: a real DIRECT style-sink usage (.style.cssText =).
    const directSrc =
      "outline.style.cssText = 'position:absolute;left:-6px;right:-6px;top:-6px;height:66px;border:2px solid #1B3A5C;border-radius:12px;pointer-events:none';";
    const directLit = stringLiterals([directSrc]).find((l) => l.text.includes("#1B3A5C"))!;
    expect(directLit, "probe extracted the direct-cssText literal").toBeTruthy();
    expect(isStyleSinkDeclarationList(directLit, directSrc)).toBe(true);

    // positive: this codebase's own multi-part concatenation idiom
    // (buildHandle's real shape) — the literal sits behind a `css +=`, several
    // characters before the EVENTUAL el.setAttribute('style', css) sink call.
    const concatSrc =
      "var css = 'position:absolute;top:' + top + 'px;'; " +
      "if (interactive) { css += 'background:#1B3A5C;border:2px solid #1B3A5C;cursor:ew-resize;pointer-events:auto'; } " +
      "el.setAttribute('style', css);";
    const concatLit = stringLiterals([concatSrc]).find((l) => l.text.indexOf("background:#1B3A5C") === 0)!;
    expect(concatLit, "probe extracted the css+= literal").toBeTruthy();
    expect(isStyleSinkDeclarationList(concatLit, concatSrc)).toBe(true);

    // positive: a ternary-branched cssText assignment — BOTH branches
    // recognized (the sink pattern is searched anywhere in the enclosing
    // statement, not only immediately before the literal).
    const ternarySrc =
      "outline.style.cssText = kind === 'continue' ? 'background:#1B3A5C;color:#fff' : 'background:#fff;color:#1B3A5C';";
    const ternaryLits = stringLiterals([ternarySrc]).filter((l) => l.text.indexOf("#1B3A5C") !== -1);
    expect(ternaryLits.length, "both ternary branches extracted").toBe(2);
    for (const l of ternaryLits) {
      expect(isStyleSinkDeclarationList(l, ternarySrc), `branch '${l.text}' recognized`).toBe(true);
    }

    // negative: shape rejects it outright — "Color"/"Size" are never real
    // (lowercase) CSS property names, even wrapped in a style-sink-shaped
    // assignment.
    const fakeStyleSrc = "el.style.cssText = 'Color: #1B3A5C; Size: M';";
    const fakeLit = stringLiterals([fakeStyleSrc]).find((l) => l.text.includes("#1B3A5C"))!;
    expect(fakeLit, "probe extracted the fake literal").toBeTruthy();
    expect(isCssDeclarationListLiteral(fakeLit.text), "shape alone already rejects capitalized keys").toBe(false);
    expect(isStyleSinkDeclarationList(fakeLit, fakeStyleSrc), "NOT exempted even inside a real style-sink assignment").toBe(
      false,
    );

    // negative: correctly-SHAPED (lowercase) declaration list with NO
    // style-sink usage anywhere nearby — proves the context gate does real
    // work, not just theater alongside an already-sufficient shape gate.
    const noSinkSrc = "var debugLabel = 'color:#1B3A5C;background:#fff'; console.log(debugLabel);";
    const noSinkLit = stringLiterals([noSinkSrc]).find((l) => l.text.includes("#1B3A5C"))!;
    expect(noSinkLit, "probe extracted the no-sink literal").toBeTruthy();
    expect(isCssDeclarationListLiteral(noSinkLit.text), "shape alone WOULD pass").toBe(true);
    expect(isStyleSinkDeclarationList(noSinkLit, noSinkSrc), "context gate rejects a non-style-sink variable").toBe(false);

    // positive: the golden's OWN "returns a style string" helper idiom
    // (segStyle/vpSegStyle's real shape) — BOTH ternary branches recognized,
    // even though the actual .setAttribute('style', …) sink call happens in
    // a DIFFERENT function entirely, far from either literal.
    const returnHelperSrc =
      "function segStyle(active) { return active ? 'padding:5px;color:#1B3A5C' : 'padding:5px;color:#6B7486'; } " +
      "function apply(el, on) { el.setAttribute('style', segStyle(on)); }";
    const returnLits = stringLiterals([returnHelperSrc]).filter((l) => /^padding:5px;color:#/.test(l.text));
    expect(returnLits.length, "both segStyle-shaped branches extracted").toBe(2);
    for (const l of returnLits) {
      expect(isStyleSinkDeclarationList(l, returnHelperSrc), `helper branch '${l.text}' recognized`).toBe(true);
    }
    // negative: shape rejects a capitalized-key "return" literal too — being
    // inside a return statement is necessary but not sufficient; it still
    // has to look like real CSS.
    const returnFakeSrc = "function label() { return 'Type: FreeTextQuestion; Field: zip'; }";
    const returnFakeLit = stringLiterals([returnFakeSrc])[0]!;
    expect(returnFakeLit, "probe extracted the fake return literal").toBeTruthy();
    expect(isStyleSinkDeclarationList(returnFakeLit, returnFakeSrc), "shape rejects it even inside a return").toBe(false);

    // positive: a BARE hex value assigned directly to a style PROPERTY (not
    // cssText) — the non-destructive "change just one property" idiom
    // updateMappingBadge uses. Both ternary branches recognized.
    const barePropSrc = "badge.style.color = complete ? '#0E7C3A' : '#5A6470';";
    const barePropLits = stringLiterals([barePropSrc]);
    expect(barePropLits.length, "both bare-hex branches extracted").toBe(2);
    for (const l of barePropLits) {
      expect(isStyleSinkDeclarationList(l, barePropSrc), `bare-hex branch '${l.text}' recognized`).toBe(true);
    }
    // negative: the SAME bare hex value, assigned to a plain variable — never
    // exempted just because it happens to look like a hex color.
    const barePropNoSinkSrc = "var accent = '#0E7C3A';";
    const barePropNoSinkLit = stringLiterals([barePropNoSinkSrc])[0]!;
    expect(barePropNoSinkLit, "probe extracted the plain-variable literal").toBeTruthy();
    expect(isStyleSinkDeclarationList(barePropNoSinkLit, barePropNoSinkSrc), "NOT exempted outside a .style.* sink").toBe(
      false,
    );
  });
});
