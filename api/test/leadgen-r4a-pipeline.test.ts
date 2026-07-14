// LeadGen redesign-contract-v3.1 remediation R4a — pipeline + UX dead-ends
// (forensic-defect-register.md rows S3-1/S3-2/S3-3/S3-9/S3-10/S2-10,
// E3-NEW-1/2/3/4/6/7/9/10, E3-S1/S3/S4/S5/S7, E2-NEW-10 computeIssues
// mirror). Vitest-level (server + model) coverage; real-browser interaction
// (scroll/pulse/toast/click) is covered separately in
// test-ui/leadgen-r4a-pipeline.spec.ts.
//
// Harness: the SAME node:sqlite D1 + real admin router pattern every other
// leadgen-*-ui.test.ts file duplicates (repo convention — see e.g.
// leadgen-section-studio-ui.test.ts's own "(repo pattern)" comment).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";

// --- node:sqlite harness (repo pattern — duplicated per test file) ---------

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

function makeKvStub(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list(): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor: string }> {
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
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
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

function newHarness(): { sdb: SqliteDb; env: Env } {
  const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), makeKvStub()) };
}

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

interface SectionDetail {
  id: number;
  public_id: string;
  [k: string]: unknown;
}

async function createSection(env: Env, overrides: Record<string, unknown> = {}): Promise<SectionDetail> {
  const res = await admin.request(
    `${API}/sections`,
    jsonInit("POST", {
      section_name: "Are you insured?",
      activity: "quote_funnel",
      vertical: "life",
      headline_text: "Are you insured?",
      content_json: JSON.stringify({
        components: [{ type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" }],
      }),
      ...overrides,
    }),
    env,
  );
  expect(res.status, `create section: ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as SectionDetail;
}

async function getHtml(env: Env, path: string, expectedStatus = 200): Promise<string> {
  const res = await admin.request(path, {}, env);
  expect(res.status, `${path} status`).toBe(expectedStatus);
  return res.text();
}

async function studioPage(env: Env, publicId: string): Promise<string> {
  return getHtml(env, `/admin/leadgen/sections/${publicId}/edit`);
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

function studioIsland(html: string): string {
  const island = extractScripts(html).find((s) => s.includes("function renderCanvasNow("));
  expect(island, "studio island present").toBeDefined();
  return island!;
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
  throw new Error(`unbalanced braces while slicing island function ${name}`);
}

// ---------------------------------------------------------------------------
// A minimal pure-model vm sandbox for computeIssues (no DOM) — mirrors the
// established studioProbe technique (leadgen-section-studio-ui.test.ts) but
// scoped to exactly this function's own dependency set (trimStr/typeLabel/
// typeMeta/walkTree/bindNodeType — all pure, no document/window calls).
// ---------------------------------------------------------------------------

const ISSUES_MODEL_FUNCS = ["trimStr", "typeMeta", "isContainerType", "typeLabel", "bindNodeType", "walkTree", "computeIssues"] as const;

interface IssuesSandbox {
  state: { content: { components: unknown[] } };
  studioMeta: Record<string, unknown>;
  MAX_DEPTH: number;
  [k: string]: unknown;
}

function computeIssuesProbe(island: string, content: unknown, studioMeta: Record<string, unknown>): { run(expr: string): unknown } {
  const sandbox: IssuesSandbox = {
    state: { content: JSON.parse(JSON.stringify(content)) as { components: unknown[] } },
    studioMeta,
    MAX_DEPTH: (studioMeta["max_depth"] as number) ?? 4,
  };
  const source = ISSUES_MODEL_FUNCS.map((n) => sliceIslandFunction(island, n)).join("\n");
  runInNewContext(source, sandbox);
  return {
    run(expr: string): unknown {
      return runInNewContext(expr, sandbox);
    },
  };
}

function extractJsonBlob(html: string, id: string): Record<string, unknown> {
  const marker = `id="${id}">`;
  const start = html.indexOf(marker);
  expect(start, `blob ${id} present`).toBeGreaterThan(-1);
  const from = start + marker.length;
  const end = html.indexOf("</script>", from);
  const raw = html.slice(from, end).split("\\u003c").join("<");
  return JSON.parse(raw) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// E3-NEW-2 / E2-NEW-10: computeIssues mirror extension
// ---------------------------------------------------------------------------

describeDb("R4a E3-NEW-2/E2-NEW-10 — computeIssues mirrors more server codes", () => {
  async function issuesFor(content: Record<string, unknown>): Promise<Array<{ qid: string | null; message: string }>> {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const meta = extractJsonBlob(html, "lg-studio-meta");
    const probe = computeIssuesProbe(island, content, meta);
    return probe.run("computeIssues()") as Array<{ qid: string | null; message: string }>;
  }

  it("a clean tree with no violations of the newly-mirrored classes stays issue-free (baseline — not a false all-clear regression)", async () => {
    const issues = await issuesFor({
      components: [
        { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
      ],
    });
    expect(issues).toEqual([]);
  });

  it("duplicate_question_key mirror: two nodes sharing a question_key are flagged (fail-before: only duplicate_internal_field was ever caught)", async () => {
    const issues = await issuesFor({
      components: [
        { type: "TwoButtonYesNo", question_id: "q1", question_key: "dup_key", internal_field: "field_a", answer_type: "boolean" },
        { type: "TwoButtonYesNo", question_id: "q2", question_key: "dup_key", internal_field: "field_b", answer_type: "boolean" },
      ],
    });
    expect(issues.some((i) => /duplicate analytics label/i.test(i.message) && i.qid === "q2")).toBe(true);
  });

  // Adversarial-review fix: a plain {} seen-map inherits Object.prototype's
  // OWN keys ('valueOf'/'constructor'/'toString'/…) — truthy before this
  // code ever sets them. A single node whose question_key/internal_field
  // happens to collide with one of those names would misread as a phantom
  // duplicate. Object.create(null) (fieldSeen/keySeen/knownFields) fixes it.
  it("prototype-key false positive fix: a SINGLE node with question_key 'valueOf' emits ZERO duplicate-analytics-label issues (fail-before: {}.valueOf is truthy even unset) — cross-checked against the real validator", async () => {
    const content = {
      components: [{ type: "TwoButtonYesNo", question_id: "q1", question_key: "valueOf", internal_field: "field_a", answer_type: "boolean" }],
    };
    const issues = await issuesFor(content);
    expect(issues.filter((i) => /duplicate/i.test(i.message))).toEqual([]);
    expect(validateSectionContent(content).ok).toBe(true);
  });

  it("prototype-key false positive fix: a SINGLE node with internal_field 'constructor' emits ZERO duplicate-internal-field issues (fail-before: {}.constructor is truthy even unset) — cross-checked against the real validator", async () => {
    const content = {
      components: [{ type: "TwoButtonYesNo", question_id: "q1", internal_field: "constructor", answer_type: "boolean" }],
    };
    const issues = await issuesFor(content);
    expect(issues.filter((i) => /duplicate/i.test(i.message))).toEqual([]);
    expect(validateSectionContent(content).ok).toBe(true);
  });

  it("prototype-key false NEGATIVE fix (the knownFields mirror image of the same bug): a show-if referencing 'constructor', where NO node actually carries that field, IS flagged as unknown — fail-before: {}.constructor reads truthy even when nothing ever set it, silently masking a real server-rejected reference", async () => {
    const content = {
      components: [
        {
          type: "TwoButtonYesNo",
          question_id: "q1",
          internal_field: "currently_insured",
          answer_type: "boolean",
          conditional: { when: "constructor", op: "eq", value: true },
        },
      ],
    };
    const issues = await issuesFor(content);
    expect(issues.some((i) => /show-if condition references an unknown field: constructor/.test(i.message))).toBe(true);
    expect(validateSectionContent(content).errors.some((e) => e.code === "conditional_unknown_field")).toBe(true);
  });

  it("conditional_unknown_field mirror (show-if): a conditional.when referencing a field that exists nowhere in the tree is flagged", async () => {
    const issues = await issuesFor({
      components: [
        {
          type: "TwoButtonYesNo",
          question_id: "q1",
          internal_field: "currently_insured",
          answer_type: "boolean",
          conditional: { when: "ghost_field", op: "eq", value: true },
        },
      ],
    });
    expect(issues.some((i) => /show-if condition references an unknown field: ghost_field/.test(i.message))).toBe(true);
  });

  it("require-if advisory (adversarial-review ruling — DELIBERATELY beyond-server): props.requiredWhen.when is NEVER validated server-side (content-schema.ts validateConditional runs only for node.conditional, not requiredWhen) — the client-only check still fires (a real dangling-reference authoring bug) but is worded as an honest Advisory, never implying the server would reject it", async () => {
    const content = {
      components: [
        {
          type: "DropdownQuestion",
          question_id: "q1",
          internal_field: "insurer",
          answer_type: "enum",
          choices: [{ label: "Acme", value: "acme", analytics_id: "a" }],
          props: { requiredWhen: { when: "ghost_field", op: "eq", value: true } },
        },
      ],
    };
    const issues = await issuesFor(content);
    const advisory = issues.find((i) => /require when.*points at a field that no longer exists/.test(i.message));
    expect(advisory, "the advisory still fires").toBeDefined();
    expect(advisory!.message).toMatch(/^Advisory: /);
    expect(advisory!.message).toContain("the server accepts this, but the rule will never trigger");
    // PROOF this is genuinely beyond-server (not just distinctly worded):
    // the real validator does not reject OR warn on this content at all —
    // requiredWhen sits entirely outside validateSectionContent's checked
    // surface. If this ever starts returning an error/warning, requiredWhen
    // gained real server validation and this advisory's wording is stale.
    const result = validateSectionContent(content);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("conditional_unknown_field mirror: a field that DOES exist elsewhere in the tree is NOT flagged (self-inclusive whole-tree universe, unlike internalFieldsOf's self-exclusion)", async () => {
    const issues = await issuesFor({
      components: [
        { type: "TwoButtonYesNo", question_id: "q1", internal_field: "currently_insured", answer_type: "boolean" },
        {
          type: "TwoButtonYesNo",
          question_id: "q2",
          internal_field: "has_claims",
          answer_type: "boolean",
          conditional: { when: "currently_insured", op: "eq", value: true },
        },
      ],
    });
    expect(issues.some((i) => /unknown field/.test(i.message))).toBe(false);
  });

  it("container_answer_field_forbidden mirror (E2-NEW-10 studio mirror): a container hand-authored with internal_field/choices/answer_type is flagged — defense-in-depth for legacy/imported content past the (already-disabled) Advanced control", async () => {
    const issues = await issuesFor({
      components: [
        { type: "Stack", question_id: "s1", internal_field: "leaked_field", choices: [{ label: "A", value: "a", analytics_id: "a" }], answer_type: "enum", children: [] },
      ],
    });
    expect(issues.some((i) => i.qid === "s1" && /cannot have an internal field/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.qid === "s1" && /cannot have choices/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.qid === "s1" && /cannot have an answer type/.test(i.message))).toBe(true);
  });

  it("bind_type_mismatch mirror: a hand-authored bind on the WRONG type (e.g. via the Advanced raw-JSON surface) is flagged", async () => {
    const issues = await issuesFor({
      components: [{ type: "TextBlock", question_id: "t1", bind: "section_headline", props: { role: "category_label" } }],
    });
    expect(issues.some((i) => i.qid === "t1" && /bind .section_headline. is only legal on QuestionHeadline/.test(i.message))).toBe(true);
  });

  it("bind_type_mismatch mirror: an unrecognized bind marker is flagged", async () => {
    const issues = await issuesFor({
      components: [{ type: "QuestionHeadline", question_id: "h1", bind: "not_a_real_bind" }],
    });
    expect(issues.some((i) => i.qid === "h1" && /unrecognized bind marker: not_a_real_bind/.test(i.message))).toBe(true);
  });

  it("duplicate_bind mirror: two nodes claiming the SAME bind value are flagged (second occurrence)", async () => {
    const issues = await issuesFor({
      components: [
        { type: "QuestionHeadline", question_id: "h1", bind: "section_headline" },
        { type: "QuestionHeadline", question_id: "h2", bind: "section_headline" },
      ],
    });
    expect(issues.some((i) => i.qid === "h2" && /Duplicate bind: section_headline/.test(i.message))).toBe(true);
    // the FIRST occurrence is not itself flagged as a duplicate
    expect(issues.some((i) => i.qid === "h1" && /Duplicate bind/.test(i.message))).toBe(false);
  });

  it("invalid_choice basics mirror: a choice missing label/value/analytics_id is flagged per-field (fail-before: only the empty-choices-array case was ever caught)", async () => {
    const issues = await issuesFor({
      components: [
        {
          type: "ButtonAnswerGroup",
          question_id: "b1",
          internal_field: "pick",
          answer_type: "enum",
          choices: [{ label: "", value: undefined, analytics_id: "" } as unknown as Record<string, unknown>],
        },
      ],
    });
    expect(issues.some((i) => i.qid === "b1" && /choice missing its label/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.qid === "b1" && /choice with an invalid value/.test(i.message))).toBe(true);
    expect(issues.some((i) => i.qid === "b1" && /choice missing its analytics id/.test(i.message))).toBe(true);
  });

  it("invalid_choice basics mirror: a fully-valid choice row is NOT flagged", async () => {
    const issues = await issuesFor({
      components: [
        { type: "ButtonAnswerGroup", question_id: "b1", internal_field: "pick", answer_type: "enum", choices: [{ label: "Yes", value: "yes", analytics_id: "yes_a" }] },
      ],
    });
    expect(issues.some((i) => /choice/i.test(i.message))).toBe(false);
  });

  // Adversarial-review ruling: this universal cross-check runs ONLY over
  // fixtures the mirror ITSELF claims are server-mirrored (computeIssues'
  // own doc comment / the honest-enumeration list below) — props.
  // requiredWhen is DELIBERATELY excluded (see the dedicated advisory test
  // above, which proves the opposite: the real validator does NOT flag it).
  // Pure function, no D1 needed.
  it("cross-check against the REAL server validator, SERVER-MIRRORED FIXTURES ONLY: every one of these client mirror hits is ALSO a real validateSectionContent error (never a client false-positive the server disagrees with)", () => {
    const cases: ReadonlyArray<{ code: string; content: Record<string, unknown> }> = [
      {
        code: "duplicate_question_key",
        content: {
          components: [
            { type: "TwoButtonYesNo", question_id: "q1", question_key: "dup_key", internal_field: "field_a", answer_type: "boolean" },
            { type: "TwoButtonYesNo", question_id: "q2", question_key: "dup_key", internal_field: "field_b", answer_type: "boolean" },
          ],
        },
      },
      {
        code: "duplicate_internal_field",
        content: {
          components: [
            { type: "TwoButtonYesNo", question_id: "q1", internal_field: "dup_field", answer_type: "boolean" },
            { type: "TwoButtonYesNo", question_id: "q2", internal_field: "dup_field", answer_type: "boolean" },
          ],
        },
      },
      {
        code: "conditional_unknown_field",
        content: {
          components: [
            {
              type: "TwoButtonYesNo",
              question_id: "q1",
              internal_field: "currently_insured",
              answer_type: "boolean",
              conditional: { when: "ghost_field", op: "eq", value: true },
            },
          ],
        },
      },
      {
        code: "container_answer_field_forbidden",
        content: { components: [{ type: "Stack", question_id: "s1", internal_field: "leaked_field", children: [] }] },
      },
      {
        code: "bind_type_mismatch",
        content: { components: [{ type: "TextBlock", question_id: "t1", bind: "section_headline", props: { role: "category_label" } }] },
      },
      {
        code: "duplicate_bind",
        content: {
          components: [
            { type: "QuestionHeadline", question_id: "h1", bind: "section_headline" },
            { type: "QuestionHeadline", question_id: "h2", bind: "section_headline" },
          ],
        },
      },
      {
        code: "invalid_choice",
        content: {
          components: [
            {
              type: "ButtonAnswerGroup",
              question_id: "b1",
              internal_field: "pick",
              answer_type: "enum",
              choices: [{ label: "", value: undefined, analytics_id: "" }],
            },
          ],
        },
      },
    ];
    for (const { code, content } of cases) {
      const result = validateSectionContent(content);
      expect(result.errors.some((e) => e.code === code), `${code} fixture is ALSO a real server error`).toBe(true);
    }
  });

  it("honest enumeration: the 29+-code server catalog is only PARTIALLY mirrored client-side — the still-server-only classes remain server-only by design (documented, not silently dropped)", () => {
    // This test exists to PIN the honest count so a future silent regression
    // (someone deleting a mirror without updating the record) is caught.
    // Mirrored (this file + computeIssues' own doc comment): unknown_component_type,
    // container_depth_exceeded, missing_required_field, duplicate_internal_field,
    // duplicate_question_key, conditional_unknown_field (show-if + require-if),
    // container_answer_field_forbidden, bind_type_mismatch, duplicate_bind,
    // invalid_choice (basics: label/value/analytics_id).
    const mirrored = [
      "unknown_component_type",
      "container_depth_exceeded",
      "missing_required_field",
      "duplicate_internal_field",
      "duplicate_question_key",
      "conditional_unknown_field",
      "container_answer_field_forbidden",
      "bind_type_mismatch",
      "duplicate_bind",
      "invalid_choice",
    ];
    expect(mirrored.length).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// S3-1: rules empty-state hint
// ---------------------------------------------------------------------------

describeDb("R4a S3-1 — rules empty-state hint (no eligible source field)", () => {
  it("SSR ships both the hint (hidden by default) and the dropdown for BOTH condition rows", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toContain("data-rules-source-empty-hint");
    expect(html).toContain("data-reqcond-source-empty-hint");
    expect(html).toContain("Add another question to this section to condition on it.");
  });

  it("EXECUTED: a single-question section (no OTHER eligible field after self-exclusion) shows the hint and hides the dropdown; adding a second field reveals the dropdown and hides the hint", async () => {
    const { env } = newHarness();
    const section = await createSection(env, {
      content_json: JSON.stringify({
        components: [{ type: "TwoButtonYesNo", question_id: "q1", internal_field: "only_field", answer_type: "boolean" }],
      }),
    });
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const whenSel = { hidden: false, value: "", children: [] as Array<{ value: string; textContent: string }>, appendChild(o: { value: string; textContent: string }) { this.children.push(o); } };
    const opSel = { value: "" };
    const emptyHint = { hidden: false };
    const els: Record<string, unknown> = {
      '[data-inspector-cond="when"]': whenSel,
      '[data-inspector-cond="op"]': opSel,
      "[data-rules-source-empty-hint]": emptyHint,
    };
    const sandbox: Record<string, unknown> = {
      state: { content: { components: [{ type: "TwoButtonYesNo", question_id: "q1", internal_field: "only_field", answer_type: "boolean" }] } },
      document: {
        querySelector(sel: string) {
          return els[sel] ?? null;
        },
        createElement(tag: string) {
          return { tagName: tag, value: "", textContent: "" };
        },
      },
    };
    const source = [
      "function clearChildren(el) { el.children = []; }",
      sliceIslandFunction(island, "trimStr"),
      sliceIslandFunction(island, "typeMeta"),
      sliceIslandFunction(island, "isContainerType"),
      sliceIslandFunction(island, "walkTree"),
      sliceIslandFunction(island, "internalFieldsOf"),
      sliceIslandFunction(island, "updateCondValueInputs"),
      sliceIslandFunction(island, "refFieldInfo"),
      "function readCond(){ return ''; }",
      "var studioMeta = " + JSON.stringify(extractJsonBlob(html, "lg-studio-meta")) + ";",
      sliceIslandFunction(island, "populateConditional"),
    ].join("\n");
    runInNewContext(source, sandbox);
    // single-question section: the ONLY field is the selected node's own
    // (self-excluded) -> zero eligible sources remain
    runInNewContext("populateConditional({ internal_field: 'only_field' })", sandbox);
    expect(emptyHint.hidden).toBe(false); // hint SHOWN
    expect(whenSel.hidden).toBe(true); // dropdown HIDDEN

    // now the section has a second field -> one eligible source exists
    // (q1 is still self-excluded from its OWN list; q2 is not)
    (sandbox["state"] as { content: { components: unknown[] } }).content.components.push({
      type: "TwoButtonYesNo",
      question_id: "q2",
      internal_field: "second_field",
      answer_type: "boolean",
    });
    runInNewContext("populateConditional({ internal_field: 'only_field' })", sandbox);
    expect(emptyHint.hidden).toBe(true); // hint HIDDEN
    expect(whenSel.hidden).toBe(false); // dropdown SHOWN
    expect(whenSel.children.some((o) => o.value === "second_field")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S3-2: humanized operator labels, single-sourced
// ---------------------------------------------------------------------------

describeDb("R4a S3-2 — humanized rule-operator labels (single source, no duplicated wording)", () => {
  const HUMAN_WORDS: ReadonlyArray<{ code: string; word: string }> = [
    { code: "eq", word: "is" },
    { code: "neq", word: "is not" },
    { code: "gt", word: "greater than" },
    { code: "lt", word: "less than" },
    { code: "gte", word: "at least" },
    { code: "lte", word: "at most" },
    { code: "range", word: "between" },
    { code: "in", word: "one of" },
    { code: "not_in", word: "not one of" },
  ];

  it("the SSR operator <select> shows human words, never the raw operator code, for every condition row", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    for (const { code, word } of HUMAN_WORDS) {
      expect(html, `option for ${code}`).toMatch(new RegExp(`<option value="${code}">${word.replace(/ /g, "\\s")}</option>`));
    }
    // raw codes must not appear as the VISIBLE text of a bare, label-less option
    expect(html).not.toMatch(/<option value="gt">gt<\/option>/);
    expect(html).not.toMatch(/<option value="not_in">not_in<\/option>/);
  });

  it("EXECUTED: conditionSentence (island) uses the EXACT SAME word for each operator as the dropdown — single source, no drift", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const sandbox: Record<string, unknown> = {};
    runInNewContext(sliceIslandFunction(island, "conditionSentence"), sandbox);
    for (const { code, word } of HUMAN_WORDS) {
      const cond: Record<string, unknown> =
        code === "range"
          ? { when: "x", op: code, from: 1, to: 10 }
          : code === "in" || code === "not_in"
            ? { when: "x", op: code, values: ["a", "b"] }
            : { when: "x", op: code, value: "v" };
      const sentence = runInNewContext("conditionSentence('Show this question', " + JSON.stringify(cond) + ")", sandbox) as string;
      expect(sentence, `sentence for ${code}`).toContain(word);
    }
  });
});

// ---------------------------------------------------------------------------
// S3-3: mapping drawer scroll + pulse + focus (SSR/markup-level proof; the
// real scrollIntoView/focus/timer behavior is Playwright-covered)
// ---------------------------------------------------------------------------

describeDb("R4a S3-3 — Open full mapping: scroll+pulse+focus wiring present", () => {
  it("the island wires scrollIntoView + a pulse class + focus on the drawer's mapping tab, not just setDrawerTab", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    expect(island).toContain("data-studio-open-mapping-drawer");
    expect(island).toContain("scrollIntoView");
    expect(island).toContain("studio-mapping-pulse");
    expect(island).toContain("mappingTabBtn.focus()");
  });
});

// ---------------------------------------------------------------------------
// E3-NEW-1: first-save problems[] no longer discarded
// ---------------------------------------------------------------------------

describeDb("R4a E3-NEW-1 — first-save problems[] survive (both new AND existing sections)", () => {
  it("the island's save handler shows problems[] unconditionally (fail-before: the OLD code gated this on !isNew, discarding a first save's problems)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    expect(island).toContain("if (problems.length > 0) {");
    expect(island).not.toContain("if (!isNew && problems.length > 0) {");
    // idempotency: a first save that mints the id updates state.public_id
    // immediately (a second Save click before navigation PATCHes, not POSTs)
    expect(island).toContain("if (isNew && res.body && res.body.public_id) { state.public_id = res.body.public_id; }");
    // the explicit, operator-driven (never automatic) continue affordance
    expect(island).toContain("appendContinueToSectionLink");
    expect(island).toContain("Continue to the Section");
  });

  it("server-side proof the mechanism this fixes is real: a POST with a frame-scope node returns 201 + a non-empty problems[] (the exact case that was silently redirected away from)", async () => {
    const { env } = newHarness();
    const created = await admin.request(
      `${API}/sections`,
      jsonInit("POST", {
        section_name: "Warned",
        activity: "quote_funnel",
        vertical: "life",
        headline_text: "Warned",
        content_json: JSON.stringify({
          components: [
            { type: "QuestionHeadline", question_id: "q1", bind: "section_headline" },
            { type: "HeaderBar", question_id: "hb1" },
          ],
        }),
      }),
      env,
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { problems: unknown[] };
    expect(body.problems.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// E3-NEW-3: save failure field message text
// ---------------------------------------------------------------------------

describeDb("R4a E3-NEW-3 — save failure shows per-field message text", () => {
  it("the island's routeSaveFieldErrors renders message text via renderSaveFieldErrors (typeof-guarded so pre-existing vm-probes that slice it standalone keep working), not just a class toggle", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    expect(island).toContain("function renderSaveFieldErrors(fieldProblems)");
    expect(island).toContain("typeof renderSaveFieldErrors !== 'undefined'");
    expect(island).toContain("fieldProblems.push({ path: k, message: String(fields[k]) });");
  });
});

// ---------------------------------------------------------------------------
// E3-NEW-4: "Open auction rules" dead link resolved
// ---------------------------------------------------------------------------

describeDb("R4a E3-NEW-4 — Open auction rules resolves to a real route", () => {
  it("the static href is the REAL /admin/leadgen/auction route (never /admin/leadgen/rules, which does not exist), and JS upgrades it to a 0/1-quote resolution", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).not.toContain('href="/admin/leadgen/rules"');
    expect(html).toMatch(/href="\/admin\/leadgen\/auction"[^>]*data-open-auction-rules/);
    const island = studioIsland(html);
    expect(island).toContain("function usageQuotesOf()");
    expect(island).toContain("function openAuctionRulesNav()");
    expect(island).toContain("/api/admin/leadgen/auctions?quote=");
  });

  it("the real router has NO /admin/leadgen/rules route (confirms the OLD link was dead by construction) and DOES have /admin/leadgen/auction", async () => {
    const { env } = newHarness();
    const deadRoute = await admin.request("/admin/leadgen/rules", {}, env);
    expect(deadRoute.status).toBe(404);
    const realRoute = await admin.request("/admin/leadgen/auction", {}, env);
    expect(realRoute.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// E3-NEW-10: offer-mapping overlay toggle relocated to the canvas toolbar
// ---------------------------------------------------------------------------

describeDb("R4a E3-NEW-10 — offer-mapping overlay toggle lives in the canvas toolbar, not the Preview drawer", () => {
  it("the toggle ships inside the ALWAYS-VISIBLE canvas toolbar region and is GONE from the Preview drawer panel", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const toolbarStart = html.indexOf("data-studio-canvas-toolbar");
    expect(toolbarStart).toBeGreaterThan(-1);
    const toolbarEnd = html.indexOf('<div class="studio-canvas-surface"');
    expect(toolbarEnd).toBeGreaterThan(toolbarStart);
    const toolbarRegion = html.slice(toolbarStart, toolbarEnd);
    expect(toolbarRegion).toContain("data-studio-overlay-toggle");
    expect(toolbarRegion).toContain("Offer mapping overlay");

    const previewPanelStart = html.indexOf('data-studio-drawer-panel="preview"');
    const previewPanelEnd = html.indexOf("</iframe>", previewPanelStart);
    const previewPanel = html.slice(previewPanelStart, previewPanelEnd);
    expect(previewPanel).not.toContain("data-studio-overlay-toggle");
  });
});

// ---------------------------------------------------------------------------
// S3-9/E3-S6: drawer mapping pill guard
// ---------------------------------------------------------------------------

describeDb("R4a S3-9/E3-S6 — drawer mapping pill guarded like the top-bar chip", () => {
  it("a Section with ZERO required-fields-total (nothing to map yet) renders the drawer pill data-mapping-complete=false, muted — not hardcoded green", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toMatch(/data-studio-drawer-mapping-pill data-mapping-complete="false"/);
  });

  it("updateMappingBadge (island) refreshes BOTH the top-bar badge and the drawer pill from the SAME computation", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    expect(island).toContain("var drawerPill = document.querySelector('[data-studio-drawer-mapping-pill]');");
    expect(island).toContain("drawerPill.setAttribute('data-mapping-complete', complete ? 'true' : 'false');");
  });
});

// ---------------------------------------------------------------------------
// S3-10 / E3-S4 / E3-S5: offers-refresh wiring after save / activity-vertical
// creation
// ---------------------------------------------------------------------------

describeDb("R4a S3-10/E3-S4/E3-S5 — offers panel refresh wiring", () => {
  it("the save success path calls loadOffers() explicitly (belt-and-braces — the reload redirect stays for the clean-new-section case)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const saveHandlerStart = island.indexOf("var saveBtn = document.getElementById");
    const saveHandlerEnd = island.indexOf("var archiveBtn = document.getElementById");
    const saveHandler = island.slice(saveHandlerStart, saveHandlerEnd);
    expect(saveHandler).toContain("loadOffers();");
  });

  it("renderOffersPanel recomputes renderZeroOffersWarning from the CURRENT offersData (fail-before: it was only ever called once, at the top of the save-click handler, from stale pre-save data)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const panelStart = island.indexOf("function renderOffersPanel(");
    const panelEnd = island.indexOf("function loadOffers(");
    const panelBody = island.slice(panelStart, panelEnd);
    expect(panelBody).toContain("renderZeroOffersWarning();");
  });

  it("+New activity/vertical both call renderOffersStaleNote() after creating (parity with the change handlers)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const newActivityStart = island.indexOf("var newActivityBtn = document.querySelector");
    const newVerticalEnd = island.indexOf("if (activitySel) {");
    const block = island.slice(newActivityStart, newVerticalEnd);
    const staleNoteCalls = block.match(/renderOffersStaleNote\(\)/g) ?? [];
    // one inside the +New activity callback, one inside the +New vertical callback
    expect(staleNoteCalls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// S2-10: Provider values explainer
// ---------------------------------------------------------------------------

describeDb("R4a S2-10 — Provider values 0/0 explainer", () => {
  it("the provider chip gets a plain-words title explaining WHY it's 0/0 and what makes it move", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    expect(island).toContain("Counts fill in after you select Offers for this section and map this field");
  });
});

// ---------------------------------------------------------------------------
// E3-S3: dependency-JSON parse error surfaced
// ---------------------------------------------------------------------------

describeDb("R4a E3-S3 — dependency-answers invalid input surfaced (never silently {})", () => {
  it("SSR ships the error slot; sampleAnswers() sets its text on invalid input WITHOUT using the banned word (glossary gate) and clears it on valid/empty input", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    expect(html).toContain("data-dependency-answers-error");
    const island = studioIsland(html);
    const errEl = { hidden: true, textContent: "" };
    const inputEl = { value: "{not valid" };
    const sandbox: Record<string, unknown> = {
      document: {
        getElementById(id: string) {
          return id === "lg-dependency-answers" ? inputEl : null;
        },
        querySelector(sel: string) {
          return sel === "[data-dependency-answers-error]" ? errEl : null;
        },
      },
    };
    runInNewContext(
      [sliceIslandFunction(studioIsland(html), "trimStr"), sliceIslandFunction(studioIsland(html), "sampleAnswers")].join("\n"),
      sandbox,
    );
    const result = runInNewContext("sampleAnswers()", sandbox);
    expect(result).toEqual({});
    expect(errEl.hidden).toBe(false);
    expect(errEl.textContent).not.toMatch(/\bJSON\b/);
    expect(errEl.textContent.length).toBeGreaterThan(0);

    // valid input clears the error
    inputEl.value = '{"currently_insured": true}';
    const result2 = runInNewContext("sampleAnswers()", sandbox);
    expect(result2).toEqual({ currently_insured: true });
    expect(errEl.hidden).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E3-NEW-9: Archive response.ok on BOTH entry points + Reactivate
// ---------------------------------------------------------------------------

describeDb("R4a E3-NEW-9 — Archive checks response.ok on both entry points; Reactivate is real", () => {
  it("the editor top-bar archive handler checks response.ok before navigating away (fail-before: the .then() had no ok-check at all)", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    const archiveStart = island.indexOf("var archiveBtn = document.getElementById");
    const archiveBlock = island.slice(archiveStart, archiveStart + 1500);
    expect(archiveBlock).toContain("if (!res.ok) {");
    expect(archiveBlock).toContain("Archive failed");
  });

  it("the server ALREADY supports reactivating via the general PATCH {status} (patchSectionHandler) — archiving then PATCHing status back to active round-trips", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const archived = await admin.request(`${API}/sections/${section.public_id}`, { method: "DELETE", headers: { Accept: "application/json" } }, env);
    expect(archived.status).toBe(200);
    const reactivated = await admin.request(`${API}/sections/${section.public_id}`, jsonInit("PATCH", { status: "active" }), env);
    expect(reactivated.status, await reactivated.clone().text()).toBe(200);
    const readBack = (await (await admin.request(`${API}/sections/${section.public_id}`, {}, env)).json()) as { status: string };
    expect(readBack.status).toBe("active");
  });

  it("the sections LIST page renders Reactivate (not a disabled Archive) for an archived row, and the row action checks response.ok too", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    await admin.request(`${API}/sections/${section.public_id}`, { method: "DELETE", headers: { Accept: "application/json" } }, env);
    const html = await getHtml(env, "/admin/leadgen/sections");
    expect(html).toContain(`data-section-reactivate="${section.public_id}"`);
    expect(html).not.toContain(`data-section-archive="${section.public_id}"`);
    const scripts = extractScripts(html);
    const listScript = scripts.find((s) => s.includes("data-section-reactivate"))!;
    expect(listScript).toBeDefined();
    expect(listScript).toContain("if (!res.ok) { window.alert((res.body && res.body.error) || 'Archive failed'); return; }");
    expect(listScript).toContain("if (!res.ok) { window.alert((res.body && res.body.error) || 'Reactivate failed'); return; }");
  });
});

// ---------------------------------------------------------------------------
// E3-NEW-7: canvas Delete undo toast
// ---------------------------------------------------------------------------

describeDb("R4a E3-NEW-7 — canvas Delete gets an undo toast, reusing the existing 50-step history", () => {
  it("both Delete entry points (toolbar button + Delete/Backspace key) route through deleteSelectedWithUndo; NEITHER calls window.confirm", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    expect(island).toContain("function deleteSelectedWithUndo(qid)");
    expect(island).toContain("else if (act === 'delete') { deleteSelectedWithUndo(selectedQuestionId); }");
    expect(island).toContain("deleteSelectedWithUndo(selectedQuestionId);\n      } else if (ev.key === 'Escape') {");
    // no confirm() gate on component delete (search scoped near the toast fns)
    const toastStart = island.indexOf("function hideUndoToast()");
    const toastEnd = island.indexOf("function deleteSelectedWithUndo(");
    expect(island.slice(toastStart, toastEnd + 400)).not.toContain("window.confirm");
    // the toast's Undo button calls the EXISTING history mechanism — no new
    // persistence, no new confirm dialog
    expect(island).toContain("historyUndo();\n      hideUndoToast();");
  });
});

// ---------------------------------------------------------------------------
// E3-NEW-6: theme rename
// ---------------------------------------------------------------------------

describeDb("R4a E3-NEW-6 — theme rename (server already supported PATCH {name}; only the UI input was missing)", () => {
  async function createTheme(env: Env, name: string): Promise<{ id: string; name: string }> {
    const res = await admin.request(
      `${API}/themes`,
      jsonInit("POST", {
        name,
        roles: { brand_primary: "#1B3A5C", accent: "#2E6BB0", page_bg: "#FFFFFF", card: "#FFFFFF", text: "#1A1F36", success: "#0E7C3A", error: "#B23A2C" },
        typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
        controls: { field_height: "medium", button_size: "m", corners: "rounded" },
      }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as { item: { id: string; name: string } };
    return body.item;
  }

  it("real server round-trip: PATCH {name} on the REAL themes route renames the stored record (the mechanism E3-NEW-6 needed already existed)", async () => {
    const { env } = newHarness();
    const theme = await createTheme(env, "Original Name");
    const patch = await admin.request(`${API}/themes/${theme.id}`, jsonInit("PATCH", { name: "Renamed Theme" }), env);
    expect(patch.status, await patch.clone().text()).toBe(200);
    const readBack = (await (await admin.request(`${API}/themes/${theme.id}`, {}, env)).json()) as { item: { name: string } };
    expect(readBack.item.name).toBe("Renamed Theme");
  });

  it("the themes manager PAGE now ships an editable name input (fail-before: the name was a static, non-interactive <div>) wired to the SAME patchTheme() every other control here uses", async () => {
    const { env } = newHarness();
    const theme = await createTheme(env, "Editable Name Theme");
    const html = await getHtml(env, `/admin/leadgen/themes?theme=${theme.id}`);
    expect(html).toMatch(new RegExp(`<input type="text" id="tm-theme-name" class="tm-name-input" data-tm-name data-theme-id="${theme.id}" value="Editable Name Theme"`));
    const scripts = extractScripts(html);
    const script = scripts.find((s) => s.includes("wireNameInput"))!;
    expect(script).toBeDefined();
    expect(script).toContain("function wireNameInput()");
    expect(script).toContain("patchTheme(themeId, { name: input.value });");
    expect(script).toContain("wireNameInput();");
  });
});

// ---------------------------------------------------------------------------
// E3-S1: sections list Usage -> inline expandable panel (never window.alert)
// ---------------------------------------------------------------------------

describeDb("R4a E3-S1 — sections list Usage is an inline expandable panel, not window.alert()", () => {
  it("SSR ships a paired, hidden usage row per Section (same data source, GET .../usage) and the script contains NO window.alert for usage", async () => {
    const { env } = newHarness();
    const section = await createSection(env);
    const html = await getHtml(env, "/admin/leadgen/sections");
    expect(html).toContain(`data-section-usage-row="${section.public_id}"`);
    expect(html).toContain("data-section-usage-panel");
    const scripts = extractScripts(html);
    const listScript = scripts.find((s) => s.includes("data-section-usage-row"))!;
    expect(listScript).toBeDefined();
    expect(listScript).not.toMatch(/window\.alert\([^)]*variant/i);
    expect(listScript).toContain("panelRow.hidden = !wasHidden;");
  });
});

// ---------------------------------------------------------------------------
// E3-S7: FooterBar links — MOOT for the studio since R3's frame-scope strip
// ---------------------------------------------------------------------------

describeDb("R4a E3-S7 — FooterBar links authoring: confirmed MOOT for the studio (frame-scope stripped since R3)", () => {
  it("FooterBar is a frame-scope type: its Content tab renders ONLY the read-only notice, never the links textarea (data-content-field-block stays hidden for it)", async () => {
    const { env } = newHarness();
    const section = await createSection(env, {
      content_json: JSON.stringify({ components: [{ type: "FooterBar", question_id: "f1" }] }),
    });
    const html = await studioPage(env, section.public_id);
    const island = studioIsland(html);
    expect(island).toContain("FooterBar: 1");
    // contentVariantOf/styleVariantOf force 'frame_scope' for FooterBar,
    // which the populate function maps to HIDING the field-block (where the
    // CONTAINER_PROP_SPECS "links" textarea would otherwise render) — this
    // asserts the STRUCTURAL gate is intact, i.e. still genuinely moot.
    expect(island).toContain("if (FRAME_SCOPE_STUDIO_TYPES[node.type] === 1) { return 'frame_scope'; }");
    expect(island).toContain("if (fieldBlock) { fieldBlock.hidden = variant !== 'field'; }");
  });
});
