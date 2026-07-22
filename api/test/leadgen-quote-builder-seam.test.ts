// LeadGen v2.5 Phase B (slice B4) — EXECUTED-island seams for the 04 §4.1
// Quote Builder frame studio, over the REAL admin router + REAL migrations
// 0036–0041 (the leadgen-quote-builder-ui.test.ts harness). The island JS is
// sliced from the SERVED editor page and BOOTED under node:vm with a DOM-ish
// harness (the leadgen-section-studio-ui.test.ts executed-island idiom,
// extended from function-slicing to whole-island boot); every fetch the
// island makes goes through the LIVE in-process admin router. Seams:
//
//   (a) boot decode: the island's frame working state equals the stored
//       GET /funnels/:id/frame frame_config, and its clientEffective() merge
//       equals the server's effective_frame (client decode == server truth),
//       including the unknown-template → 'centered' fallback agreement;
//   (b) §4.7 one-Save: an inspector edit (data-frame-key change) + a theme
//       edit + a forked-arm override edit issue the EXACT PUT bodies the
//       server accepts (frame → theme → variant, in order, replayed through
//       the live router → 200) and the persisted values equal the island's
//       working values;
//   (c) C5 template switch: the island's confirmation list equals the
//       server's ?switch_to= confirmations VERBATIM, the preview-before-apply
//       POST carries the merged draft (nothing persists), Apply adopts the
//       server merge, Cancel leaves the working config untouched;
//   (d) 14 §14.2 publish chip: the chip state the island derives from the
//       variant-PUT's activation_preflight equals the server verdict/count
//       (blocked fixture → fix → ok fixture);
//   (e) B3 Rules builder: the RULES_BUILDER_SCRIPT island (booted from the
//       same served page) serializes a picker-built condition into the hidden
//       carrier, the quote island's collectRules() reads that carrier, the
//       REAL PUT /variants/:id round-trips it, and the stored conditions_json
//       evaluates IDENTICALLY via the real evaluator (conditionsMatch);
//   (f) DEV-60 (b) quote-name inline edit: the island's rename PATCH — its
//       own save path, outside the §4.7 chain — replayed through the live
//       router (persistence + title re-render + no dirty-flag arming).
//
// NOTE (C2 phasing): the §15.3 "publishing with chrome-in-section blocks with
// a fix link; Advanced legacy override downgrades it to a warning" row is
// DELIBERATELY NOT covered here — the activation chrome-block 409 wiring is
// Phase D per the contract's own phasing (16-implementation-phases.md:
// "Phase D — activation chrome block (C2)").

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
// REAL evaluator stack — seam (e)'s §21.4 single source of truth.
import { conditionsMatch } from "../src/leadgen/auction-rules";
import type { LeadgenRuleConditions } from "../src/admin/leadgen/db-types";

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
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first<T = unknown>(): Promise<T | null> { return (sdb.prepare(sql).get(...binds) ?? null) as T | null; },
        async all<T = unknown>() { return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} }; },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
          return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      try {
        const out: unknown[] = [];
        for (const s of statements) out.push(await s.run());
        runSql(sdb, "COMMIT");
        return out;
      } catch (e) {
        runSql(sdb, "ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
// Rework P1 coherence sweep (conductor-consolidated round): brought
// current through 0053 (was stale) so this harness's D1 schema matches
// the real Wave-1 shape (handlers now write M1/M2/M4/M5 columns/tables
// this file's schema never had).
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

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-2','Site Two','two.example.com');" +
      "INSERT INTO site_settings (site_id, key, value) VALUES ('site-1','site_name','Site One Brand');",
  );
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db, CACHE: {} as KVNamespace, MEDIA: {} as R2Bucket, APP_ENV: "test",
    ADMIN_HOST: "localhost", ADMIN_BASE_URL: "http://localhost:8787", ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false", HTML_CACHE_TTL_SECONDS: "60", OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test", SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false", DEV_BYPASS_AUTH: "true",
  } as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function getJson<T>(env: Env, path: string): Promise<T> {
  const res = await admin.request(path, {}, env);
  expect(res.status, `${path}: ${await res.clone().text()}`).toBe(200);
  return (await res.json()) as T;
}

// --- fixture seeding (REAL admin APIs; direct SQL only for sections, the B2
// --- idiom, and for the deliberately-corrupt unknown-template row) -----------

const MAPPABLE_CONTENT = {
  components: [
    { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
    { type: "ZIPInputQuestion", question_id: "q2", question_key: "zip_q", internal_field: "zip", answer_type: "string", props: { placeholder: "ZIP" } },
  ],
};

function seedSection(sdb: SqliteDb, name: string): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  sdb
    .prepare("INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, ?, ?, ?, ?, ?, 'button', 'active')")
    .run(publicId, name, "quote_funnel", "life", "Headline", JSON.stringify(MAPPABLE_CONTENT));
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

interface QuoteCreateBody {
  id: number;
  public_id: string;
  funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
}

// Rework M2 (§4.3-1, §4.3-15): activation now also requires the quote's
// shared first page (leadgen_funnel_pages, quote_id-owned) to carry ≥1
// section — a section distinct from the funnel/variant's own (§4.3-13
// uniqueness). Route wiring for POST/PUT /quotes/:id/shared-page is
// mid-flight in another round, so this seeds the SQL shape directly
// (mirrors leadgen-rework-handlers.test.ts / leadgen-rework-routing.test.ts).
function seedSharedPageSection(sdb: SqliteDb, quoteId: number): void {
  const sectionPublicId = mintPublicId("section");
  const content = JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "q1", question_key: "k", internal_field: "f", answer_type: "boolean" }] });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, ?, 'quote_funnel', 'life', 'Shared', ?, 'button', 'active')",
    )
    .run(sectionPublicId, `Shared ${sectionPublicId.slice(-4)}`, content);
  const sectionId = (sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(sectionPublicId) as { id: number }).id;
  const pagePublicId = mintPublicId("funnel_page");
  sdb.prepare("INSERT INTO leadgen_funnel_pages (public_id, quote_id, position, name) VALUES (?, ?, 0, NULL)").run(pagePublicId, quoteId);
  sdb
    .prepare(
      `INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position, page_id)
       VALUES (?, ?, 0, (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?))`,
    )
    .run(quoteId, sectionId, pagePublicId);
}

interface Harness {
  sdb: SqliteDb;
  env: Env;
  quotePublicId: string;
  funnelPublicId: string;
  variantId: string;
  sections: Array<{ id: number; public_id: string }>;
}

async function studioHarness(): Promise<Harness> {
  const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
  const env = buildEnv(d1FromSqlite(sdb));
  const create = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Seam Quote", activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(create.status, `create quote: ${await create.clone().text()}`).toBe(201);
  const q = (await create.json()) as QuoteCreateBody;
  const variantId = q.funnels[0]!.variants[0]!.public_id;
  const funnelPublicId = q.funnels[0]!.public_id;
  const s1 = seedSection(sdb, "First slide");
  const s2 = seedSection(sdb, "Second slide");
  const put = await admin.request(
    `${API}/variants/${variantId}`,
    jsonInit("PUT", { sections: [{ section_id: s1.id }, { section_id: s2.id }] }),
    env,
  );
  expect(put.status, `seed variant: ${await put.clone().text()}`).toBe(200);
  seedSharedPageSection(sdb, q.id);
  const activate = await admin.request(
    `${API}/quotes/${q.public_id}/activation/site-1`,
    jsonInit("PUT", { enabled: true, slug: "seam" }),
    env,
  );
  expect(activate.status, `activate: ${await activate.clone().text()}`).toBe(200);
  return { sdb, env, quotePublicId: q.public_id, funnelPublicId, variantId, sections: [s1, s2] };
}

async function editorPage(env: Env, quotePublicId: string, variant?: string): Promise<string> {
  const url = `/admin/leadgen/quotes/${quotePublicId}/edit${variant !== undefined ? `?variant=${variant}` : ""}`;
  const res = await admin.request(url, {}, env);
  expect(res.status, `${url} status`).toBe(200);
  return res.text();
}

// A real Offer with an ACTIVE payload schema (one REQUIRED answer field) —
// the (d) blocked-preflight input (missing_required_provider_fields).
async function createOfferWithRequiredField(env: Env): Promise<{ id: number; public_id: string }> {
  const created = await admin.request(
    `${API}/offers`,
    jsonInit("POST", {
      offer_name: "Seam Offer", provider: "seamprov", activity: "quote_funnel", vertical: "life",
      conversion_tracking_method: "s2s_postback", offer_type: "cpc", placements: ["pl-seam"],
      calls_provider_api: false, bid_source: "static", cap_enabled: false,
    }),
    env,
  );
  expect(created.status, `offer create: ${await created.clone().text()}`).toBe(201);
  const offer = (await created.json()) as { id: number; public_id: string };
  const schema = await admin.request(
    `${API}/offers/${offer.public_id}/payload-schemas`,
    jsonInit("POST", {
      schema_json: {
        version: 1,
        root: { type: "object", children: [{ path: "data.zip", name: "zip", type: "string", required: true, source: "answer", internal_field: "zip" }] },
      },
    }),
    env,
  );
  expect(schema.status, `schema create: ${await schema.clone().text()}`).toBe(201);
  return offer;
}

// ---------------------------------------------------------------------------
// The DOM-ish node:vm harness. Every element is a plain FakeNode; the island
// is booted UNMODIFIED except for one appended `__seamExpose({...})` exporter
// INSIDE its IIFE — an explicit getter map over the island's real closure
// state (no arbitrary code evaluation). All fetches bridge to the LIVE admin
// router and are captured (url/method/body/response).
// ---------------------------------------------------------------------------

interface FakeNode {
  tag: string;
  id: string;
  attrs: Record<string, string>;
  children: unknown[];
  handlers: Record<string, Array<(ev?: unknown) => unknown>>;
  sel: Record<string, unknown>;
  parentNode: unknown;
  value: string;
  checked: boolean;
  disabled: boolean;
  hidden: boolean;
  selected: boolean;
  className: string;
  type: string;
  title: string;
  textContent: string;
  nodeType: number;
  style: Record<string, string>;
  readonly firstChild: unknown;
  getAttribute(n: string): string | null;
  setAttribute(n: string, v: unknown): void;
  hasAttribute(n: string): boolean;
  removeAttribute(n: string): void;
  addEventListener(t: string, f: (ev?: unknown) => unknown): void;
  dispatchEvent(ev: unknown): boolean;
  appendChild(c: unknown): unknown;
  removeChild(c: unknown): unknown;
  insertBefore(a: unknown, b: unknown): unknown;
  querySelector(s: string): unknown;
  querySelectorAll(s: string): unknown[];
  focus(): void;
}

function makeNode(tag: string, id = ""): FakeNode {
  const node: FakeNode = {
    tag, id,
    attrs: {},
    children: [],
    handlers: {},
    sel: {},
    parentNode: null,
    value: "", checked: false, disabled: false, hidden: false, selected: false,
    className: "", type: "", title: "", textContent: "",
    nodeType: 1,
    style: {},
    get firstChild() { return node.children[0] ?? null; },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(node.attrs, n) ? node.attrs[n]! : null; },
    setAttribute(n, v) { node.attrs[n] = String(v); },
    hasAttribute(n) { return Object.prototype.hasOwnProperty.call(node.attrs, n); },
    removeAttribute(n) { delete node.attrs[n]; },
    addEventListener(t, f) { (node.handlers[t] = node.handlers[t] ?? []).push(f); },
    dispatchEvent() { return true; },
    appendChild(c) {
      node.children.push(c);
      if (c !== null && typeof c === "object") (c as { parentNode: unknown }).parentNode = node;
      return c;
    },
    removeChild(c) {
      const at = node.children.indexOf(c);
      if (at >= 0) node.children.splice(at, 1);
      if (c !== null && typeof c === "object") (c as { parentNode: unknown }).parentNode = null;
      return c;
    },
    insertBefore(a, b) {
      const at = node.children.indexOf(b);
      if (at >= 0) node.children.splice(at, 0, a);
      else node.children.push(a);
      if (a !== null && typeof a === "object") (a as { parentNode: unknown }).parentNode = node;
      return a;
    },
    querySelector(s) {
      const hit = node.sel[s];
      if (hit === undefined) return null;
      return Array.isArray(hit) ? (hit[0] ?? null) : hit;
    },
    querySelectorAll(s) {
      const hit = node.sel[s];
      if (hit === undefined) return [];
      return Array.isArray(hit) ? hit : [hit];
    },
    focus() { /* noop */ },
  };
  return node;
}

// Visible text of a built node tree (createTextNode children carry .text).
function textOf(n: unknown): string {
  if (n === null || n === undefined) return "";
  const rec = n as { text?: string; textContent?: string; children?: unknown[] };
  if (typeof rec.text === "string") return rec.text;
  let out = typeof rec.textContent === "string" ? rec.textContent : "";
  for (const c of rec.children ?? []) out += textOf(c);
  return out;
}

// Depth-first class lookup over mounted fake trees (seam (e) drives the
// controls the REAL renderRowEl/renderValueZone created).
function findByClass(root: unknown, cls: string, out: FakeNode[] = []): FakeNode[] {
  const rec = root as { className?: string; children?: unknown[] };
  if (typeof rec.className === "string" && rec.className.split(" ").includes(cls)) out.push(root as FakeNode);
  for (const c of rec.children ?? []) {
    if (c !== null && typeof c === "object") findByClass(c, cls, out);
  }
  return out;
}

interface CapturedCall {
  url: string;
  method: string;
  body: unknown;
  status: number;
  response: unknown;
}

// The explicit island-scope exports (appended INSIDE the IIFE — live getters
// over the real closure variables + the real inner functions).
interface IslandProbe {
  workingFrame: Record<string, unknown>;
  workingTheme: Record<string, unknown>;
  workingOverrides: Record<string, unknown>;
  frameDirty: boolean;
  themeDirty: boolean;
  variantDirty: boolean;
  overridesDirty: boolean;
  allocDirty: boolean;
  dirty: boolean;
  isControl: boolean;
  selectedRegion: string | null;
  pendingSwitch: { id: string; merged: Record<string, unknown> } | null;
  clientEffective(): Record<string, unknown>;
  currentTemplateId(): string;
  draftFrameConfig(): Record<string, unknown>;
  draftTheme(): Record<string, unknown>;
  collectRules(): Array<Record<string, unknown>>;
  collectSections(): Array<Record<string, unknown>>;
}

// ES5 exporter source (getters over island locals — NOT an eval bridge).
const SEAM_EXPORTER = `
;__seamExpose({
  get workingFrame() { return workingFrame; },
  get workingTheme() { return workingTheme; },
  get workingOverrides() { return workingOverrides; },
  get frameDirty() { return frameDirty; },
  get themeDirty() { return themeDirty; },
  get variantDirty() { return variantDirty; },
  get overridesDirty() { return overridesDirty; },
  get allocDirty() { return allocDirty; },
  get dirty() { return dirty; },
  get isControl() { return isControl; },
  get selectedRegion() { return selectedRegion; },
  get pendingSwitch() { return pendingSwitch; },
  clientEffective: function () { return clientEffective(); },
  currentTemplateId: function () { return currentTemplateId(); },
  draftFrameConfig: function () { return draftFrameConfig(); },
  draftTheme: function () { return draftTheme(); },
  collectRules: function () { return collectRules(); },
  collectSections: function () { return collectSections(); }
});
`;

interface Studio {
  registry: Map<string, FakeNode>;
  root: FakeNode;
  calls: CapturedCall[];
  issued: Array<{ url: string; body: string }>; // fetch ISSUANCE order (calls[] records completion order)
  setResponseDelay: (fn: ((url: string, init?: RequestInit) => number) | null) => void;
  windowObj: Record<string, unknown>;
  probe: IslandProbe;
  settle: () => Promise<void>;
  fire: (node: FakeNode, type: string, target?: unknown) => void;
  byId: (id: string) => FakeNode;
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

// Split the served combined block (ADMIN_SCRIPTS + QUOTE_EDITOR_SCRIPT +
// RULES_BUILDER_SCRIPT ride ONE <script>) into the editor IIFE body and the
// trailing rules-builder IIFE (balanced-brace slice, anchored on the editor
// island's own root lookup — never a regex over JS source).
function splitIslands(script: string): { editorBody: string; rulesScript: string } {
  const marker = "(function () {";
  const anchor = script.indexOf("document.getElementById('lg-quote-editor')");
  expect(anchor, "editor island anchor present").toBeGreaterThan(-1);
  const start = script.lastIndexOf(marker, anchor);
  expect(start, "editor island IIFE present").toBeGreaterThan(-1);
  const open = script.indexOf("{", start);
  let depth = 0;
  let close = -1;
  for (let i = open; i < script.length; i += 1) {
    if (script[i] === "{") depth += 1;
    else if (script[i] === "}") {
      depth -= 1;
      if (depth === 0) { close = i; break; }
    }
  }
  expect(close, "editor island braces balanced").toBeGreaterThan(open);
  const editorBody = script.slice(open + 1, close);
  const rest = script.slice(close + 1);
  const rulesAt = rest.indexOf(marker);
  return { editorBody, rulesScript: rulesAt >= 0 ? rest.slice(rulesAt) : "" };
}

function rawBlob(html: string, id: string): string {
  const marker = `id="${id}">`;
  const start = html.indexOf(marker);
  expect(start, `blob ${id} present`).toBeGreaterThan(-1);
  const from = start + marker.length;
  return html.slice(from, html.indexOf("</script>", from));
}

// Boot the SERVED page's editor island (+ optionally the rules island) in one
// vm context against the live router.
async function bootStudio(env: Env, html: string, opts: { rulesIsland?: boolean } = {}): Promise<Studio> {
  const combined = extractScripts(html).find((s) => s.includes("getElementById('lg-quote-editor')"));
  expect(combined, "quote editor island present in served page").toBeDefined();
  const { editorBody, rulesScript } = splitIslands(combined!);

  // --- registry-backed document --------------------------------------------
  const registry = new Map<string, FakeNode>();
  const explicitNull = new Set(["lg-rules-builder-root"]); // seam (e) uses mount(), not the SSR panel init
  const byId = (id: string): FakeNode => {
    let n = registry.get(id);
    if (n === undefined) {
      n = makeNode("div", id);
      registry.set(id, n);
    }
    return n;
  };

  // root element: the REAL data-* attributes from the served page
  const root = makeNode("div", "lg-quote-editor");
  const rootTag = html.match(/<div id="lg-quote-editor"[^>]*>/);
  expect(rootTag, "lg-quote-editor root present").not.toBeNull();
  for (const m of rootTag![0].matchAll(/(data-[a-z-]+)="([^"]*)"/g)) root.attrs[m[1]!] = m[2]!;
  registry.set("lg-quote-editor", root);

  // the REAL #lg-quote-data blob rides the fake blob element
  const blobEl = makeNode("script", "lg-quote-data");
  blobEl.textContent = rawBlob(html, "lg-quote-data");
  registry.set("lg-quote-data", blobEl);

  // SSR section rows → collectSections()/slideStillPresent() fidelity
  const sectionRows: FakeNode[] = [];
  for (const m of html.matchAll(/<div class="lg-section-row lg-structure-row" data-section-id="(\d+)" data-section-public-id="([^"]*)">/g)) {
    if (m[2] === "") continue; // the SSR <template> clone row, not a slide
    const row = makeNode("div");
    row.className = "lg-section-row lg-structure-row";
    row.attrs["data-section-id"] = m[1]!;
    row.attrs["data-section-public-id"] = m[2]!;
    sectionRows.push(row);
  }
  const sectionList = makeNode("div", "lg-section-list");
  sectionList.sel[".lg-section-row"] = sectionRows;
  registry.set("lg-section-list", sectionList);
  root.sel[".lg-section-row[data-section-public-id]"] = sectionRows;

  const documentObj = {
    readyState: "complete",
    handlers: {} as Record<string, Array<(ev?: unknown) => unknown>>,
    getElementById(id: string) { return explicitNull.has(id) ? null : byId(id); },
    createElement(tag: string) { return makeNode(tag); },
    createTextNode(text: string) { return { nodeType: 3, text, parentNode: null }; },
    createEvent(): never { throw new Error("createEvent unsupported in seam harness"); },
    addEventListener(t: string, f: (ev?: unknown) => unknown) { (this.handlers[t] = this.handlers[t] ?? []).push(f); },
    importNode(n: unknown) { return n; },
  };

  // --- timers + fetch bridge (LIVE router) + settle -------------------------
  let pendingTimers = 0;
  let pendingFetches = 0;
  const timerHandles = new Map<number, NodeJS.Timeout>();
  let timerSeq = 0;
  const windowObj: Record<string, unknown> = {
    setTimeout(fn: () => void, _ms?: number) {
      const id = ++timerSeq;
      pendingTimers += 1;
      const t = setTimeout(() => { timerHandles.delete(id); pendingTimers -= 1; fn(); }, 0);
      timerHandles.set(id, t);
      return id;
    },
    clearTimeout(id: number) {
      const t = timerHandles.get(id);
      if (t !== undefined) { clearTimeout(t); timerHandles.delete(id); pendingTimers -= 1; }
    },
    addEventListener() { /* beforeunload guard — inert here */ },
    location: { href: "", reload() { /* noop */ } },
  };

  const calls: CapturedCall[] = [];
  const issued: Array<{ url: string; body: string }> = [];
  // Optional per-response delay (ms) — lets a test hold ONE response back so
  // two live-router requests genuinely resolve out of order (the FIX 9 stale-
  // response race). null = no delays.
  let responseDelay: ((url: string, init?: RequestInit) => number) | null = null;
  const fetchImpl = (url: string, init?: RequestInit): Promise<Response> => {
    pendingFetches += 1;
    issued.push({ url, body: init !== undefined && typeof init.body === "string" ? init.body : "" });
    return Promise.resolve(admin.request(url, init ?? {}, env)).then(
      async (res: Response) => {
        const delayMs = responseDelay === null ? 0 : responseDelay(url, init);
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
        let parsedResponse: unknown = null;
        try { parsedResponse = await res.clone().json(); } catch { /* non-JSON */ }
        let parsedBody: unknown = null;
        if (init !== undefined && typeof init.body === "string") {
          try { parsedBody = JSON.parse(init.body); } catch { parsedBody = init.body; }
        }
        calls.push({ url, method: init?.method ?? "GET", body: parsedBody, status: res.status, response: parsedResponse });
        pendingFetches -= 1;
        return res;
      },
      (err: unknown) => { pendingFetches -= 1; throw err; },
    );
  };

  async function settle(): Promise<void> {
    let quiet = 0;
    for (let i = 0; i < 400 && quiet < 3; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
      if (pendingTimers === 0 && pendingFetches === 0) quiet += 1;
      else quiet = 0;
    }
    expect(pendingTimers, "island timers drained").toBe(0);
    expect(pendingFetches, "island fetches drained").toBe(0);
  }

  // --- boot: the byte-identical island body + the appended getter exporter --
  let probeRef: IslandProbe | null = null;
  const sandbox: Record<string, unknown> = {
    document: documentObj,
    window: windowObj,
    fetch: fetchImpl,
    __seamExpose(p: IslandProbe) { probeRef = p; },
  };
  const rebuilt = `(function () {${editorBody}${SEAM_EXPORTER}}());`;
  runInNewContext(rebuilt, sandbox, { filename: "quote-editor-island.vm.js" });
  expect(probeRef, "island booted (exporter ran)").not.toBeNull();
  if (opts.rulesIsland === true) {
    expect(rulesScript, "rules island present in served page").not.toBe("");
    runInNewContext(rulesScript, sandbox, { filename: "rules-builder-island.vm.js" });
    expect((windowObj as { lgRulesBuilder?: unknown }).lgRulesBuilder, "window.lgRulesBuilder exposed").toBeTruthy();
  }
  await settle(); // the boot schedulePreview() → live preview POST

  const fire = (node: FakeNode, type: string, target?: unknown): void => {
    const ev = { target: target ?? node, preventDefault() { /* noop */ } };
    for (const h of [...(node.handlers[type] ?? [])]) h(ev);
  };

  return {
    registry,
    root,
    calls,
    issued,
    setResponseDelay: (fn) => { responseDelay = fn; },
    windowObj,
    probe: probeRef!,
    settle,
    fire,
    byId,
  };
}

// Poll until `cond` holds (the FIX 9 test waits for a specific request to be
// ISSUED before firing the competing one — never a blind sleep).
async function waitFor(cond: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  expect(cond(), label).toBe(true);
}

// A minimal event target for delegated root handlers: answers ONE attribute.
function fakeTarget(attr: string, attrValue: string, props: Partial<Pick<FakeNode, "value" | "checked" | "type">> = {}): Record<string, unknown> {
  return {
    parentNode: null,
    type: props.type ?? "text",
    value: props.value ?? "",
    checked: props.checked ?? false,
    id: "",
    getAttribute(n: string) { return n === attr ? attrValue : null; },
    hasAttribute(n: string) { return n === attr; },
  };
}

interface FrameGetBody {
  frame_config: Record<string, unknown> | null;
  effective_frame: Record<string, unknown>;
  template_defaults: Record<string, unknown>;
  problems: unknown[];
}

interface StructureBody {
  quote: { public_id: string };
  funnels: Array<{
    public_id: string;
    variants: Array<{
      public_id: string;
      variant_label: string;
      funnel_design_id: string;
      frame_overrides_json: Record<string, unknown> | null;
      sections: Array<{ section_id: number; position: number }>;
      rules: Array<{ rule_type: string; conditions_json: unknown; enabled: boolean; priority: number }>;
    }>;
  }>;
}

// The (a)/(c) rich stored config — every value schema-legal (§3.3 enums).
const RICH_FRAME_CONFIG = {
  version: 1,
  template: "header-cta",
  header: { tagline: "Compare and save", logo_align: "left", secure_badge: { enabled: true, text: "Secure" } },
  progress: { style: "numbered", thickness: "l", show_label: true },
  trust_strip: {
    enabled: true,
    logos: [
      { media_id: "logos/a.png", alt: "Brand A" },
      { media_id: "logos/b.png", alt: "Brand B" },
    ],
    placement: "below_unit",
  },
  benefit_bar: { enabled: true, items: [{ icon: "star", text: "No fees" }] },
  footer: { links_source: "manual", links: [{ label: "Privacy", href: "/privacy" }], trust_text: "Licensed" },
  background: { role: "page_background", style: "flat" },
} as const;

// ===========================================================================
// (a) boot decode — client working state == stored config; clientEffective()
//     == server effective_frame
// ===========================================================================

describeDb("quote builder EXECUTED island — (a) boot decode equals server truth", () => {
  it("workingFrame equals GET frame_config and clientEffective() equals effective_frame for a rich stored config", async () => {
    const h = await studioHarness();
    const put = await admin.request(
      `${API}/funnels/${h.funnelPublicId}/frame`,
      jsonInit("PUT", { frame_config_json: RICH_FRAME_CONFIG }),
      h.env,
    );
    expect(put.status, await put.clone().text()).toBe(200);
    const server = await getJson<FrameGetBody>(h.env, `${API}/funnels/${h.funnelPublicId}/frame`);
    expect(server.frame_config).toEqual(RICH_FRAME_CONFIG);

    const html = await editorPage(h.env, h.quotePublicId);
    const studio = await bootStudio(h.env, html);

    // the island's boot state IS the stored column (client decode == server row)
    expect(studio.probe.workingFrame).toEqual(server.frame_config);
    // the island's populate-only merge equals the server's ONE effectiveFrame
    // implementation — template ⊕ stored, byte-deep (§13.2 parity)
    expect(studio.probe.clientEffective()).toEqual(server.effective_frame);
    expect(studio.probe.currentTemplateId()).toBe("header-cta");

    // the boot preview went through the LIVE composed endpoint with the
    // island's frame draft + the first slide of the PERSISTED order; a clean
    // boot (no unsaved override edits) sends NO draft_frame_overrides —
    // the server keeps its stored merge (DEV-58 conditionality)
    const boot = studio.calls.find((c) => c.url.endsWith(`/variants/${h.variantId}/preview`));
    expect(boot, "boot preview POST captured").toBeDefined();
    expect(boot!.status).toBe(200);
    const bootBody = boot!.body as Record<string, unknown>;
    expect(bootBody["mode"]).toBe("section");
    expect(bootBody["section_public_id"]).toBe(h.sections[0]!.public_id);
    expect(bootBody["draft_frame_config"]).toEqual(studio.probe.draftFrameConfig());
    expect(bootBody["draft_frame_overrides"]).toBeUndefined();
    // …and the canvas iframe received the server document
    const canvas = studio.byId("lg-preview-iframe");
    expect(canvas.attrs["srcdoc"]).toContain("data-frame-region");
  });

  it("unknown stored template: island and server AGREE on the 'centered' fallback (client decode == server fallback)", async () => {
    const h = await studioHarness();
    // corrupt row (bypasses PUT validation on purpose — the §4.3 stored-drift case)
    h.sdb
      .prepare("UPDATE leadgen_funnels SET frame_config_json = ? WHERE public_id = ?")
      .run(JSON.stringify({ version: 1, template: "retired-template", header: { tagline: "Kept" } }), h.funnelPublicId);

    const server = await getJson<FrameGetBody>(h.env, `${API}/funnels/${h.funnelPublicId}/frame`);
    expect(server.effective_frame["template"]).toBe("centered");

    const html = await editorPage(h.env, h.quotePublicId);
    const studio = await bootStudio(h.env, html);
    const eff = studio.probe.clientEffective();
    expect(eff).toEqual(server.effective_frame);
    expect((eff["header"] as Record<string, unknown>)["tagline"]).toBe("Kept");
  });
});

// ===========================================================================
// (b) §4.7 one-Save — inspector edit → EXACT PUT bodies through the live
//     router; persisted values equal the island's working values
// ===========================================================================

describeDb("quote builder EXECUTED island — (b) edit → save path replays through the live router", () => {
  it("a data-frame-key edit + a data-theme-key edit save frame → theme → variant IN ORDER with the exact accepted bodies", async () => {
    const h = await studioHarness();
    const html = await editorPage(h.env, h.quotePublicId);
    const studio = await bootStudio(h.env, html);
    const structure = await getJson<StructureBody>(h.env, `${API}/quotes/${h.quotePublicId}/structure`);
    const variantNode = structure.funnels[0]!.variants[0]!;

    // EDIT through the island's delegated change handlers (the real routes)
    studio.fire(studio.root, "change", fakeTarget("data-frame-key", "header.tagline", { value: "Seam tagline" }));
    studio.fire(studio.root, "change", fakeTarget("data-theme-key", "typography.size", { value: "l" }));
    await studio.settle();
    expect(studio.probe.frameDirty).toBe(true);
    expect(studio.probe.themeDirty).toBe(true);

    // SSR-faithful funnel-settings value for collectPayload() + the change
    // event a real operator interaction bubbles — the variant PUT rides ONLY
    // when variant-scoped state is dirty (FIX 6 gating)
    studio.byId("lg-funnel-design").value = variantNode.funnel_design_id;
    studio.fire(studio.root, "change", studio.byId("lg-funnel-design"));
    expect(studio.probe.variantDirty).toBe(true);

    const before = studio.calls.length;
    studio.fire(studio.byId("lg-variant-save"), "click");
    await studio.settle();
    const saves = studio.calls.slice(before).filter((c) => c.method === "PUT");
    expect(saves.map((c) => c.url)).toEqual([
      `/api/admin/leadgen/funnels/${h.funnelPublicId}/frame`,
      `/api/admin/leadgen/funnels/${h.funnelPublicId}/theme`,
      `/api/admin/leadgen/variants/${h.variantId}`,
    ]);
    for (const save of saves) expect(save.status, `${save.url} → ${JSON.stringify(save.response)}`).toBe(200);

    // EXACT body shapes the server accepted
    const frameBody = saves[0]!.body as Record<string, unknown>;
    expect(Object.keys(frameBody)).toEqual(["frame_config_json"]);
    expect(frameBody["frame_config_json"]).toEqual(studio.probe.workingFrame);
    const themeBody = saves[1]!.body as Record<string, unknown>;
    expect(Object.keys(themeBody)).toEqual(["theme_json"]);
    expect(themeBody["theme_json"]).toEqual(studio.probe.workingTheme);
    const variantBody = saves[2]!.body as Record<string, unknown>;
    expect(Object.keys(variantBody).sort()).toEqual([
      "auction_id", "funnel_design_id", "lander_enabled", "lander_headline",
      "lander_hero_media_url", "lander_subheadline", "rules", "sections",
    ]);
    // untouched overrides NEVER ride the PUT (additive §4.5 contract)
    expect(variantBody["frame_overrides_json"]).toBeUndefined();
    expect(variantBody["sections"]).toEqual(h.sections.map((s, i) => ({ section_id: s.id, position: i })));

    // SERVER truth: persisted values equal the island's working values
    const frame = await getJson<FrameGetBody>(h.env, `${API}/funnels/${h.funnelPublicId}/frame`);
    expect((frame.frame_config!["header"] as Record<string, unknown>)["tagline"]).toBe("Seam tagline");
    expect(frame.frame_config).toEqual(studio.probe.workingFrame);
    const theme = await getJson<{ theme: Record<string, unknown> | null }>(h.env, `${API}/funnels/${h.funnelPublicId}/theme`);
    expect((theme.theme!["typography"] as Record<string, unknown>)["size"]).toBe("l");
    const after = await getJson<StructureBody>(h.env, `${API}/quotes/${h.quotePublicId}/structure`);
    expect(after.funnels[0]!.variants[0]!.sections.map((s) => s.section_id)).toEqual(h.sections.map((s) => s.id));

    // the island reset its dirty state + showed the saved note
    expect(studio.probe.frameDirty).toBe(false);
    expect(studio.probe.themeDirty).toBe(false);
    expect(studio.probe.variantDirty).toBe(false);
    expect(studio.probe.dirty).toBe(false);
    expect(studio.byId("lg-quote-ok").hidden).toBe(false);
  });

  it("FIX 6: a second Save with nothing changed issues ZERO PUTs (no re-bump, no cache thrash)", async () => {
    const h = await studioHarness();
    const html = await editorPage(h.env, h.quotePublicId);
    const studio = await bootStudio(h.env, html);
    const structure = await getJson<StructureBody>(h.env, `${API}/quotes/${h.quotePublicId}/structure`);
    studio.byId("lg-funnel-design").value = structure.funnels[0]!.variants[0]!.funnel_design_id;

    // dirty all three scopes through the island's real handlers
    studio.fire(studio.root, "change", fakeTarget("data-frame-key", "header.tagline", { value: "Zero-PUT tagline" }));
    studio.fire(studio.root, "change", fakeTarget("data-theme-key", "typography.size", { value: "l" }));
    studio.fire(studio.root, "change", studio.byId("lg-funnel-design"));
    await studio.settle();

    const before = studio.calls.length;
    studio.fire(studio.byId("lg-variant-save"), "click");
    await studio.settle();
    const firstSaves = studio.calls.slice(before).filter((c) => c.method === "PUT");
    expect(firstSaves.map((c) => c.url)).toEqual([
      `/api/admin/leadgen/funnels/${h.funnelPublicId}/frame`,
      `/api/admin/leadgen/funnels/${h.funnelPublicId}/theme`,
      `/api/admin/leadgen/variants/${h.variantId}`,
    ]);
    for (const save of firstSaves) expect(save.status, `${save.url} → ${JSON.stringify(save.response)}`).toBe(200);
    expect(studio.probe.frameDirty).toBe(false);
    expect(studio.probe.themeDirty).toBe(false);
    expect(studio.probe.variantDirty).toBe(false);
    expect(studio.probe.overridesDirty).toBe(false);

    // SECOND save with NOTHING changed → ZERO PUTs; content_version untouched;
    // still a success note (everything already saved IS saved).
    const contentVersion = (): number =>
      (h.sdb.prepare("SELECT content_version AS v FROM leadgen_funnel_variants WHERE public_id = ?").get(h.variantId) as { v: number }).v;
    const versionAfterFirst = contentVersion();
    const mid = studio.calls.length;
    studio.fire(studio.byId("lg-variant-save"), "click");
    await studio.settle();
    expect(studio.calls.slice(mid).filter((c) => c.method === "PUT")).toEqual([]);
    expect(contentVersion()).toBe(versionAfterFirst);
    expect(studio.byId("lg-quote-ok").hidden).toBe(false);
  });

  it("FIX 6a: a mid-chain theme failure leaves ONLY theme+variant dirty — Retry re-PUTs just those, never the already-saved frame", async () => {
    const h = await studioHarness();
    const html = await editorPage(h.env, h.quotePublicId);
    const studio = await bootStudio(h.env, html);
    const structure = await getJson<StructureBody>(h.env, `${API}/quotes/${h.quotePublicId}/structure`);
    studio.byId("lg-funnel-design").value = structure.funnels[0]!.variants[0]!.funnel_design_id;

    // frame edit + a theme edit the SERVER rejects (§9.3 closed set) + a
    // variant-scoped edit
    studio.fire(studio.root, "change", fakeTarget("data-frame-key", "header.tagline", { value: "Retry tagline" }));
    studio.fire(studio.root, "change", fakeTarget("data-theme-key", "scales.radius", { value: "circle" }));
    studio.fire(studio.root, "change", studio.byId("lg-funnel-design"));
    await studio.settle();

    const before = studio.calls.length;
    studio.fire(studio.byId("lg-variant-save"), "click");
    await studio.settle();
    const firstSaves = studio.calls.slice(before).filter((c) => c.method === "PUT");
    // chain aborted at the theme 400 — the variant PUT never rode
    expect(firstSaves.map((c) => `${c.url} ${c.status}`)).toEqual([
      `/api/admin/leadgen/funnels/${h.funnelPublicId}/frame 200`,
      `/api/admin/leadgen/funnels/${h.funnelPublicId}/theme 400`,
    ]);
    expect(studio.byId("lg-quote-error").hidden).toBe(false);
    // per-step clearing: the SAVED frame is clean; the failed + later steps stay dirty
    expect(studio.probe.frameDirty).toBe(false);
    expect(studio.probe.themeDirty).toBe(true);
    expect(studio.probe.variantDirty).toBe(true);

    // fix the theme, Retry → ONLY theme + variant PUTs (the frame is not
    // re-sent, so it can never double-bump content_version)
    studio.fire(studio.root, "change", fakeTarget("data-theme-key", "scales.radius", { value: "round" }));
    await studio.settle();
    const mid = studio.calls.length;
    studio.fire(studio.byId("lg-variant-save"), "click");
    await studio.settle();
    const retrySaves = studio.calls.slice(mid).filter((c) => c.method === "PUT");
    expect(retrySaves.map((c) => c.url)).toEqual([
      `/api/admin/leadgen/funnels/${h.funnelPublicId}/theme`,
      `/api/admin/leadgen/variants/${h.variantId}`,
    ]);
    for (const save of retrySaves) expect(save.status, `${save.url} → ${JSON.stringify(save.response)}`).toBe(200);
    expect(studio.probe.themeDirty).toBe(false);
    expect(studio.probe.variantDirty).toBe(false);
    expect(studio.byId("lg-quote-ok").hidden).toBe(false);
  });

  it("forked arm: an override-switch edit writes frame_overrides_json (badge derives client-side; PUT persists; server agrees)", async () => {
    const h = await studioHarness();
    // Rework M1 (§4.3-10): forkVariantHandler now unconditionally refuses a
    // 2nd active variant — archiving the source first is the minimal way to
    // still exercise the real fork endpoint (this test's point is the
    // FORKED arm's override-switch behavior, not fork's own guard).
    h.sdb.prepare("UPDATE leadgen_funnel_variants SET status = 'archived' WHERE public_id = ?").run(h.variantId);
    const fork = await admin.request(`${API}/variants/${h.variantId}/fork`, { method: "POST" }, h.env);
    expect(fork.status, await fork.clone().text()).toBe(201);
    const forked = (await fork.json()) as { public_id: string };

    const html = await editorPage(h.env, h.quotePublicId, forked.public_id);
    const studio = await bootStudio(h.env, html);
    expect(studio.probe.isControl).toBe(false);

    // flip the §4.5 override switch for the progress group, then edit it
    studio.fire(studio.root, "change", fakeTarget("data-override-group", "progress", { value: "override", type: "radio", checked: true }));
    studio.fire(studio.root, "change", fakeTarget("data-frame-key", "progress.style", { value: "dots" }));
    await studio.settle();
    expect(studio.probe.workingOverrides).toEqual({ progress: { style: "dots" } });
    expect(studio.probe.frameDirty).toBe(false); // routed to the OVERRIDES target, not the funnel frame

    // §4.5 canvas badge: derived by the island from its live override state
    const badge = studio.byId("lg-override-badge");
    expect(badge.className).toBe("lg-chip lg-override-badge");
    expect(textOf(studio.byId("lg-override-badge-list"))).toBe("Progress");

    // DEV-58 (Phase D): the unsaved override rides the ADDITIVE
    // draft_frame_overrides param in the stored-column shape; the funnel
    // frame draft NO LONGER folds it (the stored-merge approximation is
    // gone — the server substitutes the WORKING overrides exactly).
    const previews = studio.calls.filter((c) => c.url.endsWith(`/variants/${forked.public_id}/preview`));
    const lastPreview = previews[previews.length - 1]!;
    expect(lastPreview.status).toBe(200);
    const lastPreviewBody = lastPreview.body as Record<string, unknown>;
    expect(lastPreviewBody["draft_frame_overrides"]).toEqual({ progress: { style: "dots" } });
    expect((lastPreviewBody["draft_frame_config"] as Record<string, unknown>)["progress"]).toBeUndefined();
    // …and the composed render REALLY shows the working override (dots).
    expect((lastPreview.response as { preview: { html: string } }).preview.html).toContain("lg-steps");

    const structure = await getJson<StructureBody>(h.env, `${API}/quotes/${h.quotePublicId}/structure`);
    const arm = structure.funnels[0]!.variants.find((v) => v.public_id === forked.public_id)!;
    studio.byId("lg-funnel-design").value = arm.funnel_design_id;

    const before = studio.calls.length;
    studio.fire(studio.byId("lg-variant-save"), "click");
    await studio.settle();
    const saves = studio.calls.slice(before).filter((c) => c.method === "PUT");
    // no frame/theme edits → ONLY the variant PUT rode the save
    expect(saves.map((c) => c.url)).toEqual([`/api/admin/leadgen/variants/${forked.public_id}`]);
    expect(saves[0]!.status, JSON.stringify(saves[0]!.response)).toBe(200);
    expect((saves[0]!.body as Record<string, unknown>)["frame_overrides_json"]).toEqual({ progress: { style: "dots" } });

    const after = await getJson<StructureBody>(h.env, `${API}/quotes/${h.quotePublicId}/structure`);
    const savedArm = after.funnels[0]!.variants.find((v) => v.public_id === forked.public_id)!;
    expect(savedArm.frame_overrides_json).toEqual(studio.probe.workingOverrides);
  });
});

// ===========================================================================
// (c) C5 template switch — confirmations VERBATIM; preview-before-apply;
//     Apply adopts the server merge; Cancel touches nothing
// ===========================================================================

describeDb("quote builder EXECUTED island — (c) template-switch flow equals the server's ?switch_to= truth", () => {
  it("pick → live ?switch_to= fetch; dialog lines == server confirmations verbatim; preview carries the merged draft; nothing persists", async () => {
    const h = await studioHarness();
    const put = await admin.request(
      `${API}/funnels/${h.funnelPublicId}/frame`,
      jsonInit("PUT", { frame_config_json: { ...RICH_FRAME_CONFIG, template: "centered" } }),
      h.env,
    );
    expect(put.status, await put.clone().text()).toBe(200);

    // independent server truth for the same switch
    const serverSwitch = await getJson<{ merged: Record<string, unknown>; confirmations: string[] }>(
      h.env,
      `${API}/funnels/${h.funnelPublicId}/frame?switch_to=minimal`,
    );
    expect(serverSwitch.confirmations.length).toBeGreaterThan(0);

    const html = await editorPage(h.env, h.quotePublicId);
    const studio = await bootStudio(h.env, html);
    const before = studio.calls.length;

    // CLICK the template card through the island's delegated handler
    studio.fire(studio.root, "click", fakeTarget("data-template-pick", "minimal"));
    await studio.settle();

    const switchCall = studio.calls.slice(before).find((c) => c.url.includes("switch_to=minimal"));
    expect(switchCall, "island fetched the ?switch_to= projection").toBeDefined();
    expect(switchCall!.url).toBe(`/api/admin/leadgen/funnels/${h.funnelPublicId}/frame?switch_to=minimal`);

    // the island's pending switch IS the server merge
    expect(studio.probe.pendingSwitch).toEqual({ id: "minimal", merged: serverSwitch.merged });

    // dialog lines: VERBATIM server confirmations (C5 — the dialog names what
    // stops rendering, e.g. the trust strip + benefit bar lines)
    const list = studio.byId("lg-template-confirm-list");
    expect(list.children.map((li) => textOf(li))).toEqual(serverSwitch.confirmations);
    expect(studio.byId("lg-template-confirm").className).toBe(""); // shown

    // preview-before-apply: the canvas POST rendered the WOULD-BE merged
    // config (draft param), server-side, 200
    const previewCall = studio.calls.slice(before).find((c) => c.url.endsWith("/preview"));
    expect(previewCall, "preview-before-apply POST").toBeDefined();
    expect(previewCall!.status).toBe(200);
    expect((previewCall!.body as Record<string, unknown>)["draft_frame_config"]).toEqual(serverSwitch.merged);

    // READ-ONLY: the stored column is untouched until Save
    const stored = await getJson<FrameGetBody>(h.env, `${API}/funnels/${h.funnelPublicId}/frame`);
    expect(stored.frame_config!["template"]).toBe("centered");
    expect((stored.frame_config!["trust_strip"] as Record<string, unknown>)["enabled"]).toBe(true);

    // APPLY: the island adopts the server merge as its working config
    studio.fire(studio.byId("lg-template-apply"), "click");
    await studio.settle();
    expect(studio.probe.workingFrame).toEqual(serverSwitch.merged);
    expect(studio.probe.frameDirty).toBe(true);
    expect(studio.probe.pendingSwitch).toBeNull();
    expect(studio.byId("lg-template-confirm").className).toBe("lg-hidden");

    // CANCEL leaves the working config untouched (second pick, then cancel)
    studio.fire(studio.root, "click", fakeTarget("data-template-pick", "white-trust"));
    await studio.settle();
    expect(studio.probe.pendingSwitch?.id).toBe("white-trust");
    studio.fire(studio.byId("lg-template-cancel"), "click");
    await studio.settle();
    expect(studio.probe.pendingSwitch).toBeNull();
    expect(studio.probe.workingFrame).toEqual(serverSwitch.merged); // still the APPLIED minimal merge
  });
});

// ===========================================================================
// (d) 14 §14.2 publish chip — island derivation == server verdict/count
// ===========================================================================

describeDb("quote builder EXECUTED island — (d) publish chip equals the server activation_preflight", () => {
  it("blocked fixture: the chip the island derives from the variant-PUT verdict matches blocks+problems counts; fixing flips it to Ready", async () => {
    // blocked input: a selected Offer with a REQUIRED provider field and no
    // mapping (missing_required_provider_fields)
    const sdbBoot = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdbBoot));
    const offer = await createOfferWithRequiredField(env);
    const sectionRes = await admin.request(
      `${API}/sections`,
      jsonInit("POST", {
        section_name: "Blocked slide", activity: "quote_funnel", vertical: "life",
        headline_text: "Are you insured?", continue_mode: "button", status: "active",
        content_json: MAPPABLE_CONTENT, selected_offers: [offer.id],
      }),
      env,
    );
    expect(sectionRes.status, await sectionRes.clone().text()).toBe(201);
    const section = (await sectionRes.json()) as { id: number; public_id: string };

    const create = await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: "Chip Quote", activity: "quote_funnel", verticals: ["life"] }),
      env,
    );
    expect(create.status).toBe(201);
    const q = (await create.json()) as QuoteCreateBody;
    const variantId = q.funnels[0]!.variants[0]!.public_id;
    const seedPut = await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { sections: [{ section_id: section.id }] }), env);
    expect(seedPut.status, await seedPut.clone().text()).toBe(200);

    const html = await editorPage(env, q.public_id);
    const studio = await bootStudio(env, html);
    const structure = await getJson<StructureBody>(env, `${API}/quotes/${q.public_id}/structure`);
    studio.byId("lg-funnel-design").value = structure.funnels[0]!.variants[0]!.funnel_design_id;

    // 14 §14.2 count semantics recomputed IN THE TEST from the RAW server
    // verdict (never from island state) — the seam compares the two.
    const chipExpectation = (preflight: { ok: boolean; blocks: unknown[]; problems?: Array<{ severity: string }> }): { verdict: string; errors: number; warnings: number; text: string } => {
      const problems = preflight.problems ?? [];
      const errors = preflight.blocks.length + problems.filter((p) => p.severity === "error").length;
      const warnings = problems.filter((p) => p.severity === "warning").length;
      const text = errors > 0
        ? `Blocked (${errors} ${errors === 1 ? "error" : "errors"})`
        : warnings > 0
          ? `Ready (${warnings} ${warnings === 1 ? "warning" : "warnings"})`
          : "Ready";
      return { verdict: errors === 0 ? "ok" : "blocked", errors, warnings, text };
    };

    // --- save #1: blocked -----------------------------------------------------
    // FIX 6 gating: the variant PUT rides only when variant-scoped state is
    // dirty — touch the design select (a variant field) before each save.
    studio.fire(studio.root, "change", studio.byId("lg-funnel-design"));
    let before = studio.calls.length;
    studio.fire(studio.byId("lg-variant-save"), "click");
    await studio.settle();
    let variantPut = studio.calls.slice(before).find((c) => c.method === "PUT" && c.url.endsWith(`/variants/${variantId}`));
    expect(variantPut, "variant PUT captured").toBeDefined();
    expect(variantPut!.status, JSON.stringify(variantPut!.response)).toBe(200);
    let preflight = (variantPut!.response as Record<string, unknown>)["activation_preflight"] as { ok: boolean; blocks: Array<Record<string, unknown>>; problems?: Array<{ severity: string }> };
    expect(preflight.ok).toBe(false);
    expect(preflight.blocks.some((b) => b["code"] === "missing_required_provider_fields")).toBe(true);

    let expected = chipExpectation(preflight);
    const badge = studio.byId("lg-publish-badge");
    expect(badge.attrs["data-publish-verdict"]).toBe(expected.verdict);
    expect(badge.attrs["data-publish-errors"]).toBe(String(expected.errors));
    expect(badge.attrs["data-publish-warnings"]).toBe(String(expected.warnings));
    expect(textOf(badge)).toBe(expected.text);
    // …and the preflight panel the island rebuilt carries the server block
    const panel = studio.byId("lg-preflight-panel");
    expect(panel.attrs["data-preflight-state"]).toBe("blocked");
    expect(textOf(panel)).toContain("Cannot activate this Quote.");
    expect(textOf(panel)).toContain("Missing required provider fields");
    expect(textOf(panel)).toContain("data.zip");

    // --- fix (deselect the offer through the REAL section PATCH), save #2 -----
    const patch = await admin.request(`${API}/sections/${section.public_id}`, jsonInit("PATCH", { selected_offers: [] }), env);
    expect(patch.status, await patch.clone().text()).toBe(200);
    studio.fire(studio.root, "change", studio.byId("lg-funnel-design")); // re-arm the variant scope (FIX 6 gating)
    before = studio.calls.length;
    studio.fire(studio.byId("lg-variant-save"), "click");
    await studio.settle();
    variantPut = studio.calls.slice(before).find((c) => c.method === "PUT" && c.url.endsWith(`/variants/${variantId}`));
    expect(variantPut!.status, JSON.stringify(variantPut!.response)).toBe(200);
    preflight = (variantPut!.response as Record<string, unknown>)["activation_preflight"] as { ok: boolean; blocks: Array<Record<string, unknown>>; problems?: Array<{ severity: string }> };
    expect(preflight.ok).toBe(true);

    expected = chipExpectation(preflight);
    expect(badge.attrs["data-publish-verdict"]).toBe("ok");
    expect(badge.attrs["data-publish-errors"]).toBe("0");
    expect(badge.attrs["data-publish-warnings"]).toBe(String(expected.warnings));
    expect(textOf(badge)).toBe(expected.text);
    expect(panel.attrs["data-preflight-state"]).toBe("pass");
    expect(textOf(panel)).toContain("Ready to activate");
  });
});

// ===========================================================================
// (e) Rules builder island → hidden carrier → REAL variant PUT → evaluator
// ===========================================================================

describeDb("quote builder EXECUTED island — (e) rules builder round-trips through the real save path", () => {
  it("picker-built conditions serialize into the hidden carrier, collectRules() reads it, the PUT persists it, and the evaluator agrees", async () => {
    const h = await studioHarness();
    const html = await editorPage(h.env, h.quotePublicId);
    const studio = await bootStudio(h.env, html, { rulesIsland: true });
    const api = (studio.windowObj as { lgRulesBuilder?: Record<string, unknown> }).lgRulesBuilder as {
      mount: (container: unknown, raw: unknown, out: unknown, opts: unknown) => { state: { out: FakeNode; addBtn: FakeNode; sentenceEl: FakeNode; rows: unknown[] } };
    };

    // mount the REAL builder into a fresh container (the dynamic add-rule host
    // affordance), with the operator field vocabulary
    const container = makeNode("div");
    const mounted = api.mount(container, "", null, {
      fields: [
        { internal_field: "state", label: "State" },
        { internal_field: "age", label: "Age" },
      ],
    });
    const carrier = mounted.state.out;
    expect(carrier.attrs["data-rule-conditions"]).toBe(""); // the created hidden carrier
    expect(carrier.attrs["data-lg-rb-out"]).toBe("");
    expect(JSON.parse(carrier.value)).toEqual({ groups: [] });

    // BUILD through the real listeners: (state = CA or TX) AND (age 25–64)
    studio.fire(mounted.state.addBtn, "click"); // row 1: state eq ''
    let valueInput = findByClass(container, "lg-rb-value")[0]!;
    valueInput.value = "CA";
    studio.fire(valueInput, "input");

    const orBtn = findByClass(findByClass(container, "lg-rb-clusteractions")[0]!, "btn-outline")[0]!;
    studio.fire(orBtn, "click"); // row 2: another accepted answer for state
    valueInput = findByClass(container, "lg-rb-value")[1]!;
    valueInput.value = "TX";
    studio.fire(valueInput, "input");

    studio.fire(mounted.state.addBtn, "click"); // row 3: defaults to state — repoint to age
    const fieldSelects = findByClass(container, "lg-rb-field");
    const row3Field = fieldSelects[fieldSelects.length - 1]!;
    row3Field.value = "age";
    studio.fire(row3Field, "change");
    const opSelects = findByClass(container, "lg-rb-op");
    const row3Op = opSelects[opSelects.length - 1]!;
    row3Op.value = "range";
    studio.fire(row3Op, "change");
    const from = findByClass(container, "lg-rb-from")[0]!;
    from.value = "25";
    studio.fire(from, "input");
    const to = findByClass(container, "lg-rb-to")[0]!;
    to.value = "64";
    studio.fire(to, "input");

    // the island wrote the EXACT §21.4 JSON into the hidden carrier
    const built = JSON.parse(carrier.value) as LeadgenRuleConditions;
    expect(built).toEqual({
      groups: [
        { field: "state", op: "eq", value: "CA" },
        { field: "state", op: "eq", value: "TX" },
        { field: "age", op: "range", from: 25, to: 64 },
      ],
    });
    // …and the plain-language sentence renders the cluster semantics
    expect(textOf(mounted.state.sentenceEl)).toContain("State");
    expect(textOf(mounted.state.sentenceEl)).toContain("or");

    // wire the carrier into the quote island's rule row (the collectRules host
    // contract: one [data-rule-conditions] per [data-rule-row])
    const ruleRow = makeNode("div");
    ruleRow.sel["[data-rule-conditions]"] = carrier;
    ruleRow.sel["[data-rule-type]"] = { value: "eligibility" };
    ruleRow.sel["[data-rule-target-offer]"] = { value: "" };
    ruleRow.sel["[data-rule-priority]"] = { value: "100" };
    ruleRow.sel["[data-rule-redirect-url]"] = { value: "" };
    ruleRow.sel["[data-rule-allowlisted]"] = { checked: false };
    ruleRow.sel["[data-rule-enabled]"] = { checked: true };
    studio.byId("lg-rule-list").sel["[data-rule-row]"] = [ruleRow];

    // the REAL DOM bubbles the builder's edits up through #lg-rule-list —
    // mirror that parent chain and fire the bubbled input so the island's
    // container-scoped dirty tracking arms the variant PUT (FIX 6 gating)
    ruleRow.parentNode = studio.byId("lg-rule-list");
    carrier.parentNode = ruleRow;
    studio.fire(studio.root, "input", carrier);
    expect(studio.probe.variantDirty).toBe(true);

    // the quote island's REAL collector reads the builder's carrier
    const collected = studio.probe.collectRules();
    expect(collected).toHaveLength(1);
    expect(collected[0]!["conditions_json"]).toEqual(built);
    expect(collected[0]!["rule_type"]).toBe("eligibility");

    // REAL save path: PUT /variants/:id with the collected rules
    const structure = await getJson<StructureBody>(h.env, `${API}/quotes/${h.quotePublicId}/structure`);
    studio.byId("lg-funnel-design").value = structure.funnels[0]!.variants[0]!.funnel_design_id;
    const before = studio.calls.length;
    studio.fire(studio.byId("lg-variant-save"), "click");
    await studio.settle();
    const variantPut = studio.calls.slice(before).find((c) => c.method === "PUT" && c.url.endsWith(`/variants/${h.variantId}`));
    expect(variantPut, "variant PUT captured").toBeDefined();
    expect(variantPut!.status, JSON.stringify(variantPut!.response)).toBe(200);
    expect(((variantPut!.body as Record<string, unknown>)["rules"] as Array<Record<string, unknown>>)[0]!["conditions_json"]).toEqual(built);

    // stored truth round-trips byte-deep
    const after = await getJson<StructureBody>(h.env, `${API}/quotes/${h.quotePublicId}/structure`);
    const storedRules = after.funnels[0]!.variants[0]!.rules;
    expect(storedRules).toHaveLength(1);
    const stored = storedRules[0]!.conditions_json as LeadgenRuleConditions;
    expect(stored).toEqual(built);

    // REAL evaluator identity: stored ≡ carrier on match/non-match/absent edges
    const contexts: Array<Record<string, unknown>> = [
      { state: "CA", age: 30 },
      { state: "TX", age: 30 },
      { state: "TX", age: 70 },
      { state: "NV", age: 40 },
      { age: 30 },
      {},
    ];
    const expected = [true, true, false, false, false, false];
    for (let i = 0; i < contexts.length; i += 1) {
      expect(conditionsMatch(stored, contexts[i]!), `stored ctx ${i}`).toBe(expected[i]);
      expect(conditionsMatch(built, contexts[i]!), `carrier ctx ${i}`).toBe(expected[i]);
    }
  });
});

// ===========================================================================
// FIX 9 — renderPreview response race: two OVERLAPPING preview requests
// through the LIVE router resolve out of order (the older response is held
// back); the canvas must reflect the LAST-ISSUED request, never the stale one.
// ===========================================================================

describeDb("quote builder EXECUTED island — FIX 9: overlapping preview responses land last-issued-wins", () => {
  it("a stale (slower) preview response is dropped — the canvas shows the LAST-issued render", async () => {
    const h = await studioHarness();
    const html = await editorPage(h.env, h.quotePublicId);
    const studio = await bootStudio(h.env, html);

    // Hold back ONLY the minimal-draft preview response, so it resolves AFTER
    // the later-issued white-trust one (a genuine out-of-order interleave).
    studio.setResponseDelay((url, init) => {
      if (!url.endsWith("/preview")) return 0;
      const body = init !== undefined && typeof init.body === "string" ? init.body : "";
      return body.includes('"template":"minimal"') ? 150 : 0;
    });

    // Two template picks drive two DIRECT renderPreview calls through the
    // island's real ?switch_to= flow (no debounce between them). Fire the
    // second pick only after the first preview request is genuinely ISSUED.
    studio.fire(studio.root, "click", fakeTarget("data-template-pick", "minimal"));
    await waitFor(
      () => studio.issued.some((i) => i.url.endsWith("/preview") && i.body.includes('"template":"minimal"')),
      "minimal preview request issued",
    );
    studio.fire(studio.root, "click", fakeTarget("data-template-pick", "white-trust"));
    await studio.settle();

    // issuance order: minimal FIRST, white-trust SECOND (last-issued)
    const issueIdx = (template: string): number =>
      studio.issued.findIndex((i) => i.url.endsWith("/preview") && i.body.includes(`"template":"${template}"`));
    expect(issueIdx("minimal")).toBeGreaterThan(-1);
    expect(issueIdx("white-trust"), "white-trust preview issued after minimal").toBeGreaterThan(issueIdx("minimal"));

    // completion order: the DELAYED minimal response resolved LAST — the
    // overlap really happened (calls[] records completion order)
    const completionIdx = (template: string): number =>
      studio.calls.findIndex((c) => {
        if (!c.url.endsWith(`/variants/${h.variantId}/preview`) || c.method !== "POST") return false;
        const draft = (c.body as Record<string, unknown>)["draft_frame_config"] as Record<string, unknown> | undefined;
        return draft !== undefined && draft["template"] === template;
      });
    expect(completionIdx("white-trust")).toBeGreaterThan(-1);
    expect(completionIdx("minimal"), "stale minimal response resolved AFTER white-trust").toBeGreaterThan(
      completionIdx("white-trust"),
    );

    // last-ISSUED wins: the canvas holds the white-trust document; the stale
    // minimal response that landed last was dropped by the seq guard.
    const srcdoc = studio.byId("lg-preview-iframe").attrs["srcdoc"] ?? "";
    expect(srcdoc).toContain('data-frame-template="white-trust"');
    expect(srcdoc).not.toContain('data-frame-template="minimal"');
  });
});

// ===========================================================================
// DEV-60 (b) — quote-name inline edit. The rename is a NEW save path (its own
// immediate PATCH /quotes/:id, outside the §4.7 Save chain) — replay it from
// the booted island through the LIVE router.
// ===========================================================================

describeDb("Quote Builder studio seams — DEV-60 (b) quote-name rename PATCH", () => {
  it("Save name PATCHes /quotes/:id {quote_name} (trimmed), persists, re-renders the title, and arms NO dirty flag", async () => {
    const h = await studioHarness();
    const html = await editorPage(h.env, h.quotePublicId);
    const studio = await bootStudio(h.env, html);

    studio.byId("lg-quote-rename-input").value = "  Renamed by seam  "; // the island trims
    const before = studio.calls.length;
    studio.fire(studio.byId("lg-quote-rename-save"), "click");
    await studio.settle();

    const patches = studio.calls.slice(before).filter((c) => c.method === "PATCH");
    expect(patches.map((c) => `${c.url} ${c.status}`)).toEqual([
      `/api/admin/leadgen/quotes/${h.quotePublicId} 200`,
    ]);
    expect(patches[0]!.body).toEqual({ quote_name: "Renamed by seam" });

    // persisted server-side (live-router read-back)
    const detail = await getJson<{ quote_name: string }>(h.env, `${API}/quotes/${h.quotePublicId}`);
    expect(detail.quote_name).toBe("Renamed by seam");

    // the title re-renders from the server response; the rename's OWN save
    // path never arms the §4.7 dirty flags (beforeunload stays quiet)
    expect(textOf(studio.byId("lg-quote-title"))).toBe("Renamed by seam");
    expect(studio.byId("lg-quote-ok").textContent).toBe("Quote renamed.");
    expect(studio.probe.dirty).toBe(false);
    expect(studio.probe.variantDirty).toBe(false);
    expect(studio.probe.frameDirty).toBe(false);
    expect(studio.probe.themeDirty).toBe(false);
    expect(studio.probe.overridesDirty).toBe(false);
  });

  it("an all-whitespace name never issues a PATCH — the island surfaces the error locally", async () => {
    const h = await studioHarness();
    const html = await editorPage(h.env, h.quotePublicId);
    const studio = await bootStudio(h.env, html);

    studio.byId("lg-quote-rename-input").value = "   ";
    const before = studio.calls.length;
    studio.fire(studio.byId("lg-quote-rename-save"), "click");
    await studio.settle();

    expect(studio.calls.slice(before).filter((c) => c.method === "PATCH")).toEqual([]);
    expect(studio.byId("lg-quote-error").textContent).toBe("Quote name cannot be empty.");

    // the stored name is untouched
    const detail = await getJson<{ quote_name: string }>(h.env, `${API}/quotes/${h.quotePublicId}`);
    expect(detail.quote_name).toBe("Seam Quote");
  });
});

// ===========================================================================
// Phase D — 14 §14.2 (C2 LIVE) EXECUTED island: the activation PUT 409 body
// (report + additive problems) re-renders the preflight panel with problem
// groups + fix links; flipping compat via the REAL frame PUT downgrades the
// chrome to a warning and the SAME island save succeeds.
// ===========================================================================

// One chrome-bearing section (StepIndicator — a §8.2 scope:"frame" type).
function seedChromeSection(sdb: SqliteDb, name: string): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({
    components: [
      { type: "StepIndicator", question_id: "si1", props: { steps: 3, current: 1 } },
      { type: "QuestionHeadline", question_id: "h1", props: { text: "Where?" } },
      { type: "TwoButtonYesNo", question_id: "q1", question_key: "k", internal_field: "f1", answer_type: "boolean" },
    ],
  });
  sdb
    .prepare("INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', 'active')")
    .run(publicId, name, "Headline", content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

// The activation-row target the island's delegated handler walks: a fake row
// carrying data-site-id + the enable/slug controls, with the Save button as
// the event target.
function activationSaveTarget(siteId: string, slug: string): FakeNode {
  const row = makeNode("div");
  row.attrs["data-site-id"] = siteId;
  row.sel["[data-site-enabled]"] = { checked: true };
  row.sel["[data-site-slug]"] = { value: slug };
  const save = makeNode("button");
  save.attrs["data-save-activation"] = "";
  save.parentNode = row;
  return save;
}

// Depth-first id lookup over a built fake DOM subtree (the problem groups are
// createElement children, not registry ids).
function findById(root: unknown, id: string): FakeNode | null {
  const rec = root as { id?: string; children?: unknown[] };
  if (rec.id === id) return root as FakeNode;
  for (const c of rec.children ?? []) {
    if (c !== null && typeof c === "object") {
      const hit = findById(c, id);
      if (hit !== null) return hit;
    }
  }
  return null;
}

function findByAttr(root: unknown, attr: string, value: string, out: FakeNode[] = []): FakeNode[] {
  const rec = root as { attrs?: Record<string, string>; children?: unknown[] };
  if (rec.attrs !== undefined && rec.attrs[attr] === value) out.push(root as FakeNode);
  for (const c of rec.children ?? []) {
    if (c !== null && typeof c === "object") findByAttr(c, attr, value, out);
  }
  return out;
}

describeDb("quote builder EXECUTED island — Phase D C2 LIVE activation 409 → grouped problems render", () => {
  it("blocked PUT re-renders the panel from the 409 report+problems; the REAL compat flip downgrades to warning and the same island save succeeds", async () => {
    const h = await studioHarness();
    // grow the variant with a chrome slide + configure the frame (compat OFF)
    const chrome = seedChromeSection(h.sdb, "Chrome slide");
    const putSections = await admin.request(
      `${API}/variants/${h.variantId}`,
      jsonInit("PUT", { sections: [{ section_id: h.sections[0]!.id }, { section_id: chrome.id }] }),
      h.env,
    );
    expect(putSections.status, await putSections.clone().text()).toBe(200);
    const putFrame = await admin.request(
      `${API}/funnels/${h.funnelPublicId}/frame`,
      jsonInit("PUT", { frame_config_json: { version: 1, template: "centered" } }),
      h.env,
    );
    expect(putFrame.status, await putFrame.clone().text()).toBe(200);

    const html = await editorPage(h.env, h.quotePublicId);
    const studio = await bootStudio(h.env, html);

    // --- the island's activation Save → LIVE 409 -----------------------------
    const before = studio.calls.length;
    studio.fire(studio.byId("lg-activation-list"), "click", activationSaveTarget("site-1", "seam-blocked"));
    await studio.settle();
    const put = studio.calls.slice(before).find((c) => c.method === "PUT" && c.url.includes("/activation/site-1"));
    expect(put, "activation PUT captured").toBeDefined();
    expect(put!.status).toBe(409);
    const res = put!.response as Record<string, unknown>;
    // §14.2 endpoint shape: the EXACT historical report keys + problems.
    expect(Object.keys(res).sort()).toEqual(["blocks", "error", "funnel_id", "funnel_variant_id", "problems", "quote_id"]);
    expect(res["blocks"]).toEqual([]); // the pure C2 leg — no legacy blocks

    // the 409 did NOT change the stored activation row (slug untouched)
    const stored = h.sdb.prepare("SELECT slug FROM leadgen_site_quotes WHERE site_id = 'site-1'").get() as { slug: string };
    expect(stored.slug).toBe("seam");

    // --- the panel re-rendered BLOCKED with grouped problems + fix link ------
    const panel = studio.byId("lg-preflight-panel");
    expect(panel.attrs["data-preflight-state"]).toBe("blocked");
    const wrap = findById(panel, "lg-preflight-problems");
    expect(wrap, "problems wrap rendered").not.toBeNull();
    const sectionGroups = findByAttr(wrap!, "data-problem-scope", "section");
    expect(sectionGroups).toHaveLength(1);
    const errorRows = findByAttr(sectionGroups[0]!, "data-problem-severity", "error");
    expect(errorRows.length).toBeGreaterThan(0);
    const chromeRow = errorRows.find((r) => r.attrs["data-problem-path"] === `section.${chrome.public_id}.content`);
    expect(chromeRow, "the C2 chrome row rendered").toBeDefined();
    expect(textOf(chromeRow)).toContain("contains funnel-layout elements"); // MAJOR-1: renamed from "page-frame elements"
    // the fix_url deep link with the derived label
    const link = (chromeRow!.children as FakeNode[]).find((c) => c.tag === "a");
    expect(link, "fix link rendered").toBeDefined();
    expect(link!.attrs["href"]).toBe(`/admin/leadgen/sections/${chrome.public_id}/edit`);
    expect(textOf(link)).toBe("Review slide");
    // the publish chip flipped to the blocked verdict with the error count
    expect(studio.byId("lg-publish-badge").attrs["data-publish-verdict"]).toBe("blocked");

    // --- the REAL compat flip (Advanced legacy override) → warning + 200 -----
    const compatPut = await admin.request(
      `${API}/funnels/${h.funnelPublicId}/frame`,
      jsonInit("PUT", { frame_config_json: { version: 1, template: "centered", compat: { allow_section_chrome: true } } }),
      h.env,
    );
    expect(compatPut.status, await compatPut.clone().text()).toBe(200);

    const mid = studio.calls.length;
    studio.fire(studio.byId("lg-activation-list"), "click", activationSaveTarget("site-1", "seam-compat"));
    await studio.settle();
    const put2 = studio.calls.slice(mid).find((c) => c.method === "PUT" && c.url.includes("/activation/site-1"));
    expect(put2!.status, JSON.stringify(put2!.response)).toBe(200);
    // persisted now (the warning never blocks)
    const stored2 = h.sdb.prepare("SELECT slug, enabled FROM leadgen_site_quotes WHERE site_id = 'site-1'").get() as { slug: string; enabled: number };
    expect(stored2.slug).toBe("seam-compat");
    expect(stored2.enabled).toBe(1);
    // panel: PASS + the downgraded warning row still surfaced in its group
    expect(panel.attrs["data-preflight-state"]).toBe("pass");
    const wrap2 = findById(panel, "lg-preflight-problems");
    expect(wrap2, "warning groups still rendered").not.toBeNull();
    const warnRows = findByAttr(wrap2!, "data-problem-severity", "warning");
    expect(warnRows.some((r) => textOf(r).includes("Legacy override is ON"))).toBe(true);
    expect(findByAttr(wrap2!, "data-problem-severity", "error")).toHaveLength(0);
    expect(studio.byId("lg-publish-badge").attrs["data-publish-verdict"]).toBe("ok");
  });
});

// ===========================================================================
// Phase D — the mode:"all" lazy stepper (EXECUTED): >8 slides fetch ONE page
// per step (page:k protocol); ≤8 slides keep the eager pages[] flow with
// LOCAL stepping (no extra fetches — byte-identical Phase-B behavior).
// ===========================================================================

describeDb("quote builder EXECUTED island — Phase D lazy all-slides stepper", () => {
  const STEP_FRAME = { version: 1, template: "centered", progress: { style: "bar", show_label: true } };

  it(">8 slides: mode:'all' fetches page:1; Next fetches page:2 — one composed page per step, canvas + label follow", async () => {
    const h = await studioHarness();
    const extra: Array<{ id: number; public_id: string }> = [];
    for (let i = 3; i <= 9; i++) extra.push(seedSection(h.sdb, `Slide ${i}`));
    const putSections = await admin.request(
      `${API}/variants/${h.variantId}`,
      jsonInit("PUT", { sections: [...h.sections, ...extra].map((s) => ({ section_id: s.id })) }),
      h.env,
    );
    expect(putSections.status, await putSections.clone().text()).toBe(200);
    const putFrame = await admin.request(
      `${API}/funnels/${h.funnelPublicId}/frame`,
      jsonInit("PUT", { frame_config_json: STEP_FRAME }),
      h.env,
    );
    expect(putFrame.status, await putFrame.clone().text()).toBe(200);

    const html = await editorPage(h.env, h.quotePublicId);
    const studio = await bootStudio(h.env, html);

    const before = studio.calls.length;
    studio.fire(studio.root, "click", fakeTarget("data-preview-mode-btn", "all"));
    await studio.settle();
    const first = studio.calls.slice(before).filter((c) => c.url.endsWith("/preview"));
    expect(first).toHaveLength(1);
    const firstBody = first[0]!.body as Record<string, unknown>;
    expect(firstBody["mode"]).toBe("all");
    expect(firstBody["page"]).toBe(1); // 10 slides > the 8-slide threshold → lazy
    const firstPreview = (first[0]!.response as { preview: Record<string, unknown> }).preview;
    expect(firstPreview["page"]).toBe(1);
    expect(firstPreview["pages"]).toBeUndefined(); // ONE page, not all ten
    // §4.3-11: studioHarness's 2 own sections + 7 extra (i=3..9) + the quote's
    // 1 shared-page section (seeded by studioHarness too) = 10.
    expect(firstPreview["section_count"]).toBe(10);
    expect(studio.byId("lg-preview-iframe").attrs["srcdoc"]).toContain("Step 1 of 10");
    expect(textOf(studio.byId("lg-step-label"))).toBe("Slide 1 of 10");

    // Next → a NEW lazy fetch for page 2 (the eager flow would swap locally)
    const mid = studio.calls.length;
    studio.fire(studio.byId("lg-step-next"), "click");
    // label-after-response ordering: the click issues the per-step fetch but
    // the label must NOT move optimistically — a promise can never resolve
    // synchronously, so right here the page-2 response has not landed and
    // the label still names the CURRENT step (it updates in renderPreview's
    // completion path, together with the canvas).
    expect(textOf(studio.byId("lg-step-label")), "label unchanged while the page-2 fetch is in flight").toBe(
      "Slide 1 of 10",
    );
    await studio.settle();
    const second = studio.calls.slice(mid).filter((c) => c.url.endsWith("/preview"));
    expect(second).toHaveLength(1);
    expect((second[0]!.body as Record<string, unknown>)["page"]).toBe(2);
    const secondPreview = (second[0]!.response as { preview: Record<string, unknown> }).preview;
    expect(secondPreview["page"]).toBe(2);
    const srcdoc = studio.byId("lg-preview-iframe").attrs["srcdoc"] ?? "";
    expect(srcdoc).toContain("Step 2 of 10");
    expect(srcdoc).toContain(String(secondPreview["html"]).slice(0, 120)); // the canvas holds the served page
    expect(textOf(studio.byId("lg-step-label"))).toBe("Slide 2 of 10");
  });

  it("≤8 slides: the eager pages[] flow is untouched — no page param, Next steps LOCALLY with zero extra fetches", async () => {
    // §4.3-11: studioHarness's 2 own sections + the quote's 1 shared-page
    // section (studioHarness seeds one too) = 3 slides — still ≤8 (eager).
    const h = await studioHarness();
    const putFrame = await admin.request(
      `${API}/funnels/${h.funnelPublicId}/frame`,
      jsonInit("PUT", { frame_config_json: STEP_FRAME }),
      h.env,
    );
    expect(putFrame.status, await putFrame.clone().text()).toBe(200);

    const html = await editorPage(h.env, h.quotePublicId);
    const studio = await bootStudio(h.env, html);

    const before = studio.calls.length;
    studio.fire(studio.root, "click", fakeTarget("data-preview-mode-btn", "all"));
    await studio.settle();
    const first = studio.calls.slice(before).filter((c) => c.url.endsWith("/preview"));
    expect(first).toHaveLength(1);
    expect((first[0]!.body as Record<string, unknown>)["page"]).toBeUndefined(); // eager — byte-identical Phase B
    const preview = (first[0]!.response as { preview: { pages?: string[] } }).preview;
    expect(preview.pages).toHaveLength(3);
    expect(textOf(studio.byId("lg-step-label"))).toBe("Slide 1 of 3");

    // Next swaps the LOCAL page — zero additional fetches
    const count = studio.calls.length;
    studio.fire(studio.byId("lg-step-next"), "click");
    await studio.settle();
    expect(studio.calls.length).toBe(count);
    expect(textOf(studio.byId("lg-step-label"))).toBe("Slide 2 of 3");
    expect(studio.byId("lg-preview-iframe").attrs["srcdoc"]).toContain("Step 2 of 3");
  });
});

// ===========================================================================
// Phase D — DEV-66 routing (EXECUTED): the Quote-Builder canvas mobile toggle
// drives the REAL 375px iframe (the preview-drawer idiom) — the composed
// document rides srcdoc inside an iframe whose element width becomes 375px,
// so the design's @media (max-width: 480px) block genuinely fires at mobile
// width (an inline injection into the wide admin DOM never could).
// ===========================================================================

describeDb("quote builder EXECUTED island — DEV-66 canvas mobile = real 375 iframe", () => {
  it("the mobile toggle re-renders the srcdoc iframe at width 375px (desktop 1280px) with the mobile media query aboard", async () => {
    const h = await studioHarness();
    const putFrame = await admin.request(
      `${API}/funnels/${h.funnelPublicId}/frame`,
      jsonInit("PUT", { frame_config_json: { version: 1, template: "centered" } }),
      h.env,
    );
    expect(putFrame.status, await putFrame.clone().text()).toBe(200);

    const html = await editorPage(h.env, h.quotePublicId);
    const studio = await bootStudio(h.env, html);
    const canvas = studio.byId("lg-preview-iframe");

    // boot renders desktop
    expect(canvas.style["width"]).toBe("1280px");

    studio.fire(studio.root, "click", fakeTarget("data-viewport-btn", "mobile"));
    await studio.settle();
    // the REAL iframe narrows to 375 — its internal viewport is 375px, so the
    // srcdoc's own media query evaluates true at mobile width
    expect(canvas.style["width"]).toBe("375px");
    const srcdoc = canvas.attrs["srcdoc"] ?? "";
    expect(srcdoc).toContain("<style>"); // srcdoc is a full document with the style block
    expect(srcdoc).toMatch(/@media \(max-width: ?480px\)/); // the design's mobile block rides INSIDE the iframe

    // back to desktop — unchanged behavior
    studio.fire(studio.root, "click", fakeTarget("data-viewport-btn", "desktop"));
    await studio.settle();
    expect(canvas.style["width"]).toBe("1280px");
  });
});

// ===========================================================================
// Phase E (slice E4) — EXECUTED canvas click-walk: the background region is
// reachable through the canvas. The served `.lg-frame-background` layer is
// pointer-events:none BEHIND the content (frame CSS: layer z-index 0 under
// region z-index 1), so a bare-canvas click always targets #lg-funnel-root
// itself (the E1-measured defect: "…intercepts pointer events") — the
// island's walk-miss fallback must resolve that click to `background`
// (04 §4.1 click-select → §4.4 Background inspector) while a real region hit
// and the slot-interior banner keep precedence.
// ===========================================================================

// Minimal click-chain node for the composed document (getAttribute +
// parentNode are all onCanvasClick walks; className is what outlineSelection
// writes).
function clickNode(attrs: Record<string, string>, parent: unknown = null): {
  parentNode: unknown;
  className: string;
  getAttribute(n: string): string | null;
} {
  const node = {
    parentNode: parent,
    className: "",
    getAttribute(n: string) { return Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n]! : null; },
  };
  return node;
}

describeDb("quote builder EXECUTED island — E4 bare canvas clicks resolve to the background region", () => {
  it("a #lg-funnel-root / empty-area click selects `background` and opens its inspector; a real region still wins; slot-interior still banners", async () => {
    const h = await studioHarness();
    const putFrame = await admin.request(
      `${API}/funnels/${h.funnelPublicId}/frame`,
      jsonInit("PUT", { frame_config_json: { version: 1, template: "centered" } }),
      h.env,
    );
    expect(putFrame.status, await putFrame.clone().text()).toBe(200);

    const html = await editorPage(h.env, h.quotePublicId);
    const studio = await bootStudio(h.env, html);
    const canvas = studio.byId("lg-preview-iframe");

    // the inspector panels showRegionPanel() toggles (root.querySelectorAll)
    const panelNames = ["header", "progress", "background", "section_slot"];
    const panels = panelNames.map((name) => {
      const p = makeNode("div");
      p.attrs["data-region-panel"] = name;
      p.className = "lg-inspector-panel lg-panel-card";
      return p;
    });
    studio.root.sel["[data-region-panel]"] = panels;
    const panelOf = (name: string): FakeNode => panels[panelNames.indexOf(name)]!;

    // the composed document, exactly the renderQuoteFrame nesting: body →
    // #lg-funnel-root (data-frame-template, NO data-frame-region) containing
    // the aria-hidden background layer (never a click target —
    // pointer-events:none), a content region, and the section slot with a
    // swapped section inside.
    const iframeBody = clickNode({});
    const funnelRoot = clickNode({ "data-frame-template": "centered" }, iframeBody);
    const bgLayer = clickNode({ "data-frame-region": "background" }, funnelRoot);
    const progressRegion = clickNode({ "data-frame-region": "progress" }, funnelRoot);
    const progressInner = clickNode({}, progressRegion); // e.g. the track div
    const slotRegion = clickNode({ "data-frame-region": "section_slot" }, funnelRoot);
    const sectionInner = clickNode({ "data-lg-section": "s1" }, slotRegion);
    const docHandlers: Record<string, Array<(ev?: unknown) => unknown>> = {};
    const fakeDoc = {
      addEventListener(t: string, f: (ev?: unknown) => unknown) { (docHandlers[t] = docHandlers[t] ?? []).push(f); },
      querySelectorAll(sel: string) { return sel === "[data-frame-region]" ? [bgLayer, progressRegion, slotRegion] : []; },
    };
    (canvas as unknown as { contentDocument: unknown }).contentDocument = fakeDoc;
    studio.fire(canvas, "load"); // the island wires onCanvasClick onto the doc
    expect(docHandlers["click"]?.length, "canvas click delegation registered").toBe(1);
    const clickDoc = (target: unknown): void => {
      for (const f of docHandlers["click"] ?? []) f({ target, preventDefault() { /* noop */ } });
    };
    const hint = studio.byId("lg-inspector-hint");
    const banner = studio.byId("lg-slot-banner");

    // (1) bare click on #lg-funnel-root (the measured real-world target) →
    // background selected, its §4.4 panel active, hint hidden, the canvas
    // outline marks the background layer.
    clickDoc(funnelRoot);
    expect(studio.probe.selectedRegion).toBe("background");
    expect(panelOf("background").className).toBe("lg-inspector-panel lg-panel-card active");
    expect(panelOf("progress").className).toBe("lg-inspector-panel lg-panel-card");
    expect(hint.hidden, "inspector hint hides once a region is selected").toBe(true);
    expect(bgLayer.className).toContain("lg-region-sel");
    expect(progressRegion.className).not.toContain("lg-region-sel");

    // (1b) a click outside the root entirely (iframe body) resolves the same
    clickDoc(iframeBody);
    expect(studio.probe.selectedRegion).toBe("background");

    // (2) a click INSIDE a real region still wins over the fallback
    clickDoc(progressInner);
    expect(studio.probe.selectedRegion).toBe("progress");
    expect(panelOf("progress").className).toBe("lg-inspector-panel lg-panel-card active");
    expect(panelOf("background").className).toBe("lg-inspector-panel lg-panel-card");
    expect(progressRegion.className).toContain("lg-region-sel");
    expect(bgLayer.className).not.toContain("lg-region-sel");

    // (3) slot-interior click still shows the §4.1 banner and does NOT
    // reroute the selection (precedence unchanged)
    clickDoc(sectionInner);
    expect(banner.className).toBe("lg-slot-banner");
    expect(studio.probe.selectedRegion, "banner path never re-selects").toBe("progress");

    // (4) a following bare click hides the banner and lands on background
    clickDoc(funnelRoot);
    expect(banner.className).toBe("lg-slot-banner lg-hidden");
    expect(studio.probe.selectedRegion).toBe("background");
    expect(panelOf("background").className).toBe("lg-inspector-panel lg-panel-card active");
  });
});
