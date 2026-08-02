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
  clientEffective(): Record<string, unknown>;
  currentTemplateId(): string;
  collectRules(): Array<Record<string, unknown>>;
  collectSections(): Array<Record<string, unknown>>;
}

// ES5 exporter source (getters over island locals — NOT an eval bridge).
// P7 D2 fallout: draftFrameConfig / draftTheme / pendingSwitch are NOT here
// any more — 87f64f0 deleted the funnel studio's dead §4.1 canvas (and, in the
// §10/S5.1 sweep before it, the canvas-embedded template picker), so those
// three island locals no longer exist and a getter over them would throw a
// ReferenceError the moment a seam touched it. What the island still owns —
// workingFrame/workingTheme/workingOverrides and the dirty flags — is
// unchanged, and every invariant the removed accessors used to observe is
// re-observed below through the surviving composed-preview endpoint.
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
  clientEffective: function () { return clientEffective(); },
  currentTemplateId: function () { return currentTemplateId(); },
  collectRules: function () { return collectRules(); },
  collectSections: function () { return collectSections(); }
});
`;

interface Studio {
  registry: Map<string, FakeNode>;
  root: FakeNode;
  calls: CapturedCall[];
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
  // LEADGEN-REWORK-03 P3b RETIREMENT (§8.2/§10): the OLD structure-panel /
  // funnel-settings ids below are GENUINELY ABSENT from the served page now
  // (the §8.2 board replaces the structure panel; the funnel-settings
  // controls are a separate CONTRACT GAP — see the phase report). A REAL
  // browser's document.getElementById returns null for every one of these,
  // and the island's OWN collectPayload() is already null-guarded for
  // exactly this (byId(...) ?? no-op). This harness's documentObj.
  // getElementById MUST mirror that null, matching the SAME established
  // idiom "lg-rules-builder-root" already used here ("seam (e) uses mount(),
  // not the SSR panel init") — auto-vivifying a fake node for these ids
  // would make the island take its "old DOM present" branch and send a
  // WRONG (data-losing) PUT body, which is exactly the money-path bug
  // collectPayload's null-guards exist to prevent in production.
  // P7 D2 (87f64f0): lg-preview-iframe/lg-canvas-toolbar/lg-inspector-column
  // ARE in this list now. They used to be held back because three OTHER seams
  // here (the Phase D lazy stepper, the DEV-66 mobile toggle, the E4
  // click-delegation) drove the island's canvas functions in isolation and
  // needed a fake node to observe srcdoc/aria-pressed writes. Those functions
  // no longer exist — 87f64f0 deleted the whole frame-studio island once its
  // DOM had been gone since the P3b board rewrite — and all three seams are
  // retired below with their own citations, so auto-vivifying these ids would
  // now do exactly what this list exists to prevent: hand the island a DOM the
  // real page does not have. (§10/S5.1: FIX 9, formerly also called out here,
  // is RETIRED — its dead-template-pick trigger is gone, see that describe
  // block's own retirement note.)
  const explicitNull = new Set([
    "lg-preview-iframe",
    "lg-canvas-toolbar",
    "lg-inspector-column",
    "lg-rules-builder-root",
    "lg-section-list",
    "lg-add-section",
    "lg-rule-list",
    "lg-add-rule",
    "lg-funnel-design",
    "lg-auction-id",
    "lg-lander-enabled",
    "lg-lander-headline",
    "lg-lander-sub",
    "lg-lander-hero",
  ]);
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
  const fetchImpl = (url: string, init?: RequestInit): Promise<Response> => {
    pendingFetches += 1;
    return Promise.resolve(admin.request(url, init ?? {}, env)).then(
      async (res: Response) => {
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
    windowObj,
    probe: probeRef!,
    settle,
    fire,
    byId,
  };
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

    // RE-CHANNELLED (P7 D2 fallout / R2): this used to observe the island's
    // OWN boot preview POST (draftFrameConfig() -> POST /variants/:id/preview
    // -> #lg-preview-iframe srcdoc). 87f64f0 deleted that whole flow: the P3b
    // board rewrite had already removed its DOM, so the POST was firing into a
    // null iframe. The INVARIANT is still live and is NOT dropped — the state
    // this island decodes must be exactly what the composer accepts and
    // renders — so it is re-observed on the surviving path: the island's own
    // decoded frame (the probe, never a hand-built copy) is posted to the same
    // live composed endpoint the Templates canvas uses.
    // Asserted before: POST captured · 200 · mode 'section' ·
    //   body.draft_frame_config == probe.draftFrameConfig() ·
    //   draft_frame_overrides undefined · srcdoc contains data-frame-region.
    // Asserted now: the same 200 · the same data-frame-region in the composed
    //   document · the DEV-58 conditionality at its source (overridesDirty is
    //   false on a clean boot, which is WHY no override param was sent) ·
    //   plus the composed page really carries the decoded template.
    expect(studio.probe.overridesDirty, "clean boot has no unsaved override edits").toBe(false);
    const islandDraft: Record<string, unknown> = {
      ...(studio.probe.workingFrame as Record<string, unknown>),
      version: 1,
      template: studio.probe.currentTemplateId(),
    };
    const composed = await admin.request(
      `${API}/variants/${h.variantId}/preview`,
      jsonInit("POST", { mode: "section", viewport: "desktop", draft_frame_config: islandDraft }),
      h.env,
    );
    expect(composed.status, await composed.clone().text()).toBe(200);
    const composedBody = (await composed.json()) as { preview: { html: string } };
    expect(composedBody.preview.html).toContain("data-frame-region");
    expect(composedBody.preview.html).toContain('data-frame-template="header-cta"');
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
    // LEADGEN-REWORK-03 P3b RETIREMENT + money-path HARDENING (§8.2/§10):
    // funnel_design_id/auction_id/lander_*/sections have NO current admin
    // surface (verified contract gap, see the phase report) and rules has
    // no current admin surface either (the OLD per-variant hidden grid is
    // gone, §5-M3/§13-D5 — S3b.2's quote-scoped rail is the replacement,
    // covered by its own test files). collectPayload's money-path hardening
    // (this round's fix) means the variant PUT now includes a key ONLY when
    // its OWN control genuinely exists — with none of them present, the PUT
    // body is correctly EMPTY (an intentional no-data-loss no-op, not a bug):
    // sending {} changes nothing server-side, which is exactly right since
    // nothing about the funnel-design/rules/sections state actually changed
    // through any REAL control in this edit sequence.
    expect(Object.keys(variantBody)).toEqual([]);
    // untouched overrides NEVER ride the PUT (additive §4.5 contract)
    expect(variantBody["frame_overrides_json"]).toBeUndefined();
    // sections is no longer IN the PUT body at all (see the citation above) —
    // the STRONGER, real guarantee (the DB still has the ORIGINAL sections,
    // untouched, proving the money-path hardening lost no data) is verified
    // below via the server-truth /structure re-fetch (line "after.funnels…").

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
    // RE-CHANNELLED (P7 D2 fallout / R2): the debounced preview POST that used
    // to carry that param died with the funnel studio's dead §4.1 canvas
    // (87f64f0 — the DOM was already gone, the POSTs fired into a null
    // iframe). The invariant is NOT dropped: the island's WORKING (unsaved)
    // override must really compose — dots, not the stored bar — while never
    // folding into the funnel frame. Re-observed by posting the island's OWN
    // working state to the same live composed endpoint.
    // Asserted before: last preview POST 200 · body.draft_frame_overrides ==
    //   {progress:{style:'dots'}} · body.draft_frame_config.progress undefined
    //   · response html contains 'lg-steps'.
    // Asserted now: the same three, from the probe's own state, plus
    //   overridesDirty (the flag that gates sending the param at all).
    expect(studio.probe.overridesDirty, "the arm has unsaved override edits").toBe(true);
    const forkedDraft: Record<string, unknown> = {
      ...(studio.probe.workingFrame as Record<string, unknown>),
      version: 1,
      template: studio.probe.currentTemplateId(),
    };
    expect(forkedDraft["progress"], "the override never folds into the funnel frame").toBeUndefined();
    const composed = await admin.request(
      `${API}/variants/${forked.public_id}/preview`,
      jsonInit("POST", {
        mode: "section",
        viewport: "desktop",
        draft_frame_config: forkedDraft,
        draft_frame_overrides: studio.probe.workingOverrides,
      }),
      h.env,
    );
    expect(composed.status, await composed.clone().text()).toBe(200);
    expect(((await composed.json()) as { preview: { html: string } }).preview.html).toContain("lg-steps");

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

// §10/S5.1 RETIREMENT: this ENTIRE seam drove the OLD canvas-embedded
// 6-arrangement template picker (togglePanel/#lg-template-btn/
// #lg-template-picker, the data-template-pick card click handler,
// showTemplateConfirm/hideTemplateConfirm/#lg-template-confirm(-list),
// #lg-template-apply/#lg-template-cancel, the pendingSwitch state) —
// renderTemplatePicker (its ONLY render source, quotes-tabs/shared.ts) had
// ZERO real callers anywhere in the admin/leadgen namespace (confirmed by
// exhaustive grep, same discipline as the (e) rules-builder retirement
// above), so none of its trigger/target elements, nor the JS that used to
// wire them, exist in the product anymore — deleted in the same sweep.
// test/leadgen-quote-builder-ui.test.ts ALREADY carried (and still passes) a
// dedicated absence-proof for this exact retirement — "the OLD
// canvas-embedded template picker is gone (§10: 'canvas template picker'
// explicitly removed)" — whose own citation is the authoritative pointer:
// "the board's own per-funnel template pickchip (data-template-picker) opens
// a popover of the quote's SAVED templates — a different control entirely,
// proven by the board gesture spec." The underlying SERVER endpoint
// (GET /funnels/:id/frame?switch_to=) keeps its OWN direct, unaffected proof
// in that same file's "GET /funnels/:id/frame?switch_to (04 §4.3, C5)"
// describe block — the C5 read-only projection + confirmations mechanism
// this seam used to drive through the retired client is still verified,
// just no longer through a dead client trigger.
describeDb("quote builder EXECUTED island — (c) template-switch flow [RETIRED: §10/S5.1, OLD canvas-embedded picker gone]", () => {
  it("the OLD template-pick DOM/state has no current admin surface (see describe-block citation)", async () => {
    const h = await studioHarness();
    const html = await editorPage(h.env, h.quotePublicId);
    expect(html).not.toContain('id="lg-template-picker"');
    expect(html).not.toContain('id="lg-template-confirm"');
    expect(html).not.toContain('data-template-pick="centered"');
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
    // P0 S0-B1 fix-round: this fixture predates the rework §4.3-15 activation
    // gate (default funnel / shared first page / etc — quotes-handlers.ts's
    // computeReworkActivationProblems, now ALSO folded into the variant-save
    // advisory preflight storeVariantPreflight() returns, matching the real
    // activation-PUT gate). Without a shared-page section this quote would
    // stay blocked on activation.shared_page even after the offer fix below,
    // which is not what THIS test is exercising (the offer-mapping block/fix
    // cycle) — seed it the same way studioHarness() already does for every
    // other test in this file, so the fixture is genuinely well-formed under
    // the corrected semantics and "fixing" the offer alone reaches Ready.
    seedSharedPageSection(sdbBoot, q.id);

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

// LEADGEN-REWORK-03 M3/§13-D5 RETIREMENT: this ENTIRE seam tested the OLD
// per-variant hidden rules grid (id="lg-rule-list", one [data-rule-row] per
// leadgen_funnel_rules row, renderRuleRow/renderRulesPanel) round-tripping a
// B3-builder-authored condition through collectRules() -> PUT /variants/:id.
// That grid is GONE — quotes-handlers.ts's leadgen_funnel_rules CHECK is now
// tightened to the four auction-domain types only (eligibility/
// disqualification/redirect_direct_offer/auction_entry), whose UI relocated
// to the Auction tab (ui-auctions.ts "Funnel eligibility rules" panel); the
// quote-scoped, multi-action routing rules this board's §8.2 RIGHT rail
// manages are an entirely DIFFERENT table (leadgen_quote_routing_rules) with
// their OWN round-trip proof. Attempting to keep this seam alive by
// hand-simulating a #lg-rule-list DOM structure the real page can no longer
// produce would test a code path a real operator can never reach (verified:
// the crash --  document.querySelector is not a function -- surfaces deeper
// unreachable-code interactions once the grid's container is null, the SAME
// P5 orphan-scan territory as the OTHER dead-DOM references this phase found).
// Replacement coverage: test/leadgen-rework-rules-ui.test.ts (SSR + ES5 island
// proofs for QUOTE_RULES_SCRIPT, incl. its OWN condition-builder round trip)
// + test-ui/leadgen-rework-p3b-rules.gesture.spec.ts (live gestures).
describeDb("quote builder EXECUTED island — (e) rules builder [RETIRED: M3/§13-D5, OLD per-variant grid gone]", () => {
  it("the OLD per-variant hidden rules grid has no current admin surface (see describe-block citation)", async () => {
    const h = await studioHarness();
    const html = await editorPage(h.env, h.quotePublicId);
    expect(html).not.toContain('id="lg-rule-list"');
    expect(html).not.toContain('id="lg-add-rule"');
  });
});

// ===========================================================================
// FIX 9 — renderPreview response race: two OVERLAPPING preview requests
// through the LIVE router resolve out of order (the older response is held
// back); the canvas must reflect the LAST-ISSUED request, never the stale one.
// ===========================================================================

// §10/S5.1 RETIREMENT: this test's ONLY trigger was two `data-template-pick`
// clicks driving two DIRECT renderPreview(draftF) calls through the OLD
// canvas-embedded template-switch dialog's preview-before-apply step — the
// SAME dead mechanism retired in describe-block (c) above (renderTemplatePicker
// had zero real callers; deleted from quotes-tabs/shared.ts in this sweep).
// IMPORTANT — this is NOT a claim that the thing under test is gone: the
// `previewSeq` monotonic-sequence guard inside renderPreview() (quotes-tabs/
// funnel.ts, "Monotonic render-request sequence...") is UNTOUCHED, still
// shipped, and still runs on EVERY schedulePreview()/renderPreview() call
// site that remains live today (viewport toggle, slide selection, theme
// edits, the Phase D lazy stepper, etc. — all still real, still tested for
// their OWN basic behavior elsewhere in this file/suite). What is gone is
// only the ONE trigger this specific test used to manufacture a genuine
// out-of-order interleave (setResponseDelay + two data-template-pick clicks).
// HONEST GAP (not silently dropped): grep across test/ and test-ui/ at the
// time of this retirement found NO other test that drives two overlapping
// preview requests through a LIVE trigger and asserts last-issued-wins — the
// previewSeq guard's stale-response-rejection behavior itself is currently
// UNVERIFIED by any live-triggered test after this retirement. Reintroducing
// this exact interleaving proof through a live trigger (e.g. two rapid
// `data-viewport-btn` clicks, which also call schedulePreview() with a
// distinguishable `viewport` field per request) is a legitimate follow-up,
// out of scope for this removal-sweep pass. The Studio harness's dedicated
// `issued`/`setResponseDelay` fields and the standalone `waitFor` poller
// (both ONLY ever consumed by this test) were removed with it — a future
// interleaving test re-adds the same shape (issuance-order array + a
// per-response delay hook + a poll-until helper) rather than resurrecting
// unused scaffolding now.
describeDb("quote builder EXECUTED island — FIX 9: overlapping preview responses [RETIRED: §10/S5.1, dead data-template-pick trigger — see coverage-gap note]", () => {
  it("the OLD template-pick trigger this race depended on has no current admin surface, though the previewSeq guard code itself still ships", async () => {
    const h = await studioHarness();
    const html = await editorPage(h.env, h.quotePublicId);
    expect(html).not.toContain('data-template-pick="minimal"');
    expect(html).toContain("previewSeq"); // the guard mechanism itself is untouched
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
//
// P7 D2 RETIREMENT (commit 87f64f0, conformance sweep §4): both cases drove
// the funnel studio's CLIENT stepper — [data-preview-mode-btn], #lg-step-next,
// #lg-step-label, #lg-preview-iframe. The P3b board rewrite (§8.2/§10) deleted
// that canvas DOM; 87f64f0 then deleted the orphaned island code (schedule/
// renderPreview, the page cursor, updateStepLabel) that was still POSTing into
// a null iframe. There is no client stepper on any surviving surface — the
// Templates tab's live canvas is a single mode:'section' render with no
// step controls — so these two cases can no longer be driven at all.
// WHAT STILL COVERS THE CLAIM: the page:k protocol they exercised is SERVER
// behaviour and is proven directly, per-byte, in
// test/leadgen-preview-modes.test.ts — ">8 sections: page:k ≡ the eager
// pages[k-1] byte-for-byte, with section_count + clamping", "≤8 sections: the
// eager pages[] shape is byte-identical (no page key) and page:k still equals
// its eager page", "rejects malformed page params: non-integer / <1 / wrong
// mode → 400 fields" and "mode:'all' → pages[]: one composed document per
// Section with correct per-step progress values".
// ===========================================================================

describeDb("quote builder EXECUTED island — Phase D lazy all-slides stepper [RETIRED: P7 D2/§8.2, the client stepper + canvas are gone]", () => {
  it("the OLD stepper DOM/ids have no current admin surface (see describe-block citation)", async () => {
    const h = await studioHarness();
    const html = await editorPage(h.env, h.quotePublicId);
    expect(html).not.toContain('id="lg-preview-iframe"');
    expect(html).not.toContain('id="lg-step-next"');
    expect(html).not.toContain('id="lg-step-label"');
    // the MARKUP form (a valued attribute), never the bare name: 87f64f0's own
    // removal note inside the island source still SPELLS these ids/attributes
    // when it explains what went — a comment is not a surface.
    expect(html).not.toContain('data-preview-mode-btn="all"');
    expect(html).not.toContain('data-preview-mode-btn="section"');
    // …and the island that drove them is gone too (no orphaned POST source).
    expect(html).not.toContain("updateStepLabel(");
    expect(html).not.toContain("lazyAllMode(");
  });
});


// ===========================================================================
// Phase D — DEV-66 routing (EXECUTED): the Quote-Builder canvas mobile toggle
// drives the REAL 375px iframe (the preview-drawer idiom) — the composed
// document rides srcdoc inside an iframe whose element width becomes 375px,
// so the design's @media (max-width: 480px) block genuinely fires at mobile
// width (an inline injection into the wide admin DOM never could).
//
// P7 D2 RETIREMENT (commit 87f64f0, conformance sweep §4): the toggle this
// drove — [data-viewport-btn] writing #lg-preview-iframe's element width and
// re-POSTing viewport:'mobile' — belonged to the funnel studio's §4.1 canvas.
// The P3b board rewrite (§8.2/§10) deleted that DOM; 87f64f0 deleted the
// orphaned island (setCanvasDoc, the viewport state, the re-render) that was
// still writing srcdoc onto a null element. The surviving Quote-Builder
// preview — the Templates tab's live canvas — has NO viewport toggle: it
// renders one desktop composition, so there is no toggle left to drive.
// WHAT STILL COVERS THE CLAIM: the viewport half of the composed contract is
// server behaviour, proven in test/leadgen-preview-modes.test.ts — "rejects
// malformed v2.5 params with 400 fields (mode/viewport/site_id types)", whose
// last leg posts viewport:'mobile' and asserts 200; the design's own
// @media (max-width: 480px) block is pinned in
// test/leadgen-rework-render.test.ts, and the REAL 375px preview-drawer iframe
// idiom keeps its driven proof in the Section Builder's own
// test/leadgen-section-preview-frame.test.ts.
// ===========================================================================

describeDb("quote builder EXECUTED island — DEV-66 canvas mobile [RETIRED: P7 D2/§8.2, the canvas + viewport toggle are gone]", () => {
  it("the OLD viewport toggle and its canvas have no current admin surface (see describe-block citation)", async () => {
    const h = await studioHarness();
    const html = await editorPage(h.env, h.quotePublicId);
    // the MARKUP form (a valued attribute), never the bare name: 87f64f0's own
    // removal note inside the island source still SPELLS these when it
    // explains what went — a comment is not a surface.
    expect(html).not.toContain('data-viewport-btn="mobile"');
    expect(html).not.toContain('data-viewport-btn="desktop"');
    expect(html).not.toContain('id="lg-preview-iframe"');
    expect(html).not.toContain('id="lg-canvas-status"');
    // the SURVIVING preview canvas is the Templates tab's, and it is real
    expect(html).toContain('id="lg-tpl-canvas-iframe"');
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

// P7 D2 RETIREMENT (commit 87f64f0, conformance sweep §4): this seam drove
// onCanvasClick — the click delegation the island wired onto
// #lg-preview-iframe's contentDocument on 'load' — plus outlineSelection,
// showRegionPanel, #lg-inspector-hint and #lg-slot-banner. Every one of those
// belonged to the funnel studio's §4.1 canvas: the P3b board rewrite
// (§8.2/§10) deleted the DOM, and 87f64f0 deleted the orphaned island code,
// so there is no canvas to click into and no click handler to register (the
// measured failure here was exactly that: "canvas click delegation
// registered: expected undefined to be 1"). Click-to-select is not how a
// region is chosen any more.
// WHAT STILL COVERS THE CLAIM: the §4.4 Background inspector — the thing this
// click-walk existed to reach — is now opened by the Templates tab's element
// box picker (data-tplbox-pick="background" -> data-tplbox-panel="background"),
// whose tile census + editor wiring is pinned in
// test/leadgen-element-j-r2.test.ts ("the footer tile is lettered J, sits
// LAST, and neither A–F nor I·Progress moved", which asserts the exact
// "A:Background" tile), and the absence of the retired chrome is pinned in
// test/leadgen-quote-builder-ui.test.ts ("the OLD canvas toolbar is gone",
// "the OLD section-slot interior banner is gone").
// ===========================================================================

describeDb("quote builder EXECUTED island — E4 canvas click-walk [RETIRED: P7 D2/§8.2, no canvas to click into]", () => {
  it("the OLD canvas click surface has no current admin surface (see describe-block citation)", async () => {
    const h = await studioHarness();
    const html = await editorPage(h.env, h.quotePublicId);
    expect(html).not.toContain('id="lg-preview-iframe"');
    expect(html).not.toContain('id="lg-slot-banner"');
    expect(html).not.toContain('id="lg-inspector-hint"');
    expect(html).not.toContain("onCanvasClick(");
    expect(html).not.toContain("outlineSelection(");
    // the surviving route to the same §4.4 Background inspector
    expect(html).toContain('data-tplbox-pick="background"');
    expect(html).toContain('data-tplbox-panel="background"');
  });
});
