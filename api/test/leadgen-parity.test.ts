// LeadGen Phase 5 — PREVIEW ↔ RUNTIME rendering parity (fix-contract v2.4 09
// §9.3 / §9.5, issue T1). Three test blocks, each proving one leg of the
// "the admin preview and the live /lg runtime MUST use the same rendering code
// path" contract, with assertions that execute REAL behaviour (no toContain-
// only theatre for the parity claims):
//
//   1. §9.5 shared-renderer STATIC invariant — the preview modules
//      (sections-handlers.ts + preview-sim.ts) define NO component markup of
//      their own; the sole authority for a Section-component root is the
//      shared renderer in components/presets.ts. Asserted at the source level.
//
//   2. §9.3 parity MATRIX — for every catalog component type AND every
//      container type × the default design, the live-path render
//      (renderSectionComponents([node], design) — exactly what serve.ts:382
//      embeds in the /lg shell) is compared against the preview-path render
//      (previewSectionHandler through the in-process admin.request harness).
//      BOTH sides are PARSED into a DOM tree; the [data-component-type]
//      subtree is compared for deep structural + attribute + class + inline-
//      design-token + data-lg-* hydration equality. Includes a nested-
//      container cell (Stack ⊃ CardPanel ⊃ ButtonAnswerGroup) proving
//      recursion parity.
//
//   3. §9.3 dependency-operator parity TABLE — generated cases for all 9 ops
//      (eq/neq/gt/lt/gte/lte/range/in/not_in) × representative edges run
//      through BOTH the server evaluator (leadgen/dependencies.ts
//      evaluateDependencies, op-truth = payload.ts conditionalMet) AND the
//      client evaluator (public/leadgen/runtime/dependencies.ts
//      evaluateComponents). The visible/hidden decision must match cell-for-
//      cell; each case also pins the expected decision, so two identically-
//      buggy evaluators cannot pass.
//
// NORMALIZATION (matrix, block 2): the ONLY thing stripped is the preview's
// ancestor CHROME above the component root — the viewport frame
// `div.lg-preview[data-funnel-design][data-viewport][style=max-width…]` and the
// content container `div.lg-content` emitted by previewSectionHandler.wrap().
// Neither carries data-component-type; both mirror the live /lg shell's own
// `<section data-lg-section>` + `<main class="lg-content" data-lg-mount>`
// chrome (serve.ts) — they are the preview iframe frame, NOT component markup.
// The comparison ANCHORS on the first [data-component-type] element on each
// side (presets.ts's hydration() is the sole emitter of that marker), so
// everything ancestral to it is chrome by construction and NOTHING inside the
// component subtree is touched, normalized, or stripped.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { COMPONENT_CATALOG } from "../src/public/leadgen/components/registry";
import type { ComponentType } from "../src/public/leadgen/components/registry";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";
import { renderSectionComponents } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { evaluateDependencies } from "../src/leadgen/dependencies";
import { evaluateComponents } from "../src/public/leadgen/runtime/dependencies";
import type { LgComponentConfig } from "../src/public/leadgen/runtime/state";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SRC = (rel: string): string => readFileSync(join(TEST_DIR, "../src", rel), "utf8");
const DESIGN = defaultFunnelDesign;
const API = "/api/admin/leadgen";

// ===========================================================================
// 1. §9.5 shared-renderer STATIC invariant
// ===========================================================================
//
// EXACT INVARIANT ASSERTED: the admin preview path emits Section-component
// markup ONLY through components/presets.ts. Concretely —
//   (a) sections-handlers.ts IMPORTS the shared renderer
//       (renderSectionComponents / renderSectionComponentsVisible) from
//       "../../public/leadgen/components/presets" and calls it;
//   (b) NEITHER preview module authors a component root of its own — the
//       marker `data-component-type` (emitted solely by presets.ts hydration())
//       appears in NEITHER sections-handlers.ts NOR preview-sim.ts;
//   (c) preview-sim.ts does NOT import the renderer at all — it is a pure
//       post-render string transform over the presets output handed to it;
//   (d) CONTROL: presets.ts IS the sole authority for `data-component-type`
//       (so (b)'s absence is a meaningful discriminator, not vacuous).

describe("§9.5 shared-renderer invariant — preview defines no component markup", () => {
  const handlers = SRC("admin/leadgen/sections-handlers.ts");
  const previewSim = SRC("admin/leadgen/preview-sim.ts");
  const presets = SRC("public/leadgen/components/presets.ts");
  const PRESETS_IMPORT = '"../../public/leadgen/components/presets"';
  const COMPONENT_ROOT_MARKER = "data-component-type";

  it("(a) sections-handlers.ts imports + calls the shared renderer from presets.ts", () => {
    expect(handlers).toContain(PRESETS_IMPORT);
    expect(handlers).toContain("renderSectionComponents");
    expect(handlers).toContain("renderSectionComponentsVisible");
  });

  it("(b) neither preview module authors a component root (no data-component-type literal)", () => {
    expect(handlers.includes(COMPONENT_ROOT_MARKER), "sections-handlers.ts").toBe(false);
    expect(previewSim.includes(COMPONENT_ROOT_MARKER), "preview-sim.ts").toBe(false);
  });

  it("(c) preview-sim.ts imports NO renderer — it only post-transforms presets output", () => {
    expect(previewSim.includes(PRESETS_IMPORT), "preview-sim.ts must not import presets").toBe(false);
  });

  it("(d) CONTROL: presets.ts is the sole authority for the data-component-type marker", () => {
    expect(presets.includes(COMPONENT_ROOT_MARKER)).toBe(true);
  });
});

// ===========================================================================
// Minimal exact HTML parser for presets.ts machine-generated markup.
// ---------------------------------------------------------------------------
// Rationale (mirrors preview-sim.ts's documented choice): presets output is
// FULLY machine-generated — every attribute is double-quoted and every author
// value is escapeHtml-escaped, so `<` / `>` never appear raw inside text or
// attribute values; they are STRUCTURAL. A balanced-tag scan is therefore
// EXACT, not heuristic. (No DOM library ships in the api workspace — env is
// "node" — so a tiny in-file parser is the strongest feasible parse route.)
// ===========================================================================

const VOID_TAGS = new Set([
  "input", "img", "br", "hr", "meta", "link", "source", "wbr",
  "area", "base", "col", "embed", "param", "track",
]);

interface El {
  tag: string; // lowercased
  attrs: Record<string, string>; // name -> value ("" for bare attrs)
  children: DomNode[];
}
type Text = { text: string };
type DomNode = El | Text;

function isEl(n: DomNode): n is El {
  return (n as El).tag !== undefined;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g)) {
    if (m[1] === undefined || m[1] === "") continue;
    attrs[m[1].toLowerCase()] = m[2] ?? "";
  }
  return attrs;
}

// Parse an HTML fragment into a synthetic #fragment root. Void elements
// (never self-closed by presets — `<input …>` not `<input …/>`) are leaves.
function parseFragment(html: string): El {
  const root: El = { tag: "#fragment", attrs: {}, children: [] };
  const stack: El[] = [root];
  let last = 0;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g)) {
    const idx = m.index ?? 0;
    const between = html.slice(last, idx);
    if (between.length > 0) stack[stack.length - 1]!.children.push({ text: between });
    last = idx + m[0].length;
    const isClose = m[1] === "/";
    const name = (m[2] ?? "").toLowerCase();
    if (isClose) {
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i]!.tag === name) {
          stack.length = i;
          break;
        }
      }
    } else {
      const el: El = { tag: name, attrs: parseAttrs(m[3] ?? ""), children: [] };
      stack[stack.length - 1]!.children.push(el);
      if (!VOID_TAGS.has(name)) stack.push(el);
    }
  }
  const tail = html.slice(last);
  if (tail.length > 0) root.children.push({ text: tail });
  return root;
}

// The first element (DFS, document order) carrying data-component-type — the
// component ROOT. Everything ancestral is preview/shell chrome by construction.
function findComponentRoot(el: El): El | null {
  if (el.attrs["data-component-type"] !== undefined) return el;
  for (const ch of el.children) {
    if (isEl(ch)) {
      const r = findComponentRoot(ch);
      if (r !== null) return r;
    }
  }
  return null;
}

function normClassSet(v: string | undefined): string {
  return (v ?? "").split(/\s+/).filter(Boolean).sort().join(" ");
}

// Meaningful children = element children + non-whitespace text. Presets emit
// no incidental whitespace between tags; the trim-filter is applied IDENTICALLY
// to both sides so meaningful content stays exactly compared.
function meaningfulChildren(el: El): DomNode[] {
  return el.children.filter((n) => (isEl(n) ? true : n.text.trim() !== ""));
}

// Deep structural + attribute + class + text equality of two parsed subtrees.
// Covers, in one pass: DOM structure (tag + ordered children tree), CSS classes
// (class attr, order-insensitive), design tokens (inline style attr), and
// data-lg-* hydration attributes (all attrs are compared).
function assertNodeEqual(a: DomNode, b: DomNode, path: string): void {
  expect(isEl(b), `${path}: node kind (element vs text)`).toBe(isEl(a));
  if (!isEl(a) || !isEl(b)) {
    expect((b as Text).text, `${path}: text`).toBe((a as Text).text);
    return;
  }
  expect(b.tag, `${path}: tag name`).toBe(a.tag);
  const aKeys = Object.keys(a.attrs).sort();
  const bKeys = Object.keys(b.attrs).sort();
  expect(bKeys, `${path}: attribute names`).toEqual(aKeys);
  for (const k of aKeys) {
    if (k === "class") {
      expect(normClassSet(b.attrs[k]), `${path}: @class`).toBe(normClassSet(a.attrs[k]));
    } else {
      expect(b.attrs[k], `${path}: @${k}`).toBe(a.attrs[k]);
    }
  }
  const ac = meaningfulChildren(a);
  const bc = meaningfulChildren(b);
  expect(bc.length, `${path}: child count`).toBe(ac.length);
  for (let i = 0; i < ac.length; i++) {
    const label = isEl(ac[i]!) ? (ac[i] as El).tag : "#text";
    assertNodeEqual(ac[i]!, bc[i]!, `${path} > ${label}[${i}]`);
  }
}

// Facet extractors (document order) — each derived from the SAME parsed tree so
// the four §9.3 equality bullets are individually legible + independently
// asserted (on top of the deep assertNodeEqual master check).
function collectComponentTypes(el: El, out: string[] = []): string[] {
  const t = el.attrs["data-component-type"];
  if (t !== undefined) out.push(t);
  for (const ch of el.children) if (isEl(ch)) collectComponentTypes(ch, out);
  return out;
}
function collectClasses(el: El, out: string[] = []): string[] {
  const c = el.attrs["class"];
  if (c !== undefined) out.push(normClassSet(c));
  for (const ch of el.children) if (isEl(ch)) collectClasses(ch, out);
  return out;
}
function collectDataLg(el: El, out: string[] = []): string[] {
  for (const k of Object.keys(el.attrs).sort()) {
    if (k.startsWith("data-lg-")) out.push(`${k}=${el.attrs[k]}`);
  }
  for (const ch of el.children) if (isEl(ch)) collectDataLg(ch, out);
  return out;
}
function collectStyles(el: El, out: string[] = []): string[] {
  const s = el.attrs["style"];
  if (s !== undefined) out.push(s);
  for (const ch of el.children) if (isEl(ch)) collectStyles(ch, out);
  return out;
}

// ===========================================================================
// node:sqlite → D1 harness (the leadgen-sections-api.test.ts idiom). The
// preview endpoint is a PURE render (no persist), but admin.request needs a
// real env; DEV_BYPASS_AUTH short-circuits the accessAuth gate.
// ===========================================================================

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    const mod = nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
    return mod.DatabaseSync;
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
      const results: unknown[] = [];
      try {
        for (const s of statements) results.push(await s.run());
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return results;
    },
  } as unknown as D1Database;
  return db;
}

const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
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
  };
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;
const ENV: Env | null = DatabaseSync === null ? null : buildEnv(d1FromSqlite(createLeadgenDb(DatabaseSync)));

// ===========================================================================
// 2. §9.3 parity MATRIX — fixtures (a minimal-valid node per catalog type,
// mirroring the NODE_SPECS shape in leadgen-components-render.test.ts). The
// matrix is DRIVEN off Object.keys(COMPONENT_CATALOG), so a newly-added type
// auto-enters the matrix; the lockstep guard fails if NODE_SPECS drifts.
// ===========================================================================

const CHOICES = [
  { label: "Sole Proprietor", value: "sole_prop", analytics_id: "biz_sole" },
  { label: "Partnership", value: "partnership", analytics_id: "biz_partner" },
];
const ICON_CHOICES = CHOICES.map((c) => ({ ...c, icon: "🏢" }));
const IMAGE_CHOICES = CHOICES.map((c) => ({ ...c, imageMediaId: "media_123" }));

const NODE_SPECS: Record<ComponentType, LeadgenComponentNode> = {
  ProgressBar: { type: "ProgressBar", question_id: "q", props: { mode: "percent", percent: 50 } },
  HeaderLogo: { type: "HeaderLogo", question_id: "q", props: { logoMediaId: "m1", siteName: "Acme", accent: "Quotes" } },
  BackButton: { type: "BackButton", question_id: "q", props: { label: "Back" } },
  DisclosureLink: { type: "DisclosureLink", question_id: "q", props: { panelHtml: "Legal blurb" } },
  StepIndicator: { type: "StepIndicator", question_id: "q", props: { steps: 4, current: 2 } },
  CategoryLabel: { type: "CategoryLabel", question_id: "q", props: { text: "BUSINESS LOAN" } },
  QuestionHeadline: { type: "QuestionHeadline", question_id: "q", props: { text: "How much?" } },
  Subheadline: { type: "Subheadline", question_id: "q", props: { text: "Why we ask" } },
  RangeQuestion: { type: "RangeQuestion", question_id: "q", internal_field: "amt", props: { min: 0, max: 100, default: 50 } },
  CurrencyRangeQuestion: { type: "CurrencyRangeQuestion", question_id: "q", internal_field: "loan", props: { min: 10000, max: 1000000, default: 330000, currency: "$" } },
  NumberRangeQuestion: { type: "NumberRangeQuestion", question_id: "q", internal_field: "count", props: { min: 1, max: 9, default: 3 } },
  ButtonAnswerGroup: { type: "ButtonAnswerGroup", question_id: "q", internal_field: "pick", choices: CHOICES },
  TwoButtonYesNo: { type: "TwoButtonYesNo", question_id: "q", internal_field: "insured", props: { auto_advance: true } },
  IconCardAnswerGrid: { type: "IconCardAnswerGrid", question_id: "q", internal_field: "biz", choices: ICON_CHOICES, props: { columns: 3 } },
  ImageCardAnswerGrid: { type: "ImageCardAnswerGrid", question_id: "q", internal_field: "carrier", choices: IMAGE_CHOICES, props: { columns: 4 } },
  MultiChoiceCardGroup: { type: "MultiChoiceCardGroup", question_id: "q", internal_field: "features", choices: CHOICES, props: { min: 1, max: 2 } },
  DropdownQuestion: { type: "DropdownQuestion", question_id: "q", internal_field: "insurer", choices: CHOICES, props: { placeholder: "Pick one" } },
  SearchableDropdownQuestion: { type: "SearchableDropdownQuestion", question_id: "q", internal_field: "make", choices: CHOICES, props: { placeholder: "Pick one" } },
  OtherGroupSelector: { type: "OtherGroupSelector", question_id: "q", internal_field: "carrier", choices: CHOICES, choiceDisplay: { mainValues: ["sole_prop"], otherGroupEnabled: true, otherGroupLabel: "Other", searchableOther: false } },
  FreeTextQuestion: { type: "FreeTextQuestion", question_id: "q", internal_field: "note", props: { placeholder: "Type…", maxLen: 100 } },
  NumberInputQuestion: { type: "NumberInputQuestion", question_id: "q", internal_field: "age", props: { min: 18, max: 99, step: 1, placeholder: "Your age" } },
  CurrencyInputQuestion: { type: "CurrencyInputQuestion", question_id: "q", internal_field: "income", props: { currency: "$", min: 0, max: 1000000, placeholder: "Annual income" } },
  EmailInputQuestion: { type: "EmailInputQuestion", question_id: "q", internal_field: "email", required: true },
  PhoneInputQuestion: { type: "PhoneInputQuestion", question_id: "q", internal_field: "phone" },
  NameFieldsGroup: { type: "NameFieldsGroup", question_id: "q", required: true },
  DateQuestion: { type: "DateQuestion", question_id: "q", internal_field: "dob", props: { min: "1900-01-01" } },
  ZIPInputQuestion: { type: "ZIPInputQuestion", question_id: "q", internal_field: "zip", props: { validate: true } },
  AddressAutocompleteQuestion: { type: "AddressAutocompleteQuestion", question_id: "q", props: { provider: "google" } },
  ContinueButton: { type: "ContinueButton", question_id: "q", props: { label: "Continue", loadingLabel: "Loading…" } },
  AutoAdvanceButton: { type: "AutoAdvanceButton", question_id: "q", props: { label: "Next" } },
  ReassuranceBadge: { type: "ReassuranceBadge", question_id: "q", props: { text: "Get your offers in 2 minutes or less." } },
  SuccessState: { type: "SuccessState", question_id: "q", props: { heading: "All set", message: "We found offers for you.", icon: "✓" } },
  SecureFormBadge: { type: "SecureFormBadge", question_id: "q", props: { text: "256-bit SSL encrypted" } },
  TrustBar: { type: "TrustBar", question_id: "q", props: { items: [{ icon: "🔒", text: "SSL secured" }, { icon: "★", text: "4.8 rating" }], layout: "horizontal" } },
  LogoStrip: { type: "LogoStrip", question_id: "q", props: { logos: [{ mediaId: "media_1", alt: "Acme" }, { mediaId: "media_2", alt: "Globex" }] } },
  HelperText: { type: "HelperText", question_id: "q", props: { text: "We never share this." } },
  ValidationError: { type: "ValidationError", question_id: "q", props: { text: "Required" } },
  LegalNote: { type: "LegalNote", question_id: "q", props: { html: "Terms apply" } },
  Stack: {
    type: "Stack", question_id: "q", props: { direction: "vertical", gap: "m", align: "stretch" },
    children: [{ type: "FreeTextQuestion", question_id: "q_in_stack", internal_field: "stack_note", props: { placeholder: "Type…" } }],
  },
  GridContainer: {
    type: "GridContainer", question_id: "q", props: { columnsDesktop: 3, columnsTablet: 2, columnsMobile: 1, gap: "s", sizing: "equal" },
    children: [{ type: "FreeTextQuestion", question_id: "q_in_grid", internal_field: "grid_note" }],
  },
  Columns: {
    type: "Columns", question_id: "q", props: { ratio: "60/40", mobile: "stack" },
    children: [{ type: "FreeTextQuestion", question_id: "q_in_columns", internal_field: "columns_note" }],
  },
  CardPanel: {
    type: "CardPanel", question_id: "q", props: { width: "m", background: "card", shadow: "md", radius: "lg", padding: "m" },
    children: [{ type: "FreeTextQuestion", question_id: "q_in_panel", internal_field: "panel_note" }],
  },
  BackgroundPanel: {
    type: "BackgroundPanel", question_id: "q", props: { gradient: "primary" },
    children: [{ type: "FreeTextQuestion", question_id: "q_in_bg", internal_field: "bg_note" }],
  },
  Spacer: { type: "Spacer", question_id: "q", props: { size: "l" } },
  HeaderBar: { type: "HeaderBar", question_id: "q", props: { logoMediaId: "media_logo", logoAlt: "Acme", back: true, secure: true, cta: { label: "Call now", tel: "+1 800 555 1212" } } },
  FooterBar: { type: "FooterBar", question_id: "q", props: { legalHtml: "Terms apply", trustMessages: ["SSL secured"], links: [{ label: "Privacy", href: "/privacy" }] } },
};

const ALL_TYPES = Object.keys(COMPONENT_CATALOG) as ComponentType[];

// The live-path render — EXACTLY the call serve.ts:382 embeds in the /lg shell.
function liveSubtree(node: LeadgenComponentNode): El {
  const root = findComponentRoot(parseFragment(renderSectionComponents([node], DESIGN)));
  expect(root, `live [data-component-type] root for ${node.type}`).not.toBeNull();
  return root!;
}

// The preview-path render — through previewSectionHandler via admin.request;
// the preview.html for the requested viewport is parsed and its component
// subtree extracted. §9.3: the component markup is viewport-INVARIANT (only the
// preview iframe FRAME above the component root carries the viewport — chrome
// stripped by findComponentRoot), so BOTH viewports must match the one live
// render.
async function previewSubtree(
  node: LeadgenComponentNode,
  viewport: "desktop" | "mobile" = "desktop",
): Promise<El> {
  const res = await admin.request(
    `${API}/sections/preview`,
    jsonInit("POST", { content_json: JSON.stringify({ components: [node] }), viewport }),
    ENV!,
  );
  expect(res.status, `preview status for ${node.type} (${viewport})`).toBe(200);
  const body = (await res.json()) as { preview: { html: string; design_id: string } };
  // design_id echo proves the preview resolved the SAME default design the live
  // path uses (getFunnelDesign(null) === defaultFunnelDesign), so token
  // application is comparable.
  expect(body.preview.design_id, `preview design echo for ${node.type} (${viewport})`).toBe(DESIGN.id);
  const root = findComponentRoot(parseFragment(body.preview.html));
  expect(root, `preview [data-component-type] root for ${node.type} (${viewport})`).not.toBeNull();
  return root!;
}

describeDb("§9.3 parity matrix — every catalog type × default design (desktop)", () => {
  it("NODE_SPECS covers every catalog component + container type (lockstep guard)", () => {
    expect(Object.keys(NODE_SPECS).sort()).toEqual([...ALL_TYPES].sort());
    // every container type is represented in the matrix (part of ALL_TYPES).
    for (const t of ["Stack", "GridContainer", "Columns", "CardPanel", "BackgroundPanel"] as const) {
      expect(ALL_TYPES).toContain(t);
    }
  });

  it("every fixture node is minimal-valid (validateSectionContent accepts it)", () => {
    for (const t of ALL_TYPES) {
      expect(validateSectionContent({ components: [NODE_SPECS[t]] }).errors, t).toEqual([]);
    }
  });

  for (const type of ALL_TYPES) {
    it(`${type}: preview subtree ≡ live renderSectionComponents subtree`, async () => {
      const node = NODE_SPECS[type];
      const [live, preview] = [liveSubtree(node), await previewSubtree(node)];

      // MASTER: deep DOM structure + attributes + classes + inline tokens + text.
      assertNodeEqual(live, preview, type);

      // §9.3 bullets, each independently legible (derived from the SAME trees):
      const liveTypes = collectComponentTypes(live);
      expect(collectComponentTypes(preview), `${type}: component types present`).toEqual(liveTypes);
      expect(liveTypes, `${type}: anchoring component type present`).toContain(type);
      expect(collectClasses(preview), `${type}: DOM CSS classes`).toEqual(collectClasses(live));
      expect(collectDataLg(preview), `${type}: data-lg-* hydration attrs (03 §3.3)`).toEqual(collectDataLg(live));
      expect(collectStyles(preview), `${type}: design-token inline styles`).toEqual(collectStyles(live));
    });
  }

  it("nested containers: Stack ⊃ CardPanel ⊃ ButtonAnswerGroup recursion parity", async () => {
    const node: LeadgenComponentNode = {
      type: "Stack",
      question_id: "st",
      props: { direction: "vertical", gap: "m", align: "stretch" },
      children: [
        {
          type: "CardPanel",
          question_id: "cp",
          props: { width: "m", background: "card", shadow: "md", radius: "lg", padding: "m" },
          children: [{ type: "ButtonAnswerGroup", question_id: "bag", internal_field: "pick", choices: CHOICES }],
        },
      ],
    };
    expect(validateSectionContent({ components: [node] }).errors, "nested fixture valid").toEqual([]);

    const [live, preview] = [liveSubtree(node), await previewSubtree(node)];
    assertNodeEqual(live, preview, "nested");

    // recursion parity: all three component roots present, in depth-first order.
    expect(collectComponentTypes(live)).toEqual(["Stack", "CardPanel", "ButtonAnswerGroup"]);
    expect(collectComponentTypes(preview)).toEqual(["Stack", "CardPanel", "ButtonAnswerGroup"]);
    // the deeply-nested choice hydration hooks survive recursion identically.
    expect(collectDataLg(preview)).toEqual(collectDataLg(live));
    expect(collectDataLg(live)).toContain("data-lg-choice=sole_prop");
  });

  // Design-token application spot checks (grounded in the REAL design object,
  // not magic strings) — proves the style facet is non-vacuous AND identical.
  it("design tokens are applied identically (range fill, icon grid, badge)", async () => {
    const range = { node: NODE_SPECS.CurrencyRangeQuestion, token: DESIGN.rangeQuestion.filledTrackColor };
    const icon = { node: NODE_SPECS.IconCardAnswerGrid, token: DESIGN.iconCard.iconColor };
    const badge = { node: NODE_SPECS.ReassuranceBadge, token: DESIGN.reassuranceBadge.background };
    for (const { node, token } of [range, icon, badge]) {
      const [live, preview] = [liveSubtree(node), await previewSubtree(node)];
      const liveStyles = collectStyles(live).join(" | ");
      expect(liveStyles, `${node.type}: token ${token} present on live`).toContain(token);
      expect(collectStyles(preview).join(" | "), `${node.type}: token parity`).toBe(liveStyles);
    }
    // class-hook token: the icon grid's column count rides --lg-cols:3 (fixture).
    const iconLive = collectStyles(liveSubtree(NODE_SPECS.IconCardAnswerGrid)).join(" | ");
    expect(iconLive).toContain("--lg-cols:3");
  });
});

// The §9.3 "× desktop/mobile" matrix cell (literal contract close): the
// server-rendered component subtree is VIEWPORT-INVARIANT — the viewport only
// sizes the preview iframe FRAME (chrome above the component root, stripped by
// findComponentRoot), never the component markup. So the MOBILE preview subtree
// must equal the SAME single live renderSectionComponents([node], design)
// subtree the desktop cell already pins. Reuses the desktop cell's
// normalization + subtree-extraction helpers verbatim.
describeDb("§9.3 parity matrix — every catalog type × default design (mobile)", () => {
  for (const type of ALL_TYPES) {
    it(`${type}: mobile preview subtree ≡ live renderSectionComponents subtree`, async () => {
      const node = NODE_SPECS[type];
      const [live, preview] = [liveSubtree(node), await previewSubtree(node, "mobile")];

      // MASTER: deep DOM structure + attributes + classes + inline tokens + text.
      assertNodeEqual(live, preview, `${type} (mobile)`);

      // §9.3 bullets, each independently legible (derived from the SAME trees):
      const liveTypes = collectComponentTypes(live);
      expect(collectComponentTypes(preview), `${type}: component types present (mobile)`).toEqual(liveTypes);
      expect(liveTypes, `${type}: anchoring component type present (mobile)`).toContain(type);
      expect(collectClasses(preview), `${type}: DOM CSS classes (mobile)`).toEqual(collectClasses(live));
      expect(collectDataLg(preview), `${type}: data-lg-* hydration attrs (mobile)`).toEqual(collectDataLg(live));
      expect(collectStyles(preview), `${type}: design-token inline styles (mobile)`).toEqual(collectStyles(live));
    });
  }

  it("nested containers: Stack ⊃ CardPanel ⊃ ButtonAnswerGroup recursion parity (mobile)", async () => {
    const node: LeadgenComponentNode = {
      type: "Stack",
      question_id: "st",
      props: { direction: "vertical", gap: "m", align: "stretch" },
      children: [
        {
          type: "CardPanel",
          question_id: "cp",
          props: { width: "m", background: "card", shadow: "md", radius: "lg", padding: "m" },
          children: [{ type: "ButtonAnswerGroup", question_id: "bag", internal_field: "pick", choices: CHOICES }],
        },
      ],
    };
    expect(validateSectionContent({ components: [node] }).errors, "nested fixture valid").toEqual([]);

    const [live, preview] = [liveSubtree(node), await previewSubtree(node, "mobile")];
    assertNodeEqual(live, preview, "nested (mobile)");

    // recursion parity: all three component roots present, in depth-first order.
    expect(collectComponentTypes(preview)).toEqual(["Stack", "CardPanel", "ButtonAnswerGroup"]);
    // the deeply-nested choice hydration hooks survive recursion identically.
    expect(collectDataLg(preview)).toEqual(collectDataLg(live));
    expect(collectDataLg(live)).toContain("data-lg-choice=sole_prop");
  });
});

// ===========================================================================
// 3. §9.3 dependency-operator parity TABLE — server ≡ client, all 9 ops.
// ===========================================================================

type DepOp = "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "range" | "in" | "not_in";
const NINE_OPS: DepOp[] = ["eq", "neq", "gt", "lt", "gte", "lte", "range", "in", "not_in"];

interface Cond {
  when: string;
  op: DepOp;
  value?: unknown;
  values?: unknown[];
  from?: number;
  to?: number;
}
interface DepCase {
  op: DepOp;
  name: string;
  cond: Cond;
  answers: Record<string, unknown>;
  expected: boolean; // expected VISIBLE (conditional met)
}

// server evaluator: leadgen/dependencies.ts evaluateDependencies over ONE node.
function serverVisible(cond: Cond, answers: Record<string, unknown>): boolean {
  const node: LeadgenComponentNode = {
    type: "FreeTextQuestion",
    question_id: "dep_q",
    internal_field: "target",
    conditional: cond as unknown as LeadgenComponentNode["conditional"],
  };
  return evaluateDependencies([node], answers).components[0]!.visible;
}
// client evaluator: runtime/dependencies.ts evaluateComponents over ONE config.
function clientVisible(cond: Cond, answers: Record<string, unknown>): boolean {
  const config = {
    type: "FreeTextQuestion",
    question_id: "dep_q",
    internal_field: "target",
    props: {},
    conditional: cond as unknown as LgComponentConfig["conditional"],
  } as LgComponentConfig;
  return evaluateComponents([config], answers).components[0]!.visible;
}

const F = "target";
const CASES: DepCase[] = [
  // --- eq (strict ===, no coercion) ---
  { op: "eq", name: "match", cond: { when: F, op: "eq", value: "a" }, answers: { target: "a" }, expected: true },
  { op: "eq", name: "non-match", cond: { when: F, op: "eq", value: "a" }, answers: { target: "b" }, expected: false },
  { op: "eq", name: "absent answer", cond: { when: F, op: "eq", value: "a" }, answers: {}, expected: false },
  { op: "eq", name: "type-mismatch 1 vs '1'", cond: { when: F, op: "eq", value: 1 }, answers: { target: "1" }, expected: false },
  { op: "eq", name: "boolean match", cond: { when: F, op: "eq", value: true }, answers: { target: true }, expected: true },

  // --- neq (strict !==; absent is fail-closed → false) ---
  { op: "neq", name: "differs → true", cond: { when: F, op: "neq", value: "a" }, answers: { target: "b" }, expected: true },
  { op: "neq", name: "equal → false", cond: { when: F, op: "neq", value: "a" }, answers: { target: "a" }, expected: false },
  { op: "neq", name: "absent answer → false", cond: { when: F, op: "neq", value: "a" }, answers: {}, expected: false },
  { op: "neq", name: "type-mismatch 1 vs '1' → true", cond: { when: F, op: "neq", value: 1 }, answers: { target: "1" }, expected: true },

  // --- gt (numeric coercion; strict boundary) ---
  { op: "gt", name: "greater", cond: { when: F, op: "gt", value: 10 }, answers: { target: 20 }, expected: true },
  { op: "gt", name: "less", cond: { when: F, op: "gt", value: 10 }, answers: { target: 5 }, expected: false },
  { op: "gt", name: "boundary equal → false", cond: { when: F, op: "gt", value: 10 }, answers: { target: 10 }, expected: false },
  { op: "gt", name: "absent answer", cond: { when: F, op: "gt", value: 10 }, answers: {}, expected: false },
  { op: "gt", name: "string coercion '20'>10", cond: { when: F, op: "gt", value: 10 }, answers: { target: "20" }, expected: true },
  { op: "gt", name: "non-numeric actual → false", cond: { when: F, op: "gt", value: 10 }, answers: { target: "abc" }, expected: false },
  { op: "gt", name: "non-numeric bound → false", cond: { when: F, op: "gt", value: "10" }, answers: { target: 20 }, expected: false },

  // --- lt ---
  { op: "lt", name: "less", cond: { when: F, op: "lt", value: 10 }, answers: { target: 5 }, expected: true },
  { op: "lt", name: "greater", cond: { when: F, op: "lt", value: 10 }, answers: { target: 20 }, expected: false },
  { op: "lt", name: "boundary equal → false", cond: { when: F, op: "lt", value: 10 }, answers: { target: 10 }, expected: false },
  { op: "lt", name: "absent answer", cond: { when: F, op: "lt", value: 10 }, answers: {}, expected: false },

  // --- gte (boundary inclusive) ---
  { op: "gte", name: "greater", cond: { when: F, op: "gte", value: 10 }, answers: { target: 20 }, expected: true },
  { op: "gte", name: "boundary equal → true", cond: { when: F, op: "gte", value: 10 }, answers: { target: 10 }, expected: true },
  { op: "gte", name: "less", cond: { when: F, op: "gte", value: 10 }, answers: { target: 5 }, expected: false },
  { op: "gte", name: "absent answer", cond: { when: F, op: "gte", value: 10 }, answers: {}, expected: false },

  // --- lte (boundary inclusive) ---
  { op: "lte", name: "less", cond: { when: F, op: "lte", value: 10 }, answers: { target: 5 }, expected: true },
  { op: "lte", name: "boundary equal → true", cond: { when: F, op: "lte", value: 10 }, answers: { target: 10 }, expected: true },
  { op: "lte", name: "greater", cond: { when: F, op: "lte", value: 10 }, answers: { target: 20 }, expected: false },
  { op: "lte", name: "absent answer", cond: { when: F, op: "lte", value: 10 }, answers: {}, expected: false },

  // --- range (inclusive [from,to]; both bounds must be numbers) ---
  { op: "range", name: "inside", cond: { when: F, op: "range", from: 25, to: 64 }, answers: { target: 40 }, expected: true },
  { op: "range", name: "boundary low → true", cond: { when: F, op: "range", from: 25, to: 64 }, answers: { target: 25 }, expected: true },
  { op: "range", name: "boundary high → true", cond: { when: F, op: "range", from: 25, to: 64 }, answers: { target: 64 }, expected: true },
  { op: "range", name: "below → false", cond: { when: F, op: "range", from: 25, to: 64 }, answers: { target: 24 }, expected: false },
  { op: "range", name: "above → false", cond: { when: F, op: "range", from: 25, to: 64 }, answers: { target: 65 }, expected: false },
  { op: "range", name: "absent answer", cond: { when: F, op: "range", from: 25, to: 64 }, answers: {}, expected: false },
  { op: "range", name: "string coercion '40'", cond: { when: F, op: "range", from: 25, to: 64 }, answers: { target: "40" }, expected: true },
  { op: "range", name: "non-numeric actual → false", cond: { when: F, op: "range", from: 25, to: 64 }, answers: { target: "abc" }, expected: false },
  { op: "range", name: "missing bound (to) → false", cond: { when: F, op: "range", from: 25 }, answers: { target: 40 }, expected: false },

  // --- in (Array.includes; missing/empty values → false) ---
  { op: "in", name: "member", cond: { when: F, op: "in", values: ["a", "b"] }, answers: { target: "b" }, expected: true },
  { op: "in", name: "non-member", cond: { when: F, op: "in", values: ["a", "b"] }, answers: { target: "c" }, expected: false },
  { op: "in", name: "absent answer", cond: { when: F, op: "in", values: ["a", "b"] }, answers: {}, expected: false },
  { op: "in", name: "empty values[] → false", cond: { when: F, op: "in", values: [] }, answers: { target: "a" }, expected: false },
  { op: "in", name: "missing values → false", cond: { when: F, op: "in" }, answers: { target: "a" }, expected: false },
  { op: "in", name: "numeric member", cond: { when: F, op: "in", values: [1, 2, 3] }, answers: { target: 2 }, expected: true },

  // --- not_in (present → false, absent-answer → false, empty values → true) ---
  { op: "not_in", name: "non-member → true", cond: { when: F, op: "not_in", values: ["a", "b"] }, answers: { target: "c" }, expected: true },
  { op: "not_in", name: "member → false", cond: { when: F, op: "not_in", values: ["a", "b"] }, answers: { target: "a" }, expected: false },
  { op: "not_in", name: "absent answer → false (fail-closed)", cond: { when: F, op: "not_in", values: ["a", "b"] }, answers: {}, expected: false },
  { op: "not_in", name: "empty values[] → true (vacuously not-in)", cond: { when: F, op: "not_in", values: [] }, answers: { target: "a" }, expected: true },
  { op: "not_in", name: "missing values → false (needs array)", cond: { when: F, op: "not_in" }, answers: { target: "a" }, expected: false },
];

describe("§9.3 dependency-operator parity table (server ≡ client)", () => {
  it("cases are exhaustive over all 9 ops", () => {
    expect([...new Set(CASES.map((c) => c.op))].sort()).toEqual([...NINE_OPS].sort());
  });

  for (const c of CASES) {
    it(`${c.op} · ${c.name} → ${c.expected ? "visible" : "hidden"}`, () => {
      const server = serverVisible(c.cond, c.answers);
      const client = clientVisible(c.cond, c.answers);
      // correctness oracle (so two identically-buggy evaluators can't both pass)
      expect(server, `${c.op}/${c.name}: server decision`).toBe(c.expected);
      expect(client, `${c.op}/${c.name}: client decision`).toBe(c.expected);
      // cell-for-cell parity
      expect(client, `${c.op}/${c.name}: server ≡ client`).toBe(server);
    });
  }
});
