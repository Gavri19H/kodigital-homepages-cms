// Listicles Phase 5 — §15.6/§30.7 fork + new-revision endpoints, §30.2
// byline_json on PUT /versions/:id, the experiment draft→start→stop
// lifecycle, and the DEV-10 ?search= on GET /articles — over REAL sqlite
// (real 0032/0033 migrations, real handlers, real transactional batches).

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
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, storage_key TEXT);",
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

interface Harness {
  sdb: SqliteDb;
  env: Env;
}

function newHarness(): Harness {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createListiclesDb(ctor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

function seedSection(sdb: SqliteDb, publicId: string, name: string): number {
  sdb
    .prepare(
      "INSERT INTO listicle_sections (public_id, section_name, headline_text, content_json) VALUES (?, ?, 'h', '{\"blocks\":[{\"type\":\"paragraph\",\"data\":{\"text\":\"x\"}}]}')",
    )
    .run(publicId, name);
  const row = sdb
    .prepare("SELECT id FROM listicle_sections WHERE public_id = ?")
    .get(publicId) as { id: number };
  return row.id;
}

interface ArticleSeed {
  articleId: string; // public
  versionId: string; // public (control lander_v)
  sectionA: number;
  sectionB: number;
  sectionC: number;
}

async function seedArticle(h: Harness, slug: string): Promise<ArticleSeed> {
  const res = await admin.request(
    "/api/admin/listicles/articles",
    jsonInit("POST", {
      site_id: "st_test",
      article_name: `Article ${slug}`,
      slug,
      headline: "Control headline",
      intro_paragraph: "Intro paragraph",
      hero_media_url: "https://img.example/hero.jpg",
      layout_style_id: "default",
    }),
    h.env,
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as {
    article: { public_id: string };
    version: { public_id: string };
  };
  return {
    articleId: body.article.public_id,
    versionId: body.version.public_id,
    sectionA: seedSection(h.sdb, `sec_${slug}a`, `Section A ${slug}`),
    sectionB: seedSection(h.sdb, `sec_${slug}b`, `Section B ${slug}`),
    sectionC: seedSection(h.sdb, `sec_${slug}c`, `Section C ${slug}`),
  };
}

// A representative full save payload: 1 single page + 1 rule_based page with
// two rules + a fallback (real conditions → conditions_json/hash rows).
function fullSavePayload(seed: ArticleSeed): Record<string, unknown> {
  return {
    headline: "Saved headline",
    intro_paragraph: "Saved intro",
    hero_media_url: "https://img.example/hero.jpg",
    layout_style_id: "default",
    byline: {
      enabled: true,
      author_name: "Jane Writer",
      label: "Advertorial",
      updated_label: "Updated:",
      updated_date: "June 2026",
    },
    pages: [
      {
        page_index: 0,
        selection_mode: "single",
        candidates: [{ section_id: seed.sectionA, label: "A" }],
      },
      {
        page_index: 1,
        selection_mode: "rule_based",
        candidates: [
          {
            section_id: seed.sectionB,
            label: "B",
            rule: { priority: 1, conditions: { sets: { state: ["CA"], device: ["mobile"] } } },
          },
          {
            section_id: seed.sectionC,
            label: "C",
            rule: { priority: 2, conditions: { sets: { traffic_source: ["newsbreak"] } } },
          },
          { section_id: seed.sectionA, label: "D", is_fallback: true },
        ],
      },
    ],
  };
}

interface TreeRow {
  page_index: number;
  selection_mode: string;
  ab_test_id: string | null;
  rule_set_id: string | null;
  section_id: number;
  label: string;
  traffic_allocation: number | null;
  is_fallback: number;
  priority: number | null;
  conditions_json: string | null;
  conditions_hash: string | null;
}

// The behavioral identity of a version tree (public ids EXCLUDED — a fork
// mints new ones by design; ab_test_id/rule_set_id INCLUDED — copied as-is).
function loadTree(sdb: SqliteDb, versionPublicId: string): TreeRow[] {
  return sdb
    .prepare(
      `SELECT p.page_index, p.selection_mode, p.ab_test_id, p.rule_set_id,
              c.section_id, c.label, c.traffic_allocation, c.is_fallback,
              r.priority, r.conditions_json, r.conditions_hash
       FROM listicle_pages p
       JOIN listicle_article_versions v ON v.id = p.article_version_id
       JOIN listicle_page_section_candidates c ON c.page_id = p.id
       LEFT JOIN listicle_page_rules r ON r.candidate_id = c.id
       WHERE v.public_id = ?
       ORDER BY p.page_index ASC, c.label ASC`,
    )
    .all(versionPublicId) as TreeRow[];
}

function versionRow(sdb: SqliteDb, publicId: string): Record<string, unknown> {
  return sdb
    .prepare("SELECT * FROM listicle_article_versions WHERE public_id = ?")
    .get(publicId) as Record<string, unknown>;
}

describeDb("POST /versions/:id/fork (§15.6 case c)", () => {
  it("clones to a NEW lander_v: new ver_ public_id, content_version reset to 1, deep-copied tree, source untouched", async () => {
    const h = newHarness();
    const seed = await seedArticle(h, "fork-basic");
    const put = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", fullSavePayload(seed)),
      h.env,
    );
    expect(put.status).toBe(200);

    const sourceBefore = versionRow(h.sdb, seed.versionId);
    const sourceTreeBefore = loadTree(h.sdb, seed.versionId);

    const res = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/fork`,
      jsonInit("POST", {}),
      h.env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      version: Record<string, unknown>;
      pages: unknown[];
      source_public_id: string;
      joined_experiment: boolean;
    };

    // New lander_v ≠ source; ver_ prefix; revision period reset.
    expect(String(body.version.public_id)).toMatch(/^ver_/);
    expect(body.version.public_id).not.toBe(seed.versionId);
    expect(body.version.content_version).toBe(1);
    expect(body.version.is_control).toBe(0);
    expect(body.version.experiment_id).toBeNull();
    expect(body.joined_experiment).toBe(false);
    expect(body.source_public_id).toBe(seed.versionId);
    // Copied fields (incl. the §30.2 byline).
    expect(body.version.headline).toBe("Saved headline");
    expect(String(body.version.byline_json)).toContain("Jane Writer");

    // Deep-copy fidelity: behavioral tree identical (minus public ids);
    // ab_test_id / rule_set_id / conditions copied verbatim.
    const forkTree = loadTree(h.sdb, String(body.version.public_id));
    expect(forkTree).toEqual(sourceTreeBefore);
    // …but the copied rows are NEW rows: distinct page/cand/rule public ids.
    const forkPageIds = h.sdb
      .prepare(
        `SELECT p.public_id FROM listicle_pages p
         JOIN listicle_article_versions v ON v.id = p.article_version_id WHERE v.public_id = ?`,
      )
      .all(String(body.version.public_id)) as Array<{ public_id: string }>;
    const sourcePageIds = h.sdb
      .prepare(
        `SELECT p.public_id FROM listicle_pages p
         JOIN listicle_article_versions v ON v.id = p.article_version_id WHERE v.public_id = ?`,
      )
      .all(seed.versionId) as Array<{ public_id: string }>;
    const overlap = forkPageIds.filter((f) =>
      sourcePageIds.some((s) => s.public_id === f.public_id),
    );
    expect(overlap).toEqual([]);

    // The SOURCE is untouched — row + tree byte-equal before/after.
    expect(versionRow(h.sdb, seed.versionId)).toEqual(sourceBefore);
    expect(loadTree(h.sdb, seed.versionId)).toEqual(sourceTreeBefore);

    // Label auto-advances (control is A → fork is B).
    expect(body.version.variant_label).toBe("B");
  });

  it("join_experiment requires a DRAFT experiment: running → 409 (alloc 0 AND alloc 40), stopped → 409, no experiment → 400; standalone fork from a running arm stays 201", async () => {
    const h = newHarness();
    const seed = await seedArticle(h, "fork-join");

    // join_experiment on a version with NO experiment is a caller error.
    const badJoin = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/fork`,
      jsonInit("POST", { join_experiment: true }),
      h.env,
    );
    expect(badJoin.status).toBe(400);

    // Create a RUNNING experiment over the control (Phase-2 default path).
    const exp = await admin.request(
      `/api/admin/listicles/articles/${seed.articleId}/experiments`,
      jsonInit("POST", {
        name: "Join test",
        versions: [{ version_id: seed.versionId, traffic_allocation: 100, is_control: true }],
      }),
      h.env,
    );
    expect(exp.status).toBe(201);
    const expBody = (await exp.json()) as { experiment: { public_id: string } };

    // Default fork from a running-experiment version: draft-standalone.
    const standalone = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/fork`,
      jsonInit("POST", {}),
      h.env,
    );
    expect(standalone.status).toBe(201);
    const standaloneBody = (await standalone.json()) as { version: Record<string, unknown> };
    expect(standaloneBody.version.experiment_id).toBeNull();
    expect(standaloneBody.version.traffic_allocation).toBe(0);

    // §15.8/§5.2: joining a RUNNING experiment is forbidden — a 0% join is a
    // permanently dead arm (running allocations are immutable; /start is
    // draft-only)…
    const joinRunning0 = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/fork`,
      jsonInit("POST", { join_experiment: true, traffic_allocation: 0 }),
      h.env,
    );
    expect(joinRunning0.status).toBe(409);
    const joinRunning0Body = (await joinRunning0.json()) as {
      error: string;
      fields: Record<string, string>;
    };
    expect(joinRunning0Body.error).toBe("experiment_not_joinable");
    expect(joinRunning0Body.fields.join_experiment).toContain("DRAFT");
    // …and a >0% join would break the live Σ==100.
    const joinRunning40 = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/fork`,
      jsonInit("POST", { join_experiment: true, traffic_allocation: 40 }),
      h.env,
    );
    expect(joinRunning40.status).toBe(409);
    expect(((await joinRunning40.json()) as { error: string }).error).toBe(
      "experiment_not_joinable",
    );
    // No arm ever landed on the running experiment (control only).
    const armCount = h.sdb
      .prepare(
        `SELECT COUNT(*) AS n FROM listicle_article_versions v
         JOIN listicle_article_experiments e ON e.id = v.experiment_id
         WHERE e.public_id = ?`,
      )
      .get(expBody.experiment.public_id) as { n: number };
    expect(Number(armCount.n)).toBe(1);

    // STOPPED experiments are kept history (§5.3) — not joinable either.
    const stop = await admin.request(
      `/api/admin/listicles/experiments/${expBody.experiment.public_id}/stop`,
      jsonInit("POST", {}),
      h.env,
    );
    expect(stop.status).toBe(200);
    const joinStopped = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/fork`,
      jsonInit("POST", { join_experiment: true }),
      h.env,
    );
    expect(joinStopped.status).toBe(409);
    expect(((await joinStopped.json()) as { error: string }).error).toBe(
      "experiment_not_joinable",
    );
  });

  it("joins a DRAFT experiment (explicit) as a new variant; /start Σ-validates over the MERGED arm set", async () => {
    const h = newHarness();
    const seed = await seedArticle(h, "fork-join-draft");

    const exp = await admin.request(
      `/api/admin/listicles/articles/${seed.articleId}/experiments`,
      jsonInit("POST", {
        name: "Draft join",
        status: "draft",
        versions: [{ version_id: seed.versionId, traffic_allocation: 100, is_control: true }],
      }),
      h.env,
    );
    expect(exp.status).toBe(201);
    const expBody = (await exp.json()) as { experiment: { public_id: string } };

    const joined = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/fork`,
      jsonInit("POST", { join_experiment: true, variant_label: "Z", traffic_allocation: 0 }),
      h.env,
    );
    expect(joined.status).toBe(201);
    const joinedBody = (await joined.json()) as {
      version: Record<string, unknown>;
      joined_experiment: boolean;
    };
    expect(joinedBody.joined_experiment).toBe(true);
    expect(joinedBody.version.experiment_id).not.toBeNull();
    expect(joinedBody.version.variant_label).toBe("Z");
    expect(joinedBody.version.is_control).toBe(0);

    // /start validates Σ over the MERGED arms: 60 + 30 ≠ 100 → 400…
    const badStart = await admin.request(
      `/api/admin/listicles/experiments/${expBody.experiment.public_id}/start`,
      jsonInit("POST", {
        versions: [
          { version_id: seed.versionId, traffic_allocation: 60, is_control: true },
          { version_id: joinedBody.version.public_id, traffic_allocation: 30 },
        ],
      }),
      h.env,
    );
    expect(badStart.status).toBe(400);
    // …60 + 40 == 100 → running.
    const start = await admin.request(
      `/api/admin/listicles/experiments/${expBody.experiment.public_id}/start`,
      jsonInit("POST", {
        versions: [
          { version_id: seed.versionId, traffic_allocation: 60, is_control: true },
          { version_id: joinedBody.version.public_id, traffic_allocation: 40 },
        ],
      }),
      h.env,
    );
    expect(start.status).toBe(200);
    expect(((await start.json()) as { experiment: { status: string } }).experiment.status).toBe(
      "running",
    );
  });

  it("FIX-3: an EXPLICIT variant_label colliding with an existing arm's label → 400 (auto-advance stays for omitted labels)", async () => {
    const h = newHarness();
    const seed = await seedArticle(h, "fork-label");

    // Control is 'A' — an explicit duplicate (case-insensitive) is rejected.
    const dup = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/fork`,
      jsonInit("POST", { variant_label: "a" }),
      h.env,
    );
    expect(dup.status).toBe(400);
    const dupBody = (await dup.json()) as { fields: Record<string, string> };
    expect(dupBody.fields.variant_label).toContain("already used");

    // Omitted label auto-advances (B), and a fresh explicit label works.
    const auto = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/fork`,
      jsonInit("POST", {}),
      h.env,
    );
    expect(auto.status).toBe(201);
    expect(
      ((await auto.json()) as { version: { variant_label: string } }).version.variant_label,
    ).toBe("B");
    const explicit = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/fork`,
      jsonInit("POST", { variant_label: "Q" }),
      h.env,
    );
    expect(explicit.status).toBe(201);
  });
});

describeDb("POST /versions/:id/new-revision (§30.7 case c — explicit revision period)", () => {
  it("keeps the SAME lander_v, ALWAYS bumps content_version, and applies the payload atomically", async () => {
    const h = newHarness();
    const seed = await seedArticle(h, "rev-basic");
    const put = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", fullSavePayload(seed)),
      h.env,
    );
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as { version: { content_version: number } };
    const revBefore = putBody.version.content_version;

    // Byte-identical payload — PUT would keep the revision; new-revision is
    // the operator EXPLICITLY starting a new revision period → +1 regardless.
    const res = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/new-revision`,
      jsonInit("POST", fullSavePayload(seed)),
      h.env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { version: Record<string, unknown> };
    expect(body.version.public_id).toBe(seed.versionId); // same lander_v
    expect(body.version.content_version).toBe(revBefore + 1);

    // The payload is applied (not just the bump).
    const changed = { ...fullSavePayload(seed), headline: "Revised headline" };
    const res2 = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/new-revision`,
      jsonInit("POST", changed),
      h.env,
    );
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { version: Record<string, unknown> };
    expect(body2.version.headline).toBe("Revised headline");
    expect(body2.version.content_version).toBe(revBefore + 2);
  });

  it("bypasses ONLY the immutability 409s: plain PUT on a running Version still 409s; new-revision succeeds; §23 validation still applies", async () => {
    const h = newHarness();
    const seed = await seedArticle(h, "rev-running");
    await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", fullSavePayload(seed)),
      h.env,
    );
    // Running experiment → the control version becomes immutable to PUT.
    const exp = await admin.request(
      `/api/admin/listicles/articles/${seed.articleId}/experiments`,
      jsonInit("POST", {
        name: "Immutable test",
        versions: [{ version_id: seed.versionId, traffic_allocation: 100, is_control: true }],
      }),
      h.env,
    );
    expect(exp.status).toBe(201);

    const put = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", fullSavePayload(seed)),
      h.env,
    );
    expect(put.status).toBe(409);
    const putBody = (await put.json()) as { error: string };
    expect(putBody.error).toBe("running_version_immutable");

    // The explicit operator path works on the SAME version…
    const rev = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/new-revision`,
      jsonInit("POST", { ...fullSavePayload(seed), headline: "Explicit revision edit" }),
      h.env,
    );
    expect(rev.status).toBe(200);
    const revBody = (await rev.json()) as { version: Record<string, unknown> };
    expect(revBody.version.headline).toBe("Explicit revision edit");

    // …but it bypasses ONLY immutability: §23 validation still rejects.
    const invalid = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/new-revision`,
      jsonInit("POST", { ...fullSavePayload(seed), headline: "" }),
      h.env,
    );
    expect(invalid.status).toBe(400);
    const invalidBody = (await invalid.json()) as { fields: Record<string, string> };
    expect(invalidBody.fields.headline).toBeTruthy();

    // …and the §15.5 conflict guard still blocks.
    const conflicting = fullSavePayload(seed) as {
      pages: Array<{ candidates: Array<{ rule?: { priority: number } }> }>;
    };
    const secondRule = conflicting.pages[1]?.candidates[1]?.rule;
    if (secondRule) secondRule.priority = 1; // equal priority w/ overlapping "any" dims? (CA+mobile vs newsbreak are disjoint-free dims → overlap)
    const conflictRes = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/new-revision`,
      jsonInit("POST", conflicting),
      h.env,
    );
    expect(conflictRes.status).toBe(400);
    const conflictBody = (await conflictRes.json()) as { error: string };
    expect(conflictBody.error).toBe("Rule conflict");
  });

  it("published + behavioral: PUT 409s published_version_immutable; new-revision applies with the bump", async () => {
    const h = newHarness();
    const seed = await seedArticle(h, "rev-published");
    await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", fullSavePayload(seed)),
      h.env,
    );
    const publish = await admin.request(
      `/api/admin/listicles/articles/${seed.articleId}/publish`,
      jsonInit("POST", {}),
      h.env,
    );
    expect(publish.status).toBe(200);

    // BEHAVIORAL change: drop the rule_based page (tree fingerprint changes).
    const behavioral = {
      ...fullSavePayload(seed),
      pages: [
        {
          page_index: 0,
          selection_mode: "single",
          candidates: [{ section_id: seed.sectionB, label: "A" }],
        },
      ],
    };
    const put = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", behavioral),
      h.env,
    );
    expect(put.status).toBe(409);
    expect(((await put.json()) as { error: string }).error).toBe("published_version_immutable");

    const rev = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/new-revision`,
      jsonInit("POST", behavioral),
      h.env,
    );
    expect(rev.status).toBe(200);
    const revBody = (await rev.json()) as {
      version: { public_id: string; content_version: number };
      pages: unknown[];
    };
    expect(revBody.version.public_id).toBe(seed.versionId);
    expect(revBody.pages).toHaveLength(1);
  });

  it("FIX-2: published + LAYOUT change is behavioral (§30.7 case c names layout): PUT 409s; new-revision applies with the bump; field tweaks stay case-b", async () => {
    const h = newHarness();
    const seed = await seedArticle(h, "rev-layout");
    await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", fullSavePayload(seed)),
      h.env,
    );
    const publish = await admin.request(
      `/api/admin/listicles/articles/${seed.articleId}/publish`,
      jsonInit("POST", {}),
      h.env,
    );
    expect(publish.status).toBe(200);

    // Layout change ONLY (tree unchanged) → fork-required 409.
    const layoutChange = { ...fullSavePayload(seed), layout_style_id: "alt-layout" };
    const put = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", layoutChange),
      h.env,
    );
    expect(put.status).toBe(409);
    expect(((await put.json()) as { error: string }).error).toBe("published_version_immutable");
    // Nothing was written.
    expect(versionRow(h.sdb, seed.versionId).layout_style_id).toBe("default");

    // A FIELD tweak (headline) on the published version stays case b (bump).
    const fieldTweak = { ...fullSavePayload(seed), headline: "Case-b headline tweak" };
    const caseB = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", fieldTweak),
      h.env,
    );
    expect(caseB.status).toBe(200);

    // new-revision (explicit §30.7-case-c consent) applies the layout change
    // with the bump, same lander_v.
    const before = Number(versionRow(h.sdb, seed.versionId).content_version);
    const rev = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/new-revision`,
      jsonInit("POST", layoutChange),
      h.env,
    );
    expect(rev.status).toBe(200);
    const revBody = (await rev.json()) as {
      version: { public_id: string; content_version: number; layout_style_id: string };
    };
    expect(revBody.version.public_id).toBe(seed.versionId);
    expect(revBody.version.layout_style_id).toBe("alt-layout");
    expect(revBody.version.content_version).toBe(before + 1);
  });
});

describeDb("PUT /versions/:id — §30.2 byline_json", () => {
  it("accepts, canonicalizes and round-trips the ArticleVersionByline shape; bumps content_version on byline change", async () => {
    const h = newHarness();
    const seed = await seedArticle(h, "byline-ok");
    const payload = fullSavePayload(seed);
    const put = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", payload),
      h.env,
    );
    expect(put.status).toBe(200);
    const row = versionRow(h.sdb, seed.versionId);
    const byline = JSON.parse(String(row.byline_json)) as Record<string, unknown>;
    expect(byline).toEqual({
      enabled: true,
      author_name: "Jane Writer",
      label: "Advertorial",
      updated_label: "Updated:",
      updated_date: "June 2026",
    });
    const revAfterFirst = Number(row.content_version);

    // Byline-only change (non-behavioral tweak) → content_version bump
    // (§30.7 case b) and the avatar fields persist.
    const changed = {
      ...payload,
      byline: {
        enabled: true,
        author_name: "Jane Writer",
        author_avatar_url: "/media/avatar.png",
        author_avatar_media_id: 7,
        label: "Advertorial",
        updated_label: "Updated:",
        updated_date: "July 2026",
      },
    };
    const put2 = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", changed),
      h.env,
    );
    expect(put2.status).toBe(200);
    const row2 = versionRow(h.sdb, seed.versionId);
    expect(Number(row2.content_version)).toBe(revAfterFirst + 1);
    const byline2 = JSON.parse(String(row2.byline_json)) as Record<string, unknown>;
    expect(byline2.author_avatar_url).toBe("/media/avatar.png");
    expect(byline2.author_avatar_media_id).toBe(7);

    // Label defaults to "Advertorial" when omitted (§30.2 default).
    const defaulted = {
      ...payload,
      byline: { enabled: true, author_name: "Jane Writer" },
    };
    const put3 = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", defaulted),
      h.env,
    );
    expect(put3.status).toBe(200);
    const byline3 = JSON.parse(String(versionRow(h.sdb, seed.versionId).byline_json)) as {
      label: string;
    };
    expect(byline3.label).toBe("Advertorial");

    // Absent byline ⇒ NULL (full-replace semantics).
    const noByline = { ...payload } as Record<string, unknown>;
    delete noByline.byline;
    const put4 = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", noByline),
      h.env,
    );
    expect(put4.status).toBe(200);
    expect(versionRow(h.sdb, seed.versionId).byline_json).toBeNull();
  });

  it("rejects an enabled byline without author_name and unknown byline keys (field-keyed)", async () => {
    const h = newHarness();
    const seed = await seedArticle(h, "byline-bad");
    const base = fullSavePayload(seed);

    const missingAuthor = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", { ...base, byline: { enabled: true, author_name: "" } }),
      h.env,
    );
    expect(missingAuthor.status).toBe(400);
    const body = (await missingAuthor.json()) as { fields: Record<string, string> };
    expect(body.fields["byline.author_name"]).toContain("required");

    const unknownKey = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", {
        ...base,
        byline: { enabled: true, author_name: "J", author_avtar_url: "typo" },
      }),
      h.env,
    );
    expect(unknownKey.status).toBe(400);
    const unknownBody = (await unknownKey.json()) as { fields: Record<string, string> };
    expect(unknownBody.fields["byline.author_avtar_url"]).toContain("unknown byline field");
  });
});

describeDb("experiment lifecycle — draft create → start (Σ=100 + one control) → stop", () => {
  it("draft create leaves active_experiment_id untouched and versions editable; start validates and flips; stop keeps history", async () => {
    const h = newHarness();
    const seed = await seedArticle(h, "lifecycle");
    await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", fullSavePayload(seed)),
      h.env,
    );

    // Draft experiment over the control at 100.
    const create = await admin.request(
      `/api/admin/listicles/articles/${seed.articleId}/experiments`,
      jsonInit("POST", {
        name: "Draft flow",
        status: "draft",
        versions: [{ version_id: seed.versionId, traffic_allocation: 100, is_control: true }],
      }),
      h.env,
    );
    expect(create.status).toBe(201);
    const created = (await create.json()) as { experiment: { public_id: string; status: string } };
    expect(created.experiment.status).toBe("draft");
    const articleRow = h.sdb
      .prepare("SELECT active_experiment_id FROM listicle_articles WHERE public_id = ?")
      .get(seed.articleId) as { active_experiment_id: number | null };
    expect(articleRow.active_experiment_id).toBeNull();

    // Versions in a DRAFT experiment stay editable (no running 409).
    const editWhileDraft = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", { ...fullSavePayload(seed), headline: "Editable in draft" }),
      h.env,
    );
    expect(editWhileDraft.status).toBe(200);

    // Add arm B by forking the control into the draft experiment.
    const fork = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/fork`,
      jsonInit("POST", { join_experiment: true }),
      h.env,
    );
    expect(fork.status).toBe(201);
    const forkBody = (await fork.json()) as { version: { public_id: string } };

    // The builder's draft resumption path: structure surfaces the draft.
    const structure = await admin.request(
      `/api/admin/listicles/articles/${seed.articleId}/structure`,
      jsonInit("GET"),
      h.env,
    );
    const structureBody = (await structure.json()) as {
      experiment: { public_id: string; status: string } | null;
    };
    expect(structureBody.experiment?.public_id).toBe(created.experiment.public_id);
    expect(structureBody.experiment?.status).toBe("draft");

    // Start with a BAD Σ → 400.
    const badStart = await admin.request(
      `/api/admin/listicles/experiments/${created.experiment.public_id}/start`,
      jsonInit("POST", {
        versions: [
          { version_id: seed.versionId, traffic_allocation: 60, is_control: true },
          { version_id: forkBody.version.public_id, traffic_allocation: 30 },
        ],
      }),
      h.env,
    );
    expect(badStart.status).toBe(400);
    const badStartBody = (await badStart.json()) as { fields: Record<string, string> };
    expect(badStartBody.fields.traffic_allocation).toContain("100");

    // Start 60/40 → running + allocations persisted + active pointer set.
    const start = await admin.request(
      `/api/admin/listicles/experiments/${created.experiment.public_id}/start`,
      jsonInit("POST", {
        versions: [
          { version_id: seed.versionId, traffic_allocation: 60, is_control: true },
          { version_id: forkBody.version.public_id, traffic_allocation: 40 },
        ],
      }),
      h.env,
    );
    expect(start.status).toBe(200);
    const started = (await start.json()) as {
      experiment: { status: string };
      versions: Array<{ public_id: string; traffic_allocation: number }>;
    };
    expect(started.experiment.status).toBe("running");
    const allocations = new Map(started.versions.map((v) => [v.public_id, v.traffic_allocation]));
    expect(allocations.get(seed.versionId)).toBe(60);
    expect(allocations.get(forkBody.version.public_id)).toBe(40);
    const articleAfterStart = h.sdb
      .prepare("SELECT active_experiment_id FROM listicle_articles WHERE public_id = ?")
      .get(seed.articleId) as { active_experiment_id: number | null };
    expect(articleAfterStart.active_experiment_id).not.toBeNull();

    // Running → PUT 409s (the §15.6 guard the fork/new-revision paths solve).
    const putRunning = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}`,
      jsonInit("PUT", fullSavePayload(seed)),
      h.env,
    );
    expect(putRunning.status).toBe(409);

    // Double start → 409 (only draft is startable).
    const restart = await admin.request(
      `/api/admin/listicles/experiments/${created.experiment.public_id}/start`,
      jsonInit("POST", {}),
      h.env,
    );
    expect(restart.status).toBe(409);

    // Stop → stopped + pointer cleared + versions keep experiment_id.
    const stop = await admin.request(
      `/api/admin/listicles/experiments/${created.experiment.public_id}/stop`,
      jsonInit("POST", {}),
      h.env,
    );
    expect(stop.status).toBe(200);
    expect(((await stop.json()) as { experiment: { status: string } }).experiment.status).toBe(
      "stopped",
    );
    const articleAfterStop = h.sdb
      .prepare("SELECT active_experiment_id FROM listicle_articles WHERE public_id = ?")
      .get(seed.articleId) as { active_experiment_id: number | null };
    expect(articleAfterStop.active_experiment_id).toBeNull();
    const controlRow = versionRow(h.sdb, seed.versionId);
    expect(controlRow.experiment_id).not.toBeNull(); // history kept (§5.3)

    // Stopping again → 409 (only running is stoppable).
    const restop = await admin.request(
      `/api/admin/listicles/experiments/${created.experiment.public_id}/stop`,
      jsonInit("POST", {}),
      h.env,
    );
    expect(restop.status).toBe(409);
  });

  it("FIX-3: /start rejects a duplicate variant_label in the FINAL merged state (labels identify arms, §15.7)", async () => {
    const h = newHarness();
    const seed = await seedArticle(h, "start-label");
    const create = await admin.request(
      `/api/admin/listicles/articles/${seed.articleId}/experiments`,
      jsonInit("POST", {
        name: "Label clash",
        status: "draft",
        versions: [{ version_id: seed.versionId, traffic_allocation: 100, is_control: true }],
      }),
      h.env,
    );
    expect(create.status).toBe(201);
    const created = (await create.json()) as { experiment: { public_id: string } };
    const fork = await admin.request(
      `/api/admin/listicles/versions/${seed.versionId}/fork`,
      jsonInit("POST", { join_experiment: true }),
      h.env,
    );
    expect(fork.status).toBe(201);
    const forkBody = (await fork.json()) as { version: { public_id: string } };

    // Override collides (case-insensitive) with the control's 'A' → 400.
    const clash = await admin.request(
      `/api/admin/listicles/experiments/${created.experiment.public_id}/start`,
      jsonInit("POST", {
        versions: [
          { version_id: seed.versionId, traffic_allocation: 60, is_control: true },
          { version_id: forkBody.version.public_id, traffic_allocation: 40, variant_label: "a" },
        ],
      }),
      h.env,
    );
    expect(clash.status).toBe(400);
    const clashBody = (await clash.json()) as { fields: Record<string, string> };
    expect(clashBody.fields.variant_label).toContain("duplicate variant_label");
    // The experiment did NOT start.
    const stillDraft = h.sdb
      .prepare("SELECT status FROM listicle_article_experiments WHERE public_id = ?")
      .get(created.experiment.public_id) as { status: string };
    expect(stillDraft.status).toBe("draft");

    // Distinct labels start fine.
    const start = await admin.request(
      `/api/admin/listicles/experiments/${created.experiment.public_id}/start`,
      jsonInit("POST", {
        versions: [
          { version_id: seed.versionId, traffic_allocation: 60, is_control: true },
          { version_id: forkBody.version.public_id, traffic_allocation: 40, variant_label: "B2" },
        ],
      }),
      h.env,
    );
    expect(start.status).toBe(200);
  });
});

describeDb("GET /articles?search= (DEV-10)", () => {
  it("filters by article_name/slug LIKE within the site scope and keeps paging", async () => {
    const h = newHarness();
    await seedArticle(h, "senior-savings-guide");
    await seedArticle(h, "best-cat-food");

    const byName = await admin.request(
      "/api/admin/listicles/articles?site_id=st_test&search=senior",
      jsonInit("GET"),
      h.env,
    );
    expect(byName.status).toBe(200);
    const byNameBody = (await byName.json()) as {
      articles: Array<{ slug: string }>;
      paging: { total: number };
    };
    expect(byNameBody.articles).toHaveLength(1);
    expect(byNameBody.articles[0]?.slug).toBe("senior-savings-guide");
    expect(byNameBody.paging.total).toBe(1);

    const bySlug = await admin.request(
      "/api/admin/listicles/articles?site_id=st_test&search=cat-food",
      jsonInit("GET"),
      h.env,
    );
    const bySlugBody = (await bySlug.json()) as { articles: Array<{ slug: string }> };
    expect(bySlugBody.articles).toHaveLength(1);
    expect(bySlugBody.articles[0]?.slug).toBe("best-cat-food");

    // LIKE wildcards in user input are escaped, not interpreted.
    const wildcard = await admin.request(
      "/api/admin/listicles/articles?site_id=st_test&search=%25",
      jsonInit("GET"),
      h.env,
    );
    const wildcardBody = (await wildcard.json()) as { articles: unknown[] };
    expect(wildcardBody.articles).toHaveLength(0);

    // Site scoping still applies.
    const otherSite = await admin.request(
      "/api/admin/listicles/articles?site_id=st_missing&search=senior",
      jsonInit("GET"),
      h.env,
    );
    const otherBody = (await otherSite.json()) as { articles: unknown[] };
    expect(otherBody.articles).toHaveLength(0);
  });
});
