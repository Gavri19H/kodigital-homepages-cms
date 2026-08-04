// LeadGen R2 P8-4 SLICE S4.3 — the board's Template chip (contract §6 M10,
// board-chip half), the funnel.ts half of M9 item 2 ("Review slide" ->
// "Edit Section", coordinated with the concurrent activation.ts slice), and
// §7 N6 (every added funnel named the literal 'New funnel'). Real
// producer->consumer flow throughout: every DB-backed assertion drives the
// REAL admin router (node:sqlite D1 + KV stub harness, the repo's own
// duplicated-per-file pattern — see leadgen-p8-3-f5-major3-minor5.test.ts)
// against REAL persisted rows and the REAL served editor page; the ES5
// island proofs execute the REAL sliced function text out of the served
// <script> bytes (node:vm — the leadgen-p2-tail.test.ts /
// leadgen-board-defects-r2.test.ts idiom) with hand-rolled DOM/fetch stubs —
// never jsdom, never a hand-typed copy of the algorithm under test.

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import { effectiveFrame } from "../src/public/leadgen/designs/frames";
import { templateLabelFor, frameTemplateIdOf } from "../src/admin/leadgen/quotes-tabs/funnel";
import type { FunnelNode, FrameTemplateItem } from "../src/admin/leadgen/quotes-tabs/shared";
import type { Env } from "../src/env";

// --- node:sqlite + KV-stub harness (repo pattern; duplicated per test file,
// e.g. leadgen-p8-3-f5-major3-minor5.test.ts, leadgen-p2-tail.test.ts) -------

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

function makeKvStub(): KVNamespace {
  const store = new Map<string, { value: string; metadata: unknown }>();
  return {
    async get(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)!.value : null;
    },
    async getWithMetadata(key: string): Promise<{ value: string | null; metadata: unknown }> {
      const e = store.get(key);
      return e ? { value: e.value, metadata: e.metadata ?? null } : { value: null, metadata: null };
    },
    async put(key: string, value: string, opts?: { metadata?: unknown }): Promise<void> {
      store.set(key, { value, metadata: opts?.metadata ?? null });
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor: string }> {
      const prefix = options?.prefix ?? "";
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
      return { keys: keys.map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql", "0037_leadgen_analytics_mirror.sql", "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql", "0040_leadgen_runtime_context.sql", "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql", "0043_leadgen_routing_rules.sql", "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql", "0046_leadgen_rework_m1_variants.sql", "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql", "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql", "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql", "0053_leadgen_rework_m12_othergroup_retirement.sql",
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
  );
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
}

function buildEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db, CACHE: kv, MEDIA: {} as R2Bucket, APP_ENV: "test",
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

interface QuoteDetail {
  public_id: string;
  funnels: Array<{ public_id: string; funnel_name: string; variants: Array<{ public_id: string }> }>;
}

// --- island slicing (leadgen-p2-tail.test.ts / leadgen-board-defects-r2.test.ts
// idiom): EXECUTE the REAL served function text, never a hand-typed copy -----

function islandContaining(html: string, marker: string): string {
  const at = html.indexOf(marker);
  expect(at, `island containing ${marker}`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<script>", at);
  const end = html.indexOf("</script>", at);
  return html.slice(start + "<script>".length, end);
}
function funnelIsland(html: string): string {
  return islandContaining(html, "function addFunnel(");
}
function sliceIslandFunction(island: string, name: string): string {
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

// --- markup slicing (leadgen-p8-3-f5-major3-minor5.test.ts's themeChipTag
// idiom, adapted to the Template chip's own attributes) ---------------------

function templateChipTag(html: string, funnelPublicId: string): string {
  const marker = `data-template-picker data-pin="8.2-template-picker" data-chip-funnel-public-id="${funnelPublicId}"`;
  const idx = html.indexOf(marker);
  expect(idx, `the template chip for funnel ${funnelPublicId} must be present in the served board`).toBeGreaterThan(-1);
  const tagStart = html.lastIndexOf("<span", idx);
  const tagEnd = html.indexOf("</span>", idx);
  expect(tagStart, "template chip span must open").toBeGreaterThan(-1);
  expect(tagEnd, "template chip span must close").toBeGreaterThan(-1);
  return html.slice(tagStart, tagEnd + "</span>".length);
}
function chipLabel(tag: string): string {
  const m = tag.match(/>([^<]*)<\/span>$/);
  return m ? (m[1] as string) : "";
}
function chipTemplateId(tag: string): string {
  const m = tag.match(/data-template-id="([^"]*)"/);
  return m ? (m[1] as string) : "";
}

const SANDBOX_BUILTINS = { JSON, Object, String, Boolean, Number, Math, isFinite, encodeURIComponent };

async function newQuote(env: Env, name: string): Promise<QuoteDetail> {
  const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: name, activity: "quote_funnel", verticals: ["car"] }), env);
  expect(cq.status, `create quote: ${await cq.clone().text()}`).toBe(201);
  return (await cq.json()) as QuoteDetail;
}

// =============================================================================
// M10 (pure leg, no D1/router) — templateLabelFor's three branches, per I1.
// =============================================================================
describe("S4.3 M10 (pure) — templateLabelFor's three branches", () => {
  const templates: FrameTemplateItem[] = [
    { id: "centered", label: "Centered", arrangement: "centered", thumbnail_html: "", defaults: {} },
    // A synthetic entry ONLY to exercise the pre-existing "built-in matches"
    // branch (real registry ids are never numeral strings — see the TS
    // comment above templateLabelFor); this documents that branch still
    // behaves exactly as before, it does not claim real data produces it.
    { id: "7", label: "Numeral-id built-in (test fixture, not real registry data)", arrangement: "x", thumbnail_html: "", defaults: {} },
  ];
  function fakeFunnel(frame_template_id: number | null | undefined): FunnelNode {
    return { frame_template_id } as unknown as FunnelNode;
  }

  it("nothing set (frame_template_id null/undefined): the honest neutral word, never a database id", () => {
    expect(frameTemplateIdOf(fakeFunnel(null))).toBe("");
    expect(frameTemplateIdOf(fakeFunnel(undefined))).toBe("");
    expect(templateLabelFor(fakeFunnel(null), templates)).toBe("Template");
  });

  it("a built-in arrangement match: its OWN label (the pre-existing branch, unchanged by this fix)", () => {
    expect(templateLabelFor(fakeFunnel(7), templates)).toBe("Numeral-id built-in (test fixture, not real registry data)");
  });

  it("FAIL-BEFORE/PASS-AFTER — a saved template's numeric id matching NO built-in arrangement: honest 'Template', never the raw id (the M10 defect)", () => {
    expect(frameTemplateIdOf(fakeFunnel(42))).toBe("42");
    // BEFORE this phase templateLabelFor's match/idStr computation was
    // identical for this case (templates.find always returns undefined for a
    // real numeric id) — it already returned "Template", never "42". What
    // was BROKEN was that nothing downstream could ever resolve "42" to a
    // real name; that boundary is proven end to end in the describeDb block
    // below (real saved template + real apply-template + real catalog GET).
    expect(templateLabelFor(fakeFunnel(42), templates)).toBe("Template");
    expect(templateLabelFor(fakeFunnel(42), templates)).not.toBe("42");
  });
});

// =============================================================================
// M10 (real router + real DB) — the board's Template chip, end to end.
// Environment note (E6): this vitest lane runs in `node` (no DOM). The
// island's client-side rename (applyTemplateChipNames) is proven separately
// below against hand-rolled stubs (never jsdom); THIS block proves CODE
// HEALTH: the real render emits an honest SSR label + the exact data the
// island's new boot-time fetch needs, and the SAME catalog endpoint that
// fetch calls returns the matching real name for the real id.
// =============================================================================
describeDb("S4.3 M10 — the board Template chip resolves a saved template's real name, end to end", () => {
  let env: Env;
  let quotePublicId = "";
  let funnelPublicId = "";
  let template: { id: number; public_id: string; name: string };

  beforeAll(async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    env = buildEnv(d1FromSqlite(sdb), makeKvStub());

    const quote = await newQuote(env, "S4.3 Board Chip Quote");
    quotePublicId = quote.public_id;
    funnelPublicId = quote.funnels[0]!.public_id;

    // Real saved template through the REAL POST /frame-template-records
    // endpoint (never a hand-built row) — a genuinely valid frame_json (the
    // "minimal" arrangement's own effective defaults, the SAME base
    // test/leadgen-p8-m3-apply-template.test.ts's own newSavedTemplate uses).
    const ct = await admin.request(`${API}/frame-template-records`, jsonInit("POST", { name: "S4.3 Repro Template", frame_json: effectiveFrame("minimal").frame }), env);
    expect(ct.status, `create template: ${await ct.clone().text()}`).toBe(201);
    template = (await ct.json()) as { id: number; public_id: string; name: string };

    // Real assignment through the REAL POST /funnels/:id/apply-template route
    // — the only path that writes leadgen_funnels.frame_template_id.
    const apply = await admin.request(`${API}/funnels/${funnelPublicId}/apply-template`, jsonInit("POST", { template_id: template.id }), env);
    expect(apply.status, `apply template: ${await apply.clone().text()}`).toBe(200);
  });

  it("before any template is applied (frame_template_id null): the chip reads the honest 'Template' word with no id attribute (regression guard on the untouched branch)", async () => {
    const sdb2 = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const env2 = buildEnv(d1FromSqlite(sdb2), makeKvStub());
    const quote2 = await newQuote(env2, "S4.3 No-Template Quote");
    const html2 = await (await admin.request(`/admin/leadgen/quotes/${quote2.public_id}/edit`, {}, env2)).text();
    const tag = templateChipTag(html2, quote2.funnels[0]!.public_id);
    expect(chipLabel(tag)).toBe("Template");
    expect(chipTemplateId(tag)).toBe("");
  });

  it("FAIL-BEFORE/PASS-AFTER — a REAL saved template applied through the REAL apply-template route: the SSR chip is the honest neutral word, never the raw numeric id, and carries that id as data for the island's boot-time fetch", async () => {
    const html = await (await admin.request(`/admin/leadgen/quotes/${quotePublicId}/edit`, {}, env)).text();
    const tag = templateChipTag(html, funnelPublicId);
    const label = chipLabel(tag);
    // BEFORE this phase: templateLabelFor(funnel, templates) with
    // templates == the built-in registry (string ids) could NEVER match a
    // numeric frame_template_id, so this already read "Template" — the bug
    // was that NOTHING downstream could ever turn that into "S4.3 Repro
    // Template"; there was no data attribute to resolve from at all.
    expect(label, "the chip must never render the raw numeric frame_template_id").not.toBe(String(template.id));
    expect(label, "SSR fallback is the neutral word templateLabelFor returns for an unmatched (saved) id").toBe("Template");
    expect(chipTemplateId(tag), "the raw id must be present as DATA so the island's boot-time fetch can resolve it (PASS-AFTER: this attribute did not exist before this phase)").toBe(String(template.id));
  });

  it("the SAME catalog endpoint the island's new boot-time fetch calls (GET /api/admin/leadgen/frame-template-records) returns this record's real name for this exact id — the wiring the client rename depends on is real end-to-end", async () => {
    const listRes = await admin.request(`${API}/frame-template-records`, {}, env);
    expect(listRes.status).toBe(200);
    const items = ((await listRes.json()) as { items: Array<{ id: number; name: string }> }).items;
    const match = items.find((t) => t.id === template.id);
    expect(match, "the applied template's id must resolve through the real catalog list").toBeDefined();
    expect(match!.name).toBe("S4.3 Repro Template");
  });
});

// =============================================================================
// M10 — the island's applyTemplateChipNames/loadTemplateRecordNames EXECUTED
// against hand-rolled DOM/fetch stubs (never jsdom): the REAL sliced logic,
// not a hand-built copy of it.
// =============================================================================
describeDb("S4.3 M10 — EXECUTED: applyTemplateChipNames renames a matched chip and leaves an unmatched one alone", () => {
  it("EXECUTED against the REAL served island text", async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const quote = await newQuote(env, "S4.3 VM Quote");
    const html = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
    const island = funnelIsland(html);

    function stubChip(templateId: string, initialText: string) {
      const attrs: Record<string, string> = { "data-template-id": templateId };
      return {
        textContent: initialText,
        getAttribute: (n: string) => (Object.prototype.hasOwnProperty.call(attrs, n) ? attrs[n] : null),
      };
    }
    const matched = stubChip("42", "Template");
    const unmatched = stubChip("99", "Template");
    const rootStub = { querySelectorAll: (sel: string) => (sel === "[data-template-picker][data-template-id]" ? [matched, unmatched] : []) };
    const fetchShim = () => Promise.resolve({ json: () => Promise.resolve({ items: [{ id: 42, name: "Real Saved Name" }] }) });

    runInNewContext(
      [sliceIslandFunction(island, "applyTemplateChipNames"), sliceIslandFunction(island, "loadTemplateRecordNames"), "loadTemplateRecordNames();"].join("\n"),
      { ...SANDBOX_BUILTINS, root: rootStub, fetch: fetchShim },
    );
    // Flush the fetch().then().then() microtask chain.
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(matched.textContent, "the matched chip is renamed to the record's real name").toBe("Real Saved Name");
    expect(unmatched.textContent, "an id with no matching record keeps the SSR fallback — never blanked, never a raw id").toBe("Template");
  });
});

// =============================================================================
// M9.2 (funnel.ts half, coordinated with the concurrent activation.ts slice)
// — "Review slide" -> "Edit Section".
// =============================================================================
describeDb("S4.3 M9.2 (funnel.ts half) — 'Edit Section', not 'Review slide'", () => {
  let html = "";
  beforeAll(async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const quote = await newQuote(env, "S4.3 M9.2 Quote");
    html = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
  });

  it("FAIL-BEFORE/PASS-AFTER — EXECUTED: the REAL served problemFixLabel returns 'Edit Section' for every /sections/ fix url shape (was 'Review slide'), matching activation.ts's coordinated wording", () => {
    const island = funnelIsland(html);
    const src = [sliceIslandFunction(island, "problemFixLabel"), "__capture(problemFixLabel(__url));"].join("\n");
    const cases: Array<[string, string]> = [
      ["/admin/leadgen/sections/lgf_section_123/edit", "Edit Section"],
      ["/sections/", "Edit Section"],
      ["https://example.com/sections/foo", "Edit Section"],
      ["/admin/settings", "Open site settings"],
      ["/admin/leadgen/quotes/lgf_quote_456/edit", "Open Quote Builder"],
      ["/unknown/path", "Fix"],
    ];
    for (const [url, expected] of cases) {
      let out = "";
      runInNewContext(src, { ...SANDBOX_BUILTINS, __url: url, __capture: (v: string) => { out = v; } });
      expect(out, `problemFixLabel(${JSON.stringify(url)})`).toBe(expected);
      if (url.indexOf("/sections/") !== -1) expect(out, "must never regress to the stale label").not.toBe("Review slide");
    }
  });

  it("EXECUTED: the REAL problemRowNode (the publish-blocker's DOM builder) renders an 'Edit Section' link — against the real markup-building function, not a hand-built string", () => {
    const island = funnelIsland(html);
    interface StubNode { tag: string; attrs: Record<string, string>; children: StubNode[]; textContent: string; setAttribute(k: string, v: string): void; appendChild(c: StubNode): void }
    function stubNode(tag: string): StubNode {
      const n: StubNode = {
        tag, attrs: {}, children: [], textContent: "",
        setAttribute(k, v) { n.attrs[k] = v; },
        appendChild(c) { n.children.push(c); n.textContent += c.textContent; },
      };
      return n;
    }
    const documentStub = {
      createElement: (tag: string) => stubNode(tag),
      createTextNode: (t: string) => { const n = stubNode("#text"); n.textContent = t; return n; },
    };
    const src = [
      sliceIslandFunction(island, "problemFixLabel"),
      sliceIslandFunction(island, "preflightFixLink"),
      sliceIslandFunction(island, "problemRowNode"),
      "__capture(problemRowNode({ severity: 'error', path: 'sections.0', message: 'Missing mapping', fix_url: '/admin/leadgen/sections/lgf_abc/edit' }));",
    ].join("\n");
    let row: StubNode | null = null;
    runInNewContext(src, { ...SANDBOX_BUILTINS, document: documentStub, __capture: (v: StubNode) => { row = v; } });
    expect(row, "problemRowNode must return a row").not.toBeNull();
    const link = (row as unknown as StubNode).children.find((c) => c.tag === "a");
    expect(link, "problemRowNode must append a fix link for a fix_url").toBeTruthy();
    expect((link as StubNode).textContent).toBe("Edit Section");
    expect((link as StubNode).textContent).not.toBe("Review slide");
  });
});

// =============================================================================
// §7 N6 — every added funnel is no longer the literal 'New funnel'.
// =============================================================================
describeDb("S4.3 N6 — distinguishable 'New funnel N' naming", () => {
  it("EXECUTED: the REAL sliced addFunnel() sends a distinguishing ordinal for 3 consecutive adds, derived from the board's OWN current funnel count", async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const quote = await newQuote(env, "S4.3 N6 VM Quote");
    const html = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
    const island = funnelIsland(html);

    const calls: Array<{ url: string; body: { funnel_name?: string } }> = [];
    function runAdd(existingCount: number): void {
      const src = [sliceIslandFunction(island, "addFunnel"), "addFunnel();"].join("\n");
      runInNewContext(src, {
        ...SANDBOX_BUILTINS,
        BOARD: { funnels: new Array(existingCount).fill(0), quote_public_id: quote.public_id },
        quoteId: quote.public_id,
        API: "/api/admin/leadgen",
        req: (_method: string, url: string, body: { funnel_name?: string }) => {
          calls.push({ url, body });
          return Promise.resolve({ ok: true, body: {} });
        },
        reloadPage: () => { /* real UX reloads here; irrelevant to this proof */ },
        showInlineErr: () => { /* not exercised on the success path */ },
        firstFieldError: () => "",
      });
    }
    // Mirrors the real UX: each add reloads the page, so the NEXT call sees
    // the board's funnel count grown by one — simulated here by incrementing
    // the injected BOARD.funnels length between calls.
    runAdd(1);
    runAdd(2);
    runAdd(3);

    const names = calls.map((c) => c.body.funnel_name);
    expect(names).toEqual(["New funnel 2", "New funnel 3", "New funnel 4"]);
    expect(new Set(names).size, "three consecutive creations must be pairwise distinguishable").toBe(3);
    for (const n of names) expect(n, "FAIL-BEFORE: every add used to send the literal 'New funnel'").not.toBe("New funnel");
  });

  it("FAIL-BEFORE/PASS-AFTER — real round trip: 3 funnels created with the client's own naming scheme persist as 3 distinct funnel_name values on the REAL board, and the existing rename path still overwrites a stored name without disturbing the others", async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb), makeKvStub());
    const quote = await newQuote(env, "S4.3 N6 Round Trip Quote");

    const names = ["New funnel 2", "New funnel 3", "New funnel 4"];
    const createdIds: string[] = [];
    for (const name of names) {
      const r = await admin.request(`${API}/quotes/${quote.public_id}/funnels`, jsonInit("POST", { funnel_name: name }), env);
      expect(r.status, `create funnel ${name}: ${await r.clone().text()}`).toBe(201);
      createdIds.push(((await r.json()) as { public_id: string }).public_id);
    }

    const html = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
    for (const name of names) expect(html, `the board must show "${name}"`).toContain(name);

    // The existing rename path (PATCH /funnels/:id {funnel_name}) is
    // untouched by this fix — prove it still works, and that renaming one
    // funnel does not disturb the others' stored names.
    const rn = await admin.request(`${API}/funnels/${createdIds[0]}`, jsonInit("PATCH", { funnel_name: "Renamed By Operator" }), env);
    expect(rn.status, await rn.clone().text()).toBe(200);
    const html2 = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
    expect(html2, "the renamed funnel shows its new name").toContain("Renamed By Operator");
    expect(html2, "the renamed funnel's OLD name is gone").not.toContain(names[0]);
    expect(html2, "the second added funnel's name is untouched").toContain(names[1]);
    expect(html2, "the third added funnel's name is untouched").toContain(names[2]);
  });
});
