// Listicles Phase 2 — Articles / Experiments / Versions / Pages admin API
// integration over REAL sqlite (real 0032/0033 migrations, real handlers,
// REAL transactional batch semantics — BEGIN/COMMIT/ROLLBACK — so the
// atomicity assertions observe genuine rollbacks).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

// --- node:sqlite harness (repo pattern + transactional batch) ---------------

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

function createListiclesDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0032_listicles_core.sql"), "utf8"));
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0033_listicles_analytics_mirror.sql"), "utf8"));
  sdb.prepare("INSERT INTO sites (id, name) VALUES (?, ?)").run("st_test", "Test Site");
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

function jsonInit(method: string, body?: unknown): RequestInit {
  if (body === undefined) return { method };
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(): { sdb: SqliteDb; env: Env } {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createListiclesDb(ctor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

function seedSection(sdb: SqliteDb, publicId: string, name: string): number {
  sdb
    .prepare(
      "INSERT INTO listicle_sections (public_id, section_name, headline_text, content_json) VALUES (?, ?, 'h', '{\"blocks\":[]}')",
    )
    .run(publicId, name);
  return (sdb.prepare("SELECT id FROM listicle_sections WHERE public_id = ?").get(publicId) as { id: number }).id;
}

const CREATE_ARTICLE = {
  site_id: "st_test",
  article_name: "Best Cat Foods",
  slug: "best-cat-foods",
  headline: "The 7 Best Cat Foods",
  intro_paragraph: "We tried them all.",
  hero_media_url: "https://cdn.example.com/hero.jpg",
  layout_style_id: "default",
};

interface ArticleBody {
  article: {
    id: number;
    public_id: string;
    site_id: string;
    slug: string;
    status: string;
    published_at: number | null;
    active_experiment_id: number | null;
  };
  version: {
    id: number;
    public_id: string;
    variant_label: string;
    is_control: number;
    traffic_allocation: number;
    content_version: number;
  };
}

async function createArticle(env: Env, overrides: Record<string, unknown> = {}): Promise<ArticleBody> {
  const res = await admin.request(
    "/api/admin/listicles/articles",
    jsonInit("POST", { ...CREATE_ARTICLE, ...overrides }),
    env,
  );
  expect(res.status).toBe(201);
  return (await res.json()) as ArticleBody;
}

describeDb("article create — base + control Version in ONE batch (§5.3)", () => {
  it("creates the draft base and its control Version (label A, 100%, is_control=1) atomically", async () => {
    const { sdb, env } = newHarness();
    const body = await createArticle(env);
    expect(body.article.public_id.startsWith("art_")).toBe(true);
    expect(body.article.status).toBe("draft");
    expect(body.version.public_id.startsWith("ver_")).toBe(true);
    expect(body.version).toMatchObject({
      variant_label: "A",
      is_control: 1,
      traffic_allocation: 100,
      content_version: 1,
    });
    const versionCount = sdb
      .prepare("SELECT COUNT(*) AS n FROM listicle_article_versions")
      .get() as { n: number };
    expect(versionCount.n).toBe(1);
  });

  it("a failing statement mid-batch leaves NO partial rows (FK violation on the version rolls back the article)", async () => {
    const { sdb, env } = newHarness();
    const res = await admin.request(
      "/api/admin/listicles/articles",
      jsonInit("POST", {
        ...CREATE_ARTICLE,
        slug: "atomic-check",
        hero_media_url: undefined,
        hero_media_id: 999, // media table is empty → FK violation on stmt 2 of the batch
      }),
      env,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    const articles = sdb
      .prepare("SELECT COUNT(*) AS n FROM listicle_articles WHERE slug = 'atomic-check'")
      .get() as { n: number };
    expect(articles.n).toBe(0); // stmt 1 (the article INSERT) was rolled back
  });

  it("slug uniqueness per site → field-keyed 400 (create + patch)", async () => {
    const { env } = newHarness();
    await createArticle(env);
    const dup = await admin.request(
      "/api/admin/listicles/articles",
      jsonInit("POST", CREATE_ARTICLE),
      env,
    );
    expect(dup.status).toBe(400);
    const dupBody = (await dup.json()) as { fields: Record<string, string> };
    expect(dupBody.fields.slug).toContain("already exists");

    const second = await createArticle(env, { slug: "other-slug", article_name: "Other" });
    const patched = await admin.request(
      `/api/admin/listicles/articles/${second.article.id}`,
      jsonInit("PATCH", { slug: "best-cat-foods" }),
      env,
    );
    expect(patched.status).toBe(400);
    const patchedBody = (await patched.json()) as { fields: Record<string, string> };
    expect(patchedBody.fields.slug).toContain("already exists");
  });

  it("GET /articles requires site_id and lists the site's articles with the paging envelope", async () => {
    const { env } = newHarness();
    await createArticle(env);
    const missing = await admin.request("/api/admin/listicles/articles", {}, env);
    expect(missing.status).toBe(400);
    const list = await admin.request("/api/admin/listicles/articles?site_id=st_test", {}, env);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      articles: Array<{ version_count: number }>;
      paging: Record<string, unknown>;
      site_id: string;
    };
    expect(listBody.articles).toHaveLength(1);
    expect(listBody.articles[0]?.version_count).toBe(1);
    expect(listBody.site_id).toBe("st_test");
    expect(listBody.paging).toEqual({
      page: 1,
      page_size: 25,
      total: 1,
      has_next: false,
      has_prev: false,
    });
  });

  it("GET /articles paginates via page/page_size like the offers list", async () => {
    const { env } = newHarness();
    await createArticle(env, { slug: "list-one", article_name: "One" });
    await createArticle(env, { slug: "list-two", article_name: "Two" });
    await createArticle(env, { slug: "list-three", article_name: "Three" });

    const page1 = await admin.request(
      "/api/admin/listicles/articles?site_id=st_test&page=1&page_size=2",
      {},
      env,
    );
    expect(page1.status).toBe(200);
    const page1Body = (await page1.json()) as {
      articles: Array<{ slug: string }>;
      paging: { page: number; page_size: number; total: number; has_next: boolean; has_prev: boolean };
    };
    expect(page1Body.articles).toHaveLength(2);
    expect(page1Body.paging).toEqual({
      page: 1,
      page_size: 2,
      total: 3,
      has_next: true,
      has_prev: false,
    });

    const page2 = await admin.request(
      "/api/admin/listicles/articles?site_id=st_test&page=2&page_size=2",
      {},
      env,
    );
    expect(page2.status).toBe(200);
    const page2Body = (await page2.json()) as {
      articles: Array<{ slug: string }>;
      paging: { page: number; total: number; has_next: boolean; has_prev: boolean };
    };
    expect(page2Body.articles).toHaveLength(1);
    expect(page2Body.paging).toMatchObject({ page: 2, total: 3, has_next: false, has_prev: true });

    // The two pages tile the full site-scoped set with no overlap.
    const slugs = [...page1Body.articles, ...page2Body.articles].map((a) => a.slug).sort();
    expect(slugs).toEqual(["list-one", "list-three", "list-two"]);
  });
});

describeDb("experiments — Σ==100, one control, partial-unique 409 (§15.8/§23)", () => {
  it("validates Σ and control count", async () => {
    const { env } = newHarness();
    const { version } = await createArticle(env);

    const badSum = await admin.request(
      `/api/admin/listicles/articles/1/experiments`,
      jsonInit("POST", {
        name: "exp",
        versions: [
          { version_id: version.id, traffic_allocation: 50, is_control: true },
          { ...CREATE_ARTICLE, traffic_allocation: 40 },
        ],
      }),
      env,
    );
    expect(badSum.status).toBe(400);
    expect(((await badSum.json()) as { fields: Record<string, string> }).fields.traffic_allocation).toContain("100");

    const noControl = await admin.request(
      `/api/admin/listicles/articles/1/experiments`,
      jsonInit("POST", {
        name: "exp",
        versions: [
          { version_id: version.id, traffic_allocation: 50 },
          { ...CREATE_ARTICLE, traffic_allocation: 50 },
        ],
      }),
      env,
    );
    expect(noControl.status).toBe(400);
    expect(((await noControl.json()) as { fields: Record<string, string> }).fields.is_control).toContain("exactly one control");
  });

  it("starts a running A/B (existing control + new arm) and 409s a second RUNNING experiment", async () => {
    const { sdb, env } = newHarness();
    const { article, version } = await createArticle(env);

    const started = await admin.request(
      `/api/admin/listicles/articles/${article.id}/experiments`,
      jsonInit("POST", {
        name: "Headline test",
        versions: [
          { version_id: version.id, traffic_allocation: 50, is_control: true },
          {
            headline: "Challenger headline",
            intro_paragraph: "Intro B",
            hero_media_url: "https://cdn.example.com/hero-b.jpg",
            layout_style_id: "default",
            traffic_allocation: 50,
          },
        ],
      }),
      env,
    );
    expect(started.status).toBe(201);
    const startedBody = (await started.json()) as {
      experiment: { public_id: string; status: string };
      versions: Array<{ public_id: string; variant_label: string; traffic_allocation: number; is_control: number }>;
    };
    expect(startedBody.experiment.status).toBe("running");
    expect(startedBody.experiment.public_id.startsWith("exp_")).toBe(true);
    expect(startedBody.versions).toHaveLength(2);
    expect(startedBody.versions.filter((v) => v.is_control === 1)).toHaveLength(1);

    // active_experiment_id is wired onto the article.
    const articleRow = sdb
      .prepare("SELECT active_experiment_id FROM listicle_articles WHERE id = ?")
      .get(article.id) as { active_experiment_id: number | null };
    expect(articleRow.active_experiment_id).not.toBeNull();

    // A second running experiment must surface as a clean 409.
    const second = await admin.request(
      `/api/admin/listicles/articles/${article.id}/experiments`,
      jsonInit("POST", {
        name: "Another",
        versions: [{ version_id: version.id, traffic_allocation: 100, is_control: true }],
      }),
      env,
    );
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe("experiment_already_running");

    // The 0032 partial unique index itself refuses a second running row.
    expect(() =>
      sdb
        .prepare(
          "INSERT INTO listicle_article_experiments (public_id, article_id, name, status) VALUES ('exp_direct', ?, 'x', 'running')",
        )
        .run(article.id),
    ).toThrow(/UNIQUE/i);
  });
});

const RULE_US: Record<string, unknown> = {
  priority: 1,
  conditions: { sets: { state: ["CA"], device: ["mobile"] } },
};

function pagesPayload(sectionA: number, sectionB: number, sectionC: number): unknown[] {
  return [
    { page_index: 0, selection_mode: "single", candidates: [{ section_id: sectionA }] },
    {
      page_index: 1,
      selection_mode: "ab_test",
      candidates: [
        { section_id: sectionA, label: "A", traffic_allocation: 60 },
        { section_id: sectionB, label: "B", traffic_allocation: 40 },
      ],
    },
    {
      page_index: 2,
      selection_mode: "rule_based",
      candidates: [
        { section_id: sectionB, label: "A", rule: RULE_US },
        { section_id: sectionC, label: "B", is_fallback: true },
      ],
    },
  ];
}

describeDb("PUT /versions/:id — atomic replace save (§7.1/§15.6/§23)", () => {
  it("saves version fields + pages + candidates + rules and round-trips through /structure", async () => {
    const { sdb, env } = newHarness();
    const { article, version } = await createArticle(env);
    const sectionA = seedSection(sdb, "sec_a", "Section A");
    const sectionB = seedSection(sdb, "sec_b", "Section B");
    const sectionC = seedSection(sdb, "sec_c", "Section C");

    const saved = await admin.request(
      `/api/admin/listicles/versions/${version.id}`,
      jsonInit("PUT", {
        ...CREATE_ARTICLE,
        headline: "Updated headline",
        pages: pagesPayload(sectionA, sectionB, sectionC),
      }),
      env,
    );
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as {
      version: { content_version: number; headline: string };
      pages: Array<{ public_id: string; selection_mode: string; ab_test_id: string | null }>;
      warnings: unknown[];
    };
    expect(savedBody.version.headline).toBe("Updated headline");
    expect(savedBody.version.content_version).toBe(2); // changed → bumped
    expect(savedBody.pages).toHaveLength(3);
    expect(savedBody.pages[1]?.ab_test_id).toBeTruthy(); // minted for the A/B page

    // Structure endpoint: versions → pages → candidates + section names + rule.
    const structure = await admin.request(
      `/api/admin/listicles/articles/${article.id}/structure`,
      {},
      env,
    );
    expect(structure.status).toBe(200);
    const structureBody = (await structure.json()) as {
      article: { public_id: string };
      versions: Array<{
        public_id: string;
        pages: Array<{
          page_index: number;
          selection_mode: string;
          candidates: Array<{
            section_name: string;
            label: string;
            is_fallback: number;
            rule: { priority: number; conditions_hash: string } | null;
          }>;
        }>;
      }>;
    };
    expect(structureBody.article.public_id).toBe(article.public_id);
    expect(structureBody.versions).toHaveLength(1);
    const pages = structureBody.versions[0]?.pages ?? [];
    expect(pages.map((p) => p.selection_mode)).toEqual(["single", "ab_test", "rule_based"]);
    const rulePage = pages[2];
    expect(rulePage?.candidates).toHaveLength(2);
    const ruled = rulePage?.candidates.find((cand) => cand.rule !== null);
    expect(ruled?.section_name).toBe("Section B");
    expect(ruled?.rule?.priority).toBe(1);
    expect(ruled?.rule?.conditions_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rulePage?.candidates.filter((cand) => cand.is_fallback === 1)).toHaveLength(1);
  });

  it("an idempotent re-save does NOT bump content_version (§15.6 'on change')", async () => {
    const { sdb, env } = newHarness();
    const { version } = await createArticle(env);
    const sectionA = seedSection(sdb, "sec_a", "Section A");
    const payload = {
      ...CREATE_ARTICLE,
      pages: [{ page_index: 0, selection_mode: "single", candidates: [{ section_id: sectionA }] }],
    };
    const first = await admin.request(
      `/api/admin/listicles/versions/${version.id}`,
      jsonInit("PUT", payload),
      env,
    );
    const firstBody = (await first.json()) as { version: { content_version: number } };
    expect(firstBody.version.content_version).toBe(2);

    const second = await admin.request(
      `/api/admin/listicles/versions/${version.id}`,
      jsonInit("PUT", payload),
      env,
    );
    const secondBody = (await second.json()) as { version: { content_version: number } };
    expect(secondBody.version.content_version).toBe(2); // unchanged tree → no bump
  });

  it("a failing statement mid-batch leaves NO partial rows (UNIQUE violation rolls the whole save back)", async () => {
    const { sdb, env } = newHarness();
    const { version } = await createArticle(env);
    const sectionA = seedSection(sdb, "sec_a", "Section A");
    const sectionB = seedSection(sdb, "sec_b", "Section B");

    // Baseline tree.
    const baseline = await admin.request(
      `/api/admin/listicles/versions/${version.id}`,
      jsonInit("PUT", {
        ...CREATE_ARTICLE,
        pages: [{ page_index: 0, selection_mode: "single", candidates: [{ section_id: sectionA }] }],
      }),
      env,
    );
    expect(baseline.status).toBe(200);
    const baselinePage = ((await baseline.json()) as { pages: Array<{ public_id: string }> }).pages[0];

    // UNIQUE(page_id, section_id): the same section twice on one page passes
    // §23 (Σ==100) but violates the constraint on the SECOND candidate INSERT
    // — mid-batch, after the version UPDATE + page replace already ran.
    const conflicted = await admin.request(
      `/api/admin/listicles/versions/${version.id}`,
      jsonInit("PUT", {
        ...CREATE_ARTICLE,
        headline: "SHOULD NOT PERSIST",
        pages: [
          {
            page_index: 0,
            selection_mode: "ab_test",
            candidates: [
              { section_id: sectionB, label: "A", traffic_allocation: 50 },
              { section_id: sectionB, label: "B", traffic_allocation: 50 },
            ],
          },
        ],
      }),
      env,
    );
    expect(conflicted.status).toBe(400);

    // Rollback proof: headline untouched, the baseline page tree survives.
    const versionRow = sdb
      .prepare("SELECT headline, content_version FROM listicle_article_versions WHERE id = ?")
      .get(version.id) as { headline: string; content_version: number };
    expect(versionRow.headline).toBe(CREATE_ARTICLE.headline);
    const pageRows = sdb
      .prepare("SELECT public_id FROM listicle_pages WHERE article_version_id = ?")
      .all(version.id) as Array<{ public_id: string }>;
    expect(pageRows).toHaveLength(1);
    expect(pageRows[0]?.public_id).toBe(baselinePage?.public_id);
    const candCount = sdb
      .prepare(
        "SELECT COUNT(*) AS n FROM listicle_page_section_candidates WHERE section_id = ?",
      )
      .get(sectionB) as { n: number };
    expect(candCount.n).toBe(0);
  });

  it("blocks the save with the §15.5 payload on an equal-priority rule overlap", async () => {
    const { sdb, env } = newHarness();
    const { version } = await createArticle(env);
    const sectionA = seedSection(sdb, "sec_a", "Section A");
    const sectionB = seedSection(sdb, "sec_b", "Section B");
    const sectionC = seedSection(sdb, "sec_c", "Section C");

    const res = await admin.request(
      `/api/admin/listicles/versions/${version.id}`,
      jsonInit("PUT", {
        ...CREATE_ARTICLE,
        pages: [
          {
            page_index: 0,
            selection_mode: "rule_based",
            candidates: [
              { section_id: sectionA, rule: { priority: 1, conditions: { sets: { state: ["CA"], device: ["mobile"] } } } },
              { section_id: sectionB, rule: { priority: 1, conditions: { sets: { state: ["CA", "NY"] } } } },
              { section_id: sectionC, is_fallback: true },
            ],
          },
        ],
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      fields: Record<string, Array<{ candidate_a: string; candidate_b: string; overlap: Record<string, string[]> }>>;
    };
    expect(body.error).toBe("Rule conflict");
    const conflicts = body.fields["page_0.rules"];
    expect(conflicts).toHaveLength(1);
    expect(conflicts?.[0]).toMatchObject({ candidate_a: "Section A", candidate_b: "Section B" });
    expect(conflicts?.[0]?.overlap.state).toEqual(["CA"]);
    // Nothing was written.
    const pageCount = sdb
      .prepare("SELECT COUNT(*) AS n FROM listicle_pages WHERE article_version_id = ?")
      .get(version.id) as { n: number };
    expect(pageCount.n).toBe(0);
  });

  it("409 running_version_immutable while the version's experiment is running (§15.6)", async () => {
    const { sdb, env } = newHarness();
    const { article, version } = await createArticle(env);
    const sectionA = seedSection(sdb, "sec_a", "Section A");
    await admin.request(
      `/api/admin/listicles/articles/${article.id}/experiments`,
      jsonInit("POST", {
        name: "Live test",
        versions: [
          { version_id: version.id, traffic_allocation: 100, is_control: true },
        ],
      }),
      env,
    );

    const res = await admin.request(
      `/api/admin/listicles/versions/${version.id}`,
      jsonInit("PUT", {
        ...CREATE_ARTICLE,
        pages: [{ page_index: 0, selection_mode: "single", candidates: [{ section_id: sectionA }] }],
      }),
      env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; fields: Record<string, string> };
    expect(body.error).toBe("running_version_immutable");
    expect(body.fields.version).toContain("forks a new Version");
  });

  it("409 published_version_immutable: a BEHAVIORAL change to a published article's Version writes nothing (§15.6 case c)", async () => {
    const { sdb, env } = newHarness();
    const { article, version } = await createArticle(env);
    const sectionA = seedSection(sdb, "sec_a", "Section A");
    const sectionB = seedSection(sdb, "sec_b", "Section B");

    // Case (a): the SAME behavioral change on the still-draft article is
    // allowed and bumps content_version (existing behavior unchanged).
    const draftSave = await admin.request(
      `/api/admin/listicles/versions/${version.id}`,
      jsonInit("PUT", {
        ...CREATE_ARTICLE,
        pages: [{ page_index: 0, selection_mode: "single", candidates: [{ section_id: sectionA }] }],
      }),
      env,
    );
    expect(draftSave.status).toBe(200);
    const draftBody = (await draftSave.json()) as { version: { content_version: number } };
    expect(draftBody.version.content_version).toBe(2);

    const published = await admin.request(
      `/api/admin/listicles/articles/${article.id}/publish`,
      jsonInit("POST"),
      env,
    );
    expect(published.status).toBe(200);

    // Behavioral: page 0 swaps to a different section → fingerprint differs.
    const res = await admin.request(
      `/api/admin/listicles/versions/${version.id}`,
      jsonInit("PUT", {
        ...CREATE_ARTICLE,
        headline: "SHOULD NOT PERSIST",
        pages: [{ page_index: 0, selection_mode: "single", candidates: [{ section_id: sectionB }] }],
      }),
      env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; fields: Record<string, string> };
    expect(body.error).toBe("published_version_immutable");
    expect(body.fields.version).toContain("fork a new Version");

    // No rows changed: version fields and the page tree survive untouched.
    const row = sdb
      .prepare("SELECT headline, content_version FROM listicle_article_versions WHERE id = ?")
      .get(version.id) as { headline: string; content_version: number };
    expect(row.headline).toBe(CREATE_ARTICLE.headline);
    expect(row.content_version).toBe(2);
    const candSections = sdb
      .prepare(
        `SELECT c.section_id FROM listicle_page_section_candidates c
         JOIN listicle_pages p ON p.id = c.page_id
         WHERE p.article_version_id = ?`,
      )
      .all(version.id) as Array<{ section_id: number }>;
    expect(candSections).toEqual([{ section_id: sectionA }]);
  });

  it("published article: byte-identical re-save → 200 no bump; NON-behavioral tweak → 200 + bump, same lander_v (§15.6 case b)", async () => {
    const { sdb, env } = newHarness();
    const { article, version } = await createArticle(env);
    const sectionA = seedSection(sdb, "sec_a", "Section A");
    const payload = {
      ...CREATE_ARTICLE,
      pages: [{ page_index: 0, selection_mode: "single", candidates: [{ section_id: sectionA }] }],
    };
    const baseline = await admin.request(
      `/api/admin/listicles/versions/${version.id}`,
      jsonInit("PUT", payload),
      env,
    );
    expect(baseline.status).toBe(200);
    const published = await admin.request(
      `/api/admin/listicles/articles/${article.id}/publish`,
      jsonInit("POST"),
      env,
    );
    expect(published.status).toBe(200);

    // Byte-identical re-save: allowed, no content_version bump.
    const idempotent = await admin.request(
      `/api/admin/listicles/versions/${version.id}`,
      jsonInit("PUT", payload),
      env,
    );
    expect(idempotent.status).toBe(200);
    const idemBody = (await idempotent.json()) as { version: { content_version: number } };
    expect(idemBody.version.content_version).toBe(2);

    // Non-behavioral tweak (headline only — same page tree): case (b) allowed,
    // content_version bumps, lander_v (public_id) unchanged.
    const tweak = await admin.request(
      `/api/admin/listicles/versions/${version.id}`,
      jsonInit("PUT", { ...payload, headline: "Freshened headline" }),
      env,
    );
    expect(tweak.status).toBe(200);
    const tweakBody = (await tweak.json()) as {
      version: { public_id: string; content_version: number; headline: string };
    };
    expect(tweakBody.version.content_version).toBe(3);
    expect(tweakBody.version.public_id).toBe(version.public_id);
    expect(tweakBody.version.headline).toBe("Freshened headline");
  });
});

describeDb("POST /pages/:id/validate — pre-save conflict check, no writes (§7.1)", () => {
  async function setupRulePage(): Promise<{
    sdb: SqliteDb;
    env: Env;
    pagePublicId: string;
    sections: { a: number; b: number; c: number };
  }> {
    const harness = newHarness();
    const { version } = await createArticle(harness.env);
    const a = seedSection(harness.sdb, "sec_a", "Section A");
    const b = seedSection(harness.sdb, "sec_b", "Section B");
    const c = seedSection(harness.sdb, "sec_c", "Section C");
    const saved = await admin.request(
      `/api/admin/listicles/versions/${version.id}`,
      jsonInit("PUT", {
        ...CREATE_ARTICLE,
        pages: [
          {
            page_index: 0,
            selection_mode: "rule_based",
            candidates: [
              { section_id: a, rule: RULE_US },
              { section_id: c, is_fallback: true },
            ],
          },
        ],
      }),
      harness.env,
    );
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as { pages: Array<{ public_id: string }> };
    const pagePublicId = savedBody.pages[0]?.public_id ?? "";
    return { ...harness, pagePublicId, sections: { a, b, c } };
  }

  it("returns the §15.5 conflict payload for an equal-priority overlap WITHOUT writing", async () => {
    const { sdb, env, pagePublicId, sections } = await setupRulePage();
    const rulesBefore = (sdb.prepare("SELECT COUNT(*) AS n FROM listicle_page_rules").get() as { n: number }).n;

    const res = await admin.request(
      `/api/admin/listicles/pages/${pagePublicId}/validate`,
      jsonInit("POST", {
        selection_mode: "rule_based",
        candidates: [
          { section_id: sections.a, rule: { priority: 5, conditions: { sets: { state: ["CA"], device: ["mobile"], traffic_source: ["facebook"] } } } },
          { section_id: sections.b, rule: { priority: 5, conditions: { sets: { state: ["CA"], device: ["mobile"] } } } },
          { section_id: sections.c, is_fallback: true },
        ],
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      fields: Record<string, Array<{ overlap: Record<string, string[]>; reason: string }>>;
    };
    expect(body.error).toBe("Rule conflict");
    const conflicts = body.fields["page_0.rules"];
    expect(conflicts?.[0]?.overlap).toEqual({
      state: ["CA"],
      device: ["mobile"],
      traffic_source: ["facebook"],
    });
    expect(conflicts?.[0]?.reason).toContain("same priority");

    // WITHOUT writing: the stored rule set is untouched.
    const rulesAfter = (sdb.prepare("SELECT COUNT(*) AS n FROM listicle_page_rules").get() as { n: number }).n;
    expect(rulesAfter).toBe(rulesBefore);
  });

  it("cross-priority overlap is 200 ok with an override warning", async () => {
    const { env, pagePublicId, sections } = await setupRulePage();
    const res = await admin.request(
      `/api/admin/listicles/pages/${pagePublicId}/validate`,
      jsonInit("POST", {
        selection_mode: "rule_based",
        candidates: [
          { section_id: sections.a, rule: { priority: 1, conditions: { sets: { state: ["CA"] } } } },
          { section_id: sections.b, rule: { priority: 2, conditions: { sets: { state: ["CA", "NY"] } } } },
          { section_id: sections.c, is_fallback: true },
        ],
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      conflicts: unknown[];
      warnings: Array<{ reason: string; overlap: Record<string, string[]> }>;
    };
    expect(body.ok).toBe(true);
    expect(body.conflicts).toEqual([]);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]?.reason).toContain("can override");
    expect(body.warnings[0]?.overlap.state).toEqual(["CA"]);
  });
});

describeDb("publish + delete + analytics endpoints", () => {
  it("publish validates publishable state (§23) then stamps published/published_at", async () => {
    const { sdb, env } = newHarness();
    const { article, version } = await createArticle(env);

    // Control version has no pages yet → not publishable.
    const notReady = await admin.request(
      `/api/admin/listicles/articles/${article.id}/publish`,
      jsonInit("POST", {}),
      env,
    );
    expect(notReady.status).toBe(400);
    const notReadyBody = (await notReady.json()) as { error: string; fields: Record<string, string> };
    expect(notReadyBody.error).toContain("not publishable");
    expect(JSON.stringify(notReadyBody.fields)).toContain("pages");

    const sectionA = seedSection(sdb, "sec_a", "Section A");
    await admin.request(
      `/api/admin/listicles/versions/${version.id}`,
      jsonInit("PUT", {
        ...CREATE_ARTICLE,
        pages: [{ page_index: 0, selection_mode: "single", candidates: [{ section_id: sectionA }] }],
      }),
      env,
    );

    const published = await admin.request(
      `/api/admin/listicles/articles/${article.id}/publish`,
      jsonInit("POST", {}),
      env,
    );
    expect(published.status).toBe(200);
    const publishedBody = (await published.json()) as ArticleBody;
    expect(publishedBody.article.status).toBe("published");
    expect(publishedBody.article.published_at).not.toBeNull();
  });

  it("DELETE hard-deletes and the 0032 FKs cascade the whole tree", async () => {
    const { sdb, env } = newHarness();
    const { article, version } = await createArticle(env);
    const sectionA = seedSection(sdb, "sec_a", "Section A");
    await admin.request(
      `/api/admin/listicles/versions/${version.id}`,
      jsonInit("PUT", {
        ...CREATE_ARTICLE,
        pages: [{ page_index: 0, selection_mode: "single", candidates: [{ section_id: sectionA }] }],
      }),
      env,
    );

    const res = await admin.request(
      `/api/admin/listicles/articles/${article.id}`,
      { method: "DELETE" },
      env,
    );
    expect(res.status).toBe(200);
    for (const table of [
      "listicle_articles",
      "listicle_article_versions",
      "listicle_pages",
      "listicle_page_section_candidates",
    ]) {
      const row = sdb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      expect(row.n, `${table} not cascaded`).toBe(0);
    }
    // The section itself is global content — it survives.
    const sections = sdb.prepare("SELECT COUNT(*) AS n FROM listicle_sections").get() as { n: number };
    expect(sections.n).toBe(1);
  });

  it("analytics: per-version rows + URL total (pps included); drilldown nests version→page→candidate with rule_match_rate", async () => {
    const { sdb, env } = newHarness();
    const { article } = await createArticle(env);

    const insertArticleMirror = sdb.prepare(
      `INSERT INTO listicle_analytics_article
         (article_public_id, article_version_id, article_version_revision, date,
          total_visits, unique_visits, impressions, clicks, unique_clicks, conversions, revenue)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertArticleMirror.run(article.public_id, "ver_AAA", "2026-06-01", 100, 90, 500, 50, 40, 5, 25);
    insertArticleMirror.run(article.public_id, "ver_BBB", "2026-06-01", 100, 85, 500, 25, 20, 5, 10);

    const analytics = await admin.request(
      `/api/admin/listicles/articles/${article.id}/analytics?from=2026-06-01&to=2026-06-30`,
      {},
      env,
    );
    expect(analytics.status).toBe(200);
    const analyticsBody = (await analytics.json()) as {
      analytics: {
        total: Record<string, number>;
        versions: Array<Record<string, number | string>>;
      };
    };
    expect(analyticsBody.analytics.total.total_visits).toBe(200);
    expect(analyticsBody.analytics.total.clicks).toBe(75);
    expect(analyticsBody.analytics.total.pps).toBeCloseTo(1000 / 200, 10);
    expect(analyticsBody.analytics.versions).toHaveLength(2);
    expect(analyticsBody.analytics.versions[0]?.article_version_id).toBe("ver_AAA");
    expect(analyticsBody.analytics.versions[0]?.ctr).toBeCloseTo(0.1, 10);

    const insertDrill = sdb.prepare(
      `INSERT INTO listicle_analytics_drilldown
         (article_public_id, article_version_id, article_version_revision, page_index,
          page_selection_mode, section_public_id, page_candidate_id, page_rule_id,
          selection_reason, date, impressions, clicks, unique_clicks, conversions,
          revenue, visits, matched_sessions, fallback_sessions)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertDrill.run(article.public_id, "ver_AAA", 0, "single", "sec_x", "cand_1", null, "single_default", "2026-06-01", 300, 30, 25, 3, 15, 90, null, null);
    insertDrill.run(article.public_id, "ver_AAA", 1, "rule_based", "sec_y", "cand_2", "rule_1", "rule_match", "2026-06-01", 200, 20, 18, 2, 10, 80, 60, 20);

    const drill = await admin.request(
      `/api/admin/listicles/articles/${article.id}/drilldown?from=2026-06-01&to=2026-06-30`,
      {},
      env,
    );
    expect(drill.status).toBe(200);
    const drillBody = (await drill.json()) as {
      drilldown: {
        versions: Array<{
          article_version_id: string;
          pages: Array<{
            page_index: number;
            candidates: Array<Record<string, unknown>>;
          }>;
        }>;
      };
    };
    expect(drillBody.drilldown.versions).toHaveLength(1);
    const pages = drillBody.drilldown.versions[0]?.pages ?? [];
    expect(pages).toHaveLength(2);
    const singleCand = pages[0]?.candidates[0];
    expect(singleCand?.rule_match_rate).toBeNull(); // not a rule row
    const ruleCand = pages[1]?.candidates[0];
    expect(ruleCand?.matched_sessions).toBe(60);
    expect(ruleCand?.fallback_sessions).toBe(20);
    expect(ruleCand?.rule_match_rate).toBeCloseTo(0.75, 10); // 60 / (60 + 20)
  });
});
