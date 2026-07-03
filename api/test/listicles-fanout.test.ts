// §22.2 Section fan-out invalidation + §7.1 publish invalidate/warm — over
// REAL sqlite (repo harness pattern): a Section content save walks
// candidates → pages → versions → articles, bumps each consuming Version's
// content_version (PROVEN cache-identity change), wipes the stale shell
// keys and warms the new ones in-process; publish does the same for the
// published article. A content NO-OP save runs no fan-out.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { listicleKey } from "../src/cache/cache-keys";
import { fanOutSectionInvalidate } from "../src/listicles/invalidate";

// --- node:sqlite harness (repo pattern) --------------------------------------

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
    return (nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as {
        getBuiltinModule?: (name: string) => unknown;
      }).getBuiltinModule;
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
        for (const statement of statements) results.push(await statement.run());
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

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, storage_key TEXT);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, kind TEXT, is_primary INTEGER DEFAULT 0, status TEXT);" +
      "CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT);",
  );
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0032_listicles_core.sql"), "utf8"));
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0033_listicles_analytics_mirror.sql"), "utf8"));
  return sdb;
}

function makeKv(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async getWithMetadata(key: string) {
      return { value: store.get(key) ?? null, metadata: null, cacheStatus: null };
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? "";
      return {
        keys: [...store.keys()]
          .filter((name) => name.startsWith(prefix))
          .map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      };
    },
  } as unknown as KVNamespace;
  return { kv, store };
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

const SITE = "site_fan";
const HOST = "fan.example.com";

interface Graph {
  sdb: SqliteDb;
  env: Env;
  store: Map<string, string>;
  sectionId: number;
  articleId: number;
  articlePublicId: string;
  versionPublicId: string;
}

// Seed: site + active domain + one section consumed by one article version
// (published unless told otherwise).
async function seedGraph(articleStatus = "published"): Promise<Graph> {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  const { kv, store } = makeKv();
  const env = buildEnv(d1FromSqlite(sdb), kv);

  sdb.prepare("INSERT INTO sites (id, name) VALUES (?, ?)").run(SITE, "Fan Site");
  sdb
    .prepare(
      "INSERT INTO domains (site_id, hostname, kind, is_primary, status) VALUES (?, ?, 'canonical', 1, 'active')",
    )
    .run(SITE, HOST);
  sdb.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, 'site_name', 'Fan Site')").run(SITE);

  // Section via the REAL save pipeline (enrichment + link graph).
  const res = await admin.request(
    "/api/admin/listicles/sections",
    jsonInit("POST", {
      section_name: "Fan section",
      headline_text: "Fan heading",
      content_json: { blocks: [{ type: "paragraph", data: { text: "Original body." } }] },
    }),
    env,
  );
  expect(res.status).toBe(201);
  const { section } = (await res.json()) as { section: { id: number; content_version: number } };

  sdb
    .prepare(
      `INSERT INTO listicle_articles (public_id, site_id, slug, article_name, status, published_at)
       VALUES ('art_fan01', ?, 'fan-slug', 'Fan article', ?, unixepoch())`,
    )
    .run(SITE, articleStatus);
  const articleId = (sdb.prepare("SELECT id FROM listicle_articles WHERE public_id = 'art_fan01'").get() as { id: number }).id;
  sdb
    .prepare(
      `INSERT INTO listicle_article_versions
         (public_id, article_id, variant_label, is_control, traffic_allocation,
          headline, intro_paragraph, hero_media_url, layout_style_id, content_version, status)
       VALUES ('ver_fan01', ?, 'A', 1, 100, 'Fan headline', 'Fan intro.', '/media/hero.png', 'default', 1, 'active')`,
    )
    .run(articleId);
  const versionId = (sdb.prepare("SELECT id FROM listicle_article_versions WHERE public_id = 'ver_fan01'").get() as { id: number }).id;
  sdb
    .prepare(
      "INSERT INTO listicle_pages (public_id, article_version_id, page_index, selection_mode) VALUES ('pg_fan01', ?, 0, 'single')",
    )
    .run(versionId);
  const pageId = (sdb.prepare("SELECT id FROM listicle_pages WHERE public_id = 'pg_fan01'").get() as { id: number }).id;
  sdb
    .prepare(
      "INSERT INTO listicle_page_section_candidates (public_id, page_id, section_id, label) VALUES ('cand_fan01', ?, ?, 'A')",
    )
    .run(pageId, section.id);

  return {
    sdb,
    env,
    store,
    sectionId: section.id,
    articleId,
    articlePublicId: "art_fan01",
    versionPublicId: "ver_fan01",
  };
}

function versionContentVersion(sdb: SqliteDb): number {
  return (
    sdb.prepare("SELECT content_version FROM listicle_article_versions WHERE public_id = 'ver_fan01'").get() as {
      content_version: number;
    }
  ).content_version;
}

describeDb("§22.2 Section save fan-out (real sqlite graph)", () => {
  it("a section CONTENT edit bumps every consuming Version's content_version → NEW cache identity; stale key wiped; new shell warmed", async () => {
    const g = await seedGraph();
    expect(versionContentVersion(g.sdb)).toBe(1);
    const staleKey = listicleKey(SITE, "fan-slug", g.versionPublicId, 1);
    g.store.set(staleKey, "<stale shell>");

    const res = await admin.request(
      `/api/admin/listicles/sections/${g.sectionId}`,
      jsonInit("PATCH", {
        content_json: { blocks: [{ type: "paragraph", data: { text: "EDITED body." } }] },
      }),
      g.env,
    );
    expect(res.status).toBe(200);

    // 1. the consuming Version's content_version bumped (1 → 2).
    expect(versionContentVersion(g.sdb)).toBe(2);
    // 2. cache identity PROVEN changed: the stale key was deleted…
    expect(g.store.has(staleKey)).toBe(false);
    // 3. …and the NEW identity was warmed in-process with a real shell.
    const warmKey = listicleKey(SITE, "fan-slug", g.versionPublicId, 2);
    expect(g.store.has(warmKey)).toBe(true);
    const shell = g.store.get(warmKey) ?? "";
    expect(shell).toContain('data-lander-v="ver_fan01"');
    expect(shell).toContain("EDITED body.");
    expect(staleKey).not.toBe(warmKey);
  });

  it("a content NO-OP save (name-only PATCH) runs NO fan-out", async () => {
    const g = await seedGraph();
    const res = await admin.request(
      `/api/admin/listicles/sections/${g.sectionId}`,
      jsonInit("PATCH", { section_name: "Renamed only" }),
      g.env,
    );
    expect(res.status).toBe(200);
    expect(versionContentVersion(g.sdb)).toBe(1); // untouched
    expect([...g.store.keys()].some((k) => k.startsWith("html:"))).toBe(false); // no warm
  });

  it("an UNPUBLISHED consuming article still gets its bump + wipe but is not warmed", async () => {
    const g = await seedGraph("draft");
    const staleKey = listicleKey(SITE, "fan-slug", g.versionPublicId, 1);
    g.store.set(staleKey, "<stale shell>");
    const result = await fanOutSectionInvalidate(g.env, g.env.DB, g.sectionId);
    expect(result.affected_versions).toBe(1);
    expect(versionContentVersion(g.sdb)).toBe(2);
    expect(g.store.has(staleKey)).toBe(false);
    expect(result.shells_warmed).toBe(0);
  });

  it("a section consumed by NOTHING is a no-op fan-out", async () => {
    const g = await seedGraph();
    // fresh unconsumed section
    const res = await admin.request(
      "/api/admin/listicles/sections",
      jsonInit("POST", {
        section_name: "Orphan",
        headline_text: "Orphan heading",
        content_json: { blocks: [{ type: "paragraph", data: { text: "x" } }] },
      }),
      g.env,
    );
    const { section } = (await res.json()) as { section: { id: number } };
    const result = await fanOutSectionInvalidate(g.env, g.env.DB, section.id);
    expect(result.affected_versions).toBe(0);
    expect(versionContentVersion(g.sdb)).toBe(1);
  });
});

describeDb("§7.1 publish → invalidate + warm (the Phase-2 TODO replaced)", () => {
  it("publishing an article wipes its stale shells and warms every ACTIVE Version's shell", async () => {
    const g = await seedGraph("draft");
    const staleKey = listicleKey(SITE, "fan-slug", g.versionPublicId, 1);
    g.store.set(staleKey, "<stale shell>");

    const res = await admin.request(
      `/api/admin/listicles/articles/${g.articleId}/publish`,
      jsonInit("POST"),
      g.env,
    );
    expect(res.status).toBe(200);
    const { article } = (await res.json()) as { article: { status: string } };
    expect(article.status).toBe("published");

    // invalidate ran (stale key deleted because warm re-put it under the
    // SAME key — content_version did not change on publish — so assert the
    // warmed body replaced the stale one).
    const warmed = g.store.get(staleKey) ?? "";
    expect(warmed).not.toBe("<stale shell>");
    expect(warmed).toContain('data-lander-v="ver_fan01"');
    expect(warmed).toContain("Fan headline");
  });
});
