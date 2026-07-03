// Listicles Phase 5 — the Article builder page (§11 / §15.5 / §15.6 / §23 /
// §30.2 / §30.6):
//   * render anatomy for BOTH modes (new / edit) from fixture DTOs,
//   * strict-ES5 + node --check byte-parse over every emitted inline script,
//   * the §15.5 conflict-matrix MODEL exercised from the REAL emitted ES5
//     atom (node:vm) against the contract's payload fixture,
//   * route-level 200s over the REAL admin router + migrations
//     (/admin/listicles/articles/new + /:id/edit + 404 shell).

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import {
  listiclesArticleBuilderPage,
  CONFLICT_MATRIX_SCRIPT,
  type ArticleBuilderPageProps,
  type BuilderVersion,
} from "../src/admin/listicles/ui-article-builder";
import { SET_DIMENSIONS } from "../src/listicles/rules";
import type { ArticleRowL } from "../src/admin/listicles/articles-handlers";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const articleFixture: ArticleRowL = {
  id: 3,
  public_id: "art_fixture01",
  site_id: "st_a",
  slug: "fixture-article",
  article_name: "Fixture Article <&>",
  status: "draft",
  active_experiment_id: null,
  published_at: null,
  scheduled_at: null,
  created_by: null,
  created_at: 1700000000,
  updated_at: 1700000000,
};

const versionFixture: BuilderVersion = {
  id: 9,
  public_id: "ver_fixture01",
  article_id: 3,
  experiment_id: null,
  variant_label: "A",
  is_control: 1,
  traffic_allocation: 100,
  headline: 'Control "Headline" <script>',
  intro_paragraph: "Intro text",
  hero_media_id: null,
  hero_media_url: "https://img.example/hero.jpg",
  layout_style_id: "default",
  byline_json: JSON.stringify({
    enabled: true,
    author_name: "Jane",
    label: "Advertorial",
    updated_label: "Updated:",
    updated_date: "June 2026",
  }),
  ai_settings_json: null,
  content_version: 2,
  status: "active",
  created_at: 1700000000,
  pages: [
    {
      id: 1,
      public_id: "pg_fixture01",
      article_version_id: 9,
      page_index: 0,
      selection_mode: "rule_based",
      ab_test_id: null,
      rule_set_id: "rs_x",
      candidates: [
        {
          id: 1,
          public_id: "cand_c",
          page_id: 1,
          section_id: 11,
          section_public_id: "sec_c",
          section_name: "Section C",
          label: "C",
          traffic_allocation: null,
          is_fallback: 0,
          rule: {
            id: 1,
            public_id: "rule_c",
            priority: 1,
            conditions_json: '{"sets":{"state":["CA"],"device":["mobile"]}}',
            conditions_hash: "h1",
          },
        },
        {
          id: 2,
          public_id: "cand_e",
          page_id: 1,
          section_id: 12,
          section_public_id: "sec_e",
          section_name: "Section E",
          label: "E",
          traffic_allocation: null,
          is_fallback: 1,
          rule: null,
        },
      ],
    },
  ],
};

const editProps: ArticleBuilderPageProps = {
  mode: "edit",
  sites: [{ id: "st_a", name: "Site A" }],
  article: articleFixture,
  experiment: { id: 5, public_id: "exp_fixture01", name: "Test Exp", status: "draft" },
  versions: [versionFixture],
};

const newProps: ArticleBuilderPageProps = {
  mode: "new",
  sites: [{ id: "st_a", name: "Site A" }],
  article: null,
  experiment: null,
  versions: [],
};

const PAGES: ReadonlyArray<[string, string]> = [
  ["builder-new", listiclesArticleBuilderPage(newProps, { userEmail: "a@b.c" })],
  ["builder-edit", listiclesArticleBuilderPage(editProps, {})],
];

// ---------------------------------------------------------------------------
// Anatomy
// ---------------------------------------------------------------------------

describe("article builder — anatomy (§11/§15.5/§30.2/§30.6)", () => {
  const [, newHtml] = PAGES[0] as [string, string];
  const [, editHtml] = PAGES[1] as [string, string];

  it("new mode: base card (Site*/name/slug) + control-Version §23 fields + create action; no rail/pages/preview", () => {
    for (const marker of [
      'id="lst-a-site"',
      'id="lst-a-name"',
      'id="lst-a-slug"',
      'id="lst-v-headline"',
      'id="lst-v-intro"',
      'id="hero-image-card"',
      'id="lst-v-layout"',
      'id="lst-article-create"',
      'data-error-for="site_id"',
      'data-error-for="slug"',
      "Choose a site…",
    ]) {
      expect(newHtml, marker).toContain(marker);
    }
    expect(newHtml).not.toContain('id="lst-rail"');
    expect(newHtml).not.toContain('id="lst-pages-card"');
    expect(newHtml).not.toContain('id="lst-pv-card"');
    // Byline + AI persist through PUT /versions/:id — edit-only cards.
    expect(newHtml).not.toContain('id="lst-byline-card"');
  });

  it("edit mode: rail + Σ indicator + experiment controls + version editor + §30.2 byline + pages builder + §15.5 matrix slot + §30.6 preview + structure/publish", () => {
    for (const marker of [
      // rail (§11/§15.8)
      'id="lst-rail"',
      'id="lst-exp-sigma"',
      'id="lst-ab-create"',
      'id="lst-add-version"',
      'id="lst-exp-start"',
      'id="lst-exp-stop"',
      // version editor + §30.2 byline
      'id="lst-version-save"',
      'id="lst-byline-card"',
      'id="lst-b-enabled"',
      'id="lst-b-author"',
      'id="lst-b-avatar-file"',
      'id="lst-b-label"',
      'id="lst-b-updated-label"',
      'id="lst-b-updated-date"',
      'id="lst-v-ai-preset"',
      // pages builder + §15.5 matrix outlet
      'id="lst-pages-card"',
      'id="lst-pages-list"',
      'id="lst-page-add"',
      'id="lst-conflict-out"',
      // §30.6 preview panel
      'id="lst-pv-card"',
      'id="lst-pv-version"',
      'id="lst-pv-forces"',
      'id="lst-pv-density"',
      'id="lst-version-preview"',
      'id="lst-pv-desktop"',
      'id="lst-pv-mobile"',
      'sandbox=""',
      // section picker + §15.6/§30.7 immutability dialog
      'id="lst-section-picker"',
      'id="lst-immutable-modal"',
      'id="lst-imm-fork"',
      'id="lst-imm-revision"',
      'id="lst-imm-join"',
      // actions
      'id="lst-view-structure"',
      'id="lst-article-publish"',
      'id="lst-article-save"',
    ]) {
      expect(editHtml, marker).toContain(marker);
    }
    // §31.0 honesty is declared ON the page.
    expect(editHtml).toContain("pixel parity is gated on the §31.0 reference captures");
    // Every §15.4 set dim has a simulate input.
    for (const dim of SET_DIMENSIONS) {
      expect(editHtml, `simulate dim ${dim}`).toContain(`data-pv-dim="${dim}"`);
    }
    expect(editHtml).toContain('id="lst-pv-hour"');
    // User data is escaped.
    expect(editHtml).toContain("Fixture Article &lt;&amp;&gt;");
    expect(editHtml).not.toContain("Control \"Headline\" <script>");
  });
});

// ---------------------------------------------------------------------------
// ES5 + parse gates (repo mechanism)
// ---------------------------------------------------------------------------

const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function extractScripts(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    blocks.push(match[1] ?? "");
  }
  return blocks;
}

describe("article builder — ES5-only inline scripts (§25)", () => {
  for (const [label, html] of PAGES) {
    it(`${label}: every inline <script> is ES5 (no arrow/const/let/async/await/backtick)`, () => {
      const scripts = extractScripts(html);
      expect(scripts.length).toBeGreaterThan(0);
      for (const script of scripts) {
        expect(script).not.toMatch(/=>/);
        expect(script).not.toMatch(/\bconst\b/);
        expect(script).not.toMatch(/\blet\b/);
        expect(script).not.toMatch(/\basync\b/);
        expect(script).not.toMatch(/\bawait\b/);
        expect(script).not.toContain("`");
      }
    });
  }
});

const scratchDir = mkdtempSync(join(tmpdir(), "listicles-builder-parse-"));
let fileSeq = 0;

function parseError(label: string, source: string): string | null {
  const file = join(scratchDir, `${++fileSeq}-${label.replace(/[^\w-]/g, "_")}.js`);
  writeFileSync(file, source, "utf-8");
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    return null;
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err);
    return `${label}: ${stderr.split("\n").slice(0, 5).join("\n")}`;
  }
}

describe("article builder — emitted inline scripts parse (node --check)", () => {
  for (const [label, html] of PAGES) {
    it(`${label}: every emitted inline <script> parses as standalone JavaScript`, () => {
      const scripts = extractScripts(html);
      const errors: string[] = [];
      scripts.forEach((script, i) => {
        const err = parseError(`${label}-script${i + 1}`, script);
        if (err) errors.push(err);
      });
      expect(errors, errors.join("\n\n")).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// §15.5 conflict matrix — the REAL client atom against the contract fixture
// ---------------------------------------------------------------------------

describe("conflict matrix (§15.5) — the emitted ES5 model over the contract payload", () => {
  interface MatrixModel {
    dims: string[];
    rows: Array<{
      a: string;
      b: string;
      blocking: boolean;
      reason: string;
      cells: Record<string, string>;
    }>;
  }
  interface MatrixApi {
    model(conflicts: unknown[], warnings: unknown[]): MatrixModel;
  }

  function loadMatrixApi(): MatrixApi {
    const sandbox: { window: Record<string, unknown> } = { window: {} };
    runInNewContext(CONFLICT_MATRIX_SCRIPT, sandbox);
    return sandbox.window.lstConflictMatrix as MatrixApi;
  }

  // The §15.5 payload example, verbatim shape.
  const contractFixture = [
    {
      candidate_a: "Section A",
      candidate_b: "Section B",
      overlap: { state: ["CA"], device: ["mobile"], traffic_source: ["facebook"] },
      reason: "Both rules can match the same user at the same priority.",
    },
  ];

  it("builds the candidates × dimensions grid: overlap dims become columns, overlapping cells carry the values, equal-priority rows are blocking", () => {
    const api = loadMatrixApi();
    const m = api.model(contractFixture, []);
    expect(m.dims).toEqual(["state", "device", "traffic_source"]);
    expect(m.rows).toHaveLength(1);
    const row = m.rows[0]!;
    expect(row.a).toBe("Section A");
    expect(row.b).toBe("Section B");
    expect(row.blocking).toBe(true);
    expect(row.cells).toEqual({ state: "CA", device: "mobile", traffic_source: "facebook" });
    expect(row.reason).toBe("Both rules can match the same user at the same priority.");
  });

  it("cross-priority warnings ride as NON-blocking rows; dims union across reports incl. the hour axis", () => {
    const api = loadMatrixApi();
    const m = api.model(contractFixture, [
      {
        candidate_a: "Section B",
        candidate_b: "Section C",
        overlap: { hour: ["10:00-12:00"], state: ["CA", "NY"] },
        reason: "Rule 'Section B' can override Rule 'Section C' for these audiences.",
      },
    ]);
    expect(m.dims).toEqual(["state", "device", "traffic_source", "hour"]);
    expect(m.rows).toHaveLength(2);
    expect(m.rows[0]?.blocking).toBe(true);
    expect(m.rows[1]?.blocking).toBe(false);
    expect(m.rows[1]?.cells.hour).toBe("10:00-12:00");
    expect(m.rows[1]?.cells.state).toBe("CA, NY");
    expect(m.rows[1]?.cells.device).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Route-level 200s (REAL admin router + migrations)
// ---------------------------------------------------------------------------

type SqliteStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};
type SqliteDb = {
  prepare(sql: string): SqliteStatement;
  close(): void;
  [method: string]: unknown;
};
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    const mod = nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
    return mod.DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as {
        getBuiltinModule?: (name: string) => unknown;
      }).getBuiltinModule;
      if (typeof getBuiltin === "function") {
        const mod = getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
        return mod.DatabaseSync;
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
          const r = sdb.prepare(sql).get(...binds);
          return (r ?? null) as T | null;
        },
        async all<T = unknown>() {
          const rows = sdb.prepare(sql).all(...binds);
          return { results: rows as T[], success: true, meta: {} };
        },
        async run() {
          sdb.prepare(sql).run(...binds);
          return { success: true, meta: {} };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const statement of statements) {
          results.push(await statement.run());
        }
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

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

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

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

describeDb("article builder — shell routes over the REAL admin router", () => {
  function newRouteHarness(): { env: Env } {
    const ctor = DatabaseSync as DatabaseSyncCtor;
    const sdb = new ctor(":memory:");
    runSql(
      sdb,
      "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, vertical_slug TEXT, activity TEXT, status TEXT, settings_version INTEGER, last_provisioned_at INTEGER, created_at INTEGER, updated_at INTEGER);" +
        "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, storage_key TEXT);",
    );
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0032_listicles_core.sql"), "utf8"));
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0033_listicles_analytics_mirror.sql"), "utf8"));
    sdb.prepare("INSERT INTO sites (id, name) VALUES (?, ?)").run("st_test", "Test Site");
    return { env: buildEnv(d1FromSqlite(sdb)) };
  }

  it("GET /admin/listicles/articles/new renders 200 with the create anatomy + no-store", async () => {
    const { env } = newRouteHarness();
    const res = await admin.request("/admin/listicles/articles/new", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const html = await res.text();
    expect(html).toContain('id="lst-a-site"');
    expect(html).toContain('id="lst-article-create"');
    expect(html).toContain('<option value="st_test"');
  });

  it("GET /admin/listicles/articles/:id/edit renders 200 with the builder (accepts internal id AND art_ public id); unknown id → 404 shell", async () => {
    const { env } = newRouteHarness();
    const created = await admin.request(
      "/api/admin/listicles/articles",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_id: "st_test",
          article_name: "Route Article",
          slug: "route-article",
          headline: "H",
          intro_paragraph: "I",
          hero_media_url: "https://img.example/h.jpg",
          layout_style_id: "default",
        }),
      },
      env,
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as { article: { id: number; public_id: string } };

    for (const idParam of [String(body.article.id), body.article.public_id]) {
      const res = await admin.request(`/admin/listicles/articles/${idParam}/edit`, {}, env);
      expect(res.status, `edit by ${idParam}`).toBe(200);
      const html = await res.text();
      expect(html).toContain('id="lst-rail"');
      expect(html).toContain('id="lst-pages-card"');
      expect(html).toContain("Route Article");
      expect(html).toContain("ver_"); // the control lander_v rides the boot JSON
    }

    const missing = await admin.request("/admin/listicles/articles/art_nope/edit", {}, env);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("Article not found");
  });
});
