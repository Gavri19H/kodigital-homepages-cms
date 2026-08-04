// R2 P8 S4.2 — the Templates tab stops promising things that are not true.
//
// Covers contract §6 M3 (the apply-confirm dialog + the A/B arms), §6 M1 (the
// Marker icon control and the Show-label wording), §6 M9 items 1 and 5, §6 M10
// (the saved-template pill's raw enums) and §7 N12 / N17.
//
// HOW THIS FILE PROVES THINGS (E10/E11 — never hand-build both sides):
//   * the CONSUMER is the REAL shipped island: every function under test is
//     sliced verbatim out of the bytes renderTemplatesTabPanel() emits, never
//     re-typed here;
//   * the PRODUCER is the REAL admin API: the funnel's stored layout comes from
//     PUT /funnels/:id/frame, the candidate template from POST
//     /frame-template-records (so validateFrameConfig gated it), and the
//     current frame from GET /funnels/:id/frame;
//   * the ORACLE for "was that sentence true?" is POST /funnels/:id/
//     apply-template followed by a fresh GET of the same projection — the
//     dialog's claim is compared against what applying really did, which is
//     the exact check the four measured-false promises would have failed.
//     The dialog's lines are collected by DRIVING the shipped island's own
//     openApplyConfirm() over a fetch that reaches the real admin router, so
//     the preview and the apply are the same route on the same data.
//
// The retired predicate is reproduced ONCE (RETIRED_DIFF_SENTENCES below,
// copied verbatim from the implementation this slice replaced) so the
// fail-before and the pass-after are measured in the same run, on the same
// real payloads. It is a reproduction, not a claim: every assertion about
// today's behaviour runs the shipped bytes.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { renderTemplatesTabPanel } from "../src/admin/leadgen/quotes-tabs/templates";

// --- node:sqlite harness (repo pattern; see test/leadgen-rework-templates-ui.test.ts) ---

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
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
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

function newHarness(): { sdb: SqliteDb; env: Env } {
  const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

interface QuoteDetail {
  public_id: string;
  funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
}

async function createQuote(env: Env): Promise<QuoteDetail> {
  const res = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "S42 Truth Quote", activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(res.status, `create quote: ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as QuoteDetail;
}

type Json = Record<string, unknown>;

async function apiJson(env: Env, path: string, init?: RequestInit): Promise<Json> {
  const res = await admin.request(path, init ?? {}, env);
  const body = (await res.clone().json()) as Json;
  expect(res.ok, `${path}: ${res.status} ${await res.clone().text()}`).toBe(true);
  return body;
}

// A saved template record, created through the REAL validated write path.
async function saveTemplate(env: Env, name: string, frameJson: Json): Promise<Json> {
  return apiJson(env, `${API}/frame-template-records`, jsonInit("POST", { name, frame_json: frameJson }));
}

function leaf(frame: Json, path: string): unknown {
  let cur: unknown = frame;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Json)[part];
  }
  return cur;
}

// ===========================================================================
// The REAL island bytes
// ===========================================================================

function islandSource(): string {
  const panel = renderTemplatesTabPanel(true, []);
  const match = panel.match(/<script>([\s\S]*?)<\/script>/);
  expect(match, "templates panel ships its inline island").not.toBeNull();
  return match![1] ?? "";
}

function sliceIslandFn(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  expect(at, `island must declare function ${name}`).toBeGreaterThan(-1);
  const open = src.indexOf("{", at);
  let depth = 0;
  let i = open;
  for (; i < src.length; i += 1) {
    const ch = src.charAt(i);
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return src.slice(at, i + 1);
}

function sliceIslandVar(src: string, name: string): string {
  const m = src.match(new RegExp(`^\\s*var ${name} = .*$`, "m"));
  expect(m, `island must declare var ${name}`).not.toBeNull();
  return (m![0] ?? "").trim();
}

// The confirm-dialog closure, rebuilt from the shipped bytes. The var manifest
// is hand-listed on purpose (the repo's existing island-harness convention) —
// a renamed/removed helper surfaces as a failing slice, never as a silent skip.
const CONFIRM_FNS = [
  "isRecord",
  "getPath",
  "progressStyleLabel",
  "boardFunnels",
  "boardFunnelBy",
  "lgHashParam",
  "targetFunnelPublicId",
  "currentEffectiveFrame",
  "shadowLayers",
  "pinnedAbove",
  "sameLeaf",
  "countArmChanges",
  "templateSummary",
] as const;

interface ConfirmApi {
  countArmChanges(frameJson: unknown, prefix: string, acc: number): number;
  templateSummary(frameJson: unknown): string;
}

// The A/B-arm predicate, rebuilt from the shipped bytes. `boot` is the REAL
// page blob shape: the frame projection GET /funnels/:id/frame returns, plus
// the identity keys quotes-tabs/shared.ts quoteDataBlob emits. Nothing about
// the frame is authored here.
function confirmApi(boot: Json): ConfirmApi {
  const src = islandSource();
  const body =
    [sliceIslandVar(src, "boot"), sliceIslandVar(src, "PROGRESS_LABELS")].join("\n") +
    "\n" +
    CONFIRM_FNS.map((n) => sliceIslandFn(src, n)).join("\n") +
    `\nboot = ${JSON.stringify(boot)};\n` +
    "({ countArmChanges: countArmChanges, templateSummary: templateSummary })";
  return runInNewContext(body, {
    document: { getElementById: () => null },
    window: { location: { hash: "" } },
    JSON,
    Object,
    String,
    Boolean,
    Number,
  }) as ConfirmApi;
}

// ---------------------------------------------------------------------------
// The DRIVEN apply dialog: the shipped island's own choose->confirm path, over
// a fetch that reaches the real admin router. Nothing about the confirm list is
// authored here — the <li> texts below are whatever the island painted from
// whatever POST /funnels/:id/apply-template {dry_run:true} really answered.
// ---------------------------------------------------------------------------

interface FakeNode {
  className: string;
  children: FakeNode[];
  nodeText: string;
  firstChild: FakeNode | null;
  appendChild(c: FakeNode): FakeNode;
  removeChild(c: FakeNode): FakeNode;
  getAttribute(k: string): string | null;
  querySelectorAll(sel: string): FakeNode[];
  readonly textContent: string;
}

function fakeNode(attrs: Record<string, string> = {}, nodeText = ""): FakeNode {
  const el: FakeNode = {
    className: "",
    children: [],
    nodeText,
    get firstChild() { return el.children.length > 0 ? el.children[0]! : null; },
    appendChild(c: FakeNode) { el.children.push(c); return c; },
    removeChild(c: FakeNode) { el.children = el.children.filter((x) => x !== c); return c; },
    getAttribute(k: string) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k]! : null; },
    querySelectorAll() { return []; },
    get textContent(): string { return el.nodeText + el.children.map((c) => c.textContent).join(""); },
  };
  return el;
}

const APPLY_ISLAND_FNS = [
  "byId",
  "toArray",
  "clearChildren",
  "text",
  "isRecord",
  "getPath",
  "fetchJson",
  "showError",
  "hideError",
  "boardFunnels",
  "boardFunnelBy",
  "lgHashParam",
  "targetFunnelPublicId",
  "applyDialogShowState",
  "applyLeadLine",
  "paintConfirmList",
  "openApplyConfirm",
] as const;

interface ApplyDialogDrive {
  choose(tpl: Json): Promise<void>;
  lines(): string[];
  error(): string;
  state(): string;
}

function applyDialogDrive(env: Env, boot: Json): ApplyDialogDrive {
  const src = islandSource();
  const list = fakeNode();
  const errorSlot = fakeNode();
  errorSlot.className = "lg-hidden";
  const choosePanel = fakeNode({ "data-apply-state": "choose" });
  const confirmPanel = fakeNode({ "data-apply-state": "confirm" });
  confirmPanel.className = "lg-hidden";
  const dialog = fakeNode();
  dialog.querySelectorAll = () => [choosePanel, confirmPanel];
  const byIdMap: Record<string, FakeNode> = {
    "lg-tpl-apply-confirm-list": list,
    "lg-tpl-apply-error": errorSlot,
    "lg-tpl-apply-dialog": dialog,
  };
  const pending: Array<Promise<unknown>> = [];
  const body =
    [sliceIslandVar(src, "LG_API"), sliceIslandVar(src, "boot"), sliceIslandVar(src, "applyChosenTemplate")].join("\n") +
    "\n" +
    APPLY_ISLAND_FNS.map((n) => sliceIslandFn(src, n)).join("\n") +
    `\nboot = ${JSON.stringify(boot)};\n` +
    "({ choose: openApplyConfirm })";
  const island = runInNewContext(body, {
    document: {
      getElementById: (id: string) => byIdMap[id] ?? null,
      createElement: () => fakeNode(),
      createTextNode: (t: string) => fakeNode({}, String(t)),
    },
    window: { location: { hash: "" } },
    fetch: (url: string, opts: RequestInit) => {
      const p = Promise.resolve(admin.request(url, opts, env));
      pending.push(p);
      return p;
    },
    JSON,
    Object,
    String,
    Boolean,
    Number,
    Array,
    Promise,
  }) as { choose(tpl: Json): void };
  return {
    async choose(tpl: Json) {
      island.choose(tpl);
      await Promise.all(pending);
      await new Promise((r) => setTimeout(r, 0));
    },
    lines: () => list.children.map((li) => li.textContent),
    error: () => (errorSlot.className.indexOf("lg-hidden") >= 0 ? "" : errorSlot.textContent),
    state: () => (confirmPanel.className.indexOf("lg-hidden") >= 0 ? "choose" : "confirm"),
  };
}

// ---------------------------------------------------------------------------
// The predicate this slice retired, verbatim from templates.ts before the fix
// (the `diffSentences` body at :2232-2253). Reproduced ONLY to measure the
// fail-before on the same real payloads; nothing in this file treats its output
// as correct.
// ---------------------------------------------------------------------------
function RETIRED_DIFF_SENTENCES(effectiveFrame: Json, candidateFrameJson: Json): string[] {
  const sentences: string[] = [];
  const cur = effectiveFrame as Record<string, Record<string, unknown>>;
  const cand = candidateFrameJson as Record<string, Record<string, unknown>>;
  if (cur["section_slot"] && cand["section_slot"] && cur["section_slot"]["card"] !== cand["section_slot"]["card"]) {
    sentences.push(
      "The question unit changes from a " +
        (cur["section_slot"]["card"] === "card" ? "card" : "bare layout") +
        " to a " +
        (cand["section_slot"]["card"] === "card" ? "card" : "bare layout") +
        ".",
    );
  }
  if (cur["footer"] && cand["footer"] && cur["footer"]["enabled"] !== cand["footer"]["enabled"]) {
    sentences.push(cand["footer"]["enabled"] ? "The footer will be shown." : "The footer will be hidden.");
  }
  if (cur["trust_strip"] && cand["trust_strip"] && cur["trust_strip"]["enabled"] !== cand["trust_strip"]["enabled"]) {
    sentences.push(cand["trust_strip"]["enabled"] ? "A trust strip will be added." : "The trust strip isn't part of this template's arrangement.");
  }
  if (cur["benefit_bar"] && cand["benefit_bar"] && cur["benefit_bar"]["enabled"] !== cand["benefit_bar"]["enabled"]) {
    sentences.push(cand["benefit_bar"]["enabled"] ? "A benefit bar will be added." : "The benefit bar isn't part of this template's arrangement.");
  }
  if (cur["progress"] && cand["progress"] && cur["progress"]["style"] !== cand["progress"]["style"]) {
    sentences.push("Progress style changes from " + String(cur["progress"]["style"]) + " to " + String(cand["progress"]["style"]) + ".");
  }
  if (sentences.length === 0) sentences.push("This template keeps the same overall arrangement.");
  return sentences;
}

// ===========================================================================
// §6 M3 — every sentence the confirm dialog shows is true of what apply does
// ===========================================================================

describeDb("R2 P8 S4.2 · apply-confirm promises are measured against the real apply", () => {
  it("a saved funnel: the retired predicate's 5 promises vs the sentences the shipped dialog paints, both checked against the applied result", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const funnel = q.funnels[0]!.public_id;

    // The operator's own saved layout — the "has ever been saved" funnel the
    // contract measured. Written through the real PUT.
    await apiJson(env, `${API}/funnels/${funnel}/frame`, jsonInit("PUT", {
      frame_config_json: {
        template: "centered",
        version: 1,
        section_slot: { card: "card" },
        footer: { enabled: false },
        trust_strip: { enabled: false },
        benefit_bar: { enabled: false },
        progress: { style: "numbered" },
      },
    }));

    // A saved template that disagrees on all five axes.
    const tpl = await saveTemplate(env, "S42 Opposite", {
      template: "centered",
      version: 1,
      section_slot: { card: "bare" },
      footer: { enabled: true },
      trust_strip: { enabled: true },
      benefit_bar: { enabled: true },
      progress: { style: "dots" },
    });

    const before = await apiJson(env, `${API}/funnels/${funnel}/frame`);
    const boot = { funnel_public_id: funnel, quote_public_id: q.public_id, frame: before, overrides: null };

    // The retired predicate's five fixed promises, on these real payloads.
    const retired = RETIRED_DIFF_SENTENCES(before["effective_frame"] as Json, tpl["frame_json"] as Json);
    expect(retired).toEqual([
      "The question unit changes from a card to a bare layout.",
      "The footer will be shown.",
      "A trust strip will be added.",
      "A benefit bar will be added.",
      "Progress style changes from numbered to dots.",
    ]);

    // DRIVE the shipped dialog: choose this template, let its own dry run run.
    const drive = applyDialogDrive(env, boot);
    await drive.choose(tpl);
    expect(drive.error()).toBe("");
    expect(drive.state(), "the confirm state is only entered on a successful preview").toBe("confirm");
    const lines = drive.lines();
    expect(lines[0]).toBe('"S42 Opposite" becomes this funnel’s layout template.');
    // It never repeats the retired wording, and never claims "no change".
    expect(lines.join(" ")).not.toContain("keeps the same overall arrangement");
    expect(lines.join(" ")).not.toContain("The footer will be shown.");
    // It DOES warn that the operator's own five choices are being replaced —
    // the honest half of this screen, counted from the real diff.
    expect(lines.join(" ")).toContain("settings you had customised are replaced by this template.");

    // THE ORACLE: apply for real, then re-read the same projection. Every
    // sentence the dialog painted has to hold on the applied frame.
    await apiJson(env, `${API}/funnels/${funnel}/apply-template`, jsonInit("POST", { template_id: tpl["id"] }));
    const after = await apiJson(env, `${API}/funnels/${funnel}/frame`);
    const eff = after["effective_frame"] as Json;
    const painted = lines.join(" ");
    expect(painted.indexOf("The question unit changes from a card to a bare layout.") >= 0).toBe(
      leaf(eff, "section_slot.card") === "bare",
    );
    expect(painted.indexOf("A footer will be added.") >= 0).toBe(leaf(eff, "footer.enabled") === true);
    expect(painted.indexOf("A trust strip will be added.") >= 0).toBe(leaf(eff, "trust_strip.enabled") === true);
    expect(painted.indexOf("A benefit bar will be added.") >= 0).toBe(leaf(eff, "benefit_bar.enabled") === true);
    expect(painted.indexOf("Progress changes from numbered steps to dots.") >= 0).toBe(
      leaf(eff, "progress.style") === "dots",
    );
  });

  it("a funnel with nothing of its own: the painted sentences hold leaf by leaf on the applied frame", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const funnel = q.funnels[0]!.public_id;

    const tpl = await saveTemplate(env, "S42 Bare Dots", {
      template: "centered",
      version: 1,
      section_slot: { card: "bare" },
      footer: { enabled: false },
      progress: { style: "dots" },
    });

    const before = await apiJson(env, `${API}/funnels/${funnel}/frame`);
    expect(before["frame_config"], "this funnel has authored no layout of its own").toBeNull();
    const beforeEff = before["effective_frame"] as Json;
    expect(leaf(beforeEff, "section_slot.card")).toBe("card");
    expect(leaf(beforeEff, "footer.enabled")).toBe(true);
    expect(leaf(beforeEff, "progress.style")).toBe("bar");

    const drive = applyDialogDrive(env, { funnel_public_id: funnel, quote_public_id: q.public_id, frame: before, overrides: null });
    await drive.choose(tpl);
    const lines = drive.lines();
    expect(lines).toContain("The question unit changes from a card to a bare layout.");
    expect(lines).toContain("The footer will be removed.");
    expect(lines).toContain("Progress changes from a bar to dots.");
    // Nothing the operator authored is claimed as replaced (there is nothing).
    expect(lines.join(" ")).not.toContain("you had customised");

    // THE ORACLE.
    await apiJson(env, `${API}/funnels/${funnel}/apply-template`, jsonInit("POST", { template_id: tpl["id"] }));
    const eff = (await apiJson(env, `${API}/funnels/${funnel}/frame`))["effective_frame"] as Json;
    expect(leaf(eff, "section_slot.card")).toBe("bare");
    expect(leaf(eff, "footer.enabled")).toBe(false);
    expect(leaf(eff, "progress.style")).toBe("dots");
  });

  it("a key the template never authors is never spoken about (the sparse-patch lie)", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const funnel = q.funnels[0]!.public_id;

    // Authors ONE group, and inside it NOT the style — the shape that made the
    // retired predicate render "changes from bar to undefined".
    const tpl = await saveTemplate(env, "S42 Align Only", {
      template: "centered",
      version: 1,
      progress: { align: "left" },
    });
    const before = await apiJson(env, `${API}/funnels/${funnel}/frame`);

    expect(RETIRED_DIFF_SENTENCES(before["effective_frame"] as Json, tpl["frame_json"] as Json)).toContain(
      "Progress style changes from bar to undefined.",
    );

    const drive = applyDialogDrive(env, { funnel_public_id: funnel, quote_public_id: q.public_id, frame: before, overrides: null });
    await drive.choose(tpl);
    const painted = drive.lines().join(" ");
    expect(painted).not.toContain("undefined");
    expect(painted).not.toContain("Progress changes");
  });

  it("a preview the server refuses paints no promises at all", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const funnel = q.funnels[0]!.public_id;
    const before = await apiJson(env, `${API}/funnels/${funnel}/frame`);
    const drive = applyDialogDrive(env, { funnel_public_id: funnel, quote_public_id: q.public_id, frame: before, overrides: null });
    // A template id the server does not know: the real route answers 400.
    await drive.choose({ id: 999999, name: "S42 Ghost", frame_json: { template: "centered", version: 1 } });
    expect(drive.lines()).toEqual([]);
    expect(drive.state()).toBe("choose");
    expect(drive.error().length).toBeGreaterThan(0);
  });

  it("the count of unnamed A/B-arm changes ignores what the funnel's own config pins", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const funnel = q.funnels[0]!.public_id;
    await apiJson(env, `${API}/funnels/${funnel}/frame`, jsonInit("PUT", {
      frame_config_json: { template: "centered", version: 1, progress: { align: "center", thickness: "l" } },
    }));
    const tpl = await saveTemplate(env, "S42 Two Leaves", {
      template: "centered",
      version: 1,
      progress: { align: "left", thickness: "s", width: "full" },
    });
    const before = await apiJson(env, `${API}/funnels/${funnel}/frame`);
    const api = confirmApi({ funnel_public_id: funnel, quote_public_id: q.public_id, frame: before, overrides: null });
    // align + thickness are pinned by the funnel; only `width` can move.
    expect(api.countArmChanges(tpl["frame_json"], "", 0)).toBe(1);
  });
});

// ===========================================================================
// §6 M3 (A/B arms) — the dialog can say whether the new arm would differ
// ===========================================================================

describeDb("R2 P8 S4.2 · A/B templates says what the new arm changes", () => {
  it("a template whose every leaf the funnel already pins scores zero differences", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const funnel = q.funnels[0]!.public_id;
    await apiJson(env, `${API}/funnels/${funnel}/frame`, jsonInit("PUT", {
      frame_config_json: { template: "centered", version: 1, section_slot: { card: "card" }, progress: { style: "numbered" } },
    }));
    const tpl = await saveTemplate(env, "S42 Shadowed", {
      template: "centered",
      version: 1,
      section_slot: { card: "bare" },
      progress: { style: "dots" },
    });
    const before = await apiJson(env, `${API}/funnels/${funnel}/frame`);
    const api = confirmApi({ funnel_public_id: funnel, quote_public_id: q.public_id, frame: before, overrides: null });
    expect(api.countArmChanges(tpl["frame_json"], "", 0), "both arms would render the same, so the dialog must say so").toBe(0);
  });

  it("the dialog owns the copy for both cases and names the funnel's current template", () => {
    const panel = renderTemplatesTabPanel(true, []);
    expect(panel).toContain('id="lg-tpl-ab-effect"');
    const src = islandSource();
    // the identity case (same template) is the only "identical arms" claim
    expect(src).toContain("This funnel already uses this template \\u2014 both arms would look the same.");
    // the shadowed case claims only what it can prove
    expect(src).toContain("Nothing this template sets would change on the new arm");
    expect(src).toContain("The new arm differs from the current one in ");
    expect(src).toContain("(this funnel\\u2019s current template)");
    // the current arm's template comes from the board blob, not from a guess
    expect(src).toContain("f.frame_template_id");
  });
});

// ===========================================================================
// §6 M1 — a control appears only when it does something; one wording per thing
// ===========================================================================

interface IconRowApi {
  sync(): void;
  className(): string;
}

// Drives the SHIPPED syncProgressIconRow over a minimal DOM: the row element
// and the real [data-frame-key="progress.style"] radio set the panel renders.
function iconRowApi(checkedStyle: string | null, bootStyle: string): IconRowApi {
  const src = islandSource();
  const row = { className: "" };
  const radios = ["bar", "dots", "numbered", "percent", "icon_on_track", "hidden"].map((value) => ({
    value,
    checked: value === checkedStyle,
  }));
  const body =
    [sliceIslandVar(src, "boot")].join("\n") +
    "\n" +
    ["byId", "toArray", "progressStyleRadios", "styleForIconRow", "syncProgressIconRow"].map((n) => sliceIslandFn(src, n)).join("\n") +
    `\nboot = ${JSON.stringify({ frame: { effective_frame: { progress: { style: bootStyle } } } })};\n` +
    "({ sync: syncProgressIconRow, className: function () { return __row.className; } })";
  return runInNewContext(body, {
    __row: row,
    document: {
      getElementById: (id: string) => (id === "lg-tpl-progress-icon-row" ? row : null),
      querySelectorAll: () => radios,
    },
    Array,
    JSON,
    Object,
    String,
  }) as IconRowApi;
}

describeDb("R2 P8 S4.2 · Progress box tells the truth", () => {
  it("Marker icon lives in its own row, ships hidden, and the island reveals it for icon_on_track alone", () => {
    const panel = renderTemplatesTabPanel(true, []);
    const at = panel.indexOf('id="lg-tpl-progress-icon-row"');
    expect(at, "the Marker icon select has its own row").toBeGreaterThan(-1);
    const row = panel.slice(at, panel.indexOf("</div>", at));
    expect(row).toContain("lg-hidden");
    expect(row).toContain('data-frame-key="progress.icon"');
    expect(row).toContain("Marker icon");

    for (const style of ["bar", "dots", "numbered", "percent", "hidden"]) {
      const api = iconRowApi(style, "bar");
      api.sync();
      expect(api.className(), `${style} must not offer a marker icon`).toContain("lg-hidden");
    }
    const on = iconRowApi("icon_on_track", "bar");
    on.sync();
    expect(on.className()).not.toContain("lg-hidden");
    // …and before any radio is checked the boot frame's own style decides.
    const fromBoot = iconRowApi(null, "icon_on_track");
    fromBoot.sync();
    expect(fromBoot.className()).not.toContain("lg-hidden");
  });

  it("the Show-label help quotes what a visitor actually reads, not a third wording", () => {
    const panel = renderTemplatesTabPanel(true, []);
    // R2 P8 F1 (M1 "Label wording differs three ways"): the three step
    // wordings were unified to ONE — "Step N of M" — everywhere (SSR, hook
    // path, fallback, and this help text). "2 / 5" is retired; do not restore
    // it.
    expect(panel).toContain("Step 2 of 5");
    expect(panel).toContain("A visitor sees &quot;Step 2 of 5&quot; beside the bar, or &quot;40%&quot; on Percent.");
  });
});

// ===========================================================================
// §6 M9.1 / M9.5 / §7 N12 / N17 / M10 — copy that names only real things
// ===========================================================================

describeDb("R2 P8 S4.2 · the panel stops naming places and things that do not exist", () => {
  it("M9.1: the deleted canvas is not offered as the way to override the logo", () => {
    const panel = renderTemplatesTabPanel(true, []);
    expect(panel).not.toContain("For a manual logo override");
    expect(panel).not.toContain("Header region on the canvas");
  });

  it("N12: the logo's alignment now matches Progress's — Left, Center AND Right", () => {
    const panel = renderTemplatesTabPanel(true, []);
    // R2 P8 F1 shipped the missing `.lg-frame-header--right` paint rule, so
    // the logo's Alignment control offers all three, same as Progress's —
    // "Left or centered" (the two-of-three state) no longer describes it.
    expect(panel).toContain('<option value="right">Right</option>');
    expect(panel).toContain("Where the logo sits in the header bar.");
    // the honoured set is still exactly what designs/frames.ts allows
    expect(panel).toContain('data-frame-key="header.logo_align"');
  });

  it("M9.5: the empty theme list points at the manager that really creates themes", () => {
    const src = islandSource();
    expect(src).toContain("No themes yet \\u2014 create one in the Themes manager");
    const panel = renderTemplatesTabPanel(true, []);
    expect(panel).not.toContain("Create a theme in the Themes tab");
  });

  it("N17: the footer box says free text and company details are the same block", () => {
    const panel = renderTemplatesTabPanel(true, []);
    expect(panel).toContain("Free text and company details are the same block here");
  });

  it("M10: the saved-template pill speaks the same words as the Style tiles", async () => {
    const { env } = newHarness();
    const tpl = await saveTemplate(env, "S42 Pill", {
      template: "centered",
      version: 1,
      section_slot: { card: "bare" },
      progress: { style: "icon_on_track" },
      footer: { enabled: false },
    });
    const api = confirmApi({ funnel_public_id: "x", quote_public_id: "y", frame: {}, overrides: null });
    const pill = api.templateSummary(tpl["frame_json"]);
    expect(pill).toBe("Bare layout · Icon on track progress · No footer");
    expect(pill).not.toContain("icon_on_track");
  });
});
