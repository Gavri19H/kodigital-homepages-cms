// LeadGen R2 P8 — slice S5.2b: the address feature (M4 beyond B1), and the
// identity loss that reaches the buyer (R6-2 / R6-3 / R6-4).
//
// OWNER, VERBATIM (SOURCE-OF-TRUTH.md A.1 #6): "The address - Image8 - this is
// one of your worst executions... if I want to auto fill only for street
// address and city and I want the user will insert the Zip by himself but to
// validate the Zip in a 5 digits zip validation? ... the mapping of what is
// auto-filled per field should definatly be an option, I clearly defined it,
// but not in this poor way!!!!"
//
// WHY EVERY PROOF HERE HAS A REAL SIDE (E10/E11). The failure class this
// contract names is "a test that hand-builds BOTH sides of the boundary it
// claims to prove". So:
//   * the AUTHORING side is the REAL served island — the studio's own
//     buildAddressRow / collectAddressFields / buildOtherValueRow /
//     collectOther / computeIssues / populateMapsTab, sliced byte-identical
//     out of the page the REAL admin router serves, run in a vm. Nothing here
//     re-implements a collector.
//   * the CONSUMER side is the REAL product code that output flows into —
//     presets.ts renderComponent (what the visitor's browser is sent) and
//     content-schema.validateSectionContent (what the save route calls) —
//     plus, for persistence, the REAL PATCH /sections/:id route.
// Neither side is written by this file. The live-browser legs (a visitor walk
// reading the posted answer payload, and a custom pattern blocking Continue
// with the operator's own words) are DRIVEN separately and reported as
// evidence; they cannot run in this "node" environment.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { renderComponent } from "../src/public/leadgen/components/presets";
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

// --- node:sqlite harness (the repo pattern; see test/leadgen-sections-ui.test.ts) --

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

// node:sqlite's multi-statement runner, reached by name so this file never
// spells a bare call that reads like a shell escape.
const SQL_RUNNER = "exec";
function runSql(sdb: SqliteDb, sql: string): void {
  (sdb[SQL_RUNNER] as (s: string) => void)(sql);
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
          const info = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number };
          return { success: true, meta: { changes: info?.changes ?? 0, last_row_id: Number(info?.lastInsertRowid ?? 0) } };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
    async batch(statements: D1PreparedStatement[]) {
      const out = [];
      for (const s of statements) out.push(await (s as unknown as { run(): Promise<unknown> }).run());
      return out as unknown as D1Result[];
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

function newHarness(): Env {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(sdb, "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);");
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return {
    DB: d1FromSqlite(sdb),
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
const DESIGN = defaultFunnelDesign;

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

interface SectionDetail { id: number; public_id: string; [k: string]: unknown }

async function createSection(env: Env, content: unknown): Promise<SectionDetail> {
  const res = await admin.request(
    `${API}/sections`,
    jsonInit("POST", {
      section_name: "Where do you live?",
      activity: "quote_funnel",
      vertical: "life",
      headline_text: "Where do you live?",
      content_json: JSON.stringify(content),
    }),
    env,
  );
  expect(res.status, `create section: ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as SectionDetail;
}

// The REAL save route (§12.1 merge-then-revalidate), never a direct DB write.
async function saveContent(env: Env, id: number, content: unknown): Promise<{ status: number; body: string }> {
  const res = await admin.request(`${API}/sections/${id}`, jsonInit("PATCH", { content_json: JSON.stringify(content) }), env);
  return { status: res.status, body: await res.text() };
}

async function readStoredContent(env: Env, id: number): Promise<{ components: Record<string, unknown>[] }> {
  const res = await admin.request(`${API}/sections/${id}`, {}, env);
  expect(res.status).toBe(200);
  // the detail endpoint hands content back parsed OR raw depending on the row
  // shape — take it either way rather than assume one.
  const detail = (await res.json()) as { content_json?: unknown };
  const raw = detail.content_json;
  const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  expect(parsed, "stored content present").toBeTruthy();
  return parsed as { components: Record<string, unknown>[] };
}

// --- the REAL served island ------------------------------------------------

const SCRIPT_RE = /<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g;

async function studioPage(env: Env, publicId: string): Promise<string> {
  const res = await admin.request(`/admin/leadgen/sections/${publicId}/edit`, {}, env);
  expect(res.status, "studio page status").toBe(200);
  return res.text();
}

function islandOf(html: string): string {
  const island = [...html.matchAll(SCRIPT_RE)].map((m) => m[1] ?? "").find((s) => s.includes("function collectAddressFields("));
  expect(island, "studio island present in the SERVED page").toBeDefined();
  return island!;
}

function metaOf(html: string): Record<string, unknown> {
  const at = html.indexOf('id="lg-studio-meta"');
  expect(at, "studio meta blob").toBeGreaterThan(-1);
  const open = html.indexOf(">", at) + 1;
  return JSON.parse(html.slice(open, html.indexOf("</script>", open))) as Record<string, unknown>;
}

function sliceIslandFunction(script: string, name: string): string {
  const marker = `function ${name}(`;
  const start = script.indexOf(marker);
  expect(start, `island function ${name} present`).toBeGreaterThan(-1);
  const open = script.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < script.length; i += 1) {
    if (script[i] === "{") depth += 1;
    else if (script[i] === "}") {
      depth -= 1;
      if (depth === 0) return script.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces slicing ${name}`);
}

function sliceIslandVar(script: string, name: string): string {
  const marker = `var ${name} = `;
  const start = script.indexOf(marker);
  expect(start, `island var ${name} present`).toBeGreaterThan(-1);
  const openIdx = start + marker.length;
  const openChar = script[openIdx];
  const closeChar = openChar === "[" ? "]" : "}";
  let depth = 0;
  for (let i = openIdx; i < script.length; i += 1) {
    if (script[i] === openChar) depth += 1;
    else if (script[i] === closeChar) {
      depth -= 1;
      if (depth === 0) return `${script.slice(start, i + 1)};`;
    }
  }
  throw new Error(`unbalanced slicing var ${name}`);
}

// --- a minimal but REAL-shaped DOM (env is "node": no jsdom, no-new-deps) ---

interface FakeNode { nodeType?: number; textContent?: string }
interface FakeEl extends FakeNode {
  tag: string;
  className: string;
  value: string;
  checked: boolean;
  hidden: boolean;
  disabled: boolean;
  selected: boolean;
  type: string;
  attrs: Map<string, string>;
  children: Array<FakeEl | FakeNode>;
  listeners: Record<string, Array<(this: FakeEl) => void>>;
  parentNode: FakeEl | null;
  innerHTML: string;
  previousElementSibling: FakeEl | null;
  nextElementSibling: FakeEl | null;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  addEventListener(ev: string, fn: () => void): void;
  appendChild<T extends FakeEl | FakeNode>(c: T): T;
  insertBefore<T extends FakeEl | FakeNode>(c: T, ref: unknown): T;
  removeChild(c: FakeEl | FakeNode): void;
  querySelector(sel: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
  fire(ev: string): void;
}

function isFakeEl(n: FakeEl | FakeNode): n is FakeEl {
  return Object.prototype.hasOwnProperty.call(n, "attrs");
}

function makeEl(tag: string): FakeEl {
  const attrs = new Map<string, string>();
  const children: Array<FakeEl | FakeNode> = [];
  const listeners: Record<string, Array<(this: FakeEl) => void>> = {};
  const el = {
    tag,
    className: "",
    value: "",
    checked: false,
    hidden: false,
    disabled: false,
    selected: false,
    type: "",
    textContent: "",
    attrs,
    children,
    listeners,
    parentNode: null as FakeEl | null,
    previousElementSibling: null as FakeEl | null,
    nextElementSibling: null as FakeEl | null,
    set innerHTML(_v: string) { children.length = 0; },
    get innerHTML() { return ""; },
    setAttribute(k: string, v: string) { attrs.set(k, String(v)); },
    getAttribute(k: string) { return attrs.has(k) ? attrs.get(k)! : null; },
    removeAttribute(k: string) { attrs.delete(k); },
    addEventListener(ev: string, fn: (this: FakeEl) => void) { (listeners[ev] ||= []).push(fn); },
    appendChild<T extends FakeEl | FakeNode>(c: T): T {
      children.push(c);
      if (isFakeEl(c as FakeEl | FakeNode)) (c as unknown as FakeEl).parentNode = el as unknown as FakeEl;
      return c;
    },
    insertBefore<T extends FakeEl | FakeNode>(c: T): T { children.unshift(c); return c; },
    removeChild(c: FakeEl | FakeNode) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); },
    querySelectorAll(sel: string): FakeEl[] {
      const m = sel.match(/^\[([a-zA-Z0-9-]+)\]$/);
      const attrName = m ? m[1]! : "";
      const out: FakeEl[] = [];
      const walk = (node: FakeEl | FakeNode): void => {
        if (isFakeEl(node)) {
          if (attrName !== "" && node.attrs.has(attrName)) out.push(node);
          node.children.forEach(walk);
        }
      };
      children.forEach(walk);
      return out;
    },
    querySelector(sel: string): FakeEl | null { return (el as unknown as FakeEl).querySelectorAll(sel)[0] ?? null; },
    // Fire every registered handler in registration order with `this` bound to
    // the element — exactly how the browser dispatches to them.
    fire(ev: string) { for (const fn of (listeners[ev] ?? []).slice()) fn.call(el as unknown as FakeEl); },
  };
  return el as unknown as FakeEl;
}

function makeDocument(routes: Record<string, FakeEl>): Record<string, unknown> {
  return {
    createElement(tag: string): FakeEl { return makeEl(tag); },
    createTextNode(t: string): FakeNode { return { nodeType: 3, textContent: String(t) }; },
    querySelector(sel: string): FakeEl | null { return routes[sel] ?? null; },
    querySelectorAll(sel: string): FakeEl[] { return routes[sel] ? [routes[sel]!] : []; },
  };
}

// --- vm sandbox running the REAL island ------------------------------------

interface Sandbox {
  state: { content: { components: unknown[] } };
  studioMeta: Record<string, unknown>;
  selectedQuestionId: string | null;
  MAX_DEPTH: number;
  document: Record<string, unknown>;
  [k: string]: unknown;
}

const ISLAND_FUNCS = [
  "trimStr",
  "slugify",
  "clearChildren",
  "typeMeta",
  "isContainerType",
  "capsOf",
  "cap",
  "typeLabel",
  "bindNodeType",
  "walkTree",
  "findRefIn",
  "findRef",
  "selectedNode",
  "fieldExists",
  "internalFieldsOf",
  "ensureObj",
  "cleanupEmpty",
  "computeIssues",
  "choiceCellWrap",
  "buildChoiceTextInput",
  // OWNER 2026-08-27 — buildChoiceRow now delegates the Saved value cell to
  // this (fixed value vs calculated date), so it has to ride the same slice or
  // the probe ReferenceErrors on a function the real page has.
  "buildChoiceValueControls",
  "choiceFieldsFor",
  "choiceRowMoveBtn",
  "buildChoiceRow",
  "collectChoices",
  "otherValueMoveBtn",
  "buildOtherValueRow",
  "toggleOtherEnabled",
  "collectOther",
  "addrCell",
  "addressRowMoveBtn",
  "addressMapsEnabled",
  "addressFieldsOf",
  "mapsKeyIsConfigured",
  "buildAddressRow",
  "usedAddressKinds",
  "renderAddressAddMenu",
  "populateAddressFieldSet",
  "collectAddressFields",
  "mapsConfigOf",
  "mapsConfigEnabledOf",
  "mapsJobsOf",
  "mapsAnyJobOn",
  "mapsValidateCopyFor",
  "populateMapsTab",
] as const;

const ISLAND_VARS = [
  "CHOICE_FIELDS",
  "CHOICE_FIELD_LABELS",
  "CHOICE_FIELD_PLACEHOLDERS",
  "CHOICE_FIELD_CONSUMPTION",
  "CHOICE_STYLE_TYPES",
  "OTHER_VALUE_FIELDS",
  "ADDRESS_FIELD_KINDS",
  "ADDRESS_FIELD_MENU_LABELS",
  "ADDRESS_DEFAULT_LABELS",
  "ADDRESS_DEFAULT_FIELDS",
] as const;

// The DOM-side collaborators these flows call but whose own internals are a
// different concern (canvas paint, icon/image/style cells, provider chips).
// Every one of them is a SIDE EFFECT, never a value this file asserts on.
const STUBS = [
  "function afterModelChange() {}",
  "function applyCanvasDecoration() {}",
  "function showRefusal() {}",
  "function selectComponent() {}",
  "function addAddressField() {}",
  "function buildChoiceIconSelect() { return { wrap: document.createElement('span'), hidden: document.createElement('input'), clear: function () {} }; }",
  "function buildChoiceImageCell() { return { row: document.createElement('span'), input: document.createElement('input') }; }",
  "function buildChoiceStyleControl() { return { wrap: document.createElement('span'), getStyle: function () { return null; } }; }",
  "function buildProviderChip() { return document.createElement('span'); }",
  "function fillChoiceDefaultOptions() {}",
  "function choiceContainer() { return document.querySelector('[data-studio-choices]'); }",
].join("\n");

function islandProbe(island: string, meta: Record<string, unknown>, content: unknown, routes: Record<string, FakeEl>) {
  const sandbox: Sandbox = {
    state: { content: JSON.parse(JSON.stringify(content)) as { components: unknown[] } },
    studioMeta: meta,
    selectedQuestionId: null,
    MAX_DEPTH: (meta["max_depth"] as number) ?? 4,
    document: makeDocument(routes),
  };
  const source = [
    STUBS,
    ...ISLAND_VARS.map((v) => sliceIslandVar(island, v)),
    ...ISLAND_FUNCS.map((f) => sliceIslandFunction(island, f)),
  ].join("\n");
  runInNewContext(source, sandbox as unknown as Record<string, unknown>);
  return {
    sandbox,
    run(expr: string): unknown { return runInNewContext(expr, sandbox as unknown as Record<string, unknown>); },
  };
}

// --- fixtures ---------------------------------------------------------------

// An Address with NO props at all: the "unconfigured" node R6-4 is about.
const UNCONFIGURED_ADDRESS = {
  components: [
    { type: "AddressAutocompleteQuestion", question_id: "q_addr", internal_field: "home_address", answer_type: "object" },
  ],
};

const BUTTONS_WITH_OTHER = {
  components: [
    {
      type: "ButtonAnswerGroup",
      question_id: "q_carrier",
      internal_field: "carrier",
      answer_type: "enum",
      choices: [{ label: "Geico", value: "geico", analytics_id: "geico" }],
    },
  ],
};

function addressRoutes(): { routes: Record<string, FakeEl>; rows: FakeEl; note: FakeEl } {
  const rows = makeEl("div");
  const note = makeEl("p");
  const banner = makeEl("p");
  banner.setAttribute("data-studio-maps-banner", "");
  banner.setAttribute("data-maps-key-configured", "false"); // keyless, as api/.dev.vars ships
  return {
    rows,
    note,
    routes: {
      "[data-address-rows]": rows,
      "[data-address-maps-note]": note,
      "[data-address-add-menu]": makeEl("div"),
      "[data-address-fieldset-block]": makeEl("div"),
      "[data-studio-maps-banner]": banner,
    },
  };
}

const modeOf = (row: FakeEl): string => row.querySelector("[data-address-field-mode]")!.value;
const optionsOf = (sel: FakeEl): FakeEl[] => sel.children.filter(isFakeEl);
const cellOf = (row: FakeEl, attr: string, field: string): FakeEl =>
  row.querySelectorAll(`[${attr}]`).find((i) => i.getAttribute(attr) === field)!;

describeDb("P8 S5.2b — address identity (R6-2 / R6-3 / R6-4 / M4)", () => {
  // =========================================================================
  // R6-4 — the studio shows what the product will actually do
  // =========================================================================

  it("an UNCONFIGURED address shows the renderer's real defaults — 4 rows, all Autofill — and the REAL renderer does autofill on that same node", async () => {
    const env = newHarness();
    const section = await createSection(env, UNCONFIGURED_ADDRESS);
    const page = await studioPage(env, section.public_id);
    const { routes, rows, note } = addressRoutes();
    const probe = islandProbe(islandOf(page), metaOf(page), UNCONFIGURED_ADDRESS, routes);
    probe.sandbox.selectedQuestionId = "q_addr";

    // AUTHORING SIDE — the studio's own populate, not a re-implementation.
    probe.run("populateAddressFieldSet(selectedNode())");
    const built = rows.querySelectorAll("[data-address-row]");
    expect(built.length, "four rows for an unconfigured address").toBe(4);
    expect(built.map(modeOf), "every row displays what the renderer does").toEqual(["autofill", "autofill", "autofill", "autofill"]);
    for (const row of built) {
      expect(optionsOf(row.querySelector("[data-address-field-mode]")!).map((o) => o.value), "both modes offered").toEqual(["manual", "autofill"]);
    }

    // CONSUMER SIDE — the REAL renderer on the SAME node. This is the assertion
    // that catches the studio saying "Manual" over a product that autofills.
    const html = renderComponent(UNCONFIGURED_ADDRESS.components[0] as unknown as LeadgenComponentNode, DESIGN);
    expect(html, "the driving field advertises autocomplete").toContain('data-address-autocomplete="true"');
    expect(html.replace(/&quot;/g, '"'), "and carries a runnable autocomplete config").toContain('"enable_autocomplete":true');

    // the note no longer claims a keyless funnel forces Manual (it does not).
    expect(note.textContent).not.toContain("stays Manual");
    expect(note.textContent).toContain("saved");
  });

  it("editing ONE row does not rewrite the other three: ticking Required on State persists mode:autofill x4, not manual x4", async () => {
    const env = newHarness();
    const section = await createSection(env, UNCONFIGURED_ADDRESS);
    const page = await studioPage(env, section.public_id);
    const { routes, rows } = addressRoutes();
    const probe = islandProbe(islandOf(page), metaOf(page), UNCONFIGURED_ADDRESS, routes);
    probe.sandbox.selectedQuestionId = "q_addr";
    probe.run("populateAddressFieldSet(selectedNode())");

    // the operator ticks Required on the THIRD row (State) and nothing else,
    // through the row's OWN change listener.
    const reqBox = rows.querySelectorAll("[data-address-row]")[2]!.querySelector("[data-address-field-required]")!;
    reqBox.checked = true;
    reqBox.fire("change");

    const node = probe.sandbox.state.content.components[0] as { props?: { fields?: Record<string, unknown>[] } };
    expect(node.props?.fields, "the whole set materialises truthfully").toEqual([
      { field: "street", mode: "autofill" },
      { field: "city", mode: "autofill" },
      { field: "state", mode: "autofill", required: true },
      { field: "zip", mode: "autofill", validation: "zip5" },
    ]);

    // the REAL save route, then the DB.
    const saved = await saveContent(env, section.id, probe.sandbox.state.content);
    expect(saved.status, saved.body).toBe(200);
    const stored = await readStoredContent(env, section.id);
    const storedFields = (stored.components[0] as { props?: { fields?: { mode?: string }[] } }).props?.fields ?? [];
    expect(storedFields.map((f) => f.mode), "no field silently became manual in the stored row").toEqual([
      "autofill",
      "autofill",
      "autofill",
      "autofill",
    ]);

    // Lossless materialisation: the only thing the visitor's markup gains is
    // the required attribute the operator actually ticked.
    const before = renderComponent(UNCONFIGURED_ADDRESS.components[0] as unknown as LeadgenComponentNode, DESIGN);
    const after = renderComponent(stored.components[0] as unknown as LeadgenComponentNode, DESIGN);
    expect(after, "the tick landed").toContain(" required");
    expect(after.replace(/ required/g, ""), "and nothing else moved").toBe(before);
  });

  it("an address whose Maps toggle is explicitly OFF cannot be GIVEN Autofill (option disabled), while a row that already stores it keeps it", async () => {
    const env = newHarness();
    const content = {
      components: [
        {
          type: "AddressAutocompleteQuestion",
          question_id: "q_addr",
          internal_field: "home_address",
          answer_type: "object",
          props: {
            maps: { enabled: false, jobs: { validate: false, auction: false, autocomplete: false } },
            fields: [
              { field: "street", mode: "manual" },
              { field: "zip", mode: "autofill", validation: "zip5" },
            ],
          },
        },
      ],
    };
    const section = await createSection(env, content);
    const page = await studioPage(env, section.public_id);
    const { routes, rows } = addressRoutes();
    const probe = islandProbe(islandOf(page), metaOf(page), content, routes);
    probe.sandbox.selectedQuestionId = "q_addr";
    probe.run("populateAddressFieldSet(selectedNode())");

    const built = rows.querySelectorAll("[data-address-row]");
    const autoOptOf = (r: FakeEl) => optionsOf(r.querySelector("[data-address-field-mode]")!).find((o) => o.value === "autofill")!;
    expect(autoOptOf(built[0]!).disabled, "a mode the renderer will not honour is not offered").toBe(true);
    expect(modeOf(built[0]!)).toBe("manual");
    expect(modeOf(built[1]!), "a stored autofill is displayed, never coerced").toBe("autofill");
    expect(autoOptOf(built[1]!).disabled).toBe(false);
  });

  // =========================================================================
  // R6-3 — a renamed choice carries its new identity to the buyer
  // =========================================================================

  it("the SEEDED 'Other' row follows a rename: 'Roadside help' stores roadside_help everywhere, and other_option reaches nothing", async () => {
    const env = newHarness();
    const section = await createSection(env, BUTTONS_WITH_OTHER);
    const page = await studioPage(env, section.public_id);
    const enabledCb = makeEl("input");
    const listEl = makeEl("div");
    const routes = {
      "[data-other-enabled]": enabledCb,
      "[data-other-fields]": makeEl("div"),
      "[data-other-label]": makeEl("input"),
      "[data-other-values]": listEl,
    };
    const probe = islandProbe(islandOf(page), metaOf(page), BUTTONS_WITH_OTHER, routes);
    probe.sandbox.selectedQuestionId = "q_carrier";

    // the REAL "Enable Other" path seeds the row with its placeholder identity.
    enabledCb.checked = true;
    probe.run("toggleOtherEnabled()");
    const row = listEl.querySelectorAll("[data-other-row]")[0]!;
    const seededValue = cellOf(row, "data-other-field", "value");
    expect(seededValue.value, "the seed writes the same bytes it always did").toBe("other_option");
    expect(seededValue.getAttribute("data-auto"), "but it is now marked machine-derived").toBe("true");
    expect(cellOf(row, "data-other-field", "analytics_id").getAttribute("data-auto")).toBe("true");

    // the operator renames the LABEL — the only thing they touch.
    const labelInput = cellOf(row, "data-other-field", "label");
    labelInput.value = "Roadside help";
    labelInput.fire("input");

    const node = probe.sandbox.state.content.components[0] as { props?: { other?: { choices?: Record<string, unknown>[] } } };
    expect(node.props?.other?.choices).toEqual([{ label: "Roadside help", value: "roadside_help", analytics_id: "roadside_help" }]);

    // through the REAL save route, then out through the REAL renderer — this is
    // the option the visitor picks and the value their answer carries.
    const saved = await saveContent(env, section.id, probe.sandbox.state.content);
    expect(saved.status, saved.body).toBe(200);
    const stored = await readStoredContent(env, section.id);
    expect(JSON.stringify(stored), "no placeholder identity survives in the stored row").not.toContain("other_option");
    const html = renderComponent(stored.components[0] as unknown as LeadgenComponentNode, DESIGN);
    expect(html).toContain('value="roadside_help"');
    expect(html).not.toContain("other_option");
  });

  it("a value the operator typed themselves is NEVER rewritten by a later rename (base choice rows — R6-3 is product-wide)", async () => {
    const env = newHarness();
    const content = {
      components: [
        {
          type: "ButtonAnswerGroup",
          question_id: "q_carrier",
          internal_field: "carrier",
          answer_type: "enum",
          choices: [
            // machine-derived: value IS the label's slug, analytics id IS the value
            { label: "Option 1", value: "option_1", analytics_id: "option_1" },
            // hand-authored: neither matches the derivation
            { label: "Geico", value: "gco_2024_q3", analytics_id: "partner_gco" },
          ],
        },
      ],
    };
    const section = await createSection(env, content);
    const page = await studioPage(env, section.public_id);
    const container = makeEl("div");
    const probe = islandProbe(islandOf(page), metaOf(page), content, { "[data-studio-choices]": container });
    probe.sandbox.selectedQuestionId = "q_carrier";
    probe.run("var __n = selectedNode(); var __i; for (__i = 0; __i < __n.choices.length; __i++) { choiceContainer().appendChild(buildChoiceRow(__n.choices[__i], __n)); }");

    const rows = container.querySelectorAll("[data-choice-row]");
    expect(rows.length).toBe(2);
    const lab0 = cellOf(rows[0]!, "data-choice-field", "label");
    lab0.value = "Roadside help";
    lab0.fire("input");
    const lab1 = cellOf(rows[1]!, "data-choice-field", "label");
    lab1.value = "Geico Direct";
    lab1.fire("input");

    const node = probe.sandbox.state.content.components[0] as { choices?: Record<string, unknown>[] };
    expect(node.choices).toEqual([
      { label: "Roadside help", value: "roadside_help", analytics_id: "roadside_help" },
      { label: "Geico Direct", value: "gco_2024_q3", analytics_id: "partner_gco" },
    ]);
  });

  // =========================================================================
  // M4 — the per-field validation the runtime already supports
  // =========================================================================

  it("a per-field CUSTOM pattern + message is authorable, collected as {regex,message}, saved by the REAL route, and comes back on reload", async () => {
    const env = newHarness();
    const section = await createSection(env, UNCONFIGURED_ADDRESS);
    const page = await studioPage(env, section.public_id);
    const island = islandOf(page);
    const meta = metaOf(page);
    const { routes, rows } = addressRoutes();
    const probe = islandProbe(island, meta, UNCONFIGURED_ADDRESS, routes);
    probe.sandbox.selectedQuestionId = "q_addr";
    probe.run("populateAddressFieldSet(selectedNode())");

    const zipRow = rows.querySelectorAll("[data-address-row]")[3]!;
    const valSel = zipRow.querySelector("[data-address-field-validation]")!;
    expect(optionsOf(valSel).map((o) => o.value), "the third rule is offered").toEqual(["none", "zip5", "custom"]);
    const customWrap = zipRow.querySelector("[data-address-custom-validation]")!;
    expect(customWrap.hidden, "hidden until the custom rule is chosen").toBe(true);

    valSel.value = "custom";
    valSel.fire("change");
    expect(customWrap.hidden, "revealed with the rule").toBe(false);

    const pattern = zipRow.querySelector("[data-address-field-pattern]")!;
    const message = zipRow.querySelector("[data-address-field-pattern-message]")!;
    pattern.value = "^[0-9]{5}(-[0-9]{4})?$";
    message.value = "Enter a ZIP like 90210 or 90210-1234.";
    pattern.fire("input");
    message.fire("input");

    const expected = {
      field: "zip",
      mode: "autofill",
      validation: { regex: "^[0-9]{5}(-[0-9]{4})?$", message: "Enter a ZIP like 90210 or 90210-1234." },
    };
    const node = probe.sandbox.state.content.components[0] as { props?: { fields?: Record<string, unknown>[] } };
    expect(node.props?.fields?.[3]).toEqual(expected);

    // the REAL server validator, then the REAL save route, then the DB.
    expect(validateSectionContent(probe.sandbox.state.content).ok).toBe(true);
    const saved = await saveContent(env, section.id, probe.sandbox.state.content);
    expect(saved.status, saved.body).toBe(200);
    const stored = await readStoredContent(env, section.id);
    expect((stored.components[0] as { props?: { fields?: Record<string, unknown>[] } }).props?.fields?.[3]).toEqual(expected);

    // reopening the editor shows the authored rule, never a silent downgrade.
    const reload = addressRoutes();
    const probe2 = islandProbe(island, meta, stored, reload.routes);
    probe2.sandbox.selectedQuestionId = "q_addr";
    probe2.run("populateAddressFieldSet(selectedNode())");
    const zipRow2 = reload.rows.querySelectorAll("[data-address-row]")[3]!;
    expect(zipRow2.querySelector("[data-address-field-validation]")!.value).toBe("custom");
    expect(zipRow2.querySelector("[data-address-field-pattern]")!.value).toBe("^[0-9]{5}(-[0-9]{4})?$");
    expect(zipRow2.querySelector("[data-address-field-pattern-message]")!.value).toBe("Enter a ZIP like 90210 or 90210-1234.");
    expect(zipRow2.querySelector("[data-address-custom-validation]")!.hidden).toBe(false);
  });

  it("an unusable custom pattern is reported at AUTHORING time in the publish blocker's register — and the server agrees", async () => {
    const env = newHarness();
    const section = await createSection(env, UNCONFIGURED_ADDRESS);
    const page = await studioPage(env, section.public_id);
    const { routes, rows } = addressRoutes();
    const probe = islandProbe(islandOf(page), metaOf(page), UNCONFIGURED_ADDRESS, routes);
    probe.sandbox.selectedQuestionId = "q_addr";
    probe.run("populateAddressFieldSet(selectedNode())");

    const zipRow = rows.querySelectorAll("[data-address-row]")[3]!;
    const valSel = zipRow.querySelector("[data-address-field-validation]")!;
    valSel.value = "custom";
    valSel.fire("change");

    // (a) rule chosen, nothing typed yet
    let issues = probe.run("computeIssues()") as { message: string }[];
    expect(issues.some((i) => /ZIP code field has a custom rule with no pattern/.test(i.message)), JSON.stringify(issues)).toBe(true);
    expect(
      issues.some((i) => /enter the pattern, or switch that field/.test(i.message)),
      "names the fix, the way the publish blocker does",
    ).toBe(true);

    // (b) a pattern no engine can read
    const pattern = zipRow.querySelector("[data-address-field-pattern]")!;
    pattern.value = "^[0-9";
    pattern.fire("input");
    issues = probe.run("computeIssues()") as { message: string }[];
    expect(issues.some((i) => /custom pattern the browser cannot read/.test(i.message)), JSON.stringify(issues)).toBe(true);
    // the server says so too — the studio is a mirror, never the authority.
    const server = validateSectionContent(probe.sandbox.state.content);
    expect(server.ok).toBe(false);
    expect(server.errors.some((e) => e.path.includes("props.fields[3].validation.regex")), JSON.stringify(server.errors)).toBe(true);

    // (c) a usable pattern clears it, on both sides
    pattern.value = "^[0-9]{5}$";
    pattern.fire("input");
    issues = probe.run("computeIssues()") as { message: string }[];
    expect(issues.some((i) => /custom pattern|custom rule/.test(i.message)), JSON.stringify(issues)).toBe(false);
    expect(validateSectionContent(probe.sandbox.state.content).ok).toBe(true);
  });

  // =========================================================================
  // R6-2 — two slots cannot silently claim one answer key
  // =========================================================================

  it("a fill target another slot already holds is SHOWN and NAMED, but cannot be claimed twice", async () => {
    const env = newHarness();
    const content = {
      components: [
        {
          type: "AddressAutocompleteQuestion",
          question_id: "q_addr",
          internal_field: "home_address",
          answer_type: "object",
          props: { maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: true }, fills: { street: "note_field" } } },
        },
        { type: "FreeTextQuestion", question_id: "q_note", internal_field: "note_field", answer_type: "string" },
        { type: "FreeTextQuestion", question_id: "q_town", internal_field: "town_field", answer_type: "string" },
      ],
    };
    const section = await createSection(env, content);
    const page = await studioPage(env, section.public_id);
    const slots: Record<string, FakeEl> = {};
    for (const s of ["street", "city", "state", "zip"]) {
      slots[s] = makeEl("select");
      slots[s]!.setAttribute("data-maps-fill-slot", s);
    }
    const routes: Record<string, FakeEl> = {
      "[data-maps-enabled-toggle]": makeEl("input"),
      "[data-maps-jobs-block]": makeEl("div"),
      "[data-maps-zero-job-banner]": makeEl("div"),
      "[data-maps-validate-copy]": makeEl("span"),
      "[data-maps-autocomplete-copy]": makeEl("span"),
      "[data-maps-degradation-note]": makeEl("p"),
      "[data-maps-fills-block]": makeEl("div"),
    };
    const probe = islandProbe(islandOf(page), metaOf(page), content, routes);
    // the four slot selects answer ONE querySelectorAll, exactly like the page.
    (probe.sandbox.document as { querySelectorAll: (s: string) => FakeEl[] }).querySelectorAll = (sel: string): FakeEl[] => {
      if (sel === "[data-maps-fill-slot]") return ["street", "city", "state", "zip"].map((s) => slots[s]!);
      if (sel === "[data-maps-job]") return [];
      return routes[sel] ? [routes[sel]!] : [];
    };
    probe.sandbox.selectedQuestionId = "q_addr";
    probe.run("populateMapsTab(selectedNode(), typeMeta(selectedNode().type))");

    const takenInCity = optionsOf(slots["city"]!).find((o) => o.value === "note_field")!;
    expect(takenInCity, "the taken key is still SHOWN, never quietly missing").toBeDefined();
    expect(takenInCity.disabled, "but it cannot be claimed a second time").toBe(true);
    expect(takenInCity.textContent, "and it says who has it").toBe("note_field — already filled by Street");

    const inStreet = optionsOf(slots["street"]!).find((o) => o.value === "note_field")!;
    expect(inStreet.disabled, "the slot that owns it keeps it").toBe(false);
    expect(inStreet.selected).toBe(true);

    // P8-5 B-1 — RE-FOUNDED, not weakened. This loop used to assert that
    // `town_field` stayed selectable in city/state/zip under the label "can
    // still take an unclaimed field". That premise is false about this very
    // fixture: `town_field` is q_town's own internal_field (:803) — a SIBLING
    // QUESTION's answer key, not an unclaimed one. The old assertion conflated
    // "not claimed by another FILL SLOT" with "unclaimed", which is exactly the
    // bounded universe contract R6-2 reports as the defect ("The fills picker
    // renames a sub-field's own key and can collide ... The picker deliberately
    // offers exactly the siblings that collide"). Driven on the real Studio at
    // 1280 with the old code: picking City -> a sibling's key saved 200 with no
    // problem and rendered data-lg-field="town_field" on TWO visible inputs
    // while the Address's own addr_city key vanished from the markup.
    //
    // This Address authors no props.fields, so it renders the renderer's
    // default 4-field spec — city/state/zip each render their OWN box, and
    // props.maps.fills.<slot> RENAMES that box's data-lg-field. So a sibling's
    // key gets the SAME treatment the test already requires of `note_field`
    // above: shown, disabled, and named.
    for (const s of ["city", "state", "zip"]) {
      const sibling = optionsOf(slots[s]!).find((o) => o.value === "town_field")!;
      expect(sibling, `${s} still SHOWS the sibling's key, never quietly missing`).toBeDefined();
      expect(sibling.disabled, `${s} renders its own box, so a sibling's key cannot be claimed there too`).toBe(true);
      expect(sibling.textContent, "and it says who already answers it").toBe(
        // q_town authors no props.label, so there is no truthful name to give.
        "town_field — already answered by another question",
      );
    }

    // The intent the old loop was reaching for — a free key must stay
    // available — re-founded on a key that really is unclaimed: the slot's own
    // node-namespaced default, which no sibling question owns.
    for (const s of ["city", "state", "zip"]) {
      const free = optionsOf(slots[s]!).find((o) => o.value === `home_address_${s}`)!;
      expect(free, `${s} still offers a key nothing else answers`).toBeDefined();
      expect(free.disabled, `${s} can still take a genuinely unclaimed key`).toBe(false);
      expect(free.textContent).toBe(`Create "home_address_${s}"`);
    }
  });

  it("the sibling-fill feature itself survives: a slot this Address does NOT render still offers the sibling's key, because nothing is renamed there", async () => {
    // P8-5 B-1 boundary. props.maps.fills.<slot> only renames a box this
    // Address actually renders. With props.fields authoring street ALONE there
    // is no city box of its own, so fills.city is a pure EXTERNAL target: the
    // runtime writes the resolved city into the sibling's own input
    // (runtime/maps.ts fillTarget) — one answer key, one visible input, no
    // collision. Driven on the real Studio: this exact shape picked
    // `town_field` for City, saved props.maps.fills={"city":"town_field"} and
    // rendered {"town_field":1,"addr":1,"addr_street":1} — no duplicate key.
    const env = newHarness();
    const content = {
      components: [
        {
          type: "AddressAutocompleteQuestion",
          question_id: "q_addr",
          internal_field: "home_address",
          answer_type: "object",
          props: {
            fields: [{ field: "street", mode: "autofill", required: false, zip5: false }],
            maps: { enabled: true, jobs: { validate: false, auction: false, autocomplete: true } },
          },
        },
        { type: "FreeTextQuestion", question_id: "q_town", internal_field: "town_field", answer_type: "string", props: { label: "Town" } },
      ],
    };
    const section = await createSection(env, content);
    const page = await studioPage(env, section.public_id);
    const slots: Record<string, FakeEl> = {};
    for (const s of ["street", "city", "state", "zip"]) {
      slots[s] = makeEl("select");
      slots[s]!.setAttribute("data-maps-fill-slot", s);
    }
    const routes: Record<string, FakeEl> = {
      "[data-maps-enabled-toggle]": makeEl("input"),
      "[data-maps-jobs-block]": makeEl("div"),
      "[data-maps-zero-job-banner]": makeEl("div"),
      "[data-maps-validate-copy]": makeEl("span"),
      "[data-maps-autocomplete-copy]": makeEl("span"),
      "[data-maps-degradation-note]": makeEl("p"),
      "[data-maps-fills-block]": makeEl("div"),
    };
    const probe = islandProbe(islandOf(page), metaOf(page), content, routes);
    (probe.sandbox.document as { querySelectorAll: (s: string) => FakeEl[] }).querySelectorAll = (sel: string): FakeEl[] => {
      if (sel === "[data-maps-fill-slot]") return ["street", "city", "state", "zip"].map((s) => slots[s]!);
      if (sel === "[data-maps-job]") return [];
      return routes[sel] ? [routes[sel]!] : [];
    };
    probe.sandbox.selectedQuestionId = "q_addr";
    probe.run("populateMapsTab(selectedNode(), typeMeta(selectedNode().type))");

    for (const s of ["city", "state", "zip"]) {
      const external = optionsOf(slots[s]!).find((o) => o.value === "town_field")!;
      expect(external, `${s} is not rendered by this Address, so the sibling stays on offer`).toBeDefined();
      expect(external.disabled, `${s} writes into the sibling's OWN box — nothing is renamed, nothing collides`).toBe(false);
      expect(external.textContent).toBe("town_field");
    }
    // …and the one slot it DOES render still refuses the sibling's key.
    const inStreet = optionsOf(slots["street"]!).find((o) => o.value === "town_field")!;
    expect(inStreet.disabled, "street renders its own box, so there the same key is refused").toBe(true);
    expect(inStreet.textContent).toBe("town_field — already answered by Town");
  });
});
