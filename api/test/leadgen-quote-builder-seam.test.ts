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
//       evaluates IDENTICALLY via the real evaluator (conditionsMatch).
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
  public_id: string;
  funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
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
  dirty: boolean;
  isControl: boolean;
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
  get dirty() { return dirty; },
  get isControl() { return isControl; },
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

  return { registry, root, calls, windowObj, probe: probeRef!, settle, fire, byId };
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
      is_control: boolean;
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
    // island's draft fold + the first slide of the PERSISTED order
    const boot = studio.calls.find((c) => c.url.endsWith(`/variants/${h.variantId}/preview`));
    expect(boot, "boot preview POST captured").toBeDefined();
    expect(boot!.status).toBe(200);
    const bootBody = boot!.body as Record<string, unknown>;
    expect(bootBody["mode"]).toBe("section");
    expect(bootBody["section_public_id"]).toBe(h.sections[0]!.public_id);
    expect(bootBody["draft_frame_config"]).toEqual(studio.probe.draftFrameConfig());
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

    // SSR-faithful funnel-settings value for collectPayload()
    studio.byId("lg-funnel-design").value = variantNode.funnel_design_id;

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
    expect(studio.probe.dirty).toBe(false);
    expect(studio.byId("lg-quote-ok").hidden).toBe(false);
  });

  it("forked arm: an override-switch edit writes frame_overrides_json (badge derives client-side; PUT persists; server agrees)", async () => {
    const h = await studioHarness();
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

    // the preview draft folds the unsaved override group in (client fold →
    // server render 200)
    const previews = studio.calls.filter((c) => c.url.endsWith(`/variants/${forked.public_id}/preview`));
    const lastPreview = previews[previews.length - 1]!;
    expect(lastPreview.status).toBe(200);
    expect(((lastPreview.body as Record<string, unknown>)["draft_frame_config"] as Record<string, unknown>)["progress"]).toEqual({ style: "dots" });

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
